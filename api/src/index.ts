import app from "./app";
import { evaluateAllBatches, cleanupAuthTables } from "./cron";
import type { Bindings } from "./app";

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      Promise.all([
        cleanupAuthTables(env.DB),
        evaluateAllBatches(env.DB, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY),
      ]),
    );
  },
};
