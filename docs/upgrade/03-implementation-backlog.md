# Stragy upgrade: model-ready implementation backlog

**Status:** specification only. All tickets start NOT_STARTED. No code changes or test passes are implied by this document.

Core release: P00-P30. Optional later roadmap: P31-P34. Follow the explicit dependencies, not numeric order alone: notably P11 can precede P09/P10. Each ticket should become a reviewable change; split a large ticket into named sub-slices without changing its contract.

Common acceptance for every core ticket: current source inspected; intended behavior tested; no secrets/live provider dependency in ordinary tests; shared schemas and consumers agree; errors are explicit; unrelated work preserved; actual command results recorded. Read [contracts](02-architecture-and-contracts.md), [fixtures](04-testing-and-release.md), and [handoff rules](05-agent-handoff.md).

## P00. Establish checkout, reproducible build, and safe artifact boundaries

**Priority:** immediate blocker. **Depends on:** none. **Evidence:** B01, B02, B28.

**Existing files:** `package.json`, `bun.lock`, `.github/workflows/ci.yml`, `vite.config.ts`, `server.ts`, `start.js`, `render.yaml`, README. **New:** npm lockfile and runtime pin.

**Implement:**
1. Verify actual checkout/commit/dirty state. The planning workspace is not yet the source checkout.
2. Select npm, generate/review `package-lock.json`, declare package manager/runtime, and remove/deprecate the competing lock only after a clean install is verified. Do not hand-edit dependency resolution.
3. Align CI, local development, README, and deployment install commands. Keep dependency-major upgrades out of this ticket unless a build blocker requires one.
4. Emit browser assets to `dist/client`; emit server bundle/map to `dist/server`. Serve only `dist/client`. Update start paths and production smoke assertions together.
5. Replace Unix-only cleanup commands with a cross-platform script. Record baseline typecheck/build/start failures rather than hiding them.

**Verify/done:** fresh install works from lockfile; client/server outputs are separate; production-mode requests cannot retrieve server bundle/map or `.env`; build/start use documented paths. Runtime security patches are reviewed, not blindly assumed from a major version. Do not claim application correctness yet.

## P01. Install the offline test and quality harness

**Priority:** blocker. **Depends on:** P00. **Evidence:** B01.

**Existing:** package/CI/tsconfig. **New:** Vitest configuration, React Testing Library setup, HTTP integration harness, Playwright configuration, fixture directories, import-boundary check.

**Implement:** distinct `typecheck`, real `lint`, unit/integration/E2E/coverage/smoke scripts. Add a deterministic fixture loader, fake clock, deferred-response helper, network-deny test setup, and seeded random interface. Extract only the seams needed to import code without starting the web server or provider sync. Begin strict TypeScript on new/shared/domain code; track legacy exceptions explicitly rather than enabling strict and suppressing errors with `any`.

**Verify/done:** one meaningful passing and intentionally failing test demonstrated for each harness, then remove the intentional failure. CI runs the offline suite. No external credentials/network required. Existing startup is not triggered merely by importing domain modules. Define branch-coverage gates and test ownership.

**Out of scope:** rewriting mathematical behavior before regression expectations are reviewed.

## P02. Contain credentials and define safe runtime configuration

**Priority:** immediate security blocker. **Depends on:** P00; revocation advisory is immediate. **Evidence:** B02, B03, B27, B28.

**Existing:** `.env.example`, `server.ts`, `src/server/ai/copilot.ts`, `src/server/data/smartApi.ts`, README. **New:** `src/server/config.ts`, redaction helpers.

**Implement:** remove hard-coded credential fallback without reproducing its value. Record owner-required revocation/rotation and historical exposure handling. Create one Zod env parser for PORT, mode, selected AI provider/model, provider-specific keys, broker capability, timeouts, feature flags, and budgets. Honor configured PORT instead of fixed 3000. Never reuse one provider key across unrelated endpoints. Missing credentials disable dependent capabilities, not the offline app. Reconcile `SMARTAPI_TOTP_KEY` naming through a documented compatibility alias if necessary. Separate configured/authenticated/healthy/streaming states; do not log into a broker just to render static configuration.

**Verify/done:** config parsing tests; missing/invalid env tests; redaction tests with dummy secrets; no keys in client bundle/errors/status; unrelated providers never receive a key. Exposed-key revocation remains an explicit owner action, not falsely marked done by code removal. Add initial strict request/compute caps before any public deployment; P26 completes exposure hardening.

## P03. Freeze a canonical strategy v2 language and migration contract

**Priority:** correctness blocker. **Depends on:** P01. **Evidence:** B04-B05, B09, B15.

**Existing:** `src/shared/strategy/{types,schema,templates,renderPlainLanguage}.ts`. **New:** shared contract schemas, indicator definition registry, migration tests.

**Implement:** separate `schemaVersion` from strategy revision; derive types from schemas. Centralize indicator types, parameters, defaults, output names, units, and limits. Reconcile VOLUME_SMA and MACD aliases deliberately. Add structural plus semantic validation: unique IDs, reserved/output collisions, operand exclusivity, finite values, bounded integers, references, risk variant requirements, and execution capabilities. Split validate/migrate/propose-repair; never invent rules during validation. Preserve the verified legacy AND-entry/AND-exit aggregation; migrate legacy approximate equality explicitly; convert 0..1 allocation fractions to the declared v2 percentage field exactly once. Document any incompatibility. Canonical hashing must be deterministic.

**Verify/done:** every bundled template validates or receives an explicit documented supported migration; no-op roundtrip preserves meaning; malformed/unknown/future versions fail safely; conflicting aliases require review; missing right operand and duplicate-reference collisions fail. Test I07 and template-specific cases.

**Out of scope:** implementing short/limit/intraday capability merely to preserve an accepted but ignored field.

## P04. Extract app/routes and enforce request/response contracts

**Priority:** blocker. **Depends on:** P02, P03. **Evidence:** B25-B26.

**Existing:** `server.ts`. **New:** app factory, route modules, service interfaces, error middleware, shared API schemas.

**Implement:** keep `server.ts` as process startup; inject providers/clock/storage/job runner. Inventory every existing route and map to the v2 service contract. Validate body/query/path with budgets before work. Unknown symbol/run IDs return 404; unsupported strategy behavior returns 422; malformed JSON returns 400. Remove generated backtests under arbitrary missing IDs, scanner default substitution after invalid input, and unchecked strategy writes. Keep temporary legacy adapters to the same services. Add request IDs and sanitized structured errors; unknown API routes never return SPA HTML.

**Verify/done:** A01, malformed JSON, unknown IDs, invalid scan strategy, oversized input, unavailable provider, and response-schema tests. Route import never listens or fetches data. The compatibility adapter is documented, not a second engine.

## P05. Make provenance and capabilities truthful end to end

**Priority:** blocker. **Depends on:** P04. **Evidence:** B19, B22, B24.

**Existing:** `realMarketData.ts`, `mockData.ts`, `smartApi.ts`, shared types, status routes. **New:** `DataOutcome`, provenance/capability schemas, explicit demo provider.

**Implement:** move deterministic generated prices into a named demo adapter. Real mode never calls it implicitly. Carry source, mode, as-of/fetched-at, requested/actual range, adjustment, checksum, coverage, freshness, and limitations alongside every response/cache entry. Replace fake streaming/latency/count values with observed values or unavailable. Derive capabilities from configured, implemented, and verified functionality rather than marketing labels. Add a minimal persistent UI demo/unavailable banner as a vertical slice; detailed views follow later.

**Verify/done:** D01/D03/D08 and E01. A failed provider yields unavailable or explicitly requested stale real data, not synthetic success. An authenticated broker session cannot relabel Yahoo/demo bars as broker data. Exported results retain provenance.

## P06. Normalize provider data, instrument identities, and caches

**Priority:** high. **Depends on:** P05. **Evidence:** B22, B26.

**Existing:** `src/server/data/{realMarketData,smartApi,symbols,nseSymbolsData}.ts`. **New:** provider adapters, normalization/cache modules, instrument mapping fixtures.

**Implement:** canonical instrument IDs with explicit provider tokens and exchange/currency/precision. Unknown IDs must never resolve the first symbol. Verify suspicious ticker mappings without assuming a corporate rename; encode raw tickers exactly once. Validate OHLCV before caching; reject or quarantine missing/invalid prices instead of filling all OHLC with close. Add deadlines, bounded retries/backoff, in-flight deduplication, and bounded cache entries/bytes. Key data by provider/instrument/timeframe/range/adjustment/version. Cache invariant data separately from request-specific metadata such as `requestedDate`/`isSnapped`, so two requests resolving to one session do not inherit each other's labels. Freeze a dataset snapshot per run; background refresh cannot mutate it.

**Verify/done:** D02/D03 plus unknown-ID flood fixture, mapping/encoding tests, shared-request deduplication, stale/error behavior, and immutable checksum across a running backtest. No live request required.

## P07. Build a calendar and strict historical cutoff model

**Priority:** high. **Depends on:** P06. **Evidence:** B18, B23.

**Existing:** calendar/date functions in `realMarketData.ts`, historical index selection in `smartApi.ts`. **New:** exchange-session module and versioned calendar fixtures.

**Implement:** distinguish exchange sessions, completed bars, and actual per-instrument data availability. Use exchange-local session dates with UTC instants. Validate date syntax/range. Snap closed dates backward only with explicit requested/resolved fields; before coverage means unavailable, never oldest future data or latest bar. Calendar must not imply 250 sessions of data for every instrument. Remove hard-coded navigation bounds from backend-facing contracts. Version the source for holidays/special sessions; declare unsupported years/venues rather than invent certainty.

**Verify/done:** D04/D05, pre-coverage/future requests, weekends/holidays, duplicate/unsorted sessions, and different server/browser timezones. Changing future bars cannot change a historical response. Date-specific derivatives remain latest-only until actual historical data exists.

## P08. Correct indicator registry, warmup, and shared rule evaluation

**Priority:** blocker. **Depends on:** P03. **Evidence:** B04, B07.

**Existing:** `indicators.ts`, rule helpers in `engine.ts` and `scanner.ts`. **New:** pure rule/compiler module and typed risk-dependency resolver.

**Implement:** implement VOLUME_SMA correctly or consistently disable affected strategies pending implementation; prefer implementing the advertised simple volume average. Preserve named compound outputs. Reject invalid periods and output collisions before indexing. Return aligned null warmup arrays. Define EMA/ATR seeding, Wilder RSI, flat RSI convention, finite crossover behavior, and candle-derived operands. ATR risk computes its own declared dependency; an arbitrary user indicator ID cannot override it. Use one evaluator in scanner/backtest and protect price-field namespaces.

**Verify/done:** I01-I08, volume vs price SMA distinction, compound output references, and previous-bar ATR readiness. No provider fetching or React imports in the domain module. Prefix invariance excludes only explicitly synthetic end-of-data finalization, not ordinary signals/fills.

## P09. Implement causal order/fill timing

**Priority:** blocker. **Depends on:** P06, P08. **Evidence:** B06-B07, B09.

**Existing:** `engine.ts`. **New:** simulation-only core and execution event functions.

**Implement:** follow `next_open_long_cash_v1` in the contracts verbatim: closed-bar signals, next-open market entry/rule exit, existing gap protection first, same-bar active protective fills, adverse stop/target ambiguity, completed-bar trailing updates active next bar, no same-bar reentry, honest final-bar behavior. At entry use only previous completed ATR. Define effective long stop as the stricter active fixed/trailing level. Separate simulation from robustness so reruns never recurse into the suite. Record fill reasons, signal/fill timestamps, and ambiguity diagnostics. Reject unsupported directions/order/session policies.

**Verify/done:** Q01-Q05, Q08-Q10 and ATR causality fixtures. No future-high/close usage at an opening decision. Every intentional policy change bumps engine/execution versions.

**Sub-slices:** P09a event order; P09b stops/gaps/targets; P09c trailing/finalization. Do not mark the ticket complete after only ordinary market fills work.

## P10. Unify cash, sizing, risk, and settlement

**Priority:** blocker. **Depends on:** P09, P11. **Evidence:** B08-B09.

**Existing:** position/cash/risk sections of `engine.ts`. **New:** ledger and sizing modules.

**Implement:** per-fill entry/exit charges; cash-funded accounting; one settlement path for every exit. Define fixed fraction as percentage input with explicit conversion, fixed quantity with insufficient-funds error, fixed risk from pre-entry equity and executable stop distance plus estimated charges. Round quantity down to valid steps; never force one unit. Add points/percent/ATR trailing and activation only with completed-bar ratchets and explicit units, otherwise reject those variants until implemented. Drawdown halt is close-sampled with next-open liquidation and permanent entry halt for that run. Reconcile terminal liquidation and marked open positions.

**Verify/done:** Q06-Q09, zero/negative stop distance, insufficient ATR, tiny allocation, high fees, lot steps, fee-driven drawdown, and no negative cash. `finalEquity - initialEquity = realized net PnL + unrealized PnL` within declared tolerance. Slippage is not double counted.

## P11. Implement versioned per-fill costs and verify rate provenance

**Priority:** blocker. **Depends on:** P03. **Evidence:** B08 and fee-interface audit.

**Existing:** `indianCosts.ts`, cost types/editor. **New:** fee schedules and dated fixtures.

**Implement:** define fill-side/date/product/venue inputs and itemized output. Support flat/percentage/capped brokerage, side-specific levies, taxable bases, rounding, and explicit exclusions. Fees are charged by the ledger, not calculated only as a report after returns. Verify current/historical Indian rates against authoritative exchange/regulator/broker documents; store effective dates, source URLs, and verification dates. Do not certify unverified values. Preserve an explicitly approximate/custom schedule for research where appropriate. Distinguish price slippage from cash fees.

**Verify/done:** C01/C02, cap/minimum/buy/sell/date-boundary/rounding tests. Cost waterfall sums the same ledger entries. Missing or unverified schedule shows a warning and blocks an unqualified all-in-cost claim. Rate research can run in parallel with execution work, but fee interface must land before P10 completion.

## P12. Replace placeholder metrics with one reviewed metrics module

**Priority:** blocker. **Depends on:** P10. **Evidence:** B10.

**Existing:** metric calculations in `engine.ts` and `robustness.ts`. **New:** pure metrics/benchmark-alignment module.

**Implement:** use net marked equity, daily session returns, elapsed-time CAGR, sample-standard-deviation Sharpe, full-sample downside deviation, path drawdown, and aligned benchmark alpha/beta. Remove fixed beta, arbitrary ratio sentinels, duration/volatility floors, and ambiguous units. Use nullable values with reason codes. Distinguish holding bars from elapsed days. Configure benchmark, risk-free rate, currency, and annualization convention in the run manifest. Present no-trade and short-sample limitations.

**Verify/done:** M01-M04 plus exact ledger-to-metric reconciliation, timezone/session alignment, flat/negative-equity inputs, and same daily equity across different intraday granularities. No NaN/Infinity in JSON. UI compatibility adapter must preserve unavailable reasons rather than converting them to zero.

## P13. Replace fabricated robustness with reproducible experiments

**Priority:** blocker. **Depends on:** P07, P12. **Evidence:** B11-B12.

**Existing:** `robustness.ts`, engine orchestration, shared robustness types. **New:** seeded RNG and experiment schemas.

**Implement:** remove synthetic sensitivity cells immediately. Rerun the simulation-only engine for each valid cell, preserving units and no invented target. Use independent train/test windows with equal declared starting capital; training cannot consume test exits. Test indicators may warm up from past bars but no positions/pending orders cross the boundary. Default Monte Carlo resamples daily net equity returns with replacement, observed-length horizon, recorded seed, labeled step axis, and documented IID limitations. Keep optimization/holdout separate; do not call one split true walk-forward. Invalid/insufficient samples yield unavailable diagnostics, not overfitting certainty.

**Verify/done:** same-seed equality; one-return/one-step bootstrap; matching curve/label lengths; zero iterations rejected; changing test bars cannot change training; center sensitivity cell equals base run; no recursive robustness invocation. Performance is bounded. True walk-forward is optional P32.

## P14. Make scanning complete, historical, and coverage-aware

**Priority:** high. **Depends on:** P04, P07, P08. **Evidence:** B18, B22-B23, B26.

**Existing:** `scanner.ts`, trends/movers routes, universe helpers. **New:** normalized scan request/result contracts.

**Implement:** validate universe and strategy; propagate as-of/timeframe; snapshot membership and data; use the same rules/warmup as backtests. Separate computation coverage from response match limit/pagination. Return requested/attempted/succeeded/unavailable/failed/matched counts and per-source coverage. Do not stop scanning at N matches while implying full-universe ranking. Preserve errors instead of swallowing them as no match. Use prior-session prices for historical changes, not current symbol metadata. Expose current-membership survivorship bias and partial data. Job integration follows P17.

**Verify/done:** D04/D06/D07, invalid universe, missing data, early matches, later better matches, failed symbol, and historical-current metadata separation. A 100-symbol fixture with 20 failures reports them explicitly.

## P15. Separate observed derivatives from models and keep GTT preview-only

**Priority:** high. **Depends on:** P05, P07. **Evidence:** B24.

**Existing:** option/profile/basis/GTT functions in `smartApi.ts`, related types/routes.

**Implement:** partition provider observations from calculators and demo models. Missing real OI/PCR/options/futures data remains null/unavailable. Remove hard-coded expiry and assumed real-time telemetry. If model pricing is retained, label model inputs, assumptions, observation/model timestamp, and demo status. OHLCV-estimated volume profile cannot claim observed aggressor buy/sell flow. Basis requires actual synchronized cash/futures/expiry inputs. Validate GTT preview quantities, tick size, side, capital, stop/target, and input revision; never add broker submission here. Historical mode blocks or explicitly labels latest-only panels.

**Verify/done:** D08-D12. No UI-facing real-data response contains simulated fields without field-level/model provenance. A missing option provider is a completed unavailable state, not pressure to fabricate a chain.

## P16. Refactor AI into bounded, validated strategy proposals

**Priority:** high. **Depends on:** P02-P04. **Evidence:** B05, B16, B27.

**Existing:** `src/server/ai/{copilot,patterns}.ts`, AI routes. **New:** provider adapter, proposal envelope, validation/service tests.

**Implement:** selected allowlisted provider/model with its own key; explicit token/time/request budgets; no automatic paid/cross-provider fallback. Parse structured output with strict strategy semantics. A heuristic fallback is a named local method, not a fake connected AI response. Proposal contains ID, originating workspace revision, candidate AST, rationale, warnings, and method. Optimization is a proposal generator using declared in-sample data, not a profitability guarantee. Strip/limit untrusted history, treat retrieved text as data, never execute code/URLs/order payloads. Rename local pattern lookup honestly or implement real cited search separately; fixed-template live scan must not pretend to interpret arbitrary prompts.

**Verify/done:** A02, malformed/incomplete JSON, refusal, timeout, missing key, unsupported indicator, oversized history, stale revision, and prompt-injection-like output. No automatic trading/run/save side effects. Client explicit application is P24.

## P17. Isolate expensive work in bounded cancellable jobs

**Priority:** high. **Depends on:** P04, P06, P13, P14. **Evidence:** B26.

**Existing:** synchronous backtest/scan/optimization orchestration. **New:** `src/server/jobs` queue, worker protocol, job routes.

**Implement:** queued/running/terminal state machine; normalized immutable input; worker-thread pool with conservative default one worker; bounds for bars/symbols/iterations/grid/output/queue/wall time. Add idempotency keys, progress stages, cancellation acknowledgments, deadlines, worker-crash recovery, and output retention. Do not block the event loop with robustness loops. Define whether provider fetch happens in orchestration or worker and make cancellation propagate to it. Never pass secrets in serializable job snapshots. Before persistence, honestly mark jobs ephemeral; P19 adds recovery.

**Verify/done:** A03-A05, queued/running cancellation, worker exit, saturation, duplicate request, and health responsiveness. No orphan workers after shutdown. A cancelled job cannot later publish a successful result. API integration can initially poll; SSE is unnecessary for the core release.

## P18. Build atomic local workspace persistence and a saved library

**Priority:** high. **Depends on:** P03. **Evidence:** B14, B21.

**Existing:** localStorage logic in App/builder/copilot, `StrategyLibraryView.tsx`. **New:** workspace/strategy repository interfaces and local adapter.

**Implement:** one versioned workspace record owned above tabs, authoritative strategy-symbol relation, revision/dirty state, and real saving/error state. Migrate legacy keys atomically after preserving backup. Separate active draft from saved immutable revisions. Add save-as, rename, duplicate, export, soft-delete/restore, and templates vs My Strategies. Use bounded retention and explicit local-only disclosure. Validate all reads/writes and catch malformed data, denial, and quota failures. Choose a conflict policy for another tab, using revision checks or a visible conflict rather than silent overwrite. One shared copilot state owns chat storage.

**Verify/done:** edit then leave Builder in 100 ms; AI apply while Builder unmounted; reload; quota failure; malformed JSON; duplicate identity; template immutability; cross-tab conflict; A06-A08. No false saved badge. Import/export UI integrates in P21.

## P19. Store immutable runs and make persistence mode explicit

**Priority:** high. **Depends on:** P17, P18. **Evidence:** B21, B25-B26.

**Existing:** BACKTESTS_STORE/SAVED_STRATEGIES maps and retrieval routes. **New:** storage repositories, run manifests, migrations/retention policy; optional SQLite adapter.

**Implement:** immutable strategy snapshots, dataset checksums, engine/policy/fee/seed metadata, run identity distinct from strategy identity, and bounded paginated result retrieval. Unknown IDs are 404, never a default run. Support downloadable run JSON/CSV even in local/ephemeral mode. Default durable single-instance design is SQLite only on an explicitly persistent volume; if deployment lacks disk, do not enable it or claim durable server history. Keep interfaces ready for later PostgreSQL without installing it now. With durable mode, persist jobs and recover/mark interrupted work after restart; add backups, migration transactions, retention, and revision conflicts. Do not persist provider credentials in run records.

**Verify/done:** A06-A08, immutable results after edits, expired/missing run behavior, schema migration/rollback rehearsal, restart in each declared mode, and checksum export roundtrip. Record which persistence mode is enabled and why. Durable-host activation may be separately blocked on hosting while local/export workflows remain complete.

## P20. Centralize frontend requests and immutable run state

**Priority:** correctness blocker. **Depends on:** P17, P18; fixture-based development may begin after P03/P04. **Evidence:** B13-B14, B18.

**Existing:** `src/App.tsx` and fetch calls across components. **New:** typed API client, feature controllers/hooks, run/workspace state.

**Implement:** one `run(snapshot)` command that receives its symbol/strategy explicitly. Never call setSymbol then a closure-based run. Bind every result to request/job/strategy revision; use abort/generation checks and key-based state. An older response cannot replace newer data, clear newer loading, or force navigation. Validate response schemas; distinguish server error, unavailable, empty, partial, stale, cancelled, and success. Remove silent browser-local engine fallback, or retain it only as an explicit fixture/demo mode with identical versioned policy and visible provenance. Keep UI modules from importing backend/provider code. Expose changed-since-run state without mutating prior results.

**Verify/done:** E02/E03, reversed response ordering, initial-run race, symbol selection, result inspection followed by rerun, cancelled job, malformed response, and no backend code in browser imports. Navigation remains under user intent.

## P21. Make the active builder faithful and add safe transfers

**Priority:** high. **Depends on:** P08, P18, P20. **Evidence:** B04-B05, B15, B21.

**Existing:** `StrategyBuilder.tsx` and existing unused strategy controls. **New:** registry-driven fields/import preview if needed.

**Implement:** choose one active control implementation and remove duplicate definitions gradually. Offer every supported price/candle/indicator output with correct units. Deleting a referenced indicator blocks or shows an explicit dependency repair. Allow valid risk-only exits. Discriminated percent/points/ATR/RR controls preserve null/disabled state and sizing options. Unsupported execution choices are disabled with reasons. Draft numeric fields can be temporarily blank without coercing to a default. Add file/paste import, version/size validation, migration preview, cancel-without-mutation, JSON download, awaited clipboard success, and undo for replacements. Use AST-derived plain-language summaries.

**Verify/done:** every template loads and no-op exports without semantic changes; MACD aliases migrate visibly; null risk remains disabled; dangling references prevented; invalid/oversized/future-version imports do not replace workspace; clipboard failure is honest. Forms have accessible labels/error paths; full-shell audit follows P25.

## P22. Repair results, comparisons, charts, and exports

**Priority:** high. **Depends on:** P12, P13, P19, P20. **Evidence:** B17, B19, B21.

**Existing:** ResultsDashboard, StrategyComparisonView, EquityCharts, PriceChart, MetricsGrid, TradeLogTable, RobustnessView, IndianCostWaterfall.

**Implement:** one required active-result prop; distinct strategy revision/run/comparison IDs; stable series visibility/colors keyed by run ID; rerun replaces all intended references. Compare only compatible bases or explicitly segregate them. Preserve intraday timestamps rather than merging date-only keys. Pass indicator data and render named independent series. Replace hard-coded capital/timeframe/simulation labels and misleading signs/tooltips. Show nullable-metric reasons, actual benchmark, data/fee assumptions, reconciliation, engine version, and changed-input warnings. Reset/clamp trade pagination. Export immutable run manifests/trades with units and provenance. A parameter sweep changes only declared parameters.

**Verify/done:** actual Dashboard-to-Compare renders; two revisions of one strategy remain distinct; rerun errors retain only marked stale data; deleting/reordering does not transfer hidden curves; multiple indicators/intraday points work; E02/E06; CSV/JSON exports reconcile with screen values.

## P23. Repair scanner/session UX and contextual panel states

**Priority:** high. **Depends on:** P14, P15, P20. **Evidence:** B18-B19, B23-B24.

**Existing:** MarketScannerView, TradingCalendarModal, OptionChainScanner, VolumeProfileScanner, BasisSpreadScanner, GttBracketCalculator.

**Implement:** one shared pure date selector; dynamic session bounds/counts; sorted/deduplicated session data; consistent typed/clicked/preset-date behavior; explicit follow-latest vs pinned mode. Key all requests by symbol/universe/as-of/context. Trends/movers may not form an unlabeled mixed-context display. Surface partial coverage and current-membership limitations. Latest-only panels visibly opt out of historical context. Scanner-to-builder/backtest passes a complete intentional snapshot including date policy. GTT preview copy is disabled until the current validated input revision succeeds; debounce and abort superseded calculations. No live-order button.

**Verify/done:** E05, dates outside 2025-2026, empty calendar, timezone changes, fast filter changes, provider errors vs zero matches, stale OI/options, and reversed GTT BUY/SELL/capital responses. Removing fixed August fallback dates is required.

## P24. Implement an explicit copilot proposal lifecycle

**Priority:** high. **Depends on:** P16, P20. **Evidence:** B16, B19-B20.

**Existing:** AiCopilotDock, App callbacks, Navbar status. **New:** proposal/conversation controller and focused message components.

**Implement:** one conversation state shared across desktop/mobile; requested/received/validated/previewed/applied/running/succeeded/failed/stale lifecycle. Bind proposals to workspace and conversation generations. A phrase such as "first explain the risk" never selects/runs variation 1. Applying shows a diff, preserves undo, and is separate from running; explicit run-current and run-specific-proposal commands identify their target. Await actions before success messages. Reset/cancel invalidates pending callbacks. Remove loose historical-JSON application and no-op props. Status comes from actual capabilities; unavailable AI is not displayed as connected. Local heuristic mode is named.

**Verify/done:** E04, ordinary ordinal text, stale optimization after edits, reset during request, rejected apply promise, malformed restored proposals, mobile surface switch, and no duplicate request. AI cannot silently save/run/trade.

## P25. Complete accessibility and responsive usability

**Priority:** high. **Depends on:** P21-P24; shared primitives can start earlier after P03. **Evidence:** B20.

**Existing:** App/layout, Tooltip, forms, calendar/modal/drawer, symbol selector, chart/table controls. **New:** accessible primitives only where existing components cannot be fixed cleanly.

**Implement:** associated labels/errors, focus-visible styles, keyboard-operable controls, correct dialog/combobox/listbox/sortable-table semantics, focus trap/restoration, Escape handling, live status announcements, reduced motion, and textual chart alternatives. Tooltip must open on keyboard/focus/touch, not hover-only. At small widths, replace/hide the fixed desktop dock; only one active copilot surface. Preserve local table/chart scroll rather than clipping all overflow. Avoid a giant visual redesign before workflow correctness.

**Verify/done:** E07 with keyboard, automated accessibility checks, 320/360/390/768/1024/1440px checks, 200%/400% zoom, long names, and mobile composer keyboard. Automated checks alone do not establish accessibility; record manual keyboard/focus verification and screenshots.

## P26. Enforce exposure, abuse limits, and secret isolation

**Priority:** public-release blocker. **Depends on:** P02, P04, P17, P19. **Evidence:** B03, B25-B28.

**Existing/new:** API middleware, provider/AI adapters, production static routing, job/storage policies.

**Implement:** document demo-public vs private provider-backed mode. Public demo gets strict request/body/queue/CPU/AI limits and no private durable writes. Provider-backed private mode requires authenticated deployment boundary; do not invent a multi-user auth system in this ticket. Use rate limits and a trusted-proxy policy that cannot be bypassed with arbitrary forwarded headers. Add security headers/CSP tested against built assets, origin policy, sanitized errors, dependency/secret scanning, and denied sensitive-artifact paths. AI endpoint selection is allowlisted and keys never cross providers. No arbitrary user-supplied fetch URLs. Review storage/export/log access for secrets and ownership assumptions. Cookie auth, if actually enabled, requires CSRF controls.

**Verify/done:** A09-A12, abuse budgets, spoofed proxy headers, public/private access boundaries, `/server.cjs` and map/config path probes against a local test build, and dummy-secret leak scan. Do not probe or exploit the public deployment or test the exposed credential. Owner rotation confirmation is tracked separately.

## P27. Add observability and measured performance controls

**Priority:** high. **Depends on:** P17, P19, P26. **Evidence:** B24, B26.

**Existing/new:** logging, health routes, job/cache/provider instrumentation, benchmark harness.

**Implement:** structured redacted request/job/provider logs with request IDs; timings for fetch/indicators/simulation/robustness/serialization; queue depth, cache size, memory, provider errors, and cancellation counters. Separate fast liveness from readiness and optional provider diagnostics. Never call paid/provider login endpoints on every health probe. Add graceful shutdown and bounded retries. Benchmark declared 5,000-bar/100-symbol/robustness fixtures; tune queue/cache/candle/output caps from actual hosting memory. Add frontend downsampling only after profiling and preserve extrema/trade events.

**Verify/done:** performance budget in testing guide measured with hardware/runtime recorded; health stays responsive during CPU work; repeated jobs do not grow memory indefinitely; all logs redact dummy credentials. No fabricated latency or active-symbol counts.

## P28. Make deployment repeatable and reversible

**Priority:** release blocker. **Depends on:** P00, P02, P26, P27. **Evidence:** B02, B28.

**Existing:** start.js, render.yaml, CI/keep-alive workflows, README. **New:** deployment/backup/rollback runbook and production smoke test.

**Implement:** build once in CI and run tested artifacts; production startup never installs/builds automatically. Honor PORT and NODE_ENV, validate required configuration, handle SIGTERM/SIGINT, drain/cancel jobs, close storage, and return correct exit status. Clearly separate client static assets from private server artifacts. Choose hosting/storage mode consistent with worker/memory/disk requirements. Keep-alive workflow is not uptime monitoring; replace misleading always-success availability claims with actual health evidence or remove unnecessary pings. Do not purchase a hosting tier as part of an unapproved code task.

**Verify/done:** production build boots without dev server; missing artifact fails fast; configured port works; graceful shutdown has bounded completion; restore/rollback rehearsal passes where durable mode is enabled; no network/build at startup except explicitly configured provider initialization. Document ephemeral limitations.

## P29. Run full regression, reconciliation, and independent review

**Priority:** release blocker. **Depends on:** P21-P25, P28.

**Scope:** integration only; do not add new features while fixing regressions.

**Implement/verify:** run the full commands in the test guide and journeys E01-E07. Independently hand-check at least Q01/Q03/Q04/Q06/Q07, M01, C01, train/test boundary, and sensitivity center. Check zero/one/large inputs, cancellation/restart, missing keys, mixed provider failures, unsupported settings, and stale UI state. Test legacy migration against every shipped template and representative malformed records. Run production bundle boundary checks and the dependency/secret review. Compare README/UI claims with enabled capabilities. Use a clean reviewer for financial policy, schemas, security, and UX, with exact findings and evidence.

**Done:** no unresolved numerical/security/data-loss blockers; all accepted exceptions explicitly recorded; reports distinguish actual tests from unrun provider checks. Do not waive ledger disagreement because a chart looks plausible.

## P30. Publish honest documentation and complete the release checklist

**Priority:** release blocker. **Depends on:** P29.

**Existing:** README, CONTRIBUTING, env example, in-app help/status/template copy. **New:** architecture, data/fees, limitations, migration, release and operational docs.

**Implement:** document supported instruments/timeframes/order policies, demo vs real mode, as-of/data coverage, currency/adjustment/universe assumptions, fees/exclusions, AI provider/budget behavior, local vs durable retention, and known limitations. Remove guaranteed-profit/risk-cap/institutional-exact claims unless demonstrably supported. Rename chronological holdout and modeled analytics accurately. Provide developer quick start, existing commands, fixture workflow, owner credential-rotation checklist, backup/restore, rollback, and legacy-result handling. Record actual release commit/schema/engine/policy versions and gate results.

**Done:** G0-G3 checklist is complete with evidence; enabled features all have tested contracts; optional features are marked unavailable/deferred rather than implied complete. No broker orders, production deployment, or paid purchases are performed without the appropriate separate authorization.

## Optional roadmap: not prerequisites for the core release

### P31. Add verified provider capabilities incrementally

**Depends on:** P30 and data access/license decision. Start with one concrete capability, not every market: longer daily history, then licensed intraday bars, then real option chains/futures/OI as available. Each needs provider entitlements, instrument/calendar mapping, adjustment policy, request budgets, observed provenance, offline recordings, and staging verification. Confirm redistribution/storage rights before caching or exporting data. Global markets require currency/venue/calendar/fee support, not just ticker suffixes. No new provider is enabled merely because its API returned HTTP 200.

**Done for each capability:** capability matrix, schema, provider adapter, fixture/reference tests, entitlement/error states, coverage UI, performance budget, and documentation all agree. Costs and credentials are owner decisions; do not invent them.

### P32. Add advanced research only on the corrected engine

**Depends on:** P30. Separate tickets for true rolling walk-forward with training-only parameter selection, point-in-time universes, portfolio allocation/rebalancing, corporate actions/dividends, short/borrow/margin, limit-order models, and multi-currency performance. Do not bundle these into one PR.

Each requires a written mathematical contract, bias/limitation analysis, independent fixtures, engine/schema versioning, and realistic data coverage. Walk-forward must not tune on OOS windows; repeated model selection should preserve a final untouched holdout. Portfolio results require shared cash and cross-asset synchronization, not averaging independent equity curves. Limit/short features require actual fill/accounting tests, not merely un-hiding controls.

### P33. Add multi-user ownership and scalable persistence if needed

**Depends on:** P30 and product/exposure decision. Specify identity provider, account ownership, role model, session/CSRF policy, tenant-scoped queries/cache/jobs, quotas, audit logging, deletion/export policy, PostgreSQL migrations, backup/restore, and deployment topology. Local single-user strategy IDs are not an authorization mechanism. Secrets must be server-side and per-user credential handling requires a separate secure design.

**Done:** cross-tenant adversarial tests, rate/budget isolation, migration rehearsal, privacy/access documentation, and operational ownership. Do not add signup/auth UI without enforcing ownership in every API/storage/job path.

### P34. Treat paper/live execution as a separately authorized product

**Depends on:** P30, verified broker capabilities, and a dedicated risk/security/compliance review. This ticket is a scoping gate, not authorization to trade.

Start with sandbox/paper execution, broker adapter contract, order-intent review, idempotency keys, order/fill reconciliation, exchange session checks, quantity/tick validation, exposure limits, kill switch, disconnect/retry behavior, audit trail, and credential lifecycle. Model partial fills/rejections/cancellations explicitly. Do not claim backtest stop levels guarantee live risk. Live mode is disabled by default, requires explicit user authorization and deployment controls, and never follows an AI chat instruction directly.

**Done before live enablement:** independent review, paper soak tests, failure drills, owner-approved broker/account configuration and limits, and explicit approval for real externally visible orders. The core upgrade remains complete without this feature.

## Recommended merge waves

- **Wave 0, containment/foundation:** P00, P01, P02, then P03/P04. Remove credential/static exposure and freeze contracts before feature development.
- **Wave 1, truth and numerical core:** P05-P07 in data lane; P08/P09 and P11/P10/P12 in engine lane; P16 AI adapter and P18 local storage can proceed against frozen schemas. P13/P14/P15 complete the research capability layer.
- **Wave 2, usable workflows:** P17/P19/P20, then P21-P24 by feature ownership; P25 accessibility integrated throughout.
- **Wave 3, controlled release:** P26/P27/P28, then P29/P30. Security limits must already have safe defaults from P02/P04, not wait until this wave to protect a public server.
- **Wave 4, optional product expansion:** P31-P34 only through newly scoped approved tasks.

Numeric ranges above indicate groups, not a mandate to ignore the explicit dependency graph. No agent may mark a dependent ticket complete based solely on a mocked interface that the real producer never implemented.
