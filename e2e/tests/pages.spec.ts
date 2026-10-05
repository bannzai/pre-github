import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { token } from "../instance.js";

// A person's browser carries only the session cookie, not the API token that the project sends
// with every request. API calls below add the token themselves.
test.use({ extraHTTPHeaders: {} });

/** Creates a preview through the API at `apiPath` and returns the path of its page. */
async function createPreview(
  request: APIRequestContext,
  apiPath: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await request.post(apiPath, {
    data,
    headers: { Authorization: `token ${token}` },
  });
  expect(response.status()).toBe(201);
  return new URL((await response.json()).html_url).pathname;
}

/** Opens `pagePath`, which shows the login form, and signs in, which returns to `pagePath`. */
async function signIn(page: Page, pagePath: string) {
  await page.goto(pagePath);
  await page.getByLabel("Token").fill(token);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${pagePath}$`));
}

test("without the session cookie a page shows only the login form", async ({
  page,
  request,
}, testInfo) => {
  const pagePath = await createPreview(request, "/repos/e2e/login/issues", {
    title: "Not shown before login",
    body: "Hidden body",
  });

  const response = await page.goto(pagePath);
  expect(response?.status()).toBe(401);
  await expect(page.getByRole("heading", { name: "Enter the instance token" })).toBeVisible();
  await expect(page.getByText("Not shown before login")).toHaveCount(0);
  await expect(page.getByText("Hidden body")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("login.png"), fullPage: true });

  await page.getByLabel("Token").fill(`not-${token}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("That token does not match");

  await page.getByLabel("Token").fill(token);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${pagePath}$`));
  await expect(page.getByRole("heading", { name: "Not shown before login" })).toBeVisible();
});

test("an issue page renders GitHub Flavored Markdown and escapes raw HTML", async ({
  page,
  request,
}, testInfo) => {
  const pagePath = await createPreview(request, "/repos/e2e/markdown/issues", {
    title: "Render the body like GitHub",
    body: [
      "## Checklist",
      "",
      "- [x] Store the preview",
      "- [ ] Send it to GitHub",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| state | open |",
      "| kind | issue |",
      "",
      "```ts",
      "const answer: number = 42;",
      "```",
      "",
      "![Avatar](https://avatars.githubusercontent.com/u/9919?s=80&v=4)",
      "",
      "Source: https://github.com/bannzai/pre-github",
      "",
      '<script>alert("raw html")</script>',
      "<b>not bold</b>",
    ].join("\n"),
  });
  await request.post(`/repos/e2e/markdown/issues/${pagePath.split("/").at(-1)}/comments`, {
    data: { body: "Looks the same as it will on GitHub" },
    headers: { Authorization: `token ${token}` },
  });
  let dialogOpened = false;
  page.on("dialog", async (dialog) => {
    dialogOpened = true;
    await dialog.dismiss();
  });

  await signIn(page, pagePath);
  const body = page.locator(".markdown-body").first();
  await expect(body.locator("table")).toBeVisible();
  await expect(body.locator("td", { hasText: "state" })).toBeVisible();
  const checkboxes = body.locator('input[type="checkbox"]');
  await expect(checkboxes).toHaveCount(2);
  await expect(checkboxes.nth(0)).toBeChecked();
  await expect(checkboxes.nth(1)).not.toBeChecked();
  await expect(body.locator("code.language-ts")).toHaveText("const answer: number = 42;");
  await expect(body.locator("img")).toHaveAttribute(
    "src",
    "https://avatars.githubusercontent.com/u/9919?s=80&v=4",
  );
  // Loaded, not just present: the Content Security Policy must let the image through.
  await expect
    .poll(() => body.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(body.locator('a[href="https://github.com/bannzai/pre-github"]')).toBeVisible();
  await expect(body.getByText('<script>alert("raw html")</script>')).toBeVisible();
  await expect(body.getByText("<b>not bold</b>")).toBeVisible();
  await expect(body.locator("script, b")).toHaveCount(0);
  await expect(page.getByText("Looks the same as it will on GitHub")).toBeVisible();
  await expect(page.locator(".leak-banner")).toContainText("No possible leaks found");
  await expect(page.locator("mark")).toHaveCount(0);
  expect(dialogOpened).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("issue.png"), fullPage: true });

  await page.getByRole("link", { name: "Issues", exact: true }).click();
  await expect(page.getByRole("link", { name: "Render the body like GitHub" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("issues-list.png"), fullPage: true });
});

test("a pull request page lists the files and colors added and removed lines", async ({
  page,
  request,
}, testInfo) => {
  const pagePath = await createPreview(request, "/repos/e2e/diff/pulls", {
    title: "Greet with a template literal",
    body: "Two files change.",
    head: "feature/greeting",
    base: "main",
    diff: [
      "diff --git a/src/greeting.ts b/src/greeting.ts",
      "index 3b18e51..a1b2c3d 100644",
      "--- a/src/greeting.ts",
      "+++ b/src/greeting.ts",
      "@@ -1,3 +1,3 @@",
      " export function greeting(name: string): string {",
      '-  return "Hello " + name;',
      "+  return `Hello ${name}`;",
      " }",
      "diff --git a/README.md b/README.md",
      "new file mode 100644",
      "index 0000000..e69de29",
      "--- /dev/null",
      "+++ b/README.md",
      "@@ -0,0 +1,2 @@",
      "+# Greeting",
      "+Says hello.",
      "",
    ].join("\n"),
  });

  await signIn(page, pagePath);
  const fileList = page.locator(".file-list li");
  await expect(fileList).toHaveCount(2);
  await expect(fileList.nth(0)).toContainText("src/greeting.ts");
  await expect(fileList.nth(0)).toContainText("+1");
  await expect(fileList.nth(0)).toContainText("−1");
  await expect(fileList.nth(1)).toContainText("README.md");
  await expect(fileList.nth(1)).toContainText("+2");
  await expect(fileList.nth(1)).toContainText("−0");
  await expect(page.locator(".files-summary")).toContainText("2 files changed");
  const addition = page.locator("tr.diff-line-addition").first();
  const deletion = page.locator("tr.diff-line-deletion").first();
  await expect(addition).toContainText("return `Hello ${name}`;");
  await expect(deletion).toContainText('return "Hello " + name;');
  // GitHub's light theme colors for added (#dafbe1) and removed (#ffebe9) lines.
  await expect(addition).toHaveCSS("background-color", "rgb(218, 251, 225)");
  await expect(deletion).toHaveCSS("background-color", "rgb(255, 235, 233)");
  await page.screenshot({ path: testInfo.outputPath("pull.png"), fullPage: true });
});

test("an issue page counts the possible leaks of its body and comments and marks each one", async ({
  page,
  request,
}, testInfo) => {
  // Made-up values. The token is built at run time so that no token-shaped string is committed.
  const fakeGitHubToken = `ghp_${"A1b2C3d4E5".repeat(3)}F6g7H8`;
  const pagePath = await createPreview(request, "/repos/e2e/leaks/issues", {
    title: "Contact details slipped into the body",
    body: [
      "Reach the reviewer at 03-0000-0000 or alice@corp.invalid.",
      "",
      "Reproduced in `/Users/alice/worktrees/demo`.",
      "",
      "Not leaks: someone@example.com, ISBN 978-4-87311-565-8, 2026-10-06T12:34:56Z.",
    ].join("\n"),
  });
  await request.post(`/repos/e2e/leaks/issues/${pagePath.split("/").at(-1)}/comments`, {
    data: { body: `Use this token: ${fakeGitHubToken}` },
    headers: { Authorization: `token ${token}` },
  });

  await signIn(page, pagePath);
  const banner = page.locator(".leak-banner");
  await expect(banner).toContainText("4 possible leaks found in this preview");
  await expect(banner).toContainText(
    "1 phone number · 1 email address · 1 home directory path · 1 API-key-looking string",
  );
  const marks = page.locator("mark");
  await expect(marks).toHaveText([
    "03-0000-0000",
    "alice@corp.invalid",
    "/Users/alice/worktrees/demo",
    fakeGitHubToken,
  ]);
  // The highlight yellow of the gate 2 mockups.
  await expect(marks.first()).toHaveCSS("background-color", "rgb(255, 248, 197)");
  await page.screenshot({ path: testInfo.outputPath("leaks-issue.png"), fullPage: true });
});

test("a pull request page marks the possible leaks of added lines only", async ({
  page,
  request,
}, testInfo) => {
  const pagePath = await createPreview(request, "/repos/e2e/leaks/pulls", {
    title: "Point the deploy at the new owner",
    body: "Nothing personal in the body.",
    head: "feature/deploy-owner",
    base: "main",
    diff: [
      "diff --git a/deploy.env b/deploy.env",
      "index 3b18e51..a1b2c3d 100644",
      "--- a/deploy.env",
      "+++ b/deploy.env",
      "@@ -1,2 +1,3 @@",
      " REGION=ap-northeast-1",
      "-OWNER=bob@corp.invalid",
      "+OWNER=carol@corp.invalid",
      "+KEY_PATH=/home/carol/.ssh/id_ed25519",
      "",
    ].join("\n"),
  });

  await signIn(page, pagePath);
  const banner = page.locator(".leak-banner");
  await expect(banner).toContainText("2 possible leaks found in this preview");
  await expect(banner).toContainText("1 email address · 1 home directory path");
  await expect(page.locator("tr.diff-line-addition mark")).toHaveText([
    "carol@corp.invalid",
    "/home/carol/.ssh/id_ed25519",
  ]);
  await expect(page.locator("tr.diff-line-deletion mark")).toHaveCount(0);
  await expect(page.locator("mark")).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath("leaks-pull.png"), fullPage: true });
});

test("the delete button removes the preview and its page answers 404 afterwards", async ({
  page,
  request,
}, testInfo) => {
  const pagePath = await createPreview(request, "/repos/e2e/delete/issues", {
    title: "A preview to remove",
    body: "It goes away for good.",
  });

  await signIn(page, pagePath);
  await page.getByText("Delete preview", { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("delete-confirm.png"), fullPage: true });
  await page.getByRole("button", { name: "Delete this preview" }).click();
  await expect(page).toHaveURL(/\/e2e\/delete\/issues$/);
  await expect(page.getByText("No open issues")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("after-delete.png"), fullPage: true });

  const response = await page.goto(pagePath);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This preview does not exist" })).toBeVisible();
});

test("on a phone-width screen the delete confirmation stays inside the screen", async ({
  page,
  request,
}, testInfo) => {
  // The width of a small phone, where the title row wraps the delete button onto its own line.
  await page.setViewportSize({ width: 375, height: 800 });
  const pagePath = await createPreview(request, "/repos/e2e/narrow/issues", {
    title: "A preview opened on a phone",
    body: "The confirmation must fit.",
  });

  await signIn(page, pagePath);
  await page.getByText("Delete preview", { exact: true }).click();
  const confirmation = await page.locator(".delete-confirm").boundingBox();
  expect(confirmation).not.toBeNull();
  expect(confirmation!.x).toBeGreaterThanOrEqual(0);
  expect(confirmation!.x + confirmation!.width).toBeLessThanOrEqual(375);
  await expect(page.getByRole("button", { name: "Delete this preview" })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("delete-confirm-narrow.png"), fullPage: true });
});
