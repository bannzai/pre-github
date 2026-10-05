/** The kinds of possible leaks the preview pages highlight, in the order the page counts them. */
export const leakKinds = ["phone", "email", "homePath", "apiKey"] as const;

/** One kind of possible leak. */
export type LeakKind = (typeof leakKinds)[number];

/** How many possible leaks of each kind were marked on a page. */
export type LeakCounts = Record<LeakKind, number>;

/** The singular and plural names of each kind, as the page shows them. */
export const leakKindNames: Record<LeakKind, [singular: string, plural: string]> = {
  phone: ["phone number", "phone numbers"],
  email: ["email address", "email addresses"],
  homePath: ["home directory path", "home directory paths"],
  apiKey: ["API-key-looking string", "API-key-looking strings"],
};

/**
 * A pattern of one kind of possible leak. `pattern` has the `g` flag. `accepts`, when present,
 * refuses a match that the pattern alone cannot tell apart from a false positive.
 */
type LeakDetector = { kind: LeakKind; pattern: RegExp; accepts?: (match: string) => boolean };

/**
 * The patterns of possible leaks (documents/PROJECT.md, HTML pages). They look for strings that
 * should not reach GitHub by accident; a match is a candidate for a person to look at, not proof.
 * No match is hidden or changed.
 */
const leakDetectors: LeakDetector[] = [
  {
    /**
     * Phone numbers: international numbers starting with `+` (9 to 15 digits, as E.164 allows),
     * Japanese numbers starting with `0` grouped by hyphens, spaces, or parentheses (10 or 11
     * digits, such as `03-0000-0000` or `(03) 0000-0000`), Japanese mobile numbers without
     * separators (`0X0` and 8 digits), and North American numbers (`(212) 555-0123`,
     * `212-555-0123`). Numbers separated by dots are not found.
     * Not matched (false positives avoided): ISBNs (`978-4-87311-565-8`, `0-306-40615-2`), dates
     * and timestamps (`2026-10-06`, `06-10-2026`, `2026-10-06T12:34:56Z`, `1759708800`), time
     * zone offsets (`+09:00`), zip codes (`150-0002`), and digit runs inside longer numbers or
     * words.
     */
    kind: "phone",
    pattern:
      /(?<![\w+-])(?:\+\d{1,3}(?:[ -]?(?:\(\d{1,4}\)|\d{1,4})){2,5}|(?:\(0[1-9]\d{0,3}\)|0[1-9]\d{0,3})[ -]?(?:\(\d{1,4}\)|\d{1,4})[ -]?\d{3,4}|(?:\(\d{3}\) ?|\d{3}-)\d{3}-\d{4})(?![\w-])/g,
    accepts: (match) => {
      const digitCount = match.replace(/\D/g, "").length;
      if (match.startsWith("+")) return digitCount >= 9 && digitCount <= 15;
      if (/^\d+$/.test(match)) return /^0[5789]0\d{8}$/.test(match);
      return digitCount === 10 || digitCount === 11;
    },
  },
  {
    /**
     * Email addresses: `local@domain.tld`.
     * Not matched (false positives avoided): the reserved example domains `example.com`,
     * `example.net`, and `example.org` with their subdomains, GitHub's no-reply addresses
     * (`users.noreply.github.com`), the `git@` user of SSH remotes (`git@github.com:owner/repo`),
     * image file names with a scale suffix (`logo@2x.png`), and package versions
     * (`markdown-it@15.0.2`).
     */
    kind: "email",
    pattern: /(?<![\w.%+-])[\w.%+-]+@(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?![\w-])/gi,
    accepts: (match) => {
      const [localPart, domain] = match.toLowerCase().split("@") as [string, string];
      return (
        localPart !== "git" &&
        !/(?:^|\.)(?:example\.(?:com|net|org)|users\.noreply\.github\.com)$/.test(domain) &&
        !/\.(?:png|jpe?g|gif|svg|webp)$/.test(domain)
      );
    },
  },
  {
    /**
     * Absolute home directory paths: `/Users/<name>` (macOS) and `/home/<name>` (Linux), with
     * the rest of the path.
     * Not matched (false positives avoided): `/Users/Shared` and `/home/runner` (the shared
     * folder of macOS and the home of GitHub Actions runners, which name no person), the same
     * words inside a URL (`https://example.com/home/alice`) or a longer path (`/srv/home/alice`),
     * and placeholders such as `/Users/<name>` or `/home/$USER`.
     */
    kind: "homePath",
    pattern:
      /(?<![\w.~-])\/(?:Users|home)\/(?!(?:Shared|runner)(?![\p{L}\p{N}_@+-]|\.[\p{L}\p{N}_@+-]))[\p{L}\p{N}_.@+-]*[\p{L}\p{N}_@+-](?:\/[\p{L}\p{N}_.@+-]*[\p{L}\p{N}_@+-])*/gu,
  },
  {
    /**
     * Strings that start like an API key or token: GitHub (`ghp_`, `gho_`, `ghu_`, `ghs_`,
     * `ghr_`, `github_pat_`), OpenAI and Anthropic (`sk-`), Slack (`xoxb-` and the other `xox?-`
     * tokens), AWS access keys (`AKIA`, `ASIA`), Google API keys (`AIza`), and Stripe
     * (`sk_live_`, `rk_test_`, ...), each followed by as many characters as the real ones have.
     * Not matched (false positives avoided): the prefixes inside words (`task-list`, `risk-`)
     * and prefixes followed by a short placeholder (`ghp_xxx`, `sk-...`).
     */
    kind: "apiKey",
    pattern:
      /(?<![\w-])(?:gh[pousr]_[A-Za-z\d_]{20,}|github_pat_[A-Za-z\d_]{20,}|sk-[A-Za-z\d_-]{20,}|xox[abeoprs]-[A-Za-z\d-]{10,}|(?:AKIA|ASIA)[A-Z\d]{16}|AIza[A-Za-z\d_-]{35}|[rs]k_(?:live|test)_[A-Za-z\d]{16,})(?![\w-])/g,
  },
  {
    /**
     * Long random-looking strings without a known prefix: 32 or more letters and digits in a
     * row, mixing digits, lowercase, and uppercase letters, such as a key after `API_KEY=`.
     * Not matched (false positives avoided): Git commit IDs and other hex hashes (no uppercase
     * or no lowercase letters), UUIDs (hyphens split them into short runs), base64 data such as
     * `"integrity": "sha512-..."` in package-lock.json (its runs touch `+`, `/`, `-`, or `=`),
     * and path segments of URLs (they follow a `/`).
     */
    kind: "apiKey",
    pattern: /(?<![A-Za-z\d+/_-])[A-Za-z\d]{32,}(?![A-Za-z\d+/=_-])/g,
    accepts: (match) => /\d/.test(match) && /[a-z]/.test(match) && /[A-Z]/.test(match),
  },
];

/** A possible leak in a text: its kind and its position (`start` inclusive, `end` exclusive). */
type Leak = { kind: LeakKind; start: number; end: number };

/**
 * The possible leaks in `text`, in order of position. Where matches overlap, the one that starts
 * first is kept, and of two that start together, the longer one.
 */
export function findLeaks(text: string): Leak[] {
  const candidates = leakDetectors
    .flatMap(({ kind, pattern, accepts }) =>
      [...text.matchAll(pattern)]
        .filter((match) => accepts?.(match[0]) ?? true)
        .map((match) => ({ kind, start: match.index, end: match.index + match[0].length })),
    )
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const leaks: Leak[] = [];
  for (const candidate of candidates) {
    if (candidate.start >= (leaks.at(-1)?.end ?? 0)) leaks.push(candidate);
  }
  return leaks;
}

/** The entities of the characters `escapeHtml` replaces, the same ones markdown-it writes. */
const htmlEntities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/** `text` escaped for an element or a quoted attribute value, the same way markdown-it escapes. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => htmlEntities[character] ?? character);
}

/** The start tag of the `<mark>` around one possible leak of `kind`, titled with its name. */
export function leakMarkStart(kind: LeakKind): string {
  return `<mark title="Possible ${leakKindNames[kind][0]}">`;
}

/**
 * `text` escaped as HTML with each possible leak wrapped in `<mark>`. Adds each leak to
 * `leakCounts`, so that the count at the top of a page and its marks come from the same search.
 */
export function markLeaks(text: string, leakCounts: LeakCounts): string {
  let markedHtml = "";
  let position = 0;
  for (const leak of findLeaks(text)) {
    leakCounts[leak.kind] += 1;
    markedHtml += escapeHtml(text.slice(position, leak.start));
    markedHtml += `${leakMarkStart(leak.kind)}${escapeHtml(text.slice(leak.start, leak.end))}</mark>`;
    position = leak.end;
  }
  return markedHtml + escapeHtml(text.slice(position));
}
