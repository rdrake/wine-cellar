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
from localStorage. On first visit, a setup screen asks for the API URL and
key, stores both in localStorage. A "Logout" or "Reset" option in settings
clears them. No OAuth for the MVP — this is a single-user tool on a
trusted device. OAuth is planned as future work.

**State management:** React's built-in `useState` and `useEffect` with a
simple `useFetch` hook. The API is the source of truth — no client-side
cache or optimistic updates.

**CORS:** The API must add CORS middleware to allow requests from the Pages
origin. Hono's built-in `cors()` middleware handles this. This is a
prerequisite API change before the dashboard can function.

**SPA routing fallback:** A `public/_redirects` file with `/* /index.html
200` ensures deep links and page refreshes work on Cloudflare Pages.

## Screens

Six screens, plus a placeholder for future tools:

### 1. Batch List (`/`)

The default screen. Four tabs filter by status: Active, Completed,
Abandoned, Archived. Each batch card shows name, wine type, current stage,
and status. A floating action button creates a new batch.

### 2. Batch Detail (`/batches/:id`)

Header shows batch metadata with an "Edit" button for name, notes, and
volume fields. Lifecycle action buttons (Advance, Complete, Abandon,
Archive/Unarchive) appear based on current status. Destructive actions
(Abandon) require confirmation.

Three sections below the header:

- **Activities** — Newest first. Each item shows stage, type, title, and
  timestamp. Swipe or tap to edit or delete an activity. Button to log a
  new activity.
- **Readings chart** — Dual-axis line chart plotting gravity and
  temperature over time via Recharts. Shows up to 500 most recent
  readings. If no readings exist, show an empty state with guidance.
- **Device** — Shows assigned device or an "Assign" button linking to the
  devices screen.

Four parallel fetches on load: batch detail, activities list, up to 500
readings, and device list (to resolve assignment).

### 3. New Batch (`/batches/new`)

Form fields: name, wine type (select), source material (select), start
date, volume, target volume, notes. Submits to `POST /api/v1/batches` and
navigates to the new batch's detail page.

### 4. Edit Batch (`/batches/:id/edit`)

Same form as New Batch but pre-populated. Only editable fields: name,
notes, volume, target volume. Submits to `PATCH /api/v1/batches/:id`.

### 5. Log Activity (`/batches/:id/activities/new`)

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

### 6. Devices (`/devices`)

List of registered devices with assignment status. Each device shows its
name, ID, and which batch it is assigned to (or "Unassigned"). Tap to
assign to an active batch or unassign.

### 7. Tools (placeholder)

Reserved tab in bottom navigation. Future home for SG calibration
calculators, solution mix recipes, and similar utilities.

## Navigation

Fixed bottom navigation bar with three tabs: Batches, Devices, Tools.
Large touch targets for one-thumb mobile use. React Router handles all
routing.

## Error Handling & Empty States

- **Invalid/missing API key:** Redirect to setup screen. On 401 response,
  clear stored key and redirect to setup.
- **Network errors:** Show a toast or inline error with a retry option.
- **409 conflicts** (lifecycle violations): Show the error message from the
  API in a toast.
- **Empty batch list:** "No batches yet. Tap + to start your first batch."
- **No activities:** "No activities logged. Tap + to record your first
  activity."
- **No readings:** "No telemetry data yet. Assign a RAPT Pill to start
  tracking."
- **No devices:** "No devices registered. Devices appear automatically
  when your RAPT Pill sends its first reading."

## Project Structure

```
dashboard/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   └── _redirects           # SPA fallback: /* /index.html 200
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api.ts               # fetch wrapper, API key management
│   ├── types.ts              # TypeScript types matching API responses
│   ├── components/
│   │   ├── BottomNav.tsx
│   │   ├── BatchCard.tsx
│   │   ├── ActivityItem.tsx
│   │   ├── ReadingsChart.tsx
│   │   └── ui/              # shadcn components
│   └── pages/
│       ├── BatchList.tsx
│       ├── BatchDetail.tsx
│       ├── BatchNew.tsx
│       ├── BatchEdit.tsx
│       ├── ActivityNew.tsx
│       ├── Devices.tsx
│       └── Setup.tsx
```

## API Prerequisites

Before the dashboard can function, the API needs one change:

- **CORS middleware:** Add Hono's `cors()` middleware to `api/src/app.ts`
  allowing the Cloudflare Pages origin. This enables cross-origin requests
  with the `X-API-Key` custom header.

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
