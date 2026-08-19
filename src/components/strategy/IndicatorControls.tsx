import React from 'react';
import { Plus, Trash2, Sliders, Info, Compass } from 'lucide-react';
import { IndicatorConfig, IndicatorType } from '../../shared/strategy/types';
import { FinanceTooltip } from '../common/Tooltip';

interface IndicatorControlsProps {
  indicators: IndicatorConfig[];
  onChange: (indicators: IndicatorConfig[]) => void;
}

export const IndicatorControls: React.FC<IndicatorControlsProps> = ({ indicators, onChange }) => {
  const handleAddIndicator = (type: IndicatorType) => {
    const nextIdx = indicators.length + 1;
    const newId = `${type.toLowerCase()}${nextIdx}`;

    let defaultParams: Record<string, number> = {};
    if (type === 'RSI') defaultParams = { period: 14 };
    else if (type === 'SMA') defaultParams = { period: 20 };
    else if (type === 'EMA') defaultParams = { period: 20 };
    else if (type === 'SUPERTREND') defaultParams = { period: 10, multiplier: 3 };
    else if (type === 'ATR') defaultParams = { period: 14 };
    else if (type === 'BBANDS') defaultParams = { period: 20, stdDev: 2 };
    else if (type === 'MACD') defaultParams = { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 };

    onChange([...indicators, { id: newId, type, params: defaultParams }]);
  };

  const handleRemove = (id: string) => {
    onChange(indicators.filter(i => i.id !== id));
  };

  const handleParamChange = (id: string, paramKey: string, val: number) => {
    onChange(
      indicators.map(ind => {
        if (ind.id === id) {
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
    );
  };

  return (
    <div className="space-y-4">
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label-quant !mb-0">ACTIVE INDICATORS ({indicators.length})</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {(['SUPERTREND', 'ATR', 'RSI', 'EMA', 'SMA', 'BBANDS', 'MACD'] as IndicatorType[]).map(type => (
            <button
              key={type}
              type="button"
              onClick={() => handleAddIndicator(type)}
              className="btn-ghost-quant !text-[10px] !py-1 !px-2 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              <span>+{type}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Indicators List */}
      {indicators.length === 0 ? (
        <div className="p-6 text-center border border-dashed border-[rgba(236,236,237,0.1)] rounded-xl bg-[#141417] text-neutral-400 text-xs font-mono">
          No custom indicators configured. Click buttons above to add Supertrend, ATR, RSI, or Moving Averages.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {indicators.map(ind => (
            <div
              key={ind.id}
              className="p-4 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl shadow-sm hover:border-[rgba(236,236,237,0.16)] transition-all space-y-3"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-[rgba(236,236,237,0.08)] pb-2">
                <div className="flex items-center gap-2">
                  <span className="badge-mint font-mono">
                    {ind.type}
                  </span>
                  <span className="text-xs text-neutral-400 font-mono">[{ind.id}]</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(ind.id)}
                  className="p-1 text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                  title="Remove Indicator"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Dynamic Parameter Sliders & Number Inputs */}
              <div className="space-y-2.5">
                {ind.type === 'SUPERTREND' && (
                  <>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-neutral-300 font-mono text-[11px] flex items-center gap-1">
                          ATR PERIOD
                          <FinanceTooltip content="Lookback period for Average True Range volatility calculation." />
                        </span>
                        <span className="font-mono text-[#00ffa3] font-semibold">{ind.params.period || 10}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="2"
                          max="50"
                          value={ind.params.period || 10}
                          onChange={e => handleParamChange(ind.id, 'period', Number(e.target.value))}
                          className="flex-1 accent-[#00ffa3] cursor-pointer h-1.5 bg-[#1d1d21] rounded-lg"
                        />
                        <input
                          type="number"
                          min="2"
                          max="50"
                          value={ind.params.period || 10}
                          onChange={e => handleParamChange(ind.id, 'period', Number(e.target.value))}
                          className="w-14 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-0.5 text-xs text-right font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-neutral-300 font-mono text-[11px] flex items-center gap-1">
                          MULTIPLIER
                          <FinanceTooltip content="ATR multiplier determining the distance of the trailing bands." />
                        </span>
                        <span className="font-mono text-[#00ffa3] font-semibold">{ind.params.multiplier || 3}x</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="0.5"
                          value={ind.params.multiplier || 3}
                          onChange={e => handleParamChange(ind.id, 'multiplier', Number(e.target.value))}
                          className="flex-1 accent-[#00ffa3] cursor-pointer h-1.5 bg-[#1d1d21] rounded-lg"
                        />
                        <input
                          type="number"
                          min="1"
                          max="10"
                          step="0.5"
                          value={ind.params.multiplier || 3}
                          onChange={e => handleParamChange(ind.id, 'multiplier', Number(e.target.value))}
                          className="w-14 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-0.5 text-xs text-right font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                        />
                      </div>
                    </div>
                  </>
                )}

                {(ind.type === 'SMA' || ind.type === 'EMA' || ind.type === 'RSI' || ind.type === 'ATR') && (
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-neutral-300 font-mono text-[11px] flex items-center gap-1">
                        {ind.type} PERIOD (LOOKBACK BARS)
                        <FinanceTooltip content={`Number of bars used to calculate the ${ind.type} series.`} />
                      </span>
                      <span className="font-mono text-[#00ffa3] font-semibold">{ind.params.period || 14}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="2"
                        max="200"
                        value={ind.params.period || 14}
                        onChange={e => handleParamChange(ind.id, 'period', Number(e.target.value))}
                        className="flex-1 accent-[#00ffa3] cursor-pointer h-1.5 bg-[#1d1d21] rounded-lg"
                      />
                      <input
                        type="number"
                        min="2"
                        max="200"
                        value={ind.params.period || 14}
                        onChange={e => handleParamChange(ind.id, 'period', Number(e.target.value))}
                        className="w-14 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-0.5 text-xs text-right font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {ind.type === 'BBANDS' && (
                  <>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-neutral-300 font-mono text-[11px]">PERIOD (SMA BASE)</span>
                        <span className="font-mono text-[#00ffa3] font-semibold">{ind.params.period || 20}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="5"
                          max="100"
                          value={ind.params.period || 20}
                          onChange={e => handleParamChange(ind.id, 'period', Number(e.target.value))}
                          className="flex-1 accent-[#00ffa3] cursor-pointer h-1.5 bg-[#1d1d21] rounded-lg"
                        />
                        <input
                          type="number"
                          value={ind.params.period || 20}
                          onChange={e => handleParamChange(ind.id, 'period', Number(e.target.value))}
                          className="w-14 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-0.5 text-xs text-right font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-neutral-300 font-mono text-[11px]">STANDARD DEVIATIONS (σ)</span>
                        <span className="font-mono text-[#00ffa3] font-semibold">{ind.params.stdDev || 2}σ</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="0.5"
                          max="4"
                          step="0.1"
                          value={ind.params.stdDev || 2}
                          onChange={e => handleParamChange(ind.id, 'stdDev', Number(e.target.value))}
                          className="flex-1 accent-[#00ffa3] cursor-pointer h-1.5 bg-[#1d1d21] rounded-lg"
                        />
                        <input
                          type="number"
                          step="0.1"
                          value={ind.params.stdDev || 2}
                          onChange={e => handleParamChange(ind.id, 'stdDev', Number(e.target.value))}
                          className="w-14 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-0.5 text-xs text-right font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                        />
                      </div>
                    </div>
                  </>
                )}

                {ind.type === 'MACD' && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="text-[11px] text-neutral-400 font-mono block mb-1">FAST EMA</span>
                      <input
                        type="number"
                        min="2"
                        max="50"
                        value={ind.params.fastPeriod || 12}
                        onChange={e => handleParamChange(ind.id, 'fastPeriod', Number(e.target.value))}
                        className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                      />
                    </div>
                    <div>
                      <span className="text-[11px] text-neutral-400 font-mono block mb-1">SLOW EMA</span>
                      <input
                        type="number"
                        min="10"
                        max="100"
                        value={ind.params.slowPeriod || 26}
                        onChange={e => handleParamChange(ind.id, 'slowPeriod', Number(e.target.value))}
                        className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                      />
                    </div>
                    <div>
                      <span className="text-[11px] text-neutral-400 font-mono block mb-1">SIGNAL EMA</span>
                      <input
                        type="number"
                        min="2"
                        max="30"
                        value={ind.params.signalPeriod || 9}
                        onChange={e => handleParamChange(ind.id, 'signalPeriod', Number(e.target.value))}
                        className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
