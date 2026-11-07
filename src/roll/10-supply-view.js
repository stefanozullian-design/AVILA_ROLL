// ═══════════════════════════════════════════════════════
// SUPPLY / PRODUCTION VIEW
// ═══════════════════════════════════════════════════════
function renderSupplyView(){
  if(!_IDX.depth) return _idxRun(()=>renderSupplyView.apply(this,arguments)); // fast lookups for this whole block
  const wrap=document.getElementById('supply-table-wrap'); if(!wrap) return;
  fltRender('sup');
  _supSyncInvModeBtn();
  _supSyncInvHideBtn();
  _renderSupCampaignWarnings();
  _renderSupplyViewInner(wrap);
}
// Collapsible supply-table sections — hides a section's child rows via CSS
// (no re-render). Each section header has class sup-sec-hdr + data-seckey; each
// child row has class supsec-<key>.
function _supApplySecStyle(){
  if(!window._supSecCol) window._supSecCol=new Set();
  let st=document.getElementById('sup-sec-style');
  if(!st){ st=document.createElement('style'); st.id='sup-sec-style'; document.head.appendChild(st); }
  // Collapsed = child rows hidden, header still there to click.
  let css=[...window._supSecCol].map(k=>`.supsec-${k}{display:none!important}`).join('');
  // Filtered out by the Process filter = the header goes too. Same class hooks the
  // render already emits, so no section-rendering code has to know about this.
  css+=(window._flt?.procHidden||[]).map(k=>
    `.supsec-${k},.sup-sec-hdr[data-seckey="${k}"]{display:none!important}`).join('');
  st.textContent=css;
}
function _supToggleSec(key){
  if(!window._supSecCol) window._supSecCol=new Set();
  if(window._supSecCol.has(key)) window._supSecCol.delete(key); else window._supSecCol.add(key);
  _supApplySecStyle();
  const collapsed=window._supSecCol.has(key);
  document.querySelectorAll(`.sup-sec-hdr[data-seckey="${key}"] .sup-arrow`).forEach(a=>a.textContent=collapsed?'▶':'▼');
}
function _supSecArrow(key){ return (window._supSecCol&&window._supSecCol.has(key))?'▶':'▼'; }

// ── Inventory bar charts: VOLUME (tonnes) or DAYS of inventory ───────────────────
// One page-wide choice for every inventory chart (plant cement, packed, clinker and the
// terminal blocks all come from _invChartRow), remembered across sessions like the filter
// picks. Days of inventory = stock ÷ average demand over the next 14 days — the number the
// charts already print on each bar, so the two modes just swap which of the pair sets the
// bar height and which is printed. The days axis is FIXED (not per chart) so every chart on
// the page reads on one scale and a bar can be compared with the one below it; a bar past
// the cap is drawn full height with a light top (see _invChartRow).
const INV_DAYS_CAP=30;
const INV_MODE_KEY='avila_inv_chart_mode';
function _supInvMode(){
  if(window._supInvChartMode===undefined){
    let v=null; try{ v=localStorage.getItem(INV_MODE_KEY); }catch(e){}
    window._supInvChartMode=v==='days'?'days':'vol';
  }
  return window._supInvChartMode;
}
function _supToggleInvMode(){
  window._supInvChartMode=_supInvMode()==='days'?'vol':'days';
  try{ localStorage.setItem(INV_MODE_KEY,window._supInvChartMode); }catch(e){}
  renderSupplyView();
}
function _supSyncInvModeBtn(){
  const b=document.getElementById('sup-inv-mode-btn'); if(!b) return;
  const days=_supInvMode()==='days';
  const v=b.querySelector('.v'); if(v) v.textContent=days?'Days':'Volume';
  b.classList.toggle('set',days);   // non-default state reads like an active filter
  b.title=days
    ?`Inventory charts show DAYS of inventory — stock ÷ average demand over the next 14 days, on a 0–${INV_DAYS_CAP} day scale. Click for tonnes.`
    :'Inventory charts show VOLUME in tonnes. Click for days of inventory.';
}
// ── Inventory bar charts: SHOWN or HIDDEN ────────────────────────────────────────
// A per-viewer convenience like the Volume/Days choice: the chart rows are still rendered
// (they carry the silo colour squares and the Volume/Days choice), a body class folds them
// away with CSS so the toggle needs no re-render. Remembered in localStorage, never in the
// scenario.
const INV_HIDE_KEY='avila_inv_charts_hidden';
function _supInvHidden(){
  if(window._supInvHide===undefined){
    let v=null; try{ v=localStorage.getItem(INV_HIDE_KEY); }catch(e){}
    window._supInvHide=v==='1';
  }
  return window._supInvHide;
}
function _supToggleInvCharts(){
  window._supInvHide=!_supInvHidden();
  try{ localStorage.setItem(INV_HIDE_KEY,window._supInvHide?'1':'0'); }catch(e){}
  _supSyncInvHideBtn();
}
function _supSyncInvHideBtn(){
  const hidden=_supInvHidden();
  document.body.classList.toggle('sup-hide-inv-charts',hidden);
  const b=document.getElementById('sup-inv-hide-btn'); if(!b) return;
  const v=b.querySelector('.v'); if(v) v.textContent=hidden?'Hidden':'Shown';
  b.classList.toggle('set',hidden);   // non-default state reads like an active filter
  b.title=hidden
    ?"The inventory bar charts are hidden. Click to show them above each block's silo rows."
    :"The inventory bar charts are shown above each block's silo rows. Click to hide them and give the table more room.";
}
document.addEventListener('DOMContentLoaded',_supSyncInvHideBtn);
if(document.readyState!=='loading') setTimeout(_supSyncInvHideBtn,0);
// Compact tonnes for the 6px number on a bar: 38k · 5.0k · 655
function _tAbbrev(v){ v=Math.round(v); return v>=10000?Math.round(v/1000)+'k':v>=1000?(v/1000).toFixed(1)+'k':String(v); }
// Number.prototype.toLocaleString builds an Intl formatter on every call (~30 µs); a year view of the
// Supply page formats ~50k numbers per render. Same output, one Intl call per distinct value.
const _fmtIntCache=new Map();
function _fmtInt(n){
  if(Object.is(n,-0)) return n.toLocaleString();   // Map would fold -0 into 0
  let s=_fmtIntCache.get(n);
  if(s===undefined){ if(_fmtIntCache.size>60000) _fmtIntCache.clear(); s=n.toLocaleString(); _fmtIntCache.set(n,s); }
  return s;
}

// ── Nested demand-point rows under a Supply-page product-requirement row ──────────
// The same demand points (e.g. .../INT, /EXT, /IND) that feed a product row's
// totalNeed()/pkDemand() aggregate, exposed directly beneath it with the Demand
// page's own editable cells + Forecast Builder (_demCellHtml/openSpForecastBuilder)
// so a user forecasting demand never has to leave Supply. Reuses the generic
// _supSecCol/_supToggleSec/_supSecArrow collapse mechanism every other Supply
// section already uses; seeded collapsed the first time each key is seen (mirrors
// _supSecDefaultApplied), so a user's later toggle sticks across re-renders.
function _supDpnKey(base){ return 'dpn_'+String(base).replace(/\W/g,'_'); }
function _supDpnArrow(base, count){
  const key=_supDpnKey(base);
  if(!window._supDpnSeeded) window._supDpnSeeded=new Set();
  if(!window._supDpnSeeded.has(key)){
    window._supDpnSeeded.add(key);
    if(!window._supSecCol) window._supSecCol=new Set();
    window._supSecCol.add(key); // start collapsed
  }
  const nExtra=arguments.length>2?(arguments[2]||0):0;
  const tip=`${count} demand point${count===1?'':'s'}`+(nExtra?` + ${nExtra} other requirement component${nExtra===1?'':'s'} (e.g. rail loading)`:'')+' — click to show/hide';
  return `<span class="sup-arrow" onclick="event.stopPropagation();_supToggleSec('${key}')" style="cursor:pointer;margin-left:6px;opacity:.55;font-size:8px" title="${tip}">${_supSecArrow(key)} ${count+nExtra}</span>`;
}
// `extra` — optional non-demand-point components of the parent's requirement, as
// [{label, color, valFn(ds)}]. The plant CEMENT block's total is "direct demand +
// rail loading" (see SECTION 1), so without a row for the rail part the children
// visibly fail to add up to the parent on any day cars were loaded. These render
// read-only (they're derived from the rail plan/simulation, not typed here).
// The product a demand point asks for first — the same order the simulation pulls in. A point
// listing several counts once, under this one, so a Supply requirement never counts it twice.
// None set: like the simulation, it takes what the first silo feeding it holds.
function _dpFirstProd(dp){
  const set=(dp?.products||[]).filter(p=>p.product_id).slice().sort((a,b)=>a.priority-b.priority)[0]?.product_id;
  if(set||!dp?.element_id) return set||null;
  const seen=new Set([dp.element_id]), queue=[dp.element_id];
  while(queue.length){
    const id=queue.shift();
    for(const c of DB.connections){
      if(c.to_element_id!==id||seen.has(c.from_element_id)) continue;
      seen.add(c.from_element_id);
      const up=DB.elements.find(e=>e.id===c.from_element_id); if(!up) continue;
      if(up.type==='bulk_silo'||up.type==='packed_silo'){ const p=getSiloProducts(up)[0]; if(p) return p; }
      else queue.push(up.id);
    }
  }
  return null;
}
// A product's recipe as the simulation reads it: first row per material, zero rows out. A row
// saved twice must not double what a product draws.
function _recipeRows(pid){ const seen=new Set(); return DB.recipes.filter(rc=>{ if(rc.product_id!==pid||!(parseFloat(rc.pct)>0)||seen.has(rc.material_id)) return false; seen.add(rc.material_id); return true; }); }
// Marks a row kept on the Supply page although its element is inactive.
function _supInactTag(el){ return el?.is_active===false?`<span title="Marked inactive, but the simulation still runs it" style="color:var(--amber);font-size:7px;letter-spacing:.5px;margin-left:4px">INACTIVE</span>`:''; }
// `sec` — the section (cementNeed, packedNeed, …) the parent product row belongs to. The
// breakdown rows carry its class too, so folding the section title hides them along with the
// product row they hang off (before, an expanded breakdown stayed on screen under a folded
// title — orphan ↳ lines with no parent to toggle them). sup-dpn-row keeps them out of the
// title's real/forecast roll-up (_supMarkHeaderSource), which reads the product rows.
function _supDpnRows(dpts, months, collapsedMonths, tdSty, depth, base, stickyLeft, extra, sec){
  if((!dpts||!dpts.length)&&(!extra||!extra.length)) return '';
  const key=_supDpnKey(base);
  const cls=`supsec-${key} sup-dpn-row${sec?' supsec-'+sec:''}`;
  let hh='';
  (dpts||[]).forEach(dp=>{
    const el=DB.elements.find(e=>e.id===dp.element_id); if(!el) return;
    hh+=`<tr class="${cls}" style="background:rgba(var(--hi-rgb),.02)">
      <td style="${stickyLeft('var(--surface)',depth,'border-bottom:1px solid var(--border),')}color:var(--text-dim);font-size:8px;font-style:italic">
        ↳ ${esc(el.name)}${_supInactTag(el)}<button class="sp-fb-btn" onclick="event.stopPropagation();openSpForecastBuilder(${JSON.stringify([el.id]).replaceAll('"','&quot;')},${JSON.stringify(el.name).replaceAll('"','&quot;')})" title="⚙ Forecast Builder">⚙</button>
      </td>`;
    months.forEach(mon=>{
      const isCol=collapsedMonths.has(mon.ym);
      const mt=mon.dates.reduce((s,ds)=>s+(_demandRate(el.id,ds)||0),0);
      hh+=`<td style="border-left:2px solid rgba(var(--hi-rgb),.05);font-size:8px;color:var(--text-dim);text-align:right;padding:3px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
      // 'sup-day-' — these rows live in the Supply table, so their day cells must carry the
      // prefix _monthTotalsToEnd(wrap,'sup-day-',false) looks for, or the month-total cell is
      // left at the front of the row and every value shifts one column right (off-by-one date).
      if(!isCol) mon.dates.forEach(ds=>{ hh+=_demCellHtml(el, ds, mon.ym, tdSty(ds), 'sup-day-'); });
    });
    hh+=`</tr>`;
  });
  (extra||[]).forEach(ex=>{
    hh+=`<tr class="${cls}" style="background:rgba(var(--hi-rgb),.02)">
      <td title="${ex.title||''}" style="${stickyLeft('var(--surface)',depth,'border-bottom:1px solid var(--border),')}color:${ex.color};font-size:8px;font-style:italic">↳ ${ex.label}</td>`;
    months.forEach(mon=>{
      const isCol=collapsedMonths.has(mon.ym);
      const mt=mon.dates.reduce((s,ds)=>s+(ex.valFn(ds)||0),0);
      hh+=`<td style="border-left:2px solid rgba(var(--hi-rgb),.05);font-size:8px;color:${ex.color};text-align:right;padding:3px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
      if(!isCol) mon.dates.forEach(ds=>{ const v=ex.valFn(ds)||0;
        hh+=`<td class="sup-day-${mon.ym} ${ex.srcFn?ex.srcFn(ds,v):''}" style="font-size:8px;color:${ex.color};text-align:right;padding:3px 4px;border-bottom:1px solid var(--border);${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):''}</td>`; });
    });
    hh+=`</tr>`;
  });
  return hh;
}

// ── PACKING helpers ──────────────────────────────────────────────────────
// Packing machines reuse element_product_capacities, one row per PACKING LINE with extra
// fields: packing_input_id (bulk product consumed), pallets_per_day, tonnes_per_pallet,
// bulk_per_output_t (recipe ratio, default 1). product_id = the packed OUTPUT product.
function _isPackingRow(c){ return !!(c && c.packing_input_id); }
function _packLineCapT(c){ return (parseFloat(c&&c.pallets_per_day)||0)*(parseFloat(c&&c.tonnes_per_pallet)||0); } // max output tonnes/day
function _packLineRatio(c){ const r=parseFloat(c&&c.bulk_per_output_t); return r>0?r:1; }                          // bulk tonnes per output tonne
// Packed silos store PALLETS; the simulation runs packed cement in TONNES like bulk, so convert
// start/max via tonnes-per-pallet. Non-packed silos are already in tonnes.
function _siloTPP(el){ return parseFloat(el&&el.props&&el.props.tonnes_per_pallet)||1; }
function _siloStartT(el){ return el&&el.type==='packed_silo' ? (parseFloat(el.props&&el.props.start_inventory)||0)*_siloTPP(el) : (parseFloat(el&&el.props&&el.props.start_inventory)||0); }
function _siloMaxT(el){ return el&&el.type==='packed_silo' ? (parseFloat(el.props&&el.props.max_capacity)||0)*_siloTPP(el) : (parseFloat(el&&el.props&&el.props.max_capacity)||0); }

// Real production for an element on a date, one entry PER DISTINCT PRODUCT (tonnes).
// A finish mill can transition products mid-day and produce two (partially) the same day, so
// real_production_daily may hold several rows per element/day. We group by product and, for the
// SAME product recorded from two sources (e.g. Excel 'file' + a manual 'actual'), keep one — the
// 'actual' — instead of summing, so duplicates don't double-count. Returns [{product_id, volume_t}].
// Tonnes of a real PACKING record, or null when it can't be trusted yet. Packing is entered in
// pallets (rec.pallets); tonnes = pallets × the machine's packing line tonnes_per_pallet as
// configured NOW (so a factor set after the entry still applies), else the factor saved with
// the record. No factor anywhere → null: the simulation ignores the entry (guard) instead of
// moving pallets as if they were tonnes. A record without a pallet count (import / older
// entry) is already in tonnes.
function _realPackT(rec){
  if(!rec) return null;
  if(rec.pallets==null) return rec.tpp_missing?null:(parseFloat(rec.volume_t)||0);
  const line=DB.element_product_capacities.find(c=>c.element_id===rec.element_id&&c.product_id===rec.product_id&&c.packing_input_id);
  const tpp=parseFloat(line?.tonnes_per_pallet)||parseFloat(rec.tonnes_per_pallet)||0;
  return tpp>0?(parseFloat(rec.pallets)||0)*tpp:null;
}
function _dedupRealProd(elId, ds){
  // Inside an _idxRun block (a Supply render asks ~400k times) the answer is kept per element+day;
  // the memo lives in _IDX.maps, so it is dropped with the indexes when the block ends. Read-only result.
  let memo=null, key;
  if(_IDX.depth){
    memo=_IDX.maps.get('\0dedup'); if(!memo){ memo=new Map(); _IDX.maps.set('\0dedup',memo); }
    key=elId+'|'+ds; const hit=memo.get(key); if(hit!==undefined) return hit;
  }
  const rows=_idxRows('real_production_daily','element_id',elId,'date',ds); // read-only
  let res;
  if(!rows.length) res=[];
  else{
    const byProd={};
    rows.forEach(r=>{
      const pid=r.product_id; const pt=r.pallets!=null?_realPackT(r):null; const v=pt!=null?pt:(parseFloat(r.volume_t)||0);
      if(!(pid in byProd) || (r.source==='actual'&&byProd[pid].source!=='actual')) byProd[pid]={product_id:pid, volume_t:v, source:r.source};
    });
    res=Object.values(byProd);
  }
  if(memo) memo.set(key,res);
  return res;
}

// Per-VESSEL status timelines from a berth's berthVesselHistory. One entry per vessel (in
// order of first appearance); .days[dayIdx] = 'unloading' | 'anchorage' | undefined (not
// present). Only two states — anchorage covers not-yet-docked, berth-occupied, silo-full,
// and manual-campaign holds alike. Lets us draw one Gantt row per vessel — like a finish
// mill — instead of cramming the docked/waiting swap onto a single berth row.
function _vesselTimelines(hist){
  const order=[], seen=new Set(), byName={};
  (hist||[]).forEach((bv,di)=>{
    if(!bv) return;
    const add=(name,st)=>{ if(!name)return; if(!seen.has(name)){seen.add(name);order.push(name);} (byName[name]=byName[name]||{})[di]=st; };
    if(bv.docked) add(bv.docked, bv.state==='unloading'?'unloading':'anchorage');
    (bv.waitingList||[]).forEach(w=>add(w.name,'anchorage'));
  });
  return order.map(name=>({name, days:byName[name]}));
}
// Resolve a possibly-stale product id to the current catalog. vessel_calls (and other
// records) can carry ids from an OLDER catalog - e.g. 'riz_slg' after the product became
// 'riz_slg_blk' - which used to make the vessel silently fail to match its product row.
// Global twin of the Supply page's local _canon so every page matches identically.
function _pidCanon(pid){
  if(!pid||DB.products.some(p=>p.id===pid)) return pid;
  const nm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const n=nm(pid);
  const hit=n&&DB.products.find(p=>nm(p.id).startsWith(n)||nm(p.name).startsWith(n));
  return hit?hit.id:pid;
}

// Which product(s) each vessel carries, from vessel_calls. Keyed BY VESSEL CALL ID
// (authoritative - the simulation stamps dockedCallId / vesselCallId onto every berth
// history entry) AND by vessel name, as a fallback for older sim results that only
// recorded a name. Name-only keying was the bug behind blank "Vessel unload" rows: the
// simulation reports a split vessel's arrival as "<name> leg", which never matched the
// bare "<name>" key, so the whole Gantt row for that product came out empty even though
// the arrival tonnage showed right above it. Product ids are canonicalised so a vessel
// booked under an old product id still lands on the current product's row.
function _vesselProductSets(){
  const m={};
  const add=(key,pid)=>{ if(!key||!pid)return; (m[key]=m[key]||new Set()).add(_pidCanon(pid)); };
  (DB.vessel_calls||[]).forEach(vc=>{
    const legs=(vc.legs&&vc.legs.length)?vc.legs:[vc];
    legs.forEach(l=>{
      const pid=l.product_id||vc.product_id;
      add(vc.id,pid); add(vc.name,pid); add((vc.name||'')+' leg',pid);
    });
  });
  return m;
}

// Standard "does this vessel carry this product?" test - used by every vessel Gantt on
// every page so Logistics and Supply can never drift apart. Call it with the berth
// history's vesselCallId when there is one, else the vessel name.
function _vesselCarriesFn(){
  const sets=_vesselProductSets(), cache={};
  return (key,pid)=>{
    if(!key||!pid) return false;
    const cp=Object.prototype.hasOwnProperty.call(cache,pid)?cache[pid]:(cache[pid]=_pidCanon(pid));
    const set=sets[key];
    return !!(set&&set.has(cp));
  };
}
// Per-day vessel status for ONE product at a berth: the vessel of this product that is docked
// (unloading/anchorage), else a waiting vessel of this product. → [{state, vessel, vesselCallId}|null].
// vesselCallId identifies which vessel_calls record a clicked Gantt cell belongs to, for the
// campaign-override popup.
function _berthProductTimeline(hist, carries, pid){
  // Match on the vessel_calls id first (exact, survives any naming the sim uses) and
  // fall back to the vessel name for histories written before ids were recorded.
  const hit=(callId,name)=>carries(callId,pid)||carries(name,pid);
  return (hist||[]).map(bv=>{
    if(!bv) return null;
    if(bv.docked && hit(bv.dockedCallId,bv.docked)) return {state: bv.state==='unloading'?'unloading':'anchorage', vessel:bv.docked, vesselCallId:bv.dockedCallId||null, left:bv.dockedLeft};
    const w=(bv.waitingList||[]).find(x=>hit(x.vesselCallId,x.name));
    if(w) return {state:'anchorage', vessel:w.name, vesselCallId:w.vesselCallId||null, left:w.left};
    return null;
  });
}

// Tonnes a vessel brings to ONE berth: a split vessel's legs at that berth, else the call's quantity.
function _vesselCargoAt(vesselCallId, berthId){
  const v=vesselCallId&&(DB.vessel_calls||[]).find(x=>x.id===vesselCallId); if(!v) return 0;
  if(v.legs&&v.legs.length) return v.legs.filter(l=>l.berth_element_id===berthId).reduce((a,l)=>a+(parseFloat(l.quantity_t)||0),0);
  return parseFloat(v.quantity_t||v.total_quantity_t)||0;
}
// Tooltip line for a vessel cell: cargo · unloaded so far · left aboard at end of that day.
// "left" comes from the simulation (real unloading entries already count), so the two add up
// to the cargo. Returns '' when unknown (no sim yet, or a history written before this field).
function _vesselLeftTip(c, berthId){
  if(!c||c.left==null) return '';
  const cargo=_vesselCargoAt(c.vesselCallId, berthId);
  const left=Math.max(0,c.left), fmt=n=>_fmtInt(Math.round(n));
  return cargo>0
    ? ` · cargo ${fmt(cargo)} t · unloaded ${fmt(Math.max(0,cargo-left))} t · ${fmt(left)} t left (end of day)`
    : ` · ${fmt(left)} t left (end of day)`;
}
// One vessel-status cell. Forecast unloading = hatched green; ACTUAL unloading (a day the user
// entered real unload) = solid green. Anchorage = red hatch (covers not-yet-docked, berth-
// occupied, silo-full, and manual-campaign holds — only two vessel states exist).
function _vesselCellParts(state, isReal){
  if(!state) return {bg:'transparent', lblTxt:'', lbl:'', key:'__i'};
  let bg, lblTxt, lbl;
  if(state==='unloading'){
    bg = isReal || _thRule('bars')==='same' ? 'var(--teal)' : _thRule('bars')==='light' ? 'color-mix(in srgb,var(--teal) var(--fc-bar-pct,45%),var(--surface))' : 'repeating-linear-gradient(45deg,var(--teal),var(--teal) 5px,var(--h-teal-dk) 5px,var(--h-teal-dk) 7px)';
    lblTxt = isReal?'unloading ✓':'unloading'; lbl = isReal?'unloading (actual)':'unloading (forecast)';
  } else { // anchorage
    bg='repeating-linear-gradient(45deg,var(--h-anch-a),var(--h-anch-a) 3px,var(--h-red-dk) 3px,var(--h-red-dk) 6px)'; lblTxt='⚓ anchorage'; lbl='at anchorage';
  }
  return {bg, lblTxt, lbl, key:state+(isReal?'R':'')};
}

// Vessel/berth Gantt cell parts from a berthVesselHistory record. Shared by the terminal
// Supply page and the Logistics vessel schedule so both look identical.
//   unloading → green · anchorage (docked, silo full) → red hatch · arrived (waiting to
//   dock) → amber hatch · idle → empty. ⧗N badge = extra vessels waiting (not on the bar).


function _renderSupplyViewInner(wrap){
  if(!window._supSecCol) window._supSecCol=new Set();
  // First time the Supply page renders, start every section collapsed so the page
  // opens as a compact overview (headers + inventory charts) instead of a wall of rows.
  if(!window._supSecDefaultApplied){
    window._supSecDefaultApplied=true;
    ['clinkerInv','clinkerReq','clinkerProd','cementInv','cementNeed','cementProd','cementByProd','packedInv','packedNeed','packProd','railLoad','termUnload','scmInv','termVessel','termRail'].forEach(k=>window._supSecCol.add(k));
    // (The silo TRANSFER sections start open: they exist only once a link is drawn, and are short.)
  }
  if(!S.simCfg.start_date){
    wrap.innerHTML=`<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);padding:30px;text-align:center">Configure simulation dates in Configure first.</div>`;
    return;
  }

  const simStart=new Date(S.simCfg.start_date+'T00:00:00');
  const horizon=S.simCfg.horizon||90;
  const todayStr=new Date()._ymd();

  // Date spine — filtered by active view range
  const {from:filterFrom, to:filterTo}=fltGetDateRange('sup');
  const allDates=[];
  const _simDates=[];          // 0-based simulation day → date, whole horizon (see _dIdx)
  const _simDayIdx=new Map();  // date in view → its 0-based simulation day (see _dIdx)
  // Advance by CALENDAR day (setDate), not by +24h in ms. On a DST fall-back day (e.g.
  // Nov 1) the local day has 25h, so adding 864e5 ms lands back on the same date and the
  // column appears twice. setDate keeps local midnight and always moves to the next date.
  {
    const dt=new Date(simStart.getFullYear(),simStart.getMonth(),simStart.getDate());
    for(let d=0;d<horizon;d++){
      const ds=dt._ymd();
      _simDates.push(ds);
      if(ds>=filterFrom&&ds<=filterTo){ allDates.push(ds); _simDayIdx.set(ds,d); }
      dt.setDate(dt.getDate()+1);
    }
  }
  if(!allDates.length){
    const {wanted,bounds:sim}=fltGetDateRange('sup');
    wrap.innerHTML=`<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);padding:30px;text-align:center">`+
      `No simulated days in this time frame (${fltFmt(wanted.from)} → ${fltFmt(wanted.to)}). `+
      `The simulation runs ${fltFmt(sim.from)} → ${fltFmt(sim.to)}.</div>`;
    return;
  }

  // Group by month
  const months=[];
  allDates.forEach(ds=>{
    const ym=ds.slice(0,7);
    let mon=months.find(m=>m.ym===ym);
    if(!mon){mon={ym,label:new Date(ds+'T00:00:00').toLocaleDateString('en',{month:'short',year:'2-digit'}),dates:[]};months.push(mon);}
    mon.dates.push(ds);
  });

  // ── Render-scope lookup maps ──────────────────────────────────────────────
  // This renderer touches every facility × section × product × day; the hot
  // loops used to re-scan arrays for each cell (DB.products.find per product label,
  // a full element_product_capacities pass per element). Built once per render,
  // these make each of those O(1).
  //
  // _dIdx(ds) → the SIMULATION day index of a date in view (0 = the simulation start
  // date — every simResults array is indexed this way), or -1 for a date outside the
  // visible range. _simDates is the reverse: a stop event's 1-based e.day is on
  // _simDates[e.day-1]. Never index simulation data by a date's POSITION among the
  // visible columns (allDates): that equals the simulation day only when the view starts
  // on the simulation start date — true of the old ROM / ROY / Full Sim buttons, not of
  // the time frames. Current month starts on the 1st, so every simulated inventory,
  // production and unloading number showed a date months earlier (a silo with stock
  // today showed 0 tomorrow) and stop-event hatches landed on the wrong days.
  const _dIdx=ds=>{ const i=_simDayIdx.get(ds); return i===undefined?-1:i; };
  const _prodById=new Map(DB.products.map(p=>[p.id,p]));
  const _capsByEl=new Map();
  DB.element_product_capacities.forEach(c=>{ const a=_capsByEl.get(c.element_id); if(a) a.push(c); else _capsByEl.set(c.element_id,[c]); });

  // Collapsed state — shared with demand view pattern but separate keys.
  // A month BEFORE the current one starts collapsed (to its monthly total) the first time
  // a time frame brings it into view; the current and later months start open. Decided
  // once per month, so a month the user opened or closed keeps that across time frames.
  if(!window._supColapsed) window._supColapsed=new Set();
  if(!window._supColSeen) window._supColSeen=new Set();
  months.forEach(m=>{
    if(window._supColSeen.has(m.ym)) return;
    window._supColSeen.add(m.ym);
    if(m.ym<todayStr.slice(0,7)) window._supColapsed.add(m.ym);
  });
  if(!window._supGrpCol) window._supGrpCol=new Set();
  const collapsed=window._supColapsed;
  const grpCol=window._supGrpCol;

  const isWkend=ds=>{const d=new Date(ds+'T00:00:00').getDay();return d===0||d===6;};
  const isSat=ds=>new Date(ds+'T00:00:00').getDay()===6;
  // Days before today are shaded so recorded data sits in a visibly different zone.
  const _pastSty=ds=>ds<todayStr?';background-image:linear-gradient(var(--past-shade),var(--past-shade));':'';
  const thSty=ds=>(isSat(ds)?'border-left:2px solid rgba(var(--red-rgb),.4);background:var(--wkend-th)':
                  new Date(ds+'T00:00:00').getDay()===0?'border-right:2px solid rgba(var(--red-rgb),.4);background:var(--wkend-th)':'')+(ds<todayStr?_pastSty(ds)+'color:var(--past-th-text);':'');
  const _tdStyRaw=ds=>(ds===todayStr?'border-left:2px solid var(--green);border-right:2px solid var(--green);':
                  isSat(ds)?'border-left:2px solid rgba(var(--red-rgb),.3);background:var(--wkend-td,rgba(var(--red-rgb),.04))':
                  new Date(ds+'T00:00:00').getDay()===0?'border-right:2px solid rgba(var(--red-rgb),.3);background:var(--wkend-td,rgba(var(--red-rgb),.04))':'')+(ds<todayStr?';background-image:linear-gradient(var(--past-shade-td,var(--past-shade)),var(--past-shade-td,var(--past-shade)));':'');
  // Every row asks the same ~365 questions: one answer per date per render (two Date objects each otherwise).
  const _tdStyMemo=new Map();
  const tdSty=ds=>{ let s=_tdStyMemo.get(ds); if(s===undefined){ s=_tdStyRaw(ds); _tdStyMemo.set(ds,s); } return s; };
  // Previous calendar day of a date (the "beginning inventory = yesterday's EOD" lookups), once per date.
  const _prevDayMemo=new Map();
  const _prevDs=ds=>{ let p=_prevDayMemo.get(ds); if(p===undefined){ const d=new Date(ds+'T00:00:00'); d.setDate(d.getDate()-1); p=d._ymd(); _prevDayMemo.set(ds,p); } return p; };

  // ── Three-tier production data resolution ────────────────
  // Tier 1: sim results (millProductHistory + element_product_capacities)
  // Tier 2: production_schedule rules
  // Tier 3: first configured product at rated capacity (default estimate)
  const r=S.simResults;
  const hasSim=!!(r&&r.millProductHistory);
  const dataSource=hasSim?'Simulated output':'Planned schedule / rated capacity (default)';

  // Map dateString → event_id (for the clickable MAINT badge): the WHOLE down days of the
  // Maintenance Calendar, read like simulate() does (_maintSpans). The fractional day of a
  // 0.5- or 1.5-day event is not here: the unit runs it at reduced output, and the cell shows
  // that output tagged as a PM day (maintPartialFor), the same way a Down PM Day campaign shows.
  const _maintMemo=new Map();   // one Maintenance Calendar expansion per element per render
  const _maintSpansFor=(elId)=>{ let m=_maintMemo.get(elId); if(!m){ const sp=_maintSpans(elId); const full=new Map(); sp.full.forEach(ds=>full.set(ds, sp.ids.get(ds))); const partial=new Map(); sp.partial.forEach((frac,ds)=>partial.set(ds,{frac, id:sp.ids.get(ds)})); m={full, partial}; _maintMemo.set(elId,m); } return m; };
  const maintSetFor=(elId)=>_maintSpansFor(elId).full;
  const maintPartialFor=(elId)=>_maintSpansFor(elId).partial;

  // Returns {product_id, capacity_tpd} for element on a given date
  // Uses four-tier resolution: ACTUAL > SIM > SCHEDULE > DEFAULT
  // Memoised per (element, date, sim day) for this render: the same cell is resolved several
  // times (whole-horizon runs, the month total, the day cell, group totals). Results are read-only.
  const _rpMemo=new Map();
  // Tonnes the simulation really got out of a mill or packer that day, so these rows reconcile
  // with inventory. undefined = results saved before this was recorded: the rated rate stands in.
  const _simOut=(el,dayIdx)=>{ const a=(el.type==='packing_plant'?r?.packOutputHistory:r?.millOutputHistory)?.[el.id]; return a?(a[dayIdx]||0):undefined; };
  const resolveProduction=(el, ds, dayIdx, maintDays)=>{ const _k=el.id+'|'+ds+'|'+dayIdx; let _v=_rpMemo.get(_k); if(_v===undefined){ _v=_resolveProductionRaw(el, ds, dayIdx, maintDays); _rpMemo.set(_k,_v); } return _v; };
  const _resolveProductionRaw=(el, ds, dayIdx, maintDays)=>{
    if(maintDays.has(ds)) return {product_id:null, capacity_tpd:0};

    // Tier 0: ACTUAL data from real_production_daily (highest priority). Deduped per product.
    const realProduction=_dedupRealProd(el.id, ds);
    if(realProduction.length>0){
      const totalActual=realProduction.reduce((sum,r)=>sum+(parseFloat(r.volume_t)||0),0);
      const firstProd=realProduction[0];
      // A day that produced NOTHING can carry its reason: a Down For Repairs / PM / Inventory
      // Control campaign entered for that day. The actual 0 stays the number; the reason is
      // what the cell shows (it used to be hidden behind the blank actual).
      if(totalActual<=0){
        const dc=_downCampaignAt(el.id, ds);
        if(dc) return {product_id:null, capacity_tpd:0, isActual:true, downtime:DOWNTIME_PRODUCTS[dc.product_id], products:realProduction};
      }
      return {product_id:firstProd.product_id, capacity_tpd:totalActual, isActual:true, products:realProduction};
    }

    // Tier 0.4: the fractional day of a Maintenance Calendar event (a 0.5-day PM). The simulation
    // runs the unit at (1 − fraction) of its rate that day, so show that output — the sim histories
    // already hold the reduced tonnes; without them scale the tier below — tagged as a PM day, with
    // the event behind it so the cell opens it like a whole maintenance day does.
    const pmDay=maintPartialFor(el.id).get(ds);
    if(pmDay){
      const base=_resolveSimTiers(el, ds, dayIdx);
      const have=(el.type==='kiln'&&hasSim&&r.kilnProdHistory?.[el.id]?.[dayIdx]!==undefined)||_simOut(el,dayIdx)!==undefined;
      const pct=Math.round((1-pmDay.frac)*100);
      const evName=(DB.element_maintenance_events.find(m=>m.id===pmDay.id)||{}).name||'PM';
      return {...base, capacity_tpd:have?base.capacity_tpd:base.capacity_tpd*(1-pmDay.frac), downtime:'pm', maintId:pmDay.id,
              tip:`🗓 PM · ${esc(evName)} (Maintenance Calendar) — ${Math.round(pmDay.frac*24)} h down, runs at ${pct}%`};
    }

    // Tier 0.5: Manager campaign — locked, overrides simulation
    const managerCampaign=_idxRows('production_campaigns','element_id',el.id).find(c=>ds>=c.start_date && ds<=c.end_date);
    if(managerCampaign){
      // "Down For Repairs" is a full stop (0 production). "Down PM Day" is a HALF-day: the
      // element actually ran at ~50%, so fall through to the sim tiers below instead of
      // showing 0. A normal (non-downtime) campaign shows its locked product/rate.
      const dt=DOWNTIME_PRODUCTS[managerCampaign.product_id];
      if(dt && managerCampaign.product_id!=='__down_pm__')
        return {product_id:null, capacity_tpd:0, isCampaign:true, downtime:dt};
      if(!dt){
        const campRate=parseFloat(managerCampaign.rate_tpd)||0;
        const fallbackCap=(_capsByEl.get(el.id)||[]).find(c=>c.product_id===managerCampaign.product_id);
        const fbRate=_isPackingRow(fallbackCap)?_packLineCapT(fallbackCap):(parseFloat(fallbackCap?.capacity_tpd)||0);
        const rate=campRate||fbRate;
        const out=_simOut(el,dayIdx);
        return {product_id:managerCampaign.product_id, capacity_tpd:out!==undefined?out:rate, planned_tpd:rate, isCampaign:true};
      }
      // __down_pm__ → the product the sim picked, at the ~50% it actually ran, still TAGGED
      // as a PM day. Returning the bare sim tier here made a saved PM day render exactly like
      // a normal production day (same colour, full rated tonnes) — it looked unrecorded.
      const base=_resolveSimTiers(el, ds, dayIdx);
      const t=(el.type==='kiln'&&hasSim&&r.kilnProdHistory?.[el.id]?.[dayIdx]!==undefined)||_simOut(el,dayIdx)!==undefined
        ? base.capacity_tpd              // these histories already hold the actual (halved) output
        : base.capacity_tpd*0.5;
      return {...base, capacity_tpd:t, isCampaign:true, downtime:'pm'};
    }
    return _resolveSimTiers(el, ds, dayIdx);
  };
  // Tiers 1–3 of resolveProduction (sim → schedule → default), shared with the PM-day path.
  const _resolveSimTiers=(el, ds, dayIdx)=>{
    // Tier 1: sim results — KILNS report ACTUAL produced clinker (0 when blocked), so the
    // CLINKER PRODUCTION row reflects reality and reconciles with clinker inventory.
    if(hasSim&&el.type==='kiln'&&r.kilnProdHistory?.[el.id]){
      const v=r.kilnProdHistory[el.id][dayIdx];
      if(v!==undefined){
        const first=(_capsByEl.get(el.id)||[])[0];
        return {product_id:first?.product_id||null, capacity_tpd:v||0};
      }
    }
    // Tier 1: sim results (finish mills) — product chosen by the sim, at the tonnes it really made
    if(hasSim&&r.millProductHistory[el.id]){
      const pid=r.millProductHistory[el.id][dayIdx]||null;
      if(pid!==undefined){
        const cap=(_capsByEl.get(el.id)||[]).find(c=>c.product_id===pid);
        const rated=pid?parseFloat(cap?.capacity_tpd)||0:0, out=_simOut(el,dayIdx);
        return {product_id:pid, capacity_tpd:pid?(out!==undefined?out:rated):0, planned_tpd:rated};
      }
    }
    // Tier 1: sim results (packing plants) — the machine packs ONE product/day (packProductHistory),
    // at the tonnes it really packed (rated = pallets/day × tonnes/pallet).
    if(hasSim&&el.type==='packing_plant'&&r.packProductHistory?.[el.id]){
      const pid=r.packProductHistory[el.id][dayIdx]||null;
      if(pid!==undefined){
        const line=(_capsByEl.get(el.id)||[]).find(c=>c.product_id===pid);
        const rated=pid?_packLineCapT(line):0, out=_simOut(el,dayIdx);
        return {product_id:pid, capacity_tpd:pid?(out!==undefined?out:rated):0, planned_tpd:rated};
      }
    }

    // Tier 2: production_schedule rule
    const rule=(DB.production_schedule||[]).find(s=>
      s.element_id===el.id&&(!s.date_from||ds>=s.date_from)&&(!s.date_to||ds<=s.date_to)
    );
    if(rule){
      const cap=DB.element_product_capacities.find(c=>c.element_id===el.id&&c.product_id===rule.product_id);
      return {product_id:rule.product_id, capacity_tpd:parseFloat(cap?.capacity_tpd)||0};
    }

    // Tier 3: first configured product at rated capacity
    const caps=(_capsByEl.get(el.id)||[]);
    if(!caps.length) return {product_id:null, capacity_tpd:0};
    // For kilns: pick first, they're exclusive; for mills: first product
    const first=caps[0];
    const firstRate=_isPackingRow(first)?_packLineCapT(first):(parseFloat(first.capacity_tpd)||0);
    return {product_id:first.product_id, capacity_tpd:firstRate};
  };

  // Per-product production breakdown for a day. On a real-data day a mill may have produced
  // TWO products (mid-day changeover) → returns one entry per product; otherwise returns the
  // single resolved product. Used for the finish-mill display + clinker consumption (each
  // product draws clinker at its own recipe %).
  const resolveProductionAll=(el, ds, dayIdx, maintDays)=>{
    if(maintDays.has(ds)) return [];
    const real=_dedupRealProd(el.id, ds);
    if(real.length>0) return real.filter(rp=>(rp.volume_t||0)>0).map(rp=>({product_id:rp.product_id, capacity_tpd:parseFloat(rp.volume_t)||0, isActual:true}));
    const single=resolveProduction(el, ds, dayIdx, maintDays);
    return (single.product_id&&single.capacity_tpd>0)?[single]:[];
  };
  // ── One equipment row of the Supply page (kiln · finish mill · packing machine) ──────────
  // The single renderer behind CLINKER PRODUCTION, FINISH MILL PRODUCTION and both PACKING
  // PLANT PRODUCTION blocks (plant + terminal). It used to be four hand-kept copies, which is
  // how a fix (the PM-day tag) could land in one and not another. Any equipment type the
  // topology gains comes through here too, driven only by el.type:
  //   kiln                → numbers (a mini hatch bar on down days), no run pre-fill
  //   finish mill/packer  → product-coloured Gantt bar, real days show the actual tonnes
  // o = {color, rgb, depth, sec}. Campaign start/end cells carry drag grips (_campGrips).
  const _supEquipRow=(el,o)=>{
    const isKiln=el.type==='kiln', isPack=el.type==='packing_plant';
    const maintDays=maintSetFor(el.id);
    const _stopDays=type=>new Set((r?.stopEvents||[]).filter(e=>e.element_id===el.id&&e.type===type).map(e=>_simDates[e.day-1]).filter(Boolean));
    // starved = needed to run but had no feed (unplanned shortfall); blocked = receiving silo full
    const starvedDays=isKiln?new Set():_stopDays('starved');
    const blockedDays=_stopDays('blocked');
    const caps=(_capsByEl.get(el.id)||[]);
    const rated=isKiln?caps.reduce((s,c)=>s+(parseFloat(c.capacity_tpd)||0),0)
      :isPack?(()=>{ const ls=caps.filter(c=>_isPackingRow(c)); return ls.length?Math.max(...ls.map(_packLineCapT)):0; })()
      :(caps.length?Math.max(...caps.map(c=>parseFloat(c.capacity_tpd)||0)):0);
    const starvedTip=isPack?'⚠ Unplanned shortfall — packer could not run (no bulk cement)':'⚠ Unplanned shortfall — mill could not produce (no clinker)';
    const myCamps=(DB.production_campaigns||[]).filter(c=>c.element_id===el.id);
    const campAt=ds=>myCamps.find(c=>ds>=c.start_date&&ds<=c.end_date)||null;
    // Simulation-proposed product runs over the WHOLE horizon (so a grip marks a run's true
    // start/end even where the time frame clips it). Not kilns: one product for months.
    let simRunAt={}, lblIdx=new Set();
    if(!isKiln){
      const rrs=_simDates.map((ds,i)=>maintDays.has(ds)?null:resolveProduction(el,ds,i,maintDays));
      if(hasSim){
        const prodOf=i=>{ const x=rrs[i]; return (x&&x.capacity_tpd>0&&!x.downtime)?x.product_id:''; };
        const vals=rrs.map(x=>(x&&x.capacity_tpd>0&&!x.downtime&&!x.isActual&&!x.isCampaign)?x.product_id:null);
        simRunAt=_simRunsFrom(_simDates, vals, el.id, prodOf);
      }
      // Product label in the middle of each forecast production run (real days carry numbers).
      const visDs=new Set(); months.forEach(m=>{ if(!collapsed.has(m.ym)) m.dates.forEach(d=>visDs.add(d)); });
      lblIdx=_midLabelIdx(rrs.map(x=>(x&&x.capacity_tpd>0&&!x.downtime&&!x.isActual)?x.product_id:null), _simDates.map(d=>visDs.has(d)));
    }
    let h=`<tr class="supsec-${o.sec}">
              <td style="${stickyLeft('var(--surface)',o.depth,'border-bottom:1px solid var(--border),')}color:${o.color};font-size:9px" title="${esc(el.name)}">${_supLeafLabel(el.name)}
                <span style="color:var(--text-dim);font-size:8px;margin-left:4px">${rated>0?rated.toLocaleString()+' t/d rated':''}</span>
              </td>`;
    let _gPrev=null;
    // Contiguous same-product runs, so a click pre-fills the campaign dialog with that run's
    // product + dates. Not for kilns: they run one product for months, so "the run" would
    // default the dialog to a months-long range.
    const _runByDate={};
    if(!isKiln){ let cs=null,cp=null,pd=null;
      const _fin=(endDs)=>{ if(cs==null)return; let on=false; for(const d of allDates){ if(d===cs)on=true; if(on)_runByDate[d]={start:cs,end:endDs,product:cp}; if(d===endDs)break; } };
      allDates.forEach(ds=>{
        const rr=maintDays.has(ds)?{capacity_tpd:0,product_id:null}:resolveProduction(el,ds,_dIdx(ds),maintDays);
        const pid=(rr.capacity_tpd>0&&!rr.downtime)?rr.product_id:null;
        if(pid&&pid===cp){ pd=ds; }
        else { if(cs!=null)_fin(pd); if(pid){cs=ds;cp=pid;pd=ds;}else{cs=null;cp=null;pd=null;} }
      });
      if(cs!=null)_fin(pd);
    }
    months.forEach(mon=>{
      const isCol=collapsed.has(mon.ym);
      const mt=mon.dates.reduce((s,ds)=>s+resolveProduction(el,ds,_dIdx(ds),maintDays).capacity_tpd,0);
      h+=`<td style="border-left:2px solid rgba(var(--${o.rgb}-rgb),.15);font-size:9px;color:${o.color};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
      if(!isCol) mon.dates.forEach(ds=>{
        const dayIdx=_dIdx(ds);
        const res=resolveProduction(el,ds,dayIdx,maintDays);
        const v=res.capacity_tpd;
        const prod=_prodById.get(res.product_id);
        const isMaint=maintDays.has(ds);
        const isCamp=res.isCampaign;
        const dt=res.downtime; // 'repair' | 'pm' from a downtime campaign
        const grips=_campGrips('prod',campAt(ds),ds)||(isKiln?'':_simGrips('simprod',simRunAt[ds],ds));
        const gPos=grips?'position:relative;':'';
        const run=_runByDate[ds];
        const campArgs=run?`'${el.id}','${ds}','${run.start}','${run.end}','${run.product}'`:`'${el.id}','${ds}'`;
        const clickFn=(isMaint||res.maintId)?`openMaintenanceEventById('${isMaint?maintDays.get(ds):res.maintId}')`:`showCampaignPopup(${campArgs})`;
        const dAttr=`data-eq="${el.id}" data-ds="${ds}"`;

        if(isKiln){
          // Numbers, but a DOWN day shows a mini hatch bar instead of a bare "0" so the reason
          // is evident at a glance — maintenance, blocked (clinker silo full), or a manual
          // Down-For-Repairs / Down-PM-Day campaign. Clicking a maintenance day opens its event.
          const campBorder=isCamp?'box-shadow:inset 0 2px 0 var(--plan);':'';
          const lockBadge=isCamp?'<span style="font-size:7px;color:var(--lime);margin-left:2px" title="Manager campaign">🔒</span>':'';
          const isBlocked=(!isMaint&&!dt&&v<=0&&blockedDays.has(ds));
          const downKind=isMaint?'maint':dt?dt:isBlocked?'blocked':null;
          const cellTitle=isMaint?`Maintenance${prod?.name?' · '+prod.name:''}`:(dt?(res.isActual?_DOWN_TIP[dt].replace(/ \(manual\) — .*$/,'')+' — actual: no production that day':(res.tip||_DOWN_TIP[dt])+(v>0?` · ${prod?.name?esc(prod.name)+' ':''}${_fmtInt(Math.round(v))} t`:'')):isBlocked?_DOWN_TIP.blocked:isCamp?`🔒 Campaign: ${prod?.name||''} @ ${Math.round(v)} t/d`:(prod?.name||''));
          let inner, cAlign='text-align:right;', cPad='padding:4px 6px;';
          if(downKind){ cAlign=''; cPad='padding:3px 0;';
            // a reason on a day with actuals keeps the real-data bottom edge
            inner=`<div class="sx-bar" style="background:${_DOWN_HATCH[downKind]}${res.isActual?';box-shadow:inset 0 -2px 0 var(--real)':''}"></div>`; }
          else { inner = v>0?prodIcon(prod)+_fmtInt(Math.round(v))+lockBadge:'0'; }
          h+=`<td ${dAttr} class="sup-day-${mon.ym} ${(res.isActual&&v>0)?'cell-real':((!downKind&&v>0&&ds<todayStr)?'cell-gap':'')}" title="${cellTitle}${(res.isActual&&v>0)?' · actual':''}" onclick="event.stopPropagation();${clickFn}" style="${gPos}cursor:pointer;font-size:9px;color:${v>0?o.color:'rgba(var(--red-rgb),calc(var(--zero-k)*.4))'};${cAlign}${cPad}border-bottom:1px solid var(--border);overflow:visible;${campBorder}${tdSty(ds)}">${inner}${grips}</td>`;
          return;
        }

        const barColor=prod?((typeof spProdColor==='function')?spProdColor(prod.name||prod.id,false):(PRODUCT_CAT_COLORS[prod.category||'']||o.color)):o.color;
        // REAL value (from file or daily-data input): the day's total tonnage, colour-coded by
        // product. A mill can change product mid-day and make TWO the same day → a ▾N marker
        // and every product+tonnage in the tooltip.
        if(!!res.isActual && v>0){
          _gPrev='__real';
          const _allP=resolveProductionAll(el,ds,dayIdx,maintDays);
          const _multi=_allP.length>1;
          const _tip=(_allP.length?_allP.map(p=>(_prodById.get(p.product_id)?.name||p.product_id)+' '+_fmtInt(Math.round(p.capacity_tpd))+'t').join(' + '):(prod?.name||''))+' · actual';
          const _mk=_multi?`<span style="font-size:7px;color:var(--amber);vertical-align:super;margin-left:1px">▾${_allP.length}</span>`:'';
          h+=`<td ${dAttr} class="sup-day-${mon.ym} cell-real sx-gt" title="${_tip}" onclick="event.stopPropagation();${clickFn}" style="${gPos}${tdSty(ds)}"><div class="sx-bar" style="background:${barColor};box-shadow:inset 0 -2px 0 var(--real)"><span style="position:absolute;left:4px;top:0;line-height:10px;white-space:nowrap;font-family:var(--mono);font-size:8px;font-weight:700;color:${_barTextColor(barColor)};pointer-events:none">${_fmtInt(Math.round(v))}${_mk}</span></div>${grips}</td>`;
          return;
        }
        // FORECAST / maintenance / downtime: Gantt bar — colour = product, or a distinct hatch
        // when DOWN (maintenance · starved · blocked · Down-For-Repairs / Down-PM-Day). No text
        // on the bar: colour identifies it, the tooltip gives the detail.
        const isStarved=(!isMaint&&!dt&&v<=0&&starvedDays.has(ds));
        const isBlocked=(!isMaint&&!dt&&v<=0&&!isStarved&&blockedDays.has(ds));
        const downKind=isMaint?'maint':dt?dt:isStarved?'starved':isBlocked?'blocked':null;
        const runKey=downKind?('__'+downKind):(v>0?(res.product_id||'__p'):'__idle');
        const isRunStart=(runKey!=='__idle'&&runKey!==_gPrev);
        _gPrev=runKey;
        const barBg=downKind?(_DOWN_HATCH[downKind]||'transparent'):(v>0?_hatchBar(barColor):'transparent');
        const isGap=(!downKind&&v>0&&ds<todayStr); // simulated on a day that should have an actual
        const _edges=[]; if(isCamp&&!isMaint) _edges.push('inset 0 2px 0 var(--plan)'); if(isGap) _edges.push('inset 0 -2px 0 var(--simulated)');
        if(res.isActual&&downKind) _edges.push('inset 0 -2px 0 var(--real)');   // the reason for a real 0 t day
        const campMark=_edges.length?`box-shadow:${_edges.join(',')};`:'';
        const _ofPlan=(v>0&&res.planned_tpd>v+.5)?` of ${_fmtInt(Math.round(res.planned_tpd))} planned`:'';
        const cellTitle=isMaint?`Maintenance${prod?.name?' · '+prod.name:''}`:(dt?(res.isActual?_DOWN_TIP[dt].replace(/ \(manual\) — .*$/,'')+' — actual: no production that day':(res.tip||_DOWN_TIP[dt])+(v>0?` · ${prod?.name?esc(prod.name)+' ':''}${_fmtInt(Math.round(v))} t`:'')):isBlocked?_DOWN_TIP.blocked:isStarved?starvedTip:(isCamp?`🔒 Campaign: ${prod?.name||''} @ ${Math.round(v)} t/d${_ofPlan}`:(prod?.name?`${esc(prod.name)} · ${Math.round(v)} t/d${_ofPlan}`:'Idle')));
        const zpos=isRunStart?'position:relative;z-index:2;':gPos;
        // Product name only (no rate) in the middle of each production run — small, without the
        // plant prefix ("BRS_IL(12)/BLK" → "IL(12)/BLK") and clipped to its own day cell; the
        // tooltip has the full name.
        const lblName=((typeof spShortProd==='function')?spShortProd(prod?.name||''):(prod?.name||'')).replace(/^[A-Z0-9]{2,5}_(?=.)/,'');
        const label=(lblIdx.has(dayIdx)&&!downKind&&v>0&&lblName)?`<span style="${_BAR_LBL_FIT}line-height:10px;font-family:var(--mono);color:${isGap?'var(--simulated)':'var(--bar-lbl)'};text-shadow:0 0 2px var(--bar-lbl-halo),0 0 2px var(--bar-lbl-halo);pointer-events:none">${esc(lblName)}</span>`:'';
        h+=`<td ${dAttr} class="sup-day-${mon.ym}${isGap?' src-gap':''} sx-gt" title="${cellTitle}" onclick="event.stopPropagation();${clickFn}" style="${zpos}${tdSty(ds)}"><div class="sx-bar" style="background:${barBg};${campMark}">${label}</div>${grips}</td>`;
      });
    });
    return h+`</tr>`;
  };
  // Source of a number DERIVED from other inputs (requirements, clinker need, by-product output,
  // totals): 'cell-real' when every input contributing that day is actual, 'cell-gap' on a past
  // day when any is not, '' otherwise (forecast days get cell-fc later). Same classes as the
  // inventory / production cells, so a derived number always reads like the data it comes from.
  const _srcCls=(ds,v,acts)=>!(v>0)?'':(acts.length&&acts.every(Boolean))?'cell-real':(ds<todayStr?'cell-gap':'');
  const _dmdActs=(dpts,ds)=>dpts.filter(dp=>(_demandRate(dp.element_id,ds)||0)>0).map(dp=>_dmdIsActual(dp.element_id,ds));
  const _swapInActs=(dpts,ds)=>(DB.demand_substitutions||[]).filter(sb=>dpts.some(dp=>dp.element_id===sb.to_element_id))
    .map(sb=>_dmdIsActual(sb.from_element_id,ds));
  const _prodActs=(els,ds,pid)=>els.flatMap(el=>resolveProductionAll(el,ds,_dIdx(ds),maintSetFor(el.id))
    .filter(p=>!pid||p.product_id===pid).map(p=>!!p.isActual));
  const _railReal=(facId,ds)=>(DB.real_rail_daily||[]).some(x=>x.date===ds&&x.facility_id===facId&&x.type==='loading');

  // Data-resilience: vessel_calls / demand_points / transfers can carry product ids from an
  // OLDER catalog (e.g. 'riz_slg' after the product became 'riz_slg_blk'). Resolve stale ids to
  // the current catalog by normalized id/name prefix so no phantom product rows appear and their
  // tonnage lands on the right row. Unresolvable ids pass through unchanged. (Shared by the
  // terminal blocks and the facility-need helpers below.)
  const _pnorm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const _canonCache={};
  const _prodIdSet=new Set(DB.products.map(p=>p.id));
  const _canon=pid=>{
    if(!pid||_prodIdSet.has(pid)) return pid;
    if(Object.prototype.hasOwnProperty.call(_canonCache,pid)) return _canonCache[pid];
    const n=_pnorm(pid);
    const hit=n&&DB.products.find(p=>_pnorm(p.id).startsWith(n)||_pnorm(p.name).startsWith(n));
    return (_canonCache[pid]=hit?hit.id:pid);
  };
  // What a terminal / purchased source asks for on a day — its demand points' own demand plus
  // anything a swap moves INTO them (the same maths as the PRODUCT REQUIREMENT / PURCHASES
  // rows) — and whether each contributing number is actual. A collapsed facility line and a
  // collapsed product-group line show this sum so the real / forecast numbers stay in view;
  // a purchased source also adds it to the sub-region / region / TOTAL rows above it, since
  // the tonnes it sells us are its output to the network (it has no mills of its own).
  // pids: only demand points whose first product is in the set (a product group); default all.
  const _facDpsMemo=new Map();
  const _facDps=(facId,pids)=>{
    const k=facId+'|'+(pids?[...pids].join(','):'*'); let a=_facDpsMemo.get(k);
    if(!a){
      const ids=new Set(allEls.filter(e=>e.type==='demand_point'&&(e.assigned_facility_id||e.facility_id)===facId).map(e=>e.id));
      a=DB.demand_points.filter(dp=>{ if(!ids.has(dp.element_id)) return false;
        const pid=_canon(_dpFirstProd(dp)); return _supProdAllows(pid)&&(!pids||pids.has(pid)); });
      _facDpsMemo.set(k,a);
    }
    return a;
  };
  const _dpsNeed=(dps,ds)=>dps.reduce((s,dp)=>s+(_demandRate(dp.element_id,ds)||0)
    +((typeof _resolveDemandSwapIn==='function')?_resolveDemandSwapIn(dp.element_id,ds,id=>_demandRate(id,ds)):0),0);
  const _dpsActs=(dps,ds)=>_dmdActs(dps,ds).concat(_swapInActs(dps,ds));
  const _pfDay=(pf,ds)=>(pf||[]).reduce((s,f)=>s+_dpsNeed(_facDps(f.id),ds),0);
  const _pfMon=(pf,mon)=>(pf&&pf.length)?mon.dates.reduce((s,ds)=>s+_pfDay(pf,ds),0):0;
  const _pfActs=(pf,ds)=>(pf||[]).flatMap(f=>_dpsActs(_facDps(f.id),ds));

  // For group totals — sum daily output across all elements
  const grpDailyTotal=(els,ds,dayIdx)=>
    els.reduce((s,el)=>s+resolveProduction(el,ds,dayIdx,maintSetFor(el.id)).capacity_tpd,0);
  const grpMonTotal=(els,mon)=>
    mon.dates.reduce((s,ds,di)=>{
      const dayIdx=_dIdx(ds);
      return s+grpDailyTotal(els,ds,dayIdx);
    },0);

  // Build org tree — same logic as demand view
  const facMap=Object.fromEntries(DB.facilities.map(f=>[f.id,f]));
  const subMap=Object.fromEntries(DB.sub_regions.map(s=>[s.id,s]));
  const regMap=Object.fromEntries(DB.regions.map(r=>[r.id,r]));
  const coMap=Object.fromEntries(DB.countries.map(c=>[c.id,c]));

  // Collect all production elements (kilns + finish mills + packing plants) from current canvas
  // Apply facility and product filters from filter bar
  // Selected facilities as a Set — null when the Facility filter is unrestricted.
  const _supFacFilter=fltFacIdSet();
  // Family / Category / Product collapse into ONE set of allowed product ids
  // (null = unrestricted). Everything product-scoped on the page tests against
  // _supProdAllows() so all three dropdowns narrow the view identically — a
  // Family or Category pick behaves like picking each of its products at once.
  const _supAllowedPids=fltAllowedProdIds();
  const _supProdAllows=pid=>!_supAllowedPids||_supAllowedPids.has(pid);
  let allEls=getFacElements();
  // Filter by active status unless user has toggled to show inactive. The simulation runs
  // inactive elements too, so one that still asks for, holds or makes tonnes keeps its row
  // (tagged by _supInactTag) — hiding it left requirements low and section totals short of stock.
  const _supCarries=e=>{
    if(e.type==='demand_point') return (r?.demandFill?.[e.id]?.requested||0)>0;
    if(e.type==='bulk_silo'||e.type==='packed_silo') return (r?.inventoryHistory?.[e.id]||[]).some(v=>v>0);
    return (r?.kilnProdHistory?.[e.id]||r?.millOutputHistory?.[e.id]||r?.packOutputHistory?.[e.id]||[]).some(v=>v>0);
  };
  if(!window._supShowInactive) allEls=allEls.filter(e=>e.is_active!==false||_supCarries(e));
  // Terminal-type facilities ALWAYS render via the terminal (category-first) path,
  // even when they own production elements (e.g. a packing plant at PEV). Without
  // this exclusion a terminal packer routes the whole facility into the plant tree,
  // which has no vessel/rail arrival sections and filters inventory to cement only.
  const _facTypeOf=id=>DB.facilities.find(f=>f.id===id)?.type;
  let prodEls=allEls.filter(e=>(e.type==='kiln'||e.type==='finish_mill'||e.type==='packing_plant')
    &&_facTypeOf(e.assigned_facility_id||e.facility_id||S.facility_id)!=='terminal');
  // Filter by selected facilities (assigned_facility_id first)
  if(_supFacFilter){
    prodEls=prodEls.filter(e=>_supFacFilter.has(e.assigned_facility_id||e.facility_id));
  }
  // Filter by product selection (only show elements that produce a product the
  // Family/Category/Product filters allow)
  if(_supAllowedPids){
    prodEls=prodEls.filter(e=>
      DB.element_product_capacities.some(c=>c.element_id===e.id&&_supProdAllows(c.product_id))
    );
  }

  // ── Terminal facilities (receiving-only: silos + berths + demand, no mills) ──
  // Collected here so the empty-topology guard below also allows terminal-only
  // scenarios. Rendered as their own group AFTER the plant tree (see below).
  const _termHasEls=f=>allEls.some(e=>(e.assigned_facility_id||e.facility_id)===f.id&&(e.type==='bulk_silo'||e.type==='packed_silo'||e.type==='demand_point'||e.type==='berth'||e.type==='packing_plant'));
  // Purchased facilities ride the same path: same demand maths, fewer sections
  // (see _isPurch below — no inventory, no arrivals, no capacity).
  let _termFacs=DB.facilities.filter(f=>f.type==='terminal'||f.type==='purchased').filter(_termHasEls);
  if(_supFacFilter) _termFacs=_termFacs.filter(f=>_supFacFilter.has(f.id));
  if(_supAllowedPids) _termFacs=_termFacs.filter(f=>{
    const fe=allEls.filter(e=>(e.assigned_facility_id||e.facility_id)===f.id);
    return fe.some(e=>{
      if(e.type==='bulk_silo'||e.type==='packed_silo') return getSiloProducts(e).some(_supProdAllows);
      if(e.type==='demand_point') return (DB.demand_points.find(dp=>dp.element_id===e.id)?.products||[]).some(p=>_supProdAllows(p.product_id));
      if(e.type==='packing_plant') return DB.element_product_capacities.some(c=>c.element_id===e.id&&_supProdAllows(c.product_id));
      return false; // a berth alone doesn't mean the terminal handles this product
    });
  });

  if(!prodEls.length && !_termFacs.length){
    wrap.innerHTML=`<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);padding:30px;text-align:center">No kilns, finish mills, or terminals in the topology.</div>`;
    return;
  }

  const facForEl=el=>el.assigned_facility_id||el.facility_id||S.facility_id;
  const relevantFacIds=new Set(prodEls.map(el=>facForEl(el)));
  // Terminals keep their own render path (TERMINALS block below) but sit in the same org
  // tree as the plants — grouped by sub-region, not by facility type.
  const _termRender=_termFacs.filter(f=>!relevantFacIds.has(f.id))
    .sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  // Purchased sources under a level (their bought tonnes join that level's row — see _pfDay).
  const _pfIn=pred=>_termRender.filter(f=>isPurchasedFac(f)&&pred(f.id));
  const _pfAll=_termRender.filter(isPurchasedFac);

  // Build tree (same structure as demand). A level shows when it holds a plant element OR a
  // terminal; its els stay plant elements only, since they feed the header-row sums.
  // parents = ids of the rendered levels above a node, so collapsing any of them hides it.
  const _orgOf=facId=>{ const sub=subMap[facMap[facId]?.sub_region_id];
    const reg=regMap[sub?.region_id]; return {sub,reg,co:coMap[reg?.country_id]}; };
  const _shownFacIds=[...relevantFacIds,..._termRender.map(f=>f.id)];
  const tree=[];
  DB.macro_regions.forEach(mr=>{
    const inMr=fid=>_orgOf(fid).co?.macro_region_id===mr.id;
    if(!_shownFacIds.some(inMr)) return;
    const mrEls=prodEls.filter(el=>inMr(facForEl(el)));

    const multiMR=DB.macro_regions.filter(m=>_shownFacIds.some(fid=>_orgOf(fid).co?.macro_region_id===m.id)).length>1;
    const mrPath=multiMR?[mr.id]:[];
    if(multiMR) tree.push({type:'mr',id:mr.id,name:mr.name,depth:0,els:mrEls,pfacs:_pfIn(inMr),parents:[]});

    DB.countries.filter(c=>c.macro_region_id===mr.id).forEach(co=>{
      const inCo=fid=>_orgOf(fid).reg?.country_id===co.id;
      if(!_shownFacIds.some(inCo)) return;
      const coEls=mrEls.filter(el=>inCo(facForEl(el)));
      const depth=multiMR?1:0;
      const multiCo=DB.countries.filter(c2=>c2.macro_region_id===mr.id&&_shownFacIds.some(fid=>_orgOf(fid).reg?.country_id===c2.id)).length>1;
      const coPath=multiCo?[...mrPath,co.id]:mrPath;
      if(multiCo) tree.push({type:'co',id:co.id,name:co.name,depth,els:coEls,pfacs:_pfIn(inCo),parents:mrPath});

      DB.regions.filter(r=>r.country_id===co.id).forEach(reg=>{
        const inReg=fid=>_orgOf(fid).sub?.region_id===reg.id;
        if(!_shownFacIds.some(inReg)) return;
        const regEls=coEls.filter(el=>inReg(facForEl(el)));
        tree.push({type:'reg',id:reg.id,name:reg.name,depth:depth+(multiCo?1:0),els:regEls,pfacs:_pfIn(inReg),parents:coPath});
        const regDepth=depth+(multiCo?1:0)+1;
        const regPath=[...coPath,reg.id];

        DB.sub_regions.filter(s=>s.region_id===reg.id).forEach(sub=>{
          const inSub=fid=>facMap[fid]?.sub_region_id===sub.id;
          if(!_shownFacIds.some(inSub)) return;
          const subEls=regEls.filter(el=>inSub(facForEl(el)));
          tree.push({type:'sub',id:sub.id,name:sub.name,depth:regDepth,els:subEls,pfacs:_pfIn(inSub),parents:regPath});
          const subDepth=regDepth+1;
          const subPath=[...regPath,sub.id];

          // Plants first, then terminals — each A–Z.
          DB.facilities.filter(f=>f.sub_region_id===sub.id&&relevantFacIds.has(f.id))
            .sort((a,b)=>(a.name||'').localeCompare(b.name||'')).forEach(fac=>{
            const facEls=subEls.filter(el=>facForEl(el)===fac.id);
            if(!facEls.length) return;
            // Group kilns, mills and packing plants under facility
            const kilns=facEls.filter(e=>e.type==='kiln');
            const mills=facEls.filter(e=>e.type==='finish_mill');
            const packers=facEls.filter(e=>e.type==='packing_plant');
            tree.push({type:'fac',id:fac.id,name:fac.name,depth:subDepth,ftype:fac.type,els:facEls,kilns,mills,packers,parents:subPath});
          });
          _termRender.filter(f=>inSub(f.id)).forEach(fac=>{
            tree.push({type:'fac',term:true,id:fac.id,name:fac.name,depth:subDepth,ftype:fac.type||'terminal',els:[],parents:subPath});
          });
        });
      });
    });
  });

  // Orphans
  const coveredEls=new Set(tree.filter(n=>n.type==='fac').flatMap(n=>n.els).map(e=>e.id));
  const orphans=prodEls.filter(el=>!coveredEls.has(el.id));
  if(orphans.length) tree.push({type:'fac',id:'_orphan',name:'Unassigned',depth:0,ftype:'plant',
    els:orphans,kilns:orphans.filter(e=>e.type==='kiln'),mills:orphans.filter(e=>e.type==='finish_mill'),
    packers:orphans.filter(e=>e.type==='packing_plant'),parents:[]});
  // Terminals the org tree couldn't place (no sub-region, or a broken chain above it).
  const _termPlaced=new Set(tree.filter(n=>n.term).map(n=>n.id));
  const _termOrphans=_termRender.filter(f=>!_termPlaced.has(f.id));
  if(_termOrphans.length){
    tree.push({type:'sub',id:'_orphan_term',name:'Unassigned',depth:0,els:[],pfacs:_termOrphans.filter(isPurchasedFac),parents:[]});
    _termOrphans.forEach(fac=>tree.push({type:'fac',term:true,id:fac.id,name:fac.name,depth:1,ftype:'terminal',els:[],parents:['_orphan_term']}));
  }

  const indentPx=depth=>depth*16+8;   // one 16px step per level
  const stickyLeft=(bg,depth,extra='')=>
    `position:sticky;left:0;z-index:3;background:${bg};border-right:1px solid var(--border2);padding:4px 10px 4px ${indentPx(depth)}px;--d:${depth};${extra}`;

  // ── <MATERIAL> TRANSFER section — silo transfer links (DB.silo_links) ─────────
  // One row per allowed direction of every live link touching `silos` whose product passes
  // `pred` — a two-way link gives two rows, so every number is positive. The rows are Gantt
  // rows with the finish mills' rules (_supEquipRow): a planned campaign is a hatched bar in the
  // material's colour with its t/day in the middle of each run and the plan edge on top; a
  // recorded day is a solid bar carrying the tonnes (green bottom edge); a planned day the
  // simulation could not move at all shows the FULL hatch (origin empty / destination full), a
  // partial one an amber bottom edge; a past day with no actual gets the simulated edge. Click a
  // day for the campaign popup (showSiloXferPopup: Forecast Campaign / Real Data); drag a
  // campaign's start or end grip to change its duration (store 'xfer' in _CAMP_STORES).
  const _slXferSection=(silos,{key,pred,color,rgb,depth})=>{
    const ids=new Set(silos.map(s=>s.id));
    const links=(DB.silo_links||[]).filter(lk=>(ids.has(lk.from_silo_id)||ids.has(lk.to_silo_id))
      &&_slValid(lk)&&pred(lk.product_id)&&_supProdAllows(lk.product_id));
    if(!links.length) return '';
    const rows=[]; links.forEach(lk=>_slDirs(lk).forEach((d,i)=>rows.push({lk,d,dir:i?'rev':'fwd'})));
    const _memo=new Map();
    const cell=(row,ds)=>{
      const mk=row.lk.id+'|'+row.dir+'|'+ds; if(_memo.has(mk)) return _memo.get(mk);
      const {lk,d,dir}=row;
      const real=_slRealT(lk.id,d.from,d.to,ds);
      const pr=_slPlanRow(lk.id,d.from,d.to,ds);
      const di=_dIdx(ds), hs=di>=0?r?.siloTransferHistory?.[lk.id]?.[di]?.[dir]:null;
      const c={v:real!=null?real:(pr?(parseFloat(pr.rate_tpd)||0):0), real:real!=null, plan:pr||null, moved:hs?hs.moved:null};
      _memo.set(mk,c); return c;
    };
    const dayTot=ds=>rows.reduce((s,rw)=>s+cell(rw,ds).v,0);
    const label=_slFamLabel(links.map(l=>l.product_id));
    const visDs=new Set(); months.forEach(m=>{ if(!collapsed.has(m.ym)) m.dates.forEach(x=>visDs.add(x)); });
    const visArr=_simDates.map(x=>visDs.has(x));
    let out=`<tr class="sup-sec-hdr" data-seckey="${key}" onclick="_supToggleSec('${key}')" style="cursor:pointer;background:rgba(var(--${rgb}-rgb),.04);border-top:1px solid rgba(var(--${rgb}-rgb),.25)">
      <td title="Tonnes moved between two silos that hold the same material — one line per direction. Click a day to plan a campaign or record an actual; drag a campaign's ends to change its duration. Links are drawn on the topology (Movement › Silo Transfer)." style="${stickyLeft('var(--surface)',depth,'border-bottom:1px solid var(--border),')}color:${color};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow(key)}</span> ${label}</td>`;
    months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
      const mt=mon.dates.reduce((a,ds)=>a+dayTot(ds),0);
      out+=`<td style="border-left:2px solid rgba(var(--${rgb}-rgb),.2);font-size:9px;font-weight:700;color:${color};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
      if(!isCol) mon.dates.forEach(ds=>{ const v=dayTot(ds);
        out+=`<td class="sup-day-${mon.ym} sx-nb" style="color:${color};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):''}</td>`; });
    });
    out+=`</tr>`;
    rows.forEach(row=>{
      const {lk,d}=row, fe=getEl(d.from), te=getEl(d.to);
      const ff=_elFacName(fe), tf=_elFacName(te);
      const maxT=parseFloat(lk.max_rate_tpd)||0;
      const prod=_prodById.get(lk.product_id), pname=prod?.name||lk.product_id;
      const barColor=prod?((typeof spProdColor==='function')?spProdColor(prod.name||prod.id,false):(PRODUCT_CAT_COLORS[prod.category||'']||color)):color;
      // The t/day label sits in the middle of each planned run of one rate (like the mills' product label).
      const lblIdx=_midLabelIdx(_simDates.map(ds=>{ const c=cell(row,ds); return (!c.real&&c.plan&&c.v>0)?(c.plan.id+'|'+c.v):null; }),visArr);
      out+=`<tr class="supsec-${key}" data-sl="${lk.id}"><td title="${esc(fe?.name||'')} → ${esc(te?.name||'')} · ${esc(pname)}" style="${stickyLeft('var(--surface)',depth+1,'border-bottom:1px solid var(--border),')}color:${color};font-size:9px">`
        +`<span style="color:var(--orange);margin-right:4px">┄</span>${esc(_slShort(d.from))} → ${esc(_slShort(d.to))}`
        +(ff!==tf?`<span style="color:var(--text-dim);font-size:8px;margin-left:5px">${esc(ff)} → ${esc(tf)}</span>`:'')
        +(maxT>0?`<span style="color:var(--text-dim);font-size:8px;margin-left:5px">max ${_fmtInt(Math.round(maxT))} t/d</span>`:'')+`</td>`;
      months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
        const mt=mon.dates.reduce((a,ds)=>a+cell(row,ds).v,0);
        out+=`<td style="border-left:2px solid rgba(var(--${rgb}-rgb),.1);font-size:9px;color:${color};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
        if(!isCol) mon.dates.forEach(ds=>{
          const c=cell(row,ds), di=_dIdx(ds);
          const grips=_campGrips('xfer',c.plan,ds);
          const gPos=grips?'position:relative;':'';
          const clickFn=`showSiloXferPopup('${lk.id}','${d.from}','${d.to}','${ds}')`;
          if(c.real){
            // An actual the simulation could not apply in full (its origin/destination levels
            // disagree with the recorded move) gets an amber top edge; the tooltip says why.
            const rShort=c.moved!=null&&c.moved<c.v-0.5;
            const tip=`${_fmtInt(Math.round(c.v))} t moved · actual${rShort?` — the simulation could apply only ${_fmtInt(Math.round(c.moved))} t (its origin is empty or its destination full that day; entering real inventories fixes that)`:''}`;
            out+=`<td data-ds="${ds}" class="sup-day-${mon.ym} cell-real sx-gt" title="${tip}" onclick="event.stopPropagation();${clickFn}" style="${gPos}${tdSty(ds)}"><div class="sx-bar" style="background:${barColor};box-shadow:inset 0 -2px 0 var(--real)${rShort?',inset 0 2px 0 var(--amber)':''}"><span style="position:absolute;left:4px;top:0;line-height:10px;white-space:nowrap;font-family:var(--mono);font-size:8px;font-weight:700;color:${_barTextColor(barColor)};pointer-events:none">${_fmtInt(Math.round(c.v))}</span></div>${grips}</td>`;
            return;
          }
          const on=!!c.plan&&c.v>0;
          const full=on&&c.moved!=null&&c.moved<=0;
          const short=on&&!full&&c.moved!=null&&c.moved<c.v-0.5;
          const isGap=on&&ds<todayStr; // planned on a day that should have an actual
          const barBg=!on?'transparent':full?_DOWN_HATCH.blocked:_hatchBar(barColor);
          const edges=[]; if(c.plan) edges.push('inset 0 2px 0 var(--plan)');
          if(short) edges.push('inset 0 -2px 0 var(--amber)'); else if(isGap&&!full) edges.push('inset 0 -2px 0 var(--simulated)');
          const tip=!c.plan?'Nothing planned — click to plan a campaign or record an actual'
            :`🔒 Campaign: ${_fmtInt(Math.round(c.v))} t/d${c.plan.start_date!==c.plan.end_date?` (${c.plan.start_date} → ${c.plan.end_date})`:''}`
              +(full?' — nothing could move (origin empty or destination full)':short?` — only ${_fmtInt(Math.round(c.moved))} t could move (origin ran short or destination nearly full)`:'')
              +(ds<todayStr?' · no actual recorded':'');
          const lbl=(lblIdx.has(di)&&on&&!full)?`<span style="${_BAR_LBL_FIT}line-height:10px;font-family:var(--mono);color:${isGap?'var(--simulated)':'var(--bar-lbl)'};text-shadow:0 0 2px var(--bar-lbl-halo),0 0 2px var(--bar-lbl-halo);pointer-events:none">${_fmtInt(Math.round(c.v))} t/d</span>`:'';
          out+=`<td data-ds="${ds}" class="sup-day-${mon.ym}${isGap?' src-gap':''} sx-gt" title="${tip}" onclick="event.stopPropagation();${clickFn}" style="${gPos}${tdSty(ds)}"><div class="sx-bar" style="background:${barBg};${edges.length?`box-shadow:${edges.join(',')};`:''}">${lbl}</div>${grips}</td>`;
        });
      });
      out+=`</tr>`;
    });
    return out;
  };

  const leftW=280;
  const _legSw=(color,label)=>`<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:9px;height:9px;background:${color};border-radius:1px;display:inline-block"></span>${label}</span>`;
  // Per-product legend: products these mills/kilns can produce
  const _legProdIds=new Set();
  DB.element_product_capacities.filter(c=>prodEls.some(e=>e.id===c.element_id)).forEach(c=>_legProdIds.add(c.product_id));
  const _legProds=[..._legProdIds].map(id=>_prodById.get(id)).filter(Boolean).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const _legProdHTML=_legProds.map(p=>`<span style="display:inline-flex;align-items:center;gap:2px">${prodIcon(p)}${p.name}</span>`).join('');
  let h=`<div style="display:flex;flex-wrap:wrap;gap:14px;padding:5px 10px;font-family:var(--mono);font-size:8px;color:var(--text-dim);background:var(--surface);border-bottom:1px solid var(--border);align-items:center">
    <span style="color:var(--text);letter-spacing:.5px">PRODUCT:</span>
    ${_legProdHTML||'<span style="opacity:.6">none</span>'}
    <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:12px;height:9px;border-radius:1px;background:repeating-linear-gradient(45deg,var(--h-maint-a),var(--h-maint-a) 3px,var(--h-maint-b) 3px,var(--h-maint-b) 6px);display:inline-block"></span>Maintenance</span>
    <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:12px;height:9px;border-radius:1px;background:repeating-linear-gradient(45deg,var(--h-maint-a),var(--h-maint-a) 3px,var(--h-starved-b) 3px,var(--h-starved-b) 6px);display:inline-block"></span>Unplanned shortfall</span>
    <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:12px;height:9px;border-radius:1px;background:${_DOWN_HATCH.blocked};display:inline-block"></span>Blocked (silo full)</span>
    <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:12px;height:9px;border-radius:1px;background:${_DOWN_HATCH.repair};display:inline-block"></span>Down for repairs</span>
    <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:12px;height:9px;border-radius:1px;background:${_DOWN_HATCH.pm};display:inline-block"></span>Down PM day</span>
    <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:12px;height:9px;border-radius:1px;background:${_DOWN_HATCH.inv};display:inline-block"></span>Down for inventory control</span>
    <span class="sup-leg-lvl" style="display:contents"><span style="width:1px;height:11px;background:var(--border2);margin:0 2px"></span>
    <span style="color:var(--text);letter-spacing:.5px">INVENTORY:</span>
    ${_legSw('var(--red)','Critical / overflow')}${_legSw('var(--amber)','Low (&lt;25%)')}${_legSw('var(--orange)','Near full (&gt;85%)')}${_legSw('var(--teal)','Healthy')}</span>
    <span style="width:1px;height:11px;background:var(--border2);margin:0 2px"></span>
    <span style="color:var(--text);letter-spacing:.5px">SOURCE:</span>
    <span title="Recorded in daily data or a file" style="color:var(--real);font-weight:700;background:var(--real-faint);padding:0 4px">1,602 actual</span>
    <span title="Simulated" style="color:var(--text-dim)">forecast</span>
    <span title="Committed by a person: campaign, confirmed rail push" style="box-shadow:inset 0 2px 0 var(--plan);padding:1px 4px">planned 🔒</span>
    <span title="A day before today that still shows a simulated value — no actual recorded" style="color:var(--simulated);font-style:italic">past · no actual</span>
  </div>
  <table style="border-collapse:separate;border-spacing:0;font-family:var(--mono);font-size:9px;white-space:nowrap;min-width:max-content">
  <thead><tr>
    <th style="position:sticky;left:0;top:0;z-index:6;background:var(--surface2);color:var(--text-dim);font-size:8px;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border-bottom:2px solid var(--border2);border-right:1px solid var(--border2);text-align:left;min-width:${leftW}px">Equipment / Capacity (t/d)</th>`;

  months.forEach(mon=>{
    const isCol=collapsed.has(mon.ym);
    h+=`<th onclick="_supToggleMonth('${mon.ym}')" style="cursor:pointer;background:var(--surface2);border-left:2px solid var(--blue);border-bottom:2px solid var(--border2);font-size:8px;font-weight:700;color:var(--blue);text-align:center;padding:4px 6px;user-select:none;position:sticky;top:0;z-index:3">
      <span style="margin-right:3px">${isCol?'▶':'▼'}</span>${mon.label}</th>`;
    if(!isCol) mon.dates.forEach(ds=>{
      const ts=ds===todayStr?'border-left:2px solid var(--green);border-right:2px solid var(--green);':thSty(ds);
      h+=`<th class="sup-day-${mon.ym}" style="position:sticky;top:0;z-index:2;background:var(--surface2);color:${isWkend(ds)?'rgba(var(--red-rgb),.6)':ds===todayStr?'var(--green)':'var(--text-dim)'};font-size:8px;padding:5px 4px;border-bottom:2px solid var(--border2);border-right:1px solid rgba(var(--hi-rgb),.03);text-align:right;min-width:52px;${ts}">${ds.slice(8)}</th>`;
    });
  });
  h+=`</tr></thead><tbody>`;

  // Grand total row — all production elements
  h+=`<tr class="sup-tot-hdr" style="background:rgba(var(--blue-rgb),.06)">
    <td style="${stickyLeft('var(--tot-sticky)',0,'border-bottom:1px solid var(--border2),')}color:var(--blue);font-size:10px;font-weight:700">
      <span class="sup-chev">▶</span>TOTAL CAPACITY
      <span style="font-weight:400;font-size:8px;color:var(--text-dim);margin-left:8px">${dataSource}${_pfAll.length?' + purchases':''}</span>
    </td>`;
  months.forEach(mon=>{
    const isCol=collapsed.has(mon.ym);
    const mt=grpMonTotal(prodEls,mon)+_pfMon(_pfAll,mon);
    h+=`<td style="background:rgba(var(--blue-rgb),.1);border-left:2px solid rgba(var(--blue-rgb),.25);font-size:9px;font-weight:700;color:var(--blue);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border2)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
    if(!isCol) mon.dates.forEach(ds=>{
      const dayIdx=_dIdx(ds);
      const v=grpDailyTotal(prodEls,ds,dayIdx)+_pfDay(_pfAll,ds);
      h+=`<td class="sup-day-${mon.ym} ${_srcCls(ds,v,_prodActs(prodEls,ds).concat(_pfActs(_pfAll,ds)))}" style="background:rgba(var(--blue-rgb),.07);font-size:9px;font-weight:700;color:var(--blue);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border2);${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`;
    });
  });
  h+=`</tr>`;

  // ── INVENTORY BAR CHART rows (cement + clinker) ──────────────────────
  // Rendered as table rows so the columns line up exactly with the date grid
  // below and scroll together. One grouped bar per day, one bar per product.
  const _chartInvVal=(siloId, ds, startInv)=>{
    const realInv=_idxFirst('real_inventory_daily','silo_id',siloId,'date',_prevDs(ds));
    if(realInv) return parseFloat(realInv.eod_volume_t)||0;
    const dayIdx=_dIdx(ds);
    const hist=r?.inventoryHistory?.[siloId]||[];
    return dayIdx<=0?(parseFloat(startInv)||0):(hist[dayIdx-1]??0);
  };
  // extraFn(pid,ds) → extra tonnes stacked ON TOP of the available bar (lighter shade) —
  // used at rail terminals to show cement still on rail (in transit + local yard).
  // secKey → the inventory section this chart belongs to (e.g. 'clinkerInv'); when set the
  // chart row also carries class supsec-<secKey> so collapsing that section title hides it too.
  // One bar per product, or one bar per SILO when a product sits in several silos (see the
  // series block below) — physically separate silos must never be summed into one bar.
  // The chart's key: silo id → its bar's colour + name, filled by _invChartRow, which each block
  // calls before its silo rows. The rows carry the coloured square instead of a legend.
  const _siloBar={};
  const _siloChip=si=>{ const b=_siloBar[si.id]; return b?`<span title="${esc(b.name)}" style="display:inline-block;width:7px;height:7px;background:${b.color};border-radius:1px;margin-right:4px;vertical-align:-1px"></span>`:''; };
  const _invChartRow=(label, cat, accent, scopeEls, depth, onlyPid, extraFn, secKey)=>{
    // 'packed' reads packed_silo elements (any product they hold); 'bulk' reads bulk_silo
    // elements accepting ANY category (terminal blocks mix cement + SCM side-by-side);
    // everything else reads bulk_silo filtered to one category.
    const _catOk=pr=>(cat==='packed'||cat==='bulk')?true:(pr&&(cat==='cement'?(pr.category==='cement_bulk'||pr.category==='cement_packed')
                        :cat==='scm'?(pr.category==='additive')
                        :(pr.category==='clinker')));
    const _siloType=cat==='packed'?'packed_silo':'bulk_silo';
    const silos=(scopeEls||getFacElements()).filter(e=>e.type===_siloType).filter(s=>getSiloProducts(s).some(p=>_catOk(_prodById.get(p))));
    if(!silos.length) return '';
    // Packed silos store pallets; the sim runs them in tonnes → convert start inventory for day-0 bars.
    const _startInvOf=s=>cat==='packed'?_siloStartT(s):s.props?.start_inventory;
    const prodMap={};
    silos.forEach(s=>{ const pid=getSiloProducts(s)[0]; if(!pid) return; (prodMap[pid]=prodMap[pid]||[]).push(s); });
    let prodIds=Object.keys(prodMap); if(!prodIds.length) return '';
    // onlyPid → chart a single product, or an ARRAY of products (terminal category
    // blocks chart all their products side-by-side). Otherwise respect the page
    // product filter — narrow to the allowed products when at least one of them belongs
    // to this chart's category (so a cement filter doesn't blank the clinker chart, and
    // vice-versa; a Family/Category pick can keep several products on the chart).
    const _narrow=ids=>{ const k=ids.filter(_supProdAllows); return (_supAllowedPids&&k.length)?k:ids; };
    if(Array.isArray(onlyPid))   prodIds=_narrow(prodIds.filter(p=>onlyPid.includes(p)));
    else if(onlyPid)             prodIds=prodIds.filter(p=>p===onlyPid);
    else                         prodIds=_narrow(prodIds);
    if(!prodIds.length) return '';
    const colorFor=pid=>{ const nm=_prodById.get(pid)?.name||pid; return (typeof spProdColor==='function')?spProdColor(nm,false):accent; };
    const nameOf=pid=>_prodById.get(pid)?.name||pid;
    // ── SERIES = one bar per product, EXCEPT when a product is held in more than one silo.
    //    Those silos are physically separate (BRS clinker CLKL_01 / CLKL_02 each sit on their
    //    own kiln→mill line and cannot be shared — see DB.connections), so summing them lets a
    //    full silo mask an empty one. Split → one bar per silo, same product colour lightened
    //    per sibling so they still read as the same material. Single-silo products are
    //    untouched, so cement / packed / terminal charts look exactly as before.
    // Silo labels: shortest trailing path segment(s) that tell this group's silos apart
    // (BRS/INV/RAIL/BLK vs BRS/INV/BRS_IL/BLK both end in "BLK" → "RAIL/BLK" / "BRS_IL/BLK").
    const _siloLabels=ss=>{ const parts=ss.map(s=>String(s.name||s.id).split('/'));
      for(let k=1;k<=Math.max(...parts.map(p=>p.length));k++){
        const lbl=parts.map(p=>p.slice(-k).join('/'));
        if(new Set(lbl).size===lbl.length) return lbl;
      }
      return ss.map(s=>String(s.name||s.id)+' ('+s.id+')'); };
    const _lighten=(col,step)=>step?`color-mix(in srgb, ${col} ${Math.max(35,100-step*30)}%, #ffffff)`:col;
    const series=[];
    prodIds.forEach(pid=>{
      const ss=prodMap[pid];
      if(ss.length<=1){ series.push({key:pid,pid,silos:ss,name:nameOf(pid),color:colorFor(pid),split:false}); return; }
      const lbls=_siloLabels(ss);
      ss.forEach((si,i)=>series.push({key:pid+'|'+si.id,pid,silos:[si],name:nameOf(pid)+' · '+lbls[i],color:_lighten(colorFor(pid),i),split:true}));
    });
    series.forEach(se=>se.silos.forEach(si=>{ _siloBar[si.id]={color:se.color,name:se.name}; }));
    const inv={}; const ext={}; let gmax=0;
    series.forEach(se=>{ inv[se.key]={}; ext[se.key]={}; allDates.forEach(ds=>{ const v=se.silos.reduce((a,si)=>a+_chartInvVal(si.id,ds,_startInvOf(si)),0); inv[se.key][ds]=v;
      // extraFn is per PRODUCT (cement still on rail); only meaningful on an unsplit series.
      const ex=(extraFn&&!se.split)?Math.max(0,extraFn(se.pid,ds)||0):0; ext[se.key][ds]=ex;
      if(v+ex>gmax)gmax=v+ex; }); });
    if(gmax<=0) gmax=1;
    const H=88;
    const _invMode=_supInvMode();   // 'vol' = tonnes (default) · 'days' = days of inventory

    // ── Days-of-cover denominator: FORWARD-LOOKING future requirements — average
    //    forecast demand over the NEXT 14 days from each bar's date. Cement = product
    //    demand; clinker = clinker consumed to make cement (via recipes). The number
    //    on a bar = that day's inventory ÷ that date's forward-14-day rate = how long
    //    the stock lasts against upcoming demand with no further production. ──
    const _scopeDpEls=(scopeEls||getFacElements()).filter(e=>e.type==='demand_point');
    const _scopeDps=DB.demand_points.filter(dp=>_scopeDpEls.some(el=>el.id===dp.element_id));
    // Per-product daily demand/consumption over the dates in view PLUS up to 13 simulated
    // days past the last one, so a bar near the end of the time frame still averages a full
    // 14 days — a date's cover must not depend on the time frame (computed once).
    // _useIdx[ds] = a date's position in _useDates (NOT a simulation day).
    const _useDates=allDates.concat(_simDates.slice(_simDayIdx.get(allDates[allDates.length-1])+1).slice(0,13));
    const _useIdx={}; allDates.forEach((d,i)=>_useIdx[d]=i);
    const _dailyUse={};
    prodIds.forEach(pid=>{
      if(cat!=='clinker'){ // cement + SCM = direct product demand
        const _dps=_scopeDps.filter(dp=>_dpFirstProd(dp)===pid);
        _dailyUse[pid]=_useDates.map(ds=>_dps.reduce((s,dp)=>s+(_demandRate(dp.element_id,ds)||0),0));
        return;
      }
      // clinker: the (demand point, recipe %) terms are fixed per product — collected once, in the
      // same order as before, then summed per date.
      const _terms=[];
      _scopeDps.forEach(dp=>{ (dp.products||[]).filter(p=>p.product_id===_dpFirstProd(dp)).forEach(p=>{
        const prod=_prodById.get(p.product_id);
        if(prod&&(prod.category==='cement_bulk'||prod.category==='cement_packed')){
          _recipeRows(p.product_id).filter(rc=>rc.material_id===pid).forEach(rc=>{ _terms.push([dp.element_id,(parseFloat(rc.pct)||0)]); });
        }
      }); });
      _dailyUse[pid]=_useDates.map(ds=>{ let t=0; for(let i=0;i<_terms.length;i++){ const cd=_demandRate(_terms[i][0],ds)||0; t+=cd*_terms[i][1]/100; } return t; });
    });
    // Average of the next 14 days starting at date-index di.
    const _fwdRate=(pid,di)=>{ const arr=_dailyUse[pid]||[]; let sum=0,n=0; for(let k=di;k<Math.min(arr.length,di+14);k++){ sum+=arr[k]; n++; } return n?sum/n:0; };
    const _coverDays=(pid,di,v)=>{ const rt=_fwdRate(pid,di); if(!rt||rt<=0||v<=0) return ''; const d=v/rt; return d>=10?Math.round(d):Math.round(d*10)/10; };
    // Split series: the product's forward demand is shared across its silos, so each bar is
    // measured against its own equal share of the load (v ÷ rate/n) — otherwise both bars
    // would claim to cover the whole product on their own.
    const _coverSe=(se,di,v)=>{ const n=se.split?prodMap[se.pid].length:1;
      const rt=_fwdRate(se.pid,di)/n; if(!rt||rt<=0||v<=0) return ''; const d=v/rt; return d>=10?Math.round(d):Math.round(d*10)/10; };
    const _anySplit=series.some(se=>se.split);
    const _hintTail=`${_anySplit?' · one bar per silo where a product is stored in several (not shareable)':''}${extraFn?' · lighter top = on rail (transit + rail yard + local yard)':''}`;
    const chartHint=_invMode==='days'
      ?`scale 0–${INV_DAYS_CAP} days of cover (next-14-day demand) · # on bar = tonnes · light cap = beyond ${INV_DAYS_CAP} days · faded dashed = stock with no demand in the window${_hintTail}`
      :`scale max ${_fmtInt(Math.round(gmax))} t · # on bar = days of cover (next-14-day demand)${_hintTail}`;
    let row=`<tr class="sup-chart-row${secKey?' supsec-'+secKey:''}" data-chart="${cat}"><td title="${chartHint}" style="${stickyLeft('var(--surface)',depth!=null?depth:1,'border-bottom:2px solid var(--border2),')}vertical-align:bottom;padding-top:5px;padding-bottom:5px">
      <div style="color:${accent};font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase">${label} <span style="opacity:.35;font-weight:400;font-size:8px;margin-left:3px;cursor:help">ⓘ</span></div>
    </td>`;
    months.forEach(mon=>{
      const isCol=collapsed.has(mon.ym);
      row+=`<td style="border-left:2px solid var(--border2);background:var(--surface);vertical-align:bottom;padding:0"></td>`;
      if(!isCol) mon.dates.forEach(ds=>{
        const bars=series.map(se=>{
          const v=inv[se.key][ds]||0;
          const ex=ext[se.key][ds]||0;
          const cd=_coverSe(se,_useIdx[ds],v);
          const bcol=_thChartCol(se.color,ds>=todayStr);
          if(_invMode==='days'){
            // Height = days of cover on the fixed 0..INV_DAYS_CAP axis. Two cases have no
            // height of their own: stock the next 14 days ask nothing of has no cover at all
            // (undefined, not zero) → full height, faded and dashed; a bar past the top of the
            // scale → full height with a light cap. The number on the bar carries the tonnes,
            // so both figures stay on screen in either mode.
            // Drawn 8px short of the box so the tonnes above a full-height bar stay inside
            // the row — in this mode many bars sit at the cap, not just the single tallest one.
            const Hd=H-8;
            const px=c=>Math.max(1,Math.round(Math.min(c,INV_DAYS_CAP)/INV_DAYS_CAP*Hd));
            const noDem=v>0&&cd==='';
            const capped=cd!==''&&cd>INV_DAYS_CAP;
            const hpx=v<=0?0:((noDem||capped)?Hd:px(cd));
            // Cargo still on rail stacks on top, converted to days the same way.
            const cdT=(ex>0&&!noDem&&!capped)?_coverSe(se,_useIdx[ds],v+ex):'';
            const expx=(cdT!==''&&cdT>(cd===''?0:cd))?Math.max(1,px(cdT)-hpx):0;
            const lbl=v>0?`<div class="sx-cbl" style="color:${se.color}">${_tAbbrev(v)}</div>`:'';
            const extBar=expx>0?`<div class="sx-cbe" style="height:${expx}px;background:${se.color};border-top:1px dashed ${se.color}"></div>`:'';
            const barSty=noDem?`opacity:.25;border-top:1px dashed ${se.color};`:(capped?'border-top:2px solid var(--text);':'');
            const ttl=`${se.name}: ${_fmtInt(Math.round(v))} t${ex>0?` + ${_fmtInt(Math.round(ex))} t on rail (transit+yard)`:''} · ${ds} · ${noDem?'no demand in the next 14 days':(cd===''?'no stock':'~'+cd+'d cover'+(capped?` — beyond the ${INV_DAYS_CAP}d scale`:''))}${se.split?' · this silo only':''}`;
            return `<div class="sx-cb" title="${ttl}">${lbl}${extBar}<div class="sx-cbi" style="height:${hpx}px;background:${bcol};${barSty}border-radius:${expx>0?'0':'1px 1px 0 0'}"></div></div>`;
          }
          const hpx=v>0?Math.max(1,Math.round(v/gmax*H)):0;
          const expx=ex>0?Math.max(1,Math.round(ex/gmax*H)):0;
          const lbl=cd!==''?`<div class="sx-cbl" style="color:${se.color}">${cd}</div>`:'';
          const extBar=expx>0?`<div class="sx-cbe" style="height:${expx}px;background:${se.color};border-top:1px dashed ${se.color}"></div>`:'';
          const ttl=ex>0?`${se.name}: ${_fmtInt(Math.round(v))} t available + ${_fmtInt(Math.round(ex))} t on rail (transit+yard) = ${_fmtInt(Math.round(v+ex))} t total · ${ds}${cd!==''?' · ~'+cd+'d cover (available)':''}`
            :`${se.name}: ${_fmtInt(Math.round(v))} t · ${ds}${cd!==''?' · ~'+cd+'d cover':''}${se.split?' · this silo only':''}`;
          return `<div class="sx-cb" title="${ttl}">${lbl}${extBar}<div class="sx-cbi" style="height:${hpx}px;background:${bcol};border-radius:${expx>0?'0':'1px 1px 0 0'}"></div></div>`;
        }).join('');
        row+=`<td class="sup-day-${mon.ym} sx-ct"${(s=>s?` style="${s}"`:'')(tdSty(ds))}><div class="sx-ctd" style="height:${H}px;${ds===todayStr?'background:rgba(var(--green-rgb),.06)':''}">${bars}</div></td>`;
      });
    });
    return row+`</tr>`;
  };
  // Inventory bar charts are now rendered inside each facility's flow:
  //   cement chart  → between CEMENT NEED and STARTING INVENTORY (cement)
  //   clinker chart → between CLINKER REQUIREMENTS and CLINKER INVENTORY
  // (so they sit with their data and inherit the facility + product filters).

  // Walk tree
  const typeBg={mr:'rgba(var(--hi-rgb),.04)',co:'rgba(var(--hi-rgb),.04)',reg:'rgba(var(--hi-rgb),.03)',sub:'rgba(var(--hi-rgb),.02)',fac:'rgba(var(--amber-rgb),.04)'};
  const typeBgSolid={mr:'var(--surface2)',co:'var(--surface2)',reg:'var(--surface)',sub:'var(--surface)',fac:'var(--surface2)'};
  const typeColors={mr:'var(--text)',co:'var(--text)',reg:'var(--text-dim)',sub:'var(--text-dim)',fac:'var(--amber)'};

  // Terminal slots left in the tree: facility id → depth. The TERMINALS block below renders
  // each one and splices it in at its <!--sup-term:ID--> marker.
  const _termSlots=new Map();

  tree.forEach(node=>{
    const isCollapsed=grpCol.has(node.id);
    const parentCollapsed=node.parents.some(id=>grpCol.has(id));
    if(parentCollapsed) return;

    if(node.term){
      _termSlots.set(node.id,node.depth);
      h+=`<!--sup-term:${node.id}-->`;
    } else if(node.type==='fac'){
      h+=`<tr class="sup-grp-hdr" onclick="_supToggleGrp('${node.id}')" style="cursor:pointer;background:${typeBg.fac};border-top:1px solid var(--border2)">
        <td style="${stickyLeft(typeBgSolid.fac,node.depth,'border-bottom:1px solid var(--border),')}color:var(--amber);font-weight:700;font-size:9px">
          <span class="sup-chev">${isCollapsed?'▶':'▼'}</span>${node.name}
        </td>`;
      // Expanded: no numbers on the facility line — summed kiln + mill + packer capacity mixes
      // clinker with cement and says nothing useful; the sections below carry the detail.
      // Collapsed: the line is all the user sees of the plant, so it shows the plant's
      // output — finish-mill cement (kiln clinker at a clinker-only plant, packed tonnes at
      // a packing-only site) — with the same real / past-no-actual / forecast look as the
      // rows it stands in for.
      const _outEls=node.mills.length?node.mills:(node.kilns.length?node.kilns:node.packers);
      const _outLbl=node.mills.length?'finish-mill output':(node.kilns.length?'kiln output':'packing output');
      months.forEach(mon=>{
        const isCol=collapsed.has(mon.ym);
        const mt=isCollapsed?grpMonTotal(_outEls,mon):0;
        h+=`<td style="background:rgba(var(--amber-rgb),.06);border-left:2px solid rgba(var(--amber-rgb),.2);font-size:9px;font-weight:700;color:var(--total);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
        if(!isCol) mon.dates.forEach(ds=>{
          if(!isCollapsed){ h+=`<td class="sup-day-${mon.ym}" style="background:rgba(var(--amber-rgb),.04);font-size:9px;font-weight:700;color:var(--total);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border);${tdSty(ds)}"></td>`; return; }
          const v=grpDailyTotal(_outEls,ds,_dIdx(ds));
          h+=`<td class="sup-day-${mon.ym} ${_srcCls(ds,v,_prodActs(_outEls,ds))}" title="${_outLbl} · expand the plant for the detail" style="background:rgba(var(--amber-rgb),.04);font-size:9px;font-weight:700;color:var(--total);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border);${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`;
        });
      });
      h+=`</tr>`;

      if(!isCollapsed){
        // ╔══════════════════════════════════════════════════════════════╗
        // ║ FACILITY-SCOPED SUPPLY CHAIN FLOW                            ║
        // ║ Filter elements to current facility using assigned_facility  ║
        // ║ as the authoritative source (assigned_facility_id overrides  ║
        // ║ facility_id). This ensures data isolation: each facility      ║
        // ║ sees only its own demand points, silos, and equipment.       ║
        // ╚══════════════════════════════════════════════════════════════╝
        const facEls=allEls.filter(e=>(e.assigned_facility_id||e.facility_id)===node.id);
        const demandEls=facEls.filter(e=>e.type==='demand_point');
        const demandPoints=DB.demand_points.filter(dp=>demandEls.some(el=>el.id===dp.element_id));

        // ── PACKED-product scope (for the packing block) ──
        // Packed products = outputs of this facility's packing lines ∪ products held in its packed
        // silos. These are pulled OUT of the CEMENT block (requirements/inventory) and shown in
        // their own packing block so the two streams don't double-count.
        const _packEls=facEls.filter(e=>e.type==='packing_plant');
        const _packedSilos=facEls.filter(e=>e.type==='packed_silo');
        const packedProductIds=new Set();
        _packEls.forEach(pk=>(_capsByEl.get(pk.id)||[]).filter(c=>_isPackingRow(c))
          .forEach(c=>{ if(c.product_id) packedProductIds.add(c.product_id); }));
        _packedSilos.forEach(si=>getSiloProducts(si).forEach(p=>packedProductIds.add(p)));

        // Capture the CEMENT block separately so it can be emitted AFTER the
        // CLINKER block (display order: clinker first, then a thick line, then cement).
        const _cemStart=h.length;

        // ══════════════════════════════════════════════════════════════
        // SECTION 1: TOTAL NEED (direct demand + rail loading in tonnes)
        // ══════════════════════════════════════════════════════════════
        {
          const prodReqColor='var(--blue)';
          // Collect unique products from demand points at this facility
          const productsSet=new Set();
          demandPoints.forEach(dp=>{
            (dp.products||[]).forEach(p=>{ productsSet.add(p.product_id); });
            const _fp=_dpFirstProd(dp); if(_fp) productsSet.add(_fp);
          });
          // Also add products from rail dispatch points at this facility
          const dispEls=facEls.filter(e=>e.type==='dispatch_point'&&e.props?.dispatch_type==='Rail');
          dispEls.forEach(dispEl=>{
            if(r?.railHistory?.[dispEl.id]){
              r.railHistory[dispEl.id].forEach(entry=>{
                Object.keys(entry?.carsLoadedByProduct||{}).forEach(pid=>productsSet.add(pid));
              });
            }
            (dispEl.props?.destinations||[]).forEach(dest=>{
              (dest.accepted_products||[]).forEach(pid=>productsSet.add(pid));
            });
          });

          // Tonnes of this product loaded onto rail cars on a date (cars × car capacity).
          // Split out of totalNeed so the per-product breakdown rows can show it as its own
          // line — it's part of the requirement but is NOT demand-point demand, so without
          // it the nested INT/EXT/IND rows don't add up to the product total on loading days.
          const _railLoadT=(prodId, ds)=>{
            const dayIdx=_dIdx(ds);
            if(dayIdx<0) return 0;
            return dispEls.reduce((sum,dispEl)=>{
              const rh=r?.railHistory?.[dispEl.id]||[];
              const cars=rh[dayIdx]?.carsLoadedByProduct?.[prodId]||0;
              const carCap=parseFloat(dispEl.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
              return sum+cars*carCap;
            },0);
          };
          // Helper: total need for a product on a given date
          // = local direct demand + (rail cars loaded × car_capacity_t)
          const _dpsMemo=new Map();   // demand points of a product, once per product (not per cell)
          const _dpsOf=prodId=>{ let a=_dpsMemo.get(prodId); if(!a){ a=demandPoints.filter(dp=>_dpFirstProd(dp)===prodId); _dpsMemo.set(prodId,a); } return a; };
          const _demElIds=new Set(demandEls.map(e=>e.id));
          const totalNeed=(prodId, ds)=>{
            const dpts=_dpsOf(prodId);
            const directDemand=dpts.reduce((sum,dp)=>sum+(_demandRate(dp.element_id,ds)||0),0);
            return directDemand+_railLoadT(prodId,ds);
          };

          // ── Demand-swap split (so the need line reflects substitutions) ──
          // swappedOut: this facility's own demand for prodId that a manager
          //   re-sourced to a substitute material (drops this product's need).
          const swappedOut=(prodId, ds)=>{
            let q=0;
            _dpsOf(prodId).forEach(dp=>{
              if(!_demElIds.has(dp.element_id)) return;
              const t=_demandRate(dp.element_id,ds)||0;
              const sw=(typeof _resolveDemandSwap==='function')?_resolveDemandSwap(dp.element_id,t,ds):null;
              if(sw) q+=Math.min(sw.qty,t);
            });
            return q;
          };
          // swappedIn: prodId demand RISING at this facility because a swap's
          //   DESTINATION demand point lives here (point-to-point relocation). Summed
          //   over this facility's prodId demand points via _resolveDemandSwapIn,
          //   so it lands exactly where the destination point is — no redistribution,
          //   no injection at the producer.
          const _dpDisp=id=>DB.elements.find(e=>e.id===id)?.name||DB.demand_points.find(d=>d.element_id===id)?.element_name||id;
          const swappedIn=(prodId, ds)=>{
            let q=0;
            _dpsOf(prodId).forEach(dp=>{
              q+=(typeof _resolveDemandSwapIn==='function')?_resolveDemandSwapIn(dp.element_id,ds,(id)=>_demandRate(id,ds)):0;
            });
            return q;
          };
          const _outTargets=(prodId)=>{ const n=new Set();
            _dpsOf(prodId).forEach(dp=>{
              (DB.demand_substitutions||[]).filter(s=>s.from_element_id===dp.element_id).forEach(s=>n.add(s.to_element_id?_dpDisp(s.to_element_id):(_prodById.get(s.to_product_id)?.name||s.to_product_id))); });
            return [...n].join(', '); };
          const _inSources=(prodId)=>{ const n=new Set();
            _dpsOf(prodId).forEach(dp=>{
              (DB.demand_substitutions||[]).filter(s=>s.to_element_id===dp.element_id).forEach(s=>n.add(_dpDisp(s.from_element_id))); });
            return [...n].join(', '); };
          // Surface a substitute product here even if it has no direct demand at
          // this facility — when one of this facility's demand points switched to
          // it (swappedIn>0) — so the "swapped in" breakdown has a row to hang on.
          (DB.demand_substitutions||[]).forEach(s=>{ if(allDates.some(ds=>swappedIn(s.to_product_id,ds)>0)) productsSet.add(s.to_product_id); });
          // Packed products belong to the packing block — drop them from CEMENT REQUIREMENTS.
          packedProductIds.forEach(pid=>productsSet.delete(pid));
          // Drop products the Family/Category/Product filters exclude.
          [...productsSet].forEach(pid=>{ if(!_supProdAllows(pid)) productsSet.delete(pid); });

          // A product's requirement HERE = its own need (+ rail loading) + whatever a swap moves
          // INTO this facility's demand points, so the ↳ own / ↳ swapped in rows add up to it.
          // Swaps only run on forecast days — actual days are just the actuals.
          const needHere=(prodId, ds)=>totalNeed(prodId,ds)+swappedIn(prodId,ds);

          if(productsSet.size>0){
            // Section header row
            h+=`<tr class="sup-sec-hdr" data-seckey="cementNeed" onclick="_supToggleSec('cementNeed')" style="cursor:pointer;background:rgba(var(--blue-rgb),.05);border-top:2px solid rgba(var(--blue-rgb),.3)">
              <td title="Direct + Transfer Demand" style="${stickyLeft('var(--surface)',node.depth+1,'border-bottom:1px solid var(--border),')}color:${prodReqColor};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow('cementNeed')}</span> CEMENT REQUIREMENTS <span style="opacity:.35;font-weight:400;font-size:8px;margin-left:3px;cursor:help">ⓘ</span></td>`;
            months.forEach(mon=>{
              const isCol=collapsed.has(mon.ym);
              const mt=[...productsSet].reduce((s,pid)=>s+mon.dates.reduce((a,ds)=>a+needHere(pid,ds),0),0);
              h+=`<td style="border-left:2px solid rgba(var(--blue-rgb),.2);font-size:9px;font-weight:700;color:${prodReqColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
              if(!isCol) mon.dates.forEach(ds=>{
                const v=[...productsSet].reduce((s,pid)=>s+needHere(pid,ds),0);
                h+=`<td class="sup-day-${mon.ym} sx-nb" style="color:${prodReqColor};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):''}</td>`;
              });
            });
            h+=`</tr>`;

            // One row per product: total need
            Array.from(productsSet).sort().forEach(prodId=>{
              const prod=_prodById.get(prodId);
              const prodName=prod?.name||prodId;
              const _dpnDpts=_dpsOf(prodId);
              const _dpnBase=node.id+'_cementNeed_'+prodId;
              // Rail loading is part of this product's requirement but isn't demand-point
              // demand — show it as its own breakdown line so the children reconcile to the
              // parent. Only emitted when cars are actually loaded for this product.
              const _dpnExtra=allDates.some(ds=>_railLoadT(prodId,ds)>0)
                ? [{label:'🚂 rail loading (to terminals)', color:'var(--purple)',
                    title:'Tonnes of this product loaded onto rail cars for shipment to terminals — counted in the requirement above, but not local demand-point demand.',
                    valFn:ds=>_railLoadT(prodId,ds), srcFn:(ds,v)=>_srcCls(ds,v,[_railReal(node.id,ds)])}]
                : [];
              h+=`<tr class="supsec-cementNeed">
                <td ondblclick="_openSwapForProduct('${prodId}','')" title="Double-click to cover part of this material's demand with a substitute" style="cursor:pointer;${stickyLeft('var(--surface)',node.depth+2,'border-bottom:1px solid var(--border),')}color:${prodReqColor};font-size:9px">${esc(prodName)}${(_dpnDpts.length||_dpnExtra.length)?_supDpnArrow(_dpnBase,_dpnDpts.length,_dpnExtra.length):''}</td>`;
              months.forEach(mon=>{
                const isCol=collapsed.has(mon.ym);
                const mt=mon.dates.reduce((s,ds)=>s+needHere(prodId,ds),0);
                h+=`<td ondblclick="_openSwapForProduct('${prodId}','${mon.dates[0]||''}')" title="Double-click to swap part of this demand to another material" style="cursor:pointer;border-left:2px solid rgba(var(--blue-rgb),.1);font-size:9px;color:${prodReqColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                if(!isCol) mon.dates.forEach(ds=>{
                  const v=needHere(prodId,ds);
                  const _acts=_dmdActs(_dpnDpts,ds); if(_railLoadT(prodId,ds)>0) _acts.push(_railReal(node.id,ds));
                  if(swappedIn(prodId,ds)>0) _acts.push(..._swapInActs(_dpnDpts,ds));
                  h+=`<td class="sup-day-${mon.ym} ${_srcCls(ds,v,_acts)} sx-np" ondblclick="_openSwapForProduct('${prodId}','${ds}')" title="Double-click to swap part of this demand to another material" style="color:${v>0?prodReqColor:'rgba(var(--blue-rgb),calc(var(--zero-k)*.3))'};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`;
                });
              });
              h+=`</tr>`;
              h+=_supDpnRows(_dpnDpts, months, collapsed, tdSty, node.depth+3, _dpnBase, stickyLeft, _dpnExtra.concat(typeof plBgtExtra==='function'?plBgtExtra(_dpnDpts):[]), 'cementNeed');

              // ── Swap breakdown child rows (only when a swap touches this product) ──
              // They carry the product's ▶ fold key too (here and in the terminal block): collapsing the
              // product leaves just its line with the daily totals; own / swapped lines fold with the demand points.
              const outArr=allDates.map(ds=>swappedOut(prodId,ds));
              const inArr=allDates.map(ds=>swappedIn(prodId,ds));
              const hasOut=outArr.some(v=>v>0), hasIn=inArr.some(v=>v>0);
              if(hasOut||hasIn){
                const idxOf={}; allDates.forEach((ds,i)=>idxOf[ds]=i);
                const swapChild=(label,color,bg,valFn,actsFn)=>{
                  let rr=`<tr class="supsec-cementNeed supsec-${_supDpnKey(_dpnBase)} sup-sub-row" style="background:${bg}"><td style="${stickyLeft('var(--surface)',node.depth+3,'border-bottom:1px solid var(--border),')}color:${color};font-size:8px;font-style:italic">${label}</td>`;
                  months.forEach(mon=>{
                    const isCol=collapsed.has(mon.ym);
                    const mt=mon.dates.reduce((s,ds)=>s+valFn(ds),0);
                    rr+=`<td style="border-left:2px solid rgba(var(--hi-rgb),.05);font-size:8px;color:${color};text-align:right;padding:3px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                    if(!isCol) mon.dates.forEach(ds=>{ const v=valFn(ds); rr+=`<td class="sup-day-${mon.ym} ${actsFn?_srcCls(ds,v,actsFn(ds)):''}" style="font-size:8px;color:${color};text-align:right;padding:3px 4px;border-bottom:1px solid var(--border);${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):''}</td>`; });
                  });
                  return rr+`</tr>`;
                };
                const ownFn=ds=>{ const i=idxOf[ds]; return Math.max(0,totalNeed(prodId,ds)-(outArr[i]||0)); };
                const ownActs=ds=>_dmdActs(_dpnDpts,ds), inActs=ds=>_swapInActs(_dpnDpts,ds);
                h+=swapChild('↳ '+prodName+' · own','var(--green)','rgba(76,175,80,.03)',ownFn,ownActs);
                if(hasOut) h+=swapChild('↳ ⇄ swapped out → '+(_outTargets(prodId)||'substitute'),'var(--amber)','rgba(var(--amber-rgb),.05)',ds=>outArr[idxOf[ds]]||0,ownActs);
                // (no "= to produce" row: the product line above already is own + swapped in)
                if(hasIn) h+=swapChild('↳ ⇄ swapped in ← '+(_inSources(prodId)||'other demand'),'var(--cyan)','rgba(var(--cyan-rgb),.06)',ds=>inArr[idxOf[ds]]||0,inActs);
              }
            });
          }
        }

        // End of CEMENT REQUIREMENTS — capture boundary so chart+inventory can be reordered above it.
        const _cemNeed1=h.length;

        // ── CEMENT inventory bar chart ──
        h+=_invChartRow('Cement inventory','cement','var(--teal)',facEls,node.depth+1,null,null,'cementInv');

        // ══════════════════════════════════════════════════════════════
        // SECTION 2: STARTING INVENTORY (cement silos, per silo)
        // ══════════════════════════════════════════════════════════════
        const cementSilos=facEls.filter(e=>e.type==='bulk_silo').filter(s=>{
          const siloProds=getSiloProducts(s);
          return siloProds.some(p=>{
            const prod=_prodById.get(p);
            return prod&&(prod.category==='cement_bulk'||prod.category==='cement_packed');
          });
        // Hide a silo whose contents the Family/Category/Product filters exclude, so
        // the section lists only the products the user asked to see (empty → the whole
        // STARTING INVENTORY block is skipped by the length guard below).
        }).filter(s=>getSiloProducts(s).some(_supProdAllows));

        if(cementSilos.length>0){
          const invColor='var(--teal)';
          // Helper to get inventory value (checks actual data first, then simulated)
          const getInventoryValue=(siloId, dateStr, startInv)=>{
            // For date X: display BEGINNING inventory = ENDING of day X-1
            // So ONLY check previous day's real inventory data
            const prevDateStr=_prevDs(dateStr);

            // Check ONLY previous day's ending inventory (becomes today's beginning)
            const realInv=_idxFirst('real_inventory_daily','silo_id',siloId,'date',prevDateStr);

            if(realInv) return {value:parseFloat(realInv.eod_volume_t)||0, isActual:true};

            // Fall back to simulated
            const dayIdx=_dIdx(dateStr);
            const hist=r?.inventoryHistory?.[siloId]||[];
            const v=dayIdx<=0?parseFloat(startInv)||0:hist[dayIdx-1]??0;
            return {value:v, isActual:false};
          };
          // Section header — total = sum of all cement silos on hand (filter-scoped)
          const _cemInvDay=ds=>cementSilos.reduce((s,si)=>s+getInventoryValue(si.id,ds,parseFloat(si.props?.start_inventory)||0).value,0);
          h+=`<tr class="sup-sec-hdr" data-seckey="cementInv" onclick="_supToggleSec('cementInv')" style="cursor:pointer;background:rgba(var(--teal-rgb),.05);border-top:2px solid rgba(var(--teal-rgb),.3)">
            <td style="${stickyLeft('var(--surface)',node.depth+1,'border-bottom:1px solid var(--border),')}color:${invColor};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow('cementInv')}</span> STARTING INVENTORY (cement)</td>`;
          months.forEach(mon=>{
            const isCol=collapsed.has(mon.ym);
            const mt=mon.dates.reduce((a,ds)=>a+_cemInvDay(ds),0)/(mon.dates.length||1);
            h+=`<td class="sx-mavg" style="border-left:2px solid rgba(var(--teal-rgb),.2);font-size:9px;font-weight:700;color:${invColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
            if(!isCol){
              mon.dates.forEach(ds=>{
                const v=_cemInvDay(ds);
                h+=`<td class="sup-day-${mon.ym} sx-nb" style="color:${invColor};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):''}</td>`;
              });
            }
          });
          h+=`</tr>`;

          // One row per silo
          cementSilos.forEach(silo=>{
            const siloMax=parseFloat(silo.props?.max_capacity)||0;
            h+=`<tr class="supsec-cementInv">
              <td style="${stickyLeft('var(--surface)',node.depth+2,'border-bottom:1px solid var(--border),')}color:${invColor};font-size:9px" title="${esc(silo.name)}">${_siloChip(silo)}${_supLeafLabel(silo.name)}${_supInactTag(silo)}
                <span style="color:var(--text-dim);font-size:8px;margin-left:4px">${siloMax>0?'cap: '+siloMax.toLocaleString()+'t':''}</span>
              </td>`;
            const siloStart=parseFloat(silo.props?.start_inventory)||0;
            months.forEach(mon=>{
              const isCol=collapsed.has(mon.ym);
              const mt=mon.dates.reduce((s,ds)=>{
                const inv=getInventoryValue(silo.id, ds, siloStart);
                return s+inv.value;
              },0);
              const avgMonthly=mt/mon.dates.length;
              h+=`<td class="sx-mavg" style="border-left:2px solid rgba(var(--teal-rgb),.1);font-size:9px;color:${invColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${avgMonthly>0?_fmtInt(Math.round(avgMonthly)):''}</td>`;
              if(!isCol){
                mon.dates.forEach((ds)=>{
                  const inv=getInventoryValue(silo.id, ds, siloStart);
                  const v=inv.value;
                  const lvlColor=invLevelColor(v, siloMax);
                  const cellWeight=inv.isActual?'700':'400';
                  const cellClass=inv.isActual?'cell-real':(ds<todayStr&&v>0?'cell-gap':'');
                  const lvlTitle=(siloMax>0?`${Math.round(v/siloMax*100)}% of ${siloMax.toLocaleString()}t capacity${inv.isActual?' · actual':''}`:'')+' · click to set real inventory';
                  h+=`<td class="sup-day-${mon.ym} ${cellClass} sx-np" title="${lvlTitle}" onclick="showInventoryPopup('${silo.id}','${ds}')" style="color:${v>0?lvlColor:'rgba(var(--teal-rgb),calc(var(--zero-k)*.3))'};font-weight:${cellWeight};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`;
                });
              }
            });
            h+=`</tr>`;
          });
        }

        // ── Reorder cement block: chart + inventory data ABOVE requirements ──
        // Built order was [requirements][chart][inventory]; swap to [chart][inventory][requirements].
        {
          const _needHTML=h.slice(_cemStart,_cemNeed1);
          const _chartInvHTML=h.slice(_cemNeed1);
          h=h.slice(0,_cemStart)+_chartInvHTML+_needHTML;
        }

        // ── CEMENT section (finish mills) ────────────────
        if(node.mills&&node.mills.length){
          const cemColor='var(--green)';
          const cemEls=node.mills;
          h+=`<tr class="sup-sec-hdr" data-seckey="cementProd" onclick="_supToggleSec('cementProd')" style="cursor:pointer;background:rgba(var(--green-rgb),.04)">
            <td style="${stickyLeft('var(--surface)',node.depth+1,'border-bottom:1px solid var(--border),')}color:${cemColor};font-size:8px;letter-spacing:.5px;font-weight:700"><span class="sup-arrow">${_supSecArrow('cementProd')}</span> FINISH MILL PRODUCTION</td>`;
          months.forEach(mon=>{
            const isCol=collapsed.has(mon.ym);
            const mt=grpMonTotal(cemEls,mon);
            h+=`<td style="border-left:2px solid rgba(var(--green-rgb),.2);font-size:9px;color:${cemColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
            if(!isCol) mon.dates.forEach(ds=>{
              const dayIdx=_dIdx(ds);
              const v=grpDailyTotal(cemEls,ds,dayIdx);
              h+=`<td class="sup-day-${mon.ym} sx-n" style="color:${cemColor};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`;
            });
          });
          h+=`</tr>`;

          node.mills.forEach(el=>{ h+=_supEquipRow(el,{color:cemColor,rgb:'green',depth:node.depth+2,sec:'cementProd'}); });

          // ── BY PRODUCT breakdown (verification) ───────────────────────────
          // Same production tonnage, but aggregated per cement product across ALL mills in
          // this facility instead of per mill. Gives the total daily volume of each product,
          // and the month/day totals here must equal FINISH MILL PRODUCTION above — a quick
          // check that the per-mill product assignments add up.
          {
            const _cbp={}; // product_id -> { dateStr -> total t/d across mills }
            allDates.forEach(ds=>{
              const di=_dIdx(ds);   // simulation day, not the column position
              cemEls.forEach(el=>{
                resolveProductionAll(el,ds,di,maintSetFor(el.id)).forEach(p=>{
                  if(!(p.capacity_tpd>0)) return;
                  (_cbp[p.product_id]||(_cbp[p.product_id]={}))[ds]=(_cbp[p.product_id][ds]||0)+p.capacity_tpd;
                });
              });
            });
            const _cbpPids=Object.keys(_cbp).filter(_supProdAllows).sort((a,b)=>
              (_prodById.get(a)?.name||a).localeCompare(_prodById.get(b)?.name||b));
            if(_cbpPids.length){
              h+=`<tr class="sup-sec-hdr" data-seckey="cementByProd" onclick="_supToggleSec('cementByProd')" style="cursor:pointer;background:rgba(var(--green-rgb),.04);border-top:1px solid rgba(var(--green-rgb),.25)">
                <td title="Total daily tonnage of each cement product, summed across every finish mill in this facility. These month/day totals should match FINISH MILL PRODUCTION above." style="${stickyLeft('var(--surface)',node.depth+1,'border-bottom:1px solid var(--border),')}color:${cemColor};font-size:8px;letter-spacing:.5px;font-weight:700"><span class="sup-arrow">${_supSecArrow('cementByProd')}</span> FINISH MILL — BY PRODUCT <span style="opacity:.35;font-weight:400;font-size:8px;margin-left:3px;cursor:help">ⓘ</span></td>`;
              months.forEach(mon=>{
                const isCol=collapsed.has(mon.ym);
                const mt=_cbpPids.reduce((s,pid)=>s+mon.dates.reduce((a,ds)=>a+(_cbp[pid][ds]||0),0),0);
                h+=`<td style="border-left:2px solid rgba(var(--green-rgb),.2);font-size:9px;color:${cemColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                if(!isCol) mon.dates.forEach(ds=>{ const v=_cbpPids.reduce((s,pid)=>s+(_cbp[pid][ds]||0),0);
                  h+=`<td class="sup-day-${mon.ym} sx-n" style="color:${cemColor};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`; });
              });
              h+=`</tr>`;
              _cbpPids.forEach(pid=>{
                const prod=_prodById.get(pid);
                const prodName=prod?.name||pid;
                const pColor=_thRule('num')==='source'?cemColor:((typeof spProdColor==='function')?spProdColor(prodName,false):cemColor);
                h+=`<tr class="supsec-cementByProd">
                  <td style="${stickyLeft('var(--surface)',node.depth+2,'border-bottom:1px solid var(--border),')}color:${pColor};font-size:9px">${prod?prodIcon(prod):''} ${esc(prodName)}</td>`;
                months.forEach(mon=>{
                  const isCol=collapsed.has(mon.ym);
                  const mt=mon.dates.reduce((s,ds)=>s+(_cbp[pid][ds]||0),0);
                  h+=`<td style="border-left:2px solid rgba(var(--green-rgb),.15);font-size:9px;color:${pColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                  if(!isCol) mon.dates.forEach(ds=>{ const v=_cbp[pid][ds]||0;
                    h+=`<td class="sup-day-${mon.ym} ${_srcCls(ds,v,_prodActs(cemEls,ds,pid))} sx-n" style="color:${v>0?pColor:'rgba(var(--green-rgb),calc(var(--zero-k)*.3))'};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`; });
                });
                h+=`</tr>`;
              });
            }
          }
        }

        // ── CEMENT (/ SCM) TRANSFER — silo links between this plant's other bulk silos ──
        h+=_slXferSection(facEls.filter(e=>e.type==='bulk_silo'),{key:'cementXfer',pred:pid=>getProductCategory(pid)!=='clinker',color:'var(--teal)',rgb:'teal',depth:node.depth+1});

        // Marks where the PACKING block's HTML begins within `h`, so it can be split
        // off from the CEMENT BULK block below and given its own divider.
        const _packStart=h.length;

        // ╔══════════════════════════════════════════════════════════════╗
        // ║ PACKED block — its own inventory chart + starting inventory +  ║
        // ║ requirements, mirroring the CEMENT / CLINKER blocks. Order:    ║
        // ║ [chart] → [starting inventory] → [requirements] → [production] ║
        // ╚══════════════════════════════════════════════════════════════╝
        // Packed silos the Family/Category/Product filters allow — what the rows below
        // render. _packedSilos itself stays unfiltered: packedProductIds is derived from
        // it and CEMENT REQUIREMENTS relies on that full set to exclude packed products.
        const _packedSilosShown=_packedSilos.filter(si=>getSiloProducts(si).some(_supProdAllows));
        if(_packedSilosShown.length||_packEls.length){
          const pkColor='var(--blue)';

          // ── Packed inventory bar chart ──
          h+=_invChartRow('Packed inventory','packed',pkColor,facEls,node.depth+1,null,null,'packedInv');

          // ── STARTING INVENTORY (packed silos, per silo · tonnes) ──
          if(_packedSilosShown.length){
            const _packInvVal=(siloId,ds,startT)=>{
              const realInv=_idxFirst('real_inventory_daily','silo_id',siloId,'date',_prevDs(ds));
              if(realInv) return {value:parseFloat(realInv.eod_volume_t)||0,isActual:true};
              const dayIdx=_dIdx(ds);
              const hist=r?.inventoryHistory?.[siloId]||[];
              const v=dayIdx<=0?startT:(hist[dayIdx-1]??0);
              return {value:v,isActual:false};
            };
            const _pkInvDay=ds=>_packedSilosShown.reduce((s,si)=>s+_packInvVal(si.id,ds,_siloStartT(si)).value,0);
            h+=`<tr class="sup-sec-hdr" data-seckey="packedInv" onclick="_supToggleSec('packedInv')" style="cursor:pointer;background:rgba(var(--blue-rgb),.05);border-top:2px solid rgba(var(--blue-rgb),.3)">
              <td style="${stickyLeft('var(--surface)',node.depth+1,'border-bottom:1px solid var(--border),')}color:${pkColor};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow('packedInv')}</span> STARTING INVENTORY (packed)</td>`;
            months.forEach(mon=>{
              const isCol=collapsed.has(mon.ym);
              const mt=mon.dates.reduce((a,ds)=>a+_pkInvDay(ds),0)/(mon.dates.length||1);
              h+=`<td class="sx-mavg" style="border-left:2px solid rgba(var(--blue-rgb),.2);font-size:9px;font-weight:700;color:${pkColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
              if(!isCol) mon.dates.forEach(ds=>{ const v=_pkInvDay(ds);
                h+=`<td class="sup-day-${mon.ym} sx-nb" style="color:${pkColor};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):''}</td>`; });
            });
            h+=`</tr>`;
            _packedSilosShown.forEach(silo=>{
              const siloMax=_siloMaxT(silo);
              const siloStart=_siloStartT(silo);
              h+=`<tr class="supsec-packedInv">
                <td style="${stickyLeft('var(--surface)',node.depth+2,'border-bottom:1px solid var(--border),')}color:${pkColor};font-size:9px" title="${esc(silo.name)}">${_siloChip(silo)}${_supLeafLabel(silo.name)}${_supInactTag(silo)}
                  <span style="color:var(--text-dim);font-size:8px;margin-left:4px">${siloMax>0?'cap: '+_fmtInt(Math.round(siloMax))+'t':''}</span>
                </td>`;
              months.forEach(mon=>{
                const isCol=collapsed.has(mon.ym);
                const mt=mon.dates.reduce((s,ds)=>s+_packInvVal(silo.id,ds,siloStart).value,0)/(mon.dates.length||1);
                h+=`<td class="sx-mavg" style="border-left:2px solid rgba(var(--blue-rgb),.1);font-size:9px;color:${pkColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                if(!isCol) mon.dates.forEach(ds=>{
                  const inv=_packInvVal(silo.id,ds,siloStart); const v=inv.value;
                  const lvlColor=invLevelColor(v,siloMax);
                  const cellWeight=inv.isActual?'700':'400';
                  const cellClass=inv.isActual?'cell-real':(ds<todayStr&&v>0?'cell-gap':'');
                  const lvlTitle=(siloMax>0?`${Math.round(v/siloMax*100)}% of ${_fmtInt(Math.round(siloMax))}t capacity${inv.isActual?' · actual':''}`:'')+' · click to set real inventory';
                  h+=`<td class="sup-day-${mon.ym} ${cellClass} sx-np" title="${lvlTitle}" onclick="showInventoryPopup('${silo.id}','${ds}')" style="color:${v>0?lvlColor:'rgba(var(--blue-rgb),calc(var(--zero-k)*.3))'};font-weight:${cellWeight};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`;
                });
              });
              h+=`</tr>`;
            });
          }

          // ── PACKED REQUIREMENTS (demand for packed products) ──
          {
            const pkProds=[...packedProductIds].filter(pid=>_prodById.get(pid)).filter(_supProdAllows)
              .sort((a,b)=>(_prodById.get(a)?.name||a).localeCompare(_prodById.get(b)?.name||b));
            const _pkDpsMemo=new Map();
            const _pkDpsOf=pid=>{ let a=_pkDpsMemo.get(pid); if(!a){ a=demandPoints.filter(dp=>_dpFirstProd(dp)===pid); _pkDpsMemo.set(pid,a); } return a; };
            const pkDemand=(pid,ds)=>_pkDpsOf(pid).reduce((s,dp)=>s+(_demandRate(dp.element_id,ds)||0),0);
            if(pkProds.length){
              h+=`<tr class="sup-sec-hdr" data-seckey="packedNeed" onclick="_supToggleSec('packedNeed')" style="cursor:pointer;background:rgba(var(--blue-rgb),.05);border-top:2px solid rgba(var(--blue-rgb),.3)">
                <td title="Packed-product demand" style="${stickyLeft('var(--surface)',node.depth+1,'border-bottom:1px solid var(--border),')}color:${pkColor};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow('packedNeed')}</span> PACKED REQUIREMENTS <span style="opacity:.35;font-weight:400;font-size:8px;margin-left:3px;cursor:help">ⓘ</span></td>`;
              months.forEach(mon=>{
                const isCol=collapsed.has(mon.ym);
                const mt=pkProds.reduce((s,pid)=>s+mon.dates.reduce((a,ds)=>a+pkDemand(pid,ds),0),0);
                h+=`<td style="border-left:2px solid rgba(var(--blue-rgb),.2);font-size:9px;font-weight:700;color:${pkColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                if(!isCol) mon.dates.forEach(ds=>{ const v=pkProds.reduce((s,pid)=>s+pkDemand(pid,ds),0);
                  h+=`<td class="sup-day-${mon.ym} sx-nb" style="color:${pkColor};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):''}</td>`; });
              });
              h+=`</tr>`;
              pkProds.forEach(pid=>{
                const prodName=_prodById.get(pid)?.name||pid;
                const _dpnDpts=demandPoints.filter(dp=>_dpFirstProd(dp)===pid);
                const _dpnBase=node.id+'_packedNeed_'+pid;
                h+=`<tr class="supsec-packedNeed">
                  <td style="${stickyLeft('var(--surface)',node.depth+2,'border-bottom:1px solid var(--border),')}color:${pkColor};font-size:9px">${esc(prodName)}${_dpnDpts.length?_supDpnArrow(_dpnBase,_dpnDpts.length):''}</td>`;
                months.forEach(mon=>{
                  const isCol=collapsed.has(mon.ym);
                  const mt=mon.dates.reduce((s,ds)=>s+pkDemand(pid,ds),0);
                  h+=`<td style="border-left:2px solid rgba(var(--blue-rgb),.1);font-size:9px;color:${pkColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                  if(!isCol) mon.dates.forEach(ds=>{ const v=pkDemand(pid,ds);
                    h+=`<td class="sup-day-${mon.ym} ${_srcCls(ds,v,_dmdActs(_dpnDpts,ds))} sx-n" style="color:${v>0?pkColor:'rgba(var(--blue-rgb),calc(var(--zero-k)*.3))'};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`; });
                });
                h+=`</tr>`;
                h+=_supDpnRows(_dpnDpts, months, collapsed, tdSty, node.depth+3, _dpnBase, stickyLeft, null, 'packedNeed');
              });
            }
          }
        }

        // ── PACKING section (packing plants) ─────────────
        // Mirrors FINISH MILL PRODUCTION: a packing machine packs ONE product/day. Real days show
        // the actual tonnage (colour-coded); forecast days show a Gantt bar of the simulator's
        // proposed sequence. Click a cell to open the Campaign popup and override (lock) it.
        if(node.packers&&node.packers.length){
          const packColor='var(--blue)';
          const packEls=node.packers;
          h+=`<tr class="sup-sec-hdr" data-seckey="packProd" onclick="_supToggleSec('packProd')" style="cursor:pointer;background:rgba(var(--blue-rgb),.05);border-top:2px solid rgba(var(--blue-rgb),.3)">
            <td title="Packed · t" style="${stickyLeft('var(--surface)',node.depth+1,'border-bottom:1px solid var(--border),')}color:${packColor};font-size:8px;letter-spacing:.5px;font-weight:700"><span class="sup-arrow">${_supSecArrow('packProd')}</span> PACKING PLANT PRODUCTION <span style="opacity:.35;font-weight:400;font-size:8px;margin-left:3px;cursor:help">ⓘ</span></td>`;
          months.forEach(mon=>{
            const isCol=collapsed.has(mon.ym);
            const mt=grpMonTotal(packEls,mon);
            h+=`<td style="border-left:2px solid rgba(var(--blue-rgb),.2);font-size:9px;color:${packColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
            if(!isCol) mon.dates.forEach(ds=>{
              const dayIdx=_dIdx(ds);
              const v=grpDailyTotal(packEls,ds,dayIdx);
              h+=`<td class="sup-day-${mon.ym} sx-n" style="color:${packColor};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`;
            });
          });
          h+=`</tr>`;

          node.packers.forEach(el=>{ h+=_supEquipRow(el,{color:packColor,rgb:'blue',depth:node.depth+2,sec:'packProd'}); });
        }

        // ── RAIL LOADING — its own top-level block (same level as CLINKER / CEMENT /
        // PACKED), emitted after the cement block with its own separator. One NUMERIC row
        // per rail dispatch point ("Rail Car Loading"): every day cell shows a car COUNT,
        // never a bar. Real days (real_rail_daily) show the actual cars loaded in bold;
        // forecast days show the forecast cars/day from the sim result (or the campaign /
        // standard plan when there is no sim), coloured by product. Marks instead of bars:
        // green top border = locked campaign, amber bottom inset = loaded short of plan,
        // struck-through red number = starved (planned but nothing available to load).
        // ⚠ DO NOT re-introduce a Gantt bar here — this row is deliberately numeric so the
        // daily loading volume is readable. The mill / vessel rows around it are bars; this
        // one is not.
        // Editing follows the demand grid (see _demCellHtml): a forecast day is an INPUT —
        // click once and type the cars for that day (saveRailLoadCell writes a one-day
        // campaign) — and DOUBLE-CLICK opens the full campaign popup for a date range.
        // Real days are read-only text; double-click them to correct the actual.
        let _railHTML='';
        {
          const railDisp=facEls.filter(e=>e.type==='dispatch_point'&&e.props?.dispatch_type==='Rail');
          if(railDisp.length){
            const railColor='var(--purple)';
            // Per-dispatch-point day resolver, memoised over allDates.
            const dpDays=railDisp.map(disp=>{
              const _isW=_mkRailWorkDayFn(disp);
              const carCap=parseFloat(disp.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
              const stdRate=_railCarsPerDay(disp);
              const prods=railDpProducts(disp);
              const histArr=r?.railHistory?.[disp.id]||[];
              const byDate={};
              allDates.forEach(ds=>{
                const di=_dIdx(ds);   // simulation day (working-day test + railHistory), not the column position
                const realRows=(DB.real_rail_daily||[]).filter(rr=>rr.date===ds&&rr.facility_id===node.id&&rr.type==='loading');
                if(realRows.length){
                  const by={}; realRows.forEach(rr=>{ const pid=rr.product_id||prods[0]; if(pid) by[pid]=(by[pid]||0)+(parseFloat(rr.cars)||0); });
                  const cars=Object.values(by).reduce((a,b)=>a+b,0);
                  const pid=Object.keys(by).sort((a,b)=>by[b]-by[a])[0]||null;
                  byDate[ds]={cars,pid,byProduct:by,isReal:true,plan:0,isCamp:false};
                  return;
                }
                const planBy={}; prods.forEach(pid=>{ const pr=_isW(di+1)?railPlanRate(disp.id,pid,ds):0; if(pr>0) planBy[pid]=pr; });
                const plan=Object.values(planBy).reduce((a,b)=>a+b,0);
                const e=histArr[di];
                const by=e?(e.carsLoadedByProduct||{}):planBy; // sim result if we have one, else the plan
                const cars=Object.values(by).reduce((a,b)=>a+b,0);
                const pid=Object.keys(by).sort((a,b)=>by[b]-by[a])[0]
                        ||Object.keys(planBy).sort((a,b)=>planBy[b]-planBy[a])[0]||null;
                byDate[ds]={cars,pid,byProduct:by,isReal:false,plan,isCamp:!!(pid&&_railActivePlan(disp.id,pid,ds))};
              });
              return {disp,carCap,stdRate,byDate};
            });
            const railTonsDay=ds=>dpDays.reduce((s,d)=>{ const e=d.byDate[ds]; return s+(e?e.cars*d.carCap:0); },0);
            // Section header — monthly totals in tonnes (cars × car capacity)
            _railHTML+=`<tr class="sup-sec-hdr" data-seckey="railLoad" onclick="_supToggleSec('railLoad')" style="cursor:pointer;background:rgba(var(--purple-rgb),.05);border-top:2px solid rgba(var(--purple-rgb),.3)">
              <td title="Tonnes · click a bar to plan" style="${stickyLeft('var(--surface)',node.depth+1,'border-bottom:1px solid var(--border),')}color:${railColor};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow('railLoad')}</span> RAIL LOADING <span style="opacity:.35;font-weight:400;font-size:8px;margin-left:3px;cursor:help">ⓘ</span></td>`;
            months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
              const mt=mon.dates.reduce((a,ds)=>a+railTonsDay(ds),0);
              _railHTML+=`<td style="border-left:2px solid rgba(var(--purple-rgb),.2);font-size:9px;font-weight:700;color:${railColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
              if(!isCol) mon.dates.forEach(ds=>{ const v=railTonsDay(ds);
                _railHTML+=`<td class="sup-day-${mon.ym} sx-nb" style="color:${railColor};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):''}</td>`; });
            });
            _railHTML+=`</tr>`;

            // ── One "Rail Car Loading" row per dispatch point — numeric cars/day, no bars ──
            dpDays.forEach(({disp,carCap,stdRate,byDate})=>{
              // A typed value has to be attributed to a product. Use the day's own product
              // when the sim/plan gives one, else the dispatch point's first configured
              // product — same fallback the campaign popup uses for its default selection.
              const _dpProds=railDpProducts(disp);
              const _fallbackPid=_dpProds[0]||'';
              let rr=`<tr class="supsec-railLoad" style="background:rgba(var(--purple-rgb),.03)">
                <td style="${stickyLeft('var(--surface)',node.depth+2,'border-bottom:1px solid var(--border),')}color:${railColor};font-size:9px">Rail Car Loading${railDisp.length>1?' — '+disp.name:''}
                  <span style="color:var(--text-dim);font-size:8px;margin-left:4px">max ${stdRate} cars/d · ${carCap}t/car</span>
                </td>`;
              // Contiguous same-product runs so a click pre-fills the campaign dialog with the run's range.
              const _runByDate={};
              { let cs=null,cp=null,pd=null;
                const _fin=(endDs)=>{ if(cs==null)return; let on=false; for(const d of allDates){ if(d===cs)on=true; if(on)_runByDate[d]={start:cs,end:endDs,product:cp}; if(d===endDs)break; } };
                allDates.forEach(ds=>{
                  const e=byDate[ds]; const pid=(e&&!e.isReal&&e.cars>0)?e.pid:null;
                  if(pid&&pid===cp){ pd=ds; }
                  else { if(cs!=null)_fin(pd); if(pid){cs=ds;cp=pid;pd=ds;}else{cs=null;cp=null;pd=null;} }
                });
                if(cs!=null)_fin(pd);
              }
              months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
                const mt=mon.dates.reduce((s,ds)=>s+(byDate[ds]?.cars||0),0);
                rr+=`<td title="cars loaded" style="border-left:2px solid rgba(var(--purple-rgb),.1);font-size:9px;color:${railColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                if(!isCol) mon.dates.forEach(ds=>{
                  const e=byDate[ds]||{cars:0,pid:null,byProduct:{},isReal:false,plan:0,isCamp:false};
                  const prod=e.pid?_prodById.get(e.pid):null;
                  const barColor=prod?((typeof spProdColor==='function')?spProdColor(prod.name||prod.id,false):railColor):railColor;
                  const run=_runByDate[ds];
                  const campArgs=run?`'${disp.id}','${ds}','${run.start}','${run.end}','${run.product}'`:`'${disp.id}','${ds}'`;
                  const clickFn=`showRailCampaignPopup(${campArgs})`;
                  if(e.isReal){
                    const tip=Object.keys(e.byProduct).map(pid=>(_prodById.get(pid)?.name||pid)+' '+e.byProduct[pid]+' cars').join(' + ')+' · actual';
                    rr+=`<td class="sup-day-${mon.ym} cell-real" title="${tip} — dbl-click to correct" ondblclick="event.stopPropagation();${clickFn}" style="cursor:cell;font-size:9px;color:${barColor};font-weight:700;text-align:right;padding:4px 6px;border-bottom:1px solid var(--border);${tdSty(ds)}">${Math.round(e.cars)}</td>`;
                    return;
                  }
                  const isStarved=(e.cars<=0&&e.plan>0);
                  const isShort=(e.cars>0&&e.plan>e.cars);
                  const campMark=e.isCamp?'box-shadow:inset 0 2px 0 var(--plan);':'';
                  const shortMark=isShort?'box-shadow:inset 0 -2px 0 var(--amber);':'';
                  const cellTitle=isStarved?`⚠ plan ${e.plan} cars — nothing loaded (no cement in rail silo)`
                    :(e.cars>0?`${prod?.name||''} · ${e.cars} cars/d${isShort?` (plan ${e.plan} — short ${e.plan-e.cars})`:''}${e.isCamp?' · 🔒 campaign':''}`
                    :'Idle — click to plan loading');
                  // Forecast day = an editable car count coloured by product. The value shown
                  // is what the day will load; on a starved day it is the PLAN that could not
                  // be met (red), since the plan is the thing the user actually edits.
                  const numCol=isStarved?'var(--starved-num)':barColor;
                  const cellVal=isStarved?Math.round(e.plan):(e.cars>0?Math.round(e.cars):'');
                  const editPid=e.pid||_fallbackPid;
                  const editTitle=cellTitle+' \u2014 type to set this day, dbl-click for the campaign popup';
                  rr+=`<td class="sup-day-${mon.ym} ${ds<todayStr&&e.cars>0?'cell-gap':''}" title="${editTitle}" ondblclick="event.stopPropagation();${clickFn}" style="cursor:cell;padding:1px 2px;border-bottom:1px solid var(--border);${campMark}${shortMark}${tdSty(ds)}">`
                    +(editPid
                      ? `<input class="rail-load-cell" data-dp="${disp.id}" data-date="${ds}" data-pid="${editPid}" value="${cellVal}" onchange="saveRailLoadCell(this)" style="width:34px;background:transparent;border:none;color:${numCol};font-family:var(--mono);font-size:9px;text-align:right;padding:3px 2px;outline:none">`
                      : `<div style="width:34px;font-family:var(--mono);font-size:9px;text-align:right;padding:3px 2px;color:${numCol}">${cellVal}</div>`)
                    +`</td>`;
                });
              });
              _railHTML+=rr+`</tr>`;
            });
          }
        }

        // ── End of CEMENT block: split into CEMENT BULK + PACKING, then start capturing CLINKER ──
        const cementBulkHTML=h.slice(_cemStart,_packStart);
        const packHTML=h.slice(_packStart);
        h=h.slice(0,_cemStart);
        const _clkStart=h.length;

        // ══════════════════════════════════════════════════════════════
        // SECTION 3: CLINKER REQUIREMENTS — clinker CONSUMED by actual finish-mill
        // production (Σ production × each product's clinker recipe %). This matches what the
        // simulation actually draws from clinker inventory, and the FINISH MILL PRODUCTION rows
        // below. (Previously this was demand×clinker%, which overstates when production ≠ demand.)
        // ══════════════════════════════════════════════════════════════
        const _clkFinishMills=facEls.filter(e=>e.type==='finish_mill');
        {
          // Products each mill can produce. Discover them from configured capacities AND from
          // actual production / campaigns / focus — a real-data scenario often has NO
          // element_product_capacities rows (production comes from real_production_daily + sim),
          // and keying only off capacities made this whole CLINKER REQUIREMENTS section vanish.
          const _clkMillProductIds=new Set();
          _clkFinishMills.forEach(m=>{
            (_capsByEl.get(m.id)||[]).forEach(c=>_clkMillProductIds.add(c.product_id));
            (DB.real_production_daily||[]).filter(r=>r.element_id===m.id&&r.product_id).forEach(r=>_clkMillProductIds.add(r.product_id));
            (DB.production_campaigns||[]).filter(c=>c.element_id===m.id&&c.product_id).forEach(c=>_clkMillProductIds.add(c.product_id));
            (DB.mill_product_focus||[]).filter(c=>c.element_id===m.id&&c.product_id).forEach(c=>_clkMillProductIds.add(c.product_id));
          });
          // Clinker materials used by any product these mills can produce
          const clinkerProdsSet=new Set();
          _clkMillProductIds.forEach(pid=>{
            DB.recipes.filter(rc=>rc.product_id===pid).forEach(rec=>{
              const mat=DB.products.find(pm=>pm.id===rec.material_id);
              if(mat&&mat.category==='clinker') clinkerProdsSet.add(rec.material_id);
            });
          });
          // Every row here is a clinker product, so the page filters apply the same way
          // they do elsewhere — filtering to Cement hides the section, Clinker keeps it.
          [...clinkerProdsSet].forEach(pid=>{ if(!_supProdAllows(pid)) clinkerProdsSet.delete(pid); });

          if(_clkFinishMills.length>0&&clinkerProdsSet.size>0){
            const clinkerReqColor='var(--peach)';
            // Clinker consumed on a date = Σ over mills of (actual production × clinker recipe %).
            // clkId optional → restrict to a single clinker product (for the per-type rows below).
            const _clkReqDay=(ds,clkId)=>{ const dayIdx=_dIdx(ds); let t=0;
              _clkFinishMills.forEach(m=>{
                // Each product produced that day (a mill may make two on a real changeover day)
                // draws clinker at ITS OWN recipe %, not the day's total at one recipe.
                resolveProductionAll(m,ds,dayIdx,maintSetFor(m.id)).forEach(res=>{
                  if(!res.product_id||!res.capacity_tpd) return;
                  _recipeRows(res.product_id).filter(rc=>clinkerProdsSet.has(rc.material_id)&&(!clkId||rc.material_id===clkId))
                    .forEach(rc=>{ t+=res.capacity_tpd*(parseFloat(rc.pct)||0)/100; }); }); });
              return t; };
            // Section header — total = sum of all clinker types below
            h+=`<tr class="sup-sec-hdr" data-seckey="clinkerReq" onclick="_supToggleSec('clinkerReq')" style="cursor:pointer;background:rgba(var(--peach-rgb),.05);border-top:2px solid rgba(var(--peach-rgb),.3)">
              <td style="${stickyLeft('var(--surface)',node.depth+1,'border-bottom:1px solid var(--border),')}color:${clinkerReqColor};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow('clinkerReq')}</span> CLINKER REQUIREMENTS</td>`;
            months.forEach(mon=>{
              const isCol=collapsed.has(mon.ym);
              const mt=mon.dates.reduce((a,ds)=>a+_clkReqDay(ds),0);
              h+=`<td style="border-left:2px solid rgba(var(--peach-rgb),.2);font-size:9px;font-weight:700;color:${clinkerReqColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
              if(!isCol){
                mon.dates.forEach(ds=>{
                  const v=_clkReqDay(ds);
                  h+=`<td class="sup-day-${mon.ym} sx-nb" style="color:${clinkerReqColor};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):''}</td>`;
                });
              }
            });
            h+=`</tr>`;

            // One row per clinker type (production-consumed, via _clkReqDay restricted to clkId)
            Array.from(clinkerProdsSet).sort().forEach(clinkerProdId=>{
              const clinkerProd=_prodById.get(clinkerProdId);
              const clinkerName=clinkerProd?.name||clinkerProdId;
              h+=`<tr class="supsec-clinkerReq">
                <td style="${stickyLeft('var(--surface)',node.depth+2,'border-bottom:1px solid var(--border),')}color:${clinkerReqColor};font-size:9px">${clinkerName}</td>`;
              months.forEach(mon=>{
                const isCol=collapsed.has(mon.ym);
                const mt=mon.dates.reduce((s,ds)=>s+_clkReqDay(ds,clinkerProdId),0);
                h+=`<td style="border-left:2px solid rgba(var(--peach-rgb),.1);font-size:9px;color:${clinkerReqColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                if(!isCol){
                  mon.dates.forEach(ds=>{
                    const totalReq=_clkReqDay(ds,clinkerProdId);
                    const _acts=_clkFinishMills.flatMap(m=>resolveProductionAll(m,ds,_dIdx(ds),maintSetFor(m.id))
                      .filter(res=>DB.recipes.some(rc=>rc.product_id===res.product_id&&rc.material_id===clinkerProdId)).map(res=>!!res.isActual));
                    h+=`<td class="sup-day-${mon.ym} ${_srcCls(ds,totalReq,_acts)} sx-n" style="color:${totalReq>0?clinkerReqColor:'rgba(var(--peach-rgb),calc(var(--zero-k)*.3))'};${tdSty(ds)}">${totalReq>0?_fmtInt(Math.round(totalReq)):''}</td>`;
                  });
                }
              });
              h+=`</tr>`;
            });
          }
        }

        // End of CLINKER REQUIREMENTS — capture boundary so chart+inventory can be reordered above it.
        const _clkReq1=h.length;

        // ── CLINKER inventory bar chart ──
        h+=_invChartRow('Clinker inventory','clinker','var(--orange)',facEls,node.depth+1,null,null,'clinkerInv');

        // ══════════════════════════════════════════════════════════════
        // SECTION 4: CLINKER INVENTORY (clinker silos, per silo)
        // ══════════════════════════════════════════════════════════════
        const clinkerSilos=facEls.filter(e=>e.type==='bulk_silo').filter(s=>{
          const siloProds=getSiloProducts(s);
          return siloProds.some(p=>{
            const prod=_prodById.get(p);
            return prod&&prod.category==='clinker';
          });
        }).filter(s=>getSiloProducts(s).some(_supProdAllows))
          .sort((a,b)=>(a.name||'').localeCompare(b.name||'')); // order silos by name (CLKL_01 before CLKL_02)

        if(clinkerSilos.length>0){
          const clinkerInvColor='var(--orange)';
          // Helper for clinker inventory (same as cement above)
          const getClkInvValue=(siloId, dateStr, startInv)=>{
            const prevDateStr=_prevDs(dateStr);
            const realInv=_idxFirst('real_inventory_daily','silo_id',siloId,'date',prevDateStr);
            if(realInv) return {value:parseFloat(realInv.eod_volume_t)||0, isActual:true};
            const dayIdx=_dIdx(dateStr);
            const hist=r?.inventoryHistory?.[siloId]||[];
            const v=dayIdx<=0?parseFloat(startInv)||0:hist[dayIdx-1]??0;
            return {value:v, isActual:false};
          };
          // Section header — total = sum of all clinker silos on hand (filter-scoped)
          const _clkInvDay=ds=>clinkerSilos.reduce((s,si)=>s+getClkInvValue(si.id,ds,parseFloat(si.props?.start_inventory)||0).value,0);
          h+=`<tr class="sup-sec-hdr" data-seckey="clinkerInv" onclick="_supToggleSec('clinkerInv')" style="cursor:pointer;background:rgba(var(--orange-rgb),.05);border-top:2px solid rgba(var(--orange-rgb),.3)">
            <td style="${stickyLeft('var(--surface)',node.depth+1,'border-bottom:1px solid var(--border),')}color:${clinkerInvColor};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow('clinkerInv')}</span> CLINKER INVENTORY</td>`;
          months.forEach(mon=>{
            const isCol=collapsed.has(mon.ym);
            const mt=mon.dates.reduce((a,ds)=>a+_clkInvDay(ds),0)/(mon.dates.length||1);
            h+=`<td class="sx-mavg" style="border-left:2px solid rgba(var(--orange-rgb),.2);font-size:9px;font-weight:700;color:${clinkerInvColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
            if(!isCol){
              mon.dates.forEach(ds=>{
                const v=_clkInvDay(ds);
                h+=`<td class="sup-day-${mon.ym} sx-nb" style="color:${clinkerInvColor};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):''}</td>`;
              });
            }
          });
          h+=`</tr>`;

          // One row per silo
          clinkerSilos.forEach(silo=>{
            const siloMax=parseFloat(silo.props?.max_capacity)||0;
            const siloStart=parseFloat(silo.props?.start_inventory)||0;
            h+=`<tr class="supsec-clinkerInv">
              <td style="${stickyLeft('var(--surface)',node.depth+2,'border-bottom:1px solid var(--border),')}color:${clinkerInvColor};font-size:9px" title="${esc(silo.name)}">${_siloChip(silo)}${_supLeafLabel(silo.name)}${_supInactTag(silo)}
                <span style="color:var(--text-dim);font-size:8px;margin-left:4px">${siloMax>0?'cap: '+siloMax.toLocaleString()+'t':''}</span>
              </td>`;
            months.forEach(mon=>{
              const isCol=collapsed.has(mon.ym);
              const mt=mon.dates.reduce((s,ds)=>{
                const inv=getClkInvValue(silo.id, ds, siloStart);
                return s+inv.value;
              },0);
              const avgMonthly=mt/mon.dates.length;
              h+=`<td class="sx-mavg" style="border-left:2px solid rgba(var(--orange-rgb),.1);font-size:9px;color:${clinkerInvColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${avgMonthly>0?_fmtInt(Math.round(avgMonthly)):''}</td>`;
              if(!isCol){
                mon.dates.forEach((ds)=>{
                  const inv=getClkInvValue(silo.id, ds, siloStart);
                  const v=inv.value;
                  const cellColor=inv.isActual?'var(--real)':clinkerInvColor;
                  const cellClass=inv.isActual?'cell-real':(ds<todayStr&&v>0?'cell-gap':'');
                  const cellWeight=inv.isActual?'700':'400';
                  h+=`<td class="sup-day-${mon.ym} ${cellClass} sx-np" title="click to set real inventory${inv.isActual?' · actual':''}" onclick="showInventoryPopup('${silo.id}','${ds}')" style="color:${v>0?cellColor:'rgba(var(--orange-rgb),calc(var(--zero-k)*.3))'};font-weight:${cellWeight};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`;
                });
              }
            });
            h+=`</tr>`;
          });
        }

        // ── Reorder clinker block: chart + inventory data ABOVE requirements ──
        {
          const _reqHTML=h.slice(_clkStart,_clkReq1);
          const _chartInvHTML=h.slice(_clkReq1);
          h=h.slice(0,_clkStart)+_chartInvHTML+_reqHTML;
        }

        // ── CLINKER section (kilns) ──────────────────────
        if(node.kilns&&node.kilns.length){
          const clkColor='var(--orange)';
          const clkEls=node.kilns;
          h+=`<tr class="sup-sec-hdr" data-seckey="clinkerProd" onclick="_supToggleSec('clinkerProd')" style="cursor:pointer;background:rgba(var(--orange-rgb),.04)">
            <td style="${stickyLeft('var(--surface)',node.depth+1,'border-bottom:1px solid var(--border),')}color:${clkColor};font-size:8px;letter-spacing:.5px;font-weight:700"><span class="sup-arrow">${_supSecArrow('clinkerProd')}</span> CLINKER PRODUCTION</td>`;
          months.forEach(mon=>{
            const isCol=collapsed.has(mon.ym);
            const mt=grpMonTotal(clkEls,mon);
            h+=`<td style="border-left:2px solid rgba(var(--orange-rgb),.2);font-size:9px;color:${clkColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
            if(!isCol) mon.dates.forEach(ds=>{
              const dayIdx=_dIdx(ds);
              const v=grpDailyTotal(clkEls,ds,dayIdx);
              h+=`<td class="sup-day-${mon.ym} sx-n" style="color:${clkColor};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`;
            });
          });
          h+=`</tr>`;

          node.kilns.forEach(el=>{ h+=_supEquipRow(el,{color:clkColor,rgb:'orange',depth:node.depth+2,sec:'clinkerProd'}); });
        }

        // ── CLINKER TRANSFER — silo links between clinker silos (one line per direction) ──
        h+=_slXferSection(facEls.filter(e=>e.type==='bulk_silo'),{key:'clinkerXfer',pred:pid=>getProductCategory(pid)==='clinker',color:'var(--orange)',rgb:'orange',depth:node.depth+1});

        // ── Emit in display order: CLINKER → CEMENT BULK → PACKING → RAIL LOADING,
        // each separated by a thin 1px divider (product-family boundaries within a plant).
        const clinkerHTML=h.slice(_clkStart); h=h.slice(0,_clkStart);
        const _sepRow=grad=>`<tr class="sup-sep-row" aria-hidden="true"><td colspan="999" style="padding:0;border:0"><div style="height:1px;background:linear-gradient(90deg,${grad});opacity:.85"></div></td></tr>`;
        h += clinkerHTML
           + _sepRow('var(--orange),var(--teal)')
           + cementBulkHTML
           + (packHTML?_sepRow('var(--teal),var(--blue)')+packHTML:'')
           + (_railHTML?_sepRow('var(--blue),var(--purple)')+_railHTML:'');

      }
    } else {
      // Region / sub-region header
      const bg=typeBg[node.type]||'transparent';
      const bgSolid=typeBgSolid[node.type]||'var(--surface)';
      const col=typeColors[node.type]||'var(--text)';
      h+=`<tr class="${node.type==='sub'?'sup-sub-hdr':'sup-reg-hdr'}" onclick="_supToggleGrp('${node.id}')" style="cursor:pointer;background:${bg};border-top:${node.type==='reg'||node.type==='mr'?'2':'1'}px solid var(--border2)">
        <td style="${stickyLeft(bgSolid,node.depth,'border-bottom:1px solid var(--border2),')}color:${col};font-weight:${node.type==='reg'?'700':'400'};font-size:9px">
          <span class="sup-chev">${isCollapsed?'▶':'▼'}</span>${node.name}
        </td>`;
      months.forEach(mon=>{
        const isCol=collapsed.has(mon.ym);
        const mt=grpMonTotal(node.els,mon)+_pfMon(node.pfacs,mon);
        h+=`<td style="border-left:2px solid rgba(var(--blue-rgb),.15);background:rgba(var(--hi-rgb),.03);font-size:9px;font-weight:700;color:var(--total);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border2)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
        if(!isCol) mon.dates.forEach(ds=>{
          const dayIdx=_dIdx(ds);
          const v=grpDailyTotal(node.els,ds,dayIdx)+_pfDay(node.pfacs,ds);
          h+=`<td class="sup-day-${mon.ym} ${_srcCls(ds,v,_prodActs(node.els,ds).concat(_pfActs(node.pfacs,ds)))}" style="background:rgba(var(--hi-rgb),.03);font-size:9px;font-weight:700;color:var(--total);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border2);${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`;
        });
      });
      h+=`</tr>`;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // TERMINALS — receiving facilities, rendered here and spliced into the org
  // tree under their sub-region (the <!--sup-term:ID--> slots above).
  // Same cement inventory chart + starting inventory + requirements as a
  // plant, minus the clinker/mill sections. Finish-mill production is
  // replaced by a PRODUCT RECEIVED section: per-berth, per-product unloading
  // (actual from real_unloading_daily, else planned siloUnloadHistory).
  // ══════════════════════════════════════════════════════════════════════
  {
    if(_termSlots.size){
      const _allFE=allEls;
      const _isCementPid=pid=>{ const pr=_prodById.get(pid); return pr&&(pr.category==='cement_bulk'||pr.category==='cement_packed'); };
      const _isScmPid=pid=>{ const pr=_prodById.get(pid); return pr&&pr.category==='additive'; };
      // Stale product ids (older catalog) resolve through _canon, defined above the org tree.
      // Silos a berth unloads into, and a facility's berths.
      const _downSilosOf=berth=>_allFE.filter(e=>e.type==='bulk_silo'&&
        DB.connections.some(c=>c.from_element_id===berth.id&&c.to_element_id===e.id));
      const _facBerths=fac=>_allFE.filter(e=>e.type==='berth'&&(e.assigned_facility_id||e.facility_id)===fac.id);

      // Each terminal renders at the end of h, then is cut out and dropped into its slot.
      const _treeEnd=h.length;
      const _termSeg=[];   // [facility id, start offset in h] — blocks are contiguous
      _termRender.forEach(fac=>{
        if(!_termSlots.has(fac.id)) return;   // its sub-region (or a level above) is collapsed
        _termSeg.push([fac.id,h.length]);
        const depth=_termSlots.get(fac.id);
        const facEls=_allFE.filter(e=>(e.assigned_facility_id||e.facility_id)===fac.id);
        const berths=_facBerths(fac);
        const demandEls=facEls.filter(e=>e.type==='demand_point');
        const demandPoints=DB.demand_points.filter(dp=>demandEls.some(el=>el.id===dp.element_id));
        const _facCol=grpCol.has(fac.id);
        // PURCHASED: a supplier's position. We hold no stock there, so this block
        // drops inventory, arrivals and transfers and keeps one thing — what we
        // buy here per day. Contracted limits are the only ceiling that applies.
        const _isPurch=isPurchasedFac(fac);
        const _purchMaxDay=parseFloat(fac.max_daily_t)||0;
        const _purchMaxMon=parseFloat(fac.contract_monthly_t)||0;

        // ── Terminal header (amber) — no numbers while expanded, same as a plant's facility
        // line; collapsed it carries what the facility asks for per day (PURCHASES at a
        // purchased source, PRODUCT REQUIREMENT at a terminal) so the real and forecast
        // numbers stay in view with the detail folded away.
        const _facAllDps=_facDps(fac.id);
        const _facLbl=_isPurch?'purchases':'product requirement';
        h+=`<tr class="sup-grp-hdr" onclick="_supToggleGrp('${fac.id}')" style="cursor:pointer;background:rgba(var(--amber-rgb),.04);border-top:1px solid var(--border2)">
          <td style="${stickyLeft('var(--surface2)',depth,'border-bottom:1px solid var(--border),')}color:var(--amber);font-weight:700;font-size:9px">
            <span class="sup-chev">${_facCol?'▶':'▼'}</span>${esc(fac.name)}
            ${_isPurch?`<span style="color:var(--purple);font-size:7px;letter-spacing:1px;margin-left:6px;font-weight:400">PURCHASED${_purchMaxDay>0?' · max '+_fmtInt(Math.round(_purchMaxDay))+' t/d':''}${_purchMaxMon>0?' · '+_fmtInt(Math.round(_purchMaxMon))+' t/mo':''}</span>`:''}
          </td>`;
        months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
          const mt=_facCol?mon.dates.reduce((s,ds)=>s+_dpsNeed(_facAllDps,ds),0):0;
          h+=`<td style="background:rgba(var(--amber-rgb),.06);border-left:2px solid rgba(var(--amber-rgb),.2);font-size:9px;font-weight:700;color:var(--total);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
          if(!isCol) mon.dates.forEach(ds=>{
            if(!_facCol){ h+=`<td class="sup-day-${mon.ym}" style="background:rgba(var(--amber-rgb),.04);font-size:9px;color:var(--total);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border);${tdSty(ds)}"></td>`; return; }
            const v=_dpsNeed(_facAllDps,ds);
            h+=`<td class="sup-day-${mon.ym} ${_srcCls(ds,v,_dpsActs(_facAllDps,ds))}" title="${_facLbl} · expand the facility for the detail" style="background:rgba(var(--amber-rgb),.04);font-size:9px;font-weight:700;color:var(--total);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border);${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`; });
        });
        h+=`</tr>`;

        if(_facCol) return;

        // Blank month/day cells (for full-width divider / header rows).
        const _blankCells=()=>{ let s=''; months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
          s+=`<td style="border-left:2px solid var(--border2);border-bottom:1px solid var(--border)"></td>`;
          if(!isCol) mon.dates.forEach(ds=>{ s+=`<td class="sup-day-${mon.ym}" style="border-bottom:1px solid var(--border);${tdSty(ds)}"></td>`; }); });
          return s; };


        // Ship berths + which product each vessel carries — used by the per-product vessel
        // Gantt below (it replaces the flat "Unloading" tonnage row inside each product block).
        const _shipBerths=berths.filter(b=>(b.props?.berth_type||'Ship Berth')==='Ship Berth');

        // Rail-receiving berths → rail pipeline stages (sim histories, tonnes by product
        // per day; cars = tonnes / berth car capacity): In Transit → At Rail Yard →
        // At Local Yard → Unloading. Generic: any facility with a Rail Receiving berth
        // gets these rows, the Total-inventory line and the stacked chart segment.
        const _railBerths=berths.filter(b=>(b.props?.berth_type||'')==='Rail Receiving');
        const _railCarCap=parseFloat(_railBerths[0]?.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
        const _railHistT=hist=>(pid,ds)=>{ const di=_dIdx(ds); if(di<0) return 0;
          return _railBerths.reduce((s,b)=>s+(((r?.[hist]?.[b.id]||[])[di]||{})[pid]||0),0); };
        const _railTransT=_railHistT('railTransitHistory');
        const _railAtYardT=_railHistT('railAtRailyardHistory');
        const _railYardT=_railHistT('railYardHistory');
        const _railPendT=(pid,ds)=>_railTransT(pid,ds)+_railAtYardT(pid,ds)+_railYardT(pid,ds);
        const _carries=_vesselCarriesFn();

        // ── PER-PRODUCT BLOCKS ─────────────────────────────────────────────
        // Each product handled at this terminal (CEMENT first, then SCM, then others)
        // gets its own: inventory bar chart → starting inventory → requirements →
        // transferred (Transfer/Arrival + Unloading). Grouped so it reads product-by-product.
        const allSilos=facEls.filter(e=>e.type==='bulk_silo');

        // Beginning-of-day inventory (real prev-day EOD else simulated).
        const getInv=(siloId,ds,startInv)=>{
          const realInv=_idxFirst('real_inventory_daily','silo_id',siloId,'date',_prevDs(ds));
          if(realInv) return {value:parseFloat(realInv.eod_volume_t)||0,isActual:true};
          const di=_dIdx(ds); const hist=r?.inventoryHistory?.[siloId]||[];
          return {value:di<=0?(parseFloat(startInv)||0):(hist[di-1]??0),isActual:false};
        };

        // Per-product arrival map (rail movements + vessel calls → tonnes/day).
        const _termArr={};
        const _addArr=(pid,ds,t)=>{ pid=_canon(pid); if(!pid||!ds||!(t>0))return; (_termArr[pid]=_termArr[pid]||{}); _termArr[pid][ds]=(_termArr[pid][ds]||0)+t; };
        const _dayToDs=day=>{const d=new Date(simStart.getFullYear(),simStart.getMonth(),simStart.getDate());d.setDate(d.getDate()+(day-1));return d._ymd();}; // calendar increment — DST-safe (no duplicate day)
        // REAL rail dispatches (DB.real_rail_daily type 'dispatched'). The Rail Schedule records
        // a PAST switch this way — a real dispatch never creates a rail movement — so a row
        // reading only DB.rail_movements missed every actual rail arrival while the simulation
        // shipped it anyway. Precedence matches the simulation: a real record REPLACES the
        // planned movements departing that origin on that date.
        const _railOrigins=(typeof rpGetOriginsForDest==='function')?rpGetOriginsForDest(fac.id):[];
        const _railOrigFacIds=new Set(_railOrigins.map(o=>_railDpFacId(o.dp)));
        const _realRailRows=(DB.real_rail_daily||[]).filter(rr=>rr.type==='dispatched'&&rr.date);
        const _realRailCovers=new Set();  // `${originFacId}|${departureDate}` reality already covers
        _realRailRows.filter(rr=>_railOrigFacIds.has(rr.facility_id))
          .forEach(rr=>_realRailCovers.add(rr.facility_id+'|'+rr.date));
        const _termArrRail={};            // real rail arrivals — {pid:{ds:tonnes}}
        _realRailRows.filter(rr=>rr.dest_facility_id===fac.id).forEach(rr=>{
          const o=_railOrigins.find(x=>_railDpFacId(x.dp)===rr.facility_id)||_railOrigins[0];
          const carCap=parseFloat(o?.dp?.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
          const transit=parseInt(o?.destCfg?.transit_days)||1;
          const pid=_canon(rr.product_id), t=(parseInt(rr.cars)||0)*carCap;
          if(!pid||!(t>0)||!S.simCfg.start_date) return;
          const ds=_dayToDs(Math.round((new Date(rr.date)-simStart)/864e5)+1+transit);
          (_termArrRail[pid]=_termArrRail[pid]||{}); _termArrRail[pid][ds]=(_termArrRail[pid][ds]||0)+t;
        });
        const _arrRealRail=(pid,ds)=>(_termArrRail[pid]&&_termArrRail[pid][ds])||0;

        (DB.rail_movements||[]).filter(rm=>rm.to_facility_id===fac.id).forEach(rm=>{
          let depDay=null,depDs=rm.departure_date||null;
          if(depDs&&S.simCfg.start_date) depDay=Math.round((new Date(depDs)-simStart)/864e5)+1;
          else if(rm.switch_day){ depDay=rm.switch_day; depDs=_dayToDs(depDay); }
          if(!depDay) return;
          if(_realRailCovers.has(_railDpFacId(getEl(rm.from_dispatch_id))+'|'+depDs)) return;
          _addArr(rm.product_id,_dayToDs(depDay+(parseInt(rm.transit_days)||1)),parseFloat(rm.total_capacity_t)||0);
        });
        // (Truck arrivals are shown separately as UNLOAD-node rows inside TRANSFERRED,
        // so they are intentionally NOT folded into the generic Transfer/Arrival row here.)
        const _berthIds=new Set(berths.map(b=>b.id));
        (DB.vessel_calls||[]).forEach(vc=>{
          if(vc.legs&&vc.legs.length){
            vc.legs.filter(l=>_berthIds.has(l.berth_element_id)&&l.arrival_date).forEach(l=>
              _addArr(l.product_id||vc.product_id,(l.arrival_date||'').slice(0,10),parseFloat(l.quantity_t)||0));
          } else if(_berthIds.has(vc.berth_element_id)&&vc.arrival_date){
            _addArr(vc.product_id,(vc.arrival_date||'').slice(0,10),parseFloat(vc.quantity_t)||parseFloat(vc.total_quantity_t)||0);
          }
        });
        const _arrPlan=(pid,ds)=>(_termArr[pid]&&_termArr[pid][ds])||0;
        const _arrRealIdx={};   // product|date → real transfer tonnes into this terminal (table order)
        (DB.real_transfers_daily||[]).forEach(t=>{ if(t.dest_facility_id!==fac.id) return; const k=_canon(t.product_id)+'|'+t.date; _arrRealIdx[k]=(_arrRealIdx[k]||0)+(parseFloat(t.volume_t)||0); });
        const _arrReal=(pid,ds)=>(_arrRealIdx[pid+'|'+ds]||0)+_arrRealRail(pid,ds);
        const _arrDay=(pid,ds)=>{ const rv=_arrReal(pid,ds); return rv>0?rv:_arrPlan(pid,ds); };
        const _prodSilos=pid=>allSilos.filter(s=>getSiloProducts(s).includes(pid));
        const _unlPlan=(pid,ds)=>{ const di=_dIdx(ds); if(di<0)return 0; return _prodSilos(pid).reduce((s,si)=>s+((r&&r.siloUnloadHistory&&r.siloUnloadHistory[si.id]||[])[di]||0),0); };
        const _unlReal=(pid,ds)=>realUnloadTonnesFacProdDay(fac.id,pid,ds);
        const _tDpsMemo=new Map();   // demand points of a product, once per product (not per cell)
        const _tDpsOf=pid=>{ let a=_tDpsMemo.get(pid); if(!a){ a=demandPoints.filter(dp=>_canon(_dpFirstProd(dp))===pid); _tDpsMemo.set(pid,a); } return a; };
        const totalNeed=(pid,ds)=>_tDpsOf(pid).reduce((s,dp)=>s+(_demandRate(dp.element_id,ds)||0),0);

        // ── Demand-swap split at a TERMINAL ────────────────────────────────
        // Same treatment the plant block gives PRODUCT REQUIREMENT. Terminals used to have
        // none, so a swap whose DESTINATION demand point lives at a terminal moved volume
        // in the engine (inventory drew down correctly) but the requirement rows here still
        // showed the point's own demand only — the tonnes appeared to vanish between the
        // source plant and the receiving terminal.
        const _tSwappedOut=(pid,ds)=>_tDpsOf(pid).reduce((q,dp)=>{
          const t=_demandRate(dp.element_id,ds)||0;
          const sw=(typeof _resolveDemandSwap==='function')?_resolveDemandSwap(dp.element_id,t,ds):null;
          return q+(sw?Math.min(sw.qty,t):0);
        },0);
        const _tSwappedIn=(pid,ds)=>_tDpsOf(pid).reduce((q,dp)=>
          q+((typeof _resolveDemandSwapIn==='function')?_resolveDemandSwapIn(dp.element_id,ds,(id)=>_demandRate(id,ds)):0),0);
        const _tDpName=id=>DB.elements.find(e=>e.id===id)?.name
          ||DB.demand_points.find(d=>d.element_id===id)?.element_name||id;
        const _tOutTargets=pid=>{ const n=new Set();
          _tDpsOf(pid).forEach(dp=>(DB.demand_substitutions||[])
            .filter(sb=>sb.from_element_id===dp.element_id)
            .forEach(sb=>n.add(sb.to_element_id?_tDpName(sb.to_element_id)
              :(_prodById.get(sb.to_product_id)?.name||sb.to_product_id))));
          return [...n].join(', '); };
        const _tInSources=pid=>{ const n=new Set();
          const ids=new Set(_tDpsOf(pid).map(dp=>dp.element_id));
          (DB.demand_substitutions||[]).filter(sb=>ids.has(sb.to_element_id))
            .forEach(sb=>n.add(_tDpName(sb.from_element_id)));
          return [...n].join(', '); };

        // ── CATEGORY-FIRST LAYOUT ──────────────────────────────────────────
        // Products are grouped by how they are STORED, not one block each:
        // one BULK block (bulk silos — cement, SCM, clinker alike), then one
        // PACKED block (packed silos). Inside each block the sections appear
        // ONCE with the products as rows: side-by-side inventory chart →
        // STARTING INVENTORY → PRODUCT REQUIREMENT → transfers split by mode
        // (⚓ VESSEL ARRIVALS · 🚂 RAIL ARRIVALS) →
        // SILO TRANSFER (silo links, one line per direction). Holistic: driven purely by topology, so
        // any current or future terminal picks this up automatically.
        const packedSilos=facEls.filter(e=>e.type==='packed_silo')
          .filter(s=>getSiloProducts(s).some(_supProdAllows));
        const _facPackers=facEls.filter(e=>e.type==='packing_plant');
        const _demProdIds=new Set(); demandPoints.forEach(dp=>{ (dp.products||[]).forEach(p=>_demProdIds.add(_canon(p.product_id))); const _fp=_dpFirstProd(dp); if(_fp) _demProdIds.add(_canon(_fp)); });
        const _catRank=pid=>{ const c=_prodById.get(pid)?.category; return (c==='cement_bulk'||c==='cement_packed')?0:c==='additive'?1:c==='clinker'?2:3; };
        const _pNameOf=pid=>_prodById.get(pid)?.name||pid;
        const _packedPids=new Set(packedSilos.flatMap(getSiloProducts).filter(Boolean));
        // Packer OUTPUT products belong to the PACKED block too, even before a
        // packed silo is wired up, so the block (and its production gantt) shows.
        _facPackers.forEach(pk=>(_capsByEl.get(pk.id)||[]).filter(c=>_isPackingRow(c))
          .forEach(c=>{ if(c.product_id) _packedPids.add(c.product_id); }));
        // A product is PACKED when it is held in packed silos here, or — if not stored
        // here at all — when its catalog category is cement_packed. Everything else
        // (incl. SCM/additives) is BULK. Silo type wins over the product name.
        const _isPackedHere=pid=>{ if(_packedPids.has(pid)) return true;
          if(allSilos.some(s=>getSiloProducts(s).includes(pid))) return false;
          return _prodById.get(pid)?.category==='cement_packed'; };
        let _prodsAll=[...new Set([...allSilos.flatMap(getSiloProducts),..._packedPids,..._demProdIds,...Object.keys(_termArr)])]
          .filter(Boolean).sort((a,b)=>_catRank(a)-_catRank(b)||_pNameOf(a).localeCompare(_pNameOf(b)));
        if(_supAllowedPids) _prodsAll=_prodsAll.filter(_supProdAllows);

        // Mode classification (topology-driven): which berth type feeds each product.
        const _railFedPids=new Set();
        _railBerths.forEach(b=>_downSilosOf(b).forEach(s=>getSiloProducts(s).forEach(p=>_railFedPids.add(p))));
        (DB.rail_movements||[]).filter(rm=>rm.to_facility_id===fac.id&&rm.product_id).forEach(rm=>_railFedPids.add(_canon(rm.product_id)));
        // …and products that only ever arrived as a REAL dispatch (no planned movement exists).
        _realRailRows.filter(rr=>rr.dest_facility_id===fac.id&&rr.product_id).forEach(rr=>_railFedPids.add(_canon(rr.product_id)));
        const _shipFedPids=new Set();
        _shipBerths.forEach(b=>_downSilosOf(b).forEach(s=>getSiloProducts(s).forEach(p=>_shipFedPids.add(p))));
        (DB.vessel_calls||[]).forEach(vc=>{
          const legs=vc.legs&&vc.legs.length?vc.legs:[vc];
          legs.forEach(l=>{ if(_berthIds.has(l.berth_element_id)&&(l.product_id||vc.product_id)) _shipFedPids.add(_canon(l.product_id||vc.product_id)); });
        });

        const _pkSilosOf=pid=>packedSilos.filter(s=>getSiloProducts(s).includes(pid));
        const _pkStartT=s=>(typeof _siloStartT==='function')?_siloStartT(s):(parseFloat(s.props?.start_inventory)||0);

        const _groupsDef=[
          {key:'bulk',  label:'BULK PRODUCTS',   accent:'var(--teal)', rgba:'var(--teal-rgb)',  chartCat:'bulk',   pids:_prodsAll.filter(p=>!_isPackedHere(p))},
          {key:'packed',label:'PACKED PRODUCTS', accent:'var(--blue)', rgba:'var(--blue-rgb)', chartCat:'packed', pids:_prodsAll.filter(p=>_isPackedHere(p))},
        ].filter(gr=>gr.pids.length);

        if(!_groupsDef.length){
          h+=`<tr><td style="${stickyLeft('var(--surface)',depth+1)}color:var(--text-dim);font-size:8px;font-style:italic">${_isPurch?'nothing bought from this source yet — wire a demand point or a swap to it':'no products configured for this terminal'}</td>${_blankCells()}</tr>`;
        }

        _groupsDef.forEach(gr=>{
          const accent=gr.accent, rgba=gr.rgba;
          const dimCol='rgba('+rgba+',calc(var(--zero-k)*.3))';
          const gKey=fac.id+'__'+gr.key; const gColl=grpCol.has(gKey);
          const suffix=gr.key==='bulk'?'(BULK)':'(PACKED)';
          const invSeckey=gr.key==='bulk'?'cementInv':'packedInv';
          const reqSeckey=gr.key==='bulk'?'cementNeed':'packedNeed';
          const _grSilosOf=pid=>gr.key==='packed'?_pkSilosOf(pid):_prodSilos(pid);
          const _grStartOf=s=>gr.key==='packed'?_pkStartT(s):(parseFloat(s.props?.start_inventory)||0);
          const _pColor=pid=>{ if(_thRule('num')==='source') return accent; const nm=_pNameOf(pid); return (typeof spProdColor==='function')?spProdColor(nm,false):accent; };
          const _pChip=pid=>`<span style="display:inline-block;width:7px;height:7px;background:${_pColor(pid)};border-radius:1px;margin-right:4px;vertical-align:-1px"></span>`;

          // Products of this group with local demand, and what each asks for HERE = own demand +
          // whatever a swap moves INTO this terminal's demand points (forecast days only), so
          // the ↳ rows add up to it. Hoisted above the group line: collapsed, that line shows
          // the group's requirement (PURCHASES at a purchased source) with the real / forecast
          // look of the rows it folds away; expanded it stays blank — the section titles below
          // carry their own totals.
          const _reqPids=gr.pids.filter(pid=>_demProdIds.has(pid));
          const _needHere=(pid,ds)=>totalNeed(pid,ds)+_tSwappedIn(pid,ds);
          const _reqDay=ds=>_reqPids.reduce((s,pid)=>s+_needHere(pid,ds),0);
          const _reqActs=ds=>_reqPids.flatMap(pid=>{ const a=_dmdActs(_tDpsOf(pid),ds); if(_tSwappedIn(pid,ds)>0) a.push(..._swapInActs(_tDpsOf(pid),ds)); return a; });
          const _grpNeedCells=()=>{ let s=''; const col=_isPurch?'var(--purple)':accent;
            months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
              const mt=mon.dates.reduce((a,ds)=>a+_reqDay(ds),0);
              s+=`<td style="border-left:2px solid rgba(${rgba},.2);font-size:9px;font-weight:700;color:${col};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
              if(!isCol) mon.dates.forEach(ds=>{ const v=_reqDay(ds);
                s+=`<td class="sup-day-${mon.ym} ${_srcCls(ds,v,_reqActs(ds))}" title="${_isPurch?'purchases':'product requirement'} ${suffix.toLowerCase()} · expand the group for the detail" style="font-size:9px;font-weight:700;color:${v>0?col:`rgba(${rgba},calc(var(--zero-k)*.3))`};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border);${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`; });
            });
            return s; };

          // Category divider (collapsible: hides this whole block)
          h+=`<tr class="sup-pgrp-hdr" onclick="_supToggleGrp('${gKey}')" style="cursor:pointer;background:rgba(${rgba},.1);border-top:2px solid rgba(${rgba},.55)">
            <td style="${stickyLeft('var(--surface2)',depth+1,'border-bottom:1px solid var(--border),')}color:${accent};font-weight:700;font-size:9px">
              ${gColl?'▶':'▼'} ${gr.label} <span style="font-size:7px;opacity:.6;margin-left:4px">${gr.pids.length} PRODUCT${gr.pids.length>1?'S':''}</span>
            </td>${(gColl&&_reqPids.length)?_grpNeedCells():_blankCells()}</tr>`;
          if(gColl) return;

          // 1) ONE inventory chart — every product of the block side-by-side (same
          // component the plants use). Rail-fed products additionally stack the
          // tonnage still on rail (transit + rail yard + local yard) as the
          // lighter dashed top segment, per product.
          if(!_isPurch) h+=_invChartRow(gr.label.replace(' PRODUCTS','')+' inventory',gr.chartCat,accent,facEls,depth+1,gr.pids,(_railBerths.length&&gr.key==='bulk')?_railPendT:null,invSeckey);

          // 2) STARTING INVENTORY (BULK|PACKED) — one row per product-silo.
          const _invPids=_isPurch?[]:gr.pids.filter(pid=>_grSilosOf(pid).length);
          if(_invPids.length){
            const _invDay=ds=>_invPids.reduce((t,pid)=>t+_grSilosOf(pid).reduce((s,si)=>s+getInv(si.id,ds,_grStartOf(si)).value,0),0);
            h+=`<tr class="sup-sec-hdr" data-seckey="${invSeckey}" onclick="_supToggleSec('${invSeckey}')" style="cursor:pointer;background:rgba(${rgba},.05);border-top:1px solid rgba(${rgba},.3)">
              <td style="${stickyLeft('var(--surface)',depth+1,'border-bottom:1px solid var(--border),')}color:${accent};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow(invSeckey)}</span> STARTING INVENTORY ${suffix}</td>`;
            months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
              const mt=mon.dates.reduce((a,ds)=>a+_invDay(ds),0)/(mon.dates.length||1);
              h+=`<td class="sx-mavg" style="border-left:2px solid rgba(${rgba},.2);font-size:9px;font-weight:700;color:${accent};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
              if(!isCol) mon.dates.forEach(ds=>{ const v=_invDay(ds);
                h+=`<td class="sup-day-${mon.ym} sx-nb" style="color:${accent};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):''}</td>`; });
            });
            h+=`</tr>`;
            _invPids.forEach(pid=>{
              const pc=_pColor(pid);
              _grSilosOf(pid).forEach(silo=>{
                const siloMax=parseFloat(silo.props?.max_capacity)||0;
                const siloStart=_grStartOf(silo);
                h+=`<tr class="supsec-${invSeckey}">
                  <td style="${stickyLeft('var(--surface)',depth+2,'border-bottom:1px solid var(--border),')}color:${pc};font-size:9px">${_siloChip(silo)||_pChip(pid)}${_pNameOf(pid)}
                    <span style="color:var(--text-dim);font-size:8px;margin-left:4px">${esc(silo.name)}${siloMax>0?' · cap '+_fmtInt(Math.round(siloMax))+'t':''}</span>${_supInactTag(silo)}</td>`;
                months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
                  const mt=mon.dates.reduce((s,ds)=>s+getInv(silo.id,ds,siloStart).value,0)/(mon.dates.length||1);
                  h+=`<td class="sx-mavg" style="border-left:2px solid rgba(${rgba},.1);font-size:9px;color:${pc};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                  if(!isCol) mon.dates.forEach(ds=>{
                    const inv=getInv(silo.id,ds,siloStart); const v=inv.value;
                    const lvlColor=invLevelColor(v,siloMax);
                    const cls=inv.isActual?'cell-real':(ds<todayStr&&v>0?'cell-gap':''); const wt=inv.isActual?'700':'400';
                    const ttl=(siloMax>0?`${Math.round(v/siloMax*100)}% of ${_fmtInt(Math.round(siloMax))}t${inv.isActual?' · actual':''}`:'')+' · click to set real inventory';
                    h+=`<td class="sup-day-${mon.ym} ${cls} sx-np" title="${ttl}" onclick="showInventoryPopup('${silo.id}','${ds}')" style="color:${v>0?lvlColor:dimCol};font-weight:${wt};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`; });
                });
                h+=`</tr>`;
              });
            });
          }

          // 3) PRODUCT REQUIREMENT (BULK|PACKED) — one row per product with local demand
          // (_reqPids / _needHere / _reqDay: see the group line above).
          if(_reqPids.length){
            const reqColor=_isPurch?'var(--purple)':'var(--blue)';
            const reqRgb=_isPurch?'var(--purple-rgb)':'var(--blue-rgb)';
            const reqLabel=_isPurch?'PURCHASES':'PRODUCT REQUIREMENT';
            const reqTitle=_isPurch?'What we buy from this source per day — its own demand plus anything swapped in':'Local demand per product';
            h+=`<tr class="sup-sec-hdr" data-seckey="${reqSeckey}" onclick="_supToggleSec('${reqSeckey}')" style="cursor:pointer;background:rgba(${reqRgb},.05);border-top:1px solid rgba(${reqRgb},.3)">
              <td title="${reqTitle}" style="${stickyLeft('var(--surface)',depth+1,'border-bottom:1px solid var(--border),')}color:${reqColor};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow(reqSeckey)}</span> ${reqLabel} ${suffix} <span style="opacity:.35;font-weight:400;font-size:8px;margin-left:3px;cursor:help">ⓘ</span></td>`;
            months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
              const mt=mon.dates.reduce((a,ds)=>a+_reqDay(ds),0);
              // A purchase past its contract is the one thing that can go wrong here.
              const monOver=_purchMaxMon>0&&mt>_purchMaxMon+.5;
              h+=`<td ${monOver?`title="${_fmtInt(Math.round(mt))} t bought — past the ${_fmtInt(Math.round(_purchMaxMon))} t contracted for the month"`:''} style="border-left:2px solid rgba(${reqRgb},.2);font-size:9px;font-weight:700;color:${monOver?'var(--red)':reqColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}${monOver?' ⚠':''}</td>`;
              if(!isCol) mon.dates.forEach(ds=>{ const v=_reqDay(ds);
                const dayOver=_purchMaxDay>0&&v>_purchMaxDay+.5;
                h+=`<td class="sup-day-${mon.ym} sx-nb" ${dayOver?`title="${_fmtInt(Math.round(v))} t — past the ${_fmtInt(Math.round(_purchMaxDay))} t/d we can buy here"`:''} style="color:${dayOver?'var(--red)':(v>0?reqColor:`rgba(${reqRgb},calc(var(--zero-k)*.3))`)};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`; });
            });
            h+=`</tr>`;
            _reqPids.forEach(pid=>{
              const _dpnDpts=demandPoints.filter(dp=>_canon(_dpFirstProd(dp))===pid);
              const _dpnBase=fac.id+'_'+reqSeckey+'_'+pid;
              h+=`<tr class="supsec-${reqSeckey}"><td style="${stickyLeft('var(--surface)',depth+2,'border-bottom:1px solid var(--border),')}color:${reqColor};font-size:9px">${_pChip(pid)}${_pNameOf(pid)}${_dpnDpts.length?_supDpnArrow(_dpnBase,_dpnDpts.length):''}</td>`;
              months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
                const mt=mon.dates.reduce((a,ds)=>a+_needHere(pid,ds),0);
                h+=`<td style="border-left:2px solid rgba(${reqRgb},.1);font-size:9px;color:${reqColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                if(!isCol) mon.dates.forEach(ds=>{ const v=_needHere(pid,ds);
                  const _acts=_dmdActs(_dpnDpts,ds); if(_tSwappedIn(pid,ds)>0) _acts.push(..._swapInActs(_dpnDpts,ds));
                  h+=`<td class="sup-day-${mon.ym} ${_srcCls(ds,v,_acts)} sx-n" style="color:${v>0?reqColor:`rgba(${reqRgb},calc(var(--zero-k)*.3))`};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`; });
              });
              h+=`</tr>`;
              h+=_supDpnRows(_dpnDpts, months, collapsed, tdSty, depth+3, _dpnBase, stickyLeft, typeof plBgtExtra==='function'?plBgtExtra(_dpnDpts):[], reqSeckey);

              // ── Swap breakdown child rows (only when a swap touches this product) ──
              // Mirrors the plant block so a relocation reads the same at both ends.
              const _soArr=allDates.map(ds=>_tSwappedOut(pid,ds));
              const _siArr=allDates.map(ds=>_tSwappedIn(pid,ds));
              const _hasSO=_soArr.some(v=>v>0), _hasSI=_siArr.some(v=>v>0);
              if(_hasSO||_hasSI){
                const _ix={}; allDates.forEach((ds,i)=>_ix[ds]=i);
                const _swapChild=(label,color,bg,valFn,actsFn)=>{
                  let rr=`<tr class="supsec-${reqSeckey} supsec-${_supDpnKey(_dpnBase)} sup-sub-row" style="background:${bg}"><td style="${stickyLeft('var(--surface)',depth+3,'border-bottom:1px solid var(--border),')}color:${color};font-size:8px;font-style:italic">${label}</td>`;
                  months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
                    const mt=mon.dates.reduce((a,ds)=>a+valFn(ds),0);
                    rr+=`<td style="border-left:2px solid rgba(var(--hi-rgb),.05);font-size:8px;color:${color};text-align:right;padding:3px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                    if(!isCol) mon.dates.forEach(ds=>{ const v=valFn(ds);
                      rr+=`<td class="sup-day-${mon.ym} ${actsFn?_srcCls(ds,v,actsFn(ds)):''}" style="font-size:8px;color:${color};text-align:right;padding:3px 4px;border-bottom:1px solid var(--border);${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):''}</td>`; });
                  });
                  return rr+`</tr>`;
                };
                const _ownFn=ds=>Math.max(0,totalNeed(pid,ds)-(_soArr[_ix[ds]]||0));
                const _tOwnActs=ds=>_dmdActs(_dpnDpts,ds), _tInActs=ds=>_swapInActs(_dpnDpts,ds);
                h+=_swapChild('↳ '+_pNameOf(pid)+' · own','var(--green)','rgba(76,175,80,.03)',_ownFn,_tOwnActs);
                if(_hasSO) h+=_swapChild('↳ ⇄ swapped out → '+(_tOutTargets(pid)||'substitute'),'var(--amber)','rgba(var(--amber-rgb),.05)',ds=>_soArr[_ix[ds]]||0,_tOwnActs);
                // (no "= required here" row: the product line above already is own + swapped in)
                if(_hasSI) h+=_swapChild('↳ ⇄ swapped in ← '+(_tInSources(pid)||'other demand'),'var(--cyan)','rgba(var(--cyan-rgb),.06)',ds=>_siArr[_ix[ds]]||0,_tInActs);
              }
            });
          }

          // 3b) PACKING PLANT PRODUCTION — terminals can pack too (e.g. PEVPACK01).
          // Same gantt component the plants use: real days show actual tonnage,
          // forecast days a product-coloured bar; click opens the Campaign popup.
          if(gr.key==='packed'&&_facPackers.length&&!_isPurch){
            const packColor='var(--blue)';
            h+=`<tr class="sup-sec-hdr" data-seckey="packProd" onclick="_supToggleSec('packProd')" style="cursor:pointer;background:rgba(var(--blue-rgb),.05);border-top:1px solid rgba(var(--blue-rgb),.3)">
              <td title="Packed · t" style="${stickyLeft('var(--surface)',depth+1,'border-bottom:1px solid var(--border),')}color:${packColor};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow('packProd')}</span> PACKING PLANT PRODUCTION <span style="opacity:.35;font-weight:400;font-size:8px;margin-left:3px;cursor:help">ⓘ</span></td>`;
            months.forEach(mon=>{
              const isCol=collapsed.has(mon.ym);
              const mt=grpMonTotal(_facPackers,mon);
              h+=`<td style="border-left:2px solid rgba(var(--blue-rgb),.2);font-size:9px;color:${packColor};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
              if(!isCol) mon.dates.forEach(ds=>{
                const dayIdx=_dIdx(ds);
                const v=grpDailyTotal(_facPackers,ds,dayIdx);
                h+=`<td class="sup-day-${mon.ym} sx-n" style="color:${packColor};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`;
              });
            });
            h+=`</tr>`;
            _facPackers.forEach(el=>{ h+=_supEquipRow(el,{color:packColor,rgb:'blue',depth:depth+2,sec:'packProd'}); });
          }

          // 4) TRANSFERS — split by arrival mode. A purchased source receives
          // nothing of ours, so the whole arrivals/transfers tail is skipped.
          if(_isPurch) return;
          const rc='var(--purple)', rcReal='var(--teal)';

          // ⚓ VESSEL ARRIVALS — ONE line per product: the gantt bar / real-values row.
          // (The old separate "Transfer / Arrival" tonnage line is gone; its content
          // lives in the bar + tooltips + green actual numbers on the same row.)
          const _vesPids=gr.pids.filter(pid=>{
            if(!_shipBerths.length) return false;
            if(_shipFedPids.has(pid)) return true;
            return _shipBerths.some(b=>{ const hh=(r&&r.berthVesselHistory&&r.berthVesselHistory[b.id])||[]; return _berthProductTimeline(hh,_carries,pid).some(x=>x); });
          });
          if(_vesPids.length){
            h+=`<tr class="sup-sec-hdr" data-seckey="termVessel" onclick="_supToggleSec('termVessel')" style="cursor:pointer;background:rgba(var(--purple-rgb),.06);border-top:1px solid rgba(var(--purple-rgb),.4)">
              <td title="One row per product — hatched green = forecast unloading (vessel name on the bar), bold green number = actual tonnes, red hatch = at anchorage · click a cell for Forecast Campaign / Real value" style="${stickyLeft('var(--surface)',depth+1,'border-bottom:1px solid var(--border),')}color:${rc};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow('termVessel')}</span> VESSEL ARRIVALS ${suffix} <span style="opacity:.35;font-weight:400;font-size:8px;margin-left:3px;cursor:help">ⓘ</span></td>${_blankCells()}</tr>`;
            _vesPids.forEach(pid=>{
              const pname=_pNameOf(pid);
              const _pidShipBerths=_shipBerths.filter(b=>{ const hh=(r&&r.berthVesselHistory&&r.berthVesselHistory[b.id])||[]; return _berthProductTimeline(hh,_carries,pid).some(x=>x); });
              if(_pidShipBerths.length){
                _pidShipBerths.forEach(berth=>{
                  const hist=(r.berthVesselHistory[berth.id])||[];
                  const tl=_berthProductTimeline(hist,_carries,pid);
                  const realDaySet=new Set((DB.real_unloading_daily||[]).filter(u=>u.berth_id===berth.id&&u.product_id===pid&&u.unit!=='cars'&&(parseFloat(u.value)||0)>0).map(u=>u.date));
                  h+=`<tr class="supsec-termVessel"><td style="${stickyLeft('var(--surface)',depth+2,'border-bottom:1px solid var(--border),')}color:${_pColor(pid)};font-size:9px">${_pChip(pid)}${pname}<span style="font-size:7px;opacity:.55;margin-left:4px">${_shipBerths.length>1?berth.name:'UNLOADING'}</span></td>`;
                  let _pk=null;
                  // Simulation-proposed Anchorage / Unloading runs (per vessel) over the horizon,
                  // not real and not already forced by a vessel campaign — draggable like campaigns.
                  const _vcs=DB.vessel_campaigns||[];
                  const _vSt=i=>{ const c=tl[i]; return c&&c.vesselCallId&&(c.state==='anchorage'||c.state==='unloading')?c.vesselCallId+'|'+c.state:''; };
                  const _vSimVal=i=>{ const v=_vSt(i); const ds=_simDates[i]; if(!v||realDaySet.has(ds)) return null;
                    const id=tl[i].vesselCallId;
                    return _vcs.some(x=>x.vessel_call_id===id&&ds>=x.start_date&&ds<=x.end_date)?null:v; };
                  const _vRunAt=_simRunsFrom(_simDates, _simDates.map((d,i)=>_vSimVal(i)), '', _vSt);
                  // Split the composite "callId|state" back into key/val; a neighbour only counts for the SAME vessel.
                  const _vSimRun=ds=>{ const r0=_vRunAt[ds]; if(!r0) return null; const [key,val]=r0.val.split('|');
                    const nb=x=>{ if(!x) return ''; const [k,v]=x.split('|'); return k===key?v:''; };
                    return {key, val, s:r0.s, e:r0.e, pv:nb(r0.pv), nv:nb(r0.nv)}; };
                  // Vessel name in the middle of each (non-real) anchorage / unloading run.
                  const _vVis=new Set(); months.forEach(m=>{ if(!collapsed.has(m.ym)) m.dates.forEach(d=>_vVis.add(d)); });
                  const _vLbl=_midLabelIdx(_simDates.map((ds,i)=>{ const c=tl[i]; return (!c||!c.state||realDaySet.has(ds))?null:c.state+'|'+(c.vessel||''); }), _simDates.map(d=>_vVis.has(d)));
                  months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
                    const unl=mon.dates.reduce((s,ds)=>{ const c=tl[_dIdx(ds)]; return s+(c&&c.state==='unloading'?1:0); },0);
                    h+=`<td style="border-left:2px solid rgba(var(--purple-rgb),.1);font-size:8px;color:${rc};text-align:center;padding:4px 6px;border-bottom:1px solid var(--border)">${unl>0?unl+'d':''}</td>`;
                    if(!isCol) mon.dates.forEach(ds=>{
                      const c=tl[_dIdx(ds)]; const st=c&&c.state; const vessel=(c&&c.vessel)||''; const vesselCallId=(c&&c.vesselCallId)||'';
                      // A forced Anchorage/Unloading campaign on this vessel+day: plan-edge mark + drag grips at its ends.
                      const vc=vesselCallId?(DB.vessel_campaigns||[]).find(x=>x.vessel_call_id===vesselCallId&&ds>=x.start_date&&ds<=x.end_date)||null:null;
                      const vg=_campGrips('vessel',vc,ds)||_simGrips('simvessel',_vSimRun(ds),ds);
                      // REAL unloading (any source — vessel popup, Daily Data form, or imported file)
                      // shows the ACTUAL tonnage as a bold GREEN NUMBER on the same line.
                      if(realDaySet.has(ds)){
                        _pk='__real'; // break the run so the next forecast bar re-labels its vessel
                        const rt=realUnloadTonnesBerthProdDay(berth.id,pid,ds);
                        h+=`<td class="sup-day-${mon.ym} cell-real" title="${vessel?vessel+' — ':''}actual unloading · ${_fmtInt(Math.round(rt))} t${_vesselLeftTip(c,berth.id)} — click to edit" data-ds="${ds}" onclick="event.stopPropagation();showVesselCampaignPopup('${berth.id}','${vesselCallId}','${ds}')" style="${vg?'position:relative;':''}cursor:pointer;font-size:9px;font-weight:700;color:var(--teal);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border);${tdSty(ds)}">${_fmtInt(Math.round(rt))}${vg}</td>`;
                        return;
                      }
                      const p=_vesselCellParts(st,false);
                      const key=(st||'__i')+'|'+vessel; const runStart=!!st&&key!==_pk; _pk=key;
                      const label=_vLbl.has(_dIdx(ds))?`<span style="${_BAR_LBL_FIT}line-height:12px;color:${st==='unloading'?'var(--on-teal)':'var(--bar-lbl-down)'};pointer-events:none">${esc(vessel)}</span>`:''; // vessel name only
                      const ttl=(st?(vessel+' — '+p.lbl+_vesselLeftTip(c,berth.id)+(vc?' · 🔒 campaign '+vc.start_date+' → '+vc.end_date:'')+' — '):'')+(vesselCallId?'click to set Forecast Campaign or Real value':'no vessel scheduled');
                      h+=`<td class="sup-day-${mon.ym}" data-ds="${ds}" title="${ttl}" onclick="event.stopPropagation();showVesselCampaignPopup('${berth.id}','${vesselCallId}','${ds}')" style="cursor:pointer;position:relative;padding:3px 0;border-bottom:1px solid var(--border);overflow:visible;${tdSty(ds)}"><div style="position:relative;height:12px;background:${p.bg}${vc?';box-shadow:inset 0 2px 0 var(--plan)':''}">${label}</div>${vg}</td>`;
                    });
                  });
                  h+=`</tr>`;
                });
              } else {
                // No vessel timeline yet (e.g. simulation not run) — flat tonnage row so
                // planned arrivals/unloading still show; dbl-click sets the actual.
                const _fDay=ds=>{ const rv=_unlReal(pid,ds); if(rv>0) return rv; const up=_unlPlan(pid,ds); return up>0?up:_arrDay(pid,ds); };
                h+=`<tr class="supsec-termVessel"><td style="${stickyLeft('var(--surface)',depth+2,'border-bottom:1px solid var(--border),')}color:${_pColor(pid)};font-size:9px">${_pChip(pid)}${pname}<span style="font-size:7px;opacity:.55;margin-left:4px">ARRIVAL / UNLOADING</span></td>`;
                months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
                  const mt=mon.dates.reduce((s,ds)=>s+_fDay(ds),0);
                  h+=`<td style="border-left:2px solid rgba(var(--purple-rgb),.12);font-size:9px;font-weight:700;color:${rc};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                  if(!isCol) mon.dates.forEach(ds=>{
                    const rv=_unlReal(pid,ds); const isReal=rv>0; const v=_fDay(ds);
                    const col=isReal?rcReal:(v>0?rc:'rgba(var(--purple-rgb),calc(var(--zero-k)*.25))');
                    h+=`<td class="sup-day-${mon.ym} ${isReal?'cell-real':''} sx-np" ondblclick="event.stopPropagation();showTermRealPopup('unload','${fac.id}','${pid}','${ds}')" title="${pname} arrival/unloading · ${_fmtInt(Math.round(v))} t${isReal?' · actual':' · planned'} — dbl-click to set actual" style="color:${col};font-weight:${isReal?'700':'400'};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`; });
                });
                h+=`</tr>`;
              }
            });
          }

          // 🚂 RAIL ARRIVALS — ONE row per rail-fed product: the cars the terminal PULLS to its
          // local yard, on its switch day. The in-transit / rail-yard / local-yard stages are
          // deliberately NOT shown here, matching the Logistics › Rail Schedule destination
          // table: the day cars reach the rail yard doesn't matter to the user, the switch that
          // brings them in does. The INVENTORY rows / chart above show the day-after effect.
          // The stages still exist in the simulation (transit → rail yard → spotting on the
          // berth's switch days → local yard → unload), they are just not tabulated here.
          // Dbl-click a cell → Reconcile Rail Yard, to correct the physical car counts.
          const _railPids=gr.pids.filter(pid=>_railBerths.length&&_railFedPids.has(pid));
          if(_railPids.length){
            const _pulls=railTerminalPulls(fac.id);
            const _railArrAll=rpPlannedArrivalsForDest(fac.id,null,{allProducts:true});
            const _todayD=todayDayOffset();
            // Sim day number of a date (calendar difference — safe across the DST change).
            const _simDayOf=ds=>Math.round((new Date(ds+'T00:00:00')-new Date(S.simCfg.start_date+'T00:00:00'))/864e5)+1;
            h+=`<tr class="sup-sec-hdr" data-seckey="termRail" onclick="_supToggleSec('termRail')" style="cursor:pointer;background:rgba(var(--purple-rgb),.06);border-top:1px solid rgba(var(--purple-rgb),.4)">
              <td title="Cars pulled from the rail yard to the local yard per product, on the terminal's switch days · in the silo the next day · dbl-click a cell to reconcile the physical car count" style="${stickyLeft('var(--surface)',depth+1,'border-bottom:1px solid var(--border),')}color:${rc};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow('termRail')}</span> RAIL ARRIVALS ${suffix} <span style="opacity:.55;font-weight:400;font-size:7px;margin-left:3px;text-transform:none">cars @ ${Math.round(_railCarCap)}t</span> <span style="opacity:.35;font-weight:400;font-size:8px;margin-left:3px;cursor:help">ⓘ</span></td>${_blankCells()}</tr>`;
            _railPids.forEach(pid=>{
              const pname=_pNameOf(pid);
              // Product sub-header inside the rail section
              h+=`<tr class="supsec-termRail"><td style="${stickyLeft('var(--surface)',depth+2,'border-bottom:1px solid var(--border),')}color:${_pColor(pid)};font-size:9px;font-weight:700">${_pChip(pid)}${pname}</td>${_blankCells()}</tr>`;
              // Cars PULLED from the rail yard to the local yard, dated by the terminal's switch
              // day (the arrival day for a berth with no switch days) — the same numbers and
              // dates as the Rail Schedule's PULLED TO LOCAL YARD row (railTerminalPulls, from the
              // simulation). The day the cars reach the rail yard is only in the tooltip. A
              // window made only of real dispatches, or a physical rail-yard count, marks the
              // day real. Dbl-click → Reconcile Rail Yard.
              const _countRec=(type,ds)=>(DB.real_rail_daily||[]).find(rr=>rr.type===type&&rr.date===ds&&rr.facility_id===fac.id&&(!rr.product_id||rr.product_id===pid));
              const _cars=t=>Math.round((t||0)/_pulls.carCap);
              h+=`<tr class="supsec-termRail"><td title="Cars the terminal pulls from the rail yard on its switch day — at the local yard and in the silo the next day" style="${stickyLeft('var(--surface)',depth+3,'border-bottom:1px solid var(--border),')}color:${rc};font-size:9px">⇢ Pulled to local yard <span style="font-size:7px;opacity:.55">RAIL CARS</span></td>`;
              months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
                const mT=mon.dates.reduce((s,ds)=>s+_pulls.pulledT(pid,_simDayOf(ds)),0);
                const mCars=mon.dates.reduce((s,ds)=>s+_cars(_pulls.pulledT(pid,_simDayOf(ds))),0);
                h+=`<td title="${_fmtInt(Math.round(mT))} t" style="border-left:2px solid rgba(var(--purple-rgb),.1);font-size:9px;color:${rc};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mCars>0?mCars.toLocaleString():''}</td>`;
                if(!isCol) mon.dates.forEach(ds=>{
                  const d=_simDayOf(ds), t=_pulls.pulledT(pid,d), cars=_cars(t);
                  const dbl=`ondblclick="event.stopPropagation();showRailPlacementPopup('${fac.id}','${pid}','${ds}')"`;
                  if(!_pulls.isPullDay(d)&&!(t>0)){
                    h+=`<td class="sup-day-${mon.ym}" ${dbl} title="Not a pull day at this terminal — dbl-click to reconcile the physical car count" style="cursor:cell;border-bottom:1px solid var(--border);${tdSty(ds)}"></td>`;
                    return;
                  }
                  const info=_railPullInfo(_pulls,_railArrAll,pid,d);
                  const isReal=info.allReal||!!_countRec('railyard_count',ds);
                  const col=info.short>0?'var(--red)':isReal?rcReal:(t>0?rc:'rgba(var(--purple-rgb),calc(var(--zero-k)*.25))');
                  const nextDs=rpDayDate(d+1);
                  // A pull day still ahead takes a typed target, planned backward into the origin's
                  // pushes exactly as on the Rail Schedule (_rpPullTarget writes the same records).
                  // Click to type, dbl-click for the reconcile popup — like the Rail Car Loading row.
                  const editable=_pulls.isPullDay(d)&&d>=_todayD;
                  const ttl=`${pname} · ${cars} cars (${_fmtInt(Math.round(t))} t) pulled ${ds}${isReal?' · actual':' · planned'} — at the local yard and in the silo ${nextDs}`
                    +_railPullTipLines(info,_pulls.carCap,editable)+'\nDbl-click to reconcile the physical car count';
                  if(editable){
                    h+=`<td class="sup-day-${mon.ym} ${isReal?'cell-real':''}" ${dbl} title="${esc(ttl)}" style="cursor:cell;padding:1px 2px;border-bottom:1px solid var(--border);${info.short>0?'box-shadow:inset 0 -2px 0 var(--red);':''}${tdSty(ds)}"><input class="rail-pull-cell" data-dest="${fac.id}" data-pid="${pid}" data-day="${d}" data-base="${cars}" value="${cars}" onchange="_rpPullTarget(this)" style="width:34px;background:transparent;border:none;color:${col};font-family:var(--mono);font-size:9px;text-align:right;padding:3px 2px;outline:none;font-weight:${isReal?'700':'400'}"></td>`;
                    return;
                  }
                  h+=`<td class="sup-day-${mon.ym} ${isReal?'cell-real':(ds<todayStr&&t>0?'cell-gap':'')}" ${dbl} title="${esc(ttl)}" style="cursor:cell;font-size:9px;color:${col};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border);font-weight:${isReal?'700':'400'};${tdSty(ds)}">${cars>0?cars:0}</td>`; });
              });
              h+=`</tr>`;
            });
          }

          // OTHER ARRIVALS — safety net for products with scheduled arrivals
          // (rail_movements / vessel_calls / real transfers) that no berth here
          // classifies as vessel- or rail-fed: keep the flat arrival row so the
          // tonnage never silently disappears. dbl-click sets the actual.
          const _otherPids=gr.pids.filter(pid=>!_vesPids.includes(pid)&&!_railPids.includes(pid)
            &&(_termArr[pid]||months.some(mon=>mon.dates.some(ds=>_arrReal(pid,ds)>0))));
          if(_otherPids.length){
            h+=`<tr class="sup-sec-hdr" data-seckey="termVessel" onclick="_supToggleSec('termVessel')" style="cursor:pointer;background:rgba(var(--purple-rgb),.06);border-top:1px solid rgba(var(--purple-rgb),.4)">
              <td title="Scheduled arrivals with no ship/rail berth at this terminal — dbl-click a cell to set the actual" style="${stickyLeft('var(--surface)',depth+1,'border-bottom:1px solid var(--border),')}color:${rc};font-size:8px;letter-spacing:.5px;font-weight:700;text-transform:uppercase"><span class="sup-arrow">${_supSecArrow('termVessel')}</span> OTHER ARRIVALS ${suffix}</td>${_blankCells()}</tr>`;
            _otherPids.forEach(pid=>{
              const pname=_pNameOf(pid);
              h+=`<tr class="supsec-termVessel"><td style="${stickyLeft('var(--surface)',depth+2,'border-bottom:1px solid var(--border),')}color:${_pColor(pid)};font-size:9px">${_pChip(pid)}${pname}<span style="font-size:7px;opacity:.55;margin-left:4px">TRANSFER / ARRIVAL</span></td>`;
              months.forEach(mon=>{ const isCol=collapsed.has(mon.ym);
                const mt=mon.dates.reduce((s,ds)=>s+_arrDay(pid,ds),0);
                h+=`<td style="border-left:2px solid rgba(var(--purple-rgb),.12);font-size:9px;font-weight:700;color:${rc};text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?_fmtInt(Math.round(mt)):''}</td>`;
                if(!isCol) mon.dates.forEach(ds=>{
                  const rv=_arrReal(pid,ds); const isReal=rv>0; const v=isReal?rv:_arrPlan(pid,ds);
                  const col=isReal?rcReal:(v>0?rc:'rgba(var(--purple-rgb),calc(var(--zero-k)*.25))');
                  h+=`<td class="sup-day-${mon.ym} ${isReal?'cell-real':''} sx-np" ondblclick="event.stopPropagation();showTermRealPopup('transfer','${fac.id}','${pid}','${ds}')" title="${pname} arrival · ${_fmtInt(Math.round(v))} t${isReal?' · actual':' · planned'} — dbl-click to set actual" style="color:${col};font-weight:${isReal?'700':'400'};${tdSty(ds)}">${v>0?_fmtInt(Math.round(v)):0}</td>`; });
              });
              h+=`</tr>`;
            });
          }

          // 5) SILO TRANSFER — silo links touching this terminal's bulk silos, one line per
          // direction; clinker links get their own section, as at a plant.
          if(gr.key==='bulk'){
            h+=_slXferSection(allSilos,{key:'clinkerXfer',pred:pid=>getProductCategory(pid)==='clinker',color:'var(--orange)',rgb:'orange',depth:depth+1});
            h+=_slXferSection(allSilos,{key:'cementXfer',pred:pid=>getProductCategory(pid)!=='clinker',color:'var(--teal)',rgb:'teal',depth:depth+1});
          }
        });

      });
      const _termHTML={};
      _termSeg.forEach(([id,st],i)=>{ _termHTML[id]=h.slice(st,i+1<_termSeg.length?_termSeg[i+1][1]:h.length); });
      h=h.slice(0,_treeEnd).replace(/<!--sup-term:([^>]*?)-->/g,(m,id)=>_termHTML[id]||'');
    }
  }

  h+=`</tbody></table>`;
  wrap.innerHTML=h;
  _monthTotalsToEnd(wrap,'sup-day-',false); // month total at END of each month
  window._supMonths=months.map(m=>m.ym);
  _yearTotalsAfterMonths(wrap,'sup-day-',months,collapsed,'_supToggleYear'); // Σ YYYY after each year
  _monthsBtnLabel('sup-months-btn',collapsed,window._supMonths);
  _supApplySecStyle();
  _supMarkHeaderSource(wrap);

  const topScroll=document.getElementById('sup-top-scroll');
  const topInner=document.getElementById('sup-top-inner');
  if(topScroll&&topInner){
    requestAnimationFrame(()=>{ topInner.style.width=wrap.scrollWidth+'px'; });
    topScroll.onscroll=()=>{ wrap.scrollLeft=topScroll.scrollLeft; };
    wrap.onscroll=()=>{ topScroll.scrollLeft=wrap.scrollLeft; };
  }
} // end _renderSupplyViewInner

// When a theme colours numbers by real vs forecast (--rule-num:source), a section header's daily
// total takes the source of its rows: real when they are real that day, 'past, no actual' when
// any row is — the same cell-real / cell-gap classes the rows carry. Original: no-op.
function _supMarkHeaderSource(wrap){
  if(_thRule('fcbg')==='on') _supMarkForecastCells(wrap);
  if(_thRule('num')!=='source') return;
  const trs=wrap.querySelectorAll('tr');
  for(let r=0;r<trs.length;r++){
    const hdr=trs[r]; if(!hdr.classList.contains('sup-sec-hdr')) continue;
    const cls='supsec-'+hdr.dataset.seckey, leaves=[];
    // the section runs to the next section header; breakdown lines (demand points, swaps) sit
    // between its rows with their own classes and are skipped, not treated as the end
    for(let q=r+1;q<trs.length&&!trs[q].classList.contains('sup-sec-hdr')&&/(^|\s)supsec-/.test(trs[q].className);q++)
      if(trs[q].classList.contains(cls)&&!trs[q].classList.contains('sup-chart-row')&&!trs[q].classList.contains('sup-sub-row')&&!trs[q].classList.contains('sup-dpn-row')) leaves.push(trs[q]);
    if(!leaves.length) continue;
    for(let i=1;i<hdr.cells.length;i++){
      let real=false, gap=false;
      leaves.forEach(lf=>{ const c=lf.cells[i]; if(!c) return; if(c.classList.contains('cell-gap')||c.classList.contains('src-gap')) gap=true; else if(c.classList.contains('cell-real')) real=true; });
      if(gap) hdr.cells[i].classList.add('cell-gap'); else if(real) hdr.cells[i].classList.add('cell-real');
    }
  }
}

// A theme with --rule-fcbg:on puts a background behind forecast numbers too: day cells on or after
// today holding a non-zero number get cell-fc; real / past-no-actual cells holding zero get cell-z
// (left unfilled). Columns are dated from the header row's day cells. Original: never runs.
function _supMarkForecastCells(wrap){
  const hdr=wrap.querySelector('thead tr')||wrap.querySelector('tr'); if(!hdr) return;
  const today=new Date()._ymd(), fut=[];
  [...hdr.cells].forEach((th,i)=>{ const m=/sup-day-(\d{4}-\d{2})/.exec(th.className||''), d=th.textContent.trim();
    fut[i]=!!(m&&/^\d{1,2}$/.test(d)&&(m[1]+'-'+d.padStart(2,'0'))>=today); });
  wrap.querySelectorAll('tr.sup-sec-hdr, tr[class*="supsec-"]').forEach(tr=>{
    if(tr.classList.contains('sup-chart-row')) return;
    for(let i=1;i<tr.cells.length;i++){
      const td=tr.cells[i], nz=/[1-9]/.test(td.textContent+(td.querySelector('input')?.value||''));   // editable cells hold the number in an input
      if(td.classList.contains('cell-real')||td.classList.contains('cell-gap')){ if(!nz) td.classList.add('cell-z'); continue; }
      if(fut[i]&&nz&&!td.querySelector('div')) td.classList.add('cell-fc');
    }
  });
}

function _supToggleMonth(ym){
  if(!window._supColapsed) window._supColapsed=new Set();
  window._supColapsed.has(ym)?window._supColapsed.delete(ym):window._supColapsed.add(ym);
  renderSupplyView();
}
function _supToggleYear(y){ _foldMonths(window._supColapsed,(window._supMonths||[]).filter(m=>m.slice(0,4)===y)); renderSupplyView(); }
function _supToggleAllMonths(){ _foldMonths(window._supColapsed,window._supMonths||[]); renderSupplyView(); }

function _supToggleGrp(id){
  if(!window._supGrpCol) window._supGrpCol=new Set();
  window._supGrpCol.has(id)?window._supGrpCol.delete(id):window._supGrpCol.add(id);
  renderSupplyView();
}

function supplyScrollToday(){
  const wrap=document.getElementById('supply-table-wrap'); if(!wrap) return;
  const todayStr=new Date()._ymd();
  if(!_scrollTodayInWrap(wrap)) statMsg('Today is outside the selected time frame');
}

// ── Demand Builder modal ─────────────────────────────────
function openDemandBuilderAdvanced(elId, startDate){
  const allDpEls=(DB.elements||[]).filter(e=>e.type==='demand_point');
  if(!allDpEls.length){statMsg('No demand points in topology');return;}

  const facMap=Object.fromEntries((DB.facilities||[]).map(f=>[f.id,f]));
  const subMap=Object.fromEntries((DB.sub_regions||[]).map(s=>[s.id,s]));
  const regMap=Object.fromEntries((DB.regions||[]).map(r=>[r.id,r]));
  allDpEls.forEach(e=>{
    const fac=facMap[e.assigned_facility_id||e.facility_id];
    const sub=fac?subMap[fac.sub_region_id]:null;
    const reg=sub?regMap[sub.region_id]:null;
    e._fbFacId=fac?.id||null; e._fbSubId=sub?.id||null; e._fbRegId=reg?.id||null;
  });

  const seedEl=elId?allDpEls.find(e=>e.id===elId):null;
  const initReg=seedEl?seedEl._fbRegId:'';
  const initSub=seedEl?seedEl._fbSubId:'';
  const initFac=seedEl?seedEl._fbFacId:'';

  const regions=[...new Map(allDpEls.filter(e=>e._fbRegId).map(e=>[e._fbRegId,regMap[e._fbRegId]])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  const subsFor=rId=>allDpEls.filter(e=>!rId||e._fbRegId===rId).filter(e=>e._fbSubId).reduce((m,e)=>{m.set(e._fbSubId,subMap[e._fbSubId]);return m;},new Map());
  const facsFor=(rId,sId)=>allDpEls.filter(e=>(!rId||e._fbRegId===rId)&&(!sId||e._fbSubId===sId)).filter(e=>e._fbFacId).reduce((m,e)=>{m.set(e._fbFacId,facMap[e._fbFacId]);return m;},new Map());
  const dpsFor=(rId,sId,fId)=>allDpEls.filter(e=>(!rId||e._fbRegId===rId)&&(!sId||e._fbSubId===sId)&&(!fId||e._fbFacId===fId)).sort((a,b)=>a.name.localeCompare(b.name));

  const mk=(items,val,blank)=>`<option value="">${blank}</option>`+items.map(([id,nm])=>`<option value="${id}" ${id===val?'selected':''}>${nm}</option>`).join('');

  const regOpts=mk(regions.map(r=>[r.id,r.name]),initReg,'All');
  const subOpts=mk([...(subsFor(initReg)).values()].sort((a,b)=>a.name.localeCompare(b.name)).map(s=>[s.id,s.name]),initSub,'All');
  const facOpts=mk([...(facsFor(initReg,initSub)).values()].sort((a,b)=>a.name.localeCompare(b.name)).map(f=>[f.id,f.name]),initFac,'All');
  const dpList=dpsFor(initReg,initSub,initFac);
  const dpOpts=dpList.map(e=>`<option value="${e.id}" ${e.id===elId?'selected':''}>${esc(e.name)}</option>`).join('');

  // Initial actuals filters from Excel rows for the seed DP
  const actRows=(DB.real_shipments_daily||[]);
  const dpProds=_fbDpProducts(elId);
  const actForDp=dpProds.length?actRows.filter(r=>dpProds.includes((r.product||'').toUpperCase())):actRows;
  const uniq=(arr,key)=>[...new Set(arr.map(r=>r[key]||'').filter(Boolean))].sort();
  const custTypes=['EXT','INT'];
  const initReps=uniq(actForDp,'sales_manager');
  const initSoldTo=uniq(actForDp,'ship_to_name');
  const initShipTo=uniq(actForDp,'ship_to');

  const simStart=startDate||S.simCfg.start_date||new Date()._ymd();
  const nwdCount=(DB.non_working_days||[]).length;

  const pi='background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:10px;padding:5px 7px;outline:none;width:100%';
  const pl='font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-bottom:3px;letter-spacing:.5px;text-transform:uppercase';
  const pf='display:flex;flex-direction:column;gap:0';

  let h=`<div class="modal-hdr">
    <div>
      <span class="modal-title">⚙ Forecast Builder</span>
      <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:3px">Fires values directly to the grid — does not overwrite non-working days</div>
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <button class="tb-btn sec" style="border-color:var(--amber);color:var(--amber)" onclick="openDemandSwapManager('${elId||''}')" title="Cover part of this demand point with a substitute material">⇄ Demand Swap</button>
      <span class="modal-close" onclick="closeModal()">✕</span>
    </div>
  </div>
  <div style="padding:16px;display:flex;flex-direction:column;gap:12px">

    <!-- Line 1: Region · Sub-Region · Facility · Demand Point · Customer Type -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1.4fr 0.7fr;gap:8px">
      <div style="${pf}"><div style="${pl}">Region</div>
        <select style="${pi}" id="fb-f-reg" onchange="_fbCascadeReg()">${regOpts}</select>
      </div>
      <div style="${pf}"><div style="${pl}">Sub-Region</div>
        <select style="${pi}" id="fb-f-sub" onchange="_fbCascadeSub()">${subOpts}</select>
      </div>
      <div style="${pf}"><div style="${pl}">Facility</div>
        <select style="${pi}" id="fb-f-fac" onchange="_fbCascadeFac()">${facOpts}</select>
      </div>
      <div style="${pf}"><div style="${pl}">Demand Point</div>
        <select style="${pi}" id="fb-el-id" onchange="_fbSyncEl();_fbSyncActuals();_fbLivePreview()">
          <option value="">All</option>
          ${dpOpts}
        </select>
      </div>
      <div style="${pf}"><div style="${pl}" title="Filters Sales Rep / Sold To / Ship To below — demand points have no EXT/INT type">Cust. Type ⓘ</div>
        <select style="${pi}" id="fb-f-ctype" onchange="_fbSyncActuals()">
          <option value="">All</option>
          ${custTypes.map(t=>`<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
    </div>

    <!-- Line 2: Sales Rep · Sold To · Ship To -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      <div style="${pf}"><div style="${pl}">Sales Rep</div>
        <select style="${pi}" id="fb-f-rep">
          <option value="">All</option>
          ${initReps.map(r=>`<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>
      <div style="${pf}"><div style="${pl}">Sold To</div>
        <select style="${pi}" id="fb-f-soldto">
          <option value="">All</option>
          ${initSoldTo.map(s=>`<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
      <div style="${pf}"><div style="${pl}">Ship To</div>
        <select style="${pi}" id="fb-f-shipto">
          <option value="">All</option>
          ${initShipTo.map(s=>`<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
    </div>

    <!-- Line 3: Start Date · Horizon · End Date (conditional) -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;align-items:end">
      <div style="${pf}"><div style="${pl}">Start Date</div>
        <input style="${pi}" type="date" id="fb-start" value="${simStart}" oninput="_fbLivePreview()">
      </div>
      <div id="fb-wrap-horizon" style="${pf}"><div style="${pl}">Horizon</div>
        <select style="${pi}" id="fb-horizon" onchange="_fbSyncHorizon();_fbLivePreview()">
          <option value="eom">End of month</option>
          <option value="eoy" selected>End of year</option>
          <option value="sim">End of simulation</option>
          <option value="date">Specific date</option>
        </select>
      </div>
      <div id="fb-wrap-enddate" style="${pf};display:none"><div style="${pl}">End Date</div>
        <input style="${pi}" type="date" id="fb-end-date" value="${simStart}" oninput="_fbLivePreview()">
      </div>
    </div>

    <!-- Line 4: Method + method-specific option -->
    <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:8px">
      <div style="${pf}"><div style="${pl}">Method</div>
        <select style="${pi}" id="fb-method" onchange="_fbSyncMethod();_fbLivePreview()">
          <option value="adaptive" selected>Adaptive (auto-pick 5/10/15/30WD)</option>
          <option value="rolling">Rolling weekday average</option>
          <option value="fixed">Fixed daily value</option>
          <option value="distribute">Distribute monthly total</option>
        </select>
      </div>
      <div id="fb-wrap-rolling" style="${pf}"><div style="${pl}">Rolling Window</div>
        <select style="${pi}" id="fb-rolling-n" onchange="_fbLivePreview()">
          <option value="5">5 weekdays</option>
          <option value="10" selected>10 weekdays</option>
          <option value="20">20 weekdays</option>
          <option value="30">30 weekdays</option>
        </select>
      </div>
      <div id="fb-wrap-fixed" style="${pf};display:none"><div style="${pl}">Fixed Daily (t/day)</div>
        <input style="${pi}" type="number" step="0.1" id="fb-fixed-val" value="0" placeholder="0" oninput="_fbLivePreview()">
      </div>
      <div id="fb-wrap-month" style="${pf};display:none"><div style="${pl}">Monthly Total (t)</div>
        <input style="${pi}" type="number" step="1" id="fb-month-total" value="0" placeholder="0" oninput="_fbLivePreview()">
      </div>
    </div>

    <!-- Line 5: Ships Saturdays + Saturday % -->
    <div style="display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center">
      <label style="display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:10px;color:var(--text);cursor:pointer;white-space:nowrap">
        <input type="checkbox" id="fb-ships-sat" checked onchange="_fbLivePreview()">
        Ships Saturdays
      </label>
      <div id="fb-wrap-sat-pct" style="${pf}">
        <div style="${pl}">Saturday volume (% of weekday avg)</div>
        <input style="${pi}" type="number" id="fb-sat-pct" value="25" min="0" max="100" placeholder="25" oninput="_fbLivePreview()">
      </div>
    </div>

    <!-- Line 6: Live computed preview -->
    <div id="fb-live-preview" style="font-family:var(--mono);font-size:9px;padding:10px 12px;background:var(--surface2);border:1px solid var(--border2);border-radius:2px;display:flex;flex-wrap:wrap;gap:16px">
      <span style="color:var(--text-dim)">Adjust settings to see computed values</span>
    </div>

    <!-- Status / apply message -->
    <div id="fb-msg" style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding:8px 10px;background:var(--surface2);border:1px solid var(--border2);min-height:28px"></div>

    <!-- Non-working days note -->
    <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);display:flex;align-items:center;justify-content:space-between">
      <span>⊘ ${nwdCount} non-working day${nwdCount!==1?'s':''} excluded</span>
      <span onclick="closeModal();openNonWorkingDaysPanel()" style="cursor:pointer;color:var(--blue);text-decoration:underline">Manage non-working days</span>
    </div>

    <!-- Footer -->
    <div style="display:flex;gap:8px;justify-content:space-between;align-items:center">
      <button class="tb-btn sec" title="Upload an Excel/CSV (SCH5 export): demand points in rows, months as columns (e.g. JULY, AUGUST or 2026-07). Each monthly total is distributed across that month's eligible days using the Saturday % above." onclick="_fbBulkPick()">📥 Import SCH5 Data</button>
      <div style="display:flex;gap:8px">
        <button class="tb-btn sec" onclick="closeModal()">Cancel</button>
        <button class="tb-btn amber" onclick="_fbApply()">⚡ Apply Forecast</button>
      </div>
    </div>
  </div>`;

  showModal('_custom');
  document.getElementById('modal-content').innerHTML=h;
  _fbSyncMethod();
  _fbLivePreview();
}

function _fbSyncEl(){
  document.getElementById('fb-msg').textContent='';
}

// Return uppercase product key(s) for a demand point element.
// In real_shipments_daily, r.product === the demand point element's name.
function _fbDpProducts(elId){
  if(!elId) return [];
  const el=(DB.elements||[]).find(e=>e.id===elId);
  if(!el) return [];
  // Primary link: element name IS the product field in Excel actuals
  const names=[(el.name||'').toUpperCase()].filter(Boolean);
  // Secondary: any products wired through the demand_points catalog
  const dp=(DB.demand_points||[]).find(d=>d.element_id===elId);
  if(dp)(dp.products||[]).forEach(p=>{
    const n=(DB.products||[]).find(x=>x.id===p.product_id)?.name;
    if(n)names.push(n.toUpperCase());
  });
  return [...new Set(names)];
}

// Repopulate Sales Rep / Sold To / Ship To based on selected DP, Facility, and Customer Type
function _fbSyncActuals(){
  const elId =document.getElementById('fb-el-id')?.value||'';
  const ctype =document.getElementById('fb-f-ctype')?.value||'';
  const facId =document.getElementById('fb-f-fac')?.value||'';

  // Product filter: element name → r.product
  const prods=_fbDpProducts(elId);

  // Origin filter: selected facility name/code → r.origin
  const fac=facId?(DB.facilities||[]).find(f=>f.id===facId):null;
  const origins=fac?[(fac.name||'').toUpperCase(),(fac.code||'').toUpperCase()].filter(Boolean):[];

  let rows=(DB.real_shipments_daily||[]);
  if(prods.length)   rows=rows.filter(r=>prods.includes((r.product||'').trim().toUpperCase()));
  if(origins.length) rows=rows.filter(r=>{const o=(r.origin||'').trim().toUpperCase();return origins.some(k=>o===k||o.includes(k)||k.includes(o));});
  if(ctype)          rows=rows.filter(r=>(r.customer_type||'')===ctype);

  const uniqField=(key)=>[...new Set(rows.map(r=>r[key]||'').filter(Boolean))].sort();
  // Sold To: keyed by the real Sold-To number (spSoldToKey) so one customer with
  // several differently-formatted Ship-To names lists once, not several times;
  // the dropdown shows the real Sold-To Name (spSoldToName).
  const soldToMap={}; rows.forEach(r=>{ const k=spSoldToKey(r); if(k&&k!=='—'&&!(k in soldToMap)) soldToMap[k]=spSoldToName(r); });
  const soldTos=Object.entries(soldToMap).sort((a,b)=>a[1].localeCompare(b[1]));
  // Ship To = full ship_to_name
  const shipTos=[...new Set(rows.map(r=>r.ship_to_name||'').filter(Boolean))].sort();

  const repSel =document.getElementById('fb-f-rep');
  const soldSel=document.getElementById('fb-f-soldto');
  const shipSel=document.getElementById('fb-f-shipto');
  if(repSel) {const p=repSel.value;  repSel.innerHTML =`<option value="">All</option>`+uniqField('sales_manager').map(v=>`<option value="${v}" ${v===p?'selected':''}>${v}</option>`).join('');}
  if(soldSel){const p=soldSel.value; soldSel.innerHTML=`<option value="">All</option>`+soldTos.map(([k,name])=>`<option value="${k}" ${k===p?'selected':''}>${name}</option>`).join('');}
  if(shipSel){const p=shipSel.value; shipSel.innerHTML=`<option value="">All</option>` +shipTos.map(v=>`<option value="${v}" ${v===p?'selected':''}>${v}</option>`).join('');}
}

// Live computed preview — called on any input change
function _fbLivePreview(){
  const el=document.getElementById('fb-live-preview');
  if(!el) return;
  const elId=document.getElementById('fb-el-id')?.value||null;
  const shipTo=document.getElementById('fb-f-shipto')?.value||null;

  // Proportional preview: ship_to set, no DP
  if(!elId && shipTo){
    const split=_fbGetDpSplit(shipTo);
    if(!split){el.innerHTML=`<span style="color:var(--amber)">No historical data for "${shipTo}" — select a specific Demand Point instead</span>`;return;}
    const splitDesc=split.map(p=>`<strong>${p.name}</strong> ${Math.round(p.proportion*100)}%`).join(' · ');
    el.innerHTML=`<span style="color:var(--text-dim)">Will distribute proportionally →</span> ${splitDesc}`;
    return;
  }

  const result=_fbBuildRows();
  if(!result){el.innerHTML='<span style="color:var(--text-dim)">Select a demand point or ship-to to see computed values</span>';return;}
  const {rows,msgs}=result;
  const active=rows.filter(r=>r.value>0);
  const total=active.reduce((s,r)=>s+r.value,0);
  const avgDay=active.length?total/active.length:0;
  const wkdays=active.filter(r=>{const d=new Date(r.date+'T00:00:00').getDay();return d>=1&&d<=5;});
  const sats=active.filter(r=>new Date(r.date+'T00:00:00').getDay()===6);
  const avgWkday=wkdays.length?wkdays.reduce((s,r)=>s+r.value,0)/wkdays.length:0;
  el.innerHTML=`
    <span style="color:var(--text-dim)">Weekday avg</span><strong style="color:var(--text)">${avgWkday.toFixed(1)} t</strong>
    <span style="color:var(--text-dim)">Sat avg</span><strong style="color:var(--text)">${sats.length?(sats.reduce((s,r)=>s+r.value,0)/sats.length).toFixed(1)+' t':'—'}</strong>
    <span style="color:var(--text-dim)">Active days</span><strong style="color:var(--text)">${active.length}</strong>
    <span style="color:var(--text-dim)">Total</span><strong style="color:var(--green)">${Math.round(total).toLocaleString()} t</strong>
    <span style="color:var(--text-dim);font-size:8px">${msgs.join(' · ')}</span>`;
}

function _fbCascadeReg(){
  const regId=document.getElementById('fb-f-reg')?.value||'';
  const allDpEls=(DB.elements||[]).filter(e=>e.type==='demand_point');
  const facMap=Object.fromEntries((DB.facilities||[]).map(f=>[f.id,f]));
  const subMap=Object.fromEntries((DB.sub_regions||[]).map(s=>[s.id,s]));
  const regMap=Object.fromEntries((DB.regions||[]).map(r=>[r.id,r]));
  allDpEls.forEach(e=>{
    const fac=facMap[e.assigned_facility_id||e.facility_id];
    const sub=fac?subMap[fac.sub_region_id]:null;
    const reg=sub?regMap[sub.region_id]:null;
    e._fbFacId=fac?.id||null; e._fbSubId=sub?.id||null; e._fbRegId=reg?.id||null;
  });
  const subs=[...new Map(allDpEls.filter(e=>(!regId||e._fbRegId===regId)&&e._fbSubId).map(e=>[e._fbSubId,subMap[e._fbSubId]])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  const subSel=document.getElementById('fb-f-sub');
  subSel.innerHTML=`<option value="">All</option>`+subs.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  _fbCascadeSub();
}

function _fbCascadeSub(){
  const regId=document.getElementById('fb-f-reg')?.value||'';
  const subId=document.getElementById('fb-f-sub')?.value||'';
  const allDpEls=(DB.elements||[]).filter(e=>e.type==='demand_point');
  const facMap=Object.fromEntries((DB.facilities||[]).map(f=>[f.id,f]));
  const facs=[...new Map(allDpEls.filter(e=>(!regId||e._fbRegId===regId)&&(!subId||e._fbSubId===subId)&&e._fbFacId).map(e=>[e._fbFacId,facMap[e._fbFacId]])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  const facSel=document.getElementById('fb-f-fac');
  facSel.innerHTML=`<option value="">All</option>`+facs.map(f=>`<option value="${f.id}">${f.name}</option>`).join('');
  _fbCascadeFac();
}

function _fbCascadeFac(){
  const regId=document.getElementById('fb-f-reg')?.value||'';
  const subId=document.getElementById('fb-f-sub')?.value||'';
  const facId=document.getElementById('fb-f-fac')?.value||'';
  const allDpEls=(DB.elements||[]).filter(e=>e.type==='demand_point');
  const dps=allDpEls.filter(e=>(!regId||e._fbRegId===regId)&&(!subId||e._fbSubId===subId)&&(!facId||e._fbFacId===facId)).sort((a,b)=>a.name.localeCompare(b.name));
  const dpSel=document.getElementById('fb-el-id');
  dpSel.innerHTML=`<option value="">All</option>`+dps.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('');
  document.getElementById('fb-msg').textContent='';
  _fbSyncActuals();
  _fbLivePreview();
}

function _fbSyncMethod(){
  const m=document.getElementById('fb-method')?.value;
  if(!m) return;
  document.getElementById('fb-wrap-rolling').style.display=m==='rolling'?'flex':'none';
  document.getElementById('fb-wrap-fixed').style.display=m==='fixed'?'flex':'none';
  document.getElementById('fb-wrap-month').style.display=m==='distribute'?'flex':'none';
  document.getElementById('fb-wrap-horizon').style.display=m==='distribute'?'none':'flex';
  if(m==='distribute') document.getElementById('fb-wrap-enddate').style.display='none';
  document.getElementById('fb-msg').textContent='';
}

function _fbSyncHorizon(){
  const h=document.getElementById('fb-horizon')?.value;
  document.getElementById('fb-wrap-enddate').style.display=h==='date'?'flex':'none';
}

// Return proportional DP split for a ship_to customer based on historical actuals.
// Returns [{elId, name, proportion}] or null if no data / single DP.
function _fbGetDpSplit(shipTo){
  if(!shipTo) return null;
  const actRows=(DB.real_shipments_daily||[]).filter(r=>r.ship_to_name===shipTo);
  if(!actRows.length) return null;
  const volByProd={};
  actRows.forEach(r=>{ volByProd[(r.product||'').trim().toUpperCase()]=(volByProd[(r.product||'').trim().toUpperCase()]||0)+(parseFloat(r.volume)||0); });
  const allDpEls=(DB.elements||[]).filter(e=>e.type==='demand_point');
  const dpNameIdx=Object.fromEntries(allDpEls.map(el=>[(el.name||'').trim().toUpperCase(),el]));
  const parts=Object.entries(volByProd).map(([prod,vol])=>{const el=dpNameIdx[prod];return el?{elId:el.id,name:el.name,vol}:null;}).filter(Boolean);
  if(!parts.length) return null;
  const total=parts.reduce((s,p)=>s+p.vol,0)||1;
  return parts.map(p=>({elId:p.elId,name:p.name,proportion:p.vol/total}));
}

// Get all ship_to_name values that belong to a given Sold-To key, optionally filtered by elId
function _fbGetShipToSplit(soldTo, elId){
  if(!soldTo) return null;
  let rows=(DB.real_shipments_daily||[]).filter(r=>spSoldToKey(r)===soldTo);
  if(elId){ const prods=_fbDpProducts(elId); if(prods.length) rows=rows.filter(r=>prods.includes((r.product||'').trim().toUpperCase())); }
  if(!rows.length) return null;
  const volBySt={};
  rows.forEach(r=>{ const st=r.ship_to_name||''; if(st) volBySt[st]=(volBySt[st]||0)+(parseFloat(r.volume)||0); });
  const total=Object.values(volBySt).reduce((s,v)=>s+v,0)||1;
  return Object.entries(volBySt).map(([st,vol])=>({ship_to:st,proportion:vol/total}));
}

// ── Truck-load rounding ───────────────────────────────────
// Forecast values are planned in whole truck loads. Rounding is to the NEAREST
// step, not up: at demand-point grain rounding up costs +1.65%, and at
// ship-to grain +22.6%, which would flow into vessel auto-propose as demand
// that does not exist.
const FB_STEP=25;

// Nearest step. A positive rate never rounds away to nothing — the smallest
// demand points (e.g. 11 t/day) would otherwise forecast zero forever.
function _fbQ25(v){
  if(!(v>0)) return 0;
  return Math.max(FB_STEP, Math.round(v/FB_STEP)*FB_STEP);
}

// Same, but no floor — for derived values where zero is a legitimate answer
// (a Saturday at 25% of a small weekday rate really is no truck).
function _fbQ25z(v){ return v>0?Math.round(v/FB_STEP)*FB_STEP : 0; }

// Split `total` across weighted slots in whole steps, largest-remainder style,
// so the slots still sum to `total` (quantised to the step) instead of each
// slot rounding independently and the total drifting.
function _fbAlloc25(weights, total){
  const n=weights.length;
  if(!n) return [];
  if(!(total>0)) return new Array(n).fill(0);
  const chunks=Math.max(1, Math.round(total/FB_STEP));
  const wSum=weights.reduce((s,w)=>s+w,0)||1;
  const ideal=weights.map(w=>chunks*w/wSum);
  const out=ideal.map(Math.floor);
  let short=chunks-out.reduce((s,v)=>s+v,0);
  ideal.map((v,i)=>({i,frac:v-Math.floor(v)}))
       .sort((a,b)=>b.frac-a.frac)
       .forEach(({i})=>{ if(short>0){ out[i]++; short--; } });
  return out.map(c=>c*FB_STEP);
}

// ── Adaptive forecasting engine ───────────────────────────
// Ported from the Avila Sales adaptive engine. Walk-forward, next-weekday
// backtest over the last 3 calendar months of actuals to auto-pick the best
// moving-average window; the winning window's average becomes the daily rate.
// Rules: weekdays only (Sat/Sun ignored in the backtest), never uses future
// data, same period scored for every candidate, lowest MAPE always wins.
const FB_ADAPT_WINDOWS=[5,10,15,30];
function _fbAdaptConf(m){ return m<5?{lbl:'Excellent',col:'var(--green)'}:m<10?{lbl:'Good',col:'var(--blue)'}:m<15?{lbl:'Fair',col:'var(--amber)'}:{lbl:'Poor',col:'var(--red)'}; }
function _fbAdaptiveRun(dates, vols){
  const L=vols.length; if(L<8) return null;
  const last=new Date(dates[L-1]+'T00:00:00'); last.setMonth(last.getMonth()-3);
  const cut=last._ymd();
  let h0=0; while(h0<L && dates[h0]<cut) h0++;
  const P=new Array(L+1); P[0]=0; for(let i=0;i<L;i++) P[i+1]=P[i]+(vols[i]||0);
  const ma=(i,n)=>(P[i+1]-P[i+1-n])/n;              // avg of the n weekdays ending at index i
  const errs={}; FB_ADAPT_WINDOWS.forEach(n=>errs[n]=0);
  let pts=0;
  // Stand on each historical weekday with ≥30 prior points, forecast ONLY the
  // next weekday with each candidate, using only data available at that moment.
  for(let i=Math.max(h0,29); i<L-1; i++){ const a=vols[i+1]; if(!(a>0)) continue; for(const n of FB_ADAPT_WINDOWS) errs[n]+=Math.abs(a-ma(i,n))/a; pts++; }
  if(pts<5) return null;
  const mape={}; FB_ADAPT_WINDOWS.forEach(n=>{ mape[n]=errs[n]/pts*100; });
  let best=FB_ADAPT_WINDOWS[0]; FB_ADAPT_WINDOWS.forEach(n=>{ if(mape[n]<mape[best]) best=n; });
  const avg=L>=best ? (P[L]-P[L-best])/best : P[L]/L;  // forecast = avg of most recent N weekdays of winner
  return {n:best, avg, mape, points:pts, conf:_fbAdaptConf(mape[best])};
}

