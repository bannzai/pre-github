declare namespace Cloudflare {
  /** Bindings and secrets the Worker receives from wrangler.jsonc and the Worker's secrets. */
  interface Env {
    /** The only storage: previews, comments, and the `events` table (`.claude/rules/d1-database.md`). */
    DB: D1Database;
    /** The single credential of this instance (documents/PROJECT.md, Constraints). */
    PRE_GITHUB_TOKEN?: string;
  }
}
