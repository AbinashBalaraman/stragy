import { z } from 'zod';
import type { StrategyAST } from '../shared/strategy/types';
import { ChartObservationsSchema, ChartSelfCheckSchema, parseResearchChatResponse, type ResearchChatResponse } from '../shared/contracts/research-chat';
import { snapshotStrategy } from './workspace';
import { ApiError, readJson } from './api';

export const CHART_IMAGE_MAX_BYTES = 5_000_000;
export const CHART_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const CHART_IMAGE_ACCEPT = CHART_IMAGE_MIME_TYPES.join(',');
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
  // Two vision passes plus one deterministic self-check repair can exceed 90 s
  // on a free model; the server still bounds each provider call independently.
  const timer = setTimeout(() => controller.abort(new ApiError('Chart analysis deadline exceeded. No result was confirmed.', 'CLIENT_DEADLINE')), 180000);
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    const work = (async () => {
      const response = await fetch('/api/v2/chart-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      try { return parseChartAnalysisResponse(await readJson(response)); }
      catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError('The chart analysis response was invalid. No result was confirmed.', 'INVALID_RESPONSE');
      }
    })();
    return await Promise.race([work, aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
  }
}
