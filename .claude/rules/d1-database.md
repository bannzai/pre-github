---
paths:
  - "migrations/**"
  - "src/**/*.ts"
  - "wrangler.jsonc"
---

# D1 database rules

The only storage is the Cloudflare D1 binding `DB` declared in `wrangler.jsonc`.

- **Schema lives in `migrations/`** as `NNNN_<name>.sql` files applied by `wrangler d1 migrations apply pre-github` (`--local` for tests, dev, and the webtunnel runner; `--remote` in `deploy.yml`). There is no other schema definition: no ORM models, no hand-written copy of the tables in TypeScript. Query results are typed from the columns the query selects
- **Never edit an applied migration**. Add a new file. Migrations are forward-only
- **Prepared statements only**: `env.DB.prepare(sql).bind(...)`. Never build SQL with string interpolation of request values
- **Types**: booleans as `INTEGER` 0/1, timestamps as `TEXT` in ISO 8601 UTC (`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`), identifiers as `INTEGER PRIMARY KEY`
- **Numbering**: issues and pull requests share one sequence per `{owner}/{repo}`, as on GitHub. Allocate the next number inside a `batch()` so two concurrent creates cannot collide
- **Hard delete**: `DELETE` removes the rows. No `deleted_at` columns. The only trace is the `events` row (`kind`, `at`), which never holds titles, bodies, or diffs
- **Size**: a D1 row is limited to 1 MB. Reject bodies and diffs above the limit with 422 instead of truncating them
- **Tests** apply the migrations to a fresh local D1 in `vitest.config.ts` (`readD1Migrations` + `applyD1Migrations`) so the schema under test is the one that ships
