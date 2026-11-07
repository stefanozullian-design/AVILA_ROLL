// ═══════════════════════════════════════════════════════
// SAVE / LOAD
// ═══════════════════════════════════════════════════════
// Debounced save — every mutation path calls autoSave(); the actual
// serialization (full DB → localStorage) runs once per 500ms burst.
// beforeunload flushes a pending save so closing the tab never loses an edit.
let _autoSaveTimer=null;
// The save stamp (savedAt) says WHEN THE DATA LAST CHANGED, and the shared-file merge relies on
// it to spot an out-of-date copy coming back (_mgIsStale). So it only advances for real edits:
// autoSave({keepStamp:true}) — the save after a simulation run — writes the same data under the
// previous stamp. Before this, every simulation re-stamped the data as new, so an old tab left
// open on another computer could push hours-old data that looked like the latest.
let _autoSaveStampDue=false;
function autoSave(opts){
  if(!(opts&&opts.keepStamp)) _autoSaveStampDue=true;
  _rollPublishCatalogSoon();   // keep the Sales page's copy of this scenario's catalog current
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer=setTimeout(()=>{_autoSaveTimer=null;autoSaveNow();},500);
}
// Flush BOTH pending saves: the localStorage debounce AND the scenario file's
// own write debounce (SC._writeTimer, ~500ms — see scScheduleWrite). Without
// this, closing/backgrounding the tab right after an edit could flush the
// localStorage copy but drop the disk write entirely, leaving the saved .json
// file one edit behind (e.g. an old topology) even though "Saved" showed.
function _flushPendingSaves(){
  if(_autoSaveTimer){clearTimeout(_autoSaveTimer);_autoSaveTimer=null;autoSaveNow();}
  if(typeof SC!=='undefined' && SC.activeId && SC.handles[SC.activeId]){
    clearTimeout(SC._writeTimer);SC._writeTimer=null;
    scWriteActive();
  }
}
window.addEventListener('beforeunload',(e)=>{
  _flushPendingSaves();
  // If the scenario file's last write attempt failed (e.g. a stale cloud-sync
  // handle that survived the retries in scWriteActive), the only copy of the
  // latest edits is this tab's memory/localStorage — warn before it's gone.
  if(typeof SC!=='undefined' && SC._lastStatus==='error'){
    e.preventDefault();
    e.returnValue='Your latest changes failed to save to the scenario file — closing now may lose them.';
  }
});
// visibilitychange/pagehide fire reliably (unlike beforeunload) when a tab is
// closed, switched away from, or backgrounded on mobile — the recommended
// point to flush pending writes since async work can still run briefly here.
document.addEventListener('visibilitychange',()=>{ if(document.hidden) _flushPendingSaves(); });
window.addEventListener('pagehide',_flushPendingSaves);

// localStorage is a CRASH-RECOVERY MIRROR, not the source of truth — the active
// scenario's .json file is. It is capped near 5MB in real Chrome, and on live data
// real_shipments_daily alone runs past 11MB, so the mirror cannot hold everything.
// Tables it has to leave out are listed in the saved payload as _partialTables, and
// loadSaved republishes that list as window._dbPartialTables. Everything downstream
// MUST consult that list rather than assuming "absent from memory" means "deleted" —
// that inference is what silently wiped element_product_capacities from users' files.
const LS_SKIP_ALWAYS = new Set(['real_shipments_daily']);
// Bulky per-day data dropped only when the full mirror won't fit. This is a DENY-list
// on purpose: the previous compact mode was an allow-list of 24 tables and silently
// dropped the other 28 — including element_product_capacities, production_campaigns,
// mill_policies and demand_substitutions — and every table added later inherited the
// bug. Structural/config tables are now kept by default; only volume data is shed.
const LS_SKIP_COMPACT = new Set([...LS_SKIP_ALWAYS,
  'real_shipments_meta','real_transfers_file_daily','forecast_commitments','plan_demand',
  'real_production_daily','real_inventory_daily','real_transfers_daily','real_silo_transfers_daily',
  'real_rail_daily','real_shipping_daily','real_unloading_daily']);
// Rolling window for the high-volume daily tables, applied to the SAVED COPY only.
const LS_TRIM_90D = new Set(['real_production_daily','real_inventory_daily','real_transfers_daily','real_silo_transfers_daily',
  'real_rail_daily','real_shipping_daily','real_unloading_daily']);

function autoSaveNow(){
  // Only regenerated-on-run tables are transient. Real data (production,
  // shipments, etc.) belongs to the app once imported — it is persisted so the
  // app stands alone without re-reading the external files.
  const TRANSIENT_TABLES = new Set([
    'simulation_day_states',  // regenerated on Run Simulation
    'simulation_inventory',   // regenerated on Run Simulation
    'simulation_stop_events', // regenerated on Run Simulation
    'simulation_runs',        // regenerated on Run Simulation
    'in_transit_inventory',   // computed from schedules
  ]);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);
  const cutoffStr = cutoffDate._ymd();

  // Stamp every save so startup can tell whether localStorage or the topology
  // file is the newer copy (used by the stale-file safety net in dsIngestTopology).
  const _saveStamp = (_autoSaveStampDue || !window._lastSaveStamp) ? new Date().toISOString() : window._lastSaveStamp;
  _autoSaveStampDue = false;
  window._lastSaveStamp = _saveStamp;

  // Build the mirror WITHOUT touching DB. The previous version filtered
  // DB.real_*_daily in place, so every autosave permanently deleted >90-day rows
  // from memory and the next scenario write pushed that truncation to disk.
  const build=(skip)=>{
    const out={}, dropped=[];
    Object.keys(DB).forEach(k=>{
      if(TRANSIENT_TABLES.has(k)) return;
      if(skip.has(k)){ if(Array.isArray(DB[k]) && DB[k].length) dropped.push(k); return; }
      const v=DB[k];
      out[k]=(LS_TRIM_90D.has(k) && Array.isArray(v)) ? v.filter(r=>r.date>=cutoffStr) : v;
    });
    return {out, dropped};
  };
  // Write without destroying the existing cache on failure. The old code called
  // removeItem() up front, so if the write then threw, localStorage was left EMPTY
  // and a crash at that moment lost everything not yet in the scenario file. Now the
  // previous entry is only dropped to make room, and is put back if the retry fails.
  const put=(b)=>{
    const text=JSON.stringify({
      DB: b.out,
      counter: S.elCounter,
      simCfg: S.simCfg,
      // simResults intentionally NOT persisted to localStorage (large, regenerated
      // on load; the active scenario file still carries a copy — see scWriteActive)
      savedAt: _saveStamp,
      _partialTables: b.dropped,
      // Which scenario this copy is of — so startup never takes it for another scenario's copy
      // (see _scLoadForeign).
      scId: (typeof SC!=='undefined' && SC.activeId) || null,
      // Which synced version of the file this copy was built from — at startup a copy built from
      // an OLDER sync is not "local edits" (it only lacks what arrived later); see scLoadScenario.
      scBase: (typeof _scBaseTag==='function') ? _scBaseTag() : null
    });
    try{
      localStorage.setItem('prodcast_v3', text);
    }catch(e){
      const prev=localStorage.getItem('prodcast_v3');   // keep a copy to roll back to
      localStorage.removeItem('prodcast_v3');           // the old entry may BE the blocker
      try{
        localStorage.setItem('prodcast_v3', text);
      }catch(e2){
        if(prev!=null){ try{ localStorage.setItem('prodcast_v3', prev); }catch(e3){} }
        throw e2;
      }
    }
  };

  try{
    put(build(LS_SKIP_ALWAYS));
    window._lsScId=(typeof SC!=='undefined' && SC.activeId) || null;   // what the cache now holds (see put)
    statMsg('Saved');
  }catch(e){
    console.warn('autoSave: full mirror exceeded quota — retrying compact', e);
    try{
      const b=build(LS_SKIP_COMPACT);
      put(b);
      window._lsScId=(typeof SC!=='undefined' && SC.activeId) || null;
      statMsg('Saved (compact — '+b.dropped.length+' data table'+(b.dropped.length===1?'':'s')+' live in the scenario file only)');
    }catch(e2){
      console.error('Minimal save also failed:', e2);
      statMsg('⚠ Save failed — localStorage full');
      return; // nothing cached; do NOT push this state at the file either
    }
  }
  // Fire-and-forget: if any writable Data Source slot is connected, schedule
  // a debounced write so the picked file mirrors localStorage.
  if(typeof dsScheduleAllWrites === 'function') dsScheduleAllWrites();
  // Mirror the in-memory state into the ACTIVE scenario's file (debounced).
  // Reached on the compact path too — the old code returned early here, leaving
  // the file stale while still advancing _lastSaveStamp, which then made the
  // startup guard believe the truncated cache was newer than the good file.
  if(typeof scScheduleWrite === 'function') scScheduleWrite();
}

function loadSaved(){
  // Defensive table initialisers. These used to sit at the bottom of this
  // function, after an unconditional `return`, so they had never actually run;
  // hoisted here so they do. (The legacy element-type / daily_tonnage migrations
  // that shared that dead block were deliberately NOT revived — they have never
  // executed against this data and switching them on now would be a silent
  // behaviour change, not a cleanup.)
  if(!DB.real_shipments_daily) DB.real_shipments_daily=[];
  if(!DB.real_shipments_meta)  DB.real_shipments_meta={};
  if(!DB.real_transfers_file_daily) DB.real_transfers_file_daily=[];
  if(!DB.real_transfers_file_meta)  DB.real_transfers_file_meta={};
  if(!DB.forecast_commitments) DB.forecast_commitments=[];
  if(!DB.demand_values)        DB.demand_values=[];

  // ── Slim down (never wipe) an oversized cache entry ─────────────────────
  // The old guard REMOVED the whole prodcast_v3 entry above 3MB, throwing away
  // the structural tables along with the bulky ones — and an empty cache is what
  // let seedCatalogs inject demo data. Now the bulky data tables are stripped
  // (they're recorded in _partialTables, so the partial-state machinery restores
  // them from the scenario file) and everything structural is kept.
  try{
    const raw = localStorage.getItem('prodcast_v3');
    if(raw && raw.length > 3000000){
      const saved=JSON.parse(raw);
      if(saved && saved.DB){
        const dropped=new Set(saved._partialTables||[]);
        LS_SKIP_COMPACT.forEach(t=>{ if(saved.DB[t]!==undefined){ delete saved.DB[t]; dropped.add(t); } });
        saved._partialTables=[...dropped];
        const slim=JSON.stringify(saved);
        console.warn('loadSaved: slimmed oversized cache '+Math.round(raw.length/1024)+'KB → '+Math.round(slim.length/1024)+'KB (bulk tables live in the scenario file)');
        localStorage.setItem('prodcast_v3', slim);
      } else {
        localStorage.removeItem('prodcast_v3'); // unparseable/foreign — genuinely unusable
      }
    }
  }catch(e){ try{ localStorage.removeItem('prodcast_v3'); }catch(e2){} }

  window._dbPartialTables = [];   // nothing restored yet ⇒ nothing known-missing
  try{
    const raw=localStorage.getItem('prodcast_v3');
    if(raw){
      const saved=JSON.parse(raw);
      if(saved.DB){
        Object.keys(DB).forEach(table=>{
          if(saved.DB[table]&&Array.isArray(saved.DB[table])) DB[table]=saved.DB[table];
        });
      }
      if(saved.counter) S.elCounter=saved.counter;
      syncElCounter();
      if(saved.simCfg) Object.assign(S.simCfg,saved.simCfg);
      if(saved.simResults) S.simResults = saved.simResults;  // Restore forecast results so all data visible on load

      // Which tables this cache could not hold. They are NOT gone — they live in
      // the scenario file — but memory is now incomplete, so the file must not be
      // overwritten from this state until scLoadScenario has healed it.
      // Older caches have no _partialTables key; infer the ones we always skip.
      window._dbPartialTables = Array.isArray(saved._partialTables)
        ? saved._partialTables.slice()
        : [...LS_SKIP_ALWAYS].filter(t=>saved.DB && saved.DB[t]===undefined);

      // Remember when this localStorage copy was saved, so the topology data
      // source can refuse to overwrite it with an OLDER file (stale-file guard).
      window._lsSavedAt = saved.savedAt || null;
      if(saved.savedAt) window._lastSaveStamp = saved.savedAt; // this data's own stamp (see autoSave)
      window._lsScId = saved.scId;   // the scenario this copy is of (undefined: saved before that was recorded)
      window._lsScBase = saved.scBase || null;   // the synced file version it was built from

      // Update Real Data Input panel facility selector after loading
      if(typeof initRealDataFacilitySelector === 'function'){
        initRealDataFacilitySelector();
      }

      return true;   // signal: we have a saved state, skip seed fetch
    }
  }catch(e){console.error('Load error',e);}
  return false;  // no localStorage data — caller may seed from server file
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded',async()=>{
  try{ acEarlyCover(); }catch(e){ console.warn('acEarlyCover', e); }   // sign-in scenarios: hide the cached data until signed in
  try{ _acInstallGuards(); window.addEventListener('load', _acInstallGuards); }catch(e){ console.warn('acGuards', e); }
  loadSaved(); // restores DB from localStorage (if any) and sets window._lsSavedAt for scInit()'s guard

  _applyTblZoom(_getTblZoom()); // restore saved table text size

  seedCatalogs();

  // Initialize data sources FIRST (they take priority over seed files).
  // dsInit is async and resolves once all file handles are loaded from IDB —
  // await it directly (the old fixed 100ms sleep raced on slow disks).
  await dsInit();

  // No bundled-seed fallback: a brand-new browser with nothing saved and no
  // scenario linked starts blank, and scInit() below (via scOpenStartup on
  // first run) prompts the user to either create a new scenario or open an
  // existing one — there's no case where loading an old snapshot is needed.
  document.getElementById('sim-date-lbl').textContent=`Day 0 / ${S.simCfg.horizon}`;

  // If facilities exist, select first one
  if(DB.facilities.length){
    selectFacility(DB.facilities[0].id);
  }

  updateStatusBar();
  renderLocationTree();
  updateNavFacilities();

  // Initialize top-level nav
  if(!DB.facilities.length){
    switchTopSection('configuration');
  } else {
    switchTopSection('production');
  }

  // Initialize the Scenario system. May migrate a legacy topology file into a
  // scenario, auto-open the last-used scenario, or show the startup picker.
  if(typeof scInit === 'function'){ try{ await scInit(); }catch(e){ console.error('scInit failed',e); } }

  // Initialize Real Data Input panel
  initRealDataFacilitySelector();
  const rdDateInput = document.getElementById('rd-date');
  if(rdDateInput) {
    rdDateInput.value = S.realDataSelectedDate;
  }

  // Set first facility as default and render form
  if(DB.facilities.length > 0 && !S.realDataFacilityId) {
    S.realDataFacilityId = DB.facilities[0].id;
    const facilitySelect = document.getElementById('rd-facility');
    if(facilitySelect) facilitySelect.value = S.realDataFacilityId;
    renderRealDataSections();
  }

  initUiZoom();
  dsStartAutoCheck();
  scStartRemoteWatch();

  // Attach canvas event listeners
  const canvas = document.getElementById('topo-canvas-wrap');
  if(canvas) {
    canvas.addEventListener('dragover', (e) => e.preventDefault());
    canvas.addEventListener('drop', (e) => onCanvasDrop(e));
    canvas.addEventListener('mousedown', (e) => onCanvasMD(e));
    canvas.addEventListener('click', (e) => onCanvasClick(e));
    canvas.addEventListener('mousemove', (e) => onCanvasMove(e));
    canvas.addEventListener('mouseup', (e) => onCanvasUp(e));
    canvas.addEventListener('wheel', (e) => onCanvasWheel(e), {passive:false});
    canvas.addEventListener('mouseleave', () => { if(S.panning){ S.panning=null; document.getElementById('topo-canvas-wrap').style.cursor=(S.tool==='pan'||S._space)?'grab':'default'; } });
  }
  // Space-to-pan (SketchUp style): hold Space and drag. Ignore while typing.
  document.addEventListener('keydown', (e) => {
    if(e.code==='Space' && S.view==='topology' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||'') && !document.activeElement?.isContentEditable){
      if(!S._space){ S._space=true; const w=document.getElementById('topo-canvas-wrap'); if(w&&!S.panning) w.style.cursor='grab'; }
      e.preventDefault();
    }
  });
  document.addEventListener('keyup', (e) => {
    if(e.code==='Space'){ S._space=false; const w=document.getElementById('topo-canvas-wrap'); if(w&&!S.panning) w.style.cursor=(S.tool==='pan')?'grab':(S.tool==='delete'?'crosshair':S.tool==='connect'?'cell':'default'); }
  });

  // Forecast on load: simResults are no longer persisted in localStorage
  // (too large). If the scenario file didn't restore them, regenerate.
  if(!S.simResults && S.facility_id && getFacElements().length){
    scheduleSimulation(400);
  }
});

