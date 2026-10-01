#!/bin/bash
# Starts the mock backend (:54321) and the production build of the app (:3100).
# Build first: (cd .. && NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npx next build)
E2E="$(cd "$(dirname "$0")" && pwd)"
for pid in $(pgrep -f "next-server|mock-server.mjs"); do kill "$pid"; done
sleep 0.5
rm -f /tmp/mock-requests.jsonl; rm -rf /tmp/mock-state
cd "$E2E" && nohup node mock-server.mjs > /tmp/e2e-mock.log 2>&1 &
cd "$E2E/.." && NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test \
  ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://localhost:54321 \
  GOOGLE_CLIENT_ID=test-client GOOGLE_CLIENT_SECRET=test-secret GOOGLE_AUTH_URL=http://localhost:54321/google/auth \
  GOOGLE_TOKEN_URL=http://localhost:54321/google/token GMAIL_API_URL=http://localhost:54321/gmail/v1 nohup npx next start -p 3100 > /tmp/e2e-next.log 2>&1 &
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/login 2>/dev/null | grep -q 200 && break; sleep 0.5; done
curl -s -o /dev/null -w "app on :3100 → login %{http_code}\n" http://localhost:3100/login
