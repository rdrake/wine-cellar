from __future__ import annotations

import base64
import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.db import get_db
from src.models import PaginatedReadings

batch_router = APIRouter(
    prefix="/api/v1/batches/{batch_id}/readings",
    tags=["readings"],
)
device_router = APIRouter(
    prefix="/api/v1/devices/{device_id}/readings",
    tags=["readings"],
)

DEFAULT_LIMIT = 100
MAX_LIMIT = 500


def _encode_cursor(source_timestamp: str, row_id: str) -> str:
    payload = json.dumps([source_timestamp, row_id]).encode()
    return base64.urlsafe_b64encode(payload).decode()


def _decode_cursor(cursor: str) -> tuple[str, str] | None:
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor))
        return data[0], data[1]
    except (ValueError, IndexError, KeyError):
        return None


async def _paginated_query(
    db,
    base_sql: str,
    params: list,
    limit: int,
    cursor: str | None,
    start_time: str | None = None,
    end_time: str | None = None,
):
    sql = base_sql
    if start_time:
        sql += " AND source_timestamp >= ?"
        params.append(start_time)
    if end_time:
        sql += " AND source_timestamp <= ?"
        params.append(end_time)
    if cursor:
        decoded = _decode_cursor(cursor)
        if decoded:
            ts, rid = decoded
            sql += (
                " AND (source_timestamp < ?"
                " OR (source_timestamp = ? AND id < ?))"
            )
            params.extend([ts, ts, rid])
    sql += " ORDER BY source_timestamp DESC, id DESC LIMIT ?"
    params.append(limit + 1)  # fetch one extra to detect next page
    rows = await db.query(sql, tuple(params))
    has_next = len(rows) > limit
    items = rows[:limit]
    next_cursor = None
    if has_next and items:
        last = items[-1]
        next_cursor = _encode_cursor(
            last["source_timestamp"], last["id"]
        )
    return {"items": items, "next_cursor": next_cursor}


@batch_router.get("", response_model=PaginatedReadings)
async def list_readings_by_batch(
    batch_id: str,
    request: Request,
    limit: int = DEFAULT_LIMIT,
    cursor: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
):
    db = get_db(request)
    batch = await db.query_one(
        "SELECT id FROM batches WHERE id = ?", (batch_id,)
    )
    if not batch:
        return JSONResponse(
            status_code=404,
            content={
                "error": "not_found",
                "message": "Batch not found",
            },
        )
    limit = max(1, min(limit, MAX_LIMIT))
    return await _paginated_query(
        db,
        "SELECT * FROM readings WHERE batch_id = ?",
        [batch_id],
        limit,
        cursor,
        start_time,
        end_time,
    )


@device_router.get("", response_model=PaginatedReadings)
async def list_readings_by_device(
    device_id: str,
    request: Request,
    limit: int = DEFAULT_LIMIT,
    cursor: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
):
    db = get_db(request)
    device = await db.query_one(
        "SELECT id FROM devices WHERE id = ?", (device_id,)
    )
    if not device:
        return JSONResponse(
            status_code=404,
            content={
                "error": "not_found",
                "message": "Device not found",
            },
        )
    limit = max(1, min(limit, MAX_LIMIT))
    return await _paginated_query(
        db,
        "SELECT * FROM readings WHERE device_id = ?",
        [device_id],
        limit,
        cursor,
        start_time,
        end_time,
    )
