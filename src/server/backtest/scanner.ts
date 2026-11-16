import { StrategyAST, SymbolMeta } from '../../shared/strategy/types';
import { filterSymbolsByUniverse, MarketUniverseType, UNIVERSE_OPTIONS } from '../data/symbols';
import { getMarketSeries,loadMarketSeries,MarketSeries,LoadMarketOptions,MarketDataError } from '../data/marketSeries';
import { resolveObservedUniverse, forEachMarketSymbol, type ObservedUniverse } from '../data/observedUniverse';
import { getDataMode } from '../data/marketSeries';
import { calculateAllIndicators } from './indicators';
import { evaluateCondition, evaluateConditionMatch } from './rules';
import { legacyOutputNames } from '../../shared/strategy/registry';

/** Near matches are ranked by score and capped independently of match pagination. */
export const NEAR_MATCH_LIMIT = 10;

export interface ScanRuleDiagnostic {rule:string;ruleIndex?:number;actualLeft:number;actualRight:number;matchedIndex?:number;matchedDate?:string;currentActualLeft?:number;currentActualRight?:number;}
export interface ScanMatchResult{symbolId:number;ticker:string;name:string;sector:string;lastDate:string;lastClose:number;changePercent:number;score?:number;matchedRules:ScanRuleDiagnostic[];unmatchedRules?:ScanRuleDiagnostic[];indicatorValues:Record<string,number>;provenance:MarketSeries['provenance'];}
export interface UniverseScanResponse{mode:'demo'|'real';universe:string;scanned:number;matched:number;scannedAt:string;dataSource:string;matches:ScanMatchResult[];nearMatches:ScanMatchResult[];requested:number;attempted:number;succeeded:number;unavailable:number;failed:number;asOf?:string;offset:number;limit:number;errors:{symbolId:number;code:string;message:string;ticker?:string}[];sourceCoverage:Record<string,number>;warnings:string[];observationDates?:{earliest:string;latest:string;staleSymbols:number};membership?:Omit<ObservedUniverse,'symbols'>;status?:'complete'|'partial'|'unavailable';}
export interface ScanOptions extends LoadMarketOptions{offset?:number;limit?:number;}

function universe(name:string):SymbolMeta[]{
  const aliases:Record<string,string>={NIFTY50:'NIFTY_50',BANKNIFTY:'BANK_NIFTY',INDICES:'POPULAR_INDICES'};
  const normalized=aliases[name.toUpperCase()]||name.toUpperCase();
  if(!UNIVERSE_OPTIONS.some(u=>u.id===normalized))throw new MarketDataError('INVALID_UNIVERSE','Unknown universe');
  return filterSymbolsByUniverse(normalized as MarketUniverseType).map(s=>({...s}));
}

function initialize(name:string,symbols:SymbolMeta[],o:ScanOptions):UniverseScanResponse{
  const limit=o.limit??35,offset=o.offset??0;
  if(!Number.isInteger(limit)||limit<1||limit>500||!Number.isInteger(offset)||offset<0)throw new Error('Invalid pagination');
  return{mode:o.mode??getDataMode(),universe:name,scanned:0,matched:0,scannedAt:new Date().toISOString(),dataSource:'PROVENANCE_PER_SYMBOL',matches:[],nearMatches:[],requested:symbols.length,attempted:0,succeeded:0,unavailable:0,failed:0,asOf:o.asOf,offset,limit,errors:[],sourceCoverage:{},warnings:['Current membership survivorship bias','Partial coverage; no live streaming','Licensing and provider entitlement unverified']};
}

function diagnostics(strategy:StrategyAST,index:number,series:Record<string,(number|null)[]>,bars:MarketSeries['bars'],onlyMatched:boolean[]) {
  return strategy.rules.entry.flatMap((rule,i)=>{
    if(onlyMatched[i]===false)return[];
    const diagnostic=evaluateConditionMatch(rule,index,series,bars);
    const at=diagnostic.mostRecentMatchingIndex??index;
    return [{rule:rule.leftIndicator+' '+rule.operator+' '+(rule.rightIndicator??rule.rightValue),ruleIndex:i,actualLeft:rule.leftValue??series[rule.leftIndicator]?.[at]??NaN,actualRight:rule.rightIndicator?series[rule.rightIndicator]?.[at]??NaN:rule.rightValue??NaN,matchedIndex:diagnostic.mostRecentMatchingIndex,matchedDate:diagnostic.mostRecentMatchingDate,currentActualLeft:rule.leftValue??series[rule.leftIndicator]?.[index]??NaN,currentActualRight:rule.rightIndicator?series[rule.rightIndicator]?.[index]??NaN:rule.rightValue??NaN}];
  });
}

function evaluate(sym:SymbolMeta,d:MarketSeries,strategy:StrategyAST,r:UniverseScanResponse):void{
  const bars=d.bars;
  if(bars.length<30)throw new MarketDataError('INSUFFICIENT_HISTORY','At least 30 bars required');
  const series=calculateAllIndicators(bars,strategy.indicators);
  const i=bars.length-1;const last=bars[i];
  r.succeeded++;
  const dates=r.observationDates??{earliest:last.date,latest:last.date,staleSymbols:0};
  dates.earliest=dates.earliest<last.date?dates.earliest:last.date;
  dates.latest=dates.latest>last.date?dates.latest:last.date;
  if(d.provenance.freshness.startsWith('stale'))dates.staleSymbols++;
  r.observationDates=dates;
  r.sourceCoverage[d.provenance.source]=(r.sourceCoverage[d.provenance.source]||0)+1;

  // score is the fraction of entry rules satisfied at the latest completed bar.
  const ruleMatches=strategy.rules.entry.map(rule=>evaluateCondition(rule,i,series));
  const total=ruleMatches.length;
  const matchedCount=ruleMatches.filter(Boolean).length;
  const score=total>0?matchedCount/total:0;
  const allMatched=total>0&&matchedCount===total;
  const near=!allMatched&&total>1&&matchedCount>=total-1;
  if(!allMatched&&!near)return;

  const indicatorValues:Record<string,number>={};
  const entryReferences=new Set<string>();
  for(const rule of strategy.rules.entry){entryReferences.add(rule.leftIndicator);if(rule.rightIndicator)entryReferences.add(rule.rightIndicator);}
  for(const ind of strategy.indicators){
    // Only indicators actually referenced by this screen's entry rules are evidence.
    const outputs=legacyOutputNames(ind);
    if(!Object.keys(outputs).some(name=>entryReferences.has(name)))continue;
    const v=series[ind.id]?.[i];if(typeof v==='number'&&Number.isFinite(v))indicatorValues[ind.id]=v;
  }
  const result:ScanMatchResult={symbolId:sym.id,ticker:sym.ticker,name:sym.name,sector:sym.sector,lastDate:last.date,lastClose:last.close,changePercent:(last.close/bars[i-1].close-1)*100,score,matchedRules:diagnostics(strategy,i,series,bars,ruleMatches),unmatchedRules:diagnostics(strategy,i,series,bars,ruleMatches.map(matched=>!matched)),indicatorValues,provenance:d.provenance};
  if(allMatched)r.matches.push(result);else r.nearMatches.push(result);
  if(allMatched)r.matched++;
}

function error(sym:SymbolMeta,e:unknown,r:UniverseScanResponse):void{
  const code=e instanceof MarketDataError?e.code:'EVALUATION_FAILED';
  if(['PROVIDER_UNAVAILABLE','OUT_OF_COVERAGE','INSUFFICIENT_HISTORY','PROVIDER_BUSY','IDENTITY_UNVERIFIED','PROVIDER_HTTP'].includes(code))r.unavailable++;
  else r.failed++;
  r.errors.push({symbolId:sym.id,ticker:sym.ticker,code,message:e instanceof Error?e.message:'Scan failed'});
}

function validateStrategy(s:StrategyAST):void{if(!s||!Array.isArray(s.indicators)||!Array.isArray(s.rules?.entry))throw new Error('Invalid strategy');}

function rankNearMatches(r:UniverseScanResponse):void{
  r.nearMatches.sort((a,b)=>(b.score??0)-(a.score??0)||a.symbolId-b.symbolId);
  r.nearMatches=r.nearMatches.slice(0,NEAR_MATCH_LIMIT);
}

export function scanUniverse(strategy:StrategyAST,name='nifty50',limit=35,o:ScanOptions={}):UniverseScanResponse{
  validateStrategy(strategy);
  const symbols=universe(name);
  const r=initialize(name,symbols,{...o,limit});
  for(const sym of symbols){r.attempted++;try{evaluate(sym,getMarketSeries(sym.id,o),strategy,r);}catch(e){error(sym,e,r);}}
  r.scanned=r.attempted;
  r.matches=r.matches.slice(r.offset,r.offset+r.limit);
  rankNearMatches(r);
  return r;
}

export async function scanUniverseAsync(strategy:StrategyAST,name='nifty50',o:ScanOptions={}):Promise<UniverseScanResponse>{
  validateStrategy(strategy);
  const real=(o.mode??getDataMode())==='real';
  const membership=real?await resolveObservedUniverse(name):undefined;
  const symbols=membership?.symbols??universe(name);
  if(symbols.length>2500)throw new MarketDataError('SCAN_BUDGET_EXCEEDED','Universe exceeds scan budget');
  const r=initialize(name,symbols,o);
  if(membership){
    const {symbols:_,...metadata}=membership;
    r.membership=metadata;r.requested=membership.requested;
    r.warnings=[...membership.warnings,'Public delayed/end-of-day observations, not live streaming'];
    for(const missing of membership.unmapped){r.unavailable++;r.errors.push({symbolId:0,ticker:missing.ticker,code:'IDENTITY_UNVERIFIED',message:missing.reason});}
  }
  await forEachMarketSymbol(symbols,async sym=>{r.attempted++;try{evaluate(sym,await loadMarketSeries(sym.id,o),strategy,r);}catch(e){error(sym,e,r);}});
  if(r.observationDates&&r.observationDates.earliest!==r.observationDates.latest)r.warnings.push('Latest observed dates vary across symbols: '+r.observationDates.earliest+' through '+r.observationDates.latest);
  r.scanned=r.attempted;
  r.status=r.succeeded===0?'unavailable':r.succeeded===r.requested?'complete':'partial';
  if(!r.succeeded)r.warnings.push('No usable datasets; zero matches does not establish that no symbols meet the rules');
  r.matches.sort((a,b)=>a.symbolId-b.symbolId);
  r.matches=r.matches.slice(r.offset,r.offset+r.limit);
  rankNearMatches(r);
  return r;
}
