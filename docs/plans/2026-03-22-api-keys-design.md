# API Keys Design

## Goal

Let users create and manage personal API keys for programmatic access (MCP servers, automation). Keys provide full account access, authenticated via `Authorization: Bearer wc-...` header.

## Architecture

API keys follow the same pattern as session tokens: a random token is generated, shown once to the user, and stored as a SHA-256 hash. The auth middleware gains a second auth path — after checking for a session cookie, it checks for a Bearer token. Keys have no expiry and no scopes; they live until revoked.

## Data Model

### `api_keys` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | SHA-256 hash of the full key |
| `user_id` | TEXT FK → users | Owner |
| `name` | TEXT NOT NULL | User-provided label |
| `prefix` | TEXT NOT NULL | First 8 chars for display |
| `created_at` | TEXT | `datetime('now')` |
| `last_used_at` | TEXT | Updated on authenticated request (debounced to 1 hour) |

### Key format

`wc-` + 64 hex characters (32 random bytes). Example: `wc-a1b2c3d4e5f6...`

## API Routes

All management routes require session auth (cookie). Mounted under `/api/v1/auth/api-keys`.

### `POST /api/v1/auth/api-keys`

Create a new API key.

**Request:** `{ "name": "MCP Server" }`

**Response (201):**
```json
{
  "id": "<sha256-hash>",
  "name": "MCP Server",
  "prefix": "wc-a1b2c",
  "key": "wc-a1b2c3d4e5f6...",
  "createdAt": "2026-03-22T..."
}
```

The `key` field is only returned on creation.

### `GET /api/v1/auth/api-keys`

List all keys for the authenticated user.

**Response:**
```json
{
  "items": [
    {
      "id": "<sha256-hash>",
      "name": "MCP Server",
      "prefix": "wc-a1b2c",
      "createdAt": "2026-03-22T...",
      "lastUsedAt": "2026-03-22T..."
    }
  ]
}
```

### `DELETE /api/v1/auth/api-keys/:id`

Revoke (delete) a key. Returns 204.

## Middleware

In `access.ts`, after the session cookie check fails, check for `Authorization: Bearer wc-...`:

1. Extract token from header
2. Hash with SHA-256
3. Look up in `api_keys` by hash (id)
4. If found, resolve user from `user_id`
5. Update `last_used_at` if older than 1 hour
6. Set `c.set("user", user)` and continue

The webhook endpoint remains exempt (its own `WEBHOOK_TOKEN` auth). The `/api/v1/auth/api-keys` management routes are NOT exempt — they require session or API key auth like any other protected route.

## Dashboard UI

### Settings page — Account section

New "API Keys" block between Passkeys and Log Out:

- Header: "API Keys" + "For MCP servers and automation" + "Create" button
- Key list: name, prefix (`wc-a1b2c...`), created date, last used date, "Revoke" button per row
- Empty state: "No API keys yet"

### Creation dialog

1. Text input for name + Create button
2. On success: shows full key in monospace read-only field + Copy button
3. Warning: "Copy this key now — you won't be able to see it again"
4. Close refreshes the list

### Revoke

Immediate delete on click, no confirmation. Toast: "API key revoked".
