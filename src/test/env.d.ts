import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";
import type { Env } from "../index";

declare module "cloudflare:test" {
  /** The Worker's bindings plus the migrations vitest.config.ts injects for the tests. */
  interface ProvidedEnv extends Env {
    /** Every migration in migrations/, applied to the local D1 by src/test/apply-migrations.ts. */
    TEST_MIGRATIONS: D1Migration[];
  }
}
