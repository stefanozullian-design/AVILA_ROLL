// ═══════════════════════════════════════════════════════════════════════
// SHARED-FILE MERGE ENGINE — three-way merge for scenario / topology JSON
// files that several people edit through a shared drive (SharePoint /
// OneDrive / network folder). Instead of blindly overwriting the file with
// this browser's copy (last-writer-wins, silently destroying everyone
// else's edits), every write first re-reads the file: if someone else
// wrote since we last synced, their changes are merged in row-by-row.
//   base   = the file as this browser last read/wrote it (the baseline)
//   ours   = this browser's current in-memory state
//   theirs = the file as it is on disk right now
// Per row (keyed by id / composite key): only-one-side-changed → that side
// wins; both changed → OURS wins and the row is reported as a conflict.
// ═══════════════════════════════════════════════════════════════════════

// Baseline for the legacy Data-Source "topology" slot (the scenario system
// keeps per-scenario baselines in SC.baselines / IndexedDB instead).
let _dsTopoBaseline = null; // { text, savedAt, fileMod }

// Composite row keys for tables whose rows have no single `id`. Everything
// else falls back to `id`, then to the full row JSON (identity keying —
// such rows merge as pure add/remove sets and can never conflict).
const _MG_KEYS = {
  demand_values:         r=>['dv', r.element_id, r.date, r.source, r.ship_to??''].join('|'),
  plan_demand:           r=>['pd', r.version_id, r.element_id, r.ym].join('|'),
  plan_yields:           r=>['py', r.element_id, r.product_id].join('|'),
  real_shipments_daily:  r=>['rs', r.date, r.origin, r.product, r.customer_type, r.ship_to??''].join('|'),
  real_production_daily: r=>['rp', r.date, r.facility_id, r.element_id, r.product_id].join('|'),
  real_inventory_daily:  r=>['ri', r.date, r.facility_id, r.silo_id, r.product_id].join('|'),
  real_transfers_file_daily: r=>['rtf', r.date, r.roll_name||(r.origin+'/'+r.product_name)].join('|'),
  real_transfers_daily:  r=>['rt', r.date, r.origin_facility_id, r.dest_facility_id, r.mode, r.product_id].join('|'),
  real_silo_transfers_daily: r=>['rst', r.date, r.link_id, r.from_silo_id, r.to_silo_id].join('|'),
  real_rail_daily:       r=>['rr', r.date, r.facility_id, r.product_id, r.type, r.dispatch_id??'', r.dest_facility_id??''].join('|'),
  real_shipping_daily:   r=>['rsh', r.date, r.facility_id, r.product_id].join('|'),
  real_unloading_daily:  r=>['ru', r.date, r.facility_id, r.berth_id, r.product_id, r.mode].join('|'),
};
function _mgStr(x){ return JSON.stringify(x===undefined?null:x); }
function _mgRowKey(table, row){
  const fn=_MG_KEYS[table];
  if(fn){ try{ return fn(row); }catch(e){} }
  return (row && row.id!=null) ? ('id|'+row.id) : ('row|'+_mgStr(row));
}
function _mgRowLabel(table, row, key){
  const n = row && (row.name || row.element_name || row.reference || row.date);
  return table.replace(/_/g,' ') + (n ? ': '+n : ': '+String(key).slice(0,40));
}

// Pick one of three versions of a value. side: same | ours | theirs | ours-conflict.
function _mgPick3(b, o, t){
  const so=_mgStr(o), st=_mgStr(t);
  if(so===st) return {value:o, side:'same'};
  const sb=_mgStr(b);
  if(so===sb) return {value:t, side:'theirs'};   // only they changed it
  if(st===sb) return {value:o, side:'ours'};     // only we changed it
  return {value:o, side:'ours-conflict'};        // both changed — ours wins
}

// ═══════════════════════════════════════════════════════════════════════
// CHANGE LOG — every save records WHAT this browser changed since it last synced
// with the file (row by row: table + row key + a fingerprint of the row before
// and after), WHO saved it and WHEN. The log travels inside the scenario file
// (payload.changeLog) and is united whenever two copies meet.
// Why: without it, the merge had to GUESS from a row's absence that someone
// deleted it — and an out-of-date copy (a tab left open since the morning, a
// computer whose OneDrive was behind) lacks everything added since, so it read
// as a mass deletion (9/28: demand points vanished twice). With the log:
//   • a row disappears only if a save RECORDED its deletion;
//   • a value an old copy brings back is recognised as superseded (the log saw
//     it replaced) and the newer value is kept;
//   • a deliberate restore is simply a new change, logged with a new time.
// Op tuple: [table + '\u0001' + rowKey, beforeHash, afterHash, timeMs, deviceId]
//   hash '' = row absent (so an add is ''→h, a delete is h→'').
// ═══════════════════════════════════════════════════════════════════════
const CL_MAX_OPS=15000, CL_KEEP_PER_KEY=4, CL_MAX_AGE_MS=60*864e5, CL_MAX_SAVES=500;
const CL_CFG='_settings';   // pseudo-table for simCfg fields
function _clHash(s){ if(s==null) return ''; let h=0x811c9dc5; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193); } return (h>>>0).toString(16).padStart(8,'0'); }
function _clEmpty(){ return {v:1, ops:[], saves:[]}; }
function _clNorm(l){ return (l && Array.isArray(l.ops)) ? {v:1, ops:l.ops, saves:Array.isArray(l.saves)?l.saves:[]} : _clEmpty(); }
// Who is saving: a stable id per browser + an optional name the user gives it in 🕒 History.
// (When sign-in exists this becomes the signed-in user.)
function _clDevice(){
  let id=null, name='';
  try{ id=localStorage.getItem('avila_device_id'); if(!id){ id=Math.random().toString(36).slice(2,8); localStorage.setItem('avila_device_id', id); } name=localStorage.getItem('avila_device_name')||''; }catch(e){ id=id||'anon'; }
  if(typeof _acUser!=='undefined' && _acUser) return {id, name:(_acUser.name||_acUser.email)+(name?' ('+name+')':''), email:_acUser.email};
  return {id, name};
}
function _clWho(dev, name){ return name || ('Browser '+dev); }
function _clUnion(a, b){
  a=_clNorm(a); b=_clNorm(b);
  if(!b.ops.length && !b.saves.length) return a;
  if(!a.ops.length && !a.saves.length) return b;
  const seen=new Set(), ops=[];
  for(const op of a.ops.concat(b.ops)){ const s=op.join('\u0002'); if(!seen.has(s)){ seen.add(s); ops.push(op); } }
  ops.sort((x,y)=>x[3]-y[3]);
  const sv=new Map(); for(const s of a.saves.concat(b.saves)) if(s&&s.id) sv.set(s.id, s);
  const saves=[...sv.values()].sort((x,y)=>(x.at||'').localeCompare(y.at||''));
  return {v:1, ops, saves};
}
// Keep the log small: last CL_KEEP_PER_KEY ops per row, nothing older than CL_MAX_AGE_MS,
// at most CL_MAX_OPS in all (oldest dropped first). Dropped history only means an
// ancient value can no longer be recognised as superseded — the merge then falls back
// to "present beats absent", which still never deletes.
function _clCompact(log){
  log=_clNorm(log);
  const cutoff=Date.now()-CL_MAX_AGE_MS, perKey=new Map(), keep=[];
  for(let i=log.ops.length-1;i>=0;i--){
    const op=log.ops[i]; if(op[3]<cutoff) continue;
    const n=perKey.get(op[0])||0; if(n>=CL_KEEP_PER_KEY) continue;
    perKey.set(op[0], n+1); keep.push(op);
    if(keep.length>=CL_MAX_OPS) break;
  }
  keep.reverse();
  return {v:1, ops:keep, saves:log.saves.slice(-CL_MAX_SAVES)};
}
// fullKey → { latest: afterHash of the newest op, t: its time }
function _clIndex(log){
  const idx=new Map();
  for(const op of _clNorm(log).ops){ const e=idx.get(op[0]); if(!e || op[3]>=e.t) idx.set(op[0], {latest:op[2], t:op[3]}); }
  return idx;
}
function _clLabel(table, row, key){
  if(table===CL_CFG) return 'setting '+String(key).replace(/^f\|/,'');
  if(row && row.name) return row.name;
  if(table==='connections' && row) return (row.from||'?')+' → '+(row.to||'?');
  return String(key).replace(/^id\|/,'');
}
function _clCfgRows(cfg){ const m=new Map(); if(cfg && typeof cfg==='object') for(const k of Object.keys(cfg)) m.set('f|'+k, cfg[k]); return m; }
// What did THIS browser change since it last synced (base → ours)? Returns the ops plus a
// readable summary for the Change log. Tables absent from ours were never loaded — skipped.
function _clDiff(base, ours){
  const ops=[], counts={}, labels=[], now=Date.now(), dev=_clDevice();
  const bump=(t,i)=>{ (counts[t]=counts[t]||[0,0,0])[i]++; };
  const note=(t,kind,row,key)=>{ if(labels.length<14 && (t==='elements'||t==='connections'||t==='facilities'||t==='products'||t===CL_CFG)) labels.push(kind+' '+_clLabel(t,row,key)); };
  const bDB=(base&&base.DB)||{}, oDB=(ours&&ours.DB)||{};
  for(const t of Object.keys(oDB)){
    const oa=oDB[t]; if(!Array.isArray(oa)) continue;
    const ba=Array.isArray(bDB[t])?bDB[t]:[];
    const bm=new Map(); for(const r of ba) bm.set(_mgRowKey(t,r), r);
    const om=new Map(); for(const r of oa) om.set(_mgRowKey(t,r), r);
    for(const [k,o] of om){
      const so=_mgStr(o);
      if(!bm.has(k)){ ops.push([t+'\u0001'+k, '', _clHash(so), now, dev.id]); bump(t,0); note(t,'+',o,k); continue; }
      const sb=_mgStr(bm.get(k));
      if(sb!==so){ ops.push([t+'\u0001'+k, _clHash(sb), _clHash(so), now, dev.id]); bump(t,1); note(t,'~',o,k); }
    }
    for(const [k,b] of bm) if(!om.has(k)){ ops.push([t+'\u0001'+k, _clHash(_mgStr(b)), '', now, dev.id]); bump(t,2); note(t,'−',b,k); }
  }
  const bc=_clCfgRows(base&&base.simCfg), oc=_clCfgRows(ours&&ours.simCfg);
  for(const [k,v] of oc){ const so=_mgStr(v), sb=bc.has(k)?_mgStr(bc.get(k)):null; if(sb!==so){ ops.push([CL_CFG+'\u0001'+k, _clHash(sb), _clHash(so), now, dev.id]); bump(CL_CFG,1); note(CL_CFG,'~',null,k); } }
  for(const [k,v] of bc) if(!oc.has(k)){ ops.push([CL_CFG+'\u0001'+k, _clHash(_mgStr(v)), '', now, dev.id]); bump(CL_CFG,2); }
  return {ops, counts, labels, dev};
}
// Append this browser's changes to the log (skipping ops identical to the row's last one —
// a retried write re-diffs against the same baseline) plus one readable save entry.
function _clAppend(log, diff){
  log=_clNorm(log); if(!diff.ops.length) return log;
  const last=new Map(); for(const op of log.ops) last.set(op[0], op);
  const ops=log.ops.slice();
  for(const op of diff.ops){ const l=last.get(op[0]); if(l && l[1]===op[1] && l[2]===op[2]) continue; ops.push(op); }
  const saves=log.saves.slice();
  saves.push({id:Math.random().toString(36).slice(2,10), at:new Date().toISOString(), dev:diff.dev.id, name:diff.dev.name||'', by:diff.dev.email||null, n:diff.counts, lbl:diff.labels});
  return {v:1, ops, saves};
}

// Decide one row (or one setting): o/t/b are the row on our side / on disk / in the baseline
// (undefined = absent). idx = change-log index. Returns {value, side, conflict?, healed?}.
function _mgPickLogged(fk, b, o, t, idx){
  const so=o===undefined?null:_mgStr(o), st=t===undefined?null:_mgStr(t);
  if(so===st) return {value:o, side:'same'};
  const sb=b===undefined?null:_mgStr(b);
  const e=idx && idx.get(fk);
  if(e){
    const ho=_clHash(so), ht=_clHash(st);
    // theirs is an older value; "healed" only when the disk MOVED to it (not our own fresh edit)
    if(ho===e.latest && ht!==e.latest) return {value:o, side:'ours', healed:st!==sb};
    if(ht===e.latest && ho!==e.latest) return {value:t, side:'theirs'};              // the log says theirs is newest
  }
  if(sb===so){ if(st===null) return {value:o, side:'ours', healed:true};             // missing there, no recorded delete → keep
               return {value:t, side:'theirs'}; }                                    // they edited it
  if(sb===st){ if(so===null) return {value:t, side:'theirs'};                        // (our deletes are always logged)
               return {value:o, side:'ours'}; }                                      // we edited it
  if(so===null) return {value:t, side:'theirs', conflict:'local-deleted'};
  if(st===null) return {value:o, side:'ours', conflict:'remote-deleted'};
  return {value:o, side:'ours', conflict:'both'};                                    // both edited — ours wins
}

// Merge of one table (array of rows), row by row — see _mgPickLogged. A row is never dropped
// because the other copy merely lacks it: only a recorded deletion removes it.
function _mgMergeTable(table, baseArr, oursArr, theirsArr, idx){
  const bm=new Map(), om=new Map(), tm=new Map();
  for(const r of baseArr)   bm.set(_mgRowKey(table,r), r);
  for(const r of oursArr)   om.set(_mgRowKey(table,r), r);
  for(const r of theirsArr) tm.set(_mgRowKey(table,r), r);
  const rows=[], conflicts=[]; let remoteApplied=0, localApplied=0, healed=0;
  const take=(k,p)=>{
    if(p.value!==undefined) rows.push(p.value);
    if(p.side==='ours'){ localApplied++; if(p.healed) healed++; }
    else if(p.side==='theirs') remoteApplied++;
    if(p.conflict){ const r=p.value!==undefined?p.value:(om.get(k)||tm.get(k)); conflicts.push({table, key:k, label:_mgRowLabel(table,r,k), kind:p.conflict}); }
  };
  for(const [k,o] of om) take(k, _mgPickLogged(table+'\u0001'+k, bm.get(k), o, tm.get(k), idx));
  for(const [k,t] of tm) if(!om.has(k)) take(k, _mgPickLogged(table+'\u0001'+k, bm.get(k), undefined, t, idx));
  return {rows, conflicts, remoteApplied, localApplied, healed};
}

// Field-level merge for small flat objects (simCfg), same rules as rows.
function _mgMergeFlat(b, o, t, idx){
  const out={}; let localApplied=0, remoteApplied=0;
  for(const k of new Set([...Object.keys(o), ...Object.keys(t)])){
    const p=_mgPickLogged(CL_CFG+'\u0001f|'+k, b?b[k]:undefined, o[k], t[k], idx);
    if(p.value!==undefined) out[k]=p.value;
    if(p.side==='ours') localApplied++;
    else if(p.side==='theirs') remoteApplied++;
  }
  return {value:out, localApplied, remoteApplied};
}

// Merge whole payloads ({DB, counter, simCfg, simResults?, savedAt}).
function _mgMergePayload(base, ours, theirs, opts){
  opts=opts||{};
  const conflicts=[]; let remoteApplied=0, localApplied=0, healed=0;
  const mergedDB={};
  const tables=new Set([...Object.keys(ours.DB||{}), ...Object.keys(theirs.DB||{})]);
  for(const t of tables){
    const o=ours.DB?ours.DB[t]:undefined, th=theirs.DB?theirs.DB[t]:undefined, b=base.DB?base.DB[t]:undefined;
    // A table entirely ABSENT from one side is not a deletion — it means that side
    // never had the table loaded (e.g. a compact localStorage cache that had to drop
    // it). Coercing absent→[] and merging made every one of the other side's rows
    // look like "we deleted an untouched row", which then got written to disk. Only
    // a table that is PRESENT and empty can express a real delete-all.
    if(!Array.isArray(o) && Array.isArray(th)){ mergedDB[t]=th; remoteApplied+=th.length?1:0; continue; }
    if(!Array.isArray(th) && Array.isArray(o)){ mergedDB[t]=o;  localApplied +=o.length?1:0;  continue; }
    if(Array.isArray(o)||Array.isArray(th)){
      const r=_mgMergeTable(t, Array.isArray(b)?b:[], Array.isArray(o)?o:[], Array.isArray(th)?th:[], opts.idx);
      mergedDB[t]=r.rows; remoteApplied+=r.remoteApplied; localApplied+=r.localApplied; healed+=r.healed;
      for(const c of r.conflicts) conflicts.push(c);
    }else{
      const p=_mgPick3(b, o, th);
      if(p.value!==undefined) mergedDB[t]=p.value;
      if(p.side==='ours'||p.side==='ours-conflict') localApplied++;
      else if(p.side==='theirs') remoteApplied++;
    }
  }
  const cfg=_mgMergeFlat(base.simCfg||{}, ours.simCfg||{}, theirs.simCfg||{}, opts.idx);
  localApplied+=cfg.localApplied; remoteApplied+=cfg.remoteApplied;
  const payload={
    DB: mergedDB,
    counter: Math.max(Number(ours.counter)||0, Number(theirs.counter)||0, Number(base.counter)||0) || ours.counter || theirs.counter || 0,
    simCfg: cfg.value,
    savedAt: new Date().toISOString(),
  };
  // simResults are regenerated on every simulation run — carry one copy along
  // (prefer whichever side changed) but never let them force a write by themselves.
  const sr=_mgPick3(base.simResults??null, ours.simResults??null, theirs.simResults??null);
  if(sr.value!=null) payload.simResults=sr.value;
  return {payload, conflicts, remoteApplied, localApplied, healed, staleTheirs:healed>0, staleSavedAt:healed>0?(theirs.savedAt||null):null};
}
// Is the disk copy OLDER than what this browser last synced? Save stamps only advance on real
// edits (see autoSaveNow), so an out-of-date copy coming back keeps its old stamp.
function _mgIsStale(diskPayload, basePayloadOrBaseline){
  const d=diskPayload&&diskPayload.savedAt, b=basePayloadOrBaseline&&basePayloadOrBaseline.savedAt;
  return !!(d&&b&&d<b);
}
// Written by the Avila Sales page — its own "Sales file" (app:'AVILA_Sales'): sales rows, forecast
// rules and demand-point stubs, no connections, no facilities. When that landed in a scenario file
// (the file was picked as the Sales file there), merging it as "a teammate's changes" read every
// row it lacks as a deletion and wiped the topology. It is never a version of a scenario: never
// merged, pulled, healed from or opened here — this browser's copy is written back over it instead.
// (Same for an EMPTY scenario file, e.g. one a save dialog was pointed at.)
function _scIsSalesPayload(p){ return !!(p && typeof p==='object' && p.app==='AVILA_Sales'); }
// The same test from a file's first bytes (the Sales page always writes "app" first) — cheap enough
// to run on a picked file before it is registered, without parsing a multi-MB file twice.
async function _scLooksLikeSalesFile(handle){
  try{ const f=await handle.getFile(); return /^\s*\{\s*"app"\s*:\s*"AVILA_Sales"/.test(await f.slice(0,256).text()); }catch(e){ return false; }
}

// Decide how a pending write should hit the disk.
//   plain — file untouched since baseline (or no baseline / unreadable / not a
//           valid payload): write ours as-is, exactly as before this engine.
//   pull  — file changed but we have nothing new: adopt the disk copy, skip the
//           write entirely (prevents two idle browsers ping-ponging rewrites).
//   merge — both sides moved: write the three-way merge.
// `foreign` ('sales' | 'empty') on a plain write: the disk copy was not a version of this
// scenario at all (see _scIsSalesPayload) — ours goes back over it, and the caller says so.
// Parsing a multi-MB baseline on every save is wasteful — keep the last one parsed.
let _mgBaseCache={text:null, obj:null};
function _mgParseBaseline(baseline){
  if(!baseline || !baseline.text) return null;
  if(_mgBaseCache.text===baseline.text) return _mgBaseCache.obj;
  let o=null; try{ o=JSON.parse(baseline.text); }catch(e){}
  _mgBaseCache={text:baseline.text, obj:o};
  return o;
}
// The whole sync decision, pure (no I/O): record what we changed since the baseline into the
// change log, unite the logs, merge row by row. needWrite = the file lacks something we have
// (our edits, or rows/values an out-of-date copy on disk dropped). No own changes and nothing
// to heal → no write at all: a tab that only LOOKS (or only re-runs a simulation) never
// rewrites the shared file.
function _mgSync(base, ours, theirs){
  // Changes the signed-in person may not make are put back before anything is recorded or merged.
  if(typeof _acEnforce==='function') ours=_acEnforce(base, ours, theirs);
  // Topology: the administrator's sealed version is everyone's (see TOPOLOGY SEAL).
  const oursBefore=ours;
  let ts={ours, seal:null, request:null};
  if(typeof _tsPrepare==='function'){ ts=_tsPrepare(base, ours, theirs); ours=ts.ours; }
  const diff=_clDiff(base, ours);
  let log=_clUnion(_clUnion(_clUnion(window._scLog, base.changeLog), ours.changeLog), theirs.changeLog);
  log=_clAppend(log, diff);
  const res=_mgMergePayload(base, ours, theirs, {idx:_clIndex(log)});
  res.payload.changeLog=_clCompact(log);
  if(!diff.ops.length && theirs.savedAt) res.payload.savedAt=theirs.savedAt; // no edit of ours → keep the data's own stamp
  res.ownChanges=diff.ops.length;
  res.diff=diff;
  res.needWrite = res.localApplied>0 || res.conflicts.length>0;
  if(ts.seal) _tsFinish(res, ts.seal, ts.request, oursBefore, theirs);
  // Who wrote what we are pulling in: saves in their log that we had not seen.
  const ours0=new Set(_clNorm(ours.changeLog).saves.map(s=>s.id));
  res.theirSaves=_clNorm(theirs.changeLog).saves.filter(s=>!ours0.has(s.id));
  return res;
}
// Decide how a pending write should hit the disk.
//   plain — no baseline (first write of this file here) / file unreadable or not a scenario:
//           write ours as-is.
//   none  — nothing changed on either side: no write.
//   pull  — the file changed, we have nothing it lacks: adopt the merge result, no write.
//   merge — write the merge result (our changes, and anything an out-of-date copy dropped).
async function _mgPrepareWrite(handle, ours, baseline){
  if(scIsPlanning()) return {mode:'plain'};   // no merge, no change log (a regeneration would blow CL_MAX_OPS)
  if(!baseline || !baseline.text) return {mode:'plain'};
  const base=_mgParseBaseline(baseline);
  if(!base || !base.DB) return {mode:'plain'};
  let f=null;
  try{ f=await handle.getFile(); }catch(e){ return {mode:'plain'}; }
  let diskText=baseline.text, theirs=base;
  if(!(baseline.fileMod!=null && f.lastModified===baseline.fileMod)){
    try{ diskText=new TextDecoder().decode(await f.arrayBuffer()); }catch(e){ return {mode:'plain'}; }
    if(diskText!==baseline.text){
      if(!diskText.trim()) return {mode:'plain', foreign:'empty'};
      theirs=null; try{ theirs=JSON.parse(diskText); }catch(e){}
      if(_scIsSalesPayload(theirs)) return {mode:'plain', foreign:'sales'};
      if(!theirs || !theirs.DB) return {mode:'plain'};
    }
  }
  const mergeInfo=_mgSync(base, ours, theirs);
  if(!mergeInfo.needWrite)
    return {mode: diskText===baseline.text ? 'none' : 'pull', theirs:mergeInfo.payload, diskText, fileMod:f.lastModified, mergeInfo};
  return {mode:'merge', mergeInfo};
}

// Push a (merged / pulled) payload into the live app + light re-render — the
// same set dsIngestTopology refreshes, safe to run mid-session.
function _mgApplyPayloadToApp(payload){
  // Tables the payload lacks are KEPT as they are (a copy written by an older app version
  // has no silo_links etc.; wiping ours made transfers vanish — see _slResetIfAbsent).
  Object.keys(DB).forEach(t=>{ if(payload.DB[t]!==undefined) DB[t]=payload.DB[t]; });
  _campTidyAfterLoad();   // a merge is where two browsers' overlapping campaigns meet
  if(payload.simCfg){ Object.assign(S.simCfg, payload.simCfg); if(!('role' in payload.simCfg)) delete S.simCfg.role; }
  if(payload.counter) S.elCounter=payload.counter;
  if(typeof syncElCounter==='function') syncElCounter();
  // demand_values may have just been replaced wholesale — drop the memoised demand
  // lookups or the grids keep rendering the pre-merge numbers.
  if(typeof _demandCacheInvalidate==='function') _demandCacheInvalidate();
  if(payload.simResults) S.simResults=payload.simResults;
  // The change log is only ever united, never replaced (a restored snapshot carries an old log).
  if(payload.changeLog) window._scLog=_clCompact(_clUnion(window._scLog, payload.changeLog));
  if(payload.topoSeal && typeof _tsNewest==='function') window._scTopoSeal=_tsNewest(window._scTopoSeal, payload.topoSeal);
  // People / permissions may have changed (a new request, a reset password, access removed).
  try{ if(typeof acGate==='function') acGate(); }catch(e){ console.warn('acGate', e); }
  try{
    if(S.view==='demand' && typeof renderDemandView==='function') renderDemandView();
    if(typeof renderDtree==='function') renderDtree(S.simResults);
    if(typeof updateStatusBar==='function') updateStatusBar();
    if(typeof renderLocationTree==='function') renderLocationTree();
    if(typeof updateNavFacilities==='function') updateNavFacilities();
    if(typeof initRealDataFacilitySelector==='function') initRealDataFacilitySelector();
  }catch(e){ console.warn('merge re-render:', e); }
}

// Green banner = clean sync (auto-dismisses); amber = conflicts (stays up).
function _mgShowMergeBanner(fileName, info){
  if(scIsPlanning()) return;   // never merged, never banners
  const conflicts=info.conflicts||[];
  const isConflict=conflicts.length>0;
  let b=document.getElementById('mg-merge-banner');
  if(!b){ b=document.createElement('div'); b.id='mg-merge-banner'; document.body.appendChild(b); }
  b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;font-family:var(--mono),monospace;font-size:11px;padding:8px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 14px rgba(0,0,0,.55);'+
    (isConflict?'background:var(--bn-warn-bg);border-bottom:2px solid var(--amber);color:var(--bn-warn-fg)':'background:var(--bn-ok2-bg);border-bottom:2px solid var(--green);color:var(--bn-ok2-fg)');
  const names=conflicts.slice(0,4).map(c=>c.label).join(' · ')+(conflicts.length>4?` · +${conflicts.length-4} more`:'');
  const who=[...new Set((info.theirSaves||[]).map(sv=>_clWho(sv.dev, sv.name)))];
  const whoTxt=who.length?` by <b>${_scEsc(who.slice(0,3).join(', '))}</b>`:' made by a teammate';
  b.innerHTML=`<span style="font-size:15px;line-height:1">${isConflict?'⚠':'⇄'}</span>
    <span style="flex:1;line-height:1.35">${isConflict
      ? `Merged changes from <b>${fileName||'the shared file'}</b> — <b>${conflicts.length} conflict${conflicts.length>1?'s':''}</b> where both you and a teammate edited the same item: ${names}. <b>Your version was kept</b> — please double-check ${conflicts.length>1?'these items':'this item'}.`
      : info.staleTheirs
      ? `An <b>out-of-date copy</b> of <b>${fileName||'the shared file'}</b>${info.staleSavedAt?` (from ${new Date(info.staleSavedAt).toLocaleString()})`:''} had replaced the newer one — probably another computer or tab that had been open a long time. It was missing <b>${info.healed}</b> newer row${info.healed!==1?'s':''}/value${info.healed!==1?'s':''}: they were <b>kept and saved back</b>${info.remoteApplied?`, and its ${info.remoteApplied} genuine change${info.remoteApplied!==1?'s were':' was'} taken in`:''}.`
      : `Synced with <b>${fileName||'the shared file'}</b>: pulled ${info.remoteApplied} change${info.remoteApplied!==1?'s':''}${whoTxt}${info.localApplied?` and saved ${info.localApplied} of yours`:''}.`}</span>
    <button onclick="document.getElementById('mg-merge-banner')?.remove()" style="background:transparent;color:inherit;border:1px solid currentColor;padding:6px 11px;font-family:inherit;font-size:10px;cursor:pointer;border-radius:3px">Dismiss</button>`;
  if(!isConflict){ clearTimeout(window._mgBannerT); window._mgBannerT=setTimeout(()=>{document.getElementById('mg-merge-banner')?.remove();}, 15000); }
}
// Amber, stays up: the scenario file did not hold a version of this scenario (see _scIsSalesPayload).
//   kind: 'sales' (the Avila Sales page wrote its own data into it) | 'empty'
//   what: 'restored'  — this browser's copy was written back over it
//         'restoring' — startup: this browser's copy is kept and being written back
//         'refused'   — it was not opened (nothing on screen changed)
//         'salesfile' — a genuine Sales file was picked here; not opened
function _mgShowForeignBanner(fileName, kind, what){
  let b=document.getElementById('mg-merge-banner');
  if(!b){ b=document.createElement('div'); b.id='mg-merge-banner'; document.body.appendChild(b); }
  clearTimeout(window._mgBannerT);
  b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;font-family:var(--mono),monospace;font-size:11px;padding:8px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 14px rgba(0,0,0,.55);'+
    'background:var(--bn-warn-bg);border-bottom:2px solid var(--amber);color:var(--bn-warn-fg)';
  const f=`<b>${_scEsc(fileName||'The scenario file')}</b>`;
  const recover='To get the scenario back, restore an earlier copy: <b>🕒 History</b> (Version History), or the file\'s own version history in OneDrive / SharePoint.';
  const msg = what==='salesfile'
      ? `${f} is an <b>Avila Sales</b> file, not an Avila Roll scenario — it was not opened. Open it from the Sales page instead.`
    : what==='refused'
      ? (kind==='sales'
          ? `${f} holds <b>Avila Sales</b> data, not this Avila Roll scenario (the Sales page wrote into it) — it was not opened, and nothing on screen changed. ${recover}`
          : `${f} is empty — it was not opened, and nothing on screen changed. ${recover}`)
      : (kind==='sales'
          ? `${f} had been overwritten by the <b>Avila Sales</b> page with its own data (not this scenario). That is not a teammate's edit, so none of it was merged: `
          : `${f} was empty on disk, so there was nothing to merge: `)
        +(what==='restoring' ? 'this browser\'s copy of the scenario is being written back to it. If that copy is incomplete too, use 🕒 History to restore an earlier version.'
                             : 'your scenario was written back to it.')
        +(kind==='sales' ? ' (The Sales page keeps its own Sales file and never needs this one.)' : '');
  b.innerHTML=`<span style="font-size:15px;line-height:1">⚠</span><span style="flex:1;line-height:1.35">${msg}</span>
    <button onclick="document.getElementById('mg-merge-banner')?.remove()" style="background:transparent;color:inherit;border:1px solid currentColor;padding:6px 11px;font-family:inherit;font-size:10px;cursor:pointer;border-radius:3px">Dismiss</button>`;
}

