import { z } from 'zod';
import { StrategySchema, validateStrategy } from '../strategy/schema';
import { StrategyProposalSchema, ProposalProviderSchema } from './ai-proposal';
const revision = z.union([z.number().finite(), z.string().min(1).max(100), z.null()]);
/** Universes the research chat can name and pass to the scanner. */
export const CHAT_UNIVERSES = ['NIFTY_50', 'BANK_NIFTY', 'NIFTY_IT', 'NIFTY_AUTO', 'NIFTY_PHARMA', 'NIFTY_METAL', 'NIFTY_FMCG', 'NSE'] as const;
export const ChatUniverseSchema = z.enum(CHAT_UNIVERSES);
export type ChatUniverse = z.infer<typeof ChatUniverseSchema>;

const strategy = z.unknown().transform((raw, ctx) => {
  const v=validateStrategy(raw);
  if(!v.success||!v.data){ctx.addIssue({code:'custom',message:v.errors?.join('; ')??'Invalid strategy'});return z.NEVER;}
  return v.data;
});
export const ResearchChatInputSchema = z.object({
  message:z.string().trim().min(1).max(4000), history:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(6000)}).strict()).max(40).optional(),
  currentStrategy:strategy.optional(), originatingRevision:revision.optional(), allowLocalFallback:z.boolean().optional(),
  screenContext:z.object({strategy,universe:ChatUniverseSchema,asOf:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).strict().optional(),
}).strict();
const base={schemaVersion:z.literal(1),originatingRevision:revision,message:z.string().max(12000),method:z.enum(['external_ai','local_heuristic','rule_parser','unavailable']),provider:ProposalProviderSchema,warnings:z.array(z.string().max(2000)).max(40)};
/** Small vision models often write "14" or "14, 14" where an array belongs. */
const numberList=z.preprocess(value=>{
  if(typeof value==='string')return value.split(/[,\s]+/).map(Number).filter(Number.isFinite);
  if(typeof value==='number'&&Number.isFinite(value))return[value];
  return value;
},z.array(z.number().finite()).max(12));
const numberOrNull=(value:unknown):unknown=>{
  if(value===null||value===undefined)return value;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value==='string'){
    const parsed=Number(value.replace(/[^0-9.+-]/g,''));
    return Number.isFinite(parsed)?parsed:null;
  }
  return null;
};
const optionalNumber=z.preprocess(numberOrNull,z.number().finite().nullable().optional());
const optionalBars=z.preprocess(numberOrNull,z.number().int().min(1).max(30).nullable().optional().catch(null));
const lower=(value:unknown)=>typeof value==='string'?value.trim().toLowerCase():value;
const chartPanel=z.preprocess(lower,z.enum(['price','rsi','other']).catch('other'));
const chartDirection=z.preprocess(lower,z.enum(['up','down','flat','unknown']).catch('unknown'));
const chartRelation=z.preprocess(lower,z.enum(['crossed_above','crossed_below','touching','not_reached','unknown']).catch('unknown'));
const chartTrend=z.preprocess(lower,z.enum(['uptrend','downtrend','sideways','unknown']).catch('unknown'));
const chartRange=z.preprocess(lower,z.enum(['low','high','middle','unknown']).catch('unknown'));
const chartCandle=z.preprocess(lower,z.enum(['bullish','bearish','doji','unknown']).catch('unknown'));
const eventList=z.preprocess(value=>Array.isArray(value)?value.map(item=>{
  if(typeof item==='string')return item;
  if(item&&typeof item==='object')return String((item as Record<string,unknown>).label??(item as Record<string,unknown>).name??(item as Record<string,unknown>).type??'').trim();
  return '';
}).filter(Boolean):value,z.array(z.string().max(200)).max(10));

/** Header facts read from the chart frame, kept separate from inferred conditions. */
export const ChartHeaderSchema=z.object({
  symbol:z.string().min(1).max(80).nullable().optional(),
  exchange:z.string().max(20).nullable().optional(),
  timeframe:z.string().max(40).nullable().optional(),
  captureDate:z.string().max(60).nullable().optional(),
  lastClose:optionalNumber,
  lastChangePct:optionalNumber,
}).strict();

/**
 * Normalized, model-independent reading of a chart screenshot.
 *
 * The original fields stay first-class and required where they were required.
 * Guide-driven fields are optional so readings cached or returned by an older
 * deployment remain parseable; new readings fill them step by step.
 */
export const ChartObservationsSchema=z.object({
  header:ChartHeaderSchema.optional(),
  timeframe:z.string().max(40).nullable(),
  indicators:z.array(z.object({
    name:z.string().min(1).max(40), params:numberList, legendValues:numberList,
    /** Aligned with legendValues: current reading, moving average, or a band. */
    legendRoles:z.array(z.preprocess(lower,z.enum(['current','ma','band']).catch('ma'))).max(12).optional(),
  }).strict()).max(12),
  drawnLines:z.array(z.object({
    panel:chartPanel, direction:chartDirection, description:z.string().max(200),
    start:z.object({when:z.string().max(60).nullable(),value:optionalNumber}).strict().optional(),
    end:z.object({when:z.string().max(60).nullable(),value:optionalNumber}).strict().optional(),
    lastBarRelation:chartRelation.optional(),
  }).strict()).max(8),
  recentBars:z.object({
    note:z.string().max(300).nullable().optional(),
    rsiBelow30BarsAgo:optionalBars,
  }).strict().optional(),
  rangePosition:z.object({
    approxPctAboveLow:z.preprocess(numberOrNull,z.number().finite().min(0).max(1000).nullable().optional().catch(null)),
  }).strict().optional(),
  priceTrend:chartTrend,
  nearRange:chartRange,
  lastCandle:chartCandle,
  events:eventList,
}).strict();
/** The charted stock's own latest bars, checked deterministically before answering. */
export const ChartSelfCheckSchema=z.object({
  status:z.enum(['checked','unknown_symbol','unavailable']),
  symbol:z.string().max(30).nullable().optional(),
  matched:z.number().int().min(0).nullable().optional(),
  total:z.number().int().min(0).nullable().optional(),
  line:z.string().min(1).max(300),
  repaired:z.boolean().optional(),
}).strict();
export const ResearchScreenPlanSchema=z.object({...base,kind:z.literal('screen'),universe:ChatUniverseSchema,strategy:StrategySchema,assumptions:z.array(z.string()),missingBacktestRules:z.array(z.enum(['exits','positionSizing','executionAndCosts'])).min(1),backtestReady:z.literal(false),asOf:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Chart-image extensions. All four are present together on chart-derived screens. */
  observations:ChartObservationsSchema.optional(),confidence:z.number().min(0).max(1).optional(),summary:z.string().max(2000).optional(),source:z.literal('chart_image').optional(),selfCheck:ChartSelfCheckSchema.optional(),
}).strict();
export const ResearchChatResponseSchema=z.discriminatedUnion('kind',[
  z.object({...base,kind:z.literal('conversation')}).strict(),
  z.object({...base,kind:z.literal('proposal'),proposal:StrategyProposalSchema}).strict(),ResearchScreenPlanSchema,
]);
export type ResearchChatInput=z.input<typeof ResearchChatInputSchema>;
export type ResearchChatResponse=z.infer<typeof ResearchChatResponseSchema>;
export type ResearchScreenPlan=z.infer<typeof ResearchScreenPlanSchema>;
export type ChartObservations=z.infer<typeof ChartObservationsSchema>;
export type ChartSelfCheck=z.infer<typeof ChartSelfCheckSchema>;
export function parseResearchChatResponse(raw:unknown):ResearchChatResponse{return ResearchChatResponseSchema.parse(raw);}
