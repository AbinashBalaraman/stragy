import { z } from 'zod';
import type { StrategyAST } from '../shared/strategy/types';
import { ChartObservationsSchema, ChartSelfCheckSchema, parseResearchChatResponse, type ResearchChatResponse } from '../shared/contracts/research-chat';
import { snapshotStrategy } from './workspace';
import { ApiError, cancelResearchJob, readJson } from './api';

export const CHART_IMAGE_MAX_BYTES = 5_000_000;
export const CHART_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const CHART_IMAGE_ACCEPT = CHART_IMAGE_MIME_TYPES.join(',');
/** The POST only enqueues, so the whole wait is polling with short GETs. */
export const CHART_JOB_POLL_MS = 1_500;
/**
 * The server runs two bounded vision passes inside a 200 s budget and caps the
 * job at 210 s. The client keeps the same ceiling: long enough for a cold read,
 * short enough that a dead provider is not an endless spinner.
 */
export const CHART_ANALYSIS_DEADLINE_MS = 210_000;
/**
 * The API allows 90 requests a minute per client, and a page sharing the
 * tunnel can spend part of that budget elsewhere. During a rate-limit window
 * every poll fails at once, so a few seconds of 429s must not discard a job
 * that is still running; the 210 s deadline remains the hard stop.
 */
const POLL_MAX_CONSECUTIVE_FAILURES = 40;
const MAX_SOURCE_SIDE = 2000;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,/i;

const ChartReadingSchema = z.object({
  source: z.literal('chart_image'),
  observations: ChartObservationsSchema,
  confidence: z.number().finite().min(0).max(1),
  summary: z.string().max(2000),
  selfCheck: ChartSelfCheckSchema.optional(),
}).strict();

export type ChartImageReading = z.infer<typeof ChartReadingSchema>;

/** A prepared image lives in memory only; it must never enter persisted chat history. */
export interface ChartImageAttachment {
  dataUrl: string;
  mimeType: (typeof CHART_IMAGE_MIME_TYPES)[number];
  name: string;
  bytes: number;
  downscaled: boolean;
}

export type ChartAnalysisResponse = ResearchChatResponse & { chartReading?: ChartImageReading };

export interface ChartAnalysisInput {
  image: string;
  hint?: string;
  currentStrategy: StrategyAST;
}

const DEFERRED_ERROR = 'The chart image could not be read.';

export function chartImageValidationError(file: File): string | null {
  const mime = file.type.toLowerCase();
  if (!CHART_IMAGE_MIME_TYPES.includes(mime as (typeof CHART_IMAGE_MIME_TYPES)[number])) {
    return 'Attach a PNG, JPEG or WebP chart image.';
  }
  if (file.size > CHART_IMAGE_MAX_BYTES) return 'Chart images must be 5 MB or smaller.';
  return null;
}

function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return Number.POSITIVE_INFINITY;
  const base64 = dataUrl.slice(comma + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') { reject(new Error(DEFERRED_ERROR)); return; }
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(DEFERRED_ERROR));
    reader.onerror = () => reject(new Error(DEFERRED_ERROR));
    reader.readAsDataURL(file);
  });
}

function canvasIsUsable(): boolean {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return false;
  // jsdom has no image decoder; skip resizing instead of failing or hanging.
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return false;
  try {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('2d') && typeof canvas.toDataURL === 'function';
  } catch {
    return false;
  }
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The chart image could not be decoded.'));
    image.src = source;
  });
}

async function downscaleDataUrl(dataUrl: string): Promise<{ dataUrl: string; mimeType: 'image/jpeg' } | null> {
  if (!canvasIsUsable()) return null;
  try {
    const image = await loadImage(dataUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const longest = Math.max(width, height);
    if (!longest || longest <= MAX_SOURCE_SIDE) return null;
    const scale = MAX_SOURCE_SIDE / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const resized = canvas.toDataURL('image/jpeg', 0.9);
    if (!DATA_URL.test(resized) || dataUrlByteLength(resized) > CHART_IMAGE_MAX_BYTES) return null;
    return { dataUrl: resized, mimeType: 'image/jpeg' };
  } catch {
    return null;
  }
}

/** Validate and read a chart file, resizing only when the browser can decode it. */
export async function prepareChartImage(file: File): Promise<ChartImageAttachment> {
  const error = chartImageValidationError(file);
  if (error) throw new Error(error);
  const dataUrl = await readFileAsDataUrl(file);
  if (!DATA_URL.test(dataUrl) || dataUrlByteLength(dataUrl) > CHART_IMAGE_MAX_BYTES) {
    throw new Error('Chart images must be a PNG, JPEG or WebP of 5 MB or smaller.');
  }
  const resized = await downscaleDataUrl(dataUrl);
  return {
    dataUrl: resized?.dataUrl ?? dataUrl,
    mimeType: resized?.mimeType ?? file.type.toLowerCase() as ChartImageAttachment['mimeType'],
    name: file.name || 'chart image',
    bytes: file.size,
    downscaled: !!resized,
  };
}

function chartReading(raw: unknown): ChartImageReading | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const hasChartFields = ['source', 'observations', 'confidence', 'summary'].some(key => key in record);
  if (!hasChartFields) return undefined;
  return ChartReadingSchema.parse({
    source: record.source,
    observations: record.observations,
    confidence: record.confidence,
    summary: record.summary,
    ...(record.selfCheck ? { selfCheck: record.selfCheck } : {}),
  });
}

/**
 * The shared contract is authoritative. The stripped fallback keeps older
 * deployments that place the chart fields beside a strict screen response
 * parseable; the chart fields themselves are always validated here.
 */
export function parseChartAnalysisResponse(raw: unknown): ChartAnalysisResponse {
  let parsed: ResearchChatResponse;
  try {
    parsed = parseResearchChatResponse(raw);
  } catch (directError) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw directError;
    const compatible = { ...(raw as Record<string, unknown>) };
    for (const key of ['source', 'observations', 'confidence', 'summary']) delete compatible[key];
    try { parsed = parseResearchChatResponse(compatible); }
    catch { throw directError; }
  }
  const reading = chartReading(raw);
  if (!reading) return parsed;
  if (parsed.kind !== 'screen') {
    throw new ApiError('Chart analysis returned chart fields without a screen plan.', 'INVALID_RESPONSE');
  }
  return { ...parsed, chartReading: reading };
}

function parseChartResult(raw: unknown): ChartAnalysisResponse {
  try { return parseChartAnalysisResponse(raw); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('The chart analysis response was invalid. No result was confirmed.', 'INVALID_RESPONSE');
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason ?? new DOMException('Request cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}

const JOB_ID = /^[A-Za-z0-9-]{1,100}$/;

export async function requestChartAnalysis(input: ChartAnalysisInput, signal?: AbortSignal): Promise<ChartAnalysisResponse> {
  if (typeof input.image !== 'string' || !DATA_URL.test(input.image)) {
    throw new ApiError('Attach a PNG, JPEG or WebP chart image.', 'CHART_IMAGE_INVALID');
  }
  if (dataUrlByteLength(input.image) > CHART_IMAGE_MAX_BYTES) {
    throw new ApiError('Chart images must be 5 MB or smaller.', 'CHART_IMAGE_INVALID');
  }
  const hint = input.hint?.trim().slice(0, 1000) || undefined;
  let currentStrategy: StrategyAST;
  try { currentStrategy = snapshotStrategy(input.currentStrategy); }
  catch (error) { throw new ApiError('The workspace strategy is invalid: ' + (error as Error).message, 'INVALID_STRATEGY'); }

  const body = { image: input.image, ...(hint ? { hint } : {}), currentStrategy };
  const controller = new AbortController();
  const relay = () => controller.abort(signal?.reason ?? new DOMException('Request cancelled', 'AbortError'));
  if (signal?.aborted) relay(); else signal?.addEventListener('abort', relay, { once: true });
  let rejectAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason ?? new DOMException('Request cancelled', 'AbortError'));
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  const timer = setTimeout(() => controller.abort(new ApiError('Chart analysis deadline exceeded. No result was confirmed.', 'CLIENT_DEADLINE')), CHART_ANALYSIS_DEADLINE_MS);
  let jobId: string | undefined, terminal = false;
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    const work = (async () => {
      // The upload is a short request: it only validates the image and enqueues.
      const response = await fetch('/api/v2/chart-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // A pre-job server answered inline. Keep the rolling-deploy path working.
      if (response.status === 200) return parseChartResult(await readJson(response));
      if (response.status !== 202) {
        await readJson(response);
        throw new ApiError('The chart analysis was not accepted. Try again.', 'INVALID_RESPONSE', response.status);
      }
      const receipt = await readJson(response);
      if (receipt.schemaVersion !== 2 || typeof receipt.jobId !== 'string' || !JOB_ID.test(receipt.jobId)) {
        throw new ApiError('The chart analysis was not accepted. Try again.', 'INVALID_RESPONSE', response.status);
      }
      jobId = receipt.jobId;
      let failures = 0;
      for (;;) {
        let job: Record<string, unknown>;
        try {
          const polled = await fetch('/api/v2/jobs/' + encodeURIComponent(jobId), { signal: controller.signal });
          job = await readJson(polled);
          failures = 0;
        } catch (error) {
          if (controller.signal.aborted) throw controller.signal.reason;
          // A transient proxy/network failure must not discard a 200 s read.
          const status = error instanceof ApiError ? error.status : 0;
          const retryable = !(error instanceof ApiError) || status === 429 || status >= 500;
          if (!retryable || ++failures >= POLL_MAX_CONSECUTIVE_FAILURES) throw error;
          await sleep(CHART_JOB_POLL_MS, controller.signal);
          continue;
        }
        if (job.id !== jobId || (job.kind !== undefined && job.kind !== 'chart')) {
          throw new ApiError('The response belongs to a different research job.', 'RESULT_IDENTITY_MISMATCH');
        }
        if (job.status === 'succeeded') { terminal = true; return parseChartResult(job.result); }
        if (job.status === 'failed' || job.status === 'cancelled') {
          terminal = true;
          const error = job.error as { message?: unknown; code?: unknown } | undefined;
          throw new ApiError(
            typeof error?.message === 'string' ? error.message : 'Chart analysis did not complete.',
            typeof error?.code === 'string' ? error.code : 'JOB_FAILED',
          );
        }
        if (job.status !== 'queued' && job.status !== 'running') {
          terminal = true;
          throw new ApiError('Invalid job status.', 'INVALID_RESPONSE');
        }
        await sleep(CHART_JOB_POLL_MS, controller.signal);
      }
    })();
    return await Promise.race([work, aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
    // An abandoned job must not keep burning provider budget. Best effort and
    // bounded, so a cancelled caller never waits on the cleanup request.
    if (jobId && !terminal) void cancelResearchJob(jobId);
  }
}
