@AGENTS.md

# Accounting app — agent memory index

Company accounting app for Tilted I BV (Belgium, owner Luca). Scan/upload receipts → Claude reads them →
match to bank and credit-card lines → hand documents to the accountant (WinAuditor). Live:
https://accounting-roan-psi.vercel.app (Vercel production follows `main`).

Read on demand, not all at once:

| File | Read when |
| --- | --- |
| `docs/agents/STATUS.md` | **Always first.** What's live, open items, next ideas, last session |
| `docs/agents/USER.md` | Before replying or deciding anything: preferences and working agreements |
| `docs/agents/ARCHITECTURE.md` | Before changing code: file map, data model, the main flows |
| `docs/agents/OPERATIONS.md` | Before testing, deploying, migrating, or touching production data |
| `docs/agents/DECISIONS.md` | Before reversing or redoing something: what was decided and why |
| `e2e/README.md` | Running the end-to-end tests |
| `README.md` | Product overview for humans |

Rules that always apply:

- Never push to `main` (= production) without the user saying so in this session; work on the session branch.
- Production data changes (SQL on Supabase) only when asked, after a read-only check, with counts verified after.
- Run `npm run lint`, `npx tsc --noEmit` and `e2e/test.sh` before pushing; report failures honestly.
- Never commit real bank statements or personal data; test fixtures are synthetic or anonymised.
- End of session (or user types `/handoff`): update `docs/agents/STATUS.md` and `DECISIONS.md` — see `.claude/skills/handoff/SKILL.md`.
