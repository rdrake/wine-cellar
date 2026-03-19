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
async def test_register_device(client):
    r = await client.post(
        "/api/v1/devices",
        json={"id": "pill-1", "name": "My Pill"},
        headers=HEADERS,
    )
    assert r.status_code == 201
    assert r.json()["id"] == "pill-1"
    assert r.json()["batch_id"] is None


@pytest.mark.asyncio
async def test_register_duplicate_device(client):
    await client.post(
        "/api/v1/devices",
        json={"id": "pill-1", "name": "My Pill"},
        headers=HEADERS,
    )
    r = await client.post(
        "/api/v1/devices",
        json={"id": "pill-1", "name": "Dupe"},
        headers=HEADERS,
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_list_devices(client):
    await client.post(
        "/api/v1/devices",
        json={"id": "pill-1", "name": "Pill 1"},
        headers=HEADERS,
    )
    await client.post(
        "/api/v1/devices",
        json={"id": "pill-2", "name": "Pill 2"},
        headers=HEADERS,
    )
    r = await client.get("/api/v1/devices", headers=HEADERS)
    assert len(r.json()["items"]) == 2


@pytest.mark.asyncio
async def test_assign_device(client):
    batch_id = await _create_batch(client)
    await client.post(
        "/api/v1/devices",
        json={"id": "pill-1", "name": "My Pill"},
        headers=HEADERS,
    )
    r = await client.post(
        "/api/v1/devices/pill-1/assign",
        json={"batch_id": batch_id},
        headers=HEADERS,
    )
    assert r.status_code == 200
    assert r.json()["batch_id"] == batch_id


@pytest.mark.asyncio
async def test_assign_to_non_active_batch_fails(client):
    batch_id = await _create_batch(client)
    await client.post(
        f"/api/v1/batches/{batch_id}/complete", headers=HEADERS
    )
    await client.post(
        "/api/v1/devices",
        json={"id": "pill-1", "name": "My Pill"},
        headers=HEADERS,
    )
    r = await client.post(
        "/api/v1/devices/pill-1/assign",
        json={"batch_id": batch_id},
        headers=HEADERS,
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_unassign_device(client):
    batch_id = await _create_batch(client)
    await client.post(
        "/api/v1/devices",
        json={"id": "pill-1", "name": "My Pill"},
        headers=HEADERS,
    )
    await client.post(
        "/api/v1/devices/pill-1/assign",
        json={"batch_id": batch_id},
        headers=HEADERS,
    )
    r = await client.post("/api/v1/devices/pill-1/unassign", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["batch_id"] is None


@pytest.mark.asyncio
async def test_assign_backfills_readings(client, db):
    batch_id = await _create_batch(client)
    await client.post(
        "/api/v1/devices",
        json={"id": "pill-1", "name": "My Pill"},
        headers=HEADERS,
    )
    # Insert unassigned readings -- one before batch start, one after
    await db.execute(
        "INSERT INTO readings "
        "(id, batch_id, device_id, gravity, temperature, battery, rssi, "
        "source_timestamp, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "r1", None, "pill-1", 1.090, 22.0, 95.0, -60.0,
            "2026-03-18T10:00:00Z", "2026-03-18T10:00:00Z",
        ),
    )
    await db.execute(
        "INSERT INTO readings "
        "(id, batch_id, device_id, gravity, temperature, battery, rssi, "
        "source_timestamp, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "r2", None, "pill-1", 1.088, 22.5, 94.0, -62.0,
            "2026-03-19T12:00:00Z", "2026-03-19T12:00:00Z",
        ),
    )
    await client.post(
        "/api/v1/devices/pill-1/assign",
        json={"batch_id": batch_id},
        headers=HEADERS,
    )
    # r1 is before started_at, should remain unassigned
    r1 = await db.query_one(
        "SELECT batch_id FROM readings WHERE id = 'r1'"
    )
    assert r1["batch_id"] is None
    # r2 is after started_at, should be backfilled
    r2 = await db.query_one(
        "SELECT batch_id FROM readings WHERE id = 'r2'"
    )
    assert r2["batch_id"] == batch_id
