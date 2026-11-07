// ═══════════════════════════════════════════════════════
// GOLDEN-SCENARIO SELF-TEST
// Captures a known-good simulation digest (per-element hashes of every
// history series + the stop-event list) and compares any later run against
// it. Identical inputs must produce identical output — a mismatch means
// engine behaviour changed, and the report pinpoints element + series.
// Baseline is tied to facility + scenario + start_date; retake it after an
// INTENTIONAL behaviour change. simulate() itself is deterministic (only
// runId/run_at vary, both excluded here) and only touches transient tables.
// ═══════════════════════════════════════════════════════
function _stHash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(36);}
function _stSeriesHashes(map){const out={};Object.keys(map||{}).sort().forEach(k=>{out[k]=_stHash(JSON.stringify(map[k]));});return out;}

function stDigest(r){
  return {
    days:(r.days||[]).length,
    fulfillmentPct:r.fulfillmentPct,
    avgDailyProd:r.avgDailyProd,
    stopEvents:(r.stopEvents||[]).map(e=>`d${e.day} ${e.element_name||e.element_id} ${e.type}`).sort(),
    series:{
      inventory:_stSeriesHashes(r.inventoryHistory),
      mills:_stSeriesHashes(r.millProductHistory),
      packers:_stSeriesHashes(r.packProductHistory),
      kilns:_stSeriesHashes(r.kilnProdHistory),
      rail:_stSeriesHashes(r.railHistory),
      berthUnload:_stSeriesHashes(r.berthUnloadHistory),
      demandSwaps:_stSeriesHashes(r.demandSwapHistory),
    }
  };
}

function _stFreshDigest(){
  if(!S.facility_id) return null;
  const els=getFacElements();
  if(!els.length) return null;
  return stDigest(simulate(els,getFacConnections(),_simEffectiveHorizon(),true));
}

function stSaveBaseline(){
  const d=_stFreshDigest();
  if(!d){alert('Select a facility with elements first.');return;}
  localStorage.setItem('avila_golden',JSON.stringify({
    digest:d,
    meta:{
      savedAt:new Date().toISOString(),
      facility:S.facility_id,
      scenario:(typeof SC!=='undefined'&&SC.activeId)?(SC.meta[SC.activeId]?.name||SC.activeId):'(none)',
      start_date:S.simCfg.start_date,
      horizon:_simEffectiveHorizon()
    }
  }));
  stOpen('✓ Baseline saved. Future checks compare against this run.');
}

function stCompare(base,cur){
  const diffs=[];
  if(base.days!==cur.days) diffs.push(`sim length: ${base.days} → ${cur.days} days`);
  if(base.fulfillmentPct!==cur.fulfillmentPct) diffs.push(`fulfillment: ${base.fulfillmentPct}% → ${cur.fulfillmentPct}%`);
  if(base.avgDailyProd!==cur.avgDailyProd) diffs.push(`avg daily production: ${base.avgDailyProd} → ${cur.avgDailyProd}`);
  if(JSON.stringify(base.stopEvents)!==JSON.stringify(cur.stopEvents)){
    const bset=new Set(base.stopEvents),cset=new Set(cur.stopEvents);
    const gone=base.stopEvents.filter(x=>!cset.has(x));
    const added=cur.stopEvents.filter(x=>!bset.has(x));
    let msg=`stop events: ${base.stopEvents.length} → ${cur.stopEvents.length}`;
    if(gone.length) msg+=`\n    missing: ${gone.slice(0,3).join('; ')}${gone.length>3?` (+${gone.length-3} more)`:''}`;
    if(added.length) msg+=`\n    new: ${added.slice(0,3).join('; ')}${added.length>3?` (+${added.length-3} more)`:''}`;
    diffs.push(msg);
  }
  const elName=id=>DB.elements.find(e=>e.id===id)?.name||id;
  Object.keys(base.series).forEach(sk=>{
    const b=base.series[sk]||{},c=cur.series[sk]||{};
    const keys=new Set([...Object.keys(b),...Object.keys(c)]);
    const changed=[...keys].filter(k=>b[k]!==c[k]);
    if(changed.length) diffs.push(`${sk}: ${changed.slice(0,5).map(elName).join(', ')}${changed.length>5?` (+${changed.length-5} more)`:''} differ${changed.length===1?'s':''}`);
  });
  return diffs;
}

function stRunCheck(){
  const raw=localStorage.getItem('avila_golden');
  if(!raw){stOpen('No baseline saved yet — click "Save baseline" first.');return;}
  let base,meta;
  try{ ({digest:base,meta}=JSON.parse(raw)); }catch(e){ stOpen('Saved baseline is unreadable — save a new one.',true); return; }
  const cur=_stFreshDigest();
  if(!cur){alert('Select a facility with elements first.');return;}
  const ctxWarn=(meta.facility!==S.facility_id||meta.start_date!==S.simCfg.start_date)
    ?`⚠ Baseline context differs (saved for "${meta.scenario}", start ${meta.start_date}) — differences below may only reflect that.\n\n`:'';
  const diffs=stCompare(base,cur);
  const when=(meta.savedAt||'').slice(0,16).replace('T',' ');
  if(!diffs.length) stOpen(ctxWarn+`✓ MATCH — simulation output is identical to the baseline saved ${when} ("${meta.scenario}").`);
  else stOpen(ctxWarn+`✗ ${diffs.length} difference(s) vs baseline saved ${when}:\n\n• `+diffs.join('\n• '),true);
}

function stOpen(message,isBad){
  document.getElementById('st-backdrop')?.remove();
  let baseLbl='No baseline saved yet.';
  try{
    const raw=localStorage.getItem('avila_golden');
    if(raw){const m=JSON.parse(raw).meta;baseLbl=`Baseline: "${m.scenario}" — start ${m.start_date}, horizon ${m.horizon}d, saved ${(m.savedAt||'').slice(0,16).replace('T',' ')}`;}
  }catch(e){}
  const bd=document.createElement('div');
  bd.id='st-backdrop';
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:10000';
  bd.onclick=e=>{if(e.target===bd)bd.remove();};
  const dlg=document.createElement('div');
  dlg.style.cssText='background:var(--surface,#12161f);border:1px solid var(--accent,#4da6ff);border-radius:8px;padding:20px;max-width:560px;width:90%;max-height:80vh;overflow:auto;box-shadow:0 8px 32px rgba(0,0,0,.4)';
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const msg=message?`<div style="white-space:pre-wrap;font-family:var(--mono,monospace);font-size:11px;line-height:1.6;margin:10px 0;padding:10px;border-radius:6px;border:1px solid ${isBad?'var(--red)':'var(--rule)'};color:${isBad?'var(--bn-err-fg2)':'var(--text,#dfe6f3)'}">${esc(message)}</div>`:'';
  dlg.innerHTML=`<h3 style="margin:0 0 4px">🧪 Golden-scenario self-test</h3>
    <div style="font-size:10px;color:var(--text-dim,#8b93a7);margin-bottom:6px">Runs the simulation and compares its output against a saved known-good baseline. Any difference means engine behaviour changed. Retake the baseline after intentional changes.</div>
    <div style="font-size:10px;color:var(--text-dim,#8b93a7)">${esc(baseLbl)}</div>
    ${msg}
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="tb-btn" onclick="stRunCheck()">▶ Run check</button>
      <button class="tb-btn sec" onclick="stSaveBaseline()">📸 Save baseline</button>
      <button class="tb-btn sec" style="margin-left:auto" onclick="document.getElementById('st-backdrop').remove()">Close</button>
    </div>`;
  bd.appendChild(dlg);
  document.body.appendChild(bd);
}


// ═══════════════════════════════════════════════════════════════════════════
// RESULTS → DASHBOARD — network health
// ---------------------------------------------------------------------------
// Eight panels answering the questions a planner actually asks: is demand being
// served, where is stock about to run out, what is blocking production, and
// where does the cement come from. Everything derives from the simulation
// output already in memory (S.simResults) plus the shared slice — the view
// window (getViewRange) and the Facility/Process/Product dock
// (getResultElements) — so every panel agrees with the Data Table tab.
//
// Rules that hold across every panel:
//  · One measure per chart. No dual axes, no pies.
//  · Identity (facility, product) uses the categorical palette below, validated
//    for colour-blind separation on this dark surface; an entity keeps its
//    colour when you filter. Status colours are reserved for state and never
//    reused as a series colour.
//  · Windows of 70 days or less render daily columns; longer windows render
//    Monday-to-Sunday weeks — sums for flows, worst-day values for inventory,
//    so a short breach is never averaged away.
//  · Nothing is gated behind a hover: tooltips add precision, never meaning.
// ═══════════════════════════════════════════════════════════════════════════

const _tcProxy=o=>new Proxy(o,{get:(t,k)=>{ const v=t[k]; return typeof v==='string'?_tc(v):v; }});
const DASH_CAT=_tcProxy(['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767']);
const DASH_ST=_tcProxy({ok:'#199e70',low:'#c98500',empty:'#e66767',floor:'#d95926',cap:'#3987e5',info:'#5aaeff',idle:'#232b3b',maint:'#41527a',none:'#161c28'});
const DASH_OTHER='#5b6478';

function _dashFmtT(v){
  const n=Math.round(v||0);
  if(Math.abs(n)>=1e6) return (n/1e6).toFixed(n>=1e7?0:1)+'M';
  if(Math.abs(n)>=1e4) return Math.round(n/1e3)+'k';
  if(Math.abs(n)>=1000) return (n/1e3).toFixed(1)+'k';
  return n.toLocaleString();
}
function _dashPct(v){ return (v==null||isNaN(v))?'—':(v*100).toFixed(v>=0.999?0:1)+'%'; }
function _dashSet(x){ return x?(x instanceof Set?x:new Set(x)):null; }

// ── MODEL ─────────────────────────────────────────────────────────────────
// One shared model per render. Every panel reads from it, so the numbers can
// never disagree with each other.
function _dashModel(){
  const r=S.simResults; if(!r) return null;
  const horizon=S.simCfg.horizon||0; if(!horizon) return null;
  let {startDay,endDay,empty}=getViewRange();
  if(empty) return null;   // no simulated days in the time frame
  startDay=Math.max(1,startDay||1); endDay=Math.min(horizon,Math.max(startDay,endDay||horizon));
  const days=[]; for(let d=startDay;d<=endDay;d++) days.push(d);
  const dates=days.map(d=>dayToDate(d));
  const n=days.length;
  const todayIdx=dates.indexOf(new Date()._ymd());

  const prodById=new Map(DB.products.map(p=>[p.id,p]));
  const facById=new Map(DB.facilities.map(f=>[f.id,f]));
  // Stable identity colours: index into the full catalogue, not the filtered
  // subset, so an entity keeps its colour when the dock narrows the view.
  const facColor=new Map(DB.facilities.map((f,i)=>[f.id,DASH_CAT[i%DASH_CAT.length]]));
  const prodColor=new Map(DB.products.map((p,i)=>[p.id,DASH_CAT[i%DASH_CAT.length]]));
  const pName=pid=>(prodById.get(pid)||{}).name||pid;
  const fName=fid=>(facById.get(fid)||{}).name||fid||'Unassigned';
  const isCem=pid=>{const p=prodById.get(pid);return !!p&&(p.category==='cement_bulk'||p.category==='cement_packed');};

  const els=getResultElements();
  const facSet=_dashSet(fltFacIdSet());
  const allowP=_dashSet(fltAllowedProdIds());

  // ── Buckets: daily up to 70 days, else Monday-to-Sunday weeks ──
  const weekly=n>70;
  const buckets=[];
  if(!weekly){
    days.forEach((d,i)=>buckets.push({label:dates[i].slice(5),idx:[i],start:dates[i],end:dates[i]}));
  } else {
    let cur=null;
    days.forEach((d,i)=>{
      const dow=(new Date(dates[i]+'T00:00:00').getDay()+6)%7; // 0 = Monday
      if(!cur||dow===0){ cur={label:dates[i].slice(5),idx:[],start:dates[i],end:dates[i]}; buckets.push(cur); }
      cur.idx.push(i); cur.end=dates[i];
    });
  }
  const todayBucket=buckets.findIndex(b=>todayIdx>=0&&b.idx.includes(todayIdx));

  // ── SILOS ──
  const silos=els.filter(e=>e.type==='bulk_silo'||e.type==='packed_silo').map(el=>{
    const hist=r.inventoryHistory[el.id]||[];
    const start=_siloStartT(el);
    const inv=days.map(d=>{ const v=hist[d-1]; return typeof v==='number'?v:(d<=1?start:0); });
    const tpp=el.type==='packed_silo'?_siloTPP(el):1;
    const pids=getSiloProducts(el)||[];
    return {
      el, id:el.id, name:el.name,
      facId:getElFacility(el), facName:fName(getElFacility(el)),
      cap:_siloMaxT(el),
      floor:(parseFloat(el.props&&el.props.min_level)||0)*tpp,
      target:(parseFloat(el.props&&el.props.reorder_point)||0)*tpp,
      pids, cement:pids.some(isCem), inv,
      unload:days.map(d=>(r.siloUnloadHistory&&r.siloUnloadHistory[el.id]||[])[d-1]||0)
    };
  });

  // ── DEMAND POINTS — requested vs actually served, per day ──
  const dps=Object.entries(r.demandFill||{}).map(([id,df])=>({
    id, name:df.name||id, facId:df.facilityId||null, facName:fName(df.facilityId),
    products:(df.products||[]).filter(Boolean),
    req:days.map(d=>(df.reqDaily||[])[d-1]||0),
    serv:days.map(d=>(df.servDaily||[])[d-1]||0)
  })).filter(dp=>(!facSet||!dp.facId||facSet.has(dp.facId))&&(!allowP||!dp.products.length||dp.products.some(p=>allowP.has(p))));

  const sum=a=>a.reduce((s,v)=>s+(v||0),0);
  const zeros=()=>new Array(n).fill(0);
  const reqDaily=zeros(), servDaily=zeros();
  dps.forEach(dp=>dp.req.forEach((v,i)=>{ reqDaily[i]+=v||0; servDaily[i]+=dp.serv[i]||0; }));
  // Demand-days where a point got less than it asked for.
  let shortDayCount=0;
  dps.forEach(dp=>dp.req.forEach((v,i)=>{ if(v>0.5&&dp.serv[i]<v-0.5) shortDayCount++; }));

  // Stacks for the demand chart: by facility and by product. A demand point
  // with several products splits its tonnes evenly across them — the split is
  // only used for the product view of the same total.
  const stackBy=(keyFn,labelFn,colFn)=>{
    const map=new Map();
    dps.forEach(dp=>{
      keyFn(dp).forEach(({key,share})=>{
        if(!map.has(key)) map.set(key,{key,label:labelFn(key),col:colFn(key),req:zeros(),serv:zeros()});
        const e=map.get(key);
        dp.req.forEach((v,i)=>{ e.req[i]+=(v||0)*share; e.serv[i]+=(dp.serv[i]||0)*share; });
      });
    });
    return [...map.values()].sort((a,b)=>sum(b.req)-sum(a.req));
  };
  const byFacility=stackBy(dp=>[{key:dp.facId||'_none',share:1}],k=>fName(k),k=>facColor.get(k)||DASH_OTHER);
  const byProduct=stackBy(dp=>{
    const ps=dp.products.filter(p=>!allowP||allowP.has(p));
    const use=ps.length?ps:dp.products;
    return use.length?use.map(p=>({key:p,share:1/use.length})):[{key:'_none',share:1}];
  },k=>k==='_none'?'Unassigned':pName(k),k=>prodColor.get(k)||DASH_OTHER);

  // ── PRODUCTION ──
  const capOf=(elId,pid)=>{
    const c=DB.element_product_capacities.find(x=>x.element_id===elId&&x.product_id===pid);
    return c?(parseFloat(c.capacity_tpd)||0):0;
  };
  const stateOf=(elId,d)=>((r.elementStates[elId]||[])[d-1])||'idle';
  const mills=els.filter(e=>e.type==='finish_mill').map(el=>{
    const ph=r.millProductHistory[el.id]||[];
    const pid=days.map(d=>ph[d-1]||null);
    const tpd=days.map((d,i)=>pid[i]?capOf(el.id,pid[i]):0);
    return {el,id:el.id,name:el.name,facId:getElFacility(el),facName:fName(getElFacility(el)),pid,tpd,
            state:days.map(d=>stateOf(el.id,d)),kind:'mill'};
  });
  const packers=els.filter(e=>e.type==='packing_plant').map(el=>{
    const ph=r.packProductHistory[el.id]||[];
    const pid=days.map(d=>ph[d-1]||null);
    return {el,id:el.id,name:el.name,facId:getElFacility(el),facName:fName(getElFacility(el)),pid,
            tpd:days.map((d,i)=>pid[i]?capOf(el.id,pid[i]):0),
            state:days.map(d=>stateOf(el.id,d)),kind:'packer'};
  });
  const kilns=els.filter(e=>e.type==='kiln').map(el=>{
    const kh=r.kilnProdHistory[el.id]||[];
    return {el,id:el.id,name:el.name,facId:getElFacility(el),facName:fName(getElFacility(el)),
            pid:days.map(()=>null),
            tpd:days.map(d=>kh[d-1]||0),
            state:days.map(d=>stateOf(el.id,d)),kind:'kiln'};
  });
  const cementDaily=zeros(), clinkerDaily=zeros();
  mills.forEach(m=>m.tpd.forEach((v,i)=>{ if(!allowP||!m.pid[i]||allowP.has(m.pid[i])) cementDaily[i]+=v||0; }));
  kilns.forEach(k=>k.tpd.forEach((v,i)=>clinkerDaily[i]+=v||0));

  // Utilisation excludes planned maintenance from the denominator, so it
  // measures what the plant chose to do with the time it had.
  const util=list=>{
    let made=0, avail=0;
    list.forEach(a=>{
      const rated=Math.max(...DB.element_product_capacities.filter(c=>c.element_id===a.id)
        .map(c=>parseFloat(c.capacity_tpd)||0).concat([parseFloat(a.el.props&&a.el.props.rated_capacity_tpd)||0,0]));
      a.tpd.forEach((v,i)=>{ made+=v||0; if(a.state[i]!=='maintenance') avail+=rated; });
    });
    return avail>0?made/avail:null;
  };

  // ── INBOUND ──
  const berths=els.filter(e=>e.type==='berth');
  const recv={vessel:zeros(),rail:zeros(),transfer:zeros()};
  berths.forEach(b=>{
    const isRail=((b.props&&b.props.berth_type)||'')==='Rail Receiving';
    const h=r.berthUnloadHistory[b.id]||[];
    days.forEach((d,i)=>{ const v=h[d-1]||0; if(isRail) recv.rail[i]+=v; else recv.vessel[i]+=v; });
  });
  // Silo transfers that cross facilities are inbound supply at the receiving facility (tonnes the
  // simulation actually moved). Two silos of the same facility — or both ends inside the
  // facility filter — is an internal move, not supply.
  (DB.silo_links||[]).forEach(lk=>{
    const hist=r.siloTransferHistory&&r.siloTransferHistory[lk.id]; if(!hist) return;
    if(allowP&&!allowP.has(lk.product_id)) return;
    _slDirs(lk).forEach((dir,j)=>{
      const fF=_elFac(getEl(dir.from)), fT=_elFac(getEl(dir.to));
      if(fF===fT||(facSet&&(!facSet.has(fT)||facSet.has(fF)))) return;
      days.forEach((day,i)=>{ const e=hist[day-1], m=e&&e[j?'rev':'fwd']; if(m) recv.transfer[i]+=m.moved||0; });
    });
  });

  // ── SILO RISK ──
  // A silo that holds nothing all window and feeds no demand (a transit buffer,
  // an unused packer silo) is shown for completeness but never counted as a
  // stock-out — otherwise the risk count means nothing.
  const demandPids=new Set(); dps.forEach(dp=>dp.products.forEach(p=>demandPids.add(p)));
  silos.forEach(s=>{
    s.everStocked=s.inv.some(v=>v>0.5)||s.unload.some(v=>v>0.5);
    s.feedsDemand=s.pids.some(p=>demandPids.has(p));
    s.inert=!s.everStocked&&!s.feedsDemand;
    s.low=Math.min.apply(null,s.inv.length?s.inv:[0]);
    s.riskDays=s.inert?0:s.inv.filter(v=>v<=0.5||(s.floor>0&&v<s.floor)).length;
  });
  const siloRiskDays=silos.reduce((a,s)=>a+s.riskDays,0);
  const silosAtRisk=silos.filter(s=>s.riskDays>0).length;

  // ── COVER ──
  // Days of cover uses the same forward-looking rule as the simulation's silo
  // urgency: stock ÷ average demand over the next 14 days.
  const fwd=(arr,i,k)=>{ let s=0,c=0; for(let j=i;j<Math.min(arr.length,i+(k||14));j++){s+=arr[j]||0;c++;} return c?s/c:0; };
  const demandForPid={};
  dps.forEach(dp=>{
    const ps=dp.products.length?dp.products:['_none'];
    ps.forEach(p=>{
      if(!demandForPid[p]) demandForPid[p]=zeros();
      dp.req.forEach((v,i)=>demandForPid[p][i]+=(v||0)/ps.length);
    });
  });
  const siloShare=new Map();
  silos.forEach(s=>s.pids.forEach(p=>siloShare.set(p,(siloShare.get(p)||0)+1)));
  const coverAt=(s,i)=>{
    let rate=0;
    s.pids.forEach(p=>{ const d=demandForPid[p]; if(d) rate+=fwd(d,i)/Math.max(1,siloShare.get(p)||1); });
    if(rate<=0.01) return null;
    return (s.inv[i]||0)/rate;
  };
  silos.forEach(s=>{ s.coverNow=coverAt(s,todayIdx>=0?todayIdx:0); });

  const cemSilos=silos.filter(s=>s.cement);
  const cemStockEnd=cemSilos.reduce((a,s)=>a+(s.inv[n-1]||0),0);
  const cemStockStart=cemSilos.reduce((a,s)=>a+(s.inv[0]||0),0);
  const cemDemandFwd=fwd(reqDaily,Math.max(0,n-1),14)||fwd(reqDaily,Math.max(0,n-14),14);

  const requested=sum(reqDaily), served=sum(servDaily);
  return {
    r,days,dates,n,buckets,weekly,todayIdx,todayBucket,
    silos,dps,mills,kilns,packers,berths,
    byFacility,byProduct,reqDaily,servDaily,cementDaily,clinkerDaily,recv,
    facColor,prodColor,pName,fName,prodById,
    coverAt,
    totals:{
      requested, served, fill:requested>0?served/requested:null,
      shortT:Math.max(0,requested-served), shortDayCount, dpCount:dps.length,
      siloRiskDays, silosAtRisk, siloCount:silos.filter(s=>!s.inert).length,
      cemStockEnd, cemStockDelta:cemStockEnd-cemStockStart,
      cemCover:cemDemandFwd>0?cemStockEnd/cemDemandFwd:null,
      cement:sum(cementDaily), clinker:sum(clinkerDaily),
      millUtil:util(mills), kilnUtil:util(kilns),
      inbound:sum(recv.vessel)+sum(recv.rail)+sum(recv.transfer),
      vessel:sum(recv.vessel), rail:sum(recv.rail), transfer:sum(recv.transfer)
    }
  };
}

// ── SHARED DRAWING ────────────────────────────────────────────────────────
function _dashCanvas(cv,h){
  const W=cv.offsetWidth||760, H=h||220;
  const dpr=window.devicePixelRatio||1;
  cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
  cv.style.height=H+'px';
  const ctx=cv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,W,H);
  return {ctx,W,H};
}
function _dashTip(){
  let t=document.getElementById('dash2-tip');
  if(!t){
    t=document.createElement('div'); t.id='dash2-tip';
    t.style.cssText='position:fixed;z-index:100000;display:none;pointer-events:none;background:var(--surface);border:1px solid var(--border2);border-radius:3px;padding:7px 9px;font-family:var(--mono);font-size:9px;line-height:1.55;color:var(--text);box-shadow:0 10px 30px rgba(0,0,0,.6);max-width:300px';
    document.body.appendChild(t);
  }
  return t;
}
function _dashHover(el,htmlFn){
  el.onmousemove=e=>{
    const html=htmlFn(e); const t=_dashTip();
    if(!html){ t.style.display='none'; return; }
    t.innerHTML=html; t.style.display='block';
    t.style.left=Math.min(e.clientX+14,window.innerWidth-310)+'px';
    t.style.top=Math.max(8,e.clientY-40)+'px';
  };
  el.onmouseleave=()=>{ _dashTip().style.display='none'; };
}

// Stacked columns with an optional reference line on the SAME scale — the gap
// between the stack top and the line is the shortfall, drawn as white space.
function _dashStackChart(cv,m,series,lineData,lineLabel,valueOf){
  const g=_dashCanvas(cv,230); if(!g) return; const {ctx,W,H}=g;
  const P={t:14,r:14,b:26,l:56};
  const cW=W-P.l-P.r, cH=H-P.t-P.b;
  const B=m.buckets.length;
  const colTot=m.buckets.map((b,bi)=>series.reduce((s,se)=>s+b.idx.reduce((a,i)=>a+(valueOf(se,i)||0),0),0));
  const lineTot=lineData?m.buckets.map(b=>b.idx.reduce((a,i)=>a+(lineData[i]||0),0)):null;
  let max=Math.max(1,...colTot,...(lineTot||[0]));
  max=max*1.08;
  ctx.strokeStyle=_tc('rgba(255,255,255,.05)'); ctx.lineWidth=1;
  for(let i=0;i<=4;i++){ const y=P.t+cH/4*i; ctx.beginPath(); ctx.moveTo(P.l,y); ctx.lineTo(P.l+cW,y); ctx.stroke(); }
  ctx.fillStyle=_tc('#66738f'); ctx.font='8px Space Mono'; ctx.textAlign='right';
  for(let i=0;i<=4;i++){ const y=P.t+cH/4*i; ctx.fillText(_dashFmtT(max*(1-i/4)),P.l-6,y+3); }
  const bw=cW/B, gap=Math.min(3,bw*0.18);
  m.buckets.forEach((b,bi)=>{
    let acc=0; const x=P.l+bi*bw;
    series.forEach(se=>{
      const v=b.idx.reduce((a,i)=>a+(valueOf(se,i)||0),0); if(v<=0) return;
      const h=v/max*cH, y=P.t+cH-(acc+v)/max*cH;
      ctx.fillStyle=_tc(se.col); ctx.fillRect(x+gap/2,y,Math.max(1,bw-gap),Math.max(0.5,h));
      acc+=v;
    });
  });
  if(lineTot){
    ctx.strokeStyle=_tc('#e6ecf7'); ctx.lineWidth=1.6; ctx.beginPath();
    lineTot.forEach((v,bi)=>{ const x=P.l+bi*bw+bw/2, y=P.t+cH-v/max*cH; bi?ctx.lineTo(x,y):ctx.moveTo(x,y); });
    ctx.stroke();
  }
  // today marker
  if(m.todayBucket>=0){
    const x=P.l+m.todayBucket*bw+bw/2;
    ctx.strokeStyle=_tc('rgba(230,236,247,.35)'); ctx.lineWidth=1; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(x,P.t); ctx.lineTo(x,P.t+cH); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle=_tc('#93a0bc'); ctx.font='8px Space Mono'; ctx.textAlign='center';
    ctx.fillText('today',x,P.t-4);
  }
  ctx.fillStyle=_tc('#66738f'); ctx.font='8px Space Mono'; ctx.textAlign='center';
  const step=Math.max(1,Math.ceil(B/12));
  m.buckets.forEach((b,bi)=>{ if(bi%step) return; ctx.fillText(b.label,P.l+bi*bw+bw/2,H-8); });
  _dashHover(cv,e=>{
    const rect=cv.getBoundingClientRect();
    const bi=Math.floor((e.clientX-rect.left-P.l)/bw);
    if(bi<0||bi>=B) return '';
    const b=m.buckets[bi];
    let html=`<div style="color:var(--mist);border-bottom:1px solid var(--tip-rule);padding-bottom:3px;margin-bottom:3px">${b.start}${b.end!==b.start?' → '+b.end:''}</div>`;
    let tot=0;
    series.forEach(se=>{
      const v=b.idx.reduce((a,i)=>a+(valueOf(se,i)||0),0); if(v<=0.5) return; tot+=v;
      html+=`<div><span style="color:${se.col}">▪</span> ${esc(se.label)}: ${_dashFmtT(v)} t</div>`;
    });
    if(lineTot){
      const dv=lineTot[bi];
      html+=`<div style="margin-top:3px;border-top:1px solid var(--tip-rule);padding-top:3px">${lineLabel}: <b>${_dashFmtT(dv)} t</b>`;
      if(tot>0) html+=` <span style="color:var(--mist)">(${_dashPct(dv/tot)} of ${_dashFmtT(tot)} t)</span>`;
      html+='</div>';
    }
    return html;
  });
}

// ── PANELS ────────────────────────────────────────────────────────────────
function _dashTile(o){
  const sev=o.sev||'info';
  const col=sev==='crit'?DASH_ST.empty:sev==='warn'?DASH_ST.low:sev==='ok'?DASH_ST.ok:DASH_ST.info;
  return `<div class="d2-tile" style="--tc:${col}">
    <div class="d2-tile-k">${o.k}</div>
    <div class="d2-tile-v" style="color:${col}">${o.v}</div>
    <div class="d2-tile-s">${o.sub||''}</div>
    ${o.spark?`<canvas class="d2-spark" data-spark="${o.spark}"></canvas>`:''}
  </div>`;
}
function _dashSpark(cv,data,col,mode){
  const g=_dashCanvas(cv,30); if(!g) return; const {ctx,W,H}=g;
  if(!data||!data.length) return;
  const vals=data.filter(v=>v!=null);
  let lo=Math.min.apply(null,vals), hi=Math.max.apply(null,vals);
  if(mode==='ratio'){ lo=Math.min(lo,0.85); hi=1; }
  if(hi===lo){ hi=lo+1; }
  const x=i=>i/(data.length-1||1)*(W-2)+1;
  const y=v=>H-2-((v-lo)/(hi-lo))*(H-5);
  ctx.beginPath();
  data.forEach((v,i)=>{ if(v==null) return; const px=x(i),py=y(v); i?ctx.lineTo(px,py):ctx.moveTo(px,py); });
  ctx.strokeStyle=_tc(col); ctx.lineWidth=1.2; ctx.stroke();
  ctx.lineTo(x(data.length-1),H); ctx.lineTo(x(0),H); ctx.closePath();
  ctx.fillStyle=_tc(col+'22'); ctx.fill();
  const li=data.length-1;
  ctx.beginPath(); ctx.arc(x(li),y(data[li]),1.8,0,7); ctx.fillStyle=_tc(col); ctx.fill();
}

function _dashKpiHTML(m){
  const t=m.totals;
  const fillSev=t.fill==null?'info':t.fill<0.9?'crit':t.fill<0.98?'warn':'ok';
  const riskSev=t.siloRiskDays>0?(t.silosAtRisk>2?'crit':'warn'):'ok';
  const coverSev=t.cemCover==null?'info':t.cemCover<7?'crit':t.cemCover<14?'warn':'ok';
  const avg=t.requested/Math.max(1,m.n);
  const delta=t.cemStockDelta;
  return `<div class="d2-tiles">
    ${_dashTile({k:'Demand in window',v:_dashFmtT(t.requested)+' t',sub:`${t.dpCount} demand points · ${_dashFmtT(avg)} t/day`,spark:'req'})}
    ${_dashTile({k:'Fill rate',v:_dashPct(t.fill),sub:`${_dashFmtT(t.shortT)} t not delivered · ${t.shortDayCount} short demand-days`,sev:fillSev,spark:'fill'})}
    ${_dashTile({k:'Silo-days at risk',v:t.siloRiskDays.toLocaleString(),sub:`${t.silosAtRisk} of ${t.siloCount} silos empty or below floor`,sev:riskSev,spark:'risk'})}
    ${_dashTile({k:'Cement stock · end of window',v:_dashFmtT(t.cemStockEnd)+' t',sub:`${delta>=0?'+':''}${_dashFmtT(delta)} t vs start · ${t.cemCover==null?'—':t.cemCover.toFixed(1)+' d cover'}`,sev:coverSev,spark:'stock'})}
    ${_dashTile({k:'Cement produced',v:_dashFmtT(t.cement)+' t',sub:`mills ${_dashPct(t.millUtil)} · kilns ${_dashPct(t.kilnUtil)} · ${_dashFmtT(t.clinker)} t clinker`,spark:'prod'})}
    ${_dashTile({k:'Inbound supply',v:_dashFmtT(t.inbound)+' t',sub:`vessel ${_dashFmtT(t.vessel)} · rail ${_dashFmtT(t.rail)} · silo transfer ${_dashFmtT(t.transfer)}`,spark:'in'})}
  </div>`;
}

function _dashWatchHTML(m){
  const items=[];
  const dOf=i=>m.dates[i];
  // Silos that empty or breach their critical floor
  m.silos.forEach(s=>{
    if(s.inert) return;
    let firstEmpty=-1, firstFloor=-1;
    s.inv.forEach((v,i)=>{
      if(firstEmpty<0&&v<=0.5) firstEmpty=i;
      if(firstFloor<0&&s.floor>0&&v<s.floor&&v>0.5) firstFloor=i;
    });
    if(firstEmpty>=0) items.push({i:firstEmpty,sev:'crit',t:`${s.name} runs empty`,d:`${s.facName} · ${s.inv.filter(v=>v<=0.5).length} days empty in window`});
    else if(firstFloor>=0) items.push({i:firstFloor,sev:'warn',t:`${s.name} below critical floor`,d:`${s.facName} · floor ${_dashFmtT(s.floor)} t · low ${_dashFmtT(s.low)} t`});
  });
  // Demand points losing tonnes
  m.dps.forEach(dp=>{
    const req=dp.req.reduce((a,v)=>a+v,0), serv=dp.serv.reduce((a,v)=>a+v,0);
    const short=req-serv; if(short<=0.5||req<=0) return;
    let first=-1; dp.req.forEach((v,i)=>{ if(first<0&&v>0.5&&dp.serv[i]<v-0.5) first=i; });
    items.push({i:Math.max(0,first),sev:short/req>0.25?'crit':'warn',
      t:`${dp.name} unserved`,d:`${_dashFmtT(short)} t short · ${_dashPct(serv/req)} filled`});
  });
  // Vessels waiting at anchorage
  m.berths.forEach(b=>{
    const h=m.r.berthVesselHistory[b.id]||[];
    let first=-1, cnt=0;
    m.days.forEach((d,i)=>{ const e=h[d-1]; if(e&&e.waiting>0){ if(first<0) first=i; cnt++; } });
    if(first>=0) items.push({i:first,sev:'info',t:`Vessels waiting at ${b.name}`,d:`${cnt} days with a vessel at anchorage`});
  });
  // Planned maintenance
  [...m.mills,...m.kilns,...m.packers].forEach(a=>{
    let first=-1, cnt=0;
    a.state.forEach((s,i)=>{ if(s==='maintenance'){ if(first<0) first=i; cnt++; } });
    if(first>=0) items.push({i:first,sev:'info',t:`${a.name} maintenance`,d:`${cnt} planned day${cnt>1?'s':''} out`});
  });
  // Rail loading shortfalls the origin could not ship
  (m.r.railShortfalls||[]).forEach(sf=>{
    const i=m.dates.indexOf(sf.date); if(i<0) return;
    items.push({i,sev:'warn',t:`Rail short at ${sf.dpName||sf.dpId}`,d:`${sf.shortCars} of ${sf.plannedCars} cars not loaded`});
  });

  const ti=m.todayIdx>=0?m.todayIdx:0;
  const upcoming=items.filter(x=>x.i>=ti).sort((a,b)=>a.i-b.i);
  const past=items.filter(x=>x.i<ti).sort((a,b)=>b.i-a.i);
  const all=upcoming.concat(past);
  if(!all.length) return `<div class="d2-empty">Nothing on the watchlist for this window.</div>`;
  return `<div class="d2-watch">${all.slice(0,60).map(x=>{
    const col=x.sev==='crit'?DASH_ST.empty:x.sev==='warn'?DASH_ST.low:DASH_ST.info;
    const ongoing=x.i<ti;
    return `<div class="d2-w-item" style="--wc:${col}">
      <div class="d2-w-when">${dOf(x.i)}${ongoing?' <span class="d2-w-tag">ongoing</span>':''}</div>
      <div class="d2-w-t">${esc(x.t)}</div>
      <div class="d2-w-d">${esc(x.d)}</div>
    </div>`;
  }).join('')}</div>`;
}

// Each cell is classified against that silo's OWN floor and capacity, so a
// 2,500 t terminal silo and a 50,000 t plant silo are judged on equal terms.
function _dashClass(s,v){
  if(v<=0.5) return {k:'empty',c:DASH_ST.empty,l:'empty'};
  if(s.floor>0&&v<s.floor) return {k:'floor',c:DASH_ST.floor,l:'below critical floor'};
  if(s.cap>0&&v>=s.cap*0.98) return {k:'cap',c:DASH_ST.cap,l:'at capacity'};
  if(s.cap>0&&v<s.cap*0.2) return {k:'low',c:DASH_ST.low,l:'low (under 20%)'};
  return {k:'ok',c:DASH_ST.ok,l:'healthy'};
}
// Date header for the heat-strips: day numbers (every Nth when columns are tight),
// a month tag where the month changes, today's column in green.
function _dashHdrHTML(m,withUtil){
  const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const nb=m.buckets.length, step=nb<=31?1:nb<=62?2:nb<=100?4:7;
  let prevYm=null;
  const cells=m.buckets.map((b,bi)=>{
    const ym=b.start.slice(0,7), newMon=ym!==prevYm; prevYm=ym;
    const day=parseInt(b.start.slice(8),10), mon=MON[parseInt(b.start.slice(5,7),10)-1];
    const isNow=bi===m.todayBucket;
    const tip=b.start+(b.end!==b.start?' → '+b.end:'')+(isNow?' · today':'');
    const showDay=bi%step===0||isNow;
    const mark=(newMon?`<span style="top:0;bottom:auto">${mon}${b.start.slice(2,4)!==(m.buckets[0].start.slice(2,4))?" '"+b.start.slice(2,4):''}</span>`:'')+(showDay?`<span>${day}</span>`:'');
    return `<div class="d2-hdr-c${newMon?' d2-hdr-mon':''}${isNow?' d2-hdr-now':''}" title="${tip}">${mark}</div>`;
  }).join('');
  return `<div class="d2-hdr-row"><div class="d2-heat-lbl">${m.weekly?'week of':'date'}</div><div class="d2-hdr-cells">${cells}</div>${withUtil?'<div class="d2-util"></div>':''}</div>`;
}

function _dashHeatHTML(m){
  const silos=m.silos.slice().sort((a,b)=>(a.facName||'').localeCompare(b.facName||'')||(a.name||'').localeCompare(b.name||''));
  if(!silos.length) return `<div class="d2-empty">No silos in this slice.</div>`;
  let rows='', lastFac=null;
  silos.forEach(s=>{
    if(s.facName!==lastFac){ lastFac=s.facName; rows+=`<div class="d2-heat-fac">${esc(lastFac)}</div>`; }
    const cells=m.buckets.map((b,bi)=>{
      // Worst day in the bucket decides the colour, so a short breach is never averaged away.
      let worst=null, worstV=null;
      b.idx.forEach(i=>{
        const v=s.inv[i]||0, c=_dashClass(s,v);
        const rank={empty:0,floor:1,low:2,cap:3,ok:4}[c.k];
        if(worst==null||rank<worst.rank){ worst={rank,c}; worstV=v; }
      });
      const c=worst?worst.c:{c:DASH_ST.none,l:''};
      const pct=s.cap>0?Math.round(worstV/s.cap*100)+'%':'—';
      const cov=m.coverAt(s,b.idx[0]);
      const tip=`${s.name} · ${b.start}${b.end!==b.start?' → '+b.end:''}\n${Math.round(worstV).toLocaleString()} t (${pct} of capacity) · ${c.l}\nfloor ${Math.round(s.floor).toLocaleString()} t${cov!=null?' · '+cov.toFixed(1)+' d cover':''}`;
      return `<div class="d2-cell${s.inert?' d2-inert':''}${bi===m.todayBucket?' d2-now':''}" style="background:${s.inert?'transparent':c.c}" title="${esc(tip)}"></div>`;
    }).join('');
    rows+=`<div class="d2-heat-row"><div class="d2-heat-lbl" title="${esc(s.name)} · cap ${Math.round(s.cap).toLocaleString()} t">${esc(s.name)}</div><div class="d2-heat-cells">${cells}</div></div>`;
  });
  const legend=[['empty',DASH_ST.empty],['below floor',DASH_ST.floor],['low (<20%)',DASH_ST.low],['healthy',DASH_ST.ok],['at capacity',DASH_ST.cap]]
    .map(([l,c])=>`<span class="d2-lg"><i style="background:${c}"></i>${l}</span>`).join('');
  return `<div class="d2-heat">${_dashHdrHTML(m,false)}${rows}</div>
    <div class="d2-legend">${legend}<span class="d2-lg"><i class="d2-lg-inert"></i>holds nothing, feeds no demand</span>
    <span class="d2-lg-note">${m.weekly?'one column per week · worst day decides the colour':'one column per day'}</span></div>`;
}

function _dashBoardHTML(m){
  const i=m.todayIdx>=0?m.todayIdx:0;
  const rows=m.silos.filter(s=>!s.inert).map(s=>({s,v:s.inv[i]||0,cov:m.coverAt(s,i)}))
    .sort((a,b)=>{
      const ae=a.v<=0.5?0:1, be=b.v<=0.5?0:1;
      if(ae!==be) return ae-be;
      const ac=a.cov==null?9e9:a.cov, bc=b.cov==null?9e9:b.cov;
      return ac-bc;
    });
  if(!rows.length) return `<div class="d2-empty">No silos in this slice.</div>`;
  return `<div class="d2-board">${rows.map(({s,v,cov})=>{
    const cls=_dashClass(s,v);
    const pct=s.cap>0?Math.min(100,v/s.cap*100):0;
    const fp=s.cap>0?Math.min(100,s.floor/s.cap*100):0;
    const tp=s.cap>0?Math.min(100,s.target/s.cap*100):0;
    const lp=s.cap>0?Math.min(100,s.low/s.cap*100):0;
    return `<div class="d2-b-row">
      <div class="d2-b-name" title="${esc(s.name)} · ${esc(s.facName)}"><b>${esc(s.name)}</b><span>${esc(s.facName)}</span></div>
      <div class="d2-b-bullet" title="${esc(`${Math.round(v).toLocaleString()} t of ${Math.round(s.cap).toLocaleString()} t (${Math.round(pct)}%) · floor ${Math.round(s.floor).toLocaleString()} t · target ${Math.round(s.target).toLocaleString()} t · low point ${Math.round(s.low).toLocaleString()} t`)}">
        <div class="d2-b-fill" style="width:${pct}%;background:${cls.c}"></div>
        ${s.floor>0?`<i class="d2-b-floor" style="left:${fp}%"></i>`:''}
        ${s.target>0?`<i class="d2-b-target" style="left:${tp}%"></i>`:''}
        <i class="d2-b-low" style="left:${lp}%"></i>
      </div>
      <div class="d2-b-t">${_dashFmtT(v)} t</div>
      <div class="d2-b-cov" style="color:${cov==null?'var(--axis)':cov<7?DASH_ST.empty:cov<14?DASH_ST.low:'var(--mist)'}">${cov==null?'—':cov.toFixed(cov<10?1:0)+'d'}</div>
      <canvas class="d2-b-spark" data-silo="${s.id}"></canvas>
    </div>`;
  }).join('')}</div>
  <div class="d2-legend"><span class="d2-lg"><i style="background:${DASH_ST.ok}"></i>level today</span>
  <span class="d2-lg"><i class="d2-lg-floor"></i>critical floor</span>
  <span class="d2-lg"><i class="d2-lg-target"></i>target</span>
  <span class="d2-lg"><i class="d2-lg-low"></i>low point in window</span>
  <span class="d2-lg-note">days of cover on the right · sorted by risk</span></div>`;
}

function _dashServiceHTML(m){
  const rows=m.dps.map(dp=>{
    const req=dp.req.reduce((a,v)=>a+v,0), serv=dp.serv.reduce((a,v)=>a+v,0);
    let shortDays=0; dp.req.forEach((v,i)=>{ if(v>0.5&&dp.serv[i]<v-0.5) shortDays++; });
    return {dp,req,serv,fill:req>0?serv/req:null,shortDays};
  }).filter(x=>x.req>0.5).sort((a,b)=>(a.fill==null?2:a.fill)-(b.fill==null?2:b.fill));
  if(!rows.length) return `<div class="d2-empty">No demand in this slice.</div>`;
  return `<div class="d2-svc">${rows.map(x=>{
    const col=x.fill>=0.98?DASH_ST.ok:x.fill>=0.9?DASH_ST.low:DASH_ST.empty;
    return `<div class="d2-svc-row" title="${esc(`${x.dp.name} · requested ${Math.round(x.req).toLocaleString()} t · delivered ${Math.round(x.serv).toLocaleString()} t`)}">
      <div class="d2-svc-name"><b>${esc(x.dp.name)}</b><span>${esc(x.dp.facName)}</span></div>
      <div class="d2-svc-bar"><div style="width:${Math.max(0.5,(x.fill||0)*100)}%;background:${col}"></div></div>
      <div class="d2-svc-pct" style="color:${col}">${_dashPct(x.fill)}</div>
      <div class="d2-svc-sub">${x.req-x.serv>0.5?_dashFmtT(x.req-x.serv)+' t short · '+x.shortDays+'d':'served in full'}</div>
    </div>`;
  }).join('')}</div>`;
}

function _dashTimelineHTML(m){
  const assets=[...m.kilns,...m.mills,...m.packers];
  if(!assets.length) return `<div class="d2-empty">No kilns, mills or packers in this slice.</div>`;
  const rows=assets.map(a=>{
    let made=0, ratedDays=0;
    const rated=Math.max.apply(null,DB.element_product_capacities.filter(c=>c.element_id===a.id)
      .map(c=>parseFloat(c.capacity_tpd)||0).concat([parseFloat(a.el.props&&a.el.props.rated_capacity_tpd)||0,0]));
    const cells=m.buckets.map((b,bi)=>{
      // Dominant state in the bucket; the tooltip carries the full mix.
      const tally={}; let bt=0, bpid=null, bpidT=0;
      b.idx.forEach(i=>{
        const st=a.state[i], run=(a.tpd[i]||0)>0;
        const key=run?'running':st;
        tally[key]=(tally[key]||0)+1;
        bt+=a.tpd[i]||0;
        if(run&&a.pid[i]){ if(!bpid||a.pid[i]===bpid) { bpid=a.pid[i]; bpidT+=a.tpd[i]||0; } }
      });
      const dom=Object.entries(tally).sort((x,y)=>y[1]-x[1])[0];
      const kind=dom?dom[0]:'idle';
      let col=DASH_ST.idle, lbl=kind;
      if(kind==='running'){
        col=a.kind==='kiln'?DASH_ST.ok:(bpid?(m.prodColor.get(bpid)||DASH_CAT[0]):DASH_CAT[0]);
        lbl=a.kind==='kiln'?'running':(bpid?m.pName(bpid):'running');
      }
      else if(kind==='maintenance'){ col=DASH_ST.maint; lbl='maintenance'; }
      else if(kind==='starved'){ col=DASH_ST.low; lbl='starved'; }
      else if(kind==='blocked'){ col=DASH_ST.empty; lbl='blocked'; }
      else if(kind==='rampup'){ col=DASH_ST.info; lbl='ramp-up'; }
      made+=bt;
      b.idx.forEach(i=>{ if(a.state[i]!=='maintenance') ratedDays++; });
      const tip=`${a.name} · ${b.start}${b.end!==b.start?' → '+b.end:''}\n${lbl}${bt>0?' · '+Math.round(bt).toLocaleString()+' t':''}`;
      return `<div class="d2-cell${bi===m.todayBucket?' d2-now':''}" style="background:${col}" title="${esc(tip)}"></div>`;
    }).join('');
    const u=rated>0&&ratedDays>0?made/(rated*ratedDays):null;
    return `<div class="d2-heat-row">
      <div class="d2-heat-lbl" title="${esc(a.name+' · '+a.facName)}">${esc(a.name)}<span class="d2-k">${a.kind}</span></div>
      <div class="d2-heat-cells">${cells}</div>
      <div class="d2-util">${_dashPct(u)}</div>
    </div>`;
  }).join('');
  const legend=[['maintenance',DASH_ST.maint],['starved',DASH_ST.low],['blocked',DASH_ST.empty],['idle',DASH_ST.idle]]
    .map(([l,c])=>`<span class="d2-lg"><i style="background:${c}"></i>${l}</span>`).join('');
  return `<div class="d2-heat">${_dashHdrHTML(m,true)}${rows}</div>
    <div class="d2-legend"><span class="d2-lg-note">running mills wear the colour of the product they grind · kilns green</span>${legend}
    <span class="d2-lg-note">utilisation on the right excludes maintenance days</span></div>`;
}

// ── RENDER ────────────────────────────────────────────────────────────────
function renderDashboard(){
  if(!_IDX.depth) return _idxRun(()=>renderDashboard.apply(this,arguments)); // fast lookups for this whole block
  const host=document.getElementById('dash2-inner'); if(!host) return;
  if(!S.simResults){
    host.innerHTML=`<div class="d2-empty" style="margin:22px">Run a simulation to build the dashboard.</div>`;
    return;
  }
  const m=_dashModel();
  if(!m){ host.innerHTML=`<div class="d2-empty" style="margin:22px">No simulation output for this window.</div>`; return; }
  window._dashM=m;
  const by=(window._dashState&&window._dashState.demandBy)||'facility';
  const stack=by==='product'?m.byProduct:m.byFacility;
  // Beyond eight series the remainder folds into a grey "Other" rather than
  // inventing a ninth hue.
  const head=stack.slice(0,8);
  const tail=stack.slice(8);
  const series=head.concat(tail.length?[{key:'_other',label:'Other',col:DASH_OTHER,
    req:m.reqDaily.map((_,i)=>tail.reduce((a,s)=>a+s.req[i],0)),
    serv:m.servDaily.map((_,i)=>tail.reduce((a,s)=>a+s.serv[i],0))}]:[]);

  host.innerHTML=`
    ${_dashKpiHTML(m)}
    <div class="d2-grid">
      <div class="d2-panel d2-w8">
        <div class="d2-hd">Demand &amp; service
          <span class="d2-hd-sub">${m.weekly?'weekly columns':'daily columns'} · stack = requested, line = delivered</span>
          <span class="d2-toggle">
            <button class="${by==='facility'?'on':''}" onclick="_dashSetBy('facility')">by facility</button>
            <button class="${by==='product'?'on':''}" onclick="_dashSetBy('product')">by product</button>
          </span>
        </div>
        <div class="d2-body">
          <canvas id="d2-demand"></canvas>
          <div class="d2-legend">${series.map(s=>`<span class="d2-lg"><i style="background:${s.col}"></i>${esc(s.label)}</span>`).join('')}
            <span class="d2-lg"><i class="d2-lg-line"></i>delivered</span></div>
        </div>
      </div>
      <div class="d2-panel d2-w4">
        <div class="d2-hd">Watchlist <span class="d2-hd-sub">soonest first</span></div>
        <div class="d2-body d2-scroll">${_dashWatchHTML(m)}</div>
      </div>
      <div class="d2-panel d2-w12">
        <div class="d2-hd">Inventory health <span class="d2-hd-sub">every silo, whole window, judged against its own floor and capacity</span></div>
        <div class="d2-body">${_dashHeatHTML(m)}</div>
      </div>
      <div class="d2-panel d2-w7">
        <div class="d2-hd">Inventory position <span class="d2-hd-sub">${m.todayIdx>=0?'level today':'level at window start'} · sorted by risk</span></div>
        <div class="d2-body d2-scroll">${_dashBoardHTML(m)}</div>
      </div>
      <div class="d2-panel d2-w5">
        <div class="d2-hd">Service by demand point <span class="d2-hd-sub">delivered share</span></div>
        <div class="d2-body d2-scroll">${_dashServiceHTML(m)}</div>
      </div>
      <div class="d2-panel d2-w12">
        <div class="d2-hd">Asset timeline <span class="d2-hd-sub">what every kiln, mill and packer actually did</span></div>
        <div class="d2-body">${_dashTimelineHTML(m)}</div>
      </div>
      <div class="d2-panel d2-w12">
        <div class="d2-hd">Supply mix <span class="d2-hd-sub">where cement enters the network, against demand, on one axis</span></div>
        <div class="d2-body">
          <canvas id="d2-supply"></canvas>
          <div class="d2-legend">
            <span class="d2-lg"><i style="background:${DASH_CAT[2]}"></i>own production</span>
            <span class="d2-lg"><i style="background:${DASH_CAT[0]}"></i>vessel</span>
            <span class="d2-lg"><i style="background:${DASH_CAT[6]}"></i>rail</span>
            <span class="d2-lg"><i style="background:${DASH_CAT[3]}"></i>silo transfer</span>
            <span class="d2-lg"><i class="d2-lg-line"></i>demand</span>
          </div>
        </div>
      </div>
    </div>`;

  // Charts
  const dc=document.getElementById('d2-demand');
  if(dc) _dashStackChart(dc,m,series,m.servDaily,'delivered',(s,i)=>s.req[i]);
  const sc=document.getElementById('d2-supply');
  if(sc) _dashStackChart(sc,m,[
    {label:'own production',col:DASH_CAT[2],d:m.cementDaily},
    {label:'vessel',col:DASH_CAT[0],d:m.recv.vessel},
    {label:'rail',col:DASH_CAT[6],d:m.recv.rail},
    {label:'silo transfer',col:DASH_CAT[3],d:m.recv.transfer}
  ],m.reqDaily,'demand',(s,i)=>s.d[i]);

  // Sparklines
  const roll=(req,serv,k)=>req.map((_,i)=>{
    let a=0,b=0; for(let j=Math.max(0,i-(k-1));j<=i;j++){ a+=req[j]||0; b+=serv[j]||0; }
    return a>0?b/a:null;
  });
  const riskDaily=m.days.map((_,i)=>m.silos.reduce((a,s)=>a+(!s.inert&&((s.inv[i]||0)<=0.5||(s.floor>0&&(s.inv[i]||0)<s.floor))?1:0),0));
  const stockDaily=m.days.map((_,i)=>m.silos.filter(s=>s.cement).reduce((a,s)=>a+(s.inv[i]||0),0));
  const inDaily=m.days.map((_,i)=>(m.recv.vessel[i]||0)+(m.recv.rail[i]||0)+(m.recv.transfer[i]||0));
  const sparks={req:[m.reqDaily,DASH_ST.info],fill:[roll(m.reqDaily,m.servDaily,7),m.totals.fill!=null&&m.totals.fill<0.9?DASH_ST.empty:m.totals.fill!=null&&m.totals.fill<0.98?DASH_ST.low:DASH_ST.ok],
    risk:[riskDaily,m.totals.siloRiskDays>0?DASH_ST.low:DASH_ST.ok],stock:[stockDaily,DASH_ST.info],
    prod:[m.cementDaily,DASH_ST.info],in:[inDaily,DASH_ST.info]};
  host.querySelectorAll('canvas[data-spark]').forEach(cv=>{
    const s=sparks[cv.dataset.spark]; if(!s) return;
    _dashSpark(cv,s[0],s[1],cv.dataset.spark==='fill'?'ratio':'');
  });
  host.querySelectorAll('canvas[data-silo]').forEach(cv=>{
    const s=m.silos.find(x=>x.id===cv.dataset.silo); if(!s) return;
    const g=_dashCanvas(cv,22); if(!g) return; const {ctx,W,H}=g;
    const hi=Math.max(1,s.cap||Math.max.apply(null,s.inv));
    ctx.beginPath();
    s.inv.forEach((v,i)=>{ const x=i/(s.inv.length-1||1)*(W-2)+1, y=H-1-(v/hi)*(H-3); i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
    ctx.strokeStyle=_tc('#93a0bc'); ctx.lineWidth=1; ctx.stroke();
    if(s.floor>0){
      const y=H-1-(s.floor/hi)*(H-3);
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y);
      ctx.strokeStyle=_tc('rgba(230,103,103,.5)'); ctx.setLineDash([2,2]); ctx.stroke(); ctx.setLineDash([]);
    }
  });
}

function _dashSetBy(k){
  if(!window._dashState) window._dashState={};
  window._dashState.demandBy=k;
  renderDashboard();
}

let _dashRz=null;
window.addEventListener('resize',()=>{
  if(S.view!=='dashboard') return;
  clearTimeout(_dashRz);
  _dashRz=setTimeout(()=>{ if(S.view==='dashboard') renderDashboard(); },200);
});

