// ═══════════════════════════════════════════════════════
// SCHEDULES
// ═══════════════════════════════════════════════════════
// ── LOGISTICS FILTERS — the shared filter bar on the Vessel / Rail / Truck tabs ──
// One bar above the three tabs (fltRender('logi')). What a selection means per tab:
//   Vessel — ship-berth terminals in the Facility/Sub-region pick; allowed products' rows.
//   Rail   — lanes with EITHER end picked (rpShownDests); an origin's push rows keep every
//            destination and product and only hide the filtered ones (see rpRender).
//   Truck  — movements with either end picked, an allowed product, overlapping the window.
FLT_PAGES.logi={
  // The rail simulation can run past the configured horizon, so the rail tab's days reach further.
  bounds:()=>fltSimBounds(S.activeSchedTab==='rail'?(S.simResults?.simHorizon||S.simCfg.horizon||90):undefined),
  // The shared Process keys each planner's rows answer to (_logiApplyProcStyle).
  proc:()=>S.activeSchedTab==='rail'?['railLoad','termRail','cementInv','cementNeed']
          :S.activeSchedTab==='vessels'?['termVessel','cementInv','cementNeed']:null,
  rerender:()=>{
    fltRender('logi'); _logiApplyProcStyle();
    const t=S.activeSchedTab||'vessels';
    if(t==='vessels'){ renderVesselTable(); vpRender(); }
    else if(t==='rail'){ renderRailTable(); rpRender(); }
    else if(t==='silo') renderSiloXferRegister();
  }
};
// Shows the bar on the tabs that use it and repaints it for the active one.
function _logiFilterBarSync(){
  const t=S.activeSchedTab||'vessels';
  const on=['vessels','rail'].includes(t);
  const bar=document.getElementById('logi-filter-bar');
  if(bar) bar.style.display=on?'flex':'none';
  const hdr=document.getElementById('logi-sched-hdr');
  if(hdr) hdr.style.display=t==='maintenance'?'none':'flex';
  if(on){ fltRender('logi'); _logiApplyProcStyle(); }
}
// Process on the planners is a stylesheet rule, like the Supply page: the tree kit resets inline
// display on every fold, so inline styles would not stick. Both planners stamp the same row
// classes (rp-o = rail origin band, rp-d = destination rows). Rows the filters keep in the DOM
// but out of sight — a rail origin's pushes to terminals outside the Facility pick — carry .flt-off.
function _logiApplyProcStyle(){
  let st=document.getElementById('logi-proc-style');
  if(!st){ st=document.createElement('style'); st.id='logi-proc-style'; document.head.appendChild(st); }
  const off=k=>!fltProcOn(k), hide=sel=>sel+'{display:none!important}';
  let css=hide('#rp-rail-table tr.flt-off');
  if(off('termVessel')) css+=hide('#vp-dest-table tr.tp-row-arrival,#vp-dest-table tr.tp-row-unload');
  if(off('cementInv'))  css+=hide('#vp-dest-table tr.tp-row-inv,#rp-rail-table tr.rp-d.tp-row-inv');
  if(off('cementNeed')) css+=hide('#vp-dest-table tr.tp-row-dem,#rp-rail-table tr.rp-d.tp-row-dem');
  if(off('railLoad'))   css+=hide('#rp-rail-table tr.rp-o');
  if(off('termRail'))   css+=hide('#rp-rail-table tr.rp-d.tp-row-arrival');
  st.textContent=css;
}

function setSchedTab(tab,el){
  S.activeSchedTab=tab;
  // The in-page tab strip changes the sub-tab too — keep the section's second-row tabs on it.
  if(S.topSection==='logistics') _syncSecTab('schedules');
  document.querySelectorAll('.sched-tab').forEach(t=>t.classList.remove('active'));
  if(el) el.classList.add('active');
  else document.querySelector(`.sched-tab[onclick*="'${tab}'"]`)?.classList.add('active');
  document.querySelectorAll('.sched-content').forEach(c=>c.classList.remove('active'));
  document.getElementById(`sched-${tab}`)?.classList.add('active');
  _logiFilterBarSync();
  if(tab==='maintenance') renderMaintenanceCalendar();
  if(tab==='vessels'){renderVesselTable?.();vpRender();}
  if(tab==='rail'){renderRailTable?.();rpRender();}
  if(tab==='silo') renderSiloXferRegister();
}

// Fold the inventory charts away on both planners (vessel + rail). A per-viewer
// convenience, so it lives in localStorage and never in the scenario.
function _logiChartsApply(){
  const hide=!!S.logiHideCharts;
  document.body.classList.toggle('logi-hide-charts',hide);
  document.querySelectorAll('.logi-charts-btn').forEach(b=>{
    b.textContent=hide?'Show Charts':'Hide Charts';
    b.classList.toggle('active',hide);
  });
}
function _toggleLogiCharts(){
  S.logiHideCharts=!S.logiHideCharts;
  try{ localStorage.setItem('avila_logi_hide_charts',S.logiHideCharts?'1':'0'); }catch(e){}
  _logiChartsApply();
  // Charts drawn while hidden have no size — redraw them on the way back.
  if(!S.logiHideCharts){
    if(S.activeSchedTab==='vessels'&&typeof vpRenderCharts==='function') vpRenderCharts();
    if(S.activeSchedTab==='rail'&&typeof rpRenderCharts==='function') rpRenderCharts();
  }
}
try{ S.logiHideCharts=localStorage.getItem('avila_logi_hide_charts')==='1'; }catch(e){ S.logiHideCharts=false; }
document.addEventListener('DOMContentLoaded',_logiChartsApply);
if(document.readyState!=='loading') setTimeout(_logiChartsApply,0);

// Fold every month of both planners to its total (month + year totals only), or open them all
// when the planner on screen has them all folded. Both planners' sets move together; the one
// on screen re-renders now, the other when its tab is opened (setSchedTab renders it).
function _toggleLogiFold(){
  const v=S.activeSchedTab==='vessels';
  const set=v?window._vpColapsed:window._rpColapsed, yms=(v?window._vpMonths:window._rpMonths)||[];
  if(!set||!yms.length) return;
  const open=yms.every(m=>set.has(m));
  [[window._rpColapsed,window._rpMonths],[window._vpColapsed,window._vpMonths]].forEach(([s,ms])=>{ if(s&&ms) ms.forEach(m=>open?s.delete(m):s.add(m)); });
  if(v) vpRender(); else rpRender();
}
function _logiFoldBtn(set, yms){
  const all=!!(yms&&yms.length)&&yms.every(m=>set&&set.has(m));
  document.querySelectorAll('.logi-fold-btn').forEach(b=>{ b.textContent=all?'Expand Months':'Collapse Months'; b.classList.toggle('active',all);
    b.title=all?'Show the day columns of every month':'Fold every month to its total — only the month and year totals stay'; });
}
// Collapse / expand the monthly-summary columns in the logistics planners (rail + vessel).
function _toggleLogiMonths(){
  S.logiHideMonths=!S.logiHideMonths;
  document.body.classList.toggle('logi-hide-months',S.logiHideMonths);
  document.querySelectorAll('.logi-months-btn').forEach(b=>{
    b.textContent=S.logiHideMonths?'Show Monthly Totals':'Hide Monthly Totals';
    b.classList.toggle('active',S.logiHideMonths);
  });
}

// Auto-Propose toggle (logistics rail + vessel planners). When ON, Run Simulation
// proposes vessel calls to cover projected shortfalls. When OFF ("Forecast mode"),
// the simulation adds nothing — it only projects inventory from the vessels/rail the
// user has already proposed/confirmed. Both planner buttons stay in sync and the
// setting is persisted in S.simCfg.
function _toggleAutoPropose(){
  S.simCfg.autoPropose=(S.simCfg.autoPropose===false); // flip
  _syncSimToggle();
  autoSave();
  statMsg(S.simCfg.autoPropose
    ? 'Auto-Propose ON — Run Simulation will propose vessel calls to cover shortfalls.'
    : 'Forecast mode ON — Run Simulation will project inventory only, without adding vessels.');
}

// ── Table font-size (zoom) control ───────────────────────────
// One factor scales every data grid (supply, demand, results, dashboard, logistics,
// sales) proportionally, so the row-header / column-header / data hierarchy is kept.
// dir: +1 bigger, -1 smaller, 0 reset. Persisted in localStorage.
const TBL_ZOOM_MIN=0.7, TBL_ZOOM_MAX=1.8, TBL_ZOOM_STEP=0.1;
function _getTblZoom(){ const v=parseFloat(localStorage.getItem('avila_tbl_zoom')); return (v&&v>0)?v:1; }
function _applyTblZoom(z){
  const zc=Math.round(Math.min(TBL_ZOOM_MAX,Math.max(TBL_ZOOM_MIN,z))*100)/100;
  document.documentElement.style.setProperty('--tbl-zoom',zc);
  const lbl=document.getElementById('tblfs-val'); if(lbl) lbl.textContent=Math.round(zc*100)+'%';
  // Re-sync the mirrored top scrollbars: the zoomed table changed its scrollWidth.
  requestAnimationFrame(()=>{
    [['sup-top-inner','supply-table-wrap'],['dem-top-inner','demand-table-wrap'],
     ['results-top-scroll-inner','results-table-wrap']].forEach(([innerId,wrapId])=>{
      const inner=document.getElementById(innerId), wrap=document.getElementById(wrapId);
      if(inner&&wrap) inner.style.width=wrap.scrollWidth+'px';
    });
  });
  return zc;
}
function _setTblZoom(dir){
  const z=dir===0?1:_getTblZoom()+dir*TBL_ZOOM_STEP;
  const zc=_applyTblZoom(z);
  localStorage.setItem('avila_tbl_zoom',zc);
  statMsg(dir===0?'Table text size reset to 100%':'Table text size '+Math.round(zc*100)+'%');
}

// ═══════════════════════════════════════════════════════
// RESIZABLE ROW-TITLE COLUMN
// Like Excel: drag the right edge of a table's first header cell to widen or narrow the
// row-title column; double-click that edge to go back to the default width. One width per
// table, remembered in this browser (localStorage 'avila_col0w'), never in a scenario.
// The width lives in a generated <style>, so it survives every re-render with no hook
// in the render code. Add a table here to make its first column resizable.
// ═══════════════════════════════════════════════════════
const C0W_KEY='avila_col0w', C0W_MIN=80, C0W_MAX=900, C0W_GRAB=6;
const C0W_TABLES=[
  {key:'supply',     sel:'#supply-table-wrap>table'},
  {key:'demand',     sel:'#demand-table-wrap>table'},
  {key:'vessel',     sel:'#vp-dest-table'},
  {key:'vesselOrig', sel:'#vp-orig-table'},
  {key:'rail',       sel:'#rp-rail-table'},
  {key:'datatable',  sel:'.dtree-table'},
  {key:'sales',      sel:'#sp-table'},
];
let _c0w={}; try{ _c0w=JSON.parse(localStorage.getItem(C0W_KEY)||'{}')||{}; }catch(e){ _c0w={}; }
const _c0Hdr=t=>`${t.sel}>thead>tr:first-child>th:first-child`;
function _c0wApply(){
  let st=document.getElementById('c0w-style');
  if(!st){ st=document.createElement('style'); st.id='c0w-style'; document.head.appendChild(st); }
  // grip: two thin lines on the header's right edge — faint on hover, blue when grabbable
  const hdrs=C0W_TABLES.map(_c0Hdr);
  let css=hdrs.map(h=>h+'::after').join(',')+`{content:'';position:absolute;top:5px;bottom:5px;right:2px;width:3px;border-left:1px solid var(--text-dim);border-right:1px solid var(--text-dim);opacity:0;pointer-events:none;transition:opacity .12s;}`
    +hdrs.map(h=>h+':hover::after').join(',')+'{opacity:.5;}';
  css+=C0W_TABLES.filter(t=>_c0w[t.key]>0).map(t=>{
    const s=t.sel, w=Math.round(_c0w[t.key])+'px';
    const cells=[`${s}>thead>tr:first-child>:first-child`,`${s}>tbody>tr>:first-child`]
      .flatMap(c=>[`${c}:not([colspan])`,`${c}[colspan="1"]`]).join(',');
    return `${cells}{box-sizing:border-box;width:${w}!important;min-width:${w}!important;max-width:${w}!important;overflow:hidden;text-overflow:ellipsis;}`;
  }).join('');
  st.textContent=css;
}
function _c0wSave(){ try{ localStorage.setItem(C0W_KEY,JSON.stringify(_c0w)); }catch(e){} }
// The first-column header whose right border is under the pointer (a few px either side).
function _c0At(e){
  const th=e.target&&e.target.closest?e.target.closest('th'):null; if(!th) return null;
  for(const c of [th, th.previousElementSibling]){
    if(!c||c.tagName!=='TH') continue;
    const t=C0W_TABLES.find(x=>c.matches(_c0Hdr(x))); if(!t) continue;
    const r=c.getBoundingClientRect();
    if(e.clientX>=r.right-C0W_GRAB&&e.clientX<=r.right+3) return {th:c,t};
  }
  return null;
}
let _c0Drag=null, _c0Edge=null, _c0Raf=0, _c0NoClick=false;
const _c0Width=d=>Math.round(Math.min(C0W_MAX,Math.max(C0W_MIN,d.w0+(d.x-d.x0)/d.scale)));
function _c0SetEdge(th){
  if(_c0Edge&&_c0Edge!==th) _c0Edge.classList.remove('c0-edge');
  _c0Edge=th; if(th) th.classList.add('c0-edge');
}
function _c0SyncMirrors(){ // the mirrored top scrollbars follow the table's new width
  requestAnimationFrame(()=>{
    [['sup-top-inner','supply-table-wrap'],['dem-top-inner','demand-table-wrap']].forEach(([i,w])=>{
      const inner=document.getElementById(i), wrap=document.getElementById(w);
      if(inner&&wrap) inner.style.width=wrap.scrollWidth+'px';
    });
  });
}
document.addEventListener('mousemove',e=>{
  if(_c0Drag){
    const d=_c0Drag; d.x=e.clientX;
    if(!_c0Raf) _c0Raf=requestAnimationFrame(()=>{ _c0Raf=0; _c0w[d.t.key]=_c0Width(d); _c0wApply(); });
    return;
  }
  const hit=_c0At(e); _c0SetEdge(hit?hit.th:null);
},{passive:true});
document.addEventListener('mousedown',e=>{
  if(e.button!==0) return;
  const hit=_c0At(e); if(!hit) return;
  e.preventDefault(); e.stopPropagation();
  // widths are CSS px; the pointer moves in screen px (they differ when the table text size is zoomed)
  const r=hit.th.getBoundingClientRect(), cs=getComputedStyle(hit.th);
  let w0=parseFloat(cs.width)||r.width; // the rule sets the border-box width, so measure the same box
  if(cs.boxSizing==='content-box') w0+=parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight)+parseFloat(cs.borderLeftWidth)+parseFloat(cs.borderRightWidth);
  _c0Drag={t:hit.t, x0:e.clientX, x:e.clientX, w0, scale:(r.width/w0)||1};
  document.body.classList.add('c0-drag');
},true);
document.addEventListener('mouseup',()=>{
  if(!_c0Drag) return;
  const d=_c0Drag; _c0Drag=null;
  if(_c0Raf){ cancelAnimationFrame(_c0Raf); _c0Raf=0; }
  if(d.x!==d.x0){ _c0w[d.t.key]=_c0Width(d); _c0wApply(); } // final width from the release point, not the last frame
  _c0NoClick=true; setTimeout(()=>{ _c0NoClick=false; },0);
  document.body.classList.remove('c0-drag');
  _c0wSave(); _c0SyncMirrors();
},true);
// the click that ends a drag must not also press whatever sits under the pointer
document.addEventListener('click',e=>{ if(_c0NoClick){ e.preventDefault(); e.stopPropagation(); _c0NoClick=false; } },true);
document.addEventListener('dblclick',e=>{
  const hit=_c0At(e); if(!hit) return;
  e.preventDefault(); e.stopPropagation();
  delete _c0w[hit.t.key]; _c0wApply(); _c0wSave(); _c0SyncMirrors();
  if(typeof statMsg==='function') statMsg('Column width reset to default');
},true);
_c0wApply();

// Reflect the current S.simCfg.autoPropose state on every toggle button. Treat an
// undefined flag as ON (the default) so existing scenarios keep prior behaviour.
function _syncSimToggle(){
  const off=S.simCfg.autoPropose===false;
  document.querySelectorAll('.logi-sim-toggle').forEach(b=>{
    b.textContent=off?'Auto-Propose: OFF':'Auto-Propose: ON';
    b.classList.toggle('active',!off);
    b.classList.toggle('logi-sim-off',off);
  });
}

// ── TRANSPORT STATUS WORKFLOW ────────────────────────────────
// Shared by vessel_calls and rail_movements.
const TRANSPORT_STATUSES=[
  {id:'Proposed',   color:'var(--text-dim)',  bg:'rgba(var(--hi-rgb),.07)', locked:false, desc:'Auto-generated by simulation'},
  {id:'Planned',    color:'var(--amber)',     bg:'rgba(var(--amber-rgb),.12)',  locked:false, desc:'Approved by logistics manager'},
  {id:'Confirmed',  color:'var(--green)',     bg:'rgba(0,229,160,.12)',   locked:true,  desc:'Locked — simulation treats as ground truth'},
  {id:'In Transit', color:'var(--blue)',      bg:'rgba(var(--blue-rgb),.12)',  locked:true,  desc:'Movement in progress'},
  {id:'Unloading',  color:'var(--sky)',       bg:'rgba(var(--sky-rgb),.12)',  locked:true,  desc:'Currently being unloaded'},
  {id:'Finished',   color:'var(--text-dim)',  bg:'rgba(var(--hi-rgb),.05)', locked:true,  desc:'Complete'},
];

function _tsGet(statusId){
  return TRANSPORT_STATUSES.find(s=>s.id===statusId)||TRANSPORT_STATUSES[1]; // default Planned
}

function _tsLocked(statusId){
  return _tsGet(statusId).locked;
}

function _tsNext(statusId){
  const idx=TRANSPORT_STATUSES.findIndex(s=>s.id===statusId);
  if(idx<0||idx>=TRANSPORT_STATUSES.length-1) return null;
  return TRANSPORT_STATUSES[idx+1].id;
}

function _tsBadge(statusId){
  const s=_tsGet(statusId);
  const lock=s.locked?'🔒 ':'';
  return `<span style="font-family:var(--mono);font-size:8px;padding:2px 7px;border:1px solid ${s.color};color:${s.color};background:${s.bg};white-space:nowrap">${lock}${s.id}</span>`;
}



function advanceVesselStatus(id){
  const v=DB.vessel_calls.find(x=>x.id===id); if(!v) return;
  const next=_tsNext(v.status||'Planned'); if(!next) return;
  v.status=next;
  // Sync all legs while parent is at or before In Transit
  const nextIdx=TRANSPORT_STATUSES.findIndex(s=>s.id===next);
  const inTransitIdx=TRANSPORT_STATUSES.findIndex(s=>s.id==='In Transit');
  if(v.legs&&v.legs.length&&nextIdx<=inTransitIdx){
    v.legs.forEach(leg=>{
      const legIdx=TRANSPORT_STATUSES.findIndex(s=>s.id===(leg.status||'Proposed'));
      if(legIdx<=nextIdx) leg.status=next;
    });
  }
  autoSave(); renderVesselTable();
}

// Delete a vessel call. Available at every status (the planner owns the record), but a
// call that has already been Confirmed / In Transit / Unloading / Finished asks first,
// since deleting it also drops its manual schedule overrides.
function _delVessel(i){
  const v=DB.vessel_calls[i]; if(!v) return;
  if(_tsLocked(v.status||'Planned')&&
     !confirm(`Delete "${v.name||'vessel'}"? It is ${v.status} \u2014 any manual schedule overrides on it go too.`)) return;
  const _nSof=(DB.vessel_sof||[]).filter(s=>s.vessel_call_id===v.id).length;
  if(_nSof&&!confirm(`"${v.name||'vessel'}" has ${_nSof} Statement of Facts on file. Delete it with its time accounting? (The PDF stays in the SOF folder.)`)) return;
  if(_nSof) DB.vessel_sof=DB.vessel_sof.filter(s=>s.vessel_call_id!==v.id);
  DB.vessel_calls.splice(i,1);
  DB.vessel_campaigns=(DB.vessel_campaigns||[]).filter(c=>c.vessel_call_id!==v.id);
  autoSave(); renderVesselTable(); if(typeof vpRender==='function') vpRender();
}

function advanceRailStatus(id){
  const r=DB.rail_movements.find(x=>x.id===id); if(!r) return;
  const next=_tsNext(r.status||'Planned'); if(!next) return;
  r.status=next; autoSave(); renderRailTable();
}

function renderVesselTable(){
  const tbody=document.getElementById('vessel-tbody'); if(!tbody) return;
  if(!DB.vessel_calls.length){
    tbody.innerHTML=`<tr><td colspan="9" style="color:var(--text-dim);text-align:center;padding:14px">No vessel calls scheduled — vessels bring external supply with no source inventory deduction</td></tr>`;
    return;
  }
  // Track which split vessels are expanded
  if(!window._vcExpanded) window._vcExpanded=new Set();

  // The shared filters: a call shows when one of its stops (the call itself, or each leg) is at a
  // terminal in view, carries an allowed product and arrives inside the time frame. Stops with
  // no berth or no date aren't excluded by those tests.
  const _allowP=fltAllowedProdIds();
  const _destIds=new Set(vpShownDests());
  const _berthFac=id=>{ const b=id&&DB.elements.find(e=>e.id===id); return b?(b.assigned_facility_id||b.facility_id):null; };
  const {startDay:_sd,endDay:_ed,empty:_noDays}=vpGetRange();
  const _from=_noDays?'':vpDayDate(_sd), _to=_noDays?'':vpDayDate(_ed);
  const _vcVisible=DB.vessel_calls.map((v,i)=>({v,i})).filter(({v})=>{
    const stops=(v.legs&&v.legs.length)
      ?v.legs.map(l=>({b:l.berth_element_id,d:l.arrival_date,p:l.product_id||v.product_id}))
      :[{b:v.berth_element_id,d:v.arrival_date,p:v.product_id}];
    return stops.some(s=>{ const f=_berthFac(s.b), d=String(s.d||'').slice(0,10);
      return (!f||_destIds.has(f))
        &&(!_allowP||_allowP.has(_pidCanon(s.p)))
        &&(!d||(!_noDays&&d>=_from&&d<=_to)); });
  });
  if(!_vcVisible.length){
    tbody.innerHTML=`<tr><td colspan="9" style="color:var(--text-dim);text-align:center;padding:14px">No vessel calls match the current filters</td></tr>`;
    return;
  }
  tbody.innerHTML=_vcVisible.map(({v,i})=>{
    const prod=DB.products.find(p=>p.id===v.product_id);
    const locked=_tsLocked(v.status||'Planned');
    const nextSt=_tsNext(v.status||'Planned');
    const isSplit=v.legs&&v.legs.length>0;
    const expanded=window._vcExpanded.has(v.id);

    // For display: total qty and first arrival date
    const totalQty=isSplit?v.legs.reduce((s,l)=>s+(l.quantity_t||0),0):(v.quantity_t||0);
    const firstDate=isSplit?v.legs[0]?.arrival_date:v.arrival_date;
    const berthDisplay=isSplit?`${v.legs.length} ports`:(v.berth_name||'—');

    let rows=`<tr style="${isSplit?'background:rgba(var(--amber-rgb),.04)':''}">
      <td style="color:var(--amber);font-weight:700">
        ${isSplit?`<span onclick="_vcToggle('${v.id}')" style="cursor:pointer;margin-right:4px;font-size:9px">${expanded?'▼':'▶'}</span>`:''}
        ${v.name}${isSplit?` <span style="font-size:7px;color:var(--text-dim);margin-left:3px">SPLIT</span>`:''}${(DB.vessel_campaigns||[]).some(c=>c.vessel_call_id===v.id)?` <span title="Manual schedule override active" style="color:var(--blue);margin-left:4px;font-size:9px">⏱</span>`:''}
      </td>
      <td style="font-family:var(--mono)">${firstDate||'—'}</td>
      <td>${prod?.name||v.cargo_type||'—'}</td>
      <td style="font-family:var(--mono)">${Number(totalQty).toLocaleString()}</td>
      <td style="font-family:var(--mono)">${isSplit?'—':((v.unload_rate_tph||0)+' t/h')||'—'}</td>
      <td style="font-family:var(--mono)">${isSplit?'—':_vesselUnloadDays(v)+'d'}</td>
      <td style="color:var(--text-dim)">${berthDisplay}</td>
      <td>${_tsBadge(v.status||'Planned')}</td>
      <td style="white-space:nowrap">
        ${nextSt?`<span class="tbl-act" onclick="advanceVesselStatus('${v.id}')" title="→ ${nextSt}">→ ${nextSt}</span>`:''}
        <span class="tbl-act" onclick="editVessel(${i})">Edit</span>
        ${sofBadgeHTML(v)}
        <span class="tbl-act del" onclick="_delVessel(${i})">Del</span>
      </td>
    </tr>`;

    // Leg sub-rows (only if split and expanded)
    if(isSplit&&expanded){
      v.legs.forEach((leg,li)=>{
        const legBerth=getFacElements().find(e=>e.id===leg.berth_element_id);
        const legRate=leg.unload_rate_tph||0;
        const legBerthRate=parseFloat(legBerth?.props?.max_unload_rate_tph)||0;
        const effRate=legRate>0?Math.min(legRate,legBerthRate||legRate):legBerthRate;
        const legDays=effRate>0?Math.ceil((leg.quantity_t||0)/(effRate*24)):1;
        // Legs can advance independently only once parent is past In Transit
        const parentPastInTransit=TRANSPORT_STATUSES.findIndex(s=>s.id===(v.status||'Planned'))>
                                   TRANSPORT_STATUSES.findIndex(s=>s.id==='In Transit');
        // The leg's next status — the one advanceLegStatus() moves it to. Offered whenever there
        // is one, like the parent row's link: from Confirmed on every status counts as "locked"
        // (simulation ground truth), so a lock test here would have hidden it for good. These
        // two names used to be read without ever being defined, which threw as soon as a split
        // vessel's parent passed In Transit and took the rest of the schedules render with it.
        const legNext=_tsNext(leg.status||v.status||'Planned');
        rows+=`<tr style="background:rgba(var(--amber-rgb),.02)">
          <td style="padding-left:28px;color:var(--text-dim);font-size:9px">↳ Leg ${li+1}</td>
          <td style="font-family:var(--mono);font-size:9px">${leg.arrival_date||'—'}</td>
          <td style="font-size:9px;color:var(--text-dim)">${legBerth?.name||leg.berth_element_id||'—'}</td>
          <td style="font-family:var(--mono);font-size:9px">${Number(leg.quantity_t||0).toLocaleString()}</td>
          <td style="font-family:var(--mono);font-size:9px">${effRate||'—'} t/h</td>
          <td style="font-family:var(--mono);font-size:9px">${legDays}d</td>
          <td></td>
          <td>${_tsBadge(leg.status||v.status||'Planned')}</td>
          <td style="white-space:nowrap">
            ${parentPastInTransit&&legNext?`<span class="tbl-act" onclick="advanceLegStatus('${v.id}',${li})" title="→ ${legNext}">→ ${legNext}</span>`:''}
            ${!parentPastInTransit?`<span style="font-family:var(--mono);font-size:8px;color:var(--text-dim)">advances with parent</span>`:''}
            ${sofBadgeHTML(v,li)}
          </td>
        </tr>`;
      });
    }
    return rows;
  }).join('');
}

function _vesselUnloadDays(v){
  const berthEl=getFacElements().find(e=>e.id===v.berth_element_id);
  const berthRate=parseFloat(berthEl?.props?.max_unload_rate_tph)||0;
  const eff=v.unload_rate_tph>0?Math.min(v.unload_rate_tph,berthRate||v.unload_rate_tph):berthRate;
  return eff>0?Math.ceil((v.quantity_t||0)/(eff*24)):1;
}

function _vcToggle(id){
  if(!window._vcExpanded) window._vcExpanded=new Set();
  window._vcExpanded.has(id)?window._vcExpanded.delete(id):window._vcExpanded.add(id);
  renderVesselTable();
}

function advanceLegStatus(vesselId, legIdx){
  const v=DB.vessel_calls.find(x=>x.id===vesselId); if(!v||!v.legs) return;
  const parentIdx=TRANSPORT_STATUSES.findIndex(s=>s.id===(v.status||'Planned'));
  const inTransitIdx=TRANSPORT_STATUSES.findIndex(s=>s.id==='In Transit');
  if(parentIdx<=inTransitIdx){ statMsg('Advance the parent vessel past In Transit first'); return; }
  const leg=v.legs[legIdx]; if(!leg) return;
  const next=_tsNext(leg.status||v.status||'Planned'); if(!next) return;
  leg.status=next; autoSave(); renderVesselTable();
}

