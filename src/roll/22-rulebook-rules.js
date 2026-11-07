// ─────────────────────────────────────────────────────────
// RULES OF THE GAME — the simulator's built-in rules, written in plain words
// ─────────────────────────────────────────────────────────
// SIM_RULEBOOK is what simulate() actually does, area by area, as a planner would say it.
// It is shown on Configuration › Simulation Rules (each page's "Rules" button opens it on its
// own area) and must be kept in step with the code: change a rule in the engine → change its
// sentence here. `set` names the setting that controls the rule and where to change it.
// `issues` are known gaps between what a planner would expect and what the code does today —
// listed so nobody is surprised, fixed one by one.
const SIM_RULE_AREAS=[
  {id:'production', label:'Production',     hint:'Kilns, raw meal mills, finish mills, packing plants'},
  {id:'vessels',    label:'Vessels',        hint:'Ship proposals, berth queue, discharge'},
  {id:'rail',       label:'Rail',           hint:'Loading, switches, car split, terminal yards'},
  {id:'demand',     label:'Demand & stock', hint:'Serving demand, swaps, silo limits'},
  {id:'transfers',  label:'Silo transfers', hint:'Silo-to-silo moves'},
];
const SIM_RULEBOOK={
  production:{
    sections:[
      {title:'Every day', rules:[
        {t:'Each day runs in this order: real stock is applied, silo transfers, maintenance, kilns, raw meal mills, finish mills, packing, rail, berths, demand, then end-of-day stock. A mill therefore sees clinker as it stood at the start of the day.'},
        {t:'Real data beats the plan. A real end-of-day stock entered for yesterday becomes the silo\'s stock this morning, and real production replaces what the simulator would have made that day.', set:'Daily Data form · Data Sources'},
        {t:'Maintenance takes the equipment down for the event\'s full days; a fraction gives one partial day (2.5 days = 2 days down, then a day at 50%). After it, output ramps up along the ramp-up profile.', set:'Supply › Maintenance Calendar'},
        {t:'Every silo has a target level that decides how urgently mills fill it: 100% of capacity for "maximize", 75% for "meet demand", 50% for "minimize". A Target Level % on the silo, or a mill operating rule, overrides it.', set:'Element › Inventory Objective / Target Level %'},
        {t:'A silo is critical when its stock is at or below its critical floor (default 10% of capacity) or it has less than one day of cover.', set:'Element › Critical Floor %'},
      ]},
      {title:'Kilns', rules:[
        {t:'A kiln makes every clinker product it is set up for at the same time, each at its own t/day capacity.', set:'Element › Product capacities'},
        {t:'It stops when all its clinker silos are 98% full, and skips a product whose silo is 98% full.'},
        {t:'After stopping on a full silo it restarts the next day — unless a restart floor % is set (it waits until every clinker silo is at or below that %) or a restart rule applies.', set:'Element › Restart floor % · Your rules'},
        {t:'"Down for Repairs" and "Down for Inventory Control" campaigns stop the kiln; "Down PM Day" runs it at 50%.', set:'Supply › campaigns'},
      ]},
      {title:'Raw meal mills', rules:[
        {t:'A raw meal mill runs at its rated t/day whenever at least one of its raw meal silos is below 98% full, and stops when all are full.'},
      ]},
      {title:'Finish mills', rules:[
        {t:'A finish mill makes one product per day.'},
        {t:'Order of precedence: maintenance, then real production, then a rail-fill need, then a manager campaign, then the simulator\'s own choice.'},
        {t:'Rail fill: when the silo feeding a rail siding holds less than 95% of three days of planned loading, a connected mill fills it first and spends the rest of the day (after 3 hours of changeover) on its most urgent silo — unless one of its own silos is critical and no other mill can cover it.', set:'Rail loading plan'},
        {t:'A product campaign forces the product and rate for its dates; downtime campaigns stop the mill (PM Day = 50%).', set:'Supply › Campaign builder'},
        {t:'Otherwise the mill picks the product whose silo is most urgent: the days of net demand (demand minus what other mills supply) needed to bring the silo up to its target. Silos at their stop level (98%) are not eligible.'},
        {t:'Output is the mill\'s capacity for that product, limited by the clinker in stock and by the space left up to the stop level.', set:'Element › Product capacities · recipes'},
        {t:'Real production always lands in a silo: the most urgent one that is connected and under 98%, else the one with the most room, even when the mill is not connected to it. Capacity still limits the silo at end of day.'},
        {t:'If any silo is critical, only critical silos are considered that day.'},
        {t:'When nothing can run the mill is recorded as idle (no production needed or products paused), starved (no clinker) or blocked (silos full).'},
        {t:'A mill operating rule (Your rules) can set when the mill stops, when it restarts, which product it restarts with, a minimum run, which products it may make, product-change days and t/day limits.', set:'Your rules'},
      ]},
      {title:'Packing plants', rules:[
        {t:'A packing line packs one product per day, at pallets/day × t per pallet, limited by bulk cement available and packed-silo space up to 98%.', set:'Element › Packing lines'},
        {t:'It picks the line whose packed silo is most urgent; a product campaign forces the product. Packing runs before customer demand, so it has first call on bulk cement.'},
      ]},
      {title:'Mill operating rules', rules:[
        {t:'A mill operating rule is written on this page. It applies to one or more finish mills — for one product or all of them — between its dates; whatever it does not mention keeps the simulator\'s defaults.', set:'Your rules'},
        {t:'Operating rules only affect the simulator\'s own choice — not real data, campaigns or rail fill.'},
        {t:'The former Mill Policies and "products considered" lists were converted into operating rules on 25 Oct 2026, with the same numbers and dates.'},
      ]},
    ],
    issues:[
      'A rule that restarts a mill at "0 days of cover" keeps it off after a stop until its silo is empty, even below the critical floor (converted Mill Policies often carry this: the old screen saved 0 meaning "as soon as possible").',
      'Finish mills: a silo between its target and 98% stays eligible, so with nothing more urgent the mill keeps filling it to 98%; the target only ranks products.',
      'Finish mills: two mills sharing a clinker silo both see its morning stock, so together they can draw more clinker than is there.',
      'Kilns: real production entered on a calendar maintenance day is ignored.',
      'Kilns and raw meal mills do not consume raw meal or fuel; output beyond silo capacity is clipped without a warning.',
      'Finish-mill restart rules are always read as days of cover, whatever unit the rule names.',
    ],
  },
  vessels:{
    sections:[
      {title:'Proposing ships', rules:[
        {t:'Ships come from vessel calls you enter, or from the auto-proposer. Auto-proposals are rebuilt every time the simulation runs.', set:'Logistics › Auto-Propose ON/OFF'},
        {t:'A ship is proposed when the receiving silo\'s projected stock falls to minimum-cover days × average daily demand. It is set to arrive that day and to be ordered lead-time days earlier.', set:'Supply source › Min cover days (default 7) · Lead time'},
        {t:'A proposed ship always carries the supply source\'s typical vessel volume.', set:'Supply source › Typical vessel volume'},
        {t:'No ship is proposed when the silo is already at 95% of its target on arrival, when another ship arrives within this one\'s unload time, or when the order date would already be past.'},
        {t:'Once you edit and save a proposed ship it is yours: the simulator no longer replaces it.'},
      ]},
      {title:'Arrival & berth queue', rules:[
        {t:'One ship at a time per berth. Ships wait in arrival order (first come, first served).'},
        {t:'Discharge starts the day after arrival at the earliest. When a ship finishes, the next one discharges the following day.'},
        {t:'A ship that is waiting with room in its silo may take the berth from a docked ship that cannot discharge (berth yield).'},
      ]},
      {title:'Discharge', rules:[
        {t:'Daily discharge = the lower of the berth rate and the vessel rate (t/h) × 24 × the number of unload points.', set:'Berth › Max unload rate · Simultaneous unload points'},
        {t:'Discharge is all or nothing each day: if a full day does not fit in the silo, the ship waits at anchorage and discharges nothing. The exception is a day bigger than the whole silo, which tops it off.'},
        {t:'Cargo goes to the berth\'s downstream silo that holds the product.'},
      ]},
      {title:'Real data & campaigns', rules:[
        {t:'Real unloading replaces the plan for that berth and day, and is taken from the ship carrying that product.', set:'Daily Data · vessel cells'},
        {t:'An Anchorage campaign keeps a ship off the berth for its dates. An Unloading campaign lets a docked ship discharge part of a day and stops it from yielding the berth.', set:'Vessel Schedule › campaigns'},
        {t:'Laytime and demurrage (SOF) are for reporting; they do not change the simulation.'},
      ]},
    ],
    issues:[
      'The auto-proposer uses its own simplified projection (starting stock, demand and discharge only — no real stock, production or rail), and lets a ship discharge on its arrival day, so proposals run about a day late against the simulation.',
      'A vessel call whose arrival date is before the simulation start date is dropped, even if it is still discharging.',
      'Berth maintenance does not stop discharge.',
      'A real unloading of 0 t is ignored, so the forecast discharge runs that day anyway.',
      'An Unloading campaign does not move a waiting ship ahead of the queue, although its popup says so.',
      'Two berths fed by the same supply source can each propose a ship for the same shortage.',
      'Split vessels: leg 2 does not wait for leg 1 to finish.',
    ],
  },
  rail:{
    sections:[
      {title:'Loading at the origin', rules:[
        {t:'The siding loads cars on its working days, up to its loading capacity (cars per shift × shifts per day), shared by all products.', set:'Dispatch point › Working days · Loading cars'},
        {t:'Cars loaded per product follow the loading plan: a dated campaign beats the base rate. Loading is limited by whole cars available in the silo feeding the siding.', set:'Rail Schedule › Loaded row · Supply › Rail Car Loading'},
        {t:'Real loaded cars replace the plan for that day.'},
        {t:'Loaded cars wait in the origin yard until a switch takes them. A yard count you type sets the yard to that number.', set:'Rail Schedule › Available at switch'},
      ]},
      {title:'Switch & car split', rules:[
        {t:'The train leaves on the dispatch point\'s switch days (and on any day with real dispatches).', set:'Dispatch point › Switch days'},
        {t:'What leaves: real dispatches first (they replace the plan for the day), then pushes you confirmed, then — for every terminal and product with no push — the suggested split.'},
        {t:'The suggested split sends all cars in the yard, shared by each terminal\'s demand for that product over the 7 days after the cars arrive. With no demand that week it looks 14 days ahead, then 30 days ahead, then at the 30 days before arrival; with no demand at all the cars go to the first terminal.'},
        {t:'A confirmed 0-car push means "send none" to that terminal.'},
      ]},
      {title:'Transit & terminal', rules:[
        {t:'Cars arrive at the terminal\'s rail yard after the transit days for that lane.', set:'Dispatch point › Destinations › transit days'},
        {t:'The terminal pulls everything in the rail yard on its switch days; pulled cars reach the local yard the next morning. A terminal without switch days moves cars the day they arrive.', set:'Rail berth › Switch days'},
        {t:'Unloading has no rate limit: everything in the local yard unloads that day, up to the silo\'s free space.'},
        {t:'Real yard counts, placed cars and real unloading replace the simulated figures.', set:'Rail Schedule › Reconcile Rail Yard'},
      ]},
    ],
    issues:[
      'A dispatch point with no car capacity set loads at 50 t per car, while the rest of the app uses 112 t.',
      'The origin loading calendar ignores non-working days that the Rail Schedule honours, so the two can disagree on holidays.',
      'Mixed-product cars at a terminal all unload into the silo of the first product.',
      'The suggested split uses demand before demand swaps.',
    ],
  },
  demand:{
    sections:[
      {title:'Demand amount', rules:[
        {t:'Each day a demand point needs its actual shipments when they are recorded, otherwise its forecast. On a non-working day demand is 0 unless overridden.', set:'Demand page'},
        {t:'Demand swaps move a fixed tonnage or a % of one point\'s demand to another product or point, on forecast days only.', set:'Demand › ⇄ Demand Swaps'},
        {t:'Demand at a purchased facility is always served in full and does not touch any silo.'},
      ]},
      {title:'Serving demand', rules:[
        {t:'A demand point draws from the silos connected to it, plus any cement silo at its facility that holds the product. Rail loading silos never serve demand.'},
        {t:'Products are served in the demand point\'s priority order; bulk silos first, packed silos only when bulk runs out. Stock can be drawn down to zero.', set:'Demand point › products'},
        {t:'Only stock from the start of the day is available — today\'s production or unloading serves tomorrow.'},
        {t:'Demand that cannot be served is lost, not carried to the next day. A day counts as short when it misses by more than 0.5 t.'},
      ]},
      {title:'Silo limits', rules:[
        {t:'End-of-day stock is kept between zero and the silo\'s capacity.'},
        {t:'A silo shows "critical low" at or below its critical floor and "full" from 98% of capacity.'},
      ]},
    ],
    issues:[
      'Stock above a silo\'s capacity disappears without a warning.',
      'A silo in maintenance takes no inflow or outflow that day, but demand drawn from it still counts as served.',
      'Purchased facility contract limits are flagged on the Supply page but not enforced.',
      'Truck dispatch is not simulated: truck dispatch points only pass stock through.',
      'A demand point that only receives swapped-in demand is left out, so that swapped volume is lost.',
    ],
  },
  transfers:{
    sections:[
      {title:'Silo transfers', rules:[
        {t:'A transfer link moves product between two bulk silos that both hold it, in its direction (both ways for a two-way link).', set:'Logistics › Silo Transfers'},
        {t:'How much: the recorded actual first, otherwise the plan (a one-day entry beats a campaign). Nothing moves without one of them.'},
        {t:'Transfers run first thing in the morning and move the smallest of: the tonnes asked, the stock at the origin, and the room at the destination.'},
      ]},
    ],
    issues:[
      'Transfers ignore silo maintenance.',
    ],
  },
};

// Rule types the simulator can enforce (the hook points in simulate() — getRules). `on` = the
// equipment types it works on. Anything else is "not supported yet".
const SIM_RULE_TYPES={
  mill_operation:{area:'production', on:['finish_mill'], label:'Mill operating rule',
    what:'How a finish mill decides when to stop, when to restart and what to make. Settings the rule does not mention keep the simulator\'s defaults.',
    params:[
      {k:'product', l:'For product', t:'product', def:'all its products'},
      {k:'stop_pct', l:'Stop filling at % of silo', t:'number', def:'98%'},
      {k:'restart_pct', l:'Restart when silo ≤ %', t:'number'},
      {k:'restart_cover_days', l:'Restart when cover ≤ days', t:'number'},
      {k:'restart_order', l:'Restart with', t:'order', def:'the most urgent product'},
      {k:'min_run_days', l:'Minimum run (days)', t:'number', def:'none'},
      {k:'products_allowed', l:'Only make', t:'products', def:'all its products'},
      {k:'target_pct', l:'Aim for % of silo', t:'number', def:'the silo objective (100 / 75 / 50%)'},
      {k:'critical_floor_pct', l:'Critical below %', t:'number', def:'the silo floor (10%)'},
      {k:'switch_dow', l:'Change product only on', t:'dow', def:'any day'},
      {k:'lookahead_days', l:'Look-ahead (days)', t:'number', def:'14'},
      {k:'min_tpd', l:'Min t/day', t:'number'},
      {k:'max_tpd', l:'Max t/day', t:'number'},
    ],
    // What a complete finish-mill rule says — shown while writing, and asked after Interpret
    // when the words leave a point out (with the default the simulator will use instead).
    checklist:[
      {keys:['stop_pct'], q:'When should it stop?', ex:'"stop when the silo reaches 95%"', def:'it stops filling a silo at 98% of capacity'},
      {keys:['restart_pct','restart_cover_days'], q:'When should it restart after a stop?', ex:'"restart when the silo is down to 3 days of cover" or "below 60%"', def:'it restarts the next day, as soon as a silo needs product'},
      {keys:['restart_order'], q:'When it restarts, which product first?', ex:'"restart with IL(12), then SPC"', def:'the product whose silo is most urgent', multi:true},
      {keys:['min_run_days'], q:'How many days at least on one product?', ex:'"keep a product at least 2 days"', def:'no minimum', multi:true},
      {keys:['products_allowed'], q:'Which products may it make in this period?', ex:'"make only IL(12)"', def:'all the products it is set up for', multi:true},
    ]},
  min_run_duration:{area:'production', on:['finish_mill'], label:'Minimum run',
    what:'Once a finish mill starts a product it keeps it for at least this many running days.',
    params:[{k:'min_days', l:'Minimum days', t:'number'}]},
  restart_threshold:{area:'production', on:['kiln','finish_mill'], label:'Restart threshold',
    what:'After stopping because its silo is full, the equipment does not restart until stock falls to this level (finish mills read it as days of cover).',
    params:[{k:'metric', l:'Measured as', t:'select', opts:['inventory_days','inventory_pct','inventory_t']},{k:'threshold', l:'Threshold', t:'number'}]},
  product_switch_window:{area:'production', on:['finish_mill'], label:'Product-change days',
    what:'A finish mill may change product only on these weekdays (it may still switch in an emergency when its product cannot run).',
    params:[{k:'allowed_dow', l:'Allowed days', t:'dow'}]},
  production_bounds:{area:'production', on:['finish_mill'], label:'Daily output limits',
    what:'Daily output of the finish mill is kept between these t/day.',
    params:[{k:'min_tpd', l:'Min t/day', t:'number'},{k:'max_tpd', l:'Max t/day', t:'number'}]},
  maintenance_guard:{area:'production', on:null, label:'No overlapping maintenance',
    what:'The selected equipment may not be in maintenance on the same day (a later event\'s day is skipped).',
    params:[]},
};
const _DOW_NM=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// An interpretation the engine can run: a known type. structured:{} (an empty answer) is NOT one.
function _ruleIsInterpreted(rule){ return !!(rule?.structured?.type&&SIM_RULE_TYPES[rule.structured.type]); }
// The rule's area — saved on new rules; derived from the equipment for older ones.
function _ruleArea(rule){
  if(rule.area) return rule.area;
  if(_ruleIsInterpreted(rule)) return SIM_RULE_TYPES[rule.structured.type].area;
  const types=(rule.element_ids||[]).map(id=>DB.elements.find(e=>e.id===id)?.type).filter(Boolean);
  if(types.some(t=>['kiln','finish_mill','raw_meal_mill','packing_plant'].includes(t))) return 'production';
  if(types.includes('dispatch_point')) return 'rail';
  if(types.includes('berth')) return 'vessels';
  return 'demand';
}
// Older rules were "active" the moment they were saved, before any interpretation. A rule now
// reaches the simulator only once interpreted and accepted, so those go back to draft, and an
// empty interpretation ({}) counts as none — it used to block re-interpretation for good.
function _rulesNormalize(){
  _millPoliciesToRules();
  (DB.simulation_rules||[]).forEach(r=>{
    if(r.structured&&!r.structured.type&&!r.structured.unsupported) r.structured=null;
    if(r.status==='active'&&!_ruleIsInterpreted(r)) r.status='draft';
    if(!r.status) r.status='draft';
  });
}
// Mill operating rule → one plain sentence (used for converted policies and as the summary).
function _millOpSentence(millName, p){
  const pn=id=>DB.products.find(x=>x.id===id)?.name||id;
  const parts=[];
  if(p.stop_pct!=null) parts.push(`stop filling the silo at ${p.stop_pct}% of capacity`);
  if(p.target_pct!=null) parts.push(`aim for ${p.target_pct}% of the silo`);
  if(p.critical_floor_pct!=null) parts.push(`treat the silo as critical below ${p.critical_floor_pct}%`);
  if(p.restart_pct!=null) parts.push(`after a stop, restart when the silo is down to ${p.restart_pct}%`);
  if(p.restart_cover_days!=null) parts.push(+p.restart_cover_days===0?'after a stop, restart only when the silo is empty (0 days of cover)':`after a stop, restart when the silo has ${p.restart_cover_days} days of cover or less`);
  if(p.restart_order?.length) parts.push(`when restarting, start with ${p.restart_order.map(pn).join(', then ')}`);
  if(p.min_run_days!=null&&+p.min_run_days>0) parts.push(`keep a product at least ${p.min_run_days} day${+p.min_run_days===1?'':'s'}`);
  if(p.products_allowed?.length) parts.push(`make only ${p.products_allowed.map(pn).join(', ')}`);
  if(p.switch_dow?.length) parts.push(`change product only on ${p.switch_dow.map(d=>_DOW_NM[d]).join(', ')}`);
  if(p.lookahead_days!=null) parts.push(`look ${p.lookahead_days} days ahead`);
  if(p.min_tpd||p.max_tpd) parts.push(`produce ${p.min_tpd||0}–${p.max_tpd||'max'} t/day`);
  return `${millName}${p.product?` making ${pn(p.product)}`:''}: ${parts.join('; ')||'no settings'}.`;
}
// Mill Policies → accepted operating rules (once per row; the row is kept, marked migrated, so an
// older copy of the app that re-saves it does not bring it back as a second source).
function _millPoliciesToRules(){
  if(!DB.simulation_rules) DB.simulation_rules=[];
  let n=0;
  const mill=id=>DB.elements.find(e=>e.id===id);
  const facOf=el=>el?[el.assigned_facility_id||el.facility_id].filter(Boolean):[];
  const add=(src,eid,params,label)=>{
    const el=mill(eid), id='rule_'+src.id;
    if(!DB.simulation_rules.some(r=>r.id===id)){
      const text=_millOpSentence(el?.name||eid, params);
      DB.simulation_rules.push({id, name:`${el?.name||eid} · ${label}`, area:'production', facility_ids:facOf(el), element_ids:[eid],
        natural_text:text, structured:{type:'mill_operation', params, plain_summary:text,
          caveat:+params.restart_cover_days===0?'Converted from Mill Policies, where 0 meant "restart as soon as possible" — the simulator reads 0 days as "only when the silo is empty". If you meant as soon as possible, remove the restart part.':undefined},
        date_from:src.date_from||null, date_to:src.date_to||null, status:'active', conflict_ids:[], from_policy:true,
        created_at:src.created_at||new Date().toISOString(), accepted_at:new Date().toISOString()});
    }
    src.migrated_rule_id=id; n++;
  };
  (DB.mill_policies||[]).filter(p=>!p.migrated_rule_id).forEach(p=>{
    const eid=p.element_id||(p.element_ids||[])[0]; if(!eid) return;
    const params={product:p.product_id||null}; Object.entries(p.params||{}).forEach(([k,v])=>{ if(v!=null&&v!=='') params[k]=v; });
    add(p,eid,params,`${p.product_id?(DB.products.find(x=>x.id===p.product_id)?.name||p.product_id):'all products'} (from Mill Policies)`);
  });
  (DB.mill_product_focus||[]).filter(f=>!f.migrated_rule_id).forEach(f=>{
    const eid=f.element_id||(f.element_ids||[])[0]; if(!eid||!(f.products||[]).length) return;
    add(f,eid,{product:null, products_allowed:f.products.slice()},'products allowed (from Mill Policies)');
  });
  if(n) autoSave();
  return n;
}
function _ruleStructuredSummary(s){
  if(!s) return 'Not interpreted';
  if(s.unsupported) return 'Not supported yet'+(s.reason?' — '+s.reason:'');
  const T=SIM_RULE_TYPES[s.type]; if(!T) return 'Not interpreted';
  const p=s.params||{};
  const map={
    min_run_duration:`Minimum run ${p.min_days??'?'} days`,
    restart_threshold:`Restart when stock ≤ ${p.threshold??'?'} ${({inventory_pct:'% of capacity',inventory_days:'days of cover',inventory_t:'t'})[p.metric||'inventory_days']||''}`,
    product_switch_window:`Product changes only on ${(p.allowed_dow||[]).map(d=>_DOW_NM[d]).join(', ')||'—'}`,
    production_bounds:`Output ${p.min_tpd||0}–${p.max_tpd||'∞'} t/day`,
    maintenance_guard:'No overlapping maintenance',
    mill_operation:'Mill operating rule',
  };
  return map[s.type]||T.label;
}

// ── Rules page (Configuration › Simulation Rules) ──
// Area chips · "How the simulator plays" (SIM_RULEBOOK) · "Your rules" for that area.
function _rulesPanelHTML(){
  _rulesNormalize();
  const area=window._rulesArea||'production';
  const rules=DB.simulation_rules||[];
  const nIn=a=>rules.filter(r=>_ruleArea(r)===a).length;
  const chips=SIM_RULE_AREAS.map(a=>`<button class="rules-chip${a.id===area?' on':''}" onclick="_rulesSetArea('${a.id}')" title="${esc(a.hint)}">${a.label}${nIn(a.id)?` <span class="rules-chip-n">${nIn(a.id)}</span>`:''}</button>`).join('');
  const book=SIM_RULEBOOK[area]||{sections:[],issues:[]};
  const bookHtml=book.sections.map(sec=>`<div class="rules-sec"><div class="rules-sec-t">${esc(sec.title)}</div><ol class="rules-ol">${
    sec.rules.map(r=>`<li>${esc(r.t)}${r.set?`<div class="rules-set">⚙ ${esc(r.set)}</div>`:''}</li>`).join('')}</ol></div>`).join('');
  const issues=book.issues?.length?`<details class="rules-issues"><summary>⚠ Known issues (${book.issues.length}) — the code does not yet do what you would expect</summary><ul>${
    book.issues.map(t=>`<li>${esc(t)}</li>`).join('')}</ul></details>`:'';
  const pol=area==='production'&&(DB.mill_policies||[]).some(p=>p.migrated_rule_id)?`<div class="rules-note">Your former Mill Policies are listed below as operating rules (marked "from Mill Policies").</div>`:'';
  const supported=Object.values(SIM_RULE_TYPES).filter(T=>T.area===area);
  return `
    <div class="rules-top">
      <div class="rules-chips">${chips}</div>
      <button class="tb-btn amber" onclick="_openNewRule()">+ New Rule</button>
    </div>
    <div class="rules-body">
      <div class="rules-col">
        <div class="rules-h">How the simulator plays — ${esc(SIM_RULE_AREAS.find(a=>a.id===area)?.label||area)}</div>
        ${bookHtml}${issues}
      </div>
      <div class="rules-col">
        <div class="rules-h">Your rules — ${esc(SIM_RULE_AREAS.find(a=>a.id===area)?.label||area)}</div>
        <div class="rules-note">Write a rule in plain words, click <b>Interpret</b>, check the numbers, <b>Preview</b> what it changes, then <b>Accept</b>. Only accepted rules reach the simulation.
          ${supported.length?`Rules the simulator can follow here: ${supported.map(T=>esc(T.label)).join(' · ')}.`:'No custom rule types exist for this area yet — rules you write here are kept as notes and marked "not supported yet".'}</div>
        ${pol}
        <div id="rules-list-wrap">${_renderRulesList()}</div>
      </div>
    </div>`;
}
function _rulesSetArea(a){ window._rulesArea=a; _rulesRefresh(); }
function _rulesRefresh(){
  // the page and the Configure pop-up can both hold the panel — refresh every copy
  document.querySelectorAll('[id="cfg-panel-rules"]').forEach(p=>{ p.innerHTML=_rulesPanelHTML(); });
  const k=(DB.simulation_rules||[]).filter(r=>r.status==='active'&&_ruleIsInterpreted(r)).length;
  document.querySelectorAll('[id="cfg-tab-rules"] span').forEach(n=>{ n.textContent=k; });
}
// Back to the rules list from a rule dialog — the page when it is showing, else the modal.
function _rulesBack(){
  if(S.view==='cfgpanel'&&document.getElementById('cfg-panel-rules')){ closeModal(); _rulesRefresh(); }
  else { showModal('sim-cfg-modal'); _cfgTab('rules'); }
}
// The Rules button on every page opens the page on the area of the view you are on.
function _rulesAreaForView(){
  const v=S.view, t=S.activeSchedTab;
  if(v==='schedules') return t==='vessels'?'vessels':t==='rail'?'rail':t==='silo'?'transfers':'production';
  if(v==='demand'||v==='salesperf') return 'demand';
  return 'production';
}
function openRulesPage(area){
  window._rulesArea=area||window._rulesArea||'production';
  switchTopSection('configuration');
  const tab=document.querySelector('#second-row .sec-tab[data-tab="rules"]');
  if(tab) _secTabClick(tab,'cfgpanel','rules'); else { switchView('cfgpanel'); renderCfgPanel('rules'); }
}

function _renderRulesList(){
  const area=window._rulesArea||'production';
  const all=DB.simulation_rules||[];
  const idx=all.map((r,i)=>i).filter(i=>_ruleArea(all[i])===area);
  if(!idx.length) return `<div class="rules-empty">No rules for this area yet. Click + New Rule to add one.</div>`;
  return idx.map(i=>{
    const rule=all[i], s=rule.structured, T=_ruleIsInterpreted(rule)?SIM_RULE_TYPES[s.type]:null;
    const st=rule.status||'draft';
    const badge=st==='active'?['var(--green)','active']:st==='disabled'?['var(--text-dim)','disabled']
      :T?['var(--blue)','interpreted — review']:s?.unsupported?['var(--red)','not supported yet']:['var(--amber)','needs interpreting'];
    const elNames=(rule.element_ids||[]).map(eid=>DB.elements.find(e=>e.id===eid)?.name||eid).join(', ');
    const facNames=(rule.facility_ids||[]).map(fid=>DB.facilities.find(f=>f.id===fid)?.name||fid).join(', ');
    // Equipment the rule type cannot act on (e.g. a minimum run on a kiln) is called out.
    const badEls=T&&T.on?(rule.element_ids||[]).map(id=>DB.elements.find(e=>e.id===id)).filter(e=>e&&!T.on.includes(e.type)):[];
    const editable=T&&st!=='active';
    const millProds=_ruleMillProducts(rule);
    const pnm=id=>DB.products.find(x=>x.id===id)?.name||id;
    const isSet=v=>v!=null&&v!==''&&!(Array.isArray(v)&&!v.length);
    // An operating rule lists only the settings its words set; the rest stay at the defaults.
    const shownParams=T?T.params.filter(P=>s.type!=='mill_operation'||isSet((s.params||{})[P.k])):[];
    const paramsHtml=T?shownParams.map(P=>{
      const v=(s.params||{})[P.k];
      if(!editable||P.t==='order'&&!millProds.length){
        const shown=P.t==='dow'?(v||[]).map(d=>_DOW_NM[d]).join(', '):P.t==='product'?(v?pnm(v):'all'):(P.t==='products'||P.t==='order')?(v||[]).map(pnm).join(P.t==='order'?' → ':', '):(v??'—');
        return `<span class="rules-param"><span>${esc(P.l)}</span> <b>${esc(String(shown))}</b></span>`;
      }
      if(P.t==='product') return `<label class="rules-param"><span>${esc(P.l)}</span> <select onchange="_ruleParam(${i},'${P.k}',this.value||null)"><option value="">all products</option>${millProds.map(id=>`<option value="${esc(id)}" ${id===v?'selected':''}>${esc(pnm(id))}</option>`).join('')}</select></label>`;
      if(P.t==='products') return `<span class="rules-param"><span>${esc(P.l)}</span> ${millProds.map(id=>`<label class="rules-dow"><input type="checkbox" ${(v||[]).includes(id)?'checked':''} onchange="_ruleListToggle(${i},'${P.k}','${esc(id)}',this.checked)">${esc(pnm(id))}</label>`).join('')}</span>`;
      if(P.t==='order') return `<span class="rules-param"><span>${esc(P.l)}</span> ${(v||[]).map((id,k)=>`<select onchange="_ruleOrderSet(${i},${k},this.value)"><option value="">—</option>${millProds.map(x=>`<option value="${esc(x)}" ${x===id?'selected':''}>${esc(pnm(x))}</option>`).join('')}</select>`).join(' → ')}</span>`;
      if(P.t==='select') return `<label class="rules-param"><span>${esc(P.l)}</span> <select onchange="_ruleParam(${i},'${P.k}',this.value)">${P.opts.map(o=>`<option ${o===(v||P.opts[0])?'selected':''}>${o}</option>`).join('')}</select></label>`;
      if(P.t==='dow') return `<span class="rules-param"><span>${esc(P.l)}</span> ${_DOW_NM.map((d,k)=>`<label class="rules-dow"><input type="checkbox" ${(v||[]).includes(k)?'checked':''} onchange="_ruleDow(${i},${k},this.checked)">${d}</label>`).join('')}</span>`;
      return `<label class="rules-param"><span>${esc(P.l)}</span> <input type="number" value="${v??''}" onchange="_ruleParam(${i},'${P.k}',this.value===''?null:parseFloat(this.value))"></label>`;
    }).join(''):'';
    // Points a complete rule covers that these words leave out: each shows the default the
    // simulator will use, and can be answered here (the answer is added to the rule and re-read).
    const missing=T?.checklist?T.checklist.filter(c=>!(c.multi&&millProds.length<2&&c.keys[0]==='restart_order')&&!c.keys.some(k=>isSet((s.params||{})[k]))):[];
    const missHtml=missing.length&&st!=='active'?`<div class="rules-miss"><div class="rules-miss-h">Not said — the simulator will use its default unless you answer:</div>${missing.map((c,k)=>`<div class="rules-miss-q"><span><b>${esc(c.q)}</b> Default: ${esc(c.def)}.</span><span><input id="rq-${i}-${k}" placeholder="${esc(c.ex.replace(/"/g,''))}"><button class="tb-btn sec" onclick="_ruleAnswer(${i},'rq-${i}-${k}')">Add</button></span></div>`).join('')}</div>`:'';
    const pv=rule._preview;
    const pvHtml=pv&&T?`<table class="rules-pv"><tr><th>Effect over the horizon (${esc(pv.at.slice(0,10))})</th><th>Without</th><th>With</th></tr>${
      pv.rows.map(r=>`<tr${r.b!==r.a?' class="chg"':''}><td>${esc(r.l)}</td><td>${esc(String(r.b))}</td><td>${esc(String(r.a))}</td></tr>`).join('')}</table>`:'';
    const acts=[];
    if(st!=='active'&&!T) acts.push(`<button class="tb-btn blue" onclick="_ruleInterpret(${i})">✨ Interpret</button>`);
    if(T&&st!=='active'){
      acts.push(`<button class="tb-btn sec" onclick="_rulePreview(${i})">▶ Preview effect</button>`);
      acts.push(`<button class="tb-btn amber" onclick="_ruleAccept(${i})">✓ Accept</button>`);
      acts.push(`<span class="tbl-act" onclick="_ruleInterpret(${i})">Re-interpret</span>`);
    }
    if(st==='active') acts.push(`<span class="tbl-act" onclick="_toggleRule(${i})">Disable</span>`);
    if(st==='disabled') acts.push(`<span class="tbl-act" onclick="_toggleRule(${i})">Enable</span>`);
    acts.push(`<span class="tbl-act" onclick="_editRule(${i})">Edit</span>`,`<span class="tbl-act del" onclick="_deleteRule(${i})">Del</span>`);
    return `<div class="rules-card">
      <div class="rules-card-hd"><b>${esc(rule.name||'Rule '+(i+1))}</b><span class="rules-badge" style="border-color:${badge[0]};color:${badge[0]}">${badge[1]}</span></div>
      <div class="rules-meta">${facNames?`<span style="color:var(--blue)">${esc(facNames)}</span> · `:''}${esc(elNames||'No equipment')}${rule.date_from?` · ${esc(rule.date_from)} → ${esc(rule.date_to||'∞')}`:''}</div>
      <div class="rules-text">"${esc(rule.natural_text||'')}"</div>
      ${T?`<div class="rules-read"><b>${esc(T.label)}</b> — ${esc(s.plain_summary||T.what)}</div>`:''}
      ${s?.unsupported?`<div class="rules-read bad">Not supported yet — ${esc(s.reason||'the simulator has no rule of this kind')}. The rule is kept as a note and does not change the simulation.</div>`:''}
      ${s?.caveat?`<div class="rules-read warn">⚠ ${esc(s.caveat)}</div>`:''}
      ${badEls.length?`<div class="rules-read warn">⚠ ${esc(T.label)} only works on ${T.on.map(x=>x.replace('_',' ')).join(' / ')} — ignored for ${esc(badEls.map(e=>e.name).join(', '))}.</div>`:''}
      ${rule._interpret_error&&!s?`<div class="rules-read bad">Interpretation failed: ${esc(rule._interpret_error)}</div>`:''}
      ${rule.from_policy?`<div class="rules-meta">from Mill Policies</div>`:''}
      ${paramsHtml?`<div class="rules-params">${paramsHtml}</div>`:''}
      ${missHtml}
      ${pvHtml}
      <div class="rules-acts">${acts.join('')}</div>
    </div>`;
  }).join('');
}
function _ruleParam(i,k,v){
  const rule=DB.simulation_rules[i]; if(!rule?.structured) return;
  rule.structured.params={...(rule.structured.params||{}),[k]:v};
  delete rule._preview; autoSave(); _rulesRefresh();
}
// Products the rule's finish mill(s) can make (for the product pickers and the checklist).
function _ruleMillProducts(rule){
  return [...new Set((rule.element_ids||[]).flatMap(id=>typeof _mpProdsOf==='function'?_mpProdsOf(id):[]))];
}
function _ruleListToggle(i,k,id,on){
  const rule=DB.simulation_rules[i]; if(!rule?.structured) return;
  const cur=new Set(rule.structured.params?.[k]||[]); on?cur.add(id):cur.delete(id);
  _ruleParam(i,k,[...cur]);
}
function _ruleOrderSet(i,pos,id){
  const rule=DB.simulation_rules[i]; if(!rule?.structured) return;
  const cur=(rule.structured.params?.restart_order||[]).slice(); cur[pos]=id;
  _ruleParam(i,'restart_order',cur.filter(Boolean));
}
// An answer to a "not said" question is added to the rule's words and the rule is read again.
async function _ruleAnswer(i,inputId){
  const rule=DB.simulation_rules[i]; const v=document.getElementById(inputId)?.value?.trim();
  if(!rule||!v) return;
  rule.natural_text=(rule.natural_text||'').replace(/\s*$/,'')+(/[.!?]$/.test(rule.natural_text||'')?' ':'. ')+v.replace(/^./,c=>c.toUpperCase())+(/[.!?]$/.test(v)?'':'.');
  autoSave();
  await _ruleInterpret(i);
}
function _ruleDow(i,d,on){
  const rule=DB.simulation_rules[i]; if(!rule?.structured) return;
  const cur=new Set(rule.structured.params?.allowed_dow||[]); on?cur.add(d):cur.delete(d);
  _ruleParam(i,'allowed_dow',[...cur].sort((a,b)=>a-b));
}
function _ruleAccept(i){
  const rule=DB.simulation_rules[i]; if(!_ruleIsInterpreted(rule)) return;
  rule.status='active'; rule.accepted_at=new Date().toISOString();
  autoSave(); _rulesRefresh();
  statMsg(`Rule "${rule.name}" accepted — running simulation…`); scheduleSimulation();
}
function _toggleRule(i){
  const rule=DB.simulation_rules[i]; if(!rule) return;
  if(rule.status==='disabled'&&!_ruleIsInterpreted(rule)){ rule.status='draft'; }
  else rule.status=rule.status==='disabled'?'active':'disabled';
  autoSave(); _rulesRefresh(); scheduleSimulation();
}
function _deleteRule(i){
  if(!confirm('Delete this rule?')) return;
  const was=DB.simulation_rules[i]?.status;
  DB.simulation_rules.splice(i,1);
  autoSave(); _rulesBack();
  if(was==='active') scheduleSimulation();
}

// ── Interpret one rule (Claude) ──
// The text is turned into ONE supported rule type with numbers, or "not supported yet" —
// never a forced guess. The result waits for review; nothing reaches the simulation until Accept.
const _RULE_INTERPRET_PROMPT=`You turn a planner's plain-language rule for the AVILA Roll cement supply-chain simulator into ONE supported rule type.
Respond ONLY with JSON — no markdown, no explanation.

Supported types and the equipment they work on:
- mill_operation (finish mills) — USE THIS for anything about how a finish mill stops, restarts, what it makes, minimum runs, product-change days or t/day limits; one rule can carry several settings. params — include ONLY what the rule states:
  {"product":product_id|null (the one product the rule is about; null = all the mill's products),
   "stop_pct":number (stop filling the silo at this % of capacity),
   "restart_pct":number (after a stop, restart when the silo is at or below this %),
   "restart_cover_days":number (after a stop, restart when the silo has this many days of cover or less),
   "restart_order":[product_id,...] (when it restarts, which product first, then next),
   "min_run_days":number, "products_allowed":[product_id,...] (it may make only these),
   "target_pct":number, "critical_floor_pct":number, "switch_dow":[0-6] (product changes only on these weekdays, 0=Sunday),
   "lookahead_days":number, "min_tpd":number, "max_tpd":number}
  Use the product ids given with the equipment. "plain_summary" must name the mill and every setting.
- min_run_duration (finish mills): once a mill starts a product it keeps it at least N running days. params {"min_days":number}
- restart_threshold (kilns, finish mills): after stopping because its silo is full, it does not restart until stock falls to the threshold. params {"metric":"inventory_days"|"inventory_pct"|"inventory_t","threshold":number}. Finish mills always read the threshold as days of cover.
- product_switch_window (finish mills): product changes only on the listed weekdays. params {"allowed_dow":[0-6]} with 0=Sunday … 6=Saturday
- production_bounds (finish mills): daily output kept between min and max t/day. params {"min_tpd":number|null,"max_tpd":number|null}
- maintenance_guard (any equipment): the selected equipment may not be in maintenance on the same day. params {"allow_simultaneous":false}

If the rule fits one type only partly, use that type and say in "caveat" which part will NOT be enforced.
If it cannot be expressed with these types, answer {"type":null,"unsupported":true,"reason":"short reason"}.
Otherwise answer {"type":"...","params":{...},"plain_summary":"one sentence: what the simulator will do","caveat":"optional"}.`;
async function _ruleInterpretOne(rule){
  const elContext=(rule.element_ids||[]).map(eid=>{
    const el=DB.elements.find(e=>e.id===eid);
    const fac=DB.facilities.find(f=>f.id===(el?.assigned_facility_id||el?.facility_id));
    const prods=el?.type==='finish_mill'&&typeof _mpProdsOf==='function'?_mpProdsOf(eid).map(id=>`${DB.products.find(p=>p.id===id)?.name||id} = ${id}`).join(', '):'';
    return `${el?.name||eid} (${el?.type||'?'}, at ${fac?.name||'?'}${prods?`; products: ${prods}`:''})`;
  }).join('; ');
  const data=await callClaude({maxTokens:400, system:_RULE_INTERPRET_PROMPT,
    messages:[{role:'user',content:`Area: ${_ruleArea(rule)}\nEquipment: ${elContext||'none selected'}\nRule: "${rule.natural_text}"`}]});
  const raw=data.content?.[0]?.text||'{}';
  const parsed=JSON.parse(raw.replace(/```json|```/g,'').trim());
  if(parsed.type==='mill_operation'&&parsed.params){   // keep only settings the words gave
    Object.keys(parsed.params).forEach(k=>{ const v=parsed.params[k]; if(v==null||v===''||(Array.isArray(v)&&!v.length)) delete parsed.params[k]; });
    if(!('product' in parsed.params)) parsed.params.product=null;
  }
  if(parsed.type&&!SIM_RULE_TYPES[parsed.type]) { parsed.unsupported=true; parsed.reason=parsed.reason||`"${parsed.type}" is not a rule the simulator knows`; parsed.type=null; }
  if(!parsed.type&&!parsed.unsupported){ parsed.unsupported=true; parsed.reason=parsed.reason||'no matching rule type'; }
  rule.structured=parsed;
  rule._interpreted_at=new Date().toISOString();
  rule._interpret_error=null;
  delete rule._preview;
  if(rule.status==='active') rule.status='draft';
  return parsed;
}
async function _ruleInterpret(i){
  const rule=DB.simulation_rules[i]; if(!rule) return;
  if(!getApiKey()){ alert('Interpreting a rule needs your Claude API key — add it in Configuration › AI Agent.'); return; }
  statMsg(`Interpreting "${rule.name}"…`);
  try{ await _ruleInterpretOne(rule); statMsg(`"${rule.name}" interpreted — review the numbers, then Preview / Accept`); }
  catch(e){ rule.structured=null; rule._interpret_error=e.message; statMsg('⚠ Interpretation failed: '+e.message); }
  autoSave(); _rulesRefresh();
}

// ── Preview: the simulation with and without this rule ──
// Runs simulate() twice on the current canvas (the rule as draft, then as active) and compares
// what the rule's equipment does over the horizon, plus network-wide demand served.
function _rulePreview(i){
  const rule=DB.simulation_rules[i]; if(!_ruleIsInterpreted(rule)) return;
  if(!S.facility_id){ alert('Select a facility first.'); return; }
  statMsg('Previewing the rule — running the simulation twice…');
  setTimeout(()=>{
    const els=getFacElements(), conns=getFacConnections(), H=_simEffectiveHorizon();
    const keep=rule.status; let base, withR;
    try{ rule.status='draft'; base=simulate(els,conns,H,true); rule.status='active'; withR=simulate(els,conns,H,true); }
    catch(e){ statMsg('⚠ Preview failed: '+e.message); return; }
    finally{ rule.status=keep; }
    rule._preview={at:new Date().toISOString(), rows:_rulePreviewRows(rule,base,withR)};
    _rulesRefresh();
    statMsg('Preview ready — compare "Without" and "With", then Accept');
  },30);
}
function _rulePreviewRows(rule,b,a){
  const rows=[];
  const runs=h=>{ let n=0,prev=null; (h||[]).forEach(p=>{ if(p&&p!==prev) n++; prev=p; }); return n; };
  const days=h=>(h||[]).filter(Boolean).length;
  (rule.element_ids||[]).forEach(id=>{
    const el=DB.elements.find(e=>e.id===id); if(!el) return;
    if(el.type==='finish_mill'){
      const hb=b.millProductHistory[id], ha=a.millProductHistory[id];
      rows.push({l:`${el.name} · running days`, b:days(hb), a:days(ha)});
      rows.push({l:`${el.name} · product runs (campaigns)`, b:runs(hb), a:runs(ha)});
      const avg=h=>{ const r=runs(h); return r?Math.round(days(h)/r*10)/10:0; };
      rows.push({l:`${el.name} · average run length (days)`, b:avg(hb), a:avg(ha)});
    } else if(el.type==='kiln'){
      const sum=h=>Math.round((h||[]).reduce((s,v)=>s+(v||0),0)).toLocaleString();
      const zero=h=>(h||[]).filter(v=>!(v>0)).length;
      rows.push({l:`${el.name} · clinker produced (t)`, b:sum(b.kilnProdHistory[id]), a:sum(a.kilnProdHistory[id])});
      rows.push({l:`${el.name} · days not producing`, b:zero(b.kilnProdHistory[id]), a:zero(a.kilnProdHistory[id])});
    }
  });
  const unmet=r=>Math.round(Object.values(r.demandFill||{}).reduce((s,d)=>s+Math.max(0,(d.requested||0)-(d.served||0)),0)).toLocaleString();
  const shortD=r=>Object.values(r.demandFill||{}).reduce((s,d)=>s+(d.shortDays||0),0);
  rows.push({l:'Network · demand not served (t)', b:unmet(b), a:unmet(a)});
  rows.push({l:'Network · demand-point short days', b:shortD(b), a:shortD(a)});
  rows.push({l:'Network · stop events', b:(b.stopEvents||[]).length, a:(a.stopEvents||[]).length});
  return rows;
}

function _editRule(i){
  const rule=DB.simulation_rules[i]; if(!rule) return;
  const pi='background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:10px;padding:5px 7px;outline:none;width:100%';
  const pl='font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-bottom:3px;letter-spacing:.5px;text-transform:uppercase';
  const facOpts=DB.facilities.map(f=>`<option value="${f.id}" ${(rule.facility_ids||[]).includes(f.id)?'selected':''}>${f.name} (${f.type})</option>`).join('');

  showModalContent(`
    <div class="modal-hdr">
      <div>
        <span class="modal-title">Edit Rule</span>
        <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:3px">Changing the text clears the interpretation — interpret and accept the rule again</div>
      </div>
      <span class="modal-close" onclick="closeModal()">✕</span>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:14px;min-width:520px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="${pl}">Facility</div>
          <select style="${pi}" id="nr-facility" onchange="_nrLoadEquipment()">
            <option value="">— Select facility —</option>
            ${facOpts}
          </select>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="${pl}">Rule Name</div>
          <input style="${pi}" id="nr-name" value="${rule.name||''}">
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px">
        <div style="${pl}">Equipment <span style="color:var(--text-dim);font-style:italic">(hold Ctrl / ⌘ to select multiple)</span></div>
        <select style="${pi};height:90px" id="nr-elements" multiple onchange="_nrGuide()">
          <option disabled>— Select a facility first —</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="${pl}">Valid From</div>
          <input style="${pi}" type="date" id="nr-date-from" value="${rule.date_from||S.simCfg.start_date}">
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="${pl}">Valid Until</div>
          <input style="${pi}" type="date" id="nr-date-to" value="${rule.date_to||''}">
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px">
        <div style="${pl}">Rule — write in plain language</div>
        <div id="nr-guide"></div>
        <textarea style="${pi};height:100px;resize:vertical;line-height:1.5" id="nr-text">${rule.natural_text||''}</textarea>
      </div>
      ${rule.structured?`<div style="font-family:var(--mono);font-size:8px;padding:8px;background:var(--green-faint);border:1px solid var(--green);color:var(--green)">
        ✓ Currently interpreted as: ${_ruleStructuredSummary(rule.structured)}<br>
        <span style="color:var(--text-dim)">Changing the text clears this; the rule goes back to draft until you interpret and accept it again.</span>
      </div>`:''}
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn-sec" onclick="_rulesBack()">Cancel</button>
        <button class="tb-btn amber" onclick="_nrSaveEdit(${i})">✓ Save Changes</button>
      </div>
    </div>`);

  // Pre-load equipment for the current facility
  const facId=(rule.facility_ids||[])[0];
  if(facId){
    document.getElementById('nr-facility').value=facId;
    _nrLoadEquipment();
    // Pre-select elements
    setTimeout(()=>{
      const sel=document.getElementById('nr-elements');
      if(sel) [...sel.options].forEach(o=>{
        o.selected=(rule.element_ids||[]).includes(o.value);
      });
      _nrGuide();
    },50);
  }
}

function _nrSaveEdit(i){
  const rule=DB.simulation_rules[i]; if(!rule) return;
  const facId=document.getElementById('nr-facility')?.value;
  const elSel=document.getElementById('nr-elements');
  const elIds=[...elSel.selectedOptions].map(o=>o.value);
  const text=document.getElementById('nr-text')?.value?.trim();
  const name=document.getElementById('nr-name')?.value?.trim();

  if(!text){alert('Please write a rule description.');return;}
  if(!elIds.length){alert('Please select at least one piece of equipment.');return;}

  const textChanged=text!==rule.natural_text;
  rule.name=name||rule.name;
  rule.facility_ids=facId?[facId]:[];
  rule.element_ids=elIds;
  rule.natural_text=text;
  rule.date_from=document.getElementById('nr-date-from')?.value||null;
  rule.date_to=document.getElementById('nr-date-to')?.value||null;
  delete rule._preview;
  const wasActive=rule.status==='active';
  if(textChanged){
    rule.structured=null; // the old reading no longer matches the words — back to draft
    delete rule._interpreted_at;
    rule._interpret_error=null;
    if(rule.status!=='disabled') rule.status='draft';
  }
  autoSave();
  statMsg(`Rule "${rule.name}" updated${textChanged?' — click Interpret, then Accept':''}`);
  _rulesBack();
  if(wasActive) scheduleSimulation();
}

// Keeps the Settings form consistent while it is edited: the tiles follow the start date, a preset
// owns the end date, the Custom tile mirrors it, and the line under it shows what Save would apply.
function _scSyncHorizon(){
  const start=document.getElementById('sc-start')?.value, endEl=document.getElementById('sc-end'), hint=document.getElementById('sc-end-hint');
  if(!start||!endEl||!hint) return;
  _simHorizonPresets(start).forEach(p=>{
    if(p.id==='custom') return;
    const t=document.querySelectorAll(`#preset-${p.id} div`);
    t[1].textContent=`${p.days}d`; t[2].textContent=p.date;
    if(p.id===S.simCfg.horizonPreset) endEl.value=_addDays(start,p.days-1);
  });
  const chk=_simDaysToEnd(start,endEl.value), t=document.querySelectorAll('#preset-custom div');
  t[1].textContent=chk.days?`${chk.days}d`:'—'; t[2].textContent=endEl.value||'—';
  hint.textContent=chk.msg; hint.style.color=chk.days?'var(--text-dim)':'var(--red)';
}

function selectHorizonPreset(id){
  const p=_simHorizonPresets(document.getElementById('sc-start')?.value||S.simCfg.start_date).find(x=>x.id===id);
  S.simCfg.horizonPreset=id;
  S.simCfg.horizon=p.days;
  // Highlight selected
  document.querySelectorAll('[id^="preset-"]').forEach(el=>{
    const pid=el.id.replace('preset-','');
    const active=pid===id;
    el.style.border=`1px solid ${active?'var(--green)':'var(--border2)'}`;
    el.style.background=active?'var(--green-faint)':'var(--surface2)';
    el.querySelectorAll('div').forEach((d,i)=>{
      if(i===0) d.style.color=active?'var(--green)':'var(--text-dim)';
      if(i===1) d.style.color=active?'var(--green)':'var(--text)';
    });
  });
  _scSyncHorizon();
}

// ─────────────────────────────────────────────────────────
// SIMULATION RULES — New Rule form + Claude API interpretation
// ─────────────────────────────────────────────────────────
// SIMULATION RULES
// ─────────────────────────────────────────────────────────
function _openNewRule(){
  const pi='background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:10px;padding:5px 7px;outline:none;width:100%';
  const pl='font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-bottom:3px;letter-spacing:.5px;text-transform:uppercase';
  const facOpts=DB.facilities.map(f=>`<option value="${f.id}">${f.name} (${f.type})</option>`).join('');

  showModalContent(`
    <div class="modal-hdr">
      <div>
        <span class="modal-title">New Simulation Rule</span>
        <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:3px">Write your rule in plain language. It is saved as a draft: click Interpret, check the reading, then Accept</div>
      </div>
      <span class="modal-close" onclick="closeModal()">✕</span>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:14px;min-width:520px">

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="${pl}">Facility</div>
          <select style="${pi}" id="nr-facility" onchange="_nrLoadEquipment()">
            <option value="">— Select facility —</option>
            ${facOpts}
          </select>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="${pl}">Rule Name</div>
          <input style="${pi}" id="nr-name" placeholder="e.g. KL1 Restart Threshold">
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:3px">
        <div style="${pl}">Equipment <span style="color:var(--text-dim);font-style:italic">(hold Ctrl / ⌘ to select multiple)</span></div>
        <select style="${pi};height:90px" id="nr-elements" multiple onchange="_nrGuide()">
          <option disabled>— Select a facility first —</option>
        </select>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="${pl}">Valid From</div>
          <input style="${pi}" type="date" id="nr-date-from" value="${S.simCfg.start_date}">
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="${pl}">Valid Until <span style="color:var(--text-dim)">(leave blank = always)</span></div>
          <input style="${pi}" type="date" id="nr-date-to">
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:3px">
        <div style="${pl}">Rule — write in plain language</div>
        <div id="nr-guide"></div>
        <textarea style="${pi};height:100px;resize:vertical;line-height:1.5" id="nr-text"
          placeholder="e.g. When this equipment shuts down due to high inventory, it should not restart until the silo drops to 50% of its maximum capacity."></textarea>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn-sec" onclick="_rulesBack()">Back</button>
        <button class="tb-btn amber" onclick="_nrSave()">✓ Save Rule</button>
      </div>
    </div>`);
}

function _nrSave(){
  const facId=document.getElementById('nr-facility')?.value;
  const elSel=document.getElementById('nr-elements');
  const elIds=[...elSel.selectedOptions].map(o=>o.value);
  const text=document.getElementById('nr-text')?.value?.trim();
  const name=document.getElementById('nr-name')?.value?.trim();

  if(!text){alert('Please write a rule description.');return;}
  if(!elIds.length){alert('Please select at least one piece of equipment.');return;}

  if(!DB.simulation_rules) DB.simulation_rules=[];
  DB.simulation_rules.push({
    id:`rule_${Date.now()}`,
    name:name||`Rule ${DB.simulation_rules.length+1}`,
    facility_ids:facId?[facId]:[],
    element_ids:elIds,
    natural_text:text,
    structured:null, // set by Interpret; the rule reaches the simulation only after Accept
    area:window._rulesArea||'production',
    date_from:document.getElementById('nr-date-from')?.value||null,
    date_to:document.getElementById('nr-date-to')?.value||null,
    status:'draft',
    conflict_ids:[],
    created_at:new Date().toISOString()
  });
  autoSave();
  statMsg(`Rule "${name||'New rule'}" saved as a draft — click Interpret to check how the simulator reads it`);
  _rulesBack();
}






function saveSimCfg(){
  const start=document.getElementById('sc-start')?.value||S.simCfg.start_date;
  const preset=S.simCfg.horizonPreset||'custom';
  if(preset==='custom'){
    // The typed end date holds when the start date moves: the day count is what follows from them.
    const chk=_simDaysToEnd(start,document.getElementById('sc-end')?.value);
    if(!chk.days){ _scSyncHorizon(); return; }   // the line under the end date says why
    S.simCfg.horizon=chk.days;
  } else {
    // Recompute from the saved start date: the count stored when the tile was last clicked goes
    // stale once the start date changes (and older saves carry the old one-day-short count).
    const p=_simHorizonPresets(start).find(x=>x.id===preset);
    if(p) S.simCfg.horizon=p.days;
  }
  S.simCfg.start_date=start;
  { const role=document.getElementById('sc-role'); if(role){ if(role.value==='planning') S.simCfg.role='planning'; else delete S.simCfg.role; } }
  S.simCfg.conflict_resolution=document.getElementById('sc-conflict')?.value||'rolling_avg';
  if(typeof scUpdatePill==='function') scUpdatePill();
  document.getElementById('sim-date-lbl').textContent=`Day 0 / ${S.simCfg.horizon}`;
  closeModal(); statMsg(`Simulation configured — ${S.simCfg.start_date} to ${_addDays(S.simCfg.start_date,S.simCfg.horizon-1)}, ${S.simCfg.horizon} days`);
}

