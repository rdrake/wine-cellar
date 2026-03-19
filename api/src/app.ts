import { Hono } from "hono";
import { apiKeyAuth } from "./middleware/auth";
import batches from "./routes/batches";
import activities from "./routes/activities";
import devices from "./routes/devices";
import webhook from "./routes/webhook";
import { batchReadings, deviceReadings } from "./routes/readings";

export type Bindings = {
  DB: D1Database;
  API_KEY: string;
  WEBHOOK_TOKEN: string;
};

export type App = Hono<{ Bindings: Bindings }>;

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", apiKeyAuth);

app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/api/v1/batches", batches);
app.route("/api/v1/batches/:batchId/activities", activities);
app.route("/api/v1/devices", devices);
app.route("/api/v1/batches/:batchId/readings", batchReadings);
app.route("/api/v1/devices/:deviceId/readings", deviceReadings);
app.route("/webhook", webhook);

export default app;
