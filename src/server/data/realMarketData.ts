import { OHLCVBar, SymbolMeta } from '../../shared/strategy/types';
import { NSE_SYMBOLS, getSymbolById, updateSymbolPriceAndChange } from './symbols';
import { getMarketSeries, getDataMode, validateDate, MarketDataError } from './marketSeries';
export { loadMarketSeries, getMarketSeries, getDataMode, MarketDataError, validateBars, validateDate } from './marketSeries';

export const YAHOO_NSE_TICKER_MAP: Record<string, string> = {
  // Benchmark & Sectoral Indices
  '^NSEI': '^NSEI',
  '^NSEBANK': '^NSEBANK',
  '^BSESN': '^BSESN',
  '^CNXIT': '^CNXIT',
  '^CNXAUTO': '^CNXAUTO',
  '^CNXPHARMA': '^CNXPHARMA',
  '^CNXMETAL': '^CNXMETAL',
  '^CNXFMCG': '^CNXFMCG',

  // NSE Equities
  'RELIANCE': 'RELIANCE.NS',
  'HDFCBANK': 'HDFCBANK.NS',
  'TCS': 'TCS.NS',
  'INFY': 'INFY.NS',
  'ICICIBANK': 'ICICIBANK.NS',
  // TATAMOTORS mapping requires corporate-action verification.
  'SBIN': 'SBIN.NS',
  'BHARTIARTL': 'BHARTIARTL.NS',
  'ITC': 'ITC.NS',
  'LT': 'LT.NS',
  'KOTAKBANK': 'KOTAKBANK.NS',
  'AXISBANK': 'AXISBANK.NS',
  'MARUTI': 'MARUTI.NS',
  'SUNPHARMA': 'SUNPHARMA.NS',
  'TITAN': 'TITAN.NS',
  'BAJFINANCE': 'BAJFINANCE.NS',
  'TATASTEEL': 'TATASTEEL.NS',
  'ADANIPORTS': 'ADANIPORTS.NS',
  'WIPRO': 'WIPRO.NS',
  'HCLTECH': 'HCLTECH.NS',
  'TECHM': 'TECHM.NS',
  'POWERGRID': 'POWERGRID.NS',
  'NTPC': 'NTPC.NS',
  'COALINDIA': 'COALINDIA.NS',
  'ONGC': 'ONGC.NS',
  'JSWSTEEL': 'JSWSTEEL.NS',
  'HINDALCO': 'HINDALCO.NS',
  'VEDL': 'VEDL.NS',
  'DRREDDY': 'DRREDDY.NS',
  'CIPLA': 'CIPLA.NS',
  'DIVISLAB': 'DIVISLAB.NS',
  'M&M': 'M&M.NS',
  'BAJAJ-AUTO': 'BAJAJ-AUTO.NS',
  'HEROMOTOCO': 'HEROMOTOCO.NS',
  'EICHERMOT': 'EICHERMOT.NS',
  'INDUSINDBK': 'INDUSINDBK.NS',
  'PNB': 'PNB.NS',
  'NESTLEIND': 'NESTLEIND.NS',
  'ASIANPAINT': 'ASIANPAINT.NS',
  'ULTRACEMCO': 'ULTRACEMCO.NS',
  'BPCL': 'BPCL.NS',
  'TRENT': 'TRENT.NS',
  'BEL': 'BEL.NS',
  'HAL': 'HAL.NS',
  // ZOMATO mapping unverified; never substitute SWIGGY.
};

// In-memory cache of real OHLCV historical daily bars for all symbols
const REAL_BARS_CACHE = new Map<number, OHLCVBar[]>();
let isFetchingAll = false;
let lastFetchTimestamp = 0;

/**
 * Fetches real historical daily OHLCV bars from Yahoo Finance chart endpoint
 */
export function yahooTickerUrl(ticker:string,range='1y'):string {const raw=YAHOO_NSE_TICKER_MAP[ticker];if(!raw)throw new MarketDataError('UNKNOWN_MAPPING','Provider ticker mapping unverified');if(!['1y','2y','5y','1mo','3mo','6mo'].includes(range))throw new MarketDataError('INVALID_RANGE','Unsupported range');return 'https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(raw)+'?range='+range+'&interval=1d';}
/** No entitled production adapter enabled. This function intentionally performs no network request. */
export async function fetchYahooFinanceBars(ticker:string,range='1y'):Promise<OHLCVBar[]|null>{yahooTickerUrl(ticker,range);throw new MarketDataError('PROVIDER_UNAVAILABLE','Yahoo entitlement not verified; adapter disabled');}
export async function refreshAllRealMarketData():Promise<void>{if(getDataMode()==='demo')return;throw new MarketDataError('PROVIDER_UNAVAILABLE','No entitled production adapter configured');}
export function getRealDailyBars(symbolId:number):OHLCVBar[]{return getMarketSeries(symbolId).bars;}
// Legacy holiday fixture, NOT independently verified; special sessions unsupported.
export const CALENDAR_VERSION = 'legacy-holidays-2024-2027-unverified-v1';
export const NSE_TRADING_HOLIDAYS = new Set([
  // 2024
  '2024-01-22', '2024-01-26', '2024-03-08', '2024-03-25', '2024-03-29',
  '2024-04-11', '2024-04-17', '2024-05-01', '2024-05-20', '2024-06-17',
  '2024-07-17', '2024-08-15', '2024-10-02', '2024-11-01', '2024-11-15', '2024-12-25',
  // 2025
  '2025-01-26', '2025-02-26', '2025-03-14', '2025-03-31', '2025-04-10',
  '2025-04-14', '2025-04-18', '2025-05-01', '2025-06-07', '2025-08-15',
  '2025-08-27', '2025-10-02', '2025-10-21', '2025-10-22', '2025-11-05', '2025-12-25',
  // 2026
  '2026-01-26', '2026-02-16', '2026-03-04', '2026-03-20', '2026-04-03',
  '2026-04-14', '2026-05-01', '2026-05-27', '2026-08-15', '2026-08-26',
  '2026-10-02', '2026-10-19', '2026-10-20', '2026-11-24', '2026-12-25',
  // 2027
  '2027-01-26', '2027-03-23', '2027-03-26', '2027-04-14', '2027-05-01',
  '2027-08-15', '2027-10-02', '2027-12-25'
]);

/**
 * Calculates the exact latest/last market operated trading date for NSE / BSE in IST
 * Normal trading hours: Monday - Friday, 09:15 AM to 03:30 PM IST (Asia/Kolkata)
 */
export function getLastMarketOperatedDate(now: Date = new Date()): Date {
  // Convert current server time to Indian Standard Time (IST = UTC + 5:30)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffsetMs);
  
  const istYear = istTime.getUTCFullYear();
  const istMonth = istTime.getUTCMonth();
  const istDate = istTime.getUTCDate();
  const istHours = istTime.getUTCHours();
  const istMinutes = istTime.getUTCMinutes();
  const dayOfWeek = istTime.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

  // Check if today's market has opened yet (opens at 09:15 AM IST on weekdays)
  const isMarketStartedToday = (istHours > 15 || (istHours === 15 && istMinutes >= 30));
  
  let candidate = new Date(Date.UTC(istYear, istMonth, istDate, 10, 0, 0));
  
  // If weekend or weekday before market open (09:15 AM IST), roll back to previous day
  if (dayOfWeek === 0 || dayOfWeek === 6 || !isMarketStartedToday) {
    candidate.setUTCDate(candidate.getUTCDate() - 1);
  }
  
  // Roll back past any weekends and NSE trading holidays
  while (true) {
    const dow = candidate.getUTCDay();
    const dateStr = candidate.toISOString().split('T')[0];
    const isWeekend = (dow === 0 || dow === 6);
    const isHoliday = NSE_TRADING_HOLIDAYS.has(dateStr);
    
    if (!isWeekend && !isHoliday) {
      break;
    }
    candidate.setUTCDate(candidate.getUTCDate() - 1);
  }
  
  return candidate;
}

/**
 * Returns available trading session dates across the market universe (up to 250 trading sessions ~ 1 year)
 */
export function tradingSessionsFromDates(dates:string[],mode:'demo'|'real',maxCount=250): { date: string; label: string; fullLabel: string; dayOfWeek: string; isLatest: boolean }[] {
  if(!Number.isInteger(maxCount)||maxCount<1||maxCount>2000)throw new MarketDataError('INVALID_COUNT','Count must be 1..2000');
  const formatter=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}),weekday=new Intl.DateTimeFormat('en-IN',{weekday:'long',timeZone:'UTC'});
  return [...new Set(dates.map(validateDate))].sort().slice(-maxCount).reverse().map((value,index)=>{const date=new Date(value+'T12:00:00Z'),formatted=formatter.format(date),dayOfWeek=weekday.format(date),suffix=mode==='demo'?'Generated Demo Bar':'Observed Daily Bar';return {date:value,label:formatted+(index===0?' (Latest '+suffix+')':''),fullLabel:dayOfWeek+', '+formatted+' ('+suffix+')',dayOfWeek,isLatest:index===0};});
}
export function getAvailableTradingDates(maxCount:number=250):ReturnType<typeof tradingSessionsFromDates>{
  const series=getMarketSeries(NSE_SYMBOLS[0].id);
  return tradingSessionsFromDates(series.bars.map(bar=>bar.date),series.provenance.mode,maxCount);
}

/**
 * Finds the nearest valid trading date for any calendar date (snaps weekends/holidays to closest preceding trading date)
 */
export function findNearestTradingDate(requestedDate?: string): { resolvedDate: string; isSnapped: boolean; originalDate?: string; isHistorical: boolean; sessionLabel: string } {
  if(requestedDate)validateDate(requestedDate);
  const available = getAvailableTradingDates(250);
  const latest = available[0];

  if (!requestedDate) {
    return {
      resolvedDate: latest.date,
      isSnapped: false,
      isHistorical: false,
      sessionLabel: latest.fullLabel
    };
  }

  // Exact match in trading calendar
  const exact = available.find(d => d.date === requestedDate);
  if (exact) {
    return {
      resolvedDate: exact.date,
      isSnapped: false,
      originalDate: requestedDate,
      isHistorical: exact.date !== latest.date,
      sessionLabel: exact.fullLabel
    };
  }

  // If date is in the future compared to latest session, snap to latest
  if (requestedDate > latest.date) {
    return {
      resolvedDate: latest.date,
      isSnapped: true,
      originalDate: requestedDate,
      isHistorical: false,
      sessionLabel: `${latest.fullLabel} (Snapped from future date ${requestedDate})`
    };
  }

  // Find nearest preceding trading date
  for (const session of available) {
    if (session.date <= requestedDate) {
      return {
        resolvedDate: session.date,
        isSnapped: true,
        originalDate: requestedDate,
        isHistorical: session.date !== latest.date,
        sessionLabel: `${session.fullLabel} (Market closed on ${requestedDate} - resolved to nearest session)`
      };
    }
  }

  throw new MarketDataError('OUT_OF_COVERAGE','Date precedes calendar coverage');
}
/** No automatic startup network or authentication. */
export function initRealMarketData():void {}
