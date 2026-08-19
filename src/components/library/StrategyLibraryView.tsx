import React, { useState } from 'react';
import { STRATEGY_TEMPLATES, StrategyTemplateItem } from '../../shared/strategy/templates';
import { StrategyAST } from '../../shared/strategy/types';
import { BookOpen, Sparkles, ArrowRight, ShieldCheck, Tag, CheckCircle } from 'lucide-react';
import { renderStrategyInPlainLanguage } from '../../shared/strategy/renderPlainLanguage';

interface StrategyLibraryViewProps {
  onLoadStrategy: (strategy: StrategyAST) => void;
}

export const StrategyLibraryView: React.FC<StrategyLibraryViewProps> = ({ onLoadStrategy }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  const categories = ['ALL', 'Trend Following', 'Mean Reversion', 'Volatility', 'Momentum', 'Breakout', 'Institutional'];

  const filteredTemplates = STRATEGY_TEMPLATES.filter(
    t => selectedCategory === 'ALL' || t.category === selectedCategory
  );

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5 pb-20">
      {/* Header */}
      <div className="bg-[#161619]/90 border border-[rgba(236,236,237,0.08)] rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Institutional Strategy Library (7 Templates)</h2>
            <p className="text-xs text-neutral-400">
              Pre-built quantitative systems with complete Zod AST schemas, Indian regulatory cost accounting, and risk rules
            </p>
          </div>
        </div>

        {/* Category Filters */}
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[rgba(236,236,237,0.08)]/80">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                selectedCategory === cat
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                  : 'bg-[#0c0c0e] text-neutral-400 hover:text-white border border-[rgba(236,236,237,0.08)]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredTemplates.map(tmpl => {
          const plainLang = renderStrategyInPlainLanguage(tmpl.strategy);

          return (
            <div
              key={tmpl.id}
              className="p-5 bg-[#161619]/90 border border-[rgba(236,236,237,0.08)] rounded-2xl hover:border-purple-500/50 transition-all flex flex-col justify-between space-y-4 shadow-sm"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                    {tmpl.category}
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400 font-semibold">
                    {tmpl.expectedWinRate}
                  </span>
                </div>

                <div>
                  <h3 className="font-bold text-base text-white">{tmpl.name}</h3>
                  <p className="text-xs text-neutral-300 mt-1 leading-relaxed">{tmpl.description}</p>
                </div>

                <div className="p-3 bg-[#0c0c0e]/80 border border-[rgba(236,236,237,0.08)]/80 rounded-xl text-xs space-y-1.5 text-neutral-400">
                  <div>
                    <strong className="text-neutral-300">Suitability: </strong>
                    <span>{tmpl.suitability}</span>
                  </div>
                  <div>
                    <strong className="text-neutral-300">Entry Logic: </strong>
                    <span className="font-mono text-[11px] text-cyan-300">{plainLang.entrySummary.join(' & ')}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => onLoadStrategy(tmpl.strategy)}
                className="w-full py-2.5 rounded-xl bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white font-bold text-xs border border-purple-500/30 flex items-center justify-center gap-2 transition-all shadow-sm group"
              >
                <span>Load Template into Builder</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
