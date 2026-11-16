import type { BacktestResponse } from '../shared/strategy/types';
import type { RunRequestOptions } from './api';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const finiteNumber = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Request options that reproduce the displayed run, not the current draft.
 * The provenance requestWindow is authoritative; the manifest options are a
 * compatible fallback for responses that only carry the older shape.
 */
export function rerunRequestOptions(result: BacktestResponse): RunRequestOptions {
  const manifest = record(result.manifest);
  const options = record(manifest.options);
  const provenance = record(result.provenance);
  const directWindow = record(provenance.requestWindow);
  const manifestWindow = record(options.requestWindow);
  const requestWindow = Object.keys(directWindow).length ? directWindow : manifestWindow;
  const start = text(requestWindow.start);
  const end = text(requestWindow.end);
  const asOf = text(requestWindow.asOf);
  const initialCapital = finiteNumber(options.initialCapital) ?? finiteNumber(result.metrics?.initialCapital);
  const seed = finiteNumber(options.seed);
  return {
    ...(initialCapital !== undefined ? { initialCapital } : {}),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    ...(asOf ? { asOf } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(typeof options.robustness === 'boolean' ? { robustness: options.robustness } : {}),
  };
}
