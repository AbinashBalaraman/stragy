import React, { useState } from 'react';

/**
 * Small, safe Markdown subset for assistant messages: paragraphs, "-" / "*" and
 * "1." lists, ## headings (h3/h4), fenced code with copy, [links](url) and bare
 * URLs, **bold** and `code`. Everything else stays literal text. No HTML is ever
 * parsed and dangerouslySetInnerHTML is never used.
 */
type Block =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; start: number; items: string[] }
  | { type: 'heading'; level: 3 | 4; text: string }
  | { type: 'code'; lang: string; code: string };

const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s*(#{2,4})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*```\s*([\w+#-]*)\s*$/;
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()[\]]+)/g;

/** Only real navigations leave the app; anything else stays text. */
function safeHref(value: string): string | null {
  const href = value.trim();
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

/** Trailing sentence punctuation is not part of a pasted URL. */
function trimUrl(value: string): string {
  return value.replace(/[.,;:!?]+$/, '').replace(/\)+$/, '');
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => { if (current) blocks.push(current); current = null; };
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'code', lang: fence[1] || '', code: code.join('\n') });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length >= 4 ? 4 : 3, text: heading[2] });
      continue;
    }
    const unordered = UNORDERED.exec(line);
    if (unordered) {
      if (current?.type !== 'ul') { flush(); current = { type: 'ul', items: [] }; }
      current.items.push(unordered[1]);
      continue;
    }
    const ordered = ORDERED.exec(line);
    if (ordered) {
      if (current?.type !== 'ol') { flush(); current = { type: 'ol', start: Number(ordered[1]), items: [] }; }
      current.items.push(ordered[2]);
      continue;
    }
    if (current?.type !== 'paragraph') { flush(); current = { type: 'paragraph', lines: [] }; }
    current.lines.push(line);
  }
  flush();
  return blocks;
}

const linkClass = 'text-[var(--accent)] underline decoration-[rgba(168,199,250,0.4)] underline-offset-2 transition-colors hover:decoration-[var(--accent)]';

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push(text.slice(last, at));
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(<code key={`${keyPrefix}-c${index}`} className="rounded bg-[var(--surface-3)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--text-1)]">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${index}`} className="font-semibold text-[var(--text-1)]">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      nodes.push(href
        ? <a key={`${keyPrefix}-l${index}`} href={href} target="_blank" rel="noreferrer noopener" className={linkClass}>{label}</a>
        : token);
    } else {
      const href = safeHref(trimUrl(token));
      nodes.push(href
        ? <a key={`${keyPrefix}-u${index}`} href={href} target="_blank" rel="noreferrer noopener" className={linkClass}>{trimUrl(token)}</a>
        : token);
    }
    index += 1;
    last = at + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Fenced code: mono on surface-3, max 320px tall, copy is the only action. */
const CodeBlock: React.FC<{ lang: string; code: string }> = ({ lang, code }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="my-3 overflow-hidden rounded-[var(--r-inner)] bg-[var(--surface-3)]">
      <div className="flex items-center justify-between gap-3 px-3 py-1.5">
        <span className="st-meta text-[var(--text-3)]">{lang || 'code'}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="st-meta -mr-1 inline-flex min-h-11 items-center rounded-[var(--r-btn)] px-2 text-[var(--text-2)] transition-colors hover:text-[var(--text-1)] sm:min-h-7"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-[320px] overflow-auto px-3 pb-3 font-mono text-[12.5px] leading-5 text-[var(--text-1)]"><code>{code}</code></pre>
    </div>
  );
};

export function MessageText({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={['space-y-2', className].filter(Boolean).join(' ')}>
      {blocks.map((block, blockIndex) => {
        if (block.type === 'code') {
          return <CodeBlock key={blockIndex} lang={block.lang} code={block.code} />;
        }
        if (block.type === 'heading') {
          if (block.level === 4) {
            return <h4 key={blockIndex} className="mt-4 text-[15px] font-semibold leading-6 text-[var(--text-1)] first:mt-0">{renderInline(block.text, `${blockIndex}-h`)}</h4>;
          }
          return <h3 key={blockIndex} className="st-title mt-4 font-semibold text-[var(--text-1)] first:mt-0">{renderInline(block.text, `${blockIndex}-h`)}</h3>;
        }
        if (block.type === 'ul') {
          return (
            <ul key={blockIndex} className="list-disc space-y-1 pl-5 marker:text-[var(--text-3)]">
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `${blockIndex}-${itemIndex}`)}</li>)}
            </ul>
          );
        }
        if (block.type === 'ol') {
          return (
            <ol key={blockIndex} start={block.start} className="list-decimal space-y-1 pl-5 marker:text-[var(--text-3)]">
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `${blockIndex}-${itemIndex}`)}</li>)}
            </ol>
          );
        }
        return (
          <p key={blockIndex} className="whitespace-pre-line">
            {renderInline(block.lines.join('\n'), String(blockIndex))}
          </p>
        );
      })}
    </div>
  );
}
