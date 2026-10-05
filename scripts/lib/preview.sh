# Functions shared by scripts/preview-pr.sh and scripts/preview-issue.sh. Source this file; it
# does not run anything by itself.

# Prints the arguments to stderr, prefixed with the script name, and exits 1.
preview_fail() {
  echo "$(basename "$0" .sh): $*" >&2
  exit 1
}

# Exits 1 unless PRE_GITHUB_HOST and GH_ENTERPRISE_TOKEN are set and jq is installed.
# gh reads GH_ENTERPRISE_TOKEN for every host other than github.com (`gh help environment`), so the
# token is required here instead of falling back to a stored `gh auth login`, which would be
# looked up for the pre-github host and fail with a less clear message.
preview_require_environment() {
  [ -n "${PRE_GITHUB_HOST:-}" ] || preview_fail "PRE_GITHUB_HOST is not set (the host of your pre-github instance)"
  [ -n "${GH_ENTERPRISE_TOKEN:-}" ] || preview_fail "GH_ENTERPRISE_TOKEN is not set (the PRE_GITHUB_TOKEN of your instance)"
  command -v jq >/dev/null 2>&1 || preview_fail "jq is required to build the request body"
}

# Sets PREVIEW_OWNER and PREVIEW_REPO from the given --owner and --repo values, filling the empty
# ones from the URL of the `origin` remote (https://host/<owner>/<repo>.git or
# git@host:<owner>/<repo>.git). Exits 1 when a value is still missing.
preview_resolve_repository() {
  PREVIEW_OWNER="$1"
  PREVIEW_REPO="$2"
  if [ -z "$PREVIEW_OWNER" ] || [ -z "$PREVIEW_REPO" ]; then
    local url
    url="$(git remote get-url origin 2>/dev/null)" ||
      preview_fail "--owner and --repo are required when there is no origin remote"
    url="${url%/}"
    url="${url%.git}"
    [ -n "$PREVIEW_REPO" ] || PREVIEW_REPO="${url##*/}"
    url="${url%/*}"
    [ -n "$PREVIEW_OWNER" ] || PREVIEW_OWNER="${url##*[/:]}"
  fi
  [ -n "$PREVIEW_OWNER" ] && [ -n "$PREVIEW_REPO" ] ||
    preview_fail "could not read owner and repo from the origin remote; pass --owner and --repo"
}

# POSTs the JSON on stdin to repos/<PREVIEW_OWNER>/<PREVIEW_REPO>/<collection> on PRE_GITHUB_HOST
# and prints the html_url of the created preview. Exits 1 when the request fails; gh prints the
# API's error message to stderr first.
# Not idempotent: every call creates a new preview with a new number, as POST does on GitHub. The
# scripts have no number to update, and re-sending after a fix is meant to produce a new page.
preview_send() {
  gh api --hostname "$PRE_GITHUB_HOST" --method POST \
    "repos/$PREVIEW_OWNER/$PREVIEW_REPO/$1" --input - --jq .html_url ||
    preview_fail "the request to $PRE_GITHUB_HOST failed"
}
