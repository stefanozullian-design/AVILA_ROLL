// ═══════════════════════════════════════════════════════════════════════
// ACCESS CONTROL — sign-in + a facility × function permission matrix.
// Lives INSIDE the scenario file (DB.access_users / DB.access_requests), so every
// computer that opens the shared scenario sees the same people — never in the page
// itself (the page is public on GitHub). Passwords are stored only as salted
// PBKDF2 hashes.
// Flow: someone opens the app → the scenario loads behind a sign-in screen →
//   they enter their email and "Request access" (a row in access_requests, written
//   to the shared file) → the admin sees it in 👤 Users & access, ticks what they
//   may MODIFY per facility × function (everything else is read-only), and the app
//   makes a 6-letter temporary password and opens an e-mail draft to them with a
//   link → the link opens the app on "Set your password".
// Enforcement is at SAVE time (_acEnforce, called by _mgSync): a change the signed-in
// person may not make is undone and never reaches the file; a signed-out browser
// writes nothing but its own access request. This stops honest mistakes — the check
// runs in the browser, so it is a seatbelt, not a lock.
// No admin in the file = sign-in is off (old behaviour) until an admin turns it on.
// ═══════════════════════════════════════════════════════════════════════
const AC_FUNCS=[
  {id:'demand',     label:'Demand forecast', tip:'Future demand per demand point, demand swaps, forecast commitments'},
  {id:'inventory',  label:'Inventory',       tip:'Daily inventory counts'},
  {id:'production', label:'Production plan', tip:'Kiln / mill / packer campaigns, mill policies, maintenance, non-working days'},
  {id:'real',       label:'Real values',     tip:'Actual production, shipments, rail, unloading, transfers (Daily Data and imports)'},
  {id:'logistics',  label:'Logistics',       tip:'Vessel calls and campaigns, rail plan and movements, silo transfers, deliveries'},
  {id:'topology',   label:'Topology & setup',tip:'Facilities, equipment, silos, demand points, connections, products, simulation settings'},
];
const AC_NET='__network';   // matrix row for records that belong to no single facility
const AC_TABLE_FUNC={
  demand_values:'demand', monthly_demand:'demand', demand_forecasts:'demand', demand_substitutions:'demand', forecast_commitments:'demand',
  plan_settings:'demand', plan_versions:'demand', plan_lines:'demand', alloc_keys:'demand', norm_rules:'demand', plan_demand:'demand', plan_imports:'demand', plan_yields:'demand',
  real_inventory_daily:'inventory', actual_inventory:'inventory',
  production_campaigns:'production', production_schedule:'production', mill_policies:'production', mill_product_focus:'production',
  element_maintenance_events:'production', non_working_days:'production',
  real_production_daily:'real', real_shipments_daily:'real', real_shipments_meta:'real', real_transfers_daily:'real', real_transfers_file_daily:'real', real_transfers_file_meta:'real',
  real_silo_transfers_daily:'real', real_rail_daily:'real', real_shipping_daily:'real', real_unloading_daily:'real',
  actual_production:'real', actual_dispatch:'real', actual_vessel_calls:'real', actual_rail_movements:'real',
  vessel_calls:'logistics', vessel_campaigns:'logistics', vessel_sof:'logistics', rail_movements:'logistics', rail_loading_plan:'logistics',
  silo_transfer_plans:'logistics', fuel_deliveries:'logistics', additive_deliveries:'logistics', transport_links:'logistics',
};   // anything else (elements, connections, facilities, products, recipes, silo links, settings…) → topology
const AC_PW_FIELDS=['pw','must_change','pw_changed_at'];
const AC_SESSION_DAYS=30;

let _acUser=null;          // the signed-in person's row in DB.access_users (null = signed out)
let _acState={mode:null};  // sign-in screen state

function _acUsers(db){ return ((db||DB).access_users)||[]; }
function _acEnabledDB(db){ return _acUsers(db).some(u=>u && u.admin && u.active!==false); }
function _acNorm(email){ return String(email||'').trim().toLowerCase(); }
// Latest pending request per email (a person may have asked twice), minus people who already have access.
function _acPendingRequests(){
  const users=new Set(_acUsers().map(u=>u.id)), latest=new Map();
  for(const r of (DB.access_requests||[])){
    const em=_acNorm(r.email); if(!em || users.has(em)) continue;
    const cur=latest.get(em); if(!cur || (r.at||'')>(cur.at||'')) latest.set(em, r);
  }
  return [...latest.values()].filter(r=>r.status==='pending').sort((a,b)=>(a.at||'').localeCompare(b.at||''));
}
function _acIsAdmin(){ return !!(_acUser && _acUser.admin); }
function _acFacName(id){ if(id===AC_NET) return 'Network-wide'; const f=(DB.facilities||[]).find(x=>x.id===id); return f?(f.name||f.id):id; }

// ── Password hashing (PBKDF2-SHA256, WebCrypto) ──
function _acB64e(u8){ let s=''; for(const b of u8) s+=String.fromCharCode(b); return btoa(s); }
function _acB64d(s){ const b=atob(s), u=new Uint8Array(b.length); for(let i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return u; }
async function _acHash(pw, salt, iter){
  const key=await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:_acB64d(salt), iterations:iter}, key, 256);
  return _acB64e(new Uint8Array(bits));
}
async function _acMakePw(pw){
  const salt=_acB64e(crypto.getRandomValues(new Uint8Array(16))), iter=150000;
  return {salt, iter, hash:await _acHash(pw, salt, iter)};
}
async function _acCheckPw(user, pw){
  if(!user || !user.pw || !user.pw.hash) return false;
  const cand = user.must_change ? String(pw||'').trim().toUpperCase() : String(pw||'');
  return (await _acHash(cand, user.pw.salt, user.pw.iter||150000))===user.pw.hash;
}
function _acTempPw(){
  const A='ABCDEFGHJKLMNPQRSTUVWXYZ', r=crypto.getRandomValues(new Uint8Array(6));
  return Array.from(r, b=>A[b%A.length]).join('');
}

// ── Sessions (per scenario, per browser) ──
function _acSessKey(){ return 'avila_session_'+(SC.activeId||'local'); }
function _acReadSession(){
  try{ const s=JSON.parse(sessionStorage.getItem(_acSessKey())||localStorage.getItem(_acSessKey())||'null'); return (s && (!s.exp || s.exp>Date.now()))?s:null; }catch(e){ return null; }
}
function _acWriteSession(user, remember){
  const s={email:user.id, pwv:(user.pw&&user.pw.hash||'').slice(0,16), exp:remember?Date.now()+AC_SESSION_DAYS*864e5:null};
  try{ sessionStorage.removeItem(_acSessKey()); localStorage.removeItem(_acSessKey());
       (remember?localStorage:sessionStorage).setItem(_acSessKey(), JSON.stringify(s)); }catch(e){}
}
function _acClearSession(){ try{ sessionStorage.removeItem(_acSessKey()); localStorage.removeItem(_acSessKey()); }catch(e){} }
// The person this browser is signed in as — only while their row still exists, is active and
// their password has not been changed/reset since (a reset signs every other browser out).
function _acUserFromSession(){
  const s=_acReadSession(); if(!s) return null;
  const u=_acUsers().find(x=>x.id===s.email);
  if(!u || u.active===false || u.must_change) return null;
  if(((u.pw&&u.pw.hash)||'').slice(0,16)!==s.pwv) return null;
  return u;
}

// ── What may this person change? ──
function _acCan(user, func, fac){
  if(!user) return false;
  if(user.admin) return true;
  const row=(user.perm||{})[fac||AC_NET]; return !!(row && row[func]==='edit');
}
function _acFunc(table, row){
  if(table==='demand_values' && row && row.source==='actual') return 'real';
  return AC_TABLE_FUNC[table]||'topology';
}
// Which facility an element belongs to for permissions. Demand points all carry the SUPPLYING
// plant's id (BRS), so their real location comes from the name / dp_code prefix
// ("JAX/DEM/…" → JAX, "HEI-PEV/…" → PEV); unknown prefixes fall back to the stored facility.
function _acElFacility(e, facByName){
  if(!e) return null;
  if(e.type==='demand_point'){
    const code=String((e.props&&e.props.dp_code)||e.name||'').split('/')[0].trim().toUpperCase();
    const hit=facByName.get(code) || facByName.get(code.split('-').pop());
    if(hit) return hit;
  }
  // Every element sits on the main plant's canvas (facility_id = BRS); where it really is lives
  // in assigned_facility_id — a PEV silo is facility_id BRS, assigned PEV.
  return e.assigned_facility_id||e.facility_id||null;
}
function _acFacByName(){ const m=new Map(); for(const f of (DB.facilities||[])) if(f && f.name) m.set(String(f.name).trim().toUpperCase(), f.id); return m; }
function _acRowFacility(table, row, elFac){
  if(!row) return null;
  if(table==='facilities') return row.id||null;
  if(table==='elements') return elFac.get(row.id) || _acElFacility(row, _acFacByName());
  // Rows tied to a piece of equipment belong where that equipment is: older rows were stamped
  // with the canvas plant (BRS) whatever the silo's real facility.
  for(const k of ['silo_id','element_id','berth_id','mill_id','kiln_id','equipment_id']){
    const f=row[k]!=null && elFac.get(row[k]); if(f) return f;
  }
  if(row.facility_id) return row.facility_id;
  if(row.origin_facility_id) return row.origin_facility_id;
  for(const k of ['element_id','silo_id','from_silo_id','berth_id','mill_id','kiln_id','equipment_id','from','dispatch_id','to_silo_id','to']){
    const f=row[k]!=null && elFac.get(row[k]); if(f) return f;
  }
  if(row.dest_facility_id) return row.dest_facility_id;
  return null;
}
// A signed-in person may change their own password; anyone (signed in or not) may add an
// access request. Everything else in the access tables is the admin's.
function _acAccessRowAllowed(table, b, o){
  if(table==='access_requests') return !b && !!o;
  if(table==='change_requests') return !b && !!o && !!_acUser && o.by===_acUser.id;
  if(table==='access_users'){
    if(!_acUser || !b || !o || b.id!==_acUser.id || o.id!==_acUser.id) return false;
    const strip=r=>{ const c=Object.assign({},r); AC_PW_FIELDS.forEach(f=>delete c[f]); return _mgStr(c); };
    return strip(b)===strip(o);
  }
  return false;
}
// Auto-proposed vessel calls are regenerated by every simulation run: when someone may not
// change logistics they simply stay local (not written, not undone, no message).
function _acSilentRow(table, row){ return table==='vessel_calls' && row && row.status==='Proposed' && String(row.notes||'').startsWith('Auto-proposed'); }

// Called by _mgSync before anything is diffed or merged: returns `ours` with every change
// this person may not make put back to the baseline, and undoes those changes on screen.
function _acEnforce(base, ours, theirs){
  if(!base || !base.DB || !ours || !ours.DB) return ours;
  if(!_acEnabledDB(base.DB) && !_acEnabledDB(ours.DB) && !(theirs && theirs.DB && _acEnabledDB(theirs.DB))) return ours;   // sign-in is off for this scenario
  if(_acIsAdmin()) return ours;
  const elFac=new Map(), fbn=_acFacByName();
  for(const src of [base.DB.elements, ours.DB.elements]) for(const e of (src||[])) if(e && e.id!=null && !elFac.has(e.id)) elFac.set(e.id, _acElFacility(e, fbn));
  const outDB=Object.assign({}, ours.DB), undo={}, blocked=new Map();
  const block=(func,fac)=>{ const k=func+'|'+(fac||AC_NET); blocked.set(k,(blocked.get(k)||0)+1); };
  for(const t of Object.keys(ours.DB)){
    const oa=ours.DB[t]; if(!Array.isArray(oa)) continue;
    const ba=Array.isArray(base.DB[t])?base.DB[t]:[];
    const bm=new Map(); for(const r of ba) bm.set(_mgRowKey(t,r), r);
    const om=new Map(); for(const r of oa) om.set(_mgRowKey(t,r), r);
    let changed=false, visible=false; const rows=[];
    const ok=(b,o)=>{
      if(t==='access_users'||t==='access_requests'||t==='change_requests') return _acAccessRowAllowed(t,b,o);
      const fb=b?_acRowFacility(t,b,elFac):null, fo=o?_acRowFacility(t,o,elFac):null;
      const fn=_acFunc(t, o||b);
      const can=(!b || _acCan(_acUser, _acFunc(t,b), fb)) && (!o || _acCan(_acUser, fn, fo));
      if(!can) block(fn, fo||fb);
      return can;
    };
    for(const [k,o] of om){
      const b=bm.get(k);
      if(b!==undefined && _mgStr(b)===_mgStr(o)){ rows.push(o); continue; }
      if(ok(b,o)){ rows.push(o); continue; }
      changed=true; if(!_acSilentRow(t,o)) visible=true;
      if(b!==undefined) rows.push(b);                          // edited → back to the saved value
    }
    for(const [k,b] of bm) if(!om.has(k)){
      if(ok(b,undefined)) continue;                            // allowed delete
      changed=true; visible=true; rows.push(b);                // not allowed → the row comes back
    }
    if(changed){ outDB[t]=rows; if(visible) undo[t]=rows; }
  }
  let simCfg=ours.simCfg;
  if(_mgStr(base.simCfg||{})!==_mgStr(ours.simCfg||{}) && !_acCan(_acUser,'topology',AC_NET)){ simCfg=base.simCfg; block('topology',AC_NET); }
  const out=Object.assign({}, ours, {DB:outDB, simCfg});
  if(Object.keys(undo).length || simCfg!==ours.simCfg){
    Object.keys(undo).forEach(t=>{ DB[t]=undo[t]; });
    if(simCfg!==ours.simCfg && base.simCfg){ Object.keys(S.simCfg).forEach(k=>{ if(!(k in base.simCfg)) delete S.simCfg[k]; }); Object.assign(S.simCfg, base.simCfg); }
    if(typeof _demandCacheInvalidate==='function') _demandCacheInvalidate();
    _acReportBlocked(blocked);
    setTimeout(()=>{ try{ if(typeof _acRerender==='function') _acRerender(); }catch(e){} }, 0);
  }
  return out;
}
function _acRerender(){
  if(S.view==='demand' && typeof renderDemandView==='function') renderDemandView();
  if(S.view==='supply' && typeof renderSupplyView==='function') renderSupplyView();
  if(typeof renderLocationTree==='function') renderLocationTree();
  if(S.topSection==='logistics'){ if(S.activeSchedTab==='rail' && typeof rpRender==='function') rpRender(); if(S.activeSchedTab==='vessels' && typeof vpRender==='function') vpRender(); }
}
function _acReportBlocked(blocked){
  if(!blocked.size) return;
  const parts=[...blocked.entries()].slice(0,4).map(([k,n])=>{ const [f,fac]=k.split('|'); const F=AC_FUNCS.find(x=>x.id===f); return `<b>${_scEsc(F?F.label:f)}</b> at <b>${_scEsc(_acFacName(fac))}</b>`; });
  const n=[...blocked.values()].reduce((a,b)=>a+b,0);
  const msg=_acUser
    ? `You have <b>read-only</b> access to ${parts.join(', ')}${blocked.size>4?' and more':''} — ${n} change${n!==1?'s were':' was'} undone and not saved. Ask the administrator if you need to change this.`
    : `You are <b>not signed in</b> — ${n} change${n!==1?'s were':' was'} undone and not saved.`;
  _acBanner(msg, 'warn');
}
function _acBanner(html, kind){
  let b=document.getElementById('ac-banner');
  if(!b){ b=document.createElement('div'); b.id='ac-banner'; document.body.appendChild(b); }
  b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99995;font-family:var(--mono),monospace;font-size:11px;padding:8px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 14px rgba(0,0,0,.55);'+
    (kind==='warn'?'background:var(--bn-warn-bg);border-bottom:2px solid var(--amber);color:var(--bn-warn-fg)':'background:var(--bn-ok2-bg);border-bottom:2px solid var(--green);color:var(--bn-ok2-fg)');
  b.innerHTML=`<span style="font-size:14px">${kind==='warn'?'🔒':'👤'}</span><span style="flex:1;line-height:1.35">${html}</span>
    <button onclick="document.getElementById('ac-banner')?.remove()" style="background:transparent;color:inherit;border:1px solid currentColor;padding:6px 11px;font-family:inherit;font-size:10px;cursor:pointer;border-radius:3px">Dismiss</button>`;
  clearTimeout(window._acBannerT); window._acBannerT=setTimeout(()=>document.getElementById('ac-banner')?.remove(), kind==='warn'?20000:12000);
}

// ── Gate: decide, after every load / sync, whether this browser must sign in ──
function _acRequiredList(){ try{ return JSON.parse(localStorage.getItem('avila_ac_required')||'[]'); }catch(e){ return []; } }
function _acMarkRequired(id, on){
  try{ const l=new Set(_acRequiredList()); if(on) l.add(id); else l.delete(id); localStorage.setItem('avila_ac_required', JSON.stringify([...l])); }catch(e){}
}
// Page start, before the scenario file is read: if the scenario this browser last used needs a
// sign-in, cover the app right away (the local cache would otherwise show its data meanwhile).
function acEarlyCover(){
  let last=null; try{ last=(JSON.parse(localStorage.getItem('avila_scenarios')||'{}').activeId)||null; }catch(e){}
  const setpw=_acHashEmail();
  if((last && _acRequiredList().includes(last)) || setpw){ _acState={mode:'wait'}; _acRenderGate(); }
}
function _acHashEmail(){ const m=/[#&]setpw=([^&]+)/.exec(location.hash||''); return m?decodeURIComponent(m[1]):null; }
// Called from scAfterLoad and whenever a sync brings new data in.
function acGate(){
  const on=_acEnabledDB();
  if(SC.activeId) _acMarkRequired(SC.activeId, on);
  const prevId=_acUser&&_acUser.id;
  if(!on){ _acUser=null; _acCloseGate(); acUpdateChip(); return; }
  const setpw=_acHashEmail();
  const u=_acUserFromSession();
  if(u && !setpw){
    _acUser=u; _acCloseGate(); acUpdateChip(); _acNotifyRequests(); return;
  }
  if(prevId && !u){ _acUser=null; _acClearSession(); }
  _acUser=null;
  // Already showing a form (e.g. the person is typing): don't rebuild it on a background sync.
  if(document.getElementById('ac-gate') && _acState.mode && _acState.mode!=='wait' && _acState.mode!=='welcome'){ acUpdateChip(); return; }
  if(setpw){ _acState={mode:'setpw', email:setpw}; }
  else if(!_acState.mode || _acState.mode==='wait' || _acState.mode==='welcome') _acState={mode:'signin', email:(prevId||'')};
  _acRenderGate(); acUpdateChip();
}
// The sign-in screen needs the scenario file (the list of people lives in it). If none is
// open yet, it says so and offers the scenario picker.
function _acGateNeedsScenario(){ return !SC.activeId || !SC.handles[SC.activeId]; }
function _acCloseGate(){ document.getElementById('ac-gate')?.remove(); }
function _acRenderGate(){
  let g=document.getElementById('ac-gate');
  if(!g){ g=document.createElement('div'); g.id='ac-gate'; g.className='ac-gate'; document.body.appendChild(g); }
  const st=_acState, e=v=>_scEsc(v||'');
  const scn=SC.activeId&&SC.meta[SC.activeId]?SC.meta[SC.activeId].name:'';
  const head=(t,sub)=>`<div class="ac-logo">AVILA <span>Roll</span></div><div class="ac-h">${t}</div>${sub?`<div class="ac-sub">${sub}</div>`:''}`;
  let body='';
  if(st.mode==='welcome'){
    body=_acWelcomeHTML(st);
  }else if(st.mode==='wait'){
    body=head('Opening the scenario…', 'Sign-in is required for this scenario.')+
      `<div class="ac-links">Nothing happening? <a onclick="acWelcomeClassic()">Show my scenarios</a> · <a onclick="_acState={mode:'welcome',email:_acHashEmail()||'',file:_acHashParam('f')||''};_acRenderGate()">Open the shared folder</a></div>`;
  }else if(st.mode==='signin'){
    body=head('Sign in', scn?`Scenario <b>${e(scn)}</b>`:'')+
      `<label class="ac-l">Email</label><input class="ac-in" id="ac-email" type="email" autocomplete="username" value="${e(st.email)}" onkeydown="if(event.key==='Enter')document.getElementById('ac-pw').focus()">
       <label class="ac-l">Password</label><input class="ac-in" id="ac-pw" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')acSignIn()">
       <label class="ac-chk"><input type="checkbox" id="ac-remember" checked> Keep me signed in on this computer for ${AC_SESSION_DAYS} days</label>
       <div class="ac-err" id="ac-err">${e(st.err)}</div>
       <div class="ac-row"><button class="sc-btn pri" id="ac-go" onclick="acSignIn()">Sign in</button></div>
       <div class="ac-links">New here, or no password yet? <a onclick="acGateMode('request')">Request access</a></div>`;
  }else if(st.mode==='request'){
    body=head('Request access', 'The administrator will review your request and e-mail you a temporary password.')+
      `<label class="ac-l">Your email</label><input class="ac-in" id="ac-email" type="email" value="${e(st.email)}">
       <label class="ac-l">Your name</label><input class="ac-in" id="ac-name" value="${e(st.name)}">
       <label class="ac-l">What do you need to do? (optional)</label><textarea class="ac-in" id="ac-note" rows="3" placeholder="e.g. update daily inventory at Port Everglades">${e(st.note)}</textarea>
       <div class="ac-err" id="ac-err">${e(st.err)}</div>
       <div class="ac-row"><button class="sc-btn pri" onclick="acSubmitRequest()">Send request</button><button class="sc-btn" onclick="acGateMode('signin')">Back to sign in</button></div>`;
  }else if(st.mode==='requested'){
    body=head('Request sent ✓', `Your request for <b>${e(st.email)}</b> is waiting for the administrator. You will receive an e-mail with a temporary password and a link to set your own.`)+
      `<div class="ac-row"><button class="sc-btn" onclick="acGateMode('signin')">Back to sign in</button></div>`;
  }else if(st.mode==='setpw'){
    body=head('Set your password', 'Use the temporary password from the e-mail, then choose your own (at least 8 characters).')+
      `<label class="ac-l">Email</label><input class="ac-in" id="ac-email" type="email" autocomplete="username" value="${e(st.email)}">
       <label class="ac-l">Temporary or current password</label><input class="ac-in" id="ac-old" type="password" autocomplete="current-password">
       <label class="ac-l">New password</label><input class="ac-in" id="ac-new1" type="password" autocomplete="new-password">
       <label class="ac-l">New password again</label><input class="ac-in" id="ac-new2" type="password" autocomplete="new-password" onkeydown="if(event.key==='Enter')acSetPassword()">
       <div class="ac-err" id="ac-err">${e(st.err)}</div>
       <div class="ac-row"><button class="sc-btn pri" onclick="acSetPassword()">Save password and sign in</button>${_acUser?`<button class="sc-btn" onclick="acGateCancel()">Cancel</button>`:`<button class="sc-btn" onclick="acGateMode('signin')">Back to sign in</button>`}</div>`;
  }
  g.innerHTML=`<div class="ac-card${st.mode==='welcome'?' wide':''}">${body}<div class="ac-foot">Access is managed by the scenario's administrator.</div></div>`;
  setTimeout(()=>{ const f=g.querySelector('input:not([type=checkbox])'); if(f && !f.value) f.focus(); else if(f){ const n=g.querySelectorAll('input:not([type=checkbox])')[1]; if(n) n.focus(); } }, 30);
}
function acGateMode(mode){
  const em=document.getElementById('ac-email'); const email=em?em.value.trim():(_acState.email||'');
  _acState={mode, email}; _acRenderGate();
}
function acGateCancel(){ _acState={mode:null}; _acCloseGate(); }
function _acErr(msg){ _acState.err=msg; const el=document.getElementById('ac-err'); if(el) el.textContent=msg; }

async function acSignIn(){
  const email=_acNorm(document.getElementById('ac-email')?.value), pw=document.getElementById('ac-pw')?.value||'';
  const remember=!!document.getElementById('ac-remember')?.checked;
  _acState.email=email;
  if(!email || !pw) return _acErr('Enter your email and password.');
  const btn=document.getElementById('ac-go'); if(btn){ btn.disabled=true; btn.textContent='Checking…'; }
  const u=_acUsers().find(x=>x.id===email);
  const good=u && u.active!==false && await _acCheckPw(u, pw);
  if(btn){ btn.disabled=false; btn.textContent='Sign in'; }
  if(!good){
    if(u && u.active===false) return _acErr('This account is disabled — contact the administrator.');
    if(!u && _acUsers().length && (DB.access_requests||[]).some(r=>_acNorm(r.email)===email && r.status!=='declined'))
      return _acErr('Your access request is still waiting for the administrator.');
    return _acErr('Email or password not recognised.');
  }
  if(u.must_change){ _acState={mode:'setpw', email, prefillOld:pw}; _acRenderGate(); const o=document.getElementById('ac-old'); if(o) o.value=pw; document.getElementById('ac-new1')?.focus(); return; }
  _acUser=u; _acWriteSession(u, remember);
  _acState={mode:null}; _acCloseGate(); acUpdateChip(); _acNotifyRequests(true);
  statMsg('Signed in as '+(u.name||u.email));
}

async function acSubmitRequest(){
  const email=_acNorm(document.getElementById('ac-email')?.value), name=(document.getElementById('ac-name')?.value||'').trim();
  const note=(document.getElementById('ac-note')?.value||'').trim();
  Object.assign(_acState,{email,name,note});
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return _acErr('Enter a valid email address.');
  if(!name) return _acErr('Enter your name.');
  if(_acGateNeedsScenario()) return _acErr('Open the scenario file first (📂), then send the request.');
  if(_acUsers().some(u=>u.id===email)) return _acErr('This email already has access — sign in, or ask the administrator to reset your password.');
  // (Earlier requests from the same email are left alone — a signed-out browser may only ADD a
  //  request; the admin's panel shows the latest one per email.)
  DB.access_requests=(DB.access_requests||[]).slice();
  DB.access_requests.push({id:'rq_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5), email, name, note, at:new Date().toISOString(), status:'pending'});
  autoSave();
  const ok=await scWriteActive(SC.activeId);
  if(!ok) return _acErr('Could not save the request to the scenario file — check that you can open it (📂) and try again.');
  _acState={mode:'requested', email}; _acRenderGate();
}

// Set-password page: the temporary (or current) password proves who it is.
async function acSetPassword(){
  const email=_acNorm(document.getElementById('ac-email')?.value), old=document.getElementById('ac-old')?.value||'';
  const n1=document.getElementById('ac-new1')?.value||'', n2=document.getElementById('ac-new2')?.value||'';
  _acState.email=email;
  if(_acGateNeedsScenario()) return _acErr('Open the scenario file first (📂).');
  const u=_acUsers().find(x=>x.id===email);
  if(!u || u.active===false || !await _acCheckPw(u, old)) return _acErr('Email or temporary password not recognised.');
  if(n1.length<8) return _acErr('Choose a password of at least 8 characters.');
  if(n1!==n2) return _acErr('The two new passwords are not the same.');
  if(n1.toUpperCase()===old.toUpperCase()) return _acErr('Choose a password different from the temporary one.');
  const idx=DB.access_users.findIndex(x=>x.id===email);
  const nu=Object.assign({}, DB.access_users[idx], {pw:await _acMakePw(n1), must_change:false, pw_changed_at:new Date().toISOString()});
  DB.access_users=DB.access_users.slice(); DB.access_users[idx]=nu;
  _acUser=nu;                       // lets _acEnforce accept this person's own password change
  autoSave();
  const ok=await scWriteActive(SC.activeId);
  if(!ok){ _acUser=null; return _acErr('Could not save to the scenario file — check file access (📂) and try again.'); }
  _acWriteSession(nu, true);
  if(_acHashEmail()) try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){}
  _acState={mode:null}; _acCloseGate(); acUpdateChip();
  statMsg('Password saved — signed in as '+(nu.name||nu.email));
}

function acSignOut(){
  _acUser=null; _acClearSession(); acUpdateChip();
  _acState={mode:'signin', email:''}; _acRenderGate();
}

// ── Top-bar chip ──
function acUpdateChip(){
  if(typeof acScheduleSweep==='function') acScheduleSweep();   // re-lock / unlock inputs for this person
  // The top-bar "Menu" button (User · Save · History · Push to BI) carries the signed-in
  // first name and the admin's pending-request badge.
  const lbl=document.getElementById('tb-menu-lbl'), badge=document.getElementById('tb-menu-badge');
  const btn=document.getElementById('tb-menu-btn'), sub=document.getElementById('tb-mi-user-sub');
  if(!lbl) return;
  const pend=_acIsAdmin()?_acPendingRequests().length+(typeof _tsPending==='function'?_tsPending().length:0):0;
  let name='', title='';
  if(!_acEnabledDB()){ title='Sign-in is not turned on for this scenario'; }
  else if(!_acUser){ name='Sign in'; title='Sign in'; }
  else {
    name=String(_acUser.name||_acUser.email).split(/[\s@]/)[0];
    title=(_acUser.name||'')+' · '+_acUser.email+(_acUser.admin?' · administrator':'')+(pend?` — ${pend} access request${pend>1?'s':''} waiting`:'');
  }
  lbl.textContent=name||'Menu';
  if(badge) badge.innerHTML=pend?` <span class="ac-badge">${pend}</span>`:'';
  if(sub) sub.textContent=name;
  if(btn) btn.title=title||'User, save, history and Push to BI';
}
// Top-bar menu: one button that opens User / Save / History / Push to BI.
function tbMenuClose(){ const d=document.getElementById('tb-menu-dd'); if(d) d.style.display='none'; }
function tbMenuToggle(ev){
  if(ev) ev.stopPropagation();
  const d=document.getElementById('tb-menu-dd'); if(!d) return;
  if(d.style.display!=='none'){ d.style.display='none'; return; }
  d.style.display='block';
  setTimeout(()=>document.addEventListener('click',tbMenuClose,{once:true}),0);
}
function tbMenuPick(what){
  tbMenuClose();
  if(what==='save') scManualSave();
  else if(what==='history') scOpenHistoryPanel();
  else if(what==='bi') pushToBI();
  else if(what==='user'){
    const btn=document.getElementById('tb-menu-btn');
    acChipClick({stopPropagation(){}, currentTarget:btn});
  }
}
function acChipClick(ev){
  ev.stopPropagation();
  if(!_acEnabledDB()){ acOpenUsersPanel(); return; }
  if(!_acUser){ _acState={mode:'signin', email:''}; _acRenderGate(); return; }
  document.getElementById('ac-menu')?.remove();
  const r=ev.currentTarget.getBoundingClientRect(), m=document.createElement('div');
  m.id='ac-menu'; m.className='sc-dropdown'; m.style.cssText=`display:block;position:fixed;top:${r.bottom+4}px;left:${Math.max(8,r.right-230)}px;width:230px;z-index:2000;padding:6px`;
  const it=(t,fn)=>`<div class="ac-mi" onclick="document.getElementById('ac-menu')?.remove();${fn}">${t}</div>`;
  m.innerHTML=`<div style="padding:6px 8px 8px;font-size:10px;color:var(--text-dim);border-bottom:1px solid var(--border)">${_scEsc(_acUser.email)}<br>${_scEsc(_acAccessSummary(_acUser))}</div>`+
    (_acUser.admin?it('👥 Users & access','acOpenUsersPanel()'):'')+
    it('🔑 Change password',"_acState={mode:'setpw',email:_acUser.email};_acRenderGate()")+
    it('↪ Sign out','acSignOut()');
  document.body.appendChild(m);
  setTimeout(()=>document.addEventListener('click',()=>m.remove(),{once:true}),0);
}
function _acAccessSummary(u){
  if(!u) return '';
  if(u.admin) return 'Administrator — can change everything';
  const lines=[];
  for(const F of AC_FUNCS){
    const facs=Object.keys(u.perm||{}).filter(f=>(u.perm[f]||{})[F.id]==='edit');
    if(facs.length) lines.push(F.label+': '+facs.map(_acFacName).join(', '));
  }
  return lines.length?('Can change — '+lines.join(' · ')+'. Everything else read-only.'):'Read-only';
}
// Admin: a toast when a new request arrives (checked on every sync).
function _acNotifyRequests(force){
  if(!_acIsAdmin()) return;
  const pend=_acPendingRequests().concat(typeof _tsPending==='function'?_tsPending():[]);
  const seen=new Set(window._acSeenReq||[]);
  const fresh=pend.filter(r=>!seen.has(r.id));
  window._acSeenReq=pend.map(r=>r.id);
  acUpdateChip();
  if(fresh.length && (force || window._acReqPrimed)) _acBanner(`<b>${_scEsc(fresh.map(r=>r.name||r.email||r.by).join(', '))}</b> ${fresh.some(r=>r.area)?'sent a request (access or topology change)':'asked for access'}. <a style="text-decoration:underline;cursor:pointer" onclick="acOpenUsersPanel()">Review →</a>`, 'ok');
  window._acReqPrimed=true;
}

// ═══ Up-front lock — read-only places never open for editing ═══
// Three layers, all no-ops for administrators and when sign-in is off:
//   1. In-place inputs (demand grid, rail loading, rail pushes / yard counts, Daily Data) are
//      marked read-only as they render (a debounced sweep) and refuse focus/typing.
//   2. Editors and commands that open from a click (inventory / campaign / vessel / transfer
//      popups, maintenance, mill policies, demand builder, topology tools…) are wrapped: the
//      wrapper checks the person's rights for that function at that facility first and shows
//      "🔒 Read-only" instead of opening.
//   3. Campaign drag grips refuse to start a drag.
// The save-time check in _acEnforce stays as the backstop for anything not covered here.
function _acLockActive(){ return _acEnabledDB() && !_acIsAdmin(); }
// May the person change `func` at `fac`? fac undefined = "anywhere" (they may change it at at
// least one facility — the save-time check then stops the wrong one).
function _acMay(func, fac){
  if(!_acLockActive()) return true;
  if(!_acUser) return false;
  if(fac!==undefined && fac!==null) return _acCan(_acUser, func, fac);
  const p=_acUser.perm||{}; return Object.keys(p).some(k=>(p[k]||{})[func]==='edit');
}
function _acFacOfEl(id){
  if(id==null) return undefined;
  const memo=_acSweep._memo;   // set for the duration of one sweep (see _acSweep)
  if(memo && memo.has(id)) return memo.get(id);
  const e=(DB.elements||[]).find(x=>x.id===id); const r=e?(_acElFacility(e, _acFacByName())||undefined):undefined;
  if(memo) memo.set(id,r);
  return r;
}
function _acLockTip(func, fac, ev){
  const F=AC_FUNCS.find(x=>x.id===func);
  const where=(fac!==undefined&&fac!==null)?' at '+_acFacName(fac):'';
  const txt=_acUser?`🔒 Read-only — you can view but not change ${F?F.label:func}${where}`:'🔒 Sign in to make changes';
  let t=document.getElementById('ac-locktip');
  if(!t){ t=document.createElement('div'); t.id='ac-locktip'; t.className='ac-locktip'; document.body.appendChild(t); }
  t.textContent=txt;
  const x=ev&&ev.clientX!=null?ev.clientX:innerWidth/2, y=ev&&ev.clientY!=null?ev.clientY:80;
  t.style.left=Math.min(x+12, innerWidth-340)+'px'; t.style.top=(y+14)+'px'; t.style.display='block';
  clearTimeout(window._acTipT); window._acTipT=setTimeout(()=>{ t.style.display='none'; }, 2600);
}
// Which function / facility an in-place input edits (null = not a data input we govern).
function _acInputScope(el){
  if(!el || !el.classList) return null;
  if(el.classList.contains('dem-cell')) return {func:'demand', fac:_acFacOfEl(el.dataset.el)};
  if(el.classList.contains('rail-load-cell')) return {func:'logistics', fac:_acFacOfEl(el.dataset.dp)};
  if(el.classList.contains('rp-push-inp')){
    if(el.getAttribute('onchange')&&el.getAttribute('onchange').startsWith('_rpAvailEdit')) return {func:'real', fac:el.dataset.fac||_acFacOfEl(el.dataset.dp)};
    return {func:'logistics', fac:_acFacOfEl(el.dataset.dp)};
  }
  if(el.classList.contains('rd-in')) return {func:el.dataset.type==='inventory'?'inventory':'real', fac:S.realDataFacilityId};
  return null;
}
const AC_LOCK_INPUTS='input.dem-cell,input.rail-load-cell,input.rp-push-inp,#rd-sections-container .rd-in';
function _acSweep(){
  _acSweepT=null;
  const on=_acLockActive();
  document.body.classList.toggle('ac-locked-mode', on);
  // One sweep asks the same two questions for every cell of a row (a year view has ~30k inputs):
  // element → facility and (function, facility) → may edit are each answered once per sweep.
  _acSweep._memo=new Map(); const mayMemo=new Map();
  try{
    document.querySelectorAll(AC_LOCK_INPUTS).forEach(el=>{
      let lock=false;
      if(on){ const sc=_acInputScope(el); if(sc){ const k=sc.func+'|'+sc.fac; let may=mayMemo.get(k); if(may===undefined){ may=_acMay(sc.func, sc.fac); mayMemo.set(k,may); } lock=!may; } }
      if(lock){ if(!el.readOnly){ el.readOnly=true; el.dataset.acro='1'; el.classList.add('ac-ro'); } }
      else if(el.dataset.acro){ el.readOnly=false; delete el.dataset.acro; el.classList.remove('ac-ro'); }
    });
  }finally{ _acSweep._memo=null; }
  const rdBtn=document.getElementById('submitRealDataBtn');
  if(rdBtn){ const ok=!on || _acMay('real', S.realDataFacilityId) || _acMay('inventory', S.realDataFacilityId); rdBtn.disabled=!ok; rdBtn.title=ok?'':'Read-only — you cannot change real values here'; }
}
let _acSweepT=null;
function acScheduleSweep(){ if(_acSweepT) return; _acSweepT=setTimeout(_acSweep, 60); }
// Typing / pasting into a locked input, or a drag grip on a read-only campaign.
function _acBlockEvent(e){
  if(!_acLockActive()) return;
  const t=e.target;
  if(t && t.matches && t.matches(AC_LOCK_INPUTS)){
    const sc=_acInputScope(t);
    if(sc && !_acMay(sc.func, sc.fac)){
      if(e.type==='mousedown' || e.type==='focusin'){ if(!t.readOnly){ t.readOnly=true; t.dataset.acro='1'; t.classList.add('ac-ro'); } }
      if(e.type==='keydown' && !/^(Tab|Arrow|Enter|Escape|Home|End|Page)/.test(e.key) && !(e.ctrlKey&&/^[ac]$/i.test(e.key))){ e.preventDefault(); const r=t.getBoundingClientRect(); _acLockTip(sc.func, sc.fac, {clientX:r.left, clientY:r.bottom-10}); }
      if(e.type==='paste' || e.type==='drop'){ e.preventDefault(); }
      if(e.type==='mousedown') _acLockTip(sc.func, sc.fac, e);
    }
    return;
  }
  if(e.type==='mousedown'){
    const g=t && t.closest && t.closest('.camp-grip');
    if(g){
      const gd=g.dataset, st=_CAMP_STORES[gd.store];
      const func=gd.store==='prod'||gd.store==='simprod'?'production':'logistics';
      let fac;
      if(st){ const c=(DB[st.key]||[]).find(x=>x.id===gd.camp); if(c){ const elFac=new Map((DB.elements||[]).map(x=>[x.id,_acElFacility(x,_acFacByName())])); fac=_acRowFacility(st.key, c, elFac)||undefined; } }
      if(!_acMay(func, fac)){ e.preventDefault(); e.stopImmediatePropagation(); _acLockTip(func, fac, e); }
    }
  }
}
['mousedown','focusin','keydown','paste','drop'].forEach(t=>document.addEventListener(t, _acBlockEvent, true));
new MutationObserver(()=>{ if(_acLockActive()||document.body.classList.contains('ac-locked-mode')) acScheduleSweep(); })
  .observe(document.documentElement, {childList:true, subtree:true});

// Layer 2 — guard the functions that open an editor or change data from a click.
// spec: [functionName, func, (args)=>facility|undefined]
const AC_GUARDS=[
  ['showInventoryPopup','inventory', a=>_acFacOfEl(a[0])],
  ['showCampaignPopup','production', a=>_acFacOfEl(a[0])],
  ['showRailCampaignPopup','logistics', a=>_acFacOfEl(a[0])],
  ['showTermRealPopup','real', a=>a[1]||undefined],
  ['showVesselCampaignPopup','logistics', a=>_acFacOfEl(a[0])],
  ['vpOpenArrivalDialog','logistics', a=>_acFacOfEl(a[0])],
  ['showSiloXferPopup','logistics', a=>{ const l=(DB.silo_links||[]).find(x=>x.id===a[0]); return _acFacOfEl(a[1]||(l&&(l.from_silo_id||l.from))); }],
  ['editVessel','logistics', a=>{ const v=(DB.vessel_calls||[])[a[0]]; return v?(v.facility_id||_acFacOfEl(v.berth_id)):undefined; }],
  ['editTransport','logistics', ()=>undefined],
  ['openMaintModal','production', a=>_acFacOfEl(a[0])],
  ['editMaintEvent','production', a=>{ const m=(DB.element_maintenance_events||[]).find(x=>x.id===a[0]); return m?_acFacOfEl(m.element_id):undefined; }],
  ['openMillPolicyManager','production', ()=>undefined],
  ['openNonWorkingDaysPanel','production', ()=>AC_NET],
  ['openDemandSwapManager','demand', a=>a[0]?_acFacOfEl(a[0]):undefined],
  ['openDemandBuilder','demand', a=>_acFacOfEl(a[0])],
  ['spSaveForecast','demand', ()=>undefined],
  ['_rollApplyHandoff','demand', ()=>undefined],
  ['submitRealData','real', ()=>S.realDataFacilityId, ()=>_acMay('inventory', S.realDataFacilityId)],
  ['dsRefreshSlot','real', ()=>undefined],
  ['dsAutoRefreshAll','real', ()=>undefined],
  ['dsApplyPendingUpdates','real', ()=>undefined],
  // Topology & setup
  ...['saveProps','saveFacility','deleteFacility','openAddFacilityModal','saveProduct','deleteProduct','editProduct','saveRawMat','deleteRawMat','saveFuel','deleteFuel',
      'confirmDeleteElement','executeDeleteElement','deleteSelectedEls','saveNewNode','saveLocNode','deleteLocNode','startAddNode','startRenameNode','saveRenameNode',
      'addDpProduct','removeDpProduct','moveDpProduct','addProductCap','removeProductCap','addSiloProduct','removeSiloProduct','deleteSiloLink','slStartPick',
      'autoLayout','clearCanvas','saveSimCfg','importJSON','addPlantCodeRow','removePlantCodeRow','addPackingLine','addRailDest','removeRailDest','_toggleAutoPropose',
      'addTopoLabel','addTopoLabelAtCenter','deleteTopoLabel','_tlSet']
     .map(n=>[n,'topology', ()=>undefined]),
];
function _acInstallGuards(){
  for(const [name, func, facOf, alsoOk] of AC_GUARDS){
    const orig=window[name];
    if(typeof orig!=='function' || orig._acGuarded) continue;
    const g=function(...args){
      if(_acLockActive()){
        let fac; try{ fac=facOf(args); }catch(e){ fac=undefined; }
        if(!_acMay(func, fac) && !(alsoOk && alsoOk(args))){ _acLockTip(func, fac, window.event); return; }
      }
      return orig.apply(this, args);
    };
    g._acGuarded=true;
    try{ window[name]=g; }catch(e){ console.warn('acGuard', name, e); }
  }
  // Topology canvas: element drags and tool changes (other than look-around tools).
  const st=window.setTool;
  if(typeof st==='function' && !st._acGuarded){
    const g=function(tool, ...rest){ if(_acLockActive() && !['select','pan'].includes(tool) && !_acMay('topology')){ _acLockTip('topology', undefined, window.event); return; } return st.call(this, tool, ...rest); };
    g._acGuarded=true; window.setTool=g;
  }
  const md=window.onElMD;
  if(typeof md==='function' && !md._acGuarded){
    const g=function(ev, id, ...rest){ if(_acLockActive() && !_acMay('topology', _acFacOfEl(id))){ return; } return md.call(this, ev, id, ...rest); };
    g._acGuarded=true; window.onElMD=g;
  }
}

// ═══ Guided welcome — first visit on a computer ═══
// Instead of "Choose a scenario → 📂 File… → dig for FLORIDA ROLL TREND.json", a newcomer gets:
//   Step 1  choose the shared SharePoint folder (any folder above the file works) — one
//           directory pick, one "Allow"; the app searches inside for the scenario file itself
//           (by name when the e-mail link carries it: #setpw=<email>&f=<file name>).
//   Step 2  set your password (from the e-mail link) — or sign in / request access.
// Shown when this browser has no scenarios yet, or the link names a file it does not know.
function _acHashParam(k){ const m=new RegExp('[#&]'+k+'=([^&]+)').exec(location.hash||''); return m?decodeURIComponent(m[1]):null; }
// Called by scInit. Returns true when the welcome screen took over from the scenario picker.
function acWelcome(){
  const email=_acHashEmail(), file=_acHashParam('f');
  const known=Object.values(SC.meta||{});
  if(known.length){
    if(!email) return false;                                        // returning user, no link → normal start
    if(!file || known.some(m=>String(m.fileName||'').toLowerCase()===file.toLowerCase())) return false; // already has that file
  }
  _acState={mode:'welcome', email:email||'', file:file||''};
  _acRenderGate();
  return true;
}
function _acWelcomeHTML(st){
  const e=_scEsc;
  const setpw=!!st.email;
  const step=(n,title,body,active,done)=>`<div class="ac-step ${active?'on':''} ${done?'done':''}"><div class="ac-step-n">${done?'✓':n}</div><div style="flex:1"><div class="ac-step-t">${title}</div>${body?`<div class="ac-step-b">${body}</div>`:''}</div></div>`;
  const where=st.file?`<b>${e(st.file)}</b>`:'the team\'s scenario file';
  const s1body=`Pick the SharePoint folder that holds ${where} — for example <b>Florida Logistics - _Inventory roll (Official)</b> in your CEMEX files. A folder higher up works too: the app searches inside it. When Chrome asks, choose <b>Edit files</b> / <b>Allow</b>.
    <div class="ac-row"><button class="sc-btn pri" id="ac-wf-btn" onclick="acWelcomePickFolder()">📁 Choose folder</button></div>
    <div class="ac-wf-msg" id="ac-wf-msg">${st.msg||''}</div>${st.list||''}`;
  return `<div class="ac-logo">AVILA <span>Roll</span></div>
    <div class="ac-h">Welcome${setpw?'':' to AVILA Roll'}</div>
    <div class="ac-sub">${setpw?`Hi <b>${e(st.email)}</b> — two quick steps and you are in.`:'Two quick steps to join your team\'s planning scenario.'}</div>
    <div class="ac-steps">
      ${step(1,'Open the shared folder', s1body, true, false)}
      ${step(2, setpw?'Set your password':'Sign in, or request access', setpw?'With the temporary password from your e-mail.':'The administrator gives you access and e-mails you a password.', false, false)}
    </div>
    <div class="ac-links">Other ways: <a onclick="acWelcomePickFile()">pick the file itself</a> · <a onclick="acWelcomeClassic()">scenarios on this computer / start a new one</a></div>`;
}
function acWelcomeClassic(){ _acState={mode:null}; _acCloseGate(); scOpenStartup(!Object.keys(SC.meta||{}).length); }
async function acWelcomePickFile(){ _acState={mode:'wait'}; _acCloseGate(); await scOpenFile(); if(!window._scLoadedId) acWelcome() || (_acState={mode:'welcome',email:_acHashEmail()||'',file:_acHashParam('f')||''}, _acRenderGate()); }
function _acWelcomeMsg(html, list){ _acState.msg=html; if(list!==undefined) _acState.list=list; const m=document.getElementById('ac-wf-msg'); if(m) m.innerHTML=html; if(list!==undefined) _acRenderGate(); }
// Breadth-first search inside the picked folder. With a file name: the shallowest exact match
// (backup folders skipped). Without: every .json that looks like an Avila Roll scenario
// (snapshots, OneDrive conflict copies and "(1)" duplicates left out).
async function _acFindScenarioFiles(dir, want){
  const wantL=want?want.toLowerCase():null, hits=[]; let n=0;
  const queue=[{h:dir, path:dir.name, depth:0}];
  while(queue.length && n<4000){
    const {h,path,depth}=queue.shift(); n++;
    if(n%20===0) _acWelcomeMsg(`Searching… ${n} folders looked at`);
    try{
      for await (const [name,ch] of h.entries()){
        if(ch.kind==='directory'){
          if(depth<8 && !/^\.|^backup|^archive|^node_modules$/i.test(name)) queue.push({h:ch, path:path+' › '+name, depth:depth+1});
        }else if(/\.json$/i.test(name)){
          if(wantL){ if(name.toLowerCase()===wantL) return {hits:[{h:ch, path, name}], n}; }
          else if(!/__sc_|-CMX-|-FanoPrivate|\(\d+\)\.json$|avila_demand|avila_sales|rules/i.test(name)) hits.push({h:ch, path, name});
        }
      }
    }catch(e){ /* unreadable folder — skip */ }
  }
  if(!wantL){
    // keep only files that really are scenarios (payload starts with {"DB") — first 40 checked
    const ok=[];
    for(const x of hits.slice(0,40)){ try{ const f=await x.h.getFile(); if(/^\s*\{\s*"DB"/.test(await f.slice(0,64).text())) ok.push(x); }catch(e){} }
    return {hits:ok, n};
  }
  return {hits, n};
}
async function acWelcomePickFolder(){
  if(!window.showDirectoryPicker){ _acWelcomeMsg('This browser cannot open folders — please use <b>Chrome</b> or <b>Edge</b>.'); return; }
  let dir;
  try{ dir=await window.showDirectoryPicker({id:'avila-welcome', mode:'readwrite'}); }
  catch(e){ if(e && e.name!=='AbortError') _acWelcomeMsg('Could not open that folder ('+_scEsc(e.message||e.name)+'). Try the folder one level down.'); return; }
  const btn=document.getElementById('ac-wf-btn'); if(btn) btn.disabled=true;
  _acWelcomeMsg('Searching…');
  const want=_acState.file||null;
  const {hits, n}=await _acFindScenarioFiles(dir, want);
  if(btn) btn.disabled=false;
  if(!hits.length){
    _acWelcomeMsg(want
      ? `<b>${_scEsc(want)}</b> is not inside <b>${_scEsc(dir.name)}</b> (${n} folders searched). Choose the Florida Logistics folder, or one above it.`
      : `No scenario file found inside <b>${_scEsc(dir.name)}</b> (${n} folders searched). Choose the folder your administrator told you about.`, '');
    return;
  }
  if(hits.length===1) return _acWelcomeUse(hits[0]);
  window._acWfHits=hits;
  _acWelcomeMsg(`Found ${hits.length} scenario files — which one?`,
    `<div class="ac-wf-list">${hits.map((x,i)=>`<div class="sc-card" onclick="_acWelcomeUse(window._acWfHits[${i}])"><div style="flex:1;min-width:0"><div class="sc-t">${_scEsc(x.name.replace(/\.json$/i,''))}</div><div class="sc-s">${_scEsc(x.path)}</div></div></div>`).join('')}</div>`);
}
async function _acWelcomeUse(hit){
  _acWelcomeMsg(`Opening <b>${_scEsc(hit.name)}</b>…`, '');
  const ok=await scOpenHandle(hit.h);
  if(!ok || !window._scLoadedId){ _acState.mode='welcome'; _acWelcomeMsg(`Could not open <b>${_scEsc(hit.name)}</b> — try again, or pick the file itself.`); return; }
  // scOpenHandle → scLoadScenario → scAfterLoad → acGate decides: set password / sign in / (sign-in off) straight in.
}

// ═══════════════════════════════════════════════════════════════════════
// TOPOLOGY SEAL — the administrator's topology always prevails.
// Once sign-in is on, the scenario file carries `topoSeal` = {at, by, tables}: the topology
// exactly as the administrator last saved it. Every save from every browser (running this
// version) writes the seal's tables as the topology — whatever an old tab, an out-of-date copy
// or an older app version put there is replaced within one sync (~30 s), and the seal itself
// only moves forward (newest `at` wins; only an administrator's save creates a newer one, by
// applying just the rows that administrator changed onto the newest seal).
// Someone who is not an administrator but has "Modify" on Topology & setup: their topology
// edits do not go in — they become a change request (DB.change_requests) the administrator
// accepts or rejects in 👥 Users & access.
// ═══════════════════════════════════════════════════════════════════════
const TOPO_TABLES=['macro_regions','countries','regions','sub_regions','facilities','elements','connections','products','recipes',
  'raw_materials','fuels','element_product_capacities','element_raw_meal_recipes','silo_links','demand_points','simulation_rules'];
function _tsNewest(...seals){
  return seals.filter(s=>s && s.at && s.tables).sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0]||null;
}
function _tsTables(p){ const o={}; for(const t of TOPO_TABLES){ const v=p&&p.DB?p.DB[t]:undefined; if(Array.isArray(v)) o[t]=v; } return o; }
// Row-level topology changes base → ours: [{t,k,before,after}] (null = absent).
function _tsTopoDiff(base, ours){
  const ch=[];
  for(const t of TOPO_TABLES){
    const oa=ours&&ours.DB?ours.DB[t]:undefined; if(!Array.isArray(oa)) continue;
    const ba=base&&base.DB&&Array.isArray(base.DB[t])?base.DB[t]:[];
    const bm=new Map(); for(const r of ba) bm.set(_mgRowKey(t,r), r);
    const om=new Map(); for(const r of oa) om.set(_mgRowKey(t,r), r);
    for(const [k,o] of om){ const b=bm.get(k); if(b===undefined || _mgStr(b)!==_mgStr(o)) ch.push({t, k, before:b===undefined?null:b, after:o}); }
    for(const [k,b] of bm) if(!om.has(k)) ch.push({t, k, before:b, after:null});
  }
  return ch;
}
// Apply row changes onto a copy of the seal's tables.
function _tsApply(tables, changes){
  const out={}; for(const t of TOPO_TABLES) if(Array.isArray(tables[t])) out[t]=tables[t].slice();
  const byT={}; for(const c of changes) (byT[c.t]=byT[c.t]||[]).push(c);
  for(const t of Object.keys(byT)){
    const arr=out[t]||[], idx=new Map(); arr.forEach((r,i)=>idx.set(_mgRowKey(t,r), i));
    const del=new Set();
    for(const c of byT[t]){
      const i=idx.get(c.k);
      if(c.after===null){ if(i!==undefined) del.add(i); }
      else if(i!==undefined) arr[i]=c.after;
      else { idx.set(c.k, arr.length); arr.push(c.after); }
    }
    out[t]=arr.filter((_,i)=>!del.has(i));
  }
  return out;
}
function _tsSame(a, b){ for(const t of TOPO_TABLES){ if(_mgStr(a[t]||[])!==_mgStr(b[t]||[])) return false; } return true; }
function _tsLabel(c){
  const r=c.after||c.before||{};
  const kind=c.before===null?'Add':c.after===null?'Remove':'Change';
  const what={elements:(r.type||'element').replace(/_/g,' '), connections:'connection', facilities:'facility', products:'product', demand_points:'demand-point product', silo_links:'silo link', recipes:'recipe'}[c.t]||c.t.replace(/_/g,' ');
  let name=r.name||r.id||'';
  if(c.t==='connections'){ const el=id=>{ const e=(DB.elements||[]).find(x=>x.id===id); return e?e.name:id; }; name=el(r.from_element_id||r.from)+' → '+el(r.to_element_id||r.to); }
  let fields='';
  if(c.before && c.after){
    const ks=[...new Set([...Object.keys(c.before), ...Object.keys(c.after)])].filter(k=>_mgStr(c.before[k])!==_mgStr(c.after[k]));
    const simple=v=>v==null||typeof v!=='object';
    const show=ks.filter(k=>k!=='x'&&k!=='y').slice(0,3).map(k=>simple(c.before[k])&&simple(c.after[k])?`${k}: ${String(c.before[k]??'—')} → ${String(c.after[k]??'—')}`:k);
    fields=ks.every(k=>k==='x'||k==='y')?' (moved on the canvas)':' ('+show.join('; ')+(ks.length>3?'; …':'')+')';
  }
  return `${kind} ${what} <b>${_scEsc(String(name))}</b>${_scEsc(fields)}`;
}
// Called inside _mgSync after the permission check. Returns {ours, seal, request}.
function _tsPrepare(base, ours, theirs){
  const on=typeof _acEnabledDB==='function' && (_acEnabledDB(base.DB)||_acEnabledDB(ours.DB)||_acEnabledDB(theirs.DB));
  if(!on) return {ours, seal:null, request:null};
  let seal=_tsNewest(base.topoSeal, ours.topoSeal, theirs.topoSeal, window._scTopoSeal);
  const tch=_tsTopoDiff(base, ours);
  let request=null;
  if(_acIsAdmin()){
    if(tch.length && seal) seal={at:new Date().toISOString(), by:_acUser.id, tables:_tsApply(seal.tables, tch)};
    else if(!seal) seal={at:new Date().toISOString(), by:_acUser.id, tables:_tsTables(ours)};   // first seal: what the administrator sees now
  }else if(tch.length && _acUser && seal){
    request={id:'cr_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5), area:'topology', by:_acUser.id, name:_acUser.name||_acUser.email,
      at:new Date().toISOString(), status:'pending', items:tch};
  }
  if(!seal) return {ours, seal:null, request:null};
  // Everyone's copy of the topology becomes the seal's before anything is recorded or merged.
  ours=Object.assign({}, ours, {DB:Object.assign({}, ours.DB, seal.tables), topoSeal:seal});
  return {ours, seal, request};
}
// After the merge: the written topology is exactly the seal; say whether that changed the file
// (needWrite) or what is on screen (applied like a pull).
function _tsFinish(res, seal, request, oursBefore, theirs){
  if(!seal) return;
  Object.assign(res.payload.DB, seal.tables);
  res.payload.topoSeal=seal;
  window._scTopoSeal=seal;
  if(!theirs.topoSeal || theirs.topoSeal.at!==seal.at || !_tsSame(_tsTables(theirs), seal.tables)) res.needWrite=true;
  if(!_tsSame(_tsTables(oursBefore), seal.tables)){ res.remoteApplied=(res.remoteApplied||0)+1; res.topoRestored=true; }
  if(request){
    res.payload.DB.change_requests=(res.payload.DB.change_requests||[]).concat([request]);
    res.needWrite=true; res.remoteApplied=(res.remoteApplied||0)+1;
    setTimeout(()=>_acBanner(`Your topology change (${request.items.length} item${request.items.length>1?'s':''}) was <b>sent to the administrator for approval</b>. It will appear once accepted.`, 'ok'), 0);
  }
}

// ── Administrator: pending topology requests ──
function _tsPending(){ return (DB.change_requests||[]).filter(r=>r && r.status==='pending'); }
function _tsRequestsHTML(){
  const req=_tsPending(); if(!req.length) return '';
  return `<div class="ac-sec">TOPOLOGY CHANGE REQUESTS <span class="ac-badge">${req.length}</span></div>`+req.map(r=>{
    const cur=_tsTables({DB});
    const items=r.items.map((c,i)=>{
      const arr=cur[c.t]||[], now=arr.find(x=>_mgRowKey(c.t,x)===c.k);
      const moved=_mgStr(now===undefined?null:now)!==_mgStr(c.before);
      return `<div class="ac-dim" style="font-size:10px;color:var(--text)">• ${_tsLabel(c)}${moved?' <span style="color:var(--amber)">— changed since the request</span>':''}</div>`;
    }).join('');
    return `<div class="ac-li" style="align-items:flex-start"><div style="flex:1"><b>${_scEsc(r.name||r.by)}</b> · ${new Date(r.at).toLocaleString()}${items}</div>
      <button class="btn-pri" onclick="tsAcceptRequest('${_scEsc(r.id)}')">Accept</button><button class="btn-sec" onclick="tsRejectRequest('${_scEsc(r.id)}')">Reject</button></div>`;
  }).join('');
}
function tsAcceptRequest(id){
  if(!_acIsAdmin()) return;
  const r=(DB.change_requests||[]).find(x=>x.id===id); if(!r) return;
  // New elements created on another computer may reuse an id that exists here — give them a new one.
  let items=r.items;
  const taken=new Set((DB.elements||[]).map(e=>e.id));
  const clash=items.filter(c=>c.t==='elements' && c.before===null && c.after && taken.has(c.after.id)).map(c=>c.after.id);
  if(clash.length){
    let txt=JSON.stringify(items);
    for(const old of clash){ if(typeof syncElCounter==='function') syncElCounter(); const nid='el_'+(++S.elCounter);
      txt=txt.split('"'+old+'"').join('"'+nid+'"').split('"dp_el_'+old+'"').join('"dp_el_'+nid+'"'); }
    items=JSON.parse(txt);
  }
  const t=_tsApply(_tsTables({DB}), items.map(c=>Object.assign({}, c, {k:c.after?_mgRowKey(c.t,c.after):c.k})));
  Object.assign(DB, t);
  if(typeof syncElCounter==='function') syncElCounter();
  DB.change_requests=DB.change_requests.map(x=>x.id===id?Object.assign({}, x, {status:'accepted', handled_by:_acUser.id, handled_at:new Date().toISOString()}):x);
  if(typeof _demandCacheInvalidate==='function') _demandCacheInvalidate();
  autoSave(); scWriteActive(SC.activeId);
  try{ _acRerender(); if(typeof renderDtree==='function') renderDtree(S.simResults); }catch(e){}
  statMsg('Topology change accepted');
  acOpenUsersPanel();
}
function tsRejectRequest(id){
  if(!_acIsAdmin()) return;
  DB.change_requests=(DB.change_requests||[]).map(x=>x.id===id?Object.assign({}, x, {status:'rejected', handled_by:_acUser.id, handled_at:new Date().toISOString()}):x);
  autoSave(); scWriteActive(SC.activeId); acOpenUsersPanel();
}
// 🕒 History: bring back only the topology of a saved version (administrator).
async function scRestoreTopologySnapshot(id, name){
  if(_acEnabledDB() && !_acIsAdmin()){ statMsg('Only the administrator can restore the topology.'); return; }
  const dir=await scEnsureHistoryDir(id,false); if(!dir) return;
  if(!confirm('Restore ONLY the topology (facilities, equipment, silos, demand points, connections, products) from this saved version?\n\nDemand, inventory, plans and real values stay as they are now.')) return;
  try{
    await scWriteSnapshot(id, JSON.stringify(scBuildPayload()), 'pre-restore');
    const payload=JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
    if(!payload || !payload.DB) throw new Error('not a valid scenario snapshot');
    const t=_scApplyTopologyTables(payload);
    await scManualSave();
    closeModal(); _acRerender(); if(typeof renderLocationTree==='function') renderLocationTree(); if(typeof updateNavFacilities==='function') updateNavFacilities();
    statMsg('Topology restored ✓ — '+t.elements.length+' elements from '+name);
  }catch(e){ statMsg('Topology restore failed — '+e.message); console.warn('topology restore', e); }
}

