# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wine batch management and fermentation monitoring system. Two independent apps in one repo:

- **`api/`** — Hono REST API on Cloudflare Workers with D1 (SQLite) database
- **`dashboard/`** — React 19 SPA on Cloudflare Pages (mobile-first PWA)

## Commands

### API (`cd api`)

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local dev server (wrangler, port 8787) |
| `npm run test` | Run all tests (vitest + miniflare D1 emulation) |
| `npm run test:watch` | Watch mode |
| `npx vitest run test/batches.test.ts` | Run a single test file |
| `npm run lint` | Type-check only (`tsc --noEmit`) |
| `npm run deploy` | Deploy to Cloudflare Workers |

### Dashboard (`cd dashboard`)

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server (proxies `/api` to localhost:8787) |
| `npm run test` | Run all tests (vitest + jsdom + testing-library) |
| `npm run test:watch` | Watch mode |
| `npx vitest run src/pages/Dashboard.test.tsx` | Run a single test file |
| `npm run lint` | ESLint |
| `npm run build` | Production build (`tsc -b && vite build`) |

## Architecture

### API

- **Hono v4** framework, deployed as a Cloudflare Worker
- **No ORM** — raw SQL via D1 prepared statements (keeps bundle small)
- **Zod** for request validation (`api/src/models.ts`)
- **Auth**: Cloudflare Access JWTs in `Cf-Access-Jwt-Assertion` header; middleware in `middleware/access.ts` verifies and upserts user. Service tokens map via `service_tokens` table. Webhook endpoint bypasses auth (validates `WEBHOOK_TOKEN` instead).
- **Cron** runs every 15 min (`src/cron.ts` → `src/lib/alerts.ts`): evaluates batches for stall/temp/no_readings/stage_suggestion alerts, fires Web Push notifications
- **Web Push**: RFC 8291 encryption implemented without npm crypto deps (`src/lib/web-push.ts`)
- Routes mounted at `/api/v1/*` (see `src/app.ts`), webhook at `/webhook`

### Dashboard

- **React 19** + TypeScript + Vite v8
- **Tailwind CSS v4** with `@tailwindcss/vite` plugin (no tailwind.config needed)
- **shadcn/ui** components (base-nova style) in `src/components/ui/`
- **Recharts** for gravity/temperature charts
- **Path alias**: `@/` maps to `src/`
- API client in `src/api.ts` — thin fetch wrapper; 401 triggers page reload
- Types mirrored from API in `src/types.ts`
- Pages Functions in `functions/` proxy `/api/*` and `/webhook/*` to the API Worker (same-origin, no CORS needed)
- PWA: service worker in `public/sw.js` handles push notifications

### Domain Model

Batches progress through **waypoint stages** (`must_prep` → `primary_fermentation` → `secondary_fermentation` → `stabilization` → `bottling`). Each waypoint allows specific **activity stages** (e.g., primary_fermentation allows `primary_fermentation` and `pressing`). See `api/src/schema.ts` for the `WAYPOINT_ALLOWED_STAGES` mapping.

Statuses: `active` → `completed` | `archived` | `abandoned`.

### Testing

**API tests** use `@cloudflare/vitest-pool-workers` with miniflare D1 emulation. Migrations are loaded at config time and applied per-test via `applyMigrations()` in `test/helpers.ts`. Test auth uses fake JWTs (`authHeaders(email)`). Use `fetchJson()` and `createBatch()` helpers.

**Dashboard tests** use vitest + jsdom + `@testing-library/react`.

### Deployment

- API: `npm run deploy` in `api/` (requires wrangler auth)
- Dashboard: push to GitHub → Cloudflare Pages auto-deploys (project: `wine-cellar-dashboard`)

## Key Conventions

- All DB queries filter by `user.id` from the Access JWT (multi-tenant isolation)
- Enum-like constants defined as `as const` arrays in `api/src/schema.ts` with derived types
- Cursor-based pagination for readings (timestamp + id compound cursor in `api/src/lib/cursor.ts`)
- One active alert per (user, batch, alert_type) — deduplication in `api/src/lib/alert-manager.ts`
- shadcn Badge strips margin/gap via twMerge — use wrapper `<div>` elements with flex+gap instead of margin on Badge directly
- `space-y-*` collapses with `overflow-hidden` Cards — use `flex flex-col gap-*` instead
