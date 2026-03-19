from __future__ import annotations

import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from src.config import check_api_key
from src.db import get_db, now_utc
from src.models import RaptWebhookPayload

router = APIRouter(prefix="/webhook", tags=["webhook"])


@router.post("/rapt")
async def rapt_webhook(request: Request):
    # Auth BEFORE body parsing to avoid leaking schema to unauthenticated callers
    token = request.headers.get("X-Webhook-Token")
    expected = getattr(request.app.state, "webhook_token", "")
    if not check_api_key(token, expected):
        return JSONResponse(
            status_code=401,
            content={"error": "unauthorized", "message": "Invalid webhook token"},
        )

    # Parse body after auth
    body_json = await request.json()
    try:
        body = RaptWebhookPayload(**body_json)
    except ValidationError as exc:
        return JSONResponse(
            status_code=422,
            content={"error": "validation_error", "detail": exc.errors()},
        )

    db = get_db(request)
    now = now_utc()

    # Auto-register unknown device
    device = await db.query_one("SELECT * FROM devices WHERE id = ?", (body.device_id,))
    if not device:
        await db.execute(
            "INSERT INTO devices (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (body.device_id, body.device_name, now, now),
        )
        device = await db.query_one("SELECT * FROM devices WHERE id = ?", (body.device_id,))

    # Resolve batch_id from device assignment
    batch_id = device["batch_id"]  # May be None

    # Insert reading, deduplicate via Database.execute_or_ignore
    reading_id = str(uuid.uuid4())
    inserted = await db.execute_or_ignore(
        """INSERT INTO readings
           (id, batch_id, device_id, gravity, temperature,
            battery, rssi, source_timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            reading_id,
            batch_id,
            body.device_id,
            body.gravity,
            body.temperature,
            body.battery,
            body.rssi,
            body.created_date,
            now,
        ),
    )

    if not inserted:
        return {"status": "duplicate", "message": "Reading already exists"}
    return {"status": "ok", "reading_id": reading_id}
