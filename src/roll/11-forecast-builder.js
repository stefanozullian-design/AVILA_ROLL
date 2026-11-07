// ══════════════════════════════════════════════════════════════════════════
// Forecast Builder popup (FBP) — the Sales-style adaptive/auto popup, ported to
// Roll. Self-contained: reads DB.real_shipments_daily for the selected demand
// point, previews Auto / Adaptive / window methods, and writes demand_values.
// The full multi-filter modal is still reachable as "Advanced" (⋯).
// ══════════════════════════════════════════════════════════════════════════

// ── Month helpers + Auto best-fit engine (ported from Sales spAuto*) ─────────
const FB_AUTO={ SHRINK:0.75, LEVEL_MONTHS:8, LEVEL_DECAY:0.85, TREND_CLAMP:0.05, TREND_DAMP:0.9, HOLDOUT:3 };
function _fbYm(ds){ return ds.slice(0,7); }
function _fbMonthAdd(ym,k){ let y=+ym.slice(0,4), m=+ym.slice(5,7)-1+k; y+=Math.floor(m/12); m=((m%12)+12)%12; return y+'-'+String(m+1).padStart(2,'0'); }
function _fbMonthDiff(a,b){ return (+b.slice(0,4)-+a.slice(0,4))*12+(+b.slice(5,7)-+a.slice(5,7)); }
function _fbWd(ym){ const y=+ym.slice(0,4), m=+ym.slice(5,7); const days=new Date(y,m,0).getDate(); let nWk=0,nSat=0; for(let d=1;d<=days;d++){ const dw=new Date(y,m-1,d).getDay(); if(dw>=1&&dw<=5)nWk++; else if(dw===6)nSat++; } return {nWk,nSat}; }
// Shared monthly seasonal index (this aggregate's own history) + recency-weighted
// deseasonalised weekday level + damped trend → future monthly weekday rates.
function _fbAutoModel(allMonth, cutoffYm, futureYms){
  const moSum=Array(13).fill(0), moCnt=Array(13).fill(0);
  Object.keys(allMonth).forEach(ym=>{ if(ym>cutoffYm) return; const wd=_fbWd(ym); if(!wd.nWk) return; const mo=+ym.slice(5,7); moSum[mo]+=allMonth[ym]/wd.nWk; moCnt[mo]++; });
  const rawIdx=Array(13).fill(NaN); let gSum=0,gN=0;
  for(let mo=1;mo<=12;mo++){ if(moCnt[mo]){ rawIdx[mo]=moSum[mo]/moCnt[mo]; gSum+=rawIdx[mo]; gN++; } }
  const gAvg=gN?gSum/gN:1;
  for(let mo=1;mo<=12;mo++){ if(isNaN(rawIdx[mo])) rawIdx[mo]=gAvg; rawIdx[mo]=gAvg>0?rawIdx[mo]/gAvg:1; }
  const sm=Array(13).fill(1);
  for(let mo=1;mo<=12;mo++){ const a=rawIdx[mo===1?12:mo-1], b=rawIdx[mo], c=rawIdx[mo===12?1:mo+1]; sm[mo]=(a+2*b+c)/4; }
  let smMean=0; for(let mo=1;mo<=12;mo++) smMean+=sm[mo]; smMean/=12;
  const seasIdx={}; for(let mo=1;mo<=12;mo++) seasIdx[mo]= smMean>0 ? 1+((sm[mo]/smMean)-1)*FB_AUTO.SHRINK : 1;
  const L=FB_AUTO.LEVEL_MONTHS, series=[];
  for(let k=L-1;k>=0;k--){ const ym=_fbMonthAdd(cutoffYm,-k); const wd=_fbWd(ym); const perwd=wd.nWk?((allMonth[ym]||0)/wd.nWk):0; series.push(perwd/(seasIdx[+ym.slice(5,7)]||1)); }
  let wsum=0,vsum=0; series.forEach((v,i)=>{ const w=Math.pow(FB_AUTO.LEVEL_DECAY,(series.length-1-i)); wsum+=w; vsum+=w*v; });
  const level=wsum?vsum/wsum:0;
  let trend=0; const n=series.length;
  if(n>=6){ const mean=(a,b)=>{ let s=0,c=0; for(let i=a;i<b;i++){s+=series[i];c++;} return c?s/c:0; }; const rec=mean(n-3,n), old=mean(n-6,n-3); if(old>0){ trend=Math.pow(rec/old,1/3)-1; } }
  trend=Math.max(-FB_AUTO.TREND_CLAMP,Math.min(FB_AUTO.TREND_CLAMP,trend));
  const monthRate={};
  futureYms.forEach(ym=>{ if(ym<=cutoffYm) return; const k=_fbMonthDiff(cutoffYm,ym); const effK=(1-Math.pow(FB_AUTO.TREND_DAMP,k))/(1-FB_AUTO.TREND_DAMP); monthRate[ym]=level*(seasIdx[+ym.slice(5,7)]||1)*Math.pow(1+trend,effK); });
  return {seasIdx, monthRate, level, trend};
}
function _fbAutoRun(actualsMap, cutoffDate){
  const allMonth={}; Object.keys(actualsMap).forEach(ds=>{ const ym=_fbYm(ds); allMonth[ym]=(allMonth[ym]||0)+(actualsMap[ds]||0); });
  const yms=Object.keys(allMonth).filter(ym=>allMonth[ym]>0).sort();
  if(yms.length<4) return null;
  const lastYm=_fbYm(cutoffDate);
  const futureYms=[]; for(let k=0;k<=15;k++) futureYms.push(_fbMonthAdd(lastYm,k));
  const full=_fbAutoModel(allMonth, lastYm, futureYms);
  // holdout backtest — forecast the last HOLDOUT complete months, Auto vs flat run-rate
  const lastComplete=_fbMonthAdd(lastYm,-1);
  const holdout=[]; for(let k=FB_AUTO.HOLDOUT-1;k>=0;k--) holdout.push(_fbMonthAdd(lastComplete,-k));
  const cutoff=_fbMonthAdd(holdout[0],-1);
  const btModel=_fbAutoModel(allMonth, cutoff, holdout);
  let bw=0,bc=0; for(let k=0;k<2;k++){ const ym=_fbMonthAdd(cutoff,-k); const wd=_fbWd(ym); if(wd.nWk){ bw+=(allMonth[ym]||0)/wd.nWk; bc++; } }
  const baseWk=bc?bw/bc:0;
  let aErr=0,bErr=0,act=0;
  holdout.forEach(ym=>{ const wd=_fbWd(ym); const actual=allMonth[ym]||0; act+=actual; const aFc=(btModel.monthRate[ym]||0)*wd.nWk; const bFc=baseWk*wd.nWk; aErr+=Math.abs(aFc-actual); bErr+=Math.abs(bFc-actual); });
  const accAuto = act>0?Math.round(Math.max(0,Math.min(100,100*(1-aErr/act)))):null;
  const accBase = act>0?Math.round(Math.max(0,Math.min(100,100*(1-bErr/act)))):null;
  return { monthRate:full.monthRate, accAuto, accBase, lastYm };
}
function _fbAutoRateForDates(auto, dates){ if(!auto) return 0; let s=0,n=0; dates.forEach(ds=>{ const d=new Date(ds+'T00:00:00').getDay(); if(d>=1&&d<=5){ n++; const r=auto.monthRate[_fbYm(ds)]; s+=(r!=null?r:0); } }); return n?s/n:0; }
function _fbTrailAvg(vols, n){ const L=vols.length; if(!L) return 0; const k=Math.min(n,L); let s=0; for(let i=L-k;i<L;i++) s+=vols[i]||0; return s/k; }
function _fbHorizonEnd(start, hz, customEnd){
  const d=new Date(start+'T00:00:00');
  if(hz==='rom') return new Date(d.getFullYear(), d.getMonth()+1, 0)._ymd();
  if(hz==='n3m') return new Date(d.getFullYear(), d.getMonth()+3, 0)._ymd();
  if(hz==='roy') return d.getFullYear()+'-12-31';
  return customEnd||new Date(d.getFullYear(), d.getMonth()+1, 0)._ymd();
}

// ── Popup state + helpers ────────────────────────────────────────────────────
const FBP={ facId:null, elId:null, start:null, horizon:'n3m', customEnd:null, shipsSat:true, satPct:25, method:{type:'adaptive'}, _closer:null };
const FBP_COLORS={ auto:'var(--fbp-auto)', win5:'var(--fbp-w5)', win10:'var(--lime)', win15:'var(--fbp-w15)', win30:'var(--fbp-w30)', pct:'var(--blue)', rate:'var(--fuchsia)' };
function fbpDot(c){ return `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${c};margin-right:4px;vertical-align:middle"></span>`; }
function fbpElName(){ const el=(DB.elements||[]).find(e=>e.id===FBP.elId); return el?el.name:'—'; }
function fbpMsg(html){ const m=document.getElementById('fbp-msg'); if(m) m.innerHTML=html; }
const FBP_POS_KEY='avila_roll_fbp_pos';

function fbpCompute(){
  const res={ok:false};
  const start=FBP.start; if(!FBP.elId){ res.msg='Select a demand point'; return res; }
  const prods=(typeof _fbDpProducts==='function')?_fbDpProducts(FBP.elId):[];
  let rows=(DB.real_shipments_daily||[]);
  if(prods.length) rows=rows.filter(r=>prods.includes((r.product||'').trim().toUpperCase()));
  const actualsMap={}; rows.forEach(r=>{ if(r.date) actualsMap[r.date]=(actualsMap[r.date]||0)+(parseFloat(r.volume)||0); });
  const nwdSet=new Set((DB.non_working_days||[]).map(n=>n.date));
  const isWk=ds=>{const d=new Date(ds+'T00:00:00').getDay();return d>=1&&d<=5;};
  const isWorkday=ds=>isWk(ds)&&!nwdSet.has(ds);
  const addDays=(ds,n)=>{const d=new Date(ds+'T00:00:00');d.setDate(d.getDate()+n);return d._ymd();};
  const histDates=[]; let ch=addDays(start,-1),gh=0;
  while(histDates.length<170&&gh<800){ gh++; if(isWorkday(ch)) histDates.push(ch); ch=addDays(ch,-1); }
  histDates.reverse();
  const vols=histDates.map(ds=>actualsMap[ds]||0);
  const adaptive=_fbAdaptiveRun(histDates, vols);
  const win={}; [5,10,15,30].forEach(n=>{ win[n]={ rate:_fbTrailAvg(vols,n), mape: adaptive?adaptive.mape[n]:null }; });
  let lastReal=null; Object.keys(actualsMap).forEach(ds=>{ if(!lastReal||ds>lastReal) lastReal=ds; });
  if(!lastReal) lastReal=addDays(start,-1);
  const auto=_fbAutoRun(actualsMap, lastReal);
  const end=_fbHorizonEnd(start, FBP.horizon, FBP.customEnd);
  const hzDates=[]; for(let d=new Date(start+'T00:00:00'); d._ymd()<=end; d.setDate(d.getDate()+1)) hzDates.push(d._ymd());
  res.ok=true; res.actualsMap=actualsMap; res.adaptive=adaptive; res.win=win; res.auto=auto; res.hzDates=hzDates; res.end=end; res.lastReal=lastReal;
  return res;
}
function fbpMethodRate(c){
  const m=FBP.method, base=c.adaptive?c.adaptive.avg:(c.win[10].rate||0);
  if(m.type==='auto') return _fbAutoRateForDates(c.auto, c.hzDates);
  if(m.type==='win')  return c.win[m.value]?c.win[m.value].rate:0;
  if(m.type==='pct')  return base*(1+m.value/100);
  if(m.type==='zero') return 0;
  if(m.type==='rate') return m.value;
  return base; // adaptive
}
function fbpDailyRows(c){
  const nwd=new Set((DB.non_working_days||[]).map(n=>n.date));
  const satCoef=FBP.shipsSat?(FBP.satPct/100):0;
  const constRate=fbpMethodRate(c);
  return c.hzDates.map(ds=>{
    const dw=new Date(ds+'T00:00:00').getDay();
    let wk=constRate;
    if(FBP.method.type==='auto'){ const r=c.auto?c.auto.monthRate[_fbYm(ds)]:null; wk=(r!=null?r:(c.adaptive?c.adaptive.avg:0)); }
    let val=0;
    if(nwd.has(ds)||dw===0) val=0;
    else if(dw===6) val=FBP.shipsSat?_fbQ25z(wk*satCoef):0;
    else val=_fbQ25(wk);
    return {date:ds,value:val};
  });
}
function fbpApply(){
  const c=fbpCompute(); if(!c.ok){ fbpMsg(c.msg||'Nothing to apply'); return; }
  if(!DB.demand_values) DB.demand_values=[];
  const elId=FBP.elId, rows=fbpDailyRows(c); let days=0,tot=0;
  rows.forEach(r=>{
    DB.demand_values=DB.demand_values.filter(x=>!(x.element_id===elId&&x.date===r.date&&!x.ship_to));
    if(r.value>0){ DB.demand_values.push({element_id:elId,date:r.date,value_t:r.value}); days++; tot+=r.value; }
  });
  if(typeof autoSave==='function') autoSave();
  fbpMsg(`<span style="color:var(--green)">✓ Applied ${days} days · ${Math.round(tot).toLocaleString()} t</span> to ${fbpElName()} · ${FBP.horizon.toUpperCase()} (${c.hzDates[0]||'—'} → ${c.end||'—'})`);
  _demandChanged();
}
function fbpOnFac(){ const allDp=(DB.elements||[]).filter(e=>e.type==='demand_point'); const facOf=e=>e.assigned_facility_id||e.facility_id||null; const dps=allDp.filter(e=>!FBP.facId||facOf(e)===FBP.facId); FBP.elId=dps[0]?dps[0].id:null; fbpRender(); }

function fbpRender(){
  const pop=document.getElementById('fbp-pop'); if(!pop) return;
  const c=fbpCompute();
  const allDp=(DB.elements||[]).filter(e=>e.type==='demand_point');
  const facOf=e=>e.assigned_facility_id||e.facility_id||null;
  const facs=(DB.facilities||[]).filter(f=>allDp.some(e=>facOf(e)===f.id)).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const facOpts=`<option value="">All facilities</option>`+facs.map(f=>`<option value="${f.id}" ${f.id===FBP.facId?'selected':''}>${f.name}</option>`).join('');
  const dps=allDp.filter(e=>!FBP.facId||facOf(e)===FBP.facId).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const dpOpts=dps.map(e=>`<option value="${e.id}" ${e.id===FBP.elId?'selected':''}>${esc(e.name)}</option>`).join('');
  const hzOpts=[['rom','ROM · rest of month'],['n3m','N3M · next 3 months'],['roy','ROY · rest of year'],['custom','Custom · pick end date']].map(([v,l])=>`<option value="${v}" ${v===FBP.horizon?'selected':''}>${l}</option>`).join('');
  const pi='background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:9px;padding:4px 6px;outline:none;width:100%';
  const pl='font-family:var(--mono);font-size:7px;color:var(--text-dim);margin-bottom:2px;letter-spacing:.5px;text-transform:uppercase';
  const pf='display:flex;flex-direction:column;gap:0';
  const btn='background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:8px;padding:4px 7px;cursor:pointer';
  const hIcon='flex:none;background:transparent;border:1px solid var(--border2);color:var(--text-dim);font-family:var(--mono);font-size:9px;width:16px;height:16px;border-radius:3px;line-height:1;cursor:pointer;padding:0';

  // preview total for the current method
  let pvDays=0, pvTot=0;
  if(c.ok){ fbpDailyRows(c).forEach(r=>{ if(r.value>0){ pvDays++; pvTot+=r.value; } }); }
  const curRate=c.ok?_fbQ25(fbpMethodRate(c)):0;

  // Auto box
  const autoRate=c.ok?_fbAutoRateForDates(c.auto,c.hzDates):0;
  const autoSel=FBP.method.type==='auto';
  const autoBox=`<div style="border:1px solid ${FBP_COLORS.auto};border-radius:3px;padding:6px 7px;background:rgba(32,227,192,.06)">
    <button onclick="FBP.method={type:'auto'};fbpRender()" style="${btn};width:100%;color:${FBP_COLORS.auto};border-color:${FBP_COLORS.auto};${autoSel?'background:rgba(32,227,192,.20)':''};display:flex;justify-content:space-between;align-items:center;padding:6px 8px">
      <span>${fbpDot(FBP_COLORS.auto)}<b>Auto · best-fit</b></span>
      <span style="font-size:9px">${c.ok&&c.auto?_fbQ25(autoRate).toLocaleString():'—'} t/day</span>
    </button>
    ${c.ok&&c.auto&&c.auto.accAuto!=null?`<div style="font-family:var(--mono);font-size:6.5px;color:var(--text-dim);margin-top:4px;text-align:center">3-month backtest accuracy · <span style="color:${FBP_COLORS.auto};font-weight:700">Auto ${c.auto.accAuto}%</span> vs baseline ${c.auto.accBase}%</div>`:`<div style="font-family:var(--mono);font-size:6.5px;color:var(--text-dim);margin-top:4px;text-align:center">seasonality + trend · needs ≥4 months of history</div>`}
  </div>`;

  // Adaptive box
  const ad=c.adaptive;
  const adBox=ad?`<div style="border:1px solid rgba(var(--hi-rgb),.4);border-radius:3px;padding:6px 8px;background:rgba(var(--hi-rgb),.05)">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-family:var(--mono);font-size:7px">
      <span style="color:var(--text)">${fbpDot('var(--max-ink)')}<b>BASELINE · ADAPTIVE</b> — selected model: <b style="color:var(--max-ink)">${ad.n}-Day Average</b></span>
      <span style="color:${ad.conf.col};font-weight:700">${ad.conf.lbl} · MAPE ${ad.mape[ad.n].toFixed(1)}%</span>
    </div>
    <div style="display:flex;gap:9px;margin-top:4px;font-family:var(--mono);font-size:6.5px;color:var(--text-dim)">
      ${[5,10,15,30].map(n=>`<span style="${n===ad.n?'color:var(--max-ink);font-weight:700;border-bottom:1px solid rgba(var(--hi-rgb),.7)':''}">${n}D&nbsp;${ad.mape[n].toFixed(1)}%${n===ad.n?' ★':''}</span>`).join('')}
      <span style="margin-left:auto">${ad.points} backtests</span>
    </div>
    <div style="font-family:var(--mono);font-size:6px;color:var(--text-dim);margin-top:3px">Walk-forward over the last 3 months of weekdays (next-day MAPE) · re-selected as data updates</div>
  </div>`:`<div style="font-family:var(--mono);font-size:6.5px;color:var(--text-dim);border:1px solid var(--border2);border-radius:3px;padding:6px 8px">Adaptive baseline: not enough recent history to backtest — pick a window or type a value below.</div>`;

  // Window boxes
  const winBox=n=>{
    const w=c.ok?c.win[n]:{rate:0,mape:null};
    const isBest=c.ok&&ad&&ad.n===n, bestCol=ad?ad.conf.col:'var(--amber)';
    const sel=FBP.method.type==='win'&&FBP.method.value===n;
    const bc=sel?'var(--fuchsia)':(isBest?bestCol:'var(--border2)'), tc=sel?'var(--fuchsia)':'var(--text)';
    return `<button onclick="FBP.method={type:'win',value:${n}};fbpRender()" style="${btn};display:flex;flex-direction:column;align-items:center;gap:1px;flex:1;border-color:${bc};color:${tc}"><span>${fbpDot(FBP_COLORS['win'+n])}${n}WD${isBest?` <span style="color:${bestCol}">★</span>`:''}</span><span style="font-size:8px;font-weight:700">${_fbQ25(w.rate).toLocaleString()}</span>${w.mape!=null?`<span style="font-size:6.5px;opacity:.7">${w.mape.toFixed(1)}%</span>`:''}</button>`;
  };

  const infoPanel=`<div id="fbp-info" style="display:none;border:1px solid var(--blue);border-radius:3px;padding:7px 8px;background:rgba(var(--blue-rgb),.07);font-family:var(--mono);font-size:6.5px;line-height:1.55;color:var(--text-dim)">
    <div style="color:var(--text);font-weight:700;margin-bottom:4px">Two ways to forecast — both scored on the last 3 months</div>
    <div style="margin-bottom:4px">${fbpDot('var(--max-ink)')}<b style="color:var(--text)">Baseline · Adaptive</b> — a moving average that auto-picks the best of the 5 / 10 / 15 / 30-weekday windows (lowest MAPE) and re-picks as data updates. Tracks the recent <i>level</i> only — no trend or seasonality. Robust on noisy, sparse or flat demand points.</div>
    <div style="margin-bottom:4px">${fbpDot(FBP_COLORS.auto)}<b style="color:var(--text)">Auto · best-fit</b> — a richer model: deseasonalised level + damped trend + a monthly seasonal index. Wins when a demand point has real seasonality or a trend; on flat / noisy ones the extra machinery can fit noise and score <i>worse</i>.</div>
    <div style="margin-bottom:4px"><b style="color:var(--text)">MAPE</b> = avg % the forecast missed actuals in backtest — lower is better. &lt;5% Excellent · &lt;10% Good · &lt;15% Fair · ≥15% Poor.</div>
    <div>Take the higher backtest accuracy, but treat a 1–2 pt gap as a tie and let your own knowledge break it.</div>
  </div>`;

  pop.innerHTML=`
    <div onmousedown="fbpDragStart(event)" title="Drag to move — position is remembered" style="display:flex;justify-content:space-between;align-items:center;gap:6px;cursor:move;user-select:none">
      <div style="font-family:var(--mono);font-size:9px;color:var(--text)"><span style="color:var(--text-dim);margin-right:4px;letter-spacing:-1px">⠿</span><strong>⚙ Forecast Builder</strong></div>
      <div style="display:flex;gap:5px;flex:none">
        <button title="How these forecasts work" onclick="var e=document.getElementById('fbp-info');e.style.display=e.style.display==='none'?'block':'none';" style="${hIcon};border-color:var(--blue);color:var(--blue);font-style:italic;font-weight:700">i</button>
        <button title="Advanced — Region/Sub, Sales Rep, Sold-To/Ship-To, SCH5 import" onclick="fbpClose();openDemandBuilderAdvanced(FBP.elId,FBP.start)" style="${hIcon}">⋯</button>
        <button title="Close" onclick="fbpClose()" style="${hIcon}">✕</button>
      </div>
    </div>
    ${infoPanel}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <div style="${pf}"><div style="${pl}">Facility</div><select style="${pi}" onchange="FBP.facId=this.value||null;fbpOnFac()">${facOpts}</select></div>
      <div style="${pf}"><div style="${pl}">Demand Point</div><select style="${pi}" onchange="FBP.elId=this.value||null;fbpRender()">${dpOpts||'<option value="">— none —</option>'}</select></div>
    </div>
    <div style="display:grid;grid-template-columns:${FBP.horizon==='custom'?'1fr 1fr':'1fr 1fr'};gap:6px">
      <div style="${pf}"><div style="${pl}">Start</div><input type="date" style="${pi}" value="${FBP.start}" onchange="FBP.start=this.value;fbpRender()"></div>
      <div style="${pf}"><div style="${pl}">Horizon</div><select style="${pi}" onchange="FBP.horizon=this.value;fbpRender()">${hzOpts}</select></div>
    </div>
    ${FBP.horizon==='custom'?`<div style="${pf}"><div style="${pl}">End Date</div><input type="date" style="${pi}" value="${FBP.customEnd||c.end||''}" onchange="FBP.customEnd=this.value;fbpRender()"></div>`:''}
    <div style="display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center">
      <label style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:9px;color:var(--text);cursor:pointer;white-space:nowrap"><input type="checkbox" ${FBP.shipsSat?'checked':''} onchange="FBP.shipsSat=this.checked;fbpRender()">Ships Saturdays</label>
      <div style="${pf};${FBP.shipsSat?'':'opacity:.4'}"><div style="${pl}">Saturday volume (% of weekday)</div><input type="number" min="0" max="100" style="${pi}" value="${FBP.satPct}" ${FBP.shipsSat?'':'disabled'} onchange="FBP.satPct=Math.max(0,Math.min(100,+this.value||0));fbpRender()"></div>
    </div>
    <div style="border-top:1px solid var(--border2);margin-top:2px"></div>
    ${autoBox}
    ${adBox}
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-family:var(--mono);font-size:6px;color:var(--text-dim);letter-spacing:.5px">MANUAL WINDOW — value · MAPE</span>
      <span style="font-family:var(--mono);font-size:6px;color:var(--text-dim)">★ = adaptive best</span>
    </div>
    <div style="display:flex;gap:4px">${winBox(5)}${winBox(10)}${winBox(15)}${winBox(30)}</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">
      <button style="${btn};${FBP.method.type==='pct'&&FBP.method.value===10?'border-color:var(--fuchsia);color:var(--fuchsia)':''}" onclick="FBP.method={type:'pct',value:10};fbpRender()">${fbpDot(FBP_COLORS.pct)}+10%</button>
      <button style="${btn};${FBP.method.type==='pct'&&FBP.method.value===-10?'border-color:var(--fuchsia);color:var(--fuchsia)':''}" onclick="FBP.method={type:'pct',value:-10};fbpRender()">${fbpDot(FBP_COLORS.pct)}−10%</button>
      <button style="${btn};${FBP.method.type==='zero'?'border-color:var(--fuchsia);color:var(--fuchsia)':''}" onclick="FBP.method={type:'zero'};fbpRender()">${fbpDot(FBP_COLORS.rate)}Zero</button>
      <button style="${btn};color:var(--green);border-color:var(--green);${FBP.method.type==='adaptive'?'background:rgba(52,211,153,.18)':''}" onclick="FBP.method={type:'adaptive'};fbpRender()">${fbpDot('var(--max-ink)')}Baseline</button>
    </div>
    <div style="display:flex;gap:4px;align-items:center">
      <input id="fbp-rate" type="number" step="25" min="0" value="${curRate}" title="Fixed weekday t/day" style="background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:11px;padding:5px 7px;outline:none;flex:1;min-width:0" onchange="FBP.method={type:'rate',value:+this.value||0};fbpRender()">
      <button style="${btn};color:var(--fuchsia);border-color:var(--fuchsia)" onclick="var v=+document.getElementById('fbp-rate').value||0;FBP.method={type:'rate',value:v};fbpRender()">${fbpDot(FBP_COLORS.rate)}Set t/day</button>
    </div>
    <div id="fbp-msg" style="font-family:var(--mono);font-size:8px;color:var(--text-dim);padding:6px 8px;background:var(--surface2);border:1px solid var(--border2);border-radius:2px;min-height:26px">${c.ok?`Preview · <b style="color:var(--text)">${pvDays}</b> days · <b style="color:var(--text)">${Math.round(pvTot).toLocaleString()}</b> t · ${c.hzDates[0]||'—'} → ${c.end||'—'}`:(c.msg||'')}</div>
    <div style="display:flex;gap:6px;justify-content:flex-end">
      <button class="tb-btn sec" onclick="fbpClose()">Cancel</button>
      <button class="tb-btn amber" onclick="fbpApply()">⚡ Apply Forecast</button>
    </div>
    <div style="font-family:var(--mono);font-size:6px;color:var(--text-dim)">${FB_STEP} t truck-load steps · writes to demand + simulation · Sundays &amp; non-working days stay 0</div>`;
}

function fbpClose(){ const p=document.getElementById('fbp-pop'); if(p) p.remove(); if(FBP._closer){ document.removeEventListener('mousedown',FBP._closer,true); FBP._closer=null; } }
function fbpClamp(pop,left,top){ const w=pop.offsetWidth,h=pop.offsetHeight; return { left:Math.max(2,Math.min(left,window.innerWidth-w-2)), top:Math.max(2,Math.min(top,window.innerHeight-h-2)) }; }
function fbpPlace(pop){
  let pos=null; try{ pos=JSON.parse(localStorage.getItem(FBP_POS_KEY)||'null'); }catch(_){}
  let left,top;
  if(pos&&isFinite(pos.left)&&isFinite(pos.top)){ left=pos.left; top=pos.top; }
  else { left=Math.max(2,window.innerWidth-pop.offsetWidth-24); top=70; }
  const c=fbpClamp(pop,left,top); pop.style.left=c.left+'px'; pop.style.top=c.top+'px';
}
function fbpDragStart(e){
  const pop=document.getElementById('fbp-pop'); if(!pop) return;
  if(e.target.closest('button,input,select')) return;
  e.preventDefault();
  const r=pop.getBoundingClientRect(), offX=e.clientX-r.left, offY=e.clientY-r.top;
  const move=ev=>{ const c=fbpClamp(pop,ev.clientX-offX,ev.clientY-offY); pop.style.left=c.left+'px'; pop.style.top=c.top+'px'; };
  const up=()=>{ document.removeEventListener('mousemove',move,true); document.removeEventListener('mouseup',up,true); try{ localStorage.setItem(FBP_POS_KEY,JSON.stringify({left:parseFloat(pop.style.left),top:parseFloat(pop.style.top)})); }catch(_){} };
  document.addEventListener('mousemove',move,true); document.addEventListener('mouseup',up,true);
}

function fbpOpen(elId, startDate){
  const allDp=(DB.elements||[]).filter(e=>e.type==='demand_point');
  if(!allDp.length){ if(typeof statMsg==='function') statMsg('No demand points in topology'); return; }
  const facOf=e=>e.assigned_facility_id||e.facility_id||null;
  const seed=elId?allDp.find(e=>e.id===elId):null;
  FBP.facId = seed?facOf(seed):(S.facility_id||null);
  if(FBP.facId && !allDp.some(e=>facOf(e)===FBP.facId)) FBP.facId=null;
  const dpsInFac=allDp.filter(e=>!FBP.facId||facOf(e)===FBP.facId);
  FBP.elId = elId || (dpsInFac[0]?dpsInFac[0].id:null);
  FBP.start = startDate||S.simCfg?.start_date||new Date()._ymd();
  FBP.horizon='n3m'; FBP.customEnd=null; FBP.shipsSat=true; FBP.satPct=25; FBP.method={type:'adaptive'};
  fbpClose();
  const pop=document.createElement('div'); pop.id='fbp-pop';
  pop.style.cssText='position:fixed;z-index:99999;background:var(--surface);border:1px solid var(--fuchsia);padding:10px;display:flex;flex-direction:column;gap:7px;box-shadow:0 6px 22px rgba(0,0,0,.65);width:360px;max-height:92vh;overflow:auto';
  document.body.appendChild(pop);
  fbpRender();
  fbpPlace(pop);
  FBP._closer=e=>{ if(!pop.contains(e.target)) fbpClose(); };
  setTimeout(()=>document.addEventListener('mousedown',FBP._closer,true),0);
}
// The Forecast Builder now opens the compact popup; the full modal is "Advanced".
function openDemandBuilder(elId, startDate){ return fbpOpen(elId, startDate); }

function _fbBuildRows(elIdOverride){
  const elId=elIdOverride||document.getElementById('fb-el-id')?.value||null;
  const start=document.getElementById('fb-start')?.value; if(!start) return null;
  const shipTo=document.getElementById('fb-f-shipto')?.value||null;
  const soldTo=document.getElementById('fb-f-soldto')?.value||null;
  if(!elId&&!shipTo&&!soldTo) return null;
  const method=document.getElementById('fb-method')?.value;
  const shipsSat=document.getElementById('fb-ships-sat')?.checked;
  const satPct=parseFloat(document.getElementById('fb-sat-pct')?.value)||25;
  const satCoef=satPct/100;
  const nwdSet=new Set((DB.non_working_days||[]).map(n=>n.date));
  const msgs=[];

  const isWkday=ds=>{const d=new Date(ds+'T00:00:00').getDay();return d>=1&&d<=5;};
  const isSat=ds=>new Date(ds+'T00:00:00').getDay()===6;
  const isSun=ds=>new Date(ds+'T00:00:00').getDay()===0;
  const isWorkday=ds=>isWkday(ds)&&!nwdSet.has(ds);
  const isEligible=ds=>!nwdSet.has(ds)&&!isSun(ds)&&(shipsSat?true:!isSat(ds));
  const addDays=(ds,n)=>{const d=new Date(ds+'T00:00:00');d.setDate(d.getDate()+n);return d._ymd();};
  const endOfMonth=ds=>{const d=new Date(ds+'T00:00:00');return new Date(d.getFullYear(),d.getMonth()+1,0)._ymd();};
  const endOfYear=ds=>`${ds.slice(0,4)}-12-31`;
  // Last simulated day, by calendar (the old UTC-parse + horizon×24h only landed there by luck of timezone).
  const simEnd=_addDays(S.simCfg.start_date||start,(S.simCfg.horizon||90)-1);

  let endDate;
  if(method==='distribute'){
    endDate=endOfMonth(start);
  } else {
    const hz=document.getElementById('fb-horizon')?.value;
    endDate=hz==='eom'?endOfMonth(start):hz==='eoy'?endOfYear(start):hz==='sim'?simEnd:(document.getElementById('fb-end-date')?.value||start);
  }

  const spine=[];
  for(let d=new Date(start+'T00:00:00');d._ymd()<=endDate;d.setDate(d.getDate()+1)){
    spine.push(d._ymd());
  }

  // Build actuals map from real_shipments_daily
  const prods=_fbDpProducts(elId||'');
  let actRows=(DB.real_shipments_daily||[]);
  if(prods.length) actRows=actRows.filter(r=>prods.includes((r.product||'').trim().toUpperCase()));
  if(shipTo) actRows=actRows.filter(r=>r.ship_to_name===shipTo);
  else if(soldTo) actRows=actRows.filter(r=>spSoldToKey(r)===soldTo);
  const actualsMap={};
  actRows.forEach(r=>{ if(r.date) actualsMap[r.date]=(actualsMap[r.date]||0)+(parseFloat(r.volume)||0); });

  let rows=[];
  if(method==='adaptive'){
    // Build a workday history spine (up to ~170 workdays, excluding non-working days) ending the day before `start`,
    // then let the adaptive engine pick the best window and rate.
    const histDates=[]; let ch=addDays(start,-1), gh=0;
    while(histDates.length<170&&gh<800){ gh++; if(isWorkday(ch)) histDates.push(ch); ch=addDays(ch,-1); }
    histDates.reverse();
    const histVols=histDates.map(ds=>actualsMap[ds]||0);
    const ad=_fbAdaptiveRun(histDates,histVols);
    const scope=shipTo?` · ${shipTo}`:'';
    if(!ad){
      // Not enough history for a backtest — fall back to a plain 10-weekday average.
      const samp=histVols.slice(-10).filter(v=>v>0);
      const avgW=samp.length?samp.reduce((a,b)=>a+b,0)/samp.length:0;
      const rateW=_fbQ25(avgW), rateS=shipsSat?_fbQ25z(avgW*satCoef):0;
      msgs.push(`Adaptive: not enough history to backtest — using 10WD avg ${avgW.toFixed(1)} t → ${rateW.toLocaleString()} t/day${scope}`);
      rows=spine.map(ds=>({date:ds,value:isSun(ds)||nwdSet.has(ds)?0:isSat(ds)?rateS:rateW}));
    } else {
      const rateW=_fbQ25(ad.avg), rateS=shipsSat?_fbQ25z(ad.avg*satCoef):0;
      const mapeStr=FB_ADAPT_WINDOWS.map(n=>`${n}WD ${ad.mape[n].toFixed(1)}%${n===ad.n?'★':''}`).join('  ');
      msgs.push(`Adaptive → ${ad.n}WD auto-selected (MAPE ${ad.mape[ad.n].toFixed(1)}% · ${ad.conf.lbl}) · avg ${ad.avg.toFixed(1)} t → ${rateW.toLocaleString()} t/day · ${ad.points} backtest pts${scope}`);
      msgs.push(`MAPE by window: ${mapeStr}`);
      rows=spine.map(ds=>({date:ds,value:isSun(ds)||nwdSet.has(ds)?0:isSat(ds)?rateS:rateW}));
    }
  } else if(method==='rolling'){
    const n=parseInt(document.getElementById('fb-rolling-n')?.value)||10;
    const samples=[];
    let cur=addDays(start,-1);
    let guard=0;
    while(samples.length<n&&guard<500){
      guard++;
      if(isWorkday(cur)){
        if(actualsMap[cur]!==undefined) samples.push(actualsMap[cur]);
      }
      cur=addDays(cur,-1);
    }
    // Fallback to demand_values if no actuals available
    if(!samples.length){
      let cur2=addDays(start,-1); let g2=0;
      while(samples.length<n&&g2<500){
        g2++;
        if(isWorkday(cur2)){
          const existing=(DB.demand_values||[]).find(v=>v.element_id===elId&&v.date===cur2&&(shipTo?v.ship_to===shipTo:!v.ship_to));
          if(existing) samples.push(parseFloat(existing.value_t)||0);
        }
        cur2=addDays(cur2,-1);
      }
    }
    const avgW=samples.length?samples.reduce((a,b)=>a+b,0)/samples.length:0;
    const rateW=_fbQ25(avgW), rateS=shipsSat?_fbQ25z(avgW*satCoef):0;
    const scope=shipTo?` · ${shipTo}`:'';
    msgs.push(`Weekday avg: ${avgW.toFixed(1)} t → ${rateW.toLocaleString()} t/day (${samples.length}/${n} pts)${scope}`);
    rows=spine.map(ds=>({date:ds,value:isSun(ds)||nwdSet.has(ds)?0:isSat(ds)?rateS:rateW}));
  } else if(method==='fixed'){
    const v=parseFloat(document.getElementById('fb-fixed-val')?.value)||0;
    const rateW=_fbQ25(v), rateS=shipsSat?_fbQ25z(v*satCoef):0;
    rows=spine.map(ds=>({date:ds,value:isSun(ds)||nwdSet.has(ds)?0:isSat(ds)?rateS:isWkday(ds)?rateW:0}));
    msgs.push(`Fixed ${v} t/day${rateW!==v?` → ${rateW.toLocaleString()} t/day`:''} · Sat ${shipsSat?satPct+'%':'off'} · ${start} → ${endDate}`);
  } else {
    // Allocate the month total in whole truck loads so the days still sum to
    // the number the user typed, rather than each day rounding on its own.
    const total=parseFloat(document.getElementById('fb-month-total')?.value)||0;
    const eligible=spine.filter(ds=>isEligible(ds));
    const alloc=_fbAlloc25(eligible.map(ds=>isSat(ds)?satCoef:1), total);
    const byDate={}; eligible.forEach((ds,i)=>{ byDate[ds]=alloc[i]; });
    rows=spine.map(ds=>({date:ds,value:byDate[ds]||0}));
    const placed=alloc.reduce((s,v)=>s+v,0);
    msgs.push(`Distributed ${placed.toLocaleString()} t over ${alloc.filter(v=>v>0).length} of ${eligible.length} eligible days${placed!==total?` (${total.toLocaleString()} t → nearest ${FB_STEP} t)`:''}`);
  }

  return {rows,msgs,elId,shipTo,soldTo};
}

function _fbPreview(){
  const result=_fbBuildRows(); if(!result) return;
  const {rows,msgs}=result;
  const active=rows.filter(r=>r.value>0);
  document.getElementById('fb-msg').textContent=[...msgs,`Preview: ${active.length} days · Total: ${Math.round(active.reduce((s,r)=>s+r.value,0)).toLocaleString()} t`].join(' · ');
}

function _fbApply(){
  if(!DB.demand_values) DB.demand_values=[];
  const elId=document.getElementById('fb-el-id')?.value||null;
  const shipTo=document.getElementById('fb-f-shipto')?.value||null;
  const soldTo=document.getElementById('fb-f-soldto')?.value||null;

  // ── Sold To path: soldTo chosen + specific DP, no shipTo → distribute proportionally among ship_tos ──
  if(soldTo && elId && !shipTo){
    const split=_fbGetShipToSplit(soldTo,elId);
    if(!split||!split.length){ document.getElementById('fb-msg').textContent='No historical ship-to data for this Sold To — select a specific Ship To instead.'; return; }
    const result=_fbBuildRows(); if(!result) return;
    const {rows,msgs}=result;
    let totalDays=0,totalT=0;
    // Allocate each day across ship-tos in whole truck loads, so the parts still
    // sum to the day's value instead of each one rounding independently.
    rows.forEach(r=>{
      const parts=_fbAlloc25(split.map(s=>s.proportion), r.value);
      split.forEach(({ship_to:st},k)=>{
        DB.demand_values=DB.demand_values.filter(x=>!(x.element_id===elId&&x.date===r.date&&x.ship_to===st));
        DB.demand_values=DB.demand_values.filter(x=>!(x.element_id===elId&&x.date===r.date&&!x.ship_to));
        if(parts[k]>0){ DB.demand_values.push({element_id:elId,date:r.date,value_t:parts[k],ship_to:st}); totalDays++; totalT+=parts[k]; }
      });
    });
    autoSave(); _demandCacheInvalidate();
    const splitDesc=split.map(p=>`${p.ship_to} ${Math.round(p.proportion*100)}%`).join(', ');
    document.getElementById('fb-msg').innerHTML=`<span style="color:var(--green)">✓ Distributed to ${split.length} ship-to${split.length>1?'s':''}</span> (${splitDesc}) — ${Math.round(totalT).toLocaleString()} t`;
    renderDemandView(); renderSalesPerfView();
    return;
  }

  // ── Proportional path: ship_to chosen, no specific demand point ──
  if(!elId && shipTo){
    const split=_fbGetDpSplit(shipTo);
    if(!split||!split.length){ document.getElementById('fb-msg').textContent='No historical data found for this customer — select a specific Demand Point.'; return; }
    // Build rows using the customer total (no elId filter), then split by proportion
    const baseResult=_fbBuildRows('__probe__');
    if(!baseResult) return;
    // Re-build using actuals totals for this customer across all DPs
    const probeResult=_fbBuildRows(split[0].elId); // use first DP as seed for rolling avg computation
    if(!probeResult) return;
    const {rows,msgs}=probeResult;
    let totalDays=0,totalT=0;
    // Allocate each day across demand points in whole truck loads (see above).
    rows.forEach(r=>{
      const parts=_fbAlloc25(split.map(s=>s.proportion), r.value);
      split.forEach(({elId:eid},k)=>{
        DB.demand_values=DB.demand_values.filter(x=>!(x.element_id===eid&&x.date===r.date&&x.ship_to===shipTo));
        DB.demand_values=DB.demand_values.filter(x=>!(x.element_id===eid&&x.date===r.date&&!x.ship_to));
        if(parts[k]>0){ DB.demand_values.push({element_id:eid,date:r.date,value_t:parts[k],ship_to:shipTo}); totalDays++; totalT+=parts[k]; }
      });
    });
    autoSave(); _demandCacheInvalidate();
    const splitDesc=split.map(p=>`${p.name} ${Math.round(p.proportion*100)}%`).join(', ');
    document.getElementById('fb-msg').innerHTML=`<span style="color:var(--green)">✓ Distributed to ${split.length} demand point${split.length>1?'s':''}</span> (${splitDesc}) — ${Math.round(totalT).toLocaleString()} t`;
    renderDemandView(); renderSalesPerfView();
    return;
  }

  // ── Single demand point path ──
  const result=_fbBuildRows(); if(!result) return;
  const {rows,msgs,elId:eid,shipTo:st}=result;
  rows.forEach(r=>{
    if(st){
      DB.demand_values=DB.demand_values.filter(x=>!(x.element_id===eid&&x.date===r.date&&x.ship_to===st));
      DB.demand_values=DB.demand_values.filter(x=>!(x.element_id===eid&&x.date===r.date&&!x.ship_to));
      if(r.value>0) DB.demand_values.push({element_id:eid,date:r.date,value_t:Math.round(r.value*10)/10,ship_to:st});
    } else {
      DB.demand_values=DB.demand_values.filter(x=>!(x.element_id===eid&&x.date===r.date));
      if(r.value>0) DB.demand_values.push({element_id:eid,date:r.date,value_t:Math.round(r.value*10)/10});
    }
    const inp=document.querySelector(`.dem-cell[data-el="${eid}"][data-date="${r.date}"]`);
    if(inp) inp.value=r.value>0?Math.round(r.value*10)/10:'';
  });
  autoSave();
  const active=rows.filter(r=>r.value>0);
  const total=Math.round(active.reduce((s,r)=>s+r.value,0));
  const lbl=st?` for <em>${st}</em>`:'';
  document.getElementById('fb-msg').innerHTML=`<span style="color:var(--green)">✓ Applied${lbl}</span> — ${[...msgs,`${active.length} days · ${total.toLocaleString()} t`].join(' · ')}`;
  _demandChanged();
}

// ── Bulk monthly-total import (wide format: demand points in rows, months as columns) ──
function _fbBulkPick(){
  let inp=document.getElementById('fb-bulk-input');
  if(!inp){
    inp=document.createElement('input');
    inp.type='file'; inp.id='fb-bulk-input'; inp.accept='.xlsx,.xls,.csv';
    inp.style.display='none';
    inp.onchange=()=>_fbBulkHandleFile(inp);
    document.body.appendChild(inp);
  }
  inp.value='';
  inp.click();
}

async function _fbBulkHandleFile(input){
  const file=input.files&&input.files[0]; if(!file) return;
  const msg=document.getElementById('fb-msg');
  if(msg) msg.innerHTML='<span style="color:var(--amber)">Reading '+file.name+'…</span>';
  try{
    await loadLib('xlsx'); // pinned version + SRI — see LIBS
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array',cellDates:false,raw:true});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{raw:false,defval:''});
    if(!rows.length) throw new Error('File has no data rows');
    _fbBulkProcess(rows);
  }catch(e){
    if(msg) msg.innerHTML='<span style="color:var(--red)">Import failed: '+e.message+'</span>';
  }
}

// Parse a column header into {y,m}, or null if it is not a month column.
function _fbParseMonthHeader(hdr, defYear){
  if(hdr==null) return null;
  const s=String(hdr).trim();
  if(!s) return null;
  // Excel date serial (≈ 2023..2045 → 45000..53000)
  if(/^\d{4,6}(\.\d+)?$/.test(s)){
    const n=Number(s);
    if(n>20000 && n<80000){
      const dt=new Date(Math.round((n-25569)*86400*1000));
      if(!isNaN(dt)) return {y:dt.getUTCFullYear(), m:dt.getUTCMonth()+1};
    }
  }
  // ISO: 2026-07 or 2026/07
  let m=s.match(/^(\d{4})[-\/.](\d{1,2})$/);
  if(m && +m[2]>=1 && +m[2]<=12) return {y:+m[1], m:+m[2]};
  // 07/2026 or 7-2026
  m=s.match(/^(\d{1,2})[-\/.](\d{4})$/);
  if(m && +m[1]>=1 && +m[1]<=12) return {y:+m[2], m:+m[1]};
  // Month-name based: "Jul", "Jul-26", "Jul 2026", "July2026"
  const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12,
    january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
  const low=s.toLowerCase().replace(/[,_]/g,' ').trim();
  let mm=low.match(/^([a-z]{3,9})[\s\-\/]*(\d{2,4})?$/);
  if(mm && months[mm[1]]){
    let yr=defYear;
    if(mm[2]){ yr=+mm[2]; if(yr<100) yr+=2000; }
    return {y:yr, m:months[mm[1]]};
  }
  mm=low.match(/^(\d{4})\s+([a-z]{3,9})$/);
  if(mm && months[mm[2]]) return {y:+mm[1], m:months[mm[2]]};
  return null;
}

// Spread a monthly total across one calendar month's eligible days
// (weekdays full, Saturdays at satPct%, skipping Sundays + non-working days).
function _fbDistributeMonthRows(y, m, total, opts){
  const shipsSat=opts.shipsSat!==false;
  const satCoef=(opts.satPct!=null?opts.satPct:25)/100;
  const nwdSet=new Set((DB.non_working_days||[]).map(n=>n.date));
  const pad=n=>String(n).padStart(2,'0');
  const last=new Date(y, m, 0).getDate();
  const isSat=ds=>new Date(ds+'T00:00:00').getDay()===6;
  const isSun=ds=>new Date(ds+'T00:00:00').getDay()===0;
  const spine=[];
  for(let d=1; d<=last; d++) spine.push(`${y}-${pad(m)}-${pad(d)}`);
  const eligible=spine.filter(ds=>!nwdSet.has(ds)&&!isSun(ds)&&(shipsSat?true:!isSat(ds)));
  const alloc=_fbAlloc25(eligible.map(ds=>isSat(ds)?satCoef:1), total);
  const rows=[];
  eligible.forEach((ds,i)=>{ if(alloc[i]>0) rows.push({date:ds, value:alloc[i]}); });
  return rows;
}

function _fbBulkProcess(rawRows){
  const msg=document.getElementById('fb-msg');
  const cols=Object.keys(rawRows[0]);
  const simStart=S.simCfg.start_date||document.getElementById('fb-start')?.value||new Date()._ymd();
  const defYear=parseInt(simStart.slice(0,4))||new Date().getFullYear();

  // Classify columns: month columns vs text columns
  const monthCols=[], textCols=[];
  cols.forEach(c=>{
    const pm=_fbParseMonthHeader(c, defYear);
    if(pm) monthCols.push({col:c, y:pm.y, m:pm.m});
    else textCols.push(c);
  });
  if(!monthCols.length){
    if(msg) msg.innerHTML='<span style="color:var(--red)">No month columns recognised in the header. Expected columns like 2026-07, Jul-26, or July 2026.</span>';
    return;
  }

  // Demand-point name → element id lookup
  const norm=s=>String(s||'').trim().toUpperCase().replace(/\s+/g,' ');
  const dpByName={};
  (DB.elements||[]).filter(e=>e.type==='demand_point').forEach(e=>{ dpByName[norm(e.name)]=e.id; });

  // Pick the text column whose values best match demand-point names
  let nameCol=null, bestHits=-1;
  textCols.forEach(c=>{
    let hits=0;
    rawRows.forEach(r=>{ if(dpByName[norm(r[c])]) hits++; });
    if(hits>bestHits){ bestHits=hits; nameCol=c; }
  });
  if(!nameCol || bestHits<=0){
    if(msg) msg.innerHTML='<span style="color:var(--red)">No column matched any demand-point names. Check the spelling against the app\'s demand points.</span>';
    return;
  }

  const shipsSat=document.getElementById('fb-ships-sat')?.checked!==false;
  const satPct=parseFloat(document.getElementById('fb-sat-pct')?.value)||25;
  if(!DB.demand_values) DB.demand_values=[];

  // Aggregate totals per demand point × month (sums multiple rows per DP, e.g. one per product)
  const agg={}; const dpUnmatched=new Set();
  rawRows.forEach(r=>{
    const elId=dpByName[norm(r[nameCol])];
    if(!elId){ const nm=String(r[nameCol]||'').trim(); if(nm) dpUnmatched.add(nm); return; }
    monthCols.forEach(mc=>{
      const t=parseFloat(String(r[mc.col]).replace(/[, ]/g,''))||0;
      if(t<=0) return;
      const mk=`${mc.y}-${mc.m}`;
      (agg[elId]||(agg[elId]={}));
      (agg[elId][mk]||(agg[elId][mk]={y:mc.y, m:mc.m, total:0}));
      agg[elId][mk].total+=t;
    });
  });

  let cells=0, totalT=0; const monthsTouched=new Set();
  Object.entries(agg).forEach(([elId,months])=>{
    Object.values(months).forEach(({y,m,total})=>{
      const rows=_fbDistributeMonthRows(y, m, total, {shipsSat, satPct});
      const mPrefix=`${y}-${String(m).padStart(2,'0')}`;
      // Replace existing DP-level (no ship_to) values for that month, then write fresh
      DB.demand_values=DB.demand_values.filter(x=>!(x.element_id===elId&&!x.ship_to&&String(x.date).startsWith(mPrefix)));
      rows.forEach(rw=>{ DB.demand_values.push({element_id:elId, date:rw.date, value_t:rw.value}); cells++; totalT+=rw.value; });
      monthsTouched.add(mPrefix);
    });
  });

  autoSave(); _demandChanged();

  const matchedCount=Object.keys(agg).length;
  if(!matchedCount){
    if(msg) msg.innerHTML='<span style="color:var(--red)">Matched demand points but found no positive monthly totals to distribute.</span>';
    return;
  }
  const warn=dpUnmatched.size
    ? ` · <span style="color:var(--amber)">${dpUnmatched.size} unmatched: ${[...dpUnmatched].slice(0,5).join(', ')}${dpUnmatched.size>5?'…':''}</span>`
    : '';
  if(msg) msg.innerHTML=`<span style="color:var(--green)">✓ Imported</span> ${matchedCount} demand point${matchedCount!==1?'s':''} · ${monthsTouched.size} month${monthsTouched.size!==1?'s':''} · ${cells.toLocaleString()} day-cells · ${Math.round(totalT).toLocaleString()} t${warn}`;
}

// ── Non-Working Days panel ───────────────────────────────
function openNonWorkingDaysPanel(){
  if(!DB.non_working_days) DB.non_working_days=[];
  const sorted=[...DB.non_working_days].sort((a,b)=>a.date.localeCompare(b.date));

  let h=`<div class="modal-hdr"><span class="modal-title">Global Non-Working Days</span><span class="modal-close" onclick="closeModal()">✕</span></div>
  <div style="padding:14px;display:flex;flex-direction:column;gap:12px;max-height:70vh;overflow-y:auto">
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">These dates are excluded from all demand calculations regardless of dispatch schedule. Use for holidays, plant shutdowns, etc.</div>
    <div style="display:flex;gap:8px;align-items:flex-end">
      <div class="pf" style="margin:0"><div class="pl">Date</div><input class="pi" type="date" id="nwd-date" style="width:140px"></div>
      <div class="pf" style="margin:0;flex:1"><div class="pl">Reason</div><input class="pi" id="nwd-reason" placeholder="e.g. Public holiday"></div>
      <button class="tb-btn amber" style="padding:6px 12px;flex-shrink:0" onclick="_addNWD()">Add</button>
    </div>
    <table style="border-collapse:collapse;width:100%">
      <tr style="font-family:var(--mono);font-size:8px;color:var(--text-dim);letter-spacing:1px;border-bottom:1px solid var(--border)">
        <td style="padding:5px 8px">Date</td><td style="padding:5px 8px">Day</td><td style="padding:5px 8px">Reason</td><td></td>
      </tr>
      ${sorted.length?sorted.map(n=>{
        const dt=new Date(n.date+'T12:00:00');
        const dow=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];
        return `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:5px 8px;font-family:var(--mono);font-size:10px;color:var(--text)">${n.date}</td>
          <td style="padding:5px 8px;font-family:var(--mono);font-size:9px;color:var(--text-dim)">${dow}</td>
          <td style="padding:5px 8px;font-family:var(--mono);font-size:9px;color:var(--text-dim)">${n.reason||'—'}</td>
          <td style="padding:5px 8px;text-align:right"><span class="tbl-act del" onclick="_removeNWD('${n.id}')">✕</span></td>
        </tr>`;
      }).join(''):`<tr><td colspan="4" style="padding:12px 8px;font-family:var(--mono);font-size:9px;color:var(--text-dim);text-align:center">No non-working days defined</td></tr>`}
    </table>
    <div style="display:flex;justify-content:flex-end">
      <button class="tb-btn sec" onclick="closeModal();renderDemandView()">Close</button>
    </div>
  </div>`;

  showModal('_custom');
  document.getElementById('modal-content').innerHTML=h;
}

function _addNWD(){
  const date=document.getElementById('nwd-date')?.value;
  const reason=document.getElementById('nwd-reason')?.value||'';
  if(!date) return;
  if(DB.non_working_days.find(n=>n.date===date)) return;
  DB.non_working_days.push({id:`nwd_${Date.now()}`,date,reason});
  // Marking a day non-working clears any forecast demand already stored for it (a NWD has
  // zero expected demand). Manual NWD overrides (nwd_manual) are kept — they don't exist yet
  // at this point, but the guard makes the rule explicit.
  DB.demand_values=(DB.demand_values||[]).filter(v=>!(v.date===date&&!v.nwd_manual));
  _demandCacheInvalidate();
  autoSave(); openNonWorkingDaysPanel();
  if(typeof renderDemandView==='function') renderDemandView();
  if(typeof renderSupplyView==='function') renderSupplyView();
  if(typeof scheduleSimulation==='function') scheduleSimulation();
}

function _removeNWD(id){
  DB.non_working_days=DB.non_working_days.filter(n=>n.id!==id);
  _demandCacheInvalidate();
  autoSave(); openNonWorkingDaysPanel();
  if(typeof renderDemandView==='function') renderDemandView();
  if(typeof renderSupplyView==='function') renderSupplyView();
  if(typeof scheduleSimulation==='function') scheduleSimulation();
}

function getFullPath(fac){
  if(!fac) return '';
  const sub=DB.sub_regions.find(s=>s.id===fac.sub_region_id);
  const reg=DB.regions.find(r=>r.id===sub?.region_id);
  const co=DB.countries.find(c=>c.id===reg?.country_id);
  const mr=DB.macro_regions.find(m=>m.id===co?.macro_region_id);
  return [mr?.name,co?.name,reg?.name,sub?.name].filter(Boolean).join(' › ');
}

// Trace backwards from a demand_point element through connections
// to find all bulk_silo elements reachable upstream.
// Returns array of { product_id, product_name, silo_name }
function getReachableProducts(elementId){
  const facId=S.facility_id;
  const facConns=DB.connections.filter(c=>c.facility_id===facId);

  // Build upstream adjacency: toId -> [fromId]
  const upMap={};
  facConns.forEach(c=>{
    if(!upMap[c.to_element_id]) upMap[c.to_element_id]=[];
    upMap[c.to_element_id].push(c.from_element_id);
  });

  // BFS upstream from elementId
  const visited=new Set();
  const queue=[elementId];
  const results=[];
  const unassigned=[];

  while(queue.length){
    const id=queue.shift();
    if(visited.has(id)) continue;
    visited.add(id);

    const el=getEl(id);
    if(!el) continue;

    // Bulk OR packed silo → its stored product is what this demand point can request.
    // (A demand point behind a packing plant sees the PACKED product, not the bulk input.)
    if(el.type==='bulk_silo'||el.type==='packed_silo'){
      const prods=getSiloProducts(el);
      if(prods.length){
        prods.forEach(pid=>{
          const prod=DB.products.find(p=>p.id===pid);
          if(prod&&!results.find(r=>r.product_id===prod.id)){
            results.push({product_id:prod.id, product_name:prod.name, silo_name:el.name});
          }
        });
      } else {
        unassigned.push(el.name);
      }
      continue; // stop — do not trace upstream past a silo
    }

    // Packing plant → it OUTPUTS packed products (element_product_capacities.product_id).
    // Offer those (not the bulk input) and stop tracing upstream through the machine.
    if(el.type==='packing_plant'){
      DB.element_product_capacities.filter(c=>c.element_id===el.id).forEach(c=>{
        const prod=DB.products.find(p=>p.id===c.product_id);
        if(prod&&!results.find(r=>r.product_id===prod.id))
          results.push({product_id:prod.id, product_name:prod.name, silo_name:el.name+' (packed)'});
      });
      continue;
    }

    // Continue upstream
    (upMap[id]||[]).forEach(upId=>{ if(!visited.has(upId)) queue.push(upId); });
  }

  return { products:results, unassigned };
}

