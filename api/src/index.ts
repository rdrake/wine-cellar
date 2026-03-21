import app from "./app";
import { evaluateAllBatches } from "./cron";
import type { Bindings } from "./app";

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(evaluateAllBatches(env.DB));
  },
};
