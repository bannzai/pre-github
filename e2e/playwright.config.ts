import { defineConfig, devices } from "@playwright/test";

// wrangler dev's default port. Nothing else listens on the CI runner.
const port = 8787;

export default defineConfig({
  testDir: "./tests",
  outputDir: "../test-results",
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${port}` },
    },
  ],
  webServer: {
    // The same local D1 as the unit tests: apply the migrations, then serve the Worker.
    command: `npm run migrate:local && npx wrangler dev --port ${port}`,
    cwd: "..",
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // The only credential of the instance under test. Not a real token.
      PRE_GITHUB_TOKEN: "e2e-token",
      WRANGLER_SEND_METRICS: "false",
    },
  },
});
