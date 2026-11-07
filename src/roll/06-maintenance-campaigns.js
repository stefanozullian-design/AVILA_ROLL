// ═══════════════════════════════════════════════════════
// MAINTENANCE MODAL
// ═══════════════════════════════════════════════════════
// Shared modal builder for add and edit
function maintModalHTML(ev, elementId){
  const isEdit=!!ev;
  const el=getEl(elementId||ev?.element_id);
  const today=new Date()._ymd();
  const startDate=ev?.start_date||today;
  const durDays=ev?.duration_days||1;
  const endDate=ev?.end_date||calcEndDate(startDate,durDays);
  const type=ev?.type||'fixed';
  const freqDays=ev?.frequency_days||90;
  const recEnd=ev?.recurrence_end_date||'';
  const rampDays=ev?.rampup_days||0;

  // Element picker — only shown when opening from calendar (no pre-selected element)
  let elPickerHTML='';
  if(!elementId&&!ev?.element_id){
    const facEls=getFacElements();
    elPickerHTML=`<div class="fr s1"><div class="ff"><div class="fl">Element</div>
      <select class="fi" id="me-element">
        <option value="">-- Select element --</option>
        ${facEls.map(e=>`<option value="${e.id}">${ET[e.type]?.label||e.type} — ${esc(e.name)}</option>`).join('')}
      </select></div></div>`;
  }

  return `
    <div class="modal-hdr">
      <span class="modal-title">${isEdit?'Edit':'Add'} Maintenance Event${el?' — '+el.name:''}</span>
      <span class="modal-close" onclick="closeModal()">✕</span>
    </div>
    <div class="modal-body">
      ${elPickerHTML}
      <div class="fr s1"><div class="ff"><div class="fl">Event Name</div>
        <input class="fi" id="me-name" value="${ev?.name||''}" placeholder="e.g. September Kiln Overhaul">
      </div></div>
      <div class="fr"><div class="ff"><div class="fl">Event Type</div>
        <select class="fi" id="me-type" onchange="onMeTypeChange()">
          <option value="fixed" ${type==='fixed'?'selected':''}>Fixed Date (One-off)</option>
          <option value="recurring" ${type==='recurring'?'selected':''}>Recurring</option>
        </select></div>
        <div class="ff"><div class="fl">Duration (days)</div>
          <input class="fi" type="number" id="me-dur" value="${durDays}" min="0.5" step="0.5" onchange="calcMeEndDate()">
          <div class="fhint">Half-days allowed (e.g. 0.5) — a fractional tail day runs at reduced output</div>
        </div>
      </div>
      <div class="fr"><div class="ff"><div class="fl">Start Date</div>
          <input class="fi" type="date" id="me-start" value="${startDate}" onchange="calcMeEndDate()">
        </div>
        <div class="ff"><div class="fl">End Date (auto-calculated)</div>
          <input class="fi" type="date" id="me-end" value="${endDate}" style="color:var(--text-dim)" readonly>
        </div>
      </div>
      <div id="me-recur-wrap" style="display:${type==='recurring'?'block':'none'}">
        <div class="modal-sec-title">Recurring Schedule</div>
        <div class="fr"><div class="ff"><div class="fl">Frequency (every X days)</div>
            <input class="fi" type="number" id="me-freq" value="${freqDays}" min="1">
            <div class="fhint">Counted from start of each occurrence</div>
          </div>
          <div class="ff"><div class="fl">Recurrence End Date (optional)</div>
            <input class="fi" type="date" id="me-recend" value="${recEnd}">
            <div class="fhint">Leave blank to recur indefinitely within simulation horizon</div>
          </div>
        </div>
      </div>
      <div class="modal-sec-title">Ramp-up After Return to Service</div>
      <div class="fr s1"><div class="ff"><div class="fl">Ramp-up Days (0 = immediate full return)</div>
        <input class="fi" type="number" id="me-rampdays" value="${rampDays}" min="0" max="14" onchange="renderRampGrid()">
      </div></div>
      <div id="ramp-grid-wrap"></div>
      <div class="fr s1"><div class="ff"><div class="fl">Notes</div>
        <input class="fi" id="me-notes" value="${ev?.notes||''}" placeholder="Optional">
      </div></div>
    </div>
    <div class="modal-footer">
      <button class="btn-sec" onclick="closeModal()">Cancel</button>
      <button class="btn-pri btn-amber" onclick="${isEdit?'updateMaintEvent()':'saveMaintEvent()'}">${isEdit?'Save Changes':'Add Event'}</button>
    </div>`;
}

function openMaintModal(elementId){
  S._maintTarget=elementId;
  showModalContent(maintModalHTML(null,elementId));
  renderRampGrid();
}

function openMaintModalFromCalendar(){
  S._maintTarget=null;
  showModalContent(maintModalHTML(null,null));
  renderRampGrid();
}

function calcEndDate(startDate, durationDays){
  try{
    // 'T00:00:00' forces LOCAL-midnight parsing. A bare 'YYYY-MM-DD' parses as UTC,
    // and ._ymd() formats local — in any US timezone that combination returned the
    // day BEFORE the one asked for (end date landed a day early).
    const d=new Date(startDate+'T00:00:00');
    // Fractional durations (e.g. 0.5, 1.5) span ceil(dur) calendar days — the last is the
    // partial/reduced-output day — so the end date is start + ceil(dur) - 1.
    d.setDate(d.getDate()+Math.max(1,Math.ceil(parseFloat(durationDays)||1))-1);
    return d._ymd();
  }catch(e){return startDate;}
}

function calcMeEndDate(){
  const start=document.getElementById('me-start')?.value;
  const dur=document.getElementById('me-dur')?.value;
  const endInput=document.getElementById('me-end');
  if(start&&dur&&endInput) endInput.value=calcEndDate(start,dur);
}

function renderRampGrid(){
  const days=parseInt(document.getElementById('me-rampdays')?.value)||0;
  const wrap=document.getElementById('ramp-grid-wrap'); if(!wrap) return;
  if(!days){
    wrap.innerHTML=`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding:4px 0">Element returns to 100% capacity immediately on restart</div>`;
    return;
  }
  let h=`<div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);letter-spacing:1px;margin-bottom:6px;text-transform:uppercase">% of Rated Capacity per Day After Return</div><div class="rampup-grid">`;
  for(let i=1;i<=days;i++){
    const def=Math.round(Math.min(100,25+(75/days)*i));
    h+=`<div class="rampup-cell"><div class="rampup-day-lbl">Day ${i}</div><input class="rampup-input" type="number" id="ru-${i}" value="${def}" min="1" max="100"></div>`;
  }
  h+=`</div>`; wrap.innerHTML=h;
}

function onMeTypeChange(){
  const t=document.getElementById('me-type')?.value;
  const rw=document.getElementById('me-recur-wrap');
  if(rw) rw.style.display=t==='recurring'?'block':'none';
}

function getMeFormValues(){
  const days=parseInt(document.getElementById('me-rampdays')?.value)||0;
  const ramp=[]; for(let i=1;i<=days;i++){const v=document.getElementById(`ru-${i}`);ramp.push(v?parseFloat(v.value)||100:100);}
  const startDate=document.getElementById('me-start')?.value||'';
  const durDays=parseFloat(document.getElementById('me-dur')?.value)||1;
  return {
    name:document.getElementById('me-name')?.value||'Maintenance',
    type:document.getElementById('me-type')?.value||'fixed',
    start_date:startDate,
    duration_days:durDays,
    end_date:calcEndDate(startDate,durDays),
    frequency_days:parseInt(document.getElementById('me-freq')?.value)||90,
    recurrence_end_date:document.getElementById('me-recend')?.value||null,
    rampup_days:days,
    rampup_profile:ramp,
    notes:document.getElementById('me-notes')?.value||''
  };
}

function saveMaintEvent(){
  const elId=S._maintTarget||document.getElementById('me-element')?.value;
  if(!elId){alert('Please select an element.');return;}
  const el=getEl(elId);
  const vals=getMeFormValues();
  if(!vals.name||!vals.start_date){alert('Name and start date are required.');return;}
  DB.element_maintenance_events.push({
    id:`me_${Date.now()}`,
    element_id:elId,
    facility_id:el?.assigned_facility_id||el?.facility_id||S.facility_id,
    element_name:el?.name||'',
    element_type:el?.type||'',
    ...vals
  });
  autoSave(); closeModal();
  if(S._maintTarget) renderProps(S._maintTarget);
  renderMaintenanceCalendar(); updateStatusBar();
  statMsg('Maintenance event added');
}

function editMaintEvent(id){
  const ev=DB.element_maintenance_events.find(m=>m.id===id); if(!ev) return;
  S._editMaintId=id;
  showModalContent(maintModalHTML(ev,ev.element_id));
  renderRampGrid();
  setTimeout(()=>{
    (ev.rampup_profile||[]).forEach((v,i)=>{const inp=document.getElementById(`ru-${i+1}`);if(inp) inp.value=v;});
  },60);
}

// Called from clickable MAINT badge in supply view
function openMaintenanceEventById(id){
  if(!id) return;
  editMaintEvent(id);
}

// ═══════════════════════════════════════════════════════════════
// PRODUCTION CAMPAIGN MANAGER
// ═══════════════════════════════════════════════════════════════

function getActiveCampaign(elId, dateStr){
  return (DB.production_campaigns||[]).find(c=>
    c.element_id===elId && dateStr>=c.start_date && dateStr<=c.end_date
  )||null;
}

// Active demand swaps OUT of a demand point on a date, in the order they were created: a
// portion of this point's demand relocated to another demand point (to_element_id). A point
// can swap to several destinations at once (300 t/d to PEV + 200 t/d to MIA_IL(11)), so every
// reader must take ALL of them. This used to be a .find — only the first swap was subtracted at
// the source while each destination still added its own share, creating demand from nothing.
function getActiveDemandSwaps(elementId, dateStr){
  if(!elementId) return [];
  return (DB.demand_substitutions||[]).filter(s=>
    s.from_element_id===elementId && dateStr>=s.start_date && dateStr<=s.end_date);
}
// Tonnes each active swap takes out of a source point's demand `rate` on a date — the ONE
// allocation both the source (_resolveDemandSwap) and the destinations (_resolveDemandSwapIn)
// read, so what the destinations receive always equals what the source gives up. Swaps that
// together ask for more than the point's demand (60% + 60%, or 300 + 300 t/d on 500 t) are
// scaled down in proportion; a single swap is capped at the demand exactly as before.
// FORECAST DAYS ONLY: a swap predicts volume that has not shipped yet. Once either end has
// actual shipments for the day, the actuals are what happened (any real substitution is
// already inside them), so that swap is ignored on both sides — moving it again would
// count it twice at the destination and take it off the source a second time.
function _demandSwapAlloc(fromElId, rate, dateStr){
  if(!(rate>0)) return [];
  if(_dmdIsActual(fromElId, dateStr)) return [];
  const list=getActiveDemandSwaps(fromElId, dateStr)
    .filter(s=>!(s.to_element_id&&_dmdIsActual(s.to_element_id, dateStr))).map(s=>({swap:s,
    qty:Math.max(0, s.mode==='percent' ? rate*(parseFloat(s.amount)||0)/100 : (parseFloat(s.amount)||0))
  })).filter(x=>x.qty>0);
  const total=list.reduce((a,x)=>a+x.qty,0);
  if(total>rate){
    const k=rate/total; let given=0;
    list.forEach((x,i)=>{ x.qty = i===list.length-1 ? rate-given : x.qty*k; given+=x.qty; });
  }
  return list;
}
// Primary product/material carried by a demand point element.
function _dpPrimaryProduct(elId){
  const dp=(DB.demand_points||[]).find(d=>d.element_id===elId);
  if(dp&&(dp.products||[]).length) return dp.products[0].product_id;
  const el=(DB.elements||[]).find(e=>e.id===elId);
  const ids=(el&&typeof _demElProdIds==='function')?_demElProdIds(el):[];
  return ids[0]||null;
}
// How many tonnes of a demand point's daily demand are swapped OUT on a date — the sum over
// ALL its active swaps. The swap is point-to-point: each leg's volume is relocated to its
// to_element_id (whose own material is the substitute). Returns {qty, legs:[{swap, qty,
// toElement, toProduct}], swap/toElement/toProduct of the first leg} or null.
function _resolveDemandSwap(elementId, todayRate, dateStr){
  if(!todayRate||todayRate<=0) return null;
  const alloc=_demandSwapAlloc(elementId, todayRate, dateStr);
  if(!alloc.length) return null;
  // Substitute material derives from the destination demand point (new model);
  // fall back to the legacy to_product_id field for older records.
  const legs=alloc.map(a=>({swap:a.swap, qty:a.qty, toElement:a.swap.to_element_id||null,
    toProduct:a.swap.to_element_id ? _dpPrimaryProduct(a.swap.to_element_id) : a.swap.to_product_id}));
  return {swap:legs[0].swap, qty:legs.reduce((s,l)=>s+l.qty,0), toElement:legs[0].toElement,
    toProduct:legs[0].toProduct, fromElement:elementId, legs};
}
// Tonnes swapped INTO a demand point on a date, summed over all swaps targeting
// it (each computed from its SOURCE point's own demand). Keyed by to_element_id.
function _resolveDemandSwapIn(toElementId, dateStr, rateFn){
  if(!toElementId) return 0;
  const rate=rateFn||((id)=>(typeof _demandRate==='function')?(_demandRate(id,dateStr)||0):0);
  let q=0;
  const allocBySource={};   // each source point's allocation, shared by all its swaps
  (DB.demand_substitutions||[]).forEach(s=>{
    if(s.to_element_id!==toElementId) return;
    if(!(dateStr>=s.start_date&&dateStr<=s.end_date)) return;
    const alloc=allocBySource[s.from_element_id]
      ||(allocBySource[s.from_element_id]=_demandSwapAlloc(s.from_element_id, rate(s.from_element_id), dateStr));
    const leg=alloc.find(a=>a.swap===s);
    if(leg&&leg.qty>0) q+=leg.qty;
  });
  return q;
}

// ── Demand Swap manager (material substitution) ──────────
function openDemandSwapManager(seedFromEl, seedDate, editId){
  const cementProds=(DB.products||[]).filter(p=>['cement_bulk','cement_packed'].includes(p.category||''))
    .sort((a,b)=>(a.name||a.id).localeCompare(b.name||b.id));
  const dpEls=(DB.elements||[]).filter(e=>e.type==='demand_point').slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const dpOpts=(sel)=>dpEls.map(e=>`<option value="${e.id}"${e.id===sel?' selected':''}>${(e.name||e.id).replace(/"/g,'&quot;')}</option>`).join('');
  const pn=id=>DB.products.find(p=>p.id===id)?.name||id;
  const dpName=id=>DB.elements.find(e=>e.id===id)?.name||id;
  const dpMat=id=>{ const el=DB.elements.find(e=>e.id===id); const ids=(el&&typeof _demElProdIds==='function')?_demElProdIds(el):[]; return ids.length?pn(ids[0]):''; };
  const today=new Date()._ymd();
  // Swap being edited (if any) — its current values pre-fill the form below so
  // every characteristic (from, to, amount, mode, dates) can be changed in place.
  const editing=editId?(DB.demand_substitutions||[]).find(s=>s.id===editId):null;
  const dFrom=editing?editing.from_element_id:(seedFromEl||dpEls[0]?.id);
  const dTo=editing?editing.to_element_id:(dpEls.find(e=>e.id!==(seedFromEl||dpEls[0]?.id))?.id);
  const dAmount=editing?editing.amount:50;
  const dMode=editing?editing.mode:'percent';
  const startVal=editing?editing.start_date:(seedDate||today);
  const endVal=editing?editing.end_date:(seedDate||today);
  const swaps=(DB.demand_substitutions||[]).slice().sort((a,b)=>(a.start_date||'').localeCompare(b.start_date||''));
  const rows=swaps.length?swaps.map(s=>`
    <tr style="border-bottom:1px solid var(--border)${s.id===editId?';background:rgba(var(--amber-rgb),.08)':''}">
      <td style="padding:6px 8px;color:var(--green)">${dpName(s.from_element_id)}${dpMat(s.from_element_id)?`<div style="color:var(--text-dim);font-size:8px">material: ${dpMat(s.from_element_id)}</div>`:''}</td>
      <td style="padding:6px 8px;color:var(--amber)"><i style="font-style:normal">⇄</i> ${s.to_element_id?dpName(s.to_element_id):pn(s.to_product_id)}${s.to_element_id&&dpMat(s.to_element_id)?`<div style="color:var(--text-dim);font-size:8px">material: ${dpMat(s.to_element_id)}</div>`:''}</td>
      <td style="padding:6px 8px;text-align:right;color:var(--text)">${s.mode==='percent'?(s.amount+'%'):(Number(s.amount).toLocaleString()+' t/d')}</td>
      <td style="padding:6px 8px;color:var(--text-dim);font-size:8px">${s.start_date} → ${s.end_date}</td>
      <td style="padding:6px 8px;text-align:right;white-space:nowrap"><button class="tb-btn sec" style="padding:2px 7px;margin-right:4px" onclick="_editDemandSwap('${s.id}')" title="Edit this swap">✎</button><button class="tb-btn sec" style="padding:2px 7px" onclick="_deleteDemandSwap('${s.id}')" title="Delete this swap">✕</button></td>
    </tr>`).join(''):`<tr><td colspan="5" style="padding:12px;text-align:center;color:var(--text-dim)">No demand swaps yet.</td></tr>`;

  showModalContent(`
    <div class="modal-hdr"><span class="modal-title">⇄ Demand Swaps</span><span class="modal-close" onclick="closeModal()">✕</span></div>
    <div class="modal-body" style="font-family:var(--mono);font-size:9px;min-width:580px">
      <div style="color:var(--text-dim);margin-bottom:10px;line-height:1.5">Relocate part of a <b>demand point's</b> demand to <b>another demand point</b>. The source point's demand drops and the destination point's demand rises by the same amount — so it covers both <i>where</i> (the destination location) and <i>what</i> (the destination's material). Production and transfers then follow naturally.</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
        <thead><tr style="color:var(--text-dim);font-size:8px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border2)">
          <th style="text-align:left;padding:5px 8px">From demand point</th><th style="text-align:left;padding:5px 8px">To demand point</th><th style="text-align:right;padding:5px 8px">Amount</th><th style="text-align:left;padding:5px 8px">Dates</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="border-top:1px solid var(--border2);padding-top:12px">
        <input type="hidden" id="ds-edit-id" value="${editId||''}">
        <div style="font-size:8px;letter-spacing:1px;color:${editing?'var(--amber)':'var(--text-dim)'};text-transform:uppercase;margin-bottom:8px">${editing?'✎ Edit swap':'＋ New swap'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px">
          <div><div class="fl">From demand point</div><select class="fi" id="ds-from" style="width:100%">${dpOpts(dFrom)}</select></div>
          <div><div class="fl">To demand point (destination)</div><select class="fi" id="ds-to" style="width:100%">${dpOpts(dTo)}</select></div>
          <div><div class="fl">Amount</div>
            <div style="display:flex;gap:6px">
              <input class="fi" id="ds-amount" type="number" min="0" value="${dAmount}" style="flex:1">
              <select class="fi" id="ds-mode" style="width:110px"><option value="percent"${dMode==='percent'?' selected':''}>% of demand</option><option value="tonnage"${dMode==='tonnage'?' selected':''}>t / day</option></select>
            </div>
          </div>
          <div></div>
          <div><div class="fl">From date</div><input class="fi" id="ds-from-date" type="date" value="${startVal}" style="width:100%"></div>
          <div><div class="fl">To date</div><input class="fi" id="ds-to-date" type="date" value="${endVal}" style="width:100%"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
          ${editing?`<button class="tb-btn sec" onclick="openDemandSwapManager()">Cancel edit</button>`:''}
          <button class="tb-btn sec" onclick="closeModal()">Close</button>
          <button class="tb-btn" style="background:var(--amber);color:var(--bg)" onclick="_saveDemandSwap()">${editing?'✎ Save changes &amp; run':'⇄ Add swap &amp; run'}</button>
        </div>
      </div>
    </div>`);
}
function _saveDemandSwap(){
  const editId=document.getElementById('ds-edit-id')?.value||'';
  const from=document.getElementById('ds-from')?.value;     // source demand point element id
  const to=document.getElementById('ds-to')?.value;         // destination demand point element id
  const mode=document.getElementById('ds-mode')?.value||'percent';
  const amount=parseFloat(document.getElementById('ds-amount')?.value)||0;
  const start=document.getElementById('ds-from-date')?.value;
  const end=document.getElementById('ds-to-date')?.value;
  if(!from||!to||!start||!end){ statMsg('Fill all swap fields'); return; }
  if(from===to){ statMsg('Source and destination demand points must differ'); return; }
  if(start>end){ statMsg('From date must be on or before To date'); return; }
  if(amount<=0){ statMsg('Amount must be greater than 0'); return; }
  if(!DB.demand_substitutions) DB.demand_substitutions=[];
  // Point-to-point: store the destination demand point; keep a derived
  // to_product_id (its material) for labels/colours and legacy readers.
  if(editId){
    const s=DB.demand_substitutions.find(x=>x.id===editId);
    if(s) Object.assign(s,{ from_element_id:from, to_element_id:to, to_product_id:_dpPrimaryProduct(to)||'', mode, amount, start_date:start, end_date:end });
  } else {
    DB.demand_substitutions.push({ id:'swap_'+Date.now(), from_element_id:from, to_element_id:to, to_product_id:_dpPrimaryProduct(to)||'', mode, amount, start_date:start, end_date:end, notes:'' });
  }
  autoSave();
  closeModal();
  _demandChanged();   // Demand page, Supply page or Sales view — whichever is showing — then re-run
  statMsg((editId?'Demand swap updated':'Demand swap saved')+' — running simulation…');
}
// Open the manager with an existing swap loaded into the form for editing.
function _editDemandSwap(id){
  const s=(DB.demand_substitutions||[]).find(x=>x.id===id);
  if(!s){ openDemandSwapManager(); return; }
  openDemandSwapManager(s.from_element_id, s.start_date, id);
}
function _deleteDemandSwap(id){
  DB.demand_substitutions=(DB.demand_substitutions||[]).filter(s=>s.id!==id);
  autoSave();
  _demandChanged();   // it used to leave the projections stale until the next run
  openDemandSwapManager(); // refresh the list
  statMsg('Demand swap removed — running simulation…');
}
// Open the swap dialog from a material context (Supply page CEMENT NEED cell):
// pre-select a demand point that carries that material (prefer current facility)
// and pre-fill the date.
function _openSwapForProduct(prodId, ds){
  const dps=(DB.elements||[]).filter(e=>e.type==='demand_point'&&(typeof _demElProdIds==='function')&&_demElProdIds(e).includes(prodId));
  const inFac=dps.find(e=>(e.facility_id===S.facility_id)||(e.assigned_facility_id===S.facility_id));
  openDemandSwapManager((inFac||dps[0])?.id||'', ds||'');
}

// ═══════════════════════════════════════════════════════
// FINISH-MILL POLICY OVERRIDES (per element, date-bounded)
// ═══════════════════════════════════════════════════════
function _mpProdsOf(millId){
  return [...new Set((DB.element_product_capacities||[])
    .filter(c=>c.element_id===millId&&(parseFloat(c.capacity_tpd)||0)>0)
    .map(c=>c.product_id))];
}
// The Mill Policies screen was retired on 2026-10-25: policies are written rules now (Simulation
// Rules › Production, type mill_operation) and saved policies were converted into them.
function openMillPolicyManager(){
  openRulesPage('production');
  statMsg('Mill Policies are written rules now — your saved policies were converted and are listed under Your rules');
}

function showCampaignPopup(elId, dateStr, runStart, runEnd, runProduct){
  const el=getEl(elId); if(!el) return;
  const existing=getActiveCampaign(elId, dateStr);
  const caps=DB.element_product_capacities.filter(c=>c.element_id===elId);
  if(!caps.length){ statMsg('No products configured for this element'); return; }

  // Existing REAL production already entered for the clicked day (single date = dateStr).
  const existingReal=(DB.real_production_daily||[]).filter(r=>r.date===dateStr&&r.element_id===elId);
  // Default the toggle to Real when real data already exists for this day, else Forecast —
  // except a day that produced nothing and already carries a Down… reason: open on that
  // reason (its campaign, with Delete), since the reason is what the cell shows.
  const realZeroWithReason=existingReal.length&&existingReal.every(r=>!(parseFloat(r.volume_t)>0))&&existing&&DOWNTIME_PRODUCTS[existing.product_id];
  const defaultMode=existingReal.length&&!realZeroWithReason?'real':'forecast';

  // Pre-fill from the saved campaign if any, otherwise from the clicked Gantt run.
  const selProd=(defaultMode==='real'&&existingReal[0]?.product_id)||existing?.product_id||runProduct||caps[0].product_id;

  // Rated output for an element_product_capacities row — packing lines are pallets/day × t/pallet,
  // everything else uses the capacity_tpd field directly.
  const _rowRate=c=>_isPackingRow(c)?_packLineCapT(c):(parseFloat(c.capacity_tpd)||0);
  // Product options + two DOWNTIME choices (0 production, tagged reason). Picking a
  // downtime option forces the rate to 0 (handled by the select's onchange via data-rate)
  // and applyCampaign stores the sentinel product_id so the Gantt shows a distinct bar.
  const prodOpts=caps.map(c=>{
    const p=DB.products.find(pr=>pr.id===c.product_id);
    const rr=_rowRate(c);
    return `<option value="${c.product_id}" data-rate="${rr}" ${selProd===c.product_id?'selected':''}>${p?.name||c.product_id} (${rr} t/d rated)</option>`;
  }).join('')
  + `<option value="__down_repair__" data-rate="0" data-down="1" ${selProd==='__down_repair__'?'selected':''}>🔧 Down For Repairs (0 t/d)</option>`
  + `<option value="__down_pm__" data-rate="0" data-down="1" data-pm="1" ${selProd==='__down_pm__'?'selected':''}>🗓 Down PM Day (½ day · 50%)</option>`
  + `<option value="__down_inv__" data-rate="0" data-down="1" ${selProd==='__down_inv__'?'selected':''}>📋 Down For Inventory Control (0 t/d)</option>`;

  const selCap=caps.find(c=>c.product_id===selProd);
  const currentRate=existing?.rate_tpd||(selCap?_rowRate(selCap):_rowRate(caps[0]))||0;
  // Always prefill "From" with the clicked day, not the campaign/run's original start —
  // otherwise clicking mid-campaign silently jumps the dialog back to day 1 of the run,
  // which reads as if the click landed on the wrong cell.
  const fromVal=dateStr;
  const toVal=existing?.end_date||runEnd||dateStr;
  // In Real mode the rate field holds the actual produced tonnage for the clicked day.
  const realVal=existingReal.find(r=>r.product_id===selProd)?.volume_t ?? existingReal[0]?.volume_t ?? '';
  const initVal=defaultMode==='real'?realVal:currentRate;

  const html=`
  <div style="font-family:var(--mono);font-size:9px;min-width:320px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div>
        <div id="camp-title" style="font-size:11px;font-weight:700;color:${existing?'var(--lime)':'var(--text)'}">
          ${existing?'🔒 Edit Campaign':'+ New Campaign'}
        </div>
        <div style="color:var(--text-dim);margin-top:2px">${esc(el.name)} · ${dateStr}</div>
      </div>
      <button onclick="closeCampaignPopup()" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:16px">✕</button>
    </div>

    <!-- Forecast vs Real toggle -->
    <div style="display:flex;gap:0;margin-bottom:12px;border:1px solid var(--border2);border-radius:3px;overflow:hidden">
      <button type="button" id="camp-mode-forecast" onclick="_campSetMode('forecast')"
        style="flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer">📈 Forecast Campaign</button>
      <button type="button" id="camp-mode-real" onclick="_campSetMode('real')"
        style="flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer">✅ Real Data</button>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="fr s1">
        <div class="ff">
          <div class="fl">Product</div>
          <select class="fi" id="camp-product" onchange="_campProductChanged(this)" style="width:100%">${prodOpts}</select>
        </div>
      </div>
      <div class="fr s2">
        <div class="ff">
          <div class="fl" id="camp-rate-label">Rate (t/d)</div>
          <input class="fi" id="camp-rate" type="number" value="${initVal}" min="0" step="10" style="width:100%">
        </div>
        <div id="camp-rate-hint" style="font-size:8px;color:var(--text-dim);align-self:flex-end;padding-bottom:6px">override topology</div>
      </div>
      <div class="fr s2">
        <div class="ff">
          <div class="fl" id="camp-from-label">From</div>
          <input class="fi" id="camp-from" type="date" onchange="window._campRealAck=false" value="${fromVal}" style="width:100%">
        </div>
        <div class="ff" id="camp-to-field">
          <div class="fl">To</div>
          <input class="fi" id="camp-to" type="date" onchange="window._campRealAck=false" value="${toVal}" style="width:100%">
        </div>
      </div>
    </div>
    <div id="camp-warn" style="display:none;margin-top:10px;padding:6px 8px;border-left:3px solid var(--amber);background:rgba(var(--amber-rgb),.08);color:var(--amber);font-size:9px;line-height:1.5"></div>

    <div style="margin-top:12px;display:flex;gap:8px;justify-content:space-between;align-items:center">
      <div style="display:flex;gap:6px">
        <span id="camp-del-wrap">${existing?`<button onclick="deleteCampaignRange('${elId}','${existing.start_date}','${existing.end_date}')"
          style="padding:5px 10px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid rgba(var(--red-rgb),.5);color:var(--red);cursor:pointer;border-radius:2px">
          ✕ Delete Campaign</button>`:''}</span>
        <span id="camp-clear-real-wrap" style="display:none">${existingReal.length?`<button onclick="_campClearReal('${elId}','${dateStr}')"
          style="padding:5px 10px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid rgba(var(--red-rgb),.5);color:var(--red);cursor:pointer;border-radius:2px">
          ✕ Clear Real Value</button>`:''}</span>
        <button onclick="closeCampaignPopup();switchView('maintenance');" title="Open the Maintenance Calendar to coordinate downtime for this equipment"
          style="padding:5px 10px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--amber);color:var(--amber);cursor:pointer;border-radius:2px">📅 Maintenance Calendar</button>
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="closeCampaignPopup()" style="padding:5px 12px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--border2);color:var(--text-dim);cursor:pointer;border-radius:2px">Cancel</button>
        <button id="camp-apply-btn" onclick="applyCampaign('${elId}')" style="padding:5px 14px;font-family:var(--mono);font-size:9px;background:var(--lime);border:none;color:var(--on-lime);cursor:pointer;font-weight:700;border-radius:2px">🔒 Apply Campaign</button>
      </div>
    </div>
  </div>`;

  // Show in overlay
  let ov=document.getElementById('camp-overlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='camp-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:20000;display:flex;align-items:center;justify-content:center';
    ov.onclick=e=>{ if(e.target===ov) closeCampaignPopup(); };
    document.body.appendChild(ov);
  }
  ov.innerHTML=`<div style="background:var(--surface);border:1px solid var(--lime);padding:18px;border-radius:6px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.6)">${html}</div>`;
  ov.style.display='flex';
  window._campInited=false; window._campRealAck=false;
  _campSetMode(defaultMode);
  _campProductChanged(document.getElementById('camp-product')); // reflect a pre-selected downtime option
  window._campInited=true;
}

// Product-dropdown change in the Campaign popup. Keeps the original behaviour (sync the
// rate field to the picked product's rated output in Forecast mode) and adds downtime
// handling: a "Down For Repairs" / "Down PM Day" option forces the rate to 0, disables the
// rate field, and relabels it so it's clear no production happens. No-op for popups (rail)
// that have no downtime options.
function _campProductChanged(sel){
  if(!sel) return;
  const opt=sel.options[sel.selectedIndex];
  const isDown=opt&&opt.dataset&&opt.dataset.down==='1';
  const rate=document.getElementById('camp-rate');
  const rateLbl=document.getElementById('camp-rate-label');
  const rateHint=document.getElementById('camp-rate-hint');
  const warn=document.getElementById('camp-warn'); if(warn&&window._campInited) warn.style.display='none';
  window._campRealAck=false;
  // Downtime is a plan, never a measured value: picking it while the popup opened in Real
  // mode (it does whenever the day already has actuals) used to make Save silently refuse.
  // Switch to Forecast, and default to ONE day — the "To" otherwise inherits the whole
  // run's end date, turning a single PM day into PM for the rest of the run.
  if(isDown&&window._campInited){
    if(window._campMode==='real') _campSetMode('forecast');
    const f=document.getElementById('camp-from'), t=document.getElementById('camp-to');
    if(f&&t&&f.value) t.value=f.value;
  }
  if(window._campMode!=='real'&&rate) rate.value=opt?opt.dataset.rate:rate.value;
  const isPm=opt&&opt.dataset&&opt.dataset.pm==='1'; // Down PM Day → half-day at 50% (not a full stop)
  if(rate){ rate.disabled=!!isDown; rate.style.opacity=isDown?'.5':'1'; }
  if(isDown){
    if(rate) rate.value='0';
    if(rateLbl) rateLbl.textContent='Rate (t/d)';
    if(rateHint){ rateHint.textContent=isPm?'½ day · runs at 50%':'no production'; rateHint.style.display=''; }
  } else if(rateHint&&(rateHint.textContent==='no production'||rateHint.textContent==='½ day · runs at 50%')){
    rateHint.textContent='override topology';
  }
}

// Switch the Campaign popup between Forecast (date-range campaign) and Real (single-day actual) input.
function _campSetMode(mode){
  window._campMode=mode;
  const real=mode==='real';
  const fBtn=document.getElementById('camp-mode-forecast');
  const rBtn=document.getElementById('camp-mode-real');
  const onSty='background:var(--lime);color:var(--on-lime);font-weight:700';
  const offSty='background:transparent;color:var(--text-dim);font-weight:400';
  if(fBtn) fBtn.style.cssText='flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer;'+(real?offSty:onSty);
  if(rBtn) rBtn.style.cssText='flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer;'+(real?onSty:offSty);
  // Real = a single day → hide the "To" field; relabel From + the value field.
  const toField=document.getElementById('camp-to-field'); if(toField) toField.style.display=real?'none':'';
  const fromLbl=document.getElementById('camp-from-label'); if(fromLbl) fromLbl.textContent=real?'Date':'From';
  const rateLbl=document.getElementById('camp-rate-label'); if(rateLbl) rateLbl.textContent=real?'Actual production (t)':'Rate (t/d)';
  const rateHint=document.getElementById('camp-rate-hint'); if(rateHint) rateHint.style.display=real?'none':'';
  const title=document.getElementById('camp-title'); if(title) title.textContent=real?'✅ Real Production':( (DB.production_campaigns||[]).length||document.getElementById('camp-del-wrap')?.innerHTML?'🔒 Edit Campaign':'+ New Campaign');
  const apply=document.getElementById('camp-apply-btn');
  if(apply){ apply.textContent=real?'✅ Save Real Value':'🔒 Apply Campaign'; apply.style.background=real?'var(--royal)':'var(--lime)'; apply.style.color=real?'#fff':'var(--on-lime)'; }
  // Swap the delete buttons (campaign delete vs clear real value).
  const delW=document.getElementById('camp-del-wrap'); if(delW) delW.style.display=real?'none':'';
  const clrW=document.getElementById('camp-clear-real-wrap'); if(clrW) clrW.style.display=real?'':'none';
}

// Remove a real production entry for the clicked day/element (all products), then re-run.
function _campClearReal(elId, dateStr){
  if(!confirm(`Clear real production for ${dateStr}?\nSimulation will resume forecast/auto-selection for this day.`)) return;
  DB.real_production_daily=(DB.real_production_daily||[]).filter(r=>!(r.date===dateStr&&r.element_id===elId));
  closeCampaignPopup();
  autoSave();
  _demandCacheInvalidate();
  renderSupplyView();
  statMsg('Real production cleared — running simulation…');
  scheduleSimulation();
}

function closeCampaignPopup(){
  const ov=document.getElementById('camp-overlay');
  if(ov) ov.style.display='none';
}

// ── Real Inventory popup (Supply page inventory cells) ───────────────────────
// Supply cell for date X shows BEGINNING-of-day = end-of-day of X-1, so a real value
// entered here is stored at X-1 in real_inventory_daily (Tier-0, same store as the
// Daily Data form / Excel). The clicked cell then reflects the entered number.
function _supInvValueAt(siloId, dateStr){
  const silo=getEl(siloId);
  const startInv=parseFloat(silo?.props?.start_inventory)||0;
  const d=new Date(dateStr+'T00:00:00');
  const pd=new Date(d); pd.setDate(pd.getDate()-1);
  const realInv=(DB.real_inventory_daily||[]).find(ri=>ri.date===pd._ymd()&&ri.silo_id===siloId);
  if(realInv) return {value:parseFloat(realInv.eod_volume_t)||0, isActual:true};
  const r=S.simResults, simStart=S.simCfg?.start_date;
  if(r&&simStart&&r.inventoryHistory?.[siloId]){
    const dayIdx=Math.round((d-new Date(simStart+'T00:00:00'))/86400000);
    const hist=r.inventoryHistory[siloId]||[];
    return {value:(dayIdx<=0?startInv:(hist[dayIdx-1]??0)), isActual:false};
  }
  return {value:startInv, isActual:false};
}

function _invEodDate(asOf){ const d=new Date(asOf+'T00:00:00'); d.setDate(d.getDate()-1); return d._ymd(); }

function showInventoryPopup(siloId, dateStr){
  const silo=getEl(siloId); if(!silo) return;
  const prods=getSiloProducts(silo);
  const eodDate=_invEodDate(dateStr);
  const existing=(DB.real_inventory_daily||[]).filter(r=>r.date===eodDate&&r.silo_id===siloId);
  const selProd=existing[0]?.product_id||prods[0]||'';
  const prodList=prods.length?prods:(selProd?[selProd]:[]);
  const prodOpts=prodList.length
    ? prodList.map(pid=>{ const p=DB.products.find(pr=>pr.id===pid); return `<option value="${pid}" ${selProd===pid?'selected':''}>${p?.name||pid}</option>`; }).join('')
    : '<option value="">(silo product)</option>';
  const siloMax=parseFloat(silo.props?.max_capacity)||0;
  const realRow=existing.find(r=>r.product_id===selProd)||existing[0];
  const initVal=realRow?(parseFloat(realRow.eod_volume_t)||0):Math.round(_supInvValueAt(siloId,dateStr).value);
  const hasReal=existing.length>0;

  const html=`
  <div style="font-family:var(--mono);font-size:9px;min-width:320px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div>
        <div style="font-size:11px;font-weight:700;color:${hasReal?'var(--royal)':'var(--text)'}">${hasReal?'✏️ Edit Real Inventory':'✏️ Set Real Inventory'}</div>
        <div style="color:var(--text-dim);margin-top:2px">${esc(silo.name)} · ${dateStr}${siloMax>0?' · cap '+siloMax.toLocaleString()+'t':''}</div>
      </div>
      <button onclick="closeInventoryPopup()" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:16px">✕</button>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="fr s1">
        <div class="ff">
          <div class="fl">Product</div>
          <select class="fi" id="inv-product" onchange="_invPrefill('${siloId}')" style="width:100%">${prodOpts}</select>
        </div>
      </div>
      <div class="fr s2">
        <div class="ff">
          <div class="fl">Inventory level (t)</div>
          <input class="fi" id="inv-value" type="number" value="${initVal}" min="0" step="10" style="width:100%">
        </div>
        <div style="font-size:8px;color:var(--text-dim);align-self:flex-end;padding-bottom:6px">${hasReal?'actual':'override sim'}</div>
      </div>
      <div class="fr s1">
        <div class="ff">
          <div class="fl">As of (start of day)</div>
          <input class="fi" id="inv-date" type="date" value="${dateStr}" onchange="_invPrefill('${siloId}')" style="width:100%">
        </div>
      </div>
      <div style="font-size:8px;color:var(--text-dim);line-height:1.4">Beginning-of-day level for this date — stored as end-of-day <b>${eodDate}</b>. Treated as real data, like the Daily Data form / Excel.</div>
    </div>

    <div style="margin-top:12px;display:flex;gap:8px;justify-content:space-between;align-items:center">
      <div style="display:flex;gap:6px">
        ${hasReal?`<button onclick="clearInventory('${siloId}')" style="padding:5px 10px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid rgba(var(--red-rgb),.5);color:var(--red);cursor:pointer;border-radius:2px">✕ Clear Real Value</button>`:''}
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="closeInventoryPopup()" style="padding:5px 12px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--border2);color:var(--text-dim);cursor:pointer;border-radius:2px">Cancel</button>
        <button onclick="applyInventory('${siloId}')" style="padding:5px 14px;font-family:var(--mono);font-size:9px;background:var(--royal);border:none;color:#fff;cursor:pointer;font-weight:700;border-radius:2px">✅ Save Real Inventory</button>
      </div>
    </div>
  </div>`;

  let ov=document.getElementById('inv-overlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='inv-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:20000;display:flex;align-items:center;justify-content:center';
    ov.onclick=e=>{ if(e.target===ov) closeInventoryPopup(); };
    document.body.appendChild(ov);
  }
  ov.innerHTML=`<div style="background:var(--surface);border:1px solid var(--royal);padding:18px;border-radius:6px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.6)">${html}</div>`;
  ov.style.display='flex';
}

// Re-prefill the value when the product or as-of date changes (shows the existing real
// value if one exists for that combination, else the simulated level).
function _invPrefill(siloId){
  const asOf=document.getElementById('inv-date')?.value;
  const pid=document.getElementById('inv-product')?.value||'';
  if(!asOf) return;
  const eodDate=_invEodDate(asOf);
  const real=(DB.real_inventory_daily||[]).find(r=>r.date===eodDate&&r.silo_id===siloId&&(r.product_id===pid||!pid));
  const inp=document.getElementById('inv-value');
  if(inp) inp.value=real?(parseFloat(real.eod_volume_t)||0):Math.round(_supInvValueAt(siloId,asOf).value);
}

function applyInventory(siloId){
  const productId=document.getElementById('inv-product')?.value||null;
  const value=parseFloat(document.getElementById('inv-value')?.value);
  const asOf=document.getElementById('inv-date')?.value;
  if(!asOf||isNaN(value)||value<0){ statMsg('Enter a valid date and a non-negative inventory level'); return; }
  const eodDate=_invEodDate(asOf);
  const facId=getEl(siloId)?.assigned_facility_id||getEl(siloId)?.facility_id||S.facility_id;
  const now=new Date().toISOString();
  const existing=(DB.real_inventory_daily||[]).find(r=>r.date===eodDate&&r.silo_id===siloId&&r.product_id===productId);
  if(existing){ existing.eod_volume_t=value; existing.updated_at=now; }
  else DB.real_inventory_daily.push({date:eodDate,facility_id:facId,silo_id:siloId,product_id:productId,eod_volume_t:value,source:'actual',created_at:now,updated_at:now});
  closeInventoryPopup();
  autoSave();
  renderSupplyView();
  statMsg('Real inventory saved — running simulation…');
  scheduleSimulation();
}

function clearInventory(siloId){
  const asOf=document.getElementById('inv-date')?.value;
  if(!asOf) return;
  const eodDate=_invEodDate(asOf);
  if(!confirm(`Clear real inventory for ${asOf}?\nSimulation will resume its projected level for this silo.`)) return;
  DB.real_inventory_daily=(DB.real_inventory_daily||[]).filter(r=>!(r.date===eodDate&&r.silo_id===siloId));
  closeInventoryPopup();
  autoSave();
  renderSupplyView();
  statMsg('Real inventory cleared — running simulation…');
  scheduleSimulation();
}

function closeInventoryPopup(){
  const ov=document.getElementById('inv-overlay');
  if(ov) ov.style.display='none';
}

// ── Terminal "Product Transferred" real-data entry (arrival + unloading) ──────
// Standalone forecast recompute for a terminal/product/date (mirrors the render).
function _termArrPlanAt(facId,pid,ds){
  const simStart=S.simCfg?.start_date?new Date(S.simCfg.start_date+'T00:00:00'):null;
  if(!simStart) return 0;
  let t=0;
  (DB.rail_movements||[]).filter(rm=>rm.to_facility_id===facId&&rm.product_id===pid).forEach(rm=>{
    let depDay=null;
    if(rm.departure_date) depDay=Math.round((new Date(rm.departure_date)-simStart)/864e5)+1;
    else if(rm.switch_day) depDay=rm.switch_day;
    if(!depDay) return;
    const arrDs=dayToDate(depDay+(parseInt(rm.transit_days)||1));   // calendar days (+24h steps fall a day early after the Nov DST change)
    if(arrDs===ds) t+=parseFloat(rm.total_capacity_t)||0;
  });
  const berthIds=new Set((DB.elements||[]).filter(e=>e.type==='berth'&&(e.assigned_facility_id||e.facility_id)===facId).map(b=>b.id));
  (DB.vessel_calls||[]).forEach(vc=>{
    const legs=(vc.legs&&vc.legs.length)?vc.legs:[{berth_element_id:vc.berth_element_id,arrival_date:vc.arrival_date,product_id:vc.product_id,quantity_t:vc.quantity_t||vc.total_quantity_t}];
    legs.forEach(l=>{ if(berthIds.has(l.berth_element_id)&&(l.arrival_date||'').slice(0,10)===ds&&(l.product_id||vc.product_id)===pid) t+=parseFloat(l.quantity_t)||0; });
  });
  return t;
}
function _termUnloadPlanAt(facId,pid,ds){
  const r=S.simResults, simStart=S.simCfg?.start_date; if(!r||!simStart) return 0;
  const dayIdx=Math.round((new Date(ds+'T00:00:00')-new Date(simStart+'T00:00:00'))/86400000);
  const silos=(DB.elements||[]).filter(e=>e.type==='bulk_silo'&&(e.assigned_facility_id||e.facility_id)===facId&&getSiloProducts(e).includes(pid));
  return silos.reduce((s,si)=>s+((r.siloUnloadHistory?.[si.id]||[])[dayIdx]||0),0);
}
// Pick a berth at the facility that feeds this product (for real_unloading_daily.berth_id).
function _termBerthForProduct(facId,pid){
  const berths=(DB.elements||[]).filter(e=>e.type==='berth'&&(e.assigned_facility_id||e.facility_id)===facId);
  const fed=berths.find(b=>(DB.elements||[]).some(s=>s.type==='bulk_silo'&&getSiloProducts(s).includes(pid)
    &&(DB.connections||[]).some(c=>c.from_element_id===b.id&&c.to_element_id===s.id)));
  return (fed||berths[0])?.id||'';
}
// Infer the dominant origin facility shipping this product to the terminal (for real_transfers_daily).
function _termOriginForProduct(facId,pid){
  const c={};
  (DB.rail_movements||[]).filter(rm=>rm.to_facility_id===facId&&rm.product_id===pid&&_railMoveOriginFacId(rm))
    .forEach(rm=>{ const o=_railMoveOriginFacId(rm); c[o]=(c[o]||0)+1; });
  const best=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];
  return best?best[0]:(S.facility_id||'');
}
// Real unloaded TONNES for a berth/product/date. Prefers tonne rows; converts genuine railcar
// rows via the berth's car capacity. Dedups the mixed-unit case (a berth+product+day with both
// a 'cars' row and a 't' row uses the tonne value, not their sum). Consumed by BOTH the display
// and the simulation so entered real unloading feeds silo inventory.
function realUnloadTonnesBerthProdDay(berthId,pid,ds){
  const rows=(DB.real_unloading_daily||[]).filter(u=>u.berth_id===berthId&&u.product_id===pid&&u.date===ds);
  if(!rows.length) return 0;
  const tRows=rows.filter(u=>u.unit!=='cars');
  if(tRows.length) return tRows.reduce((s,u)=>s+(parseFloat(u.value)||0),0);
  const cc=parseFloat((DB.elements||[]).find(e=>e.id===berthId)?.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
  return rows.reduce((s,u)=>s+(parseFloat(u.value)||0),0)*cc;
}
// Sum real unloaded tonnes across a facility's berths for a product/date.
function realUnloadTonnesFacProdDay(facId,pid,ds){
  return (DB.elements||[]).filter(e=>e.type==='berth'&&(e.assigned_facility_id||e.facility_id)===facId)
    .reduce((s,b)=>s+realUnloadTonnesBerthProdDay(b.id,pid,ds),0);
}

function showTermRealPopup(kind,facId,pid,ds){
  const fac=DB.facilities.find(f=>f.id===facId);
  const prod=DB.products.find(p=>p.id===pid);
  const isTr=kind==='transfer';
  const label=isTr?'Transfer / Arrival':'Unloading';
  const existing=isTr
    ?(DB.real_transfers_daily||[]).filter(t=>t.date===ds&&t.dest_facility_id===facId&&t.product_id===pid)
    :(DB.real_unloading_daily||[]).filter(u=>u.date===ds&&u.facility_id===facId&&u.product_id===pid);
  const hasReal=existing.length>0;
  const realSum=isTr?existing.reduce((s,x)=>s+(parseFloat(x.volume_t)||0),0):realUnloadTonnesFacProdDay(facId,pid,ds);
  const planVal=isTr?_termArrPlanAt(facId,pid,ds):_termUnloadPlanAt(facId,pid,ds);
  const initVal=Math.round(hasReal?realSum:planVal);
  // Rail terminals enter unloading as CARS (for the table) + TONNES (for the calc).
  const railBerth=kind==='unload'?(DB.elements||[]).find(e=>e.type==='berth'&&(e.props?.berth_type||'')==='Rail Receiving'&&(e.assigned_facility_id||e.facility_id)===facId):null;
  const isRail=!!railBerth;
  const carCap=parseFloat(railBerth?.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
  const _realCarsSum=(DB.real_unloading_daily||[]).filter(u=>u.date===ds&&u.product_id===pid&&u.facility_id===facId)
    .reduce((s,u)=>s+(u.cars!=null?(parseFloat(u.cars)||0):u.unit==='cars'?(parseFloat(u.value)||0):((parseFloat(u.value)||0)/carCap)),0);
  const initCars=Math.round(hasReal?_realCarsSum:(planVal/carCap));
  window._termRealCtx={kind,facId,pid,ds,isRail,carCap};

  const html=`
  <div style="font-family:var(--mono);font-size:9px;min-width:320px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div>
        <div style="font-size:11px;font-weight:700;color:${hasReal?'var(--purple)':'var(--text)'}">${hasReal?'✏️ Edit Real '+label:'✏️ Set Real '+label}</div>
        <div style="color:var(--text-dim);margin-top:2px">${fac?.name||facId} · ${prod?.name||pid} · ${ds}</div>
      </div>
      <button onclick="closeTermRealPopup()" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:16px">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${isRail?`
      <div class="fr s2">
        <div class="ff">
          <div class="fl">Railcars unloaded</div>
          <input class="fi" id="term-real-cars" type="number" value="${initCars}" min="0" step="1" oninput="_termUnlCarsChanged()" style="width:100%">
        </div>
        <div style="font-size:8px;color:var(--text-dim);align-self:flex-end;padding-bottom:6px">for the table</div>
      </div>
      <div class="fr s2">
        <div class="ff">
          <div class="fl">Total unloaded (t)</div>
          <input class="fi" id="term-real-value" type="number" value="${initVal}" min="0" step="10" style="width:100%">
        </div>
        <div style="font-size:8px;color:var(--text-dim);align-self:flex-end;padding-bottom:6px">for the calc</div>
      </div>
      `:`
      <div class="fr s2">
        <div class="ff">
          <div class="fl">${label} (t)</div>
          <input class="fi" id="term-real-value" type="number" value="${initVal}" min="0" step="10" style="width:100%">
        </div>
        <div style="font-size:8px;color:var(--text-dim);align-self:flex-end;padding-bottom:6px">${hasReal?'actual':'override forecast'}</div>
      </div>
      `}
      <div class="fr s1">
        <div class="ff">
          <div class="fl">Date</div>
          <input class="fi" id="term-real-date" type="date" value="${ds}" onchange="_termRealPrefill()" style="width:100%">
        </div>
      </div>
      <div style="font-size:8px;color:var(--text-dim);line-height:1.4">${isTr?'Actual tonnage transferred/arrived at this terminal for this product.':isRail?'Enter the cars unloaded (shown in the table) and the actual tonnes (used for inventory). Editing cars suggests tonnes at '+carCap+' t/car; adjust tonnes to the scale ticket.':'Actual tonnage unloaded into this terminal\'s silos for this product.'} Treated as real data, like the Daily Data form.</div>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;justify-content:space-between;align-items:center">
      <div style="display:flex;gap:6px">
        ${hasReal?`<button onclick="clearTermReal()" style="padding:5px 10px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid rgba(var(--red-rgb),.5);color:var(--red);cursor:pointer;border-radius:2px">✕ Clear Real Value</button>`:''}
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="closeTermRealPopup()" style="padding:5px 12px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--border2);color:var(--text-dim);cursor:pointer;border-radius:2px">Cancel</button>
        <button onclick="applyTermReal()" style="padding:5px 14px;font-family:var(--mono);font-size:9px;background:var(--purple);border:none;color:var(--on-purple);cursor:pointer;font-weight:700;border-radius:2px">✅ Save Real ${label}</button>
      </div>
    </div>
  </div>`;

  let ov=document.getElementById('term-real-overlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='term-real-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:20000;display:flex;align-items:center;justify-content:center';
    ov.onclick=e=>{ if(e.target===ov) closeTermRealPopup(); };
    document.body.appendChild(ov);
  }
  ov.innerHTML=`<div style="background:var(--surface);border:1px solid var(--purple);padding:18px;border-radius:6px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.6)">${html}</div>`;
  ov.style.display='flex';
}

function _termRealPrefill(){
  const ctx=window._termRealCtx; if(!ctx) return;
  const ds=document.getElementById('term-real-date')?.value; if(!ds) return;
  const isTr=ctx.kind==='transfer';
  const existing=isTr
    ?(DB.real_transfers_daily||[]).filter(t=>t.date===ds&&t.dest_facility_id===ctx.facId&&t.product_id===ctx.pid)
    :(DB.real_unloading_daily||[]).filter(u=>u.date===ds&&u.facility_id===ctx.facId&&u.product_id===ctx.pid);
  const val=existing.length
    ?(isTr?existing.reduce((s,x)=>s+(parseFloat(x.volume_t)||0),0):realUnloadTonnesFacProdDay(ctx.facId,ctx.pid,ds))
    :(isTr?_termArrPlanAt(ctx.facId,ctx.pid,ds):_termUnloadPlanAt(ctx.facId,ctx.pid,ds));
  const inp=document.getElementById('term-real-value'); if(inp) inp.value=Math.round(val);
  const cInp=document.getElementById('term-real-cars');
  if(cInp&&ctx.isRail){ const cc=ctx.carCap||RAIL_CAR_T_DEFAULT;
    const rows=(DB.real_unloading_daily||[]).filter(u=>u.date===ds&&u.product_id===ctx.pid&&u.facility_id===ctx.facId);
    const realCars=rows.length?rows.reduce((s,u)=>s+(u.cars!=null?(parseFloat(u.cars)||0):u.unit==='cars'?(parseFloat(u.value)||0):((parseFloat(u.value)||0)/cc)),0):null;
    cInp.value=Math.round(realCars!=null?realCars:(val/cc));
  }
}
// Rail unload dialog: typing a car count suggests the tonnage (cars × car capacity); the user
// can then edit tonnes to the exact scale-ticket figure. Tonnes is what the simulation uses.
function _termUnlCarsChanged(){
  const ctx=window._termRealCtx; if(!ctx||!ctx.isRail) return;
  const cars=parseFloat(document.getElementById('term-real-cars')?.value);
  const tIn=document.getElementById('term-real-value');
  if(tIn&&!isNaN(cars)&&cars>=0) tIn.value=Math.round(cars*(ctx.carCap||RAIL_CAR_T_DEFAULT));
}

function applyTermReal(){
  const ctx=window._termRealCtx; if(!ctx) return;
  const ds=document.getElementById('term-real-date')?.value;
  const value=parseFloat(document.getElementById('term-real-value')?.value);
  if(!ds||isNaN(value)||value<0){ statMsg('Enter a valid date and a non-negative tonnage'); return; }
  const now=new Date().toISOString();
  if(ctx.kind==='transfer'){
    DB.real_transfers_daily=(DB.real_transfers_daily||[]).filter(t=>!(t.date===ds&&t.dest_facility_id===ctx.facId&&t.product_id===ctx.pid));
    DB.real_transfers_daily.push({date:ds,origin_facility_id:_termOriginForProduct(ctx.facId,ctx.pid),dest_facility_id:ctx.facId,mode:'rail',product_id:ctx.pid,volume_t:value,source:'actual',created_at:now,updated_at:now});
  } else {
    // Remove ANY prior rows for this berth/product/day (incl. stale 'cars' rows from the Daily
    // Data form) so the two input paths don't leave duplicates that double-count.
    const berthId=_termBerthForProduct(ctx.facId,ctx.pid);
    DB.real_unloading_daily=(DB.real_unloading_daily||[]).filter(u=>!(u.date===ds&&u.product_id===ctx.pid&&(u.facility_id===ctx.facId||u.berth_id===berthId)));
    // value = tonnes (used by the sim for inventory). For rail, also store the entered CAR
    // count for the table display (cars ≠ tonnes/carCap exactly, so keep both).
    const row={date:ds,facility_id:ctx.facId,berth_id:berthId,product_id:ctx.pid,mode:ctx.isRail?'rail':'ship',value,unit:'t',source:'actual',created_at:now,updated_at:now};
    if(ctx.isRail){ const carsV=parseFloat(document.getElementById('term-real-cars')?.value); if(!isNaN(carsV)&&carsV>=0) row.cars=Math.round(carsV); }
    DB.real_unloading_daily.push(row);
  }
  closeTermRealPopup();
  autoSave();
  renderSupplyView();
  statMsg('Real value saved — running simulation…');
  scheduleSimulation();
}

function clearTermReal(){
  const ctx=window._termRealCtx; if(!ctx) return;
  const ds=document.getElementById('term-real-date')?.value||ctx.ds;
  if(!confirm('Clear this real value for '+ds+'?\nThe forecast will resume for this cell.')) return;
  if(ctx.kind==='transfer'){
    DB.real_transfers_daily=(DB.real_transfers_daily||[]).filter(t=>!(t.date===ds&&t.dest_facility_id===ctx.facId&&t.product_id===ctx.pid));
  } else {
    const berthId=_termBerthForProduct(ctx.facId,ctx.pid);
    DB.real_unloading_daily=(DB.real_unloading_daily||[]).filter(u=>!(u.date===ds&&u.product_id===ctx.pid&&(u.facility_id===ctx.facId||u.berth_id===berthId)));
  }
  closeTermRealPopup();
  autoSave();
  renderSupplyView();
  statMsg('Real value cleared — running simulation…');
  scheduleSimulation();
}

function closeTermRealPopup(){
  const ov=document.getElementById('term-real-overlay');
  if(ov) ov.style.display='none';
}

// ═══════════════════════════════════════════════════════
// VESSEL CAMPAIGN POPUP — the FM-style manual override for a specific vessel's
// berth status (Anchorage / Unloading) over a date range. Mirrors showCampaignPopup:
// single click on a vessel's Gantt run, pre-filled from that run's current dates/state.
// ═══════════════════════════════════════════════════════

// Per-day Anchorage/Unloading timeline for ONE vessel at ONE berth, read straight from the
// last simulation's berthVesselHistory (not re-simulated) — used only to find the contiguous
// run containing the clicked date so the popup can pre-fill From/To.
function _vesselOwnTimeline(berthId, vesselCallId){
  const hist=S.simResults?.berthVesselHistory?.[berthId]||[];
  return hist.map(bv=>{
    if(!bv) return null;
    if(bv.dockedCallId===vesselCallId) return bv.state==='unloading'?'unloading':'anchorage';
    if((bv.waitingList||[]).some(w=>w.vesselCallId===vesselCallId)) return 'anchorage';
    return null;
  });
}
function _vesselRunAt(berthId, vesselCallId, dateStr){
  const tl=_vesselOwnTimeline(berthId, vesselCallId);
  const idx=dateToDayOffset(dateStr, S.simCfg.start_date);
  const addDays=n=>{ const d=new Date(S.simCfg.start_date+'T00:00:00'); d.setDate(d.getDate()+n); return d._ymd(); };
  if(idx<0||idx>=tl.length||!tl[idx]) return {start:dateStr, end:dateStr, state:'anchorage'};
  const st=tl[idx];
  let s=idx,e=idx;
  while(s>0&&tl[s-1]===st) s--;
  while(e<tl.length-1&&tl[e+1]===st) e++;
  return {start:addDays(s), end:addDays(e), state:st};
}

function showVesselCampaignPopup(berthId, vesselCallId, dateStr){
  if(!vesselCallId){ statMsg('No vessel scheduled here to override'); return; }
  const v=DB.vessel_calls.find(x=>x.id===vesselCallId); if(!v) return;
  const berth=getEl(berthId);
  const facId=berth?.assigned_facility_id||berth?.facility_id||S.facility_id;
  const pid=v.product_id;
  const existing=(DB.vessel_campaigns||[]).find(c=>c.vessel_call_id===vesselCallId&&dateStr>=c.start_date&&dateStr<=c.end_date);
  const run=_vesselRunAt(berthId, vesselCallId, dateStr);
  // Always prefill "From" with the clicked day, not the run's original start — see
  // showCampaignPopup for why (same fix, same reasoning).
  const fromVal=dateStr;
  const toVal=existing?.end_date||run.end||dateStr;
  const action=existing?.action||run.state||'anchorage';

  // Existing REAL unloading already entered for the clicked day (mirrors showTermRealPopup).
  const existingReal=(DB.real_unloading_daily||[]).filter(u=>u.date===dateStr&&u.berth_id===berthId&&u.product_id===pid);
  const defaultMode=existingReal.length?'real':'forecast';
  const realVal=Math.round(existingReal.length?realUnloadTonnesBerthProdDay(berthId,pid,dateStr):_termUnloadPlanAt(facId,pid,dateStr));

  window._vCampCtx={berthId, vesselCallId, facId, pid, existingId:existing?.id||null};

  const html=`
  <div style="font-family:var(--mono);font-size:9px;min-width:320px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div>
        <div id="vcamp-title" style="font-size:11px;font-weight:700;color:${existing?'var(--lime)':'var(--text)'}">${existing?'🔒 Edit Campaign':'+ New Campaign'}</div>
        <div style="color:var(--text-dim);margin-top:2px">${v.name} · ${berth?.name||''} · ${dateStr}</div>
      </div>
      <button onclick="closeVesselCampaignPopup()" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:16px">✕</button>
    </div>

    <!-- Forecast vs Real toggle -->
    <div style="display:flex;gap:0;margin-bottom:12px;border:1px solid var(--border2);border-radius:3px;overflow:hidden">
      <button type="button" id="vcamp-mode-forecast" onclick="_vCampSetMode('forecast')"
        style="flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer">📈 Forecast Campaign</button>
      <button type="button" id="vcamp-mode-real" onclick="_vCampSetMode('real')"
        style="flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer">✅ Real Data</button>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="fr s1" id="vcamp-action-field">
        <div class="ff">
          <div class="fl">Action</div>
          <select class="fi" id="vcamp-action" style="width:100%">
            <option value="anchorage" ${action==='anchorage'?'selected':''}>⚓ Anchorage</option>
            <option value="unloading" ${action==='unloading'?'selected':''}>Unloading</option>
          </select>
        </div>
      </div>
      <div class="fr s2" id="vcamp-value-field" style="display:none">
        <div class="ff">
          <div class="fl">Actual unloaded (t)</div>
          <input class="fi" id="vcamp-value" type="number" value="${realVal}" min="0" step="10" style="width:100%">
        </div>
      </div>
      <div class="fr s2">
        <div class="ff"><div class="fl" id="vcamp-from-label">From</div><input class="fi" id="vcamp-from" type="date" value="${fromVal}" style="width:100%"></div>
        <div class="ff" id="vcamp-to-field"><div class="fl">To</div><input class="fi" id="vcamp-to" type="date" value="${toVal}" style="width:100%"></div>
      </div>
    </div>
    <div id="vcamp-hint" style="font-size:8px;color:var(--text-dim);line-height:1.5;margin-top:8px"></div>
    <div id="vcamp-warn" style="display:none;margin-top:10px;padding:6px 8px;border-left:3px solid var(--amber);background:rgba(var(--amber-rgb),.08);color:var(--amber);font-size:9px;line-height:1.5"></div>
    <div style="margin-top:12px;display:flex;gap:8px;justify-content:space-between;align-items:center">
      <div style="display:flex;gap:6px">
        <span id="vcamp-del-wrap">${existing?`<button onclick="deleteVesselCampaign()" style="padding:5px 10px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid rgba(var(--red-rgb),.5);color:var(--red);cursor:pointer;border-radius:2px">✕ Delete Campaign</button>`:''}</span>
        <span id="vcamp-clear-real-wrap" style="display:none">${existingReal.length?`<button onclick="clearVesselReal()" style="padding:5px 10px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid rgba(var(--red-rgb),.5);color:var(--red);cursor:pointer;border-radius:2px">✕ Clear Real Value</button>`:''}</span>
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="closeVesselCampaignPopup()" style="padding:5px 12px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--border2);color:var(--text-dim);cursor:pointer;border-radius:2px">Cancel</button>
        <button id="vcamp-apply-btn" onclick="applyVesselCampaign()" style="padding:5px 14px;font-family:var(--mono);font-size:9px;background:var(--lime);border:none;color:var(--on-lime);cursor:pointer;font-weight:700;border-radius:2px">🔒 Apply Campaign</button>
      </div>
    </div>
  </div>`;

  let ov=document.getElementById('vcamp-overlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='vcamp-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:20000;display:flex;align-items:center;justify-content:center';
    ov.onclick=e=>{ if(e.target===ov) closeVesselCampaignPopup(); };
    document.body.appendChild(ov);
  }
  ov.innerHTML=`<div style="background:var(--surface);border:1px solid var(--lime);padding:18px;border-radius:6px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.6)">${html}</div>`;
  ov.style.display='flex';
  _vCampSetMode(defaultMode);
}
function closeVesselCampaignPopup(){
  const ov=document.getElementById('vcamp-overlay');
  if(ov) ov.style.display='none';
}

// Switch the popup between Forecast (Anchorage/Unloading campaign) and Real (single-day
// actual unloaded tonnage) input — mirrors _campSetMode for finish mills exactly.
function _vCampSetMode(mode){
  window._vCampMode=mode;
  const real=mode==='real';
  const fBtn=document.getElementById('vcamp-mode-forecast');
  const rBtn=document.getElementById('vcamp-mode-real');
  const onSty='background:var(--lime);color:var(--on-lime);font-weight:700';
  const offSty='background:transparent;color:var(--text-dim);font-weight:400';
  if(fBtn) fBtn.style.cssText='flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer;'+(real?offSty:onSty);
  if(rBtn) rBtn.style.cssText='flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer;'+(real?onSty:offSty);
  const actionField=document.getElementById('vcamp-action-field'); if(actionField) actionField.style.display=real?'none':'';
  const valueField=document.getElementById('vcamp-value-field'); if(valueField) valueField.style.display=real?'':'none';
  const toField=document.getElementById('vcamp-to-field'); if(toField) toField.style.display=real?'none':'';
  const fromLbl=document.getElementById('vcamp-from-label'); if(fromLbl) fromLbl.textContent=real?'Date':'From';
  const title=document.getElementById('vcamp-title');
  if(title) title.textContent=real?'✅ Real Unloading':(document.getElementById('vcamp-del-wrap')?.innerHTML?'🔒 Edit Campaign':'+ New Campaign');
  const apply=document.getElementById('vcamp-apply-btn');
  if(apply){ apply.textContent=real?'✅ Save Real Value':'🔒 Apply Campaign'; apply.style.background=real?'var(--royal)':'var(--lime)'; apply.style.color=real?'#fff':'var(--on-lime)'; }
  const delW=document.getElementById('vcamp-del-wrap'); if(delW) delW.style.display=real?'none':'';
  const clrW=document.getElementById('vcamp-clear-real-wrap'); if(clrW) clrW.style.display=real?'':'none';
  const hint=document.getElementById('vcamp-hint');
  if(hint) hint.textContent=real
    ?'Actual tonnage unloaded into this terminal\'s silos for this product on this day. Treated as real data, like the Daily Data form — always wins over any campaign below.'
    :'Forces this vessel\'s status at this berth for the chosen dates, overriding the simulator\'s own logic. Unloading uses the vessel\'s own cargo/rate and gets priority over the normal berth queue (still capped by destination silo space). Real unloading entries always win over this for the days they cover.';
}

function applyVesselCampaign(){
  const ctx=window._vCampCtx; if(!ctx) return;
  if(window._vCampMode==='real'){
    const value=parseFloat(document.getElementById('vcamp-value')?.value);
    const ds=document.getElementById('vcamp-from')?.value;
    if(!ds||isNaN(value)||value<0){ _campWarn('Enter a valid date and a non-negative tonnage','vcamp'); return; }
    const now=new Date().toISOString();
    DB.real_unloading_daily=(DB.real_unloading_daily||[]).filter(u=>!(u.date===ds&&u.product_id===ctx.pid&&(u.facility_id===ctx.facId||u.berth_id===ctx.berthId)));
    DB.real_unloading_daily.push({date:ds,facility_id:ctx.facId,berth_id:ctx.berthId,product_id:ctx.pid,mode:'ship',value,unit:'t',source:'actual',created_at:now,updated_at:now});
    closeVesselCampaignPopup();
    autoSave(); renderSupplyView(); statMsg('Real value saved — running simulation…'); scheduleSimulation();
    return;
  }
  const from=document.getElementById('vcamp-from')?.value;
  const to=document.getElementById('vcamp-to')?.value;
  const action=document.getElementById('vcamp-action')?.value;
  if(!from||!to||from>to){ _campWarn('Enter a valid date range','vcamp'); return; }
  if(!DB.vessel_campaigns) DB.vessel_campaigns=[];
  // Remove any overlapping campaign for this SAME vessel — one forced action per day —
  // mirroring applyCampaign()'s overlap handling for finish mills.
  DB.vessel_campaigns=_campSplice(DB.vessel_campaigns, c=>c.vessel_call_id===ctx.vesselCallId, from, to);
  DB.vessel_campaigns.push({id:`vcamp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, vessel_call_id:ctx.vesselCallId, action, start_date:from, end_date:to});
  closeVesselCampaignPopup();
  autoSave(); renderSupplyView(); statMsg('Campaign applied — running simulation…'); scheduleSimulation();
}
function deleteVesselCampaign(){
  const ctx=window._vCampCtx; if(!ctx||!ctx.existingId) return;
  DB.vessel_campaigns=(DB.vessel_campaigns||[]).filter(c=>c.id!==ctx.existingId);
  closeVesselCampaignPopup();
  autoSave(); renderSupplyView(); statMsg('Campaign deleted — running simulation…'); scheduleSimulation();
}
function clearVesselReal(){
  const ctx=window._vCampCtx; if(!ctx) return;
  const ds=document.getElementById('vcamp-from')?.value;
  if(!confirm('Clear this real value for '+ds+'?\nThe forecast will resume for this cell.')) return;
  DB.real_unloading_daily=(DB.real_unloading_daily||[]).filter(u=>!(u.date===ds&&u.product_id===ctx.pid&&(u.facility_id===ctx.facId||u.berth_id===ctx.berthId)));
  closeVesselCampaignPopup();
  autoSave(); renderSupplyView(); statMsg('Real value cleared — running simulation…'); scheduleSimulation();
}

function applyCampaign(elId){
  const productId=document.getElementById('camp-product')?.value;
  const rateTpd=parseFloat(document.getElementById('camp-rate')?.value)||0;
  const fromDate=document.getElementById('camp-from')?.value;
  let toDate=document.getElementById('camp-to')?.value;

  // REAL mode: write a single-day actual to real_production_daily (Tier 0 — same as Daily Data / Excel).
  // A Down… reason picked here is not a measured value: the day's actual stays as it is (often
  // the production feed's 0 t) and the reason is saved below as a ONE-day downtime campaign —
  // what the Production page shows on that 0 t day and what Push to BI reports as its reason.
  if(window._campMode==='real'&&DOWNTIME_PRODUCTS[productId]) toDate=fromDate;
  else if(window._campMode==='real'){
    if(!productId||!fromDate){ _campWarn('Please choose a product and date'); return; }
    const facId=getEl(elId)?.assigned_facility_id||getEl(elId)?.facility_id||S.facility_id;
    const now=new Date().toISOString();
    // Upsert: one row per element+product+date.
    const existing=(DB.real_production_daily||[]).find(r=>r.date===fromDate&&r.element_id===elId&&r.product_id===productId);
    if(existing){ existing.volume_t=rateTpd; existing.updated_at=now; }
    else DB.real_production_daily.push({date:fromDate,facility_id:facId,element_id:elId,product_id:productId,volume_t:rateTpd,source:'actual',created_at:now,updated_at:now});
    closeCampaignPopup();
    autoSave();
    _demandCacheInvalidate();
    renderSupplyView();
    statMsg('Real production saved — running simulation…');
    scheduleSimulation();
    return;
  }

  if(!productId||!fromDate||!toDate){ _campWarn('Please fill all fields'); return; }
  if(fromDate>toDate){ _campWarn('“From” must be on or before “To”'); return; }
  // Real production always wins over a campaign, so on days that already have actuals the
  // campaign is saved but never shows. Say so once; a second click on Apply saves anyway.
  if(!window._campRealAck){
    const realDays=[...new Set((DB.real_production_daily||[]).filter(r=>r.element_id===elId&&r.date>=fromDate&&r.date<=toDate&&(parseFloat(r.volume_t)||0)>0).map(r=>r.date))].sort();
    if(realDays.length){
      window._campRealAck=true;
      _campWarn(`${realDays.length===1?realDays[0]+' already has':realDays.length+' days in this range ('+realDays[0]+' → '+realDays[realDays.length-1]+') already have'} real production. Real data wins, so the campaign won't show there. Click Apply again to save anyway, or move “From”.`);
      return;
    }
  }

  // Overlapping campaigns for this element are TRIMMED to make room, not deleted: a one-day
  // PM inside a 10-day campaign used to wipe the whole campaign.
  DB.production_campaigns=_campSplice(DB.production_campaigns||[], c=>c.element_id===elId, fromDate, toDate);

  // Add new campaign
  DB.production_campaigns.push({
    id:'camp_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
    element_id:elId,
    product_id:productId,
    start_date:fromDate,
    end_date:toDate,
    rate_tpd:rateTpd,
    notes:''
  });

  closeCampaignPopup();
  autoSave();
  renderSupplyView();
  statMsg('Campaign saved — running simulation…');
  scheduleSimulation();
}

// ── Drag a campaign's start / end on the Supply Gantts ──────────────────────────────────
// Campaign start/end cells carry a grip (_campGrips); dragging it along its row moves that
// edge. On release the campaign takes the new dates and any other campaign of the same row
// it now overlaps is trimmed (_campSplice) — the same rule as saving from the popup. Works
// for every row that tags its day cells with data-ds and its grips with a store:
//   prod   → DB.production_campaigns (kilns, finish mills, packing machines)
//   vessel → DB.vessel_campaigns     (Anchorage / Unloading overrides)
//   xfer   → DB.silo_transfer_plans  (silo transfer campaigns — one link + direction per row)
const _CAMP_STORES={
  prod:  {key:'production_campaigns', same:c=>x=>x.element_id===c.element_id},
  vessel:{key:'vessel_campaigns',     same:c=>x=>x.vessel_call_id===c.vessel_call_id},
  xfer:  {key:'silo_transfer_plans',  same:c=>x=>x.link_id===c.link_id&&x.from_silo_id===c.from_silo_id&&x.to_silo_id===c.to_silo_id},
};

// ── Campaign tidy-up: one campaign per day per element / vessel / transfer link ──────────
// Saving from a popup or dragging an edge trims whatever the new campaign overlaps
// (_campSplice), so one browser never keeps two campaigns on the same day. Two browsers
// entering campaigns at the same time each add their own row and the shared-file merge keeps
// both — then the simulation used whichever came first in the list (seen 7 Oct: YASA YASMEEN
// Anchorage 2–11 Oct twice, Unloading 12–20 and 12–24). After every load and merge, a group
// that overlaps is replayed in the order its campaigns were CREATED (the timestamp in the id)
// through the same trimming rule: the campaign added LAST wins where they overlap, an exact
// duplicate collapses to one, and touching pieces with the same content join up again. Piece
// ids derive from the original ids, so every browser tidies to identical rows (random ids
// would look like new rows to the merge and the duplicates would keep coming back).
const _CAMP_GROUP={prod:c=>c.element_id, vessel:c=>c.vessel_call_id, xfer:c=>c.link_id+'|'+c.from_silo_id+'|'+c.to_silo_id};
const _campCreated=c=>{ const m=/_(\d{12,14})(?:_|$)/.exec(c.id||''); return m?+m[1]:0; };
function _campTidy(){
  const tidied=[];
  const same=(a,b)=>{ const ks=new Set([...Object.keys(a),...Object.keys(b)]);
    for(const k of ks){ if(k==='id'||k==='start_date'||k==='end_date') continue; if(JSON.stringify(a[k])!==JSON.stringify(b[k])) return false; } return true; };
  Object.entries(_CAMP_STORES).forEach(([store,st])=>{
    const list=DB[st.key]; if(!Array.isArray(list)||list.length<2) return;
    const groups=new Map();
    list.forEach(c=>{ const k=_CAMP_GROUP[store](c); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(c); });
    const redo=new Map();
    groups.forEach((g,k)=>{
      if(g.length<2) return;
      const byStart=[...g].sort((a,b)=>a.start_date<b.start_date?-1:a.start_date>b.start_date?1:0);
      let maxEnd='', overlap=false;
      byStart.forEach(c=>{ if(maxEnd&&c.start_date<=maxEnd) overlap=true; if(c.end_date>maxEnd) maxEnd=c.end_date; });
      if(!overlap) return;
      const byAge=[...g].sort((a,b)=>_campCreated(a)-_campCreated(b)||String(a.id).localeCompare(String(b.id)));
      let kept=[];
      byAge.forEach(c=>{
        const nx=[];
        kept.forEach(o=>{
          if(o.end_date<c.start_date||o.start_date>c.end_date){ nx.push(o); return; }
          if(o.start_date<c.start_date) nx.push({...o, end_date:_addDays(c.start_date,-1)});
          if(o.end_date>c.end_date){ const s=_addDays(c.end_date,1); nx.push({...o, id:o.id+'_t'+s.replace(/-/g,''), start_date:s}); }
        });
        nx.push({...c}); kept=nx;
      });
      kept.sort((a,b)=>a.start_date<b.start_date?-1:a.start_date>b.start_date?1:0);
      const joined=[];
      kept.forEach(c=>{ const p=joined[joined.length-1];
        if(p&&_addDays(p.end_date,1)===c.start_date&&same(p,c)) p.end_date=c.end_date; else joined.push(c); });
      redo.set(k, joined);
      const nm=store==='vessel'?(DB.vessel_calls.find(v=>v.id===k)?.name||'vessel').trim()
              :store==='prod'?(DB.elements.find(e=>e.id===k)?.name||'equipment'):'silo transfer';
      tidied.push(nm);
    });
    if(!redo.size) return;
    const out=[], done=new Set();
    list.forEach(c=>{ const k=_CAMP_GROUP[store](c);
      if(!redo.has(k)){ out.push(c); return; }
      if(!done.has(k)){ done.add(k); out.push(...redo.get(k)); } });
    DB[st.key]=out;
  });
  return tidied;
}
// After a load or a merge: tidy, and when anything changed save it (so it reaches every
// computer as an ordinary edit) and re-run the simulation on the cleaned campaigns.
function _campTidyAfterLoad(){
  let t=[]; try{ t=_campTidy(); }catch(e){ console.warn('campaign tidy-up', e); return; }
  if(!t.length) return;
  console.info('Campaign tidy-up:', t);
  statMsg(`Tidied overlapping campaigns (${[...new Set(t)].join(', ')}) — the campaign added last wins`);
  setTimeout(()=>{ try{ autoSave(); scheduleSimulation(); }catch(e){ console.warn('campaign tidy-up save', e); } },0);
}
function _campGrips(store,c,ds){
  if(!c) return '';
  const id=esc(c.id); let g='';
  if(ds===c.start_date) g+=`<div class="camp-grip s" data-store="${store}" data-camp="${id}" data-edge="start" title="Drag to move the campaign start (${c.start_date})"></div>`;
  if(ds===c.end_date)   g+=`<div class="camp-grip e" data-store="${store}" data-camp="${id}" data-edge="end" title="Drag to move the campaign end (${c.end_date})"></div>`;
  return g;
}
// Grips on a SIMULATION-proposed run (no campaign behind it). run = {key, val, s, e, pv, nv}:
// key = element id / vessel call id, val = product / vessel action, s..e = the run's full
// extent over the horizon, pv / nv = what runs on the day just before / after it (for the
// changeover rule in _campApplySim). Dragging one turns it into the user's own campaign.
function _simGrips(store,run,ds){
  if(!run) return '';
  const a=`data-store="${store}" data-key="${esc(run.key)}" data-val="${esc(run.val)}" data-s="${run.s}" data-e="${run.e}" data-pv="${esc(run.pv||'')}" data-nv="${esc(run.nv||'')}"`;
  let g='';
  if(ds===run.s) g+=`<div class="camp-grip s sim" ${a} data-edge="start" title="Simulation proposal — drag to move its start (${run.s}); it becomes your campaign"></div>`;
  if(ds===run.e) g+=`<div class="camp-grip e sim" ${a} data-edge="end" title="Simulation proposal — drag to move its end (${run.e}); it becomes your campaign"></div>`;
  return g;
}
// Contiguous runs over the whole horizon from a per-day value array (null = no run):
// returns runAt[date] = {key, val, s, e, pv, nv}; neighbourOf(i) = what day i runs ('' = nothing).
function _simRunsFrom(dates, vals, key, neighbourOf){
  const runAt={}; let i0=-1;
  const close=i1=>{ if(i0<0) return;
    const run={key, val:vals[i0], s:dates[i0], e:dates[i1], pv:i0>0?neighbourOf(i0-1):'', nv:i1<dates.length-1?neighbourOf(i1+1):''};
    for(let k=i0;k<=i1;k++) runAt[dates[k]]=run; i0=-1; };
  vals.forEach((v,i)=>{ if(i0>=0&&v!==vals[i0]) close(i-1); if(v!=null&&i0<0) i0=i; });
  close(vals.length-1);
  return runAt;
}
// Drop of a dragged SIMULATION run. The run's new [s, e] becomes a campaign of its own
// product/action. Shrinking it moves the changeover: the freed days go to whatever runs on
// the far side (pv / nv), also as a campaign — otherwise the simulator would simply pick the
// same product again for them. Everything created here is an ordinary campaign, so deleting
// it from the popup hands those days back to the simulation.
function _campApplySim(d){
  const vessel=d.store==='simvessel';
  const st=_CAMP_STORES[vessel?'vessel':'prod'];
  const same=vessel?(x=>x.vessel_call_id===d.sim.key):(x=>x.element_id===d.sim.key);
  const mk=(val,s,e)=>{ const id=(vessel?'vcamp_':'camp_')+Date.now()+'_'+Math.random().toString(36).slice(2,6);
    return vessel?{id, vessel_call_id:d.sim.key, action:val, start_date:s, end_date:e}
                 :{id, element_id:d.sim.key, product_id:val, start_date:s, end_date:e, rate_tpd:0, notes:'from simulation (dragged)'}; };
  const adds=[[d.sim.val, d.s, d.e]];
  if(d.edge==='end'&&d.e<d.c.end_date&&d.sim.nv) adds.push([d.sim.nv, _addDays(d.e,1), d.c.end_date]);
  if(d.edge==='start'&&d.s>d.c.start_date&&d.sim.pv) adds.push([d.sim.pv, d.c.start_date, _addDays(d.s,-1)]);
  let list=DB[st.key]||[];
  adds.forEach(([v,s1,e1])=>{ list=_campSplice(list, same, s1, e1); list.push(mk(v,s1,e1)); });
  DB[st.key]=list;
  autoSave();
  renderSupplyView();
  statMsg(`Simulation run locked as your campaign ${d.s} → ${d.e}${adds.length>1?' (changeover moved)':''} — delete it in the popup to return to the simulation · running simulation…`);
  scheduleSimulation();
}
let _campDrag=null;
function _campDragCells(row){ return [...row.querySelectorAll('td[data-ds]')]; }
function _campDragPaint(){
  const d=_campDrag; if(!d) return;
  d.cells.forEach(td=>{ const ds=td.dataset.ds;
    const inNew=ds>=d.s&&ds<=d.e, inOld=ds>=d.c.start_date&&ds<=d.c.end_date;
    td.classList.toggle('camp-drag-pv',inNew);
    td.classList.toggle('camp-drag-cut',inOld&&!inNew); });
  const n=Math.round((new Date(d.e+'T12:00:00')-new Date(d.s+'T12:00:00'))/864e5)+1;
  d.tip.textContent=`${d.s} → ${d.e} · ${n} day${n===1?'':'s'}`;
}
function _campDragMove(e){
  const d=_campDrag; if(!d) return;
  d.tip.style.left=(e.clientX+12)+'px'; d.tip.style.top=(e.clientY+14)+'px';
  const rr=d.row.getBoundingClientRect();
  const hit=document.elementFromPoint(e.clientX, rr.top+rr.height/2);
  const td=hit&&hit.closest('td[data-ds]');
  if(!td||td.parentElement!==d.row) return;
  const ds=td.dataset.ds;
  if(ds!==d.orig) d.moved=true;
  if(d.edge==='start'){ d.s=ds>d.c.end_date?d.c.end_date:ds; d.e=d.c.end_date; }
  else { d.e=ds<d.c.start_date?d.c.start_date:ds; d.s=d.c.start_date; }
  _campDragPaint();
}
function _campDragEnd(cancel){
  const d=_campDrag; if(!d) return;
  _campDrag=null;
  document.removeEventListener('mousemove',_campDragMove);
  document.removeEventListener('mouseup',_campDragUp);
  document.removeEventListener('keydown',_campDragKey);
  document.body.classList.remove('camp-dragging');
  d.cells.forEach(td=>td.classList.remove('camp-drag-pv','camp-drag-cut'));
  d.tip.remove();
  if(d.moved){ // swallow the click that follows the mouseup so the popup doesn't open too
    const eat=ev=>{ ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click',eat,true); setTimeout(()=>document.removeEventListener('click',eat,true),0);
  }
  if(cancel||!d.moved||(d.s===d.c.start_date&&d.e===d.c.end_date)) return;
  if(d.sim) _campApplySim(d); else _campApplyDates(d.store,d.c.id,d.s,d.e);
}
function _campDragUp(){ _campDragEnd(false); }
function _campDragKey(e){ if(e.key==='Escape') _campDragEnd(true); }
function _campApplyDates(store,id,s,e){
  const st=_CAMP_STORES[store]; if(!st) return;
  const list=DB[st.key]||[]; const c=list.find(x=>x.id===id); if(!c) return;
  const others=list.filter(x=>x!==c);
  DB[st.key]=[..._campSplice(others, st.same(c), s, e), {...c, start_date:s, end_date:e}];
  autoSave();
  renderSupplyView();
  let note='';
  if(store==='prod'){
    const nReal=new Set((DB.real_production_daily||[]).filter(r=>r.element_id===c.element_id&&r.date>=s&&r.date<=e&&(parseFloat(r.volume_t)||0)>0).map(r=>r.date)).size;
    if(nReal) note=` · ${nReal} day${nReal===1?' has':'s have'} real data (real wins there)`;
  }
  if(store==='xfer'){
    const nReal=new Set((DB.real_silo_transfers_daily||[]).filter(r=>r.link_id===c.link_id&&r.from_silo_id===c.from_silo_id&&r.to_silo_id===c.to_silo_id&&r.date>=s&&r.date<=e).map(r=>r.date)).size;
    if(nReal) note=` · ${nReal} day${nReal===1?' has':'s have'} a recorded actual (actual wins there)`;
  }
  statMsg(`Campaign now ${s} → ${e}${note} — running simulation…`);
  scheduleSimulation();
}
document.addEventListener('mousedown',e=>{
  const g=e.target.closest&&e.target.closest('.camp-grip'); if(!g||e.button!==0) return;
  const gd=g.dataset, isSim=gd.store==='simprod'||gd.store==='simvessel';
  let c, sim=null;
  if(isSim){ c={id:null, start_date:gd.s, end_date:gd.e}; sim={key:gd.key, val:gd.val, pv:gd.pv, nv:gd.nv}; }
  else { const st=_CAMP_STORES[gd.store]; if(!st) return;
    c=(DB[st.key]||[]).find(x=>x.id===gd.camp); if(!c) return; }
  e.preventDefault(); e.stopPropagation();
  const row=g.closest('tr'); const td=g.closest('td[data-ds]');
  const tip=document.createElement('div'); tip.className='camp-drag-tip';
  tip.style.left=(e.clientX+12)+'px'; tip.style.top=(e.clientY+14)+'px';
  document.body.appendChild(tip);
  _campDrag={store:gd.store, sim, c:{...c}, edge:gd.edge, row, cells:_campDragCells(row),
    orig:td?td.dataset.ds:null, s:c.start_date, e:c.end_date, moved:false, tip};
  document.body.classList.add('camp-dragging');
  document.addEventListener('mousemove',_campDragMove);
  document.addEventListener('mouseup',_campDragUp);
  document.addEventListener('keydown',_campDragKey);
  _campDragPaint();
});

// Make room for a new [from, to] campaign in a campaign list: every record matching `same`
// that overlaps is trimmed to the part before `from` and/or after `to` (a campaign spanning
// the whole range is split in two). Shared by production and vessel campaigns.
function _campSplice(list, same, from, to){
  const out=[];
  list.forEach(c=>{
    if(!same(c)||c.end_date<from||c.start_date>to){ out.push(c); return; }
    if(c.start_date<from) out.push({...c, end_date:_addDays(from,-1)});
    if(c.end_date>to) out.push({...c, id:(c.id||'camp')+'_'+Math.random().toString(36).slice(2,6), start_date:_addDays(to,1)});
  });
  return out;
}
// Validation message shown INSIDE the open campaign popup. These used to go to the status
// bar, which resets after 2.5 s — easy to miss, so a rejected save looked like it had worked.
function _campWarn(msg, prefix){
  const el=document.getElementById((prefix||'camp')+'-warn');
  if(el){ el.textContent='⚠ '+msg; el.style.display=''; } else statMsg(msg);
}

// Apply a shorter end-date to an existing campaign (called from warning banner)
function _shortenCampaign(campId, newEndDate){
  const camp=(DB.production_campaigns||[]).find(c=>c.id===campId);
  if(!camp) return;
  camp.end_date=newEndDate;
  autoSave();
  renderSupplyView();
  statMsg('Campaign shortened to '+newEndDate+' — re-run simulation to update projections');
}

// The suggestions can be hidden from the toolbar — a per-browser choice, remembered like the
// inventory-chart mode. Hidden, the button still counts them so new ones are not missed.
const SUGG_HIDE_KEY='avila_sup_sugg_hidden';
function _supSuggHidden(){
  if(window._supSuggHide===undefined){
    let v=null; try{ v=localStorage.getItem(SUGG_HIDE_KEY); }catch(e){}
    window._supSuggHide=v==='1';
  }
  return window._supSuggHide;
}
function _supToggleSuggestions(){
  window._supSuggHide=!_supSuggHidden();
  try{ localStorage.setItem(SUGG_HIDE_KEY,window._supSuggHide?'1':'0'); }catch(e){}
  _renderSupCampaignWarnings();
}
function _supSyncSuggBtn(n){
  const b=document.getElementById('sup-sugg-btn'); if(!b) return;
  const hidden=_supSuggHidden();
  const v=b.querySelector('.v'); if(v) v.textContent=(hidden?'Hidden':'Shown')+(n?' · '+n:'');
  b.classList.toggle('set',hidden);   // non-default state reads like an active filter
  b.title=(n?n+' campaign suggestion'+(n===1?'':'s')+' (silo reaches capacity before the campaign ends). ':'No campaign suggestions right now. ')
    +(hidden?'Click to show them above the table.':'Click to hide them.');
}

// Scan production campaigns against sim inventory history and render overflow warnings
function _renderSupCampaignWarnings(){
  const el=document.getElementById('sup-campaign-warnings');
  if(!el) return;
  const r=S.simResults;
  const camps=DB.production_campaigns||[];
  if(!camps.length||!r?.inventoryHistory){el.innerHTML='';_supSyncSuggBtn(0);return;}

  const simStart=new Date(S.simCfg.start_date+'T00:00:00');
  const horizon=S.simCfg.horizon||365;
  // day-index lookup: dateStr -> 0-based index
  const dateIdx={};
  for(let i=0;i<horizon;i++){
    const d=new Date(simStart); d.setDate(d.getDate()+i);
    dateIdx[d._ymd()]=i;
  }

  const allEls=getFacElements();
  const warnings=[];

  camps.forEach(camp=>{
    const millEl=allEls.find(e=>e.id===camp.element_id);
    if(!millEl) return;

    // Direct downstream bulk silos that accept this product
    const downIds=DB.connections
      .filter(c=>c.from_element_id===camp.element_id)
      .map(c=>c.to_element_id);
    const targetSilos=allEls.filter(e=>
      downIds.includes(e.id)&&e.type==='bulk_silo'&&
      getSiloProducts(e).includes(camp.product_id)
    );

    targetSilos.forEach(silo=>{
      const maxCap=parseFloat(silo.props?.max_capacity)||0;
      if(!maxCap) return;
      const hist=r.inventoryHistory[silo.id]||[];

      // Walk every calendar day in the campaign date range
      const campDays=[];
      let cur=new Date(camp.start_date+'T00:00:00');
      const end=new Date(camp.end_date+'T00:00:00');
      while(cur<=end){
        campDays.push(cur._ymd());
        cur.setDate(cur.getDate()+1);
      }
      if(!campDays.length) return;

      // Find first day where end-of-day inventory hits ≥97% capacity
      let overflowDate=null;
      let lastEffective=campDays[0];
      for(const ds of campDays){
        const idx=dateIdx[ds];
        if(idx===undefined) continue;
        const eod=hist[idx]??0;
        if(eod>=maxCap*0.97){
          if(!overflowDate) overflowDate=ds;
        } else {
          lastEffective=ds;
        }
      }

      // Only warn if overflow happens BEFORE the campaign end date
      if(overflowDate && overflowDate<camp.end_date){
        const wastedDays=campDays.filter(d=>d>=overflowDate).length;
        const productName=DB.products.find(p=>p.id===camp.product_id)?.name||camp.product_id;
        warnings.push({
          campId:camp.id, elementId:camp.element_id,
          millName:millEl.name, productName, siloName:silo.name,
          campStart:camp.start_date, campEnd:camp.end_date,
          overflowDate, recommendedEnd:lastEffective, wastedDays
        });
      }
    });
  });

  _supSyncSuggBtn(warnings.length);
  if(!warnings.length || _supSuggHidden()){el.innerHTML='';return;}

  el.innerHTML=warnings.map(w=>`
    <div style="display:flex;align-items:center;gap:10px;background:rgba(255,177,0,.07);border-left:3px solid var(--amber);border-bottom:1px solid rgba(255,177,0,.15);padding:6px 14px">
      <span style="color:var(--amber);font-size:12px;flex-shrink:0">⚠</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text);flex:1">
        Campaign <b style="color:var(--amber)">${w.millName}</b> → <b style="color:var(--amber)">${w.productName}</b>
        (${w.campStart} → ${w.campEnd}):
        <b>${w.siloName}</b> reaches capacity on <b style="color:var(--amber)">${w.overflowDate}</b>
        — <b>${w.wastedDays}</b> day${w.wastedDays===1?'':'s'} of production wasted.
        Recommend ending on <b>${w.recommendedEnd}</b> instead.
      </span>
      <button class="tb-btn sec" style="font-size:8px;padding:2px 10px;white-space:nowrap;flex-shrink:0"
        onclick="_shortenCampaign('${w.campId}','${w.recommendedEnd}')">
        Apply ${w.recommendedEnd}
      </button>
      <button style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:11px;padding:2px 4px;flex-shrink:0"
        onclick="this.closest('[style]').remove()">✕</button>
    </div>`).join('');
}

function deleteCampaignRange(elId, startDate, endDate){
  if(!confirm(`Delete campaign for ${startDate} → ${endDate}?\nSimulation will resume auto-selection for these days.`)) return;
  DB.production_campaigns=(DB.production_campaigns||[]).filter(c=>
    !(c.element_id===elId && c.start_date===startDate && c.end_date===endDate)
  );
  closeCampaignPopup();
  autoSave();
  renderSupplyView();
  statMsg('Campaign deleted — running simulation…');
  scheduleSimulation();
}

function updateMaintEvent(){
  const ev=DB.element_maintenance_events.find(m=>m.id===S._editMaintId); if(!ev) return;
  const vals=getMeFormValues();
  Object.assign(ev,vals);
  S._editMaintId=null;
  autoSave(); closeModal();
  if(ev.element_id) renderProps(ev.element_id);
  renderMaintenanceCalendar(); updateStatusBar();
  statMsg('Maintenance event updated');
}

