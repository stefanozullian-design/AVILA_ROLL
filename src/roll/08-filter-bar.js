// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// SUPPLY VIEW — FILTER BAR + KPI DASHBOARD
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// SHARED FILTER BAR — one set of filter selections for every planning page
// ═══════════════════════════════════════════════════════════════════════════
// Supply → Production, Demand, Logistics (vessel / rail / truck) and Results (dashboard,
// data table) all show the same bar: Time frame · Sub-region · Facility · Process ·
// Product, then Clear all, with the "Active" token strip under it. The SELECTIONS live in
// ONE object, window._flt, so whatever is picked on one page is exactly what every other
// page shows when the user moves to it. Each page only decides what a selection MEANS for
// its own rows, through its FLT_PAGES entry (registered next to that page's code): the
// dates it has, which Process keys it can hide, and how it re-renders.
//
// _flt — arrays where EMPTY MEANS "ALL", so an untouched bar leaves every page as it was:
//   preset / fromDate / toDate — the time frame (fltTfWanted). NOT persisted: every
//     session opens on the current month.
//   subIds     — sub-regions picked; pick-to-narrow (NFL lit = NFL only).
//   facIds     — facilities kept; click-to-remove, [] = all.
//   fams / cats / prodIds — the Family → Category → Product cascade.
//   procHidden — SUP_PROCESSES keys switched OFF, stored as the off-list so a section
//     added later shows by default.
// The panels list the SAME facilities, sub-regions and products on every page, and picks
// are pruned only against those app-wide lists — never against one page's rows — so
// opening a page can't silently drop a selection made on another.
const FLT_KEY='avila_filters';
const FLT_TF_DEFAULT='cm';
// Time frame presets in panel order; '-' is a divider. Each resolves relative to TODAY.
const FLT_TF_PRESETS=[
  {k:'mtd',n:'MTD'},{k:'ytd',n:'YTD'},'-',
  {k:'cm',n:'Current month'},'-',
  {k:'rom',n:'ROM'},{k:'n3m',n:'N3M'},{k:'roy',n:'ROY'},'-',
  {k:'full',n:'Full simulation'},{k:'custom',n:'Custom'}
];
// What each page needs from the bar, filled in beside each page's code:
//   bounds()   → {from,to}: the first/last day that page can show ('' = unknown)
//   proc()     → the Process keys it can hide, or null to hide the Process button
//   rerender() → repaint the page (and its bar) after a selection changes
//   onClearAll → optional: page-only controls that Clear all should also reset
const FLT_PAGES={};
window._flt={preset:FLT_TF_DEFAULT, fromDate:'', toDate:'',
  subIds:[], facIds:[], fams:[], cats:[], prodIds:[], procHidden:[]};
window._supView=window._flt;   // the Supply page's historical name for the same object
fltLoad();

// Selections outlive a reload (same pattern as avila_tbl_zoom); the time frame doesn't.
function fltSave(){
  const v=window._flt;
  try{ localStorage.setItem(FLT_KEY,JSON.stringify({subIds:v.subIds, facIds:v.facIds,
    fams:v.fams, cats:v.cats, prodIds:v.prodIds, procHidden:v.procHidden})); }catch(e){}
}
function fltLoad(){
  const v=window._flt;
  const arr=x=>Array.isArray(x)?x.filter(i=>typeof i==='string'):[];
  try{
    // The first run after the bar went app-wide starts from the Supply page's saved picks.
    const raw=localStorage.getItem(FLT_KEY)||localStorage.getItem('avila_sup_filters'); if(!raw) return;
    const p=JSON.parse(raw)||{};
    v.subIds=arr(p.subIds); v.facIds=arr(p.facIds); v.fams=arr(p.fams); v.cats=arr(p.cats);
    v.prodIds=arr(p.prodIds); v.procHidden=arr(p.procHidden);
  }catch(e){}
}

// ── TIME FRAME ─────────────────────────────────────────────────────────────
// First and last simulated day, local YYYY-MM-DD ('' before dates are configured).
// Calendar arithmetic, not +ms: adding 864e5 per day across the November DST change
// lands at 23:00 the day before, which silently dropped the last day.
function fltSimBounds(horizon){
  if(!S.simCfg?.start_date) return {from:'',to:''};
  const s=new Date(S.simCfg.start_date+'T00:00:00');
  const n=horizon||S.simCfg.horizon||90;   // same default as the Supply table's date spine
  return {from:s._ymd(), to:new Date(s.getFullYear(),s.getMonth(),s.getDate()+n-1)._ymd()};
}
function fltPageBounds(p){
  const f=FLT_PAGES[p]?.bounds;
  return (f&&f())||fltSimBounds();
}

// The window a preset asks for, before a page cuts it to the days it has (b).
function fltTfWanted(k,b){
  // A Planning scenario runs a future year (starts 1 Jan next year): "today" for the presets is its first day, so
  // Current month / Year to date / Rest of year open on the budget year instead of an empty window.
  const t=(typeof scIsPlanning==='function'&&scIsPlanning()&&S.simCfg&&S.simCfg.start_date&&S.simCfg.start_date>new Date()._ymd())?new Date(S.simCfg.start_date+'T12:00:00'):new Date(), y=t.getFullYear(), m=t.getMonth();
  const today=new Date(y,m,t.getDate())._ymd();
  const som=new Date(y,m,1)._ymd(), eom=new Date(y,m+1,0)._ymd();
  switch(k){
    case 'mtd':  return {from:som, to:today};
    case 'ytd':  return {from:y+'-01-01', to:today};
    case 'cm':   return {from:som, to:eom};
    case 'rom':  return {from:today, to:eom};
    case 'n3m':  return {from:today, to:new Date(y,m+4,0)._ymd()};   // rest of this month + 3 full months
    case 'roy':  return {from:today, to:y+'-12-31'};
    case 'custom': {
      const v=window._flt;
      return {from:v.fromDate||b.from, to:v.toDate||b.to};
    }
    default:     return {from:b.from, to:b.to};                       // 'full'
  }
}

// The days page p shows: the time frame cut to that page's bounds. from > to means no
// overlap. wanted = the uncut window; bounds = what the page has.
function fltGetDateRange(p,bounds){
  const b=bounds||fltPageBounds(p);
  const wanted=fltTfWanted(window._flt.preset||FLT_TF_DEFAULT,b);
  return {from:b.from&&wanted.from<b.from?b.from:wanted.from,
          to:b.to&&wanted.to>b.to?b.to:wanted.to, wanted, bounds:b};
}

// The shared time frame as 1-indexed simulation days, for pages that index by day. `horizon`
// overrides the configured one (the rail planner can run past it). No overlap comes back as
// {startDay:1, endDay:0, empty:true}, so `endDay-startDay+1` is 0 and day loops run no days.
function fltSimDayRange(p,horizon){
  const r=fltGetDateRange(p,horizon?fltSimBounds(horizon):undefined);
  if(!S.simCfg?.start_date||!r.from||!r.to||r.from>r.to) return {startDay:1, endDay:0, empty:true};
  return {startDay:dateToDayOffset(r.from,S.simCfg.start_date)+1,
          endDay:dateToDayOffset(r.to,S.simCfg.start_date)+1};
}

// Inclusive day count between two YYYY-MM-DD strings (rounding absorbs DST hours).
function fltDaysIncl(a,b){ return Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/864e5)+1; }

// "Sep 17", or "Jan 15 '27" outside the current year.
function fltFmt(ds){
  if(!ds) return '';
  const d=new Date(ds+'T00:00:00');
  const s=d.toLocaleDateString('en',{month:'short',day:'numeric'});
  return d.getFullYear()===new Date().getFullYear()?s:s+" '"+String(d.getFullYear()).slice(2);
}

function fltSetTimeFrame(p,k){
  const v=window._flt;
  if(k==='custom'&&v.preset!=='custom'){
    // Seed the pickers with what is on screen, so Custom reads as "adjust this window".
    const r=fltGetDateRange(p);
    if(r.from&&r.to&&r.from<=r.to){ v.fromDate=r.from; v.toDate=r.to; }
  }
  v.preset=k;
  if(k!=='custom') fltCloseDock();   // one choice, so close like a pull-down; Custom stays open for its dates
  fltChanged(p);
}

// Custom From/To. Partial typing (year 0002…) is ignored, dates are held inside the page's
// bounds, and moving one end past the other drags the other end along.
function fltSetTfDate(p,which,val){
  const v=window._flt, b=fltPageBounds(p);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(val||'')||val<'1900') return;
  if(b.from&&val<b.from) val=b.from;
  if(b.to&&val>b.to) val=b.to;
  const before=v.fromDate+'|'+v.toDate;
  if(which==='from'){ v.fromDate=val; if(!v.toDate||v.toDate<val) v.toDate=val; }
  else              { v.toDate=val;   if(!v.fromDate||v.fromDate>val) v.fromDate=val; }
  if(v.fromDate+'|'+v.toDate!==before) fltChanged(p);
}

// ── UNIVERSES (the same on every page) ─────────────────────────────────────
const SUP_CAT_LABELS={cement_bulk:'Cement Bulk',cement_packed:'Cement Packed',clinker:'Clinker',raw_meal:'Raw Material',additive:'SCM'};

// ── PROCESS CATALOG ────────────────────────────────────────────────────────
// One entry per collapsible section of the Supply table. `key` is the section key
// already stamped on every header (`data-seckey`) and child row (`supsec-<key>`) by
// the render, so hiding a process is a CSS rule — no re-render, and no change needed
// at the ~18 places that emit those rows. Other pages map their own sections onto these
// keys (their FLT_PAGES proc() lists which ones they have).
//   n    — short label, read under its group heading in the panel ("Inventory › Cement")
//   full — unambiguous name, used anywhere the group heading is not adjacent
const SUP_PROCESSES=[
  {g:'Inventory',    c:'var(--teal)', key:'cementInv',    n:'Cement',                  full:'Cement inventory'},
  {g:'Inventory',    c:'var(--blue)', key:'packedInv',    n:'Packed',                  full:'Packed inventory'},
  {g:'Inventory',    c:'var(--orange)', key:'clinkerInv',   n:'Clinker',                 full:'Clinker inventory'},
  {g:'Requirements', c:'var(--blue)', key:'cementNeed',   n:'Cement',                  full:'Cement requirements'},
  {g:'Requirements', c:'var(--blue)', key:'packedNeed',   n:'Packed',                  full:'Packed requirements'},
  {g:'Requirements', c:'var(--peach)', key:'clinkerReq',   n:'Clinker',                 full:'Clinker requirements'},
  {g:'Production',   c:'var(--green)', key:'cementProd',   n:'Finish mill',             full:'Finish mill production'},
  {g:'Production',   c:'var(--green)', key:'cementByProd', n:'Finish mill · by product',full:'Finish mill by product'},
  {g:'Production',   c:'var(--orange)', key:'clinkerProd',  n:'Clinker',                 full:'Clinker production'},
  {g:'Production',   c:'var(--blue)', key:'packProd',     n:'Packing plant',           full:'Packing plant production'},
  {g:'Logistics',    c:'var(--purple)', key:'railLoad',     n:'Rail loading',            full:'Rail loading'},
  {g:'Logistics',    c:'var(--purple)', key:'termVessel',   n:'Vessel arrivals',         full:'Vessel arrivals'},
  {g:'Logistics',    c:'var(--purple)', key:'termRail',     n:'Rail arrivals',           full:'Rail arrivals'},
  {g:'Logistics',    c:'var(--orange)', key:'clinkerXfer',  n:'Clinker silo transfer',   full:'Clinker silo transfer'},
  {g:'Logistics',    c:'var(--teal)', key:'cementXfer',   n:'Cement / bulk silo transfer', full:'Cement and bulk silo transfer'}
];
const SUP_PROC_GROUPS=['Inventory','Requirements','Production','Logistics'];
function fltProcOn(key){ return !(window._flt.procHidden||[]).includes(key); }

// ── Selection-set helpers ──────────────────────────────────────────────────
// Every filter uses the same convention: an empty array means "unrestricted".
function _fltHas(field,id){ const a=window._flt[field]||[]; return a.length===0||a.includes(id); }
function _fltToggle(field,id,universe){
  const v=window._flt; let a=(v[field]||[]).slice();
  if(!a.length) a=universe.slice();          // make "all" explicit before subtracting
  a=a.includes(id)?a.filter(x=>x!==id):a.concat([id]);
  if(a.length===universe.length) a=[];       // back to unrestricted
  v[field]=a;
}

// Facilities any planning page can show: every facility that owns an element (by its
// assigned facility — an element's own facility_id is the canvas it was drawn on).
function fltFacilities(){
  const ids=new Set(DB.elements.map(e=>e.assigned_facility_id||e.facility_id).filter(Boolean));
  return DB.facilities.filter(f=>ids.has(f.id));
}
// Sub-regions holding at least one of those facilities, in org-tree order.
function fltSubRegions(){
  const ids=new Set(fltFacilities().map(f=>f.sub_region_id).filter(Boolean));
  return (DB.sub_regions||[]).filter(s=>ids.has(s.id));
}
// Facilities inside the picked sub-regions (all when none is picked) — the Facility panel.
function fltSubScopedFacilities(){
  const subs=window._flt.subIds||[];
  const all=fltFacilities();
  return subs.length?all.filter(f=>subs.includes(f.sub_region_id)):all;
}
// The facilities in view as a Set — null when unrestricted, so callers can skip
// filtering entirely. Sub-region and Facility picks intersect.
function fltFacIdSet(){
  const v=window._flt, subs=v.subIds||[], facs=v.facIds||[];
  if(!subs.length) return facs.length?new Set(facs):null;
  const scoped=fltSubScopedFacilities().map(f=>f.id);
  return new Set(facs.length?scoped.filter(id=>facs.includes(id)):scoped);
}

// Products handled at the given facilities ([] = everywhere): what their elements produce
// (capacity tables), store (silo contents) or are asked for (demand points), plus catalog
// products "Made At" one of them — so a product created and assigned to a plant is
// filterable before anyone wires it into a mill.
function fltScopeProductIds(facIds){
  const fset=(facIds&&facIds.length)?new Set(facIds):null;
  const known=new Set((DB.products||[]).map(p=>p.id));
  const out=new Set(), add=pid=>{ if(pid&&known.has(pid)) out.add(pid); };
  const capBy=new Map();
  DB.element_product_capacities.forEach(c=>{ const a=capBy.get(c.element_id); if(a) a.push(c.product_id); else capBy.set(c.element_id,[c.product_id]); });
  const dpBy=new Map((DB.demand_points||[]).map(d=>[d.element_id,d]));
  DB.elements.forEach(el=>{
    if(fset&&!fset.has(el.assigned_facility_id||el.facility_id)) return;
    if(el.type==='bulk_silo'||el.type==='packed_silo') (getSiloProducts(el)||[]).forEach(add);
    else if(el.type==='demand_point') (dpBy.get(el.id)?.products||[]).forEach(x=>add(x.product_id));
    else (capBy.get(el.id)||[]).forEach(add);
  });
  (DB.products||[]).forEach(p=>{ if(p.facility_id&&(!fset||fset.has(p.facility_id))) add(p.id); });
  return out;
}

// Drop picks the app no longer offers, so no page filters on a combination the panels
// don't show. App-wide lists only (see the header) — and skipped while the database is
// still empty at startup, so saved picks survive until the scenario has loaded.
function fltNormalize(){
  const v=window._flt;
  if(!fltFacilities().length) return;
  const subOk=new Set(fltSubRegions().map(s=>s.id));
  v.subIds=(v.subIds||[]).filter(id=>subOk.has(id));
  const facOk=new Set(fltSubScopedFacilities().map(f=>f.id));
  v.facIds=(v.facIds||[]).filter(id=>facOk.has(id));
  if(v.facIds.length===facOk.size) v.facIds=[];
  const scope=fltScopeProductIds([...(fltFacIdSet()||[])]);
  const catOf=pid=>DB.products.find(p=>p.id===pid)?.category||'';
  const famOf=pid=>PRODUCT_FAMILY_OF[catOf(pid)]||'';
  // Families/categories must still exist somewhere in scope.
  v.fams=(v.fams||[]).filter(f=>[...scope].some(id=>famOf(id)===f));
  v.cats=(v.cats||[]).filter(c=>[...scope].some(id=>catOf(id)===c)
    &&(!v.fams.length||v.fams.includes(PRODUCT_FAMILY_OF[c])));
  // Products must be in scope AND survive the family/category narrowing above.
  v.prodIds=(v.prodIds||[]).filter(pid=>scope.has(pid)
    &&(!v.fams.length||v.fams.includes(famOf(pid)))
    &&(!v.cats.length||v.cats.includes(catOf(pid))));
  const procOk=new Set(SUP_PROCESSES.map(p=>p.key));
  v.procHidden=(v.procHidden||[]).filter(k=>procOk.has(k));
}

// The set of product ids pages may show, or null for "no product restriction". Pages
// test membership rather than comparing against one picked product, so Family, Category
// and Product all narrow through the same path. Product beats Category beats Family.
function fltAllowedProdIds(){
  const v=window._flt;
  const fams=v.fams||[], cats=v.cats||[], prods=v.prodIds||[];
  if(!fams.length && !cats.length && !prods.length) return null;
  if(prods.length) return new Set(prods);
  return new Set((DB.products||[]).filter(p=>
    cats.length ? cats.includes(p.category||'')
                : fams.includes(PRODUCT_FAMILY_OF[p.category]||'')
  ).map(p=>p.id));
}

// ── BAR ────────────────────────────────────────────────────────────────────
// A page hosts its bar in <div id="flt-<p>-bar" style="display:contents"> (the buttons
// join the page's own toolbar row) and its strip in <div id="flt-<p>-toks" class="sup-toks">.
function fltMount(p){
  const host=document.getElementById('flt-'+p+'-bar');
  if(!host||host.dataset.mounted) return;
  host.dataset.mounted='1';
  const dock=(w,label,panSty)=>
    `<div class="sup-drop"><button type="button" class="sup-drop-btn" id="flt-${p}-btn-${w}" aria-expanded="false" aria-haspopup="true" onclick="fltToggleDock(event,'${p}','${w}')">`+
    `<span class="k">${label}</span><span class="v">All</span><span class="car">▼</span></button>`+
    `<div class="sup-panel" id="flt-${p}-pan-${w}"${panSty?` style="${panSty}"`:''} onclick="event.stopPropagation()"></div></div>`;
  host.innerHTML=dock('tf','Time frame','min-width:0')+`<div class="tb-div"></div>`+
    dock('sub','Sub-region')+dock('fac','Facility')+dock('proc','Process','min-width:340px')+dock('prod','Product','min-width:540px')+
    `<button type="button" class="tb-btn sec" style="font-size:9px;padding:3px 10px" onclick="fltClearAll('${p}')">✕ Clear all</button>`;
}

// Repaints page p's bar from the shared state: prune impossible picks, rebuild the panels
// in place (an open one stays open), then the button faces and the token strip.
function fltRender(p){
  fltMount(p);
  fltNormalize();
  _fltRenderTfPanel(p);
  _fltRenderSubPanel(p);
  _fltRenderFacPanel(p);
  _fltRenderProcPanel(p);
  _fltRenderProdPanel(p);
  _fltRenderSummary(p);
}

// One checkbox pill. `swatch` tints it with the section's own colour; `na` dims a Process
// the current page doesn't have (still clickable — the choice is shared with other pages).
function fltPill(label,on,onclick,opt){
  const o=opt||{};
  return `<button type="button" class="sup-cb${on?' on':''}${o.all?' all':''}${o.na?' na':''}" aria-pressed="${on}"`+
    (o.title?` title="${esc(o.title)}"`:'')+` onclick="${onclick}">`+
    `<i class="box">${on?'✓':''}</i>`+
    (o.swatch?`<i class="swatch" style="background:${o.swatch}"></i>`:'')+
    `<span>${esc(label)}</span></button>`;
}

// The list is rebuilt on every render; the date inputs are created once and only have
// their values synced, so a picker the user is typing into never loses focus.
function _fltRenderTfPanel(p){
  const pan=document.getElementById(`flt-${p}-pan-tf`); if(!pan) return;
  const cur=window._flt.preset||FLT_TF_DEFAULT;
  let list=pan.querySelector('.sup-tf-list'), cust=pan.querySelector('.sup-tf-cust');
  if(!list||!cust){
    pan.innerHTML=`<div class="sup-tf-list"></div><div class="sup-tf-cust">`+
      `<label>From <input type="date" data-w="from" onchange="fltSetTfDate('${p}','from',this.value)"></label>`+
      `<label>To <input type="date" data-w="to" onchange="fltSetTfDate('${p}','to',this.value)"></label></div>`;
    list=pan.querySelector('.sup-tf-list'); cust=pan.querySelector('.sup-tf-cust');
  }
  const b=fltPageBounds(p);
  let h='';
  FLT_TF_PRESETS.forEach(o=>{
    if(o==='-'){ h+=`<i class="sup-tf-sep"></i>`; return; }
    // Dates live in the tooltip only — nothing extra on screen.
    const w=fltTfWanted(o.k,b);
    const f=b.from&&w.from<b.from?b.from:w.from, t=b.to&&w.to>b.to?b.to:w.to;
    const ok=f&&t&&f<=t;
    let tip=ok?`${fltFmt(f)} → ${fltFmt(t)} · ${fltDaysIncl(f,t)} days`:'No days on this page in this window';
    if(ok&&b.from&&w.from<b.from) tip+=` · this page starts ${fltFmt(b.from)}`;
    if(ok&&b.to&&w.to>b.to)       tip+=` · this page ends ${fltFmt(b.to)}`;
    h+=fltPill(o.n,cur===o.k,`fltSetTimeFrame('${p}','${o.k}')`,{title:tip});
  });
  list.innerHTML=h;
  cust.style.display=cur==='custom'?'flex':'none';
  const r=fltGetDateRange(p);
  cust.querySelectorAll('input').forEach(inp=>{
    inp.min=b.from||''; inp.max=b.to||'';
    if(document.activeElement!==inp) inp.value=inp.dataset.w==='from'?r.from:r.to;
  });
}

// Sub-region picks narrow the page (and the Facility panel). Like the product cascade, a
// pill is lit only when picked and ALL is lit when nothing is — so clicking NFL means "NFL only".
function _fltRenderSubPanel(p){
  const pan=document.getElementById(`flt-${p}-pan-sub`); if(!pan) return;
  const picked=window._flt.subIds||[];
  let h=`<div class="sup-pan-hd"><span>Sub-region · narrows the Facility list</span></div>`;
  h+=`<div class="sup-grp"><div class="sup-grp-hd"><h4>Sub-regions</h4><i></i></div><div class="sup-chips">`;
  h+=fltPill('All',!picked.length,`fltClearSubs('${p}')`,{all:true,title:'Every sub-region'});
  fltSubRegions().forEach(s=>{ h+=fltPill(s.name,picked.includes(s.id),`fltToggleSub('${p}','${s.id}')`); });
  h+=`</div></div>`;
  pan.innerHTML=h;
}

function _fltRenderFacPanel(p){
  const pan=document.getElementById(`flt-${p}-pan-fac`); if(!pan) return;
  const facs=fltSubScopedFacilities();
  let h=`<div class="sup-pan-hd"><span>Facility · ALL flips a whole group</span></div>`;
  [['plant','Plants'],['terminal','Terminals']].forEach(([type,label])=>{
    const inGrp=facs.filter(f=>(f.type||'plant')===type);
    if(!inGrp.length) return;
    const allOn=inGrp.every(f=>_fltHas('facIds',f.id));
    h+=`<div class="sup-grp"><div class="sup-grp-hd"><h4>${label}</h4><i></i></div><div class="sup-chips">`;
    h+=fltPill('All',allOn,`fltToggleFacGroup('${p}','${type}')`,{all:true,title:'Every '+label.toLowerCase()});
    inGrp.forEach(f=>{ h+=fltPill(f.name,_fltHas('facIds',f.id),`fltToggleFac('${p}','${f.id}')`); });
    h+=`</div></div>`;
  });
  // Facilities that don't declare a type still need somewhere to live.
  const untyped=facs.filter(f=>!['plant','terminal'].includes(f.type||'plant'));
  if(untyped.length){
    h+=`<div class="sup-grp"><div class="sup-grp-hd"><h4>Other</h4><i></i></div><div class="sup-chips">`;
    untyped.forEach(f=>{ h+=fltPill(f.name,_fltHas('facIds',f.id),`fltToggleFac('${p}','${f.id}')`); });
    h+=`</div></div>`;
  }
  pan.innerHTML=h;
}

function _fltRenderProcPanel(p){
  const pan=document.getElementById(`flt-${p}-pan-proc`); if(!pan) return;
  const here=FLT_PAGES[p]?.proc?FLT_PAGES[p].proc():null;
  // Pages without sections to hide don't show the button; the choice itself stays shared.
  pan.parentElement.style.display=here?'':'none';
  if(!here) return;
  const hereSet=new Set(here);
  let h=`<div class="sup-pan-hd"><span>Process · ALL flips a whole group</span><div>`+
    `<button class="sup-mini" onclick="fltSetAllProcesses('${p}',true)">All</button>`+
    `<button class="sup-mini" onclick="fltSetAllProcesses('${p}',false)">None</button></div></div>`;
  SUP_PROC_GROUPS.forEach(g=>{
    const items=SUP_PROCESSES.filter(o=>o.g===g);
    if(!items.length) return;
    const allOn=items.every(o=>fltProcOn(o.key));
    h+=`<div class="sup-grp"><div class="sup-grp-hd"><h4>${g}</h4><i></i></div><div class="sup-chips">`;
    h+=fltPill('All',allOn,`fltToggleProcGroup('${p}','${g}')`,{all:true,title:'Every '+g.toLowerCase()+' section'});
    items.forEach(o=>{ const na=!hereSet.has(o.key);
      h+=fltPill(o.n,fltProcOn(o.key),`fltToggleProc('${p}','${o.key}')`,{swatch:o.c,na,title:o.full+(na?' · not on this page':'')}); });
    h+=`</div></div>`;
  });
  pan.innerHTML=h;
}

function _fltRenderProdPanel(p){
  const pan=document.getElementById(`flt-${p}-pan-prod`); if(!pan) return;
  const v=window._flt;
  const scope=[...fltScopeProductIds([...(fltFacIdSet()||[])])];
  const catOf=pid=>DB.products.find(x=>x.id===pid)?.category||'';
  const famOf=pid=>PRODUCT_FAMILY_OF[catOf(pid)]||'';

  const fams=[...new Set(scope.map(famOf).filter(Boolean))]
    .sort((a,b)=>(PRODUCT_FAMILY_LABELS[a]||a).localeCompare(PRODUCT_FAMILY_LABELS[b]||b));
  // Each column is narrowed by the ones before it, so the cascade stays visible.
  let catIds=scope.slice();
  if((v.fams||[]).length) catIds=catIds.filter(id=>v.fams.includes(famOf(id)));
  const cats=[...new Set(catIds.map(catOf).filter(Boolean))]
    .sort((a,b)=>(SUP_CAT_LABELS[a]||a).localeCompare(SUP_CAT_LABELS[b]||b));
  let prodIds=catIds.slice();
  if((v.cats||[]).length) prodIds=prodIds.filter(id=>v.cats.includes(catOf(id)));
  const prods=prodIds.map(pid=>({pid,name:DB.products.find(pr=>pr.id===pid)?.name||pid}))
    .sort((a,b)=>a.name.localeCompare(b.name));

  // In the cascade an empty selection already means "the whole column", so each
  // column's ALL is lit exactly when nothing in it is picked.
  const col=(title,allOn,allFn,body)=>
    `<div><h4>${title}</h4><div class="sup-chips">`+
    fltPill('All',allOn,allFn,{all:true,title:'Every '+title.toLowerCase()})+body+`</div></div>`;

  let h=`<div class="sup-pan-hd"><span>Family → Category → Product · each column narrows the next</span>`+
    `<div><button class="sup-mini" onclick="fltClearProdFilters('${p}')">Clear</button></div></div><div class="sup-mill">`;
  h+=col('Family',!(v.fams||[]).length,`fltClearProdField('${p}','fams')`,
    fams.map(f=>fltPill(PRODUCT_FAMILY_LABELS[f]||f,(v.fams||[]).includes(f),`fltToggleProdField('${p}','fams','${f}')`)).join(''));
  h+=col('Category',!(v.cats||[]).length,`fltClearProdField('${p}','cats')`,
    cats.map(c=>fltPill(SUP_CAT_LABELS[c]||c,(v.cats||[]).includes(c),`fltToggleProdField('${p}','cats','${c}')`)).join(''));
  h+=col('Product',!(v.prodIds||[]).length,`fltClearProdField('${p}','prodIds')`,
    prods.map(o=>fltPill(o.name,(v.prodIds||[]).includes(o.pid),`fltToggleProdField('${p}','prodIds','${o.pid}')`)).join(''));
  h+=`</div>`;
  pan.innerHTML=h;
}

// Button faces + the token strip: the whole filter state, readable without opening
// anything — identical on every page except for the dates each page actually has.
function _fltRenderSummary(p){
  const v=window._flt;
  const facs=fltSubScopedFacilities();
  const subs=fltSubRegions();
  const nameOfFac=id=>DB.facilities.find(f=>f.id===id)?.name||id;
  const nameOfSub=id=>subs.find(s=>s.id===id)?.name||id;
  const nameOfProd=id=>DB.products.find(x=>x.id===id)?.name||id;

  const setBtn=(w,txt,on)=>{
    const b=document.getElementById(`flt-${p}-btn-${w}`); if(!b) return;
    b.classList.toggle('set',!!on);
    const s=b.querySelector('.v'); if(s) s.textContent=txt;
  };
  // Time frame: preset name + the dates this page shows; lit when it isn't the default.
  const tfKey=v.preset||FLT_TF_DEFAULT;
  const tfName=(FLT_TF_PRESETS.find(o=>o.k===tfKey)||{}).n||tfKey;
  const rg=fltGetDateRange(p);
  const rgOk=!!(rg.from&&rg.to&&rg.from<=rg.to);
  setBtn('tf', tfName+(rgOk?' · '+fltFmt(rg.from)+' → '+fltFmt(rg.to):' · no days here'), tfKey!==FLT_TF_DEFAULT);
  const nSub=(v.subIds||[]).length;
  setBtn('sub', nSub?nSub+' of '+subs.length:'All '+subs.length, nSub>0);
  const nFac=(v.facIds||[]).length;
  setBtn('fac', nFac?nFac+' of '+facs.length:'All '+facs.length, nFac>0);
  const nOff=(v.procHidden||[]).length;
  setBtn('proc', nOff?(SUP_PROCESSES.length-nOff)+' of '+SUP_PROCESSES.length:'All '+SUP_PROCESSES.length, nOff>0);
  const bits=[];
  if((v.fams||[]).length)    bits.push(v.fams.length+(v.fams.length>1?' fams':' fam'));
  if((v.cats||[]).length)    bits.push(v.cats.length+(v.cats.length>1?' cats':' cat'));
  if((v.prodIds||[]).length) bits.push(v.prodIds.length+(v.prodIds.length>1?' prods':' prod'));
  setBtn('prod', bits.length?bits.join(' · '):'All', bits.length>0);

  const strip=document.getElementById(`flt-${p}-toks`); if(!strip) return;
  const tok=(kind,label,val,fn)=>
    `<button type="button" class="sup-tok k-${kind}" title="Remove this filter" onclick="${fn}">`+
    `<span style="opacity:.6">${label}</span><b>${esc(val)}</b><span class="x">✕</span></button>`;
  let h=`<span class="lbl">Active</span>`, n=0;
  // The window always leads the strip. No ✕ — there is always a time frame; clicking opens it.
  let win='no days on this page';
  if(rgOk){
    const t=new Date(), today=t._ymd(), yday=new Date(t.getFullYear(),t.getMonth(),t.getDate()-1)._ymd();
    const nd=fltDaysIncl(rg.from,rg.to);
    const past=rg.from<today?fltDaysIncl(rg.from,rg.to<today?rg.to:yday):0;
    win=`${fltFmt(rg.from)} → ${fltFmt(rg.to)} · ${nd} days · ${past} past · ${nd-past} from today`;
  }
  h+=`<button type="button" class="sup-tok k-tf" title="Change the time frame" onclick="fltToggleDock(event,'${p}','tf')">`+
     `<span style="opacity:.6">Window</span><b>${esc(win)}</b></button>`;
  (v.subIds||[]).forEach(id=>{ n++; h+=tok('fac','Sub-region',nameOfSub(id),`fltToggleSub('${p}','${id}')`); });
  (v.facIds||[]).forEach(id=>{ n++; h+=tok('fac','Facility',nameOfFac(id),`fltToggleFac('${p}','${id}')`); });
  (v.procHidden||[]).forEach(k=>{ const o=SUP_PROCESSES.find(x=>x.key===k);
    n++; h+=tok('proc','Hidden',o?o.full:k,`fltToggleProc('${p}','${k}')`); });
  (v.fams||[]).forEach(f=>{ n++; h+=tok('prod','Family',PRODUCT_FAMILY_LABELS[f]||f,`fltToggleProdField('${p}','fams','${f}')`); });
  (v.cats||[]).forEach(c=>{ n++; h+=tok('prod','Category',SUP_CAT_LABELS[c]||c,`fltToggleProdField('${p}','cats','${c}')`); });
  (v.prodIds||[]).forEach(x=>{ n++; h+=tok('prod','Product',nameOfProd(x),`fltToggleProdField('${p}','prodIds','${x}')`); });
  if(!n) h+=`<span class="none">no other filters</span>`;
  strip.innerHTML=h;
}

// ── Panel open/close ───────────────────────────────────────────────────────
function fltCloseDock(){
  document.querySelectorAll('.sup-panel.open').forEach(x=>x.classList.remove('open'));
  document.querySelectorAll('.sup-drop-btn').forEach(b=>b.setAttribute('aria-expanded','false'));
}
function fltToggleDock(ev,p,which){
  if(ev) ev.stopPropagation();
  const pan=document.getElementById(`flt-${p}-pan-${which}`);
  const btn=document.getElementById(`flt-${p}-btn-${which}`);
  if(!pan||!btn) return;
  const wasOpen=pan.classList.contains('open');
  fltCloseDock();
  if(wasOpen) return;
  pan.classList.add('open');
  btn.setAttribute('aria-expanded','true');
  // Flip to right-aligned when the panel would run off the window.
  pan.classList.remove('flip');
  const r=pan.getBoundingClientRect();
  if(r.right>window.innerWidth-8) pan.classList.add('flip');
}
document.addEventListener('click',()=>fltCloseDock());
document.addEventListener('keydown',e=>{ if(e.key==='Escape') fltCloseDock(); });

// ── Click handlers ─────────────────────────────────────────────────────────
// Every one of these ends in fltChanged(p): save, then re-render the page the click came
// from. Other pages repaint from the same state when they are next opened.
function fltToggleSub(p,subId){
  const v=window._flt, a=(v.subIds||[]).slice();
  const i=a.indexOf(subId);
  if(i>=0) a.splice(i,1); else a.push(subId);
  v.subIds=a;
  fltNormalize();   // also drops facility picks outside the new sub-regions
  fltChanged(p);
}
function fltClearSubs(p){
  window._flt.subIds=[];
  fltNormalize();
  fltChanged(p);
}
function fltToggleFac(p,facId){
  _fltToggle('facIds',facId,fltSubScopedFacilities().map(f=>f.id));
  fltNormalize();
  fltChanged(p);
}
function fltToggleFacGroup(p,type){
  const v=window._flt, all=fltSubScopedFacilities();
  const ids=all.filter(f=>(f.type||'plant')===type).map(f=>f.id);
  const allOn=ids.every(id=>_fltHas('facIds',id));
  let a=(v.facIds||[]).slice();
  if(!a.length) a=all.map(f=>f.id);          // make "all" explicit before subtracting
  a=allOn ? a.filter(id=>!ids.includes(id))
          : a.concat(ids.filter(id=>!a.includes(id)));
  v.facIds=(a.length===all.length)?[]:a;
  fltNormalize();
  fltChanged(p);
}
function fltToggleProc(p,key){
  const v=window._flt, off=(v.procHidden||[]).slice();
  const i=off.indexOf(key);
  if(i>=0) off.splice(i,1); else off.push(key);
  v.procHidden=off;
  fltChanged(p);
}
function fltToggleProcGroup(p,g){
  const v=window._flt;
  const keys=SUP_PROCESSES.filter(o=>o.g===g).map(o=>o.key);
  const allOn=keys.every(fltProcOn);
  let off=(v.procHidden||[]).filter(k=>!keys.includes(k));
  if(allOn) off=off.concat(keys);
  v.procHidden=off;
  fltChanged(p);
}
function fltSetAllProcesses(p,on){
  window._flt.procHidden = on ? [] : SUP_PROCESSES.map(o=>o.key);
  fltChanged(p);
}
function fltToggleProdField(p,field,id){
  const v=window._flt, a=(v[field]||[]).slice();
  const i=a.indexOf(id);
  if(i>=0) a.splice(i,1); else a.push(id);
  v[field]=a;
  fltNormalize();
  fltChanged(p);
}
function fltClearProdField(p,field){
  window._flt[field]=[];
  fltNormalize();
  fltChanged(p);
}
// Clears the product cascade only — the other filters have their own controls.
function fltClearProdFilters(p){
  const v=window._flt; v.fams=[]; v.cats=[]; v.prodIds=[];
  fltChanged(p);
}
// Every filter except the time frame, plus any page-only controls the page names.
function fltClearAll(p){
  const v=window._flt;
  v.subIds=[]; v.facIds=[]; v.fams=[]; v.cats=[]; v.prodIds=[]; v.procHidden=[];
  FLT_PAGES[p]?.onClearAll?.();
  fltChanged(p);
}
function fltChanged(p){
  fltSave();
  FLT_PAGES[p]?.rerender?.();
}

// ── SUPPLY → PRODUCTION ─────────────────────────────────────────────────────
// The reference page: every Process key maps 1:1 onto a table section.
FLT_PAGES.sup={
  bounds:()=>fltSimBounds(),
  proc:()=>SUP_PROCESSES.map(o=>o.key),
  rerender:()=>renderSupplyView()
};

// CATALOGS
// ═══════════════════════════════════════════════════════
function openCatalog(cat){ S.activeCatalog=cat; switchView('catalog'); renderCatalogView(); }

function renderCatalogView(){
  const tabs=[
    {id:'products',label:'Products'},
    {id:'raw_materials',label:'Raw Materials'},
    {id:'fuels',label:'Fuels'}
  ];
  document.getElementById('cat-tabs').innerHTML=tabs.map(t=>
    `<div class="cat-tab ${S.activeCatalog===t.id?'active':''}" onclick="S.activeCatalog='${t.id}';renderCatalogView()">${t.label}</div>`
  ).join('');
  const cont=document.getElementById('cat-content'); if(!cont) return;
  if(S.activeCatalog==='products') cont.innerHTML=renderProductsCat();
  else if(S.activeCatalog==='raw_materials') cont.innerHTML=renderRawMatCat();
  else if(S.activeCatalog==='fuels') cont.innerHTML=renderFuelsCat();
}

// ── Products catalog: filter + sort state ────────────────────────────────────
// Filters mirror the Supply page vocabulary (Facility / Family / Category) so the two
// pages read the same way, plus a free-text search over name / code / description.
function _pcEnsureFilter(){
  if(!window._prodCatFilter) window._prodCatFilter={facKey:'',family:'',cat:'',q:''};
  return window._prodCatFilter;
}
function _pcOnChange(){
  const f=_pcEnsureFilter();
  f.facKey=document.getElementById('pc-fac-filter')?.value||'';
  f.family=document.getElementById('pc-fam-filter')?.value||'';
  f.cat=document.getElementById('pc-cat-filter')?.value||'';
  // Drop a category that no longer belongs to the chosen family.
  if(f.family&&f.cat&&PRODUCT_FAMILY_OF[f.cat]!==f.family) f.cat='';
  renderCatalogView();
}
// The whole table is re-rendered on each keystroke, so put the caret back where it was.
function _pcOnSearch(inp){
  _pcEnsureFilter().q=inp.value;
  renderCatalogView();
  const el=document.getElementById('pc-search');
  if(el){ el.focus(); el.setSelectionRange(el.value.length,el.value.length); }
}
function _pcClear(){ window._prodCatFilter={facKey:'',family:'',cat:'',q:''}; renderCatalogView(); }

function renderProductsCat(){
  const f=_pcEnsureFilter();
  const catColors2={cement_bulk:'var(--green)',cement_packed:'var(--blue)',clinker:'var(--orange)',raw_meal:'var(--yellow)',additive:'var(--pink)'};
  const catLabels2={cement_bulk:'Cement Bulk',cement_packed:'Cement Packed',clinker:'Clinker',raw_meal:'Raw Material',additive:'SCM'};
  const famOrder=Object.keys(FAM_DEFS);            // cement, scm, clinker, raw_meal — same order as the product form's chips
  const famOf=p=>PRODUCT_FAMILY_OF[p.category||'']||'';
  const catLabelOf=p=>catLabels2[p.category||'']||(p.category||'').replace(/_/g,' ');

  // Carry the ORIGINAL index — editProduct/deleteProduct address DB.products by position,
  // and this list is filtered and re-sorted.
  const all=DB.products.map((p,i)=>({p,i}));

  // ── Option lists — each narrowed by the pickers above it, so only combinations that
  //    actually exist can be picked.
  const facSeen=new Map(); let nUnassigned=0;
  all.forEach(({p})=>{ const k=prodFacKey(p); if(!k){ nUnassigned++; return; } if(!facSeen.has(k)) facSeen.set(k,prodFacName(p)); });
  const facList=[...facSeen.entries()].sort((a,b)=>a[1].localeCompare(b[1]));

  let famPool=all;
  if(f.facKey==='__none__') famPool=famPool.filter(({p})=>!prodFacKey(p));
  else if(f.facKey) famPool=famPool.filter(({p})=>prodFacKey(p)===f.facKey);
  const famList=[...new Set(famPool.map(({p})=>famOf(p)).filter(Boolean))]
    .sort((a,b)=>famOrder.indexOf(a)-famOrder.indexOf(b));

  let catPool=famPool;
  if(f.family) catPool=catPool.filter(({p})=>famOf(p)===f.family);
  const catList=[...new Set(catPool.map(({p})=>p.category||'').filter(Boolean))]
    .sort((a,b)=>(catLabels2[a]||a).localeCompare(catLabels2[b]||b));

  // ── Apply the filters ──
  const q=(f.q||'').trim().toLowerCase();
  const shown=all.filter(({p})=>{
    if(f.facKey==='__none__'){ if(prodFacKey(p)) return false; }
    else if(f.facKey && prodFacKey(p)!==f.facKey) return false;
    if(f.family && famOf(p)!==f.family) return false;
    if(f.cat && (p.category||'')!==f.cat) return false;
    if(q){
      const hay=`${p.name||''} ${p.material_code||''} ${p.description||''}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  // ── Sort: facility → family → category → name. Unassigned facilities sort last.
  //    Family uses the form's chip order (not alphabetical) so the two agree.
  const facSort=p=>{ const n=prodFacName(p); return n?n.toLowerCase():'￿'; };
  const famRank=p=>{ const r=famOrder.indexOf(famOf(p)); return r<0?99:r; };
  shown.sort((a,b)=>
       facSort(a.p).localeCompare(facSort(b.p))
    || famRank(a.p)-famRank(b.p)
    || catLabelOf(a.p).localeCompare(catLabelOf(b.p))
    || (a.p.name||'').localeCompare(b.p.name||''));

  const selStyle='padding:3px 8px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:9px';
  const lblStyle='font-family:var(--mono);font-size:8px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase';
  const isFiltered=!!(f.facKey||f.family||f.cat||q);

  let h=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim)">tables: products, recipes</div>
    <button class="tb-btn sec" onclick="showModal('product-modal')">+ New Product</button></div>

  <div style="background:var(--surface);border:1px solid var(--border);padding:6px 10px;margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <span style="${lblStyle}">Facility</span>
    <select id="pc-fac-filter" style="${selStyle}" onchange="_pcOnChange()">
      <option value="">All Facilities</option>
      ${facList.map(([k,n])=>`<option value="${esc(k)}"${k===f.facKey?' selected':''}>${esc(n)}</option>`).join('')}
      ${nUnassigned?`<option value="__none__"${f.facKey==='__none__'?' selected':''}>— Unassigned (${nUnassigned}) —</option>`:''}
    </select>
    <span style="${lblStyle}">Family</span>
    <select id="pc-fam-filter" style="${selStyle}" onchange="_pcOnChange()">
      <option value="">All Families</option>
      ${famList.map(x=>`<option value="${x}"${x===f.family?' selected':''}>${PRODUCT_FAMILY_LABELS[x]||x}</option>`).join('')}
    </select>
    <span style="${lblStyle}">Category</span>
    <select id="pc-cat-filter" style="${selStyle}" onchange="_pcOnChange()">
      <option value="">All Categories</option>
      ${catList.map(x=>`<option value="${x}"${x===f.cat?' selected':''}>${catLabels2[x]||x}</option>`).join('')}
    </select>
    <input id="pc-search" type="text" placeholder="Search name / code..." value="${esc(f.q||'')}"
      oninput="_pcOnSearch(this)" style="${selStyle};width:190px">
    <span style="font-family:var(--mono);font-size:9px;color:${isFiltered?'var(--green)':'var(--text-dim)'};margin-left:auto">
      ${shown.length}${shown.length!==all.length?` of ${all.length}`:''} product${all.length===1?'':'s'}
    </span>
    ${isFiltered?`<button class="tb-btn sec" style="font-size:9px;padding:3px 10px" onclick="_pcClear()">✕ Clear</button>`:''}
  </div>

  <table class="cat-table"><thead><tr>
    <th>Name</th><th>Material Code</th><th>Facility</th><th>Family</th><th>Category</th><th>Recipe (ingredients)</th><th></th>
  </tr></thead><tbody>`;

  if(!shown.length){
    h+=`<tr><td colspan="7" style="text-align:center;color:var(--text-dim);font-size:9px;padding:22px">
      ${all.length?'No products match these filters.':'No products yet — use + New Product to add one.'}
    </td></tr>`;
    return h+`</tbody></table>`;
  }

  let prevFac=null;
  shown.forEach(({p,i})=>{
    const cat=p.category||'cement_bulk';
    const catColor=catColors2[cat]||'var(--text-dim)';
    const catLabel=(catLabels2[cat]||cat.replace(/_/g,' '))+(cat==='additive'&&p.scm_type?` — ${p.scm_type[0].toUpperCase()}${p.scm_type.slice(1)}`:'');
    const fam=famOf(p), famDef=FAM_DEFS[fam];
    const facName=prodFacName(p);
    // A typed facility isn't in the topology — mark it so the distinction stays visible here.
    const isLabel=!p.facility_id&&!!p.facility_label;
    const recipe=DB.recipes.filter(r=>r.product_id===p.id).map(r=>{
      // Show ingredient name — could be raw material or another product
      const mat=DB.raw_materials.find(m=>m.id===r.material_id);
      const prod=DB.products.find(x=>x.id===r.material_id);
      const name=mat?.name||prod?.name||r.material_id;
      return `<span class="recipe-chip">${esc(name)} ${r.pct}%</span>`;
    }).join('');
    // Thicker rule where the facility changes — makes the facility sort visible without
    // spending a whole row on a group header.
    const facKey=prodFacKey(p);
    const newGrp=prevFac!==null&&facKey!==prevFac;
    prevFac=facKey;
    h+=`<tr${newGrp?' style="border-top:2px solid var(--border2)"':''}>
      <td style="color:var(--green);font-weight:700">${esc(p.name)}</td>
      <td style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">${esc(p.material_code||'—')}</td>
      <td style="font-family:var(--mono);font-size:9px;color:${facName?'var(--text)':'var(--text-dim)'}">${facName?esc(facName):'—'}${isLabel?`<span title="Typed by hand — not a facility in the topology" style="color:var(--amber);font-size:8px;margin-left:4px">○</span>`:''}</td>
      <td>${famDef?`<span style="font-family:var(--mono);font-size:8px;padding:2px 7px;border:1px solid ${famDef.color};color:${famDef.color}">${famDef.label}</span>`:'<span style="color:var(--text-dim);font-size:9px">—</span>'}</td>
      <td><span style="font-family:var(--mono);font-size:8px;padding:2px 7px;border:1px solid ${catColor};color:${catColor}">${catLabel}</span></td>
      <td><div class="recipe-list">${recipe||'<span style="color:var(--text-dim);font-size:9px">no recipe — kiln product</span>'}</div></td>
      <td>
        <span class="tbl-act" onclick="editProduct(${i})">Edit</span>
        <span class="tbl-act del" onclick="deleteProduct(${i})">Del</span>
      </td>
    </tr>`;
  });
  return h+`</tbody></table>`;
}

function renderRawMatCat(){
  let h=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim)">table: raw_materials</div>
    <button class="tb-btn sec" onclick="showModal('rawmat-modal')">+ New Material</button></div>
  <table class="cat-table"><thead><tr><th>ID</th><th>Name</th><th>Unit</th><th>Notes</th><th></th></tr></thead><tbody>`;
  DB.raw_materials.forEach((m,i)=>{
    h+=`<tr><td style="color:var(--text-dim)">${m.id}</td><td>${esc(m.name)}</td>
      <td><span class="fac-badge badge-amber">${m.unit}</span></td>
      <td style="color:var(--text-dim)">${m.notes||'—'}</td>
      <td><span class="tbl-act del" onclick="deleteRawMat(${i})">Del</span></td></tr>`;
  });
  return h+`</tbody></table>`;
}

function renderFuelsCat(){
  let h=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim)">table: fuels</div>
    <button class="tb-btn sec" onclick="showModal('fuel-modal')">+ New Fuel</button></div>
  <table class="cat-table"><thead><tr><th>ID</th><th>Name</th><th>Unit</th><th>kCal/kg</th><th>CO₂ factor</th><th>Notes</th><th></th></tr></thead><tbody>`;
  DB.fuels.forEach((f,i)=>{
    h+=`<tr><td style="color:var(--text-dim)">${f.id}</td><td>${f.name}</td>
      <td><span class="fac-badge badge-red">${f.unit}</span></td>
      <td style="font-family:var(--mono)">${f.calorific_value||'—'}</td>
      <td style="font-family:var(--mono)">${f.co2_factor||'—'}</td>
      <td style="color:var(--text-dim)">${f.notes||'—'}</td>
      <td><span class="tbl-act del" onclick="deleteFuel(${i})">Del</span></td></tr>`;
  });
  return h+`</tbody></table>`;
}

function editProduct(idx){ S._editProductIdx=idx; openProductModal(DB.products[idx]); }
function deleteProduct(i){ if(confirm('Delete?')){ DB.products.splice(i,1); autoSave(); renderCatalogView(); } }
function deleteRawMat(i){ if(confirm('Delete?')){ DB.raw_materials.splice(i,1); autoSave(); renderCatalogView(); } }
function deleteFuel(i){ if(confirm('Delete?')){ DB.fuels.splice(i,1); autoSave(); renderCatalogView(); } }

// Family → Category picker for the New/Edit Product form. Family is the coarse
// grouping (matches PRODUCT_FAMILY_OF); each family offers the specific
// categories a product can be saved as. SCM's two options both save
// category:'additive' (unchanged — see getProductFamily) plus a scm_type of
// 'slag'/'ash' so existing category==='additive' checks keep working untouched.
const FAM_DEFS={
  cement:  {label:'Cement',   color:'var(--green)', cats:[{cat:'cement_bulk',  sub:'', label:'Bulk'},{cat:'cement_packed', sub:'', label:'Bagged'}]},
  scm:     {label:'SCM',      color:'var(--pink)',       cats:[{cat:'additive',    sub:'slag', label:'Slag'},{cat:'additive', sub:'ash', label:'Ash'}]},
  clinker: {label:'Clinker',  color:'var(--orange)',       cats:[{cat:'clinker',     sub:'', label:'Clinker'}]},
  raw_meal:{label:'Raw Meal', color:'var(--yellow)',       cats:[{cat:'raw_meal',    sub:'', label:'Raw Meal'}]}
};
function _pmCatChipsHtml(fam, curCat, curSub){
  const def=FAM_DEFS[fam]; if(!def) return '';
  return def.cats.map(c=>{
    const active=curCat===c.cat && (curSub||'')===(c.sub||'');
    return `<div onclick="_pmSelectCat('${fam}','${c.cat}','${c.sub||''}')"
      class="cat-chip${active?' active':''}"
      style="padding:4px 10px;font-family:var(--mono);font-size:9px;cursor:pointer;border:1px solid ${active?def.color:'var(--border2)'};color:${active?def.color:'var(--text-dim)'};background:${active?'var(--chip-on)':'var(--surface2)'};transition:all .15s">
      ${c.label}
    </div>`;
  }).join('');
}
function _pmSelectFamily(fam){
  const def=FAM_DEFS[fam]; if(!def) return;
  document.getElementById('pm-fam').value=fam;
  document.querySelectorAll('.fam-chip').forEach(x=>x.classList.remove('active'));
  const btn=document.getElementById('fam-chip-'+fam); if(btn) btn.classList.add('active');
  document.querySelectorAll('.fam-chip').forEach(x=>{
    const f=x.id.replace('fam-chip-','');
    x.style.border='1px solid '+(f===fam?FAM_DEFS[f].color:'var(--border2)');
    x.style.color=f===fam?FAM_DEFS[f].color:'var(--text-dim)';
    x.style.background=f===fam?'var(--chip-on)':'var(--surface2)';
  });
  // Keep the current category if it already belongs to the new family, else default to its first
  const curCat=document.getElementById('pm-cat').value, curSub=document.getElementById('pm-scmtype').value;
  const stillValid=def.cats.some(c=>c.cat===curCat && (c.sub||'')===(curSub||''));
  const first=def.cats[0];
  const useCat=stillValid?curCat:first.cat, useSub=stillValid?curSub:(first.sub||'');
  document.getElementById('pm-cat').value=useCat;
  document.getElementById('pm-scmtype').value=useSub;
  const wrap=document.getElementById('pm-cat-chips-wrap');
  if(wrap) wrap.innerHTML=_pmCatChipsHtml(fam,useCat,useSub);
}
function _pmSelectCat(fam,cat,sub){
  document.getElementById('pm-cat').value=cat;
  document.getElementById('pm-scmtype').value=sub||'';
  const wrap=document.getElementById('pm-cat-chips-wrap');
  if(wrap) wrap.innerHTML=_pmCatChipsHtml(fam,cat,sub);
}

// Display name for a product's facility — the topology facility it points at, else the
// free-text label the user typed, else ''. Everything that shows/filters/sorts products by
// facility goes through this pair so the two kinds of assignment behave identically.
function prodFacName(p){
  if(p&&p.facility_id){ const f=(DB.facilities||[]).find(x=>x.id===p.facility_id); if(f) return f.name; return p.facility_id; }
  return (p&&p.facility_label)||'';
}
// Stable key for grouping/filtering. Typed labels are prefixed '~' so they can never
// collide with a real facility id.
function prodFacKey(p){ return (p&&p.facility_id)||((p&&p.facility_label)?'~'+p.facility_label:''); }

// Facility <option>s for the product form. Plants first, then terminals (a terminal can
// pack/blend), then any facility names typed on OTHER products — so a name typed once is
// reusable from the dropdown instead of being retyped — then the "new facility" escape hatch.
function _pmFacOpts(sel, selLabel){
  const grp=(type,label)=>{
    const fs=(DB.facilities||[]).filter(f=>f.type===type).sort((a,b)=>a.name.localeCompare(b.name));
    if(!fs.length) return '';
    return `<optgroup label="${label}">`+fs.map(f=>
      `<option value="${f.id}"${f.id===sel?' selected':''}>${esc(f.name)}</option>`).join('')+`</optgroup>`;
  };
  const labels=[...new Set((DB.products||[]).map(p=>p.facility_label).filter(Boolean))];
  if(selLabel&&!labels.includes(selLabel)) labels.push(selLabel);
  labels.sort((a,b)=>a.localeCompare(b));
  const custom=labels.length
    ? `<optgroup label="Not in topology">`+labels.map(n=>
        `<option value="~${esc(n)}"${n===selLabel?' selected':''}>${esc(n)}</option>`).join('')+`</optgroup>`
    : '';
  return `<option value=""${(!sel&&!selLabel)?' selected':''}>-- Not assigned --</option>`
    +grp('plant','Plants')+grp('terminal','Terminals')+custom
    +`<option value="__new__">+ New facility\u2026</option>`;
}
// "+ New facility" swaps the select for a text box; picking anything else puts it back.
function _pmFacOnChange(){
  const sel=document.getElementById('pm-fac'), wrap=document.getElementById('pm-fac-new-wrap');
  if(!sel||!wrap) return;
  const isNew=sel.value==='__new__';
  wrap.style.display=isNew?'flex':'none';
  if(isNew){ const inp=document.getElementById('pm-fac-new'); if(inp){ inp.focus(); inp.select(); } }
}
function _pmFacCancelNew(){
  const sel=document.getElementById('pm-fac'); if(sel) sel.value='';
  const inp=document.getElementById('pm-fac-new'); if(inp) inp.value='';
  _pmFacOnChange();
}

function openProductModal(p){
  const recipe=p?DB.recipes.filter(r=>r.product_id===p.id):[];
  S._ingCount=recipe.length||1;

  // Ingredients: raw materials + other products (e.g. clinker product in cement recipe)
  const mkIngOpts=(selId)=>{
    let o='<option value="">-- Ingredient --</option>';
    o+=`<optgroup label="Raw Materials">`;
    DB.raw_materials.forEach(m=>o+=`<option value="${m.id}" ${selId===m.id?'selected':''}>${esc(m.name)}</option>`);
    o+=`</optgroup><optgroup label="Products (intermediate)">`;
    DB.products.filter(x=>x.id!==(p?.id)).forEach(x=>
      o+=`<option value="${x.id}" ${selId===x.id?'selected':''}>${x.name}</option>`);
    o+=`</optgroup>`;
    return o;
  };

  let ingRows='';
  (recipe.length?recipe:[{material_id:'',pct:0}]).forEach((r,i)=>{
    ingRows+=`<div class="ing-row" id="ing-row-${i}">
      <select class="fi" id="ing-mat-${i}">${mkIngOpts(r.material_id)}</select>
      <input class="fi" type="number" id="ing-pct-${i}" value="${r.pct}" placeholder="%" onchange="updateIngTotal()">
      <span style="color:var(--red);cursor:pointer;font-size:12px" onclick="this.parentElement.remove();updateIngTotal()">✕</span>
    </div>`;
  });

  const curCat=p?.category||'cement_bulk';
  const curSub=(curCat==='additive'?(p?.scm_type||'slag'):'');
  const curFam=PRODUCT_FAMILY_OF[curCat]||'cement';

  showModalContent(`
    <div class="modal-hdr"><span class="modal-title">${p?'Edit':'New'} Product</span><span class="modal-close" onclick="closeModal()">✕</span></div>
    <div class="modal-body">
      <div class="fr">
        <div class="ff"><div class="fl">Name</div><input class="fi" id="pm-name" value="${p?.name||''}" placeholder="e.g. BRS IL(K1)/CLK"></div>
        <div class="ff"><div class="fl">SAP Material Code(s)</div><input class="fi" id="pm-code" value="${p?.material_code||''}" placeholder="e.g. 4802-000000000001638064 or 1638064, 1638065">
          <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:3px">
            Demand Mapping places SAP sales on this product by these codes, and real production imports read them too. One product can carry several: separate them with commas. Left blank, its sales cannot be imported.
          </div></div>
      </div>
      <div class="fr">
        <div class="ff"><div class="fl">Description</div><input class="fi" id="pm-desc" value="${p?.description||''}"></div>
        <div class="ff"><div class="fl">Made At (Facility)</div>
          <select class="fi" id="pm-fac" onchange="_pmFacOnChange()">${_pmFacOpts(p?.facility_id||'', p?.facility_label||'')}</select>
          <div id="pm-fac-new-wrap" style="display:none;gap:4px;align-items:center;margin-top:4px">
            <input class="fi" id="pm-fac-new" style="flex:1" placeholder="Type the facility name"
              value="${esc(p?.facility_label||'')}">
            <span onclick="_pmFacCancelNew()" title="Back to the list"
              style="color:var(--red);cursor:pointer;font-size:12px;padding:0 4px">\u2715</span>
          </div>
          <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:3px">
            Where this product is produced. Feeds the Supply page Facility filter.
            Not in the topology yet? Pick <span style="color:var(--text)">+ New facility</span> and type it.
          </div>
        </div>
      </div>
      <div class="fr s1"><div class="ff"><div class="fl">Family</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">
          ${Object.keys(FAM_DEFS).map(f=>`
            <div id="fam-chip-${f}" onclick="_pmSelectFamily('${f}')"
              class="cat-chip fam-chip${curFam===f?' active':''}"
              style="padding:4px 10px;font-family:var(--mono);font-size:9px;cursor:pointer;border:1px solid ${curFam===f?FAM_DEFS[f].color:'var(--border2)'};color:${curFam===f?FAM_DEFS[f].color:'var(--text-dim)'};background:${curFam===f?'var(--chip-on)':'var(--surface2)'};transition:all .15s">
              ${FAM_DEFS[f].label}
            </div>`).join('')}
          <input type="hidden" id="pm-fam" value="${curFam}">
        </div>
      </div></div>
      <div class="fr s1"><div class="ff"><div class="fl">Category</div>
        <div id="pm-cat-chips-wrap" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${_pmCatChipsHtml(curFam,curCat,curSub)}</div>
        <input type="hidden" id="pm-cat" value="${curCat}">
        <input type="hidden" id="pm-scmtype" value="${curSub}">
        <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:4px">
          Category determines silo color and which production element creates this product
        </div>
      </div></div>
      <div class="modal-sec-title">Recipe — table: recipes</div>
      <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-bottom:6px">
        For cement: list clinker product + additives. For clinker: leave empty (kiln parameters define production).
      </div>
      <div id="ing-rows-wrap">${ingRows}</div>
      <div class="ing-total" id="ing-total">Total: 0%</div>
      <button class="add-btn" style="margin-bottom:10px" onclick="addIngRow()">+ Add Ingredient</button>
    </div>
    <div class="modal-footer"><button class="btn-sec" onclick="closeModal()">Cancel</button>
      <button class="btn-pri" onclick="saveProduct()">Save Product</button></div>`);
  S._mkIngOpts=mkIngOpts;
  updateIngTotal();
}

function addIngRow(){
  const i=S._ingCount++;
  const wrap=document.getElementById('ing-rows-wrap'); if(!wrap) return;
  const row=document.createElement('div'); row.className='ing-row'; row.id=`ing-row-${i}`;
  row.innerHTML=`<select class="fi" id="ing-mat-${i}">${S._mkIngOpts?S._mkIngOpts(''):''}</select>
    <input class="fi" type="number" id="ing-pct-${i}" value="0" placeholder="%" onchange="updateIngTotal()">
    <span style="color:var(--red);cursor:pointer;font-size:12px" onclick="this.parentElement.remove();updateIngTotal()">✕</span>`;
  wrap.appendChild(row);
}

function updateIngTotal(){
  let t=0; document.querySelectorAll('[id^="ing-pct-"]').forEach(i=>t+=parseFloat(i.value)||0);
  const el=document.getElementById('ing-total');
  if(el){el.textContent=`Total: ${t.toFixed(1)}%`;el.style.color=Math.abs(t-100)<.1?'var(--green)':'var(--amber)';}
}

function saveProduct(){
  const name=document.getElementById('pm-name')?.value?.trim(); if(!name) return;
  const material_code=_xlCodeList(document.getElementById('pm-code')?.value).join(', ');
  const desc=document.getElementById('pm-desc')?.value||'';
  const category=document.getElementById('pm-cat')?.value||'cement_bulk';
  const scm_type=document.getElementById('pm-scmtype')?.value||'';
  // Generate stable id from name. An edit keeps the id it has: silos, demand points and packing
  // lines point at it, so a rename must not cut them off.
  const pid=S._editProductIdx!=null?DB.products[S._editProductIdx].id
    :name.toLowerCase().replace(/[\s\/\(\)\-]+/g,'_').replace(/__+/g,'_').replace(/^_|_$/g,'');
  // Facility: a topology facility id, a reused typed label ('~name'), or a freshly typed
  // name. A typed name that matches an existing facility resolves to that facility rather
  // than becoming a duplicate label.
  const facSel=document.getElementById('pm-fac')?.value||'';
  let facility_id='', facility_label='';
  if(facSel==='__new__'){
    const typed=(document.getElementById('pm-fac-new')?.value||'').trim();
    if(typed){
      const match=(DB.facilities||[]).find(f=>(f.name||'').toLowerCase()===typed.toLowerCase());
      if(match) facility_id=match.id; else facility_label=typed;
    }
  } else if(facSel.startsWith('~')) facility_label=facSel.slice(1);
  else facility_id=facSel;

  const prod={id:pid, name, description:desc, material_code, category};
  if(facility_id) prod.facility_id=facility_id;
  if(facility_label) prod.facility_label=facility_label;
  if(category==='additive' && scm_type) prod.scm_type=scm_type;

  if(S._editProductIdx!=null){
    DB.products[S._editProductIdx]=prod;
    DB.recipes=DB.recipes.filter(r=>r.product_id!==pid);
    S._editProductIdx=null;
  } else {
    if(DB.products.find(p=>p.id===pid)){
      alert(`A product with id "${pid}" already exists. Use a different name.`);
      return;
    }
    DB.products.push(prod);
  }
  // Save recipes
  let ri=0;
  document.querySelectorAll('[id^="ing-mat-"]').forEach((sel,i)=>{
    const pct=parseFloat(document.getElementById(`ing-pct-${i}`)?.value)||0;
    if(sel.value&&pct>0) DB.recipes.push({id:`r_${Date.now()}_${ri++}`,product_id:pid,material_id:sel.value,pct});
  });
  autoSave(); closeModal(); renderCatalogView();
  // Demand Mapping reads the catalog's SAP code: refresh it if it is on screen, and say
  // so at save time when the code is missing — not weeks later when sales go unplaced.
  if(document.getElementById('cfg-panel-demandmap')?.offsetParent&&typeof xlmapRender==='function') xlmapRender();
  if(typeof _xlRulesChanged==='function') _xlRulesChanged();
  statMsg(material_code?'Product saved':'Product saved — no SAP material code, so Demand Mapping cannot place its sales yet');
}


