import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { requireToken } from "./auth";
import { repos } from "./repos";

describe("token authentication", () => {
  it.each([
    ["no Authorization header", undefined],
    ["a wrong token", `token not-${env.PRE_GITHUB_TOKEN}`],
    ["a wrong bearer token", `Bearer ${env.PRE_GITHUB_TOKEN}-suffix`],
    ["an unknown scheme", `Basic ${env.PRE_GITHUB_TOKEN}`],
  ])("answers 401 in GitHub's shape for %s", async (_, authorization) => {
    for (const path of ["/repos/alice/demo/issues", "/api/v3/repos/alice/demo/pulls"]) {
      const response = await SELF.fetch(`https://example.com${path}`, {
        headers: authorization ? { Authorization: authorization } : {},
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        message: "Bad credentials",
        documentation_url: "https://docs.github.com/rest",
      });
    }
  });

  it.each(["Bearer", "token", "bearer"])("accepts the %s scheme", async (scheme) => {
    const response = await SELF.fetch("https://example.com/repos/alice/demo/issues", {
      headers: { Authorization: `${scheme} ${env.PRE_GITHUB_TOKEN}` },
    });
    expect(response.status).toBe(200);
  });

  it("guards every API route, since the check sits on each route rather than on /repos/*", () => {
    for (const route of repos.routes) {
      expect(
        repos.routes.some(
          (guard) =>
            guard.method === route.method &&
            guard.path === route.path &&
            guard.handler === requireToken,
        ),
        `${route.method} ${route.path}`,
      ).toBe(true);
    }
  });

  it("does not require the token for the health check", async () => {
    const response = await SELF.fetch("https://example.com/healthz");
    expect(response.status).toBe(200);
  });
});
