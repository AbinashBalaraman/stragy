// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProviderSettings } from '../../components/settings/ProviderSettings';
import type {
  AIChainEntryPublic, AIProviderPublic, AIProvidersResponse,
} from '../../shared/contracts/aiProviders';
import {
  getAIProviderModels, getAIProviders, saveAIChain, updateAIProvider,
} from '../../client/aiProviders';

vi.mock('../../client/aiProviders', () => ({
  getAIProviders: vi.fn(),
  createAIProvider: vi.fn(),
  updateAIProvider: vi.fn(),
  deleteAIProvider: vi.fn(),
  getAIProviderModels: vi.fn(),
  testAIProviderModel: vi.fn(),
  saveAIChain: vi.fn(),
  resetAIProviders: vi.fn(),
}));

const providers: AIProviderPublic[] = [
  {
    id: 'opencode-go', label: 'OpenCode Go', baseUrl: 'https://opencode.ai/zen/v1', builtin: true,
    enabled: true, keySource: 'env', keyHint: null, extraHeaderNames: [],
  },
  {
    id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', builtin: true,
    enabled: true, keySource: 'stored', keyHint: '…ab12', extraHeaderNames: [],
  },
  {
    id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', builtin: true,
    enabled: true, keySource: 'none', keyHint: null, extraHeaderNames: [],
  },
];

const freeEntry = (providerId: string, model: string, vision = false): AIChainEntryPublic => ({
  providerId, model, vision, paidApproved: false,
  price: { prompt: 0, completion: 0 }, free: true, lastStatus: null,
});

const paidEntry: AIChainEntryPublic = {
  providerId: 'deepseek', model: 'deepseek-v4.1-flash', vision: true, paidApproved: false,
  price: { prompt: 0.28, completion: 0.42 }, free: false,
  lastStatus: { ok: false, at: '2026-11-16T10:00:00.000Z', error: 'Rate limited' },
};

const baseResponse = (chain: AIChainEntryPublic[] = [
  freeEntry('opencode-go', 'hy4-flash-free', true),
  freeEntry('openrouter', 'openrouter/free'),
]): AIProvidersResponse => ({
  providers, chain, costPolicy: 'free-only', writable: true,
  secretsStorage: 'encrypted', persistence: 'durable',
});

const savedProvider: AIProviderPublic = {
  id: 'dummy', label: 'Dummy', baseUrl: 'https://example.com/v1', builtin: false,
  enabled: false, keySource: 'stored', keyHint: '…9f2c', extraHeaderNames: ['X-Tenant'],
};

beforeEach(() => {
  vi.mocked(getAIProviders).mockResolvedValue(baseResponse());
  vi.mocked(getAIProviderModels).mockReset();
  vi.mocked(updateAIProvider).mockReset();
  vi.mocked(saveAIChain).mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('provider settings', () => {
  it('lists provider key status and never prefills the saved key when editing', async () => {
    render(<ProviderSettings />);

    expect(await screen.findByText('Saved (…ab12)')).toBeTruthy();
    expect(screen.getByText('From env')).toBeTruthy();
    expect(screen.getByText('No key')).toBeTruthy();
    expect(screen.getByText(/means no key in the server environment and none saved here/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit OpenRouter' }));

    const keyInput = screen.getByLabelText(/^API key/) as HTMLInputElement;
    expect(keyInput.type).toBe('password');
    expect(keyInput.value).toBe('');
    expect(document.querySelector('input[value*="ab12"]')).toBeNull();
    expect(screen.getAllByText(/^Saved \(…ab12\)$/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /Remove saved key/ })).toBeTruthy();

    vi.mocked(updateAIProvider).mockResolvedValue({ provider: providers[1] });
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));
    await waitFor(() => expect(updateAIProvider).toHaveBeenCalledTimes(1));
    const body = vi.mocked(updateAIProvider).mock.calls[0]?.[1];
    expect(body).not.toHaveProperty('apiKey');
    expect(body).not.toHaveProperty('clearKey');
    expect(body?.extraHeaders).toEqual({});
    expect(await screen.findByText('Provider saved. No key entered.')).toBeTruthy();
  });

  it('moves a chain entry up and saves the new order', async () => {
    const response = baseResponse();
    vi.mocked(saveAIChain).mockResolvedValue({
      ...response,
      chain: [freeEntry('openrouter', 'openrouter/free'), freeEntry('opencode-go', 'hy4-flash-free', true)],
    });
    render(<ProviderSettings />);

    await screen.findByText('hy4-flash-free');
    fireEvent.click(screen.getByRole('button', { name: 'Move openrouter/free up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save chain' }));

    await waitFor(() => expect(saveAIChain).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveAIChain).mock.calls[0]?.[0]).toEqual([
      { providerId: 'openrouter', model: 'openrouter/free', vision: false, paidApproved: false },
      { providerId: 'opencode-go', model: 'hy4-flash-free', vision: true, paidApproved: false },
    ]);
  });

  it('blocks saving a paid entry until paid use is approved', async () => {
    vi.mocked(getAIProviders).mockResolvedValue(baseResponse([
      freeEntry('opencode-go', 'hy4-flash-free', true),
      paidEntry,
    ]));
    render(<ProviderSettings />);

    await screen.findByText('deepseek-v4.1-flash');
    fireEvent.click(screen.getAllByLabelText('Vision')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save chain' }));

    expect(screen.getByText(/Approve paid or unknown-price use/)).toBeTruthy();
    expect(saveAIChain).not.toHaveBeenCalled();
    expect(screen.getByText('Uses your paid quota when earlier models fail.')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Approve paid use'));
    fireEvent.click(screen.getByRole('button', { name: 'Save chain' }));

    await waitFor(() => expect(saveAIChain).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveAIChain).mock.calls[0]?.[0][1]).toMatchObject({
      providerId: 'deepseek', model: 'deepseek-v4.1-flash', paidApproved: true,
    });
  });

  it('labels catalog-paid Go models and truly unknown prices distinctly', async () => {
    const pricedPaid: AIChainEntryPublic = {
      providerId: 'openrouter', model: 'paid/model', vision: false, paidApproved: true,
      price: { prompt: 0.0000005, completion: 0.0000015 }, free: false, lastStatus: null,
    };
    const catalogPaid: AIChainEntryPublic = {
      providerId: 'opencode-go', model: 'deepseek-v4.1-flash', vision: false, paidApproved: true,
      price: null, free: false, lastStatus: null,
    };
    const unknown: AIChainEntryPublic = {
      providerId: 'custom', model: 'mystery', vision: false, paidApproved: true,
      price: null, free: null, lastStatus: null,
    };
    vi.mocked(getAIProviders).mockResolvedValue(baseResponse([freeEntry('opencode-go', 'hy4-flash-free', true), catalogPaid, pricedPaid, unknown]));
    render(<ProviderSettings />);

    expect(await screen.findByText('Paid (Go quota)')).toBeTruthy();
    expect(screen.getByText(/Paid · \$0\.50? \/ 1M/)).toBeTruthy();
    expect(screen.getByText('Unknown price')).toBeTruthy();
  });

  it('defaults OpenRouter to free-only, shows catalog counts and marks chain entries', async () => {
    vi.mocked(getAIProviderModels).mockResolvedValue({
      models: [
        { id: 'openrouter/free', name: 'Free Models Router', contextLength: 200_000, inputModalities: ['text', 'image'], price: { prompt: 0, completion: 0 }, free: true },
        { id: 'paid/model', name: 'Paid Model', contextLength: 128_000, inputModalities: ['text'], price: { prompt: 0.0000005, completion: 0.0000015 }, free: false },
      ],
    });
    render(<ProviderSettings />);

    await screen.findByText('hy4-flash-free');
    const openRouterRow = screen.getByRole('button', { name: 'Edit OpenRouter' }).closest('li') as HTMLElement;
    fireEvent.click(within(openRouterRow).getByRole('button', { name: 'Models' }));

    const freeOnly = await screen.findByLabelText('Free only') as HTMLInputElement;
    expect(freeOnly.checked).toBe(true);
    expect(screen.getByText('2 models · 1 free')).toBeTruthy();
    expect(screen.queryByText('paid/model')).toBeNull();
    expect(screen.getAllByText('In chain').length).toBeGreaterThan(0);

    fireEvent.click(freeOnly);
    expect((await screen.findAllByText('paid/model')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Paid · \$0\.50? \/ 1M/).length).toBeGreaterThan(0);
  });

  it('is read-only when the server is not writable and states why', async () => {
    const response = baseResponse([freeEntry('opencode-go', 'hy4-flash-free', true), paidEntry]);
    vi.mocked(getAIProviders).mockResolvedValue({
      ...response,
      writable: false,
      writeBlockedReason: 'Provider settings are managed by the deployment environment.',
      persistence: 'ephemeral',
    });
    render(<ProviderSettings />);

    expect(await screen.findByText('Read-only on this deployment')).toBeTruthy();
    expect(screen.getByText('Provider settings are managed by the deployment environment.')).toBeTruthy();
    expect(screen.getByText('Saved settings are lost when the server redeploys. Use env vars for permanent settings.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add provider' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save chain' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset to env defaults' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();

    const enabled = screen.getByLabelText('Enable OpenCode Go') as HTMLInputElement;
    expect(enabled.disabled).toBe(true);
    const approve = screen.getByLabelText('Approve paid use') as HTMLInputElement;
    expect(approve.disabled).toBe(true);
    expect(approve.checked).toBe(false);
  });

  it('shows a saved custom provider without exposing header values', async () => {
    const response = baseResponse();
    vi.mocked(getAIProviders).mockResolvedValue({
      ...response,
      providers: [...providers, savedProvider],
    });
    render(<ProviderSettings />);

    expect(await screen.findByText('Dummy')).toBeTruthy();
    expect(screen.getByText(/Headers: X-Tenant \(values hidden\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Dummy' }));

    const headerValue = screen.getByLabelText('Header value') as HTMLInputElement;
    expect(headerValue.type).toBe('password');
    expect(headerValue.value).toBe('');
    expect(headerValue.placeholder).toContain('Saved value hidden');
    expect(screen.getByRole('button', { name: 'Delete Dummy' })).toBeTruthy();
  });
});
