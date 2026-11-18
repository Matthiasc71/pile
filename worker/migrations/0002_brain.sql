-- Pile, migration 0002: Claude's passes (milestone 4).

-- Plans armed by Claude ("reel") and the raw-skill ghost ("fantome").
-- milestone 4 stores and shows them; milestone 5 executes the real ones.
CREATE TABLE plans (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('reel', 'fantome')),
  symbol     TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('arme', 'desarme', 'declenche', 'execute', 'expire')),
  pass       TEXT NOT NULL,
  plan       TEXT NOT NULL,
  plan_hash  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX plans_date ON plans (date, kind, status);

-- Claude's notes and evening reports.
CREATE TABLE journal (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  ts    INTEGER NOT NULL,
  date  TEXT NOT NULL,
  pass  TEXT NOT NULL,
  kind  TEXT NOT NULL CHECK (kind IN ('note', 'bilan', 'candidats')),
  title TEXT,
  body  TEXT NOT NULL,
  data  TEXT
);
CREATE INDEX journal_date ON journal (date);

-- Each pass reports start and end, so a missing or failed pass shows.
CREATE TABLE passes (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  date   TEXT NOT NULL,
  pass   TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('start', 'done', 'skipped', 'error')),
  detail TEXT
);
CREATE INDEX passes_date ON passes (date, pass);

-- The skill's GitHub popularity, read once a day by the watcher (crowd index, part 1).
CREATE TABLE crowd_daily (
  date       TEXT PRIMARY KEY,
  stars      INTEGER NOT NULL,
  forks      INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  score      REAL,
  components TEXT
);
