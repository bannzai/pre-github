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

Create a preview of a pull request from the current branch:

```sh
PRE_GITHUB_HOST=pre-github.<account>.workers.dev GH_ENTERPRISE_TOKEN=<token> \
  scripts/preview-pr.sh --base main --title "Add leak highlight" --body-file body.md
```

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
