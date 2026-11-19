import type { ReactNode } from 'react';

/**
 * Small, dependency-free renderer for assistant prose. React escapes every
 * string; only http(s) links become anchors. Supports paragraphs, headings,
 * bullet/numbered lists, fenced code, simple tables, bold, italic and inline
 * code — enough for research answers without shipping a full markdown stack.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
  return parts.filter(Boolean).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={key}>{part.slice(1, -1)}</em>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return <span key={key}>{part}</span>;
  });
}

export function Prose({ text, className, lang, testId }: { text: string; className?: string; lang?: string; testId?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={`k${key++}`}><code>{code.join('\n')}</code></pre>);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = Math.min(4, heading[1].length + 2);
      const Tag = `h${level}` as 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Tag key={`k${key++}`}>{inline(heading[2], `h${key}`)}</Tag>);
      i++;
      continue;
    }

    // Table: a header row followed by a |---| separator.
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]+/.test(lines[i + 1])) {
      const cells = (row: string) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(
        <div className="prose-table" key={`k${key++}`}>
          <table>
            <thead><tr>{head.map((c, n) => <th key={n}>{inline(c, `th${key}-${n}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, n) => <tr key={n}>{r.map((c, m) => <td key={m}>{inline(c, `td${key}-${n}-${m}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !!numbered;
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={`k${key++}`}>
          {items.map((item, n) => <li key={n}>{inline(item, `li${key}-${n}`)}</li>)}
        </List>,
      );
      continue;
    }

    const paragraph: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,4}\s|[-*+]\s|\d+[.)]\s|```)/.test(lines[i]) && !lines[i].includes('|')) {
      paragraph.push(lines[i++]);
    }
    blocks.push(<p key={`k${key++}`}>{inline(paragraph.join(' '), `p${key}`)}</p>);
  }

  return <div className={className} lang={lang} data-testid={testId}>{blocks.length ? blocks : <p>{text}</p>}</div>;
}
