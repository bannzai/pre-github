declare namespace Cloudflare {
  /** Test-only bindings vitest.config.ts adds on top of the ones in wrangler.jsonc. */
  interface Env {
    /** Every migration in migrations/, applied to the local D1 by src/test/apply-migrations.ts. */
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
