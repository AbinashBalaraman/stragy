import type { BacktestResponse } from '../../shared/strategy/types';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export interface SurvivorshipBasis {
  /** Printed index/universe name, e.g. "NIFTY 50". */
  basis: string;
}

const normalizeBasis = (value: unknown): string | undefined => {
  const direct = text(value);
  if (direct) return direct;
  const object = record(value);
  return text(object.label) ?? text(object.name) ?? text(object.universe) ?? text(object.id);
};

/**
 * A backtest is single-symbol, so survivorship only applies when the run came
 * from a universe screen or carries an explicit membership basis. Detect that
 * from provenance/manifest hints first, then from an index-named screen
 * strategy. A plain RELIANCE template run returns null.
 */
export function survivorshipBasis(result: BacktestResponse): SurvivorshipBasis | null {
  const provenance = record(result.provenance);
  const manifest = record(result.manifest);
  const manifestOptions = record(manifest.options);

  const candidates: unknown[] = [
    provenance.universe,
    provenance.universeBasis,
    provenance.membership,
    provenance.screenContext,
    provenance.screen,
    manifest.universe,
    manifest.universeBasis,
    manifest.membership,
    manifest.screenContext,
    manifestOptions.universe,
    manifestOptions.screenContext,
  ];
  for (const candidate of candidates) {
    const basis = normalizeBasis(candidate);
    if (basis) return { basis };
  }

  const explicitCaveat = JSON.stringify([
    provenance.warnings,
    provenance.membershipBasis,
    manifest.limitations,
    manifestOptions.screenContext,
  ]);
  if (/survivor|current membership|current constituents|today's members/i.test(explicitCaveat)) {
    return { basis: 'index' };
  }

  const strategyName = result.strategy?.name ?? '';
  if (/\bnifty\s*50\b|\bsensex\b|\bindex members\b/i.test(strategyName)) {
    return { basis: /\bsensex\b/i.test(strategyName) ? 'SENSEX' : 'NIFTY 50' };
  }

  return null;
}
