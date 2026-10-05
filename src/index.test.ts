import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /healthz", () => {
  it("answers 200 with ok", async () => {
    const response = await SELF.fetch("https://example.com/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("unknown paths", () => {
  it.each([
    ["GET", "/nope"],
    ["GET", "/repos/alice/demo/commits"],
    ["GET", "/api/v3/repos/alice/demo/releases"],
    ["PUT", "/repos/alice/demo/issues"],
    ["GET", "/repos/alice/demo/issues/not-a-number"],
  ])("%s %s answers 404 in GitHub's shape", async (method, path) => {
    const response = await SELF.fetch(`https://example.com${path}`, {
      method,
      headers: { Authorization: `token ${env.PRE_GITHUB_TOKEN}` },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      message: "Not Found",
      documentation_url: "https://docs.github.com/rest",
    });
  });
});
