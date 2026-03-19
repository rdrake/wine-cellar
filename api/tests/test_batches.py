import pytest

HEADERS = {"X-API-Key": "test-api-key"}

VALID_BATCH = {
    "name": "2026 Merlot",
    "wine_type": "red",
    "source_material": "fresh_grapes",
    "started_at": "2026-03-19T10:00:00Z",
    "volume_liters": 23.0,
    "target_volume_liters": 20.0,
    "notes": "First attempt",
}


@pytest.mark.asyncio
async def test_create_batch(client):
    response = await client.post("/api/v1/batches", json=VALID_BATCH, headers=HEADERS)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "2026 Merlot"
    assert data["stage"] == "must_prep"
    assert data["status"] == "active"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_batch_invalid_wine_type(client):
    bad = {**VALID_BATCH, "wine_type": "beer"}
    response = await client.post("/api/v1/batches", json=bad, headers=HEADERS)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_get_batch(client):
    create = await client.post("/api/v1/batches", json=VALID_BATCH, headers=HEADERS)
    batch_id = create.json()["id"]
    response = await client.get(f"/api/v1/batches/{batch_id}", headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["id"] == batch_id


@pytest.mark.asyncio
async def test_get_batch_not_found(client):
    response = await client.get("/api/v1/batches/nonexistent", headers=HEADERS)
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_batches_empty(client):
    response = await client.get("/api/v1/batches", headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["items"] == []


@pytest.mark.asyncio
async def test_list_batches_with_filter(client):
    await client.post("/api/v1/batches", json=VALID_BATCH, headers=HEADERS)
    white_batch = {**VALID_BATCH, "name": "Chardonnay", "wine_type": "white"}
    await client.post("/api/v1/batches", json=white_batch, headers=HEADERS)

    response = await client.get("/api/v1/batches?wine_type=red", headers=HEADERS)
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["wine_type"] == "red"


@pytest.mark.asyncio
async def test_patch_batch_metadata(client):
    create = await client.post("/api/v1/batches", json=VALID_BATCH, headers=HEADERS)
    batch_id = create.json()["id"]
    response = await client.patch(
        f"/api/v1/batches/{batch_id}",
        json={"name": "Updated Name", "notes": "New notes"},
        headers=HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Name"


@pytest.mark.asyncio
async def test_delete_batch_no_data(client):
    create = await client.post("/api/v1/batches", json=VALID_BATCH, headers=HEADERS)
    batch_id = create.json()["id"]
    # Must abandon first (or have zero activities/readings)
    response = await client.delete(f"/api/v1/batches/{batch_id}", headers=HEADERS)
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_delete_batch_not_found(client):
    response = await client.delete("/api/v1/batches/nonexistent", headers=HEADERS)
    assert response.status_code == 404
