// ═══════════════════════════════════════════════════════
// PROPERTIES PANEL
// ═══════════════════════════════════════════════════════
function renderProps(id){
  const el=getEl(id); if(!el) return;
  const t=ET[el.type];
  document.getElementById('props-type-lbl').textContent=t.label;

  let h=`<div class="pg"><div class="pg-title">Identity</div>
    <div class="pf"><div class="pl">Name</div><input class="pi" id="pp-name" value="${esc(el.name)}"></div>
    <div class="pf"><div class="pl">Assigned Facility</div>
      <select class="pi" id="pp-assigned-fac">
        <option value="">Same as canvas (${getFacility()?.name||S.facility_id})</option>
        ${DB.facilities.map(f=>`<option value="${f.id}" ${el.assigned_facility_id===f.id?'selected':''}>${f.name}</option>`).join('')}
      </select>
      <div class="fhint">Use this to assign terminal elements to their logical facility for filtering results</div>
    </div>
    <div class="pf"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="pp-is-active" ${el.is_active!==false?'checked':''} style="width:16px;height:16px;accent-color:var(--green);cursor:pointer"><span style="font-family:var(--mono);font-size:10px">Active (show in tables)</span></label><div class="fhint">Inactive elements are hidden from demand & supply tables but kept for historical reference</div></div>
  </div><div class="pg"><div class="pg-title">Characteristics</div>`;

  t.fields.forEach(f=>{
    // Conditional visibility: skip if show_if condition not met
    if(f.show_if){
      const condVal=el.props[f.show_if.k]||'';
      if(condVal!==f.show_if.v){ return; }
    }
    const v=el.props[f.k]??'';
    h+=`<div class="pf"><div class="pl">${f.l}</div>`;
    if(f.t==='number') h+=`<input class="pi" type="number" id="pp-${f.k}" value="${v}" placeholder="0">`;
    else if(f.t==='select'){
      h+=`<select class="pi" id="pp-${f.k}"`;
      // Re-render props panel when berth_type changes so conditional fields update
      if(f.k==='berth_type') h+=` onchange="saveProps('${id}');renderProps('${id}')"`;
      h+=`>`;
      f.opts.forEach(o=>h+=`<option ${v===o?'selected':''}>${o}</option>`);
      h+=`</select>`;
    }
    else if(f.t==='catalog'){
      let cat=[];
      if(f.cat==='products') cat=DB.products;
      else if(f.cat==='raw_materials') cat=DB.raw_materials;
      else if(f.cat==='fuels') cat=DB.fuels;
      const onChg=f.k==='product_id'?` onchange="onBulkSiloProductChange('${id}',this.value)"`:'';
      h+=`<select class="pi" id="pp-${f.k}"${onChg}><option value="">-- Select --</option>`;
      cat.forEach(item=>h+=`<option value="${item.id}" ${v===item.id?'selected':''}>${item.name}</option>`);
      h+=`</select>`;
    } else if(f.t==='silo_product'){
      // Handled by the dedicated multi-product panel below — skip inline rendering
      h+=`</div>`; return;
    } else if(f.t==='truck_dest'){
      // Only show for truck dispatch points
      if((el.props.dispatch_type||'Truck')!=='Truck'){ h+=`<span style="display:none"></span>`; h+=`</div>`; return; }
      const curDest=el.props.truck_destination||'local';
      h+=`<div style="display:flex;gap:4px;margin-top:2px">
        <div onclick="document.querySelectorAll('.tdest-opt').forEach(x=>x.classList.remove('active'));this.classList.add('active');document.getElementById('pp-truck_destination').value='local';document.getElementById('tdest-ext-wrap').style.display='none'"
          class="tdest-opt${curDest==='local'?' active':''}"
          style="padding:4px 12px;font-family:var(--mono);font-size:9px;cursor:pointer;border:1px solid ${curDest==='local'?'var(--green)':'var(--border2)'};color:${curDest==='local'?'var(--green)':'var(--text-dim)'};background:var(--surface2);transition:all .15s">
          Local (same facility)
        </div>
        <div onclick="document.querySelectorAll('.tdest-opt').forEach(x=>x.classList.remove('active'));this.classList.add('active');document.getElementById('pp-truck_destination').value='external';document.getElementById('tdest-ext-wrap').style.display='block'"
          class="tdest-opt${curDest==='external'?' active':''}"
          style="padding:4px 12px;font-family:var(--mono);font-size:9px;cursor:pointer;border:1px solid ${curDest==='external'?'var(--blue)':'var(--border2)'};color:${curDest==='external'?'var(--blue)':'var(--text-dim)'};background:var(--surface2);transition:all .15s">
          External Facility
        </div>
      </div>
      <input type="hidden" id="pp-truck_destination" value="${curDest}">
      <div id="tdest-ext-wrap" style="display:${curDest==='external'?'block':'none'};margin-top:6px">
        <div class="pl" style="margin-bottom:2px">Destination Facility</div>
        <select class="pi" id="pp-truck-dest-fac">
          <option value="">-- Select facility --</option>
          ${DB.facilities.filter(fac=>fac.id!==S.facility_id).map(fac=>
            `<option value="${fac.id}" ${el.props.truck_dest_facility_id===fac.id?'selected':''}>${esc(fac.name)}</option>`
          ).join('')}
        </select>
        <div class="fhint">Cement is delivered same-day to this facility</div>
      </div>`;
    } else if(f.t==='facility_select'){
      // Only show for rail dispatch points
      if((el.props.dispatch_type||'Truck')==='Truck'){ h+=`<span style="display:none"></span>`; h+=`</div>`; return; }
      h+=`<select class="pi" id="pp-${f.k}"><option value="">-- Select facility --</option>`;
      DB.facilities.filter(fac=>fac.id!==S.facility_id).forEach(fac=>
        h+=`<option value="${fac.id}" ${v===fac.id?'selected':''}>${esc(fac.name)}</option>`);
      h+=`</select>`;
    } else h+=`<input class="pi" id="pp-${f.k}" value="${v}">`;
    h+=`</div>`;
  });
  h+=`</div>`;

  // ── BULK SILO — multi-product panel ───────────────────
  if(el.type==='bulk_silo'){
    const siloProds=getSiloProducts(el);
    const reachable=getReachableProductsForSilo(id);

    h+=`<div class="pg"><div class="pg-title">Accepted Products</div>
      <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-bottom:6px">
        All products in this list share the silo capacity as a single blended inventory. Once material enters it is not tracked by product.
      </div>`;

    if(!siloProds.length){
      h+=`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding:4px 0">No products assigned yet</div>`;
    }

    siloProds.forEach((pid,i)=>{
      const prod=DB.products.find(p=>p.id===pid);
      const cat=prod?.category||'';
      const color=PRODUCT_CAT_COLORS[cat]||'var(--text-dim)';
      h+=`<div class="maint-item">
        <div class="maint-item-info">
          <div class="maint-item-name" style="color:${color}">${prod?.name||pid}</div>
          <div class="maint-item-detail">${cat.replace('_',' ')||'no category'}</div>
        </div>
        <span class="maint-item-del" onclick="removeSiloProduct('${id}',${i})">✕</span>
      </div>`;
    });

    // Add product dropdown — filtered to reachable products not already assigned
    const available=reachable.filter(p=>!siloProds.includes(p.id));
    if(available.length){
      h+=`<div class="pf" style="margin-top:4px">
        <div class="pl">Add Product (reachable via topology)</div>
        <select class="pi" id="silo-new-prod-${id}">
          <option value="">-- Select --</option>
          ${available.map(p=>`<option value="${p.id}">${p.name} [${(p.category||'').replace('_',' ')}]</option>`).join('')}
        </select>
      </div>
      <button class="add-btn" style="border-color:var(--green);color:var(--green)" onclick="addSiloProduct('${id}')">+ Add Product</button>`;
    } else if(reachable.length&&!available.length){
      h+=`<div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:4px">All reachable products already added</div>`;
    } else {
      h+=`<div style="font-family:var(--mono);font-size:8px;color:var(--amber);margin-top:4px">
        ◆ No upstream production elements connected — connect this silo to a kiln, finish mill, or raw meal mill to filter available products
      </div>`;
      // Fallback — show full product list
      h+=`<div class="pf" style="margin-top:4px">
        <div class="pl">Add Any Product</div>
        <select class="pi" id="silo-new-prod-${id}">
          <option value="">-- Select --</option>
          ${DB.products.filter(p=>!siloProds.includes(p.id)).map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
      </div>
      <button class="add-btn" onclick="addSiloProduct('${id}')">+ Add Product</button>`;
    }
    h+=`</div>`;
  }

  // ── RAIL RECEIVING BERTH — terminal switch days ─────────
  // Mirrors the Dispatch/Rail switch-day picker. On a switch day the terminal asks the
  // railroad to pull the cars available at the RAIL YARD; they are placed at the LOCAL
  // YARD the next day and unload from that morning's count.
  if(el.type==='berth'&&(el.props.berth_type||'')==='Rail Receiving'){
    const DAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const swDays=el.props.switch_days||[];
    h+=`<div class="pg"><div class="pg-title">Terminal Rail Switch</div>
      <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-bottom:8px">
        On a switch day the terminal pulls the railcars available at the rail yard; they are
        placed at the local yard <b>the day after</b> and unload from that morning. With no
        switch days selected, cars are spotted daily (no switch constraint).
      </div>
      <div class="pf"><div class="pl">Switch Days — when cars are pulled from the rail yard</div>
        <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
          ${DAYS.map((d,i)=>`
            <label style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer">
              <input type="checkbox" id="bu-sw-${i}" ${swDays.includes(i)?'checked':''}
                style="width:14px;height:14px;accent-color:var(--green);cursor:pointer">
              <span style="font-family:var(--mono);font-size:8px;color:var(--text-dim)">${d}</span>
            </label>`).join('')}
        </div>
        <div class="fhint">Days the switch locomotive serves this terminal</div>
      </div>
    </div>`;
  }

  // ── DISPATCH POINT — truck/rail configuration ──────────
  if(el.type==='dispatch_point'){
    const dtype=el.props.dispatch_type||'Truck';
    if(dtype==='Truck'){
      const tdest=el.props.truck_destination||'local';
      h+=`<div class="pg"><div class="pg-title">Truck Dispatch</div>
        <div style="font-family:var(--mono);font-size:9px;padding:6px;background:${tdest==='local'?'rgba(var(--green-rgb),.05)':'rgba(var(--blue-rgb),.06)'};border:1px solid ${tdest==='local'?'rgba(var(--green-rgb),.15)':'rgba(var(--blue-rgb),.2)'}">
          ${tdest==='local'
            ? '◆ Local: Cement passes through same-day to demand points connected downstream in this facility. No transit, no destination configuration needed.'
            : '◆ External: Cement is delivered same-day to the selected destination facility.'}
        </div>
      </div>`;
    } else {
      const dp=el.props;
      const DAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      const switchDays=dp.switch_days||[];
      const workingDays=dp.working_days||'weekdays';
      if(!dp.destinations) dp.destinations=[];

      const upSiloEls2=(DB.connections.filter(c=>c.to_element_id===id))
        .map(c=>getEl(c.from_element_id)).filter(e=>e&&e.type==='bulk_silo');
      const reachableProds2=[];
      upSiloEls2.forEach(s=>getSiloProducts(s).forEach(pid=>{
        if(!reachableProds2.find(p=>p.id===pid)){
          const prod=DB.products.find(p=>p.id===pid);
          if(prod) reachableProds2.push(prod);
        }
      }));
      const availProds2=reachableProds2.length?reachableProds2:DB.products;
      const otherFacs2=DB.facilities.filter(f=>f.id!==S.facility_id);

      h+=`<div class="pg"><div class="pg-title">Rail Configuration</div>
        <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-bottom:8px">
          Cement loads into rail cars each shift (on working days). Loaded cars accumulate until a switch day — then cars are allocated to destinations by urgency.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:6px">
          <div class="pf"><div class="pl">Car Capacity (t/car)</div>
            <input class="pi" type="number" id="dp-car-cap" value="${dp.car_capacity_t||50}"></div>
          <div class="pf"><div class="pl">Loading (cars/shift)</div>
            <input class="pi" type="number" id="dp-std-rate" value="${dp.std_loading_cars_shift||dp.std_loading_cars_day||10}">
            <div class="fhint">Cars loaded per shift</div></div>
          <div class="pf"><div class="pl">Shifts per Day</div>
            <input class="pi" type="number" id="dp-shifts" value="${dp.shifts_per_day||1}">
            <div class="fhint">Loading shifts (1 or 2)</div></div>
        </div>
        <div class="pf"><div class="pl">Working Days</div>
          <div style="display:flex;gap:4px;margin-top:4px">
            ${['weekdays','mon_sat','7_days'].map(opt=>`
              <div onclick="document.querySelectorAll('.wd-opt').forEach(x=>x.classList.remove('active'));this.classList.add('active');document.getElementById('dp-working-days').value='${opt}'"
                class="wd-opt${workingDays===opt?' active':''}"
                style="padding:4px 10px;font-family:var(--mono);font-size:9px;cursor:pointer;border:1px solid ${workingDays===opt?'var(--green)':'var(--border2)'};color:${workingDays===opt?'var(--green)':'var(--text-dim)'};background:var(--surface2);transition:all .15s">
                ${opt==='weekdays'?'Mon\u2013Fri':opt==='mon_sat'?'Mon\u2013Sat':'7 Days'}
              </div>`).join('')}
            <input type="hidden" id="dp-working-days" value="${workingDays}">
          </div>
        </div>
        <div class="pf" style="margin-top:8px"><div class="pl">Switch Days \u2014 when loaded cars are dispatched</div>
          <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
            ${DAYS.map((d,i)=>`
              <label style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer">
                <input type="checkbox" id="dp-sw-${i}" ${switchDays.includes(i)?'checked':''}
                  style="width:14px;height:14px;accent-color:var(--green);cursor:pointer">
                <span style="font-family:var(--mono);font-size:8px;color:var(--text-dim)">${d}</span>
              </label>`).join('')}
          </div>
          <div class="fhint">Days when the switch locomotive collects all loaded cars</div>
        </div>
      </div>
      <div class="pg"><div class="pg-title">Destinations</div>
        <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-bottom:8px">
          On each switch day, accumulated cars are allocated to destinations by inventory urgency.
        </div>
        <div id="dp-dest-list">
        ${dp.destinations.map((dest,di)=>{
          const facName=DB.facilities.find(f=>f.id===dest.facility_id)?.name||dest.facility_id||'\u2014';
          return `<div style="border:1px solid var(--border2);padding:8px;margin-bottom:6px;background:var(--surface2)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <div style="font-family:var(--mono);font-size:9px;color:var(--green)">Destination ${di+1}: ${facName}</div>
              <span style="font-family:var(--mono);font-size:9px;color:var(--red2);cursor:pointer" onclick="removeRailDest('${id}',${di})">\u2715 Remove</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
              <div class="pf"><div class="pl">Facility</div>
                <select class="pi" id="dp-dest-fac-${di}">
                  <option value="">-- Select --</option>
                  ${otherFacs2.map(f=>`<option value="${f.id}" ${dest.facility_id===f.id?'selected':''}>${f.name}</option>`).join('')}
                </select>
              </div>
              <div class="pf"><div class="pl">Transit Days</div>
                <input class="pi" type="number" id="dp-dest-transit-${di}" value="${dest.transit_days||1}" min="1">
              </div>
            </div>
            <div class="pf" style="margin-bottom:6px"><div class="pl">Accepted Products</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
                ${availProds2.map(p=>`
                  <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-family:var(--mono);font-size:8px;color:var(--text)">
                    <input type="checkbox" id="dp-dest-prod-${di}-${p.id}"
                      ${(dest.accepted_products||[]).includes(p.id)?'checked':''}
                      style="accent-color:var(--green)">
                    ${p.name}
                  </label>`).join('')}
              </div>
            </div>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-family:var(--mono);font-size:8px;color:var(--text)">
              <input type="checkbox" id="dp-dest-purity-${di}" ${dest.purity_required?'checked':''}
                style="accent-color:var(--green)">
              Require product purity (no blended cars)
            </label>
          </div>`;
        }).join('')}
        </div>
        ${otherFacs2.length
          ?`<button class="add-btn" style="border-color:var(--green);color:var(--green);margin-top:4px" onclick="addRailDest('${id}')">+ Add Destination</button>`
          :`<div style="font-family:var(--mono);font-size:8px;color:var(--amber)">\u25c6 No other facilities defined</div>`}
      </div>`;
    }
  }

  // ── KILN product capacities (clinker products) ─────────
  if(el.type==='kiln'){
    const caps=DB.element_product_capacities.filter(c=>c.element_id===id);
    const clinkerProds=DB.products.filter(p=>p.category==='clinker');
    h+=`<div class="pg"><div class="pg-title">Clinker Product Capacities — element_product_capacities</div>
      <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-bottom:8px">Define one row per clinker product this kiln can produce. Each product carries its own production rate, heat consumption and raw meal ratio.</div>`;
    caps.forEach(pc=>{
      const pname=DB.products.find(p=>p.id===pc.product_id)?.name||pc.product_id;
      h+=`<div class="prod-cap-row">
        <div class="prod-cap-row-hdr"><span class="prod-cap-name" style="color:var(--amber)">${pname}</span>
          <span class="prod-cap-del" onclick="removeProductCap('${id}','${pc.id}')">✕</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px">
          <div class="pf"><div class="pl">t clinker/day</div>
            <input class="pi" type="number" id="ppc-cap-${pc.id}" value="${pc.capacity_tpd||0}"></div>
          <div class="pf"><div class="pl">kCal/kg</div>
            <input class="pi" type="number" id="ppc-heat-${pc.id}" value="${pc.specific_heat_kcal_kg||800}"></div>
          <div class="pf"><div class="pl">Raw Meal Ratio</div>
            <input class="pi" type="number" id="ppc-rmr-${pc.id}" value="${pc.raw_meal_ratio||1.55}" step="0.01"></div>
        </div>
      </div>`;
    });
    if(clinkerProds.length){
      h+=`<div class="pf"><div class="pl">Add Clinker Product</div>
        <select class="pi" id="pp-new-prod"><option value="">-- Select clinker product --</option>`;
      clinkerProds.filter(p=>!caps.find(c=>c.product_id===p.id)).forEach(p=>
        h+=`<option value="${p.id}">${p.name}</option>`);
      h+=`</select></div>
      <button class="add-btn" style="border-color:var(--amber);color:var(--amber)" onclick="addProductCap('${id}')">+ Add Clinker Product</button>`;
    } else {
      h+=`<div style="font-family:var(--mono);font-size:8px;color:var(--amber);padding:6px 0">
        ◆ No clinker products defined. Go to Catalogs → Products and add products with category = Clinker first.
      </div>`;
    }
    h+=`</div>`;
  }

  // ── FINISH MILL product capacities ──────────────────────
  if(el.type==='finish_mill'){
    const caps=DB.element_product_capacities.filter(c=>c.element_id===id);
    const cementProds=DB.products.filter(p=>p.category==='cement_bulk'||p.category==='cement_packed');
    h+=`<div class="pg"><div class="pg-title">Product Capacities — element_product_capacities</div>`;
    caps.forEach((pc,i)=>{
      const pname=DB.products.find(p=>p.id===pc.product_id)?.name||pc.product_id;
      h+=`<div class="prod-cap-row">
        <div class="prod-cap-row-hdr"><span class="prod-cap-name">${pname}</span>
          <span class="prod-cap-del" onclick="removeProductCap('${id}','${pc.id}')">✕</span></div>
        <div class="prod-cap-fields">
          <div class="pf"><div class="pl">t/day</div><input class="pi" type="number" id="ppc-cap-${pc.id}" value="${pc.capacity_tpd||0}"></div>
          <div class="pf"><div class="pl">kWh/t</div><input class="pi" type="number" id="ppc-pwr-${pc.id}" value="${pc.power_kwh_t||0}"></div>
        </div>
      </div>`;
    });
    h+=`<div class="pf"><div class="pl">Add Product</div><select class="pi" id="pp-new-prod"><option value="">-- Select --</option>`;
    (cementProds.length?cementProds:DB.products).filter(p=>!caps.find(c=>c.product_id===p.id))
      .forEach(p=>h+=`<option value="${p.id}">${p.name}</option>`);
    h+=`</select></div><button class="add-btn" style="border-color:var(--green);color:var(--green)" onclick="addProductCap('${id}')">+ Add Product Capacity</button></div>`;
  }

  // ── PACKING PLANT lines — multi-product, like a Finish Mill ──────────────
  // Each line: input bulk product → output packed product, machine rate (pallets/day),
  // tonnes/pallet, and recipe (bulk tonnes per output tonne). Stored in
  // element_product_capacities (product_id = output; packing_* fields hold the rest).
  if(el.type==='packing_plant'){
    const lines=DB.element_product_capacities.filter(c=>c.element_id===id);
    const bulkProds=DB.products.filter(p=>p.category==='cement_bulk');
    const packProds=DB.products.filter(p=>p.category==='cement_packed');
    h+=`<div class="pg"><div class="pg-title">Packing Lines — element_product_capacities</div>`;
    lines.forEach(pc=>{
      const oname=DB.products.find(p=>p.id===pc.product_id)?.name||pc.product_id;
      h+=`<div class="prod-cap-row">
        <div class="prod-cap-row-hdr"><span class="prod-cap-name">${oname}</span>
          <span class="prod-cap-del" onclick="removeProductCap('${id}','${pc.id}')">✕</span></div>
        <div class="prod-cap-fields" style="flex-wrap:wrap">
          <div class="pf" style="min-width:130px"><div class="pl">Input bulk product</div>
            <select class="pi" id="ppk-in-${pc.id}">
              ${(bulkProds.length?bulkProds:DB.products).map(p=>`<option value="${p.id}" ${pc.packing_input_id===p.id?'selected':''}>${p.name}</option>`).join('')}
            </select></div>
          <div class="pf"><div class="pl">Pallets/day</div><input class="pi" type="number" id="ppk-pal-${pc.id}" value="${pc.pallets_per_day||0}"></div>
          <div class="pf"><div class="pl">Tonnes/pallet</div><input class="pi" type="number" id="ppk-tpp-${pc.id}" value="${pc.tonnes_per_pallet||0}"></div>
          <div class="pf"><div class="pl">Bulk t per output t</div><input class="pi" type="number" step="0.01" id="ppk-ratio-${pc.id}" value="${pc.bulk_per_output_t||1}"></div>
        </div>
        <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);padding:2px 0">Max output ≈ ${( (parseFloat(pc.pallets_per_day)||0)*(parseFloat(pc.tonnes_per_pallet)||0) ).toLocaleString()} t/day · consumes ${( (parseFloat(pc.pallets_per_day)||0)*(parseFloat(pc.tonnes_per_pallet)||0)*(parseFloat(pc.bulk_per_output_t)||1) ).toLocaleString()} t bulk/day</div>
      </div>`;
    });
    if(packProds.length){
      h+=`<div class="pf"><div class="pl">Add Output (packed) Product</div><select class="pi" id="ppk-new-prod"><option value="">-- Select --</option>`;
      packProds.filter(p=>!lines.find(c=>c.product_id===p.id)).forEach(p=>h+=`<option value="${p.id}">${p.name}</option>`);
      h+=`</select></div><button class="add-btn" style="border-color:var(--green);color:var(--green)" onclick="addPackingLine('${id}')">+ Add Packing Line</button>`;
    } else {
      h+=`<div style="font-family:var(--mono);font-size:8px;color:var(--amber);padding:6px 0">◆ No packed products defined. Go to Products and add a product with category = Packed Cement first.</div>`;
    }
    h+=`</div>`;
  }

  // ── DEMAND POINT — multi-product panel ────────────────
  if(el.type==='demand_point'){
    // Find existing record — search by element_id first, then by stable id
    let dp=DB.demand_points.find(d=>d.element_id===id);
    if(!dp){
      // Also check stable id format in case it was created that way
      dp=DB.demand_points.find(d=>d.id===`dp_el_${id}`);
    }
    if(!dp){
      // Create new stable record — only if truly none exists
      dp={id:`dp_el_${id}`, facility_id:S.facility_id, element_id:id,
          element_name:el.name, products:[], mode:'Fixed Daily',
          daily_tonnage:0, objective:'Meet Demand Only', rolling_days:30};
      DB.demand_points.push(dp);
      try{ localStorage.setItem('prodcast_v3',JSON.stringify({DB,counter:S.elCounter,simCfg:S.simCfg})); }catch(e){}
    }
    // Always ensure element_id is set (fix legacy records that may lack it)
    if(!dp.element_id) dp.element_id=id;
    // Always sync element_name
    dp.element_name=el.name;

    // Trace backwards to find reachable products
    const {products:reachable, unassigned}=getReachableProducts(id);

    h+=`<div class="pg"><div class="pg-title">Acceptable Products — demand_points</div>`;

    if(unassigned.length){
      h+=`<div style="font-family:var(--mono);font-size:8px;color:var(--amber);padding:5px 0;margin-bottom:4px">
        ◆ ${unassigned.length} upstream silo${unassigned.length>1?'s have':' has'} no product assigned: ${unassigned.join(', ')}
      </div>`;
    }

    if(!reachable.length&&!unassigned.length){
      h+=`<div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);padding:5px 0">
        No upstream bulk silos found. Connect this demand point downstream from a dispatch point that is connected to bulk silos holding cement products.
      </div>`;
    }

    // Current product list
    const dpProds=dp.products||[];
    if(dpProds.length){
      h+=`<div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-bottom:6px;letter-spacing:1px;text-transform:uppercase">
        Accepted (${dpProds.length}) — simulation fulfills demand from these in priority order
      </div>`;
      dpProds.forEach((p,i)=>{
        const prod=DB.products.find(x=>x.id===p.product_id);
        const silo=reachable.find(r=>r.product_id===p.product_id);
        h+=`<div class="maint-item">
          <div class="maint-item-info">
            <div class="maint-item-name" style="color:var(--green)">${prod?.name||p.product_id}</div>
            <div class="maint-item-detail">Priority ${i+1}${silo?' · via '+silo.silo_name:' · ⚠ not reachable from current topology'}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
            ${i>0?`<span style="font-family:var(--mono);font-size:8px;color:var(--text-dim);cursor:pointer" onclick="moveDpProduct('${id}','${dp.id}',${i},-1)">↑</span>`:''}
            ${i<dpProds.length-1?`<span style="font-family:var(--mono);font-size:8px;color:var(--text-dim);cursor:pointer" onclick="moveDpProduct('${id}','${dp.id}',${i},1)">↓</span>`:''}
            <span class="maint-item-del" onclick="removeDpProduct('${id}','${dp.id}',${i})">✕</span>
          </div>
        </div>`;
      });
    } else {
      h+=`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding:5px 0">No products added yet</div>`;
    }

    // Add product selector — only reachable products not already in list
    const available=reachable.filter(r=>!dpProds.find(p=>p.product_id===r.product_id));
    if(available.length){
      h+=`<div class="pf" style="margin-top:6px"><div class="pl">Add Product (reachable via topology)</div>
        <select class="pi" id="dp-new-prod-${id}">
          <option value="">-- Select --</option>
          ${available.map(r=>`<option value="${r.product_id}">${r.product_name} (via ${r.silo_name})</option>`).join('')}
        </select>
      </div>
      <button class="add-btn" style="border-color:var(--green);color:var(--green)" onclick="addDpProduct('${id}','${dp.id}')">+ Add Product</button>`;
    } else if(reachable.length&&!available.length){
      h+=`<div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);padding:4px 0">All reachable products have been added</div>`;
    }
    h+=`</div>`;
  }

  // Maintenance events
  const maintEvs=DB.element_maintenance_events.filter(m=>m.element_id===id);
  h+=`<div class="pg"><div class="pg-title">Maintenance — element_maintenance_events</div>
    <div id="maint-list-${id}">`;
  if(!maintEvs.length) h+=`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding:5px 0">No events assigned</div>`;
  maintEvs.forEach(me=>{
    const recur=me.type==='recurring'?`every ${me.frequency_days||'?'}d`:'one-off';
    const endInfo=me.end_date?` → ${me.end_date}`:'';
    h+=`<div class="maint-item">
      <div class="maint-item-info">
        <div class="maint-item-name">${me.name}</div>
        <div class="maint-item-detail">${me.start_date}${endInfo} · ${me.duration_days||me.duration||'?'}d · ${recur}${me.rampup_days?' · ramp '+me.rampup_days+'d':''}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
        <span style="font-family:var(--mono);font-size:8px;color:var(--blue);cursor:pointer" onclick="editMaintEvent('${me.id}')">Edit</span>
        <span class="maint-item-del" onclick="removeMaintEvent('${me.id}','${id}')">✕</span>
      </div>
    </div>`;
  });
  h+=`</div><button class="add-btn" onclick="openMaintModal('${id}')">+ Add Maintenance Event</button></div>`;

  // ── SUPPLY SOURCE — berth allocation panel ─────────────────
  if(el.type==='supply_source'){
    const connectedBerths=DB.connections
      .filter(c=>c.facility_id===mainCanvasFacilityId()&&c.from_element_id===id)
      .map(c=>DB.elements.find(e=>e.id===c.to_element_id))
      .filter(e=>e&&e.type==='berth');
    if(connectedBerths.length>1){
      const allocs=el.props.berth_allocations||{};
      const totalVol=parseFloat(el.props.typical_volume_t)||0;
      h+=`<div class="pg"><div class="pg-title">Berth Allocation — Split Cargo</div>
        <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-bottom:8px">
          This supply source connects to ${connectedBerths.length} berths. Specify how many tonnes go to each port per vessel call. Leave blank to use separate full vessels per berth.
        </div>`;
      let allocSum=0;
      connectedBerths.forEach(b=>{
        const qty=allocs[b.id]||0;
        allocSum+=qty;
        h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div style="font-family:var(--mono);font-size:9px;color:var(--amber);flex:1">${b.name}</div>
          <input class="pi" type="number" id="ss-alloc-${b.id}" value="${qty||''}" placeholder="tonnes"
            style="width:100px" oninput="_ssUpdateAllocTotal('${id}')">
          <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);min-width:40px" id="ss-alloc-pct-${b.id}">
            ${totalVol&&qty?Math.round(qty/totalVol*100)+'%':''}
          </div>
        </div>`;
      });
      h+=`<div style="font-family:var(--mono);font-size:8px;margin-top:4px" id="ss-alloc-total">
        ${totalVol?`Total allocated: <span style="color:${Math.abs(allocSum-totalVol)<1?'var(--green)':'var(--amber)'}">${allocSum.toLocaleString()}t / ${totalVol.toLocaleString()}t</span>`:''}
      </div></div>`;
    }
  }

  h+=`<button class="p-save-btn" onclick="saveProps('${id}')">Save Properties</button>`;

  document.getElementById('props-body').innerHTML=h;
}

function saveProps(id){
  const el=getEl(id); if(!el) return;
  const t=ET[el.type]; if(!t) return;
  const ni=document.getElementById('pp-name'); if(ni) el.name=ni.value;
  // Save assigned facility
  const af=document.getElementById('pp-assigned-fac');
  el.assigned_facility_id=af?.value||null;
  // Save active status
  const isActive=document.getElementById('pp-is-active');
  el.is_active=isActive?.checked??true;
  t.fields.forEach(f=>{
    const inp=document.getElementById(`pp-${f.k}`);
    if(inp) el.props[f.k]=f.t==='number'?parseFloat(inp.value)||0:inp.value;
  });
  // Save product cap edits — finish_mill (cap+pwr), kiln (cap+heat+rmr), packing (line fields)
  DB.element_product_capacities.filter(c=>c.element_id===id).forEach(pc=>{
    const cap=document.getElementById(`ppc-cap-${pc.id}`);
    const pwr=document.getElementById(`ppc-pwr-${pc.id}`);
    const heat=document.getElementById(`ppc-heat-${pc.id}`);
    const rmr=document.getElementById(`ppc-rmr-${pc.id}`);
    if(cap) pc.capacity_tpd=parseFloat(cap.value)||0;
    if(pwr) pc.power_kwh_t=parseFloat(pwr.value)||0;
    if(heat) pc.specific_heat_kcal_kg=parseFloat(heat.value)||800;
    if(rmr) pc.raw_meal_ratio=parseFloat(rmr.value)||1.55;
    // Packing line fields
    const pin=document.getElementById(`ppk-in-${pc.id}`);
    const ppal=document.getElementById(`ppk-pal-${pc.id}`);
    const ptpp=document.getElementById(`ppk-tpp-${pc.id}`);
    const pratio=document.getElementById(`ppk-ratio-${pc.id}`);
    if(pin){
      pc.packing_input_id=pin.value;
      pc.pallets_per_day=parseFloat(ppal?.value)||0;
      pc.tonnes_per_pallet=parseFloat(ptpp?.value)||0;
      pc.bulk_per_output_t=parseFloat(pratio?.value)||1;
      pc.capacity_tpd=pc.pallets_per_day*pc.tonnes_per_pallet; // output tonnes/day (kept in sync)
    }
  });
  // Save Rail-Receiving berth terminal switch days (checkboxes only exist when the
  // panel was rendered for that berth type — guard so a type change doesn't wipe them).
  if(el.type==='berth'&&(el.props.berth_type||'')==='Rail Receiving'&&document.getElementById('bu-sw-0')!==null){
    el.props.switch_days=[];
    for(let i=0;i<7;i++){
      if(document.getElementById(`bu-sw-${i}`)?.checked) el.props.switch_days.push(i);
    }
  }
  // Save dispatch_point configuration
  if(el.type==='dispatch_point'){
    if(el.props.dispatch_type==='Rail'){
      el.props.car_capacity_t=parseFloat(document.getElementById('dp-car-cap')?.value)||50;
      el.props.std_loading_cars_shift=parseFloat(document.getElementById('dp-std-rate')?.value)||10;
      el.props.shifts_per_day=parseFloat(document.getElementById('dp-shifts')?.value)||1;
      el.props.working_days=document.getElementById('dp-working-days')?.value||'weekdays';
      el.props.switch_days=[];
      for(let i=0;i<7;i++){
        if(document.getElementById(`dp-sw-${i}`)?.checked) el.props.switch_days.push(i);
      }
      if(!el.props.destinations) el.props.destinations=[];
      el.props.destinations.forEach((dest,di)=>{
        const facSel=document.getElementById(`dp-dest-fac-${di}`);
        const transitInp=document.getElementById(`dp-dest-transit-${di}`);
        const purityChk=document.getElementById(`dp-dest-purity-${di}`);
        if(facSel) dest.facility_id=facSel.value;
        if(transitInp) dest.transit_days=parseInt(transitInp.value)||1;
        if(purityChk) dest.purity_required=purityChk.checked;
        dest.accepted_products=[];
        DB.products.forEach(p=>{
          const chk=document.getElementById(`dp-dest-prod-${di}-${p.id}`);
          if(chk?.checked) dest.accepted_products.push(p.id);
        });
      });
    } else {
      // Truck
      el.props.truck_destination=document.getElementById('pp-truck_destination')?.value||'local';
      if(el.props.truck_destination==='external'){
        el.props.truck_dest_facility_id=document.getElementById('pp-truck-dest-fac')?.value||'';
      } else {
        el.props.truck_dest_facility_id=''; // clear when local
      }
    }
  }
  // Update canvas element
  const g=document.getElementById(`eg-${id}`);
  if(g){
    const txt=g.querySelector('text');
    if(txt) txt.textContent=el.name.length>18?el.name.slice(0,18)+'…':el.name;
    // Update bulk_silo color if product changed
    if(el.type==='bulk_silo'){
      const sh=g.querySelector('.el-shape');
      if(sh) sh.setAttribute('stroke',getBulkSiloColor(el));
    }
  }
  // Sync demand_point element: keep DB.demand_points record in sync with el.props
  if(el.type==='demand_point'){
    const dp=DB.demand_points.find(d=>d.element_id===id||d.id===`dp_el_${id}`);
    if(dp){
      dp.daily_tonnage=parseFloat(el.props.daily_tonnage)||0;
      dp.element_name=el.name;
      if(el.assigned_facility_id) dp.facility_id=el.assigned_facility_id;
    }
    renderDemandView();
  }
  // Save supply_source berth allocations
  if(el.type==='supply_source'){
    const connectedBerths=DB.connections
      .filter(c=>c.facility_id===mainCanvasFacilityId()&&c.from_element_id===id)
      .map(c=>DB.elements.find(e=>e.id===c.to_element_id))
      .filter(e=>e&&e.type==='berth');
    if(connectedBerths.length>1){
      const allocs={};
      connectedBerths.forEach(b=>{
        const v=parseFloat(document.getElementById(`ss-alloc-${b.id}`)?.value)||0;
        if(v>0) allocs[b.id]=v;
      });
      el.props.berth_allocations=Object.keys(allocs).length?allocs:null;
    } else if(el.props.berth_allocations) el.props.berth_allocations=null;   // one berth left: an old split no longer applies (the panel is hidden, so it could not be cleared)
  }
  autoSave(); statMsg('Properties saved');
}

function _ssUpdateAllocTotal(ssId){
  const el=getEl(ssId); if(!el) return;
  const totalVol=parseFloat(el.props.typical_volume_t)||0;
  const connectedBerths=DB.connections
    .filter(c=>c.facility_id===mainCanvasFacilityId()&&c.from_element_id===ssId)
    .map(c=>DB.elements.find(e=>e.id===c.to_element_id))
    .filter(e=>e&&e.type==='berth');
  let sum=0;
  connectedBerths.forEach(b=>{
    const v=parseFloat(document.getElementById(`ss-alloc-${b.id}`)?.value)||0;
    sum+=v;
    const pctEl=document.getElementById(`ss-alloc-pct-${b.id}`);
    if(pctEl) pctEl.textContent=totalVol&&v?Math.round(v/totalVol*100)+'%':'';
  });
  const totEl=document.getElementById('ss-alloc-total');
  if(totEl&&totalVol) totEl.innerHTML=`Total allocated: <span style="color:${Math.abs(sum-totalVol)<1?'var(--green)':'var(--amber)'}">${sum.toLocaleString()}t / ${totalVol.toLocaleString()}t</span>`;
}

// Get products reachable from upstream production elements for a bulk_silo
// Traces upstream: kiln -> clinker products, finish_mill -> cement products, raw_meal_mill -> raw_meal products
function addRailDest(elId){
  const el=getEl(elId); if(!el) return;
  if(!el.props.destinations) el.props.destinations=[];
  el.props.destinations.push({facility_id:'',transit_days:1,accepted_products:[],purity_required:false});
  autoSave(); renderProps(elId);
}

function removeRailDest(elId,idx){
  const el=getEl(elId); if(!el) return;
  el.props.destinations.splice(idx,1);
  autoSave(); renderProps(elId);
}

function getReachableProductsForSilo(elementId){
  const facConns=getFacConnections();
  const upMap={};
  facConns.forEach(c=>{
    if(!upMap[c.to_element_id]) upMap[c.to_element_id]=[];
    upMap[c.to_element_id].push(c.from_element_id);
  });

  const visited=new Set();
  const queue=[elementId];
  const results=[];

  while(queue.length){
    const id=queue.shift();
    if(visited.has(id)) continue;
    visited.add(id);
    const el=getEl(id); if(!el) continue;

    if(el.type==='kiln'){
      // Kiln produces clinker products defined in its product capacities
      const caps=DB.element_product_capacities.filter(c=>c.element_id===el.id);
      caps.forEach(pc=>{
        const p=DB.products.find(x=>x.id===pc.product_id);
        if(p&&!results.find(r=>r.id===p.id)) results.push(p);
      });
      // Also offer any clinker category products even if not yet assigned
      DB.products.filter(p=>p.category==='clinker'&&!results.find(r=>r.id===p.id))
        .forEach(p=>results.push(p));
      continue; // don't go further upstream from kiln
    }
    if(el.type==='finish_mill'){
      const caps=DB.element_product_capacities.filter(c=>c.element_id===el.id);
      caps.forEach(pc=>{
        const p=DB.products.find(x=>x.id===pc.product_id);
        if(p&&!results.find(r=>r.id===p.id)) results.push(p);
      });
      DB.products.filter(p=>(p.category==='cement_bulk'||p.category==='cement_packed')&&!results.find(r=>r.id===p.id))
        .forEach(p=>results.push(p));
      continue;
    }
    if(el.type==='raw_meal_mill'){
      DB.products.filter(p=>p.category==='raw_meal'&&!results.find(r=>r.id===p.id))
        .forEach(p=>results.push(p));
      continue;
    }
    if(el.type==='supply_source'){
      // External supply source: offer its declared product
      const p=DB.products.find(x=>x.id===el.props.product_id);
      if(p&&!results.find(r=>r.id===p.id)) results.push(p);
      continue; // no further upstream
    }
    if(el.type==='dispatch_point'){
      // Dispatch points send material OUT to other facilities — their upstream
      // are silos at the origin facility, not the source of what arrives here.
      // Stop traversal to avoid contaminating results with unrelated products.
      continue;
    }

    // Continue tracing upstream
    (upMap[id]||[]).forEach(upId=>{ if(!visited.has(upId)) queue.push(upId); });
  }

  return results;
}

// Called when bulk_silo product changes — update canvas color immediately
function onBulkSiloProductChange(elId, productId){
  const el=getEl(elId); if(!el) return;
  el.props.product_id=productId;
  const g=document.getElementById(`eg-${elId}`);
  if(g){
    const sh=g.querySelector('.el-shape');
    if(sh) sh.setAttribute('stroke',getBulkSiloColor(el));
  }
}

function addDpProduct(elId, dpId){
  // Look up by dpId first, then fall back to element_id
  const dp=DB.demand_points.find(d=>d.id===dpId)||DB.demand_points.find(d=>d.element_id===elId);
  if(!dp){ statMsg('Record not found — try clicking the element again'); return; }
  const sel=document.getElementById(`dp-new-prod-${elId}`);
  if(!sel||!sel.value) return;
  if(!dp.products) dp.products=[];
  if(dp.products.find(p=>p.product_id===sel.value)) return;
  dp.products.push({product_id:sel.value, priority:dp.products.length+1});
  autoSave(); renderProps(elId);
}

function removeDpProduct(elId, dpId, idx){
  const dp=DB.demand_points.find(d=>d.id===dpId||d.element_id===elId); if(!dp) return;
  dp.products.splice(idx,1);
  dp.products.forEach((p,i)=>p.priority=i+1);
  autoSave(); renderProps(elId);
}

function moveDpProduct(elId, dpId, idx, dir){
  const dp=DB.demand_points.find(d=>d.id===dpId||d.element_id===elId); if(!dp) return;
  const newIdx=idx+dir;
  if(newIdx<0||newIdx>=dp.products.length) return;
  const tmp=dp.products[idx];
  dp.products[idx]=dp.products[newIdx];
  dp.products[newIdx]=tmp;
  dp.products.forEach((p,i)=>p.priority=i+1);
  autoSave(); renderProps(elId);
}

function addSiloProduct(elId){
  const el=getEl(elId); if(!el) return;
  const sel=document.getElementById(`silo-new-prod-${elId}`);
  if(!sel||!sel.value) return;
  if(!el.props.products) el.props.products=getSiloProducts(el); // migrate legacy
  if(el.props.products.includes(sel.value)) return;
  el.props.products.push(sel.value);
  // Update canvas color from first product
  const g=document.getElementById(`eg-${elId}`);
  if(g){ const sh=g.querySelector('.el-shape'); if(sh) sh.setAttribute('stroke',getBulkSiloColor(el)); }
  autoSave(); renderProps(elId);
}

function removeSiloProduct(elId, idx){
  const el=getEl(elId); if(!el) return;
  if(!el.props.products) el.props.products=getSiloProducts(el);
  el.props.products.splice(idx,1);
  const g=document.getElementById(`eg-${elId}`);
  if(g){ const sh=g.querySelector('.el-shape'); if(sh) sh.setAttribute('stroke',getBulkSiloColor(el)); }
  autoSave(); renderProps(elId);
}

function addProductCap(elId){
  const sel=document.getElementById('pp-new-prod'); if(!sel||!sel.value) return;
  if(DB.element_product_capacities.find(c=>c.element_id===elId&&c.product_id===sel.value)) return;
  DB.element_product_capacities.push({id:`epc_${Date.now()}`,element_id:elId,product_id:sel.value,capacity_tpd:0,power_kwh_t:0});
  autoSave(); renderProps(elId);
}

// Add a packing line (output packed product) to a packing machine. Defaults the input bulk
// product to the same base name if one exists (e.g. output BRS_SPC(HS)/PAK → input .../BLK).
function addPackingLine(elId){
  const sel=document.getElementById('ppk-new-prod'); if(!sel||!sel.value) return;
  const outPid=sel.value;
  if(DB.element_product_capacities.find(c=>c.element_id===elId&&c.product_id===outPid)) return;
  const bulk=DB.products.filter(p=>p.category==='cement_bulk');
  const outName=(DB.products.find(p=>p.id===outPid)?.name||'').replace(/\/PAK$/i,'').replace(/\/BLK$/i,'');
  const guess=bulk.find(p=>(p.name||'').replace(/\/BLK$/i,'')===outName)||bulk[0];
  DB.element_product_capacities.push({
    id:`epc_${Date.now()}`, element_id:elId, product_id:outPid,
    packing_input_id:guess?.id||'', pallets_per_day:0, tonnes_per_pallet:0, bulk_per_output_t:1,
    capacity_tpd:0
  });
  autoSave(); renderProps(elId);
}

function removeProductCap(elId,capId){
  DB.element_product_capacities=DB.element_product_capacities.filter(c=>c.id!==capId);
  autoSave(); renderProps(elId);
}

function removeMaintEvent(evId,elId){
  DB.element_maintenance_events=DB.element_maintenance_events.filter(m=>m.id!==evId);
  autoSave(); renderProps(elId); renderMaintenanceCalendar(); updateStatusBar();
}

