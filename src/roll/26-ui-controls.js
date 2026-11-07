// ═══════════════════════════════════════════════════════
// UI CONTROLS
// ═══════════════════════════════════════════════════════


function switchTopSection(section){
  S.topSection=section;
  document.querySelectorAll('.top-sec-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.section===section);
  });
  const row=document.getElementById('second-row'); if(!row) return;
  const tabs={
    production:[
      {label:'Production',view:'supply'},
      {label:'Products',view:'catalog'},
      {label:'Elements',view:'elements'},
      {label:'Maintenance Calendar',view:'maintenance'},
      {label:'Mill Balance',view:'millbal',link:'AVILA_Mills.html',win:'avila_mills'}
    ],
    logistics:[
      {label:'Vessel Schedule',view:'schedules',tab:'vessels'},
      {label:'Rail Schedule',view:'schedules',tab:'rail'},
      {label:'Silo Transfers',view:'schedules',tab:'silo'}
    ],
    demand:[
      {label:'Demand',view:'demand'},
      {label:'Sales Detail',view:'salesperf',link:'AVILA_Sales.html'}
    ],
    results:[
      {label:'Dashboard',view:'dashboard'},
      {label:'Data Table',view:'datatable'},
      {label:'📤 Push to BI',view:'pushbi'}
    ],
    configuration:[
      {label:'Organization',view:'location'},
      {label:'Settings',view:'cfgpanel',tab:'settings'},
      {label:'Simulation Rules',view:'cfgpanel',tab:'rules'},
      {label:'Data Sources',view:'cfgpanel',tab:'datasources'},
      {label:'Demand Mapping',view:'cfgpanel',tab:'demandmap'},
      {label:'Budget Planning',view:'cfgpanel',tab:'plan'}
    ]
  };
  const items=tabs[section]||[];
  row.innerHTML=items.map(t=>
    t.link
    ? `<button class="sec-tab" onclick="_openPageTab('${t.link}','${t.win||'avila_sales'}','${t.label}')" title="Opens in its own browser tab">${t.label} ↗</button>`
    : `<button class="sec-tab" data-view="${t.view}" ${t.tab?`data-tab="${t.tab}"`:''}
      onclick="_secTabClick(this,'${t.view}'${t.tab?`,'${t.tab}'`:''})">${t.label}</button>`
  ).join('')
  // Rules of the game for the page you are on (Configuration has its own Simulation Rules tab).
    +(section!=='configuration'&&items.length?`<button class="sec-tab rules-link" onclick="openRulesPage(_rulesAreaForView())" title="The rules the simulator follows for this page — and your own rules">📘 Rules</button>`:'');
  if(items.length){
    const first=items[0];
    if(first.tab){
      setSchedTab(first.tab);
      switchView('schedules');
    } else {
      switchView(first.view);
    }
    row.querySelector('.sec-tab')?.classList.add('active');
  }
}

function _secTabClick(el,view,tab){
  // Mill Policies is a modal action, not a view — open it and leave the tab state as-is.
  if(view==='millpolicy'){ openMillPolicyManager(); return; }
  // Push to BI is a one-click export, not a page.
  if(view==='pushbi'){ pushToBI(); return; }
  document.querySelectorAll('#second-row .sec-tab').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  if(view==='cfgpanel'){
    switchView('cfgpanel');
    renderCfgPanel(tab||'settings');
  } else {
    if(tab) setSchedTab(tab);
    switchView(tab?'schedules':view);
  }
}

function _syncSecTab(view){
  // cfgpanel tabs are managed directly by _secTabClick — skip sync to avoid marking all three active
  if(view==='cfgpanel') return;
  document.querySelectorAll('#second-row .sec-tab').forEach(b=>{
    // Vessel / Rail / Truck all open view 'schedules' and differ only by data-tab, so matching the
    // view alone lit all three together — light only the one whose sub-tab is showing.
    const tabOk=!b.dataset.tab||b.dataset.tab===S.activeSchedTab;
    b.classList.toggle('active', b.dataset.view===view&&tabOk);
  });
}

function switchView(view){
  if(!_IDX.depth) return _idxRun(()=>switchView.apply(this,arguments)); // fast lookups for this whole block
  if(S.slPick&&view!=='topology') slCancelPick();
  S.view=view;
  document.querySelectorAll('.view-panel').forEach(p=>p.classList.remove('active'));
  // maintenance is a schedules sub-tab; cfgpanel maps to cfgpanel-view
  const panelView=view==='maintenance'?'schedules':view;
  document.getElementById(`${panelView}-view`)?.classList.add('active');
  if(view==='maintenance') setSchedTab('maintenance');
  _syncSecTab(view);
  // Topology is reached via its main-menu icon (not a section). Highlight the icon
  // and clear the section buttons when it's showing; clear the icon otherwise.
  const _topoBtn=document.getElementById('topo-nav-btn');
  if(_topoBtn){
    if(view==='topology'){
      document.querySelectorAll('.top-sec-btn[data-section]').forEach(b=>b.classList.remove('active'));
      _topoBtn.classList.add('active');
      const _row=document.getElementById('second-row'); if(_row) _row.innerHTML=''; // topology has its own toolbar; no section sub-nav
    } else _topoBtn.classList.remove('active');
  }
  if(view==='topology'){ renderTopoFacFilter(); renderTopoCanvas(); }
  if(view==='location') renderLocationTree();
  if(view==='catalog') renderCatalogView();
  if(view==='elements') renderElementsView();
  if(view==='demand') renderDemandView();
  if(view==='salesperf') renderSalesPerfView();
  if(view==='supply') renderSupplyView();
  if(view==='schedules'){_logiFilterBarSync();renderVesselTable();renderRailTable();renderSiloXferRegister();renderMaintenanceCalendar();}
  // Show view window bar on result views
  const vwViews=['dashboard','datatable','analysis'];
  const vwBar=document.getElementById('view-window-bar');
  const vwTok=document.getElementById('flt-res-toks');
  const onResults=vwViews.includes(view);
  if(vwBar) vwBar.style.display=onResults?'flex':'none';
  if(vwTok) vwTok.style.display=onResults?'flex':'none';
  if(onResults) updateFacFilterBar();
  if(view==='dashboard') renderDashboard();
  if(view==='datatable'&&S.simResults){ renderDtree(S.simResults); renderDashCharts(S.simResults); renderResultsTable(); }

  if(view==='results'){
    const af=document.getElementById('bi-active-fac');
    if(af) af.textContent=getFacility()?.name||'no sim run yet';
    _biRenderDest();
  }
}

function setTool(tool){
  if(S.slPick) slCancelPick();
  S.tool=tool;
  document.querySelectorAll('.cv-tool').forEach(t=>t.classList.remove('active'));
  document.getElementById(`tool-${tool}`)?.classList.add('active');
  if(tool!=='connect') cancelConn();
  document.getElementById('topo-canvas-wrap').style.cursor=tool==='pan'?'grab':tool==='delete'?'crosshair':tool==='connect'?'cell':'default';
}

// ═══════════════════════════════════════════════════════
// APP ZOOM HINT — a page cannot trigger the browser's own native zoom
// (Ctrl+/Ctrl-/Ctrl+scroll) programmatically; that's a browser-chrome-level
// feature, off-limits to page JS. An earlier version tried to approximate it
// with CSS `zoom` on <body>, but that has real gaps versus native zoom (no
// proper scroll/reflow of overflowing content) and could strand the reset
// control itself off-screen at high zoom. Native zoom is safer — it can never
// lock you out (Ctrl+0 always works) — so this just surfaces the shortcut
// from inside the app instead of reimplementing it.
function _buildUiZoomHint(){
  if(document.getElementById('ui-zoom-hint')) return;
  const w=document.createElement('div');
  w.id='ui-zoom-hint';
  w.style.cssText='position:fixed;left:8px;bottom:8px;z-index:99999;font-family:var(--mono,monospace)';
  w.innerHTML=`
    <span id="ui-zoom-hint-btn" onclick="_toggleUiZoomHintPopover()" title="How to zoom" style="cursor:pointer;display:flex;align-items:center;gap:4px;padding:4px 8px;background:var(--surface2,#12161f);border:1px solid var(--border2,#2a3550);border-radius:3px;color:var(--text-dim,#8b93a7);font-size:10px;box-shadow:0 2px 10px rgba(0,0,0,.4)">🔍 Zoom</span>
    <div id="ui-zoom-hint-pop" style="display:none;position:absolute;left:0;bottom:32px;width:230px;padding:10px 12px;background:var(--surface,#0d1117);border:1px solid var(--border2,#2a3550);border-radius:4px;font-size:9px;line-height:1.7;color:var(--text,#dfe6f3);box-shadow:0 4px 20px rgba(0,0,0,.5)">
      Use your browser's own zoom — it handles scrolling and layout properly, and can't get you stuck:<br>
      <b>Zoom in/out:</b> Ctrl + Scroll, or Ctrl + Plus/Minus<br>
      <b>Reset to 100%:</b> Ctrl + 0
    </div>`;
  document.body.appendChild(w);
}
function _toggleUiZoomHintPopover(){
  const p=document.getElementById('ui-zoom-hint-pop'); if(!p) return;
  p.style.display=p.style.display==='none'?'block':'none';
}
function initUiZoom(){
  _buildUiZoomHint();
  // One-time cleanup of the old approach's leftovers, if a returning user has them.
  try{ localStorage.removeItem('avila_ui_zoom'); }catch(e){}
  if(document.body.style.zoom) document.body.style.zoom='';
}

function toggleChat(){
  S.chatCollapsed=!S.chatCollapsed;
  document.getElementById('chat-panel').classList.toggle('open',!S.chatCollapsed);
  document.getElementById('ai-fab')?.classList.toggle('active',!S.chatCollapsed);
  if(!S.chatCollapsed) updateKeyUI();
}

// ── REAL DATA INPUT PANEL ──────────────────────────────

// ── REAL DATA PANEL ────────────────────────────────

function toggleRealDataPanel(){
  S.realDataCollapsed=!S.realDataCollapsed;
  document.getElementById('real-data-panel').classList.toggle('open',!S.realDataCollapsed);
  document.getElementById('daily-data-btn')?.classList.toggle('active',!S.realDataCollapsed);
}

function initRealDataFacilitySelector(){
  const select=document.getElementById('rd-facility');
  if(!select) return;

  select.innerHTML='<option value="">-- Select Facility --</option>';
  DB.facilities.forEach(fac=>{
    const opt=document.createElement('option');
    opt.value=fac.id;
    opt.textContent=fac.name;
    select.appendChild(opt);
  });

  if(S.realDataFacilityId){
    select.value=S.realDataFacilityId;
  }
}

function onRealDataFacilityChange(facId){
  S.realDataFacilityId=facId;
  renderRealDataSections();
}

function onRealDataDateChange(dateStr){
  S.realDataSelectedDate=dateStr;
  renderRealDataSections();
}

// ── Daily Data form UI (rebuilt 9/21) ─────────────────────────────────────────────────────
// Every section is ONE CSS grid, so a column header and the fields under it share the same
// grid column — alignment can't drift. Production = matrix (equipment × product, a field
// only where the equipment makes that product); inventory / shipping / receiving = lists.
// Units live in the header, never on each row. Fields are plain text (no spinner, no wheel
// nudging), accept "1,500", and are checked as you type (_rdOnInput): non-numbers and
// negatives block the save, values above rated output / silo size only warn.

// Tonnes per pallet for a packed product at a facility: the packing line that makes it
// (element_product_capacities.tonnes_per_pallet), else a packed silo holding it
// (props.tonnes_per_pallet). 0 = not set anywhere — the form says so on that row.
function _rdTppFor(pid, facId){
  const facEl=id=>{ const e=getEl(id); return e&&(e.assigned_facility_id||e.facility_id)===facId; };
  const line=DB.element_product_capacities.find(c=>c.product_id===pid&&c.packing_input_id&&parseFloat(c.tonnes_per_pallet)>0&&facEl(c.element_id));
  if(line) return parseFloat(line.tonnes_per_pallet);
  const silo=DB.elements.find(e=>e.type==='packed_silo'&&(e.assigned_facility_id||e.facility_id)===facId&&getSiloProducts(e).includes(pid)&&parseFloat(e.props?.tonnes_per_pallet)>0);
  return silo?parseFloat(silo.props.tonnes_per_pallet):0;
}
// Stored tonnes → the pallets shown in a pallets field (records keep `pallets` when saved here).
function _rdPalletsOf(rec, tonnesKey, tpp){
  if(!rec) return '';
  if(rec.pallets!=null) return rec.pallets;
  const t=rec[tonnesKey]; if(t==null||t==='') return '';
  return tpp>0?Math.round(t/tpp*100)/100:t;
}
const _rdShort=name=>String(name||'').replace(/^[A-Z0-9]{2,5}_(?=.)/,'');   // "MIA_IL(11)/BLK" → "IL(11)/BLK"
const _rdFmt=n=>Math.round(n).toLocaleString();

function _rdSecHeader(title, n, k){
  return `<div class="rd-section-header collapsed" onclick="toggleRdSection(this)">
    <span class="rd-st">${title}</span>
    <span class="rd-cnt${k?' has':''}" data-n="${n}">${k} of ${n} entered</span>
    <span class="rd-arrow" aria-hidden="true">»</span></div>`;
}
function _rdCount(rows){ let n=0,k=0; rows.forEach(r=>(r.cells||[r.cell]).forEach(c=>{ if(c&&!c.blank){ n++; if(c.value!==''&&c.value!=null) k++; } })); return {n,k}; }

// One numeric field. cell: {type, elemId, prodId, subtype?, unit?, dest?, tpp?, value, max?, maxWhat?, lbl}
function rdCellInput(cell){
  const a=(k,v)=>v!=null&&v!==''?` data-${k}="${esc(String(v))}"`:'';
  const raw=(cell.value!==''&&cell.value!=null)?cell.value:'';
  const v=raw!==''&&isFinite(Number(raw))?Number(raw).toLocaleString('en-US',{maximumFractionDigits:2}):raw; // "12,500" (parsed back by _rdNum)
  return `<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" class="rd-product-input rd-in${v!==''?' filled':''}"`
    +` data-type="${cell.type}" data-elem="${cell.elemId}" data-prod="${cell.prodId}"`
    +a('subtype',cell.subtype)+a('unit',cell.unit)+a('dest',cell.dest)+a('tpp',cell.tpp)+a('max',cell.max)+a('maxwhat',cell.maxWhat)+a('lbl',cell.lbl)
    +` value="${esc(String(v))}">`;
}

// Matrix section. cols: [{id,name}], rows: [{label, cells:[cell|{blank:true}]}], unit: header unit.
function rdSectionTable(title, subtitle, cols, rows, unit, note){
  const {n,k}=_rdCount(rows);
  const g=`grid-template-columns:var(--rd-lbl-w) repeat(${cols.length},minmax(64px,1fr))`;
  let h=_rdSecHeader(title,n,k)+`<div class="rd-section-content collapsed">`;
  if(subtitle) h+=`<div class="rd-section-subtitle">${subtitle}</div>`;
  if(note) h+=`<div class="rd-note">${note}</div>`;
  h+=`<div class="rd-grid-wrap"><div class="rd-grid" style="${g}">`;
  h+=`<div class="rd-ch rd-ch-unit">${unit||''}</div>`+cols.map(c=>`<div class="rd-ch rd-num" title="${esc(c.name)}">${esc(_rdShort(c.name))}</div>`).join('');
  rows.forEach(r=>{
    h+=`<div class="rd-lbl" title="${esc(r.label)}">${esc(r.label)}</div>`;
    r.cells.forEach(c=>{ h+=c.blank?`<div class="rd-blank" title="not made by this equipment">·</div>`:rdCellInput(c); });
  });
  return h+`</div></div><div class="rd-hints"></div></div>`;
}

// List section. colLabels: descriptive columns; rows: [{labels:[...], cell}]; unit: header of the value column.
function rdListSection(title, subtitle, colLabels, rows, unit, note){
  const {n,k}=_rdCount(rows);
  const g=`grid-template-columns:${colLabels.map((_,i)=>i===0&&colLabels.length>1?'minmax(0,1.15fr)':'minmax(0,1fr)').join(' ')} var(--rd-val-w)`;
  let h=_rdSecHeader(title,n,k)+`<div class="rd-section-content collapsed">`;
  if(subtitle) h+=`<div class="rd-section-subtitle">${subtitle}</div>`;
  if(note) h+=`<div class="rd-note">${note}</div>`;
  h+=`<div class="rd-grid" style="${g}">`;
  h+=colLabels.map(c=>`<div class="rd-ch">${c}</div>`).join('')+`<div class="rd-ch rd-num">${unit||''}</div>`;
  let prev=null;
  rows.forEach(r=>{
    r.labels.forEach((lb,i)=>{
      // Repeat-suppression: a silo/berth name shown once for consecutive rows.
      const same=i===0&&colLabels.length>1&&lb===prev;
      h+=`<div class="${i===0&&colLabels.length>1?'rd-lbl':'rd-lbl2'}" title="${esc(lb)}">${same?'':esc(lb)}</div>`;
    });
    prev=r.labels[0];
    h+=rdCellInput(r.cell);
  });
  return h+`</div><div class="rd-hints"></div></div>`;
}

// Live check of one field + section counter + footer total.
function _rdValidate(inp){
  const raw=inp.value.replace(/,/g,'').trim();
  const num=Number(raw), max=parseFloat(inp.dataset.max)||0;
  let bad='', warn='';
  if(raw!==''){
    if(!isFinite(num)) bad='not a number';
    else if(num<0) bad="can't be negative";
    else if(max>0&&num>max) warn=`above ${inp.dataset.maxwhat||'the limit'} ${_rdFmt(max)}`;
  }
  inp.classList.toggle('filled',raw!==''&&!bad);
  inp.classList.toggle('bad',!!bad);
  inp.classList.toggle('warn',!bad&&!!warn);
  inp.title=bad||warn||'';
  return {bad,warn};
}
function _rdRefreshSection(sec){
  if(!sec) return;
  const ins=[...sec.querySelectorAll('.rd-in')];
  const hdr=sec.previousElementSibling, cnt=hdr&&hdr.querySelector('.rd-cnt');
  const k=ins.filter(i=>i.value.trim()!=='').length;
  if(cnt){ cnt.textContent=`${k} of ${cnt.dataset.n} entered`; cnt.classList.toggle('has',k>0);
    cnt.classList.toggle('err',ins.some(i=>i.classList.contains('bad'))); }
  const hints=sec.querySelector('.rd-hints');
  if(hints) hints.innerHTML=ins.map(i=>{ const {bad,warn}=_rdValidate(i); const m=bad||warn; if(!m) return '';
    return `<div class="${bad?'rd-hint-bad':'rd-hint-warn'}">${esc(i.dataset.lbl||'')} — ${m}</div>`; }).join('');
}
function _rdRefreshFooter(){
  const ins=[...document.querySelectorAll('#rd-sections-container .rd-in')];
  const k=ins.filter(i=>i.value.trim()!=='').length, nb=ins.filter(i=>i.classList.contains('bad')).length;
  const el=document.getElementById('rd-foot-info');
  if(el) el.innerHTML=nb?`<span style="color:var(--red)">${nb} field${nb===1?'':'s'} to fix</span>`:`${k} field${k===1?'':'s'} entered`;
}
function _rdOnInput(e){
  const i=e.target; if(!i.classList||!i.classList.contains('rd-in')) return;
  _rdValidate(i); _rdRefreshSection(i.closest('.rd-section-content')); _rdRefreshFooter();
}
// Enter moves to the next field (Excel-like); Shift+Enter to the previous one.
function _rdOnKey(e){
  if(e.key!=='Enter'||!e.target.classList.contains('rd-in')) return;
  e.preventDefault();
  const all=[...document.querySelectorAll('#rd-sections-container .rd-in')].filter(x=>x.offsetParent);
  const j=all.indexOf(e.target)+(e.shiftKey?-1:1);
  if(all[j]){ all[j].focus(); all[j].select(); }
}

// ── Daily Data form: what a facility's form offers, derived ONLY from its topology ─────────
// Shared by renderRealDataSections and the form audit. Rules, for any facility present or future:
//  • An element's products = its capacity rows (any category — white/slag are 'additive').
//    With no capacity rows yet, the products held by the silos it FEEDS — never "every
//    product of the category" (that fallback offered BRS_IL/PAK at PEV).
//  • Inventory = every (silo, product) pair the facility's silos hold, read through
//    getSiloProducts (so a silo configured with a single product_id, or legacy
//    "id=category" entries, is included). Clinker / bulk / packed are split by silo type.
//  • Rail loading = products of the silos feeding the rail dispatch point(s).
//  • Shipping = every non-clinker product the facility stores or makes.
//  • Receiving = per berth, products of the silos that berth feeds.
function _rdFacilityModel(facId){
  const facEls=DB.elements.filter(e=>(e.assigned_facility_id||e.facility_id)===facId);
  const P=id=>DB.products.find(x=>x.id===id)||null;
  const isClk=pid=>P(pid)?.category==='clinker';
  const isSilo=e=>e&&(e.type==='bulk_silo'||e.type==='packed_silo');
  const downSilos=el=>DB.connections.filter(c=>c.from_element_id===el.id).map(c=>getEl(c.to_element_id)).filter(isSilo);
  const upSilos=el=>DB.connections.filter(c=>c.to_element_id===el.id).map(c=>getEl(c.from_element_id)).filter(isSilo);
  const uniq=ids=>{ const seen=new Set(), out=[]; ids.forEach(id=>{ const p=P(id); if(p&&!seen.has(p.id)){ seen.add(p.id); out.push(p); } }); return out; };
  const siloProds=s=>uniq(getSiloProducts(s));
  const capIds=el=>DB.element_product_capacities.filter(c=>c.element_id===el.id).map(c=>c.product_id).filter(P);
  const elProdIds=el=>{ const c=capIds(el); return new Set(c.length?c:downSilos(el).flatMap(getSiloProducts).filter(P)); };
  const colProds=els=>uniq(els.flatMap(el=>[...elProdIds(el)]));
  const kilns=facEls.filter(e=>e.type==='kiln');
  const finishMills=facEls.filter(e=>e.type==='finish_mill');
  const packingPlants=facEls.filter(e=>e.type==='packing_plant');
  const bulkSilos=facEls.filter(e=>e.type==='bulk_silo');
  const packedSilos=facEls.filter(e=>e.type==='packed_silo');
  const railDps=facEls.filter(e=>e.type==='dispatch_point'&&e.props?.dispatch_type==='Rail');
  let railProds=[];
  if(railDps.length){
    railProds=uniq(railDps.flatMap(dp=>upSilos(dp).flatMap(getSiloProducts))).filter(p=>!isClk(p.id));
    if(!railProds.length) railProds=uniq(bulkSilos.flatMap(getSiloProducts)).filter(p=>!isClk(p.id));
  }
  const shipProds=uniq([...bulkSilos,...packedSilos].flatMap(getSiloProducts)
    .concat(finishMills.flatMap(el=>[...elProdIds(el)]), packingPlants.flatMap(el=>[...elProdIds(el)]))).filter(p=>!isClk(p.id));
  const berths=facEls.filter(e=>e.type==='berth').map(b=>{
    const type=b.props?.berth_type||'Ship Berth';
    const mode=type==='Rail Receiving'?'rail':(type==='Truck Receiving'?'truck':'ship');
    // A berth not wired to any silo gets NO fields: the simulation can't unload through it,
    // and offering every product of the facility is exactly the "unrelated fields" problem.
    const prods=uniq(downSilos(b).flatMap(getSiloProducts));
    return {berth:b, type, mode, prods, unwired:!prods.length};
  });
  const noCaps=[...kilns,...finishMills,...packingPlants].filter(el=>!capIds(el).length);
  // Purchased facilities hold no inventory (see facility.type 'purchased') — no inventory fields.
  const purchased=(DB.facilities.find(x=>x.id===facId)||{}).type==='purchased';
  return {facEls, purchased, P, isClk, kilns, finishMills, packingPlants, bulkSilos, packedSilos, railDps, railProds,
    shipProds, berths, siloProds, elProdIds, colProds, noCaps};
}

function renderRealDataSections(){
  const facId=S.realDataFacilityId||S.facility_id;
  const container=document.getElementById('rd-sections-container');
  if(!facId){
    container.innerHTML='<div class="rd-data-empty">Select a facility to view daily data</div>';
    return;
  }
  const dateStr=S.realDataSelectedDate||'';
  const m=_rdFacilityModel(facId);
  const {kilns, finishMills, packingPlants, bulkSilos, packedSilos, P, isClk}=m;
  const nextDate=dateStr?_addDays(dateStr,1):'';
  const dow=ds=>ds?new Date(ds+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'}):'';
  const dLbl=ds=>ds?`${dow(ds)} ${ds.slice(5,7)}/${ds.slice(8,10)}`:'';
  const dowEl=document.getElementById('rd-date-dow'); if(dowEl) dowEl.textContent=dateStr?new Date(dateStr+'T12:00:00').toLocaleDateString('en-US',{weekday:'long'}):'';
  const isPacked=pid=>P(pid)?.category==='cement_packed'||packedSilos.some(s=>getSiloProducts(s).includes(pid))||packingPlants.some(pk=>m.elProdIds(pk).has(pid));
  const capOf=(el,pid)=>DB.element_product_capacities.find(c=>c.element_id===el.id&&c.product_id===pid);
  const noTpp=new Set();
  const tppOf=pid=>{ const t=_rdTppFor(pid,facId); if(!(t>0)) noTpp.add(pid); return t; };
  const tppNote=pids=>{ const miss=pids.filter(p=>noTpp.has(p)); return miss.length
    ?`⚠ Tonnes per pallet not set for ${miss.map(p=>esc(P(p)?.name||p)).join(', ')} — pallets are saved as entered and read as tonnes until it's set on the packing line (Topology).`:''; };

  // Production matrix. pallets=true → packing: values in pallets, limit = line pallets/day.
  const prodSection=(title,elements,unit,pallets)=>{
    if(!elements.length) return '';
    const cols=m.colProds(elements);
    if(!cols.length) return '';
    const rows=elements.map(el=>{
      const mine=m.elProdIds(el);
      return {label:el.name,cells:cols.map(p=>{
        if(!mine.has(p.id)) return {blank:true};
        const rec=(DB.real_production_daily||[]).find(r=>r.date===dateStr&&r.element_id===el.id&&r.product_id===p.id);
        const c=capOf(el,p.id), tpp=pallets?tppOf(p.id):0;
        const max=pallets?(parseFloat(c?.pallets_per_day)||0):(parseFloat(c?.capacity_tpd)||0);
        return {elemId:el.id,prodId:p.id,type:'production',unit:pallets?'pallets':'',tpp:pallets?tpp:'',
          value:pallets?_rdPalletsOf(rec,'volume_t',tpp):(rec?.volume_t??''),
          max, maxWhat:pallets?'rated pallets/day':'rated output', lbl:`${el.name} · ${p.name}`};
      })};
    });
    return rdSectionTable(title,null,cols,rows,unit,pallets?tppNote(cols.map(c=>c.id)):'');
  };
  // Inventory list. pallets=true → packed silos: values in pallets, limit = silo capacity (pallets).
  const invSection=(title,siloSet,keep,pallets)=>{
    const rows=[];
    siloSet.forEach(s=>m.siloProds(s).filter(p=>keep(p.id)).forEach(p=>{
      const rec=(DB.real_inventory_daily||[]).find(r=>r.date===dateStr&&r.silo_id===s.id&&r.product_id===p.id);
      const tpp=pallets?tppOf(p.id):0;
      rows.push({labels:[s.name,p.name],cell:{elemId:s.id,prodId:p.id,type:'inventory',unit:pallets?'pallets':'',tpp:pallets?tpp:'',
        value:pallets?_rdPalletsOf(rec,'eod_volume_t',tpp):(rec?.eod_volume_t??''),
        max:parseFloat(s.props?.max_capacity)||0, maxWhat:'silo capacity', lbl:`${s.name} · ${p.name}`}});
    }));
    if(!rows.length) return '';
    return rdListSection(title,`${dLbl(dateStr)} closing = ${dLbl(nextDate)} opening`,['Silo','Product'],rows,pallets?'pallets':'STn',
      pallets?tppNote(rows.map(r=>r.cell.prodId)):'');
  };
  // Shipping list for a product set. pallets=true → packed products.
  const shipSection=(title,prods,pallets)=>{
    if(!prods.length) return '';
    const rows=prods.map(p=>{
      const rec=(DB.real_shipping_daily||[]).find(r=>r.date===dateStr&&r.facility_id===facId&&r.product_id===p.id);
      const tpp=pallets?tppOf(p.id):0;
      return {labels:[p.name],cell:{elemId:facId,prodId:p.id,type:'shipping',unit:pallets?'pallets':'',tpp:pallets?tpp:'',
        value:pallets?_rdPalletsOf(rec,'volume_t',tpp):(rec?.volume_t??''), lbl:p.name}};
    });
    return rdListSection(title,null,['Product'],rows,pallets?'pallets':'STn',pallets?tppNote(prods.map(p=>p.id)):'');
  };

  let html='';

  // ── 1. RECEIVED — one section per berth (ship / rail / truck) ─────────────────
  m.berths.forEach(({berth:b, type:bt, mode, prods})=>{
    if(!prods.length) return;
    const rows=prods.map(p=>({labels:[p.name],cell:{elemId:b.id,prodId:p.id,type:'unloading',subtype:mode,unit:mode==='rail'?'cars':'t',
      value:(DB.real_unloading_daily||[]).find(r=>r.date===dateStr&&r.berth_id===b.id&&r.product_id===p.id)?.value??'', lbl:`${b.name} · ${p.name}`}}));
    html+=rdListSection(`Received · ${b.name}`,bt,['Product'],rows,mode==='rail'?'railcars':'STn');
  });

  // ── 2–3. CLINKER: kiln production, clinker inventory ─────────────────────────
  html+=prodSection('Kiln production',kilns,'STn',false);
  html+=invSection('Clinker inventory',bulkSilos,isClk,false);

  // ── 4–5. BULK: mill production, bulk inventory (cement, slag, white, additives) ─
  html+=prodSection('Cement production · bulk',finishMills,'STn',false);
  html+=invSection('Bulk inventory',bulkSilos,pid=>!isClk(pid),false);

  // ── 6–7. PACKED: packing production, packed inventory — in pallets ───────────
  html+=prodSection('Packing production',packingPlants,'pallets',true);
  html+=invSection('Packed inventory',packedSilos,()=>true,true);

  // ── 8. SHIPPED — bulk (STn) and packed (pallets) ─────────────────────────────
  html+=shipSection('Shipped · bulk',m.shipProds.filter(p=>!isPacked(p.id)),false);
  html+=shipSection('Shipped · packed',m.shipProds.filter(p=>isPacked(p.id)),true);

  // ── 9. OUTBOUND TRANSFERS — rail loading (railcars), truck campaigns (STn) ────
  if(m.railProds.length){
    html+=rdSectionTable('Rail loading',null,m.railProds,[{label:'Railcars loaded',cells:m.railProds.map(p=>({
      elemId:facId,prodId:p.id,type:'transfer',subtype:'loading',lbl:`Rail loading · ${p.name}`,
      value:(DB.real_rail_daily||[]).find(r=>r.date===dateStr&&r.facility_id===facId&&r.product_id===p.id&&r.type==='loading')?.cars??''
    }))}],'railcars');
  }
  // ── 10. SILO TRANSFERS — tonnes moved along each silo link, per direction, listed on the form
  // of the facility the material LEAVES (so a cross-facility link is never entered twice).
  {
    const rows=[];
    (DB.silo_links||[]).filter(_slValid).forEach(lk=>_slDirs(lk).forEach(dir=>{
      if(_elFac(getEl(dir.from))!==facId) return;
      const prod=DB.products.find(p=>p.id===lk.product_id);
      const val=_slRealT(lk.id,dir.from,dir.to,dateStr);
      const toFac=_elFac(getEl(dir.to))!==facId?` (${_elFacName(getEl(dir.to))})`:'';
      rows.push({labels:[`${_slShort(dir.from)} → ${_slShort(dir.to)}${toFac}`, prod?.name||'?'],
        cell:{elemId:lk.id,prodId:lk.product_id,type:'silotransfer',subtype:dir.from,dest:dir.to,unit:'t',value:val??'',
          max:parseFloat(lk.max_rate_tpd)||'',maxWhat:'the link max',lbl:`Silo transfer ${_slShort(dir.from)} → ${_slShort(dir.to)}`}});
    }));
    if(rows.length) html+=rdListSection('Silo transfers','Tonnes actually moved between silos — overrides the plan',['Transfer','Product'],rows,'STn');
  }

  if(!html) html='<div class="rd-data-empty">No elements to configure</div>';
  else{
    html+=`<div class="rd-footer">
      <span id="rd-foot-info"></span>
      <div id="submitFeedback" style="display:none;align-items:center;gap:8px;color:var(--green);"><span>✓</span><span id="feedbackText">Submitted</span></div>
      <button id="submitRealDataBtn" class="btn-pri" onclick="submitRealData()">✓ Save ${dLbl(dateStr)}</button>
    </div>`;
  }
  container.innerHTML=html;
  if(!container._rdWired){ container.addEventListener('input',_rdOnInput); container.addEventListener('keydown',_rdOnKey); container._rdWired=true; }
  container.querySelectorAll('.rd-section-content').forEach(_rdRefreshSection);
  _rdRefreshFooter();
}

function toggleRdSection(headerEl){
  const content=headerEl.nextElementSibling;
  if(content && content.classList.contains('rd-section-content')){
    content.classList.toggle('collapsed');
    headerEl.classList.toggle('collapsed');
  }
}

function submitRealData(){
  const facId=S.realDataFacilityId || S.facility_id;
  const dateStr=S.realDataSelectedDate;

  if(!dateStr){
    alert('Please select a date');
    return;
  }

  // A field that isn't a number (or is negative) blocks the save — it would otherwise be dropped silently.
  const _bad=[...document.querySelectorAll('#rd-sections-container .rd-in')].filter(i=>_rdValidate(i).bad);
  if(_bad.length){
    document.querySelectorAll('#rd-sections-container .rd-section-content').forEach(_rdRefreshSection); _rdRefreshFooter();
    const sec=_bad[0].closest('.rd-section-content'); if(sec&&sec.classList.contains('collapsed')) toggleRdSection(sec.previousElementSibling);
    _bad[0].focus();
    alert(`${_bad.length} field${_bad.length===1?'':'s'} can't be saved (${_rdValidate(_bad[0]).bad}): ${_bad[0].dataset.lbl||''}`);
    return;
  }
  // Count entries with non-blank values (all input types)
  let hasAnyNewValue=false;
  document.querySelectorAll('.rd-product-input').forEach(input=>{
    if(input.value.trim()!=='') hasAnyNewValue=true;
  });

  // Check if there are EXISTING actual values for this date (to allow deletion)
  const hasExistingProduction=DB.real_production_daily.some(r=>r.date===dateStr&&r.facility_id===facId);
  const hasExistingInventory=DB.real_inventory_daily.some(r=>r.date===dateStr&&r.facility_id===facId);
  const hasExistingTransfer=(DB.real_rail_daily||[]).some(r=>r.date===dateStr&&r.facility_id===facId);
  const hasExistingShipping=(DB.real_shipping_daily||[]).some(r=>r.date===dateStr&&r.facility_id===facId);
  const hasExistingUnloading=(DB.real_unloading_daily||[]).some(r=>r.date===dateStr&&r.facility_id===facId);
  const hasExistingSiloXfer=(DB.real_silo_transfers_daily||[]).some(r=>r.date===dateStr&&_elFac(getEl(r.from_silo_id))===facId);
  const hasExistingValues=hasExistingProduction||hasExistingInventory||hasExistingTransfer||hasExistingShipping||hasExistingUnloading||hasExistingSiloXfer;

  // Allow submission if either: new values to add OR existing values to delete
  if(!hasAnyNewValue && !hasExistingValues){
    alert('Please enter at least one value or delete existing values to return to simulated forecasts');
    return;
  }

  showPreSubmitConfirmation(facId, dateStr, hasAnyNewValue, hasExistingValues);
}

function showPreSubmitConfirmation(facId, dateStr, hasNewValues, hasExistingValues){
  const backdrop=document.createElement('div');
  backdrop.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;';

  const dialog=document.createElement('div');
  dialog.style.cssText='background:var(--surface);border:1px solid var(--accent);border-radius:8px;padding:24px;max-width:450px;box-shadow:0 8px 32px rgba(0,0,0,0.4);';

  // Determine action type for messaging
  const isDeleting=!hasNewValues && hasExistingValues;
  const isBothAddAndDelete=hasNewValues && hasExistingValues;
  const isAdding=hasNewValues && !hasExistingValues;

  let actionTitle='Confirm Data Submission';
  let actionMessage='You are about to submit actual operational data for <strong>${dateStr}</strong>.<br>This will override the simulated forecast values and recalculate all future projections.';
  let buttonLabel='✓ SUBMIT DATA';

  if(isDeleting){
    actionTitle='Confirm Data Deletion';
    actionMessage='You are about to delete all actual data for <strong>${dateStr}</strong>.<br>This will return to simulated forecast values and recalculate all future projections.';
    buttonLabel='✓ DELETE & RESTORE FORECAST';
  } else if(isBothAddAndDelete){
    actionTitle='Confirm Data Update';
    actionMessage='You are about to update actual data for <strong>${dateStr}</strong>.<br>Some values will be updated, others deleted. All forecasts will be recalculated.';
    buttonLabel='✓ UPDATE DATA';
  }

  dialog.innerHTML=`
    <div style="margin-bottom:20px;">
      <div style="font-size:13px;font-weight:700;margin-bottom:16px;color:var(--text);">${actionTitle}</div>
      <div style="font-size:11px;line-height:1.6;color:var(--text-secondary);margin-bottom:16px;">
        <p style="margin:0 0 8px 0;">${actionMessage}</p>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <button id="confirmSubmitBtn" class="btn-pri" style="width:100%;text-align:center;padding:12px;cursor:pointer;font-weight:700;">${buttonLabel}</button>
      <button id="cancelBtn" style="width:100%;text-align:center;padding:12px;background:transparent;border:1px solid var(--border);color:var(--text);cursor:pointer;border-radius:4px;font-size:11px;font-weight:700;transition:all .15s;">CANCEL (KEEP EDITING)</button>
      <button id="closeWithoutBtn" style="width:100%;text-align:center;padding:12px;background:transparent;border:1px solid var(--border);color:var(--text-dim);cursor:pointer;border-radius:4px;font-size:11px;transition:all .15s;">CLOSE WITHOUT UPDATING</button>
    </div>
  `;

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  document.getElementById('confirmSubmitBtn').onclick=()=>{
    backdrop.remove();
    processDataSubmission(facId, dateStr, true);
  };

  document.getElementById('cancelBtn').onclick=()=>{
    backdrop.remove();
  };

  document.getElementById('closeWithoutBtn').onclick=()=>{
    backdrop.remove();
    document.querySelectorAll('.rd-product-input').forEach(input=>input.value='');
    renderRealDataSections();
  };
}

// "1,500" → 1500; '' stays NaN (callers skip blanks before parsing).
function _rdNum(v){ return Number(String(v).replace(/,/g,'').trim()); }
// A value typed in PALLETS: keep the pallet count and store tonnes (pallets × tonnes/pallet)
// in the tonnes field everything else reads. No tonnes/pallet configured → tonnes = pallets
// (as before) and the record is flagged so it can be corrected once the factor exists.
function _rdPallets(rec, tonnesKey, pallets, input){
  const tpp=parseFloat(input.dataset.tpp)||0;
  rec.pallets=pallets;
  rec[tonnesKey]=tpp>0?pallets*tpp:pallets;
  if(tpp>0) rec.tonnes_per_pallet=tpp; else rec.tpp_missing=true;
}
function processDataSubmission(facId, dateStr, clearFormAfter){
  const productionInputs=document.querySelectorAll('.rd-product-input[data-type="production"]');
  const inventoryInputs=document.querySelectorAll('.rd-product-input[data-type="inventory"]');
  const transferInputs=document.querySelectorAll('.rd-product-input[data-type="transfer"]');
  const shippingInputs=document.querySelectorAll('.rd-product-input[data-type="shipping"]');
  const unloadingInputs=document.querySelectorAll('.rd-product-input[data-type="unloading"]');
  const siloXferInputs=document.querySelectorAll('.rd-product-input[data-type="silotransfer"]');
  let productionCount=0, inventoryCount=0, transferCount=0, shippingCount=0, unloadingCount=0, siloXferCount=0, deletedCount=0;
  const updates=[];
  const now=new Date().toISOString();

  // STEP 1: Delete the existing entries for this date/facility that the form SHOWS (they are
  // re-added from the inputs below). Records with no field on the form — e.g. an inventory
  // typed on the Supply page for a product the form didn't list — are left alone; clearing
  // everything for the day used to wipe them silently.
  const _k=(inputs,fn)=>new Set([...inputs].map(fn));
  const kProd=_k(productionInputs,i=>i.dataset.elem+'|'+i.dataset.prod);
  const kInv=_k(inventoryInputs,i=>i.dataset.elem+'|'+i.dataset.prod);
  const kRail=_k(transferInputs,i=>i.dataset.prod);
  const kShip=_k(shippingInputs,i=>i.dataset.prod);
  const kUnl=_k(unloadingInputs,i=>i.dataset.elem+'|'+i.dataset.prod);
  const kSx=_k(siloXferInputs,i=>i.dataset.elem+'|'+i.dataset.subtype+'|'+i.dataset.dest);
  const onProd=r=>r.date===dateStr&&r.facility_id===facId&&kProd.has(r.element_id+'|'+r.product_id);
  // by silo, not facility: old readings of this facility's silos may carry another facility_id
  const onInv=r=>r.date===dateStr&&kInv.has(r.silo_id+'|'+r.product_id);
  const onRail=r=>r.date===dateStr&&r.facility_id===facId&&r.type==='loading'&&kRail.has(r.product_id);
  const onShip=r=>r.date===dateStr&&r.facility_id===facId&&kShip.has(r.product_id);
  const onUnl=r=>r.date===dateStr&&r.facility_id===facId&&kUnl.has(r.berth_id+'|'+r.product_id);
  const onSx=r=>r.date===dateStr&&kSx.has(r.link_id+'|'+r.from_silo_id+'|'+r.to_silo_id);
  const initialProdCount=DB.real_production_daily.filter(onProd).length;
  const initialInvCount=DB.real_inventory_daily.filter(onInv).length;
  // The form only shows RAIL LOADING. Yard counts, dispatches and terminal counts for the same
  // day are entered on the Rail Schedule / reconcile popup — a Daily Data save used to delete them.
  const initialRailCount=(DB.real_rail_daily||[]).filter(onRail).length;
  _railLoadingEdited(_railDpsOfFac(facId),[dateStr]);
  const initialShipCount=(DB.real_shipping_daily||[]).filter(onShip).length;
  const initialUnloadCount=(DB.real_unloading_daily||[]).filter(onUnl).length;

  DB.real_production_daily=DB.real_production_daily.filter(r=>!onProd(r));
  DB.real_inventory_daily=DB.real_inventory_daily.filter(r=>!onInv(r));
  DB.real_rail_daily=(DB.real_rail_daily||[]).filter(r=>!onRail(r));
  DB.real_shipping_daily=(DB.real_shipping_daily||[]).filter(r=>!onShip(r));
  DB.real_unloading_daily=(DB.real_unloading_daily||[]).filter(r=>!onUnl(r));
  // Silo transfer actuals shown on this form (keyed link + direction), cleared before re-adding.
  const initialSxCount=(DB.real_silo_transfers_daily||[]).filter(onSx).length;
  DB.real_silo_transfers_daily=(DB.real_silo_transfers_daily||[]).filter(r=>!onSx(r));

  deletedCount=initialProdCount+initialInvCount+initialRailCount+initialShipCount+initialUnloadCount+initialSxCount;

  // STEP 2: Add new entries from form (only non-blank values)
  productionInputs.forEach(input=>{
    const val=input.value.trim();
    if(val!==''){
      const volume=_rdNum(val);
      if(isNaN(volume)) throw new Error(`Invalid numeric value: ${val}`);
      const elemId=input.dataset.elem, prodId=input.dataset.prod;
      const rec={date:dateStr,facility_id:facId,element_id:elemId,product_id:prodId,volume_t:volume,source:'actual',created_at:now,updated_at:now};
      if(input.dataset.unit==='pallets') _rdPallets(rec,'volume_t',volume,input);
      DB.real_production_daily.push(rec);
      productionCount++;
      updates.push({type:'production',element:elemId,product:prodId,value:volume});
    }
  });

  inventoryInputs.forEach(input=>{
    const val=input.value.trim();
    if(val!==''){
      const volume=_rdNum(val);
      if(isNaN(volume)) throw new Error(`Invalid numeric value: ${val}`);
      const siloId=input.dataset.elem, prodId=input.dataset.prod;
      const rec={date:dateStr,facility_id:facId,silo_id:siloId,product_id:prodId,eod_volume_t:volume,source:'actual',created_at:now,updated_at:now};
      if(input.dataset.unit==='pallets') _rdPallets(rec,'eod_volume_t',volume,input);
      DB.real_inventory_daily.push(rec);
      inventoryCount++;
      updates.push({type:'inventory',element:siloId,product:prodId,value:volume});
    }
  });

  transferInputs.forEach(input=>{
    const val=input.value.trim();
    if(val!==''){
      const cars=_rdNum(val);
      if(!isNaN(cars)){
        DB.real_rail_daily.push({date:dateStr,facility_id:facId,product_id:input.dataset.prod,type:input.dataset.subtype||'loading',cars,source:'actual',created_at:now,updated_at:now});
        transferCount++;
      }
    }
  });

  shippingInputs.forEach(input=>{
    const val=input.value.trim();
    if(val!==''){
      const volume=_rdNum(val);
      if(!isNaN(volume)){
        const rec={date:dateStr,facility_id:facId,product_id:input.dataset.prod,volume_t:volume,source:'actual',created_at:now,updated_at:now};
        if(input.dataset.unit==='pallets') _rdPallets(rec,'volume_t',volume,input);
        DB.real_shipping_daily.push(rec);
        shippingCount++;
      }
    }
  });

  siloXferInputs.forEach(input=>{
    const val=input.value.trim();
    if(val!==''){
      const vol=_rdNum(val);
      if(!isNaN(vol)){
        DB.real_silo_transfers_daily.push({date:dateStr,link_id:input.dataset.elem,from_silo_id:input.dataset.subtype,to_silo_id:input.dataset.dest,product_id:input.dataset.prod,volume_t:vol,source:'actual',created_at:now,updated_at:now});
        siloXferCount++;
      }
    }
  });

  unloadingInputs.forEach(input=>{
    const val=input.value.trim();
    if(val!==''){
      const num=_rdNum(val);
      if(!isNaN(num)){
        DB.real_unloading_daily.push({date:dateStr,facility_id:facId,berth_id:input.dataset.elem,product_id:input.dataset.prod,mode:input.dataset.subtype||'ship',value:num,unit:input.dataset.unit||'t',source:'actual',created_at:now,updated_at:now});
        unloadingCount++;
      }
    }
  });

  autoSave();
  _demandCacheInvalidate();

  const feedbackEl=document.getElementById('submitFeedback');
  const feedbackText=document.getElementById('feedbackText');
  const totalEntries=productionCount+inventoryCount+transferCount+shippingCount+unloadingCount+siloXferCount;

  if(totalEntries>0){
    feedbackText.textContent=`✓ ${totalEntries} entries submitted`;
  } else if(deletedCount>0){
    feedbackText.textContent=`✓ ${deletedCount} entries deleted`;
  } else {
    feedbackText.textContent=`✓ Submitted`;
  }
  feedbackEl.style.display='flex';

  setTimeout(async ()=>{
    feedbackEl.style.display='none';
    await runSimulation();
    showPostSubmitDialog(dateStr, totalEntries, clearFormAfter, deletedCount);
  }, 500);
}

function showPostSubmitDialog(dateStr, totalEntries, clearFormAfter, deletedCount=0){
  const backdrop=document.createElement('div');
  backdrop.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;';

  const dialog=document.createElement('div');
  dialog.style.cssText='background:var(--surface);border:1px solid var(--accent);border-radius:8px;padding:24px;max-width:450px;box-shadow:0 8px 32px rgba(0,0,0,0.4);';

  let successMessage='';
  let detailMessage='';

  if(totalEntries>0){
    successMessage='Daily data has been successfully applied to the simulation and all forecasts have been recalculated.';
    detailMessage=`${totalEntries} entries submitted for ${dateStr}`;
  } else if(deletedCount>0){
    successMessage='Actual data has been deleted. Simulated forecasts have been restored and recalculated.';
    detailMessage=`${deletedCount} entries deleted for ${dateStr}`;
  } else {
    successMessage='Data has been updated and forecasts have been recalculated.';
    detailMessage=dateStr;
  }

  dialog.innerHTML=`
    <div style="margin-bottom:20px;">
      <div style="font-size:13px;color:var(--green);font-weight:700;margin-bottom:12px;">✓ SUCCESS</div>
      <div style="font-size:12px;line-height:1.6;color:var(--text);">
        <p style="margin:0 0 8px 0;">${successMessage}</p>
        <p style="margin:0;font-size:11px;color:var(--text-secondary);">${detailMessage}</p>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <button id="closeDialogBtn" class="btn-pri" style="width:100%;text-align:center;padding:12px;cursor:pointer;font-weight:700;">CLOSE</button>
    </div>
  `;

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  document.getElementById('closeDialogBtn').onclick=()=>{
    backdrop.remove();
    if(clearFormAfter){
      document.querySelectorAll('.rd-product-input').forEach(input=>input.value='');
      renderRealDataSections();
    }
  };
}









function updateStatusBar(){
  document.getElementById('stat-macro').textContent=`${DB.macro_regions.length} macro region${DB.macro_regions.length!==1?'s':''}`;
  document.getElementById('stat-facs').textContent=`${DB.facilities.length} facilit${DB.facilities.length!==1?'ies':'y'}`;
  const elCount=S.facility_id?getFacElements().length:DB.elements.length;
  document.getElementById('stat-els').textContent=`${elCount} element${elCount!==1?'s':''}`;
  document.getElementById('stat-maint').textContent=`${DB.element_maintenance_events.length} maint. event${DB.element_maintenance_events.length!==1?'s':''}`;
}

function statMsg(msg){
  document.getElementById('stat-save').textContent=msg;
  setTimeout(()=>document.getElementById('stat-save').textContent='Auto-saved',2500);
}

// ── Global error catcher ────────────────────────────────
// Uncaught exceptions used to fail silently (a bad record could blank a panel
// with no clue). Surface them as a dismissible red toast with the source line.
function _showErrorToast(text){
  let t=document.getElementById('err-toast');
  if(!t){
    t=document.createElement('div');
    t.id='err-toast';
    t.style.cssText='position:fixed;bottom:14px;right:14px;max-width:440px;background:var(--bn-err-bg);color:var(--bn-err-fg2);border:1px solid var(--red);border-radius:6px;padding:10px 32px 10px 12px;font:11px/1.5 monospace;z-index:99999;white-space:pre-wrap;word-break:break-word;box-shadow:0 4px 18px rgba(0,0,0,.5)';
    const x=document.createElement('span');
    x.textContent='✕';
    x.style.cssText='position:absolute;top:6px;right:9px;cursor:pointer;color:var(--red)';
    x.onclick=()=>t.remove();
    t.appendChild(x);
    const body=document.createElement('div');
    body.id='err-toast-body';
    t.appendChild(body);
    document.body.appendChild(t);
  }
  document.getElementById('err-toast-body').textContent=text;
}
window.addEventListener('error',e=>{
  const where=e.filename?` (${String(e.filename).split('/').pop()}:${e.lineno})`:'';
  _showErrorToast('⚠ Uncaught error: '+(e.message||e.error?.message||'unknown')+where);
});
window.addEventListener('unhandledrejection',e=>{
  const r=e.reason;
  _showErrorToast('⚠ Unhandled promise rejection: '+(r&&r.message?r.message:String(r)));
});

// ═══════════════════════════════════════════════════════
// TOOLTIP
// ═══════════════════════════════════════════════════════
function showTip(el){
  const t=ET[el.type];
  let c=`<strong style="color:var(--green)">${esc(el.name)}</strong><br>${t.label}`;
  if(el.props.max_capacity) c+=`<br>Cap: ${Number(el.props.max_capacity).toLocaleString()} t`;
  if(el.props.rated_capacity_tpd) c+=`<br>Rate: ${Number(el.props.rated_capacity_tpd).toLocaleString()} t/day`;
  if(el.props.start_inventory) c+=`<br>Start: ${Number(el.props.start_inventory).toLocaleString()} t`;
  const evts=DB.element_maintenance_events.filter(m=>m.element_id===el.id);
  if(evts.length) c+=`<br>Maint: ${evts.length} event${evts.length!==1?'s':''}`;
  const tt=document.getElementById('tooltip');
  tt.innerHTML=c; tt.style.display='block';
  document.addEventListener('mousemove',moveTip);
}
function moveTip(e){const tt=document.getElementById('tooltip');tt.style.left=(e.clientX+14)+'px';tt.style.top=(e.clientY-10)+'px';}
function hideTip(){document.getElementById('tooltip').style.display='none';document.removeEventListener('mousemove',moveTip);}

