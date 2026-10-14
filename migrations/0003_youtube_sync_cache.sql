CREATE TABLE IF NOT EXISTS youtube_sync_state (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  last_full_sync TEXT,
  last_incremental_sync TEXT,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE IF NOT EXISTS youtube_video_cache (
  user_id TEXT NOT NULL,
  youtube_video_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  sort_key TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, youtube_video_id)
);

CREATE INDEX IF NOT EXISTS youtube_video_cache_user_sort
  ON youtube_video_cache(user_id, sort_key DESC);

CREATE TABLE IF NOT EXISTS youtube_playlist_cache (
  user_id TEXT NOT NULL,
  youtube_playlist_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  sort_key TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, youtube_playlist_id)
);

CREATE INDEX IF NOT EXISTS youtube_playlist_cache_user_sort
  ON youtube_playlist_cache(user_id, sort_key DESC);
