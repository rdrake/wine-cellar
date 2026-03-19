import { readFileSync } from "node:fs";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

const migrationSql = readFileSync("./migrations/0001_initial.sql", "utf-8");

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
