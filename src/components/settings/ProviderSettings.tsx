import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronUp, KeyRound, List, Pencil, Plus, RefreshCw, Search, Trash2, X,
} from 'lucide-react';
import type {
  AIChainEntryInput, AIChainEntryPublic, AIChainLastStatus, AIProviderModelPublic, AIProviderPublic,
  AIProviderTestResponse, AIProviderWriteInput, AIProvidersResponse,
} from '../../shared/contracts/aiProviders';
import {
  createAIProvider, deleteAIProvider, getAIProviderModels, getAIProviders, resetAIProviders,
  saveAIChain, testAIProviderModel, updateAIProvider,
} from '../../client/aiProviders';

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a8c7fa]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101012]';
const primary = 'rounded-lg bg-[#a8c7fa] px-3 py-2 text-xs font-semibold text-[#101012] hover:bg-[#bfd6fb] disabled:cursor-not-allowed disabled:opacity-40 ' + focus;
const secondary = 'inline-flex min-h-11 items-center gap-1.5 rounded-[var(--r-btn)] border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-8 ' + focus;
const danger = 'inline-flex min-h-11 items-center gap-1.5 rounded-[var(--r-btn)] border border-[var(--danger)]/30 px-2.5 py-1.5 text-xs text-[var(--down)] transition-colors hover:bg-[var(--danger)]/10 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-8 ' + focus;
const inputClass = 'w-full rounded-[var(--r-btn)] border border-[var(--line-strong)] bg-[#101012] px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:border-[#a8c7fa]/60 focus:outline-none disabled:opacity-50';
const smallInput = 'min-w-0 flex-1 rounded-[var(--r-btn)] border border-[var(--line-strong)] bg-[#101012] px-2.5 py-1.5 text-xs text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:border-[#a8c7fa]/60 focus:outline-none disabled:opacity-50';

interface HeaderRow { name: string; value: string; existing: boolean }
interface ProviderForm {
  id?: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  keySource: AIProviderPublic['keySource'];
  keyHint: string | null;
  builtin: boolean;
  headers: HeaderRow[];
}
type ConfirmState = { kind: 'delete'; provider: AIProviderPublic } | { kind: 'reset' };

const providerForm = (provider?: AIProviderPublic): ProviderForm => provider ? {
  id: provider.id,
  label: provider.label,
  baseUrl: provider.baseUrl,
  apiKey: '',
  enabled: provider.enabled,
  keySource: provider.keySource,
  keyHint: provider.keyHint,
  builtin: provider.builtin,
  headers: provider.extraHeaderNames.map(name => ({ name, value: '', existing: true })),
} : {
  label: '', baseUrl: '', apiKey: '', enabled: true, keySource: 'none', keyHint: null, builtin: false, headers: [],
};

const keyStatus = (provider: Pick<AIProviderPublic, 'keySource' | 'keyHint'>): string => {
  if (provider.keySource === 'env') return 'From env';
  if (provider.keySource === 'stored') return 'Saved (' + (provider.keyHint ? provider.keyHint.replace(/^\./, '…') : '…hidden') + ')';
  return 'No key';
};

const usdPerMillion = (value: number): string => {
  const scaled = value * 1_000_000;
  const digits = scaled === 0 || scaled >= 1 ? 2 : 4;
  return '$' + scaled.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits }) + ' / 1M';
};

const priceLabel = (price: AIProviderModelPublic['price'] | AIChainEntryPublic['price'], free: boolean | null, providerId?: string): string => {
  if (free === true) return 'Free';
  const hasPrice = price !== null && (price.prompt !== null || price.completion !== null);
  if (hasPrice) {
    const amount = usdPerMillion(price.prompt ?? price.completion ?? 0);
    return free === false ? 'Paid · ' + amount : amount;
  }
  if (free === false) return providerId === 'opencode-go' ? 'Paid (Go quota)' : 'Paid';
  return 'Unknown price';
};

const priceTitle = (price: AIProviderModelPublic['price'] | AIChainEntryPublic['price']): string => {
  if (!price) return 'No price reported';
  const prompt = price.prompt === null ? 'unknown' : usdPerMillion(price.prompt);
  const completion = price.completion === null ? 'unknown' : usdPerMillion(price.completion);
  return 'Input ' + prompt + ' · output ' + completion;
};

const contextLabel = (value?: number): string => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'Unavailable';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0) + 'M';
  if (value >= 1_000) return Math.round(value / 1_000) + 'k';
  return String(value);
};

const inputLabel = (model: AIProviderModelPublic): string => {
  const modalities = Array.isArray(model.inputModalities) ? model.inputModalities : [];
  if (modalities.includes('image')) return 'Text + image';
  return 'Text';
};

const istTime = (value?: string | null): string => {
  if (!value) return 'time unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'time unavailable';
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  }) + ' IST';
};

const lastStatusLabel = (status: AIChainLastStatus | null): string => {
  if (!status) return 'No call recorded';
  return (status.ok ? 'OK' : 'Failed') + (status.error ? ' · ' + status.error : '') + ' · ' + istTime(status.at);
};

const Section: React.FC<{ title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }> = ({ title, description, actions, children }) => (
  <section className="space-y-4 rounded-[var(--r-card)] border border-[var(--line)] bg-[var(--surface-1)] p-4 sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="st-title font-semibold text-[var(--text-1)]">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-3)]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
    {children}
  </section>
);

const ConfirmDialog: React.FC<{ title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }> = ({ title, body, confirmLabel, onConfirm, onCancel }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (previous && document.contains(previous)) previous.focus(); };
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="provider-confirm-title" className="w-full max-w-md rounded-2xl border border-white/10 bg-[#171719] p-5 shadow-2xl">
        <h2 id="provider-confirm-title" className="text-base font-semibold text-neutral-100">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-400">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondary}>Cancel</button>
          <button type="button" onClick={onConfirm} className={confirmLabel === 'Delete provider' || confirmLabel === 'Reset chain' ? danger : primary}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
};

/** Settings → AI providers. Keys are write-only and are never read back into the DOM. */
export const ProviderSettings: React.FC = () => {
  const [data, setData] = useState<AIProvidersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [form, setForm] = useState<ProviderForm | null>(null);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ label?: string; baseUrl?: string }>({});
  const labelRef = useRef<HTMLInputElement>(null);
  const baseUrlRef = useRef<HTMLInputElement>(null);
  const [savingProvider, setSavingProvider] = useState(false);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, AIProviderModelPublic[]>>({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [tests, setTests] = useState<Record<string, AIProviderTestResponse | { loading: true }>>({});
  const [chain, setChain] = useState<AIChainEntryPublic[]>([]);
  const [chainDirty, setChainDirty] = useState(false);
  const [chainSaving, setChainSaving] = useState(false);
  const [chainError, setChainError] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const headerValues = useRef<Record<string, Record<string, string>>>({});
  const chainDirtyRef = useRef(false);
  const selectedProviderIdRef = useRef<string | null>(null);

  useEffect(() => { chainDirtyRef.current = chainDirty; }, [chainDirty]);
  useEffect(() => { selectedProviderIdRef.current = selectedProviderId; }, [selectedProviderId]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const load = useCallback(async (options: { preserveChain?: boolean } = {}, signal?: AbortSignal) => {
    setLoading(true);
    setLoadError('');
    try {
      const next = await getAIProviders(signal);
      setData(next);
      if (!options.preserveChain || !chainDirtyRef.current) setChain(next.chain);
      const currentProviderId = selectedProviderIdRef.current;
      if (currentProviderId && !next.providers.some(provider => provider.id === currentProviderId)) setSelectedProviderId(null);
    } catch (error) {
      if (!signal?.aborted) setLoadError((error as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load({}, controller.signal);
    return () => controller.abort();
  }, [load]);

  const writable = data?.writable === true;
  const providers = data?.providers ?? [];
  const selectedProvider = providers.find(provider => provider.id === selectedProviderId) ?? null;
  const providerName = (id: string) => providers.find(provider => provider.id === id)?.label ?? id;
  const inChain = (providerId: string, modelId: string) => chain.some(entry => entry.providerId === providerId && entry.model === modelId);
  const selectedModels = selectedProviderId ? models[selectedProviderId] ?? [] : [];
  const freeModelCount = useMemo(() => selectedModels.filter(model => model.free === true).length, [selectedModels]);
  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    return selectedModels.filter(model => {
      if (freeOnly && model.free !== true) return false;
      if (!query) return true;
      return model.id.toLowerCase().includes(query) || (model.name ?? '').toLowerCase().includes(query);
    });
  }, [freeOnly, modelQuery, selectedModels]);

  const openAdd = () => { setForm(providerForm()); setFormError(''); setFieldErrors({}); setNotice(''); setActionError(''); };
  const openEdit = (provider: AIProviderPublic) => { setForm(providerForm(provider)); setFormError(''); setFieldErrors({}); setNotice(''); setActionError(''); };
  const closeForm = () => { setForm(null); setFormError(''); setFieldErrors({}); };

  const formHeaders = (state: ProviderForm): Record<string, string> | null => {
    const headers: Record<string, string> = {};
    for (const row of state.headers) {
      const name = row.name.trim();
      if (!name && !row.value.trim()) continue;
      if (!name) { setFormError('Every extra header needs a name.'); return null; }
      if (!row.value.trim()) {
        if (row.existing) continue;
        setFormError('Enter a value for the header “' + name + '”, or remove it.');
        return null;
      }
      headers[name] = row.value;
    }
    return headers;
  };

  const saveProvider = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || savingProvider || !writable) return;
    const label = form.label.trim();
    const baseUrl = form.baseUrl.trim();
    const nextFieldErrors: { label?: string; baseUrl?: string } = {};
    if (!label) nextFieldErrors.label = 'Add a label';
    if (!baseUrl) nextFieldErrors.baseUrl = 'Add a base URL starting with https://';
    else {
      try {
        if (new URL(baseUrl).protocol !== 'https:') throw new Error('Not https');
      } catch {
        nextFieldErrors.baseUrl = 'Add a base URL starting with https://';
      }
    }
    if (nextFieldErrors.label || nextFieldErrors.baseUrl) {
      setFieldErrors(nextFieldErrors);
      setFormError('');
      (nextFieldErrors.label ? labelRef : baseUrlRef).current?.focus();
      return;
    }
    setFieldErrors({});
    const extraHeaders = formHeaders(form);
    if (!extraHeaders) return;
    const keyEntered = form.apiKey.trim().length > 0;
    const body: AIProviderWriteInput = {
      label, baseUrl, enabled: form.enabled, extraHeaders,
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    };
    setSavingProvider(true);
    setFormError('');
    try {
      const saved = form.id ? await updateAIProvider(form.id, body) : await createAIProvider(body);
      headerValues.current[saved.provider.id] = extraHeaders;
      setForm(null);
      setNotice(keyEntered ? 'Provider saved. The key is write-only and was not displayed.' : 'Provider saved. No key entered.');
      await load({ preserveChain: true });
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setSavingProvider(false);
    }
  };

  const removeSavedKey = async () => {
    if (!form?.id || !writable || savingProvider) return;
    const extraHeaders = formHeaders(form);
    if (!extraHeaders) return;
    setSavingProvider(true);
    setFormError('');
    try {
      const saved = await updateAIProvider(form.id, {
        label: form.label.trim(), baseUrl: form.baseUrl.trim(), enabled: form.enabled, extraHeaders, clearKey: true,
      });
      headerValues.current[saved.provider.id] = extraHeaders;
      setForm(null);
      setNotice('Saved key removed. The provider now uses an environment key or no key.');
      await load({ preserveChain: true });
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setSavingProvider(false);
    }
  };

  const toggleProvider = async (provider: AIProviderPublic, enabled: boolean) => {
    if (!writable || busyProvider) return;
    const cached = headerValues.current[provider.id];
    if (provider.extraHeaderNames.length > 0 && !cached) {
      setActionError('This provider has saved extra header values that cannot be kept by an inline toggle. Edit the provider and re-enter the header values.');
      return;
    }
    setBusyProvider(provider.id);
    setActionError('');
    try {
      await updateAIProvider(provider.id, {
        label: provider.label, baseUrl: provider.baseUrl, enabled,
        ...(cached ? { extraHeaders: cached } : { extraHeaders: {} }),
      });
      setNotice(enabled ? 'Provider enabled.' : 'Provider disabled.');
      await load({ preserveChain: true });
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusyProvider(null);
    }
  };

  const removeProvider = async (provider: AIProviderPublic) => {
    setConfirm({ kind: 'delete', provider });
  };

  const confirmAction = async () => {
    if (!confirm || !writable) return;
    const current = confirm;
    setConfirm(null);
    setActionError('');
    try {
      if (current.kind === 'delete') {
        await deleteAIProvider(current.provider.id);
        setSelectedProviderId(id => id === current.provider.id ? null : id);
        setNotice('Provider deleted. Any chain entries for it were removed.');
        await load();
      } else {
        const next = await resetAIProviders();
        setData(next);
        setChain(next.chain);
        setChainDirty(false);
        setChainError('');
        setNotice('Provider settings reset to the environment defaults.');
      }
    } catch (error) {
      setActionError((error as Error).message);
    }
  };

  const openModels = async (provider: AIProviderPublic) => {
    setSelectedProviderId(provider.id);
    setModelsError('');
    setModelQuery('');
    setFreeOnly(provider.id === 'openrouter');
    if (models[provider.id]) return;
    setModelsLoading(true);
    try {
      const next = await getAIProviderModels(provider.id);
      setModels(current => ({ ...current, [provider.id]: next.models }));
    } catch (error) {
      setModelsError((error as Error).message);
    } finally {
      setModelsLoading(false);
    }
  };

  const reloadModels = async () => {
    if (!selectedProvider) return;
    setModelsLoading(true);
    setModelsError('');
    try {
      const next = await getAIProviderModels(selectedProvider.id);
      setModels(current => ({ ...current, [selectedProvider.id]: next.models }));
    } catch (error) {
      setModelsError((error as Error).message);
    } finally {
      setModelsLoading(false);
    }
  };

  const runTest = async (provider: AIProviderPublic, model: AIProviderModelPublic) => {
    const key = provider.id + ':' + model.id;
    setTests(current => ({ ...current, [key]: { loading: true } }));
    try {
      const result = await testAIProviderModel(provider.id, model.id);
      setTests(current => ({ ...current, [key]: result }));
    } catch (error) {
      setTests(current => ({ ...current, [key]: { ok: false, latencyMs: 0, error: (error as Error).message } }));
    }
  };

  const addToChain = (provider: AIProviderPublic, model: AIProviderModelPublic) => {
    if (!writable) return;
    if (chain.length >= 6) { setChainError('The chain supports at most 6 entries.'); return; }
    if (chain.some(entry => entry.providerId === provider.id && entry.model === model.id)) {
      setChainError('That provider and model are already in the chain.');
      return;
    }
    setChain(current => [...current, {
      providerId: provider.id,
      model: model.id,
      vision: inputLabel(model).includes('image'),
      paidApproved: false,
      price: model.price,
      free: model.free,
      lastStatus: null,
    }]);
    setChainDirty(true);
    setChainError('');
  };

  const moveChain = (index: number, direction: -1 | 1) => {
    if (!writable) return;
    const target = index + direction;
    if (target < 0 || target >= chain.length) return;
    setChain(current => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setChainDirty(true);
    setChainError('');
  };

  const updateChain = (index: number, patch: Partial<AIChainEntryPublic>) => {
    if (!writable) return;
    setChain(current => current.map((entry, position) => position === index ? { ...entry, ...patch } : entry));
    setChainDirty(true);
    setChainError('');
  };

  const removeChain = (index: number) => {
    if (!writable) return;
    setChain(current => current.filter((_, position) => position !== index));
    setChainDirty(true);
    setChainError('');
  };

  const saveChain = async () => {
    if (!writable || chainSaving) return;
    if (!chain.length) { setChainError('Add at least one model to the chain.'); return; }
    const unapproved = chain.find(entry => entry.free !== true && !entry.paidApproved);
    if (unapproved) {
      setChainError('Approve paid or unknown-price use for ' + providerName(unapproved.providerId) + ' / ' + unapproved.model + ' before saving.');
      return;
    }
    const seen = new Set<string>();
    for (const entry of chain) {
      const key = entry.providerId + ':' + entry.model;
      if (seen.has(key)) { setChainError('The chain contains ' + key + ' more than once.'); return; }
      seen.add(key);
    }
    const entries: AIChainEntryInput[] = chain.map(entry => ({
      providerId: entry.providerId, model: entry.model, vision: entry.vision, paidApproved: entry.paidApproved,
    }));
    setChainSaving(true);
    setChainError('');
    try {
      const next = await saveAIChain(entries);
      setData(next);
      setChain(next.chain);
      setChainDirty(false);
      setNotice('Fallback chain saved.');
    } catch (error) {
      setChainError((error as Error).message);
    } finally {
      setChainSaving(false);
    }
  };

  const resetChain = () => {
    if (!writable) return;
    setConfirm({ kind: 'reset' });
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 pb-20 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">AI providers</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-3)]">
            Choose the models used for drafting and chart reading, and the order they are tried. Keys are write-only.
          </p>
          {data && <p className="st-meta mt-1 text-[var(--text-3)]">Cost policy: {data.costPolicy}</p>}
        </div>
      </header>

      {loading && <p role="status" className="text-xs text-neutral-400">Loading provider settings…</p>}
      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--r-inner)] bg-[var(--danger)]/[0.06] px-3 py-2 text-xs text-[var(--down)]">
          <span>{loadError}</span>
          <button type="button" onClick={() => void load()} className={secondary}>Retry</button>
        </div>
      )}
      {actionError && <p role="alert" className="rounded-[var(--r-inner)] bg-[var(--danger)]/[0.06] px-3 py-2 text-xs text-[var(--down)]">{actionError}</p>}
      {notice && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-[var(--r-inner)] bg-[var(--accent)]/[0.06] px-3 py-2 text-xs text-[#cfe0ff]">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice" className={'shrink-0 rounded p-0.5 text-[#cfe0ff] hover:bg-white/10 ' + focus}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      {data && !data.writable && (
        <div role="status" className="rounded-[var(--r-inner)] bg-[var(--warn)]/[0.06] px-3 py-2 text-xs leading-5 text-[#f5d383]">
          <p className="font-medium">Read-only on this deployment</p>
          <p className="mt-0.5 text-amber-100/80">{data.writeBlockedReason ?? 'Provider settings cannot be changed here.'}</p>
        </div>
      )}
      {data?.persistence === 'ephemeral' && (
        <p className="text-xs leading-5 text-neutral-400">Saved settings are lost when the server redeploys. Use env vars for permanent settings.</p>
      )}

      <Section
        title="Providers"
        description="Built-in providers read their key from the server environment. Custom providers use an OpenAI-compatible chat-completions endpoint."
        actions={writable && !form ? <button type="button" onClick={openAdd} className={secondary}><Plus className="h-3.5 w-3.5" aria-hidden="true" />Add provider</button> : undefined}
      >
        {form && (
          <form onSubmit={saveProvider} noValidate aria-label="Provider form" className="space-y-3 rounded-[var(--r-inner)] bg-[var(--surface-2)] p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-neutral-100">{form.id ? 'Edit provider' : 'Add provider'}</h3>
              <button type="button" onClick={closeForm} className={secondary} aria-label="Close provider form"><X className="h-3.5 w-3.5" aria-hidden="true" />Close</button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="text-xs text-neutral-400">
                <label htmlFor="provider-label" className="block">Label</label>
                <input
                  id="provider-label"
                  ref={labelRef}
                  className={(fieldErrors.label ? inputClass.replace('border-[var(--line-strong)]', 'border-[var(--danger)]') : inputClass) + ' mt-1'}
                  maxLength={100}
                  value={form.label}
                  aria-invalid={Boolean(fieldErrors.label)}
                  aria-describedby={fieldErrors.label ? 'provider-label-error' : undefined}
                  onChange={event => {
                    setForm(current => current && { ...current, label: event.target.value });
                    setFieldErrors(current => ({ ...current, label: undefined }));
                  }}
                />
                {fieldErrors.label && <p id="provider-label-error" className="mt-1 text-[11px] text-[var(--danger)]">{fieldErrors.label}</p>}
              </div>
              <div className="text-xs text-neutral-400">
                <label htmlFor="provider-base-url" className="block">Base URL</label>
                <input
                  id="provider-base-url"
                  ref={baseUrlRef}
                  className={(fieldErrors.baseUrl ? inputClass.replace('border-[var(--line-strong)]', 'border-[var(--danger)]') : inputClass) + ' mt-1'}
                  type="url"
                  placeholder="https://api.example.com/v1"
                  value={form.baseUrl}
                  aria-invalid={Boolean(fieldErrors.baseUrl)}
                  aria-describedby={fieldErrors.baseUrl ? 'provider-base-url-error' : undefined}
                  onChange={event => {
                    setForm(current => current && { ...current, baseUrl: event.target.value });
                    setFieldErrors(current => ({ ...current, baseUrl: undefined }));
                  }}
                />
                {fieldErrors.baseUrl && <p id="provider-base-url-error" className="mt-1 text-[11px] text-[var(--danger)]">{fieldErrors.baseUrl}</p>}
              </div>
            </div>
            <label className="block text-xs text-neutral-400">API key
              <input
                className={inputClass + ' mt-1'}
                type="password"
                autoComplete="new-password"
                value={form.apiKey}
                placeholder={form.keySource === 'stored' ? 'Leave blank to keep the saved key' : form.keySource === 'env' ? 'Uses the environment key unless replaced' : 'Paste a key'}
                onChange={event => setForm(current => current && { ...current, apiKey: event.target.value })}
              />
              <span title={form.keySource === 'env' ? 'Server environment' : undefined} className="mt-1 block text-[11px] text-neutral-500">
                {form.id ? keyStatus(form) : 'A key is stored write-only and never shown again.'}
              </span>
            </label>
            {form.id && form.keySource === 'stored' && writable && (
              <button type="button" onClick={() => void removeSavedKey()} disabled={savingProvider} className={danger}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Remove saved key
              </button>
            )}
            <label className="flex min-h-6 items-center gap-2 text-xs text-neutral-300">
              <input type="checkbox" className="h-4 w-4 accent-[#a8c7fa]" checked={form.enabled} onChange={event => setForm(current => current && { ...current, enabled: event.target.checked })} />
              Enabled
            </label>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-medium text-neutral-300">Extra headers <span className="font-normal text-neutral-500">(optional)</span></h4>
                <button type="button" className={secondary} onClick={() => setForm(current => current && { ...current, headers: [...current.headers, { name: '', value: '', existing: false }] })}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />Add header
                </button>
              </div>
              {form.headers.length === 0 && <p className="text-[11px] text-neutral-500">No extra headers.</p>}
              {form.headers.map((header, index) => (
                <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                  <label className="text-[11px] text-neutral-500">Header name
                    <input className={smallInput} value={header.name} placeholder="X-Header" onChange={event => setForm(current => current && {
                      ...current,
                      headers: current.headers.map((item, position) => position === index ? { ...item, name: event.target.value } : item),
                    })} />
                  </label>
                  <label className="text-[11px] text-neutral-500">Header value
                    <input className={smallInput} type="password" autoComplete="new-password" value={header.value} placeholder={header.existing ? 'Saved value hidden — re-enter to keep' : 'Value'} onChange={event => setForm(current => current && {
                      ...current,
                      headers: current.headers.map((item, position) => position === index ? { ...item, value: event.target.value } : item),
                    })} />
                  </label>
                  <button type="button" className={danger} onClick={() => setForm(current => current && { ...current, headers: current.headers.filter((_, position) => position !== index) })} aria-label={'Remove header ' + (header.name || index + 1)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
              <p className="text-[11px] leading-4 text-neutral-500">Saved header values are hidden. Re-enter a value to keep that header; a blank existing header is removed when you save.</p>
            </div>
            {formError && <p role="alert" className="rounded-lg border border-rose-400/25 bg-rose-400/5 px-3 py-2 text-xs text-rose-200">{formError}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" disabled={savingProvider} className={primary}>{savingProvider ? 'Saving…' : 'Save provider'}</button>
              <button type="button" onClick={closeForm} className={secondary}>Cancel</button>
            </div>
          </form>
        )}

        <ul className="divide-y divide-[var(--line)]">
          {providers.map(provider => {
            const busy = busyProvider === provider.id;
            return (
              <li key={provider.id} className="p-3 sm:p-4 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-neutral-100">{provider.label}</span>
                      {provider.builtin && <span className="st-meta text-[var(--text-3)]">Built-in</span>}
                      <span
                        title={provider.keySource === 'env'
                          ? 'Key read from the server environment'
                          : provider.keySource === 'stored'
                            ? 'Key saved in this deployment. It is write-only and never displayed.'
                            : 'No key in the server environment and none saved. Test calls and AI requests to this provider fail until a key is added.'}
                        className={provider.keySource === 'none' ? 'text-[11px] text-neutral-500' : 'text-[11px] text-[#a8c7fa]'}
                      >{keyStatus(provider)}</span>
                    </div>
                    <p className="st-meta mt-1 truncate font-mono text-[var(--text-3)]">{provider.baseUrl}</p>
                    {provider.extraHeaderNames.length > 0 && <p className="mt-1 text-[10px] text-neutral-500">Headers: {provider.extraHeaderNames.join(', ')} (values hidden)</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex min-h-6 items-center gap-2 text-xs text-neutral-300">
                      <input type="checkbox" className="h-4 w-4 accent-[#a8c7fa]" checked={provider.enabled} disabled={!writable || busy} onChange={event => void toggleProvider(provider, event.target.checked)} aria-label={'Enable ' + provider.label} />
                      Enabled
                    </label>
                    <button type="button" onClick={() => void openModels(provider)} className={secondary}>
                      <List className="h-3.5 w-3.5" aria-hidden="true" />Models
                    </button>
                    {writable && <button type="button" onClick={() => openEdit(provider)} className={secondary} aria-label={'Edit ' + provider.label}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit</button>}
                    {writable && !provider.builtin && <button type="button" onClick={() => void removeProvider(provider)} className={danger} aria-label={'Delete ' + provider.label}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Delete</button>}
                  </div>
                </div>
              </li>
            );
          })}
          {!loading && providers.length === 0 && <li className="p-4 text-xs text-neutral-400">No providers are configured.</li>}
        </ul>
        <p className="text-[11px] leading-5 text-neutral-500">
          “No key” means no key in the server environment and none saved here; test calls and AI requests for that provider fail until one is added.
        </p>
      </Section>

      {selectedProvider && (
        <Section
          title={'Models · ' + selectedProvider.label}
          description="Model prices are shown per one million tokens. Free means the provider reports a zero price; unknown prices require explicit paid approval in the chain."
          actions={<button type="button" onClick={() => void reloadModels()} disabled={modelsLoading} className={secondary}><RefreshCw className={'h-3.5 w-3.5 ' + (modelsLoading ? 'animate-spin' : '')} aria-hidden="true" />{modelsLoading ? 'Loading…' : 'List models'}</button>}
        >
          {modelsError && <div role="alert" className="flex flex-wrap items-center gap-3 text-xs text-rose-200"><span>{modelsError}</span><button type="button" onClick={() => void reloadModels()} className={secondary}>Retry</button></div>}
          {!modelsError && (models[selectedProvider.id]?.length ?? 0) > 0 && (
            <label className="block text-xs text-neutral-400">Search models
              <span className="relative mt-1 block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" aria-hidden="true" />
                <input className={inputClass + ' pl-8'} value={modelQuery} onChange={event => setModelQuery(event.target.value)} placeholder="Filter by model id or name" />
              </span>
            </label>
          )}
          {!modelsError && selectedModels.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
              <label className="inline-flex min-h-6 items-center gap-2 text-xs text-neutral-300">
                <input type="checkbox" className="h-4 w-4 accent-[#a8c7fa]" checked={freeOnly} onChange={event => setFreeOnly(event.target.checked)} />
                Free only
              </label>
              <span>{selectedModels.length} models · {freeModelCount} free</span>
            </div>
          )}
          {!modelsLoading && modelsError === '' && (models[selectedProvider.id]?.length ?? 0) === 0 && (
            <p className="text-xs text-neutral-400">No models loaded. Choose “List models” to fetch the provider catalog.</p>
          )}
          {modelsLoading && <p role="status" className="text-xs text-neutral-400">Loading models…</p>}
          {filteredModels.length > 0 && (
            <>
              <div className="st-scroll-x hidden overflow-x-auto md:block">
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] font-medium border-b border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-3)]">
                    <tr><th className="px-3 py-2">Model</th><th className="px-3 py-2">Context</th><th className="px-3 py-2">Input</th><th className="px-3 py-2">Price</th><th className="px-3 py-2 text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-white/8">
                    {filteredModels.map(model => {
                      const key = selectedProvider.id + ':' + model.id;
                      const test = tests[key];
                      return (
                        <tr key={model.id}>
                          <td className="px-3 py-2"><span className="font-mono text-neutral-200">{model.id}</span>{model.name && <span className="block text-[10px] text-neutral-500">{model.name}</span>}</td>
                          <td className="px-3 py-2 text-neutral-400">{contextLabel(model.contextLength)}</td>
                          <td className="px-3 py-2 text-neutral-400">{inputLabel(model)}</td>
                          <td className="px-3 py-2 text-neutral-300" title={priceTitle(model.price)}>{priceLabel(model.price, model.free, selectedProvider.id)}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <button type="button" className={secondary} disabled={test && 'loading' in test} onClick={() => void runTest(selectedProvider, model)}>{test && 'loading' in test ? 'Testing…' : 'Test'}</button>
                              {inChain(selectedProvider.id, model.id)
                                ? <span className="st-meta inline-flex min-h-6 items-center rounded-[var(--r-btn)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[var(--text-2)]">In chain</span>
                                : <button type="button" className={secondary} disabled={!writable || chain.length >= 6} onClick={() => addToChain(selectedProvider, model)}>Add to chain</button>}
                            </div>
                            {test && !('loading' in test) && <p role={test.ok ? 'status' : 'alert'} className={'mt-1 text-right text-[10px] ' + (test.ok ? 'text-emerald-300' : 'text-rose-300')}>{test.ok ? 'OK · ' + test.latencyMs + ' ms · ' + (test.answeredBy ?? model.id) : 'Failed: ' + (test.error ?? 'unknown error')}</p>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 md:hidden">
                {filteredModels.map(model => {
                  const key = selectedProvider.id + ':' + model.id;
                  const test = tests[key];
                  return (
                    <div key={model.id} className="space-y-2 rounded-[var(--r-inner)] bg-[var(--surface-2)] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-all font-mono text-xs text-neutral-200">{model.id}</p>
                          {model.name && <p className="text-[10px] text-neutral-500">{model.name}</p>}
                        </div>
                        <span className="shrink-0 text-[10px] text-neutral-400">{contextLabel(model.contextLength)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
                        <span>{inputLabel(model)}</span>
                        <span title={priceTitle(model.price)}>{priceLabel(model.price, model.free, selectedProvider.id)}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" className={secondary} disabled={test && 'loading' in test} onClick={() => void runTest(selectedProvider, model)}>{test && 'loading' in test ? 'Testing…' : 'Test'}</button>
                        {inChain(selectedProvider.id, model.id)
                          ? <span className="st-meta inline-flex min-h-6 items-center rounded-[var(--r-btn)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[var(--text-2)]">In chain</span>
                          : <button type="button" className={secondary} disabled={!writable || chain.length >= 6} onClick={() => addToChain(selectedProvider, model)}>Add to chain</button>}
                      </div>
                      {test && !('loading' in test) && <p role={test.ok ? 'status' : 'alert'} className={'text-[11px] ' + (test.ok ? 'text-emerald-300' : 'text-rose-300')}>{test.ok ? 'OK · ' + test.latencyMs + ' ms · ' + (test.answeredBy ?? model.id) : 'Failed: ' + (test.error ?? 'unknown error')}</p>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Section>
      )}

      <Section
        title="Fallback chain"
        description="Models are tried from top to bottom. A fallback answers only after the earlier entries fail. A paid or unknown-price entry needs explicit approval."
        actions={writable ? <><button type="button" onClick={() => void saveChain()} disabled={chainSaving || !chainDirty} className={primary}>{chainSaving ? 'Saving…' : 'Save chain'}</button><button type="button" onClick={resetChain} className={secondary}>Reset to env defaults</button></> : undefined}
      >
        {chainError && <p role="alert" className="rounded-lg border border-rose-400/25 bg-rose-400/5 px-3 py-2 text-xs text-rose-200">{chainError}</p>}
        {chain.length === 0 && <p className="rounded-[var(--r-inner)] border border-dashed border-[var(--line-strong)] p-6 text-center text-xs text-[var(--text-3)]">The chain is empty. Use “Add to chain” from a provider’s model list.</p>}
        <ol className="space-y-2">
          {chain.map((entry, index) => {
            const paid = entry.free !== true;
            const status = lastStatusLabel(entry.lastStatus);
            return (
              <li key={entry.providerId + ':' + entry.model} className="space-y-2 rounded-[var(--r-inner)] bg-[var(--surface-2)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] text-[var(--text-3)]">{index === 0 ? 'Primary' : 'Fallback ' + (index + 1)}</span>
                      <span className="text-sm font-medium text-neutral-100">{providerName(entry.providerId)}</span>
                      <span className="break-all font-mono text-[11px] text-neutral-300">{entry.model}</span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
                      <span title={priceTitle(entry.price)}>{priceLabel(entry.price, entry.free, entry.providerId)}</span>
                      <span title={entry.lastStatus ? undefined : 'Call status is kept in memory and resets when the server restarts.'}>{status}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => moveChain(index, -1)} disabled={!writable || index === 0} className={secondary} aria-label={'Move ' + entry.model + ' up'}><ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />Up</button>
                    <button type="button" onClick={() => moveChain(index, 1)} disabled={!writable || index === chain.length - 1} className={secondary} aria-label={'Move ' + entry.model + ' down'}><ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />Down</button>
                    <button type="button" onClick={() => removeChain(index)} disabled={!writable} className={danger} aria-label={'Remove ' + entry.model + ' from chain'}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="inline-flex min-h-6 items-center gap-2 text-xs text-neutral-300">
                    <input type="checkbox" className="h-4 w-4 accent-[#a8c7fa]" checked={entry.vision} disabled={!writable} onChange={event => updateChain(index, { vision: event.target.checked })} />
                    Vision
                  </label>
                  {paid && (
                    <label className="inline-flex min-h-6 items-center gap-2 text-xs text-amber-100/90">
                      <input type="checkbox" className="h-4 w-4 accent-[#a8c7fa]" checked={entry.paidApproved} disabled={!writable} onChange={event => updateChain(index, { paidApproved: event.target.checked })} />
                      Approve paid use
                    </label>
                  )}
                </div>
                {paid && <p className="text-[10px] leading-4 text-neutral-500">Uses your paid quota when earlier models fail.</p>}
              </li>
            );
          })}
        </ol>
        {!writable && <p className="text-xs text-neutral-400">The current chain is shown for reference and cannot be edited on this deployment.</p>}
      </Section>

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'delete' ? 'Delete provider?' : 'Reset provider settings?'}
          body={confirm.kind === 'delete'
            ? 'Delete “' + confirm.provider.label + '”? Its chain entries will also be removed. Built-in providers cannot be deleted.'
            : 'Reset all saved providers and the fallback chain to the environment defaults? Saved custom providers and stored keys will be removed.'}
          confirmLabel={confirm.kind === 'delete' ? 'Delete provider' : 'Reset chain'}
          onConfirm={() => void confirmAction()}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
};
