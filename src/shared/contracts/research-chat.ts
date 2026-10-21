import { z } from 'zod';
import { StrategySchema, validateStrategy } from '../strategy/schema';
import { StrategyProposalSchema, ProposalProviderSchema } from './ai-proposal';
const revision = z.union([z.number().finite(), z.string().min(1).max(100), z.null()]);
const strategy = z.unknown().transform((raw, ctx) => {
  const v=validateStrategy(raw);
  if(!v.success||!v.data){ctx.addIssue({code:'custom',message:v.errors?.join('; ')??'Invalid strategy'});return z.NEVER;}
  return v.data;
});
export const ResearchChatInputSchema = z.object({
  message:z.string().trim().min(1).max(4000), history:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(6000)}).strict()).max(40).optional(),
  currentStrategy:strategy.optional(), originatingRevision:revision.optional(), allowLocalFallback:z.boolean().optional(),
  screenContext:z.object({strategy,universe:z.literal('NIFTY_50'),asOf:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).strict().optional(),
}).strict();
const base={schemaVersion:z.literal(1),originatingRevision:revision,message:z.string().max(12000),method:z.enum(['external_ai','local_heuristic','rule_parser','unavailable']),provider:ProposalProviderSchema,warnings:z.array(z.string().max(2000)).max(40)};
export const ResearchScreenPlanSchema=z.object({...base,kind:z.literal('screen'),universe:z.literal('NIFTY_50'),strategy:StrategySchema,assumptions:z.array(z.string()),missingBacktestRules:z.array(z.enum(['exits','positionSizing','executionAndCosts'])).min(1),backtestReady:z.literal(false),asOf:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).strict();
export const ResearchChatResponseSchema=z.discriminatedUnion('kind',[
  z.object({...base,kind:z.literal('conversation')}).strict(),
  z.object({...base,kind:z.literal('proposal'),proposal:StrategyProposalSchema}).strict(),ResearchScreenPlanSchema,
]);
export type ResearchChatInput=z.input<typeof ResearchChatInputSchema>;
export type ResearchChatResponse=z.infer<typeof ResearchChatResponseSchema>;
export type ResearchScreenPlan=z.infer<typeof ResearchScreenPlanSchema>;
export function parseResearchChatResponse(raw:unknown):ResearchChatResponse{return ResearchChatResponseSchema.parse(raw);}
