import { describe, expect, it } from "vitest";
import { findLeaks, markLeaks, type LeakKind } from "./leaks";

// Every value below is made up. Token-shaped strings are built at run time so that no string
// shaped like a real token is committed.

/** The kind and the text of each possible leak found in `text`. */
function leaksIn(text: string): [LeakKind, string][] {
  return findLeaks(text).map((leak) => [leak.kind, text.slice(leak.start, leak.end)]);
}

describe("findLeaks", () => {
  it.each([
    "03-0000-0000",
    "(03) 0000-0000",
    "090-0000-0000",
    "09000000000",
    "+81 90-0000-0000",
    "+1 212-555-0123",
    "(212) 555-0123",
    "212-555-0123",
  ])("finds the phone number %s", (phone) => {
    expect(leaksIn(`Call ${phone} today.`)).toEqual([["phone", phone]]);
  });

  it.each([
    "ISBN 978-4-87311-565-8",
    "ISBN 0-306-40615-2",
    "ISBN 4873115655",
    "on 2026-10-06",
    "on 06-10-2026",
    "at 2026-10-06T12:34:56Z",
    "at 2026-10-06 12:34:56 +09:00",
    "since 1759708800",
    "zip 150-0002",
    "digits 0123456789",
    "https://github.com/bannzai/pre-github/issues/1#issuecomment-5993708539",
  ])("does not take %s for a phone number", (text) => {
    expect(leaksIn(text)).toEqual([]);
  });

  it.each([
    "alice@corp.invalid",
    "taro.yamada+preview@mail.corp.test",
    "bob_smith@sub.corp.invalid",
    "dev-team@corp.invalid",
  ])("finds the email address %s", (email) => {
    expect(leaksIn(`Mail ${email}.`)).toEqual([["email", email]]);
  });

  it.each([
    "someone@example.com",
    "someone@mail.example.org",
    "12345+octocat@users.noreply.github.com",
    "git@github.com:bannzai/pre-github.git",
    "logo@2x.png",
    "markdown-it@15.0.2",
  ])("does not take %s for an email address", (text) => {
    expect(leaksIn(text)).toEqual([]);
  });

  it.each([
    ["Saved to /Users/alice/worktrees/demo.", "/Users/alice/worktrees/demo"],
    ["key: /home/alice/.ssh/id_ed25519", "/home/alice/.ssh/id_ed25519"],
    ["open file:///Users/alice/Desktop/shot.png", "/Users/alice/Desktop/shot.png"],
  ])("finds the home directory path in %s", (text, path) => {
    expect(leaksIn(text)).toEqual([["homePath", path]]);
  });

  it.each([
    "/Users/Shared/data",
    "See /Users/Shared.",
    "/home/runner/work/pre-github",
    "Runs in /home/runner.",
    "https://example.com/home/alice",
    "/srv/home/alice",
    "/Users/<name>",
    "/home/$USER",
  ])("does not take %s for a home directory path", (text) => {
    expect(leaksIn(text)).toEqual([]);
  });

  it.each([
    `ghp_${"A1b2C3d4E5".repeat(3)}F6g7H8`,
    `github_pat_11AB0CDEFG${"_abcdefghij".repeat(2)}`,
    `sk-proj-${"Ab1".repeat(10)}`,
    "xoxb-" + "1234567890-abcdefghij",
    "AKIA" + "IOSFODNN7EXAMPLE",
    "Zx9Qw8".repeat(6),
  ])("finds the API-key-looking string %s", (key) => {
    expect(leaksIn(`TOKEN=${key}`)).toEqual([["apiKey", key]]);
  });

  it.each([
    "commit 8ee708f0a1b2c3d4e5f60718293a4b5c6d7e8f90",
    "id 123e4567-e89b-12d3-a456-426614174000",
    '"integrity": "sha512-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+AbCdEfGhAbCdEfGhAbCdEfGhAbCdEfGh12/IjKlMnOpIjKlMnOpIjKlMnOpIjKlMnOp34=="',
    "AbstractSingletonProxyFactoryBeanImplementation",
    "task-list-item-checkbox",
    "ghp_xxx and sk-...",
    "https://example.com/assets/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
  ])("does not take %s for an API key", (text) => {
    expect(leaksIn(text)).toEqual([]);
  });

  it("keeps the longer of two matches that start together", () => {
    expect(leaksIn("09000000000@corp.invalid")).toEqual([["email", "09000000000@corp.invalid"]]);
  });
});

describe("markLeaks", () => {
  it("escapes the text, marks each possible leak, and counts it", () => {
    const leakCounts = { phone: 0, email: 0, homePath: 0, apiKey: 0 };
    expect(markLeaks('<b title="x">03-0000-0000</b> & alice@corp.invalid', leakCounts)).toBe(
      '&lt;b title=&quot;x&quot;&gt;<mark title="Possible phone number">03-0000-0000</mark>&lt;/b&gt; &amp; <mark title="Possible email address">alice@corp.invalid</mark>',
    );
    expect(leakCounts).toEqual({ phone: 1, email: 1, homePath: 0, apiKey: 0 });
  });
});
