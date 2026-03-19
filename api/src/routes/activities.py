from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.db import get_db, now_utc
from src.models import ActivityCreate, ActivityResponse, ActivityUpdate
from src.schema import WAYPOINT_ALLOWED_STAGES

router = APIRouter(
    prefix="/api/v1/batches/{batch_id}/activities",
    tags=["activities"],
)


def _serialize_details(details) -> str | None:
    """Serialize a Pydantic details model (or dict) to JSON string."""
    if details is None:
        return None
    if hasattr(details, "model_dump"):
        return json.dumps(details.model_dump())
    return json.dumps(details)


def _deserialize_details(raw: str | None) -> dict | None:
    """Deserialize a JSON string from the DB to a dict."""
    if raw is None:
        return None
    return json.loads(raw)


@router.post("", status_code=201, response_model=ActivityResponse)
async def create_activity(
    batch_id: str,
    body: ActivityCreate,
    request: Request,
):
    db = get_db(request)
    batch = await db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
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
                "message": "Only active batches can log activities",
            },
        )
    # Validate stage is allowed for current waypoint
    allowed = WAYPOINT_ALLOWED_STAGES.get(batch["stage"], ())
    if body.stage not in allowed:
        return JSONResponse(
            status_code=409,
            content={
                "error": "conflict",
                "message": (
                    f"Stage '{body.stage}' not allowed when batch is at '{batch['stage']}'"
                ),
            },
        )
    activity_id = str(uuid.uuid4())
    now = now_utc()
    details_json = _serialize_details(body.details)
    await db.execute(
        """INSERT INTO activities
           (id, batch_id, stage, type, title,
            details, recorded_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            activity_id,
            batch_id,
            body.stage,
            body.type,
            body.title,
            details_json,
            body.recorded_at,
            now,
            now,
        ),
    )
    row = await db.query_one("SELECT * FROM activities WHERE id = ?", (activity_id,))
    row["details"] = _deserialize_details(row["details"])
    return row


@router.get("", response_model=dict)
async def list_activities(
    batch_id: str,
    request: Request,
    type: str | None = None,
    stage: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
):
    db = get_db(request)
    batch = await db.query_one("SELECT id FROM batches WHERE id = ?", (batch_id,))
    if not batch:
        return JSONResponse(
            status_code=404,
            content={
                "error": "not_found",
                "message": "Batch not found",
            },
        )
    sql = "SELECT * FROM activities WHERE batch_id = ?"
    params: list = [batch_id]
    if type:
        sql += " AND type = ?"
        params.append(type)
    if stage:
        sql += " AND stage = ?"
        params.append(stage)
    if start_time:
        sql += " AND recorded_at >= ?"
        params.append(start_time)
    if end_time:
        sql += " AND recorded_at <= ?"
        params.append(end_time)
    sql += " ORDER BY recorded_at DESC"
    rows = await db.query(sql, tuple(params))
    for row in rows:
        row["details"] = _deserialize_details(row["details"])
    return {"items": rows}


@router.patch(
    "/{activity_id}",
    response_model=ActivityResponse,
)
async def update_activity(
    batch_id: str,
    activity_id: str,
    body: ActivityUpdate,
    request: Request,
):
    db = get_db(request)
    row = await db.query_one(
        "SELECT * FROM activities WHERE id = ? AND batch_id = ?",
        (activity_id, batch_id),
    )
    if not row:
        return JSONResponse(
            status_code=404,
            content={
                "error": "not_found",
                "message": "Activity not found",
            },
        )
    updates = body.model_dump(exclude_unset=True)
    if "details" in updates and updates["details"] is not None:
        updates["details"] = _serialize_details(updates["details"])
    if not updates:
        row["details"] = _deserialize_details(row["details"])
        return row
    updates["updated_at"] = now_utc()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = [*updates.values(), activity_id]
    await db.execute(
        f"UPDATE activities SET {set_clause} WHERE id = ?",
        tuple(values),
    )
    row = await db.query_one("SELECT * FROM activities WHERE id = ?", (activity_id,))
    row["details"] = _deserialize_details(row["details"])
    return row


@router.delete("/{activity_id}", status_code=204)
async def delete_activity(
    batch_id: str,
    activity_id: str,
    request: Request,
):
    db = get_db(request)
    row = await db.query_one(
        "SELECT * FROM activities WHERE id = ? AND batch_id = ?",
        (activity_id, batch_id),
    )
    if not row:
        return JSONResponse(
            status_code=404,
            content={
                "error": "not_found",
                "message": "Activity not found",
            },
        )
    await db.execute("DELETE FROM activities WHERE id = ?", (activity_id,))
    return None
