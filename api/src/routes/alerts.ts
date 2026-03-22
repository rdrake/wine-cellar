import { Hono } from "hono";
import type { AppEnv } from "../app";
import { notFound } from "../lib/errors";
import { nowUtc } from "../lib/time";
import type { AlertIdRow } from "../db-types";

const alerts = new Hono<AppEnv>();

alerts.post("/:alertId/dismiss", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const alertId = c.req.param("alertId");

  const row = await db.prepare(
    "SELECT id FROM alert_state WHERE id = ? AND user_id = ? AND resolved_at IS NULL AND dismissed_at IS NULL"
  ).bind(alertId, user.id).first<AlertIdRow>();

  if (!row) return notFound("Alert");

  await db.prepare("UPDATE alert_state SET dismissed_at = ? WHERE id = ?")
    .bind(nowUtc(), alertId).run();

  return c.json({ status: "dismissed" });
});

export default alerts;
