# Guide: turning a chart screenshot into scannable conditions

Audience: any vision model used by Stragy, including small free ones.
Goal: describe the setup the chart's author is pointing at, as conditions the scanner can test on every stock's last bar.
The goal is NOT to describe this one stock's past.

Work in the order below. Do not skip a step. When unsure, write `null` or "unknown". Never guess.

## Step 1. Read the header and frame (facts only)
- Symbol and exchange, e.g. "Himatsingka Seide Limited · 1D · NSE".
- Timeframe: 1D = daily bars, 1W = weekly. The app scans daily bars, so note a weekly timeframe in the assumptions.
- The O/H/L/C values and the change on the last bar, e.g. "C 67.87 +4.66 (+7.37%)".
- Capture date, if printed (e.g. "Sep 23, 2026"). This is "now" for the chart.
- The x-axis span, e.g. Nov → Oct, which is about 11 months. On daily charts, count about 21 bars per month.

## Step 2. List every panel and its legend
- The price panel. Then each indicator panel, with its legend copied exactly, e.g. "RSI (14, close) 45.76 31.90".
- **Legend numbers are current values, not thresholds.** In "RSI (14, close) 45.76 31.90", 45.76 is RSI now and 31.90 is its moving average (the yellow line) now.
  - Match each number to the line by the coloured tag on the right axis: purple = RSI, yellow = its MA.
- Horizontal dashed lines are the indicator's bands. For RSI these are usually 70 / 50 / 30. A shaded zone below 30 or above 70 marks oversold or overbought.
- Overlays on price (moving averages, Bollinger Bands, VWAP, Supertrend): name each one and its period from the legend.
- If volume isn't shown, say so. Never add a volume condition you can't see.

## Step 3. Find what the author drew
User-drawn lines, boxes and arrows ARE the thesis. Weight them highest.
For each drawing, record:
- the panel it's on (price or RSI);
- its direction (rising, falling or flat);
- its start and end points: approximate date and value, e.g. "starts at the RSI peak ~73 in late Jun, ends at ~30 in early Oct";
- what the last bar does relative to it: crossed above, crossed below, touching, or not reached.

A falling line over peaks that the last bar has just crossed is a **breakout**. A rising line under lows that has just broken is a **breakdown**.

## Step 4. Describe the last few bars (the "now")
Scanners test the latest bar, so be precise about the right edge:
- the last candle: colour and size. A +7% day is a big up candle.
- where RSI is now, and whether it just crossed something (its MA, 30, 50, the drawn line);
- what happened in the few bars before, e.g. "RSI was below 30 a few bars ago, now 45";
- price versus its range: near the period low or high, and roughly how far, e.g. close 67.87 vs low ~61 is about 11% above the low.

## Step 5. Describe the background (context, lower weight)
- Trend: lower highs and lower lows = downtrend.
- Distance from long averages, if one is drawn.
- Markers like **E** (earnings), **D** (dividend) and **S** (split) are calendar events. They are NOT conditions. Ignore them unless the user asks.

## Step 6. Translate into catalog conditions
Use ONLY the condition catalog the app provides. Map each observation to one condition:

| What you see | Catalog condition |
|---|---|
| RSI just crossed above a drawn falling RSI line | `rsi_trendline_breakout` (period = RSI period) |
| RSI dipped below 30 a few bars ago | `rsi_below` value 30, lookbackBars ≈ the bars since the dip (round up, max 30) |
| RSI above its MA (first legend number > second) | `rsi_above_signal` |
| Close near the period low | `near_period_low` period 250, value = the distance % rounded UP to a round number (11% → 15) |
| Long decline across the chart | `negative_period_change` period ≈ the bars covered, value 0 |
| Price under or over a drawn MA | `price_below_sma` / `price_above_sma` with the MA period from the legend |
| MACD line above signal | `macd_above_signal` |
| Volume bars clearly above their average | `volume_above_sma` |

Rules:
- **Pattern, not values.** Never copy exact readings (45.76, 67.87) as thresholds. Use the band (30/50/70) or a round tolerance.
- **3 to 5 conditions.** Fewer finds too much. More finds nothing. Always keep the drawn-line condition and the "now" trigger. Drop background conditions first.
- **Loosen, then tighten.** Each threshold should be one notch looser than the chart shows (11% → 15%, 3 bars ago → within 5 bars). That way similar stocks still match.
- **No catalog match → say so.** Put it in `assumptions` ("big +7% day noted; not in catalog"). Never invent a type or field.

## Step 7. Self-check before answering
Answer each question; if any answer is "no", fix the plan:
1. Would the charted stock itself pass every condition on its last bar? If it wouldn't, the plan is wrong.
2. Is every number traceable to something visible, or to a stated default?
3. Did I treat a legend MA value as a threshold? (Common mistake.)
4. Did I use an event marker (E/D) as a signal? (Remove it.)
5. Is confidence honest? Clear drawn line + legible legend → 0.8+. Blurry, cropped or no drawings → ≤ 0.6, and list what was unreadable.

## Worked example 1 (RSI trendline breakout, daily)
Observed facts:
- Price fell from ~130 to ~61 over 11 months, with lower highs.
- RSI(14) legend: RSI 45.76 now, its MA 31.90 now.
- A blue falling line is drawn on RSI, from the ~73 peak (late Jun) to ~30 (Oct), a span of ~65 bars.
- RSI dipped below 30 ~3 bars ago. The last candle is +7.37% and has crossed above the line.
Plan:
- `rsi_trendline_breakout` (period 14, lookbackBars 3)
- `rsi_below` (value 30, lookbackBars 5)
- `rsi_above_signal` (period 14)
- `near_period_low` (period 250, value 15)
- `negative_period_change` (period 200, value 0)
Assumptions: the +7% candle is noted but not scanned; the E/D markers are ignored.

## Worked example 2 (moving-average pullback, different shape)
Observed facts:
- Price in an uptrend above a rising 50 EMA; the last 3 candles pulled back to touch it.
- RSI ~48 after being ~70.
Plan:
- `price_above_sma` (period 200), for the long-term uptrend
- `rsi_below` (value 55, lookbackBars 3), for the cooled momentum
Assumptions: an EMA touch has no catalog type, so it's approximated, and the gap is stated.

## Worked example 3 (range breakout with volume)
Observed facts:
- A flat box is drawn over 3 months between 410 and 450.
- The last candle closes above 450 on a volume bar about 3× the average.
Plan:
- `volume_above_sma` (period 20)
- `negative_period_change` NOT used, because this isn't a downtrend
Assumptions: "close above the 60-day high" is the intended trigger. If it isn't in the catalog, say so.
