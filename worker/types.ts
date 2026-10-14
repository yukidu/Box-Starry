export interface D1ResultLike {
  meta: { changes?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<D1ResultLike>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
}

export interface FetcherLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface WorkersAIResult {
  image?: string;
  response?: string;
}

export interface WorkersAILike {
  run(model: string, input: Record<string, unknown>): Promise<WorkersAIResult>;
}

export interface Env {
  DB: D1DatabaseLike;
  STARRY_ID_DB: D1DatabaseLike;
  ASSETS: FetcherLike;
  AI?: WorkersAILike;
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
