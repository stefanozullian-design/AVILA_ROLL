// ═══════════════════════════════════════════════════════
// CHAT AGENT
// ═══════════════════════════════════════════════════════
function chatKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}}

// Running conversation, so follow-up questions ("why is that happening?") have
// something to refer back to. chatTurnStarts marks where each user-initiated
// turn begins in chatHistory (a turn can span several messages once tool use
// is involved); trimming only ever cuts at a turn boundary so an assistant
// tool_use block is never separated from its tool_result reply.
let chatHistory=[];
let chatTurnStarts=[];
const CHAT_MAX_TURNS=8;

// A key typed into this browser wins; otherwise the team's shared key file (aiPickSharedKey).
function getApiKey(){return localStorage.getItem('avila_api_key')||localStorage.getItem('avila_api_key_shared')||'';}

// Single entry point for every Anthropic API call (rule interpreter, settings
// connection test, agent chat). Returns the parsed response body — callers
// keep their own data.error handling; network failures throw.
async function callClaude({model, maxTokens=300, system, messages, tools}){
  const body={
    model: model||localStorage.getItem('avila_ai_model')||'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages
  };
  if(system) body.system=system;
  if(tools&&tools.length) body.tools=tools;
  const res=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'x-api-key':getApiKey(),
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true'
    },
    body:JSON.stringify(body)
  });
  return await res.json();
}
function updateKeyUI(){
  const k=getApiKey();
  const row=document.getElementById('chat-key-row');
  const set=document.getElementById('chat-key-set');
  if(row) row.style.display=k?'none':'block';
  if(set) set.style.display=k?'block':'none';
}
function jumpToAiConfig(){
  toggleChat();
  switchTopSection('configuration');
  renderCfgPanel('ai');
}

// ── AGENT TOOLS ──────────────────────────────────────────
// Real read access to the last simulation result, plus a sandboxed "what if"
// runner. Sandboxed runs call simulate() directly (never runSimulation()), so
// they never touch DB.vessel_calls, never autoSave(), and never write the
// scenario file to disk — config/maintenance overrides are snapshotted and
// restored in a finally block regardless of outcome.
function agentFindElement(name){
  if(!name) return null;
  const els=getFacElements();
  const q=String(name).toLowerCase();
  return els.find(e=>e.name.toLowerCase()===q) || els.find(e=>e.name.toLowerCase().includes(q)) || null;
}

function agentToolGetStopEvents({element_name, type, limit}={}){
  const r=S.simResults;
  if(!r) return {error:'No simulation has been run yet for the active facility.'};
  let events=r.stopEvents||[];
  if(element_name){
    const el=agentFindElement(element_name);
    if(!el) return {error:`No element found matching "${element_name}".`};
    events=events.filter(e=>e.element_id===el.id);
  }
  if(type) events=events.filter(e=>e.type===type);
  events=events.slice().sort((a,b)=>b.day-a.day).slice(0, limit||20);
  return {
    count:events.length,
    events: events.map(e=>({element:e.element_name, type:e.type, cause:e.cause, date:dayToDate(e.day)}))
  };
}

function agentToolGetInventoryOnDate({element_name, date}={}){
  const r=S.simResults;
  if(!r) return {error:'No simulation has been run yet for the active facility.'};
  const el=agentFindElement(element_name);
  if(!el) return {error:`No element found matching "${element_name}".`};
  const series=r.inventoryHistory?.[el.id];
  if(!series) return {error:`"${esc(el.name)}" has no inventory series (it may not be a storage element).`};
  const idx=dateToDayOffset(date, S.simCfg.start_date);
  if(idx<0||idx>=series.length) return {error:`${date} is outside the simulated horizon (${S.simCfg.start_date} + ${series.length}d).`};
  return {element:el.name, date, inventory_tonnes:series[idx]};
}

async function agentToolRunWhatif({horizon_days, maintenance_overrides}={}){
  if(!S.facility_id) return {error:'No active facility selected.'};
  if(_simQ.running) return {error:'A real simulation is running right now — try again in a moment.'};
  const origHorizon=S.simCfg.horizon;
  const maintSnapshot=JSON.stringify(DB.element_maintenance_events);
  const skipped=[];
  try{
    if(horizon_days) S.simCfg.horizon=parseInt(horizon_days)||origHorizon;
    for(const mo of (maintenance_overrides||[])){
      const el=agentFindElement(mo.element_name);
      if(!el){skipped.push(mo.element_name);continue;}
      DB.element_maintenance_events.push({
        id:`whatif_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
        element_id:el.id, facility_id:S.facility_id, element_name:el.name, element_type:el.type,
        name:'What-if outage', type:'fixed', start_date:mo.start_date,
        duration_days:parseFloat(mo.duration_days)||1, end_date:null,
        frequency_days:null, recurrence_end_date:null, rampup_days:0, rampup_profile:[],
        notes:'Sandboxed AI what-if — not saved'
      });
    }
    const horizon=_simEffectiveHorizon();
    const r=simulate(getFacElements(), getFacConnections(), horizon, true);
    const baseline=S.simResults;
    return {
      horizon_days:horizon,
      fulfillment_pct:r.fulfillmentPct,
      stop_event_count:(r.stopEvents||[]).length,
      baseline_fulfillment_pct: baseline?baseline.fulfillmentPct:null,
      baseline_stop_event_count: baseline?(baseline.stopEvents||[]).length:null,
      new_stop_events:(r.stopEvents||[]).slice(0,15).map(e=>({element:e.element_name,type:e.type,cause:e.cause,date:dayToDate(e.day)})),
      skipped_elements: skipped.length?skipped:undefined,
      note:'This was a sandboxed trial only — nothing was saved, the real plan is unchanged. fulfillment_pct is a stop-event penalty score (100 minus a penalty per non-maintenance stop day), not literally the percent of demand tonnage delivered — describe it that way to the user, not as "% fulfilled".'
    };
  } finally {
    S.simCfg.horizon=origHorizon;
    DB.element_maintenance_events=JSON.parse(maintSnapshot);
  }
}

function _agentProdName(pid){ const p=(DB.products||[]).find(x=>x.id===pid); return p?p.name:pid; }

// Static production/capacity digest for the active facility — lets the agent reason
// about bottlenecks (which mill can make what, clinker factors, demand by product).
function agentToolGetProductionModel(){
  if(!S.facility_id) return {error:'No active facility selected.'};
  const els=getFacElements();
  const byId=Object.fromEntries(els.map(e=>[e.id,e]));
  const rec={};
  (DB.recipes||[]).forEach(r=>{ if(r.product_id&&r.material_id!=null){ (rec[r.product_id]=rec[r.product_id]||{})[r.material_id]=r.pct; }});
  const clinkerFactor=pid=>{ const m=rec[pid]||{}; let f=0; Object.entries(m).forEach(([mid,pct])=>{ if(/clk|clinker/i.test(mid)) f+=(+pct||0); }); return f?Math.round(f*10)/10:null; };
  const caps=DB.element_product_capacities||[];
  const prodEls=els.filter(e=>['kiln','finish_mill','cement_mill','raw_mill','packing_plant'].includes(e.type)).map(e=>({
    name:e.name, type:e.type,
    can_make:caps.filter(c=>c.element_id===e.id).map(c=>({product:_agentProdName(c.product_id), rate_tpd:c.capacity_tpd}))
  }));
  const eligible={};
  caps.filter(c=>byId[c.element_id]).forEach(c=>{ (eligible[c.product_id]=eligible[c.product_id]||new Set()).add(byId[c.element_id].name); });
  const silos=els.filter(e=>['bulk_silo','packed_silo','clinker_silo'].includes(e.type)).map(e=>({
    name:e.name, type:e.type, capacity_t:e.props?.max_capacity||0, start_inventory_t:e.props?.start_inventory||0,
    products:(e.props?.products||[e.props?.product_id]).filter(Boolean).map(_agentProdName)
  }));
  const start=S.simCfg.start_date, horizon=_simEffectiveHorizon();
  const endD=_addDays(start,horizon);   // exclusive end, by calendar (+horizon×24h lost the last day across the Nov DST change)
  const demByPoint={};
  els.filter(e=>e.type==='demand_point').forEach(e=>{
    let tot=0; (DB.demand_values||[]).forEach(v=>{ if(v.element_id===e.id && v.date>=start && v.date<endD) tot+=(+v.value_t||0); });
    if(tot>0){ const dpRec=DB.demand_points.find(d=>d.element_id===e.id); demByPoint[e.name]={annual_t:Math.round(tot), products:(dpRec?.products||[]).map(p=>_agentProdName(p.product_id))}; }
  });
  const maint=(DB.element_maintenance_events||[]).filter(m=>byId[m.element_id]).map(m=>({element:m.element_name, type:m.type, start:m.start_date, duration_days:m.duration_days, every_days:m.frequency_days||null}));
  return {
    facility:getFacility()?.name, start_date:start, horizon_days:horizon,
    clinker_factors_pct:Object.fromEntries((DB.products||[]).map(p=>[p.name,clinkerFactor(p.id)]).filter(x=>x[1]!=null)),
    production_elements:prodEls,
    product_can_be_made_by:Object.fromEntries(Object.entries(eligible).map(([pid,s])=>[_agentProdName(pid),[...s]])),
    silos, demand_by_point:demByPoint, maintenance:maint,
    note:'Rates in t/day. product_can_be_made_by lists the ONLY mills able to grind each product — a product with a single eligible mill is a likely bottleneck. Use find_max_demand for exact stock-out ceilings.'
  };
}

// Run a sandbox sim with one demand point scaled by `mult` (nothing saved).
function _agentSimWithDemand(targetElId, mult){
  const dvSnap=DB.demand_values;
  try{
    DB.demand_values=DB.demand_values.map(v=> v.element_id===targetElId ? {...v, value_t:(parseFloat(v.value_t)||0)*mult} : v);
    _demandCacheInvalidate();
    return simulate(getFacElements(), getFacConnections(), _simEffectiveHorizon(), true);
  } finally { DB.demand_values=dvSnap; _demandCacheInvalidate(); }
}

// Binary-search the max demand of one point before ANY OTHER product can't be fully served.
async function agentToolFindMaxDemand({demand_point, max_multiplier=4, tolerance_pct=1}={}){
  if(!S.facility_id) return {error:'No active facility selected.'};
  if(typeof _simQ!=='undefined' && _simQ.running) return {error:'A real simulation is running — try again in a moment.'};
  const target=agentFindElement(demand_point);
  if(!target || target.type!=='demand_point') return {error:`No demand point matching "${demand_point}". Use get_production_model to see demand point names.`};
  const tol=Math.max(0,(tolerance_pct||1)/100);
  const shortMap=(r)=>{ const m={};
    Object.entries(r.demandFill||{}).forEach(([id,df])=>{ if(id===target.id) return;
      m[id]={name:df.name, products:(df.products||[]).map(_agentProdName).join(', ')||df.name, requested:df.requested, served:df.served, short:Math.max(0,df.requested-df.served), shortDays:df.shortDays}; });
    return m; };
  let runs=0;
  const sim=m=>{ runs++; return _agentSimWithDemand(target.id,m); };
  const base=sim(1);
  const baseAnnual=Math.round((base.demandFill[target.id]||{requested:0}).requested);
  const baseShort=shortMap(base);
  // Pre-existing shortfalls (already short before we touch anything) — reported as context, not the answer.
  const preExisting=Object.values(baseShort).filter(d=>d.requested>0 && d.served<d.requested*(1-tol))
    .map(d=>({product:d.products, point:d.name, short_t:Math.round(d.short)})).sort((a,b)=>b.short_t-a.short_t);
  // A stock-out CAUSED BY the increase = a point that gets materially worse than baseline.
  const newlyBroken=(r)=>{ const cur=shortMap(r); const out=[];
    Object.entries(cur).forEach(([id,d])=>{ const b=baseShort[id]||{short:0}; const thr=Math.max(50, d.requested*tol);
      if(d.short > b.short + thr) out.push({product:d.products, point:d.name, short_t:Math.round(d.short), extra_short_vs_now_t:Math.round(d.short-b.short), short_days:d.shortDays}); });
    return out.sort((a,b)=>b.extra_short_vs_now_t-a.extra_short_vs_now_t); };
  let lo=1, hi=null, m=2;
  while(m<=max_multiplier){ if(newlyBroken(sim(m)).length){ hi=m; break; } lo=m; m*=2; }
  const common={ demand_point:target.name, current_annual_t:baseAnnual, sim_runs:0,
    already_short_at_current_demand: preExisting.length?preExisting.slice(0,5):undefined };
  if(hi===null){ common.sim_runs=runs; common.status='no_extra_stockout_within_range';
    common.max_annual_t=Math.round(baseAnnual*max_multiplier);
    common.message=`Pushing this demand up to ${max_multiplier}× (~${Math.round(baseAnnual*max_multiplier).toLocaleString()} t/yr) doesn't push any OTHER product further short than it already is`+(preExisting.length?` (note: ${preExisting.length} point(s) are already short at today's demand — see already_short_at_current_demand)`:`.`);
    return common; }
  let firstBreak=null;
  for(let i=0;i<7;i++){ const mid=(lo+hi)/2; const nb=newlyBroken(sim(mid)); if(nb.length){ hi=mid; firstBreak=nb; } else lo=mid; }
  common.sim_runs=runs; common.status='found';
  common.max_annual_t=Math.round(baseAnnual*lo);
  common.headroom_t=Math.round(baseAnnual*lo)-baseAnnual;
  common.max_multiple_of_current=Math.round(lo*100)/100;
  common.first_product_to_stock_out=firstBreak?firstBreak[0]:null;
  common.note='Max annual demand for this point (holding production & maintenance as-is) before it pushes ANOTHER product further short than it is today. From binary-searched sandbox sims — nothing saved; demand scaled proportionally. Report max_annual_t, the first product to break, and mention any already_short points as separate context.';
  return common;
}

// Generate a downloadable HTML report from agent-provided content.
function agentToolCreateReport({title, subtitle, sections}={}){
  if(!title || !Array.isArray(sections)) return {error:'Provide a title and a sections array ([{heading, body, table?}]).'};
  const esc=s=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const mdInline=s=>esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`(.+?)`/g,'<code>$1</code>');
  const secHtml=(sections||[]).map(sec=>{
    let h=`<h2>${esc(sec.heading||'')}</h2>`;
    if(sec.body) h+=sec.body.split(/\n\n+/).map(p=>`<p>${p.split('\n').map(mdInline).join('<br>')}</p>`).join('');
    if(sec.table&&sec.table.rows){ const t=sec.table;
      h+=`<table>${t.headers?`<tr>${t.headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr>`:''}${t.rows.map(row=>`<tr>${row.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table>`; }
    return h;
  }).join('');
  const doc=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a2233;max-width:820px;margin:0 auto;padding:36px 30px;line-height:1.55;font-size:14px}h1{font-size:23px;margin:0 0 3px}.sub{color:#5b6b86;font-size:13px;margin-bottom:8px;border-bottom:2px solid #d7deea;padding-bottom:14px}h2{font-size:16px;margin:26px 0 8px;border-bottom:1px solid #d7deea;padding-bottom:5px}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:12.5px}th,td{border:1px solid #d7deea;padding:6px 9px;text-align:right}th{background:#f4f7fb}th:first-child,td:first-child{text-align:left}code{background:#f4f7fb;padding:1px 5px;border-radius:3px;font-size:12.5px}.foot{margin-top:36px;padding-top:12px;border-top:1px solid #d7deea;color:#5b6b86;font-size:11px}@media print{body{padding:0}}</style></head>
<body><h1>${esc(title)}</h1><div class="sub">${mdInline(subtitle||'')}</div>${secHtml}
<div class="foot">Generated by the AVILA Roll AI agent · ${new Date().toLocaleString()}</div></body></html>`;
  try{
    const blob=new Blob([doc],{type:'text/html'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url;
    a.download=(title.replace(/[\\/:*?"<>|]/g,'').slice(0,60)||'AVILA_report')+'.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
    if(typeof statMsg==='function') statMsg('Report downloaded: '+a.download);
    return {ok:true, filename:a.download, note:'The report was downloaded to the user\'s computer. Tell them the filename and that they can open it in a browser and print to PDF.'};
  }catch(e){ return {error:'Could not generate the report: '+e.message}; }
}

// ── AGENT DATA EDITING ───────────────────────────────────
// The agent may change planning DATA — records the planner could also edit by hand — never
// the simulation logic, settings or topology. Every change is two steps: a finder tool
// returns records with short refs ("r12") or leftover groups ("g3"), then
// propose_data_changes names those refs. The proposal is drawn in the chat as a card and
// NOTHING is touched until the user clicks Apply; an applied card keeps an Undo button.
// Applying follows a manual edit's path: autoSave, demand caches/renders, debounced re-run.
const AGENT_EDIT_TABLES={
  real_rail_daily:{date:'date', label:'real rail record', note:'Actuals, by type: loading (cars loaded at an origin), dispatched (cars that left an origin for dest_facility_id — replaces that switch\'s planned pushes), yard_count (cars available at an origin switch), railyard_count / localyard_count (physical count at a terminal), placed (spotted rail yard → local yard). Deleting a row removes the actual and the plan takes over again; cars 0 records that really nothing happened.'},
  rail_movements:{date:'departure_date', label:'rail push', note:'Planned rail shipments; status Confirmed = operator push from the Rail Schedule. To stop a push, update wagon_count to 0 (total_capacity_t follows) — DELETING a Confirmed push makes the Rail Schedule suggest the cars again. Delete only leftovers.'},
  rail_loading_plan:{date:'date_from', label:'rail loading plan', note:'Cars/day loaded per product at a rail dispatch point. No dates = base rate; dated rows override that range.'},
  vessel_calls:{date:'arrival_date', label:'vessel call'},
  vessel_campaigns:{date:'start_date', label:'vessel status override'},
  silo_transfer_plans:{date:'start_date', label:'silo transfer plan', note:'Planned tonnes/day moved from from_silo_id to to_silo_id along silo link link_id (see silo_links). A one-day row (start_date = end_date) overrides a broader campaign on its day.'},
  real_silo_transfers_daily:{date:'date', label:'real silo transfer', note:'Tonnes actually moved from from_silo_id to to_silo_id along silo link link_id that day — wins over the plan.'},
  production_campaigns:{date:'start_date', label:'production campaign', note:'product_id values starting with "__" (e.g. __down_repair__, __down_pm__, __down_inv__) are special downtime markers, not products.'},
  element_maintenance_events:{date:'start_date', label:'maintenance event'},
  demand_values:{date:'date', label:'demand value', note:'One row per demand point (element_id) per date; source actual = shipped, forecast = plan. The table is large — always filter by element_id and a date range.'},
  real_production_daily:{date:'date', label:'real production'},
  real_inventory_daily:{date:'date', label:'real inventory'},
  real_transfers_daily:{date:'date', label:'real transfer'},
  real_shipping_daily:{date:'date', label:'real shipping'},
  real_unloading_daily:{date:'date', label:'real unloading'},
  non_working_days:{date:'date', label:'non-working day'}
};
const _AGENT_EL_FIELDS=/^(element_id|dispatch_id|from_dispatch_id|to_berth_id|berth_id|silo_id|berth_element_id|to_element_id|from_element_id|from_silo_id|to_silo_id)$/;
const _AGENT_QTY=['cars','wagon_count','value_t','volume_t','eod_volume_t','quantity_t','cars_per_day','rate_tpd','value','duration_days'];

// Refs are handed out per object, so a record keeps its ref across lookups. They point at
// the live object: a record replaced by a reload or re-import no longer resolves.
const _agentRefByObj=new WeakMap(), _agentObjByRef=new Map();
let _agentRefSeq=0;
function _agentRef(table,obj){
  let ref=_agentRefByObj.get(obj);
  if(!ref){ ref='r'+(++_agentRefSeq); _agentRefByObj.set(obj,ref); }
  _agentObjByRef.set(ref,{table,obj});
  return ref;
}
function _agentIdList(field){
  if(/facility_id$/.test(field)) return DB.facilities||[];
  if(/product_id$/.test(field)) return DB.products||[];
  if(_AGENT_EL_FIELDS.test(field)) return DB.elements||[];
  if(field==='vessel_call_id') return DB.vessel_calls||[];
  return null;
}
function _agentNameOf(field,id){
  const x=(_agentIdList(field)||[]).find(o=>o.id===id);
  return x?(x.name||id):null;
}
// Values a filter on `field` accepts: the value itself plus the ids of records NAMED like it
// (exact name first, else partial), so the agent can filter facility_id by "JAX".
function _agentMatchVals(field,v){
  if(v==null) return [''];
  const s=String(v), list=_agentIdList(field);
  if(!list) return [s];
  const q=s.toLowerCase();
  const exact=list.filter(o=>o.id===s||String(o.name||'').toLowerCase()===q);
  const hits=exact.length?exact:list.filter(o=>String(o.name||'').toLowerCase().includes(q));
  return [s,...hits.map(o=>o.id)];
}
function _agentFindFacility(q){
  if(!q) return null;
  const s=String(q).toLowerCase();
  return DB.facilities.find(f=>f.id===q||String(f.name).toLowerCase()===s)
    ||DB.facilities.find(f=>String(f.name).toLowerCase().includes(s))||null;
}
function _agentRowView(table,obj){
  const out={ref:_agentRef(table,obj)};
  for(const k in obj){
    if(k==='created_at') continue;
    const v=obj[k]; out[k]=v;
    if(typeof v==='string'&&v&&!v.startsWith('__')&&_agentIdList(k)){
      const n=_agentNameOf(k,v);
      if(n!==v) out[k.replace(/_id$/,'')+'_name']=n==null?'(deleted)':n;
    }
  }
  return out;
}
// One readable line for a record: date · origin → dest · element · product · type · qty.
function _agentDescribe(table,obj){
  const cfg=AGENT_EDIT_TABLES[table]||{};
  const nm=k=>{ const v=obj[k]; if(v==null||v==='') return null; const n=_agentNameOf(k,v); return n||(String(v).startsWith('__')?v:`${v} (deleted)`); };
  const parts=[];
  if(obj[cfg.date]) parts.push(obj[cfg.date]);
  const from=nm('from_facility_id')||nm('origin_facility_id')||nm('facility_id');
  const to=nm('to_facility_id')||nm('dest_facility_id');
  if(from&&to) parts.push(`${from} → ${to}`); else if(from||to) parts.push(from||to);
  ['element_id','dispatch_id','from_dispatch_id','berth_id','silo_id','berth_element_id'].forEach(k=>{ const n=nm(k); if(n) parts.push(n); });
  const pn=nm('product_id'); if(pn) parts.push(pn);
  if(obj.name) parts.push(obj.name);
  if(obj.type) parts.push(obj.type);
  if(obj.status) parts.push(obj.status);
  const q=_AGENT_QTY.find(k=>obj[k]!=null&&obj[k]!=='');
  if(q) parts.push(`${q.replace(/_/g,' ')} ${obj[q]}`);
  return parts.map(x=>esc(String(x))).join(' · ');
}

function agentToolFindRecords({table, filters, date_from, date_to, limit}={}){
  const cfg=AGENT_EDIT_TABLES[table];
  if(!cfg) return {error:`"${table}" is not an editable table. Editable: ${Object.keys(AGENT_EDIT_TABLES).join(', ')}.`};
  let rows=DB[table]||[];
  Object.entries(filters||{}).forEach(([f,v])=>{
    const ok=new Set((Array.isArray(v)?v:[v]).flatMap(x=>_agentMatchVals(f,x)));
    rows=rows.filter(r=>ok.has(String(r[f]??'')));
  });
  const df=cfg.date;
  if(date_from) rows=rows.filter(r=>String(r[df]||'')>=date_from);
  if(date_to) rows=rows.filter(r=>String(r[df]||'')<=date_to);
  rows=rows.slice().sort((a,b)=>String(a[df]||'').localeCompare(String(b[df]||'')));
  const lim=Math.min(Math.max(parseInt(limit)||50,1),200);
  const out={table, matched:rows.length, returned:Math.min(lim,rows.length), date_field:df, note:cfg.note,
    records:rows.slice(0,lim).map(r=>_agentRowView(table,r))};
  if(!rows.length&&(DB[table]||[]).length) out.fields_on_this_table=Object.keys(DB[table][0]);
  return out;
}

// The records behind the rail cars a terminal shows on a date. The Rail Schedule and the
// Supply page date a terminal's receipts by its PULL day (every car reaching the rail yard
// after the previous pull day), so a pull-day date gathers that whole arrival window.
function agentToolFindRailArrivals({terminal, date, product}={}){
  if(!S.simCfg?.start_date) return {error:'No simulation start date is set.'};
  const fac=_agentFindFacility(terminal);
  if(!fac) return {error:`No facility matching "${terminal}".`};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')) return {error:'date must be YYYY-MM-DD.'};
  const tp=railTerminalPulls(fac.id);
  if(!tp.berths.length) return {error:`${fac.name} has no rail receiving berth.`};
  const d=Math.round((new Date(date+'T00:00:00')-new Date(S.simCfg.start_date+'T00:00:00'))/864e5)+1;
  const pullDay=tp.isPullDay(d);
  const from=pullDay?tp.prevPullDay(d)+1:d;
  const pids=product?new Set(_agentMatchVals('product_id',product)):null;
  const arr=rpPlannedArrivalsForDest(fac.id,null,{allProducts:true});
  const fName=id=>DB.facilities.find(f=>f.id===id)?.name||id;
  const sources=[];
  for(let a=from;a<=d;a++) (arr[a]||[]).forEach(e=>{
    if(!e.rec||(pids&&!pids.has(e.productId))) return;
    const real=e.status==='Real', table=real?'real_rail_daily':'rail_movements';
    sources.push({ref:_agentRef(table,e.rec), table,
      kind:real?'real dispatch':`planned push (${e.status})`,
      origin:fName(e.fromFacId), product:_agentProdName(e.productId),
      departure_date:rpDayDate(e.depDay), reaches_rail_yard:rpDayDate(a),
      cars:parseInt(real?e.rec.cars:e.rec.wagon_count)||0, tonnes:Math.round(e.tonnes),
      leftover:e.unmatched||undefined,
      how_to_remove:e.unmatched?'Leftover: the origin has no rail dispatch point serving this terminal, so the simulation already ignores it — delete the record.'
        :real?'Delete to drop the recorded actual (that switch\'s planned pushes then count again), or update cars to 0 if the switch really sent nothing.'
        :'Update wagon_count to 0. Do not delete — a deleted push is suggested again on the Rail Schedule.'});
  });
  const yard=(DB.real_rail_daily||[]).filter(rr=>rr.facility_id===fac.id&&rr.date===date
      &&['railyard_count','localyard_count','placed'].includes(rr.type)&&(!pids||pids.has(rr.product_id)))
    .map(rr=>({ref:_agentRef('real_rail_daily',rr), type:rr.type, product:_agentProdName(rr.product_id), cars:rr.cars}));
  const out={terminal:fac.name, date, is_pull_day:pullDay,
    arrivals_counted:`${rpDayDate(from)} … ${date}`, sources,
    physical_count_records_on_date:yard.length?yard:undefined};
  if(tp.hasSim){
    const t=pids?[...pids].reduce((s,pid)=>s+tp.pulledT(pid,d),0):tp.pulledT(null,d);
    out.simulated_cars_pulled_that_day=Math.round(t/tp.carCap);
  }
  if(!pullDay){
    let nx=null; for(let x=d+1;x<=d+7;x++) if(tp.isPullDay(x)){ nx=x; break; }
    out.note=`${date} is not a pull day for ${fac.name}; only cars reaching the rail yard that day are listed. The schedule shows them on the next pull day${nx?` (${rpDayDate(nx)})`:''}.`;
  }
  if(!sources.length&&!yard.length) out.note=(out.note?out.note+' ':'')+'No arrival records found in that window.';
  return out;
}

// Leftover scan: records whose references no longer exist, and rail records the simulation
// ignores because they were filed under the wrong facility. Grouped so a stale block can be
// removed in one proposal (delete_groups) — the group list is replaced on every scan.
const _agentGroups=new Map();
let _agentGroupSeq=0;
function agentToolFindLeftovers({table, max_groups}={}){
  if(table&&!AGENT_EDIT_TABLES[table]) return {error:`"${table}" is not an editable table.`};
  _agentGroups.clear();
  const sets={facility:new Set(DB.facilities.map(f=>f.id)), element:new Set(DB.elements.map(e=>e.id)),
    product:new Set((DB.products||[]).map(p=>p.id)), 'vessel call':new Set((DB.vessel_calls||[]).map(v=>v.id))};
  const refKind=k=>/facility_id$/.test(k)?'facility':/product_id$/.test(k)?'product':_AGENT_EL_FIELDS.test(k)?'element':k==='vessel_call_id'?'vessel call':null;
  const fName=id=>DB.facilities.find(f=>f.id===id)?.name||id;
  const canvas=new Set(getFacElements().map(e=>e.id));
  const railDpFacs=new Set(DB.elements.filter(e=>e.type==='dispatch_point'&&e.props?.dispatch_type==='Rail').map(_railDpFacId));
  const originsCache={}; const originsOf=fid=>originsCache[fid]||(originsCache[fid]=rpGetOriginsForDest(fid));
  const groups=new Map();
  const add=(t,key,reason,obj)=>{ const k=t+'|'+key; let g=groups.get(k); if(!g){ g={table:t,reason,objs:[]}; groups.set(k,g); } g.objs.push(obj); };
  (table?[table]:Object.keys(AGENT_EDIT_TABLES)).forEach(t=>{
    (DB[t]||[]).forEach(r=>{
      for(const k in r){
        const v=r[k], kind=refKind(k);
        if(!kind||typeof v!=='string'||!v||v.startsWith('__')) continue;
        if(!sets[kind].has(v)){ add(t,`${k}=${v}`,`${k} points to ${kind==='element'?'an':'a'} ${kind} ("${v}") that no longer exists`,r); return; }
      }
      if(t==='real_rail_daily'){
        if(r.type==='dispatched'&&r.dest_facility_id&&!originsOf(r.dest_facility_id).some(o=>_railDpFacId(o.dp)===r.facility_id))
          return add(t,`disp|${r.facility_id}|${r.dest_facility_id}`,`"dispatched" rows filed under ${fName(r.facility_id)} → ${fName(r.dest_facility_id)}, but ${fName(r.facility_id)} has no rail dispatch point connected to ${fName(r.dest_facility_id)} — the simulation ignores them`,r);
        if(r.type==='yard_count'&&r.dispatch_id){
          const dp=getEl(r.dispatch_id);
          if(dp&&_railDpFacId(dp)!==r.facility_id)
            return add(t,`yc|${r.facility_id}|${dp.id}`,`"yard_count" rows filed under ${fName(r.facility_id)}, but dispatch point ${dp.name} belongs to ${fName(_railDpFacId(dp))} — the simulation ignores them`,r);
        }
        if(r.type==='loading'&&!railDpFacs.has(r.facility_id))
          return add(t,`load|${r.facility_id}`,`"loading" rows for ${fName(r.facility_id)}, which has no rail dispatch point — the simulation ignores them`,r);
      }
      if(t==='rail_movements'&&canvas.has(r.from_dispatch_id)&&r.to_facility_id
        &&!originsOf(r.to_facility_id).some(o=>o.dp.id===r.from_dispatch_id))
        add(t,`nolink|${r.from_dispatch_id}|${r.to_facility_id}`,`rail pushes from ${getEl(r.from_dispatch_id)?.name} to ${fName(r.to_facility_id)}, but that dispatch point is not connected to a rail berth at ${fName(r.to_facility_id)}`,r);
    });
  });
  const list=[...groups.values()].sort((a,b)=>b.objs.length-a.objs.length);
  const cap=Math.min(Math.max(parseInt(max_groups)||40,1),80);
  return {
    groups_found:list.length, records_found:list.reduce((s,g)=>s+g.objs.length,0),
    groups:list.slice(0,cap).map(g=>{
      g.id='g'+(++_agentGroupSeq); _agentGroups.set(g.id,g);
      const df=AGENT_EDIT_TABLES[g.table].date, ds=g.objs.map(o=>o[df]).filter(Boolean).sort();
      return {group:g.id, table:g.table, reason:g.reason, count:g.objs.length,
        date_range:ds.length?`${ds[0]} … ${ds[ds.length-1]}`:undefined,
        records:g.objs.length<=12?g.objs.map(o=>_agentRowView(g.table,o)):undefined,
        sample:g.objs.length>12?g.objs.slice(0,2).map(o=>_agentRowView(g.table,o)):undefined};
    }),
    note:'These are suspicions based on the current topology, not certainties. Tell the user what you found (reason, count, date range) and propose deleting only what they asked about — delete_groups removes a whole group, refs remove single records.'
  };
}

// ── Proposal card ──
const _agentProposals={};
let _agentPropSeq=0;
let _chatTurnApplied=[];     // summaries applied during the running reply (see sendChat's catch)
let _chatPendingNotes=[];    // app events the agent hasn't heard about yet, e.g. an Undo click
function _agentPendingProposal(){ return Object.values(_agentProposals).find(p=>p.state==='pending')||null; }

async function agentToolProposeChanges({summary, changes, delete_groups}={}){
  if(_agentPendingProposal()) return {error:'Another proposal is still waiting for the user.'};
  const live={}, isLive=(t,o)=>(live[t]||(live[t]=new Set(DB[t]||[]))).has(o);
  const errors=[], resolved=[], lines=[], seen=new Set();
  let gone=0;
  const now=new Date().toISOString();
  (delete_groups||[]).forEach(gid=>{
    const g=_agentGroups.get(gid);
    if(!g){ errors.push(`${gid}: unknown group — run find_leftover_records again`); return; }
    const objs=g.objs.filter(o=>isLive(g.table,o)&&!seen.has(o));
    gone+=g.objs.length-objs.length;
    objs.forEach(o=>{ seen.add(o); resolved.push({table:g.table,obj:o,action:'delete'}); });
    const df=AGENT_EDIT_TABLES[g.table].date, ds=objs.map(o=>o[df]).filter(Boolean).sort();
    if(objs.length) lines.push(`<div class="agent-prop-line del">✕ delete ${objs.length} × ${esc(AGENT_EDIT_TABLES[g.table].label)} — ${esc(g.reason)}${ds.length?` <span class="dim">(${esc(ds[0])} … ${esc(ds[ds.length-1])})</span>`:''}</div>`);
  });
  (changes||[]).forEach((c,i)=>{
    const hit=_agentObjByRef.get(c?.ref);
    if(!hit){ errors.push(`${c?.ref||'change #'+(i+1)}: unknown ref — look the record up first`); return; }
    if(seen.has(hit.obj)){ errors.push(`${c.ref}: listed more than once`); return; }
    if(!isLive(hit.table,hit.obj)){ errors.push(`${c.ref}: record no longer exists (edited or reloaded) — look it up again`); return; }
    const label=esc(AGENT_EDIT_TABLES[hit.table].label);
    if(c.action==='delete'){
      seen.add(hit.obj); resolved.push({table:hit.table,obj:hit.obj,action:'delete'});
      lines.push(`<div class="agent-prop-line del">✕ delete ${label} · ${_agentDescribe(hit.table,hit.obj)}</div>`);
      return;
    }
    if(c.action!=='update'){ errors.push(`${c.ref}: action must be "delete" or "update"`); return; }
    const set={};
    for(const [k,raw] of Object.entries(c.set||{})){
      if(k==='id'){ errors.push(`${c.ref}: id cannot be changed`); continue; }
      if(!(k in hit.obj)){ errors.push(`${c.ref}: field "${k}" does not exist on this record`); continue; }
      const old=hit.obj[k];
      let v=raw;
      if(old!=null&&typeof old==='object'){ errors.push(`${c.ref}: "${k}" is a nested value — change it in the app`); continue; }
      if(typeof old==='number'){ v=Number(raw); if(raw===''||raw==null||!isFinite(v)){ errors.push(`${c.ref}: "${k}" needs a number`); continue; } }
      else if(typeof old==='boolean') v=(raw===true||raw==='true');
      else if(typeof raw==='string'&&raw&&_agentIdList(k)){
        const ids=[...new Set(_agentMatchVals(k,raw).slice(1))];
        if(ids.length!==1){ errors.push(`${c.ref}: "${raw}" does not name exactly one ${k.replace(/_id$/,'')}`); continue; }
        v=ids[0];
      }
      set[k]=v;
    }
    if(!Object.keys(set).length){ if(!errors.some(e=>e.startsWith(c.ref+':'))) errors.push(`${c.ref}: nothing to update`); return; }
    // total_capacity_t is what the simulation ships — keep it in step with the car count.
    if(hit.table==='rail_movements'&&'wagon_count' in set&&!('total_capacity_t' in set))
      set.total_capacity_t=set.wagon_count*(parseFloat(hit.obj.wagon_capacity_t)||RAIL_CAR_T_DEFAULT);
    if('updated_at' in hit.obj) set.updated_at=now;
    seen.add(hit.obj); resolved.push({table:hit.table,obj:hit.obj,action:'update',set});
    const show=v=>{ const s=v==null||v===''?'—':String(v); return esc(s); };
    const diffs=Object.entries(set).filter(([k])=>k!=='updated_at').map(([k,v])=>{
      const on=_agentIdList(k)?(_agentNameOf(k,hit.obj[k])||hit.obj[k]):hit.obj[k];
      const nn=_agentIdList(k)?(_agentNameOf(k,v)||v):v;
      return `${esc(k)}: <span class="dim">${show(on)}</span> → <b>${show(nn)}</b>`;
    }).join(' · ');
    lines.push(`<div class="agent-prop-line upd">✎ ${label} · ${_agentDescribe(hit.table,hit.obj)}<br>${diffs}</div>`);
  });
  if(errors.length) return {error:'Proposal not shown to the user — fix these first.', problems:errors.slice(0,25)};
  if(!resolved.length) return {error:gone?'Those records no longer exist — nothing to change.':'No changes given. Pass changes:[{ref, action, set}] and/or delete_groups:[group ids].'};

  const p={id:'prop'+(++_agentPropSeq), summary:String(summary||'Data change'), changes:resolved, lines, total:resolved.length, state:'pending'};
  _agentProposals[p.id]=p;
  hideTyping();
  _agentRenderProposal(p);
  showTyping('waiting for you to Apply or Cancel…');
  await new Promise(res=>{ p.resolve=res; });
  if(p.state==='applied') return {applied:true, records_changed:p.appliedCount, records_no_longer_there:p.skipped||undefined,
    note:'Applied and saved; the simulation is re-running, so the pages update in a moment. The card keeps an Undo button.'};
  if(p.state==='failed') return {applied:false, error:`Applying failed and was rolled back: ${p.error}`};
  return {applied:false, cancelled:true, user_reply:p.reply||undefined,
    note:p.reply?'The user typed a reply instead of clicking Apply — the proposal was cancelled and nothing changed. Respond to what they said.'
      :'The user clicked Cancel — nothing was changed.'};
}

function _agentDecide(id, ok, reply){
  const p=_agentProposals[id];
  if(!p||p.state!=='pending') return;
  if(ok) _agentApplyProposal(p);
  else { p.state='cancelled'; p.reply=reply||null; }
  _agentRenderProposal(p);
  const r=p.resolve; p.resolve=null; if(r) r();
}

// Loading rows the agent changes feed the Rail Schedule sync like a manual edit (see
// _railLoadingEdited): report their dispatch points and days before they change.
function _agentNoteLoadingEdits(items){
  const end=()=>rpDayDate(_simEffectiveHorizon());
  items.forEach(({table,obj,vals})=>{
    [obj,vals||{}].forEach(v=>{
      if(table==='rail_loading_plan'&&(v.dispatch_id||obj.dispatch_id)){
        const f=v.date_from||obj.date_from||S.simCfg.start_date, t=v.date_to||obj.date_to||end();
        _railLoadingEdited([v.dispatch_id||obj.dispatch_id],_railDateRange(f<S.simCfg.start_date?S.simCfg.start_date:f,t));
      }
      if(table==='real_rail_daily'&&(v.type||obj.type)==='loading'&&(v.date||obj.date))
        _railLoadingEdited(_railDpsOfFac(v.facility_id||obj.facility_id),[v.date||obj.date]);
    });
  });
}

function _agentApplyProposal(p){
  const inverse=[], touched=new Set();
  let applied=0, skipped=0;
  _agentNoteLoadingEdits(p.changes.map(c=>({table:c.table,obj:c.obj,vals:c.set})));
  try{
    const live={}, isLive=(t,o)=>(live[t]||(live[t]=new Set(DB[t]||[]))).has(o);
    p.changes.filter(c=>c.action==='update').forEach(c=>{
      if(!isLive(c.table,c.obj)){ skipped++; return; }
      const old={};
      Object.keys(c.set).forEach(k=>{ old[k]=Object.prototype.hasOwnProperty.call(c.obj,k)?c.obj[k]:undefined; });
      inverse.push({kind:'update',table:c.table,obj:c.obj,old});
      Object.assign(c.obj,c.set);
      touched.add(c.table); applied++;
    });
    // Deletes: one filter pass per table (demand_values runs to tens of thousands of rows),
    // remembering each removed row's position so Undo can put it back in order.
    const del={};
    p.changes.filter(c=>c.action==='delete').forEach(c=>{ (del[c.table]=del[c.table]||new Set()).add(c.obj); });
    Object.entries(del).forEach(([t,objs])=>{
      const removed=[], keep=[];
      (DB[t]||[]).forEach((r,i)=>{ if(objs.has(r)) removed.push({obj:r,idx:i}); else keep.push(r); });
      skipped+=objs.size-removed.length;
      if(!removed.length) return;
      inverse.push({kind:'delete',table:t,removed});
      DB[t]=keep;
      touched.add(t); applied+=removed.length;
    });
  }catch(e){
    _agentRevert(inverse);
    p.state='failed'; p.error=e.message;
    return;
  }
  p.inverse=inverse; p.appliedCount=applied; p.skipped=skipped; p.state='applied';
  _chatTurnApplied.push(p.summary);
  _agentAfterDataEdit(touched);
  statMsg(`AI change applied (${applied} record${applied===1?'':'s'}) — running simulation…`);
}

function _agentRevert(inverse){
  const touched=new Set();
  inverse.slice().reverse().forEach(inv=>{
    const arr=DB[inv.table]||(DB[inv.table]=[]);
    touched.add(inv.table);
    if(inv.kind==='delete'){
      const present=new Set(arr);
      inv.removed.forEach(({obj,idx})=>{ if(!present.has(obj)) arr.splice(Math.min(idx,arr.length),0,obj); });
    } else if(arr.includes(inv.obj)){
      Object.entries(inv.old).forEach(([k,v])=>{ if(v===undefined) delete inv.obj[k]; else inv.obj[k]=v; });
    }
  });
  return touched;
}

function _agentUndo(id){
  const p=_agentProposals[id];
  if(!p||p.state!=='applied') return;
  _agentNoteLoadingEdits((p.inverse||[]).flatMap(inv=>inv.kind==='delete'
    ?inv.removed.map(x=>({table:inv.table,obj:x.obj})):[{table:inv.table,obj:inv.obj,vals:inv.old}]));
  const touched=_agentRevert(p.inverse||[]);
  p.state='undone';
  _agentRenderProposal(p);
  _agentAfterDataEdit(touched);
  _chatPendingNotes.push(`[App note: the user clicked Undo on your change "${p.summary}" — it was reverted and those records are back as they were.]`);
  statMsg('AI change undone — running simulation…');
}

// Same aftermath as a manual edit: persist, refresh whatever shows the data, re-run.
// The simulation's completion re-renders the Supply page and the logistics planners.
function _agentAfterDataEdit(touched){
  autoSave();
  if(touched.has('demand_values')) _demandChanged(false);
  else _demandCacheInvalidate();
  if(S.view==='schedules'){ try{ renderVesselTable(); renderRailTable(); renderSiloXferRegister(); renderMaintenanceCalendar(); }catch(e){} }
  if(S.facility_id) scheduleSimulation();
}

function _agentRenderProposal(p){
  const msgs=document.getElementById('chat-msgs');
  if(!msgs) return;
  let el=document.getElementById('agent-prop-'+p.id);
  if(!el){ el=document.createElement('div'); el.id='agent-prop-'+p.id; el.className='chat-msg agent agent-prop'; msgs.appendChild(el); }
  const shown=p.lines.slice(0,30), more=p.lines.length-shown.length;
  let foot;
  if(p.state==='pending') foot=`<div class="agent-prop-btns"><button class="agent-prop-ok" onclick="_agentDecide('${p.id}',true)">✓ Apply ${p.total} change${p.total===1?'':'s'}</button><button class="agent-prop-no" onclick="_agentDecide('${p.id}',false)">Cancel</button></div><div class="agent-prop-hint">Nothing changes until you click Apply.</div>`;
  else if(p.state==='applied') foot=`<div class="agent-prop-state ok">✓ Applied ${p.appliedCount} change${p.appliedCount===1?'':'s'}${p.skipped?` · ${p.skipped} no longer existed`:''} — saved, simulation re-running</div><div class="agent-prop-btns"><button class="agent-prop-no" onclick="_agentUndo('${p.id}')">↶ Undo</button></div>`;
  else if(p.state==='undone') foot=`<div class="agent-prop-state">↶ Undone — records restored</div>`;
  else if(p.state==='failed') foot=`<div class="agent-prop-state bad">✕ Failed and rolled back: ${esc(p.error)}</div>`;
  else foot=`<div class="agent-prop-state">Cancelled — nothing changed</div>`;
  el.innerHTML=`<div class="chat-msg-lbl">Agent · proposed data change</div><div class="agent-prop-title">${esc(p.summary)}</div><div class="agent-prop-list">${shown.join('')}${more>0?`<div class="agent-prop-line dim">+ ${more} more</div>`:''}</div>${foot}`;
  msgs.scrollTop=msgs.scrollHeight;
}

const AGENT_TOOL_FNS={
  get_stop_events: agentToolGetStopEvents,
  get_inventory_on_date: agentToolGetInventoryOnDate,
  run_whatif_simulation: agentToolRunWhatif,
  get_production_model: agentToolGetProductionModel,
  find_max_demand: agentToolFindMaxDemand,
  create_report: agentToolCreateReport,
  find_records: agentToolFindRecords,
  find_rail_arrivals: agentToolFindRailArrivals,
  find_leftover_records: agentToolFindLeftovers,
  propose_data_changes: agentToolProposeChanges
};

const AGENT_TOOLS=[
  {
    name:'get_stop_events',
    description:'List stop/blocked/idle/starved events for the active facility from the most recent real simulation run. Use for "why did X stop" or "what caused the fulfillment miss" questions.',
    input_schema:{type:'object',properties:{
      element_name:{type:'string',description:'Optional. Case-insensitive (partial match ok) element name to filter to.'},
      type:{type:'string',enum:['blocked','maintenance','idle','starved','berth_yield','anchorage'],description:'Optional. Filter to one stop-event type.'},
      limit:{type:'integer',description:'Max events to return, most recent first. Default 20.'}
    }}
  },
  {
    name:'get_inventory_on_date',
    description:'Get simulated inventory (tonnes) of a storage element on a specific date, from the most recent real simulation run for the active facility.',
    input_schema:{type:'object',properties:{
      element_name:{type:'string',description:'Name (or partial, case-insensitive) of the storage element.'},
      date:{type:'string',description:'YYYY-MM-DD, must fall within the simulated horizon.'}
    },required:['element_name','date']}
  },
  {
    name:'run_whatif_simulation',
    description:'Run a hypothetical simulation for the active facility in a sandbox — nothing is saved or written to disk. Use when the user asks a "what if" question, e.g. adding a hypothetical maintenance outage or changing the horizon. Reports what changed vs. the current baseline result.',
    input_schema:{type:'object',properties:{
      horizon_days:{type:'integer',description:'Optional. Override the simulation horizon in days for this trial only.'},
      maintenance_overrides:{type:'array',description:'Optional. Hypothetical downtime events to add for this trial only.',items:{type:'object',properties:{
        element_name:{type:'string',description:'Name (or partial match) of the element to take down.'},
        start_date:{type:'string',description:'YYYY-MM-DD'},
        duration_days:{type:'number',description:'Days of downtime. Fractional allowed: 0.5 = half-day PM (element runs at 50% that day).'}
      },required:['element_name','start_date','duration_days']}}
    }}
  },
  {
    name:'get_production_model',
    description:'Get the active facility\'s production/capacity structure: each kiln/mill with its per-product grinding rates, which mills can make each product (single-mill products are bottlenecks), recipe clinker factors, silos with capacities, demand by point/product, and maintenance. Use this to reason about bottlenecks and "where is the constraint / how much headroom" questions before doing math.',
    input_schema:{type:'object',properties:{}}
  },
  {
    name:'find_max_demand',
    description:'Find the maximum demand a demand point can carry before ANY OTHER product can no longer be fully served, holding the production and maintenance schedules as-is. Binary-searches real sandbox simulations (nothing saved). Use for "how much X can we sell/supply before we stock out of something else" questions. Returns the max annual tonnage and which product stocks out first.',
    input_schema:{type:'object',properties:{
      demand_point:{type:'string',description:'Name (or partial, case-insensitive) of the demand point to push, e.g. "MIA/DEM/MIA_IL(08)/BLK".'},
      max_multiplier:{type:'number',description:'Optional upper bound as a multiple of current demand to search up to. Default 4.'},
      tolerance_pct:{type:'number',description:'Optional. A point counts as short only if served falls more than this % below requested. Default 1.'}
    },required:['demand_point']}
  },
  {
    name:'create_report',
    description:'Generate a formatted HTML report and download it to the user\'s computer (they can open it in a browser and print to PDF). Use when the user asks for a document/report/write-up of an answer. Put the full analysis into sections yourself — this tool only renders and downloads what you provide.',
    input_schema:{type:'object',properties:{
      title:{type:'string'},
      subtitle:{type:'string',description:'Optional one-line context under the title.'},
      sections:{type:'array',description:'Ordered sections.',items:{type:'object',properties:{
        heading:{type:'string'},
        body:{type:'string',description:'Text. Blank lines start new paragraphs; **bold** and `code` supported.'},
        table:{type:'object',description:'Optional table.',properties:{headers:{type:'array',items:{type:'string'}},rows:{type:'array',items:{type:'array',items:{type:'string'}}}}}
      },required:['heading']}}
    },required:['title','sections']}
  },
  {
    name:'find_records',
    description:'Look up editable planning-data records so they can be changed with propose_data_changes. Each record comes back with a ref (e.g. "r12"), its fields, and a readable *_name next to every id field. Filters match field values exactly; id fields (facility_id, dest_facility_id, product_id, element_id, dispatch_id, …) also accept a NAME such as "JAX". The result carries table-specific notes on how its records should be changed. Read-only.',
    input_schema:{type:'object',properties:{
      table:{type:'string',enum:Object.keys(AGENT_EDIT_TABLES)},
      filters:{type:'object',description:'Optional exact-match filters, field → value or array of values, e.g. {"type":"dispatched","facility_id":"JAX"}.'},
      date_from:{type:'string',description:'Optional YYYY-MM-DD (inclusive) on the table\'s main date field.'},
      date_to:{type:'string',description:'Optional YYYY-MM-DD (inclusive).'},
      limit:{type:'integer',description:'Max records returned. Default 50, max 200.'}
    },required:['table']}
  },
  {
    name:'find_rail_arrivals',
    description:'Find the records behind the rail cars a terminal shows on a date. Terminals show received cars on their PULL (switch) day — every car that reached the rail yard since the previous pull day — so this returns each contributing planned push or real dispatch with a ref, origin, departure date, cars and how_to_remove, plus physical-count records on that date and the simulated cars pulled. Use it when the user wants to remove or change rail cars arriving at a terminal. Read-only.',
    input_schema:{type:'object',properties:{
      terminal:{type:'string',description:'Terminal facility name, e.g. "JAX".'},
      date:{type:'string',description:'YYYY-MM-DD — the day the cars show at the terminal.'},
      product:{type:'string',description:'Optional product name or id.'}
    },required:['terminal','date']}
  },
  {
    name:'find_leftover_records',
    description:'Scan editable tables for leftover records: references to deleted facilities/elements/products, real rail records filed under the wrong facility (the simulation ignores them), and rail pushes between a dispatch point and a terminal that are not connected. Returns groups (id like "g3") with reason, count, date range and records or a sample with refs. Use when the user asks to clean up stale, leftover or phantom values. Read-only.',
    input_schema:{type:'object',properties:{
      table:{type:'string',enum:Object.keys(AGENT_EDIT_TABLES),description:'Optional — scan only this table.'},
      max_groups:{type:'integer',description:'Optional. Default 40, max 80.'}
    }}
  },
  {
    name:'propose_data_changes',
    description:'Propose deleting or updating records found with find_records / find_rail_arrivals / find_leftover_records. The app shows the user an Apply / Cancel card and WAITS for their click: nothing changes unless the result has applied:true. Applied changes are saved, the simulation re-runs, and the card keeps an Undo button. Updates may only set fields the record already has (never id); id fields accept a name. Creating new records is not supported — send the user to the app for that.',
    input_schema:{type:'object',properties:{
      summary:{type:'string',description:'One line shown as the card title, e.g. "Remove the 10 cars BRS → JAX pulled 2026-09-22".'},
      changes:{type:'array',description:'Individual record changes.',items:{type:'object',properties:{
        ref:{type:'string',description:'Record ref, e.g. "r12".'},
        action:{type:'string',enum:['delete','update']},
        set:{type:'object',description:'For update: field → new value, e.g. {"wagon_count":0}.'}
      },required:['ref','action']}},
      delete_groups:{type:'array',items:{type:'string'},description:'Leftover group ids from find_leftover_records to delete whole.'}
    },required:['summary']}
  }
];

let _chatBusy=false;
async function sendChat(){
  const inp=document.getElementById('chat-in');
  const msg=inp.value.trim(); if(!msg) return;
  // Typing while a proposed data change waits counts as "not that": the card is cancelled
  // and the text goes back to the agent inside the reply that is already running.
  const pendingProp=_agentPendingProposal();
  if(pendingProp){ inp.value=''; addMsg('user',msg); _agentDecide(pendingProp.id,false,msg); return; }
  // One reply at a time — a second loop would interleave its messages into chatHistory.
  if(_chatBusy){ statMsg('The AI agent is still answering — send again when it is done.'); return; }
  const apiKey=getApiKey();
  if(!apiKey){addMsg('agent','No API key set — click "Configure in Settings" below.');return;}
  inp.value=''; addMsg('user',msg);
  const historySnapshot=JSON.stringify(chatHistory);
  const turnsSnapshot=JSON.stringify(chatTurnStarts);
  const notes=_chatPendingNotes; _chatPendingNotes=[];
  _chatTurnApplied=[];
  chatTurnStarts.push(chatHistory.length);
  chatHistory.push({role:'user',content:notes.length?notes.join('\n')+'\n\n'+msg:msg});
  _chatBusy=true;
  showTyping();
  try{
    const ctx=buildCtx();
    const model=localStorage.getItem('avila_ai_model')||'claude-haiku-4-5-20251001';
    const system=`You are the AI agent embedded in AVILA Roll, a cement production planning tool. You're talking directly to the planner running the simulation — think of yourself as the colleague at the next desk who happens to have the whole database memorized, not a database interface. Answer in plain, conversational language: lead with the takeaway, then the supporting numbers, and only mention table/field names if the person actually asks about the data model. Offer a natural next step when it's useful ("want me to check X?") instead of just stopping. Keep it tight — a few sentences, not a report — unless the question calls for a real breakdown.

You have tools to look up real simulation results and to try sandboxed "what if" runs. Use get_stop_events / get_inventory_on_date to ground answers in the actual last run instead of guessing at numbers. Use run_whatif_simulation when the user proposes a hypothetical change — it's a throwaway trial against a sandbox copy, so always tell the user plainly that nothing was saved and the real plan is unchanged. If there's no simulation result yet, say so and suggest running one rather than inventing numbers.

For capacity / bottleneck questions ("where's the constraint", "which mill limits X", "how much headroom"), call get_production_model first — it hands you every mill's per-product rate, which mills can make each product (a single-mill product is usually the bottleneck), clinker factors, and demand by product, so you can reason about it. For "how much of product X can we supply before we stock out of something else" questions, call find_max_demand with that demand point — it binary-searches real sandbox sims and returns the max annual tonnage plus which product breaks first; report those, and note it holds production & maintenance as-is and saved nothing. When the user asks for a document/report/write-up, do the analysis, then call create_report with clear sections (and tables where useful) to download it for them.

You can also change planning DATA when the user asks — records they could edit by hand (rail pushes and real rail records, vessel calls, campaigns, maintenance, demand values, real production/inventory…) — never the simulation logic, settings or topology. Always two steps. First find the exact records: find_rail_arrivals for cars shown arriving or pulled at a terminal on a date, find_leftover_records for stale / leftover / phantom values, find_records for anything else; every record comes with a ref like "r12". Then call propose_data_changes with those refs: the app shows the user an Apply / Cancel card and waits. Nothing is changed unless that result says applied:true — never say you changed something otherwise, and don't ask "shall I?" in text first, the card is the confirmation. Follow the how_to_remove and note hints (a Confirmed rail push is set to 0 cars, not deleted). Change exactly what was asked; if what you find doesn't clearly match the request (different numbers, several candidates, nothing found), say what you found and ask instead of proposing. If the user types a reply instead of clicking, the card is cancelled and their reply comes back in the tool result.

What you're working with:
Database tables: macro_regions, countries, regions, sub_regions, facilities, elements, connections, products, recipes, raw_materials, fuels, element_maintenance_events, element_product_capacities, vessel_calls, rail_movements, silo_links, silo_transfer_plans, real_silo_transfers_daily, transport_links, in_transit_inventory, demand_points, simulation_runs, simulation_stop_events. Element types: raw_material_storage, fuel_storage, bulk_silo (replaces clinker_silo/cement_silo/homo_silo — color by product category), packed_silo, raw_meal_mill, kiln, finish_mill, packing_plant, berth, dispatch_point (truck=no constraint same-day; rail=car accumulation with switch days and transit lag), demand_point, supply_source. Products have category: clinker, raw_meal, cement_bulk, cement_packed, additive. Kiln product capacities include capacity_tpd, specific_heat_kcal_kg, raw_meal_ratio per clinker product. Rail dispatch points have: car_capacity_t, std_loading_cars_day, max_loading_cars_day, working_days, switch_days (array of 0-6 Mon-Sun), transit_days.

Current state: ${ctx}

You're mid-conversation with this person — earlier turns are included below, so use them; don't ask them to repeat context they already gave you.`;

    let rounds=0, finalText=null;
    while(rounds<8){
      rounds++;
      const data=await callClaude({model,maxTokens:1200,system,messages:chatHistory,tools:AGENT_TOOLS});
      if(data.error) throw new Error(data.error.message);
      const content=data.content||[];
      chatHistory.push({role:'assistant',content});
      const toolUses=content.filter(c=>c.type==='tool_use');
      const text=content.filter(c=>c.type==='text').map(c=>c.text).join('');
      if(!toolUses.length){ finalText=text||'Unable to process.'; break; }
      if(text.trim()){ hideTyping(); addMsg('agent',text); showTyping(); }
      showTyping(toolUses.length===1?`${toolUses[0].name.replace(/_/g,' ')}…`:'running tools…');
      const results=[];
      for(const tu of toolUses){
        let out;
        try{
          const fn=AGENT_TOOL_FNS[tu.name];
          out = fn ? await fn(tu.input||{}) : {error:`Unknown tool: ${tu.name}`};
        }catch(e){ out={error:e.message}; }
        results.push({type:'tool_result', tool_use_id:tu.id, content:JSON.stringify(out)});
      }
      chatHistory.push({role:'user', content:results});
      showTyping();
    }
    hideTyping();
    addMsg('agent', finalText || 'Ran out of steps on that one — try breaking it into a smaller question.');
    if(chatTurnStarts.length>CHAT_MAX_TURNS){
      const keepFrom=chatTurnStarts.length-CHAT_MAX_TURNS;
      const cut=chatTurnStarts[keepFrom];
      chatHistory=chatHistory.slice(cut);
      chatTurnStarts=chatTurnStarts.slice(keepFrom).map(i=>i-cut);
    }
  }catch(e){
    hideTyping();
    addMsg('agent',`Error: ${e.message}`);
    chatHistory=JSON.parse(historySnapshot);
    chatTurnStarts=JSON.parse(turnsSnapshot);
    // The rolled-back history no longer mentions this turn — don't let the agent believe a
    // change it applied (or a note it was just given) never happened.
    _chatPendingNotes=notes.concat(
      _chatTurnApplied.map(s=>`[App note: your change "${s}" was applied during a reply that then failed — it IS in the data now.]`),
      _chatPendingNotes);
  }finally{
    _chatBusy=false;
  }
}

function buildCtx(){
  const fac=getFacility();
  let c=`Today: ${new Date()._ymd()}. Simulation start: ${S.simCfg?.start_date||'not set'}. Organization: ${DB.macro_regions.length} macro_regions, ${DB.countries.length} countries, ${DB.facilities.length} facilities. `;
  if(fac) c+=`Active facility: ${esc(fac.name)} (${fac.type}), path: ${getFullPath(fac)}. Elements: ${getFacElements().length}, Connections: ${getFacConnections().length}. `;
  c+=`Products: ${DB.products.map(p=>p.name).join(', ')}. `;
  c+=`Maintenance events: ${DB.element_maintenance_events.length}. Vessel calls: ${DB.vessel_calls.length}. Rail movements: ${DB.rail_movements.length}. Silo transfer links: ${(DB.silo_links||[]).length}. `;
  if(S.simResults) c+=`Last sim: ${S.simResults.stopEvents.length} stops, ${S.simResults.fulfillmentPct}% fulfillment over ${S.simCfg.horizon} days. `;
  return c;
}

function addMsg(role,text){
  const msgs=document.getElementById('chat-msgs');
  const d=document.createElement('div');
  d.className=`chat-msg ${role}`;
  d.innerHTML=`<div class="chat-msg-lbl">${role==='agent'?'Agent':'You'}</div>${text.replace(/\n/g,'<br>')}`;
  msgs.appendChild(d); msgs.scrollTop=msgs.scrollHeight;
}

let typingEl=null;
function showTyping(label){
  hideTyping(); // one indicator at a time — a second call used to leave the first one behind
  const msgs=document.getElementById('chat-msgs');
  typingEl=document.createElement('div');
  typingEl.className='chat-msg agent';
  const body=label?`<div class="chat-typing-label">${label}</div>`:'<div class="typing-dots"><span></span><span></span><span></span></div>';
  typingEl.innerHTML=`<div class="chat-msg-lbl">Agent</div>${body}`;
  msgs.appendChild(typingEl); msgs.scrollTop=msgs.scrollHeight;
}
function hideTyping(){if(typingEl){typingEl.remove();typingEl=null;}}

