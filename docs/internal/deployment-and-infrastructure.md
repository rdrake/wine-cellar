# Deployment and infrastructure

Internal documentation covering the full deployment architecture, configuration, and operational procedures for the Wine Cellar project.

---

## 1. Architecture overview

```
                                    Cloudflare Network
                                   +-------------------------------------------+
                                   |                                           |
                                   |  Cloudflare Access (SSO gate)             |
                                   |       |                                   |
Browser ──────>  Cloudflare Pages  |       v                                   |
  (SPA)         +------------------+-------+--------------------+              |
                | wine-cellar-dashboard                         |              |
                |                                               |              |
                |  Static Assets     Pages Functions             |              |
                |  (Vite build)      /api/*   ──proxy──+        |              |
                |                    /webhook/* ─proxy──+       |              |
                |                    /health  ──proxy──+        |              |
                +-----------------------+------+--------+       |              |
                                        |      |        |      |              |
                                        v      v        v      |              |
                              +-----------------------------------+            |
                              | wine-cellar-api (Worker)          |            |
                              |   Hono router                     |            |
                              |   Smart Placement enabled         |            |
                              |   Cron: every 15 min              |            |
                              +----------------+------------------+            |
                                               |                               |
                                               v                               |
                                        +-------------+                        |
                                        | D1 Database |                        |
                                        | wine-cellar |                        |
                                        |    -api     |                        |
                                        +-------------+                        |
                                                                               |
                              External:                                        |
                              RAPT Pill ──webhook POST──> /webhook/rapt        |
                              (via RAPT cloud)                                 |
                                   +-------------------------------------------+
```

**Request flow:**

1. Browser loads the SPA from Cloudflare Pages (static HTML/JS/CSS).
2. Cloudflare Access sits in front of the Pages domain and requires SSO login. It injects a `Cf-Access-Jwt-Assertion` header/cookie.
3. When the SPA makes API calls to `/api/v1/*`, Pages Functions proxy the request to the API Worker at `wine-cellar-api.rdrake.workers.dev`, forwarding the Access JWT.
4. The API Worker validates the JWT, resolves the user from D1, and handles the request.
5. Webhooks from external devices (RAPT Pill) hit `/webhook/rapt` and authenticate via `X-Webhook-Token` header instead of Access JWT.

---

## 2. API Worker deployment

### Wrangler configuration

**File:** `api/wrangler.toml`

| Setting              | Value                                          |
|----------------------|------------------------------------------------|
| `name`               | `wine-cellar-api`                              |
| `main`               | `src/index.ts`                                 |
| `compatibility_date` | `2025-11-02`                                   |
| `placement.mode`     | `smart` (auto-routes to optimal data center)   |

### D1 database binding

| Field           | Value                                    |
|-----------------|------------------------------------------|
| `binding`       | `DB`                                     |
| `database_name` | `wine-cellar-api`                        |
| `database_id`   | `08d5d178-c4f1-4be2-9906-5acea05682ae`  |

The Worker accesses D1 through `env.DB` throughout the codebase.

### Cron trigger

```toml
[triggers]
crons = ["*/15 * * * *"]
```

Every 15 minutes, the Worker's `scheduled` handler runs `evaluateAllBatches()`. This:
- Queries all active batches from D1
- Evaluates alert rules (gravity targets, temperature thresholds, stall detection)
- Sends Web Push notifications for any newly-fired alerts

### Entry point

**File:** `api/src/index.ts`

Exports two handlers:
- `fetch` -- delegates to the Hono app (`api/src/app.ts`)
- `scheduled` -- runs the cron alert evaluation, passing `DB`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY` from env

### Environment variables and secrets

`api/src/app.ts` defines the `Bindings` type:

```typescript
export type Bindings = {
  DB: D1Database;
  CF_ACCESS_AUD: string;
  CF_ACCESS_TEAM: string;
  WEBHOOK_TOKEN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  API_KEY?: string;           // Legacy -- kept during rollout
};
```

**What goes where:**

| Variable            | Storage            | Notes                                                |
|---------------------|--------------------|------------------------------------------------------|
| `CF_ACCESS_TEAM`    | `wrangler.toml` vars | Value: `rdrake`. Non-secret team/org name.           |
| `CF_ACCESS_AUD`     | Wrangler secret    | The Access Application audience tag (sensitive).     |
| `WEBHOOK_TOKEN`     | Wrangler secret    | Shared secret for RAPT webhook authentication.       |
| `VAPID_PUBLIC_KEY`  | Wrangler secret    | Web Push VAPID public key (base64url).               |
| `VAPID_PRIVATE_KEY` | Wrangler secret    | Web Push VAPID private key (base64url). Keep secret. |
| `API_KEY`           | Wrangler secret    | Legacy API key, optional, being phased out.          |

Secrets are set by using:
```bash
cd api
npx wrangler secret put CF_ACCESS_AUD
npx wrangler secret put WEBHOOK_TOKEN
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
```

### How to deploy

```bash
cd api
npm run deploy        # runs: wrangler deploy
```

This builds the TypeScript and deploys to `wine-cellar-api.rdrake.workers.dev`.

---

## 3. Dashboard deployment

### Cloudflare Pages project

| Setting          | Value                                       |
|------------------|---------------------------------------------|
| Project name     | `wine-cellar-dashboard`                     |
| Account ID       | `bb62306bdb32c0f31736d4023835d6e4`          |
| Build command    | `tsc -b && vite build` (from `npm run build`) |
| Output directory | `dist` (Vite default)                       |
| Framework        | React 19 + Vite 8 + Tailwind CSS 4         |

### Auto-deploys

The Pages project connects to GitHub. Every push to `main` triggers an automatic build and deploy. The dashboard requires no manual deployment step.

### SPA fallback

**File:** `dashboard/public/_redirects`

```
/* /index.html 200
```

This tells Cloudflare Pages to serve `index.html` for all routes that do not match a static file, enabling client-side routing through React Router.

### PWA manifest

**File:** `dashboard/public/manifest.json`

The manifest configures the app as a standalone PWA ("Wine Cellar") with a wine-themed color scheme (`#722F37`). Icons at 192px and 512px.

---

## 4. Proxy architecture (Pages Functions)

The dashboard and API share the same origin through Cloudflare Pages Functions. This is critical because Cloudflare Access scopes its cookies to the Pages domain -- the API Worker on its own `workers.dev` subdomain would not receive them from the browser.

### How it works

Pages Functions live in `dashboard/functions/` and use file-based routing:

| Function file                          | Route matched   | Purpose                     |
|----------------------------------------|-----------------|-----------------------------|
| `functions/api/[[path]].ts`            | `/api/*`        | Proxy all API requests      |
| `functions/webhook/[[path]].ts`        | `/webhook/*`    | Proxy webhook requests      |
| `functions/health.ts`                  | `/health`       | Proxy health check          |

**The `[[path]]` catch-all pattern:**

Cloudflare Pages uses double-bracket notation `[[path]]` to match any number of path segments. For example, `functions/api/[[path]].ts` catches:
- `/api/v1/batches`
- `/api/v1/batches/abc-123/activities`
- `/api/v1/devices/xyz/readings`
- Any depth under `/api/`

Each proxy function does the same thing:

```typescript
export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  url.hostname = "wine-cellar-api.rdrake.workers.dev";
  return fetch(new Request(url.toString(), context.request));
};
```

It rewrites the hostname to the API Worker's `workers.dev` address while preserving the full path, query string, headers (including `Cf-Access-Jwt-Assertion`), method, and body. The API Worker receives the request as if it came directly.

**Why this matters:**
- The browser never talks to `wine-cellar-api.rdrake.workers.dev` directly.
- Cloudflare Access cookies flow naturally on the same origin.
- The same-origin setup eliminates CORS configuration (comment in `app.ts`: "No CORS needed -- same origin").

---

## 5. Local development setup

### API (worker)

```bash
cd api
npm run dev          # runs: wrangler dev
```

This starts the Worker locally on **port 8787** with:
- A local D1 SQLite database (stored in `api/.wrangler/state/`)
- Access to secrets from `.dev.vars` file (create manually for local development)
- The cron handler available for manual triggering via the wrangler dashboard

### Dashboard (Vite)

```bash
cd dashboard
npm run dev          # runs: vite
```

Vite starts on its default port (typically **5173**).

### How they work together

**In production**, Pages Functions proxy `/api/*` to the Worker. **Locally**, Vite needs to replicate this. The Vite config (`dashboard/vite.config.ts`) does not include an explicit proxy -- instead, local development relies on either:

1. **Cloudflare Pages local dev** (`npx wrangler pages dev`) which runs Pages Functions locally and handles the proxy, or
2. **Adding a Vite proxy** for development convenience:
   ```typescript
   // In vite.config.ts server block:
   server: {
     proxy: {
       '/api': 'http://localhost:8787',
       '/webhook': 'http://localhost:8787',
       '/health': 'http://localhost:8787',
     }
   }
   ```

For local dev, the Access JWT middleware has a test bypass: when `CF_ACCESS_TEAM` is set to `"test"`, the middleware accepts tokens in the format `test-jwt-for:<email>` without cryptographic verification.

### Local environment files

Create `api/.dev.vars` for local secrets:
```
CF_ACCESS_AUD=test-aud
CF_ACCESS_TEAM=test
WEBHOOK_TOKEN=local-webhook-token
VAPID_PUBLIC_KEY=<your-vapid-public>
VAPID_PRIVATE_KEY=<your-vapid-private>
```

---

## 6. D1 database management

### Creating the database

Wrangler created the database one time by using:
```bash
npx wrangler d1 create wine-cellar-api
```

`api/wrangler.toml` records the resulting `database_id`.

### Migration files

Migrations live in `api/migrations/` and Wrangler applies them in order:

| File                            | Purpose                                          |
|---------------------------------|--------------------------------------------------|
| `0001_initial.sql`              | Core tables: users, batches, activities, devices, readings |
| `0002_readings_source.sql`      | Add source tracking to readings                  |
| `0003_activity_reading_link.sql`| Link activities to readings                      |
| `0004_multi_tenant.sql`         | Add user_id to all tables for multi-tenancy      |
| `0005_service_tokens.sql`       | Service token to user mapping table              |
| `0006_alerts_and_stages.sql`    | Alert rules, fired alerts, batch stages          |

### Applying migrations to production

```bash
cd api
npx wrangler d1 migrations apply wine-cellar-api --remote
```

The `--remote` flag targets the production D1 database. Without it, migrations apply to the local SQLite copy only.

### Applying migrations locally

```bash
cd api
npx wrangler d1 migrations apply wine-cellar-api
```

(No `--remote` flag -- applies to the local `.wrangler/state/` database.)

### Querying production data

```bash
cd api
npx wrangler d1 execute wine-cellar-api --remote --command "SELECT COUNT(*) FROM batches"
```

For multi-line queries, use `--file`:
```bash
npx wrangler d1 execute wine-cellar-api --remote --file query.sql
```

### Listing applied migrations

```bash
npx wrangler d1 migrations list wine-cellar-api --remote
```

---

## 7. Cloudflare Access integration

Cloudflare Access provides authentication for the application. It sits as a reverse proxy in front of the Pages domain.

### How it works

1. A user navigates to the Wine Cellar dashboard URL.
2. Cloudflare Access intercepts the request and requires SSO login (configured in the Cloudflare Zero Trust dashboard).
3. On successful authentication, Access sets a cookie containing a signed JWT.
4. The Pages Functions forward this JWT (through the `Cf-Access-Jwt-Assertion` header) to the API Worker.
5. The API Worker validates the JWT by:
   - Fetching the JWKS (public keys) from `https://{team}.cloudflareaccess.com/cdn-cgi/access/certs`
   - Verifying the RSA-SHA256 signature
   - Checking the `aud` claim matches `CF_ACCESS_AUD`
   - Checking the token is not expired
   - Extracting the `email` (for browser users) or `common_name` (for service tokens)
6. The user is upserted into the `users` table on first access.

### Configuration values

| Value              | Meaning                                                      |
|--------------------|--------------------------------------------------------------|
| `CF_ACCESS_TEAM`   | The Cloudflare Zero Trust team/org name (value: `rdrake`). Used to construct the JWKS endpoint URL. Stored as a plain variable in `wrangler.toml`. |
| `CF_ACCESS_AUD`    | The audience tag of the Access Application. A unique hex string generated when the Access Application is created. Must match the `aud` claim in the JWT. Stored as a secret. |

### Service tokens

Cloudflare Access also supports service tokens (noninteractive, M2M). The API Worker detects these by the presence of `common_name` instead of `email` in the JWT payload, then looks up a `service_tokens` table to map the client ID to an existing user.

### Auth bypass routes

The Access middleware (`api/src/middleware/access.ts`) skips JWT validation for:
- `/health` -- health check endpoint
- `/webhook/*` -- webhook endpoints use their own `X-Webhook-Token` auth

---

## 8. Secrets management summary

### Stored in `wrangler.toml` (plain text, committed to repo)

These are non-sensitive configuration values:

| Key                | Value      |
|--------------------|------------|
| `CF_ACCESS_TEAM`   | `rdrake`   |

### Stored as Wrangler secrets (encrypted, NOT in repo)

Set by using `npx wrangler secret put <NAME>`:

| Key                  | Purpose                                             |
|----------------------|-----------------------------------------------------|
| `CF_ACCESS_AUD`      | Access Application audience tag for JWT validation  |
| `WEBHOOK_TOKEN`      | Shared secret for authenticating RAPT webhooks      |
| `VAPID_PUBLIC_KEY`   | Web Push VAPID public key (base64url-encoded)       |
| `VAPID_PRIVATE_KEY`  | Web Push VAPID private key (base64url-encoded)      |
| `API_KEY`            | Legacy API key (optional, being phased out)         |

### Local Development

For local `wrangler dev`, secrets go in `api/.dev.vars` (this file should be in `.gitignore`). Format is plain `KEY=VALUE` per line.

### The `.wrangler/` directory

The `.wrangler/` directory at the project root is a local cache used by Pages:
- `.wrangler/cache/pages.json` -- caches the Pages project name and account ID
- `.wrangler/cache/wrangler-account.json` -- caches the account name and ID

The API worker has its own `.wrangler/` inside `api/` for local D1 state. Both directories should be in `.gitignore`.
