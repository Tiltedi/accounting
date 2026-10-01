# End-to-end tests

The real app (production build) driven by Playwright against `mock-server.mjs`, a local stand-in for
Supabase (auth, PostgREST subset, storage) and the Anthropic Messages API. Needed because cloud sessions
can't reach Supabase and have no API key.

```bash
./e2e/setup.sh   # once per container: playwright-core + Python venv (openpyxl, pypdf, pillow)
./e2e/test.sh    # build against the mock, run both suites on a fresh mock each (~5 min)
```

| File | What |
| --- | --- |
| `run.js` | Documents: login, upload, scan → PDF, reading, editing, filters, ZIP + Summary.xlsx, phone layout, errors |
| `run-bank.js` | Bank and card: CSV imports and dedupe, rules, approvals, billing links, drag-and-drop, card statements, match offers |
| `mock-server.mjs` | Mock backend on :54321. Canned Claude answers keyed by file name (`RESULTS`), statement prompt, CSV-column prompt. Test hooks: `/__state`, `/__mode?anthropic=fail|slow`, `/__expire`, `/__set` |
| `start.sh` | (Re)starts mock + `next start -p 3100`; build first (see `test.sh`) |
| `fixtures/` | Synthetic receipts, Dutch ING and headerless ABN CSVs, and `ing-be-sample.csv` — an **anonymised** copy of a real ING Belgium export (same layout and amounts, fake accounts and names). `ing-be-sample-map.json`: its legacy → entry-number fingerprints |

Run one suite by hand: `./e2e/start.sh && node e2e/run-bank.js`. Screenshots land in `e2e/shots*/`.

Notes: wait for `networkidle` before `setInputFiles` right after `goto` (otherwise the file can arrive
before hydration and be ignored). Browser path: `CHROME_PATH` (default `/opt/pw-browsers/...`). Python:
`E2E_PYTHON` (default `/tmp/e2e-venv/bin/python`).
