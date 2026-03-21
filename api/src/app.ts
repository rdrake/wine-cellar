import { Hono } from "hono";
import { accessAuth } from "./middleware/access";
import batches from "./routes/batches";
import activities from "./routes/activities";
import devices from "./routes/devices";
import webhook from "./routes/webhook";
import dashboard from "./routes/dashboard";
import { batchReadings, deviceReadings } from "./routes/readings";

export type Bindings = {
  DB: D1Database;
  CF_ACCESS_AUD: string;
  CF_ACCESS_TEAM: string;
  WEBHOOK_TOKEN: string;
  API_KEY?: string; // Legacy — kept during rollout, removed after
};

export type User = { id: string; email: string; name: string | null };

export type AppEnv = { Bindings: Bindings; Variables: { user: User } };

const app = new Hono<AppEnv>();

// No CORS needed — same origin
app.use("*", accessAuth);

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/api/v1/me", (c) => {
  const user = c.get("user");
  return c.json({ id: user.id, email: user.email, name: user.name });
});

app.route("/api/v1/batches", batches);
app.route("/api/v1/batches/:batchId/activities", activities);
app.route("/api/v1/devices", devices);
app.route("/api/v1/batches/:batchId/readings", batchReadings);
app.route("/api/v1/devices/:deviceId/readings", deviceReadings);
app.route("/api/v1/dashboard", dashboard);
app.route("/webhook", webhook);

export default app;
