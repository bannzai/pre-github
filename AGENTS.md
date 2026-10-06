# pre-github

Self-hostable GitHub-compatible proxy (Hono on Cloudflare Workers, D1) that stores pull requests and issues sent to it and renders them as GitHub-looking preview pages. Open source (MIT). Documents in the repository and code comments are written in English; `documents/DIRECTION.md` follows the castle template and is in Japanese.

## Documents

- `documents/DIRECTION.md`: why this exists, how success is judged, and the MVP feature list. Questions it does not answer are decided by the agent and recorded in its "決めたこと" table
- `documents/PROJECT.md`: requirements and constraints. Update it in the same change that alters a design decision

## Verification

Building, testing, and opening a browser happen on an external machine, not on the development machine, to keep the development machine's load down.

- pre-github is a public repository, so the external machine is GitHub Actions (`.github/workflows/ci.yml`; free for public repositories). simtunnel is for iOS / macOS apps and does not apply. If the repository ever becomes private, use a Devin session (devin-macos-e2e skill) instead of GitHub Actions
- Do not run on the development machine: `npm ci` / `npm install` (without `--package-lock-only`), `wrangler dev`, `wrangler deploy`, the unit tests, Playwright, or a local browser (agent-browser without `--cdp`). Editing files, `git`, `gh`, and `npm install --package-lock-only` (resolves dependencies without installing or building) are fine
- Push the branch and open a PR; CI runs per PR. For a branch without a PR: `gh workflow run ci.yml --ref <branch>`
- The CI steps are the verification commands: `npm ci` → `npm run lint` → `npm run format:check` → `npm run typecheck` → `npm test` → `npm run build` (`wrangler deploy --dry-run`) → `npm run test:e2e`
- `make` with no arguments runs the same checks after `npm ci` (the `verify` target in `Makefile`, which is also the default target). Use it only on a machine where running them is allowed, such as the external machine above
- Wait for and read the result: `gh pr checks <PR> --watch`. Failures: `gh run view <run ID> --log-failed`
- Looking at pages: the `e2e` job uploads Playwright's output (including screenshots) as the `e2e-screenshots` artifact. Fetch it with `gh run download <run ID> -n e2e-screenshots -D ./tmp/e2e-screenshots-<run ID>` and Read the PNG files
- When adding page behaviour, drive that page in an E2E test under `e2e/tests/` and save a screenshot with `testInfo.outputPath(...)`. That screenshot is the evidence of the change
- Unit tests run inside the Workers runtime (`@cloudflare/vitest-plugin`) against a local D1 with the migrations in `migrations/` applied. E2E starts `wrangler dev` on the runner with a local D1
- To operate a page by hand instead of through a test, use the `webtunnel` skill, which drives Chromium on a GitHub Actions runner. Start a session with `WEBTUNNEL_REPO=bannzai/pre-github`; the runner applies the migrations to a local D1 and starts `wrangler dev` (`.github/workflows/browser-session.yml`). This repository is public, so the recording and screenshots of the session are public artifacts: never send a real PR body or a real secret to that session
- Deploying bannzai's own instance is `.github/workflows/deploy.yml`, run by hand (`workflow_dispatch`) only. Merging to `main` does not deploy

## Rules

Coding conventions distributed from castle and project rules are in `.claude/rules/`. The D1 schema, migrations, and query rules are in `.claude/rules/d1-database.md`.

<!-- ai-review-config begin -->
<!--
このブロックは自動生成です。直接編集せず、テンプレートを更新してから再生成してください。
内容は AI コードレビュー時の挙動指示であり、コードベース自体への規約ではありません。
-->

## レビュー時の応答スタイル

- 応答は日本語で行う

## レビュー範囲外

以下は自動レビューで指摘しない (別の検出経路があるため):

- コンパイルエラー・型エラー (ローカル/CI のビルドで検出される)
- Lint/フォーマット違反 (リンター・フォーマッターで検出される)
<!-- ai-review-config end -->
