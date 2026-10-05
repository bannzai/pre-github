# pre-github

Self-hostable GitHub-compatible proxy to preview pull requests and issues before publishing.

Send a PR or an issue to your own pre-github instance with the same request you would send to GitHub. It stores the preview and renders it as a GitHub-looking page, highlights strings that look like personal information or secrets, and lets you delete the preview completely. When it looks right, send it to the real GitHub.

- **GitHub-compatible API (subset)**: `gh api --hostname <your-instance> repos/<owner>/<repo>/pulls ...` and `curl` work unchanged. PRs carry their diff as an extra `diff` field because there is no git server.
- **Preview pages**: Markdown body, per-file diff, comments, rendered like GitHub.
- **Leak highlight**: phone numbers, email addresses, home directory paths, and API-key-looking strings are marked on the page.
- **Delete**: one request or one button removes the preview from the database.

## Self-hosting

Requires Node.js 22.12 or later and a Cloudflare account (the free plan is enough).

```sh
git clone https://github.com/bannzai/pre-github.git
cd pre-github
npm ci
npx wrangler login
npx wrangler d1 create pre-github          # put the printed database_id into wrangler.jsonc
npx wrangler d1 migrations apply pre-github --remote
npx wrangler secret put PRE_GITHUB_TOKEN   # the only credential; choose a long random string
npx wrangler deploy
```

The deploy prints the URL of your instance (`https://pre-github.<account>.workers.dev`). Open it, enter the token once, and the pages are available in that browser.

## Usage

The scripts need `gh` and `jq`. Point them at your instance:

```sh
export PRE_GITHUB_HOST=pre-github.<account>.workers.dev
export GH_ENTERPRISE_TOKEN=<token>   # the PRE_GITHUB_TOKEN of your instance
```

Create a preview of a pull request from the current branch (`git diff <base>...HEAD` is sent as the diff):

```sh
scripts/preview-pr.sh --title "Add leak highlight" --body-file body.md \
  [--base origin/main] [--owner <owner>] [--repo <repo>]
```

Create a preview of an issue:

```sh
scripts/preview-issue.sh --title "Example" --body-file body.md [--owner <owner>] [--repo <repo>]
```

`--owner` and `--repo` default to the `origin` remote. Each script prints the `html_url` of the preview, and exits 1 with the reason on stderr when the token is missing, the branch has no changes, or the API returns an error. `--help` lists the options.

Open the URL, fix `body.md` and send again until the page looks right, then send the same title and body to the real GitHub:

```sh
gh pr create --title "Add leak highlight" --body-file body.md [--base <branch>] [--repo <owner>/<repo>]
gh issue create --title "Example" --body-file body.md [--repo <owner>/<repo>]
```

When the preview used `--base`, `--owner`, or `--repo`, pass the same branch to `--base` (a branch name such as `main`, not `origin/main`) and the same `<owner>/<repo>` to `--repo`, so the real GitHub gets the diff and repository you reviewed. `PRE_GITHUB_HOST` cannot be `github.com`; the scripts refuse it so a preview never goes to the real GitHub.

Or call the API directly:

```sh
GH_ENTERPRISE_TOKEN=<token> gh api --hostname pre-github.<account>.workers.dev \
  repos/bannzai/pre-github/issues -f title='Example' -F body=@body.md
```

The response contains `html_url`. Open it to see the preview.

## Data handling

Your instance stores only what you send it (titles, bodies, diffs, comments) in your own D1 database, plus an `events` table with event kinds and timestamps for your own usage statistics. It makes no outbound requests, has no telemetry, and does not log request bodies. Deleting a preview removes it from the database.

## Development

How changes are verified is in [AGENTS.md](AGENTS.md). Requirements and constraints are in [documents/PROJECT.md](documents/PROJECT.md).

## Contact

bannzai.app@gmail.com

## License

[MIT](LICENSE)
