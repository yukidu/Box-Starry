CREATE TABLE IF NOT EXISTS youtube_upload_quota_usage (
  quota_date TEXT PRIMARY KEY,
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
