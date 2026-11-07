// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// ELEMENTS MANAGEMENT VIEW
// ═══════════════════════════════════════════════════════
function _elemTypeLabel(type){
  const m={
    raw_material_storage:'Raw Material Storage',
    fuel_storage:'Fuel Storage',
    bulk_silo:'Bulk Silo',
    packed_silo:'Packed Silo',
    raw_meal_mill:'Raw Meal Mill',
    kiln:'Kiln',
    finish_mill:'Finish Mill',
    packing_plant:'Packing Plant',
    berth:'Berth',
    dispatch_point:'Dispatch Point',
    demand_point:'Demand Point',
    supply_source:'Supply Source'
  };
  return m[type]||type;
}

function _elemStartValue(el){
  const p=el.props||{};
  const t=el.type;
  if(t==='bulk_silo'||t==='raw_material_storage'||t==='fuel_storage')
    return p.start_inventory!=null&&p.start_inventory!==''?Number(p.start_inventory).toLocaleString()+' t':'—';
  if(t==='packed_silo')
    return p.start_inventory!=null&&p.start_inventory!==''?Number(p.start_inventory).toLocaleString()+' pal':'—';
  if(t==='kiln'||t==='raw_meal_mill'||t==='finish_mill'){
    const caps=DB.element_product_capacities.filter(c=>c.element_id===el.id);
    if(caps.length){
      const total=caps.reduce((s,c)=>s+(parseFloat(c.capacity_tpd)||0),0);
      return total.toLocaleString()+' t/d';
    }
    return p.rated_capacity_tpd?Number(p.rated_capacity_tpd).toLocaleString()+' t/d':'—';
  }
  if(t==='demand_point')
    return p.daily_tonnage?Number(p.daily_tonnage).toLocaleString()+' t/d (fb)':'—';
  return '—';
}

function _elemLinkedData(elId){
  // Count all records in every table that reference this element
  const counts={};
  if(DB.demand_points){
    const n=DB.demand_points.filter(d=>d.element_id===elId).length;
    if(n) counts['demand_points']=n;
  }
  if(DB.demand_values){
    const n=_idxRows('demand_values','element_id',elId).length;
    if(n) counts['demand_values']=n;
  }
  if(DB.element_maintenance_events){
    const n=DB.element_maintenance_events.filter(e=>e.element_id===elId).length;
    if(n) counts['maint_events']=n;
  }
  if(DB.element_product_capacities){
    const n=DB.element_product_capacities.filter(e=>e.element_id===elId).length;
    if(n) counts['capacities']=n;
  }
  if(DB.real_production_daily){
    const n=_idxRows('real_production_daily','element_id',elId).length;
    if(n) counts['real_prod']=n;
  }
  if(DB.real_inventory_daily){
    const n=_idxRows('real_inventory_daily','silo_id',elId).length;
    if(n) counts['real_inv']=n;
  }
  if(DB.connections){
    const n=DB.connections.filter(c=>c.from_id===elId||c.to_id===elId).length;
    if(n) counts['connections']=n;
  }
  if(DB.vessel_calls){
    const n=DB.vessel_calls.filter(v=>v.berth_element_id===elId).length;
    if(n) counts['vessel_calls']=n;
  }
  if(DB.rail_movements){
    const n=DB.rail_movements.filter(r=>r.from_dispatch_id===elId||r.to_berth_id===elId).length;
    if(n) counts['rail_mvmt']=n;
  }
  if(DB.production_schedule){
    const n=DB.production_schedule.filter(p=>p.element_id===elId).length;
    if(n) counts['prod_sched']=n;
  }
  return counts;
}

function _elemProducts(el){
  const p=el.props||{};
  const prods=[];
  if(p.product_id) prods.push(p.product_id);
  if(Array.isArray(p.products)) prods.push(...p.products);
  // demand_points have products array
  const dp=DB.demand_points.find(d=>d.element_id===el.id);
  if(dp&&Array.isArray(dp.products)) dp.products.forEach(pp=>{ if(pp.product_id&&!prods.includes(pp.product_id)) prods.push(pp.product_id); });
  // Resolve names
  return [...new Set(prods)].map(pid=>{
    const pr=DB.products.find(p=>p.id===pid);
    return pr?pr.name:pid;
  }).join(', ');
}

function renderElementsView(){
  // Populate type filter
  const typeSelect=document.getElementById('elem-filter-type');
  if(typeSelect){
    const types=[...new Set(DB.elements.map(e=>e.type))].sort();
    const cur=typeSelect.value;
    typeSelect.innerHTML='<option value="">All Types</option>'+
      types.map(t=>`<option value="${t}"${t===cur?' selected':''}>${_elemTypeLabel(t)}</option>`).join('');
  }
  // Populate facility filter
  const facSelect=document.getElementById('elem-filter-fac');
  if(facSelect){
    const facs=[...new Set(DB.elements.map(e=>e.facility_id||e.assigned_facility_id).filter(Boolean))].sort();
    const cur=facSelect.value;
    facSelect.innerHTML='<option value="">All Facilities</option>'+
      facs.map(fid=>{
        const fac=DB.facilities.find(f=>f.id===fid);
        return `<option value="${fid}"${fid===cur?' selected':''}>${fac?fac.name:fid}</option>`;
      }).join('');
  }
  renderElementsTable();
}

function renderElementsTable(){
  if(!_IDX.depth) return _idxRun(()=>renderElementsTable.apply(this,arguments)); // fast lookups for this whole block
  const nameFilter=(document.getElementById('elem-filter-name')?.value||'').toLowerCase();
  const typeFilter=document.getElementById('elem-filter-type')?.value||'';
  const facFilter=document.getElementById('elem-filter-fac')?.value||'';

  let elems=DB.elements.slice();
  if(nameFilter) elems=elems.filter(e=>(e.name||'').toLowerCase().includes(nameFilter));
  if(typeFilter) elems=elems.filter(e=>e.type===typeFilter);
  if(facFilter) elems=elems.filter(e=>(e.facility_id||e.assigned_facility_id)===facFilter);

  // Update count
  const totalSpan=document.getElementById('elem-total');
  if(totalSpan) totalSpan.textContent=`${elems.length} / ${DB.elements.length}`;

  const tbody=document.getElementById('elements-tbody');
  if(!tbody) return;

  if(!elems.length){
    tbody.innerHTML=`<tr><td colspan="8" style="padding:30px;text-align:center;color:var(--text-dim);font-family:var(--mono);font-size:9px">No elements match the current filter</td></tr>`;
    return;
  }

  tbody.innerHTML=elems.map(el=>{
    const fac=DB.facilities.find(f=>f.id===(el.facility_id||el.assigned_facility_id));
    const typeLabel=_elemTypeLabel(el.type);
    const startVal=_elemStartValue(el);
    const products=_elemProducts(el);
    const linked=_elemLinkedData(el.id);
    const linkedTotal=Object.values(linked).reduce((s,v)=>s+v,0);
    const linkedBadge=linkedTotal>0
      ? `<span style="color:var(--amber);cursor:pointer" title="${Object.entries(linked).map(([k,v])=>k+': '+v).join('\n')}" onclick="showElementLinkedData('${el.id}')">${linkedTotal} records</span>`
      : `<span style="color:var(--text-dim)">—</span>`;
    const typeColor={
      demand_point:'var(--green)',
      bulk_silo:'var(--blue)',
      finish_mill:'var(--amber)',
      kiln:'var(--orange)',
      dispatch_point:'var(--text-dim)',
      berth:'var(--blue)'
    }[el.type]||'var(--text-dim)';

    return `<tr style="border-bottom:1px solid var(--border);transition:background .1s" onmouseover="this.style.background='rgba(var(--hi-rgb),0.02)'" onmouseout="this.style.background=''">
      <td style="padding:7px 12px;color:var(--text-dim);border-right:1px solid var(--border)">${el.id}</td>
      <td style="padding:7px 12px;color:var(--text);border-right:1px solid var(--border);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(el.name)}">${esc(el.name)}</td>
      <td style="padding:7px 12px;color:${typeColor};border-right:1px solid var(--border);white-space:nowrap">${typeLabel}</td>
      <td style="padding:7px 12px;color:var(--text-dim);border-right:1px solid var(--border)">${fac?fac.name:'—'}</td>
      <td style="padding:7px 12px;text-align:right;color:var(--text-dim);border-right:1px solid var(--border);white-space:nowrap">${startVal}</td>
      <td style="padding:7px 12px;color:var(--text-dim);border-right:1px solid var(--border);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${products}">${products||'—'}</td>
      <td style="padding:7px 12px;text-align:right;border-right:1px solid var(--border)">${linkedBadge}</td>
      <td style="padding:7px 12px;text-align:center">
        <span style="display:inline-flex;gap:6px">
          <button onclick="showElementDetail('${el.id}')" style="padding:3px 8px;font-family:var(--mono);font-size:8px;background:transparent;border:1px solid var(--border2);color:var(--text-dim);cursor:pointer;border-radius:2px" onmouseover="this.style.borderColor='var(--green)';this.style.color='var(--green)'" onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text-dim)'">Detail</button>
          <button onclick="confirmDeleteElement('${el.id}')" style="padding:3px 8px;font-family:var(--mono);font-size:8px;background:transparent;border:1px solid var(--border2);color:var(--text-dim);cursor:pointer;border-radius:2px" onmouseover="this.style.borderColor='var(--red)';this.style.color='var(--red)'" onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text-dim)'">Delete</button>
        </span>
      </td>
    </tr>`;
  }).join('');
}

function showElementLinkedData(elId){
  const el=DB.elements.find(e=>e.id===elId);
  if(!el) return;
  const linked=_elemLinkedData(elId);
  const rows=Object.entries(linked).map(([k,v])=>
    `<tr><td style="padding:5px 10px;border-bottom:1px solid var(--border);color:var(--text-dim)">${k}</td><td style="padding:5px 10px;border-bottom:1px solid var(--border);text-align:right;color:var(--amber)">${v}</td></tr>`
  ).join('');
  showFloatMsg(`<div style="font-family:var(--mono);font-size:9px">
    <div style="font-weight:700;margin-bottom:8px;color:var(--text)">Linked data for: ${esc(el.name)}</div>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
  </div>`);
}

function showElementDetail(elId){
  const el=DB.elements.find(e=>e.id===elId);
  if(!el) return;
  const fac=DB.facilities.find(f=>f.id===(el.facility_id||el.assigned_facility_id));
  const linked=_elemLinkedData(elId);
  const dp=DB.demand_points.find(d=>d.element_id===elId);
  const caps=DB.element_product_capacities.filter(c=>c.element_id===elId);
  const maint=DB.element_maintenance_events.filter(e=>e.element_id===elId);
  const demVals=DB.demand_values.filter(d=>d.element_id===elId);

  // Show last 5 demand_values dates
  const demSample=demVals.slice(-5).map(d=>`${d.date}: ${d.value_t} t`).join('<br>');
  const demNote=demVals.length>5?`<em style="color:var(--text-dim)">...and ${demVals.length-5} more</em>`:'';

  const propsRows=Object.entries(el.props||{}).filter(([k,v])=>v!==''&&v!==null&&v!==undefined&&!Array.isArray(v)&&typeof v!=='object')
    .map(([k,v])=>`<tr><td style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--text-dim)">${k}</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--text)">${v}</td></tr>`).join('');

  const linkedRows=Object.entries(linked).map(([k,v])=>
    `<tr><td style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--text-dim)">${k}</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--amber)">${v}</td></tr>`
  ).join('');

  const html=`<div style="font-family:var(--mono);font-size:9px;min-width:480px;max-width:600px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text)">${esc(el.name)}</div>
        <div style="color:var(--text-dim);margin-top:2px">${_elemTypeLabel(el.type)} · ${fac?fac.name:'No facility'} · ID: ${el.id}</div>
      </div>
      <button onclick="closeModal()" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:14px">✕</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <div style="color:var(--text-dim);letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px;font-size:8px">Properties</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid var(--border)">${propsRows||'<tr><td style="padding:8px;color:var(--text-dim)">No properties</td></tr>'}</table>
      </div>
      <div>
        <div style="color:var(--text-dim);letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px;font-size:8px">Linked Data</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid var(--border)">${linkedRows||'<tr><td style="padding:8px;color:var(--text-dim)">No linked data</td></tr>'}</table>
        ${demVals.length?`<div style="margin-top:8px;padding:6px;background:var(--surface2);border:1px solid var(--border)"><div style="color:var(--text-dim);margin-bottom:4px">Latest demand values:</div><div style="color:var(--text)">${demSample}</div>${demNote}</div>`:''}
      </div>
    </div>

    <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
      <button onclick="closeModal()" style="padding:5px 12px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--border2);color:var(--text-dim);cursor:pointer">Close</button>
      <button onclick="closeModal();confirmDeleteElement('${elId}')" style="padding:5px 12px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid rgba(var(--red-rgb),.5);color:var(--red);cursor:pointer">Delete Element</button>
    </div>
  </div>`;

  showModal('');
  const mc=document.querySelector('.modal-content')||document.querySelector('.modal-body');
  if(mc){ mc.innerHTML=html; return; }
  // Fallback: inline overlay
  let ov=document.getElementById('elem-detail-overlay');
  if(!ov){ ov=document.createElement('div'); ov.id='elem-detail-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center';
    ov.onclick=e=>{if(e.target===ov) ov.remove();};
    document.body.appendChild(ov);
  }
  ov.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border2);padding:18px;max-width:640px;width:90%;max-height:80vh;overflow-y:auto">${html}</div>`;
  ov.style.display='flex';
}

function confirmDeleteElement(elId){
  const el=DB.elements.find(e=>e.id===elId);
  if(!el){ statMsg('Element not found'); return; }
  const linked=_elemLinkedData(elId);
  const totalLinked=Object.values(linked).reduce((s,v)=>s+v,0);

  const linkedRows=Object.entries(linked).filter(([k,v])=>v>0).map(([k,v])=>
    `<tr>
      <td style="padding:4px 10px;border-bottom:1px solid var(--border);color:var(--text-dim)">${k}</td>
      <td style="padding:4px 10px;border-bottom:1px solid var(--border);text-align:right;color:var(--red)">${v} record${v!==1?'s':''}</td>
    </tr>`
  ).join('');

  const html=`<div style="font-family:var(--mono);font-size:9px;min-width:400px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--red)">⚠ Delete Element</div>
      <button onclick="closeModal()" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:14px">✕</button>
    </div>
    <div style="padding:8px 10px;background:rgba(var(--red-rgb),.08);border:1px solid rgba(var(--red-rgb),.3);border-radius:2px;margin-bottom:12px">
      <div style="color:var(--text);font-weight:700">${esc(el.name)}</div>
      <div style="color:var(--text-dim);margin-top:2px">${_elemTypeLabel(el.type)} · ID: ${el.id}</div>
    </div>
    ${totalLinked>0?`
    <div style="margin-bottom:10px">
      <div style="color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;font-size:8px;margin-bottom:6px">The following data will also be deleted:</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid var(--border)">${linkedRows}</table>
    </div>`:'<div style="color:var(--text-dim);margin-bottom:10px">No linked data will be affected.</div>'}
    <div style="color:var(--text-dim);font-size:8px;padding:6px;background:var(--surface2);border-radius:2px;margin-bottom:12px">
      This action cannot be undone. Export a JSON backup before deleting if needed.
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="closeModal()" style="padding:5px 14px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--border2);color:var(--text-dim);cursor:pointer">Cancel</button>
      <button onclick="executeDeleteElement('${elId}')" style="padding:5px 14px;font-family:var(--mono);font-size:9px;background:var(--red);border:none;color:#fff;cursor:pointer;font-weight:700">Delete Permanently</button>
    </div>
  </div>`;

  // Use existing modal or fallback overlay
  let ov=document.getElementById('elem-detail-overlay');
  if(!ov){ ov=document.createElement('div'); ov.id='elem-detail-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center';
    ov.onclick=e=>{if(e.target===ov) ov.remove();};
    document.body.appendChild(ov);
  }
  ov.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border2);padding:18px;max-width:520px;width:90%;max-height:80vh;overflow-y:auto">${html}</div>`;
  ov.style.display='flex';
}

function executeDeleteElement(elId){
  const el=DB.elements.find(e=>e.id===elId);
  if(!el) return;

  // Cascading delete from ALL related tables
  if(DB.demand_points)            DB.demand_points            = DB.demand_points.filter(d=>d.element_id!==elId);
  if(DB.demand_values)            DB.demand_values            = DB.demand_values.filter(d=>d.element_id!==elId);
  if(DB.element_maintenance_events) DB.element_maintenance_events = DB.element_maintenance_events.filter(e=>e.element_id!==elId);
  if(DB.element_product_capacities) DB.element_product_capacities = DB.element_product_capacities.filter(e=>e.element_id!==elId);
  if(DB.element_raw_meal_recipes) DB.element_raw_meal_recipes = DB.element_raw_meal_recipes.filter(e=>e.element_id!==elId);
  if(DB.production_schedule)      DB.production_schedule      = DB.production_schedule.filter(p=>p.element_id!==elId);
  if(DB.simulation_day_states)    DB.simulation_day_states    = DB.simulation_day_states.filter(s=>s.element_id!==elId);
  if(DB.simulation_inventory)     DB.simulation_inventory     = DB.simulation_inventory.filter(s=>s.element_id!==elId);
  if(DB.simulation_stop_events)   DB.simulation_stop_events   = DB.simulation_stop_events.filter(s=>s.element_id!==elId);
  if(DB.vessel_calls)             DB.vessel_calls             = DB.vessel_calls.filter(v=>v.berth_element_id!==elId);
  if(DB.rail_movements)           DB.rail_movements           = DB.rail_movements.filter(r=>r.from_dispatch_id!==elId&&r.to_berth_id!==elId);
  _slDropForSilos([elId]); // silo transfer links touching it, with their plans and actuals
  if(DB.in_transit_inventory)     DB.in_transit_inventory     = DB.in_transit_inventory.filter(i=>i.to_element_id!==elId);
  if(DB.connections)              DB.connections              = DB.connections.filter(c=>c.from_id!==elId&&c.to_id!==elId);
  if(DB.real_production_daily)    DB.real_production_daily    = DB.real_production_daily.filter(r=>r.element_id!==elId);
  if(DB.real_inventory_daily)     DB.real_inventory_daily     = DB.real_inventory_daily.filter(r=>r.silo_id!==elId);
  if(DB.real_shipments_daily)     DB.real_shipments_daily     = DB.real_shipments_daily.filter(r=>r.element_id!==elId);
  if(DB.real_transfers_daily)     DB.real_transfers_daily     = DB.real_transfers_daily.filter(r=>r.element_id!==elId);
  if(DB.forecast_commitments)     DB.forecast_commitments     = DB.forecast_commitments.filter(r=>r.element_id!==elId);
  if(DB.production_campaigns)     DB.production_campaigns     = DB.production_campaigns.filter(c=>c.element_id!==elId);
  // simulation_rules stores element_ids as an array — remove this element from each rule's list
  if(DB.simulation_rules) DB.simulation_rules.forEach(rule=>{
    if(Array.isArray(rule.element_ids)) rule.element_ids=rule.element_ids.filter(id=>id!==elId);
  });
  // Mill policies + focus: drop any row referencing this element
  if(DB.mill_policies) DB.mill_policies=DB.mill_policies.filter(p=>(p.element_id||(p.element_ids||[])[0])!==elId);
  if(DB.mill_product_focus) DB.mill_product_focus=DB.mill_product_focus.filter(f=>f.element_id!==elId);

  // Remove element itself
  DB.elements = DB.elements.filter(e=>e.id!==elId);

  // Remove from topology canvas if present
  const canvasEl=document.getElementById(`eg-${elId}`);
  if(canvasEl) canvasEl.remove();
  if(typeof redrawConns==='function') redrawConns();

  // Close overlay
  const ov=document.getElementById('elem-detail-overlay');
  if(ov) ov.remove();

  // Persist and refresh
  if(typeof autoSave==='function') autoSave();
  if(typeof statMsg==='function') statMsg(`Deleted: ${el.name} and all linked data`);

  // Refresh elements table
  renderElementsTable();
}

function exportElementsCSV(){
  const rows=[['Element ID','Name','Type','Facility','Start Inv / Cap','Products','Linked Records']];
  DB.elements.forEach(el=>{
    const fac=DB.facilities.find(f=>f.id===(el.facility_id||el.assigned_facility_id));
    const linked=_elemLinkedData(el.id);
    const totalLinked=Object.values(linked).reduce((s,v)=>s+v,0);
    rows.push([
      el.id,
      `"${el.name}"`,
      _elemTypeLabel(el.type),
      fac?fac.name:'',
      _elemStartValue(el),
      `"${_elemProducts(el)}"`,
      totalLinked
    ]);
  });
  const csv=rows.map(r=>r.join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`elements_${new Date()._ymd()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  statMsg('Elements exported to CSV');
}

