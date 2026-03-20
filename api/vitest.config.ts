import { readFileSync, readdirSync } from "node:fs";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

const migrationSql = readdirSync("./migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(`./migrations/${f}`, "utf-8"))
  .join("\n");

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: { DB: "wine-cellar-test" },
          bindings: {
            API_KEY: "test-api-key",
            WEBHOOK_TOKEN: "test-webhook-token",
            MIGRATION_SQL: migrationSql,
          },
        },
      },
    },
  },
});
