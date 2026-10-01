// Server-only: reads the accounting mailbox through the Gmail API (read-only
// scope). The refresh token is stored encrypted with a key derived from the
// OAuth client secret, so the database alone can't be used to read mail.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { InboxAttachment } from "@/lib/inbox";

const AUTH_URL = process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const API_URL = process.env.GMAIL_API_URL || "https://gmail.googleapis.com/gmail/v1";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export class GmailError extends Error {}

function client() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new GmailError("Email inbox isn't set up yet (Google client id and secret missing).");
  return { id, secret };
}

export function gmailConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// ----- Token storage -------------------------------------------------------------

function key() {
  return createHash("sha256").update(`inbox-token:${client().secret}`).digest();
}

export function sealToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function openToken(sealed: string) {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1") throw new GmailError("Unknown token format; connect the inbox again.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new GmailError("The inbox connection can't be read (the Google secret changed?). Connect it again.");
  }
}

// ----- OAuth ---------------------------------------------------------------------

export function authUrl(redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function token(params: Record<string, string>) {
  const { id, secret } = client();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
  if (!response.ok || !body.access_token) {
    if (body.error === "invalid_grant") throw new GmailError("Google no longer accepts the inbox connection. Connect it again.");
    throw new GmailError(`Google sign-in failed (${body.error ?? response.status}).`);
  }
  return body;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const body = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  if (!body.refresh_token) throw new GmailError("Google didn't grant lasting access. Try connecting again.");
  const profile = await api<{ emailAddress: string }>(body.access_token!, "/users/me/profile");
  return { refreshToken: body.refresh_token, email: profile.emailAddress.toLowerCase() };
}

export async function accessToken(sealedRefreshToken: string) {
  return (await token({ grant_type: "refresh_token", refresh_token: openToken(sealedRefreshToken) })).access_token!;
}

// ----- Gmail API -------------------------------------------------------------------

async function api<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GmailError(`Gmail: ${body.error?.message ?? response.status}`);
  }
  return response.json() as Promise<T>;
}

// Message ids matching a Gmail search, newest first.
export async function listMessages(accessToken: string, query: string, max = 50) {
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const params = new URLSearchParams({ q: query, maxResults: String(Math.min(max, 100)) });
    if (page) params.set("pageToken", page);
    const result = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(accessToken, `/users/me/messages?${params}`);
    ids.push(...(result.messages ?? []).map((m) => m.id));
    page = result.nextPageToken;
  } while (page && ids.length < max);
  return ids.slice(0, max);
}

type Part = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number };
  parts?: Part[];
};

type Message = { id: string; internalDate: string; snippet?: string; payload: Part };

export type MailMessage = {
  id: string;
  receivedAt: string;
  sender: string | null;
  subject: string | null;
  snippet: string | null;
  attachments: InboxAttachment[];
};

const IMAGE = /^image\/(jpeg|png|webp|gif|heic|heif)$/;
const TYPES: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

// PDFs and pictures; Gmail often labels attachments application/octet-stream.
function documentType(part: Part) {
  const mime = (part.mimeType ?? "").toLowerCase();
  if (mime === "application/pdf" || IMAGE.test(mime)) return mime;
  const extension = part.filename?.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[extension] ?? null;
}

function header(part: Part, name: string) {
  return part.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? null;
}

function walk(part: Part, out: Part[] = []) {
  if (part.body?.attachmentId && part.filename) out.push(part);
  for (const child of part.parts ?? []) walk(child, out);
  return out;
}

function decodeEntities(text: string) {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[m] ?? m);
}

export async function getMessage(accessToken: string, id: string): Promise<MailMessage> {
  const message = await api<Message>(accessToken, `/users/me/messages/${id}?format=full`);
  const attachments: InboxAttachment[] = [];
  for (const part of walk(message.payload)) {
    const mime = documentType(part);
    if (!mime || !part.partId) continue;
    const size = part.body?.size ?? 0;
    // Pictures in a signature or layout are inline; real attachments aren't.
    const inline = /^inline/i.test(header(part, "content-disposition") ?? "") || Boolean(header(part, "content-id"));
    const suggested = mime === "application/pdf" || (!inline && size > 20_000);
    attachments.push({ part: part.partId, filename: part.filename!, mime, size, suggested });
  }
  return {
    id: message.id,
    receivedAt: new Date(Number(message.internalDate)).toISOString(),
    sender: header(message.payload, "from"),
    subject: header(message.payload, "subject"),
    snippet: message.snippet ? decodeEntities(message.snippet) : null,
    attachments,
  };
}

// An attachment's bytes, found by part id (Gmail's attachment ids change between reads).
export async function getAttachment(accessToken: string, messageId: string, partId: string) {
  const message = await api<Message>(accessToken, `/users/me/messages/${messageId}?format=full`);
  const part = walk(message.payload).find((p) => p.partId === partId);
  if (!part) throw new GmailError("That attachment is no longer in the email.");
  const body = await api<{ data: string }>(accessToken, `/users/me/messages/${messageId}/attachments/${part.body!.attachmentId}`);
  return { bytes: Buffer.from(body.data, "base64url"), filename: part.filename!, mime: documentType(part) ?? "application/octet-stream" };
}
