import { Hono } from "hono";
import { requireToken } from "./auth";
import { githubError } from "./github-error";

/** Which GitHub resource a preview is: the `kind` column of `previews`. */
type PreviewKind = "issue" | "pull";

/** The previews of one kind in one `{owner}/{repo}`, taken from the request path. */
type PreviewScope = { owner: string; repo: string; kind: PreviewKind };

/** One preview, taken from the request path: its scope and the `{number}` path parameter. */
type PreviewAddress = PreviewScope & { number: string };

/** The `previews` columns every JSON response is built from. `diff` is served only as text. */
const previewColumns =
  "id, owner, repo, number, kind, title, body, state, head, base, created_at, updated_at";

/** A `previews` row as selected by `previewColumns`. */
type PreviewRow = {
  id: number;
  owner: string;
  repo: string;
  number: number;
  kind: PreviewKind;
  title: string;
  body: string | null;
  state: "open" | "closed";
  head: string | null;
  base: string | null;
  created_at: string;
  updated_at: string;
};

/** A `comments` row as selected by the comment queries. */
type CommentRow = { id: number; body: string; created_at: string; updated_at: string };

/** The WHERE condition that selects the preview at `PreviewAddress`, bound as ?1 to ?4. */
const previewAddressCondition = "owner = ?1 AND repo = ?2 AND number = ?3 AND kind = ?4";

/** The largest `body` or `diff` accepted, in bytes (.claude/rules/d1-database.md). */
const maxTextBytes = 1_000_000;

/**
 * The largest total of a preview's text columns, in bytes. D1 rejects rows over 2,000,000 bytes
 * (https://developers.cloudflare.com/d1/platform/limits/); the remaining 10,000 bytes cover the
 * numbers, timestamps, `kind`, `state`, and SQLite's record header.
 */
const maxPreviewTextBytes = 1_990_000;

/** The HTML page of a preview on this instance (the pages themselves are a separate change). */
function previewHtmlUrl(
  origin: string,
  preview: Pick<PreviewRow, "owner" | "repo" | "number" | "kind">,
): string {
  return `${origin}/${encodeURIComponent(preview.owner)}/${encodeURIComponent(preview.repo)}/${preview.kind === "pull" ? "pull" : "issues"}/${preview.number}`;
}

/**
 * GitHub's issue or pull request object, limited to the fields documents/PROJECT.md keeps.
 * Pull requests add `head.ref` and `base.ref`.
 */
function previewJson(origin: string, preview: PreviewRow) {
  return {
    id: preview.id,
    number: preview.number,
    title: preview.title,
    body: preview.body,
    state: preview.state,
    html_url: previewHtmlUrl(origin, preview),
    created_at: preview.created_at,
    updated_at: preview.updated_at,
    ...(preview.kind === "pull"
      ? { head: { ref: preview.head }, base: { ref: preview.base } }
      : {}),
  };
}

/** GitHub's issue comment object, limited to the fields this instance stores. */
function commentJson(
  origin: string,
  preview: Pick<PreviewRow, "owner" | "repo" | "number" | "kind">,
  comment: CommentRow,
) {
  return {
    id: comment.id,
    body: comment.body,
    html_url: `${previewHtmlUrl(origin, preview)}#issuecomment-${comment.id}`,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
  };
}

/** The request's JSON body when it is a JSON object, or undefined when it is not. */
async function readJsonObject(request: Request): Promise<Record<string, unknown> | undefined> {
  const parsed: unknown = await request.json().catch(() => undefined);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

/**
 * Why `fields` cannot be stored, as a 422 message, or undefined when they can. `requiredNames`
 * must be present. Text fields must be strings within `maxTextBytes`, and `title`, `head`, and
 * `base` must not be empty; `state` must be `open` or `closed`. Other fields (such as `labels`)
 * are accepted and ignored.
 */
function fieldsProblem(
  fields: Record<string, unknown>,
  requiredNames: string[],
): string | undefined {
  for (const name of requiredNames) {
    if (fields[name] === undefined || fields[name] === null) return `${name} is missing`;
  }
  for (const name of ["title", "body", "head", "base", "diff"]) {
    const value = fields[name];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") return `${name} must be a string`;
    if (value === "" && name !== "body" && name !== "diff") return `${name} must not be empty`;
    if (byteLength(value) > maxTextBytes) {
      return `${name} is larger than ${maxTextBytes} bytes`;
    }
  }
  if (fields.state !== undefined && fields.state !== "open" && fields.state !== "closed") {
    return "state must be open or closed";
  }
  return undefined;
}

/** The UTF-8 size of `text` in bytes, the unit D1 limits rows by. */
function byteLength(text: string | null): number {
  return text === null ? 0 : new TextEncoder().encode(text).byteLength;
}

/** The 422 message for a preview whose text columns together exceed `maxPreviewTextBytes`. */
const previewTooLarge = `the preview is larger than ${maxPreviewTextBytes} bytes in total`;

/** The string value of `fields[name]`, or null when it is absent (validated by `fieldsProblem`). */
function textField(fields: Record<string, unknown>, name: string): string | null {
  const value = fields[name];
  return typeof value === "string" ? value : null;
}

/** The query parameter `text` as an integer of 1 or more, or undefined when it is not one. */
function positiveInteger(text: string | null): number | undefined {
  const value = Math.trunc(Number(text));
  return value >= 1 ? value : undefined;
}

/** The page of a list that GitHub's `per_page` and `page` query parameters ask for. */
type ListPage = {
  /** The page size: the SQL LIMIT. */
  limit: number;
  /** The rows before this page: the SQL OFFSET. */
  offset: number;
  /** The 1-based page number. */
  page: number;
};

/** The `ListPage` of `url`. */
function listPage(url: URL): ListPage {
  // GitHub's default (30) and maximum (100) page sizes for the list endpoints.
  const limit = Math.min(positiveInteger(url.searchParams.get("per_page")) ?? 30, 100);
  // GitHub starts at the first page when `page` is absent.
  const page = positiveInteger(url.searchParams.get("page")) ?? 1;
  return { limit, offset: (page - 1) * limit, page };
}

/**
 * The JSON response for one page of a list. `items` holds up to one item more than the page
 * size, queried as LIMIT `limit + 1`; when that item exists, the response carries GitHub's
 * `Link: <...>; rel="next"` header, which `gh api --paginate` follows.
 */
function listResponse(url: URL, page: ListPage, items: unknown[]): Response {
  if (items.length <= page.limit) return Response.json(items);
  const nextUrl = new URL(url);
  nextUrl.searchParams.set("page", String(page.page + 1));
  return Response.json(items.slice(0, page.limit), {
    headers: { Link: `<${nextUrl}>; rel="next"` },
  });
}

/** The preview a comment route addresses, issue or pull request alike (as on GitHub). */
type CommentTarget = Pick<PreviewRow, "id" | "owner" | "repo" | "number" | "kind">;

/** The path parameters of the comment routes. */
type CommentPath = { owner: string; repo: string; number: string };

/** Selects the `CommentTarget` at `path`. */
function commentTargetStatement(db: D1Database, path: CommentPath): D1PreparedStatement {
  return db
    .prepare(
      "SELECT id, owner, repo, number, kind FROM previews WHERE owner = ?1 AND repo = ?2 AND number = ?3",
    )
    .bind(path.owner, path.repo, Number(path.number));
}

/**
 * `POST .../issues` and `POST .../pulls`: stores a new preview under the next number of its
 * `{owner}/{repo}` and writes a `created` event in the same batch. Answers 201 with the preview.
 */
async function createPreview(
  db: D1Database,
  request: Request,
  scope: PreviewScope,
): Promise<Response> {
  const fields = await readJsonObject(request);
  if (!fields) return githubError(400, "Problems parsing JSON");
  const problem = fieldsProblem(
    fields,
    scope.kind === "pull" ? ["title", "head", "base"] : ["title"],
  );
  if (problem) return githubError(422, problem);
  const pullField = (name: string) => (scope.kind === "pull" ? textField(fields, name) : null);
  const storedTexts = [
    scope.owner,
    scope.repo,
    textField(fields, "title"),
    textField(fields, "body"),
    pullField("head"),
    pullField("base"),
    pullField("diff"),
  ];
  if (storedTexts.reduce((total, text) => total + byteLength(text), 0) > maxPreviewTextBytes) {
    return githubError(422, previewTooLarge);
  }
  const [inserted] = await db.batch<PreviewRow>([
    db
      .prepare(
        `INSERT INTO previews (owner, repo, title, body, head, base, diff, kind, number)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, coalesce(max(number), 0) + 1
         FROM previews WHERE owner = ?1 AND repo = ?2
         RETURNING ${previewColumns}`,
      )
      .bind(...storedTexts, scope.kind),
    db.prepare("INSERT INTO events (kind) VALUES ('created')"),
  ]);
  const preview = inserted?.results[0];
  if (!preview) throw new Error("INSERT INTO previews returned no row");
  return Response.json(previewJson(new URL(request.url).origin, preview), { status: 201 });
}

/**
 * `GET .../issues` and `GET .../pulls`: previews of one kind, newest first, filtered by
 * GitHub's `state` query parameter (default `open`) and paged by `per_page` and `page`.
 */
async function listPreviews(
  db: D1Database,
  request: Request,
  scope: PreviewScope,
): Promise<Response> {
  const url = new URL(request.url);
  // GitHub lists open issues and pull requests unless `state` says otherwise.
  const state = url.searchParams.get("state") ?? "open";
  if (state !== "open" && state !== "closed" && state !== "all") {
    return githubError(422, "state must be open, closed, or all");
  }
  const page = listPage(url);
  const { results } = await db
    .prepare(
      `SELECT ${previewColumns} FROM previews
       WHERE owner = ?1 AND repo = ?2 AND kind = ?3 AND (?4 = 'all' OR state = ?4)
       ORDER BY number DESC LIMIT ?5 OFFSET ?6`,
    )
    .bind(scope.owner, scope.repo, scope.kind, state, page.limit + 1, page.offset)
    .all<PreviewRow>();
  return listResponse(url, page, results.map((preview) => previewJson(url.origin, preview)));
}

/**
 * `GET .../issues/{number}` and `GET .../pulls/{number}`: one preview. A pull request asked for
 * with `Accept: application/vnd.github.diff` answers its stored diff as text instead.
 */
async function getPreview(
  db: D1Database,
  request: Request,
  address: PreviewAddress,
): Promise<Response> {
  if (
    address.kind === "pull" &&
    request.headers.get("Accept")?.includes("application/vnd.github.diff")
  ) {
    const stored = await db
      .prepare(`SELECT diff FROM previews WHERE ${previewAddressCondition}`)
      .bind(address.owner, address.repo, Number(address.number), address.kind)
      .first<{ diff: string | null }>();
    return stored
      ? new Response(stored.diff ?? "", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        })
      : githubError(404, "Not Found");
  }
  const preview = await db
    .prepare(`SELECT ${previewColumns} FROM previews WHERE ${previewAddressCondition}`)
    .bind(address.owner, address.repo, Number(address.number), address.kind)
    .first<PreviewRow>();
  return preview
    ? Response.json(previewJson(new URL(request.url).origin, preview))
    : githubError(404, "Not Found");
}

/**
 * `PATCH .../issues/{number}` and `PATCH .../pulls/{number}`: changes the fields present in the
 * request (`title`, `body`, `state`, and `diff` for pull requests) and writes an `updated` event
 * in the same batch. A field sent as null is left unchanged.
 */
async function updatePreview(
  db: D1Database,
  request: Request,
  address: PreviewAddress,
): Promise<Response> {
  const fields = await readJsonObject(request);
  if (!fields) return githubError(400, "Problems parsing JSON");
  const problem = fieldsProblem(fields, []);
  if (problem) return githubError(422, problem);
  const stored = await db
    .prepare(
      `SELECT
         length(CAST(owner AS BLOB)) + length(CAST(repo AS BLOB))
           + coalesce(length(CAST(head AS BLOB)), 0)
           + coalesce(length(CAST(base AS BLOB)), 0) AS unchanged_bytes,
         length(CAST(title AS BLOB)) AS title_bytes,
         coalesce(length(CAST(body AS BLOB)), 0) AS body_bytes,
         coalesce(length(CAST(diff AS BLOB)), 0) AS diff_bytes
       FROM previews WHERE ${previewAddressCondition}`,
    )
    .bind(address.owner, address.repo, Number(address.number), address.kind)
    .first<{
      unchanged_bytes: number;
      title_bytes: number;
      body_bytes: number;
      diff_bytes: number;
    }>();
  if (!stored) return githubError(404, "Not Found");
  const title = textField(fields, "title");
  const body = textField(fields, "body");
  const diff = address.kind === "pull" ? textField(fields, "diff") : null;
  if (
    stored.unchanged_bytes +
      (title === null ? stored.title_bytes : byteLength(title)) +
      (body === null ? stored.body_bytes : byteLength(body)) +
      (diff === null ? stored.diff_bytes : byteLength(diff)) >
    maxPreviewTextBytes
  ) {
    return githubError(422, previewTooLarge);
  }
  const [, updated] = await db.batch<PreviewRow>([
    db
      .prepare(
        `INSERT INTO events (kind) SELECT 'updated'
         WHERE EXISTS (SELECT 1 FROM previews WHERE ${previewAddressCondition})`,
      )
      .bind(address.owner, address.repo, Number(address.number), address.kind),
    db
      .prepare(
        `UPDATE previews SET
           title = coalesce(?5, title),
           body = coalesce(?6, body),
           state = coalesce(?7, state),
           diff = coalesce(?8, diff),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE ${previewAddressCondition}
         RETURNING ${previewColumns}`,
      )
      .bind(
        address.owner,
        address.repo,
        Number(address.number),
        address.kind,
        title,
        body,
        textField(fields, "state"),
        diff,
      ),
  ]);
  const preview = updated?.results[0];
  return preview
    ? Response.json(previewJson(new URL(request.url).origin, preview))
    : githubError(404, "Not Found");
}

/**
 * `DELETE .../issues/{number}` and `DELETE .../pulls/{number}` (an extension; GitHub has no
 * such endpoint): removes the preview and its comments and writes a `deleted` event in the same
 * batch. Answers 204, or 404 when there was nothing to delete.
 */
async function deletePreview(db: D1Database, address: PreviewAddress): Promise<Response> {
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO events (kind) SELECT 'deleted'
         WHERE EXISTS (SELECT 1 FROM previews WHERE ${previewAddressCondition})`,
      )
      .bind(address.owner, address.repo, Number(address.number), address.kind),
    db
      .prepare(
        `DELETE FROM comments
         WHERE preview_id IN (SELECT id FROM previews WHERE ${previewAddressCondition})`,
      )
      .bind(address.owner, address.repo, Number(address.number), address.kind),
    db
      .prepare(`DELETE FROM previews WHERE ${previewAddressCondition} RETURNING id`)
      .bind(address.owner, address.repo, Number(address.number), address.kind),
  ]);
  return results[2]?.results.length
    ? new Response(null, { status: 204 })
    : githubError(404, "Not Found");
}

/**
 * `POST .../issues/{number}/comments`: adds a comment to an issue or a pull request. The target
 * is looked up and the comment inserted in one batch, so a preview deleted in between cannot
 * receive it.
 */
async function createComment(
  db: D1Database,
  request: Request,
  path: CommentPath,
): Promise<Response> {
  const fields = await readJsonObject(request);
  if (!fields) return githubError(400, "Problems parsing JSON");
  const problem = fieldsProblem(fields, ["body"]);
  if (problem) return githubError(422, problem);
  const [target, inserted] = await db.batch([
    commentTargetStatement(db, path),
    db
      .prepare(
        `INSERT INTO comments (preview_id, body)
         SELECT id, ?4 FROM previews WHERE owner = ?1 AND repo = ?2 AND number = ?3
         RETURNING id, body, created_at, updated_at`,
      )
      .bind(path.owner, path.repo, Number(path.number), textField(fields, "body")),
  ]);
  const preview = target?.results[0] as CommentTarget | undefined;
  const comment = inserted?.results[0] as CommentRow | undefined;
  if (!preview || !comment) return githubError(404, "Not Found");
  return Response.json(commentJson(new URL(request.url).origin, preview, comment), { status: 201 });
}

/** `GET .../issues/{number}/comments`: the comments of an issue or a pull request, oldest first. */
async function listComments(
  db: D1Database,
  request: Request,
  path: CommentPath,
): Promise<Response> {
  const preview = await commentTargetStatement(db, path).first<CommentTarget>();
  if (!preview) return githubError(404, "Not Found");
  const url = new URL(request.url);
  const page = listPage(url);
  const { results } = await db
    .prepare(
      "SELECT id, body, created_at, updated_at FROM comments WHERE preview_id = ?1 ORDER BY id LIMIT ?2 OFFSET ?3",
    )
    .bind(preview.id, page.limit + 1, page.offset)
    .all<CommentRow>();
  return listResponse(
    url,
    page,
    results.map((comment) => commentJson(url.origin, preview, comment)),
  );
}

/**
 * The GitHub-compatible REST routes under `/repos` (documents/PROJECT.md, GitHub API
 * compatibility). Every route requires the instance token.
 */
export const repos = new Hono<{ Bindings: Cloudflare.Env }>();

repos.use("/repos/*", requireToken);

repos.post("/repos/:owner/:repo/issues", (c) =>
  createPreview(c.env.DB, c.req.raw, { ...c.req.param(), kind: "issue" }),
);
repos.get("/repos/:owner/:repo/issues", (c) =>
  listPreviews(c.env.DB, c.req.raw, { ...c.req.param(), kind: "issue" }),
);
repos.get("/repos/:owner/:repo/issues/:number{[0-9]+}", (c) =>
  getPreview(c.env.DB, c.req.raw, { ...c.req.param(), kind: "issue" }),
);
repos.patch("/repos/:owner/:repo/issues/:number{[0-9]+}", (c) =>
  updatePreview(c.env.DB, c.req.raw, { ...c.req.param(), kind: "issue" }),
);
repos.delete("/repos/:owner/:repo/issues/:number{[0-9]+}", (c) =>
  deletePreview(c.env.DB, { ...c.req.param(), kind: "issue" }),
);
repos.post("/repos/:owner/:repo/issues/:number{[0-9]+}/comments", (c) =>
  createComment(c.env.DB, c.req.raw, c.req.param()),
);
repos.get("/repos/:owner/:repo/issues/:number{[0-9]+}/comments", (c) =>
  listComments(c.env.DB, c.req.raw, c.req.param()),
);

repos.post("/repos/:owner/:repo/pulls", (c) =>
  createPreview(c.env.DB, c.req.raw, { ...c.req.param(), kind: "pull" }),
);
repos.get("/repos/:owner/:repo/pulls", (c) =>
  listPreviews(c.env.DB, c.req.raw, { ...c.req.param(), kind: "pull" }),
);
repos.get("/repos/:owner/:repo/pulls/:number{[0-9]+}", (c) =>
  getPreview(c.env.DB, c.req.raw, { ...c.req.param(), kind: "pull" }),
);
repos.patch("/repos/:owner/:repo/pulls/:number{[0-9]+}", (c) =>
  updatePreview(c.env.DB, c.req.raw, { ...c.req.param(), kind: "pull" }),
);
repos.delete("/repos/:owner/:repo/pulls/:number{[0-9]+}", (c) =>
  deletePreview(c.env.DB, { ...c.req.param(), kind: "pull" }),
);
