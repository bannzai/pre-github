import { createMiddleware } from "hono/factory";
import { githubError } from "./github-error";

/** SHA-256 of `text`. Hashing first makes tokens of any length comparable as equal-length buffers. */
async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

/**
 * Lets a request through only when its `Authorization: Bearer <token>` or
 * `Authorization: token <token>` header carries `PRE_GITHUB_TOKEN`, compared in constant time.
 * Otherwise answers 401 in GitHub's shape. An instance without the secret rejects every request.
 */
export const requireToken = createMiddleware<{ Bindings: Cloudflare.Env }>(async (c, next) => {
  const presentedToken = /^(?:bearer|token) +(\S+)$/i.exec(
    c.req.header("Authorization") ?? "",
  )?.[1];
  if (
    !presentedToken ||
    !c.env.PRE_GITHUB_TOKEN ||
    !crypto.subtle.timingSafeEqual(
      await sha256(presentedToken),
      await sha256(c.env.PRE_GITHUB_TOKEN),
    )
  ) {
    return githubError(401, "Bad credentials");
  }
  await next();
});
