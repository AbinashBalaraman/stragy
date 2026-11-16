import {
  ChatDraftSchema, FeaturePrefillSchema, type ChatDraft, type FeaturePrefill,
} from '../shared/contracts/featureRegistry';

/**
 * Frontend hand-off for a filled feature setup.
 *
 * The sender validates the payload and dispatches `stragy:feature-prefill`.
 * The Strategy tester / Market scanner (frontend agent) listens for that event,
 * switches view and uses `FeaturePrefill` as the already-validated form state.
 * Chat's "Describe in chat" action builds a `ChatDraft` and can reuse the same
 * event or navigate normally.
 */
export const FEATURE_PREFILL_EVENT = 'stragy:feature-prefill';

export function parseFeaturePrefill(raw: unknown): FeaturePrefill | null {
  const parsed = FeaturePrefillSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function publishFeaturePrefill(raw: unknown, target: Pick<Window, 'dispatchEvent'> | undefined = typeof window === 'undefined' ? undefined : window): FeaturePrefill | null {
  const prefill = parseFeaturePrefill(raw);
  if (!prefill || !target) return null;
  target.dispatchEvent(new CustomEvent(FEATURE_PREFILL_EVENT, { detail: prefill }));
  return prefill;
}

/** "Describe in chat" uses the same validated hand-off instead of ad-hoc text. */
export function parseChatDraft(raw: unknown): ChatDraft | null {
  const parsed = ChatDraftSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
