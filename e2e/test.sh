#!/bin/bash
# Builds the app against the mock, then runs both suites, each on a fresh mock.
# Exit code 0 only when every check passes. Full logs: /tmp/e2e-<suite>.log
E2E="$(cd "$(dirname "$0")" && pwd)"
export E2E_PYTHON="${E2E_PYTHON:-/tmp/e2e-venv/bin/python}"
(cd "$E2E/.." && NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test \
  npx next build > /tmp/e2e-build.log 2>&1) || { tail -30 /tmp/e2e-build.log; exit 1; }
failed=0
for suite in run.js run-bank.js; do
  "$E2E/start.sh" > /dev/null
  node "$E2E/$suite" > "/tmp/e2e-$suite.log" 2>&1
  passed=$(grep -c "^PASS" "/tmp/e2e-$suite.log")
  if grep -q "ALL PASSED" "/tmp/e2e-$suite.log"; then
    echo "$suite: all $passed checks passed"
  else
    failed=1
    echo "$suite: FAILED"; grep -A4 "^FAIL" "/tmp/e2e-$suite.log"
  fi
done
for pid in $(pgrep -f "next-server|mock-server.mjs"); do kill "$pid"; done
exit $failed
