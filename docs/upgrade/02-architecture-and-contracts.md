# Stragy upgrade: target architecture and implementation contracts

Status: proposed design, not implemented. Baseline: `163a80c6d603eec2bed28a7e9220b6a867e8dac7`.

Read [the root plan](../../UPGRADE_PLAN.md) first. Ticket IDs below resolve to [the implementation backlog](03-implementation-backlog.md).

## 1. Design decisions models must preserve

1. Keep React, TypeScript, Vite, Express, Zod, and the existing visual strategy concept. Do not rewrite in Python, Next.js, Rust, or microservices to complete this plan.
2. Upgrade the existing application incrementally. First make results honest and deterministic; then make computation cancellable and workflows durable; then improve the interface.
3. Keep one deployable service initially. Isolate CPU work in a bounded worker-thread pool, not a fleet of services. Do not add Redis, Kafka, Kubernetes, or a vector database to the core release.
4. Use npm and Node 22 for the first reproducible baseline, matching the existing CI Node major. Pin the selected patch version and its supported lifetime during P00. Reassess runtime support at release, not through an unrelated framework upgrade.
5. Treat every strategy, provider response, saved record, and AI response as untrusted input. TypeScript casts are not runtime validation.
6. Never silently substitute simulated prices, option chains, OI, quotes, or calendar history for unavailable real data. Demo mode is explicit and visually persistent.
7. Retain the existing strategy format through an explicit migration reader. Breaking research semantics requires a new engine version and new runs, not silently mutating old results.
8. Default support is single-symbol, long-only, cash-funded, market-order research. Reject unsupported execution settings with an actionable validation error. Short selling, limit orders, intraday square-off, and derivatives are not supported merely because fields exist.
9. No broker order placement, automated execution, credential-entry flow, or personalized investment advice is introduced by the core plan.
10. Do not promise institutional-grade accuracy, real-time coverage, profitability, point-in-time universes, or regulatory compliance without demonstrable evidence.

## 2. Proposed module layout

These are target paths, not files that already exist. Move code only with behavior-preserving tests and explicit import updates.

```text
server.ts                              # thin process entrypoint
src/server/app.ts                      # createApp(dependencies), no listen side effect
src/server/config.ts                   # runtime env schema and safe configuration
src/server/api/routes/                 # routes grouped by business capability
src/server/api/middleware/             # errors, request ID, limits, access policy
src/server/services/                   # application orchestration
src/server/data/providers/             # Yahoo/SmartAPI/demo adapters as actually supported
src/server/data/normalization.ts        # validated canonical bars
src/server/data/calendar.ts            # exchange sessions and timestamp policy
src/server/data/cache.ts               # bounded provider-aware cache
src/server/backtest/indicators.ts       # pure, aligned arrays, no provider requests
src/server/backtest/rules.ts            # shared evaluator for scanner and backtest
src/server/backtest/execution.ts        # ordered event processing and fills
src/server/backtest/ledger.ts           # cash, positions, charges, realized/unrealized PnL
src/server/backtest/metrics.ts          # pure metrics from daily equity and trades
src/server/backtest/robustness.ts        # seeded statistical experiments
src/server/backtest/indianCosts.ts      # dated cost schedules and per-fill charges
src/server/jobs/                        # queue, worker protocol, cancellation
src/server/storage/                     # repositories, migrations, retention
src/server/ai/                          # provider adapters and validated proposal flow
src/shared/contracts/                  # Zod schemas and inferred public types
src/shared/strategy/                   # legacy reader, migration, templates, rendering
src/client/api/                        # typed HTTP client and request schemas
src/client/state/                      # strategy/workspace/session state
src/components/                        # existing components, gradually decomposed
src/features/{builder,results,scanner,copilot}/
                                      # feature controllers/hooks, no backend imports
src/test/fixtures/                     # small deterministic offline datasets
src/test/{unit,integration,e2e}/
docs/{architecture,operations,upgrade}/
```

Build output is also a security boundary: Vite emits `dist/client`, the Node bundle and its private source map emit `dist/server`, and Express serves only `dist/client`. Requests for backend/configuration artifacts must be denied by local production-mode tests. Never restore the baseline's shared public/private `dist` root.

Allowed dependency direction: UI -> shared contracts; API -> services -> domain/provider/storage adapters. Domain mathematics -> shared contracts only. No browser import may reach `src/server`, `process.env`, filesystem, broker login code, or Node-only libraries. Provider adapters cannot import React. CI must enforce this graph.

## 3. Strategy v2 contract

Create canonical Zod schemas and infer types from them. Do not maintain separate hand-written schema/type definitions for the same object.

### 3.1 Identity and revision

- `schemaVersion: 2` is the format discriminator. Do not reuse the legacy `version` number, which is not enough to separate schema version from a saved strategy revision.
- `id` is a stable strategy identifier; `revision` increments on successful save.
- Preserve `name`, `description`, universe, indicators, rules, risk, execution, and costs through migration.
- Normalize field order and omitted optional fields for hashing. Use canonical JSON with a specified hash algorithm, not `JSON.stringify` insertion order by accident.
- Validate imports before replacing the active workspace. Invalid imports leave the current strategy and saved records unchanged.

### 3.2 Supported instrument and timeframe

- Use a canonical `instrumentId` separate from provider tokens. Retain legacy numeric `symbolId` in a compatibility mapping.
- Instrument metadata must include exchange, asset class, quote currency, tick size, quantity step, and trading timezone. Unknown values block execution or explicitly restrict capabilities.
- Timeframes remain an enum. Reject a timeframe not provided by the selected source for the requested period.
- Do not present NSE/BSE enum values as complete support for global equities. Additional venues need currency, calendars, fee policy, and fixtures.

### 3.3 Indicators and operands

Every indicator has a unique ID, known type, and a discriminated parameter schema. Periods are positive bounded integers. Examples: MACD fast < slow; Bollinger standard-deviation multiplier > 0; ATR period must resolve explicitly.

Use explicit operands rather than overloading a free-form string:

```ts
type Operand =
  | { kind: 'price'; field: 'open' | 'high' | 'low' | 'close' | 'volume' }
  | { kind: 'candle'; field: 'body' | 'upperWick' | 'lowerWick' }
  | { kind: 'indicator'; indicatorId: string; output: string }
  | { kind: 'constant'; value: number };
```

- Register output names by indicator: MACD line/signal/histogram, Bollinger upper/middle/lower, Supertrend line/direction, and single-output indicators.
- Validate references, legal outputs, duplicate IDs, finite constants, and operand compatibility server-side and client-side.
- Define `entry.all` and `exit.all` explicitly for migrated flat rules. The reviewed engine uses the same AND evaluator for both entry and exit (`engine.ts:69-81,253`). Do not silently convert exit rules to OR because it seems more intuitive. Empty exit groups mean no rule-based exit; empty entry groups are invalid for an executable strategy.
- The initial v2 grammar stays flat. Nested boolean groups are a later addition with their own version and tests.
- Null/unavailable indicator outputs never become zero. Comparison or crossover involving unavailable values returns false with a diagnostic, not a signal.
- `crossesAbove` requires previous left <= previous right and current left > current right. `crossesBelow` is the inverse. All four operands must be finite.
- Make equality semantics explicit: v2 `eq` uses exact finite numeric equality; `approxEq` uses `abs(left - right) < absoluteTolerance`, with a positive finite tolerance in the operand's units. The baseline's `eq` uses absolute tolerance 0.0001 (`engine.ts:56-57`), so recognized legacy equality rules migrate to `approxEq` with that tolerance, not silently to exact equality. Surface the tolerance in the builder/summary and test boundary equality. This does not introduce nested rule groups.

### 3.4 Risk and execution

- Validate stop-loss, target, trailing stop, and sizing with discriminated unions. Fields irrelevant to the selected variant are rejected or removed by a documented normalization.
- V2 fixed-fraction sizing uses `{ type: 'fixedFraction', allocationPct: number }`, with `0 < allocationPct <= 100`, and the engine divides by 100 exactly once. Legacy `fraction` is a 0..1 fraction (`engine.ts:163-165`, `schema.ts:68`): migrate 0.15 to allocationPct 15, not 0.15. Retain the original field in the migration backup, not the executable v2 payload.
- V2 fixed risk uses `{ type: 'fixedRisk', riskPct: number }`, with `0 < riskPct <= 100`, applied to pre-entry equity. It requires a positive executable stop distance; zero or invalid ATR rejects the order. Legacy fixedRisk was accepted but not actually implemented; its migration must clearly state that enabling real risk sizing changes behavior and cannot claim numerical equivalence. Never guess an ambiguous legacy riskPerTrade unit silently.
- Fixed quantity uses `{ type: 'fixedQty', quantity: number }` with instrument-step validation. Risk percent, allocation percent, basis points, price points, ATR multiples, and reward/risk multiples remain distinct units.
- Quantity must respect instrument quantity step and cash constraints including estimated fees.
- Store a versioned `executionPolicy` describing signal timing, fill timing, intrabar ambiguity, gap handling, slippage, final liquidation, and supported directions.
- Initial v2 execution policy: `next_open_long_cash_v1` described below.
- A legacy strategy requesting short-only, limit, or square-off semantics cannot be silently downgraded. It either migrates to a supported policy with explicit user review or is rejected as unsupported.

## 4. Data contracts and provenance

### 4.1 Canonical market series

A provider adapter returns a discriminated outcome, not an empty array or fabricated success:

```ts
type DataOutcome<T> =
  | { ok: true; data: T; provenance: DataProvenance; warnings: DataWarning[] }
  | { ok: false; code: DataErrorCode; retryable: boolean; message: string };
```

`DataProvenance` must contain:

- source ID and adapter version;
- `mode: 'live' | 'delayed' | 'historical' | 'demo'`;
- provider observation/as-of time and local fetched-at time, separately;
- requested interval and actual available interval;
- exchange timezone, currency, and timeframe;
- adjusted/unadjusted/unknown corporate-action policy;
- data checksum and count;
- completeness summary, freshness state, and limitations;
- universe membership basis: `current`, `point_in_time`, or `unknown` where relevant.

These dimensions are orthogonal. For example, historical data can be complete, stale in cache, and based on a current rather than point-in-time universe. Do not compress everything into a misleading single "verified" flag.

### 4.2 Bar representation

- Represent UTC instants as ISO-8601 strings or integer epoch milliseconds consistently. If numbers are used, name them `timestampMs`.
- Store `sessionDate` as an exchange-local calendar date, not a browser-local date or a UTC string split used indiscriminately.
- Document whether timestamps represent interval start or interval end. Preserve both `startTime` and `endTime` if needed to prove data availability at decision time.
- Sort ascending, reject duplicates/conflicts, and validate finite OHLCV, nonnegative volume, high >= max(open, close, low), low <= min(open, close, high).
- A missing bar is not a zero-volume flat bar unless the provider and venue explicitly identify a nontrading interval.
- Exclude unclosed candles from historical signals by default. Future timestamps relative to the request's cutoff are rejected.
- Do not invent intraday candles from daily OHLC. Do not interpolate OI, bid/ask, or option Greeks into observed fields.
- Keep execution-price adjustment and total-return research separate. Never mix adjusted close with unadjusted open/high/low in one execution series.

### 4.3 Cache contract

Cache key includes provider, instrument ID, timeframe, requested range, adjustment policy, and adapter/schema version. A response's provenance is cached alongside its values. Add bounded entries/bytes, TTL by dataset type, and in-flight request deduplication. Do not cache provider failures as valid market data. A stale-cache fallback is allowed only when explicitly requested and marked stale.

Never incorporate API keys, credentials, raw tokens, or user identifiers into logged cache keys. If data is scoped per account, use an internal scope identifier and keep caches isolated.

## 5. Backtest semantics to lock before implementation

The baseline engine is not the specification. P09-P12 must implement this policy and record the policy version in each result.

### 5.1 Event ordering for `next_open_long_cash_v1`

For bar `t`:

1. Use only information available before this bar's open to process a pending signal from the prior closed bar.
2. For an existing position, process opening gap breaches of previously active stops/targets first. A long protective stop gapped through fills at the open minus adverse slippage, not at the old stop. Use a conservative target policy: fill at the target if already exceeded at the open, rather than assuming price improvement.
3. Process a pending rule exit at the open if a position remains. Do not immediately reverse or reenter on the same bar after an exit in the initial policy.
4. Process a pending entry at the open if flat, eligible, and sufficiently funded. Determine actual fill with slippage, then size and set risk levels using information known at that moment.
5. Use the stricter (higher) of the active fixed and trailing long stops as the effective protective stop. Evaluate active intrabar stop/target levels against the bar range. If both could have been hit and path is unknown, choose the adverse outcome. Record an ambiguity flag/counter in results.
6. A trailing level derived from bar `t`'s high is active starting at bar `t+1`, not retroactively inside bar `t`. This prevents using the same bar's high before an earlier low without a known price path.
7. Mark the portfolio at the close and record cash, position value, fees, realized PnL, unrealized PnL, equity, and drawdown.
8. Apply the drawdown circuit breaker at the close. It halts new entries and schedules any necessary liquidation for the next available open. State explicitly that the configured threshold is not a guaranteed maximum realized loss.
9. Evaluate entry/exit rules using the now-closed bar. Queue eligible signals for `t+1`. A last-bar signal has no next-open fill.
10. End of data: mark remaining positions and, if `liquidateAtEnd` is true, close at the final close with adverse slippage and fees, label `END_OF_DATA`, and update the final equity point after liquidation. This is a simulation boundary, not an actionable same-close signal.

Start with one position per instrument, no pyramiding, no leverage, no partial fills, no dividends unless a verified corporate-action model supplies them. State these limitations in the result. Synthetic fixture tests may intentionally model these simplified assumptions.

### 5.2 Cash and trade ledger

Cash-funded long accounting:

```text
entry cash change = -(quantity * entryFillPrice) - entryFees
exit cash change  = +(quantity * exitFillPrice) - exitFees
gross PnL         = quantity * (exitFillPrice - entryFillPrice)
net PnL           = gross PnL - entryFees - exitFees
equity            = cash + quantity * markPrice
```

Fill-price slippage is already in gross PnL. An informational slippage estimate must not be subtracted a second time. Reconcile at run completion: final equity - initial equity equals realized net PnL plus remaining unrealized PnL, within the documented monetary tolerance.

Reject unaffordable orders rather than creating hidden negative cash. If a fixed-fraction/fixed-risk quantity exceeds available funds, reduce quantity to the greatest affordable valid step and report the constraint; fixed-quantity requests should fail visibly or use an explicitly selected resize policy.

### 5.3 Costs

Use a versioned `FeeSchedule` with venue, asset/product type, effective-from/to dates, source references, verification date, units, side applicability, rounding rules, minimums/caps, and tax bases. Do not ship guessed current Indian statutory rates.

Calculate charges per fill and aggregate the same ledger entries into the trade log and waterfall. Account for buy/sell asymmetry and brokerage caps. Keep flat brokerage, percentage brokerage, and taxes separate. Broker-specific DP/delivery or other charges must either be supported and labeled or be listed as excluded, not silently represented as complete all-in trading cost.

An unverified fee schedule is visibly approximate and cannot produce an unqualified realistic-cost claim. P11 fixtures must use dated declared schedules, not network lookups.

## 6. Metrics and robustness

### 6.1 Metric conventions

- All presentation percentages are derived from decimal internal returns with explicit conversion at the API/UI boundary.
- Net returns use after-fee marked equity including idle days. Construct a daily equity series at exchange session close before annualized Sharpe/Sortino calculations; do not multiply intraday bar returns by a daily annualization constant.
- Use actual elapsed calendar time for CAGR: `(final / initial) ** (365.2425 / elapsedDays) - 1`. Return a structured unavailable value for zero duration, nonpositive starting equity, or other undefined domains. Short-horizon annualization gets a warning.
- For daily Sharpe, use sample standard deviation (N-1), a declared annualization factor (default 252 for the initial supported daily research convention), and an explicit annual risk-free input converted as `(1 + annualRiskFree) ** (1 / annualizationFactor) - 1`. Default risk-free input is zero, visibly recorded rather than assumed to be a current market rate.
- For Sortino, use the explicitly configured daily target (default zero) and downside deviation `sqrt(sum(min(return - target, 0)^2) / N)` across all return observations. Do not switch to a downside-days-only denominator.
- Maximum drawdown uses the full marked equity path and running peak, not only closed trades.
- Benchmark observations are aligned on the same usable sessions, currency, adjustment basis, and requested window. Fetch additional warmup data without adding it to reported performance.
- Alpha/beta use aligned daily excess returns with at least two observations and nonzero benchmark variance. Beta is covariance divided by benchmark variance; daily alpha is `mean(strategyExcess - beta * benchmarkExcess)`, annualized arithmetically by the declared session factor and explicitly labeled as annualized regression alpha. Flag weak short samples. Expose which benchmark was used. A traded asset's buy-and-hold baseline is not automatically a market index benchmark.
- Undefined metrics are `null` plus a reason such as `NO_TRADES`, `ZERO_DOWNSIDE`, `INSUFFICIENT_OBSERVATIONS`, or `NONPOSITIVE_EQUITY`. Do not encode Infinity, NaN, or sentinel 999 values in JSON.
- Break-even trades are neither wins nor losses; define the win-rate denominator as all closed trades and document that choice.

### 6.2 Robustness claims

Separate these concepts in types and UI:

1. **Chronological holdout:** evaluate a fixed strategy on disjoint train/test intervals. No optimization claim.
2. **True walk-forward:** perform bounded parameter selection only within each training window, freeze the winner, then evaluate the immediately following out-of-sample window. Chain nonoverlapping OOS windows. This is optional after a correct holdout implementation.
3. **Monte Carlo experiment:** record method, random seed, sample size, sample source, costs treatment, and assumptions. Shuffled fixed trade PnLs can analyze path risk but do not create a meaningful range of terminal PnL under additive fixed sizing.
4. **Sensitivity:** specify exact indicator parameter IDs and variants, rerun the same engine on the same immutable data, and report failed/invalid cells rather than inserting zero. Separate in-sample exploration from untouched holdout evaluation.

Default first release: deterministic daily-net-equity-return bootstrap with replacement plus a clearly labeled fixed-policy chronological holdout. Bootstrap horizon equals the observed return count unless explicitly configured otherwise; label steps rather than pretending sampled points retain real historical dates. Use documented nearest-rank quantiles, record the RNG algorithm/version/seed, and report IID/resampling limitations. No-trade input is unavailable for a trade-strategy robustness claim; very short samples carry warnings.

For the default 70/30 holdout, let N be the bars in the selected evaluation range, excluding extra indicator warmup, and k = floor(0.7 * N). Training trades on [0,k), testing on [k,N). Both start with the declared initial capital and no carried positions/orders. Training finalizes at its own boundary. Test indicators may use earlier history for warmup, but the first test signal is evaluated at the first test bar's close, never a carried training signal. Reject windows too short to compute the requested metrics.

Avoid overfitting labels based only on unstable ratios with near-zero or negative denominators. Return diagnostics and sample-count warnings rather than unsupported confidence scores.

## 7. API and job contracts

### 7.1 Envelope

Success/error envelopes have explicit schema versions and request IDs:

```ts
type ApiError = {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
    fieldErrors?: { path: string; message: string }[];
  };
};
```

Use 400 for malformed syntax, 422 for invalid/unsupported strategy semantics, 401/403 only when access control is actually enabled, 404 for absent resources, 409 for revision/state conflicts, 413 for oversized input, 429 for budget/rate limits, and 502/503/504 for provider/dependency failures as appropriate. Never return raw provider bodies, stack traces, secrets, or fake-success payloads.

### 7.2 Proposed routes

- `GET /api/v2/capabilities`: sources configured, supported intervals/features, demo status, engine/schema versions. No credentials.
- `POST /api/v2/backtests`: validate and enqueue. Accept strategy snapshot, date range, initial capital, dataset policy, benchmark, robustness options, and optional idempotency key. Return 202 and `jobId`.
- `GET /api/v2/jobs/:id`: queued/running/succeeded/failed/cancelled state, stage, bounded progress, timestamps, result reference or typed error.
- `DELETE /api/v2/jobs/:id`: idempotent cancellation request. Terminal jobs stay terminal; cancelling a queued/running job is explicit.
- `GET /api/v2/backtests/:id`: immutable result and reproducibility manifest. Paginate/lazily load large bars/trades through subresources.
- `POST /api/v2/scans`: bounded scan job with universe snapshot, as-of date, strategy, and truthful coverage.
- `POST /api/v2/ai/proposals`: draft-only structured strategy proposal with warnings and provider/method metadata.
- Strategy CRUD routes are added only in the durable-storage stage and require the chosen exposure/ownership policy.
- `GET /health/live` and `GET /health/ready`: fast local health. They must not log into a broker or call a paid AI/provider API on every probe.

Keep legacy routes during one transition release using explicit adapters to the new service layer. Do not maintain two independently evolving engines. Version the public payloads and update UI consumers in the same integration slice.

### 7.3 Job behavior

State machine: `queued -> running -> succeeded | failed | cancelled`. Cancellation may pass through `cancelling` if the worker needs an acknowledgment. State transitions are atomic and terminal states do not change except for explicit retention deletion.

- Client supplies or receives a stable job identity. Duplicate retries do not schedule repeated expensive work when an idempotency key and identical request hash match.
- Request parsing and validation happen before enqueueing. The worker receives normalized immutable inputs, never an Express request or secret-bearing config dump.
- Start with one worker and a small bounded queue on constrained hosting. Record benchmarked defaults before increasing concurrency.
- Limits include symbols per scan, candles per run, indicator/rule count, robustness iterations, sensitivity cells, wall time, output bytes, queued work per client, and memory budget.
- Cancellation is checked between symbols/simulations/batches. If CPU work cannot yield safely, terminate and replace the worker without corrupting persisted job state.
- Do not promise persistence across restarts until P19 is complete. Before then report restart-lost jobs explicitly. With durable storage, recover queued work or mark interrupted running jobs with a restart reason and explicit retry policy.

## 8. Storage and workspace migration

### 8.1 Local saved strategies first

Introduce a `StrategyRepository` interface with a versioned local adapter. Namespace storage, validate on read/write, retain a backup of the legacy value before migration, handle parse/quota errors, and expose export/delete actions. Saving is explicit and success appears only after persistence succeeds.

### 8.2 Optional durable single-user server mode

Default durable adapter: SQLite on an explicitly configured persistent volume for one service instance. Do not place durable SQLite data on an ephemeral deployment and call it reliable. If the hosting setup has no persistent disk, keep local-only persistence and provide downloadable immutable result exports until a deployment decision is made.

Minimum logical records:

- `strategies`: ID, owner scope if enabled, current revision, timestamps, deletion marker;
- `strategy_revisions`: immutable AST JSON, schema version, canonical hash;
- `jobs`: normalized request, status, execution timestamps, failure reason, result ID;
- `runs`: strategy revision/hash, engine version, data checksum/provenance, fee schedule, execution policy, seed, metrics, artifact references;
- `schema_migrations`: applied migration IDs and timestamps.

Keep large datasets separate from frequently queried metadata. Apply retention limits and export-before-delete guidance. Back up and rehearse restore before calling server storage production-ready. Concurrent edits use revision checks and return 409 rather than last-write-wins data loss.

PostgreSQL and multi-user ownership are optional P33, not an implicit dependency of the first hardening release.

## 9. Frontend state and interaction contracts

Separate editable strategy state from immutable run state. Editing the builder does not mutate an already rendered result. Show the strategy revision/hash used for each run and a clear "inputs changed since this run" state.

A typed API layer handles base URL, schemas, timeout, cancellation, request IDs, and errors. Each request key includes all inputs affecting its result. An older request may not replace a newer selection. On failed refresh either clear data or retain it with a persistent stale/error banner and its original as-of time.

Every major view supports loading, empty, partial, success, unavailable, stale, error, and cancelled states where applicable. Do not display zero as a substitute for unavailable values.

- Builder: field-path validation, visible units, indicator dependency checks, supported capability hints, undo/cancel for proposal application, accessible import/export.
- Results: reproducibility metadata, data-quality banner, cost assumptions, unsupported limitations, benchmark identity, metric reasons, unambiguous date/currency formatting.
- Scanner: requested vs actual coverage, historical as-of cutoff, current-vs-point-in-time universe warning, null rather than invented derivatives, explicit partial completion.
- Copilot: draft/validate/preview/diff/apply workflow. It cannot run, save, or trade merely because provider text requests it.
- Comparison: normalize date range, starting capital, currency, engine/policy, fees, and data basis, or show an incompatibility explanation. Name-only comparisons are not sufficient.

## 10. Security and exposure modes

Default no-credential demo mode can be public but must have strict compute/body/rate limits. Provider-backed and durable write endpoints require a documented exposure decision: private single-user deployment behind authentication, or a separately implemented multi-user system.

Never embed server API keys in browser bundles. Do not send broker credentials to AI services. Request/exception logs must redact authorization, session tokens, broker identifiers, TOTP material, and AI keys. Configuration status returns booleans/capabilities, not values.

AI prompts and outputs are data, not executable instructions. Use an allowlisted strategy schema, bounded response size, model timeout, structured validation, and explicit user application. Never evaluate generated JavaScript, Python, shell commands, URLs, or broker payloads.

Use same-origin APIs by default; do not add wildcard CORS as a shortcut. If cookie authentication is added later, add CSRF protection and secure cookie policy then. Content Security Policy must be tested against the actual compiled app, not pasted with unsafe wildcards.

## 11. Reproducibility manifest

Every completed v2 run exports:

- run/job IDs and creation/completion times;
- canonical strategy and schema/revision/hash;
- engine version and source build commit;
- exact execution-policy version;
- source, adjustment policy, actual range, calendar version, data checksum/count, and quality limitations;
- initial capital, currency, fee schedule/version, slippage model, benchmark configuration;
- random seed and robustness method/configuration;
- result schema version, nullable-metric reasons, trade/ledger reconciliation summary;
- optional fixture/data reference sufficient for a local rerun, subject to data licensing.

Timestamps and generated IDs may differ between reruns. Mathematical results for the same manifest and dataset must be identical within documented tolerances.
