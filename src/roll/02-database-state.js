// ═══════════════════════════════════════════════════════
// DATABASE — named tables matching agreed schema
// ═══════════════════════════════════════════════════════
// Default rail-car capacity in tonnes, used wherever a dispatch point / rail
// berth has no car_capacity_t configured. One constant instead of a magic 112
// scattered across 15 sites.
const RAIL_CAR_T_DEFAULT=112;

const DB = {
  // Location hierarchy
  macro_regions:    [],  // { id, name, notes }
  countries:        [],  // { id, macro_region_id, name, notes }
  regions:          [],  // { id, country_id, name, notes }
  sub_regions:      [],  // { id, region_id, name, notes }
  facilities:       [],  // { id, sub_region_id, name, type:'plant'|'terminal'|'purchased', status, notes }

  // Element catalog
  elements:         [],  // { id, facility_id, assigned_facility_id, type, name, x, y, props:{}, state }
  connections:      [],  // { id, facility_id, from_element_id, to_element_id }
  topo_labels:      [],  // { id, text, x, y, size:'s'|'m'|'l', bold, color, facility_id|null } — free text drawn on the topology canvas.
                         //   An annotation, not a topology item: not in TOPO_TABLES (the seal), never read by the simulation.
                         //   facility_id null = shown with every facility filter; set = shown only when that facility is shown.

  // System catalogs
  products:         [],  // { id, name, description, material_code, category:'raw_meal'|'clinker'|'cement_bulk'|'cement_packed'|'additive', facility_id?, facility_label? }
                         //   facility_id — WHERE the product is made (optional, set in the product form). Descriptive metadata:
                         //   the simulation still derives production from element_product_capacities. It seeds the Supply-page
                         //   Facility→Product filter so a product shows up there before it is wired into the topology.
                         //   facility_label — a facility the user typed that is NOT in the topology. Mutually exclusive with
                         //   facility_id (a typed name matching an existing facility resolves to its id on save). It is a plain
                         //   label: it never becomes a DB.facilities row, so it cannot break the org tree or the topology.
  recipes:          [],  // { id, product_id, material_id, pct }  — for cement products: ingredient product_ids; for clinker: raw material ids
  raw_materials:    [],  // { id, name, unit, notes }
  fuels:            [],  // { id, name, unit, calorific_value, co2_factor, notes }
  // Element configuration
  element_maintenance_events: [], // { id, element_id, facility_id, element_name, element_type, name, type:'fixed'|'recurring', start_date, duration_days, end_date, frequency_days, recurrence_end_date, rampup_days, rampup_profile:[], notes }
  element_product_capacities: [], // { id, element_id, product_id, capacity_tpd, power_kwh_t, specific_heat_kcal_kg, raw_meal_ratio } — used by both kilns and finish mills
  element_raw_meal_recipes:   [], // { id, element_id, material_id, pct }

  // Schedules
  vessel_calls:       [], // { id, facility_id, berth_element_id, berth_name, name, arrival_date, cargo_type, quantity_t, unload_rate_tph, transit_days, status, notes }
  vessel_sof:         [], // Statement of Facts per port of call + its time accounting — see VESSEL SOF
  vessel_campaigns:   [], // { id, vessel_call_id, action:'anchorage'|'unloading', start_date, end_date } — manual override of a specific
                          //   vessel's berth status for a date range (mirrors production_campaigns). 'anchorage' forces zero unload and
                          //   frees the berth for the window; 'unloading' forces priority unloading (bypasses the queue/yield logic,
                          //   still capped by destination silo space). Editable from the Supply-page vessel Gantt cell. Real unloading
                          //   entries (real_unloading_daily) still win per day over either.
  rail_movements:     [], // { id, from_facility_id, to_facility_id, from_dispatch_id, to_berth_id, reference, departure_date, wagon_count, wagon_capacity_t, total_capacity_t, product_id, loading_rate_tph, min_load_pct, transit_days, switch_day, status, notes } — also used for manager "push" allocations (status Confirmed)
  rail_loading_plan:  [], // { id, dispatch_id, product_id, cars_per_day, date_from?, date_to? } — ops loading plan: cars/day to load per product at a rail dispatch point. No dates = base rate; dated rows override that range.
  // SILO TRANSFERS (replaced the old truck_movements campaigns, 2026-09-23). A link is the
  // dotted orange line on the topology between two BULK silos holding the same product, in one
  // facility or two. Material moves along it on the day it is planned or recorded, never on the
  // simulation's own initiative. Kept OUT of DB.connections on purpose: the engine reads every
  // connection as a production path (mill→silo→demand), so a silo→silo line there would make
  // one silo look like it feeds the other.
  silo_links:         [], // { id, name, from_silo_id, to_silo_id, product_id, two_way:bool, max_rate_tpd (optional — only warns), created_at } — one_way moves from→to only; two_way also to→from
  silo_transfer_plans:[], // { id, link_id, from_silo_id, to_silo_id, start_date, end_date, rate_tpd, notes } — planned t/day in ONE direction. A one-day row (start===end) typed on the Supply page overrides a broader campaign for its day.
  transport_links:    [], // { id, from_facility_id, to_facility_id, mode:'truck'|'rail'|'vessel', transit_days, notes } — network level links
  in_transit_inventory:[], // { id, mode, reference_id, product_id, quantity_t, departure_date, arrival_date, to_facility_id, to_element_id, status:'in_transit'|'arrived'|'unloading'|'complete' }
  fuel_deliveries:    [], // future
  additive_deliveries:[], // future

  // Demand
  demand_points: [], // { id, facility_id, element_id, element_name, products:[{product_id, priority}], mode, daily_tonnage, objective, rolling_days }
  demand_values: [],    // { element_id, date, value_t, source:'actual'|'forecast', ship_to?:string } — ship_to null=top-down, set=customer-level bottom-up
  monthly_demand: [], // legacy — kept for migration
  demand_forecasts: [], // { id, element_id, method, schedule, value, rolling_days, sat_pct, to_preset, date_from, date_to } — builder rules, ephemeral
  non_working_days: [], // { id, date:'YYYY-MM-DD', reason } — global holidays/shutdowns

  // Planning module (budget today; generic: kind = budget | forecast | what-if). Short tons throughout.
  plan_settings: [], // { id:'default', kind, budget_year, sat_pct, ships_sat, window_months, weights[], floor, pre_purchase_months, low_share_pct, short_window_months, silent_months, rmx_regions[] }
  plan_versions: [], // { id, kind, year, label, status:'draft'|'active'|'archived', uploaded_at, uploaded_by, source_files:[{slot,name,lastModified,size,sheet,rows,fy_t}], note, generated_at, generated_hash, stale }
  plan_lines: [],    // immutable uploaded rows — EXT {sold_to, ship_to, plant, material, incoterm, months[12], fy} · INT {family, rmx_plant, months[12]}
  alloc_keys: [],    // { id, kind, scope, targets:[{element_id, dp_name, share}], floor, window, provenance, status, decided, version_id|null }
  norm_rules: [],    // { id, kind, type:'purchase'|'substitution'|'reassign'|'exclude', dp_name, element_id, customer, line_key, from, to, target, decided, apply_to, version_id|null }
  plan_yields: [],   // Planning: average yield per unit x product from the trend's recorded production (plComputeYields) -> the Push to BI sensitivity cases
  plan_demand: [],   // generated: { version_id, element_id, ym, kind, days:[31], total_t, spread_t, lines:[{line_id,t}] } — materialised into demand_values ONLY in a Planning scenario
  plan_imports: [],  // Execution side: { id, planning_scenario_id, version_id, element_ids, from, to, replaced:[…], at, undone_at }

  // Production schedule
  production_schedule: [], // { id, element_id, product_id, date_from, date_to }

  // Manager production campaigns — locked, simulation cannot override
  production_campaigns: [], // { id, element_id, product_id, start_date, end_date, rate_tpd, notes }

  // Manager DEMAND SWAPS (substitution) — a portion of a DEMAND POINT's demand
  // (which carries its own material) is covered by another material. Keyed by
  // demand point, so two demand points of the same material can differ.
  demand_substitutions: [], // { id, from_element_id (demand point), to_product_id, mode:'percent'|'tonnage', amount, start_date, end_date, notes }

  // Simulation rules — natural language rules interpreted by Claude, stored as structured constraints
  simulation_rules: [], // { id, name, facility_ids[], element_ids[], natural_text, structured:{type,params}, date_from, date_to, status:'active'|'disabled'|'conflicted', conflict_ids:[], created_at }

  // Mill policy overrides — per (finish-mill + PRODUCT), date-bounded tweaks to the
  // urgency rule for that product's silo. A multi-product mill gets one row per product
  // it makes (e.g. MIAFM03 → an IL(11) row and an SPC row, each independent).
  // { id, element_id (mill), product_id, date_from, date_to,
  //   params:{ target_pct?, critical_floor_pct?, stop_pct?, restart_cover_days?, lookahead_days?, min_run_days? }, created_at }
  mill_policies: [],
  // Products considered (separate from tuning) — per finish-mill, date-bounded allow-list
  // limiting which products the mill chases in the window. { id, element_id, date_from, date_to, products:[] }
  mill_product_focus: [],

  // Simulation
  simulation_runs:      [], // { id, facility_id, start_date, horizon, mode, conflict_resolution, run_at }
  simulation_day_states:[], // { run_id, element_id, day, state }
  simulation_inventory: [], // { run_id, element_id, day, inventory }
  simulation_stop_events:[], // { run_id, element_id, day, type, cause }

  // Actuals (future)
  actual_production: [],
  actual_inventory:  [],
  actual_dispatch:   [],
  actual_vessel_calls:[],
  actual_rail_movements:[],

  // Sales Actuals — aggregated from RealShipments upload
  // { date:'YYYY-MM-DD', origin:'BRS', product:'BRS / BRS IL(12) / BULK / EXT',
  //   customer_type:'EXT'|'INT', ship_to:50000142, ship_to_name:'...', sales_manager:'...',
  //   volume:108 }
  real_shipments_daily: [],  // aggregated: one row per date+origin+product+customer_type+ship_to
  real_shipments_meta:  {},  // { loaded_at, row_count, date_min, date_max, origins:[], products:[] }

  // Forecast Commitments — sales rep entries flowing to demand points
  // { id, created_at, rep_name, origin, customer_type, product_key,
  //   horizon:'short'|'mid'|'annual', status:'draft'|'pending_approval'|'approved'|'rejected',
  //   entries:[{date:'YYYY-MM-DD', volume_t:N, is_override:bool}],
  //   base_avg_t:N, notes:'' }
  forecast_commitments: [],

  // Real Data Input — user-entered actual values
  real_production_daily: [], // { date:'YYYY-MM-DD', facility_id, element_id, product_id, volume_t, source:'actual', created_at, updated_at }
  real_inventory_daily:  [], // { date:'YYYY-MM-DD', facility_id, silo_id, product_id, eod_volume_t, source:'actual', created_at, updated_at }
  real_transfers_file_daily: [], // { date, origin, origin_facility_id, product_name, product_id, volume_t } — from Avila_Transfers_Summary.xlsx (Data Sources › Real Transfers); read-only history, per origin × product × day
  real_transfers_file_meta: {},  // { loaded_at, file, row_count, agg_count, date_min, date_max, lanes[] }
  real_transfers_daily:  [], // { date:'YYYY-MM-DD', origin_facility_id, dest_facility_id, mode:'rail', product_id, volume_t, created_at, updated_at }
  real_silo_transfers_daily: [], // { date:'YYYY-MM-DD', link_id, from_silo_id, to_silo_id, product_id, volume_t, source:'actual', created_at, updated_at } — tonnes actually moved along a silo link that day (wins over the plan)
  real_rail_daily:       [], // { date:'YYYY-MM-DD', facility_id, product_id, type:'loading'|'delivered', cars:N, source:'actual', created_at, updated_at }
  real_shipping_daily:   [], // { date:'YYYY-MM-DD', facility_id, product_id, volume_t, source:'actual', created_at, updated_at }
  real_unloading_daily:  [], // { date:'YYYY-MM-DD', facility_id, berth_id, product_id, mode:'ship'|'rail'|'truck', value, unit:'t'|'cars', cars?:N (rail: entered car count for display; value stays tonnes for the sim), source:'actual', created_at, updated_at }
  // Access control (see ACCESS CONTROL): people who may sign in to this scenario, and pending requests.
  access_users:          [], // { id:email, email, name, admin, active, perm:{facilityId|'__network':{func:'edit'}}, pw:{salt,iter,hash}, must_change, created_at, created_by, pw_changed_at }
  access_requests:       [], // { id, email, name, note, at, status:'pending'|'declined', handled_by, handled_at }
  change_requests:       []  // { id, area:'topology', by, name, at, status:'pending'|'accepted'|'rejected', items:[{t,k,before,after}] } — see TOPOLOGY SEAL
};

// ═══════════════════════════════════════════════════════
// FAST READ-ONLY LOOKUPS (performance)
// The simulation and the big pages ask the same question thousands of times — "the real
// rows for this element / silo on this date" — and every ask used to read the WHOLE table
// (tens of thousands of rows). While one heavy piece of work runs (a simulation pass, a
// page render) each table is indexed once and every ask becomes a direct lookup.
// Why this can never show stale or wrong numbers:
//  • An index only exists inside _idxRun(...) — one synchronous block (a render, a
//    simulation pass) — and is thrown away the moment the outermost block ends. Edits
//    happen in their own event handlers, so the render/simulation after any edit always
//    starts from a fresh index built from the data exactly as it is then.
//  • Inside a block the index is rebuilt automatically if its table was replaced or rows
//    were added/removed (checked on every lookup). It holds the row objects themselves,
//    so a value edited in place is read as it is now.
//  • Outside a block every helper falls back to the original full-table scan.
//  • Same answers as the scans they replace: rows come back in table order, and the
//    "first" row is the one .find() would have returned. Results are READ-ONLY arrays.
// ═══════════════════════════════════════════════════════
const _IDX={depth:0, maps:new Map()};
const _IDX_NONE=Object.freeze([]);
function _idxRun(fn){
  _IDX.depth++;
  try{ return fn(); }
  finally{ if(--_IDX.depth===0) _IDX.maps.clear(); }
}
// Map(k1 → Map(k2 → rows[])), or Map(k1 → rows[]) without f2, over DB[table] in table order.
function _idxMap(table, f1, f2){
  const arr=DB[table]||_IDX_NONE, id=table+'|'+f1+'|'+(f2||'');
  const ix=_IDX.maps.get(id);
  if(ix&&ix.arr===arr&&ix.len===arr.length) return ix.map;
  const map=new Map();
  for(let i=0;i<arr.length;i++){
    const r=arr[i]; if(r==null) continue;
    const a=r[f1]; if(a!==a) continue;           // NaN never === anything, so never matches
    if(f2){
      const b=r[f2]; if(b!==b) continue;
      let m2=map.get(a); if(!m2){ m2=new Map(); map.set(a,m2); }
      const rows=m2.get(b); if(rows) rows.push(r); else m2.set(b,[r]);
    }else{
      const rows=map.get(a); if(rows) rows.push(r); else map.set(a,[r]);
    }
  }
  _IDX.maps.set(id,{arr,len:arr.length,map});
  return map;
}
// Rows of DB[table] where row[f1]===k1 (and row[f2]===k2 when f2 is given), in table order.
function _idxRows(table, f1, k1, f2, k2){
  if(!_IDX.depth){
    const t=DB[table]||_IDX_NONE;
    return f2?t.filter(r=>r[f1]===k1&&r[f2]===k2):t.filter(r=>r[f1]===k1);
  }
  const m=_idxMap(table,f1,f2).get(k1);
  if(!m) return _IDX_NONE;
  return (f2?m.get(k2):m)||_IDX_NONE;
}
// The first such row (what .find() returns), or undefined.
function _idxFirst(table, f1, k1, f2, k2){
  if(!_IDX.depth){
    const t=DB[table]||_IDX_NONE;
    return f2?t.find(r=>r[f1]===k1&&r[f2]===k2):t.find(r=>r[f1]===k1);
  }
  return _idxRows(table,f1,k1,f2,k2)[0];
}

// Seed catalog data
function seedCatalogs(){
  if(DB.products.length) return;
  // Empty products in MEMORY is not the same as a brand-new user. If any scenario
  // is registered, the real catalog lives in its .json — memory is just empty
  // because localStorage was wiped (3MB guard, cleared site data, new machine).
  // Seeding demo OPC/PPC/SRC here would get merged into the real scenario file as
  // "local additions" on the next write. Only a truly scenario-less install seeds.
  try{
    const scMeta=JSON.parse(localStorage.getItem('avila_scenarios')||'{}');
    if(scMeta.meta && Object.keys(scMeta.meta).length) return;
  }catch(e){}
  DB.products=[
    {id:'opc',name:'OPC',description:'Ordinary Portland Cement',material_code:'OPC-001',category:'cement_bulk'},
    {id:'ppc',name:'PPC',description:'Portland Pozzolana Cement',material_code:'PPC-001',category:'cement_bulk'},
    {id:'src',name:'SRC',description:'Sulphate Resistant Cement',material_code:'SRC-001',category:'cement_bulk'}
  ];
  DB.recipes=[
    {id:'r1',product_id:'opc',material_id:'clinker_std',pct:95},
    {id:'r2',product_id:'opc',material_id:'gypsum',pct:5},
    {id:'r3',product_id:'ppc',material_id:'clinker_std',pct:80},
    {id:'r4',product_id:'ppc',material_id:'flyash',pct:15},
    {id:'r5',product_id:'ppc',material_id:'gypsum',pct:5},
    {id:'r6',product_id:'src',material_id:'clinker_std',pct:97},
    {id:'r7',product_id:'src',material_id:'gypsum',pct:3}
  ];
  DB.raw_materials=[
    {id:'limestone',name:'Limestone',unit:'tonnes',notes:'Primary raw material'},
    {id:'clay',name:'Clay',unit:'tonnes',notes:''},
    {id:'ironore',name:'Iron Ore',unit:'tonnes',notes:'Corrective material'},
    {id:'gypsum',name:'Gypsum',unit:'tonnes',notes:'Setting retarder'},
    {id:'flyash',name:'Fly Ash',unit:'tonnes',notes:'Pozzolanic additive'}
  ];
  DB.fuels=[
    {id:'petcoke',name:'Petroleum Coke',unit:'tonnes',calorific_value:8200,co2_factor:3.4,notes:'Primary kiln fuel'},
    {id:'coal',name:'Coal',unit:'tonnes',calorific_value:6500,co2_factor:2.8,notes:''}
  ];
}

// ═══════════════════════════════════════════════════════
// ELEMENT TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════
const ET = {
  raw_material_storage:{label:'Raw Material Storage',shape:'circle',color:'var(--amber)',cat:'storage',fields:[
    {k:'material_id',l:'Material Type',t:'catalog',cat:'raw_materials'},
    {k:'max_capacity',l:'Max Capacity (t)',t:'number'},
    {k:'min_level',l:'Min Operational Level (t)',t:'number'},
    {k:'critical_min',l:'Critical Min Level (t)',t:'number'},
    {k:'reorder_point',l:'Reorder Point (t)',t:'number'},
    {k:'start_inventory',l:'Starting Inventory (t)',t:'number'},
    {k:'supply_mode',l:'Supply Mode',t:'select',opts:['Ship','Truck','Rail','Conveyor from Quarry']},
    {k:'delivery_qty',l:'Delivery Quantity (t)',t:'number'},
    {k:'lead_time_days',l:'Lead Time (days)',t:'number'},
    {k:'delivery_freq_days',l:'Delivery Frequency (days)',t:'number'}
  ]},
  fuel_storage:{label:'Fuel Storage',shape:'circle',color:'var(--red)',cat:'storage',fields:[
    {k:'fuel_id',l:'Fuel Type',t:'catalog',cat:'fuels'},
    {k:'max_capacity',l:'Max Capacity (t)',t:'number'},
    {k:'min_level',l:'Min Operational Level (t)',t:'number'},
    {k:'critical_min',l:'Critical Min Level (t)',t:'number'},
    {k:'reorder_point',l:'Reorder Point (t)',t:'number'},
    {k:'start_inventory',l:'Starting Inventory (t)',t:'number'},
    {k:'supply_mode',l:'Supply Mode',t:'select',opts:['Ship','Truck','Rail']},
    {k:'delivery_qty',l:'Delivery Quantity (t)',t:'number'},
    {k:'lead_time_days',l:'Lead Time (days)',t:'number'}
  ]},
  // ── BULK SILO: replaces homo_silo, clinker_silo, cement_silo ──
  // Color is assigned dynamically based on first product's category
  bulk_silo:{label:'Bulk Silo',shape:'circle',color:'var(--green)',cat:'storage',fields:[
    {k:'max_capacity',l:'Max Capacity (t)',t:'number'},
    {k:'start_inventory',l:'Starting Inventory (t)',t:'number'},
    {k:'inventory_objective',l:'Inventory Objective',t:'select',
     opts:['maximize','meet_demand','minimize']},
    {k:'target_pct',l:'Target Level (% of max) — overrides objective default',t:'number'},
    {k:'critical_floor_pct',l:'Critical Floor (% of max) — mill always fills below this',t:'number'},
    {k:'max_concurrent_sources',l:'Max Concurrent Sources (0 = unlimited)',t:'number'}
  ]},
  // ── PACKED SILO: unit is pallets ──
  packed_silo:{label:'Packed Silo',shape:'circle',color:'var(--blue)',cat:'storage',fields:[
    {k:'product_id',l:'Product',t:'catalog',cat:'products'},
    {k:'max_capacity',l:'Max Capacity (pallets)',t:'number'},
    {k:'min_level',l:'Min Operational Level (pallets)',t:'number'},
    {k:'start_inventory',l:'Starting Inventory (pallets)',t:'number'},
    {k:'tonnes_per_pallet',l:'Tonnes per Pallet',t:'number'}
  ]},
  raw_meal_mill:{label:'Raw Meal Mill',shape:'diamond',color:'var(--amber)',cat:'transform',fields:[
    {k:'rated_capacity_tpd',l:'Rated Capacity (t/day)',t:'number'},
    {k:'power_kwh_t',l:'Power Consumption (kWh/t)',t:'number'},
    {k:'start_state',l:'Starting State',t:'select',opts:['Running','Stopped','Maintenance']}
  ]},
  kiln:{label:'Kiln',shape:'diamond',color:'var(--red)',cat:'transform',fields:[
    {k:'min_stable_rate_pct',l:'Min Stable Rate (% of rated)',t:'number'},
    {k:'warm_cold_hrs',l:'Warm → Cold Threshold (hours)',t:'number'},
    {k:'start_state',l:'Starting Thermal State',t:'select',opts:['Running','Stopped-Hot','Stopped-Warm','Stopped-Cold']},
    {k:'start_rate_pct',l:'Starting Rate (% of rated)',t:'number'},
    {k:'fuel_id',l:'Primary Fuel',t:'catalog',cat:'fuels'},
    {k:'restart_floor_pct',l:'Restart Floor % (kiln holds until clinker silo drops below this)',t:'number'}
  ]},
  finish_mill:{label:'Finish Mill',shape:'diamond',color:'var(--green)',cat:'transform',fields:[
    {k:'start_state',l:'Starting State',t:'select',opts:['Running','Stopped','Maintenance']},
    {k:'start_product_id',l:'Starting Product',t:'catalog',cat:'products'}
  ]},
  packing_plant:{label:'Packing Plant',shape:'diamond',color:'var(--blue)',cat:'transform',fields:[
    {k:'changeover_hrs',l:'Changeover Time (hours)',t:'number'},
    {k:'start_state',l:'Starting State',t:'select',opts:['Running','Stopped','Maintenance']}
    // Product lines (input bulk → output packed, pallets/day, tonnes/pallet, recipe) are
    // configured per-product in the "Packing Lines" panel below, like a Finish Mill.
  ]},
  berth:{label:'Berth / Unloading Point',shape:'rect',color:'var(--blue)',cat:'movement',fields:[
    {k:'berth_type',l:'Type',t:'select',opts:['Ship Berth','Truck Receiving','Rail Receiving']},
    {k:'max_unload_rate_tph',l:'Ship: Max Unloading Rate (t/h)',t:'number',show_if:{k:'berth_type',v:'Ship Berth'}},
    // NOTE: "Max Cars Unloaded / Shift" and "Shifts per Day" used to live here. Rail
    // unloading is no longer rate-limited — what a terminal receives is inventory the next
    // morning — so they constrained nothing and only misled. Switch days (below, on the
    // berth) and the downstream silo's capacity are the real limits. Stored values are
    // left alone in case the throttle is ever reinstated.
    {k:'car_capacity_t',l:'Rail: Car Capacity (t/car)',t:'number',show_if:{k:'berth_type',v:'Rail Receiving'}},
    {k:'max_trucks_day',l:'Truck: Max Trucks Received / Day',t:'number',show_if:{k:'berth_type',v:'Truck Receiving'}},
    {k:'truck_capacity_t',l:'Truck: Capacity per Truck (t)',t:'number',show_if:{k:'berth_type',v:'Truck Receiving'}},
    {k:'simultaneous_points',l:'Simultaneous Unload Points',t:'number'}
  ]},
  dispatch_point:{label:'Dispatch Point',shape:'rect',color:'var(--green)',cat:'movement',fields:[
    {k:'dispatch_type',l:'Type',t:'select',opts:['Truck','Rail']},
    {k:'truck_destination',l:'Truck Destination',t:'truck_dest'}, // special: Local or facility
    {k:'destination_facility_id',l:'Rail Destination Facility',t:'facility_select'}
  ]},
  demand_point:{label:'Demand Point',shape:'triangle',color:'var(--green)',cat:'source',fields:[
    {k:'demand_mode',l:'Demand Mode',t:'select',opts:['Monthly Volume','Fixed Daily']},
    {k:'dispatch_schedule',l:'Dispatch Schedule',t:'select',opts:['weekdays','mon_sat','7_days']},
    {k:'daily_tonnage',l:'Fixed Daily Fallback (t/day) — used when Monthly Volume mode has no data',t:'number'}
  ]},
  supply_source:{label:'External Supply Source',shape:'triangle-inv',color:'var(--amber)',cat:'source',fields:[
    {k:'product_id',l:'Product',t:'catalog',cat:'products'},
    {k:'supply_mode',l:'Supply Mode',t:'select',opts:['Ship','Truck','Rail']},
    {k:'typical_volume_t',l:'Typical Vessel Volume — Total Cargo (t)',t:'number'},
    {k:'lead_time_days',l:'Lead Time (days order → first arrival)',t:'number'},
    {k:'min_cover_days',l:'Vessel trigger — days of cover (propose a vessel to arrive when projected silo stock falls to this many days of average demand)',t:'number'}
  ]}
};

// ═══════════════════════════════════════════════════════
// APP STATE
// ═══════════════════════════════════════════════════════
const S = {
  level:'plant', view:'topology', topSection:'production', facility_id:null,
  tool:'select', selectedEl:null, connectFrom:null,
  dragging:null, dragOff:{x:0,y:0},
  selectedLabel:null, tlDrag:null, // canvas labels (TOPOLOGY LABELS)
  selectedEls:new Set(), marquee:null, groupDrag:null, _suppressNextClick:false,
  topoView:{x:0,y:0,k:1}, topoFacFilter:null, _space:false, panning:null, // topology pan/zoom + facility filter
  elCounter:0,
  simCfg:{start_date:new Date()._ymd(), horizon:90, mode:'planning', conflict_resolution:'rolling_avg', autoPropose:true},
  simResults:null, chatCollapsed:true, realDataCollapsed:true,
  realDataSelectedDate:new Date()._ymd(),
  realDataFacilityId:null,
  activeCatalog:'products', activeSchedTab:'vessels',
  logiHideMonths:false,  // collapse monthly-summary columns in logistics planners
  selectedLocNode:null,  // { type, id } for location tree selection
  facFilter:null  // facility id to filter results, null = show all
};

