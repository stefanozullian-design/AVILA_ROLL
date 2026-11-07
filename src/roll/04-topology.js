// ═══════════════════════════════════════════════════════
// TOPOLOGY ENGINE
// ═══════════════════════════════════════════════════════
function onPalDrag(e){ e.dataTransfer.setData('elType',e.currentTarget.dataset.type); }

function syncElCounter(){
  // Always derive elCounter from the highest numeric suffix in actual element IDs.
  // This prevents collisions when importing JSON files where counter was missing or stale.
  const max=DB.elements.reduce((m,e)=>{
    const n=parseInt((e.id||'').replace(/^el_/,''));
    return isNaN(n)?m:Math.max(m,n);
  },0);
  S.elCounter=Math.max(S.elCounter||0,max);
}

function onCanvasDrop(e){
  e.preventDefault();
  if(!S.facility_id){ alert('Select a facility first from the Organization view.'); return; }
  const type=e.dataTransfer.getData('elType'); if(!type) return;
  const p=_topoPt(e.clientX,e.clientY); // canvas coords (honours pan/zoom)
  // A silo transfer is a link, not a node: dropped on a silo, that silo is the origin.
  if(type==='silo_transfer'){ slStartPick(_slSiloAt(p.x,p.y)); return; }
  if(type==='label'){ addTopoLabel(p.x,p.y); return; }
  addElement(type, snap(p.x), snap(p.y));
}

function addElement(type,x,y){
  const id=`el_${++S.elCounter}`;
  const el={id, facility_id:mainCanvasFacilityId(), type, x, y,
    name:`${ET[type].label} ${S.elCounter}`, props:{}, state:'idle',
    maintenanceEvents:[], productCapacities:[], is_active:true};
  DB.elements.push(el);
  renderEl(el); updateEmpty(); updateStatusBar(); selectEl(id); autoSave();
}

function renderEl(el, faded){
  const t=ET[el.type];
  if(!t) return; // unknown type — skip (handles legacy types gracefully)
  const layer=document.getElementById('el-layer');
  const g=document.createElementNS('http://www.w3.org/2000/svg','g');
  g.id=`eg-${el.id}`; g.setAttribute('transform',`translate(${el.x},${el.y})`); g.style.cursor='pointer';
  // Faded = context element from a filtered-out facility that connects to a shown one.
  // Dimmed and non-interactive (toggle its facility on to work with it).
  if(faded){ g.setAttribute('opacity','0.26'); g.style.pointerEvents='none'; }
  // Dynamic color for bulk_silo based on product category
  const color=el.type==='bulk_silo'?getBulkSiloColor(el):t.color;
  g.appendChild(mkShape(t.shape,color,el.state));
  const txt=document.createElementNS('http://www.w3.org/2000/svg','text');
  txt.setAttribute('x','0'); txt.setAttribute('y','30'); txt.setAttribute('text-anchor','middle');
  txt.setAttribute('fill','var(--text-dim)'); txt.setAttribute('font-family','Space Mono,monospace');
  txt.setAttribute('font-size','8'); txt.setAttribute('pointer-events','none');
  txt.textContent=el.name.length>18?el.name.slice(0,18)+'…':el.name;
  g.appendChild(txt);
  const hit=document.createElementNS('http://www.w3.org/2000/svg','circle');
  hit.setAttribute('r','18'); hit.setAttribute('fill','transparent');
  g.appendChild(hit);
  g.addEventListener('mousedown',ev=>{ev.stopPropagation();onElMD(ev,el.id);});
  g.addEventListener('click',ev=>{ev.stopPropagation();onElClick(el.id);});
  g.addEventListener('mouseenter',()=>showTip(el));
  g.addEventListener('mouseleave',hideTip);
  layer.appendChild(g);
}

// Product category colors for bulk silos
const PRODUCT_CAT_COLORS={
  raw_meal:    'var(--yellow)',  // yellow  — Raw Material (Raw Meal)
  clinker:     'var(--orange)',  // orange
  cement_bulk: 'var(--green)',  // green
  cement_packed:'var(--blue)', // blue
  additive:    'var(--pink)',  // pink    — SCM (Supplementary Cementitious Material)
  '':          'var(--border2)'   // unassigned — border only
};

// Returns a tiny colored icon span for a product's category ('' if no product).

// Distinct glyph + colour per SPECIFIC product (e.g. MIA_IL(08) vs MIA_IL(11)), not by category.
// Colour reuses spProdColor so it matches the Sales Performance view.
const PROD_ICON_GLYPHS=['●','◆','■','▲','★','⬢','◐','✦','◣','⬟','❖','◥','▰','◑','◢','⬣'];
const _prodIconGlyphMap={};
function prodIcon(prod){
  if(!prod) return '';
  const key=prod.name||prod.id||'';
  if(!(_prodIconGlyphMap[key]>=0)) _prodIconGlyphMap[key]=Object.keys(_prodIconGlyphMap).length % PROD_ICON_GLYPHS.length;
  const glyph=PROD_ICON_GLYPHS[_prodIconGlyphMap[key]];
  const color=(typeof spProdColor==='function')?spProdColor(key,false):(PRODUCT_CAT_COLORS[prod.category||'']||'#888');
  return `<span class="prod-ic" style="font-size:7px;margin-right:3px;color:${color};vertical-align:middle" title="${prod.name||''}">${glyph}</span>`;
}
// Inventory level color code: red (critical low / overflow), amber (low), orange (near full), green (healthy).
// Based on % of silo max capacity; falls back to neutral green when no capacity is set.
function invLevelColor(value, maxCap){
  if(!maxCap||maxCap<=0) return 'var(--lvl-ok)';
  const pct=value/maxCap*100;
  if(pct<10) return 'var(--lvl-crit)';   // critical low — stockout risk
  if(pct<25) return 'var(--lvl-low)';   // low — amber warning
  if(pct>95) return 'var(--lvl-crit)';   // overflow risk — red
  if(pct>85) return 'var(--lvl-full)';   // near full — orange
  return 'var(--lvl-ok)';              // healthy — green
}
// Pick dark or light text for legibility on a given solid bar colour.
function _barTextColor(hex){
  hex=_tc(hex);
  const m=/^#?([0-9a-f]{6})$/i.exec(hex||''); if(!m) return '#0a0a0a';
  const n=parseInt(m[1],16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  return (0.299*r+0.587*g+0.114*b)>150?'#0a0a0a':'#ffffff';
}

// Forecast Gantt fill: the product colour hatched with a darker tone of itself.
function _hatchBar(c){
  c=_tc(c);
  if(_thRule('bars')==='light') return `color-mix(in srgb,${c} var(--fc-bar-pct,45%),var(--surface))`;
  if(_thRule('bars')==='same') return c;
  const m=/^#?([0-9a-f]{6})$/i.exec(c||'');
  let dark;
  if(m){ const n=parseInt(m[1],16), s=_tcSurfaceRGB(); const mix=(x,y)=>Math.round(x*.35+y*.65);
    dark='#'+[mix((n>>16)&255,s[0]),mix((n>>8)&255,s[1]),mix(n&255,s[2])].map(x=>x.toString(16).padStart(2,'0')).join(''); }
  else dark=`color-mix(in srgb,${c} 35%,var(--surface))`;
  return `repeating-linear-gradient(45deg,${c},${c} 4px,${dark} 4px,${dark} 7px)`;
}
// Supply-page leaf label: "BRS/INV/CLKL_01" → "CLKL_01" with the path dimmed beside it.
function _supLeafLabel(name){
  const str=String(name||''); const i=str.lastIndexOf('/');
  if(i<0) return esc(str);
  return `${esc(str.slice(i+1))}<span style="color:var(--text-dim);font-size:8px;margin-left:5px">${esc(str.slice(0,i))}</span>`;
}

function getProductCategory(productId){
  const p=DB.products.find(x=>x.id===productId);
  return p?.category||'';
}

// Family groups several product categories under one umbrella — Cement covers
// both cement_bulk and cement_packed, SCM covers additive (ash + slag are both
// stored as category:'additive'; scm_type just distinguishes which within SCM).
// Clinker and Raw Meal each have exactly one category so family===category for them.
const PRODUCT_FAMILY_OF={cement_bulk:'cement',cement_packed:'cement',additive:'scm',clinker:'clinker',raw_meal:'raw_meal'};
const PRODUCT_FAMILY_LABELS={cement:'Cement',scm:'SCM',clinker:'Clinker',raw_meal:'Raw Meal'};
function getProductFamily(productId){ return PRODUCT_FAMILY_OF[getProductCategory(productId)]||''; }

function getBulkSiloColor(el){
  // Use first product in the products array for color
  const prods=el.props?.products||[];
  const firstId=prods[0]||el.props?.product_id||''; // fallback to legacy product_id
  const cat=getProductCategory(firstId);
  return PRODUCT_CAT_COLORS[cat]||PRODUCT_CAT_COLORS[''];
}

// Get all product ids for a bulk silo (handles both new array and legacy single product_id)
// Also strips any legacy '=category' suffix that may have been saved by old UI code
function getSiloProducts(el){
  const clean=pid=>{
    if(!pid) return null;
    // Strip legacy '=category' suffix e.g. 'brs_clk_k01=clinker' → 'brs_clk_k01'
    const eqIdx=pid.indexOf('=');
    return eqIdx>0?pid.slice(0,eqIdx):pid;
  };
  if(el?.props?.products&&el.props.products.length){
    return el.props.products.map(clean).filter(Boolean);
  }
  if(el?.props?.product_id){
    const c=clean(el.props.product_id);
    return c?[c]:[];
  }
  return [];
}

// Global silo classification helpers — used by both simulation engine and rendering functions
function siloHasCatGlobal(el,cat){ return getSiloProducts(el).some(pid=>getProductCategory(pid)===cat); }
function isClinkerSilo(el){ return el?.type==='bulk_silo'&&siloHasCatGlobal(el,'clinker'); }
function isRawMealSilo(el){ return el?.type==='bulk_silo'&&siloHasCatGlobal(el,'raw_meal'); }
function isCementSilo(el){
  if(el?.type!=='bulk_silo') return false;
  if(isClinkerSilo(el)||isRawMealSilo(el)) return false;
  // Must have at least one non-empty product assigned
  const prods=getSiloProducts(el).filter(pid=>pid&&pid.trim()!=='');
  if(!prods.length) return false;
  // All products must be cement category (bulk or packed)
  return prods.every(pid=>{
    const cat=getProductCategory(pid);
    return cat==='cement_bulk'||cat==='cement_packed'||cat==='additive';
  });
}


function mkShape(shape,color,state){
  const sc=state==='running'?'var(--green)':state==='stopped'?'var(--red)':state==='warn'?'var(--amber)':color;
  let el;
  if(shape==='circle'){el=document.createElementNS('http://www.w3.org/2000/svg','circle');el.setAttribute('r','14');}
  else if(shape==='diamond'){el=document.createElementNS('http://www.w3.org/2000/svg','polygon');el.setAttribute('points','0,-16 16,0 0,16 -16,0');}
  else if(shape==='rect'){el=document.createElementNS('http://www.w3.org/2000/svg','rect');el.setAttribute('x','-17');el.setAttribute('y','-8');el.setAttribute('width','34');el.setAttribute('height','16');}
  else if(shape==='triangle'){el=document.createElementNS('http://www.w3.org/2000/svg','polygon');el.setAttribute('points','0,-16 14,10 -14,10');}
  else if(shape==='triangle-inv'){el=document.createElementNS('http://www.w3.org/2000/svg','polygon');el.setAttribute('points','0,16 14,-10 -14,-10');}
  else{el=document.createElementNS('http://www.w3.org/2000/svg','circle');el.setAttribute('r','14');}
  el.setAttribute('fill','var(--surface2)'); el.setAttribute('stroke',sc); el.setAttribute('stroke-width','1.5');
  el.classList.add('el-shape'); return el;
}

function onElMD(e,id){
  if(S.tool==='pan'||S._space||e.button===1) return; // let pan handler take it
  if(S.tool!=='select'||S.slPick) return;
  const p=_topoPt(e.clientX,e.clientY);
  // Mousedown on an element that's part of the current multi-selection moves
  // the WHOLE group together, preserving each element's offset from the others.
  if(S.selectedEls.size>1&&S.selectedEls.has(id)){
    const orig={};
    S.selectedEls.forEach(eid=>{ const el=getEl(eid); if(el) orig[eid]={x:el.x,y:el.y}; });
    S.groupDrag={ids:[...S.selectedEls], startX:p.x, startY:p.y, orig};
    return;
  }
  S.dragging=id;
  const el=getEl(id);
  S.dragOff.x=p.x-el.x; S.dragOff.y=p.y-el.y;
}

const GRID=32; // snap grid size in px — matches background grid
function snap(v){ return Math.round(v/GRID)*GRID; }

// Mousedown on empty canvas (select tool only) starts a rubber-band selection
// rectangle. Bails out over the floating canvas-toolbar so its buttons still work.
function onCanvasMD(e){
  if(e.target.closest&&(e.target.closest('#canvas-toolbar')||e.target.closest('#topo-fac-filter')||e.target.closest('#sl-pick-bar'))) return;
  // Pan: hand tool, held Space, or middle mouse button.
  if(S.tool==='pan'||S._space||e.button===1){
    e.preventDefault();
    S.panning={sx:e.clientX,sy:e.clientY,ox:S.topoView.x,oy:S.topoView.y,moved:false};
    document.getElementById('topo-canvas-wrap').style.cursor='grabbing';
    return;
  }
  if(S.tool!=='select'||e.button!==0||S.slPick) return;
  const p=_topoPt(e.clientX,e.clientY);
  S.marquee={x0:p.x,y0:p.y,x1:p.x,y1:p.y};
}

function onCanvasMove(e){
  if(S.panning){
    const pn=S.panning; pn.moved=true;
    S.topoView.x=pn.ox+(e.clientX-pn.sx); S.topoView.y=pn.oy+(e.clientY-pn.sy);
    _applyTopoView();
    return;
  }
  const p=_topoPt(e.clientX,e.clientY); const x=p.x, y=p.y;
  if(S.tlDrag){ _tlDragTo(x,y); return; }
  if(S.dragging&&S.tool==='select'){
    const el=getEl(S.dragging); el.x=snap(x-S.dragOff.x); el.y=snap(y-S.dragOff.y);
    const g=document.getElementById(`eg-${S.dragging}`);
    if(g) g.setAttribute('transform',`translate(${el.x},${el.y})`);
    redrawConns();
  } else if(S.groupDrag){
    const gd=S.groupDrag;
    const dx=snap(x-gd.startX), dy=snap(y-gd.startY);
    gd.ids.forEach(eid=>{
      const el=getEl(eid); const o=gd.orig[eid]; if(!el||!o) return;
      el.x=o.x+dx; el.y=o.y+dy;
      const g=document.getElementById(`eg-${eid}`);
      if(g) g.setAttribute('transform',`translate(${el.x},${el.y})`);
    });
    redrawConns();
  } else if(S.marquee){
    S.marquee.x1=x; S.marquee.y1=y;
    const mx=Math.min(S.marquee.x0,x), my=Math.min(S.marquee.y0,y);
    const mw=Math.abs(x-S.marquee.x0), mh=Math.abs(y-S.marquee.y0);
    const rect=document.getElementById('marquee-rect');
    if(rect){ rect.setAttribute('x',mx); rect.setAttribute('y',my); rect.setAttribute('width',mw); rect.setAttribute('height',mh); rect.setAttribute('opacity','1'); }
  }
  if(S.connectFrom&&S.tool==='connect'){
    const fe=getEl(S.connectFrom);
    const tl=document.getElementById('temp-line');
    tl.setAttribute('x1',fe.x);tl.setAttribute('y1',fe.y);
    tl.setAttribute('x2',x);tl.setAttribute('y2',y);tl.setAttribute('opacity','0.7');
  }
  if(S.slPick&&S.slPick.from) _slPickRubber(x,y);
}

function onCanvasUp(){
  if(S.panning){
    const moved=S.panning.moved; S.panning=null;
    document.getElementById('topo-canvas-wrap').style.cursor=(S.tool==='pan'||S._space)?'grab':(S.tool==='delete'?'crosshair':S.tool==='connect'?'cell':'default');
    if(moved) S._suppressNextClick=true; // don't deselect after a pan
    return;
  }
  // A drag that moved the mouse ends with a native click bubbling up to the
  // canvas wrap (mousedown/mouseup targets differ) — suppress that one click
  // so it doesn't immediately deselect what was just selected/moved.
  const mqDx=S.marquee?Math.abs(S.marquee.x1-S.marquee.x0):0;
  const mqDy=S.marquee?Math.abs(S.marquee.y1-S.marquee.y0):0;
  const realMarquee=S.marquee&&(mqDx>4||mqDy>4);
  const hadInteraction=!!(S.dragging||S.groupDrag||realMarquee);

  if(S.groupDrag){ S.groupDrag=null; autoSave(); }
  if(S.dragging){ S.dragging=null; autoSave(); }
  if(S.tlDrag){ const moved=S.tlDrag.moved; S.tlDrag=null; if(moved){ autoSave(); S._suppressNextClick=true; } }
  if(S.marquee){
    document.getElementById('marquee-rect')?.setAttribute('opacity','0');
    if(realMarquee){
      const mx0=Math.min(S.marquee.x0,S.marquee.x1), my0=Math.min(S.marquee.y0,S.marquee.y1);
      const mx1=Math.max(S.marquee.x0,S.marquee.x1), my1=Math.max(S.marquee.y0,S.marquee.y1);
      selectElsInRect(mx0,my0,mx1,my1);
    }
    S.marquee=null;
  }
  if(hadInteraction) S._suppressNextClick=true;
}

function onCanvasClick(e){
  if(S._suppressNextClick){ S._suppressNextClick=false; return; }
  if(S.slPick) return; // picking silos for a transfer link — a stray click on empty canvas keeps the pick going
  if(S.tool==='select') deselect();
  if(S.tool==='connect') cancelConn();
}

// Select every element whose ~40px footprint intersects the rectangle. 0 or 1
// matches behaves like a normal single click-select; 2+ enters multi-select
// mode (group-highlight + a props-panel summary with a group delete action).
function selectElsInRect(x0,y0,x1,y1){
  const pad=20; // matches the existing per-element hit-circle radius
  const ids=_topoShownEls().filter(el=>
    (el.x-pad)<x1&&(el.x+pad)>x0&&(el.y-pad)<y1&&(el.y+pad)>y0
  ).map(el=>el.id);
  if(ids.length<2){
    deselect();
    if(ids.length===1) selectEl(ids[0]);
    return;
  }
  deselect(); // clears prior selection + highlight styling + props panel
  S.selectedEls=new Set(ids);
  ids.forEach(id=>{
    const g=document.getElementById(`eg-${id}`);
    const sh=g?.querySelector('.el-shape');
    if(sh){ sh.setAttribute('filter','url(#glow)'); sh.setAttribute('stroke-width','2.5'); }
  });
  document.getElementById('props-body').innerHTML=`
    <div class="props-empty">${ids.length} elements selected — drag any of them to move the group together.</div>
    <div style="padding:0 10px 10px"><button class="btn-sec" style="width:100%" onclick="deleteSelectedEls()">🗑 Delete ${ids.length} Selected</button></div>`;
}

function deleteSelectedEls(){
  const ids=[...S.selectedEls]; if(!ids.length) return;
  if(!confirm(`Delete ${ids.length} selected elements?`)) return;
  ids.forEach(id=>{
    DB.elements=DB.elements.filter(e=>e.id!==id);
    DB.connections=DB.connections.filter(c=>c.from_element_id!==id&&c.to_element_id!==id);
    document.getElementById(`eg-${id}`)?.remove();
  });
  _slDropForSilos(ids);
  redrawConns(); updateEmpty(); updateStatusBar(); autoSave();
  deselect();
}

function onElClick(id){
  if(S.slPick){ slPickClick(id); return; }
  if(S.tool==='delete'){
    const el=getEl(id);
    const nConn=DB.connections.filter(c=>c.from_element_id===id||c.to_element_id===id).length;
    const nLink=(DB.silo_links||[]).filter(l=>l.from_silo_id===id||l.to_silo_id===id).length;
    const also=[nConn?`its ${nConn} connection${nConn>1?'s':''}`:'',nLink?`${nLink} silo transfer link${nLink>1?'s':''} (with their plans and actuals)`:''].filter(Boolean).join(' and ');
    if(confirm(`Delete "${el?.name||'this element'}"${also?` and ${also}`:''}?\nThis cannot be undone.`)) deleteEl(id);
    return;
  }
  if(S.tool==='connect'){
    if(!S.connectFrom){S.connectFrom=id;hlEl(id,true);}
    else if(S.connectFrom!==id){addConn(S.connectFrom,id);cancelConn();}
    return;
  }
  selectEl(id);
}

function selectEl(id){
  deselect(); S.selectedEl=id;
  const g=document.getElementById(`eg-${id}`);
  if(g){const sh=g.querySelector('.el-shape');if(sh){sh.setAttribute('filter','url(#glow)');sh.setAttribute('stroke-width','2.5');}}
  renderProps(id);
}

function deselect(){
  S.selectedEl=null;
  S.selectedEls=new Set();
  if(S.selectedLink){ S.selectedLink=null; _slPaintSelection(); }
  if(S.selectedLabel){ document.getElementById('tl-'+S.selectedLabel)?.classList.remove('tl-sel'); S.selectedLabel=null; }
  DB.elements.forEach(el=>{
    const g=document.getElementById(`eg-${el.id}`);
    if(g){const sh=g.querySelector('.el-shape');if(sh){sh.removeAttribute('filter');sh.setAttribute('stroke-width','1.5');}}
  });
  document.getElementById('props-body').innerHTML='<div class="props-empty">Select an element to view and edit its properties</div>';
  document.getElementById('props-type-lbl').textContent='';
}

function hlEl(id,on){const g=document.getElementById(`eg-${id}`);if(g){const sh=g.querySelector('.el-shape');if(sh) sh.setAttribute('stroke-width',on?'3':'1.5');}}

function deleteEl(id){
  DB.elements=DB.elements.filter(e=>e.id!==id);
  DB.connections=DB.connections.filter(c=>c.from_element_id!==id&&c.to_element_id!==id);
  _slDropForSilos([id]);
  document.getElementById(`eg-${id}`)?.remove();
  redrawConns(); updateEmpty(); updateStatusBar(); autoSave();
}

function addConn(from,to){
  const cv=mainCanvasFacilityId();
  if(DB.connections.find(c=>c.from_element_id===from&&c.to_element_id===to&&c.facility_id===cv)) return;
  const c={id:`cn_${Date.now()}`,facility_id:cv,from_element_id:from,to_element_id:to};
  DB.connections.push(c); drawConn(c); updateStatusBar(); autoSave();
}

function drawConn(c, faded){
  const fe=getEl(c.from_element_id), te=getEl(c.to_element_id); if(!fe||!te) return;
  const layer=document.getElementById('conn-layer');
  const line=document.createElementNS('http://www.w3.org/2000/svg','line');
  line.id=`cn-${c.id}`;
  line.setAttribute('x1',fe.x);line.setAttribute('y1',fe.y);
  line.setAttribute('x2',te.x);line.setAttribute('y2',te.y);
  line.setAttribute('stroke','var(--green-dim)');line.setAttribute('stroke-width','1.5');
  line.setAttribute('marker-end','url(#arr)');line.setAttribute('opacity',faded?'0.16':'0.55');
  if(faded) line.style.pointerEvents='none';
  line.style.cursor='pointer';
  line.addEventListener('click',e=>{if(S.tool==='delete'){e.stopPropagation();const fe=getEl(c.from_element_id),te=getEl(c.to_element_id);if(confirm(`Delete the connection ${fe?.name||'?'} → ${te?.name||'?'}?`)) delConn(c.id);}});
  layer.appendChild(line);
}

function delConn(id){
  DB.connections=DB.connections.filter(c=>c.id!==id);
  document.getElementById(`cn-${id}`)?.remove();
  updateStatusBar(); autoSave();
}

function redrawConns(){
  document.getElementById('conn-layer').innerHTML='';
  const vis=_topoVis();
  DB.connections.forEach(c=>{
    const fShown=vis.shown.has(c.from_element_id), tShown=vis.shown.has(c.to_element_id);
    const fVis=fShown||vis.faded.has(c.from_element_id), tVis=tShown||vis.faded.has(c.to_element_id);
    if(fVis&&tVis) drawConn(c, !(fShown&&tShown)); // faded when either end is a context (dimmed) element
  });
  // Silo transfer links (dotted orange) — same shown/faded rule as connections.
  (DB.silo_links||[]).forEach(lk=>{
    const fShown=vis.shown.has(lk.from_silo_id), tShown=vis.shown.has(lk.to_silo_id);
    const fVis=fShown||vis.faded.has(lk.from_silo_id), tVis=tShown||vis.faded.has(lk.to_silo_id);
    if(fVis&&tVis) drawSiloLink(lk, !(fShown&&tShown));
  });
}

function cancelConn(){
  if(S.connectFrom) hlEl(S.connectFrom,false);
  S.connectFrom=null;
  document.getElementById('temp-line').setAttribute('opacity','0');
}

function clearCanvas(){
  if(!confirm('Clear all elements from this facility?')) return;
  _slDropForSilos(DB.elements.filter(e=>e.facility_id===S.facility_id).map(e=>e.id));
  DB.elements=DB.elements.filter(e=>e.facility_id!==S.facility_id);
  DB.connections=DB.connections.filter(c=>c.facility_id!==S.facility_id);
  document.getElementById('el-layer').innerHTML='';
  document.getElementById('conn-layer').innerHTML='';
  deselect(); updateEmpty(); updateStatusBar(); autoSave();
}

function autoLayout(){
  const els=_topoShownEls(); if(!els.length) return;
  const cols=Math.ceil(Math.sqrt(els.length));
  els.forEach((el,i)=>{
    el.x=snap(160+(i%cols)*130); el.y=snap(100+Math.floor(i/cols)*130);
    const g=document.getElementById(`eg-${el.id}`); if(g) g.setAttribute('transform',`translate(${el.x},${el.y})`);
  });
  redrawConns(); autoSave();
}

// ═══════════════════════════════════════════════════════
// TOPOLOGY — unified canvas: pan / zoom + multi-facility filter
// ═══════════════════════════════════════════════════════
// The canvas is one plane for the whole network (elements remember their facility
// via assigned_facility_id||facility_id). It is NOT gated by S.facility_id, so the
// other pages keep their own facility scoping untouched.
function getCanvasEls(){ return DB.elements; }
// (getCanvasConns and a duplicate _elFac used to live here. getCanvasConns had no
// callers; the _elFac here was shadowed by the null-safe declaration near the
// SALES section — function hoisting means that later one already won everywhere.)

// Classify every element for the current facility filter:
//   shown  = its facility is selected (or no filter → all shown)
//   faded  = its facility is filtered OUT but it connects to a shown element (context)
//   hidden = otherwise (not returned)
function _topoVis(){
  const sel=S.topoFacFilter; const filtering=!!(sel&&sel.size);
  const shown=new Set(), faded=new Set();
  DB.elements.forEach(el=>{ if(!filtering||sel.has(_elFac(el))) shown.add(el.id); });
  if(filtering){
    DB.connections.forEach(c=>{
      if(shown.has(c.from_element_id)&&!shown.has(c.to_element_id)) faded.add(c.to_element_id);
      if(shown.has(c.to_element_id)&&!shown.has(c.from_element_id)) faded.add(c.from_element_id);
    });
    (DB.silo_links||[]).forEach(lk=>{ // a silo linked across facilities shows as context too
      if(shown.has(lk.from_silo_id)&&!shown.has(lk.to_silo_id)) faded.add(lk.to_silo_id);
      if(shown.has(lk.to_silo_id)&&!shown.has(lk.from_silo_id)) faded.add(lk.from_silo_id);
    });
    faded.forEach(id=>{ if(shown.has(id)||!getEl(id)) faded.delete(id); }); // drop shown + orphaned refs
  }
  return {shown,faded};
}
// Elements the user can interact with (fully shown, not faded context).
function _topoShownEls(){ const v=_topoVis(); return DB.elements.filter(e=>v.shown.has(e.id)); }

// Full canvas redraw honoring the facility filter (elements + connections + fade).
function renderTopoCanvas(){
  const vis=_topoVis();
  const elLayer=document.getElementById('el-layer'); if(!elLayer) return;
  elLayer.innerHTML='';
  DB.elements.forEach(el=>{ if(vis.shown.has(el.id)||vis.faded.has(el.id)) renderEl(el, vis.faded.has(el.id)); });
  (DB.topo_labels||[]).forEach(l=>{ if(_tlShown(l)) renderTopoLabel(l); });
  redrawConns();
  _applyTopoView();
  updateEmpty();
  if(typeof renderTopoFacFilter==='function') renderTopoFacFilter();
  if(S.slPick) _slPickPaint(); // a re-render mid-pick keeps the orange highlighting
}

// ── Facility filter chip bar ──────────────────────────────────────────────
function renderTopoFacFilter(){
  const bar=document.getElementById('topo-fac-filter'); if(!bar) return;
  const facs=(DB.facilities||[]);
  if(facs.length<2){ bar.innerHTML=''; return; } // nothing to filter with one facility
  const sel=S.topoFacFilter; const allOn=!(sel&&sel.size);
  bar.innerHTML=`<span class="tf-chip tf-all ${allOn?'on':''}" onclick="topoFilterAll()">All</span>`+
    facs.map(f=>`<span class="tf-chip ${(!allOn&&sel.has(f.id))?'on':''}" onclick="topoToggleFac('${f.id}')">${f.name}</span>`).join('');
}
function topoFilterAll(){ S.topoFacFilter=null; renderTopoCanvas(); deselect(); }
function topoToggleFac(fid){
  if(!S.topoFacFilter||!S.topoFacFilter.size){ S.topoFacFilter=new Set([fid]); } // from "all" → focus this one
  else if(S.topoFacFilter.has(fid)){ S.topoFacFilter.delete(fid); if(!S.topoFacFilter.size) S.topoFacFilter=null; }
  else S.topoFacFilter.add(fid);
  renderTopoCanvas(); deselect();
}

// ═══════════════════════════════════════════════════════
// TOPOLOGY LABELS — free text on the canvas (DB.topo_labels)
// ═══════════════════════════════════════════════════════
// A label is a note for the reader ("Ash purchased", "CEM purchased"): a title over a group of
// elements, drawn in the element layer so it pans and zooms with them. It is NOT a topology item —
// nothing connects to it, the simulation never reads it and it is not in TOPO_TABLES, so it is
// never part of the administrator's seal and does not raise change requests. Drag the palette
// item onto the canvas (or click it) to add one; drag the text to move it; Select-tool click to
// edit it in the Properties panel; Delete-tool click (or the Delete key) removes it.
const TL_SIZES={s:9,m:13,l:19};
const TL_COLORS=[['text','Default','var(--text)'],['green','Green','var(--green)'],['amber','Amber','var(--amber)'],['red','Red','var(--red)'],['blue','Blue','var(--blue)'],['dim','Grey','var(--text-dim)']];
function _tlGet(id){ return (DB.topo_labels||[]).find(l=>l.id===id); }
function _tlShown(l){ const sel=S.topoFacFilter; return !(sel&&sel.size)||!l.facility_id||sel.has(l.facility_id); }
function _tlColor(l){ return (TL_COLORS.find(c=>c[0]===(l.color||'text'))||TL_COLORS[0])[2]; }
function addTopoLabel(x,y,text){
  if(!DB.topo_labels) DB.topo_labels=[];
  const sel=S.topoFacFilter;
  const l={id:'tl_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), text:text||'New label', x:snap(x), y:snap(y),
    size:'m', bold:true, color:'text', facility_id:(sel&&sel.size===1)?[...sel][0]:null};
  DB.topo_labels.push(l);
  renderTopoLabel(l); selectTopoLabel(l.id); autoSave();
  setTimeout(()=>{ const i=document.getElementById('tl-text'); if(i){ i.focus(); i.select(); } },0);
}
// Palette click (no drag): drop the label in the middle of what is on screen.
function addTopoLabelAtCenter(){
  if(S.view!=='topology') switchView('topology');
  const r=document.getElementById('topo-svg').getBoundingClientRect();
  const p=_topoPt(r.left+r.width/2, r.top+r.height/2);
  addTopoLabel(p.x,p.y);
}
function renderTopoLabel(l){
  const ns='http://www.w3.org/2000/svg', layer=document.getElementById('el-layer'); if(!layer) return;
  document.getElementById('tl-'+l.id)?.remove();
  const g=document.createElementNS(ns,'g'); g.id='tl-'+l.id; g.classList.add('tl-g');
  if(S.selectedLabel===l.id) g.classList.add('tl-sel');
  g.setAttribute('transform',`translate(${l.x},${l.y})`);
  const fs=TL_SIZES[l.size]||TL_SIZES.m, lh=fs*1.25;
  const lines=String(l.text||'').split('\n'); if(!lines.length||!lines.join('').trim()) lines.splice(0,lines.length,'(empty label)');
  const hit=document.createElementNS(ns,'rect'); hit.classList.add('tl-hit'); g.appendChild(hit);
  const t=document.createElementNS(ns,'text');
  t.setAttribute('text-anchor','middle'); t.setAttribute('font-size',fs); t.setAttribute('fill',_tlColor(l));
  if(l.bold!==false) t.setAttribute('font-weight','700');
  t.setAttribute('pointer-events','none');
  lines.forEach((ln,i)=>{
    const ts=document.createElementNS(ns,'tspan'); ts.setAttribute('x','0');
    ts.setAttribute('y', (-(lines.length-1)*lh/2 + i*lh + fs*0.35).toFixed(1));
    ts.textContent=ln||' '; t.appendChild(ts);
  });
  g.appendChild(t);
  layer.appendChild(g);
  // Hit box around the text. getBBox needs the SVG laid out; off-screen (another page open) it
  // throws or returns zeros, so fall back to an estimate — the box is only for clicking.
  let w=0,h=0; try{ const b=t.getBBox(); w=b.width; h=b.height; }catch(e){}
  if(!w||!h){ w=Math.max(...lines.map(x=>x.length))*fs*0.62; h=lines.length*lh; }
  const pad=6; hit.setAttribute('x',(-w/2-pad).toFixed(1)); hit.setAttribute('y',(-h/2-pad).toFixed(1));
  hit.setAttribute('width',(w+2*pad).toFixed(1)); hit.setAttribute('height',(h+2*pad).toFixed(1)); hit.setAttribute('rx','3');
  g.addEventListener('mousedown',e=>{ if(e.button!==0||S.tool==='pan'||S._space||S.slPick) return; e.stopPropagation(); if(S.tool!=='select') return;
    const p=_topoPt(e.clientX,e.clientY); S.tlDrag={id:l.id, offX:p.x-l.x, offY:p.y-l.y, moved:false}; });
  g.addEventListener('click',e=>{ if(S.slPick) return; e.stopPropagation(); if(S.tool==='delete'){ deleteTopoLabel(l.id); return; } if(S.tool==='select') selectTopoLabel(l.id); });
  g.addEventListener('dblclick',e=>{ e.stopPropagation(); if(S.tool!=='select') setTool('select'); selectTopoLabel(l.id);
    const i=document.getElementById('tl-text'); if(i){ i.focus(); i.select(); } });
}
function _tlDragTo(x,y){
  const d=S.tlDrag, l=_tlGet(d.id); if(!l) return;
  const nx=snap(x-d.offX), ny=snap(y-d.offY);
  if(nx===l.x&&ny===l.y) return;
  l.x=nx; l.y=ny; d.moved=true;
  document.getElementById('tl-'+l.id)?.setAttribute('transform',`translate(${l.x},${l.y})`);
}
function selectTopoLabel(id){
  if(!_tlGet(id)) return;
  deselect(); S.selectedLabel=id;
  document.getElementById('tl-'+id)?.classList.add('tl-sel');
  renderTopoLabelProps(id);
}
function deleteTopoLabel(id){
  const l=_tlGet(id); if(!l) return;
  if(!confirm(`Delete the label "${String(l.text||'').split('\n')[0]}"?`)) return;
  DB.topo_labels=(DB.topo_labels||[]).filter(x=>x.id!==id);
  document.getElementById('tl-'+id)?.remove();
  if(S.selectedLabel===id) deselect();
  autoSave();
}
function _tlSet(id,k,v){
  const l=_tlGet(id); if(!l) return;
  if(k==='facility_id') v=v||null;
  if(l[k]===v) return;
  l[k]=v; renderTopoLabel(l); autoSave();
  if(k!=='text') renderTopoLabelProps(id); // the buttons show the new state; the text box keeps focus while typing
}
function renderTopoLabelProps(id){
  const l=_tlGet(id); if(!l) return;
  document.getElementById('props-type-lbl').textContent='Label';
  const btn=on=>`flex:1;padding:6px 4px;font-family:var(--mono);font-size:9px;border:1px solid ${on?'var(--green)':'var(--border2)'};background:${on?'rgba(var(--green-rgb),.14)':'transparent'};color:${on?'var(--green)':'var(--text-dim)'};cursor:pointer;border-radius:2px`;
  const sizeBtns=[['s','Small'],['m','Medium'],['l','Large']].map(([k,n])=>`<button type="button" style="${btn((l.size||'m')===k)}" onclick="_tlSet('${id}','size','${k}')">${n}</button>`).join('');
  const colBtns=TL_COLORS.map(([k,n,css])=>`<button type="button" title="${n}" style="${btn((l.color||'text')===k)};color:${css};font-weight:700" onclick="_tlSet('${id}','color','${k}')">A</button>`).join('');
  const facOpts=`<option value="">Every facility (always shown)</option>`+(DB.facilities||[]).map(f=>`<option value="${f.id}" ${l.facility_id===f.id?'selected':''}>${esc(f.name)}</option>`).join('');
  document.getElementById('props-body').innerHTML=`
  <div class="pg"><div class="pg-title">Text</div>
    <div class="pf"><textarea class="pi" id="tl-text" rows="3" style="resize:vertical;font-family:var(--sans);font-size:12px" placeholder="Type the label…" oninput="_tlSet('${id}','text',this.value)" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.blur();}">${esc(l.text||'')}</textarea>
      <div class="fhint">Enter finishes · Shift+Enter starts a new line · drag the label on the canvas to move it</div></div>
  </div>
  <div class="pg"><div class="pg-title">Look</div>
    <div class="pf"><div class="pl">Size</div><div style="display:flex;gap:4px;margin-top:2px">${sizeBtns}</div></div>
    <div class="pf"><div class="pl">Weight</div><div style="display:flex;gap:4px;margin-top:2px">
      <button type="button" style="${btn(l.bold!==false)};font-weight:700" onclick="_tlSet('${id}','bold',true)">Bold</button>
      <button type="button" style="${btn(l.bold===false)}" onclick="_tlSet('${id}','bold',false)">Regular</button></div></div>
    <div class="pf"><div class="pl">Colour</div><div style="display:flex;gap:4px;margin-top:2px">${colBtns}</div></div>
  </div>
  <div class="pg"><div class="pg-title">Shown with</div>
    <div class="pf"><select class="pi" onchange="_tlSet('${id}','facility_id',this.value)">${facOpts}</select>
      <div class="fhint">A label tied to a facility hides when the facility chips above the canvas filter that facility out.</div></div>
  </div>
  <div style="padding:0 10px 10px"><button class="btn-sec" style="width:100%;color:var(--red);border-color:rgba(var(--red-rgb),.5)" onclick="deleteTopoLabel('${id}')">🗑 Delete label</button></div>`;
}
document.addEventListener('keydown',e=>{
  if(e.key!=='Delete'||!S.selectedLabel||S.view!=='topology') return;
  if(/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||'')||document.activeElement?.isContentEditable) return;
  deleteTopoLabel(S.selectedLabel);
});

// ── Pan / zoom ────────────────────────────────────────────────────────────
// Convert a screen (client) point to CANVAS coordinates (undo pan+zoom).
function _topoPt(clientX,clientY){
  const r=document.getElementById('topo-svg').getBoundingClientRect();
  const v=S.topoView;
  return { x:(clientX-r.left-v.x)/v.k, y:(clientY-r.top-v.y)/v.k };
}
function _applyTopoView(){
  const g=document.getElementById('topo-viewport');
  if(g) g.setAttribute('transform',`translate(${S.topoView.x},${S.topoView.y}) scale(${S.topoView.k})`);
}
// Zoom by a factor around the canvas centre (used by the +/- buttons).
function topoZoom(factor){
  const r=document.getElementById('topo-svg').getBoundingClientRect();
  _topoZoomAt(factor, r.width/2, r.height/2);
}
// Zoom by factor keeping the point (sx,sy) [screen px, relative to svg] fixed.
function _topoZoomAt(factor,sx,sy){
  const v=S.topoView; const k2=Math.min(3.5,Math.max(0.15,v.k*factor));
  const cx=(sx-v.x)/v.k, cy=(sy-v.y)/v.k;
  v.x=sx-cx*k2; v.y=sy-cy*k2; v.k=k2;
  _applyTopoView();
}
function onCanvasWheel(e){
  if(S.view!=='topology') return;
  e.preventDefault();
  const r=document.getElementById('topo-svg').getBoundingClientRect();
  _topoZoomAt(Math.exp(-e.deltaY*0.0015), e.clientX-r.left, e.clientY-r.top);
}
// Fit all currently-visible (shown) elements into view.
function topoFitView(){
  const els=_topoShownEls().filter(e=>ET[e.type]);
  const r=document.getElementById('topo-svg').getBoundingClientRect();
  if(!els.length){ S.topoView={x:0,y:0,k:1}; _applyTopoView(); return; }
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  els.forEach(el=>{ minX=Math.min(minX,el.x); minY=Math.min(minY,el.y); maxX=Math.max(maxX,el.x); maxY=Math.max(maxY,el.y); });
  (DB.topo_labels||[]).filter(_tlShown).forEach(l=>{ minX=Math.min(minX,l.x); minY=Math.min(minY,l.y); maxX=Math.max(maxX,l.x); maxY=Math.max(maxY,l.y); });
  const pad=70; minX-=pad;minY-=pad;maxX+=pad;maxY+=pad;
  const bw=Math.max(1,maxX-minX), bh=Math.max(1,maxY-minY);
  const k=Math.min(2, Math.max(0.15, Math.min(r.width/bw, r.height/bh)));
  S.topoView={ k, x:(r.width-bw*k)/2 - minX*k, y:(r.height-bh*k)/2 - minY*k };
  _applyTopoView();
}

function updateEmpty(){
  document.getElementById('canvas-empty').style.display=getCanvasEls().length?'none':'flex';
}

// ═══════════════════════════════════════════════════════
// SILO TRANSFERS — dotted orange links between two bulk silos holding the same product
// ═══════════════════════════════════════════════════════
// Replaced the truck-transfer campaigns (2026-09-23). Data: DB.silo_links (the line),
// DB.silo_transfer_plans (planned t/day, ONE direction per row) and
// DB.real_silo_transfers_daily (tonnes actually moved). The engine step is
// simDaySiloTransfers inside simulate(); the Supply page shows one row per allowed direction
// in a "<MATERIAL> TRANSFER" section (_slXferSection) of every block holding either silo.
// Nothing ever moves on the simulation's own initiative — only what is planned or recorded.

function _slSiloEls(){ return DB.elements.filter(e=>e.type==='bulk_silo'); }
function _slLink(id){ return (DB.silo_links||[]).find(l=>l.id===id); }
// Products two silos share, in the first silo's order.
function _slShared(a,b){ if(!a||!b) return []; const pb=new Set(getSiloProducts(b)); return getSiloProducts(a).filter(p=>pb.has(p)); }
// Live = both silos exist, are bulk silos and still hold the link's product. A link that stops
// matching (a silo's product was changed) is drawn red and the simulation skips it.
function _slValid(lk){
  const a=getEl(lk?.from_silo_id), b=getEl(lk?.to_silo_id);
  return !!(a&&b&&a.type==='bulk_silo'&&b.type==='bulk_silo'&&lk.product_id
    &&getSiloProducts(a).includes(lk.product_id)&&getSiloProducts(b).includes(lk.product_id));
}
// The directions a link allows, as {from,to}: origin → destination always, back again when two-way.
function _slDirs(lk){ const d=[{from:lk.from_silo_id,to:lk.to_silo_id}]; if(lk.two_way) d.push({from:lk.to_silo_id,to:lk.from_silo_id}); return d; }
// Silo name without its facility / INV prefix: "BRS/INV/BRS_IL/BLK" → "BRS_IL/BLK" (the leaf
// alone — "BLK" — is ambiguous), "BRS/INV/CLKL_01" → "CLKL_01".
function _slShort(id){
  const n=getEl(id)?.name||'?', p=n.split('/');
  if(p.length<2) return n;
  return (p.length>2&&p[1].toUpperCase()==='INV'?p.slice(2):p.slice(1)).join('/');
}
function _slDefaultName(lk){ return `${_slShort(lk.from_silo_id)} ${lk.two_way?'⇄':'→'} ${_slShort(lk.to_silo_id)}`; }
function _slName(lk){ return (lk.name||'').trim()||_slDefaultName(lk); }
// Clinker links live in the plant's clinker block, everything else in the cement/bulk block.
function _slSecKey(lk){ return getProductCategory(lk.product_id)==='clinker'?'clinkerXfer':'cementXfer'; }
function _slFamLabel(pids){
  const f=[...new Set(pids.map(p=>({clinker:'CLINKER',cement:'CEMENT',scm:'SCM',raw_meal:'RAW MEAL'})[getProductFamily(p)]||'BULK'))];
  return f.join(' / ')+' TRANSFER';
}
// Planned t/day for one direction on a date. A one-day row is a day typed on the Supply page and
// beats a broader campaign; among rows of the same kind the last one wins.
function _slPlanRow(linkId,from,to,ds){
  let day=null, camp=null;
  (DB.silo_transfer_plans||[]).forEach(p=>{
    if(p.link_id!==linkId||p.from_silo_id!==from||p.to_silo_id!==to||ds<p.start_date||ds>p.end_date) return;
    if(p.start_date===p.end_date) day=p; else camp=p;
  });
  return day||camp;
}
function _slPlanRate(linkId,from,to,ds){ const p=_slPlanRow(linkId,from,to,ds); return p?(parseFloat(p.rate_tpd)||0):0; }
// Tonnes recorded as moved in one direction on a date, or null when nothing was recorded.
function _slRealT(linkId,from,to,ds){
  let t=null;
  (DB.real_silo_transfers_daily||[]).forEach(x=>{ if(x.link_id===linkId&&x.from_silo_id===from&&x.to_silo_id===to&&x.date===ds) t=(t||0)+(parseFloat(x.volume_t)||0); });
  return t;
}
function _slSetReal(lk,from,to,ds,v){
  const now=new Date().toISOString();
  DB.real_silo_transfers_daily=(DB.real_silo_transfers_daily||[]).filter(t=>!(t.link_id===lk.id&&t.from_silo_id===from&&t.to_silo_id===to&&t.date===ds));
  if(v!=null) DB.real_silo_transfers_daily.push({date:ds,link_id:lk.id,from_silo_id:from,to_silo_id:to,product_id:lk.product_id,volume_t:v,source:'actual',created_at:now,updated_at:now});
}
// Plans + actuals stored for one direction (warn before a change hides them).
function _slDirCount(linkId,from,to){
  return (DB.silo_transfer_plans||[]).filter(p=>p.link_id===linkId&&p.from_silo_id===from&&p.to_silo_id===to).length
    +(DB.real_silo_transfers_daily||[]).filter(t=>t.link_id===linkId&&t.from_silo_id===from&&t.to_silo_id===to).length;
}
// Remove links (and their plans + actuals). _slDropForSilos is called by every element delete path.
function _slDropLinks(gone){
  DB.silo_links=(DB.silo_links||[]).filter(l=>!gone.has(l.id));
  DB.silo_transfer_plans=(DB.silo_transfer_plans||[]).filter(p=>!gone.has(p.link_id));
  DB.real_silo_transfers_daily=(DB.real_silo_transfers_daily||[]).filter(t=>!gone.has(t.link_id));
  if(gone.has(S.selectedLink)) S.selectedLink=null;
}
function _slDropForSilos(ids){
  const del=new Set(ids||[]); if(!del.size||!(DB.silo_links||[]).length) return;
  const gone=new Set(DB.silo_links.filter(l=>del.has(l.from_silo_id)||del.has(l.to_silo_id)).map(l=>l.id));
  if(gone.size) _slDropLinks(gone);
}
// Scenario files written before this feature have no silo tables: loading one must not keep the
// links of the scenario open before it (the loaders only replace tables the file carries). Keyed
// on silo_links alone — a compact cache can lack only the daily actuals, and must not wipe them.
function _slResetIfAbsent(savedDB){
  if(!savedDB||savedDB.silo_links!==undefined) return;
  ['silo_links','silo_transfer_plans','real_silo_transfers_daily'].forEach(k=>{ DB[k]=[]; });
}
// The silo under a canvas point (a drop target), or null.
function _slSiloAt(x,y){
  let best=null, bd=26*26;
  _topoShownEls().forEach(el=>{ if(el.type!=='bulk_silo') return; const d=(el.x-x)**2+(el.y-y)**2; if(d<bd){ bd=d; best=el.id; } });
  return best;
}

// ── Pick mode: click the origin, then the destination ───────────────────────
// Eligible silos glow orange and everything else fades, so a silo holding another material
// can't be picked. The prompt bar carries a dropdown with the same choices (for a silo in a
// facility the filter hides) and Cancel; Esc cancels too.
function _slCandidates(fromId){
  const silos=_slSiloEls();
  if(!fromId) return silos.filter(a=>silos.some(b=>b!==a&&_slShared(a,b).length));
  const a=getEl(fromId);
  return silos.filter(b=>b.id!==fromId&&_slShared(a,b).length);
}
function slStartPick(fromId){
  if(S.view!=='topology') switchView('topology');
  if(S.tool!=='select') setTool('select');
  deselect();
  if(!_slCandidates(null).length){ statMsg('No two silos hold the same material — nothing to link'); return; }
  if(fromId&&!_slCandidates(fromId).length){ statMsg(`${getEl(fromId)?.name||'That silo'} shares its material with no other silo — pick the origin`); fromId=null; }
  S.slPick={from:fromId||null};
  _slPickPaint();
}
function slCancelPick(){
  S.slPick=null;
  document.getElementById('topo-svg')?.classList.remove('sl-picking');
  document.querySelectorAll('#el-layer g.sl-ok,#el-layer g.sl-dim,#el-layer g.sl-origin').forEach(g=>g.classList.remove('sl-ok','sl-dim','sl-origin'));
  document.getElementById('sl-rubber')?.remove();
  const bar=document.getElementById('sl-pick-bar'); if(bar){ bar.style.display='none'; bar.innerHTML=''; }
}
function _slPickPaint(){
  const pk=S.slPick; if(!pk) return;
  const ok=new Set(_slCandidates(pk.from).map(e=>e.id));
  document.getElementById('topo-svg')?.classList.add('sl-picking');
  DB.elements.forEach(el=>{
    const g=document.getElementById(`eg-${el.id}`); if(!g) return;
    g.classList.toggle('sl-origin',el.id===pk.from);
    g.classList.toggle('sl-ok',ok.has(el.id));
    g.classList.toggle('sl-dim',el.id!==pk.from&&!ok.has(el.id));
  });
  if(!pk.from) document.getElementById('sl-rubber')?.remove();
  const bar=document.getElementById('sl-pick-bar'); if(!bar) return;
  const opts=[...ok].map(getEl).sort((a,b)=>(a.name||'').localeCompare(b.name||''))
    .map(e=>`<option value="${e.id}">${esc(e.name)}${_elFacName(e)?' · '+esc(_elFacName(e)):''}</option>`).join('');
  const from=pk.from?getEl(pk.from):null;
  const mat=from?getSiloProducts(from).map(p=>DB.products.find(x=>x.id===p)?.name||p).join(' / '):'';
  bar.innerHTML=`<span style="color:var(--orange);font-weight:700;letter-spacing:.5px">┄ SILO TRANSFER</span>`
    +(from?`<span>From <b>${esc(from.name)}</b> — click the destination silo. Only silos holding ${esc(mat)} are active.</span>`
          :`<span>Click the origin silo. Only silos that share their material with another silo are active.</span>`)
    +`<select onchange="if(this.value) slPickClick(this.value)"><option value="">…or pick from the list</option>${opts}</select>`
    +`<button onclick="slCancelPick()">Cancel (Esc)</button>`;
  bar.style.display='flex';
}
function _slPickRubber(x,y){
  const fe=getEl(S.slPick?.from); if(!fe) return;
  let ln=document.getElementById('sl-rubber');
  if(!ln){
    ln=document.createElementNS('http://www.w3.org/2000/svg','line'); ln.id='sl-rubber';
    ln.setAttribute('stroke','var(--orange)'); ln.setAttribute('stroke-width','2'); ln.setAttribute('stroke-dasharray','1 5');
    ln.setAttribute('stroke-linecap','round'); ln.setAttribute('pointer-events','none');
    document.getElementById('conn-layer')?.appendChild(ln);
  }
  ln.setAttribute('x1',fe.x); ln.setAttribute('y1',fe.y); ln.setAttribute('x2',x); ln.setAttribute('y2',y);
}
function slPickClick(id){
  const pk=S.slPick; if(!pk) return;
  const el=getEl(id);
  if(!pk.from){
    if(!_slCandidates(null).some(e=>e.id===id)){ statMsg(el?.type==='bulk_silo'?'That silo shares its material with no other silo':'Pick a bulk silo'); return; }
    pk.from=id; _slPickPaint(); return;
  }
  if(id===pk.from) return;
  if(!_slCandidates(pk.from).some(e=>e.id===id)){ statMsg('Only a silo holding the same material can be the destination'); return; }
  const from=pk.from;
  const dup=(DB.silo_links||[]).find(l=>(l.from_silo_id===from&&l.to_silo_id===id)||(l.from_silo_id===id&&l.to_silo_id===from));
  slCancelPick();
  if(dup){ selectSiloLink(dup.id); statMsg('These two silos are already linked — showing that link'); return; }
  addSiloLink(from,id);
}
function addSiloLink(fromId,toId){
  const shared=_slShared(getEl(fromId),getEl(toId)); if(!shared.length) return;
  if(!DB.silo_links) DB.silo_links=[];
  const lk={id:'sl_'+Date.now()+'_'+Math.random().toString(36).slice(2,6), name:'', from_silo_id:fromId, to_silo_id:toId,
    product_id:shared[0], two_way:false, max_rate_tpd:null, created_at:new Date().toISOString()};
  DB.silo_links.push(lk);
  redrawConns(); autoSave();
  selectSiloLink(lk.id);
  statMsg('Silo transfer added — choose one way or two way, then plan it on the Production page');
}
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&S.slPick) slCancelPick(); });

// ── Drawing ─────────────────────────────────────────────────────────────────
// Dotted orange line stopped at the silo rims so the arrowheads show: one arrow at the
// destination (one way) or one at each end (two way). Red dashes = the silos no longer match.
function drawSiloLink(lk, faded){
  const a=getEl(lk.from_silo_id), b=getEl(lk.to_silo_id); if(!a||!b) return;
  const layer=document.getElementById('conn-layer'); if(!layer) return;
  const ns='http://www.w3.org/2000/svg';
  const valid=_slValid(lk), sel=S.selectedLink===lk.id;
  const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1, rim=Math.min(17,len/3), ux=dx/len, uy=dy/len;
  const x1=a.x+ux*rim, y1=a.y+uy*rim, x2=b.x-ux*rim, y2=b.y-uy*rim;
  const g=document.createElementNS(ns,'g'); g.id=`sl-${lk.id}`; g.setAttribute('class','sl-link');
  if(faded){ g.setAttribute('opacity','0.25'); g.style.pointerEvents='none'; }
  const mkLine=attrs=>{ const l=document.createElementNS(ns,'line');
    l.setAttribute('x1',x1); l.setAttribute('y1',y1); l.setAttribute('x2',x2); l.setAttribute('y2',y2);
    Object.entries(attrs).forEach(([k,v])=>l.setAttribute(k,v)); return l; };
  g.appendChild(mkLine({stroke:'transparent','stroke-width':'12'})); // wide, invisible click target
  // Selection halo. Not the #glow filter: a filter on a perfectly horizontal or vertical line has
  // a zero-height/width bounding box, so its filter region is empty and the line disappears.
  g.appendChild(mkLine({class:'sl-halo',stroke:valid?'var(--orange)':'var(--red)','stroke-width':'9','stroke-linecap':'round',opacity:sel?'0.28':'0'}));
  const vis=mkLine({class:'sl-vis',stroke:valid?'var(--orange)':'var(--red)','stroke-width':sel?'3':'2',
    'stroke-dasharray':valid?'1 5':'4 3','stroke-linecap':'round'});
  if(valid){ vis.setAttribute('marker-end','url(#arr-xfer)'); if(lk.two_way) vis.setAttribute('marker-start','url(#arr-xfer)'); }
  g.appendChild(vis);
  const maxT=parseFloat(lk.max_rate_tpd)||0;
  if(maxT>0||!valid){
    const t=document.createElementNS(ns,'text');
    t.setAttribute('x',(x1+x2)/2); t.setAttribute('y',(y1+y2)/2-5); t.setAttribute('text-anchor','middle');
    t.setAttribute('font-family','Space Mono,monospace'); t.setAttribute('font-size','7'); t.setAttribute('pointer-events','none');
    t.setAttribute('fill',valid?'var(--orange)':'var(--red)');
    t.textContent=valid?`max ${Math.round(maxT).toLocaleString()} t/d`:'materials differ';
    g.appendChild(t);
  }
  const pname=DB.products.find(p=>p.id===lk.product_id)?.name||lk.product_id||'?';
  const tip=document.createElementNS(ns,'title');
  tip.textContent=`Silo transfer · ${a.name} ${lk.two_way?'⇄':'→'} ${b.name} · ${pname} · ${lk.two_way?'two way':'one way'}${maxT>0?` · max ${Math.round(maxT).toLocaleString()} t/day`:''}`
    +(valid?'':' · ⚠ the two silos no longer hold the same material, so the simulation ignores this link')+' — click to edit';
  g.appendChild(tip);
  g.addEventListener('mousedown',e=>{ if(e.button===0&&S.tool!=='pan'&&!S._space) e.stopPropagation(); });
  g.addEventListener('click',e=>{ e.stopPropagation(); onSiloLinkClick(lk.id); });
  layer.appendChild(g);
}
function onSiloLinkClick(id){
  if(S.slPick) return;
  if(S.tool==='delete'){ deleteSiloLink(id); return; }
  selectSiloLink(id);
}
function selectSiloLink(id){
  if(!_slLink(id)) return;
  deselect(); S.selectedLink=id; _slPaintSelection(); renderSiloLinkProps(id);
}
// Restyle the selection without redrawing.
function _slPaintSelection(){
  (DB.silo_links||[]).forEach(lk=>{
    const g=document.getElementById(`sl-${lk.id}`); if(!g) return;
    const sel=S.selectedLink===lk.id;
    g.querySelector('.sl-vis')?.setAttribute('stroke-width',sel?'3':'2');
    g.querySelector('.sl-halo')?.setAttribute('opacity',sel?'0.28':'0');
  });
}
function deleteSiloLink(id){
  const lk=_slLink(id); if(!lk) return;
  const nP=(DB.silo_transfer_plans||[]).filter(p=>p.link_id===id).length;
  const nR=(DB.real_silo_transfers_daily||[]).filter(t=>t.link_id===id).length;
  const extra=[nP?`${nP} plan${nP>1?'s':''}`:'',nR?`${nR} actual record${nR>1?'s':''}`:''].filter(Boolean).join(' and ');
  if(!confirm(`Delete the silo transfer ${_slName(lk)}${extra?` and its ${extra}`:''}?\nThis cannot be undone.`)) return;
  _slDropLinks(new Set([id]));
  deselect(); redrawConns(); autoSave();
  if(nP||nR) scheduleSimulation();
  if(S.view==='schedules') renderSiloXferRegister();
}

// ── Properties panel (right side, like an element's) ────────────────────────
function renderSiloLinkProps(id){
  const lk=_slLink(id); if(!lk) return;
  const a=getEl(lk.from_silo_id), b=getEl(lk.to_silo_id);
  document.getElementById('props-type-lbl').textContent='Silo Transfer';
  const shared=_slShared(a,b);
  const pids=(shared.includes(lk.product_id)?shared:[lk.product_id,...shared]).filter(Boolean);
  const pOpts=pids.map(pid=>`<option value="${pid}" ${pid===lk.product_id?'selected':''}>${esc(DB.products.find(p=>p.id===pid)?.name||pid)}</option>`).join('');
  const nP=(DB.silo_transfer_plans||[]).filter(p=>p.link_id===id).length;
  const nR=(DB.real_silo_transfers_daily||[]).filter(t=>t.link_id===id).length;
  const siloLine=el=>el?`${esc(el.name)}${_elFacName(el)?`<span style="color:var(--text-dim)"> · ${esc(_elFacName(el))}</span>`:''}`:'<span style="color:var(--red)">missing</span>';
  const btn=on=>`flex:1;padding:6px 4px;font-family:var(--mono);font-size:9px;border:1px solid ${on?'var(--orange)':'var(--border2)'};background:${on?'rgba(var(--orange-rgb),.14)':'transparent'};color:${on?'var(--orange)':'var(--text-dim)'};cursor:pointer;border-radius:2px`;
  const fs=_slShort(lk.from_silo_id), ts=_slShort(lk.to_silo_id);
  document.getElementById('props-body').innerHTML=`
  <div class="pg"><div class="pg-title">Identity</div>
    <div class="pf"><div class="pl">Name</div><input class="pi" value="${esc(lk.name||'')}" placeholder="${esc(_slDefaultName(lk))}" onchange="_slSetProp('${id}','name',this.value)"></div>
    <div class="pf"><div class="pl">Origin silo</div><div style="font-size:9px;padding:3px 0;color:var(--text)">${siloLine(a)}</div></div>
    <div class="pf"><div class="pl">Destination silo</div><div style="font-size:9px;padding:3px 0;color:var(--text)">${siloLine(b)}</div></div>
    ${_slValid(lk)?'':`<div class="fhint" style="color:var(--red);padding:0 10px 6px">⚠ These silos no longer hold the same material, so the simulation ignores this link. Change a silo's product or delete the link.</div>`}
  </div>
  <div class="pg"><div class="pg-title">Transfer</div>
    <div class="pf"><div class="pl">Material</div><select class="pi" onchange="_slSetProp('${id}','product_id',this.value)" ${pids.length<2?'disabled':''}>${pOpts}</select></div>
    <div class="pf"><div class="pl">Direction</div>
      <div style="display:flex;gap:4px;margin-top:2px">
        <button type="button" style="${btn(!lk.two_way)}" onclick="_slSetProp('${id}','two_way',false)">→ One way</button>
        <button type="button" style="${btn(!!lk.two_way)}" onclick="_slSetProp('${id}','two_way',true)">⇄ Two way</button>
      </div>
      <div class="fhint">${lk.two_way?`Two lines on the Production page: ${esc(fs)} → ${esc(ts)} and ${esc(ts)} → ${esc(fs)}.`:`One line on the Production page: ${esc(fs)} → ${esc(ts)}.`}</div>
      ${lk.two_way?'':`<button type="button" class="btn-sec" style="margin-top:6px;width:100%" onclick="_slSwap('${id}')">⇅ Swap origin and destination</button>`}
    </div>
    <div class="pf"><div class="pl">Max transfer rate (t/day) — optional</div>
      <input class="pi" type="number" min="0" value="${lk.max_rate_tpd??''}" placeholder="no limit" onchange="_slSetProp('${id}','max_rate_tpd',this.value)">
      <div class="fhint">Only used to warn when a plan asks for more. The simulation never moves material on its own.</div></div>
  </div>
  <div class="pg"><div class="pg-title">Plans and actuals</div>
    <div style="font-size:9px;color:var(--text-dim);line-height:1.6;padding:0 10px 8px">${nP} plan${nP===1?'':'s'} · ${nR} actual record${nR===1?'':'s'}.<br>On the Production page (${_slFamLabel([lk.product_id])} section), click a day to plan a campaign or record an actual, and drag a campaign's ends to change its duration.</div>
    <div style="padding:0 10px 8px"><button type="button" class="btn-sec" style="width:100%" onclick="slOpenOnSupply('${id}')">Open on the Production page →</button></div>
  </div>
  <div style="padding:0 10px 10px"><button class="btn-sec" style="width:100%;color:var(--red);border-color:rgba(var(--red-rgb),.5)" onclick="deleteSiloLink('${id}')">🗑 Delete link</button></div>`;
}
function _slSetProp(id,k,v){
  const lk=_slLink(id); if(!lk) return;
  if(k==='two_way'){
    v=!!v; if(!!lk.two_way===v) return;
    if(!v){ const n=_slDirCount(lk.id,lk.to_silo_id,lk.from_silo_id);
      if(n&&!confirm(`${n} plan/actual record${n>1?'s':''} for ${_slShort(lk.to_silo_id)} → ${_slShort(lk.from_silo_id)} will be ignored while the link is one way. They are kept and come back if you switch to two way. Continue?`)){ renderSiloLinkProps(id); return; } }
  }
  if(k==='max_rate_tpd'){ const n=parseFloat(v); v=n>0?n:null; }
  if(k==='name') v=String(v||'').trim();
  lk[k]=v;
  autoSave(); redrawConns(); renderSiloLinkProps(id);
  if(k==='two_way'||k==='product_id') scheduleSimulation();
}
function _slSwap(id){
  const lk=_slLink(id); if(!lk) return;
  const n=_slDirCount(lk.id,lk.from_silo_id,lk.to_silo_id);
  if(n){ alert(`${n} plan/actual record${n>1?'s':''} already use ${_slShort(lk.from_silo_id)} → ${_slShort(lk.to_silo_id)}. Make the link two way instead, so both directions stay available.`); return; }
  const f=lk.from_silo_id; lk.from_silo_id=lk.to_silo_id; lk.to_silo_id=f;
  autoSave(); redrawConns(); renderSiloLinkProps(id);
}
// Jump to the link's rows on the Production (Supply) page, opening the section and facilities.
function slOpenOnSupply(id){
  const lk=_slLink(id); if(!lk) return;
  if(!window._supSecCol) window._supSecCol=new Set();
  window._supSecCol.delete(_slSecKey(lk));
  if(window._supGrpCol) [lk.from_silo_id,lk.to_silo_id].forEach(sid=>{ const f=_elFac(getEl(sid)); if(f) window._supGrpCol.delete(f); });
  switchTopSection('production');
  setTimeout(()=>{
    const tr=document.querySelector(`#supply-table-wrap tr[data-sl="${id}"]`);
    if(!tr){ statMsg('Transfer rows not visible — check the Production page filters'); return; }
    tr.scrollIntoView({block:'center'});
    tr.style.outline='1px solid var(--orange)'; setTimeout(()=>{ tr.style.outline=''; },1800);
  },400);
}

// ── Campaign popup (click a day on a transfer row) ─────────────────────────
// The same popup as the finish mills' (showCampaignPopup): 📈 Forecast Campaign = a date range
// at a t/day rate (overlapping campaigns of this link + direction are trimmed, not deleted —
// _campSplice), ✅ Real Data = the tonnes actually moved on one day. On the Supply Gantt a
// campaign's start / end can also be dragged (store 'xfer' in _CAMP_STORES).
function showSiloXferPopup(linkId,from,to,ds){
  const lk=_slLink(linkId); if(!lk) return;
  const real=_slRealT(linkId,from,to,ds);
  const pr=_slPlanRow(linkId,from,to,ds);
  const maxT=parseFloat(lk.max_rate_tpd)||0;
  window._sxCtx={linkId,from,to,ds,real,camp:pr};
  window._sxRealAck=false; window._sxOverAck=false;
  const defaultMode=real!=null?'real':'forecast';
  const pname=DB.products.find(p=>p.id===lk.product_id)?.name||lk.product_id||'';
  const delSty='padding:5px 10px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid rgba(var(--red-rgb),.5);color:var(--red);cursor:pointer;border-radius:2px';
  const html=`
  <div style="font-family:var(--mono);font-size:9px;min-width:320px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div>
        <div id="sx-title" style="font-size:11px;font-weight:700;color:${pr?'var(--lime)':'var(--text)'}">${pr?'🔒 Edit Campaign':'+ New Campaign'}</div>
        <div style="color:var(--text-dim);margin-top:2px">${esc(_slName(lk))} · ${ds}</div>
      </div>
      <button onclick="closeCampaignPopup()" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:16px">✕</button>
    </div>

    <!-- Forecast vs Real toggle -->
    <div style="display:flex;gap:0;margin-bottom:12px;border:1px solid var(--border2);border-radius:3px;overflow:hidden">
      <button type="button" id="sx-mode-forecast" onclick="_sxSetMode('forecast')" style="flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer">📈 Forecast Campaign</button>
      <button type="button" id="sx-mode-real" onclick="_sxSetMode('real')" style="flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer">✅ Real Data</button>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="fr s1">
        <div class="ff">
          <div class="fl">Transfer</div>
          <div class="fi" style="width:100%;opacity:.85;cursor:default">${esc(_slShort(from))} → ${esc(_slShort(to))} · ${esc(pname)}</div>
        </div>
      </div>
      <div class="fr s2">
        <div class="ff">
          <div class="fl" id="sx-rate-label">Rate (t/d)</div>
          <input class="fi" id="sx-rate" type="number" min="0" step="10" style="width:100%" oninput="window._sxOverAck=false">
        </div>
        <div id="sx-rate-hint" style="font-size:8px;color:var(--text-dim);align-self:flex-end;padding-bottom:6px">${maxT>0?`max ${Math.round(maxT).toLocaleString()} t/d`:'no max rate set'}</div>
      </div>
      <div class="fr s2">
        <div class="ff">
          <div class="fl" id="sx-from-label">From</div>
          <input class="fi" id="sx-from" type="date" onchange="window._sxRealAck=false" style="width:100%">
        </div>
        <div class="ff" id="sx-to-field">
          <div class="fl">To</div>
          <input class="fi" id="sx-to" type="date" onchange="window._sxRealAck=false" style="width:100%">
        </div>
      </div>
    </div>
    <div id="sx-warn" style="display:none;margin-top:10px;padding:6px 8px;border-left:3px solid var(--amber);background:rgba(var(--amber-rgb),.08);color:var(--amber);font-size:9px;line-height:1.5"></div>

    <div style="margin-top:12px;display:flex;gap:8px;justify-content:space-between;align-items:center">
      <div style="display:flex;gap:6px">
        <span id="sx-del-wrap">${pr?`<button onclick="_sxDeletePlan('${pr.id}')" style="${delSty}">✕ Delete Campaign</button>`:''}</span>
        <span id="sx-clear-real-wrap" style="display:none">${real!=null?`<button onclick="_sxClearReal()" style="${delSty}">✕ Clear Real Value</button>`:''}</span>
        <button onclick="closeCampaignPopup();switchView('topology');setTimeout(()=>selectSiloLink('${lk.id}'),60)" title="Show this link on the topology (direction, max rate, material)"
          style="padding:5px 10px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--orange);color:var(--orange);cursor:pointer;border-radius:2px">┄ Topology</button>
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="closeCampaignPopup()" style="padding:5px 12px;font-family:var(--mono);font-size:9px;background:transparent;border:1px solid var(--border2);color:var(--text-dim);cursor:pointer;border-radius:2px">Cancel</button>
        <button id="sx-apply-btn" onclick="applySiloXferPopup()" style="padding:5px 14px;font-family:var(--mono);font-size:9px;background:var(--lime);border:none;color:var(--on-lime);cursor:pointer;font-weight:700;border-radius:2px">🔒 Apply Campaign</button>
      </div>
    </div>
  </div>`;
  let ov=document.getElementById('camp-overlay');
  if(!ov){
    ov=document.createElement('div'); ov.id='camp-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:20000;display:flex;align-items:center;justify-content:center';
    ov.onclick=e=>{ if(e.target===ov) closeCampaignPopup(); };
    document.body.appendChild(ov);
  }
  ov.innerHTML=`<div style="background:var(--surface);border:1px solid var(--lime);padding:18px;border-radius:6px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.6)">${html}</div>`;
  ov.style.display='flex';
  _sxSetMode(defaultMode);
}
// Forecast (date-range campaign) vs Real (one day's actual) — styled like _campSetMode.
function _sxSetMode(mode){
  const c=window._sxCtx; if(!c) return;
  window._sxMode=mode; window._sxOverAck=false; window._sxRealAck=false;
  const real=mode==='real';
  const onSty='background:var(--lime);color:var(--on-lime);font-weight:700', offSty='background:transparent;color:var(--text-dim);font-weight:400';
  const base='flex:1;padding:6px 8px;font-family:var(--mono);font-size:9px;border:none;cursor:pointer;';
  document.getElementById('sx-mode-forecast').style.cssText=base+(real?offSty:onSty);
  document.getElementById('sx-mode-real').style.cssText=base+(real?onSty:offSty);
  document.getElementById('sx-to-field').style.display=real?'none':'';
  document.getElementById('sx-from-label').textContent=real?'Date':'From';
  document.getElementById('sx-rate-label').textContent=real?'Actual moved (t)':'Rate (t/d)';
  document.getElementById('sx-rate-hint').style.display=real?'none':'';
  document.getElementById('sx-title').textContent=real?'✅ Real Transfer':(c.camp?'🔒 Edit Campaign':'+ New Campaign');
  // From = the clicked day (not the campaign's first day — same reason as showCampaignPopup);
  // To = the end of the campaign covering it.
  document.getElementById('sx-from').value=c.ds;
  document.getElementById('sx-to').value=(!real&&c.camp)?c.camp.end_date:c.ds;
  document.getElementById('sx-rate').value=real?(c.real??''):(c.camp?(parseFloat(c.camp.rate_tpd)||0):'');
  const ap=document.getElementById('sx-apply-btn');
  ap.textContent=real?'✅ Save Real Value':'🔒 Apply Campaign';
  ap.style.background=real?'var(--royal)':'var(--lime)'; ap.style.color=real?'var(--on-blue)':'var(--on-lime)';
  document.getElementById('sx-del-wrap').style.display=real?'none':'';
  document.getElementById('sx-clear-real-wrap').style.display=real?'':'none';
  const w=document.getElementById('sx-warn'); if(w) w.style.display='none';
}
function applySiloXferPopup(){
  const c=window._sxCtx; const lk=c&&_slLink(c.linkId); if(!lk) return;
  const raw=(document.getElementById('sx-rate')?.value||'').replace(/,/g,'').trim();
  const t=parseFloat(raw);
  const from=document.getElementById('sx-from')?.value, to=document.getElementById('sx-to')?.value;
  if(window._sxMode==='real'){
    if(raw===''||!(t>=0)||!from){ _campWarn('Please enter the tonnes moved and the date','sx'); return; }
    _slSetReal(lk,c.from,c.to,from,t);
    closeCampaignPopup(); autoSave(); _slRefreshViews();
    statMsg('Real transfer saved — running simulation…'); scheduleSimulation();
    return;
  }
  if(raw===''||!(t>=0)||!from||!to){ _campWarn('Please fill all fields','sx'); return; }
  if(from>to){ _campWarn('“From” must be on or before “To”','sx'); return; }
  // A recorded actual always wins over a campaign, so on those days the campaign is saved but
  // never used. Say so once; a second click on Apply saves anyway (as for production).
  if(!window._sxRealAck){
    const realDays=[...new Set((DB.real_silo_transfers_daily||[]).filter(x=>x.link_id===lk.id&&x.from_silo_id===c.from&&x.to_silo_id===c.to&&x.date>=from&&x.date<=to).map(x=>x.date))].sort();
    if(realDays.length){ window._sxRealAck=true;
      _campWarn(`${realDays.length===1?realDays[0]+' already has':realDays.length+' days in this range ('+realDays[0]+' → '+realDays[realDays.length-1]+') already have'} a recorded transfer. Real data wins, so the campaign won't apply there. Click Apply again to save anyway, or move “From”.`,'sx'); return; }
  }
  const maxT=parseFloat(lk.max_rate_tpd)||0;
  if(maxT>0&&t>maxT&&!window._sxOverAck){ window._sxOverAck=true;
    _campWarn(`${Math.round(t).toLocaleString()} t/d is above this link's max of ${Math.round(maxT).toLocaleString()} t/d. Click Apply again to keep it.`,'sx'); return; }
  // Overlapping campaigns of this link + direction are TRIMMED to make room, not deleted.
  DB.silo_transfer_plans=_campSplice(DB.silo_transfer_plans||[],_CAMP_STORES.xfer.same({link_id:lk.id,from_silo_id:c.from,to_silo_id:c.to}),from,to);
  DB.silo_transfer_plans.push({id:'stp_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),link_id:lk.id,from_silo_id:c.from,to_silo_id:c.to,start_date:from,end_date:to,rate_tpd:t,notes:''});
  closeCampaignPopup(); autoSave(); _slRefreshViews();
  statMsg('Campaign saved — running simulation…'); scheduleSimulation();
}
function _sxDeletePlan(planId){
  DB.silo_transfer_plans=(DB.silo_transfer_plans||[]).filter(p=>p.id!==planId);
  closeCampaignPopup(); autoSave(); _slRefreshViews();
  statMsg('Campaign deleted — running simulation…'); scheduleSimulation();
}
function _sxClearReal(){
  const c=window._sxCtx; const lk=c&&_slLink(c.linkId); if(!lk) return;
  if(!confirm(`Clear the real transfer for ${c.ds}?\nThe campaign (if any) applies to this day again.`)) return;
  _slSetReal(lk,c.from,c.to,c.ds,null);
  closeCampaignPopup(); autoSave(); _slRefreshViews();
  statMsg('Real transfer cleared — running simulation…'); scheduleSimulation();
}
function _slRefreshViews(){
  if(S.view==='schedules') renderSiloXferRegister(); else renderSupplyView();
}

// ── Logistics › Silo Transfers: register of every link with its plans ─────────
function renderSiloXferRegister(){
  const box=document.getElementById('silo-xfer-register'); if(!box) return;
  const links=(DB.silo_links||[]).slice().sort((a,b)=>_slName(a).localeCompare(_slName(b)));
  if(!links.length){
    box.innerHTML=`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding:24px;text-align:center;line-height:1.8">No silo transfers yet.<br>On the topology, drag <span style="color:var(--orange)">┄ Silo Transfer</span> (Movement) onto a silo, then click the silo that receives the material.</div>`;
    return;
  }
  const pn=pid=>esc(DB.products.find(p=>p.id===pid)?.name||pid||'?');
  const silo=id=>{ const el=getEl(id); return el?`${esc(_slShort(id))}<span style="color:var(--text-dim)"> · ${esc(_elFacName(el)||'')}</span>`:'<span style="color:var(--red)">missing</span>'; };
  let h=`<table class="sched-table"><thead><tr><th>Transfer</th><th>Origin</th><th>Destination</th><th>Material</th><th>Direction</th><th>Max (t/d)</th><th>Plans</th><th>Last actual</th><th></th></tr></thead><tbody>`;
  links.forEach(lk=>{
    const plans=(DB.silo_transfer_plans||[]).filter(p=>p.link_id===lk.id).sort((a,b)=>(a.start_date||'').localeCompare(b.start_date||''));
    const reals=(DB.real_silo_transfers_daily||[]).filter(t=>t.link_id===lk.id).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    const last=reals[0];
    const ok=_slValid(lk);
    h+=`<tr>
      <td style="color:var(--orange)">┄ ${esc(_slName(lk))}${ok?'':' <span style="color:var(--red)" title="The silos no longer hold the same material — ignored by the simulation">⚠</span>'}</td>
      <td>${silo(lk.from_silo_id)}</td><td>${silo(lk.to_silo_id)}</td><td>${pn(lk.product_id)}</td>
      <td>${lk.two_way?'⇄ two way':'→ one way'}</td><td>${lk.max_rate_tpd>0?Math.round(lk.max_rate_tpd).toLocaleString():'—'}</td>
      <td>${plans.length}</td>
      <td>${last?`${esc(last.date)} · ${Math.round(parseFloat(last.volume_t)||0).toLocaleString()} t ${esc(_slShort(last.from_silo_id))}→${esc(_slShort(last.to_silo_id))}`:'—'}</td>
      <td style="white-space:nowrap"><span class="tbl-act" onclick="switchView('topology');setTimeout(()=>selectSiloLink('${lk.id}'),60)">Topology</span>
        <span class="tbl-act" onclick="slOpenOnSupply('${lk.id}')">Production</span>
        <span class="tbl-act del" onclick="deleteSiloLink('${lk.id}')">Del</span></td></tr>`;
    plans.forEach(p=>{
      const hidden=!_slDirs(lk).some(d=>d.from===p.from_silo_id&&d.to===p.to_silo_id);
      h+=`<tr style="color:var(--text-dim)${hidden?';opacity:.5':''}"><td style="padding-left:22px">↳ ${esc(_slShort(p.from_silo_id))} → ${esc(_slShort(p.to_silo_id))}${hidden?' (ignored while one way)':''}</td>
        <td colspan="5">${esc(p.start_date)}${p.end_date!==p.start_date?` → ${esc(p.end_date)}`:''} · ${Math.round(parseFloat(p.rate_tpd)||0).toLocaleString()} t/day${p.notes?` · ${esc(p.notes)}`:''}</td>
        <td colspan="2"></td><td><span class="tbl-act del" onclick="DB.silo_transfer_plans=DB.silo_transfer_plans.filter(x=>x.id!=='${p.id}');autoSave();renderSiloXferRegister();scheduleSimulation()">Del</span></td></tr>`;
    });
  });
  box.innerHTML=h+`</tbody></table>`;
}

