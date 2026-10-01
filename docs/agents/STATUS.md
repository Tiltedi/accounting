# Status

_Last updated: 2026-10-01 by session 2 (download by month, email inbox)._

## Live now (`main` = production; inbox commit `08a0f5c`)

| Area | What works |
| --- | --- |
| Documents | Scan (phone camera → multi-page PDF), upload, drag-and-drop anywhere; Claude reads vendor, date, total, VAT, currency, invoice no., category; search, date range, category and status filters; **Download by month** (no selection → month/quarter picker → ZIP with `Summary.xlsx` + a folder per month, PDFs only, card statements optional) or a selection as is; "Booked in accounting" tick + "mark as booked?" after download |
| Reading | Receipts/invoices: **Claude Sonnet 5.5**. Card statements: **Claude Opus 5.5**. Cost per read stored; monthly total in the account menu |
| Bank | Import ING Belgium CSV (any CSV; Claude maps unknown layouts). Dedupe by ING entry number (`bank_ref`). Payee names pulled out of ING descriptions. Tabs: Missing receipt / To approve / Matched / No receipt needed / Receipts not in bank |
| Card | Upload the credit-card statement PDF (or CSV); Claude lists purchases as card lines; statement is a document matched to the "Payment ING : MASTERCARD" bank line; Statements tab |
| Matching | Never linked silently: suggestions wait under **To approve**; "Approve all" for sure ones; dropping/uploading a receipt anywhere offers its payment with an **Approve** button; header badges count pending approvals |
| Rules | No-receipt rules (6 seeded: ING fees, SD Worx, Radius, salary, rent, car loan) applied on import; "Always for …" adds one; listed/removable under No receipt needed |
| Billing pages | Per-supplier billing-portal links ("Add billing page" on missing lines); Missing tab lists portals to visit |

## Production data (2026-10-01)

- Bank account BE60… (ING): 97 lines, July–Sept 2026, all with `bank_ref`; 25 matched, 38 no receipt needed, 34 open.
- Card statements: July (€565.91, 19 lines), Aug (€349.64, 10), Sept (€236.02, 4); Aug and Sept linked to their bank payment; July's waits under To approve.
- 43 documents, all PDF, dated Jul–Sep 2026: 40 invoices/receipts + the 3 card statements; none marked booked.

## Open items / waiting on the user

- **Email inbox**: live and connected to admin@tiltedi.com (Google Workspace invoice imported from it).
  "The email itself (as PDF)" is live (user imported the Q2 VAT email; Claude read and matched it).
  Nicer email PDF layout + account-menu "Open" fix: live.
- Unmatch-on-delete trigger: applied to production; the stuck VAT line (21 Jul, €2,145.43) reset to unmatched.
- "Covers several payments" (recurring documents): live (migration `20261001203515`). User's LRS policy
  email waits in the inbox to try it; not yet tried on real data. Google OAuth client (Internal) created by the user; support
  email luca@tiltedi.com; `GOOGLE_CLIENT_ID`/`SECRET` set in Vercel production.
- Gmail → admin@ forwarding: user has a local Chrome extension ("Send to accounting", not in the repo) that
  clicks Gmail's Forward; tested by the user once (Google Workspace invoice arrived with its PDF).

- Download by month is live but not yet tried by the user on real documents; ask how the ZIP worked in
  the accounting tool (folder names, card statements, PDFs) and adjust.
- July card statement ↔ bank line 16 Jul €565.91: user to approve under Bank → To approve.
- Many card lines and ~34 bank lines still need receipts (user's ongoing work).
- WinAuditor (accountant's tool): no public API found. Idea: ask the accountant whether the WinAuditor file has an inbox e-mail for purchase invoices → app could forward matched receipts. Not started.

## Ideas offered but not built

- "New" label (or filter) for lines from the latest import.
- Skip the storage upload→download round trip when reading (~1 s faster per receipt).
- Send the user back to the requested page after login (today login always lands on Documents).
- Read-only bank connection (Ponto/PSD2) — user declined connecting the bank; don't push it.

## Last session (2026-10-01, session 2)

Email inbox with approval (Gmail API, read-only; `inbox-dialog.tsx`, `/api/inbox/*`, `run-inbox.js`).

Download by month for the accounting tool: month/quarter picker, ZIP with a folder per month (PDFs only,
pictures converted), card statements optional, summary on top. New `download-dialog.tsx`, `byMonth` option
in `downloadZip`; e2e steps in `run.js` and `run-bank.js` (67 checks green). Pushed to `main` on the user's
go-ahead. Production data untouched (read-only checks: 43 documents Jul–Sep 2026, all PDFs, 3 statements).
