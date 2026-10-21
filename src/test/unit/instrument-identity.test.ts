import { describe, expect, it } from 'vitest';
import { StrategyV2Schema, canonicalStrategyJSON } from '../../shared/contracts/strategy-v2';
import { readStrategy, toLegacyStrategy, validateStrategy } from '../../shared/strategy/schema';
import { simulate } from '../../server/backtest/engine';
import { strategy, bars } from '../fixtures/research';

const metadata = { exchange: 'NSE' as const, assetClass: 'EQUITY' as const, quoteCurrency: 'INR' as const, tickSize: 0.05, quantityStep: 5, tradingTimezone: 'Asia/Kolkata' as const };
function canonical() {
  const parsed = readStrategy(strategy());
  if (!parsed.success) throw new Error('Fixture invalid');
  parsed.data.universe.metadata = { ...metadata };
  parsed.data.universe.ticker = 'OFFLINE';
  return parsed.data;
}
const data = () => bars([[100,101,99,100],[100,101,99,100],[110,111,109,110]]);

describe('canonical instrument identity and descriptive metadata', () => {
  it('preserves identity, metadata and canonical equality across adapter round trips', () => {
    const v = canonical();
    v.rules.entry.all[0] = { left: { kind: 'price', field: 'close' }, operator: 'eq', right: { kind: 'constant', value: 100 } };
    const legacy = toLegacyStrategy(v);
    expect(legacy.universe).toEqual(v.universe);
    const roundtrip = readStrategy(legacy);
    expect(roundtrip.success).toBe(true);
    if (!roundtrip.success) throw new Error('Roundtrip invalid');
    expect(canonicalStrategyJSON(roundtrip.data)).toBe(canonicalStrategyJSON(v));
    expect(roundtrip.data.rules.entry.all[0].operator).toBe('eq');
    expect(validateStrategy(v).data?.universe.metadata).toEqual(metadata);
  });

  it('derives symbolId from the supported canonical identity if its alias is absent', () => {
    const v = canonical();
    delete v.universe.symbolId;
    const legacy = toLegacyStrategy(v);
    expect(legacy.universe.symbolId).toBe(1);
    expect(legacy.universe.instrumentId).toBe('legacy:1');
    expect(legacy.universe.metadata).toEqual(metadata);
  });

  it('rejects conflicting canonical and adapted identities before execution', () => {
    const v = canonical();
    v.universe.instrumentId = 'legacy:2';
    expect(StrategyV2Schema.safeParse(v).success).toBe(false);
    expect(validateStrategy(v).success).toBe(false);
    expect(() => toLegacyStrategy(v)).toThrow(/Conflicting/);
    const legacy = strategy();
    legacy.universe.instrumentId = 'legacy:2';
    expect(validateStrategy(legacy).success).toBe(false);
    expect(() => simulate(legacy, data())).toThrow(/Conflicting/);
  });

  it.each(['provider:real:1', 'legacy:01', 'legacy:0', 'legacy:-1', 'legacy:9007199254740992'])('rejects unsupported mapping %s even with a symbolId alias', instrumentId => {
    const v = canonical();
    v.universe.instrumentId = instrumentId;
    expect(readStrategy(v).success).toBe(false);
    expect(() => toLegacyStrategy(v)).toThrow(/Unsupported instrument ID/);
    const legacy = strategy();
    legacy.universe.instrumentId = instrumentId;
    expect(() => simulate(legacy, data())).toThrow(/Unsupported instrument ID/);
  });

  it('retains legacy approximate equality semantics alongside instrument metadata', () => {
    const legacy = strategy();
    legacy.version = 1;
    legacy.universe.metadata = { ...metadata };
    const v = readStrategy(legacy);
    expect(v).toMatchObject({ success: true, data: { universe: { metadata }, rules: { entry: { all: [{ operator: 'approxEq', absoluteTolerance: 0.0001 }] } } } });
  });
});

describe('quantityStep execution regressions', () => {
  it.each(['fixedFraction', 'fixedRisk'] as const)('sizes %s in metadata units, including fees and risk', type => {
    const legacy = toLegacyStrategy(canonical());
    legacy.risk.positionSizing = type === 'fixedFraction' ? { type, fraction: 1 } : { type, riskPerTrade: 0.6 };
    legacy.costs.brokerageFlat = 2;
    const result = simulate(legacy, data(), { initialCapital: 1350, robustness: false });
    expect(result.trades[0].quantity).toBe(10);
    expect(result.ledger?.every(fill => fill.quantity % 5 === 0)).toBe(true);
    expect(result.ledger?.[0].cash).toBe(348);
    expect(result.reconciliation?.difference).toBeCloseTo(0, 8);
    expect(result.strategy.universe.metadata).toEqual(metadata);
    expect(result.warnings?.some(w => w.includes('metadata is unverified') && w.includes('tickSize'))).toBe(true);
  });

  it('does not round a risk budget upward to the next step', () => {
    const legacy = toLegacyStrategy(canonical());
    legacy.risk.positionSizing = { type: 'fixedRisk', riskPerTrade: 0.15 };
    const result = simulate(legacy, data(), { initialCapital: 1350, robustness: false });
    expect(result.trades[0].quantity).toBe(10);
  });

  it('does not force a lot when cash cannot afford one quantityStep', () => {
    const legacy = toLegacyStrategy(canonical());
    legacy.risk.positionSizing = { type: 'fixedFraction', fraction: 1 };
    expect(simulate(legacy, data(), { initialCapital: 499 }).ledger).toEqual([]);
  });

  it('rejects fixed quantity off-step instead of silently trading it', () => {
    const legacy = toLegacyStrategy(canonical());
    legacy.risk.positionSizing = { type: 'fixedQty', quantity: 11 };
    expect(() => simulate(legacy, data())).toThrow(/quantityStep/);
  });

  it('preserves fractional quantity steps and executes fixed fractional quantities', () => {
    const v = canonical();
    v.universe.metadata!.quantityStep = 0.25;
    v.risk.positionSizing = { type: 'fixedQty', quantity: 1.25 };
    const legacy = toLegacyStrategy(v);
    expect(readStrategy(legacy)).toMatchObject({ success: true, data: { risk: { positionSizing: { quantity: 1.25 } } } });
    const result = simulate(legacy, data(), { initialCapital: 1000 });
    expect(result.trades[0].quantity).toBe(1.25);
    expect(result.reconciliation?.difference).toBeCloseTo(0, 8);
  });

  it('rejects unrepresentable step counts rather than ignoring the metadata', () => {
    const legacy = toLegacyStrategy(canonical());
    legacy.universe.metadata!.quantityStep = 1e-20;
    legacy.risk.positionSizing = { type: 'fixedFraction', fraction: 1 };
    expect(() => simulate(legacy, data())).toThrow(/unsafe number of sizing units/);
  });
});
