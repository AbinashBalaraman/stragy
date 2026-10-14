# Stragy research upgrade

React 19, TypeScript, Vite, Tailwind, Express and Zod trading-research workspace. The reviewed starting revision was `163a80c6d603eec2bed28a7e9220b6a867e8dac7`.

## Current status

Core research implementation is integrated and verified locally. This is a review candidate, not a production deployment or certification of live trading.

Verified with Node **26.5.0** and npm **11.17.0**:

- Standard Vitest coverage run: **261 tests passed, 25 files, zero failures**.
- Configured financial/strategy coverage: **94.85% statements/lines, 79.54% branches, 95.83% functions**. This is not whole-application coverage.
- Standard typecheck, lint and production build passed. Typecheck enables strictNullChecks; full TypeScript strict mode is not claimed.
- Local production startup and read-only smoke passed, including denial of backend artifacts and environment files.
- Production browser checks confirmed explicit local save, duplicate, soft-delete and restore. Automated component tests cover revisions, storage failures, recovery conflicts, draft-only copilot actions and request ownership.

See [current evidence and limitations](docs/upgrade/implementation-status.md) and [machine-readable native verification](docs/upgrade/verification/native-release-report.json). Earlier fallback-probe reports are historical, not the current test certification. Full manual accessibility/responsive review, all planned E2E journeys and hosted durability remain unverified.

## Research behavior

- Daily (1D), long-only, cash-funded market orders. Close signals fill at the next open.
- Conservative gaps, stop-first intrabar ambiguity and next-bar trailing-stop changes.
- One fee-inclusive reconciled cash ledger. Slippage is embedded in fills, not charged twice.
- Explicit warmups, bounded requested evaluation windows and nullable undefined metrics with reasons.
- Seeded return bootstrap, independent chronological holdout windows and actual sensitivity reruns. These are exploratory diagnostics, not forecasts.
- Strict canonical strategy validation, documented legacy migration and explicit equality tolerance.
- Bounded jobs, cancellation, idempotency conflicts and immutable run identity. Incompatible runs are not ranked together.
- Local-first My Strategies: explicit save-as, rename, duplicate, immutable revisions, JSON export, trash/restore, retention limits and Web Locks conflict protection. Quota/denial failures are visible; corrupt bytes are preserved before replacement.
- Reviewed imports and one-step draft undo. Selecting retained results does not replace the builder draft.
- Copilot proposals are drafts. Applying and running are separate explicit actions. External AI is disabled by default.
- Historical scanner cutoffs are retained when launching a backtest. Modeled derivatives/order previews are labeled and never submit orders.

## Data and safety

Default bars are **deterministic generated demo data**, not observed market prices. Demo weekdays span 2024-01-01 through 2026-09-30. Reference prices and universe metadata are illustrative/unverified, not a live feed or point-in-time investable universe. Results expose source, cutoff, checksum, assumptions and warnings. The benchmark is the actual instrument's buy-and-hold series, not an unrelated index.

Real data fails closed unless an entitled adapter is installed and independently verified. Cash-fee rates are dated illustrative assumptions, not certified statutory/broker schedules. DP and other broker-specific charges are excluded. Calendars, corporate actions, settlement, tick/lot/margin rules and entitlement require independent review.

Optional local-file server storage is atomic and single-instance, not multi-instance storage or verified durability on ephemeral hosts. Public-demo mode disables server strategy saves. There are no default paid AI calls, broker logins or live orders.

## Install and verify

Use the pinned runtime in `.node-version` and the npm lockfile:

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
```

`npm run dev` starts local demo development. The build produces public `dist/client` and private server/worker modules under `dist/server`. `npm start` requires these artifacts and never rebuilds automatically.

For a local production demo, set NODE_ENV=production, DATA_MODE=demo, AI_PROVIDER=none, EXPOSURE_MODE=demo-public, STORAGE_MODE=ephemeral and HOST=127.0.0.1 before starting. Then run `npm run test:smoke` against that server (SMOKE_BASE_URL selects its local port).

Private production requires an explicit API token or an independently verified authentication boundary. Do not publish a private instance without that verification. No production deployment is implied by this source branch.

Run manifests use SOURCE_COMMIT or Render's RENDER_GIT_COMMIT when it is a valid commit SHA; otherwise they honestly report unknown-working-tree rather than labeling modified code as the old baseline.

The build uses the official Rollup WASM Node distribution and Terser, avoiding native Windows compiler temporary-file failures. The real TypeScript compiler emits private server/worker modules. No parser, financial results or assertions are stubbed in the standard suite.

## Owner action and scope

The credential-shaped fallback removed from the original baseline must still be **revoked/rotated by its owner**, including copies in repository history. No value is reproduced here.

See `UPGRADE_PLAN.md` and `docs/upgrade/TASKS.json`. Plan acceptance criteria that have not been independently verified remain open. Optional P31-P34 work (licensed extended feeds, advanced research, accounts and order execution) is deferred.

## License

MIT. Original project: Abinash Balaraman, [stragy](https://github.com/AbinashBalaraman/stragy).
