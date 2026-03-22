import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

const migrationSql = readdirSync("./migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(`./migrations/${f}`, "utf-8"))
  .join("\n");

export default defineWorkersConfig({
  resolve: {
    alias: {
      // tslib's ESM wrapper does `import tslib from '../tslib.js'` which fails in workerd.
      // Resolve directly to the pure ESM build instead.
      tslib: resolve(__dirname, "node_modules/tslib/tslib.es6.mjs"),
    },
  },
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: { DB: "wine-cellar-test" },
          bindings: {
            GITHUB_CLIENT_ID: "test-github-client-id",
            GITHUB_CLIENT_SECRET: "test-github-client-secret",
            WEBHOOK_TOKEN: "test-webhook-token",
            VAPID_PUBLIC_KEY: "test-vapid-public-key",
            VAPID_PRIVATE_KEY: "test-vapid-private-key",

            RP_ID: "localhost",
            RP_ORIGIN: "http://localhost",
            MIGRATION_SQL: migrationSql,
          },
        },
      },
    },
  },
});
