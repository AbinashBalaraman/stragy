# Observed-data research and chat integration

## Deployment contract

The upgraded public service uses `EXPOSURE_MODE=public-research`, `DATA_MODE=real`, and `MARKET_PROVIDER=yahoo`. The existing free Render service builds with `npm ci --include=dev && npm run build`, starts with `npm start`, and checks `/health/ready`. No broker session, order execution, subscription or paid plan is introduced.

`demo-public` remains a separate, explicitly generated-data mode. It is not a prerequisite for using the upgraded engine. A real-data failure returns unavailable coverage, never generated bars.

## Market observations

- Yahoo's public chart endpoint provides observed daily OHLCV, normally delayed/end-of-day. It is not an exchange tick stream. Unfinished daily bars are excluded.
- Each dataset records source, provider symbol, observation date, fetch time, adjustment description, checksum, freshness and warnings. Null quotes are omitted without synthesizing OHLC prices.
- Real Nifty 50 membership is retrieved from the official NSE constituent CSV, not the old illustrative 84-name pool. Current constituents introduce historical survivorship bias; the publisher does not supply an effective date in the CSV.
- ETERNAL is mapped to the existing ZOMATO issuer ID using the published NSE rename. TMPV receives new stable ID 50001; old TATAMOTORS strategies are not silently rewritten after the demerger.
- Fetch concurrency is at most four, per-provider requests are bounded, and real-to-demo fallback is prohibited. Broad unverified catalog scans fail with a useful message rather than occupying the worker indefinitely.

## Temporal screening and simulation

A rule can include `lookback: { bars: 20, includeCurrent: false, match: 'any' }`. The same causal evaluator is used by scans and simulations. For the example setup, current Wilder RSI(14) must be below 30, and at least one of the previous 20 completed daily bars must have RSI at least 70. The current bar is excluded from that historical window.

Chat can produce a strictly validated screen and invoke a read-only asynchronous scan. Stock matches come from the engine and observed datasets, never from model-written stock lists. Results include coverage and matching historical dates. Failed or unavailable scans are not presented as zero matches.

When the user omits thresholds or the recency window, the explicit RSI parser discloses its defaults. It is labelled `rule_parser`, not an AI model. Unknown setups use the selected external provider only when configured. The model can propose strategy JSON, not execute code or orders.

Screening does not specify exits, sizing or costs. Chat lists these missing assumptions and requires an explicit separate selection before a research backtest. Applying a proposal, saving it and running it remain separate actions. Browser-local strategy storage and version history are retained.

## External AI cost boundary

The TokenRouter adapter uses the existing server-side `TOKENROUTER_API_KEY` at the fixed allowlisted `https://api.tokenrouter.com/v1/chat/completions` endpoint. It never exposes the key to the browser or changes to another provider/model after failure.

Production selects `stealth/union-alpha` with `AI_COST_POLICY=free-only`. Before each completion, the adapter checks the same public pricing catalog used by TokenRouter's model page. Unknown, changed, tiered or nonzero pricing is rejected before the completion is sent. There is no paid-model fallback. The service also bounds tokens, request duration and the hourly request count. Availability or future free pricing is not guaranteed.

## Verification

Offline tests cover causal lookback boundaries, canonical roundtrips, next-open entries, public-data parsing and identity, all 50 membership mappings, free-price failure closure, asynchronous job cancellation/deadlines and chat review/action separation. Runtime smoke and deployed UI verification are recorded separately; passing unit tests alone is not proof of live provider connectivity.

## Provider pacing and shared observed-data cache

Production universe loading is sequential, with at least 1.1 seconds between new Yahoo requests. Successful completed daily observations are atomically cached across workers for at most 15 minutes, with a 64-file cap, checksum/identity validation and original fetch timestamps. Invalid or expired cache records are not displayed; provider failures remain unavailable. No synthetic prices, paid provider, proxy or identity rotation is introduced.
