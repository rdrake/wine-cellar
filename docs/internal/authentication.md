# Authentication and multi-tenancy

Internal documentation for the wine-cellar API authentication system, covering OAuth login, passkey (WebAuthn) authentication, session management, API keys, webhook auth, onboarding, and tenant isolation.

---

## Table of contents

1. [Auth flow overview](#auth-flow-overview)
2. [OAuth (GitHub) login](#oauth-github-login)
3. [Passkey (WebAuthn) authentication](#passkey-webauthn-authentication)
4. [Session management](#session-management)
5. [API key authentication](#api-key-authentication)
6. [User provisioning and onboarding](#user-provisioning-and-onboarding)
7. [Client-side auth gating](#client-side-auth-gating)
8. [Passkey management](#passkey-management)
9. [Webhook auth](#webhook-auth)
10. [Multi-tenancy and tenant isolation](#multi-tenancy-and-tenant-isolation)
11. [Environment variables](#environment-variables)
12. [Edge cases and error handling](#edge-cases-and-error-handling)

---

## Auth flow overview

Every API request flows through a single Hono middleware (`accessAuth`) registered as a global wildcard in `api/src/app.ts`:

```
app.use("*", accessAuth);
```

The middleware supports two authentication methods, tried in order:

1. **Session cookie** (primary) -- used by the dashboard after OAuth or passkey login.
2. **API key** (secondary) -- used by MCP servers and automation scripts via `Authorization: Bearer wc-...` header.

If neither method produces a valid user, the middleware returns **401**.

```
Browser / Client
  |
  v
Cloudflare Worker (wine-cellar-api)
  |
  v
accessAuth middleware (api/src/middleware/access.ts)
  |-- Exempts public paths (see below)
  |-- Checks session cookie -> validates against auth_sessions table
  |-- If no session, checks Authorization header for API key -> validates against api_keys table
  |-- Resolves user from DB
  |-- Sets c.var.user (id, email, name, avatar_url) for downstream handlers
  |
  v
Route handler (has access to c.get("user"))
```

The API does not need CORS middleware because Cloudflare Pages serves the dashboard and API from the same origin (proxying API requests).

### Route exemptions

The middleware exempts the following path prefixes from authentication:

| Path | Reason |
|------|--------|
| `/health` | Health check, no sensitive data |
| `/webhook/*` | Uses its own `X-Webhook-Token` header auth (see [Webhook auth](#webhook-auth)) |
| `/api/v1/auth/status` | Checks whether the caller has a valid session |
| `/api/v1/auth/login` | Passkey login endpoints (challenge generation and verification) |
| `/api/v1/auth/github` | OAuth initiation and callback |
| `/api/v1/auth/settings` | Public settings (registration status) |

The middleware returns early with `next()` for these paths.

### Key files

| File | Purpose |
|------|---------|
| `api/src/middleware/access.ts` | Global auth middleware (session and API key validation) |
| `api/src/routes/auth.ts` | OAuth, passkey, session, API key, and passkey management routes |
| `api/src/lib/auth-session.ts` | Session creation, validation, cookie handling |
| `api/src/lib/auth-challenge.ts` | WebAuthn and OAuth challenge storage (single-use, time-limited) |
| `api/src/lib/api-keys.ts` | API key creation, validation, and revocation |
| `api/src/app.ts` | App setup, `Bindings` / `AppEnv` types |
| `api/src/lib/errors.ts` | Standardized error responses (401, 404, and so on) |

---

## OAuth (GitHub) login

The primary login method uses GitHub OAuth for identity verification. The `arctic` library handles the OAuth protocol.

### OAuth initiation

When a user clicks "Sign in with GitHub" on the login page, the browser navigates to `GET /api/v1/auth/github`. The handler:

1. Creates a `GitHub` client using `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
2. Generates a random `state` value (`crypto.randomUUID()`).
3. Stores the state in the `auth_challenges` table with type `"oauth"` and a 10-minute expiry.
4. Redirects the browser to GitHub's authorization URL with scopes `read:user` and `user:email`.

### OAuth callback

GitHub redirects back to `GET /api/v1/auth/github/callback` with `code` and `state` query parameters. The handler:

1. **Validates state**: Consumes the challenge from `auth_challenges` (single-use). If the state is missing or expired, redirects to `/login?error=invalid_state`.
2. **Exchanges code for token**: Calls `github.validateAuthorizationCode(code)` to get an access token. On failure, redirects to `/login?error=github_error`.
3. **Fetches the GitHub profile**: Calls the GitHub API at `https://api.github.com/user` with the access token.
4. **Resolves email**: Uses the profile email if present. If null, fetches `https://api.github.com/user/emails` and selects the primary verified email. If no email is available, redirects to `/login?error=email_required`.
5. **Resolves user identity** through three cases (in order):

| Case | Condition | Action |
|------|-----------|--------|
| Existing OAuth link | `oauth_accounts` row exists for `(github, githubId)` | Updates profile info, creates session, redirects to `/` |
| Existing user by email | `users` row exists with matching email | Links new `oauth_accounts` row, creates session, redirects to `/` |
| New user | No match, and `registrations_open` setting is `"true"` | Creates `users` row with `onboarded = 0`, links `oauth_accounts`, creates session, redirects to `/welcome` |

If the system has disabled registrations and no existing user matches, the handler redirects to `/login?error=registrations_closed`.

### Registration gating

A `settings` table controls whether new users can sign up:

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

The `registrations_open` key defaults to `"true"`. The `GET /api/v1/auth/settings` endpoint exposes this value so the login page can show a "signups closed" message.

### OAuth accounts schema

```sql
CREATE TABLE oauth_accounts (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, provider_user_id)
);
```

The compound primary key `(provider, provider_user_id)` supports adding more OAuth providers in the future, although only GitHub exists today.

---

## Passkey (WebAuthn) authentication

Passkeys provide a passwordless second login method by using the WebAuthn protocol. The `@simplewebauthn/server` library handles registration and authentication on the API side, and `@simplewebauthn/browser` handles the browser ceremony on the dashboard side.

### Passkey login flow

The login page offers "Sign in with Passkey" as an alternative to GitHub OAuth. The flow has two steps:

**Step 1: Generate authentication options** (`POST /api/v1/auth/login/options`)

The handler calls `generateAuthenticationOptions()` with:
- `rpID`: the relying party ID from `RP_ID` env var (the domain, such as `cellar.rdrake.ca`)
- `userVerification`: `"required"` (the authenticator must verify the user with biometric or PIN)
- `allowCredentials`: empty array (discoverable credential, so the authenticator chooses which credential to use)

The handler stores the challenge in `auth_challenges` with type `"login"` and a five-minute TTL, then returns the `challengeId` and `options` to the client.

**Step 2: Verify authentication response** (`POST /api/v1/auth/login`)

The client sends the `challengeId` and the `credential` object from the browser's WebAuthn API. The handler:

1. Consumes the challenge from `auth_challenges`. If expired or missing, returns 401.
2. Looks up the credential by `id` in `passkey_credentials`.
3. Calls `verifyAuthenticationResponse()` with the stored public key, expected challenge, origin (`RP_ORIGIN`), and RP ID.
4. If verification succeeds, updates the `sign_count` in the database. The update query includes a safety check: the counter must not go backward (which would signal a cloned authenticator).
5. Creates a session and sets the session cookie.

### Sign count safety

The `sign_count` update uses a conditional query to detect cloned authenticators:

```sql
UPDATE passkey_credentials
SET sign_count = ?, last_used_at = datetime('now')
WHERE id = ? AND (sign_count = 0 OR sign_count < ?)
```

If the update affects zero rows and the stored `sign_count` is greater than zero, the handler returns 401 with `"Credential counter went backward"`.

### Passkey credentials schema

```sql
CREATE TABLE passkey_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL,
  webauthn_user_id TEXT NOT NULL,
  sign_count INTEGER DEFAULT 0,
  transports TEXT,
  device_type TEXT,
  backed_up INTEGER DEFAULT 0,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
```

| Column | Purpose |
|--------|---------|
| `id` | The credential ID (base64url-encoded, from the authenticator) |
| `public_key` | The credential public key (BLOB, used for signature verification) |
| `webauthn_user_id` | A random 64-byte base64url-encoded identifier, consistent across a user's credentials |
| `sign_count` | Monotonic counter for clone detection |
| `transports` | JSON array of transport hints (such as `["internal"]` or `["usb"]`) |
| `device_type` | `"singleDevice"` or `"multiDevice"` (from WebAuthn attestation) |
| `backed_up` | 1 if the credential is synced across devices (iCloud Keychain, Google Password Manager, and so on) |
| `name` | User-provided label (such as "MacBook" or "iPhone"), up to 100 characters |

### Auth challenges schema

Both OAuth and WebAuthn flows use the same challenge table:

```sql
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('oauth', 'login', 'register')),
  user_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Challenges are single-use: the `consumeChallenge()` function deletes the row atomically with a `DELETE ... RETURNING` query. The default TTL is five minutes, except OAuth state which uses 10 minutes.

---

## Session management

After a successful OAuth callback or passkey login, the API creates a session and sets an `HttpOnly` cookie.

### Session creation

The `createSession()` function in `api/src/lib/auth-session.ts`:

1. Generates a 32-byte random token (64 hex characters).
2. Hashes the token with SHA-256.
3. Stores the hash as the session `id` in `auth_sessions` with a 24-hour expiry.
4. Returns the raw token (sent to the client as a cookie).

```sql
INSERT INTO auth_sessions (id, user_id, expires_at)
VALUES (?, ?, datetime('now', '+1 day'))
```

The database stores only the SHA-256 hash, so a database breach does not expose session tokens.

### Session cookie

The cookie name depends on whether the origin uses HTTPS:

| Origin | Cookie name | `Secure` flag |
|--------|-------------|---------------|
| HTTPS | `__Host-session` | yes |
| HTTP (local dev) | `session` | no |

Both variants use `HttpOnly`, `SameSite=Lax`, and `Path=/`. The `maxAge` is 86,400 seconds (24 hours).

The `getSessionToken()` function checks for the `__Host-session` cookie first, then falls back to `session`, so production and development environments use the same code path.

### Session validation

On each request, the `accessAuth` middleware calls `getSessionToken()` to read the cookie, then `validateSession()` to look up the hashed token:

```sql
SELECT user_id FROM auth_sessions WHERE id = ? AND expires_at > datetime('now')
```

If the session is valid, the middleware resolves the full user row and sets `c.var.user`.

### Auth sessions schema

```sql
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Logout

`POST /api/v1/auth/logout` deletes the session from the database and clears the cookie by setting `maxAge` to zero.

### Auth status endpoint

`GET /api/v1/auth/status` is an unauthenticated endpoint that checks whether the caller has a valid session. It returns:

```json
{ "authenticated": true, "isNewUser": false, "user": { "id": "...", "email": "...", "name": "...", "avatarUrl": "..." } }
```

or `{ "authenticated": false }` if no valid session exists. The `isNewUser` flag is `true` when the user's `onboarded` column is zero.

---

## API key authentication

API keys provide programmatic access for MCP servers and automation scripts.

### Key format

API keys have the prefix `wc-` followed by 64 hex characters (32 random bytes), for example `wc-a1b2c3d4`. The API displays the full key once at creation time and never stores it. It stores only the SHA-256 hash.

### Creation flow

`POST /api/v1/auth/api-keys` (requires session):

1. Validates the `name` field (required, one to 100 characters).
2. Generates the key: `wc-` + 32 random bytes in hex.
3. Hashes the key with SHA-256 (reuses `hashToken()` from the session module).
4. Stores the hash as the `id`, along with `user_id`, `name`, and the first eight characters as `prefix`.
5. Returns the full key to the client. This is the only time the raw key is visible.

### Validation flow

When the `accessAuth` middleware finds an `Authorization: Bearer wc-...` header:

1. Hashes the key with SHA-256.
2. Looks up the hash in `api_keys`.
3. If found, debounces the `last_used_at` timestamp (updates at most once per hour to reduce writes).
4. Resolves the user and sets `c.var.user`.

### Management endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/auth/api-keys` | Create a new API key (returns the raw key once) |
| `GET` | `/api/v1/auth/api-keys` | List all API keys for the authenticated user (prefix only, not full key) |
| `DELETE` | `/api/v1/auth/api-keys/:id` | Revoke an API key |

### API keys schema

```sql
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
```

---

## User provisioning and onboarding

### Users table schema

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  onboarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

The `onboarded` column tracks whether the user has completed the Welcome page. New users created through OAuth have `onboarded = 0`.

### New user provisioning

When the OAuth callback creates a new user, it:

1. Generates a UUID for the `id`.
2. Inserts a row with `email`, `name` (from GitHub profile or username), `avatar_url`, and `onboarded = 0`.
3. Creates a linked `oauth_accounts` row.
4. Creates a session and redirects to `/welcome`.

### Welcome page flow

The Welcome page (`dashboard/src/pages/Welcome.tsx`) lets a new user:

1. **Set a display name**: Pre-populated from the GitHub profile name.
2. **Add a passkey** (optional): Calls `POST /api/v1/auth/register/options` and `POST /api/v1/auth/register` to register a WebAuthn credential. The page notes that the user can also do this later from Settings.
3. **Continue to dashboard**: Calls `PATCH /api/v1/users/me` with `{ name, onboarded: true }`, which sets `onboarded = 1` in the database. The client then refreshes its auth state and navigates to `/`.

### User profile endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/users/me` | Returns the authenticated user's profile (id, email, name, avatarUrl, onboarded) |
| `PATCH` | `/api/v1/users/me` | Updates `name` (one to 100 characters) and/or sets `onboarded = true` |

---

## Client-side auth gating

The `AuthGate` component (`dashboard/src/components/AuthGate.tsx`) wraps the entire app and controls what the user sees based on their authentication state.

### How it works

1. On mount, `AuthGate` calls `GET /api/v1/auth/status` to check the session.
2. While loading, it renders a loading placeholder.
3. If unauthenticated (`authenticated: false`), it renders the `Login` page directly (no redirect needed).
4. If authenticated, it provides the user object and `isNewUser` flag via React context.

### New user routing

The `App` component reads `isNewUser` from the auth context. If `true`, it renders a restricted router with only two routes:

- `/welcome` renders the Welcome page.
- All other paths redirect to `/welcome`.

Once the user completes onboarding (sets `onboarded: true`), the auth state refreshes and the full router takes over.

### Login page

The login page (`dashboard/src/pages/Login.tsx`) offers two options:

1. **Sign in with GitHub**: A link to `/api/v1/auth/github` that starts the OAuth flow.
2. **Sign in with Passkey**: Calls the passkey login endpoints and reloads the page on success.

The page checks `GET /api/v1/auth/settings` on mount to determine whether registrations are open. If closed, it shows a "New signups are currently closed" message.

The page reads error messages from OAuth redirects (such as `registrations_closed`, `github_error`, or `email_required`) from URL query parameters and displays them. It then clears the error parameter from the URL.

---

## Passkey management

Authenticated users manage their passkeys from the Settings page (`dashboard/src/pages/Settings.tsx`), under the "Security" card.

### Registering a new passkey

The flow to add a passkey:

1. The user clicks "Add" in the Passkeys section.
2. A dialog prompts for a name (such as "MacBook" or "iPhone"), up to 100 characters.
3. The client calls `POST /api/v1/auth/register/options` to get WebAuthn registration options.
4. The browser's WebAuthn API prompts for biometric verification (Face ID, Touch ID, or a security key).
5. The client sends the credential to `POST /api/v1/auth/register` with the `challengeId`, `credential`, and optional `name`.

The registration handler:

1. Consumes the challenge from `auth_challenges` (type `"register"`).
2. Verifies the challenge belongs to the same user (`challengeData.userId !== user.id` returns 403).
3. Calls `verifyRegistrationResponse()` with the expected challenge, origin, and RP ID.
4. Stores the credential in `passkey_credentials` with the public key, sign count, transports, device type, backed-up flag, and name.

### Exclude credentials

When generating registration options, the handler fetches existing credentials for the user and passes them as `excludeCredentials`. This prevents the authenticator from registering a duplicate credential.

### WebAuthn user ID

Each user has a consistent `webauthn_user_id` -- a random 64-byte value stored in base64url encoding. If the user already has credentials, the handler reuses the existing `webauthn_user_id`. For a first credential, it generates a new one.

### Listing passkeys

`GET /api/v1/auth/passkeys` returns all passkeys for the authenticated user, ordered by creation date (newest first):

```json
{
  "items": [
    {
      "id": "...",
      "name": "MacBook Pro",
      "deviceType": "multiDevice",
      "backedUp": true,
      "createdAt": "2026-03-22T...",
      "lastUsedAt": "2026-03-22T..."
    }
  ]
}
```

### Revoking a passkey

`DELETE /api/v1/auth/passkeys/:id` deletes the credential row if it belongs to the authenticated user. The query scopes the delete with `AND user_id = ?`.

On the dashboard, if the user tries to revoke their last passkey, a confirmation dialog warns that they will need to use GitHub to sign in after revocation.

### Registration endpoints (summary)

| Method | Path | Auth required | Purpose |
|--------|------|---------------|---------|
| `POST` | `/api/v1/auth/register/options` | Yes (session) | Generate WebAuthn registration options |
| `POST` | `/api/v1/auth/register` | Yes (session) | Verify and store a new passkey credential |
| `GET` | `/api/v1/auth/passkeys` | Yes (session) | List all passkeys for the user |
| `DELETE` | `/api/v1/auth/passkeys/:id` | Yes (session) | Revoke a passkey |

---

## Webhook auth

The `/webhook/*` routes use a separate authentication mechanism. The auth middleware exempts them, and they instead authenticate by using a shared secret.

### How it works

In `api/src/routes/webhook.ts`, the `/webhook/rapt` POST handler:

1. Reads the `X-Webhook-Token` header from the request.
2. Compares it against the `WEBHOOK_TOKEN` environment variable using **timing-safe comparison** (`timingSafeEqual` from `api/src/lib/crypto.ts`).
3. If the token is missing, the expected token is missing, or they do not match, returns **401** `"Invalid webhook token"`.

```typescript
const token = c.req.header("X-Webhook-Token");
const expected = c.env.WEBHOOK_TOKEN;
if (!token || !expected || !timingSafeEqual(token, expected)) {
  return unauthorized("Invalid webhook token");
}
```

### Timing-safe comparison

The `timingSafeEqual` function (`api/src/lib/crypto.ts`) prevents timing attacks by:
- Short-circuiting only on length mismatch (which is already observable via content-length).
- XOR-comparing every byte and accumulating the result, so the comparison time is constant for equal-length strings.

```typescript
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}
```

### Webhook and user context

Webhook requests do **not** have a `c.var.user`. The webhook handler resolves user context from the data itself:
- It looks up the device by `device_id` in the `devices` table.
- If the device has a `user_id`, the handler uses that user for scoping the reading.
- If the device is unknown, the system auto-registers it with `user_id = NULL` and stores the reading with `user_id = NULL`. A user establishes ownership later by claiming the device.

---

## Multi-tenancy and tenant isolation

The system enforces strict per-user data isolation. Every data table includes a `user_id` column, and every query filters by it.

### Schema design

All primary data tables have a `user_id` foreign key to `users(id)`:

| Table | `user_id` constraint | Notes |
|-------|---------------------|-------|
| `batches` | `NOT NULL` | Every batch belongs to exactly one user |
| `activities` | `NOT NULL` | Scoped through batch ownership + direct `user_id` column |
| `readings` | nullable | NULL for unclaimed device readings; set when device is claimed |
| `devices` | nullable | NULL for auto-registered devices not yet claimed |

### How the system enforces isolation

The system enforces tenant isolation at the **query level** -- every SQL query that reads or modifies user data includes `AND user_id = ?` bound to the authenticated user's ID.

#### Batches

A shared helper function gates all batch access:

```typescript
async function getOwnedBatch(db: D1Database, batchId: string, userId: string) {
  return db.prepare("SELECT * FROM batches WHERE id = ? AND user_id = ?")
    .bind(batchId, userId).first<any>();
}
```

Every batch endpoint (GET, PATCH, DELETE, lifecycle transitions) uses `getOwnedBatch()`. If the batch does not belong to the authenticated user, it returns `null` and the handler responds with **404** (not 403), which prevents leaking the existence of other users' resources.

Listing batches always filters:
```sql
SELECT * FROM batches WHERE user_id = ? ...
```

Write operations (UPDATE, DELETE) also include `AND user_id = ?`:
```sql
UPDATE batches SET ... WHERE id = ? AND user_id = ?
DELETE FROM batches WHERE id = ? AND user_id = ?
```

#### Activities

- Listing activities first verifies batch ownership (`SELECT id FROM batches WHERE id = ? AND user_id = ?`), then queries activities for that batch.
- Updating/deleting an activity checks `WHERE id = ? AND batch_id = ? AND user_id = ?`.
- Creating an activity verifies batch ownership before insertion.

#### Readings

- Batch readings endpoint verifies batch ownership before querying.
- Device readings endpoint verifies device ownership (`WHERE id = ? AND user_id = ?`).
- The paginated query helper adds `AND user_id = ?` to all reading queries.

#### Devices

- Listing devices: `SELECT * FROM devices WHERE user_id = ?`.
- Device operations (assign, unassign): `SELECT * FROM devices WHERE id = ? AND user_id = ?`.
- Claiming a device: a user can only claim unclaimed devices (`user_id IS NULL`).

#### Dashboard

All dashboard queries scope results by `user_id`:
```sql
SELECT * FROM batches WHERE status = 'active' AND user_id = ?
SELECT ... FROM readings WHERE batch_id = ? AND user_id = ?
SELECT a.* ... FROM activities a JOIN batches b ON b.id = a.batch_id WHERE b.user_id = ?
```

#### Auth-scoped tables

The auth tables also enforce per-user scoping:

| Table | Scoping |
|-------|---------|
| `passkey_credentials` | All queries filter by `user_id` |
| `oauth_accounts` | Linked to `user_id`; queries filter by provider and provider ID |
| `api_keys` | All queries filter by `user_id` |
| `auth_sessions` | Linked to `user_id`; resolved by hashed token |

### 404 compared to 403 strategy

When a user tries to access a resource they do not own, the API returns **404 Not Found** rather than **403 Forbidden**. This is intentional: returning 403 would confirm the resource exists, leaking information to unauthorized users.

### Device claiming flow

Devices can exist in an **unclaimed** state (`user_id = NULL`) when auto-registered through webhooks from unknown devices. The claiming flow:

1. A webhook creates a device with `user_id = NULL` and readings with `user_id = NULL`.
2. A user calls `POST /api/v1/devices/claim` with `{ device_id }`.
3. The handler checks `WHERE id = ? AND user_id IS NULL` (only unclaimed devices).
4. On success, atomically updates both the device and its orphaned readings:
   ```sql
   UPDATE devices SET user_id = ? WHERE id = ?
   UPDATE readings SET user_id = ? WHERE device_id = ? AND user_id IS NULL
   ```

---

## Environment variables

### Secrets (set via `wrangler secret put`)

| Variable | Purpose |
|----------|---------|
| `GITHUB_CLIENT_ID` | GitHub OAuth application client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth application client secret |
| `WEBHOOK_TOKEN` | Shared secret for webhook authentication. Compared against the `X-Webhook-Token` header. |
| `VAPID_PUBLIC_KEY` | VAPID key for Web Push notifications (not auth-related). |
| `VAPID_PRIVATE_KEY` | VAPID private key for Web Push notifications (not auth-related). |

### Non-secret vars (set in `wrangler.toml`)

| Variable | Purpose |
|----------|---------|
| `RP_ID` | WebAuthn relying party ID (the domain, such as `cellar.rdrake.ca`) |
| `RP_ORIGIN` | WebAuthn expected origin (such as `https://cellar.rdrake.ca`). Also used to determine whether to set the `Secure` flag on session cookies. |

### Bindings type

Defined in `api/src/app.ts`:

```typescript
export type Bindings = {
  DB: D1Database;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  WEBHOOK_TOKEN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  RP_ID: string;
  RP_ORIGIN: string;
};
```

---

## Edge cases and error handling

### No valid session or API key

If neither a session cookie nor a valid API key is present on a protected route:
- **Response**: 401 `"Authentication required"`
- The middleware returns immediately after checking both methods.

### OAuth state mismatch

If the `state` parameter in the GitHub callback does not match a stored challenge:
- **Redirect**: `/login?error=invalid_state`
- This can happen if the user waits longer than 10 minutes or opens more than one login tab.

### GitHub API failure

If the code exchange or profile fetch fails:
- **Redirect**: `/login?error=github_error`

### No verified email from GitHub

If the GitHub profile has no email and `/user/emails` returns no primary verified email:
- **Redirect**: `/login?error=email_required`

### Registrations closed

If a new user (no existing account) completes OAuth when `registrations_open` is `"false"`:
- **Redirect**: `/login?error=registrations_closed`
- Existing users who have an `oauth_accounts` or `users` row matching the email can still sign in.

### Passkey challenge expired or invalid

If the challenge ID sent with a passkey login or registration does not match a stored challenge, or the challenge has expired:
- **Response**: 401 `"Invalid or expired challenge"` (login) or `"Challenge expired or invalid"` (registration)

### Passkey credential not found

If the credential ID in a passkey login response does not match any row in `passkey_credentials`:
- **Response**: 401 `"Credential not found"`

### Passkey verification failure

If `verifyAuthenticationResponse()` returns `verified: false`:
- **Response**: 401 `"Verification failed"`

### Credential counter went backward

If the new sign count from the authenticator is less than or equal to the stored sign count (and the stored count is greater than zero):
- **Response**: 401 `"Credential counter went backward"`
- This indicates a possible cloned authenticator.

### Challenge user mismatch (registration)

If the registration challenge belongs to a different user than the one submitting the credential:
- **Response**: 403 `"Challenge user mismatch"`

### Invalid API key

If the `Authorization: Bearer wc-...` header contains a key whose SHA-256 hash does not match any row in `api_keys`:
- The middleware falls through to return 401 `"Authentication required"`.

### Webhook token missing or wrong

If `X-Webhook-Token` is missing, the `WEBHOOK_TOKEN` environment variable is not set, or they do not match:
- **Response**: 401 `"Invalid webhook token"`
- The handler checks all three conditions before body parsing to avoid unnecessary work.
