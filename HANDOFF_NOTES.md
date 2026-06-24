# SaviourPlus EA — Session Handoff Notes
**Date:** 2026-06-24  
**Status:** Paused — system slow, user stepping away

---

## URGENT: LIVE ACCOUNT ALERT

The MT4 log from **2026-06-23** shows another EA was spamming orders on the live account:

```
21:33:49 – 21:34:49  →  AUDCAD sell 0.01 × ~60 attempts, ALL FAILED: [Not enough money]
```

This is **NOT SaviourPlus EA** — it is **Saviour Robot v8** (old EA still installed).  
It was spamming AUDCAD sell orders every second until the account ran out of margin.

**Before doing anything else, check MT4 → open trades and remove Saviour Robot v8 from all charts.**

---

## What Was Done This Session

### 1. SaviourPlus EA v1.2 — Parameter Fix (DONE)
File: `C:\Users\hp\AppData\Roaming\MetaQuotes\Terminal\DC7D4808E49DA56212633C305FFB64D2\MQL4\Experts\SaviourPlus_EA.mq4`

| Parameter | v1.1 | v1.2 | Why |
|---|---|---|---|
| ADX_Trend_Level | 25.0 | **30.0** | Stronger trend required |
| Pivot_ZonePips | 12 | **999** | Disabled pivot filter (was blocking all grid trades) |
| ATR_SL_Multiplier | 1.5 | **1.0** | Tighter stop → more TP hits |
| ATR_TP_Multiplier | 2.5 | **3.0** | Wider reward |

**Compiled** → SaviourPlus_EA.ex4 updated at 01:09 today.

### 2. Before/After Backtest (DONE)
Run: `node "C:\Users\hp\AppData\Local\Temp\saviourplus_compare.js"`

| Portfolio (5 pairs) | v1.1 | v1.2 |
|---|---|---|
| Total Net P&L | +$108 | **+$313** |
| Profit Factor | 1.10 | **1.43** |
| Max Drawdown | 8.9% | 9.7% |

Best pair: USDJPY +$66 → **+$174**, AUDUSD +$39 → **+$108**

### 3. Profile with EA Pre-Injected (DONE)
Profile: `SaviourPlus_Clean` — all 5 CHR files updated with `<expert>` block.  
Script used: `C:\Users\hp\AppData\Local\Temp\inject_ea_to_profile.js`

Magic numbers per pair:
- EURUSD → 202601
- USDJPY → 202602
- AUDUSD → 202603
- USDCHF → 202604
- AUDCAD → 202605

### 4. GitHub Push (DONE)
Repo: `shakra-trader/SaviourPlus_EA`  
Commit: `v1.2: fix pivot filter, tighten SL, widen TP, raise ADX threshold`  
Files pushed: `EA/SaviourPlus_EA.mq4`, `EA/SaviourPlus_EA.ex4`, `backtest/saviourplus_compare.js`, `results/backtest_results.md`

### 5. Demo Account Setup (INCOMPLETE)
- JustMarkets' live MT4 does NOT allow demo registration (locked to live servers only)
- Script written: `C:\Users\hp\AppData\Local\Temp\login_demo.vbs` — ready to use once you have demo credentials
- MT4 Export History script compiled: `MQL4\Scripts\ExportHistory.ex4`

---

## What To Do Next (in order)

### STEP 1 — URGENT: Check live account right now
In MT4:
1. Look at open trades (bottom panel → Trade tab)
2. Check each trade's **Comment** column — does it say `Saviour ea...`?
3. If yes → right-click those trades → Close All or remove Saviour Robot v8 EA from charts

### STEP 2 — Get trade history
In MT4, right-click the **Account History** tab (bottom panel) → **All History** → **Save as Report**  
Save to Desktop. Open in browser to see all closed trades.

### STEP 3 — Create JustMarkets demo account
1. Go to **justmarkets.com** → log into your client area
2. Open a **Demo Account** from the portal
3. Write down: account number, password, server name

### STEP 4 — Load EA on demo
Once you have demo credentials, run:
```
wscript "C:\Users\hp\AppData\Local\Temp\login_demo.vbs"
```
It will ask for account number, password, server → then auto-loads the 5-pair profile with EA.

### STEP 5 — Load EA on live (when ready)
In MT4 with live account active:
1. File → Open Profile → **SaviourPlus_Clean**
2. EA will auto-attach to all 5 charts (it's embedded in the CHR files)
3. Click the **AutoTrading** button in toolbar (should be green)
4. Confirm each chart shows green smiley face in top-right corner

### STEP 6 — Monitor for a week on demo first
Do not run on live until you have seen at least 1 week of demo results.

---

## Key Files Reference

| File | Purpose |
|---|---|
| `C:\Users\hp\SaviourPlus_EA\EA\SaviourPlus_EA.mq4` | Source code v1.2 |
| `C:\Users\hp\AppData\Local\Temp\saviourplus_compare.js` | Before/after backtest |
| `C:\Users\hp\AppData\Local\Temp\inject_ea_to_profile.js` | Re-inject EA into profile |
| `C:\Users\hp\AppData\Local\Temp\login_demo.vbs` | Demo account login + profile load |
| `C:\Users\hp\SaviourPlus_EA\results\backtest_results.md` | Full results table |
| MT4 profile: `SaviourPlus_Clean` | 5 charts with EA already embedded |
