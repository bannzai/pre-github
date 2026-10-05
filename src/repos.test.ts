import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

/** The origin every test request is sent to, and so the origin of every `html_url`. */
const origin = "https://pre-github.test";

/** An ISO 8601 UTC timestamp as the migrations write it. */
const isoTimestamp = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

/** GitHub's 404 body. */
const notFound = { message: "Not Found", documentation_url: "https://docs.github.com/rest" };

/**
 * Sends an authenticated request to the Worker under test. `json` becomes the request body;
 * `accept` sets the Accept header.
 */
function api(path: string, init: { method?: string; json?: unknown; accept?: string } = {}) {
  return SELF.fetch(`${origin}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${env.PRE_GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.accept ? { Accept: init.accept } : {}),
    },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
}

/** The JSON body of an authenticated GET of `path`. */
async function getJson<T = Record<string, unknown>>(path: string): Promise<T> {
  return (await api(path)).json<T>();
}

/** The number of `events` rows of `kind`. */
async function eventCount(kind: string): Promise<number> {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM events WHERE kind = ?1")
    .bind(kind)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("issues", () => {
  const path = "/repos/alice/issue-lifecycle/issues";

  it("go through POST, GET, PATCH, and DELETE with the fields in PROJECT.md", async () => {
    const created = await api(path, {
      method: "POST",
      json: { title: "First", body: "Hello", labels: ["bug"] },
    });
    expect(created.status).toBe(201);
    const issue = await created.json<Record<string, unknown>>();
    expect(issue).toEqual({
      id: expect.any(Number),
      number: 1,
      title: "First",
      body: "Hello",
      state: "open",
      html_url: `${origin}/alice/issue-lifecycle/issues/1`,
      created_at: isoTimestamp,
      updated_at: isoTimestamp,
    });
    expect(await getJson(`${path}/1`)).toEqual(issue);
    expect(await getJson(path)).toEqual([issue]);

    const patched = await api(`${path}/1`, {
      method: "PATCH",
      json: { title: "Renamed", state: "closed" },
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({
      ...issue,
      title: "Renamed",
      state: "closed",
      updated_at: isoTimestamp,
    });
    expect(await getJson(path)).toEqual([]);
    expect(await getJson(`${path}?state=all`)).toHaveLength(1);

    const unchanged = await api(`${path}/1`, { method: "PATCH", json: { state: null } });
    expect(await unchanged.json()).toMatchObject({ title: "Renamed", state: "closed" });

    expect((await api(`${path}/1`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`${path}/1`)).status).toBe(404);
    expect(await getJson(`${path}/1`)).toEqual(notFound);
    expect((await api(`${path}/1`, { method: "DELETE" })).status).toBe(404);
  });

  it("answer 404 for PATCH and DELETE of a missing number", async () => {
    const patched = await api("/repos/alice/missing/issues/7", { method: "PATCH", json: {} });
    expect(patched.status).toBe(404);
    expect(await patched.json()).toEqual(notFound);
    expect((await api("/repos/alice/missing/issues/7", { method: "DELETE" })).status).toBe(404);
  });
});

describe("pull requests", () => {
  const path = "/repos/alice/pull-lifecycle/pulls";

  it("go through POST, GET, PATCH, and DELETE with head.ref and base.ref", async () => {
    const created = await api(path, {
      method: "POST",
      json: { title: "Add a feature", body: "Body", head: "feature", base: "main" },
    });
    expect(created.status).toBe(201);
    const pull = await created.json<Record<string, unknown>>();
    expect(pull).toEqual({
      id: expect.any(Number),
      number: 1,
      title: "Add a feature",
      body: "Body",
      state: "open",
      html_url: `${origin}/alice/pull-lifecycle/pull/1`,
      created_at: isoTimestamp,
      updated_at: isoTimestamp,
      head: { ref: "feature" },
      base: { ref: "main" },
    });
    expect(await getJson(`${path}/1`)).toEqual(pull);
    expect(await getJson(path)).toEqual([pull]);

    const patched = await api(`${path}/1`, { method: "PATCH", json: { body: "Edited" } });
    expect(await patched.json()).toEqual({
      ...pull,
      body: "Edited",
      updated_at: isoTimestamp,
    });

    expect((await api(`${path}/1`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`${path}/1`)).status).toBe(404);
  });

  it("store the diff and return it for Accept: application/vnd.github.diff", async () => {
    const diffPath = "/repos/alice/pull-diff/pulls";
    const diff = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n";
    await api(diffPath, {
      method: "POST",
      json: { title: "Diff", head: "feature", base: "main", diff },
    });

    const asDiff = await api(`${diffPath}/1`, { accept: "application/vnd.github.diff" });
    expect(asDiff.status).toBe(200);
    expect(asDiff.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(await asDiff.text()).toBe(diff);
    expect(await getJson(`${diffPath}/1`)).not.toHaveProperty("diff");

    await api(`${diffPath}/1`, { method: "PATCH", json: { diff: "+changed\n" } });
    // `gh pr diff` asks with the v3 form of the media type.
    const patchedDiff = await api(`${diffPath}/1`, { accept: "application/vnd.github.v3.diff" });
    expect(await patchedDiff.text()).toBe("+changed\n");
  });
});

describe("numbering", () => {
  it("is one sequence per repo shared by issues and pull requests", async () => {
    const repoPath = "/repos/alice/shared-numbers";
    const created = [
      await api(`${repoPath}/issues`, { method: "POST", json: { title: "One" } }),
      await api(`${repoPath}/pulls`, {
        method: "POST",
        json: { title: "Two", head: "feature", base: "main" },
      }),
      await api(`${repoPath}/issues`, { method: "POST", json: { title: "Three" } }),
    ];
    expect(await Promise.all(created.map((response) => response.json()))).toMatchObject([
      { number: 1 },
      { number: 2 },
      { number: 3 },
    ]);

    const issues = await getJson<{ number: number }[]>(`${repoPath}/issues`);
    expect(issues.map((issue) => issue.number)).toEqual([3, 1]);
    const pulls = await getJson<{ number: number }[]>(`${repoPath}/pulls`);
    expect(pulls.map((pull) => pull.number)).toEqual([2]);
    expect((await api(`${repoPath}/issues/2`)).status).toBe(404);
    expect((await api(`${repoPath}/pulls/1`)).status).toBe(404);

    const otherRepo = await api("/repos/alice/another-repo/issues", {
      method: "POST",
      json: { title: "Starts over" },
    });
    expect(await otherRepo.json()).toMatchObject({ number: 1 });
  });

  it("pages lists with per_page and page", async () => {
    const pagingPath = "/repos/alice/paging/issues";
    for (const title of ["a", "b", "c"]) {
      await api(pagingPath, { method: "POST", json: { title } });
    }
    const first = await api(`/api/v3${pagingPath}?state=all&per_page=2`);
    expect(await first.json()).toMatchObject([{ title: "c" }, { title: "b" }]);
    const nextUrl = /^<(.+)>; rel="next"$/.exec(first.headers.get("Link") ?? "")?.[1];
    expect(nextUrl).toBe(`${origin}/api/v3${pagingPath}?state=all&per_page=2&page=2`);

    const last = await api(`${pagingPath}?per_page=2&page=2`);
    expect(await last.json()).toMatchObject([{ title: "a" }]);
    expect(last.headers.get("Link")).toBeNull();
    expect(await getJson(`${pagingPath}?page=1e20`)).toEqual([]);
  });
});

describe("the /api/v3 prefix", () => {
  it("serves the same handlers and builds the same html_url", async () => {
    const created = await api("/api/v3/repos/alice/enterprise/issues", {
      method: "POST",
      json: { title: "Through gh api --hostname" },
    });
    expect(created.status).toBe(201);
    const issue = await created.json();
    expect(issue).toMatchObject({
      number: 1,
      html_url: `${origin}/alice/enterprise/issues/1`,
    });
    expect(await getJson("/api/v3/repos/alice/enterprise/issues/1")).toEqual(issue);
    expect(await getJson("/repos/alice/enterprise/issues/1")).toEqual(issue);
    expect(await getJson("/api/v3/repos/alice/enterprise/issues")).toEqual([issue]);
  });
});

describe("comments", () => {
  it("are added to and listed for issues and pull requests alike", async () => {
    const repoPath = "/repos/alice/comments";
    await api(`${repoPath}/issues`, { method: "POST", json: { title: "Issue" } });
    await api(`${repoPath}/pulls`, {
      method: "POST",
      json: { title: "Pull", head: "feature", base: "main" },
    });

    for (const [number, page] of [
      [1, "issues"],
      [2, "pull"],
    ] as const) {
      const commentsPath = `${repoPath}/issues/${number}/comments`;
      const created = await api(commentsPath, {
        method: "POST",
        json: { body: "First comment" },
      });
      expect(created.status).toBe(201);
      const comment = await created.json<{ id: number }>();
      expect(comment).toEqual({
        id: expect.any(Number),
        body: "First comment",
        html_url: `${origin}/alice/comments/${page}/${number}#issuecomment-${comment.id}`,
        created_at: isoTimestamp,
        updated_at: isoTimestamp,
      });
      await api(`/api/v3${commentsPath}`, { method: "POST", json: { body: "Second comment" } });

      const listed = await getJson<{ body: string }[]>(commentsPath);
      expect(listed.map((entry) => entry.body)).toEqual(["First comment", "Second comment"]);
    }
  });

  it("refuse an empty body, as GitHub does", async () => {
    const repoPath = "/repos/alice/empty-comment";
    await api(`${repoPath}/issues`, { method: "POST", json: { title: "Issue" } });
    const empty = await api(`${repoPath}/issues/1/comments`, {
      method: "POST",
      json: { body: "" },
    });
    expect(empty.status).toBe(422);
    expect(await empty.json()).toMatchObject({ message: "body must not be empty" });
  });

  it("are removed with their preview", async () => {
    const repoPath = "/repos/alice/comment-removal";
    await api(`${repoPath}/issues`, { method: "POST", json: { title: "Issue" } });
    await api(`${repoPath}/issues/1/comments`, { method: "POST", json: { body: "Bye" } });
    const issue = await getJson<{ id: number }>(`${repoPath}/issues/1`);

    expect((await api(`${repoPath}/issues/1`, { method: "DELETE" })).status).toBe(204);
    const { results } = await env.DB.prepare("SELECT id FROM comments WHERE preview_id = ?1")
      .bind(issue.id)
      .all();
    expect(results).toEqual([]);

    const late = await api(`${repoPath}/issues/1/comments`, {
      method: "POST",
      json: { body: "Too late" },
    });
    expect(late.status).toBe(404);
    expect((await api(`${repoPath}/issues/1/comments`)).status).toBe(404);
  });
});

describe("validation", () => {
  it.each([
    ["an issue without title", "issues", { body: "No title" }, "title is missing"],
    ["a pull request without head", "pulls", { title: "T", base: "main" }, "head is missing"],
    ["a non-string body", "issues", { title: "T", body: 1 }, "body must be a string"],
    ["a bad state", "issues", { title: "T", state: "merged" }, "state must be open or closed"],
    [
      "a body over 1 MB",
      "issues",
      { title: "T", body: "a".repeat(1_000_001) },
      "body is larger than 1000000 bytes",
    ],
    [
      "a diff over 1 MB",
      "pulls",
      { title: "T", head: "feature", base: "main", diff: "a".repeat(1_000_001) },
      "diff is larger than 1000000 bytes",
    ],
  ])("answers 422 for %s", async (_, path, json, message) => {
    const response = await api(`/repos/alice/validation/${path}`, { method: "POST", json });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      message,
      documentation_url: "https://docs.github.com/rest",
    });
  });

  it("answers 422 when a preview's text exceeds the row limit", async () => {
    const tooLarge = {
      message: "the preview is larger than 1990000 bytes in total",
      documentation_url: "https://docs.github.com/rest",
    };
    const pullsPath = "/repos/alice/row-limit/pulls";
    const halfOfRow = "a".repeat(1_000_000);
    const created = await api(pullsPath, {
      method: "POST",
      json: { title: "T", head: "feature", base: "main", body: halfOfRow, diff: halfOfRow },
    });
    expect(created.status).toBe(422);
    expect(await created.json()).toEqual(tooLarge);

    await api(pullsPath, {
      method: "POST",
      json: { title: "T", head: "feature", base: "main", diff: halfOfRow },
    });
    const patched = await api(`${pullsPath}/1`, { method: "PATCH", json: { body: halfOfRow } });
    expect(patched.status).toBe(422);
    expect(await patched.json()).toEqual(tooLarge);
    const smaller = await api(`${pullsPath}/1`, { method: "PATCH", json: { body: "fits" } });
    expect(smaller.status).toBe(200);
  });

  it("answers 422 before parsing a request body over 16,000,000 bytes", async () => {
    const response = await SELF.fetch(`${origin}/repos/alice/validation/issues`, {
      method: "POST",
      headers: { Authorization: `token ${env.PRE_GITHUB_TOKEN}` },
      body: "not json ".repeat(1_800_000),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      message: "the request body is larger than 16000000 bytes",
      documentation_url: "https://docs.github.com/rest",
    });
  });

  it("ignores fields the endpoint does not take, as GitHub does", async () => {
    const repoPath = "/repos/alice/ignored-fields";
    const issue = await api(`${repoPath}/issues`, {
      method: "POST",
      json: { title: "T", state: "merged", head: "", diff: "a".repeat(1_000_001) },
    });
    expect(issue.status).toBe(201);
    const comment = await api(`${repoPath}/issues/1/comments`, {
      method: "POST",
      json: { body: "x", title: "", state: "merged" },
    });
    expect(comment.status).toBe(201);
  });

  it("answers 400 for a body that is not JSON", async () => {
    const response = await SELF.fetch(`${origin}/repos/alice/validation/issues`, {
      method: "POST",
      headers: { Authorization: `token ${env.PRE_GITHUB_TOKEN}` },
      body: "{not json",
    });
    expect(response.status).toBe(400);
  });
});

describe("events", () => {
  it("record created, updated, and deleted with the kind and timestamp only", async () => {
    const before = {
      created: await eventCount("created"),
      updated: await eventCount("updated"),
      deleted: await eventCount("deleted"),
    };
    const issuePath = "/repos/alice/events/issues";
    await api(issuePath, { method: "POST", json: { title: "Secret title" } });
    await api(`${issuePath}/1`, { method: "PATCH", json: { body: "Secret body" } });
    await api(`${issuePath}/1`, { method: "DELETE" });
    await api(`${issuePath}/1`, { method: "PATCH", json: { body: "Gone" } });
    await api(`${issuePath}/1`, { method: "DELETE" });

    expect(await eventCount("created")).toBe(before.created + 1);
    expect(await eventCount("updated")).toBe(before.updated + 1);
    expect(await eventCount("deleted")).toBe(before.deleted + 1);
    const latest = await env.DB.prepare("SELECT * FROM events ORDER BY id DESC").first();
    expect(latest).toEqual({ id: expect.any(Number), kind: "deleted", at: isoTimestamp });
  });

  it("work with the measurement query in documents/DIRECTION.md", async () => {
    await api("/repos/alice/measure/issues", { method: "POST", json: { title: "Counted" } });
    const row = await env.DB.prepare(
      "select count(*) as n from events where kind = 'created' and at >= datetime('now', '-14 days')",
    ).first<{ n: number }>();
    expect(row?.n).toBeGreaterThanOrEqual(1);
  });
});
