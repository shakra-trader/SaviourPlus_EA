# How to Resume This Project with Claude

Paste this into Claude Code to continue exactly where we left off:

---

**Resume SaviourPlus EA project. Read `C:\Users\hp\SaviourPlus_EA\HANDOFF_NOTES.md` first, then check the live account alert at the top of that file before doing anything else.**

Key context:
- EA is v1.2, compiled, backtested (+$108 → +$313 improvement confirmed)
- SaviourPlus_Clean profile has EA pre-injected in all 5 chart CHR files
- Demo account NOT yet set up (JustMarkets live MT4 locked to live servers)
- URGENT: Saviour Robot v8 (old EA) was spamming AUDCAD sell orders on the live account — check if still running
- Next steps are in HANDOFF_NOTES.md

---

## Steps Claude Already Completed
1. ✅ Multi-pair backtest on EURUSD, USDJPY, AUDUSD, USDCHF, AUDCAD (H1, Jun–Oct 2024)
2. ✅ Identified why grid mode never fires (Pivot_ZonePips=12 too tight)
3. ✅ Fixed 4 parameters in SaviourPlus_EA.mq4 (v1.1 → v1.2)
4. ✅ Compiled new v1.2 EA
5. ✅ Before/after comparison backtest: +$108 → +$313 (profit factor 1.10 → 1.43)
6. ✅ Injected EA into SaviourPlus_Clean profile CHR files (auto-loads when profile opened)
7. ✅ Pushed everything to GitHub (shakra-trader/SaviourPlus_EA)
8. ✅ Wrote ExportHistory.ex4 MQL4 script (to get trade history from MT4)
9. ✅ Discovered Saviour Robot v8 was spamming orders on live account (from MT4 log)

## Steps Still To Do
1. ⚠️  URGENT: Remove Saviour Robot v8 from live MT4 charts
2. ⬜  Get trade history (run ExportHistory script from MT4 Navigator → Scripts)
3. ⬜  Create demo account via justmarkets.com client portal
4. ⬜  Run login_demo.vbs to load EA on demo account
5. ⬜  Monitor demo for 1 week
6. ⬜  Load on live account when demo results are good

## Key Files
- Handoff notes: `C:\Users\hp\SaviourPlus_EA\HANDOFF_NOTES.md`
- EA source: `...MQL4\Experts\SaviourPlus_EA.mq4` (v1.2)
- Demo login script: `C:\Users\hp\AppData\Local\Temp\login_demo.vbs`
- Backtest compare: `C:\Users\hp\AppData\Local\Temp\saviourplus_compare.js`
- GitHub: `shakra-trader/SaviourPlus_EA`
