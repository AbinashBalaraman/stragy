import { describe, expect, it } from 'vitest';
import { generateTotp } from '../../server/data/angelClient';

// RFC 4226 seed "12345678901234567890" in base32.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('Angel One TOTP (RFC 6238)', () => {
  // RFC 4226 Appendix D HOTP vectors equal TOTP at t = counter * 30 s.
  it.each([
    [0, '755224'],
    [30, '287082'],
    [60, '359152'],
    [90, '969429'],
    [120, '338314'],
    [150, '254676'],
    [180, '287922'],
    [210, '162583'],
    [240, '399871'],
    [270, '520489']
  ])('derives the published 6-digit code at %i s', (seconds, expected) => {
    expect(generateTotp(RFC_SECRET, seconds * 1000)).toBe(expected);
  });

  // RFC 6238 Appendix B, SHA1, 8 digits.
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130']
  ])('matches the RFC 6238 SHA1 vector at %i s', (seconds, expected) => {
    expect(generateTotp(RFC_SECRET, seconds * 1000, 30, 8)).toBe(expected);
  });

  it('stays stable inside one 30-second step and rolls over at the boundary', () => {
    expect(generateTotp(RFC_SECRET, 60_000)).toBe(generateTotp(RFC_SECRET, 89_999));
    expect(generateTotp(RFC_SECRET, 89_999)).not.toBe(generateTotp(RFC_SECRET, 90_000));
  });

  it('rejects malformed base32 secrets instead of returning a silent 000000', () => {
    expect(() => generateTotp('not-base32-!!', 0)).toThrow(/base32/i);
    expect(() => generateTotp('', 0)).toThrow(/base32/i);
  });
});
