import pytest

WEBHOOK_HEADERS = {"X-Webhook-Token": "test-webhook-token"}

VALID_PAYLOAD = {
    "device_id": "pill-abc-123",
    "device_name": "My RAPT Pill",
    "temperature": 22.5,
    "gravity": 1.045,
    "battery": 92.3,
    "rssi": -58.0,
    "created_date": "2026-03-19T14:30:00Z",
}


@pytest.mark.asyncio
async def test_webhook_creates_reading(client, db):
    # Register device first
    await db.execute(
        "INSERT INTO devices (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ("pill-abc-123", "My Pill", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    r = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers=WEBHOOK_HEADERS)
    assert r.status_code == 200
    reading = await db.query_one("SELECT * FROM readings WHERE device_id = 'pill-abc-123'")
    assert reading is not None
    assert reading["gravity"] == 1.045
    assert reading["temperature"] == 22.5
    assert reading["source_timestamp"] == "2026-03-19T14:30:00Z"


@pytest.mark.asyncio
async def test_webhook_auto_registers_unknown_device(client, db):
    r = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers=WEBHOOK_HEADERS)
    assert r.status_code == 200
    device = await db.query_one("SELECT * FROM devices WHERE id = 'pill-abc-123'")
    assert device is not None
    assert device["name"] == "My RAPT Pill"


@pytest.mark.asyncio
async def test_webhook_resolves_batch_from_device(client, db):
    # Create batch and assign device
    headers = {"X-API-Key": "test-api-key"}
    r = await client.post(
        "/api/v1/batches",
        json={
            "name": "Test",
            "wine_type": "red",
            "source_material": "kit",
            "started_at": "2026-03-19T10:00:00Z",
        },
        headers=headers,
    )
    batch_id = r.json()["id"]
    await db.execute(
        "INSERT INTO devices (id, name, batch_id, assigned_at,"
        " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (
            "pill-abc-123",
            "My Pill",
            batch_id,
            "2026-03-19T10:00:00Z",
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
        ),
    )
    r = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers=WEBHOOK_HEADERS)
    assert r.status_code == 200
    reading = await db.query_one("SELECT batch_id FROM readings WHERE device_id = 'pill-abc-123'")
    assert reading["batch_id"] == batch_id


@pytest.mark.asyncio
async def test_webhook_unassigned_device_null_batch(client):
    r = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers=WEBHOOK_HEADERS)
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_webhook_deduplicate(client):
    r1 = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers=WEBHOOK_HEADERS)
    assert r1.status_code == 200
    r2 = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers=WEBHOOK_HEADERS)
    assert r2.status_code == 200  # Returns 200 on conflict, not error


@pytest.mark.asyncio
async def test_webhook_invalid_token(client):
    bad_headers = {"X-Webhook-Token": "wrong"}
    r = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers=bad_headers)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_webhook_missing_token(client):
    r = await client.post("/webhook/rapt", json=VALID_PAYLOAD)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_webhook_invalid_payload(client):
    r = await client.post("/webhook/rapt", json={"bad": "data"}, headers=WEBHOOK_HEADERS)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_webhook_missing_token_with_invalid_payload(client):
    """Auth must be checked before body validation -- should get 401 not 422."""
    r = await client.post("/webhook/rapt", json={"bad": "data"})
    assert r.status_code == 401
