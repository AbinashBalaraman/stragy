import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown, Search } from 'lucide-react';

type Option = { value: string; label: string };

type Props = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
};

type Group = { name: string; free: boolean; items: Option[] };

const isFree = (value: string): boolean => /(^|[/:-])free($|[/:-])|:free$/i.test(value);

/** 'openrouter/openai/gpt-6.2-sol-pro' -> 'gpt-6.2-sol-pro' (provider shown as group). */
const shortName = (value: string): string => {
  const parts = value.split('/');
  return parts[parts.length - 1] || value;
};

function groupOptions(options: Option[]): Group[] {
  const byProvider = new Map<string, Option[]>();
  for (const option of options) {
    const provider = option.value.split('/')[0] || 'models';
    const list = byProvider.get(provider) ?? [];
    list.push(option);
    byProvider.set(provider, list);
  }
  const groups: Group[] = [...byProvider.entries()].map(([name, items]) => ({
    name,
    free: items.some((item) => isFree(item.value)),
    items,
  }));
  // Free tiers first, then alphabetical providers; within a group free models lead.
  groups.sort((a, b) => (a.free === b.free ? a.name.localeCompare(b.name) : a.free ? -1 : 1));
  for (const group of groups) {
    group.items.sort((a, b) => (isFree(a.value) === isFree(b.value) ? a.value.localeCompare(b.value) : isFree(a.value) ? -1 : 1));
  }
  return groups;
}

/**
 * The model catalog is hundreds of raw provider/model IDs. A native select
 * dumped all of them into the composer; this picker curates: search, grouped
 * providers, free tiers first, one readable name on the button.
 */
export function ModelPicker({ options, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const groups = useMemo(() => groupOptions(options), [options]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((group) => ({ ...group, items: group.items.filter((item) => item.value.toLowerCase().includes(q) || item.label.toLowerCase().includes(q)) }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);
  const flat = useMemo(() => filtered.flatMap((group) => group.items), [filtered]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, flat.length]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); buttonRef.current?.focus(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, flat.length - 1)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = flat[active];
      if (item) choose(item.value);
    }
  };

  let index = -1;

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="model-picker-btn"
        data-testid="model-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value || 'Choose model'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="model-picker-name">{value ? shortName(value) : 'model'}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="model-menu" role="dialog" aria-label="Choose model">
          <div className="model-search">
            <Search size={13} />
            <input
              ref={inputRef}
              value={query}
              placeholder="Search models…"
              aria-label="Search models"
              data-testid="model-search"
              onChange={(event) => { setQuery(event.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
            />
          </div>
          <div className="model-list" role="listbox" ref={listRef} data-testid="model-list">
            {filtered.map((group) => (
              <div key={group.name}>
                <div className="model-group">{group.name}{group.free ? ' · free tier' : ''}</div>
                {group.items.map((item) => {
                  index += 1;
                  const idx = index;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="option"
                      aria-selected={item.value === value}
                      data-index={idx}
                      className={`model-option ${idx === active ? 'active' : ''} ${item.value === value ? 'selected' : ''}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => choose(item.value)}
                    >
                      <span className="model-option-name">{shortName(item.value)}</span>
                      {isFree(item.value) && <span className="model-free">free</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            {!flat.length && <div className="model-empty">No models match “{query}”.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
