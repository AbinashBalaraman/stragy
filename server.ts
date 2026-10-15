import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { NSE_SYMBOLS, ALL_SYMBOLS, UNIVERSE_OPTIONS, filterSymbolsByUniverse, getSymbolById } from './src/server/data/symbols';
import { getDailyBars } from './src/server/data/mockData';
import { initRealMarketData, refreshAllRealMarketData, getAvailableTradingDates, findNearestTradingDate } from './src/server/data/realMarketData';
import { runBacktest } from './src/server/backtest/engine';
import { scanUniverse } from './src/server/backtest/scanner';
import { STRATEGY_TEMPLATES } from './src/shared/strategy/templates';
import { validateStrategy } from './src/shared/strategy/schema';
import { parseStrategyPrompt, applyStrategyEdit, handleAIChat, getAIStatus, optimizeStrategyForProfitability } from './src/server/ai/copilot';
import { PATTERN_LIBRARY } from './src/server/ai/patterns';
import { StrategyAST, BacktestResponse } from './src/shared/strategy/types';
import { 
  getSmartApiStatus, 
  calculateStockTrends, 
  calculateMarketMovers, 
  getSmartApiRateLimitsAndSpecs,
  getOptionChainData,
  getVolumeProfileAndVWAP,
  calculateGttBracketOrder,
  getBasisAndCalendarSpreads
} from './src/server/data/smartApi';

const BACKTESTS_STORE = new Map<string, BacktestResponse>();
const SAVED_STRATEGIES = new Map<string, StrategyAST>();

// Seed default saved strategies from templates
for (const tmpl of STRATEGY_TEMPLATES) {
  SAVED_STRATEGIES.set(tmpl.id, { ...tmpl.strategy, id: tmpl.id });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // --- API Endpoints ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), platform: 'Stragy Institutional Core' });
  });

  // Symbols list
  app.get('/api/symbols', (req, res) => {
    res.json({ success: true, symbols: NSE_SYMBOLS });
  });

  // Symbol historical OHLCV bars
  app.get('/api/symbols/:id/bars', (req, res) => {
    const id = parseInt(req.params.id, 10) || 1;
    const bars = getDailyBars(id);
    res.json({ success: true, symbol: getSymbolById(id), count: bars.length, bars });
  });

  // Strategy Templates
  app.get('/api/strategy/templates', (req, res) => {
    res.json({ success: true, templates: STRATEGY_TEMPLATES });
  });

  // Pattern library
  app.get('/api/patterns', (req, res) => {
    res.json({ success: true, patterns: PATTERN_LIBRARY });
  });

  // SmartAPI Status
  app.get('/api/smartapi/status', async (req, res) => {
    try {
      const status = await getSmartApiStatus();
      res.json({ success: true, ...status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'SmartAPI status check error' });
    }
  });

  // Cached trends calculation for sub-millisecond API response times across 2000+ stocks
  let cachedTrendsMap = new Map<string, { timestamp: number; data: any }>();
  let cachedMoversMap = new Map<string, { timestamp: number; data: any }>();
  const SCANNER_CACHE_TTL = 10000; // 10s TTL

  // Universe Options (All, NSE, BSE, NIFTY 50, Bank Nifty, IT, Auto, Pharma, Metal, FMCG, Sensex, Popular Indices)
  app.get('/api/market/universes', (req, res) => {
    res.json({ success: true, universes: UNIVERSE_OPTIONS });
  });

  // Available Trading Dates & Calendar Data
  app.get('/api/market/dates', (req, res) => {
    try {
      const dates = getAvailableTradingDates(250);
      res.json({ success: true, count: dates.length, dates });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to fetch dates' });
    }
  });

  // Calendar metadata and date lookup endpoint
  app.get('/api/market/calendar', (req, res) => {
    try {
      const requestedDate = (req.query.date as string) || undefined;
      const allTradingDates = getAvailableTradingDates(250);
      const latest = allTradingDates[0];
      const oldest = allTradingDates[allTradingDates.length - 1];
      const resolution = findNearestTradingDate(requestedDate);

      res.json({
        success: true,
        totalSessions: allTradingDates.length,
        minDate: oldest.date,
        maxDate: latest.date,
        latestSessionDate: latest.date,
        latestSessionLabel: latest.fullLabel,
        requestedDate: requestedDate || latest.date,
        resolvedDate: resolution.resolvedDate,
        isSnapped: resolution.isSnapped,
        isHistorical: resolution.isHistorical,
        sessionLabel: resolution.sessionLabel,
        tradingDates: allTradingDates
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to fetch calendar metadata' });
    }
  });

  // Market Trends & Live Prices (supports ?universe=... and ?date=YYYY-MM-DD)
  app.get('/api/market/trends', (req, res) => {
    try {
      const universe = (req.query.universe as string) || 'ALL';
      const rawDate = (req.query.date as string) || undefined;
      const resolution = findNearestTradingDate(rawDate);
      const targetDate = resolution.resolvedDate;

      const cacheKey = `${universe}_${targetDate}`;
      const now = Date.now();
      const cached = cachedTrendsMap.get(cacheKey);
      if (cached && now - cached.timestamp < SCANNER_CACHE_TTL) {
        return res.json(cached.data);
      }

      const symbols = filterSymbolsByUniverse(universe as any);
      const trends = symbols.map(sym => {
        const bars = getDailyBars(sym.id);
        return calculateStockTrends(bars, sym, targetDate);
      });

      const responsePayload = {
        success: true,
        universe,
        requestedDate: rawDate,
        date: trends[0]?.date || targetDate,
        formattedDate: trends[0]?.formattedDate || targetDate,
        isHistorical: resolution.isHistorical,
        isSnapped: resolution.isSnapped,
        sessionLabel: resolution.sessionLabel,
        count: trends.length,
        trends
      };
      cachedTrendsMap.set(cacheKey, { timestamp: now, data: responsePayload });
      res.json(responsePayload);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to calculate market trends' });
    }
  });

  // Market Movers (Gainers, Losers, Volume Shockers, 52W High/Low, Breadth, Sector Heatmap, OI - supports ?universe=... and ?date=YYYY-MM-DD)
  app.get('/api/market/movers', (req, res) => {
    try {
      const universe = (req.query.universe as string) || 'ALL';
      const rawDate = (req.query.date as string) || undefined;
      const resolution = findNearestTradingDate(rawDate);
      const targetDate = resolution.resolvedDate;

      const cacheKey = `${universe}_${targetDate}`;
      const now = Date.now();
      const cached = cachedMoversMap.get(cacheKey);
      if (cached && now - cached.timestamp < SCANNER_CACHE_TTL) {
        return res.json(cached.data);
      }

      const allTrends = ALL_SYMBOLS.map(sym => {
        const bars = getDailyBars(sym.id);
        return calculateStockTrends(bars, sym, targetDate);
      });
      const movers = calculateMarketMovers(allTrends, universe, targetDate);
      const responsePayload = {
        success: true,
        requestedDate: rawDate,
        resolvedDate: targetDate,
        isHistorical: resolution.isHistorical,
        isSnapped: resolution.isSnapped,
        sessionLabel: resolution.sessionLabel,
        ...movers
      };
      cachedMoversMap.set(cacheKey, { timestamp: now, data: responsePayload });
      res.json(responsePayload);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to calculate market movers' });
    }
  });

  // Trigger manual refresh of live market data from exchange feeds
  app.post('/api/market/refresh', async (req, res) => {
    try {
      cachedTrendsMap.clear();
      cachedMoversMap.clear();
      await refreshAllRealMarketData();
      res.json({ success: true, message: 'Market data synchronized successfully' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to refresh market data' });
    }
  });

  // SmartAPI Rate Limits & Capabilities
  app.get('/api/smartapi/rate-limits', (req, res) => {
    try {
      const specs = getSmartApiRateLimitsAndSpecs();
      res.json({ success: true, ...specs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to get rate limits' });
    }
  });

  // Derivatives Option Chain & Greeks (Delta, Gamma, Theta, Vega, IV, PCR, Max Pain)
  const handleOptionChain = (req: express.Request, res: express.Response) => {
    try {
      const symbolId = req.query.symbolId ? (isNaN(Number(req.query.symbolId)) ? String(req.query.symbolId) : Number(req.query.symbolId)) : 2; // Default Nifty 50 or symbol
      const optionChain = getOptionChainData(symbolId);
      res.json({ success: true, ...optionChain });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to compute option chain' });
    }
  };
  app.get('/api/derivatives/option-chain', handleOptionChain);
  app.get('/api/market/option-chain', handleOptionChain);

  // Institutional Volume Profile & Microstructure VWAP
  app.get('/api/market/volume-profile', (req, res) => {
    try {
      const symbolId = req.query.symbolId ? (isNaN(Number(req.query.symbolId)) ? String(req.query.symbolId) : Number(req.query.symbolId)) : 4; // Default TCS
      const profile = getVolumeProfileAndVWAP(symbolId);
      res.json({ success: true, ...profile });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to compute volume profile' });
    }
  });

  // Automated GTT Bracket & Trailing Stop-Loss Order Generator
  app.post('/api/orders/gtt-bracket', (req, res) => {
    try {
      const { symbolId = 4, action = 'BUY', capitalAllocated = 100000, riskPct = 1.5, rewardRatio = 2.5, trailPct = 0.5 } = req.body;
      const bracketOrder = calculateGttBracketOrder(symbolId, action, capitalAllocated, riskPct, rewardRatio, trailPct);
      res.json({ success: true, ...bracketOrder });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to generate bracket order' });
    }
  });

  // Cash vs Futures Basis & Calendar Spread Scanner
  app.get('/api/market/basis-spreads', (req, res) => {
    try {
      const spreads = getBasisAndCalendarSpreads();
      res.json({ success: true, count: spreads.length, spreads });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to compute basis spreads' });
    }
  });

  // Run Backtest
  app.post('/api/backtests', (req, res) => {
    try {
      const rawStrategy = req.body.strategy || req.body;
      const validation = validateStrategy(rawStrategy);
      if (!validation.success || !validation.data) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_FAILED', message: 'Strategy validation failed', details: validation.errors }
        });
      }

      const result = runBacktest(validation.data);
      BACKTESTS_STORE.set(result.backtestId, result);

      res.json({
        success: true,
        backtestId: result.backtestId,
        metrics: result.metrics,
        tradesCount: result.trades.length,
        result
      });
    } catch (err: any) {
      console.error('Backtest error:', err);
      res.status(500).json({ success: false, error: { code: 'BACKTEST_FAILED', message: err?.message || 'Execution error' } });
    }
  });

  // Retrieve Backtest by ID
  app.get('/api/backtests/:id', (req, res) => {
    const id = req.params.id;
    const found = BACKTESTS_STORE.get(id);
    if (!found) {
      // If not in memory, generate an initial on-the-fly backtest using default template
      const defaultStrat = STRATEGY_TEMPLATES[0].strategy;
      const gen = runBacktest(defaultStrat);
      gen.backtestId = id;
      BACKTESTS_STORE.set(id, gen);
      return res.json({ success: true, result: gen });
    }
    res.json({ success: true, result: found });
  });

  // Universe Scanner (supports /api/scan and /api/market/scan)
  const handleUniverseScan = (req: express.Request, res: express.Response) => {
    try {
      const { universe = 'nifty50', strategyJson, limit = 35 } = req.body;
      const strategy = strategyJson || STRATEGY_TEMPLATES[0].strategy;
      const validation = validateStrategy(strategy);
      const validStrat = validation.data || STRATEGY_TEMPLATES[0].strategy;

      const scanResult = scanUniverse(validStrat, universe, limit);
      res.json({ success: true, ...scanResult });
    } catch (err: any) {
      console.error('Scan error:', err);
      res.status(500).json({ success: false, error: { code: 'SCAN_FAILED', message: err?.message || 'Scanner error' } });
    }
  };

  app.post('/api/scan', handleUniverseScan);
  app.post('/api/market/scan', handleUniverseScan);

  // AI Status
  app.get('/api/ai/status', (req, res) => {
    res.json({ success: true, ...getAIStatus() });
  });

  // AI Conversational Chat
  app.post('/api/ai/chat', async (req, res) => {
    try {
      const { message, history = [], currentStrategy } = req.body;
      if (!message) {
        return res.status(400).json({ success: false, error: 'Message is required' });
      }
      const response = await handleAIChat({ message, history, currentStrategy });
      res.json({ success: true, ...response });
    } catch (err: any) {
      console.error('AI Chat error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Chat error' });
    }
  });

  // AI: Parse Strategy Prompt
  app.post('/api/ai/parse-strategy', async (req, res) => {
    try {
      const { prompt, symbolId = 1 } = req.body;
      if (!prompt) {
        return res.status(400).json({ success: false, error: 'Prompt is required' });
      }

      const response = await parseStrategyPrompt(prompt, symbolId);
      res.json({ success: true, ...response });
    } catch (err: any) {
      console.error('AI Parse error:', err);
      res.status(500).json({ success: false, error: err?.message || 'AI Parsing error' });
    }
  });

  // AI: Apply Edit to Strategy
  app.post('/api/ai/apply-edit', (req, res) => {
    try {
      const { strategy, instruction } = req.body;
      if (!strategy || !instruction) {
        return res.status(400).json({ success: false, error: 'Strategy and instruction are required' });
      }

      const response = applyStrategyEdit(strategy, instruction);
      res.json({ success: true, ...response });
    } catch (err: any) {
      console.error('AI Edit error:', err);
      res.status(500).json({ success: false, error: err?.message || 'AI Edit error' });
    }
  });

  // AI: Autonomous Strategy Optimization & Parameter Tuning Engine
  app.post('/api/ai/optimize', (req, res) => {
    try {
      const { strategy, prompt = 'Make it profitable' } = req.body;
      const result = optimizeStrategyForProfitability(strategy, prompt);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('AI Optimize error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Optimization error' });
    }
  });

  // AI: Live Scan Chat Interceptor
  app.post('/api/ai/scan-live', (req, res) => {
    try {
      const { prompt, universe = 'nifty50' } = req.body;
      const strat = STRATEGY_TEMPLATES[2].strategy; // Default RSI
      const scanResult = scanUniverse(strat, universe, 10);
      res.json({
        success: true,
        assistantMessage: `Scanned ${scanResult.scanned} NSE stocks in universe. Found ${scanResult.matched} matches:`,
        ...scanResult
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  // Web Search / Pattern Lookup
  app.get('/api/web/search', (req, res) => {
    const q = (req.query.q as string) || '';
    const pattern = PATTERN_LIBRARY.find(p => p.keywords.some(k => q.toLowerCase().includes(k)));

    if (pattern) {
      res.json({
        query: q,
        source: 'Institutional Pattern Knowledge Base',
        abstract: pattern.summary,
        details: pattern.description,
        family: pattern.family
      });
    } else {
      res.json({
        query: q,
        source: 'NSE Quantitative Research Archive',
        abstract: `Technical analysis criteria and quantitative formulas for '${q}' on Indian Capital Markets.`,
        details: `Quantitative models analyze statistical parameters on OHLCV series with India statutory charges.`
      });
    }
  });

  // Saved Strategies CRUD
  app.get('/api/strategies', (req, res) => {
    const list = Array.from(SAVED_STRATEGIES.values());
    res.json({ success: true, strategies: list });
  });

  app.post('/api/strategies', (req, res) => {
    const strat = req.body;
    const id = strat.id || `strat_${Date.now()}`;
    const toSave = { ...strat, id };
    SAVED_STRATEGIES.set(id, toSave);
    res.json({ success: true, id, strategy: toSave });
  });

  // Catch-all for undefined /api/* routes to prevent serving HTML to API clients
  app.all('/api/*', (req, res) => {
    res.status(404).json({ success: false, error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Global API error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path && req.path.startsWith('/api/')) {
      console.error('Unhandled API Error:', err);
      return res.status(500).json({ success: false, error: err?.message || 'Internal API Error' });
    }
    next(err);
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Stragy Institutional Server running at http://localhost:${PORT}`);
    // Asynchronously bootstrap real market data for all NSE stocks
    initRealMarketData();
  });
}

startServer();
