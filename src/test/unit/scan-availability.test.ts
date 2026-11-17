import { describe, expect, it } from 'vitest';
import { plainScanFailure, verifiedScreenMessage, universeLabel } from '../../shared/contracts/scan-availability';

const internal = 'Verified current membership is available only for NIFTY_50; bundled index pools are illustrative';

describe('verified screen availability', () => {
  it('turns an internal membership failure into the exact plain line', () => {
    expect(plainScanFailure('MEMBERSHIP_UNAVAILABLE', internal, 'NIFTY_IT'))
      .toBe('I can only screen the Nifty 50 with verified membership. Use the Market scanner for NIFTY IT.');
    expect(plainScanFailure(undefined, internal, 'NSE'))
      .toBe('I can only screen the Nifty 50 with verified membership. Use the Market scanner for all NSE stocks.');
    expect(plainScanFailure('MEMBERSHIP_UNAVAILABLE', internal, undefined))
      .toBe('I can only screen the Nifty 50 with verified membership. Use the Market scanner for that universe.');
  });

  it('keeps unrelated failures on their own honest message', () => {
    expect(plainScanFailure('PROVIDER_RATE_LIMITED', 'Angel One is busy. Try again in a minute.', 'NIFTY_50')).toBeNull();
    expect(plainScanFailure('JOB_TIMEOUT', 'The scan took too long and was stopped. Try again.', 'NIFTY_50')).toBeNull();
  });

  it('labels every universe the chat can name', () => {
    expect(universeLabel('NIFTY_50')).toBe('Nifty 50');
    expect(universeLabel('NIFTY_METAL')).toBe('NIFTY Metal');
    expect(verifiedScreenMessage('BSE Sensex')).toBe('I can only screen the Nifty 50 with verified membership. Use the Market scanner for BSE Sensex.');
  });
});
