import { expect, test } from "@playwright/test";

test("the Worker started by wrangler dev answers the health check", async ({ request }) => {
  const response = await request.get("/healthz");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
