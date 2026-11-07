// ═══════════════════════════════════════════════════════
// RESULTS FILTERS — the shared filter bar (SHARED FILTER BAR, fltRender('res')) applied
// to the Dashboard and the Data Table. Only the Results meaning of a selection lives here:
// which elements a product pick keeps (getResultElements) and which data-tree groups a
// Process key covers. The date window comes from getViewRange().
// ═══════════════════════════════════════════════════════
// Which products an element handles — silos by contents, mills/kilns/packers by their
// capacity table, demand points by what is demanded there.
function resProductsOfElement(el){
  if(!el) return [];
  if(el.type==='bulk_silo'||el.type==='packed_silo') return getSiloProducts(el)||[];
  if(['kiln','finish_mill','raw_meal_mill','packing_plant'].includes(el.type))
    return DB.element_product_capacities.filter(c=>c.element_id===el.id).map(c=>c.product_id).filter(Boolean);
  if(el.type==='demand_point')
    return (DB.demand_points.find(d=>d.element_id===el.id)?.products||[]).map(p=>p.product_id).filter(Boolean);
  return [];
}
// Element types that declare the products they handle. Anything else (berths, rail
// dispatch points, connectors) carries no product of its own and is left alone, so a
// product filter never silently deletes the Imports / Rail Transfers groups.
const RES_PRODUCT_BEARING=['bulk_silo','packed_silo','kiln','finish_mill','raw_meal_mill','packing_plant','demand_point'];
function resElementHandlesProduct(el,allowed){
  if(!RES_PRODUCT_BEARING.includes(el.type)) return true;
  // A product-bearing element with an empty product list declares nothing, so it
  // matches no product filter. It still shows when no product filter is on.
  return resProductsOfElement(el).some(p=>allowed.has(p));
}

// Level-0 data-tree groups ↔ the shared Process keys. A group hides only when EVERY key it
// covers is off — switching off "Cement inventory" alone leaves the tree's CEM Inventory
// group up while "Packed inventory" is still on. Rail Transfers is one entry covering every
// origin facility, which each get their own `cem_rail_from_<id>` group.
const RES_PROC_MAP=[
  {match:id=>id==='demand_total',              keys:['cementNeed','packedNeed']},
  {match:id=>id==='clk_req',                   keys:['clinkerReq']},
  {match:id=>id==='cem_inv',                   keys:['cementInv','packedInv']},
  {match:id=>id==='clk_inv',                   keys:['clinkerInv']},
  {match:id=>id==='cem_prod',                  keys:['cementProd','cementByProd']},
  {match:id=>id==='clk_prod',                  keys:['clinkerProd']},
  {match:id=>id.startsWith('cem_rail_from_'),  keys:['railLoad','termRail']},
  {match:id=>id==='cem_imports',               keys:['termVessel']}
];
// True when a built group belongs to a process the user has switched off.
function resGroupHidden(groupId){
  const m=RES_PROC_MAP.find(x=>x.match(groupId));
  return !!m&&m.keys.every(k=>!fltProcOn(k));
}

FLT_PAGES.res={
  bounds:()=>fltSimBounds(),
  // Process hides data-tree groups, so it only means something on the Data Table.
  proc:()=>S.view==='datatable'?[...new Set(RES_PROC_MAP.flatMap(m=>m.keys))]:null,
  rerender:()=>{
    fltRender('res');
    if(S.simResults){
      renderDtree(S.simResults);
      renderDashCharts(S.simResults);
      renderEvLog(S.simResults);
      renderDashboard();
    }
  }
};

// ── EXPORT DESTINATIONS ─────────────────────────────────────────────────────
// Both spreadsheet exports write the SAME file name into the SAME user-chosen folder,
// replacing what is already there — so anything pointing at that path (Power BI, a
// shared drive, a scheduled refresh) keeps working without ever being re-pointed.
//   Each destination is a FileSystemDirectoryHandle picked once in
//   Configuration → Data Sources and kept in IndexedDB beside the scenario handles
//   (handles can't be serialised to localStorage). Only the folder's display name goes
//   to localStorage, so the panel can label itself before the handle loads.
// Browsers without the File System Access API fall back to a normal download that
// still carries the fixed name — there the browser picks the folder.
const EXPORT_SLOTS={
  results:{
    dirKey:'__results_export_dir__', nameKey:'avila_results_dir_name',
    file:'Avila Results.xlsx', pickerId:'avila-results-export', rowId:'res-export-dir-row',
    label:'Results export folder',
    desc:'Where <b style="color:var(--text)">⤓ Export full data</b> on the Results page writes.'
  },
  bi:{
    dirKey:'__bi_export_dir__', nameKey:'avila_bi_dir_name',
    file:'Avila Power BI.xlsx', pickerId:'avila-bi-export', rowId:'bi-export-dir-row',
    label:'Power BI export folder',
    desc:'Where <b style="color:var(--text)">📤 Push to BI</b> (Results menu) writes. Point Power BI at this file once and refresh it from there.'
  },
  // Publish (Configuration → Demand Mapping) writes several files into this one folder —
  // see XLPUB_FILES; `file` is only the one named in the generic folder row.
  sap:{
    dirKey:'__sap_pub_dir__', nameKey:'avila_sap_pub_dir_name',
    file:'Avila_Shipments_Summary.xlsx', pickerId:'avila-sap-publish', rowId:'sap-pub-dir-row',
    label:'Sales files folder',
    desc:'Where <b style="color:var(--text)">Publish</b> in Configuration → Demand Mapping writes its own "(app)" copies of the Summary, Detail and Transfers files, beside the SAP pipeline\'s.'
  },
  // Logistics → Vessel schedule → SOF files each Statement of Facts PDF here (one per port of call).
  sof:{
    dirKey:'__sof_dir__', nameKey:'avila_sof_dir_name',
    file:'<vessel>_<port>_<arrival>_SOF.pdf', pickerId:'avila-sof', rowId:'sof-dir-row',
    label:'SOF folder',
    desc:'Where the <b style="color:var(--text)">SOF</b> button on the vessel schedule files each Statement of Facts PDF — the <b style="color:var(--text)">SOF</b> folder next to RealValues.',
    same:'One PDF per port of call, named after the vessel, port and arrival date.',
    replaces:'Uploading a new SOF for the same port replaces its PDF. Your browser may ask you to confirm access once per session.',
    unset:'Not set — the SOF window asks for the folder the first time a PDF is filed'
  },
  // Configuration → Budget Planning saves the master file of each budget version here (into its "_Budget <year>" folder).
  budget:{
    dirKey:'__budget_dir__', nameKey:'avila_budget_dir_name',
    file:'_Budget <year>/Budget <year> master - <version>.xlsx', pickerId:'avila-budget', rowId:'budget-dir-row',
    label:'Budget folder',
    desc:'Where <b style="color:var(--text)">Budget Planning</b> saves the master file of each budget version — pick <b style="color:var(--text)">_New_Roll\\Budget</b>.',
    same:'One master file per version, named after the version, inside the "_Budget &lt;year&gt;" folder.',
    replaces:'Saving a version again replaces its file. Your browser may ask you to confirm access once per session.',
    unset:'Not set — the first save asks for the folder (pick _New_Roll\\Budget)'
  }
};
const _exportDirHandles={};   // slot → handle granted this session

function exportSlot(slot){ return EXPORT_SLOTS[slot]||EXPORT_SLOTS.results; }
function exportDirName(slot){
  try{ return localStorage.getItem(exportSlot(slot).nameKey)||''; }catch(e){ return ''; }
}

// Returns the slot's folder handle with write permission, or null.
//   prompt=true  — may open the picker / ask to re-grant; call it inside a user gesture
//   prompt=false — silent: only a handle already granted this session
async function exportDir(slot, prompt){
  const cfg=exportSlot(slot);
  try{
    const cached=_exportDirHandles[slot];
    if(cached&&await _dsEnsureWritePermission(cached)) return cached;
    let h=await scLoadHistoryDirHandle(cfg.dirKey);
    if(h){
      // A stored handle needs its permission re-granted each new session, and that
      // request only succeeds inside a user gesture.
      const perm=await h.queryPermission({mode:'readwrite'});
      if(perm==='granted'){ _exportDirHandles[slot]=h; return h; }
      if(prompt&&await _dsEnsureWritePermission(h)){ _exportDirHandles[slot]=h; return h; }
      return null;
    }
    if(!prompt||!window.showDirectoryPicker) return null;
    h=await window.showDirectoryPicker({id:cfg.pickerId,mode:'readwrite'});
    _exportDirHandles[slot]=h;
    await scSaveHistoryDirHandle(cfg.dirKey,h);
    try{ localStorage.setItem(cfg.nameKey,h.name||''); }catch(e){}
    return h;
  }catch(e){ return null; } // cancelled picker or denied permission
}

// Write a built workbook to the slot's folder, or fall back to a download. `dir` is
// passed in rather than resolved here because the picker needs the click's user
// activation, which does not survive building the workbook.
function exportFileName(slot){ const cfg=exportSlot(slot); return (slot==='bi'&&typeof scIsPlanning==='function'&&scIsPlanning())?'Avila Power BI - Planning.xlsx':cfg.file; }
async function exportWriteWorkbook(slot, wb, dir){
  const cfg=exportSlot(slot); const _file=exportFileName(slot);
  if(dir){
    // compression:true — SheetJS stores the zip uncompressed by default (Push to BI came out
    // at ~23 MB). Smaller = one quick OneDrive upload instead of several partial versions
    // (each one fired the Power BI refresh flow) and a faster Power BI refresh.
    const data=XLSX.write(wb,{bookType:'xlsx',type:'array',compression:true});
    const fh=await dir.getFileHandle(_file,{create:true});
    const w=await fh.createWritable();
    await w.write(data);
    await w.close();
    return {saved:true, where:dir.name+'/'+_file};
  }
  XLSX.writeFile(wb,_file,{compression:true});
  return {saved:false, where:_file};
}

async function chooseExportDir(slot){
  const cfg=exportSlot(slot);
  if(!window.showDirectoryPicker){
    alert('This browser cannot pick a folder — use Chrome or Edge.\n\nExports will download to your usual Downloads folder as "'+cfg.file+'".');
    return;
  }
  const h=await exportDir(slot,true);
  if(h) statMsg(cfg.label+' set — '+h.name);
  _renderExportDirRow(slot);
}
async function clearExportDir(slot){
  const cfg=exportSlot(slot);
  delete _exportDirHandles[slot];
  try{ await scDeleteHistoryDirHandle(cfg.dirKey); }catch(e){}
  try{ localStorage.removeItem(cfg.nameKey); }catch(e){}
  statMsg(cfg.label+' cleared — exports will download instead');
  _renderExportDirRow(slot);
}

// The Data Sources block for one destination. Rendered on its own so choosing or
// clearing a folder can repaint just that block.
function exportDirHTML(slot){
  const cfg=exportSlot(slot);
  const supported=!!window.showDirectoryPicker;
  const name=exportDirName(slot);
  const body=!supported
    ? `<div style="font-family:var(--mono);font-size:9px;color:var(--amber)">
         This browser can't save to a chosen folder — Chrome or Edge required.
         Exports download as <b style="color:var(--text)">${cfg.file}</b>.
       </div>`
    : name
      ? `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
           <span style="font-family:var(--mono);font-size:10px;color:var(--green)">📁 ${esc(name)}</span>
           <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">/ ${cfg.file}</span>
           <button class="tb-btn sec" style="font-size:9px;padding:3px 10px" onclick="chooseExportDir('${slot}')">Change…</button>
           <button class="tb-btn sec" style="font-size:9px;padding:3px 10px" onclick="clearExportDir('${slot}')">Clear</button>
         </div>
         <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:5px">
           ${cfg.replaces||'Each export replaces this file. Your browser may ask you to confirm access once per session.'}
         </div>`
      : `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
           <button class="tb-btn sec" style="font-size:9px;padding:3px 10px" onclick="chooseExportDir('${slot}')">Choose folder…</button>
           <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">${cfg.unset||'Not set — exports download to your browser\'s Downloads folder'}</span>
         </div>`;
  return `<div id="${cfg.rowId}" style="border:1px solid var(--border2);background:var(--surface2);padding:12px 14px;margin-bottom:12px">
    <div style="font-family:var(--mono);font-size:9px;color:var(--text);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">
      ${cfg.label}
    </div>
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);line-height:1.7;margin-bottom:9px">
      ${cfg.desc} ${cfg.same||'Always the same file name, always the same folder, so the previous export is replaced.'}
    </div>
    ${body}
  </div>`;
}
function _renderExportDirRow(slot){
  const row=document.getElementById(exportSlot(slot).rowId);
  if(row) row.outerHTML=exportDirHTML(slot);
}

// ════════════════════════════════════════════════════════════════
// EXPORT FULL DATA — the whole Daily Results tree as XLSX.
// Deliberately ignores the filter dock, the collapse state and the view window: this
// is the complete dataset, every group, every facility, every element, across the
// entire simulation horizon. Two sheets of the same numbers:
//   Data (tidy) — one row per element per day. Pivot-ready, and what Power BI wants.
//   Table (wide) — element rows down, one column per date across; reads like the
//                  screen when fully expanded.
// ════════════════════════════════════════════════════════════════
async function exportResultsFull(){
  const btn=document.getElementById('res-export-btn');
  const prev=btn?btn.textContent:'';
  const setMsg=t=>{ if(btn) btn.textContent=t; };
  try{
    const r=S.simResults;
    if(!r){ alert('Run a simulation first — there is no result data to export yet.'); return; }
    if(btn) btn.disabled=true;
    // Resolve the destination FIRST: showDirectoryPicker() and requestPermission()
    // need the click's user activation, which does not survive the awaits below.
    const dir=await exportDir('results',true);
    setMsg('Loading…');
    await loadLib('xlsx');
    setMsg('Building…');

    // Full horizon, every element on the canvas — not getResultElements(), which
    // applies the dock's facility/product narrowing.
    const horizon=S.simCfg.horizon||0;
    const days=[]; for(let d=1;d<=horizon;d++) days.push(d);
    const groups=_dtreeBuildGroups(r, days, getFacElements());
    const dates=days.map(d=>dayToDate(d));

    // ── Sheet 1: tidy ──────────────────────────────────────────────────────
    // Level tags let a pivot filter to just totals, just facilities, or just elements
    // without double-counting.
    const tidy=[];
    const push=(group,level,facility,element,i,v)=>{
      if(v===null||v===undefined||isNaN(v)) return;
      tidy.push({Group:group, Level:level, Facility:facility||'', Element:element||'',
                 Date:dates[i], Day:days[i], Value:Math.round(v*100)/100});
    };
    groups.forEach(g=>{
      (g.totals||[]).forEach((v,i)=>push(g.label,'Total','','',i,v));
      (g.facGroups||[]).forEach(fg=>{
        (fg.totals||[]).forEach((v,i)=>push(g.label,'Facility',fg.label,'',i,v));
        (fg.children||[]).forEach(c=>
          (c.days||[]).forEach((v,i)=>push(g.label,'Element',fg.label,c.label.trim(),i,v)));
      });
      // Flat groups (Rail Transfers / Imports) carry their own one- or two-level rows.
      (g.children||[]).forEach(c=>{
        const lvl=c.isGroup||c.isSectionHeader?'Facility':'Element';
        (c.days||[]).forEach((v,i)=>push(g.label,lvl,'',c.label.trim(),i,v));
        (c.children||[]).forEach(cc=>
          (cc.days||[]).forEach((v,i)=>push(g.label,'Element',c.label.trim(),cc.label.trim(),i,v)));
      });
    });

    // ── Sheet 2: wide ──────────────────────────────────────────────────────
    // Indentation in the Element column mirrors the on-screen hierarchy.
    const wide=[];
    const row=(group,level,label,arr)=>{
      const o={Group:group, Level:level, Element:label};
      dates.forEach((ds,i)=>{ const v=arr?arr[i]:null;
        o[ds]=(v===null||v===undefined||isNaN(v))?'':Math.round(v*100)/100; });
      wide.push(o);
    };
    groups.forEach(g=>{
      row(g.label,'Total',g.label,g.totals);
      (g.facGroups||[]).forEach(fg=>{
        row(g.label,'Facility','  '+fg.label,fg.totals);
        (fg.children||[]).forEach(c=>row(g.label,'Element','    '+c.label.trim(),c.days));
      });
      (g.children||[]).forEach(c=>{
        const lvl=c.isGroup||c.isSectionHeader?'Facility':'Element';
        row(g.label,lvl,'  '+c.label.trim(),c.totals||c.days);
        (c.children||[]).forEach(cc=>row(g.label,'Element','    '+cc.label.trim(),cc.days));
      });
    });

    const wb=XLSX.utils.book_new();
    const wsT=XLSX.utils.json_to_sheet(tidy.length?tidy:[{note:'(no rows)'}]);
    XLSX.utils.book_append_sheet(wb,wsT,'Data');
    const wsW=XLSX.utils.json_to_sheet(wide.length?wide:[{note:'(no rows)'}]);
    wsW['!cols']=[{wch:22},{wch:9},{wch:34}].concat(dates.map(()=>({wch:11})));
    XLSX.utils.book_append_sheet(wb,wsW,'Table');

    const from=dates[0]||'', to=dates[dates.length-1]||'';
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      {Field:'Exported',        Value:new Date().toISOString().slice(0,19).replace('T',' ')},
      {Field:'Scenario',        Value:(typeof scActive==='function'?scActive()?.name:'')||''},
      {Field:'Simulation start',Value:S.simCfg.start_date||''},
      {Field:'Horizon (days)',  Value:horizon},
      {Field:'Date range',      Value:from+' → '+to},
      {Field:'Groups',          Value:groups.length},
      {Field:'Scope',           Value:'Full dataset — all facilities, all processes, all products (filters not applied)'},
      {Field:'Data rows',       Value:tidy.length},
      {Field:'Table rows',      Value:wide.length}
    ]),'Info');

    // Same name, same folder, every time — the previous export is replaced.
    setMsg(dir?'Saving…':'Downloading…');
    const res=await exportWriteWorkbook('results',wb,dir);
    setMsg(res.saved?'✓ Saved':'✓ Downloaded');
    statMsg(res.saved
      ? 'Results exported → '+res.where
      : 'Downloaded '+res.where+' — set a folder in Configuration → Data Sources to save it in place');
    setTimeout(()=>setMsg(prev),2500);
  }catch(e){
    setMsg('Export failed');
    console.warn('exportResultsFull',e);
    alert('Export failed: '+e.message);
    setTimeout(()=>setMsg(prev),2500);
  }finally{
    if(btn) btn.disabled=false;
  }
}

// ═══════════════════════════════════════════════════════
// RESULTS DATE WINDOW — the shared time frame, as simulation days
// ═══════════════════════════════════════════════════════
// Kept under the old name because every results render already calls it.
function updateFacFilterBar(){ fltRender('res'); }

// {startDay, endDay}, 1-indexed simulation days of the shared time frame cut to the
// simulation — {startDay:1, endDay:0, empty:true} when they don't overlap (fltSimDayRange).
function getViewRange(){ return fltSimDayRange('res'); }

function dayToDate(day){
  const d=new Date(S.simCfg.start_date+'T00:00:00');
  d.setDate(d.getDate()+day-1);
  return d._ymd();
}

function _dashToggle(bodyId, hdrEl){
  const body=document.getElementById(bodyId); if(!body) return;
  const collapsed=body.style.display==='none';
  body.style.display=collapsed?'':'none';
  const arrow=hdrEl.querySelector('span[id$="-arrow"]');
  if(arrow) arrow.textContent=collapsed?'▼':'▶';
  // Redraw chart after expand (canvas needs dimensions)
  if(collapsed&&bodyId==='dash-clk-body'&&S.simResults){ _drawClinkerChart('dash-clk-chart',S.simResults); _attachTooltip('dash-clk-chart'); }
  if(collapsed&&bodyId==='dash-cem-body'&&S.simResults){ _drawProdBarChart('dash-cem-chart',S.simResults,'cement'); _attachTooltip('dash-cem-chart'); }
}

function renderDashCharts(r){
  if(!_IDX.depth) return _idxRun(()=>renderDashCharts.apply(this,arguments)); // fast lookups for this whole block
  if(!r) return;
  _clkSimResults=r; // cache current results so legend-toggle redraws use live data
  _chartRedrawFns['dash-clk-legend']=()=>{const rr=_clkSimResults||S.simResults;if(!rr)return;_drawClinkerChart('dash-clk-chart',rr);_attachTooltip('dash-clk-chart');};
  _chartRedrawFns['dash-cem-legend']=()=>{const rr=_clkSimResults||S.simResults;if(!rr)return;_drawProdBarChart('dash-cem-chart',rr,'cement');_attachTooltip('dash-cem-chart');};
  const clkBody=document.getElementById('dash-clk-body');
  const cemBody=document.getElementById('dash-cem-body');
  if(clkBody&&clkBody.style.display!=='none'){
    _drawClinkerChart('dash-clk-chart',r);
    _attachTooltip('dash-clk-chart');
  }
  if(cemBody&&cemBody.style.display!=='none'){
    _drawProdBarChart('dash-cem-chart',r,'cement');
    _attachTooltip('dash-cem-chart');
  }
}





// ── DATA TREE ─────────────────────────────────────────
const _dtreeCollapsed={};

// Data-tree level colours (shared by the builder and the renderer).
const C_L0='var(--mint)';   // level 0 group headers — green
const C_L1='var(--tangerine)';   // level 1 children — orange
const C_L2='var(--violet)';   // level 2 grandchildren — purple

// ── DATA-TREE GROUP BUILDER ──────────────────────────────────────────────────
// Builds the Daily Results tree for a given results object, a list of simulation day
// numbers, and a set of elements. Split out of renderDtree() so the same tree can be
// rebuilt for the Excel export at full horizon / all facilities while the on-screen
// table keeps using the view range and the active filters.
function _dtreeBuildGroups(r, days, fac){
  // Helper: get BOD inventory for a specific day for an element
  // BOD day N = EOD day N-1 = hist[N-2]; day 1 BOD = start_inventory
  const inv=(elId,day)=>{
    const simStart=new Date(S.simCfg.start_date+'T12:00:00'); // noon-anchored, DST-safe (see simStartDate)
    const currentDate=new Date(simStart.getTime()+(day-1)*864e5);
    const dateStr=currentDate._ymd();
    const prevDate=new Date(currentDate.getTime()-864e5);
    const prevDateStr=prevDate._ymd();

    // Check for ACTUAL inventory data - BOD inventory = EOD of previous day
    // So ONLY check previous day's real inventory (never check current date)
    let realInv=null;
    if(day>1){
      realInv=_idxFirst('real_inventory_daily','silo_id',elId,'date',prevDateStr);
    }
    if(realInv) return parseFloat(realInv.eod_volume_t)||0;

    // Fall back to simulated
    const hist=r.inventoryHistory[elId]||[];
    if(day<=1){
      const el=getEl(elId);
      return parseFloat(el?.props?.start_inventory)||0;
    }
    return hist[day-2]??null;
  };

  // Helper: get production rate for a transform element on a day
  const prod=(elId,day)=>{
    const simStart=new Date(S.simCfg.start_date+'T12:00:00'); // noon-anchored, DST-safe (see simStartDate)
    const currentDate=new Date(simStart.getTime()+(day-1)*864e5);
    const dateStr=currentDate._ymd();

    // Check for ACTUAL production data first
    const realProduction=_dedupRealProd(elId, dateStr);
    if(realProduction.length>0){
      return realProduction.reduce((sum,r)=>sum+(parseFloat(r.volume_t)||0),0);
    }

    // Fall back to simulated
    const states=r.elementStates[elId]||[];
    const st=states[day-1]||'idle';
    if(st!=='running'&&st!=='rampup') return 0;
    const el=getEl(elId);
    if(!el) return 0;
    // Finish mills: use only the active product's capacity
    if(el.type==='finish_mill'&&r.millProductHistory?.[elId]){
      const activeProd=r.millProductHistory[elId][day-1];
      if(activeProd){
        const cap=DB.element_product_capacities.find(c=>c.element_id===elId&&c.product_id===activeProd);
        return cap?.capacity_tpd||0;
      }
      return 0;
    }
    // All other transform elements: sum all caps
    const caps=DB.element_product_capacities.filter(c=>c.element_id===elId);
    return caps.length?caps.reduce((a,c)=>a+(c.capacity_tpd||0),0):parseFloat(el?.props.rated_capacity_tpd)||0;
  };

  // Build the tree structure from topology
  const kilns=fac.filter(e=>e.type==='kiln');
  const fms=fac.filter(e=>e.type==='finish_mill');
  const clinkerSilos=fac.filter(e=>e.type==='bulk_silo'&&isClinkerSilo(e));
  const cementSilos=fac.filter(e=>e.type==='bulk_silo'&&isCementSilo(e));

  // ── HELPER: build a demand group for any set of demand_point elements ──


  // ── COLORS BY LEVEL ──────────────────────────────────

  // ─────────────────────────────────────────────────────
  // UNIVERSAL 7-GROUP SCHEMA
  // fac = getResultElements() — already filtered to the active facFilter.
  // All 7 groups are always attempted in the same order.
  // A group is added only if it has at least one non-zero value.
  // Children come from `fac` regardless of whether it's BRS or a terminal.
  // ─────────────────────────────────────────────────────
  const groups=[];

  // ── 1. CEM DEMAND ────────────────────────────────────
  const allDemEls=fac.filter(e=>e.type==='demand_point');
  // Group demand elements by facility
  const demByFac={};
  allDemEls.forEach(el=>{
    const facId=el.assigned_facility_id||S.facility_id;
    if(!demByFac[facId]) demByFac[facId]=[];
    demByFac[facId].push(el);
  });
  if(Object.keys(demByFac).length){
    const facGroups=Object.entries(demByFac).map(([facId,els])=>{
      const facName=DB.facilities.find(f=>f.id===facId)?.name||facId;
      // Sort demand points alphabetically by name
      const sortedEls=[...els].sort((a,b)=>a.name.localeCompare(b.name));
      const children=sortedEls.map(el=>{
        return {id:`dem_el_${el.id}`,label:el.name,days:days.map(d=>{
          const dt=new Date(S.simCfg.start_date+'T00:00:00');dt.setDate(dt.getDate()+(d-1));
          return _demandRate(el.id,dt._ymd());
        }),color:C_L2,isRate:true};
      });
      const subtotals=days.map((_,i)=>children.reduce((s,c)=>s+(c.days[i]||0),0));
      return {id:`dem_fac_${facId}`,label:facName,color:C_L1,children,totals:subtotals,isFacHeader:true};
    });
    const grandTotals=days.map((_,i)=>facGroups.reduce((s,g)=>s+g.totals[i],0));
    groups.push({id:'demand_total',label:'CEM Demand / Total',color:C_L0,facGroups,totals:grandTotals});
  }

  // Helper: group elements by facility and build facGroups structure
  function buildFacGroups(els, childFn, groupId, groupLabel){
    const byFac={};
    els.forEach(el=>{
      const facId=el.assigned_facility_id||S.facility_id;
      if(!byFac[facId]) byFac[facId]=[];
      byFac[facId].push(el);
    });
    if(!Object.keys(byFac).length) return null;
    const facGroups=Object.entries(byFac).map(([facId,facEls])=>{
      const facName=DB.facilities.find(f=>f.id===facId)?.name||facId;
      const children=facEls.map(el=>childFn(el));
      const subtotals=days.map((_,i)=>children.reduce((s,c)=>s+(c.days[i]??0),0));
      return {id:`${groupId}_fac_${facId}`,label:facName,color:C_L1,children,totals:subtotals,isFacHeader:true};
    });
    const grandTotals=days.map((_,i)=>facGroups.reduce((s,g)=>s+g.totals[i],0));
    if(!grandTotals.some(v=>v>0)) return null;
    return {id:groupId,label:groupLabel,color:C_L0,facGroups,totals:grandTotals};
  }

  // ── 2. CLK DEMAND ────────────────────────────────────
  if(fms.length){
    const clkReqGroup=buildFacGroups(fms, fm=>({
      id:`clk_req_${fm.id}`,label:`CLK Req → ${fm.name}`,color:C_L2,isRate:true,
      days:days.map(d=>{
        const rate=prod(fm.id,d); if(!rate) return 0;
        const activeProd=r.millProductHistory?.[fm.id]?.[d-1]||null; if(!activeProd) return 0;
        const recipe=DB.recipes.filter(ri=>ri.product_id===activeProd&&parseFloat(ri.pct)>0);
        const clkIng=recipe.find(ri=>DB.products.find(p=>p.id===ri.material_id)?.category==='clinker'||ri.material_id==='clinker');
        return Math.round(rate*(clkIng?clkIng.pct/100:0));
      })
    }),'clk_req','CLK Demand / Total');
    if(clkReqGroup) groups.push(clkReqGroup);
  }

  // ── 3. CLK INVENTORY ─────────────────────────────────
  if(clinkerSilos.length){
    const clkInvGroup=buildFacGroups(clinkerSilos,
      el=>({id:`clk_inv_${el.id}`,label:el.name,color:C_L2,isRate:false,days:days.map(d=>inv(el.id,d))}),
      'clk_inv','CLK Inventory');
    if(clkInvGroup) groups.push(clkInvGroup);
  }

  // ── 4. CLK PRODUCTION ────────────────────────────────
  if(kilns.length){
    const clkProdGroup=buildFacGroups(kilns,
      el=>({id:`clk_prod_${el.id}`,label:el.name,color:C_L2,isRate:true,days:days.map(d=>prod(el.id,d))}),
      'clk_prod','CLK Production / Total');
    if(clkProdGroup) groups.push(clkProdGroup);
  }

  // ── 5. CEM INVENTORY ─────────────────────────────────
  if(cementSilos.length){
    const cemInvGroup=buildFacGroups(cementSilos,
      el=>({id:`cem_inv_${el.id}`,label:el.name,color:C_L2,isRate:false,days:days.map(d=>inv(el.id,d))}),
      'cem_inv','CEM Inventory / Total');
    if(cemInvGroup) groups.push(cemInvGroup);
  }

  // ── 6. CEM PRODUCTION ────────────────────────────────
  if(fms.length){
    const productColors={};
    const palColors=[C_L2,'var(--amber)','var(--blue)','var(--magenta)','var(--orange)'];
    let palIdx=0;
    DB.products.forEach(p=>{ productColors[p.id]=palColors[palIdx++%palColors.length]; });
    const cemProdGroup=buildFacGroups(fms, el=>({
      id:`cem_prod_${el.id}`,label:el.name,color:C_L2,isRate:true,
      days:days.map(d=>prod(el.id,d)),
      dayProducts:days.map(d=>{const ph=r.millProductHistory?.[el.id];return ph?ph[d-1]||null:null;}),
      productColors
    }),'cem_prod','CEM Production / Total');
    if(cemProdGroup) groups.push(cemProdGroup);
  }

  // ── 7a. RAIL TRANSFERS (one group per origin facility) ──
  // For each facility that has Rail dispatch_points in `fac`, create a
  // separate group "Rail Transfers from <Origin>" with per-destination rows.
  {
    const allEls=getFacElements();
    // Group dispatch elements by their origin facility
    const dispByOrigin={};
    fac.filter(e=>e.type==='dispatch_point'&&e.props?.dispatch_type==='Rail').forEach(dispEl=>{
      const origId=dispEl.assigned_facility_id||dispEl.facility_id||S.facility_id;
      if(!dispByOrigin[origId]) dispByOrigin[origId]=[];
      dispByOrigin[origId].push(dispEl);
    });

    Object.entries(dispByOrigin)
      .sort(([a],[b])=>(DB.facilities.find(f=>f.id===a)?.name||a)
                       .localeCompare(DB.facilities.find(f=>f.id===b)?.name||b))
      .forEach(([origId,dispEls])=>{
        const origName=DB.facilities.find(f=>f.id===origId)?.name||origId;
        const railChildren=[];

        dispEls.forEach(dispEl=>{
          const rh=r.railHistory?.[dispEl.id]||[];
          const dests=dispEl.props.destinations||[];
          const carCap=parseFloat(dispEl.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
          dests.forEach(dest=>{
            const destFacName=DB.facilities.find(f=>f.id===dest.facility_id)?.name||'?';
            railChildren.push({
              id:`rail_dest_t_${dispEl.id}_${dest.facility_id}`,
              label:`  → ${destFacName} (${dest.transit_days||1}d transit)`,
              days:days.map(d=>{
                const cars=rh[d-1]?.dispatchByDest?.[dest.facility_id]||0;
                return cars>0?cars*carCap:null;
              }),
              color:C_L1, isRate:false
            });
          });
        });

        if(!railChildren.length) return;
        const totals=days.map((_,i)=>railChildren.reduce((s,c)=>s+(c.days[i]||0),0));
        if(!totals.some(v=>v>0)) return;
        groups.push({
          id:`cem_rail_from_${origId}`,
          label:`Rail Transfers from ${origName}`,
          color:C_L0, children:railChildren, totals
        });
      });
  }

  // ── 7b. IMPORTS (inbound by terminal → product) ──────
  {
    const allEls=getFacElements();
    const importChildren=[];

    // Group berths in `fac` by their terminal facility
    const berthsByTerminal={};
    fac.filter(e=>e.type==='berth').forEach(berth=>{
      const termId=berth.assigned_facility_id||berth.facility_id||S.facility_id;
      if(!berthsByTerminal[termId]) berthsByTerminal[termId]=[];
      berthsByTerminal[termId].push(berth);
    });

    Object.entries(berthsByTerminal)
      .sort(([a],[b])=>(DB.facilities.find(f=>f.id===a)?.name||a)
                       .localeCompare(DB.facilities.find(f=>f.id===b)?.name||b))
      .forEach(([termId,berths])=>{
        const termName=DB.facilities.find(f=>f.id===termId)?.name||termId;

        // Aggregate per-product unload across all silos downstream of berths in this terminal
        const prodUnload={}; // prodId -> days array of cumulative tonnes
        berths.forEach(berth=>{
          const downSilos=allEls.filter(e=>e.type==='bulk_silo'&&
            DB.connections.some(c=>c.from_element_id===berth.id&&c.to_element_id===e.id));
          downSilos.forEach(silo=>{
            const unloadArr=days.map(d=>(r.siloUnloadHistory?.[silo.id]||[])[d-1]||0);
            if(!unloadArr.some(v=>v>0)) return;
            const prods=getSiloProducts(silo);
            const prodKeys=prods.length?prods:['__unknown__'];
            const share=1/prodKeys.length;
            prodKeys.forEach(pid=>{
              if(!prodUnload[pid]) prodUnload[pid]=days.map(()=>0);
              unloadArr.forEach((v,i)=>{ prodUnload[pid][i]+=v*share; });
            });
          });
        });

        if(!Object.keys(prodUnload).length) return;
        const termTotals=days.map((_,i)=>Object.values(prodUnload).reduce((s,a)=>s+a[i],0));
        if(!termTotals.some(v=>v>0)) return;

        // Terminal header row
        importChildren.push({
          id:`import_term_${termId}`, label:termName,
          days:termTotals,
          color:C_L1, isRate:true, isSectionHeader:true
        });

        // Per-product rows, sorted alphabetically
        Object.entries(prodUnload)
          .sort(([a],[b])=>{
            const na=a==='__unknown__'?'ZZZ':DB.products.find(p=>p.id===a)?.name||a;
            const nb=b==='__unknown__'?'ZZZ':DB.products.find(p=>p.id===b)?.name||b;
            return na.localeCompare(nb);
          })
          .forEach(([pid,arr])=>{
            const prodName=pid==='__unknown__'?'(Other)':DB.products.find(p=>p.id===pid)?.name||pid;
            importChildren.push({
              id:`import_prod_${termId}_${pid}`,
              label:`  ${prodName}`,
              days:arr.map(v=>v>0?Math.round(v*10)/10:null),
              color:C_L2, isRate:true
            });
          });
      });

    if(importChildren.length){
      const importTotals=days.map((_,i)=>
        importChildren.filter(c=>c.isSectionHeader).reduce((s,c)=>s+(c.days[i]||0),0));
      groups.push({id:'cem_imports',label:'Imports',color:C_L0,
        children:importChildren,totals:importTotals});
    }
  }
  return groups;
}

function renderDtree(r){
  if(!_IDX.depth) return _idxRun(()=>renderDtree.apply(this,arguments)); // fast lookups for this whole block
  const wrap=document.getElementById('dtree-wrap'); if(!wrap) return;
  if(!r){wrap.innerHTML='<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding:14px">Run simulation to see data tree</div>';return;}

  // Ensure demand display uses the same values the sim used
  _demandCacheInvalidate();

  const {startDay,endDay}=getViewRange();
  if(endDay<startDay){wrap.innerHTML='<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding:14px">No simulated days in this time frame.</div>';return;}
  const fac=getResultElements();
  const simStart=new Date(S.simCfg.start_date+'T00:00:00');

  // Build column headers (dates)
  const days=[];
  for(let d=startDay;d<=endDay;d++) days.push(d);

  // The 7-group tree is built by _dtreeBuildGroups() so the XLSX exporter can rebuild
  // it over the full horizon and every facility, independent of what is on screen.
  let groups=_dtreeBuildGroups(r, days, fac);
  // Process filter — drop whole level-0 groups the user has switched off.
  groups=groups.filter(g=>!resGroupHidden(g.id));

  // ── RENDER TABLE ──
  // Date headers — one column per day, always
  const shownDays=days;

  // Weekend detection helper
  const getDow=d=>{
    const dt=new Date(S.simCfg.start_date+'T00:00:00');
    dt.setDate(dt.getDate()+(d-1));
    return (dt.getDay()+6)%7; // Mon=0 ... Sat=5, Sun=6
  };
  const isSat=d=>getDow(d)===5;
  const isSun=d=>getDow(d)===6;
  const wkendThStyle=d=>
    isSat(d)?'border-left:2px solid rgba(255,80,80,0.5);background:rgba(255,80,80,0.05)':
    isSun(d)?'border-right:2px solid rgba(255,80,80,0.5);background:rgba(255,80,80,0.05)':'';
  const wkendTdStyle=d=>
    isSat(d)?'border-left:2px solid rgba(255,80,80,0.35);background:rgba(255,80,80,0.04)':
    isSun(d)?'border-right:2px solid rgba(255,80,80,0.35);background:rgba(255,80,80,0.04)':'';

  // ── Month grouping → summary columns + per-month collapse ──
  // Each month gets a leading summary cell; clicking its header hides/shows that month's day columns.
  const monthsD=[];
  days.forEach((d,i)=>{
    const ds=dayToDate(d); const ym=ds.slice(0,7);
    let mon=monthsD.find(m=>m.ym===ym);
    if(!mon){mon={ym,label:new Date(ds+'T00:00:00').toLocaleDateString('en',{month:'short',year:'2-digit'}),idxs:[],dayNums:[]};monthsD.push(mon);}
    mon.idxs.push(i); mon.dayNums.push(d);
  });
  const monCol=(window._dtreeMonCol=window._dtreeMonCol||new Set());
  // Every month except the current one starts collapsed so the page opens compact.
  // Decided once per month, the first time the time frame brings it into view — so a
  // month the user opened or closed keeps that state when the time frame changes.
  const _monSeen=(window._dtreeMonSeen=window._dtreeMonSeen||new Set());
  const curYm=new Date()._ymd().slice(0,7);
  monthsD.forEach(m=>{
    if(_monSeen.has(m.ym)) return;
    _monSeen.add(m.ym);
    if(m.ym!==curYm) monCol.add(m.ym);
  });
  const isLevelId=id=>/_inv\b|_inv_|inventor/i.test(id||''); // inventory rows summarize as end-of-month, others as monthly total
  // Year boundaries: a Σ YYYY column follows the last month of each year (inventory
  // years read the last snapshot; flows sum). yearEndIdx[i]=true if month i ends its year.
  const yearEndIdx=monthsD.map((mon,i)=>i===monthsD.length-1||monthsD[i+1].ym.slice(0,4)!==mon.ym.slice(0,4));
  const nYears=yearEndIdx.filter(Boolean).length;
  const visCols=monthsD.reduce((s,mon)=>s+1+(monCol.has(mon.ym)?0:mon.dayNums.length),0)+nYears;
  const _msumSty='background:var(--total-faint);border-left:2px solid var(--border2);font-weight:700;text-align:right;padding:4px 8px;';
  const _ysumSty='background:var(--total-faint);border-left:3px double var(--border2);font-weight:700;text-align:right;padding:4px 9px;';
  // Build a row's cells: that month's day cells (unless collapsed), then the month
  // summary cell; after each year's final month, a heavier Σ YYYY cell.
  const monCells=(valArr,agg,dayCellFn,sumColor)=>{
    let out='', yearVals=[];
    monthsD.forEach((mon,mi)=>{
      const isCol=monCol.has(mon.ym);
      const vals=mon.idxs.map(i=>valArr?valArr[i]:null).filter(v=>v!==null&&v!==undefined&&!isNaN(v));
      let sv=null;
      if(vals.length) sv=agg==='last'?vals[vals.length-1]:vals.reduce((a,b)=>a+b,0);
      const sumTd=`<td class="dtree-mcol" style="${_msumSty}color:${sumColor||'var(--total)'}">${sv!==null?Number(Math.round(sv)).toLocaleString():'—'}</td>`;
      const dayTds=isCol?'':mon.dayNums.map(dayCellFn).join('');
      out+=dayTds+sumTd;
      yearVals=yearVals.concat(vals);
      if(yearEndIdx[mi]){
        let yv=null;
        if(yearVals.length) yv=agg==='last'?yearVals[yearVals.length-1]:yearVals.reduce((a,b)=>a+b,0);
        out+=`<td class="dtree-ycol" style="${_ysumSty}color:${sumColor||'var(--total)'}">${yv!==null?Number(Math.round(yv)).toLocaleString():'—'}</td>`;
        yearVals=[];
      }
    });
    return out;
  };
  const monHeaderCells=(()=>{ let out='';
    monthsD.forEach((mon,mi)=>{
      const isCol=monCol.has(mon.ym);
      const sumTh=`<th class="dtree-mcol" onclick="_dtreeToggleMonth('${mon.ym}')" title="Click to ${isCol?'expand':'collapse'} ${mon.label}" style="cursor:pointer;user-select:none;background:var(--surface2);border-left:2px solid var(--border2);font-weight:700;color:var(--total);text-align:center;padding:6px 6px;position:sticky;top:0;z-index:3"><span style="margin-right:3px">${isCol?'▶':'▼'}</span>${mon.label}</th>`;
      const dayThs=isCol?'':mon.dayNums.map(d=>`<th title="Day ${d}" style="${wkendThStyle(d)}">${dayToDate(d).slice(5)}</th>`).join('');
      out+=dayThs+sumTh;
      if(yearEndIdx[mi]) out+=`<th class="dtree-ycol" title="Full-year ${mon.ym.slice(0,4)} total" style="background:var(--surface2);border-left:3px double var(--border2);font-weight:700;color:var(--total);text-align:center;padding:6px 7px;position:sticky;top:0;z-index:3">Σ ${mon.ym.slice(0,4)}</th>`;
    });
    return out; })();

  let h=`<table class="dtree-table"><thead><tr>
    <th class="th-label">Element</th>
    ${monHeaderCells}
  </tr></thead><tbody>`;

  const fmtVal=(v, isRate, unit, dayIdx, c, d)=>{
    const wk=d?wkendTdStyle(d):'';
    const wkAttr=wk?` style="${wk}"`:'';
    if(v===null||v===undefined) return `<td class="cell-dim"${wkAttr}>—</td>`;
    if(unit==='cars') return `<td style="color:var(--blue);${wk}">${v>0?v:'—'}</td>`;
    if(unit==='active') return `<td style="color:var(--text-dim);${wk}">${v?'●':'—'}</td>`;
    if(v===0) return `<td class="cell-dim"${wkAttr}>—</td>`;
    // Color-code finish mill production cells by active product
    if(c?.dayProducts&&c.dayProducts[dayIdx]!==null){
      const pid=c.dayProducts[dayIdx];
      const col=(c.productColors||{})[pid]||'var(--green)';
      const pname=DB.products.find(p=>p.id===pid)?.name||pid;
      return `<td style="color:${col};${wk}" title="${pname}">${Number(v).toLocaleString()}</td>`;
    }
    return `<td${wkAttr}>${Number(v).toLocaleString()}</td>`;
  };

  // The tree opens fully collapsed — every level-0 group, every facility row and every
  // nested sub-group — so the page starts as a short list of headings and the user
  // expands only what they need. A key already present means the user has toggled that
  // row before, and their choice wins.
  const _seed=id=>{ if(!Object.prototype.hasOwnProperty.call(_dtreeCollapsed,id)) _dtreeCollapsed[id]=true; };
  groups.forEach(g=>{
    _seed(g.id);
    (g.facGroups||[]).forEach(fg=>_seed(fg.id));
    (g.children||[]).forEach(c=>{ if(c.isGroup) _seed(c.id); });
  });

  groups.forEach(g=>{
    const collapsed=_dtreeCollapsed[g.id];
    h+=`<tr class="dtree-row-group" onclick="toggleDtreeGroup('${g.id}')">
      <td class="td-label" style="color:${C_L0}">
        <span class="dtree-expand ${collapsed?'':'open'}" id="dtx-${g.id}">▶</span>
        ${g.label}
      </td>
      ${g.totals&&g.totals.some(v=>v!==null&&v!==undefined)
        ? monCells(g.totals, isLevelId(g.id)?'last':'sum', d=>{const i=days.indexOf(d);const v=g.totals[i]??null;const wk=wkendTdStyle(d);
            return `<td style="color:${C_L0};font-weight:500;${wk}">${v!==null&&v!==undefined?Number(v).toLocaleString():'0'}</td>`;
          }, C_L0)
        : `<td colspan="${visCols}"></td>`}
    </tr>`;

    // Groups with facGroups: L0 → L1(facility, blue) → L2(element, orange)
    if(g.facGroups){
      g.facGroups.forEach(fg=>{
        const facCollapsed=_dtreeCollapsed[fg.id];
        h+=`<tr class="dtree-row-child ${collapsed?'hidden':''}" id="dtc-${g.id}"
              style="cursor:pointer" onclick="event.stopPropagation();toggleDtreeGroup('${fg.id}')">
          <td class="td-label" style="color:${C_L1};padding-left:18px">
            <span class="dtree-expand ${facCollapsed?'':'open'}" id="dtx-${fg.id}" style="font-size:8px">▶</span>
            ${fg.label}
          </td>
          ${monCells(fg.totals, isLevelId(g.id)?'last':'sum', d=>{const i=days.indexOf(d);const v=fg.totals[i]??null;const wk=wkendTdStyle(d);
            return `<td style="color:${C_L1};${wk}">${v!==null&&v!==undefined?Number(v).toLocaleString():'0'}</td>`;
          }, C_L1)}
        </tr>`;
        (fg.children||[]).forEach(c=>{
          h+=`<tr class="dtree-row-child ${collapsed||facCollapsed?'hidden':''}" id="dtc-${fg.id}">
            <td class="td-label" style="color:${C_L2};padding-left:36px">${c.label}</td>
            ${monCells(c.days, isLevelId(g.id)?'last':'sum', d=>fmtVal(c.days[days.indexOf(d)],c.isRate,c.unit,days.indexOf(d),c,d), C_L2)}
          </tr>`;
        });
      });
      return;
    }

    // Groups with flat children (transfers/imports)
    (g.children||[]).forEach(c=>{
      if(c.isGroup){
        const subCollapsed=_dtreeCollapsed[c.id];
        h+=`<tr class="dtree-row-child ${collapsed?'hidden':''}" id="dtc-${g.id}"
              style="cursor:pointer" onclick="toggleDtreeGroup('${c.id}')">
          <td class="td-label" style="color:${C_L1};padding-left:18px">
            <span class="dtree-expand ${subCollapsed?'':'open'}" id="dtx-${c.id}" style="font-size:8px">▶</span>
            ${c.label}
          </td>
          ${c.totals
            ? monCells(c.totals, 'sum', d=>{const i=days.indexOf(d);const v=c.totals[i]??0;return `<td style="color:${C_L1}">${v>0?Number(v).toLocaleString():'—'}</td>`;}, C_L1)
            : `<td colspan="${visCols}"></td>`}
        </tr>`;
        (c.children||[]).forEach(sc=>{
          h+=`<tr class="dtree-row-child ${collapsed||subCollapsed?'hidden':''}" id="dtc-${c.id}">
            <td class="td-label" style="color:${C_L2};padding-left:36px">${sc.label}</td>
            ${monCells(sc.days, 'sum', d=>fmtVal(sc.days[days.indexOf(d)],sc.isRate,sc.unit,days.indexOf(d),sc,d), C_L2)}
          </tr>`;
        });
      } else if(c.isSectionHeader){
        h+=`<tr class="dtree-row-child ${collapsed?'hidden':''}" id="dtc-${g.id}" style="border-top:1px solid var(--border2)">
          <td class="td-label" style="color:${C_L1};font-weight:500;padding-left:18px">${c.label}</td>
          ${monCells(c.days, 'sum', d=>{const v=c.days[days.indexOf(d)];const wk=wkendTdStyle(d);
            return `<td style="color:${C_L1};font-weight:500;${wk}">${v!==null&&v!==undefined?Number(v).toLocaleString()+(c.unit?' '+c.unit:''):'0'}</td>`;
          }, C_L1)}
        </tr>`;
      } else {
        const rowColor=c.color===C_L2?C_L2:C_L1;
        const rowPad=c.color===C_L2?'padding-left:36px':'padding-left:18px';
        h+=`<tr class="dtree-row-child ${collapsed?'hidden':''}" id="dtc-${g.id}">
          <td class="td-label" style="color:${rowColor};${rowPad}">${c.label}</td>
          ${monCells(c.days, 'sum', d=>fmtVal(c.days[days.indexOf(d)],c.isRate,c.unit,days.indexOf(d),c,d), rowColor)}
        </tr>`;
      }
    });
  });

  h+=`</tbody></table>`;
  wrap.innerHTML=h;
}

// Collapse / expand a month's daily columns in the Dashboard (data tree) table.
function _dtreeToggleMonth(ym){
  if(!window._dtreeMonCol) window._dtreeMonCol=new Set();
  if(window._dtreeMonCol.has(ym)) window._dtreeMonCol.delete(ym);
  else window._dtreeMonCol.add(ym);
  renderDtree(S.simResults);
}

function toggleDtreeGroup(gid){
  _dtreeCollapsed[gid]=!_dtreeCollapsed[gid];
  document.querySelectorAll(`#dtc-${gid}`).forEach(row=>{
    row.classList.toggle('hidden',!!_dtreeCollapsed[gid]);
  });
  const icon=document.getElementById(`dtx-${gid}`);
  if(icon) icon.classList.toggle('open',!_dtreeCollapsed[gid]);
}




