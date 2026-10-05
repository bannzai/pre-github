import type { Context } from "hono";
import { getSignedCookie, setSignedCookie } from "hono/cookie";

/** The cookie that carries a page session: its expiry time, signed with `PRE_GITHUB_TOKEN`. */
const sessionCookieName = "pre_github_session";

/**
 * How long a session lasts, in seconds. One person previews a few PRs a week on their own
 * instance; 30 days keeps re-entering the token rare while a copied cookie still expires.
 * Changing `PRE_GITHUB_TOKEN` ends every session at once, because the signature no longer
 * matches.
 */
const sessionSeconds = 30 * 24 * 60 * 60;

/**
 * Starts a page session on the response: sets the session cookie (`HttpOnly`, `Secure`,
 * `SameSite=Lax`) signed with `instanceToken`, which the caller has checked is
 * `PRE_GITHUB_TOKEN`. No session is stored on the server.
 */
export async function startSession(
  c: Context<{ Bindings: Cloudflare.Env }>,
  instanceToken: string,
): Promise<void> {
  await setSignedCookie(
    c,
    sessionCookieName,
    String(Date.now() + sessionSeconds * 1000),
    instanceToken,
    { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: sessionSeconds },
  );
}

/**
 * Whether the request carries a session cookie signed with the instance's `PRE_GITHUB_TOKEN`
 * whose expiry time has not passed. An instance without the secret has no sessions.
 */
export async function hasSession(c: Context<{ Bindings: Cloudflare.Env }>): Promise<boolean> {
  if (!c.env.PRE_GITHUB_TOKEN) return false;
  const expiresAt = await getSignedCookie(c, c.env.PRE_GITHUB_TOKEN, sessionCookieName);
  return typeof expiresAt === "string" && Number(expiresAt) > Date.now();
}
