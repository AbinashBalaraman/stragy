import React from 'react';
import { Shield, Target, Navigation, PieChart, AlertTriangle } from 'lucide-react';
import { RiskControls as RiskControlsType } from '../../shared/strategy/types';
import { FinanceTooltip } from '../common/Tooltip';

interface RiskControlsProps {
  risk: RiskControlsType;
  onChange: (risk: RiskControlsType) => void;
}

export const RiskControls: React.FC<RiskControlsProps> = ({ risk, onChange }) => {
  const handleStopLossChange = (val: number, type: 'percent' | 'points' | 'atr' = risk.stopLoss.type) => {
    onChange({
      ...risk,
      stopLoss: { type, value: val }
    });
  };

  const handleTakeProfitChange = (val: number | null, type: 'percent' | 'points' | 'rr' = 'percent') => {
    if (val === null) {
      onChange({ ...risk, takeProfit: null });
    } else {
      onChange({
        ...risk,
        takeProfit: { type, value: val }
      });
    }
  };

  const handleTrailingStopChange = (val: number | null, type: 'percent' | 'points' | 'atr' = 'percent') => {
    if (val === null) {
      onChange({ ...risk, trailingStop: null });
    } else {
      onChange({
        ...risk,
        trailingStop: { type, value: val }
      });
    }
  };

  const handlePositionSizingChange = (fraction: number) => {
    onChange({
      ...risk,
      positionSizing: {
        type: 'fixedFraction',
        fraction
      }
    });
  };

  const handleMaxDrawdownChange = (val: number | null) => {
    onChange({
      ...risk,
      maxDrawdownCutoff: val
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* 1. Stop Loss */}
      <div className="p-4 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#ff4d4d]" />
            <span className="text-xs font-mono font-bold text-[#ececed] uppercase tracking-wider">STOP LOSS</span>
            <FinanceTooltip content="Maximum loss tolerance per trade before mandatory liquidation." />
          </div>
          <select
            value={risk.stopLoss.type}
            onChange={e => handleStopLossChange(risk.stopLoss.value, e.target.value as any)}
            className="bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] text-xs rounded px-2 py-0.5 text-neutral-300 font-mono focus:border-[#00ffa3] focus:outline-none"
          >
            <option value="percent">Percentage (%)</option>
            <option value="atr">ATR Multiplier (x)</option>
            <option value="points">Absolute Points (₹)</option>
          </select>
        </div>

        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-neutral-400">TOLERANCE</span>
          <span className="text-[#ff4d4d] font-bold">
            {risk.stopLoss.value}
            {risk.stopLoss.type === 'percent' ? '%' : risk.stopLoss.type === 'atr' ? 'x ATR' : ' pts'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min={risk.stopLoss.type === 'percent' ? 0.5 : 0.5}
            max={risk.stopLoss.type === 'percent' ? 10 : 5}
            step={0.1}
            value={risk.stopLoss.value}
            onChange={e => handleStopLossChange(parseFloat(e.target.value))}
            className="flex-1 accent-[#ff4d4d] cursor-pointer h-1.5 bg-[#1d1d21] rounded-lg"
          />
          <input
            type="number"
            step="0.1"
            value={risk.stopLoss.value}
            onChange={e => handleStopLossChange(parseFloat(e.target.value) || 1)}
            className="w-16 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs text-right font-mono text-[#ececed] focus:border-[#ff4d4d] focus:outline-none"
          />
        </div>
      </div>

      {/* 2. Take Profit */}
      <div className="p-4 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-[#00ffa3]" />
            <span className="text-xs font-mono font-bold text-[#ececed] uppercase tracking-wider">TAKE PROFIT</span>
            <FinanceTooltip content="Target profit percentage or risk-reward ratio at which to lock in gains." />
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={risk.takeProfit !== null}
              onChange={e => handleTakeProfitChange(e.target.checked ? 6.0 : null)}
              className="accent-[#00ffa3] rounded"
            />
            <span className="text-xs font-mono text-neutral-400">ENABLE</span>
          </label>
        </div>

        {risk.takeProfit ? (
          <>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-neutral-400">PROFIT TARGET</span>
              <span className="text-[#00ffa3] font-bold">{risk.takeProfit.value}%</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="25"
                step="0.5"
                value={risk.takeProfit.value}
                onChange={e => handleTakeProfitChange(parseFloat(e.target.value))}
                className="flex-1 accent-[#00ffa3] cursor-pointer h-1.5 bg-[#1d1d21] rounded-lg"
              />
              <input
                type="number"
                step="0.5"
                value={risk.takeProfit.value}
                onChange={e => handleTakeProfitChange(parseFloat(e.target.value) || 2)}
                className="w-16 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs text-right font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
              />
            </div>
          </>
        ) : (
          <div className="text-xs font-mono text-neutral-400 py-3 text-center">Take profit disabled (Rides trend till rule exit)</div>
        )}
      </div>

      {/* 3. Trailing Stop */}
      <div className="p-4 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4 text-[#00ffa3]" />
            <span className="text-xs font-mono font-bold text-[#ececed] uppercase tracking-wider">TRAILING STOP</span>
            <FinanceTooltip content="Dynamic stop level that follows price upwards to lock in unrealized profits." />
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={risk.trailingStop !== null}
              onChange={e => handleTrailingStopChange(e.target.checked ? 1.5 : null)}
              className="accent-[#00ffa3] rounded"
            />
            <span className="text-xs font-mono text-neutral-400">ENABLE</span>
          </label>
        </div>

        {risk.trailingStop ? (
          <>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-neutral-400">TRAIL DISTANCE</span>
              <span className="text-[#00ffa3] font-bold">{risk.trailingStop.value}%</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0.5"
                max="8"
                step="0.1"
                value={risk.trailingStop.value}
                onChange={e => handleTrailingStopChange(parseFloat(e.target.value))}
                className="flex-1 accent-[#00ffa3] cursor-pointer h-1.5 bg-[#1d1d21] rounded-lg"
              />
              <input
                type="number"
                step="0.1"
                value={risk.trailingStop.value}
                onChange={e => handleTrailingStopChange(parseFloat(e.target.value) || 1)}
                className="w-16 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs text-right font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
              />
            </div>
          </>
        ) : (
          <div className="text-xs font-mono text-neutral-400 py-3 text-center">Trailing stop disabled</div>
        )}
      </div>

      {/* 4. Position Sizing & Max Drawdown Circuit Breaker */}
      <div className="p-4 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PieChart className="w-4 h-4 text-[#00ffa3]" />
            <span className="text-xs font-mono font-bold text-[#ececed] uppercase tracking-wider">POSITION ALLOCATION</span>
            <FinanceTooltip content="Fraction of total account equity allocated per single trade." />
          </div>
          <span className="font-mono text-[#00ffa3] font-bold text-xs">
            {((risk.positionSizing.fraction || 0.1) * 100).toFixed(0)}% CAPITAL
          </span>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0.05"
            max="1.0"
            step="0.05"
            value={risk.positionSizing.fraction || 0.1}
            onChange={e => handlePositionSizingChange(parseFloat(e.target.value))}
            className="flex-1 accent-[#00ffa3] cursor-pointer h-1.5 bg-[#1d1d21] rounded-lg"
          />
          <input
            type="number"
            step="5"
            value={((risk.positionSizing.fraction || 0.1) * 100).toFixed(0)}
            onChange={e => handlePositionSizingChange((parseFloat(e.target.value) || 10) / 100)}
            className="w-16 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs text-right font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
          />
        </div>

        {/* Max Drawdown Circuit Breaker */}
        <div className="pt-2 border-t border-[rgba(236,236,237,0.08)]">
          <div className="flex items-center justify-between text-xs mb-1.5 font-mono">
            <span className="text-amber-400 font-medium flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              MAX DRAWDOWN CIRCUIT BREAKER
              <FinanceTooltip content="Systematic safety cutoff: halts trading if portfolio drawdown breaches this threshold." />
            </span>
            <span className="text-amber-400 font-bold">
              {risk.maxDrawdownCutoff ? `${risk.maxDrawdownCutoff}%` : 'DISABLED'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="range"
              min="5"
              max="35"
              step="1"
              value={risk.maxDrawdownCutoff || 15}
              onChange={e => handleMaxDrawdownChange(parseFloat(e.target.value))}
              className="flex-1 accent-amber-500 cursor-pointer h-1.5 bg-[#1d1d21] rounded-lg"
            />
            <input
              type="number"
              value={risk.maxDrawdownCutoff || 15}
              onChange={e => handleMaxDrawdownChange(parseFloat(e.target.value) || 15)}
              className="w-16 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs text-right font-mono text-[#ececed] focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
