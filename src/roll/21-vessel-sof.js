// ════════════════════════════════════════════════════════════════
// VESSEL SOF — Statement of Facts, laytime & demurrage
// ════════════════════════════════════════════════════════════════
// One DB.vessel_sof row per SOF PDF, i.e. per port of call (a split vessel has one per leg):
//   { id, vessel_call_id, leg_id ('' = single-port call), facility_id, berth_element_id,
//     pdf_file, uploaded_at, uploaded_by, read_by ('claude-…' | 'manual'), read_at,
//     status:'draft'|'reviewed', header:{vessel_name, imo, voyage, master, flag, commodity,
//     load_port, discharge_port, berth, agency, agency_file, cargo_t}, remarks, flags:[text],
//     milestones:[{at, kind, label}], laytime_start, laytime_end ('' = default),
//     periods:[{id, start, end, category, cause, hold, description, notes, counts:'auto'|'Y'|'N', reason}] }
// The PDF itself is archived in the SOF folder (Configuration → Data Sources); the row keeps its
// file name. Times are the port's clock as written, 'YYYY-MM-DDTHH:MM' — durations are real
// elapsed time, so a period across a daylight-saving change is an hour shorter/longer than
// the clock difference.
// Laytime terms live on the vessel call (dem_rate_usd_day, despatch_rate_usd_day,
// discharge_rate_tpd, nor_notice_h). Allowed laytime is calculated: tonnes to discharge ÷
// contracted discharge rate × 24 h, the tonnes per port being the SOF's stated cargo, else the
// planned quantity (older calls may still carry a typed laytime_allowed_h, used only when no
// discharge rate is entered). Laytime is counted for the whole voyage: every leg's
// periods in time order. Default counting (any period can be set to Y/N by hand):
//   caused by the vessel → never counts; weather → doesn't count while laytime remains, counts
//   once the vessel is on demurrage; everything else counts.
const SOF_MODEL='claude-opus-5-5';
const SOF_CATEGORIES=['Arrival / NOR','Waiting at anchor','Berthing / unberthing','Formalities & survey','Discharging',
  'Shore delay','Weather delay','Ship delay','Equipment repositioning','Hold cleaning','Loader in hold','Idle / unexplained','Post-discharge'];
const SOF_CAUSES=[{id:'none',label:'Normal operation'},{id:'terminal',label:'Terminal / receiver'},{id:'weather',label:'Weather'},{id:'vessel',label:'Vessel'}];
const SOF_CAUSE_OF_CAT={'Ship delay':'vessel','Weather delay':'weather','Shore delay':'terminal','Loader in hold':'terminal','Waiting at anchor':'terminal'};
const SOF_MILESTONES=[
  ['eosp','End of sea passage'],['nor_tendered','NOR tendered'],['nor_retendered','NOR re-tendered'],['anchored','Anchored'],
  ['anchor_up','Anchor up'],['pilot_on','Pilot on board'],['all_fast','All fast'],['gangway_down','Gangway down'],
  ['commenced','Discharge commenced'],['completed','Discharge completed'],['draft_survey','Draft survey'],
  ['last_line','Last line away'],['bosp','Beginning of sea passage'],['other','Other']];

const SOF_SYSTEM=`You read a Statement of Facts (SOF): the port agent's hour-by-hour log of one vessel's call at a discharge port, signed by the Master and the agent. The team uses your output to work out laytime and demurrage with the vessel owner, so it must be faithful to the document. Every agency uses its own layout; the document may be a scan, partly handwritten.

Return JSON that matches the schema.

header — the vessel and voyage particulars as printed. Use "" for anything the SOF does not state. cargo_t is the quantity discharged in metric tonnes if the SOF states one, else "".

milestones — every point-in-time event, in time order (end of sea passage, NOR tendered and every NOR re-tendering, anchored, anchor up, pilot on board, all fast, gangway down, discharge commenced, discharge completed, draft survey, last line, beginning of sea passage, and anything else notable). kind is the closest match; label is the SOF wording.

periods — the time accounting: contiguous periods that cover the call from its first logged event (normally end of sea passage) to its last (normally beginning of sea passage) with no gaps and no overlaps, each period's end equal to the next period's start.
- A line with a start and an end time is a period. A line with only a time runs until the next logged event when it changes what the vessel is doing (e.g. "Anchor up", "Pilot on board", "Moving to hold 2").
- Merge consecutive lines of the same activity that the SOF only splits at midnight or day by day (e.g. "Anchored, awaiting berth" every day for two weeks is ONE period). Do not merge across a different activity.
- If the SOF leaves time unaccounted for, add a period with category "Idle / unexplained" and mention it in flags.
- category: one of the listed categories. Moving the unloader or crew between holds is "Equipment repositioning"; sweeping or cleaning holds is "Hold cleaning"; a front-end loader working inside a hold is "Loader in hold"; from discharge completed to last line away is "Post-discharge".
- cause: "vessel" for anything the vessel, its crew or its gear caused (ship delay, crew medical emergency, ship's crane in the way); "weather" for rain, wind, swell, lightning; "terminal" for shore delays (shore equipment maintenance, switching silos, pipeline work, stevedores, a loader in the hold) and for waiting at anchor because the berth is not available; "none" for normal operation (sea passage, NOR, berthing, formalities, discharging, moving between holds, cleaning, post-discharge).
- hold: the hold number when the SOF names one, else "".
- description: what happened, short; notes: the SOF's notes or remarks for that line, verbatim; "" if none.

Times: 'YYYY-MM-DDTHH:MM', 24-hour, the port's local clock exactly as written. "2400" is 00:00 of the next day. Never invent a time: if a time is unreadable, use your best reading and say so in flags.

remarks — the Master's remarks and any other remarks or holiday notes, transcribed.

flags — short notes the team should check: conflicting accounts (e.g. the table and the Master's remarks blame different parties for the same stop), unexplained gaps, NORs tendered "without prejudice", unreadable entries, a daylight-saving change during the call, anything that affects who is responsible for lost time.`;

const SOF_SCHEMA=(()=>{
  const str={type:'string'};
  const obj=(props)=>({type:'object',additionalProperties:false,required:Object.keys(props),properties:props});
  return obj({
    header:obj({vessel_name:str, imo:str, voyage:str, master:str, flag:str, commodity:str, load_port:str,
      discharge_port:str, berth:str, agency:str, agency_file:str, cargo_t:str}),
    milestones:{type:'array',items:obj({at:str, kind:{type:'string',enum:SOF_MILESTONES.map(m=>m[0])}, label:str})},
    periods:{type:'array',items:obj({start:str, end:str, category:{type:'string',enum:SOF_CATEGORIES},
      cause:{type:'string',enum:SOF_CAUSES.map(c=>c.id)}, hold:str, description:str, notes:str})},
    remarks:str,
    flags:{type:'array',items:str}
  });
})();

// ── time helpers (local port clock 'YYYY-MM-DDTHH:MM') ──
function _sofT(s){ if(!s||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return NaN; return new Date(String(s).slice(0,16)).getTime(); }
function _sofIso(ms){ if(!isFinite(ms)) return ''; const d=new Date(ms), p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function _sofH(h){ if(h==null||!isFinite(h)) return '—'; const m=Math.round(h*60); return `${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`; }
function _sofNum(v){ const n=parseFloat(v); return isFinite(n)?n:null; }
function _sofMoney(x){ return x==null||!isFinite(x)?'—':'$'+Math.round(x).toLocaleString(); }
function _sofId(p){ return p+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

// ── which ports of call a vessel has, and their SOF rows ──
function _sofStops(v){
  if(v.legs&&v.legs.length) return v.legs.map((l,li)=>({li, leg:l, legId:l.id||'', berthId:l.berth_element_id, date:l.arrival_date, label:`Leg ${li+1}`}));
  return [{li:-1, leg:null, legId:'', berthId:v.berth_element_id, date:v.arrival_date, label:''}];
}
function _sofOf(callId, legId){ return (DB.vessel_sof||[]).find(s=>s.vessel_call_id===callId && (s.leg_id||'')===(legId||'')); }
function _sofBerth(id){ return (DB.elements||[]).find(e=>e.id===id); }
function _sofFacOfBerth(id){ const b=_sofBerth(id); return b?(b.assigned_facility_id||b.facility_id||''):''; }
function _sofFacName(id){ const f=(DB.facilities||[]).find(x=>x.id===id); return f?(f.name||f.id):''; }

// Laytime window of one SOF: starts at the first NOR + notice time, ends when discharge is
// completed — either can be typed over on the SOF window.
function sofWindow(s, noticeH){
  const ms=s.milestones||[], per=(s.periods||[]).slice().sort((a,b)=>_sofT(a.start)-_sofT(b.start));
  const at=(kind,pick)=>{ const t=ms.filter(m=>m.kind===kind).map(m=>_sofT(m.at)).filter(isFinite); return t.length?Math[pick](...t):NaN; };
  let a=_sofT(s.laytime_start), b=_sofT(s.laytime_end), aWhy='set by hand', bWhy='set by hand';
  if(!isFinite(a)){
    const nor=at('nor_tendered','min');
    if(isFinite(nor)){ a=nor+noticeH*36e5; aWhy=`first NOR + ${noticeH} h notice`; }
    else { a=per.length?_sofT(per[0].start):NaN; aWhy='first SOF entry (no NOR found)'; }
  }
  if(!isFinite(b)){
    const done=at('completed','max');
    if(isFinite(done)){ b=done; bWhy='discharge completed'; }
    else { const dis=per.filter(p=>p.category==='Discharging'); b=dis.length?_sofT(dis[dis.length-1].end):(per.length?_sofT(per[per.length-1].end):NaN); bWhy=dis.length?'last discharging period':'last SOF entry'; }
  }
  return {a, b, aWhy, bWhy};
}

// The laytime statement for one vessel call (the whole voyage). Pure — reads DB, changes nothing.
// `override` = a working copy of one SOF (the window being edited) used in place of the saved one.
function sofLaytime(v, override){
  let rows=(DB.vessel_sof||[]).filter(s=>s.vessel_call_id===v.id);
  if(override){ rows=rows.filter(s=>s.id!==override.id); rows.push(override); }
  const noticeRaw=_sofNum(v.nor_notice_h), notice=noticeRaw==null?6:noticeRaw;
  const al=sofAllowed(v, rows), allowed=al.allowed, hasAllowed=allowed!=null&&allowed>0;
  const rate=_sofNum(v.dem_rate_usd_day)||0, despRate=_sofNum(v.despatch_rate_usd_day)||0;
  const win={}; rows.forEach(s=>{ win[s.id]=sofWindow(s, notice); });
  const items=[];
  rows.forEach(s=>(s.periods||[]).forEach(p=>items.push({s, p, a:_sofT(p.start), b:_sofT(p.end)})));
  items.sort((x,y)=>(x.a-y.a)||(x.b-y.b));
  let used=0;
  const per={}, byCat={}, byCause={};
  items.forEach(({s,p,a,b})=>{
    const w=win[s.id], res={h:0, lay:0, dem:0, counted:false, why:''};
    per[p.id]=res;
    if(!(b>a)){ res.why='no duration'; return; }
    res.h=(b-a)/36e5;
    byCat[p.category]=(byCat[p.category]||0)+res.h;
    byCause[p.cause||'none']=(byCause[p.cause||'none']||0)+res.h;
    const ca=Math.max(a,w.a), cb=Math.min(b,w.b), h=cb>ca?(cb-ca)/36e5:0;
    if(h<=0){ res.why=a<w.a?'before laytime starts':'after laytime ends'; return; }
    const onDem=hasAllowed&&used>=allowed-1e-9;
    let counts;
    res.ruleCounted=p.cause==='vessel'?false:p.cause==='weather'?onDem:true;
    if(p.counts==='Y'){ counts=true; res.why='counts (set by hand)'; }
    else if(p.counts==='N'){ counts=false; res.why='does not count (set by hand)'; }
    else if(p.cause==='vessel'){ counts=false; res.why='caused by the vessel'; }
    else if(p.cause==='weather'){ counts=onDem; res.why=onDem?'weather while on demurrage':'weather within laytime'; }
    else { counts=true; res.why=h<res.h-1e-9?'counts (part inside laytime)':'counts'; }
    if(!counts) return;
    res.counted=true;
    if(hasAllowed){ const lay=Math.max(0, Math.min(h, allowed-used)); res.lay=lay; res.dem=h-lay; }
    else res.lay=h;
    used+=h;
  });
  const stops=_sofStops(v);
  const complete=stops.every(st=>rows.some(s=>(s.leg_id||'')===(st.legId||'')));
  const demH=hasAllowed?Math.max(0,used-allowed):0;
  const despH=hasAllowed&&complete?Math.max(0,allowed-used):0;
  return {rows, win, per, used, allowed:hasAllowed?allowed:null, allowedWhy:al.why, dischRate:al.rate, qty:al.qty, notice, rate, despRate, demH, despH,
    demUsd:demH/24*rate, despUsd:despRate?despH/24*despRate:0, complete, nStops:stops.length, nSofs:rows.length,
    byCat, byCause, reviewed:rows.length>0&&rows.every(s=>s.status==='reviewed')};
}

// Allowed laytime for the voyage = tonnes to discharge (all ports) ÷ discharge rate × 24 h.
function sofAllowed(v, rows){
  rows=rows||(DB.vessel_sof||[]).filter(s=>s.vessel_call_id===v.id);
  const rate=_sofNum(v.discharge_rate_tpd);
  let qty=0, fromSof=0, fromPlan=0;
  _sofStops(v).forEach(st=>{
    const s=rows.find(r=>(r.leg_id||'')===(st.legId||''));
    const sq=s?_sofNum(String((s.header||{}).cargo_t||'').replace(/[, ]/g,'')):null;
    const pq=st.leg?_sofNum(st.leg.quantity_t):_sofNum(v.quantity_t||v.total_quantity_t);
    if(sq>0){ qty+=sq; fromSof++; } else if(pq>0){ qty+=pq; fromPlan++; }
  });
  const src=fromSof&&fromPlan?'SOF + planned tonnes':fromSof?'SOF cargo':'planned tonnes';
  if(rate>0&&qty>0) return {allowed:qty/rate*24, rate, qty, why:`${Math.round(qty).toLocaleString()} t (${src}) ÷ ${rate.toLocaleString()} t/day × 24 h`};
  const old=_sofNum(v.laytime_allowed_h);
  if(old>0) return {allowed:old, rate:null, qty, why:'typed on the vessel call (no discharge rate entered)'};
  return {allowed:null, rate:rate>0?rate:null, qty, why:rate>0?'no tonnes to discharge on the call or the SOF':''};
}

// Contiguity check — gap / overlap against the previous period of the same SOF.
function _sofCheck(periods){
  const out={};
  const sorted=periods.map((p,i)=>({p,i,a:_sofT(p.start),b:_sofT(p.end)})).sort((x,y)=>x.a-y.a);
  for(let k=0;k<sorted.length;k++){
    const c=sorted[k];
    if(!isFinite(c.a)||!isFinite(c.b)){ out[c.p.id]='missing time'; continue; }
    if(c.b<c.a){ out[c.p.id]='ends before it starts'; continue; }
    if(k>0&&isFinite(sorted[k-1].b)){
      const d=(c.a-sorted[k-1].b)/36e5;
      if(d>1/60) out[c.p.id]=`gap of ${_sofH(d)} before it`;
      else if(d<-1/60) out[c.p.id]=`overlaps the previous period by ${_sofH(-d)}`;
    }
  }
  return out;
}

// ── row badge on the vessel schedule ──
function sofBadgeHTML(v, li){
  const stops=_sofStops(v);
  if(li===undefined && stops.length>1){
    // a split vessel has one SOF per port: the parent row shows how many are in and opens the legs
    const n=stops.filter(st=>st.legId&&_sofOf(v.id,st.legId)).length;
    return `<span class="tbl-act sof-act ${n===stops.length?'ok':n?'draft':''}" onclick="sofShowLegs('${v.id}')" title="One SOF per port — ${n} of ${stops.length} on file. Click to show the legs, then use SOF on each.">SOF ${n}/${stops.length}</span>`;
  }
  const st=li===undefined?stops[0]:stops.find(x=>x.li===li);
  const s=st&&(st.legId||st.li<0)?_sofOf(v.id,st.legId):null;   // a leg without an id has no SOF yet
  const lt=s?sofLaytime(v):null;
  const tip=s?`SOF ${s.status==='reviewed'?'reviewed':'draft'}${lt&&lt.demH>0?` — ${_sofH(lt.demH)} on demurrage (${_sofMoney(lt.demUsd)})`:''}`:'Upload the Statement of Facts PDF';
  const cls=s?(s.status==='reviewed'?'ok':'draft'):'';
  return `<span class="tbl-act sof-act ${cls}" onclick="sofOpen('${v.id}',${st?st.li:-1})" title="${esc(tip)}">${s?(s.status==='reviewed'?'✓ SOF':'✎ SOF'):'SOF'}</span>`;
}

function sofShowLegs(callId){ if(!window._vcExpanded) window._vcExpanded=new Set(); window._vcExpanded.add(callId); renderVesselTable(); }

// ── the SOF window ──
// window._sof = { callId, li, legId, rec (working copy), file (picked PDF, this session only),
//                 dirty, busy, msg, ro, pdfSaved }
function sofOpen(callId, li){
  const v=(DB.vessel_calls||[]).find(x=>x.id===callId); if(!v) return;
  // a split vessel's leg gets a stable id the first time its SOF window opens (saved with the next change)
  if(li>=0&&v.legs&&v.legs[li]&&!v.legs[li].id) v.legs[li].id=_sofId('vl');
  const st=_sofStops(v).find(x=>x.li===li)||_sofStops(v)[0];
  const fac=_sofFacOfBerth(st.berthId)||v.facility_id||'';
  const saved=_sofOf(callId, st.legId);
  window._sof={callId, li:st.li, legId:st.legId, fac,
    rec:saved?JSON.parse(JSON.stringify(saved)):null, file:null, dirty:false, busy:false, msg:'',
    ro:(typeof _acMay==='function')&&!_acMay('logistics', fac||undefined), pdfSaved:!!(saved&&saved.pdf_file)};
  showModal('_custom');
  document.getElementById('modal-content').classList.add('sof-wide');
  sofRender();
}
function sofClose(force){
  const s=window._sof;
  if(!force&&s&&s.dirty&&!confirm('Close without saving your changes to this SOF?')) return;
  if(s&&s.abort) try{ s.abort.abort(); }catch(e){}
  window._sof=null;
  document.getElementById('modal-content')?.classList.remove('sof-wide');
  closeModal();
}
function _sofCtx(){
  const s=window._sof; if(!s) return null;
  const v=(DB.vessel_calls||[]).find(x=>x.id===s.callId); if(!v) return null;
  const st=_sofStops(v).find(x=>x.li===s.li)||_sofStops(v)[0];
  const berth=_sofBerth(st.berthId);
  return {s, v, st, berth};
}
function _sofNewRec(c){
  return {id:_sofId('sof'), vessel_call_id:c.v.id, leg_id:c.s.legId||'', facility_id:c.s.fac, berth_element_id:c.st.berthId||'',
    pdf_file:'', uploaded_at:'', uploaded_by:'', read_by:'', read_at:'', status:'draft',
    header:{vessel_name:c.v.name||'', imo:'', voyage:'', master:'', flag:'', commodity:'', load_port:'', discharge_port:'', berth:c.berth?.name||'', agency:'', agency_file:'', cargo_t:''},
    remarks:'', flags:[], milestones:[], laytime_start:'', laytime_end:'', periods:[]};
}
function _sofWho(){ try{ return (typeof _acUser!=='undefined'&&_acUser&&(_acUser.name||_acUser.id))||localStorage.getItem('avila_device_name')||''; }catch(e){ return ''; } }

function sofRender(){
  const c=_sofCtx(); if(!c){ return; }
  const {s,v,st,berth}=c, rec=s.rec, ro=s.ro;
  const title=`${esc(v.name||'Vessel')}${st.label?' · '+st.label:''} · ${esc(berth?.name||'—')}${st.date?' · arrival '+esc(st.date):''}`;
  const lt=rec?sofLaytime(v, rec):null;
  const chk=rec?_sofCheck(rec.periods||[]):{};
  const sel=(opts,val,on,dis)=>`<select ${dis} onchange="${on}">${opts.map(o=>`<option value="${esc(o[0])}" ${o[0]===val?'selected':''}>${esc(o[1])}</option>`).join('')}</select>`;
  const dis=ro?'disabled':'';

  // source strip: upload / file on record / reading progress
  const src = !rec ? `
    <div class="sof-drop" id="sof-drop" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="sofDrop(event)">
      ${ro?'🔒 Read-only — no SOF on file for this port yet.':`
      <div style="font-size:11px;color:var(--text);margin-bottom:6px">Drop the Statement of Facts PDF here</div>
      <button class="tb-btn amber" onclick="document.getElementById('sof-file').click()">📄 Choose PDF…</button>
      <input type="file" id="sof-file" accept="application/pdf,.pdf" style="display:none" onchange="sofPicked(this.files[0])">
      <div style="margin-top:8px">${getApiKey()?`Claude reads it into the table below — you check every line before saving.`:
        `No Claude API key in this browser, so the PDF is filed but not read — add a key in Configuration → AI, or <span class="tbl-act" onclick="sofManual()">type the periods in by hand</span>.`}</div>`}
    </div>` : `
    <div class="sof-src">
      <span>📄 ${rec.pdf_file?esc(rec.pdf_file):(s.file?esc(s.file.name):'no PDF on file')}</span>
      ${rec.pdf_file||s.file?`<span class="tbl-act" onclick="sofViewPdf()">View PDF</span>`:''}
      ${s.file&&!s.pdfSaved&&!ro?`<span class="sof-warn">not filed yet</span><span class="tbl-act" onclick="sofSavePdf(true)">📁 Save to SOF folder</span>`:''}
      ${rec.read_by?`<span class="sof-dim">read by ${esc(rec.read_by)}${rec.read_at?' · '+esc(rec.read_at.slice(0,10)):''}</span>`:''}
      ${!ro?`<span class="tbl-act" onclick="document.getElementById('sof-file').click()">Replace PDF…</span>
      <input type="file" id="sof-file" accept="application/pdf,.pdf" style="display:none" onchange="sofPicked(this.files[0])">`:''}
      ${!ro&&(s.file||rec.pdf_file)&&getApiKey()&&!s.busy?`<span class="tbl-act" onclick="sofRead()">✦ ${rec.read_by==='manual'?'Read the PDF':'Read again'}</span>`:''}
      ${!ro&&rec.read_by==='manual'&&rec.pdf_file&&!getApiKey()?`<span class="sof-warn">PDF not read — no Claude API key in this browser (Configuration → AI → Use shared key file)</span>`:''}
      <span class="sof-status ${rec.status==='reviewed'?'ok':''}">${rec.status==='reviewed'?'✓ reviewed':'draft'}</span>
    </div>`;
  const busy=s.busy?`<div class="sof-busy"><span class="sof-spin"></span><span id="sof-busy-msg">${esc(s.msg||'Reading…')}</span> <span class="tbl-act" onclick="sofCancelRead()">Cancel</span></div>`:
    (s.msg?`<div class="sof-msg">${s.msg}</div>`:'');

  // laytime panel
  let lay='';
  if(rec){
    const w=lt.win[rec.id]||{};
    const nStops=lt.nStops;
    const terms=`
      <div class="sof-terms">
        <div><b>${lt.rate?_sofMoney(lt.rate)+'/day':'—'}</b><span>demurrage rate</span></div>
        <div><b>${lt.dischRate?lt.dischRate.toLocaleString()+' t/day':'—'}</b><span>discharge rate</span></div>
        <div><b>${lt.allowed!=null?_sofH(lt.allowed)+' h':'—'}</b><span>allowed laytime${lt.allowed!=null?' ('+(lt.allowed/24).toFixed(2)+' d)':''}</span>${lt.allowedWhy?`<span style="text-transform:none;letter-spacing:0">= ${esc(lt.allowedWhy)}</span>`:''}</div>
        <div><b>${lt.notice} h</b><span>notice time after NOR</span></div>
        <div><b>${lt.despRate?_sofMoney(lt.despRate)+'/day':'—'}</b><span>despatch rate</span></div>
        ${ro?'':`<span class="tbl-act" onclick="sofEditTerms()" style="align-self:center">Edit terms</span>`}
      </div>`;
    const missing=lt.allowed==null||!lt.rate?`<div class="sof-warn" style="margin:6px 0">Enter the demurrage rate and the contracted discharge rate (t/day) from the charter party (Edit terms) to get the demurrage figure — allowed laytime = tonnes ÷ rate × 24 h.</div>`:'';
    lay=`
      <div class="sof-lay">
        ${terms}${missing}
        <div class="sof-win">
          <label>Laytime starts <input type="datetime-local" ${dis} value="${esc(rec.laytime_start||_sofIso(w.a))}" onchange="sofSetRec('laytime_start',this.value)"></label>
          <span class="sof-dim">${rec.laytime_start?`set by hand <span class="tbl-act" onclick="sofSetRec('laytime_start','')">reset</span>`:esc(w.aWhy||'')}</span>
          <label>ends <input type="datetime-local" ${dis} value="${esc(rec.laytime_end||_sofIso(w.b))}" onchange="sofSetRec('laytime_end',this.value)"></label>
          <span class="sof-dim">${rec.laytime_end?`set by hand <span class="tbl-act" onclick="sofSetRec('laytime_end','')">reset</span>`:esc(w.bWhy||'')}</span>
        </div>
        <div class="sof-kpis">
          <div><b>${_sofH(lt.used)}</b><span>time counted${nStops>1?' (voyage)':''}</span></div>
          <div><b>${lt.allowed!=null?_sofH(Math.min(lt.used,lt.allowed)):'—'}</b><span>laytime used</span></div>
          <div class="${lt.demH>0?'bad':''}"><b>${lt.allowed!=null?_sofH(lt.demH):'—'}</b><span>on demurrage</span></div>
          <div class="${lt.demUsd>0?'bad':''}"><b>${lt.allowed!=null&&lt.rate?_sofMoney(lt.demUsd):'—'}</b><span>demurrage</span></div>
          <div class="${lt.despUsd>0?'good':''}"><b>${lt.despRate&&lt.complete?_sofMoney(lt.despUsd):'—'}</b><span>despatch</span></div>
        </div>
        ${nStops>1?`<div class="sof-dim" style="margin-top:4px">Split vessel: laytime runs over the whole voyage — ${lt.nSofs} of ${nStops} ports have an SOF${lt.complete?'':'; the figure grows when the other port\'s SOF is added'}.</div>`:''}
      </div>`;
  }

  // category totals
  const totals=rec?(()=>{
    const byCat={}; (rec.periods||[]).forEach(p=>{ const h=(_sofT(p.end)-_sofT(p.start))/36e5; if(h>0) byCat[p.category]=(byCat[p.category]||0)+h; });
    const all=Object.values(byCat).reduce((a,b)=>a+b,0);
    return `<div class="sof-cats">${SOF_CATEGORIES.filter(k=>byCat[k]).map(k=>`<span title="${(byCat[k]/all*100).toFixed(1)}% of the call"><i>${esc(k)}</i> ${_sofH(byCat[k])}</span>`).join('')}<span><i>Total in port</i> ${_sofH(all)}</span></div>`;
  })():'';

  // the periods table
  const rows=rec?(rec.periods||[]).map((p,i)=>{
    const r=lt.per[p.id]||{h:0,lay:0,dem:0,why:''};
    const warn=chk[p.id];
    const dur=(_sofT(p.end)-_sofT(p.start))/36e5;
    const auto=(p.counts||'auto')==='auto';
    return `<tr class="${r.counted?'cnt':''} ${r.dem>0?'dem':''}">
      <td class="n">${i+1}${warn?` <span class="sof-flag" title="${esc(warn)}">⚠</span>`:''}</td>
      <td><input type="datetime-local" ${dis} value="${esc(p.start||'')}" onchange="sofSet(${i},'start',this.value)"></td>
      <td><input type="datetime-local" ${dis} value="${esc(p.end||'')}" onchange="sofSet(${i},'end',this.value)"></td>
      <td class="h">${isFinite(dur)?_sofH(dur):'—'}</td>
      <td>${sel(SOF_CATEGORIES.map(k=>[k,k]),p.category,`sofSet(${i},'category',this.value)`,dis)}</td>
      <td>${sel(SOF_CAUSES.map(k=>[k.id,k.label]),p.cause||'none',`sofSet(${i},'cause',this.value)`,dis)}</td>
      <td><input class="w-hold" ${dis} value="${esc(p.hold||'')}" onchange="sofSet(${i},'hold',this.value)"></td>
      <td><input class="w-desc" ${dis} value="${esc(p.description||'')}" onchange="sofSet(${i},'description',this.value)"></td>
      <td><input class="w-note" ${dis} value="${esc(p.notes||'')}" onchange="sofSet(${i},'notes',this.value)"></td>
      <td>${auto?sel([['Y','Y'],['N','N']],r.counted?'Y':'N',`sofSet(${i},'counts',this.value)`,dis)
        :`<select class="ovr" ${dis} onchange="sofSet(${i},'counts',this.value)" title="Decided by hand — the rule says ${r.ruleCounted?'Y':'N'}">${[['Y','Y'],['N','N']].map(o=>`<option value="${o[0]}" ${o[0]===p.counts?'selected':''}>${o[1]}</option>`).join('')}</select>${ro?'':` <span class="tbl-act" title="Back to the rule" onclick="sofSet(${i},'counts','auto')">↺</span>`}`}</td>
      <td class="h">${r.lay>0?_sofH(r.lay):''}</td>
      <td class="h d">${r.dem>0?_sofH(r.dem):''}</td>
      <td>${auto?`<span class="sof-why">${esc(r.why)}</span>`:`<input class="w-why" ${dis} placeholder="why?" value="${esc(p.reason||'')}" onchange="sofSet(${i},'reason',this.value)" title="${esc(r.why)}">`}</td>
      <td>${ro?'':`<span class="tbl-act del" onclick="sofDelRow(${i})" title="Delete this period">✕</span>`}</td>
    </tr>`;
  }).join(''):'';
  const table=rec?`
    <div class="sof-tbl-wrap"><table class="sof-tbl">
      <thead><tr><th>#</th><th>Start</th><th>End</th><th>h</th><th>Category</th><th>Cause</th><th>Hold</th><th>What happened</th><th>SOF notes</th>
        <th title="Pre-set by the counting rule; change it to decide a period by hand (amber, ↺ goes back to the rule)">Counts?</th><th>Laytime</th><th>Demurrage</th><th>Why</th><th></th></tr></thead>
      <tbody>${rows||`<tr><td colspan="14" class="sof-dim" style="padding:12px;text-align:center">No periods yet.</td></tr>`}</tbody>
    </table></div>
    ${ro?'':`<div style="display:flex;gap:10px;margin-top:6px"><span class="tbl-act" onclick="sofAddRow()">+ Add period</span><span class="tbl-act" onclick="sofSortRows()">Sort by time</span>
      <span class="sof-dim">Counts? is pre-set by the rule: vessel-caused time never counts · weather counts only once on demurrage · everything else counts. Change it to decide a period yourself. <span style="background:rgba(var(--green-rgb),.18);padding:0 4px">green</span> = laytime · <span style="background:rgba(var(--red-rgb),.25);padding:0 4px">red</span> = demurrage.</span></div>`}`:'';

  document.getElementById('modal-content').innerHTML=`
    <div class="modal-hdr"><span class="modal-title">📄 Statement of Facts — ${title}</span><span class="modal-close" onclick="sofClose()">✕</span></div>
    <div class="sof-body">
      ${ro?`<div class="sof-warn" style="margin-bottom:8px">🔒 Read-only — you can view this SOF but not change it.</div>`:''}
      ${src}${busy}${lay}${totals}${table}
    </div>
    <div class="modal-footer">
      ${rec&&!ro&&(DB.vessel_sof||[]).some(x=>x.id===rec.id)?`<button class="btn-sec" style="color:var(--red);border-color:rgba(var(--red-rgb),.5);margin-right:auto" onclick="sofDelete()">Delete SOF</button>`:''}
      <button class="btn-sec" onclick="sofClose()">${s.dirty?'Cancel':'Close'}</button>
      ${rec&&!ro?`<button class="btn-sec" onclick="sofSave(false)" ${s.busy?'disabled':''}>Save draft</button>
      <button class="btn-pri" onclick="sofSave(true)" ${s.busy?'disabled':''}>✓ Save as reviewed</button>`:''}
    </div>`;
}

// ── edits on the working copy ──
function sofSet(i, key, val){
  const s=window._sof; if(!s||!s.rec||s.ro) return; const p=s.rec.periods[i]; if(!p) return;
  if(key==='counts'&&val!=='auto'&&(p.counts||'auto')==='auto'){
    const r=(sofLaytime((DB.vessel_calls||[]).find(x=>x.id===s.callId)||{id:s.callId}, s.rec).per||{})[p.id];
    if(r&&(r.counted?'Y':'N')===val) val='auto';
  }
  p[key]=val;
  if(key==='category') p.cause=SOF_CAUSE_OF_CAT[val]||'none';   // the category's usual cause; change it after if needed
  if(key==='counts'&&val==='auto') p.reason='';
  s.dirty=true; sofRender();
}
function sofSetRec(key, val){ const s=window._sof; if(!s||!s.rec||s.ro) return; s.rec[key]=val; s.dirty=true; sofRender(); }
function sofAddRow(){
  const s=window._sof; if(!s||!s.rec||s.ro) return;
  const per=s.rec.periods, last=per.slice().sort((a,b)=>_sofT(a.end)-_sofT(b.end)).pop();
  const start=last?last.end:'', end=isFinite(_sofT(start))?_sofIso(_sofT(start)+36e5):'';
  per.push({id:_sofId('sp'), start, end, category:'Discharging', cause:'none', hold:'', description:'', notes:'', counts:'auto', reason:''});
  s.dirty=true; sofRender();
}
function sofDelRow(i){ const s=window._sof; if(!s||!s.rec||s.ro) return; s.rec.periods.splice(i,1); s.dirty=true; sofRender(); }
function sofSortRows(){ const s=window._sof; if(!s||!s.rec) return; s.rec.periods.sort((a,b)=>(_sofT(a.start)-_sofT(b.start))||(_sofT(a.end)-_sofT(b.end))); s.dirty=true; sofRender(); }
function sofManual(){
  const c=_sofCtx(); if(!c||c.s.ro) return;
  c.s.rec=c.s.rec||_sofNewRec(c); c.s.rec.read_by='manual';
  if(!c.s.rec.periods.length){ const d=(c.st.date||new Date()._ymd())+'T00:00'; c.s.rec.periods.push({id:_sofId('sp'), start:d, end:_sofIso(_sofT(d)+36e5), category:'Arrival / NOR', cause:'none', hold:'', description:'', notes:'', counts:'auto', reason:''}); }
  c.s.dirty=true; sofRender();
}
function sofEditTerms(){
  const s=window._sof; if(!s) return;
  if(s.dirty&&!confirm('Save this SOF as a draft first? (OK = save draft, then edit the terms)')) return;
  if(s.dirty) sofSave(false, true);
  const i=(DB.vessel_calls||[]).findIndex(x=>x.id===s.callId), back={callId:s.callId, li:s.li};
  sofClose(true);
  if(i>=0){ editVessel(i); window._sofReturn=back; }   // after: editVessel clears it on open
}

// ── PDF in: pick / drop → file it → read it ──
function sofDrop(e){ e.preventDefault(); const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]; if(f) sofPicked(f); }
async function sofPicked(file){
  const c=_sofCtx(); if(!c||!file||c.s.ro) return;
  if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf'){ alert('Please choose the SOF as a PDF file.'); return; }
  if(file.size>30*1024*1024){ alert('That PDF is larger than 30 MB — Claude can read at most 32 MB per request. Please use a smaller scan.'); return; }
  const {s}=c;
  const replacing=!!s.rec;
  if(replacing&&(s.rec.periods||[]).length&&!confirm('Replace the PDF? The table is read again from the new file — edits made on this SOF are replaced.')) return;
  s.file=file; s.pdfSaved=false;
  s.rec=s.rec||_sofNewRec(c);
  s.rec.pdf_file=_sofPdfName(c);
  s.rec.uploaded_at=new Date().toISOString(); s.rec.uploaded_by=_sofWho();
  s.dirty=true;
  await sofSavePdf(false);         // silent: works when the folder was already allowed this session
  sofRender();
  if(getApiKey()) sofRead();
  else { s.msg='No Claude API key in this browser — type the periods in, or add a key in Configuration → AI and use “Read again”.'; sofManual(); }
}
function _sofPdfName(c){
  const clean=x=>String(x||'').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim();
  const fac=_sofFacName(c.s.fac)||clean(c.berth?.name)||'port';
  return `${clean(c.v.name||'Vessel')}_${clean(fac)}_${c.st.date||new Date()._ymd()}_SOF.pdf`;
}
// File the PDF in the SOF folder. prompt=false only succeeds when this session already has the
// folder; a click (prompt=true) may open the folder picker / re-allow access.
async function sofSavePdf(prompt){
  const s=window._sof; if(!s||!s.file||!s.rec) return false;
  try{
    const dir=await exportDir('sof', !!prompt);
    if(!dir){ if(prompt) statMsg('SOF folder not chosen — the PDF is not filed yet'); return false; }
    const fh=await dir.getFileHandle(s.rec.pdf_file,{create:true});
    const w=await fh.createWritable(); await w.write(s.file); await w.close();
    s.pdfSaved=true;
    if(prompt){ statMsg('SOF filed — '+dir.name+'/'+s.rec.pdf_file); sofRender(); }
    return true;
  }catch(e){ if(prompt) alert('Could not save the PDF: '+e.message); return false; }
}
async function sofViewPdf(){
  const s=window._sof; if(!s||!s.rec) return;
  try{
    let blob=s.file;
    if(!blob){
      const dir=await exportDir('sof', true);
      if(!dir){ alert('Choose the SOF folder first (Configuration → Data Sources).'); return; }
      blob=await (await dir.getFileHandle(s.rec.pdf_file)).getFile();
    }
    const url=URL.createObjectURL(blob.type?blob:new Blob([blob],{type:'application/pdf'}));
    window.open(url,'_blank'); setTimeout(()=>URL.revokeObjectURL(url), 120000);
  }catch(e){ alert(`Could not open ${s.rec.pdf_file}: ${e.message}`); }
}
function _sofB64(file){
  return new Promise((ok,bad)=>{ const r=new FileReader(); r.onload=()=>ok(String(r.result).split(',')[1]||''); r.onerror=()=>bad(r.error); r.readAsDataURL(file); });
}
function sofCancelRead(){ const s=window._sof; if(s&&s.abort) s.abort.abort(); }

// Claude reads the PDF (streamed so the window can show progress). Structured output makes the
// reply schema-valid JSON; `fallbacks:"default"` lets the API re-run a declined request on its
// recommended fallback model — if this browser's API access rejects that beta, retry without it.
async function sofRead(){
  const c=_sofCtx(); if(!c||c.s.busy) return;
  const {s,v,st,berth}=c;
  if(!getApiKey()){ s.msg='No Claude API key in this browser — add one in Configuration → AI.'; sofRender(); return; }
  if(!s.file){   // reopened later: the PDF is only in the SOF folder
    if(!s.rec||!s.rec.pdf_file) return;
    try{
      const dir=await exportDir('sof', true);
      if(!dir){ s.msg='Choose the SOF folder first (Configuration → Data Sources), or use Replace PDF….'; sofRender(); return; }
      s.file=await (await dir.getFileHandle(s.rec.pdf_file)).getFile(); s.pdfSaved=true;
    }catch(e){ s.msg=`<span style="color:var(--red)">${esc(s.rec.pdf_file)} is not in the SOF folder</span> — use Replace PDF… to pick it.`; sofRender(); return; }
    if((s.rec.periods||[]).length>1&&!confirm('Read the PDF into the table? The periods typed in by hand are replaced.')){ return; }
  }
  s.busy=true; s.msg='Sending the PDF to Claude…'; sofRender();
  const b64=await _sofB64(s.file);
  const ctx=`AVILA vessel call: ${v.name||'?'}; port / berth: ${_sofFacName(s.fac)||''} ${berth?.name||''}; planned arrival ${st.date||'?'}${st.label?' ('+st.label+' of a split vessel)':''}. Extract this Statement of Facts.`;
  const body={model:SOF_MODEL, max_tokens:64000, stream:true,
    output_config:{effort:'medium', format:{type:'json_schema', schema:SOF_SCHEMA}},
    system:SOF_SYSTEM,
    messages:[{role:'user', content:[
      {type:'document', source:{type:'base64', media_type:'application/pdf', data:b64}},
      {type:'text', text:ctx}]}]};
  const call=async(withFallback)=>{
    const headers={'Content-Type':'application/json','x-api-key':getApiKey(),'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'};
    const b=Object.assign({},body);
    if(withFallback){ headers['anthropic-beta']='server-side-fallback-2026-07-01'; b.fallbacks='default'; }
    s.abort=new AbortController();
    return fetch('https://api.anthropic.com/v1/messages',{method:'POST', headers, body:JSON.stringify(b), signal:s.abort.signal});
  };
  try{
    let res;
    try{ res=await call(true); }catch(e){ if(e.name==='AbortError') throw e; res=null; }
    if(!res||(res.status===400&&/fallback|beta/i.test(await res.clone().text()))) res=await call(false);
    if(!res.ok){ let m='HTTP '+res.status; try{ const j=await res.json(); m=j?.error?.message||m; }catch(e){} throw new Error(m); }
    const out=await _sofReadStream(res, n=>{ s.msg=`Claude is reading the SOF — ${n} period${n===1?'':'s'} so far…`; const el=document.getElementById('sof-busy-msg'); if(el) el.textContent=s.msg; });
    _sofApplyRead(c, out.json, out.model);
    s.msg=`✓ Read ${s.rec.periods.length} periods and ${s.rec.milestones.length} milestones${out.fellBack?` (answered by the fallback model ${esc(out.model)})`:''}. Check every line — then Save.`;
  }catch(e){
    s.msg=e.name==='AbortError'?'Reading cancelled.':`<span style="color:var(--red)">Claude could not read the PDF: ${esc(e.message)}</span> — you can type the periods in, or try “Read again”.`;
    if(!(s.rec.periods||[]).length) sofManual();
  }finally{
    s.busy=false; s.abort=null; sofRender();
  }
}
async function _sofReadStream(res, onProgress){
  const reader=res.body.getReader(), dec=new TextDecoder();
  let buf='', text='', stop='', model='', fellBack=false, lastN=-1;
  for(;;){
    const {value, done}=await reader.read(); if(done) break;
    buf+=dec.decode(value,{stream:true});
    let i;
    while((i=buf.indexOf('\n\n'))>=0){
      const chunk=buf.slice(0,i); buf=buf.slice(i+2);
      const data=chunk.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('');
      if(!data) continue;
      let ev; try{ ev=JSON.parse(data); }catch(e){ continue; }
      if(ev.type==='message_start') model=ev.message?.model||model;
      else if(ev.type==='content_block_start'&&ev.content_block?.type==='fallback'){ text=''; fellBack=true; model=ev.content_block?.to?.model||model; } // the declined model's partial answer is dropped
      else if(ev.type==='content_block_delta'&&ev.delta?.type==='text_delta'){
        text+=ev.delta.text;
        const n=(text.match(/"category"/g)||[]).length; if(n!==lastN){ lastN=n; onProgress(n); }
      }
      else if(ev.type==='message_delta') stop=ev.delta?.stop_reason||stop;
      else if(ev.type==='error') throw new Error(ev.error?.message||'stream error');
    }
  }
  if(stop==='refusal') throw new Error('the model declined this request');
  if(stop==='max_tokens') throw new Error('the answer was cut off (the SOF is unusually long)');
  let json; try{ json=JSON.parse(text); }catch(e){ throw new Error('the answer was not valid JSON'); }
  return {json, model:model||SOF_MODEL, fellBack};
}
function _sofApplyRead(c, out, model){
  const rec=c.s.rec;
  rec.header=Object.assign({}, rec.header||{}, out.header||{});
  if(!rec.header.vessel_name) rec.header.vessel_name=c.v.name||'';
  rec.remarks=out.remarks||'';
  rec.flags=(out.flags||[]).filter(Boolean);
  rec.milestones=(out.milestones||[]).filter(m=>isFinite(_sofT(m.at))).map(m=>({at:String(m.at).slice(0,16), kind:m.kind||'other', label:m.label||''}));
  rec.periods=(out.periods||[]).map(p=>({id:_sofId('sp'), start:String(p.start||'').slice(0,16), end:String(p.end||'').slice(0,16),
    category:SOF_CATEGORIES.includes(p.category)?p.category:'Idle / unexplained', cause:SOF_CAUSES.some(x=>x.id===p.cause)?p.cause:(SOF_CAUSE_OF_CAT[p.category]||'none'),
    hold:p.hold||'', description:p.description||'', notes:p.notes||'', counts:'auto', reason:''}))
    .sort((a,b)=>(_sofT(a.start)-_sofT(b.start))||(_sofT(a.end)-_sofT(b.end)));
  rec.laytime_start=''; rec.laytime_end='';
  rec.read_by=model; rec.read_at=new Date().toISOString(); rec.status='draft';
  c.s.dirty=true;
}

// ── save / delete ──
function sofSave(reviewed, keepOpen){
  const c=_sofCtx(); if(!c||!c.s.rec||c.s.ro) return;
  const {s,v}=c, rec=s.rec;
  const bad=Object.keys(_sofCheck(rec.periods||[])).length;
  if(reviewed&&bad&&!confirm(`${bad} period${bad>1?'s have':' has'} a gap, overlap or missing time (⚠). Save as reviewed anyway?`)) return;
  if(s.li>=0&&v.legs&&v.legs[s.li]){ s.legId=v.legs[s.li].id||s.legId; rec.leg_id=s.legId; }
  rec.status=reviewed?'reviewed':(rec.status==='reviewed'&&!s.dirty?'reviewed':'draft');
  if(reviewed){ rec.reviewed_at=new Date().toISOString(); rec.reviewed_by=_sofWho(); }
  rec.facility_id=s.fac||rec.facility_id||'';
  if(!DB.vessel_sof) DB.vessel_sof=[];
  const i=DB.vessel_sof.findIndex(x=>x.id===rec.id);
  const copy=JSON.parse(JSON.stringify(rec));
  if(i>=0) DB.vessel_sof[i]=copy; else DB.vessel_sof.push(copy);
  s.dirty=false;
  autoSave(); renderVesselTable();
  statMsg(`SOF ${reviewed?'saved as reviewed':'saved as draft'} — ${v.name}`+(s.file&&!s.pdfSaved?' (PDF not filed yet — use “Save to SOF folder”)':''));
  if(keepOpen) return;
  if(s.file&&!s.pdfSaved){ sofRender(); return; }   // keep the window so the PDF can still be filed
  sofClose(true);
}
function sofDelete(){
  const s=window._sof; if(!s||!s.rec||s.ro) return;
  if(!confirm('Delete this SOF and its time accounting? The PDF stays in the SOF folder.')) return;
  DB.vessel_sof=(DB.vessel_sof||[]).filter(x=>x.id!==s.rec.id);
  autoSave(); renderVesselTable(); sofClose(true); statMsg('SOF deleted');
}

// Laytime terms block shared by the Add and Edit vessel dialogs (ids <prefix>-dem-rate …).
function sofTermsFieldsHTML(prefix, v){
  v=v||{};
  const pi='background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:10px;padding:5px 7px;outline:none;width:100%;box-sizing:border-box';
  const pl='font-family:var(--mono);font-size:8px;color:var(--text-dim);letter-spacing:.5px;text-transform:uppercase';
  const f=(id,label,val,ph,hint)=>`<div style="display:flex;flex-direction:column;gap:3px"><div style="${pl}">${label}</div>
    <input style="${pi}" type="number" step="any" min="0" id="${prefix}-${id}" value="${val??''}" placeholder="${ph}">
    ${hint?`<div style="font-family:var(--mono);font-size:7px;color:var(--text-dim)">${hint}</div>`:''}</div>`;
  return `<div style="margin-top:10px;padding:8px 10px;border:1px solid var(--border2)">
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:8px">LAYTIME &amp; DEMURRAGE — from the charter party · used by the SOF</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${f('dem-rate','Demurrage rate (USD / day)',v.dem_rate_usd_day,'e.g. 14500','pro rata — per hour = rate ÷ 24')}
      ${f('desp-rate','Despatch rate (USD / day)',v.despatch_rate_usd_day,'optional — often half')}
      ${f('disch-rate','Contracted discharge rate (t / day)',v.discharge_rate_tpd,'e.g. 2500','allowed laytime = tonnes to discharge ÷ rate × 24 h')}
      ${f('notice-h','Notice time after NOR (hours)',v.nor_notice_h,'6','laytime starts this long after the first NOR')}
    </div></div>`;
}
function sofReadTermsInto(prefix, rec){
  [['dem-rate','dem_rate_usd_day'],['desp-rate','despatch_rate_usd_day'],['disch-rate','discharge_rate_tpd'],['notice-h','nor_notice_h']].forEach(([id,k])=>{
    const el=document.getElementById(prefix+'-'+id); if(!el) return;
    const n=parseFloat(el.value);
    if(isFinite(n)&&n>=0) rec[k]=n; else delete rec[k];
  });
}

function railHTML(){
  const prods=DB.products.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const fromFacOpts=DB.facilities.map(f=>`<option value="${f.id}" ${f.id===S.facility_id?'selected':''}>${f.name}</option>`).join('');
  const toFacOpts=DB.facilities.filter(f=>f.id!==S.facility_id).map(f=>`<option value="${f.id}">${f.name}</option>`).join('');
  return `
  <div class="modal-hdr"><span class="modal-title">Add Rail Movement — rail_movements</span><span class="modal-close" onclick="closeModal()">✕</span></div>
  <div class="modal-body">
    <div style="font-family:var(--mono);font-size:9px;color:var(--blue);padding:8px;background:rgba(var(--blue-rgb),.06);border:1px solid rgba(var(--blue-rgb),.2);margin-bottom:10px">
      ◆ Rail: Mass balance. Inventory deducted from source on departure. Added to destination on arrival after transit days. Train departs only if min load % is met.
    </div>
    <div class="fr"><div class="ff"><div class="fl">Reference</div><input class="fi" id="rl-ref" placeholder="RAIL-001"></div>
      <div class="ff"><div class="fl">Departure Date</div><input class="fi" type="date" id="rl-date" value="${new Date()._ymd()}"></div></div>
    <div class="fr"><div class="ff"><div class="fl">From Facility</div><select class="fi" id="rl-from">${fromFacOpts}</select></div>
      <div class="ff"><div class="fl">To Facility</div><select class="fi" id="rl-to"><option value="">-- Select destination --</option>${toFacOpts}</select></div></div>
    <div class="fr"><div class="ff"><div class="fl">Product</div><select class="fi" id="rl-prod"><option value="">-- Select --</option>${prods}</select></div>
      <div class="ff"><div class="fl">Transit Days</div><input class="fi" type="number" id="rl-transit" value="3" min="1">
        <div class="fhint">Inventory arrives at destination this many days after departure</div></div></div>
    <div class="fr s3"><div class="ff"><div class="fl">Wagon Count</div><input class="fi" type="number" id="rl-wagons" placeholder="20" oninput="calcRailTotal()"></div>
      <div class="ff"><div class="fl">Capacity / Wagon (t)</div><input class="fi" type="number" id="rl-cap" placeholder="50" oninput="calcRailTotal()"></div>
      <div class="ff"><div class="fl">Total Capacity (t)</div><input class="fi" id="rl-total" readonly style="color:var(--text-dim)" placeholder="auto"></div></div>
    <div class="fr"><div class="ff"><div class="fl">Loading Rate (t/h)</div><input class="fi" type="number" id="rl-rate" placeholder="200">
        <div class="fhint">Transit starts after loading is complete</div></div>
      <div class="ff"><div class="fl">Min Load to Depart (%)</div><input class="fi" type="number" id="rl-minload" value="80" min="0" max="100">
        <div class="fhint">If source inventory is below this % of capacity, train waits</div></div></div>
    <div class="fr s1"><div class="ff"><div class="fl">Notes</div><input class="fi" id="rl-notes" placeholder="Optional"></div></div>
    <div class="fr s1"><div class="ff"><div class="fl">Status</div>
      <select class="fi" id="rl-status">${TRANSPORT_STATUSES.map(s=>`<option value="${s.id}" ${s.id==='Planned'?'selected':''}>${s.id}</option>`).join('')}</select>
    </div></div>
  </div>
  <div class="modal-footer"><button class="btn-sec" onclick="closeModal()">Cancel</button>
    <button class="btn-pri" style="background:var(--blue)" onclick="saveRail()">Add Rail Movement</button></div>`;}

function calcRailTotal(){
  const w=parseInt(document.getElementById('rl-wagons')?.value)||0;
  const c=parseFloat(document.getElementById('rl-cap')?.value)||0;
  const t=document.getElementById('rl-total');
  if(t) t.value=w&&c?Number(w*c).toLocaleString():'';
}

function saveRail(){
  const ref=document.getElementById('rl-ref')?.value||`RAIL-${Date.now()}`;
  const fromId=document.getElementById('rl-from')?.value||S.facility_id;
  const toId=document.getElementById('rl-to')?.value;
  if(!toId){alert('Select a destination facility.');return;}
  const w=parseInt(document.getElementById('rl-wagons')?.value)||0;
  const c=parseFloat(document.getElementById('rl-cap')?.value)||0;
  const prodId=document.getElementById('rl-prod')?.value;
  DB.rail_movements.push({
    id:`rl_${Date.now()}`,
    from_facility_id:fromId, to_facility_id:toId,
    reference:ref, departure_date:document.getElementById('rl-date')?.value,
    product_id:prodId,
    wagon_count:w, wagon_capacity_t:c, total_capacity_t:w*c,
    loading_rate_tph:parseFloat(document.getElementById('rl-rate')?.value)||0,
    min_load_pct:parseFloat(document.getElementById('rl-minload')?.value)||80,
    transit_days:parseInt(document.getElementById('rl-transit')?.value)||1,
    notes:document.getElementById('rl-notes')?.value||'',
    status:document.getElementById('rl-status')?.value||'Planned'
  });
  autoSave(); closeModal(); renderRailTable(); statMsg('Rail movement added');
}

function editTransport(mode,idx){
  if(mode==='rail') _editRail(idx);
}

function _editRail(i){
  const r=DB.rail_movements[i]; if(!r) return;
  const locked=_tsLocked(r.status||'Planned');
  const dis=locked?'disabled style="opacity:0.5;pointer-events:none"':'';
  const pi='background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:10px;padding:5px 7px;outline:none;width:100%';
  const pf='display:flex;flex-direction:column;gap:3px';
  const pl='font-family:var(--mono);font-size:8px;color:var(--text-dim);letter-spacing:.5px;text-transform:uppercase';
  const prods=DB.products.map(p=>`<option value="${p.id}" ${p.id===r.product_id?'selected':''}>${p.name}</option>`).join('');
  const _originFac=_railMoveOriginFacId(r);
  const facOpts=DB.facilities.map(f=>`<option value="${f.id}" ${f.id===_originFac?'selected':''}>${f.name}</option>`).join('');
  const toOpts=DB.facilities.map(f=>`<option value="${f.id}" ${f.id===r.to_facility_id?'selected':''}>${f.name}</option>`).join('');
  // A movement that names its dispatch point leaves from that point's facility — not editable here.
  const _fromDis=(!locked&&r.from_dispatch_id&&getEl(r.from_dispatch_id))?`disabled title="Set by the dispatch point (${esc(getEl(r.from_dispatch_id).name||'')})"`:'';
  const statusOpts=TRANSPORT_STATUSES.map(s=>`<option value="${s.id}" ${s.id===(r.status||'Planned')?'selected':''}>${s.id}</option>`).join('');
  let h=`<div class="modal-hdr">
    <span class="modal-title">${locked?'🔒 View':'Edit'} Rail Movement</span>
    <span class="modal-close" onclick="closeModal()">✕</span>
  </div>
  <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
    ${locked?`<div style="font-family:var(--mono);font-size:9px;color:var(--green);padding:8px 10px;background:rgba(0,229,160,.06);border:1px solid rgba(0,229,160,.2)">
      🔒 This movement is <strong>${r.status}</strong> — fields are locked.</div>`:
      (r.status==='Proposed'?`<div style="font-family:var(--mono);font-size:9px;color:var(--amber,#ffb830);padding:8px 10px;background:rgba(var(--amber-rgb),.08);border:1px solid rgba(var(--amber-rgb),.3)">
      ⚠ Status is <strong>Proposed</strong> — the simulator may overwrite this movement. Change Status to <strong>Planned</strong> to protect your edits.</div>`:'')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="${pf}"><div style="${pl}">Reference</div><input ${dis} style="${pi}" id="er-ref" value="${r.reference||''}"></div>
      <div style="${pf}"><div style="${pl}">Departure Date</div><input ${dis} style="${pi}" type="date" id="er-date" value="${r.departure_date||r.date||''}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="${pf}"><div style="${pl}">From Facility</div><select ${dis||_fromDis} style="${pi}" id="er-from">${facOpts}</select></div>
      <div style="${pf}"><div style="${pl}">To Facility</div><select ${dis} style="${pi}" id="er-to">${toOpts}</select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="${pf}"><div style="${pl}">Product</div><select ${dis} style="${pi}" id="er-prod"><option value="">-- Select --</option>${prods}</select></div>
      <div style="${pf}"><div style="${pl}">Transit Days</div><input ${dis} style="${pi}" type="number" id="er-transit" value="${r.transit_days||1}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div style="${pf}"><div style="${pl}">Wagons</div><input ${dis} style="${pi}" type="number" id="er-wagons" value="${r.wagon_count||0}"></div>
      <div style="${pf}"><div style="${pl}">Capacity (t/wagon)</div><input ${dis} style="${pi}" type="number" id="er-cap" value="${r.wagon_capacity_t||0}"></div>
      <div style="${pf}"><div style="${pl}">Min Load %</div><input ${dis} style="${pi}" type="number" id="er-minload" value="${r.min_load_pct||80}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="${pf}"><div style="${pl}">Status</div><select style="${pi}" id="er-status">${statusOpts}</select></div>
      <div style="${pf}"><div style="${pl}">Notes</div><input style="${pi}" id="er-notes" value="${r.notes||''}"></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="tb-btn sec" onclick="closeModal()">Close</button>
      <button class="tb-btn" onclick="_saveEditRail(${i})">Save Changes</button>
    </div>
  </div>`;
  showModal('_custom');
  document.getElementById('modal-content').innerHTML=h;
}

function _saveEditRail(i){
  const r=DB.rail_movements[i]; if(!r) return;
  const locked=_tsLocked(r.status||'Planned');
  if(!locked){
    const w=parseInt(document.getElementById('er-wagons')?.value)||0;
    const c=parseFloat(document.getElementById('er-cap')?.value)||0;
    r.reference=document.getElementById('er-ref')?.value||r.reference;
    r.departure_date=document.getElementById('er-date')?.value||r.departure_date;
    if(r.from_dispatch_id&&getEl(r.from_dispatch_id)) r.from_facility_id=_railMoveOriginFacId(r);   // set by its dispatch point
    else r.from_facility_id=document.getElementById('er-from')?.value||r.from_facility_id;
    r.to_facility_id=document.getElementById('er-to')?.value||r.to_facility_id;
    r.product_id=document.getElementById('er-prod')?.value||r.product_id;
    r.transit_days=parseInt(document.getElementById('er-transit')?.value)||r.transit_days;
    r.wagon_count=w; r.wagon_capacity_t=c; r.total_capacity_t=w*c;
    r.min_load_pct=parseFloat(document.getElementById('er-minload')?.value)||r.min_load_pct;
  }
  r.notes=document.getElementById('er-notes')?.value??r.notes;
  r.status=document.getElementById('er-status')?.value||r.status;
  // Strip auto-generation marker on any user save — preserves the movement across sim runs
  if(r.notes==='Auto-generated by simulation') r.notes='';
  autoSave(); closeModal(); renderRailTable(); rpRender(); statMsg('Rail movement updated');
}

// Facility of an element (its assigned facility, else the canvas it was drawn on) and its name.
function _elFac(el){ return el?(el.assigned_facility_id||el.facility_id):null; }
function _elFacName(el){ const f=DB.facilities.find(x=>x.id===_elFac(el)); return f?f.name:''; }


function demandHTML(){
  const facOpts=DB.facilities.map(f=>`<option value="${f.id}" ${f.id===S.facility_id?'selected':''}>${f.name}</option>`).join('');
  const dpEls=getFacElements().filter(e=>e.type==='demand_point');
  const dpOpts=dpEls.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('');
  return `
  <div class="modal-hdr"><span class="modal-title">Add Demand Point — demand_points</span><span class="modal-close" onclick="closeModal()">✕</span></div>
  <div class="modal-body">
    <div style="font-family:var(--mono);font-size:9px;color:var(--blue);padding:8px;background:rgba(var(--blue-rgb),.06);border:1px solid rgba(var(--blue-rgb),.2);margin-bottom:10px">
      ◆ Place a Demand Point element on the topology canvas first, then open its properties panel to configure accepted products. Only products reachable via drawn connections are offered.
    </div>
    <div class="fr s1"><div class="ff"><div class="fl">Facility</div><select class="fi" id="dm-fac">${facOpts}</select></div></div>
    <div class="fr s1"><div class="ff"><div class="fl">Demand Point Element (from topology)</div>
      <select class="fi" id="dm-el"><option value="">-- Select element --</option>${dpOpts}</select>
      <div class="fhint">Products configured via element properties panel</div>
    </div></div>
    <div class="fr"><div class="ff"><div class="fl">Demand Mode</div>
      <select class="fi" id="dm-mode"><option>Fixed Daily</option><option>Rolling Average</option><option>Target</option></select></div>
      <div class="ff"><div class="fl">Daily Tonnage (t/day — total across all products)</div>
        <input class="fi" type="number" id="dm-qty" placeholder="500"></div></div>
    <div class="fr s1"><div class="ff"><div class="fl">Inventory Objective</div>
      <select class="fi" id="dm-obj">
        <option>Meet Demand Only</option><option>Target Level</option>
        <option>Maximize Inventory</option><option>Minimize Inventory</option><option>Secure Supply</option>
      </select></div></div>
  </div>
  <div class="modal-footer"><button class="btn-sec" onclick="closeModal()">Cancel</button>
    <button class="btn-pri" onclick="saveDemand()">Create Demand Point</button></div>`;}

function saveDemand(){
  const facId=document.getElementById('dm-fac')?.value||S.facility_id;
  const elId=document.getElementById('dm-el')?.value||null;
  const el=elId?getEl(elId):null;
  if(elId&&DB.demand_points.find(d=>d.element_id===elId)){
    alert('A demand point record already exists for this element. Edit it in the element properties panel.');
    return;
  }
  DB.demand_points.push({
    id:`dp_${Date.now()}`,
    facility_id:facId,
    element_id:elId,
    element_name:el?.name||'',
    products:[],
    mode:document.getElementById('dm-mode')?.value||'Fixed Daily',
    daily_tonnage:parseFloat(document.getElementById('dm-qty')?.value)||0,
    objective:document.getElementById('dm-obj')?.value||'Meet Demand Only',
    rolling_days:30
  });
  autoSave(); closeModal(); renderDemandView();
  statMsg(elId?'Created — open element properties to add products':'Demand point created');
}


function facilityHTML(){
  // Build sub-region options grouped by hierarchy
  let subOpts='<option value="">-- Select Sub-Region --</option>';
  DB.macro_regions.forEach(mr=>{
    DB.countries.filter(c=>c.macro_region_id===mr.id).forEach(co=>{
      DB.regions.filter(r=>r.country_id===co.id).forEach(re=>{
        DB.sub_regions.filter(s=>s.region_id===re.id).forEach(sr=>{
          subOpts+=`<option value="${sr.id}">${mr.name} › ${co.name} › ${re.name} › ${sr.name}</option>`;
        });
      });
    });
  });
  const preSelected=S._newFacSubRegion||'';
  if(preSelected) subOpts=subOpts.replace(`value="${preSelected}"`,`value="${preSelected}" selected`);
  return `
  <div class="modal-hdr"><span class="modal-title">Add Facility — facilities</span><span class="modal-close" onclick="closeModal()">✕</span></div>
  <div class="modal-body">
    <div class="fr s1"><div class="ff"><div class="fl">Facility Name</div><input class="fi" id="fac-name" placeholder="e.g. Cairo Plant"></div></div>
    <div class="fr s1"><div class="ff"><div class="fl">Plant # / codes</div>
      ${plantCodesEditorHTML('fac',[])}
      <div class="fhint">A facility can answer to several codes — add one per material or pickup type (SUT: 4930 and 5052).</div></div></div>
    <div class="fr"><div class="ff"><div class="fl">Type</div><select class="fi" id="fac-type"><option value="plant">Plant</option><option value="terminal">Terminal</option><option value="purchased">Purchased</option></select></div></div>
    <div class="fr s1"><div class="ff"><div class="fl">Location (Sub-Region)</div>
      <select class="fi" id="fac-sub">${subOpts}</select>
      <div class="fhint">Location hierarchy is managed under Organization → macro_regions → countries → regions → sub_regions</div>
    </div></div>
    <div class="fr"><div class="ff"><div class="fl">Status</div>
      <select class="fi" id="fac-status"><option value="active">Active</option><option value="construction">Under Construction</option><option value="inactive">Inactive</option></select></div>
      <div class="ff"><div class="fl">Notes</div><input class="fi" id="fac-notes" placeholder="Optional"></div></div>
  </div>
  <div class="modal-footer"><button class="btn-sec" onclick="closeModal()">Cancel</button>
    <button class="btn-pri" onclick="saveFacility()">Create Facility</button></div>`;
}

function saveFacility(){
  const name=document.getElementById('fac-name')?.value?.trim(); if(!name) return;
  const id=`fac_${Date.now()}`;
  const codeRows=readPlantCodeRows('fac')||[];
  const clash=plantCodeConflicts(codeRows,id);
  const fac={id, name, plant_no:'', plant_nos:[],
    type:document.getElementById('fac-type')?.value||'plant',
    sub_region_id:document.getElementById('fac-sub')?.value||null,
    status:document.getElementById('fac-status')?.value||'active',
    notes:document.getElementById('fac-notes')?.value||''};
  setFacPlantCodes(fac,codeRows);
  DB.facilities.push(fac);
  S._newFacSubRegion=null;
  autoSave(); closeModal(); renderLocationTree();
  if(typeof _xlRulesChanged==='function') _xlRulesChanged();   // its Plant # codes go to the SAP script
  statMsg(clash.length?`Facility "${name}" created — but these codes are also on another facility: ${clash.join(', ')}`:`Facility "${name}" created`);
}

// Simulation horizon presets as a day count from the start date, relative to today. The count
// INCLUDES both ends: day 1 is the start date, so reaching end date d takes (d − start) + 1 days.
// Counting the gap alone stopped every preset one day short — End of Year ended on Dec 30.
// Shared by the preset tiles (simCfgHTML) and saveSimCfg, so saving applies what the tile shows.
function _simHorizonPresets(startStr){
  const today=new Date();
  const startDate=new Date((startStr||today._ymd())+'T00:00:00');
  const eom=new Date(today.getFullYear(),today.getMonth()+1,0);
  const e3m=new Date(today.getFullYear(),today.getMonth()+4,0);
  const eoy=new Date(today.getFullYear(),11,31);
  const syr=new Date(startDate.getFullYear(),11,31);   // the START date's year — a Planning run starts next Jan 1
  const daysFromStart=d=>Math.max(1,Math.round((d-startDate)/(864e5))+1);
  return [
    {id:'eom',label:'End of Month',days:daysFromStart(eom),date:eom._ymd()},
    {id:'3m',label:'Next 3 Months',days:daysFromStart(e3m),date:e3m._ymd()},
    {id:'eoy',label:'End of Year',days:daysFromStart(eoy),date:eoy._ymd()},
    {id:'year',label:'Full Year',days:daysFromStart(syr),date:syr._ymd()},
    {id:'custom',label:'Custom',days:S.simCfg.horizon,date:null}
  ];
}

// The horizon an end date asks for. Day 1 is the start date, so the count includes both ends.
function _simDaysToEnd(startStr,endStr){
  if(!endStr) return {msg:'Pick an end date'};
  const days=dateToDayOffset(endStr,startStr)+1;
  if(!(days>=1)) return {msg:'The end date is before the start date'};
  if(days>730) return {msg:`${days} days — the limit is 730`};
  return {days,msg:`${days} day${days===1?'':'s'}`};
}

function simCfgHTML(){
  const presets=_simHorizonPresets(S.simCfg.start_date);
  const cur=S.simCfg.horizonPreset||'custom';
  // The end date Save would apply: a preset's, otherwise the last day of the stored horizon.
  const curP=presets.find(p=>p.id===cur)||presets.find(p=>p.id==='custom');
  const endDate=_addDays(S.simCfg.start_date,curP.days-1);
  const endChk=_simDaysToEnd(S.simCfg.start_date,endDate);
  Object.assign(presets.find(p=>p.id==='custom'),{days:curP.days,date:endDate});
  const activeRules=(DB.simulation_rules||[]).filter(r=>r.status==='active'&&_ruleIsInterpreted(r));
  const tabSty=(active)=>`padding:7px 16px;font-family:var(--mono);font-size:10px;cursor:pointer;border:none;background:transparent;border-bottom:2px solid ${active?'var(--green)':'transparent'};color:${active?'var(--green)':'var(--text-dim)'};letter-spacing:.5px;text-transform:uppercase`;

  return `
  <div class="modal-hdr">
    <span class="modal-title">Configure</span>
    <span class="modal-close" onclick="closeModal()">✕</span>
  </div>
  <div style="display:flex;border-bottom:1px solid var(--border);padding:0 16px;background:var(--surface)">
    <button style="${tabSty(true)}" id="cfg-tab-settings" onclick="_cfgTab('settings')">Settings</button>
    <button style="${tabSty(false)}" id="cfg-tab-rules" onclick="_cfgTab('rules')">
      Rules <span style="background:${activeRules.length?'var(--amber)':'var(--border2)'};color:var(--bg);font-size:8px;padding:1px 5px;border-radius:8px;margin-left:4px">${activeRules.length}</span>
    </button>
    <button style="${tabSty(false)}" id="cfg-tab-datasources" onclick="_cfgTab('datasources')">Data Sources</button>
    <button style="${tabSty(false)}" id="cfg-tab-demandmap" onclick="_cfgTab('demandmap')">Demand Mapping</button>
    <button style="${tabSty(false)}" id="cfg-tab-plan" onclick="_cfgTab('plan')">Budget Planning</button>
    <button style="${tabSty(false)}" id="cfg-tab-ai" onclick="_cfgTab('ai')">AI Agent</button>
  </div>

  <!-- SETTINGS PANEL -->
  <div id="cfg-panel-settings" class="modal-body">
    <div class="modal-sec-title">Start & End Date</div>
    <div class="fr"><div class="ff"><div class="fl">Start Date (Day 0 — today by default)</div>
      <input class="fi" type="date" id="sc-start" value="${S.simCfg.start_date}" oninput="_scSyncHorizon()">
    </div><div class="ff"><div class="fl">End Date (last day simulated)</div>
      <input class="fi" type="date" id="sc-end" value="${endDate}" oninput="selectHorizonPreset('custom')">
      <div id="sc-end-hint" style="font-family:var(--mono);font-size:9px;color:${endChk.days?'var(--text-dim)':'var(--red)'}">${endChk.msg}</div>
    </div></div>
    <div class="fr s1"><div class="ff"><div class="fl">Horizon Shortcuts</div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:4px">
        ${presets.map(p=>`
          <div onclick="selectHorizonPreset('${p.id}')" id="preset-${p.id}"
            style="padding:10px 8px;border:1px solid ${cur===p.id?'var(--green)':'var(--border2)'};
            background:${cur===p.id?'var(--green-faint)':'var(--surface2)'};
            cursor:pointer;text-align:center;transition:all .15s">
            <div style="font-family:var(--mono);font-size:9px;color:${cur===p.id?'var(--green)':'var(--text-dim)'};letter-spacing:.5px;margin-bottom:4px">${p.label}</div>
            <div style="font-family:var(--mono);font-size:11px;color:${cur===p.id?'var(--green)':'var(--text)'};font-weight:700">${p.days}d</div>
            ${p.date?`<div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:2px">${p.date}</div>`:''}
          </div>`).join('')}
      </div>
    </div></div>
    <div class="modal-sec-title">Simulation Settings</div>
    <div class="fr s1"><div class="ff"><div class="fl">Scenario Role</div>
      <select class="fi" id="sc-role">
        <option value="" ${S.simCfg.role!=='planning'?'selected':''}>Execution — live operations (default)</option>
        <option value="planning" ${S.simCfg.role==='planning'?'selected':''}>Planning — budget scenario</option>
      </select>
      <div class="fhint">Planning: budget demand drives the simulation; the file watcher, merge, Sales catalog and Real Sales / Production imports are off. Normally set by “Create Planning scenario” in Budget Planning.</div>
    </div></div>
    <div class="fr s1"><div class="ff"><div class="fl">Conflict Resolution</div>
      <select class="fi" id="sc-conflict">
        <option value="rolling_avg" ${S.simCfg.conflict_resolution==='rolling_avg'?'selected':''}>Rolling Average Production (recommended)</option>
        <option value="priority" ${S.simCfg.conflict_resolution==='priority'?'selected':''}>User-defined Priority</option>
        <option value="prorata" ${S.simCfg.conflict_resolution==='prorata'?'selected':''}>Pro Rata Allocation</option>
      </select>
      <div class="fhint">When two mills compete for the same resource, lowest rolling average production stops first</div>
    </div></div>
  </div>
  <div id="cfg-panel-settings-footer" class="modal-footer">
    <button class="btn-sec" onclick="closeModal()">Cancel</button>
    <button class="btn-pri" onclick="saveSimCfg()">Save</button>
  </div>

  <!-- RULES PANEL -->
  <div id="cfg-panel-rules" style="display:none">${_rulesPanelHTML()}</div>

  <!-- DATA SOURCES PANEL -->
  <div id="cfg-panel-datasources" style="display:none;max-height:480px;overflow-y:auto">
    ${dsCfgPanelHTML()}
  </div>

  <!-- DEMAND MAPPING PANEL -->
  <div id="cfg-panel-demandmap" style="display:none;max-height:480px;overflow-y:auto">
    ${xlmapPanelHTML()}
  </div>

  <!-- BUDGET PLANNING PANEL -->
  <div id="cfg-panel-plan" style="display:none;max-height:480px;overflow-y:auto">
    ${planPanelHTML()}
  </div>

  <!-- AI AGENT PANEL -->
  <div id="cfg-panel-ai" style="display:none;max-height:480px;overflow-y:auto">
    ${aiCfgPanelHTML()}
  </div>`;
}

function renderCfgPanel(tab){
  const panel=document.getElementById('cfgpanel-view');
  if(!panel) return;
  panel.innerHTML='<div class="cfg-page-wrap">'+simCfgHTML()+'</div>';
  _cfgTab(tab||'settings');
}

function _cfgTab(tab){
  document.getElementById('cfg-panel-settings').style.display=tab==='settings'?'':'none';
  document.getElementById('cfg-panel-settings-footer').style.display=tab==='settings'?'':'none';
  document.getElementById('cfg-panel-rules').style.display=tab==='rules'?'':'none';
  document.getElementById('cfg-panel-datasources').style.display=tab==='datasources'?'':'none';
  document.getElementById('cfg-panel-demandmap').style.display=tab==='demandmap'?'':'none';
  if(tab==='demandmap'&&typeof _xlSaveRules==='function') _xlSaveRules(false,'open');
  document.getElementById('cfg-panel-plan').style.display=tab==='plan'?'':'none';
  if(tab==='plan') planRender();
  document.getElementById('cfg-panel-ai').style.display=tab==='ai'?'':'none';
  const tabStyActive=`padding:7px 16px;font-family:var(--mono);font-size:10px;cursor:pointer;border:none;background:transparent;border-bottom:2px solid var(--green);color:var(--green);letter-spacing:.5px;text-transform:uppercase`;
  const tabStyInactive=`padding:7px 16px;font-family:var(--mono);font-size:10px;cursor:pointer;border:none;background:transparent;border-bottom:2px solid transparent;color:var(--text-dim);letter-spacing:.5px;text-transform:uppercase`;
  document.getElementById('cfg-tab-settings').style.cssText=tab==='settings'?tabStyActive:tabStyInactive;
  document.getElementById('cfg-tab-rules').style.cssText=tab==='rules'?tabStyActive:tabStyInactive;
  document.getElementById('cfg-tab-datasources').style.cssText=tab==='datasources'?tabStyActive:tabStyInactive;
  document.getElementById('cfg-tab-demandmap').style.cssText=tab==='demandmap'?tabStyActive:tabStyInactive;
  document.getElementById('cfg-tab-plan').style.cssText=tab==='plan'?tabStyActive:tabStyInactive;
  document.getElementById('cfg-tab-ai').style.cssText=tab==='ai'?tabStyActive:tabStyInactive;
}

