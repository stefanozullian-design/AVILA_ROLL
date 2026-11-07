// ═══════════════════════════════════════════════════════
// LOCATION / ORGANIZATION TREE
// ═══════════════════════════════════════════════════════
function renderLocationTree(){
  const tree=document.getElementById('location-tree');
  if(!tree) return;
  if(!DB.macro_regions.length){
    tree.innerHTML=`<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);padding:16px 0;text-align:center">
      No macro regions yet.<br><br>
      <span style="font-size:9px;opacity:.6">Click + Macro Region to start building your organization structure</span>
    </div>`; return;
  }
  let h='';
  DB.macro_regions.forEach(mr=>{
    const countries=DB.countries.filter(c=>c.macro_region_id===mr.id);
    const totalFacs=countFacilitiesUnder('macro_region',mr.id);
    h+=`<div class="tree-node">
      <div class="tree-row lvl-macro ${S.selectedLocNode?.id===mr.id?'selected':''}" onclick="selectLocNode('macro_region','${mr.id}',event)">
        <span class="tree-expand ${countries.length?'':'leaf'}" onclick="toggleTreeNode(event,'mr-${mr.id}')">${countries.length?'▶':''}</span>
        <span class="tree-diamond">◆</span>
        <span class="tree-label">${mr.name}</span>
        <span class="tree-type">Macro Region</span>
        <span class="tree-count">${totalFacs} facilit${totalFacs!==1?'ies':'y'}</span>
        <div class="tree-actions">
          <span class="tree-act-btn" onclick="startAddNode('country','${mr.id}',event)">+ Country</span>
          <span class="tree-act-btn" onclick="startRenameNode('macro_region','${mr.id}',event)">Rename</span>
          <span class="tree-act-btn del" onclick="deleteLocNode('macro_region','${mr.id}',event)">Delete</span>
        </div>
      </div>
      <div class="tree-children ${countries.length?'':'hidden'}" id="mr-${mr.id}">`;
    countries.forEach(c=>{
      const regs=DB.regions.filter(r=>r.country_id===c.id);
      const cFacs=countFacilitiesUnder('country',c.id);
      h+=`<div class="tree-node">
        <div class="tree-row lvl-country ${S.selectedLocNode?.id===c.id?'selected':''}" onclick="selectLocNode('country','${c.id}',event)">
          <span class="tree-expand ${regs.length?'':'leaf'}" onclick="toggleTreeNode(event,'co-${c.id}')">${regs.length?'▶':''}</span>
          <span class="tree-diamond">◆</span>
          <span class="tree-label">${c.name}</span>
          <span class="tree-type">Country</span>
          <span class="tree-count">${cFacs} facilit${cFacs!==1?'ies':'y'}</span>
          <div class="tree-actions">
            <span class="tree-act-btn" onclick="startAddNode('region','${c.id}',event)">+ Region</span>
            <span class="tree-act-btn" onclick="startRenameNode('country','${c.id}',event)">Rename</span>
            <span class="tree-act-btn del" onclick="deleteLocNode('country','${c.id}',event)">Delete</span>
          </div>
        </div>
        <div class="tree-children ${regs.length?'':'hidden'}" id="co-${c.id}">`;
      regs.forEach(r=>{
        const subs=DB.sub_regions.filter(s=>s.region_id===r.id);
        const rFacs=countFacilitiesUnder('region',r.id);
        h+=`<div class="tree-node">
          <div class="tree-row lvl-region ${S.selectedLocNode?.id===r.id?'selected':''}" onclick="selectLocNode('region','${r.id}',event)">
            <span class="tree-expand ${subs.length?'':'leaf'}" onclick="toggleTreeNode(event,'re-${r.id}')">${subs.length?'▶':''}</span>
            <span class="tree-diamond">◇</span>
            <span class="tree-label">${r.name}</span>
            <span class="tree-type">Region</span>
            <span class="tree-count">${rFacs} facilit${rFacs!==1?'ies':'y'}</span>
            <div class="tree-actions">
              <span class="tree-act-btn" onclick="startAddNode('sub_region','${r.id}',event)">+ Sub-Region</span>
              <span class="tree-act-btn" onclick="startRenameNode('region','${r.id}',event)">Rename</span>
              <span class="tree-act-btn del" onclick="deleteLocNode('region','${r.id}',event)">Delete</span>
            </div>
          </div>
          <div class="tree-children ${subs.length?'':'hidden'}" id="re-${r.id}">`;
        subs.forEach(sub=>{
          const facs=DB.facilities.filter(f=>f.sub_region_id===sub.id);
          h+=`<div class="tree-node">
            <div class="tree-row lvl-subregion ${S.selectedLocNode?.id===sub.id?'selected':''}" onclick="selectLocNode('sub_region','${sub.id}',event)">
              <span class="tree-expand ${facs.length?'':'leaf'}" onclick="toggleTreeNode(event,'sr-${sub.id}')">${facs.length?'▶':''}</span>
              <span class="tree-diamond">◇</span>
              <span class="tree-label">${esc(sub.name)}</span>
              <span class="tree-type">Sub-Region</span>
              <span class="tree-count">${facs.length} facilit${facs.length!==1?'ies':'y'}</span>
              <div class="tree-actions">
                <span class="tree-act-btn" onclick="openAddFacilityModal('${sub.id}',event)">+ Facility</span>
                <span class="tree-act-btn" onclick="startRenameNode('sub_region','${sub.id}',event)">Rename</span>
                <span class="tree-act-btn del" onclick="deleteLocNode('sub_region','${sub.id}',event)">Delete</span>
              </div>
            </div>
            <div class="tree-children ${facs.length?'':'hidden'}" id="sr-${sub.id}">`;
          facs.forEach(f=>{
            const elCount=DB.elements.filter(e=>(e.assigned_facility_id||e.facility_id)===f.id).length;
            h+=`<div class="tree-row lvl-facility ${f.type==='terminal'?'terminal':f.type==='purchased'?'purchased':''} ${S.selectedLocNode?.id===f.id?'selected':''}" onclick="selectLocNode('facility','${f.id}',event)">
              <span class="tree-expand leaf"></span>
              <span class="tree-diamond">◆</span>
              <span class="tree-label">${f.name}</span>
              <span class="tree-type">${f.type}</span>
              <span class="tree-count">${elCount} el.</span>
              <div class="tree-actions">
                <span class="tree-act-btn" onclick="openFacilityInTopology('${f.id}',event)">Open</span>
                <span class="tree-act-btn del" onclick="deleteFacility('${f.id}',event)">Delete</span>
              </div>
            </div>`;
          });
          h+=`</div></div>`;
        });
        h+=`</div></div>`;
      });
      h+=`</div></div>`;
    });
    h+=`</div></div>`;
  });
  tree.innerHTML=h;
  updateNavFacilities();
  updateStatusBar();
}

function countFacilitiesUnder(level, id){
  if(level==='sub_region') return DB.facilities.filter(f=>f.sub_region_id===id).length;
  if(level==='region'){
    const subs=DB.sub_regions.filter(s=>s.region_id===id).map(s=>s.id);
    return DB.facilities.filter(f=>subs.includes(f.sub_region_id)).length;
  }
  if(level==='country'){
    const regs=DB.regions.filter(r=>r.country_id===id).map(r=>r.id);
    const subs=DB.sub_regions.filter(s=>regs.includes(s.region_id)).map(s=>s.id);
    return DB.facilities.filter(f=>subs.includes(f.sub_region_id)).length;
  }
  if(level==='macro_region'){
    const cos=DB.countries.filter(c=>c.macro_region_id===id).map(c=>c.id);
    const regs=DB.regions.filter(r=>cos.includes(r.country_id)).map(r=>r.id);
    const subs=DB.sub_regions.filter(s=>regs.includes(s.region_id)).map(s=>s.id);
    return DB.facilities.filter(f=>subs.includes(f.sub_region_id)).length;
  }
  return 0;
}

function toggleTreeNode(e, nodeId){
  e.stopPropagation();
  const el=document.getElementById(nodeId);
  const btn=e.target;
  if(!el) return;
  const hidden=el.classList.toggle('hidden');
  btn.classList.toggle('open',!hidden);
}

function selectLocNode(type, id, e){
  e?.stopPropagation();
  S.selectedLocNode={type,id};
  renderLocationTree();
  renderLocDetail(type,id);
  renderFacilitiesForNode(type,id);
}

// Org levels, top-down. fk = the field on a row that points at its parent one level up.
const LOC_LEVELS=[
  {type:'macro_region', table:'macro_regions', fk:null,              label:'Macro Region'},
  {type:'country',      table:'countries',     fk:'macro_region_id', label:'Country'},
  {type:'region',       table:'regions',       fk:'country_id',      label:'Region'},
  {type:'sub_region',   table:'sub_regions',   fk:'region_id',       label:'Sub-Region'},
  {type:'facility',     table:'facilities',    fk:'sub_region_id',   label:'Facility'},
];
// Ancestor ids of a node, top-down ('' where the chain is missing or broken).
function _locParentChain(type,record){
  const li=LOC_LEVELS.findIndex(l=>l.type===type);
  const ids=new Array(Math.max(0,li)).fill('');
  let cur=record;
  for(let k=li;k>0;k--){
    const pid=cur?.[LOC_LEVELS[k].fk]||'';
    ids[k-1]=pid;
    cur=pid?(DB[LOC_LEVELS[k-1].table]||[]).find(r=>r.id===pid):null;
  }
  return ids;
}
function _locOptHTML(rows,selId){
  return `<option value="">— choose —</option>`+
    rows.map(r=>`<option value="${r.id}" ${r.id===selId?'selected':''}>${esc(r.name)}</option>`).join('');
}
// A "Belongs to" dropdown changed: refill every level below it with the new parent's
// children — keeping a pick that is still valid, taking the only choice when there is one.
function _locHierChange(type,k){
  const li=LOC_LEVELS.findIndex(l=>l.type===type);
  let parentId=document.getElementById('ld-par-'+k)?.value||'';
  for(let j=k+1;j<li;j++){
    const sel=document.getElementById('ld-par-'+j); if(!sel) break;
    const L=LOC_LEVELS[j];
    const rows=parentId?(DB[L.table]||[]).filter(r=>r[L.fk]===parentId):[];
    const keep=rows.some(r=>r.id===sel.value)?sel.value:(rows.length===1?rows[0].id:'');
    sel.innerHTML=_locOptHTML(rows,keep);
    parentId=keep;
  }
}

function renderLocDetail(type,id){
  const panel=document.getElementById('loc-detail-panel');
  if(!panel) return;
  panel.dataset.node='';
  const typeLabels={macro_region:'Macro Region',country:'Country',region:'Region',sub_region:'Sub-Region',facility:'Facility'};
  let record=null;
  if(type==='macro_region') record=DB.macro_regions.find(r=>r.id===id);
  else if(type==='country') record=DB.countries.find(r=>r.id===id);
  else if(type==='region') record=DB.regions.find(r=>r.id===id);
  else if(type==='sub_region') record=DB.sub_regions.find(r=>r.id===id);
  else if(type==='facility') record=DB.facilities.find(r=>r.id===id);
  if(!record){panel.innerHTML='<div class="loc-detail-empty">Record not found</div>';return;}
  // Marks which node the panel shows — saveLocNode / saveRenameNode check it.
  panel.dataset.node=type+':'+id;

  let h=`<div class="loc-detail-title">${typeLabels[type]} — <span style="color:var(--green)">${record.name}</span></div>
    <div class="loc-fields">`;

  // Belongs to — one dropdown per level above this node, pre-filled with where it sits now.
  // Each one narrows the next; Save moves the node under the deepest one.
  const li=LOC_LEVELS.findIndex(l=>l.type===type);
  if(li>0){
    const chain=_locParentChain(type,record);
    h+=`<div class="loc-field" style="grid-column:1/-1"><div class="loc-field-label">Belongs to</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px">`;
    for(let k=0;k<li;k++){
      const L=LOC_LEVELS[k];
      const rows=k===0?(DB[L.table]||[]):(chain[k-1]?(DB[L.table]||[]).filter(r=>r[L.fk]===chain[k-1]):[]);
      h+=`<div class="loc-field"><div class="loc-field-label">${L.label}</div>
        <select class="loc-field-input" id="ld-par-${k}" onchange="_locHierChange('${type}',${k})">${_locOptHTML(rows,chain[k])}</select></div>`;
    }
    h+=`</div></div>`;
  }

  h+=`<div class="loc-field"><div class="loc-field-label">Name</div>
        <input class="loc-field-input" id="ld-name" value="${record.name}"></div>`;

  if(type==='facility'){
    // Plant # — the company's own plant numbers (text: may hold letters). A facility can
    // carry several, one per material or pickup type; the first one is the primary.
    h+=`<div class="loc-field" style="grid-column:1/-1"><div class="loc-field-label">Plant # / codes</div>
        ${plantCodesEditorHTML('ld',facPlantCodes(record))}</div>`;
    h+=`<div class="loc-field"><div class="loc-field-label">Type</div>
      <select class="loc-field-input" id="ld-fac-type">
        <option value="plant" ${record.type==='plant'?'selected':''}>Plant</option>
        <option value="terminal" ${record.type==='terminal'?'selected':''}>Terminal</option>
        <option value="purchased" ${record.type==='purchased'?'selected':''}>Purchased</option>
      </select></div>
    <div class="loc-field"><div class="loc-field-label">Status</div>
      <select class="loc-field-input" id="ld-fac-status">
        <option ${record.status==='active'?'selected':''}>active</option>
        <option ${record.status==='inactive'?'selected':''}>inactive</option>
        <option ${record.status==='construction'?'selected':''}>construction</option>
      </select></div>`;
  }

  // Contracted limits — the only "capacity" a purchased source has. Blank means
  // no limit; the Supply page flags days and months that go past them.
  if(type==='facility'&&record.type==='purchased'){
    h+=`<div class="loc-field"><div class="loc-field-label">Max per day (t)</div>
        <input class="loc-field-input" id="ld-max-daily" value="${String(record.max_daily_t??'')}" placeholder="no limit"></div>
      <div class="loc-field"><div class="loc-field-label">Contract per month (t)</div>
        <input class="loc-field-input" id="ld-contract-month" value="${String(record.contract_monthly_t??'')}" placeholder="no limit"></div>`;
  }

  h+=`<div class="loc-field" style="grid-column:1/-1"><div class="loc-field-label">Notes</div>
    <input class="loc-field-input" id="ld-notes" value="${record.notes||''}" placeholder="Optional notes"></div>`;

  h+=`</div><button class="loc-save-btn" onclick="saveLocNode('${type}','${id}')">Save Changes</button>`;
  if(type==='facility') h+=`<button class="loc-save-btn" style="background:var(--blue);margin-left:8px" onclick="openFacilityInTopology('${id}',null)">Open in Topology →</button>`;
  panel.innerHTML=h;
}

// ── Facility plant codes ─────────────────────────────────────────
// One facility can answer to several plant numbers — SUT is 4930 or 5052 depending on the
// material picked up. The codes live in facility.plant_nos as {code,label} rows; plant_no
// keeps the first code so older scenarios and any reader expecting one number still work.
// A PURCHASED facility is a supplier's own position, not ours. We never hold
// stock there, so it has no silos, no capacity and no days of cover — the only
// thing worth planning is how much we buy from it each day, usually because a
// swap sent demand its way. Everything that treats a facility as a place we
// store things asks this first.
function isPurchasedFac(f){
  const fac=(typeof f==='string')?(DB.facilities||[]).find(x=>x.id===f):f;
  return !!fac&&fac.type==='purchased';
}
function facPlantCodes(fac){
  if(!fac) return [];
  const out=[], seen=new Set();
  const push=(code,label)=>{
    const c=String(code??'').trim(); if(!c) return;
    const k=c.toUpperCase(); if(seen.has(k)) return; seen.add(k);
    out.push({code:c,label:String(label??'').trim()});
  };
  (Array.isArray(fac.plant_nos)?fac.plant_nos:[]).forEach(r=>{ if(r&&typeof r==='object') push(r.code,r.label); else push(r,''); });
  push(fac.plant_no,'');   // legacy single field — also the only code on un-migrated data
  return out;
}
function facPlantCodeStr(fac){ return facPlantCodes(fac).map(c=>c.label?`${c.code} (${c.label})`:c.code).join(' · '); }
// Which facility does a raw plant number belong to? The hook for cataloguing a delivery
// from source data onto a demand point.
function facilityByPlantCode(code){
  const c=String(code??'').trim().toUpperCase(); if(!c) return null;
  return DB.facilities.find(f=>facPlantCodes(f).some(p=>p.code.toUpperCase()===c))||null;
}
function setFacPlantCodes(fac,list){
  const rows=[], seen=new Set();
  (list||[]).forEach(r=>{
    const code=String(r&&r.code!=null?r.code:'').trim(); if(!code) return;
    const k=code.toUpperCase(); if(seen.has(k)) return; seen.add(k);
    rows.push({code,label:String(r.label??'').trim()});
  });
  fac.plant_nos=rows;
  fac.plant_no=rows.length?rows[0].code:'';
}
// A code must point at one facility only, or a delivery can't be catalogued from it.
function plantCodeConflicts(list,selfId){
  const hits=[];
  (list||[]).forEach(r=>{
    const code=String(r&&r.code!=null?r.code:'').trim(); if(!code) return;
    const other=DB.facilities.find(f=>f.id!==selfId&&facPlantCodes(f).some(p=>p.code.toUpperCase()===code.toUpperCase()));
    if(other) hits.push(`${code} → ${other.name}`);
  });
  return hits;
}
// Repeating code editor, shared by the Organization detail panel ('ld') and Add Facility ('fac').
function plantCodeRowHTML(prefix,r,i){
  const esc=v=>String(v??'').replace(/"/g,'&quot;');
  const cls=prefix==='fac'?'fi':'loc-field-input';
  return `<div class="plant-code-row" style="display:grid;grid-template-columns:90px 1fr 16px;gap:6px;align-items:center;margin-bottom:4px">
    <input class="${cls}" data-pc="code" value="${esc(r&&r.code)}" placeholder="e.g. 4930">
    <input class="${cls}" data-pc="label" value="${esc(r&&r.label)}" placeholder="what it covers — e.g. cement pickups">
    <span class="tbl-act del" style="margin:0;text-align:center" onclick="removePlantCodeRow('${prefix}',${i})">✕</span></div>`;
}
function plantCodesEditorHTML(prefix,list){
  const rows=(list&&list.length)?list:[{code:'',label:''}];
  return `<div id="${prefix}-plant-codes">${rows.map((r,i)=>plantCodeRowHTML(prefix,r,i)).join('')}</div>
    <span class="tbl-act" style="margin:0" onclick="addPlantCodeRow('${prefix}')">+ Add code</span>`;
}
function readPlantCodeRows(prefix){
  const box=document.getElementById(prefix+'-plant-codes'); if(!box) return null;
  return [...box.querySelectorAll('.plant-code-row')].map(row=>({
    code:row.querySelector('[data-pc="code"]')?.value||'',
    label:row.querySelector('[data-pc="label"]')?.value||''}));
}
function _redrawPlantCodes(prefix,rows){
  const box=document.getElementById(prefix+'-plant-codes'); if(!box) return;
  box.innerHTML=(rows.length?rows:[{code:'',label:''}]).map((r,i)=>plantCodeRowHTML(prefix,r,i)).join('');
}
function addPlantCodeRow(prefix){ const rows=readPlantCodeRows(prefix)||[]; rows.push({code:'',label:''}); _redrawPlantCodes(prefix,rows); }
function removePlantCodeRow(prefix,i){ const rows=readPlantCodeRows(prefix)||[]; rows.splice(i,1); _redrawPlantCodes(prefix,rows); }

function saveLocNode(type,id){
  const name=document.getElementById('ld-name')?.value?.trim(); if(!name) return;
  const notes=document.getElementById('ld-notes')?.value||'';
  let table=DB[type==='macro_region'?'macro_regions':type==='country'?'countries':type==='region'?'regions':type==='sub_region'?'sub_regions':'facilities'];
  const rec=table.find(r=>r.id===id);
  if(!rec) return;
  // Move: the new parent is the deepest "Belongs to" dropdown — read only when the detail
  // panel is showing this node.
  const li=LOC_LEVELS.findIndex(l=>l.type===type);
  const fk=li>0?LOC_LEVELS[li].fk:null;
  let newParent=null;
  if(fk&&document.getElementById('loc-detail-panel')?.dataset.node===type+':'+id){
    newParent=document.getElementById('ld-par-'+(li-1))?.value||'';
    if(!newParent&&rec[fk]){ statMsg(`Pick a ${LOC_LEVELS[li-1].label} to save`); return; }
  }
  rec.name=name; rec.notes=notes;
  if(type==='facility'){
    const pcs=readPlantCodeRows('ld');
    if(pcs){ setFacPlantCodes(rec,pcs); var pcClash=plantCodeConflicts(pcs,rec.id); }
    const typeWas=rec.type;
    rec.type=document.getElementById('ld-fac-type')?.value||rec.type;
    rec.status=document.getElementById('ld-fac-status')?.value||rec.status;
    const _num=id=>{ const el=document.getElementById(id); if(!el) return undefined;
      const v=el.value.trim(); return v===''?'':Math.max(0,parseFloat(v)||0); };
    const md=_num('ld-max-daily'), cm=_num('ld-contract-month');
    if(md!==undefined) rec.max_daily_t=md;
    if(cm!==undefined) rec.contract_monthly_t=cm;
    // Switching to (or away from) Purchased changes which fields exist — redraw
    // the panel so the contract fields appear without a click elsewhere first.
    if(typeWas!==rec.type) setTimeout(()=>renderLocDetail(type,id),0);
  }
  const moved=!!newParent&&rec[fk]!==newParent;
  if(newParent) rec[fk]=newParent;
  autoSave(); renderLocationTree();
  // A facility's name and Plant # codes are ship points the SAP script asks for (rules file)
  if(type==='facility'&&typeof _xlRulesChanged==='function') _xlRulesChanged();
  if(typeof pcClash!=='undefined'&&pcClash&&pcClash.length){ statMsg(`Saved — but these codes are also on another facility: ${pcClash.join(', ')}`); return; }
  statMsg(moved?`Saved — moved to ${LOC_LEVELS[li-1].label} ${(DB[LOC_LEVELS[li-1].table]||[]).find(r=>r.id===newParent)?.name||''}`:'Saved');
}

function renderFacilitiesForNode(type,id){
  const wrap=document.getElementById('fac-table-wrap');
  const tbody=document.getElementById('fac-tbody');
  if(!wrap||!tbody) return;
  let facs=[];
  if(type==='sub_region') facs=DB.facilities.filter(f=>f.sub_region_id===id);
  else if(type==='facility'){ wrap.style.display='none'; return; }
  else {
    // Show all facilities under this node
    const allFacIds=getAllFacilityIds(type,id);
    facs=DB.facilities.filter(f=>allFacIds.includes(f.id));
  }
  wrap.style.display='block';
  if(!facs.length){ tbody.innerHTML=`<tr><td colspan="5" style="color:var(--text-dim);text-align:center;padding:14px">No facilities under this node yet</td></tr>`; return; }
  tbody.innerHTML=facs.map(f=>{
    const elCount=DB.elements.filter(e=>(e.assigned_facility_id||e.facility_id)===f.id).length;
    const subr=DB.sub_regions.find(s=>s.id===f.sub_region_id);
    const codes=facPlantCodeStr(f);
    return `<tr onclick="openFacilityInTopology('${f.id}',null)">
      <td style="color:${f.type==='plant'?'var(--green)':f.type==='purchased'?'var(--purple)':'var(--blue)'};font-weight:700">${f.name}${codes?`<span style="font-family:var(--mono);font-size:9px;font-weight:400;color:var(--text-dim);margin-left:6px">${codes}</span>`:''}</td>
      <td><span class="fac-badge ${f.type==='plant'?'badge-green':f.type==='purchased'?'badge-purple':'badge-blue'}">${f.type}</span></td>
      <td style="font-family:var(--mono)">${elCount}</td>
      <td><span class="fac-badge ${f.status==='active'?'badge-green':f.status==='construction'?'badge-amber':'badge-grey'}">${f.status||'active'}</span></td>
      <td><span class="tbl-act" onclick="event.stopPropagation();openFacilityInTopology('${f.id}',null)">Open →</span>
          <span class="tbl-act del" onclick="event.stopPropagation();deleteFacility('${f.id}',null)">Delete</span></td>
    </tr>`;
  }).join('');
}

function getAllFacilityIds(type,id){
  let subIds=[];
  if(type==='region') subIds=DB.sub_regions.filter(s=>s.region_id===id).map(s=>s.id);
  else if(type==='country'){
    const regs=DB.regions.filter(r=>r.country_id===id).map(r=>r.id);
    subIds=DB.sub_regions.filter(s=>regs.includes(s.region_id)).map(s=>s.id);
  } else if(type==='macro_region'){
    const cos=DB.countries.filter(c=>c.macro_region_id===id).map(c=>c.id);
    const regs=DB.regions.filter(r=>cos.includes(r.country_id)).map(r=>r.id);
    subIds=DB.sub_regions.filter(s=>regs.includes(s.region_id)).map(s=>s.id);
  }
  return DB.facilities.filter(f=>subIds.includes(f.sub_region_id)).map(f=>f.id);
}

// ── Add nodes inline ──
function startAddNode(type, parentId, e){
  e?.stopPropagation();
  const labels={macro_region:'Macro Region',country:'Country',region:'Region',sub_region:'Sub-Region'};
  showModalContent(`
    <div class="modal-hdr"><span class="modal-title">Add ${labels[type]}</span><span class="modal-close" onclick="closeModal()">✕</span></div>
    <div class="modal-body">
      <div class="fr s1"><div class="ff"><div class="fl">Name</div>
        <input class="fi" id="an-name" placeholder="Enter name..." autofocus></div></div>
      <div class="fr s1"><div class="ff"><div class="fl">Notes (optional)</div>
        <input class="fi" id="an-notes" placeholder=""></div></div>
    </div>
    <div class="modal-footer">
      <button class="btn-sec" onclick="closeModal()">Cancel</button>
      <button class="btn-pri" onclick="saveNewNode('${type}','${parentId}')">Add</button>
    </div>
  `);
  setTimeout(()=>document.getElementById('an-name')?.focus(),50);
}

function saveNewNode(type, parentId){
  const name=document.getElementById('an-name')?.value?.trim(); if(!name) return;
  const notes=document.getElementById('an-notes')?.value||'';
  const id=`${type.slice(0,2)}_${Date.now()}`;
  if(type==='macro_region') DB.macro_regions.push({id,name,notes});
  else if(type==='country') DB.countries.push({id,macro_region_id:parentId,name,notes});
  else if(type==='region') DB.regions.push({id,country_id:parentId,name,notes});
  else if(type==='sub_region') DB.sub_regions.push({id,region_id:parentId,name,notes});
  autoSave(); closeModal(); renderLocationTree();
  // Auto-expand parent
  const parentNodeId=type==='country'?`mr-${parentId}`:type==='region'?`co-${parentId}`:type==='sub_region'?`re-${parentId}`:null;
  if(parentNodeId){ const n=document.getElementById(parentNodeId); if(n) n.classList.remove('hidden'); }
  statMsg(`${name} added`);
}

function startRenameNode(type,id,e){
  e?.stopPropagation();
  startAddNode(type,null,e); // reuse modal — actually just rename
  setTimeout(()=>{
    const table=type==='macro_region'?DB.macro_regions:type==='country'?DB.countries:type==='region'?DB.regions:DB.sub_regions;
    const rec=table.find(r=>r.id===id);
    const modal=document.getElementById('modal-content');
    if(rec&&document.getElementById('an-name')) document.getElementById('an-name').value=rec.name;
    if(rec&&document.getElementById('an-notes')) document.getElementById('an-notes').value=rec.notes||'';
    const title=modal?.querySelector('.modal-title');
    if(title) title.textContent=title.textContent.replace(/^Add /,'Rename ');
    // Override save button
    const footer=modal?.querySelector('.modal-footer');
    if(footer) footer.innerHTML=`<button class="btn-sec" onclick="closeModal()">Cancel</button><button class="btn-pri" onclick="saveRenameNode('${type}','${id}')">Save</button>`;
  },60);
}
// Save for the Rename pop-up — reads the pop-up's own Name / Notes. It used to go through
// saveLocNode, which reads the Selected Node panel: renaming one node while the panel showed
// another copied that node's name and notes, and with no panel open nothing was saved.
function saveRenameNode(type,id){
  const name=document.getElementById('an-name')?.value?.trim(); if(!name) return;
  const table=type==='macro_region'?DB.macro_regions:type==='country'?DB.countries:type==='region'?DB.regions:DB.sub_regions;
  const rec=table.find(r=>r.id===id);
  if(!rec) return;
  rec.name=name; rec.notes=document.getElementById('an-notes')?.value||'';
  autoSave(); closeModal(); renderLocationTree();
  // Keep the Selected Node panel in step when it shows this node, so its Save can't revert the name.
  if(document.getElementById('loc-detail-panel')?.dataset.node===type+':'+id) renderLocDetail(type,id);
  statMsg('Saved');
}

function deleteLocNode(type,id,e){
  e?.stopPropagation();
  if(!confirm(`Delete this ${type.replace('_',' ')} and all its children? This cannot be undone.`)) return;
  if(type==='macro_region'){
    const cos=DB.countries.filter(c=>c.macro_region_id===id).map(c=>c.id);
    const regs=DB.regions.filter(r=>cos.includes(r.country_id)).map(r=>r.id);
    const subs=DB.sub_regions.filter(s=>regs.includes(s.region_id)).map(s=>s.id);
    DB.facilities=DB.facilities.filter(f=>!subs.includes(f.sub_region_id));
    DB.sub_regions=DB.sub_regions.filter(s=>!regs.includes(s.region_id));
    DB.regions=DB.regions.filter(r=>!cos.includes(r.country_id));
    DB.countries=DB.countries.filter(c=>c.macro_region_id!==id);
    DB.macro_regions=DB.macro_regions.filter(r=>r.id!==id);
  } else if(type==='country'){
    const regs=DB.regions.filter(r=>r.country_id===id).map(r=>r.id);
    const subs=DB.sub_regions.filter(s=>regs.includes(s.region_id)).map(s=>s.id);
    DB.facilities=DB.facilities.filter(f=>!subs.includes(f.sub_region_id));
    DB.sub_regions=DB.sub_regions.filter(s=>!regs.includes(s.region_id));
    DB.regions=DB.regions.filter(r=>r.country_id!==id);
    DB.countries=DB.countries.filter(c=>c.id!==id);
  } else if(type==='region'){
    const subs=DB.sub_regions.filter(s=>s.region_id===id).map(s=>s.id);
    DB.facilities=DB.facilities.filter(f=>!subs.includes(f.sub_region_id));
    DB.sub_regions=DB.sub_regions.filter(s=>s.region_id!==id);
    DB.regions=DB.regions.filter(r=>r.id!==id);
  } else if(type==='sub_region'){
    DB.facilities=DB.facilities.filter(f=>f.sub_region_id!==id);
    DB.sub_regions=DB.sub_regions.filter(s=>s.id!==id);
  }
  if(S.selectedLocNode?.id===id) S.selectedLocNode=null;
  autoSave(); renderLocationTree(); statMsg('Deleted');
}

function openAddFacilityModal(subRegionId,e){
  e?.stopPropagation();
  S._newFacSubRegion=subRegionId;
  showModal('facility-modal');
}

function openFacilityInTopology(id,e){
  e?.stopPropagation();
  selectFacility(id);
  switchView('topology');
}

function deleteFacility(id,e){
  e?.stopPropagation();
  if(!confirm('Delete this facility and all its elements?')) return;
  DB.facilities=DB.facilities.filter(f=>f.id!==id);
  _slDropForSilos(DB.elements.filter(e=>(e.assigned_facility_id||e.facility_id)===id).map(e=>e.id));
  DB.elements=DB.elements.filter(e=>(e.assigned_facility_id||e.facility_id)!==id);
  DB.connections=DB.connections.filter(c=>c.facility_id!==id);
  if(S.facility_id===id){ S.facility_id=null; document.getElementById('stat-fac').textContent='No facility selected'; }
  autoSave(); renderLocationTree(); statMsg('Facility deleted');
  if(typeof _xlRulesChanged==='function') _xlRulesChanged();   // its Plant # codes leave the SAP script's list
}

// ═══════════════════════════════════════════════════════
// FACILITY HELPERS
// ═══════════════════════════════════════════════════════
function getFacility(){ return DB.facilities.find(f=>f.id===S.facility_id); }

// The ONE topology canvas (unified plane). Every element and connection is stamped with this
// id and every canvas-scoped read filters on it. It is the facility every load selects
// (DB.facilities[0] — see scAfterLoad), so it no longer follows S.facility_id: Organization →
// Open or a nav click on another facility used to re-scope the Supply page and the simulation
// to that facility, and stamp elements drawn there with its id — HEI(PC)'s silo and demand
// point were saved that way and dropped off the Supply page for good after the next load.
function mainCanvasFacilityId(){ return DB.facilities[0]?.id||S.facility_id; }

// Get elements for CANVAS RENDERING (placed on the canvas, regardless of assignment)
function getFacElements(){ const cv=mainCanvasFacilityId(); return DB.elements.filter(e=>e.facility_id===cv); }

// Get elements ASSIGNED TO current facility (regardless of canvas placement)
// This is the authoritative source for facility-specific analysis and results


function getFacConnections(){ const cv=mainCanvasFacilityId(); return DB.connections.filter(c=>c.facility_id===cv); }

// Get effective facility for an element — assigned_facility_id overrides facility_id for results/analysis
function getElFacility(el){ return el.assigned_facility_id||el.facility_id; }

// Get elements filtered by the shared filter bar (for results/analysis views).
// Start with canvas elements, then narrow by the selected facilities and, when a
// product filter is on, drop elements that handle none of the allowed products.
// Both selections are "empty means all", so an untouched dock changes nothing.
function getResultElements(){
  const canvasEls=getFacElements();
  const facs=fltFacIdSet();
  let els=facs?canvasEls.filter(el=>facs.has(getElFacility(el))):canvasEls;
  const pids=fltAllowedProdIds();
  if(pids) els=els.filter(el=>resElementHandlesProduct(el,pids));
  return els;
}
function getEl(id){ return DB.elements.find(e=>e.id===id); }

function selectFacility(id){
  S.facility_id=id;
  // The shared facility filter is NOT cleared here — fltNormalize() drops any facility
  // the scenario no longer has, and the rest survives a reload.
  const fac=getFacility();
  if(!fac) return;
  document.getElementById('stat-fac').textContent=fac.name;
  // Update nav
  document.querySelectorAll('.nav-item[data-fac]').forEach(n=>n.classList.remove('active'));
  document.querySelector(`.nav-item[data-fac="${id}"]`)?.classList.add('active');
  // Reload canvas — unified plane, honouring the topology facility filter.
  renderTopoCanvas();
  updateStatusBar();
  // Initialize real data panel for this facility
  if(typeof renderRealDataSections==='function') renderRealDataSections();
}

function updateNavFacilities(){
  const nav=document.getElementById('nav-facilities-list'); if(!nav) return;
  if(!DB.facilities.length){ nav.innerHTML=`<div class="nav-cat" onclick="switchView('location')" style="color:var(--text-dim);font-size:9px">Set up Organization →</div>`; return; }
  nav.innerHTML=DB.facilities.map(f=>`
    <div class="nav-item ${S.facility_id===f.id?'active':''}" data-fac="${f.id}" onclick="selectFacility('${f.id}');switchView('topology')">
      ${f.name}<div class="nav-status ${f.type==='plant'?'s-green':'s-amber'}"></div>
    </div>`).join('');
}

