PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  starry_profile_slug TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS starry_identities (
  starry_user_id TEXT PRIMARY KEY,
  local_user_id TEXT NOT NULL UNIQUE,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS youtube_connections (
  user_id TEXT PRIMARY KEY,
  encrypted_refresh_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  scope TEXT NOT NULL,
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  youtube_video_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  youtube_privacy TEXT NOT NULL DEFAULT 'private' CHECK (youtube_privacy IN ('private','unlisted','public')),
  app_visibility TEXT NOT NULL DEFAULT 'owner' CHECK (app_visibility IN ('owner','public')),
  upload_status TEXT NOT NULL DEFAULT 'ready' CHECK (upload_status IN ('pending','uploading','processing','ready','failed')),
  original_filename TEXT,
  file_size INTEGER,
  thumbnail_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS videos_owner_created_idx ON videos(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS videos_public_idx ON videos(app_visibility, created_at DESC);

CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  expires_at TEXT,
  first_opened_at TEXT,
  expire_after_first_open_days INTEGER CHECK (expire_after_first_open_days IS NULL OR expire_after_first_open_days BETWEEN 1 AND 3650),
  disabled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS share_links_video_idx ON share_links(video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS share_links_owner_idx ON share_links(owner_user_id, created_at DESC);
