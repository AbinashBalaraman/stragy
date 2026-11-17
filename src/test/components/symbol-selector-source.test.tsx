// @vitest-environment jsdom
import React from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {SymbolSearchSelector} from '../../components/layout/SymbolSearchSelector';
import type {SymbolMeta} from '../../shared/strategy/types';
const symbols:SymbolMeta[]=Array.from({length:58},(_,i)=>({id:i+1,ticker:i===0?'RELIANCE':'FIXTURE'+i,name:'Offline fixture '+i,exchange:'NSE',sector:'Energy',currentPrice:999.99,changePercent:-0.53}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function open(showReferencePrices?:boolean){render(<SymbolSearchSelector symbols={symbols} currentSymbolId={1} onSymbolChange={vi.fn()} showReferencePrices={showReferencePrices}/>);fireEvent.click(document.querySelector('#btn-symbol-pill-trigger') as HTMLElement);}
it.each([undefined,false])('does not display illustrative prices or popular percentage changes unless explicitly enabled (%s)',flag=>{open(flag);expect(document.body.textContent).not.toContain('-0.53%');expect(document.body.textContent).not.toContain('999.99');expect(screen.getByRole('button',{name:'RELIANCE'})).toBeTruthy();});
it('allows explicitly labelled demo reference values',()=>{open(true);expect(screen.getByRole('button',{name:/^RELIANCE\s*-0\.53%$/})).toBeTruthy();expect(document.body.textContent).toContain('999.99');});
it('reports the loaded catalog size in the All chip rather than active listings or matches',()=>{open(false);expect(screen.getByRole('button',{name:'All (58)'})).toBeTruthy();expect(document.body.textContent).not.toContain('2,088 Assets Active');expect(document.body.textContent).not.toContain('instruments available');fireEvent.change(screen.getByPlaceholderText('Search instruments (e.g. RELIANCE, TCS)...'),{target:{value:'RELIANCE'}});expect(screen.getByRole('button',{name:'All (58)'})).toBeTruthy();});
