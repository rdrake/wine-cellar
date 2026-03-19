import type { Bindings } from "../src/app";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Bindings {}
}
