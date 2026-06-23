# SaviourPlus EA — Backtest Results

## Configuration
- **Deposit:** $1,000 | **Leverage:** 1:100 | **Spread:** pair-realistic (1.5–3.0 pips)
- **Data:** H1 bars (1-hour) | **Period:** Jun 18 – Oct 31, 2024 (~4.5 months)
- **Backtester:** Custom Node.js engine reading MT4 HST v401 binary files directly

## Multi-Pair Results (H1 — Primary)

| Pair   | Bars | Net P&L    | Balance   | Trades | W  | L  | WR% | PF   | MaxDD% | AvgW   | AvgL    |
|--------|------|-----------|-----------|--------|----|----|-----|------|--------|--------|---------|
| EURUSD | 20   | +$14.16   | $1,014.16 | 20     | 12 | 8  | 60% | 1.18 | 8.4%   | $7.80  | -$9.93  |
| USDJPY | 34   | +$65.85   | $1,065.85 | 34     | 14 | 20 | 41% | 1.13 | 17.1%  | $40.79 | -$25.26 |
| AUDUSD | 20   | +$39.36   | $1,039.36 | 20     | 10 | 10 | 50% | 1.36 | 5.9%   | $14.83 | -$10.89 |
| USDCHF | 19   | +$6.97    | $1,006.97 | 19     | 8  | 11 | 42% | 1.06 | 8.5%   | $14.40 | -$9.84  |
| AUDCAD | 16   | **-$18.30** | $981.70 | 16     | 8  | 8  | 50% | 0.79 | 4.4%   | $8.62  | -$10.91 |
| **TOTAL** | **109** | **+$108.04** | | **109** | **52** | **57** | **48%** | **1.10** | avg **8.9%** | | |

*EURCHF and NZDUSD: not in JustMarkets broker history — no data available.*

## Close Reason Breakdown

| Pair   | SL hits | TP hits | EOT (open at end) |
|--------|---------|---------|-------------------|
| EURUSD | 14      | 0       | 6                 |
| USDJPY | 20      | 9       | 5                 |
| AUDUSD | 14      | 3       | 3                 |
| USDCHF | 13      | 3       | 3                 |
| AUDCAD | 11      | 2       | 3                 |

## Short Period Comparison (M15 — Sep/Oct only)

| Pair   | Net P&L  | Trades | WR% | PF   | MaxDD% |
|--------|---------|--------|-----|------|--------|
| EURUSD | -$12.51  | 22     | 18% | 0.88 | 6.5%   |
| USDJPY | +$15.35  | 23     | 35% | 1.09 | 7.3%   |
| AUDUSD | +$16.24  | 17     | 41% | 1.34 | 4.3%   |
| USDCHF | -$50.60  | 17     | 35% | 0.43 | 10.5%  |
| AUDCAD | -$35.40  | 21     | 38% | 0.35 | 4.9%   |

## Key Findings

### What works
- **USDJPY** best absolute performer (+6.6%) — JPY had large directional moves in 2024
- **AUDUSD** best risk-adjusted (+3.9%, PF=1.36, DD only 5.9%) — cleanest trend pair
- 4 of 5 pairs profitable on H1 over 4.5 months

### What doesn't work (bugs/design issues)
1. **Grid mode: ZERO trades on all 5 pairs** — the three-way filter (bottom/top 25% of 20-bar channel AND bullish/bearish bar AND price within 12 pips of daily pivot) is too restrictive; these conditions almost never coincide simultaneously
2. **SL rate too high** — 72 SL hits vs 17 TP hits; too many false breakouts from ADX≥25 threshold
3. **AUDCAD loses** — cross-pair, too mean-reverting for this trend logic

### Recommended fixes
| Fix | Parameter | Change |
|-----|-----------|--------|
| Relax grid pivot zone | `Pivot_ZonePips` | 12 → 30 or remove entirely |
| Stricter trend entry | `ADX_Trend_Level` | 25 → 30 |
| Tighter SL | `ATR_SL_Multiplier` | 1.5 → 1.0 |
| Exclude choppy pairs | — | Drop AUDCAD from live set |

## EA Architecture Summary

```
SaviourPlus_EA (MQL4, build 1440)
├── DetectMode()     — ADX(14): ≤20=ranging, ≥25=trending, 20-25=hysteresis
├── RunRangingMode() — Grid entries at channel extremes near daily pivots
│   ├── ExtendGrid() — martingale scaling: lot × 1.3^n, max 5 levels, 25-pip step
│   └── CheckGridBasketTP() — close all grid trades when basket P&L ≥ 25pip×totalLots
└── RunTrendingMode() — breakout entry on 20-bar channel high/low
    ├── EMA(21/50) crossover confirms bull/bear direction
    ├── ATR(14)×1.5 SL, ATR(14)×2.5 TP
    └── Pyramid up to 3 levels at 25-pip intervals + trailing stop
```
