# Wine Cellar Dashboard — Design

## Goal

Build a mobile-first React SPA that provides full batch management and
fermentation monitoring. Deploy on Cloudflare Pages as a static site that
consumes the existing Hono API.

## Architecture

The dashboard lives in `dashboard/` at the repo root, sibling to `api/`.
Vite builds the app; Cloudflare Pages serves it as static files.

**Stack:** React, TypeScript, Vite, React Router, Recharts, shadcn/ui
(Tailwind CSS).

**API communication:** A thin fetch wrapper injects the `X-API-Key` header
from localStorage. On first visit, a prompt asks for the API key and stores
it. No OAuth, no login page.

**State management:** React's built-in `useState` and `useEffect` with a
simple `useFetch` hook. The API is the source of truth — no client-side
cache or optimistic updates.

## Screens

Five screens, plus a placeholder for future tools:

### 1. Batch List (`/`)

The default screen. Three tabs filter by status: Active, Completed,
Archived. Each batch card shows name, wine type, current stage, and latest
gravity/temperature if a device is assigned. A floating action button
creates a new batch.

### 2. Batch Detail (`/batches/:id`)

Header shows batch metadata and lifecycle action buttons (Advance,
Complete, Abandon, Archive/Unarchive). Destructive actions require
confirmation.

Three sections below the header:

- **Activities** — Newest first. Each item shows stage, type, title, and
  timestamp. Button to log a new activity.
- **Readings chart** — Dual-axis line chart plotting gravity and
  temperature over time via Recharts.
- **Device** — Shows assigned device or an "Assign" button linking to the
  devices screen.

Three parallel fetches on load: batch detail, activities list, and up to
500 readings.

### 3. New Batch (`/batches/new`)

Form fields: name, wine type (select), source material (select), start
date, volume, target volume, notes. Submits to `POST /api/v1/batches` and
navigates to the new batch's detail page.

### 4. Log Activity (`/batches/:id/activities/new`)

Form fields: stage (filtered to stages allowed by the batch's current
waypoint), type (select), title, recorded-at timestamp, and dynamic detail
fields based on type:

| Type        | Detail fields                              |
| ----------- | ------------------------------------------ |
| addition    | chemical, amount, unit                     |
| measurement | metric, value, unit                        |
| racking     | from_vessel, to_vessel                     |
| tasting     | aroma, flavor, appearance                  |
| adjustment  | parameter, from_value, to_value, unit      |
| note        | (none — freeform text in title)            |

### 5. Devices (`/devices`)

List of registered devices with assignment status. Each device shows its
name, ID, and which batch it is assigned to (or "Unassigned"). Tap to
assign to an active batch or unassign.

### 6. Tools (placeholder)

Reserved tab in bottom navigation. Future home for SG calibration
calculators, solution mix recipes, and similar utilities.

## Navigation

Fixed bottom navigation bar with three tabs: Batches, Devices, Tools.
Large touch targets for one-thumb mobile use. React Router handles all
routing.

## Project Structure

```
dashboard/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api.ts              # fetch wrapper, API key management
│   ├── types.ts             # TypeScript types matching API responses
│   ├── components/
│   │   ├── BottomNav.tsx
│   │   ├── BatchCard.tsx
│   │   ├── ActivityItem.tsx
│   │   ├── ReadingsChart.tsx
│   │   └── ui/             # shadcn components
│   └── pages/
│       ├── BatchList.tsx
│       ├── BatchDetail.tsx
│       ├── BatchNew.tsx
│       ├── ActivityNew.tsx
│       └── Devices.tsx
```

## Design Principles

- **Mobile-first.** Single-column layouts, large touch targets, minimal
  navigation depth.
- **API is truth.** No client-side cache. Fetch fresh data on every
  navigation.
- **Minimal abstractions.** No state management library, no custom hooks
  beyond `useFetch`. Straightforward components that a TypeScript beginner
  can read and modify.
- **YAGNI.** No offline support, no push notifications, no real-time
  updates. Refresh to see new data.
