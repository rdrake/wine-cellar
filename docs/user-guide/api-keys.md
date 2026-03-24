# API Keys

API keys let you access Wine Cellar from scripts, integrations, or tools like
MCP servers without signing in through the browser.

## Creating a key

1. Open **Settings** from the bottom navigation bar.
2. Scroll to the **Security** section.
3. Tap **Create API Key**.
4. Give the key a name you'll recognise later (e.g., "Home Assistant" or
   "MCP Server").
5. Copy the key immediately — it won't be shown again.

The key starts with `wc-` and is around 70 characters long. Store it somewhere
safe, like a password manager or an environment variable.

## Using a key

Pass the key in the `Authorization` header as a Bearer token:

    Authorization: Bearer wc-your-key-here

Every `/api/v1/*` endpoint accepts API key authentication directly — no
session exchange needed.

## Revoking a key

In **Settings → Security**, tap the delete button next to the key you want to
revoke. The key stops working immediately.

## When to use an API key

| Scenario | Use |
|----------|-----|
| Browser / phone | GitHub sign-in or passkey — no key needed |
| Script or cron job | API key |
| MCP server | API key |
| CI / E2E tests | API key |

API keys have the same permissions as your account. Anyone with your key can
read and modify your batches, so treat it like a password.
