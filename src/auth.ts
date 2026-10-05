import { createMiddleware } from "hono/factory";
import { githubError } from "./github-error";

/** SHA-256 of `text`. Hashing first makes tokens of any length comparable as equal-length buffers. */
async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

/**
 * Whether `presentedToken` is the instance's `PRE_GITHUB_TOKEN`, compared in constant time. An
 * instance without the secret matches no token.
 */
export async function isInstanceToken(
  env: Cloudflare.Env,
  presentedToken: string,
): Promise<boolean> {
  return (
    env.PRE_GITHUB_TOKEN !== undefined &&
    env.PRE_GITHUB_TOKEN !== "" &&
    crypto.subtle.timingSafeEqual(await sha256(presentedToken), await sha256(env.PRE_GITHUB_TOKEN))
  );
}

/**
 * Lets a request through only when its `Authorization: Bearer <token>` or
 * `Authorization: token <token>` header carries `PRE_GITHUB_TOKEN` (`isInstanceToken`).
 * Otherwise answers 401 in GitHub's shape.
 */
export const requireToken = createMiddleware<{ Bindings: Cloudflare.Env }>(async (c, next) => {
  const presentedToken = /^(?:bearer|token) +(\S+)$/i.exec(
    c.req.header("Authorization") ?? "",
  )?.[1];
  if (!presentedToken || !(await isInstanceToken(c.env, presentedToken))) {
    return githubError(401, "Bad credentials");
  }
  await next();
});
