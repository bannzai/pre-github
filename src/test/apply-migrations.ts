import { applyD1Migrations, env } from "cloudflare:test";

// vitest.config.ts reads migrations/ and passes them in as TEST_MIGRATIONS.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
