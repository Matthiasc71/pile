-- Pile, migration 0001: the read-only watcher (milestone 2).
-- Times are epoch milliseconds (UTC). Money in US dollars as REAL, converted
-- to euros at read time with the ECB rate of the point's own day.

-- Settings and day 0 (key -> JSON).
CREATE TABLE config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Small mutable state: pause, cached clock, last tick, health, snapshots.
CREATE TABLE kv_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- API tokens, stored as HMAC-SHA256(TOKEN_PEPPER, token). Never the token.
CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  scope        TEXT NOT NULL CHECK (scope IN ('app', 'claude')),
  name         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at   INTEGER
);

-- One-time pairing codes (10 minutes), hashed like tokens.
CREATE TABLE pair_codes (
  code_hash  TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

-- Account equity, one point per minute during the session.
CREATE TABLE equity_points (
  ts         INTEGER PRIMARY KEY,
  equity_usd REAL NOT NULL,
  cash_usd   REAL
);

-- ECB reference rates (Frankfurter): euros for one US dollar, per business day.
CREATE TABLE fx_rates (
  date        TEXT PRIMARY KEY,
  eur_per_usd REAL NOT NULL CHECK (eur_per_usd > 0),
  fetched_at  INTEGER NOT NULL
);

-- The S&P 500 benchmark: day 0's 50 euros held in SPY.
CREATE TABLE spy_points (
  ts        INTEGER PRIMARY KEY,
  price     REAL NOT NULL,
  value_usd REAL NOT NULL
);

-- IEX 1-minute bars as fetched: kept for the replay mode.
CREATE TABLE bars_1m (
  symbol TEXT NOT NULL,
  ts     INTEGER NOT NULL,
  o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL,
  v INTEGER NOT NULL, n INTEGER, vw REAL,
  PRIMARY KEY (symbol, ts)
) WITHOUT ROWID;

-- Alerts for the app and notifications. dedupe_key keeps one per cause per day.
CREATE TABLE alerts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,
  level        TEXT NOT NULL CHECK (level IN ('info', 'warn', 'critical')),
  source       TEXT NOT NULL,
  code         TEXT NOT NULL,
  message      TEXT NOT NULL,
  dedupe_key   TEXT UNIQUE,
  acked_at     INTEGER
);
CREATE INDEX alerts_ts ON alerts (ts);
