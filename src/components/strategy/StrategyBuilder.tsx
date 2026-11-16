import React, { useRef, useState } from 'react';
import type { StrategyAST, IndicatorType, RuleNode, RiskControls } from '../../shared/strategy/types';
import { INDICATOR_REGISTRY, legacyOutputNames, RESERVED_SERIES } from '../../shared/strategy/registry';
import { validateStrategy, canonicalStrategyJSON } from '../../shared/strategy/schema';
import { snapshotStrategy } from '../../client/workspace';

interface Props {
  strategy: StrategyAST;
  onChange: (strategy: StrategyAST) => void;
  onRunBacktest: () => void;
  isLoading: boolean;
}

const control = 'w-full rounded-lg border border-white/15 bg-[#101012] p-2 text-sm text-[#ececed]';
const secondaryButton = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-[#ececed] transition-colors hover:border-[#a8c7fa]/40 hover:bg-white/[0.04]';
const card = 'space-y-3 rounded-xl border border-white/10 bg-[#171719] p-4';

function RuleRow({ rule, index, group, operands, change, remove }: {
  rule: RuleNode;
  index: number;
  group: string;
  operands: string[];
  change: (rule: RuleNode) => void;
  remove: () => void;
}) {
  return (
    <fieldset className="grid grid-cols-1 gap-2 rounded-lg border border-white/10 p-3 sm:grid-cols-4">
      <legend className="px-1 text-xs text-neutral-300">{group} rule {index + 1}</legend>
      <label className="text-xs">
        Left operand
        <select
          aria-label={`${group} left operand ${index + 1}`}
          className={control}
          value={rule.leftValue !== undefined ? '__constant' : rule.leftIndicator}
          onChange={event => change({ ...rule, leftIndicator: event.target.value, leftValue: event.target.value === '__constant' ? 0 : undefined })}
        >
          {operands.map(operand => <option key={operand}>{operand}</option>)}
          <option value="__constant">Constant</option>
        </select>
        {rule.leftValue !== undefined && <input aria-label={`${group} left constant ${index + 1}`} className={control} type="number" value={rule.leftValue} onChange={event => change({ ...rule, leftValue: Number(event.target.value) })} />}
      </label>
      <label className="text-xs">
        Comparison
        <select
          aria-label={`${group} operator ${index + 1}`}
          className={control}
          value={rule.operator}
          onChange={event => {
            const operator = event.target.value as RuleNode['operator'];
            change({ ...rule, operator, equality: operator === 'eq' ? 'exact' : undefined, absoluteTolerance: operator === 'approxEq' ? rule.absoluteTolerance ?? 0.0001 : undefined });
          }}
        >
          {[
            ['gt', 'Greater than'],
            ['gte', 'Greater or equal'],
            ['lt', 'Less than'],
            ['lte', 'Less or equal'],
            ['eq', 'Exactly equals'],
            ['approxEq', 'Approximately equals'],
            ['crossesAbove', 'Crosses above'],
            ['crossesBelow', 'Crosses below']
          ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {rule.operator === 'approxEq' && <input aria-label={`${group} absolute tolerance ${index + 1}`} className={control} type="number" step="any" value={rule.absoluteTolerance ?? 0.0001} onChange={event => change({ ...rule, absoluteTolerance: Number(event.target.value) })} />}
      </label>
      <label className="text-xs">
        Right operand
        <select
          aria-label={`${group} right operand ${index + 1}`}
          className={control}
          value={rule.rightIndicator ?? '__constant'}
          onChange={event => change({ ...rule, rightIndicator: event.target.value === '__constant' ? undefined : event.target.value, rightValue: event.target.value === '__constant' ? 0 : undefined })}
        >
          <option value="__constant">Constant</option>
          {operands.map(operand => <option key={operand}>{operand}</option>)}
        </select>
        {!rule.rightIndicator && <input aria-label={`${group} right constant ${index + 1}`} className={control} type="number" step="any" value={rule.rightValue ?? 0} onChange={event => change({ ...rule, rightValue: Number(event.target.value) })} />}
      </label>
      <label className="text-xs">
        Evaluation window
        <select
          aria-label={`${group} window ${index + 1}`}
          className={control}
          value={rule.lookback ? 'previous' : 'current'}
          onChange={event => change({ ...rule, lookback: event.target.value === 'previous' ? { bars: 20, includeCurrent: false, match: 'any' } : undefined })}
        >
          <option value="current">Current completed bar</option>
          <option value="previous">Any preceding completed bar</option>
        </select>
        {rule.lookback && (
          <>
            <input aria-label={`${group} lookback bars ${index + 1}`} className={control} type="number" min={1} max={252} step={1} value={rule.lookback.bars} onChange={event => change({ ...rule, lookback: { bars: Number(event.target.value), includeCurrent: false, match: 'any' } })} />
            <span className="text-[11px] text-neutral-400">1–252 bars; current bar excluded.</span>
          </>
        )}
      </label>
      <button type="button" onClick={remove} className="btn-ghost-quant justify-self-start text-xs sm:col-span-4">Remove rule</button>
    </fieldset>
  );
}

export const StrategyBuilder: React.FC<Props> = ({ strategy, onChange, onRunBacktest, isLoading }) => {
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const [copied, setCopied] = useState(false);
  const [newType, setNewType] = useState<IndicatorType>('SMA');
  const [importText, setImportText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<{ strategy: StrategyAST; warnings: string[]; source: string } | null>(null);
  const fileGeneration = useRef(0);
  const importRef = useRef<HTMLTextAreaElement>(null);

  const validation = validateStrategy(strategy);
  const operands = [...RESERVED_SERIES, ...strategy.indicators.flatMap(indicator => Object.keys(legacyOutputNames(indicator)))];

  const update = (patch: Partial<StrategyAST>) => {
    setCopied(false);
    onChange({ ...strategy, ...patch, version: strategy.version + 1 });
  };
  const risk = (patch: Partial<RiskControls>) => update({ risk: { ...strategy.risk, ...patch } });

  const addIndicator = () => {
    const taken = new Set(operands);
    let n = 1;
    let id = newType.toLowerCase() + n;
    while (taken.has(id) || strategy.indicators.some(indicator => indicator.id === id)) id = newType.toLowerCase() + (++n);
    update({ indicators: [...strategy.indicators, { id, type: newType, params: { ...INDICATOR_REGISTRY[newType].defaults } }] });
  };

  const removeIndicator = (id: string) => {
    const indicator = strategy.indicators.find(item => item.id === id)!;
    const names = new Set(Object.keys(legacyOutputNames(indicator)));
    if ([...strategy.rules.entry, ...strategy.rules.exit].some(rule => names.has(rule.leftIndicator) || (rule.rightIndicator && names.has(rule.rightIndicator)))) {
      setError('This indicator is referenced by a rule. Update or remove those rules before deleting it.');
      return;
    }
    update({ indicators: strategy.indicators.filter(item => item.id !== id) });
  };

  const focusImport = () => {
    const element = importRef.current;
    if (!element) return;
    element.focus();
    element.scrollIntoView?.({ block: 'center' });
  };

  const failImport = (message: string) => {
    setImportError(message);
    setPreview(null);
    setError('');
    focusImport();
  };

  const previewImport = (text: string) => {
    setImportError('');
    setError('');
    try {
      if (text.length > 262144) throw Error('Import is limited to 256 KB.');
      const raw = JSON.parse(text);
      const parsed = validateStrategy(raw);
      if (!parsed.success || !parsed.data) throw Error(parsed.errors?.join('; ') ?? 'Invalid strategy');
      setPreview({ strategy: parsed.data, warnings: parsed.warnings ?? [], source: JSON.stringify(strategy) });
    } catch (caught) {
      failImport((caught as Error).message);
    }
  };

  const readFile = async (file?: File) => {
    if (!file) return;
    const owned = ++fileGeneration.current;
    setFileName(file.name);
    try {
      if (file.size > 262144) throw Error('Import is limited to 256 KB.');
      const text = await file.text();
      if (fileGeneration.current !== owned) return;
      setImportText(text);
      previewImport(text);
    } catch (caught) {
      if (fileGeneration.current === owned) failImport((caught as Error).message);
    }
  };

  const copy = async () => {
    setCopied(false);
    try {
      if (!validation.success || !validation.canonicalData) throw Error('Resolve validation errors before exporting.');
      await navigator.clipboard.writeText(canonicalStrategyJSON(validation.canonicalData));
      setCopied(true);
    } catch (caught) {
      setError('Export was not copied: ' + (caught as Error).message);
    }
  };

  const stop = strategy.risk.stopLoss;
  const sizing = strategy.risk.positionSizing;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-24 sm:p-6">
      <header className={card}>
        <h1 className="text-xl font-semibold tracking-tight text-[#ececed]">Strategy builder</h1>
        <p className="text-xs leading-relaxed text-neutral-400">
          Daily, long-only, cash-funded market-order research. Signals form at close and fill at the next open. No live broker orders.
        </p>
        <label className="text-xs">
          Strategy name
          <input aria-label="Strategy name" className={control} value={strategy.name} maxLength={200} onChange={event => update({ name: event.target.value })} />
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-primary-mint" disabled={isLoading || !validation.success} onClick={onRunBacktest}>
            {isLoading ? 'Running research…' : 'Run backtest'}
          </button>
          <button type="button" className={secondaryButton} onClick={() => void copy()} disabled={!validation.success}>
            {copied ? 'Copied validated JSON' : 'Copy validated JSON'}
          </button>
        </div>
      </header>

      {(error || !validation.success) && (
        <section role="alert" className="space-y-1 rounded-lg border border-rose-400/30 p-3 text-xs text-rose-300">
          {error && <p>{error}</p>}
          {validation.errors?.map((message, index) => <p key={index}>{message}</p>)}
        </section>
      )}

      <section className={card}>
        <h2 className="font-semibold text-[#ececed]">Indicators</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[180px] flex-1 text-xs">
            Indicator type
            <select aria-label="New indicator type" className={control} value={newType} onChange={event => setNewType(event.target.value as IndicatorType)}>
              {Object.keys(INDICATOR_REGISTRY).map(type => <option key={type}>{type}</option>)}
            </select>
          </label>
          <button type="button" onClick={addIndicator} className={secondaryButton}>Add indicator</button>
        </div>
        {strategy.indicators.map((indicator, index) => (
          <fieldset key={index} className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 p-3 sm:grid-cols-4">
            <legend className="px-1 text-xs text-neutral-300">{indicator.type}, unit: {INDICATOR_REGISTRY[indicator.type].unit}</legend>
            <label className="text-xs">
              ID
              <input aria-label={`Indicator ID ${index + 1}`} className={control} value={indicator.id} onChange={event => update({ indicators: strategy.indicators.map((item, itemIndex) => itemIndex === index ? { ...item, id: event.target.value } : item) })} />
            </label>
            {Object.entries(indicator.params).map(([param, value]) => (
              <label key={param} className="text-xs">
                {param}
                <input aria-label={`${indicator.id} ${param}`} className={control} type="number" step="any" value={value} onChange={event => update({ indicators: strategy.indicators.map((item, itemIndex) => itemIndex === index ? { ...item, params: { ...item.params, [param]: Number(event.target.value) } } : item) })} />
              </label>
            ))}
            <button type="button" onClick={() => removeIndicator(indicator.id)} className="btn-ghost-quant justify-self-start text-xs sm:col-span-4">Remove {indicator.id}</button>
          </fieldset>
        ))}
      </section>

      {(['entry', 'exit'] as const).map(group => (
        <section key={group} className={card}>
          <h2 className="font-semibold capitalize text-[#ececed]">{group} rules: all conditions must match (AND)</h2>
          <p className="text-xs leading-relaxed text-neutral-400">Unavailable indicator outputs do not satisfy a rule. Crossovers require the previous completed bar.</p>
          {strategy.rules[group].map((rule, index) => (
            <RuleRow
              key={index}
              rule={rule}
              index={index}
              group={group}
              operands={operands}
              change={next => update({ rules: { ...strategy.rules, [group]: strategy.rules[group].map((item, itemIndex) => itemIndex === index ? next : item) } })}
              remove={() => update({ rules: { ...strategy.rules, [group]: strategy.rules[group].filter((_, itemIndex) => itemIndex !== index) } })}
            />
          ))}
          <button
            type="button"
            onClick={() => update({ rules: { ...strategy.rules, [group]: [...strategy.rules[group], { leftIndicator: 'close', operator: 'gt', rightValue: 0 }] } })}
            className={secondaryButton}
          >
            Add {group} rule
          </button>
        </section>
      ))}

      <section className={card}>
        <h2 className="font-semibold text-[#ececed]">Risk and sizing</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="text-xs">
            Stop loss unit
            <select
              aria-label="Stop loss type"
              className={control}
              value={stop.type}
              onChange={event => {
                const type = event.target.value as typeof stop.type;
                risk({ stopLoss: { type, value: stop.value, ...(type === 'atr' ? { atrPeriod: stop.atrPeriod ?? 14 } : {}) } });
              }}
            >
              <option value="percent">Percent of entry price</option>
              <option value="points">Price points</option>
              <option value="atr">Previous ATR multiple</option>
            </select>
          </label>
          <label className="text-xs">
            Stop loss value
            <input aria-label="Stop loss value" className={control} type="number" step="any" value={stop.value} onChange={event => risk({ stopLoss: { ...stop, value: Number(event.target.value) } })} />
          </label>
          {stop.type === 'atr' && (
            <label className="text-xs">
              Risk ATR period
              <input aria-label="Risk ATR period" className={control} type="number" min={1} value={stop.atrPeriod ?? 14} onChange={event => risk({ stopLoss: { ...stop, atrPeriod: Number(event.target.value) } })} />
            </label>
          )}
          <label className="text-xs">
            Position sizing
            <select
              aria-label="Position sizing"
              className={control}
              value={sizing.type}
              onChange={event => risk({ positionSizing: event.target.value === 'fixedQty' ? { type: 'fixedQty', quantity: 1 } : event.target.value === 'fixedRisk' ? { type: 'fixedRisk', riskPerTrade: 0.01 } : { type: 'fixedFraction', fraction: 0.15 } })}
            >
              <option value="fixedFraction">Allocation percent</option>
              <option value="fixedQty">Fixed whole units</option>
              <option value="fixedRisk">Stop-risk percent, including fees</option>
            </select>
          </label>
          <label className="text-xs">
            {sizing.type === 'fixedQty' ? 'Quantity' : sizing.type === 'fixedRisk' ? 'Risk percent' : 'Allocation percent'}
            <input
              aria-label="Position size value"
              className={control}
              type="number"
              step="any"
              value={sizing.type === 'fixedQty' ? sizing.quantity : (sizing.type === 'fixedRisk' ? sizing.riskPerTrade! : sizing.fraction!) * 100}
              onChange={event => {
                const value = Number(event.target.value);
                risk({ positionSizing: sizing.type === 'fixedQty' ? { type: 'fixedQty', quantity: value } : sizing.type === 'fixedRisk' ? { type: 'fixedRisk', riskPerTrade: value / 100 } : { type: 'fixedFraction', fraction: value / 100 } });
              }}
            />
          </label>
          <label className="text-xs">
            Drawdown cutoff (%), blank disables
            <input aria-label="Drawdown cutoff" className={control} type="number" value={strategy.risk.maxDrawdownCutoff ?? ''} onChange={event => risk({ maxDrawdownCutoff: event.target.value === '' ? null : Number(event.target.value) })} />
          </label>
        </div>

        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={!!strategy.risk.takeProfit} onChange={event => risk({ takeProfit: event.target.checked ? { type: 'percent', value: 5 } : null })} />
          Enable take profit
        </label>
        {strategy.risk.takeProfit && (
          <div className="flex flex-wrap gap-3">
            <label className="text-xs">
              Target unit
              <select aria-label="Take profit type" className={control} value={strategy.risk.takeProfit.type} onChange={event => risk({ takeProfit: { ...strategy.risk.takeProfit!, type: event.target.value as 'percent' | 'points' | 'rr' } })}>
                <option value="percent">Percent</option>
                <option value="points">Points</option>
                <option value="rr">Initial stop-distance multiple</option>
              </select>
            </label>
            <label className="text-xs">
              Target value
              <input aria-label="Take profit value" className={control} type="number" step="any" value={strategy.risk.takeProfit.value} onChange={event => risk({ takeProfit: { ...strategy.risk.takeProfit!, value: Number(event.target.value) } })} />
            </label>
          </div>
        )}

        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={!!strategy.risk.trailingStop} onChange={event => risk({ trailingStop: event.target.checked ? { type: 'percent', value: 2 } : null })} />
          Enable trailing stop, changes active next bar
        </label>
        {strategy.risk.trailingStop && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs">
              Trail unit
              <select
                aria-label="Trailing stop type"
                className={control}
                value={strategy.risk.trailingStop.type}
                onChange={event => {
                  const type = event.target.value as 'percent' | 'points' | 'atr';
                  risk({ trailingStop: { type, value: strategy.risk.trailingStop!.value, ...(type === 'atr' ? { atrPeriod: 14 } : {}) } });
                }}
              >
                <option value="percent">Percent below high-water mark</option>
                <option value="points">Points</option>
                <option value="atr">ATR multiple</option>
              </select>
            </label>
            <label className="text-xs">
              Trail value
              <input aria-label="Trailing stop value" className={control} type="number" step="any" value={strategy.risk.trailingStop.value} onChange={event => risk({ trailingStop: { ...strategy.risk.trailingStop!, value: Number(event.target.value) } })} />
            </label>
            {strategy.risk.trailingStop.type === 'atr' && (
              <label className="text-xs">
                Trailing ATR period
                <input aria-label="Trailing ATR period" className={control} type="number" value={strategy.risk.trailingStop.atrPeriod ?? 14} onChange={event => risk({ trailingStop: { ...strategy.risk.trailingStop!, atrPeriod: Number(event.target.value) } })} />
              </label>
            )}
            <label className="text-xs">
              Activation excursion (%)
              <input aria-label="Trailing activation percent" className={control} type="number" step="any" value={strategy.risk.trailingStop.activation ?? 0} onChange={event => risk({ trailingStop: { ...strategy.risk.trailingStop!, activation: Number(event.target.value) } })} />
            </label>
          </div>
        )}
        <p className="text-xs leading-relaxed text-neutral-400">Stop/target ambiguity uses stop-first. Gaps and fees can exceed a drawdown cutoff. Tick, lot, margin and settlement rules are not verified.</p>
      </section>

      <section className={card}>
        <h2 className="font-semibold text-[#ececed]">Cost assumptions</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">
            Slippage basis points, each fill
            <input aria-label="Slippage basis points" className={control} type="number" value={strategy.costs.slippageBps} onChange={event => update({ costs: { ...strategy.costs, slippageBps: Number(event.target.value) } })} />
          </label>
          <label className="text-xs">
            Flat brokerage (INR), each fill
            <input aria-label="Brokerage per fill" className={control} type="number" value={strategy.costs.brokerageFlat} onChange={event => update({ costs: { ...strategy.costs, brokerageFlat: Number(event.target.value) } })} />
          </label>
        </div>
        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={strategy.costs.applyIndianTaxes} onChange={event => update({ costs: { ...strategy.costs, applyIndianTaxes: event.target.checked } })} />
          Include illustrative, unverified Indian cash-fee rates
        </label>
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-100/90">
          No certified statutory or broker schedule is installed. DP and other broker-specific charges are excluded. Slippage is in fills, not debited twice.
        </p>
      </section>

      <section className={card}>
        <h2 className="font-semibold text-[#ececed]">Import with review</h2>
        <p className="text-xs leading-relaxed text-neutral-400">Import replaces the current strategy and its symbol only after confirmation. Invalid definitions are never repaired.</p>
        <label className="block text-xs">
          Strategy JSON
          <textarea
            ref={importRef}
            aria-label="Strategy JSON import"
            aria-invalid={Boolean(importError)}
            aria-describedby={importError ? 'import-error' : undefined}
            className={`${control} font-mono text-xs ${importError ? 'border-rose-400/60' : ''}`}
            rows={4}
            value={importText}
            onChange={event => {
              fileGeneration.current++;
              setImportText(event.target.value);
              setImportError('');
              setPreview(null);
            }}
          />
        </label>
        {importError && (
          <p id="import-error" role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/5 px-3 py-2 text-xs leading-relaxed text-rose-200">
            {importError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${secondaryButton} cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-[#a8c7fa]`}>
            <span>Choose JSON file</span>
            <input
              aria-label="Import strategy file"
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={event => void readFile(event.target.files?.[0])}
            />
          </label>
          <span className="max-w-full truncate text-xs text-neutral-400">{fileName || 'No file selected'}</span>
          <button type="button" className={secondaryButton} onClick={() => { fileGeneration.current++; previewImport(importText); }}>
            Preview import
          </button>
        </div>

        {preview && (
          <article aria-label="Import preview" className="space-y-2 rounded-lg border border-[#a8c7fa]/30 p-3 text-xs">
            <h3 className="font-semibold text-[#ececed]">Replace with {preview.strategy.name}, symbol {preview.strategy.universe.symbolId}</h3>
            {preview.warnings.map((warning, index) => <p key={index} className="text-amber-200/90">{warning}</p>)}
            <details>
              <summary className="cursor-pointer text-[#a8c7fa]">Review complete definition</summary>
              <pre className="whitespace-pre-wrap break-all">{JSON.stringify(preview.strategy, null, 2)}</pre>
            </details>
            {preview.source !== JSON.stringify(strategy) && <p role="alert" className="text-amber-300">Workspace changed. Preview again before applying.</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary-mint"
                disabled={preview.source !== JSON.stringify(strategy)}
                onClick={() => {
                  onChange(snapshotStrategy(preview.strategy));
                  setPreview(null);
                  setImportText('');
                  setFileName('');
                }}
              >
                Confirm import
              </button>
              <button type="button" className={secondaryButton} onClick={() => { fileGeneration.current++; setPreview(null); }}>
                Cancel import
              </button>
            </div>
          </article>
        )}
      </section>
    </div>
  );
};
