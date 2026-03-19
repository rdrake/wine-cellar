import pytest


@pytest.mark.asyncio
async def test_health_no_auth_required(client):
    response = await client.get("/health")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_api_requires_auth(client):
    response = await client.get("/api/v1/batches")
    assert response.status_code == 401
    assert response.json()["error"] == "unauthorized"


@pytest.mark.asyncio
async def test_api_valid_auth(client):
    response = await client.get(
        "/api/v1/batches",
        headers={"X-API-Key": "test-api-key"},
    )
    # Should not be 401 (might be 200 with empty list or 404)
    assert response.status_code != 401


@pytest.mark.asyncio
async def test_api_invalid_auth(client):
    response = await client.get(
        "/api/v1/batches",
        headers={"X-API-Key": "wrong-key"},
    )
    assert response.status_code == 401
