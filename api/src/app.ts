import { Hono } from "hono";
import { apiKeyAuth } from "./middleware/auth";

export type Bindings = {
  DB: D1Database;
  API_KEY: string;
  WEBHOOK_TOKEN: string;
};

export type App = Hono<{ Bindings: Bindings }>;

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", apiKeyAuth);

app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
