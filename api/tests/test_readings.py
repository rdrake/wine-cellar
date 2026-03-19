import pytest

HEADERS = {"X-API-Key": "test-api-key"}
BATCH = {
    "name": "2026 Merlot",
    "wine_type": "red",
    "source_material": "fresh_grapes",
    "started_at": "2026-03-19T10:00:00Z",
}


async def _insert_readings(db, batch_id, device_id, count):
    for i in range(count):
        await db.execute(
            "INSERT INTO readings "
            "(id, batch_id, device_id, gravity, temperature, "
            "battery, rssi, source_timestamp, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                f"r{i}", batch_id, device_id,
                1.090 - i * 0.001, 22.0, 95.0, -60.0,
                f"2026-03-19T{10 + i:02d}:00:00Z",
                f"2026-03-19T{10 + i:02d}:00:05Z",
            ),
        )


@pytest.mark.asyncio
async def test_list_readings_by_batch(client, db):
    r = await client.post("/api/v1/batches", json=BATCH, headers=HEADERS)
    batch_id = r.json()["id"]
    await _insert_readings(db, batch_id, "pill-1", 5)
    r = await client.get(
        f"/api/v1/batches/{batch_id}/readings", headers=HEADERS
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 5
    # Newest first
    assert items[0]["source_timestamp"] > items[-1]["source_timestamp"]


@pytest.mark.asyncio
async def test_list_readings_by_device(client, db):
    await db.execute(
        "INSERT INTO devices (id, name, created_at, updated_at) "
        "VALUES (?, ?, ?, ?)",
        ("pill-1", "My Pill", "2026-01-01T00:00:00Z",
         "2026-01-01T00:00:00Z"),
    )
    await _insert_readings(db, None, "pill-1", 3)
    r = await client.get(
        "/api/v1/devices/pill-1/readings", headers=HEADERS
    )
    assert r.status_code == 200
    assert len(r.json()["items"]) == 3


@pytest.mark.asyncio
async def test_readings_pagination(client, db):
    r = await client.post("/api/v1/batches", json=BATCH, headers=HEADERS)
    batch_id = r.json()["id"]
    await _insert_readings(db, batch_id, "pill-1", 5)
    # First page: limit 2
    r = await client.get(
        f"/api/v1/batches/{batch_id}/readings?limit=2", headers=HEADERS
    )
    data = r.json()
    assert len(data["items"]) == 2
    assert data["next_cursor"] is not None
    # Second page
    r = await client.get(
        f"/api/v1/batches/{batch_id}/readings"
        f"?limit=2&cursor={data['next_cursor']}",
        headers=HEADERS,
    )
    data2 = r.json()
    assert len(data2["items"]) == 2
    # No overlap
    ids_page1 = {item["id"] for item in data["items"]}
    ids_page2 = {item["id"] for item in data2["items"]}
    assert ids_page1.isdisjoint(ids_page2)
