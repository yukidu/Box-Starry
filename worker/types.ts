export interface Env {
  DB: D1Database;
  STARRY_ID_DB: D1Database;
  ASSETS: Fetcher;
  YOUTUBE_CLIENT_ID?: string;
  YOUTUBE_CLIENT_SECRET?: string;
  YOUTUBE_TOKEN_ENCRYPTION_KEY?: string;
}

export interface LocalUser {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  starry_profile_slug: string | null;
  status: string;
}
