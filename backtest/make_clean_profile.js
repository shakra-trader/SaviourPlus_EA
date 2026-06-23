// Generate clean MT4 chart .chr files for a set of symbols
'use strict';
const fs   = require('fs');
const path = require('path');

const PROFILE_DIR = 'C:\\Users\\hp\\AppData\\Roaming\\MetaQuotes\\Terminal\\DC7D4808E49DA56212633C305FFB64D2\\profiles\\SaviourPlus_Clean';

// Charts: symbol, period (minutes), position in tiled layout
const CHARTS = [
  { sym: 'EURUSD', period: 15,   left: 0,   top: 0,   right: 640, bottom: 380 },
  { sym: 'USDJPY', period: 15,   left: 641, top: 0,   right: 1280,bottom: 380 },
  { sym: 'AUDUSD', period: 15,   left: 0,   top: 381, right: 426, bottom: 710 },
  { sym: 'USDCHF', period: 15,   left: 427, top: 381, right: 853, bottom: 710 },
  { sym: 'AUDCAD', period: 15,   left: 854, top: 381, right: 1280,bottom: 710 },
];

// Clean chart template (no indicators, no objects — pure candlestick)
function makeChart(sym, period, left, top, right, bottom, idx) {
  const id = 133734622359234597 + idx;
  // For suffix-ed symbols like EURUSD.m in JustMarkets
  const symWithSuffix = sym + '.m';
  return `<chart>
id=${id}
symbol=${symWithSuffix}
period=${period}
leftpos=500
digits=5
scale=8
graph=1
fore=0
grid=1
volume=0
scroll=1
shift=1
ohlc=1
one_click=0
one_click_btn=1
askline=1
days=0
descriptions=1
shift_size=20
fixed_pos=0
window_left=${left}
window_top=${top}
window_right=${right}
window_bottom=${bottom}
window_type=1
background_color=0
foreground_color=16777215
barup_color=65280
bardown_color=16711680
bullcandle_color=0
bearcandle_color=16711680
chartline_color=65280
volumes_color=3329330
grid_color=10061943
askline_color=255
stops_color=255

<window>
height=100
fixed_height=0
<indicator>
name=main
</indicator>
</window>
</chart>
`;
}

// Write chart files
CHARTS.forEach((c, i) => {
  const content = makeChart(c.sym, c.period, c.left, c.top, c.right, c.bottom, i+1);
  const filename = path.join(PROFILE_DIR, `chart0${i+1}.chr`);
  fs.writeFileSync(filename, content, 'utf8');
  console.log(`Written: chart0${i+1}.chr  (${c.sym} M${c.period})`);
});

// Write order.wnd (empty orders panel)
const orderWnd = `<orders>
</orders>
`;
fs.writeFileSync(path.join(PROFILE_DIR, 'order.wnd'), orderWnd, 'utf8');

console.log('\nClean profile created with 5 charts:');
CHARTS.forEach(c => console.log(`  ${c.sym} M${c.period}`));
