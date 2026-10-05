import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { html, raw } from "hono/html";
import parseDiff from "parse-diff";
import { isInstanceToken } from "./auth";
import { leakKindNames, leakKinds, markLeaks, type LeakCounts } from "./leaks";
import { renderMarkdown } from "./markdown";
import { pageStyle } from "./page-style";
import {
  deletePreview,
  previewAddressCondition,
  previewColumns,
  previewPagePath,
  repositoryPath,
  type CommentRow,
  type PreviewAddress,
  type PreviewRow,
  type PreviewScope,
} from "./repos";
import { hasSession, startSession } from "./session";

/** The request context of the page routes. */
type PageContext = Context<{ Bindings: Cloudflare.Env }>;

/** A rendered fragment of a page, as the `html` tagged template returns it. */
type PageHtml = ReturnType<typeof html>;

/**
 * Headers of every HTML page. The pages run no script, and a body may show images from any
 * host, so the policy allows inline styles and images only. Pages hold unpublished text: they
 * are not cached, and no page URL is sent as a referrer to the hosts of those images.
 * `same-origin` rather than `no-referrer`, because `no-referrer` also turns the `Origin` of the
 * delete form's POST into `null`, which `deleteResponse` refuses.
 */
const pageHeaders = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src * data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "Referrer-Policy": "same-origin",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/** Answers `content` as an HTML page with `status` and `pageHeaders`. */
function pageResponse(
  c: PageContext,
  content: PageHtml,
  status: 200 | 400 | 401 | 403 | 404 | 413,
): Response | Promise<Response> {
  return c.html(content, status, pageHeaders);
}

/** A whole HTML document titled `title` whose `<body>` is `body`. */
function htmlDocument(title: string, body: PageHtml): PageHtml {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>${title}</title>
        <style>
          ${raw(pageStyle)}
        </style>
      </head>
      <body>
        ${body}
      </body>
    </html>`;
}

/** The pre-github mark, from the gate 2 mockups. */
const logo = raw(
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 12h7l2-9 4 18 2-9h3"/></svg>',
);

/** GitHub's issue icon (a dot in a circle), drawn in the current text color. */
const issueIcon = raw(
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>',
);

/** GitHub's pull request icon (two branches joining), drawn in the current text color. */
const pullIcon = raw(
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 7c0 5 12 0 12 5"/></svg>',
);

/**
 * The bar at the top of every page after login: the instance name, then `repository` (the
 * `{owner}/{repo}` part, empty outside a repository), then the note that nothing is on GitHub.
 */
function appHeader(repository: PageHtml | ""): PageHtml {
  return html`<header class="app-header">
    <a class="brand" href="/">${logo}pre-github</a>
    ${repository}
    <span class="preview-note">preview only — nothing here is on github.com</span>
  </header>`;
}

/** `appHeader` for the pages of `scope`: its `{owner}/{repo}` and the Issues and Pull requests tabs. */
function repositoryHeader(scope: PreviewScope): PageHtml {
  const current = (kind: PreviewScope["kind"]) =>
    scope.kind === kind ? raw(' aria-current="page"') : "";
  return appHeader(
    html`<span class="separator">/</span>
      <span>${scope.owner}</span>
      <span class="separator">/</span>
      <strong>${scope.repo}</strong>
      <nav class="repo-nav" aria-label="Repository">
        <a href="${repositoryPath(scope)}/issues" ${current("issue")}>Issues</a>
        <a href="${repositoryPath(scope)}/pulls" ${current("pull")}>Pull requests</a>
      </nav>`,
  );
}

/** A `<time>` element showing `isoTimestamp` (a timestamp column) as a UTC date and time. */
function timeElement(isoTimestamp: string): PageHtml {
  return html`<time datetime="${isoTimestamp}"
    >${new Date(isoTimestamp).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    })}
    UTC</time
  >`;
}

/** The CSS class that colors a preview's state: `state-<kind>-<state>`. */
function stateClass(preview: Pick<PreviewRow, "kind" | "state">): string {
  return `state-${preview.kind}-${preview.state}`;
}

/** The Open or Closed badge under a preview's title, colored as GitHub colors it. */
function stateBadge(preview: Pick<PreviewRow, "kind" | "state">): PageHtml {
  return html`<span class="state-badge ${stateClass(preview)}"
    >${preview.kind === "pull" ? pullIcon : issueIcon}${preview.state === "open" ? "Open" : "Closed"}</span
  >`;
}

/**
 * `text` rendered as GitHub Flavored Markdown with its possible leaks marked, or GitHub's
 * placeholder for an empty body. Adds the marked leaks to `leakCounts`.
 */
function markdownBody(text: string | null, leakCounts: LeakCounts): PageHtml {
  return text
    ? html`<div class="markdown-body">${raw(renderMarkdown(text, leakCounts))}</div>`
    : html`<div class="markdown-body"><p class="empty-body">No description provided.</p></div>`;
}

/** GitHub's check icon, drawn in the current text color. */
const checkIcon = raw(
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
);

/** GitHub's alert icon (an exclamation mark in a triangle), drawn in the current text color. */
const alertIcon = raw(
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
);

/** Joins words into an English list: `a and b`, `a, b, and c`. */
const englishList = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * The band under the header of a preview page, from the gate 2 mockups: how many possible leaks
 * (src/leaks.ts) the page marked, by kind, or what was searched when none were found.
 * `commentCount` is the preview's number of comments. `diffSearch` is whether the added lines of
 * a pull request's diff were searched, or could not be because the stored diff could not be read
 * (an unsearched diff is never reported as free of leaks), or there is no diff (an issue).
 */
function leakBanner(
  leakCounts: LeakCounts,
  commentCount: number,
  diffSearch: "searched" | "unreadable" | "none",
): PageHtml {
  const foundKinds = leakKinds.filter((leakKind) => leakCounts[leakKind] > 0);
  const unreadableNote =
    diffSearch === "unreadable" ? " The stored diff could not be read, so it was not checked." : "";
  if (foundKinds.length === 0) {
    const searchedParts = [
      "the body",
      `${commentCount} ${commentCount === 1 ? "comment" : "comments"}`,
      ...(diffSearch === "searched" ? ["the added lines of the diff"] : []),
    ];
    const searched = `Checked ${englishList.format(searchedParts)} for ${englishList.format(leakKinds.map((leakKind) => leakKindNames[leakKind][1]))}`;
    if (diffSearch === "unreadable") {
      return html`<div class="leak-banner leak-banner-found">
        ${alertIcon}
        <div class="leak-banner-text">
          <strong>The diff was not checked for possible leaks</strong>
          <span>${searched} and found none.${unreadableNote}</span>
        </div>
      </div>`;
    }
    return html`<div class="leak-banner leak-banner-clear">
      ${checkIcon}
      <div class="leak-banner-text">
        <strong>No possible leaks found</strong>
        <span>${searched}</span>
      </div>
    </div>`;
  }
  const total = foundKinds.reduce((sum, leakKind) => sum + leakCounts[leakKind], 0);
  const summary = foundKinds
    .map(
      (leakKind) =>
        `${leakCounts[leakKind]} ${leakKindNames[leakKind][leakCounts[leakKind] === 1 ? 0 : 1]}`,
    )
    .join(" · ");
  return html`<div class="leak-banner leak-banner-found">
    ${alertIcon}
    <div class="leak-banner-text">
      <strong>${total} possible ${total === 1 ? "leak" : "leaks"} found in this preview</strong>
      <span
        >${summary}. Highlighted below; fix them before sending this to
        GitHub.${unreadableNote}</span
      >
    </div>
  </div>`;
}

/**
 * The delete button of a preview page. It opens a confirmation whose form posts to
 * `<pagePath>/delete`; no script is involved.
 */
function deleteControl(pagePath: string): PageHtml {
  return html`<details class="delete-preview">
    <summary class="button button-danger">Delete preview</summary>
    <div class="delete-confirm">
      <p>This removes the preview and its comments from this instance for good.</p>
      <form method="post" action="${pagePath}/delete">
        <button type="submit" class="button button-danger-solid">Delete this preview</button>
      </form>
    </div>
  </details>`;
}

/** The bytes of the single-character escapes Git writes in a quoted path, keyed by the character. */
const gitPathEscapedBytes: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92,
};

/**
 * `path` with the C-style escapes of a path Git quoted (`core.quotePath`, on by default) decoded,
 * so that `\346\227\245\346\234\254.md` shows as `日本.md`, as on GitHub. parse-diff strips the
 * quotes but keeps the escapes. Git quotes every path that contains a backslash, so a backslash
 * in a parsed path always starts an escape.
 */
function decodeGitPath(path: string): string {
  if (!path.includes("\\")) return path;
  const bytes = path.split(/(\\[0-7]{3}|\\.)/).flatMap((part) => {
    if (part.startsWith("\\")) {
      const byte =
        part.length === 4 ? parseInt(part.slice(1), 8) : gitPathEscapedBytes[part.slice(1)];
      if (byte !== undefined) return [byte];
    }
    return [...new TextEncoder().encode(part)];
  });
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** The name of a changed file: its path, or `old → new` for a rename. */
function changedFileName(file: parseDiff.File): string {
  const [oldName, newName] = [file.from, file.to]
    .filter((name): name is string => name !== undefined && name !== "/dev/null")
    .map(decodeGitPath);
  // A diff without file headers names no file; the table below still shows its lines.
  if (oldName === undefined) return "(unnamed file)";
  return newName === undefined || newName === oldName ? oldName : `${oldName} → ${newName}`;
}

/**
 * The abbreviated object ID of an empty file, as the `index` line of a Git diff shows it. A file
 * added or deleted without hunks is empty only when its side of the `index` line is this ID; a
 * binary file has no hunks either.
 */
const emptyBlobIdPrefix = "e69de29";

/**
 * What changed in a file besides its lines, as GitHub notes it above the diff: a mode change,
 * and for a file without hunks, whether it is an empty file, a rename, or a file whose content
 * has no text lines (such as a binary file).
 */
function fileChangeNotes(file: parseDiff.File): string[] {
  const modeNote =
    file.oldMode && file.newMode && file.oldMode !== file.newMode
      ? [`File mode changed from ${file.oldMode} to ${file.newMode}`]
      : [];
  if (file.chunks.length > 0) return modeNote;
  const [oldBlobId, newBlobId] = file.index?.[0]?.split("..") ?? [];
  if (file.new) {
    return [
      ...modeNote,
      newBlobId?.startsWith(emptyBlobIdPrefix)
        ? "Empty file added"
        : "File added with no text lines, such as a binary file",
    ];
  }
  if (file.deleted) {
    return [
      ...modeNote,
      oldBlobId?.startsWith(emptyBlobIdPrefix)
        ? "Empty file deleted"
        : "File deleted with no text lines, such as a binary file",
    ];
  }
  if (file.from !== file.to) return [...modeNote, "File renamed without changes"];
  if (oldBlobId !== newBlobId) {
    return [...modeNote, "File changed with no text lines, such as a binary file"];
  }
  return modeNote.length > 0 ? modeNote : ["No text changes"];
}

/** The `+additions −deletions` counts of a file or of the whole diff. */
function lineCounts(counts: { additions: number; deletions: number }): PageHtml {
  return html`<span class="additions">+${counts.additions}</span
    ><span class="deletions">−${counts.deletions}</span>`;
}

/**
 * `content`, an added line of a diff with its `+` marker, as HTML with the possible leaks after
 * the marker marked and added to `leakCounts`. The marker is left out of the search so that it
 * is not read as the `+` of a phone number or as part of a key.
 */
function markedAddition(content: string, leakCounts: LeakCounts): PageHtml {
  return raw(`${content.slice(0, 1)}${markLeaks(content.slice(1), leakCounts)}`);
}

/**
 * One line of a diff as a table row: old and new line numbers, then the line with its marker. An
 * added line has its possible leaks marked and added to `leakCounts`; removed and unchanged lines
 * are not searched, since sending the change does not add them.
 */
function diffLine(change: parseDiff.Change, leakCounts: LeakCounts): PageHtml {
  // parse-diff gives `\ No newline at end of file` the type and line numbers of the line before
  // it; it is a note about that line, not an added or removed line of its own.
  if (change.content.startsWith("\\ ")) {
    return html`<tr class="diff-line-note">
      <td class="line-number"></td>
      <td class="line-number"></td>
      <td class="line-code">${change.content}</td>
    </tr>`;
  }
  switch (change.type) {
    case "add":
      return html`<tr class="diff-line-addition">
        <td class="line-number"></td>
        <td class="line-number">${change.ln}</td>
        <td class="line-code">${markedAddition(change.content, leakCounts)}</td>
      </tr>`;
    case "del":
      return html`<tr class="diff-line-deletion">
        <td class="line-number">${change.ln}</td>
        <td class="line-number"></td>
        <td class="line-code">${change.content}</td>
      </tr>`;
    case "normal":
      return html`<tr class="diff-line-context">
        <td class="line-number">${change.ln1}</td>
        <td class="line-number">${change.ln2}</td>
        <td class="line-code">${change.content}</td>
      </tr>`;
  }
}

/**
 * The "Files changed" part of a pull request page: the file list, then each file's diff.
 * `files` is `storedDiff` (the `diff` column) as parsed. Adds the possible leaks marked in the
 * added lines to `leakCounts`.
 */
function filesSection(
  files: parseDiff.File[],
  storedDiff: string | null,
  leakCounts: LeakCounts,
): PageHtml {
  const total = files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  return html`<section id="files" class="files">
    <div class="files-summary">
      <strong>${files.length} ${files.length === 1 ? "file" : "files"} changed</strong
      >${lineCounts(total)}
    </div>
    ${
      files.length === 0
        ? html`<p class="blankslate">
            ${
              storedDiff?.trim()
                ? "The stored diff could not be read as a unified diff"
                : "This preview has no diff"
            }
          </p>`
        : html`<ul class="file-list">
              ${files.map(
                (file, index) =>
                  html`<li>
                    <a href="#diff-${index}"><code>${changedFileName(file)}</code></a
                    >${lineCounts(file)}
                  </li>`,
              )}
            </ul>
            ${files.map(
              (file, index) =>
                html`<div class="file" id="diff-${index}">
                  <div class="file-header">
                    <code>${changedFileName(file)}</code>${lineCounts(file)}
                  </div>
                  ${fileChangeNotes(file).map((note) => html`<p class="file-note">${note}</p>`)}
                  <div class="diff-scroll">
                    <table class="diff-table">
                      <tbody>
                        ${file.chunks.map(
                          (chunk) =>
                            html`<tr class="diff-hunk">
                                <td class="line-number"></td>
                                <td class="line-number"></td>
                                <td class="line-code">${chunk.content}</td>
                              </tr>
                              ${chunk.changes.map((change) => diffLine(change, leakCounts))}`,
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>`,
            )}`
    }
  </section>`;
}

/**
 * `storedDiff` (the `diff` column) parsed into files, or no file when parse-diff cannot read it.
 * parse-diff throws on some malformed input, such as a `\ No newline at end of file` line right
 * after a hunk header; `filesSection` then says the diff could not be read, and the rest of the
 * page, including the delete button, still renders.
 */
function parsedDiffFiles(storedDiff: string | null): parseDiff.File[] {
  try {
    return parseDiff(storedDiff);
  } catch {
    return [];
  }
}

/** One comment of a preview page, with its possible leaks marked and added to `leakCounts`. */
function commentItem(comment: CommentRow, leakCounts: LeakCounts): PageHtml {
  return html`<article class="timeline-item" id="issuecomment-${comment.id}">
    <div class="timeline-item-header">Commented ${timeElement(comment.created_at)}</div>
    ${markdownBody(comment.body, leakCounts)}
  </article>`;
}

/**
 * The page of one issue or pull request with its comments, and for a pull request its diff, with
 * the possible leaks of the body, the comments, and the added lines counted in a band at the top.
 */
function previewPage(preview: PreviewRow & { diff: string | null }, comments: CommentRow[]) {
  const files = preview.kind === "pull" ? parsedDiffFiles(preview.diff) : [];
  // The parts are rendered before the band, which shows what their rendering counted.
  const leakCounts: LeakCounts = { phone: 0, email: 0, homePath: 0, apiKey: 0 };
  const body = markdownBody(preview.body, leakCounts);
  const commentItems = comments.map((comment) => commentItem(comment, leakCounts));
  const filesPart = preview.kind === "pull" ? filesSection(files, preview.diff, leakCounts) : "";
  // A stored diff that parses into no file is one `filesSection` says could not be read.
  const diffSearch =
    preview.kind === "issue"
      ? "none"
      : files.length === 0 && preview.diff?.trim()
        ? "unreadable"
        : "searched";
  return htmlDocument(
    `${preview.title} · ${preview.kind === "pull" ? "Pull Request" : "Issue"} #${preview.number} · ${preview.owner}/${preview.repo}`,
    html`<div class="page">
      ${repositoryHeader(preview)} ${leakBanner(leakCounts, comments.length, diffSearch)}
      <main>
        <div class="title-row">
          <h1>${preview.title} <span class="number">#${preview.number}</span></h1>
          ${deleteControl(previewPagePath(preview))}
        </div>
        <div class="meta">
          ${stateBadge(preview)}
          ${preview.kind === "pull" ? html`<span>Wants to merge <code class="branch">${preview.head}</code> into <code class="branch">${preview.base}</code></span>` : ""}
          <span>${comments.length} ${comments.length === 1 ? "comment" : "comments"}</span>
        </div>
        ${
          preview.kind === "pull"
            ? html`<nav class="tabs" aria-label="Pull request">
                <a href="#conversation">Conversation</a
                ><a href="#files">Files changed<span class="counter">${files.length}</span></a>
              </nav>`
            : ""
        }
        <section id="conversation" class="timeline">
          <article class="timeline-item">
            <div class="timeline-item-header">Opened ${timeElement(preview.created_at)}</div>
            ${body}
          </article>
          ${commentItems}
        </section>
        ${filesPart}
        <footer class="send-hint">
          <span>When it looks right, send the same title and body to GitHub:</span>
          <code
            >gh ${preview.kind === "pull" ? "pr" : "issue"} create --title "…" --body-file
            body.md</code
          >
        </footer>
      </main>
    </div>`,
  );
}

/** The columns of `previews` a list row shows. */
type PreviewListRow = Pick<
  PreviewRow,
  "owner" | "repo" | "number" | "kind" | "title" | "state" | "created_at"
>;

/** The issue or pull request list of `scope`, showing the previews in `state`. */
function listPage(
  scope: PreviewScope,
  state: PreviewRow["state"],
  previews: PreviewListRow[],
  counts: Record<PreviewRow["state"], number>,
) {
  const listPath = `${repositoryPath(scope)}/${scope.kind === "pull" ? "pulls" : "issues"}`;
  const kindName = scope.kind === "pull" ? "pull requests" : "issues";
  const current = (tab: PreviewRow["state"]) => (state === tab ? raw(' aria-current="page"') : "");
  return htmlDocument(
    `${scope.kind === "pull" ? "Pull requests" : "Issues"} · ${scope.owner}/${scope.repo}`,
    html`<div class="page">
      ${repositoryHeader(scope)}
      <main>
        <div class="list">
          <div class="list-header">
            <a href="${listPath}?state=open" ${current("open")}>${counts.open} Open</a>
            <a href="${listPath}?state=closed" ${current("closed")}>${counts.closed} Closed</a>
          </div>
          ${
            previews.length === 0
              ? html`<p class="blankslate">No ${state} ${kindName}</p>`
              : previews.map(
                  (preview) =>
                    html`<div class="list-row">
                      <span class="state-mark ${stateClass(preview)}"
                        >${preview.kind === "pull" ? pullIcon : issueIcon}</span
                      >
                      <div>
                        <a class="list-title" href="${previewPagePath(preview)}"
                          >${preview.title}</a
                        >
                        <div class="list-meta">
                          #${preview.number} opened ${timeElement(preview.created_at)}
                        </div>
                      </div>
                    </div>`,
                )
          }
        </div>
      </main>
    </div>`,
  );
}

/** One `{owner}/{repo}` on the top page with the number of its issues and pull requests. */
type RepositoryRow = { owner: string; repo: string; issues: number; pulls: number };

/** The top page: every `{owner}/{repo}` that has previews. `host` is this instance's host. */
function repositoriesPage(repositories: RepositoryRow[], host: string) {
  return htmlDocument(
    "pre-github",
    html`<div class="page">
      ${appHeader("")}
      <main>
        <div class="list">
          <div class="list-header"><strong>Repositories with previews</strong></div>
          ${
            repositories.length === 0
              ? html`<div class="blankslate">
                  <p>No previews yet. Send one with the request you would send to GitHub:</p>
                  <code
                    >gh api --hostname ${host} repos/OWNER/REPO/issues -f title='…' -F
                    body=@body.md</code
                  >
                </div>`
              : repositories.map(
                  (repository) =>
                    html`<div class="list-row">
                      <div>
                        <a class="list-title" href="${repositoryPath(repository)}/issues"
                          >${repository.owner}/${repository.repo}</a
                        >
                        <div class="list-meta">
                          <a href="${repositoryPath(repository)}/issues"
                            >${repository.issues} ${repository.issues === 1 ? "issue" : "issues"}</a
                          >
                          ·
                          <a href="${repositoryPath(repository)}/pulls"
                            >${repository.pulls}
                            ${repository.pulls === 1 ? "pull request" : "pull requests"}</a
                          >
                        </div>
                      </div>
                    </div>`,
                )
          }
        </div>
      </main>
    </div>`,
  );
}

/** A page that only says `heading` and `text`, such as the page of a preview that does not exist. */
function messagePage(heading: string, text: string) {
  return htmlDocument(
    heading,
    html`<div class="page">
      ${appHeader("")}
      <main>
        <div class="blankslate">
          <h1>${heading}</h1>
          <p>${text}</p>
          <p><a href="/">Back to the repositories</a></p>
        </div>
      </main>
    </div>`,
  );
}

/** The page of a preview that does not exist (or no longer does, after a delete). */
function notFoundPage() {
  return messagePage(
    "This preview does not exist",
    "It was deleted, or it was never sent to this instance.",
  );
}

/**
 * The login page. The form posts the token to `/login` with `next`, the path to return to;
 * `tokenMismatch` adds the message for a token that did not match.
 */
function loginPage(login: { next: string; tokenMismatch: boolean }) {
  return htmlDocument(
    "Sign in · pre-github",
    html`<div class="login">
      <div class="login-brand">${logo}pre-github</div>
      <form method="post" action="/login">
        <h1>Enter the instance token</h1>
        <p>
          This instance belongs to one person. The token is the one set with
          <code>wrangler secret put PRE_GITHUB_TOKEN</code>. Nothing is shown until it matches.
        </p>
        ${login.tokenMismatch ? html`<p class="error" role="alert">That token does not match</p>` : ""}
        <div class="field">
          <label for="token">Token</label>
          <input
            id="token"
            name="token"
            type="password"
            autocomplete="current-password"
            placeholder="paste the token"
            required
            autofocus
          />
        </div>
        <input type="hidden" name="next" value="${login.next}" />
        <button type="submit" class="button button-primary">Sign in</button>
        <p class="note">
          A session cookie is set for this browser only (HttpOnly, Secure). The API uses the same
          token as a Bearer header.
        </p>
      </form>
      <p>
        Self-hosted · <a href="https://github.com/bannzai/pre-github">how to deploy your own</a>
      </p>
    </div>`,
  );
}

/**
 * `next` (the login form's return path) when it is a path on this instance, whose URL is
 * `requestUrl`, or `/` otherwise, so that the login form never sends the browser to another site.
 */
function localPath(requestUrl: string, next: unknown): string {
  if (typeof next !== "string" || next === "") return "/";
  try {
    const nextUrl = new URL(next, requestUrl);
    // A pathname starting with `//` would be read back as another host (`//evil.example`).
    return nextUrl.origin === new URL(requestUrl).origin && !nextUrl.pathname.startsWith("//")
      ? `${nextUrl.pathname}${nextUrl.search}`
      : "/";
  } catch {
    return "/";
  }
}

/**
 * Lets a page request through only with a session (src/session.ts). Without one, answers 401
 * with the login page and nothing else, the same whether or not the page exists, so that the
 * response does not tell which previews exist.
 */
const requireSession = createMiddleware<{ Bindings: Cloudflare.Env }>(async (c, next) => {
  if (await hasSession(c)) return next();
  const url = new URL(c.req.url);
  // Only a GET can be repeated after the login redirect; other requests start over at the top.
  return pageResponse(
    c,
    loginPage({
      next: c.req.method === "GET" ? `${url.pathname}${url.search}` : "/",
      tokenMismatch: false,
    }),
    401,
  );
});

/** `GET /{owner}/{repo}/issues` and `/pulls`: the list of `scope`, filtered by `?state=`. */
async function listResponse(c: PageContext, scope: PreviewScope): Promise<Response> {
  // GitHub's lists show open issues and pull requests unless asked for closed ones.
  const state = c.req.query("state") === "closed" ? "closed" : "open";
  const [listed, counted] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT owner, repo, number, kind, title, state, created_at FROM previews
       WHERE owner = ?1 AND repo = ?2 AND kind = ?3 AND state = ?4 ORDER BY number DESC`,
    ).bind(scope.owner, scope.repo, scope.kind, state),
    c.env.DB.prepare(
      `SELECT coalesce(sum(state = 'open'), 0) AS open, coalesce(sum(state = 'closed'), 0) AS closed
       FROM previews WHERE owner = ?1 AND repo = ?2 AND kind = ?3`,
    ).bind(scope.owner, scope.repo, scope.kind),
  ]);
  const counts = counted?.results[0] as Record<PreviewRow["state"], number> | undefined;
  if (!counts) throw new Error("the preview count query returned no row");
  return pageResponse(
    c,
    listPage(scope, state, (listed?.results ?? []) as PreviewListRow[], counts),
    200,
  );
}

/** `GET /{owner}/{repo}/issues/{number}` and `/pull/{number}`: one preview, or 404. */
async function previewResponse(c: PageContext, address: PreviewAddress): Promise<Response> {
  const bindings = [address.owner, address.repo, Number(address.number), address.kind];
  const [selected, listed] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT ${previewColumns}, diff FROM previews WHERE ${previewAddressCondition}`,
    ).bind(...bindings),
    c.env.DB.prepare(
      `SELECT comments.id, comments.body, comments.created_at, comments.updated_at
       FROM comments JOIN previews ON previews.id = comments.preview_id
       WHERE ${previewAddressCondition} ORDER BY comments.id`,
    ).bind(...bindings),
  ]);
  const preview = selected?.results[0] as (PreviewRow & { diff: string | null }) | undefined;
  if (!preview) return pageResponse(c, notFoundPage(), 404);
  return pageResponse(c, previewPage(preview, (listed?.results ?? []) as CommentRow[]), 200);
}

/**
 * `POST /{owner}/{repo}/issues/{number}/delete` and `/pull/{number}/delete`: the delete button.
 * Deletes the preview with the `DELETE` API's own function and returns to the list.
 */
async function deleteResponse(c: PageContext, address: PreviewAddress): Promise<Response> {
  // SameSite=Lax already keeps forms on other sites from sending the session cookie. The Origin
  // check also refuses sibling subdomains of a custom domain, which count as the same site.
  if (c.req.header("Origin") !== new URL(c.req.url).origin) {
    return pageResponse(
      c,
      messagePage("The preview was not deleted", "The request did not come from this instance."),
      403,
    );
  }
  const deleted = await deletePreview(c.env.DB, address);
  if (deleted.status !== 204) return pageResponse(c, notFoundPage(), 404);
  return c.redirect(
    `${repositoryPath(address)}/${address.kind === "pull" ? "pulls" : "issues"}`,
    303,
  );
}

/**
 * The HTML pages (documents/PROJECT.md, HTML pages). `/login` is open to anyone; every other
 * page requires the session that `/login` starts.
 */
export const pages = new Hono<{ Bindings: Cloudflare.Env }>();

pages.get("/login", (c) =>
  pageResponse(
    c,
    loginPage({ next: localPath(c.req.url, c.req.query("next")), tokenMismatch: false }),
    200,
  ),
);
/**
 * The largest login form read, in bytes. A token and a return path fit in a few kilobytes; the
 * limit keeps an unauthenticated body far below the Worker's 128 MB memory before parsing.
 */
const maxLoginFormBytes = 64 * 1024;

pages.post(
  "/login",
  bodyLimit({
    maxSize: maxLoginFormBytes,
    onError: (c) =>
      pageResponse(
        c,
        messagePage("The form is too large", "Send the token and nothing else."),
        413,
      ),
  }),
  async (c) => {
    // parseBody throws on a body its Content-Type cannot read, such as `multipart/form-data`
    // without a boundary. That is a bad request, not a server error.
    const form = await c.req.parseBody().catch(() => undefined);
    if (!form) {
      return pageResponse(
        c,
        messagePage("The form could not be read", "Send the token from the sign-in page."),
        400,
      );
    }
    const next = localPath(c.req.url, form.next);
    const presentedToken = typeof form.token === "string" ? form.token : "";
    if (!(await isInstanceToken(c.env, presentedToken))) {
      return pageResponse(c, loginPage({ next, tokenMismatch: true }), 401);
    }
    await startSession(c, presentedToken);
    return c.redirect(next, 303);
  },
);

pages.get("/", requireSession, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT owner, repo, sum(kind = 'issue') AS issues, sum(kind = 'pull') AS pulls
     FROM previews GROUP BY owner, repo ORDER BY owner, repo`,
  ).all<RepositoryRow>();
  return pageResponse(c, repositoriesPage(results, new URL(c.req.url).host), 200);
});

pages.get("/:owner/:repo/issues", requireSession, (c) =>
  listResponse(c, { ...c.req.param(), kind: "issue" }),
);
pages.get("/:owner/:repo/pulls", requireSession, (c) =>
  listResponse(c, { ...c.req.param(), kind: "pull" }),
);
pages.get("/:owner/:repo/issues/:number{[0-9]+}", requireSession, (c) =>
  previewResponse(c, { ...c.req.param(), kind: "issue" }),
);
pages.get("/:owner/:repo/pull/:number{[0-9]+}", requireSession, (c) =>
  previewResponse(c, { ...c.req.param(), kind: "pull" }),
);
pages.post("/:owner/:repo/issues/:number{[0-9]+}/delete", requireSession, (c) =>
  deleteResponse(c, { ...c.req.param(), kind: "issue" }),
);
pages.post("/:owner/:repo/pull/:number{[0-9]+}/delete", requireSession, (c) =>
  deleteResponse(c, { ...c.req.param(), kind: "pull" }),
);
