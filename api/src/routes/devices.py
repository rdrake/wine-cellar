from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.db import get_db, now_utc
from src.models import DeviceAssign, DeviceCreate, DeviceResponse

router = APIRouter(prefix="/api/v1/devices", tags=["devices"])


@router.post("", status_code=201, response_model=DeviceResponse)
async def register_device(body: DeviceCreate, request: Request):
    db = get_db(request)
    existing = await db.query_one("SELECT id FROM devices WHERE id = ?", (body.id,))
    if existing:
        return JSONResponse(
            status_code=409,
            content={
                "error": "conflict",
                "message": "Device already registered",
            },
        )
    now = now_utc()
    await db.execute(
        "INSERT INTO devices (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (body.id, body.name, now, now),
    )
    return await db.query_one("SELECT * FROM devices WHERE id = ?", (body.id,))


@router.get("", response_model=dict)
async def list_devices(request: Request):
    db = get_db(request)
    rows = await db.query("SELECT * FROM devices ORDER BY created_at DESC")
    return {"items": rows}


@router.post("/{device_id}/assign", response_model=DeviceResponse)
async def assign_device(device_id: str, body: DeviceAssign, request: Request):
    db = get_db(request)
    device = await db.query_one("SELECT * FROM devices WHERE id = ?", (device_id,))
    if not device:
        return JSONResponse(
            status_code=404,
            content={
                "error": "not_found",
                "message": "Device not found",
            },
        )
    batch = await db.query_one("SELECT * FROM batches WHERE id = ?", (body.batch_id,))
    if not batch:
        return JSONResponse(
            status_code=404,
            content={
                "error": "not_found",
                "message": "Batch not found",
            },
        )
    if batch["status"] != "active":
        return JSONResponse(
            status_code=409,
            content={
                "error": "conflict",
                "message": "Can only assign to active batches",
            },
        )
    now = now_utc()
    await db.execute(
        "UPDATE devices SET batch_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?",
        (body.batch_id, now, now, device_id),
    )
    # Backfill unassigned readings from this device after batch start
    await db.execute(
        "UPDATE readings SET batch_id = ? "
        "WHERE device_id = ? AND batch_id IS NULL "
        "AND source_timestamp >= ?",
        (body.batch_id, device_id, batch["started_at"]),
    )
    return await db.query_one("SELECT * FROM devices WHERE id = ?", (device_id,))


@router.post("/{device_id}/unassign", response_model=DeviceResponse)
async def unassign_device(device_id: str, request: Request):
    db = get_db(request)
    device = await db.query_one("SELECT * FROM devices WHERE id = ?", (device_id,))
    if not device:
        return JSONResponse(
            status_code=404,
            content={
                "error": "not_found",
                "message": "Device not found",
            },
        )
    now = now_utc()
    await db.execute(
        "UPDATE devices SET batch_id = NULL, assigned_at = NULL, updated_at = ? WHERE id = ?",
        (now, device_id),
    )
    return await db.query_one("SELECT * FROM devices WHERE id = ?", (device_id,))
