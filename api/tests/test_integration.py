import pytest

API = {"X-API-Key": "test-api-key"}
WEBHOOK = {"X-Webhook-Token": "test-webhook-token"}


@pytest.mark.asyncio
async def test_full_batch_workflow(client):
    """End-to-end: create batch, assign device, receive telemetry, log activities, complete."""

    # 1. Create batch
    r = await client.post(
        "/api/v1/batches",
        json={
            "name": "2026 Cab Sauv",
            "wine_type": "red",
            "source_material": "fresh_grapes",
            "started_at": "2026-09-15T08:00:00Z",
            "volume_liters": 23.0,
        },
        headers=API,
    )
    assert r.status_code == 201
    batch_id = r.json()["id"]

    # 2. Register and assign device
    await client.post(
        "/api/v1/devices",
        json={"id": "pill-001", "name": "Fermentation Pill"},
        headers=API,
    )
    r = await client.post(
        "/api/v1/devices/pill-001/assign",
        json={"batch_id": batch_id},
        headers=API,
    )
    assert r.json()["batch_id"] == batch_id

    # 3. Receive webhook telemetry
    r = await client.post(
        "/webhook/rapt",
        json={
            "device_id": "pill-001",
            "device_name": "Fermentation Pill",
            "temperature": 24.0,
            "gravity": 1.090,
            "battery": 98.0,
            "rssi": -55.0,
            "created_date": "2026-09-15T10:00:00Z",
        },
        headers=WEBHOOK,
    )
    assert r.status_code == 200

    # 4. Log activity
    r = await client.post(
        f"/api/v1/batches/{batch_id}/activities",
        json={
            "stage": "must_prep",
            "type": "addition",
            "title": "Added pectic enzyme",
            "details": {"chemical": "pectic enzyme", "amount": 1.0, "unit": "tsp"},
            "recorded_at": "2026-09-15T09:00:00Z",
        },
        headers=API,
    )
    assert r.status_code == 201

    # 5. Advance through stages
    for _ in range(4):
        await client.post(f"/api/v1/batches/{batch_id}/advance", headers=API)

    r = await client.get(f"/api/v1/batches/{batch_id}", headers=API)
    assert r.json()["stage"] == "bottling"

    # 6. Check readings
    r = await client.get(f"/api/v1/batches/{batch_id}/readings", headers=API)
    assert len(r.json()["items"]) == 1

    # 7. Complete batch (auto-unassigns device)
    r = await client.post(f"/api/v1/batches/{batch_id}/complete", headers=API)
    assert r.json()["status"] == "completed"

    # 8. Device should be unassigned
    r = await client.get("/api/v1/devices", headers=API)
    assert r.json()["items"][0]["batch_id"] is None

    # 9. Archive
    r = await client.post(f"/api/v1/batches/{batch_id}/archive", headers=API)
    assert r.json()["status"] == "archived"
