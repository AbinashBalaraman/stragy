// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';
import { researchChat } from '../../server/ai/researchChat';
import { requestResearchChat } from '../../client/researchChat';
import { requestScan } from '../../client/api';
vi.mock('../../client/researchChat',()=>({requestResearchChat:vi.fn()}));
vi.mock('../../client/api',()=>({requestScan:vi.fn()}));
let dom:JSDOM;
const zero=()=>({mode:'real' as const,universe:'NIFTY_50',scanned:50,matched:0,scannedAt:'2026-10-15T12:00:00Z',dataSource:'PROVENANCE_PER_SYMBOL',matches:[],requested:50,attempted:50,succeeded:50,unavailable:0,failed:0,offset:0,limit:100,errors:[],sourceCoverage:{YAHOO_PUBLIC_CHART:50},warnings:[]});
function send(){fireEvent.change(screen.getByLabelText('Research request'),{target:{value:'Find Nifty 50 RSI oversold now after recently overbought'}});fireEvent.click(screen.getByRole('button',{name:'Send request'}));}
beforeEach(()=>{dom=new JSDOM('',{url:'https://research.test'});vi.stubGlobal('localStorage',dom.window.localStorage);vi.mocked(requestResearchChat).mockImplementation(input=>researchChat(input,{env:{AI_PROVIDER:'none'}}));});
afterEach(()=>{cleanup();dom.window.close();vi.clearAllMocks();vi.unstubAllGlobals();});
it('runs an explicit read-only screen and does not apply or backtest without a separate action',async()=>{vi.mocked(requestScan).mockResolvedValue(zero());const apply=vi.fn(),run=vi.fn();render(<AiCopilotDock strategy={validStrategy()} onApplyVariation={apply} onResearchBacktest={run}/>);send();await screen.findByText('0 matches in successfully evaluated stocks.');expect(requestScan).toHaveBeenCalledTimes(1);expect(apply).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();expect(screen.getByText(/Backtest incomplete/)).toBeTruthy();expect(screen.queryByRole('button',{name:/Backtest workspace symbol/})).toBeNull();fireEvent.click(screen.getByRole('button',{name:/Use current workspace exits/}));fireEvent.click(screen.getByRole('button',{name:/Backtest workspace symbol/}));await waitFor(()=>expect(run).toHaveBeenCalledTimes(1));expect(run.mock.calls[0][0].rules.entry[1].lookback.bars).toBe(20);});
it('does not present failed or all-unavailable data as zero matches',async()=>{vi.mocked(requestScan).mockRejectedValue(new Error('HTTP 504'));const view=render(<AiCopilotDock strategy={validStrategy()}/>);send();expect((await screen.findByRole('alert')).textContent).toContain('No zero-match conclusion');expect(screen.queryByText('0 matches in successfully evaluated stocks.')).toBeNull();view.unmount();vi.mocked(requestScan).mockResolvedValue({...zero(),succeeded:0,unavailable:50,sourceCoverage:{}});render(<AiCopilotDock strategy={validStrategy()}/>);send();await screen.findByText('No successful data coverage. Matches are unknown, not zero.');expect(screen.queryByText('0 matches in successfully evaluated stocks.')).toBeNull();});
it('rejects even empty demo scans instead of presenting them as current market answers',async()=>{vi.mocked(requestScan).mockResolvedValue({...zero(),mode:'demo'});render(<AiCopilotDock strategy={validStrategy()}/>);send();expect((await screen.findByRole('alert')).textContent).toContain('Demo results were not presented');expect(screen.queryByLabelText('Screen results')).toBeNull();});
it('aborts pending scan ownership when conversation is cleared',async()=>{let signal:AbortSignal|undefined;let finish!:(v:ReturnType<typeof zero>)=>void;vi.mocked(requestScan).mockImplementation((_input,s)=>{signal=s;return new Promise(resolve=>{finish=resolve;});});render(<AiCopilotDock strategy={validStrategy()}/>);send();await screen.findByText(/Scanning actual current daily data/);fireEvent.click(screen.getByRole('button',{name:'Clear conversation'}));expect(signal?.aborted).toBe(true);finish(zero());await waitFor(()=>expect(screen.queryByLabelText('Screen results')).toBeNull());});
