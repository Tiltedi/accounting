# Decisions

Newest first. One entry per decision: what, why, and what would change it. Append; don't rewrite history.

## 2026-10-01 — Agent memory lives in the repo
`CLAUDE.md` (auto-loaded index) + `docs/agents/*` + `/handoff` skill; e2e harness moved from the session
scratchpad into `e2e/`. Why: every cloud session starts in a fresh container. Test bank data is an anonymised
copy of the real ING export (real statements must not be committed).

## 2026-09-30 — Fingerprint by the bank's entry number
Lines with a bank id (`Entry number`/`Omzetnummer`/…) fingerprint on account+date+amount+id, stored in
`bank_ref`; import also checks legacy prints. The 97 live lines were converted after the code was live.
Why: legacy prints depend on how descriptions are parsed, so parser improvements could duplicate lines.

## 2026-09-30 — Sonnet 5.5 for receipts, Opus 5.5 for card statements
Side-by-side on 10 real receipts: Sonnet 96% vs Opus 95% of fields matching saved values, 3.0 s vs 4.9 s,
half the cost; the only real error was Opus's. Statements stay on Opus (harder, untested, rare).
Revisit if receipt accuracy drops — switch back is one constant in `src/lib/extraction.ts`.

## 2026-09-30 — Fast mode and smaller images rejected
Fast mode doubles price; downscaling scans barely saves time (output tokens dominate) and risks faded receipts.

## 2026-09-30 — Drop anything anywhere; offer the match with Approve
Any page accepts receipts, bank CSVs and card statements; statements are recognised by the reader
(`card_statement` flag → second request). A receipt's payment is offered in a toast with Approve.

## 2026-09-30 — Approval queue instead of auto-linking
User wants to approve every match. "Sure" matches are only pre-selected for one-tap "Approve all".

## 2026-09-30 — No-receipt rules
Payees that never need a receipt (bank fees, Peppol suppliers, salary, rent, car loan) are marked on import.
Rules apply at import and when a rule is created — not continuously, so "Needs receipt" undo sticks.

## 2026-09-30 — Card statements as documents + card lines
Statement PDF is stored as a document (`doc_type = statement`, excluded from totals) matched to the bank's
Mastercard settlement; its purchases are `bank_transactions` with `source = card`.

## 2026-09-29 — No bank connection
User declined PSD2/bank connections. Bank data arrives as CSV exports; WinAuditor has no usable public API.

## 2026-09-29 — Production branch is `main`
Vercel production first followed the feature branch (accidental); user switched it to `main`. Agents push
to `main` only when the user says so.

## 2026-09-29 — Stack
Next.js 16 + Supabase (auth, RLS by member allowlist, private storage) + Claude structured outputs with the
server-side refusal fallback; client-side image→PDF, ZIP and XLSX to keep the server thin.
