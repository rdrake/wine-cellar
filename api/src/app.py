from fastapi import FastAPI

app = FastAPI(
    title="Wine Cellar API",
    version="0.1.0",
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# Cloudflare Worker entrypoint
try:
    import asgi  # type: ignore[import-untyped]
    from workers import WorkerEntrypoint  # type: ignore[import-untyped]

    class Default(WorkerEntrypoint):
        async def fetch(self, request):
            return await asgi.fetch(app, request.js_object, self.env)

except ImportError:
    pass
