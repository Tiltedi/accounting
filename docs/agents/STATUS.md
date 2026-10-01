# Status

_Last updated: 2026-10-01 by the handoff of session 1 (build-out sessions 2026-09-29 → 2026-10-01)._

## Live now (`main` = production, commit `2248f22`)

| Area | What works |
| --- | --- |
| Documents | Scan (phone camera → multi-page PDF), upload, drag-and-drop anywhere; Claude reads vendor, date, total, VAT, currency, invoice no., category; search, date range, category and status filters; ZIP download with `Summary.xlsx`; "Booked in accounting" tick + "mark as booked?" after download |
| Reading | Receipts/invoices: **Claude Sonnet 5.5**. Card statements: **Claude Opus 5.5**. Cost per read stored; monthly total in the account menu |
| Bank | Import ING Belgium CSV (any CSV; Claude maps unknown layouts). Dedupe by ING entry number (`bank_ref`). Payee names pulled out of ING descriptions. Tabs: Missing receipt / To approve / Matched / No receipt needed / Receipts not in bank |
| Card | Upload the credit-card statement PDF (or CSV); Claude lists purchases as card lines; statement is a document matched to the "Payment ING : MASTERCARD" bank line; Statements tab |
| Matching | Never linked silently: suggestions wait under **To approve**; "Approve all" for sure ones; dropping/uploading a receipt anywhere offers its payment with an **Approve** button; header badges count pending approvals |
| Rules | No-receipt rules (6 seeded: ING fees, SD Worx, Radius, salary, rent, car loan) applied on import; "Always for …" adds one; listed/removable under No receipt needed |
| Billing pages | Per-supplier billing-portal links ("Add billing page" on missing lines); Missing tab lists portals to visit |

## Production data (2026-10-01)

- Bank account BE60… (ING): 97 lines, July–Sept 2026, all with `bank_ref`; 25 matched, 38 no receipt needed, 34 open.
- Card statements: July (€565.91, 19 lines), Aug (€349.64, 10), Sept (€236.02, 4); Aug and Sept linked to their bank payment; July's waits under To approve.
- ~10 receipts uploaded (Sept 2026 scans).

## Open items / waiting on the user

- July card statement ↔ bank line 16 Jul €565.91: user to approve under Bank → To approve.
- Many card lines and ~34 bank lines still need receipts (user's ongoing work).
- WinAuditor (accountant's tool): no public API found. Idea: ask the accountant whether the WinAuditor file has an inbox e-mail for purchase invoices → app could forward matched receipts. Not started.

## Ideas offered but not built

- "New" label (or filter) for lines from the latest import.
- Skip the storage upload→download round trip when reading (~1 s faster per receipt).
- Send the user back to the requested page after login (today login always lands on Documents).
- Read-only bank connection (Ponto/PSD2) — user declined connecting the bank; don't push it.

## Last session (2026-09-29 → 2026-10-01)

Built the whole app, then bank/card reconciliation, rules, approval queue, billing links, drag-and-drop
everywhere, Sonnet switch (tested on 10 real receipts), entry-number fingerprints (+ converted the 97 live
lines), and this memory system + repo-based e2e harness.
