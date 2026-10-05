# pre-github

A self-hostable proxy that accepts a subset of the GitHub REST API, stores the pull requests and issues it receives, and renders them as GitHub-looking HTML pages. You send a PR or an issue here first, look at it exactly as it would appear on GitHub, fix or delete it, and only then send it to the real GitHub.

Why it exists, how success is judged, and the MVP feature list live in [DIRECTION.md](DIRECTION.md) (Japanese; the product-direction document that every later decision refers to). This file holds the requirements and constraints the implementation must keep.

## How it is used

1. Deploy your own instance to Cloudflare Workers (see the README). One instance belongs to one person.
2. Create a preview with the same request you would send to GitHub, pointed at your instance:

   ```sh
   gh api --hostname pre-github.example.workers.dev repos/bannzai/pre-github/pulls \
     -f title='Add leak highlight' -F body=@body.md -f head=feature -f base=main -F diff=@changes.diff
   ```

   or with `scripts/preview-pr.sh`, which builds `title`, `body`, and `diff` from the current branch.
3. Open the `html_url` in the response. The page renders the Markdown body and the diff the way GitHub does, and highlights strings that look like personal information or secrets.
4. Fix the body and re-send, or delete the preview. When you are satisfied, send the same title and body to the real GitHub with `gh pr create` / `gh issue create`.

## GitHub API compatibility

pre-github speaks a subset of the GitHub REST API. The goal is that `gh api --hostname <host> ...`, `curl`, and existing scripts work without changes to the request shape.

| Method and path | GitHub behaviour kept | Notes |
| --- | --- | --- |
| `POST /repos/{owner}/{repo}/issues` | request fields `title`, `body`, `labels`; response fields `id`, `number`, `title`, `body`, `state`, `html_url`, `created_at`, `updated_at` | `labels` is accepted and ignored (not stored, not returned) |
| `GET /repos/{owner}/{repo}/issues` and `/issues/{number}` | list and single issue; `state` (default `open`), `per_page` (default 30, max 100), `page`, with GitHub's defaults | list returns newest first. Unlike GitHub, the issue endpoints other than comments do not return pull requests |
| `PATCH /repos/{owner}/{repo}/issues/{number}` | `title`, `body`, `state` | |
| `POST /repos/{owner}/{repo}/pulls` | request fields `title`, `body`, `head`, `base`; response fields as above plus `head.ref`, `base.ref` | extension: `diff` (unified diff text) because there is no git server |
| `GET /repos/{owner}/{repo}/pulls` and `/pulls/{number}` | list and single PR | `GET .../pulls/{number}` with `Accept: application/vnd.github.diff` returns the stored diff |
| `PATCH /repos/{owner}/{repo}/pulls/{number}` | `title`, `body`, `state` | extension: `diff` |
| `POST /repos/{owner}/{repo}/issues/{number}/comments` | `body` | works for PRs too, as on GitHub |
| `DELETE /repos/{owner}/{repo}/issues/{number}` and `/pulls/{number}` | not on GitHub | extension: removes the preview and its comments |

- Every path is also served under `/api/v3/`, which is the prefix `gh` uses for GitHub Enterprise Server hosts. `GH_HOST=<host> gh api repos/...` therefore reaches the same handlers.
- `{owner}` and `{repo}` are free-form labels. pre-github does not know about real repositories; they only group previews and build `html_url`.
- Errors use GitHub's shape: `{ "message": "...", "documentation_url": "..." }` with 400, 401, 404, 422, 500.
- Anything outside the table returns 404 with that error shape. The server never forwards requests to github.com.

## HTML pages

- `/{owner}/{repo}/issues/{number}` and `/{owner}/{repo}/pull/{number}` render the stored preview. `/{owner}/{repo}/issues` and `/{owner}/{repo}/pulls` list them.
- Markdown is rendered as GitHub Flavored Markdown (tables, task lists, fenced code with language hint, autolinks, images by URL). Raw HTML in the body is escaped, not executed.
- The PR page shows the diff per file with added and removed lines coloured, and the file list with counts.
- The leak highlight runs over the body, the comments, and the diff. Patterns (specific regexes are the agent's choice, recorded in code): phone numbers, email addresses, absolute home paths (`/Users/<name>`, `/home/<name>`), and strings that look like API keys or tokens. The page shows the count at the top and marks each match inline.
- The page has a delete button. Deleting calls the `DELETE` API.
- Pages are protected by the same token as the API, through a login page that stores a session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`). Without the cookie the pages return the login page and nothing else.

## Data

- Storage is Cloudflare D1 only. Schema and migrations live in `migrations/` (`.claude/rules/d1-database.md`).
- Tables hold previews (issues and pull requests share numbering per `{owner}/{repo}`, as on GitHub), comments, and `events` (`kind` is `created` / `updated` / `deleted`, with the timestamp only; no title or body). `events` is the measurement source in DIRECTION.md.
- Deletion is a hard delete. Nothing is kept after `DELETE` except the `events` row. Because no counter survives, deleting the newest preview of a `{owner}/{repo}` lets the next preview reuse its number.
- A `body` or `diff` over 1,000,000 bytes is rejected with 422, and so is a preview whose text columns together exceed 1,990,000 bytes (D1 rejects rows over 2,000,000 bytes).
- List responses carry GitHub's `Link: <...>; rel="next"` header when another page exists, so `gh api --paginate` reads every page.
- Images are referenced by URL. Uploads are out of scope for the MVP.

## Constraints

- **One token per instance**: `PRE_GITHUB_TOKEN` (a Worker secret) is the only credential. There are no users or roles. Compare it in constant time.
- **No telemetry**: the Worker makes no outbound requests. The only measurement is the local `events` table.
- **No request bodies in logs**: previews exist precisely because they may contain things that must not leak. Log paths, status codes, and numbers only.
- **Self-contained deployment**: `wrangler.jsonc` plus one secret and one D1 database must be enough. No other Cloudflare products are required.
- **Compatible shapes over compatible breadth**: when a field in the table above exists on GitHub, keep GitHub's name and type. Do not add fields with GitHub-like names that behave differently.

## Infrastructure decisions

| Area | Decision | Reason |
| --- | --- | --- |
| Hosting | Cloudflare Workers, deployed by each person with `wrangler deploy` | Chosen in the launch config ( https://github.com/bannzai/IdeaMemo/issues/172 ); free tier is enough for one person |
| Database | D1 | SQLite semantics, one binding, local emulation in tests |
| File storage | None (image URLs only) | Uploads are not needed to preview a PR body |
| Authentication | One bearer token, cookie session for pages | One instance serves one person |
| Analytics | None. Measurement is the `events` table and GitHub stars | Nothing leaves the instance |
| Alerts (GCP, Crashlytics), billing, store distribution | Not applicable | No cloud project of those kinds, no mobile app, no payment |
| Terms, privacy policy, landing page | Not created. The README covers data handling | bannzai operates no service for third parties; each person hosts their own |

## Verification

How to build, test, and look at the pages is in [AGENTS.md](../AGENTS.md). In short: nothing is built or run on the development machine. GitHub Actions runs lint, type check, unit tests against a local D1, `wrangler deploy --dry-run`, and Playwright E2E that stores screenshots as an artifact. Manual browser checks use the webtunnel workflow on a GitHub Actions runner.
