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
async def test_create_activity_addition(client):
    batch_id = await _create_batch(client)
    activity = {
        "stage": "must_prep",
        "type": "addition",
        "title": "Added K-meta",
        "details": {"chemical": "K-meta", "amount": 0.25, "unit": "tsp"},
        "recorded_at": "2026-03-19T10:00:00Z",
    }
    r = await client.post(
        f"/api/v1/batches/{batch_id}/activities",
        json=activity,
        headers=HEADERS,
    )
    assert r.status_code == 201
    assert r.json()["title"] == "Added K-meta"
    assert r.json()["details"]["chemical"] == "K-meta"


@pytest.mark.asyncio
async def test_create_activity_invalid_stage_for_waypoint(client):
    batch_id = await _create_batch(client)
    # Batch is at must_prep, but trying to log a bottling activity
    activity = {
        "stage": "bottling",
        "type": "note",
        "title": "Too early",
        "details": {},
        "recorded_at": "2026-03-19T10:00:00Z",
    }
    r = await client.post(
        f"/api/v1/batches/{batch_id}/activities",
        json=activity,
        headers=HEADERS,
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_list_activities(client):
    batch_id = await _create_batch(client)
    for i in range(3):
        activity = {
            "stage": "must_prep",
            "type": "note",
            "title": f"Note {i}",
            "details": {},
            "recorded_at": f"2026-03-19T1{i}:00:00Z",
        }
        await client.post(
            f"/api/v1/batches/{batch_id}/activities",
            json=activity,
            headers=HEADERS,
        )
    r = await client.get(
        f"/api/v1/batches/{batch_id}/activities",
        headers=HEADERS,
    )
    assert r.status_code == 200
    assert len(r.json()["items"]) == 3


@pytest.mark.asyncio
async def test_list_activities_filter_by_type(client):
    batch_id = await _create_batch(client)
    note = {
        "stage": "must_prep",
        "type": "note",
        "title": "A note",
        "details": {},
        "recorded_at": "2026-03-19T10:00:00Z",
    }
    addition = {
        "stage": "must_prep",
        "type": "addition",
        "title": "K-meta",
        "details": {
            "chemical": "K-meta",
            "amount": 1,
            "unit": "tsp",
        },
        "recorded_at": "2026-03-19T11:00:00Z",
    }
    await client.post(
        f"/api/v1/batches/{batch_id}/activities",
        json=note,
        headers=HEADERS,
    )
    await client.post(
        f"/api/v1/batches/{batch_id}/activities",
        json=addition,
        headers=HEADERS,
    )
    r = await client.get(
        f"/api/v1/batches/{batch_id}/activities?type=addition",
        headers=HEADERS,
    )
    assert len(r.json()["items"]) == 1


@pytest.mark.asyncio
async def test_update_activity(client):
    batch_id = await _create_batch(client)
    activity = {
        "stage": "must_prep",
        "type": "note",
        "title": "Original",
        "details": {},
        "recorded_at": "2026-03-19T10:00:00Z",
    }
    r = await client.post(
        f"/api/v1/batches/{batch_id}/activities",
        json=activity,
        headers=HEADERS,
    )
    activity_id = r.json()["id"]
    r = await client.patch(
        f"/api/v1/batches/{batch_id}/activities/{activity_id}",
        json={"title": "Updated"},
        headers=HEADERS,
    )
    assert r.status_code == 200
    assert r.json()["title"] == "Updated"


@pytest.mark.asyncio
async def test_delete_activity(client):
    batch_id = await _create_batch(client)
    activity = {
        "stage": "must_prep",
        "type": "note",
        "title": "Delete me",
        "details": {},
        "recorded_at": "2026-03-19T10:00:00Z",
    }
    r = await client.post(
        f"/api/v1/batches/{batch_id}/activities",
        json=activity,
        headers=HEADERS,
    )
    activity_id = r.json()["id"]
    r = await client.delete(
        f"/api/v1/batches/{batch_id}/activities/{activity_id}",
        headers=HEADERS,
    )
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_cannot_log_activity_on_completed_batch(client):
    batch_id = await _create_batch(client)
    await client.post(
        f"/api/v1/batches/{batch_id}/complete",
        headers=HEADERS,
    )
    activity = {
        "stage": "must_prep",
        "type": "note",
        "title": "Too late",
        "details": {},
        "recorded_at": "2026-03-19T10:00:00Z",
    }
    r = await client.post(
        f"/api/v1/batches/{batch_id}/activities",
        json=activity,
        headers=HEADERS,
    )
    assert r.status_code == 409
