import { ApiError, readJson } from './api';
import { ResearchChatInputSchema, parseResearchChatResponse, type ResearchChatInput, type ResearchChatResponse } from '../shared/contracts/research-chat';
export async function requestResearchChat(input: ResearchChatInput, signal?:AbortSignal):Promise<ResearchChatResponse>{
  const body=ResearchChatInputSchema.parse(input), controller=new AbortController();
  const relay=()=>controller.abort(signal?.reason??new DOMException('Request cancelled','AbortError'));
  if(signal?.aborted)relay();else signal?.addEventListener('abort',relay,{once:true});
  let rejectAbort:(()=>void)|undefined;
  const aborted=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(controller.signal.reason??new DOMException('Request cancelled','AbortError'));controller.signal.addEventListener('abort',rejectAbort,{once:true});});
  const timer=setTimeout(()=>controller.abort(new ApiError('Chat deadline exceeded. No result was confirmed.','CLIENT_DEADLINE')),65000);
  try{
    if(controller.signal.aborted)throw controller.signal.reason;
    const work=(async()=>parseResearchChatResponse(await readJson(await fetch('/api/v2/research-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal}))))();
    return await Promise.race([work,aborted]);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',relay);if(rejectAbort)controller.signal.removeEventListener('abort',rejectAbort);}
}
