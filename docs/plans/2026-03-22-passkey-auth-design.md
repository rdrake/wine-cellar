# Passkey Authentication Design (v3.1)

> Revised through three rounds of Codex review. v2 addressed: CF Access origin conflict, public
> endpoint abuse, WebAuthn ceremony details, session token hashing, schema completeness, cookie
> policy. v3 addressed: bootstrap ownership takeover, user model reconciliation, dual-auth
> semantics, challenge binding, auth/status contract, sign-count edge cases. v3.1 addresses:
> CF Access recovery path consistency, bootstrap email mismatch safety.

**Goal:** Add Face ID / Touch ID passkey authentication so the app can be opened on mobile without needing an active GitHub session.

**Approach:** Remove Cloudflare Access from the Pages domain. The SPA shell becomes public (it contains no sensitive data). All auth enforcement moves into the API middleware via passkey session cookies. CF Access JWT verification remains in the middleware as a recovery-only fallback (re-enable CF Access temporarily if all passkey devices are lost).

---

## Auth Flow

### First Launch (bootstrap)

1. User opens the app for the first time — SPA loads without auth.
2. `GET /api/v1/auth/status` returns `{ registered: false, authenticated: false }`.
3. App shows a setup page: email field + setup token field + "Create Passkey" button.
4. User enters their email (must match an existing `users` row from CF Access history) and the one-time `SETUP_TOKEN` from their server config.
5. `POST /auth/bootstrap/options` validates the setup token and email, returns WebAuthn registration options.
6. Browser prompts to create a discoverable credential (Touch ID / Face ID).
7. `POST /auth/bootstrap` validates the setup token again, stores the credential linked to the existing user, and issues a session cookie. User lands on the dashboard.
8. Bootstrap routes return 403 after the first credential is registered, regardless of token.

**Why a setup token?** Without it, the bootstrap endpoints are an unauthenticated ownership-takeover path — anyone on the internet could race to register the first passkey. The `SETUP_TOKEN` is a random secret set in `wrangler.toml` (like `WEBHOOK_TOKEN`). It proves the caller controls the server config.

**Why email?** The existing `users` table has data (batches, readings, activities) keyed by `user_id`. Bootstrap must link the passkey to the *existing* user, not create a new one. The email identifies which user row to attach the credential to. Bootstrap requires the email to match an existing `users` row — it returns 404 if no user is found. It never creates a new user. This prevents a typo from stranding all existing batch data behind a wrong `user_id` after bootstrap locks. (On a fresh install, the migration seeds the owner account, so there is always a user to match.)

### Login (returning user)

1. User opens the PWA. `GET /api/v1/auth/status` returns `{ registered: true, authenticated: false }`.
2. App shows a login page with "Sign in with Face ID."
3. Browser prompts biometric verification.
4. API verifies the WebAuthn assertion, issues a 24-hour session cookie.
5. `GET /api/v1/auth/status` now returns `{ registered: true, authenticated: true }`.
6. All subsequent API requests use that cookie.

### Authenticated session

1. User opens the PWA. `GET /api/v1/auth/status` returns `{ registered: true, authenticated: true }`.
2. App renders the dashboard immediately.

### Middleware

```
Request arrives
  → Exempt route? (/health, /webhook, /auth/login/*, /auth/bootstrap/*, /auth/status)
    → skip auth
  → __Host-session cookie?
    → hash token, look up in auth_sessions, check expiry → user
  → Cf-Access-Jwt-Assertion header?
    → verify JWT (existing flow) → user
  → Neither? → 401
```

Session cookie is checked first (primary path). CF Access JWT is a **recovery-only fallback**: in normal operation, CF Access is disabled on the domain. If you lose all passkey devices, temporarily re-enable CF Access in the Zero Trust dashboard, set `CF_ACCESS_AUD` as a Wrangler secret, and log in via GitHub. The middleware resolves the JWT to a user, and `/auth/status` reports `authenticated: true`, granting access to the Settings page to register a new passkey. Then disable CF Access and remove the secret.

---

## WebAuthn Ceremony Configuration

**Relying Party:**
- `rpID`: from `RP_ID` env var (`wine-cellar-dashboard.pages.dev` in prod, `localhost` in dev)
- `rpName`: `"Wine Cellar"`
- `expectedOrigin`: from `RP_ORIGIN` env var (supports array for dev + prod)

**Registration (bootstrap and additional):**
- `authenticatorSelection.residentKey`: `"required"` — discoverable credential for usernameless login
- `authenticatorSelection.userVerification`: `"required"` — always prompt biometric/PIN
- `excludeCredentials`: existing credential IDs for this user — prevents duplicate registration
- `userID`: random 64-byte `Uint8Array` per user (WebAuthn user handle, not the DB id). Generated once per user and stored in `passkey_credentials.webauthn_user_id`. Reused for all credentials belonging to the same user.

**Authentication:**
- `allowCredentials`: `[]` (empty) — lets the browser offer any discoverable credential for this RP
- `userVerification`: `"required"`

---

## Data Model

### New table: `passkey_credentials`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Credential ID (base64url) |
| `user_id` | TEXT NOT NULL | FK to users.id |
| `public_key` | BLOB NOT NULL | COSE public key bytes |
| `webauthn_user_id` | TEXT NOT NULL | Random 64-byte handle (base64url), same for all creds of one user |
| `sign_count` | INTEGER DEFAULT 0 | Replay detection |
| `transports` | TEXT | JSON array, e.g. `["internal","hybrid"]` |
| `device_type` | TEXT | `"singleDevice"` or `"multiDevice"` |
| `backed_up` | INTEGER DEFAULT 0 | Whether synced (iCloud Keychain, etc.) |
| `created_at` | TEXT NOT NULL | |
| `last_used_at` | TEXT | |

### New table: `auth_challenges`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Random ID |
| `challenge` | TEXT NOT NULL | Base64url challenge value |
| `type` | TEXT NOT NULL | `"bootstrap"`, `"login"`, or `"register"` |
| `user_id` | TEXT | Nullable. Set for `register` (must match session user). Null for `login`/`bootstrap`. |
| `expires_at` | TEXT NOT NULL | 5 minutes from creation |
| `created_at` | TEXT NOT NULL | |

Consumed atomically with type verification:
```sql
DELETE FROM auth_challenges
WHERE id = ? AND type = ? AND expires_at > datetime('now')
RETURNING challenge, user_id
```

The `options` endpoint returns `{ challengeId, options }`. The client sends `challengeId` back with the credential response. This round-trips the challenge binding without storing state client-side.

### New table: `auth_sessions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | SHA-256 hash of the raw token (hex) |
| `user_id` | TEXT NOT NULL | FK to users.id |
| `expires_at` | TEXT NOT NULL | 24 hours from creation |
| `created_at` | TEXT NOT NULL | |

Raw token goes in the cookie. DB stores only the hash. Lookup: hash the cookie value, query by hash.

No changes to existing tables.

---

## API Routes

All under `/api/v1/auth/`:

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /auth/status` | None (reads cookie or JWT if present) | Returns `{ registered: boolean, authenticated: boolean }` |
| `POST /auth/bootstrap/options` | Setup token + email in body | Registration options for first-time setup |
| `POST /auth/bootstrap` | Setup token + email in body | Store first credential, issue session |
| `POST /auth/login/options` | None | Generate authentication challenge |
| `POST /auth/login` | None | Verify assertion, set session cookie |
| `POST /auth/register/options` | Session required | Registration options for additional passkeys |
| `POST /auth/register` | Session required | Store additional credential |
| `POST /auth/logout` | Session required | Delete session, clear cookie |

### Bootstrap request body

```json
{
  "setupToken": "<SETUP_TOKEN from wrangler.toml>",
  "email": "richard@example.com"
}
```

Bootstrap validates:
1. `setupToken` matches `env.SETUP_TOKEN` (constant-time comparison).
2. No credentials exist in `passkey_credentials` (return 403 otherwise).
3. Look up user by email in `users` table. If found, attach credential to that user. If not found, return 404 (never auto-creates users).

### `/auth/status` behavior

This endpoint is unauthenticated but reads auth state if present:
- Checks `passkey_credentials` count → `registered`
- If `__Host-session` cookie present, hashes and looks up in `auth_sessions` → `authenticated`
- If no valid session but `Cf-Access-Jwt-Assertion` header present and `CF_ACCESS_AUD` is set, verify JWT → `authenticated` (recovery path)
- Returns `{ registered: boolean, authenticated: boolean }`

This single endpoint drives all three AuthGate states (setup, login, dashboard). The CF Access JWT check in `/auth/status` is what makes the recovery path work: a user who re-enables CF Access and logs in via GitHub will see `authenticated: true` and get the full app, including the Settings page to register a new passkey.

---

## Session Cookie

```
__Host-session=<hex token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400
```

- `__Host-` prefix: browser enforces `Secure`, no `Domain`, `Path=/`
- `SameSite=Lax`: sends cookie on top-level navigations (push notification taps) but not cross-origin subresource requests. `Strict` would break notification deep links.
- 24-hour expiry.

---

## Security

- **Bootstrap ownership**: `SETUP_TOKEN` env var (random secret in `wrangler.toml`) required for bootstrap. Proves caller controls the server. Bootstrap permanently locks after first credential is registered.
- **Session tokens**: 32 random bytes (`crypto.getRandomValues`), SHA-256 hashed at rest. Revocation is instant (delete the row).
- **Challenges**: single-use, 5-minute TTL, typed (`bootstrap`/`login`/`register`), bound to user when applicable. Consumed atomically via `DELETE ... RETURNING`. `challengeId` round-tripped from options→verify to bind the response to the correct challenge.
- **Sign count**: update via `UPDATE ... SET sign_count = ? WHERE id = ? AND (sign_count = 0 OR sign_count < ?)`. If both stored and incoming counts are 0, the authenticator does not support counters — skip the check. Only enforce when stored count > 0. This prevents locking out valid credentials from authenticators that always report 0.
- **Rate limiting**: Cloudflare WAF rule on the zone — limit `/api/v1/auth/login/*` and `/api/v1/auth/bootstrap/*` to 10 requests/minute/IP. Edge-enforced, zero code.
- **Expired row cleanup**: cron purges `auth_sessions` and `auth_challenges` every 15 minutes.
- **CF Access JWT as recovery**: not a concurrent auth system. In normal operation, CF Access is disabled and `CF_ACCESS_AUD` is unset (middleware skips JWT path). Recovery flow: re-enable CF Access → set `CF_ACCESS_AUD` secret → log in via GitHub → `/auth/status` returns `authenticated: true` via JWT → register new passkey → disable CF Access → delete secret.

---

## Dashboard Changes

### New: Auth gate (`AuthGate.tsx`)

Wraps the entire app. On mount:
- `GET /api/v1/auth/status`
- `{ registered: false, authenticated: false }` → render `<Setup />`
- `{ registered: true, authenticated: false }` → render `<Login />`
- `{ registered: true, authenticated: true }` → render `<App />`

### New: Setup page (`/setup`)

- "Set up your Wine Cellar" heading.
- Email input + setup token input + "Create Passkey" button.
- Calls bootstrap/options with token + email, then `startRegistration()`.
- On success: session cookie set, render dashboard.

### New: Login page (`/login`)

- "Sign in with Face ID" button → `startAuthentication()`.
- On success: session cookie set, render dashboard.
- On failure: error message.

### Settings page additions

- "Register Another Passkey" button (for additional devices).
- "Log Out" button → `POST /api/v1/auth/logout`, redirect to `/login`.

### API client (`api.ts`)

- On 401: redirect to `/login` (replaces `window.location.reload()`).

### No changes to

- Existing pages or components.
- Service worker push handling.
- Batch/reading/activity logic.

---

## Deployment Changes

### Remove Cloudflare Access

- Delete the CF Access Application for the Pages domain in the Zero Trust dashboard.
- Remove `CF_ACCESS_AUD` from `wrangler.toml` vars. The middleware skips JWT verification when `CF_ACCESS_AUD` is not set.
- **Recovery:** If all passkey devices are lost, re-enable CF Access, set `CF_ACCESS_AUD` as a Wrangler secret (`wrangler secret put CF_ACCESS_AUD`), log in via GitHub to register a new passkey, then disable CF Access and delete the secret.

### Add WAF rate limiting

- Cloudflare dashboard → Security → WAF → Rate limiting rules.
- Rule: `/api/v1/auth/login/*` and `/api/v1/auth/bootstrap/*` → 10 req/min/IP → block.

### Add env vars

- `SETUP_TOKEN`: Wrangler secret (`wrangler secret put SETUP_TOKEN`), not a toml var. Generate with `openssl rand -hex 32`.
- `RP_ID`: `wine-cellar-dashboard.pages.dev` (prod), `localhost` (dev)
- `RP_ORIGIN`: `https://wine-cellar-dashboard.pages.dev` (prod), `http://localhost:5173` (dev)

---

## Libraries

- **API:** `@simplewebauthn/server` v13+ — WebAuthn ceremony (Cloudflare Workers compatible)
- **Dashboard:** `@simplewebauthn/browser` — browser-side WebAuthn helpers

---

## Out of Scope

- Multi-user self-service signup.
- Passkey management UI (list/revoke individual credentials) — can add later.
- Offline auth (service worker can't verify passkeys — requires API call).
