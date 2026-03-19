from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from src.config import check_api_key
from src.db import Database

app = FastAPI(
    title="Wine Cellar API",
    version="0.1.0",
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
)


@app.middleware("http")
async def env_middleware(request: Request, call_next):
    """Wire Cloudflare env bindings (D1, secrets) into app.state on each request."""
    env = request.scope.get("env")
    if env:
        if not hasattr(app.state, "db") or app.state.db is None:
            app.state.db = Database(d1_binding=env.DB)
        app.state.api_key = str(env.API_KEY)
        app.state.webhook_token = str(env.WEBHOOK_TOKEN)
    return await call_next(request)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path in ("/health", "/api/v1/docs", "/api/v1/openapi.json") or path.startswith(
        "/webhook"
    ):
        return await call_next(request)
    if path.startswith("/api/v1/"):
        api_key = request.headers.get("X-API-Key")
        expected = getattr(app.state, "api_key", "")
        if not check_api_key(api_key, expected):
            return JSONResponse(
                status_code=401,
                content={
                    "error": "unauthorized",
                    "message": "Invalid or missing API key",
                },
            )
    return await call_next(request)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# Stub: will be replaced by router in Task 6
@app.get("/api/v1/batches")
async def list_batches_stub() -> dict:
    return {"items": []}


# Cloudflare Worker entrypoint
try:
    import asgi  # type: ignore[import-untyped]
    from workers import WorkerEntrypoint  # type: ignore[import-untyped]

    class Default(WorkerEntrypoint):
        async def fetch(self, request):
            return await asgi.fetch(app, request.js_object, self.env)

except ImportError:
    pass
