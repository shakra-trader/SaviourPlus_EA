# SaviourPlus EA

A hybrid **Grid + Trend** Expert Advisor for MetaTrader 4, built to replace the original "Saviour Robot v8" by adding ADX-based market regime detection and ATR trailing stops.

## Strategy

The EA detects market regime using ADX(14) and switches between two modes:

| Mode | Trigger | Logic |
|------|---------|-------|
| **Ranging** | ADX ≤ 20 | Grid trading at channel extremes near daily pivot levels |
| **Trending** | ADX ≥ 25 | Price channel breakout + pyramid + ATR trailing stop |
| Hysteresis | 20–25 | Stays in previous mode |

### Ranging Mode (Grid)
- 20-bar price channel (Donchian) defines high/low
- Entry: price in bottom 25% (buy) or top 75% (sell) + near daily pivot ± 12 pips
- Grid adds levels every 25 pips against position, lot ×1.3 per level, max 5 levels
- Basket close when total floating P&L ≥ 25 pips × total lots

### Trending Mode (Breakout)
- Entry on 20-bar channel breakout, confirmed by EMA(21)/EMA(50) direction
- SL = ATR(14) × 1.5, TP = ATR(14) × 2.5
- Pyramid: up to 3 additional entries at 25-pip profit intervals
- Trailing stop updated to ATR × 1.5 from current price each bar

## Parameters

```mql4
extern int    ADX_Period          = 14;
extern double ADX_Trend_Level     = 25.0;   // ADX above = trending
extern double ADX_Range_Level     = 20.0;   // ADX below = ranging
extern int    EMA_Fast_Period     = 21;
extern int    EMA_Slow_Period     = 50;
extern int    Channel_Period      = 20;     // Donchian channel lookback
extern double Grid_InitialLot     = 0.01;
extern double Grid_LotMultiplier  = 1.3;
extern int    Grid_MaxLevels      = 5;
extern int    Grid_StepPips       = 25;
extern int    Grid_BasketTP_Pips  = 25;
extern int    Pivot_ZonePips      = 12;     // proximity to daily pivot for entry
extern bool   Grid_OneDirection   = true;   // only one side at a time
extern double Trend_InitialLot    = 0.01;
extern int    ATR_Period          = 14;
extern double ATR_SL_Multiplier   = 1.5;
extern double ATR_TP_Multiplier   = 2.5;
extern int    Pyramid_MaxLevels   = 3;
extern int    Pyramid_StepPips    = 25;
extern double MaxDrawdown_Pct     = 20.0;   // emergency close all
extern bool   CloseGridOnTrend    = true;
extern bool   CloseTrendOnRange   = true;
extern int    MagicNumber         = 202601;
```

## Backtest Results (H1, Jun–Oct 2024)

| Pair   | Net P&L  | WR%  | Profit Factor | Max DD |
|--------|---------|------|--------------|--------|
| EURUSD | +$14.16 | 60%  | 1.18         | 8.4%   |
| USDJPY | +$65.85 | 41%  | 1.13         | 17.1%  |
| AUDUSD | +$39.36 | 50%  | 1.36         | 5.9%   |
| USDCHF | +$6.97  | 42%  | 1.06         | 8.5%   |
| AUDCAD | -$18.30 | 50%  | 0.79         | 4.4%   |

**Combined: +$108.04 across 5 pairs, 109 trades, 48% WR, avg 8.9% DD**

See `results/backtest_results.md` for full analysis.

## Known Issues / Tuning Needed

1. **Grid never fires** — `Pivot_ZonePips=12` is too tight; recommend 30+ or remove the pivot filter
2. **Too many SL hits** — raise `ADX_Trend_Level` to 30 for stricter trend entries
3. **AUDCAD** — not suitable for this strategy; exclude from live set

## Files

```
EA/
  SaviourPlus_EA.mq4   — MQL4 source (638 lines, v1.1)
  SaviourPlus_EA.ex4   — Compiled binary (MT4 build 1440)
backtest/
  saviourplus_multi.js      — Multi-pair Node.js backtester (H1 + M15)
  saviourplus_backtest.js   — Single-pair backtester (EURUSD)
  check_hst_ranges.js       — Inspect MT4 HST file date ranges
  make_clean_profile.js     — Generate clean MT4 chart profile
mt4_config/
  SaviourPlus_Test.ini      — MT4 Strategy Tester config
results/
  backtest_results.md       — Full results tables and analysis
```

## Setup

1. Copy `EA/SaviourPlus_EA.ex4` to `MT4/MQL4/Experts/`
2. Attach to EURUSD M15 chart (or any M15 chart)
3. Enable automated trading in MT4

## Backtesting (Node.js)

Requires MT4 HST binary files in the JustMarkets history folder.

```bash
node backtest/saviourplus_multi.js
```

## Broker

Tested on **JustMarkets** (JustMarkets-Live4 server), MT4 build 1440.
