import { describe, expect, it } from 'vitest';
import { NSE_SYMBOLS } from '../../shared/data/symbols';
import { DerivativeRequestOwner } from '../../components/scanner/useDerivativeRequest';
import { parseOptionChain, parseVolumeProfile, parseBasisSpreads, parseGtt, gttInputSchema } from '../../components/scanner/derivativeContracts';
import { getOptionChainData, getVolumeProfileAndVWAP, getBasisAndCalendarSpreads, calculateGttBracketOrder } from '../../server/data/smartApi';
const envelope = { success: true, mode: 'demo', model: true };
const input = { symbolId: NSE_SYMBOLS.find(s => s.ticker === 'TCS')!.id, action: 'BUY' as const, capitalAllocated: 100000, riskPct: 1.5, rewardRatio: 2.5, trailPct: 0.5 };
const preview = () => ({ success: true, mode: 'demo', ...calculateGttBracketOrder(input.symbolId, input.action, input.capitalAllocated, input.riskPct, input.rewardRatio, input.trailPct) });
describe('strict derivative UI contracts', () => {
  it('accepts actual generated demo responses without invented fields', () => {
    const chain = getOptionChainData(4);
    expect(parseOptionChain({ ...envelope, ...chain }, chain.ticker).provenance.asOf).toBe('2026-09-30');
    expect(parseVolumeProfile({ ...envelope, ...getVolumeProfileAndVWAP(4) }, '4').profileLevels.length).toBeGreaterThan(0);
    const spreads = getBasisAndCalendarSpreads();
    const parsedSpreads = parseBasisSpreads({ ...envelope, count: spreads.length, spreads });
    expect(parsedSpreads.count).toBe(spreads.length);
    expect(parsedSpreads.spreads.every(s => s.provenance.source === 'DEMO_COST_OF_CARRY')).toBe(true);
    expect(() => parseBasisSpreads({ ...envelope, count: spreads.length, spreads: spreads.map(s => ({ ...s, provenance: { ...s.provenance, source: 'DEMO_MODEL' } })) })).toThrow();
    expect(parseGtt(preview(), JSON.stringify(input)).previewOnly).toBe(true);
  });
  it('rejects malformed/missing nested values, nonfinite data and wrong symbols', () => {
    const chain = { ...envelope, ...getOptionChainData(4) };
    expect(() => parseOptionChain({ ...chain, spotPrice: Infinity }, chain.ticker)).toThrow();
    expect(() => parseOptionChain({ ...chain, strikes: [{}] }, chain.ticker)).toThrow();
    expect(() => parseOptionChain(chain, 'INFY')).toThrow();
    expect(() => parseVolumeProfile({ ...envelope, ...getVolumeProfileAndVWAP(4), profileLevels: [] }, '4')).toThrow();
    expect(() => parseBasisSpreads({ ...envelope, count: 1, spreads: [] })).toThrow();
    expect(() => parseOptionChain({ ...chain, provenance: undefined }, chain.ticker)).toThrow();
    expect(() => parseOptionChain({ ...chain, mode: 'real' }, chain.ticker)).toThrow();
  });
  it('requires current GTT inputs, warnings, safe direction and preview-only payload', () => {
    expect(() => parseGtt(preview(), JSON.stringify({ ...input, action: 'SELL' }))).toThrow();
    expect(() => parseGtt({ ...preview(), previewOnly: false }, JSON.stringify(input))).toThrow();
    expect(() => parseGtt({ ...preview(), warnings: [] }, JSON.stringify(input))).toThrow();
    expect(() => parseGtt({ ...preview(), stopLossPrice: 999999 }, JSON.stringify(input))).toThrow();
    expect(() => parseGtt({ ...preview(), smartApiPayload: {} }, JSON.stringify(input))).toThrow();
    expect(gttInputSchema.safeParse({ ...input, capitalAllocated: 0 }).success).toBe(false);
    expect(gttInputSchema.safeParse({ ...input, riskPct: NaN }).success).toBe(false);
  });
});
describe('derivative request ownership', () => {
  it('aborts superseded symbols and rejects late success/failure/loading writes', async () => {
    const owner = new DerivativeRequestOwner();
    const a = owner.begin('TCS');
    const b = owner.begin('INFY');
    expect(a.signal.aborted).toBe(true);
    const writes: string[] = [];
    await Promise.all([Promise.resolve().then(() => { if (owner.owns(a)) writes.push('stale success'); }), Promise.resolve().then(() => { if (owner.owns(a)) writes.push('stale failure/finally'); }), Promise.resolve().then(() => { if (owner.owns(b)) writes.push('current'); })]);
    expect(writes).toEqual(['current']);
  });
  it('gives same-key refresh a new generation and aborts on cleanup', () => {
    const owner = new DerivativeRequestOwner();
    const a = owner.begin('basis'), b = owner.begin('basis');
    expect(owner.owns(a)).toBe(false);
    expect(owner.owns(b)).toBe(true);
    owner.cancel();
    expect(b.signal.aborted).toBe(true);
    expect(owner.owns(b)).toBe(false);
  });
});
