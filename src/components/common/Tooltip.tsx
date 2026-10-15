import React, { useState } from 'react';
import { Info } from 'lucide-react';

interface FinanceTooltipProps {
  content: string;
  term?: string;
  children?: React.ReactNode;
}

export const FinanceTooltip: React.FC<FinanceTooltipProps> = ({ content, term, children }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative inline-flex items-center group">
      {children || (
        <span className="inline-flex items-center gap-1 cursor-help text-xs text-neutral-400 hover:text-cyan-400 transition-colors">
          {term && <span className="underline decoration-dotted decoration-neutral-600 underline-offset-2">{term}</span>}
          <Info className="w-3 h-3 text-neutral-500 hover:text-cyan-400 transition-colors" />
        </span>
      )}
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2.5 bg-[#161619] border border-[rgba(236,236,237,0.12)]/80 rounded-lg shadow-xl text-xs text-neutral-200 z-50 pointer-events-none backdrop-blur-md">
          {content}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1d1d21]" />
        </div>
      )}
    </div>
  );
};
