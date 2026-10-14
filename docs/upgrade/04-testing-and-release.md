# Stragy upgrade: test specification and release gates

Status: proposed acceptance specification. No application build, dependency install, provider integration, or test suite was run during this planning review. P00 records the actual executable baseline.

Read [contracts](02-architecture-and-contracts.md) before writing expected results. Use [the backlog](03-implementation-backlog.md) to assign ownership.

## 1. Testing layers

### Unit and property tests

Use Vitest for pure TypeScript modules. Freeze time and seed randomness. Do not mock away the component whose correctness is being tested. Test indicators, rule compilation, execution events, sizing, ledger, costs, metrics, migrations, parsers, calendar cutoffs, and canonical hashing separately.

Property tests can use a dedicated library if justified, or deterministic generated cases initially. Required properties:

- appending future bars cannot change any already-computed indicator, signal, or ordinary completed event before the append boundary; exclude synthetic end-of-data liquidation when comparing a truncated run with an extended run;
- a quantity of zero cannot produce a trade or charges;
- cash-funded long positions cannot create negative cash beyond a declared rounding tolerance;
- ledger sums reconcile with equity;
- fee breakdown sums equal total charged fees;
- identical data plus strategy plus engine plus seed produces identical mathematical results;
- invalid/nonfinite inputs produce typed errors rather than NaN/Infinity in the response;
- an as-of historical query never includes a later observation;
- all returned results retain provenance, including cached and partial responses.

### API and service integration tests

Use an application factory and in-process HTTP test harness, such as Supertest. Inject providers, clock, storage, job runner, and AI adapter. No real credentials or external traffic. Test the whole route -> schema -> service -> domain -> response-schema path. Disable real network access in the test environment so accidental live provider calls fail the test.

### Component tests

Use React Testing Library plus user-event for forms, validation, imports, persistence errors, stale states, AI proposal application, keyboard controls, and result labeling. Avoid snapshots of enormous rendered pages as a substitute for semantic assertions.

### End-to-end tests

Use Playwright against a deterministic fixture server, not a live market provider. Cover desktop and narrow mobile viewports, keyboard operation, reload recovery, job cancellation, and an offline/provider-error scenario. Reuse stable accessible names or documented test IDs, not fragile Tailwind classes.

### Optional live integration tests

Separate workflow, manual or scheduled, with explicit provider credentials and strict budget caps. Never gate ordinary pull requests on live markets, an expiring broker session, or paid AI availability. Sanitize recorded fixtures and respect market-data redistribution licenses.

## 2. Fixture design rules

Each fixture includes a README specifying its purpose, timestamps, calendar, timeframe, price adjustment basis, currency, expected indicator warmup, signal policy, fees, and exact expected values.

Use small readable JSON/CSV fixtures where a reviewer can hand-calculate results. Keep real historical data out of source control unless redistribution rights are verified. Synthetic data is appropriate for tests and demos only when labeled as synthetic.

Do not generate expected results by calling the same engine function under test. Use independent hand calculations, cited formulas, or a separately reviewed reference implementation. Golden updates require an explanation of which policy changed.

All numerical assertions specify tolerance. Use exact integer/decimal money representations where chosen; otherwise use a documented tolerance such as 0.01 currency units at reporting boundaries and tighter tolerances for internal arithmetic. Do not loosen tolerance merely to pass tests.

## 3. Deterministic execution fixtures

The examples below assume long-only, one position, zero fees/slippage unless stated, a synthetic three-session calendar, 10,000 initial currency units unless stated, no leverage, and `next_open_long_cash_v1`. Signals can be supplied to execution-unit tests through a compiled-signal fixture; at least one full-stack test must produce the same signals through a real strategy AST.

### Q01: next-open entry and rule exit

- Session A: O=100, H=101, L=99, C=100. Entry signal becomes true at A close.
- Session B: O=110, H=112, L=109, C=111. Enter 10 units at B open, not A close. Exit signal becomes true at B close.
- Session C: O=120, H=121, L=119, C=120. Exit at C open. Use a 20% stop and no target, so risk levels do not trigger.
- Expected entry 110; exit 120; gross/net PnL 100; final cash/equity 10,100; exactly one trade; no same-bar reentry.
- Regression target: same-close fills, order sequencing, equity/trade reconciliation.

### Q02: last-bar signal

An entry signal occurs only on the final bar. Expected zero filled entries and zero trades. The result explains that there was no next bar to execute the signal. Do not fabricate a closing fill.

### Q03: opening gap through stop

An existing 10-unit long entered at 100 has stop 95. Next bar O=90, H=91, L=89, C=90. Expected stop fill 90, loss 100, final equity 9,900, and a gap-stop reason/detail. A 95 fill is optimistic and fails.

### Q04: both stop and target inside a bar

Existing or just-opened position: entry 100, stop 95, target 105, quantity 10. Bar O=100, H=106, L=94, C=101. Expected adverse-path stop fill 95, loss 50, final equity 9,950, and an intrabar-ambiguity warning. It must not select whichever outcome improves the strategy.

### Q05: trailing level activation

Existing 10-unit long entry 100 with an active trailing stop 95. Bar B has O=100, H=120, L=99, C=115. The new 5%-below-high level is 114, but it is active only for the next bar. B must not exit retroactively at 114. Bar C has O=115, H=116, L=113, C=114. Expected exit 114 and gross profit 140.

### Q06: entry affordability including fees

Initial capital 1,000; entry fill 100; entry fee 2; requested allocation 100% of available funds; unit step 1. Expected quantity 9, post-entry cash 98. Exit all 9 at 110 with exit fee 3: final cash 1,085, gross PnL 90, fees 5, net PnL 85. Quantity 10 with negative cash fails.

A separate fixed-quantity test requests 10 units and expects the declared insufficient-funds behavior, not an undocumented auto-resize.

### Q07: slippage is not double counted

Reference entry 100, reference exit 110, adverse slippage 10 bps each side, quantity 10. Entry fill 100.10; exit fill 109.89; gross PnL 97.90. Entry/exit fees 2 each -> net PnL 93.90; final equity 10,093.90. Informational slippage cost is 2.10, already included in the fill-price difference. Subtracting it again fails.

### Q08: final liquidation

Open position remains on the final bar. With liquidation enabled, the trade closes at final close with configured fees/slippage and the final equity point equals the resulting cash. With liquidation disabled, the response contains the open position and marked unrealized PnL rather than inventing a closed trade. Both variants reconcile.

### Q09: drawdown halt

Provide a preexisting position and a closing equity decline that crosses the cutoff. Assert the halt occurs on the close, new entries are blocked, and pending liquidation executes at the next open according to the contract. Include a worse opening gap to prove the configured threshold is not falsely reported as a guaranteed loss cap.

### Q10: unsupported execution settings

Request short-only, limit orders without a supported model, or an unimplemented square-off policy. Expect 422 `UNSUPPORTED_EXECUTION_POLICY` with field paths. Never return long-only success under a short-only configuration.

### Q11: ATR is causal and independent of display IDs

Use risk ATR period 1 and a previous completed bar O=100, H=101, L=99, C=100, giving true range 2 under the declared first-bar convention. Next entry open is 100 and stop distance is 2 x ATR: initialized stop is 96. Changing the entry bar high from 101 to 120 must not change that initialized stop. Renaming a visible indicator or assigning another indicator the legacy name `atr14` must not change risk. Missing/zero ATR yields the declared unavailable/invalid-risk behavior, not a percent-of-close substitute.

### Q12: sizing variants and activation are real behavior

At equity 10,000, a 1% allocation budget cannot buy a 2,000-priced unit: quantity is zero, not one. For fixed-risk 1%, entry 100, stop 95, zero fees, and unit step 1, quantity is 20 before the independent cash cap. Add positive estimated fees and verify risk/cash constraints. A trailing activation of 10% after entry 100 must remain unarmed at a completed high of 108. Points and ATR trails ratchet in their own units and never loosen; any unsupported variant must instead be rejected explicitly.

## 4. Indicator and rule fixtures

### I01: warmup and alignment

For each indicator, assert output length equals input length and unavailable warmup entries are null. Verify the first valid index. Removing warmup bars from displayed performance must not shift timestamps relative to signals.

### I02: SMA and EMA

Use closes `[1, 2, 3, 4, 5]`, period 3. SMA is `[null, null, 2, 3, 4]`. For EMA choose and document SMA seeding: the first value is 2 at index 2; with alpha 0.5, subsequent values are 3 and 4. If another convention is selected, name/version it and update independent reference tests, not silently mix conventions.

### I03: RSI edge cases

Test all-rising, all-falling, flat, alternating, and insufficient-length prices. Adopt Wilder smoothing. Rising with zero average loss -> 100; falling with zero average gain -> 0; fully flat -> 50 as an explicit convention. No NaN/Infinity. Independently verify a nontrivial sequence.

### I04: ATR and gaps

True range uses current high-low and absolute distances to previous close. Include a gap where high-low alone is insufficient. Specify the first-bar convention and Wilder initialization.

### I05: compound outputs

MACD line/signal/histogram, Bollinger bands, and Supertrend line/direction use named output contracts. Test missing outputs, insufficient history, parameter boundaries, and array alignment. A rule referring to an undefined output is a schema error, not always-false success.

### I06: crossover with nulls

Cross above cases: previous equality then strictly above is true; already above then above is false; any null/NaN in the four values is false with a diagnostic. Mirror for cross below. Verify both scanner and backtest use the same evaluator.

### I07: semantic schema rejection

Duplicate IDs, unknown references, invalid periods, missing right operand, both right operands, unknown operators, unsupported fields, nonfinite numbers, invalid MACD fast/slow relationships, oversized arrays, and excessive nesting must all fail deterministically.

### I08: no future leakage

Calculate signals and indicators on prefix N, then on N+K bars. Compare the prefix outputs exactly within numerical tolerance. Run this for every indicator and composite operand. Include historical scanning and robustness preprocessing.

### I09: migration preserves actual legacy semantics

Two legacy entry rules and two legacy exit rules both retain AND aggregation: one false predicate makes the corresponding rule set false. Do not change exits to OR. Legacy `fraction: 0.15` becomes v2 `allocationPct: 15`; a 10,000 capital fixture has a 1,500 allocation budget, not 15 or 150,000. Legacy equality migrates to explicit approximate equality with strict absolute difference <0.0001; values exactly at the tolerance boundary are false. Use exactly representable numbers or an independent decimal expectation to avoid a binary-floating boundary fixture accidentally testing representation error. A legacy fixedRisk field requires a visible migration warning because its prior engine behavior was not real fixed-risk sizing.

## 5. Metrics and cost fixtures

### M01: daily returns and drawdown

Equity closes `[100, 110, 99, 108.9]` -> returns `[0.10, -0.10, 0.10]`; total return 8.9%; maximum drawdown 10%. CAGR uses the actual declared elapsed duration, not number of trades.

With zero risk-free return, sample standard deviation (n-1), and annualization 252, Sharpe is approximately 4.582575695. This number is a mathematical fixture, not a performance claim. The implementation must document that short samples are statistically weak.

For Sortino choose downside deviation across all return observations: `sqrt(sum(min(r-target,0)^2)/N)`. With target 0 the fixture yields approximately 9.165151390 after annualization. Null behavior for no downside must be tested separately.

### M02: intraday resampling

Two datasets with identical daily closing equity but different numbers of intraday bars produce the same daily Sharpe/Sortino. Intraday maximum drawdown can differ and must be identified as path-based. A daily annualization factor applied directly to every minute return fails.

### M03: alpha/beta alignment

Use aligned benchmark excess returns `[0.01, 0.02, 0.03]` and strategy excess returns `[0.02, 0.04, 0.06]`: beta 2, regression intercept 0. Add missing sessions and verify intersection alignment, not index alignment after unequal filtering. Zero benchmark variance -> unavailable reason.

### M04: empty, flat, loss-only, and bankrupt results

No trades, one trade, zero variance, all wins, all losses, break-even trades, nonpositive equity, and zero elapsed time must return valid JSON. Infinity/NaN cannot cross the API. Profit factor with zero gross losses is null plus the declared reason; UI displays an explanation, not zero or a huge sentinel.

### C01: synthetic side-specific fee schedule

Use a clearly synthetic test-only schedule, not asserted Indian statutory rates: brokerage 2 per fill; buy levy 0.1% of buy turnover; sell levy 0.2% of sell turnover; tax 10% of brokerage only. Buy 10 at 100 -> fee 2+1+0.2=3.2. Sell 10 at 110 -> fee 2+2.2+0.2=4.4. Total fees 7.6; net PnL 92.4. Verify each component and ledger reconciliation.

### C02: dated production-like schedule

After official rate verification, add fixtures on both sides of an effective-date boundary, buy vs sell, delivery vs intraday, brokerage cap, small rounding amounts, and excluded-charge warnings. Store source URL and observation/effective dates. Do not update all historical trades to the latest rates.

## 6. Robustness experiment fixtures

### R01: independent holdout windows

Ten selected evaluation bars, k=7. A full-run position enters on index 6 and exits on index 9. The training run may not consume index-9 prices/PnL; it finalizes at index 6 under the declared policy. Changing bars 7-9 cannot change training equity/trades/metrics. Test begins flat at index 7 with only earlier indicator warmup. A training position that marks down 20% and later exits flat still records the 20% drawdown.

### R02: horizon and labels

One observed net return +1%, initial capital 100,000, horizon 1: every bootstrap path ends at 101,000, with two curve points and two step labels. Do not force a 20-trade horizon. If the source is a no-trade run, return unavailable for strategy robustness rather than a claim of zero risk.

### R03: controlled resampling and quantiles

Use daily returns `[+0.1, -0.1]`, two steps, starting capital 100,000. Inject the four sample-index sequences `++`, `+-`, `-+`, `--`. Terminal equities are `[121000, 99000, 99000, 81000]`; maximum drawdowns are `[0, 10, 10, 19]` percent; probability drawdown >=15% is 25%. Nearest-rank terminal quantiles are p10=81,000, p50=99,000, p90=121,000. Verify the documented >= versus > threshold consistently. Same seed/algorithm/input yields the same values; zero/negative/fractional iteration counts are rejected.

### R04: actual sensitivity reruns

A grid containing exact base settings must return the exact base metric in that cell. Nonbinding parameter changes produce identical metrics, not manufactured curved/noisy values. An absent target does not create a target dimension. Native percent/points/ATR/RR units are preserved. A spy on the simulation core proves one intended run per valid cell, with no recursive robustness call; invalid cells report why they were skipped.

## 7. Data, calendar, scanner, and derivatives tests

- D01: provider timeout -> typed unavailable error; demo provider is never called implicitly.
- D02: malformed OHLC, duplicate timestamps, out-of-order bars, negative volume, nonfinite prices, and unclosed/future bars fail or are quarantined according to policy.
- D03: cache hit preserves provenance; provider/range/timeframe/adjustment changes produce distinct keys; errors do not poison the success cache; cache size is bounded.
- D04: as-of date X cannot use quotes, candles, OI, option expiry data, or calendar sessions after X. Browser timezone changes must not change the exchange session selected.
- D05: holiday, weekend, special session, and daylight-saving fixtures for any non-Indian venue actually supported. Indian exchange fixtures use a versioned calendar, not a holiday list inferred from weekdays alone.
- D06: scanner reports requested=100, attempted=100, succeeded=80, unavailable=20, matched=7 for a controlled 100-symbol fixture. Denominators and partial warnings are consistent. No silently shrinking the universe.
- D07: current-constituent historical scan carries survivorship-bias limitation until point-in-time membership is supported.
- D08: live spot quote with unavailable OI leaves OI/PCR null and derivatives classification unavailable. It does not synthesize plausible numeric fields.
- D09: option chain validates expiry, strike order, observation time, bid<=ask where both exist, and null unavailable Greeks. Stale data cannot acquire a fresh timestamp merely because it was fetched again.
- D10: volume-profile methodology is explicit. OHLCV-based allocation is labeled estimated; buy/sell aggressor volume is unavailable without supporting data.
- D11: basis calculation requires actual synchronized cash/futures observations, contract expiry, and units. Missing inputs produce unavailable, not invented arbitrage yield.
- D12: GTT/bracket screen generates a preview/calculation only. No order-placement network call occurs.

- D13: two requests with different requested dates resolving to the same session retain their own requestedDate/isSnapped/sessionLabel metadata despite shared cached market values.
- D14: an unknown numeric symbol ID returns not found before cache allocation or outbound provider work. Repeating many unknown IDs cannot create thousands of fallback-cache entries or network fetches.

## 8. API, job, storage, and security tests

- A01: every route rejects malformed and over-budget inputs before expensive provider/worker calls.
- A02: invalid AI JSON/schema, timeout, refusal, missing key, and local-pattern fallback are distinguishable. No provider text is executed.
- A03: duplicate job retry with the same idempotency key/request hash enqueues once; same key with different body -> 409.
- A04: queued/running cancellation, worker crash, timeout, and restart have deterministic terminal states. Partial files are cleaned up. Another job can run afterward.
- A05: a saturated queue yields 429/503 with retry guidance while health and lightweight reads remain responsive.
- A06: stored strategy revisions are immutable; concurrent stale revision update -> 409; migration failure preserves legacy backup.
- A07: malformed local storage, denied storage, and quota exhaustion surface actionable errors without wiping unrelated entries.
- A08: persisted runs retain their original strategy after the user edits the builder.
- A09: secrets do not appear in compiled assets, public capability payloads, logs, errors, exported runs, screenshots, or AI request bodies.
- A10: no authentication claim without access tests. Where authentication is enabled, unauthenticated private writes fail, ownership boundaries hold, and rate limits cannot be bypassed by trusting arbitrary forwarded IP headers.
- A11: compressed/oversized requests, too many indicators, huge Monte Carlo counts, and oversized AI history hit explicit limits.
- A12: liveness/readiness never log into SmartAPI or request AI completions.

- A13: local production-mode GETs for backend bundle/source-map/configuration paths return denied/not-found and never backend source. Build inspection proves public client assets are isolated from private server artifacts; test with dummy secret canaries, never the exposed real credential.
- A14: a missing backtest ID returns 404 with no simulator call. Invalid scanner strategy returns 422 with no fallback run. Unchecked arbitrary strategy bodies cannot be persisted.

## 9. End-to-end user journeys

### E01: honest first launch

Launch without provider credentials. User sees demo/unavailable capabilities clearly. A sample strategy runs against an explicitly labeled demo fixture. No UI claims live market data. No secret is requested automatically.

### E02: valid real-data research

Select a supported instrument/timeframe/range; construct strategy; validate; submit run; observe queued/running state; complete; inspect metrics/trades/data provenance; export JSON/CSV; reload saved strategy; reproduce the run from the manifest.

### E03: editing and stale results

Run strategy A, then edit to B. A's chart remains tied to A and is labeled out of date relative to the builder. A slower previous request cannot overwrite B's selected symbol, date, scan, or completed result.

### E04: AI proposal

Request a strategy proposal; receive valid draft or clear failure; inspect differences and warnings; cancel without mutation; apply intentionally; undo; run only after explicit user action. AI output cannot switch to unsupported execution or demo data invisibly.

### E05: historical scanner

Choose a historical session and a universe; inspect actual as-of timestamp, coverage, and point-in-time limitation; change sessions rapidly; only the newest selection wins. Missing derivatives remain unavailable. A provider error retains only visibly stale prior data, never current-looking results.

### E06: durable workflow and comparison

Save/reload/export/import a strategy; preserve identity/revision; recover a malformed legacy record through backup/export. Compare two runs with compatible bases. Incompatible date/currency/engine/data bases produce explicit warnings or blocked aggregate ranking.

### E07: accessibility and narrow screens

Complete builder, import/export, scanner filters, modal interaction, and AI proposal actions using keyboard only. Focus is visible, dialogs trap/restore focus, inputs have names and described errors, charts have textual summaries, status announcements are accessible, and information does not rely solely on color. Test at 360px, 768px, and desktop widths.

## 10. Proposed commands after harness implementation

These scripts do not exist in the reviewed baseline. P00/P01 create and verify them.

```text
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:coverage
npm run build
npm run test:smoke
```

Keep the current `npm run lint` compatibility alias until CI/documentation are migrated. Split actual ESLint checks from type checking; do not claim linting because only tsc ran. Add a lightweight architectural import-boundary test.

Suggested initial coverage gate: 90% branch coverage on new execution/ledger/rule/cost modules, 80% on new pure domain modules, and no reduction in agreed coverage. Coverage is not evidence of numerical correctness by itself. Protect every confirmed regression even if the overall percentage already passes.

## 11. Performance and reliability budget

Treat these as proposed starting budgets, to be measured and adjusted with an explained baseline rather than claimed as current performance.

Benchmark profile: record CPU, RAM, Node version, build mode, dataset hash, worker count, and host limitations. Use 5,000-bar single-instrument runs and a 100-symbol fixture scan, plus 100/500-iteration robustness workloads.

- Health endpoint remains responsive during CPU jobs; target p95 <250 ms locally under the declared workload.
- Cancellation is acknowledged within 1 second by the API and stops work within 2 seconds between bounded work units; if not feasible, document and test an explicit stronger worker termination bound.
- No monotonic memory growth after 100 repeated fixture jobs. Bound queue, cache, job outputs, and retained results.
- Measure p50/p95 duration and peak RSS separately for fetching, indicators, simulation, robustness, serialization, and UI rendering.
- Set initial maximum job sizes from measurements on the actual deployment budget, not from a developer workstation alone.
- Test provider retries with exponential backoff/jitter, total deadline, and a maximum attempt count. Retries must not multiply across nested layers.
- Avoid an unmeasured "all 2,000+ symbols in real time" promise. Publish actual coverage and refresh latency.

## 12. Release gates

### Gate G0: reproducible development

P00-P04: clean install from the committed lockfile; startup/build/typecheck/harness work; no credentials needed for offline tests; schema/error contracts are frozen for subsequent tickets.

### Gate G1: honest research core

P05-P16 plus required client adapters: no silent synthetic fallback; complete provenance; supported execution semantics only; ledger/fees/metrics fixtures pass; historical cutoff works; robustness claims are accurate; AI outputs are validated. Legacy results are marked with their legacy engine version, not relabeled v2.

### Gate G2: usable end-to-end workflows

P17-P25: jobs are bounded/cancellable; workspace persistence and optional durable mode work; client race handling, builder, results, scanner, AI proposal flow, and accessibility journeys pass. If durable disk is unavailable, server persistence is explicitly disabled and local/export workflows remain complete.

### Gate G3: controlled public release

P26-P30: exposure policy, abuse limits, secrets handling, health/observability, production artifact startup, release smoke tests, data/fee disclosures, and rollback runbook are verified. Any enabled provider needs a successful separately documented integration check.

Optional P31-P34 are not requirements for G3 and must not delay core correctness. They require new scoped plans and approval for deployment costs, external orders, or broader data rights where applicable.

## 13. Release and rollback checklist

Before deployment:

1. Record source commit, lockfile checksum, runtime, schema versions, engine version, and migration version.
2. Run the offline gate suite and attach actual command outputs to the release record.
3. Build once in CI; deploy that tested artifact. Production must not install or compile on startup.
4. Back up durable data and verify restore using a disposable environment.
5. Confirm feature flags default to safe supported capabilities and demo labeling remains visible.
6. Verify missing/malformed credentials disable only dependent capabilities and never expose values.
7. Run staged provider checks within limits, then smoke the same end-to-end fixture journeys in production mode.
8. Compare one independently checked reference backtest and ledger before wider exposure.
9. Confirm health probes and normal startup do not create paid/provider traffic unexpectedly.
10. Publish limitations, date/fee/data assumptions, changed engine semantics, and legacy migration notes.

Rollback:

- Keep the previous application artifact and matching configuration.
- Use backward-compatible expand/contract schema migrations. Do not delete legacy columns/records in the first release.
- On rollback, disable new job submission, finish or cancel active work safely, preserve immutable runs, and restore only from a verified backup if necessary.
- Never rewrite old research results to look like they came from the rolled-back engine.
- If a numerical defect is discovered, identify affected engine/data versions, mark affected results, document the issue, and request reruns. Hiding or quietly changing old numbers is not acceptable.
