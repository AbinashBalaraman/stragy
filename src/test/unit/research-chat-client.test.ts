import { afterEach,beforeEach,it,expect,vi } from 'vitest';
import { requestResearchChat } from '../../client/researchChat';
let fetchMock:ReturnType<typeof vi.fn>;
beforeEach(()=>{vi.useFakeTimers();fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('bounds a stalled request even when fetch ignores cancellation',async()=>{fetchMock.mockReturnValue(new Promise(()=>{}));const result=requestResearchChat({message:'hello'}).catch(e=>e);await vi.advanceTimersByTimeAsync(65001);expect(await result).toMatchObject({code:'CLIENT_DEADLINE'});expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);});
it('bounds a stalled response body',async()=>{fetchMock.mockResolvedValue({ok:true,status:200,json:()=>new Promise(()=>{})});const result=requestResearchChat({message:'hello'}).catch(e=>e);await vi.advanceTimersByTimeAsync(65001);expect(await result).toMatchObject({code:'CLIENT_DEADLINE'});});
it('does not submit when the caller already cancelled',async()=>{const c=new AbortController();c.abort();await expect(requestResearchChat({message:'hello'},c.signal)).rejects.toMatchObject({name:'AbortError'});expect(fetchMock).not.toHaveBeenCalled();});
it('validates the returned response and reports its real method',async()=>{fetchMock.mockResolvedValue({ok:true,status:200,json:async()=>({schemaVersion:1,kind:'conversation',originatingRevision:0,message:'Unavailable',method:'unavailable',provider:{name:'none',model:null,aiGenerated:false},warnings:[]})});expect((await requestResearchChat({message:'hello'})).method).toBe('unavailable');});
