'use strict';
// SaviourPlus EA — Before / After Comparison Backtest
// v1.1 baseline vs v1.2 fixed parameters
const fs   = require('fs');
const path = require('path');

const HIST = String.raw`C:\Users\hp\AppData\Roaming\MetaQuotes\Terminal\DC7D4808E49DA56212633C305FFB64D2\history\JustMarkets-Live4`;
const PAIRS = ['EURUSD','USDJPY','AUDUSD','USDCHF','AUDCAD'];

const TICK_VALS  = { EURUSD:0.10, USDJPY:0.067, AUDUSD:0.10, USDCHF:0.10, AUDCAD:0.075 };
const SPREADS    = { EURUSD:1.5,  USDJPY:2.0,   AUDUSD:2.0,  USDCHF:2.5,  AUDCAD:3.0  };
const PIP_SIZES  = { EURUSD:0.0001, USDJPY:0.01, AUDUSD:0.0001, USDCHF:0.0001, AUDCAD:0.0001 };

// ── Parameter sets ─────────────────────────────────────────────────────
const V11 = {
  label: 'v1.1 BEFORE',
  ADX_TREND: 25.0, ADX_RANGE: 20.0,
  PIV_ZONE: 12,
  ATR_SL: 1.5, ATR_TP: 2.5,
  G_LOT:0.01, G_MULT:1.3, G_MAX:5, G_STEP:25, G_TP_PIPS:25,
  T_LOT:0.01, ATR_P:14, EMA_FAST:21, EMA_SLOW:50, CHAN_P:20,
  PYR_MAX:3, PYR_STEP:25, MAX_DD:20.0
};
const V12 = {
  label: 'v1.2 AFTER',
  ADX_TREND: 30.0, ADX_RANGE: 20.0,
  PIV_ZONE: 999,                      // effectively disabled
  ATR_SL: 1.0, ATR_TP: 3.0,
  G_LOT:0.01, G_MULT:1.3, G_MAX:5, G_STEP:25, G_TP_PIPS:25,
  T_LOT:0.01, ATR_P:14, EMA_FAST:21, EMA_SLOW:50, CHAN_P:20,
  PYR_MAX:3, PYR_STEP:25, MAX_DD:20.0
};

// ── Binary reader ──────────────────────────────────────────────────────
function readI64(buf, offset) {
  if (buf.readBigInt64LE) return Number(buf.readBigInt64LE(offset));
  const lo = buf.readUInt32LE(offset), hi = buf.readInt32LE(offset + 4);
  return hi * 0x100000000 + lo;
}
function readHST(filepath) {
  if (!fs.existsSync(filepath)) return null;
  const buf = fs.readFileSync(filepath);
  if (buf.length < 208) return null;
  const bars = [];
  let pos = 148;
  while (pos + 60 <= buf.length) {
    const ctm = readI64(buf, pos);
    bars.push({ t: new Date(ctm * 1000),
      o:buf.readDoubleLE(pos+8), h:buf.readDoubleLE(pos+16),
      l:buf.readDoubleLE(pos+24), c:buf.readDoubleLE(pos+32) });
    pos += 60;
  }
  return bars;
}

// ── Indicators (parameterised) ─────────────────────────────────────────
function buildInd(bars, p) {
  const n=bars.length;
  const adx=new Float64Array(n), ef=new Float64Array(n),
        es=new Float64Array(n),  atr=new Float64Array(n),
        sdp=new Float64Array(n), sdm=new Float64Array(n), str=new Float64Array(n), dx=new Float64Array(n);
  ef[0]=es[0]=bars[0].c;
  const a=1/p.ATR_P, kf=2/(p.EMA_FAST+1), ks=2/(p.EMA_SLOW+1);
  for (let i=1;i<n;i++){
    const b=bars[i], pv=bars[i-1];
    ef[i]=b.c*kf+ef[i-1]*(1-kf); es[i]=b.c*ks+es[i-1]*(1-ks);
    const tr=Math.max(b.h-b.l,Math.abs(b.h-pv.c),Math.abs(b.l-pv.c));
    const um=b.h-pv.h, dm=pv.l-b.l;
    const dp=(um>dm&&um>0)?um:0, dn=(dm>um&&dm>0)?dm:0;
    if(i===1){str[i]=tr;sdp[i]=dp;sdm[i]=dn;atr[i]=tr;}
    else{str[i]=str[i-1]*(1-a)+tr;sdp[i]=sdp[i-1]*(1-a)+dp;sdm[i]=sdm[i-1]*(1-a)+dn;atr[i]=atr[i-1]*(1-a)+tr;}
    const dip=str[i]>0?sdp[i]/str[i]*100:0, dim=str[i]>0?sdm[i]/str[i]*100:0, s=dip+dim;
    dx[i]=s>0?Math.abs(dip-dim)/s*100:0;
    adx[i]=i===1?dx[i]:adx[i-1]*(1-a)+dx[i];
  }
  return {adx,ef,es,atr};
}

// ── Backtest (fully parameterised) ─────────────────────────────────────
function runBacktest(symbol, bars, d1bars, t0, t1, p) {
  const pip    = PIP_SIZES[symbol]  || 0.0001;
  const spread = (SPREADS[symbol]   || 2.0) * pip;
  const tv     = TICK_VALS[symbol]  || 0.10;
  const ind    = buildInd(bars, p);

  let bal=1000, orders=[], closed=[], mode=0;
  let pvDay=null, pvP=0, pvR1=0, pvR2=0, pvS1=0, pvS2=0;
  let peakEq=1000, maxDD=0, nextId=1;

  const ba   = i => [bars[i].c, bars[i].c+spread];
  const eq   = i => { const [bid]=ba(i); let fl=0; for(const o of orders){const pp=o.k==='B'?(bid-o.p)/pip:(o.p-bid)/pip; fl+=pp*tv*o.l*100;} return bal+fl; };
  const ds   = d => d.toISOString().slice(0,10);
  const prevDs = d => { const v=new Date(d); v.setUTCDate(v.getUTCDate()-1); return v.toISOString().slice(0,10); };
  const nL   = x => Math.max(0.01, Math.round(x/0.01)*0.01);
  const cnt  = pfx => orders.filter(x=>x.c.startsWith(pfx)).length;
  const lastP  = pfx => { const os=orders.filter(x=>x.c.startsWith(pfx)); return os.length?os[os.length-1].p:0; };
  const firstP = pfx => { const os=orders.filter(x=>x.c.startsWith(pfx)); return os.length?os[0].p:0; };

  function openO(i, k, l, sl, tp, c) {
    const [bid,ask]=ba(i); orders.push({id:nextId++,k,l,p:k==='B'?ask:bid,sl,tp,c});
  }
  function closeO(o, i, why, cp0) {
    const [bid,ask]=ba(i);
    const cp=cp0!==undefined?cp0:(o.k==='B'?bid:ask);
    const pips=o.k==='B'?(cp-o.p)/pip:(o.p-cp)/pip;
    const pnl=pips*tv*o.l*100;
    bal+=pnl; closed.push({k:o.k,l:o.l,op:o.p,cp,pips,pnl,c:o.c,why});
    orders=orders.filter(x=>x!==o);
  }
  function closeBy(pfx, i, why) { [...orders].filter(x=>x.c.startsWith(pfx)).forEach(o=>closeO(o,i,why)); }

  function chkSLTP(i) {
    const b=bars[i];
    for(const o of [...orders]){
      if(!orders.includes(o))continue;
      if(o.k==='B'){if(o.sl&&b.l<=o.sl)closeO(o,i,'SL',o.sl);else if(o.tp&&b.h>=o.tp)closeO(o,i,'TP',o.tp);}
      else{if(o.sl&&b.h>=o.sl)closeO(o,i,'SL',o.sl);else if(o.tp&&b.l<=o.tp)closeO(o,i,'TP',o.tp);}
    }
  }

  function refPivots(i) {
    const today=ds(bars[i].t); if(today===pvDay)return; pvDay=today;
    const prev=prevDs(bars[i].t);
    const d1p=d1bars.filter(b=>ds(b.t)===prev);
    let ph,pl,pc;
    if(d1p.length){const b=d1p[d1p.length-1];ph=b.h;pl=b.l;pc=b.c;}
    else{const m=bars.slice(0,i).filter(b=>ds(b.t)===prev);if(!m.length)return;
      ph=Math.max(...m.map(b=>b.h));pl=Math.min(...m.map(b=>b.l));pc=m[m.length-1].c;}
    pvP=(ph+pl+pc)/3; pvR1=2*pvP-pl; pvR2=pvP+(ph-pl); pvS1=2*pvP-ph; pvS2=pvP-(ph-pl);
  }

  function nearPiv(price, res) {
    const z=p.PIV_ZONE*pip;
    if(res)return[pvR1,pvR2,pvP].some(x=>Math.abs(price-x)<=z);
    return[pvS1,pvS2,pvP].some(x=>Math.abs(price-x)<=z);
  }

  function detMode(i) {
    if(i<2)return 0;
    const av=ind.adx[i-1], ev=ind.ef[i-1], sv=ind.es[i-1];
    if(av<=p.ADX_RANGE)return 0; if(av>=p.ADX_TREND)return ev>sv?1:-1; return mode;
  }

  function baskTP(i, k, pfx) {
    const [bid,ask]=ba(i); const os=orders.filter(x=>x.c.startsWith(pfx));
    if(!os.length)return;
    let tl=0, tp2=0;
    for(const o of os){const pp=o.k==='B'?(bid-o.p)/pip:(o.p-ask)/pip; tp2+=pp*tv*o.l*100; tl+=o.l;}
    const tgt=tl*p.G_TP_PIPS*tv*100;
    if(tp2>=tgt&&tgt>0)closeBy(pfx,i,'BasketTP');
  }

  function extGrid(i, k, pfx) {
    const lp=lastP(pfx); if(!lp)return;
    const [bid,ask]=ba(i); const cur=k==='B'?bid:ask;
    const chk=k==='B'?(lp-cur)>=p.G_STEP*pip:(cur-lp)>=p.G_STEP*pip;
    if(!chk)return;
    const n2=cnt(pfx); openO(i,k,nL(p.G_LOT*Math.pow(p.G_MULT,n2)),0,0,`${pfx}_L${n2}`);
  }

  function runRange(i) {
    if(i<p.CHAN_P+1)return;
    const cbs=bars.slice(i-p.CHAN_P,i);
    const hi=Math.max(...cbs.map(b=>b.h)), lo=Math.min(...cbs.map(b=>b.l)), rng=hi-lo;
    if(rng<=0)return;
    const cb=bars[i-1].c, ob=bars[i-1].o, bull=cb>ob, bear=cb<ob, pos2=(cb-lo)/rng;
    if(cnt('SP_Grid_Buy')>0)baskTP(i,'B','SP_Grid_Buy');
    if(cnt('SP_Grid_Sell')>0)baskTP(i,'S','SP_Grid_Sell');
    const bc=cnt('SP_Grid_Buy'), sc=cnt('SP_Grid_Sell');
    const other=bc>0||sc>0;
    if(!bc&&!other&&pos2<=0.25&&bull&&nearPiv(cb,false))openO(i,'B',p.G_LOT,0,0,'SP_Grid_Buy_L0');
    if(!sc&&!other&&pos2>=0.75&&bear&&nearPiv(cb,true))openO(i,'S',p.G_LOT,0,0,'SP_Grid_Sell_L0');
    const bc2=cnt('SP_Grid_Buy'), sc2=cnt('SP_Grid_Sell');
    if(bc2>0&&bc2<p.G_MAX)extGrid(i,'B','SP_Grid_Buy');
    if(sc2>0&&sc2<p.G_MAX)extGrid(i,'S','SP_Grid_Sell');
  }

  function tryPyr(i, k, pfx, n2, av) {
    const fp=firstP(pfx); if(!fp)return;
    const [bid,ask]=ba(i); const cur=k==='B'?bid:ask;
    const pp=k==='B'?(cur-fp)/pip:(fp-cur)/pip;
    if(pp<n2*p.PYR_STEP)return;
    const e=k==='B'?ask:bid;
    const sl=k==='B'?+(e-av*p.ATR_SL).toFixed(5):+(e+av*p.ATR_SL).toFixed(5);
    const tp=k==='B'?+(e+av*p.ATR_TP).toFixed(5):+(e-av*p.ATR_TP).toFixed(5);
    openO(i,k,p.T_LOT,sl,tp,`${pfx}_L${n2}`);
  }

  function trail(i, k, av) {
    const [bid,ask]=ba(i), dist=av*p.ATR_SL;
    for(const o of orders){
      if(!o.c.includes('SP_Trend_')||o.k!==k)continue;
      if(k==='B'){const ns=bid-dist;if(ns>o.sl+pip&&ns<bid-pip)o.sl=+ns.toFixed(5);}
      else{const ns=ask+dist;if((!o.sl||ns<o.sl-pip)&&ns>ask+pip)o.sl=+ns.toFixed(5);}
    }
  }

  function runTrend(i) {
    if(i<p.CHAN_P+2)return;
    const bull=mode===1, k=bull?'B':'S', pfx=bull?'SP_Trend_Buy':'SP_Trend_Sell', n2=cnt(pfx);
    const av=ind.atr[i-1]; if(av<=0)return;
    const cbs=bars.slice(i-p.CHAN_P-1,i-1);
    const chH=Math.max(...cbs.map(b=>b.h)), chL=Math.min(...cbs.map(b=>b.l));
    const cb=bars[i-1].c;
    const [bid,ask]=ba(i);
    if(n2===0){
      const bu=bull&&cb>chH, bd=!bull&&cb<chL; if(!bu&&!bd)return;
      const e=bull?ask:bid;
      const sl=bull?+(e-av*p.ATR_SL).toFixed(5):+(e+av*p.ATR_SL).toFixed(5);
      const tp=bull?+(e+av*p.ATR_TP).toFixed(5):+(e-av*p.ATR_TP).toFixed(5);
      openO(i,k,p.T_LOT,sl,tp,`${pfx}_L0`);
    } else {
      if(n2<p.PYR_MAX)tryPyr(i,k,pfx,n2,av);
      trail(i,k,av);
    }
  }

  // Run
  const T0i = bars.findIndex(b=>b.t>=t0);
  let T1i = bars.findIndex(b=>b.t>t1); if(T1i===-1)T1i=bars.length;
  if(T0i===-1)return null;
  const LKB=Math.max(p.ATR_P*4,p.EMA_SLOW,p.CHAN_P)+5;
  for(let i=T0i;i<T1i;i++){
    chkSLTP(i);
    const e=eq(i);
    if(e>peakEq)peakEq=e;
    const dd=(peakEq-e)/peakEq*100; if(dd>maxDD)maxDD=dd;
    if(i-T0i<LKB)continue;
    refPivots(i);
    const pm=mode; mode=detMode(i);
    if(mode!==pm){
      if(mode!==0)closeBy('SP_Grid_',i,'→Trend');
      if(mode===0)closeBy('SP_Trend_',i,'→Range');
    }
    if(bal>0&&(bal-e)/bal*100>=p.MAX_DD){closeBy('SP_Grid_',i,'EmgDD');closeBy('SP_Trend_',i,'EmgDD');continue;}
    if(mode===0)runRange(i); else runTrend(i);
  }
  for(const o of [...orders])closeO(o,T1i-1,'EOT');

  const C=closed, tot=C.length;
  const net=bal-1000;
  const wins=C.filter(x=>x.pnl>0), loss=C.filter(x=>x.pnl<=0);
  const gp=wins.reduce((s,x)=>s+x.pnl,0), gl=loss.reduce((s,x)=>s+x.pnl,0);
  const pf=gl?Math.abs(gp/gl):Infinity;
  const winR=tot?wins.length/tot*100:0;
  const gridTrades=C.filter(x=>x.c.startsWith('SP_Grid')).length;
  const trendTrades=C.filter(x=>x.c.startsWith('SP_Trend')).length;
  const df=bars[T0i].t, dt=bars[Math.min(T1i-1,bars.length-1)].t;
  return {sym:symbol,tot,wins:wins.length,loss:loss.length,winR,net,bal,pf,dd:maxDD,gp,gl,gridTrades,trendTrades,from:df,to:dt};
}

// ── Load data ──────────────────────────────────────────────────────────
const T0 = new Date('2024-06-01T00:00:00Z');
const T1 = new Date('2024-10-31T23:59:59Z');

function loadBars(sym) {
  const h1path = fs.existsSync(path.join(HIST,`${sym}.m60.hst`))
    ? path.join(HIST,`${sym}.m60.hst`)
    : path.join(HIST,`${sym}.view60.hst`);
  const d1path = path.join(HIST,`${sym}.m1440.hst`);
  if(!fs.existsSync(h1path))return null;
  const bars = readHST(h1path);
  const d1   = fs.existsSync(d1path) ? readHST(d1path)||[] : [];
  return {bars, d1};
}

// ── Print comparison table ─────────────────────────────────────────────
const W = 125;
const HR = '─'.repeat(W);
console.log('\n' + '═'.repeat(W));
console.log('  SAVIOURPLUS EA  —  BEFORE / AFTER PARAMETER FIX COMPARISON  |  H1  |  Jun–Oct 2024  |  $1,000 start');
console.log('  Changes: ADX_Trend 25→30 | Pivot_Zone 12→999 (disabled) | ATR_SL 1.5→1.0 | ATR_TP 2.5→3.0');
console.log('═'.repeat(W));

const hdr = '  Pair    Version       Trades  Wins  Loss  WR%   Net P&L    Balance    PF     MaxDD%  Grid  Trend  AvgW    AvgL';
console.log(hdr);
console.log(HR);

const summary = { before:{net:0,trades:0,wins:0,loss:0,pf:[],dd:[]}, after:{net:0,trades:0,wins:0,loss:0,pf:[],dd:[]} };

for (const sym of PAIRS) {
  const data = loadBars(sym);
  if (!data) { console.log(`  ${sym.padEnd(8)} *** NO DATA ***`); continue; }
  const { bars, d1 } = data;

  const r1 = runBacktest(sym, bars, d1, T0, T1, V11);
  const r2 = runBacktest(sym, bars, d1, T0, T1, V12);

  function fmtRow(r, ver) {
    if(!r)return`  ${sym.padEnd(8)} ${ver.padEnd(14)} NO RESULT`;
    const net=(r.net>=0?'+':'')+r.net.toFixed(2);
    const pf=isFinite(r.pf)?r.pf.toFixed(2):'  ∞';
    const avgW=r.wins?r.gp/r.wins:0, avgL=r.loss?r.gl/r.loss:0;
    return [
      `  ${sym.padEnd(8)}`,
      ver.padEnd(14),
      String(r.tot).padStart(6),
      String(r.wins).padStart(5),
      String(r.loss).padStart(5),
      r.winR.toFixed(0).padStart(5)+'%',
      net.padStart(10),
      r.bal.toFixed(2).padStart(10),
      pf.padStart(6),
      r.dd.toFixed(1).padStart(8)+'%',
      String(r.gridTrades).padStart(5),
      String(r.trendTrades).padStart(6),
      avgW.toFixed(2).padStart(7),
      avgL.toFixed(2).padStart(7),
    ].join('  ');
  }

  console.log(fmtRow(r1,'v1.1 BEFORE'));
  console.log(fmtRow(r2,'v1.2 AFTER '));
  console.log(HR);

  if(r1){summary.before.net+=r1.net;summary.before.trades+=r1.tot;summary.before.wins+=r1.wins;summary.before.loss+=r1.loss;if(isFinite(r1.pf))summary.before.pf.push(r1.pf);summary.before.dd.push(r1.dd);}
  if(r2){summary.after.net+=r2.net;summary.after.trades+=r2.tot;summary.after.wins+=r2.wins;summary.after.loss+=r2.loss;if(isFinite(r2.pf))summary.after.pf.push(r2.pf);summary.after.dd.push(r2.dd);}
}

function avg(arr){return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;}
console.log('\n  ── PORTFOLIO SUMMARY ─────────────────────────────────────');
console.log('  Metric              v1.1 BEFORE      v1.2 AFTER       Delta');
console.log('  ' + '─'.repeat(60));
const b=summary.before, a=summary.after;
const netDelta=(a.net-b.net); const netDeltaStr=(netDelta>=0?'+':'')+netDelta.toFixed(2);
const bWR=b.trades?(b.wins/b.trades*100):0, aWR=a.trades?(a.wins/a.trades*100):0;
console.log(`  Total Net P&L       ${('$'+(b.net>=0?'+':'')+b.net.toFixed(2)).padEnd(17)}${('$'+(a.net>=0?'+':'')+a.net.toFixed(2)).padEnd(17)}${('$'+netDeltaStr)}`);
console.log(`  Total Trades        ${String(b.trades).padEnd(17)}${String(a.trades).padEnd(17)}`);
console.log(`  Win Rate            ${(bWR.toFixed(1)+'%').padEnd(17)}${(aWR.toFixed(1)+'%').padEnd(17)}`);
console.log(`  Avg Profit Factor   ${avg(b.pf).toFixed(2).padEnd(17)}${avg(a.pf).toFixed(2).padEnd(17)}`);
console.log(`  Avg Max Drawdown    ${(avg(b.dd).toFixed(1)+'%').padEnd(17)}${(avg(a.dd).toFixed(1)+'%').padEnd(17)}`);
console.log('');
