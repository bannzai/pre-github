import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import path from "node:path";

export default defineWorkersConfig(async () => {
  // The schema under test is the one that ships: every migration in migrations/ is applied
  // to a fresh local D1 by src/test/apply-migrations.ts before the tests run.
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    test: {
      include: ["src/**/*.test.ts"],
      setupFiles: ["./src/test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
