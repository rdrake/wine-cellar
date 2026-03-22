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
            CF_ACCESS_AUD: "test-aud",
            CF_ACCESS_TEAM: "test",
            WEBHOOK_TOKEN: "test-webhook-token",
            VAPID_PUBLIC_KEY: "test-vapid-public-key",
            VAPID_PRIVATE_KEY: "test-vapid-private-key",
            SETUP_TOKEN: "test-setup-token",
            RP_ID: "localhost",
            RP_ORIGIN: "http://localhost",
            MIGRATION_SQL: migrationSql,
          },
        },
      },
    },
  },
});
