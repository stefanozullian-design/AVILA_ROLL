// ═══════════════════════════════════════════════════════
// RESULTS RENDERING
// ═══════════════════════════════════════════════════════
// Called after every simulation run (the only caller; r === S.simResults). Draws only the
// result page that is ON SCREEN: the Data Table and the Dashboard are shown exclusively via
// switchView(), which redraws them from S.simResults every time they are opened, so drawing
// them while hidden only made every edit wait for pages nobody was looking at.
function renderResults(r){ _idxRun(()=>{
  if(S.view==='datatable'){ renderDtree(r); renderDashCharts(r); }
  else _demandCacheInvalidate(); // what renderDtree always did here (keeps the demand caches as fresh as before)
  renderEvLog(r); renderResultsTable(); updateFacFilterBar();
  if(S.view==='dashboard') renderDashboard();
}); }

// ═══════════════════════════════════════════════════════
// DAILY RESULTS TABLE
// ═══════════════════════════════════════════════════════
let resultsFilter='all';



function renderResultsTable(){
  const wrap=document.getElementById('results-table-wrap'); if(!wrap) return;
  const r=S.simResults;
  if(!r){
    wrap.innerHTML=`<div class="results-empty"><div style="font-size:24px;color:var(--border2)">◇</div>Run simulation to see daily results</div>`;
    return;
  }

  const todayStr=new Date()._ymd();
  const fac=getResultElements();
  const {startDay,endDay}=getViewRange();
  const horizon=endDay-startDay+1;
  const startDate=new Date(S.simCfg.start_date+'T00:00:00');
  startDate.setDate(startDate.getDate()+startDay-1); // adjust to view window start

  // Define column groups — use assigned facility membership as source of truth
  const demandCols=DB.demand_points.filter(d=>(d.assigned_facility_id||d.facility_id)===S.facility_id);
  const storageTypes=['bulk_silo','packed_silo','raw_material_storage','fuel_storage'];
  const transformTypes=['kiln','finish_mill','raw_meal_mill','packing_plant'];
  const invCols=fac.filter(e=>storageTypes.includes(e.type));
  const prodCols=fac.filter(e=>transformTypes.includes(e.type));
  const railDispCols=fac.filter(e=>e.type==='dispatch_point'&&e.props.dispatch_type==='Rail');

  const showDemand=resultsFilter==='all'||resultsFilter==='demand';
  const showInv=resultsFilter==='all'||resultsFilter==='inventory';
  const showProd=resultsFilter==='all'||resultsFilter==='production';

  // Maintenance lookup — returns event_id if element is in maintenance on dateStr, else null
  const _maintEvCache={};
  const getMaintEventId=(elId, dateStr)=>{
    if(!_maintEvCache[elId]){
      const m=new Map();
      DB.element_maintenance_events.filter(ev=>ev.element_id===elId).forEach(ev=>{
        const sd=new Date((ev.start_date||'')+'T00:00:00');
        const dur=Math.max(1,Math.ceil(parseFloat(ev.duration_days)||1));
        const freq=parseInt(ev.frequency_days)||0;
        const addOcc=(occStart)=>{
          for(let d=0;d<dur;d++){
            const dt=new Date(occStart.getTime()+d*864e5);
            m.set(dt._ymd(), ev.id);
          }
        };
        addOcc(sd);
        if(ev.type==='recurring'&&freq>0){
          const recEnd=ev.recurrence_end_date
            ?new Date(ev.recurrence_end_date+'T00:00:00')
            :new Date(new Date(S.simCfg.start_date+'T00:00:00').getTime()+(S.simCfg.horizon||365)*864e5);
          let next=new Date(sd.getTime()+freq*864e5);
          while(next<=recEnd){ addOcc(next); next=new Date(next.getTime()+freq*864e5); }
        }
      });
      _maintEvCache[elId]=m;
    }
    return _maintEvCache[elId].get(dateStr)||null;
  };
  const maintBadge=(evId)=>
    `<span style="font-size:7px;font-family:var(--mono);color:var(--amber);letter-spacing:.5px;cursor:pointer;font-weight:700;opacity:.9" onclick="openMaintenanceEventById('${evId}')">MAINT</span>`;

  // Transport events for this facility
  const railEvsByDay={};   // arrivals TO this facility
  const railDepsByDay={};  // departures FROM this facility
  const vesselEvsByDay={};
  DB.rail_movements.forEach(rm=>{
    // Inbound arrivals
    const arrDay=dateToDayOffset(rm.departure_date||rm.date,S.simCfg.start_date)+(rm.transit_days||1);
    if(arrDay>=0&&arrDay<=horizon&&rm.to_facility_id===S.facility_id){
      if(!railEvsByDay[arrDay]) railEvsByDay[arrDay]=[];
      railEvsByDay[arrDay].push(rm);
    }
    // Outbound departures
    const depDay=dateToDayOffset(rm.departure_date||rm.date,S.simCfg.start_date)+1;
    if(depDay>=1&&depDay<=horizon&&_railMoveOriginFacId(rm)===S.facility_id){
      if(!railDepsByDay[depDay]) railDepsByDay[depDay]=[];
      railDepsByDay[depDay].push(rm);
    }
  });
  const facBerthIds=new Set(getFacElements().filter(e=>e.type==='berth').map(e=>e.id));
  DB.vessel_calls.filter(v=>facBerthIds.has(v.berth_element_id)).forEach(v=>{
    const arrDay=dateToDayOffset(v.arrival_date,S.simCfg.start_date);
    if(arrDay>=0&&arrDay<=horizon){
      if(!vesselEvsByDay[arrDay]) vesselEvsByDay[arrDay]=[];
      vesselEvsByDay[arrDay].push(v);
    }
  });

  // Build header
  let h=`<table class="results-table" id="results-tbl">
    <thead>
      <tr>
        <th class="col-day">Date</th>
        <th class="col-date">Day</th>`;

  if(showDemand && demandCols.length){
    demandCols.forEach(d=>{
      const prod=DB.products.find(p=>p.id===d.product_id);
      h+=`<th class="group-demand">${prod?.name||d.product_id}<br><span style="font-size:7px;opacity:.6">Demand t/d</span></th>`;
    });
  }
  if(showInv && invCols.length){
    invCols.forEach(el=>{
      h+=`<th class="group-inventory">${esc(el.name)}<br><span style="font-size:7px;opacity:.6">Inventory t</span></th>`;
    });
  }
  if(showProd && prodCols.length){
    prodCols.forEach(el=>{
      h+=`<th class="group-production">${esc(el.name)}<br><span style="font-size:7px;opacity:.6">Produced t</span></th>`;
    });
  }
  if(railDispCols.length){
    railDispCols.forEach(el=>{
      h+=`<th style="background:rgba(var(--blue-rgb),.07);color:var(--blue);border-left:2px solid rgba(var(--blue-rgb),.3)">${esc(el.name)}<br><span style="font-size:7px;opacity:.6">↓ Load (cars)</span></th>`;
      h+=`<th style="background:rgba(var(--blue-rgb),.12);color:var(--blue)">${esc(el.name)}<br><span style="font-size:7px;opacity:.6">↑ Dispatch (cars)</span></th>`;
    });
  }
  h+=`<th style="background:rgba(0,229,160,.04);color:var(--green-dim)">Transport<br><span style="font-size:7px;opacity:.6">Events</span></th>`;
  h+=`</tr></thead><tbody>`;

  // ── Totals-row builder — computes each column over an arbitrary set of sim-days.
  // Reused for the per-year rows (emitted at each year boundary) and the grand total.
  const _yrDate=(day)=>{ const dt=new Date(S.simCfg.start_date+'T00:00:00'); dt.setDate(dt.getDate()+day-1); return dt; };
  const buildTotalsRow=(label, dayArr, isYear)=>{
    let row=`<tr style="background:${isYear?'var(--surface)':'var(--surface2)'};font-weight:700;${isYear?'border-top:2px solid var(--border2);border-bottom:2px solid var(--border2);':'position:sticky;bottom:0;'}">
      <td class="col-day" style="color:${isYear?'var(--total,var(--amber))':'var(--text)'}">${label}</td>
      <td class="col-date" style="color:var(--text-dim)">${dayArr.length} days</td>`;
    if(showDemand && demandCols.length){
      demandCols.forEach(d=>{
        const dpEl=DB.elements.find(e=>e.id===d.element_id);
        let total=0;
        if(dpEl){ dayArr.forEach(day=>{ total+=_demandRate(dpEl.id,_yrDate(day)._ymd()); }); }
        else { total=(d.daily_tonnage||0)*dayArr.length; }
        row+=`<td style="color:var(--green)">${Number(Math.round(total)).toLocaleString()}</td>`;
      });
    }
    if(showInv && invCols.length){
      invCols.forEach(el=>{
        const hist=r.inventoryHistory[el.id]||[];
        let s=0,n=0; dayArr.forEach(day=>{ const v=hist[day-1]; if(v!==undefined&&v!==null){ s+=v; n++; } });
        row+=`<td style="color:var(--blue)">avg: ${Number(n?Math.round(s/n):0).toLocaleString()}</td>`;
      });
    }
    if(showProd && prodCols.length){
      prodCols.forEach(el=>{
        const states=r.elementStates[el.id]||[];
        const caps=DB.element_product_capacities.filter(c=>c.element_id===el.id);
        const rate=caps.length?caps.reduce((a,c)=>a+(c.capacity_tpd||0),0):parseFloat(el.props.rated_capacity_tpd)||0;
        let runDays=0; dayArr.forEach(day=>{ const st=states[day-1]; if(st==='running'||st==='rampup') runDays++; });
        row+=`<td style="color:var(--amber)">${Number(Math.round(runDays*rate)).toLocaleString()}</td>`;
      });
    }
    if(railDispCols.length){
      railDispCols.forEach(el=>{
        const rh=r.railHistory?.[el.id]||[];
        let totalLoaded=0,totalDispatched=0;
        dayArr.forEach(day=>{ const entry=rh[day-1]||{}; totalLoaded+=Object.values(entry.carsLoadedByProduct||{}).reduce((a,b)=>a+b,0); totalDispatched+=Object.values(entry.dispatchByDest||{}).reduce((a,b)=>a+b,0); });
        const carCap=parseFloat(el.props.car_capacity_t)||50;
        row+=`<td style="color:var(--blue);font-family:var(--mono);border-left:2px solid rgba(var(--blue-rgb),.2)">${totalLoaded} cars</td>`;
        row+=`<td style="color:var(--blue);font-family:var(--mono)">${totalDispatched} cars · ${Number(totalDispatched*carCap).toLocaleString()}t</td>`;
      });
    }
    let railT=0,vesselT=0;
    dayArr.forEach(day=>{ (railEvsByDay[day]||[]).forEach(rm=>railT+=(rm.total_capacity_t||0)); (vesselEvsByDay[day]||[]).forEach(v=>vesselT+=(v.quantity_t||0)); });
    row+=`<td style="font-family:var(--mono);font-size:8px">${railT?`<span style="color:var(--blue)">Rail: ${Number(railT).toLocaleString()}t</span> `:''}${vesselT?`<span style="color:var(--amber)">Vessel: ${Number(vesselT).toLocaleString()}t</span>`:''}${!railT&&!vesselT?'—':''}</td>`;
    row+=`</tr>`;
    return row;
  };
  let yearDays=[]; const yearsSeen=new Set();

  // Build rows — iterate over view window days
  for(let i=0;i<horizon;i++){
    const day=startDay+i; // actual simulation day
    const date=new Date(S.simCfg.start_date+'T00:00:00');
    date.setDate(date.getDate()+day-1);
    const dateStr=date._ymd();
    const dayStr=dateStr.slice(5); // MM-DD

    // Check if any stop event on this day
    const hasStop=r.stopEvents.some(e=>e.day===day);
    // Weekend detection
    const rowSimDate=new Date(S.simCfg.start_date+'T00:00:00');
    rowSimDate.setDate(rowSimDate.getDate()+day-1);
    const rowDow=rowSimDate.getDay(); // 0=Sun,6=Sat
    const weekendCls=rowDow===6?'row-saturday':rowDow===0?'row-sunday':'';
    const isToday=dateStr===todayStr;
    const rowClass=[hasStop?'cell-stop':'',weekendCls,isToday?'row-today':''].filter(Boolean).join(' ');

    h+=`<tr class="${rowClass}">
      <td class="col-day">${dateStr}</td>
      <td class="col-date" style="color:var(--text-dim)">${day}</td>`;

    if(showDemand && demandCols.length){
      demandCols.forEach(d=>{
        const dpEl=DB.elements.find(e=>e.id===d.element_id);
        const val=dpEl?_demandRate(dpEl.id,dateStr):(d.daily_tonnage||0);
        h+=`<td class="${val===0?'cell-zero':''}" style="${val>0?'color:var(--simulated)':''}">${Number(Math.round(val)).toLocaleString()}</td>`;
      });
    }

    if(showInv && invCols.length){
      invCols.forEach(el=>{
        let val=0, isActual=false;

        // Check for ACTUAL inventory data — ENDING inventory from PREVIOUS day becomes BEGINNING for today
        // So for date X, look for real_inventory with date X-1 (that's the ending inv from previous day)
        const prevDate=new Date(dateStr+'T00:00:00');
        prevDate.setDate(prevDate.getDate()-1);
        const prevDateStr=prevDate._ymd();

        // For date X: display BEGINNING inventory = ENDING of day X-1
        // So ONLY check previous day's real inventory data (never check current date)
        let realInventory=null;
        if(day>1){
          realInventory=_idxFirst('real_inventory_daily','silo_id',el.id,'date',prevDateStr);
        }

        if(realInventory){
          val=parseFloat(realInventory.eod_volume_t)||0;
          isActual=true;
        } else {
          // Fall back to simulated inventory
          const hist=r.inventoryHistory[el.id]||[];
          const startInv=parseFloat(el.props?.start_inventory)||0;
          val=day>1?(hist[day-2]??0):startInv;
        }

        const max=parseFloat(el.props.max_capacity)||1000;
        const min=parseFloat(el.props.min_level)||0;
        const pct=val/max*100;
        const minPct=min/max*100;
        const maintEvId=getMaintEventId(el.id, dateStr);
        const cls=maintEvId?'cell-maint':val<=min?'cell-crit':pct<(minPct+10)?'cell-low':pct>95?'cell-ok':isActual?'cell-actual':'';
        const display=maintEvId?maintBadge(maintEvId):Number(val).toLocaleString();
        h+=`<td class="${cls}" style="${isActual?'font-weight:700;color:var(--real)':cls===''?'color:var(--simulated)':''}">${display}</td>`;
      });
    }

    if(showProd && prodCols.length){
      prodCols.forEach(el=>{
        const states=r.elementStates[el.id]||[];
        const state=states[day-1]||'idle';
        const isRunning=state==='running'||state==='rampup';
        const caps=DB.element_product_capacities.filter(c=>c.element_id===el.id);

        // Check for ACTUAL production data first
        let rate=0, cellColor='var(--simulated)', cellTitle=state, isActual=false;
        const realProduction=_dedupRealProd(el.id, dateStr);
        if(realProduction.length>0){
          rate=realProduction.reduce((sum,r)=>sum+(parseFloat(r.volume_t)||0),0);
          cellTitle=`Actual: ${rate}t`;
          cellColor='var(--real)';
          isActual=true;
        } else if(isRunning){
          // Fall back to simulated capacity
          if(el.type==='finish_mill'&&r.millProductHistory?.[el.id]){
            const activeProd=r.millProductHistory[el.id][day-1];
            if(activeProd){
              const cap=caps.find(c=>c.product_id===activeProd);
              rate=cap?.capacity_tpd||0;
              const palColors=['var(--simulated)','var(--blue)','var(--magenta)','var(--orange)'];
              const prodIdx=DB.products.findIndex(p=>p.id===activeProd);
              cellColor=palColors[prodIdx%palColors.length]||'var(--simulated)';
              cellTitle=DB.products.find(p=>p.id===activeProd)?.name||activeProd;
            }
          } else {
            rate=caps.length?caps.reduce((a,c)=>a+(c.capacity_tpd||0),0):parseFloat(el.props.rated_capacity_tpd)||0;
          }
        }

        const isMaint=state==='maintenance';
        const maintEvId=isMaint?getMaintEventId(el.id, dateStr):null;
        const cls=maintEvId?'cell-maint':rate===0?'cell-zero':state==='rampup'?'cell-low':isActual?'cell-actual':'';
        const display=maintEvId?maintBadge(maintEvId):Number(rate).toLocaleString();
        h+=`<td class="${cls}" style="${rate>0?`color:${cellColor};font-weight:${isActual?'700':'400'}`:'opacity:.4'}" title="${cellTitle}">${display}</td>`;
      });
    }

    // Rail dispatch — two columns per dispatch point: Load | Dispatch
    if(railDispCols.length){
      railDispCols.forEach(el=>{
        const entry=(r.railHistory?.[el.id]||[])[day-1]||{};
        const carsLoaded=Object.values(entry.carsLoadedByProduct||{}).reduce((a,b)=>a+b,0);
        const yardTotal=Object.values(entry.carsInYardByProduct||{}).reduce((a,b)=>a+b,0);
        const dispTotal=Object.values(entry.dispatchByDest||{}).reduce((a,b)=>a+b,0);

        // Switch day detection
        const curDate=new Date(startDate); curDate.setDate(curDate.getDate()+day-1);
        const dowMon=(curDate.getDay()+6)%7;
        const isSwitch=(el.props.switch_days||[]).includes(dowMon);

        // ── LOAD column ──────────────────────────────────
        // Show cars loaded today. Tooltip shows yard accumulation.
        const loadTip=yardTotal>0?`In yard: ${yardTotal} cars`:'Yard empty';
        const loadCls=carsLoaded>0?'':'cell-zero';
        const loadLabel=carsLoaded>0?`+${carsLoaded}`:'0';
        h+=`<td class="${loadCls}" style="font-family:var(--mono);color:var(--blue);border-left:2px solid rgba(var(--blue-rgb),.2)" title="${loadTip}">${loadLabel}</td>`;

        // ── DISPATCH column ──────────────────────────────
        // Only populated on switch days. Tooltip shows per-destination breakdown.
        let dispLabel='—', dispCls='cell-zero', dispTip='';
        if(isSwitch){
          if(dispTotal>0){
            dispLabel=`${dispTotal} cars`;
            dispCls='cell-ok';
            dispTip=Object.entries(entry.dispatchByDest||{}).map(([fid,cars])=>{
              const fac=DB.facilities.find(f=>f.id===fid);
              const carCap=parseFloat(el.props.car_capacity_t)||50;
              return `${fac?.name||fid}: ${cars} cars (${cars*carCap}t)`;
            }).join(' | ');
          } else {
            dispLabel='↑ —';
            dispCls='cell-low';
            dispTip='Switch day — yard was empty';
          }
        }
        h+=`<td class="${dispCls}" style="font-family:var(--mono)" title="${dispTip}">${dispLabel}</td>`;
      });
    }

    // Transport events cell
    const railArr=railEvsByDay[day]||[];
    const railDeps=railDepsByDay[day]||[];
    const vesselArr=vesselEvsByDay[day]||[];
    // Silo transfers that moved material this day (tonnes the simulation moved, every link).
    const _sth=S.simResults?.siloTransferHistory||{};
    const xferT=Object.keys(_sth).reduce((s,id)=>{ const e=_sth[id][day-1]; return s+(e?((e.fwd?.moved||0)+(e.rev?.moved||0)):0); },0);
    let transportCell='<td style="font-family:var(--mono);font-size:8px;color:var(--text-dim)">';
    if(railArr.length) transportCell+=`<span style="color:var(--blue)" title="Rail arrival">↓ Rail ${railArr.map(r=>Number(r.total_capacity_t).toLocaleString()+'t').join(', ')}</span> `;
    if(railDeps.length){
      const depLabel=railDeps.map(r=>{const dest=DB.facilities.find(f=>f.id===r.to_facility_id);return `${Number(r.total_capacity_t).toLocaleString()}t→${dest?.name||'?'}`;}).join(', ');
      transportCell+=`<span style="color:var(--blue);opacity:.7" title="Rail departure (${railDeps[0].status||'Planned'})">↑ Rail ${depLabel}</span> `;
    }
    if(vesselArr.length) transportCell+=`<span style="color:var(--amber)" title="Vessel arrival">⚓ ${vesselArr.map(v=>v.name).join(', ')}</span> `;
    if(xferT>0) transportCell+=`<span style="color:var(--orange)" title="Silo transfers">┄ Silo transfer ${Math.round(xferT).toLocaleString()}t</span>`;
    if(!railArr.length&&!railDeps.length&&!vesselArr.length&&!(xferT>0)) transportCell+='—';
    transportCell+='</td>';
    h+=transportCell;

    h+=`</tr>`;

    // Year-total row at each year boundary (sums this year's rows).
    yearsSeen.add(dateStr.slice(0,4));
    yearDays.push(day);
    let _isYearEnd=(i===horizon-1);
    if(!_isYearEnd){ const nd=new Date(S.simCfg.start_date+'T00:00:00'); nd.setDate(nd.getDate()+(startDay+i+1)-1); _isYearEnd=(nd.getFullYear()!==date.getFullYear()); }
    if(_isYearEnd){ h+=buildTotalsRow('Σ '+date.getFullYear(), yearDays.slice(), true); yearDays=[]; }
  }

  // Grand total across the whole view window — only when it spans more than one
  // year (otherwise it would duplicate the single year-total row above).
  if(yearsSeen.size>1) h+=buildTotalsRow('TOTAL', Array.from({length:horizon},(_,i)=>startDay+i), false);
  h+=`</tbody></table>`;
  wrap.innerHTML=h;

  // ── Sync top scrollbar width to actual table width ────
  const topScroll=document.getElementById('results-top-scroll');
  const topInner=document.getElementById('results-top-scroll-inner');
  if(topScroll&&topInner){
    // Set inner width to match table scroll width
    requestAnimationFrame(()=>{
      topInner.style.width=wrap.scrollWidth+'px';
    });
    // Sync scroll: top → table
    topScroll.onscroll=()=>{ wrap.scrollLeft=topScroll.scrollLeft; };
    // Sync scroll: table → top
    wrap.onscroll=()=>{ topScroll.scrollLeft=wrap.scrollLeft; };
  }
}

