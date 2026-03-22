# OAuth + Passkey Authentication Design (v2.1)

> v2 addresses review findings: GitHub private email handling, SQLite CHECK constraint rebuild
> strategy, base64url utility extraction, OAuth state TTL, deployment ordering, user profile sync
> policy, Pages Functions redirect confirmation, OAuth scopes, welcome page layout, PATCH /users/me
> validation. v2.1 addresses: middleware auth exemption pattern, PATCH validation contradiction,
> challenge TTL configurability, existing user OAuth linking, Bindings/ChallengeType updates,
> base64url dedup from web-push.ts, test strategy, auth/status backward compatibility.

**Goal:** Replace single-user passkey-bootstrap auth with multi-user GitHub OAuth signup/login, keeping passkeys as an optional convenience layer for biometric access on mobile devices.

**Approach:** GitHub OAuth is the primary auth method — any user can sign up (toggleable). Passkeys are an optional add-on users can register from the welcome page or Settings. Cloudflare Access integration is fully removed. Session cookies (already built) remain the auth mechanism for API requests.

---

## Auth Flows

### GitHub OAuth Signup (new user)

1. User opens the app → `GET /api/v1/auth/status` returns `{ authenticated: false }`.
2. Login page shows "Sign in with GitHub" button.
3. Click → `GET /api/v1/auth/github` → API generates OAuth state (stored in `auth_challenges`), redirects to GitHub authorization URL with scopes `read:user, user:email`.
4. User authorizes → GitHub redirects to `/api/v1/auth/github/callback?code=...&state=...`.
5. API validates state (consumed from `auth_challenges`), exchanges code for access token via `arctic`, fetches GitHub user profile and primary verified email (see Email Resolution below).
6. No matching `oauth_accounts` row → look up `users` by email.
   - **User exists** (pre-existing account from before OAuth migration): create `oauth_accounts` link to the existing user. Create session → redirect to `/`.
   - **No user found**: check `registrations_open` setting → if closed, redirect to `/login?error=registrations_closed`.
7. Create `users` row (email, name, avatar from GitHub), create `oauth_accounts` link.
8. Create session, set cookie → redirect to `/welcome`.

### GitHub OAuth Login (returning user)

Steps 1–5 same as above. Step 6 finds existing `oauth_accounts` row → look up user. Update `users.name`, `users.avatar_url`, and `oauth_accounts` email/name/avatar_url from the current GitHub profile (keeps data fresh without manual sync). Create session, set cookie → redirect to `/`.

### Passkey Login (returning user with passkey)

1. Login page shows "or use a passkey" link below the GitHub button.
2. Click → `POST /api/v1/auth/login/options` → browser passkey prompt.
3. `POST /api/v1/auth/login` → verify assertion, create session → redirect to `/`.

### Welcome (first login only)

1. After first GitHub login, `GET /api/v1/auth/status` returns `{ authenticated: true, isNewUser: true }`.
2. App routes to `/welcome`.
3. Welcome page renders **outside the Layout component** (no nav bar).
4. Welcome page shows:
   - Editable display name (pre-filled from GitHub).
   - Optional "Set up Face ID / Touch ID" button to register a passkey.
   - "Continue to dashboard" button.
5. `PATCH /api/v1/users/me` saves name + clears `isNewUser` flag.

### Registrations Closed

Step 6 in signup flow redirects to `/login?error=registrations_closed`. The login page reads `GET /api/v1/auth/settings` and shows a subtle note: "New signups are currently closed." Existing users can still log in via GitHub or passkey.

### Email Resolution

GitHub's `GET /user` endpoint returns `email: null` when the user's email is private. To always obtain an email:

1. Fetch `GET https://api.github.com/user` — use `email` if present.
2. If `email` is null, fetch `GET https://api.github.com/user/emails` (requires `user:email` scope).
3. Select the entry where `primary: true` and `verified: true`.
4. If no verified primary email exists, reject signup with an error ("A verified email is required").

This ensures `users.email` (NOT NULL) is always populated from a verified source.

---

## Middleware

```
Request arrives
  → Exempt route? (/health, /webhook/*, /api/v1/auth/github*, /api/v1/auth/status,
                    /api/v1/auth/login*, /api/v1/auth/settings)
    → skip auth
  → __Host-session / session cookie?
    → hash token, look up in auth_sessions, check expiry → user
  → Neither? → 401
```

Session cookie is the sole auth path. CF Access JWT verification is removed entirely. Service token lookup is removed.

Auth routes that require a session (`/auth/register/*`, `/auth/logout`) are **not** exempt — the middleware enforces session auth for them. Only the unauthenticated auth routes (GitHub OAuth, login, status, settings) are exempt.

The middleware SELECT query updates to `SELECT id, email, name, avatar_url FROM users` and the `User` type gains `avatar_url: string | null`.

---

## Data Model

### New table: `oauth_accounts`

| Column | Type | Notes |
|--------|------|-------|
| `provider` | TEXT NOT NULL | `"github"` (extensible) |
| `provider_user_id` | TEXT NOT NULL | GitHub's numeric user ID (stable) |
| `user_id` | TEXT NOT NULL | FK to `users.id` |
| `email` | TEXT | Email from provider at link time |
| `name` | TEXT | Display name from provider |
| `avatar_url` | TEXT | Profile picture URL |
| `created_at` | TEXT NOT NULL | |

Primary key: `(provider, provider_user_id)`.
Index on `user_id` for lookups.

### New table: `settings`

| Column | Type | Notes |
|--------|------|-------|
| `key` | TEXT PK | Setting name |
| `value` | TEXT NOT NULL | Setting value |
| `updated_at` | TEXT NOT NULL | DEFAULT `datetime('now')` |

Seeded with `('registrations_open', 'true', datetime('now'))`.

### Modify: `users`

Add column: `avatar_url TEXT`.
Add column: `onboarded INTEGER NOT NULL DEFAULT 0` — flipped to 1 when welcome page is completed. Drives `isNewUser` in auth status.

The `email` column keeps its `NOT NULL UNIQUE` constraint. Email is always resolved from GitHub's verified primary email (see Email Resolution above), so collisions indicate the same person or a genuine conflict — the UNIQUE constraint is still the right guard.

### Rebuild: `auth_challenges`

SQLite does not support modifying CHECK constraints in place. The migration rebuilds the table:

1. `DELETE FROM auth_challenges` — safe, all rows are ephemeral (5-minute TTL).
2. `DROP TABLE auth_challenges`.
3. `CREATE TABLE auth_challenges` with updated CHECK: `type IN ('oauth', 'login', 'register')`.
4. Recreate index `idx_auth_challenges_expires`.

### Remove: `service_tokens`

Dead weight after CF Access removal. Migration drops the table.

### Extract: `base64UrlEncode` / `base64UrlDecode`

The passkey routes import these from `lib/access-jwt.ts`, which is being deleted. Additionally, `lib/web-push.ts` has its own inline duplicate of `base64UrlDecode`. The migration plan must:

1. Create `lib/encoding.ts` with both functions extracted from `access-jwt.ts`.
2. Update passkey route imports to use `lib/encoding.ts`.
3. Replace the inline `base64UrlDecode` in `web-push.ts` with an import from `lib/encoding.ts`.
4. Delete `access-jwt.ts`.

### Existing sessions preserved

The `auth_sessions` table is unchanged. Any active sessions from before the migration remain valid.

---

## API Routes

### Remove

| Route | Reason |
|-------|--------|
| `POST /auth/bootstrap/options` | Replaced by OAuth signup |
| `POST /auth/bootstrap` | Replaced by OAuth signup |

The `constantTimeEqual` helper (only used by bootstrap) becomes dead code and is removed.

### New

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /auth/github` | None | Generate state, redirect to GitHub authorization URL |
| `GET /auth/github/callback` | None | Exchange code, create/find user, issue session, redirect |
| `GET /auth/settings` | None | Returns `{ registrationsOpen }` |

### Keep (modified)

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /auth/status` | None | Returns `{ authenticated, user?, isNewUser? }` |
| `POST /auth/login/options` | None | Passkey authentication challenge |
| `POST /auth/login` | None | Passkey assertion verification |
| `POST /auth/register/options` | Session | Registration options for adding passkey |
| `POST /auth/register` | Session | Store passkey credential |
| `POST /auth/logout` | Session | Delete session, clear cookie |

### Consolidate: `/me` → `/users/me`

The existing `GET /api/v1/me` endpoint is replaced by:

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /api/v1/users/me` | Session | Returns user profile (id, email, name, avatarUrl) |
| `PATCH /api/v1/users/me` | Session | Update display name, mark onboarded |

`PATCH /api/v1/users/me` accepts:
```json
{
  "name": "string (1-100 chars, optional)",
  "onboarded": true
}
```
Both fields are optional. `name` is validated to 1–100 chars when provided. `onboarded` only accepts `true` (idempotent, cannot un-onboard). Returns the updated user.

### `/auth/status` response

```json
{
  "authenticated": true,
  "isNewUser": false,
  "user": {
    "id": "...",
    "email": "...",
    "name": "...",
    "avatarUrl": "..."
  }
}
```

When `authenticated: false`, only `authenticated` is returned. `isNewUser` is `true` when `users.onboarded = 0`.

### `/auth/github/callback` flow

1. Validate `state` parameter — consume from `auth_challenges` (type `"oauth"`).
2. Exchange `code` for access token using `arctic`. On failure (network error, invalid/expired code), redirect to `/login?error=github_error`.
3. Fetch GitHub user profile + resolve email (see Email Resolution).
4. Look up `oauth_accounts` by `(provider='github', provider_user_id=github_id)`.
5. **Found:** update `oauth_accounts` email/name/avatar_url, update `users` name/avatar_url (keeps profile fresh) → create session → redirect to `/`.
6. **Not found:** look up `users` by email.
   - **User exists** (pre-existing account): create `oauth_accounts` link → create session → redirect to `/`.
   - **No user:** check `registrations_open` setting.
     - Closed → redirect to `/login?error=registrations_closed`.
     - Open → create `users` row, create `oauth_accounts` link → create session → redirect to `/welcome`.

**Redirect note:** The callback URL goes through the Cloudflare Pages Functions proxy (`functions/` directory), which forwards `/api/*` to the API Worker. The Worker responds with a 302 redirect (to `/` or `/welcome`). The proxy passes this redirect through to the browser as-is — no special handling needed.

---

## Dashboard Changes

### Login page (replaces current Setup + Login)

- "Sign in with GitHub" button (primary, prominent) → navigates to `GET /api/v1/auth/github`
- "or sign in with a passkey" link below (secondary)
- If `registrationsOpen` is false: subtle note "New signups are currently closed"
- Error display for `?error=registrations_closed` query param

### Welcome page (new, `/welcome`)

- Renders **outside Layout** (no nav bar) — separate route at the Router level
- Shown once after first GitHub login (when `isNewUser` is true)
- Editable display name pre-filled from GitHub
- Optional "Set up Face ID / Touch ID" button → passkey registration flow
- "Continue to dashboard" button → `PATCH /api/v1/users/me` with name + marks onboarded

### AuthGate (simplified)

- Two states: `authenticated: false` → Login page, `authenticated: true` → app
- Welcome routing: if `isNewUser` is true, redirect to `/welcome` within the authenticated app
- On 401 response: clear state, show Login page

### Settings page

- Show linked GitHub account (avatar, name, email)
- Passkey section: "Add a passkey" button (existing register flow)
- "Log Out" button (existing logout flow)
- Remove any bootstrap/setup-token references

### API client (`api.ts`)

- Remove: `bootstrapOptions`, `bootstrap` methods
- Keep: `loginOptions`, `login`, `registerOptions`, `register`, `logout`, `status`
- Add: `getSettings`, `getMe`, `updateMe`
- GitHub auth uses browser redirects, not API client calls

---

## Session Cookie

Unchanged from current implementation:

```
__Host-session=<hex token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400
```

- `__Host-` prefix on HTTPS, plain `session` on HTTP (dev)
- 24-hour expiry
- Raw token in cookie, SHA-256 hash in DB

---

## Security

- **OAuth state**: stored in `auth_challenges` (type `"oauth"`), **10-minute TTL** (longer than passkey challenges to accommodate GitHub 2FA and first-time app authorization), consumed atomically on callback — prevents CSRF. The `storeChallenge` function gains an optional `ttlMinutes` parameter (default 5) to support this without affecting passkey challenge TTL.
- **GitHub client secret**: Wrangler secret (`wrangler secret put GITHUB_CLIENT_SECRET`), never in `wrangler.toml` vars.
- **GitHub OAuth scopes**: `read:user, user:email` — minimum needed to fetch profile and verified email.
- **Registration toggle**: checked server-side in callback, not just hidden in UI — redirects to error regardless of how the request arrives.
- **Session tokens**: 32 random bytes, SHA-256 hashed at rest, 24-hour expiry (unchanged).
- **Passkey security**: challenge binding, sign count validation, user verification required (unchanged).
- **Rate limiting**: Cloudflare WAF rule on `/api/v1/auth/*` — 10 req/min/IP.
- **Expired row cleanup**: cron purges `auth_sessions` and `auth_challenges` every 15 minutes (unchanged).

---

## Environment Changes

### Add

- `GITHUB_CLIENT_ID`: in `wrangler.toml` `[vars]`
- `GITHUB_CLIENT_SECRET`: Wrangler secret (`wrangler secret put GITHUB_CLIENT_SECRET`)

### Remove

- `CF_ACCESS_AUD` (Wrangler secret)
- `CF_ACCESS_TEAM` (var in `wrangler.toml`)
- `SETUP_TOKEN` (Wrangler secret)

### Keep

- `RP_ID`, `RP_ORIGIN` — passkey support
- `WEBHOOK_TOKEN` — webhook auth (unrelated)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — push notifications

---

## Deployment Steps

1. Create GitHub OAuth App: GitHub Settings → Developer settings → OAuth Apps.
   - Authorization callback URL: `https://wine-cellar-dashboard.pages.dev/api/v1/auth/github/callback`
   - Homepage URL: `https://wine-cellar-dashboard.pages.dev`
2. Set `GITHUB_CLIENT_ID` in `wrangler.toml` vars. Remove `CF_ACCESS_TEAM` from `wrangler.toml` vars.
3. `wrangler secret put GITHUB_CLIENT_SECRET`
4. **Run migration first** (`wrangler d1 execute wine-cellar-api --remote --file=api/migrations/NNNN_oauth_auth.sql`). The new tables must exist before the new API code deploys. The migration is additive (new tables + columns) so it is safe to run against the old API.
5. Deploy API (`npm run deploy` in `api/`).
6. Deploy dashboard (push to GitHub or manual `wrangler pages deploy`).
7. Remove CF Access Application from Zero Trust dashboard (if not already done).
8. `wrangler secret delete CF_ACCESS_AUD` and `wrangler secret delete SETUP_TOKEN` (if not already done).
9. Add WAF rate limiting rule if not already configured.

---

## Files to Remove

- `api/src/lib/access-jwt.ts` — CF Access JWT verification (extract `base64UrlEncode`/`base64UrlDecode` to `lib/encoding.ts` first)
- `api/src/lib/access-jwt.test.ts` (if exists)
- `dashboard/src/pages/Setup.tsx` — bootstrap setup page

---

## Libraries

- **API:** `arctic` — lightweight OAuth 2.0 library (Workers-compatible)
- **API:** `@simplewebauthn/server` v13+ — WebAuthn ceremony (already installed)
- **Dashboard:** `@simplewebauthn/browser` v13+ — browser-side WebAuthn (already installed)

---

## Code Changes

### TypeScript types to update

- `Bindings` in `app.ts`: add `GITHUB_CLIENT_ID: string`, `GITHUB_CLIENT_SECRET: string`. Remove `CF_ACCESS_AUD`, `CF_ACCESS_TEAM`, `SETUP_TOKEN`.
- `ChallengeType` in `lib/auth-challenge.ts`: change from `"bootstrap" | "login" | "register"` to `"oauth" | "login" | "register"`.
- `User` in `app.ts`: add `avatar_url: string | null`.

### Test strategy

All API tests currently use `authHeaders(email)` which generates fake CF Access JWTs via the `test-jwt-for:` convention. With CF Access removed, the test auth helper must be rewritten to use session cookies instead. The new `authHeaders(email)` helper should:

1. Seed a user row (if not exists) with the given email.
2. Create a session via `createSession(db, userId)`.
3. Return a `Cookie` header with the session token.

This is a foundational change — update the helper first, then all tests continue to work as-is since they call `authHeaders(email)` without caring about the underlying mechanism.

### `/auth/status` backward compatibility

The response shape changes from `{ registered, authenticated }` to `{ authenticated, isNewUser?, user? }`. Since the API and dashboard deploy separately, the old dashboard may briefly call the new API expecting `registered`. To avoid a broken transition window, include `registered: true` in the response when `authenticated: true` (passkey credentials exist for this deployment, and the field becomes meaningless but harmless). Remove in a follow-up once the new dashboard is confirmed deployed.

---

## Out of Scope

- Additional OAuth providers (Google, Apple) — `oauth_accounts` table supports them, but only GitHub is implemented now.
- Admin UI for toggling `registrations_open` — change via D1 console or future admin page.
- Passkey management UI (list/revoke individual credentials).
- User management / admin panel.
