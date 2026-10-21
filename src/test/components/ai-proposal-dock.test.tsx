// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { createProposal } from '../../server/ai/proposals';
import { validStrategy } from '../../server/ai/testFixtures';
import type { CreateProposalResult } from '../../server/ai/types';

const response = (value: unknown) => {
  const draft = value as CreateProposalResult;
  const body = draft.ok ? { schemaVersion: 1, kind: 'proposal', originatingRevision: draft.proposal.originatingRevision, message: draft.proposal.rationale, method: draft.proposal.method, provider: draft.proposal.provider, warnings: draft.proposal.warnings, proposal: draft.proposal } : { schemaVersion: 1, kind: 'conversation', originatingRevision: 1, message: draft.error.message, method: 'unavailable', provider: { name: 'none', model: null, aiGenerated: false }, warnings: [] };
  return { ok: true, status: 200, json: async () => body } as Response;
};
async function localDraft(revision: number): Promise<CreateProposalResult> {
  return createProposal({ prompt: 'set stop loss to 3%', currentStrategy: validStrategy(), originatingRevision: revision }, {
    env: { AI_PROVIDER: 'none' }, idFactory: () => 'dock-fixture', now: () => new Date('2026-01-01T00:00:00Z'),
  });
}
function stubDraft(transform: (value: CreateProposalResult) => unknown = value => value) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string);
    return response(transform(await localDraft(request.originatingRevision)));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
function generate() {
  fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'set stop loss to 3%' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
}

let storageDom: JSDOM | undefined;
beforeEach(() => {
  // Vitest's window aliases the global where Node 26's experimental localStorage shadows
  // the browser property. Obtain real origin-scoped Storage from an independent JSDOM.
  storageDom = new JSDOM('', { url: 'https://proposal.test/' });
  vi.stubGlobal('localStorage', storageDom.window.localStorage);
});
afterEach(() => { cleanup(); storageDom?.window.close(); storageDom = undefined; });

describe('proposal dock review and explicit actions', () => {
  it('renders real server provider metadata, without applying, running or scanning automatically', async () => {
    stubDraft();
    const apply = vi.fn(), run = vi.fn(), scanner = vi.fn();
    render(<AiCopilotDock strategy={validStrategy()} onApplyVariation={apply} onRunBacktest={run} onRunScanner={scanner}/>);
    generate();
    await screen.findByRole('article', { name: 'Draft proposal' });
    expect(screen.getByText(/provider: local_heuristic; model: none; Not AI-generated/)).toBeTruthy();
    expect(apply).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled(); expect(scanner).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply draft' }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0][0].risk.stopLoss.value).toBe(3);
    expect(screen.getByText(/Waiting for workspace confirmation/)).toBeTruthy();
    expect(screen.queryByText(/Draft applied to the workspace/)).toBeNull();
    expect(run).not.toHaveBeenCalled(); expect(scanner).not.toHaveBeenCalled();
  });

  it('confirms applying only after the workspace actually matches the draft', async () => {
    stubDraft();
    const apply = vi.fn();
    const view = render(<AiCopilotDock strategy={validStrategy()} onApplyVariation={apply}/>);
    generate(); await screen.findByRole('article', { name: 'Draft proposal' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply draft' }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    view.rerender(<AiCopilotDock strategy={apply.mock.calls[0][0]} onApplyVariation={apply}/>);
    expect(await screen.findByText(/Draft applied to the workspace/)).toBeTruthy();
  });

  it('reports a rejected apply without pretending it succeeded', async () => {
    stubDraft();
    render(<AiCopilotDock strategy={validStrategy()} onApplyVariation={async () => { throw new Error('Apply refused'); }}/>);
    generate(); await screen.findByRole('article', { name: 'Draft proposal' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply draft' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Apply refused');
    expect(screen.queryByText(/Draft applied to the workspace/)).toBeNull();
  });

  it('respects explicit apply acknowledgements and rejection', async () => {
    stubDraft();
    const apply = vi.fn<() => boolean>().mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<AiCopilotDock strategy={validStrategy()} onApplyVariation={apply}/>);
    generate(); await screen.findByRole('article', { name: 'Draft proposal' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply draft' }));
    expect((await screen.findByRole('alert')).textContent).toContain('workspace rejected');
    expect(screen.queryByText(/Draft applied to the workspace/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apply draft' }));
    expect(await screen.findByText(/Draft applied to the workspace/)).toBeTruthy();
  });

  it('rejects the former string provider and stale revision', async () => {
    const view = render(<AiCopilotDock strategy={validStrategy()}/>);
    stubDraft(value => value.ok ? { ...value, proposal: { ...value.proposal, provider: 'local_heuristic' } } : value);
    generate(); await screen.findByRole('alert');
    expect(screen.queryByRole('article', { name: 'Draft proposal' })).toBeNull();
    stubDraft(value => value.ok ? { ...value, proposal: { ...value.proposal, originatingRevision: -1 } } : value);
    generate();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('stale'));
    expect(screen.queryByRole('article', { name: 'Draft proposal' })).toBeNull();
    view.unmount();
  });

  it('ignores a late response after the workspace changes', async () => {
    let resolve!: (value: Response) => void;
    let revision = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      revision = JSON.parse(init.body as string).originatingRevision;
      return new Promise<Response>(done => { resolve = done; });
    }));
    const view = render(<AiCopilotDock strategy={validStrategy()}/>);
    generate();
    view.rerender(<AiCopilotDock strategy={validStrategy({ name: 'Changed workspace' })}/>);
    resolve(response(await localDraft(revision)));
    await waitFor(() => expect(screen.queryByText('Processing research request...')).toBeNull());
    expect(screen.queryByRole('article', { name: 'Draft proposal' })).toBeNull();
  });

  it('shows the server failure message without producing a review card', async () => {
    stubDraft(() => ({ ok: false, error: { code: 'no_local_match', message: 'No explicit local edit was recognised.' }, warnings: [], originatingRevision: 1 }));
    render(<AiCopilotDock strategy={validStrategy()}/>);
    generate();
    expect((await screen.findByRole('alert')).textContent).toContain('No explicit local edit was recognised.');
    expect(screen.queryByRole('article', { name: 'Draft proposal' })).toBeNull();
  });

  it('reports clipboard success only after completion, and reports rejection honestly', async () => {
    stubDraft();
    let finish!: () => void;
    const writeText = vi.fn((_text: string) => new Promise<void>(resolve => { finish = resolve; }));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<AiCopilotDock strategy={validStrategy()}/>);
    generate(); await screen.findByRole('article', { name: 'Draft proposal' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy draft JSON' }));
    expect(screen.getByText('Copying draft...')).toBeTruthy();
    expect(screen.queryByText(/Draft copied/)).toBeNull();
    finish(); expect(await screen.findByText(/Draft copied. Nothing was applied or run./)).toBeTruthy();
    expect(JSON.parse(writeText.mock.calls[0][0]).risk.stopLoss.value).toBe(3);
    writeText.mockImplementationOnce(async () => { throw new Error('Clipboard denied'); });
    fireEvent.click(screen.getByRole('button', { name: 'Copy draft JSON' }));
    expect(await screen.findByText(/Copy failed. Clipboard denied/)).toBeTruthy();
    expect(screen.queryByText(/Draft copied/)).toBeNull();
  });
});
