// SaviourPlus EA — Multi-Pair Backtester
// Runs on H1 data for longer period (Jun–Oct 2024 ≈ 4 months)
// Falls back to M15 if H1 unavailable for a pair
'use strict';
const fs   = require('fs');
const path = require('path');

const HIST = String.raw`C:\Users\hp\AppData\Roaming\MetaQuotes\Terminal\DC7D4808E49DA56212633C305FFB64D2\history\JustMarkets-Live4`;

// All requested pairs
const PAIRS = ['EURUSD','USDJPY','AUDUSD','USDCHF','AUDCAD'];
// EURCHF and NZDUSD: not available in broker history — excluded

// ── EA Parameters ─────────────────────────────────────────────────────
const ADX_P=14, ADX_TREND=25, ADX_RANGE=20;
const EMA_FAST=21, EMA_SLOW=50;
const CHAN_P=20;
const G_LOT=0.01, G_MULT=1.3, G_MAX=5, G_STEP=25, G_TP_PIPS=25, PIV_ZONE=12;
const G_ONE_DIR=true;
const T_LOT=0.01, ATR_P=14, ATR_SL=1.5, ATR_TP_M=2.5;
const PYR_MAX=3, PYR_STEP=25;
const MAX_DD=20.0;
const CLOSE_G_ON_T=true, CLOSE_T_ON_R=true;
const BALANCE0=1000.0, PIP_SIZE=0.0001;

// Per-pair tick value (USD per pip per 0.01 lot)
// For USD/xxx pairs: 0.10 USD/pip/0.01lot (EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCHF*approx, AUDCAD*approx)
// For xxx/JPY pairs: ~0.067 USD/pip/0.01lot at 150 USDJPY
// EURCHF: approx 0.10 (CHF counter, ~1:1 EUR/CHF = $0.10)
const TICK_VALS = {
  EURUSD: 0.10, USDJPY: 0.067, AUDUSD: 0.10, USDCHF: 0.10,
  EURCHF: 0.10, AUDCAD: 0.075, NZDUSD: 0.10, GBPUSD: 0.10
};
// Spread per pair in pips
const SPREADS = {
  EURUSD: 1.5, USDJPY: 2.0, AUDUSD: 2.0, USDCHF: 2.5,
  EURCHF: 3.0, AUDCAD: 3.0, NZDUSD: 2.5, GBPUSD: 2.0
};
// Pip size per pair
const PIP_SIZES = {
  EURUSD: 0.0001, USDJPY: 0.01, AUDUSD: 0.0001, USDCHF: 0.0001,
  EURCHF: 0.0001, AUDCAD: 0.0001, NZDUSD: 0.0001, GBPUSD: 0.0001
};

// ── Binary reader ─────────────────────────────────────────────────────
function readI64(buf, offset) {
  if (buf.readBigInt64LE) return Number(buf.readBigInt64LE(offset));
  const lo = buf.readUInt32LE(offset), hi = buf.readInt32LE(offset + 4);
  return hi * 0x100000000 + lo;
}

function readHST(filepath) {
  if (!fs.existsSync(filepath)) return null;
  const buf = fs.readFileSync(filepath);
  if (buf.length < 208) return null;
  const sym    = buf.slice(68,80).toString('ascii').replace(/\0/g,'');
  const period = buf.readInt32LE(80);
  const bars   = [];
  let pos = 148;
  while (pos + 60 <= buf.length) {
    const ctm = readI64(buf, pos);
    bars.push({
      t: new Date(ctm * 1000),
      o: buf.readDoubleLE(pos+8),
      h: buf.readDoubleLE(pos+16),
      l: buf.readDoubleLE(pos+24),
      c: buf.readDoubleLE(pos+32)
    });
    pos += 60;
  }
  return { bars, sym, period };
}

// ── Indicators ────────────────────────────────────────────────────────
function buildInd(bars) {
  const n=bars.length, adx=new Float64Array(n), ef=new Float64Array(n),
        es=new Float64Array(n), atr=new Float64Array(n),
        sdp=new Float64Array(n), sdm=new Float64Array(n), str=new Float64Array(n);
  ef[0]=es[0]=bars[0].c;
  const a=1/ATR_P, kf=2/(EMA_FAST+1), ks=2/(EMA_SLOW+1);
  const dx=new Float64Array(n);
  for (let i=1;i<n;i++) {
    const b=bars[i],p=bars[i-1];
    ef[i]=b.c*kf+ef[i-1]*(1-kf); es[i]=b.c*ks+es[i-1]*(1-ks);
    const tr=Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c));
    const um=b.h-p.h, dm=p.l-b.l;
    const dp=(um>dm&&um>0)?um:0, dn=(dm>um&&dm>0)?dm:0;
    if (i===1){str[i]=tr;sdp[i]=dp;sdm[i]=dn;atr[i]=tr;}
    else{str[i]=str[i-1]*(1-a)+tr;sdp[i]=sdp[i-1]*(1-a)+dp;sdm[i]=sdm[i-1]*(1-a)+dn;atr[i]=atr[i-1]*(1-a)+tr;}
    const dip=str[i]>0?sdp[i]/str[i]*100:0, dim=str[i]>0?sdm[i]/str[i]*100:0, s=dip+dim;
    dx[i]=s>0?Math.abs(dip-dim)/s*100:0;
    adx[i]=i===1?dx[i]:adx[i-1]*(1-a)+dx[i];
  }
  return {adx,ef,es,atr};
}

// ── Single-pair backtest ──────────────────────────────────────────────
function runBacktest(symbol, bars, ind, d1bars, t0, t1) {
  const pip    = PIP_SIZES[symbol]  || 0.0001;
  const spread = (SPREADS[symbol]   || 2.0) * pip;
  const tv     = TICK_VALS[symbol]  || 0.10;  // USD per pip per 0.01 lot

  let bal=BALANCE0, orders=[], closed=[], mode=0;
  let pvDay=null, pvP=0, pvR1=0, pvR2=0, pvS1=0, pvS2=0;
  let peakEq=BALANCE0, maxDD=0;
  let nextId=1;

  function ba(i){ return [bars[i].c, bars[i].c+spread]; }
  function eq(i){
    const [bid]=ba(i); let fl=0;
    for(const o of orders){const p=o.k==='B'?(bid-o.p)/pip:(o.p-bid)/pip; fl+=p*tv*o.l*100;}
    return bal+fl;
  }
  function closeO(o,i,why,cp0){
    const [bid,ask]=ba(i);
    const cp=cp0!==undefined?cp0:(o.k==='B'?bid:ask);
    const pips=o.k==='B'?(cp-o.p)/pip:(o.p-cp)/pip;
    const pnl=pips*tv*o.l*100;
    bal+=pnl; closed.push({k:o.k,l:o.l,op:o.p,cp,pips,pnl,c:o.c,why});
    orders=orders.filter(x=>x!==o);
  }
  function closeBy(pfx,i,why){[...orders].filter(x=>x.c.startsWith(pfx)).forEach(o=>closeO(o,i,why));}
  function cnt(pfx){return orders.filter(x=>x.c.startsWith(pfx)).length;}
  function lastP(pfx){const os=orders.filter(x=>x.c.startsWith(pfx));return os.length?os[os.length-1].p:0;}
  function firstP(pfx){const os=orders.filter(x=>x.c.startsWith(pfx));return os.length?os[0].p:0;}
  function openO(i,k,l,sl,tp,c){
    const [bid,ask]=ba(i); orders.push({id:nextId++,k,l,p:k==='B'?ask:bid,sl,tp,c});
  }
  function nL(x){return Math.max(0.01,Math.round(x/0.01)*0.01);}
  function ds(d){return d.toISOString().slice(0,10);}
  function prevDs(d){const p=new Date(d);p.setUTCDate(p.getUTCDate()-1);return p.toISOString().slice(0,10);}

  function refPivots(i){
    const today=ds(bars[i].t); if(today===pvDay)return; pvDay=today;
    const prev=prevDs(bars[i].t);
    const d1p=d1bars.filter(b=>ds(b.t)===prev);
    let ph,pl,pc;
    if(d1p.length){const b=d1p[d1p.length-1];ph=b.h;pl=b.l;pc=b.c;}
    else{
      const m=bars.slice(0,i).filter(b=>ds(b.t)===prev);
      if(!m.length)return;
      ph=Math.max(...m.map(b=>b.h));pl=Math.min(...m.map(b=>b.l));pc=m[m.length-1].c;
    }
    pvP=(ph+pl+pc)/3; pvR1=2*pvP-pl; pvR2=pvP+(ph-pl); pvS1=2*pvP-ph; pvS2=pvP-(ph-pl);
  }
  function nearPiv(price,res){
    const z=PIV_ZONE*pip;
    if(res)return[pvR1,pvR2,pvP].some(x=>Math.abs(price-x)<=z);
    return[pvS1,pvS2,pvP].some(x=>Math.abs(price-x)<=z);
  }

  function chkSLTP(i){
    const b=bars[i];
    for(const o of [...orders]){
      if(!orders.includes(o))continue;
      if(o.k==='B'){if(o.sl&&b.l<=o.sl)closeO(o,i,'SL',o.sl);else if(o.tp&&b.h>=o.tp)closeO(o,i,'TP',o.tp);}
      else{if(o.sl&&b.h>=o.sl)closeO(o,i,'SL',o.sl);else if(o.tp&&b.l<=o.tp)closeO(o,i,'TP',o.tp);}
    }
  }

  function detMode(i){
    if(i<2)return 0;
    const av=ind.adx[i-1],ev=ind.ef[i-1],sv=ind.es[i-1];
    if(av<=ADX_RANGE)return 0; if(av>=ADX_TREND)return ev>sv?1:-1; return mode;
  }

  function baskTP(i,k,pfx){
    const[bid,ask]=ba(i); const os=orders.filter(x=>x.c.startsWith(pfx));
    if(!os.length)return;
    let tl=0,tp2=0;
    for(const o of os){const p=o.k==='B'?(bid-o.p)/pip:(o.p-ask)/pip;tp2+=p*tv*o.l*100;tl+=o.l;}
    const tgt=tl*G_TP_PIPS*tv*100;
    if(tp2>=tgt&&tgt>0)closeBy(pfx,i,'BasketTP');
  }

  function extGrid(i,k,pfx){
    const lp=lastP(pfx); if(!lp)return;
    const[bid,ask]=ba(i); const cur=k==='B'?bid:ask;
    const chk=k==='B'?(lp-cur)>=G_STEP*pip:(cur-lp)>=G_STEP*pip;
    if(!chk)return;
    const n=cnt(pfx); openO(i,k,nL(G_LOT*Math.pow(G_MULT,n)),0,0,`${pfx}_L${n}`);
  }

  function runRange(i){
    if(i<CHAN_P+1)return;
    const cbs=bars.slice(i-CHAN_P,i);
    const hi=Math.max(...cbs.map(b=>b.h)), lo=Math.min(...cbs.map(b=>b.l)), rng=hi-lo;
    if(rng<=0)return;
    const cb=bars[i-1].c, ob=bars[i-1].o, bull=cb>ob, bear=cb<ob, pos=(cb-lo)/rng;
    if(cnt('SP_Grid_Buy')>0)baskTP(i,'B','SP_Grid_Buy');
    if(cnt('SP_Grid_Sell')>0)baskTP(i,'S','SP_Grid_Sell');
    const bc=cnt('SP_Grid_Buy'), sc=cnt('SP_Grid_Sell');
    const other=G_ONE_DIR&&(bc>0||sc>0);
    if(!bc&&!other&&pos<=0.25&&bull&&nearPiv(cb,false))openO(i,'B',G_LOT,0,0,'SP_Grid_Buy_L0');
    if(!sc&&!other&&pos>=0.75&&bear&&nearPiv(cb,true))openO(i,'S',G_LOT,0,0,'SP_Grid_Sell_L0');
    const bc2=cnt('SP_Grid_Buy'), sc2=cnt('SP_Grid_Sell');
    if(bc2>0&&bc2<G_MAX)extGrid(i,'B','SP_Grid_Buy');
    if(sc2>0&&sc2<G_MAX)extGrid(i,'S','SP_Grid_Sell');
  }

  function tryPyr(i,k,pfx,n,av){
    const fp=firstP(pfx); if(!fp)return;
    const[bid,ask]=ba(i); const cur=k==='B'?bid:ask;
    const pp=k==='B'?(cur-fp)/pip:(fp-cur)/pip;
    if(pp<n*PYR_STEP)return;
    const e=k==='B'?ask:bid;
    const sl=k==='B'?+(e-av*ATR_SL).toFixed(5):+(e+av*ATR_SL).toFixed(5);
    const tp=k==='B'?+(e+av*ATR_TP_M).toFixed(5):+(e-av*ATR_TP_M).toFixed(5);
    openO(i,k,T_LOT,sl,tp,`${pfx}_L${n}`);
  }

  function trail(i,k,av){
    const[bid,ask]=ba(i), dist=av*ATR_SL;
    for(const o of orders){
      if(!o.c.includes('SP_Trend_')||o.k!==k)continue;
      if(k==='B'){const ns=bid-dist;if(ns>o.sl+pip&&ns<bid-pip)o.sl=+ns.toFixed(5);}
      else{const ns=ask+dist;if((!o.sl||ns<o.sl-pip)&&ns>ask+pip)o.sl=+ns.toFixed(5);}
    }
  }

  function runTrend(i){
    if(i<CHAN_P+2)return;
    const bull=mode===1, k=bull?'B':'S', pfx=bull?'SP_Trend_Buy':'SP_Trend_Sell', n=cnt(pfx);
    const av=ind.atr[i-1]; if(av<=0)return;
    const cbs=bars.slice(i-CHAN_P-1,i-1);
    const chH=Math.max(...cbs.map(b=>b.h)), chL=Math.min(...cbs.map(b=>b.l));
    const cb=bars[i-1].c;
    const[bid,ask]=ba(i);
    if(n===0){
      const bu=bull&&cb>chH, bd=!bull&&cb<chL; if(!bu&&!bd)return;
      const e=bull?ask:bid;
      const sl=bull?+(e-av*ATR_SL).toFixed(5):+(e+av*ATR_SL).toFixed(5);
      const tp=bull?+(e+av*ATR_TP_M).toFixed(5):+(e-av*ATR_TP_M).toFixed(5);
      openO(i,k,T_LOT,sl,tp,`${pfx}_L0`);
    } else {
      if(n<PYR_MAX)tryPyr(i,k,pfx,n,av);
      trail(i,k,av);
    }
  }

  // ── Run ──────────────────────────────────────────────────────────
  const si=bars.findIndex(b=>b.t>=t0);
  let ei=bars.findIndex(b=>b.t>t1); if(ei===-1)ei=bars.length;
  if(si===-1)return null;
  const LKB=Math.max(ADX_P*4,EMA_SLOW,CHAN_P)+5;
  for(let i=si;i<ei;i++){
    chkSLTP(i);
    const e=eq(i);
    if(e>peakEq)peakEq=e;
    const dd=(peakEq-e)/peakEq*100; if(dd>maxDD)maxDD=dd;
    if(i-si<LKB)continue;
    refPivots(i);
    const pm=mode; mode=detMode(i);
    if(mode!==pm){
      if(mode!==0&&CLOSE_G_ON_T)closeBy('SP_Grid_',i,'→Trend');
      if(mode===0&&CLOSE_T_ON_R)closeBy('SP_Trend_',i,'→Range');
    }
    if(bal>0&&(bal-e)/bal*100>=MAX_DD){closeBy('SP_Grid_',i,'EmgDD');closeBy('SP_Trend_',i,'EmgDD');continue;}
    if(mode===0)runRange(i); else runTrend(i);
  }
  for(const o of [...orders])closeO(o,ei-1,'EOT');

  const C=closed, n=C.length;
  const net=bal-BALANCE0;
  const wins=C.filter(x=>x.pnl>0), L=C.filter(x=>x.pnl<=0);
  const gp=wins.reduce((s,x)=>s+x.pnl,0), gl=L.reduce((s,x)=>s+x.pnl,0);
  const pf=gl?Math.abs(gp/gl):Infinity;
  const avgW=wins.length?gp/wins.length:0, avgL=L.length?gl/L.length:0;
  const winR=n?wins.length/n*100:0;
  const byWhy={};C.forEach(t=>{byWhy[t.why]=(byWhy[t.why]||0)+1;});
  const gridTrades=C.filter(x=>x.c.startsWith('SP_Grid')).length;
  const trendTrades=C.filter(x=>x.c.startsWith('SP_Trend')).length;
  const df=bars[si].t, dt=bars[Math.min(ei-1,bars.length-1)].t;
  return {sym:symbol,n,wins:wins.length,L:L.length,winR,net,bal,pf,dd:maxDD,avgW,avgL,gp,gl,byWhy,gridTrades,trendTrades,from:df,to:dt};
}

// ── Main ──────────────────────────────────────────────────────────────
const T0 = new Date('2024-06-01T00:00:00Z');
const T1 = new Date('2024-10-31T23:59:59Z');

console.log('\n' + '='.repeat(115));
console.log('   SAVIOURPLUS EA — MULTI-PAIR BACKTEST  |  H1 primary / M15 secondary  |  Jun–Oct 2024  |  $1,000 / 1:100');
console.log('   Pairs tested: EURUSD, USDJPY, AUDUSD, USDCHF (view data), AUDCAD');
console.log('   EURCHF, NZDUSD: NOT AVAILABLE in broker history — skipped');
console.log('='.repeat(115));

const header = [
  'Pair   ','Period     ','Bars ','Net P&L   ','Bal $    ','Trades','W   ','L   ','WR%  ','PF   ','MaxDD%','AvgW $  ','AvgL $  ','Grid','Trend'
].join('');
console.log('\n' + header);
console.log('-'.repeat(115));

const allResults = [];

for (const sym of PAIRS) {
  // Try H1 first (longer period), fall back to M15
  let m15data=null, d1data=null;
  let tfLabel='H1';
  // USDCHF has no regular m60.hst but has view60.hst with same format
  const h1path  = fs.existsSync(path.join(HIST, `${sym}.m60.hst`))
    ? path.join(HIST, `${sym}.m60.hst`)
    : path.join(HIST, `${sym}.view60.hst`);
  const m15path = fs.existsSync(path.join(HIST, `${sym}.m15.hst`))
    ? path.join(HIST, `${sym}.m15.hst`)
    : path.join(HIST, `${sym}.view30.hst`); // M30 as fallback for USDCHF
  const d1path  = path.join(HIST, `${sym}.m1440.hst`);

  let res_h1 = null;
  if (fs.existsSync(h1path)) {
    const h1r = readHST(h1path);
    d1data = fs.existsSync(d1path) ? (readHST(d1path)||{bars:[]}).bars : [];
    if (h1r) {
      const ind = buildInd(h1r.bars);
      res_h1 = runBacktest(sym, h1r.bars, ind, d1data, T0, T1);
      if (res_h1) res_h1.tf = 'H1';
    }
  }

  // Also run M15 for comparison (separate line)
  let res_m15 = null;
  if (fs.existsSync(m15path)) {
    const m15r = readHST(m15path);
    if (!d1data) d1data = fs.existsSync(d1path) ? (readHST(d1path)||{bars:[]}).bars : [];
    if (m15r) {
      const ind = buildInd(m15r.bars);
      const t0m15 = new Date(Math.max(T0, m15r.bars[0].t));
      res_m15 = runBacktest(sym, m15r.bars, ind, d1data, t0m15, T1);
      if (res_m15) res_m15.tf = 'M15';
    }
  }

  function fmtRow(r) {
    if (!r) return null;
    const from = r.from.toISOString().slice(0,10);
    const to   = r.to  .toISOString().slice(0,10);
    const period = `${from}→${to.slice(5)}`;
    const net  = (r.net>=0?'+':'')+r.net.toFixed(2);
    const pf   = isFinite(r.pf)?r.pf.toFixed(2):'∞   ';
    return [
      `${r.sym}/${r.tf}`.padEnd(10),
      period.padEnd(15),
      String(r.n).padStart(5),
      net.padStart(10),
      r.bal.toFixed(2).padStart(9),
      String(r.n).padStart(6),
      String(r.wins).padStart(4),
      String(r.L).padStart(4),
      r.winR.toFixed(0).padStart(5),
      pf.padStart(5),
      r.dd.toFixed(1).padStart(6),
      r.avgW.toFixed(2).padStart(8),
      r.avgL.toFixed(2).padStart(8),
      String(r.gridTrades).padStart(4),
      String(r.trendTrades).padStart(5),
    ].join('  ');
  }

  if (res_h1)  { console.log(fmtRow(res_h1));  allResults.push(res_h1); }
  if (res_m15) { console.log(fmtRow(res_m15)); allResults.push(res_m15); }
  if (!res_h1 && !res_m15) {
    console.log(`${sym.padEnd(10)}  *** NO DATA AVAILABLE ***`);
  }
}

console.log('-'.repeat(115));

// Summary of H1 results only
const h1Results = allResults.filter(r => r.tf === 'H1');
if (h1Results.length > 0) {
  const totNet = h1Results.reduce((s,r)=>s+r.net,0);
  const totTrades = h1Results.reduce((s,r)=>s+r.n,0);
  const totWins = h1Results.reduce((s,r)=>s+r.wins,0);
  const totLoss = h1Results.reduce((s,r)=>s+r.L,0);
  const avgDD = h1Results.reduce((s,r)=>s+r.dd,0)/h1Results.length;
  const avgPF = h1Results.filter(r=>isFinite(r.pf)).reduce((s,r)=>s+r.pf,0)/h1Results.filter(r=>isFinite(r.pf)).length;
  console.log(`\n  H1 SUMMARY (${h1Results.length} pairs):`);
  console.log(`  Total Net P&L   : ${totNet>=0?'+':''}$${totNet.toFixed(2)} across all pairs`);
  console.log(`  Total Trades    : ${totTrades}  (W:${totWins}  L:${totLoss}  WR:${(totWins/totTrades*100).toFixed(0)}%)`);
  console.log(`  Avg Drawdown    : ${avgDD.toFixed(1)}%`);
  console.log(`  Avg Profit Fctr : ${avgPF.toFixed(2)}`);
}

// Detailed breakdown per pair
console.log('\n── CLOSE REASON BREAKDOWN (H1) ──');
for (const r of h1Results) {
  console.log(`  ${r.sym}: ${JSON.stringify(r.byWhy)}`);
}
