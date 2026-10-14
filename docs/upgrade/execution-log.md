# Implementation execution log

## 2026-10-13: bootstrap and work ownership

- Source root: `G:\Projects\Stragy\stragy-code`.
- Verified starting revision: `163a80c6d603eec2bed28a7e9220b6a867e8dac7`, from the GitHub archive revision comment. Repository main matches the plan baseline.
- Source acquired as a separate archive-based working copy because Git is unavailable on the tool execution path. No Git commit/push has been performed. The planning workspace and empty Python directory were preserved.
- Available runtime: Node 26.5.0, npm 11.17.0. The previously proposed Node 22 baseline is not available in this execution environment. Runtime pin and verification will reflect the actual runtime; cross-version support is not claimed without tests.
- Initial npm wrapper failed because its canonical-path lookup traversed a restricted root. A direct inspected npm CLI launcher with preserved symlink flags and an explicit project working directory succeeds.
- Initial external npm install failed DNS resolution in the shell. A local registry bridge requests package metadata/tarballs through the browser fetch tool; this is tooling only, not application infrastructure. No live market, AI, broker, or paid API traffic is used for ordinary verification.
- Build output paths changed to separate private `dist/server` from public `dist/client`; startup no longer rebuilds missing artifacts.
- Test/lint harness and safe default runtime configuration are in progress. No tests are declared passing yet.

Parallel write ownership:

- Parent: package/runtime/build/test setup, config, app/API integration, operations/release verification.
- Strategy owner: shared strategy schemas/registry/migration/templates and strategy tests.
- Engine owner: indicators/rules/execution/ledger/costs/metrics/robustness and numerical tests.
- Data owner: providers/symbols/cache/calendar/provenance/scanner and data tests.
- UI owner: App/components/client/workspace and frontend tests.
- AI owner: AI adapters/proposals and AI tests.
- Jobs/storage owner: bounded workers/job lifecycle/repositories and infrastructure tests.

Security owner action remains outstanding: revoke/rotate the exposed credential from the baseline. Code removal is not credential revocation. The value is not reproduced here.

## Verification-first continuation

- Compiler integration defects were corrected. Full project `tsc --noEmit` passed on the actual Node26.5 runtime, including the added API regression file. Final source must be rechecked after the last documentation/UI-label fixes.
- Vitest3.2.4/Vite6.4.4 startup was isolated to Rollup4.64.6's synchronous Windows report subprocess. An instrumented probe recorded `spawnSync BEGIN` without return. Reconciled npm to the official `@rollup/wasm-node@4.64.6` alias; the original native import stall was removed. No parser/financial-output stub was used.
- Native esbuild and transform processes encountered denied parent-directory metadata/path resolution. The user approved metadata-only checks, but runtime access remained denied. No broader root permission or sandbox disabling was applied. Scoped/symlink-preserving builds still failed. Stalled diagnostics were terminated.
- Ran unchanged financial/strategy/indicator/jobs/storage/workspace fixtures through `scripts/node-fixture-probe.cjs`: 54 passed, zero failed. This is real Node assert execution, not Vitest certification.
- Ran unchanged API bodies through `scripts/node-api-fixture-probe.cjs`, real Express/Supertest and the file's synthetic mock factory: 12 passed, zero failed, zero unsupported harness errors. A raw legacy-equality comparison was corrected to compare the documented validated representation; migration/exact equality remain separately tested.
- Ran actual worker thread with tsc-emitted source: passed Q01 result schema, next-open110/120 fills, final equity10100 and shutdown. This is not a production-bundle smoke result.
- Corrected Bearer parsing and fail-closed missing successful job output; assigned-ID strategy hashes; corrupt-workspace preservation/quota/occupied-backup/getter/migration cases. Seven workspace regressions and one identity-hash regression are included in the54 checks.
- Removed fabricated template win-rate ranges and misleading library/fee certification claims. Embedded slippage is now explicitly informational in the fee view. Startup checks worker/client/server artifacts. Read-only production smoke script added but not claimed passing.
- Verification-only Vite build with TypeScript transpilation (no subprocess compiler) began main.tsx transformation but stalled and was terminated. Normal production build, full Vitest/coverage/lint, browser/E2E and accessibility are blocked/unverified.
- `implementation-status.md` distinguishes implemented code, verified subsets, remaining defects and explicit release blockers. Core tickets remain in progress; optional P31-P34 stay deferred. No deployment/push/commit/trading/provider login was performed.

## Final safety regression rerun

- Full CommonJS fixture/worker emission and whole-project `tsc --noEmit` both exited0 after all safety source edits.
- Added full result-contract validation to stored-run insertion/open; malformed records fail without rewriting original bytes. Added D06/D07 regressions.
- Added explicit failure for a worker exiting cleanly before output or sending an empty result.
- Disabled the unsafe legacy optimizer path with503 `OPTIMIZER_WORKER_REQUIRED`. The local-draft API fixture now verifies this refusal and zero execution/enqueue.
- Final executed results: **56 core fixture bodies passed, 12 API bodies passed with zero unsupported harness errors, and 3 real-worker probes passed**. No normal Vitest/coverage, build, browser or release certification is implied.
- Final machine-readable reports and compiler statuses are saved under `docs/upgrade/verification`. Prior reports remain historical evidence only.

## Native release-candidate verification (2026-10-14T16:37:46.825Z)

Owner-disabled sandbox restrictions enabled real standard verification and existing workflow-authorized GitHub CLI access. Standard coverage:261 passed,25 files,0 failures. Configured core coverage:94.85% statements/lines,79.54% branches,95.83% functions. Standard typecheck, lint and production build passed. Official Terser plus real TypeScript private emission avoid native compiler failures without stubbing results. Local production startup/read-only smoke and browser library save/duplicate/trash/restore passed. Browser-found false live status, benchmark/capital labels, missing provenance and false draft-change handling corrected. Main/production is not the review delivery target. Full manual accessibility, all E2E journeys, real-feed/fee verification and hosted durability remain unverified.
