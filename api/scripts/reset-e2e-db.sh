#!/usr/bin/env bash
# Reset local D1 database for E2E tests.
# Wipes all state, applies migrations, seeds test user + API key.
set -euo pipefail

cd "$(dirname "$0")/.."

DB="wine-cellar-api"

echo "Wiping D1 state..."
rm -rf .wrangler/state/v3/d1/

echo "Applying migrations..."
for f in migrations/*.sql; do
  npx wrangler d1 execute "$DB" --local --file "$f" 2>/dev/null
done

# Deterministic API key for E2E tests (not secret — local/CI only)
E2E_KEY="wc-e2etest0000000000000000000000000000000000000000000000000000000000"
HASH=$(printf '%s' "$E2E_KEY" | shasum -a 256 | cut -d' ' -f1)

echo "Seeding E2E test user and API key..."
npx wrangler d1 execute "$DB" --local --command "
  INSERT OR IGNORE INTO users (id, email, name, onboarded)
  VALUES ('00000000-e2e0-test-0000-000000000000', 'e2e@test.local', 'E2E Test User', 1);

  INSERT OR REPLACE INTO api_keys (id, user_id, name, prefix)
  VALUES ('${HASH}', '00000000-e2e0-test-0000-000000000000', 'E2E Testing', 'wc-e2ete');
" 2>/dev/null

echo "Done. E2E_API_KEY=${E2E_KEY}"
