/**
 * Vitest-only alias for `node:crypto`. jsdom's built-in shim exports an empty
 * module, so modules that call randomUUID() at import time crash. Node 26's
 * process.getBuiltinModule gives us the real builtin in both node and jsdom
 * environments; production code never sees this file.
 */
const real = (process as unknown as {
  getBuiltinModule?: (name: string) => Record<string, unknown>;
}).getBuiltinModule?.('node:crypto') ?? {};

export const randomUUID = (real.randomUUID as (() => string) | undefined)
  ?? (() => globalThis.crypto.randomUUID());
export const createHash = real.createHash as (typeof import('node:crypto'))['createHash'];
export const createHmac = real.createHmac as (typeof import('node:crypto'))['createHmac'];
export const randomBytes = real.randomBytes as (typeof import('node:crypto'))['randomBytes'];
export const timingSafeEqual = real.timingSafeEqual as (typeof import('node:crypto'))['timingSafeEqual'];
export const createCipheriv = real.createCipheriv as (typeof import('node:crypto'))['createCipheriv'];
export const createDecipheriv = real.createDecipheriv as (typeof import('node:crypto'))['createDecipheriv'];
export const webcrypto = (real.webcrypto ?? globalThis.crypto) as Crypto;
export default real;
