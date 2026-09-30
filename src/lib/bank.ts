import type { Database } from "@/lib/database.types";
import type { Client, Doc } from "@/lib/documents";
import { parseAmount } from "@/lib/format";

// Bank statements arrive as CSV exports from the bank's website (no bank
// connection). This file parses them, fingerprints each line so repeated
// imports never duplicate, and pairs lines with receipts.

type Row = Database["public"]["Tables"]["bank_transactions"]["Row"];

export type Transaction = Pick<
  Row,
  "id" | "import_id" | "account" | "booked_on" | "amount" | "currency" | "counterparty" | "description" | "document_id" | "statement_id" | "note"
> & {
  status: "unmatched" | "matched" | "no_receipt";
  matched_by: "auto" | "manual" | null;
  source: Source;
};

// "bank": the current account's CSV. "card": lines of a credit card statement.
export type Source = "bank" | "card";

export const TX_COLUMNS =
  "id,import_id,account,booked_on,amount,currency,counterparty,description,document_id,statement_id,note,status,matched_by,source" as const;

export async function fetchAllTransactions(supabase: Client): Promise<Transaction[]> {
  const pageSize = 1000;
  const txs: Transaction[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("bank_transactions")
      .select(TX_COLUMNS)
      .order("booked_on", { ascending: false })
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    txs.push(...(data as Transaction[]));
    if (data.length < pageSize) return txs;
  }
}

// ----- Rules ------------------------------------------------------------------

// Lines that never need a receipt: bank fees, salary, rent, suppliers that
// e-invoice straight into the accounting tool.
export type Rule = Pick<Database["public"]["Tables"]["bank_rules"]["Row"], "id" | "pattern" | "exact" | "label"> & {
  field: "counterparty" | "description";
};

export const RULE_COLUMNS = "id,field,pattern,exact,label" as const;

export async function fetchRules(supabase: Client): Promise<Rule[]> {
  const { data, error } = await supabase.from("bank_rules").select(RULE_COLUMNS).order("created_at");
  if (error) throw error;
  return data as Rule[];
}

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

export function ruleFor(tx: Pick<Transaction, "counterparty" | "description">, rules: Rule[]) {
  return rules.find((rule) => {
    const value = squash(tx[rule.field] ?? "");
    const pattern = squash(rule.pattern);
    return rule.exact ? value === pattern : value.includes(pattern);
  });
}

// ----- Billing pages ------------------------------------------------------------

// Where a supplier's invoices can be downloaded, found by name on a line.
export type VendorLink = Pick<Database["public"]["Tables"]["vendor_links"]["Row"], "id" | "pattern" | "url">;

export const LINK_COLUMNS = "id,pattern,url" as const;

export async function fetchVendorLinks(supabase: Client): Promise<VendorLink[]> {
  const { data, error } = await supabase.from("vendor_links").select(LINK_COLUMNS).order("pattern");
  if (error) throw error;
  return data;
}

export function linkFor(tx: Pick<Transaction, "counterparty" | "description">, links: VendorLink[]) {
  const text = squash(`${tx.counterparty ?? ""} ${tx.description ?? ""}`);
  let best: VendorLink | undefined;
  for (const link of links) {
    const pattern = squash(link.pattern);
    if (text.includes(pattern) && (!best || pattern.length > best.pattern.length)) best = link;
  }
  return best;
}

// Accepts "supabase.com/dashboard/…" as well as full URLs.
export function normalizeUrl(input: string) {
  const value = input.trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

// ----- Dismissed suggestions (this browser only) --------------------------------

const DISMISSED_KEY = "bank:dismissed";

export function loadDismissed() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"));
  } catch {
    return new Set<string>();
  }
}

export function saveDismissed(dismissed: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
  } catch {
    // Private mode: the dismissal lasts until reload.
  }
}

// ----- CSV ------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", "\t", ","].map((d) => ({ d, n: countOutsideQuotes(firstLine, d) })).sort((a, b) => b.n - a.n)[0].d;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row.map((c) => c.trim()));
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row.map((c) => c.trim()));
  return rows;
}

function countOutsideQuotes(line: string, ch: string) {
  let n = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === ch && !quoted) n++;
  }
  return n;
}

// ----- Column mapping ---------------------------------------------------------

export type DateFormat = "ymd" | "dmy" | "mdy" | "compact";

export type Mapping = {
  headerRow: number;
  date: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  sign: number | null; // "Af"/"Bij", "Debit"/"Credit", "D"/"C"
  counterparty: number | null;
  description: number | null;
  account: number | null;
  currency: number | null;
  entry?: number | null; // the bank's own id per line, e.g. ING's entry number
  dateFormat: DateFormat;
};

// Header names used by common banks (Dutch, English, Italian, German).
const HEADERS = {
  date: ["boekdatum", "transactiedatum", "datum", "date", "booking date", "transaction date", "started date", "completed date", "data operazione", "data contabile", "data", "buchungstag", "value date", "rentedatum"],
  amount: ["bedrag (eur)", "bedrag", "transactiebedrag", "amount", "amount (eur)", "importo", "betrag"],
  debit: ["debit", "debet", "af", "uitgaven", "addebiti", "uscite", "soll", "paid out", "money out"],
  credit: ["credit", "bij", "inkomsten", "accrediti", "entrate", "haben", "paid in", "money in"],
  sign: ["af bij", "af/bij", "bij/af", "debit/credit", "credit/debit", "d/c", "c/d", "cd"],
  counterparty: ["naam tegenpartij", "naam / omschrijving", "naam/omschrijving", "naam", "tegenpartij", "counterparty", "name", "payee", "beneficiary", "beneficiario", "empfänger"],
  description: ["omschrijving-1", "omschrijving", "mededelingen", "description", "descrizione", "causale", "details", "reference", "memo", "verwendungszweck"],
  account: ["iban/bban", "rekening", "rekeningnummer", "account", "iban", "conto"],
  currency: ["munt", "muntsoort", "currency", "valuta", "währung"],
  entry: ["entry number", "omzetnummer", "numéro de mouvement", "numero de mouvement", "transaction id", "transactie-id", "transactie id"],
};

function norm(header: string) {
  return header.toLowerCase().replace(/\s+/g, " ").trim();
}

function findColumn(headers: string[], names: string[], taken: Set<number>) {
  const normalized = headers.map(norm);
  for (const name of names) {
    const i = normalized.findIndex((h, idx) => !taken.has(idx) && h === name);
    if (i >= 0) return i;
  }
  for (const name of names) {
    if (name.length < 4) continue;
    const i = normalized.findIndex((h, idx) => !taken.has(idx) && h.startsWith(name) && !h.startsWith("tegen"));
    if (i >= 0) return i;
  }
  return null;
}

// Guesses the columns from header names. Returns null when unsure.
export function guessMapping(rows: string[][]): Mapping | null {
  for (let headerRow = 0; headerRow < Math.min(rows.length, 15); headerRow++) {
    const headers = rows[headerRow];
    const taken = new Set<number>();
    const pick = (names: string[]) => {
      const i = findColumn(headers, names, taken);
      if (i !== null) taken.add(i);
      return i;
    };
    const entry = pick(HEADERS.entry);
    const date = pick(HEADERS.date);
    const sign = pick(HEADERS.sign);
    const amount = pick(HEADERS.amount);
    const debit = amount === null ? pick(HEADERS.debit) : null;
    const credit = amount === null ? pick(HEADERS.credit) : null;
    if (date === null || (amount === null && (debit === null || credit === null))) continue;
    const counterparty = pick(HEADERS.counterparty);
    const description = pick(HEADERS.description);
    const account = pick(HEADERS.account);
    const currency = pick(HEADERS.currency);
    const dateFormat = detectDateFormat(rows.slice(headerRow + 1).map((r) => r[date] ?? ""));
    if (!dateFormat) continue;
    return { headerRow, date, amount, debit, credit, sign, counterparty, description, account, currency, entry, dateFormat };
  }
  return null;
}

export function detectDateFormat(values: string[]): DateFormat | null {
  const sample = values.filter(Boolean).slice(0, 50);
  if (!sample.length) return null;
  if (sample.every((v) => /^\d{8}$/.test(v))) return "compact";
  if (sample.every((v) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(v))) return "ymd";
  const parts = sample.map((v) => /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(v));
  if (parts.some((p) => !p)) return null;
  if (parts.some((p) => Number(p![2]) > 12)) return "mdy";
  return "dmy";
}

export function parseDate(value: string, format: DateFormat): string | null {
  let y: number, m: number, d: number;
  const v = value.trim();
  if (format === "compact") {
    if (!/^\d{8}$/.test(v)) return null;
    [y, m, d] = [Number(v.slice(0, 4)), Number(v.slice(4, 6)), Number(v.slice(6, 8))];
  } else {
    const p = v.split(/[-/.\sT]/).map(Number);
    if (p.length < 3 || p.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
    if (format === "ymd") [y, m, d] = p;
    else if (format === "dmy") [d, m, y] = p;
    else [m, d, y] = p;
    if (y < 100) y += 2000;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export type ParsedTransaction = {
  account: string | null;
  booked_on: string;
  amount: number;
  currency: string;
  counterparty: string | null;
  description: string | null;
  bank_ref: string | null;
};

const OUTGOING = /^(af|d|db|debit|debet|uit|out|-|addebito|s|soll)$/i;
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9 ]{8,30}$/;

// Some banks (ING Belgium) only give the other side's IBAN and bury the name
// in the description. Pulls a readable name out of the usual phrasings.
export function nameFromDescription(text: string): string | null {
  const transfer = /\b(?:To|From|In favour of|Naar|Van|Ten gunste van|À|De|En faveur de):\s*(.+?)\s+-\s+[A-Z]{2}\d{2}[A-Z0-9]/.exec(text);
  if (transfer) return transfer[1].trim();
  const debit = /^(?:Direct debit in euro \(SEPA\)|Europese domiciliëring \(SEPA\)|Domiciliation européenne \(SEPA\))\s+(.+?)\s+(?:Advice here with|Bericht hierbij|Avis ci-joint)/i.exec(text);
  if (debit) return debit[1].trim();
  // "Payment Debit Mastercard 23/09/26 - 7.21 pm - SPOORLOOS PERRON 9000 - GENT - BEL …"
  const card = /^(?:Payment|Betaling|Paiement)\b.*?\d{2}\/\d{2}\/\d{2}\s+-\s+[\d.:]+\s*(?:am|pm|u)?\s+-\s+(.+?)\s+-\s/i.exec(text);
  if (card) {
    const name = card[1].replace(/(\s+\S*\d\S*)+$/, "").trim();
    return name || null;
  }
  if (/^(?:Breakdown of charges|Detail van de kosten|Détail des frais)\b/i.test(text)) return "ING";
  return null;
}

export function applyMapping(rows: string[][], mapping: Mapping): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  const cell = (row: string[], i: number | null) => (i === null ? "" : (row[i] ?? "").trim());
  for (const row of rows.slice(mapping.headerRow + 1)) {
    const booked_on = parseDate(cell(row, mapping.date), mapping.dateFormat);
    if (!booked_on) continue;

    let amount: number | null;
    if (mapping.amount !== null) {
      amount = parseAmount(cell(row, mapping.amount));
      if (amount !== null && mapping.sign !== null && OUTGOING.test(cell(row, mapping.sign))) amount = -Math.abs(amount);
    } else {
      const debit = parseAmount(cell(row, mapping.debit)) ?? 0;
      const credit = parseAmount(cell(row, mapping.credit)) ?? 0;
      amount = credit ? Math.abs(credit) : debit ? -Math.abs(debit) : null;
    }
    if (amount === null || amount === 0) continue;

    const currency = cell(row, mapping.currency).toUpperCase();
    const description = cell(row, mapping.description).replace(/\s+/g, " ");
    let counterparty = cell(row, mapping.counterparty).replace(/\s+/g, " ");
    if (!counterparty || IBAN.test(counterparty)) counterparty = nameFromDescription(description) ?? counterparty;
    out.push({
      account: cell(row, mapping.account) || null,
      booked_on,
      amount,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "EUR",
      counterparty: counterparty || null,
      description: description.slice(0, 500) || null,
      bank_ref: cell(row, mapping.entry ?? null) || null,
    });
  }
  return out;
}

// Same line in two overlapping exports → same fingerprint. With the bank's
// own id per line (ING's entry number) the fingerprint rests on that alone, so
// it holds however descriptions are read.
export async function fingerprints(txs: ParsedTransaction[]) {
  const legacy = await legacyFingerprints(txs);
  return Promise.all(
    txs.map((tx, i) =>
      tx.bank_ref ? sha256([ "ref", tx.account ?? "", tx.booked_on, tx.amount.toFixed(2), tx.bank_ref].join("|").toLowerCase()) : legacy[i],
    ),
  );
}

// Built from the parsed details; identical lines within one export (two
// coffees on one day) are told apart by their order. Lines imported before
// bank ids were read carry this fingerprint.
export async function legacyFingerprints(txs: ParsedTransaction[]) {
  const seen = new Map<string, number>();
  return Promise.all(
    txs.map((tx) => {
      const base = [tx.account ?? "", tx.booked_on, tx.amount.toFixed(2), tx.currency, tx.counterparty ?? "", tx.description ?? ""].join("|").toLowerCase();
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return sha256(`${base}|${n}`);
    }),
  );
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ----- Matching -----------------------------------------------------------------

export type Match = { txId: string; docId: string; score: number; sure: boolean };

const STOP_WORDS = new Set(["bv", "b.v", "nv", "srl", "spa", "gmbh", "ltd", "inc", "llc", "the", "and", "via", "van", "de", "het", "www", "com", "nl", "eu", "payment", "betaling"]);

function tokens(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

// Share of the vendor's name found in the bank line (0–1).
export function nameScore(vendor: string | null, tx: Pick<Transaction, "counterparty" | "description">) {
  const wanted = tokens(vendor ?? "");
  if (!wanted.length) return 0;
  const haystack = `${tx.counterparty ?? ""} ${tx.description ?? ""}`.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const squashed = haystack.replace(/[^a-z0-9]/g, "");
  const found = wanted.filter((t) => haystack.includes(t) || squashed.includes(t)).length;
  return found / wanted.length;
}

function daysBetween(fromIso: string, toIso: string) {
  return (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000;
}

// The bank amount a document should show up as: expenses leave, income arrives.
export function expectedAmount(doc: Pick<Doc, "total" | "category">) {
  if (doc.total == null) return null;
  return doc.category === "Income" ? doc.total : -doc.total;
}

// Pairs open lines with unlinked receipts. Every pair waits for approval;
// `sure` ones (unambiguous) can be approved in one go.
export function findMatches(txs: Transaction[], docs: Doc[], dismissed: Set<string> = new Set()): Match[] {
  const linked = new Set(txs.map((t) => t.document_id).filter(Boolean) as string[]);
  const openTxs = txs.filter((t) => t.status === "unmatched");
  const openDocs = docs.filter((d) => !linked.has(d.id) && d.status === "ready" && d.total != null);

  const pairs: (Match & { amountExact: boolean })[] = [];
  for (const tx of openTxs) {
    for (const doc of openDocs) {
      if (dismissed.has(`${tx.id}:${doc.id}`)) continue;
      // A card statement is paid from the bank account, never by the card itself.
      if (doc.doc_type === "statement" && tx.source !== "bank") continue;
      const lag = daysBetween(doc.doc_date, tx.booked_on); // paid after the document date
      if (lag < -7 || lag > 60) continue;
      const names = nameScore(doc.vendor, tx);
      const sameCurrency = (doc.currency ?? "EUR") === tx.currency;
      const expected = expectedAmount(doc)!;
      const amountExact = sameCurrency && Math.abs(tx.amount - expected) < 0.005;
      // Foreign-currency receipts: amounts differ, so rely on name and date.
      const foreign = !sameCurrency && Math.sign(tx.amount) === Math.sign(expected) && names >= 0.5 && lag >= -2 && lag <= 7;
      if (!amountExact && !foreign) continue;
      const score = (amountExact ? 2 : 0) + names + 0.5 * (1 - Math.min(Math.abs(lag), 60) / 60);
      pairs.push({ txId: tx.id, docId: doc.id, score, sure: false, amountExact });
    }
  }

  // Count candidates per side to know when an exact amount is unambiguous.
  const perTx = new Map<string, number>();
  const perDoc = new Map<string, number>();
  for (const p of pairs) {
    if (!p.amountExact) continue;
    perTx.set(p.txId, (perTx.get(p.txId) ?? 0) + 1);
    perDoc.set(p.docId, (perDoc.get(p.docId) ?? 0) + 1);
  }

  pairs.sort((a, b) => b.score - a.score);
  const usedTx = new Set<string>();
  const usedDoc = new Set<string>();
  const matches: Match[] = [];
  for (const p of pairs) {
    if (usedTx.has(p.txId) || usedDoc.has(p.docId)) continue;
    usedTx.add(p.txId);
    usedDoc.add(p.docId);
    const tx = openTxs.find((t) => t.id === p.txId)!;
    const doc = openDocs.find((d) => d.id === p.docId)!;
    const lag = daysBetween(doc.doc_date, tx.booked_on);
    const unique = perTx.get(p.txId) === 1 && perDoc.get(p.docId) === 1;
    // Exact amount plus either the vendor's name, or a unique amount paid within a week.
    const sure = p.amountExact && lag >= -3 && lag <= 30 && (nameScore(doc.vendor, tx) >= 0.5 || (unique && lag <= 7));
    matches.push({ txId: p.txId, docId: p.docId, score: p.score, sure });
  }
  return matches;
}
