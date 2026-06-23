//+------------------------------------------------------------------+
//|                                             SaviourPlus_EA.mq4   |
//|  Hybrid Grid + Trend EA  v1.2  (with live dashboard)            |
//|  Ranging  → Grid reversals  (Price Channel + Pivot S/R)         |
//|  Trending → Breakout + Pyramid + ATR Trailing Stop              |
//+------------------------------------------------------------------+
#property copyright "SaviourPlus v1.2"
#property version   "1.20"
#property strict

//────────────────────────────────────────────────────────────────────
//  INPUTS
//────────────────────────────────────────────────────────────────────

// ── Trend / Range Detection ────────────────────────────────────────
extern int    ADX_Period          = 14;
extern double ADX_Trend_Level     = 30.0;   // ADX above = trending
extern double ADX_Range_Level     = 20.0;   // ADX below = ranging
extern int    EMA_Fast_Period     = 21;
extern int    EMA_Slow_Period     = 50;

// ── Price Channel ──────────────────────────────────────────────────
extern int    Channel_Period      = 20;

// ── Grid Settings (Ranging Mode) ──────────────────────────────────
extern double Grid_InitialLot     = 0.01;
extern double Grid_LotMultiplier  = 1.3;    // lot multiplier per extra level
extern int    Grid_MaxLevels      = 5;      // hard cap on open grid positions
extern int    Grid_StepPips       = 25;     // pips between grid additions
extern int    Grid_BasketTP_Pips  = 25;     // basket profit target (pips × total lots)
extern int    Pivot_ZonePips      = 999;    // proximity to pivot S/R for entries (999=disabled)
extern bool   Grid_OneDirection   = true;   // true = never open opposing grid simultaneously

// ── Trend Settings (Trending Mode) ────────────────────────────────
extern double Trend_InitialLot    = 0.01;
extern int    ATR_Period          = 14;
extern double ATR_SL_Multiplier   = 1.0;
extern double ATR_TP_Multiplier   = 3.0;
extern int    Pyramid_MaxLevels   = 3;
extern int    Pyramid_StepPips    = 25;

// ── Risk Management ───────────────────────────────────────────────
extern double MaxDrawdown_Pct     = 20.0;
extern bool   CloseGridOnTrend    = true;
extern bool   CloseTrendOnRange   = true;

// ── General ───────────────────────────────────────────────────────
extern int    MagicNumber         = 202601;
extern int    Slippage            = 3;

// ── Dashboard ─────────────────────────────────────────────────────
extern bool   ShowDashboard       = true;
extern int    Dashboard_X         = 10;     // pixels from left
extern int    Dashboard_Y         = 25;     // pixels from top

//────────────────────────────────────────────────────────────────────
//  DASHBOARD OBJECT NAMES
//────────────────────────────────────────────────────────────────────
#define OBJ_BG          "SP_BG"
#define OBJ_TITLE       "SP_Title"
#define OBJ_MODE        "SP_Mode"
#define OBJ_MODE_VAL    "SP_ModeVal"
#define OBJ_ADX         "SP_ADX"
#define OBJ_ADX_VAL     "SP_ADXVal"
#define OBJ_PNL         "SP_PnL"
#define OBJ_PNL_VAL     "SP_PnLVal"
#define OBJ_DD          "SP_DD"
#define OBJ_DD_VAL      "SP_DDVal"
#define OBJ_GBUY        "SP_GBuy"
#define OBJ_GBUY_VAL    "SP_GBuyVal"
#define OBJ_GSELL       "SP_GSell"
#define OBJ_GSELL_VAL   "SP_GSellVal"
#define OBJ_TPOS        "SP_TPos"
#define OBJ_TPOS_VAL    "SP_TPosVal"
#define OBJ_PIVOT       "SP_Pivot"
#define OBJ_PIVOT_VAL   "SP_PivotVal"
#define OBJ_SEP         "SP_Sep"

//────────────────────────────────────────────────────────────────────
//  GLOBALS
//────────────────────────────────────────────────────────────────────
double   pip;
double   pivotP, pivotR1, pivotR2, pivotS1, pivotS2;
datetime lastBarTime  = 0;
datetime lastPivotDay = 0;
int      marketMode   = 0;   // 0=ranging, 1=trending up, -1=trending down
int      prevMode     = 0;

string   PREFIX_GRID  = "SP_Grid_";
string   PREFIX_TREND = "SP_Trend_";

//────────────────────────────────────────────────────────────────────
//  INIT / DEINIT
//────────────────────────────────────────────────────────────────────
int OnInit()
{
    pip = (Digits == 5 || Digits == 3) ? Point * 10.0 : Point;

    if (ShowDashboard) BuildDashboard();

    Print("SaviourPlus EA v1.1 started. Magic=", MagicNumber,
          " Pip=", pip);
    return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
    RemoveDashboard();
}

//────────────────────────────────────────────────────────────────────
//  MAIN TICK
//────────────────────────────────────────────────────────────────────
void OnTick()
{
    // Update dashboard on every tick for live PnL
    if (ShowDashboard) RefreshDashboard();

    // Strategy logic only on new bar
    if (Time[0] == lastBarTime) return;
    lastBarTime = Time[0];

    if (EmergencyDrawdownCheck()) return;

    RefreshPivots();

    prevMode   = marketMode;
    marketMode = DetectMode();

    if (marketMode != prevMode) OnModeChange(prevMode, marketMode);

    if (marketMode == 0)
        RunRangingMode();
    else
        RunTrendingMode();
}

//────────────────────────────────────────────────────────────────────
//  MODE DETECTION
//────────────────────────────────────────────────────────────────────
int DetectMode()
{
    double adx  = iADX(NULL, 0, ADX_Period, PRICE_CLOSE, MODE_MAIN,  1);
    double emaF = iMA (NULL, 0, EMA_Fast_Period, 0, MODE_EMA, PRICE_CLOSE, 1);
    double emaS = iMA (NULL, 0, EMA_Slow_Period, 0, MODE_EMA, PRICE_CLOSE, 1);

    if (adx <= ADX_Range_Level)  return 0;
    if (adx >= ADX_Trend_Level)  return (emaF > emaS) ? 1 : -1;
    return marketMode;  // hysteresis band: keep previous mode
}

void OnModeChange(int fromMode, int toMode)
{
    Print("Mode: ", ModeLabel(fromMode), " → ", ModeLabel(toMode));
    if (toMode != 0 && CloseGridOnTrend)    CloseByPrefix(PREFIX_GRID);
    if (toMode == 0 && CloseTrendOnRange)   CloseByPrefix(PREFIX_TREND);
}

//────────────────────────────────────────────────────────────────────
//  RANGING MODE
//────────────────────────────────────────────────────────────────────
void RunRangingMode()
{
    double hi = iHigh(NULL, 0, iHighest(NULL, 0, MODE_HIGH, Channel_Period, 1));
    double lo = iLow (NULL, 0, iLowest (NULL, 0, MODE_LOW,  Channel_Period, 1));
    double rng = hi - lo;
    if (rng <= 0) return;

    double closeBar = Close[1];
    double openBar  = Open[1];
    bool   bullBar  = (closeBar > openBar);
    bool   bearBar  = (closeBar < openBar);
    double pos      = (closeBar - lo) / rng; // 0=bottom, 1=top

    int buyCount  = CountByPrefix(PREFIX_GRID + "Buy");
    int sellCount = CountByPrefix(PREFIX_GRID + "Sell");

    // Basket TP check first
    if (buyCount  > 0) CheckGridBasketTP(OP_BUY,  buyCount);
    if (sellCount > 0) CheckGridBasketTP(OP_SELL, sellCount);

    // Re-read counts after potential closes
    buyCount  = CountByPrefix(PREFIX_GRID + "Buy");
    sellCount = CountByPrefix(PREFIX_GRID + "Sell");

    bool otherGridActive = (Grid_OneDirection && (buyCount > 0 || sellCount > 0));

    // New BUY grid entry
    if (buyCount == 0 && !otherGridActive &&
        pos <= 0.25 && bullBar && NearPivot(closeBar, false))
    {
        OpenOrder(OP_BUY, Grid_InitialLot, 0, 0, PREFIX_GRID + "Buy_L0");
    }

    // New SELL grid entry
    if (sellCount == 0 && !otherGridActive &&
        pos >= 0.75 && bearBar && NearPivot(closeBar, true))
    {
        OpenOrder(OP_SELL, Grid_InitialLot, 0, 0, PREFIX_GRID + "Sell_L0");
    }

    // Extend existing grid if price moved against us
    buyCount  = CountByPrefix(PREFIX_GRID + "Buy");
    sellCount = CountByPrefix(PREFIX_GRID + "Sell");

    if (buyCount  > 0 && buyCount  < Grid_MaxLevels) ExtendGrid(OP_BUY);
    if (sellCount > 0 && sellCount < Grid_MaxLevels) ExtendGrid(OP_SELL);
}

void ExtendGrid(int type)
{
    string prefix   = PREFIX_GRID + (type == OP_BUY ? "Buy" : "Sell");
    double lastPrice = GetLastOpenPrice(prefix);
    if (lastPrice == 0) return;

    double current  = (type == OP_BUY) ? Bid : Ask;
    bool   doAdd    = (type == OP_BUY)
                    ? (lastPrice - current) >= Grid_StepPips * pip
                    : (current - lastPrice) >= Grid_StepPips * pip;
    if (!doAdd) return;

    int    n   = CountByPrefix(prefix);
    double lot = NormalizeLot(Grid_InitialLot * MathPow(Grid_LotMultiplier, n));
    string cmt = prefix + "_L" + IntegerToString(n);
    OpenOrder(type, lot, 0, 0, cmt);
}

void CheckGridBasketTP(int type, int levelCount)
{
    string prefix      = PREFIX_GRID + (type == OP_BUY ? "Buy" : "Sell");
    double totalProfit = 0;
    double totalLots   = 0;

    for (int i = OrdersTotal() - 1; i >= 0; i--)
    {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
        if (!IsOurs(prefix)) continue;
        totalProfit += OrderProfit() + OrderSwap() + OrderCommission();
        totalLots   += OrderLots();
    }

    // Target: Grid_BasketTP_Pips across the full basket of lots
    double tickVal    = MarketInfo(Symbol(), MODE_TICKVALUE);
    double tickSz     = MarketInfo(Symbol(), MODE_TICKSIZE);
    double target     = totalLots * (Grid_BasketTP_Pips * pip / tickSz) * tickVal;

    if (totalProfit >= target && target > 0)
    {
        Print("Grid basket TP hit (", type == OP_BUY ? "BUY" : "SELL",
              ") Profit=", DoubleToString(totalProfit, 2));
        CloseByPrefix(prefix);
    }
}

//────────────────────────────────────────────────────────────────────
//  TRENDING MODE
//────────────────────────────────────────────────────────────────────
void RunTrendingMode()
{
    bool   isBull  = (marketMode == 1);
    int    opType  = isBull ? OP_BUY : OP_SELL;
    string prefix  = PREFIX_TREND + (isBull ? "Buy" : "Sell");
    int    count   = CountByPrefix(prefix);
    double atr     = iATR(NULL, 0, ATR_Period, 1);
    if (atr <= 0) return;

    // Use shift=2 for channel so we don't include current open bar
    double chanHigh = iHigh(NULL, 0, iHighest(NULL, 0, MODE_HIGH, Channel_Period, 2));
    double chanLow  = iLow (NULL, 0, iLowest (NULL, 0, MODE_LOW,  Channel_Period, 2));
    double closeBar = Close[1];

    if (count == 0)
    {
        // Entry: close broke out of channel in the trend direction
        bool breakUp   = isBull  && (closeBar > chanHigh);
        bool breakDown = !isBull && (closeBar < chanLow);
        if (!breakUp && !breakDown) return;

        double entry = isBull ? Ask : Bid;
        double sl    = NormalizeDouble(isBull ? entry - atr * ATR_SL_Multiplier
                                              : entry + atr * ATR_SL_Multiplier, Digits);
        double tp    = NormalizeDouble(isBull ? entry + atr * ATR_TP_Multiplier
                                              : entry - atr * ATR_TP_Multiplier, Digits);
        OpenOrder(opType, Trend_InitialLot, sl, tp, prefix + "_L0");
        Print("Trend entry ", ModeLabel(marketMode), " ATR=", DoubleToString(atr, 5));
    }
    else
    {
        // Pyramid into trend if unrealised profit justifies it
        if (count < Pyramid_MaxLevels) TryPyramid(opType, prefix, count, atr);

        // Move trailing stop on all trend positions
        UpdateTrailingStop(opType, atr);
    }
}

void TryPyramid(int type, string prefix, int count, double atr)
{
    double firstPrice = GetFirstOpenPrice(prefix);
    if (firstPrice == 0) return;

    double current    = (type == OP_BUY) ? Bid : Ask;
    double profitPips = (type == OP_BUY)
                      ? (current - firstPrice) / pip
                      : (firstPrice - current) / pip;

    // Need count × Pyramid_StepPips of profit before next addition
    if (profitPips < (double)count * Pyramid_StepPips) return;

    double entry = (type == OP_BUY) ? Ask : Bid;
    double sl    = NormalizeDouble(type == OP_BUY ? entry - atr * ATR_SL_Multiplier
                                                   : entry + atr * ATR_SL_Multiplier, Digits);
    double tp    = NormalizeDouble(type == OP_BUY ? entry + atr * ATR_TP_Multiplier
                                                   : entry - atr * ATR_TP_Multiplier, Digits);
    OpenOrder(type, Trend_InitialLot, sl, tp, prefix + "_L" + IntegerToString(count));
    Print("Pyramid L", count, " profit=", DoubleToString(profitPips, 1), " pips");
}

void UpdateTrailingStop(int type, double atr)
{
    double dist = atr * ATR_SL_Multiplier;

    for (int i = OrdersTotal() - 1; i >= 0; i--)
    {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))          continue;
        if (OrderMagicNumber() != MagicNumber)                     continue;
        if (OrderSymbol()      != Symbol())                        continue;
        if (StringFind(OrderComment(), PREFIX_TREND) < 0)         continue;
        if (OrderType()        != type)                            continue;

        double newSL;
        bool   ok = false;

        if (type == OP_BUY)
        {
            newSL = NormalizeDouble(Bid - dist, Digits);
            ok    = (newSL > OrderStopLoss() + pip && newSL < Bid - pip);
        }
        else
        {
            newSL = NormalizeDouble(Ask + dist, Digits);
            ok    = ((OrderStopLoss() == 0 || newSL < OrderStopLoss() - pip)
                     && newSL > Ask + pip);
        }

        if (ok && !OrderModify(OrderTicket(), OrderOpenPrice(),
                               newSL, OrderTakeProfit(), 0, clrNONE))
            Print("Trailing SL modify error: ", GetLastError());
    }
}

//────────────────────────────────────────────────────────────────────
//  PIVOT POINTS  (Classic daily)
//────────────────────────────────────────────────────────────────────
void RefreshPivots()
{
    datetime today = iTime(NULL, PERIOD_D1, 0);
    if (today == lastPivotDay) return;
    lastPivotDay = today;

    double hi = iHigh (NULL, PERIOD_D1, 1);
    double lo = iLow  (NULL, PERIOD_D1, 1);
    double cl = iClose(NULL, PERIOD_D1, 1);

    pivotP  = (hi + lo + cl) / 3.0;
    pivotR1 = 2.0 * pivotP - lo;
    pivotR2 = pivotP + (hi - lo);
    pivotS1 = 2.0 * pivotP - hi;
    pivotS2 = pivotP - (hi - lo);
}

bool NearPivot(double price, bool resistance)
{
    double z = Pivot_ZonePips * pip;
    if (resistance)
        return MathAbs(price - pivotR1) <= z ||
               MathAbs(price - pivotR2) <= z ||
               MathAbs(price - pivotP)  <= z;
    return     MathAbs(price - pivotS1) <= z ||
               MathAbs(price - pivotS2) <= z ||
               MathAbs(price - pivotP)  <= z;
}

//────────────────────────────────────────────────────────────────────
//  EMERGENCY DRAWDOWN
//────────────────────────────────────────────────────────────────────
bool EmergencyDrawdownCheck()
{
    double bal = AccountBalance();
    if (bal <= 0) return false;
    double dd  = (bal - AccountEquity()) / bal * 100.0;
    if (dd >= MaxDrawdown_Pct)
    {
        Print("EMERGENCY DD ", DoubleToString(dd, 2), "% — closing all.");
        CloseByPrefix(PREFIX_GRID);
        CloseByPrefix(PREFIX_TREND);
        return true;
    }
    return false;
}

//────────────────────────────────────────────────────────────────────
//  DASHBOARD
//────────────────────────────────────────────────────────────────────
void BuildDashboard()
{
    int x = Dashboard_X;
    int y = Dashboard_Y;
    int w = 220;
    int h = 230;

    // Background panel
    ObjectCreate    (0, OBJ_BG, OBJ_RECTANGLE_LABEL, 0, 0, 0);
    ObjectSetInteger(0, OBJ_BG, OBJPROP_XDISTANCE,   x);
    ObjectSetInteger(0, OBJ_BG, OBJPROP_YDISTANCE,   y);
    ObjectSetInteger(0, OBJ_BG, OBJPROP_XSIZE,        w);
    ObjectSetInteger(0, OBJ_BG, OBJPROP_YSIZE,        h);
    ObjectSetInteger(0, OBJ_BG, OBJPROP_BGCOLOR,      C'20,20,30');
    ObjectSetInteger(0, OBJ_BG, OBJPROP_BORDER_TYPE,  BORDER_FLAT);
    ObjectSetInteger(0, OBJ_BG, OBJPROP_COLOR,        C'60,60,80');
    ObjectSetInteger(0, OBJ_BG, OBJPROP_WIDTH,        1);
    ObjectSetInteger(0, OBJ_BG, OBJPROP_CORNER,       CORNER_LEFT_UPPER);
    ObjectSetInteger(0, OBJ_BG, OBJPROP_BACK,         false);
    ObjectSetInteger(0, OBJ_BG, OBJPROP_SELECTABLE,   false);

    // Title
    MakeLabel(OBJ_TITLE, "⚡ SAVIOURPLUS EA", x+8, y+8, 9, clrGold, true);

    // Separator line
    MakeLabel(OBJ_SEP, "────────────────────", x+8, y+28, 8, C'60,60,80', false);

    // Row labels (static)
    MakeLabel(OBJ_MODE,  "MODE",        x+8,  y+44,  8, C'160,160,160', false);
    MakeLabel(OBJ_ADX,   "ADX",         x+8,  y+62,  8, C'160,160,160', false);
    MakeLabel(OBJ_PNL,   "OPEN P/L",    x+8,  y+80,  8, C'160,160,160', false);
    MakeLabel(OBJ_DD,    "DRAWDOWN",    x+8,  y+98,  8, C'160,160,160', false);
    MakeLabel(OBJ_GBUY,  "GRID BUY",   x+8,  y+116, 8, C'160,160,160', false);
    MakeLabel(OBJ_GSELL, "GRID SELL",  x+8,  y+134, 8, C'160,160,160', false);
    MakeLabel(OBJ_TPOS,  "TREND POS",  x+8,  y+152, 8, C'160,160,160', false);
    MakeLabel(OBJ_PIVOT, "PIVOT",       x+8,  y+170, 8, C'160,160,160', false);

    // Value placeholders (updated every tick)
    MakeLabel(OBJ_MODE_VAL,  "---",  x+120, y+44,  8, clrWhite,    false);
    MakeLabel(OBJ_ADX_VAL,   "---",  x+120, y+62,  8, clrWhite,    false);
    MakeLabel(OBJ_PNL_VAL,   "---",  x+120, y+80,  8, clrWhite,    false);
    MakeLabel(OBJ_DD_VAL,    "---",  x+120, y+98,  8, clrWhite,    false);
    MakeLabel(OBJ_GBUY_VAL,  "---",  x+120, y+116, 8, clrLimeGreen,false);
    MakeLabel(OBJ_GSELL_VAL, "---",  x+120, y+134, 8, clrTomato,   false);
    MakeLabel(OBJ_TPOS_VAL,  "---",  x+120, y+152, 8, clrDodgerBlue,false);
    MakeLabel(OBJ_PIVOT_VAL, "---",  x+120, y+170, 8, clrKhaki,    false);

    ChartRedraw(0);
}

void RefreshDashboard()
{
    double adx     = iADX(NULL, 0, ADX_Period, PRICE_CLOSE, MODE_MAIN, 1);
    double balance = AccountBalance();
    double equity  = AccountEquity();
    double dd      = (balance > 0) ? (balance - equity) / balance * 100.0 : 0;

    // Aggregate open P/L for our magic number
    double openPnL = 0;
    for (int i = OrdersTotal() - 1; i >= 0; i--)
    {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
        if (OrderMagicNumber() != MagicNumber)            continue;
        if (OrderSymbol()      != Symbol())               continue;
        openPnL += OrderProfit() + OrderSwap() + OrderCommission();
    }

    int buyGrid   = CountByPrefix(PREFIX_GRID  + "Buy");
    int sellGrid  = CountByPrefix(PREFIX_GRID  + "Sell");
    int trendBuy  = CountByPrefix(PREFIX_TREND + "Buy");
    int trendSell = CountByPrefix(PREFIX_TREND + "Sell");
    int trendPos  = trendBuy + trendSell;

    // Mode label + color
    string modeStr;
    color  modeClr;
    if (marketMode ==  1) { modeStr = "TRENDING UP";   modeClr = clrLimeGreen; }
    else if (marketMode == -1) { modeStr = "TRENDING DN";   modeClr = clrTomato;    }
    else                  { modeStr = "RANGING";        modeClr = clrDodgerBlue; }

    // P/L color
    color pnlClr = (openPnL >= 0) ? clrLimeGreen : clrTomato;

    // DD color: green OK, orange warn, red danger
    color ddClr = clrLimeGreen;
    if (dd >= MaxDrawdown_Pct * 0.5) ddClr = clrOrange;
    if (dd >= MaxDrawdown_Pct * 0.8) ddClr = clrTomato;

    SetLabelText(OBJ_MODE_VAL,  modeStr,                        modeClr);
    SetLabelText(OBJ_ADX_VAL,   DoubleToString(adx, 1),         clrWhite);
    SetLabelText(OBJ_PNL_VAL,   (openPnL >= 0 ? "+" : "") +
                                 DoubleToString(openPnL, 2),     pnlClr);
    SetLabelText(OBJ_DD_VAL,    DoubleToString(dd, 2) + "%",    ddClr);
    SetLabelText(OBJ_GBUY_VAL,  IntegerToString(buyGrid)  + " / " +
                                 IntegerToString(Grid_MaxLevels), clrLimeGreen);
    SetLabelText(OBJ_GSELL_VAL, IntegerToString(sellGrid) + " / " +
                                 IntegerToString(Grid_MaxLevels), clrTomato);
    SetLabelText(OBJ_TPOS_VAL,  IntegerToString(trendPos) + " pos",clrDodgerBlue);
    SetLabelText(OBJ_PIVOT_VAL, DoubleToString(pivotP, Digits),   clrKhaki);

    ChartRedraw(0);
}

void RemoveDashboard()
{
    string names[] = {OBJ_BG, OBJ_TITLE, OBJ_SEP,
                      OBJ_MODE,  OBJ_MODE_VAL,
                      OBJ_ADX,   OBJ_ADX_VAL,
                      OBJ_PNL,   OBJ_PNL_VAL,
                      OBJ_DD,    OBJ_DD_VAL,
                      OBJ_GBUY,  OBJ_GBUY_VAL,
                      OBJ_GSELL, OBJ_GSELL_VAL,
                      OBJ_TPOS,  OBJ_TPOS_VAL,
                      OBJ_PIVOT, OBJ_PIVOT_VAL};
    for (int i = 0; i < ArraySize(names); i++)
        ObjectDelete(0, names[i]);
    ChartRedraw(0);
}

void MakeLabel(string name, string text, int x, int y,
               int fontSize, color clr, bool bold)
{
    ObjectCreate    (0, name, OBJ_LABEL, 0, 0, 0);
    ObjectSetInteger(0, name, OBJPROP_XDISTANCE,  x);
    ObjectSetInteger(0, name, OBJPROP_YDISTANCE,  y);
    ObjectSetInteger(0, name, OBJPROP_CORNER,     CORNER_LEFT_UPPER);
    ObjectSetInteger(0, name, OBJPROP_ANCHOR,     ANCHOR_LEFT_UPPER);
    ObjectSetInteger(0, name, OBJPROP_FONTSIZE,   fontSize);
    ObjectSetInteger(0, name, OBJPROP_COLOR,      clr);
    ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
    ObjectSetInteger(0, name, OBJPROP_BACK,       false);
    ObjectSetString (0, name, OBJPROP_FONT,       bold ? "Arial Bold" : "Arial");
    ObjectSetString (0, name, OBJPROP_TEXT,       text);
}

void SetLabelText(string name, string text, color clr)
{
    ObjectSetString (0, name, OBJPROP_TEXT,  text);
    ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
}

//────────────────────────────────────────────────────────────────────
//  ORDER HELPERS
//────────────────────────────────────────────────────────────────────
int OpenOrder(int type, double lot, double sl, double tp, string cmt)
{
    double price = (type == OP_BUY) ? Ask : Bid;
    color  clr   = (type == OP_BUY) ? clrBlue : clrRed;
    int ticket = OrderSend(Symbol(), type, lot, price, Slippage,
                           NormalizeDouble(sl, Digits),
                           NormalizeDouble(tp, Digits),
                           cmt, MagicNumber, 0, clr);
    if (ticket < 0)
        Print("OrderSend error=", GetLastError(), " type=", type,
              " lot=", lot, " sl=", sl, " tp=", tp);
    return ticket;
}

void CloseByPrefix(string prefix)
{
    for (int i = OrdersTotal() - 1; i >= 0; i--)
    {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
        if (OrderMagicNumber() != MagicNumber)            continue;
        if (OrderSymbol()      != Symbol())               continue;
        if (StringFind(OrderComment(), prefix) < 0)       continue;
        double price = (OrderType() == OP_BUY) ? Bid : Ask;
        if (!OrderClose(OrderTicket(), OrderLots(), price, Slippage, clrNONE))
            Print("OrderClose error=", GetLastError(), " ticket=", OrderTicket());
    }
}

int CountByPrefix(string prefix)
{
    int n = 0;
    for (int i = OrdersTotal() - 1; i >= 0; i--)
    {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))  continue;
        if (OrderMagicNumber() != MagicNumber)             continue;
        if (OrderSymbol()      != Symbol())                continue;
        if (StringFind(OrderComment(), prefix) == 0)       n++;
    }
    return n;
}

bool IsOurs(string prefix)
{
    return (OrderMagicNumber() == MagicNumber  &&
            OrderSymbol()      == Symbol()      &&
            StringFind(OrderComment(), prefix) == 0);
}

double GetLastOpenPrice(string prefix)
{
    double   p = 0;
    datetime t = 0;
    for (int i = OrdersTotal() - 1; i >= 0; i--)
    {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
        if (!IsOurs(prefix)) continue;
        if (OrderOpenTime() > t) { t = OrderOpenTime(); p = OrderOpenPrice(); }
    }
    return p;
}

double GetFirstOpenPrice(string prefix)
{
    double   p = 0;
    datetime t = D'3000.01.01';
    for (int i = OrdersTotal() - 1; i >= 0; i--)
    {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
        if (!IsOurs(prefix)) continue;
        if (OrderOpenTime() < t) { t = OrderOpenTime(); p = OrderOpenPrice(); }
    }
    return p;
}

double NormalizeLot(double lot)
{
    double mn  = MarketInfo(Symbol(), MODE_MINLOT);
    double mx  = MarketInfo(Symbol(), MODE_MAXLOT);
    double stp = MarketInfo(Symbol(), MODE_LOTSTEP);
    return NormalizeDouble(MathMax(mn, MathMin(mx,
           MathFloor(lot / stp) * stp)), 2);
}

string ModeLabel(int m)
{
    if (m ==  1) return "TRENDING_UP";
    if (m == -1) return "TRENDING_DN";
    return "RANGING";
}
//+------------------------------------------------------------------+
