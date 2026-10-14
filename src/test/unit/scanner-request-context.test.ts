import { describe, it, expect } from 'vitest';
import { actualDataCutoff, scannerBacktestOptions, ScannerRequestOwner, scannerContextKey } from '../../components/scanner/scannerRequestContext';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
describe('scanner context and historical cutoffs', () => {
  it('aborts replaced work and rejects responses from another context', () => {
    const owner = new ScannerRequestOwner(); const old = owner.begin('ALL:2026-09-01');
    const next = owner.begin('NSE:2026-09-02');
    expect(old.signal.aborted).toBe(true); expect(owner.owns(old, old.context)).toBe(false);
    expect(owner.owns(next, 'NSE:2026-09-03')).toBe(false); expect(owner.owns(next, next.context)).toBe(true);
    owner.cancel(); expect(owner.owns(next, next.context)).toBe(false);
  });
  it('changes ownership identity when strategy, universe or date changes', () => {
    const strategy = STRATEGY_TEMPLATES[0].strategy; const key = scannerContextKey(strategy, 'ALL', '2026-09-01');
    expect(scannerContextKey({...strategy, name:'changed'}, 'ALL', '2026-09-01')).not.toBe(key);
    expect(scannerContextKey(strategy, 'NSE', '2026-09-01')).not.toBe(key);
    expect(scannerContextKey(strategy, 'ALL', '2026-09-02')).not.toBe(key);
  });
  it('uses actual generated-demo coverage instead of request time or calendar time', () => {
    expect(actualDataCutoff({asOf:'2026-10-13', scannedAt:'2026-10-13T12:00:00Z', matches:[{lastDate:'2026-09-30'}]})).toBe('2026-09-30');
    expect(actualDataCutoff({provenance:[{actualRange:{end:'2026-09-30'},fetchedAt:'2026-10-13'}]})).toBe('2026-09-30');
    expect(actualDataCutoff({scannedAt:'2026-10-13', fetchedAt:'2026-10-13', dates:[{date:'2026-10-13'}]})).toBeUndefined();
  });
  it('preserves selected historical cutoff and caps latest runs at observed data', () => {
    expect(scannerBacktestOptions('2026-08-14','2026-08-13')).toEqual({asOf:'2026-08-13',end:'2026-08-13'});
    expect(scannerBacktestOptions('2026-08-14','2026-09-30')).toEqual({asOf:'2026-08-14',end:'2026-08-14'});
    expect(scannerBacktestOptions('', '2026-09-30')).toEqual({asOf:'2026-09-30',end:'2026-09-30'});
    expect(() => scannerBacktestOptions('')).toThrow('Data cutoff unavailable');
  });
});
