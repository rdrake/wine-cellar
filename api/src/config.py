"""Configuration and secret access.

On Cloudflare Workers, secrets are accessed via env bindings (set with
`wrangler secret put`), not os.environ. The app reads secrets from
app.state which is populated by middleware from the ASGI scope env.

For tests, app.state.api_key and app.state.webhook_token are set directly
in conftest.py.
"""

from __future__ import annotations

import hmac


def check_api_key(provided: str | None, expected: str) -> bool:
    """Constant-time comparison to prevent timing attacks."""
    if not provided or not expected:
        return False
    return hmac.compare_digest(provided.encode(), expected.encode())
