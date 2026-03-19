import pytest

HEADERS = {"X-API-Key": "test-api-key"}
BATCH = {
    "name": "2026 Merlot",
    "wine_type": "red",
    "source_material": "fresh_grapes",
    "started_at": "2026-03-19T10:00:00Z",
}


async def _create_batch(client):
    r = await client.post("/api/v1/batches", json=BATCH, headers=HEADERS)
    return r.json()["id"]


@pytest.mark.asyncio
async def test_advance_stage(client):
    batch_id = await _create_batch(client)
    r = await client.post(f"/api/v1/batches/{batch_id}/advance", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["stage"] == "primary_fermentation"


@pytest.mark.asyncio
async def test_advance_through_all_waypoints(client):
    batch_id = await _create_batch(client)
    expected = [
        "primary_fermentation",
        "secondary_fermentation",
        "stabilization",
        "bottling",
    ]
    for stage in expected:
        r = await client.post(f"/api/v1/batches/{batch_id}/advance", headers=HEADERS)
        assert r.json()["stage"] == stage


@pytest.mark.asyncio
async def test_advance_past_bottling_fails(client):
    batch_id = await _create_batch(client)
    for _ in range(4):
        await client.post(f"/api/v1/batches/{batch_id}/advance", headers=HEADERS)
    r = await client.post(f"/api/v1/batches/{batch_id}/advance", headers=HEADERS)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_complete_batch(client):
    batch_id = await _create_batch(client)
    r = await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["status"] == "completed"
    assert r.json()["completed_at"] is not None


@pytest.mark.asyncio
async def test_complete_non_active_fails(client):
    batch_id = await _create_batch(client)
    await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    r = await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_abandon_batch(client):
    batch_id = await _create_batch(client)
    r = await client.post(f"/api/v1/batches/{batch_id}/abandon", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["status"] == "abandoned"


@pytest.mark.asyncio
async def test_advance_abandoned_fails(client):
    batch_id = await _create_batch(client)
    await client.post(f"/api/v1/batches/{batch_id}/abandon", headers=HEADERS)
    r = await client.post(f"/api/v1/batches/{batch_id}/advance", headers=HEADERS)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_archive_completed_batch(client):
    batch_id = await _create_batch(client)
    await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    r = await client.post(f"/api/v1/batches/{batch_id}/archive", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["status"] == "archived"


@pytest.mark.asyncio
async def test_archive_active_fails(client):
    batch_id = await _create_batch(client)
    r = await client.post(f"/api/v1/batches/{batch_id}/archive", headers=HEADERS)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_unarchive_batch(client):
    batch_id = await _create_batch(client)
    await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    await client.post(f"/api/v1/batches/{batch_id}/archive", headers=HEADERS)
    r = await client.post(f"/api/v1/batches/{batch_id}/unarchive", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_complete_unassigns_device(client, db):
    batch_id = await _create_batch(client)
    # Register and assign device via direct DB
    # (device routes not available until Task 9)
    await db.execute(
        "INSERT INTO devices "
        "(id, name, batch_id, assigned_at, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            "pill-1",
            "My Pill",
            batch_id,
            "2026-03-19T10:00:00Z",
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
        ),
    )
    await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    device = await db.query_one("SELECT * FROM devices WHERE id = 'pill-1'")
    assert device["batch_id"] is None
