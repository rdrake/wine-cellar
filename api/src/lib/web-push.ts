export interface PushSubscription {
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  type: string;
  alertId: string;
  [key: string]: unknown;
}

/**
 * Send push notification to all subscriptions for a user.
 * Cleans up expired (410/404) subscriptions.
 *
 * Note: Current implementation sends unencrypted payload.
 * Full RFC 8291 (aes128gcm) encryption is a future enhancement.
 */
export async function sendPushToUser(
  db: D1Database,
  userId: string,
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<void> {
  const subs = await db
    .prepare(
      "SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?",
    )
    .bind(userId)
    .all<PushSubscription>();

  for (const sub of subs.results) {
    try {
      const resp = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          TTL: "86400",
        },
        body: JSON.stringify(payload),
      });

      // 404 or 410 means subscription expired — clean up
      if (resp.status === 404 || resp.status === 410) {
        await db
          .prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
          .bind(sub.endpoint)
          .run();
      }
    } catch {
      // Network error — skip, will retry on next cron cycle
    }
  }
}
