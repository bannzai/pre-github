#!/usr/bin/env bash
# Sends an issue preview to a pre-github instance and prints the URL of the preview page. Run
# `scripts/preview-issue.sh --help` for the options.
set -euo pipefail

. "$(dirname "$0")/lib/preview.sh"

# Prints the options and environment variables to stdout.
usage() {
  cat <<'EOF'
Usage: scripts/preview-issue.sh --title <title> [--body-file <file>] [--owner <owner>] [--repo <repo>]

Sends the title and body to a pre-github instance as an issue preview and prints its html_url.

Options:
  --title <title>      Title of the issue (required)
  --body-file <file>   File with the Markdown body (default: empty body)
  --owner <owner>      Owner label in the preview URL (default: from the origin remote)
  --repo <repo>        Repository label in the preview URL (default: from the origin remote)
  -h, --help           Show this help

Environment:
  PRE_GITHUB_HOST      Host of your instance, e.g. pre-github.<account>.workers.dev
  GH_ENTERPRISE_TOKEN  PRE_GITHUB_TOKEN of your instance

Requires gh and jq. Exits 1 with the reason on stderr when a value is missing or the API returns
an error.
EOF
}

title=""
body_file=""
owner=""
repo=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --title | --body-file | --owner | --repo)
      [ $# -ge 2 ] || preview_fail "$1 needs a value"
      case "$1" in
        --title) title="$2" ;;
        --body-file) body_file="$2" ;;
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
preview_resolve_repository "$owner" "$repo"

jq -n \
  --arg title "$title" \
  --rawfile body "${body_file:-/dev/null}" \
  '{title: $title, body: $body}' |
  preview_send issues
