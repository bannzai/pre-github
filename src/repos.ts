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

/**
 * D1 limits the size of a row (.claude/rules/d1-database.md). A body or diff above this many
 * bytes is refused with 422 instead of failing the insert or being truncated.
 */
const maxTextBytes = 1_000_000;

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
    if (new TextEncoder().encode(value).byteLength > maxTextBytes) {
      return `${name} is larger than ${maxTextBytes} bytes`;
    }
  }
  if (fields.state !== undefined && fields.state !== "open" && fields.state !== "closed") {
    return "state must be open or closed";
  }
  return undefined;
}

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

/** LIMIT and OFFSET for GitHub's `per_page` and `page` query parameters. */
function listWindow(url: URL): { limit: number; offset: number } {
  // GitHub's default (30) and maximum (100) page sizes for the list endpoints.
  const limit = Math.min(positiveInteger(url.searchParams.get("per_page")) ?? 30, 100);
  return { limit, offset: ((positiveInteger(url.searchParams.get("page")) ?? 1) - 1) * limit };
}

/** The preview a comment route addresses, issue or pull request alike (as on GitHub). */
function findCommentTarget(db: D1Database, owner: string, repo: string, number: string) {
  return db
    .prepare(
      "SELECT id, owner, repo, number, kind FROM previews WHERE owner = ?1 AND repo = ?2 AND number = ?3",
    )
    .bind(owner, repo, Number(number))
    .first<Pick<PreviewRow, "id" | "owner" | "repo" | "number" | "kind">>();
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
  const [inserted] = await db.batch<PreviewRow>([
    db
      .prepare(
        `INSERT INTO previews (owner, repo, number, kind, title, body, head, base, diff)
         SELECT ?1, ?2, coalesce(max(number), 0) + 1, ?3, ?4, ?5, ?6, ?7, ?8
         FROM previews WHERE owner = ?1 AND repo = ?2
         RETURNING ${previewColumns}`,
      )
      .bind(
        scope.owner,
        scope.repo,
        scope.kind,
        textField(fields, "title"),
        textField(fields, "body"),
        scope.kind === "pull" ? textField(fields, "head") : null,
        scope.kind === "pull" ? textField(fields, "base") : null,
        scope.kind === "pull" ? textField(fields, "diff") : null,
      ),
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
  const { limit, offset } = listWindow(url);
  const { results } = await db
    .prepare(
      `SELECT ${previewColumns} FROM previews
       WHERE owner = ?1 AND repo = ?2 AND kind = ?3 AND (?4 = 'all' OR state = ?4)
       ORDER BY number DESC LIMIT ?5 OFFSET ?6`,
    )
    .bind(scope.owner, scope.repo, scope.kind, state, limit, offset)
    .all<PreviewRow>();
  return Response.json(results.map((preview) => previewJson(url.origin, preview)));
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
        textField(fields, "title"),
        textField(fields, "body"),
        textField(fields, "state"),
        address.kind === "pull" ? textField(fields, "diff") : null,
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

/** `POST .../issues/{number}/comments`: adds a comment to an issue or a pull request. */
async function createComment(
  db: D1Database,
  request: Request,
  path: { owner: string; repo: string; number: string },
): Promise<Response> {
  const preview = await findCommentTarget(db, path.owner, path.repo, path.number);
  if (!preview) return githubError(404, "Not Found");
  const fields = await readJsonObject(request);
  if (!fields) return githubError(400, "Problems parsing JSON");
  const problem = fieldsProblem(fields, ["body"]);
  if (problem) return githubError(422, problem);
  const comment = await db
    .prepare(
      "INSERT INTO comments (preview_id, body) VALUES (?1, ?2) RETURNING id, body, created_at, updated_at",
    )
    .bind(preview.id, textField(fields, "body"))
    .first<CommentRow>();
  if (!comment) throw new Error("INSERT INTO comments returned no row");
  return Response.json(commentJson(new URL(request.url).origin, preview, comment), { status: 201 });
}

/** `GET .../issues/{number}/comments`: the comments of an issue or a pull request, oldest first. */
async function listComments(
  db: D1Database,
  request: Request,
  path: { owner: string; repo: string; number: string },
): Promise<Response> {
  const preview = await findCommentTarget(db, path.owner, path.repo, path.number);
  if (!preview) return githubError(404, "Not Found");
  const url = new URL(request.url);
  const { limit, offset } = listWindow(url);
  const { results } = await db
    .prepare(
      "SELECT id, body, created_at, updated_at FROM comments WHERE preview_id = ?1 ORDER BY id LIMIT ?2 OFFSET ?3",
    )
    .bind(preview.id, limit, offset)
    .all<CommentRow>();
  return Response.json(results.map((comment) => commentJson(url.origin, preview, comment)));
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
