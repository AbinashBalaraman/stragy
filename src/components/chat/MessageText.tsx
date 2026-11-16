import React from 'react';

/**
 * Small, safe Markdown subset for assistant messages: paragraphs, "-" / "*" lists,
 * "1." lists, **bold** and `code`. Everything else is rendered as literal text.
 * No HTML is ever parsed and dangerouslySetInnerHTML is never used.
 */
type Block =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; start: number; items: string[] };

const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => { if (current) blocks.push(current); current = null; };

  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) { flush(); continue; }
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

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push(text.slice(last, at));
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${index}`} className="font-semibold text-neutral-100">{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={`${keyPrefix}-c${index}`} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-neutral-100">{token.slice(1, -1)}</code>);
    }
    index += 1;
    last = at + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function MessageText({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={['space-y-2', className].filter(Boolean).join(' ')}>
      {blocks.map((block, blockIndex) => {
        if (block.type === 'ul') {
          return (
            <ul key={blockIndex} className="list-disc space-y-1 pl-5">
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `${blockIndex}-${itemIndex}`)}</li>)}
            </ul>
          );
        }
        if (block.type === 'ol') {
          return (
            <ol key={blockIndex} start={block.start} className="list-decimal space-y-1 pl-5">
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
