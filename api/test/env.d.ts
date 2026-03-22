/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { Bindings } from "../src/app";

// vitest-pool-workers 0.13+ uses Cloudflare.Env instead of ProvidedEnv
declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}
