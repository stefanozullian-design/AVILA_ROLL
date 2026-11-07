// ═══════════════════════════════════════════════════════
// LOCAL-TIME DATE FORMATTER
// The app works in LOCAL time: calendar dates the user enters (campaign
// from/to, non-working days, simulation start) are matched and displayed
// using local date components. Using toISOString() (UTC) shifted dates by a
// day in timezones east of UTC, so campaign/product edits landed on the wrong
// day. _ymd() returns local YYYY-MM-DD and replaces toISOString().split('T')[0].
// ═══════════════════════════════════════════════════════
Date.prototype._ymd=function(){
  if(isNaN(this.getTime())) return '';
  const y=this.getFullYear(), m=String(this.getMonth()+1).padStart(2,'0'), d=String(this.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
};

// ═══════════════════════════════════════════════════════
// COLOUR THEMES
// Palettes the user picks from the ◐ menu in the top bar; remembered per browser
// (localStorage 'avila_theme'), never stored in a scenario. A theme is only a set of
// CSS variables (the html[data-theme] blocks in <style>), so page markup must say
// var(--x) — never a hex — for a colour to follow the theme.
// Canvases and Chart.js cannot read CSS variables: every colour handed to them goes
// through _tc(), which returns the active theme's version of an Original colour.
// ═══════════════════════════════════════════════════════
const THEMES=[
  {id:'original', name:'Original', note:'Dark with neon accents — the classic look',                 sw:['#080b10','#00ff9d','#ffb830','#4da6ff']},
  {id:'daylight', name:'Daylight', note:'Light background and dark text — best for screen sharing and projectors', sw:['#ffffff','#047857','#b45309','#1d64c9']},
  {id:'slate',    name:'Slate',    note:'Softer dark grey with calmer colours',                      sw:['#1b2028','#3fdc9c','#f4b650','#6aaefc']},
];
const THEME_KEY='avila_theme', THEME_CUSTOM_KEY='avila_theme_custom';
// _thCur = the menu choice ('original'|'daylight'|'slate'|'custom'); _thBase = the preset whose
// secondary colours are in force (for Custom: the preset the palette was started from).
let _thCur='original', _thBase='original';
(()=>{
  const el=document.documentElement, dt=el.getAttribute('data-theme');
  if(el.hasAttribute('data-custom')){ _thCur='custom'; _thBase=(dt&&dt!=='custom')?dt:'original'; }
  else { _thCur=dt||'original'; _thBase=_thCur; }
  if(!THEMES.some(t=>t.id===_thBase)){ _thCur=_thBase='original'; el.removeAttribute('data-theme'); el.removeAttribute('data-custom'); }
})();
document.addEventListener('DOMContentLoaded',()=>_thSyncButton());
// Header logo version for the current theme — see the #logo CSS. Re-checked whenever the theme
// changes (data-theme / custom colours are set on <html>).
function _logoSync(){
  const lg=document.getElementById('logo'), tb=document.getElementById('topbar'); if(!lg||!tb) return;
  const m=(getComputedStyle(tb).backgroundColor||'').match(/[\d.]+/g); if(!m||m.length<3) return;
  if(m.length>3&&Number(m[3])===0) return;   // transparent: keep the CSS default
  const lum=(0.2126*m[0]+0.7152*m[1]+0.0722*m[2])/255;
  lg.setAttribute('data-logo', lum>0.5?'light':'dark');
}
document.addEventListener('DOMContentLoaded',()=>{ _logoSync(); new MutationObserver(_logoSync).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','style','data-custom']}); });
// Original-palette colour → the CSS variable that carries it in every theme.
const _TC_HEX={
  '#00ff9d':'green','#00cc7a':'green-dim','#ffb830':'amber','#ff3d5a':'red','#4da6ff':'blue','#4a5568':'grey',
  '#e2eaf8':'text','#8e9ab8':'text-dim','#f4f7ff':'text-bright','#22d3ee':'plan','#f0f4f8':'total','#d4dce8':'total-dim',
  '#ff9d42':'simulated-dim','#080b10':'bg','#0d1117':'surface','#131820':'surface2','#1a2030':'surface3',
  '#1e2738':'border','#2a3550':'border2','#00d9a3':'teal','#a78bfa':'violet','#ff8c42':'orange','#4ade80':'lime',
  '#cc7aff':'magenta','#b388ff':'purple','#ff4dd2':'fuchsia','#38bdf8':'sky','#f472b6':'pink','#3b82f6':'royal',
  '#ff9433':'tangerine','#ff9d5c':'peach','#f5c542':'yellow','#4dd0e1':'cyan','#3987e5':'cobalt','#00d68f':'mint',
  '#e66767':'coral','#93a0bc':'mist','#e6ecf7':'ink','#d5dcea':'text-leaf','#ffd700':'gold','#66738f':'axis',
  '#6b7a96':'axis2','#232b3b':'d2-idle','#41527a':'d2-maint','#161c28':'d2-none',
};
const _TC_RGB={
  '255,255,255':'hi','0,255,157':'green','255,184,48':'amber','255,61,90':'red','77,166,255':'blue','34,211,238':'plan',
  '0,217,163':'teal','167,139,250':'violet','255,140,66':'orange','74,222,128':'lime','204,122,255':'magenta',
  '179,136,255':'purple','56,189,248':'sky','244,114,182':'pink','230,236,247':'ink','230,103,103':'coral',
};
// Chart-only colours with no CSS variable: explicit per-theme replacements (Daylight
// needs them darker to read on white; Slate keeps the Original ones).
const _TC_X={
  daylight:{
    '#34d399':'#059669','#60a5fa':'#2563eb','#fb923c':'#ea580c','#fbbf24':'#d97706','#f87171':'#dc2626',
    '#ff5078':'#e11d48','#50d2b4':'#0d9488','#8cb4ff':'#5470c6','#ffdc3c':'#b58a00','#64c864':'#2f9e44',
    '#c864a0':'#a3367a','#3cb4dc':'#1b87b0','#d95926':'#c24a1a','#199e70':'#0f7a55','#c98500':'#a86b00',
    '#d55181':'#b83468','#008300':'#007a00','#9085e9':'#6b5fd6','#5aaeff':'#1f78d1',
    '#7fd4ff':'#0369a1','#c9a0e8':'#7c3aed','#ff8c1a':'#c2410c','#00e58d':'#047857','#ff6b8a':'#be123c',
  },
};
const _TC_XRGB={
  daylight:{
    '10,14,26':'254,254,254','0,200,120':'5,150,105','255,140,50':'217,119,6','255,80,120':'225,29,72',
    '142,154,184':'100,112,135','0,229,160':'4,150,105','100,150,100':'70,110,70','80,210,180':'13,148,136',
    '140,180,255':'84,112,198','255,220,60':'181,138,0','100,200,100':'47,158,68','200,100,160':'163,54,122',
    '60,180,220':'27,135,176','52,211,153':'5,150,105','96,165,250':'37,99,235','251,146,60':'234,88,12',
    '251,191,36':'217,119,6','248,113,113':'220,38,38','120,120,140':'110,110,130','150,150,170':'121,121,141',
    '32,227,192':'15,118,110','255,140,26':'194,65,12','255,200,0':'161,98,7','100,180,200':'14,116,144',
    '100,200,200':'13,148,136','200,150,100':'180,83,9','200,180,100':'161,98,7','100,150,200':'29,100,201','200,200,100':'133,120,20',
  },
};
let _tcCache={}, _tcCacheFor=null;
function _tcVar(name){
  if(_tcCacheFor!==_thCur){ _tcCache={}; _tcCacheFor=_thCur; }
  let v=_tcCache[name];
  if(v===undefined){ v=getComputedStyle(document.documentElement).getPropertyValue('--'+name).trim(); _tcCache[name]=v; }
  return v;
}
// Active theme's version of a colour: '#hex', 'rgb(a)(r,g,b[,a])', 'var(--x)' or
// 'rgba(var(--x-rgb),a)'. Plain colours come back unchanged in Original; var() forms
// are always resolved (a canvas can't use them). Idempotent: themed output maps to itself.
function _tc(c){
  if(typeof c!=='string'||!c) return c;
  let m;
  if(c.indexOf('var(')>=0){
    if((m=/^var\(--([a-z0-9-]+)\)$/i.exec(c))) return _tcVar(m[1])||c;
    if((m=/^rgba?\(\s*var\(--([a-z0-9-]+)\)\s*,\s*([\d.]+)\s*\)$/i.exec(c))) return `rgba(${_tcVar(m[1])},${m[2]})`;
    return c;
  }
  if(_thCur==='original') return c;
  const lc=c.toLowerCase();
  if(lc.charCodeAt(0)===35){ // '#'
    const nm=_TC_HEX[lc]; if(nm) return _tcVar(nm)||c;
    return (_TC_X[_thBase]&&_TC_X[_thBase][lc])||c;
  }
  if((m=/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(lc))){
    const key=m[1]+','+m[2]+','+m[3], a=m[4]!=null?m[4]:'1';
    const nm=_TC_RGB[key]; if(nm) return `rgba(${_tcVar(nm+'-rgb')},${a})`;
    const x=_TC_XRGB[_thBase]&&_TC_XRGB[_thBase][key]; if(x) return `rgba(${x},${a})`;
  }
  return c;
}
// A look rule of the active theme: its --rule-<k> variable ('' = the Original behaviour).
function _thRule(k){ return _tcVar('rule-'+k)||''; }
// Inventory-chart bar colour: lighter on forecast days when the theme asks for it.
function _thChartCol(c,isForecast){ return (isForecast&&_thRule('chart')==='lighter')?`color-mix(in srgb,${c} var(--chart-fc-keep,50%),var(--surface))`:c; }
// r,g,b of the theme's panel surface — the "dark half" of a hatched forecast bar mixes toward it.
function _tcSurfaceRGB(){
  const m=/^#([0-9a-f]{6})$/i.exec(_tcVar('surface')||''); if(!m) return [13,17,23];
  const n=parseInt(m[1],16); return [(n>>16)&255,(n>>8)&255,n&255];
}
function setTheme(id){
  if(id!=='custom'&&!THEMES.some(t=>t.id===id)) id='original';
  thCloseMenu();
  if(id===_thCur&&id!=='custom') return;
  if(id==='custom'){
    const c=_thCustomLoad(); if(!c){ thOpenEditor(); return; }   // nothing saved yet → build one
    _thApplyVars(c.base,c.vars,c.look);
  } else {
    _thClearVars(); _thBase=id;
    if(id==='original') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme',id);
  }
  _thCur=id;
  try{ localStorage.setItem(THEME_KEY,id); }catch(e){}
  _tcCacheFor=null;
  _thSyncButton();
  _thRedraw();
}
// Colours written as var(--x) switch on their own; charts, canvases and the few colours
// computed in JS (product colours, dashboard palettes) are baked in when a view draws,
// so redraw whatever is on screen.
function _thRedraw(){
  try{
    if(typeof S==='undefined'||!S.view) return;
    const pan=document.querySelector('.view-panel.active');
    const keep=pan?[pan,...pan.querySelectorAll('[id]')].filter(e=>e.id&&(e.scrollTop||e.scrollLeft)).map(e=>[e.id,e.scrollTop,e.scrollLeft]):[];
    if(S.view==='cfgpanel'){
      const tab=document.querySelector('#second-row .sec-tab.active')?.dataset.tab||'settings';
      switchView('cfgpanel'); renderCfgPanel(tab);
    } else switchView(S.view);
    keep.forEach(([id,t,l])=>{ const e=document.getElementById(id); if(e){ e.scrollTop=t; e.scrollLeft=l; } });
  }catch(e){ console.error('Theme redraw failed',e); }
}
function _thSyncButton(){
  const name=_thCur==='custom'?'Custom':(THEMES.find(x=>x.id===_thCur)||THEMES[0]).name;
  const b=document.getElementById('th-btn'); if(b) b.title=`Colour theme: ${name} — click to switch palette`;
}
function thToggleMenu(ev){
  if(ev) ev.stopPropagation();
  const menu=document.getElementById('th-menu'); if(!menu) return;
  if(menu.style.display!=='none'){ thCloseMenu(); return; }
  const sw=(bg,dots)=>`<span class="th-sw" style="background:${bg}">${dots.map(c=>`<i style="background:${c}"></i>`).join('')}</span>`;
  const cu=_thCustomLoad();
  menu.innerHTML=`<div class="th-hdr">Colour theme</div>`+THEMES.map(t=>`
    <div class="th-opt${t.id===_thCur?' on':''}" onclick="setTheme('${t.id}')">
      ${sw(t.sw[0],t.sw.slice(1))}
      <span class="th-txt"><b>${t.name}</b><small>${t.note}</small></span>
      <span class="th-chk">${t.id===_thCur?'✓':''}</span>
    </div>`).join('')+`
    <div class="th-opt${_thCur==='custom'?' on':''}" onclick="setTheme('custom')">
      ${cu?sw(cu.picks.bg,[cu.picks.green,cu.picks.amber,cu.picks.blue]):'<span class="th-sw th-sw-new">+</span>'}
      <span class="th-txt"><b>Custom</b><small>${cu?'Your own colours':'Pick your own colours'}</small></span>
      <span class="th-edit" onclick="event.stopPropagation();thOpenEditor()" title="Choose the colours of your custom palette">✎ Edit</span>
      <span class="th-chk">${_thCur==='custom'?'✓':''}</span>
    </div>`+`<div class="th-foot">Saved in this browser only — your scenarios are not changed.</div>`;
  menu.style.transform='translateX(-50%)';
  menu.style.display='block';
  // keep the menu on screen when the button sits near a window edge
  const r=menu.getBoundingClientRect(), shift=Math.max(0,r.right-(window.innerWidth-8))-Math.max(0,8-r.left);
  if(shift) menu.style.transform=`translateX(calc(-50% - ${shift}px))`;
}
// ── CUSTOM PALETTE ──────────────────────────────────────────────────────────────────
// The user's own palette = the preset it starts from (which supplies the many secondary chart
// colours) + eleven picked colours; every other variable is derived from those (tints, borders,
// banners, hatches, light-vs-dark details). Saved as {base,picks,vars} in localStorage
// 'avila_theme_custom'; `vars` is the complete set, applied inline on <html> so the <head>
// script can paint it before the page draws. --tbl-zoom (also inline on <html>) is never touched.
const TH_PICKS=[
  {key:'bg',      v:'--bg',       g:'Backgrounds', n:'Page background'},
  {key:'surface', v:'--surface',  g:'Backgrounds', n:'Panels & tables'},
  {key:'surface2',v:'--surface2', g:'Backgrounds', n:'Headers & toolbars'},
  {key:'border',  v:'--border2',  g:'Backgrounds', n:'Borders & grid lines'},
  {key:'text',    v:'--text',     g:'Text',        n:'Main text',              min:4.5},
  {key:'textDim', v:'--text-dim', g:'Text',        n:'Secondary text',         min:4.5},
  {key:'green',   v:'--green',    g:'Data colours',n:'Actual / real data',     min:3},
  {key:'amber',   v:'--amber',    g:'Data colours',n:'Forecast / simulated',   min:3},
  {key:'plan',    v:'--plan',     g:'Data colours',n:'Planned / campaigns',    min:3},
  {key:'red',     v:'--red',      g:'Data colours',n:'Alerts / shortfalls',    min:3},
  {key:'blue',    v:'--blue',     g:'Data colours',n:'Info / capacity / links',min:3},
];
const _cx={
  rgb:h=>{ const m=/^#?([0-9a-f]{6})$/i.exec(h||''); if(!m) return [0,0,0]; const n=parseInt(m[1],16); return [(n>>16)&255,(n>>8)&255,n&255]; },
  hex:a=>'#'+a.map(x=>Math.round(Math.max(0,Math.min(255,x))).toString(16).padStart(2,'0')).join(''),
  mix:(a,b,t)=>{ const x=_cx.rgb(a), y=_cx.rgb(b); return _cx.hex(x.map((v,i)=>v+(y[i]-v)*t)); },   // t=0 → a, t=1 → b
  lum:h=>{ const f=c=>{ c/=255; return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4); }; const [r,g,b]=_cx.rgb(h); return .2126*f(r)+.7152*f(g)+.0722*f(b); },
  cr:(a,b)=>{ const x=_cx.lum(a), y=_cx.lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); },
  trip:h=>_cx.rgb(h).join(','),
};
function _thHex(v){ v=String(v||'').trim().toLowerCase(); const m=/^#([0-9a-f]{3})$/.exec(v); return m?'#'+m[1].split('').map(x=>x+x).join(''):v; }
function _thCustomLoad(){
  try{ const c=JSON.parse(localStorage.getItem(THEME_CUSTOM_KEY)||'null'); return (c&&c.vars&&c.picks&&THEMES.some(t=>t.id===c.base))?c:null; }catch(e){ return null; }
}
let _thVarKeys=null;
function _thClearVars(){
  const el=document.documentElement;
  const keys=_thVarKeys||[...el.style].filter(k=>(k.startsWith('--')&&k!=='--tbl-zoom')||k==='color-scheme');
  keys.forEach(k=>el.style.removeProperty(k)); _thVarKeys=null;
  el.removeAttribute('data-custom'); el.removeAttribute('data-look');
}
function _thApplyVars(base,vars,look){
  const el=document.documentElement;
  _thClearVars();
  if(look) el.setAttribute('data-look',look.mode==='source'?'on':'off');
  el.setAttribute('data-theme',base==='original'?'custom':base);  // a base preset's CSS block + the inline picks on top
  el.setAttribute('data-custom','1');
  for(const k in vars) el.style.setProperty(k,vars[k]);
  _thVarKeys=Object.keys(vars); _thBase=base; _tcCacheFor=null;
}
// The eleven picked colours of a preset, read from its CSS block (switched on for an instant, no paint).
function _thBaseValues(base){
  const el=document.documentElement, dt=el.getAttribute('data-theme'), inl={};
  [...el.style].filter(k=>(k.startsWith('--')&&k!=='--tbl-zoom')||k==='color-scheme').forEach(k=>{ inl[k]=el.style.getPropertyValue(k); el.style.removeProperty(k); });
  if(base==='original') el.removeAttribute('data-theme'); else el.setAttribute('data-theme',base);
  const cs=getComputedStyle(el), out={};
  TH_PICKS.forEach(x=>{ out[x.key]=_thHex(cs.getPropertyValue(x.v)); });
  if(dt) el.setAttribute('data-theme',dt); else el.removeAttribute('data-theme');
  for(const k in inl) el.style.setProperty(k,inl[k]);
  return out;
}
// Picks → the full variable set. Only the preset's secondary accents are left to the base.
function _thDerive(p){
  const light=_cx.lum(p.bg)>0.4, v={};
  const on=c=>_cx.lum(c)>0.35?'#0b1220':'#ffffff';         // text that reads on a solid button of colour c
  const tint=(c,a)=>`rgba(${_cx.trip(c)},${a})`;
  v['color-scheme']=light?'light':'dark';
  v['--bg']=p.bg; v['--surface']=p.surface; v['--surface2']=p.surface2; v['--surface3']=_cx.mix(p.surface2,p.text,.06);
  v['--border2']=p.border; v['--border']=_cx.mix(p.border,p.surface,.45); v['--rule']=p.border; v['--tip-rule']=v['--border'];
  const bright=_cx.mix(p.text,light?'#000000':'#ffffff',.5);
  v['--text']=p.text; v['--text-dim']=p.textDim; v['--text-bright']=bright; v['--max-ink']=bright;
  v['--total']=bright; v['--total-dim']=_cx.mix(p.text,p.surface,.18); v['--total-rgb']=_cx.trip(bright); v['--total-faint']=tint(p.text,.05);
  v['--ink']=p.text; v['--ink-rgb']=_cx.trip(p.text); v['--text-leaf']=_cx.mix(p.text,p.surface,.12);
  v['--mist']=p.textDim; v['--axis']=p.textDim; v['--axis2']=p.textDim;
  v['--grey']=_cx.mix(p.textDim,p.surface,.35); v['--past-th-text']=_cx.mix(p.textDim,p.surface,.25);
  v['--green']=v['--real']=p.green; v['--amber']=v['--simulated']=p.amber; v['--plan']=p.plan; v['--red']=v['--red2']=p.red; v['--blue']=p.blue;
  ['green','amber','plan','red','blue'].forEach(k=>{ v[`--${k}-rgb`]=_cx.trip(p[k]); });
  v['--green-dim']=v['--real-dim']=_cx.mix(p.green,p.bg,.2); v['--green-faint']=v['--real-faint']=tint(p.green,.06);
  v['--simulated-dim']=_cx.mix(p.amber,p.bg,.2); v['--simulated-faint']=tint(p.amber,.06); v['--plan-faint']=tint(p.plan,.08);
  v['--on-green']=on(p.green); v['--on-blue']=on(p.blue); v['--on-red']=on(p.red);
  v['--hi-rgb']=light?'15,23,42':'255,255,255';
  v['--past-shade']=light?'rgba(15,23,42,.045)':'rgba(0,0,0,.22)'; v['--chip-on']=light?'rgba(15,23,42,.07)':'rgba(0,0,0,.3)';
  v['--zero-k']=light?'1.6':'1';
  v['--bar-lbl']=light?'#0b1220':'#eef2ff'; v['--bar-lbl-down']=light?'#1b2433':'#ffffff'; v['--bar-lbl-halo']=light?'#ffffff':'#000000';
  v['--tot-row']=_cx.mix(p.surface,p.blue,.10); v['--tot-sticky']=_cx.mix(p.surface,p.blue,.15);
  v['--tot-mon']=_cx.mix(p.surface,p.blue,.13); v['--tot-day']=_cx.mix(p.surface,p.blue,.08);
  v['--sel-sticky']=_cx.mix(p.surface,p.amber,.15); v['--wkend-th']=_cx.mix(p.surface2,p.red,.08);
  v['--rd-hdr']=p.surface2; v['--rd-hdr-hover']=v['--surface3']; v['--rd-sub']=_cx.mix(p.surface,p.bg,.5); v['--rd-row']=p.surface;
  v['--d2-idle']=_cx.mix(p.surface,p.text,.1); v['--d2-maint']=_cx.mix(p.surface,p.blue,.3); v['--d2-none']=_cx.mix(p.surface,p.bg,.5);
  [['info','blue'],['err','red'],['ok','green'],['warn','amber'],['ok2','green']].forEach(([b,k])=>{ v[`--bn-${b}-bg`]=_cx.mix(p.surface,p[k],.16); v[`--bn-${b}-fg`]=p.text; });
  v['--bn-err-fg2']=p.red;
  v['--h-maint-a']=_cx.mix(p.surface,p.textDim,.55); v['--h-maint-b']=_cx.mix(p.surface,p.textDim,.2);
  v['--h-starved-b']=_cx.mix(p.surface,p.red,.6); v['--h-blocked-a']=_cx.mix(p.surface,p.amber,.25); v['--h-blocked-b']=_cx.mix(p.surface,p.amber,.75);
  v['--h-repair-a']=_cx.mix(p.surface,p.red,.3); v['--h-repair-b']=_cx.mix(p.surface,p.red,.95);
  v['--h-pm-a']=_cx.mix(p.surface,p.green,.25); v['--h-pm-b']=_cx.mix(p.surface,p.green,.85);
  v['--h-inv-a']=_cx.mix(p.surface,p.amber,.3); v['--h-inv-b']=_cx.mix(p.surface,p.amber,1); v['--h-red-dk']=_cx.mix(p.red,p.surface,.75);
  return v;
}
// ── Real-vs-forecast look (Supply page) — the colour-trial controls, part of a custom palette ──
// L = {mode:'source'|'material', rText,rBold,rBg,rAmt, fText,fItal,fBg,fAmt, gText,gItal,
//      bReal:'deep'|'base'|'one', bFc:'light'|'striped'|'same', bAmt, chart, down:'grey'|'colour',
//      pastCol:'header'|'column', wk:'lines'|'fill'}; a background is a hex, 'same' (= its text) or 'none'.
const TH_LOOK_SW={
  real:[['Blue','#1d64c9'],['Navy','#1e3a8a'],['Green','#047857'],['Teal','#0f766e'],['Purple','#6d28d9'],['Black','#111a28']],
  fc:[['Light grey','#8a94a6'],['Soft grey','#566176'],['Dark grey','#3f4858'],['Black','#1b2433'],['Amber','#b45309'],['Purple','#7c3aed']],
  gap:[['Light grey','#8a94a6'],['Amber','#b45309'],['Red','#c81e3a']],
  bg:[['Blue','#1d64c9'],['Green','#047857'],['Grey','#566176'],['Yellow','#eab308']],
};
const TH_LOOK_AMT=[['Faint',.05],['Light',.08],['Medium',.14],['Strong',.22]];
function _thRgbaSplit(v){   // 'rgba(4,120,87,.14)' → ['#047857',.14]; a hex → [hex,1]; none → null
  v=String(v||'').trim(); if(!v||v==='transparent'||v==='none') return null;
  const m=/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if(m) return +m[4]===0?null:[_cx.hex([+m[1],+m[2],+m[3]]),m[4]!=null?+m[4]:1];
  const h=_thHex(v); return /^#[0-9a-f]{6}$/.test(h)?[h,1]:null;
}
function _thNearAmt(a){ return TH_LOOK_AMT.reduce((b,x)=>Math.abs(x[1]-a)<Math.abs(b-a)?x[1]:b,TH_LOOK_AMT[0][1]); }
// The look a preset stands for, read from its CSS block (switched on for an instant, no paint).
function _thBaseLook(base){
  const el=document.documentElement, dt=el.getAttribute('data-theme'), dl=el.getAttribute('data-look'), inl={};
  [...el.style].filter(k=>(k.startsWith('--')&&k!=='--tbl-zoom')||k==='color-scheme').forEach(k=>{ inl[k]=el.style.getPropertyValue(k); el.style.removeProperty(k); });
  el.removeAttribute('data-look');
  if(base==='original') el.removeAttribute('data-theme'); else el.setAttribute('data-theme',base);
  const cs=getComputedStyle(el), g=k=>cs.getPropertyValue(k).trim();
  const src=g('--rule-num')==='source';
  const rText=_thHex(g('--real')), fText=_thHex(src?g('--fc-num'):g('--text-dim')), sim=_thHex(g('--simulated'));
  const rb=_thRgbaSplit(g('--real-faint')), fb=src?_thRgbaSplit(g('--fc-faint')):null;
  const L={ mode:src?'source':'material',
    rText, rBold:!src, rBg:rb?(rb[0]===rText?'same':rb[0]):'none', rAmt:rb?_thNearAmt(rb[1]):.08,
    fText, fItal:false, fBg:fb?(fb[0]===fText?'same':fb[0]):'none', fAmt:fb?_thNearAmt(fb[1]):.08,
    gText:src&&sim===fText?'fc':sim, gItal:!(src&&base==='daylight'),
    bReal:g('--rule-prod')==='deep'?'deep':'base', bFc:g('--rule-bars')==='light'?'light':'striped',
    bAmt:parseInt(g('--fc-bar-pct'))||45, chart:g('--rule-chart')==='lighter'?50:0, down:g('--rule-down')==='grey'?'grey':'colour',
    pastCol:g('--past-shade-td')==='transparent'?'header':'column', wk:g('--wkend-td')==='transparent'?'lines':'fill' };
  if(dt) el.setAttribute('data-theme',dt); else el.removeAttribute('data-theme');
  if(dl) el.setAttribute('data-look',dl);
  for(const k in inl) el.style.setProperty(k,inl[k]);
  return L;
}
// Look → the variables it sets (on top of _thDerive's palette variables).
function _thDeriveLook(L,p){
  const v={}, tint=(c,a)=>`rgba(${_cx.trip(c)},${a})`;
  const bgOf=(key,amt,txt)=>key&&key!=='none'?tint(key==='same'?txt:key,amt):'transparent';
  v['--rule-bars']=L.bFc==='light'?'light':L.bFc==='same'?'same':'none'; v['--fc-bar-pct']=(L.bAmt||45)+'%';
  v['--rule-prod']=L.bReal==='deep'?'deep':L.bReal==='one'?'one':'none';
  v['--rule-chart']=L.chart?'lighter':'none'; v['--chart-fc-keep']=(100-(L.chart||0))+'%';
  v['--past-shade-td']=L.pastCol==='header'?'transparent':'var(--past-shade)';
  v['--wkend-td']=L.wk==='lines'?'transparent':'rgba(var(--red-rgb),.04)';
  if(L.down==='grey'){
    const a=_cx.mix(p.surface,p.textDim,.5), b=_cx.mix(p.surface,p.textDim,.15);
    v['--rule-down']='grey'; v['--h-anch-a']=a; v['--h-red-dk']=b;
    ['maint','blocked','repair','pm'].forEach(k=>{ v[`--h-${k}-a`]=a; v[`--h-${k}-b`]=b; }); v['--h-starved-b']=b;
  } else { v['--rule-down']='none'; v['--h-anch-a']='var(--red)'; }
  if(L.mode!=='source'){
    v['--rule-num']='none'; v['--rule-fcbg']='none';
    v['--lvl-crit']='var(--red)'; v['--lvl-low']='var(--amber)'; v['--lvl-full']='var(--orange)'; v['--lvl-ok']='var(--teal)';
    return v;
  }
  const gap=L.gText==='fc'?L.fText:L.gText;
  v['--rule-num']='source'; v['--rule-fcbg']='on';
  v['--real']=L.rText; v['--real-dim']=_cx.mix(L.rText,p.bg,.2); v['--real-faint']=bgOf(L.rBg,L.rAmt,L.rText);
  v['--fc-num']=L.fText; v['--fc-num-rgb']=_cx.trip(L.fText); v['--fc-faint']=bgOf(L.fBg,L.fAmt,L.fText);
  v['--simulated']=gap; v['--simulated-dim']=_cx.mix(gap,p.bg,.2); v['--simulated-faint']=v['--fc-faint'];
  ['crit','low','full','ok'].forEach(k=>{ v[`--lvl-${k}`]='var(--fc-num)'; });
  v['--real-w']=L.rBold?'700':'400'; v['--fc-fs']=L.fItal?'italic':'normal'; v['--gap-fs']=L.gItal?'italic':'normal';
  return v;
}
function _thEdVars(){ return {..._thDerive(_thEd.picks),..._thDeriveLook(_thEd.look,_thEd.picks)}; }
// ── editor panel (its own fixed colours, so it stays readable whatever is being picked) ──
let _thEd=null;
function thOpenEditor(){
  thCloseMenu();
  if(_thEd){ _thEdRender(); return; }
  const saved=_thCustomLoad();
  const base=saved?saved.base:_thBase;
  _thEd={prevCur:_thCur, base, picks:saved?{...saved.picks}:_thBaseValues(base), look:saved&&saved.look?{...saved.look}:_thBaseLook(base), t:0};
  _thEdRender(); _thEdPreview();
}
function _thEdRender(){
  let p=document.getElementById('thx-panel');
  if(!p){ p=document.createElement('div'); p.id='thx-panel'; document.body.appendChild(p); }
  const e=_thEd, sw=t=>`<span class="thx-sw" style="background:${t.sw[0]}">${t.sw.slice(1).map(c=>`<i style="background:${c}"></i>`).join('')}</span>`;
  p.innerHTML=`<div class="thx-hd"><b>Custom palette</b><span class="thx-x" onclick="thEdCancel()" title="Close without saving">✕</span></div>
    <div class="thx-body">
      <div class="thx-sec">Start from</div>
      <div class="thx-bases">${THEMES.map(t=>`<button class="thx-base${t.id===e.base?' on':''}" onclick="thEdBase('${t.id}')">${sw(t)}${t.name}</button>`).join('')}</div>
      <div class="thx-note">Fills in every colour below, plus the chart colours not listed here.</div>
      ${['Backgrounds','Text','Data colours'].map(g=>`<div class="thx-sec">${g}</div>`+TH_PICKS.filter(x=>x.g===g).map(x=>`
        <div class="thx-row"><label for="thx-col-${x.key}">${x.n}</label>
          <span class="thx-cr" id="thx-cr-${x.key}"></span>
          <input type="color" id="thx-col-${x.key}" value="${e.picks[x.key]}" oninput="thEdPick('${x.key}',this.value)">
          <input class="thx-hex" id="thx-hex-${x.key}" value="${e.picks[x.key]}" maxlength="7" spellcheck="false" onchange="thEdPick('${x.key}',this.value,true)">
        </div>`).join('')).join('')}
      <div class="thx-note">The numbers are contrast against “Panels &amp; tables” — ✓ means it reads well on a shared screen.</div>
      <div id="thx-look">${_thEdLookHtml()}</div>
      <div class="thx-warn" id="thx-warn">Main text is too close to the background to read — change it before saving.</div>
    </div>
    <div class="thx-ft"><button class="thx-btn" onclick="thEdReset()" title="Back to the colours of the palette you started from">Reset</button><span style="flex:1"></span><button class="thx-btn" onclick="thEdCancel()">Cancel</button><button class="thx-btn pri" id="thx-save" onclick="thEdSave()">Save &amp; use</button></div>`;
  _thEdContrast();
}
function _thEdContrast(){
  const p=_thEd.picks;
  TH_PICKS.filter(x=>x.min).forEach(x=>{
    const el=document.getElementById('thx-cr-'+x.key); if(!el) return;
    const r=_cx.cr(p[x.key],p.surface), ok=r>=x.min;
    el.textContent=r.toFixed(1)+(ok?' ✓':' ⚠');
    el.className='thx-cr '+(ok?'ok':r>=x.min*.7?'mid':'lo');
    el.title=`Contrast against “Panels & tables”: ${r.toFixed(2)} : 1 — aim for ${x.min} or more`;
  });
  const bad=_cx.cr(p.text,p.surface)<3||_cx.cr(p.text,p.bg)<3;
  const sv=document.getElementById('thx-save'); if(sv) sv.disabled=bad;
  const w=document.getElementById('thx-warn'); if(w) w.style.display=bad?'block':'none';
}
function thEdPick(key,val,fromHex){
  if(!_thEd) return;
  val=_thHex(val);
  if(!/^#[0-9a-f]{6}$/.test(val)){ const h=document.getElementById('thx-hex-'+key); if(h) h.value=_thEd.picks[key]; return; }
  _thEd.picks[key]=val;
  const h=document.getElementById('thx-hex-'+key), c=document.getElementById('thx-col-'+key);
  if(h) h.value=val; if(c&&fromHex) c.value=val;
  _thEdPreview(); _thEdContrast();
}
// Live preview: CSS variables change at once; charts redraw a moment after the last change.
function _thEdPreview(){
  _thApplyVars(_thEd.base,_thEdVars(),_thEd.look); _thCur='custom';
  clearTimeout(_thEd.t); _thEd.t=setTimeout(_thRedraw,450);
}
function thEdBase(id){ if(!_thEd) return; _thEd.base=id; _thEd.picks=_thBaseValues(id); _thEd.look=_thBaseLook(id); _thEdRender(); _thEdPreview(); }
function thEdReset(){ if(!_thEd) return; _thEd.picks=_thBaseValues(_thEd.base); _thEd.look=_thBaseLook(_thEd.base); _thEdRender(); _thEdPreview(); }
function _thEdClose(){ if(_thEd) clearTimeout(_thEd.t); _thEd=null; document.getElementById('thx-panel')?.remove(); }
function thEdSave(){
  if(!_thEd) return;
  const c={base:_thEd.base, picks:{..._thEd.picks}, look:{..._thEd.look}, vars:_thEdVars()};
  try{ localStorage.setItem(THEME_CUSTOM_KEY,JSON.stringify(c)); }catch(e){}
  _thEdClose(); _thCur=null; setTheme('custom');
  if(typeof statMsg==='function') statMsg('Custom palette saved');
}
// The 'Real vs forecast' part of the editor: one row of choices per control, colours as swatches
// plus an "Other" picker for any colour. Re-rendered on each click (the scroll position is kept).
function _thEdLookHtml(){
  const L=_thEd.look, sf=_thEd.picks.surface, src=L.mode==='source';
  const chip=(key,val,label,on,sw)=>`<button class="thx-chip${on?' on':''}" onclick="thEdLook('${key}',${JSON.stringify(val).replace(/"/g,'&quot;')})">${sw?`<i style="background:${sw}"></i>`:''}${label}</button>`;
  const grp=(title,note,inner)=>`<div class="thx-grp"><label>${title}${note?`<span>${note}</span>`:''}</label><div class="thx-chips">${inner}</div></div>`;
  const cr=c=>{ const r=_cx.cr(c,sf); return `contrast ${r.toFixed(1)}${r>=4.5?' ✓':' ⚠'}`; };
  const other=(key,cur,listed)=>`<span class="thx-other">Other<input type="color" value="${/^#[0-9a-f]{6}$/.test(cur)?cur:'#888888'}" title="Any colour" oninput="thEdLook('${key}',this.value,true)" onchange="thEdLook('${key}',this.value)"></span>`;
  const colours=(key,list,cur,extra)=>(extra||'')+list.map(([n,h])=>chip(key,h,n,cur===h,h)).join('')+other(key,cur);
  const opts=(key,list,cur)=>list.map(([v,n])=>chip(key,v,n,cur===v)).join('');
  const bgs=(key,cur,txt)=>chip(key,'none','None',cur==='none')+chip(key,'same','Same as text',cur==='same',txt)+colours(key,TH_LOOK_SW.bg,cur);
  let h=`<div class="thx-sec">Real vs forecast · Supply page</div>`+
    grp('Numbers coloured by','',opts('mode',[['material','By material'],['source','Real vs forecast']],L.mode));
  if(src){
    const gapCol=L.gText==='fc'?L.fText:L.gText;
    h+=`<div class="thx-sub">REAL NUMBERS</div>`+
      grp('Text colour',cr(L.rText),colours('rText',TH_LOOK_SW.real,L.rText))+
      grp('Weight','',opts('rBold',[[false,'Normal'],[true,'Bold']],L.rBold))+
      grp('Cell background','',bgs('rBg',L.rBg,L.rText))+
      (L.rBg!=='none'?grp('Background strength','',opts('rAmt',TH_LOOK_AMT.map(([n,a])=>[a,n]),L.rAmt)):'')+
      `<div class="thx-sub">FORECAST NUMBERS</div>`+
      grp('Text colour',cr(L.fText),colours('fText',TH_LOOK_SW.fc,L.fText))+
      grp('Style','',opts('fItal',[[false,'Normal'],[true,'Italic']],L.fItal))+
      grp('Cell background','',bgs('fBg',L.fBg,L.fText))+
      (L.fBg!=='none'?grp('Background strength','',opts('fAmt',TH_LOOK_AMT.map(([n,a])=>[a,n]),L.fAmt)):'')+
      `<div class="thx-sub">PAST DAY, NO ACTUAL</div>`+
      grp('Text colour',cr(gapCol),colours('gText',TH_LOOK_SW.gap,L.gText,chip('gText','fc','= forecast',L.gText==='fc',L.fText)))+
      grp('Style','',opts('gItal',[[false,'Normal'],[true,'Italic']],L.gItal));
  }
  h+=`<div class="thx-sub">BARS</div>`+
    grp('Real bars (mill Gantt + charts)','',opts('bReal',[['deep','Deep product colours'],['base','Palette product colours'],['one','One colour = real text']],L.bReal))+
    grp('Forecast bars','',opts('bFc',[['light','Light solid'],['striped','Striped'],['same','Same as real']],L.bFc))+
    (L.bFc==='light'?grp('Light solid: how much colour','',opts('bAmt',[[25,'25%'],[45,'45%'],[65,'65%'],[85,'85%']],L.bAmt)):'')+
    grp('Chart bars on forecast days','',opts('chart',[[0,'Same as real'],[35,'A bit lighter'],[50,'Lighter'],[70,'Much lighter']],L.chart))+
    grp('Down days &amp; vessel states','',opts('down',[['grey','Grey + label'],['colour','Coloured stripes']],L.down))+
    `<div class="thx-sub">COLUMNS</div>`+
    grp('Past days shaded','',opts('pastCol',[['header','Date header only'],['column','Whole column']],L.pastCol))+
    grp('Weekends','',opts('wk',[['lines','Border lines only'],['fill','Lines + pink fill']],L.wk));
  return h;
}
// quiet = a colour picker being dragged: preview only, don't rebuild the panel under the open picker
function thEdLook(key,val,quiet){
  if(!_thEd) return;
  if(typeof val==='string'&&/^#[0-9a-f]{3,6}$/i.test(val)) val=_thHex(val);
  _thEd.look[key]=val;
  if(!quiet){ const b=document.querySelector('#thx-panel .thx-body'), t=b?b.scrollTop:0;
    const box=document.getElementById('thx-look'); if(box) box.innerHTML=_thEdLookHtml(); if(b) b.scrollTop=t; }
  _thEdPreview();
}
function thEdCancel(){
  if(!_thEd) return;
  const prev=_thEd.prevCur; _thEdClose();
  _thCur=null; setTheme(prev);   // back to what was on screen before (a saved Custom reloads from storage)
}
function thCloseMenu(){ const m=document.getElementById('th-menu'); if(m) m.style.display='none'; }
document.addEventListener('click',e=>{ if(!e.target.closest||!e.target.closest('#th-ctl')) thCloseMenu(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') thCloseMenu(); });

// ═══════════════════════════════════════════════════════
// SALES PAGE LINK — the Sales page (its own tab) works on one of these scenarios
// ═══════════════════════════════════════════════════════
// Catalog: after every save, the active scenario's facilities, sub-regions, products and
// demand points are published to localStorage 'avila_sc_catalog' as {activeId, byId:{id:cat}}.
// The Sales page lists these scenarios in its selector, builds its filters from them and
// maps its sales rows onto their demand points. One entry per scenario, kept until replaced,
// so a scenario shows up there once it has been opened here. No scenario file → '__local'.
// Handoff: the Sales page's "Push forecast" writes 'avila_forecast_handoff'
// {scenarioId, scenarioName, pushed_at, from, to, values:[{element_id,date,value_t}]}.
// Nothing changes until the user presses Apply on the banner here.
const SC_CATALOG_KEY='avila_sc_catalog', FC_HANDOFF_KEY='avila_forecast_handoff';
let _rollCatTimer=null;
// Planning scenario? Explicit opt-in only (simCfg.role) — `simCfg.mode` is a legacy label that
// defaults to 'planning' in every file, so it must never gate behaviour.
function scIsPlanning(){ return !!(typeof S!=='undefined' && S && S.simCfg && S.simCfg.role==='planning'); }
const PLAN_SLOT_IDS=new Set();   // a Planning scenario reads no data slot: the budget comes in through Budget Planning → Load budget demand
function _rollScId(){ return (typeof SC!=='undefined'&&SC.activeId)||'__local'; }
function _rollPublishCatalogSoon(){ clearTimeout(_rollCatTimer); _rollCatTimer=setTimeout(_rollPublishCatalog,1200); }
function _rollPublishCatalog(){
  try{
    if(scIsPlanning()) return;   // the Sales page must never see the Planning scenario as active
    if(!DB||!Array.isArray(DB.facilities)||!DB.facilities.length) return;
    const id=_rollScId(), m=(typeof SC!=='undefined'&&SC.meta&&SC.meta[id])||null;
    const dpBy=new Map((DB.demand_points||[]).map(d=>[d.element_id,d]));
    const cat={ id, name:m?m.name:'This browser (no scenario file)', file:m?(m.fileName||''):'',
      publishedAt:new Date().toISOString(),
      famOf:PRODUCT_FAMILY_OF, famLabels:PRODUCT_FAMILY_LABELS, catLabels:SUP_CAT_LABELS,
      facilities:DB.facilities.map(f=>({id:f.id,name:f.name,type:f.type||'plant',sub_region_id:f.sub_region_id||null})),
      sub_regions:(DB.sub_regions||[]).map(x=>({id:x.id,name:x.name})),
      products:(DB.products||[]).map(p=>({id:p.id,name:p.name,category:p.category||'',facility_id:p.facility_id||null})),
      dps:DB.elements.filter(e=>e.type==='demand_point').map(e=>({element_id:e.id,name:e.name||'',
        dp_code:e.props?.dp_code||'', facility_id:e.assigned_facility_id||e.facility_id||null,
        products:(dpBy.get(e.id)?.products||[]).map(x=>x.product_id).filter(Boolean)}))
    };
    let all={}; try{ all=JSON.parse(localStorage.getItem(SC_CATALOG_KEY)||'{}')||{}; }catch(e){}
    all.byId=all.byId||{};
    // Nothing the Sales page uses changed (same scenario, same catalog) → leave the stored copy
    // alone. Re-writing it with only a new publishedAt made an open Sales tab redraw its whole
    // page after every single edit made here.
    const prev=all.byId[id];
    if(prev && all.activeId===id && JSON.stringify({...prev,publishedAt:null})===JSON.stringify({...cat,publishedAt:null})) return;
    all.byId[id]=cat; all.activeId=id;
    localStorage.setItem(SC_CATALOG_KEY,JSON.stringify(all));
  }catch(e){ console.warn('Sales catalog publish failed',e); }
}

// ── pushed forecast from the Sales page ──
function _rollReadHandoff(){ try{ const h=JSON.parse(localStorage.getItem(FC_HANDOFF_KEY)||'null'); return h&&Array.isArray(h.values)?h:null; }catch(e){ return null; } }
function _rollCheckHandoff(){
  const h=_rollReadHandoff(); document.getElementById('fc-handoff-banner')?.remove();
  if(!h || scIsPlanning()) return;
  const here=h.scenarioId===_rollScId();
  const dps=new Set(h.values.map(v=>v.element_id)).size;
  const b=document.createElement('div'); b.id='fc-handoff-banner';
  b.style.cssText='position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:9500;display:flex;align-items:center;gap:10px;'+
    'padding:9px 14px;background:var(--bn-info-bg);color:var(--bn-info-fg);border:1px solid var(--blue);border-radius:6px;'+
    'font-family:var(--mono);font-size:10px;box-shadow:0 8px 26px rgba(0,0,0,.45);max-width:760px';
  b.innerHTML=here
    ? `<span>📈 <b>Sales Detail</b> pushed a forecast for <b>${esc(h.scenarioName||'this scenario')}</b>: ${dps} demand point${dps===1?'':'s'}, ${esc(h.from||'')} → ${esc(h.to||'')}. `+
      `Applying replaces the forecast (not the actuals) of those points on those days.</span>`+
      `<button class="tb-btn" style="padding:4px 10px" onclick="_rollApplyHandoff()">Apply</button>`+
      `<button class="tb-btn sec" style="padding:4px 10px" onclick="_rollDismissHandoff()">Discard</button>`
    : `<span>📈 <b>Sales Detail</b> pushed a forecast for scenario <b>${esc(h.scenarioName||h.scenarioId)}</b> — open that scenario here to apply it.</span>`+
      `<button class="tb-btn sec" style="padding:4px 10px" onclick="document.getElementById('fc-handoff-banner').remove()">Later</button>`;
  document.body.appendChild(b);
}
function _rollDismissHandoff(){ try{ localStorage.removeItem(FC_HANDOFF_KEY); }catch(e){} document.getElementById('fc-handoff-banner')?.remove(); statMsg('Pushed forecast discarded'); }
function _rollApplyHandoff(){
  if(scIsPlanning()) return;
  const h=_rollReadHandoff(); if(!h||h.scenarioId!==_rollScId()){ _rollCheckHandoff(); return; }
  if(!DB.demand_values) DB.demand_values=[];
  const known=new Set(DB.elements.filter(e=>e.type==='demand_point').map(e=>e.id));
  const vals=h.values.filter(v=>known.has(v.element_id)&&/^\d{4}-\d{2}-\d{2}$/.test(v.date||''));
  const touched=new Set(vals.map(v=>v.element_id+'|'+v.date));
  // Actual days are never replaced; every other row on a pushed point/day is.
  const actual=new Set(DB.demand_values.filter(v=>v.source==='actual').map(v=>v.element_id+'|'+v.date));
  DB.demand_values=DB.demand_values.filter(v=>v.source==='actual'||!touched.has(v.element_id+'|'+v.date));
  let n=0;
  vals.forEach(v=>{ const k=v.element_id+'|'+v.date; if(actual.has(k)) return; const t=Math.round((+v.value_t||0)*10)/10;
    if(t>0){ DB.demand_values.push({element_id:v.element_id,date:v.date,value_t:t,source:'forecast'}); n++; } });
  try{ localStorage.removeItem(FC_HANDOFF_KEY); }catch(e){}
  document.getElementById('fc-handoff-banner')?.remove();
  _demandChanged(); autoSave();
  statMsg(`Sales forecast applied — ${n} day values on ${new Set(vals.map(v=>v.element_id)).size} demand points`);
}
window.addEventListener('storage',e=>{
  if(e.key===FC_HANDOFF_KEY) _rollCheckHandoff();
});
window.addEventListener('load',()=>setTimeout(()=>{ _rollPublishCatalog(); _rollCheckHandoff(); },1500));

// Sister pages live in their OWN named browser tab: 'avila_roll' / 'avila_sales'. window.open('',name)
// hands back that tab when it is already open, or a fresh blank one. Chrome never lets a page bring
// another EXISTING tab to the front (focus() is ignored), so an already-open tab is only reported.
// Popup blocked → the old same-tab link.
function _openPageTab(url,name,label){
  let w=null; try{ w=window.open('',name); }catch(e){}
  if(!w||w===window){ location.href=url; return false; }
  let blank=false; try{ blank=!w.location.href||w.location.href==='about:blank'; }catch(e){}   // another page's origin → it is loaded
  if(blank){ w.location.href=url; try{ w.focus(); }catch(e){} }
  else if(typeof statMsg==='function') statMsg(`${label||'That page'} is already open in its own browser tab — switch to it in the tab bar`);
  return false;
}
try{ window.name='avila_roll'; }catch(e){}   // always: a tab keeps its name across navigation, so claim ours — lets the sister page find this tab

// ═══════════════════════════════════════════════════════
// THIRD-PARTY LIBRARIES — single pinned loader
// ═══════════════════════════════════════════════════════
// `integrity` pins the exact published bytes (sha384 computed from the files
// themselves), so a swapped or compromised CDN file refuses to execute instead
// of running in a page that holds the user's API key. xlsx comes from the
// vendor's own CDN at 0.20.3 — cdnjs stopped updating at 0.18.5, which carries
// known CVEs (prototype pollution CVE-2023-30533; ReDoS CVE-2024-22363) fixed
// in later releases. Only stable XLSX.utils APIs are used, unchanged 0.18→0.20.
const LIBS={
  chart:{ src:'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
          sri:'sha384-dug+JxfBvklEQdJ4AYuBBAIScUz0bVN73xpy273gcAwHjb3qI0fXmuYNaNfdyYJG',
          ready:()=>typeof Chart!=='undefined' },
  xlsx:{  src:'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
          sri:'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT',
          ready:()=>typeof XLSX!=='undefined' },
};
// HTML-escape for user-entered text interpolated into innerHTML templates
// (element/product/scenario names, filenames). Scenario .json files are shared
// between teammates and three-way-merged, so a crafted name in a shared file is
// a stored-XSS vector into a browser whose localStorage holds an API key —
// escape at the render boundary. Safe for attributes too (quotes covered).
function esc(s){
  return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function loadLib(name){
  const lib=LIBS[name];
  if(lib.ready()) return Promise.resolve();
  if(lib._p) return lib._p;   // a load is already in flight — share it
  lib._p=new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src=lib.src; s.integrity=lib.sri; s.crossOrigin='anonymous';
    s.onload=res;
    s.onerror=()=>{ lib._p=null; rej(new Error('Could not load the '+name+' library — check internet connection')); };
    document.head.appendChild(s);
  });
  return lib._p;
}

