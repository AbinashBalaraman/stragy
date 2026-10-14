import { useEffect, useRef, useState } from 'react';
export interface DerivativeTicket { revision: number; key: string; signal: AbortSignal }
export class DerivativeRequestOwner {
  private revision = 0;
  private controller: AbortController | null = null;
  begin(key: string): DerivativeTicket { this.cancel(); this.controller = new AbortController(); return { revision: this.revision, key, signal: this.controller.signal }; }
  owns(ticket: DerivativeTicket): boolean { return this.revision === ticket.revision && !ticket.signal.aborted; }
  cancel(): void { this.revision++; this.controller?.abort(); this.controller = null; }
}
/** Own every request, including refresh, failure and cleanup. No stale success fallback. */
export function useDerivativeRequest<T>(key: string, endpoint: string, parse: (value: unknown, key: string) => T, options?: { post?: boolean; delay?: number; valid?: boolean }) {
  const owner = useRef(new DerivativeRequestOwner());
  const [refreshId, setRefreshId] = useState(0);
  const [state, setState] = useState<{ key: string; data: T | null; loading: boolean; error: string | null }>({ key, data: null, loading: true, error: null });
  const post = options?.post ?? false, delay = options?.delay ?? 0, valid = options?.valid ?? true;
  const invalidate = () => { owner.current.cancel(); setState({ key, data: null, loading: true, error: null }); setRefreshId(v => v + 1); };
  const refresh = invalidate;
  useEffect(() => {
    const controller = owner.current;
    const ticket = controller.begin(key);
    setState({ key, data: null, loading: valid, error: valid ? null : 'Enter valid positive inputs within the displayed limits.' });
    if (!valid) return () => controller.cancel();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(endpoint, { signal: ticket.signal, ...(post ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key } : {}) });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = parse(await response.json(), key);
        if (controller.owns(ticket)) setState({ key, data, loading: false, error: null });
      } catch (error) {
        if (controller.owns(ticket)) setState({ key, data: null, loading: false, error: 'Could not load a validated demo/model response. Retry after checking inputs. ' + (error instanceof Error && error.message.startsWith('HTTP ') ? error.message : '') });
      }
    }, delay);
    return () => { clearTimeout(timer); controller.cancel(); };
  }, [key, endpoint, parse, post, delay, valid, refreshId]);
  return { data: state.key === key ? state.data : null, isLoading: state.key !== key || state.loading, error: state.key === key ? state.error : null, invalidate, refresh };
}
