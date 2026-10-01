# Architecture

Next.js 16 App Router (read `node_modules/next/dist/docs/` before using unfamiliar APIs — this version
differs from older training data: `proxy.ts` instead of middleware, async `cookies()`/`searchParams`,
`error.tsx` gets `retry`). Supabase (auth, Postgres with RLS, storage). Claude via `@anthropic-ai/sdk`.
Tailwind v4 theme tokens in `src/app/globals.css`. Vercel region `dub1` (`vercel.json`).

## Pages

| Route | File | What |
| --- | --- | --- |
| `/` | `src/components/dashboard.tsx` | Documents: upload, scan, drop, list, filters, ZIP, booked status |
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

## Library map (`src/lib`)

| File | Role |
| --- | --- |
| `extraction.ts` | Prompts, Zod schemas, model choice (`RECEIPT_MODEL`, `STATEMENT_MODEL`), per-model pricing → `ai_cost_usd` |
| `bank.ts` | CSV parsing, header guessing (`HEADERS`), ING name extraction (`nameFromDescription`), fingerprints, rules (`ruleFor`), billing links (`linkFor`), matching (`findMatches`), dismissed suggestions (localStorage) |
| `bank-import.ts` | `importStatement` (dedupe incl. legacy fingerprints), `applyRules`, `approveMatches`, `linkTransaction`, `readCardStatement` |
| `upload.ts` | `prepareFile` (image → JPEG), `uploadDocument` (SHA-256 dedupe → `DuplicateError`), `requestExtraction` |
| `files.ts` / `zip.ts` / `xlsx.ts` / `export.ts` | Client-side JPEG/PDF building, ZIP and XLSX writers, downloads |
| `use-file-drop.ts` | Page-wide drop hook (Documents, Bank, Card) |
| `documents.ts`, `format.ts`, `dates.ts`, `categories.ts` | Types/columns, money/date formatting, presets, categories and doc types |
| `supabase/*` | Browser/server clients and session refresh used by `src/proxy.ts` |

Components worth knowing: `match-offer.ts` (toast offering a receipt's payment with Approve),
`attach-dialog.tsx`, `billing-dialog.tsx`, `document-panel.tsx`, `toaster.tsx` (popover, top layer).

## Data model (`supabase/migrations/`, types in `src/lib/database.types.ts`)

- `documents` — file + extracted fields; `status` processing/ready/failed; `doc_type` incl. `statement`;
  `sha256` unique; `booked_at`; `ai_cost_usd`; `extraction` jsonb.
- `bank_transactions` — `source` bank/card; `amount` negative = money out; `status` unmatched/matched/no_receipt;
  `document_id` (the receipt), `statement_id` (card lines → their statement, cascade delete);
  `note` (rule label); `bank_ref` (bank's own line id); `fingerprint` unique.
- `bank_rules` — field counterparty/description, pattern, exact, label.
- `vendor_links` — pattern → billing-portal URL.
- `private.members` — email allowlist; `private.is_member()` gates every RLS policy; sign-ups blocked by trigger.
- Storage bucket `documents` (private, 25 MB).

## Key behaviours

- **Fingerprint**: with `bank_ref` → sha256(`ref|account|date|amount|bank_ref`); else legacy
  sha256(account|date|amount|currency|counterparty|description|occurrence). Import also checks legacy prints,
  so changing the scheme never duplicates. Changing `nameFromDescription` changes legacy prints → only safe
  for files that carry an entry number.
- **Matching** (`findMatches`): exact amount (same currency) or foreign currency with name match, date window
  −7…+60 days; `sure` = exact amount and (name ≥ 0.5 or unique within 7 days). Card statements only match
  bank lines. Nothing is linked without approval.
- **Totals** skip `doc_type = statement` (their purchases have their own receipts).
