# Operations

## IDs and places

| Thing | Value |
| --- | --- |
| Live URL | https://accounting-roan-psi.vercel.app |
| GitHub | `Tiltedi/accounting`; production = `main`; agent work on the session branch (e.g. `claude/…`) |
| Vercel | project `prj_vbV3ZZtOWBtiYFEEe3eKGEjLV8vj`, team `team_6qA10vnii7y7dtRlS3Jf9gSY`, region `dub1` |
| Supabase | project `hgappljfpkqhsnrruzvv` (eu-west-1); public URL/key defaults in `src/lib/supabase/config.ts` |
| Env vars (Vercel) | `ANTHROPIC_API_KEY` (production; preview availability unknown), optional `COMPANY_NAME`, `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (inbox) |
| Inbox OAuth | Google Cloud OAuth client (Web, consent screen *Internal* to tiltedi.com, Gmail API enabled, scope `gmail.readonly`); redirect URI `https://accounting-roan-psi.vercel.app/api/inbox/callback`. Changing the secret makes the stored token unreadable → reconnect |

## Cloud-container limits (Claude Code on the web)

- The container **cannot reach `*.supabase.co`** or the live site, and has **no Anthropic API key**.
  → Use the Supabase MCP tools (`execute_sql`, `apply_migration`, `list_migrations`) for the database, the
  Vercel MCP tools for deployments/logs, and the local mock for app testing.
- Vercel MCP: reading env vars returns 403; `get_deployment`/`list_deployments`/`get_runtime_logs` work.
- Anything outside the repo (scratchpad, `/tmp`, `~/.claude`) is lost when the session ends.

## Deploy

1. Lint, typecheck, `e2e/test.sh` all green.
2. Push the session branch → Vercel builds a preview (alias `accounting-git-<branch>-…vercel.app`).
3. Only when the user says so: `git push origin <branch>:main` → production build (~30 s; GitHub's trigger
   can lag a minute or two — check before starting a manual deploy).
4. Verify: `get_deployment("accounting-roan-psi.vercel.app")` shows the new `githubCommitSha` and `READY`.

## Database changes

- New migration file `supabase/migrations/<version>_<name>.sql`; apply with `apply_migration`; then rename the
  local file to the version that `list_migrations` reports; update `src/lib/database.types.ts`
  (`generate_typescript_types` or by hand — Insert fields optional).
- Additive changes first, code after. If old code can't handle new data (e.g. new fingerprints), deploy code
  first and wait for `READY` before changing data.
- Data fixes: read-only check → update in one statement that only touches rows still in the old state →
  verify counts. Tell the user what changed.

## Testing

`e2e/` runs the real app (production build) against `e2e/mock-server.mjs`, which imitates Supabase auth,
PostgREST, storage and the Anthropic API (canned answers by file name / prompt). See `e2e/README.md`.
`./e2e/setup.sh` once per container, then `./e2e/test.sh` (≈3 min, 85 checks in 3 suites).
Don't put `next-server` or `mock-server.mjs` in an ad-hoc shell command: `start.sh`/`test.sh` kill processes
whose command line matches, including the calling shell.
When adding a feature: extend the mock for new tables/columns and add a step to `run-bank.js` or `run.js`.

## Model and cost reference

Sonnet 5.5 ($2/$10 per MTok) for receipts ≈ $0.0075/read, ~3 s. Opus 5.5 ($4/$20) for card statements
≈ $0.02–0.05/statement. Fast mode would be 2× price — declined. Prompt too short to benefit from caching.
