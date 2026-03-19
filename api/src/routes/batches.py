from __future__ import annotations

import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.db import get_db, now_utc
from src.models import BatchCreate, BatchResponse, BatchUpdate

router = APIRouter(prefix="/api/v1/batches", tags=["batches"])


@router.post("", status_code=201, response_model=BatchResponse)
async def create_batch(body: BatchCreate, request: Request):
    db = get_db(request)
    batch_id = str(uuid.uuid4())
    now = now_utc()
    await db.execute(
        """INSERT INTO batches
           (id, name, wine_type, source_material, stage, status,
            volume_liters, target_volume_liters, started_at, notes,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, 'must_prep', 'active', ?, ?, ?, ?, ?, ?)""",
        (
            batch_id, body.name, body.wine_type, body.source_material,
            body.volume_liters, body.target_volume_liters,
            body.started_at, body.notes, now, now,
        ),
    )
    row = await db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
    return row


@router.get("", response_model=dict)
async def list_batches(
    request: Request,
    status: str | None = None,
    stage: str | None = None,
    wine_type: str | None = None,
    source_material: str | None = None,
):
    db = get_db(request)
    sql = "SELECT * FROM batches WHERE 1=1"
    params: list = []
    if status:
        sql += " AND status = ?"
        params.append(status)
    else:
        # Hide archived batches from default listing
        sql += " AND status != 'archived'"
    if stage:
        sql += " AND stage = ?"
        params.append(stage)
    if wine_type:
        sql += " AND wine_type = ?"
        params.append(wine_type)
    if source_material:
        sql += " AND source_material = ?"
        params.append(source_material)
    sql += " ORDER BY created_at DESC"
    rows = await db.query(sql, tuple(params))
    return {"items": rows}


@router.get("/{batch_id}", response_model=BatchResponse)
async def get_batch(batch_id: str, request: Request):
    db = get_db(request)
    row = await db.query_one(
        "SELECT * FROM batches WHERE id = ?", (batch_id,)
    )
    if not row:
        return JSONResponse(
            status_code=404,
            content={"error": "not_found", "message": "Batch not found"},
        )
    return row


@router.patch("/{batch_id}", response_model=BatchResponse)
async def update_batch(batch_id: str, body: BatchUpdate, request: Request):
    db = get_db(request)
    row = await db.query_one(
        "SELECT * FROM batches WHERE id = ?", (batch_id,)
    )
    if not row:
        return JSONResponse(
            status_code=404,
            content={"error": "not_found", "message": "Batch not found"},
        )
    allowed_cols = {"name", "notes", "volume_liters", "target_volume_liters"}
    updates = {
        k: v
        for k, v in body.model_dump(exclude_unset=True).items()
        if k in allowed_cols
    }
    if not updates:
        return row
    updates["updated_at"] = now_utc()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = [*updates.values(), batch_id]
    await db.execute(
        f"UPDATE batches SET {set_clause} WHERE id = ?",
        tuple(values),
    )
    return await db.query_one(
        "SELECT * FROM batches WHERE id = ?", (batch_id,)
    )


@router.delete("/{batch_id}", status_code=204)
async def delete_batch(batch_id: str, request: Request):
    db = get_db(request)
    row = await db.query_one(
        "SELECT * FROM batches WHERE id = ?", (batch_id,)
    )
    if not row:
        return JSONResponse(
            status_code=404,
            content={"error": "not_found", "message": "Batch not found"},
        )
    # Guard: must be abandoned OR have zero activities and readings
    if row["status"] != "abandoned":
        activity_row = await db.query_one(
            "SELECT COUNT(*) as cnt FROM activities WHERE batch_id = ?",
            (batch_id,),
        )
        reading_row = await db.query_one(
            "SELECT COUNT(*) as cnt FROM readings WHERE batch_id = ?",
            (batch_id,),
        )
        activity_count = activity_row["cnt"]
        reading_count = reading_row["cnt"]
        if activity_count > 0 or reading_count > 0:
            return JSONResponse(
                status_code=409,
                content={
                    "error": "conflict",
                    "message": "Batch has activities or readings. Abandon first.",
                },
            )
    await db.execute("DELETE FROM batches WHERE id = ?", (batch_id,))
    return None
