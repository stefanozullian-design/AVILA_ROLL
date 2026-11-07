// ═══════════════════════════════════════════════════════
// CHART ENGINE v2 — bar+line hybrid with hover tooltips
// ═══════════════════════════════════════════════════════
const _chartMeta={};  // canvas id → {series, lines, days, startDay, P, barMode, railMode}
const _chartHidden={};  // legendId → Set of hidden series labels
const _chartRedrawFns={}; // legendId → function to redraw that chart
function _chartToggleHidden(lid,lbl,visible){
  if(!_chartHidden[lid]) _chartHidden[lid]=new Set();
  visible?_chartHidden[lid].delete(lbl):_chartHidden[lid].add(lbl);
  if(_chartRedrawFns[lid]) _chartRedrawFns[lid]();
}
function _isHidden(lid,lbl){ return !!(_chartHidden[lid]&&_chartHidden[lid].has(lbl)); }

function _chartTooltipEl(){
  let t=document.getElementById('_chart_tip');
  if(!t){
    t=document.createElement('div');
    t.id='_chart_tip';
    t.style.cssText='position:fixed;background:var(--surface);border:1px solid var(--border2);padding:7px 11px;font-family:"Space Mono",monospace;font-size:9px;color:var(--text);pointer-events:none;display:none;z-index:9000;line-height:1.9;max-width:260px;box-shadow:0 4px 20px rgba(0,0,0,.6)';
    document.body.appendChild(t);
  }
  return t;
}

function _attachTooltip(canvasId){
  const cv=document.getElementById(canvasId); if(!cv) return;
  cv.onmousemove=function(e){
    const meta=_chartMeta[canvasId]; if(!meta) return;
    const rect=cv.getBoundingClientRect();
    const mx=e.clientX-rect.left;
    const {P,days,startDay}=meta;
    const cW=rect.width-P.l-P.r; // CSS-pixel width (canvas backing store is dpr-scaled)
    // Find day index from mouse x
    const rawIdx=(mx-P.l)/cW*(days-1);
    const idx=Math.max(0,Math.min(days-1,Math.round(rawIdx)));
    const simDate=new Date(S.simCfg.start_date+'T00:00:00');
    simDate.setDate(simDate.getDate()+startDay-1+idx);
    const dateStr=simDate._ymd();

    let html=`<div style="color:var(--text-dim);margin-bottom:3px;border-bottom:1px solid var(--border);padding-bottom:3px">${dateStr} · Day ${startDay+idx}</div>`;

    // Production bars
    (meta.series||[]).forEach(s=>{
      const v=s.data[idx]; if(!v&&v!==0) return;
      const disp=v>=1000?(v/1000).toFixed(1)+'k t':v>0?Math.round(v)+' t':'—';
      if(v>0) html+=`<div><span style="color:${s.col}">▪</span> ${s.label}: <span style="color:${s.col};font-weight:600">${disp}</span></div>`;
    });
    // Demand bars
    (meta.demandSeries||[]).forEach(s=>{
      const v=s.data[idx]; if(!v) return;
      const disp=v>=1000?(v/1000).toFixed(1)+'k t':Math.round(v)+' t';
      html+=`<div><span style="color:${s.col}">□</span> ${s.label}: <span style="color:${s.col}">${disp}</span></div>`;
    });
    // Legacy line series (requirement/demand lines for clinker chart)
    (meta.lines||[]).forEach(s=>{
      const v=Array.isArray(s.data)?s.data[idx]:s.val;
      if(v==null) return;
      const disp=v>=1000?(v/1000).toFixed(1)+'k t':Math.round(v)+' t';
      html+=`<div><span style="color:${s.col}">╌</span> ${s.label}: <span style="color:${s.col}">${disp}</span></div>`;
    });
    // Vessel arrivals
    (meta.vesselArr||[]).forEach(s=>{
      const v=s.data[idx]; if(!v) return;
      const disp=v>=1000?(v/1000).toFixed(1)+'k t':Math.round(v)+' t';
      html+=`<div><span style="color:${s.col}">⬛</span> ${s.label}: <span style="color:${s.col}">${disp}</span></div>`;
    });
    // Rail arrivals/loaded
    (meta.railArr||[]).forEach(s=>{
      const v=s.data[idx]; if(!v) return;
      const disp=v>=1000?(v/1000).toFixed(1)+'k t':Math.round(v)+' t';
      html+=`<div><span style="color:${s.col}">⬛</span> ${s.label}: <span style="color:${s.col}">${disp}</span></div>`;
    });
    // Inventory areas (right axis)
    if(meta.dualAxis){
      (meta.invLines||[]).forEach(s=>{
        const v=s.data[idx]; if(v==null) return;
        const disp=v>=1000?(v/1000).toFixed(1)+'k t':Math.round(v)+' t';
        html+=`<div><span style="color:${s.col}">◆</span> ${s.label}: <span style="color:${s.col}">${disp}</span> <span style="color:var(--grey);font-size:8px">inv</span></div>`;
      });
    }
    // Rail mode: dispatch bars
    if(meta.railMode){
      (meta.dispSeries||[]).forEach(s=>{
        const v=s.data[idx]; if(!v) return;
        html+=`<div><span style="color:${s.col}">▼</span> ${s.label}: <span style="color:${s.col}">${v} cars dispatched</span></div>`;
      });
    }

    const tip=_chartTooltipEl();
    tip.innerHTML=html;
    tip.style.display='block';
    const tx=Math.min(e.clientX+14, window.innerWidth-280);
    const ty=Math.max(8, e.clientY-40);
    tip.style.left=tx+'px'; tip.style.top=ty+'px';
  };
  cv.onmouseleave=()=>{ _chartTooltipEl().style.display='none'; };
}


// ── Shared drawing helpers ──────────────────────────────
function _chartSetup(id,heightFallback){
  const cv=document.getElementById(id); if(!cv) return null;
  const W=cv.offsetWidth||800, H=parseInt(cv.style.height)||heightFallback||160;
  const dpr=window.devicePixelRatio||1;      // HiDPI: crisp rendering at device resolution
  cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
  const P={t:14,r:16,b:28,l:56};
  const ctx=cv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);          // draw in CSS-pixel coords, backing store scaled by dpr
  ctx.clearRect(0,0,W,H);
  const cW=W-P.l-P.r,cH=H-P.t-P.b;
  // Grid
  ctx.strokeStyle=_tc('rgba(255,255,255,0.04)'); ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=P.t+(cH/4)*i;ctx.beginPath();ctx.moveTo(P.l,y);ctx.lineTo(P.l+cW,y);ctx.stroke();}
  return {cv,ctx,W,H,P,cW,cH};
}

function _drawYAxis(ctx,P,cH,maxVal,minVal){
  ctx.fillStyle=_tc('#6b7a96'); ctx.font='8px Space Mono'; ctx.textAlign='right';
  const range=maxVal-(minVal||0);
  for(let i=0;i<=4;i++){
    const v=(minVal||0)+range*(1-i/4);
    const y=P.t+(cH/4)*i;
    const lbl=Math.abs(v)>=1000?(v/1000).toFixed(1)+'k':Math.round(v);
    ctx.fillText(lbl,P.l-4,y+3);
  }
}

function _drawXAxis(ctx,P,W,H,cW,cH,days,startDay){
  ctx.strokeStyle=_tc('rgba(255,255,255,0.08)'); ctx.lineWidth=1; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(P.l,P.t); ctx.lineTo(P.l,P.t+cH); ctx.lineTo(P.l+cW,P.t+cH); ctx.stroke();
  ctx.fillStyle=_tc('#6b7a96'); ctx.font='8px Space Mono'; ctx.textAlign='center';
  const labelCount=Math.min(8,days);
  const simStart=new Date(S.simCfg.start_date+'T12:00:00'); // noon-anchored, DST-safe (see simStartDate)
  for(let i=0;i<=labelCount;i++){
    const dIdx=Math.round(i/labelCount*(days-1));
    const x=P.l+(dIdx/(days-1||1))*cW;
    const d=new Date(simStart.getTime()+(startDay-1+dIdx)*864e5);
    ctx.fillText(d._ymd().slice(5),x,H-6);
  }
}

function _drawLegend(legendId,series,lines){
  const el=document.getElementById(legendId); if(!el) return;
  const makeItem=(s,defaultSym)=>{
    const sym=s.sym||defaultSym;
    const hid=_isHidden(legendId,s.label);
    const esc=s.label.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `<label style="display:inline-flex;align-items:center;gap:3px;cursor:pointer;font-family:var(--mono);font-size:8px;color:${s.col};margin-left:7px;opacity:${hid?.4:1};white-space:nowrap;font-weight:400">` +
      `<input type="checkbox" ${hid?'':'checked'} style="accent-color:${s.col};width:9px;height:9px;cursor:pointer;flex-shrink:0" ` +
      `onchange="this.closest('label').style.opacity=this.checked?1:.4;_chartToggleHidden('${legendId}','${esc}',this.checked)">` +
      `${sym} ${s.label}</label>`;
  };
  el.innerHTML=[...(series||[]).map(s=>makeItem(s,'■')),...(lines||[]).map(s=>makeItem(s,'╌'))].join('');
}

// ── INVENTORY CHART (line chart) ──────────────────────

// ── PRODUCTION BAR CHART (clinker or cement) ─────────
// ── CLINKER CHART — dual Y-axis: left=production, right=inventory ──
let _clkSimResults=null; // cache last results for redraw on scale change






// ── Right-panel legend helper ──────────────────────────────────────
function _drawLegendPanel(panelId, groups){
  const panel=document.getElementById(panelId); if(!panel) return;
  panel.innerHTML=groups.filter(g=>g.items.length).map(g=>`
    <div>
      <div style="font-family:var(--mono);font-size:7px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">${g.title}</div>
      <div style="display:flex;flex-direction:column;gap:3px">
        ${g.items.map(it=>{
          const hidden=_isHidden(panelId,it.label);
          const safeLabel=it.label.replace(/'/g,"\\'");
          return `<div style="display:flex;align-items:center;gap:5px;font-family:var(--mono);font-size:8px;color:var(--text-dim);white-space:nowrap;cursor:pointer;opacity:${hidden?0.35:1}"
               onclick="_chartToggleHidden('${panelId}','${safeLabel}',${hidden})"
               title="${it.label}">
            <span style="width:10px;height:10px;border-radius:1px;background:${it.col};flex-shrink:0;opacity:${hidden?0.25:1}"></span>
            <span>${it.label}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

function _drawClinkerChart(id, r){
  if(!r) return;
  const cv=document.getElementById(id); if(!cv) return;
  const W=cv.offsetWidth||800, H=cv.offsetHeight||220;
  const dpr=window.devicePixelRatio||1;      // HiDPI: render backing store at device resolution → crisp text/lines
  cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
  const LEGEND_W=130; // reserved for right legend panel (drawn in HTML, not canvas)
  const P={t:16, r:48, b:30, l:58};
  const cW=W-P.l-P.r, cH=H-P.t-P.b;
  const ctx=cv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);          // draw in CSS-pixel coords, backing store scaled by dpr
  ctx.clearRect(0,0,W,H);

  const {startDay,endDay}=getViewRange();
  const days=endDay-startDay+1;
  if(days<1) return;   // no simulated days in the time frame — leave the canvas blank
  const fac=getResultElements();

  const prodCols=['#00ff9d','#ff3d5a','#ff8c42','#4da6ff','#cc7aff','#ffb830'].map(_tc);
  const demCols =['#ffb830','#cc7aff','#4da6ff','#ff8c42'].map(_tc);
  const invCols =['#38bdf8','#4da6ff','#a78bfa','#fb923c'].map(_tc);

  const legendId=id==='dash-clk-chart'?'dash-clk-legend':'clk-chart-legend';

  // Helper to get actual or simulated production for chart
  const getChartProduction=(elId, dayOffset)=>{
    const simStart=new Date(S.simCfg.start_date+'T12:00:00'); // noon-anchored, DST-safe (see simStartDate)
    const currentDate=new Date(simStart.getTime()+(dayOffset-1)*864e5);
    const dateStr=currentDate._ymd();

    // Check for ACTUAL production first
    const realProduction=_idxRows('real_production_daily','element_id',elId,'date',dateStr); // read-only
    if(realProduction.length>0){
      return realProduction.reduce((sum,rp)=>sum+(parseFloat(rp.volume_t)||0),0);
    }

    // Fall back to simulated
    const st=(r.elementStates[elId]||[])[dayOffset-1]||'idle';
    return (st==='running'||st==='rampup')?1:0; // Return 1 if running, 0 if idle (will be multiplied by capacity)
  };

  // ── Build production series (kilns) ──
  const prodSeries=[];
  fac.filter(e=>e.type==='kiln').forEach((el,ki)=>{
    const caps=DB.element_product_capacities.filter(c=>c.element_id===el.id);
    if(caps.length){
      caps.forEach((cap,ci)=>{
        const prod=DB.products.find(p=>p.id===cap.product_id);
        const label=`${el.name}${caps.length>1?' — '+(prod?.name||cap.product_id):''}`;
        const data=[];
        for(let d=startDay;d<=endDay;d++){
          const actualVal=getChartProduction(el.id, d);
          // If there's actual data, use it; otherwise use capacity * state
          if(actualVal>0 && actualVal!==1){
            data.push(actualVal); // Actual production value
          } else {
            const st=(r.elementStates[el.id]||[])[d-1]||'idle';
            data.push((st==='running'||st==='rampup')?(parseFloat(cap.capacity_tpd)||0):0);
          }
        }
        prodSeries.push({label, data, col:prodCols[(ki*3+ci)%prodCols.length]});
      });
    } else {
      const data=[];
      for(let d=startDay;d<=endDay;d++){
        const actualVal=getChartProduction(el.id, d);
        if(actualVal>0 && actualVal!==1){
          data.push(actualVal);
        } else {
          const st=(r.elementStates[el.id]||[])[d-1]||'idle';
          data.push((st==='running'||st==='rampup')?(parseFloat(el.props.rated_capacity_tpd)||0):0);
        }
      }
      prodSeries.push({label:el.name, data, col:prodCols[ki%prodCols.length]});
    }
  });

  // ── Build demand series (clinker requirement from finish mills) ──
  const demSeries=[];
  const clkReqByProd={};
  fac.filter(e=>e.type==='finish_mill').forEach(mill=>{
    DB.element_product_capacities.filter(c=>c.element_id===mill.id).forEach(cap=>{
      DB.recipes.filter(rc=>rc.product_id===cap.product_id&&parseFloat(rc.pct)>0).forEach(ri=>{
        if(DB.products.find(p=>p.id===ri.material_id)?.category!=='clinker') return;
        const daily=(parseFloat(cap.capacity_tpd)||0)*(parseFloat(ri.pct)||0)/100;
        clkReqByProd[ri.material_id]=(clkReqByProd[ri.material_id]||0)+daily;
      });
    });
  });
  Object.entries(clkReqByProd).forEach(([pid,daily],i)=>{
    const prod=DB.products.find(p=>p.id===pid);
    demSeries.push({label:`Req: ${prod?.name||pid}`, data:Array(days).fill(daily), col:demCols[i%demCols.length]});
  });

  // Helper to get actual or simulated inventory for chart
  const getChartInventory=(elId, dayOffset)=>{
    const simStart=new Date(S.simCfg.start_date+'T12:00:00'); // noon-anchored, DST-safe (see simStartDate)
    const currentDate=new Date(simStart.getTime()+(dayOffset-1)*864e5);
    const dateStr=currentDate._ymd();
    const prevDate=new Date(currentDate.getTime()-864e5);
    const prevDateStr=prevDate._ymd();

    // Check for ACTUAL inventory - BOD inventory = EOD of previous day
    // So ONLY check previous day's real inventory (never check current date)
    let realInv=null;
    if(dayOffset>1){
      realInv=_idxFirst('real_inventory_daily','silo_id',elId,'date',prevDateStr);
    }
    if(realInv) return parseFloat(realInv.eod_volume_t)||0;

    // Fall back to simulated
    const h=r.inventoryHistory[elId]||[];
    return dayOffset>1?(h[dayOffset-2]??0):parseFloat(DB.elements.find(e=>e.id===elId)?.props?.start_inventory)||0;
  };

  // ── Build inventory series (clinker silos, stacked) ──
  const invSeries=[];
  fac.filter(e=>e.type==='bulk_silo'&&isClinkerSilo(e)).forEach((el,i)=>{
    const hist=[];
    for(let d=startDay;d<=endDay;d++){
      hist.push(getChartInventory(el.id, d));
    }
    if(hist.some(v=>v>0))
      invSeries.push({label:el.name, data:hist, col:invCols[i%invCols.length]});
  });

  // ── Visibility ──
  const visProd=prodSeries.filter(s=>!_isHidden(legendId,s.label));
  const visDem =demSeries.filter(s=>!_isHidden(legendId,s.label));
  const visInv =invSeries.filter(s=>!_isHidden(legendId,s.label));

  // ── Scales ──
  const userProdMax=parseFloat(document.getElementById(id==='dash-clk-chart'?'dash-clk-prod-max':'clk-prod-max')?.value)||0;
  const userInvMax =parseFloat(document.getElementById(id==='dash-clk-chart'?'dash-clk-inv-max':'clk-inv-max')?.value)||0;

  // Left axis: stacked prod + stacked dem side by side → max = max(sumProd, sumDem) per day
  const maxProdPerDay=Array.from({length:days},(_,i)=>visProd.reduce((s,ser)=>s+(ser.data[i]||0),0));
  const maxDemPerDay =Array.from({length:days},(_,i)=>visDem.reduce((s,ser)=>s+(ser.data[i]||0),0));
  const autoLeft=Math.max(...maxProdPerDay,...maxDemPerDay,1)*1.15;
  const prodMax=userProdMax||autoLeft;

  // Right axis: inventory is a LEVEL, not a flow — each silo is drawn from the zero
  // baseline (NOT stacked), so a silo running to 0 is always visible regardless of which
  // other silos are shown. Scale to the largest single silo, not the sum.
  const maxInvPerDay=Array.from({length:days},(_,i)=>Math.max(0,...visInv.map(ser=>ser.data[i]||0)));
  const autoInv=Math.max(...maxInvPerDay,1)*1.1;
  const invMax=userInvMax||autoInv;

  // ── Grid ──
  ctx.strokeStyle=_tc('rgba(255,255,255,0.04)'); ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=P.t+(cH/4)*i;
    ctx.beginPath(); ctx.moveTo(P.l,y); ctx.lineTo(P.l+cW,y); ctx.stroke();
  }

  // ── Left Y-axis labels ──
  ctx.fillStyle=_tc('rgba(100,150,100,0.7)'); ctx.font='8px Space Mono'; ctx.textAlign='right';
  for(let i=0;i<=4;i++){
    const v=prodMax*(1-i/4);
    ctx.fillText(v>=1000?(v/1000).toFixed(1)+'k':Math.round(v), P.l-5, P.t+(cH/4)*i+3);
  }
  ctx.save(); ctx.fillStyle=_tc('rgba(100,150,100,0.4)'); ctx.font='7px Space Mono'; ctx.textAlign='center';
  ctx.translate(10,P.t+cH/2); ctx.rotate(-Math.PI/2); ctx.fillText('PROD t/d',0,0); ctx.restore();

  // ── Right Y-axis labels ──
  ctx.fillStyle=_tc('rgba(56,189,248,0.6)'); ctx.font='8px Space Mono'; ctx.textAlign='left';
  for(let i=0;i<=4;i++){
    const v=invMax*(1-i/4);
    ctx.fillText(v>=1000?(v/1000).toFixed(0)+'k':Math.round(v), P.l+cW+5, P.t+(cH/4)*i+3);
  }
  ctx.save(); ctx.fillStyle=_tc('rgba(56,189,248,0.35)'); ctx.font='7px Space Mono'; ctx.textAlign='center';
  ctx.translate(W-8,P.t+cH/2); ctx.rotate(Math.PI/2); ctx.fillText('INV t',0,0); ctx.restore();

  // ── Draw: inventory areas (each from the zero baseline, overlapping — NOT stacked) ──
  if(visInv.length){
    const baseY=P.t+cH; // zero line
    visInv.forEach((ser)=>{
      const col=ser.col;
      ctx.beginPath();
      for(let i=0;i<days;i++){
        const x=P.l+(i+0.5)*(cW/days);
        const y=P.t+cH-(Math.min(ser.data[i]||0,invMax)/invMax)*cH;
        i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      for(let i=days-1;i>=0;i--){ ctx.lineTo(P.l+(i+0.5)*(cW/days),baseY); }
      ctx.closePath();
      ctx.globalAlpha=0.14; ctx.fillStyle=_tc(col); ctx.fill(); ctx.globalAlpha=1;
      // Top border line
      ctx.beginPath();
      for(let i=0;i<days;i++){
        const x=P.l+(i+0.5)*(cW/days);
        const y=P.t+cH-(Math.min(ser.data[i]||0,invMax)/invMax)*cH;
        i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      ctx.strokeStyle=_tc(col); ctx.lineWidth=1.5; ctx.setLineDash([]); ctx.stroke();
    });
  }

  // ── Draw: stacked production + demand bars (flush) ──
  const slotW=cW/days;
  const usedW=slotW*0.72;       // total bar group width per day
  const halfGroup=usedW/2;       // half = prod half, half = dem half
  const barW=halfGroup;          // each sub-group width

  for(let i=0;i<days;i++){
    const slotCenter=P.l+(i+0.5)*slotW;
    const prodX=slotCenter-halfGroup;
    const demX =slotCenter;       // flush right of prod

    // Stacked production bars (left half)
    let prodBase=0;
    visProd.forEach(ser=>{
      const v=ser.data[i]||0; if(!v) return;
      const bH=(Math.min(v,prodMax)/prodMax)*cH;
      const y=P.t+cH-(prodBase/prodMax)*cH-bH;
      ctx.globalAlpha=0.82; ctx.fillStyle=_tc(ser.col);
      ctx.fillRect(prodX, y, Math.max(0.5,barW-0.5), bH);
      ctx.globalAlpha=1;
      prodBase+=v;
    });

    // Stacked demand bars (right half, flush)
    let demBase=0;
    visDem.forEach(ser=>{
      const v=ser.data[i]||0; if(!v) return;
      const bH=(Math.min(v,prodMax)/prodMax)*cH;
      const y=P.t+cH-(demBase/prodMax)*cH-bH;
      ctx.globalAlpha=0.78; ctx.fillStyle=_tc(ser.col);
      ctx.fillRect(demX, y, Math.max(0.5,barW-0.5), bH);
      ctx.globalAlpha=1;
      demBase+=v;
    });
  }

  // ── Axes ──
  ctx.strokeStyle=_tc('rgba(255,255,255,0.08)'); ctx.lineWidth=1; ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(P.l,P.t); ctx.lineTo(P.l,P.t+cH); ctx.lineTo(P.l+cW,P.t+cH);
  ctx.moveTo(P.l+cW,P.t); ctx.lineTo(P.l+cW,P.t+cH);
  ctx.stroke();

  // ── X-axis labels ──
  ctx.fillStyle=_tc('#6b7a96'); ctx.font='8px Space Mono'; ctx.textAlign='center';
  const simStart=new Date(S.simCfg.start_date+'T12:00:00'); // noon-anchored, DST-safe (see simStartDate)
  const labelCount=Math.min(10,days);
  for(let i=0;i<=labelCount;i++){
    const dIdx=Math.round(i/labelCount*(days-1));
    const x=P.l+(dIdx+0.5)*slotW;
    const d=new Date(simStart.getTime()+(startDay-1+dIdx)*864e5);
    ctx.fillText(d._ymd().slice(5),x,H-8);
  }

  // ── Store meta ──
  _chartMeta[id]={series:visProd,demSeries:visDem,invLines:visInv,invMax,prodMax,days,startDay,P,dualAxis:true};

  // ── Right-panel legend ──
  _drawLegendPanel(legendId,[
    {title:'Inventory', items:invSeries.map(s=>({label:s.label,col:s.col}))},
    {title:'Production',items:prodSeries.map(s=>({label:s.label,col:s.col}))},
    {title:'Demand',    items:demSeries.map(s=>({label:s.label,col:s.col}))},
  ]);
}

function _drawProdBarChart(id,r,type){
  const g=_chartSetup(id,180); if(!g) return;
  const {cv,ctx,W,H,P,cW,cH}=g;
  const {startDay,endDay}=getViewRange();
  const days=endDay-startDay+1;
  if(days<1) return;   // no simulated days in the time frame — leave the canvas blank
  const fac=getResultElements();
  const cols=['#00ff9d','#ff8c42','#4da6ff','#ff3d5a','#cc7aff','#ffb830'].map(_tc);

  // Build bar series (production per product per day)
  const barSeries=[];
  const lineSeries=[];

  if(type==='clinker'){
    // One bar series per kiln × product capacity
    fac.filter(e=>e.type==='kiln').forEach((el,ki)=>{
      const caps=DB.element_product_capacities.filter(c=>c.element_id===el.id);
      caps.forEach((cap,ci)=>{
        const prod=DB.products.find(p=>p.id===cap.product_id);
        const data=[];
        for(let d=startDay;d<=endDay;d++){
          const st=(r.elementStates[el.id]||[])[d-1]||'idle';
          data.push((st==='running'||st==='rampup')?(parseFloat(cap.capacity_tpd)||0):0);
        }
        const colIdx=(ki*3+ci)%cols.length;
        barSeries.push({label:`${el.name} — ${prod?.name||cap.product_id}`,data,col:cols[colIdx]});
      });
      // Fallback: no caps defined — use rated capacity
      if(!caps.length){
        const data=[];
        for(let d=startDay;d<=endDay;d++){
          const st=(r.elementStates[el.id]||[])[d-1]||'idle';
          data.push((st==='running'||st==='rampup')?(parseFloat(el.props.rated_capacity_tpd)||0):0);
        }
        barSeries.push({label:el.name,data,col:cols[ki%cols.length]});
      }
    });
    // Requirement lines: total clinker consumed by finish mills per product
    const clkReqByProd={};
    fac.filter(e=>e.type==='finish_mill').forEach(mill=>{
      const caps=DB.element_product_capacities.filter(c=>c.element_id===mill.id);
      caps.forEach(cap=>{
        const recipe=DB.recipes.filter(rc=>rc.product_id===cap.product_id&&parseFloat(rc.pct)>0);
        recipe.forEach(ri=>{
          const mat=DB.products.find(p=>p.id===ri.material_id)||DB.raw_materials.find(m=>m.id===ri.material_id);
          const isClinker=DB.products.find(p=>p.id===ri.material_id)?.category==='clinker';
          if(!isClinker) return;
          const daily=(parseFloat(cap.capacity_tpd)||0)*(parseFloat(ri.pct)||0)/100;
          clkReqByProd[ri.material_id]=(clkReqByProd[ri.material_id]||0)+daily;
        });
      });
    });
    Object.entries(clkReqByProd).forEach(([pid,daily],i)=>{
      const prod=DB.products.find(p=>p.id===pid);
      lineSeries.push({label:`Req: ${prod?.name||pid}`,val:daily,data:Array(days).fill(daily),col:_tc('#ffb830')});
    });

  } else { // cement
    const legendId2=id==='dash-cem-chart'?'dash-cem-legend':id==='prod-chart'?'prod-chart-legend':'prod-chart-legend';

    // ── Production: one series per finish mill per product ──
    const prodSeries=[];
    const prodCols=['#00ff9d','#ff3d5a','#ff8c42','#4da6ff','#cc7aff','#ffb830'].map(_tc);
    fac.filter(e=>e.type==='finish_mill').forEach((mill,mi)=>{
      const caps=DB.element_product_capacities.filter(c=>c.element_id===mill.id);
      caps.forEach((cap,ci)=>{
        const prod=DB.products.find(p=>p.id===cap.product_id);
        const data=[];
        for(let d=startDay;d<=endDay;d++){
          const actual=(r.millProductHistory?.[mill.id]||[])[d-1]===cap.product_id;
          data.push(actual?(parseFloat(cap.capacity_tpd)||0):0);
        }
        prodSeries.push({label:`${mill.name}${caps.length>1?' — '+(prod?.name||cap.product_id):''}`,data,col:prodCols[(mi*3+ci)%prodCols.length]});
      });
    });

    // ── Demand: one series per demand point per product ──
    const demSeries=[];
    const demCols=['#ffb830','#cc7aff','#4da6ff','#ff8c42','#00ff9d','#ff3d5a'].map(_tc);
    const simBase=new Date(S.simCfg.start_date+'T12:00:00'); // noon-anchored, DST-safe (see simStartDate)
    DB.demand_points.filter(dp=>{
      const dpEl=DB.elements.find(e=>e.id===dp.element_id); if(!dpEl) return false;
      const _rf=fltFacIdSet();
      if(_rf) return _rf.has(dpEl.assigned_facility_id);
      return dp.facility_id===S.facility_id&&(!dpEl.assigned_facility_id||dpEl.assigned_facility_id===S.facility_id);
    }).forEach((dp,di)=>{
      const dpEl=DB.elements.find(e=>e.id===dp.element_id); if(!dpEl) return;
      dp.products.forEach((pp,pi)=>{
        const prod=DB.products.find(p=>p.id===pp.product_id);
        const data=[];
        for(let d=startDay;d<=endDay;d++){
          const dt=new Date(simBase.getTime()+(d-1)*864e5);
          data.push(_demandRate(dpEl.id,dt._ymd()));
        }
        const facName=DB.facilities.find(f=>f.id===(dpEl.assigned_facility_id||S.facility_id))?.name||'';
        const facPrefix=!fltFacIdSet()&&facName?`${facName} — `:'';
        demSeries.push({label:`${facPrefix}${prod?.name||pp.product_id}`,data,col:demCols[(di*2+pi)%demCols.length]});
      });
    });

    // ── Inventory: cement silos, stacked areas ──
    const invColsFill=['#4da6ff','#a78bfa','#fb923c','#38bdf8'].map(_tc);
    const invSeries=[];
    const cemSilos=fac.filter(e=>e.type==='bulk_silo'&&isCementSilo(e));
    cemSilos.forEach((silo,si)=>{
      const hist=[];
      for(let d=startDay;d<=endDay;d++){
        const h=r.inventoryHistory?.[silo.id]||[];
        hist.push(d>1?(h[d-2]??0):parseFloat(silo.props?.start_inventory)||0);
      }
      if(hist.some(v=>v>0))
        invSeries.push({label:silo.name,data:hist,col:invColsFill[si%invColsFill.length]});
    });

    // ── Visibility ──
    const visProd=prodSeries.filter(s=>!_isHidden(legendId2,s.label));
    const visDem =demSeries.filter(s=>!_isHidden(legendId2,s.label));
    const visInv =invSeries.filter(s=>!_isHidden(legendId2,s.label));

    // ── Scales ──
    const lmaxEl=document.getElementById(id==='dash-cem-chart'?'dash-cem-chart-lmax':id+'-lmax');
    const rmaxEl=document.getElementById(id==='dash-cem-chart'?'dash-cem-chart-rmax':id+'-rmax');
    const userLeft =lmaxEl&&parseFloat(lmaxEl.value)>0?parseFloat(lmaxEl.value):0;
    const userRight=rmaxEl&&parseFloat(rmaxEl.value)>0?parseFloat(rmaxEl.value):0;
    const maxProdPerDay=Array.from({length:days},(_,i)=>visProd.reduce((s,ser)=>s+(ser.data[i]||0),0));
    const maxDemPerDay =Array.from({length:days},(_,i)=>visDem.reduce((s,ser)=>s+(ser.data[i]||0),0));
    const autoLeft=Math.max(...maxProdPerDay,...maxDemPerDay,1)*1.15;
    const prodMax=userLeft||autoLeft;
    // Inventory is a LEVEL, not a flow: each silo is drawn from the zero baseline (NOT
    // stacked), so a silo running to 0 is always visible regardless of which other silos
    // are shown. Scale to the largest single silo, not the sum.
    const maxInvPerDay=Array.from({length:days},(_,i)=>Math.max(0,...visInv.map(ser=>ser.data[i]||0)));
    const autoInv=Math.max(...maxInvPerDay,1)*1.1;
    const invMax=userRight||autoInv;
    const hasInv=visInv.length>0;
    const PR=hasInv?48:P.r;
    const cWadj=W-P.l-PR;

    // ── Grid ──
    ctx.strokeStyle=_tc('rgba(255,255,255,0.04)'); ctx.lineWidth=1;
    for(let i=0;i<=4;i++){
      const y=P.t+(cH/4)*i;
      ctx.beginPath(); ctx.moveTo(P.l,y); ctx.lineTo(P.l+cWadj,y); ctx.stroke();
    }

    // ── Left Y-axis ──
    _drawYAxis(ctx,P,cH,prodMax,0);

    // ── Right Y-axis ──
    if(hasInv){
      ctx.fillStyle=_tc('rgba(56,189,248,0.6)'); ctx.font='8px Space Mono'; ctx.textAlign='left';
      for(let i=0;i<=4;i++){
        const v=invMax*(1-i/4);
        ctx.fillText(v>=1000?(v/1000).toFixed(0)+'k':Math.round(v),P.l+cWadj+5,P.t+(cH/4)*i+3);
      }
    }

    // ── Draw: inventory areas (each from the zero baseline, overlapping — NOT stacked) ──
    if(hasInv){
      const baseY=P.t+cH; // zero line
      visInv.forEach(ser=>{
        ctx.beginPath();
        for(let i=0;i<days;i++){
          const x=P.l+(i+0.5)*(cWadj/days);
          const y=P.t+cH-(Math.min(ser.data[i]||0,invMax)/invMax)*cH;
          i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
        }
        for(let i=days-1;i>=0;i--){ ctx.lineTo(P.l+(i+0.5)*(cWadj/days),baseY); }
        ctx.closePath();
        ctx.globalAlpha=0.12; ctx.fillStyle=_tc(ser.col); ctx.fill(); ctx.globalAlpha=1;
        ctx.beginPath();
        for(let i=0;i<days;i++){
          const x=P.l+(i+0.5)*(cWadj/days);
          const y=P.t+cH-(Math.min(ser.data[i]||0,invMax)/invMax)*cH;
          i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
        }
        ctx.strokeStyle=_tc(ser.col); ctx.lineWidth=1.5; ctx.setLineDash([]); ctx.stroke();
      });
    }

    // ── Draw: stacked prod + demand bars (flush) ──
    const slotW=cWadj/days;
    const usedW=slotW*0.72;
    const halfGroup=usedW/2;

    for(let i=0;i<days;i++){
      const slotCenter=P.l+(i+0.5)*slotW;
      const prodX=slotCenter-halfGroup;
      const demX =slotCenter;

      let prodBase=0;
      visProd.forEach(ser=>{
        const v=ser.data[i]||0; if(!v) return;
        const bH=(Math.min(v,prodMax)/prodMax)*cH;
        const y=P.t+cH-(prodBase/prodMax)*cH-bH;
        ctx.globalAlpha=0.82; ctx.fillStyle=_tc(ser.col);
        ctx.fillRect(prodX,y,Math.max(0.5,halfGroup-0.5),bH);
        ctx.globalAlpha=1; prodBase+=v;
      });

      let demBase=0;
      visDem.forEach(ser=>{
        const v=ser.data[i]||0; if(!v) return;
        const bH=(Math.min(v,prodMax)/prodMax)*cH;
        const y=P.t+cH-(demBase/prodMax)*cH-bH;
        ctx.globalAlpha=0.78; ctx.fillStyle=_tc(ser.col);
        ctx.fillRect(demX,y,Math.max(0.5,halfGroup-0.5),bH);
        ctx.globalAlpha=1; demBase+=v;
      });
    }

    // ── Axes ──
    ctx.strokeStyle=_tc('rgba(255,255,255,0.08)'); ctx.lineWidth=1; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(P.l,P.t); ctx.lineTo(P.l,P.t+cH); ctx.lineTo(P.l+cWadj,P.t+cH);
    ctx.moveTo(P.l+cWadj,P.t); ctx.lineTo(P.l+cWadj,P.t+cH);
    ctx.stroke();

    _drawXAxis(ctx,P,W,H,cWadj,cH,days,startDay);

    _chartMeta[id]={series:visProd,demSeries:visDem,invLines:visInv,invMax,prodMax,days,startDay,P:{...P,r:PR},dualAxis:hasInv};

    // ── Right-panel legend ──
    _drawLegendPanel(legendId2,[
      {title:'Inventory', items:invSeries.map(s=>({label:s.label,col:s.col}))},
      {title:'Production',items:prodSeries.map(s=>({label:s.label,col:s.col}))},
      {title:'Demand',    items:demSeries.map(s=>({label:s.label,col:s.col}))},
    ]);
    return;
  }

  if(!barSeries.length&&!lineSeries.length){
    ctx.fillStyle=_tc('#4a5568');ctx.font='9px Space Mono';ctx.textAlign='center';ctx.fillText('No data',W/2,H/2);return;
  }

  // Max value
  const allBar=barSeries.flatMap(s=>s.data).filter(v=>v>0);
  const allLine=lineSeries.flatMap(s=>s.data||[s.val]).filter(v=>v>0);
  const maxVal=Math.max(...allBar,...allLine,1)*1.12;

  _drawYAxis(ctx,P,cH,maxVal,0);

  // Bars — grouped by day
  const nSeries=barSeries.length||1;
  const slotW=cW/days;
  const groupW=Math.max(1,slotW*0.85);
  const bW=Math.max(0.5,groupW/nSeries);

  barSeries.forEach((s,si)=>{
    ctx.fillStyle=_tc(s.col);
    s.data.forEach((v,i)=>{
      if(!v) return;
      const groupX=P.l+i*slotW+(slotW-groupW)/2;
      const x=groupX+si*bW;
      const bH=(v/maxVal)*cH;
      const y=P.t+cH-bH;
      // Semi-transparent fill with glow on hover
      ctx.globalAlpha=0.75;
      ctx.fillRect(x,y,Math.max(0.5,bW-0.5),bH);
      ctx.globalAlpha=1;
    });
  });

  // Demand / requirement lines (dashed)
  lineSeries.forEach(s=>{
    const data=s.data||Array(days).fill(s.val);
    ctx.strokeStyle=_tc(s.col); ctx.lineWidth=1.5;
    ctx.setLineDash([5,3]); ctx.shadowBlur=4; ctx.shadowColor=s.col;
    ctx.beginPath();
    data.forEach((v,i)=>{
      const x=P.l+(i/(data.length-1||1))*cW;
      const y=P.t+cH-(Math.min(v,maxVal)/maxVal)*cH;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.stroke(); ctx.shadowBlur=0; ctx.setLineDash([]);
  });

  _drawXAxis(ctx,P,W,H,cW,cH,days,startDay);
  _chartMeta[id]={series:barSeries,lines:lineSeries,days,startDay,P};

  // Update legend in chart header
  const legendId=id==='clk-chart'?'clk-chart-legend':'prod-chart-legend';
  _drawLegend(legendId,barSeries,lineSeries);
}

// ── RAIL CHART (positive load bars + negative dispatch bars) ──

function renderEvLog(r){
  const {startDay,endDay}=getViewRange();
  const log=document.getElementById('ev-log'); if(!log) return;
  let h=`<div class="ev-row hdr"><span>Date</span><span>Element</span><span>Type</span><span>Cause</span></div>`;
  const resultElIds=new Set(getResultElements().map(e=>e.id));
  const filtered=r.stopEvents.filter(e=>e.day>=startDay&&e.day<=endDay&&(resultElIds.size===0||resultElIds.has(e.element_id)));
  if(!filtered.length){
    h+=`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding:12px">No events in this view window</div>`;
  } else {
    filtered.slice(0,120).forEach(ev=>{
      const color=ev.type==='maintenance'?'var(--blue)':
                  ev.type==='blocked'?'var(--red)':
                  ev.type==='rail_departure'?'var(--green)':
                  ev.type==='rail_delayed'?'var(--amber)':
                  ev.type==='purity_hold'?'var(--magenta)':
                  ev.type==='starved'?'var(--amber)':'var(--red)';
      h+=`<div class="ev-row">
        <span style="color:var(--text-dim)">${dayToDate(ev.day)}</span>
        <span>${ev.element_name}</span>
        <span style="color:${color};font-size:8px">${ev.type.replace(/_/g,' ')}</span>
        <span style="color:var(--text-dim)">${ev.cause}</span>
      </div>`;
    });
    if(filtered.length>120)
      h+=`<div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);padding:6px 10px">+${filtered.length-120} more events</div>`;
  }
  log.innerHTML=h;
}


// ═══════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════
function showModal(id){
  if(id==='product-modal'){S._editProductIdx=null;openProductModal(null);return;}
  if(id==='rawmat-modal'){showModalContent(rawMatHTML());return;}
  if(id==='fuel-modal'){showModalContent(fuelHTML());return;}
  if(id==='vessel-modal'){window._vcLegs=[];showModalContent(vesselHTML());_vcAddLeg();return;}
  if(id==='rail-modal'){showModalContent(railHTML());return;}
  if(id==='demand-modal'){showModalContent(demandHTML());return;}
  if(id==='facility-modal'){showModalContent(facilityHTML());return;}
  if(id==='sim-cfg-modal'){showModalContent(simCfgHTML());return;}
  // _custom: content already written to modal-content before this call — just show overlay
  if(id==='_custom'){document.getElementById('modal-overlay').classList.add('active');return;}
}

function showModalContent(html){
  document.getElementById('modal-content').classList.remove('ac-wide');
  document.getElementById('modal-content').innerHTML=html;
  document.getElementById('modal-overlay').classList.add('active');
}
function closeModal(){ document.getElementById('modal-overlay').classList.remove('active'); }
function overlayClick(e){ if(e.target===document.getElementById('modal-overlay')) closeModal(); }

function rawMatHTML(){ return `
  <div class="modal-hdr"><span class="modal-title">New Raw Material</span><span class="modal-close" onclick="closeModal()">✕</span></div>
  <div class="modal-body">
    <div class="fr s1"><div class="ff"><div class="fl">Name</div><input class="fi" id="rm-name" placeholder="e.g. Limestone"></div></div>
    <div class="fr"><div class="ff"><div class="fl">Unit</div><select class="fi" id="rm-unit"><option>tonnes</option><option>m³</option><option>kg</option></select></div>
      <div class="ff"><div class="fl">Notes</div><input class="fi" id="rm-notes" placeholder="Optional"></div></div>
  </div>
  <div class="modal-footer"><button class="btn-sec" onclick="closeModal()">Cancel</button>
    <button class="btn-pri" onclick="saveRawMat()">Save</button></div>`;}

function saveRawMat(){
  const name=document.getElementById('rm-name')?.value?.trim(); if(!name) return;
  DB.raw_materials.push({id:name.toLowerCase().replace(/\s+/g,'_'),name,unit:document.getElementById('rm-unit')?.value||'tonnes',notes:document.getElementById('rm-notes')?.value||''});
  autoSave(); closeModal(); renderCatalogView(); statMsg('Raw material saved');
}

function fuelHTML(){ return `
  <div class="modal-hdr"><span class="modal-title">New Fuel</span><span class="modal-close" onclick="closeModal()">✕</span></div>
  <div class="modal-body">
    <div class="fr"><div class="ff"><div class="fl">Name</div><input class="fi" id="fu-name" placeholder="e.g. Petroleum Coke"></div>
      <div class="ff"><div class="fl">Unit</div><select class="fi" id="fu-unit"><option>tonnes</option><option>m³</option></select></div></div>
    <div class="fr"><div class="ff"><div class="fl">Calorific Value (kCal/kg)</div><input class="fi" type="number" id="fu-cal" placeholder="8200"></div>
      <div class="ff"><div class="fl">CO₂ Factor (t/t fuel)</div><input class="fi" type="number" id="fu-co2" placeholder="3.4" step="0.01"></div></div>
    <div class="fr s1"><div class="ff"><div class="fl">Notes</div><input class="fi" id="fu-notes" placeholder="Optional"></div></div>
  </div>
  <div class="modal-footer"><button class="btn-sec" onclick="closeModal()">Cancel</button>
    <button class="btn-pri" onclick="saveFuel()">Save</button></div>`;}

function saveFuel(){
  const name=document.getElementById('fu-name')?.value?.trim(); if(!name) return;
  DB.fuels.push({id:name.toLowerCase().replace(/\s+/g,'_'),name,unit:document.getElementById('fu-unit')?.value||'tonnes',
    calorific_value:parseFloat(document.getElementById('fu-cal')?.value)||0,
    co2_factor:parseFloat(document.getElementById('fu-co2')?.value)||0,
    notes:document.getElementById('fu-notes')?.value||''});
  autoSave(); closeModal(); renderCatalogView(); statMsg('Fuel saved');
}

function vesselHTML(){
  const berths=getFacElements().filter(e=>e.type==='berth'&&(e.props.berth_type||'Ship Berth')==='Ship Berth')
    .map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('');
  const prods=DB.products.filter(p=>['cement_bulk','cement_packed','clinker','additive'].includes(p.category))
    .map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const pi='background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:10px;padding:5px 7px;outline:none;width:100%';
  return `
  <div class="modal-hdr"><span class="modal-title">Add Vessel Call</span><span class="modal-close" onclick="closeModal()">✕</span></div>
  <div class="modal-body">
    <div style="font-family:var(--mono);font-size:9px;color:var(--amber);padding:8px;background:rgba(var(--amber-rgb),.06);border:1px solid rgba(var(--amber-rgb),.2);margin-bottom:10px">
      ◆ External supply — no source inventory deducted. Cargo added to destination silo at berth unload rate.
    </div>
    <div class="fr">
      <div class="ff"><div class="fl">Vessel Name / Reference</div><input class="fi" id="vc-name" placeholder="MV Atlantic Star"></div>
      <div class="ff"><div class="fl">Product</div><select class="fi" id="vc-product"><option value="">-- Select --</option>${prods}</select></div>
    </div>
    <div class="fr">
      <div class="ff"><div class="fl">Total Cargo (t)</div><input class="fi" type="number" id="vc-total-qty" placeholder="30000" oninput="_vcUpdateSplitTotal()"></div>
      <div class="ff"><div class="fl">Status</div>
        <select class="fi" id="vc-status">${TRANSPORT_STATUSES.map(s=>`<option value="${s.id}" ${s.id==='Planned'?'selected':''}>${s.id}</option>`).join('')}</select>
      </div>
    </div>
    <div class="fr s1"><div class="ff"><div class="fl">Notes</div><input class="fi" id="vc-notes" placeholder="Optional"></div></div>
    ${sofTermsFieldsHTML('vc',{})}

    <div style="margin-top:10px;padding:8px;border:1px solid var(--border2)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">PORTS OF CALL</div>
        <span class="tbl-act" onclick="_vcAddLeg()">+ Add Port</span>
      </div>
      <div id="vc-legs-wrap"></div>
      <div id="vc-legs-total" style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:6px;text-align:right"></div>
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn-sec" onclick="closeModal()">Cancel</button>
    <button class="btn-pri btn-amber" onclick="saveVessel()">Add Vessel Call</button>
  </div>`;
}

// Leg builder state for add modal
window._vcLegs=[];

function _vcAddLeg(){
  if(!window._vcLegs) window._vcLegs=[];
  window._vcLegs.push({berth_element_id:'',arrival_date:'',quantity_t:'',unload_rate_tph:''});
  _vcRenderLegs();
}

function _vcRemoveLeg(i){
  window._vcLegs.splice(i,1);
  _vcRenderLegs();
}

function _vcRenderLegs(){
  const wrap=document.getElementById('vc-legs-wrap'); if(!wrap) return;
  const berths=getFacElements().filter(e=>e.type==='berth'&&(e.props.berth_type||'Ship Berth')==='Ship Berth');
  const pi='background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:10px;padding:4px 6px;outline:none';
  wrap.innerHTML=(window._vcLegs||[]).map((leg,i)=>`
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:6px;margin-bottom:6px;align-items:end">
      <div><div style="font-family:var(--mono);font-size:7px;color:var(--text-dim);margin-bottom:2px">BERTH</div>
        <select style="${pi};width:100%" onchange="_vcLegSet(${i},'berth_element_id',this.value)">
          <option value="">-- Select --</option>
          ${berths.map(b=>`<option value="${b.id}" ${leg.berth_element_id===b.id?'selected':''}>${b.name}</option>`).join('')}
        </select></div>
      <div><div style="font-family:var(--mono);font-size:7px;color:var(--text-dim);margin-bottom:2px">ARRIVAL DATE</div>
        <input style="${pi};width:100%" type="date" value="${leg.arrival_date||''}" onchange="_vcLegSet(${i},'arrival_date',this.value)"></div>
      <div><div style="font-family:var(--mono);font-size:7px;color:var(--text-dim);margin-bottom:2px">QTY (t)</div>
        <input style="${pi};width:100%" type="number" value="${leg.quantity_t||''}" placeholder="20000" oninput="_vcLegSet(${i},'quantity_t',parseFloat(this.value)||0);_vcUpdateSplitTotal()"></div>
      <div><div style="font-family:var(--mono);font-size:7px;color:var(--text-dim);margin-bottom:2px">RATE (t/h)</div>
        <input style="${pi};width:100%" type="number" value="${leg.unload_rate_tph||''}" placeholder="0=berth" oninput="_vcLegSet(${i},'unload_rate_tph',parseFloat(this.value)||0)"></div>
      <span class="tbl-act del" onclick="_vcRemoveLeg(${i})" style="align-self:center">✕</span>
    </div>`).join('')||'<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding:6px">No ports added — add at least one port of call.</div>';
  _vcUpdateSplitTotal();
}

function _vcLegSet(i,key,val){
  if(!window._vcLegs||!window._vcLegs[i]) return;
  window._vcLegs[i][key]=val;
}

function _vcUpdateSplitTotal(){
  const totalEl=document.getElementById('vc-legs-total'); if(!totalEl) return;
  const cargo=parseFloat(document.getElementById('vc-total-qty')?.value)||0;
  const legsTotal=(window._vcLegs||[]).reduce((s,l)=>s+(parseFloat(l.quantity_t)||0),0);
  if(!cargo&&!legsTotal){totalEl.textContent='';return;}
  const diff=cargo-legsTotal;
  const color=Math.abs(diff)<1?'var(--green)':diff<0?'var(--red)':'var(--amber)';
  totalEl.innerHTML=`<span style="color:${color}">Legs total: ${legsTotal.toLocaleString()}t / Cargo: ${cargo.toLocaleString()}t${Math.abs(diff)>0?' ('+( diff>0?'+':'')+Math.round(diff)+'t unallocated)':' ✓'}</span>`;
}

function saveVessel(){
  const name=document.getElementById('vc-name')?.value?.trim(); if(!name) return;
  const productId=document.getElementById('vc-product')?.value; if(!productId) return;
  const totalQty=parseFloat(document.getElementById('vc-total-qty')?.value)||0;
  const status=document.getElementById('vc-status')?.value||'Planned';
  const notes=document.getElementById('vc-notes')?.value||'';
  const legs=(window._vcLegs||[]).filter(l=>l.berth_element_id&&l.arrival_date);

  if(!legs.length){alert('Add at least one port of call.');return;}

  const isSplit=legs.length>1;
  const rec={
    id:`vc_${Date.now()}`,
    facility_id:S.facility_id,
    name, product_id:productId,
    cargo_type:DB.products.find(p=>p.id===productId)?.name||productId,
    total_quantity_t:totalQty||legs.reduce((s,l)=>s+(l.quantity_t||0),0),
    notes, status
  };
  sofReadTermsInto('vc', rec);

  if(isSplit){
    // Multi-port: store legs array; tag facility_id from first berth
    const firstBerth=getFacElements().find(e=>e.id===legs[0].berth_element_id);
    rec.facility_id=firstBerth?.assigned_facility_id||firstBerth?.facility_id||S.facility_id;
    rec.legs=legs.map(l=>({
      berth_element_id:l.berth_element_id,
      arrival_date:l.arrival_date,
      quantity_t:parseFloat(l.quantity_t)||0,
      unload_rate_tph:parseFloat(l.unload_rate_tph)||0,
      status:status  // inherit parent status — legs advance independently only after parent is Confirmed
    }));
    // Keep flat fields from first leg for backward compat
    rec.berth_element_id=legs[0].berth_element_id;
    rec.berth_name=firstBerth?.name||'';
    rec.arrival_date=legs[0].arrival_date;
    rec.quantity_t=rec.total_quantity_t;
    rec.unload_rate_tph=legs[0].unload_rate_tph||0;
  } else {
    const berthId=legs[0].berth_element_id;
    const berthEl=getFacElements().find(e=>e.id===berthId);
    rec.facility_id=berthEl?.assigned_facility_id||berthEl?.facility_id||S.facility_id;
    rec.berth_element_id=berthId;
    rec.berth_name=berthEl?.name||berthId;
    rec.arrival_date=legs[0].arrival_date;
    rec.quantity_t=legs[0].quantity_t||totalQty;
    rec.unload_rate_tph=legs[0].unload_rate_tph||0;
    rec.transit_days=0;
  }

  window._vcLegs=[];
  DB.vessel_calls.push(rec);
  autoSave(); closeModal(); renderVesselTable(); statMsg('Vessel call added');
}

function editVessel(i){
  const v=DB.vessel_calls[i]; if(!v) return;
  window._sofReturn=null;   // set again by sofEditTerms when the SOF window sent us here
  // Fields stay editable at EVERY status. Reality keeps moving after a vessel is
  // Confirmed / In Transit / Unloading (dates slip, cargo is re-declared), so the planner
  // must be able to correct the record. "Locked" now means only the thing that actually
  // matters: the simulator never creates, edits or deletes a call whose status isn't
  // Proposed (see the status!=='Proposed' guards in the auto-propose passes).
  const locked=_tsLocked(v.status||'Planned');
  const dis='';
  const isSplit=v.legs&&v.legs.length>0;
  const prods=DB.products.filter(p=>['cement_bulk','cement_packed','clinker','additive'].includes(p.category))
    .map(p=>`<option value="${p.id}" ${p.id===v.product_id?'selected':''}>${p.name}</option>`).join('');
  const pi=`background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:10px;padding:5px 7px;outline:none;width:100%`;
  const pf='display:flex;flex-direction:column;gap:3px';
  const pl='font-family:var(--mono);font-size:8px;color:var(--text-dim);letter-spacing:.5px;text-transform:uppercase';
  const statusOpts=TRANSPORT_STATUSES.map(s=>`<option value="${s.id}" ${s.id===(v.status||'Planned')?'selected':''}>${s.id}</option>`).join('');
  const berths=getFacElements().filter(e=>e.type==='berth'&&(e.props.berth_type||'Ship Berth')==='Ship Berth');
  const berthOpts=id=>berths.map(e=>`<option value="${e.id}" ${e.id===id?'selected':''}>${esc(e.name)}</option>`).join('');

  // Build legs section for split vessels
  const legsHTML=isSplit?`
    <div style="margin-top:4px;padding:8px;border:1px solid var(--border2)">
      <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:8px">PORTS OF CALL</div>
      ${v.legs.map((leg,li)=>{
        const legDis='';
        return `<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:6px;margin-bottom:8px">
          <div><div style="font-family:var(--mono);font-size:7px;color:var(--text-dim);margin-bottom:2px">LEG ${li+1} BERTH</div>
            <select ${legDis} style="${pi}" id="ev-leg-berth-${li}"><option value="">--</option>${berthOpts(leg.berth_element_id)}</select></div>
          <div><div style="font-family:var(--mono);font-size:7px;color:var(--text-dim);margin-bottom:2px">ARRIVAL</div>
            <input ${legDis} style="${pi}" type="date" id="ev-leg-date-${li}" value="${leg.arrival_date||''}"></div>
          <div><div style="font-family:var(--mono);font-size:7px;color:var(--text-dim);margin-bottom:2px">QTY (t)</div>
            <input ${legDis} style="${pi}" type="number" id="ev-leg-qty-${li}" value="${leg.quantity_t||0}"></div>
          <div><div style="font-family:var(--mono);font-size:7px;color:var(--text-dim);margin-bottom:2px">RATE (t/h)</div>
            <input ${legDis} style="${pi}" type="number" id="ev-leg-rate-${li}" value="${leg.unload_rate_tph||0}"></div>
        </div>`;
      }).join('')}
    </div>`
  :`<div style="${pf}"><div style="${pl}">Destination Berth</div>
    <select ${dis} style="${pi}" id="ev-berth"><option value="">-- Select berth --</option>${berthOpts(v.berth_element_id)}</select></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
     <div style="${pf}"><div style="${pl}">Arrival Date</div><input ${dis} style="${pi}" type="date" id="ev-date" value="${v.arrival_date||''}"></div>
     <div style="${pf}"><div style="${pl}">Quantity (t)</div><input ${dis} style="${pi}" type="number" id="ev-qty" value="${v.quantity_t||0}"></div>
   </div>
   <div style="${pf};margin-top:8px"><div style="${pl}">Unload Rate (t/h) — 0 = use berth rate</div>
     <input ${dis} style="${pi}" type="number" id="ev-rate" value="${v.unload_rate_tph||0}"></div>`;

  // Manual schedule overrides ("campaigns") live on the Supply-page vessel Gantt now (click
  // a cell in this vessel's run) — just a summary + pointer here, not a second editor.
  const _vCamps=(DB.vessel_campaigns||[]).filter(c=>c.vessel_call_id===v.id);
  const campHTML=`
    <div style="padding:8px 10px;border:1px solid var(--blue);background:rgba(var(--blue-rgb),.05);font-family:var(--mono);font-size:9px;color:var(--text-dim)">
      ⏱ ${_vCamps.length?`${_vCamps.length} manual schedule override${_vCamps.length>1?'s':''} active`:'No manual schedule overrides'} — edit by clicking this vessel's run on the Supply page (Production &gt; Supply &gt; TRANSFERRED).
    </div>`;

  let h=`<div class="modal-hdr">
    <span class="modal-title">${locked?'🔒 ':''}Edit Vessel Call${isSplit?' (Split)':''}</span>
    <span class="modal-close" onclick="closeModal()">✕</span>
  </div>
  <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
    ${locked?`<div style="font-family:var(--mono);font-size:9px;color:var(--green);padding:8px 10px;background:rgba(0,229,160,.06);border:1px solid rgba(0,229,160,.2)">
      🔒 This movement is <strong>${v.status}</strong> — the simulation will never overwrite or delete it. Fields stay editable — correct dates, cargo or berth as reality changes.</div>`:
      (v.status==='Proposed'?`<div style="font-family:var(--mono);font-size:9px;color:var(--amber,#ffb830);padding:8px 10px;background:rgba(var(--amber-rgb),.08);border:1px solid rgba(var(--amber-rgb),.3)">
      ⚠ Status is <strong>Proposed</strong> — the simulator may overwrite this vessel call. Change Status to <strong>Planned</strong> to protect your edits.</div>`:'')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="${pf}"><div style="${pl}">Vessel Name</div><input ${dis} style="${pi}" id="ev-name" value="${v.name||''}"></div>
      <div style="${pf}"><div style="${pl}">Product</div><select ${dis} style="${pi}" id="ev-product"><option value="">-- Select --</option>${prods}</select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="${pf}"><div style="${pl}">Total Cargo (t)</div><input ${dis} style="${pi}" type="number" id="ev-total-qty" value="${v.total_quantity_t||v.quantity_t||0}"></div>
      <div style="${pf}"><div style="${pl}">Status</div><select style="${pi}" id="ev-status">${statusOpts}</select></div>
    </div>
    ${legsHTML}
    <div style="${pf}"><div style="${pl}">Notes</div><input style="${pi}" id="ev-notes" value="${v.notes||''}"></div>
    ${sofTermsFieldsHTML('ev',v)}
    ${campHTML}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="tb-btn sec" onclick="closeModal()">Close</button>
      <button class="tb-btn amber" onclick="_saveEditVessel(${i})">Save Changes</button>
    </div>
  </div>`;
  showModal('_custom');
  document.getElementById('modal-content').innerHTML=h;
}

function _saveEditVessel(i){
  const v=DB.vessel_calls[i]; if(!v) return;
  const isSplit=v.legs&&v.legs.length>0;
  v.status=document.getElementById('ev-status')?.value||v.status;
  v.notes=document.getElementById('ev-notes')?.value??v.notes;
  if(v.notes?.startsWith('Auto-proposed')) v.notes='';
  // Every field is written back at every status — a Confirmed / In Transit / Unloading
  // vessel still shifts its ETA or re-declares cargo in the real world. Status only
  // controls whether the SIMULATION may touch this call (Proposed = yes, anything
  // else = never), which is enforced in the auto-propose passes, not here.
  v.name=document.getElementById('ev-name')?.value||v.name;
  const productId=document.getElementById('ev-product')?.value;
  if(productId){ v.product_id=productId; v.cargo_type=DB.products.find(p=>p.id===productId)?.name||v.cargo_type; }
  v.total_quantity_t=parseFloat(document.getElementById('ev-total-qty')?.value)||v.total_quantity_t||v.quantity_t;
  if(isSplit){
    v.legs.forEach((leg,li)=>{
      leg.berth_element_id=document.getElementById(`ev-leg-berth-${li}`)?.value||leg.berth_element_id;
      leg.arrival_date=document.getElementById(`ev-leg-date-${li}`)?.value||leg.arrival_date;
      leg.quantity_t=parseFloat(document.getElementById(`ev-leg-qty-${li}`)?.value)||leg.quantity_t;
      leg.unload_rate_tph=parseFloat(document.getElementById(`ev-leg-rate-${li}`)?.value)||0;
    });
    // Sync flat fields from first leg
    if(v.legs[0]){ v.arrival_date=v.legs[0].arrival_date; v.berth_element_id=v.legs[0].berth_element_id; }
    v.quantity_t=v.total_quantity_t;
  } else {
    const berthId=document.getElementById('ev-berth')?.value;
    if(berthId){ v.berth_element_id=berthId; v.berth_name=getFacElements().find(e=>e.id===berthId)?.name||berthId; }
    v.arrival_date=document.getElementById('ev-date')?.value||v.arrival_date;
    v.quantity_t=parseFloat(document.getElementById('ev-qty')?.value)||v.quantity_t;
    v.unload_rate_tph=parseFloat(document.getElementById('ev-rate')?.value)||0;
  }
  sofReadTermsInto('ev', v);
  autoSave(); closeModal(); renderVesselTable(); vpRender(); statMsg('Vessel call updated');
  // back to the SOF window when "Edit terms" brought us here
  const back=window._sofReturn; window._sofReturn=null;
  if(back&&back.callId===v.id) sofOpen(back.callId, back.li);
}

