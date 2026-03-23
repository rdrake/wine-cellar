#!/usr/bin/env bash
# Launch a fully-seeded demo instance of Wine Cellar.
# Usage: bash scripts/demo.sh   (or: make demo)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  echo ""
  echo "Shutting down..."
  # Kill process trees (subshells + their children: workerd, node, etc.)
  pkill -P $API_PID 2>/dev/null || true
  pkill -P $DASH_PID 2>/dev/null || true
  kill $API_PID 2>/dev/null || true
  kill $DASH_PID 2>/dev/null || true
  wait 2>/dev/null
  echo "Done."
  exit 0
}
trap cleanup EXIT INT TERM

# ── Step 1: Reset database ────────────────────────────────────────
echo "==> Resetting database..."
bash "$ROOT/api/scripts/reset-e2e-db.sh"

# ── Step 2: Start API server ─────────────────────────────────────
echo "==> Starting API server..."
(cd "$ROOT/api" && npm run dev 2>&1 | sed 's/^/[api] /') &
API_PID=$!

# Wait for API to be ready (use /health — auth-exempt endpoint)
echo "    Waiting for API on port 8787..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8787/health -o /dev/null 2>/dev/null; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "    ERROR: API did not start within 30 seconds"
    exit 1
  fi
  sleep 1
done
echo "    API ready."

# ── Step 3: Start dashboard ──────────────────────────────────────
echo "==> Starting dashboard..."
(cd "$ROOT/dashboard" && npm run dev 2>&1 | sed 's/^/[dash] /') &
DASH_PID=$!

# Wait for dashboard to be ready
echo "    Waiting for dashboard on port 5173..."
for i in $(seq 1 15); do
  if curl -sf http://localhost:5173 -o /dev/null 2>/dev/null; then
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "    ERROR: Dashboard did not start within 15 seconds"
    exit 1
  fi
  sleep 1
done
echo "    Dashboard ready."

# ── Step 4: Seed data ────────────────────────────────────────────
echo "==> Seeding demo data..."
(cd "$ROOT/dashboard" && npx tsx e2e/run-seed.ts)

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  Wine Cellar demo is running!"
echo "  http://localhost:5173"
echo ""
echo "  API key (paste into login):"
echo "  wc-e2etest0000000000000000000000000000000000000000000000000000000000"
echo ""
echo "  Press Ctrl+C to stop."
echo "============================================"
echo ""

wait
