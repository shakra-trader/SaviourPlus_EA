# SaviourPlus EA — Backtest Results

## Before / After Comparison  |  H1  |  Jun–Oct 2024  |  \,000 start

### Parameter Changes (v1.1 → v1.2)
| Parameter        | v1.1 (Before) | v1.2 (After)    | Reason                         |
|------------------|---------------|-----------------|--------------------------------|
| ADX_Trend_Level  | 25.0          | 30.0            | Require stronger trend signal  |
| Pivot_ZonePips   | 12            | 999 (disabled)  | Pivot filter blocked all grid  |
| ATR_SL_Multiplier| 1.5           | 1.0             | Tighter stop, more frequent TP |
| ATR_TP_Multiplier| 2.5           | 3.0             | Higher reward per trade        |

### Per-Pair Results
| Pair   | Version    | Trades | WR%  | Net P&L  | Balance   | PF   | MaxDD% | Grid | Trend |
|--------|------------|--------|------|----------|-----------|------|--------|------|-------|
| EURUSD | v1.1 BEFORE|  20    | 60%  | +\.16  | \,014.16 | 1.18 | 8.4%   | 0    | 20    |
| EURUSD | v1.2 AFTER |  27    | 44%  | +\.98  | \,029.98 | 1.31 | 9.6%   | 0    | 27    |
| USDJPY | v1.1 BEFORE|  34    | 41%  | +\.85  | \,065.85 | 1.13 | 17.1%  | 0    | 34    |
| USDJPY | v1.2 AFTER |  37    | 43%  | +\.83 | \,173.83 | 1.56 | 16.1%  | 0    | 37    |
| AUDUSD | v1.1 BEFORE|  20    | 50%  | +\.36  | \,039.36 | 1.36 | 5.9%   | 0    | 20    |
| AUDUSD | v1.2 AFTER |  22    | 59%  | +\.27 | \,108.27 | 2.30 | 5.0%   | 0    | 22    |
| USDCHF | v1.1 BEFORE|  19    | 42%  | +\.97   | \,006.97 | 1.06 | 8.5%   | 0    | 19    |
| USDCHF | v1.2 AFTER |  27    | 41%  | +\.42   | \,008.42 | 1.06 | 12.5%  | 0    | 27    |
| AUDCAD | v1.1 BEFORE|  16    | 50%  | -\.30  | \.70   | 0.79 | 4.4%   | 0    | 16    |
| AUDCAD | v1.2 AFTER |  25    | 48%  | -\.19   | \.81   | 0.93 | 5.3%   | 0    | 25    |

### Portfolio Summary
| Metric              | v1.1 BEFORE  | v1.2 AFTER   | Delta      |
|---------------------|--------------|--------------|------------|
| Total Net P&L       | +\.04     | +\.31     | +\.27   |
| Total Trades        | 109          | 138          | +29        |
| Win Rate            | 47.7%        | 46.4%        | -1.3%      |
| Avg Profit Factor   | 1.10         | 1.43         | +0.33      |
| Avg Max Drawdown    | 8.9%         | 9.7%         | +0.8%      |

### Key Findings
- **Grid trades = 0** on all pairs in both versions: ADX rarely drops below 20 on H1 bars.
  Grid mode is technically present but inactive on this timeframe/data set.
- **Biggest gain**: USDJPY +\→+\, AUDUSD +\→+\ (both from tighter SL + wider TP)
- **AUDCAD** still negative but improved from -\ to -\
- **USDCHF** minimal improvement — limited data (view60.hst, Jun–Oct 2024 only)
- **Win rate drops slightly** (48%→46%) because tighter SL cuts more losers early,
  but profit factor jumps from 1.10→1.43 showing better reward/risk
