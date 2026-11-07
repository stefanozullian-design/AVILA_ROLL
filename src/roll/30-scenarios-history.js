// ═══════════════════════════════════════════════════════════════════════
// SCENARIOS — each scenario is its own JSON file on disk (File System Access
// API). Handles persist in IndexedDB; metadata (name, colour) in localStorage.
// Replaces the old single "Topology JSON" Data Source: the active scenario IS
// the topology source of truth, and autoSave mirrors edits into its file.
// ═══════════════════════════════════════════════════════════════════════
const SC = { meta:{}, handles:{}, baselines:{}, historyDirs:{}, activeId:null, _writeTimer:null, _writeBusy:false, _writeQueued:false };
const SC_COLORS = ['#4da6ff','#ff3d5a','#ffb830','#00ff9d','#a78bfa','#f472b6','#2dd4bf','#fb923c'];
// Only truly regenerated-on-run tables are transient. Real data (production,
// shipments, etc.) BELONGS to the app once imported/entered — it is saved with
// the scenario so the app stands alone without the external files.
const SC_TRANSIENT = new Set([
  'simulation_day_states','simulation_inventory',
  'simulation_stop_events','simulation_runs','in_transit_inventory',
]);

// ── IndexedDB (file handles) ──
let _scDB=null;
function scOpenIDB(){
  return new Promise((res,rej)=>{
    if(_scDB){res(_scDB);return;}
    const req=indexedDB.open('avila_scenarios',3);
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains('handles'))     d.createObjectStore('handles');
      if(!d.objectStoreNames.contains('baselines'))   d.createObjectStore('baselines');
      if(!d.objectStoreNames.contains('historyDirs')) d.createObjectStore('historyDirs');
    };
    req.onsuccess=e=>{_scDB=e.target.result;res(_scDB);};
    req.onerror=()=>rej(req.error);
  });
}
async function scSaveHandle(id,h){ try{const db=await scOpenIDB();await new Promise((r,j)=>{const tx=db.transaction('handles','readwrite');tx.objectStore('handles').put(h,id);tx.oncomplete=r;tx.onerror=j;});}catch(e){console.warn('SC handle save',e);} }
async function scLoadHandle(id){ try{const db=await scOpenIDB();return await new Promise(r=>{const tx=db.transaction('handles','readonly');const q=tx.objectStore('handles').get(id);q.onsuccess=()=>r(q.result||null);q.onerror=()=>r(null);});}catch(e){return null;} }
async function scDeleteHandleIDB(id){ try{const db=await scOpenIDB();await new Promise(r=>{const tx=db.transaction('handles','readwrite');tx.objectStore('handles').delete(id);tx.oncomplete=r;tx.onerror=r;});}catch(e){} }
async function scSaveHistoryDirHandle(id,h){ try{const db=await scOpenIDB();await new Promise((r,j)=>{const tx=db.transaction('historyDirs','readwrite');tx.objectStore('historyDirs').put(h,id);tx.oncomplete=r;tx.onerror=j;});}catch(e){console.warn('SC history dir save',e);} }
async function scLoadHistoryDirHandle(id){ try{const db=await scOpenIDB();return await new Promise(r=>{const tx=db.transaction('historyDirs','readonly');const q=tx.objectStore('historyDirs').get(id);q.onsuccess=()=>r(q.result||null);q.onerror=()=>r(null);});}catch(e){return null;} }
async function scDeleteHistoryDirHandle(id){ try{const db=await scOpenIDB();await new Promise(r=>{const tx=db.transaction('historyDirs','readwrite');tx.objectStore('historyDirs').delete(id);tx.oncomplete=r;tx.onerror=r;});}catch(e){} }

// ── Merge baselines — the file state this browser last synced with ──
// Persisted in IndexedDB so the three-way merge survives a reload; without a
// baseline the app falls back to the old timestamp guard (binary keep/replace).
// Identity of the file version this browser last synced with (for the local-copy tag above).
function _scBaseTag(id){
  id=id||(typeof SC!=='undefined'&&SC.activeId); const b=id&&SC.baselines[id];
  return b&&b.text ? (b.fileMod+':'+b.text.length+':'+(b.savedAt||'')) : null;
}
async function scSaveBaseline(id, text, savedAt, fileMod){
  SC.baselines[id]={text, savedAt:savedAt||null, fileMod:fileMod??null};
  try{ const db=await scOpenIDB(); await new Promise((r,j)=>{const tx=db.transaction('baselines','readwrite');tx.objectStore('baselines').put(SC.baselines[id],id);tx.oncomplete=r;tx.onerror=j;}); }catch(e){ console.warn('SC baseline save',e); }
}
async function scLoadBaseline(id){
  if(SC.baselines[id]) return SC.baselines[id];
  try{ const db=await scOpenIDB(); const v=await new Promise(r=>{const tx=db.transaction('baselines','readonly');const q=tx.objectStore('baselines').get(id);q.onsuccess=()=>r(q.result||null);q.onerror=()=>r(null);}); if(v) SC.baselines[id]=v; return v; }catch(e){ return null; }
}
async function scDeleteBaseline(id){
  delete SC.baselines[id];
  try{ const db=await scOpenIDB(); await new Promise(r=>{const tx=db.transaction('baselines','readwrite');tx.objectStore('baselines').delete(id);tx.oncomplete=r;tx.onerror=r;}); }catch(e){}
}

// ── Metadata ──
function scSaveMeta(){ try{ localStorage.setItem('avila_scenarios', JSON.stringify({meta:SC.meta, activeId:SC.activeId})); }catch(e){console.warn('SC meta save',e);} }
function scLoadMeta(){ try{ const raw=localStorage.getItem('avila_scenarios'); if(raw){ const o=JSON.parse(raw); SC.meta=o.meta||{}; SC.activeId=o.activeId||null; } }catch(e){} }
function scActive(){ return SC.activeId?SC.meta[SC.activeId]:null; }
function scPickColor(){ const used=Object.values(SC.meta).map(m=>m.color); return SC_COLORS.find(c=>!used.includes(c))||SC_COLORS[Object.keys(SC.meta).length%SC_COLORS.length]; }
function scRelTime(iso){ if(!iso) return 'never saved'; const d=new Date(iso),now=new Date(),s=Math.round((now-d)/1000); if(s<60)return 'just now'; if(s<3600)return Math.round(s/60)+' min ago'; if(d.toDateString()===now.toDateString())return Math.round(s/3600)+'h ago'; const y=new Date(now-864e5); if(d.toDateString()===y.toDateString())return 'yesterday'; return d.toLocaleDateString('en',{month:'short',day:'numeric'}); }

// ── State payload (mirrors autoSave's trimming) ──
function scBuildPayload(){
  const dbOut=Object.fromEntries(Object.entries(DB).filter(([k])=>!SC_TRANSIENT.has(k)));
  // Tables the localStorage cache could not hold are OMITTED rather than written
  // as empty: memory doesn't have them, the file does. Omitting lets the merge
  // keep the file's copy (see the absent-vs-empty rule in _mgMergePayload); writing
  // an empty array instead would read as "the user deleted all these rows".
  // Normally _scHealPartial has already refilled them and this list is empty.
  const miss=window._dbPartialTables;
  if(Array.isArray(miss)) miss.forEach(t=>{ delete dbOut[t]; });
  // Keep actual demand_values too — once imported they belong to the app.
  return { DB:dbOut, counter:S.elCounter, simCfg:S.simCfg, simResults:S.simResults||null, savedAt:(window._lastSaveStamp||new Date().toISOString()), changeLog:window._scLog||_clEmpty(), topoSeal:(scIsPlanning()?undefined:(window._scTopoSeal||undefined)) };
}

// Restore tables that the localStorage cache had to drop, reading them back from
// the scenario file BEFORE we write anything to it. This is the guard that makes
// the whole data-loss class unreachable: an incomplete in-memory copy can never
// overwrite a complete file, because we always refill it from that file first.
// Returns false if the file could not be read — callers must then refuse to write.
async function _scHealPartial(handle){
  const miss=window._dbPartialTables;
  if(!Array.isArray(miss) || !miss.length) return true;
  try{
    const f=await handle.getFile();
    const text=new TextDecoder().decode(await f.arrayBuffer());
    // Nothing of this scenario in the file to heal from: it is empty, or the Avila Sales page wrote
    // its own data into it (see _scIsSalesPayload). The write that follows puts this browser's copy
    // back; the tables memory still lacks are left out of it (absent), never written as empty.
    if(!text.trim()) return true;
    const saved=JSON.parse(text);
    if(_scIsSalesPayload(saved)) return true;
    if(saved && saved.DB){
      let healed=0;
      miss.forEach(t=>{ if(saved.DB[t]!==undefined){ DB[t]=saved.DB[t]; healed++; } });
      if(healed && typeof _demandCacheInvalidate==='function') _demandCacheInvalidate();
      console.info('scenario: restored '+healed+' table(s) from file that localStorage could not cache');
    }
    window._dbPartialTables=[];
    return true;
  }catch(e){
    console.warn('scenario: could not restore partial tables from file — refusing to write', e);
    return false;
  }
}

// ── Save-status dot ──
function scSetSaveStatus(state){ SC._lastStatus=state; const d=document.getElementById('sc-dot'); if(!d) return; d.className='sc-dot'+(state==='saving'?' saving':state==='error'?' error':state==='none'?' none':''); }

// ── Write active scenario to disk ──
// Merge-aware: before writing, re-reads the file — if a teammate saved a
// different version since our last sync (shared SharePoint/OneDrive folder),
// their rows are three-way-merged with ours instead of being overwritten.
// Cloud-synced folders (OneDrive/SharePoint/Dropbox) routinely touch a file's
// on-disk state out from under an already-open handle — Chromium then refuses
// the write with "state had changed since it was read from disk"
// (InvalidStateError). That's almost always transient (the sync client settles
// within a second or two), so scWriteActive retries a couple of times before
// treating it as a real failure.
function _isStaleHandleErr(err){
  const s=((err&&err.name)||'')+' '+((err&&err.message)||'');
  return /InvalidStateError|NotReadableError|state had changed since it was read from disk/i.test(s);
}
// Returns true if the scenario's file is confirmed up to date (or there was
// nothing to write), false if the write ultimately failed — callers that are
// about to discard in-memory state (e.g. switching scenarios) MUST check this
// before proceeding, or a failed save gets silently lost.
async function scWriteActive(id, opts){
  opts=opts||{};
  id=id||SC.activeId; const m=SC.meta[id]; const handle=SC.handles[id];
  if(!m||!handle){ scSetSaveStatus('none'); return true; }
  if(SC._writeBusy){ SC._writeQueued=true; return true; }  // a sync is already running — coalesce
  SC._writeBusy=true;
  try{
    const granted=await _dsEnsureWritePermission(handle);
    if(!granted){ scSetSaveStatus('error'); _dsWriteBlockedBanner('scenario:'+id, m.fileName, 'file-edit permission was declined'); return false; }
    // Never write a partial in-memory copy over a complete file.
    if(!await _scHealPartial(handle)){
      scSetSaveStatus('error');
      _dsWriteBlockedBanner('scenario:'+id, m.fileName,
        'your local copy is missing data that only the file has, and the file could not be read to restore it — not saving, to avoid overwriting it');
      return false;
    }
    const MAX_ATTEMPTS=3;
    for(let attempt=1; attempt<=MAX_ATTEMPTS; attempt++){
      try{
        const ours=scBuildPayload();
        const prep=await _mgPrepareWrite(handle, ours, await scLoadBaseline(id));
        if(prep.mode==='none'){
          // Nothing new on either side (e.g. a simulation re-run) — the file already has it all.
          if(prep.mergeInfo) window._scLog=prep.mergeInfo.payload.changeLog;
          if(prep.fileMod!=null){ const bl=SC.baselines[id]; if(bl && bl.fileMod!==prep.fileMod) scSaveBaseline(id, bl.text, bl.savedAt, prep.fileMod); }
          scSetSaveStatus('saved'); _dsHideWriteBlockedBanner();
          if(opts.forceSnapshot) scMaybeSnapshot(id, JSON.stringify(scBuildPayload()), {forced:true});
          return true;
        }
        if(prep.mode==='pull'){
          // Teammate updated the file and we have nothing new — adopt their copy, skip the write.
          _mgApplyPayloadToApp(prep.theirs);
          scSaveBaseline(id, prep.diskText, prep.theirs.savedAt||null, prep.fileMod);
          scSetSaveStatus('saved'); _dsHideWriteBlockedBanner(); scRenderDropdown();
          if(prep.mergeInfo.remoteApplied) _mgShowMergeBanner(m.fileName, prep.mergeInfo);
          scMaybeSnapshot(id, prep.diskText, {forced:opts.forceSnapshot});
          return true;
        }
        let out=ours;
        if(prep.mode==='merge'){
          out=prep.mergeInfo.payload;
          if(prep.mergeInfo.remoteApplied>0) _mgApplyPayloadToApp(out);   // only re-render when something came in
          else window._scLog=out.changeLog;
          if(prep.mergeInfo.ownChanges) window._lastSaveStamp=out.savedAt;
        }
        // Compact JSON (no indentation): the same data, about a third smaller, so every
        // autosave builds, writes and syncs (OneDrive/SharePoint) noticeably less. Any JSON
        // reader — this app, older versions of it, scripts — reads both forms identically.
        const outText=JSON.stringify(out);
        const w=await handle.createWritable(); await w.write(new Blob([outText],{type:'application/json'})); await w.close();
        let mod=null; try{ mod=(await handle.getFile()).lastModified; }catch(e){}
        scSaveBaseline(id, outText, out.savedAt||null, mod);
        m.lastSaved=new Date().toISOString(); scSaveMeta();
        scSetSaveStatus('saved'); _dsHideWriteBlockedBanner(); scRenderDropdown();
        if(prep.mode==='merge' && (prep.mergeInfo.remoteApplied>0 || prep.mergeInfo.conflicts.length || prep.mergeInfo.healed)) _mgShowMergeBanner(m.fileName, prep.mergeInfo);
        else if(prep.foreign) _mgShowForeignBanner(m.fileName, prep.foreign, 'restored');
        scMaybeSnapshot(id, outText, {forced:opts.forceSnapshot, conflict:prep.mode==='merge'&&prep.mergeInfo.conflicts.length>0});
        return true;
      }catch(err){
        if(attempt<MAX_ATTEMPTS && _isStaleHandleErr(err)){
          await new Promise(res=>setTimeout(res, 500*attempt)); // brief backoff, let cloud-sync settle
          continue;
        }
        throw err; // exhausted retries, or a non-transient error — report it below
      }
    }
  }catch(err){
    scSetSaveStatus('error'); _dsWriteBlockedBanner('scenario:'+id, m.fileName, 'write failed — '+err.message); console.warn('SC write',err);
    return false;
  }finally{ SC._writeBusy=false; if(SC._writeQueued){ SC._writeQueued=false; scScheduleWrite(); } }
  return false;
}
function scScheduleWrite(){
  if(!scActive()||!SC.handles[SC.activeId]) return; // no active scenario → localStorage only
  scSetSaveStatus('saving');
  clearTimeout(SC._writeTimer);
  SC._writeTimer=setTimeout(()=>scWriteActive(), 500);
}
// Manual save: same routine as autosave, but flushes the file write immediately
// so the user gets instant confirmation — gives a feeling of control.
async function scManualSave(){
  autoSave();                        // refresh localStorage cache
  clearTimeout(SC._writeTimer);      // cancel the debounce; write now
  if(scActive() && SC.handles[SC.activeId]){
    const ok=await scWriteActive(SC.activeId, {forceSnapshot:true});
    statMsg(ok?('Scenario saved ✓ — '+(SC.meta[SC.activeId]?.fileName||'')):'⚠ Save failed — see the banner above for details');
  } else {
    statMsg('Saved to browser (no scenario file linked — use the scenario menu to pick one)');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// VERSION HISTORY — deliberate, timestamped snapshots of the scenario, kept
// in a folder the user picks once. Turns "a OneDrive conflict copy happened
// to save me" into an intentional, reliable rollback point: nobody's later
// edit — colleague's or your own — can ever touch a written snapshot, so
// there's always a known-good state to go back to.
//   - Every successful write to the live scenario file MAY also drop a
//     snapshot: forced on a manual Save, forced when the merge found a real
//     conflict (that's exactly the moment something might need undoing),
//     otherwise throttled to at most one per SC_HIST_THROTTLE_MS so autosave
//     doesn't spam the folder.
//   - Nothing is prompted automatically — the folder is opt-in per scenario
//     (📂 Choose folder…) so this stays silent until the user asks for it.
//   - Retention: oldest snapshots beyond SC_HIST_KEEP are pruned on write.
// ═══════════════════════════════════════════════════════════════════════
const SC_HIST_THROTTLE_MS = 20*60*1000; // autosave-driven snapshots: at most one per 20 min
const SC_HIST_KEEP = 60;                 // retention cap per scenario folder

function _scSanitize(s){ return String(s||'').replace(/[\\/:*?"<>|]/g,'').trim()||'Scenario'; }
// Snapshots are identified by the scenario's stable ID, embedded as a `__<id>__`
// token, with the display name kept in front purely so the folder is readable in
// Explorer. Keying on the NAME (as this used to) meant renaming a scenario orphaned
// its whole history — the prefix changed, so old snapshots vanished from the list and
// were never pruned — and two scenarios sharing a name and folder could restore each
// other's snapshots. The id never changes, so neither can happen.
function _scHistToken(m){ return '__'+m.id+'__'; }
function _scHistFileName(m, tag){
  const d=new Date(); const p=n=>String(n).padStart(2,'0');
  const stamp=`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const rand=Math.random().toString(16).slice(2,6); // guards against same-second collisions
  return `${_scSanitize(m.name)}${_scHistToken(m)}${stamp}_${rand}${tag?'_'+tag:''}.json`;
}
const _SC_HIST_STAMP=/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})_[0-9a-f]{4}(?:_(.+))?$/;
// Does this filename belong to scenario `m`, and if so when was it taken?
// Accepts BOTH the id-keyed form and the older name-prefixed form, so history
// written before this change stays visible without touching the files on disk.
// Legacy files are matched against the scenario's current name and any earlier
// names recorded at rename time (m.prevNames), so a rename doesn't hide them.
function _scHistParse(name, m){
  if(!name.endsWith('.json')) return null;
  const mk=(rest)=>{ const g=rest.match(_SC_HIST_STAMP); return g?{name, date:new Date(+g[1],+g[2]-1,+g[3],+g[4],+g[5],+g[6]), tag:g[7]||null}:null; };
  const tok=_scHistToken(m), i=name.indexOf(tok);
  if(i>=0) return mk(name.slice(i+tok.length, -5));
  for(const cand of [m.name, ...(m.prevNames||[])]){
    const pfx=_scSanitize(cand)+'__';
    if(name.startsWith(pfx)){ const r=mk(name.slice(pfx.length,-5)); if(r) return r; }
  }
  return null;
}

// Get (or, if `promptIfMissing`, ask the user to pick) the folder this
// scenario's snapshots live in. Returns null if unavailable/declined/lapsed —
// callers treat that as "history isn't set up for this scenario" and stay silent.
async function scEnsureHistoryDir(id, promptIfMissing){
  try{
    if(SC.historyDirs[id]) return SC.historyDirs[id];
    let h=await scLoadHistoryDirHandle(id);
    if(h){
      const ok=await _dsEnsureWritePermission(h);
      if(ok){ SC.historyDirs[id]=h; return h; }
      if(!promptIfMissing) return null;
    }
    if(!promptIfMissing) return null;
    if(!window.showDirectoryPicker){ statMsg('This browser cannot manage version history directly — use Chrome or Edge.'); return null; }
    h=await window.showDirectoryPicker({id:'avila-history-'+id, mode:'readwrite'});
    SC.historyDirs[id]=h; await scSaveHistoryDirHandle(id,h);
    return h;
  }catch(e){ return null; } // user cancelled the picker, or permission denied
}

// Write one timestamped snapshot and prune the oldest beyond the retention cap.
// `payloadText` is reused verbatim from whatever was just written to the live
// file, so the snapshot is byte-identical to that moment — not a fresh rebuild.
async function scWriteSnapshot(id, payloadText, tag){
  const dir=await scEnsureHistoryDir(id, false); if(!dir) return false; // not set up — silent no-op
  const m=SC.meta[id]; if(!m) return false;
  try{
    const fh=await dir.getFileHandle(_scHistFileName(m,tag), {create:true});
    const w=await fh.createWritable(); await w.write(new Blob([payloadText],{type:'application/json'})); await w.close();
    m.lastSnapshot=new Date().toISOString(); scSaveMeta();
    await scPruneHistory(dir, m);
    return true;
  }catch(e){ console.warn('SC snapshot write',e); return false; }
}
// Prune to SC_HIST_KEEP for THIS scenario only. Takes the meta record (not a name
// prefix) so it prunes exactly the set the history panel lists — sharing a folder
// with another scenario can no longer make one delete the other's snapshots.
async function scPruneHistory(dir, m){
  try{
    const found=[];
    for await (const [name,h] of dir.entries()){
      if(h.kind!=='file') continue;
      const p=_scHistParse(name, m); if(p) found.push(p);
    }
    found.sort((a,b)=>a.date-b.date); // oldest first
    const excess=found.length-SC_HIST_KEEP;
    if(excess>0) for(const f of found.slice(0,excess)){ try{ await dir.removeEntry(f.name); }catch(e){} }
  }catch(e){ /* permission lapsed or folder unavailable — skip pruning this round */ }
}
// Decide whether this write should also drop a snapshot (see header comment
// for the forced/throttled rules), then do it. Silently no-ops if the
// scenario has no history folder linked.
async function scMaybeSnapshot(id, payloadText, {forced, conflict}={}){
  const m=SC.meta[id]; if(!m) return;
  if(!forced && !conflict){
    const last=m.lastSnapshot?new Date(m.lastSnapshot).getTime():0;
    if(Date.now()-last < SC_HIST_THROTTLE_MS) return; // too soon — autosave snapshots are throttled
  }
  await scWriteSnapshot(id, payloadText, conflict?'conflict':(forced?'manual':null));
}
async function scRetryWrite(id){
  const handle=SC.handles[id]; if(!handle){ statMsg('No file for that scenario'); return; }
  const ok=await _dsEnsureWritePermission(handle);
  if(!ok){ statMsg('Still no write access — re-pick the file via the scenario menu'); return; }
  await scWriteActive(id);
  if(!document.getElementById('ds-write-blocked-banner')) statMsg('Scenario saved ✓');
}

// ── Re-render the whole app after loading a scenario's state ──
function scAfterLoad(){
  S.selectedEl=null;  // Keep simResults if loaded from file; they're now persistent
  _campTidyAfterLoad();
  if(DB.facilities.length) selectFacility(DB.facilities[0].id);
  updateStatusBar(); renderLocationTree(); updateNavFacilities();
  if(typeof initRealDataFacilitySelector==='function') initRealDataFacilitySelector();
  const dl=document.getElementById('sim-date-lbl'); if(dl) dl.textContent=`Day 0 / ${S.simCfg.horizon}`;
  switchTopSection(DB.facilities.length?'production':'configuration');
  scUpdatePill(); scRenderDropdown();
  _rollPublishCatalog(); _rollCheckHandoff();   // Sales page link: this scenario is now the active one
  window._scLoadedId=SC.activeId;
  if(typeof acGate==='function') acGate();      // sign-in: this scenario may require it
}

// ── Load a scenario file into the DB ──
async function scLoadScenario(id, opts){
  opts=opts||{}; const handle=SC.handles[id], m=SC.meta[id];
  if(!handle||!m){ statMsg('Scenario file not found'); return false; }
  let perm=await handle.queryPermission({mode:'read'});
  if(perm!=='granted') perm=await handle.requestPermission({mode:'read'});
  if(perm!=='granted'){ statMsg('Cannot read "'+m.name+'" — file access denied'); return false; }
  let saved, text, fileMod=null;
  try{ const f=await handle.getFile(); fileMod=f.lastModified; text=new TextDecoder().decode(await f.arrayBuffer()); saved=text.trim()?JSON.parse(text):null; }
  catch(e){ statMsg('Could not read "'+m.name+'": '+e.message); return false; }
  // Not a version of this scenario at all — emptied, or written by the Avila Sales page (see
  // _scIsSalesPayload). Checked before the repair below: nothing is ever healed from such a file.
  if(!saved || _scIsSalesPayload(saved)) return _scLoadForeign(id, m, saved?'sales':'empty', opts);
  if(!saved.DB){ statMsg('"'+m.name+'" is not a valid scenario file'); return false; }

  // Repair memory from the file FIRST, before any branch below decides who wins.
  // Tables the localStorage cache had to drop aren't "local deletions" — they were
  // never loaded. Restoring them here means the user sees complete data immediately
  // (rather than only after the next write) and that every comparison below is made
  // against a whole in-memory copy.
  {
    const miss=window._dbPartialTables;
    if(Array.isArray(miss) && miss.length){
      let healed=0;
      miss.forEach(t=>{ if(saved.DB[t]!==undefined){ DB[t]=saved.DB[t]; healed++; } });
      window._dbPartialTables=[];
      if(healed){
        if(typeof _demandCacheInvalidate==='function') _demandCacheInvalidate();
        console.info('scenario: restored '+healed+' table(s) the local cache could not hold');
      }
    }
  }

  // Startup safety net: when auto-opening the SAME scenario that's cached in
  // localStorage, don't let one copy silently erase the other. With a merge
  // baseline available we can tell WHO moved since the last sync:
  //   only this browser → keep local (file is behind);
  //   only the file     → adopt the file (a teammate saved);
  //   both              → three-way merge, then write the result back.
  // Only when the cached copy IS this scenario's: the auto-open pick can lag behind it (📂 Open
  // from file… doesn't update it), and taking another scenario's copy for this one's wrote that
  // other topology into this file. Such a copy says nothing about this file — adopt the file,
  // exactly as when switching to it. (Caches saved before the tag existed keep the old behaviour.)
  const cacheOfOther = window._lsScId!==undefined && window._lsScId!==id;
  if(opts.guard && SC.activeId===id && !cacheOfOther && !(saved.simCfg&&saved.simCfg.role==='planning')){
    const baseline=await scLoadBaseline(id);
    const base=_mgParseBaseline(baseline);
    // Reopening the scenario this browser already holds, with a record of the last sync: let the
    // change log decide row by row (see _mgSync) — our offline edits are kept, the file's newer
    // rows come in, and an out-of-date file can no longer erase what it lacks.
    if(base && base.DB){
      // Only a local copy built from THIS baseline holds real unsaved edits. One built from an
      // older sync (the file moved on while this browser was closed / pulled without re-caching)
      // would read as "I deleted / reverted everything since" — so it is not used as ours:
      // the file is taken (plus anything the change log says it is missing).
      const cacheIsFromBase = window._lsScBase && window._lsScBase===_scBaseTag(id);
      let oursNow=scBuildPayload();
      if(!cacheIsFromBase){ oursNow=Object.assign(JSON.parse(baseline.text), {changeLog:oursNow.changeLog, topoSeal:oursNow.topoSeal, simResults:oursNow.simResults}); console.info('scenario: local copy predates the last sync — using the file'); }
      const res=_mgSync(base, oursNow, saved);
      if(!cacheIsFromBase) res.remoteApplied=Math.max(1, res.remoteApplied||0);   // screen shows the old copy — replace it
      if(res.remoteApplied>0 || res.needWrite) _mgApplyPayloadToApp(res.payload);
      else window._scLog=res.payload.changeLog;
      window._dbPartialTables=[];
      m.lastOpened=new Date().toISOString(); scSaveMeta();
      if(!res.needWrite){
        // Nothing of ours missing from the file: it is (or now includes) the latest — no write.
        window._lsSavedAt=saved.savedAt||null; if(saved.savedAt) window._lastSaveStamp=saved.savedAt;
        scSaveBaseline(id, text, saved.savedAt||null, fileMod);
        scSetSaveStatus('saved'); scAfterLoad();
        if(res.remoteApplied>0 && baseline.text!==text && res.theirSaves.length) _mgShowMergeBanner(m.fileName, res);
        return true;
      }
      // Snapshot the file as it was BEFORE we write the merge, so a bad merge is recoverable.
      try{ if(typeof scMaybeSnapshot==='function') await scMaybeSnapshot(id, text, {forced:true, conflict:res.conflicts.length>0}); }catch(e){}
      const outText=JSON.stringify(res.payload); // compact — see scWriteActive
      let wrote=false;
      try{
        if(await _dsEnsureWritePermission(handle)){
          const w=await handle.createWritable(); await w.write(new Blob([outText],{type:'application/json'})); await w.close();
          wrote=true;
        }
      }catch(e){ console.warn('SC merge write',e); }
      let mod=fileMod; try{ mod=(await handle.getFile()).lastModified; }catch(e){}
      if(wrote) scSaveBaseline(id, outText, res.payload.savedAt, mod);
      window._lsSavedAt=res.payload.savedAt;
      window._lastSaveStamp=res.payload.savedAt;
      scSetSaveStatus(wrote?'saved':'error');
      if(res.remoteApplied>0 || res.conflicts.length || res.healed) _mgShowMergeBanner(m.fileName, res);
      scAfterLoad();
      return true;
    }
    // No baseline (first open in this browser, or it was cleared): the old timestamp heuristic.
    const fileStamp=saved.savedAt||null, lsStamp=window._lsSavedAt||null;
    const localChanged = !!(lsStamp && (!fileStamp || lsStamp>fileStamp));
    if(localChanged){
      console.warn('scLoadScenario: local cache ('+lsStamp+') newer than file — keeping local');
      _dsWriteBlockedBanner('scenario:'+id, m.fileName, 'the file is OLDER than your local edits — the last save did not reach it');
      m.lastOpened=new Date().toISOString(); scSaveMeta(); scScheduleWrite(); scAfterLoad();
      return true;
    }
    // Otherwise fall through: the file is the freshest copy, adopt it.
  }
  // Switching to ANOTHER scenario: a file that predates the silo tables must not inherit the
  // previous scenario's links. Re-opening the SAME scenario (startup guard) keeps them — the
  // file may just have been written by an older app version on another computer.
  const _sameScenario = !!(opts.guard && SC.activeId===id && !cacheOfOther);
  Object.keys(DB).forEach(t=>{ if(saved.DB[t]!==undefined) DB[t]=saved.DB[t]; });
  if(!_sameScenario) _slResetIfAbsent(saved.DB);
  // Reset before assigning: a flag the previous scenario carried (e.g. role:'planning') must not leak.
  Object.keys(S.simCfg).forEach(k=>{ delete S.simCfg[k]; }); Object.assign(S.simCfg, SIMCFG_DEFAULTS(), saved.simCfg||{});
  if(saved.counter) S.elCounter=saved.counter;
  syncElCounter();
  if(saved.simResults) S.simResults=saved.simResults;  // Restore forecast results
  // Change log: the file's, united with what this browser's last sync of THIS scenario knew
  // (an older app version writing the file drops the log; the baseline still has it).
  { let lg=_clNorm(saved.changeLog); if(SC.activeId===id){ try{ const bo=_mgParseBaseline(await scLoadBaseline(id)); if(bo) lg=_clUnion(lg, bo.changeLog); }catch(e){} } window._scLog=_clCompact(lg); }
  window._scTopoSeal=(SC.activeId===id?_tsNewest(window._scTopoSeal, saved.topoSeal):(saved.topoSeal||null))||null;
  if(window._scTopoSeal && !_tsSame(_tsTables(saved), window._scTopoSeal.tables)) Object.assign(DB, window._scTopoSeal.tables);   // written back on the next save
  window._dbPartialTables=[];                          // adopted the file wholesale — memory is complete
  if(typeof _demandCacheInvalidate==='function') _demandCacheInvalidate();
  SC.activeId=id; m.lastOpened=new Date().toISOString();
  window._lsSavedAt=saved.savedAt||null;
  if(saved.savedAt) window._lastSaveStamp=saved.savedAt; // adopted data keeps its own stamp (see autoSave)
  scSaveBaseline(id, text, saved.savedAt||null, fileMod);
  scSaveMeta(); scSetSaveStatus('saved'); scAfterLoad();
  return true;
}
// scLoadScenario found a file that is not a version of this scenario (kind 'sales' | 'empty').
// Reopening, at startup, the scenario whose copy this browser holds (the cache is tagged with its
// scenario — see autoSaveNow): keep that copy and write it back over the file. Anything else —
// another scenario, a copy that may belong to one, nothing cached — refuses: nothing is loaded
// and nothing on screen changes (🕒 History can then restore the file).
async function _scLoadForeign(id, m, kind, opts){
  const ownCopy = !!(opts && opts.guard && SC.activeId===id && window._lsScId===id && window._lsSavedAt && (DB.facilities||[]).length);
  if(!ownCopy){ _mgShowForeignBanner(m.fileName, kind, 'refused'); return false; }
  m.lastOpened=new Date().toISOString(); scSaveMeta();
  _mgShowForeignBanner(m.fileName, kind, 'restoring');
  scScheduleWrite();   // → scWriteActive → _mgPrepareWrite finds the same file → plain write of this copy
  scAfterLoad();
  return true;
}

// ── Background watch for teammate edits to the ACTIVE scenario file ──
// Every 30 seconds (and whenever the tab regains focus), stat the file; if a
// teammate wrote a different version, run the merge-aware save — with no local
// edits it simply pulls their changes into the app (no write), with local
// edits it writes the three-way merge.
let _scWatchTimer=null;
const SC_WATCH_INTERVAL_MS=30*1000;   // teammates' saves show up within ~30 s (+ OneDrive's own sync time)
function scStartRemoteWatch(){
  if(_scWatchTimer) return; // idempotent
  _scWatchTimer=setInterval(scCheckRemoteChange, SC_WATCH_INTERVAL_MS);
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) scCheckRemoteChange(); });
  window._scWatchArmed=true; // observable from console for debugging
}
async function scCheckRemoteChange(){
  const id=SC.activeId; if(!id || SC._writeBusy) return;
  if(scIsPlanning()) return;   // Planning scenario: single editor, no file watcher
  const handle=SC.handles[id]; if(!handle) return;
  const baseline=await scLoadBaseline(id); if(!baseline) return;
  try{
    // Silent poll — never surface a permission prompt out of nowhere.
    const perm=await handle.queryPermission({mode:'read'}); if(perm!=='granted') return;
    const f=await handle.getFile();
    if(baseline.fileMod!=null && f.lastModified===baseline.fileMod) return;
    const text=new TextDecoder().decode(await f.arrayBuffer());
    if(text===baseline.text){ scSaveBaseline(id, baseline.text, baseline.savedAt, f.lastModified); return; }
    await scWriteActive(id); // merge-aware: pulls their changes; writes only if we also have some
  }catch(e){ /* transient (file syncing, locked) — next tick retries */ }
}

// ── Create / duplicate / open / switch / rename / delete ──
// ── Scenario ↔ file identity ────────────────────────────────────────────────
// One scenario owns exactly one .json, and the scenario's NAME is always the
// file's basename. Deriving the name from the handle (rather than from what the
// user typed) is the only way the invariant survives, because the OS save dialog
// lets them type a filename that differs from the name they asked for.
function scNameFromHandle(handle){ return String(handle.name||'').replace(/\.json$/i,'').trim()||'Scenario'; }

// Which scenario (if any) already owns `handle`. isSameEntry is the authoritative
// check; it only sees SC.handles, so entries whose handle failed to rehydrate from
// IndexedDB fall back to a basename comparison — weaker (a basename carries no
// path) but better than silently allowing a second owner.
async function scFindOwner(handle, exceptId){
  for(const k of Object.keys(SC.meta)){
    if(k===exceptId) continue;
    const h=SC.handles[k];
    if(h){ try{ if(await h.isSameEntry?.(handle)) return {id:k, certain:true}; }catch(e){} }
    else if(SC.meta[k].fileName && SC.meta[k].fileName===handle.name) return {id:k, certain:false};
  }
  return null;
}
// A different scenario already using this name. Since name ≡ filename, this means
// two same-named files in different folders — indistinguishable in the pill, the
// dropdown and the startup cards, which all show the basename only.
function scFindNameClash(name, exceptId){
  const n=String(name||'').toLowerCase();
  return Object.keys(SC.meta).find(k=>k!==exceptId && String(SC.meta[k].name||'').toLowerCase()===n)||null;
}

// Shared gate for every path that binds a scenario to a newly-picked file.
// Returns true when `handle` may be used; otherwise explains why and returns false.
async function scCheckFileFree(handle, exceptId){
  const owner=await scFindOwner(handle, exceptId);
  if(owner){
    const om=SC.meta[owner.id];
    alert(`That file is already used by the scenario "${om.name}".\n\n`+
      (owner.certain?'':'(Matched on filename — its file handle isn\'t loaded in this browser.)\n\n')+
      `Each scenario must have its own .json, or saving one would overwrite the other.\n\nPick a different file or name.`);
    return false;
  }
  const clash=scFindNameClash(scNameFromHandle(handle), exceptId);
  if(clash){
    alert(`A scenario named "${SC.meta[clash].name}" already exists.\n\n`+
      `Scenario names come from the filename, so two files with the same name can't be told apart.\n\nChoose a different filename.`);
    return false;
  }
  return true;
}

// Open a save dialog, distinguishing "user cancelled" from a real failure.
// The file picker needs TRANSIENT USER ACTIVATION, which expires a few seconds
// after the click that started the action — so it must not sit behind a blocking
// prompt()/confirm() while the user types. Swallowing every error here (as this
// used to) turned an expired activation into a silent no-op: creating a scenario
// appeared to do nothing if you paused to type a name.
async function scPickSaveFile(suggestedName){
  const safe=String(suggestedName||'Scenario').replace(/[\\/:*?"<>|]/g,'').trim()||'Scenario';
  try{
    return await window.showSaveFilePicker({
      suggestedName: safe+'.json',
      types:[{description:'AVILA scenario',accept:{'application/json':['.json']}}]
    });
  }catch(e){
    const n=(e&&e.name)||'';
    if(n==='AbortError') return null;                       // user closed the dialog — fine
    if(n==='SecurityError'||n==='NotAllowedError'){
      statMsg('⚠ The save dialog needs a fresh click — press ＋ New again and name the file in the dialog itself.');
    }else{
      statMsg('⚠ Could not open the save dialog — '+(e&&e.message||n||'unknown error'));
    }
    console.warn('scenario save picker failed', e);
    return null;
  }
}

async function scCreateFromCurrent(suggestedName){
  if(!window.showSaveFilePicker){ statMsg('This browser cannot save files directly — use ↓ Export JSON. (Chrome/Edge required.)'); return; }
  const handle=await scPickSaveFile(suggestedName);
  if(!handle) return;
  // Refuse to bind a file another scenario already owns. Without this, picking an
  // existing scenario's file here registered a SECOND meta entry against it and the
  // scWriteActive below immediately overwrote that scenario's data.
  if(!await scCheckFileFree(handle, null)) return;
  const id='sc_'+Date.now().toString(36);
  const name=scNameFromHandle(handle);   // name ≡ filename, whatever was typed in the dialog
  SC.meta[id]={ id, name, color:scPickColor(), fileName:handle.name, lastSaved:null, lastOpened:new Date().toISOString() };
  SC.handles[id]=handle; await scSaveHandle(id,handle);
  SC.activeId=id; scSaveMeta();
  await scWriteActive(id); // write current in-memory state into the new file now
  scCloseDropdown(); scCloseStartup(); scUpdatePill(); scRenderDropdown();
  statMsg('Scenario "'+name+'" created');
}
// No name prompt: the scenario's name IS its filename now, so the save dialog is
// where you name it. The old prompt asked for a name that was then discarded in
// favour of the filename — and, being a blocking modal, it consumed the user
// activation the file picker needs, so typing into it made the picker fail silently.
async function scNew(){ await scCreateFromCurrent('New scenario'); }
async function scDuplicate(){ const m=scActive(); if(!m){ statMsg('No active scenario to duplicate'); return; } await scCreateFromCurrent(m.name+' copy'); }
async function scOpenFile(){
  if(!window.showOpenFilePicker){ statMsg('This browser cannot open files directly — use ↑ Import JSON. (Chrome/Edge required.)'); return; }
  let handle;
  try{ [handle]=await window.showOpenFilePicker({types:[{description:'AVILA scenario',accept:{'application/json':['.json']}}]}); }
  catch(e){
    // Same reasoning as scPickSaveFile: only AbortError means "user cancelled";
    // anything else must be reported rather than silently doing nothing.
    const n=(e&&e.name)||'';
    if(n!=='AbortError'){ console.warn('scenario open picker failed', e); statMsg('⚠ Could not open the file dialog — '+(e&&e.message||n||'unknown error')); }
    return;
  }
  await scOpenHandle(handle);
}
// Register (or re-use) a scenario for a file handle and load it. Used by 📂 File… and by the
// welcome screen's folder search. Returns true when the scenario loaded.
async function scOpenHandle(handle){
  // An Avila Sales file is never a scenario (see _scIsSalesPayload) — not registered, not opened.
  if(await _scLooksLikeSalesFile(handle)){ scCloseDropdown(); _mgShowForeignBanner(handle.name, 'sales', 'salesfile'); return false; }
  // Reuse an existing entry if it points at the same file, else register new.
  const owner=await scFindOwner(handle, null);
  let id=owner?owner.id:null;
  if(id){
    // Opening a file we already track: refresh the name in case it was renamed on
    // disk outside the app — the file is the source of truth for identity.
    SC.meta[id].name=scNameFromHandle(handle);
    SC.meta[id].fileName=handle.name;
    if(!SC.handles[id]){ SC.handles[id]=handle; await scSaveHandle(id,handle); } // re-bind a lost handle
  } else {
    id='sc_'+Date.now().toString(36);
    SC.meta[id]={ id, name:scNameFromHandle(handle), color:scPickColor(), fileName:handle.name, lastSaved:null, lastOpened:new Date().toISOString() };
    SC.handles[id]=handle; await scSaveHandle(id,handle);
  }
  scSaveMeta();
  const ok=await scLoadScenario(id);
  if(ok){ try{ localStorage.setItem('avila_sc_autoopen', id); }catch(e){} }
  scCloseDropdown(); scCloseStartup(); scUpdatePill(); scRenderDropdown();
  return !!ok;
}
// Rename = Save As. The scenario's name IS its filename, so renaming has to produce
// a newly-named file; there is no rename-in-place in the File System Access API that
// works reliably across the folders these files live in. The old .json is left on
// disk untouched — stated up front so it isn't a surprise.
async function scRename(id){
  const m=SC.meta[id]; if(!m) return;
  if(!window.showSaveFilePicker){ statMsg('This browser cannot save files directly — renaming needs Chrome/Edge.'); return; }
  // Straight to the save dialog — type the new name there. No prompt() first: it
  // would eat the user activation the picker needs (see scPickSaveFile), and the
  // name is taken from the file anyway. The dialog opens on the current name.
  const handle=await scPickSaveFile(m.name);
  if(!handle) return;
  if(handle.name===m.fileName){ statMsg('Same file — nothing renamed'); return; }
  if(!await scCheckFileFree(handle, id)) return;
  const wasActive=(SC.activeId===id);
  const oldFile=m.fileName, oldName=m.name;
  SC.handles[id]=handle; await scSaveHandle(id,handle);
  m.fileName=handle.name;
  // Remember the old name so snapshots written under the pre-id naming scheme
  // (which used the scenario name as their filename prefix) stay listed.
  m.prevNames=[...new Set([...(m.prevNames||[]), oldName])].slice(-10);
  m.name=scNameFromHandle(handle);   // name follows the file, not the prompt
  await scDeleteBaseline(id);        // the new file has no shared history with the old one
  scSaveMeta();
  if(wasActive) await scWriteActive(id, {forceSnapshot:true});
  scUpdatePill(); scRenderDropdown();
  statMsg('Renamed to "'+m.name+'" → '+m.fileName+' (previous file '+oldFile+' left on disk)');
}
async function scDelete(id){
  const m=SC.meta[id]; if(!m) return;
  if(!confirm('Remove scenario "'+m.name+'" from the list?\n\nThe .json file on disk is NOT deleted — you can re-open it later.')) return;
  delete SC.meta[id]; delete SC.handles[id]; await scDeleteHandleIDB(id); await scDeleteBaseline(id);
  // Also release the version-history folder handle, or it sits orphaned in
  // IndexedDB forever (the snapshot FILES on disk are intentionally kept).
  delete SC.historyDirs[id]; await scDeleteHistoryDirHandle(id);
  if(localStorage.getItem('avila_sc_autoopen')===id) localStorage.removeItem('avila_sc_autoopen');
  const wasActive=(SC.activeId===id); if(wasActive) SC.activeId=null;
  scSaveMeta(); scUpdatePill(); scRenderDropdown();
  if(wasActive){ const rest=Object.keys(SC.meta); if(rest.length) await scLoadScenario(rest[0]); else scOpenStartup(true); }
}
// opts.force — load the file even when `id` is already SC.activeId. The startup
// picker MUST pass this: scInit restores SC.activeId from localStorage before the
// picker is shown, so without it, choosing the last-used scenario hit the
// early-return below and the .json was never read. The app then kept running on
// whatever loadSaved() had restored — and if that cache was compact (missing
// element_product_capacities & co.) the first later edit wrote the truncated state
// straight over the good file. The plain dropdown switcher still no-ops, since
// re-picking the scenario you are already in should do nothing.
async function scSwitch(id, opts){
  const reopen = (id===SC.activeId);
  if(reopen && !(opts&&opts.force)){ scCloseDropdown(); return; }
  clearTimeout(SC._writeTimer);
  // Only flush when actually LEAVING a scenario for a different one. On a forced
  // reopen there is nothing to preserve by writing, and pushing first would be
  // actively harmful: this path exists precisely for the case where memory is an
  // incomplete cache, so writing it out would destroy the file we came to read.
  if(!reopen && scActive() && SC.handles[SC.activeId]){
    const flushed=await scWriteActive(); // flush current — MUST confirm before discarding it below
    if(!flushed){
      const proceed=confirm(`"${scActive().name}" has changes that failed to save to its file (see the red banner for why).\n\nSwitching scenarios now will DISCARD those unsaved changes from this browser.\n\nOK = switch anyway and lose them.\nCancel = stay here and retry saving first.`);
      if(!proceed) return;
    }
  }
  scCloseDropdown(); scCloseStartup();
  // Remember this scenario for next load — only once it actually loaded: startup takes the cached
  // copy for the auto-opened scenario's, so it must not point at one that was refused.
  if(await scLoadScenario(id, reopen?{guard:true}:undefined)) localStorage.setItem('avila_sc_autoopen',id);
}

// ── Top-bar pill + dropdown ──
function scUpdatePill(){
  const nm=document.getElementById('sc-name'); const m=scActive();
  if(nm) nm.textContent = m ? m.name : 'No scenario';
  if(!m) scSetSaveStatus('none');
  const sw=document.getElementById('sc-switcher');
  if(sw) sw.title = m ? ('Scenario: '+m.name+' ('+(m.fileName||'')+')') : 'No scenario — click to create or open one';
  const pl=scIsPlanning(); const rb=document.getElementById('sc-role-badge'); if(rb) rb.style.display=pl?'':'none';
  if(sw) sw.classList.toggle('planning', pl);
}
function scToggleDropdown(ev){ if(ev) ev.stopPropagation(); const dd=document.getElementById('sc-dropdown'); if(!dd) return; if(dd.style.display==='none'){ scRenderDropdown(); dd.style.display='block'; } else dd.style.display='none'; }
function scCloseDropdown(){ const dd=document.getElementById('sc-dropdown'); if(dd) dd.style.display='none'; document.querySelectorAll('.sc-rowmenu').forEach(e=>e.remove()); }
function scRenderDropdown(){
  const dd=document.getElementById('sc-dropdown'); if(!dd) return;
  const ids=Object.keys(SC.meta);
  let h=`<div class="sc-dd-hdr"><span>Scenarios</span><span>${ids.length} saved</span></div>`;
  if(!ids.length){ h+=`<div style="padding:14px 12px;color:var(--text-dim);font-size:10px;text-align:center">No scenarios yet.</div>`; }
  ids.sort((a,b)=>(SC.meta[b].lastOpened||'').localeCompare(SC.meta[a].lastOpened||''));
  ids.forEach(id=>{
    const m=SC.meta[id]; const act=id===SC.activeId;
    h+=`<div class="sc-row${act?' active':''}" onclick="scSwitch('${id}')">
      <span class="sc-sw" style="background:${m.color}"></span>
      <div class="sc-meta"><div class="sc-t">${_scEsc(m.name)}</div><div class="sc-s">${act?'saved '+scRelTime(m.lastSaved):'opened '+scRelTime(m.lastOpened)} · ${_scEsc(m.fileName||'')}</div></div>
      ${act?'<span style="color:var(--green);font-size:14px">✓</span>':`<span class="sc-act" onclick="event.stopPropagation();scRowMenu(event,'${id}')">⋯</span>`}
    </div>`;
  });
  h+=`<div class="sc-dd-foot">
    <div class="sc-item" onclick="scNew()" title="Captures the current model into a new .json — you name it in the save dialog"><span style="color:var(--green)">＋</span> New scenario…</div>
    <div class="sc-item" onclick="scDuplicate()">⧉ Duplicate current</div>
    <div class="sc-item" onclick="scOpenFile()">📂 Open from file…</div>
  </div>`;
  dd.innerHTML=h;
}
function scRowMenu(ev,id){
  ev.stopPropagation(); document.querySelectorAll('.sc-rowmenu').forEach(e=>e.remove());
  const menu=document.createElement('div'); menu.className='sc-rowmenu';
  menu.innerHTML=`<div onclick="scRename('${id}');this.parentNode.remove()" title="Saves the scenario to a new .json under the new name; the current file is left on disk">✎ Rename (save as…)</div>
    <div onclick="(scSwitch('${id}').then(()=>scDuplicate()));this.parentNode.remove()">⧉ Duplicate</div>
    <div onclick="(scSwitch('${id}').then(()=>scOpenHistoryPanel()));this.parentNode.remove()">🕒 Version History</div>
    <div style="color:var(--red);border-top:1px solid var(--border2)" onclick="scDelete('${id}');this.parentNode.remove()">🗑 Delete</div>`;
  document.body.appendChild(menu);
  const r=ev.target.getBoundingClientRect();
  menu.style.top=(r.bottom+4)+'px'; menu.style.left=Math.max(8,r.right-150)+'px';
  setTimeout(()=>document.addEventListener('click',function _c(){ menu.remove(); document.removeEventListener('click',_c); },{once:true}),0);
}
function _scEsc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

