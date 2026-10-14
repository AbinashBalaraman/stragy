# Stragy upgrade: evidence-based baseline audit

Reviewed 2026-10-13. Repository: <https://github.com/AbinashBalaraman/stragy>.

Pinned review baseline: [`163a80c6d603eec2bed28a7e9220b6a867e8dac7`](https://github.com/AbinashBalaraman/stragy/tree/163a80c6d603eec2bed28a7e9220b6a867e8dac7).

## 1. What was actually inspected

The public main-branch source archive contained 60 files. Its ZIP revision comment matched the commit above. Inspection covered root build/deployment configuration, shared strategy types/schemas/templates, the quantitative engine, provider/data code, AI routes/adapters, and frontend workflows. Independent read-only reviews covered engine correctness and frontend behavior. API/data/security findings combine a partial independent review with direct follow-up source inspection.

No application dependencies were installed. No build, unit test, backtest, provider request, AI completion, broker login, or live order was executed. Findings marked confirmed are source-level findings, not claims of runtime reproduction. Statutory fee accuracy, provider licensing, real feed availability, and live deployment state remain unverified.

The configured workspace initially contained only an empty `src/python` directory. The inspected application is actually TypeScript/React/Express. No existing upgrade-plan or test files were present in the archive. This package is a new implementation plan grounded in the repository, not an expansion of an unseen prior plan.

## 2. Existing architecture and assets worth preserving

- React 19 frontend, Vite, Tailwind CSS, Recharts, and TypeScript.
- Express entrypoint in `server.ts`, bundled with esbuild.
- Shared strategy AST, templates, schema/repair functions, and human-readable rendering.
- Pure indicator implementations and a single-symbol backtest engine that can be refactored rather than discarded.
- Existing builder, results, scanner, comparison, library, and copilot screens.
- Provider/instrument lookup work in `src/server/data`.
- Render deployment configuration and GitHub workflows, although the install/start contracts need correction.

Important: presence of a type, UI control, provider function, or README claim does not establish that the corresponding financial behavior is implemented correctly.

## 3. Findings: foundation and security

### B01. Reproducible install and behavioral verification are missing

**Confirmed, release blocker.** `package.json:6-13` has no test script; `lint` runs only `tsc --noEmit`. `.github/workflows/ci.yml:17-29` configures Node 22, npm cache, and `npm ci`, but the archive contains `bun.lock` and no `package-lock.json` or npm shrinkwrap. This is a static lockfile/CI mismatch; the failing command was not executed here.

`tsconfig.json:2-24` does not enable TypeScript `strict`, despite the contribution guide's strict-types language. There are no discovered unit/component/E2E test files.

**Plan:** P00, P01. Establish one package manager/runtime and executable offline tests before touching financial logic.

### B02. Production startup and configuration are not a clean deployment contract

**Confirmed.** `start.js:8-22` builds automatically when artifacts are missing; `start.js:26-29` launches a child process with limited signal/exit handling. `render.yaml:5-12` uses free hosting, `npm install`, and a constrained Node heap. README, `.env.example`, and implementation must be reconciled for supported runtime and broker/TOTP variable names.

**Plan:** P02, P28. Build once before deployment, fail clearly on missing artifacts, document supported optional capabilities, and test shutdown behavior. Do not solve constrained hosting by hiding failures with retries or keep-alive pings.

### B03. Credential-shaped fallback exists in AI source

**Confirmed source exposure; validity untested.** `src/server/ai/copilot.ts:10` contains a hard-coded credential-shaped fallback. Its value is intentionally not reproduced in this plan and must not be copied into tests, issues, logs, or model prompts.

**Immediate owner action:** treat the value as exposed, revoke/rotate it with the issuing provider, remove the fallback, inspect provider usage, and check repository history. Removing the latest line is not equivalent to revocation. History rewriting, if chosen, is a separate coordinated repository operation. Do not test whether the value works.

**Plan:** P02 first, then P26. New code reads only server-side environment configuration, and missing keys disable capabilities rather than activating a fallback credential.

## 4. Findings: strategy language and engine

### B04. Runtime schema, types, templates, builder, and engine disagree

**Confirmed, release blocker.** `src/shared/strategy/types.ts:5` and the default template include `VOLUME_SMA`; `schema.ts:4-12` and indicator dispatch in `src/server/backtest/indicators.ts:274-305` do not consistently support it. `StrategyBuilder.tsx:33,442-477` uses MACD `fast/slow/signal`, while templates, schema repair, and descriptions use `fastPeriod/slowPeriod/signalPeriod`.

`schema.ts:35-49` allows unbounded numeric parameter records and ambiguous operands. Referenced outputs, reserved price names, generated output collisions, and sizing-specific required fields are not established as one executable contract.

**Plan:** P03, P08, P21. One indicator/output registry, strict semantic validation, explicit legacy alias migration, and every bundled template covered by tests.

### B05. Repair can invent trading behavior instead of validating it

**Confirmed, release blocker.** `schema.ts:114-256` returns a repaired cast; `181-182` defaults a missing operand to zero; `194-200` invents entry logic when missing; `259-276` repairs before validation. `src/App.tsx:28-40,168-190` and copilot extraction paths use repair directly. Duplicate-ID renaming does not reliably repair references.

**Plan:** P03, P16, P18. Separate strict validation, recognized-version migration, and user-reviewable repair suggestions. Invalid input must not become a different executable strategy under the label "validated".

### B06. Protective exits are deferred touch signals

**Confirmed behavior, release blocker under normal stop/target expectations.** `engine.ts:241-250` sets pending exits when a stop/target is touched; `125-126` executes the pending exit at the following open. `228-246` raises trailing levels using the current high before checking the current low. A final-bar touch can become an end-of-data exit.

This is not a resting protective order simulation. OHLC path ambiguity requires an explicit convention, not an implicit optimistic choice.

**Plan:** P09. Use declared gap handling, stop-first ambiguity, next-bar-effective trailing updates, and next-open rule exits. The new policy intentionally changes results and requires an engine version bump.

### B07. ATR risk initialization looks ahead

**Confirmed.** Entry uses current bar open at `engine.ts:160`, but stop/trailing initialization reads current-index `atr14` or current close at `182,205`. ATR at that index includes the bar's complete high/low (`indicators.ts:79-99`). The magic indicator ID also does not establish the intended risk dependency.

**Plan:** P08-P10. Explicit private ATR dependency and period; use the previous completed bar at entry; no fabricated percentage-of-current-close fallback. Full-series causal precomputation itself is not the defect; consumption timing is.

### B08. Three accounting paths disagree

**Confirmed, release blocker.** `engine.ts:128-135` normal exits use one cost path; `172-173` entry subtracts principal without entry fees; `296-320` terminal liquidation creates a trade without reconciling final cash/equity; `423-430` adds a separate Indian cost calculation after headline metrics. `indianCosts.ts:45-78` includes additional costs not charged consistently to the account.

Consequences include disagreement among final equity, sum of trade net PnL, and the displayed cost waterfall; taxes need not affect drawdown or position affordability correctly.

**Plan:** P10-P12. One executed-fill ledger and one settlement path for every exit reason. Final equity, trade PnL, and cost components must reconcile.

### B09. Exposed execution and sizing controls are ignored or incomplete

**Confirmed.** `engine.ts:85-89` loads daily bars regardless of selected timeframe; `259-261` always enters long; short/limit/square-off policies have no complete implementation. `163-169` fixed-risk sizing falls into a fixed-allocation branch and can force a minimum share. Points trailing, ATR ratcheting, and activation are incomplete despite being accepted fields.

**Plan:** P03, P04, P09-P10. Reject unsupported combinations immediately; only enable settings with tested semantics. Do not fix shorts by changing a direction label.

### B10. Metrics contain placeholders and inconsistent definitions

**Confirmed.** `engine.ts:378` fixes beta to 0.85; `377` mixes incomparable return definitions for alpha; `334-335` estimates years from bar count with an arbitrary duration floor; `367-369` treats observations as daily. No-loss/degenerate metrics use finite sentinels at `331,364,393` and robustness equivalents. Holding-day fields count bar indices in some paths.

**Plan:** P12. Pure metrics from corrected marked equity, real aligned benchmark regression, elapsed-time CAGR, daily annualization, named units, and nullable undefined values with reasons.

### B11. Sensitivity heatmap values are generated rather than simulated

**Confirmed, release blocker.** `robustness.ts:202-205` receives no bars/simulator. `238-242` applies quadratic factors and sine noise to base metrics. Axes can invent an absent take-profit and label non-percent risk types as percentages.

**Plan:** P13. Remove synthetic analytics immediately. Rerun the real simulation core for each valid parameter cell, using identical immutable input data. Until implemented, show unavailable, not a plausible heatmap.

### B12. Holdout and Monte Carlo are not valid as currently presented

**Confirmed implementation gaps.** `robustness.ts:116-121` partitions full-run trades by entry date, allowing a trade's later exit PnL into training. `134-169` reuses full-run dollar PnLs with a hard-coded capital base and trade-only metric approximations.

Monte Carlo uses at least 20 sampled trades (`40`) even when fewer exist, unseeded randomness (`55`), and label lengths derived from actual trades (`99`). Empty/degenerate cases can appear risk-free rather than unavailable. The two 10% factors in the current implementation cancel; this audit does not assert a tenfold-leverage bug.

**Plan:** P13. Independent chronological windows, causal warmup, common metric code, seeded bootstrap with explicit horizon and methodology, and truthful holdout versus walk-forward naming.

## 5. Findings: frontend integrity and workflows

### B13. Scanner selection can run the previous symbol; requests can overwrite newer work

**Confirmed.** `src/App.tsx:98-121,341-347` calls a state-changing symbol handler then immediately runs using the old render's captured state. Normal, initial, and AI run paths (`113-165,182-245`) share result/loading state without request ownership. Comparison inspection can update strategy without global symbol (`333-336`).

**Plan:** P20. One explicit run command accepting an immutable strategy/symbol snapshot; revision/job identities; stale-response rejection; no completion-driven unexpected navigation.

### B14. Autosave can lose edits and claim success after failure

**Confirmed.** `StrategyBuilder.tsx:84-100` owns a delayed saver that is cancelled when the tab unmounts; `src/App.tsx:317-324` mounts it only on Builder. Storage failures still set saved state (`StrategyBuilder.tsx:93-95`) and the badge is unconditional (`245`). Strategy and symbol are stored separately.

**Plan:** P18, P20. App-level atomic versioned workspace persistence, real dirty/saving/saved/error states, validated restore, and legacy backup before migration.

### B15. Active builder cannot faithfully represent shipped strategies

**Confirmed.** `StrategyBuilder.tsx:38-44,537-703` omits candle-derived operands and compound indicator outputs used by templates. `131-137` deletes indicators without reference repair; `204-210` prevents removal of the final exit rule. `751-859` presents risk variants as percentages and displays numeric defaults for null/disabled controls.

Richer separate control files exist but are not wired into the active builder. Editing only those unused components would not fix the real screen.

**Plan:** P21. Registry-driven operands, dependency-aware deletion, discriminated risk controls, explicit disabled states, and no-op roundtrip tests for every template.

### B16. Chat intent handling can apply/run unintended proposals

**Confirmed.** `AiCopilotDock.tsx:372-478` prioritizes broad variation matching; phrases containing "first" can select a variation before ordinary conversation handling. Apply-and-run calls in multiple paths are not awaited. Reset does not invalidate pending work (`889-902`); loose JSON extraction can treat incomplete content as an executable strategy.

**Plan:** P16, P24. Structured draft proposals with IDs/revisions, explicit preview/apply, narrow action parsing, awaited run outcomes, and cancellation/reset generation checks. Default copilot must not execute merely because a message contains an ordinal or the word backtest.

### B17. Comparison wiring is blocked and run identity is ambiguous

**Confirmed.** `ResultsDashboard.tsx:183-192` passes `activeResult`; `StrategyComparisonView.tsx:334-343` guards on `currentResult`, so the normal path can show no active simulation. Subsequent logic deduplicates by strategy ID (`90-104`), uses index-based visibility (`84,327-331`), and reruns do not consistently replace the active result (`302-315`). Intraday points are merged by date string (`136-159`).

**Plan:** P22. One active-result prop, distinct strategy/revision/run/comparison IDs, compatible-run checks, stable series identity, timestamp-aware alignment, and isolated parameter experiments.

### B18. Scanner date and request context are inconsistent

**Confirmed.** `MarketScannerView.tsx:127-199` commits independent requests without stale-result guards; `/api/scan` gets no selected date (`176-184`); derivative child panels receive no historical context (`1010-1026`). Error and empty states can be conflated. `TradingCalendarModal.tsx:407-441` restricts navigation to August 2025-August 2026 despite dynamic bounds, and hard-coded fallback session text appears elsewhere.

**Plan:** P07, P14-P15, P23. One session-date model, request keys including date/universe, actual provider coverage, and per-panel historical capabilities. Latest-only features must say so during historical browsing.

### B19. Result and status labels are not consistently driven by data

**Confirmed.** Results fail to pass `indicatorsData` to PriceChart (`ResultsDashboard.tsx:167-172`); capital/timeframe/simulation counts are hard-coded in result components. `Navbar.tsx:168-179` can show SMARTAPI ACTIVE despite default disconnected status. `GttBracketCalculator.tsx:229-231` includes unjustified profit/risk guarantees. Template descriptions and advertised expected performance are not uniformly tied to actual rules or measured runs.

**Plan:** P22-P24, P30. Correct chart wiring and units, unavailable metric explanations, actual connectivity/provenance, AST-derived descriptions, and removal of guarantees/unverified performance claims.

### B20. Accessibility and responsive layout need structural changes

**Confirmed source gaps; exact layout requires browser testing.** Inputs lack associations, calendar/drawer lack dialog focus handling, symbol results use clickable divs, and sorting relies on nonfocusable headers. `Tooltip.tsx:11-26` never changes visibility from false. `src/App.tsx:266-311` can mount a fixed-width copilot dock and a second mobile copilot with independent state.

**Plan:** P25. Shared accessible primitives, one copilot controller with responsive presentations, keyboard workflows, chart alternatives, narrow-screen and zoom tests.

### B21. Saved library and full import/export are additions, not completed capabilities

**Confirmed gap.** The library loads static templates, not a saved-strategy collection. Builder transfer currently copies JSON, without a full file/paste importer and versioned migration preview. Comparison results are held in app memory. Clipboard success is not consistently awaited.

**Plan:** P18-P19, P21-P22. Local-first saved revisions, safe transfers, immutable result exports, and optional durable storage only when deployment supports it.

## 6. Findings: API, providers, and operational exposure

### B22. Synthetic fallback bars are served as authentic data

**Confirmed, release blocker.** `realMarketData.ts:178-203` returns generated bars on cache miss and may asynchronously overwrite them with provider data. `371-440` constructs 250 bars from baseline prices, sine/cosine variation, and generated volume. `mockData.ts:4-8` describes its wrapper as authentic. Provenance is not retained per dataset, so identical requests can use different series depending on fetch timing.

`realMarketData.ts:137` refreshes only the first 75 entries. `symbols.ts:7` aliases NSE_SYMBOLS to all symbols; `9-10` silently maps unknown IDs to the first symbol. Provider mappings also need verification: the reviewed ZOMATO mapping points to a different ticker, and an already-encoded ampersand mapping is encoded again by the URL builder.

**Plan:** P05-P07, P14. Explicit demo adapter, immutable run data, provider-aware cache, not-found IDs, audited mappings, and truthful coverage.

### B23. Historical requests can resolve to future/latest data

**Confirmed.** `smartApi.ts:490-503` initializes the target to the latest bar; dates preceding all bars leave that index unchanged. `realMarketData.ts:357-365` snaps dates before coverage to the oldest available date, later than the requested cutoff. Generated calendar sessions do not prove dataset availability.

**Plan:** P07, P14, P23. Separate calendar sessions from data coverage. Out-of-coverage requests return unavailable, not future prices. Backward snapping must never cross forward beyond an as-of cutoff.

### B24. Derivative fields and telemetry are modeled, not observed

**Confirmed.** `smartApi.ts:608-622` synthesizes OI/PCR from price/volume/RSI; `661` labels sources from cached authentication rather than bar origin. `886-922` supplies fixed latency/counts and streaming-like states. `976-1132` models options; `1169-1286` models volume-profile/VWAP fields; `1400-1456` models futures spreads. The GTT function at `1311-1378` is a calculator/payload preview, not live execution.

**Plan:** P05, P15, P23-P24. Mark model/demo outputs explicitly or disable them in real-data mode. Observed OI, contracts, bid/ask, aggressor volume, latency, and streaming require actual sources/measurements. Keep GTT preview-only.

### B25. Invalid requests can become successful unrelated results

**Confirmed.** `server.ts:297-307` generates a default backtest under a missing requested ID instead of 404. `313-321` substitutes a default strategy after failed scan validation. `440-445` saves unchecked bodies. Request parsing/defaults and error shapes are inconsistent.

**Plan:** P03-P04, P19. Strict route schemas, typed errors, no substituted strategies/symbols/runs, and validated writes.

### B26. Compute/storage are unbounded at API boundaries

**Confirmed design gap.** `server.ts:25-26` uses in-process Maps without durability/retention. Backtest/scanner computation is synchronous in web handlers. JSON bodies allow 10 MB (`37`); inspected routes have no application-level authentication or rate limiting. Scanner stops at its match limit (`scanner.ts:110`), swallows failures (`112-115`), and returns a live-stream label (`123`).

**Plan:** P14, P17-P19, P26-P27. Separate match pagination from scan coverage, bound queues/cache/history, add cancellation and compute budgets, document exposure, and make persistence truthful.

### B27. One AI credential is reused across provider fallbacks

**Confirmed.** `copilot.ts:121-173` tries OpenRouter, DeepSeek, and OpenAI while reusing one authorization value; the list includes models without free-tier suffixes. This can disclose a provider key to unrelated services and create unplanned paid fallback behavior.

`server.ts:395-405` ignores the live-scan prompt and uses a fixed template. `411-430` serves local/generic pattern text under a web-search route with authoritative-sounding labels, not actual web research.

**Plan:** P02, P16, P26, P30. Provider-specific keys/allowlists, explicitly selected provider/model, no automatic paid/cross-provider fallback, bounded budgets, and truthful heuristic/search labels.

### B28. Static root includes backend bundle and source map

**Confirmed configuration exposure path; live site not probed.** `package.json:8` emits `dist/server.cjs` plus a source map. `server.ts:469-474` serves all of `dist` via express.static. Without additional external restrictions, the app configuration permits requests for backend artifacts, potentially including the fallback credential.

**Plan:** immediate P00/P02 containment, then P26/P28 tests. Split `dist/client` from `dist/server`, serve only client assets, deny sensitive artifact paths, and never bundle fallback secrets. Do not probe production or print any real secret to verify this.

## 7. Interpretation limits

- This audit does not certify financial, legal, or regulatory suitability.
- README product claims are not accepted as evidence of behavior.
- Exact legal fees must be verified from authoritative sources for each effective date/product/venue.
- A provider adapter existing does not prove a working credential, subscription, entitlement, or data license.
- Historical scanning with current constituents remains subject to survivorship bias unless point-in-time membership is supplied.
- OHLC bars cannot reveal intrabar price order; the plan chooses conservative declared conventions rather than claiming to reconstruct it.
- New controls such as shorting, limit fills, portfolios, and live execution are intentionally deferred until their own tested contracts exist.

## 8. Useful immutable source links

- [Package scripts](https://github.com/AbinashBalaraman/stragy/blob/163a80c6d603eec2bed28a7e9220b6a867e8dac7/package.json#L6-L13)
- [CI workflow](https://github.com/AbinashBalaraman/stragy/blob/163a80c6d603eec2bed28a7e9220b6a867e8dac7/.github/workflows/ci.yml#L17-L29)
- [Strategy schema](https://github.com/AbinashBalaraman/stragy/blob/163a80c6d603eec2bed28a7e9220b6a867e8dac7/src/shared/strategy/schema.ts)
- [Backtest engine](https://github.com/AbinashBalaraman/stragy/blob/163a80c6d603eec2bed28a7e9220b6a867e8dac7/src/server/backtest/engine.ts)
- [Robustness implementation](https://github.com/AbinashBalaraman/stragy/blob/163a80c6d603eec2bed28a7e9220b6a867e8dac7/src/server/backtest/robustness.ts)
- [Frontend state/orchestration](https://github.com/AbinashBalaraman/stragy/blob/163a80c6d603eec2bed28a7e9220b6a867e8dac7/src/App.tsx)
- [Active strategy builder](https://github.com/AbinashBalaraman/stragy/blob/163a80c6d603eec2bed28a7e9220b6a867e8dac7/src/components/strategy/StrategyBuilder.tsx)
- [Scanner interface](https://github.com/AbinashBalaraman/stragy/blob/163a80c6d603eec2bed28a7e9220b6a867e8dac7/src/components/scanner/MarketScannerView.tsx)

For any file reference above, resolve it against this pinned commit. Line numbers may drift on current main; re-inspect before editing.
