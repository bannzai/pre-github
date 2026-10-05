import { defineConfig, devices } from "@playwright/test";
import { port, token } from "./instance.js";

export default defineConfig({
  testDir: "./tests",
  outputDir: "../test-results",
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${port}`,
        extraHTTPHeaders: { Authorization: `token ${token}` },
      },
    },
  ],
  webServer: {
    // The same local D1 as the unit tests: apply the migrations, then serve the Worker.
    // wrangler dev does not pass the process environment to the Worker; --var does.
    command: `npm run migrate:local && npx wrangler dev --port ${port} --var PRE_GITHUB_TOKEN:${token}`,
    cwd: "..",
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      WRANGLER_SEND_METRICS: "false",
    },
  },
});
