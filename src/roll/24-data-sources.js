// ═══════════════════════════════════════════════════════
// DATA SOURCES — File System Access API
// Handles persistent file path registration + auto-refresh
// ═══════════════════════════════════════════════════════

// ── Data source definitions ───────────────────────────
// Each slot: { id, label, description, handler, dbKey }
const DS_SLOTS = [
  // NOTE: the former 'topology' slot is retired — topology persistence is now
  // owned by the Scenario system (each scenario is its own JSON file). See scInit().
  { id:'realSales',      label:'Real Sales',       description:'Avila_Shipments_Summary.xlsx — tonnes per demand point per day; this is where actual demand comes from. Written by Publish in Configuration → Demand Mapping (formerly by the Excel pivot).', handler:'spIngestFile',  dbKey:'real_shipments_daily' },
  { id:'realTransfers',  label:'Real Transfers',   description:'Avila_Transfers_Summary.xlsx — rail/plant transfer tonnes per day (Delivery Date, INV_ROLL_NAME like BRS/TRF/BRS_IL(12)/BLK/INT, Report Qty). Written by Publish in Configuration → Demand Mapping from the movements the rules park as transfers. Bind it to read the history into the app.', handler:'dsIngestTransfers', dbKey:'real_transfers_file_daily' },
  { id:'demandSales',    label:'Demand — SAP Sales', description:'The raw SAP sales export (Ship Pt, Material, Sold-To, Ship Type, Delivery Date, Report Qty …; .xlsx or .csv). Bind it once — a SharePoint folder synced to this machine is re-read on every refresh. Rows are translated by Configuration → Demand Mapping; Publish there writes the Summary, Detail and Transfers files that Real Sales, the Sales page and Power BI read.', handler:'dsIngestDemandSales', dbKey:'' },
  { id:'realProduction', label:'Real Production',  description:'ProductionReal.xlsx — SAP export with DATE, EQUIPMENT, MATERIAL CODE, PRODUCTION columns. EQUIPMENT must match element names (e.g. BROSFM01, BROSKL02, BROSPK01). MATERIAL CODE matched via the SAP material codes on each product.', handler:'dsIngestProduction', dbKey:'real_production_daily' },
  { id:'transportCost',  label:'Transport Cost',   description:'Freight and logistics cost matrix',            handler:'dsIngestTransport',  dbKey:'transport_costs' },
  { id:'custom',         label:'Custom',           description:'User-defined data file',                       handler:'dsIngestCustom',     dbKey:'custom_data' },
];

// ── Persistent metadata (stored in localStorage, no handles) ──
// DS.meta[id] = { label, fileName, lastLoaded, rowCount, fileSize, error }
// File handles stored separately in IndexedDB (not JSON-serializable)
const DS = {
  meta: {},      // populated from localStorage on init
  handles: {},   // FileSystemFileHandle objects, loaded from IndexedDB
  refreshing: {},// { id: bool } — in-flight flags
  pending: {},   // { id: {fileModTime, fileName} } — detected-but-not-yet-imported changes (in-memory only)
};

// ── IndexedDB for file handles ────────────────────────
let _dsDB = null;
function dsOpenIDB(){
  return new Promise((res,rej)=>{
    if(_dsDB){ res(_dsDB); return; }
    const req = indexedDB.open('avila_datasources', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    req.onsuccess = e => { _dsDB = e.target.result; res(_dsDB); };
    req.onerror   = () => rej(req.error);
  });
}

async function dsSaveHandle(id, handle){
  try{
    const db = await dsOpenIDB();
    await new Promise((res,rej)=>{
      const tx = db.transaction('handles','readwrite');
      tx.objectStore('handles').put(handle, id);
      tx.oncomplete = res; tx.onerror = rej;
    });
  }catch(e){ console.warn('DS: could not save handle',e); }
}

async function dsLoadHandle(id){
  try{
    const db = await dsOpenIDB();
    return await new Promise((res,rej)=>{
      const tx = db.transaction('handles','readonly');
      const req = tx.objectStore('handles').get(id);
      req.onsuccess = () => res(req.result||null);
      req.onerror   = () => res(null);
    });
  }catch(e){ return null; }
}

async function dsDeleteHandle(id){
  try{
    const db = await dsOpenIDB();
    await new Promise((res,rej)=>{
      const tx = db.transaction('handles','readwrite');
      tx.objectStore('handles').delete(id);
      tx.oncomplete = res; tx.onerror = rej;
    });
  }catch(e){}
}

// ── Meta persistence ──────────────────────────────────
function dsSaveMeta(){
  try{ localStorage.setItem('avila_datasources', JSON.stringify(DS.meta)); }
  catch(e){ console.warn('DS: meta save failed',e); }
}
function dsLoadMeta(){
  try{
    const raw = localStorage.getItem('avila_datasources');
    if(raw) DS.meta = JSON.parse(raw);
  }catch(e){}
}

// ── Init — called once on DOMContentLoaded ────────────
async function dsInit(){
  dsLoadMeta();
  // Load all handles from IDB into memory so the mapped files are ready, but do
  // NOT read them. The app owns its data (loaded from the scenario / localStorage);
  // external files only re-import when the user explicitly clicks Refresh / Refresh All.
  for(const slot of DS_SLOTS){
    const h = await dsLoadHandle(slot.id);
    if(h) DS.handles[slot.id] = h;
  }
}

// ── Auto-refresh all slots that have a handle ─────────
async function dsAutoRefreshAll(){
  if(scIsPlanning()){ statMsg('Planning scenario: Real Sales / Production imports are off here'); return; }
  // Flag so dsIngestTopology applies the stale-file guard ONLY during automatic
  // refresh (startup). A manual file pick/refresh must always load the file.
  window._dsAutoRefreshing = true;
  const slotsWithHandles = DS_SLOTS.filter(s => DS.handles[s.id]);
  const promises = slotsWithHandles.map(s => dsRefreshSlot(s.id, false));
  const results = await Promise.allSettled(promises);
  window._dsAutoRefreshing = false;

  // Check if any slot's data changed
  const changedSlots = results
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter(v => v?.changed);

  // If real data changed on startup load: show banner + auto-run simulation
  if(changedSlots.length > 0){
    const names = changedSlots.map(c=>DS.meta[c.slot]?.fileName||c.slot).join(', ');
    _showDataUpdateBanner('Real data updated: '+names);
    // Auto-run simulation with new real data
    if(typeof runSimulation==='function'){
      setTimeout(()=>{ runSimulation(); }, 500);
    }
  }

  // Update UI if Configure modal is open
  dsRefreshConfigUI();
  // Update Sales page status
  const metaLbl = document.getElementById('sp-meta-lbl');
  if(metaLbl && DB.real_shipments_daily.length){
    const m = DB.real_shipments_meta;
    metaLbl.textContent = `${Number(m.row_count||0).toLocaleString()} records · ${m.date_min||'?'} → ${m.date_max||'?'} · ${m.loaded_at||'?'}`;
  }
}

// ── Background change detection ───────────────────────
// Cheaply checks whether the on-disk file for a slot has a newer
// last-modified time than what was recorded at the last import, WITHOUT
// reading or parsing the file's contents (handle.getFile() only stats the
// file; reading bytes only happens via file.arrayBuffer(), which dsRefreshSlot
// calls separately once the user opts in). Never prompts for permission —
// a silent background poll must not surface an OS file-access dialog out of
// nowhere; if permission isn't already granted, that slot is just skipped
// until the user next interacts with it (e.g. a manual Refresh).
async function dsPeekSlotChanged(id){
  const handle=DS.handles[id]; if(!handle) return false;
  try{
    const perm=await handle.queryPermission({mode:'read'});
    if(perm!=='granted') return false;
    const file=await handle.getFile();
    const prevModTime=DS.meta[id]?.lastFileModified;
    if(prevModTime&&file.lastModified<=prevModTime) return false;
    DS.pending[id]={fileModTime:file.lastModified, fileName:file.name};
    return true;
  }catch(e){ return false; } // transient/deleted file — a real refresh attempt will surface it
}

// Checks every connected slot and shows the "new version available" banner
// if any changed. Called once shortly after boot, then every hour.
async function dsCheckAllForUpdates(){
  if(scIsPlanning()) return;   // Planning: external feeds are not watched
  const slotsWithHandles=DS_SLOTS.filter(s=>DS.handles[s.id]);
  for(const s of slotsWithHandles) await dsPeekSlotChanged(s.id);
  if(Object.keys(DS.pending).length) _showPendingUpdateBanner();
}

let _dsCheckTimer=null;
function dsStartAutoCheck(){
  if(_dsCheckTimer) return; // idempotent — safe to call more than once
  setTimeout(dsCheckAllForUpdates, 15000);         // catch a file changed while the app was closed
  _dsCheckTimer=setInterval(dsCheckAllForUpdates, 60*60*1000); // then hourly
}

function _showPendingUpdateBanner(){
  const ids=Object.keys(DS.pending); if(!ids.length) return;
  let b=document.getElementById('data-pending-banner');
  if(!b){
    b=document.createElement('div');
    b.id='data-pending-banner';
    b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:var(--bn-info-bg);border-bottom:2px solid var(--blue);color:var(--bn-info-fg);font-family:var(--mono),monospace;font-size:11px;padding:8px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 14px rgba(0,0,0,.55)';
    document.body.appendChild(b);
  }
  const names=ids.map(id=>DS.pending[id].fileName||DS_SLOTS.find(s=>s.id===id)?.label||id).join(', ');
  b.innerHTML=`<span style="font-size:15px;line-height:1">🔔</span>
    <span style="flex:1;line-height:1.35">New version available: ${names} — the source file has changed since it was last imported.</span>
    <button onclick="dsApplyPendingUpdates()" style="background:var(--blue);color:var(--on-blue);border:none;padding:6px 12px;font-family:inherit;font-size:10px;font-weight:700;cursor:pointer;border-radius:3px">↻ Update Now</button>
    <button onclick="document.getElementById('data-pending-banner')?.remove()" style="background:transparent;color:var(--bn-info-fg);border:1px solid var(--blue);padding:6px 11px;font-family:inherit;font-size:10px;cursor:pointer;border-radius:3px">Dismiss</button>`;
}

// User clicked "Update Now" — actually fetch + parse + import each pending
// file (dsRefreshSlot re-checks lastModified itself and always reimports here
// since this isn't a silent auto-refresh pass).
async function dsApplyPendingUpdates(){
  const ids=Object.keys(DS.pending); if(!ids.length) return;
  document.getElementById('data-pending-banner')?.remove();
  statMsg('Importing updated file(s)…');
  for(const id of ids){
    await dsRefreshSlot(id, true);
    delete DS.pending[id];
  }
  dsRefreshConfigUI();
  _showDataUpdateBanner('Real data updated');
  scheduleSimulation(300);
}

// ── Refresh a single slot ─────────────────────────────
// Returns { changed: bool, slot: id } if file changed, else null
async function dsRefreshSlot(id, showErrors=true){
  if(DS.refreshing[id]) return null;
  if(scIsPlanning() && !PLAN_SLOT_IDS.has(id)){   // keeps Real Sales from zeroing budget days
    if(showErrors) statMsg('Planning scenario: Real Sales / Production imports are off here');
    return null;
  }
  DS.refreshing[id] = true;
  dsUpdateSlotUI(id, 'loading');

  const slot = DS_SLOTS.find(s=>s.id===id);
  let handle = DS.handles[id];

  try{
    if(!handle) throw new Error('No file configured');

    // Re-request permission if needed
    let perm = await handle.queryPermission({mode:'read'});
    if(perm !== 'granted'){
      perm = await handle.requestPermission({mode:'read'});
    }
    if(perm !== 'granted') throw new Error('File access denied');

    const file = await handle.getFile();
    const buf  = await file.arrayBuffer();
    const fileModTime = file.lastModified;

    // Check if file changed: compare with saved timestamp
    const prevModTime = DS.meta[id]?.lastFileModified;
    const fileChanged = !prevModTime || fileModTime > prevModTime;

    // During a background change-check, skip unchanged files. A user-initiated
    // Refresh (showErrors=true / not auto) always re-imports, even if unchanged.
    if(!fileChanged && window._dsAutoRefreshing){
      dsUpdateSlotUI(id, 'ok');
      DS.refreshing[id] = false;
      return null;
    }

    // Dispatch to the right ingestion handler
    if(!window[slot.handler]) throw new Error(`Handler function ${slot.handler} not found`);
    window._dsCurrentFileMod = fileModTime; // so dsIngestTopology can record the merge baseline
    const result = await window[slot.handler](buf, file.name);
    if(!result) throw new Error('Handler returned no result');
    DS.meta[id] = {
      ...DS.meta[id],
      fileName:  file.name,
      fileSize:  file.size,
      lastFileModified: fileModTime,
      lastLoaded:new Date().toISOString().slice(0,16).replace('T',' '),
      rowCount:  result.rowCount || 0,
      matched:   result.matched  ?? null,
      dateMin:   result.dateMin  ?? null,
      dateMax:   result.dateMax  ?? null,
      warnings:  result.warnings ?? null,
      error:     null,
    };
    dsSaveMeta();
    dsUpdateSlotUI(id, 'ok');
    if(result.warnings?.length) result.warnings.forEach(w=>statMsg('⚠ '+w));

    return { changed: true, slot: id };  // Signal that data changed

  }catch(err){
    // Only clear handle if it's truly invalid (NotFoundError, NotAllowedError during init)
    // Don't clear on other errors — they might be transient
    const isInvalidHandle = (err.name === 'NotFoundError' ||
                            err.name === 'NotAllowedError') && window._dsAutoRefreshing;
    if(isInvalidHandle && DS.handles[id]){
      delete DS.handles[id];
      await dsDeleteHandle(id);
      console.warn(`DS [${id}]: handle invalidated, cleared — please re-select file`);
    }

    DS.meta[id] = { ...(DS.meta[id]||{}), error: err.message, lastLoaded: DS.meta[id]?.lastLoaded||null };
    dsSaveMeta();
    dsUpdateSlotUI(id, 'error', err.message);
    if(showErrors) console.warn(`DS [${id}]:`, err.message);
    return null;
  }finally{
    DS.refreshing[id] = false;
  }
}

// ── Pick a file for a slot ────────────────────────────
async function dsPickFile(id){
  try{
    // Writable slots get a JSON-accepting picker; the rest keep the Excel/CSV filter
    const writable = !!_dsWritableSlots[id];
    const types = writable
      ? [{ description:'Topology JSON', accept:{'application/json':['.json']} }]
      : [{ description:'Excel / CSV', accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx'],
          'application/vnd.ms-excel':['.xls'],'text/csv':['.csv']} }];
    const [handle] = await window.showOpenFilePicker({
      id: ('avila-'+id).slice(0,32),      // browser remembers a directory per id
      startIn: DS.handles[id] || undefined, // …or reopen beside the file bound now
      types, multiple:false });
    DS.handles[id] = handle;
    await dsSaveHandle(id, handle);
    if(!DS.meta[id]) DS.meta[id]={};
    DS.meta[id].fileName = handle.name;
    DS.meta[id]._writeDenied = false; // clear any stale denial flag
    dsSaveMeta();
    // For writable slots, request readwrite up front so the user is prompted
    // once now rather than mid-edit later. Ignore the result — the first
    // dsWriteSlot will re-request if it was declined.
    if(writable) await _dsEnsureWritePermission(handle);
    await dsRefreshSlot(id, true);
  }catch(e){
    if(e.name !== 'AbortError') statMsg('File picker cancelled or failed');
  }
}

// ── Disconnect a slot ─────────────────────────────────
async function dsDisconnect(id){
  delete DS.handles[id];
  await dsDeleteHandle(id);
  delete DS.meta[id];
  dsSaveMeta();
  dsUpdateSlotUI(id, 'empty');
  dsRefreshConfigUI();
}

// ── Auto-write-back to picked file ────────────────────
// Map of slot id → factory returning {blob, mime} to write on autosave.
// Only slots whose content is owned/mutated by the app belong here. The
// other slots are read-only feeds; writing them back would just re-emit
// unchanged data.
const _dsWritableSlots = {
  topology: () => {
    const TRANSIENT = new Set([
      'real_shipments_daily','real_shipments_meta',
      'simulation_day_states','simulation_inventory',
      'simulation_stop_events','simulation_runs','in_transit_inventory',
    ]);
    const dbOut = Object.fromEntries(
      Object.entries(DB).filter(([k]) => !TRANSIENT.has(k))
    );
    // Strip actual demand_values — those reload from the Excel feed
    if(dbOut.demand_values) dbOut.demand_values = dbOut.demand_values.filter(v => v.source !== 'actual');
    // Mirror localStorage's stamp so a successful write keeps file and localStorage
    // in lockstep; if a write fails, the file's stamp stays behind localStorage's.
    const payload = { DB: dbOut, counter: S.elCounter, simCfg: S.simCfg, savedAt: (window._lastSaveStamp || new Date().toISOString()) };
    return { payload, mime:'application/json' };
  },
};

// Per-slot debounce timers so a burst of edits (e.g. canvas drag) coalesces
// into one disk write.
const _dsWriteTimers = {};
const DS_WRITE_DEBOUNCE_MS = 500;

// Request readwrite permission (upgrading older read-only handles in place)
async function _dsEnsureWritePermission(handle){
  if(!handle) return false;
  let perm = await handle.queryPermission({mode:'readwrite'});
  if(perm === 'granted') return true;
  perm = await handle.requestPermission({mode:'readwrite'});
  return perm === 'granted';
}

// Actually perform the write — atomic via createWritable's temp-file swap.
// Merge-aware for the topology slot: if the file changed on disk since we
// last synced (a teammate saved via a shared drive), three-way-merge their
// rows with ours instead of overwriting them. See the SHARED-FILE MERGE
// ENGINE section for the algorithm.
async function dsWriteSlot(id){
  const factory = _dsWritableSlots[id];
  const handle  = DS.handles[id];
  if(!factory || !handle) return;
  try{
    const granted = await _dsEnsureWritePermission(handle);
    if(!granted){
      // User declined write access — raise a PERSISTENT banner (silent failure
      // here is exactly what caused edits to vanish on reload).
      DS.meta[id] = { ...(DS.meta[id]||{}), _writeDenied: true };
      dsSaveMeta();
      _dsWriteBlockedBanner(id, handle.name, 'file-edit permission was declined');
      return;
    }
    const { payload } = factory();
    const prep = await _mgPrepareWrite(handle, payload, id==='topology' ? _dsTopoBaseline : null);
    if(prep.mode==='pull'){
      // Teammate updated the file, we have nothing new — adopt theirs, skip the write.
      _mgApplyPayloadToApp(prep.theirs);
      _dsTopoBaseline = { text: prep.diskText, savedAt: prep.theirs.savedAt||null, fileMod: prep.fileMod };
      DS.meta[id] = { ...(DS.meta[id]||{}), lastFileModified: prep.fileMod, _writeDenied: false, writeError: null };
      dsSaveMeta();
      dsRefreshConfigUI();
      _dsHideWriteBlockedBanner();
      if(prep.mergeInfo.remoteApplied) _mgShowMergeBanner(handle.name, prep.mergeInfo);
      return;
    }
    let out = payload;
    if(prep.mode==='merge'){ out = prep.mergeInfo.payload; _mgApplyPayloadToApp(out); }
    const outText = JSON.stringify(out, null, 2);
    const writable = await handle.createWritable();
    await writable.write(new Blob([outText], {type:'application/json'}));
    await writable.close();
    if(id==='topology'){
      let mod = null; try{ mod = (await handle.getFile()).lastModified; }catch(e){}
      _dsTopoBaseline = { text: outText, savedAt: out.savedAt||null, fileMod: mod };
      if(mod!=null) DS.meta[id] = { ...(DS.meta[id]||{}), lastFileModified: mod };
    }
    DS.meta[id] = {
      ...(DS.meta[id]||{}),
      lastWritten: new Date().toISOString().slice(0,16).replace('T',' '),
      _writeDenied: false,
      writeError: null,
    };
    dsSaveMeta();
    dsRefreshConfigUI();
    _dsHideWriteBlockedBanner(); // write succeeded — clear any warning
    if(prep.mode==='merge') _mgShowMergeBanner(handle.name, prep.mergeInfo);
  }catch(err){
    DS.meta[id] = { ...(DS.meta[id]||{}), writeError: err.message };
    dsSaveMeta();
    console.warn(`DS write [${id}]:`, err.message);
    _dsWriteBlockedBanner(id, handle?.name, 'write failed — '+err.message);
  }
}

// ── Persistent "edits not reaching the file" warning banner ───────────
// Replaces the old fire-once-then-silent statMsg so data loss can't go unnoticed.
function _dsWriteBlockedBanner(id, name, reason){
  let b=document.getElementById('ds-write-blocked-banner');
  if(!b){
    b=document.createElement('div');
    b.id='ds-write-blocked-banner';
    b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:var(--bn-err-bg);border-bottom:2px solid var(--red);color:var(--bn-err-fg);font-family:var(--mono),monospace;font-size:11px;padding:8px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 14px rgba(0,0,0,.55)';
    document.body.appendChild(b);
  }
  b.dataset.slot=id;
  b.innerHTML=`<span style="font-size:15px;line-height:1">⚠</span>
    <span style="flex:1;line-height:1.35">Your changes are <b>NOT being saved to the topology file</b>${name?` (${name})`:''} — ${reason}. They live only in this browser and can be lost when the file reloads.</span>
    <button onclick="_dsRetryWrite('${id}')" style="background:var(--red);color:var(--on-red);border:none;padding:6px 13px;font-family:inherit;font-size:10px;font-weight:700;cursor:pointer;border-radius:3px;white-space:nowrap">Re-grant access &amp; save</button>
    <button onclick="_dsHideWriteBlockedBanner()" style="background:transparent;color:var(--bn-err-fg);border:1px solid var(--red);padding:6px 11px;font-family:inherit;font-size:10px;cursor:pointer;border-radius:3px">Dismiss</button>`;
}
function _dsHideWriteBlockedBanner(){
  document.getElementById('ds-write-blocked-banner')?.remove();
}
function _showDataUpdateBanner(msg){
  let b=document.getElementById('data-update-banner');
  if(!b){
    b=document.createElement('div');
    b.id='data-update-banner';
    b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:var(--bn-ok-bg);border-bottom:2px solid var(--teal);color:var(--bn-ok-fg);font-family:var(--mono),monospace;font-size:11px;padding:8px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 14px rgba(0,0,0,.55)';
    document.body.appendChild(b);
  }
  b.innerHTML=`<span style="font-size:15px;line-height:1">✓</span>
    <span style="flex:1;line-height:1.35">${msg} — simulation is running…</span>
    <button onclick="document.getElementById('data-update-banner')?.remove()" style="background:transparent;color:var(--bn-ok-fg);border:1px solid var(--teal);padding:6px 11px;font-family:inherit;font-size:10px;cursor:pointer;border-radius:3px">Dismiss</button>`;
  // Auto-hide after 5 seconds
  setTimeout(()=>{ document.getElementById('data-update-banner')?.remove(); }, 5000);
}
async function _dsRetryWrite(id){
  // Scenario files route through the scenario writer, not the DS slots.
  if(id && id.indexOf('scenario:')===0){ if(typeof scRetryWrite==='function') await scRetryWrite(id.slice(9)); return; }
  const handle=DS.handles[id];
  if(!handle){ statMsg('No file connected for '+id); return; }
  const ok=await _dsEnsureWritePermission(handle);
  if(!ok){ statMsg('Still no write access — re-pick the file in Configuration → Data Sources'); return; }
  if(DS.meta[id]) DS.meta[id]._writeDenied=false;
  await dsWriteSlot(id); // succeeds → banner auto-clears
  if(!document.getElementById('ds-write-blocked-banner')) statMsg('Topology file updated ✓');
}

// Debounced wrapper — call freely from autoSave, only the last call in a
// DS_WRITE_DEBOUNCE_MS window actually hits disk.
function dsScheduleWrite(id){
  if(!_dsWritableSlots[id] || !DS.handles[id]) return;
  clearTimeout(_dsWriteTimers[id]);
  _dsWriteTimers[id] = setTimeout(()=>dsWriteSlot(id), DS_WRITE_DEBOUNCE_MS);
}

// Fan out a write tick to every connected writable slot.
function dsScheduleAllWrites(){
  if(scIsPlanning()) return;   // the legacy topology file belongs to Execution
  Object.keys(_dsWritableSlots).forEach(id => { if(DS.handles[id]) dsScheduleWrite(id); });
}

// ── Ingestion handler for Real Sales ─────────────────
// Wraps the existing spHandleFile logic but takes ArrayBuffer directly
async function spIngestFile(buf, fileName){
  await loadLib('xlsx'); // pinned version + SRI — see LIBS

  const wb = XLSX.read(buf, {type:'array', cellDates:false, raw:true});
  const sheetName = wb.SheetNames.find(n=>n==='RealShip')
    || wb.SheetNames.find(n=>n==='SalesConsolidated')
    || wb.SheetNames.find(n=>n==='Shipping History Cement')
    || wb.SheetNames[0];
  const ws  = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, {raw:false, defval:''});
  if(!raw.length) throw new Error('Sheet is empty');

  const cols = Object.keys(raw[0]);
  // "CEMEX SAP export" format: INV_ROLL_NAME + Report Qty + Delivery Date
  const isCEMEX = cols.includes('INV_ROLL_NAME') && cols.includes('Report Qty') && cols.includes('Delivery Date');
  const isNew   = !isCEMEX && cols.includes('Abrev') && cols.includes('Volume*');
  const isOld   = !isCEMEX && !isNew && cols.includes('ORIGIN') && cols.includes('Volume');
  if(!isCEMEX && !isNew && !isOld) throw new Error('Unrecognised column format — expected INV_ROLL_NAME/Report Qty/Delivery Date, or Abrev/Volume*, or ORIGIN/Volume');

  function normDate(v){
    if(!v && v!==0) return null;
    const n = typeof v==='number'?v:parseFloat(v);
    if(!isNaN(n) && n>40000 && n<60000){
      return new Date((n-25569)*86400000).toISOString().split('T')[0];
    }
    const s = String(v).trim();
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    if(/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)){
      const p=s.split('/'); return `${p[2]}-${p[0].padStart(2,'0')}-${p[1].padStart(2,'0')}`;
    }
    const d=new Date(s); return isNaN(d)?null:d.toISOString().split('T')[0];
  }

  const aggMap={};
  let dateMin='9999', dateMax='0000', skipped=0;
  const origins=new Set(), products=new Set();

  raw.forEach(r=>{
    let vol, date, product, origin, custType, shipTo, shipToName, rep;

    if(isCEMEX){
      // SAP export: INV_ROLL_NAME = "BRS/DEM/BRS_IL(12)/BLK/INT"
      // origin = first segment, custType = last segment (INT|EXT)
      vol = parseFloat(r['Report Qty']) || 0;
      if(vol <= 0){ skipped++; return; }
      date = normDate(r['Delivery Date']);
      const invRoll = (r['INV_ROLL_NAME'] || '').trim();
      if(!invRoll || invRoll.toUpperCase()==='N/A' || invRoll.startsWith('N/A/')){ skipped++; return; }
      const parts  = invRoll.split('/');
      origin    = parts[0] || '';
      custType  = (['INT','EXT'].includes(parts[parts.length-1]) ? parts[parts.length-1] : 'EXT');
      product   = invRoll;
      shipTo    = String(r['Ship-To'] || '').trim();
      shipToName= (r['Ship-To Name'] || '').trim();
      rep       = (r['SalesRep'] || '—').trim();
    } else {
      vol = parseFloat(isNew ? r['Volume*'] : r['Volume']) || 0;
      if(vol <= 0){ skipped++; return; }
      date    = normDate(r['Date']);
      product = (isNew ? r['Demand Point'] : r['product']||r['Name Inv Roll']||'').trim();
      if(!product || product.toUpperCase()==='N/A' || product.startsWith('N/A/')){ skipped++; return; }
      origin    = (isNew ? r['Abrev'] : r['ORIGIN'] || '').trim();
      custType  = (r['Customer Type'] || 'EXT').trim();
      shipTo    = String(r['Ship-To'] || '').trim();
      shipToName= (r['Ship-To Name'] || '').trim();
      rep       = (isNew ? r['SH Sales Manager'] : r['Sales Manager'] || '—').trim();
    }

    if(!date){ skipped++; return; }
    if(!product || product.toUpperCase()==='N/A' || product.startsWith('N/A/')){ skipped++; return; }
    if(date<dateMin) dateMin=date;
    if(date>dateMax) dateMax=date;
    // Sold-To number/name: read directly off the row regardless of format branch — the
    // real customer-account fields, when present, replace the old "split the Ship-To
    // name on ' - '" guess that fragmented one customer into several different Sold-To
    // groups whenever their Ship-To names weren't formatted identically.
    const soldTo    = String(r['Sold-To'] || '').trim();
    const soldToName= (r['Sold-To Name'] || '').trim();
    const key = `${date}|${origin}|${product}|${custType}|${shipTo}`;
    if(!aggMap[key]) aggMap[key]={date,origin,product,customer_type:custType,
      ship_to:parseInt(shipTo)||0,ship_to_name:shipToName,sales_manager:rep,volume:0,
      sold_to:parseInt(soldTo)||0,sold_to_name:soldToName};
    aggMap[key].volume += vol;
    origins.add(origin); products.add(product);
  });

  DB.real_shipments_daily = Object.values(aggMap).map(r=>({...r,volume:Math.round(r.volume)}));
  DB.real_shipments_meta  = {
    loaded_at: new Date().toISOString().slice(0,16).replace('T',' '),
    row_count: raw.length, agg_count: DB.real_shipments_daily.length,
    date_min: dateMin, date_max: dateMax,
    origins: [...origins].sort(), products: [...products].sort()
  };

  // Write actuals into the Demand grid (past dates only). Call once — the zero-writing
  // pass is not idempotent: a second run would read its own zeros as forecasts.
  dsWriteActualsToDemandGrid();

  // Always refresh Sales Performance view when data loads (not just if currently active)
  renderSalesPerfView();
  autoSave();

  return { rowCount: raw.length };
}

// ── Transfers file (Avila_Transfers_Summary.xlsx) ─────────────────────────────
// One row per day per transfer lane: INV_ROLL_NAME = "<origin>/TRF/<material…>/<INT>",
// e.g. BRS/TRF/BRS_IL(12)/BLK/INT. The name carries the ORIGIN and the material but not the
// destination, so rows are stored per origin × material × day; origin and product are resolved
// against the topology when they exist. Read-only history — it does not change the simulation.
async function dsIngestTransfers(buf, fileName){
  await loadLib('xlsx');
  const wb = XLSX.read(buf, {type:'array', cellDates:false, raw:true});
  const sheetName = wb.SheetNames.find(n=>n==='SalesConsolidated') || wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {raw:true, defval:''});
  if(!raw.length) throw new Error('Sheet is empty');
  const cols = Object.keys(raw[0]);
  if(!(cols.includes('INV_ROLL_NAME') && cols.includes('Report Qty') && cols.includes('Delivery Date')))
    throw new Error('Unrecognised column format — expected Delivery Date / INV_ROLL_NAME / Report Qty');
  const ymd=v=>{
    if(typeof v==='number' && v>40000 && v<60000) return new Date(Math.round((v-25569)*86400000))
      .toISOString().slice(0,10);
    const t=String(v||'').trim();
    if(/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0,10);
    const m=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m?`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`:null;
  };
  const facByName={}; (DB.facilities||[]).forEach(f=>{ facByName[String(f.name||'').toUpperCase()]=f.id; });
  const prodByName={}; (DB.products||[]).forEach(p=>{ prodByName[String(p.name||'').toUpperCase()]=p.id; });
  const prodFor=nm=>{
    const k=nm.toUpperCase();
    return prodByName[k] || prodByName[k.replace(/\/(BLK|PAK)$/,'')] || null;
  };
  const agg={}, lanes=new Set(); let skipped=0, dateMin='9999', dateMax='0000';
  raw.forEach(r=>{
    const qty=parseFloat(r['Report Qty'])||0, ds=ymd(r['Delivery Date']);
    const parts=String(r['INV_ROLL_NAME']||'').trim().split('/');
    if(!qty||!ds||parts.length<4||parts[1]!=='TRF'){ skipped++; return; }
    const origin=parts[0], prodName=parts.slice(2,-1).join('/');     // drop <origin>/TRF and the trailing INT
    const rollName=parts.join('/');
    const key=ds+'|'+rollName;
    if(!agg[key]) agg[key]={date:ds,roll_name:rollName,origin,origin_facility_id:facByName[origin.toUpperCase()]||null,
      product_name:prodName,product_id:prodFor(prodName),volume_t:0};
    agg[key].volume_t+=qty;
    lanes.add(rollName);
    if(ds<dateMin) dateMin=ds; if(ds>dateMax) dateMax=ds;
  });
  const rows=Object.values(agg).map(x=>({...x,volume_t:Math.round(x.volume_t*100)/100}));
  if(!rows.length) throw new Error('No transfer rows (INV_ROLL_NAME with "/TRF/") found');
  DB.real_transfers_file_daily=rows;
  DB.real_transfers_file_meta={loaded_at:new Date().toISOString().slice(0,16).replace('T',' '),file:fileName,
    row_count:raw.length, agg_count:rows.length, date_min:dateMin, date_max:dateMax, lanes:[...lanes].sort()};
  const warnings=[];
  if(skipped) warnings.push(`${skipped} row(s) skipped (no date, zero qty or not a TRF name)`);
  const unk=[...new Set(rows.filter(x=>!x.product_id).map(x=>x.product_name))];
  if(unk.length) warnings.push('Material not in the topology: '+unk.join(', '));
  const dm=dsTransfersDispatchMatch();
  if(dm.unmatched.length) warnings.push('No dispatch point is named exactly like: '+dm.unmatched.join(', ')+' — rename the dispatch point in the topology to match');
  autoSave();
  return { rowCount: raw.length, dateMin, dateMax, warnings: warnings.length?warnings:null };
}

// A transfer lane (INV_ROLL_NAME) belongs to the dispatch point whose NAME is exactly that
// string (compared like demand-point names: case/space-insensitive). Resolved on demand,
// so renaming a dispatch point in the topology takes effect without re-reading the file.
function dsTransfersDispatchMatch(){
  const byName=new Map((DB.elements||[]).filter(e=>e.type==='dispatch_point').map(e=>[_xlNorm(e.name),e]));
  const lanes=new Map();   // roll_name → tonnes
  (DB.real_transfers_file_daily||[]).forEach(r=>{ if(r.roll_name) lanes.set(r.roll_name,(lanes.get(r.roll_name)||0)+r.volume_t); });
  const all=[...lanes].map(([name,t])=>{ const d=byName.get(_xlNorm(name)); return {name,t,dispatch_id:d?.id||null,facility_id:d?.facility_id||null}; });
  return {lanes:all, matched:all.filter(x=>x.dispatch_id), unmatched:all.filter(x=>!x.dispatch_id).map(x=>x.name)};
}
// Tonnes the file says left a dispatch point on a day (all lanes whose name matches it).
function realTransferOutT(dispatchId,ds){
  const el=(DB.elements||[]).find(e=>e.id===dispatchId); if(!el) return 0;
  const n=_xlNorm(el.name);
  return (DB.real_transfers_file_daily||[]).reduce((s,r)=>s+(r.date===ds&&_xlNorm(r.roll_name)===n?r.volume_t:0),0);
}
// The file's tonnes for a dispatch point × product × day as RAIL CARS (tonnes ÷ the dispatch
// point's car capacity, rounded), or null when the file has nothing for that day. Feeds the
// Rail Schedule's "Available at switch" row and the simulation's yard count on switch days;
// a typed yard_count row always wins over it (see _rpAvailEdit).
function realTransferFileCars(dp,pid,ds){
  if(!dp||!(DB.real_transfers_file_daily||[]).length) return null;
  const n=_xlNorm(dp.name);
  const prodName=_xlNorm((DB.products||[]).find(p=>p.id===pid)?.name);
  let t=0, hit=false;
  (DB.real_transfers_file_daily||[]).forEach(r=>{
    if(r.date!==ds||_xlNorm(r.roll_name)!==n) return;
    if(r.product_id?r.product_id!==pid:_xlNorm(r.product_name)!==prodName) return;
    t+=r.volume_t; hit=true;
  });
  if(!hit) return null;
  const cap=parseFloat(dp.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
  return Math.max(0,Math.round(t/cap));
}

// ── Topology JSON handler ─────────────────────────────
// ── Demand source file (SAP sales export) ────────────────────────────────────
// Reads the export and runs every row through the demand mapping (Configuration
// → Demand Mapping). The result is kept in memory as a PREVIEW — what would land
// on which demand point, and what could not be placed and why. Nothing is
// written to demand_values here; that is the Apply step, and it stays a separate
// decision so a bad rule can never quietly rewrite history.
//
// The file is bound once through the picker and remembered (handle in IndexedDB),
// so a SharePoint library synced to this machine is re-read on every refresh
// without asking again.
function _dsSalesYmd(v){
  if(v instanceof Date) return new Date(v.getFullYear(),v.getMonth(),v.getDate())._ymd();
  if(typeof v==='number'&&isFinite(v)){
    // Excel serial → calendar date. Built from UTC parts, never by adding
    // milliseconds to a local midnight (that loses or gains a day across DST).
    const d=new Date(Math.round((v-25569)*86400000));
    return new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())._ymd();
  }
  const s=String(v||'').trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const d=new Date(s);
  return isNaN(d)?'':new Date(d.getFullYear(),d.getMonth(),d.getDate())._ymd();
}
async function dsIngestDemandSales(buf,name){
  await loadLib('xlsx'); // pinned version + SRI — see LIBS
  // A CSV save of the export reads the same way, and much faster than .xlsx.
  const wb=XLSX.read(buf,{type:'array',cellDates:true,dense:true});
  const ws=wb.Sheets[wb.SheetNames[0]];
  if(!ws) throw new Error('The workbook has no sheets');
  // Rows as arrays, not keyed objects — 200k rows × 29 columns as objects is the
  // heaviest part of reading the export.
  const aoa=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''});
  // The header is the first row that names the ship point (a title row above it is fine).
  let h0=aoa.findIndex((r,i)=>i<10&&r.some(c=>/^(ship\s*pt|ship\s*point|shipping\s*point)$/i.test(String(c).trim())));
  if(h0<0) h0=0;
  const hdr=(aoa[h0]||[]).map(c=>String(c??'').trim().toLowerCase());
  const rows=aoa.slice(h0+1);
  if(!rows.length) throw new Error('The first sheet has no rows');

  // Columns are found by header name, so column order and any extra columns
  // (INV_ROLL_NAME, SalesRep, …) do not matter.
  const pick=(...names)=>{ for(const n of names){ const i=hdr.indexOf(n.toLowerCase()); if(i>=0) return i; } return -1; };
  const cShip=pick('Ship Pt','ShipPt','Ship Point','Shipping Point');
  const cMat =pick('Material','Material Code','Material Number');
  const cSold=pick('Sold-To','Sold To','SoldTo');
  const cType=pick('Ship Type','ShipType','Shipment Type');
  const cDate=pick('Delivery Date','DeliveryDate');
  const cQty =pick('Report Qty','Report Quantity','Quantity Delivered','Qty');
  const missing=[['Ship Pt',cShip],['Material',cMat],['Sold-To',cSold],['Ship Type',cType],
                 ['Delivery Date',cDate],['Report Qty',cQty]].filter(p=>p[1]<0).map(p=>p[0]);
  if(missing.length) throw new Error('Columns not found in the first sheet: '+missing.join(', '));
  // Carried into the Detail file when present; blank when the export leaves them out.
  const cDesc=pick('Material Description'), cSoldN=pick('Sold-To Name','Sold To Name'),
        cShipTo=pick('Ship-To','Ship To'), cShipToN=pick('Ship-To Name','Ship To Name'),
        cDelFob=pick('DEL/FOB'), cCarr=pick('Carrier'), cCarrN=pick('Carrier Name');
  const val=(row,c)=>c<0?'':(row[c]??'');

  if(!XLMAP) xlmapLoad();
  const agg=new Map();          // demand point name → Map(date → tonnes)       → Summary
  const aggPark=new Map();      // parked (transfer) name → Map(date → tonnes)  → Transfers
  const detail=[];              // one line per delivery                        → Detail
  const reasons=new Map();      // why a row could not be placed → {rows, t}
  const skipMats=new Map();     // material marked "not demand" → {desc, rows, t}
  const noRep=new Map();        // Ship-To with no sales rep → {name, rows, t}
  const memo=new Map();         // the same four codes translate the same way every time
  let mappedRows=0, mappedT=0, parkedRows=0, parkedT=0, ignoredRows=0, ignoredT=0, skipRows=0, skipT=0;
  let dateMin='', dateMax='';
  const addReason=(m,qty)=>{ const r=reasons.get(m)||{rows:0,t:0}; r.rows++; r.t+=qty; reasons.set(m,r); };
  const addDay=(map,nm,ds,qty)=>{ let byDate=map.get(nm); if(!byDate){ byDate=new Map(); map.set(nm,byDate); }
    byDate.set(ds,(byDate.get(ds)||0)+qty); };

  for(const row of rows){
    if(!row||!row.length) continue;
    const ship=row[cShip], mat=row[cMat], sold=row[cSold];
    // SALES/TRANS by Ship-To (the rule the SAP script also applies); the file's own
    // Ship Type column only when no list is set or there is no Ship-To column.
    const type=(cShipTo>=0&&xlmapShipType(row[cShipTo]))||row[cType];
    if((ship===''||ship==null)&&(mat===''||mat==null)) continue;   // blank line
    const qty=parseFloat(row[cQty])||0;
    const key=ship+'|'+mat+'|'+sold+'|'+type;
    let res=memo.get(key);
    if(!res){
      res=xlmapTranslate({ship_pt:ship,material:mat,sold_to:sold,ship_type:type});
      memo.set(key,res);
    }
    if(res.action==='skip'){
      skipRows++; skipT+=qty;
      const k=String(mat).trim(), s=skipMats.get(k)||{desc:String(val(row,cDesc)),rows:0,t:0}; s.rows++; s.t+=qty; skipMats.set(k,s);
      continue;
    }
    if(res.missing.length){
      const desc=String(val(row,cDesc)).trim();
      res.missing.forEach(m=>addReason(desc&&/^material /.test(m)?`${m} — ${desc}`:m, qty));
      continue;
    }
    if(res.action==='ignore'){ ignoredRows++; ignoredT+=qty; continue; }
    const ds=_dsSalesYmd(row[cDate]);
    if(!ds){ addReason('no delivery date on the row',qty); continue; }
    if(res.action==='park'){ parkedRows++; parkedT+=qty; addDay(aggPark,res.finalName,ds,qty); continue; }
    if(!dateMin||ds<dateMin) dateMin=ds;
    if(!dateMax||ds>dateMax) dateMax=ds;
    addDay(agg,res.finalName,ds,qty);
    mappedRows++; mappedT+=qty;
    // Detail line — the Excel's SalesDetailed columns, one per delivery. The pivot listed
    // Report Qty as a row field, so two identical deliveries became ONE line (67.6 kt lost,
    // 2025-01 → 2026-09); here every delivery keeps its own line, so loads can be counted.
    const shipTo=String(val(row,cShipTo)).trim();
    const rep=xlmapRep(shipTo);
    if(!rep&&shipTo){ const n=noRep.get(shipTo)||{name:String(val(row,cShipToN)).trim(),rows:0,t:0}; n.rows++; n.t+=qty; noRep.set(shipTo,n); }
    detail.push([val(row,cSold),val(row,cSoldN),shipTo,val(row,cShipToN),ship,val(row,cDelFob),
                 val(row,cCarr),val(row,cCarrN),ds,qty,res.finalName,rep]);
  }

  const points=[...agg].map(([nm,byDate])=>({
    name:nm, dp:xlmapFindDp(nm)?.id||null, days:byDate.size,
    t:[...byDate.values()].reduce((a,b)=>a+b,0)
  })).sort((a,b)=>Math.abs(b.t)-Math.abs(a.t));
  const matched=points.filter(p=>p.dp).length;
  const dayCount=m=>[...m].reduce((n,[,d])=>n+d.size,0);

  // What Publish writes. Memory only — publishing needs the export read this session.
  window._dsDemandPub={file:name, at:Date.now(), summary:agg, transfers:aggPark, detail, dateMin, dateMax};
  window._dsDemandPreview={
    file:name, at:Date.now(), rows:rows.length, mappedRows, mappedT, dateMin, dateMax, points,
    reasons:[...reasons].map(([reason,v])=>({reason,...v})).sort((a,b)=>Math.abs(b.t)-Math.abs(a.t)),
    parked:{rows:parkedRows,t:parkedT}, ignored:{rows:ignoredRows,t:ignoredT},
    skipped:{rows:skipRows,t:skipT,mats:[...skipMats].map(([code,v])=>({code,...v})).sort((a,b)=>Math.abs(b.t)-Math.abs(a.t))},
    noRep:[...noRep].map(([code,v])=>({code,...v})).sort((a,b)=>Math.abs(b.t)-Math.abs(a.t)),
    dayRows:dayCount(agg), transferRows:dayCount(aggPark), detailLoads:detail.filter(d=>d[9]>0).length
  };
  _xlUi.cmp=null;               // a comparison made against the previous read is stale
  if(document.getElementById('cfg-panel-demandmap')) xlmapRender();

  const warnings=[];
  const unplaced=[...reasons.values()].reduce((n,v)=>n+v.rows,0);
  if(unplaced) warnings.push(`${unplaced.toLocaleString()} row${unplaced===1?'':'s'} could not be placed — see Configuration → Demand Mapping`);
  const noDp=points.length-matched;
  if(noDp) warnings.push(`${noDp} demand point${noDp===1?'':'s'} in the file do not exist in this scenario yet`);
  return {rowCount:rows.length, matched, dateMin, dateMax, warnings};
}

// The preview card shown in Configuration → Demand Mapping.
function _xlSourceBody(){
  const p=window._dsDemandPreview;
  const meta=(typeof DS!=='undefined'&&DS.meta)?DS.meta.demandSales:null;
  const pick=`<span class="tbl-act" style="margin:0" onclick="dsPickFile('demandSales')">${meta&&meta.fileName?'Choose another file…':'Choose the file…'}</span>`;
  const reload=meta&&meta.fileName?`<span class="tbl-act" onclick="dsRefreshSlot('demandSales',true)">Re-read</span>`:'';
  const head=`<div style="padding:9px 12px;display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--border)">
      <span style="font-family:var(--mono);font-size:9px;color:${meta&&meta.error?'var(--amber)':'var(--text-dim)'}">
        ${meta&&meta.error?'⚠ '+esc(meta.error):
          meta&&meta.fileName
            ? '<span style="color:var(--text)">'+esc(meta.fileName)+'</span>'+(meta.lastLoaded?' · read '+esc(meta.lastLoaded):'')+(meta.fileSize?' · '+Math.round(meta.fileSize/1048576)+' MB':'')
            : 'No file chosen yet. Pick any file, anywhere — a SharePoint library synced to this machine works — and the app remembers it and re-reads it on every refresh.'}
      </span>
      <span style="margin-left:auto;display:flex;gap:10px">${reload}${pick}</span>
    </div>`;
  if(!p) return head+`<div style="padding:14px 12px;font-family:var(--mono);font-size:9px;color:var(--text-dim);text-align:center">
      Nothing read yet. The file is only previewed here — no demand value is written until you apply it.</div>`;
  const n=v=>Math.round(v).toLocaleString();
  const stat=(l,v,c)=>`<div style="flex:1;min-width:110px"><div style="font-family:var(--mono);font-size:8px;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase">${l}</div>
    <div style="font-family:var(--mono);font-size:13px;font-weight:700;color:${c||'var(--text)'}">${v}</div></div>`;
  const noDp=p.points.filter(x=>!x.dp);
  let h=head+`<div style="padding:10px 12px;display:flex;gap:14px;flex-wrap:wrap;border-bottom:1px solid var(--border)">
    ${stat('Rows read',n(p.rows))}
    ${stat('Placed',n(p.mappedRows),'var(--green)')}
    ${stat('Tonnes',n(p.mappedT),'var(--green)')}
    ${stat('Demand points',p.points.length)}
    ${stat('Daily records',n(p.dayRows))}
    ${stat('Range',(p.dateMin||'—')+' → '+(p.dateMax||'—'))}
  </div>`;
  h+=_xlPubHTML();
  if(p.reasons.length){
    h+=`<div style="padding:9px 12px;border-bottom:1px solid var(--border)">
      <div style="font-family:var(--mono);font-size:8px;letter-spacing:1px;color:var(--amber);text-transform:uppercase;margin-bottom:4px">Could not be placed — biggest first</div>
      ${p.reasons.slice(0,14).map(r=>{ const mm=/^material (\d+) is not in the material table/.exec(r.reason);
        return `<div style="font-family:var(--mono);font-size:9px;color:var(--text);margin:2px 0">
        <span style="color:var(--amber)">⚠</span> ${esc(r.reason)}
        <span style="color:var(--text-dim)"> · ${n(r.rows)} rows · ${n(r.t)} t</span>
        ${mm?`<span class="tbl-act" title="Type the SAP code into the product's Material Code in Configuration → Products, or add a table row here" onclick="_xlUi.open.mat=true;_xlAdd('materials',{code:'${mm[1]}',product:'',pres:'BLK',note:''})">+ table row</span>`:''}</div>`; }).join('')}
      <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:4px">Counts are from when the file was read — Re-read after changing a table or a product's SAP code.</div>
      ${p.reasons.length>14?`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">· and ${p.reasons.length-14} more</div>`:''}
    </div>`;
  }
  if(p.parked.rows||p.ignored.rows){
    h+=`<div style="padding:7px 12px;font-family:var(--mono);font-size:9px;color:var(--text-dim);border-bottom:1px solid var(--border)">
      ${p.parked.rows?`Parked by a movement rule: ${n(p.parked.rows)} rows · ${n(p.parked.t)} t — written to ${XLPUB_FILES.transfers}. `:''}
      ${p.ignored.rows?`Ignored by an alias: ${n(p.ignored.rows)} rows · ${n(p.ignored.t)} t.`:''}</div>`;
  }
  const sk=p.skipped;
  if(sk&&sk.rows){
    h+=`<div style="padding:7px 12px;font-family:var(--mono);font-size:9px;color:var(--text-dim);border-bottom:1px solid var(--border)">
      Not demand (material rows set to skip): ${n(sk.rows)} rows · ${n(sk.t)} t
      <div style="padding-left:12px;line-height:1.6">${sk.mats.slice(0,8).map(m=>`${esc(m.code)} ${esc(m.desc||'')} · ${n(m.t)} t`).join('<br>')}
      ${sk.mats.length>8?`<br>· and ${sk.mats.length-8} more`:''}</div></div>`;
  }
  if(noDp.length){
    h+=`<div style="padding:9px 12px;border-bottom:1px solid var(--border)">
      <div style="font-family:var(--mono);font-size:8px;letter-spacing:1px;color:var(--amber);text-transform:uppercase;margin-bottom:4px">In the file, no demand point here yet — ${noDp.length}</div>
      ${noDp.slice(0,14).map(x=>`<div style="font-family:var(--mono);font-size:9px;margin:2px 0">${esc(x.name)}
        <span style="color:var(--text-dim)"> · ${n(x.t)} t · ${x.days} days</span></div>`).join('')}
      ${noDp.length>14?`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">· and ${noDp.length-14} more</div>`:''}
    </div>`;
  }
  h+=`<div style="padding:9px 12px">
    <div style="font-family:var(--mono);font-size:8px;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase;margin-bottom:4px">Lands on — biggest first</div>
    ${p.points.slice(0,20).map(x=>`<div style="font-family:var(--mono);font-size:9px;margin:2px 0;color:${x.dp?'var(--text)':'var(--amber)'}">
      ${x.dp?'<span style="color:var(--green)">✓</span>':'<span style="color:var(--amber)">+</span>'} ${esc(x.name)}
      <span style="color:var(--text-dim)"> · ${n(x.t)} t · ${x.days} days</span></div>`).join('')}
    ${p.points.length>20?`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">· and ${p.points.length-20} more</div>`:''}
  </div>`;
  return h;
}

// ── Publish: the app's own copies of the sales files ─────────────────────────
// The old chain was SAP → one big workbook (INV_ROLL_NAME formula + index tab + three
// pivots) → values pasted into three small files. Publish translates the export read above
// once, here, into the same three files — same sheets, same columns — so they can be compared
// with the pipeline script's, which applies the same rules (Avila_Demand_Rules.json).
// Since 2026-10-13 the SAP pipeline script (Avila_Sales_Pipeline.vbs, on the SAP PC) is the ONLY
// writer of the three files everyone reads (XLPUB_PIPELINE). Publish writes its own copies, tagged
// "(app)", next to them — so the two writers never replace each other's files. Compare reads the
// pipeline's files; Real Sales is never pointed at the app's copies by Publish.
const XLPUB_PIPELINE={summary:'Avila_Shipments_Summary.xlsx', detail:'Avila_Shipments_Detail.xlsx',
                      transfers:'Avila_Transfers_Summary.xlsx'};
const XLPUB_FILES={summary:'Avila_Shipments_Summary (app).xlsx', detail:'Avila_Shipments_Detail (app).xlsx',
                   transfers:'Avila_Transfers_Summary (app).xlsx', map:'Avila_Demand_Rules.json'};
const XLPUB_LAST_KEY='avila_sap_pub_last';

// 'YYYY-MM-DD' → Excel date serial, from calendar parts (no local-midnight maths).
function _xlSerial(ds){
  const [y,m,d]=ds.split('-').map(Number);
  return Math.round((Date.UTC(y,m-1,d)-Date.UTC(1899,11,30))/864e5);
}
const _xlCode=v=>{ const s=String(v??'').trim(); return /^\d+$/.test(s)&&s.length<16?Number(s):s; };
const _xlQty=v=>Math.round(v*1000)/1000;
function _xlDateCol(ws,col,n){
  for(let r=1;r<=n;r++){ const c=ws[XLSX.utils.encode_cell({r,c:col})]; if(c){ c.t='n'; c.z='m/d/yyyy'; } }
}
// Summary / Transfers: one row per day per demand point, newest day first (as the pivot).
function _xlDaySheet(byName){
  const out=[];
  byName.forEach((byDate,nm)=>byDate.forEach((t,ds)=>out.push([ds,nm,t])));
  out.sort((a,b)=>a[0]<b[0]?1:a[0]>b[0]?-1:a[1]<b[1]?-1:a[1]>b[1]?1:0);
  const aoa=[['Delivery Date','INV_ROLL_NAME','Report Qty']].concat(out.map(r=>[_xlSerial(r[0]),r[1],_xlQty(r[2])]));
  const ws=XLSX.utils.aoa_to_sheet(aoa); _xlDateCol(ws,0,out.length);
  return {ws, rows:out.length, t:out.reduce((a,r)=>a+r[2],0)};
}
// Same rows as the pipeline script's Detail (CollapseDetail): one per day × Ship-To × demand point
// × DEL/FOB × Ship Pt × Carrier, tonnes summed, Loads = its deliveries with a positive quantity
// (a return nets its tonnes but is not a load).
function _xlDetailCollapse(detail){
  const by=new Map();
  for(const [so,son,sh,shn,sp,df,ca,can,ds,q,nm,rep] of detail){
    const k=[ds,_xlCode(sh),nm,df,_xlCode(sp),_xlCode(ca)].join('\u0001');
    let a=by.get(k);
    if(!a){ a=[so,son,sh,shn,sp,df,ca,can,ds,0,nm,rep,0]; by.set(k,a); }
    a[9]+=q; if(q>0) a[12]++;
  }
  return [...by.values()];
}
function _xlDetailSheet(detail){
  const out=_xlDetailCollapse(detail).map(([so,son,sh,shn,sp,df,ca,can,ds,q,nm,rep,loads])=>
    [_xlCode(so),son,_xlCode(sh),shn,_xlCode(sp),df,_xlCode(ca),can,ds,_xlQty(q),nm,rep,loads]);
  const cmp=(x,y)=>typeof x==='number'&&typeof y==='number'?x-y:(String(x)<String(y)?-1:String(x)>String(y)?1:0);
  out.sort((a,b)=>cmp(a[0],b[0])||cmp(a[2],b[2])||cmp(a[8],b[8]));   // Sold-To, Ship-To, day
  out.forEach(r=>{ r[8]=_xlSerial(r[8]); });
  const aoa=[['Sold-To','Sold-To Name','Ship-To','Ship-To Name','Ship Pt','DEL/FOB','Carrier','Carrier Name',
              'Delivery Date','Report Qty','INV_ROLL_NAME','SalesRep','Loads']].concat(out);
  const ws=XLSX.utils.aoa_to_sheet(aoa); _xlDateCol(ws,8,out.length);
  return {ws, rows:out.length, loads:out.reduce((a,r)=>a+r[12],0)};
}
const _xlBook=(sheet,ws)=>{ const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,sheet); return wb; };

// SheetJS's own zip deflate is quick but weak: the Detail sheet is 79 MB of XML and came
// out at 25 MB, three times the Excel-made file — a slow OneDrive upload and a slow Power
// BI refresh. So SheetJS writes the workbook uncompressed and the browser's native
// deflate (CompressionStream) re-packs each part: same bytes inside, Excel's size outside.
let _crcTable=null;
function _crc32(u8){
  if(!_crcTable){ _crcTable=new Uint32Array(256);
    for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; _crcTable[n]=c>>>0; } }
  let c=0xFFFFFFFF;
  for(let i=0;i<u8.length;i++) c=_crcTable[(c^u8[i])&255]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}
async function _xlsxBytes(wb){
  const opts={bookType:'xlsx',type:'array',bookSST:true};
  if(typeof CompressionStream==='undefined') return XLSX.write(wb,{...opts,compression:true});
  const zip=XLSX.CFB.read(new Uint8Array(XLSX.write(wb,{...opts,compression:false})),{type:'array'});
  const parts=[];
  zip.FileIndex.forEach((f,i)=>{ if(f.type===2&&f.content)
    parts.push({name:zip.FullPaths[i].replace(/^[^/]*\//,''), data:new Uint8Array(f.content)}); });
  parts.sort((a,b)=>(b.name==='[Content_Types].xml')-(a.name==='[Content_Types].xml'));
  const enc=new TextEncoder(), chunks=[], central=[];
  const now=new Date(), dosT=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),
        dosD=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
  let off=0;
  for(const p of parts){
    const comp=new Uint8Array(await new Response(new Blob([p.data]).stream()
      .pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const name=enc.encode(p.name), crc=_crc32(p.data);
    const lh=new DataView(new ArrayBuffer(30));
    [[0,0x04034b50,4],[4,20,2],[6,0,2],[8,8,2],[10,dosT,2],[12,dosD,2],[14,crc,4],
     [18,comp.length,4],[22,p.data.length,4],[26,name.length,2],[28,0,2]]
      .forEach(([o,v,n])=>n===4?lh.setUint32(o,v,true):lh.setUint16(o,v,true));
    const ch=new DataView(new ArrayBuffer(46));
    [[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0,2],[10,8,2],[12,dosT,2],[14,dosD,2],[16,crc,4],
     [20,comp.length,4],[24,p.data.length,4],[28,name.length,2],[30,0,2],[32,0,2],[34,0,2],
     [36,0,2],[38,0,4],[42,off,4]]
      .forEach(([o,v,n])=>n===4?ch.setUint32(o,v,true):ch.setUint16(o,v,true));
    chunks.push(new Uint8Array(lh.buffer),name,comp);
    central.push(new Uint8Array(ch.buffer),name);
    off+=30+name.length+comp.length;
  }
  const cdSize=central.reduce((a,c)=>a+c.length,0);
  const end=new DataView(new ArrayBuffer(22));
  [[0,0x06054b50,4],[4,0,2],[6,0,2],[8,parts.length,2],[10,parts.length,2],[12,cdSize,4],[16,off,4],[20,0,2]]
    .forEach(([o,v,n])=>n===4?end.setUint32(o,v,true):end.setUint16(o,v,true));
  return new Blob([...chunks,...central,new Uint8Array(end.buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

// A day file as it sits in the folder now → totals by demand point and by month.
async function _xlReadDayFile(dir,file){
  let f;
  try{ f=await (await dir.getFileHandle(file)).getFile(); }catch(e){ return null; }
  const wb=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:true,dense:true});
  const ws=wb.Sheets[wb.SheetNames.find(n=>n==='SalesConsolidated')||wb.SheetNames[0]];
  const aoa=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''});
  const h0=aoa.findIndex(r=>r.some(c=>String(c).trim()==='INV_ROLL_NAME'));
  if(h0<0) return {file, modified:f.lastModified, rows:0, t:0, byName:new Map(), byMonth:new Map(), dateMin:'', dateMax:''};
  const hdr=aoa[h0].map(c=>String(c).trim());
  const cD=hdr.indexOf('Delivery Date'), cN=hdr.indexOf('INV_ROLL_NAME'), cQ=hdr.indexOf('Report Qty');
  const byName=new Map(), byMonth=new Map(); let rows=0,t=0,dateMin='',dateMax='';
  aoa.slice(h0+1).forEach(r=>{
    const ds=_dsSalesYmd(r[cD]); if(!ds) return;
    const nm=String(r[cN]??'').trim(), q=parseFloat(r[cQ])||0;
    rows++; t+=q;
    if(!dateMin||ds<dateMin) dateMin=ds; if(!dateMax||ds>dateMax) dateMax=ds;
    byName.set(nm,(byName.get(nm)||0)+q); byMonth.set(ds.slice(0,7),(byMonth.get(ds.slice(0,7))||0)+q);
  });
  return {file, modified:f.lastModified, rows, t, byName, byMonth, dateMin, dateMax};
}
function _xlPubTotals(byName){
  const n=new Map(), m=new Map(); let t=0, rows=0;
  byName.forEach((byDate,nm)=>byDate.forEach((q,ds)=>{
    rows++; t+=q; n.set(nm,(n.get(nm)||0)+q); m.set(ds.slice(0,7),(m.get(ds.slice(0,7))||0)+q); }));
  return {byName:n, byMonth:m, t, rows};
}
const _xlDiffRows=(a,b)=>[...new Set([...a.keys(),...b.keys()])]
  .map(k=>({k, now:a.get(k)||0, next:b.get(k)||0})).map(r=>({...r, d:r.next-r.now}));

async function _xlPubChooseDir(){
  const h=await exportDir('sap',true);
  if(h){ statMsg('Sales files folder: '+h.name); await _xlSaveRules(false,'click'); }
  xlmapRender();
}
async function _xlPubClearDir(){ await clearExportDir('sap'); xlmapRender(); }

// Compare what Publish would write with the files in the folder now — the parallel
// run: while the Excel still makes the files, this shows every place the two disagree.
async function _xlCompare(){
  const pub=window._dsDemandPub;
  if(!pub){ statMsg('Read the SAP export first (Re-read above)'); return; }
  const dir=await exportDir('sap',true);   // first: the picker needs the click
  if(!dir){ statMsg('Choose the folder the sales files live in first'); return; }
  statMsg('Comparing with the files in '+dir.name+'…');
  await loadLib('xlsx');
  const [curS,curT]=await Promise.all([_xlReadDayFile(dir,XLPUB_PIPELINE.summary),_xlReadDayFile(dir,XLPUB_PIPELINE.transfers)]);
  const newS=_xlPubTotals(pub.summary), newT=_xlPubTotals(pub.transfers);
  _xlUi.cmp={at:Date.now(), folder:dir.name, curS, curT, newS, newT,
    names:curS?_xlDiffRows(curS.byName,newS.byName).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)):[],
    months:curS?_xlDiffRows(curS.byMonth,newS.byMonth).sort((a,b)=>a.k<b.k?-1:1):[]};
  _xlUi.open.src=true;
  xlmapRender();
  statMsg('Comparison ready');
}

async function _xlPublish(){
  const pub=window._dsDemandPub;
  if(!pub){ statMsg('Read the SAP export first (Re-read above)'); return; }
  const dir=await exportDir('sap',true);   // first: the picker needs the click
  if(!dir){ statMsg('Choose the folder the sales files live in first'); return; }
  const p=window._dsDemandPreview||{};
  const n=v=>Math.round(v).toLocaleString();
  const unplaced=(p.reasons||[]).reduce((a,r)=>a+r.t,0);
  if(!confirm(`Write the app's copies of the sales files in "${dir.name}"?\n\n`+
    `${XLPUB_FILES.summary} — ${n(p.dayRows||0)} rows · ${n(p.mappedT||0)} t\n`+
    `${XLPUB_FILES.detail} — ${n(p.detailLoads||0)} loads, one row per day × ship-to × point × DEL/FOB × plant × carrier\n`+
    `${XLPUB_FILES.transfers} — ${n(p.transferRows||0)} rows\n`+
    `${XLPUB_FILES.map} — the translation tables\n\n`+
    (unplaced?`${n(unplaced)} t could not be placed and is left out (listed under the source file).\n`:'')+
    `The SAP pipeline's own files (${XLPUB_PIPELINE.summary}, …) are not touched. Previous "(app)" copies go to Backup/ first.`)) return;
  const btn=document.getElementById('xl-pub-btn');
  const say=t=>{ if(btn) btn.textContent=t; };
  try{
    if(btn) btn.disabled=true;
    await loadLib('xlsx');
    say('Building…');
    await new Promise(r=>setTimeout(r,30));   // let the label paint before the heavy part
    const s=_xlDaySheet(pub.summary), tr=_xlDaySheet(pub.transfers), de=_xlDetailSheet(pub.detail);
    const files=[
      [XLPUB_FILES.summary,  await _xlsxBytes(_xlBook('SalesConsolidated',s.ws))],
      [XLPUB_FILES.transfers,await _xlsxBytes(_xlBook('SalesConsolidated',tr.ws))],
      [XLPUB_FILES.detail,   await _xlsxBytes(_xlBook('SalesDetailed',de.ws))],
      [XLPUB_FILES.map,      new Blob([JSON.stringify(xlmapRulesPayload(),null,1)],{type:'application/json'})]
    ];
    say('Backing up…');
    const bak=await dir.getDirectoryHandle('Backup',{create:true});
    for(const [fn] of files){
      try{
        const old=await (await dir.getFileHandle(fn)).getFile();
        const dot=fn.lastIndexOf('.');
        const w=await (await bak.getFileHandle(fn.slice(0,dot)+' (before publish)'+fn.slice(dot),{create:true})).createWritable();
        await w.write(await old.arrayBuffer()); await w.close();
      }catch(e){ if(e.name!=='NotFoundError') throw e; }   // nothing there yet — nothing to keep
    }
    say('Writing…');
    for(const [fn,data] of files){
      const w=await (await dir.getFileHandle(fn,{create:true})).createWritable();
      await w.write(data); await w.close();
    }
    const last={at:_xlLocalStamp(), folder:dir.name, source:pub.file,
      summaryRows:s.rows, summaryT:s.t, detailRows:de.rows, detailLoads:de.loads, transferRows:tr.rows, dateMin:pub.dateMin, dateMax:pub.dateMax};
    try{ localStorage.setItem(XLPUB_LAST_KEY,JSON.stringify(last)); }catch(e){}
    _xlUi.cmp=null;

    // Actuals come from the pipeline's Summary through Real Sales. Only a scenario whose Real Sales
    // was deliberately pointed at the app's copy is refreshed here; Publish never re-points it.
    say('Updating this scenario…');
    const sh=await dir.getFileHandle(XLPUB_FILES.summary);
    let same=false; const cur=DS.handles.realSales;
    if(cur){ try{ same=await cur.isSameEntry(sh); }catch(e){} }
    if(same){
      await dsRefreshSlot('realSales',true);
      delete DS.pending.realSales;
      document.getElementById('data-pending-banner')?.remove();
      dsRefreshConfigUI();
      scheduleSimulation(300);
      statMsg(`Published to ${dir.name} — this scenario's actual demand is updated`);
    }else{
      statMsg(`App copies written to ${dir.name}. Real Sales here keeps reading ${DS.meta.realSales?.fileName||'the pipeline\'s Summary'}.`);
    }
  }catch(e){
    console.error('publish',e);
    alert('Publish stopped: '+(e.message||e)+'\n\nFiles already written stay written; the previous copies are in Backup/.');
  }finally{
    if(btn){ btn.disabled=false; }
    xlmapRender();
  }
}

// The publish block inside the Source file card.
function _xlPubHTML(){
  const p=window._dsDemandPreview;
  const n=v=>Math.round(v).toLocaleString();
  const folder=exportDirName('sap');
  let last=null; try{ last=JSON.parse(localStorage.getItem(XLPUB_LAST_KEY)||'null'); }catch(e){}
  const ready=!!window._dsDemandPub;
  let h=`<div style="padding:10px 12px;border-bottom:1px solid var(--border)">
    <div style="font-family:var(--mono);font-size:8px;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase;margin-bottom:6px">Publish from the app — its own "(app)" copies, beside the SAP pipeline's files${folder?'':' (choose the folder above first)'}</div>
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);line-height:1.6;margin-bottom:8px">
      ${ready&&p?`Writes <span style="color:var(--text)">${XLPUB_FILES.summary}</span> (${n(p.dayRows)} rows · ${n(p.mappedT)} t),
        <span style="color:var(--text)">${XLPUB_FILES.detail}</span> (${n(p.detailLoads)} loads, one row per day × ship-to × point × DEL/FOB × plant × carrier),
        <span style="color:var(--text)">${XLPUB_FILES.transfers}</span> (${n(p.transferRows)} rows) and
        <span style="color:var(--text)">${XLPUB_FILES.map}</span>. Previous "(app)" copies go to Backup/ first.
        The SAP pipeline's own files — the ones Real Sales, the Sales page and Power BI read — are never replaced from here.`
      :`Re-read the export above first — publishing writes what was read in this session.`}
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="tb-btn sec" style="font-size:9px;padding:4px 12px" ${ready?'':'disabled'} onclick="_xlCompare()">Compare with the pipeline's files</button>
      <button class="tb-btn" id="xl-pub-btn" style="font-size:9px;padding:4px 14px" ${ready?'':'disabled'} onclick="_xlPublish()">Publish</button>
      ${last?`<span style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-left:6px">last published ${esc(last.at)} to ${esc(last.folder)} · ${n(last.summaryRows)} rows · ${n(last.summaryT)} t</span>`:''}
    </div>`;
  const c=_xlUi.cmp;
  if(c){
    const sgn=v=>(v>0?'+':v<0?'−':'')+n(Math.abs(v));
    const dCol=v=>Math.abs(v)<1?'var(--text-dim)':'var(--amber)';
    const box=(title,cur,nw)=>`<div style="flex:1;min-width:220px;border:1px solid var(--border);padding:7px 9px">
      <div style="font-family:var(--mono);font-size:8px;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase;margin-bottom:3px">${title}</div>
      ${cur?`<div style="font-family:var(--mono);font-size:9px">there now <span style="color:var(--text)">${n(cur.t)} t</span> · ${n(cur.rows)} rows · ${esc(cur.dateMin)} → ${esc(cur.dateMax)}</div>`
          :`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">no file there yet</div>`}
      <div style="font-family:var(--mono);font-size:9px">from SAP <span style="color:var(--text)">${n(nw.t)} t</span> · ${n(nw.rows)} rows</div>
      ${cur?`<div style="font-family:var(--mono);font-size:10px;font-weight:700;color:${dCol(nw.t-cur.t)}">${Math.abs(nw.t-cur.t)<1?'✓ same tonnes':'difference '+sgn(nw.t-cur.t)+' t'}</div>`:''}
    </div>`;
    h+=`<div style="margin-top:10px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">${box('Summary',c.curS,c.newS)}${box('Transfers',c.curT,c.newT)}</div>`;
    const pd=window._dsDemandPub;
    if(c.curS&&pd&&((c.curS.dateMin&&c.curS.dateMin<pd.dateMin)||(c.curS.dateMax&&c.curS.dateMax>pd.dateMax)))
      h+=`<div style="font-family:var(--mono);font-size:9px;color:var(--amber);margin-bottom:6px">⚠ The file there now covers ${esc(c.curS.dateMin)} → ${esc(c.curS.dateMax)}; the export covers ${esc(pd.dateMin)} → ${esc(pd.dateMax)}. Days outside the export are dropped when you publish.</div>`;
    const tbl=(title,rows,label)=>{
      const off=rows.filter(r=>Math.abs(r.d)>=1);
      if(!off.length) return `<div style="font-family:var(--mono);font-size:9px;color:var(--green);margin:4px 0 8px">✓ ${title}: every ${label} matches</div>`;
      return `<div style="font-family:var(--mono);font-size:8px;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase;margin:6px 0 3px">${title} — ${off.length} differ${rows.length>off.length?` · ${rows.length-off.length} match`:''}</div>
        ${_xlTbl(_xlHdr([label,'there now','from SAP','difference'])+off.slice(0,30).map(r=>`<tr>
          ${_xlTd(`<span style="font-family:var(--mono);font-size:9px">${esc(r.k||'(blank)')}</span>`)}
          ${_xlTd(`<span style="font-family:var(--mono);font-size:9px">${n(r.now)}</span>`,'90px')}
          ${_xlTd(`<span style="font-family:var(--mono);font-size:9px">${n(r.next)}</span>`,'90px')}
          ${_xlTd(`<span style="font-family:var(--mono);font-size:9px;color:${dCol(r.d)}">${sgn(r.d)}</span>`,'90px')}
        </tr>`).join(''))}
        ${off.length>30?`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">· and ${off.length-30} more</div>`:''}`;
    };
    if(c.curS){ h+=tbl('Summary by demand point',c.names,'demand point'); h+=tbl('Summary by month',c.months,'month'); }
    h+=`<div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:4px">Compared ${new Date(c.at).toLocaleTimeString()} against ${esc(c.folder)}. A name only "there now" is usually one the Excel index built and these tables do not (or #N/A).</div></div>`;
  }
  return h+`</div>`;
}

// ── The rules file the SAP script reads ─────────────────────────────────────
// Avila_Demand_Rules.json, next to the sales files. The app is the only place the rules
// are edited; the script (Avila_Sales_Pipeline.vbs) only applies them. The product
// catalog is flattened in because the script has no scenario to look products up in —
// a product placed through its catalog SAP code (BRS_IL(HE)) would otherwise be dropped.
// rules_id is a hash of the content: the script stamps it on every file it writes.
function _xlHash(text){
  let h=0x811c9dc5;
  for(let i=0;i<text.length;i++){ h^=text.charCodeAt(i); h=Math.imul(h,0x01000193); }
  return (h>>>0).toString(16).padStart(8,'0');
}
// 'YYYY-MM-DD HH:MM' on this computer's clock (toISOString is UTC — 21:40 for 5:40 PM).
function _xlLocalStamp(d){
  d=d||new Date();
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Canonical JSON (keys sorted) so the same rules hash the same on every computer,
// whatever order a row's fields happened to be typed in.
function _xlCanon(v){
  if(Array.isArray(v)) return '['+v.map(_xlCanon).join(',')+']';
  if(v&&typeof v==='object') return '{'+Object.keys(v).filter(k=>v[k]!==undefined).sort()
    .map(k=>JSON.stringify(k)+':'+_xlCanon(v[k])).join(',')+'}';
  return JSON.stringify(v??null);
}
// The part people edit — what two computers must agree on. The catalog is not in it:
// it comes from whichever scenario is open.
function _xlTablesOf(o){
  return {template:o.template||'', fallback_class:o.fallback_class||'', fallback_rep:o.fallback_rep||'',
    transfer_ship_tos:o.transfer_ship_tos||'', ship_points:o.ship_points||[], materials:o.materials||[],
    class_rules:o.class_rules||[], movements:o.movements||[], aliases:o.aliases||[], sales_reps:o.sales_reps||[]};
}
const _xlTablesId=o=>_xlHash(_xlCanon(_xlTablesOf(o)));
function xlmapRulesPayload(){
  if(!XLMAP) xlmapLoad();
  const catalog=[];
  (DB.products||[]).forEach(p=>{
    const sp=_xlSplitProduct(p.name);
    _xlCatCodes(p.material_code).forEach(k=>catalog.push({code:k.sap, ship_pt:k.ship, product:sp.product, pres:sp.pres, name:p.name}));
  });
  // The topology's own ship points (facility Plant # codes, product material codes): the
  // script asks SAP for these too and names a code the table lacks after its facility.
  // …and the demand points themselves, so the script's report can say which ones SAP feeds.
  const facName=id=>((DB.facilities||[]).find(f=>f.id===id)||{}).name||'';
  const body={format:'avila-demand-rules', version:XLMAP.version||3, ..._xlTablesOf(XLMAP), catalog_materials:catalog,
    catalog_ship_points:_xlTopologyShipPoints().map(t=>({code:t.code, source:t.source, facility:t.facility, from:t.from, label:t.label})),
    demand_points:(DB.elements||[]).filter(e=>e.type==='demand_point')
      .map(e=>({name:String(e.name||''), dp_code:String(e.props?.dp_code||''),   // dp_code: the override the import also matches
                facility:facName(e.assigned_facility_id||e.facility_id), active:e.is_active!==false}))};
  return {...body, rules_id:_xlHash(_xlCanon(body)), tables_id:_xlTablesId(XLMAP), tables_edited_at:XLMAP.edited_at||'',
    saved_at:new Date().toISOString(), saved_at_local:_xlLocalStamp(),
    scenario:(typeof scActive==='function'?scActive()?.name:'')||''};
}
const XLRULES_SAVED_KEY='avila_rules_saved';
let _xlRulesTimer=null;
// Any edit (a table, a product's SAP code) → write the file a moment later, silently,
// if the folder is already open this session. Otherwise the panel says it is behind.
function _xlRulesChanged(){
  clearTimeout(_xlRulesTimer);
  _xlRulesTimer=setTimeout(()=>{ _xlSaveRules(false); },1500);
}
async function _xlReadRulesFile(dir){
  try{
    const f=await (await dir.getFileHandle(XLPUB_FILES.map)).getFile();
    const o=JSON.parse(await f.text());
    return o&&o.format==='avila-demand-rules'?o:null;
  }catch(e){ return null; }   // not there yet
}
function _xlAdoptRules(file){
  XLMAP={...XLMAP, ..._xlTablesOf(file), edited_at:file.tables_edited_at||file.saved_at||''};
  try{ localStorage.setItem(XLMAP_KEY, JSON.stringify(XLMAP)); }catch(e){}
  _xlRepIdx=null; _xlTrfSet=null; _xlUi.check=null;
}
const _xlWhen=iso=>{ if(!iso) return 'never (still the defaults)'; const d=new Date(iso); return isNaN(d)?String(iso):_xlLocalStamp(d); };
// Each computer's browser keeps its own copy of the tables (localStorage); the file in the
// shared folder is what they meet on. So the file is READ before it is written: rules
// changed only on the other computer are taken, rules changed only here are written, and
// when both changed the person picks — never a silent overwrite (on 9/24 the SAP computer
// had 29 ship points and this one 27).
// mode: 'edit' (after a change here), 'click' (Save rules now / choosing the folder),
// 'open' (opening Demand Mapping — only reads; it never rewrites the file just because
// this scenario's product catalog differs from the one the file was saved with).
async function _xlSaveRules(prompt, mode){
  mode=mode||'edit';
  if(scIsPlanning()) return false;   // the SAP pipeline reads Execution's demand points, never Planning's
  let ok=false, note='';
  try{
    const dir=await exportDir('sap',!!prompt);   // prompt only from a click
    if(!dir){ if(prompt) statMsg('Choose the folder the sales files live in first'); return false; }
    let saved=null; try{ saved=JSON.parse(localStorage.getItem(XLRULES_SAVED_KEY)||'null'); }catch(e){}
    const base=(saved&&saved.tables_id)||null;   // the tables this browser last read or wrote
    const file=await _xlReadRulesFile(dir);
    if(file){
      const fileT=file.tables_id||_xlTablesId(file), localT=_xlTablesId(XLMAP);
      if(fileT!==localT){
        let takeFile;
        if(!XLMAP.edited_at) takeFile=true;                 // never edited on this computer
        else if(base&&localT===base) takeFile=true;          // only the other computer changed them
        else if(base&&fileT===base) takeFile=false;          // only this computer changed them
        else{
          const fT=file.tables_edited_at||file.saved_at||'', lT=XLMAP.edited_at||'';
          takeFile=confirm(`The demand-mapping rules were changed both in ${dir.name}/${XLPUB_FILES.map} and in this browser.\n\n`+
            `File: last edited ${_xlWhen(fT)}${fT>lT?'   ← newer':''}  (saved from scenario "${file.scenario||'?'}")\n`+
            `This computer: last edited ${_xlWhen(lT)}${lT>fT?'   ← newer':''}\n\n`+
            `OK = use the FILE's rules here (this computer's changes are dropped)\n`+
            `Cancel = keep THIS computer's rules and overwrite the file`);
        }
        if(takeFile){
          _xlAdoptRules(file);
          note=`Rules loaded from ${dir.name} — last edited ${_xlWhen(file.tables_edited_at||file.saved_at)}`;
        }
      }
    }
    const payload=xlmapRulesPayload();
    let at=_xlLocalStamp(), id=payload.rules_id;
    const sameTables=file&&(file.tables_id||_xlTablesId(file))===payload.tables_id;
    // Opening Demand Mapping in the SAME scenario the file was written from refreshes the
    // scenario part (catalog, topology ship points, demand points) — that is what keeps the
    // SAP script's list current. Another scenario never overwrites it just by opening.
    const sameScenario=!!file&&!!payload.scenario&&file.scenario===payload.scenario;
    if(file&&(file.rules_id===payload.rules_id||(mode==='open'&&sameTables&&!sameScenario))){
      at=file.saved_at_local||at; id=file.rules_id||id;    // nothing of ours to write
    }else{
      const w=await (await dir.getFileHandle(XLPUB_FILES.map,{create:true})).createWritable();
      await w.write(new Blob([JSON.stringify(payload,null,1)],{type:'application/json'}));
      await w.close();
    }
    try{ localStorage.setItem(XLRULES_SAVED_KEY,JSON.stringify({at, id,
      tables_id:payload.tables_id, folder:dir.name})); }catch(e){}
    if(note){ statMsg(note); if(document.getElementById('cfg-panel-demandmap')) xlmapRender(); }
    else if(prompt) statMsg(`Rules saved to ${dir.name}/${XLPUB_FILES.map}`);
    ok=true;
    _xlLoadSapStatus(false);   // same folder: what the SAP script asked for last time
  }catch(e){ console.warn('rules save',e); if(prompt) statMsg('Could not save the rules file: '+(e.message||e)); }
  const el=document.getElementById('xl-rules-row'); if(el) el.outerHTML=_xlFolderRulesHTML();
  return ok;
}
// Folder + rules status, at the top of Demand Mapping.
function _xlFolderRulesHTML(){
  const folder=exportDirName('sap');
  let saved=null; try{ saved=JSON.parse(localStorage.getItem(XLRULES_SAVED_KEY)||'null'); }catch(e){}
  let cur=''; try{ cur=xlmapRulesPayload().rules_id; }catch(e){}
  const upToDate=saved&&saved.id===cur;
  const state=!saved?`<span style="color:var(--amber)">not saved yet</span>`
    :upToDate?`<span style="color:var(--green)">✓ saved ${esc(saved.at)}</span> <span style="color:var(--text-dim)">· id ${esc(saved.id)}</span>`
    :`<span style="color:var(--amber)">⚠ changed since it was saved (${esc(saved.at)})</span>`;
  return `<div id="xl-rules-row" style="padding:9px 12px;font-family:var(--mono);font-size:9px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center">
    <span style="font-size:8px;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase">Sales files folder</span>
    ${folder?`<span style="color:var(--green)">📁 ${esc(folder)}</span>
      <span class="tbl-act" style="margin:0" onclick="_xlPubChooseDir()">Change…</span>
      <span class="tbl-act" style="margin:0" onclick="_xlPubClearDir()">Clear</span>`
    :`<span class="tbl-act" style="margin:0" onclick="_xlPubChooseDir()">Choose the folder…</span>
      <span style="color:var(--text-dim)">RealValues — where the Summary, Detail and Transfers live</span>`}
    <span style="flex-basis:100%;height:0"></span>
    <span style="font-size:8px;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase">Rules for the SAP script</span>
    <span style="color:var(--text)">${XLPUB_FILES.map}</span> ${state}
    <span class="tbl-act" style="margin:0" onclick="_xlSaveRules(true,'click')">Save rules now</span>
  </div>`;
}

async function dsIngestTopology(buf, name){
  try{
    const text = new TextDecoder().decode(buf);
    const saved = JSON.parse(text);
    if(!saved.DB) return {rowCount:0, error:'No DB found in JSON'};
    if(_scIsSalesPayload(saved)) return {rowCount:0, error:'This is an Avila Sales file, not a topology'};

    // ── Stale-file safety net ────────────────────────────────────────────
    // On automatic startup refresh only: if this browser's saved edits are
    // NEWER than the file on disk, the previous write-back must have failed —
    // do NOT let the older file erase them. Keep localStorage and warn loudly.
    if(window._dsAutoRefreshing){
      const _fileStamp = saved.savedAt || null;
      const _lsStamp   = window._lsSavedAt || null;
      if(_lsStamp && (!_fileStamp || _lsStamp > _fileStamp)){
        console.warn('dsIngestTopology: local edits ('+_lsStamp+') are newer than topology file ('+(_fileStamp||'no timestamp')+') — keeping local, NOT overwriting');
        if(typeof _dsWriteBlockedBanner==='function')
          _dsWriteBlockedBanner('topology', name, 'the file on disk is OLDER than your local edits — the last save didn\'t reach it');
        // Try to heal: push local state back to the file (if permission allows).
        if(typeof dsScheduleWrite==='function') dsScheduleWrite('topology');
        return {rowCount: DB.elements?.length||0, info:'Kept newer local edits (file was stale)'};
      }
    }

    // Merge topology into database
    Object.keys(DB).forEach(table=>{
      if(saved.DB[table]!==undefined) DB[table]=saved.DB[table];
    });
    _demandCacheInvalidate(); // tables replaced — don't let the Demand page re-render from pre-load lookups
    if(saved.simCfg) Object.assign(S.simCfg,saved.simCfg);
    if(saved.counter) S.elCounter=saved.counter;
    syncElCounter();

    // Re-render all views
    if(S.view==='demand') renderDemandView();
    renderDtree(S.simResults);
    updateStatusBar();
    renderLocationTree();
    updateNavFacilities();

    // Update Real Data Input panel facility selector
    if(typeof initRealDataFacilitySelector === 'function'){
      initRealDataFacilitySelector();
    }

    // Record the just-loaded file as the merge baseline for future write-backs.
    _dsTopoBaseline = { text, savedAt: saved.savedAt||null, fileMod: window._dsCurrentFileMod||null };

    const elCount = DB.elements?.length||0;
    return {rowCount:elCount, info:`Loaded ${elCount} elements`};
  }catch(e){
    return {rowCount:0, error:e.message};
  }
}

// ── Real Production ingest ────────────────────────────
// Reads SAP production export: DATE, EQUIPMENT, MATERIAL CODE, PRODUCTION
// EQUIPMENT must match an element name (finish_mill, kiln or packing_plant).
// MATERIAL CODE is matched to DB.products via their SAP codes (exact, then plant + code, then numeric fallback).
async function dsIngestProduction(buf, name){
  await loadLib('xlsx'); // pinned version + SRI — see LIBS

  const wb = XLSX.read(buf, {type:'array', cellDates:false, raw:true});
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, {raw:false, defval:''});
  if(!raw.length) throw new Error('Production file is empty');

  const cols = Object.keys(raw[0]);
  if(!cols.includes('DATE') || !cols.includes('EQUIPMENT') || !cols.includes('MATERIAL CODE') || !cols.includes('PRODUCTION'))
    throw new Error('Unrecognised column format — expected DATE, EQUIPMENT, MATERIAL CODE, PRODUCTION');

  // Build equipment → element lookup (finish_mill + kiln + packing_plant)
  const equipMap = {};
  (DB.elements||[]).filter(e=>['finish_mill','kiln','raw_meal_mill','packing_plant'].includes(e.type))
    .forEach(e=>{ equipMap[e.name] = e.id; });

  // Build material_code → product_id lookup (exact match first)
  const matExact = {};
  const matShip = {};    // "4802|1626560" → product: a code two plants share goes to the plant that reports it
  const matNumeric = {};
  (DB.products||[]).forEach(p=>{
    _xlCodeList(p.material_code).forEach(mc=>{
      matExact[mc] = p.id;
      const k = _xlCatCode(mc);
      if(k&&k.ship) matShip[k.ship+'|'+k.sap] = p.id;
      // Numeric fallback: strip "NNNN-" facility prefix, then leading zeros
      const num = mc.replace(/^\d{4}-0*/,'').replace(/^0+/,'') || mc;
      if(!matNumeric[num]) matNumeric[num] = p.id;
    });
  });

  function normDate(v){
    if(!v && v!==0) return null;
    const s = String(v).trim();
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    // MM/DD/YYYY
    if(/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)){
      const p=s.split('/'); return `${p[2]}-${p[0].padStart(2,'0')}-${p[1].padStart(2,'0')}`;
    }
    const d=new Date(s); return isNaN(d)?null:d.toISOString().split('T')[0];
  }

  let matched=0, skipped=0, unmatchedEquip=new Set(), unmatchedMat=new Set();
  let dateMin='9999', dateMax='0000';
  // Aggregate same element+product+date into one row
  const aggMap={};

  raw.forEach(r=>{
    const vol = parseFloat(r['PRODUCTION']) || 0;
    if(vol <= 0){ skipped++; return; }
    const date = normDate(r['DATE']);
    if(!date){ skipped++; return; }

    const equip = (r['EQUIPMENT']||'').trim();
    const elId  = equipMap[equip];
    if(!elId){ unmatchedEquip.add(equip); skipped++; return; }

    const matRaw = (r['MATERIAL CODE']||'').trim();
    const matKey = _xlCatCode(matRaw);
    let prodId = matExact[matRaw] || (matKey&&matKey.ship ? matShip[matKey.ship+'|'+matKey.sap] : null);
    if(!prodId){
      const num = matRaw.replace(/^\d{4}-0*/,'').replace(/^0+/,'') || matRaw;
      prodId = matNumeric[num];
    }
    if(!prodId){ unmatchedMat.add(matRaw); skipped++; return; }

    if(date<dateMin) dateMin=date;
    if(date>dateMax) dateMax=date;
    const key=`${date}|${elId}|${prodId}`;
    if(!aggMap[key]) aggMap[key]={date,element_id:elId,element_name:equip,product_id:prodId,volume_t:0,source:'file'};
    aggMap[key].volume_t += vol;
    matched++;
  });

  // ── ZERO-FILL absent days (in-app rule) ───────────────────────────────
  // The Excel pivot omits a row when equipment didn't run that day, so those days
  // would silently fall through to the FORECAST (the sim would "keep" the plan).
  // Treat the file as authoritative for the window it covers: for every equipment
  // that reports AT LEAST ONCE, any day in [dateMin … min(dateMax, today)] with no
  // row becomes an actual 0 (a real_production_daily row with volume 0), which the
  // sim reads as "produced nothing" — reconciling the display and inventory with
  // reality. Equipment never present in the file is left untouched (can't tell
  // "not in the report" from "down all period"); days after today are never zeroed.
  const zeroRows=[]; let zeroFilled=0;
  if(matched>0){
    const today=new Date()._ymd();
    const winMax = dateMax < today ? dateMax : today; // never zero future forecast days
    if(winMax>=dateMin){
      const elName={}; const presentElDay=new Set(); const matchedEls=new Set();
      Object.values(aggMap).forEach(r=>{ elName[r.element_id]=r.element_name; presentElDay.add(r.element_id+'|'+r.date); matchedEls.add(r.element_id); });
      // SAP books all of a plant's bags to one machine (MIA reports only MIAPK01), so a packer with
      // no rows of its own at a plant whose packers report stood still; it is not "not in the report".
      const facOf=e=>e.assigned_facility_id||e.facility_id;
      const packers=(DB.elements||[]).filter(e=>e.type==='packing_plant');
      const reportingFacs=new Set(packers.filter(e=>matchedEls.has(e.id)).map(facOf));
      packers.filter(e=>!matchedEls.has(e.id)&&reportingFacs.has(facOf(e))).forEach(e=>{ elName[e.id]=e.name; matchedEls.add(e.id); });
      const days=[];
      for(let d=new Date(dateMin+'T00:00:00'); d._ymd()<=winMax; d.setDate(d.getDate()+1)) days.push(d._ymd());
      matchedEls.forEach(elId=>{
        days.forEach(ds=>{
          if(!presentElDay.has(elId+'|'+ds)){
            zeroRows.push({date:ds, element_id:elId, element_name:elName[elId], product_id:null, volume_t:0, source:'file-zero'});
            zeroFilled++;
          }
        });
      });
    }
  }

  DB.real_production_daily = Object.values(aggMap).map(r=>({...r,volume_t:Math.round(r.volume_t*10)/10})).concat(zeroRows);

  const result = {
    rowCount: raw.length, matched, skipped, zeroFilled,
    dateMin, dateMax,
    warnings: []
  };
  if(zeroFilled)
    result.warnings.push(`Zero-filled ${zeroFilled} non-producing equipment-day${zeroFilled>1?'s':''} within ${dateMin} … ${dateMax<new Date()._ymd()?dateMax:new Date()._ymd()} (days absent from the file counted as 0 production, not forecast).`);
  if(unmatchedEquip.size)
    result.warnings.push(`Equipment not matched to elements: ${[...unmatchedEquip].join(', ')}`);
  if(unmatchedMat.size)
    result.warnings.push(`Material codes not matched to products: ${[...unmatchedMat].join(', ')}`);

  // Trigger Supply view refresh so it picks up the real data immediately
  if(S.view==='supply') renderSupplyView();
  autoSave();
  return result;
}

// ── Stub handlers for future file types ───────────────
async function dsIngestTransport(buf, name){  return {rowCount:0}; }
async function dsIngestCustom(buf, name){     return {rowCount:0}; }

// ── Configure modal UI helpers ────────────────────────
function dsRefreshConfigUI(){
  DS_SLOTS.forEach(s=>{
    const el=document.getElementById('ds-slot-'+s.id);
    if(!el) return;
    el.outerHTML = dsBuildSlotHTML(s);
  });
}

function dsUpdateSlotUI(id, state, errMsg=''){
  const wrap = document.getElementById('ds-slot-'+id);
  if(!wrap) return;
  const slot = DS_SLOTS.find(s=>s.id===id);
  const meta = DS.meta[id]||{};
  let statusHtml = '';
  if(state==='loading'){
    statusHtml=`<span style="color:var(--blue);font-size:8px">↻ Refreshing…</span>`;
  } else if(state==='ok'){
    const _rowInfo = meta.matched!=null
      ? `${meta.matched.toLocaleString()} records matched`
      : `${meta.rowCount?.toLocaleString()||0} rows`;
    const _dateInfo = (meta.dateMin && meta.dateMax) ? ` · ${meta.dateMin} → ${meta.dateMax}` : '';
    const _warnInfo = meta.warnings?.length ? ` · <span style="color:var(--amber)">⚠ ${meta.warnings.length} warning(s)</span>` : '';
    statusHtml=`<span style="color:var(--green);font-size:8px">✓ ${_rowInfo}${_dateInfo} · ${meta.lastLoaded||''}</span>${_warnInfo}`;
  } else if(state==='error'){
    statusHtml=`<span style="color:var(--red);font-size:8px">✗ ${errMsg||meta.error||'Error'}</span>`;
  } else {
    statusHtml=`<span style="color:var(--text-dim);font-size:8px">Not configured</span>`;
  }
  if(state!=='empty' && _dsWritableSlots[id]){
    if(meta.writeError){
      statusHtml += `<br><span style="color:var(--red);font-size:8px">⇪ Sync error: ${meta.writeError}</span>`;
    } else if(meta._writeDenied){
      statusHtml += `<br><span style="color:var(--amber);font-size:8px">⇪ Auto-sync disabled (permission declined)</span>`;
    } else if(meta.lastWritten){
      statusHtml += `<br><span style="color:var(--blue);font-size:8px">⇪ Auto-sync · last write ${meta.lastWritten}</span>`;
    } else {
      statusHtml += `<br><span style="color:var(--text-dim);font-size:8px">⇪ Auto-sync ready</span>`;
    }
  }
  const statusEl=wrap.querySelector('.ds-status');
  if(statusEl) statusEl.innerHTML=statusHtml;
}

// Build one slot row
function dsBuildSlotHTML(slot){
  const meta    = DS.meta[slot.id]||{};
  const handle  = DS.handles[slot.id];
  const hasFile = !!handle;
  const isRefreshing = DS.refreshing[slot.id];

  let statusHtml;
  if(isRefreshing){
    statusHtml=`<span style="color:var(--blue);font-size:8px">↻ Refreshing…</span>`;
  } else if(meta.error){
    statusHtml=`<span style="color:var(--red);font-size:8px">✗ ${meta.error}</span>`;
  } else if(hasFile && meta.lastLoaded){
    statusHtml=`<span style="color:var(--green);font-size:8px">✓ ${Number(meta.rowCount||0).toLocaleString()} rows · ${meta.lastLoaded}</span>`;
  } else if(hasFile){
    statusHtml=`<span style="color:var(--amber);font-size:8px">Pending first load</span>`;
  } else {
    statusHtml=`<span style="color:var(--text-dim);font-size:8px">Not configured</span>`;
  }
  // Auto-sync indicator for writable slots
  if(hasFile && _dsWritableSlots[slot.id]){
    if(meta.writeError){
      statusHtml += `<br><span style="color:var(--red);font-size:8px">⇪ Sync error: ${meta.writeError}</span>`;
    } else if(meta._writeDenied){
      statusHtml += `<br><span style="color:var(--amber);font-size:8px">⇪ Auto-sync disabled (permission declined)</span>`;
    } else if(meta.lastWritten){
      statusHtml += `<br><span style="color:var(--blue);font-size:8px">⇪ Auto-sync · last write ${meta.lastWritten}</span>`;
    } else {
      statusHtml += `<br><span style="color:var(--text-dim);font-size:8px">⇪ Auto-sync ready</span>`;
    }
  }

  return `<div id="ds-slot-${slot.id}" style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
    <div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--text);margin-bottom:2px">${slot.label}
        ${hasFile?`<span style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-left:6px">${meta.fileName||''}</span>`:''}
      </div>
      <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-bottom:4px">${slot.description}</div>
      <div class="ds-status">${statusHtml}</div>
    </div>
    <div style="display:flex;gap:5px;flex-shrink:0">
      ${hasFile?`<button class="btn-sec" style="font-size:8px;padding:3px 9px" onclick="dsRefreshSlot('${slot.id}',true);dsRefreshConfigUI()">↻ Refresh</button>`:''}
      <button class="btn-sec" style="font-size:8px;padding:3px 9px" onclick="dsPickFile('${slot.id}')">
        ${hasFile?'Change':'Set File'}
      </button>
      ${hasFile?`<button class="btn-sec" style="font-size:8px;padding:3px 9px;color:var(--red);border-color:var(--red)" onclick="dsDisconnect('${slot.id}')">✕</button>`:''}
    </div>
  </div>`;
}

