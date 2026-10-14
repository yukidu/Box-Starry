const te = new TextEncoder();

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomToken(bytes = 32): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return base64Url(data);
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', te.encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  for (const chunk of (header || '').split(';')) {
    const [k, ...rest] = chunk.trim().split('=');
    if (k) result[k] = decodeURIComponent(rest.join('='));
  }
  return result;
}

export function sessionCookie(token: string, maxAge = 60 * 60 * 24 * 30): string {
  return `box_starry_session=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return 'box_starry_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
}

export function json(data: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  return new Response(JSON.stringify(data), { status, headers });
}

export async function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }> {
  const actualSalt = salt || randomToken(16);
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(actualSalt), iterations: 120_000 },
    key,
    256
  );
  return { hash: base64Url(new Uint8Array(bits)), salt: actualSalt };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  if (hash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return diff === 0;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('youtube_token_key_too_short');
  const digest = await crypto.subtle.digest('SHA-256', te.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(value: string, secret: string): Promise<{ ciphertext: string; iv: string }> {
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes }, await encryptionKey(secret), te.encode(value));
  return { ciphertext: base64Url(new Uint8Array(encrypted)), iv: base64Url(ivBytes) };
}

export async function decryptSecret(ciphertext: string, iv: string, secret: string): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(iv) },
    await encryptionKey(secret),
    fromBase64Url(ciphertext)
  );
  return new TextDecoder().decode(plain);
}

export function cleanText(value: unknown, max = 500): string {
  return String(value ?? '').trim().slice(0, max);
}

export function isoOrNull(value: unknown): string | null {
  const text = cleanText(value, 64);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
