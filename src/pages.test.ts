import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

/** The origin every test request is sent to. */
const origin = "https://pre-github.test";

/** Creates a preview through the API with the instance token and returns its JSON. */
async function createPreview(path: string, json: Record<string, unknown>) {
  const response = await SELF.fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PRE_GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(json),
  });
  expect(response.status).toBe(201);
  return response.json<{ number: number; html_url: string }>();
}

/** Posts the login form with `token` and `next`, without following the redirect. */
function postLogin(token: string, next: string) {
  return SELF.fetch(`${origin}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, next }).toString(),
    redirect: "manual",
  });
}

/** The `name=value` part of the session cookie issued by a successful login. */
async function sessionCookie(): Promise<string> {
  const setCookie = (await postLogin(env.PRE_GITHUB_TOKEN ?? "", "/")).headers.get("Set-Cookie");
  if (!setCookie) throw new Error("the login set no cookie");
  return setCookie.split(";")[0]!;
}

/**
 * `pageHtml` without the whitespace around tags, which depends on how Prettier wraps the
 * templates in src/pages.ts and does not change what the page shows.
 */
function compactHtml(pageHtml: string): string {
  return pageHtml.replace(/\s+>/g, ">").replace(/>\s+</g, "><");
}

/** Sends a page request carrying `cookie`, without following redirects. */
function getPage(path: string, cookie: string) {
  return SELF.fetch(`${origin}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
}

describe("page login", () => {
  it("answers the login page and nothing else without the session cookie, whether or not the preview exists", async () => {
    await createPreview("/repos/alice/pages-auth/issues", { title: "Secret title", body: "x" });
    await createPreview("/repos/alice/pages-auth/pulls", {
      title: "Secret pull",
      head: "feature",
      base: "main",
    });
    const responses = await Promise.all(
      [
        "/",
        "/alice/pages-auth/issues",
        "/alice/pages-auth/pulls",
        "/alice/pages-auth/issues/1",
        "/alice/pages-auth/issues/999",
        "/alice/pages-auth/pull/2",
        "/alice/pages-auth/pull/999",
      ].map((path) =>
        // The API token in a header does not open a page: only the session cookie does.
        SELF.fetch(`${origin}${path}`, {
          headers: { Authorization: `Bearer ${env.PRE_GITHUB_TOKEN}` },
        }),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(401);
      const page = await response.text();
      expect(page).toContain("Enter the instance token");
      expect(page).not.toContain("Secret");
    }
  });

  it("refuses a wrong token without setting a cookie", async () => {
    const response = await postLogin(`not-${env.PRE_GITHUB_TOKEN}`, "/alice/pages-auth/issues");
    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.text()).toContain("That token does not match");
  });

  it("refuses a login form over 64 KiB before parsing it", async () => {
    const response = await postLogin("x".repeat(64 * 1024), "/");
    expect(response.status).toBe(413);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("sets an HttpOnly, Secure, SameSite=Lax session cookie for the right token and returns to next", async () => {
    const created = await createPreview("/repos/alice/pages-login/issues", {
      title: "Visible after login",
    });
    const pagePath = new URL(created.html_url).pathname;
    const response = await postLogin(env.PRE_GITHUB_TOKEN ?? "", pagePath);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(pagePath);
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toMatch(/; HttpOnly/);
    expect(setCookie).toMatch(/; Secure/);
    expect(setCookie).toMatch(/; SameSite=Lax/);

    const page = await getPage(pagePath, setCookie.split(";")[0]!);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Visible after login");
  });

  it.each([
    "//evil.example/path",
    "https://evil.example/path",
    "javascript:alert(1)",
    `${origin}//evil.example/path`,
  ])("returns to / instead of next=%s", async (next) => {
    const response = await postLogin(env.PRE_GITHUB_TOKEN ?? "", next);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/");
  });

  it("refuses a session cookie whose signature does not match", async () => {
    const [name, value] = (await sessionCookie()).split("=") as [string, string];
    const [expiresAt] = decodeURIComponent(value).split(".");
    const forged = `${name}=${encodeURIComponent(`${Number(expiresAt) + 1000}.${"A".repeat(43)}=`)}`;
    const response = await getPage("/", forged);
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("Enter the instance token");
  });
});

describe("preview pages", () => {
  it("render an issue body as GitHub Flavored Markdown and escape raw HTML", async () => {
    const created = await createPreview("/repos/alice/pages-markdown/issues", {
      title: "<b>Title</b> stays text",
      body: [
        "- [x] done",
        "- [ ] todo",
        "",
        "| a | b |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
        "```ts",
        "const answer = 42;",
        "```",
        "",
        "![diagram](https://example.com/diagram.png)",
        "",
        "See https://example.com/docs",
        "",
        "Update README.md and main.py, then read www.example.com/guide.",
        "",
        "Mail someone@example.com, not //README.md or ftp://example.com/file.",
        "",
        '<script>alert("raw")</script>',
        "",
        "[click](javascript:alert(1))",
      ].join("\n"),
    });
    const response = await getPage(new URL(created.html_url).pathname, await sessionCookie());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    // `no-referrer` would send the delete form's Origin as null (see pageHeaders).
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    const page = await response.text();
    expect(page).toContain("&lt;b&gt;Title&lt;/b&gt; stays text");
    expect(page).toMatch(/<input(?=[^>]*type="checkbox")(?=[^>]*checked)[^>]*>/);
    expect(page).toContain("<table>");
    expect(page).toContain('<code class="language-ts">');
    expect(page).toContain('<img src="https://example.com/diagram.png" alt="diagram">');
    expect(page).toContain('<a href="https://example.com/docs">https://example.com/docs</a>');
    // GitHub links neither file names nor hosts without `www.` or a scheme.
    expect(page).toContain("Update README.md and main.py, then read");
    expect(page).toContain('<a href="http://www.example.com/guide">www.example.com/guide</a>.');
    expect(page).toContain('<a href="mailto:someone@example.com">someone@example.com</a>');
    expect(page).not.toContain('href="//README.md"');
    expect(page).not.toContain('href="ftp:');
    expect(page).toContain("&lt;script&gt;alert(&quot;raw&quot;)&lt;/script&gt;");
    expect(page).not.toContain("<script>");
    expect(page).not.toContain('href="javascript:');
  });

  it("render the comments of an issue", async () => {
    const created = await createPreview("/repos/alice/pages-comments/issues", {
      title: "With a comment",
    });
    await SELF.fetch(`${origin}/repos/alice/pages-comments/issues/${created.number}/comments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.PRE_GITHUB_TOKEN}` },
      body: JSON.stringify({ body: "**A comment**" }),
    });
    const page = await (
      await getPage(new URL(created.html_url).pathname, await sessionCookie())
    ).text();
    expect(page).toContain("1 comment");
    expect(page).toContain("<strong>A comment</strong>");
  });

  it("render a pull request's files with their counts and colored lines", async () => {
    const created = await createPreview("/repos/alice/pages-diff/pulls", {
      title: "Two files",
      head: "feature",
      base: "main",
      diff: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,2 +1,2 @@",
        " keep",
        "-old",
        "+new",
        "diff --git a/README.md b/README.md",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/README.md",
        "@@ -0,0 +1,2 @@",
        "+# Title",
        "+<img src=x onerror=alert(1)>",
        "",
      ].join("\n"),
    });
    const page = compactHtml(
      await (await getPage(new URL(created.html_url).pathname, await sessionCookie())).text(),
    );
    expect(page).toContain("2 files changed");
    expect(page).toContain("<code>src/a.ts</code>");
    expect(page).toContain("<code>README.md</code>");
    expect(page).toContain('<span class="additions">+3</span><span class="deletions">−1</span>');
    expect(page).toContain('class="diff-line-addition"');
    expect(page).toContain('class="diff-line-deletion"');
    expect(page).toContain("+&lt;img src=x onerror=alert(1)&gt;");
    expect(page).toContain('<code class="branch">feature</code>');
  });

  it("say so when a pull request's diff is not a unified diff", async () => {
    const created = await createPreview("/repos/alice/pages-unreadable/pulls", {
      title: "Not a diff",
      head: "feature",
      base: "main",
      diff: "this is not a unified diff",
    });
    const page = await (
      await getPage(new URL(created.html_url).pathname, await sessionCookie())
    ).text();
    expect(page).toContain("The stored diff could not be read as a unified diff");
  });

  it("show a non-ASCII file name that Git quoted with octal escapes as text", async () => {
    // `git diff` with the default core.quotePath writes 日本.md as "\346\227\245\346\234\254.md".
    const quotedPath = "\\346\\227\\245\\346\\234\\254.md";
    const created = await createPreview("/repos/alice/pages-quoted/pulls", {
      title: "Quoted path",
      head: "feature",
      base: "main",
      diff: [
        `diff --git "a/${quotedPath}" "b/${quotedPath}"`,
        "new file mode 100644",
        "--- /dev/null",
        `+++ "b/${quotedPath}"`,
        "@@ -0,0 +1 @@",
        "+text",
        "",
      ].join("\n"),
    });
    const page = compactHtml(
      await (await getPage(new URL(created.html_url).pathname, await sessionCookie())).text(),
    );
    expect(page).toContain("<code>日本.md</code>");
    expect(page).not.toContain("\\346");
  });

  it("list the previews of a repository by state", async () => {
    await createPreview("/repos/alice/pages-list/issues", { title: "Listed issue" });
    const page = compactHtml(
      await (await getPage("/alice/pages-list/issues", await sessionCookie())).text(),
    );
    expect(page).toContain("1 Open");
    expect(page).toContain("0 Closed");
    expect(page).toContain('href="/alice/pages-list/issues/1">Listed issue</a>');
    const closed = await (
      await getPage("/alice/pages-list/issues?state=closed", await sessionCookie())
    ).text();
    expect(closed).toContain("No closed issues");
  });

  it("answer 404 for a preview that does not exist, or of the other kind", async () => {
    await createPreview("/repos/alice/pages-missing/issues", { title: "An issue" });
    const cookie = await sessionCookie();
    expect((await getPage("/alice/pages-missing/issues/2", cookie)).status).toBe(404);
    expect((await getPage("/alice/pages-missing/pull/1", cookie)).status).toBe(404);
  });

  it("open for an owner named repos, whose paths start like the API's", async () => {
    const created = await createPreview("/repos/repos/demo/issues", { title: "Owner repos" });
    const response = await getPage(new URL(created.html_url).pathname, await sessionCookie());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Owner repos");
  });
});

describe("the delete button", () => {
  /** Posts the delete form of `pagePath` with `cookie` and the Origin header `requestOrigin`. */
  function postDelete(pagePath: string, cookie: string, requestOrigin: string) {
    return SELF.fetch(`${origin}${pagePath}/delete`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: requestOrigin },
      redirect: "manual",
    });
  }

  it("deletes the preview with the DELETE API's function and returns to the list", async () => {
    const created = await createPreview("/repos/alice/pages-delete/pulls", {
      title: "Delete me",
      head: "feature",
      base: "main",
    });
    const pagePath = new URL(created.html_url).pathname;
    const cookie = await sessionCookie();
    const response = await postDelete(pagePath, cookie, origin);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/alice/pages-delete/pulls");
    expect((await getPage(pagePath, cookie)).status).toBe(404);
    const stored = await env.DB.prepare(
      "SELECT count(*) AS n FROM previews WHERE owner = 'alice' AND repo = 'pages-delete'",
    ).first<{ n: number }>();
    expect(stored?.n).toBe(0);
  });

  it("refuses a request from another origin or without a session", async () => {
    const created = await createPreview("/repos/alice/pages-keep/issues", { title: "Keep me" });
    const pagePath = new URL(created.html_url).pathname;
    const cookie = await sessionCookie();
    expect((await postDelete(pagePath, cookie, "https://evil.example")).status).toBe(403);
    expect((await postDelete(pagePath, "", origin)).status).toBe(401);
    expect((await getPage(pagePath, cookie)).status).toBe(200);
  });
});
