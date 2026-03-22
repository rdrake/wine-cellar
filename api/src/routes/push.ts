import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { validationError } from "../lib/errors";
import { nowUtc } from "../lib/time";
import { sendPushToUser } from "../lib/web-push";

const SubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

const UnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
});

const push = new Hono<AppEnv>();

push.get("/vapid-key", (c) => {
  return c.json({ key: c.env.VAPID_PUBLIC_KEY });
});

push.post("/subscribe", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SubscribeSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const db = c.env.DB;
  const user = c.get("user");
  const now = nowUtc();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, keys_p256dh, keys_auth, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET keys_p256dh = ?, keys_auth = ?, user_id = ?`
    )
    .bind(
      id,
      user.id,
      parsed.data.endpoint,
      parsed.data.keys.p256dh,
      parsed.data.keys.auth,
      now,
      parsed.data.keys.p256dh,
      parsed.data.keys.auth,
      user.id,
    )
    .run();

  return c.json({ endpoint: parsed.data.endpoint }, 201);
});

push.delete("/subscribe", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = UnsubscribeSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const db = c.env.DB;
  const user = c.get("user");

  await db
    .prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
    .bind(parsed.data.endpoint, user.id)
    .run();

  return c.body(null, 204);
});

push.post("/test", async (c) => {
  const user = c.get("user");
  await sendPushToUser(c.env.DB, user.id, {
    title: "Test Notification",
    body: "Push notifications are working!",
    url: "/settings",
    type: "test",
    alertId: "test",
  }, c.env.VAPID_PUBLIC_KEY, c.env.VAPID_PRIVATE_KEY);
  return c.json({ status: "sent" });
});

export default push;
