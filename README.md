# Stragy research upgrade

React 19, TypeScript, Vite, Tailwind, Express and Zod trading-research workspace. The reviewed starting revision was `163a80c6d603eec2bed28a7e9220b6a867e8dac7`.

## Current status

Stragy now opens as a clean research conversation, with advanced tools tucked away. Natural-language screens and stock follow-ups lead to a plain-English review before execution. The research upgrade includes observed daily data, official Nifty 50 membership and causal temporal RSI screening. Deployment verification is recorded separately; none of this certifies live trading.

Verified with Node **26.5.0** and npm **11.17.0**:

- Standard Vitest run: **424 tests passed, 45 files, zero failures**.
- Historical pre-redesign configured financial/strategy coverage: **96.21% statements/lines, 79.64% branches, 97.29% functions**. This is not whole-application coverage.
- Standard typecheck, lint and production build passed. Typecheck enables strictNullChecks; full TypeScript strict mode is not claimed.
- Local production startup and read-only smoke passed, including denial of backend artifacts and environment files.
- Production browser checks confirmed explicit local save, duplicate, soft-delete and restore. Automated component tests cover revisions, storage failures, recovery conflicts, draft-only copilot actions and request ownership.

See [chat-first design and flows](docs/upgrade/chat-first-ui.md), [independent redesign verification](docs/upgrade/verification/chat-first-release-report.json), [observed-data and chat behavior](docs/upgrade/observed-data-chat.md) and [current release verification](docs/upgrade/verification/observed-release-report.json). The original [implementation report](docs/upgrade/implementation-status.md), native-release report and fallback-probe reports are historical. Full manual accessibility/responsive review, all planned E2E journeys and hosted durability remain unverified.

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

The public-research deployment uses **observed Yahoo daily OHLCV**, not generated prices or live tick streaming. Nifty 50 membership comes from the official NSE CSV; current constituents introduce historical survivorship bias. Results expose source, cutoff, checksum, freshness, coverage, assumptions and warnings. Unavailable real data never falls back to generated bars. Catalog reference prices are not observed quotes and are hidden outside demo mode. The benchmark is the actual instrument's buy-and-hold series, not an unrelated index.

Local development defaults to an explicitly labelled deterministic demo. Real mode requires `MARKET_PROVIDER=yahoo`; this public adapter is not a licensed exchange feed. Cash-fee rates are dated illustrative assumptions, not certified statutory/broker schedules. DP and other broker-specific charges are excluded. Calendars, corporate actions, settlement, tick/lot/margin rules and entitlement require independent review.

Optional local-file server storage is atomic and single-instance, not multi-instance storage or verified durability on ephemeral hosts. Public modes disable server strategy saves; browser-local My Strategies remains available. There are no broker logins or live orders. External AI in public-research mode requires per-request zero-price verification and has no paid fallback. The existing provider key may need permission to use the selected free model; a parser is never labelled AI.

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

Private production requires an explicit API token or an independently verified authentication boundary. Do not publish a private instance without that verification. The Render blueprint uses public-research mode on the existing free service; deployment and provider connectivity must be checked independently.

Run manifests use SOURCE_COMMIT or Render's RENDER_GIT_COMMIT when it is a valid commit SHA; otherwise they honestly report unknown-working-tree rather than labeling modified code as the old baseline.

The build uses the official Rollup WASM Node distribution and Terser, avoiding native Windows compiler temporary-file failures. The real TypeScript compiler emits private server/worker modules. No parser, financial results or assertions are stubbed in the standard suite.

## Owner action and scope

The credential-shaped fallback removed from the original baseline must still be **revoked/rotated by its owner**, including copies in repository history. No value is reproduced here.

See `UPGRADE_PLAN.md` and `docs/upgrade/TASKS.json`. Plan acceptance criteria that have not been independently verified remain open. Optional P31-P34 work (licensed extended feeds, advanced research, accounts and order execution) is deferred.

## Architecture (OpenCode UI)

The chat is a standalone [OpenCode](https://opencode.ai) web UI; Stragy stays the single owner of market data and jobs. Two processes talk over loopback only:

| Process | Port | Owns |
|---|---|---|
| Stragy server (`qa/start-server.sh`) | 127.0.0.1:3000 | job runner, SQLite candle cache, Angel One session, approvals, saved strategies |
| Launcher + UI gate (`qa/start-opencode-app.sh`, `scripts/ui-gate.mjs`) | 127.0.0.1:4200 | public socket, auth passthrough, API filtering, streaming proxy |
| OpenCode server (`opencode serve`, child of the launcher) | 127.0.0.1:4201 | chat sessions, streaming, native tool states, web UI (loopback only) |

`instabox-port publish 4200` exposes the gate; the public tunnel and all existing URLs stay on `:4200`. Basic auth user `opencode`, password in `opencode-app-data/password.txt`. The launcher uses isolated `XDG_CONFIG_HOME`/`XDG_DATA_HOME`, so the operator's own providers, plugins and sessions are not loaded. The old Stragy screens stay at `:3000` (unlinked).

**Security gate.** The launcher owns the gate on `:4200` and streams to `opencode serve` on `:4201`, blocking the API families a password-holder could abuse for host code execution: `pty`/`shell`/terminal, `fs`, `plugin`, `credential`, `rpc`, `debug`, `worktree`, `generate`, `schedule`, integrations, RPC/agent switching and directory pivots. The UI remains the chat — login, SSE, uploads, models, agents and all Stragy tool calls pass through unchanged; config/model responses are redacted so provider API keys are not exposed. `terminal.toggle`/`terminal.new` may still appear in the command palette, but their API calls return 403. See `qa/pass-06/security-gate.md` for the full audit and evidence.

**Loopback bridge + plugin autostart.** `opencode-app/plugin/index.ts` (copied to `opencode-app-data/workspace/.opencode/plugins/stragy`) fetches `GET /api/v2/engine/tools` and forwards each call to `POST /api/v2/engine/tools/:name` with `x-stragy-session: <session id>`; attachments go to `POST /api/v2/engine/attachments`. These are the same 29 executors as the embedded engine — no second implementation and no second Angel session. Long jobs (scan/chart/backtest/refresh) are awaited inside the tool (3 s polling, 15 min cap), so the model sees one call; stopping the turn aborts the fetch while the job keeps running, and `list_jobs` recovers it later. The bridge is loopback-only and honours `STRAGY_TOOL_TOKEN`. The plugin also starts the backend itself when `/health/ready` is down: with `STRAGY_HOME` set and `STRAGY_AUTOSTART != 0` it spawns the canonical `qa/start-server.sh`, waits up to 60 s for readiness, and sets `STRAGY_AUTOSTART=0` in the child to avoid recursion.

**Model policy.** The UI keeps OpenCode's normal catalog and provider ids (the launcher deliberately does not disable providers), so the operator's usual models appear in the selector. The engine config fixes the default and the `stragy` agent to the free `opencode-go/hy4-flash-free` (zero input/output cost); E2E step b verified both through `/api/model/default` and `/api/agent`. Paid use is gated on the Stragy side: `AI_COST_POLICY=free-only` by default, paid models only via explicit `AI_APPROVED_PAID_MODELS`/chain approval, a model-selection route that exposes only configured models and rejects unapproved paid ones, and a public-research exposure check that refuses to start with unapproved paid AI. The engine config also denies every host shell/file/web tool to the agent — only Stragy tools run.

**Slash commands.** `/scan`, `/check` and `/cache` are defined in the OpenCode config (`opencode.json`) alongside built-ins `/init`, `/review` and `/goal`. They are a config surface (no CSS/DOM injection), so an OpenCode UI update cannot break them; `GET /api/command` lists them.

**Chart images.** The UI stores an upload on the user message (`files[].data`, base64); `read_chart` reads Stragy's own per-session context. The plugin finds the newest image in the conversation, uploads it to `/api/v2/engine/attachments` (returning an `imageId`) and passes that id into `read_chart`. A chart read requires a valid current workspace strategy to preserve exits, risk, sizing and costs; without one the tool returns a typed `STRATEGY_REQUIRED` failure instead of inventing an interpretation (E2E step e verified the attachment plus an honest typed failure). A real, successful read with a workspace strategy is recorded in `qa/pass-05/report.md`. Vision-provider outages remain possible; in that case chart reads degrade honestly rather than being fabricated.

**MCP package.** `stragy-mcp/` is a thin stdio MCP server that forwards to the same loopback bridge (29 tools, long jobs settled inside the tool call). Client snippets for Claude Desktop, Cursor, OpenCode and Codex are in `stragy-mcp/README.md`; E2E step f verified `listTools` and `get_data_cache` through it.

**Ops scripts** (under `qa/`):
- `start-all.sh` — idempotent: leaves healthy processes alone, starts only what is down, waits for both health checks and prints the public URL.
- `backup.sh` — copies the three SQLite databases (with their `-wal`/`-shm` sidecars) plus UI config and password to `/data/backups/stragy-<UTC>/`, prunes after 14 days, and checkpoints only the copy, never the live DB.
- `warm-cache.sh` — queues cache-refresh jobs (NSE up to 200 symbols and NIFTY 50), polls them and writes a report; `install-warm-timer.sh` schedules it on weekdays.
- `rotate-password.sh` — operator-only: writes a new 24-character `password.txt` (mode 600) and restarts **only** the UI, invalidating every browser session/pairing. Never run it as part of an audit.

**Honest limits.**
- `maxSymbols` and universe scans are capped at **200 symbols** (`MAX_SCAN_SYMBOLS`), a subset of roughly 2,051 configured NSE symbols; every result states the evaluated window and whether data came from cache or a provider fetch.
- Some symbols have no verified Angel One token and stay `UNKNOWN_MAPPING` (12 of the warmed 200 NSE symbols; hundreds more across the full catalog) — no look-alike mapping and no invented data.
- Prices are observed **end-of-day/delayed daily bars**, not live tick streams; `liveLtp` (when present) is the only live quote.
- The public `instabox-port` URL answers only while this machine runs, and a Cloudflare quick tunnel cannot stream the UI (it buffers roughly the first 128 KB of SSE). The link is revoked/replaced when re-published.
- The UI's project list is per browser: the first visit needs **Add project → Select folder** once.
- End-to-end proof and per-step evidence live in `qa/pass-06/e2e-report.json`, with console output in `qa/pass-06/e2e-run.txt`.

## License

MIT. Original project: Abinash Balaraman, [stragy](https://github.com/AbinashBalaraman/stragy).
