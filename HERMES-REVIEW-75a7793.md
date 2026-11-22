# Review of the Stragy desk (live, 22 Nov 2026)

Reviewer: OpenCode agent. Method: opened the running desk (loopback :4300 and the
public URL), used the in-app agent, ran real tasks, and exercised edge cases.

## Fixed and committed — `75a7793` on `wip/stragy-repair`

1. **Opening the desk as `http://user:pass@host/` killed the app.**
   Chromium keeps that userinfo in `document.baseURI`, so every relative
   `fetch`/`EventSource` failed with *"Request cannot be constructed from a URL
   that includes credentials"*: chat, session list, cache badge and scanner all
   looked dead. Added `src/frontend/sameOrigin.ts` (leaves ordinary paths
   relative; resolves against `location.origin` only when the base URL carries
   userinfo) and routed the OpenCode, Stragy, voice and approval clients through
   it.
2. **Streaming tool parts painted empty bordered cards.** A tool part arrives a
   beat before its name; `ToolTimeline` rendered the row anyway. It now holds the
   row back until the tool has a name.

Tests added: `src/test/unit/same-origin.test.ts` (relative vs credential base)
and two `tool-timeline` regression cases. 140 targeted unit/component tests pass.

## Verified after the fix

- Credential URL: 10 sessions load, `CACHE 381 symbols`, no console errors.
- In-app agent task ("run the Reliance Supertrend + EMA + Volume scan on NIFTY 50,
  max 20"): answered in 39 s with 7 matches, prices, and honest caveats
  ("first 20 of 50 symbols, not full coverage", "delayed/end-of-day").
- Market Scanner: run completes in 7 s, 8 matches, coverage 20/20, CSV export.
- Stop returns the desk to idle; follow-up chips ("Show the data sources") do
  start a new turn; empty Send is a no-op; session search filters 1/0; reload
  persists; 390 px mobile has no horizontal overflow; Tamil toggle switches UI.

## UI/UX still worth a pass

- Sessions list holds six duplicate "Greeting" entries — dedupe or auto-rename.
- If `GET /api/v2/market/cache` fails, the header says `CACHE 0 symbols` as if
  healthy; it should read "unavailable".
- Mobile session strip clips a chip at the right edge with no fade affordance.
- Scan result "RULE" column shows raw ids (`close gt stf1 · close gt ema200`);
  a human label would read better.

Please rebase/merge `75a7793` into your branch so the fixes are not lost.
