# Decisions

Newest first. One entry per decision: what, why, and what would change it. Append; don't rewrite history.

## 2026-10-02 — Home page as the start page
User asked for a dashboard and chose all four parts (to-do, quarter check, spending charts, recent) and a new
start page. Home is `/`; Documents moved to `/documents` (inbox OAuth now returns there). The quarter check
answers "can the accountant have Qn?": share of bank and card lines that are matched or need no receipt (same
rules as the tabs, so numbers agree). Money out never counts a purchase twice (user: "obviously"): the bank line that pays a card statement is left
out, found by its link to the statement or else by the statement total paid within two months, whatever its
status or dismissed suggestions (live data checked: 3 statements, each paid by one linked bank line); charts count euros only and say how many other-currency items were skipped.
Charts are plain HTML in the sand accent, one series each, with a table view; no chart library. On phones Home is
a house icon and the logo is hidden so four sections fit at 360 px.

## 2026-10-02 — UI refresh: 21st.dev patterns and motion, same functionality
User asked for a smoother-feeling UI via the 21st.dev MCP, functionality unchanged. Kept the brand (paper/ink,
sand accent, dark default, Instrument Sans + Plex Mono) and adapted 21st.dev components: Animated Tabs (sliding
pill: Bank/Card tabs, header sections, Appearance), Toast (stacking, spring in, fade out), Drawer (phone
sheets drag down to close), Empty (fanned icon tiles), Text Shimmer ("Reading…"), minimal sign-in card.
Added the `motion` library (≈56 KB gzip more JS on Documents): exit animations (dialogs, toasts, handled bank
lines collapse) are impractical in React without it. Features load with the page (`LazyMotion` with `domMax`):
a lazy load re-rendered the provider during hydration and React dropped streamed HTML (hidden duplicate
content in `#S:0`). React `<ViewTransition>` was tried for page changes but never fires on Next 16.3.7
navigations (only in-page transitions), so the header pill uses a motion `layoutId` and pages rise in with CSS.
Every label, role and test hook was kept; all e2e checks pass, one inbox check now waits for the drawer to
finish closing (closing dialogs stay on screen ~0.3 s while they slide away). Revisit `ViewTransition` after a
Next upgrade; drop `motion` only if bundle size starts to matter.

## 2026-10-01 — Sand accent instead of green
User found the dark-mode green too intense; picked sand from three previews (soft blue, sand, lavender).
Dark accent #cfae84 on #20170c ink; light accent #8a6a40. App icons (svg + PNGs) recoloured to match.

## 2026-10-01 — Documents list: newest uploads first
User wants to find what they just added without searching. Default order is *Recently added* (by
`created_at`, groups "Added today/yesterday/<day>"); *By document date* (per month) is one select away and
remembered per device. Upload-day groups use UTC on the server render and local time after mount.

## 2026-10-01 — One document, several payments
Insurance policies, contracts and loans are paid in instalments (LRS: €604.87 per quarter, one policy PDF).
A "Covers several payments" switch on the document keeps it matchable; each later payment of the same payee
and an amount already paid against it is suggested under To approve. Summary.xlsx gets a "Paid" column.
Considered: splitting the document per payment (duplicates the file) or no-receipt rules (loses the
document the accountant needs).

## 2026-10-01 — Deleting a document unmatches its lines (DB trigger)
The FK's `on delete set null` left lines "matched" to nothing (user's VAT line got stuck; fixed: 1 row).
A trigger now resets status; the e2e mock already behaved this way, which hid the bug.

## 2026-10-01 — Email inbox with approval
Invoices are forwarded to admin@tiltedi.com (user's own Gmail forwarding or a local Chrome extension, kept
out of the repo). The app reads that mailbox with the Gmail API (internal Google OAuth app, `gmail.readonly`)
and lists new emails; nothing is imported or read by Claude until the user taps Import (user wants control
and cost stays at zero for skipped mail). Checked on open/return instead of a cron, since approval needs the
user anyway and a cron would need a service-role key. Rejected: paid inbound-mail service (Postmark).
Emails that are themselves the document (VAT payment requests) can be imported as a PDF of the email
(opt-in per email). Revisit: auto-import from trusted senders; invoices behind a link.

## 2026-10-01 — Download by month for the accounting tool
Documents → *Download* with nothing selected opens a month picker (default: last full quarter; Q1–Q4 toggle
three months). The ZIP has `Summary.xlsx` on top and one folder per month (`2026-07 July/`) holding only
documents, oldest first, so a month's folder can go into the accounting tool as is. Pictures become
one-page PDFs (user asked for PDFs; scans already are). Card statements are included, named
"… card statement …", with a tick box to leave them out. A selection still downloads as is (flat ZIP,
original files). Revisit once we know what the accounting tool wants (statements or sales apart, names).

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
