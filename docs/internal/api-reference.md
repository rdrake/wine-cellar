# Wine Cellar API reference (internal)

Base URL prefix: `/api/v1/` (except webhooks, which use `/webhook/`)

## Authentication

Most `/api/v1/*` endpoints require an authenticated session. The middleware in `middleware/access.ts` checks two mechanisms in order:

1. **Session cookie (primary)** -- set by the login and OAuth flows. The middleware validates the session token against the `sessions` table and resolves the user.
2. **API key (secondary)** -- passed as a `Bearer` token in the `Authorization` header (prefix `wc-`). The middleware hashes the key, looks it up in the `api_keys` table, and resolves the owning user. Intended for MCP servers and automation.

Unauthenticated requests receive:

```
401 { "error": "Authentication required" }
```

Exempt paths (no auth required):
- `GET /health`
- `POST /webhook/rapt` -- uses `X-Webhook-Token` header (see Webhook section).
- `GET /api/v1/auth/status`
- `POST /api/v1/auth/login/options`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/github` and `GET /api/v1/auth/github/callback`
- `GET /api/v1/auth/settings`

---

## Common error shapes

All error responses follow a consistent JSON structure.

### 401 unauthorized
```json
{ "error": "unauthorized", "message": "<description>" }
```

### 404 not found
```json
{ "error": "not_found", "message": "<Entity> not found" }
```

### 409 conflict
```json
{ "error": "conflict", "message": "<description>" }
```

### 422 validation error
```json
{ "error": "validation_error", "detail": [ { "code": "...", "message": "...", "path": [...] } ] }
```
The `detail` array has Zod issue objects.

---

## Enum reference

Many endpoints and schemas use these values.

### Wine types
`"red"` | `"white"` | `"ros\u00e9"` | `"orange"` | `"sparkling"` | `"dessert"`

### Source materials
`"kit"` | `"juice_bucket"` | `"fresh_grapes"`

### Batch statuses
`"active"` | `"completed"` | `"archived"` | `"abandoned"`

### Batch stages (waypoints)
These are the five high-level waypoint stages a batch moves through in order:

1. `"must_prep"`
2. `"primary_fermentation"`
3. `"secondary_fermentation"`
4. `"stabilization"`
5. `"bottling"`

### All stages (activity stages)
Users can log activities against any of these fine-grained stages, subject to the waypoint allowed-stage mapping:

`"receiving"` | `"crushing"` | `"must_prep"` | `"primary_fermentation"` | `"pressing"` | `"secondary_fermentation"` | `"malolactic"` | `"stabilization"` | `"fining"` | `"bulk_aging"` | `"cold_stabilization"` | `"filtering"` | `"bottling"` | `"bottle_aging"`

### Waypoint allowed stages mapping
When a batch is at a given waypoint stage, the system permits only certain activity stages:

| Batch Waypoint Stage       | Allowed Activity Stages                                              |
|----------------------------|----------------------------------------------------------------------|
| `must_prep`                | `receiving`, `crushing`, `must_prep`                                 |
| `primary_fermentation`     | `primary_fermentation`, `pressing`                                   |
| `secondary_fermentation`   | `secondary_fermentation`, `malolactic`                               |
| `stabilization`            | `stabilization`, `fining`, `bulk_aging`, `cold_stabilization`, `filtering` |
| `bottling`                 | `bottling`, `bottle_aging`                                           |

### Activity types
`"addition"` | `"racking"` | `"measurement"` | `"tasting"` | `"note"` | `"adjustment"`

### Alert types
`"stall"` | `"no_readings"` | `"temp_high"` | `"temp_low"` | `"stage_suggestion"` | `"racking_due_1"` | `"racking_due_2"` | `"racking_due_3"` | `"mlf_check"` | `"bottling_ready"` | `"so2_due"`

---

## Current user

### `GET /api/v1/users/me`

Returns the authenticated user's profile.

**Auth:** Session cookie or API key required.

**Response:** `200`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "string | null",
  "avatarUrl": "string | null",
  "onboarded": true
}
```

| Field       | Type             | Notes                                                  |
|-------------|------------------|--------------------------------------------------------|
| `id`        | `string`         | User UUID                                              |
| `email`     | `string`         | User's email address                                   |
| `name`      | `string \| null` | Display name                                           |
| `avatarUrl` | `string \| null` | Avatar URL (populated from GitHub OAuth if available)   |
| `onboarded` | `boolean`        | Whether the user has completed the onboarding flow     |

---

### `PATCH /api/v1/users/me`

Update the authenticated user's profile.

**Auth:** Session cookie or API key required.

**Request Body (all fields optional):**

| Field       | Type      | Notes                                         |
|-------------|-----------|-----------------------------------------------|
| `name`      | `string`  | Must be one to 100 characters                 |
| `onboarded` | `boolean` | Set to `true` to mark onboarding as complete  |

**Response:** `200` -- updated user profile (same shape as `GET`).

**Errors:** `400` (invalid name length).

---

## Health check

### `GET /health`

**Auth:** None.

**Response:** `200`
```json
{ "status": "ok" }
```

---

## Auth endpoints

All auth endpoints are mounted at `/api/v1/auth/`. Login and OAuth flows are exempt from session auth (unauthenticated users need them to get a session). Registration and management endpoints require an existing session.

### `GET /api/v1/auth/status`

Check the current authentication state. Returns user info if a valid session exists.

**Auth:** None (exempt).

**Response (authenticated):** `200`
```json
{
  "authenticated": true,
  "isNewUser": false,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "string | null",
    "avatarUrl": "string | null"
  }
}
```

**Response (unauthenticated):** `200`
```json
{ "authenticated": false }
```

The `isNewUser` field is `true` when the user has not yet completed onboarding (`onboarded = 0`).

---

### `GET /api/v1/auth/settings`

Returns public registration settings.

**Auth:** None (exempt).

**Response:** `200`
```json
{ "registrationsOpen": true }
```

---

### `GET /api/v1/auth/github`

Start the GitHub OAuth login flow. Generates a random state parameter, stores it as a challenge, and redirects the browser to GitHub's authorization URL.

**Auth:** None (exempt).

**Response:** `302` redirect to GitHub.

---

### `GET /api/v1/auth/github/callback`

Handle the GitHub OAuth callback. Exchanges the authorization code for an access token, fetches the GitHub user profile, and either links to an existing user or creates a new one.

**Auth:** None (exempt). Validates the `state` query parameter against stored challenges.

**Processing logic:**
1. Validates the `state` parameter and exchanges `code` for a GitHub access token.
2. Fetches the user profile and primary verified email from the GitHub API.
3. If an `oauth_accounts` row exists for this GitHub ID, updates profile fields and creates a session.
4. If no OAuth link exists but a user with the same email exists, links the GitHub account and creates a session.
5. If no user exists and registrations are open, creates a new user with `onboarded = 0`, links the GitHub account, and creates a session.

**Response:** `302` redirect to `/` (existing users), `/welcome` (new users), or `/login?error=<code>` on failure.

**Error codes in redirect:**
- `invalid_state` -- missing or expired OAuth state
- `github_error` -- failed to exchange code or fetch profile
- `email_required` -- no verified primary email on the GitHub account
- `registrations_closed` -- new user but registrations are not open

---

### `POST /api/v1/auth/login/options`

Generate WebAuthn authentication options for passkey login.

**Auth:** None (exempt).

**Request Body:** None.

**Response:** `200`
```json
{
  "challengeId": "uuid",
  "options": { /* PublicKeyCredentialRequestOptions */ }
}
```

The client must pass `challengeId` back when completing the login.

---

### `POST /api/v1/auth/login`

Verify a WebAuthn authentication response and create a session.

**Auth:** None (exempt).

**Request Body:**

| Field          | Type     | Required | Notes                                     |
|----------------|----------|----------|-------------------------------------------|
| `challengeId`  | `string` | Yes      | From the `/login/options` response        |
| `credential`   | `object` | Yes      | The WebAuthn `AuthenticatorAssertionResponse` |

**Processing logic:**
1. Consumes the challenge (one-time use).
2. Looks up the credential by ID in `passkey_credentials`.
3. Verifies the authentication response against the stored public key.
4. Updates `sign_count` and `last_used_at` on the credential.
5. Creates a session and sets the session cookie.

**Response:** `200`
```json
{ "status": "ok" }
```

**Errors:** `401` (invalid challenge, credential not found, verification failed, or counter went backward).

---

### `POST /api/v1/auth/register/options`

Generate WebAuthn registration options for adding a passkey to the current user's account.

**Auth:** Session cookie or API key required.

**Request Body:** None.

**Response:** `200`
```json
{
  "challengeId": "uuid",
  "options": { /* PublicKeyCredentialCreationOptions */ }
}
```

The options include `excludeCredentials` to prevent registering duplicate passkeys.

---

### `POST /api/v1/auth/register`

Verify a WebAuthn registration response and store the new passkey credential.

**Auth:** Session cookie or API key required.

**Request Body:**

| Field          | Type             | Required | Notes                                      |
|----------------|------------------|----------|--------------------------------------------|
| `challengeId`  | `string`         | Yes      | From the `/register/options` response      |
| `credential`   | `object`         | Yes      | The WebAuthn `AuthenticatorAttestationResponse` |
| `name`         | `string \| null` | No       | Display name for the passkey (max 100 characters) |

**Response:** `200`
```json
{ "status": "ok" }
```

**Errors:** `401` (challenge expired or invalid), `403` (challenge user mismatch).

---

### `POST /api/v1/auth/logout`

End the current session and clear the session cookie.

**Auth:** Session cookie or API key required.

**Request Body:** None.

**Response:** `200`
```json
{ "status": "ok" }
```

---

## Passkey management

Endpoints for listing and deleting passkeys from the Settings page. Mounted at `/api/v1/auth/passkeys`.

### `GET /api/v1/auth/passkeys`

List all passkeys registered to the authenticated user.

**Auth:** Session cookie or API key required.

**Response:** `200`
```json
{
  "items": [
    {
      "id": "credential-id",
      "name": "string | null",
      "deviceType": "singleDevice | multiDevice",
      "backedUp": true,
      "createdAt": "ISO 8601",
      "lastUsedAt": "ISO 8601 | null"
    }
  ]
}
```

Items are ordered by `created_at DESC`.

---

### `DELETE /api/v1/auth/passkeys/:id`

Delete a passkey credential.

**Auth:** Session cookie or API key required. Must own the passkey.

**Request Body:** None.

**Response:** `204` (no body).

**Errors:** `404` if the passkey does not exist or is not owned by the user.

---

## API keys

Endpoints for creating, listing, and revoking API keys. Mounted at `/api/v1/auth/api-keys`. API keys allow non-browser clients (MCP servers, automation scripts) to authenticate with the API by using a `Bearer` token.

### `POST /api/v1/auth/api-keys`

Create a new API key.

**Auth:** Session cookie or API key required.

**Request Body:**

| Field  | Type     | Required | Notes                                |
|--------|----------|----------|--------------------------------------|
| `name` | `string` | Yes      | Min length 1, max 100 characters     |

**Response:** `201`
```json
{
  "id": "hash-of-key",
  "name": "My automation key",
  "prefix": "wc-abcde",
  "key": "wc-<full-key>",
  "createdAt": "ISO 8601"
}
```

The `key` field holds the full API key and the server returns it only at creation time. Store it securely; you cannot retrieve it later. The `prefix` (first eight characters) serves as a display identifier.

**Errors:** `400` (name missing, empty, or too long).

---

### `GET /api/v1/auth/api-keys`

List all API keys for the authenticated user.

**Auth:** Session cookie or API key required.

**Response:** `200`
```json
{
  "items": [
    {
      "id": "hash-of-key",
      "name": "My automation key",
      "prefix": "wc-abcde",
      "createdAt": "ISO 8601",
      "lastUsedAt": "ISO 8601 | null"
    }
  ]
}
```

Items are ordered by `created_at DESC`. The `lastUsedAt` timestamp updates at most once per hour.

---

### `DELETE /api/v1/auth/api-keys/:id`

Revoke an API key.

**Auth:** Session cookie or API key required. Must own the key.

**Request Body:** None.

**Response:** `204` (no body).

**Errors:** `404` if the key does not exist or is not owned by the user.

---

## Batches

All batch endpoints scope data to the authenticated user (`user_id` ownership check).

### `POST /api/v1/batches`

Create a new batch. Stage defaults to `"must_prep"`, status defaults to `"active"`.

**Auth:** Session cookie or API key required.

**Request Body:**

| Field                  | Type              | Required | Notes                                     |
|------------------------|-------------------|----------|-------------------------------------------|
| `name`                 | `string`          | Yes      | Min length 1                              |
| `wine_type`            | `WineType`        | Yes      | See enum reference                        |
| `source_material`      | `SourceMaterial`  | Yes      | See enum reference                        |
| `started_at`           | `string`          | Yes      | ISO 8601 datetime string                  |
| `volume_liters`        | `number \| null`  | No       | Current volume                            |
| `target_volume_liters` | `number \| null`  | No       | Target volume                             |
| `target_gravity`       | `number \| null`  | No       | Target final gravity                      |
| `notes`                | `string \| null`  | No       | Free text notes                           |

**Response:** `201` -- full batch row object.

**Errors:** `422` validation error.

---

### `GET /api/v1/batches`

List batches for the authenticated user.

**Auth:** Session cookie or API key required.

**Query Parameters:**

| Param             | Type     | Default Behavior                                                  |
|-------------------|----------|-------------------------------------------------------------------|
| `status`          | `string` | If provided, filters to that status. If omitted, excludes `"archived"`. |
| `stage`           | `string` | Filter by batch stage                                             |
| `wine_type`       | `string` | Filter by wine type                                               |
| `source_material` | `string` | Filter by source material                                         |

**Response:** `200`
```json
{
  "items": [ { /* batch row */ }, ... ]
}
```

The API orders items by `created_at DESC`.

**Note:** When no `status` filter is provided, the query excludes archived batches. To see archived batches, explicitly pass `status=archived`.

---

### `GET /api/v1/batches/:batchId`

Get a single batch by ID. The response includes winemaking intelligence fields beyond the base batch row.

**Auth:** Session cookie or API key required. Must own the batch.

**Response:** `200` -- batch row plus computed fields:

```json
{
  "...all batch row fields...",
  "nudges": [ "..." ],
  "timeline": [ { "label": "...", "estimated_date": "...", "basis": "...", "confidence": "..." } ],
  "currentPhase": {
    "label": "Primary Fermentation",
    "stage": "primary_fermentation",
    "daysElapsed": 5,
    "estimatedTotalDays": 7
  },
  "cellaring": null
}
```

#### `currentPhase` object

For active batches, `currentPhase` provides context about the batch's current winemaking stage. For non-active batches, this field is `null`.

| Field                | Type             | Notes                                                        |
|----------------------|------------------|--------------------------------------------------------------|
| `label`              | `string`         | Human-readable phase name (for example "Primary Fermentation") |
| `stage`              | `string`         | The batch's current waypoint stage                           |
| `daysElapsed`        | `number`         | Integer days since the batch entered this stage              |
| `estimatedTotalDays` | `number \| null` | Estimated total days for this phase, or `null` if unavailable |

The `estimatedTotalDays` field is populated only during `primary_fermentation`, based on wine type and source material. Kits and red wines estimate seven days; whites and other types estimate 14 days.

**Errors:** `404` if batch not found or not owned by user.

---

### `PATCH /api/v1/batches/:batchId`

Update a batch's mutable fields.

**Auth:** Session cookie or API key required. Must own the batch.

**Request Body (all fields optional):**

| Field                  | Type              | Notes                                         |
|------------------------|-------------------|-----------------------------------------------|
| `name`                 | `string`          | Min length 1                                  |
| `notes`                | `string \| null`  |                                               |
| `volume_liters`        | `number \| null`  |                                               |
| `target_volume_liters` | `number \| null`  |                                               |
| `target_gravity`       | `number \| null`  |                                               |
| `status`               | `BatchStatus`     | Subject to change rules (see below)           |

**Status change rules:**

| From         | Allowed To                         |
|--------------|------------------------------------|
| `active`     | `completed`, `abandoned`           |
| `completed`  | `active`, `archived`               |
| `abandoned`  | `active`                           |
| `archived`   | `completed`                        |

Setting the same status is a no-op (silently ignored). Invalid changes return `409`.

**Side effects when changing status:**
- Moving away from `active` to any non-active status unassigns all devices from the batch.
- Moving to `completed` also sets `completed_at`.
- Moving back to `active` clears `completed_at`.

If the request changes no fields, the endpoint returns the existing batch as-is.

**Response:** `200` -- updated batch row.

**Errors:** `404`, `409` (invalid status change), `422`.

---

### `DELETE /api/v1/batches/:batchId`

Delete a batch.

**Auth:** Session cookie or API key required. Must own the batch.

**Deletion rules:**
- If the batch status is `"abandoned"`, the endpoint always deletes it (cascade-deleting activities/readings).
- Otherwise, the endpoint checks for any associated activities or readings. If either exist, it blocks deletion with a `409` error advising the user to abandon first.

**Response:** `204` (no body).

**Errors:** `404`, `409` ("Batch has activities or readings. Abandon first.").

---

### `POST /api/v1/batches/:batchId/stage`

Set a batch's stage to an arbitrary waypoint stage (jump to any stage).

**Auth:** Session cookie or API key required. Must own the batch.

**Request Body:**

| Field   | Type         | Required | Notes                       |
|---------|--------------|----------|-----------------------------|
| `stage` | `BatchStage` | Yes      | One of the 5 waypoint stages |

**Preconditions:** Batch must be `active`. Returns `409` otherwise.

If the new stage equals the current stage, the endpoint returns the existing batch as a no-op.

**Side effects:** An activity of type `"note"` is automatically logged with the title `"Stage changed from <old> to <new>"`.

**Response:** `200` -- updated batch row.

**Errors:** `404`, `409`, `422`.

---

### `POST /api/v1/batches/:batchId/advance`

Advance a batch to the next waypoint stage in the defined order.

**Auth:** Session cookie or API key required. Must own the batch.

**Request Body:** None.

**Preconditions:**
- Batch must be `active`. Returns `409` otherwise.
- Batch must not be at the final stage (`bottling`). Returns `409` ("Batch is at final stage") otherwise.

**Side effects:** An activity of type `"note"` is automatically logged with the title `"Stage changed from <old> to <new>"`.

**Response:** `200` -- updated batch row.

**Errors:** `404`, `409`.

---

### `POST /api/v1/batches/:batchId/complete`

Mark a batch as completed.

**Auth:** Session cookie or API key required. Must own the batch.

**Request Body:** None.

**Preconditions:** Batch must be `active`.

**Side effects:**
- Sets `status` to `"completed"` and `completed_at` to the current UTC timestamp.
- Unassigns all devices from the batch.

**Response:** `200` -- updated batch row.

**Errors:** `404`, `409`.

---

### `POST /api/v1/batches/:batchId/abandon`

Mark a batch as abandoned.

**Auth:** Session cookie or API key required. Must own the batch.

**Request Body:** None.

**Preconditions:** Batch must be `active`.

**Side effects:**
- Sets `status` to `"abandoned"`.
- Unassigns all devices from the batch.

**Response:** `200` -- updated batch row.

**Errors:** `404`, `409`.

---

### `POST /api/v1/batches/:batchId/archive`

Archive a completed batch.

**Auth:** Session cookie or API key required. Must own the batch.

**Request Body:** None.

**Preconditions:** Batch must be `completed`.

**Response:** `200` -- updated batch row.

**Errors:** `404`, `409`.

---

### `POST /api/v1/batches/:batchId/unarchive`

Unarchive a batch (restores to `completed` status).

**Auth:** Session cookie or API key required. Must own the batch.

**Request Body:** None.

**Preconditions:** Batch must be `archived`.

**Response:** `200` -- updated batch row.

**Errors:** `404`, `409`.

---

## Activities

Scoped under a batch: `/api/v1/batches/:batchId/activities`. All endpoints verify batch ownership.

### `POST /api/v1/batches/:batchId/activities`

Create a new activity log entry.

**Auth:** Session cookie or API key required. Must own the batch.

**Preconditions:** Batch must be `active`.

**Request Body:**

| Field         | Type                          | Required | Notes                                                      |
|---------------|-------------------------------|----------|------------------------------------------------------------|
| `stage`       | `AllStage`                    | Yes      | Must be in the allowed set for the batch's current waypoint stage |
| `type`        | `ActivityType`                | Yes      | See enum reference                                          |
| `title`       | `string`                      | Yes      | Min length 1                                                |
| `details`     | `Record<string, unknown> \| null` | No   | Defaults to `null`. Arbitrary JSON object.                  |
| `recorded_at` | `string`                      | Yes      | ISO 8601 datetime string                                    |

**SG Measurement side effect:** If `type` is `"measurement"` and `details` has `{ "metric": "SG", "value": <number> }`, a corresponding manual reading row is automatically inserted into the `readings` table with `source = "manual"` and `device_id = "manual"`. The activity's `reading_id` is set to link the two.

**Response:** `201` -- activity row with `details` parsed as JSON (not a string).

**Errors:** `404` (batch not found), `409` (batch not active, or stage not allowed for current waypoint), `422`.

---

### `GET /api/v1/batches/:batchId/activities`

List activities for a batch.

**Auth:** Session cookie or API key required. Must own the batch.

**Query Parameters:**

| Param        | Type     | Notes                                       |
|--------------|----------|---------------------------------------------|
| `type`       | `string` | Filter by activity type                     |
| `stage`      | `string` | Filter by activity stage                    |
| `start_time` | `string` | ISO 8601. Inclusive lower bound on `recorded_at`. |
| `end_time`   | `string` | ISO 8601. Inclusive upper bound on `recorded_at`. |

**Response:** `200`
```json
{
  "items": [ { /* activity row, details is parsed JSON */ }, ... ]
}
```

The API orders items by `recorded_at DESC`.

---

### `PATCH /api/v1/batches/:batchId/activities/:activityId`

Update an activity.

**Auth:** Session cookie or API key required. Must own the activity (verified via `user_id`).

**Request Body (all fields optional):**

| Field         | Type                          | Notes                           |
|---------------|-------------------------------|---------------------------------|
| `title`       | `string`                      | Min length 1                    |
| `details`     | `Record<string, unknown> \| null` |                             |
| `recorded_at` | `string`                      | ISO 8601 datetime               |

If the request changes no fields, the endpoint returns the existing activity as-is.

**Linked reading sync:** If the activity has a linked `reading_id` (from an SG measurement), updating `details.value` or `recorded_at` also updates the linked reading's `gravity` and `source_timestamp`.

**Response:** `200` -- updated activity row with `details` parsed as JSON.

**Errors:** `404`, `422`.

---

### `DELETE /api/v1/batches/:batchId/activities/:activityId`

Delete an activity.

**Auth:** Session cookie or API key required. Must own the activity.

**Side effects:** If the activity has a linked `reading_id`, the linked reading is also deleted.

**Response:** `204` (no body).

**Errors:** `404`.

---

## Readings

Clients access readings through two parallel sub-routes, which share the same cursor-based pagination logic.

### Pagination model

All readings endpoints use keyset or cursor pagination based on `(source_timestamp, id)` in descending order.

| Query Param  | Type     | Default | Notes                                                    |
|--------------|----------|---------|----------------------------------------------------------|
| `limit`      | `number` | `100`   | Clamped to range `[1, 500]`.                             |
| `cursor`     | `string` | (none)  | Opaque base64 cursor from an earlier response.            |
| `start_time` | `string` | (none)  | ISO 8601. Inclusive lower bound on `source_timestamp`.   |
| `end_time`   | `string` | (none)  | ISO 8601. Inclusive upper bound on `source_timestamp`.   |

**Response shape:**
```json
{
  "items": [ { /* reading row */ }, ... ],
  "next_cursor": "base64string" | null
}
```

`next_cursor` is `null` when there are no more results. To fetch the next page, pass the returned cursor as the `cursor` query parameter.

**Cursor format (internal):** Base64-encoded JSON array `[source_timestamp, id]`. Decoded internally to construct a `(source_timestamp < ? OR (source_timestamp = ? AND id < ?))` clause.

---

### `GET /api/v1/batches/:batchId/readings`

List readings for a specific batch.

**Auth:** Session cookie or API key required. Must own the batch.

**Query Parameters:** See the earlier pagination model.

Additionally filters by `user_id` to ensure ownership.

**Errors:** `404` if batch not found or not owned.

---

### `GET /api/v1/devices/:deviceId/readings`

List readings for a specific device.

**Auth:** Session cookie or API key required. Must own the device.

**Query Parameters:** See the earlier pagination model.

Additionally filters by `user_id` to ensure ownership.

**Errors:** `404` if device not found or not owned.

---

### Reading row shape

```json
{
  "id": "uuid",
  "batch_id": "uuid | null",
  "device_id": "string",
  "gravity": 1.045,
  "temperature": 22.5,
  "battery": 3.92,
  "rssi": -67,
  "source_timestamp": "2026-03-20T14:30:00.000Z",
  "created_at": "2026-03-20T14:30:05.000Z",
  "source": "device | manual",
  "user_id": "uuid | null"
}
```

For manual readings (created through SG measurement activities): `device_id` is `"manual"`, `temperature`/`battery`/`rssi` are `null`, and `source` is `"manual"`.

---

## Devices

### `POST /api/v1/devices`

Register a new device.

**Auth:** Session cookie or API key required.

**Request Body:**

| Field  | Type     | Required | Notes                                        |
|--------|----------|----------|----------------------------------------------|
| `id`   | `string` | Yes      | Min length 1. The hardware device identifier. |
| `name` | `string` | Yes      | Min length 1. Display name.                   |

**Response:** `201` -- device row.

**Errors:** `409` ("Device already registered" -- UNIQUE constraint on id), `422`.

---

### `GET /api/v1/devices`

List all devices owned by the authenticated user.

**Auth:** Session cookie or API key required.

**Response:** `200`
```json
{
  "items": [ { /* device row */ }, ... ]
}
```

The API orders items by `created_at DESC`.

---

### `POST /api/v1/devices/claim`

Claim an unclaimed device (a device auto-registered by a webhook with no `user_id`).

**Auth:** Session cookie or API key required.

**Request Body:**

| Field       | Type     | Required | Notes    |
|-------------|----------|----------|----------|
| `device_id` | `string` | Yes      |          |

**Side effects:**
- Sets `user_id` on the device to the current user.
- Backfills `user_id` on all readings from this device that have `user_id IS NULL`.

**Response:** `200` -- updated device row.

**Errors:** `404` ("Device not found or already claimed"), `422`.

---

### `POST /api/v1/devices/:deviceId/assign`

Assign a device to a batch.

**Auth:** Session cookie or API key required. Must own both the device and the batch.

**Request Body:**

| Field      | Type     | Required | Notes                                |
|------------|----------|----------|--------------------------------------|
| `batch_id` | `string` | Yes      | Min length 1. UUID of the target batch. |

**Preconditions:** Target batch must be `active`.

**Side effects:**
- Sets `batch_id` and `assigned_at` on the device.
- Backfills `batch_id` on all unassigned readings from this device where `source_timestamp >= batch.started_at`.

**Response:** `200` -- updated device row.

**Errors:** `404` (device or batch not found), `409` ("Can only assign to active batches"), `422`.

---

### `POST /api/v1/devices/:deviceId/unassign`

Unassign a device from its current batch.

**Auth:** Session cookie or API key required. Must own the device.

**Request Body:** None.

**Side effects:** Clears `batch_id` and `assigned_at` on the device.

**Response:** `200` -- updated device row.

**Errors:** `404`.

---

### Device row shape

```json
{
  "id": "string (hardware ID)",
  "name": "string",
  "user_id": "uuid | null",
  "batch_id": "uuid | null",
  "assigned_at": "ISO 8601 | null",
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

---

## Push notifications

### `GET /api/v1/push/vapid-key`

Get the server's VAPID public key for Web Push subscription.

**Auth:** Session cookie or API key required.

**Response:** `200`
```json
{ "key": "<base64url VAPID public key>" }
```

---

### `POST /api/v1/push/subscribe`

Register a push subscription for the authenticated user.

**Auth:** Session cookie or API key required.

**Request Body:**

| Field           | Type     | Required | Notes                        |
|-----------------|----------|----------|------------------------------|
| `endpoint`      | `string` | Yes      | Must be a valid URL.         |
| `keys.p256dh`   | `string` | Yes      | Min length 1. P-256 DH key. |
| `keys.auth`     | `string` | Yes      | Min length 1. Auth secret.   |

If the endpoint already exists, the handler updates the keys and user (upsert via `ON CONFLICT(endpoint)`).

**Response:** `201`
```json
{ "endpoint": "https://..." }
```

**Errors:** `422`.

---

### `DELETE /api/v1/push/subscribe`

Remove a push subscription.

**Auth:** Session cookie or API key required.

**Request Body:**

| Field      | Type     | Required | Notes                |
|------------|----------|----------|----------------------|
| `endpoint` | `string` | Yes      | Must be a valid URL. |

Only deletes subscriptions owned by the authenticated user.

**Response:** `204` (no body).

**Errors:** `422`.

---

### `POST /api/v1/push/test`

Send a test push notification to the authenticated user's subscriptions.

**Auth:** Session cookie or API key required.

**Request Body:** None.

**Push payload sent:**
```json
{
  "title": "Test Notification",
  "body": "Push notifications are working!",
  "url": "/settings",
  "type": "test",
  "alertId": "test"
}
```

**Response:** `200`
```json
{ "status": "sent" }
```

---

## Alerts

### `POST /api/v1/alerts/:alertId/dismiss`

Close an active alert.

**Auth:** Session cookie or API key required. Must own the alert.

**Request Body:** None.

**Preconditions:** The alert must exist, belong to the authenticated user, and be both unresolved (`resolved_at IS NULL`) and not already dismissed (`dismissed_at IS NULL`).

**Side effects:** Sets `dismissed_at` to the current UTC timestamp. The alert will no longer appear in the dashboard's active alerts list. The alert will not re-fire until the underlying condition resolves first and then triggers again.

**Response:** `200`
```json
{ "status": "dismissed" }
```

**Errors:** `404` (alert not found, already resolved, or already dismissed).

---

## Dashboard

### `GET /api/v1/dashboard`

Get the aggregated dashboard view for the authenticated user.

**Auth:** Session cookie or API key required.

**Request Body / Query Parameters:** None.

**Response:** `200`
```json
{
  "active_batches": [ /* batch summary objects */ ],
  "recent_activities": [ /* activity objects */ ],
  "alerts": [ /* active alert objects */ ]
}
```

#### `active_batches` item shape

Each item includes all fields from the batch row, plus computed fields:

| Field             | Type                     | Notes                                                                 |
|-------------------|--------------------------|-----------------------------------------------------------------------|
| *(all batch cols)*| --                       | All columns from the `batches` table                                  |
| `first_reading`   | `object \| null`        | `{ gravity, temperature, source_timestamp }` -- earliest reading      |
| `latest_reading`  | `object \| null`        | `{ gravity, temperature, source_timestamp }` -- most recent reading   |
| `velocity`        | `number \| null`        | SG change per day over the last 48 hours. Negative = gravity dropping. |
| `days_fermenting` | `number`                | Integer days since `started_at`                                       |
| `sparkline`       | `array`                 | Up to 200 points: `[{ g, temp, t }]` ordered chronologically         |

The dashboard calculates velocity as: `(latest.gravity - oldest_in_48h.gravity) / days_elapsed`. Returns `null` if there are fewer than 2 readings in the 48h window or if they share the same timestamp.

#### `recent_activities` item shape

Up to 8 most recent activities across all batches, ordered by `recorded_at DESC`:

| Field             | Type                     | Notes                                               |
|-------------------|--------------------------|-----------------------------------------------------|
| *(all activity cols)*| --                    | All columns from the `activities` table              |
| `batch_name`      | `string`                | Name of the parent batch (from JOIN)                 |
| `details`         | `object \| null`        | Parsed from JSON string                              |

#### `alerts` item shape

Active (unresolved, not dismissed) alerts:

| Field         | Type             | Notes                                        |
|---------------|------------------|----------------------------------------------|
| `id`          | `string`         | Alert UUID                                   |
| `user_id`     | `string`         | Owner                                        |
| `batch_id`    | `string`         | Related batch                                |
| `alert_type`  | `AlertType`      | See alert types enum                         |
| `context`     | `string \| null` | JSON-encoded context object (not parsed)     |
| `fired_at`    | `string`         | ISO 8601 timestamp when alert was created    |
| `batch_name`  | `string`         | Name of the related batch (from JOIN)        |

Ordered by `fired_at DESC`.

---

## Webhook

The router mounts webhook endpoints at `/webhook/` (not under `/api/v1/`). They bypass Cloudflare Access auth and use their own authentication mechanism.

### `POST /webhook/rapt`

Receive a telemetry payload from a RAPT device.

**Auth:** `X-Webhook-Token` header. The handler compares it against the `WEBHOOK_TOKEN` environment variable using a timing-safe comparison, and checks auth before body parsing.

**Request Body:**

| Field          | Type     | Required | Notes                                 |
|----------------|----------|----------|---------------------------------------|
| `device_id`    | `string` | Yes      | Hardware device identifier            |
| `device_name`  | `string` | Yes      | Device display name                   |
| `temperature`  | `number` | Yes      | Temperature in Celsius                |
| `gravity`      | `number` | Yes      | Specific gravity                      |
| `battery`      | `number` | Yes      | Battery voltage                       |
| `rssi`         | `number` | Yes      | Wi-Fi signal strength (dBm)           |
| `created_date` | `string` | Yes      | Timestamp from the device (ISO 8601)  |

**Note:** The handler sanitizes the raw body by stripping null bytes (`\0`) before JSON parsing, because RAPT devices sometimes include them in payloads.

**Processing logic:**
1. If the device does not exist, the system auto-registers it with `user_id = NULL` (unclaimed).
2. The handler inserts a reading row. If the reading already exists (UNIQUE constraint on `device_id + source_timestamp`), the handler returns a duplicate response.
3. If the device has a `batch_id` and `user_id`, alert evaluation runs:
   - Fetches the last 200 readings for the batch.
   - Evaluates temperature, stall, no-readings, and stage-suggestion alerts.
   - The alert manager persists new alerts to `alert_state` and sends push notifications.
   - Alerts whose conditions no longer hold are auto-resolved.

**Response (success):** `200`
```json
{ "status": "ok", "reading_id": "uuid" }
```

**Response (duplicate):** `200`
```json
{ "status": "duplicate", "message": "Reading already exists" }
```

**Errors:** `401` (invalid webhook token), `422` (validation error).

---

## Alert evaluation details

The webhook handler evaluates alerts on each incoming reading for batches with an assigned device. The following rules apply:

### Temperature high (`temp_high`)
- **Condition:** Latest reading temperature >= threshold. The threshold varies by wine type: 22 C for whites and roses, 30 C for all others.
- **Context:** `{ temperature: <value> }`

### Temperature low (`temp_low`)
- **Condition:** Latest reading temperature <= threshold. The threshold varies by wine type: 10 C for reds and orange wines, 8 C for all others.
- **Context:** `{ temperature: <value> }`

### No readings (`no_readings`)
- **Condition:** Device is assigned and the latest reading is older than 48 hours.
- **Context:** `{ lastReadingAt: <timestamp>, hoursAgo: <integer> }`

### Fermentation stall (`stall`)
- **Requires:** >= 10 readings.
- **Condition:** Gravity is above 1.005 and >= 0.998, AND either:
  - 48h velocity absolute value < 0.0005 (flat), OR
  - 48h velocity < 20% of 7-day velocity (slowing dramatically).
- **Context:** `{ gravity, velocity48h, velocity7d, reason }`

### Stage suggestion (`stage_suggestion`)
- **Requires:** >= 10 readings.
- **Primary fermentation -> secondary:** Gravity < 1.02 and 48h velocity < 50% of 7-day velocity.
  - **Context:** `{ suggestedStage: "secondary_fermentation", gravity, velocity48h, velocity7d }`
- **Secondary fermentation -> stabilization:** 72h gravity range < 0.001 AND (gravity < 1.000 OR within 0.002 of target gravity).
  - **Context:** `{ suggestedStage: "stabilization", gravity, gravityRange72h }`

### Racking due (`racking_due_1`, `racking_due_2`, `racking_due_3`)
- **Condition:** The estimated racking date for the first, second, or third racking has passed and the user has not yet logged that racking.
- **Context:** `{ message: "<label> racking is due for <batch_name>" }`

### SO2 due (`so2_due`)
- **Condition:** Either more than 42 days have passed since the last SO2 addition, or a racking happened in the last three days without a follow-up SO2 addition.
- **Context:** `{ message: "Consider an SO2 addition for <batch_name>" }`

### MLF check (`mlf_check`)
- **Condition:** MLF status is `in_progress` and at least 28 days have passed since MLF inoculation.
- **Context:** `{ message: "Check MLF progress on <batch_name>, test for malic acid" }`

### Bottling ready (`bottling_ready`)
- **Condition:** The estimated earliest bottling date has passed and the batch has at least three rackings.
- **Context:** `{ message: "<batch_name> has reached its earliest bottling window" }`

### Alert lifecycle
- **Dedup:** An alert type is only fired once per batch while it remains unresolved (regardless of dismissal).
- **Resolution:** On each webhook evaluation, `resolveCleared()` auto-resolves alert types not present in the current candidate list (sets `resolved_at`).
- **Dismissal:** Dismissed alerts remain unresolved until the condition clears, preventing re-fire spam.
- **Re-fire:** An alert can only fire again after the system resolves it (condition cleared) and the condition subsequently reappears.

---

## Batch row shape

For reference, the full batch row returned by all batch endpoints:

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "name": "string",
  "wine_type": "WineType",
  "source_material": "SourceMaterial",
  "stage": "BatchStage",
  "status": "BatchStatus",
  "volume_liters": "number | null",
  "target_volume_liters": "number | null",
  "target_gravity": "number | null",
  "started_at": "ISO 8601",
  "completed_at": "ISO 8601 | null",
  "notes": "string | null",
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

## Activity row shape

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "batch_id": "uuid",
  "stage": "AllStage",
  "type": "ActivityType",
  "title": "string",
  "details": "object | null",
  "recorded_at": "ISO 8601",
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601",
  "reading_id": "uuid | null"
}
```

Note: The API returns `details` as a parsed JSON object (not a string), even though D1 stores it as a JSON string.
