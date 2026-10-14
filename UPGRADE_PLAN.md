# Stragy: detailed upgrade and coding handoff plan

**Planning date:** 2026-10-13  
**Repository:** <https://github.com/AbinashBalaraman/stragy>  
**Reviewed revision:** `163a80c6d603eec2bed28a7e9220b6a867e8dac7`  
**Status:** core implementation integrated; local automated release-candidate gates passed. Current evidence and limitations are maintained in [implementation status](docs/upgrade/implementation-status.md). The original baseline findings below are historical, not a claim that every issue remains present.

## Start here

This is a repository-specific implementation specification, not a generic feature wishlist. It gives other coding models a defined architecture, exact behavioral policies, small testable work packages, dependencies, regression fixtures, release gates, and copy-ready handoff prompts.

The first objective is **a trustworthy, reproducible trading-research application**, not a larger collection of impressive-looking screens. The existing React/TypeScript/Express stack should be preserved and improved incrementally.

### Immediate security warning

The reviewed AI source contains a credential-shaped fallback. Treat it as exposed: the owner should revoke/rotate it, review usage, and remove it from source/history as appropriate. Do not test or reproduce its value. The production build also puts the server bundle/source map inside the directory served as public static assets. P00/P02 contain these problems before further public deployment. This was established from source configuration; the live deployment was not probed.

## Plan documents

1. **[Baseline audit](docs/upgrade/01-baseline-audit.md)**: 28 evidence-backed findings, exact source locations, severity, and what was not verified.
2. **[Architecture and contracts](docs/upgrade/02-architecture-and-contracts.md)**: target module boundaries, strategy v2, provenance, execution event ordering, ledger/fees, metrics, jobs, persistence, and security policy.
3. **[Implementation backlog](docs/upgrade/03-implementation-backlog.md)**: 35 numbered work packages. Each core ticket identifies dependencies, existing/new files, implementation steps, verification, and scope boundaries.
4. **[Testing and release specification](docs/upgrade/04-testing-and-release.md)**: hand-calculable financial fixtures, contract/data/security tests, seven end-to-end journeys, performance budgets, release and rollback gates.
5. **[Coding-model handbook](docs/upgrade/05-agent-handoff.md)**: bootstrap caveat, task packets, ready-to-use prompts, completion report, agent lanes, merge ownership, and execution-log rules.
6. **[Machine-readable task index](docs/upgrade/TASKS.json)**: dependency graph and per-ticket tracking for all 35 tickets. The backlog is the detailed specification; this index is a scheduling aid.

For a small model, read this page, its assigned ticket, the relevant contract/test sections, and only the affected source files. It does not need the whole repository in context.

## 1. Verified starting point

Stragy has a substantial visual interface: strategy building, backtest results, comparisons, market scanners, derivative calculators, templates, and an AI copilot. Its source is TypeScript, not Python.

The initial local workspace contained only an empty `src/python` directory. I therefore inspected the supplied GitHub repository through a downloaded source snapshot. The archive's embedded revision comment verified the pinned commit. There were 60 source/configuration files and no existing upgrade plan or test suite in the snapshot.

No application install, build, backtest, provider login, paid API call, deployment, or trading action was performed for this plan. Findings are static-source findings. Future models must establish and execute a clean baseline before claiming tests pass.

## 2. The highest-priority problems

- **Security and build:** credential fallback; server artifacts in the public static directory; npm CI without an npm lockfile; no behavioral test harness.
- **Data truth:** generated historical bars and modeled derivatives can be represented as real/live; dataset origin is not reliably preserved; historical requests can use later data.
- **Financial correctness:** protective fills are deferred incorrectly for normal stop/target expectations; ATR risk can use current-bar future information; fees/equity/trades do not share one ledger; unsupported execution/sizing choices are accepted.
- **Analytical validity:** fixed beta and degenerate-metric sentinels; generated rather than simulated sensitivity cells; contaminated train/test partitioning; unseeded/mismatched Monte Carlo horizons.
- **Workflow integrity:** scanner selection can run the previous symbol; stale responses can overwrite newer state; autosave can lose edits while claiming success; comparison prop wiring is inconsistent; builder controls can change risk meaning.

These issues take precedence over adding more indicators, redesigning the dashboard, or enabling live orders.

## 3. Product scope and default decisions

### Core release, P00-P30

A user can create or import a valid supported strategy, understand its exact risk/execution semantics, run a bounded reproducible backtest on explicitly sourced data, inspect reconciled results, compare compatible runs, save/export work, scan with truthful historical coverage, and deliberately apply a validated AI proposal. Failure/unavailable/demo states are as well defined as success.

Defaults:

- Keep React + TypeScript + Vite + Express + Zod.
- One service initially; bounded worker threads for CPU jobs.
- npm and the pinned Node 26.5.0/npm 11.17.0 runtime used by current CI and local verification. Runtime support must be reviewed before deployment.
- Explicitly labeled demo mode; no silent synthetic fallback.
- Initially supported execution: single-symbol, long-only, cash-funded market orders with closed-bar signals and next-open fills. Other modes are rejected until tested.
- One fee-inclusive ledger drives trades, equity, costs, drawdown, and metrics.
- Saved strategies are local-first. Durable server storage is enabled only on a verified persistent deployment; otherwise local/export workflows and ephemeral limits are honest.
- No automatic paid AI fallback, broker order submission, or credential entry.

### Optional later work, P31-P34

Verified extended market data, true walk-forward/portfolio/short/limit research, multi-user accounts, and paper/live execution. These are separately gated products, not hidden prerequisites for finishing the core upgrade.

## 4. Execution sequence

### Wave 0: establish a safe and testable baseline

P00-P04. Correct install/build/static boundaries and credentials, add offline testing, freeze strategy/API contracts, and extract application startup from route/domain logic.

**Exit gate G0:** clean reproducible install/build/start and harness; strict contracts; no required real credentials for tests. Never begin a large UI rewrite before these interfaces exist.

### Wave 1: make market research honest and numerically correct

Data lane P05-P07; engine lane P08-P13 with P11 fees landing before P10 ledger; scanner/derivative lane P14-P15; AI adapter P16. Local workspace P18 can proceed after schema freeze.

**Exit gate G1:** no silent synthetic data or synthetic analytics; causal fills and fee reconciliation; valid metrics/holdout/bootstrap; historical cutoff and explicit unsupported capabilities. The test guide is the specification for expected values.

### Wave 2: complete user workflows

Jobs P17, immutable history/storage P19, frontend orchestration P20, then builder/results/scanner/copilot P21-P24 and accessibility P25. Feature controllers can be developed against frozen fixtures earlier, but cannot be declared complete until the real API integration works.

**Exit gate G2:** cancellations/races are correct, acknowledged edits persist, results retain their input identity, imports are safe, comparisons work, unavailable/partial states are clear, and keyboard/mobile flows pass.

### Wave 3: release in a controlled way

P26-P30. Abuse/access controls, observability and resource budgets, artifact-based deployment, independent reconciliation, honest documentation, and rollback rehearsal.

**Exit gate G3:** full offline regression and production-mode smoke suite; required provider checks separately documented; no unaddressed security/numerical/data-loss blocker; documented limitations and owner actions.

The task index is a dependency graph, not a time estimate. Do not promise calendar dates before measuring the clean baseline and integration workload.

## 5. Definition of success

The following must all be true:

1. The selected symbol, requested period, strategy revision, data checksum, engine version, fee schedule, execution policy, and random seed are recoverable from each run.
2. A signal cannot use future information. Resting stops/targets and next-open rule exits obey declared separate semantics.
3. Final equity, trade net PnL, and actual charged fees reconcile; informational slippage is not charged twice.
4. Unknown IDs, invalid strategies, unsupported execution, missing history, and provider failures produce explicit errors/unavailable states, not plausible substitutes.
5. Demo or modeled fields can never be confused with observed market data.
6. An older request cannot overwrite a newer selection/result; a success badge cannot mask failed storage.
7. Every enabled screen corresponds to a validated implemented capability. Disabled risk options remain visibly disabled.
8. Offline tests reproduce the same financial outputs, and release records contain actual command results, not guesses.
9. The browser cannot retrieve backend artifacts or credentials; provider keys are isolated; expensive endpoints have explicit budgets.
10. The owner can export/recover work and roll back a release without silently rewriting old research results.

## 6. Model coordination

Assign one owner for shared contracts and root files. After contract freeze, parallelize data, engine, storage/jobs, and frontend feature slices with separate edit boundaries. Avoid multiple agents simultaneously rewriting `server.ts`, `App.tsx`, or shared schemas.

Each task ends with changed files, actual commands/results, compatibility impact, limitations, and the next ready ticket. Large financial tasks require independent review and hand-calculated fixtures. See the [handoff handbook](docs/upgrade/05-agent-handoff.md) for exact prompts and report templates.

## 7. Decisions intentionally left to later verified inputs

- Current/historical statutory and broker fee schedules: obtain authoritative effective-date sources before claiming exact charges.
- Market-data licensing, entitlements, and provider coverage: verify before enabling extended capabilities.
- Durable hosting/persistent disk and paid services: the plan does not authorize purchases.
- Public multi-user deployment and live trading: require separate ownership/security/risk decisions and explicit authorization.
- Current main may differ from the reviewed commit: inspect drift before applying line-specific fixes.

These are explicit external dependencies, not permission to stall offline implementation. The core plan supplies defaults for ordinary reversible engineering choices.

## First coding assignment

Give a coding model this instruction:

> Read `UPGRADE_PLAN.md` and `docs/upgrade/05-agent-handoff.md`. Establish the real checkout and starting commit, preserve unrelated work, then implement P00 only. Record actual install/typecheck/build/start and static-artifact tests. Do not change trading math or use production credentials. Report the next ready ticket using the standard completion template.

Then complete P02's security containment alongside P01's harness before proceeding to the strategy contract. No implementation ticket is complete merely because this plan describes it.

## Plan verification record

The planning package was checked for valid local document links, 35 unique task IDs, valid dependency references, an acyclic dependency graph, and complete coverage of all 31 core tickets by the final release gate. Selected ledger, slippage, fee, Sharpe, and Sortino examples were independently recomputed and matched the written expectations. The test specification defines 66 named fixture/journey groups, not 66 executed application tests.

A final source check also confirmed legacy entry and exit groups both use AND, legacy allocation fractions use 0..1 units, and equality uses a small absolute tolerance. The migration contract preserves these details explicitly rather than guessing them.

These are checks on the plan and its examples. They do not mean the application was built, tested, fixed, deployed, or financially certified.
