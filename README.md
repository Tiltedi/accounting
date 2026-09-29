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

## Data

- Table `public.documents`: one row per document, with row-level security.
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
