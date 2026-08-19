import React from 'react';
import { Plus, Trash2, GitCompare, Code2, CornerDownRight } from 'lucide-react';
import { RuleNode, IndicatorConfig, RuleOperator } from '../../shared/strategy/types';
import { getIndicatorLabel } from '../../shared/strategy/renderPlainLanguage';

interface RuleBuilderProps {
  type: 'entry' | 'exit';
  rules: RuleNode[];
  indicators: IndicatorConfig[];
  onChange: (rules: RuleNode[]) => void;
}

export const RuleBuilder: React.FC<RuleBuilderProps> = ({ type, rules, indicators, onChange }) => {
  // Available left operands (Price fields + Candle shapes + Indicators + Sub-indicators)
  const availableOperands: { value: string; label: string; group: string }[] = [
    { value: 'close', label: 'Close Price', group: 'Price Action' },
    { value: 'open', label: 'Open Price', group: 'Price Action' },
    { value: 'high', label: 'High Price', group: 'Price Action' },
    { value: 'low', label: 'Low Price', group: 'Price Action' },
    { value: 'volume', label: 'Volume', group: 'Price Action' },
    { value: 'candleBody', label: 'Candle Body Height (|Close - Open|)', group: 'Candle Shape' },
    { value: 'upperWick', label: 'Upper Shadow / Wick Height', group: 'Candle Shape' },
    { value: 'lowerWick', label: 'Lower Shadow / Wick Height', group: 'Candle Shape' }
  ];

  for (const ind of indicators) {
    if (ind.type === 'BBANDS') {
      availableOperands.push(
        { value: `${ind.id}_upper`, label: `${ind.id} Upper Band`, group: 'Indicators' },
        { value: `${ind.id}_middle`, label: `${ind.id} Middle Band (SMA)`, group: 'Indicators' },
        { value: `${ind.id}_lower`, label: `${ind.id} Lower Band`, group: 'Indicators' }
      );
    } else if (ind.type === 'MACD') {
      availableOperands.push(
        { value: `${ind.id}_line`, label: `${ind.id} MACD Line`, group: 'Indicators' },
        { value: `${ind.id}_signal`, label: `${ind.id} Signal Line`, group: 'Indicators' },
        { value: `${ind.id}_hist`, label: `${ind.id} Histogram`, group: 'Indicators' }
      );
    } else {
      availableOperands.push({
        value: ind.id,
        label: `${ind.type} (${ind.id})`,
        group: 'Indicators'
      });
    }
  }

  const handleAddRule = () => {
    const defaultLeft = indicators[0]?.id || 'close';
    const newRule: RuleNode = {
      id: `rule_${Date.now()}`,
      leftIndicator: defaultLeft,
      operator: 'gt',
      rightValue: 50
    };
    onChange([...rules, newRule]);
  };

  const handleRemoveRule = (idx: number) => {
    const next = [...rules];
    next.splice(idx, 1);
    onChange(next);
  };

  const handleUpdateRule = (idx: number, patch: Partial<RuleNode>) => {
    const next = [...rules];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
              type === 'entry' ? 'bg-[#00ffa3]/10 text-[#00ffa3] border border-[#00ffa3]/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
            }`}
          >
            {type.toUpperCase()} CRITERIA ({rules.length})
          </span>
          <span className="text-[11px] text-neutral-400 hidden sm:inline">
            {type === 'entry' ? 'All conditions must match (AND) for next-bar entry' : 'Triggers immediate exit condition'}
          </span>
        </div>

        <button
          type="button"
          onClick={handleAddRule}
          className="btn-ghost-quant !text-xs !py-1 !px-2.5 flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Condition +</span>
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="p-4 border border-dashed border-[rgba(236,236,237,0.1)] rounded-xl bg-[#141417] text-center text-xs text-neutral-400 font-mono">
          {type === 'entry'
            ? 'No entry rules defined. Strategy will not enter trades.'
            : 'No exit rules defined. Exits will occur purely on Stop Loss, Take Profit, or Trailing Stop.'}
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule, idx) => {
            const isRightIndicator = rule.rightIndicator !== undefined;

            return (
              <div
                key={rule.id || idx}
                className={`p-3 bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] rounded-xl flex flex-wrap lg:flex-nowrap items-center gap-2.5 hover:border-[rgba(236,236,237,0.18)] transition-all text-xs ${
                  type === 'exit' ? 'border-l-2 border-l-[#ff4d4d]' : 'border-l-2 border-l-[#00ffa3]'
                }`}
              >
                <span className="w-5 h-5 rounded bg-[#0c0c0e] text-neutral-400 text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>

                {/* Left Indicator */}
                <div className="flex-1 min-w-[140px]">
                  <select
                    value={rule.leftIndicator}
                    onChange={e => handleUpdateRule(idx, { leftIndicator: e.target.value })}
                    className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-lg px-2.5 py-1.5 text-[#ececed] font-mono focus:border-[#00ffa3] focus:outline-none"
                  >
                    {availableOperands.map(op => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Operator */}
                <div className="w-[150px]">
                  <select
                    value={rule.operator}
                    onChange={e => handleUpdateRule(idx, { operator: e.target.value as RuleOperator })}
                    className={`w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-lg px-2.5 py-1.5 font-mono font-bold focus:border-[#00ffa3] focus:outline-none ${
                      type === 'exit' ? 'text-rose-400' : 'text-[#00ffa3]'
                    }`}
                  >
                    <option value="gt">&gt; (is greater than)</option>
                    <option value="gte">&ge; (greater or equal)</option>
                    <option value="lt">&lt; (is less than)</option>
                    <option value="lte">&le; (less or equal)</option>
                    <option value="crossesAbove">crosses above ↑</option>
                    <option value="crossesBelow">crosses below ↓</option>
                    <option value="eq">== (equals)</option>
                  </select>
                </div>

                {/* Right Operand Toggle & Input */}
                <div className="flex-1 min-w-[160px] flex items-center gap-1.5">
                  {isRightIndicator ? (
                    <select
                      value={rule.rightIndicator || availableOperands[0].value}
                      onChange={e => handleUpdateRule(idx, { rightIndicator: e.target.value, rightValue: undefined })}
                      className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-lg px-2.5 py-1.5 text-[#00ffa3] font-mono font-medium focus:border-[#00ffa3] focus:outline-none"
                    >
                      {availableOperands.map(op => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      step="any"
                      value={rule.rightValue !== undefined ? rule.rightValue : 0}
                      onChange={e =>
                        handleUpdateRule(idx, { rightValue: parseFloat(e.target.value) || 0, rightIndicator: undefined })
                      }
                      className="w-full bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded-lg px-2.5 py-1.5 text-amber-300 font-mono font-medium focus:border-[#00ffa3] focus:outline-none"
                      placeholder="e.g. 30"
                    />
                  )}

                  {/* Mode switcher: Value vs Indicator */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isRightIndicator) {
                        handleUpdateRule(idx, { rightIndicator: undefined, rightValue: 0 });
                      } else {
                        handleUpdateRule(idx, {
                          rightIndicator: availableOperands[0]?.value || 'close',
                          rightValue: undefined
                        });
                      }
                    }}
                    className="p-1.5 rounded-lg bg-[#0c0c0e] text-neutral-400 hover:text-[#ececed] hover:bg-[#161619] border border-[rgba(236,236,237,0.08)] shrink-0 transition-colors"
                    title={isRightIndicator ? 'Switch to Constant Number Value' : 'Switch to Indicator/Price Field'}
                  >
                    <GitCompare className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Delete rule */}
                <button
                  type="button"
                  onClick={() => handleRemoveRule(idx)}
                  className="p-1.5 text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
