# Dashboard front-end architecture

Internal reference for the Wine Cellar dashboard. Covers the tech stack, routing, data flow, component architecture, and everything a developer needs to add features or debug issues.

---

## 1. Tech stack

| Layer           | Technology                        | Version   |
| --------------- | --------------------------------- | --------- |
| Framework       | React                             | 19        |
| Build tool      | Vite                              | 8         |
| Styling         | Tailwind CSS (v4, no config file) | 4.2       |
| Component lib   | shadcn/ui (base-nova style)       | 4.1       |
| Charts          | Recharts                          | 3.8       |
| Routing         | React Router                      | 7         |
| Theming         | next-themes                       | 0.4       |
| Toasts          | Sonner                            | 2.0       |
| Icons           | Lucide React                      | 0.577     |
| Fonts           | Geist Variable (body), Playfair Display Variable (headings) | -- |
| Testing         | Vitest + Testing Library + jsdom  | --        |
| TypeScript      | 5.9                               | --        |
| Date utilities  | date-fns                          | 4.1       |
| WebAuthn        | @simplewebauthn/browser           | 13.3      |
| Hosting         | Cloudflare Pages                  | --        |

### Path aliases

Configured in `vite.config.ts` and `components.json`:

```
@ -> dashboard/src/
```

All imports use `@/components/...`, `@/pages/...`, `@/hooks/...`, `@/lib/...`, and so on.

---

## 2. Routing

`<AuthGate>` wraps all routes and controls access. Unauthenticated users see the `Login` page. The app redirects new users (those who have not completed onboarding) to `/welcome`. Authenticated users who have finished onboarding see the main app routes inside a shared `<Layout />` wrapper (provides header, bottom nav, and toast container).

Defined in `src/App.tsx`:

| Route                             | Page Component    | URL Params | Description                          |
| --------------------------------- | ----------------- | ---------- | ------------------------------------ |
| (unauthenticated)                 | `Login`           | --         | GitHub OAuth and passkey sign-in     |
| `/welcome`                        | `Welcome`         | --         | Onboarding: display name and passkey setup |
| `/`                               | `Dashboard`       | --         | Home: active batches, alerts, recent activity |
| `/batches`                        | `BatchList`       | --         | All batches, filtered by status tabs |
| `/batches/new`                    | `BatchNew`        | --         | Create a new batch (with templates)  |
| `/batches/:id`                    | `BatchDetail`     | `id`       | Single batch: readings, stats, lifecycle actions, activities, devices |
| `/batches/:id/edit`               | `BatchEdit`       | `id`       | Edit batch name, volume, notes       |
| `/batches/:id/activities/new`     | `ActivityNew`     | `id`       | Log a new activity for a batch       |
| `/settings`                       | `Settings`        | --         | Sensor management, device claim, push notifications, passkey management |
| `/tools`                          | `Tools`           | --         | Winemaking calculators (ABV, chaptalization, sulfite, hydrometer correction, calibration solution) |
| `/compare`                        | `BatchComparison` | --         | Overlay fermentation curves for up to 5 batches |

`<ThemeProvider>` (next-themes) wraps the app with `attribute="class"`, `defaultTheme="system"`, and `enableSystem`. The `Login` page renders outside the `<Layout />` wrapper (no header or bottom nav). The `Welcome` page also renders outside `<Layout />`; the app redirects new users there from any route until they complete onboarding.

### Query parameter actions

`BatchDetail` reads query parameters from push notification deep links:
- `?action=advance&stage=<stage>` -- auto-advances the batch to the given stage
- `?action=dismiss&alertId=<id>` -- auto-dismisses the given alert

A `useEffect` with a ref guard consumes these after mount, then clears them from the URL.

---

## 3. API Client (`src/api.ts`)

### Core: `apiFetch<T>(path, options?)`

A thin wrapper around `fetch()`:
- Sets `Content-Type: application/json` when a body is present.
- All API paths are **relative** (e.g. `/api/v1/batches`) -- the same-origin proxy handles routing to the API Worker.
- Returns parsed JSON typed as `T`.

### Error handling

- **401**: Calls the `onUnauthorized` callback (set by `AuthGate`) to reset auth state and show the login page. Throws an `ApiError` after.
- **204**: Returns `undefined` (for DELETE responses).
- **Other non-2xx**: Parses the JSON body and throws `ApiError(status, body)`.

`ApiError` extends `Error` and carries `.status` and `.body` for callers to inspect.

The `setOnUnauthorized(cb)` export allows `AuthGate` to register a callback that clears auth state on 401 instead of doing a hard page reload.

### Query string helper

`qs(params?)` converts a `Record<string, string | number | undefined>` to a query string, stripping `undefined` values.

### Endpoint organization

The `api` object organizes endpoints by resource:

```
api.batches.list(params?)       GET  /api/v1/batches
api.batches.get(id)             GET  /api/v1/batches/:id
api.batches.create(data)        POST /api/v1/batches
api.batches.update(id, data)    PATCH /api/v1/batches/:id
api.batches.delete(id)          DELETE /api/v1/batches/:id
api.batches.advance(id)         POST /api/v1/batches/:id/advance
api.batches.setStage(id, stage) POST /api/v1/batches/:id/stage
api.batches.complete(id)        POST /api/v1/batches/:id/complete
api.batches.abandon(id)         POST /api/v1/batches/:id/abandon
api.batches.archive(id)         POST /api/v1/batches/:id/archive
api.batches.unarchive(id)       POST /api/v1/batches/:id/unarchive

api.activities.list(batchId, params?)              GET  /api/v1/batches/:id/activities
api.activities.create(batchId, data)               POST /api/v1/batches/:id/activities
api.activities.update(batchId, activityId, data)   PATCH /api/v1/batches/:id/activities/:actId
api.activities.delete(batchId, activityId)         DELETE /api/v1/batches/:id/activities/:actId

api.readings.listByBatch(batchId, params?)  GET /api/v1/batches/:id/readings
api.readings.listByDevice(deviceId, params?) GET /api/v1/devices/:id/readings

api.devices.list()                GET  /api/v1/devices
api.devices.create(data)          POST /api/v1/devices
api.devices.assign(deviceId, batchId) POST /api/v1/devices/:id/assign
api.devices.unassign(deviceId)    POST /api/v1/devices/:id/unassign
api.devices.claim(deviceId)       POST /api/v1/devices/claim

api.alerts.dismiss(alertId)       POST /api/v1/alerts/:id/dismiss

api.push.vapidKey()               GET  /api/v1/push/vapid-key
api.push.subscribe(subscription)  POST /api/v1/push/subscribe
api.push.unsubscribe(endpoint)    DELETE /api/v1/push/subscribe
api.push.test()                   POST /api/v1/push/test

api.auth.status()                 GET  /api/v1/auth/status
api.auth.settings()               GET  /api/v1/auth/settings
api.auth.loginOptions()           POST /api/v1/auth/login/options
api.auth.login(data)              POST /api/v1/auth/login
api.auth.registerOptions()        POST /api/v1/auth/register/options
api.auth.register(data)           POST /api/v1/auth/register
api.auth.logout()                 POST /api/v1/auth/logout
api.auth.passkeys.list()          GET  /api/v1/auth/passkeys
api.auth.passkeys.revoke(id)      DELETE /api/v1/auth/passkeys/:id
api.auth.apiKeys.list()           GET  /api/v1/auth/api-keys
api.auth.apiKeys.create(name)     POST /api/v1/auth/api-keys
api.auth.apiKeys.revoke(id)       DELETE /api/v1/auth/api-keys/:id

api.users.me()                    GET  /api/v1/users/me
api.users.updateMe(data)          PATCH /api/v1/users/me

api.dashboard()                   GET  /api/v1/dashboard
api.health()                      GET  /health
```

---

## 4. TypeScript Types (`src/types.ts`)

### Enums (string unions)

| Type             | Values |
| ---------------- | ------ |
| `WineType`       | `red`, `white`, `rose`, `orange`, `sparkling`, `dessert` |
| `SourceMaterial` | `kit`, `juice_bucket`, `fresh_grapes` |
| `BatchStage`     | `must_prep`, `primary_fermentation`, `secondary_fermentation`, `stabilization`, `bottling` |
| `BatchStatus`    | `active`, `completed`, `archived`, `abandoned` |
| `AllStage`       | 14 fine-grained stages (superset of `BatchStage` waypoints) |
| `ActivityType`   | `addition`, `racking`, `measurement`, `tasting`, `note`, `adjustment` |

### Key interfaces

- **`Batch`** -- Core batch record (id, name, wine_type, source_material, stage, status, volumes, dates).
- **`Activity`** -- Logged action with typed details (`Record<string, unknown> | null`).
- **`Reading`** -- Sensor or manual gravity/temperature measurement with device_id, battery, rssi, source.
- **`Device`** -- RAPT Pill sensor (id, name, current batch assignment).
- **`Alert`** -- Fired alert (stall, no_readings, temp_high, temp_low, stage_suggestion).
- **`BatchSummary`** -- Extended Batch with first/latest readings, velocity, days_fermenting, and sparkline data (used by dashboard endpoint).
- **`DashboardResponse`** -- `{ active_batches: BatchSummary[], recent_activities, alerts }`.
- **`CurrentPhase`** -- Current batch phase indicator with `label`, `stage`, `daysElapsed`, and optional `estimatedTotalDays` for progress calculation.
- **`Milestone`** -- Timeline milestone with `label`, `estimated_date`, `basis`, `confidence` (firm/estimated/rough), and optional `completed` flag.
- **`Nudge`** -- Contextual suggestion with `id`, `priority` (info/warning/action), `message`, optional `detail`, and `stage`.
- **`DrinkWindow`** -- Cellaring estimate with `readyDate`, `peakStart`, `peakEnd`, `pastPeakDate`, `storageNote`, and optional `adjustmentNote`.
- **`Passkey`** -- Registered WebAuthn credential with `id`, `name`, `deviceType`, `backedUp`, `createdAt`, and `lastUsedAt`.
- **`ListResponse<T>`** -- `{ items: T[] }`.
- **`PaginatedResponse<T>`** -- `{ items: T[], next_cursor: string | null }`.

### Constants

- `WAYPOINT_ALLOWED_STAGES` -- Maps each `BatchStage` waypoint to its allowed fine-grained `AllStage` values (controls which stages appear in the activity form).
- `STAGE_LABELS`, `WINE_TYPE_LABELS`, `SOURCE_MATERIAL_LABELS`, `STATUS_LABELS`, `ACTIVITY_TYPE_LABELS` -- Display labels for all enums.

---

## 5. Page-by-page breakdown

### Login (unauthenticated)

**Data**: Calls `api.auth.settings()` on mount to check whether registrations are open. Reads URL query parameters for OAuth error codes (`registrations_closed`, `github_error`, `email_required`) and displays the corresponding message.

**UI**: Centred card with two sign-in options:
1. **GitHub OAuth** -- An anchor link to `/api/v1/auth/github` that starts the server-side OAuth flow.
2. **Passkey sign-in** -- Calls `api.auth.loginOptions()` to get a WebAuthn challenge, then `startAuthentication()` from `@simplewebauthn/browser`, then `api.auth.login()` to verify. On success, reloads the page to enter the authenticated flow.

Displays a notice when the server has closed registrations. The component reads OAuth error params from the URL on mount, then clears them with `replaceState`.

### Welcome (`/welcome`)

**Data**: Uses the `useAuth()` hook to get the current user. Calls `api.auth.registerOptions()` and `api.auth.register()` for passkey setup. Calls `api.users.updateMe()` with the display name and `onboarded: true` to complete onboarding.

**UI**: Centred card with two sections:
1. **Display name** -- Text input pre-filled with the user's name if available.
2. **Passkey setup** -- Optional step to register a passkey (Face ID or Touch ID) by using `startRegistration()` from `@simplewebauthn/browser`. The button disables after the user adds a passkey.

The "Continue to dashboard" button saves the display name, marks the user as onboarded, refreshes auth state, and navigates to `/`.

### Dashboard (`/`)

**Data**: Single call to `api.dashboard()` returning active batches (with sparkline data), recent activities, and alerts.

**Sections**:
1. **SummaryStats** -- batch count, total liters, day range.
2. **AlertsSection** -- "Needs attention" with close buttons. Calls `api.alerts.dismiss()` then refetches.
3. **Active Batches** -- Sorted: stalled first, then no-readings, then by days fermenting descending. Each `BatchRow` shows wine type dot, name, stage, gravity sparkline, temperature sparkline, attenuation, velocity, and relative time.
4. **Recent Activity** -- Latest activities across all batches with detail preview.
5. **FAB** -- Fixed "+" button linking to `/batches/new`.

### BatchList (`/batches`)

**Data**: `api.batches.list({ status })`, re-fetched whenever the status tab changes.

**UI**: Status tabs (Active, Completed, Abandoned, Archived) by using shadcn Tabs. Each batch rendered as a `BatchCard`. Compare button links to `/compare`. FAB links to `/batches/new`.

### BatchDetail (`/batches/:id`)

**Data**: Parallel fetches for batch, readings (limit 500), activities, and devices.

**Sections** (in order):
1. **Header** -- Name, wine type, source material, stage, status. Edit link and ExportButton.
2. **BatchSnapshot** -- Inline stats card: current SG with source and age, temperature, ABV, attenuation, OG-to-SG, velocity, projected days to dry, day count, volume, start date, reading count, assigned device.
3. **ReadingsChart** -- Recharts ComposedChart with gravity line (device + manual), temperature on right Y axis, activity markers as dashed reference lines, and 7d/14d/All time range toggle.
4. **LifecycleActions** -- Stage selector dropdown + Set Stage, Complete, Log Activity, Abandon (active). Reopen, Archive (completed/abandoned). Delete (non-active). Confirmation dialog for destructive actions.
5. **ActivitySection** -- Timeline of ActivityItems with edit/delete. Inline EditActivityDialog.
6. **Batch Notes** -- Collapsible section.
7. **DeviceSection** -- Assigned devices with unassign. Links to Settings for assignment.

**Query param actions**: Handles `?action=advance&stage=...` and `?action=dismiss&alertId=...` from push notification deep links.

### BatchNew (`/batches/new`)

**UI**: Six quick-start templates (Red from grapes, White from grapes, Rose from grapes, Red wine kit, White wine kit, Juice bucket) that pre-fill the BatchForm. Submits by using `api.batches.create()`, then navigates to the new batch.

### BatchEdit (`/batches/:id/edit`)

**Data**: Fetches the batch. Passes name, volume, target_volume, and notes to `BatchForm` in `editMode` (hides wine_type, source_material, started_at). Submits by using `api.batches.update()`.

### ActivityNew (`/batches/:id/activities/new`)

**Data**: Fetches the parent batch to find its current stage waypoint, which controls which fine-grained stages are selectable (through `WAYPOINT_ALLOWED_STAGES`).

**Form**: Stage selector, activity type selector, title, recorded_at datetime, and dynamic `DetailFields` that change based on activity type. Submits by using `api.activities.create()`.

### Settings (`/settings`)

**Sections**:
1. **Sensors** -- Lists all registered devices as `DeviceCard` components showing name, ID, assignment status, latest reading (gravity, temperature, battery, signal), and mini sparkline. Assign/Unassign buttons with dialog.
2. **Claim Device** -- Text input for claiming unregistered RAPT Pills by device ID.
3. **Notifications** -- Push notification toggle with VAPID key exchange, subscribe/unsubscribe flow, and Test button.

### Tools (`/tools`)

Entirely client-side (no API calls). Five collapsible calculator cards:
- **ABV Calculator** -- OG + FG sliders/inputs, computes ABV and estimated attenuation.
- **Chaptalization** -- Volume + current SG + target SG, computes sugar needed.
- **Sulfite Addition** -- Volume + pH + target/current SO2, computes KMS dosage and molecular SO2.
- **Hydrometer Correction** -- Observed SG + sample temp + calibration temp, applies polynomial correction.
- **Calibration Solution** -- Target volume + target SG, computes sugar recipe with preparation instructions.

### BatchComparison (`/compare`)

**Data**: Fetches all batches. On batch selection (toggle badges, max 5), fetches readings for each.

**UI**: Badge selector, Recharts overlay chart with normalized time axis (hours from first reading per batch), and a comparison table (OG, SG, ABV, attenuation, velocity, days, temp range, reading count).

---

## 6. Component architecture

### Layout shell

```
<ThemeProvider>
  <BrowserRouter>
    <AuthGate>                             <-- checks auth, renders Login if needed
      <AuthenticatedRoutes>
        if isNewUser:
          <Welcome />                      <-- no Layout wrapper
        else:
          <Routes>
            <Route element={<Layout />}>   <-- wraps main app pages
              <Route path="/" element={<Dashboard />} />
              ...
            </Route>
          </Routes>
      </AuthenticatedRoutes>
    </AuthGate>
  </BrowserRouter>
</ThemeProvider>
```

**`AuthGate`** (`src/components/AuthGate.tsx`):
- Calls `api.auth.status()` on mount to check the session.
- Registers an `onUnauthorized` callback with the API client so that 401 responses reset auth state (instead of a hard page reload).
- Renders a loading spinner while the auth check is in flight.
- If unauthenticated, renders `<Login />` directly (no routing needed).
- If authenticated, provides `AuthContext` with `user`, `isNewUser`, and `refreshAuth()`.
- Exports the `useAuth()` hook for child components to access the current user and refresh function.

**`Layout`** (`src/components/Layout.tsx`):
- Global header with "Wine Cellar" title and `ThemeToggle`.
- `<Outlet />` for page content.
- `<BottomNav />` fixed at the bottom.
- `<Toaster />` (Sonner) at top-center.
- Body has bottom padding to avoid overlap with BottomNav: `paddingBottom: calc(5rem + env(safe-area-inset-bottom))`.
- Header respects `env(safe-area-inset-top)` for notched devices.

**`BottomNav`** (`src/components/BottomNav.tsx`):
- Four tabs: Home (House icon), Batches (Wine), Calculators (Wrench), Settings (Settings).
- Uses `NavLink` with `end` on `/` for exact matching.
- Active tab gets `text-primary` and a subtle `bg-primary/10` pill behind the icon.
- Fixed positioned, blurred background, respects safe area insets.

**`ThemeToggle`** (`src/components/ThemeToggle.tsx`):
- Cycles through system -> light -> dark.
- Shows a Monitor, Sun, or Moon icon.

### Shared components

| Component | File | Used By | Purpose |
| --------- | ---- | ------- | ------- |
| `BatchCard` | `components/BatchCard.tsx` | BatchList | Batch row with sparklines (fetches its own readings) |
| `BatchForm` | `components/BatchForm.tsx` | BatchNew, BatchEdit | Reusable form with `editMode` flag to hide immutable fields |
| `BatchStats` | `components/BatchStats.tsx` | (available, inlined in BatchDetail as BatchSnapshot) | Computed stats card |
| `ReadingsChart` | `components/ReadingsChart.tsx` | BatchDetail | Recharts time-series with gravity, temperature, activity markers |
| `ActivitySection` | `components/ActivitySection.tsx` | BatchDetail | Activity list with edit dialog and delete confirmation |
| `ActivityItem` | `components/ActivityItem.tsx` | ActivitySection | Single activity card with formatted details |
| `DetailFields` | `components/DetailFields.tsx` | ActivityNew, ActivitySection (edit dialog) | Dynamic form fields per activity type |
| `DeviceSection` | `components/DeviceSection.tsx` | BatchDetail | Device assignment panel for a single batch |
| `ExportButton` | `components/ExportButton.tsx` | BatchDetail | Downloads readings + activities as CSV |
| `BatchTimeline` | `components/BatchTimeline.tsx` | BatchDetail | Current phase progress bar and milestone timeline with relative dates |
| `NudgeBar` | `components/NudgeBar.tsx` | BatchDetail | Dismissible contextual suggestions with priority-based styling |
| `Sparkline` | `components/Sparkline.tsx` | Dashboard, BatchCard, Settings, BatchComparison | SVG sparkline with `GravitySparkline` (fixed 0.990-1.125 domain) and `TemperatureSparkline` (auto domain) variants |

### shadcn-ui components (`components/ui/`)

Standard shadcn components used throughout: `Button`, `Card`, `Input`, `Label`, `Select`, `Textarea`, `Badge`, `Dialog`, `Tabs`, `Slider`, `Sonner` (toast).

Configuration in `components.json`:
- Style: `base-nova`
- Icon library: `lucide`
- CSS variables: enabled
- No Tailwind config file (v4 uses CSS-based config)

---

## 7. Hooks

### `useFetch<T>(fn, deps)`

**File**: `src/hooks/useFetch.ts`

The primary data-fetching hook used by every page. Wraps an async function with loading, error, and data state.

```ts
const { data, loading, error, refetch } = useFetch(() => api.batches.get(id), [id]);
```

- Calls `fn()` on mount and whenever `deps` change.
- Tracks a `refreshKey` -- calling `refetch()` increments it, triggering a re-run.
- Uses a `cancelled` flag in the cleanup to prevent stale state updates.
- Stores `fn` in a ref to avoid stale closures.

Returns `{ data: T | null, loading: boolean, error: string | null, refetch: () => void }`.

### `useChartColors()`

**File**: `src/hooks/useChartColors.ts`

Reads computed CSS custom property values (e.g. `--chart-1`) from `document.documentElement`. Recharts needs concrete color strings since SVG attributes do not resolve `var()`. Re-runs when `resolvedTheme` changes (from `next-themes`) so chart colors update on theme toggle.

---

## 8. Utility libraries

### `lib/fermentation.ts`

Pure functions for winemaking math:
- `abv(og, sg)` -- Estimated ABV using the standard 131.25 formula.
- `attenuation(og, sg)` -- Estimated attenuation percentage, capped at 100.
- `velocity(readings, windowHours=48)` -- Gravity change per day over the given window.
- `detectStall(readings)` -- Returns a reason string if fermentation seems stalled.
- `tempStats(readings)` -- Min/max/avg temperature.
- `daysSince(isoDate)` -- Integer days since a timestamp.
- `projectedDaysToTarget(currentSG, targetSG, velocityPerDay)` -- Estimated days to reach target gravity.

### `lib/csv.ts`

CSV export utilities:
- `readingsToCSV(readings)` -- Formats readings as CSV (Timestamp, Gravity, Temperature_C, Source).
- `activitiesToCSV(activities)` -- Formats activities as CSV with JSON-stringified details.
- `downloadCSV(content, filename)` -- Creates a Blob and triggers a browser download.

### `lib/dates.ts`

Date formatting powered by date-fns:
- `timeAgo(dateStr)` -- Returns a human-readable relative time string such as "3 days ago" or "in 6 days". Direction (past or future) is automatic. Handles bare `YYYY-MM-DD` dates, ISO strings with time zone suffixes, and SQLite datetime strings without a `Z` suffix by treating them as UTC.

### `lib/utils.ts`

The standard shadcn `cn()` function: `clsx` + `tailwind-merge`.

---

## 9. Data flow

**There is no client-side state management library.** The API is the single source of truth.

### Pattern

1. Pages call `useFetch()` on mount to load data from the API.
2. User actions call `api.*` methods directly.
3. After a mutation, the page calls `refetch()` to reload from the API.
4. There are no optimistic updates -- the UI waits for the server response.
5. There is no global state shared between pages. Navigating away discards page state.

### Error handling pattern

Every page follows the same pattern:
```tsx
const { data, loading, error, refetch } = useFetch(...);

{loading && <p>Loading...</p>}
{error && <p className="text-destructive">...</p>}
{data && <ActualContent />}
```

Mutations use `try`-`catch` with `toast.error()` for failures and `toast.success()` for confirmations.

### Parallel fetching

`BatchDetail` is the most complex page. It fires four parallel fetches on mount:
- `api.batches.get(id)` -- batch metadata
- `api.readings.listByBatch(id, { limit: 500 })` -- readings
- `api.activities.list(id)` -- activities
- `api.devices.list()` -- all devices (filtered client-side)

### Component-level fetching

Some components fetch their own data:
- `BatchCard` fetches readings for its sparkline.
- `DeviceCard` (in Settings) fetches readings per device.
- `ActivitySection` fetches activities independently from the page.

---

## 10. Styling approach

### Tailwind CSS v4

This project uses **Tailwind v4 with no `tailwind.config.js`**. All configuration is in `src/index.css`:

- `@import "tailwindcss"` -- core Tailwind.
- `@import "tw-animate-css"` -- animation utilities.
- `@import "shadcn/tailwind.css"` -- shadcn base styles.
- `@import "@fontsource-variable/geist"` and `@import "@fontsource-variable/playfair-display"` -- fonts.
- `@custom-variant dark (&:is(.dark *))` -- dark mode via class strategy.
- `@theme inline { ... }` -- maps CSS custom properties to Tailwind tokens.

### Color System

Uses oklch colors defined as CSS custom properties on `:root` (light) and `.dark` (dark). The theme is wine-inspired:
- Primary: deep wine (`oklch(0.385 0.14 15)` light, `oklch(0.55 0.14 15)` dark)
- Background: warm off-white (`oklch(0.985 0.004 75)` light / `oklch(0.155 0.015 15)` dark)
- Five chart colors for data visualization.

### Fonts

- **Body**: Geist Variable (sans-serif), set as `--font-sans`.
- **Headings**: Playfair Display Variable (serif), set as `--font-heading`, applied via `font-heading` class.

### Layout conventions

- Pages use `max-w-lg lg:max-w-3xl mx-auto` for centered, responsive content.
- Mobile-first: single column on small screens, wider on `lg`.
- Consistent `p-4` page padding.
- `divide-y divide-border` for list separators.
- `tabular-nums` on all numeric displays.

### Known gotchas

1. **twMerge strips Badge margin/gap**: shadcn's `Badge` uses `tailwind-merge` which can strip custom margin or gap classes. **Workaround**: Wrap badges in a `<div>` or `<span>` and apply spacing to the wrapper, not the Badge itself.

2. **`space-y-*` collapses with `overflow-hidden` Cards**: Tailwind's `space-y-*` uses margin-top on siblings, which collapses when a parent has `overflow-hidden` (common on Card components). **Workaround**: Use `flex flex-col gap-*` instead of `space-y-*` when children might be inside cards or containers with overflow clipping.

---

## 11. PWA setup

### Manifest (`public/manifest.json`)

```json
{
  "name": "Wine Cellar",
  "short_name": "Wine Cellar",
  "display": "standalone",
  "background_color": "#faf8f5",
  "theme_color": "#722F37",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192" },
    { "src": "/icon-512.png", "sizes": "512x512" }
  ]
}
```

### Service worker (`public/sw.js`)

**Caching strategy** (cache name: `wine-cellar-v4`):

| Request Type | Strategy | Rationale |
| ------------ | -------- | --------- |
| `/api/*`, `/webhook/*` | Network only | API data must be fresh |
| Navigation (HTML) | Network first, cache fallback | Deploys are immediately visible, but offline still works |
| Static assets (JS, CSS, fonts) | Cache first, then network (stale-while-revalidate) | Hashed filenames mean cached versions are correct |

On install, pre-caches `/` and `/index.html`. On activate, purges old cache versions. Uses `skipWaiting()` and `clients.claim()` for immediate activation.

### Push notifications

The service worker handles two push-related events:

**`push` event**: Parses the JSON payload and shows a notification. For `stage_suggestion` alerts, adds two action buttons:
- "Advance Now" -- navigates to `/batches/:id?action=advance&stage=<nextStage>`
- "Close" -- navigates to `/batches/:id?action=dismiss&alertId=<alertId>`

The service worker tags all notifications by `type-alertId` to replace stale notifications of the same kind.

**`notificationclick` event**: Closes the notification and navigates to the appropriate URL. Tries to focus an existing window first; opens a new one if needed.

**Client-side subscription** (in `Settings` page):
1. Check for `serviceWorker` and `PushManager` support.
2. Request notification permission.
3. Fetch VAPID public key from `api.push.vapidKey()`.
4. Subscribe via `pushManager.subscribe()` with the VAPID key.
5. Send the subscription (endpoint + keys) to `api.push.subscribe()`.
6. To unsubscribe: call `api.push.unsubscribe()` then `sub.unsubscribe()`.

---

## 12. Proxy functions (Cloudflare Pages Functions)

Cloudflare Pages hosts the dashboard. Three Pages Functions proxy requests to the API Worker, enabling same-origin requests that automatically include Cloudflare Access cookies:

| Function File | Path Pattern | Target |
| ------------- | ------------ | ------ |
| `functions/api/[[path]].ts` | `/api/*` | `wine-cellar-api.rdrake.workers.dev` |
| `functions/webhook/[[path]].ts` | `/webhook/*` | `wine-cellar-api.rdrake.workers.dev` |
| `functions/health.ts` | `/health` | `wine-cellar-api.rdrake.workers.dev` |

Each function rewrites the hostname while preserving the full path and original request (method, headers, body):

```ts
export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  url.hostname = "wine-cellar-api.rdrake.workers.dev";
  return fetch(new Request(url.toString(), context.request));
};
```

This same-origin pattern means:
- The front end never needs to know the API Worker's URL.
- The browser sends Cloudflare Access session cookies automatically.
- No CORS configuration needed.
- 401 responses from the API reset auth state and show the login page.

---

## 13. Adding a new page

Step-by-step:

1. **Create the page component** in `src/pages/YourPage.tsx`.
2. **Add a route** in `src/App.tsx` inside the `<Route element={<Layout />}>` block.
3. **Fetch data** using `useFetch()` with the appropriate `api.*` call.
4. **Follow the layout pattern**: `<div className="p-4 max-w-lg lg:max-w-3xl mx-auto">`.
5. **Handle states**: loading, error, and data.
6. **Add navigation** (optional): add a tab to `BottomNav.tsx` or link from an existing page.
7. **Add API endpoints** (if needed): add methods to the `api` object in `api.ts` and types in `types.ts`.

---

## 14. File tree reference

```
dashboard/
  components.json             # shadcn/ui configuration
  package.json
  vite.config.ts              # Vite + React + Tailwind plugins, @ alias
  functions/
    api/[[path]].ts           # Proxy /api/* to API Worker
    webhook/[[path]].ts       # Proxy /webhook/* to API Worker
    health.ts                 # Proxy /health to API Worker
  public/
    manifest.json             # PWA manifest
    sw.js                     # Service worker (caching + push)
    icon-192.png
    icon-512.png
  src/
    main.tsx                  # Entry point: StrictMode + createRoot
    App.tsx                   # Router + ThemeProvider + AuthGate + all routes
    api.ts                    # API client (apiFetch, api object, auth endpoints)
    types.ts                  # All TypeScript types, enums, label maps
    index.css                 # Tailwind v4 config, theme, fonts
    components/
      AuthGate.tsx            # Auth state wrapper: checks session, renders Login or app
      Layout.tsx              # Shell: header + Outlet + BottomNav + Toaster
      BottomNav.tsx           # Fixed bottom tab bar (4 tabs)
      ThemeToggle.tsx         # Light/dark/system cycle button
      Sparkline.tsx           # SVG sparklines (Gravity + Temperature variants)
      BatchCard.tsx           # Batch list item with sparklines
      BatchForm.tsx           # Reusable batch create/edit form
      BatchStats.tsx          # Computed fermentation stats card
      BatchTimeline.tsx       # Current phase progress + milestone timeline
      NudgeBar.tsx            # Dismissible contextual suggestions per batch
      ReadingsChart.tsx       # Recharts gravity/temp chart with activity markers
      ActivitySection.tsx     # Activity list + edit dialog
      ActivityItem.tsx        # Single activity card
      DetailFields.tsx        # Dynamic form fields per activity type
      DeviceSection.tsx       # Device assignment for a batch
      ExportButton.tsx        # CSV export for readings + activities
      ui/                     # shadcn/ui primitives (button, card, input, etc.)
    hooks/
      useFetch.ts             # Generic async data fetching hook
      useChartColors.ts       # Resolved CSS variables for Recharts
    lib/
      utils.ts                # cn() (clsx + tailwind-merge)
      fermentation.ts         # ABV, attenuation, velocity, stall detection, etc.
      csv.ts                  # CSV generation and download
      dates.ts                # timeAgo() relative date formatting (date-fns)
    pages/
      Login.tsx               # GitHub OAuth + passkey sign-in
      Welcome.tsx             # Onboarding: display name + passkey setup
      Dashboard.tsx
      BatchList.tsx
      BatchDetail.tsx
      BatchNew.tsx
      BatchEdit.tsx
      ActivityNew.tsx
      Settings.tsx
      Tools.tsx
      BatchComparison.tsx
      Devices.tsx             # Standalone devices page (not currently routed)
```

Note: `Devices.tsx` exists in the pages directory but is not referenced in `App.tsx` routing. The `Settings` page integrates its functionality instead.
