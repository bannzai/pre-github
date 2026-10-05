#!/usr/bin/env bash
# Tests scripts/preview-pr.sh and scripts/preview-issue.sh in a throwaway git repository, with
# scripts/test/bin/gh first on PATH so no request leaves the machine. Exits 1 when a check fails.
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
repo="$work/repo"
failures=0

# Records a failed check without stopping, so one run reports every failure.
fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

# Checks that the actual value $2 equals the expected value $3; $1 names the check.
assert_equal() {
  [ "$2" = "$3" ] || fail "$1: expected [$3], got [$2]"
}

# Checks that the text $2 contains $3; $1 names the check.
assert_contains() {
  case "$2" in
    *"$3"*) ;;
    *) fail "$1: [$2] does not contain [$3]" ;;
  esac
}

# Directory inside the fixture repository that run() executes the command in.
run_dir="$repo"

# Runs the command in $run_dir with the gh stub and a complete environment (both can be
# overridden by starting the command with `env`). Sets $out, $err, and $status, and clears what
# the stub recorded on the previous run.
run() {
  : >"$work/args"
  : >"$work/input.json"
  set +e
  (
    cd "$run_dir"
    PATH="$scripts_dir/test/bin:$PATH" PRE_GITHUB_HOST=preview.example.com \
      GH_ENTERPRISE_TOKEN=test-token GH_STUB_DIR="$work" "$@"
  ) >"$work/out" 2>"$work/err"
  status=$?
  set -e
  out="$(cat "$work/out")"
  err="$(cat "$work/err")"
}

# Prints the jq filter $1 applied to the JSON the stub received.
sent() {
  jq -r "$1" "$work/input.json" 2>/dev/null || echo "<no JSON was sent>"
}

# Prints the arguments, one per line, in the form the stub records them.
lines() {
  printf '%s\n' "$@"
}

# Commits in the fixture repository with a fixed identity, because CI runners have none configured.
git_commit() {
  git -C "$repo" -c user.name=test -c user.email=test@example.com commit -q "$@"
}

git init -q -b main "$repo"
git -C "$repo" remote add origin https://github.com/example-owner/example-repo.git
echo one >"$repo/file.txt"
git -C "$repo" add file.txt
git_commit -m "first"
git -C "$repo" update-ref refs/remotes/origin/main HEAD
git -C "$repo" checkout -q -b feature
echo two >>"$repo/file.txt"
git_commit -am "second"
git -C "$repo" diff origin/main...HEAD >"$work/expected.diff"
printf '## Summary\n\nLine with `code`\n' >"$work/body.md"

# --help
run "$scripts_dir/preview-pr.sh" --help
assert_equal "pr --help: status" "$status" 0
assert_contains "pr --help: usage" "$out" "Usage: scripts/preview-pr.sh"
assert_equal "pr --help: gh is not called" "$(cat "$work/args")" ""
run "$scripts_dir/preview-issue.sh" --help
assert_equal "issue --help: status" "$status" 0
assert_contains "issue --help: usage" "$out" "Usage: scripts/preview-issue.sh"
assert_equal "issue --help: gh is not called" "$(cat "$work/args")" ""

# Pull request with the default base, owner, and repo
run "$scripts_dir/preview-pr.sh" --title "Add leak highlight" --body-file "$work/body.md"
assert_equal "pr: status" "$status" 0
assert_equal "pr: prints html_url" "$out" "https://preview.example.com/created"
assert_equal "pr: gh arguments" "$(cat "$work/args")" "$(lines api --hostname preview.example.com \
  --method POST repos/example-owner/example-repo/pulls --input - --jq .html_url)"
assert_equal "pr: JSON keys" "$(sent 'keys | join(",")')" "base,body,diff,head,title"
assert_equal "pr: title" "$(sent .title)" "Add leak highlight"
assert_equal "pr: body" "$(jq --rawfile expected "$work/body.md" '.body == $expected' "$work/input.json")" true
assert_equal "pr: head" "$(sent .head)" feature
assert_equal "pr: base" "$(sent .base)" main
assert_equal "pr: diff" "$(jq --rawfile expected "$work/expected.diff" '.diff == $expected' "$work/input.json")" true

# The diff keeps the a/ b/ format under a user's diff.noprefix and diff.mnemonicPrefix
git -C "$repo" config diff.noprefix true
git -C "$repo" config diff.mnemonicPrefix true
run "$scripts_dir/preview-pr.sh" --title "No prefix config"
assert_equal "pr with diff prefix config: status" "$status" 0
assert_equal "pr with diff prefix config: diff" \
  "$(jq --rawfile expected "$work/expected.diff" '.diff == $expected' "$work/input.json")" true
git -C "$repo" config --unset diff.noprefix
git -C "$repo" config --unset diff.mnemonicPrefix

# The diff covers the whole repository when run from a subdirectory under diff.relative
git -C "$repo" config diff.relative true
mkdir "$repo/sub"
run_dir="$repo/sub"
run "$scripts_dir/preview-pr.sh" --title "Relative config"
assert_equal "pr from subdirectory with diff.relative: status" "$status" 0
assert_equal "pr from subdirectory with diff.relative: diff" \
  "$(jq --rawfile expected "$work/expected.diff" '.diff == $expected' "$work/input.json")" true
run_dir="$repo"
git -C "$repo" config --unset diff.relative

# Pull request with explicit base, owner, and repo, and no body file
run "$scripts_dir/preview-pr.sh" --title "Explicit" --base main --owner other-owner --repo other-repo
assert_equal "pr explicit: status" "$status" 0
assert_contains "pr explicit: path" "$(cat "$work/args")" "repos/other-owner/other-repo/pulls"
assert_equal "pr explicit: base" "$(sent .base)" main
assert_equal "pr explicit: empty body" "$(sent .body)" ""

# Pull request failures
run env GH_ENTERPRISE_TOKEN= "$scripts_dir/preview-pr.sh" --title "No token"
assert_equal "pr without token: status" "$status" 1
assert_contains "pr without token: reason" "$err" "GH_ENTERPRISE_TOKEN is not set"
assert_equal "pr without token: gh is not called" "$(cat "$work/args")" ""

run env PRE_GITHUB_HOST= "$scripts_dir/preview-pr.sh" --title "No host"
assert_equal "pr without host: status" "$status" 1
assert_contains "pr without host: reason" "$err" "PRE_GITHUB_HOST is not set"

for host in https://preview.example.com preview.example.com/ user@preview.example.com; do
  run env PRE_GITHUB_HOST="$host" "$scripts_dir/preview-pr.sh" --title "Not a host name"
  assert_equal "pr to $host: status" "$status" 1
  assert_contains "pr to $host: reason" "$err" "must be a host name"
  assert_equal "pr to $host: gh is not called" "$(cat "$work/args")" ""
done

for host in GitHub.com api.github.com github.com. github.com:443 example.ghe.com; do
  run env PRE_GITHUB_HOST="$host" "$scripts_dir/preview-pr.sh" --title "Real GitHub"
  assert_equal "pr to $host: status" "$status" 1
  assert_contains "pr to $host: reason" "$err" "not a GitHub host"
  assert_equal "pr to $host: gh is not called" "$(cat "$work/args")" ""
done

run env PRE_GITHUB_HOST=github.com "$scripts_dir/preview-issue.sh" --title "Real GitHub"
assert_equal "issue to github.com: status" "$status" 1
assert_equal "issue to github.com: gh is not called" "$(cat "$work/args")" ""

run "$scripts_dir/preview-pr.sh"
assert_equal "pr without title: status" "$status" 1
assert_contains "pr without title: reason" "$err" "--title is required"

git -C "$repo" checkout -q -b unchanged origin/main
run "$scripts_dir/preview-pr.sh" --title "No changes"
assert_equal "pr without changes: status" "$status" 1
assert_contains "pr without changes: reason" "$err" "no changes between origin/main and HEAD"
assert_equal "pr without changes: gh is not called" "$(cat "$work/args")" ""
git -C "$repo" checkout -q feature

# A base with no common ancestor makes git diff fail, as in a shallow clone
git -C "$repo" update-ref refs/remotes/origin/unrelated "$(git -C "$repo" -c user.name=test \
  -c user.email=test@example.com commit-tree "$(git -C "$repo" hash-object -w -t tree /dev/null)" \
  -m unrelated)"
run "$scripts_dir/preview-pr.sh" --title "No merge base" --base origin/unrelated
assert_equal "pr without merge base: status" "$status" 1
assert_contains "pr without merge base: reason" "$err" "could not compute git diff origin/unrelated...HEAD"
assert_equal "pr without merge base: gh is not called" "$(cat "$work/args")" ""

run env GH_STUB_FAIL=1 "$scripts_dir/preview-pr.sh" --title "API error"
assert_equal "pr with API error: status" "$status" 1
assert_contains "pr with API error: gh message" "$err" "Not Found (HTTP 404)"
assert_contains "pr with API error: reason" "$err" "the request to preview.example.com failed"
assert_equal "pr with API error: no URL" "$out" ""

# Issue
run "$scripts_dir/preview-issue.sh" --title "Example issue" --body-file "$work/body.md"
assert_equal "issue: status" "$status" 0
assert_equal "issue: prints html_url" "$out" "https://preview.example.com/created"
assert_equal "issue: gh arguments" "$(cat "$work/args")" "$(lines api --hostname preview.example.com \
  --method POST repos/example-owner/example-repo/issues --input - --jq .html_url)"
assert_equal "issue: JSON keys" "$(sent 'keys | join(",")')" "body,title"
assert_equal "issue: title" "$(sent .title)" "Example issue"
assert_equal "issue: body" "$(jq --rawfile expected "$work/body.md" '.body == $expected' "$work/input.json")" true

run env GH_ENTERPRISE_TOKEN= "$scripts_dir/preview-issue.sh" --title "No token"
assert_equal "issue without token: status" "$status" 1
assert_contains "issue without token: reason" "$err" "GH_ENTERPRISE_TOKEN is not set"
assert_equal "issue without token: gh is not called" "$(cat "$work/args")" ""

run env GH_STUB_FAIL=1 "$scripts_dir/preview-issue.sh" --title "API error"
assert_equal "issue with API error: status" "$status" 1
assert_contains "issue with API error: reason" "$err" "the request to preview.example.com failed"

# Owner and repo from an SSH remote URL
git -C "$repo" remote set-url origin git@github.com:ssh-owner/ssh-repo.git
run "$scripts_dir/preview-issue.sh" --title "SSH remote"
assert_equal "issue from SSH remote: status" "$status" 0
assert_contains "issue from SSH remote: path" "$(cat "$work/args")" "repos/ssh-owner/ssh-repo/issues"

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed" >&2
  exit 1
fi
echo "all checks passed"
