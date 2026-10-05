#!/usr/bin/env bash
# Sends the current branch as a pull request preview to a pre-github instance and prints the URL
# of the preview page. Run `scripts/preview-pr.sh --help` for the options.
set -euo pipefail

. "$(dirname "$0")/lib/preview.sh"

# Prints the options and environment variables to stdout.
usage() {
  cat <<'EOF'
Usage: scripts/preview-pr.sh --title <title> [--body-file <file>] [--base <ref>] [--owner <owner>] [--repo <repo>]

Sends `git diff <base>...HEAD` with the title and body to a pre-github instance as a pull request
preview and prints its html_url.

Options:
  --title <title>      Title of the pull request (required)
  --body-file <file>   File with the Markdown body (default: empty body)
  --base <ref>         Ref the branch is compared with (default: origin/main)
  --owner <owner>      Owner label in the preview URL (default: from the origin remote)
  --repo <repo>        Repository label in the preview URL (default: from the origin remote)
  -h, --help           Show this help

Environment:
  PRE_GITHUB_HOST      Host of your instance, e.g. pre-github.<account>.workers.dev
  GH_ENTERPRISE_TOKEN  PRE_GITHUB_TOKEN of your instance

Requires gh and jq. Exits 1 with the reason on stderr when a value is missing, the branch has no
changes against the base, or the API returns an error.
EOF
}

title=""
body_file=""
# origin/main rather than main: the comparison should be against what is published, not a local
# main that may be behind or ahead of it.
base="origin/main"
owner=""
repo=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --title | --body-file | --base | --owner | --repo)
      [ $# -ge 2 ] || preview_fail "$1 needs a value"
      case "$1" in
        --title) title="$2" ;;
        --body-file) body_file="$2" ;;
        --base) base="$2" ;;
        --owner) owner="$2" ;;
        --repo) repo="$2" ;;
      esac
      shift 2
      ;;
    *) preview_fail "unknown argument: $1 (see --help)" ;;
  esac
done

preview_require_environment
[ -n "$title" ] || preview_fail "--title is required"
[ -z "$body_file" ] || [ -f "$body_file" ] || preview_fail "body file not found: $body_file"
git rev-parse --verify --quiet "$base^{commit}" >/dev/null || preview_fail "base not found: $base"
head="$(git symbolic-ref --short --quiet HEAD)" || preview_fail "HEAD is detached; check out a branch"
if git diff --quiet "$base...HEAD"; then
  preview_fail "no changes between $base and HEAD"
fi
preview_resolve_repository "$owner" "$repo"

# GitHub's base.ref is a branch name, so a remote-tracking base such as origin/main is sent as main.
base_ref="$(git rev-parse --symbolic-full-name "$base")"
case "$base_ref" in
  refs/remotes/*) base_ref="${base_ref#refs/remotes/*/}" ;;
  refs/heads/*) base_ref="${base_ref#refs/heads/}" ;;
  *) base_ref="$base" ;;
esac

jq -n \
  --arg title "$title" \
  --rawfile body "${body_file:-/dev/null}" \
  --arg head "$head" \
  --arg base "$base_ref" \
  --rawfile diff <(git diff --no-color --no-ext-diff "$base...HEAD") \
  '{title: $title, body: $body, head: $head, base: $base, diff: $diff}' |
  preview_send pulls
