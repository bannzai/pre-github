import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// vitest.config.ts reads migrations/ and passes them in as TEST_MIGRATIONS. Setup files may run
// more than once; applyD1Migrations only applies migrations that are not applied yet.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
