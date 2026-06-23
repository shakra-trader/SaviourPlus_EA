// SaviourPlus EA — JavaScript Backtester (Node.js)
'use strict';
const fs = require('fs');

const HST_M15 = String.raw`C:\Users\hp\AppData\Roaming\MetaQuotes\Terminal\DC7D4808E49DA56212633C305FFB64D2\history\JustMarkets-Live4\EURUSD.m15.hst`;
const HST_D1  = String.raw`C:\Users\hp\AppData\Roaming\MetaQuotes\Terminal\DC7D4808E49DA56212633C305FFB64D2\history\JustMarkets-Live4\EURUSD.m1440.hst`;

// ── EA Parameters ────────────────────────────────────────────────────
const ADX_P=14, ADX_TREND=25, ADX_RANGE=20;
const EMA_FAST=21, EMA_SLOW=50;
const CHAN_P=20;
const G_LOT=0.01, G_MULT=1.3, G_MAX=5, G_STEP=25, G_TP_PIPS=25, PIV_ZONE=12;
const G_ONE_DIR=true;
const T_LOT=0.01, ATR_P=14, ATR_SL=1.5, ATR_TP_M=2.5;
const PYR_MAX=3, PYR_STEP=25;
const MAX_DD=20.0;
const CLOSE_G_ON_T=true, CLOSE_T_ON_R=true;
const BALANCE0=1000.0, SPREAD=0.0002, PIP=0.0001, TICK_VAL=10.0;

// ── Binary reader helper ─────────────────────────────────────────────
// readBigInt64LE polyfill for older Node
function readI64(buf, offset) {
  if (buf.readBigInt64LE) {
    return Number(buf.readBigInt64LE(offset));
  }
  const lo = buf.readUInt32LE(offset);
  const hi = buf.readInt32LE(offset + 4);
  return hi * 0x100000000 + lo;
}

function readHST(path) {
  const buf = fs.readFileSync(path);
  const version = buf.readInt32LE(0);
  const sym = buf.slice(68, 80).toString('ascii').replace(/\0/g, '');
  const period = buf.readInt32LE(80);
  const digits = buf.readInt32LE(84);
  const bars = [];
  let pos = 148;
  while (pos + 60 <= buf.length) {
    const ctm = readI64(buf, pos);
    const o = buf.readDoubleLE(pos + 8);
    const h = buf.readDoubleLE(pos + 16);
    const l = buf.readDoubleLE(pos + 24);
    const c = buf.readDoubleLE(pos + 32);
    bars.push({ t: new Date(ctm * 1000), o, h, l, c });
    pos += 60;
  }
  console.log(`  ${sym} M${period}: ${bars.length} bars  ${bars[0].t.toISOString().slice(0,16)} → ${bars[bars.length-1].t.toISOString().slice(0,16)}`);
  return { bars, digits };
}

// ── Indicators ───────────────────────────────────────────────────────
function buildIndicators(bars) {
  const n = bars.length;
  const adx = new Float64Array(n);
  const ef   = new Float64Array(n);
  const es   = new Float64Array(n);
  const atr  = new Float64Array(n);
  const sdp  = new Float64Array(n);
  const sdm  = new Float64Array(n);
  const str  = new Float64Array(n);
  const dx   = new Float64Array(n);
  ef[0] = es[0] = bars[0].c;
  const a = 1 / ATR_P;
  const kf = 2 / (EMA_FAST + 1);
  const ks = 2 / (EMA_SLOW + 1);
  for (let i = 1; i < n; i++) {
    const b = bars[i], p = bars[i - 1];
    ef[i] = b.c * kf + ef[i - 1] * (1 - kf);
    es[i] = b.c * ks + es[i - 1] * (1 - ks);
    const tr  = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    const um  = b.h - p.h, dm = p.l - b.l;
    const dp  = (um > dm && um > 0) ? um : 0;
    const dn  = (dm > um && dm > 0) ? dm : 0;
    if (i === 1) {
      str[i] = tr; sdp[i] = dp; sdm[i] = dn; atr[i] = tr;
    } else {
      str[i] = str[i - 1] * (1 - a) + tr;
      sdp [i] = sdp [i - 1] * (1 - a) + dp;
      sdm [i] = sdm [i - 1] * (1 - a) + dn;
      atr [i] = atr [i - 1] * (1 - a) + tr;
    }
    const dip = str[i] > 0 ? sdp[i] / str[i] * 100 : 0;
    const dim = str[i] > 0 ? sdm[i] / str[i] * 100 : 0;
    const s   = dip + dim;
    dx[i]  = s > 0 ? Math.abs(dip - dim) / s * 100 : 0;
    adx[i] = i === 1 ? dx[i] : adx[i - 1] * (1 - a) + dx[i];
  }
  return { adx, ef, es, atr };
}

// ── Order ────────────────────────────────────────────────────────────
let nextTicket = 1;
function Order(kind, lots, price, sl, tp, cmt) {
  return { id: nextTicket++, kind, lots, price, sl, tp, cmt };
}

// ── Backtester ───────────────────────────────────────────────────────
function Backtest(bars, ind, d1bars) {
  let bal = BALANCE0;
  let orders = [];
  const closed = [];
  let mode = 0;
  let pvDay = null, pvP = 0, pvR1 = 0, pvR2 = 0, pvS1 = 0, pvS2 = 0;
  let peakEq = BALANCE0, maxDD = 0;

  function bidAsk(i) { return [bars[i].c, bars[i].c + SPREAD]; }

  function equity(i) {
    const [bid, ask] = bidAsk(i);
    let fl = 0;
    for (const o of orders) {
      const p = o.kind === 'B' ? (bid - o.price) / PIP : (o.price - ask) / PIP;
      fl += p * TICK_VAL * o.lots;
    }
    return bal + fl;
  }

  function closeOrder(o, i, why, overridePrice) {
    const [bid, ask] = bidAsk(i);
    const cp = overridePrice !== undefined ? overridePrice : (o.kind === 'B' ? bid : ask);
    const pips = o.kind === 'B' ? (cp - o.price) / PIP : (o.price - cp) / PIP;
    const pnl  = pips * TICK_VAL * o.lots;
    bal += pnl;
    closed.push({ kind: o.kind, lots: o.lots, open: o.price, close: cp, pips, pnl, cmt: o.cmt, why });
    orders = orders.filter(x => x !== o);
  }

  function closeBy(pfx, i, why) {
    for (const o of orders.filter(x => x.cmt.startsWith(pfx))) closeOrder(o, i, why);
  }

  function cnt(pfx) { return orders.filter(x => x.cmt.startsWith(pfx)).length; }
  function lastP(pfx) { const os = orders.filter(x => x.cmt.startsWith(pfx)); return os.length ? os[os.length - 1].price : 0; }
  function firstP(pfx) { const os = orders.filter(x => x.cmt.startsWith(pfx)); return os.length ? os[0].price : 0; }

  function openOrd(i, kind, lots, sl, tp, cmt) {
    const [bid, ask] = bidAsk(i);
    const price = kind === 'B' ? ask : bid;
    orders.push(Order(kind, lots, price, sl, tp, cmt));
  }

  function normLot(x) { return Math.max(0.01, Math.round(x / 0.01) * 0.01); }

  // ── Pivots ──────────────────────────────────────────────────────
  function refreshPivots(i) {
    const today = dateStr(bars[i].t);
    if (today === pvDay) return;
    pvDay = today;
    const prev = prevDateStr(bars[i].t);
    // Try D1 first
    let ph, pl, pc;
    const d1prev = d1bars.filter(b => dateStr(b.t) === prev);
    if (d1prev.length) {
      ph = d1prev[d1prev.length - 1].h;
      pl = d1prev[d1prev.length - 1].l;
      pc = d1prev[d1prev.length - 1].c;
    } else {
      // Fall back to M15 aggregation
      const m15prev = bars.slice(0, i).filter(b => dateStr(b.t) === prev);
      if (!m15prev.length) return;
      ph = Math.max(...m15prev.map(b => b.h));
      pl = Math.min(...m15prev.map(b => b.l));
      pc = m15prev[m15prev.length - 1].c;
    }
    pvP  = (ph + pl + pc) / 3;
    pvR1 = 2 * pvP - pl;
    pvR2 = pvP + (ph - pl);
    pvS1 = 2 * pvP - ph;
    pvS2 = pvP - (ph - pl);
  }

  function nearPiv(price, res) {
    const z = PIV_ZONE * PIP;
    if (res) return [pvR1, pvR2, pvP].some(x => Math.abs(price - x) <= z);
    return [pvS1, pvS2, pvP].some(x => Math.abs(price - x) <= z);
  }

  // ── SL/TP ───────────────────────────────────────────────────────
  function checkSLTP(i) {
    const b = bars[i];
    for (const o of [...orders]) {
      if (!orders.includes(o)) continue;
      if (o.kind === 'B') {
        if (o.sl && b.l <= o.sl) closeOrder(o, i, 'SL', o.sl);
        else if (o.tp && b.h >= o.tp) closeOrder(o, i, 'TP', o.tp);
      } else {
        if (o.sl && b.h >= o.sl) closeOrder(o, i, 'SL', o.sl);
        else if (o.tp && b.l <= o.tp) closeOrder(o, i, 'TP', o.tp);
      }
    }
  }

  // ── Mode detect ─────────────────────────────────────────────────
  function detectMode(i) {
    if (i < 2) return 0;
    const adxV = ind.adx[i - 1], efV = ind.ef[i - 1], esV = ind.es[i - 1];
    if (adxV <= ADX_RANGE) return 0;
    if (adxV >= ADX_TREND) return efV > esV ? 1 : -1;
    return mode; // hysteresis
  }

  // ── Basket TP ───────────────────────────────────────────────────
  function basketTP(i, kind, pfx) {
    const [bid, ask] = bidAsk(i);
    const os = orders.filter(x => x.cmt.startsWith(pfx));
    if (!os.length) return;
    let totLots = 0, totPnl = 0;
    for (const o of os) {
      const p = kind === 'B' ? (bid - o.price) / PIP : (o.price - ask) / PIP;
      totPnl  += p * TICK_VAL * o.lots;
      totLots += o.lots;
    }
    const target = totLots * G_TP_PIPS * TICK_VAL;
    if (totPnl >= target && target > 0) closeBy(pfx, i, 'BasketTP');
  }

  // ── Extend grid ─────────────────────────────────────────────────
  function extendGrid(i, kind, pfx) {
    const lp = lastP(pfx);
    if (!lp) return;
    const [bid, ask] = bidAsk(i);
    const cur = kind === 'B' ? bid : ask;
    const chk = kind === 'B' ? (lp - cur) >= G_STEP * PIP : (cur - lp) >= G_STEP * PIP;
    if (!chk) return;
    const n = cnt(pfx);
    openOrd(i, kind, normLot(G_LOT * Math.pow(G_MULT, n)), 0, 0, `${pfx}_L${n}`);
  }

  // ── Ranging ─────────────────────────────────────────────────────
  function runRanging(i) {
    if (i < CHAN_P + 1) return;
    const cbs = bars.slice(i - CHAN_P, i);
    const hi  = Math.max(...cbs.map(b => b.h));
    const lo  = Math.min(...cbs.map(b => b.l));
    const rng = hi - lo;
    if (rng <= 0) return;
    const cb = bars[i - 1].c, ob = bars[i - 1].o;
    const bull = cb > ob, bear = cb < ob;
    const pos  = (cb - lo) / rng;

    if (cnt('SP_Grid_Buy')  > 0) basketTP(i, 'B', 'SP_Grid_Buy');
    if (cnt('SP_Grid_Sell') > 0) basketTP(i, 'S', 'SP_Grid_Sell');

    const bc = cnt('SP_Grid_Buy'), sc = cnt('SP_Grid_Sell');
    const other = G_ONE_DIR && (bc > 0 || sc > 0);

    if (!bc && !other && pos <= 0.25 && bull && nearPiv(cb, false))
      openOrd(i, 'B', G_LOT, 0, 0, 'SP_Grid_Buy_L0');
    if (!sc && !other && pos >= 0.75 && bear && nearPiv(cb, true))
      openOrd(i, 'S', G_LOT, 0, 0, 'SP_Grid_Sell_L0');

    const bc2 = cnt('SP_Grid_Buy'), sc2 = cnt('SP_Grid_Sell');
    if (bc2 > 0 && bc2 < G_MAX) extendGrid(i, 'B', 'SP_Grid_Buy');
    if (sc2 > 0 && sc2 < G_MAX) extendGrid(i, 'S', 'SP_Grid_Sell');
  }

  // ── Pyramid ─────────────────────────────────────────────────────
  function tryPyramid(i, kind, pfx, n, atrV) {
    const fp = firstP(pfx); if (!fp) return;
    const [bid, ask] = bidAsk(i);
    const cur = kind === 'B' ? bid : ask;
    const pp  = kind === 'B' ? (cur - fp) / PIP : (fp - cur) / PIP;
    if (pp < n * PYR_STEP) return;
    const e  = kind === 'B' ? ask : bid;
    const sl = kind === 'B' ? +(e - atrV * ATR_SL).toFixed(5) : +(e + atrV * ATR_SL).toFixed(5);
    const tp = kind === 'B' ? +(e + atrV * ATR_TP_M).toFixed(5) : +(e - atrV * ATR_TP_M).toFixed(5);
    openOrd(i, kind, T_LOT, sl, tp, `${pfx}_L${n}`);
  }

  // ── Trailing stop ────────────────────────────────────────────────
  function trailStop(i, kind, atrV) {
    const [bid, ask] = bidAsk(i);
    const dist = atrV * ATR_SL;
    for (const o of orders) {
      if (!o.cmt.includes('SP_Trend_') || o.kind !== kind) continue;
      if (kind === 'B') {
        const nsl = bid - dist;
        if (nsl > o.sl + PIP && nsl < bid - PIP) o.sl = +nsl.toFixed(5);
      } else {
        const nsl = ask + dist;
        if ((!o.sl || nsl < o.sl - PIP) && nsl > ask + PIP) o.sl = +nsl.toFixed(5);
      }
    }
  }

  // ── Trending ─────────────────────────────────────────────────────
  function runTrending(i) {
    if (i < CHAN_P + 2) return;
    const bull = mode === 1;
    const kind = bull ? 'B' : 'S';
    const pfx  = bull ? 'SP_Trend_Buy' : 'SP_Trend_Sell';
    const n    = cnt(pfx);
    const atrV = ind.atr[i - 1]; if (atrV <= 0) return;
    const cbs  = bars.slice(i - CHAN_P - 1, i - 1);
    if (!cbs.length) return;
    const chH  = Math.max(...cbs.map(b => b.h));
    const chL  = Math.min(...cbs.map(b => b.l));
    const cb   = bars[i - 1].c;
    const [bid, ask] = bidAsk(i);
    if (n === 0) {
      const bu = bull && cb > chH, bd = !bull && cb < chL;
      if (!bu && !bd) return;
      const e  = bull ? ask : bid;
      const sl = bull ? +(e - atrV * ATR_SL).toFixed(5)   : +(e + atrV * ATR_SL).toFixed(5);
      const tp = bull ? +(e + atrV * ATR_TP_M).toFixed(5) : +(e - atrV * ATR_TP_M).toFixed(5);
      openOrd(i, kind, T_LOT, sl, tp, `${pfx}_L0`);
    } else {
      if (n < PYR_MAX) tryPyramid(i, kind, pfx, n, atrV);
      trailStop(i, kind, atrV);
    }
  }

  // ── Main run ─────────────────────────────────────────────────────
  function run(t0, t1) {
    const si = bars.findIndex(b => b.t >= t0);
    let ei   = bars.findIndex(b => b.t > t1);
    if (ei === -1) ei = bars.length;
    const LKB = Math.max(ADX_P * 4, EMA_SLOW, CHAN_P) + 5;
    console.log(`\nRunning ${bars[si].t.toISOString().slice(0,16)} → ${bars[ei-1].t.toISOString().slice(0,16)}  (${ei-si} bars)`);
    for (let i = si; i < ei; i++) {
      checkSLTP(i);
      const eq = equity(i);
      if (eq > peakEq) peakEq = eq;
      const dd = (peakEq - eq) / peakEq * 100;
      if (dd > maxDD) maxDD = dd;
      if (i - si < LKB) continue;
      refreshPivots(i);
      const pm = mode; mode = detectMode(i);
      if (mode !== pm) {
        if (mode !== 0 && CLOSE_G_ON_T) closeBy('SP_Grid_', i, '→Trend');
        if (mode === 0 && CLOSE_T_ON_R) closeBy('SP_Trend_', i, '→Range');
      }
      // Emergency DD
      if (bal > 0 && (bal - eq) / bal * 100 >= MAX_DD) {
        closeBy('SP_Grid_', i, 'EmgDD');
        closeBy('SP_Trend_', i, 'EmgDD');
        continue;
      }
      if (mode === 0) runRanging(i);
      else            runTrending(i);
    }
    // Close all remaining at end
    for (const o of [...orders]) closeOrder(o, ei - 1, 'EOT');
    return stats();
  }

  function stats() {
    const C = closed, n = C.length;
    const net   = bal - BALANCE0;
    const wins  = C.filter(x => x.pnl > 0);
    const L     = C.filter(x => x.pnl <= 0);
    const gp    = wins.reduce((s, x) => s + x.pnl, 0);
    const gl    = L  .reduce((s, x) => s + x.pnl, 0);
    const pf    = gl !== 0 ? Math.abs(gp / gl) : Infinity;
    const avgW  = wins.length ? gp / wins.length : 0;
    const avgL  = L  .length  ? gl / L  .length  : 0;
    const winR  = n ? wins.length / n * 100 : 0;
    return { n, wins: wins.length, losses: L.length, winR, net, bal, pf, dd: maxDD, avgW, avgL, gp, gl, trades: C };
  }

  return { run };
}

// ── Helpers ──────────────────────────────────────────────────────────
function dateStr(d) { return d.toISOString().slice(0, 10); }
function prevDateStr(d) {
  const p = new Date(d); p.setUTCDate(p.getUTCDate() - 1); return p.toISOString().slice(0, 10);
}

// ── Main ─────────────────────────────────────────────────────────────
console.log('Loading data...');
const { bars: m15, digits } = readHST(HST_M15);
const { bars: d1 }          = readHST(HST_D1);
console.log('Building indicators...');
const ind = buildIndicators(m15);
const bt  = Backtest(m15, ind, d1);
const s   = bt.run(new Date('2024-09-18T00:00:00Z'), new Date('2024-10-25T23:59:59Z'));

console.log('\n' + '='.repeat(58));
console.log('   SAVIOURPLUS EA — BACKTEST RESULTS');
console.log('='.repeat(58));
console.log(`  Period      : 2024-09-18 to 2024-10-25`);
console.log(`  Symbol      : EURUSD M15  (Open-prices model)`);
console.log(`  Spread      : 2.0 pips  |  Leverage : 1:100`);
console.log(`  Deposit     : $1,000.00`);
console.log('  ' + '-'.repeat(54));
console.log(`  Net Profit  : $${s.net.toFixed(2)}  (${(s.net/BALANCE0*100).toFixed(1)}%)`);
console.log(`  Final Balance: $${s.bal.toFixed(2)}`);
console.log(`  Total Trades : ${s.n}  (W:${s.wins}  L:${s.losses}  WR:${s.winR.toFixed(0)}%)`);
console.log(`  Profit Factor: ${isFinite(s.pf) ? s.pf.toFixed(2) : '∞'}`);
console.log(`  Gross Profit : $${s.gp.toFixed(2)}   Gross Loss: $${s.gl.toFixed(2)}`);
console.log(`  Avg Win      : $${s.avgW.toFixed(2)}   Avg Loss: $${s.avgL.toFixed(2)}`);
console.log(`  Max Drawdown : ${s.dd.toFixed(1)}%`);
console.log('='.repeat(58));

// Close reason breakdown
const byWhy = {};
for (const t of s.trades) byWhy[t.why] = (byWhy[t.why] || 0) + 1;
console.log('\nClose reasons:', JSON.stringify(byWhy));

// Last 15 trades
console.log('\nLast trades:');
for (const t of s.trades.slice(-15)) {
  const kind = t.kind === 'B' ? 'BUY ' : 'SELL';
  const cmt  = t.cmt.slice(0, 22).padEnd(22);
  console.log(`  ${kind} ${t.lots.toFixed(2)}L  ${t.pips>=0?'+':''}${t.pips.toFixed(1)}p  $${t.pnl>=0?'+':''}${t.pnl.toFixed(2)}  ${cmt}  [${t.why}]`);
}
