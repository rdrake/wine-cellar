import pytest
from httpx import ASGITransport, AsyncClient

from src.app import app
from src.db import Database
from src.schema import get_migration_sql


@pytest.fixture
def db():
    """Fresh in-memory database with schema applied."""
    database = Database()
    database.execute_script(get_migration_sql())
    return database


@pytest.fixture
async def client(db):
    """Async HTTP client with test database and secrets injected."""
    app.state.db = db
    app.state.api_key = "test-api-key"
    app.state.webhook_token = "test-webhook-token"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
