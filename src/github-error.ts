/**
 * An error response in GitHub's shape, `{ "message": "...", "documentation_url": "..." }`
 * (documents/PROJECT.md, GitHub API compatibility).
 */
export function githubError(status: 400 | 401 | 404 | 422 | 500, message: string): Response {
  // GitHub's own generic errors (Bad credentials, Not Found) point to the REST docs root.
  return Response.json({ message, documentation_url: "https://docs.github.com/rest" }, { status });
}
