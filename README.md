# Wine Cellar

Batch management and fermentation monitoring for winemakers. Track batches from crush to bottle with real-time gravity and temperature readings from Bluetooth hydrometers.

## What it does

- Track wine batches through waypoint stages: must prep, primary fermentation, secondary fermentation, stabilization, and bottling
- Log activities (measurements, additions, racking, tasting notes) with full history
- Ingest live gravity and temperature readings from RAPT Pill hydrometers via webhook
- Get push notifications for stalls, temperature excursions, missing readings, and stage suggestions
- Export batch data to CSV
- Mobile-first PWA — works from your phone in the cellar

## Architecture

Two independent apps in one repo:

| Component | Stack | Deployed to |
|-----------|-------|-------------|
| **`api/`** | Hono v4, Cloudflare Workers, D1 (SQLite) | Cloudflare Workers |
| **`dashboard/`** | React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui | Cloudflare Pages |

Authentication via Cloudflare Access JWTs, GitHub OAuth, and WebAuthn passkeys. Multi-tenant — all queries scoped to the authenticated user.

## Getting started

### Prerequisites

- Node.js 20+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (for API development)

### API

```bash
cd api
npm install
npm run dev        # starts on port 8787
npm run test       # vitest + miniflare D1 emulation
```

### Dashboard

```bash
cd dashboard
npm install
npm run dev        # vite dev server, proxies /api to localhost:8787
npm run test       # vitest + jsdom + testing-library
npm run build      # production build
```

## Documentation

Full docs at [docs.cellar.drake.zone](https://docs.cellar.drake.zone/).

## License

Private project. All rights reserved.
