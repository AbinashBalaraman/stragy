import { z } from 'zod';
import { StrategySchema } from '../strategy/schema';

/** Mirrors StrategyProposalV2 in server/ai/types. No metadata or strategy defaults. */
export const ProposalProviderSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1).nullable(),
  aiGenerated: z.boolean(),
}).strict();

export const StrategyProposalSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().min(1),
  status: z.literal('draft'),
  createdAt: z.string().datetime(),
  originatingRevision: z.union([z.number().finite(), z.string().min(1).max(100), z.null()]),
  method: z.enum(['external_ai', 'local_heuristic', 'parameter_sweep']),
  provider: ProposalProviderSchema,
  candidate: StrategySchema,
  rationale: z.string(),
  warnings: z.array(z.string()),
  changes: z.array(z.string()),
  applied: z.literal(false),
  executes: z.literal(false),
}).strict();

export type StrategyProposal = z.infer<typeof StrategyProposalSchema>;
export function parseStrategyProposal(raw: unknown): StrategyProposal {
  return StrategyProposalSchema.parse(raw);
}

/** Revision equality is deliberately type-sensitive; snapshots guard same-revision edits. */
export function assertProposalCurrent(
  proposal: Pick<StrategyProposal, 'originatingRevision'>,
  revision: number | string | null,
  sourceSnapshot: string,
  currentSnapshot: string,
): void {
  if (proposal.originatingRevision !== revision || sourceSnapshot !== currentSnapshot) {
    throw new Error('This draft is stale. Generate a new proposal for the current workspace.');
  }
}
