# Feature Batch: Unified Readings, PWA, Dark Mode, Dashboard Summary

Date: 2026-03-19

## 1. Unified Readings (Manual + Device on One Chart)

### Schema
- Add `source TEXT NOT NULL DEFAULT 'device'` to `readings` table
- Values: `'device'` (RAPT webhook) or `'manual'` (user-entered)
- Migration: `ALTER TABLE readings ADD COLUMN source TEXT NOT NULL DEFAULT 'device'`

### API Changes
- **Activities POST** (`/api/v1/batches/:batchId/activities`): When `type = 'measurement'` and `details.metric = 'SG'`, also insert a row into `readings` with:
  - `source = 'manual'`
  - `device_id = 'manual'`
  - `gravity = details.value`
  - `temperature = NULL`, `battery = NULL`, `rssi = NULL`
  - `source_timestamp = recorded_at`
  - `batch_id` from the URL param
- **Activities DELETE**: If the deleted activity was an SG measurement, delete the corresponding manual reading (`batch_id + source_timestamp + source = 'manual'`)
- **Readings list**: Include `source` in response

### Frontend
- Chart renders device readings as a line, manual readings as filled dots
- ReadingsChart: filter by source, render two series

## 2. PWA Support

### Setup
- Install `vite-plugin-pwa`
- Configure in `vite.config.ts` with:
  - `registerType: 'autoUpdate'`
  - `manifest` with wine theme colors (`#722F37` theme, cream background)
  - `display: 'standalone'`
  - Icons at 192x192 and 512x512

### Service Worker Strategy
- **NetworkFirst** for API calls (fresh data)
- **CacheFirst** for static assets (fonts, JS, CSS)

### Icons
- Generate simple wine-colored SVG icons, convert to PNG at required sizes

## 3. Dark Mode

### Setup
- Wrap app in `ThemeProvider` from `next-themes` with `attribute="class"`, `defaultTheme="system"`
- Respects OS preference out of the box

### Toggle
- Add sun/moon toggle button in Layout header (Lucide icons)
- Cycles: system → light → dark → system
- Dark mode CSS variables already defined in `index.css` with wine palette

## 4. Dashboard Summary

### New API Endpoint
- `GET /api/v1/dashboard` returns:
  - `active_batches`: active batches with latest reading (SG, temperature, timestamp) and fermentation velocity (SG drop/day over last 48h)
  - `recent_activities`: last 5 activities across all batches

### Frontend
- New `Dashboard.tsx` page at `/` route
- Shows active batches as cards with current SG, velocity indicator, sparkline
- Recent activity feed below
- Tap any batch to go to detail
- Batch list moves to `/batches` route (still accessible via nav)

### BottomNav Update
- Add "Home" tab with `House` icon at first position
- "Batches" becomes second tab at `/batches`

## Implementation Order

1. Dark mode (smallest, no API changes, immediate visual payoff)
2. Unified readings (schema migration + API + chart update)
3. Dashboard summary (new endpoint + new page)
4. PWA (standalone, no dependencies on other features)
