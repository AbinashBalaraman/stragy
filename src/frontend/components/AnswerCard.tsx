import { useState } from 'react';
import { Check, ChevronDown, Clipboard, RefreshCw } from 'lucide-react';
import { Prose } from './Prose';
import { ToolTimeline } from './ToolTimeline';
import { parseToolOutput, type ViewMessage } from '../opencode/sessionStore';
import { t } from '../i18n';

type Props = {
  message: ViewMessage;
  sessionId?: string;
  resolvedApprovals: Record<string, 'approved' | 'rejected'>;
  onApprovalResolved: (approvalId: string, decision: 'approved' | 'rejected', followUp: string) => void;
  onSend: (text: string) => void;
  onRegenerate: () => void;
  busy: boolean;
  lang: 'en' | 'ta';
  time: string;
};

/** Derive compact provenance chips from the tools this answer actually used. */
function provenanceOf(message: ViewMessage): string[] {
  const chips = new Set<string>();
  for (const tool of message.tools) {
    const out = parseToolOutput(tool.output);
    if (!out) continue;
    const str = (key: string): string | undefined => {
      const value = out[key];
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };
    const source = str('dataSource') ?? str('source') ?? str('provider');
    if (source && !/unknown|demo/i.test(source)) chips.add(source.replace(/_/g, ' '));
    const asOf = str('asOf') ?? str('lastDate');
    if (asOf) chips.add('as of ' + asOf.slice(0, 10));
    const range = out.evaluationRange;
    if (range && typeof range === 'object') {
      const r = range as Record<string, unknown>;
      if (typeof r.from === 'string' && typeof r.to === 'string') chips.add(`${String(r.from).slice(0, 10)} → ${String(r.to).slice(0, 10)}`);
    }
    const evaluated = out.evaluatedSymbols ?? out.attempted ?? out.evaluated;
    if (typeof evaluated === 'number' && evaluated > 0) chips.add(`${evaluated} symbols evaluated`);
  }
  return [...chips].slice(0, 4);
}

/** Contextual next questions: recognition over recall (Perplexity pattern). */
function followUpsFor(message: ViewMessage, lang: 'en' | 'ta'): string[] {
  const names = message.tools.map(tool => tool.name).join(' ').toLowerCase();
  if (/scan/.test(names)) return lang === 'ta'
    ? ['முதல் பொருத்தத்தை விளக்கு', 'சிறந்த வேட்பாளரை பின்பரிசோதனை செய்', 'முழு முடிவு அட்டவணை காட்டு']
    : ['Explain the top match', 'Backtest the best candidate', 'Show the full results table'];
  if (/backtest|optimiz/.test(names)) return lang === 'ta'
    ? ['இந்த முடிவுகளை விளக்கு', 'வேறு அளவுருக்களை முயற்சி செய்', 'ஆபத்துக்களை சுருக்கம் காட்டு']
    : ['Explain these metrics', 'Try different parameters', 'Summarise the risks'];
  return lang === 'ta'
    ? ['ஆதார தரவைக் காட்டு', 'ஒரு உதாரணத்துடன் விளக்கு', 'அடுத்த படி என்ன?']
    : ['Show the data sources', 'Explain with an example', 'What should I check next?'];
}

/**
 * Answer-first message card. The answer is always visible; the agent's research
 * is a single expandable line under it; provenance and next steps sit in a
 * quiet footer. Tool rows/approval cards keep their test ids so nothing breaks.
 */
export function AnswerCard({ message, sessionId, resolvedApprovals, onApprovalResolved, onSend, onRegenerate, busy, lang, time }: Props) {
  const [copied, setCopied] = useState(false);
  const provenance = provenanceOf(message);
  const followUps = followUpsFor(message, lang);
  const steps = message.tools.length;
  const failed = message.tools.filter(tool => tool.status === 'failed').length;

  const copy = () => {
    void navigator.clipboard?.writeText(message.text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <>
      <div className="amark">
        <span className="brand-mark" style={{ width: 16, height: 16 }} aria-hidden>
          <svg viewBox="0 0 24 24" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" stroke="var(--accent)" strokeWidth="1.5" /><path d="M5 16.5 9.5 10l3 3.5L19 6" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </span>
        <b>STRAGY</b>
        <span className="ts">{time}</span>
        {lang === 'ta' && <span className="chip tamil"><span className="cdot" />{t(lang, 'replyInTamil')}</span>}
      </div>

      {message.text && <Prose text={message.text} className={`aprose ${lang === 'ta' ? 'ta-text' : ''}`} lang={lang} testId="assistant-text" />}
      {message.imageUris.map((uri, i) => <ImageInline key={i} uri={uri} />)}

      {!!steps && (
        <details className="research-details" data-testid="research-details">
          <summary>
            <ChevronDown size={13} />
            <span>{t(lang, 'researchSteps')} · {steps} {steps === 1 ? 'step' : 'steps'}</span>
            {failed > 0 && <span className="chip failed">{failed} failed</span>}
            <span className="research-hint">{t(lang, 'researchHint')}</span>
          </summary>
          <ToolTimeline tools={message.tools} sessionId={sessionId} resolvedApprovals={resolvedApprovals} onApprovalResolved={onApprovalResolved} />
        </details>
      )}

      {(provenance.length > 0 || !busy) && (
        <div className="answer-footer">
          {provenance.map(chip => <span className="prov-chip" key={chip} data-testid="provenance-chip">{chip}</span>)}
          <span className="answer-actions">
            <button type="button" className="mini-btn" onClick={copy} data-testid="copy-answer" aria-label="Copy answer">{copied ? <Check size={13} /> : <Clipboard size={13} />}{copied ? 'Copied' : 'Copy'}</button>
            <button type="button" className="mini-btn" onClick={onRegenerate} disabled={busy} data-testid="regenerate-answer" aria-label="Regenerate answer"><RefreshCw size={13} /> Regenerate</button>
          </span>
        </div>
      )}

      {!busy && (
        <div className="followups" data-testid="followups">
          {followUps.map(question => <button key={question} type="button" className="followup" onClick={() => onSend(question)}>{question}</button>)}
        </div>
      )}
    </>
  );
}

/** Keeps the image import local to this card without a circular import. */
import { ImageCard } from './ImageCard';
function ImageInline({ uri }: { uri: string }) { return <ImageCard uri={uri} />; }
