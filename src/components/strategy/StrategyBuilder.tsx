import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Trash2,
  CheckCircle2,
  Copy,
  Check,
  ChevronDown
} from 'lucide-react';
import {
  StrategyAST,
  IndicatorConfig,
  RuleNode,
  RuleOperator,
  Timeframe,
  IndicatorType,
  PriceField
} from '../../shared/strategy/types';

interface StrategyBuilderProps {
  strategy: StrategyAST;
  onChange: (strategy: StrategyAST) => void;
  onRunBacktest: () => void;
  isLoading: boolean;
}

const AVAILABLE_INDICATORS: { type: IndicatorType; label: string; defaultParams: Record<string, number>; defaultId: string }[] = [
  { type: 'SUPERTREND', label: 'Supertrend', defaultParams: { period: 10, multiplier: 3 }, defaultId: 'st1' },
  { type: 'EMA', label: 'Exponential MA (EMA)', defaultParams: { period: 200 }, defaultId: 'ema200' },
  { type: 'VOLUME_SMA', label: 'Simple MA (Volume)', defaultParams: { period: 20 }, defaultId: 'vol_sma' },
  { type: 'SMA', label: 'Simple MA (SMA)', defaultParams: { period: 50 }, defaultId: 'sma50' },
  { type: 'RSI', label: 'Relative Strength (RSI)', defaultParams: { period: 14, overbought: 70, oversold: 30 }, defaultId: 'rsi14' },
  { type: 'MACD', label: 'MACD Oscillator', defaultParams: { fast: 12, slow: 26, signal: 9 }, defaultId: 'macd1' },
  { type: 'BBANDS', label: 'Bollinger Bands', defaultParams: { period: 20, stdDev: 2 }, defaultId: 'bb1' },
  { type: 'ATR', label: 'Average True Range (ATR)', defaultParams: { period: 14 }, defaultId: 'atr14' }
];

const PRICE_FIELDS: { value: PriceField; label: string }[] = [
  { value: 'close', label: 'Close Price' },
  { value: 'open', label: 'Open Price' },
  { value: 'high', label: 'High Price' },
  { value: 'low', label: 'Low Price' },
  { value: 'volume', label: 'Volume' }
];

const OPERATORS: { value: RuleOperator; label: string; symbol: string }[] = [
  { value: 'gt', label: 'Greater than (>)', symbol: '>' },
  { value: 'gte', label: 'Greater or Equal (>=)', symbol: '>=' },
  { value: 'lt', label: 'Less than (<)', symbol: '<' },
  { value: 'lte', label: 'Less or Equal (<=)', symbol: '<=' },
  { value: 'crossesAbove', label: 'Crosses Above', symbol: 'Crosses Above' },
  { value: 'crossesBelow', label: 'Crosses Below', symbol: 'Crosses Below' },
  { value: 'eq', label: 'Equal (==)', symbol: '==' }
];

const getIndicatorDisplayName = (type: IndicatorType): string => {
  switch (type) {
    case 'SUPERTREND': return 'Supertrend';
    case 'EMA': return 'Exponential MA';
    case 'VOLUME_SMA': return 'Simple MA (Volume)';
    case 'SMA': return 'Simple MA';
    case 'RSI': return 'Relative Strength Index';
    case 'MACD': return 'MACD';
    case 'BBANDS': return 'Bollinger Bands';
    case 'ATR': return 'ATR';
    default: return type;
  }
};

export const StrategyBuilder: React.FC<StrategyBuilderProps> = ({
  strategy,
  onChange,
  onRunBacktest,
  isLoading
}) => {
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');
  const [lastSavedTime, setLastSavedTime] = useState<string>(() => {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  });
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isAddIndicatorOpen, setIsAddIndicatorOpen] = useState<boolean>(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-save mechanism: persists StrategyAST to browser localStorage on change
  useEffect(() => {
    setSaveStatus('saving');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem('stragy_active_strategy', JSON.stringify(strategy));
        setSaveStatus('saved');
        setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      } catch {
        setSaveStatus('saved');
      }
    }, 1000);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [strategy]);

  const handleCopyJSON = () => {
    try {
      navigator.clipboard.writeText(JSON.stringify(strategy, null, 2));
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {}
  };

  // Add an indicator
  const handleAddIndicator = (template: typeof AVAILABLE_INDICATORS[0]) => {
    let count = 1;
    let candidateId = template.defaultId;
    while (strategy.indicators.some(ind => ind.id === candidateId)) {
      count++;
      candidateId = `${template.defaultId}_${count}`;
    }
    const newIndicator: IndicatorConfig = {
      id: candidateId,
      type: template.type,
      params: { ...template.defaultParams }
    };
    onChange({
      ...strategy,
      indicators: [...strategy.indicators, newIndicator]
    });
    setIsAddIndicatorOpen(false);
  };

  // Remove an indicator
  const handleRemoveIndicator = (indicatorId: string) => {
    onChange({
      ...strategy,
      indicators: strategy.indicators.filter(ind => ind.id !== indicatorId)
    });
  };

  // Update an indicator parameter
  const handleIndicatorParamChange = (indicatorId: string, paramKey: string, val: number) => {
    onChange({
      ...strategy,
      indicators: strategy.indicators.map(ind => {
        if (ind.id === indicatorId) {
          return {
            ...ind,
            params: {
              ...ind.params,
              [paramKey]: val
            }
          };
        }
        return ind;
      })
    });
  };

  // Entry Rule Updates
  const handleUpdateEntryRule = (index: number, updated: Partial<RuleNode>) => {
    const newEntry = [...strategy.rules.entry];
    newEntry[index] = { ...newEntry[index], ...updated };
    onChange({
      ...strategy,
      rules: { ...strategy.rules, entry: newEntry }
    });
  };

  const handleRemoveEntryRule = (index: number) => {
    if (strategy.rules.entry.length <= 1) return;
    const newEntry = strategy.rules.entry.filter((_, idx) => idx !== index);
    onChange({
      ...strategy,
      rules: { ...strategy.rules, entry: newEntry }
    });
  };

  const handleAddEntryRule = () => {
    const firstInd = strategy.indicators[0];
    const newRule: RuleNode = {
      id: `entry_${Date.now()}`,
      leftIndicator: 'close',
      operator: 'gt',
      rightIndicator: firstInd ? firstInd.id : undefined,
      rightValue: firstInd ? undefined : 100
    };
    onChange({
      ...strategy,
      rules: {
        ...strategy.rules,
        entry: [...strategy.rules.entry, newRule]
      }
    });
  };

  // Exit Rule Updates
  const handleUpdateExitRule = (index: number, updated: Partial<RuleNode>) => {
    const newExit = [...strategy.rules.exit];
    newExit[index] = { ...newExit[index], ...updated };
    onChange({
      ...strategy,
      rules: { ...strategy.rules, exit: newExit }
    });
  };

  const handleRemoveExitRule = (index: number) => {
    if (strategy.rules.exit.length <= 1) return;
    const newExit = strategy.rules.exit.filter((_, idx) => idx !== index);
    onChange({
      ...strategy,
      rules: { ...strategy.rules, exit: newExit }
    });
  };

  const handleAddExitRule = () => {
    const firstInd = strategy.indicators[0];
    const newRule: RuleNode = {
      id: `exit_${Date.now()}`,
      leftIndicator: 'close',
      operator: 'lt',
      rightIndicator: firstInd ? firstInd.id : undefined,
      rightValue: firstInd ? undefined : 100
    };
    onChange({
      ...strategy,
      rules: {
        ...strategy.rules,
        exit: [...strategy.rules.exit, newRule]
      }
    });
  };

  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1H', '1D', '1W'];

  return (
    <div className="p-6 sm:p-10 max-w-6xl mx-auto space-y-6">
      {/* 1. Hero Section matching Variation */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="font-mono text-[11px] text-[#00ffa3] uppercase tracking-wider font-bold">
            STRATEGY WORKSPACE
          </span>
          <div className="flex items-center gap-2">
            {/* Auto-Save Status Badge */}
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-medium px-2.5 py-1 rounded bg-[#00ffa3]/10 text-[#00ffa3] border border-[#00ffa3]/20">
              <CheckCircle2 className="w-3 h-3 text-[#00ffa3]" />
              <span>Auto-saved • {lastSavedTime}</span>
            </div>

            {/* Timeframe Quick Switcher */}
            <div className="flex items-center bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] rounded-lg p-0.5">
              {timeframes.map(tf => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => onChange({ ...strategy, universe: { ...strategy.universe, timeframe: tf } })}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold transition-all ${
                    strategy.universe.timeframe === tf
                      ? 'bg-[#00ffa3] text-[#0c0c0e]'
                      : 'text-neutral-400 hover:text-[#ececed]'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            {/* Copy AST Button */}
            <button
              type="button"
              onClick={handleCopyJSON}
              className="px-2.5 py-1 rounded bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] hover:border-neutral-700 text-neutral-400 hover:text-[#ececed] font-mono text-[11px] flex items-center gap-1"
              title="Copy Strategy AST JSON"
            >
              {isCopied ? <Check className="w-3 h-3 text-[#00ffa3]" /> : <Copy className="w-3 h-3" />}
              <span>{isCopied ? 'Copied' : 'JSON'}</span>
            </button>
          </div>
        </div>

        {/* Editable Strategy Title */}
        <input
          type="text"
          value={strategy.name}
          onChange={e => onChange({ ...strategy, name: e.target.value })}
          placeholder="Strategy Name"
          className="font-syne font-extrabold text-2xl sm:text-4xl text-[#ececed] tracking-[-0.04em] bg-transparent border-b border-transparent hover:border-neutral-800 focus:border-[#00ffa3] focus:outline-none w-full py-1"
        />

        <p className="text-[13px] text-[rgba(236,236,237,0.6)] max-w-2xl leading-relaxed">
          {strategy.description || 'Supertrend(10,3) bullish signal above 200 EMA with volume expansion and dynamic trailing stop.'}
        </p>
      </div>

      {/* 2. Indicators & Parameters Card matching Variation */}
      <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl overflow-hidden">
        <div className="p-4 sm:px-6 border-b border-[rgba(236,236,237,0.08)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00ffa3" strokeWidth="2.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
            <span className="font-semibold text-sm text-[#ececed]">Indicators & Parameters</span>
            <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded bg-[rgba(0,255,163,0.1)] text-[#00ffa3] border border-[rgba(0,255,163,0.25)] font-bold">
              {strategy.indicators.length} Active
            </span>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setIsAddIndicatorOpen(prev => !prev)}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-transparent border border-[rgba(236,236,237,0.12)] text-[#ececed] hover:border-[#00ffa3] hover:text-[#00ffa3] transition-all flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Indicator +</span>
            </button>

            {/* Dropdown Menu */}
            {isAddIndicatorOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-[#141417] border border-[rgba(236,236,237,0.12)] rounded-xl shadow-2xl z-50 p-1.5 space-y-1">
                <div className="text-[10px] font-mono font-bold text-neutral-400 px-2 py-1 uppercase">
                  Select Indicator
                </div>
                {AVAILABLE_INDICATORS.map(template => (
                  <button
                    key={template.type}
                    type="button"
                    onClick={() => handleAddIndicator(template)}
                    className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-[#ececed] hover:bg-[#1d1d21] hover:text-[#00ffa3] transition-all flex items-center justify-between"
                  >
                    <span>{template.label}</span>
                    <span className="font-mono text-[10px] text-neutral-500">{template.defaultId}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {strategy.indicators.map(ind => (
              <div
                key={ind.id}
                className="bg-[#1d1d21] p-3.5 rounded-xl border border-[rgba(236,236,237,0.08)] relative group hover:border-[rgba(236,236,237,0.16)] transition-all"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-[#ececed]">{getIndicatorDisplayName(ind.type)}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded bg-[rgba(0,255,163,0.1)] text-[#00ffa3] border border-[rgba(0,255,163,0.25)] font-bold">
                      {ind.id}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveIndicator(ind.id)}
                      className="text-neutral-500 hover:text-rose-400 p-0.5 rounded opacity-60 group-hover:opacity-100 transition-opacity"
                      title="Remove Indicator"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Indicator Parameter Inputs */}
                {ind.type === 'SUPERTREND' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="font-mono text-[10px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                        ATR Period
                      </span>
                      <input
                        type="number"
                        value={ind.params.period ?? 10}
                        onChange={e => handleIndicatorParamChange(ind.id, 'period', parseInt(e.target.value, 10) || 1)}
                        className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-2.5 py-1 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                      />
                    </div>
                    <div>
                      <span className="font-mono text-[10px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                        Multiplier
                      </span>
                      <input
                        type="number"
                        step="0.1"
                        value={ind.params.multiplier ?? 3}
                        onChange={e => handleIndicatorParamChange(ind.id, 'multiplier', parseFloat(e.target.value) || 1)}
                        className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-2.5 py-1 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {(ind.type === 'EMA' || ind.type === 'SMA' || ind.type === 'VOLUME_SMA') && (
                  <div>
                    <span className="font-mono text-[10px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                      Period
                    </span>
                    <input
                      type="number"
                      value={ind.params.period ?? 20}
                      onChange={e => handleIndicatorParamChange(ind.id, 'period', parseInt(e.target.value, 10) || 1)}
                      className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-2.5 py-1 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                    />
                  </div>
                )}

                {ind.type === 'RSI' && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <div>
                      <span className="font-mono text-[9px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                        Period
                      </span>
                      <input
                        type="number"
                        value={ind.params.period ?? 14}
                        onChange={e => handleIndicatorParamChange(ind.id, 'period', parseInt(e.target.value, 10) || 1)}
                        className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                      />
                    </div>
                    <div>
                      <span className="font-mono text-[9px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                        Overbought
                      </span>
                      <input
                        type="number"
                        value={ind.params.overbought ?? 70}
                        onChange={e => handleIndicatorParamChange(ind.id, 'overbought', parseInt(e.target.value, 10) || 70)}
                        className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                      />
                    </div>
                    <div>
                      <span className="font-mono text-[9px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                        Oversold
                      </span>
                      <input
                        type="number"
                        value={ind.params.oversold ?? 30}
                        onChange={e => handleIndicatorParamChange(ind.id, 'oversold', parseInt(e.target.value, 10) || 30)}
                        className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {ind.type === 'MACD' && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <div>
                      <span className="font-mono text-[9px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                        Fast
                      </span>
                      <input
                        type="number"
                        value={ind.params.fast ?? 12}
                        onChange={e => handleIndicatorParamChange(ind.id, 'fast', parseInt(e.target.value, 10) || 12)}
                        className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                      />
                    </div>
                    <div>
                      <span className="font-mono text-[9px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                        Slow
                      </span>
                      <input
                        type="number"
                        value={ind.params.slow ?? 26}
                        onChange={e => handleIndicatorParamChange(ind.id, 'slow', parseInt(e.target.value, 10) || 26)}
                        className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                      />
                    </div>
                    <div>
                      <span className="font-mono text-[9px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                        Signal
                      </span>
                      <input
                        type="number"
                        value={ind.params.signal ?? 9}
                        onChange={e => handleIndicatorParamChange(ind.id, 'signal', parseInt(e.target.value, 10) || 9)}
                        className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {ind.type !== 'SUPERTREND' && ind.type !== 'EMA' && ind.type !== 'SMA' && ind.type !== 'VOLUME_SMA' && ind.type !== 'RSI' && ind.type !== 'MACD' && (
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(ind.params).map(([pk, pv]) => (
                      <div key={pk}>
                        <span className="font-mono text-[10px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                          {pk}
                        </span>
                        <input
                          type="number"
                          value={pv}
                          onChange={e => handleIndicatorParamChange(ind.id, pk, parseFloat(e.target.value) || 0)}
                          className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-2.5 py-1 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Trading Rules Card matching Variation */}
      <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl overflow-hidden">
        <div className="p-4 sm:px-6 border-b border-[rgba(236,236,237,0.08)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00ffa3" strokeWidth="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
              <path d="M2 17l10 5 10-5"></path>
              <path d="M2 12l10 5 10-5"></path>
            </svg>
            <span className="font-semibold text-sm text-[#ececed]">Trading Rules</span>
          </div>
        </div>

        <div className="p-5 sm:p-6 space-y-6">
          {/* Entry Criteria Section */}
          <div>
            <span className="font-mono text-[11px] text-[#00ffa3] uppercase tracking-wider font-bold block mb-3">
              ENTRY CRITERIA (ALL MUST MATCH)
            </span>

            <div className="space-y-2">
              {strategy.rules.entry.map((rule, idx) => (
                <div
                  key={rule.id || `entry_${idx}`}
                  className="flex items-center gap-3 p-3 bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] rounded-xl flex-wrap text-xs"
                >
                  {/* Left Indicator / Field */}
                  <select
                    value={rule.leftIndicator}
                    onChange={e => handleUpdateEntryRule(idx, { leftIndicator: e.target.value })}
                    className="bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-3 py-1.5 font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                  >
                    <optgroup label="Price Fields">
                      {PRICE_FIELDS.map(pf => (
                        <option key={pf.value} value={pf.value}>{pf.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Active Indicators">
                      {strategy.indicators.map(ind => (
                        <option key={ind.id} value={ind.id}>
                          {getIndicatorDisplayName(ind.type)} ({ind.id})
                        </option>
                      ))}
                    </optgroup>
                  </select>

                  {/* Operator */}
                  <select
                    value={rule.operator}
                    onChange={e => handleUpdateEntryRule(idx, { operator: e.target.value as RuleOperator })}
                    className="bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-3 py-1.5 font-mono text-[#00ffa3] font-bold focus:border-[#00ffa3] focus:outline-none"
                  >
                    {OPERATORS.map(op => (
                      <option key={op.value} value={op.value}>{op.symbol}</option>
                    ))}
                  </select>

                  {/* Right Indicator or Constant */}
                  <select
                    value={rule.rightIndicator ? `ind_${rule.rightIndicator}` : 'const'}
                    onChange={e => {
                      const val = e.target.value;
                      if (val.startsWith('ind_')) {
                        handleUpdateEntryRule(idx, {
                          rightIndicator: val.replace('ind_', ''),
                          rightValue: undefined
                        });
                      } else {
                        handleUpdateEntryRule(idx, {
                          rightIndicator: undefined,
                          rightValue: 100
                        });
                      }
                    }}
                    className="bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-3 py-1.5 font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                  >
                    <optgroup label="Price Fields">
                      {PRICE_FIELDS.map(pf => (
                        <option key={pf.value} value={`ind_${pf.value}`}>{pf.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Active Indicators">
                      {strategy.indicators.map(ind => (
                        <option key={ind.id} value={`ind_${ind.id}`}>
                          {getIndicatorDisplayName(ind.type)} ({ind.id})
                        </option>
                      ))}
                    </optgroup>
                    <option value="const">Constant Value</option>
                  </select>

                  {!rule.rightIndicator && (
                    <input
                      type="number"
                      value={rule.rightValue ?? 0}
                      onChange={e =>
                        handleUpdateEntryRule(idx, {
                          rightValue: parseFloat(e.target.value) || 0
                        })
                      }
                      className="w-20 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-2 py-1 font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => handleRemoveEntryRule(idx)}
                    className="ml-auto text-neutral-500 hover:text-rose-400 p-1 font-mono text-sm"
                    title="Remove condition"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddEntryRule}
              className="mt-3 px-3 py-1.5 rounded-md text-xs font-semibold bg-transparent border border-[rgba(236,236,237,0.08)] text-neutral-300 hover:border-[#00ffa3] hover:text-[#00ffa3] transition-all"
            >
              + Add Condition
            </button>
          </div>

          {/* Exit Criteria Section */}
          <div>
            <span className="font-mono text-[11px] text-[#ff4d4d] uppercase tracking-wider font-bold block mb-3">
              EXIT CRITERIA
            </span>

            <div className="space-y-2">
              {strategy.rules.exit.map((rule, idx) => (
                <div
                  key={rule.id || `exit_${idx}`}
                  className="flex items-center gap-3 p-3 bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] border-l-2 border-l-[#ff4d4d] rounded-xl flex-wrap text-xs"
                >
                  {/* Left Indicator / Field */}
                  <select
                    value={rule.leftIndicator}
                    onChange={e => handleUpdateExitRule(idx, { leftIndicator: e.target.value })}
                    className="bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-3 py-1.5 font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                  >
                    <optgroup label="Price Fields">
                      {PRICE_FIELDS.map(pf => (
                        <option key={pf.value} value={pf.value}>{pf.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Active Indicators">
                      {strategy.indicators.map(ind => (
                        <option key={ind.id} value={ind.id}>
                          {getIndicatorDisplayName(ind.type)} ({ind.id})
                        </option>
                      ))}
                    </optgroup>
                  </select>

                  {/* Operator in red */}
                  <select
                    value={rule.operator}
                    onChange={e => handleUpdateExitRule(idx, { operator: e.target.value as RuleOperator })}
                    className="bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-3 py-1.5 font-mono text-[#ff4d4d] font-bold focus:border-[#ff4d4d] focus:outline-none"
                  >
                    {OPERATORS.map(op => (
                      <option key={op.value} value={op.value}>{op.symbol}</option>
                    ))}
                  </select>

                  {/* Right Target */}
                  <select
                    value={rule.rightIndicator ? `ind_${rule.rightIndicator}` : 'const'}
                    onChange={e => {
                      const val = e.target.value;
                      if (val.startsWith('ind_')) {
                        handleUpdateExitRule(idx, {
                          rightIndicator: val.replace('ind_', ''),
                          rightValue: undefined
                        });
                      } else {
                        handleUpdateExitRule(idx, {
                          rightIndicator: undefined,
                          rightValue: 100
                        });
                      }
                    }}
                    className="bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-3 py-1.5 font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                  >
                    <optgroup label="Price Fields">
                      {PRICE_FIELDS.map(pf => (
                        <option key={pf.value} value={`ind_${pf.value}`}>{pf.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Active Indicators">
                      {strategy.indicators.map(ind => (
                        <option key={ind.id} value={`ind_${ind.id}`}>
                          {getIndicatorDisplayName(ind.type)} ({ind.id})
                        </option>
                      ))}
                    </optgroup>
                    <option value="const">Constant Value</option>
                  </select>

                  {!rule.rightIndicator && (
                    <input
                      type="number"
                      value={rule.rightValue ?? 0}
                      onChange={e =>
                        handleUpdateExitRule(idx, {
                          rightValue: parseFloat(e.target.value) || 0
                        })
                      }
                      className="w-20 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-2 py-1 font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => handleRemoveExitRule(idx)}
                    className="ml-auto text-neutral-500 hover:text-rose-400 p-1 font-mono text-sm"
                    title="Remove condition"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddExitRule}
              className="mt-3 px-3 py-1.5 rounded-md text-xs font-semibold bg-transparent border border-[rgba(236,236,237,0.08)] text-neutral-300 hover:border-rose-400 hover:text-rose-400 transition-all"
            >
              + Add Exit Condition
            </button>
          </div>
        </div>
      </div>

      {/* 4. Risk Controls & Execution Costs (2-Column Grid matching Variation) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Risk Controls Card */}
        <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl overflow-hidden">
          <div className="p-4 sm:px-6 border-b border-[rgba(236,236,237,0.08)]">
            <span className="font-semibold text-sm text-[#ececed]">Risk Controls</span>
          </div>

          <div className="p-5 sm:p-6 grid grid-cols-2 gap-4">
            <div>
              <span className="font-mono text-[10px] text-[#ff4d4d] uppercase tracking-wider block mb-1">
                Stop Loss
              </span>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  step="0.1"
                  value={strategy.risk.stopLoss.value}
                  onChange={e =>
                    onChange({
                      ...strategy,
                      risk: {
                        ...strategy.risk,
                        stopLoss: { type: 'percent', value: parseFloat(e.target.value) || 1 }
                      }
                    })
                  }
                  className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-2.5 py-1.5 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                />
                <span className="font-mono text-[11px] px-2 py-1 rounded bg-[rgba(0,255,163,0.1)] text-[#00ffa3] border border-[rgba(0,255,163,0.25)] font-bold flex items-center">
                  %
                </span>
              </div>
            </div>

            <div>
              <span className="font-mono text-[10px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                Trailing Stop
              </span>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  step="0.1"
                  value={strategy.risk.trailingStop?.value ?? 2.0}
                  onChange={e =>
                    onChange({
                      ...strategy,
                      risk: {
                        ...strategy.risk,
                        trailingStop: {
                          type: 'percent',
                          value: parseFloat(e.target.value) || 2.0
                        }
                      }
                    })
                  }
                  className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-2.5 py-1.5 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                />
                <span className="font-mono text-[11px] px-2 py-1 rounded bg-[rgba(0,255,163,0.1)] text-[#00ffa3] border border-[rgba(0,255,163,0.25)] font-bold flex items-center">
                  %
                </span>
              </div>
            </div>

            <div>
              <span className="font-mono text-[10px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                Take Profit
              </span>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  step="0.1"
                  value={strategy.risk.takeProfit?.value ?? 4.0}
                  onChange={e =>
                    onChange({
                      ...strategy,
                      risk: {
                        ...strategy.risk,
                        takeProfit: {
                          type: 'percent',
                          value: parseFloat(e.target.value) || 4.0
                        }
                      }
                    })
                  }
                  className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-2.5 py-1.5 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                />
                <span className="font-mono text-[11px] px-2 py-1 rounded bg-[rgba(0,255,163,0.1)] text-[#00ffa3] border border-[rgba(0,255,163,0.25)] font-bold flex items-center">
                  %
                </span>
              </div>
            </div>

            <div>
              <span className="font-mono text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                Max DD Cutoff
              </span>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  step="1"
                  value={strategy.risk.maxDrawdownCutoff ?? 15}
                  onChange={e =>
                    onChange({
                      ...strategy,
                      risk: {
                        ...strategy.risk,
                        maxDrawdownCutoff: parseFloat(e.target.value) || 15
                      }
                    })
                  }
                  className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-md px-2.5 py-1.5 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                />
                <span className="font-mono text-[11px] px-2 py-1 rounded bg-[rgba(0,255,163,0.1)] text-[#00ffa3] border border-[rgba(0,255,163,0.25)] font-bold flex items-center">
                  %
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Execution Costs (NSE) Card */}
        <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl overflow-hidden">
          <div className="p-4 sm:px-6 border-b border-[rgba(236,236,237,0.08)] flex items-center justify-between">
            <span className="font-semibold text-sm text-[#ececed]">Execution Costs (NSE)</span>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...strategy,
                  costs: {
                    ...strategy.costs,
                    tradeType: strategy.costs.tradeType === 'DELIVERY' ? 'INTRADAY' : 'DELIVERY'
                  }
                })
              }
              className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] text-[#00ffa3] hover:border-[#00ffa3]"
            >
              Toggle Mode
            </button>
          </div>

          <div className="p-5 sm:p-6 flex items-center gap-4 justify-between flex-wrap">
            <div className="flex-1 min-w-[120px]">
              <span className="font-mono text-[10px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                Mode
              </span>
              <div className="text-xs font-semibold text-[#ececed]">
                {strategy.costs.tradeType === 'DELIVERY' ? 'Delivery (Positional)' : 'Intraday (MIS)'}
              </div>
            </div>

            <div className="flex-1 min-w-[100px]">
              <span className="font-mono text-[10px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                Brokerage
              </span>
              <div className="text-xs font-semibold text-[#ececed]">
                ₹{strategy.costs.brokerageFlat} / order
              </div>
            </div>

            <div className="flex-1 min-w-[130px]">
              <span className="font-mono text-[10px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                Taxes
              </span>
              <div className="text-xs font-semibold text-[#ececed]">
                Standard STT + GST
              </div>
            </div>

            <div className="flex-1 min-w-[80px]">
              <span className="font-mono text-[10px] text-[#00ffa3] uppercase tracking-wider block mb-1">
                Slippage
              </span>
              <div className="text-xs font-mono font-semibold text-[#00ffa3]">
                {strategy.costs.slippageBps} bps
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
