import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  // The schema under test is the one that ships: every migration in migrations/ is applied
  // to a fresh local D1 by src/test/apply-migrations.ts before the tests run.
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // PRE_GITHUB_TOKEN is the only credential of the Worker under test. Not a real token.
          bindings: { TEST_MIGRATIONS: migrations, PRE_GITHUB_TOKEN: "test-token" },
        },
      }),
    ],
    test: {
      include: ["src/**/*.test.ts"],
      setupFiles: ["./src/test/apply-migrations.ts"],
    },
  };
});
