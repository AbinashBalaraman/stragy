# Render HTTPS origin verification

Render terminates HTTPS before forwarding traffic to the Node HTTP listener. Comparing a browser's HTTPS `Origin` to Express's internal HTTP protocol rejects legitimate chat, scan and backtest requests.

The server now uses an explicitly configured `PUBLIC_ORIGIN`, falling back to Render's trusted `RENDER_EXTERNAL_URL` environment variable. Configuration accepts a single HTTP(S) origin, normalizes its hostname/default port, and rejects credentials, paths, queries, fragments and wildcards. On direct local deployments without either setting, the existing request protocol/host check remains.

For a custom domain, set `PUBLIC_ORIGIN` to its exact origin, for example `https://research.example.com`. Do not configure a list or wildcard. Request `Origin` values are compared exactly. `trust proxy` remains false, and client-supplied forwarded headers do not establish the allowed origin. Private API authentication, cross-origin rejection, request limits and public-demo restrictions remain enabled.

Regression tests cover the HTTPS-public/HTTP-backend case for proposals and backtests, invalid configuration, spoofed forwarded headers, foreign origins, scheme/port mismatches and malformed origins. The production smoke script sends only empty validation probes; no provider call, job, save or order occurs.

## Deployment

Build: `npm ci --include=dev && npm run build`

Start: `npm start`

Readiness: `/health/ready`

`render.yaml` records the build-time development dependencies explicitly. For an existing manually configured service, its dashboard/API settings are authoritative; changing the YAML alone does not update them.

## Boundaries of the requested RSI research

This fix does not turn on external AI, a real-market-data provider or broker execution. The exact screen `RSI(14)[t] < 30` with `RSI(14) >= 70` somewhere in the preceding 20 completed sessions requires a versioned historical-window predicate shared by scanning and simulation. The current strategy grammar does not provide that predicate.

A real scan also requires observed OHLCV, a dated authoritative 50-equity Nifty universe, completed-session coverage, freshness and corporate-action treatment. Generated demo bars and the bundled illustrative universe must not be presented as current market matches. Backtest period, exits, sizing and costs require explicit assumptions before executing that strategy.
