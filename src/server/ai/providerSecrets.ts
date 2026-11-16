/**
 * Encrypted-at-rest storage for provider keys.
 *
 * AES-256-GCM with a 32-byte key. The key comes from PROVIDER_SECRETS_KEY
 * (base64) or, for local/loopback runs, from data/.provider-secrets-key
 * with owner-only permissions. Production off-loopback refuses to store keys.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type SecretsStorage = 'encrypted' | 'unavailable';

const KEY_FILE = 'data/.provider-secrets-key';
let cachedKey: Buffer | null | undefined;
let cachedStorage: SecretsStorage | undefined;

function isLoopbackHost(host: string | undefined): boolean {
  const value = (host ?? '').trim().toLowerCase();
  return value === '127.0.0.1' || value === 'localhost' || value === '::1' || value === '[::1]';
}

function parseKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  try {
    const buffer = Buffer.from(raw.trim(), 'base64');
    return buffer.length === 32 ? buffer : null;
  } catch {
    return null;
  }
}

function localKeyFile(): string {
  return resolve(process.cwd(), KEY_FILE);
}

function loadOrCreateLocalKey(): Buffer | null {
  const file = localKeyFile();
  try {
    if (existsSync(file)) {
      const key = parseKey(readFileSync(file, 'utf8'));
      return key;
    }
    mkdirSync(dirname(file), { recursive: true });
    const key = randomBytes(32);
    writeFileSync(file, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* best effort on platforms without POSIX modes */ }
    return key;
  } catch {
    return null;
  }
}

/** Resolve the storage mode once per process. Never returns the key material. */
export function getSecretsStorage(env: Record<string, string | undefined> = process.env): SecretsStorage {
  if (cachedStorage) return cachedStorage;
  const envKey = parseKey(env.PROVIDER_SECRETS_KEY);
  if (envKey) {
    cachedKey = envKey;
    cachedStorage = 'encrypted';
    return cachedStorage;
  }
  const loopback = isLoopbackHost(env.HOST);
  if (loopback || env.NODE_ENV !== 'production') {
    const local = loadOrCreateLocalKey();
    cachedKey = local;
    cachedStorage = local ? 'encrypted' : 'unavailable';
    return cachedStorage;
  }
  cachedKey = null;
  cachedStorage = 'unavailable';
  return cachedStorage;
}

/** Test seam. */
export function resetSecretsCache(): void {
  cachedKey = undefined;
  cachedStorage = undefined;
}

function requireKey(env: Record<string, string | undefined>): Buffer | null {
  if (getSecretsStorage(env) !== 'encrypted') return null;
  return cachedKey ?? null;
}

/** `v1:<iv>:<tag>:<cipher>` with base64 parts. */
export function encryptSecret(plaintext: string, env: Record<string, string | undefined> = process.env): string | null {
  if (!plaintext) return null;
  const key = requireKey(env);
  if (!key) return null;
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  } catch {
    return null;
  }
}

export function decryptSecret(payload: string | undefined, env: Record<string, string | undefined> = process.env): string | null {
  if (!payload) return null;
  const key = requireKey(env);
  if (!key) return null;
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const encrypted = Buffer.from(parts[3], 'base64');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Ellipsis plus last four characters. Never returns a full key. */
export function secretHint(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 4 ? '…' + value : '…' + value.slice(-4);
}

/** Remove a known secret from an error/message before it leaves the server. */
export function redactSecret(text: string, secret: string | null | undefined): string {
  if (!secret) return text;
  return text.split(secret).join('[redacted]');
}
