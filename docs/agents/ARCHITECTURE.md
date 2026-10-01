# Architecture

Next.js 16 App Router (read `node_modules/next/dist/docs/` before using unfamiliar APIs — this version
differs from older training data: `proxy.ts` instead of middleware, async `cookies()`/`searchParams`,
`error.tsx` gets `retry`). Supabase (auth, Postgres with RLS, storage). Claude via `@anthropic-ai/sdk`.
Tailwind v4 theme tokens in `src/app/globals.css`. Vercel region `dub1` (`vercel.json`).

## Pages

| Route | File | What |
| --- | --- | --- |
| `/` | `src/components/dashboard.tsx` | Documents: upload, scan, drop, list, filters, download by month or selection, booked status |
| `/bank` | `src/components/bank-view.tsx` (`source="bank"`) | Bank lines: tabs, import CSV, rules, billing links, approvals |
| `/card` | same component, `source="card"` | Card lines + Statements tab |
| `/login` | `src/app/login/*` | Email + password (Supabase). Sign-up is blocked in the DB |

Server pages (`src/app/*/page.tsx`) load all rows (`fetchAllDocuments`, `fetchAllTransactions`, `fetchRules`,
`fetchVendorLinks`) and pass them to client components, which keep them in state.

## API routes

- `src/app/api/extract/route.ts` — reads a stored document. Receipts → `extractDocument` (Sonnet). If the
  read says `card_statement`, marks the doc and returns `notice: "card_statement"`; client then calls again
  with `kind: "card_statement"` → `extractCardStatement` (Opus) → `saveCardLines` (applies rules server-side).
- `src/app/api/bank-columns/route.ts` — Claude maps columns of an unknown CSV from 25 sample rows.
- `src/app/api/inbox/*` — email inbox: `connect` (Google consent, state cookie) → `callback` (stores the
  refresh token sealed with AES-GCM, key from `GOOGLE_CLIENT_SECRET`) · `sync` (lists `in:inbox` mail since
  last check −2 days, first time 60 days; new ones become pending `inbox_items`) · `file` (shows an
  attachment) · `import` (stores chosen attachments as documents, sha256 dedupe, closes the item). The
  browser then reads new documents as for uploads. Gmail calls in `src/lib/gmail.ts` (plain fetch).

## Library map (`src/lib`)

| File | Role |
| --- | --- |
| `extraction.ts` | Prompts, Zod schemas, model choice (`RECEIPT_MODEL`, `STATEMENT_MODEL`), per-model pricing → `ai_cost_usd` |
| `bank.ts` | CSV parsing, header guessing (`HEADERS`), ING name extraction (`nameFromDescription`), fingerprints, rules (`ruleFor`), billing links (`linkFor`), matching (`findMatches`), dismissed suggestions (localStorage) |
| `bank-import.ts` | `importStatement` (dedupe incl. legacy fingerprints), `applyRules`, `approveMatches`, `linkTransaction`, `readCardStatement` |
| `inbox.ts` / `gmail.ts` / `inbox-server.ts` | Inbox types + `fetchInbox` · Gmail API, OAuth, token sealing (server) · route helpers |
| `upload.ts` | `prepareFile` (image → JPEG), `uploadDocument` (SHA-256 dedupe → `DuplicateError`), `requestExtraction` |
| `files.ts` / `zip.ts` / `xlsx.ts` / `export.ts` | Client-side JPEG/PDF building, ZIP and XLSX writers, downloads (`downloadZip`, `byMonth` option) |
| `use-file-drop.ts` | Page-wide drop hook (Documents, Bank, Card) |
| `documents.ts`, `format.ts`, `dates.ts`, `categories.ts` | Types/columns, money/date formatting, presets, categories and doc types |
| `supabase/*` | Browser/server clients and session refresh used by `src/proxy.ts` |

Components worth knowing: `match-offer.ts` (toast offering a receipt's payment with Approve),
`attach-dialog.tsx`, `billing-dialog.tsx`, `document-panel.tsx`, `download-dialog.tsx` (month picker),
`inbox-dialog.tsx` (emails to review + the strip above the list),
`toaster.tsx` (popover, top layer).

## Data model (`supabase/migrations/`, types in `src/lib/database.types.ts`)

- `documents` — `recurring` = covers several payments (policy, contract, loan; matched to many lines);
  file + extracted fields; `status` processing/ready/failed; `doc_type` incl. `statement`;
  `sha256` unique; `booked_at`; `ai_cost_usd`; `extraction` jsonb.
- `bank_transactions` — `source` bank/card; `amount` negative = money out; `status` unmatched/matched/no_receipt;
  `document_id` (the receipt), `statement_id` (card lines → their statement, cascade delete);
  `note` (rule label); `bank_ref` (bank's own line id); `fingerprint` unique.
- `bank_rules` — field counterparty/description, pattern, exact, label.
- `vendor_links` — pattern → billing-portal URL.
- `mail_connections` — one mailbox (`email`, sealed `refresh_token`, `last_checked_at`).
- `inbox_items` — one per email (`gmail_id` unique): sender, subject, snippet, `attachments` jsonb
  `[{part, filename, mime, size, suggested}]`, `status` pending/imported/skipped, `document_ids`.
- `private.members` — email allowlist; `private.is_member()` gates every RLS policy; sign-ups blocked by trigger.
- Storage bucket `documents` (private, 25 MB).

## Key behaviours

- **Fingerprint**: with `bank_ref` → sha256(`ref|account|date|amount|bank_ref`); else legacy
  sha256(account|date|amount|currency|counterparty|description|occurrence). Import also checks legacy prints,
  so changing the scheme never duplicates. Changing `nameFromDescription` changes legacy prints → only safe
  for files that carry an entry number.
- **Matching** (`findMatches`): exact amount (same currency) or foreign currency with name match, date window
  −7…+60 days; `sure` = exact amount and (name ≥ 0.5 or unique within 7 days). Card statements only match
  bank lines. Nothing is linked without approval. `recurring` documents never get used up: offered (as sure)
  for lines of the same payee (name ≥ 0.5) whose amount equals the total or an amount already linked to
  them, −7…+400 days; the receipt picker lists them even when linked.
- **Deleting a document** frees its lines: FK sets `document_id` null and the trigger
  `private.unmatch_without_document` turns `matched` back to `unmatched` (migration `20261001201204`).
- **Totals** skip `doc_type = statement` (their purchases have their own receipts).
- **Inbox**: checked when Documents opens and when the app comes back into view (no cron: importing needs
  the user anyway). Suggested ticks: PDFs, and pictures that aren't inline (signatures) and > 20 KB.
  Attachments are found by part id at import (Gmail attachment ids change between reads). Every email also
  offers part `email` = the email itself as a PDF (`email-pdf.ts`, pdf-lib + Helvetica: subject title,
  From/To/Date, forwarded emails unwrapped to the original, `*bold*` kept, link addresses and signature
  pictures dropped; fixed dates so the same email gives the same bytes),
  never ticked by default — for documents that are only an email (e.g. the accountant's VAT payment request).
- **Download** (Documents toolbar): with a selection, downloads it as is (one file, or a flat ZIP). Without,
  opens the month picker (default: last full quarter; choice kept while the page is open) →
  `downloadZip(…, { byMonth: true })`: `Summary.xlsx` on top, then `2026-07 July/…` folders holding only
  documents, oldest first; images become one-page PDFs (original kept if the browser can't decode it);
  statements named `… card statement …`, included unless unticked. Afterwards: "Mark N as booked?".
