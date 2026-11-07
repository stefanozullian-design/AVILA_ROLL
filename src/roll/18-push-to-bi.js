// ════════════════════════════════════════════════════════════════
// PUSH TO BI — star-schema XLSX export for Power BI consumption
// ════════════════════════════════════════════════════════════════
// Emits one workbook with dim_* + fact_* sheets. Forecast rows come
// from S.simResults (active facility only). Actual rows come from
// DB.real_*_daily and span every facility present in those tables.
// Every fact row is stamped with scenario_run_id + as_of_date so
// multiple exports can coexist in the Power BI model.
async function pushToBI(){
  const btn=document.getElementById('bi-push-btn');
  const setMsg=(html)=>{ const m=document.getElementById('bi-push-msg'); if(m) m.innerHTML=html; _biToast(html); };
  if(pushToBI._busy) return; // a second click while exporting would write the file twice
  pushToBI._busy=true;
  try{
    if(btn) btn.disabled=true;
    // Resolve the destination FIRST: showDirectoryPicker() and requestPermission()
    // need this click's user activation, which does not survive the awaits below.
    const dir=await exportDir('bi',true);
    setMsg('<span style="color:var(--amber)">Loading XLSX engine…</span>');
    await loadLib('xlsx'); // pinned version + SRI — see LIBS
    setMsg('<span style="color:var(--amber)">Building star schema…</span>');
    const tables=_pushBIBuildTables();
    if(scIsPlanning()) await _plAppendSensitivity(tables, setMsg); // yield-sensitivity runs -> *_cases sheets (Budget dashboard)
    const wb=XLSX.utils.book_new();
    Object.keys(tables).forEach(name=>{
      const rows=tables[name];
      const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{note:'(no rows)'}]);
      XLSX.utils.book_append_sheet(wb,ws,name);
    });
    // Same name, same folder, every time — Power BI can be pointed at this file once
    // and simply refreshed from then on.
    setMsg(`<span style="color:var(--amber)">${dir?'Saving':'Downloading'}…</span>`);
    const res=await exportWriteWorkbook('bi',wb,dir);
    const total=Object.values(tables).reduce((a,t)=>a+t.length,0);
    setMsg(`<span style="color:var(--green)">✓ ${res.saved?'Saved to '+esc(res.where):'Downloaded '+esc(res.where)} — `+
      `${total.toLocaleString()} rows across ${Object.keys(tables).length} sheets</span>`+
      (res.saved?'':`<div style="color:var(--text-dim);margin-top:5px">Set a folder in Configuration → Data Sources to save it in place instead.</div>`));
  }catch(e){
    setMsg(`<span style="color:var(--red)">Export failed: ${e.message}</span>`);
  }finally{
    if(btn) btn.disabled=false;
    pushToBI._busy=false;
  }
}

// Progress / result of Push to BI, bottom-right — the export runs straight from the
// menu, so there is no page to show it on. Stays while working, fades 8 s after the end.
function _biToast(html){
  let t=document.getElementById('bi-toast');
  if(!t){
    t=document.createElement('div');
    t.id='bi-toast';
    t.style.cssText='position:fixed;bottom:14px;right:14px;max-width:440px;background:var(--surface);color:var(--text);border:1px solid var(--border2);border-radius:6px;padding:10px 32px 10px 12px;font:11px/1.5 var(--mono);z-index:99998;box-shadow:0 4px 18px rgba(0,0,0,.35)';
    t.innerHTML='<span style="position:absolute;top:6px;right:9px;cursor:pointer;color:var(--text-dim)" onclick="this.parentNode.remove()">✕</span><div style="color:var(--text-dim);font-size:9px;letter-spacing:1px;margin-bottom:3px">📤 PUSH TO BI</div><div id="bi-toast-body"></div>';
    document.body.appendChild(t);
  }
  document.getElementById('bi-toast-body').innerHTML=html;
  clearTimeout(_biToast._tm);
  if(!/Loading|Building|Saving|Downloading/.test(html)) _biToast._tm=setTimeout(()=>t.remove(),8000);
}

// Destination line under the Push to BI button — mirrors the folder set in
// Configuration → Data Sources, or says the file will download instead.
function _biRenderDest(){
  const el=document.getElementById('bi-push-dest'); if(!el) return;
  const cfg=exportSlot('bi'), name=exportDirName('bi'), _file=exportFileName('bi');
  el.innerHTML = name
    ? `Writes <span style="color:var(--text)">${esc(name)}/${_file}</span>, replacing the previous file.${scIsPlanning()?' <span style="color:var(--amber)">Planning scenario → its own workbook, beside the Execution one'+((DB.plan_yields||[]).length?', with the two yield-sensitivity runs':' (no yields yet: update from the trend to get the sensitivity runs)')+'.</span>':''}`
    : `Downloads as <span style="color:var(--text)">${_file}</span> — `+
      `<span style="color:var(--blue);cursor:pointer;text-decoration:underline" onclick="chooseExportDir('bi')">choose a folder</span> `+
      `to save it in place instead.`;
}

// Last-resort product for a demand point with nothing configured: read it from the
// naming convention FAC/DEM/<product>/<channel> (e.g. SUT/DEM/TAM_IL(11)/BLK/EXT →
// TAM_IL(11)/BLK). Compared on letters+digits only, zeros dropped so IL(8) = IL(08);
// exact match first, then prefix either way, then the shortest name containing it in order.
function _biProductFromName(name){
  const seg=String(name||'').split('/');
  if(seg.length<3||String(seg[1]).toUpperCase()!=='DEM') return '';
  const last=seg[seg.length-1].trim().toUpperCase();
  const core=seg.slice(2, ['INT','EXT','IND','POURS'].includes(last)?-1:undefined).join('/');
  const norm=x=>String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/0/g,'');
  const c=norm(core); if(!c) return '';
  const ps=(DB.products||[]).map(p=>({id:p.id,n:norm(p.name)})).filter(p=>p.n).sort((a,b)=>a.n.length-b.n.length);
  const inOrder=(a,b)=>{ let i=0; for(const ch of b){ if(ch===a[i]) i++; if(i===a.length) return true; } return false; };
  const hit=ps.find(p=>p.n===c)||ps.find(p=>p.n.startsWith(c))||ps.find(p=>c.startsWith(p.n))||ps.find(p=>inOrder(c,p.n));
  return hit?hit.id:'';
}

function _pushBIBuildTables(){
  const asOf=new Date()._ymd();
  const r=S.simResults||null;
  const runId=r?.runId||`actual_only_${Date.now()}`;
  const horizon=r?r.elementStates&&Object.values(r.elementStates)[0]?.length||0:0;
  const simStart=S.simCfg.start_date;
  const offsetToDate=(off)=>{
    const d=new Date(simStart+'T00:00:00');
    d.setDate(d.getDate()+off);
    return d._ymd();
  };
  const scName=(typeof scActive==='function'&&scActive()&&scActive().name)||'', scKind=scIsPlanning()?'planning':'execution';
  const planV=(typeof plActiveVersion==='function')?plActiveVersion():null;
  const stamp=(row)=>({as_of_date:asOf, scenario_run_id:runId, scenario_name:scName, scenario_kind:scKind, ...row});

  // ── DIMENSIONS ─────────────────────────────────────────
  // dim_date — a CONTIGUOUS calendar spanning every date any fact can reference.
  // Two things matter here and both used to be wrong:
  //  1) COVERAGE — the seed set must include every table a fact_* row draws a date
  //     from, or Power BI gets fact rows with no matching dim row (broken
  //     relationship / blank date bucket). demand_values feeds fact_demand and
  //     rail_movements feeds fact_rail_movement (departure AND the computed
  //     arrival, which can land past the sim horizon), so both belong here.
  //  2) CONTIGUITY — DAX time intelligence needs an unbroken date table. Emitting
  //     only dates observed in the data leaves holes on any day with no activity,
  //     which silently breaks MTD/YTD/rolling measures. So we take min→max of the
  //     observed set and fill every day in between.
  const dateSet=new Set();
  if(r) for(let d=0;d<horizon;d++) dateSet.add(offsetToDate(d));
  ['real_production_daily','real_inventory_daily','real_shipping_daily',
   'real_unloading_daily','real_rail_daily','real_transfers_daily','real_silo_transfers_daily','real_shipments_daily',
   'demand_values']
   .forEach(k=>(DB[k]||[]).forEach(row=>row.date&&dateSet.add(row.date)));
  (DB.vessel_sof||[]).forEach(sf=>(sf.periods||[]).forEach(p=>{
    if(_sofT(p.start)) dateSet.add(p.start.slice(0,10));
    if(_sofT(p.end)) dateSet.add(p.end.slice(0,10));
  }));
  (DB.rail_movements||[]).forEach(rm=>{
    const dep=rm.departure_date||rm.date;
    if(!dep) return;
    dateSet.add(dep);
    dateSet.add(_addDays(dep,parseInt(rm.transit_days)||1)); // arrival can exceed the horizon
  });
  (DB.plan_demand||[]).forEach(p=>{ if(p.ym){ dateSet.add(p.ym+'-01'); dateSet.add(p.ym+'-'+String(new Date(+p.ym.slice(0,4), +p.ym.slice(5,7), 0).getDate()).padStart(2,'0')); } });
  // The calendar always reaches the end of the budget year, so the Planning workbook's budget months have dates to join on
  // even when this (Execution) export's own horizon ends earlier.
  { const by=Math.max(new Date().getFullYear()+1, ((DB.plan_settings||[]).find(x=>x.id==='default')||{}).budget_year||0); dateSet.add(`${by}-12-31`); }
  // Fill the range so the calendar has no gaps
  const _dsSorted=[...dateSet].sort();
  const _allDateStrs=[];
  if(_dsSorted.length){
    let cur=_dsSorted[0]; const last=_dsSorted[_dsSorted.length-1];
    // Guard against a malformed date producing a runaway loop
    for(let i=0;cur<=last&&i<20000;i++){ _allDateStrs.push(cur); cur=_addDays(cur,1); }
  }
  const dim_date=_allDateStrs.map(ds=>{
    const d=new Date(ds+'T00:00:00');
    const dow=d.getDay();
    return {
      date:ds,
      year:d.getFullYear(),
      quarter:`Q${Math.floor(d.getMonth()/3)+1}`,
      month:d.getMonth()+1,
      month_name:d.toLocaleString('en',{month:'short'}),
      week:_isoWeek(d),
      day_of_week:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow],
      is_weekend:dow===0||dow===6
    };
  });

  // dim_facility — every facility known to the catalog
  const dim_facility=DB.facilities.map(f=>{
    const sub=DB.sub_regions.find(s=>s.id===f.sub_region_id);
    const reg=sub?DB.regions.find(r=>r.id===sub.region_id):null;
    const cty=reg?DB.countries.find(c=>c.id===reg.country_id):null;
    return {
      facility_id:f.id,
      facility_name:f.name,
      facility_type:f.type||'',
      status:f.status||'',
      sub_region:sub?.name||'',
      region:reg?.name||'',
      country:cty?.name||''
    };
  });

  // Facility names + the product(s) each element handles — resolved once so
  // every sheet agrees. v1 exported props.product_id only, which most silos and
  // every demand point leave blank (their products live in props.products /
  // DB.demand_points), so Power BI could not slice demand or inventory by product.
  const facName={}; DB.facilities.forEach(f=>{ facName[f.id]=f.name; });
  const facByName={}; DB.facilities.forEach(f=>{ facByName[String(f.name||'').toUpperCase()]=f.id; });
  const elProducts=(e)=>{
    if(e.type==='bulk_silo'||e.type==='packed_silo') return getSiloProducts(e);
    if(e.type==='demand_point') return _demElProdIds(e).filter(Boolean);
    // a kiln's props.product_id is its FUEL (e.g. coal) — only its output counts here
    const p=e.type==='kiln'?e.props?.output_product_id:(e.props?.output_product_id||e.props?.product_id);
    return p?[String(p).split('=')[0]]:[];
  };
  // Demand channel from the demand point's naming convention: …/INT, …/EXT, …/IND, …/POURS
  const elChannel=(e)=>{
    if(e.type!=='demand_point') return '';
    const last=String(e.name||'').split('/').pop().trim().toUpperCase();
    return ['INT','EXT','IND','POURS'].includes(last)?last:'';
  };

  // dim_element — every element across every facility
  const dim_element=DB.elements.map(e=>{
    const capRows=DB.element_product_capacities.filter(c=>c.element_id===e.id);
    const rated=capRows.reduce((a,c)=>a+(parseFloat(c.capacity_tpd)||0),0)
                 || parseFloat(e.props?.rated_capacity_tpd)
                 || parseFloat(e.props?.rated_capacity_pallets_day)*parseFloat(e.props?.tonnes_per_pallet)
                 || 0;
    const fac=e.assigned_facility_id||e.facility_id||'';
    const prods=elProducts(e);
    return {
      element_id:e.id,
      element_name:e.name,
      element_type:e.type,
      // v2: facility_id is the facility the element SERVES (assigned) — the same id every
      // fact row carries. v1 wrote the canvas facility, i.e. BRS for almost everything.
      facility_id:fac,
      assigned_facility_id:fac,
      canvas_facility_id:e.facility_id||'',
      facility_name:facName[fac]||'',
      rated_capacity_tpd:Math.round(rated)||null,
      max_capacity_t:parseFloat(e.props?.max_capacity)||null,
      min_level_t:parseFloat(e.props?.min_level)||null,
      critical_min_t:parseFloat(e.props?.critical_min)||null,
      start_inventory_t:parseFloat(e.props?.start_inventory)||null,
      critical_floor_pct:parseFloat(e.props?.critical_floor_pct)||null, // silos: the Supply page's critical floor (% of max)
      car_capacity_t:parseFloat(e.props?.car_capacity_t)||((e.props?.dispatch_type||e.props?.berth_type==='Rail Receiving')?RAIL_CAR_T_DEFAULT:null), // rail: t per car
      product_id:prods[0]||'',
      products:prods.join(','),
      output_product_id:e.props?.output_product_id||'',
      channel:elChannel(e),
      berth_type:e.props?.berth_type||'',
      dispatch_type:e.props?.dispatch_type||''
    };
  });

  // dim_product
  // scm_type splits the 'additive' category into Slag vs Ash — both are stored as
  // category:'additive' (see PRODUCT_FAMILY_OF), so without this column the two are
  // indistinguishable downstream even though they're commercially separate materials.
  // product_family mirrors the app's own Family grouping so BI can roll up the way
  // the UI does (Cement = bulk + packed, SCM = additive).
  const dim_product=DB.products.map(p=>({
    product_id:p.id,
    product_name:p.name,
    category:p.category||'',
    product_family:(typeof PRODUCT_FAMILY_OF!=='undefined'?PRODUCT_FAMILY_OF[p.category]:'')||'',
    scm_type:p.category==='additive'?(p.scm_type||''):'',
    material_code:p.material_code||'',
    facility_id:p.facility_id||'',
    facility_name:(DB.facilities.find(f=>f.id===p.facility_id)?.name)||''
  }));

  // Lookup map: element_id → facility_id (assigned takes priority — that's what UIs trust)
  const elFac={};
  DB.elements.forEach(e=>{ elFac[e.id]=e.assigned_facility_id||e.facility_id||''; });
  const _elIds0=new Set(DB.elements.map(e=>e.id));
  const elType={}; DB.elements.forEach(e=>{ elType[e.id]=e.type; });
  const elPrimary={}; DB.elements.forEach(e=>{ elPrimary[e.id]=elProducts(e)[0]||''; });
  // Fallbacks for elements with nothing configured: a demand point takes the product the
  // sim inferred from its connected silos; a kiln takes the product of the silo it feeds.
  DB.elements.forEach(e=>{
    if(elPrimary[e.id]) return;
    if(e.type==='demand_point') elPrimary[e.id]=(r?.demandFill?.[e.id]?.products||[])[0]||_biProductFromName(e.name);
    else if(e.type==='kiln'){
      const to=(DB.connections||[]).filter(c=>c.from_element_id===e.id).map(c=>DB.elements.find(x=>x.id===c.to_element_id)).find(x=>x&&x.type==='bulk_silo');
      if(to) elPrimary[e.id]=getSiloProducts(to)[0]||'';
    }
  });
  const elChan={}; DB.elements.forEach(e=>{ elChan[e.id]=elChannel(e); });
  const elByName={}; DB.elements.forEach(e=>{ if(e.name) elByName[String(e.name).trim().toUpperCase()]=e; });
  dim_element.forEach(d=>{ if(!d.product_id&&elPrimary[d.element_id]){ d.product_id=elPrimary[d.element_id]; if(!d.products) d.products=d.product_id; } });

  // ── FACT: PRODUCTION ───────────────────────────────────
  const fact_production=[];
  // day_frac = the share of the day the unit was AVAILABLE to run: 1 normally, 0.5 on a half-day
  // PM (a fractional Maintenance Calendar event or a Down PM Day campaign — the simulation runs the
  // unit at 50 % that day). t/d on producing days = SUM(tonnes) ÷ SUM(day_frac) over rows with
  // tonnes > 0, so a half-day PM is not read as a slow full day.
  const _spansMemo={};
  const _spans=(elId)=>_spansMemo[elId]||(_spansMemo[elId]=_maintSpans(elId));
  const _dayFrac=(elId,ds)=>{
    const sp=_spans(elId); if(sp.partial.has(ds)) return Math.round((1-sp.partial.get(ds))*100)/100;
    const dc=_downCampaignAt(elId, ds); return (dc&&dc.product_id==='__down_pm__')?0.5:1;
  };
  // Actuals
  (DB.real_production_daily||[]).forEach(row=>{
    fact_production.push(stamp({
      scenario_type:'actual', date:row.date,
      facility_id:row.facility_id||elFac[row.element_id]||'',
      element_id:row.element_id, element_type:elType[row.element_id]||'',
      product_id:row.product_id, tonnes:parseFloat(row.volume_t)||0,
      status:'', stop_cause:'', day_frac:1
    }));
  });
  // Forecast — kilns (actual sim tonnes)
  if(r){
    Object.keys(r.kilnProdHistory||{}).forEach(kid=>{
      const arr=r.kilnProdHistory[kid]||[];
      const states=r.elementStates[kid]||[];
      arr.forEach((t,i)=>{
        if(t<=0&&states[i]==='running') return; // noise filter
        const ds=offsetToDate(i);
        fact_production.push(stamp({
          scenario_type:'forecast', date:ds,
          facility_id:elFac[kid]||'', element_id:kid, element_type:'kiln',
          product_id:elPrimary[kid]||'', // the kiln's output clinker when configured
          tonnes:Math.round(t)||0,
          status:states[i]||'', stop_cause:'', day_frac:_dayFrac(kid,ds)
        }));
      });
    });
    // Forecast — mills: tonnes the simulation really made that day (millOutputHistory — the rated
    // rate less clinker, silo room and rule limits, what the Supply page shows); runs saved
    // before that history existed fall back to the rated t/d of the chosen product.
    const millCap={}; // millId → {productId → tpd}
    DB.element_product_capacities.forEach(c=>{
      if(elType[c.element_id]!=='finish_mill') return;
      if(!millCap[c.element_id]) millCap[c.element_id]={};
      millCap[c.element_id][c.product_id]=parseFloat(c.capacity_tpd)||0;
    });
    Object.keys(r.millProductHistory||{}).forEach(mid=>{
      const arr=r.millProductHistory[mid]||[];
      const states=r.elementStates[mid]||[];
      arr.forEach((pid,i)=>{
        if(!pid){ return; } // idle day — skip
        const outArr=r.millOutputHistory?.[mid];
        const tpd=(outArr&&outArr[i]!=null)?outArr[i]:(millCap[mid]?.[pid]||0);
        const ds=offsetToDate(i);
        fact_production.push(stamp({
          scenario_type:'forecast', date:ds,
          facility_id:elFac[mid]||'', element_id:mid, element_type:'finish_mill',
          product_id:pid, tonnes:Math.round(tpd),
          status:states[i]||'', stop_cause:'', day_frac:_dayFrac(mid,ds)
        }));
      });
    });
    // Forecast — packing plants (one packed product per day, like mills; tonnes = what the
    // simulation packed that day (packOutputHistory), else the rated capacity for that product,
    // else the machine's pallets/day × t/pallet)
    const packCap={};
    DB.element_product_capacities.forEach(c=>{
      if(elType[c.element_id]!=='packing_plant') return;
      if(!packCap[c.element_id]) packCap[c.element_id]={};
      packCap[c.element_id][c.product_id]=parseFloat(c.capacity_tpd)||0;
    });
    Object.keys(r.packProductHistory||{}).forEach(pk=>{
      const arr=r.packProductHistory[pk]||[];
      const states=r.elementStates[pk]||[];
      const el=DB.elements.find(e=>e.id===pk);
      const fallback=(parseFloat(el?.props?.rated_capacity_pallets_day)||0)*(parseFloat(el?.props?.tonnes_per_pallet)||0);
      arr.forEach((pid,i)=>{
        if(!pid) return;
        const outArr=r.packOutputHistory?.[pk];
        const ds=offsetToDate(i);
        fact_production.push(stamp({
          scenario_type:'forecast', date:ds,
          facility_id:elFac[pk]||'', element_id:pk, element_type:'packing_plant',
          product_id:pid, tonnes:Math.round((outArr&&outArr[i]!=null)?outArr[i]:(packCap[pk]?.[pid]||fallback||0)),
          status:states[i]||'', stop_cause:'', day_frac:_dayFrac(pk,ds)
        }));
      });
    });
  }

  // ── FACT: DOWNTIME ─────────────────────────────────────
  // One row per kiln / finish mill / packing machine and DOWN day, with its reason — the
  // same reasons the Production page shows on that day.
  //  actual   — a day the production feed / Daily Data reported 0 t. Reason: a Maintenance
  //             Calendar event, else a Down For Repairs / PM Day / Inventory Control campaign
  //             entered for it, else "No reason given". down_days = 1.
  //  forecast — PLANNED downtime from today on, simulation's active facility: Maintenance Calendar
  //             events (whole days → maint, down_days 1; the fractional day of a 0.5- or 1.5-day
  //             event → pm, down_days = that fraction — the simulation runs it at the rest) and
  //             downtime campaigns (Down PM Day = ½ day, it runs at 50%). The simulation's own stops
  //             (silo full / no feed) are left out: past the loaded demand they turn into months
  //             of "down" days that nobody planned. A day that already has actuals is never forecast.
  const _DT_LBL={repair:'Repairs', pm:'PM day', inv:'Inventory control', maint:'Maintenance (calendar)', none:'No reason given'};
  const _DT_ORD={repair:1, pm:2, inv:3, maint:4, none:9};
  const fact_downtime=[];
  const _dtRow=(scen,ds,elId,code,source,down)=>fact_downtime.push(stamp({
    scenario_type:scen, date:ds, facility_id:elFac[elId]||'', element_id:elId, element_type:elType[elId]||'',
    reason_code:code, reason:_DT_LBL[code], reason_order:_DT_ORD[code], source, down_days:down }));
  const _prodEls=DB.elements.filter(e=>(e.type==='kiln'||e.type==='finish_mill'||e.type==='packing_plant')&&e.is_active!==false);
  const _realDays={};   // elId → Set of dates with actuals (any tonnes)
  (DB.real_production_daily||[]).forEach(row=>{ (_realDays[row.element_id]=_realDays[row.element_id]||new Set()).add(row.date); });
  _prodEls.forEach(el=>{
    const maint=_maintDayMap(el.id);
    (_realDays[el.id]||new Set()).forEach(ds=>{
      const tot=_dedupRealProd(el.id, ds).reduce((s,x)=>s+(parseFloat(x.volume_t)||0),0);
      if(tot>0) return;
      const dc=maint.has(ds)?null:_downCampaignAt(el.id, ds);
      if(maint.has(ds)) _dtRow('actual',ds,el.id,'maint','maintenance',1);
      else if(dc) _dtRow('actual',ds,el.id,DOWNTIME_PRODUCTS[dc.product_id],'campaign',1);
      else _dtRow('actual',ds,el.id,'none','not recorded',1);
    });
  });
  if(r){
    _prodEls.filter(el=>r.elementStates?.[el.id]).forEach(el=>{
      const sp=_spans(el.id), real=_realDays[el.id]||new Set();
      for(let i=0;i<horizon;i++){
        const ds=offsetToDate(i);
        if(ds<asOf||real.has(ds)) continue;
        const dc=_downCampaignAt(el.id, ds);
        if(sp.full.has(ds)) _dtRow('forecast',ds,el.id,'maint','maintenance',1);
        else if(sp.partial.has(ds)) _dtRow('forecast',ds,el.id,'pm','maintenance',sp.partial.get(ds));
        else if(dc){ const k=DOWNTIME_PRODUCTS[dc.product_id]; _dtRow('forecast',ds,el.id,k,'campaign',k==='pm'?0.5:1); }
      }
    });
  }

  // ── FACT: INVENTORY ────────────────────────────────────
  const fact_inventory=[];
  // A reading belongs to its silo's facility. Older records were stamped with the main
  // (BRS) facility, which filed MIA/PEV/SUT… silos under BRS in Power BI, and some
  // silo-days were saved twice (once per facility) — keep the newest per silo·day·product.
  // Silos no longer in the topology are skipped.
  const _invAct={};
  (DB.real_inventory_daily||[]).forEach(row=>{
    if(!_elIds0.has(row.silo_id)) return;
    const k=row.silo_id+'|'+row.date+'|'+(row.product_id||'');
    const prev=_invAct[k];
    if(!prev||String(row.updated_at||'')>=String(prev.updated_at||'')) _invAct[k]=row;
  });
  Object.values(_invAct).forEach(row=>{
    fact_inventory.push(stamp({
      scenario_type:'actual', date:row.date,
      facility_id:elFac[row.silo_id]||row.facility_id||'',
      element_id:row.silo_id, element_type:elType[row.silo_id]||'',
      product_id:row.product_id||'',
      tonnes_eod:parseFloat(row.eod_volume_t)||0
    }));
  });
  if(r){
    Object.keys(r.inventoryHistory||{}).forEach(eid=>{
      const t=elType[eid]; if(t!=='bulk_silo'&&t!=='packed_silo'&&t!=='raw_material_storage'&&t!=='fuel_storage') return;
      const arr=r.inventoryHistory[eid]||[];
      arr.forEach((tn,i)=>{
        fact_inventory.push(stamp({
          scenario_type:'forecast', date:offsetToDate(i),
          facility_id:elFac[eid]||'', element_id:eid, element_type:t,
          // the sim keeps one total per silo; attribute it to the silo's primary product
          product_id:elPrimary[eid]||'',
          tonnes_eod:Math.round(tn)||0
        }));
      });
    });
  }

  // ── FACT: DEMAND ───────────────────────────────────────
  const fact_demand=[];
  // Rows whose demand point no longer exists in the topology are skipped — the sim and
  // the Demand page ignore them too, and in Power BI they had no facility or product.
  const _elIds=new Set(DB.elements.map(e=>e.id)); let _orphanDemand=0;
  (DB.demand_values||[]).forEach(row=>{
    if(!_elIds.has(row.element_id)){ _orphanDemand++; return; }
    const dp=DB.demand_points.find(d=>d.element_id===row.element_id);
    fact_demand.push(stamp({
      scenario_type:row.source==='actual'?'actual':row.source==='budget'?'budget':'forecast',
      plan_version_id:row.version_id||'',
      date:row.date,
      facility_id:dp?(dp.assigned_facility_id||dp.facility_id):elFac[row.element_id]||'',
      demand_point_id:row.element_id,
      product_id:row.product_id||elPrimary[row.element_id]||'',
      channel:elChan[row.element_id]||'',
      ship_to:row.ship_to||'',
      demand_t:parseFloat(row.value_t)||0
    }));
  });
  (DB.real_shipments_daily||[]).forEach(row=>{
    // product_key is the demand point's name (e.g. BRS/DEM/BRS_IL(12)/BLK/EXT) — resolve it
    // so shipments slice by facility / product like everything else; origin is the fallback.
    const dpEl=elByName[String(row.product||'').trim().toUpperCase()];
    const dpFac=dpEl?(dpEl.assigned_facility_id||dpEl.facility_id||''):'';
    fact_demand.push(stamp({
      scenario_type:'actual', date:row.date,
      facility_id:dpFac||facByName[String(row.origin||'').trim().toUpperCase()]||'',
      demand_point_id:dpEl?dpEl.id:'', origin:row.origin||'',
      product_id:dpEl?(elPrimary[dpEl.id]||''):'', product_key:row.product||'',
      channel:dpEl?(elChan[dpEl.id]||''):'',
      customer_type:row.customer_type||'', ship_to:row.ship_to||'',
      sales_manager:row.sales_manager||'',
      shipped_t:parseFloat(row.volume)||0
    }));
  });

  // Demand swaps (material substitution). demand_values holds each point's OWN demand, so on
  // its own fact_demand ignored the relocation: the source kept the full tonnes and the
  // receiving point none of them. The simulation already settles the swap per day
  // (demandSwapHistory), so emit it as signed adjustment rows - negative at the source, positive
  // at the receiving point, in that point's own product. SUM(demand_t) then equals the
  // effective demand the app shows; filter adjustment = '' for the untouched planned demand.
  // Days before today are REAL data (actual demand / shipments) - a swap is a plan, so it is
  // never applied to them in the export.
  if(r&&r.demandSwapHistory){
    Object.entries(r.demandSwapHistory).forEach(([dpId,arr])=>{
      if(!_elIds.has(dpId)) return;
      const dp=DB.demand_points.find(d=>d.element_id===dpId);
      const base={
        scenario_type:'forecast',
        facility_id:dp?(dp.assigned_facility_id||dp.facility_id):elFac[dpId]||'',
        demand_point_id:dpId, product_id:elPrimary[dpId]||'',
        channel:elChan[dpId]||'', ship_to:''
      };
      (arr||[]).forEach((h,i)=>{
        if(!h) return;
        if(offsetToDate(i)<asOf) return; // past = real data only
        const out=parseFloat(h.swappedOut)||0, inn=parseFloat(h.swappedIn)||0;
        if(out>0.0005) fact_demand.push(stamp({...base, date:offsetToDate(i), demand_t:-Math.round(out*1000)/1000, adjustment:'swap_out', swap_to_id:h.toElement||''}));
        if(inn>0.0005) fact_demand.push(stamp({...base, date:offsetToDate(i), demand_t:Math.round(inn*1000)/1000, adjustment:'swap_in'}));
      });
    });
  }

  // ── FACT: UNLOADING ────────────────────────────────────
  const fact_unloading=[];
  (DB.real_unloading_daily||[]).forEach(row=>{
    fact_unloading.push(stamp({
      scenario_type:'actual', date:row.date,
      facility_id:row.facility_id||elFac[row.berth_id]||'',
      berth_id:row.berth_id, mode:row.mode||'',
      product_id:row.product_id||'',
      value:parseFloat(row.value)||0, unit:row.unit||'t'
    }));
  });
  if(r){
    Object.keys(r.berthUnloadHistory||{}).forEach(bid=>{
      const arr=r.berthUnloadHistory[bid]||[];
      arr.forEach((t,i)=>{
        if(t<=0) return;
        fact_unloading.push(stamp({
          scenario_type:'forecast', date:offsetToDate(i),
          facility_id:elFac[bid]||'', berth_id:bid, mode:'',
          product_id:'', value:Math.round(t), unit:'t'
        }));
      });
    });
  }

  // ── FACT: RAIL MOVEMENT ────────────────────────────────
  const fact_rail_movement=[];
  (DB.rail_movements||[]).forEach(rm=>{
    fact_rail_movement.push(stamp({
      scenario_type:rm.status==='Confirmed'||rm.status==='Delivered'?'actual':'forecast',
      departure_date:rm.departure_date||rm.date||'',
      arrival_date:rm.departure_date
        ?_addDays(rm.departure_date,parseInt(rm.transit_days)||1):'',
      from_facility_id:_railMoveOriginFacId(rm)||'',
      to_facility_id:rm.to_facility_id||'',
      dispatch_id:rm.from_dispatch_id||'',
      berth_id:rm.to_berth_id||'',
      product_id:rm.product_id||'',
      cars:parseInt(rm.wagon_count)||0,
      tonnes:parseFloat(rm.total_capacity_t)||((parseInt(rm.wagon_count)||0)*(parseFloat(rm.wagon_capacity_t)||0)),
      transit_days:parseInt(rm.transit_days)||1,
      status:rm.status||'',
      record_kind:'movement',
      event_date:rm.departure_date||rm.date||'',
      facility_id:_railMoveOriginFacId(rm)||''
    }));
  });
  (DB.real_rail_daily||[]).forEach(row=>{
    fact_rail_movement.push(stamp({
      scenario_type:'actual',
      departure_date:row.type==='loading'?row.date:'',
      arrival_date:row.type==='delivered'?row.date:'',
      from_facility_id:row.type==='loading'?row.facility_id:'',
      to_facility_id:row.type==='delivered'?row.facility_id:'',
      product_id:row.product_id||'',
      cars:parseInt(row.cars)||0, tonnes:0, transit_days:null,
      status:row.type||'',
      // v2: yard counts / dispatched / placed rows used to export with no date and no
      // facility at all. They are daily records (not movements): never sum them as trips.
      record_kind:'daily',
      event_date:row.date||'',
      facility_id:row.facility_id||''
    }));
  });

  // ── FACT: SERVICE (sim) ────────────────────────────────
  // Requested vs served per demand point per day — the fill-rate numbers behind the
  // Results dashboard. A shortfall is a stock-out at that point.
  const fact_service=[];
  if(r){
    Object.entries(r.demandFill||{}).forEach(([dpId,df])=>{
      const req=df.reqDaily||[], srv=df.servDaily||[];
      for(let i=0;i<req.length;i++){
        const q=parseFloat(req[i])||0; if(q<=0) continue;
        const s=parseFloat(srv[i])||0;
        fact_service.push(stamp({
          scenario_type:'forecast', date:offsetToDate(i),
          facility_id:df.facilityId||elFac[dpId]||'', demand_point_id:dpId,
          product_id:elPrimary[dpId]||(df.products||[])[0]||'',
          channel:elChan[dpId]||'',
          requested_t:Math.round(q*10)/10, served_t:Math.round(s*10)/10,
          short_t:Math.max(0,Math.round((q-s)*10)/10)
        }));
      }
    });
  }

  // ── FACT: RAIL SIM (daily rail state, as the Supply / Rail pages show it) ─
  // origin rows: cars loaded and cars in the yard per dispatch point + product
  // dispatch rows: cars sent per destination facility
  // terminal rows: tonnes in transit / at the rail yard / at the local yard (beginning
  // of day), arrived at the rail yard and pulled to the local yard that day
  const fact_rail_sim=[];
  if(r){
    Object.entries(r.railHistory||{}).forEach(([dId,arr])=>{
      (arr||[]).forEach((h,i)=>{
        if(!h) return;
        const date=offsetToDate(i), fac=elFac[dId]||'';
        const pids=new Set([...Object.keys(h.carsLoadedByProduct||{}),...Object.keys(h.carsInYardByProduct||{})]);
        pids.forEach(pid=>{
          const ld=parseFloat(h.carsLoadedByProduct?.[pid])||0, yd=parseFloat(h.carsInYardByProduct?.[pid])||0;
          if(!ld&&!yd) return;
          fact_rail_sim.push(stamp({scenario_type:'forecast', date, row_kind:'origin', facility_id:fac,
            element_id:dId, product_id:pid, to_facility_id:'', cars_loaded:ld, cars_in_yard:yd, cars_dispatched:null,
            in_transit_t:null, at_railyard_t:null, local_yard_t:null, arrived_t:null, pulled_t:null}));
        });
        Object.entries(h.dispatchByDest||{}).forEach(([toFac,cars])=>{
          if(!(parseFloat(cars)>0)) return;
          fact_rail_sim.push(stamp({scenario_type:'forecast', date, row_kind:'dispatch', facility_id:fac,
            element_id:dId, product_id:'', to_facility_id:toFac, cars_loaded:null, cars_in_yard:null, cars_dispatched:parseFloat(cars),
            in_transit_t:null, at_railyard_t:null, local_yard_t:null, arrived_t:null, pulled_t:null}));
        });
      });
    });
    const H={transit:r.railTransitHistory||{}, rly:r.railAtRailyardHistory||{}, ly:r.railYardHistory||{},
             arr:r.railArrivedHistory||{}, pul:r.railPulledHistory||{}};
    new Set([...Object.keys(H.transit),...Object.keys(H.ly)]).forEach(bId=>{
      const n=Math.max(...Object.values(H).map(h=>(h[bId]||[]).length));
      for(let i=0;i<n;i++){
        const g=(k,pid)=>parseFloat(((H[k][bId]||[])[i]||{})[pid])||0;
        const pids=new Set(); Object.values(H).forEach(h=>Object.keys((h[bId]||[])[i]||{}).forEach(p=>pids.add(p)));
        pids.forEach(pid=>{
          const v={in_transit_t:g('transit',pid), at_railyard_t:g('rly',pid), local_yard_t:g('ly',pid), arrived_t:g('arr',pid), pulled_t:g('pul',pid)};
          if(!Object.values(v).some(x=>x)) return;
          Object.keys(v).forEach(k=>v[k]=Math.round(v[k]));
          fact_rail_sim.push(stamp({scenario_type:'forecast', date:offsetToDate(i), row_kind:'terminal', facility_id:elFac[bId]||'',
            element_id:bId, product_id:pid, to_facility_id:'', cars_loaded:null, cars_in_yard:null, cars_dispatched:null, ...v}));
        });
      }
    });
  }

  // ── FACT: VESSEL CALL (one row per port of call) ───────
  // The schedule plus what the sim did with it: first/last unloading day, days at
  // anchorage and tonnes still aboard at the end of the horizon.
  const fact_vessel_call=[];
  (DB.vessel_calls||[]).forEach(v=>{
    const legs=(v.legs&&v.legs.length)?v.legs:[{berth_element_id:v.berth_element_id,arrival_date:v.arrival_date,
      product_id:v.product_id,quantity_t:v.quantity_t||v.total_quantity_t}];
    legs.forEach((l,li)=>{
      const bId=l.berth_element_id||'';
      const hist=(r&&r.berthVesselHistory&&r.berthVesselHistory[bId])||[];
      let firstU=null,lastU=null,anch=0,left=null,seen=false;
      hist.forEach((bv,i)=>{
        if(!bv) return;
        if(bv.dockedCallId===v.id){
          seen=true; left=bv.dockedLeft;
          if(bv.state==='unloading'){ if(firstU===null) firstU=i; lastU=i; } else anch++;
        } else {
          const w=(bv.waitingList||[]).find(x=>x.vesselCallId===v.id);
          if(w){ seen=true; anch++; left=w.left; }
        }
      });
      fact_vessel_call.push(stamp({
        scenario_type:v.status==='Finished'?'actual':'forecast',
        vessel_call_id:v.id, leg:li+1, vessel_name:v.name||'',
        facility_id:elFac[bId]||v.facility_id||'', berth_id:bId,
        product_id:l.product_id||v.product_id||'',
        arrival_date:(l.arrival_date||'').slice(0,10),
        quantity_t:parseFloat(l.quantity_t)||0,
        unload_rate_tph:parseFloat(l.unload_rate_tph||v.unload_rate_tph)||null,
        status:v.status||'',
        sim_first_unload_date:firstU!==null?offsetToDate(firstU):'',
        sim_last_unload_date:lastU!==null?offsetToDate(lastU):'',
        sim_anchorage_days:seen?anch:null,
        sim_left_aboard_t:seen&&left!==null?Math.round(left):null
      }));
    });
  });

  // ── SILO TRANSFERS (DB.silo_links) ─────────────────────
  // dim_silo_link: one row per link. fact_silo_transfer: one row per link, direction and day.
  //   actual   → tonnes recorded as moved (real_silo_transfers_daily)
  //   forecast → tonnes the simulation moved; planned_t = what it was asked to move (the plan,
  //              or the recorded actual on a day that has one — forecast_basis says which);
  //              short_t = the part it could not (origin empty / destination full)
  // facility_id is the facility the material LEAVES and to_facility_id the one it reaches;
  // cross_facility rows are supply for the receiver, the rest are moves inside one facility.
  const _slById={}; (DB.silo_links||[]).forEach(l=>{ _slById[l.id]=l; });
  const _elName=id=>(DB.elements.find(e=>e.id===id)||{}).name||'';
  const dim_silo_link=(DB.silo_links||[]).map(lk=>{
    const fF=elFac[lk.from_silo_id]||'', tF=elFac[lk.to_silo_id]||'';
    return {
      link_id:lk.id, link_name:_slName(lk),
      from_silo_id:lk.from_silo_id, from_silo_name:_elName(lk.from_silo_id), from_facility_id:fF, from_facility_name:facName[fF]||'',
      to_silo_id:lk.to_silo_id, to_silo_name:_elName(lk.to_silo_id), to_facility_id:tF, to_facility_name:facName[tF]||'',
      product_id:lk.product_id||'', product_name:(DB.products.find(p=>p.id===lk.product_id)||{}).name||'',
      route:`${_slShort(lk.from_silo_id)} ${lk.two_way?'⇄':'→'} ${_slShort(lk.to_silo_id)}`,
      direction:lk.two_way?'two way':'one way',
      max_rate_tpd:parseFloat(lk.max_rate_tpd)||null,
      cross_facility:fF!==tF,
      is_valid:_slValid(lk) // false = the two silos no longer hold the same product (the sim ignores it)
    };
  });
  const fact_silo_transfer=[];
  const _r1=x=>Math.round((parseFloat(x)||0)*10)/10;
  const _xferRow=(lk,from,to,v)=>{
    const fF=elFac[from]||'', tF=elFac[to]||'';
    return stamp({scenario_type:v.scenario_type, date:v.date, link_id:lk.id,
      direction:from===lk.from_silo_id?'forward':'reverse',
      route:`${_slShort(from)} → ${_slShort(to)}`, // the Supply-page row label (one per direction)
      facility_id:fF, to_facility_id:tF, from_silo_id:from, to_silo_id:to,
      product_id:lk.product_id||'', cross_facility:fF!==tF,
      tonnes:v.tonnes, planned_t:v.planned_t, short_t:v.short_t, forecast_basis:v.basis});
  };
  (DB.real_silo_transfers_daily||[]).forEach(t=>{
    const lk=_slById[t.link_id]; if(!lk||!t.date) return; // a deleted link's leftovers
    fact_silo_transfer.push(_xferRow(lk,t.from_silo_id,t.to_silo_id,{scenario_type:'actual', date:t.date,
      tonnes:_r1(t.volume_t), planned_t:null, short_t:null, basis:''}));
  });
  if(r){
    Object.entries(r.siloTransferHistory||{}).forEach(([lid,arr])=>{
      const lk=_slById[lid]; if(!lk) return;
      (arr||[]).forEach((h,i)=>{
        if(!h) return;
        [['fwd',lk.from_silo_id,lk.to_silo_id],['rev',lk.to_silo_id,lk.from_silo_id]].forEach(([k,from,to])=>{
          const m=h[k]; if(!m) return;
          fact_silo_transfer.push(_xferRow(lk,from,to,{scenario_type:'forecast', date:offsetToDate(i),
            tonnes:_r1(m.moved), planned_t:_r1(m.asked), short_t:Math.max(0,_r1(m.asked-m.moved)), basis:m.real?'actual':'plan'}));
        });
      });
    });
  }

  // ── SOF: the laytime statement per vessel call + the time accounting behind it ──
  // fact_sof_period — one row per Statement-of-Facts period (port clock); counted / laytime_h /
  //   demurrage_h follow the same rule as the SOF window (sofLaytime).
  // fact_laytime    — one row per vessel call: the whole voyage (every port's SOF together).
  const fact_sof_period=[], fact_laytime=[];
  const _r2=x=>x==null||!isFinite(x)?null:Math.round(x*100)/100;
  const _sp=x=>String(x||'').replace('T',' ');
  (DB.vessel_calls||[]).forEach(v=>{
    const sofs=(DB.vessel_sof||[]).filter(sf=>sf.vessel_call_id===v.id); if(!sofs.length) return;
    const lt=sofLaytime(v), stops=_sofStops(v);
    sofs.forEach(sf=>{
      const st=stops.find(x=>(x.legId||'')===(sf.leg_id||''));
      (sf.periods||[]).forEach(p=>{
        const q=lt.per[p.id]||{};
        fact_sof_period.push(stamp({
          scenario_type:'actual', vessel_call_id:v.id, leg:st?(st.li<0?1:st.li+1):null, sof_id:sf.id, vessel_name:v.name||'',
          facility_id:sf.facility_id||elFac[sf.berth_element_id]||'', berth_id:sf.berth_element_id||'', product_id:v.product_id||'',
          date:String(p.start||'').slice(0,10), start:_sp(p.start), end:_sp(p.end), hours:_r2(q.h),
          category:p.category||'', cause:p.cause||'none', hold:p.hold||'', description:p.description||'', sof_notes:p.notes||'',
          counts_setting:p.counts||'auto', counted:!!q.counted, laytime_h:_r2(q.lay||0), demurrage_h:_r2(q.dem||0),
          rule:q.why||'', reason:p.reason||'', sof_status:sf.status||'draft'
        }));
      });
    });
    const starts=sofs.map(sf=>lt.win[sf.id]&&lt.win[sf.id].a).filter(isFinite).sort((a,b)=>a-b);
    const ends=sofs.map(sf=>lt.win[sf.id]&&lt.win[sf.id].b).filter(isFinite).sort((a,b)=>b-a);
    const cat=k=>_r2(lt.byCat[k]||0);
    fact_laytime.push(stamp({
      scenario_type:'actual', vessel_call_id:v.id, vessel_name:v.name||'', product_id:v.product_id||'', facility_id:v.facility_id||'',
      date:starts.length?_sofIso(starts[0]).slice(0,10):String(v.arrival_date||'').slice(0,10),
      arrival_date:String(v.arrival_date||'').slice(0,10), ports:lt.nStops, sofs:lt.nSofs, complete:lt.complete, reviewed:lt.reviewed,
      laytime_start:starts.length?_sp(_sofIso(starts[0])):'', laytime_end:ends.length?_sp(_sofIso(ends[0])):'',
      notice_h:lt.notice, discharge_rate_tpd:lt.dischRate, discharge_t:lt.qty?Math.round(lt.qty):null, allowed_h:lt.allowed!=null?_r2(lt.allowed):null, counted_h:_r2(lt.used),
      laytime_used_h:lt.allowed!=null?_r2(Math.min(lt.used,lt.allowed)):null,
      demurrage_h:lt.allowed!=null?_r2(lt.demH):null, despatch_h:lt.allowed!=null&&lt.complete?_r2(lt.despH):null,
      dem_rate_usd_day:lt.rate||null, despatch_rate_usd_day:lt.despRate||null,
      demurrage_usd:lt.allowed!=null&&lt.rate?Math.round(lt.demUsd):null,
      despatch_usd:lt.allowed!=null&&lt.despRate&&lt.complete?Math.round(lt.despUsd):null,
      port_time_h:_r2(Object.values(lt.byCat).reduce((a,b)=>a+b,0)),
      waiting_h:cat('Waiting at anchor'), discharging_h:cat('Discharging'), shore_delay_h:cat('Shore delay'),
      weather_delay_h:cat('Weather delay'), ship_delay_h:cat('Ship delay'),
      vessel_cause_h:_r2(lt.byCause.vessel||0), terminal_cause_h:_r2(lt.byCause.terminal||0), weather_cause_h:_r2(lt.byCause.weather||0)
    }));
  });

  // ── FACT: STOP EVENTS ──────────────────────────────────
  const fact_stop_events=[];
  if(r){
    (r.stopEvents||[]).forEach(ev=>{
      fact_stop_events.push(stamp({
        scenario_type:'forecast',
        date:offsetToDate((ev.day||1)-1),
        facility_id:elFac[ev.element_id]||'',
        element_id:ev.element_id, element_name:ev.element_name||'',
        element_type:elType[ev.element_id]||'',
        cause:ev.cause||'', type:ev.type||''
      }));
    });
  }

  // ── META ──────────────────────────────────────────────
  const meta=[
    {key:'as_of_date',value:asOf},
    {key:'scenario_run_id',value:runId},
    {key:'simulation_start_date',value:simStart},
    {key:'simulation_horizon_days',value:horizon},
    {key:'simulation_active_facility',value:getFacility()?.name||''},
    {key:'scenario_name',value:scName},
    {key:'scenario_kind',value:scKind},
    {key:'plan_version_id',value:planV?planV.id:''},
    {key:'plan_version_label',value:planV?planV.label:''},
    {key:'plan_source_scenario',value:S.simCfg.plan_source_name||''},
    {key:'export_version',value:'8'},
    {key:'note_cases',value:'Planning workbook only: <fact>_cases sheets hold the forecast rows of the yield-sensitivity runs (case = yield | yield_avail, see dim_case / dim_yield); the base sheets are the rated-capacity run (case = rated).'},
    {key:'skipped_orphan_demand_rows',value:String(_orphanDemand)},
    {key:'note_forecast_scope',value:'Forecast rows cover only the simulation\'s active facility. Actuals span every facility present in real_* tables.'},
    {key:'note_inventory_breakdown',value:'Forecast inventory is total per silo (product breakdown is not retained after the run). Actual inventory carries product_id.'},
    {key:'note_mill_tonnes',value:'Forecast kiln, mill and packing tonnes are the simulation\'s real daily output (for mills: the rated rate less clinker, silo room and rule limits; runs saved before that history existed fall back to rated_tpd). day_frac = share of the day the unit was available to run: 1, or 0.5 on a half-day PM (fractional Maintenance Calendar event or Down PM Day campaign) when it ran at 50 %. t/d on producing days = SUM(tonnes) / SUM(day_frac) over rows with tonnes > 0.'},
    {key:'note_demand_swaps',value:'fact_demand: demand swaps are signed adjustment rows (adjustment = swap_out / swap_in, negative at the source point, positive at the receiving point in its own product). SUM(demand_t) is the effective demand; the planned demand rows have adjustment blank.'},
    {key:'note_dim_date',value:'dim_date is a contiguous day-by-day calendar covering every date referenced by any fact (including rail departure/arrival and forecast demand). Safe to mark as the Power BI date table.'},
    {key:'note_scm_type',value:'dim_product.scm_type splits category=additive into slag/ash. Blank means the product has not been tagged yet in the product editor.'},
    {key:'note_sof',value:'fact_sof_period: the Statement-of-Facts time accounting, one row per period, times on the port clock. counted / laytime_h / demurrage_h follow the default rule (time caused by the vessel never counts; weather counts only once the vessel is on demurrage; everything else counts) unless a period was set Y/N by hand (counts_setting). fact_laytime: one row per vessel call, the whole voyage (all ports together); demurrage_usd is blank until the charter terms are entered on the vessel call.'},
    {key:'note_downtime',value:'fact_downtime: one row per kiln / finish mill / packing machine and down day. actual = a day reported at 0 t (reason: Maintenance Calendar event, else a Down For Repairs / PM Day / Inventory Control campaign entered for it, else "No reason given"). forecast = PLANNED downtime from as_of_date on, simulation facility only: Maintenance Calendar events (whole days = reason maint, 1 each; the fractional day of a 0.5- or 1.5-day event = reason pm, down_days = that fraction) and downtime campaigns (Down PM Day counts 0.5); simulation stops are not included. SUM(down_days) = days down.'},
    {key:'note_silo_transfer',value:'fact_silo_transfer: one row per silo link, direction and day. actual = tonnes recorded as moved; forecast = tonnes the simulation moved (planned_t = asked, short_t = could not move). facility_id = origin facility, to_facility_id = receiving facility; cross_facility=true rows are inbound supply for the receiver. Their effect is already inside fact_inventory — do not add them to stock.'}
  ];

  // ── BUDGET (planning module) ──────────────────────────
  const dim_scenario=[{scenario_run_id:runId, scenario_name:scName, scenario_kind:scKind, as_of_date:asOf, simulation_start_date:simStart, simulation_horizon_days:horizon,
    plan_version_id:planV?planV.id:'', plan_version_label:planV?planV.label:'', plan_source_scenario:S.simCfg.plan_source_name||''}];
  const dim_plan_version=(DB.plan_versions||[]).map(v=>({version_id:v.id, label:v.label, kind:v.kind||'budget', year:v.year, status:v.status, uploaded_at:v.uploaded_at, uploaded_by:v.uploaded_by||'', generated_at:v.generated_at||'',
    source_files:(v.source_files||[]).map(f=>f.name).join(' | '), note:v.note||''}));
  const _vLabel={}; (DB.plan_versions||[]).forEach(v=>{ _vLabel[v.id]=v.label; });
  const fact_plan_line=[];
  if((DB.plan_lines||[]).length){
    const _y=(DB.plan_settings||[]).find(x=>x.id==='default')?.budget_year||new Date().getFullYear()+1;
    (DB.plan_lines||[]).forEach(l=>{
      const e=l.kind==='LOAD'?xlmapFindDp(l.dp_name):null; const t={dp_name:e?e.name:(l.dp_name||''), element_id:e?e.id:''};
      (l.months||[]).forEach((x,m)=>{ const bt=+x||0; if(!bt) return;
        fact_plan_line.push(stamp({version_id:l.version_id, version_label:_vLabel[l.version_id]||'', kind:l.src==='EXT'||l.src==='INT'?l.src:l.kind, family:l.family||'', month:`${_y}-${String(m+1).padStart(2,'0')}-01`,
          sold_to:l.sold_to||'', sold_to_name:l.sold_to_name||'', ship_to:l.ship_to||'', ship_to_name:l.ship_to_name||'', rmx_plant:l.rmx_plant||'', rmx_name:l.rmx_name||'', district:l.district||'',
          plant:l.plant||'', material:l.material||'', material_desc:l.material_desc||'', incoterm:l.incoterm||'',
          demand_point_id:t.element_id||'', dp_name:t.dp_name||'', facility_id:t.element_id?(elFac[t.element_id]||''):'', product_id:t.element_id?(elPrimary[t.element_id]||''):'', channel:t.element_id?(elChan[t.element_id]||''):'',
          share:1, budget_t:Math.round(bt*10)/10})); }); });
  }
  const fact_plan_demand=[];
  (DB.plan_demand||[]).forEach(p=>{ (p.days||[]).forEach((t,i)=>{ if(!(t>0)) return;
    fact_plan_demand.push(stamp({version_id:p.version_id, version_label:_vLabel[p.version_id]||'', date:p.ym+'-'+String(i+1).padStart(2,'0'), demand_point_id:p.element_id, dp_name:p.dp_name||'',
      facility_id:elFac[p.element_id]||'', product_id:elPrimary[p.element_id]||'', channel:elChan[p.element_id]||'', budget_t:t})); }); });

  return {
    meta,
    dim_date, dim_facility, dim_element, dim_product, dim_silo_link, dim_scenario, dim_plan_version,
    fact_production, fact_downtime, fact_inventory, fact_demand,
    fact_unloading, fact_rail_movement, fact_stop_events,
    fact_service, fact_rail_sim, fact_vessel_call, fact_silo_transfer,
    fact_sof_period, fact_laytime, fact_plan_line, fact_plan_demand
  };
}

function _isoWeek(d){
  const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  const dow=t.getUTCDay()||7;
  t.setUTCDate(t.getUTCDate()+4-dow);
  const yearStart=new Date(Date.UTC(t.getUTCFullYear(),0,1));
  return Math.ceil((((t-yearStart)/86400000)+1)/7);
}

function _addDays(ymd,n){
  const d=new Date(ymd+'T00:00:00');
  d.setDate(d.getDate()+(n||0));
  return d._ymd();
}

// Flattens the simulation's per-silo inventory projection into per-date,
// per-product rows — same shape as DB.real_inventory_daily (which holds the
// actual/historical side) so the two line up for anyone consuming the file.
// A silo's simulated inventory is attributed to its primary (first) product,
// matching how the inventory bar charts group silos by product (_invChartRow).
function _buildForecastInventoryDaily(){
  const r=S.simResults; if(!r||!r.inventoryHistory) return [];
  const startStr=S.simCfg.start_date; if(!startStr) return [];
  const rows=[];
  DB.elements.forEach(el=>{
    if(el.type!=='bulk_silo'&&el.type!=='packed_silo') return;
    const hist=r.inventoryHistory[el.id]; if(!hist||!hist.length) return;
    const prodIds=getSiloProducts(el); if(!prodIds.length) return;
    const facId=el.assigned_facility_id||el.facility_id||null;
    hist.forEach((invVal,dayIdx)=>{
      rows.push({date:_addDays(startStr,dayIdx), facility_id:facId, silo_id:el.id, product_id:prodIds[0], inventory_t:invVal});
    });
  });
  return rows;
}

function exportJSON(){
  const payload={
    _version:'0.4',
    _exported:new Date().toISOString(),
    _facility:getFacility()?.name||'unknown',
    DB,
    simCfg:S.simCfg,
    // Forecasted/future inventory — simResults is the full simulation output (raw,
    // per-silo inventoryHistory + everything else runSimulation produces);
    // forecast_inventory_daily is the same inventory projection flattened to
    // per-product daily rows for easy consumption without cross-referencing DB.elements.
    simResults:S.simResults||null,
    forecast_inventory_daily:_buildForecastInventoryDaily()
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  const facName=(getFacility()?.name||'avila_roll').replace(/\s+/g,'_');
  a.download=`AVILA_Roll_${facName}_${new Date()._ymd()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  statMsg('JSON exported');
}

function importJSON(input){
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    let saved;
    try{ saved=JSON.parse(e.target.result); }
    catch(err){ statMsg('Import failed — not a valid JSON file'); console.error(err); input.value=''; return; }
    // Everything that can be checked is checked BEFORE the live DB is touched.
    if(!saved || typeof saved.DB!=='object' || saved.DB===null || Array.isArray(saved.DB)){ statMsg('Invalid file — no DB found'); input.value=''; return; }
    if(_scIsSalesPayload(saved)){ statMsg('⚠ That is an Avila Sales file, not an Avila Roll scenario — nothing was imported'); input.value=''; return; }
    const kind=v=>Array.isArray(v)?'array':(v===null?'null':typeof v);
    const bad=[];
    Object.keys(DB).forEach(table=>{
      if(saved.DB[table]===undefined) return;
      const want=kind(DB[table]), got=kind(saved.DB[table]);
      if(want!=='null' && want!=='undefined' && want!==got) bad.push(table+' (expected '+want+', file has '+got+')');
    });
    if(bad.length){
      statMsg('Import refused — the file does not match this app\'s data layout; nothing was changed ('+bad.slice(0,3).join('; ')+(bad.length>3?'; …':'')+')');
      console.error('importJSON: table type mismatch', bad);
      input.value=''; return;
    }
    // Apply, remembering what was replaced so a failure puts everything back.
    const prev={}, prevSim=S.simResults, prevCfg=JSON.parse(JSON.stringify(S.simCfg)), prevCounter=S.elCounter;
    try{
      Object.keys(DB).forEach(table=>{
        if(saved.DB[table]!==undefined){ prev[table]=DB[table]; DB[table]=saved.DB[table]; }
      });
      // Every table was just replaced — drop the memoised demand / holiday lookups, or the
      // pages below (and the next typed demand cell) would still read the pre-import values.
      _demandCacheInvalidate();
      _slResetIfAbsent(saved.DB);
      _campTidyAfterLoad();
      if(saved.simCfg) Object.assign(S.simCfg,saved.simCfg);
      if(saved.counter) S.elCounter=saved.counter;
      syncElCounter();
      // Reset canvas and re-render everything. Restore the forecasted inventory
      // (simResults) if the file carried one — otherwise fall back to null so the
      // page schedules a fresh simulation run (see the DOMContentLoaded handler).
      S.simResults=saved.simResults||null;
      S.selectedEl=null;
      if(DB.facilities.length) selectFacility(DB.facilities[0].id);
      updateStatusBar();
      renderLocationTree();
      updateNavFacilities();
      switchTopSection('production');
      autoSave();   // only once the imported state has actually rendered
      statMsg(`Loaded: ${file.name}`);
    }catch(err){
      Object.keys(prev).forEach(t=>{ DB[t]=prev[t]; });
      S.simResults=prevSim; S.elCounter=prevCounter;
      Object.keys(S.simCfg).forEach(k=>delete S.simCfg[k]); Object.assign(S.simCfg,prevCfg);
      try{ _demandCacheInvalidate(); syncElCounter(); }catch(e2){}
      try{ if(DB.facilities.length) selectFacility(DB.facilities[0].id); updateStatusBar(); renderLocationTree(); updateNavFacilities(); }catch(e3){}
      statMsg('Import failed — '+(err&&err.message||err)+'; the previous data was restored');
      console.error(err);
    }
    input.value=''; // reset so same file can be re-imported
  };
  reader.readAsText(file);
}



