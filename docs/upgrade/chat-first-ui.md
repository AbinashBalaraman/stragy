# Chat-first UI upgrade

## Outcome

Stragy now opens as a research conversation rather than an administration console. The default route is a centered, approximately 800 px conversation with a small Stragy identity, a **New chat** action, saved strategies, and a collapsed **Advanced tools** disclosure for the builder, scanner and analytics. The builder, scanner and library are unchanged in capability and remain fully reachable.

The visual language moved from neon mint to a calm charcoal surface (`#101012`, `#171719`) with a soft blue accent (`#a8c7fa`). The accent is defined once in `src/index.css` and applied through the existing components, including the builder controls and results charts.

## Shell and navigation

`src/components/layout/AppShell.tsx` owns the responsive frame.

- Desktop: a narrow sidebar with **New chat**, **Conversation**, **Saved strategies**, data-mode copy and the **Advanced tools** disclosure. The disclosure exposes exactly three advanced views: Strategy builder, Market scanner and Backtest analytics.
- Mobile: a compact header with an **Open navigation** button and a separate **New chat** action.
- The mobile drawer is an `aria-modal` dialog. Opening it moves focus to its close button, traps Tab/Shift+Tab inside the drawer, locks page scrolling, closes on Escape, closes on overlay click, and restores focus to the trigger. Navigation from the drawer closes it.
- The Stragy identity and the **Conversation** item return to chat without clearing history. **New chat** is the only action that archives the current conversation.

`src/App.tsx` defines `AppView = 'chat' | 'builder' | 'results' | 'scanner' | 'library'` and defaults to `chat`. The chat subtree stays mounted while advanced views are shown (`hidden`), so a scan, draft proposal, review or message history is not thrown away by navigating to the builder or scanner.

## Conversation architecture

`src/components/chat/AiCopilotDock.tsx` is now the primary full-size conversation (`variant="full"`); the old dock variant remains available.

- Warm empty state with three starter prompts.
- One composer with Enter to send, Shift+Enter for a newline, and IME composition respected (`isComposing` / keyCode 229).
- Visible pending states for research, screening and a running backtest, each with an explicit cancel action.
- Messages persist to `stragy_copilot_review_history_v2` (bounded to 40 messages). History is validated with Zod before use, so malformed or injected records are ignored rather than rendered.
- **New chat** archives the current conversation to `stragy_copilot_previous_conversation_v1` and offers **Restore previous conversation**. Starting a new chat does not silently erase recoverable local history.
- A reply is labelled by its actual source: `Local keyword rules · not AI`, `Built-in rule parser · not AI`, or the provider/model the server reports. A local parser is never described as AI, and unavailable responses are not presented as answers.
- Provider or transport failures appear as plain alerts. No result, match count or metric is invented on failure.

## Screen result cards

`src/components/chat/ScreenResultCard.tsx` shows the short answer first and keeps provenance behind disclosures:

- Match count, `succeeded / requested` coverage, unavailable and failed counts, source coverage, and the actual observation date.
- Partial coverage is stated in the headline area; failed provider rows are summarised instead of being hidden.
- `No successful data coverage. Matches are unknown, not zero.` is used when nothing succeeded. Zero matches are shown only when stocks were successfully evaluated.
- Demo scans are rejected before rendering as current market answers. A demo result badge says **Demo data — not observed**.
- Assumptions, exact rules, source coverage, observation ranges, warnings and technical provider errors live in a disclosure.
- Screening remains read-only. Each match offers **Prepare backtest for {TICKER}**, which prepares a review and never runs it.

## Follow-ups and explicit consent

`src/components/chat/researchFollowUp.ts` handles the narrow follow-up language locally, so the safe path does not depend on an external model:

- `parseBacktestIntent` recognises explicit backtest/test/simulate/re-run phrasing and extracts a stock after “on/for”. Pronouns such as “this” remain a missing stock rather than becoming a ticker.
- `resolveStock` accepts an exact ticker (including `.NS`/`.NSE`/`.BSE`), an exact company name, a unique token in the message, or a unique prefix. Multiple candidates produce an ambiguity question; no candidate produces a missing-stock question. It never picks the first stock.
- Follow-ups such as “backtest this on RELIANCE” prepare a review from the validated current screen or draft. Preparing does not apply, save or run anything.
- `classifyReviewReply` separates choosing assumptions from execution. “Use these assumptions” alone is `assumptions` and never runs. Only an explicit execution phrase such as “use these assumptions and run”, “run it”, “go ahead and run” or “approve/confirm/proceed” approves, optionally prefixed by yes/ok/sure/please.
- A negation wins whenever the reply is about approval or execution, so “no, don’t run it”, “use these assumptions but do not run” and mixed replies such as “…and run, but do not sell” are rejections. Ambiguous chatter is not consent.
- Strategy work is not mistaken for review consent. A new instruction such as “change stop loss to 5%” is classified as a new research request, not a rejection of the review and never as approval.
- A new strategy, screen or change request **immediately** sets aside an unapproved review before the request is sent. If that request then fails, unavailable, or never returns, the old review is gone and a later “run it” receives “There is no current backtest review to approve”. The set-aside is announced in the conversation; nothing is run.

`src/components/chat/BacktestReviewCard.tsx` freezes and explains the exact assumptions in plain English: entry rules, exit rules, stop/target/trailing stop, sizing, execution and next-open fills, initial capital, brokerage/slippage/taxes, data window and limitations. Running requires **Use these assumptions and run** (button) or an explicit approval message. Selecting the assumptions alone does not start the run.

`src/shared/strategy/backtestReview.ts` supplies that copy. Screen-based reviews combine the screen’s validated entry rules with the user’s current workspace exits, risk, execution and costs; draft-based reviews use the validated draft as-is. The current exit set is copied exactly, including an intentionally empty exit set, so old screen exits can never be reinstated silently. If a current exit rule references an indicator that is absent from the screen or defined with different settings, review preparation refuses with a clear message and nothing is run. The review stores an origin snapshot of the workspace. If the workspace changes before approval, the run is refused and a fresh review is required.

The plain-English review describes the engine that actually runs, not generic trading behaviour:

- Long-only, cash-funded daily research; configured short entries are not executed.
- Signals are evaluated on a completed daily bar and fill at the next session open with market orders; `LIMIT` order settings are not executed.
- Intraday square-off settings are ignored by the daily engine.
- Open positions are liquidated at the final close by default; disabling end-of-data liquidation marks them to the final close instead.
- The drawdown cutoff pauses new entries and closes an open position at the next available open; gaps and fees can exceed the threshold.
- A gap through a stop fills at the open, and a bar touching both stop and target assumes the stop first.
- Fixed-fraction and fixed-risk sizing use available cash, not current equity; fixed quantity fails rather than silently reducing an unaffordable quantity.
- The flat brokerage and slippage are included. Illustrative, unverified statutory rates may also be included; percentage/tiered broker fees, DP charges and other broker-specific charges are not, and are described that way without claiming the included flat brokerage is excluded.

Apply, save and run remain distinct:

- **Apply draft** changes the workspace draft only and does not switch views.
- **Save to My Strategies** uses the existing browser-local library and lock/revision contract.
- **Prepare backtest** opens a review.
- **Use these assumptions and run** is the only path that calls the backtest endpoint.

## Backtest headline honesty

`src/components/chat/BacktestResultCard.tsx` renders only the chat-owned result that `AiCopilotDock` has validated against the current review. `App` no longer passes its advanced analytics result into the conversation, so selecting or retaining a result elsewhere cannot inject an unrelated inline headline. On **New chat** the conversation headline is cleared with the messages and review, while the retained advanced analytics result remains available.

- Strategy, ticker, source, observed-through date and dataset range.
- Headline return, net P&L, CAGR, Sharpe, max drawdown and trade count.
- Null or non-finite metrics render as **Unavailable**, with the server’s `unavailableReasons` as the title; they are never turned into zero.
- Demo provenance is labelled **Demo data — generated bars, not observed market prices** with an explicit warning. Missing provenance is **Data mode unavailable — treat results as unverified**. Only a real `mode` produces the observed-data badge.
- Verbose trades, costs and provenance stay behind the explicit **View details** action, which opens the existing analytics view.

`src/components/chat/runSummary.ts` reads only fields the server returned (`provenance`, then `manifest.data`), and falls back to the last bar date only when no explicit observed date exists. It never infers a real mode.

## Run ownership and stale completion

A chat-requested backtest is tied to the review that started it:

- The conversation owns its displayed headline. Starting a run clears that chat-owned headline so an old validated result cannot stand in for a pending, failed or cancelled run. Retained advanced analytics results are not cleared.
- The review captures the workspace origin snapshot. If the workspace changes, the review is set aside, run ownership is invalidated, and the stale callback is ignored; the conversation announces that nothing was run.
- **Cancel research**, **New chat**, workspace changes, unmounting and superseding requests all advance a run generation. A late callback from an older generation cannot mark the review complete or append a completion message.
- Completion additionally requires a current validated `BacktestResponse` with a backtest id, metrics, bars and trades. It must match the reviewed ticker and symbol, the validated canonical reviewed strategy content (not merely a reused strategy id, including two drafts with no id), and the requested data cutoff when the review has one. Canonical identity uses `validateStrategy(...).canonicalData`, so engine-added execution defaults are recognized as the same strategy while genuine rule, symbol and cutoff changes are still refused. A callback that fails any identity check shows "did not return a current validated result", renders no headline and never marks the run complete.
- An unapproved review is set aside before a new backtest intent is resolved. A missing or ambiguous second stock therefore cannot leave the old review available for a later “run it”.
- Scanning, research requests and backtests keep separate ownership and abort controllers, so cancelling one does not resolve another as if it had succeeded.

## Preserved safeguards

- Browser-local strategies, revisions, locks, conflict/recovery handling, undo and export are unchanged.
- Scanner ownership, cancellation and draft state are unchanged; the scanner still validates the observed cutoff before a backtest.
- Run ownership (`RequestOwner`) and abort controllers are still used for research and backtests. Late responses and cancelled work are ignored, a cancelled scan is not presented as zero matches, and a cancelled or superseded backtest is not announced as complete.
- Provider selection, keys, allowlisted endpoint, free-only pricing policy, permissions and cost guards were not changed.
- No broker order path was added. No deployment, git initialisation or history rewrite was performed.

## Limitations

- Follow-up understanding is deliberately narrow and deterministic. It handles explicit screen/draft backtest requests, stock identity, review approval and negation. Broader free-form requests still go through the configured research-chat endpoint and are labelled by the provider that actually answered.
- Stock resolution works from the NSE symbol list supplied by `/api/symbols`. If that list is unavailable, the conversation asks the user to reload rather than guessing.
- A screen-based review overlays the user’s exact current workspace exits, sizing, execution and costs. An empty current exit set stays empty. Exits whose indicators are missing from, or differ from, the screen are refused rather than reinterpreted.
- The plain-English review documents the engine’s actual long-only daily market-order behaviour and defaults, including ignored short/limit/intraday settings, final-close liquidation and gap/fee limits. It is not a general description of every broker or trading style.
- The headline card is intentionally concise. Trade-level detail, robustness and comparisons remain in the advanced analytics view.
- Demo scans are refused in the conversation even when they are empty, because an empty demo scan is not evidence about current markets.
- The verification below is offline. It does not prove live Yahoo/provider connectivity or production behaviour.

## Planner review follow-up

All five review findings were addressed before completion:

1. **Obsolete review after a failed request.** A new strategy/screen/change request now sets aside an unapproved review before the network call. Regression coverage fails the new request and then tries to approve the old review.
2. **Workspace change and stale run completion.** Workspace changes clear the review, invalidate run ownership and advance the run generation. Completion now requires a validated result matching the reviewed ticker/strategy. Tests cover workspace change, cancel and new chat while a run is pending, plus a callback that resolves without a validated result.
3. **Assumptions are not execution consent.** “Use these assumptions” is a distinct non-executing reply; conditional, negative and mixed replies reject. A later affirmative phrase cannot approve a superseded review.
4. **Exact exits and indicator semantics.** The current exit set is overlaid exactly, including empty. Missing or changed indicator definitions are refused by `exitRuleCompatibility`; unit and component tests cover both.
5. **Review copy matches the engine.** Review text now states long-only cash-funded daily market orders, ignored short/limit/intraday settings, default end-of-data liquidation, next-open drawdown exit with gap/fee overrun, and clearly distinguishes included flat brokerage from excluded percentage/tiered and DP charges.

## Independent review follow-up

The later independent review's five release blockers were addressed:

1. **No direct run from primary chat.** The redundant **Run current workspace** and **Open scanner** footer controls and their callbacks were removed from `AiCopilotDock` and `App`'s conversation props. The only direct backtest control remains in the intentional advanced Builder. Regressions assert the conversation has no such shortcuts.
2. **New backtest intent supersedes first.** An unapproved review is set aside before a follow-up backtest intent is resolved, including when the named stock is missing or ambiguous. Tests prepare a RELIANCE review, make a second backtest request for an unknown or ambiguous stock, then prove approval cannot run the old review.
3. **Canonical result identity.** Each review freezes `canonicalStrategySignature(candidate)`, which now serializes the validated canonical representation `validateStrategy(candidate).canonicalData` rather than raw JSON. This mirrors `src/client/api.ts` and treats engine-normalized defaults such as `execution.executionPolicy = 'next_open_long_cash_v1'` and `execution.liquidateAtEnd = true` as the same reviewed strategy, without dropping rule, symbol or cutoff checks. Completion compares that canonical content (not just `strategy.id`), symbol identity and the requested cutoff. The conversation renders its own result only after that validation; `App` no longer publishes the advanced analytics result into the chat. Tests cover different rules under the same strategy id, a different symbol, and a result that ignores the reviewed cutoff: none completes nor renders a headline. A normalized server response supplying engine execution defaults omitted by the review does complete, exercised through the production app/job/simulate path.
4. **Conversation result ownership.** The chat headline is local to `AiCopilotDock` and reset on **New chat**; the retained advanced analytics result survives. The app-level regression completes a chat run, starts a new chat (welcome state, no headline), confirms analytics still shows the retained run id, then returns to the welcome chat.
5. **Clean primary surface and honest status.** The primary footer keeps only conversation actions. Mode/provider copy does not claim free-form AI works: external AI is described as conditional on a server-reported connected provider, and an unavailable provider is stated rather than answered.

## Final browser follow-up

The compiled-preview browser check found one remaining false rejection: a valid server backtest was refused because review identity used sorted raw JSON, while the engine returns the same strategy with normalized execution defaults (`executionPolicy = 'next_open_long_cash_v1'` and `liquidateAtEnd = true`).

`canonicalStrategySignature` now validates both sides and serializes `validateStrategy(...).canonicalData` with the shared canonical JSON helper, matching `src/client/api.ts`. Review preparation also refuses invalid canonical content instead of freezing an unusable signature. Genuine strategy-content, symbol and cutoff differences remain rejected.

Regression coverage added:

- Unit: a review omitting the optional execution fields matches the engine-normalized response; different rules and a different symbol still differ.
- Component: the chat completes and renders its headline when the run returns the normalized strategy.
- Integration: the production app, job manager and `simulate` path returns execution defaults and preserves review identity with the submitted strategy.

Targeted checks passed 3 files / 53 tests. The full gates below were rerun after this fix. No deployment was performed.

## Verification

Commands were run with the pinned native Node runtime:

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | Passed |
| Lint | `npm run lint` | Passed |
| Tests | `vitest run --configLoader native --maxWorkers=1` | 45 files, 424 tests passed |
| Production build | `npm run build` | Passed; client bundle and private server/worker output built |

New or updated tests cover:

- Chat-first default, hidden advanced controls, advanced navigation and route separation.
- Mobile drawer role, focus move, Tab trap, Escape close, focus restoration and drawer navigation.
- Conversation remaining mounted with history intact across builder navigation, plus archive/restore on **New chat**.
- Explicit review before run, negation rejection, and approval only on unambiguous consent.
- Assumptions-only and conditional/mixed replies (“use these assumptions”, “…but do not run”) never execute, and choosing assumptions is separate from running.
- A new request immediately supersedes an unapproved review; when that request fails, a later approval phrase is refused.
- Failed-change-then-approval, workspace change, cancellation and new-chat while a run is pending; stale callbacks neither complete the review nor announce a headline.
- A callback without a current validated result does not mark the run complete.
- Exact empty exits are preserved, and screen reviews refuse exits whose indicator semantics differ.
- Correct stock identity for a follow-up and ambiguity/missing-stock questions.
- Stale/cancelled scan ownership and ignored late results.
- Screen coverage honesty (partial, failed, all-unavailable, demo refusal).
- Backtest provenance honesty, null metrics as unavailable, demo/unknown labels and the explicit **View details** action.
- The primary conversation has no direct workspace-run or scanner shortcut, so a chat run cannot bypass review and approval.
- A later backtest intent for a missing or ambiguous second stock supersedes the prepared review; approval afterwards is refused and nothing runs.
- Wrong strategy rules under the same strategy id, a different symbol, and a result that ignores the reviewed cutoff do not complete the review or render a headline.
- A review omitting optional execution fields completes against the engine-normalized strategy with `executionPolicy`/`liquidateAtEnd` defaults; unit and production app/job/simulate integration coverage prove the canonical identity match.
- End-to-end app coverage that **New chat** restores the welcome state with no conversation headline while advanced analytics keeps the retained run id and still shows it after returning to chat.
- Unit coverage for follow-up intent/stock/consent parsing, engine-accurate plain-English review assumptions (long-only, cash sizing, drawdown/gap/fee limits, ignored short/limit/intraday settings, default end-of-data liquidation and included flat brokerage), and run provenance summaries.

Files added or materially changed:

- `src/App.tsx`
- `src/components/layout/AppShell.tsx`
- `src/components/chat/AiCopilotDock.tsx`
- `src/components/chat/ScreenResultCard.tsx`
- `src/components/chat/BacktestResultCard.tsx`
- `src/components/chat/BacktestReviewCard.tsx`
- `src/components/chat/runSummary.ts`
- `src/components/chat/researchFollowUp.ts`
- `src/components/chat/types.ts`
- `src/shared/strategy/backtestReview.ts`
- `src/index.css`, `index.html`, and the existing components whose accent colours moved to `#a8c7fa`
- `src/test/components/ai-proposal-dock.test.tsx`
- `src/test/components/research-chat-flow.test.tsx`
- `src/test/components/app-shell.test.tsx`
- `src/test/components/chat-first-app.test.tsx`
- `src/test/components/backtest-result-card.test.tsx`
- `src/test/unit/researchFollowUp.test.ts`
- `src/test/unit/backtestReview.test.ts`
- `src/test/unit/runSummary.test.ts`
- `src/test/integration/api.test.ts`
