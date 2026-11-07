// ═══════════════════════════════════════════════════════
// SALES PERFORMANCE
// ═══════════════════════════════════════════════════════

// ── STATE — single source of truth ──────────────────
const SP = {
  f: { dateFrom:'', dateTo:'', origin:'ALL', rep:'ALL', customer:'ALL', custType:'all', product:'ALL' },
  filteredRows:  [],
  scopedRows:    [],
  chartRange:   '90',
  chartInst:    null,
  selScope:     null,
  collapsed:    {},
  horizon:      'short',
  fpEntries:    [],
  _repOptions:  [],
  _custOptions: [],
  _prodOptions: [],
  _userExpanded: {},  // tracks keys the user has explicitly expanded
  fcRepSel:{}, fcCustSel:{}, fcCustomVal:{}, fcShowInp:{},
  basisByRow: {},
  defaultBasis: 'all10d',
  collapsedMonths: null,  // Set of YYYY-MM strings; null = auto-initialised on first render
  _demIdx: null,          // cached demand index; cleared by _demandCacheInvalidate
  _tree:   null,          // cached org tree; cleared when filteredRows change
  _spine:  null,          // cached date spine; cleared when date range changes
};

// Minimum overlap: if neither matches fully, report what's missing

// ── PRODUCT COLOR PALETTE ────────────────────────────
const SP_PROD_COLORS = [
  'rgba(77,166,255,0.78)','rgba(0,255,157,0.62)','rgba(255,184,48,0.72)',
  'rgba(204,122,255,0.72)','rgba(255,80,120,0.70)','rgba(80,210,180,0.70)',
  'rgba(255,140,66,0.72)','rgba(140,180,255,0.70)','rgba(255,220,60,0.70)',
  'rgba(100,200,100,0.70)','rgba(200,100,160,0.70)','rgba(60,180,220,0.70)',
];
const SP_PROD_COLORS_SOLID = [
  '#4da6ff','#00ff9d','#ffb830','#cc7aff','#ff5078','#50d2b4',
  '#ff8c42','#8cb4ff','#ffdc3c','#64c864','#c864a0','#3cb4dc',
];
// Deep variant of SP_PROD_COLORS_SOLID, index for index (a light theme's --rule-prod:deep).
const SP_PROD_DEEP = ['#6d28d9','#1d4ed8','#9a3412','#0f766e','#be185d','#a16207','#4338ca','#b91c1c','#0e7490','#15803d','#7c2d12','#86198f'];
// Map product string → stable color index
const _spProdColorMap = {};
function spProdColor(prod, alpha){
  if(!(_spProdColorMap[prod]>=0)){
    _spProdColorMap[prod] = Object.keys(_spProdColorMap).length % SP_PROD_COLORS.length;
  }
  const i=_spProdColorMap[prod];
  if(_thRule('prod')==='one'){   // every product bar in the real-number colour
    const c=_thHex(_tcVar('real')), m=/^#([0-9a-f]{6})$/.exec(c); if(!m) return 'var(--real)'; if(!alpha) return c;
    const n=parseInt(m[1],16), a=(SP_PROD_COLORS[i].split(',')[3]||'0.72)').replace(')','').trim();
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
  }
  if(_thRule('prod')==='deep'){   // deep product colours (light themes): never the same as a data colour
    const c=SP_PROD_DEEP[i%SP_PROD_DEEP.length]; if(!alpha) return c;
    const n=parseInt(c.slice(1),16), a=(SP_PROD_COLORS[i].split(',')[3]||'0.72)').replace(')','').trim();
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
  }
  return _tc(alpha ? SP_PROD_COLORS[i] : SP_PROD_COLORS_SOLID[i]);
}

// ── Initialize forecast basis buttons ────
function spInitForecastBasis(){
  // Initialize any state needed for forecast basis button styling
  // Currently a placeholder - buttons are styled inline in spRenderTable()
}

// ── ENTRY POINT ──────────────────────────────────────
function renderSalesPerfView(){
  const hasData = DB.real_shipments_daily.length > 0;
  document.getElementById('sp-upload-zone').style.display = hasData ? 'none' : 'block';
  const content = document.getElementById('sp-content');
  content.style.display = hasData ? 'flex' : 'none';
  content.style.flexDirection = 'column';
  content.style.gap = '14px';
  if(!hasData) return;

  const m = DB.real_shipments_meta;
  document.getElementById('sp-meta-lbl').textContent =
    `${Number(m.row_count||0).toLocaleString()} records · ${m.date_min||'?'} → ${m.date_max||'?'} · loaded ${m.loaded_at||'?'}`;

  // Set date range: actuals start → simulation end so forecast future is always visible.
  // Always recompute simEnd so reloading data or changing simulation horizon extends the window.
  const simEnd = S.simCfg.start_date
    ? _addDays(S.simCfg.start_date,(S.simCfg.horizon||365)-1)   // last simulated day, by calendar
    : `${new Date().getFullYear()+1}-12-31`;
  if(m.date_min && !SP.f.dateFrom) SP.f.dateFrom = m.date_min;
  // Extend dateTo to whichever is furthest: current user setting, data max, or sim end
  const candidates=[SP.f.dateTo, m.date_max, simEnd].filter(Boolean);
  SP.f.dateTo = candidates.reduce((a,b)=>a>b?a:b);

  spRebuildCascade();   // build all dropdowns from current state
  spSyncFilterUI();     // push state → UI elements
  spInitForecastBasis(); // init forecast basis button styling
  // Filtering + drawing the KPIs, chart and the (very large) table only matters while this page
  // is on screen — opening it (switchView) always calls this function again. Forecast Builder
  // applies and sales-data loads used to redraw it while hidden, which on a long sales history
  // froze the app for many seconds for a page nobody was looking at. (Nothing outside this page
  // reads the SP.* results.)
  if(S.view!=='salesperf') return;
  spApplyFilters();     // compute filteredRows → render everything
}

// ══════════════════════════════════════════════════════
// CASCADING FILTER SYSTEM
// ══════════════════════════════════════════════════════

// Called whenever a filter changes — the unidirectional pipeline entry point.
// Order: origin → rep → customer → render dropdowns → filter rows → chart + table
function spDispatch(changes){
  Object.assign(SP.f, changes);

  // Cascade: narrower selections reset when a broader filter changes
  if('origin'   in changes){ SP.f.rep='ALL'; SP.f.customer='ALL'; SP.f.product='ALL'; }
  if('rep'      in changes && !('origin' in changes)){ SP.f.customer='ALL'; SP.f.product='ALL'; }
  if('customer' in changes && !('rep' in changes) && !('origin' in changes)){ SP.f.product='ALL'; }
  if('custType' in changes){ SP.f.product='ALL'; }

  // Clear table scope and user expansion state when filters change
  SP.selScope = null;
  SP.scopedRows = [];
  SP.collapsed = {};
  SP._userExpanded = {};
  SP.fcShowInp = {};

  spRebuildCascade();
  spSyncFilterUI();
  spApplyFilters();
}

// Compute which reps are available for the current origin,
// and which customers are available for the current rep.
function spRebuildCascade(){
  const all = DB.real_shipments_daily;

  // Level 2: reps available given current origin
  const repPool = SP.f.origin === 'ALL' ? all : all.filter(r=>r.origin===SP.f.origin);
  SP._repOptions = ['ALL', ...[...new Set(repPool.map(r=>r.sales_manager||'—'))].sort()];

  // Level 3: customers available given current origin+rep+custType
  const custPool = repPool.filter(r=>(SP.f.rep==='ALL'||r.sales_manager===SP.f.rep)&&(SP.f.custType==='all'||r.customer_type===SP.f.custType));
  SP._custOptions = ['ALL', ...[...new Set(custPool.map(r=>r.ship_to_name||String(r.ship_to||'')))].sort()];

  // Level 4: products available given origin+rep+customer+custType
  const prodPool = custPool.filter(r=>SP.f.customer==='ALL'||r.ship_to_name===SP.f.customer);
  SP._prodOptions = ['ALL', ...[...new Set(prodPool.map(r=>r.product||''))].filter(Boolean).sort()];

  // If current selections are no longer valid, reset them
  if(!SP._repOptions.includes(SP.f.rep))     SP.f.rep='ALL';
  if(!SP._custOptions.includes(SP.f.customer)) SP.f.customer='ALL';
  if(!SP._prodOptions.includes(SP.f.product))  SP.f.product='ALL';

  spRenderOriginChips();
  spRenderRepDropdown();
  spRenderCustDropdown();
  spRenderProdDropdown();
}

// Push current SP.f state into the DOM filter elements
function spSyncFilterUI(){
  const df = document.getElementById('sp-date-from');
  const dt = document.getElementById('sp-date-to');
  if(df && !df.value) df.value = SP.f.dateFrom;
  if(dt && !dt.value) dt.value = SP.f.dateTo;

  // Customer type chips
  ['all','EXT','INT'].forEach(t=>{
    const el=document.getElementById(`sp-type-${t==='all'?'all':t.toLowerCase()}`);
    if(el) el.classList.toggle('active', SP.f.custType===t);
  });
  // Reset date inputs if SP.f has values
  const df2=document.getElementById('sp-date-from');
  const dt2=document.getElementById('sp-date-to');
  if(df2 && SP.f.dateFrom) df2.value=SP.f.dateFrom;
  if(dt2 && SP.f.dateTo)   dt2.value=SP.f.dateTo;
}

// ── ORIGIN CHIPS — only show origins present in current data ─────────────
function spRenderOriginChips(){
  const wrap = document.getElementById('sp-origin-chips'); if(!wrap) return;
  // Compute which origins are reachable given other active filters
  const pool = DB.real_shipments_daily.filter(r=>{
    if(SP.f.rep     !=='ALL' && (r.sales_manager||'—') !==SP.f.rep)     return false;
    if(SP.f.customer!=='ALL' && r.ship_to_name         !==SP.f.customer)return false;
    if(SP.f.custType!=='all' && r.customer_type        !==SP.f.custType)return false;
    if(SP.f.product !=='ALL' && (r.product||'')        !==SP.f.product) return false;
    return true;
  });
  const available = new Set(pool.map(r=>r.origin));
  const allOrigins = DB.real_shipments_meta.origins||[];
  // Build chips using data attributes — no inline JS quoting issues
  wrap.innerHTML = ['ALL',...allOrigins].map(o=>{
    const active  = SP.f.origin===o;
    const disabled= o!=='ALL' && !available.has(o);
    return '<div class="sp-chip'+(active?' active':'')+(disabled?' sp-chip-disabled':'')+'"'+
      ' data-origin="'+o+'"'+
      (disabled?' style="opacity:.35;cursor:default"':'')+'>'+o+'</div>';
  }).join('');
  // Single delegated listener — replace each time we rebuild
  wrap.onclick=function(e){
    const chip=e.target.closest('[data-origin]');
    if(!chip||chip.classList.contains('sp-chip-disabled')) return;
    spDispatch({origin:chip.dataset.origin});
  };
}

// ── REP DROPDOWN ──────────────────────────────────────
function spRenderRepDropdown(){
  const sel = document.getElementById('sp-rep-sel'); if(!sel) return;
  sel.innerHTML = SP._repOptions.map(r=>{
    const disp = r==='ALL'?'All Reps':r;
    return `<option value="${r}" ${SP.f.rep===r?'selected':''}>${disp}</option>`;
  }).join('');
}

// ── CUSTOMER DROPDOWN ─────────────────────────────────
function spRenderCustDropdown(){
  const sel = document.getElementById('sp-cust-sel'); if(!sel) return;
  sel.innerHTML = SP._custOptions.map(c=>{
    const disp = c==='ALL'?'All Customers':c;
    return `<option value="${encodeURIComponent(c)}" ${SP.f.customer===c?'selected':''}>${disp}</option>`;
  }).join('');
}

// ── PRODUCT DROPDOWN ──────────────────────────────────
function spRenderProdDropdown(){
  const sel = document.getElementById('sp-prod-sel'); if(!sel) return;
  sel.innerHTML = SP._prodOptions.map(p=>{
    const disp = p==='ALL'?'All Products':spShortProd(p);
    return `<option value="${encodeURIComponent(p)}" title="${p}" ${SP.f.product===p?'selected':''}>${disp}</option>`;
  }).join('');
}

// ── FILTER APPLICATION ────────────────────────────────
// Reads SP.f, computes SP.filteredRows, then renders downstream
function spApplyFilters(){
  const df = document.getElementById('sp-date-from')?.value || SP.f.dateFrom;
  const dt = document.getElementById('sp-date-to')?.value   || SP.f.dateTo;
  SP.f.dateFrom = df;
  SP.f.dateTo   = dt;

  SP.filteredRows = DB.real_shipments_daily.filter(r=>{
    if(df && r.date < df) return false;
    if(dt && r.date > dt) return false;
    if(SP.f.origin  !== 'ALL' && r.origin                !== SP.f.origin)   return false;
    if(SP.f.rep     !== 'ALL' && (r.sales_manager||'—')  !== SP.f.rep)      return false;
    if(SP.f.customer!== 'ALL' && r.ship_to_name          !== SP.f.customer) return false;
    if(SP.f.custType!== 'all' && r.customer_type         !== SP.f.custType) return false;
    if(SP.f.product !== 'ALL' && (r.product||'')         !== SP.f.product)  return false;
    return true;
  });

  // Filters changed — invalidate tree (depends on filteredRows) and spine (date range may differ)
  SP._tree  = null;
  SP._spine = null;

  // Scoped rows = filteredRows narrowed to selected table scope (if any)
  SP.scopedRows = SP.selScope ? spGetScopeRows(SP.filteredRows, SP.selScope) : SP.filteredRows;

  spRenderKPIs();
  spRenderChart();
  spRenderTable();
}

function spSetRange(r, el){
  SP.chartRange = r;
  document.querySelectorAll('#sp-range-ctrls .sp-ctrl').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  spRenderChart();
}

// ══════════════════════════════════════════════════════
// KPIs
// ══════════════════════════════════════════════════════
function spRenderKPIs(){
  const rows = SP.scopedRows;
  if(!rows.length){
    ['sp-kpi-avg','sp-kpi-peak','sp-kpi-total','sp-kpi-custs','sp-kpi-commits'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.textContent='—';
    });
    return;
  }
  const byDate={};
  rows.forEach(r=>{ byDate[r.date]=(byDate[r.date]||0)+r.volume; });
  const dates=Object.keys(byDate).sort();
  const totals=dates.map(d=>byDate[d]);
  // AVG daily sales — WEEKDAYS only (Sat/Sun excluded from both sum and day count), still
  // scoped to the active filters. Peak/total below stay over all days.
  const _isWd=ds=>{const d=new Date(ds+'T00:00:00').getDay(); return d>=1&&d<=5;};
  const wdTotals=dates.filter(_isWd).map(d=>byDate[d]);
  const avgDaily=wdTotals.length?Math.round(wdTotals.reduce((a,b)=>a+b,0)/wdTotals.length):0;
  const peakVal=Math.max(...totals);
  const peakDate=dates[totals.indexOf(peakVal)];
  const grandTotal=totals.reduce((a,b)=>a+b,0);
  const uniqueCusts=new Set(rows.map(r=>r.ship_to)).size;
  const pendingCommits=DB.forecast_commitments.filter(c=>c.status==='pending_approval'||c.status==='draft').length;

  document.getElementById('sp-kpi-avg').textContent  = Number(avgDaily).toLocaleString()+' t';
  document.getElementById('sp-kpi-peak').textContent = Number(peakVal).toLocaleString()+' t';
  document.getElementById('sp-kpi-peak-dt').textContent = peakDate||'—';
  document.getElementById('sp-kpi-total').textContent = spFmtT(grandTotal);
  document.getElementById('sp-kpi-period').textContent = `${dates.length} days`;
  document.getElementById('sp-kpi-custs').textContent = uniqueCusts;
  document.getElementById('sp-kpi-commits').textContent = pendingCommits;
}
function spFmtT(v){ return v>=1000000?(v/1000000).toFixed(2)+'M t':v>=1000?Math.round(v/100)/10+'k t':v+' t'; }

// ══════════════════════════════════════════════════════
// CHART — product-level stacked bars
// ══════════════════════════════════════════════════════
function spRenderChart(){
  const canvas = document.getElementById('sp-chart'); if(!canvas) return;
  if(SP.chartInst){ SP.chartInst.destroy(); SP.chartInst=null; }

  const rows  = SP.scopedRows;
  const today = new Date()._ymd();

  // Date window cutoff
  let cutoff='';
  if(SP.chartRange !== 'all'){
    const d=new Date(today); d.setDate(d.getDate()-parseInt(SP.chartRange));
    cutoff=d._ymd();
  }

  const visRows = cutoff ? rows.filter(r=>r.date>=cutoff) : rows;

  // Build date labels
  const dateSet = new Set(visRows.map(r=>r.date));
  const labels  = [...dateSet].sort();
  if(!labels.length){ _spClearLegend(); return; }

  // Determine stack dimension:
  // - If scoped to a single customer OR a specific rep → stack by product
  // - Otherwise → stack by origin
  const useProductStack = SP.f.customer!=='ALL' || SP.f.rep!=='ALL' || SP.f.product!=='ALL'
    || SP.selScope?.type==='customer' || SP.selScope?.type==='product' || SP.selScope?.type==='rep';

  const datasets = [];

  if(useProductStack){
    // ── Product-level stacks ─────────────────────────
    const prods = [...new Set(visRows.map(r=>r.product))].sort();
    // Aggregate: date → product → volume
    const byDateProd = {};
    visRows.forEach(r=>{
      if(!byDateProd[r.date]) byDateProd[r.date]={};
      byDateProd[r.date][r.product]=(byDateProd[r.date][r.product]||0)+r.volume;
    });
    prods.forEach(p=>{
      datasets.push({
        label: p,
        data:  labels.map(d=>Math.round(byDateProd[d]?.[p]||0)),
        backgroundColor: spProdColor(p, true),
        stack:'actual', order:2,
        _prod: p
      });
    });
  } else {
    // ── Origin-level stacks (default) ────────────────
    const originColors={
      BRS:'rgba(77,166,255,0.78)',MIA:'rgba(0,255,157,0.62)',PEV:'rgba(255,184,48,0.72)',
      SUT:'rgba(204,122,255,0.72)',JAX:'rgba(255,140,66,0.72)',ORL:'rgba(80,210,180,0.70)',
      WPB:'rgba(255,80,120,0.70)',PEN:'rgba(140,180,255,0.70)',EXT:'rgba(120,120,140,0.65)',
    };
    const byDateOrigin={};
    visRows.forEach(r=>{
      if(!byDateOrigin[r.date]) byDateOrigin[r.date]={};
      byDateOrigin[r.date][r.origin]=(byDateOrigin[r.date][r.origin]||0)+r.volume;
    });
    const origins=[...new Set(visRows.map(r=>r.origin))].sort();
    origins.forEach(o=>{
      datasets.push({
        label:o,
        data:labels.map(d=>Math.round(byDateOrigin[d]?.[o]||0)),
        backgroundColor:_tc(originColors[o]||'rgba(150,150,170,0.65)'),
        stack:'actual',order:2
      });
    });
  }

  // Chart is historical actuals only — no future/simulated data shown here

  // Moving averages — computed on TOTAL of scoped rows per day, over WEEKDAYS ONLY
  // (Sat/Sun are excluded from the window). Each MA is the mean of the last N weekday
  // totals; on weekend x-positions the value is carried flat so the line stays continuous.
  const totByDate={};
  visRows.forEach(r=>{ totByDate[r.date]=(totByDate[r.date]||0)+r.volume; });
  const _isWd=ds=>{const d=new Date(ds+'T00:00:00').getDay(); return d>=1&&d<=5;};
  // Window = last N WEEKDAYS (Sat/Sun excluded); the value is carried flat across weekend
  // x-positions so the line stays continuous.
  const maWd=(w)=>{ const out=[]; const wd=[]; let last=null;
    labels.forEach(ds=>{
      if(_isWd(ds)){ wd.push(totByDate[ds]||0); last=wd.length>=w?Math.round(wd.slice(-w).reduce((a,b)=>a+b,0)/w):null; out.push(last); }
      else out.push(last);
    });
    return out; };

  datasets.push({type:'line',label:'10D MA',data:maWd(10),borderColor:_tc('#4da6ff'),borderWidth:1.5,pointRadius:0,tension:.4,fill:false,stack:'',order:0,_isMA:true});
  datasets.push({type:'line',label:'30D MA',data:maWd(30),borderColor:_tc('#ff3d5a'),borderWidth:1.5,borderDash:[5,4],pointRadius:0,tension:.4,fill:false,stack:'',order:0,_isMA:true});

  // Build legend
  spRenderChartLegend(datasets, useProductStack);

  // Scope badge
  const badge=document.getElementById('sp-scope-badge');
  if(badge){
    if(SP.selScope||SP.f.rep!=='ALL'||SP.f.customer!=='ALL'){
      const lbl=SP.f.customer!=='ALL'?SP.f.customer:SP.f.rep!=='ALL'?SP.f.rep:SP.selScope?.label||'';
      badge.style.display='inline-flex';
      badge.className='sp-crumb';
      badge.innerHTML=`${lbl} <span class="sp-crumb-x" onclick="spClearScope()">✕</span>`;
    } else {
      badge.style.display='none';
    }
  }

  // Today vertical line plugin
  const todayPlugin={
    id:'todayLine',
    afterDraw(chart){
      const idx=chart.data.labels.indexOf(today);
      if(idx<0) return;
      const x=chart.scales.x.getPixelForValue(idx);
      const {top,bottom}=chart.chartArea;
      const ctx2=chart.ctx;
      ctx2.save(); ctx2.strokeStyle=_tc('rgba(255,61,90,0.55)'); ctx2.lineWidth=1;
      ctx2.setLineDash([3,3]); ctx2.beginPath();
      ctx2.moveTo(x,top); ctx2.lineTo(x,bottom); ctx2.stroke(); ctx2.restore();
    }
  };

  const buildIt=()=>{
    SP.chartInst=new Chart(canvas,{
      type:'bar',
      data:{labels:[...labels],datasets},
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          tooltip:{mode:'index',intersect:false,
            callbacks:{
              title:items=>items[0]?.label||'',
              label:c=>c.raw!=null&&c.raw!==0?`${c.dataset.label}: ${Number(c.raw).toLocaleString()} t`:'',
              footer:items=>{
                const total=items.filter(i=>!i.dataset._isMA).reduce((s,i)=>s+(i.raw||0),0);
                return total>0?`Total: ${Number(Math.round(total)).toLocaleString()} t`:'';
              }
            }
          }
        },
        scales:{
          x:{stacked:true,grid:{color:_tc('rgba(255,255,255,.03)')},
            ticks:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:8},maxTicksLimit:14,autoSkip:true,maxRotation:0}},
          y:{stacked:true,grid:{color:_tc('rgba(255,255,255,.05)')},
            ticks:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:8},callback:v=>v>=1000?Math.round(v/100)/10+'k':v}}
        },
        onClick:(_,els)=>{
          if(!els.length) return;
          const date=SP.chartInst.data.labels[els[0].index];
          if(date){
            document.getElementById('sp-date-from').value=date;
            document.getElementById('sp-date-to').value=date;
            SP.f.dateFrom=date; SP.f.dateTo=date;
            spApplyFilters();
          }
        }
      },
      plugins:[todayPlugin]
    });
  };

  loadLib('chart').then(buildIt).catch(e=>console.warn(e)); // pinned version + SRI — see LIBS
}

function spRenderChartLegend(datasets, isProductMode){
  const leg=document.getElementById('sp-chart-legend'); if(!leg) return;
  const bars=datasets.filter(d=>!d._isMA);
  const items=bars.map(d=>
    `<div class="sp-leg-item"><div class="sp-leg-sq" style="background:${d.backgroundColor}"></div>${isProductMode?spShortProd(d.label):d.label}</div>`
  );
  items.push(`<div class="sp-leg-item" style="margin-left:8px"><div style="width:16px;height:2px;background:var(--blue);flex-shrink:0"></div>10D MA</div>`);
  items.push(`<div class="sp-leg-item"><div style="width:16px;height:2px;background:repeating-linear-gradient(90deg,var(--red) 0,var(--red) 4px,transparent 4px,transparent 7px);flex-shrink:0"></div>30D MA</div>`);
  leg.innerHTML=items.join('');
}

function spShortProd(p){
  // Shorten "BRS / BRS IL(12) / BULK / EXT" → "BRS IL(12) BULK EXT"
  return p.split(' / ').slice(1).join(' ').trim()||p;
}

function _spClearLegend(){
  const leg=document.getElementById('sp-chart-legend'); if(leg) leg.innerHTML='';
}

// ══════════════════════════════════════════════════════
// PERFORMANCE TABLE
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// PERFORMANCE TABLE — Date-spine with Org Hierarchy
// ══════════════════════════════════════════════════════

// ── Extract Sold-To name from Ship-To name (legacy fallback only — see below) ──
function spExtractSoldTo(shipToName){
  if(!shipToName) return '—';
  return shipToName.split(' - ')[0].trim();
}
// ── Sold-To identity vs display (the real fix) ──────────
// One customer account (Sold-To) can have many Ship-Tos, and their Ship-To NAMES
// are not consistently formatted (e.g. "MASCHMEYER CONCRETE - LAKE PARK" vs
// "MASCHMEYER CONCRETE-ORLANDO-BULK"). Splitting the Ship-To name on " - " to
// guess the Sold-To (spExtractSoldTo, above) fragmented a single real customer
// into several different "Sold-To" groups. The source file carries the real
// Sold-To NUMBER + NAME — use the number as the stable grouping key and the
// name only for display. Rows imported before this field existed (no sold_to)
// fall back to the old guess so they don't just vanish.
function spSoldToKey(r){ return r && r.sold_to ? String(r.sold_to) : spExtractSoldTo(r&&r.ship_to_name||'—'); }
function spSoldToName(r){ return (r && r.sold_to_name) || spExtractSoldTo(r&&r.ship_to_name||'—'); }

// ── Quick date range buttons ──────────────────────────
function spSetQuickDate(mode){
  const today=new Date()._ymd();
  const [y,m]=today.split('-');
  let from, to;
  if(mode==='MTD')      { from=`${y}-${m}-01`; to=new Date(+y,+m,0)._ymd(); }
  else if(mode==='YTD') { from=`${y}-01-01`; to=`${y}-12-31`; }
  else if(mode==='R12M'){ const d=new Date(today+'T00:00:00'); d.setFullYear(d.getFullYear()-1); from=d._ymd(); to=today; }
  else return;
  const df=document.getElementById('sp-date-from'), dt=document.getElementById('sp-date-to');
  if(df) df.value=from; if(dt) dt.value=to;
  ['mtd','ytd','r12m'].forEach(k=>{
    const el=document.getElementById(`sp-quick-${k}`);
    if(el){ el.classList.toggle('active',k===mode.toLowerCase()); el.classList.toggle('green',k===mode.toLowerCase()); }
  });
  // Reset collapsed months so new range initialises fresh
  SP.collapsedMonths=null;
  spDispatch({dateFrom:from,dateTo:to});
}

// ── Toggle a month column between collapsed/expanded ──
function spToggleMonth(ym){
  if(!SP.collapsedMonths) SP.collapsedMonths=new Set();
  if(SP.collapsedMonths.has(ym)) SP.collapsedMonths.delete(ym);
  else SP.collapsedMonths.add(ym);
  spRenderTable();
}

// ── Build date spine from current filter range ────────
function spBuildDateSpine(){
  const today=new Date()._ymd();
  const curYm=today.slice(0,7);
  const from=SP.f.dateFrom||`${today.slice(0,4)}-01-01`;
  const to  =SP.f.dateTo  ||`${today.slice(0,4)}-12-31`;
  // Return cached spine if date range hasn't changed
  if(SP._spine&&SP._spine.from===from&&SP._spine.to===to){
    if(!SP.collapsedMonths) SP.collapsedMonths=new Set(SP._spine.months.filter(m=>m.isPast).map(m=>m.ym));
    return {months:SP._spine.months,today};
  }
  const months=[];
  for(let d=new Date(from+'T00:00:00'); d._ymd()<=to; d.setDate(d.getDate()+1)){
    const ds=d._ymd(), ym=ds.slice(0,7);
    let mo=months.find(m=>m.ym===ym);
    if(!mo){ mo={ym,label:new Date(ds+'T00:00:00').toLocaleDateString('en',{month:'short',year:'2-digit'}),dates:[],isPast:ym<curYm,isCurrent:ym===curYm}; months.push(mo); }
    mo.dates.push(ds);
  }
  if(!SP.collapsedMonths){
    SP.collapsedMonths=new Set(months.filter(m=>m.isPast).map(m=>m.ym));
  }
  SP._spine={from,to,months};
  return {months,today};
}

// ── Build org hierarchy tree from filtered rows ───────
function spBuildOrgTree(rows){
  const facMap=Object.fromEntries(DB.facilities.map(f=>[f.id,f]));
  const subMap=Object.fromEntries(DB.sub_regions.map(s=>[s.id,s]));
  const regMap=Object.fromEntries(DB.regions.map(r=>[r.id,r]));
  const origFacIdx={};
  DB.facilities.forEach(f=>{
    const n=(f.name||'').toUpperCase(); if(n) origFacIdx[n]=f.id;
    const c=(f.code||'').toUpperCase(); if(c) origFacIdx[c]=f.id;
  });
  const getFacId=orig=>{
    const up=(orig||'').toUpperCase();
    return origFacIdx[up]||DB.facilities.find(f=>up.includes((f.name||'').toUpperCase())||(f.name||'').toUpperCase().includes(up))?.id||null;
  };
  const dpEls=(DB.elements||[]).filter(e=>e.type==='demand_point');
  const dpNameIdx={};
  dpEls.forEach(el=>{
    const k=(el.name||'').trim().toUpperCase(); if(k) dpNameIdx[k]=el;
    const c=(el.props?.dp_code||'').trim().toUpperCase(); if(c) dpNameIdx[c]=el;
  });
  const getDpEl=prod=>dpNameIdx[(prod||'').trim().toUpperCase()]||null;
  // 7-day activity cutoff relative to data max (not today, in case data lags)
  const refDate=DB.real_shipments_meta?.date_max||new Date()._ymd();
  const cutoffD=new Date(refDate+'T00:00:00'); cutoffD.setDate(cutoffD.getDate()-7);
  const cutoffStr=cutoffD._ymd();
  // Inline actMap + recentVol update: single pass, no re-scan of rows later
  const upd=(node,r)=>{
    if(r.date) node.actMap[r.date]=(node.actMap[r.date]||0)+(r.volume||0);
    node.histVol+=(r.volume||0);
    if(r.date&&r.date>=cutoffStr) node.recentVol+=(r.volume||0);
  };
  const tree={};
  rows.forEach(r=>{
    const facId=getFacId(r.origin), fac=facId?facMap[facId]:null;
    const sub=fac?subMap[fac.sub_region_id]:null, reg=sub?regMap[sub.region_id]:null;
    const dpEl=getDpEl(r.product);
    const regId =reg ?reg.id  :'__noreg';
    const subId =sub ?sub.id  :`__nosub_${regId}`;
    const facKey=fac ?fac.id  :`__nofac_${(r.origin||'').replace(/\W/g,'_')}`;
    const dpKey =dpEl?dpEl.id :`__nodp_${(r.product||'').replace(/\W/g,'_')}`;
    const soldTo=spSoldToKey(r), soldToName=spSoldToName(r), shipTo=r.ship_to_name||'—';
    if(!tree[regId]) tree[regId]={id:regId,name:reg?reg.name:'Unknown Region',actMap:{},histVol:0,recentVol:0,dpElIdSet:new Set(),subs:{}};
    upd(tree[regId],r); if(dpEl) tree[regId].dpElIdSet.add(dpEl.id);
    if(!tree[regId].subs[subId]) tree[regId].subs[subId]={id:subId,name:sub?sub.name:r.origin||'Unknown',actMap:{},histVol:0,recentVol:0,dpElIdSet:new Set(),facs:{}};
    upd(tree[regId].subs[subId],r); if(dpEl) tree[regId].subs[subId].dpElIdSet.add(dpEl.id);
    if(!tree[regId].subs[subId].facs[facKey]) tree[regId].subs[subId].facs[facKey]={id:facKey,name:fac?fac.name:r.origin||'Unknown Plant',actMap:{},histVol:0,recentVol:0,dpElIdSet:new Set(),dps:{}};
    upd(tree[regId].subs[subId].facs[facKey],r); if(dpEl) tree[regId].subs[subId].facs[facKey].dpElIdSet.add(dpEl.id);
    if(!tree[regId].subs[subId].facs[facKey].dps[dpKey]) tree[regId].subs[subId].facs[facKey].dps[dpKey]={id:dpKey,name:dpEl?dpEl.name:r.product||'Unknown DP',dpElId:dpEl?.id||null,actMap:{},histVol:0,recentVol:0,soldtos:{}};
    upd(tree[regId].subs[subId].facs[facKey].dps[dpKey],r);
    if(!tree[regId].subs[subId].facs[facKey].dps[dpKey].soldtos[soldTo]) tree[regId].subs[subId].facs[facKey].dps[dpKey].soldtos[soldTo]={name:soldToName,actMap:{},histVol:0,recentVol:0,shiptos:{}};
    upd(tree[regId].subs[subId].facs[facKey].dps[dpKey].soldtos[soldTo],r);
    if(!tree[regId].subs[subId].facs[facKey].dps[dpKey].soldtos[soldTo].shiptos[shipTo]) tree[regId].subs[subId].facs[facKey].dps[dpKey].soldtos[soldTo].shiptos[shipTo]={name:shipTo,actMap:{},histVol:0,recentVol:0};
    upd(tree[regId].subs[subId].facs[facKey].dps[dpKey].soldtos[soldTo].shiptos[shipTo],r);
  });
  // Convert per-node dpElIdSets → arrays for fbBtn and renderCells
  Object.values(tree).forEach(reg=>{
    reg.dpElIds=[...reg.dpElIdSet];
    Object.values(reg.subs).forEach(sub=>{
      sub.dpElIds=[...sub.dpElIdSet];
      Object.values(sub.facs).forEach(fac=>{ fac.dpElIds=[...fac.dpElIdSet]; });
    });
  });
  return tree;
}

// ── Demand values index for O(1) lookups ─────────────
function spBuildDemandIndex(){
  if(SP._demIdx) return SP._demIdx;
  const idx={};
  // Two-pass: first accumulate ship_to records, then fill null-record fallbacks
  const dpAgg={};
  (DB.demand_values||[]).forEach(v=>{
    if(!v.element_id||!v.date) return;
    const key=`${v.element_id}|${v.date}`;
    if(v.ship_to){
      // Ship-to specific lookup
      idx[`${key}|${v.ship_to}`]=(idx[`${key}|${v.ship_to}`]||0)+(parseFloat(v.value_t)||0);
      // Accumulate into dp aggregate
      if(!dpAgg[key]) dpAgg[key]={total:0,hasShipTo:true};
      dpAgg[key].total+=(parseFloat(v.value_t)||0);
      dpAgg[key].hasShipTo=true;
    } else {
      if(!dpAgg[key]) dpAgg[key]={total:parseFloat(v.value_t)||0,hasShipTo:false};
      else if(!dpAgg[key].hasShipTo) dpAgg[key].total=parseFloat(v.value_t)||0;
    }
  });
  // Write aggregated dp-level values into idx
  Object.entries(dpAgg).forEach(([key,g])=>{ idx[key]=g.total; });
  SP._demIdx=idx;
  return idx;
}

// ── Forecast value for one demand point + date ────────
function spGetFcVal(dpElId, date, demIdx, shipTo){
  if(!dpElId) return 0;
  if(shipTo) return demIdx[`${dpElId}|${date}|${shipTo}`]||0;
  return demIdx[`${dpElId}|${date}`]||0;
}

// ── Collect demand_point element IDs from a row set ──


// ── Main table render ──────────────────────────────────
function spRenderTable(skipThead=false){
  const tbody=document.getElementById('sp-tbody'); if(!tbody) return;
  const rows=SP.filteredRows;
  if(!rows.length){ tbody.innerHTML=`<tr><td colspan="10" class="sp-no-data">No data for current filters</td></tr>`; return; }
  const {months,today}=spBuildDateSpine();
  const demIdx=spBuildDemandIndex();
  if(!SP._tree) SP._tree=spBuildOrgTree(rows);
  const orgTree=SP._tree;
  if(!SP.collapsed) SP.collapsed={};

  // ── Rebuild thead dynamically (skipped on row-toggle since column structure is unchanged) ──
  const thead=document.getElementById('sp-thead');
  if(thead&&!skipThead){
    let h1='',h2='';
    const spLastYear=today.slice(0,4);
    const yrTh=(yr)=>{
      const color=yr<spLastYear?'var(--green)':yr>spLastYear?'var(--amber)':'var(--blue)';
      const bg=yr<spLastYear?'rgba(var(--green-rgb),.10)':yr>spLastYear?'rgba(var(--amber-rgb),.10)':'rgba(var(--blue-rgb),.10)';
      return `<th rowspan="2" title="Full-year ${yr} total" style="background:${bg};color:${color};font-size:7px;font-weight:700;text-align:center;letter-spacing:.5px;border-left:3px double var(--border2);padding:3px 5px;white-space:nowrap;position:sticky;top:0">Σ ${yr}</th>`;
    };
    months.forEach((mo,mi)=>{
      const col=SP.collapsedMonths.has(mo.ym);
      const span=col?1:mo.dates.length+1;
      const bg=mo.isPast?'rgba(var(--green-rgb),.06)':mo.isCurrent?'rgba(var(--blue-rgb),.06)':'rgba(var(--amber-rgb),.04)';
      const tc=mo.isPast?'var(--green)':mo.isCurrent?'var(--blue)':'var(--amber)';
      h1+=`<th colspan="${span}" style="background:${bg};color:${tc};font-size:7px;text-align:center;cursor:pointer;letter-spacing:.5px;border-left:1px solid var(--border2);padding:3px 4px" onclick="spToggleMonth('${mo.ym}')">${col?'▸':'▾'} ${mo.label}</th>`;
      if(col){
        h2+=`<th class="sp-mcol" style="background:${bg};font-size:6px;text-align:center;border-left:1px solid var(--border2);padding:2px 4px">Σ</th>`;
      } else {
        mo.dates.forEach(ds=>{
          const isToday=ds===today;
          const bg2=ds<today?'rgba(var(--green-rgb),.03)':isToday?'rgba(var(--red-rgb),.06)':'';
          const bd=isToday?'border-left:2px solid rgba(var(--red-rgb),.4)':'border-left:1px solid var(--border)';
          const dow=['S','M','T','W','T','F','S'][new Date(ds+'T00:00:00').getDay()];
          h2+=`<th style="${bg2?'background:'+bg2+';':''}${bd};font-size:5px;padding:2px 1px;text-align:center;min-width:20px" title="${ds}">${ds.slice(8)}<br><span style="opacity:.5">${dow}</span></th>`;
        });
        h2+=`<th class="sp-mcol" style="background:${bg};font-size:6px;text-align:center;font-weight:700;border-left:2px solid var(--border2);padding:2px 4px">Σ</th>`;
      }
      // Year-total column after each year's last month (rowspan=2 spans both header rows).
      const yearEnd = mi===months.length-1 || months[mi+1].ym.slice(0,4)!==mo.ym.slice(0,4);
      if(yearEnd) h1+=yrTh(mo.ym.slice(0,4));
    });
    thead.innerHTML=`<tr>
      <th class="th-lbl" style="vertical-align:bottom;padding-bottom:8px;border-right:2px solid var(--border2);font-size:8px" rowspan="2">Region / Sub-Region / Plant / Demand Point / Sold To / Ship To</th>
      ${h1}
    </tr><tr>${h2}</tr>`;
  }

  // ── Per-row date cell renderer ──
  // actMap/histVol/recentVol pre-computed in spBuildOrgTree (single O(N) pass).
  // recentVol: volume in last 7 days — zero means inactive, cascade suppressed.
  // shipTos: null=aggregated dp total | string[]=specific ship_to_names to sum
  // dpHistVol: total historical volume at DP level (denominator for cascade proportion)
  function renderCells(actMap, histVol, recentVol, dpElId, dpElIds, shipTos, dpHistVol){
    // Inactive nodes (no shipments in last 7 days) get no cascade allocation.
    // Specific demand_values entries still win (step 1 in getFc), so the forecast
    // builder override for a specific sold-to continues to work regardless.
    const cascadeProp=dpHistVol>0&&recentVol>0?histVol/dpHistVol:0;
    const getFc=(ds)=>{
      if(dpElId){
        if(shipTos&&shipTos.length){
          const specific=shipTos.reduce((s,st)=>s+spGetFcVal(dpElId,ds,demIdx,st),0);
          if(specific>0) return specific;
          // Cascade: proportional share of top-down DP forecast
          if(cascadeProp>0){
            const topDown=spGetFcVal(dpElId,ds,demIdx,null);
            if(topDown>0) return topDown*cascadeProp;
          }
          return 0;
        }
        return spGetFcVal(dpElId,ds,demIdx,null);
      }
      if(dpElIds) return dpElIds.reduce((s,id)=>s+spGetFcVal(id,ds,demIdx,null),0);
      return 0;
    };
    let cells='';
    const spLastYear=today.slice(0,4);
    let yearSum=0;
    const yrTd=(yr)=>{
      const color=yr<spLastYear?'var(--green)':yr>spLastYear?'var(--amber)':'var(--blue)';
      const bg=yr<spLastYear?'rgba(var(--green-rgb),.07)':yr>spLastYear?'rgba(var(--amber-rgb),.08)':'rgba(var(--blue-rgb),.08)';
      return `<td title="Full-year ${yr}" style="text-align:right;padding:1px 5px;font-size:7px;font-weight:700;color:${color};background:${bg};border-left:3px double var(--border2)">${yearSum?Math.round(yearSum).toLocaleString():'—'}</td>`;
    };
    months.forEach((mo,mi)=>{
      const col=SP.collapsedMonths.has(mo.ym);
      const bgBase=mo.isPast?'rgba(var(--green-rgb),.03)':'';
      if(col){
        let moSum=0;
        mo.dates.forEach(ds=>{ moSum+=actMap[ds]||0; if(ds>today) moSum+=getFc(ds); });
        cells+=`<td class="sp-mcol" style="text-align:right;padding:1px 4px;font-size:7px;${bgBase?'background:'+bgBase+';':''}border-left:1px solid var(--border2)">${moSum?Math.round(moSum).toLocaleString():'—'}</td>`;
        yearSum+=moSum;
      } else {
        let moSum=0;
        mo.dates.forEach(ds=>{
          const isToday=ds===today;
          let val=0, bgCell='';
          if(ds<=today){ val=actMap[ds]||0; bgCell='rgba(var(--green-rgb),.04)'; }
          else { val=getFc(ds); }
          moSum+=val;
          const bd=isToday?'border-left:2px solid rgba(var(--red-rgb),.4)':'border-left:1px solid var(--border)';
          cells+=`<td style="${bgCell?'background:'+bgCell+';':''}${bd};text-align:right;padding:1px 2px;font-size:7px">${val?Math.round(val).toLocaleString():''}</td>`;
        });
        cells+=`<td class="sp-mcol" style="text-align:right;padding:1px 4px;font-size:7px;font-weight:700;${bgBase?'background:'+bgBase+';':''}border-left:2px solid var(--border2)">${moSum?Math.round(moSum).toLocaleString():'—'}</td>`;
        yearSum+=moSum;
      }
      const yearEnd = mi===months.length-1 || months[mi+1].ym.slice(0,4)!==mo.ym.slice(0,4);
      if(yearEnd){ cells+=yrTd(mo.ym.slice(0,4)); yearSum=0; }
    });
    return cells;
  }

  // ── Forecast builder button helper ────────────────
  const fbBtn=(elIds,label)=>elIds&&elIds.length
    ?`<button class="sp-fb-btn" onclick="event.stopPropagation();openSpForecastBuilder(${JSON.stringify(elIds).replaceAll('"','&quot;')},${JSON.stringify(label).replaceAll('"','&quot;')})" title="⚙ Forecast Builder">⚙</button>`
    :'';

  const sortObjs=obj=>Object.values(obj).sort((a,b)=>(a.name||'').localeCompare(b.name||''));

  // ── Render tree rows ──
  let h='';
  sortObjs(orgTree).forEach(reg=>{
    const rKey='reg_'+reg.id.replace(/\W/g,'_'), rCol=!!SP.collapsed[rKey];
    h+=`<tr class="sp-row-l0" data-sp-key="${rKey}" data-sp-depth="0" onclick="spToggle('${rKey}')" style="cursor:pointer">
      <td class="td-lbl" style="border-right:2px solid var(--border2)">
        <span class="sp-toggle">${rCol?'▸':'▾'}</span><strong>${esc(reg.name)}</strong>${fbBtn(reg.dpElIds,reg.name)}
      </td>${renderCells(reg.actMap,reg.histVol,reg.recentVol,null,reg.dpElIds)}</tr>`;
    if(rCol) return;

    sortObjs(reg.subs).forEach(sub=>{
      const sKey='sub_'+sub.id.replace(/\W/g,'_'), sCol=!!SP.collapsed[sKey];
      h+=`<tr class="sp-row-l1" data-sp-key="${sKey}" data-sp-depth="1" onclick="spToggle('${sKey}')" style="cursor:pointer">
        <td class="td-lbl" style="border-right:2px solid var(--border2);padding-left:18px">
          <span class="sp-toggle">${sCol?'▸':'▾'}</span><strong>${esc(sub.name)}</strong>${fbBtn(sub.dpElIds,sub.name)}
        </td>${renderCells(sub.actMap,sub.histVol,sub.recentVol,null,sub.dpElIds)}</tr>`;
      if(sCol) return;

      sortObjs(sub.facs).forEach(fac=>{
        const fKey='fac_'+fac.id.replace(/\W/g,'_'), fCol=!!SP.collapsed[fKey];
        h+=`<tr class="sp-row-l2" data-sp-key="${fKey}" data-sp-depth="2" onclick="spToggle('${fKey}')" style="cursor:pointer">
          <td class="td-lbl" style="border-right:2px solid var(--border2);padding-left:30px">
            <span class="sp-toggle">${fCol?'▸':'▾'}</span><strong>${esc(fac.name)}</strong>${fbBtn(fac.dpElIds,fac.name)}
          </td>${renderCells(fac.actMap,fac.histVol,fac.recentVol,null,fac.dpElIds)}</tr>`;
        if(fCol) return;

        sortObjs(fac.dps).forEach(dp=>{
          const dpKey='dp_'+dp.id.replace(/\W/g,'_'), dpCol=!!SP.collapsed[dpKey];
          const dpElIds=dp.dpElId?[dp.dpElId]:[];
          h+=`<tr class="sp-row-l3" data-sp-key="${dpKey}" data-sp-depth="3" onclick="spToggle('${dpKey}')" style="cursor:pointer">
            <td class="td-lbl" style="border-right:2px solid var(--border2);padding-left:42px">
              <span class="sp-toggle">${dpCol?'▸':'▾'}</span>${esc(dp.name)}${fbBtn(dpElIds,dp.name)}
            </td>${renderCells(dp.actMap,dp.histVol,dp.recentVol,dp.dpElId,null)}</tr>`;
          if(dpCol) return;

          sortObjs(dp.soldtos).forEach(so=>{
            const soKey='so_'+dpKey+'_'+so.name.replace(/\W/g,'_'), soCol=!!SP.collapsed[soKey];
            const soShipTos=Object.keys(so.shiptos);
            h+=`<tr class="sp-row-l4" data-sp-key="${soKey}" data-sp-depth="4" onclick="spToggle('${soKey}')" style="cursor:pointer">
              <td class="td-lbl" style="border-right:2px solid var(--border2);padding-left:54px">
                <span class="sp-toggle">${soCol?'▸':'▾'}</span>${esc(so.name)}
              </td>${renderCells(so.actMap,so.histVol,so.recentVol,dp.dpElId,null,soShipTos,dp.histVol||1)}</tr>`;
            if(soCol) return;

            sortObjs(so.shiptos).forEach(st=>{
              h+=`<tr class="sp-row-l5" data-sp-depth="5">
                <td class="td-lbl" style="border-right:2px solid var(--border2);padding-left:66px;font-size:7px">${esc(st.name)}</td>
                ${renderCells(st.actMap,st.histVol,st.recentVol,dp.dpElId,null,[st.name],dp.histVol||1)}</tr>`;
            });
          });
        });
      });
    });
  });

  if(!h) h=`<tr><td colspan="20" class="sp-no-data">No org hierarchy match — check that Origins in the Excel match facility names in your org structure</td></tr>`;
  tbody.innerHTML=h;
}

// ── [old helpers removed — replaced by spBuildDateSpine / spBuildOrgTree] ──


// ── Helper: sum volume by day for given rows ──


// ── Helper: get dates for a specific month (YYYY-MM) ──


// ── Helper: get months for rest of year (current month+1 through December) ──


// ── Helper: calculate daily forecast based on basis method ──
// basis: 'all10d', 'all15d', 'all30d' (or 'actual' to use actual historical data)
// rows: shipment records, dates: days to calculate for, forecastDays: number of days to forecast


// ── Helper: get date ranges for forecast basis calculation ──


// ── HIERARCHICAL FORECAST BASIS SYSTEM ──
// Get the applicable basis for a specific row by checking hierarchy:
// 1. Check if this row has an override
// 2. Otherwise check parent level
// 3. Otherwise use system default


// Set basis override at a specific level with optional section


// Get label for basis (e.g., "10d Primary", "15d Override")


// Render basis selector buttons for a row — with calculated daily average values


// ── Helper: render daily columns as compact cells (editable) ──




// ── Apply selected basis to row ──


// ── Save editable daily cell ──


function spToggle(key){
  SP.collapsed[key]=!SP.collapsed[key];
  // Track whether user explicitly expanded this key
  if(!SP.collapsed[key]) SP._userExpanded[key]=true;
  else delete SP._userExpanded[key];
  // skipThead: column structure doesn't change on row toggle
  spRenderTable(true);
}

function spExpandAll(expand){
  SP.collapsed={};
  SP._userExpanded={};
  if(!expand){
    // Collapse all region rows — use cached tree if available
    const orgTree=SP._tree||spBuildOrgTree(SP.filteredRows);
    Object.keys(orgTree).forEach(k=>{ SP.collapsed['reg_'+k.replace(/\W/g,'_')]=true; });
  }
  spRenderTable(true);
}

// ── Forecast Builder from SP context ─────────────────
function openSpForecastBuilder(dpElIds, label){
  if(!dpElIds||!dpElIds.length){ statMsg('No demand points linked to this node — check org structure matches Origins in the Excel'); return; }

  // Build modal for one or more demand points (do not delegate to openDemandBuilder which is scoped to S.facility_id)
  const simStart=S.simCfg.start_date||new Date()._ymd();
  const nwdCount=(DB.non_working_days||[]).length;
  const dpEls=dpElIds.map(id=>(DB.elements||[]).find(e=>e.id===id)).filter(Boolean);
  const pi='background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:10px;padding:5px 7px;outline:none;width:100%';
  const pl='font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-bottom:3px;letter-spacing:.5px;text-transform:uppercase';
  const pf='display:flex;flex-direction:column;gap:0';

  let h=`<div class="modal-hdr">
    <div>
      <span class="modal-title">⚙ Forecast Builder — ${label||'Selected Node'}</span>
      <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:3px">Applies to ${dpEls.length} demand point${dpEls.length>1?'s':''} · values permeate to demand and simulation</div>
    </div>
    <span class="modal-close" onclick="closeModal()">✕</span>
  </div>
  <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
    <div style="${pf}">
      <div style="${pl}">Apply To</div>
      <select style="${pi}" id="fb-el-id">
        ${dpEls.length>1?`<option value="__ALL__">All ${dpEls.length} demand points under "${label||'node'}"</option>`:''}
        ${dpEls.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="${pf}"><div style="${pl}">Start Date</div>
        <input style="${pi}" type="date" id="fb-start" value="${simStart}">
      </div>
      <div style="${pf}"><div style="${pl}">Method</div>
        <select style="${pi}" id="fb-method" onchange="_fbSyncMethod()">
          <option value="adaptive" selected>Adaptive (auto-pick 5/10/15/30WD)</option>
          <option value="rolling">Rolling weekday average</option>
          <option value="fixed">Fixed daily value</option>
          <option value="distribute">Distribute monthly total</option>
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div id="fb-wrap-rolling" style="${pf}"><div style="${pl}">Rolling Window</div>
        <select style="${pi}" id="fb-rolling-n">
          <option value="5">5 weekdays</option><option value="10" selected>10 weekdays</option>
          <option value="20">20 weekdays</option><option value="30">30 weekdays</option>
        </select>
      </div>
      <div id="fb-wrap-fixed" style="${pf};display:none"><div style="${pl}">Fixed Daily (t/day)</div>
        <input style="${pi}" type="number" step="1" id="fb-fixed-val" value="0" placeholder="0">
      </div>
      <div id="fb-wrap-month" style="${pf};display:none"><div style="${pl}">Month Total Target (t)</div>
        <input style="${pi}" type="number" step="1" id="fb-month-total" value="0" placeholder="0">
      </div>
      <div id="fb-wrap-horizon" style="${pf}"><div style="${pl}">Horizon</div>
        <select style="${pi}" id="fb-horizon" onchange="_fbSyncHorizon()">
          <option value="eom">End of month</option><option value="eoy" selected>End of year</option>
          <option value="sim">End of simulation</option><option value="date">Specific date</option>
        </select>
      </div>
    </div>
    <div id="fb-wrap-enddate" style="${pf};display:none">
      <div style="${pl}">End Date</div>
      <input style="${pi}" type="date" id="fb-end-date" value="${simStart}">
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:10px;color:var(--text);cursor:pointer">
      <input type="checkbox" id="fb-ships-sat" checked>Ships Saturdays
    </label>
    <div id="fb-wrap-sat-pct" style="${pf}">
      <div style="${pl}">Saturday volume (% of weekday avg)</div>
      <input style="${pi}" type="number" id="fb-sat-pct" value="25" min="0" max="100">
    </div>
    <div id="fb-msg" style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding:8px 10px;background:var(--surface2);border:1px solid var(--border2);min-height:32px"></div>
    <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim)">⊘ ${nwdCount} global non-working day${nwdCount!==1?'s':''} excluded from all calculations</div>
    <div style="display:flex;gap:8px;justify-content:space-between;align-items:center">
      <button class="tb-btn sec" title="Upload an Excel/CSV (SCH5 export): demand points in rows, months as columns (e.g. JULY, AUGUST or 2026-07). Each monthly total is distributed across that month's eligible days using the Saturday % above." onclick="_fbBulkPick()">📥 Import SCH5 Data</button>
      <div style="display:flex;gap:8px">
        <button class="tb-btn sec" onclick="closeModal()">Cancel</button>
        <button class="tb-btn sec" onclick="_fbPreview()">Preview</button>
        <button class="tb-btn amber" onclick="_spFbApplyMulti(${JSON.stringify(dpElIds).replaceAll('"','&quot;')})">⚡ Apply Forecast</button>
      </div>
    </div>
  </div>`;
  showModal('_custom');
  document.getElementById('modal-content').innerHTML=h;
  _fbSyncMethod();
}

function _spFbApplyMulti(dpElIds){
  const sel=document.getElementById('fb-el-id')?.value;
  const targets=sel==='__ALL__'?dpElIds:[sel];
  const selEl=document.getElementById('fb-el-id');
  if(!DB.demand_values) DB.demand_values=[];
  let totalDays=0, totalT=0;
  targets.forEach(elId=>{
    if(selEl) selEl.value=elId;
    const result=_fbBuildRows(); if(!result) return;
    const {rows,elId:eid}=result;
    const shipTo=result.shipTo||null;
    rows.forEach(r=>{
      if(shipTo){
        DB.demand_values=DB.demand_values.filter(x=>!(x.element_id===eid&&x.date===r.date&&x.ship_to===shipTo));
        DB.demand_values=DB.demand_values.filter(x=>!(x.element_id===eid&&x.date===r.date&&!x.ship_to));
        if(r.value>0){ DB.demand_values.push({element_id:eid,date:r.date,value_t:Math.round(r.value*10)/10,ship_to:shipTo}); totalDays++; totalT+=r.value; }
      } else {
        DB.demand_values=DB.demand_values.filter(x=>!(x.element_id===eid&&x.date===r.date));
        if(r.value>0){ DB.demand_values.push({element_id:eid,date:r.date,value_t:Math.round(r.value*10)/10}); totalDays++; totalT+=r.value; }
      }
    });
  });
  autoSave(); _demandCacheInvalidate();
  document.getElementById('fb-msg').innerHTML=`<span style="color:var(--green)">✓ Applied to ${targets.length} demand point${targets.length>1?'s':''}</span> — ${totalDays} days · ${Math.round(totalT).toLocaleString()} t total`;
  renderSalesPerfView();
  if(S.view==='demand') renderDemandView();
}

function spSaveForecast(){
  autoSave();
  statMsg('Forecast saved — demand values written to all connected tables');
  renderSalesPerfView();
  if(S.view==='demand') renderDemandView();
}

// ── SCOPE SELECTION ──────────────────────────────────
// Clicking a row in the table scopes the chart to that rep / customer / product.
// Also cascades the top-bar dropdowns to match the selection.


function spClearScope(){
  SP.selScope=null;
  SP.scopedRows=SP.filteredRows;
  SP.f.rep='ALL'; SP.f.customer='ALL'; SP.f.product='ALL';
  SP.collapsed={}; SP._userExpanded={};
  spRebuildCascade(); spSyncFilterUI();
  const badge=document.getElementById('sp-scope-badge'); if(badge) badge.style.display='none';
  spApplyFilters();
  spBuildForecastPanel();
}

function spGetScopeRows(rows, scope){
  if(!scope) return rows;
  const sane=s=>s.replace(/[^\w]/g,'_');
  return rows.filter(r=>{
    const rep=r.sales_manager||'—';
    const cust=r.ship_to_name||String(r.ship_to||'Unknown');
    const prod=r.product||r.origin;
    const rKey=`rep_${sane(rep)}`;
    const cKey=`cust_${rKey}_${sane(cust)}`;
    const pKey=`prod_${cKey}_${sane(prod)}`;
    switch(scope.type){
      case 'rep':     return rKey===scope.key;
      case 'customer':return cKey===scope.key;
      case 'product': return pKey===scope.key;
    }
    return true;
  });
}

// ══════════════════════════════════════════════════════
// FORECAST PANEL
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// FORECAST — PILL SYSTEM
// ══════════════════════════════════════════════════════

// State (preserved from init guards in SP object)
// SP.fcRepSel[repKey][hz]    = 'Hist'|'10d'|'15d'|'30d'|'custom'|null
// SP.fcRepCustom[repKey][hz] = number  (rep-level custom TOTAL for group)
// SP.fcCustSel[custKey][hz]  = 'Hist'|'10d'|'15d'|'30d'|'custom'|null (null=inherit)
// SP.fcCustCustom[custKey][hz]= number (customer absolute override)
// SP.fcShowInp[id][hz]       = bool
if(!SP.fcRepSel)    SP.fcRepSel={};
if(!SP.fcRepCustom) SP.fcRepCustom={};
if(!SP.fcCustSel)   SP.fcCustSel={};
if(!SP.fcCustomVal) SP.fcCustomVal={};  // kept for compat
if(!SP.fcCustCustom)SP.fcCustCustom={};
if(!SP.fcShowInp)   SP.fcShowInp={};



// Resolve a customer's committed value for a given horizon.
// Handles: stat method, custom absolute, rep-custom proportional spread.
// repCusts = array of all customer stats objects for the rep (needed for proportional calc)


// Build the pill strip for one horizon cell


// ── Pill interaction handlers ─────────────────────────










// Stubs kept for backward compat with any lingering HTML refs







// ── Footer ────────────────────────────────────────────






// Stubs

function spBuildForecastPanel(){}






// ══════════════════════════════════════════════════════
// FILE UPLOAD + PARSING
// ══════════════════════════════════════════════════════
async function spHandleFile(input){
  const file=input.files?.[0]; if(!file) return;
  const msg=document.getElementById('sp-upload-msg');
  const prog=document.getElementById('sp-progress');
  const progBar=document.getElementById('sp-progress-bar');
  if(msg) msg.innerHTML='<span style="color:var(--text-dim)">Reading file…</span>';
  if(prog) prog.style.display='block';
  if(progBar){ progBar.style.background='var(--blue)'; progBar.style.width='10%'; }
  try{
    const buf=await file.arrayBuffer();
    await spIngestFile(buf, file.name);
    if(progBar) progBar.style.width='100%';
    const m=DB.real_shipments_meta;
    if(msg) msg.innerHTML=`<div class="sp-val-ok">✓ ${Number(m.row_count||0).toLocaleString()} rows → ${Number(m.agg_count||0).toLocaleString()} daily records · ${m.date_min} → ${m.date_max}</div>`;
    SP.f={dateFrom:m.date_min,dateTo:m.date_max,origin:'ALL',rep:'ALL',customer:'ALL',custType:'all',product:'ALL'};
    SP.selScope=null; SP.scopedRows=[]; SP.collapsed={};
    setTimeout(()=>{
      document.getElementById('sp-upload-zone').style.display='none';
      const content=document.getElementById('sp-content');
      content.style.display='flex'; content.style.flexDirection='column'; content.style.gap='14px';
      renderSalesPerfView();
    },800);
  }catch(err){
    if(msg) msg.innerHTML=`<div class="sp-val-error">✗ ${err.message}</div>`;
    if(progBar){ progBar.style.width='0%'; progBar.style.background='var(--red)'; }
    console.error('SP upload error',err);
  }
}


