# Status

_Last updated: 2026-10-02 by the handoff of session 3._

## Live now (`main` = production, commit `6746049`)

| Area | What works |
| --- | --- |
| Documents | Scan, upload, drag-and-drop; Claude reads the details; list defaults to **Recently added** (or *By document date*); search and filters; **From email** button; **Download** = month/quarter picker → ZIP with `Summary.xlsx` (incl. *Paid* column) + a folder per month, PDFs only, card statements optional; a selection downloads as is; booked tick |
| Email inbox | admin@tiltedi.com connected (Gmail API, read-only). New mail listed for review; tick attachments or "The email itself (as PDF)"; Import / Skip / Import all; nothing read by Claude before Import |
| Reading | Receipts/invoices: Claude Sonnet 5.5. Card statements: Claude Opus 5.5. Cost per read stored |
| Bank / Card | ING CSV import (dedupe by entry number), card statements → card lines, tabs Missing / To approve / Matched / No receipt needed / Receipts not in bank |
| Matching | Approval queue (never silent). **Covers several payments** documents (policy, contract, loan) are offered for every instalment of the same payee. Deleting a document frees its lines (DB trigger) |
| Rules, billing pages | As before (6 no-receipt rules; billing-portal links) |
| Look | Dark by default, sand accent; Account → Appearance (Dark / Light / Device) |

## Production data (2026-10-01, end of session 2)

- 52 documents (2 marked "covers several payments"), none booked yet.
- 130 bank + card lines: 45 matched, 39 no receipt needed, 46 open.
- Inbox: 1 mailbox (admin@tiltedi.com); 6 emails imported, 4 skipped, 0 pending.
- Schema added this session: `mail_connections`, `inbox_items` (`20261001190418`), trigger
  `unmatch_without_document` (`20261001201204`), `documents.recurring` (`20261001203515`).

## Open items / waiting on the user

- **UI refresh** (session 3) is only on branch `claude/jolly-wozniak-8dlm36`, not live. User to try the Vercel
  preview (phone + laptop) and say "push to main". Same functionality; adds the `motion` library (~56 KB gzip).
- Try **Download by month** on real Q3 data and say how the ZIP works in the accounting tool (folder names,
  card statements in month folders, PDFs).
- LRS policy: link the first €604.87 payment (3 Jul) by hand if not done; check the next instalment is offered.
- July card statement ↔ bank line 16 Jul €565.91 still to approve; many lines still need receipts.
- Gmail forwarding to admin@: user uses a local Chrome extension ("Send to accounting", deliberately not in the
  repo; the user has the zip). Gmail filters also possible (needs the forwarding address verified).
- Home-screen icon on the phone may still be green until the app is re-added.

## Ideas offered but not built

- "Is the quarter complete?" check in the Download window (payments without receipt in the chosen months).
- Payments sheet in the ZIP (every bank/card line of the period with its receipt or no-receipt reason).
- Send the package straight to the accountant (ask whether WinAuditor has an inbox address).
- Euro amounts for foreign-currency invoices from the matched bank line.
- Auto-import from trusted senders; invoices that are only a link.
- "New" label for freshly imported bank lines; back to the requested page after login.

## Last session (2026-10-02, session 3)

UI refresh only, no functional or data changes: 21st.dev-style tabs, toasts, sheets, empty states and sign-in;
`motion` animations (dialogs slide in/out, phone sheets drag to close, nav pill glides, handled lines
collapse); skeleton loading pages. Fixed a reopen race in `dialog.tsx`. e2e 85/85. Not pushed to `main`.
