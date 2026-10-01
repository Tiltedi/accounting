// Local stand-in for the Supabase APIs (auth, PostgREST subset, storage) and
// the Anthropic Messages API, so the app can be exercised end to end offline.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";

const PORT = Number(process.env.MOCK_PORT ?? 54321);
const LOG = process.env.MOCK_LOG ?? "/tmp/mock-requests.jsonl";
const STATE_DIR = process.env.MOCK_STATE ?? "/tmp/mock-state";
fs.mkdirSync(STATE_DIR, { recursive: true });

const users = new Map([["luca@tiltedi.com", { id: "3bf1b986-5ab8-4c9b-8125-18c3d251e7d9", password: "correct horse battery" }]]);
const tokens = new Map(); // access token -> email
const refresh = new Map(); // refresh token -> email
const docs = [];
const files = new Map(); // path -> { bytes, type }
let anthropicCalls = 0;
let anthropicMode = process.env.ANTHROPIC_MODE ?? "ok"; // ok | fail | slow

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

function session(email) {
  const user = users.get(email);
  const now = Math.floor(Date.now() / 1000);
  const access = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    sub: user.id, email, role: "authenticated", aud: "authenticated", exp: now + 3600, iat: now, session_id: crypto.randomUUID(),
  })}.${crypto.randomBytes(16).toString("base64url")}`;
  const rt = crypto.randomBytes(12).toString("hex");
  tokens.set(access, email);
  refresh.set(rt, email);
  return {
    access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: rt,
    user: userJson(email),
  };
}

function userJson(email) {
  const u = users.get(email);
  return {
    id: u.id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: "2026-09-29T00:00:00Z",
    phone: "", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [],
    created_at: "2026-09-29T00:00:00Z", updated_at: "2026-09-29T00:00:00Z", is_anonymous: false,
  };
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, {
    "Content-Type": isBuf ? headers["Content-Type"] ?? "application/octet-stream" : "application/json",
    ...cors(),
    ...headers,
  });
  res.end(isBuf ? body : body === undefined ? "" : JSON.stringify(body));
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD",
    "Access-Control-Expose-Headers": "content-range, content-disposition, x-supabase-api-version",
  };
}

function authEmail(req) {
  const header = req.headers.authorization ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  return tokens.get(token) ?? null;
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function log(entry) {
  fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...entry }) + "\n");
}

const COLUMNS = ["id", "created_at", "created_by", "status", "file_path", "file_name", "mime_type", "size_bytes", "sha256", "doc_date",
  "vendor", "description", "category", "doc_type", "invoice_number", "total", "tax", "currency", "notes", "extraction", "search"];

function pick(row, select) {
  if (!select || select === "*") return row;
  const out = {};
  for (const col of select.split(",")) out[col.trim()] = row[col.trim()] ?? null;
  return out;
}

function withSearch(row) {
  row.search = [row.vendor, row.description, row.invoice_number, row.notes, row.category, row.file_name].map((v) => v ?? "").join(" ").toLowerCase();
  return row;
}

function filterRows(params, source = docs) {
  let rows = source;
  for (const [key, value] of params) {
    if (["select", "order", "offset", "limit", "on_conflict", "columns"].includes(key)) continue;
    const m = /^eq\.(.*)$/.exec(value);
    if (m) rows = rows.filter((r) => String(r[key]) === m[1]);
    const ne = /^neq\.(.*)$/.exec(value);
    if (ne) rows = rows.filter((r) => String(r[key]) !== ne[1]);
    const inList = /^in\.\((.*)\)$/.exec(value);
    if (inList) {
      const values = inList[1].split(",").map((v) => v.replace(/^"|"$/g, ""));
      rows = rows.filter((r) => values.includes(String(r[key])));
    }
  }
  return rows;
}

function sortRows(rows, order) {
  if (!order) return rows;
  const keys = order.split(",").map((o) => o.split("."));
  return rows.sort((a, b) => {
    for (const [col, dir] of keys) {
      if (a[col] === b[col]) continue;
      const cmp = a[col] < b[col] ? -1 : 1;
      return dir === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}

const txs = [];
const rules = [
  ["counterparty", "ING", true, "Bank fees"],
  ["counterparty", "SD Worx", false, "Peppol"],
  ["description", "Category Purpose: Salary payment", false, "Salary"],
  ["counterparty", "Radius Business Solutions", false, "Peppol"],
  ["counterparty", "Jane Peeters", false, "Rent"],
  ["description", "Reimbursement Car loan", false, "Car loan"],
].map(([field, pattern, exact, label], i) => ({ id: crypto.randomUUID(), created_at: new Date(Date.now() + i).toISOString(), field, pattern, exact, label }));

const vendorLinks = [];

// ----- Email inbox: tables, Google OAuth and the Gmail API ---------------------
const mailConnections = [];
const inboxItems = [];
const TABLES = {
  mail_connections: { rows: mailConnections, key: "email", defaults: () => ({ last_checked_at: null }) },
  inbox_items: { rows: inboxItems, key: "gmail_id", defaults: () => ({ status: "pending", decided_at: null, document_ids: [], attachments: [], snippet: null }) },
};

// Generic PostgREST subset for the inbox tables: select/eq/neq/in/order/limit, insert, upsert, update, delete.
async function restTable(req, res, url, table) {
  const email = authEmail(req);
  if (!email) return send(res, 401, { code: "PGRST301", message: "JWT required" });
  const { rows, key, defaults } = TABLES[table];
  const params = url.searchParams;
  const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const select = params.get("select");
  const out = (list, status = 200) => {
    const picked = list.map((r) => pick(r, select));
    if (single) return picked.length === 1 ? send(res, status, picked[0]) : picked.length === 0 && req.method === "GET" ? send(res, 406, { code: "PGRST116", message: "0 rows" }) : send(res, 406, { code: "PGRST116", message: "rows" });
    return send(res, status, picked);
  };
  if (req.method === "GET") {
    let list = sortRows([...filterRows(params, rows)], params.get("order"));
    if (params.has("limit")) list = list.slice(0, Number(params.get("limit")));
    return out(list);
  }
  if (req.method === "POST") {
    let input = JSON.parse((await body(req)).toString() || "[]");
    if (!Array.isArray(input)) input = [input];
    const prefer = String(req.headers.prefer ?? "");
    const saved = [];
    for (const item of input) {
      const existing = rows.find((r) => r[key] === item[key]);
      if (existing) {
        if (prefer.includes("ignore-duplicates")) continue;
        if (prefer.includes("merge-duplicates")) { Object.assign(existing, item); saved.push(existing); continue; }
        return send(res, 409, { code: "23505", message: `duplicate ${key}` });
      }
      const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...defaults(), ...item };
      rows.push(row);
      saved.push(row);
    }
    log({ kind: `${table}-insert`, count: saved.length });
    return out(saved, 201);
  }
  if (req.method === "PATCH") {
    const input = JSON.parse((await body(req)).toString() || "{}");
    const list = filterRows(params, rows);
    for (const row of list) Object.assign(row, input);
    log({ kind: `${table}-update`, input, count: list.length });
    return out(list);
  }
  if (req.method === "DELETE") {
    for (const row of filterRows(params, rows)) rows.splice(rows.indexOf(row), 1);
    return send(res, 204);
  }
  return send(res, 405, { message: "method" });
}

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const mailbox = [];
let googleRefresh = null;
let gmailCalls = 0;
function addMail({ id, from, subject, snippet, files = [], text = "Forwarded invoice", at = Date.now() }) {
  const parts = [{ partId: "0", mimeType: "text/plain", filename: "", headers: [], body: { size: text.length, data: b64(text) } }];
  files.forEach((f, i) => {
    const bytes = fs.readFileSync(new URL(`./fixtures/${f.fixture}`, import.meta.url));
    const headers = [{ name: "Content-Disposition", value: `${f.inline ? "inline" : "attachment"}; filename="${f.name}"` }];
    if (f.inline) headers.push({ name: "Content-ID", value: `<sig${i}>` });
    parts.push({ partId: String(i + 1), mimeType: f.mime, filename: f.name, headers, body: { attachmentId: `att-${id}-${i}-${crypto.randomUUID()}`, size: bytes.length }, bytes });
  });
  mailbox.push({ id, internalDate: String(at), snippet, payload: { mimeType: "multipart/mixed", headers: [{ name: "From", value: from }, { name: "To", value: "admin@tiltedi.com" }, { name: "Date", value: new Date(at).toUTCString() }, { name: "Subject", value: subject }], parts } });
}
addMail({ id: "m1", from: "Luca Pilurzu <luca@tiltedi.com>", subject: "Fwd: Your invoice from ACME Cloud", snippet: "Forwarded message &amp; invoice", files: [{ name: "invoice.pdf", mime: "application/octet-stream", fixture: "invoice.pdf" }], at: Date.now() - 3600_000 });
addMail({ id: "m2", from: "Shell <noreply@shell.example>", subject: "Your fuel receipt", snippet: "Thanks for stopping by", files: [{ name: "shell.jpg", mime: "image/jpeg", fixture: "shell.jpg" }, { name: "logo.png", mime: "image/png", fixture: "ticket.png", inline: true }], at: Date.now() - 7200_000 });
addMail({ id: "m3", from: "Google <no-reply@accounts.google.com>", subject: "Security alert", snippet: "A new sign-in", at: Date.now() - 1800_000 });

async function google(req, res, url) {
  if (url.pathname === "/google/auth") {
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "mock-code");
    back.searchParams.set("state", url.searchParams.get("state"));
    log({ kind: "google-auth", scope: url.searchParams.get("scope"), access: url.searchParams.get("access_type") });
    res.writeHead(302, { Location: back.toString() });
    return res.end();
  }
  if (url.pathname === "/google/token" && req.method === "POST") {
    const form = new URLSearchParams((await body(req)).toString());
    if (form.get("client_secret") !== "test-secret") return send(res, 401, { error: "invalid_client" });
    if (form.get("grant_type") === "authorization_code" && form.get("code") === "mock-code") {
      googleRefresh = `refresh-${crypto.randomUUID()}`;
      return send(res, 200, { access_token: "gmail-access", refresh_token: googleRefresh, expires_in: 3600 });
    }
    if (form.get("grant_type") === "refresh_token" && form.get("refresh_token") === googleRefresh) {
      return send(res, 200, { access_token: "gmail-access", expires_in: 3600 });
    }
    return send(res, 400, { error: "invalid_grant" });
  }
  return send(res, 404, { error: "unknown google route" });
}

function gmail(req, res, url) {
  if (req.headers.authorization !== "Bearer gmail-access") return send(res, 401, { error: { message: "Invalid Credentials" } });
  gmailCalls++;
  const path = url.pathname.replace(/^\/gmail\/v1\/users\/me/, "");
  if (path === "/profile") return send(res, 200, { emailAddress: "admin@tiltedi.com" });
  if (path === "/messages") return send(res, 200, { messages: [...mailbox].sort((a, b) => b.internalDate - a.internalDate).map((m) => ({ id: m.id })) });
  const att = /^\/messages\/([^/]+)\/attachments\/(.+)$/.exec(path);
  if (att) {
    const part = mailbox.find((m) => m.id === att[1])?.payload.parts.find((p) => p.body.attachmentId === att[2]);
    if (!part) return send(res, 404, { error: { message: "Not Found" } });
    return send(res, 200, { size: part.bytes.length, data: b64(part.bytes) });
  }
  const msg = /^\/messages\/([^/]+)$/.exec(path);
  if (msg) {
    const m = mailbox.find((x) => x.id === msg[1]);
    if (!m) return send(res, 404, { error: { message: "Not Found" } });
    // Like Gmail: attachment ids change on every read.
    for (const p of m.payload.parts) if (p.body.attachmentId) p.body.attachmentId = `att-${m.id}-${p.partId}-${crypto.randomUUID()}`;
    return send(res, 200, JSON.parse(JSON.stringify(m, (k, v) => (k === "bytes" ? undefined : v))));
  }
  return send(res, 404, { error: { message: `unknown gmail route ${path}` } });
}

async function restLinks(req, res, url) {
  const email = authEmail(req);
  if (!email) return send(res, 401, { code: "PGRST301", message: "JWT required" });
  const params = url.searchParams;
  const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const select = params.get("select");
  const out = (rows) => (single ? (rows.length === 1 ? send(res, 200, pick(rows[0], select)) : send(res, 406, { code: "PGRST116", message: "rows" })) : send(res, 200, rows.map((r) => pick(r, select))));
  if (req.method === "GET") return out(sortRows([...filterRows(params, vendorLinks)], params.get("order")));
  const input = req.method === "DELETE" ? {} : JSON.parse((await body(req)).toString() || "{}");
  if (input.url !== undefined && !/^https?:\/\//i.test(input.url)) return send(res, 400, { code: "23514", message: "url check" });
  if (req.method === "POST") {
    const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...input };
    vendorLinks.push(row);
    return out([row]);
  }
  if (req.method === "PATCH") {
    const rows = filterRows(params, vendorLinks);
    for (const row of rows) Object.assign(row, input);
    return out(rows);
  }
  if (req.method === "DELETE") {
    for (const row of filterRows(params, vendorLinks)) vendorLinks.splice(vendorLinks.indexOf(row), 1);
    return send(res, 204);
  }
}

async function restRules(req, res, url) {
  const email = authEmail(req);
  if (!email) return send(res, 401, { code: "PGRST301", message: "JWT required" });
  const params = url.searchParams;
  const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const select = params.get("select");
  if (req.method === "GET") return send(res, 200, sortRows([...filterRows(params, rules)], params.get("order")).map((r) => pick(r, select)));
  if (req.method === "POST") {
    const input = JSON.parse((await body(req)).toString() || "{}");
    if (!["counterparty", "description"].includes(input.field) || !(input.pattern ?? "").trim()) return send(res, 400, { code: "23514", message: "check" });
    const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), exact: false, label: null, ...input };
    rules.push(row);
    log({ kind: "rule-insert", row });
    return send(res, 201, single ? pick(row, select) : [pick(row, select)]);
  }
  if (req.method === "DELETE") {
    const rows = filterRows(params, rules);
    for (const row of rows) rules.splice(rules.indexOf(row), 1);
    return send(res, 204);
  }
  return send(res, 405, { message: "method" });
}

async function restTransactions(req, res, url) {
  const email = authEmail(req);
  if (!email) return send(res, 401, { code: "PGRST301", message: "JWT required" });
  const params = url.searchParams;
  const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const select = params.get("select");
  const okStatus = (r) => ["unmatched", "matched", "no_receipt"].includes(r.status) && ["bank", "card"].includes(r.source) && /^[A-Z]{3}$/.test(r.currency);

  if (req.method === "GET") {
    let rows = sortRows([...filterRows(params, txs)], params.get("order"));
    const offset = Number(params.get("offset") ?? 0);
    const limit = params.has("limit") ? Number(params.get("limit")) : rows.length;
    rows = rows.slice(offset, offset + limit).map((r) => pick(r, select));
    return send(res, 200, rows);
  }
  if (req.method === "POST") {
    let input = JSON.parse((await body(req)).toString() || "[]");
    if (!Array.isArray(input)) input = [input];
    const ignore = String(req.headers.prefer ?? "").includes("ignore-duplicates");
    const inserted = [];
    for (const item of input) {
      const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), currency: "EUR", document_id: null, status: "unmatched", matched_by: null, account: null, counterparty: null, description: null, source: "bank", statement_id: null, note: null, bank_ref: null, ...item };
      if (!okStatus(row)) return send(res, 400, { code: "23514", message: "check" });
      if (txs.some((t) => t.fingerprint === row.fingerprint)) {
        if (ignore) continue;
        return send(res, 409, { code: "23505", message: "duplicate fingerprint" });
      }
      txs.push(row);
      inserted.push(row);
    }
    log({ kind: "tx-insert", count: inserted.length, of: input.length });
    return send(res, 201, inserted.map((r) => pick(r, select)));
  }
  if (req.method === "PATCH") {
    const input = JSON.parse((await body(req)).toString() || "{}");
    const rows = filterRows(params, txs);
    for (const row of rows) Object.assign(row, input);
    log({ kind: "tx-update", input, count: rows.length });
    const out = rows.map((r) => pick(r, select));
    if (single) {
      if (out.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return send(res, 200, out[0]);
    }
    return send(res, 200, out);
  }
  if (req.method === "DELETE") {
    const rows = filterRows(params, txs);
    for (const row of rows) txs.splice(txs.indexOf(row), 1);
    log({ kind: "tx-delete", count: rows.length });
    return send(res, 204);
  }
}

function validate(row) {
  if (row.currency != null && !/^[A-Z]{3}$/.test(row.currency)) return { code: "23514", message: 'new row for relation "documents" violates check constraint "documents_currency_check"' };
  if (!["processing", "ready", "failed"].includes(row.status)) return { code: "23514", message: "status check" };
  for (const col of ["sha256", "file_path"]) {
    if (row[col] != null && docs.some((d) => d !== row && d.id !== row.id && d[col] === row[col])) {
      return { code: "23505", message: `duplicate key value violates unique constraint "documents_${col}_key"` };
    }
  }
  return null;
}

async function rest(req, res, url) {
  const email = authEmail(req);
  if (!email) return send(res, 401, { code: "PGRST301", message: "JWT required" });
  const params = url.searchParams;
  const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const select = params.get("select");

  if (req.method === "GET") {
    let rows = [...filterRows(params)];
    const order = params.get("order");
    if (order) {
      const keys = order.split(",").map((o) => o.split("."));
      rows.sort((a, b) => {
        for (const [col, dir] of keys) {
          if (a[col] === b[col]) continue;
          const cmp = a[col] < b[col] ? -1 : 1;
          return dir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }
    const offset = Number(params.get("offset") ?? 0);
    const limit = params.has("limit") ? Number(params.get("limit")) : rows.length;
    rows = rows.slice(offset, offset + limit).map((r) => pick(r, select));
    if (single) {
      if (rows.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return send(res, 200, rows[0]);
    }
    return send(res, 200, rows, { "Content-Range": `${offset}-${offset + rows.length - 1}/*` });
  }

  if (req.method === "POST") {
    const input = JSON.parse((await body(req)).toString() || "{}");
    const row = withSearch({
      id: crypto.randomUUID(), created_at: new Date().toISOString(), created_by: users.get(email).id, status: "processing",
      sha256: null, vendor: null, description: null, category: "Other", doc_type: null, invoice_number: null, total: null, tax: null,
      currency: null, notes: null, extraction: null, recurring: false, doc_date: new Date().toISOString().slice(0, 10), ...input,
    });
    const err = validate(row);
    if (err) return send(res, err.code === "23505" ? 409 : 400, err);
    docs.push(row);
    log({ kind: "insert", row });
    const out = pick(row, select);
    return send(res, 201, single ? out : [out]);
  }

  if (req.method === "PATCH") {
    const input = JSON.parse((await body(req)).toString() || "{}");
    const rows = filterRows(params);
    for (const row of rows) {
      const next = withSearch({ ...row, ...input });
      const err = validate(next);
      if (err) return send(res, 400, err);
      Object.assign(row, next);
    }
    log({ kind: "update", input, count: rows.length });
    const out = rows.map((r) => pick(r, select));
    if (single) {
      if (out.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return send(res, 200, out[0]);
    }
    return send(res, 200, out);
  }

  if (req.method === "DELETE") {
    const rows = filterRows(params);
    for (const row of rows) {
      docs.splice(docs.indexOf(row), 1);
      for (const t of txs) if (t.document_id === row.id) Object.assign(t, { document_id: null, status: "unmatched", matched_by: null });
      for (const t of txs.filter((x) => x.statement_id === row.id)) txs.splice(txs.indexOf(t), 1);
    }
    log({ kind: "delete", ids: rows.map((r) => r.id) });
    return send(res, 204);
  }
  return send(res, 405, { message: "method" });
}

// Pulls the file part out of a multipart/form-data body (storage-js sends Blobs that way).
function filePart(buf, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  let start = buf.indexOf(delim);
  while (start !== -1) {
    const next = buf.indexOf(delim, start + delim.length);
    if (next === -1) break;
    const part = buf.subarray(start + delim.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    const head = part.subarray(0, split).toString();
    if (/filename=/.test(head)) {
      const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1] ?? "application/octet-stream";
      return { bytes: Buffer.from(part.subarray(split + 4)), type };
    }
    start = next;
  }
  throw new Error("no file part");
}

async function storage(req, res, url) {
  const path = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ""));
  if (path.startsWith("/object/sign/documents/") && req.method === "GET") {
    const key = path.slice("/object/sign/documents/".length);
    const f = files.get(key);
    if (!f || url.searchParams.get("token") !== "tok") return send(res, 400, { error: "InvalidJWT", message: "bad token" });
    const headers = { "Content-Type": f.type };
    if (url.searchParams.has("download")) headers["Content-Disposition"] = `attachment; filename="${url.searchParams.get("download") || key}"`;
    return send(res, 200, f.bytes, headers);
  }

  const email = authEmail(req);
  if (!email) return send(res, 400, { statusCode: "403", error: "Unauthorized", message: "invalid token" });

  if (path.startsWith("/object/sign/documents/") && req.method === "POST") {
    const key = path.slice("/object/sign/documents/".length);
    if (!files.has(key)) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
    return send(res, 200, { signedURL: `/object/sign/documents/${encodeURIComponent(key).replace(/%2F/g, "/")}?token=tok` });
  }
  if (path === "/object/documents" && req.method === "DELETE") {
    const { prefixes } = JSON.parse((await body(req)).toString());
    for (const p of prefixes) files.delete(p);
    log({ kind: "storage-remove", prefixes });
    return send(res, 200, prefixes.map((name) => ({ name })));
  }
  if (path.startsWith("/object/documents/")) {
    const key = path.slice("/object/documents/".length);
    if (req.method === "POST" || req.method === "PUT") {
      if (files.has(key)) return send(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      let bytes = await body(req);
      let type = req.headers["content-type"] ?? "application/octet-stream";
      const boundary = /multipart\/form-data; boundary=(.+)$/.exec(type)?.[1];
      if (boundary) ({ bytes, type } = filePart(bytes, boundary));
      files.set(key, { bytes, type });
      fs.writeFileSync(`${STATE_DIR}/${key.replace(/\//g, "_")}`, bytes);
      log({ kind: "upload", key, type, size: bytes.length });
      return send(res, 200, { Key: `documents/${key}`, Id: crypto.randomUUID() });
    }
    if (req.method === "GET") {
      const f = files.get(key);
      if (!f) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
      return send(res, 200, f.bytes, { "Content-Type": f.type });
    }
  }
  return send(res, 404, { message: `unknown storage route ${req.method} ${path}` });
}

async function auth(req, res, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  if (path === "/token" && req.method === "POST") {
    const input = JSON.parse((await body(req)).toString() || "{}");
    if (url.searchParams.get("grant_type") === "password") {
      const user = users.get(String(input.email).toLowerCase());
      if (!user || user.password !== input.password) {
        return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      }
      return send(res, 200, session(String(input.email).toLowerCase()));
    }
    if (url.searchParams.get("grant_type") === "refresh_token") {
      const email = refresh.get(input.refresh_token);
      if (!email) return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      return send(res, 200, session(email));
    }
  }
  if (path === "/user" && req.method === "GET") {
    const email = authEmail(req);
    if (!email) return send(res, 403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
    return send(res, 200, userJson(email));
  }
  if (path === "/user" && req.method === "PUT") {
    const email = authEmail(req);
    if (!email) return send(res, 403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
    const input = JSON.parse((await body(req)).toString() || "{}");
    if (input.password) users.get(email).password = input.password;
    log({ kind: "password-change", email });
    return send(res, 200, userJson(email));
  }
  if (path === "/logout" && req.method === "POST") {
    const header = req.headers.authorization ?? "";
    tokens.delete(header.replace(/^Bearer\s+/i, ""));
    return send(res, 204);
  }
  return send(res, 404, { msg: `unknown auth route ${req.method} ${path}` });
}

let invoiceCounter = 0;
async function anthropic(req, res) {
  const raw = (await body(req)).toString();
  const input = JSON.parse(raw);
  anthropicCalls++;
  const summary = {
    kind: "anthropic",
    headers: { beta: req.headers["anthropic-beta"], key: req.headers["x-api-key"] ? "set" : "missing", version: req.headers["anthropic-version"] },
    model: input.model,
    fallbacks: input.fallbacks,
    effort: input.output_config?.effort,
    formatType: input.output_config?.format?.type,
    schemaKeys: Object.keys(input.output_config?.format?.schema?.properties ?? {}),
    systemCache: input.system?.[0]?.cache_control,
    blockTypes: Array.isArray(input.messages?.[0]?.content) ? input.messages[0].content.map((b) => `${b.type}:${b.source?.media_type ?? ""}`) : ["text"],
    max_tokens: input.max_tokens,
  };
  log(summary);
  fs.writeFileSync(`${STATE_DIR}/last-anthropic-request.json`, JSON.stringify({ ...input, messages: "[omitted]" }, null, 2));

  if (anthropicMode === "fail") return send(res, 500, { type: "error", error: { type: "api_error", message: "boom" } });
  if (anthropicMode === "slow") await new Promise((r) => setTimeout(r, 4000));

  const firstContent = input.messages?.[0]?.content;
  if (typeof firstContent === "string" && firstContent.includes("bank statement export")) {
    // Headerless ABN AMRO-style export: account, currency, date, start, end, value date, amount, description
    const mapping = { header_row: -1, date: 2, amount: 6, debit: null, credit: null, sign: null, counterparty: null, description: 7, account: 0, currency: 1, date_format: "compact" };
    return send(res, 200, {
      id: "msg_map", type: "message", role: "assistant", model: input.model,
      content: [{ type: "text", text: JSON.stringify(mapping) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 400, output_tokens: 60 },
    });
  }
  if (input.system?.[0]?.text?.includes("credit card statements")) {
    const statement = {
      issuer: "ING", statement_date: "2026-09-01", card_last4: "3533", total_due: 236.02, currency: "EUR",
      lines: [
        { date: "2026-08-12", merchant: "Shell Mechelen", details: "Mechelen", amount: 65 },
        { date: "2026-08-17", merchant: "WISPR", details: "San Francisco · 15,00 USD", amount: 13.8 },
        { date: "2026-09-13", merchant: "ACME Cloud", details: null, amount: 1234.56 },
        { date: "2026-08-20", merchant: "ING", details: "Annual card fee", amount: 25 },
        { date: "2026-08-22", merchant: "Coolblue", details: "Refund", amount: -20 },
      ],
    };
    await new Promise((r) => setTimeout(r, 600));
    return send(res, 200, {
      id: "msg_stmt", type: "message", role: "assistant", model: input.model,
      content: [{ type: "text", text: JSON.stringify(statement) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 400 },
    });
  }
  invoiceCounter++;
  const fileName = input.messages?.[0]?.content?.find((b) => b.type === "text")?.text ?? "";
  const RESULTS = {
    "invoice.pdf": { vendor: "ACME Cloud", description: "Cloud hosting September", doc_date: "2026-09-12", doc_type: "invoice", category: "Software", invoice_number: "INV-2026-0042", total: 1234.56, tax: 222.56, currency: "EUR" },
    "receipt-photo.jpg": { vendor: "Bar Centrale", description: "Lunch with client", doc_date: "2026-08-03", doc_type: "receipt", category: "Meals", invoice_number: null, total: 49.9, tax: 4.54, currency: "EUR" },
    "ticket.png": { vendor: "Trenitalia", description: "Train Milano–Roma", doc_date: "2026-07-21", doc_type: "receipt", category: "Travel", invoice_number: "PNR X7K2", total: 89.5, tax: 8.14, currency: "EUR" },
    "page1.jpg": { vendor: "Amazon", description: "USB-C charger", doc_date: "2026-09-02", doc_type: "invoice", category: "Hardware", invoice_number: "IT-55821", total: 129, tax: 23.26, currency: "EUR" },
    "vlabel.jpg": { vendor: "Vlabel", description: "Registration tax", doc_date: "2026-09-28", doc_type: "invoice", category: "Taxes & fees", invoice_number: "VL-1", total: 168.66, tax: null, currency: "EUR" },
    "card-statement": { vendor: "ING", description: "Mastercard statement", doc_date: "2026-09-01", doc_type: "other", category: "Other", invoice_number: null, total: 236.02, tax: null, currency: "EUR", card_statement: true },
    "shell.jpg": { vendor: "Shell", description: "Fuel", doc_date: "2026-08-12", doc_type: "receipt", category: "Vehicle", invoice_number: null, total: 65, tax: 11.28, currency: "EUR" },
    "lrs-policy": { vendor: "LRS Insurance", description: "Car insurance policy 1082394, quarterly premium", doc_date: "2026-06-20", doc_type: "other", category: "Insurance", invoice_number: "1082394", total: 2419.48, tax: null, currency: "EUR" },
    "BTW Aangifte": { vendor: "FOD Financiën – btw-ontvangsten", description: "Btw-aangifte 2de kwartaal 2026", doc_date: "2026-07-21", doc_type: "other", category: "Taxes & fees", invoice_number: "+++078/7646/33429+++", total: 2145.43, tax: null, currency: "EUR" },
    Scan: { vendor: "Google Cloud", description: "Workspace subscription", doc_date: "2026-09-20", doc_type: "invoice", category: "Software", invoice_number: "GC-9921", total: 12.34, tax: null, currency: "USD" },
  };
  const key = Object.keys(RESULTS).find((k) => fileName.includes(k));
  const result = { card_statement: false, ...(key ? RESULTS[key] : { vendor: "Unknown Shop", description: null, doc_date: null, doc_type: "other", category: "Other", invoice_number: null, total: null, tax: null, currency: null }) };
  await new Promise((r) => setTimeout(r, 600));
  return send(res, 200, {
    id: `msg_${invoiceCounter}`, type: "message", role: "assistant", model: input.model,
    content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: JSON.stringify(result) }],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 90, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    try {
      if (req.method === "OPTIONS") return send(res, 204);
      if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url);
      if (url.pathname.startsWith("/rest/v1/documents")) return await rest(req, res, url);
      if (url.pathname.startsWith("/rest/v1/bank_transactions")) return await restTransactions(req, res, url);
      if (url.pathname.startsWith("/rest/v1/bank_rules")) return await restRules(req, res, url);
      if (url.pathname.startsWith("/rest/v1/vendor_links")) return await restLinks(req, res, url);
      if (url.pathname.startsWith("/rest/v1/mail_connections")) return await restTable(req, res, url, "mail_connections");
      if (url.pathname.startsWith("/rest/v1/inbox_items")) return await restTable(req, res, url, "inbox_items");
      if (url.pathname.startsWith("/google/")) return await google(req, res, url);
      if (url.pathname.startsWith("/gmail/v1/")) return gmail(req, res, url);
      if (url.pathname === "/__mail" && req.method === "POST") {
        addMail(JSON.parse((await body(req)).toString()));
        return send(res, 200, { count: mailbox.length });
      }
      if (url.pathname.startsWith("/storage/v1")) return await storage(req, res, url);
      if (url.pathname.startsWith("/v1/messages")) return await anthropic(req, res);
      if (url.pathname === "/__state") return send(res, 200, { docs, txs, rules, vendorLinks, files: [...files.keys()], anthropicCalls, mailConnections, inboxItems, gmailCalls });
      if (url.pathname === "/__mode") {
        anthropicMode = url.searchParams.get("anthropic") ?? anthropicMode;
        return send(res, 200, { anthropicMode });
      }
      if (url.pathname === "/__set" && req.method === "POST") {
        // Test hook: overwrite fields of stored bank lines, e.g. to simulate older fingerprints.
        const changes = JSON.parse((await body(req)).toString());
        for (const c of changes) Object.assign(txs.find((t) => t.id === c.id) ?? {}, c);
        return send(res, 200, { ok: true });
      }
      if (url.pathname === "/__expire") {
        tokens.clear();
        return send(res, 200, { ok: true });
      }
      send(res, 404, { message: `no route ${req.method} ${url.pathname}` });
    } catch (err) {
      console.error(err);
      send(res, 500, { message: String(err) });
    }
  })
  .listen(PORT, () => console.log(`mock listening on ${PORT}`));
