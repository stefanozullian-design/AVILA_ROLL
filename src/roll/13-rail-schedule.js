// ══════════════════════════════════════════════════════════════════
// TRANSPORT PLANNER — Rail Schedule
// ══════════════════════════════════════════════════════════════════
const _rpCharts={};  // active Chart.js instances — destroyed and rebuilt on each rpRender()
const _vpCharts={};  // active Chart.js instances for vessel planner

// ── Topology helpers ─────────────────────────────────────────────
// Get all facilities that have a Rail berth on the current canvas
function rpGetRailDestinations(){
  const allEls=getFacElements();
  const facIds=new Set();
  // Primary: scan dispatch_point destination configs (catches new terminals regardless of berth type)
  allEls.filter(e=>e.type==='dispatch_point'&&e.props?.dispatch_type==='Rail')
    .forEach(dp=>(dp.props?.destinations||[]).forEach(d=>d.facility_id&&facIds.add(d.facility_id)));
  // Fallback: berths explicitly marked as rail type
  allEls.filter(e=>e.type==='berth'&&(e.props?.berth_type||'').toLowerCase().includes('rail'))
    .forEach(e=>{const fid=e.assigned_facility_id||e.facility_id;if(fid)facIds.add(fid);});
  return [...facIds].map(id=>DB.facilities.find(f=>f.id===id)).filter(Boolean)
    .filter((f,i,a)=>a.findIndex(x=>x.id===f.id)===i);
}

// Get rail dispatch points on current canvas that can reach a destination
function rpGetOriginsForDest(destFacId){
  const allEls=getFacElements();
  const allConns=getFacConnections();
  const results=[];
  allEls.filter(e=>e.type==='dispatch_point'&&e.props?.dispatch_type==='Rail').forEach(dp=>{
    // Use canvas connections as primary check — catches terminals wired up but not yet in destinations config
    const downBerths=(allConns.filter(c=>c.from_element_id===dp.id))
      .map(c=>allEls.find(e=>e.id===c.to_element_id))
      .filter(e=>e?.type==='berth'&&(e.assigned_facility_id||e.facility_id)===destFacId);
    if(!downBerths.length) return;
    // destCfg may be null if the destination was connected on canvas but not added to dispatch config
    const destCfg=(dp.props?.destinations||[]).find(d=>d.facility_id===destFacId)||null;
    // Find upstream RAIL silo
    const upRailSilo=(allConns.filter(c=>c.to_element_id===dp.id))
      .map(c=>allEls.find(e=>e.id===c.from_element_id))
      .find(e=>e?.type==='bulk_silo');
    // Origin facility
    const origFac=DB.facilities.find(f=>f.id===dp.facility_id)||DB.facilities.find(f=>f.id===S.facility_id);
    results.push({dp, destCfg, berth:downBerths[0], railSilo:upRailSilo, origFac});
  });
  return results;
}

// Get main production silos at origin that feed the RAIL silo (for inventory display)
function rpGetOriginProdSilos(dpEl){
  const allEls=getFacElements();
  const allConns=getFacConnections();
  // Find RAIL silo upstream of dp
  const railSiloId=(allConns.filter(c=>c.to_element_id===dpEl.id))
    .map(c=>c.from_element_id)
    .find(id=>allEls.find(e=>e.id===id&&e.type==='bulk_silo'));
  if(!railSiloId) return [];
  // Find mills that feed the RAIL silo
  const mills=(allConns.filter(c=>c.to_element_id===railSiloId))
    .map(c=>allEls.find(e=>e.id===c.from_element_id))
    .filter(e=>e?.type==='finish_mill');
  // Collect other cement silos these mills also feed
  const siloIds=new Set();
  mills.forEach(mill=>{
    allConns.filter(c=>c.from_element_id===mill.id).forEach(c=>{
      const el=allEls.find(e=>e.id===c.to_element_id);
      if(el?.type==='bulk_silo'&&el.id!==railSiloId) siloIds.add(el.id);
    });
  });
  return [...siloIds].map(id=>allEls.find(e=>e.id===id)).filter(Boolean);
}

// Get destination silo for a berth (single — kept for legacy callers)


// Get ALL destination silos for a berth (one per product at that terminal)
function rpGetDestSilos(berthEl){
  if(!berthEl) return [];
  const allEls=getFacElements();
  const allConns=getFacConnections();
  return allConns.filter(c=>c.from_element_id===berthEl.id)
    .map(c=>allEls.find(e=>e.id===c.to_element_id))
    .filter(e=>e?.type==='bulk_silo');
}

// Get demand element for a destination facility
function rpGetDestDemEls(destFacId){
  return getFacElements().filter(e=>e.type==='demand_point'&&
    (e.assigned_facility_id||e.facility_id)===destFacId);
}

// Helper: does a demand element serve a given product?
// Checks DB.demand_points catalog first, falls back to element's own product_id prop
function _demElMatchesProd(el, prodId){
  if(!prodId) return true;
  const dp=(DB.demand_points||[]).find(d=>d.element_id===el.id);
  if(dp?.products?.length) return dp.products.some(p=>p.product_id===prodId);
  return (el.props?.product_id||'')=== prodId;
}
// Product-ids carried by a demand point element (multi-product or single legacy prop)
function _demElProdIds(el){
  const dp=(DB.demand_points||[]).find(d=>d.element_id===el.id);
  if(dp?.products?.length) return dp.products.map(p=>p.product_id).filter(Boolean);
  return el.props?.product_id ? [el.props.product_id] : [];
}
// INT / EXT — embedded in the product name (falls back to the demand-point name)
function _demElType(el){
  const names=_demElProdIds(el).map(pid=>DB.products.find(p=>p.id===pid)?.name||'');
  names.push(el.name||'');
  const blob=names.join(' ').toUpperCase();
  if(blob.includes('INT')) return 'INT';
  if(blob.includes('EXT')) return 'EXT';
  return '';
}

// ── View range ────────────────────────────────────────────────────
// The shared time frame as simulation days. The rail simulation can run past the configured
// horizon, so its own horizon bounds the window.
function rpGetRange(){
  return fltSimDayRange('logi', S.simResults?.simHorizon||S.simCfg.horizon||90);
}

function rpDayDate(d){
  const dt=new Date(S.simCfg.start_date+'T00:00:00');
  dt.setDate(dt.getDate()+d-1);
  return dt._ymd();
}

// Weekday of sim day d, anchored at NOON like simulate(): adding whole days to MIDNIGHT lands
// on 23:00 the previous day once the clocks fall back (Nov 1), which put every weekend tint
// and switch-day input one column early from November on — so a push typed there was dated
// a day the simulation never ships on.
function _rpDow(d){return new Date(new Date(S.simCfg.start_date+'T12:00:00').getTime()+(d-1)*864e5).getDay();}
function rpIsSat(d){return _rpDow(d)===6;}
function rpIsSun(d){return _rpDow(d)===0;}
function rpIsSwitch(d,switchDays){return switchDays.includes((_rpDow(d)+6)%7);}

// ── Destinations in view ──────────────────────────────────────────
// The shared Facility / Sub-region pick, read the rail way: a lane shows when EITHER end is
// picked — the terminal itself, or a plant that ships to it. Picking BRS shows every terminal
// BRS serves; picking JAX shows JAX and the origins that feed it.
function rpShownDests(){
  const fs=fltFacIdSet();
  const all=rpGetRailDestinations().map(f=>f.id);
  if(!fs) return all;
  return all.filter(fid=>fs.has(fid)||rpGetOriginsForDest(fid).some(o=>fs.has(_railDpFacId(o.dp))));
}

// ── Rail products ─────────────────────────────────────────────────
// Products that move by rail to the given destinations (default: the ones in view).
function rpGetRailProducts(dests){
  const destIds=dests||rpShownDests();
  if(!destIds.length) return [];
  const allEls=getFacElements();
  const prodIds=new Set();
  // Source 1: accepted_products listed in dispatch point destination configs
  allEls.filter(e=>e.type==='dispatch_point'&&e.props?.dispatch_type==='Rail')
    .forEach(dp=>{
      (dp.props?.destinations||[])
        .filter(d=>destIds.includes(d.facility_id))
        .forEach(d=>(d.accepted_products||[]).forEach(pid=>{ if(pid) prodIds.add(pid); }));
    });
  // Source 2: products on existing rail movements going TO selected destinations
  DB.rail_movements
    .filter(rm=>destIds.includes(rm.to_facility_id))
    .forEach(rm=>{ if(rm.product_id) prodIds.add(rm.product_id); });
  return [...prodIds]
    .map(id=>DB.products.find(p=>p.id===id))
    .filter(Boolean)
    .filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i)
    .sort((a,b)=>(a.name||a.id).localeCompare(b.name||b.id));
}

// ── Demand rate helper ────────────────────────────────────────────
function rpDemand(elId,d){
  return _demandRate(elId,rpDayDate(d)); // calendar step — midnight + n×24h drifts a day after Nov 1
}
// Suggested split of one switch's cars of a product across a dispatch point's terminals:
// ALL `avail` cars, proportional to each terminal's demand for that product over the 7 days
// after the cars arrive. When no terminal has demand in that week (holidays, or the forecast
// ends) the window widens — 14 days, then 30 days after arrival, then the 30 days BEFORE
// arrival (recent demand) — and only with no demand at all do the cars go to the first
// terminal. The Rail Schedule shows it as the dashed proposal, and the simulation ships it on
// any switch the user hasn't confirmed, so an unconfirmed switch still departs instead of
// piling the cars into the next one.
// Terminals are taken in the dispatch point's destination order (the last gets the remainder).
const RAIL_SPLIT_WINDOWS=[[0,7],[0,14],[0,30],[-30,0]];   // days from arrival: [from, to)
function railSuggestSplit(dp, pid, d, avail, destIds){
  const out={};
  const order=(dp.props?.destinations||[]).map(x=>x.facility_id);
  const dests=destIds.filter(f=>order.includes(f)).sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  if(!(avail>0)||!dests.length) return out;
  const info=dests.map(fid=>({fid,
    tr:parseInt((dp.props?.destinations||[]).find(x=>x.facility_id===fid)?.transit_days)||1,
    els:rpGetDestDemEls(fid).filter(el=>_demElMatchesProd(el,pid))}));
  let w={}, tw=0;
  for(const [a,b] of RAIL_SPLIT_WINDOWS){
    w={}; tw=0;
    info.forEach(({fid,tr,els})=>{
      const dem=els.reduce((s,el)=>{ let q=0; for(let k=a;k<b;k++) q+=rpDemand(el.id,d+tr+k)||0; return s+q; },0);
      w[fid]=dem; tw+=dem;
    });
    if(tw>0) break;
  }
  let assigned=0;
  dests.forEach((fid,i)=>{
    const a=Math.max(0,tw>0?(i===dests.length-1?avail-assigned:Math.floor(avail*(w[fid]||0)/tw)):(i===0?avail:0));
    out[fid]=a; assigned+=a;
  });
  return out;
}
// Demand-page value for an element on a date — aggregates DB.demand_values EXACTLY like the
// Demand grid's getVal (sums ship_to breakdowns; DP-level value otherwise). The Demand page is
// the single source of truth the logistics schedules must mirror, so the schedules use THIS —
// not _demandRate, which also folds in actuals and doesn't sum ship_to (would desync).
function _demGridVal(elId, ds){
  let c=_demGridVal._cache;
  if(!c){
    c=_demGridVal._cache={};
    (DB.demand_values||[]).forEach(v=>{
      if(!v.element_id||!v.date) return;
      const k=v.element_id+'|'+v.date;
      if(v.ship_to){ if(!c[k]||!c[k]._s) c[k]={t:0,_s:true}; c[k].t+=(parseFloat(v.value_t)||0); }
      else if(!c[k]?._s){ c[k]={t:parseFloat(v.value_t)||0}; }
    });
  }
  const r=c[elId+'|'+ds];
  return r?(r.t||0):0;
}
// EFFECTIVE demand shown on the Demand page = own − swapped-out + swapped-in (point-to-point),
// computed from the SAME getVal source so the logistics schedules match the Demand page exactly.
function rpDemandEff(elId,d){
  const ds=rpDayDate(d); // calendar step — midnight + n×24h drifts a day after Nov 1
  const own=_demGridVal(elId,ds);
  let v=own;
  if(typeof _resolveDemandSwap==='function'){ const sw=_resolveDemandSwap(elId,own,ds); if(sw&&sw.qty) v-=Math.min(sw.qty,own); }
  if(typeof _resolveDemandSwapIn==='function'){ v+=_resolveDemandSwapIn(elId,ds,(id)=>_demGridVal(id,ds))||0; }
  return Math.max(0,v);
}
// Tonnes swapped INTO a demand point on sim day d (for the breakout row) — same source as above.

// Push a demand point's rows into a logistics planner table: an EFFECTIVE-demand row
// (own − swapped-out + swapped-in) plus, when relevant, an amber "↳ ⇄ swapped in" breakout
// showing the extra demand relocated here from other points (e.g. MIA→PEV).


// ── Inventory snapshot from simulation results ────────────────────
function rpInv(elId,d){
  if(!S.simResults) return null;
  const hist=S.simResults.inventoryHistory[elId]||[];
  if(d<=1){
    const el=getEl(elId);
    return parseFloat(el?.props?.start_inventory)||0;
  }
  return hist[d-2]??null;
}

// ── Arrivals at a rail destination ────────────────────────────────
function rpPlannedArrivalsForDest(destFacId,berthId,opts){
  // Returns {day: [{tonnes,status,productId,depDay,fromFacId,unmatched,fromDpId,rec}]} — what reaches this
  // terminal's rail yard, by arrival day. Honours the Rail Schedule's Product filter unless
  // opts.allProducts. `unmatched` marks a real dispatch whose origin facility has no rail
  // dispatch point serving this terminal — the simulation never ships those.
  //
  // TWO sources, mirroring exactly what the simulation ships (see the railPushes build in
  // the rail schedule step of the sim):
  //   1. DB.rail_movements                — the plan (Confirmed / Planned / Proposed / …)
  //   2. DB.real_rail_daily type 'dispatched' — what really left the siding
  // A real dispatch REPLACES the plan for the origin + departure date it covers, just as the
  // simulation does. Reading only the movements (as this did) meant a real dispatch — a past
  // switch committed with ✓ — moved inventory while showing no arrival at all, so this row
  // and the INVENTORY row above it disagreed.
  //
  // productId is carried so the arrival total can be split per product; fromDpId and rec (the
  // source row itself) let tooltips name the dispatch point and the AI agent edit the record.
  const map={};
  const startDs=S.simCfg.start_date;
  if(!startDs) return map;
  const _dayOfDate=ds=>Math.round((new Date(ds+'T00:00:00')-new Date(startDs+'T00:00:00'))/864e5)+1;
  const _allowP=opts?.allProducts?null:fltAllowedProdIds();
  const _pidOk=pid=>!_allowP||_allowP.has(pid||'');
  const _add=(arrDay,tonnes,status,productId,depDay,fromFacId,unmatched,fromDpId,rec)=>{
    // A 0-car push is a decision ("send nothing this switch"), not an arrival — it was
    // rendering as a phantom 0t cell on the arrival date.
    if(!arrDay||arrDay<1||!(tonnes>0)) return;
    (map[arrDay]=map[arrDay]||[]).push({tonnes,status,productId:productId||'',depDay,fromFacId,unmatched:!!unmatched,fromDpId:fromDpId||null,rec});
  };

  // Origins feeding this terminal — they price a real dispatch (cars → tonnes) and say which
  // origin facility's real records override which planned movements.
  const origins=rpGetOriginsForDest(destFacId);
  const origFacIds=new Set(origins.map(o=>_railDpFacId(o.dp)));
  const realRows=(DB.real_rail_daily||[]).filter(rr=>rr.type==='dispatched'&&rr.date);

  // Origin + departure date pairs covered by a real record. Built from EVERY real dispatch at
  // those origins, not just the ones bound for this terminal: the simulation replaces the
  // whole switch day's pushes once reality is recorded for it.
  const _realCovers=new Set();
  realRows.filter(rr=>origFacIds.has(rr.facility_id))
    .forEach(rr=>_realCovers.add(`${rr.facility_id}|${rr.date}`));

  // 1) REAL dispatches bound for this terminal.
  realRows.filter(rr=>rr.dest_facility_id===destFacId)
    .filter(rr=>_pidOk(rr.product_id))
    .forEach(rr=>{
      const own=origins.find(x=>_railDpFacId(x.dp)===rr.facility_id);
      const o=own||origins[0];
      const carCap=parseFloat(o?.dp?.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
      const transit=parseInt(o?.destCfg?.transit_days)||1;
      const dep=_dayOfDate(rr.date);
      _add(dep+transit,(parseInt(rr.cars)||0)*carCap,'Real',rr.product_id,dep,rr.facility_id,!own,own?.dp?.id,rr);
    });

  // 2) PLANNED movements — skipped where a real record already covers that origin + day.
  DB.rail_movements
    .filter(rm=>rm.to_facility_id===destFacId)
    .filter(rm=>_pidOk(rm.product_id))
    .forEach(rm=>{
      const st=rm.status||'Planned';
      let depDay=null,depDs=rm.departure_date||null;
      if(depDs) depDay=_dayOfDate(depDs);
      else if(rm.switch_day){ depDay=rm.switch_day; depDs=rpDayDate(depDay); }
      if(!depDay) return;
      const origFacId=_railDpFacId(getEl(rm.from_dispatch_id));
      if(_realCovers.has(`${origFacId}|${depDs}`)) return;
      const transit=parseInt(rm.transit_days)||1;
      _add(depDay+transit,parseFloat(rm.total_capacity_t)||0,st,rm.product_id,depDay,origFacId,false,rm.from_dispatch_id,rm);
    });
  return map;
}

// Tooltip lines for the cars behind one terminal pull: for each arrival record, how many cars,
// from which origin and dispatch point, when they left and reached the rail yard, and whether
// it is a real dispatch or a planned push. Records the simulation ignores (a dispatch filed
// under a facility with no rail link to this terminal) are listed too and flagged, so a
// misfiled or mistyped record can be traced straight from the cell. ents need arrDay.
function _railArrivalSourceText(ents, carCap){
  const day=d=>`${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][_rpDow(d)]} ${rpDayDate(d).slice(5)}`;
  return ents.slice().sort((a,b)=>a.depDay-b.depDay||a.arrDay-b.arrDay).map(e=>{
    const cars=Math.round((e.tonnes||0)/(carCap||RAIL_CAR_T_DEFAULT));
    const fac=DB.facilities.find(f=>f.id===e.fromFacId)?.name||e.fromFacId||'?';
    const dp=e.fromDpId?getEl(e.fromDpId)?.name:null;
    const kind=e.status==='Real'?'real dispatch':`${String(e.status||'Planned').toLowerCase()} push`;
    const stamp=e.rec?.updated_at||e.rec?.created_at;
    // Origin and the switch day the cars left it lead the line — that is what tracing a
    // wrong number starts from; the rest is detail on the indented line.
    let s=`• ${fac} — switch ${day(e.depDay)} → ${cars} car${cars===1?'':'s'} · ${kind}`;
    s+=`\n   ${dp?`via ${dp} · `:''}at the rail yard ${day(e.arrDay)}`;
    if(stamp) s+=` · entered ${String(stamp).slice(0,10)}`;
    if(e.unmatched) s+=`\n   ⚠ NOT COUNTED — ${fac} has no rail dispatch point linked to this terminal (misfiled record?)`;
    return s;
  }).join('\n');
}

// ── Rail terminal PULLS (rail yard → local yard) ────────────────────────────
// A rail terminal's receipts are dated by the day it PULLS the cars from the railroad's yard
// to its local yard: its switch day, or the arrival day for a berth with no switch days.
// Quantities come from the simulation (railPulledHistory), so physical yard counts and real
// 'placed' records count and nothing the simulation doesn't ship appears. Shared by the Rail
// Schedule destination rows, the Supply page's RAIL ARRIVALS and the backward planner.
function railTerminalPulls(destFacId){
  const berths=getFacElements().filter(e=>e.type==='berth'&&(e.props?.berth_type||'')==='Rail Receiving'
    &&(e.assigned_facility_id||e.facility_id)===destFacId);
  const carCap=parseFloat(berths[0]?.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
  const swDays=[...new Set(berths.flatMap(b=>b.props?.switch_days||[]))].sort((a,b)=>a-b);
  const r=S.simResults;
  const hist=(key,pid,d)=>berths.reduce((s,b)=>{
    const e=(r?.[key]?.[b.id]||[])[d-1]||{};
    return s+(pid==null?Object.values(e).reduce((a,x)=>a+x,0):(e[pid]||0));
  },0);
  const isPullDay=d=>swDays.length?rpIsSwitch(d,swDays):true;
  return {
    berths, carCap, swDays, isPullDay,
    hasSim:berths.some(b=>Array.isArray(r?.railPulledHistory?.[b.id])),
    // The pull day before d (0 when none within a week) — arrivals after it and up to d are
    // pulled on d.
    prevPullDay:d=>{ for(let x=d-1;x>=Math.max(1,d-7);x--) if(isPullDay(x)) return x; return Math.max(0,d-7); },
    pulledT:(pid,d)=>hist('railPulledHistory',pid,d),
    arrivedT:(pid,d)=>hist('railArrivedHistory',pid,d),
  };
}
// One terminal pull cell, shared by the Rail Schedule and the Supply page so both show the same
// number, status and explanation: the simulated cars pulled on day d, the arrival records behind
// them (`ignored` = records the simulation never ships), the plan they add up to with yard-count
// / placed adjustments (adj), and how many planned cars the origin could not ship (short).
function _railPullInfo(pulls, arrivals, pid, d){
  const carsOf=t=>Math.round((t||0)/pulls.carCap);
  const tP=pulls.pulledT(pid,d), P=pulls.prevPullDay(d), ents=[], ignored=[];
  let simArrT=0;
  for(let a=P+1;a<=d;a++){
    (arrivals[a]||[]).forEach(e=>{ if(e.productId===pid) (e.unmatched?ignored:ents).push({...e,arrDay:a}); });
    simArrT+=pulls.arrivedT(pid,a);
  }
  const cars=carsOf(tP);
  const planT=ents.reduce((s,e)=>s+e.tonnes,0)+(tP-simArrT);
  return {tP, cars, ents, ignored, adj:carsOf(tP-simArrT), short:Math.max(0,carsOf(planT)-cars),
    allReal:ents.length>0&&ents.every(e=>e.status==='Real')};
}
// The tooltip lines under a pull cell's first line. `editable` = a pull day still ahead.
function _railPullTipLines(info, carCap, editable){
  let s='';
  if(info.ents.length||info.ignored.length) s+='\nFrom (origin — switch day the cars left):\n'+_railArrivalSourceText([...info.ents,...info.ignored],carCap);
  if(info.adj) s+=`\nYard count / placed record: ${info.adj>0?'+':''}${info.adj} cars`;
  if(info.short) s+=`\n⚠ ${info.short} planned car${info.short===1?'':'s'} not shipped — the origin is short`;
  if(editable) s+='\nType the cars you want pulled here — the departure is planned backward from this switch';
  return s;
}
// Cars available to push at origin switch d for product pid — the simulation's yard AFTER
// that day's loading and any real yard count, BEFORE shipping. Older sim results lack
// carsAvailByProduct: rebuild from the yard left at the previous switch + cars loaded since.
function _rpAvailAtSwitch(dp,pid,d){
  const rh=S.simResults?.railHistory?.[dp.id]||[];
  const e=rh[d-1];
  if(e&&e.carsAvailByProduct) return e.carsAvailByProduct[pid]||0;
  const sw=dp.props?.switch_days||[];
  let P=0; for(let x=d-1;x>=1;x--){ if(rpIsSwitch(x,sw)){ P=x; break; } }
  let a=P>=1?(rh[P-1]?.carsInYardByProduct?.[pid]||0):0;
  for(let x=P+1;x<=d;x++) a+=rh[x-1]?.carsLoadedByProduct?.[pid]||0;
  return a;
}

// Planned loading at origin per day


// ── Rail loading capacity helpers (shared by display + planner) ────
// A rail dispatch point's siding can physically load only a fixed number of cars per
// day — `std_loading_cars_shift × shifts_per_day` — TOTAL, across every destination and
// product it serves. These helpers enforce that single shared cap everywhere loading is
// derived, so the schedule never shows (or plans) more than the siding can actually load.

// Returns a (dayNum)=>bool predicate for whether a given simulation day is a working
// (loading) day for this dispatch point, honoring working_days + facility non-working days.
function _mkRailWorkDayFn(dp){
  const setting=dp?.props?.working_days||'weekdays';
  const nwd=new Set((DB.non_working_days||[]).map(n=>n.date));
  const start=new Date((S.simCfg?.start_date||'')+'T00:00:00');
  return (dayNum)=>{
    // Calendar step: +24h from midnight lands on 23:00 the day before once the clocks fall back
    // (Nov 1), which tested every later day against the previous day's weekday.
    const dt=new Date(start); dt.setDate(dt.getDate()+dayNum-1);
    if(nwd.has(dt._ymd())) return false;
    const dow=(dt.getDay()+6)%7; // Mon=0..Sun=6
    if(setting==='7_days') return true;
    if(setting==='mon_sat') return dow<=5;
    return dow<=4; // weekdays default
  };
}

// The per-dispatch-point physical loading cap, in cars/day.
function _railCarsPerDay(dp){
  return (parseFloat(dp?.props?.std_loading_cars_shift||dp?.props?.std_loading_cars_day)||10)
        *(parseFloat(dp?.props?.shifts_per_day)||1);
}

// Ops loading plan: how many cars/day of a product to load at a rail dispatch point on a date.
// A dated row (date_from..date_to) overrides the base (undated) row. Returns 0 if unset.
function railPlanRate(dispatchId, productId, dateStr){
  const rows=(DB.rail_loading_plan||[]).filter(p=>p.dispatch_id===dispatchId&&p.product_id===productId);
  let base=0, override=null;
  rows.forEach(p=>{
    const dated=p.date_from||p.date_to;
    if(!dated){ base=parseFloat(p.cars_per_day)||0; return; }
    const from=p.date_from||'0000-01-01', to=p.date_to||'9999-12-31';
    if(dateStr>=from&&dateStr<=to) override=parseFloat(p.cars_per_day)||0;
  });
  return override!==null?override:base;
}
// A dated loading-plan row (= a loading CAMPAIGN) covering dateStr for this dp+product, if any.
// Returns the LAST match, not the first: railPlanRate resolves overlaps the same way, so a
// one-day row written by saveRailLoadCell (appended after a longer campaign) is the row that
// actually governs the day — and therefore the one the popup should edit.
function _railActivePlan(dpId, pid, ds){
  const hits=(DB.rail_loading_plan||[]).filter(p=>p.dispatch_id===dpId&&p.product_id===pid&&(p.date_from||p.date_to)
    &&ds>=(p.date_from||'0000-01-01')&&ds<=(p.date_to||'9999-12-31'));
  return hits[hits.length-1];
}

// ── Rail plan sync: loading edits → the Rail Schedule's switch records ──────────────
// Loading is edited on the Supply page (Rail Car Loading) and on the Rail Schedule (Loaded
// row, same popup), but the cars only reach a terminal through records the Rail Schedule owns
// for the switch that collects them: the confirmed pushes and, when one was typed, the
// "Available at switch" yard count. That count is an ABSOLUTE override of the yard, so a
// loading change never got past it — cars removed at BRS on the Production page still shipped
// to SUT (09-17), and the pushes kept showing the old plan.
// Every loading writer now calls _railLoadingEdited(dpIds, dates) BEFORE the re-run; it keeps
// the cars the current simulation loads on those days. When the re-run finishes,
// _railSyncAfterSim() carries the difference into the collecting switch (first switch on or
// after the day), for switches today or later — earlier switches hold actuals, left as recorded:
//   · a yard count there moves by the same number of cars;
//   · when cars were removed, the confirmed pushes lose the cars that can no longer ship,
//     taken from the last shipping push backward (the simulation ships pushes in order). A
//     push's unshipped part — a request the origin was already short for, e.g. a target typed
//     into a terminal's pull cell (backward planning saves the full request) — is kept, so it
//     stays flagged red. Each push remembers the cars taken (sync_trimmed) and gets them back,
//     in shipping order, when loading returns; an operator edit of the push clears that memory;
// then saves and re-runs once more, so both pages and the terminals show the same plan.
const _railSync={pending:new Map()}; // `${dpId}|${date}` → {dpId, day, old:{pid:cars loaded}}
function _railDpsOfFac(facId){
  return DB.elements.filter(e=>e.type==='dispatch_point'&&e.props?.dispatch_type==='Rail'&&_railDpFacId(e)===facId).map(e=>e.id);
}
function _railDateRange(from, to){
  const out=[]; if(!from||!to||from>to) return out;
  const d=new Date(from+'T12:00:00');
  for(let i=0;i<1000;i++){ const ds=d._ymd(); if(ds>to) break; out.push(ds); d.setDate(d.getDate()+1); }
  return out;
}
function _railLoadingEdited(dpIds, dates){
  const r=S.simResults; if(!r?.railHistory||!S.simCfg?.start_date) return;
  const start=new Date(S.simCfg.start_date+'T00:00:00');
  (dpIds||[]).forEach(dpId=>{
    const hist=r.railHistory[dpId]; if(!hist) return;
    (dates||[]).forEach(ds=>{
      const key=dpId+'|'+ds;
      if(_railSync.pending.has(key)) return; // several edits before the re-run: keep the oldest
      const day=Math.round((new Date(ds+'T00:00:00')-start)/864e5)+1;
      if(day<1||day>hist.length) return;
      _railSync.pending.set(key,{dpId, day, old:{...(hist[day-1]?.carsLoadedByProduct||{})}});
    });
  });
}
function _railSyncAfterSim(){
  if(!_railSync.pending.size) return;
  const entries=[..._railSync.pending.values()];
  _railSync.pending.clear();
  const r=S.simResults; if(!r?.railHistory) return;
  const today=new Date()._ymd(), now=new Date().toISOString();
  const facName=id=>DB.facilities.find(f=>f.id===id)?.name||id;
  const changes=[];
  const byDp={};
  entries.forEach(e=>{ (byDp[e.dpId]=byDp[e.dpId]||[]).push(e); });
  Object.entries(byDp).forEach(([dpId,list])=>{
    const dp=getEl(dpId), hist=r.railHistory[dpId];
    const sw=dp?.props?.switch_days||[];
    if(!dp||!hist||!sw.length) return;
    const facId=_railDpFacId(dp);
    const carCap=parseFloat(dp.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
    // Loaded-cars difference per collecting switch and product.
    const bySw={};
    list.forEach(e=>{
      let s=e.day; while(s<=hist.length&&!rpIsSwitch(s,sw)) s++;
      if(s>hist.length) return;
      const cur=hist[e.day-1]?.carsLoadedByProduct||{};
      new Set([...Object.keys(cur),...Object.keys(e.old)]).forEach(pid=>{
        const d=(cur[pid]||0)-(e.old[pid]||0);
        if(d){ bySw[s]=bySw[s]||{}; bySw[s][pid]=(bySw[s][pid]||0)+d; }
      });
    });
    Object.entries(bySw).forEach(([sDay,byPid])=>{
      const ds=rpDayDate(+sDay);
      if(ds<today) return;
      // A real dispatch recorded for this switch replaces its pushes in the simulation.
      const realDisp=(DB.real_rail_daily||[]).some(rr=>rr.type==='dispatched'&&rr.date===ds&&rr.facility_id===facId);
      Object.entries(byPid).forEach(([pid,delta])=>{
        let avail=hist[+sDay-1]?.carsAvailByProduct?.[pid]||0;
        let oldAvail=avail-delta;   // the yard before the change: it moves with the loaded cars
        const yc=(DB.real_rail_daily||[]).find(rr=>rr.type==='yard_count'&&rr.date===ds&&rr.facility_id===facId
          &&(rr.product_id||'')===pid&&(!rr.dispatch_id||rr.dispatch_id===dpId));
        if(yc){
          const was=parseInt(yc.cars)||0, cars=Math.max(0,was+delta);
          if(cars!==was){ yc.cars=cars; yc.updated_at=now; changes.push(`${dp.name} ${ds.slice(5)} available ${was}→${cars}`); }
          oldAvail=was; avail=cars; // this run still used the old count
        }
        if(realDisp) return;
        const pushes=DB.rail_movements.filter(rm=>rm.from_dispatch_id===dpId&&rm.departure_date===ds
          &&(rm.product_id||'')===pid&&(rm.status||'Planned')!=='In Transit');
        const total=pushes.reduce((s,rm)=>s+(parseInt(rm.wagon_count)||0),0);
        const setCars=(rm,cars)=>{
          const was=parseInt(rm.wagon_count)||0;
          rm.wagon_count=cars;
          rm.total_capacity_t=cars*(parseFloat(rm.wagon_capacity_t)||carCap);
          changes.push(`${dp.name} ${ds.slice(5)} push to ${facName(rm.to_facility_id)} ${was}→${cars}`);
        };
        if(delta<0){
          // What each push was shipping before the change (in order, until the yard ran out).
          let rem=oldAvail;
          const shipping=pushes.map(rm=>{ const c=Math.max(0,Math.min(parseInt(rm.wagon_count)||0,rem)); rem-=c; return c; });
          let cut=Math.min(total,oldAvail)-Math.min(total,avail);
          for(let i=pushes.length-1;i>=0&&cut>0;i--){
            const take=Math.min(shipping[i],cut);
            if(!take) continue;
            const rm=pushes[i];
            rm.sync_trimmed=(parseInt(rm.sync_trimmed)||0)+take;
            setCars(rm,(parseInt(rm.wagon_count)||0)-take); cut-=take;
          }
        }else{
          // Cars back: return what this sync took, in shipping order, up to the cars added.
          let give=delta;
          for(let i=0;i<pushes.length&&give>0;i++){
            const rm=pushes[i], owed=parseInt(rm.sync_trimmed)||0, g=Math.min(owed,give);
            if(!g) continue;
            if(owed>g) rm.sync_trimmed=owed-g; else delete rm.sync_trimmed;
            setCars(rm,(parseInt(rm.wagon_count)||0)+g); give-=g;
          }
        }
      });
    });
  });
  if(!changes.length) return;
  autoSave();
  statMsg(`Rail Schedule updated to the loading change: ${changes.join(' · ')} — running simulation…`);
  scheduleSimulation();
}

// Save one typed cell from the Supply page's Rail Car Loading row. A typed number becomes a
// ONE-DAY loading campaign for that dispatch point + product, appended after any broader
// campaign so it wins for that day only (railPlanRate: last dated match wins) and the rest of
// the campaign survives untouched. Clearing the cell removes the day override and lets the
// underlying campaign / base rate take over again; typing 0 is an explicit "load nothing".
function saveRailLoadCell(inp){
  if(!inp) return;
  const dpId=inp.dataset.dp, ds=inp.dataset.date, pid=inp.dataset.pid;
  if(!dpId||!ds||!pid) return;
  if(!DB.rail_loading_plan) DB.rail_loading_plan=[];
  _railLoadingEdited([dpId],[ds]);
  const raw=(inp.value||'').trim();
  // Drop any existing single-day override for this dp+product+day before writing the new one.
  DB.rail_loading_plan=DB.rail_loading_plan.filter(p=>!(p.dispatch_id===dpId&&p.product_id===pid
    &&p.date_from===ds&&p.date_to===ds));
  if(raw!==''){
    const cars=Math.max(0,parseFloat(raw)||0);
    DB.rail_loading_plan.push({id:'lp_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
      dispatch_id:dpId,product_id:pid,cars_per_day:cars,date_from:ds,date_to:ds});
  }
  autoSave();
  _railRefreshViews();
  scheduleSimulation();
}
// The facility a rail dispatch point belongs to (real_rail_daily rows are keyed by facility).
function _railDpFacId(dp){ return dp?.assigned_facility_id||dp?.facility_id||S.facility_id; }
// The facility a rail movement leaves from: its dispatch point's facility when it names one, else
// the stored from_facility_id (a manual movement carries no dispatch point). Pushes used to store
// the canvas facility for EVERY dispatch point — a CLI push read BRS — so read the origin through
// here rather than from from_facility_id directly.
function _railMoveOriginFacId(rm){
  const dp=rm&&rm.from_dispatch_id?getEl(rm.from_dispatch_id):null;
  return dp?_railDpFacId(dp):rm?.from_facility_id;
}
// Does rail movement rm ship from dispatch point dp (destIds = the terminals dp serves)? A movement
// that names its dispatch point belongs to that one only; one that names none (a manual entry)
// belongs to the dispatch points at its origin facility serving its terminal. Matching "canvas
// facility + terminal served" handed every push to EVERY dispatch point serving that terminal —
// BRS, CLI and Bowen pushes to SUT each ran at all three, which shipped nothing and logged
// phantom shortfalls (and would double-ship where two dispatch points load the same product).
function _railMoveFromDp(rm,dp,destIds){
  if(rm.from_dispatch_id) return rm.from_dispatch_id===dp.id;
  return rm.from_facility_id===_railDpFacId(dp)&&destIds.has(rm.to_facility_id);
}
// Corrects stored origins written the old way to their dispatch point's facility, so exports and
// anything still reading the raw field agree. Returns how many rows changed.
function _railHealOrigins(){
  let n=0;
  (DB.rail_movements||[]).forEach(rm=>{
    if(!rm.from_dispatch_id) return;
    const f=_railMoveOriginFacId(rm);
    if(f&&rm.from_facility_id!==f){ rm.from_facility_id=f; n++; }
  });
  return n;
}

// ── Rail loading campaign popup ──────────────────────────────────────────────
// Mirrors showCampaignPopup (finish mills) but the rate is CARS/DAY. Forecast mode
// saves a dated DB.rail_loading_plan row (the campaign); Real mode saves the actual
// cars loaded for one day into DB.real_rail_daily (same store as the Daily Data form).
function showRailCampaignPopup(dpId, dateStr, runStart, runEnd, runProduct){
  const dp=getEl(dpId); if(!dp) return;
  const prods=railDpProducts(dp);
  if(!prods.length){ statMsg('No rail products configured for this dispatch point'); return; }
  const facId=_railDpFacId(dp);
  const stdRate=_railCarsPerDay(dp);
  const existingReal=(DB.real_rail_daily||[]).filter(rr=>rr.date===dateStr&&rr.facility_id===facId&&rr.type==='loading');
  const defaultMode=existingReal.length?'real':'forecast';
  const selProd=(defaultMode==='real'&&existingReal[0]?.product_id)||runProduct||prods[0];
  const existing=_railActivePlan(dpId, selProd, dateStr);
  window._railCampHasExisting=!!existing;
  const prodOpts=prods.map(pid=>{ const p=DB.products.find(x=>x.id===pid);
    const base=railPlanRate(dpId,pid,null)||stdRate;
    return `<option value="${pid}" data-rate="${base}" ${selProd===pid?'selected':''}>${p?.name||pid}</option>`; }).join('');
  const currentRate=existing?(parseFloat(existing.cars_per_day)||0):(railPlanRate(dpId,selProd,dateStr)||railPlanRate(dpId,selProd,null)||stdRate);
  // Always prefill "From" with the clicked day, not the campaign/run's original start —
  // see showCampaignPopup for why (same fix, same reasoning).
  const fromVal=dateStr;
  const toVal=existing?.date_to||runEnd||dateStr;
  const realVal=existingReal.find(rr=>rr.product_id===selProd)?.cars ?? existingReal[0]?.cars ?? '';
  const initVal=defaultMode==='real'?realVal:currentRate;

  const html=`
  <div style="font-family:var(--mono);font-size:9px;min-width:320px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div>
        <div id="camp-title" style="font-size:11px;font-weight:700;color:${existing?'var(--lime)':'var(--text)'}">
          ${existing?'🔒 Edit Loading Campaign':'+ New Loading Campaign'}
        </div>
        <div style="color:var(--text-dim);margin-top:2px">${esc(dp.name)} · ${dateStr}</div>
      </div>
      <button onclick="closeCampaignPopup()" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:16px">✕</button>
    </div>

    <!-- Forecast vs Real toggle -->
    <div style="display:flex;gap:0;margin-bottom:12px;border:1px solid var(--border2);border-radius:3px;overflow:hidden">
      <button type="button" id="camp-mode-forecast" onclick="_railCampSetMode('forecast')"
        style="flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer">📈 Loading Campaign</button>
      <button type="button" id="camp-mode-real" onclick="_railCampSetMode('real')"
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
          <div class="fl" id="camp-rate-label">Cars per day</div>
          <input class="fi" id="camp-rate" type="number" value="${initVal}" min="0" step="1" style="width:100%">
        </div>
        <div id="camp-rate-hint" style="font-size:8px;color:var(--text-dim);align-self:flex-end;padding-bottom:6px">max ${stdRate} cars/d</div>
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
        <span id="camp-del-wrap">${existing?`<button onclick="_railDeletePlanRow('${existing.id}')"
          style="padding:5px 10px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid rgba(var(--red-rgb),.5);color:var(--red);cursor:pointer;border-radius:2px">
          ✕ Delete Campaign</button>`:''}</span>
        <span id="camp-clear-real-wrap" style="display:none">${existingReal.length?`<button onclick="_railCampClearReal('${dpId}','${dateStr}')"
          style="padding:5px 10px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid rgba(var(--red-rgb),.5);color:var(--red);cursor:pointer;border-radius:2px">
          ✕ Clear Real Value</button>`:''}</span>
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="closeCampaignPopup()" style="padding:5px 12px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--border2);color:var(--text-dim);cursor:pointer;border-radius:2px">Cancel</button>
        <button id="camp-apply-btn" onclick="applyRailCampaign('${dpId}')" style="padding:5px 14px;font-family:var(--mono);font-size:9px;background:var(--lime);border:none;color:var(--on-lime);cursor:pointer;font-weight:700;border-radius:2px">🔒 Apply Campaign</button>
      </div>
    </div>
  </div>`;

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
  _railCampSetMode(defaultMode);
}

// Toggle the rail popup between Forecast (date-range campaign) and Real (single-day actual).
function _railCampSetMode(mode){
  window._campMode=mode;
  const real=mode==='real';
  const fBtn=document.getElementById('camp-mode-forecast');
  const rBtn=document.getElementById('camp-mode-real');
  const onSty='background:var(--lime);color:var(--on-lime);font-weight:700';
  const offSty='background:transparent;color:var(--text-dim);font-weight:400';
  if(fBtn) fBtn.style.cssText='flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer;'+(real?offSty:onSty);
  if(rBtn) rBtn.style.cssText='flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer;'+(real?onSty:offSty);
  const toField=document.getElementById('camp-to-field'); if(toField) toField.style.display=real?'none':'';
  const fromLbl=document.getElementById('camp-from-label'); if(fromLbl) fromLbl.textContent=real?'Date':'From';
  const rateLbl=document.getElementById('camp-rate-label'); if(rateLbl) rateLbl.textContent=real?'Actual cars loaded':'Cars per day';
  const rateHint=document.getElementById('camp-rate-hint'); if(rateHint) rateHint.style.display=real?'none':'';
  const title=document.getElementById('camp-title'); if(title) title.textContent=real?'✅ Real Rail Loading':(window._railCampHasExisting?'🔒 Edit Loading Campaign':'+ New Loading Campaign');
  const apply=document.getElementById('camp-apply-btn');
  if(apply){ apply.textContent=real?'✅ Save Real Value':'🔒 Apply Campaign'; apply.style.background=real?'var(--royal)':'var(--lime)'; apply.style.color=real?'#fff':'var(--on-lime)'; }
  const delW=document.getElementById('camp-del-wrap'); if(delW) delW.style.display=real?'none':'';
  const clrW=document.getElementById('camp-clear-real-wrap'); if(clrW) clrW.style.display=real?'':'none';
}

// Re-render whichever view the rail popup was opened from. It is reachable from the Supply
// page's RAIL LOADING gantt and from the Rail Schedule's "Loaded (cars/d)" row, and both
// read the same rail_loading_plan / real_rail_daily rows — so refresh the one on screen
// (runSimulation refreshes it again with the new numbers once the re-run finishes).
function _railRefreshViews(){
  if(S.view==='supply') renderSupplyView();
  else if(S.view==='schedules'&&S.activeSchedTab==='rail'&&typeof rpRender==='function') rpRender();
  else renderSupplyView();
}

// Save the rail popup: Real mode → real_rail_daily (one day); Forecast → dated rail_loading_plan row.
function applyRailCampaign(dpId){
  const pid=document.getElementById('camp-product')?.value;
  const cars=Math.max(0,parseFloat(document.getElementById('camp-rate')?.value)||0);
  const fromDate=document.getElementById('camp-from')?.value;
  const toDate=document.getElementById('camp-to')?.value;

  if(window._campMode==='real'){
    if(!pid||!fromDate){ statMsg('Please choose a product and date'); return; }
    const facId=_railDpFacId(getEl(dpId));
    const now=new Date().toISOString();
    if(!DB.real_rail_daily) DB.real_rail_daily=[];
    _railLoadingEdited(_railDpsOfFac(facId),[fromDate]); // real loading counts for every rail dp of the facility
    const ex=DB.real_rail_daily.find(rr=>rr.date===fromDate&&rr.facility_id===facId&&rr.product_id===pid&&rr.type==='loading');
    if(ex){ ex.cars=cars; ex.updated_at=now; }
    else DB.real_rail_daily.push({date:fromDate,facility_id:facId,product_id:pid,type:'loading',cars,source:'actual',created_at:now,updated_at:now});
    closeCampaignPopup();
    autoSave();
    _demandCacheInvalidate();
    _railRefreshViews();
    statMsg('Real rail loading saved — running simulation…');
    scheduleSimulation();
    return;
  }

  if(!pid||!fromDate||!toDate){ statMsg('Please fill all fields'); return; }
  if(fromDate>toDate){ statMsg('From date must be before To date'); return; }
  if(!DB.rail_loading_plan) DB.rail_loading_plan=[];
  // Overlapping campaigns are replaced whole, so their days change too — not just [from, to].
  { let lo=fromDate, hi=toDate;
    DB.rail_loading_plan.forEach(p=>{
      if(p.dispatch_id!==dpId||p.product_id!==pid||(!p.date_from&&!p.date_to)) return;
      const f=p.date_from||S.simCfg.start_date, t=p.date_to||rpDayDate(_simEffectiveHorizon());
      if(t<fromDate||f>toDate) return;
      if(f<lo) lo=f; if(t>hi) hi=t;
    });
    _railLoadingEdited([dpId],_railDateRange(lo<S.simCfg.start_date?S.simCfg.start_date:lo,hi)); }
  // Replace any overlapping campaigns (dated rows) for this dispatch point + product.
  DB.rail_loading_plan=DB.rail_loading_plan.filter(p=>{
    if(p.dispatch_id!==dpId||p.product_id!==pid||(!p.date_from&&!p.date_to)) return true;
    const f=p.date_from||'0000-01-01', t=p.date_to||'9999-12-31';
    return t<fromDate||f>toDate;
  });
  DB.rail_loading_plan.push({id:'lp_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
    dispatch_id:dpId,product_id:pid,cars_per_day:cars,date_from:fromDate,date_to:toDate});
  closeCampaignPopup();
  autoSave();
  _railRefreshViews();
  statMsg('Loading campaign saved — running simulation…');
  scheduleSimulation();
}

// Delete a loading campaign (dated plan row) from the popup.
function _railDeletePlanRow(rowId){
  if(!confirm('Delete this loading campaign?\nLoading falls back to the base rate (if any) for these days.')) return;
  const _row=(DB.rail_loading_plan||[]).find(p=>p.id===rowId);
  if(_row){ const f=_row.date_from||S.simCfg.start_date, t=_row.date_to||rpDayDate(_simEffectiveHorizon());
    _railLoadingEdited([_row.dispatch_id],_railDateRange(f<S.simCfg.start_date?S.simCfg.start_date:f,t)); }
  DB.rail_loading_plan=(DB.rail_loading_plan||[]).filter(p=>p.id!==rowId);
  closeCampaignPopup();
  autoSave();
  _railRefreshViews();
  statMsg('Loading campaign deleted — running simulation…');
  scheduleSimulation();
}

// Remove the real cars-loaded entry for one day (all products), then re-run.
function _railCampClearReal(dpId, dateStr){
  if(!confirm(`Clear real rail loading for ${dateStr}?\nSimulation will resume the loading plan for this day.`)) return;
  const facId=_railDpFacId(getEl(dpId));
  _railLoadingEdited(_railDpsOfFac(facId),[dateStr]);
  DB.real_rail_daily=(DB.real_rail_daily||[]).filter(rr=>!(rr.date===dateStr&&rr.facility_id===facId&&rr.type==='loading'));
  closeCampaignPopup();
  autoSave();
  _demandCacheInvalidate();
  _railRefreshViews();
  statMsg('Real rail loading cleared — running simulation…');
  scheduleSimulation();
}
// ── Rail yard reconciliation popup (terminal side) ───────────────────────────
// Launch reconciliation: set the PHYSICAL car count at the rail yard and/or the local
// yard on a date (absolute, per product). These override the simulation from that day —
// reality wins — and are what lets you seed cars that predate the system (never dispatched
// through the plan). Stored in real_rail_daily as 'railyard_count' / 'localyard_count'.
// The optional "spotted" field still records a rail-yard→local-yard move ('placed').
function showRailPlacementPopup(facId, pid, ds){
  const fac=DB.facilities.find(f=>f.id===facId);
  const prod=DB.products.find(p=>p.id===pid);
  const railBerths=(DB.elements||[]).filter(e=>e.type==='berth'&&(e.props?.berth_type||'')==='Rail Receiving'
    &&(e.assigned_facility_id||e.facility_id)===facId);
  if(!railBerths.length) return;
  const carCap=parseFloat(railBerths[0].props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
  const r=S.simResults;
  const di=Math.round((new Date(ds+'T00:00:00')-new Date(S.simCfg.start_date+'T00:00:00'))/864e5);
  const sumAt=hist=>railBerths.reduce((s,b)=>s+(((r?.[hist]?.[b.id]||[])[di]||{})[pid]||0),0);
  const transCars=Math.round(sumAt('railTransitHistory')/carCap);
  const atYardCars=Math.round(sumAt('railAtRailyardHistory')/carCap);
  const yardCars=Math.round(sumAt('railYardHistory')/carCap);
  const findRec=t=>(DB.real_rail_daily||[]).find(rr=>rr.type===t&&rr.date===ds&&rr.facility_id===facId&&(rr.product_id||'')===pid);
  const ryRec=findRec('railyard_count'), lyRec=findRec('localyard_count'), spotRec=findRec('placed');
  const anyReal=!!(ryRec||lyRec);
  const _inp=(id,val)=>`<input class="fi" id="${id}" type="number" min="0" step="1" value="${val!=null?(parseInt(val.cars)||0):''}" placeholder="—" style="width:70px">`;
  const html=`
  <div style="font-family:var(--mono);font-size:9px;min-width:320px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div>
        <div style="font-size:11px;font-weight:700;color:${anyReal?'var(--teal)':'var(--text)'}">🛤 Reconcile Rail Yard</div>
        <div style="color:var(--text-dim);margin-top:2px">${fac?.name||facId} · ${prod?.name||pid} · ${ds}</div>
      </div>
      <button onclick="closeCampaignPopup()" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:16px">✕</button>
    </div>
    <div style="display:flex;gap:12px;margin-bottom:10px;color:var(--text-dim);flex-wrap:wrap">
      <span>⇢ In transit: <b style="color:var(--purple)">${transCars}</b></span>
      <span>▤ Rail yard: <b style="color:var(--tangerine)">${atYardCars}</b></span>
      <span>▣ Local yard: <b style="color:var(--sky)">${yardCars}</b></span>
      <span style="opacity:.6">(cars now, simulated)</span>
    </div>
    <div style="font-size:8px;color:var(--text-dim);margin-bottom:8px;line-height:1.5;border-left:2px solid var(--sky);padding-left:8px">
      Physical count = the cars actually sitting there at the <b>start of this day</b>. It overrides the
      plan from here on (reality wins) and is how you seed cars that were never dispatched through the
      system. Leave blank to keep the simulation.
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="fr s2" style="align-items:center">
        <div class="fl" style="flex:1">▤ Physical count — rail yard</div>
        ${_inp('railpl-ryc',ryRec)}<span style="opacity:.5;margin-left:4px">cars</span>
      </div>
      <div class="fr s2" style="align-items:center">
        <div class="fl" style="flex:1">▣ Physical count — local yard</div>
        ${_inp('railpl-lyc',lyRec)}<span style="opacity:.5;margin-left:4px">cars</span>
      </div>
      <div class="fr s2" style="align-items:center;border-top:1px solid var(--border2);padding-top:8px">
        <div class="fl" style="flex:1">↳ spotted rail→local today <span style="opacity:.5">(optional flow)</span></div>
        ${_inp('railpl-spot',spotRec)}<span style="opacity:.5;margin-left:4px">cars</span>
      </div>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;justify-content:space-between;align-items:center">
      <span>${(ryRec||lyRec||spotRec)?`<button onclick="_railClearPlacement('${facId}','${pid}','${ds}')"
        style="padding:5px 10px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid rgba(var(--red-rgb),.5);color:var(--red);cursor:pointer;border-radius:2px">✕ Clear All</button>`:''}</span>
      <div style="display:flex;gap:6px">
        <button onclick="closeCampaignPopup()" style="padding:5px 12px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--border2);color:var(--text-dim);cursor:pointer;border-radius:2px">Cancel</button>
        <button onclick="_railSavePlacement('${facId}','${pid}','${ds}')" style="padding:5px 14px;font-family:var(--mono);font-size:9px;background:var(--teal);border:none;color:var(--on-lime);cursor:pointer;font-weight:700;border-radius:2px">✅ Save</button>
      </div>
    </div>
  </div>`;
  let ov=document.getElementById('camp-overlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='camp-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:20000;display:flex;align-items:center;justify-content:center';
    ov.onclick=e=>{ if(e.target===ov) closeCampaignPopup(); };
    document.body.appendChild(ov);
  }
  ov.innerHTML=`<div style="background:var(--surface);border:1px solid var(--sky);padding:18px;border-radius:6px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.6)">${html}</div>`;
  ov.style.display='flex';
}
// Upsert (non-blank) or remove (blank) a real_rail_daily row of the given type for this stage.
function _railUpsertRec(type, facId, pid, ds, val){
  if(!DB.real_rail_daily) DB.real_rail_daily=[];
  DB.real_rail_daily=DB.real_rail_daily.filter(rr=>!(rr.type===type&&rr.date===ds&&rr.facility_id===facId&&(rr.product_id||'')===pid));
  if(val!==''&&val!=null){ const now=new Date().toISOString();
    DB.real_rail_daily.push({date:ds,facility_id:facId,product_id:pid,type,cars:Math.max(0,parseInt(val)||0),source:'actual',created_at:now,updated_at:now}); }
}
function _railSavePlacement(facId, pid, ds){
  _railUpsertRec('railyard_count',facId,pid,ds,document.getElementById('railpl-ryc')?.value);
  _railUpsertRec('localyard_count',facId,pid,ds,document.getElementById('railpl-lyc')?.value);
  _railUpsertRec('placed',facId,pid,ds,document.getElementById('railpl-spot')?.value);
  closeCampaignPopup();
  autoSave();
  _railRefreshViews();
  statMsg('Rail yard reconciled — running simulation…');
  scheduleSimulation();
}
function _railClearPlacement(facId, pid, ds){
  DB.real_rail_daily=(DB.real_rail_daily||[]).filter(rr=>!(['railyard_count','localyard_count','placed'].includes(rr.type)&&rr.date===ds&&rr.facility_id===facId&&(rr.product_id||'')===pid));
  closeCampaignPopup();
  autoSave();
  _railRefreshViews();
  statMsg('Rail yard records cleared — running simulation…');
  scheduleSimulation();
}

// Operator "push": set how many cars of a product go from a dispatch point to a terminal on a
// switch day. Upserts a Confirmed rail_movement (or removes it when 0). With skipRun=true it only
// mutates DB (caller saves + re-runs once); otherwise it saves + re-runs immediately.
function _rpSetPush(dpId, destFacId, pid, dayNum, ds, value, skipRun){
  const cars=Math.max(0,parseInt(value)||0);
  const dp=DB.elements.find(e=>e.id===dpId);
  const carCap=parseFloat(dp?.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
  const destCfg=(dp?.props?.destinations||[]).find(x=>x.facility_id===destFacId);
  const transit=parseInt(destCfg?.transit_days)||1;
  const berth=DB.elements.find(e=>e.type==='berth'&&(e.props?.berth_type||'').includes('Rail')&&(e.assigned_facility_id||e.facility_id)===destFacId);
  const berthId=berth?berth.id:null;
  const fromFacId=_railDpFacId(dp);   // the dispatch point's own facility, not the canvas facility
  // Match by DEPARTURE DATE (day numbers drift when the sim start date moves); legacy
  // rows without a departure_date still match by switch_day.
  let row=DB.rail_movements.find(rm=>rm.from_dispatch_id===dpId&&rm.to_facility_id===destFacId&&(rm.product_id||'')===pid
    &&(rm.departure_date?rm.departure_date===ds:rm.switch_day===dayNum));
  // A confirmed 0 is a DECISION ("send nothing here this switch"), not the absence of one,
  // so it is stored as a 0-car Confirmed row rather than by deleting the movement. Deleting
  // it made existingPush() find nothing on the next render, which fell back to the suggested
  // split — so the cell sprang back to the proposed number while the simulation shipped
  // nothing. The simulation ignores a 0-car push (cars>0 guard in the switch-day shipping
  // step), so the row is inert; delete it from the Rail movement records table to clear it.
  if(cars<=0&&!row){
    DB.rail_movements.push({id:'push_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),from_facility_id:fromFacId,to_facility_id:destFacId,from_dispatch_id:dpId,to_berth_id:berthId,product_id:pid,wagon_count:0,wagon_capacity_t:carCap,total_capacity_t:0,switch_day:dayNum,departure_date:ds,transit_days:transit,status:'Confirmed',notes:'Operator push — nothing to this terminal'});
  }
  // transit_days is refreshed too: a row saved before the destination's transit changed kept
  // the old value, and the simulation dates the arrival from the row, not the topology.
  else if(row){ delete row.sync_trimmed; row.from_facility_id=fromFacId; row.wagon_count=cars; row.wagon_capacity_t=carCap; row.total_capacity_t=cars*carCap; row.status='Confirmed'; row.switch_day=dayNum; row.departure_date=ds; row.transit_days=transit; if(!row.to_berth_id) row.to_berth_id=berthId;
    if(cars<=0&&!/nothing to this terminal/.test(row.notes||'')) row.notes='Operator push — nothing to this terminal';
    else if(cars>0&&/nothing to this terminal/.test(row.notes||'')) row.notes='Operator push'; }
  else DB.rail_movements.push({id:'push_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),from_facility_id:fromFacId,to_facility_id:destFacId,from_dispatch_id:dpId,to_berth_id:berthId,product_id:pid,wagon_count:cars,wagon_capacity_t:carCap,total_capacity_t:cars*carCap,switch_day:dayNum,departure_date:ds,transit_days:transit,status:'Confirmed',notes:'Operator push'});
  if(!skipRun){ autoSave(); scheduleSimulation(); }
}
// Record the REAL cars dispatched from a rail dp to one terminal on a (past) switch date.
// Stored in real_rail_daily as type 'dispatched' (dest-tagged); coexists with the planned
// movement so plan vs real stays comparable. A 0 is a valid record ("nothing went there").
function _rpSetReal(dpId, destFacId, pid, ds, value, skipRun){
  const cars=Math.max(0,parseInt(value)||0);
  const facId=_railDpFacId(getEl(dpId));
  if(!DB.real_rail_daily) DB.real_rail_daily=[];
  const now=new Date().toISOString();
  let row=DB.real_rail_daily.find(rr=>rr.type==='dispatched'&&rr.date===ds&&rr.facility_id===facId
    &&rr.dest_facility_id===destFacId&&(rr.product_id||'')===pid);
  if(row){ row.cars=cars; row.updated_at=now; }
  else DB.real_rail_daily.push({date:ds,facility_id:facId,dest_facility_id:destFacId,product_id:pid,type:'dispatched',cars,source:'actual',created_at:now,updated_at:now});
  if(!skipRun){ autoSave(); scheduleSimulation(); }
}

// ── Backward rail planning ───────────────────────────────────────────────────
// Typed into a terminal's PULLED TO LOCAL YARD cell: how many cars of a product the user
// wants pulled on that pull day. A car is pulled on that day only if it reaches the rail
// yard AFTER the previous pull day and no later than this one, so each origin's departure
// window is that arrival window minus its transit days, limited to its switch days that are
// still ahead (today included). The target is met with that origin's confirmed pushes to
// this terminal — the very rows the ORIGINS push cells edit, so both directions share one
// plan — latest departure first (least waiting at the rail yard). An earlier departure only
// takes cars the later one doesn't have (a yard count can reset the yard in between).
// Whatever the origin cannot supply still goes on the latest departure: the switch guard
// flags it red at the origin and the destination cell shows the shortfall after the run.

// Departure windows for pull day `pullDay` — one entry per origin that loads the product;
// `all` / `cand` hold departure days latest first, `cand` only those still ahead.
function _rpBackwardWindows(destFacId,pid,pullDay){
  const pulls=railTerminalPulls(destFacId);
  const P=pulls.prevPullDay(pullDay), today=todayDayOffset();
  return rpGetOriginsForDest(destFacId).filter(o=>railDpProducts(o.dp).includes(pid)).map(o=>{
    const transit=parseInt(o.destCfg?.transit_days)||1, sw=o.dp.props?.switch_days||[];
    const all=[];
    for(let D=pullDay-transit;D>=P+1-transit;D--) if(D>=1&&rpIsSwitch(D,sw)) all.push(D);
    return {o,transit,all,cand:all.filter(D=>D>=today)};
  });
}
// Plan `want` cars of `pid` pulled at `destFacId` on `pullDay`.
// Returns {error} or {writes:[{dp,day,ds,cars}], msg, short}.
function _rpBackwardPlan(destFacId,pid,pullDay,want){
  const pulls=railTerminalPulls(destFacId);
  const facNm=DB.facilities.find(f=>f.id===destFacId)?.name||destFacId;
  const pNm=DB.products.find(p=>p.id===pid)?.name||pid;
  const dayLbl=d=>`${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][_rpDow(d)]} ${rpDayDate(d).slice(5)}`;
  const oNm=o=>DB.facilities.find(f=>f.id===_railDpFacId(o.dp))?.name||o.dp.name;
  const today=todayDayOffset();
  if(pullDay<today) return {error:`${dayLbl(pullDay)} is already past — record what happened instead.`};
  const wins=_rpBackwardWindows(destFacId,pid,pullDay);
  if(!wins.length) return {error:`No rail dispatch point loads ${pNm} for ${facNm}.`};
  const usable=wins.filter(w=>w.cand.length);
  if(!usable.length){
    const why=wins.map(w=>w.all.length
      ?`${oNm(w.o)} would have to leave ${w.all.map(dayLbl).join(' or ')}, already past`
      :`no ${oNm(w.o)} switch day lands it in that window (${w.transit} d transit)`).join('; ');
    const horizon=S.simResults?.simHorizon||S.simCfg.horizon||365;
    let near=null;
    for(let k=1;k<=60&&near===null;k++) for(const d2 of [pullDay+k,pullDay-k]){
      if(d2<today||d2>horizon||!pulls.isPullDay(d2)) continue;
      if(_rpBackwardWindows(destFacId,pid,d2).some(w=>w.cand.length)){ near=d2; break; }
    }
    return {error:`Can't plan ${pNm} for ${dayLbl(pullDay)} at ${facNm}: ${why}.`+(near!==null?` Nearest pull you can still reach: ${dayLbl(near)}.`:'')};
  }
  // More than one origin can reach it: use the one with the most cars at its latest departure.
  const win=usable.length===1?usable[0]
    :usable.map(w=>({w,free:_rpAvailAtSwitch(w.o.dp,pid,w.cand[0])})).sort((a,b)=>b.free-a.free)[0].w;
  const {o,cand}=win, dp=o.dp;
  const P=pulls.prevPullDay(pullDay);
  const cars=t=>Math.round((t||0)/pulls.carCap);
  const dayOfDs=ds=>Math.round((new Date(ds+'T00:00:00')-new Date(S.simCfg.start_date+'T00:00:00'))/864e5)+1;
  const depOf=rm=>rm.departure_date?dayOfDs(rm.departure_date):(parseInt(rm.switch_day)||0);
  const inWin=a=>a>P&&a<=pullDay;

  // This origin's pushes to this terminal still ahead — the part of the plan we re-shape.
  const mine=DB.rail_movements.filter(rm=>rm.from_dispatch_id===dp.id&&rm.to_facility_id===destFacId&&(rm.product_id||'')===pid)
    .map(rm=>{ const dep=depOf(rm); return {rm,dep,arr:dep+(parseInt(rm.transit_days)||1)}; })
    .filter(x=>x.dep>=today);
  const editable=mine.filter(x=>inWin(x.arr)||cand.includes(x.dep));
  const editInWinT=editable.filter(x=>inWin(x.arr)).reduce((s,x)=>s+(parseFloat(x.rm.total_capacity_t)||0),0);

  // What is pulled that day regardless: other arrivals in the window (real dispatches, other
  // origins, departures already past) + yard-count / placed adjustments the simulation applied.
  const arr=rpPlannedArrivalsForDest(destFacId,null,{allProducts:true});
  let planWinT=0, simArrT=0;
  for(let a=P+1;a<=pullDay;a++){
    (arr[a]||[]).forEach(e=>{ if(!e.unmatched&&e.productId===pid) planWinT+=e.tonnes; });
    simArrT+=pulls.arrivedT(pid,a);
  }
  const adjT=pulls.hasSim?(pulls.pulledT(pid,pullDay)-simArrT):0;
  const alreadyCars=Math.max(0,cars(planWinT-editInWinT+adjT));
  const need=Math.max(0,want-alreadyCars);

  // Cars free at departure D: the simulation's yard before shipping, minus pushes from this
  // origin to OTHER terminals that day, plus this terminal's pushes at earlier departures in
  // the window (they left the yard before D in the current plan and are being re-planned).
  // A real yard count SETS the yard, so nothing carries across one: add-backs stop at the
  // latest count, and cars counted after a departure are not the cars it could have taken.
  const pushedAt=(D,toThis)=>DB.rail_movements.filter(rm=>rm.from_dispatch_id===dp.id&&(rm.product_id||'')===pid
    &&(toThis?rm.to_facility_id===destFacId:rm.to_facility_id!==destFacId)&&depOf(rm)===D)
    .reduce((s,rm)=>s+(parseInt(rm.wagon_count)||0),0);
  const countDays=(DB.real_rail_daily||[]).filter(rr=>rr.type==='yard_count'&&rr.date&&rr.facility_id===_railDpFacId(dp)
    &&(rr.product_id||'')===pid&&(!rr.dispatch_id||rr.dispatch_id===dp.id)).map(rr=>dayOfDs(rr.date));
  const lastCount=D=>countDays.reduce((x,c)=>c<=D&&c>x?c:x,0);
  const freeAt=D=>{
    const X=lastCount(D);
    let f=_rpAvailAtSwitch(dp,pid,D)-pushedAt(D,false);
    cand.filter(D2=>D2<D&&D2>=X).forEach(D2=>{ f+=Math.min(pushedAt(D2,true),_rpAvailAtSwitch(dp,pid,D2)); });
    return Math.max(0,f);
  };
  const alloc={}; let rem=need, taken=0, later=null;
  cand.forEach(D=>{   // latest first
    if(later!==null&&lastCount(later)>D) taken=0;   // a count in between: separate pools of cars
    const a=Math.min(rem,Math.max(0,freeAt(D)-taken)); alloc[D]=a; rem-=a; taken+=a; later=D;
  });
  const short=rem;
  if(short>0) alloc[cand[0]]+=short;

  const writes=[];
  cand.forEach(D=>{ if(alloc[D]>0||mine.some(x=>x.dep===D)) writes.push({dp,day:D,ds:rpDayDate(D),cars:alloc[D]}); });
  // Pushes landing in this window from a departure that is no longer a candidate (saved with an
  // old transit, say) are part of the target being replaced — zero them.
  editable.filter(x=>!cand.includes(x.dep)).forEach(x=>writes.push({dp,day:x.dep,ds:rpDayDate(x.dep),cars:0}));

  const legs=cand.filter(D=>alloc[D]>0).map(D=>`${dayLbl(D)} (${alloc[D]})`);
  let msg=`${facNm} · ${pNm}: ${want} car${want===1?'':'s'} pulled ${dayLbl(pullDay)} → `
    +(legs.length?`leave ${oNm(o)} ${legs.slice().reverse().join(' + ')}`:`nothing more to send from ${oNm(o)}`);
  if(alreadyCars>0) msg+=` · ${alreadyCars} already arriving or counted in that window`;
  if(short>0){
    const D0=cand[0], avail0=_rpAvailAtSwitch(dp,pid,D0), others0=pushedAt(D0,false);
    msg+=` · ⚠ ${oNm(o)} is ${short} car${short===1?'':'s'} short: ${dayLbl(D0)} has ${avail0} in the yard`
      +(others0?`, ${others0} already pushed to other terminals`:'')
      +` — load more, or lower another terminal's push (the switch is flagged red)`;
  }
  return {writes,msg,short};
}
// Origin switches the backward planner wrote this session — rpRender re-runs the availability
// guard on them, so a plan that over-allocates a switch shows red where it can be fixed.
const _rpRecheck=new Set();
// onchange of a PULLED TO LOCAL YARD input.
function _rpPullTarget(inp){
  const destFacId=inp.dataset.dest, pid=inp.dataset.pid, day=parseInt(inp.dataset.day,10);
  const want=Math.max(0,parseInt(inp.value)||0);
  const plan=_rpBackwardPlan(destFacId,pid,day,want);
  if(plan.error){ inp.value=inp.dataset.base; _rpPlanNote('⚠ '+plan.error,true); return; }
  plan.writes.forEach(w=>{
    _rpSetPush(w.dp.id,destFacId,pid,w.day,w.ds,w.cars,true);
    _rpRecheck.add(w.dp.id+'|'+w.day);   // re-flag this switch if it is now over-allocated
  });
  autoSave();
  _rpPlanNote(plan.msg,plan.short>0);
  statMsg('Rail plan updated — running simulation…');
  scheduleSimulation();
}
// The last backward-plan result — above the Rail Schedule table and above the Supply table, so
// whichever page the target was typed on, both tell the same story.
function _rpPlanNote(text,warn){
  ['rp-plan-note','sup-plan-note'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    el.className=warn?'warn':'';
    el.innerHTML=`<span style="opacity:.7">BACKWARD PLAN</span><span>${esc(text)}</span><span class="x" title="Dismiss" onclick="this.parentNode.style.display='none'">✕</span>`;
    el.style.display='flex';
  });
}
// A push cell was edited — stash the draft (survives re-renders) and recolor:
// amber = differs from what the cell showed (unsaved), else back to its natural state colour.
window._rpDrafts=window._rpDrafts||{};
function _rpDraftKey(inp){ return inp.dataset.dp+'|'+inp.dataset.sw+'|'+inp.dataset.dest+'|'+inp.dataset.pid; }
function _rpPushEdit(inp){
  const v=Math.max(0,parseInt(inp.value)||0);
  inp.classList.remove('rp-committed','rp-dirty','rp-proposed','rp-real');
  if(v!==(parseInt(inp.dataset.base)||0)){ window._rpDrafts[_rpDraftKey(inp)]=v; inp.classList.add('rp-dirty'); }
  else { delete window._rpDrafts[_rpDraftKey(inp)]; if(inp.dataset.cls) inp.classList.add(inp.dataset.cls); }
  _rpValidateSwitch(inp.dataset.dp, inp.dataset.sw);
}
// The "Available (cars @ switch)" cell was edited — record how many cars really stood in
// the yard when the railroad came. Saved as a real_rail_daily 'yard_count' row, which the
// simulation applies as that day's absolute yard value (after loading, before the switch
// allocation). Clearing the cell, or typing back the simulated number, drops the override.
// Saves straight away rather than using the push row's draft/confirm dance: this is a
// recorded fact, not a plan the manager is still shaping.
function _rpAvailEdit(inp){
  const {dp,fac,pid,ds}=inp.dataset;
  const sim=Math.max(0,parseInt(inp.dataset.sim)||0);
  const txt=String(inp.value).trim();
  const now=new Date().toISOString();
  if(!DB.real_rail_daily) DB.real_rail_daily=[];
  const had=DB.real_rail_daily.some(rr=>rr.type==='yard_count'&&rr.date===ds&&rr.facility_id===fac
    &&(rr.product_id||'')===pid&&(!rr.dispatch_id||rr.dispatch_id===dp));
  DB.real_rail_daily=DB.real_rail_daily.filter(rr=>!(rr.type==='yard_count'&&rr.date===ds&&rr.facility_id===fac
    &&(rr.product_id||'')===pid&&(!rr.dispatch_id||rr.dispatch_id===dp)));
  const cars=Math.max(0,parseInt(txt)||0);
  const clearing=txt===''||(!had&&cars===sim);
  if(!clearing) DB.real_rail_daily.push({date:ds,facility_id:fac,dispatch_id:dp,product_id:pid,
    type:'yard_count',cars,source:'actual',created_at:now,updated_at:now});
  autoSave();
  statMsg(clearing?`Yard count cleared for ${ds} — running simulation…`
                 :`Yard count set to ${cars} cars for ${ds} — running simulation…`);
  scheduleSimulation();
}

// Redistribution guard: per product, the switch total may not exceed the cars available in
// the yard at that switch (pushing LESS is fine — the rest stays behind for the next switch).
// Flags every cell of an over-allocated product red; returns false if any product is over.
function _rpValidateSwitch(dpId, sw){
  const inps=[...document.querySelectorAll(`input.rp-push-inp[data-dp="${dpId}"][data-sw="${sw}"]`)];
  const byPid={};
  inps.forEach(i=>{ (byPid[i.dataset.pid]=byPid[i.dataset.pid]||[]).push(i); });
  let ok=true;
  Object.values(byPid).forEach(list=>{
    const avail=parseInt(list[0].dataset.avail)||0;
    const tot=list.reduce((s,i)=>s+Math.max(0,parseInt(i.value)||0),0);
    const over=tot>avail;
    list.forEach(i=>i.classList.toggle('rp-over',over));
    if(over) ok=false;
  });
  return ok;
}
// Confirm every push for one switch at the given dispatch point, then save + re-run once.
// Future switch → planned (Confirmed) movements. Past switch → REAL dispatch records.
function _rpConfirmSwitch(dpId, sw){
  const inps=document.querySelectorAll(`input.rp-push-inp[data-dp="${dpId}"][data-sw="${sw}"]`);
  if(!inps.length) return;
  const ds=inps[0].dataset.ds;
  const isPast=ds<new Date()._ymd();
  if(!isPast&&!_rpValidateSwitch(dpId,sw)){
    statMsg('⚠ Push total exceeds the cars available at this switch — reduce before confirming (unsent cars stay in the yard)');
    return;
  }
  inps.forEach(inp=>{
    if(isPast) _rpSetReal(dpId, inp.dataset.dest, inp.dataset.pid, inp.dataset.ds, inp.value, true);
    else _rpSetPush(dpId, inp.dataset.dest, inp.dataset.pid, parseInt(sw,10), inp.dataset.ds, inp.value, true);
    delete window._rpDrafts[_rpDraftKey(inp)];
  });
  autoSave();
  statMsg(isPast?'Real dispatch saved — running simulation…':'Pushes confirmed — running simulation…');
  scheduleSimulation();
}
// Reset one switch's push inputs (drops drafts, no commit, no re-run): future switches go
// back to the suggested distribution, past switches back to the planned (committed) values.
function _rpResetSwitch(dpId, sw){
  const inps=document.querySelectorAll(`input.rp-push-inp[data-dp="${dpId}"][data-sw="${sw}"]`);
  if(!inps.length) return;
  const isPast=inps[0].dataset.ds<new Date()._ymd();
  inps.forEach(inp=>{
    delete window._rpDrafts[_rpDraftKey(inp)];
    inp.value=isPast?(inp.dataset.committed||0):(inp.dataset.suggest||0);
    _rpPushEdit(inp);
  });
}
// Products a rail dispatch point can load — the products held by its upstream bulk silos.
function railDpProducts(dp, connections){
  const conns=connections||DB.connections;
  const ups=conns.filter(c=>c.to_element_id===dp.id).map(c=>c.from_element_id);
  const set=new Set();
  ups.forEach(id=>{ const e=DB.elements.find(x=>x.id===id); if(e&&e.type==='bulk_silo') getSiloProducts(e).forEach(p=>set.add(p)); });
  return [...set];
}

// Allocate per-day car loading for a set of movements that all share ONE dispatch point's
// loading capacity. Movements are scheduled earliest-switch-day-first (earliest deadline
// wins capacity) and load ASAP within each [load_start_day, switch_day) working-day window,
// never pushing any day over `carsPerDay` total. Mutates each movement, setting:
//   m.placed   = { day:cars } actually loadable
//   m.unplaced = cars that physically cannot be loaded in time (over-commitment)
// Returns { byDay, overflow } where byDay[d] is the siding's TOTAL cars loaded on day d
// (<= carsPerDay) and overflow lists movements with unplaced cars.


// ── Logistics schedule trees (Rail + Vessel): collapsible groups ─────────────
// Every row carries data-rpp = the keys of the groups it sits inside; a group's header row
// also carries data-rpk = its own key. Folding flips row visibility in place — no re-render,
// so a push draft typed into a cell is not wiped — and each tree's folded set survives a
// reload. Folding is opt-in: a key that was never clicked is expanded.
//   Rail   ('rp'): 'orig' / 'dest' bands · 'o:<dp>' dispatch point · 'o:<dp>:inv' its silos ·
//                  'o:<dp>:p:<pid>' one product · 'd:<fac>' terminal · 'd:<fac>:p:<pid>' one product silo at it ·
//                  'd:<fac>:p:<pid>:dem' its demand points.
//   Vessel ('vp'): 'b:<berth>' terminal berth · 'b:<berth>:p:<pid>' one product at it.
const LOGI_TREES={
  rp:{body:'rp-rail-tbody', store:'avila_rp_collapsed'},
  vp:{body:'vp-dest-tbody', store:'avila_vp_collapsed'},
};
const _ltSets={};
function _ltCollapsed(t){
  if(!_ltSets[t]){
    let a=[]; try{ a=JSON.parse(localStorage.getItem(LOGI_TREES[t].store)||'[]'); }catch(e){}
    _ltSets[t]=new Set(Array.isArray(a)?a.filter(k=>typeof k==='string'):[]);
  }
  return _ltSets[t];
}
function _ltSave(t){
  try{ localStorage.setItem(LOGI_TREES[t].store,JSON.stringify([..._ltCollapsed(t)])); }catch(e){}
}
function _ltApply(t){
  const body=document.getElementById(LOGI_TREES[t].body); if(!body) return;
  const set=_ltCollapsed(t);
  body.querySelectorAll('tr[data-rpp]').forEach(tr=>{
    tr.style.display=tr.dataset.rpp.split(' ').some(k=>k&&set.has(k))?'none':'';
  });
  body.querySelectorAll('tr[data-rpk]').forEach(tr=>{
    const ch=tr.querySelector('.rp-chev'); if(ch) ch.textContent=set.has(tr.dataset.rpk)?'▶':'▼';
  });
}
function _ltToggle(t,key){
  const set=_ltCollapsed(t);
  set.has(key)?set.delete(key):set.add(key);
  _ltSave(t);
  _ltApply(t);
}
function _ltExpandAll(t){ _ltCollapsed(t).clear(); _ltSave(t); _ltApply(t); }
// Fold every facility-level line (rail dispatch point / terminal, vessel berth) down to its
// header — bands stay open, so what is left is the list of facilities.
function _ltCollapseAll(t){
  const set=_ltCollapsed(t);
  document.querySelectorAll(`#${LOGI_TREES[t].body} tr.rp-fac[data-rpk]`).forEach(tr=>set.add(tr.dataset.rpk));
  document.querySelectorAll(`#${LOGI_TREES[t].body} tr.rp-band[data-rpk]`).forEach(tr=>set.delete(tr.dataset.rpk));
  _ltSave(t);
  _ltApply(t);
}
// The "Element" header cell with the expand / fold-all buttons for tree `t`.
function _ltElementTh(t){
  return `<th>Element<button class="rp-mini" onclick="_ltExpandAll('${t}')" title="Expand every group">▼ all</button>`+
    `<button class="rp-mini" onclick="_ltCollapseAll('${t}')" title="Fold every facility to its header line">▶ all</button></th>`;
}
// Row builders shared by both trees. Only a row's FIRST cell depends on its place in the
// tree; planners build their data cells exactly as before.
//   months / colSet — the rendered month list and its collapsed-month Set
//   mTdSty / tdSty  — the planner's month-total cell style and day-cell style function
function _logiTreeKit(t, months, colSet, mTdSty, tdSty){
  const col=_ltCollapsed(t);
  const pName=pid=>DB.products.find(p=>p.id===pid)?.name||pid;
  const pCol=pid=>{ try{ return (typeof spProdColor==='function')?spProdColor(pName(pid),false):'var(--text)'; }catch(e){ return 'var(--text)'; } };
  return {
    pName, pCol,
    chip:pid=>`<span class="rp-chip" style="background:${pCol(pid)}"></span>`,
    meta:s=>`<span class="rp-meta">${s}</span>`,
    // <tr> for a row inside the groups `parents` (outermost first). A group header passes
    // its own `key`. Rows under an already-folded group are emitted hidden.
    tr:(cls,parents,key)=>`<tr class="${cls}" data-rpp="${parents.join(' ')}"${key?` data-rpk="${key}"`:''}${parents.some(k=>col.has(k))?' style="display:none"':''}>`,
    // Label cell at tree `depth` (16px per level). `key` makes it a fold toggle; `hue`
    // colours a section label and a leaf's guide line.
    lbl:(depth,html,o={})=>`<td class="rp-lbl"${o.key?` onclick="_ltToggle('${t}','${o.key}')"`:''}`+
      ` style="padding-left:${depth*16+8}px;--d:${depth}${o.hue?';--hue:'+o.hue:''}"${o.title?` title="${esc(o.title)}"`:''}>`+
      (o.key?`<span class="rp-chev">${col.has(o.key)?'▶':'▼'}</span>`:'')+html+`</td>`,
    // Empty data cells for a header line — keeps the month / today / weekend grid (and, with
    // `swFn`, the switch-day tint) running through it.
    blankCells:swFn=>months.map(mon=>{const isCol=colSet.has(mon.ym);
      return `<td class="logi-mcol" style="${mTdSty}"></td>`+(isCol?[]:mon.days).map(d=>{
        const tSty=tdSty(d); const sw=swFn?swFn(d):false;
        return `<td${sw?' class="tp-col-switch"':''}${tSty?` style="${tSty}"`:''}></td>`; }).join('');
    }).join(''),
  };
}
// "Mon–Fri" / "Mon · Wed · Fri" from a Mon=0..Sun=6 switch-day list.
function _rpDowList(days){
  const N=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const s=[...new Set(days||[])].filter(d=>d>=0&&d<=6).sort((a,b)=>a-b);
  if(!s.length) return 'no switch days';
  if(s.length>=3&&s[s.length-1]-s[0]===s.length-1) return N[s[0]]+'–'+N[s[s.length-1]];
  return s.map(d=>N[d]).join(' · ');
}

function _rpToggleMonth(ym){
  if(!window._rpColapsed) window._rpColapsed=new Set();
  window._rpColapsed.has(ym)?window._rpColapsed.delete(ym):window._rpColapsed.add(ym);
  rpRender();
}
function _rpToggleYear(y){ _foldMonths(window._rpColapsed,(window._rpMonths||[]).filter(m=>m.slice(0,4)===y)); rpRender(); }

// ── Main render ───────────────────────────────────────────────────
function rpRender(){
  if(!_IDX.depth) return _idxRun(()=>rpRender.apply(this,arguments)); // fast lookups for this whole block
  _syncSimToggle();
  if(!S.simCfg.start_date){
    document.getElementById('rp-rail-section').style.display='none';
    return;
  }
  const {startDay,endDay}=rpGetRange();
  const days=[];
  for(let d=startDay;d<=endDay;d++) days.push(d);

  // Lanes in view under the shared filters (rpShownDests) — and every rail destination, which
  // an origin's push rows always carry (see myDests below).
  const _shownDests=rpShownDests(), _shownDestSet=new Set(_shownDests);
  const _allRailDestIds=rpGetRailDestinations().map(f=>f.id);
  const _allowP=fltAllowedProdIds();
  const hasDests=_shownDests.length>0&&days.length>0;
  document.getElementById('rp-rail-section').style.display=hasDests?'':'none';
  document.getElementById('rp-empty').style.display=hasDests?'none':'block';
  if(!hasDests) document.getElementById('rp-empty').textContent=days.length?'No rail lanes match the current filters':'No simulated days in this time frame';
  if(!hasDests){
    rpDestroyCharts();
    document.getElementById('rp-charts-section').style.display='none';
    return;
  }
  // Rail-relevant products for the selected destinations (used to keep both the chart and the
  // destination rows focused on what actually moves by rail — no empty/non-cement berth silos).
  const _railProdSet=new Set(rpGetRailProducts(_shownDests).map(p=>p.id));
  if(typeof _demGridVal==='function') _demGridVal._cache=null; // fresh demand-page values
  rpRenderCharts();
  rpRenderExceptions();

  // ── Month grouping + summary-column styling (shared with vessel planner) ──
  const todayStr=new Date()._ymd();
  const months=(()=>{const mons=[];days.forEach(d=>{const ds=rpDayDate(d);const ym=ds.slice(0,7);if(!mons.length||mons[mons.length-1].ym!==ym){const dt=new Date(ds+'T00:00:00');mons.push({ym,label:dt.toLocaleString('en-US',{month:'short',year:'2-digit'}),days:[]});}mons[mons.length-1].days.push(d);});return mons;})();
  // Every month except the current one starts collapsed so the page opens compact — decided
  // once per month, the first time the time frame brings it into view.
  if(!window._rpColapsed) window._rpColapsed=new Set();
  if(!window._rpColSeen) window._rpColSeen=new Set();
  months.forEach(m=>{ if(window._rpColSeen.has(m.ym)) return; window._rpColSeen.add(m.ym);
    if(m.ym!==todayStr.slice(0,7)) window._rpColapsed.add(m.ym); });
  const _mTdSty='background:var(--total-faint);border-left:2px solid var(--border2);font-weight:700;color:var(--total);text-align:right;padding:3px 8px;';
  const _tpTdSty=d=>{
    if(rpDayDate(d)===todayStr) return 'border-left:2px solid var(--green);border-right:2px solid var(--green);';
    if(rpIsSat(d)) return 'border-left:2px solid rgba(var(--red-rgb),.3);background:rgba(var(--red-rgb),.04)';
    if(rpIsSun(d)) return 'border-right:2px solid rgba(var(--red-rgb),.3);background:rgba(var(--red-rgb),.04)';
    return '';
  };

  // ── Build column headers (month summary col + day cols) ──
  const thHtml=_ltElementTh('rp')+months.map(mon=>{const isCol=window._rpColapsed.has(mon.ym);
    const dayThs=(isCol?[]:mon.days).map(d=>{
      const ds=rpDayDate(d).slice(5);
      let cls='';
      if(rpIsSat(d)) cls=' class="tp-col-sat"';
      else if(rpIsSun(d)) cls=' class="tp-col-sun"';
      return `<th${cls} title="Day ${d}">${ds}</th>`;
    }).join('');
    return `<th class="logi-mcol" onclick="_rpToggleMonth('${mon.ym}')" style="cursor:pointer;user-select:none;border-left:2px solid var(--border2);color:var(--total);font-size:8px;font-weight:700;text-align:center;padding:4px 6px;position:sticky;top:0;background:var(--surface2)"><span style="margin-right:3px">${isCol?'▶':'▼'}</span>${mon.label}</th>`+dayThs;
  }).join('');
  document.getElementById('rp-thead-row').innerHTML=thHtml;
  _monthTotalsToEnd(document.getElementById('rp-thead-row'),'logi-mcol',true); // month total at END
  const _rpYr=_logiYearMeta(months);
  window._rpMonths=_rpYr.monYms; _logiFoldBtn(window._rpColapsed,window._rpMonths);
  _logiYearHeader(document.getElementById('rp-thead-row'),'logi-mcol',_rpYr.monYms,_rpYr.yearEnds,'_rpToggleYear',window._rpColapsed);
  const _railColspan=days.length+months.length+1;

  // ── TREE ROW HELPERS ──────────────────────────────────────────
  // The table is one tree: ORIGINS band → dispatch point → silos / product → leaf rows, then
  // DESTINATIONS band → terminal → product silo → inventory / demand / pulled rows. Only the
  // first cell of a row changes with its place in the tree; the data cells are built exactly
  // as before. Row builders and folding: _logiTreeKit / _ltToggle (tree 'rp').
  const {pName:_pName, pCol:_pCol, chip:_pChip, meta:_meta, tr:_tr, lbl:_lbl, blankCells:_blankCells}
    =_logiTreeKit('rp', months, window._rpColapsed, _mTdSty, _tpTdSty);
  const _facName=id=>DB.facilities.find(f=>f.id===id)?.name||id;
  // Section hues — the same ones the Supply page uses for the same data.
  const HUE_INV='var(--teal)', HUE_RAIL='var(--purple)', HUE_DEM='var(--blue)', HUE_PUSH='var(--tangerine)';

  // ── DESTINATION TABLE ─────────────────────────────────────────
  const destRows=[];
  const _destShown=_shownDests.filter(fid=>rpGetOriginsForDest(fid).length);
  destRows.push(`${_tr('rp-band rp-d rp-hdr-blank',[],'dest')}${_lbl(0,`DESTINATIONS${_meta(`terminal inventory, arrivals &amp; demand · ${_destShown.length} terminal${_destShown.length===1?'':'s'}`)}`,{key:'dest'})}${_blankCells()}</tr>`);
  _destShown.forEach(destFacId=>{
    const destFac=DB.facilities.find(f=>f.id===destFacId);
    const origins=rpGetOriginsForDest(destFacId);
    const {berth}=origins[0]; // primary rail berth
    const destSilos=rpGetDestSilos(berth);
    const demEls=rpGetDestDemEls(destFacId);
    const arrivals=rpPlannedArrivalsForDest(destFacId,berth?.id);

    // Rail-relevant products at this terminal (silos on the rail berth, limited to products
    // actually moved by rail — skips empty/non-cement berth silos).
    const _termProdIds=[...new Set(destSilos.flatMap(s=>getSiloProducts(s)).filter(Boolean))]
      .filter(pid=>_railProdSet.size===0||_railProdSet.has(pid));
    const _activeProdIds=_allowP?_termProdIds.filter(pid=>_allowP.has(pid)):_termProdIds;

    // Terminal → silo → INVENTORY / DEMAND (→ its demand points) / PULLED TO LOCAL YARD. The
    // terminal and silo lines are headers (names, origins, switch days — no numbers); each
    // silo folds its rows away. Products carry the same colour chip as at the origin.
    const tKey='d:'+destFacId;
    const _origNames=[...new Set(origins.map(o=>_facName(_railDpFacId(o.dp))))];

    // RAIL ARRIVAL — what the terminal receives, dated by the day it PULLS the cars from the
    // railroad's yard: its switch day (the arrival day when the berth has no switch days). The
    // day a car reaches the rail yard is not shown — it only appears in the tooltip. Numbers
    // are the simulation's (railTerminalPulls), so yard counts count and records the
    // simulation never ships don't. A pull day that is still ahead is an input: type the cars
    // you want pulled and the departure is planned backward (_rpPullTarget → the same
    // confirmed pushes the ORIGINS rows edit).
    const pulls=railTerminalPulls(destFacId);
    const _todayD=todayDayOffset(), _todayStr=new Date()._ymd();
    const _realInv=new Set((DB.real_inventory_daily||[]).map(r=>r.silo_id+'|'+r.date));
    const _carsOf=t=>Math.round((t||0)/pulls.carCap);
    const _dowNm=d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][_rpDow(d)];
    // One pull cell: value, status and tooltip for product pid on day d (_railPullInfo is shared
    // with the Supply page's "Pulled to local yard" cells, so both pages agree).
    const _pullCell=(pid,d)=>{
      const tSty=_tpTdSty(d);
      const ds=rpDayDate(d), pNm=_pName(pid);
      // Dbl-click any day → Reconcile Rail Yard: the same popup (and records) as the Supply
      // page's "Pulled to local yard" cells. On a pull day ahead, a single click still types a target.
      const dbl=`ondblclick="event.stopPropagation();showRailPlacementPopup('${destFacId}','${pid}','${ds}')"`;
      if(!pulls.isPullDay(d)&&!(pulls.pulledT(pid,d)>0))
        return `<td ${dbl} title="Not a pull day at this terminal — dbl-click to reconcile the physical car count" style="cursor:cell;${tSty||''}"></td>`;
      const info=_railPullInfo(pulls,arrivals,pid,d), {tP,cars,short,allReal}=info;
      const cls=short>0?'rp-over':allReal?'rp-real':(info.ents.length||cars>0)?'rp-committed':'rp-proposed';
      const next=rpDayDate(d+1).slice(5);
      const past=d<_todayD;
      const ttl=`${pNm} — pulled ${_dowNm(d)} ${ds.slice(5)}: ${cars} car${cars===1?'':'s'} (${Math.round(tP).toLocaleString()} t), at the local yard ${next}`
        +_railPullTipLines(info,pulls.carCap,!past)+'\nDbl-click to reconcile the physical car count';
      if(past){
        const col=short>0?'var(--red)':allReal?'var(--teal)':cars>0?'var(--sky)':'var(--text-dim)';
        return `<td class="${_srcC(ds,cars,allReal)}" ${dbl} title="${esc(ttl)}" style="cursor:cell;color:${col};${allReal?'font-weight:700;':''}${tSty}">${cars>0?cars:'—'}</td>`;
      }
      return `<td class="tp-col-switch" ${dbl} style="cursor:cell;${tSty||''}"><input type="number" min="0" step="1" value="${cars}" data-dest="${destFacId}" data-pid="${pid}" data-day="${d}" data-base="${cars}" title="${esc(ttl)}" onchange="_rpPullTarget(this)" class="rp-push-inp rp-pull-inp ${cls}"></td>`;
    };
    const _pullCellsFor=pid=>months.map(mon=>{const isCol=window._rpColapsed.has(mon.ym);
      const monC=mon.days.reduce((s,d)=>s+_carsOf(pulls.pulledT(pid,d)),0);
      const mTd=`<td class="logi-mcol" style="${_mTdSty}">${monC>0?monC+' cars':'—'}</td>`;
      return mTd+(isCol?[]:mon.days).map(d=>_pullCell(pid,d)).join('');
    }).join('');
    // Which origin(s) ship a product here — shown on its line.
    const _arrFrom=pid=>[...new Set(origins.filter(o=>railDpProducts(o.dp).includes(pid)).map(o=>_facName(_railDpFacId(o.dp))))];
    // Products: every rail product at this terminal, plus any other product the simulation
    // pulls here (no silo for it, e.g.) — within the Product filter.
    const _pulledPids=new Set();
    pulls.berths.forEach(b=>(S.simResults?.railPulledHistory?.[b.id]||[]).forEach(e=>Object.keys(e||{}).forEach(p=>_pulledPids.add(p))));
    const _rowProds=[..._activeProdIds,..._pulledPids].filter((p,i,a)=>p&&a.indexOf(p)===i&&(!_allowP||_allowP.has(p)));
    const _swTxt=pulls.swDays.length?`switch ${_rpDowList(pulls.swDays)}`:'no switch days · pulled on arrival';

    // Cell source — the Supply page's look: real (every input actual), past day with no actual,
    // forecast. Same classes (cell-real / cell-gap / cell-fc), styled for #rp-rail-table too.
    const _srcC=(ds,v,real)=>!(v>0)?'':real?'cell-real':(ds<_todayStr?'cell-gap':'cell-fc');

    // INVENTORY — one row per silo, start of the day (the Supply page's figure). Real when the
    // previous day's end-of-day stock was recorded; numbers take the silo fill-level colour.
    const _silosOf=pid=>destSilos.filter(s=>getSiloProducts(s).includes(pid));
    const _invCellsFor=silo=>{
      const max=parseFloat(silo.props?.max_capacity)||0;
      const floor=(parseFloat(silo.props?.critical_floor_pct)||0)/100*max;
      return months.map(mon=>{const isCol=window._rpColapsed.has(mon.ym);
        const lastV=rpInv(silo.id,mon.days[mon.days.length-1]);
        const mTd=`<td class="logi-mcol" style="${_mTdSty}">${lastV!==null?Number(Math.round(lastV)).toLocaleString():'—'}</td>`;
        return mTd+(isCol?[]:mon.days).map(d=>{
          const v=rpInv(silo.id,d), ds=rpDayDate(d);
          const real=_realInv.has(silo.id+'|'+rpDayDate(d-1));
          const crit=v!==null&&v<=floor&&floor>0;
          const col=crit?'var(--red)':(v>0?invLevelColor(v,max):'');
          const tSty=_tpTdSty(d);
          return `<td class="${_srcC(ds,v,real)}" style="${col?`color:${col};`:''}${tSty||''}">${v!==null?Number(v).toLocaleString():'—'}</td>`;
        }).join('');
      }).join('');
    };

    // DEMAND — EFFECTIVE demand (own − swapped-out + swapped-in) of the rail demand points
    // serving the product. Vessel-only demand points at the terminal are excluded.
    const _demCellsFor=els=>months.map(mon=>{const isCol=window._rpColapsed.has(mon.ym);
      const monT=mon.days.reduce((s,d)=>s+els.reduce((q,el)=>q+rpDemandEff(el.id,d),0),0);
      const mTd=`<td class="logi-mcol" style="${_mTdSty}">${monT>0?Number(Math.round(monT)).toLocaleString():'—'}</td>`;
      return mTd+(isCol?[]:mon.days).map(d=>{
        const ds=rpDayDate(d), vs=els.map(el=>rpDemandEff(el.id,d)), v=vs.reduce((q,x)=>q+x,0);
        // real when every demand point with tonnes that day has its actual (sales) figure
        const real=vs.some(x=>x>0)&&els.every((el,i)=>!(vs[i]>0)||_dmdIsActual(el.id,ds));
        const tSty=_tpTdSty(d);
        return `<td class="${_srcC(ds,v,real)}" style="color:var(--simulated);${tSty}">${v>0?Number(v).toLocaleString():'—'}</td>`;
      }).join('');
    }).join('');

    // Terminal line — a header: origins that ship here and the switch days, no numbers.
    destRows.push(`${_tr('rp-fac rp-d rp-hdr-blank',['dest'],tKey)}${_lbl(1,`${esc(destFac?.name||destFacId)}${_meta('← '+esc(_origNames.join(' · '))+' · '+_swTxt)}`,
      {key:tKey,title:`${destFac?.name||destFacId} — rail terminal, receives from ${_origNames.join(', ')}`})}${_blankCells()}</tr>`);

    // One group per product, headed by its silo line (silo name ← who ships it), then
    // INVENTORY · DEMAND (folds its demand points) · PULLED TO LOCAL YARD. Demand and pulls
    // belong to the product, so a product in several silos gets one INVENTORY row per silo
    // under its first silo. A product with no silo here is headed by its name.
    _rowProds.forEach(pid=>{
      const pKey=`${tKey}:p:${pid}`, dKey=`${pKey}:dem`, from=_arrFrom(pid);
      const pP=['dest',tKey,pKey];
      const silos=_silosOf(pid), silo0=silos[0];
      const _cap=(cls,label,unit,hue,o={})=>`${_tr(`rp-sec rp-caps rp-d ${cls}`,pP,o.key)}${_lbl(3,`${label}${_meta(unit)}`,{hue,...o})}`;
      destRows.push(`${_tr('rp-sec rp-d rp-hdr-blank',['dest',tKey],pKey)}${_lbl(2,`${_pChip(pid)}${esc(silo0?silo0.name:_pName(pid))}${_meta((from.length?'← '+esc(from.join(' · ')):'')+(silo0?'':(from.length?' · ':'')+'no silo'))}`,
        {key:pKey,title:`${_pName(pid)} at ${destFac?.name||destFacId} — click to show/hide inventory, demand and pulls`})}${_blankCells()}</tr>`);
      silos.forEach(silo=>destRows.push(`${_cap('tp-row-inv','Inventory',silos.length>1?esc(silo.name)+' · t':'t',HUE_INV,
        {title:`${silo.name} — inventory at the start of the day (t)`})}${_invCellsFor(silo)}</tr>`));
      const els=demEls.filter(el=>_demElMatchesProd(el,pid));
      destRows.push(`${_cap('tp-row-dem','Demand',els.length?'total · t':'t',HUE_DEM,
        els.length?{key:dKey,title:`${_pName(pid)} demand at ${destFac?.name||destFacId} — click to show/hide its ${els.length} demand point${els.length===1?'':'s'}`}:{})}${_demCellsFor(els)}</tr>`);
      els.forEach(el=>destRows.push(`${_tr('rp-leaf rp-d tp-row-dem',[...pP,dKey])}${_lbl(4,`${esc(el.name||el.id)}${_meta('t')}`,{hue:HUE_DEM})}${_demCellsFor([el])}</tr>`));
      destRows.push(`${_cap('tp-row-arrival','Pulled to local yard','cars',HUE_RAIL,
        {title:`${_pName(pid)} cars pulled to the ${destFac?.name||destFacId} local yard. Type into a coming switch to plan the departure backward.`})}${_pullCellsFor(pid)}</tr>`);
    });
  });
  // destRows are assigned into the single merged table at the end (after origin rows).

  // ── ORIGIN ROWS (planning) ────────────────────────────────────
  const origRows=[];
  // Every rail dispatch point that serves a selected destination, once each — minus those the
  // Product filter leaves with nothing to show (no product it loads, no silo holding it).
  const _origList=[];
  { const seenDp=new Set();
    const _pOk=pid=>!_allowP||_allowP.has(pid);
    const _hasRows=o=>railDpProducts(o.dp).some(_pOk)
      ||(o.railSilo&&(!_allowP||getSiloProducts(o.railSilo).some(_pOk)))
      ||rpGetOriginProdSilos(o.dp).some(s=>!_allowP||getSiloProducts(s).some(_pOk));
    _shownDests.forEach(destFacId=>rpGetOriginsForDest(destFacId).forEach(o=>{
      if(seenDp.has(o.dp.id)) return;
      seenDp.add(o.dp.id);
      if(_hasRows(o)) _origList.push(o);
    }));
  }
  origRows.push(`${_tr('rp-band rp-o rp-hdr-blank',[],'orig')}${_lbl(0,`ORIGINS${_meta(`plan loading &amp; switches · ${_origList.length} dispatch point${_origList.length===1?'':'s'}`)}`,{key:'orig'})}${_blankCells()}</tr>`);
  _origList.forEach(({dp,destCfg,railSilo,origFac})=>{
      const switchDays=dp.props?.switch_days||[];
      const carCap=parseFloat(dp.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT;
      const carsPerDay=(parseFloat(dp.props?.std_loading_cars_shift||dp.props?.std_loading_cars_day)||10)
                       *(parseFloat(dp.props?.shifts_per_day)||1);

      // EVERY rail destination this dp serves — not narrowed by the filters. The push rows below
      // are the plan: the suggested split, ✓ confirm and the over-allocation check all work on
      // the full set exactly as on an unfiltered page, so a filter carried over from another page
      // can never commit a partial or skewed plan. Filtered-out rows are only hidden (.flt-off).
      const myDests=_allRailDestIds.filter(fid=>(dp.props?.destinations||[]).find(d=>d.facility_id===fid));
      const _destOff=fid=>!_shownDestSet.has(fid);
      const _rpFacId=_railDpFacId(dp);

      // Dispatch-point header: origin facility + dispatch point, its switch days and loading
      // pace. Switch-day columns stay tinted through it so the switches read at a glance.
      const oKey='o:'+dp.id, oP=['orig',oKey];
      const _oName=_facName(_rpFacId);
      origRows.push(`${_tr('rp-fac rp-o rp-hdr-blank',['orig'],oKey)}${_lbl(1,`${esc(_oName)}<span class="rp-tag">${esc(dp.name||dp.id)}</span>${_meta(`switch ${_rpDowList(switchDays)} · ${carsPerDay} cars/d`)}`,
        {key:oKey,title:`${_oName} · ${dp.name||dp.id} — rail switch ${_rpDowList(switchDays)}, loads up to ${carsPerDay} cars/day at ${carCap} t/car, ships to ${myDests.map(_facName).join(', ')||'—'}`})}${_blankCells(d=>rpIsSwitch(d,switchDays))}</tr>`);

      // SILO INVENTORY — the rail silo the cars load from, then the plant silos filled by the
      // same mills. Both filtered by the selected product.
      const invKey=oKey+':inv';
      const silRows=[];
      if(railSilo&&(!_allowP||getSiloProducts(railSilo).some(pid=>_allowP.has(pid)))){
        const railCells=months.map(mon=>{const isCol=window._rpColapsed.has(mon.ym);
          const lastV=rpInv(railSilo.id,mon.days[mon.days.length-1]);
          const mTd=`<td class="logi-mcol" style="${_mTdSty}">${lastV!==null?Number(Math.round(lastV)).toLocaleString():'—'}</td>`;
          return mTd+(isCol?[]:mon.days).map(d=>{
            const v=rpInv(railSilo.id,d);
            const tSty=_tpTdSty(d);
            return `<td style="color:var(--sky);${tSty}">${v!==null?Number(v).toLocaleString():'—'}</td>`;
          }).join('');
        }).join('');
        const rp0=getSiloProducts(railSilo)[0];
        silRows.push(`${_tr('rp-leaf rp-o tp-row-inv tp-row-rail-silo',[...oP,invKey])}${_lbl(3,`${rp0?_pChip(rp0):''}${esc(railSilo.name)}<span class="rp-tag">rail silo</span>`,{hue:HUE_INV})}${railCells}</tr>`);
      }
      const prodSilos=rpGetOriginProdSilos(dp)
        .filter(s=>!_allowP||getSiloProducts(s).some(pid=>_allowP.has(pid)));
      prodSilos.forEach(silo=>{
        const invCells=months.map(mon=>{const isCol=window._rpColapsed.has(mon.ym);
          const lastV=rpInv(silo.id,mon.days[mon.days.length-1]);
          const mTd=`<td class="logi-mcol" style="${_mTdSty}">${lastV!==null?Number(Math.round(lastV)).toLocaleString():'—'}</td>`;
          return mTd+(isCol?[]:mon.days).map(d=>{
            const v=rpInv(silo.id,d);
            const tSty=_tpTdSty(d);
            return `<td${tSty?` style="${tSty}"`:''}>${v!==null?Number(v).toLocaleString():'—'}</td>`;
          }).join('');
        }).join('');
        const sp0=getSiloProducts(silo)[0];
        silRows.push(`${_tr('rp-leaf rp-o tp-row-inv tp-row-orig-inv',[...oP,invKey])}${_lbl(3,`${sp0?_pChip(sp0):''}${esc(silo.name)}`,{hue:HUE_INV})}${invCells}</tr>`);
      });
      if(silRows.length){
        origRows.push(`${_tr('rp-sec rp-caps rp-o rp-hdr-blank',oP,invKey)}${_lbl(2,`SILO INVENTORY${_meta('t')}`,{key:invKey,hue:HUE_INV})}${_blankCells()}</tr>`);
        origRows.push(...silRows);
      }

      // ── RAIL v2 (operator-driven) ───────────────────────────────────────────
      // Per product the dp loads: actual cars loaded/day (from the sim), the cars accumulated
      // & available at each switch, and one editable PUSH row per terminal (pre-filled).
      const rh=S.simResults?.railHistory?.[dp.id]||[];
      // Every product, for the same reason as myDests (✓ commits all of them); products outside
      // the filter are hidden (.flt-off), not dropped.
      const dpProducts=railDpProducts(dp);
      const _prodOff=pid=>!!_allowP&&!_allowP.has(pid);
      const loadedOn=(pid,d)=>{ const e=rh[d-1]; return e?(e.carsLoadedByProduct?.[pid]||0):0; };
      // Cars available to push at switch S (shared with the backward planner).
      const availAtSwitch=(pid,S)=>_rpAvailAtSwitch(dp,pid,S);
      const transitOf=fid=>{ const d=(dp.props?.destinations||[]).find(x=>x.facility_id===fid); return parseInt(d?.transit_days)||1; };
      // Match saved pushes by DATE (day numbers drift when the sim start date moves).
      const existingPush=(pid,fid,d)=>{ const ds=rpDayDate(d);
        return DB.rail_movements.find(rm=>rm.from_dispatch_id===dp.id&&rm.to_facility_id===fid&&(rm.product_id||'')===pid
          &&(rm.departure_date?rm.departure_date===ds:rm.switch_day===d)); };
      // Real dispatched cars (actuals) recorded for this origin/dest/product/date.
      const realPush=(pid,fid,ds)=>(DB.real_rail_daily||[]).find(rr=>rr.type==='dispatched'&&rr.date===ds
        &&rr.facility_id===_rpFacId&&rr.dest_facility_id===fid&&(rr.product_id||'')===pid);
      const _rpToday=new Date()._ymd();

      dpProducts.forEach(pid=>{
        const prod=DB.products.find(p=>p.id===pid);
        const pName=prod?.name||pid;
        // Product header — its loaded / available / push rows fold under it. The chip colour
        // matches the product's rows in the destination blocks.
        const pKey=`${oKey}:p:${pid}`, pP=[...oP,pKey];
        origRows.push(`${_tr('rp-sec rp-o rp-hdr-blank'+(_prodOff(pid)?' flt-off':''),oP,pKey)}${_lbl(2,`${_pChip(pid)}${esc(pName)}${_meta('rail cars')}`,{key:pKey,hue:_pCol(pid)})}${_blankCells()}</tr>`);

        // 1) Cars loaded per day. Click a cell to open the SAME rail loading popup the
        // Supply page uses (Forecast campaign -> rail_loading_plan · Real -> real_rail_daily
        // type 'loading'), so whichever page you edit from, both show the same numbers.
        // Days with a real entry are bold green, exactly as on the Supply page.
        const _firstDpProd=railDpProducts(dp)[0];
        const realLoad=(ds)=>(DB.real_rail_daily||[]).filter(rr=>rr.type==='loading'&&rr.date===ds
          &&rr.facility_id===_rpFacId&&((rr.product_id||'')===pid||(!rr.product_id&&pid===_firstDpProd)))
          .reduce((a,rr)=>a+(parseFloat(rr.cars)||0),0)||null;
        // Contiguous same-product forecast runs, so a click pre-fills the campaign range.
        const _loadRun={};
        { let cs=null,pd=null;
          const _fin=end=>{ if(cs==null)return; for(let x=cs;x<=end;x++) _loadRun[x]={start:rpDayDate(cs),end:rpDayDate(end)}; };
          days.forEach(d=>{ const on=loadedOn(pid,d)>0&&realLoad(rpDayDate(d))===null;
            if(on){ if(cs==null)cs=d; pd=d; } else { if(cs!=null)_fin(pd); cs=null; pd=null; } });
          if(cs!=null)_fin(pd);
        }
        const loadCells=months.map(mon=>{const isCol=window._rpColapsed.has(mon.ym);
          const mc=mon.days.reduce((s,d)=>s+loadedOn(pid,d),0);
          const mTd=`<td class="logi-mcol" style="${_mTdSty}">${mc>0?mc+' cars':'—'}</td>`;
          return mTd+(isCol?[]:mon.days).map(d=>{
            const c=loadedOn(pid,d); const ds=rpDayDate(d); const tSty=_tpTdSty(d); const sw=rpIsSwitch(d,switchDays);
            const rv=realLoad(ds);
            const run=_loadRun[d];
            const args=run?`'${dp.id}','${ds}','${run.start}','${run.end}','${pid}'`:`'${dp.id}','${ds}',null,null,'${pid}'`;
            const sty=(rv!==null?'color:var(--teal);font-weight:700;':'')+(tSty||'');
            const ttl=rv!==null?`REAL: ${Math.round(rv)} cars loaded — click to edit`
                               :'Forecast from the loading plan — click to set a loading campaign or record the real cars';
            return `<td class="tp-cell-clickable${sw?' tp-col-switch':''}"${sty?` style="cursor:pointer;${sty}"`:' style="cursor:pointer"'} title="${ttl}" onclick="showRailCampaignPopup(${args})">${c>0?c:'—'}</td>`; }).join('');
        }).join('');
        origRows.push(`${_tr('rp-leaf rp-o tp-row-loading'+(_prodOff(pid)?' flt-off':''),pP)}${_lbl(3,`<span class="rp-glyph">↑</span>Loaded${_meta('cars/d')}`,{hue:HUE_RAIL,title:`${pName} cars loaded per day — click a cell to set the loading campaign or the real value. Same data as RAIL LOADING on the Supply page.`})}${loadCells}</tr>`);

        // 2) Cars accumulated in the yard and available to push at each switch. EDITABLE:
        // type the number that was really standing there when the railroad came and it is
        // saved as a real_rail_daily 'yard_count' row, which the simulation applies as the
        // yard's absolute value for that day (after loading, before the switch allocation).
        // Blank the cell to drop the override and fall back to the simulated figure.
        const realYard=ds=>(DB.real_rail_daily||[]).find(rr=>rr.type==='yard_count'&&rr.date===ds
          &&rr.facility_id===_rpFacId&&(rr.product_id||'')===pid&&(!rr.dispatch_id||rr.dispatch_id===dp.id));
        const availCells=months.map(mon=>{const isCol=window._rpColapsed.has(mon.ym);
          const mTd=`<td class="logi-mcol" style="${_mTdSty}">—</td>`;
          return mTd+(isCol?[]:mon.days).map(d=>{ const tSty=_tpTdSty(d); const sw=rpIsSwitch(d,switchDays);
            const ds=rpDayDate(d);
            const fc=realTransferFileCars(dp,pid,ds);   // Avila_Transfers_Summary.xlsx, as cars
            if(!sw){
              // Not a switch day: the file may still record a departure — shown, not simulated.
              if(fc==null) return `<td${tSty?` style="${tSty}"`:''}></td>`;
              return `<td${tSty?` style="${tSty}"`:''}><input type="number" readonly value="${fc}" class="rp-push-inp rp-file" title="FILE: ${fc} cars (${Math.round(realTransferOutT(dp.id,ds)).toLocaleString()} t) left on ${ds} per Avila_Transfers_Summary.xlsx — not a switch day, so the simulation does not ship them"></td>`;
            }
            const a=availAtSwitch(pid,d);
            const ry=realYard(ds);
            const isReal=!!ry, isFile=!isReal&&fc!=null;
            const cls=isReal?'rp-real':isFile?'rp-file':'rp-proposed';
            const ttl=isReal?`REAL: ${a} cars stood in the yard at this switch — clear the cell to go back to the simulated figure`
                      :isFile?`FILE: ${fc} cars (${Math.round(realTransferOutT(dp.id,ds)).toLocaleString()} t ÷ ${parseFloat(dp.props?.car_capacity_t)||RAIL_CAR_T_DEFAULT} t/car) per Avila_Transfers_Summary.xlsx — type a number to override it`
                            :'Cars accumulated in the yard, available to push. Type the number that was really there to override the simulation.';
            return `<td class="tp-col-switch"${tSty?` style="${tSty}"`:''}><input type="number" min="0" step="1" value="${a>0?a:0}" data-dp="${dp.id}" data-fac="${_rpFacId}" data-pid="${pid}" data-ds="${ds}" data-sim="${a}" title="${ttl}" onchange="_rpAvailEdit(this)" class="rp-push-inp ${cls}"></td>`; }).join('');
        }).join('');
        origRows.push(`${_tr('rp-leaf rp-o tp-row-avail'+(_prodOff(pid)?' flt-off':''),pP)}${_lbl(3,`<span class="rp-glyph">▣</span>Available at switch${_meta('cars')}`,{hue:HUE_RAIL,title:`${pName} cars in the yard at the switch. Editable — enter the real count to reconcile the simulation; blank it to undo.`})}${availCells}</tr>`);

        // Pre-fill suggestion per switch: ALL the cars available at that switch, split across the
        // terminals by their demand for the product (railSuggestSplit). The simulation ships this
        // same split on a switch that isn't confirmed, so the dashed numbers are what happens.
        // (Full fresh split, so the ⟳ reset always restores a meaningful distribution.)
        const suggest={}; // {switchDay:{destFacId:cars}}
        days.forEach(d=>{ if(!rpIsSwitch(d,switchDays)) return;
          suggest[d]=railSuggestSplit(dp,pid,d,availAtSwitch(pid,d),myDests);
        });

        // 3) Editable push row per terminal (only on switch-day columns).
        // Cell value precedence: unsaved draft > real (actual) > planned (confirmed) > suggested.
        // Colour code: amber = draft, green = real, blue = planned, purple dashed = suggested.
        myDests.forEach(fid=>{
          const destFac=DB.facilities.find(f=>f.id===fid);
          const pushCells=months.map(mon=>{const isCol=window._rpColapsed.has(mon.ym);
            const mc=mon.days.reduce((s,d)=>{ if(!rpIsSwitch(d,switchDays))return s;
              const rl=realPush(pid,fid,rpDayDate(d)); if(rl) return s+(parseInt(rl.cars)||0);
              const ex=existingPush(pid,fid,d); return s+(ex?(parseInt(ex.wagon_count)||0):(suggest[d]?.[fid]||0)); },0);
            const mTd=`<td class="logi-mcol" style="${_mTdSty}">${mc>0?mc+' cars':'—'}</td>`;
            return mTd+(isCol?[]:mon.days).map(d=>{ const tSty=_tpTdSty(d); const sw=rpIsSwitch(d,switchDays);
              if(!sw) return `<td${tSty?` style="${tSty}"`:''}></td>`;
              const ds=rpDayDate(d);
              const ex=existingPush(pid,fid,d);
              const committed=ex?(parseInt(ex.wagon_count)||0):0;
              const sg=suggest[d]?.[fid]||0;
              const rl=realPush(pid,fid,ds);
              const realVal=rl?(parseInt(rl.cars)||0):null;
              const isPast=ds<_rpToday;
              // Natural (saved) state of the cell + its base value
              let base, cls, ttl;
              if(realVal!==null){ base=realVal; cls='rp-real'; ttl=`REAL: ${realVal} cars dispatched`+(ex?` · planned ${committed}`:'')+(sg?` · suggested ${sg}`:''); }
              else if(ex){ base=committed; cls='rp-committed'; ttl='Planned (confirmed) — edit & ✓ to update'+(isPast?'. Past switch: ✓ records the number as REAL':''); }
              else { base=sg; cls='rp-proposed'; ttl='Proposed by the simulation — adjust, then ✓ under this switch to '+(isPast?'record as REAL':'confirm as the plan'); }
              const draft=window._rpDrafts[`${dp.id}|${d}|${fid}|${pid}`];
              const val=draft!==undefined?draft:base;
              const shown=draft!==undefined&&draft!==base?'rp-dirty':cls;
              const avail=availAtSwitch(pid,d);
              return `<td class="tp-col-switch"${tSty?` style="${tSty}"`:''}><input type="number" min="0" step="1" value="${val}" data-dp="${dp.id}" data-sw="${d}" data-dest="${fid}" data-pid="${pid}" data-ds="${ds}" data-committed="${committed}" data-suggest="${sg}" data-real="${realVal!==null?realVal:''}" data-base="${base}" data-cls="${cls}" data-avail="${avail}" title="${ttl}" onchange="_rpPushEdit(this)" class="rp-push-inp ${shown}"></td>`; }).join('');
          }).join('');
          origRows.push(`${_tr('rp-leaf rp-o tp-row-push'+(_prodOff(pid)||_destOff(fid)?' flt-off':''),pP)}${_lbl(3,`<span class="rp-glyph">→</span>Push to ${esc(destFac?.name||fid)}${_meta(transitOf(fid)+'d transit')}`,{hue:HUE_PUSH,title:`${pName} cars sent from ${_oName} to ${destFac?.name||fid} at each switch — ${transitOf(fid)} day(s) in transit`})}${pushCells}</tr>`);
        });
      });

      // Per-switch CONFIRM (✓) / RESET (⟳) controls — one row for this dispatch point.
      // The manager adjusts the push numbers above (cells turn amber), then clicks ✓ under a
      // switch to commit ALL that switch's pushes at once (they turn green); ⟳ restores suggestions.
      const confirmCells=months.map(mon=>{const isCol=window._rpColapsed.has(mon.ym);
        const mTd=`<td class="logi-mcol" style="${_mTdSty}"></td>`;
        return mTd+(isCol?[]:mon.days).map(d=>{ const tSty=_tpTdSty(d); const sw=rpIsSwitch(d,switchDays);
          if(!sw) return `<td${tSty?` style="${tSty}"`:''}></td>`;
          const _cPast=rpDayDate(d)<_rpToday;
          return `<td class="tp-col-switch" style="text-align:center;${tSty||''}"><span class="rp-sw-icon" style="color:var(--teal)" title="${_cPast?'Record this switch\'s numbers as REAL dispatches':'Confirm all pushes for this switch as the plan'}" onclick="_rpConfirmSwitch('${dp.id}',${d})">✓</span><span class="rp-sw-icon" style="color:var(--text-dim)" title="${_cPast?'Reset this switch to the planned values':'Reset this switch to the suggested distribution'}" onclick="_rpResetSwitch('${dp.id}',${d})">⟳</span></td>`; }).join('');
      }).join('');
      // A sibling of the product groups, not inside one: ✓ commits every product's pushes.
      origRows.push(`${_tr('rp-leaf rp-o rp-confirm tp-row-confirm',oP)}${_lbl(2,`<span class="rp-glyph" style="color:var(--teal)">✓</span>confirm · ⟳ reset${_meta(`all ${_oName} pushes of that switch`)}`,{hue:'var(--border2)'})}${confirmCells}</tr>`);
  });
  // Single merged table: ORIGINS (planning) first, a gap, then the DESTINATIONS — same dates.
  const _origDestGap=`<tr class="rp-gap" aria-hidden="true"><td colspan="${_railColspan}"></td></tr>`;
  const _rpBody=document.getElementById('rp-rail-tbody');
  _rpBody.innerHTML=origRows.join('')+_origDestGap+destRows.join('');
  _monthTotalsToEnd(_rpBody,'logi-mcol',true); // month total at END
  _logiYearTotalsToEnd(_rpBody,'logi-mcol',_rpYr.monYms,_rpYr.yearEnds,_rpYr.nYears);
  // Header lines carry no numbers — drop the "—" the year pass writes into their year cells.
  _rpBody.querySelectorAll('tr.rp-hdr-blank>td.logi-ycol').forEach(td=>{ td.textContent=''; });
  // Re-flag over-allocated switches for any surviving drafts (they persist across re-renders).
  new Set([...Object.keys(window._rpDrafts||{}).map(k=>k.split('|').slice(0,2).join('|')),..._rpRecheck]).forEach(k=>{
    const [dpId,sw]=k.split('|'); _rpValidateSwitch(dpId,sw);
  });
  // Any upcoming switch whose pushes exceed the cars available is flagged too (a plan the
  // simulation can only partly ship must not look fine), with what will really go in the tooltip.
  { const today=new Date()._ymd(), groups={};
    _rpBody.querySelectorAll('input.rp-push-inp[data-sw][data-dest]').forEach(i=>{
      if(i.dataset.ds<today) return;
      const k=i.dataset.dp+'|'+i.dataset.sw+'|'+i.dataset.pid; (groups[k]=groups[k]||[]).push(i); });
    Object.values(groups).forEach(list=>{
      const avail=parseInt(list[0].dataset.avail)||0;
      const tot=list.reduce((s,i)=>s+Math.max(0,parseInt(i.value)||0),0);
      if(tot<=avail) return;
      list.forEach(i=>{ i.classList.add('rp-over');
        i.title=`${i.title}\n⚠ ${tot} cars pushed at this switch but only ${avail} available — the simulation ships the pushes in order until the cars run out`; });
    });
  }
  // Push-cell colour legend above the table.
  const legend=document.getElementById('rp-legend');
  if(legend) legend.innerHTML=`<span style="opacity:.7">ROWS:</span>
    <span>click a <b style="color:var(--text)">▼</b> name to fold it — <span style="color:var(--tangerine)">orange</span> rail = origin, <span style="color:var(--sky)">blue</span> rail = terminal</span>
    <span style="opacity:.35">|</span>
    <span style="opacity:.7">PUSH CELLS:</span>
    <span><span class="rp-lg" style="background:rgba(var(--purple-rgb),.15);border:1px dashed rgba(var(--purple-rgb),.6)"></span> Proposed (simulation)</span>
    <span><span class="rp-lg" style="background:rgba(var(--amber-rgb),.25);border:1px solid rgba(var(--amber-rgb),.7)"></span> Edited (unsaved — click ✓)</span>
    <span><span class="rp-lg" style="background:rgba(var(--sky-rgb),.2);border:1px solid rgba(var(--sky-rgb),.7)"></span> Planned (confirmed)</span>
    <span><span class="rp-lg" style="background:rgba(var(--teal-rgb),.22);border:1px solid rgba(var(--teal-rgb),.7)"></span> Real (actual dispatch)</span>
    <span><span class="rp-lg" style="background:rgba(var(--red-rgb),.25);border:1px solid var(--red)"></span> Exceeds available cars</span>
    <span style="opacity:.35">|</span>
    <span style="opacity:.7">↑ LOADED:</span>
    <span>click a day to set the loading campaign or the real cars — same data as RAIL LOADING on the Supply page
      (<span style="color:var(--teal);font-weight:700">green</span> = real)</span>
    <span style="opacity:.35">|</span>
    <span style="opacity:.7">▣ AVAILABLE:</span>
    <span>type the cars really standing in the yard at a switch; blank the cell to undo</span>
    <span style="opacity:.35">|</span>
    <span style="opacity:.7">PULLED TO LOCAL YARD:</span>
    <span>cars a terminal pulls on its switch day — type into a coming switch to plan the departure backward
      (<span style="color:var(--red)">red</span> = the origin can't supply it)</span>`;
}

// ── Rail exception banner ──────────────────────────────────────────
// Surfaces, for the current view range + selected destinations: (1) terminal-days where
// inventory falls to/below safety stock, and (2) rail cars the planner scheduled but the
// origin could not load/ship in time (r.railShortfalls). Hidden when there are none.
function rpRenderExceptions(){
  const box=document.getElementById('rp-exceptions');
  if(!box) return;
  const r=S.simResults;
  if(!r){ box.style.display='none'; box.innerHTML=''; return; }
  const {startDay,endDay}=rpGetRange();
  const facName=fid=>DB.facilities.find(f=>f.id===fid)?.name||fid;
  const _shown=rpShownDests();

  // 1) Rail loading/shipping shortfalls within the visible range + selected destinations
  const shortfalls=(r.railShortfalls||[]).filter(s=>s.switchDay>=startDay&&s.switchDay<=endDay
    &&_shown.includes(s.toFacId));
  const shortByDest={};
  shortfalls.forEach(s=>{ shortByDest[s.toFacId]=(shortByDest[s.toFacId]||0)+s.shortCars; });
  const totalShortCars=shortfalls.reduce((a,s)=>a+s.shortCars,0);

  // 2) Terminal-days below safety stock for the selected destinations
  let stockoutDays=0; const stockoutByDest={};
  _shown.forEach(destFacId=>{
    const origins=rpGetOriginsForDest(destFacId);
    if(!origins.length) return;
    const berth=origins[0].berth;
    (rpGetDestSilos(berth)||[]).forEach(silo=>{
      const max=parseFloat(silo.props?.max_capacity)||0;
      const floor=(parseFloat(silo.props?.critical_floor_pct)||0)/100*max;
      if(floor<=0) return;
      for(let d=startDay; d<=endDay; d++){
        const v=rpInv(silo.id,d);
        if(v!==null&&v<=floor){ stockoutDays++; stockoutByDest[destFacId]=(stockoutByDest[destFacId]||0)+1; }
      }
    });
  });

  if(totalShortCars<=0&&stockoutDays<=0){ box.style.display='none'; box.innerHTML=''; return; }

  const parts=[];
  if(stockoutDays>0){
    const detail=Object.entries(stockoutByDest).map(([f,n])=>`${facName(f)} (${n}d)`).join(', ');
    parts.push(`<div style="margin:2px 0"><b style="color:var(--red)">${stockoutDays}</b> terminal-day(s) below safety stock — ${detail}</div>`);
  }
  if(totalShortCars>0){
    const detail=Object.entries(shortByDest).map(([f,n])=>`${facName(f)} (${n} cars)`).join(', ');
    parts.push(`<div style="margin:2px 0"><b style="color:var(--amber)">${totalShortCars}</b> rail car(s) scheduled but not loaded/shipped in time — ${detail}</div>`);
  }
  box.style.display='';
  box.innerHTML=`<div style="background:rgba(var(--red-rgb),.08);border:1px solid rgba(var(--red-rgb),.35);border-radius:4px;padding:8px 12px;margin-bottom:12px;font-family:var(--mono);font-size:9px;color:var(--text)">`
    +`<div style="color:var(--red);font-weight:700;letter-spacing:.05em;margin-bottom:4px">⚠ RAIL EXCEPTIONS (current view)</div>`
    +parts.join('')
    +`<div style="color:var(--text-dim);margin-top:4px">Origin can't cover all scheduled shipments — reduce demand, add a loading shift, add switch days, or add a second origin.</div>`
  +`</div>`;
}




// ── Rail planner charts ───────────────────────────────────────────
function rpDestroyCharts(){
  Object.values(_rpCharts).forEach(c=>{try{c.destroy();}catch(e){}});
  Object.keys(_rpCharts).forEach(k=>delete _rpCharts[k]);
}
function vpDestroyCharts(){
  Object.values(_vpCharts).forEach(c=>{try{c.destroy();}catch(e){}});
  Object.keys(_vpCharts).forEach(k=>delete _vpCharts[k]);
}

function rpRenderCharts(){
  rpDestroyCharts();
  const section=document.getElementById('rp-charts-section');
  const inner=document.getElementById('rp-charts-inner');
  if(!section||!inner) return;
  inner.innerHTML='';

  const _shown=rpShownDests();
  if(!S.simResults||!_shown.length){section.style.display='none';return;}
  section.style.display='';

  const {startDay,endDay}=rpGetRange();
  const days=[]; for(let d=startDay;d<=endDay;d++) days.push(d);
  const labels=days.map(d=>rpDayDate(d).slice(5));
  const chartBuilders=[];

  // ── Shared helpers ────────────────────────────────────────────────
  const mkCanvas=(id,height='180px')=>{
    const div=document.createElement('div');
    div.style.cssText=`background:var(--surface2);border-radius:4px;padding:8px 10px;height:${height};position:relative`;
    const canvas=document.createElement('canvas');
    canvas.id=id; div.appendChild(canvas); inner.appendChild(div);
    return canvas;
  };
  const baseOpts=(title,showLegend=false)=>({
    responsive:true,maintainAspectRatio:false,
    plugins:{
      title:{display:true,text:title,color:_tc('#8e9ab8'),font:{family:'Space Mono',size:8},padding:{top:0,bottom:4}},
      legend:{display:showLegend,position:'top',
        labels:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:7},boxWidth:10,padding:6,
          filter:item=>item.text!=='Cap'&&item.text!=='Floor'}},
      tooltip:{mode:'index',intersect:false,
        callbacks:{
          title:its=>its[0]?.label||'',
          label:c=>{const v=c.raw;if(v==null||v===0)return '';
            return `${c.dataset.label}: ${Number(Math.round(v)).toLocaleString()}${c.dataset._u||' t'}`;}
        }
      }
    },
    scales:{
      x:{grid:{color:_tc('rgba(255,255,255,.03)')},
        ticks:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:7},maxTicksLimit:8,autoSkip:true,maxRotation:0}},
      y:{beginAtZero:true,grid:{color:_tc('rgba(255,255,255,.06)')},
        ticks:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:7},
          callback:v=>v>=1000?Math.round(v/100)/10+'k':Math.round(v)}}
    }
  });

  // ── One full-width DESTINATION chart: terminal inventory for every selected
  //    destination × product over the range, with dashed demand lines. ──────────
  const _palette=[
    {line:'#34d399',fill:'rgba(52,211,153,.10)'},
    {line:'#60a5fa',fill:'rgba(96,165,250,.10)'},
    {line:'#f472b6',fill:'rgba(244,114,182,.10)'},
    {line:'#fb923c',fill:'rgba(251,146,60,.10)'},
    {line:'#a78bfa',fill:'rgba(167,139,250,.10)'},
    {line:'#fbbf24',fill:'rgba(251,191,36,.10)'},
    {line:'#22d3ee',fill:'rgba(34,211,238,.10)'},
    {line:'#f87171',fill:'rgba(248,113,113,.10)'},
  ];
  const _railProdSet=new Set(rpGetRailProducts(_shown).map(p=>p.id));
  const _allowP=fltAllowedProdIds();
  const dsAll=[]; let _ci=0;
  _shown.forEach(destFacId=>{
    const origins=rpGetOriginsForDest(destFacId); if(!origins.length) return;
    const {berth}=origins[0];
    const destFac=DB.facilities.find(f=>f.id===destFacId);
    const allDemEls=rpGetDestDemEls(destFacId);
    const silos=rpGetDestSilos(berth).filter(s=>_allowP
      ? getSiloProducts(s).some(pid=>_allowP.has(pid))
      : getSiloProducts(s).some(pid=>_railProdSet.size===0||_railProdSet.has(pid)));
    silos.forEach(silo=>{
      const col=_palette[_ci%_palette.length]; _ci++;
      const siloProds=getSiloProducts(silo);
      const prodLabel=DB.products.find(p=>p.id===siloProds[0])?.name||siloProds[0]||silo.name;
      const tag=`${destFac?.name||destFacId} · ${prodLabel}`;
      const invData=days.map(d=>{const v=rpInv(silo.id,d);return v!==null?v:null;});
      dsAll.push({label:tag,data:invData,type:'line',borderColor:_tc(col.line),backgroundColor:_tc(col.fill),
        fill:false,tension:0.2,pointRadius:0,borderWidth:1.6,_u:' t'});
      const siloDemEls=allDemEls.filter(e=>siloProds.some(pid=>_demElMatchesProd(e,pid)));
      const demData=days.map(d=>siloDemEls.reduce((s,e)=>s+rpDemand(e.id,d),0));
      if(demData.some(v=>v>0)) dsAll.push({label:`${tag} dem`,data:demData,type:'line',borderColor:_tc(col.line),
        borderDash:[3,3],pointRadius:0,borderWidth:1,fill:false,_u:' t/d'});
    });
  });
  if(!dsAll.length){ section.style.display='none'; return; }
  const _destCanvas=mkCanvas('rpc_dest','300px');
  chartBuilders.push(()=>{_rpCharts['rpc_dest']=new Chart(_destCanvas,{type:'line',data:{labels,datasets:dsAll},
    options:baseOpts('TERMINAL INVENTORY — selected destinations & products',true)});});

  // Build all charts, loading Chart.js on demand if needed
  const buildAll=()=>chartBuilders.forEach(f=>f());
  loadLib('chart').then(buildAll).catch(e=>console.warn(e)); // pinned version + SRI — see LIBS
}

function _rpToggleLegacy(){
  const w=document.getElementById('rp-legacy-wrap');
  if(!w) return;
  const shown=w.style.display!=='none';
  w.style.display=shown?'none':'block';
  const btn=document.querySelector('[onclick="_rpToggleLegacy()"]');
  if(btn) btn.textContent=shown?'▼ Show Records':'▲ Hide Records';
  if(!shown) renderRailTable();
}

