// ═══════════════════════════════════════════════════════════════════════════
// BUDGET PLANNING MODULE — generic planning objects (kind = budget | forecast | what-if)
// Design record: ~/.claude/plans/pasted-content-id-7e26-budget-hidden-wren.md (D1–D35, P0–P6)
// Everything here is in SHORT TONS. The budget comes in as demand point × month tables and the External (FL) workbook;
// the customer-based build (RMX keys, sales history, rules) was retired on 2026-10-29.
// ═══════════════════════════════════════════════════════════════════════════
function SIMCFG_DEFAULTS(){ return {start_date:new Date()._ymd(), horizon:90, mode:'planning', conflict_resolution:'rolling_avg', autoPropose:true}; }
const PL={ ui:{open:{}, tab:null}, hist:null, bgt:null, stage:{}, tr:{}, busy:false };
const PL_DEFAULT_SETTINGS=()=>({ id:'default', kind:'budget', budget_year:new Date().getFullYear()+1, sat_pct:25, ships_sat:true,
  mix_months:12, mix_min_share_pct:5, mix_min_month_t:50, mix_recent_months:3, mix_recent_weight:2, plant_map:'4009=1136, 4089=4090', updated_at:null, updated_by:null });
function plSettings(){
  if(!Array.isArray(DB.plan_settings)) DB.plan_settings=[];
  let s=DB.plan_settings.find(r=>r.id==='default');
  if(!s){ s=PL_DEFAULT_SETTINGS(); DB.plan_settings.push(s); }
  else { const d=PL_DEFAULT_SETTINGS(); Object.keys(d).forEach(k=>{ if(s[k]===undefined) s[k]=d[k]; }); }
  return s;
}
function _plWho(){ try{ return (typeof acCurrentUser==='function'&&acCurrentUser()?.name)||localStorage.getItem('avila_device_name')||'this browser'; }catch(e){ return 'this browser'; } }
function _plFmt(n,d=0){ if(n==null||isNaN(n)) return '—'; return Number(n).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}); }
function _plEsc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _plToggle(k){ PL.ui.open[k]=PL.ui.open[k]===false; planRender(); }
function _plCard(key,title,sub,count,body){
  const open=PL.ui.open[key]!==false;
  return `<div style="border:1px solid var(--border);margin-bottom:10px;background:var(--surface)">
    <div onclick="_plToggle('${key}')" style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;border-bottom:${open?'1px solid var(--border)':'none'}">
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-dim)">${open?'▾':'▸'}</span>
      <span style="font-weight:600;font-size:12px">${title}</span>
      ${count!=null?`<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">${count}</span>`:''}
      <span style="margin-left:auto;font-size:10px;color:var(--text-dim)">${sub||''}</span>
    </div>
    ${open?`<div style="padding:10px 12px">${body}</div>`:''}
  </div>`;
}
function planRender(){ const el=document.getElementById('cfg-panel-plan'); if(el) el.innerHTML=planPanelHTML(); }
function planPanelHTML(){
  const planning=scIsPlanning(); const m=(typeof scActive==='function'&&scActive())||null; const s=plSettings();
  const head=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
    <div style="font-weight:700;font-size:13px">Budget Planning</div>
    <span class="pl-flag ${planning?'':'dim'}">${planning?'PLANNING SCENARIO':'EXECUTION SCENARIO'}</span>
    <span class="pl-muted">${m?_plEsc(m.name):'no scenario file'} · budget year ${s.budget_year} · short tons</span>
  </div>`;
  if(!planning) return head+_plExecPanelHTML(s);
  return head+_plPlanningPanelHTML(s);
}
// ── Execution scenario view: create / link the Planning scenario, compare, budget → Execution.
function _plExecPanelHTML(s){
  return _plCard('pl-create','Planning scenario','duplicate of this scenario, budget year '+s.budget_year, null,
    `<div class="pl-muted" style="margin-bottom:8px">A Planning scenario is a separate file duplicated from this one. It simulates the budget year from this scenario's projected 31 December state (silos, vessels at berth or waiting, rail in the yards and in transit), with the file watcher, merge, Sales catalog and Real Sales imports switched off. One editor at a time; every computer must run this app version or the budget tables are dropped on save.</div>
     <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
       <label class="pl-muted">Budget year <input class="fi" type="number" id="pl-year" value="${s.budget_year}" min="2026" max="2035" style="width:80px;display:inline-block;margin-left:4px" onchange="plSettings().budget_year=parseInt(this.value)||${s.budget_year};autoSave();planRender()"></label>
       <button class="pl-btn pri" onclick="planCreateScenario()">Create Planning scenario…</button>
       <span class="pl-muted">${_plOpenCheck(S.simResults, s.budget_year+'-01-01').msg}</span>
     </div>`)+_plCompareCardHTML(s)+_plImportCardHTML(s);
}
function _plFacByName(name){ const k=String(name||'').toUpperCase(); return (DB.facilities||[]).find(f=>String(f.name||'').split('/')[0].trim().toUpperCase()===k)||null; }
function _plProductByToken(tok){
  const want=_xlNorm(tok); const ps=DB.products||[];
  return ps.find(p=>_xlNorm(p.name)===want)||ps.find(p=>_xlNorm(p.name)===want+'/blk')||ps.find(p=>_xlNorm(p.name).startsWith(want+'/'))||ps.find(p=>_xlNorm(p.name).startsWith(want))||null;
}
function _plOpenCheck(r, startDate){
  if(!r||!r.inventoryHistory) return {ok:false, d:null, morning:false, msg:'No simulation results yet — run the simulation first (horizon must reach '+startDate+').'};
  const d=dateToDayOffset(startDate, S.simCfg.start_date)+1; const H=r.simHorizon||S.simCfg.horizon||0;
  if(d<2) return {ok:false, d, morning:false, msg:`This scenario starts on ${S.simCfg.start_date}, after ${startDate}: the opening state cannot be copied from it.`};
  if(H<d-1) return {ok:false, d, morning:false, msg:`The simulation ends on day ${H}, before ${startDate} (day ${d}) — set the horizon to reach 1 Jan and re-run.`};
  return {ok:true, d, morning:H>=d, msg:H>=d?`Simulation reaches ${startDate} (day ${d} of ${H}) ✓`:`Simulation reaches 31 Dec but not ${startDate}: rail yards will be copied from the 31 Dec morning (run one day longer for the exact picture).`};
}
function plCreateAshFacility(name){
  if(_plFacByName(name)){ statMsg(name+' already exists'); planRender(); return; }
  if(!XLMAP) xlmapLoad();
  const codes=(XLMAP.ship_points||[]).filter(r=>String(r.source||'').toUpperCase()===name).map(r=>({code:r.code,label:name}));
  const sub=(DB.facilities||[]).find(f=>f.type==='purchased')?.sub_region_id||(DB.facilities||[])[0]?.sub_region_id||null;
  const fac={id:`fac_${Date.now()}`, name:`${name}/ASH`, plant_no:'', plant_nos:[], type:'purchased', sub_region_id:sub, status:'active', notes:'Fly ash shipped straight from the power plant — purchased supply (budget planning prerequisite)'};
  setFacPlantCodes(fac, codes); DB.facilities.push(fac);
  autoSave(); if(typeof renderLocationTree==='function') renderLocationTree(); if(typeof _xlRulesChanged==='function') _xlRulesChanged();
  statMsg(`Facility ${fac.name} created as purchased${codes.length?' (ship points '+codes.map(c=>c.code).join(', ')+')':''}`); planRender();
}
// A demand point at a facility, the way Demand Mapping's bench creates one (no picker, no view switch).
function plCreateDp(facId, name, pid){
  const fac=(DB.facilities||[]).find(f=>f.id===facId); if(!fac){ statMsg('Facility not found'); return null; }
  if(xlmapFindDp(name)){ statMsg(name+' already exists'); planRender(); return xlmapFindDp(name); }
  const spot=_xlSpotFor(fac); const id=`el_${++S.elCounter}`;
  const el={id, facility_id:mainCanvasFacilityId()||S.facility_id, assigned_facility_id:fac.id, type:'demand_point', x:spot.x, y:spot.y, name,
    props:{}, state:'idle', maintenanceEvents:[], productCapacities:[], is_active:true};
  DB.elements.push(el);
  (DB.demand_points=DB.demand_points||[]).push({id:`dp_el_${id}`, facility_id:fac.id, element_id:id, element_name:name,
    products:pid?[{product_id:pid,priority:1}]:[], mode:'Fixed Daily', daily_tonnage:0, objective:'Meet Demand Only', rolling_days:30});
  if(S.topoFacFilter&&S.topoFacFilter.size&&!S.topoFacFilter.has(fac.id)) S.topoFacFilter.add(fac.id);
  autoSave(); if(typeof _demandCacheInvalidate==='function') _demandCacheInvalidate(); if(typeof _xlRulesChanged==='function') _xlRulesChanged();
  statMsg(`${name} created at ${fac.name}, ${spot.where}`); planRender(); return el;
}
// Purchased-ness of a demand point: its facility (purchased type) OR its product (third-party cement at our terminal).
function plIsPurchasedDp(el){
  if(!el) return false; const facId=el.assigned_facility_id||el.facility_id; if(isPurchasedFac(facId)) return true;
  const dp=(DB.demand_points||[]).find(d=>d.element_id===el.id); const pid=dp&&dp.products&&dp.products[0]&&dp.products[0].product_id;
  const p=pid&&(DB.products||[]).find(x=>x.id===pid); return !!(p&&p.supply==='purchased');
}
// Planning scenario view: the trend link, load, versions (master files), generation, settings.
function _plPlanningPanelHTML(s){
  if(PL.ui.open['pl-settings']===undefined) PL.ui.open['pl-settings']=false;
  return _plSourceCardHTML(s)+_plLoadCardHTML(s)+_plVersionsCardHTML(s)+_plGenerateCardHTML(s)+_plCard('pl-settings','Settings','budget year, how each month is spread over its days, how the internal budget is split', null,
    `<div class="pl-kv">
      <b>Budget year</b><input class="fi" type="number" id="pls-year" value="${s.budget_year}" style="width:90px">
      <b>Saturday %</b><span><input class="fi" type="number" id="pls-sat" value="${s.sat_pct}" min="0" max="100" style="width:70px;display:inline-block"> <label><input type="checkbox" id="pls-ships-sat" ${s.ships_sat?'checked':''}> ships on Saturdays</label></span>
      <b>Internal split: months of history</b><input class="fi" type="number" id="pls-mixm" value="${s.mix_months}" min="3" max="24" style="width:70px">
      <b>A point counts in a month from (%)</b><input class="fi" type="number" id="pls-mixs" value="${s.mix_min_share_pct}" min="0" max="50" style="width:70px">
      <b>Months under (ST) are ignored</b><input class="fi" type="number" id="pls-mixt" value="${s.mix_min_month_t}" min="0" style="width:70px">
      <b>Recent months · their weight</b><span><input class="fi" type="number" id="pls-mixr" value="${s.mix_recent_months}" min="0" max="12" style="width:60px;display:inline-block"> × <input class="fi" type="number" id="pls-mixw" value="${s.mix_recent_weight}" min="1" max="5" style="width:60px;display:inline-block"></span>
      <b>Budget plant # → sold-to #</b><span><input class="fi" type="text" id="pls-pmap" value="${_plEsc(s.plant_map||'')}" style="width:260px"> <span class="pl-muted">only where they differ (Leesburg 4009 ships as 1136, Naples North Block 1 4089 as 4090)</span></span>
     </div>
     <div style="margin-top:8px;display:flex;gap:8px;align-items:center"><button class="pl-btn pri" onclick="plSaveSettings()">Save settings</button>
       <span class="pl-muted">${s.updated_at?('saved '+s.updated_at.slice(0,16).replace('T',' ')+' by '+_plEsc(s.updated_by)):'defaults'}</span></div>`);
}
function plSaveSettings(){
  const s=plSettings(); const g=id=>document.getElementById(id);
  s.budget_year=parseInt(g('pls-year')?.value)||s.budget_year;
  s.sat_pct=Math.max(0,Math.min(100,parseFloat(g('pls-sat')?.value)||0));
  s.ships_sat=!!g('pls-ships-sat')?.checked;
  const n=(id,d,lo,hi)=>{ const v=parseFloat(g(id)?.value); return isFinite(v)?Math.max(lo,Math.min(hi,v)):d; };
  s.mix_months=Math.round(n('pls-mixm',12,3,24)); s.mix_min_share_pct=n('pls-mixs',5,0,50); s.mix_min_month_t=n('pls-mixt',50,0,1e6); s.mix_recent_months=Math.round(n('pls-mixr',3,0,12)); s.mix_recent_weight=n('pls-mixw',2,1,5);
  s.plant_map=g('pls-pmap')?.value??s.plant_map;
  s.updated_at=new Date().toISOString(); s.updated_by=_plWho();
  autoSave(); planRender(); statMsg('Budget settings saved');
}
// ── P1b: read another scenario file without loading it ──────────────────────
// queryPermission only (never prompts unless asked from a click); never touches baselines,
// the active scenario, or the UI. Cached per id on the file's lastModified.
SC._peek=SC._peek||{};
async function scPeekScenario(id, opts){
  opts=opts||{}; if(!id) return null;
  let handle=SC.handles[id]; if(!handle){ try{ handle=await scLoadHandle(id); if(handle) SC.handles[id]=handle; }catch(e){} }
  if(!handle) return null;
  try{
    let perm=await handle.queryPermission({mode:'read'});
    if(perm!=='granted'&&opts.prompt) perm=await handle.requestPermission({mode:'read'});
    if(perm!=='granted') return null;
    const f=await handle.getFile();
    const c=SC._peek[id]; if(c&&c.fileMod===f.lastModified&&c.size===f.size) return c;
    const text=await f.text(); if(typeof _scIsSalesPayload==='function'&&_scIsSalesPayload(text)) return null;
    const payload=JSON.parse(text); if(!payload||!payload.DB) return null;
    const res={id, name:(SC.meta[id]&&SC.meta[id].name)||handle.name, fileMod:f.lastModified, size:f.size, payload, at:Date.now()};
    SC._peek[id]=res; return res;
  }catch(e){ console.warn('scPeekScenario', e); return null; }
}
// Topology tables of a payload into the live DB (shared by History → "Topology only" and the Planning refresh).
function _scApplyTopologyTables(payload){
  const t=_tsTables(payload); if(!t.elements || !t.elements.length) throw new Error('that version has no topology');
  Object.assign(DB, t);
  if(payload.counter) S.elCounter=Math.max(S.elCounter||0, payload.counter);
  if(typeof syncElCounter==='function') syncElCounter();
  if(typeof _demandCacheInvalidate==='function') _demandCacheInvalidate();
  return t;
}
function _plSourceCardHTML(s){
  plSrcEnsure();
  const srcId=S.simCfg.plan_source_scenario_id, srcName=S.simCfg.plan_source_name||(srcId&&SC.meta[srcId]&&SC.meta[srcId].name)||'(not linked)';
  const missing=!srcId||!SC.meta[srcId];   // the link is by scenario id: nothing to read until this browser's list has it
  const rep=s.open_report||null;
  const stale=PL._srcStale===true?'<span class="pl-flag bad">the trend scenario changed since this update</span>':PL._srcStale===false?'<span class="pl-flag ok">up to date with the trend</span>':'';
  return _plCard('pl-source','From the trend scenario','topology, settings and the 31 Dec closing state come from '+_plEsc(srcName), null,
    `<div class="pl-kv">
      <b>Linked to</b><span>${_plEsc(srcName)} ${srcId&&!SC.meta[srcId]?'<span class="pl-flag bad">not in this browser\'s scenario list</span>':''}</span>
      <b>Simulation</b><span>${S.simCfg.start_date} to ${_addDays(S.simCfg.start_date,S.simCfg.horizon-1)} · ${S.simCfg.horizon} days (${S.simCfg.horizonPreset||'custom'})</span>
      <b>Closing state</b><span>${rep?_plEsc(rep.summary)+' <span class="pl-muted">('+String(rep.at||'').slice(0,16).replace('T',' ')+')</span>':'<span class="pl-muted">not copied yet</span>'}</span>
      ${rep&&rep.topology?`<b>Topology</b><span>${_plEsc(rep.topology)}</span>`:''}
      <b>Yields</b><span>${_plYieldsSummary()}</span>
     </div>
     ${rep&&rep.warnings&&rep.warnings.length?`<div class="pl-muted" style="margin-top:6px">⚠ ${rep.warnings.map(_plEsc).join('<br>⚠ ')}</div>`:''}
     <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
       <button class="pl-btn pri" onclick="planUpdateFromTrend()" ${missing?'disabled':''}>Update from ${_plEsc(srcName)}…</button>${stale}
       <details style="display:inline-block"><summary class="pl-muted" style="cursor:pointer">only one of the two…</summary>
         <button class="pl-btn" onclick="planRefreshTopology()" ${missing?'disabled':''}>Topology only…</button>
         <button class="pl-btn" onclick="planRefreshOpeningState()" ${missing?'disabled':''}>Closing state only…</button></details>
     </div>
     ${missing?_plSourceRelinkHTML(srcId, srcName):''}`);
}
// The stored link is a scenario id from the browser that created the budget. In another browser,
// or after the trend file was removed and re-added to the list (new id), nothing resolves and the
// update buttons could do nothing. Offer to point the link at a scenario in this list, or at the file.
function _plSourceRelinkHTML(srcId, srcName){
  const list=Object.values(SC.meta||{}).filter(m=>m&&m.id!==SC.activeId).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const want=String(srcName||'').trim().toLowerCase();
  const match=want?list.find(m=>String(m.name||'').trim().toLowerCase()===want)||null:null;
  const opts=list.map(m=>`<option value="${_plEsc(m.id)}" ${match&&match.id===m.id?'selected':''}>${_plEsc(m.name)}${m.fileName?' · '+_plEsc(m.fileName):''}</option>`).join('');
  return `<div class="pl-muted" style="margin-top:8px">${srcId?'The link is stored by scenario id and this browser has no scenario with that id: the trend was added here under a new id, or never added.':'No trend scenario is linked to this budget.'}${match?' A scenario named <b>'+_plEsc(match.name)+'</b> is in this browser\'s list.':''}</div>
    <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${list.length?`<select class="fi" id="pl-relink" style="width:280px;display:inline-block"><option value="">— scenario in this browser —</option>${opts}</select><button class="pl-btn pri" onclick="planRelinkSource()">Re-link</button>`:'<span class="pl-muted">no other scenario in this browser\'s list</span>'}
      <button class="pl-btn" onclick="planRelinkPickFile()">Pick the trend file…</button>
    </div>`;
}
async function planRelinkSource(id){
  if(!scIsPlanning()){ statMsg('Only in a Planning scenario'); return; }
  id=id||(document.getElementById('pl-relink')||{}).value||''; const m=id&&SC.meta[id]; if(!m){ statMsg('Pick a scenario first'); return; }
  if(id===SC.activeId){ alert('A budget scenario cannot be linked to itself — pick the trend scenario.'); return; }
  const old=S.simCfg.plan_source_scenario_id; if(old&&SC._peek) delete SC._peek[old];
  S.simCfg.plan_source_scenario_id=id; S.simCfg.plan_source_name=m.name;
  PL._srcStale=null; PL._srcAt=0; PL._srcBusy=false;
  autoSave(); await scManualSave(); planRender();
  statMsg(`Linked to ${m.name} ✓ — now press "Update from ${m.name}…"`);
}
// Register the trend's file in this browser's scenario list WITHOUT opening it (the budget stays active), then link.
async function planRelinkPickFile(){
  if(!scIsPlanning()){ statMsg('Only in a Planning scenario'); return; }
  if(!window.showOpenFilePicker){ alert('This browser cannot open files directly — use Chrome or Edge.'); return; }
  let handle;
  try{ [handle]=await window.showOpenFilePicker({types:[{description:'AVILA scenario',accept:{'application/json':['.json']}}]}); }
  catch(e){ if((e&&e.name)!=='AbortError'){ console.warn('relink picker', e); statMsg('⚠ Could not open the file dialog — '+(e&&e.message||'unknown error')); } return; }
  if(await _scLooksLikeSalesFile(handle)){ alert(handle.name+' is an Avila Sales file, not a scenario.'); return; }
  const owner=await scFindOwner(handle, null); let id=owner?owner.id:null;
  if(id){ if(!SC.handles[id]){ SC.handles[id]=handle; await scSaveHandle(id,handle); } SC.meta[id].fileName=handle.name; }
  else { id='sc_'+Date.now().toString(36); SC.meta[id]={ id, name:scNameFromHandle(handle), color:scPickColor(), fileName:handle.name, lastSaved:null, lastOpened:null }; SC.handles[id]=handle; await scSaveHandle(id,handle); }
  if(id===SC.activeId){ alert('That is this budget scenario\'s own file — pick the trend scenario\'s file.'); return; }
  scSaveMeta(); if(typeof scRenderDropdown==='function') scRenderDropdown();
  await planRelinkSource(id);
}
// Every read of the trend used to fail with a 2.5-second status-bar line that was easy to miss.
function _plSrcFail(srcId){
  const name=S.simCfg.plan_source_name||'the trend scenario';
  const msg=srcId&&SC.meta[srcId]
    ?`Could not read the trend scenario file for ${name}.\n\nChrome has lost, or has not yet granted, access to that file. Open ${name} once from the scenario menu (📂), come back to this budget scenario and try again — or use "Pick the trend file…" on the "From the trend scenario" card.`
    :`${name} is not in this browser's scenario list (the link is stored by scenario id).\n\nUse "Re-link" or "Pick the trend file…" on the "From the trend scenario" card to point this budget at the trend scenario, then update.`;
  statMsg('Could not read the trend scenario file'); alert(msg);
}
async function planRefreshTopology(){
  if(!scIsPlanning()){ statMsg('Only in a Planning scenario'); return; }
  const srcId=S.simCfg.plan_source_scenario_id; const pk=await scPeekScenario(srcId,{prompt:true});
  if(!pk){ _plSrcFail(srcId); return; }
  const diff=_tsTopoDiff({DB}, pk.payload); const byT={}; diff.forEach(c=>{ byT[c.t]=(byT[c.t]||0)+1; });
  const lines=Object.keys(byT).map(t=>`${byT[t]} ${t}`).join(', ')||'no differences';
  if(!diff.length){ statMsg('Topology already matches '+pk.name); return; }
  if(!confirm(`Replace this Planning scenario's topology with ${pk.name}'s?\n\nChanges: ${lines}.\n\nDemand, budget versions, keys and rules stay; keys pointing at renamed or deleted demand points are re-resolved by name and reported.`)) return;
  try{ if(SC.activeId) await scWriteSnapshot(SC.activeId, JSON.stringify(scBuildPayload()), 'pre-topology-refresh'); }catch(e){ console.warn('snapshot', e); }
  try{
    _scApplyTopologyTables(pk.payload);
    const orphans=planRevalidateRefs();
    await scManualSave(); if(typeof _acRerender==='function') _acRerender(); if(typeof renderLocationTree==='function') renderLocationTree(); if(typeof updateNavFacilities==='function') updateNavFacilities();
    planRender(); statMsg(`Topology refreshed from ${pk.name} ✓ — ${lines}${orphans.length?'; '+orphans.length+' stored references could not be re-resolved (see the Keys card)':''}`);
  }catch(e){ statMsg('Topology refresh failed — '+e.message); console.warn(e); }
}
// After a topology refresh: every stored element_id is re-resolved by demand-point name.
function planRevalidateRefs(){
  const orphans=[]; const fix=(o, idKey, nameKey)=>{ if(!o||!o[nameKey]) return; const el=xlmapFindDp(o[nameKey]); if(el){ o[idKey]=el.id; } else if(o[idKey]&&!(DB.elements||[]).some(e=>e.id===o[idKey])){ orphans.push(o[nameKey]); o[idKey]=null; } };
  (DB.plan_demand||[]).forEach(p=>fix(p,'element_id','dp_name'));
  return orphans;
}
// ── Opening state: Execution's simulated 31 Dec → this file's 1 Jan (D28) ────
function _plDayBefore(ds){ const d=new Date(ds+'T12:00:00'); d.setDate(d.getDate()-1); return d._ymd(); }
function planCopyOpeningState(src, startDate, srcLabel){
  const r=src.simResults, w=[], rep={silos:0, vessels:0, railRows:0, railMoves:0, yards:0, maint:0, warnings:w};
  const chk=_plOpenCheck(r, startDate); if(!chk.d||chk.d<2||!r||!r.inventoryHistory){ w.push(chk.msg); rep.summary='nothing copied — '+chk.msg; return rep; }
  const d=chk.d, iEnd=d-2, iMorn=chk.morning?d-1:d-2, now=new Date().toISOString();
  const note=`Opening state copied from ${srcLabel||'the source scenario'} (${r.runId||'run'}) on ${now.slice(0,10)}`;
  if(!chk.morning) w.push('Source run ended on 31 Dec: rail yards taken from the 31 Dec morning snapshot (run the source one day longer for the exact 1 Jan picture).');
  const canvasEls=getFacElements(); const elById=Object.fromEntries((DB.elements||[]).map(e=>[e.id,e]));
  // 1 · silos — end of 31 Dec. Product mix is not recorded; the engine splits evenly.
  const multi=[];
  canvasEls.filter(e=>e.type==='bulk_silo'||e.type==='packed_silo').forEach(el=>{
    const h=r.inventoryHistory[el.id]; if(!h||h.length<=iEnd) return;
    const t=Math.max(0, +h[iEnd]||0); el.props=el.props||{};
    el.props.start_inventory=el.type==='packed_silo'?Math.round(t/_siloTPP(el)*10)/10:Math.round(t);
    rep.silos++; if(Array.isArray(el.props.products)&&el.props.products.length>1&&t>0) multi.push(el.name);
  });
  if(multi.length) w.push(`${multi.length} multi-product silo(s) start with an even product split (the mix is not in the results): ${multi.slice(0,6).join(', ')}${multi.length>6?'…':''}`);
  // 2 · vessels docked or waiting at the end of 31 Dec → calls arriving on day 1 with the tonnes left
  const legProduct=(call, berthId)=>{ if(!call) return ''; const leg=(call.legs||[]).find(l=>l.berth_element_id===berthId); return (leg&&leg.product_id)||call.product_id||''; };
  let vn=0;
  canvasEls.filter(e=>e.type==='berth').forEach(b=>{
    const h=r.berthVesselHistory&&r.berthVesselHistory[b.id]; if(!h||h.length<=iEnd) return;
    const bv=h[iEnd]; if(!bv) return;
    const mk=(callId, name, left)=>{
      if(!(left>0)) return; const orig=(DB.vessel_calls||[]).find(v=>v.id===callId)||null; const pid=legProduct(orig,b.id);
      if(!pid){ w.push(`${name}: product unknown, not carried over (${Math.round(left)} t at ${b.name})`); return; }
      DB.vessel_calls.push({id:`vc_open_${Date.now().toString(36)}_${++vn}`, name:`${name||'vessel'} (carried over)`, berth_element_id:b.id, facility_id:b.assigned_facility_id||b.facility_id,
        arrival_date:startDate, quantity_t:Math.round(left), total_quantity_t:Math.round(left), unload_rate_tph:(orig&&orig.unload_rate_tph)||0, product_id:pid, transit_days:0, status:'Confirmed', notes:note});
      rep.vessels++;
    };
    if(bv.docked) mk(bv.dockedCallId, bv.docked, bv.dockedLeft);
    (bv.waitingList||[]).forEach(p=>mk(p.vesselCallId, p.name, p.left));
  });
  // 3 · rail at terminals: rail yard / local yard counts dated day 1; cargo in transit → one In-Transit movement arriving day 1
  const up=(type, facId, pid, cars)=>{ if(!(cars>0)) return; DB.real_rail_daily=(DB.real_rail_daily||[]).filter(rr=>!(rr.type===type&&rr.date===startDate&&rr.facility_id===facId&&(rr.product_id||'')===pid));
    DB.real_rail_daily.push({date:startDate, facility_id:facId, product_id:pid, type, cars, source:'actual', origin:'plan_open', created_at:now, updated_at:now}); rep.railRows++; };
  canvasEls.filter(e=>e.type==='berth'&&(e.props?.berth_type||'')==='Rail Receiving').forEach(b=>{
    const facId=b.assigned_facility_id||b.facility_id, cap=parseFloat(b.props.car_capacity_t)||RAIL_CAR_T_DEFAULT;
    const ry=(r.railAtRailyardHistory||{})[b.id]?.[iMorn]||{}, ly=(r.railYardHistory||{})[b.id]?.[iMorn]||{}, tr=(r.railTransitHistory||{})[b.id]?.[iMorn]||{};
    Object.keys(ry).forEach(pid=>up('railyard_count',facId,pid,Math.round((+ry[pid]||0)/cap)));
    Object.keys(ly).forEach(pid=>up('localyard_count',facId,pid,Math.round((+ly[pid]||0)/cap)));
    Object.keys(tr).forEach(pid=>{
      let t=+tr[pid]||0; if(!(t>0)) return;
      // already represented by a copied movement that departed before 1 Jan and arrives on or after it
      (DB.rail_movements||[]).forEach(m=>{ if(m.to_berth_id!==b.id&&m.to_facility_id!==facId) return; if((m.product_id||'')!==pid) return; if(!['Planned','Confirmed','In Transit'].includes(m.status||'')) return;
        if(!m.departure_date||m.departure_date>=startDate) return; const arr=dateToDayOffset(m.departure_date, src.simCfg.start_date)+1+(parseInt(m.transit_days)||0); if(arr>=d) t-=(+m.total_capacity_t||0); });
      if(t>0.5){ DB.rail_movements.push({id:`rm_open_${Date.now().toString(36)}_${b.id}_${pid}`, from_facility_id:mainCanvasFacilityId(), to_facility_id:facId, to_berth_id:b.id, product_id:pid,
        departure_date:_plDayBefore(startDate), transit_days:1, total_capacity_t:Math.round(t), wagon_count:Math.max(1,Math.round(t/cap)), wagon_capacity_t:cap, status:'In Transit', reference:'Opening state', notes:note}); rep.railMoves++; }
    });
  });
  if(rep.railMoves) w.push(`${rep.railMoves} in-transit rail lot(s) were given a 1-day remaining transit (the results do not keep the days left).`);
  // 4 · origin yards: cars available per product at the dispatch point
  canvasEls.filter(e=>e.type==='dispatch_point').forEach(dp=>{
    const h=(r.railHistory||{})[dp.id]; const rec=h&&h[iMorn]; const cars=rec&&rec.carsAvailByProduct; if(!cars) return;
    const facId=(typeof _railDpFacId==='function'?_railDpFacId(dp):null)||dp.assigned_facility_id||dp.facility_id;
    Object.keys(cars).forEach(pid=>{ const c=Math.round(+cars[pid]||0); if(!(c>0)) return;
      DB.real_rail_daily=(DB.real_rail_daily||[]).filter(rr=>!(rr.type==='yard_count'&&rr.date===startDate&&rr.facility_id===facId&&(rr.product_id||'')===pid));
      DB.real_rail_daily.push({date:startDate, facility_id:facId, dispatch_id:dp.id, product_id:pid, type:'yard_count', cars:c, source:'actual', origin:'plan_open', created_at:now, updated_at:now}); rep.yards++; });
  });
  // 5 · one-off maintenance that straddles 1 Jan: clip to day 1 (the engine drops events that began earlier)
  (DB.element_maintenance_events||[]).forEach(ev=>{
    if(ev.type==='recurring'||!ev.start_date||ev.start_date>=startDate) return;
    const dur=Math.max(1,Math.ceil(parseFloat(ev.duration_days)||1)); const s0=new Date(ev.start_date+'T12:00:00'), s1=new Date(startDate+'T12:00:00');
    const elapsed=Math.round((s1-s0)/864e5); if(elapsed>=dur) return;
    ev.start_date=startDate; ev.duration_days=dur-elapsed; if(ev.end_date&&ev.end_date<startDate) delete ev.end_date; ev.notes=((ev.notes||'')+' · clipped to the Planning start').trim(); rep.maint++;
  });
  rep.summary=`${rep.silos} silos, ${rep.vessels} vessels, ${rep.railRows} rail yard rows, ${rep.railMoves} rail lots in transit, ${rep.yards} origin-yard rows, ${rep.maint} maintenance events clipped`;
  rep.at=now; return rep;
}
// Remove what a previous copy wrote, so a refresh never doubles up.
function _plUndoOpeningState(){
  const isOpen=o=>String(o&&(o.notes||o.reference||'')).startsWith('Opening state');
  DB.vessel_calls=(DB.vessel_calls||[]).filter(v=>!isOpen(v));
  DB.rail_movements=(DB.rail_movements||[]).filter(m=>!(String(m.notes||'').startsWith('Opening state')||m.reference==='Opening state'));
  DB.real_rail_daily=(DB.real_rail_daily||[]).filter(rr=>rr.origin!=='plan_open');
}
// Create FLORIDA ROLL - BGT <year>: duplicate this scenario, flag it, point its simulation at the budget year, copy the opening state.
async function planCreateScenario(){
  if(scIsPlanning()){ statMsg('This already is a Planning scenario'); return; }
  if(!window.showSaveFilePicker){ statMsg('This browser cannot create scenario files (Chrome/Edge required)'); return; }
  const s=plSettings(); const year=parseInt(document.getElementById('pl-year')?.value)||s.budget_year; const startDate=`${year}-01-01`;
  const srcId=SC.activeId, srcName=(scActive()&&scActive().name)||'Execution';
  const chk=_plOpenCheck(S.simResults, startDate);
  if(!chk.ok && !confirm(chk.msg+'\n\nCreate the Planning scenario anyway? The opening state will be incomplete until you refresh it from a longer source run.')) return;
  const src={DB, simCfg:{...S.simCfg}, simResults:S.simResults};   // references: nothing is mutated before the file exists
  const before=SC.activeId;
  await scCreateFromCurrent(`FLORIDA ROLL - BGT ${year}`);          // the save picker runs inside this click
  if(SC.activeId===before||!SC.activeId){ statMsg('Planning scenario not created'); return; }
  // The new file holds a copy of the current state; now turn it into the Planning scenario.
  S.simCfg.role='planning'; S.simCfg.plan_source_scenario_id=srcId; S.simCfg.plan_source_name=srcName;
  S.simCfg.start_date=startDate; S.simCfg.horizonPreset='year'; S.simCfg.horizon=(_simHorizonPresets(startDate).find(p=>p.id==='year')||{days:365}).days;
  window._scTopoSeal=null; window._scLog=_clEmpty();
  s.budget_year=year;
  // Shed real data that predates the budget year by more than 90 days (the Planning run never reads it).
  const cut=new Date(startDate+'T12:00:00'); cut.setDate(cut.getDate()-90); const cutS=cut._ymd(); let shed=0;
  LS_TRIM_90D.forEach(t=>{ const a=DB[t]; if(!Array.isArray(a)) return; const keep=a.filter(x=>!x.date||x.date>=cutS); shed+=a.length-keep.length; DB[t]=keep; });
  const rep=planCopyOpeningState(src, startDate, srcName); s.open_report=rep;
  S.simResults=null;
  autoSave(); await scManualSave(); scUpdatePill(); if(typeof updateStatusBar==='function') updateStatusBar();
  renderCfgPanel('plan'); _demandChanged();
  statMsg(`Planning scenario created — ${rep.summary}${shed?'; '+shed+' old real-data rows left behind':''}`);
  if(rep.warnings.length) setTimeout(()=>alert('Planning scenario created.\n\nOpening state: '+rep.summary+'\n\n⚠ '+rep.warnings.join('\n⚠ ')), 50);
}
async function planRefreshOpeningState(){
  if(!scIsPlanning()){ statMsg('Only in a Planning scenario'); return; }
  const srcId=S.simCfg.plan_source_scenario_id; const pk=await scPeekScenario(srcId,{prompt:true});
  if(!pk){ _plSrcFail(srcId); return; }
  const r=pk.payload.simResults, startDate=S.simCfg.start_date, srcCfg=pk.payload.simCfg||{};
  if(!r){ statMsg(pk.name+' has no saved simulation results — run and save it first'); return; }
  const save=S.simCfg.start_date; S.simCfg.start_date=srcCfg.start_date||save;   // _plOpenCheck reads S.simCfg.start_date as the SOURCE start
  const chk=_plOpenCheck(r, startDate); S.simCfg.start_date=save;
  if(!chk.ok && !confirm(chk.msg+'\n\nRefresh anyway?')) return;
  if(!confirm(`Replace the opening state (silo start levels, carried-over vessels, rail yard rows) with ${pk.name}'s latest simulation?`)) return;
  _plUndoOpeningState();
  const src={DB:pk.payload.DB, simCfg:srcCfg, simResults:r};
  const keep=S.simCfg.start_date; S.simCfg.start_date=srcCfg.start_date||keep; let rep; try{ rep=planCopyOpeningState(src, startDate, pk.name); } finally { S.simCfg.start_date=keep; }
  rep.src_mod=pk.fileMod; plSettings().open_report=rep; S.simResults=null; PL._srcStale=false; PL._srcAt=0; autoSave(); await scManualSave(); planRender(); _demandChanged();
  statMsg('Opening state refreshed — '+rep.summary);
}

// ═══ P2 · Import + versions ═══════════════════════════════════════════════════
const PL_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function _plNum(v){ if(v==null||v==='') return 0; if(typeof v==='number') return isFinite(v)?v:0; const n=Number(String(v).replace(/[,\s]/g,'')); return isFinite(n)?n:0; }
function _plStr(v){ return String(v??'').trim(); }
function _plCode(v){ const s=_plStr(v); return /^\d+(\.0+)?$/.test(s)?String(parseInt(s,10)):s; }   // 4802.0 → "4802", keeps "Adj"
function _plAoa(buf, sheetName){
  const wb=XLSX.read(buf,{type:'array',dense:true});
  const names=wb.SheetNames; let sh=null;
  if(typeof sheetName==='function') sh=names.find(sheetName); else if(sheetName) sh=names.find(x=>x.trim().toLowerCase()===String(sheetName).toLowerCase());
  if(sheetName&&!sh) return {wb, names, sheet:null, aoa:null};
  const ws=wb.Sheets[sh||names[0]];
  return {wb, names, sheet:sh||names[0], aoa:XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''})};
}
function _plHdrIndex(row){ return row.map(c=>_plStr(c).toLowerCase()); }
function _plPick(hdr, ...names){ for(const nm of names){ if(nm instanceof RegExp){ const i=hdr.findIndex(h=>nm.test(h)); if(i>=0) return i; } else { const i=hdr.indexOf(nm.toLowerCase()); if(i>=0) return i; } } return -1; }
function _plMonthCols(hdrRow, year){
  const cols=[]; hdrRow.forEach((c,i)=>{ const s=_plStr(c); if(!s||/^fy$|^total$|^check$|^\d{4}$/i.test(s)) return; const pm=_fbParseMonthHeader(s, year); if(pm&&pm.m>=1&&pm.m<=12&&(pm.y===year||!/\d/.test(s))) cols.push({i, m:pm.m}); });
  // one column per month, first occurrence wins
  const seen=new Set(); return cols.filter(c=>{ if(seen.has(c.m)) return false; seen.add(c.m); return true; });
}
// ── External (FL): one line per draft row ────────────────────────────────────
function _plExtParse(buf, name){
  const s=plSettings(), year=s.budget_year;
  const {names, sheet, aoa}=_plAoa(buf, n=>/^external\s*\(\s*fl\s*\)\s*$/i.test(n.trim()));
  if(!aoa) throw new Error('No "External (FL)" sheet in '+name+' (sheets: '+names.join(', ')+')');
  const h0=aoa.findIndex((r,i)=>i<15&&r.some(c=>/^sold-?\s*to\s*party$/i.test(_plStr(c)))&&r.some(c=>/^plant$/i.test(_plStr(c))));
  if(h0<0) throw new Error('"External (FL)": header row with "Sold-to party" and "Plant" not found');
  const hdr=_plHdrIndex(aoa[h0]);
  const C={area:_plPick(hdr,'plant area'), ctype:_plPick(hdr,'st customer type'), csub:_plPick(hdr,'st customer subtype'), plant:_plPick(hdr,'plant'), pname:_plPick(hdr,'plant name'),
    inco:_plPick(hdr,'incoterms','incoterm'), owner:_plPick(hdr,'st owner'), sold:_plPick(hdr,'sold-to party','sold to party','sold-to'), soldn:_plPick(hdr,'sold-to party name','sold to party name'),
    ship:_plPick(hdr,'ship-to party','ship to party','ship-to'), shipn:_plPick(hdr,'ship-to party name','ship to party name'), pline:_plPick(hdr,'product line'), mat:_plPick(hdr,'material'), matd:_plPick(hdr,'material description'),
    region:_plPick(hdr,'region'), district:_plPick(hdr,/^d40/,'district'), fy:_plPick(hdr,'fy')};
  const miss=['plant','sold','ship','mat'].filter(k=>C[k]<0); if(miss.length) throw new Error('"External (FL)": missing columns '+miss.join(', '));
  const mc=_plMonthCols(aoa[h0], year); if(mc.length!==12) throw new Error(`"External (FL)": found ${mc.length} month columns, expected 12 (Jan…Dec)`);
  const lines=[]; let fy=0; const byPlant={}; let skipped=0;
  aoa.slice(h0+1).forEach((r,k)=>{
    const plant=_plCode(r[C.plant]); const sold=_plCode(r[C.sold]); const ship=_plCode(r[C.ship]); const mat=_plCode(r[C.mat]);
    const months=PL_MONTHS.map((_,i)=>{ const c=mc.find(x=>x.m===i+1); return c?_plNum(r[c.i]):0; });
    const tot=months.reduce((a,b)=>a+b,0);
    if(!plant&&!sold&&!mat){ skipped++; return; }
    if(tot===0&&!months.some(x=>x!==0)){ skipped++; return; }
    const adj=/^adj/i.test(plant)||/^adj/i.test(mat);
    const prospective=!sold||/^n\/?a$/i.test(sold)||/prospect/i.test(_plStr(r[C.soldn]));
    const line={kind:'EXT', family:'cement', line_key:['EXT',sold||('~'+_plStr(r[C.shipn])),ship,plant,mat].join('|'), src_row:h0+2+k,
      sold_to:sold, sold_to_name:_plStr(r[C.soldn]), ship_to:ship, ship_to_name:_plStr(r[C.shipn]), plant, plant_name:_plStr(r[C.pname]), material:mat, material_desc:_plStr(r[C.matd]),
      incoterm:_plStr(r[C.inco]), cust_type:_plStr(r[C.ctype]), cust_subtype:_plStr(r[C.csub]), region:_plStr(r[C.region]), district:_plStr(r[C.district]), product_line:_plStr(r[C.pline]),
      months, fy:Math.round(tot*1000)/1000};
    if(adj) line.adjustment=true; if(prospective) line.prospective=true;
    lines.push(line); fy+=tot; byPlant[plant]=(byPlant[plant]||0)+tot;
  });
  return {name, sheet, lines, skipped, fy:Math.round(fy), byPlant};
}
// ── versions ──────────────────────────────────────────────────────────────────
function plVersions(){ return (DB.plan_versions=DB.plan_versions||[]); }
function plActiveVersion(){ return plVersions().find(v=>v.status==='active')||null; }
function plVersionLines(vid){ return (DB.plan_lines||[]).filter(l=>l.version_id===vid); }
function plSetActiveVersion(id){ plVersions().forEach(v=>{ if(v.status==='active') v.status='draft'; }); const v=plVersions().find(x=>x.id===id); if(v) v.status='active'; autoSave(); planRender(); }
function plArchiveVersion(id){ const v=plVersions().find(x=>x.id===id); if(!v) return; v.status=v.status==='archived'?'draft':'archived'; autoSave(); planRender(); }
function plDeleteVersion(id){ const v=plVersions().find(x=>x.id===id); if(!v||v.status==='active'){ statMsg('Make another version active first'); return; }
  if(!confirm(`Delete version "${v.label}" and its ${plVersionLines(id).length} lines? Its master file in the budget folder stays.`)) return;
  DB.plan_versions=plVersions().filter(x=>x.id!==id); DB.plan_lines=(DB.plan_lines||[]).filter(l=>l.version_id!==id); DB.plan_demand=(DB.plan_demand||[]).filter(p=>p.version_id!==id); autoSave(); planRender(); }
// ── translation of a line to a demand point (Demand Mapping's engine) ─────────
function PL_DEM_SHIP_TYPE(){ if(!XLMAP) xlmapLoad(); const m=(XLMAP.movements||[]).find(r=>String(r.movement||'').toUpperCase()==='DEM'&&r.action!=='park'&&r.action!=='ignore'); return m?m.ship_type:'SALES'; }
function plTranslateLine(line){
  if(!XLMAP) xlmapLoad();
  const t=xlmapTranslate({ship_pt:line.plant, material:line.material, sold_to:line.sold_to, ship_type:PL_DEM_SHIP_TYPE()});
  let name=t.finalName, cls=t.parts&&t.parts.class;
  if(line.prospective&&t.parts&&t.parts.source&&t.parts.product){ t.parts.class='EXT'; cls='EXT'; name=xlmapName(t.parts); }
  const el=name?xlmapFindDp(name):null;
  const missing=(t.missing||[]).slice(); if(!el&&name&&t.mapped) missing.push('demand point '+name+' is not in the topology');
  return {dp_name:name||'', element_id:el?el.id:null, mapped:!!(t.mapped&&el), missing, inactive:!!(el&&el.is_active===false), purchased:!!(el&&plIsPurchasedDp(el)), cls, action:t.action, source:t.parts&&t.parts.source, product:t.parts&&t.parts.product, pres:t.parts&&t.parts.presentation};
}
function plVersionStats(v){
  const st={n:0, fy:0, fam:{}, ext:0, int:0, file:0, legacy:0};
  plVersionLines(v.id).forEach(l=>{ st.n++; st.fy+=l.fy||0; st.fam[l.family||'cement']=(st.fam[l.family||'cement']||0)+(l.fy||0);
    if(l.kind!=='LOAD') st.legacy++; else if(l.src==='EXT') st.ext+=l.fy||0; else if(l.src==='INT') st.int+=l.fy||0; else st.file+=l.fy||0; });
  return st;
}
// One readable label for a version line (an External (FL) customer row, or a demand point of a table).
function _plLineLabel(l){
  if(l.src==='EXT'||l.kind==='EXT') return `${l.sold_to_name||l.sold_to||'(prospect)'} → ${l.ship_to_name||l.ship_to||''} · ${l.plant_name||l.plant||''} · ${l.material_desc||l.material||''}`;
  if(l.src==='INT') return `${l.family} · ${l.rmx_name||l.rmx_plant} (plant ${l.rmx_plant}) → ${l.dp_name}`;
  if(l.kind==='INT') return `${l.family} · ${l.rmx_name||l.rmx_plant}`;
  return `${l.family||''} · ${l.dp_name||''}`;
}
// File-level difference between two versions, per line_key.
function plVersionDiff(aId, bId){
  const A=new Map(plVersionLines(aId).map(l=>[l.line_key,l])), B=new Map(plVersionLines(bId).map(l=>[l.line_key,l])); const rows=[];
  new Set([...A.keys(),...B.keys()]).forEach(k=>{ const a=A.get(k), b=B.get(k); const fa=a?a.fy:0, fb=b?b.fy:0; if(Math.abs(fa-fb)<0.5&&a&&b&&a.months.every((x,i)=>Math.abs(x-b.months[i])<0.5)) return;
    const l=b||a; rows.push({key:k, kind:l.src||l.kind, label:_plLineLabel(l), fa, fb, d:fb-fa, status:!a?'new':!b?'gone':'changed'}); });
  rows.sort((x,y)=>Math.abs(y.d)-Math.abs(x.d)); return rows;
}
function plShowDiff(){ const a=document.getElementById('plv-a')?.value, b=document.getElementById('plv-b')?.value; if(!a||!b||a===b){ statMsg('Pick two different versions'); return; } PL.ui.diff={a,b}; planRender(); }
// ── Version comparison report: files, months, facilities, demand points, lines ──
function _plBucket(l){ return l.kind!=='LOAD'?'Retired process':(({EXT:'External (FL)', INT:'Internal (RMX)'})[l.src]||'Demand-point table')+' · '+(l.family||'cement'); }
function _plSumBy(L, f){ const o={}; L.forEach(l=>{ const k=f(l); o[k]=(o[k]||0)+(l.fy||0); }); return o; }
function plVersionReport(aId, bId){
  const A=plVersions().find(v=>v.id===aId), B=plVersions().find(v=>v.id===bId); if(!A||!B) throw new Error('version not found');
  const LA=plVersionLines(aId), LB=plVersionLines(bId);
  const bA=_plSumBy(LA,_plBucket), bB=_plSumBy(LB,_plBucket);
  const buckets=[...new Set([...Object.keys(bA),...Object.keys(bB)])].sort().map(k=>({k, a:bA[k]||0, b:bB[k]||0, d:(bB[k]||0)-(bA[k]||0)}));
  const mo=i=>{ const s=L=>L.reduce((t,l)=>t+((l.months||[])[i]||0),0); return {m:PL_MONTHS[i], a:s(LA), b:s(LB), d:s(LB)-s(LA)}; };
  const months=PL_MONTHS.map((_,i)=>mo(i));
  const lines=plVersionDiff(aId,bId);
  const nNew=lines.filter(r=>r.status==='new').length, nGone=lines.filter(r=>r.status==='gone').length, nChg=lines.filter(r=>r.status==='changed').length;
  // per demand point: as generated, or as it would generate today when the version was never generated
  const gen=vid=>{ const o={}, nm={}; const pd=(DB.plan_demand||[]).filter(p=>p.version_id===vid);
    if(pd.length){ pd.forEach(p=>{ o[p.element_id]=(o[p.element_id]||0)+(p.total_t||0); nm[p.element_id]=p.dp_name; }); return {o, nm, stored:true, unalloc:0}; }
    const g=plGenerateMonthly(vid); Object.keys(g.tot).forEach(el=>{ o[el]=Object.values(g.tot[el]).reduce((a,b)=>a+Math.max(0,b),0); }); return {o, nm:g.names, stored:false, unalloc:g.unalloc.reduce((a,u)=>a+u.t,0)}; };
  const gA=gen(aId), gB=gen(bId);
  const elName=el=>gB.nm[el]||gA.nm[el]||(((DB.elements||[]).find(e=>e.id===el)||{}).name)||el;
  const points=[...new Set([...Object.keys(gA.o),...Object.keys(gB.o)])].map(el=>{ const a=gA.o[el]||0, b=gB.o[el]||0; return {el, name:elName(el), fac:(elName(el)||'').split('/')[0], a, b, d:b-a}; })
    .filter(p=>Math.abs(p.d)>0.5||p.a>0||p.b>0).sort((x,y)=>Math.abs(y.d)-Math.abs(x.d));
  const facs={}; points.forEach(p=>{ const f=facs[p.fac]=facs[p.fac]||{fac:p.fac, a:0, b:0, d:0}; f.a+=p.a; f.b+=p.b; f.d+=p.d; });
  const facilities=Object.values(facs).sort((x,y)=>Math.abs(y.d)-Math.abs(x.d));
  const tot={a:points.reduce((s,p)=>s+p.a,0), b:points.reduce((s,p)=>s+p.b,0)}; tot.d=tot.b-tot.a;
  const unallocA=(A.gen_report&&A.gen_report.unallocated_t)||Math.round(gA.unalloc||0), unallocB=(B.gen_report&&B.gen_report.unallocated_t)||Math.round(gB.unalloc||0);
  return {A, B, buckets, months, lines, nNew, nGone, nChg, points, facilities, tot, unallocA, unallocB, generatedA:gA.stored, generatedB:gB.stored, at:new Date().toISOString()};
}
function _plD(v, dec){ const s=_plFmt(Math.abs(v), dec||0); return v>0.5?'+'+s:v<-0.5?'−'+s:'0'; }
function _plDc(v){ return `<td class="n" style="color:${v>0.5?'var(--green)':v<-0.5?'var(--red)':'var(--text-dim)'}">${_plD(v)}</td>`; }
function _plVersionReportHTML(r){
  const pct=(d,a)=>a?` <span class="pl-muted">(${d>=0?'+':''}${(d/a*100).toFixed(1)}%)</span>`:'';
  const hdr=`<div style="margin-top:10px;padding:8px 10px;border:1px solid var(--border);background:var(--surface2)"><b>${_plEsc(r.A.label)} → ${_plEsc(r.B.label)}</b> <span class="pl-muted">(${String(r.A.uploaded_at).slice(0,10)} → ${String(r.B.uploaded_at).slice(0,10)}, report ${r.at.slice(0,16).replace('T',' ')})</span><br>
    Lines: ${r.nChg} changed · ${r.nNew} new · ${r.nGone} gone. Budget demand on the demand points: <b>${_plD(r.tot.d)} ST</b>${pct(r.tot.d,r.tot.a)}${r.generatedA&&r.generatedB?'':' <span class="pl-flag dim">'+(r.generatedA?'':r.A.label+' not generated · ')+(r.generatedB?'':r.B.label+' not generated · ')+'computed as it would generate today</span>'}
    · unallocated ${_plFmt(r.unallocA)} → ${_plFmt(r.unallocB)} ST</div>`;
  const tbl=(title, head, rows)=>`<div style="margin-top:8px"><b>${title}</b><div style="max-height:260px;overflow:auto;border:1px solid var(--border);margin-top:3px"><table class="pl-tbl"><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr>${rows}</table></div></div>`;
  const buckets=tbl('By source and family (file totals, ST)', ['', 'A', 'B', 'Δ'], r.buckets.map(b=>`<tr><td>${b.k}</td><td class="n">${_plFmt(b.a)}</td><td class="n">${_plFmt(b.b)}</td>${_plDc(b.d)}</tr>`).join(''));
  const months=tbl('By month (file totals, ST)', ['', 'A', 'B', 'Δ'], r.months.map(m=>`<tr><td>${m.m}</td><td class="n">${_plFmt(m.a)}</td><td class="n">${_plFmt(m.b)}</td>${_plDc(m.d)}</tr>`).join(''));
  const facs=tbl('By facility (budget demand, ST)', ['Facility', 'A', 'B', 'Δ'], r.facilities.map(f=>`<tr><td>${_plEsc(f.fac)}</td><td class="n">${_plFmt(f.a)}</td><td class="n">${_plFmt(f.b)}</td>${_plDc(f.d)}</tr>`).join('')+`<tr><td><b>Total</b></td><td class="n"><b>${_plFmt(r.tot.a)}</b></td><td class="n"><b>${_plFmt(r.tot.b)}</b></td>${_plDc(r.tot.d)}</tr>`);
  const pts=tbl('By demand point (budget demand, ST) — biggest moves first', ['Demand point', 'A', 'B', 'Δ'], r.points.slice(0,80).map(p=>`<tr><td>${_plEsc(_plDpShort(p.name))}</td><td class="n">${_plFmt(p.a)}</td><td class="n">${_plFmt(p.b)}</td>${_plDc(p.d)}</tr>`).join(''));
  const lines=tbl(`By line — ${r.lines.length} differ, biggest first`, ['Line', 'Status', 'FY A', 'FY B', 'Δ'], r.lines.slice(0,200).map(l=>`<tr><td>${_plEsc(l.label)}</td><td><span class="pl-flag ${l.status==='new'?'ok':l.status==='gone'?'bad':'dim'}">${l.status}</span></td><td class="n">${_plFmt(l.fa)}</td><td class="n">${_plFmt(l.fb)}</td>${_plDc(l.d)}</tr>`).join(''));
  return hdr+`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${buckets}${months}</div>`+facs+pts+lines;
}
async function plExportVersionReport(){
  if(!PL.ui.diff){ statMsg('Compare two versions first'); return; }
  const r=plVersionReport(PL.ui.diff.a, PL.ui.diff.b); await loadLib('xlsx');
  const wb=XLSX.utils.book_new(); const sh=(name, rows)=>XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length?rows:[{note:'(none)'}]), name);
  const rd=v=>Math.round(v*10)/10;
  sh('Summary', [{item:'From version', value:r.A.label},{item:'To version', value:r.B.label},{item:'From uploaded', value:String(r.A.uploaded_at).slice(0,16)},{item:'To uploaded', value:String(r.B.uploaded_at).slice(0,16)},{item:'Report at', value:r.at.slice(0,16)},
    {item:'Lines changed', value:r.nChg},{item:'Lines new', value:r.nNew},{item:'Lines gone', value:r.nGone},{item:'Budget demand A (ST)', value:rd(r.tot.a)},{item:'Budget demand B (ST)', value:rd(r.tot.b)},{item:'Δ total (ST)', value:rd(r.tot.d)},
    {item:'Unallocated A (ST)', value:r.unallocA},{item:'Unallocated B (ST)', value:r.unallocB},{item:'Units', value:'short tons'}]);
  sh('By source', r.buckets.map(b=>({source:b.k, A:rd(b.a), B:rd(b.b), delta:rd(b.d)})));
  sh('By month', r.months.map(m=>({month:m.m, A:rd(m.a), B:rd(m.b), delta:rd(m.d)})));
  sh('By facility', r.facilities.map(f=>({facility:f.fac, A:rd(f.a), B:rd(f.b), delta:rd(f.d)})));
  sh('By demand point', r.points.map(p=>({demand_point:p.name, facility:p.fac, A:rd(p.a), B:rd(p.b), delta:rd(p.d)})));
  sh('By line', r.lines.map(l=>({line_key:l.key, source:l.kind, line:l.label, status:l.status, FY_A:rd(l.fa), FY_B:rd(l.fb), delta:rd(l.d)})));
  const name=`Budget_versions_${String(r.A.label).replace(/[^\w]+/g,'_')}_to_${String(r.B.label).replace(/[^\w]+/g,'_')}_${r.at.slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, name, {compression:true}); statMsg('Report saved — '+name); return wb;
}
// Family of a demand point name: topology product first, name tokens as the fallback (history names may predate the topology).
function plFamilyOfName(name){
  const c=PL._famCache=PL._famCache||{}; if(c[name]) return c[name];
  let fam=null; const el=xlmapFindDp(name);
  if(el){ const dp=(DB.demand_points||[]).find(d=>d.element_id===el.id); const pid=dp&&dp.products&&dp.products[0]&&dp.products[0].product_id; const p=pid&&(DB.products||[]).find(x=>x.id===pid);
    if(p){ if(p.category==='additive') fam=/slag|slg/i.test(p.scm_type||p.name)?'slag':/ash/i.test(p.scm_type||p.name)?'ash':'other'; else if(/^cement/.test(p.category||'')) fam='cement'; } }
  if(!fam){ const prod=(name.split('/')[2]||name).toUpperCase(); fam=/SLG|SLAG|GGBS/.test(prod)?'slag':/ASH|FLY/.test(prod)?'ash':/WHT|OFFSPEC|CLK|CLINKER/.test(prod)?'other':'cement'; }
  return (c[name]=fam);
}
function _plDpShort(name){ const p=String(name||'').split('/'); if(p.length<5) return name; return p[0]+'/'+p[2]+(p[3]&&p[3]!=='BLK'?'/'+p[3]:'')+'/'+p[4]; }
// ── cards ───────────────────────────────────────────────────────────────────────
function _plDpOptions(sel, fam){ const dps=(DB.elements||[]).filter(e=>e.type==='demand_point').map(e=>e.name).filter(n=>!fam||plFamilyOfName(n)===fam).sort(); return dps.map(n=>`<option value="${_plEsc(n)}" ${n===sel?'selected':''}>${_plEsc(n)}</option>`).join(''); }
// ═══ P4 · Generate → plan_demand → materialise · comparison in Execution ═══════
function _plHash(str){ let h=0; for(let i=0;i<str.length;i++) h=(h*31+str.charCodeAt(i))|0; return (h>>>0).toString(16); }
function plGenHash(vid){
  const s=plSettings(); const y=s.budget_year;
  const parts=[plVersionLines(vid).map(l=>l.id+':'+l.fy+':'+(l.dp_name||'')).join(','), [s.sat_pct,s.ships_sat].join('|'),
    (DB.non_working_days||[]).filter(d=>String(d.date).startsWith(String(y))).map(d=>d.date).sort().join(',')];
  return _plHash(parts.join('\u0001'));
}
// Monthly tonnes per demand point for a version (lines are resolved by NAME, so a topology refresh cannot orphan them). Pure.
// Cement never lands on a purchased point: the budget assumes our own supply.
function plGenerateMonthly(vid){
  const tot={}, lines={}, names={}, unalloc=[], warnings=[];
  const add=(el, name, m, t, lineId)=>{ if(!t||!(m>=0)) return; /* negatives (returns, adjustments) net here and are clamped per point-month */ names[el]=names[el]||name; tot[el]=tot[el]||{}; lines[el]=lines[el]||{}; tot[el][m]=(tot[el][m]||0)+t; lines[el][m]=lines[el][m]||{}; lines[el][m][lineId]=(lines[el][m][lineId]||0)+t; };
  plVersionLines(vid).forEach(l=>{
    if(l.kind!=='LOAD'){ unalloc.push({line:l, t:l.fy, why:'line from the retired customer process: load this budget again'}); return; }
    const el=xlmapFindDp(l.dp_name); if(!el){ unalloc.push({line:l, t:l.fy, why:'point not in topology: '+l.dp_name}); return; }
    if(plFamilyOfName(el.name)==='cement'&&plIsPurchasedDp(el)){ unalloc.push({line:l, t:l.fy, why:'cement on a purchased point: '+el.name+' (move it to one of ours)'}); return; }
    l.months.forEach((x,m)=>add(el.id, el.name, m, x, l.id));
  });
  let clamped=0; Object.keys(tot).forEach(el=>{ Object.keys(tot[el]).forEach(m=>{ if(tot[el][m]<0){ clamped+=-tot[el][m]; tot[el][m]=0; } }); });
  if(clamped) warnings.push(`${Math.round(clamped)} t of negative point-months clamped to 0`);
  return {tot, lines, names, unalloc, excluded:0, excludedT:0, clamped, warnings};
}
function plSpreadMonth(y, m, total, carry, s){
  const t=total+(carry||0); const rows=t>0?_fbDistributeMonthRows(y, m, t, {shipsSat:s.ships_sat!==false, satPct:s.sat_pct}):[];
  const days=new Array(31).fill(0); let spread=0; rows.forEach(r=>{ const d=+r.date.slice(8,10); days[d-1]=r.value; spread+=r.value; });
  return {days, spread_t:spread, carry:t-spread};
}
function plGenerate(vid){
  vid=vid||(plActiveVersion()||{}).id; const v=plVersions().find(x=>x.id===vid); if(!v){ statMsg('No version'); return null; }
  const s=plSettings(); const y=s.budget_year; const g=plGenerateMonthly(vid);
  DB.plan_demand=(DB.plan_demand||[]).filter(p=>p.version_id!==vid);
  let sumTot=0, sumSpread=0, nRows=0;
  Object.keys(g.tot).forEach(el=>{ let carry=0;
    for(let m=0;m<12;m++){ const t=g.tot[el][m]||0; const sp=plSpreadMonth(y, m+1, t, carry, s); carry=sp.carry; sumTot+=t; sumSpread+=sp.spread_t;
      const L=Object.entries(g.lines[el][m]||{}).sort((a,b)=>b[1]-a[1]); const top=L.slice(0,10).map(([id,t2])=>({line_id:id, t:Math.round(t2)})); const rest=L.slice(10).reduce((a,[,t2])=>a+t2,0); if(rest>0) top.push({line_id:'other', t:Math.round(rest)});
      if(t>0||sp.spread_t>0){ DB.plan_demand.push({version_id:vid, element_id:el, dp_name:g.names[el], ym:`${y}-${String(m+1).padStart(2,'0')}`, kind:'budget', days:sp.days, total_t:Math.round(t*10)/10, spread_t:sp.spread_t, lines:top, generated_at:new Date().toISOString()}); nRows++; } }
    if(Math.abs(carry)>25) g.warnings.push(`${g.names[el]}: ${Math.round(carry)} t could not be placed in the year`); });
  v.generated_at=new Date().toISOString(); v.generated_hash=plGenHash(vid); v.stale=false;
  v.gen_report={rows:nRows, points:Object.keys(g.tot).length, total_t:Math.round(sumTot), spread_t:Math.round(sumSpread), unallocated_t:Math.round(g.unalloc.reduce((a,u)=>a+u.t,0)), unallocated:Object.values(g.unalloc.reduce((o,u)=>{ const a=o[u.why]=o[u.why]||{why:u.why, t:0, n:0, label:_plLineLabel(u.line)}; a.t+=u.t; a.n++; return o; },{})).sort((a,b)=>b.t-a.t).slice(0,60).map(a=>({why:a.why, t:Math.round(a.t), label:a.n>1?a.n+' lines':a.label})), excluded:g.excluded, excluded_t:Math.round(g.excludedT), clamped:Math.round(g.clamped), warnings:g.warnings};
  let mat=null; if(v.status==='active'&&scIsPlanning()) mat=plMaterialise(vid);
  autoSave(); planRender();
  statMsg(`Generated ${v.label}: ${_plFmt(sumSpread)} ST on ${Object.keys(g.tot).length} demand points${v.gen_report.unallocated_t?' · '+_plFmt(v.gen_report.unallocated_t)+' ST unallocated':''}${mat?' · simulation re-running':''}`);
  return v.gen_report;
}
// plan_demand of the active version → demand_values (point-level, tagged). Only inside a Planning scenario.
function plMaterialise(vid){
  if(!scIsPlanning()){ statMsg('Budget demand is materialised only inside a Planning scenario'); return null; }
  const s=plSettings(); const y=String(s.budget_year); const rows=(DB.plan_demand||[]).filter(p=>p.version_id===vid); const covered=new Set(rows.map(p=>p.element_id));
  const before=DB.demand_values.length; let replaced=0;
  DB.demand_values=DB.demand_values.filter(r=>{
    if(r.source==='budget'){ return !!(r.manual&&r.version_id===vid); }      // generated rows of any version go; manual overrides of THIS version stay
    if(r.source==='actual') return true;
    if(covered.has(r.element_id)&&String(r.date).startsWith(y)){ replaced++; return false; }   // old forecast rows in the budget year for covered points
    return true; });
  const manual=new Set(DB.demand_values.filter(r=>r.source==='budget'&&r.manual&&r.version_id===vid).map(r=>r.element_id+'|'+r.date));
  const actual=new Set(DB.demand_values.filter(r=>r.source==='actual').map(r=>r.element_id+'|'+r.date));
  let n=0, skippedActual=0, keptManual=0;
  rows.forEach(p=>{ p.days.forEach((t,i)=>{ if(!(t>0)) return; const ds=p.ym+'-'+String(i+1).padStart(2,'0'); const k=p.element_id+'|'+ds; if(actual.has(k)){ skippedActual++; return; } if(manual.has(k)){ keptManual++; return; }
    DB.demand_values.push({element_id:p.element_id, date:ds, value_t:t, source:'budget', version_id:vid}); n++; }); });
  const rep={written:n, replaced, skippedActual, keptManual, before, after:DB.demand_values.length}; s.materialised={version_id:vid, at:new Date().toISOString(), ...rep};
  if(typeof _demandChanged==='function') _demandChanged(); return rep;
}
function plManualRows(vid){ return (DB.demand_values||[]).filter(r=>r.source==='budget'&&r.manual&&r.version_id===vid); }
function plRevertManual(vid, elId, ds){ DB.demand_values=DB.demand_values.filter(r=>!(r.source==='budget'&&r.manual&&r.version_id===vid&&(!elId||(r.element_id===elId&&r.date===ds)))); plMaterialise(vid); autoSave(); planRender(); }
function plStaleCheck(){ const v=plActiveVersion(); if(!v||!v.generated_at) return false; const st=v.generated_hash!==plGenHash(v.id); if(st!==!!v.stale){ v.stale=st; } return st; }
function _plGenerateCardHTML(s){
  const v=plActiveVersion(); if(!v) return '';
  const stale=plStaleCheck(); const r=v.gen_report; const mat=s.materialised&&s.materialised.version_id===v.id?s.materialised:null; const manual=plManualRows(v.id);
  const pdRows=(DB.plan_demand||[]).filter(p=>p.version_id===v.id);
  const byFam={}; pdRows.forEach(p=>{ const f=plFamilyOfName(p.dp_name||''); byFam[f]=(byFam[f]||0)+p.spread_t; });
  const byFac={}; pdRows.forEach(p=>{ const f=(p.dp_name||'').split('/')[0]; byFac[f]=(byFac[f]||0)+p.spread_t; });
  return _plCard('pl-gen','Generate & simulate', v.generated_at?`generated ${String(v.generated_at).slice(0,16).replace('T',' ')}${stale?' · lines or settings changed since':''}`:'not generated yet', null,
    `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
       <button class="pl-btn ${stale||!v.generated_at?'pri':''}" onclick="plGenerate('${v.id}')">${v.generated_at?'Regenerate':'Generate'} budget demand for ${_plEsc(v.label)}</button>
       ${stale?'<span class="pl-flag">regenerate — inputs changed</span>':''}
       ${scIsPlanning()?'':'<span class="pl-muted">(materialised into the simulation only inside the Planning scenario)</span>'}
     </div>
     ${r?`<div class="pl-kv" style="margin-top:8px"><b>Budget demand</b><span><b>${_plFmt(r.spread_t)}</b> ST spread on ${r.points} demand points (${_plFmt(r.total_t)} ST allocated; the 25 t steps carry month to month)</span>
       <b>By family</b><span>${Object.keys(byFam).map(f=>f+' '+_plFmt(byFam[f])).join(' · ')}</span>
       <b>By facility</b><span>${Object.keys(byFac).sort().map(f=>f+' '+_plFmt(byFac[f]/1000,1)+'k').join(' · ')}</span>
       <b>Not allocated</b><span>${r.unallocated_t?`<span class="pl-flag bad">${_plFmt(r.unallocated_t)} ST</span>`:'<span class="pl-flag ok">0</span>'} ${r.excluded?' · '+r.excluded+' rows excluded ('+_plFmt(r.excluded_t)+' ST)':''}${r.clamped?' · '+_plFmt(r.clamped)+' ST clamped':''}</span>
       ${mat?`<b>Simulation</b><span>${_plFmt(mat.written)} daily rows written · ${mat.replaced} old forecast rows replaced · ${mat.skippedActual} actual days kept · ${mat.keptManual} manual overrides kept</span>`:''}
       </div>
       ${r.unallocated&&r.unallocated.length?`<details style="margin-top:6px"><summary class="pl-muted" style="cursor:pointer">Unallocated detail (${r.unallocated.length})</summary><table class="pl-tbl">${r.unallocated.map(u=>`<tr><td>${_plEsc(u.label)}</td><td class="pl-muted">${_plEsc(u.why)}</td><td class="n">${_plFmt(u.t)}</td></tr>`).join('')}</table></details>`:''}
       ${r.warnings.length?`<div class="pl-muted" style="margin-top:4px">⚠ ${r.warnings.map(_plEsc).join('<br>⚠ ')}</div>`:''}`:''}
     ${manual.length?`<details style="margin-top:6px"><summary class="pl-muted" style="cursor:pointer">${manual.length} manual day overrides in this version</summary><table class="pl-tbl">${manual.slice(0,100).map(m=>`<tr><td>${_plEsc(((DB.elements||[]).find(e=>e.id===m.element_id)||{}).name||m.element_id)}</td><td>${m.date}</td><td class="n">${_plFmt(m.value_t)}</td><td><button class="pl-btn" onclick="plRevertManual('${v.id}','${m.element_id}','${m.date}')">revert</button></td></tr>`).join('')}</table><button class="pl-btn" style="margin-top:4px" onclick="plRevertManual('${v.id}')">Revert all</button></details>`:''}`);
}
// ── Execution side: read the Planning file's active budget, read-only ─────────
const PL_LINK_KEY='avila_plan_link';
function plLink(){ try{ return JSON.parse(localStorage.getItem(PL_LINK_KEY)||'null')||{}; }catch(e){ return {}; } }
function plSetLink(id){ try{ localStorage.setItem(PL_LINK_KEY, JSON.stringify({id:id||null})); }catch(e){} PL.bgt=null; PL._bgtAt=0; planRender(); if(id) plBgtEnsure({prompt:true}); }
async function plPeekBudget(opts){
  const link=plLink(); if(!link.id||scIsPlanning()) return null;
  const pk=await scPeekScenario(link.id, opts||{}); if(!pk){ PL._bgtErr='file not readable (not in this browser, or no permission yet — click Connect)'; return null; }
  if(PL.bgt&&PL.bgt.fileMod===pk.fileMod) return PL.bgt;
  const D=pk.payload.DB||{}; const v=(D.plan_versions||[]).find(x=>x.status==='active'); const byEl={}, byName={}; let tot=0; const byVersion={};
  (D.plan_demand||[]).forEach(p=>{ const bv=byVersion[p.version_id]=byVersion[p.version_id]||{byEl:{}, names:{}}; (bv.byEl[p.element_id]=bv.byEl[p.element_id]||{})[p.ym]=p.days; bv.names[p.element_id]=p.dp_name||'';
    if(v&&p.version_id===v.id){ (byEl[p.element_id]=byEl[p.element_id]||{})[p.ym]=p.days; if(p.dp_name) (byName[p.dp_name]=byName[p.dp_name]||{})[p.ym]=p.days; tot+=p.spread_t||0; } });
  const set=(D.plan_settings||[]).find(x=>x.id==='default')||{};
  // The Planning scenario's own plan — what its simulation ran on — kept whole so a push can carry it across with the demand.
  const plan={}; PL_PLAN_TABLES.forEach(d=>{ plan[d.t]=(D[d.t]||[]).map(r=>JSON.parse(JSON.stringify(r))); });
  PL.bgt={scenarioId:link.id, scenarioName:pk.name, versionId:v&&v.id, versionLabel:v&&v.label, generated_at:v&&v.generated_at, year:(v&&v.year)||set.budget_year||(new Date().getFullYear()+1), byEl, byName, total_t:Math.round(tot), fileMod:pk.fileMod, at:Date.now(),
    versions:(D.plan_versions||[]).filter(x=>x.generated_at).map(x=>({id:x.id, label:x.label, status:x.status, year:x.year, generated_at:x.generated_at})), byVersion, plan};
  PL._bgtErr=v?null:'the Planning scenario has no active, generated version';
  return PL.bgt;
}
// Synchronous accessor for renders: returns what is loaded and kicks a silent refresh at most once a minute.
function plBgtEnsure(opts){
  if(scIsPlanning()||!plLink().id) return null;
  const now=Date.now(); if(!PL._bgtBusy&&(now-(PL._bgtAt||0)>60000||(opts&&opts.prompt))){ PL._bgtBusy=true; PL._bgtAt=now;
    plPeekBudget(opts).then(b=>{ PL._bgtBusy=false; if(b&&b.at>now-5000){ if(S.view==='demand'&&typeof renderDemandChart==='function') renderDemandChart(); else if(S.view==='supply'&&typeof renderSupplyView==='function') renderSupplyView(); if(document.getElementById('cfg-panel-plan')) planRender(); } }).catch(e=>{ PL._bgtBusy=false; console.warn('plan budget peek', e); }); }
  return PL.bgt&&PL.bgt.versionId?PL.bgt:null;
}
function plBgtVal(elIds, ds){ const b=PL.bgt; if(!b) return 0; const ym=ds.slice(0,7), d=+ds.slice(8,10)-1; let t=0; elIds.forEach(id=>{ const el=(DB.elements||[]).find(e=>e.id===id); const by=b.byEl[id]||(el&&b.byName[el.name]); if(by&&by[ym]) t+=by[ym][d]||0; }); return t; }
function plBgtExtra(dpts){ const b=plBgtEnsure(); if(!b||!dpts||!dpts.length) return []; const ids=dpts.map(d=>d.element_id); if(!ids.some(id=>b.byEl[id]||b.byName[((DB.elements||[]).find(e=>e.id===id)||{}).name])) return [];
  return [{label:`📊 budget ${b.year}`, color:'var(--amber)', title:`Budget ${b.year} — ${b.scenarioName}, version ${b.versionLabel}`, valFn:ds=>plBgtVal(ids, ds)}]; }
function _plCompareCardHTML(s){
  const link=plLink(); const opts=Object.values(SC.meta||{}).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const b=PL.bgt; if(link.id&&!b) plBgtEnsure();
  return _plCard('pl-compare','Budget comparison in this scenario','Demand chart BGT panels and Supply budget rows read the Planning file', null,
    `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pl-muted">Planning scenario</span>
       <select class="fi" id="pl-link" style="width:260px" onchange="plSetLink(this.value)"><option value="">— none —</option>${opts.map(m=>`<option value="${m.id}" ${link.id===m.id?'selected':''}>${_plEsc(m.name)}</option>`).join('')}</select>
       <button class="pl-btn" onclick="plBgtEnsure({prompt:true})" ${link.id?'':'disabled'}>Connect / refresh</button></div>
     <div class="pl-muted" style="margin-top:6px">${b&&b.versionId?`<span class="pl-flag ok">connected</span> ${_plEsc(b.scenarioName)} · version <b>${_plEsc(b.versionLabel)}</b> · budget ${b.year} · ${_plFmt(b.total_t)} ST on ${Object.keys(b.byEl).length} points · generated ${String(b.generated_at||'').slice(0,10)}`:link.id?`<span class="pl-flag">${_plEsc(PL._bgtErr||'reading…')}</span>`:'Pick the Planning scenario created from this one. Budget rows appear on the Supply page once its window reaches January '+(s.budget_year)+'.'}</div>`);
}
// ═══ P6 · Budget → Execution (push): copy a slice of a Planning version into this scenario as tagged forecast rows (reversible) ═══
// Choices: dates, demand points (facility / family / pick), Replace or Fill gaps only, month-by-month preview, Undo (by import id).
function plImports(){ return (DB.plan_imports=DB.plan_imports||[]); }
function _plImportInputs(){
  const g=id=>document.getElementById(id); const b=PL.bgt||{};
  const sel=g('pli-dps'); const picked=sel?[...sel.selectedOptions].map(o=>o.value).filter(Boolean):[];
  return {vid:g('pli-version')?.value||b.versionId, from:g('pli-from')?.value, to:g('pli-to')?.value, picked, fac:g('pli-fac')?.value||'', fam:g('pli-fam')?.value||'', mode:g('pli-mode')?.value||'replace', plan:!!g('pli-plan')?.checked};
}
// ── The plan behind the budget: the Planning scenario's vessel calls, rail movements, production campaigns, silo transfers,
// maintenance events and non-working days. Pushed with the demand, they let a run HERE reproduce the budget scenario's
// simulation from this scenario's own closing state — the trend flowing into the budget year as one continuum.
//   on(r)   → [first day, last day] the record covers (a record is in the push when that overlaps From → To)
//   fac(r)  → the facility the record belongs to, for the Facility filter (rail: either end)
//   refs(r) → element ids the record points at; links(r) → silo-link ids. A record pointing at something this scenario
//             lacks is skipped and counted. A record whose id is already here (an earlier push, the shared topology)
//             is skipped too, as is a maintenance event / non-working day already here for the same element and day.
const PL_PLAN_TABLES=[
  {t:'vessel_calls',               label:'vessel calls',         on:r=>[r.arrival_date,r.arrival_date],              fac:r=>r.facility_id,                         refs:r=>[r.berth_element_id].concat((r.legs||[]).map(l=>l.berth_element_id)).filter(Boolean)},
  {t:'rail_movements',             label:'rail movements',       on:r=>[r.departure_date,r.departure_date],          fac:r=>r.to_facility_id, fac2:r=>r.from_facility_id, refs:r=>[r.from_dispatch_id,r.to_berth_id,r.to_silo_id].filter(Boolean)},
  {t:'production_campaigns',       label:'production campaigns', on:r=>[r.start_date,r.end_date||r.start_date],       fac:r=>_plElFac(r.element_id),                refs:r=>[r.element_id]},
  {t:'silo_transfer_plans',        label:'silo transfers',       on:r=>[r.start_date,r.end_date||r.start_date],       fac:r=>_plElFac(r.from_silo_id),              refs:r=>[r.from_silo_id,r.to_silo_id], links:r=>[r.link_id]},
  {t:'element_maintenance_events', label:'maintenance events',   on:r=>[r.start_date,r.end_date||r.start_date],       fac:r=>r.facility_id||_plElFac(r.element_id), refs:r=>[r.element_id], same:r=>r.element_id+'|'+r.start_date},
  {t:'non_working_days',           label:'non-working days',     on:r=>[r.date,r.date],                              fac:()=>null,                                 refs:()=>[], same:r=>r.date},
];
function _plElFac(id){ const el=(DB.elements||[]).find(e=>e.id===id); return el?el.facility_id:null; }
// What the plan push would copy for the inputs: {copy:[{t,rec}], counts:{t:n}, exists, unknown}. Picked demand points mean a
// partial push, so the plan stays out of it; the Facility filter applies to plan records as it does to demand.
function _plPlanRecords(inp, b){
  const out={copy:[], counts:{}, exists:0, unknown:0, n:0};
  if(!inp.plan||!b||!b.plan||(inp.picked&&inp.picked.length)) return out;
  const facId=inp.fac?((DB.facilities||[]).find(f=>f.name===inp.fac)||{}).id:null;
  const els=new Set((DB.elements||[]).map(e=>e.id)), links=new Set((DB.silo_links||[]).map(l=>l.id)), facs=new Set((DB.facilities||[]).map(f=>f.id));
  PL_PLAN_TABLES.forEach(d=>{
    const here=DB[d.t]||[]; const ids=new Set(here.map(r=>r.id)); const sameKeys=d.same?new Set(here.map(d.same)):null;
    (b.plan[d.t]||[]).forEach(r=>{
      const [a,z]=d.on(r); if(!a||String(a)>inp.to||String(z||a)<inp.from) return;
      if(facId&&!(d.fac(r)===facId||(d.fac2&&d.fac2(r)===facId))) return;
      if(ids.has(r.id)||(sameKeys&&sameKeys.has(d.same(r)))){ out.exists++; return; }
      if(d.refs(r).some(id=>!els.has(id))||(d.links&&d.links(r).some(id=>!links.has(id)))||(d.t==='rail_movements'&&[r.from_facility_id,r.to_facility_id].some(id=>id&&!facs.has(id)))){ out.unknown++; return; }
      out.copy.push({t:d.t, rec:r}); out.counts[d.t]=(out.counts[d.t]||0)+1; out.n++;
    });
  });
  return out;
}
function _plPlanSummary(pr){ return PL_PLAN_TABLES.filter(d=>pr.counts[d.t]).map(d=>`${pr.counts[d.t]} ${d.label}`).join(' · ')||'nothing in these dates'; }
function _plImportEls(inp, bv){
  if(!bv) return [];
  const nameOf=el=>(bv.names&&bv.names[el])||((DB.elements||[]).find(e=>e.id===el)||{}).name||'';
  if(inp.picked&&inp.picked.length) return inp.picked.slice();                 // an explicit pick wins over the facility / family filters
  let els=Object.keys(bv.byEl);
  if(inp.fac) els=els.filter(el=>nameOf(el).split('/')[0]===inp.fac);
  if(inp.fam) els=els.filter(el=>plFamilyOfName(nameOf(el))===inp.fam);
  return els;
}
function plImportPreview(apply){
  const b=PL.bgt; if(!b||!b.byVersion){ statMsg('Connect the Planning scenario first'); return null; }
  const inp=(apply&&PL.ui.impIn)?PL.ui.impIn:_plImportInputs(); if(!apply) PL.ui.impIn=inp;     // Apply uses exactly what was previewed
  const {vid, from, to, mode}=inp; const bv=b.byVersion[vid];
  if(!bv){ statMsg('That version has no generated demand'); return null; } if(!from||!to||from>to){ statMsg('Pick a date range'); return null; }
  const elIds=_plImportEls(inp, bv); const known=new Set((DB.elements||[]).filter(e=>e.type==='demand_point').map(e=>e.id));
  let vals=[]; elIds.forEach(el=>{ if(!known.has(el)) return; const byYm=bv.byEl[el]||{}; Object.keys(byYm).forEach(ym=>{ byYm[ym].forEach((t,i)=>{ if(!(t>0)) return; const ds=ym+'-'+String(i+1).padStart(2,'0'); if(ds<from||ds>to) return; vals.push({element_id:el, date:ds, value_t:t}); }); }); });
  const existing=(DB.demand_values||[]).filter(r=>r.source!=='actual');
  if(mode==='fill'){ const have=new Set(existing.filter(r=>r.value_t>0).map(r=>r.element_id+'|'+r.date)); vals=vals.filter(x=>!have.has(x.element_id+'|'+x.date)); }   // only days that have no forecast
  const touched=new Set(vals.map(x=>x.element_id+'|'+x.date)); const actual=new Set((DB.demand_values||[]).filter(r=>r.source==='actual').map(r=>r.element_id+'|'+r.date));
  const replaced=existing.filter(r=>touched.has(r.element_id+'|'+r.date));
  const writable=vals.filter(x=>!actual.has(x.element_id+'|'+x.date));
  const skip=vals.length-writable.length; const t=writable.reduce((a,x)=>a+x.value_t,0);
  const byM={}; writable.forEach(x=>{ const ym=x.date.slice(0,7); (byM[ym]=byM[ym]||{cur:0,bud:0}).bud+=x.value_t; });
  replaced.forEach(r=>{ if(actual.has(r.element_id+'|'+r.date)) return; const ym=r.date.slice(0,7); if(byM[ym]) byM[ym].cur+=r.value_t; });
  const pr=_plPlanRecords(inp, b);
  const prev={vid, label:(b.versions.find(v=>v.id===vid)||{}).label||vid, from, to, mode, points:new Set(writable.map(x=>x.element_id)).size, rows:writable.length, t:Math.round(t), replaced:replaced.length, skip,
    months:Object.keys(byM).sort().map(ym=>({ym, cur:Math.round(byM[ym].cur), bud:Math.round(byM[ym].bud)})), plan:{on:!!inp.plan, picked:!!(inp.picked&&inp.picked.length), n:pr.n, counts:pr.counts, exists:pr.exists, unknown:pr.unknown, text:_plPlanSummary(pr)}};
  if(!apply){ PL.ui.importPreview=prev; planRender(); return prev; }
  if(writable.length>5000&&!confirm(`${writable.length} daily rows will be written — the Execution change log records each one (budget 15,000 ops). Continue? (Splitting by quarter keeps the log small.)`)) return null;
  const imp={id:'pi_'+Date.now().toString(36), planning_scenario_id:b.scenarioId, planning_name:b.scenarioName, version_id:vid, version_label:prev.label, element_ids:[...new Set(writable.map(x=>x.element_id))], from, to, mode, marked:true, n_rows:0, t:0,
    replaced:replaced.map(r=>({...r})), at:new Date().toISOString(), by:_plWho(), undone_at:null};
  DB.demand_values=(DB.demand_values||[]).filter(r=>!(touched.has(r.element_id+'|'+r.date)&&r.source!=='actual'));
  writable.forEach(x=>{ DB.demand_values.push({element_id:x.element_id, date:x.date, value_t:Math.round(x.value_t*10)/10, source:'forecast', version_id:vid, plan_tag:'budget', import_id:imp.id}); imp.n_rows++; imp.t+=x.value_t; });
  // The plan behind the budget: copied whole, keeping ids, tagged with this import. Vessel calls and rail movements
  // arrive as Planned (never as auto-proposals, which a run wipes and re-proposes), noted as the budget plan.
  imp.plan={n:0, counts:{}};
  pr.copy.forEach(({t,rec})=>{ const c=JSON.parse(JSON.stringify(rec)); c.import_id=imp.id; c.plan_tag='budget';
    if(t==='vessel_calls'||t==='rail_movements'){ if(!c.status||c.status==='Proposed'||c.status==='Confirmed') c.status='Planned';
      const auto=/^Auto-(proposed|generated)/i.test(String(c.notes||'')); c.notes=`Budget plan · ${prev.label}`+(c.notes&&!auto?' · '+c.notes:''); }
    (DB[t]=DB[t]||[]).push(c); imp.plan.n++; imp.plan.counts[t]=(imp.plan.counts[t]||0)+1; });
  imp.t=Math.round(imp.t); plImports().push(imp); PL.ui.importPreview=null;
  if(typeof _demandChanged==='function') _demandChanged(); autoSave(); planRender();
  statMsg(`Budget ${prev.label} copied into this scenario: ${_plFmt(imp.n_rows)} days, ${_plFmt(imp.t)} ST (${mode==='fill'?'gaps only':prev.replaced+' forecast rows replaced'}, ${prev.skip} actual days kept)`+(imp.plan.n?` + its plan: ${_plPlanSummary(imp.plan)} — run the simulation to see it`:''));
  return imp;
}
// An import can be undone only when no later, still-active import touches the same points and days (undo the later one first).
function plImportBlockedBy(imp){
  const els=new Set(imp.element_ids||[]);
  return plImports().find(x=>x.id!==imp.id&&!x.undone_at&&String(x.at)>String(imp.at)&&x.from<=imp.to&&x.to>=imp.from&&(x.element_ids||[]).some(e=>els.has(e)))||null;
}
function plUndoImport(id){
  const imp=plImports().find(x=>x.id===id); if(!imp||imp.undone_at) return;
  const blk=plImportBlockedBy(imp); if(blk){ statMsg(`Undo the later import (${blk.version_label} ${blk.from} → ${blk.to}) first — it overlaps this one`); return; }
  const els=new Set(imp.element_ids); const before=DB.demand_values.length;
  DB.demand_values=DB.demand_values.filter(r=>imp.marked?(r.import_id!==imp.id):!(r.plan_tag==='budget'&&r.version_id===imp.version_id&&els.has(r.element_id)&&r.date>=imp.from&&r.date<=imp.to));
  const removed=before-DB.demand_values.length; const actual=new Set(DB.demand_values.filter(r=>r.source==='actual').map(r=>r.element_id+'|'+r.date));
  (imp.replaced||[]).forEach(r=>{ if(!actual.has(r.element_id+'|'+r.date)) DB.demand_values.push({...r}); });
  let planGone=0; PL_PLAN_TABLES.forEach(d=>{ if(!DB[d.t]) return; const n=DB[d.t].length; DB[d.t]=DB[d.t].filter(r=>r.import_id!==imp.id); planGone+=n-DB[d.t].length; });
  if(planGone){ const vids=new Set((DB.vessel_calls||[]).map(v=>v.id)); DB.vessel_campaigns=(DB.vessel_campaigns||[]).filter(c=>vids.has(c.vessel_call_id)); }
  imp.undone_at=new Date().toISOString(); if(typeof _demandChanged==='function') _demandChanged(); autoSave(); planRender();
  statMsg(`Import undone: ${removed} budget days removed, ${(imp.replaced||[]).length} previous rows restored`+(planGone?`, ${planGone} plan records removed`:''));
}
function _plImportCardHTML(s){
  const b=PL.bgt; const y=s.budget_year; const imps=plImports().slice().reverse(); const pv=PL.ui.importPreview; const inp=PL.ui.impIn||{};
  const vopts=b&&b.versions?b.versions.map(v=>`<option value="${v.id}" ${v.id===(inp.vid||b.versionId)?'selected':''}>${_plEsc(v.label)}${v.status==='active'?' (active)':''}</option>`).join(''):'';
  const curV=(b&&b.versions&&(document.getElementById('pli-version')?.value||inp.vid||b.versionId))||null; const bv=b&&b.byVersion&&b.byVersion[curV];
  const nameOf=el=>(bv&&bv.names[el])||(((DB.elements||[]).find(e=>e.id===el)||{}).name)||el;
  const picked=new Set(inp.picked||[]);
  const dpopts=bv?Object.keys(bv.byEl).map(el=>({el, name:nameOf(el)})).sort((a,b2)=>a.name.localeCompare(b2.name)).map(o=>`<option value="${o.el}" ${picked.has(o.el)?'selected':''}>${_plEsc(o.name)}</option>`).join(''):'';
  const facs=bv?[...new Set(Object.keys(bv.byEl).map(el=>nameOf(el).split('/')[0]))].sort():[];
  const hist=imps.length?`<table class="pl-tbl" style="margin-top:8px"><tr><th>When</th><th>Version</th><th>Range</th><th>Points</th><th>Days</th><th>ST</th><th></th></tr>${imps.slice(0,12).map(i=>{ const blk=!i.undone_at&&plImportBlockedBy(i);
    return `<tr style="${i.undone_at?'opacity:.5':''}"><td>${String(i.at).slice(0,16).replace('T',' ')}<br><span class="pl-muted">${_plEsc(i.by||'')}</span></td><td>${_plEsc(i.version_label)}${i.mode==='fill'?' <span class="pl-flag dim">gaps only</span>':''}${i.plan&&i.plan.n?` <span class="pl-flag dim" title="${_plEsc(_plPlanSummary(i.plan))}">+ plan ${i.plan.n}</span>`:''}</td><td>${i.from} → ${i.to}</td><td class="n">${i.element_ids.length}</td><td class="n">${_plFmt(i.n_rows)}</td><td class="n">${_plFmt(i.t)}</td><td>${i.undone_at?'<span class="pl-flag dim">undone</span>':blk?`<span class="pl-muted" title="undo the later overlapping import first">after ${_plEsc(blk.version_label)} ${blk.from}</span>`:`<button class="pl-btn" onclick="plUndoImport('${i.id}')">Undo</button>`}</td></tr>`; }).join('')}</table>`:'';
  const mTbl=pv&&pv.months&&pv.months.length?`<table class="pl-tbl" style="margin-top:6px;max-width:520px"><tr><th>Month</th><th>Forecast now (ST)</th><th>Budget (ST)</th><th>Change</th></tr>${pv.months.map(m=>`<tr><td>${m.ym}</td><td class="n">${_plFmt(m.cur)}</td><td class="n">${_plFmt(m.bud)}</td>${_plDc(m.bud-m.cur)}</tr>`).join('')}<tr><td><b>Total</b></td><td class="n"><b>${_plFmt(pv.months.reduce((a,m)=>a+m.cur,0))}</b></td><td class="n"><b>${_plFmt(pv.months.reduce((a,m)=>a+m.bud,0))}</b></td>${_plDc(pv.months.reduce((a,m)=>a+m.bud-m.cur,0))}</tr></table>`:'';
  return _plCard('pl-import','Push the budget into this scenario','copy any slice of the budget in as forecast (tagged, reversible)', imps.length||null,
    b&&b.versions&&b.versions.length?`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;align-items:end">
       <label class="pl-muted">Version<br><select class="fi" id="pli-version" style="width:100%" onchange="planRender()">${vopts}</select></label>
       <label class="pl-muted">From<br><input class="fi" type="date" id="pli-from" value="${inp.from||y+'-01-01'}" style="width:100%"></label>
       <label class="pl-muted">To<br><input class="fi" type="date" id="pli-to" value="${inp.to||y+'-12-31'}" style="width:100%"></label>
       <label class="pl-muted">Facility<br><select class="fi" id="pli-fac" style="width:100%"><option value="">all</option>${facs.map(f=>`<option ${inp.fac===f?'selected':''}>${_plEsc(f)}</option>`).join('')}</select></label>
       <label class="pl-muted">Family<br><select class="fi" id="pli-fam" style="width:100%"><option value="">all</option>${['cement','slag','ash'].map(f=>`<option value="${f}" ${inp.fam===f?'selected':''}>${f}</option>`).join('')}</select></label>
       <label class="pl-muted">Days<br><select class="fi" id="pli-mode" style="width:100%"><option value="replace" ${inp.mode!=='fill'?'selected':''}>Replace the forecast</option><option value="fill" ${inp.mode==='fill'?'selected':''}>Only fill days with no forecast</option></select></label>
       <label class="pl-muted">Or pick demand points (none = the filters above)<br><select class="fi" id="pli-dps" multiple size="4" style="width:100%">${dpopts}</select></label>
       <div style="display:flex;gap:6px"><button class="pl-btn" onclick="plImportPreview(false)">Preview</button><button class="pl-btn pri" onclick="plImportPreview(true)" ${pv?'':'disabled'}>Apply</button></div>
       <label class="pl-muted" style="grid-column:1/-1;display:flex;gap:6px;align-items:flex-start;cursor:pointer"><input type="checkbox" id="pli-plan" ${inp.plan===false?'':'checked'} style="margin-top:2px">
         <span>Also bring the budget scenario's <b>plan</b> for these dates — its vessel calls and rail movements (as Planned), production campaigns, silo transfers, maintenance events and non-working days — so a run here reproduces its simulation from this scenario's own closing state.</span></label></div>
     ${pv?`<div class="pl-muted" style="margin-top:6px">Preview: <b>${_plEsc(pv.label)}</b> ${pv.from} → ${pv.to} · ${pv.points} points · ${_plFmt(pv.rows)} days · <b>${_plFmt(pv.t)}</b> ST · ${pv.mode==='fill'?'only days with no forecast':pv.replaced+' existing forecast rows would be replaced'} · ${pv.skip} actual days kept as they are</div>
     ${pv.plan&&pv.plan.on?`<div class="pl-muted" style="margin-top:3px">Plan: ${pv.plan.picked?'left out — the plan is pushed only with a whole-scenario or facility push, not with picked points':`<b>${_plEsc(pv.plan.text)}</b>${pv.plan.exists?` · ${pv.plan.exists} already here`:''}${pv.plan.unknown?` · <span style="color:var(--amber)">${pv.plan.unknown} skipped — element, link or facility not in this scenario</span>`:''}`}</div>`:''}${mTbl}`:''}
     <div class="pl-muted" style="margin-top:4px">Copied rows are ordinary forecast rows tagged with the budget version; actual days are never touched; Undo restores exactly what was replaced (the latest overlapping push first) and removes the plan records that came with it.</div>${hist}`
    :`<div class="pl-muted">Connect a Planning scenario with a generated version above.</div>${hist}`);
}

// ═══ Internal budget split: the RMX workbook (each internal plant's monthly cement / slag / fly-ash need, in K ST) × that plant's
// demand-point mix. The mix is the BGT page's (and pbi/budget/mix_budget_merge.py's): per sold-to × family, the last N complete months of
// internal shipments (/INT, and Lockhart's own /LKHT) from Avila_Shipments_Detail.xlsx; a month's combination = the points with at least
// the minimum share of its tonnes (months under the minimum tonnes ignored); the most frequent combination wins (the recent months count
// more; ties → tonnes); the split = tonnes pooled over the months that used it. Budget plant # = sold-to #, except Settings' plant map.
function _plRmxParse(buf, name){
  const year=plSettings().budget_year; const want={cem_use:'CEM', slag_use:'SLG', fa_use:'ASH'}; const wb=XLSX.read(buf,{type:'array',dense:true});
  const rows=[], perFam={}, warnings=[];
  Object.keys(want).forEach(key=>{
    const fam=want[key]; const sh=wb.SheetNames.find(x=>x.trim().toLowerCase()===key); if(!sh){ warnings.push('sheet '+key+' not found'); return; }
    const aoa=XLSX.utils.sheet_to_json(wb.Sheets[sh],{header:1,raw:true,defval:''});
    const h0=aoa.findIndex((r,i)=>i<30&&r.some(c=>/^plant\s*#?$/i.test(_plStr(c)))&&r.some(c=>/^region$/i.test(_plStr(c))));
    if(h0<0){ warnings.push(sh+': header row with "Plant #" and "Region" not found'); return; }
    const hdr=_plHdrIndex(aoa[h0]); const cRegion=_plPick(hdr,'region'), cDistrict=_plPick(hdr,'district'), cPlant=_plPick(hdr,/^plant\s*#?$/), cName=_plPick(hdr,'plant name');
    let mc=[]; for(let i=h0;i>=Math.max(0,h0-2)&&mc.length<12;i--) mc=_plMonthCols(aoa[i], year);   // the months sit on the row above the "Bdgt" row
    if(mc.length!==12){ warnings.push(sh+': '+mc.length+' month columns found'); return; }
    const unitCell=aoa.slice(Math.max(0,h0-4),h0+1).flat().map(_plStr).find(c=>/volume\s*\(/i.test(c));
    if(unitCell&&!/\(\s*k\s*st\s*\)/i.test(unitCell)) warnings.push(sh+' says "'+unitCell+'": expected "(K ST)"; values were still multiplied by 1,000');
    let region='', district='', n=0, t=0;
    aoa.slice(h0+1).forEach(r=>{
      if(_plStr(r[cRegion])) region=_plStr(r[cRegion]); if(_plStr(r[cDistrict])) district=_plStr(r[cDistrict]);
      const plant=_plCode(r[cPlant]), pname=_plStr(r[cName]); if(!/^\d{3,5}$/.test(plant)||!pname) return;      // region / district subtotal rows have no plant #
      const months=PL_MONTHS.map((_,i)=>{ const c=mc.find(x=>x.m===i+1); return c?_plNum(r[c.i])*1000:0; });   // thousands of short tons → short tons
      const fy=months.reduce((a,b)=>a+b,0); if(!(fy>0)) return;
      rows.push({fam, plant, pname, region, district, months, fy}); n++; t+=fy;
    });
    perFam[fam]={plants:n, fy:Math.round(t), sheet:sh};
  });
  if(!rows.length) throw new Error('no plant rows in sheets Cem_Use / Slag_Use / FA_Use of '+name+(warnings.length?' ('+warnings.join('; ')+')':''));
  return {name, rows, perFam, warnings, fy:Math.round(rows.reduce((a,r)=>a+r.fy,0))};
}
// Shipment history (sheet SalesDetailed) → the internal rows only, compact: [sold-to, point name, day, tonnes, detail rows].
function _plHistParse(buf, name){
  const wb=XLSX.read(buf,{type:'array',dense:true}); const sn=wb.SheetNames.find(n=>/salesdetailed/i.test(n))||wb.SheetNames[0];
  const A=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:true,defval:''});
  const h0=A.findIndex((r,i)=>i<10&&r.some(c=>/^inv_roll_name$/i.test(_plStr(c)))); if(h0<0) throw new Error(name+' has no INV_ROLL_NAME column (expected Avila_Shipments_Detail.xlsx)');
  const hdr=_plHdrIndex(A[h0]); const cS=_plPick(hdr,'sold-to','sold to'), cSn=_plPick(hdr,'sold-to name','sold to name'), cD=_plPick(hdr,'delivery date'), cQ=_plPick(hdr,'report qty'), cN=_plPick(hdr,'inv_roll_name');
  if(cS<0||cD<0||cQ<0) throw new Error(name+': missing Sold-To / Delivery Date / Report Qty');
  const agg=new Map(), nm=new Map(); let dmin='', dmax='';
  for(let i=h0+1;i<A.length;i++){ const r=A[i]; const full=_plStr(r[cN]); if(!/\/(INT|LKHT)$/.test(full)) continue; const q=_plNum(r[cQ]); if(!(q>0)) continue; const ds=_dsSalesYmd(r[cD]); if(!ds) continue;
    const code=_plCode(r[cS]); const k=code+'\u001f'+full+'\u001f'+ds; const a=agg.get(k); if(a){ a[3]+=q; a[4]++; } else agg.set(k,[code, full, ds, q, 1]);
    if(cSn>=0){ const nk=code+'\u001f'+_plStr(r[cSn]); nm.set(nk,(nm.get(nk)||0)+1); }
    if(ds>dmax) dmax=ds; if(!dmin||ds<dmin) dmin=ds; }
  const names={}; [...nm.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k])=>{ const [c,n]=k.split('\u001f'); if(!(c in names)) names[c]=n; });
  return {file:name, rows:[...agg.values()], names, dateMin:dmin, dateMax:dmax};
}
// Avila_Mix_Substitutions.xlsx (sheet Substitutions: from_dp, to_dp, until_date) — the same file the BGT page reads.
function _plSubsParse(buf){
  const wb=XLSX.read(buf,{type:'array'}); const sh=wb.Sheets['Substitutions']||wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sh,{header:1,raw:true,defval:''}).slice(1).filter(r=>_plStr(r[0])&&_plStr(r[1])).map(r=>({from:_plStr(r[0]).toUpperCase(), to:_plStr(r[1]), until:r[2]===''||r[2]==null?null:_dsSalesYmd(r[2])}));
}
// SOURCE/DEM/PRODUCT/PACK/CHANNEL → "SOURCE/PRODUCT (PACK)", the label the mix is kept on (a product may hold "/", e.g. MIA_I/II).
function _plDpLabel(n){ const p=String(n).split('/'), c=p.length; const prod=c>=5?p.slice(2,c-2).join('/'):(c>2?p[2]:''); const pack=c>=5?p[c-2]:'BLK'; return p[0]+'/'+prod+(pack!=='BLK'?` (${pack})`:''); }
function _plMixFam(n){ const p=String(n).split('/'); const prod=(p.length>=5?p.slice(2,p.length-2).join('/'):(p.length>2?p[2]:'')).toUpperCase(); return prod.includes('ASH')?'ASH':prod.includes('SLG')?'SLG':'CEM'; }
function _plYmShift(ym,k){ const [y,m]=ym.split('-').map(Number); const d=new Date(y,m-1+k,1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }   // calendar step (no ms arithmetic)
function plMixCompute(hist, subs, s){
  const P={months:s.mix_months||12, minShare:(s.mix_min_share_pct??5)/100, minT:s.mix_min_month_t??50, recentM:s.mix_recent_months??3, recentW:s.mix_recent_weight||2};
  // the full point name behind each label: the most used one (an /INT name first), and per sold-to
  const cLab=new Map(), cSold=new Map();
  hist.rows.forEach(([code,full,,,n])=>{ const l=_plDpLabel(full); const k1=l+'\u001f'+full; cLab.set(k1,(cLab.get(k1)||0)+n); const k2=code+'\u001f'+l+'\u001f'+full; cSold.set(k2,(cSold.get(k2)||0)+n); });
  const fullOf={}; [...cLab.entries()].sort((a,b)=>((a[0].endsWith('/INT')?0:1)-(b[0].endsWith('/INT')?0:1))||b[1]-a[1]).forEach(([k])=>{ const [l,f]=k.split('\u001f'); if(!(l in fullOf)) fullOf[l]=f; });
  const fullSold={}; [...cSold.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k])=>{ const [c,l,f]=k.split('\u001f'); const kk=c+'\u001f'+l; if(!(kk in fullSold)) fullSold[kk]=f; });
  // the last complete month: the last shipment day's month when that day is within 3 days of the month end
  const last=hist.dateMax; const [ly,lm,ld]=last.split('-').map(Number); const lastM=new Date(ly,lm,0).getDate()-ld<=3?last.slice(0,7):_plYmShift(last.slice(0,7),-1); const firstM=_plYmShift(lastM,-(P.months-1));
  const recentFrom=_plYmShift(lastM,-(P.recentM-1));
  const sub=(l,ds)=>{ const u=l.toUpperCase(); const x=(subs||[]).find(z=>z.from===u&&(!z.until||ds<=z.until)); return x?x.to:l; };
  const g=new Map();      // sold-to × family → month → point → tonnes
  hist.rows.forEach(([code,full,ds,q])=>{ const ym=ds.slice(0,7); if(ym<firstM||ym>lastM) return; const k=code+'\u001f'+_plMixFam(full), dp=sub(_plDpLabel(full), ds);
    let o=g.get(k); if(!o){ o=new Map(); g.set(k,o); } let mm=o.get(ym); if(!mm){ mm=new Map(); o.set(ym,mm); } mm.set(dp,(mm.get(dp)||0)+q); });
  const mix=new Map();
  g.forEach((byM,k)=>{ const [code,fam]=k.split('\u001f');
    const months=[]; [...byM.keys()].sort().forEach(ym=>{ const mm=byM.get(ym); const tot=[...mm.values()].reduce((a,b)=>a+b,0); if(tot<P.minT) return;
      const combo=[...mm.entries()].filter(([,q])=>q/tot>=P.minShare).map(([d])=>d).sort(); months.push({ym, mm, tot, key:combo.join('\u0002'), combo}); });
    if(!months.length) return;
    const cnt=new Map(); let W=0;
    months.forEach(m=>{ const w=m.ym>=recentFrom?P.recentW:1; const c=cnt.get(m.key)||{combo:m.combo, key:m.key, n:0, w:0, t:0}; c.n++; c.w+=w; c.t+=m.tot; cnt.set(m.key,c); W+=w; });
    const ranked=[...cnt.values()].sort((a,b)=>(b.w-a.w)||(b.t-a.t)); const top=ranked[0], second=ranked[1]?ranked[1].w:0;
    const N=months.length, freq=top.w/W, lead=freq-second/W;
    const pooled={}; months.forEach(m=>{ if(m.key!==top.key) return; top.combo.forEach(d=>{ pooled[d]=(pooled[d]||0)+(m.mm.get(d)||0); }); });
    const ps=Object.values(pooled).reduce((a,b)=>a+b,0); const shares={}; Object.keys(pooled).forEach(d=>{ shares[d]=pooled[d]/ps; });
    const rec={}; let rt=0; months.forEach(m=>{ if(m.ym<recentFrom) return; m.mm.forEach((q,d)=>{ rec[d]=(rec[d]||0)+q; rt+=q; }); }); Object.keys(rec).forEach(d=>{ rec[d]=rt?rec[d]/rt:0; });
    mix.set(k,{code, fam, name:hist.names[code]||'', read:N<4?'Thin data':freq>=.6?'Stable':(freq>=.4&&lead>=.1)?'Likely':'Mixed', n:top.n, N, shares, recent:rec});
  });
  return {mix, fullOf, fullSold, lastM, firstM};
}
function _plPlantMap(s){ const o={}; String(s.plant_map||'').split(/[,;\n]+/).forEach(p=>{ const m=p.match(/(\d+)\s*[=→>:\-]+\s*(\d+)/); if(m) o[m[1]]=m[2]; }); return o; }
// Each RMX plant × family → its points, by the plant's mix. A plant with no internal shipments in the window is left as one row to place by hand.
function plSplitInternal(rmx, hist, subs, s){
  const M=plMixCompute(hist, subs, s), map=_plPlantMap(s); const rows=[], watch=[], notAlloc=[];
  const full=(code,dp)=>M.fullSold[code+'\u001f'+dp]||M.fullOf[dp]||dp;
  rmx.rows.forEach(b=>{ const code=map[b.plant]||b.plant; const m=M.mix.get(code+'\u001f'+b.fam); const base={rmx_plant:b.plant, rmx_name:b.pname, district:b.district};
    if(!m){ notAlloc.push(b); rows.push({dp:`? ${b.pname} (plant ${b.plant}) · ${PL_FAM_OF_CODE[b.fam]}`, fam:b.fam, months:b.months.slice(), key:['INT',b.plant,b.fam,'?'].join('|'),
      why:`no internal shipments for this plant and family in ${M.firstM} → ${M.lastM}: pick the demand point, or Skip`, ext:base}); return; }
    Object.entries(m.shares).sort((a,b)=>b[1]-a[1]).forEach(([dp,sh])=>{ const f=full(code,dp);
      rows.push({dp:f, fam:b.fam, months:b.months.map(x=>x*sh), key:['INT',b.plant,b.fam,f].join('|'), ext:{...base, sold_to:code, sold_to_name:m.name, share:Math.round(sh*10000)/10000, mix_read:m.read, mix_months:m.n+' of '+m.N}});
      if(Math.abs((m.recent[dp]||0)-sh)>=0.2) watch.push({plant:b.pname, fam:b.fam, dp:f, share:sh, recent:m.recent[dp]||0, t:b.fy}); });
    Object.entries(m.recent).forEach(([dp,r])=>{ if(r>=0.2&&!(dp in m.shares)) watch.push({plant:b.pname, fam:b.fam, dp:full(code,dp), share:0, recent:r, t:b.fy}); });   // a point ramping up outside the mix
  });
  return {rows, notAlloc, watch:watch.sort((a,b)=>Math.abs(b.recent-b.share)*b.t-Math.abs(a.recent-a.share)*a.t), firstM:M.firstM, lastM:M.lastM, mixes:M.mix.size};
}
// ═══ Load budget demand: every file staged here lands in ONE version ═══
// • Build the budget: the internal RMX workbook (split above) + the External (FL) workbook (each customer row → its demand point by Demand Mapping)
// • optional extra tables: any sheet with a "Demand point" column and month columns (Jan…Dec, or 2027-01…), optional "Family" (CEM / SLG / ASH):
//   the master file of an earlier version, or the template filled by hand.
PL.load={files:[], unit:1, alias:{}, view:null, inp:{}};
const PL_HIST_KEY='planHistory', PL_SUBS_KEY='planSubstitutions';
function plLoadInput(kind, inp){ const f=(inp.files||[])[0]; inp.value=''; if(!f) return; f.arrayBuffer().then(buf=>{ PL.load.inp[kind]={name:f.name, buf}; planRender(); }); }
function _plHandlesEnsure(){ if(PL._hTried) return; PL._hTried=true; Promise.all([dsLoadHandle(PL_HIST_KEY), dsLoadHandle(PL_SUBS_KEY)]).then(([h,s])=>{ PL._h={hist:h, subs:s}; planRender(); }).catch(()=>{ PL._h={}; }); }
// The shipment history and the substitutions file are picked once and remembered (read again on every Build).
async function plPickRemembered(kind){
  if(!window.showOpenFilePicker){ statMsg('This browser cannot remember a file: use Chrome or Edge'); return; }
  let h; try{ [h]=await window.showOpenFilePicker({id:'avila-budget-'+kind, types:[{description:'Excel workbook', accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx','.xlsm']}}]}); }catch(e){ return; }
  await dsSaveHandle(kind==='subs'?PL_SUBS_KEY:PL_HIST_KEY, h); PL._h=PL._h||{}; PL._h[kind]=h; planRender(); statMsg((kind==='subs'?'Substitutions':'Shipment history')+' file set: '+h.name);
}
async function plBuildBudget(){
  const I=PL.load.inp, H=PL._h||{}; if(!I.int&&!I.ext){ statMsg('Choose the internal and/or the external budget file first'); return; }
  if(I.int&&!H.hist){ statMsg('Set the shipment history file first (Avila_Shipments_Detail.xlsx): the internal split reads it'); return; }
  // both permissions are asked together, inside the click
  const perms=await Promise.all([H.hist,H.subs].map(h=>h?h.queryPermission({mode:'read'}).then(p=>p==='granted'?p:h.requestPermission({mode:'read'})).catch(()=>'denied'):null));
  if(I.int&&perms[0]!=='granted'){ statMsg('Allow reading the shipment history file to split the internal budget'); return; }
  PL.busy=true; planRender(); statMsg('Building the budget…');
  try{
    await loadLib('xlsx'); const s=plSettings(); const staged=[]; const msg=[];
    if(I.ext){ const ext=_plExtParse(I.ext.buf, I.ext.name); const x=_plExtToRows(ext); staged.push({name:I.ext.name, sheet:ext.sheet, kind:'EXT', rows:x.rows, left:x.left, skipped:ext.skipped}); msg.push('external '+_plFmt(ext.fy)+' ST'); }
    if(I.int){
      const rmx=_plRmxParse(I.int.buf, I.int.name);
      const f=await H.hist.getFile(); let hist=null;
      try{ const c=await dsLoadHandle('planHistory:index'); if(c&&c.v===1&&c.mod===f.lastModified&&c.size===f.size) hist=c; }catch(e){}
      if(!hist){ hist=_plHistParse(await f.arrayBuffer(), f.name); Object.assign(hist,{v:1, mod:f.lastModified, size:f.size}); try{ await dsSaveHandle('planHistory:index', hist); }catch(e){} }
      let subs=[]; if(H.subs&&perms[1]==='granted'){ try{ subs=_plSubsParse(await (await H.subs.getFile()).arrayBuffer()); }catch(e){ console.warn('substitutions', e); } }
      const sp=plSplitInternal(rmx, hist, subs, s);
      staged.push({name:I.int.name, sheet:Object.values(rmx.perFam).map(x=>x.sheet).join(', '), kind:'INT', rows:sp.rows, left:[], skipped:0,
        info:{perFam:rmx.perFam, fy:rmx.fy, warnings:rmx.warnings, window:sp.firstM+' → '+sp.lastM, mixes:sp.mixes, notAlloc:sp.notAlloc.length, notAllocT:Math.round(sp.notAlloc.reduce((a,b)=>a+b.fy,0)),
          watch:sp.watch, hist:`${hist.file} (${hist.dateMin} → ${hist.dateMax})`, subs:subs.length}});
      msg.push('internal '+_plFmt(rmx.fy)+' ST');
    }
    PL.load.files=PL.load.files.filter(f=>f.kind==='FILE').concat(staged);   // a new Build replaces the previous one; extra tables stay
    statMsg('Budget built: '+msg.join(' + ')+'. Check the rows below, then load it.');
  }catch(e){ statMsg('Build failed: '+e.message); console.warn(e); }
  PL.busy=false; planRender();
}
const PL_FAM_OF_CODE={CEM:'cement', CEMENT:'cement', SLG:'slag', SLAG:'slag', ASH:'ash', FA:'ash', FLYASH:'ash', 'FLY ASH':'ash'};
const PL_CODE_OF_FAM={cement:'CEM', slag:'SLG', ash:'ASH', other:'OTH'};
function _plLoadParse(buf, name){
  const year=plSettings().budget_year;
  const wb=XLSX.read(buf,{type:'array',dense:true});
  if(wb.SheetNames.some(n=>/^external\s*\(\s*fl\s*\)$/i.test(n.trim()))){ const ext=_plExtParse(buf, name); const x=_plExtToRows(ext); return {name, sheet:ext.sheet, kind:'EXT', rows:x.rows, left:x.left, skipped:ext.skipped}; }
  const rank=n=>/dp monthly/i.test(n)?0:/demand point|budget|demand/i.test(n)?1:2;
  const order=[...wb.SheetNames].sort((a,b)=>rank(a)-rank(b));
  for(const sn of order){
    const aoa=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:true,defval:''});
    const h0=aoa.findIndex((r,i)=>i<30&&r.some(c=>/^(demand\s*point|demand point name|dp|point)$/i.test(_plStr(c))));
    if(h0<0) continue;
    const hdr=aoa[h0], hl=_plHdrIndex(hdr);
    const iDp=_plPick(hl,'demand point','demand point name','dp','point'); const iFam=_plPick(hl,'family','product family','fam');
    const mcols=_plMonthCols(hdr, year); const rows=[]; let skipped=0;
    if(mcols.length){
      aoa.slice(h0+1).forEach(r=>{ const dp=_plStr(r[iDp]); if(!dp||/^total\b/i.test(dp)) return;
        const months=new Array(12).fill(0); let any=false; mcols.forEach(c=>{ const v=_plNum(r[c.i]); if(v){ months[c.m-1]+=v; any=true; } });
        if(!any){ skipped++; return; } rows.push({dp, fam:_plStr(iFam>=0?r[iFam]:''), months}); });
    } else {
      const iM=_plPick(hl,'month','period','ym','date'); const iV=_plPick(hl,'tons','tonnes','st','short tons','value','budget','budget_t','volume');
      if(iM<0||iV<0) continue;
      const map=new Map();
      aoa.slice(h0+1).forEach(r=>{ const dp=_plStr(r[iDp]); if(!dp||/^total\b/i.test(dp)) return; const pm=_fbParseMonthHeader(r[iM], year); const v=_plNum(r[iV]); if(!pm||!v){ skipped++; return; }
        const fam=iFam>=0?_plStr(r[iFam]):''; const k=dp+'|'+fam; let o=map.get(k); if(!o){ o={dp, fam, months:new Array(12).fill(0)}; map.set(k,o); } o.months[pm.m-1]+=v; });
      map.forEach(o=>rows.push(o));
    }
    if(rows.length) return {name, sheet:sn, kind:'FILE', rows, skipped};
  }
  throw new Error('no "External (FL)" sheet and no sheet with a "Demand point" column and month columns in '+name);
}
// External (FL) rows → demand points through Demand Mapping (ship point + material + sold-to). The sheet is cement only.
// Adjustment rows (ADJ plant / material, no customer) are left out; a row that lands on a purchased point must be moved to one of ours.
function _plExtToRows(ext){
  const rows=[], left=[];
  ext.lines.forEach(l=>{
    if(l.adjustment){ left.push({label:_plLineLabel(l), fy:l.fy, why:'adjustment row (no customer)'}); return; }
    const t=plTranslateLine(l); const whole=!!t.dp_name&&t.dp_name.split('/').length>=5&&t.dp_name.split('/').every(Boolean);   // a name with a missing part is no name
    const el=whole?xlmapFindDp(t.dp_name):null; const purchased=!!(el&&plIsPurchasedDp(el));
    rows.push({dp:whole?t.dp_name:('? '+_plLineLabel(l)), fam:'CEM', months:l.months.slice(), key:l.line_key, purchased,
      why:!whole?((t.missing||[])[0]||'not translated')+' (fix it in Configuration → Demand Mapping, or pick the point)':purchased?'purchased point: the budget goes on one of ours':el?'':'Demand Mapping names it, but this scenario has no such demand point',
      ext:{sold_to:l.sold_to, sold_to_name:l.sold_to_name, ship_to:l.ship_to, ship_to_name:l.ship_to_name, plant:l.plant, plant_name:l.plant_name, material:l.material, material_desc:l.material_desc, incoterm:l.incoterm, src_row:l.src_row}});
  });
  return {rows, left};
}
function plLoadFiles(inp){
  const files=[...(inp.files||[])]; inp.value=''; if(!files.length) return;
  (async()=>{ try{ await loadLib('xlsx');
      for(const f of files){ const st=_plLoadParse(await f.arrayBuffer(), f.name); PL.load.files=PL.load.files.filter(x=>x.name!==st.name); PL.load.files.push(st); }
      planRender(); statMsg(`${files.length} file(s) staged — check the preview, then load`);
    }catch(e){ statMsg('Could not read the file — '+e.message); console.warn(e); } })();
}
function plLoadRemove(i){ PL.load.files.splice(i,1); planRender(); }
function plLoadUnit(v){ PL.load.unit=+v||1; planRender(); }
function _plSuggestDp(name){
  const tok=s=>new Set(String(s).toUpperCase().split(/[\/_\s()\-]+/).filter(Boolean)); const t=tok(name); const out=[];
  (DB.elements||[]).forEach(e=>{ if(e.type!=='demand_point') return; const u=tok(e.name); let i=0; t.forEach(x=>{ if(u.has(x)) i++; }); const sc=i/Math.max(t.size,u.size,1); if(sc>=.5) out.push({name:e.name, sc}); });
  return out.sort((a,b)=>b.sc-a.sc).slice(0,3);
}
// Staged rows → one line per demand point and family (the same point in two files adds up).
function _plLoadResolve(){
  const L=PL.load, map=new Map(), unm=new Map(), left=[];
  L.files.forEach(f=>{ const unit=f.kind==='FILE'?(+L.unit||1):1;   // the built rows are already in short tons
    (f.left||[]).forEach(x=>left.push({...x, file:f.name}));
    f.rows.forEach(r=>{
      const alias=L.alias[r.dp]; const dpName=alias||r.dp; const el=(r.purchased&&!alias)?null:xlmapFindDp(dpName);
      const fam=PL_FAM_OF_CODE[String(r.fam||'').toUpperCase()]||plFamilyOfName(dpName);
      const key=r.key?f.kind+'|'+r.key:(el?el.id:_xlNorm(dpName))+'|'+fam;   // built rows stay one line each (customer / plant detail)
      let o=map.get(key); if(!o){ o={dp_name:el?el.name:dpName, element_id:el?el.id:null, family:fam, src:f.kind||'FILE', file:f.name, ext:r.ext||null,
        line_key:r.key?f.kind+'|'+r.key:'LOAD|'+fam+'|'+_xlNorm(el?el.name:dpName), months:new Array(12).fill(0)}; map.set(key,o); }
      r.months.forEach((v,m)=>{ o.months[m]+=v*unit; });
      if(!el){ const u=unm.get(r.dp)||{dp:r.dp, fy:0, fam, why:r.why||'not a demand point of this scenario', n:0, purchased:!!r.purchased}; u.fy+=r.months.reduce((a,b)=>a+b,0)*unit; u.n++; unm.set(r.dp,u); } });
  });
  const lines=[...map.values()].map(o=>{ const months=o.months.map(x=>Math.round(x*100)/100); return {...o, months, fy:Math.round(months.reduce((a,b)=>a+b,0)*100)/100}; }).filter(o=>o.fy!==0);
  const unmatched=[...unm.values()].filter(u=>Math.abs(u.fy)>=0.5).sort((a,b)=>b.fy-a.fy).map(u=>{ const named=!u.dp.startsWith('? ')&&!u.purchased; const src=u.dp.split('/')[0];
    return {...u, sugg:named?_plSuggestDp(u.dp):[], fac:named?_plFacByName(src):null, pid:named?(_plProductByToken(u.dp.split('/')[2]||'')?.id||null):null, canCreate:named}; });
  return {lines, unmatched, left};
}
function plLoadPick(i, name){ const u=PL.load.view&&PL.load.view.unmatched[i]; if(!u||!name) return; PL.load.alias[u.dp]=name; planRender(); }
function plLoadAlias(i,j){ const u=PL.load.view&&PL.load.view.unmatched[i]; if(!u||!u.sugg[j]) return; PL.load.alias[u.dp]=u.sugg[j].name; planRender(); }
function plLoadCreate(i){
  const u=PL.load.view&&PL.load.view.unmatched[i]; if(!u||!u.canCreate) return; let fac=u.fac;
  if(!fac){ const src=u.dp.split('/')[0]; plCreateAshFacility(src.toUpperCase()); fac=_plFacByName(src); if(fac&&u.fam==='slag') fac.name=src+'/SLG'; else if(fac&&u.fam==='cement') fac.name=src+'/CEM'; }   // a source we do not have yet = purchased supply (power-plant ash, bought slag)
  if(!fac){ statMsg('Could not create the facility '+u.dp.split('/')[0]); return; }
  plCreateDp(fac.id, u.dp, u.pid);
}
function plLoadExclude(i){ const u=PL.load.view&&PL.load.view.unmatched[i]; if(!u) return; PL.load.files.forEach(f=>{ f.rows=f.rows.filter(r=>r.dp!==u.dp); }); planRender(); }
function plLoadApply(){
  const res=_plLoadResolve(); if(!res.lines.length){ statMsg('Nothing to load'); return; }
  const s=plSettings(), g=id=>document.getElementById(id);
  const label=(g('plq-label')?.value||'').trim()||('Budget '+s.budget_year+' · '+new Date().toISOString().slice(0,10));
  s.sat_pct=Math.max(0,Math.min(100,parseFloat(g('plq-sat')?.value)||0)); s.ships_sat=!!g('plq-ships-sat')?.checked;
  const makeActive=g('plq-active')?!!g('plq-active').checked:true;
  const unT=res.unmatched.reduce((a,u)=>a+u.fy,0);
  if(res.unmatched.length&&!confirm(`${res.unmatched.length} name(s) (${_plFmt(unT)} ST) are not placed on a demand point of this scenario. They stay in the version as unallocated (Regenerate picks them up once the point exists).\n\nLoad anyway?`)) return;
  const id='pv_'+Date.now().toString(36), now=new Date().toISOString();
  if(makeActive) plVersions().forEach(v=>{ if(v.status==='active') v.status='draft'; });
  const fileT=f=>Math.round(f.rows.reduce((a,r)=>a+r.months.reduce((x,y)=>x+y,0),0)*(f.kind==='FILE'?(+PL.load.unit||1):1));
  const v={id, kind:'budget', source:'load', year:s.budget_year, label, status:(makeActive||!plActiveVersion())?'active':'draft', uploaded_at:now, uploaded_by:_plWho(),
    source_files:PL.load.files.map(f=>({slot:({EXT:'external', INT:'internal'})[f.kind]||'table', name:f.name, sheet:f.sheet, rows:f.rows.length, fy_t:fileT(f)})),
    left_out:res.left.map(x=>({label:x.label, why:x.why, fy:Math.round(x.fy*10)/10, file:x.file})), note:'', generated_at:null, generated_hash:null, stale:false};
  plVersions().push(v); if(!Array.isArray(DB.plan_lines)) DB.plan_lines=[];
  res.lines.forEach((l,k)=>DB.plan_lines.push({id:`pl_${id}_${k+1}`, version_id:id, kind:'LOAD', src:l.src, file:l.file, line_key:l.line_key, family:l.family, dp_name:l.dp_name, element_id:l.element_id, months:l.months, fy:l.fy, ...(l.ext||{})}));
  PL.load.files=[]; PL.load.alias={}; PL.load.view=null; PL.load.inp={};
  const rep=plGenerate(id);
  autoSave(); planRender();
  statMsg(`Budget "${label}" loaded: ${res.lines.length} lines, ${_plFmt(rep?rep.spread_t:0)} ST${rep&&rep.unallocated_t?' · '+_plFmt(rep.unallocated_t)+' ST unallocated':''} — saving the master file…`);
  plSaveMaster(id).catch(e=>console.warn('master file', e));
}
async function plLoadTemplate(){
  await loadLib('xlsx'); const y=plSettings().budget_year; const wb=_plMasterWorkbook(null);
  XLSX.writeFile(wb, `Budget_${y}_demand_template.xlsx`, {compression:true}); statMsg('Template saved — every demand point of this scenario × 12 months, in short tons');
}
// ── Master file of a version: EVERY demand point of the topology (budgeted or not) × month, in short tons. Same layout the Load card
// reads, so it can be edited in Excel and loaded back as the next version. Plus the source lines, what was left out, and the version.
const PL_FAM_ORDER={cement:0, slag:1, ash:2, other:3};
function _plMasterWorkbook(vid){
  const s=plSettings(), y=s.budget_year, v=vid?plVersions().find(x=>x.id===vid):null, L=v?plVersionLines(vid):[];
  const facName=el=>{ const f=(DB.facilities||[]).find(x=>x.id===(el.assigned_facility_id||el.facility_id)); return f?f.name:''; };
  const byEl=new Map(), loose=new Map(); const r2=x=>Math.round(x*100)/100;
  L.forEach(l=>{ const el=l.kind==='LOAD'?xlmapFindDp(l.dp_name):null; const m=el?byEl:loose, k=el?el.id:(l.dp_name||_plLineLabel(l));
    const a=m.get(k)||new Array(12).fill(0); (l.months||[]).forEach((x,i)=>{ a[i]+=+x||0; }); m.set(k,a); });
  const dps=(DB.elements||[]).filter(e=>e.type==='demand_point').map(e=>({e, fam:plFamilyOfName(e.name)}))
    .sort((a,b)=>(PL_FAM_ORDER[a.fam]??9)-(PL_FAM_ORDER[b.fam]??9)||a.e.name.localeCompare(b.e.name));
  const aoa=[['Family','Demand point','Facility','Customer type','Active',...PL_MONTHS,'Total']];
  dps.forEach(({e,fam})=>{ const a=byEl.get(e.id)||new Array(12).fill(0); aoa.push([PL_CODE_OF_FAM[fam]||'', e.name, facName(e), e.name.split('/').pop(), e.is_active===false?'N':'Y', ...a.map(r2), null]); });
  loose.forEach((a,name)=>aoa.push([PL_CODE_OF_FAM[plFamilyOfName(name)]||'', name, '(not in the topology)', String(name).split('/').pop(), '', ...a.map(r2), null]));
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  for(let r=2;r<=aoa.length;r++) ws['R'+r]={t:'n', f:`SUM(F${r}:Q${r})`};
  ws['!cols']=[{wch:7},{wch:36},{wch:16},{wch:9},{wch:6},...PL_MONTHS.map(()=>({wch:10})),{wch:12}];
  ws['!autofilter']={ref:`A1:R${aoa.length}`};
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'DP monthly');
  const sheet=(name, rows)=>XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length?rows:[{note:'(none)'}]), name);
  if(!v){
    sheet('How to use', [{step:'1', what:`Type the ${y} budget in short tons per demand point and month on "DP monthly" (Family: CEM / SLG / ASH). Leave the rest at 0.`},
      {step:'2', what:'Configuration → Budget Planning (Planning scenario) → Load budget demand → Choose file(s): this file, alone or with the External (FL) workbook.'},
      {step:'3', what:'Load as budget version: the app spreads each month over its working days, simulates it and saves the master file of the version in the budget folder.'}]);
    return wb;
  }
  const mo=l=>{ const o={}; PL_MONTHS.forEach((m,i)=>{ o[m]=r2(+(l.months||[])[i]||0); }); o.Total=r2(l.fy||0); return o; };
  sheet('Source lines', L.map(l=>({Source:l.kind!=='LOAD'?'Retired process':({EXT:'External (FL)', INT:'Internal (RMX × mix)'})[l.src]||'Demand-point table', File:l.file||'', 'Demand point':l.dp_name||'', Family:PL_CODE_OF_FAM[l.family]||l.family||'',
    'RMX plant':l.rmx_plant||'', 'Plant name':l.rmx_name||'', Share:l.share??'', 'Mix read':l.mix_read||'',
    'Sold-to':l.sold_to||'', 'Sold-to name':l.sold_to_name||'', 'Ship-to':l.ship_to||'', 'Ship-to name':l.ship_to_name||'', Plant:l.plant||'', Material:l.material||'', 'Material description':l.material_desc||'', Incoterms:l.incoterm||'', ...mo(l)})));
  const un=((v.gen_report||{}).unallocated||[]);
  sheet('Left out', [...(v.left_out||[]).map(x=>({What:x.label, Why:x.why, File:x.file||'', 'Total (ST)':x.fy})), ...un.map(u=>({What:u.label, Why:'unallocated: '+u.why, File:'', 'Total (ST)':u.t}))]);
  const st=plVersionStats(v); const r=v.gen_report||{};
  sheet('Version', [{Item:'Version', Value:v.label},{Item:'Budget year', Value:v.year},{Item:'Status', Value:v.status},{Item:'Loaded', Value:String(v.uploaded_at).slice(0,16).replace('T',' ')+' · '+(v.uploaded_by||'')},
    ...(v.source_files||[]).map(f=>({Item:'File', Value:`${f.name} (sheet ${f.sheet}, ${f.rows} rows, ${_plFmt(f.fy_t)} ST)`})),
    {Item:'Total loaded (ST)', Value:Math.round(st.fy)}, ...Object.keys(st.fam).map(f=>({Item:'  '+f+' (ST)', Value:Math.round(st.fam[f])})),
    {Item:'Spread on the days (ST)', Value:r.spread_t??''},{Item:'Unallocated (ST)', Value:r.unallocated_t??''},{Item:'Left out (ST)', Value:Math.round((v.left_out||[]).reduce((a,x)=>a+x.fy,0))},
    {Item:'Units', Value:'short tons'},{Item:'Saved', Value:new Date().toISOString().slice(0,16).replace('T',' ')+' · '+_plWho()}]);
  return wb;
}
// Saves the master file into the budget folder (Budget folder slot: pick …\_New_Roll\Budget once; files go into its "_Budget <year>" folder,
// or straight into the picked folder when it is a "_Budget <year>" folder). No folder (or no Chrome/Edge) → a download.
async function plSaveMaster(vid){
  const v=plVersions().find(x=>x.id===vid); if(!v){ statMsg('No version'); return null; }
  const dir=await exportDir('budget', true);            // first: the folder prompt needs the click's user activation
  await loadLib('xlsx'); const y=v.year||plSettings().budget_year;
  const wb=_plMasterWorkbook(vid); const fname=`Budget ${y} master - ${String(v.label).replace(/[\\/:*?"<>|]+/g,'-').trim()}.xlsx`;
  if(!dir){ XLSX.writeFile(wb, fname, {compression:true}); statMsg('Master file downloaded — '+fname+' (set the Budget folder in the Versions card to save it there)'); return {downloaded:fname}; }
  const sub=/^_?budget\s*\d{4}$/i.test(dir.name)?dir:await dir.getDirectoryHandle('_Budget '+y, {create:true});
  const fh=await sub.getFileHandle(fname, {create:true}); const w=await fh.createWritable();
  await w.write(XLSX.write(wb,{type:'array', bookType:'xlsx', compression:true})); await w.close();
  v.master_file={name:fname, folder:dir.name+(sub===dir?'':'/'+sub.name), at:new Date().toISOString()}; autoSave(); planRender();
  statMsg(`Master file saved — ${v.master_file.folder}/${fname}`); return v.master_file;
}
function _plLoadCardHTML(s){
  _plHandlesEnsure(); const L=PL.load, res=_plLoadResolve(); L.view=res; const y=s.budget_year; const H=PL._h||{}, I=L.inp||{};
  const fT=f=>f.rows.reduce((a,r)=>a+r.months.reduce((x,z)=>x+z,0),0)*(f.kind==='FILE'?(+L.unit||1):1);
  const kindTxt={EXT:'External (FL) · translated by Demand Mapping', INT:'Internal · RMX × each plant\'s mix', FILE:'demand point table'};
  const files=L.files.map((f,i)=>`<tr><td><b>${_plEsc(f.name)}</b> <span class="pl-muted">sheet ${_plEsc(f.sheet)}</span> <span class="pl-flag dim">${kindTxt[f.kind]||''}</span></td><td class="n">${f.rows.length} rows${f.left&&f.left.length?` · ${f.left.length} left out`:''}</td><td class="n">${_plFmt(fT(f))} ST</td><td><button class="pl-btn" onclick="plLoadRemove(${i})">Remove</button></td></tr>`).join('');
  const fam={}, mon=new Array(12).fill(0); res.lines.forEach(l=>{ fam[l.family]=(fam[l.family]||0)+l.fy; l.months.forEach((x,m)=>{ mon[m]+=x; }); });
  const matched=res.lines.filter(l=>l.element_id); const curF=(()=>{ const ids=new Set(matched.map(l=>l.element_id)); let t=0; (DB.demand_values||[]).forEach(r=>{ if(r.source!=='actual'&&r.source!=='budget'&&ids.has(r.element_id)&&String(r.date).startsWith(String(y))) t+=r.value_t||0; }); return t; })();
  const unm=res.unmatched.slice(0,60).map((u,i)=>`<tr><td><b>${_plEsc(u.dp)}</b>${u.n>1?` <span class="pl-muted">${u.n} rows</span>`:''}${u.why?`<br><span class="pl-muted">${_plEsc(u.why)}</span>`:''}</td><td class="n">${_plFmt(u.fy)}</td>
      <td>${u.sugg.map((x,j)=>`<button class="pl-btn" onclick="plLoadAlias(${i},${j})" title="use this point">${_plEsc(_plDpShort(x.name))}</button>`).join(' ')}
        <select class="fi" style="width:200px;padding:2px 4px;font-size:10px;display:inline-block" onchange="plLoadPick(${i},this.value)"><option value="">use another point…</option>${_plDpOptions('', u.fam)}</select>
        ${u.canCreate?`<button class="pl-btn" onclick="plLoadCreate(${i})">${u.fac?'Create point at '+_plEsc(u.fac.name):'Create '+_plEsc(u.dp.split('/')[0])+' (purchased) + point'}</button>`:''}
        <button class="pl-btn" onclick="plLoadExclude(${i})">Skip</button></td></tr>`).join('');
  const left=res.left, leftT=left.reduce((a,x)=>a+x.fy,0);
  const intF=L.files.find(f=>f.kind==='INT'), info=intF&&intF.info;
  const watch=info&&info.watch&&info.watch.length?`<details style="display:inline-block"><summary class="pl-muted" style="cursor:pointer">${info.watch.length} on the watch list</summary><div class="pl-muted" style="margin:4px 0">Points whose last ${s.mix_recent_months} months differ 20+ points from the mix used (a point being phased in or out). Keep the mix, or move the volume on the master file and load it again.</div><table class="pl-tbl"><tr><th>Plant</th><th>Family</th><th>Demand point</th><th>Mix used</th><th>Last months</th><th>Budget ST of the plant</th></tr>${info.watch.slice(0,40).map(w=>`<tr><td>${_plEsc(w.plant)}</td><td>${w.fam}</td><td>${_plEsc(_plDpShort(w.dp))}</td><td class="n">${Math.round(w.share*100)}%</td><td class="n">${Math.round(w.recent*100)}%</td><td class="n">${_plFmt(w.t)}</td></tr>`).join('')}</table></details>`:'';
  const act=plActiveVersion();
  const pick=(kind, label, hint)=>`<b>${label}</b><span><label class="pl-btn" style="cursor:pointer">${I[kind]?'Change…':'Choose…'}<input type="file" accept=".xlsx,.xls,.xlsm" style="display:none" onchange="plLoadInput('${kind}',this)"></label> ${I[kind]?`<b>${_plEsc(I[kind].name)}</b>`:`<span class="pl-muted">${hint}</span>`}</span>`;
  const rem=(kind, label, hint)=>`<b>${label}</b><span>${H[kind]?`📄 <b>${_plEsc(H[kind].name)}</b> <span class="pl-muted">(remembered)</span>`:`<span class="pl-muted">${hint}</span>`} <button class="pl-btn" onclick="plPickRemembered('${kind}')">${H[kind]?'Change…':'Set…'}</button></span>`;
  return _plCard('pl-load','Load budget demand','internal + external budget → one version', L.files.length||null,
    `<div class="pl-kv">
       ${pick('int','1 · Internal budget','the RMX workbook (US RMX Cement_Slag_FA Demand Budget …xlsx: sheets Cem_Use / Slag_Use / FA_Use, thousand ST)')}
       ${pick('ext','2 · External budget','the volume budget workbook with the "External (FL)" sheet (2027 Volume Budget …xlsx, ST)')}
       ${rem('hist','Shipment history','Avila_Shipments_Detail.xlsx in _New_Roll\\RealValues: the internal split reads each plant\'s last months of shipments')}
       ${rem('subs','Substitutions (optional)','Avila_Mix_Substitutions.xlsx in _New_Roll\\PowerBI: points that replaced others in the history')}
     </div>
     <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
       <button class="pl-btn pri" onclick="plBuildBudget()" ${(I.int||I.ext)&&!PL.busy?'':'disabled'}>${PL.busy?'Building…':'Build the budget'}</button>
       <span class="pl-muted">internal: each plant's cement / slag / fly ash goes to the points that supplied it (its most common mix over the last ${s.mix_months} complete months) · external: each customer row goes to its point through Demand Mapping (ADJ rows left out) · cement never goes on a purchased point</span>
     </div>
     <details style="margin-top:6px"><summary class="pl-muted" style="cursor:pointer">Add a ready demand point table (the master file of an earlier version, or the template filled by hand)</summary>
       <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
         <label class="pl-btn" style="cursor:pointer">Choose table(s)…<input type="file" accept=".xlsx,.xls,.xlsm,.csv" multiple style="display:none" onchange="plLoadFiles(this)"></label>
         <button class="pl-btn" onclick="plLoadTemplate()">Download template</button>
         <label class="pl-muted">in <select class="fi" style="width:140px;display:inline-block" onchange="plLoadUnit(this.value)"><option value="1" ${(+L.unit||1)===1?'selected':''}>short tons</option><option value="1000" ${+L.unit===1000?'selected':''}>thousand short tons</option></select></label></div></details>
     ${act?`<div class="pl-muted" style="margin-top:6px">active version: <b>${_plEsc(act.label)}</b>${act.generated_at?'':' (not generated)'}</div>`:''}
     ${L.files.length?`<table class="pl-tbl" style="margin-top:8px"><tr><th>Built from</th><th>Rows</th><th>Total</th><th></th></tr>${files}</table>
     <div class="pl-kv" style="margin-top:8px"><b>Budget ${y}</b><span><b>${_plFmt(res.lines.reduce((a,l)=>a+l.fy,0))}</b> ST on ${new Set(res.lines.map(l=>l.element_id||l.dp_name)).size} demand points · ${Object.keys(fam).map(f=>f+' '+_plFmt(fam[f])).join(' · ')}</span>
       <b>By month</b><span>${mon.map((x,m)=>PL_MONTHS[m]+' '+_plFmt(x/1000,1)+'k').join(' · ')}</span>
       ${info?`<b>Internal split</b><span>${Object.keys(info.perFam).map(f=>`${f} ${info.perFam[f].plants} plants · ${_plFmt(info.perFam[f].fy)} ST`).join(' · ')} · mix of ${info.mixes} sold-to × family groups, ${info.window} · ${_plEsc(info.hist)}${info.subs?' · '+info.subs+' substitutions':''}${info.notAlloc?` · <span class="pl-flag bad">${info.notAlloc} plants with no history (${_plFmt(info.notAllocT)} ST): place them below</span>`:''} ${watch}${info.warnings&&info.warnings.length?'<br>⚠ '+info.warnings.map(_plEsc).join('<br>⚠ '):''}</span>`:''}
       <b>Forecast now</b><span>${curF?_plFmt(curF)+' ST in '+y+' for the matched points (replaced by the budget)':'<span class="pl-muted">no forecast for these points in '+y+'</span>'}</span>
       ${left.length?`<b>Left out</b><span>${left.length} rows · ${_plFmt(leftT)} ST <details style="display:inline-block"><summary class="pl-muted" style="cursor:pointer">show</summary><table class="pl-tbl">${left.slice(0,80).map(x=>`<tr><td>${_plEsc(x.label)}</td><td class="pl-muted">${_plEsc(x.why)}</td><td class="n">${_plFmt(x.fy)}</td></tr>`).join('')}</table></details></span>`:''}</div>
     ${res.unmatched.length?`<div style="margin-top:8px"><span class="pl-flag bad">${res.unmatched.length} not placed on a demand point of this scenario · ${_plFmt(res.unmatched.reduce((a,u)=>a+u.fy,0))} ST</span><div style="max-height:260px;overflow:auto;border:1px solid var(--border);margin-top:4px"><table class="pl-tbl"><tr><th>Name / row</th><th>ST</th><th>Use…</th></tr>${unm}</table></div></div>`:'<div style="margin-top:8px"><span class="pl-flag ok">every row is on a demand point of this scenario</span></div>'}
     <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">
       <input class="fi" id="plq-label" placeholder="version label" value="Budget ${y} · ${new Date().toISOString().slice(0,10)}" style="width:230px">
       <label class="pl-muted">Saturday % <input class="fi" type="number" id="plq-sat" value="${s.sat_pct}" min="0" max="100" style="width:64px;display:inline-block"></label>
       <label class="pl-muted"><input type="checkbox" id="plq-ships-sat" ${s.ships_sat?'checked':''}> ships on Saturdays</label>
       <label class="pl-muted"><input type="checkbox" id="plq-active" checked> make it the active version</label>
       <button class="pl-btn pri" onclick="plLoadApply()">Load as budget version, simulate & save the master file</button></div>`:''}`);
}
// ── From the trend scenario: topology + 31 Dec closing state in one step, with a stale badge ──
// ═══ Yield sensitivity (Planning) ═══════════════════════════════════════════════════
// The budget simulation runs the kilns, mills and packers at their configured (rated) t/d. For the Budget dashboard
// the Push to BI of a Planning scenario adds two more runs: every unit at its AVERAGE YIELD — the mean t/d on the
// days it made that product, from the trend's recorded production — and that yield times AVAILABILITY — the share
// of recorded days the unit ran at all. The yields are computed when the budget is updated from the trend
// (plComputeYields -> plan_yields); a unit x product with fewer than PL_YIELD_MIN_DAYS days of history keeps its rated t/d.
const PL_YIELD_MIN_DAYS=5;
function plComputeYields(trendDB, srcName){
  const rp=(trendDB&&trendDB.real_production_daily)||[]; if(!rp.length) return 0;
  const byEP={}, dates={}, pos={}; let from='9999-99-99', to='';
  rp.forEach(r=>{
    const v=parseFloat(r.volume_t)||0; if(!r.date||!r.element_id) return;
    if(r.date<from) from=r.date; if(r.date>to) to=r.date;
    (dates[r.element_id]=dates[r.element_id]||new Set()).add(r.date);
    if(v<=0) return;
    (pos[r.element_id]=pos[r.element_id]||new Set()).add(r.date);
    if(r.product_id){ const a=byEP[r.element_id+'|'+r.product_id]=byEP[r.element_id+'|'+r.product_id]||{}; a[r.date]=v; } // one value per day (a later row for the same day replaces)
  });
  const now=new Date().toISOString(); const rows=[];
  (DB.element_product_capacities||[]).forEach(c=>{
    if(c.packing_input_id) return; // packer inputs are consumption, not capacity
    const a=byEP[c.element_id+'|'+c.product_id]||{}; const days=Object.keys(a).length, tt=Object.values(a).reduce((s,v)=>s+v,0);
    const nd=(dates[c.element_id]||new Set()).size, np=(pos[c.element_id]||new Set()).size;
    const rated=parseFloat(c.capacity_tpd)||0, y=days?Math.round(tt/days):null, avail=nd?Math.round(np/nd*1000)/1000:null;
    const useY=y!=null&&days>=PL_YIELD_MIN_DAYS; const caseA=useY?y:rated;
    rows.push({element_id:c.element_id, product_id:c.product_id, rated_tpd:rated, hist_days:days, hist_t:Math.round(tt), yield_tpd:y,
      yield_pct:(useY&&rated)?Math.round(1000*y/rated)/10:null, elem_days_recorded:nd, elem_days_running:np, availability:avail,
      yield_case_tpd:caseA, yield_avail_case_tpd:Math.round(caseA*(avail==null?1:avail)),
      basis:useY?'history':(y==null?'no history, rated kept':'only '+days+' d of history, rated kept'),
      src_name:srcName||'', src_from:from, src_to:to, computed_at:now});
  });
  DB.plan_yields=rows; return rows.length;
}
function _plYieldsSummary(){
  const y=DB.plan_yields||[]; if(!y.length) return '<span class="pl-muted">not computed yet — Update from the trend computes them (needed for the sensitivity runs in Push to BI)</span>';
  const h=y.filter(r=>r.basis==='history'); const avg=h.length?Math.round(h.reduce((s,r)=>s+(r.yield_pct||0),0)/h.length):null;
  return `${h.length} of ${y.length} unit·products from ${_plEsc(y[0].src_name||'the trend')} (${y[0].src_from} to ${y[0].src_to})${avg!=null?' · average yield '+avg+'% of rated':''} <span class="pl-muted">(${String(y[0].computed_at||'').slice(0,16).replace('T',' ')})</span>`;
}
// Capacity table for a case: capacity_tpd replaced by the yields' <field> where a yield row exists.
function _plCaseCaps(field){
  const y={}; (DB.plan_yields||[]).forEach(r=>{ y[r.element_id+'|'+r.product_id]=r; });
  return (DB.element_product_capacities||[]).map(c=>{ const m=y[c.element_id+'|'+c.product_id]; return (m&&m[field]!=null)?{...c, capacity_tpd:m[field]}:{...c}; });
}
// One full simulation (both passes, like runSimulation) with another capacity table; nothing of it stays in DB or S.
function _plRunCase(caps){
  const saveCaps=DB.element_product_capacities, saveV=DB.vessel_calls;
  DB.element_product_capacities=caps; DB.vessel_calls=JSON.parse(JSON.stringify(saveV||[]));
  try{
    _rulesNormalize();
    const els=getFacElements(), cn=getFacConnections(), h=_simEffectiveHorizon();
    if(S.simCfg.autoPropose!==false){ const rb=simulate(els,cn,h,false); rb.simHorizon=h; _writeProposedVesselCalls(rb); }
    else DB.vessel_calls=DB.vessel_calls.filter(v=>v.status!=='Proposed'||!(v.notes||'').startsWith('Auto-proposed'));
    const r=simulate(els,cn,h,true); r.simHorizon=h; return r;
  } finally { DB.element_product_capacities=saveCaps; DB.vessel_calls=saveV; if(typeof _demandCacheInvalidate==='function') _demandCacheInvalidate(); }
}
const PL_CASES=[
  {id:'rated',       name:'Rated capacity',               order:1, field:null,                   note:'kilns, mills and packers at their configured t/d (the budget run itself)'},
  {id:'yield',       name:'Average yield',                order:2, field:'yield_case_tpd',       note:'each unit at its average t/d on the days it made that product (trend history); rated kept where there are fewer than 5 days of history'},
  {id:'yield_avail', name:'Average yield × availability', order:3, field:'yield_avail_case_tpd', note:'the average yield times the share of recorded days the unit ran at all'}];
const PL_CASE_SHEETS=['fact_service','fact_inventory','fact_production','fact_stop_events','fact_vessel_call','fact_rail_sim','fact_silo_transfer','fact_unloading'];
// Planning push: dim_case + dim_yield, and <fact>_cases sheets with the forecast rows of the two yield runs (case = yield | yield_avail).
// The base sheets stay the rated run. Without yields (budget never updated from the trend) the extra sheets are written empty.
async function _plAppendSensitivity(tables, setMsg){
  const base=S.simResults||null; const runId=base?base.runId:'';
  if(!(DB.plan_yields||[]).length && S.simCfg.plan_source_scenario_id){ // yields missing: read the trend if this browser may (no prompt here)
    try{ const pk=await scPeekScenario(S.simCfg.plan_source_scenario_id); if(pk) plComputeYields(pk.payload.DB, pk.name); }catch(e){ console.warn('yields', e); }
  }
  const elName={}, pName={}; DB.elements.forEach(e=>{ elName[e.id]=e.name; }); DB.products.forEach(p=>{ pName[p.id]=p.name; });
  tables.dim_case=PL_CASES.map(c=>({case_id:c.id, case_name:c.name, case_order:c.order, note:c.note, scenario_run_id:c.id==='rated'?runId:''}));
  tables.dim_yield=(DB.plan_yields||[]).map(y=>({element_id:y.element_id, element_name:elName[y.element_id]||'', product_id:y.product_id, product_name:pName[y.product_id]||'', ...y}));
  PL_CASE_SHEETS.forEach(s=>{ tables[s+'_cases']=[]; });
  if(!base||!(DB.plan_yields||[]).length) return;
  for(const c of PL_CASES){
    if(!c.field) continue;
    setMsg(`<span style="color:var(--amber)">Running the sensitivity case · ${esc(c.name)}…</span>`); await new Promise(r=>setTimeout(r,40));
    const r=_plRunCase(_plCaseCaps(c.field)); r.runId=runId+'_'+c.id;
    S.simResults=r; let t2; try{ t2=_pushBIBuildTables(); } finally { S.simResults=base; }
    PL_CASE_SHEETS.forEach(s=>{ (t2[s]||[]).forEach(row=>{ if(row.scenario_type!=='forecast') return; tables[s+'_cases'].push({case:c.id, ...row}); }); });
    const dc=tables.dim_case.find(x=>x.case_id===c.id); if(dc) dc.scenario_run_id=r.runId;
  }
}
async function planUpdateFromTrend(){
  if(!scIsPlanning()){ statMsg('Only in a Planning scenario'); return; }
  const srcId=S.simCfg.plan_source_scenario_id; const pk=await scPeekScenario(srcId,{prompt:true});
  if(!pk){ _plSrcFail(srcId); return; }
  const r=pk.payload.simResults, startDate=S.simCfg.start_date, srcCfg=pk.payload.simCfg||{};
  if(!r){ statMsg(pk.name+' has no saved simulation results — run and save it first'); return; }
  const save=S.simCfg.start_date; S.simCfg.start_date=srcCfg.start_date||save; const chk=_plOpenCheck(r, startDate); S.simCfg.start_date=save;
  const diff=_tsTopoDiff({DB}, pk.payload); const byT={}; diff.forEach(c=>{ byT[c.t]=(byT[c.t]||0)+1; });
  const lines=Object.keys(byT).map(t=>`${byT[t]} ${t}`).join(', ')||'no differences';
  if(!chk.ok&&!confirm(chk.msg+'\n\nUpdate anyway?')) return;
  if(!confirm(`Update this budget scenario from ${pk.name}?\n\n• Topology: ${lines}\n• Closing state: silo levels, carried-over vessels and rail yards from its latest simulation\n\nDemand, budget versions and settings stay.`)) return;
  try{ if(SC.activeId) await scWriteSnapshot(SC.activeId, JSON.stringify(scBuildPayload()), 'pre-update-from-trend'); }catch(e){ console.warn('snapshot', e); }
  try{
    let orphans=[]; if(diff.length){ _scApplyTopologyTables(pk.payload); orphans=planRevalidateRefs(); }
    const ny=plComputeYields(pk.payload.DB, pk.name);
    _plUndoOpeningState();
    const src={DB:pk.payload.DB, simCfg:srcCfg, simResults:r}; const keep=S.simCfg.start_date; S.simCfg.start_date=srcCfg.start_date||keep; let rep; try{ rep=planCopyOpeningState(src, startDate, pk.name); } finally { S.simCfg.start_date=keep; }
    rep.src_mod=pk.fileMod; rep.topology=lines; plSettings().open_report=rep; S.simResults=null; PL._srcStale=false; PL._srcAt=0;
    autoSave(); await scManualSave(); if(typeof renderLocationTree==='function') renderLocationTree(); if(typeof updateNavFacilities==='function') updateNavFacilities();
    planRender(); _demandChanged();
    statMsg(`Updated from ${pk.name} ✓ — topology: ${lines}; ${rep.summary}; yields for ${ny} unit·products${orphans.length?'; '+orphans.length+' stored references could not be re-resolved':''}`);
  }catch(e){ statMsg('Update from trend failed — '+e.message); console.warn(e); }
}
function plSrcEnsure(){
  const srcId=S.simCfg.plan_source_scenario_id; if(!srcId||PL._srcBusy||Date.now()-(PL._srcAt||0)<60000) return;
  PL._srcBusy=true; PL._srcAt=Date.now();
  scPeekScenario(srcId).then(pk=>{ PL._srcBusy=false; if(!pk) return; const m=(plSettings().open_report||{}).src_mod; const st=m?pk.fileMod>m:null; if(st!==PL._srcStale){ PL._srcStale=st; planRender(); } }).catch(()=>{ PL._srcBusy=false; });
}
function _plVersionsCardHTML(s){
  const vs=plVersions().slice().sort((a,b)=>String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
  const dirRow=`<div style="margin-bottom:8px"><div class="pl-muted" style="margin-bottom:3px">Budget folder (master files)</div>${exportDirHTML('budget')}</div>`;
  if(!vs.length) return _plCard('pl-versions','Versions','none yet', 0, dirRow+'<div class="pl-muted">Every load becomes a version; its master file (every demand point × month) is saved in the budget folder.</div>');
  const famTxt=st=>['cement','slag','ash','other'].filter(f=>st.fam[f]).map(f=>f+' '+_plFmt(st.fam[f]/1000,1)+'k').join(' · ');
  const rows=vs.map(v=>{ const st=plVersionStats(v);
    return `<tr><td><label><input type="radio" name="plv-active" ${v.status==='active'?'checked':''} onchange="plSetActiveVersion('${v.id}')"> <b>${_plEsc(v.label)}</b></label> <span class="pl-flag ${v.status==='active'?'ok':'dim'}">${v.status}</span>${v.stale?' <span class="pl-flag">regenerate</span>':''}<br><span class="pl-muted">${String(v.uploaded_at).slice(0,16).replace('T',' ')} · ${_plEsc(v.uploaded_by||'')}${v.note?' · '+_plEsc(v.note):''}</span></td>
      <td class="pl-muted">${(v.source_files||[]).map(f=>_plEsc(f.name)).join('<br>')}</td>
      <td class="n"><b>${_plFmt(st.fy)}</b><br><span class="pl-muted">${famTxt(st)}</span>${st.legacy?`<br><span class="pl-flag bad" title="built with the retired customer process: load the budget again">${st.legacy} old lines</span>`:''}</td>
      <td>${v.generated_at?'<span class="pl-flag ok">generated '+String(v.generated_at).slice(0,10)+'</span>':'<span class="pl-flag dim">not generated</span>'}</td>
      <td>${v.master_file?`<span class="pl-muted" title="${_plEsc(v.master_file.folder+'/'+v.master_file.name)}">${_plEsc(v.master_file.folder)}<br>${String(v.master_file.at).slice(0,16).replace('T',' ')}</span><br>`:''}<button class="pl-btn" onclick="plSaveMaster('${v.id}')">${v.master_file?'Save again':'Save master file'}</button></td>
      <td style="white-space:nowrap"><button class="pl-btn" onclick="plArchiveVersion('${v.id}')">${v.status==='archived'?'Unarchive':'Archive'}</button> <button class="pl-btn" onclick="plDeleteVersion('${v.id}')" ${v.status==='active'?'disabled':''}>Delete</button></td></tr>`; }).join('');
  const opts=vs.map(v=>`<option value="${v.id}">${_plEsc(v.label)}</option>`).join('');
  let diff=''; if(PL.ui.diff&&vs.some(v=>v.id===PL.ui.diff.a)&&vs.some(v=>v.id===PL.ui.diff.b)){
    try{ diff=_plVersionReportHTML(plVersionReport(PL.ui.diff.a, PL.ui.diff.b)); }catch(e){ console.warn('version report', e); diff=`<div class="pl-muted">Could not build the report — ${_plEsc(e.message)}</div>`; }
  }
  return _plCard('pl-versions','Versions','active = the one that is generated and simulated', vs.length,
    `${dirRow}<table class="pl-tbl"><tr><th>Version</th><th>Files</th><th>Volume (ST)</th><th>Demand</th><th>Master file</th><th></th></tr>${rows}</table>
     <div style="display:flex;gap:6px;align-items:center;margin-top:8px"><span class="pl-muted">Compare</span><select class="fi" id="plv-a" style="width:160px">${opts}</select><span class="pl-muted">→</span><select class="fi" id="plv-b" style="width:160px">${opts}</select><button class="pl-btn" onclick="plShowDiff()">Compare</button>${PL.ui.diff?`<button class="pl-btn" onclick="plExportVersionReport()">↓ Excel report</button>`:''}</div>${diff}`);
}
// ═══ Users & access panel (admin) ═══
function acOpenUsersPanel(){
  if(!SC.activeId){ statMsg('Open a scenario first — the list of people is stored in the scenario file.'); return; }
  if(_acEnabledDB() && !_acIsAdmin()){ statMsg('Only the administrator can manage access.'); return; }
  if(!_acEnabledDB()){ _acRenderSetup(); return; }
  const req=_acPendingRequests();
  const users=_acUsers().slice().sort((a,b)=>(b.admin-a.admin)||(a.name||a.email).localeCompare(b.name||b.email));
  const e=_scEsc;
  const reqRows=req.map(r=>`<div class="ac-li"><div style="flex:1"><b>${e(r.name||'')}</b> · ${e(r.email)}<div class="ac-dim">${new Date(r.at).toLocaleString()}${r.note?' — '+e(r.note):''}</div></div>
      <button class="btn-pri" onclick="acEditUser(null,'${e(r.id)}')">Grant access…</button><button class="btn-sec" onclick="acDeclineRequest('${e(r.id)}')">Decline</button></div>`).join('');
  const userRows=users.map(u=>{
    const st=u.active===false?'<span class="ac-pill off">DISABLED</span>':u.must_change?'<span class="ac-pill wait">WAITING FOR PASSWORD</span>':'<span class="ac-pill on">ACTIVE</span>';
    return `<div class="ac-li"><div style="flex:1"><b>${e(u.name||'')}</b> · ${e(u.email)} ${u.admin?'<span class="ac-tag">ADMIN</span>':''} ${st}<div class="ac-dim">${e(_acAccessSummary(u))}</div></div>
      <button class="btn-sec" onclick="acEditUser('${e(u.id)}')">Edit access</button>
      <button class="btn-sec" onclick="acResetPassword('${e(u.id)}')" title="New temporary password + e-mail draft">Reset password</button>
      ${u.id!==_acUser.id?`<button class="btn-sec" onclick="acToggleUser('${e(u.id)}')">${u.active===false?'Enable':'Disable'}</button><span class="ac-x" title="Remove" onclick="acRemoveUser('${e(u.id)}')">🗑</span>`:''}</div>`;
  }).join('');
  showModalContent(`
    <div class="modal-hdr"><span class="modal-title">👥 Users &amp; access — ${e(SC.meta[SC.activeId]?.name||'')}</span><span class="modal-close" onclick="closeModal()">✕</span></div>
    <div class="modal-body ac-panel">
      ${typeof _tsRequestsHTML==='function'?_tsRequestsHTML():''}
      <div class="ac-sec">ACCESS REQUESTS ${req.length?`<span class="ac-badge">${req.length}</span>`:''}</div>
      ${reqRows||'<div class="ac-dim" style="padding:6px 2px 10px">No requests waiting.</div>'}
      <div class="ac-sec">PEOPLE WITH ACCESS</div>
      ${userRows}
    </div>
    <div class="modal-footer" style="justify-content:space-between">
      <span class="ac-dim">Changes here are saved to the scenario file and reach every computer.</span>
      <button class="btn-pri" onclick="acEditUser(null)">＋ Add person</button>
    </div>`);
  document.getElementById('modal-content')?.classList.add('ac-wide');
}
function _acRenderSetup(){
  showModalContent(`
    <div class="modal-hdr"><span class="modal-title">👤 Turn on sign-in</span><span class="modal-close" onclick="closeModal()">✕</span></div>
    <div class="modal-body ac-panel">
      <div class="ac-dim" style="line-height:1.6;margin-bottom:10px">Sign-in is <b>off</b> for <b>${_scEsc(SC.meta[SC.activeId]?.name||'this scenario')}</b> — anyone who opens it can change anything.
      Turning it on makes <b>you the administrator</b>: from then on everyone must sign in, new people request access, and you decide per facility and function what each person may change.</div>
      <div class="fr"><div class="ff"><div class="fl">Your name</div><input class="fi" id="ac-s-name"></div><div class="ff"><div class="fl">Your email</div><input class="fi" id="ac-s-email" type="email"></div></div>
      <div class="fr"><div class="ff"><div class="fl">Password (8+ characters)</div><input class="fi" id="ac-s-pw1" type="password" autocomplete="new-password"></div><div class="ff"><div class="fl">Password again</div><input class="fi" id="ac-s-pw2" type="password" autocomplete="new-password"></div></div>
      <div class="ac-err" id="ac-s-err"></div>
    </div>
    <div class="modal-footer"><button class="btn-sec" onclick="closeModal()">Cancel</button><button class="btn-pri" onclick="acEnable()">Turn on sign-in</button></div>`);
}
async function acEnable(){
  const name=(document.getElementById('ac-s-name')?.value||'').trim(), email=_acNorm(document.getElementById('ac-s-email')?.value);
  const p1=document.getElementById('ac-s-pw1')?.value||'', p2=document.getElementById('ac-s-pw2')?.value||'';
  const err=m=>{ const el=document.getElementById('ac-s-err'); if(el) el.textContent=m; };
  if(!name) return err('Enter your name.');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('Enter a valid email.');
  if(p1.length<8) return err('Choose a password of at least 8 characters.');
  if(p1!==p2) return err('The two passwords are not the same.');
  const u={id:email, email, name, admin:true, active:true, perm:{}, pw:await _acMakePw(p1), must_change:false, created_at:new Date().toISOString(), created_by:email};
  DB.access_users=[u]; DB.access_requests=DB.access_requests||[];
  _acUser=u; _acWriteSession(u, true);
  autoSave(); await scWriteActive(SC.activeId);
  _acMarkRequired(SC.activeId, true);
  closeModal(); acUpdateChip();
  statMsg('Sign-in is on — you are the administrator');
  acOpenUsersPanel();
}

// ── Edit one person's access: facility × function matrix ──
let _acEdit=null;   // {id|null, reqId|null, draft}
function acEditUser(id, reqId){
  const src=id?_acUsers().find(u=>u.id===id):null;
  const rq=reqId?(DB.access_requests||[]).find(r=>r.id===reqId):null;
  _acEdit={id, reqId, draft:{
    email:src?src.email:(rq?rq.email:''), name:src?src.name:(rq?rq.name:''),
    admin:!!(src&&src.admin), perm:JSON.parse(JSON.stringify((src&&src.perm)||{})) }};
  _acRenderEdit();
}
function _acFacRows(){
  const facs=(DB.facilities||[]).slice().sort((a,b)=>String(a.name||a.id).localeCompare(String(b.name||b.id)));
  return facs.map(f=>({id:f.id, name:f.name||f.id})).concat([{id:AC_NET, name:'Network-wide', sub:'records not tied to one facility'}]);
}
function _acRenderEdit(){
  const d=_acEdit.draft, e=_scEsc, rows=_acFacRows();
  const cell=(fac,f)=>{ const on=(d.perm[fac]||{})[f]==='edit'; return `<td class="ac-cell ${on?'on':''}" onclick="acToggleCell('${e(fac)}','${f}')" title="${on?'Can modify':'Read only'} — click to switch">${on?'Modify':'Read'}</td>`; };
  const matrix=d.admin?`<div class="ac-dim" style="padding:14px 4px">Administrators can change everything, and manage people.</div>`:
    `<table class="ac-mx"><thead><tr><th class="ac-corner"><span onclick="acSetAll('edit')">all modify</span> · <span onclick="acSetAll('read')">all read</span></th>${AC_FUNCS.map(F=>`<th title="${e(F.tip)} — click to switch the whole column" onclick="acToggleCol('${F.id}')">${e(F.label)}</th>`).join('')}</tr></thead>
     <tbody>${rows.map(r=>`<tr><th onclick="acToggleRow('${e(r.id)}')" title="Click to switch the whole row">${e(r.name)}${r.sub?`<div class="ac-dim" style="font-size:8px;font-weight:400">${e(r.sub)}</div>`:''}</th>${AC_FUNCS.map(F=>cell(r.id,F.id)).join('')}</tr>`).join('')}</tbody></table>`;
  showModalContent(`
    <div class="modal-hdr"><span class="modal-title">${_acEdit.id?'Edit access':'Grant access'}</span><span class="modal-close" onclick="acOpenUsersPanel()">✕</span></div>
    <div class="modal-body ac-panel">
      <div class="fr"><div class="ff"><div class="fl">Name</div><input class="fi" id="ac-e-name" value="${e(d.name)}" oninput="_acEdit.draft.name=this.value"></div>
        <div class="ff"><div class="fl">Email</div><input class="fi" id="ac-e-email" type="email" value="${e(d.email)}" ${_acEdit.id?'disabled':''} oninput="_acEdit.draft.email=this.value"></div></div>
      <label class="ac-chk" style="margin:6px 0 10px"><input type="checkbox" ${d.admin?'checked':''} ${_acEdit.id&&_acEdit.id===_acUser.id?'disabled':''} onchange="_acEdit.draft.admin=this.checked;_acRenderEdit()"> Administrator (can change everything and manage people)</label>
      <div class="ac-dim" style="margin-bottom:6px">Click a cell to switch between <b>Read</b> and <b>Modify</b>; click a facility or function name to switch its whole row or column. Everything is readable by everyone signed in.</div>
      ${matrix}
      <div class="ac-err" id="ac-e-err"></div>
    </div>
    <div class="modal-footer"><button class="btn-sec" onclick="acOpenUsersPanel()">Cancel</button><button class="btn-pri" onclick="acSaveUser()">${_acEdit.id?'Save':'Grant access &amp; prepare e-mail'}</button></div>`);
  document.getElementById('modal-content')?.classList.add('ac-wide');
}
function acToggleCell(fac,f){ const p=_acEdit.draft.perm; p[fac]=p[fac]||{}; if(p[fac][f]==='edit') delete p[fac][f]; else p[fac][f]='edit'; _acRenderEdit(); }
function acToggleCol(f){ const rows=_acFacRows(), p=_acEdit.draft.perm; const allOn=rows.every(r=>(p[r.id]||{})[f]==='edit'); rows.forEach(r=>{ p[r.id]=p[r.id]||{}; if(allOn) delete p[r.id][f]; else p[r.id][f]='edit'; }); _acRenderEdit(); }
function acToggleRow(fac){ const p=_acEdit.draft.perm; p[fac]=p[fac]||{}; const allOn=AC_FUNCS.every(F=>p[fac][F.id]==='edit'); AC_FUNCS.forEach(F=>{ if(allOn) delete p[fac][F.id]; else p[fac][F.id]='edit'; }); _acRenderEdit(); }
function acSetAll(v){ const p={}; if(v==='edit') _acFacRows().forEach(r=>{ p[r.id]={}; AC_FUNCS.forEach(F=>p[r.id][F.id]='edit'); }); _acEdit.draft.perm=p; _acRenderEdit(); }
async function acSaveUser(){
  const d=_acEdit.draft, email=_acNorm(d.email), name=String(d.name||'').trim();
  const err=m=>{ const el=document.getElementById('ac-e-err'); if(el) el.textContent=m; };
  if(!name) return err('Enter a name.');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('Enter a valid email.');
  Object.keys(d.perm).forEach(k=>{ if(!Object.keys(d.perm[k]).length) delete d.perm[k]; });
  DB.access_users=_acUsers().slice();
  let temp=null;
  if(_acEdit.id){
    const i=DB.access_users.findIndex(u=>u.id===_acEdit.id);
    if(i<0) return err('That person no longer exists.');
    if(DB.access_users[i].admin && !d.admin && DB.access_users.filter(u=>u.admin&&u.active!==false).length<2) return err('Keep at least one administrator.');
    DB.access_users[i]=Object.assign({}, DB.access_users[i], {name, admin:!!d.admin, perm:d.admin?{}:d.perm});
  }else{
    if(DB.access_users.some(u=>u.id===email)) return err('This email already has access — use Edit access.');
    temp=_acTempPw();
    DB.access_users.push({id:email, email, name, admin:!!d.admin, active:true, perm:d.admin?{}:d.perm, pw:await _acMakePw(temp), must_change:true,
      created_at:new Date().toISOString(), created_by:_acUser.id});
    DB.access_requests=(DB.access_requests||[]).filter(r=>_acNorm(r.email)!==email);
  }
  if(_acUser && _acUser.id===_acEdit.id) _acUser=DB.access_users.find(u=>u.id===_acUser.id);
  autoSave(); await scWriteActive(SC.activeId);
  acUpdateChip();
  if(temp) _acShowPasswordMail(DB.access_users.find(u=>u.id===email), temp, true);
  else acOpenUsersPanel();
}
async function acResetPassword(id){
  const i=_acUsers().findIndex(u=>u.id===id); if(i<0) return;
  if(!confirm('Give '+(_acUsers()[i].name||id)+' a new temporary password? Their current password stops working and they will be signed out everywhere.')) return;
  const temp=_acTempPw();
  DB.access_users=_acUsers().slice();
  DB.access_users[i]=Object.assign({}, DB.access_users[i], {pw:await _acMakePw(temp), must_change:true, pw_changed_at:new Date().toISOString()});
  autoSave(); await scWriteActive(SC.activeId);
  if(_acUser && _acUser.id===id){ acSignOut(); return; }
  _acShowPasswordMail(DB.access_users[i], temp, false);
}
function acToggleUser(id){
  DB.access_users=_acUsers().map(u=>u.id===id?Object.assign({},u,{active:u.active===false}):u);
  autoSave(); scWriteActive(SC.activeId); acOpenUsersPanel();
}
function acRemoveUser(id){
  const u=_acUsers().find(x=>x.id===id); if(!u) return;
  if(!confirm('Remove '+(u.name||u.email)+'? They will no longer be able to sign in.')) return;
  DB.access_users=_acUsers().filter(x=>x.id!==id);
  autoSave(); scWriteActive(SC.activeId); acOpenUsersPanel();
}
function acDeclineRequest(rid){
  const rq=(DB.access_requests||[]).find(r=>r.id===rid); if(!rq) return;
  const em=_acNorm(rq.email);
  DB.access_requests=(DB.access_requests||[]).map(r=>(_acNorm(r.email)===em && r.status==='pending')?Object.assign({},r,{status:'declined', handled_by:_acUser&&_acUser.id, handled_at:new Date().toISOString()}):r);
  autoSave(); scWriteActive(SC.activeId); acUpdateChip(); acOpenUsersPanel();
}
// The temporary password is shown ONCE, here — only its hash is stored. "Open e-mail draft"
// hands the text to the computer's mail program (Outlook); the admin reviews and sends it.
function _acShowPasswordMail(u, temp, isNew){
  const scn=SC.meta[SC.activeId]||{};
  const url=location.origin+location.pathname+'#setpw='+encodeURIComponent(u.email)+(scn.fileName?'&f='+encodeURIComponent(scn.fileName):'');
  const subject='Your access to AVILA Roll';
  const body=`Hi ${u.name||''},

${isNew?'You now have access to AVILA Roll':'Your AVILA Roll password was reset'} (scenario "${scn.name||''}").

Your temporary password: ${temp}

1. Open this link in Chrome or Edge:
${url}
2. The first time, the app asks you to choose the shared folder: pick the Florida Logistics SharePoint folder (or any folder above it) and click Allow / Edit files. The app finds "${scn.fileName||'the scenario file'}" by itself.
3. Enter the temporary password and choose your own password.

Your access: ${_acAccessSummary(u)}

${_acUser?(_acUser.name||_acUser.email):''}`;
  const mailto='mailto:'+encodeURIComponent(u.email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
  window._acMailBody=body;
  showModalContent(`
    <div class="modal-hdr"><span class="modal-title">✉ Send the password to ${_scEsc(u.name||u.email)}</span><span class="modal-close" onclick="acOpenUsersPanel()">✕</span></div>
    <div class="modal-body ac-panel">
      <div class="ac-dim" style="margin-bottom:8px">Temporary password (shown only now — it is not stored anywhere readable):</div>
      <div class="ac-temp">${_scEsc(temp)}</div>
      <textarea class="fi" rows="13" style="width:100%;margin-top:10px;font-family:var(--mono);font-size:10px" readonly>${_scEsc(body)}</textarea>
    </div>
    <div class="modal-footer"><button class="btn-sec" onclick="navigator.clipboard.writeText(window._acMailBody).then(()=>statMsg('E-mail text copied'))">📋 Copy text</button>
      <a class="btn-pri" style="text-decoration:none" href="${_scEsc(mailto)}">✉ Open e-mail draft</a>
      <button class="btn-sec" onclick="acOpenUsersPanel()">Done</button></div>`);
}

// ── Version History panel — browse/restore/delete snapshots (reuses the
// app's generic modal: showModalContent/closeModal). ──
function scOpenHistoryPanel(){
  const id=SC.activeId; const m=id?SC.meta[id]:null;
  if(!id||!m){ statMsg('Open or create a scenario first.'); return; }
  showModalContent(`
    <div class="modal-hdr"><span class="modal-title">🕒 Version History — ${_scEsc(m.name)}</span><span class="modal-close" onclick="closeModal()">✕</span></div>
    <div id="sc-chlog" style="padding:10px 16px 4px;border-bottom:1px solid var(--border2)"></div>
    <div style="padding:8px 16px 0;font-family:var(--mono);font-size:9px;color:var(--text-dim);letter-spacing:.06em">SAVED VERSIONS</div>
    <div class="modal-body" id="sc-hist-body" style="min-height:100px">
      <div style="padding:20px;text-align:center;color:var(--text-dim);font-family:var(--mono);font-size:10px">Loading…</div>
    </div>
    <div class="modal-footer" style="justify-content:space-between;align-items:center;flex-wrap:wrap">
      <span id="sc-hist-folder" style="font-family:var(--mono);font-size:8px;color:var(--text-dim);flex:1;min-width:120px"></span>
      <button class="btn-sec" onclick="scHistChooseFolder()">📂 Change folder…</button>
      <button class="btn-pri" onclick="scHistSnapshotNow()">🕒 Snapshot now</button>
    </div>`);
  scRenderChangeLog();
  scRenderHistoryList(id);
}
// ── Change log — who saved what, and when (from the change log inside the scenario file) ──
const _CL_TABLE_LABEL={elements:'topology items', connections:'connections', facilities:'facilities', products:'products',
  demand_values:'demand values', production_campaigns:'production campaigns', vessel_calls:'vessel calls', vessel_campaigns:'vessel campaigns', vessel_sof:'SOF statements',
  rail_movements:'rail movements', rail_loading_plan:'rail loading plan', silo_links:'silo links', silo_transfer_plans:'silo transfers', topo_labels:'canvas labels',
  mill_policies:'mill policies', element_maintenance_events:'maintenance events', demand_substitutions:'demand swaps',
  plan_versions:'budget versions', plan_lines:'budget lines', alloc_keys:'allocation keys', norm_rules:'normalisation rules', plan_demand:'budget demand', plan_imports:'budget imports', plan_yields:'budget yields', plan_settings:'budget settings', [CL_CFG]:'settings'};
function _clSummary(n){
  return Object.entries(n||{}).map(([t,[a,m,d]])=>{
    const parts=[]; if(a) parts.push('+'+a); if(m) parts.push('~'+m); if(d) parts.push('−'+d);
    return `<span style="white-space:nowrap">${parts.join(' ')} ${_scEsc(_CL_TABLE_LABEL[t]||t.replace(/_/g,' '))}</span>`;
  }).join(' · ');
}
function scRenderChangeLog(){
  const el=document.getElementById('sc-chlog'); if(!el) return;
  const log=_clNorm(window._scLog), dev=_clDevice();
  const saves=log.saves.slice(-60).reverse();
  const rows=saves.map(sv=>{
    const d=new Date(sv.at), me=sv.dev===dev.id;
    return `<div style="display:flex;gap:10px;padding:5px 2px;border-bottom:1px solid var(--border2);font-family:var(--mono);font-size:10px;align-items:baseline">
      <span style="color:var(--text-dim);white-space:nowrap;min-width:118px">${d.toLocaleDateString('en',{month:'short',day:'numeric'})} ${d.toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}</span>
      <span style="color:${me?'var(--green)':'var(--text)'};white-space:nowrap;min-width:110px">${_scEsc(_clWho(sv.dev, sv.name))}${me?' (this browser)':''}</span>
      <span style="flex:1;color:var(--text)">${_clSummary(sv.n)}${(sv.lbl&&sv.lbl.length)?`<div style="color:var(--text-dim);font-size:9px;margin-top:2px">${_scEsc(sv.lbl.join(' · '))}</div>`:''}</span>
    </div>`;
  }).join('');
  el.innerHTML=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;font-family:var(--mono)">
      <span style="font-size:9px;color:var(--text-dim);letter-spacing:.06em;flex:1">CHANGE LOG — WHO SAVED WHAT</span>
      <label style="font-size:9px;color:var(--text-dim)">This browser's name</label>
      <input id="cl-devname" value="${_scEsc(dev.name)}" placeholder="Browser ${_scEsc(dev.id)}" style="width:150px;font-family:var(--mono);font-size:10px;padding:3px 6px;background:var(--surface2);color:var(--text);border:1px solid var(--border2);border-radius:3px"
        onchange="try{localStorage.setItem('avila_device_name',this.value.trim())}catch(e){};scRenderChangeLog();statMsg('Saves from this browser will now show as '+(this.value.trim()||'Browser ${_scEsc(dev.id)}'))">
    </div>
    <div style="max-height:220px;overflow:auto">${rows||`<div style="padding:10px 2px;font-family:var(--mono);font-size:10px;color:var(--text-dim)">No changes recorded yet — every save from now on is listed here, with who made it.</div>`}</div>`;
}
async function scHistChooseFolder(){
  const id=SC.activeId; if(!id) return;
  const dir=await scEnsureHistoryDir(id, true);
  if(dir) await scRenderHistoryList(id);
}
async function scHistSnapshotNow(){
  const id=SC.activeId; if(!id) return;
  const dir=await scEnsureHistoryDir(id, true); if(!dir) return;
  const ok=await scWriteSnapshot(id, JSON.stringify(scBuildPayload(),null,2), 'manual');
  statMsg(ok?'Snapshot saved ✓':'Snapshot failed');
  await scRenderHistoryList(id);
}
async function scRenderHistoryList(id){
  const body=document.getElementById('sc-hist-body'); if(!body) return; // panel closed mid-await
  const m=SC.meta[id]; if(!m) return;
  const folderEl=document.getElementById('sc-hist-folder');
  const dir=await scEnsureHistoryDir(id, false);
  if(!document.getElementById('sc-hist-body')) return; // closed while we awaited
  if(!dir){
    if(folderEl) folderEl.textContent='';
    body.innerHTML=`<div style="padding:16px 4px;text-align:center;font-family:var(--mono);font-size:10px;color:var(--text-dim);line-height:1.7">
      No history folder linked yet for <b style="color:var(--text)">${_scEsc(m.name)}</b>.<br>
      Pick a folder (e.g. a "History" subfolder next to your scenario file) — from then on, every meaningful save drops a dated copy there that nobody's later edit can ever touch.
      <div style="margin-top:12px"><button class="btn-pri" onclick="scHistChooseFolder()">📂 Choose folder…</button></div>
    </div>`;
    return;
  }
  if(folderEl) folderEl.textContent='📁 '+(dir.name||'linked folder');
  const items=[];
  try{
    for await (const [name,h] of dir.entries()){
      if(h.kind!=='file') continue;
      const p=_scHistParse(name,m); if(p) items.push(p);
    }
  }catch(e){ body.innerHTML=`<div style="padding:16px 4px;color:var(--red);font-family:var(--mono);font-size:10px">Couldn't read the folder — permission may have lapsed. Try "Change folder…".</div>`; return; }
  items.sort((a,b)=>b.date-a.date);
  if(!items.length){ body.innerHTML=`<div style="padding:16px 4px;text-align:center;font-family:var(--mono);font-size:10px;color:var(--text-dim)">No snapshots yet — they'll appear here as you work (or click "Snapshot now").</div>`; return; }
  const tagBadge=t=> t==='conflict'?`<span style="color:var(--red);border:1px solid var(--red);border-radius:3px;padding:0 5px;font-size:8px;margin-left:6px">CONFLICT</span>`
                    :t==='manual'?`<span style="color:var(--green);border:1px solid var(--green);border-radius:3px;padding:0 5px;font-size:8px;margin-left:6px">MANUAL</span>`
                    :t==='pre-restore'?`<span style="color:var(--blue);border:1px solid var(--blue);border-radius:3px;padding:0 5px;font-size:8px;margin-left:6px">BEFORE RESTORE</span>`:'';
  body.innerHTML=items.map(it=>{
    const safe=it.name.replace(/'/g,"\\'");
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid var(--border2);font-family:var(--mono)">
      <div style="flex:1;font-size:10px;color:var(--text)">${it.date.toLocaleString()}${tagBadge(it.tag)}</div>
      <button class="btn-sec" onclick="scRestoreSnapshot('${id}','${safe}')">↩ Restore</button>
      <button class="btn-sec" onclick="scRestoreTopologySnapshot('${id}','${safe}')" title="Bring back only the topology (facilities, equipment, silos, demand points, connections, products) of this version">↩ Topology only</button>
      <span style="color:var(--red);cursor:pointer;font-size:12px;padding:0 4px" title="Delete" onclick="scDeleteSnapshot('${id}','${safe}')">🗑</span>
    </div>`;
  }).join('');
}
async function scDeleteSnapshot(id,name){
  const dir=await scEnsureHistoryDir(id,false); if(!dir) return;
  if(!confirm('Delete this snapshot? This cannot be undone.')) return;
  try{ await dir.removeEntry(name); }catch(e){ statMsg('Delete failed'); return; }
  await scRenderHistoryList(id);
}
async function scRestoreSnapshot(id, name){
  const dir=await scEnsureHistoryDir(id,false); if(!dir) return;
  const m=SC.meta[id]; if(!m) return;
  if(!confirm('Restore the scenario to this saved version?\n\nYour current state will be snapshotted first, so this restore itself can be undone.')) return;
  try{
    await scWriteSnapshot(id, JSON.stringify(scBuildPayload(),null,2), 'pre-restore'); // safety net for the restore itself
    const fh=await dir.getFileHandle(name);
    const text=await (await fh.getFile()).text();
    const payload=JSON.parse(text);
    if(!payload||!payload.DB) throw new Error('not a valid scenario snapshot');
    // A folder shared with the Sales page's history lists its snapshots too (same name prefix).
    if(_scIsSalesPayload(payload)) throw new Error('that snapshot was written by the Avila Sales page — it is not a version of this scenario');
    _mgApplyPayloadToApp(payload);
    _slResetIfAbsent(payload.DB); // a restore goes back to that version — silo tables included
    await scManualSave(); // pushes the restored state back into the live file (merge-aware) + snapshots it
    closeModal();
    statMsg('Restored ✓ — '+name);
  }catch(e){ statMsg('Restore failed — '+e.message); console.warn('SC restore',e); }
}

// ── Startup picker ──
function scOpenStartup(firstRun){
  scCloseStartup();
  const ov=document.createElement('div'); ov.className='sc-overlay'; ov.id='sc-startup';
  const ids=Object.keys(SC.meta).sort((a,b)=>(SC.meta[b].lastOpened||'').localeCompare(SC.meta[a].lastOpened||''));
  const lastId=ids[0]||null;
  let rows='';
  ids.forEach((id,i)=>{ const m=SC.meta[id]; rows+=`<div class="sc-card" onclick="scStartupOpen('${id}')">
    <span class="sc-sw" style="background:${m.color}"></span>
    <div style="flex:1;min-width:0"><div class="sc-t">${_scEsc(m.name)}</div><div class="sc-s">opened ${scRelTime(m.lastOpened)} · ${_scEsc(m.fileName||'')}</div></div>
    ${i===0?'<span style="font-size:8px;color:var(--blue);border:1px solid var(--blue);border-radius:4px;padding:2px 6px">LAST USED</span>':''}
  </div>`; });
  ov.innerHTML=`<div class="sc-modal">
    <div class="sc-modal-hdr"><div class="sc-h">Choose a scenario</div><div class="sc-sub">${firstRun?'No scenarios yet — create one to start saving your work to a file.':'Pick a model to work on, or start a new one.'}</div></div>
    <div class="sc-modal-list">${rows||'<div style="padding:14px;color:var(--text-dim);font-size:11px;text-align:center">No saved scenarios</div>'}</div>
    ${lastId?`<div style="display:flex;align-items:center;gap:7px;padding:4px 16px"><input type="checkbox" id="sc-autoopen-chk" style="accent-color:var(--green)"><label for="sc-autoopen-chk" style="color:var(--text-dim);font-size:9px;cursor:pointer">Always open ${_scEsc(SC.meta[lastId].name)} and skip this</label></div>`:''}
    <div class="sc-modal-foot">
      ${lastId?`<div class="sc-btn pri" onclick="scStartupOpen('${lastId}')">Open</div>`:''}
      <div class="sc-btn" onclick="scNew()">＋ New</div>
      <div class="sc-btn" onclick="scOpenFile()">📂 File…</div>
      <div style="flex:1"></div>
      <div class="sc-btn" onclick="scCloseStartup()" title="Work without a scenario (changes won't be saved to a file until you create one)">Skip</div>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
function scCloseStartup(){ const ov=document.getElementById('sc-startup'); if(ov) ov.remove(); }
async function scStartupOpen(id){
  const chk=document.getElementById('sc-autoopen-chk');
  if(chk&&chk.checked) localStorage.setItem('avila_sc_autoopen',id); else if(chk) localStorage.removeItem('avila_sc_autoopen');
  scCloseStartup();
  // force: the picked scenario is usually ALREADY SC.activeId (scInit restores it
  // from localStorage before showing this picker), and without force scSwitch
  // would no-op and never read the file.
  await scSwitch(id, {force:true});
}

// ── Init (called from DOMContentLoaded, after dsInit) ──
async function scInit(){
  scLoadMeta();
  for(const id of Object.keys(SC.meta)){ const h=await scLoadHandle(id); if(h) SC.handles[id]=h; }

  // One-time migration: an existing "Topology JSON" Data Source becomes a scenario.
  if(!Object.keys(SC.meta).length){
    let legacy=null; try{ legacy=await dsLoadHandle('topology'); }catch(e){}
    if(legacy){
      const id='sc_'+Date.now().toString(36);
      SC.meta[id]={ id, name:(legacy.name||'Baseline').replace(/\.json$/i,''), color:scPickColor(), fileName:legacy.name, lastSaved:null, lastOpened:new Date().toISOString() };
      SC.handles[id]=legacy; await scSaveHandle(id,legacy); SC.activeId=id; scSaveMeta();
      statMsg('Migrated your topology file into the "'+SC.meta[id].name+'" scenario');
    }
  }
  scUpdatePill();

  // Close the dropdown on any outside click.
  document.addEventListener('click', e=>{
    const dd=document.getElementById('sc-dropdown'), sw=document.getElementById('sc-switcher');
    if(dd&&dd.style.display!=='none'&&!dd.contains(e.target)&&sw&&!sw.contains(e.target)) scCloseDropdown();
  });

  const ids=Object.keys(SC.meta);
  // First visit on this computer (or an e-mail link naming a file it does not know yet):
  // the guided welcome screen replaces the bare scenario picker.
  if(typeof acWelcome==='function' && acWelcome()) return;
  if(!ids.length){ scOpenStartup(true); return; }              // first run, nothing to open
  const pref=localStorage.getItem('avila_sc_autoopen');
  if(pref && SC.meta[pref]){ SC.activeId=pref; if(await scLoadScenario(pref,{guard:true})) return; }
  scOpenStartup(false);                                          // ask which scenario
}
