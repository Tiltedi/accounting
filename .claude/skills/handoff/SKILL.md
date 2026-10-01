---
name: handoff
description: Save this session's progress into the repo memory (docs/agents/STATUS.md, DECISIONS.md and, when they changed, ARCHITECTURE.md, OPERATIONS.md, USER.md) so the next session or agent can pick up quickly. Use at the end of a session, before a long break, or when the user says "handoff", "save progress" or "remember this".
---

# Handoff

Goal: the next agent reads `CLAUDE.md` → `docs/agents/STATUS.md` and knows where things stand in two minutes.

1. Gather facts, don't guess:
   - `git log --oneline origin/main -5` and the session branch; what is live vs only on a branch.
   - Production data that changed this session (counts via Supabase `execute_sql`, read-only).
   - Anything the user said they will do, or decided.
2. Update `docs/agents/STATUS.md`:
   - "Last updated" line (date, which session).
   - "Live now": features and the live commit; remove what no longer holds.
   - "Production data": refresh counts if they changed.
   - "Open items" (waiting on user / unfinished) and "Ideas offered but not built"; drop finished ones.
   - "Last session": 2–4 lines, replace the previous one (history belongs in git and DECISIONS.md).
3. Append to `docs/agents/DECISIONS.md` (newest first) for each real decision: what, why, what would change it.
4. Touch `ARCHITECTURE.md` / `OPERATIONS.md` / `USER.md` only if files, flows, procedures or preferences changed.
5. Keep it tight: facts and pointers to files, no narration; nothing secret (keys, passwords) and no personal
   bank data.
6. Commit as "Update agent memory" on the session branch and push the branch. Pushing to `main` still needs
   the user's go-ahead (docs-only changes can ride along with the next approved push).
7. Tell the user in one or two lines what was saved.
