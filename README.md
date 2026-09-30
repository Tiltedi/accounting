# Accounting

Scan invoices and receipts, let Claude read and file them, and download
exactly what your accountant needs.

- **Scan** on your phone: take one or more photos, they become a single PDF.
- **Upload** PDFs or images on your laptop (button, or drop files anywhere).
- Each document is **read automatically**: vendor, date, total, VAT,
  currency, invoice number and a category.
- **Find** anything with the date range picker, category filter and search.
- **Download** one file, a selection, or everything in view as a ZIP with a
  `Summary.xlsx` listing every document.
- **Bank check** (no bank connection): import the CSV statement from your
  bank's website. Payments are matched to receipts; you see which payments
  lack a receipt, which receipts have no payment, and can mark lines that
  need none (fees, transfers). Re-importing overlapping statements never
  duplicates lines.
- **Card check**: upload a credit card statement (PDF, photo or CSV). Claude
  lists every purchase so each one can get its receipt; the statement itself
  is matched to the card settlement on the bank statement.
- **Approval queue**: suggested matches are never linked silently. They wait
  under *To approve*; unambiguous ones can be approved in one tap. The
  header shows how many wait.
- **Drop anything anywhere**: drop receipts, bank CSVs or card statements on
  any page. Statements are recognised wherever they land; a receipt is read
  and its payment offered with an *Approve* button (or drop it straight onto
  its line).
- **Rules**: lines from payees that never need a receipt (bank fees, salary,
  rent, suppliers that e-invoice via Peppol) are marked on import. Add one
  from any line with *Always for …*, remove it under *No receipt needed*.
- **Billing pages**: save a supplier's billing-portal link once (globe icon
  on a line); lines missing a receipt then link straight to it, and the
  *Missing receipt* tab lists every portal to visit.
- **Booked in accounting**: tick documents once they're in your accounting
  tool; filter by *Not booked*; after a download the app offers to mark them.
- **Reading cost**: each document stores what Claude charged; the monthly
  total is in the account menu.
- Installable on your phone's home screen. Works in light and dark mode.

## Stack

| Part | Where |
| --- | --- |
| App | Next.js 16 on Vercel (`dub1`, next to the database) |
| Login, database, files | Supabase project `hgappljfpkqhsnrruzvv` (eu-west-1) |
| Reading documents | Claude (`claude-opus-5-5`) via `/api/extract` |

## Environment variables

Set these in Vercel → Project → Settings → Environment Variables, then redeploy.

| Name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com/) |
| `COMPANY_NAME` | Optional. Lets Claude recognise sales invoices you issue (filed as *Income*) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional. Default to this project's public values (`src/lib/supabase/config.ts`) |

Without `ANTHROPIC_API_KEY` everything still works; documents are saved and
you fill in the details yourself.

## Access

Only emails listed in `private.members` can get an account, and only
members can see or change documents; the database enforces both.

To give someone access (e.g. your accountant), run this in the Supabase SQL
editor, then create their login under Authentication → Users:

```sql
insert into private.members (email) values ('name@example.com');
```

Remove the row to revoke access.

## Bank statements

Any CSV export works. Common layouts (ING Belgium and Netherlands, Rabobank,
bunq, Revolut, most English/Dutch/Italian/German headers) are recognised directly; for anything
else Claude reads the first rows once to map the columns, and the file is
then parsed in the browser. Every suggested match waits under *To approve*;
unambiguous ones (exact amount plus the vendor's name, or a unique amount
paid within a week) can be approved all at once.

## Data

- Table `public.documents`: one row per document, with row-level security.
- Table `public.bank_transactions`: imported statement lines (`source` bank
  or card), linked to a document when matched. Card lines point to their
  statement document and are deleted with it.
- Table `public.bank_rules`: payees or descriptions that need no receipt.
- Table `public.vendor_links`: billing-portal links, matched to lines by name.
- Bucket `documents` (private, 25 MB per file): the files. Downloads use your
  session or short-lived signed links.
- The schema lives in `supabase/migrations/`.

## Local development

```bash
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm install
npm run dev
```

`npm run lint` and `npx tsc --noEmit` should both pass before pushing.
