CREATE TABLE IF NOT EXISTS box_playlists (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS box_playlists_owner_updated
  ON box_playlists(owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS box_playlist_items (
  playlist_id TEXT NOT NULL,
  youtube_video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (playlist_id, youtube_video_id)
);

CREATE INDEX IF NOT EXISTS box_playlist_items_order
  ON box_playlist_items(playlist_id, position, added_at);
