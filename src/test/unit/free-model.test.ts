import { describe, it, expect, vi } from 'vitest';
import { isZeroPricedModel, VERIFIED_FREE_MODEL, TOKENROUTER_PRICING_URL } from '../../server/ai/freeModel';
import { callProvider, resolveAIConfig } from '../../server/ai/provider';
const pricing=()=>({success:true,data:[{model_name:VERIFIED_FREE_MODEL,quota_type:0,model_ratio:0,model_price:0,completion_ratio:1,supported_endpoint_types:['openai']}],tiered_pricing:{},candidates_pricing:{},video_generation_pricing:{}});
const response=(body:unknown)=>({ok:true,status:200,headers:{get:()=>null},json:async()=>body});
describe('free-only provider boundary',()=>{
 it('accepts only the exactly verified zero-priced text model',()=>{expect(isZeroPricedModel(pricing(),VERIFIED_FREE_MODEL)).toBe(true);expect(isZeroPricedModel(pricing(),'MiniMax-M3')).toBe(false);const paid=pricing();paid.data[0].model_ratio=0.001;expect(isZeroPricedModel(paid,VERIFIED_FREE_MODEL)).toBe(false);expect(isZeroPricedModel({...pricing(),tiered_pricing:{[VERIFIED_FREE_MODEL]:{price:1}}},VERIFIED_FREE_MODEL)).toBe(false);expect(isZeroPricedModel({},VERIFIED_FREE_MODEL)).toBe(false);});
 it('checks public pricing immediately before one completion without sending the key to pricing',async()=>{
  const cfg=resolveAIConfig({AI_PROVIDER:'tokenrouter',TOKENROUTER_API_KEY:'offline-fixture-key',AI_MODEL:VERIFIED_FREE_MODEL,AI_COST_POLICY:'free-only'});
  const fetch=vi.fn().mockResolvedValueOnce(response(pricing())).mockResolvedValueOnce(response({choices:[{message:{content:'fixture answer'}}]}));
  const result=await callProvider(cfg,{system:'test',user:'test',json:false},{fetch,budget:{tryConsume:()=>true}});expect(result.ok).toBe(true);expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[0][0]).toBe(TOKENROUTER_PRICING_URL);expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');expect(fetch.mock.calls[1][0]).toBe('https://api.tokenrouter.com/v1/chat/completions');expect(JSON.parse(fetch.mock.calls[1][1].body).model).toBe(VERIFIED_FREE_MODEL);expect(JSON.stringify(cfg)).not.toContain('offline-fixture-key');
 });
 it('blocks changed or unreadable prices before any completion, with no paid fallback',async()=>{
  const cfg=resolveAIConfig({AI_PROVIDER:'tokenrouter',TOKENROUTER_API_KEY:'offline-fixture-key',AI_MODEL:VERIFIED_FREE_MODEL,AI_COST_POLICY:'free-only'});
  const fetch=vi.fn().mockResolvedValue(response({success:false}));const result=await callProvider(cfg,{system:'test',user:'test',json:false},{fetch,budget:{tryConsume:()=>true}});expect(result).toMatchObject({ok:false,code:'cost_not_approved'});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('does not redirect credentials or approve another configured provider in free-only mode',async()=>{
  expect(resolveAIConfig({AI_PROVIDER:'tokenrouter',TOKENROUTER_API_KEY:'offline-fixture-key',AI_MODEL:VERIFIED_FREE_MODEL,TOKENROUTER_BASE_URL:'https://untrusted.test/v1'}).ready).toBe(false);
  const cfg=resolveAIConfig({AI_PROVIDER:'gemini',GEMINI_API_KEY:'offline-fixture-key',AI_COST_POLICY:'free-only'});const fetch=vi.fn();expect(await callProvider(cfg,{system:'test',user:'test',json:false},{fetch,budget:{tryConsume:()=>true}})).toMatchObject({ok:false,code:'cost_not_approved'});expect(fetch).not.toHaveBeenCalled();
 });
});
