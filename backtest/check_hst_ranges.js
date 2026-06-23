'use strict';
const fs = require('fs'), path = require('path');
const DIR = String.raw`C:\Users\hp\AppData\Roaming\MetaQuotes\Terminal\DC7D4808E49DA56212633C305FFB64D2\history\JustMarkets-Live4`;

function readHSTInfo(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length < 208) return null;
    const sym = buf.slice(68,80).toString('ascii').replace(/\0/g,'');
    const per = buf.readInt32LE(80);
    const bars = (buf.length - 148) / 60;
    function ts(pos) {
      const lo=buf.readUInt32LE(pos), hi=buf.readInt32LE(pos+4);
      return new Date((hi*0x100000000+lo)*1000);
    }
    const first = ts(148);
    const last  = ts(148 + Math.floor(bars-1)*60);
    return { sym, per, bars: Math.floor(bars), first, last };
  } catch(e) { return null; }
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.m15.hst') || f.endsWith('.m60.hst') || f.endsWith('.m1440.hst'));
files.sort();
console.log('File'.padEnd(26) + 'Bars'.padStart(6) + '  From'.padEnd(14) + '  To');
console.log('-'.repeat(70));
for (const f of files) {
  const info = readHSTInfo(path.join(DIR, f));
  if (!info) continue;
  const from = info.first.toISOString().slice(0,10);
  const to   = info.last .toISOString().slice(0,10);
  console.log(f.padEnd(26) + String(info.bars).padStart(6) + '  ' + from + '  ' + to);
}
