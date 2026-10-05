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

  it.each([
    ["multipart/form-data", "token=x"],
    ["multipart/form-data; boundary=missing", "token=x"],
  ])("answers 400, not 500, to an unparsable login form sent as %s", async (contentType, body) => {
    const response = await SELF.fetch(`${origin}/login`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
      redirect: "manual",
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("text/html");
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
    expect(page).toContain("No possible leaks found");
    expect(page).toContain(
      "Checked the body and 0 comments for phone numbers, email addresses, home directory paths, and API-key-looking strings",
    );
    expect(page).not.toContain("<mark");
  });

  it("count and mark the possible leaks of the body and the comments", async () => {
    // Made-up values. The token is built at run time so that no token-shaped string is committed.
    const fakeGitHubToken = `ghp_${"A1b2C3d4E5".repeat(3)}F6g7H8`;
    const created = await createPreview("/repos/alice/pages-leaks/issues", {
      title: "Leaks",
      body: [
        "Call 03-0000-0000 or mail alice@corp.invalid.",
        "",
        "Run it in `/Users/alice/worktrees/demo`.",
        "",
        "![shot](/Users/alice/Desktop/shot.png)",
        "",
        "Not leaks: someone@example.com, ISBN 978-4-87311-565-8, 2026-10-06T12:34:56Z.",
      ].join("\n"),
    });
    await SELF.fetch(`${origin}/repos/alice/pages-leaks/issues/${created.number}/comments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.PRE_GITHUB_TOKEN}` },
      body: JSON.stringify({ body: `token: ${fakeGitHubToken}` }),
    });
    const page = await (
      await getPage(new URL(created.html_url).pathname, await sessionCookie())
    ).text();
    expect(page).toContain("5 possible leaks found in this preview");
    expect(page).toContain(
      "1 phone number · 1 email address · 2 home directory paths · 1 API-key-looking string",
    );
    expect(page.match(/<mark /g)).toHaveLength(5);
    expect(page).toContain('<mark title="Possible phone number">03-0000-0000</mark>');
    expect(page).toContain('<mark title="Possible email address">alice@corp.invalid</mark>.');
    expect(page).toContain(
      '<code><mark title="Possible home directory path">/Users/alice/worktrees/demo</mark></code>',
    );
    // An image's address is not shown, so the whole image is marked.
    expect(page).toContain(
      '<mark title="Possible home directory path"><img src="/Users/alice/Desktop/shot.png" alt="shot"></mark>',
    );
    expect(page).toContain(
      `<mark title="Possible API-key-looking string">${fakeGitHubToken}</mark>`,
    );
    expect(page).toContain('<a href="mailto:someone@example.com">someone@example.com</a>');
  });

  it("mark the possible leaks of added lines only, not of removed or unchanged lines", async () => {
    const created = await createPreview("/repos/alice/pages-diff-leaks/pulls", {
      title: "Diff leaks",
      head: "feature",
      base: "main",
      diff: [
        "diff --git a/.env b/.env",
        "--- a/.env",
        "+++ b/.env",
        "@@ -1,2 +1,2 @@",
        " HOME=/home/alice",
        "-MAIL=bob@corp.invalid",
        "+MAIL=carol@corp.invalid",
        "",
      ].join("\n"),
    });
    const page = await (
      await getPage(new URL(created.html_url).pathname, await sessionCookie())
    ).text();
    expect(page).toContain("1 possible leak found in this preview");
    expect(page.match(/<mark /g)).toHaveLength(1);
    expect(page).toContain('+MAIL=<mark title="Possible email address">carol@corp.invalid</mark>');
    expect(page).toContain("-MAIL=bob@corp.invalid");
    expect(page).toContain(" HOME=/home/alice");
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

  it("show `No newline at end of file` as a note, not as an added or removed line", async () => {
    const created = await createPreview("/repos/alice/pages-no-newline/pulls", {
      title: "No newline",
      head: "feature",
      base: "main",
      diff: [
        "diff --git a/a.txt b/a.txt",
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1 +1 @@",
        "-old",
        "\\ No newline at end of file",
        "+new",
        "\\ No newline at end of file",
        "",
      ].join("\n"),
    });
    const page = compactHtml(
      await (await getPage(new URL(created.html_url).pathname, await sessionCookie())).text(),
    );
    expect(page.match(/class="diff-line-addition"/g)).toHaveLength(1);
    expect(page.match(/class="diff-line-deletion"/g)).toHaveLength(1);
    expect(page.match(/class="diff-line-note"/g)).toHaveLength(2);
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

  it("keep the page when parse-diff throws on a malformed diff", async () => {
    const created = await createPreview("/repos/alice/pages-malformed/pulls", {
      title: "Malformed diff",
      head: "feature",
      base: "main",
      // parse-diff 0.12.0 throws on a `\ No newline` line right after a hunk header.
      diff: "@@ -1 +1 @@\n\\ No newline at end of file\n",
    });
    const response = await getPage(new URL(created.html_url).pathname, await sessionCookie());
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain("The stored diff could not be read as a unified diff");
    expect(page).toContain("Delete preview");
  });

  it("note a mode change, an empty new file, and a binary new file, which have no hunks", async () => {
    const created = await createPreview("/repos/alice/pages-modes/pulls", {
      title: "Modes",
      head: "feature",
      base: "main",
      diff: [
        "diff --git a/run.sh b/run.sh",
        "old mode 100644",
        "new mode 100755",
        "diff --git a/empty.txt b/empty.txt",
        "new file mode 100644",
        "index 0000000..e69de29",
        "diff --git a/logo.png b/logo.png",
        "new file mode 100644",
        "index 0000000..3b18e51",
        "Binary files /dev/null and b/logo.png differ",
        "",
      ].join("\n"),
    });
    const page = await (
      await getPage(new URL(created.html_url).pathname, await sessionCookie())
    ).text();
    expect(page).toContain("File mode changed from 100644 to 100755");
    // Only empty.txt is empty: logo.png has no hunks because it is binary.
    expect(page.match(/Empty file added/g)).toHaveLength(1);
    expect(page).toContain("File added with no text lines, such as a binary file");
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
