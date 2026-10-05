import { Hono } from "hono";
import { githubError } from "./github-error";
import { repos } from "./repos";

const app = new Hono<{ Bindings: Cloudflare.Env }>();

app.get("/healthz", (c) => c.json({ ok: true }));
app.route("/", repos);
// `gh api --hostname <host>` treats the host as GitHub Enterprise Server and sends this prefix.
app.route("/api/v3", repos);

app.notFound(() => githubError(404, "Not Found"));
app.onError((error, c) => {
  // Path and error name only: messages can quote stored text (documents/PROJECT.md, Constraints).
  console.error(`${c.req.method} ${c.req.path} failed: ${error.name}`);
  return githubError(500, "Internal Server Error");
});

export default app;
