import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateBars, type ProviderObservation } from './marketSeries';
const TTL=15*60*1000,MAX_BYTES=2_000_000,MAX_FILES=64;
const hash=(bars:unknown)=>createHash('sha256').update(JSON.stringify(bars)).digest('hex');
export async function readObservedCache(directory:string,id:number,symbol:string,now=Date.now()):Promise<ProviderObservation|undefined>{
 const file=path.join(directory,id+'.json');
 try{const stat=await fs.stat(file);if(!stat.isFile()||stat.size>MAX_BYTES)return;const value=JSON.parse(await fs.readFile(file,'utf8'));const age=now-Date.parse(value.fetchedAt);if(value.version!==1||!Number.isFinite(age)||age<0||age>TTL||value.symbol!==symbol||value.evidence?.source!=='YAHOO_PUBLIC_CHART'||value.evidence?.providerSymbol!==symbol||!Array.isArray(value.evidence?.warnings)||value.checksum!==hash(value.bars))return;const bars=validateBars(value.bars);return {bars,evidence:{...value.evidence,warnings:[...value.evidence.warnings,'Reused a validated public daily-data download; fetch time and observation cutoff are preserved']},fetchedAt:value.fetchedAt};}catch{return;}
}
export async function writeObservedCache(directory:string,id:number,symbol:string,observation:ProviderObservation):Promise<void>{
 const temporary=path.join(directory,id+'.'+randomUUID()+'.tmp');
 try{await fs.mkdir(directory,{recursive:true});const value={version:1,symbol,bars:observation.bars,evidence:observation.evidence,fetchedAt:observation.fetchedAt,checksum:hash(observation.bars)},text=JSON.stringify(value);if(Buffer.byteLength(text)>MAX_BYTES)return;await fs.writeFile(temporary,text,{flag:'wx'});await fs.rename(temporary,path.join(directory,id+'.json'));const names=(await fs.readdir(directory)).filter(n=>/^\d+\.json$/.test(n));if(names.length>MAX_FILES){const entries=await Promise.all(names.map(async name=>({name,time:(await fs.stat(path.join(directory,name)).catch(()=>undefined))?.mtimeMs??0})));entries.sort((a,b)=>a.time-b.time);await Promise.all(entries.slice(0,entries.length-MAX_FILES).map(e=>fs.unlink(path.join(directory,e.name)).catch(()=>{})));}}catch{/* Cache is best-effort; never replace a valid observation with demo data. */}finally{await fs.unlink(temporary).catch(()=>{});}
}
export async function waitForPublicRequest(milliseconds:number,signal:AbortSignal):Promise<void>{
 signal.throwIfAborted();if(milliseconds<=0)return;
 await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason??new Error('Request aborted'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},milliseconds);signal.addEventListener('abort',abort,{once:true});});
}
