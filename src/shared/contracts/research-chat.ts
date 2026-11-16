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
/** Normalized, model-independent reading of a chart screenshot. */
export const ChartObservationsSchema=z.object({
  timeframe:z.string().max(40).nullable(),
  indicators:z.array(z.object({
    name:z.string().min(1).max(40), params:z.array(z.number().finite()).max(12), legendValues:z.array(z.number().finite()).max(12),
  }).strict()).max(12),
  drawnLines:z.array(z.object({
    panel:z.enum(['price','rsi','other']), direction:z.enum(['up','down','flat','unknown']), description:z.string().max(200),
  }).strict()).max(8),
  priceTrend:z.enum(['uptrend','downtrend','sideways','unknown']),
  nearRange:z.enum(['low','high','middle','unknown']),
  lastCandle:z.enum(['bullish','bearish','doji','unknown']),
  events:z.array(z.string().max(200)).max(10),
}).strict();
export const ResearchScreenPlanSchema=z.object({...base,kind:z.literal('screen'),universe:z.literal('NIFTY_50'),strategy:StrategySchema,assumptions:z.array(z.string()),missingBacktestRules:z.array(z.enum(['exits','positionSizing','executionAndCosts'])).min(1),backtestReady:z.literal(false),asOf:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Chart-image extensions. All four are present together on chart-derived screens. */
  observations:ChartObservationsSchema.optional(),confidence:z.number().min(0).max(1).optional(),summary:z.string().max(2000).optional(),source:z.literal('chart_image').optional(),
}).strict();
export const ResearchChatResponseSchema=z.discriminatedUnion('kind',[
  z.object({...base,kind:z.literal('conversation')}).strict(),
  z.object({...base,kind:z.literal('proposal'),proposal:StrategyProposalSchema}).strict(),ResearchScreenPlanSchema,
]);
export type ResearchChatInput=z.input<typeof ResearchChatInputSchema>;
export type ResearchChatResponse=z.infer<typeof ResearchChatResponseSchema>;
export type ResearchScreenPlan=z.infer<typeof ResearchScreenPlanSchema>;
export type ChartObservations=z.infer<typeof ChartObservationsSchema>;
export function parseResearchChatResponse(raw:unknown):ResearchChatResponse{return ResearchChatResponseSchema.parse(raw);}
