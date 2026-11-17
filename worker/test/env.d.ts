import type { D1Migration } from "cloudflare:test";
import type { Env as PileEnv } from "../src/env";

declare global {
  namespace Cloudflare {
    interface Env extends PileEnv {
      readonly TEST_MIGRATIONS: D1Migration[];
    }
  }
}
