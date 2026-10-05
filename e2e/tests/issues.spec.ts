import { expect, test } from "@playwright/test";

test("an issue created through the API is returned by GET", async ({ request }) => {
  const created = await request.post("/repos/e2e/demo/issues", {
    data: { title: "E2E issue", body: "Created by Playwright" },
  });
  expect(created.status()).toBe(201);
  const issue = await created.json();
  expect(issue).toMatchObject({
    title: "E2E issue",
    body: "Created by Playwright",
    state: "open",
  });

  const fetched = await request.get(`/repos/e2e/demo/issues/${issue.number}`);
  expect(fetched.status()).toBe(200);
  expect(await fetched.json()).toEqual(issue);
});
