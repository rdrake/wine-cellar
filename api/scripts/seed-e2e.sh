#!/usr/bin/env bash
# Seed the local D1 database with a test user and API key for E2E tests.
# Idempotent — safe to run multiple times.
set -euo pipefail

cd "$(dirname "$0")/.."

DB="wine-cellar-api"
d1() { npx wrangler d1 execute "$DB" --local --command "$1" 2>/dev/null; }
d1_json() { npx wrangler d1 execute "$DB" --local --json --command "$1" 2>/dev/null; }

echo "Applying migrations..."
for f in migrations/*.sql; do
  npx wrangler d1 execute "$DB" --local --file "$f" 2>/dev/null || true
done

# Deterministic API key for E2E tests (not secret — local/CI only)
E2E_KEY="wc-e2etest0000000000000000000000000000000000000000000000000000000000"
HASH=$(printf '%s' "$E2E_KEY" | shasum -a 256 | cut -d' ' -f1)

echo "Seeding E2E test user and API key..."
d1 "
  INSERT OR IGNORE INTO users (id, email, name, onboarded)
  VALUES ('00000000-e2e0-test-0000-000000000000', 'e2e@test.local', 'E2E Test User', 1);

  INSERT OR REPLACE INTO api_keys (id, user_id, name, prefix)
  SELECT '${HASH}',
         id,
         'E2E Testing',
         'wc-e2ete'
  FROM users WHERE email = 'e2e@test.local';
"

echo "Done. E2E_API_KEY=${E2E_KEY}"
