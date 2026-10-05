-- A pull request or an issue sent to this instance. Issues and pull requests share one number
-- sequence per owner/repo, as on GitHub.
CREATE TABLE previews (
  id INTEGER PRIMARY KEY,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('issue', 'pull')),
  title TEXT NOT NULL,
  body TEXT,
  -- GitHub opens every new issue and pull request; the create requests carry no state.
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  -- Branch names of a pull request. NULL for issues.
  head TEXT,
  base TEXT,
  -- Unified diff text of a pull request (there is no git server to compute it). NULL for issues.
  diff TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (owner, repo, number)
);

-- A comment on a preview, issue or pull request alike.
CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  preview_id INTEGER NOT NULL REFERENCES previews (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX comments_preview_id ON comments (preview_id);

-- One row per preview created, updated, or deleted: the measurement source in
-- documents/DIRECTION.md. It never holds owner, repo, number, title, body, or diff.
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'updated', 'deleted')),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
