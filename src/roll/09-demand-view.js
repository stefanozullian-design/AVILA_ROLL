// ═══════════════════════════════════════════════════════
// DEMAND
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// DEMAND VIEW — forecast table + builder
// ═══════════════════════════════════════════════════════

function renderDemandView(){
  if(!_IDX.depth) return _idxRun(()=>renderDemandView.apply(this,arguments)); // fast lookups for this whole block
  const wrap=document.getElementById('demand-table-wrap'); if(!wrap) return;
  fltRender('dem');
  let allDpEls=getFacElements().filter(e=>e.type==='demand_point');
  // Filter by active status unless user has toggled to show inactive
  if(!window._demShowInactive) allDpEls=allDpEls.filter(e=>e.is_active!==false);
  const _facForEl=el=>el.assigned_facility_id||el.facility_id||S.facility_id;
  if(!allDpEls.length||!S.simCfg.start_date){
    wrap.innerHTML=`<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);padding:30px;text-align:center">
      ${!S.simCfg.start_date?'Configure simulation dates in Configure first.':'No demand points in the topology.'}<br><br>
      Add Demand Point elements then use <span style="color:var(--amber)">⚙ Forecast Builder</span> to populate.</div>`;
    return;
  }

  const simStart=new Date((S.simCfg.start_date||new Date()._ymd())+'T00:00:00');
  const horizon=S.simCfg.horizon||90;
  const nwdSet=new Set((DB.non_working_days||[]).map(n=>n.date));
  const todayStr=new Date()._ymd();

  // ── Date spine — always include actuals history ───────────────────────
  // Find earliest actual in demand_values so past data is always visible
  const actualDates = (DB.demand_values||[])
    .filter(v=>v.source==='actual' && v.date)
    .map(v=>v.date);
  const earliestActual = actualDates.length ? actualDates.reduce((a,b)=>a<b?a:b) : null;

  // Grid start = earliest actual OR sim start, whichever is earlier
  const gridStart = earliestActual && earliestActual < simStart._ymd()
    ? new Date(earliestActual+'T00:00:00')
    : simStart;

  // Grid end = sim start + horizon calendar days (exclusive). Not +horizon×24h: across the
  // March DST change that lands at 01:00 on the end date and shows a day past the simulation.
  const simEnd = new Date(simStart); simEnd.setDate(simEnd.getDate()+horizon);

  // Only the days of the shared time frame (cut to this grid's own span, _demGridSpan).
  const _win=fltGetDateRange('dem');
  const allDates=[];
  // Advance by CALENDAR day, not +24h in ms — otherwise a DST fall-back day (25h) repeats.
  for(let dt=new Date(gridStart); dt<simEnd; dt.setDate(dt.getDate()+1)){
    const ds=dt._ymd();
    if(ds>=_win.from&&ds<=_win.to) allDates.push(ds);
  }
  if(!allDates.length){
    wrap.innerHTML=`<div style="font-family:var(--mono);font-size:10px;color:var(--text-dim);padding:30px;text-align:center">`+
      `No demand days in this time frame (${fltFmt(_win.wanted.from)} → ${fltFmt(_win.wanted.to)}). `+
      `The grid runs ${fltFmt(_win.bounds.from)} → ${fltFmt(_win.bounds.to)}.</div>`;
    renderDemandChart();
    return;
  }
  // Group by month
  const months=[];
  allDates.forEach(ds=>{
    const ym=ds.slice(0,7);
    let mon=months.find(m=>m.ym===ym);
    if(!mon){mon={ym,label:new Date(ds+'T00:00:00').toLocaleDateString('en',{month:'short',year:'2-digit'}),dates:[]};months.push(mon);}
    mon.dates.push(ds);
  });

  // Collapsed state — months keyed by ym, org groups keyed by id.
  // Every month except the current one starts collapsed so the page opens compact — decided
  // once per month, the first time the time frame brings it into view.
  if(!window._demColapsed) window._demColapsed=new Set();
  if(!window._demColSeen) window._demColSeen=new Set();
  months.forEach(m=>{ if(window._demColSeen.has(m.ym)) return; window._demColSeen.add(m.ym);
    if(m.ym!==todayStr.slice(0,7)) window._demColapsed.add(m.ym); });
  if(!window._demGrpCol) window._demGrpCol=new Set(); // org group ids that are collapsed
  const collapsed=window._demColapsed;
  const grpCol=window._demGrpCol;

  // ── Filters: the shared Facility/Sub-region and Product selections, plus this page's own
  // INT/EXT type. A demand point matches a product pick when it carries ANY allowed product.
  const _df=_demEnsureFilter();
  // Cust-type chips active state (INT/EXT — embedded in product/demand-point name)
  ['all','EXT','INT'].forEach(t=>{
    const el=document.getElementById('dem-type-'+(t==='all'?'all':t.toLowerCase()));
    if(el) el.classList.toggle('active', _df.custType===t);
  });
  const _fs=fltFacIdSet(), _allowP=fltAllowedProdIds();
  if(_fs)     allDpEls=allDpEls.filter(el=>_fs.has(_facForEl(el)));
  if(_allowP) allDpEls=allDpEls.filter(el=>_demElProdIds(el).some(pid=>_allowP.has(pid)));
  if(_df.custType!=='all') allDpEls=allDpEls.filter(el=>_demElType(el)===_df.custType);

  const isWkend=ds=>{const d=new Date(ds+'T00:00:00').getDay();return d===0||d===6;};
  const isSat=ds=>new Date(ds+'T00:00:00').getDay()===6;
  const wkThSty='border-left:2px solid rgba(var(--red-rgb),.4);background:rgba(var(--red-rgb),.05)';
  const sunThSty='border-right:2px solid rgba(var(--red-rgb),.4);background:rgba(var(--red-rgb),.05)';
  const thSty=ds=>isSat(ds)?wkThSty:new Date(ds+'T00:00:00').getDay()===0?sunThSty:'';
  const tdSty=ds=>ds===todayStr?'border-left:2px solid var(--green);border-right:2px solid var(--green);':
                  isSat(ds)?'border-left:2px solid rgba(var(--red-rgb),.3);background:rgba(var(--red-rgb),.04)':
                  new Date(ds+'T00:00:00').getDay()===0?'border-right:2px solid rgba(var(--red-rgb),.3);background:rgba(var(--red-rgb),.04)':'';

  // Build indexed lookup map — aggregate ship_to records into demand point totals
  const demandMap={};
  (DB.demand_values||[]).forEach(v=>{
    if(!v.element_id||!v.date) return;
    const key=`${v.element_id}|${v.date}`;
    if(v.ship_to){
      if(!demandMap[key]||!demandMap[key]._hasShipTo) demandMap[key]={value_t:0,source:v.source,_hasShipTo:true};
      demandMap[key].value_t=(parseFloat(demandMap[key].value_t)||0)+(parseFloat(v.value_t)||0);
    } else if(!demandMap[key]?._hasShipTo){
      demandMap[key]=v;
    }
  });

  const getVal=(elId,ds)=>{
    const rec=demandMap[`${elId}|${ds}`];
    if(!rec) return 0;
    // On a non-working day only a manual override counts; everything else reads as 0.
    if(nwdSet.has(ds)&&!rec.nwd_manual) return 0;
    return parseFloat(rec.value_t)||0;
  };
  const getSource=(elId,ds)=>{
    const rec=demandMap[`${elId}|${ds}`];
    return rec?.source||'forecast';
  };
  const grpTotal=(els,ds)=>els.reduce((s,el)=>s+getVal(el.id,ds),0);
  const grpMonTotal=(els,mon)=>mon.dates.reduce((s,ds)=>s+grpTotal(els,ds),0);

  // Build org hierarchy relevant to the current canvas elements
  // Map each demand_point to its facility (via assigned_facility_id or facility_id)
  const facForEl=el=>el.assigned_facility_id||el.facility_id||S.facility_id;

  // Collect all relevant facility ids
  const relevantFacIds=new Set(allDpEls.map(el=>facForEl(el)));

  // Walk org tree and only include nodes with relevant facilities underneath
  const tree=[]; // [{type:'region'|'sub'|'fac', id, name, depth, els:[]}]

  // Build lookup maps
  const facMap=Object.fromEntries(DB.facilities.map(f=>[f.id,f]));
  const subMap=Object.fromEntries(DB.sub_regions.map(s=>[s.id,s]));
  const regMap=Object.fromEntries(DB.regions.map(r=>[r.id,r]));
  const coMap=Object.fromEntries(DB.countries.map(c=>[c.id,c]));
  const mrMap=Object.fromEntries(DB.macro_regions.map(m=>[m.id,m]));

  DB.macro_regions.forEach(mr=>{
    const mrEls=allDpEls.filter(el=>{
      const fac=facMap[facForEl(el)]; if(!fac) return false;
      const sub=subMap[fac.sub_region_id]; if(!sub) return false;
      const reg=regMap[sub.region_id]; if(!reg) return false;
      const co=coMap[reg.country_id]; if(!co) return false;
      return co.macro_region_id===mr.id;
    });
    if(!mrEls.length) return;

    // Only show MR header if multiple macro regions have data
    const multiMR=DB.macro_regions.filter(m=>allDpEls.some(el=>{
      const fac=facMap[facForEl(el)];const sub=subMap[fac?.sub_region_id];
      const reg=regMap[sub?.region_id];const co=coMap[reg?.country_id];
      return co?.macro_region_id===m.id;
    })).length>1;
    if(multiMR) tree.push({type:'mr',id:mr.id,name:mr.name,depth:0,els:mrEls});

    DB.countries.filter(c=>c.macro_region_id===mr.id).forEach(co=>{
      const coEls=mrEls.filter(el=>{
        const fac=facMap[facForEl(el)];const sub=subMap[fac?.sub_region_id];
        const reg=regMap[sub?.region_id];
        return reg?.country_id===co.id;
      });
      if(!coEls.length) return;
      const depth=multiMR?1:0;
      const multiCo=DB.countries.filter(c2=>c2.macro_region_id===mr.id&&mrEls.some(el=>{
        const fac=facMap[facForEl(el)];const sub=subMap[fac?.sub_region_id];
        const reg=regMap[sub?.region_id];return reg?.country_id===c2.id;
      })).length>1;
      if(multiCo) tree.push({type:'co',id:co.id,name:co.name,depth,els:coEls});

      DB.regions.filter(r=>r.country_id===co.id).forEach(reg=>{
        const regEls=coEls.filter(el=>{
          const fac=facMap[facForEl(el)];const sub=subMap[fac?.sub_region_id];
          return sub?.region_id===reg.id;
        });
        if(!regEls.length) return;
        // Always show region as a grouping level
        tree.push({type:'reg',id:reg.id,name:reg.name,depth:depth+(multiCo?1:0),els:regEls});
        const regDepth=depth+(multiCo?1:0)+1;

        DB.sub_regions.filter(s=>s.region_id===reg.id).forEach(sub=>{
          const subEls=regEls.filter(el=>facMap[facForEl(el)]?.sub_region_id===sub.id);
          if(!subEls.length) return;
          tree.push({type:'sub',id:sub.id,name:sub.name,depth:regDepth,els:subEls});
          const subDepth=regDepth+1;

          DB.facilities.filter(f=>f.sub_region_id===sub.id&&relevantFacIds.has(f.id)).forEach(fac=>{
            const facEls=subEls.filter(el=>facForEl(el)===fac.id);
            if(!facEls.length) return;
            tree.push({type:'fac',id:fac.id,name:fac.name,depth:subDepth,ftype:fac.type,els:facEls});
            const facDepth=subDepth+1;
            // Demand point rows — stored in fac node, rendered separately
          });
        });
      });
    });
  });

  // Also catch demand points with no org path (missing sub_region etc.)
  const coveredEls=new Set(tree.flatMap(n=>n.type==='fac'?n.els:[]).map(e=>e.id));
  const orphans=allDpEls.filter(el=>!coveredEls.has(el.id));
  if(orphans.length) tree.push({type:'fac',id:'_orphan',name:'Unassigned',depth:0,ftype:'terminal',els:orphans});

  // ── Shared cell helpers ────────────────────────────────
  const indentPx=depth=>depth*14;
  const stickyLeft=(bg,depth,extraStyle='')=>
    `position:sticky;left:0;z-index:2;background:${bg};border-right:1px solid var(--border2);padding:4px 10px 4px ${indentPx(depth)+10}px;${extraStyle}`;

  // ── Table header ──────────────────────────────────────
  const leftW=380;
  let h=`<table style="border-collapse:collapse;font-family:var(--mono);font-size:9px;white-space:nowrap;min-width:max-content">
  <thead><tr>
    <th style="position:sticky;left:0;z-index:5;background:var(--surface2);color:var(--text-dim);font-size:8px;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border-bottom:2px solid var(--border2);border-right:1px solid var(--border2);text-align:left;min-width:${leftW}px">Demand Point</th>`;

  months.forEach(mon=>{
    const isCol=collapsed.has(mon.ym);
    h+=`<th onclick="_demToggleMonth('${mon.ym}')" style="cursor:pointer;background:var(--surface2);border-left:2px solid var(--blue);border-bottom:2px solid var(--border2);font-size:8px;font-weight:700;color:var(--blue);text-align:center;padding:4px 6px;user-select:none;position:sticky;top:0;z-index:3">
      <span style="margin-right:3px">${isCol?'▶':'▼'}</span>${mon.label}</th>`;
    if(!isCol) mon.dates.forEach(ds=>{
      const ts=ds===todayStr?'border-left:2px solid var(--green);border-right:2px solid var(--green);':thSty(ds);
      h+=`<th class="dem-day-${mon.ym}" style="background:var(--surface2);color:${isWkend(ds)?'rgba(var(--red-rgb),.6)':ds===todayStr?'var(--green)':'var(--text-dim)'};font-size:8px;padding:5px 4px;border-bottom:2px solid var(--border2);border-right:1px solid rgba(var(--hi-rgb),.03);text-align:right;min-width:52px;${ts}">${ds.slice(8)}</th>`;
    });
  });
  h+=`</tr></thead><tbody>`;

  // ── Grand total row (sticky below header) ─────────────────────────────
  h+=`<tr id="dem-total-all-row" style="background:var(--tot-row)">
    <td class="dem-total-cell" style="position:sticky;left:0;z-index:3;background:var(--tot-sticky);border-right:1px solid var(--border2);padding:4px 10px;color:var(--blue);font-size:10px;font-weight:700;border-bottom:1px solid var(--border2)">▶ TOTAL ALL</td>`;
  months.forEach(mon=>{
    const isCol=collapsed.has(mon.ym);
    const mt=grpMonTotal(allDpEls,mon);
    h+=`<td class="dem-total-cell" style="position:sticky;z-index:1;background:var(--tot-mon);border-left:2px solid rgba(var(--blue-rgb),.25);font-size:9px;font-weight:700;color:var(--blue);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border2)">${mt>0?Math.round(mt).toLocaleString():''}</td>`;
    if(!isCol) mon.dates.forEach(ds=>{
      const v=grpTotal(allDpEls,ds);
      h+=`<td class="dem-total-cell dem-day-${mon.ym}" style="position:sticky;z-index:1;background:var(--tot-day);font-size:9px;font-weight:700;color:var(--blue);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border2);${tdSty(ds)}">${v>0?Math.round(v).toLocaleString():0}</td>`;
    });
  });
  h+=`</tr>`;

  // ── Walk tree ─────────────────────────────────────────
  const typeColors={mr:'var(--text)',co:'var(--text)',reg:'var(--text-dim)',sub:'var(--text-dim)',fac:'var(--amber)'};
  const typeBg={mr:'rgba(var(--hi-rgb),.04)',co:'rgba(var(--hi-rgb),.04)',reg:'rgba(var(--hi-rgb),.03)',sub:'rgba(var(--hi-rgb),.02)',fac:'rgba(var(--amber-rgb),.04)'};
  const typeBgSolid={mr:'var(--surface2)',co:'var(--surface2)',reg:'var(--surface)',sub:'var(--surface)',fac:'var(--surface2)'};

  tree.forEach(node=>{
    if(node.type==='fac'){
      // Facility is also a group — render header + demand point children
      const isCollapsed=grpCol.has(node.id);
      // Check if any ancestor group is collapsed
      const parentCollapsed=tree.some(n=>n!==node&&n.els&&node.els.every(el=>n.els.includes(el))&&grpCol.has(n.id));
      if(parentCollapsed) return;

      const typeLabel=node.ftype==='plant'?'PLANT':'TERMINAL';
      h+=`<tr onclick="_demToggleGrp('${node.id}')" style="cursor:pointer;background:${typeBg.fac}">
        <td style="${stickyLeft(typeBgSolid.fac,node.depth,'border-bottom:1px solid var(--border),')}color:var(--amber);font-weight:700;font-size:9px">
          ${isCollapsed?'▶':'▼'} ${node.name} <span style="font-size:7px;opacity:.5;margin-left:4px">${typeLabel}</span>
        </td>`;
      months.forEach(mon=>{
        const isCol=collapsed.has(mon.ym);
        const mt=grpMonTotal(node.els,mon);
        h+=`<td style="background:rgba(var(--amber-rgb),.06);border-left:2px solid rgba(var(--amber-rgb),.2);font-size:9px;font-weight:700;color:var(--total);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border)">${mt>0?Math.round(mt).toLocaleString():''}</td>`;
        if(!isCol) mon.dates.forEach(ds=>{
          const v=grpTotal(node.els,ds);
          h+=`<td class="dem-day-${mon.ym}" style="background:rgba(var(--amber-rgb),.04);font-size:9px;color:var(--total);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border);${tdSty(ds)}">${v>0?Math.round(v).toLocaleString():0}</td>`;
        });
      });
      h+=`</tr>`;

      if(!isCollapsed){
        // Sort demand points alphabetically by name
        const sortedEls=[...node.els].sort((a,b)=>a.name.localeCompare(b.name));

        sortedEls.forEach(el=>{
          // Demand point row (no product rows beneath). Clicking the name cell
          // filters the chart to just this demand point.
          const _elSel=el.id===_df.elId;
          h+=`<tr style="background:${_elSel?'rgba(var(--amber-rgb),.12)':'rgba(76,175,80,.05)'}">
            <td onclick="_demSelectEl('${el.id}')" title="Click to filter the chart to ${el.name.replace(/"/g,'&quot;')}" style="${stickyLeft(_elSel?'var(--sel-sticky)':'var(--surface)',node.depth+1,'border-bottom:1px solid var(--border),')}color:${_elSel?'var(--amber)':'var(--green)'};font-size:9px;font-weight:600;cursor:pointer">
              ${_elSel?'<span style="color:var(--amber)">▸ </span>':''}${esc(el.name)}<button class="sp-fb-btn" onclick="event.stopPropagation();openSpForecastBuilder(${JSON.stringify([el.id]).replaceAll('"','&quot;')},${JSON.stringify(el.name).replaceAll('"','&quot;')})" title="⚙ Forecast Builder">⚙</button>
            </td>`;
          months.forEach(mon=>{
            const isCol=collapsed.has(mon.ym);
            const monTotal=mon.dates.reduce((s,ds)=>s+getVal(el.id,ds),0);
            h+=`<td style="background:rgba(76,175,80,.08);border-left:2px solid rgba(76,175,80,.25);font-size:9px;color:var(--green);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border);font-weight:600">${monTotal>0?Math.round(monTotal).toLocaleString():''}</td>`;
            if(!isCol) mon.dates.forEach(ds=>{
              const v=getVal(el.id,ds);
              const src=getSource(el.id,ds);
              const isNwd=nwdSet.has(ds);
              const isActual=src==='actual';
              const cellBg=isNwd?'rgba(var(--red-rgb),.08)':isActual?'rgba(var(--green-rgb),.06)':'transparent';
              const cellColor=isNwd?'rgba(var(--red-rgb),.4)':isActual?'var(--real)':'var(--simulated)';
              h+=`<td class="dem-day-${mon.ym}" ondblclick="openDemandBuilder('${el.id}','${ds}')" title="Double-click to open the Forecast Builder for ${el.name.replace(/"/g,'&quot;')} starting ${ds}" style="cursor:cell;padding:1px 2px;border-bottom:1px solid var(--border);border-right:1px solid rgba(var(--hi-rgb),.03);${tdSty(ds)}">
                ${isActual
                  ? `<div style="width:50px;font-family:var(--mono);font-size:9px;text-align:right;padding:3px 4px;color:${cellColor};background:${cellBg}" title="${v?'Actual shipment data':'No shipments in the imported file — forecast overwritten with 0'} — double-click for Forecast Builder">${Math.round(v*10)/10}</div>`
                  : `<input class="dem-cell" data-el="${el.id}" data-date="${ds}"${isNwd?' data-nwd="1"':''} value="${v||''}" onchange="saveDemandCell(this)"
                      ${isNwd?'title="Non-working day — 0 by default; type a value to force a manual override"':''}
                      style="width:50px;background:${cellBg};border:${isNwd?'1px dashed rgba(var(--red-rgb),.5)':'none'};color:${cellColor};font-family:var(--mono);font-size:9px;text-align:right;padding:3px 4px;outline:none">`
                }
              </td>`;
            });
          });
          h+=`</tr>`;

          // ── Demand-swap child rows (point-to-point). Source side: own demand
          //    minus what's moved to the destination point. Destination side: own
          //    demand plus what's swapped in from the source point(s). ──
          (()=>{
            const outFn=ds=>{ const t=getVal(el.id,ds); const sw=_resolveDemandSwap(el.id,t,ds); return sw?Math.min(sw.qty,t):0; };
            const inFn=ds=>_resolveDemandSwapIn(el.id,ds,(id)=>getVal(id,ds));
            const hasOut=allDates.some(ds=>outFn(ds)>0);
            const hasIn=allDates.some(ds=>inFn(ds)>0);
            if(!hasOut&&!hasIn) return;
            const dpDisp=id=>DB.elements.find(e=>e.id===id)?.name||DB.demand_points.find(d=>d.element_id===id)?.element_name||id;
            const childRow=(label,color,bg,valFn)=>{
              let rr=`<tr style="background:${bg}"><td style="${stickyLeft('var(--surface)',node.depth+2,'border-bottom:1px solid var(--border),')}color:${color};font-size:8px;font-style:italic">${label}</td>`;
              months.forEach(mon=>{
                const isCol=collapsed.has(mon.ym);
                const mt=mon.dates.reduce((s,ds)=>s+valFn(ds),0);
                rr+=`<td style="border-left:2px solid rgba(var(--hi-rgb),.05);font-size:8px;color:${color};text-align:right;padding:3px 6px;border-bottom:1px solid var(--border)">${mt>0?Math.round(mt).toLocaleString():''}</td>`;
                if(!isCol) mon.dates.forEach(ds=>{ const v=valFn(ds); rr+=`<td class="dem-day-${mon.ym}" style="font-size:8px;color:${color};text-align:right;padding:3px 4px;border-bottom:1px solid var(--border);${tdSty(ds)}">${v>0?Math.round(v).toLocaleString():''}</td>`; });
              });
              return rr+`</tr>`;
            };
            const myName=DB.products.find(p=>p.id===((typeof _demElProdIds==='function'?_demElProdIds(el):[])[0]))?.name||'own';
            const outDest=[...new Set((DB.demand_substitutions||[]).filter(s=>s.from_element_id===el.id).map(s=>dpDisp(s.to_element_id)))].join(', ');
            const inSrc=[...new Set((DB.demand_substitutions||[]).filter(s=>s.to_element_id===el.id).map(s=>dpDisp(s.from_element_id)))].join(', ');
            h+=childRow('↳ '+myName+' · own','var(--green)','rgba(76,175,80,.03)',ds=>getVal(el.id,ds)-outFn(ds));
            if(hasOut) h+=childRow('↳ ⇄ moved to '+(outDest||'destination'),'var(--amber)','rgba(var(--amber-rgb),.05)',outFn);
            if(hasIn)  h+=childRow('↳ ⇄ swapped in ← '+(inSrc||'source'),'var(--cyan)','rgba(var(--cyan-rgb),.06)',inFn);
            h+=childRow('↳ = demand here (own ± swap)','var(--total)','rgba(var(--hi-rgb),.04)',ds=>getVal(el.id,ds)-outFn(ds)+inFn(ds));
          })();
        });
      }
    } else {
      // Region / sub-region / country / MR group header
      const isCollapsed=grpCol.has(node.id);
      const parentCollapsed=tree.some(n=>n!==node&&['mr','co','reg','sub'].includes(n.type)&&n.els&&node.els.every(el=>n.els.includes(el))&&grpCol.has(n.id));
      if(parentCollapsed) return;
      const bg=typeBg[node.type]||'transparent';
      const bgSolid=typeBgSolid[node.type]||'var(--surface)';
      const col=typeColors[node.type]||'var(--text)';
      h+=`<tr onclick="_demToggleGrp('${node.id}')" style="cursor:pointer;background:${bg};border-top:${node.type==='reg'||node.type==='mr'?'2':'1'}px solid var(--border2)">
        <td style="${stickyLeft(bgSolid,node.depth,'border-bottom:1px solid var(--border2),')}color:${col};font-weight:${node.type==='reg'?'700':'400'};font-size:${node.type==='reg'?'9':'9'}px;letter-spacing:${node.type==='reg'?'.5px':'0'}">
          ${isCollapsed?'▶':'▼'} ${node.name}
        </td>`;
      months.forEach(mon=>{
        const isCol=collapsed.has(mon.ym);
        const mt=grpMonTotal(node.els,mon);
        h+=`<td style="border-left:2px solid rgba(var(--blue-rgb),.15);font-size:9px;color:var(--text-dim);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border2)">${mt>0?Math.round(mt).toLocaleString():''}</td>`;
        if(!isCol) mon.dates.forEach(ds=>{
          const v=grpTotal(node.els,ds);
          h+=`<td class="dem-day-${mon.ym}" style="font-size:9px;color:var(--text-dim);text-align:right;padding:4px 6px;border-bottom:1px solid var(--border2);${tdSty(ds)}">${v>0?Math.round(v).toLocaleString():0}</td>`;
        });
      });
      h+=`</tr>`;
    }
  });

  h+=`</tbody></table>`;
  wrap.innerHTML=h;
  _monthTotalsToEnd(wrap,'dem-day-',false); // month total at END of each month
  window._demMonths=months.map(m=>m.ym);
  _yearTotalsAfterMonths(wrap,'dem-day-',months,collapsed,'_demToggleYear'); // Σ YYYY after each year
  _monthsBtnLabel('dem-months-btn',collapsed,window._demMonths);

  // Sync top scrollbar + fix Total ALL sticky top
  const topScroll=document.getElementById('dem-top-scroll');
  const topInner=document.getElementById('dem-top-inner');
  if(topScroll&&topInner){
    requestAnimationFrame(()=>{
      topInner.style.width=wrap.scrollWidth+'px';
      // Set sticky top on Total ALL row cells to sit just below the thead
      const theadTr=wrap.querySelector('thead tr');
      const totalRow=document.getElementById('dem-total-all-row');
      if(theadTr&&totalRow){
        const thH=Math.ceil(theadTr.getBoundingClientRect().height)+1;
        totalRow.querySelectorAll('td').forEach(td=>td.style.top=thH+'px');
      }
    });
    topScroll.onscroll=()=>{ wrap.scrollLeft=topScroll.scrollLeft; };
    wrap.onscroll=()=>{ topScroll.scrollLeft=wrap.scrollLeft; };
  }

  renderDemandChart(); // daily chart above the grid — same filters as the table
}

// ── DAILY DEMAND CHART — mirror of the Sales page daily shipments chart ──────
// Green actual bars + orange forecast bars (stacked from the same demand grid the
// table shows), last year's actual demand as a soft blue area behind, dotted
// 10/15/30-working-day average guide lines, and a today marker. Honors the same
// facility/category/product/type filters as the grid; collapsible; range buttons
// window the view around today.
function _demChartToggle(){
  window._demChartCol=!window._demChartCol;
  const b=document.getElementById('dem-chart-body'); if(b) b.style.display=window._demChartCol?'none':'flex';
  const a=document.getElementById('dem-chart-arrow'); if(a) a.textContent=window._demChartCol?'▶':'▼';
  if(!window._demChartCol) renderDemandChart();
}
function _demChartSetRange(r,btn){
  window._demChartRng=r;
  document.querySelectorAll('.dem-chart-rng').forEach(b=>b.classList.toggle('active',b===btn));
  renderDemandChart();
}
// MTD/YTD toggle for the left side panel (mirrors the Sales page)
function _demSideMode(m){
  window._demSideM=m;
  ['mtd','ytd'].forEach(k=>{ const el=document.getElementById('dem-side-'+k); if(el) el.classList.toggle('active', k===m.toLowerCase()); });
  renderDemandChart();
}
// Mini LY·CY·BGT bar chart (same look as the Sales side panels)
const _demMiniCharts={};
function _demMiniBars(canvasId,v,title){
  const canvas=document.getElementById(canvasId); if(!canvas) return;
  if(_demMiniCharts[canvasId]){ _demMiniCharts[canvasId].destroy(); _demMiniCharts[canvasId]=null; }
  _demMiniCharts[canvasId]=new Chart(canvas,{ type:'bar',
    data:{labels:['LY','CY','BGT'],datasets:[{data:[v.LY||0,v.CY||0,v.BGT||0],
      backgroundColor:['rgba(77,166,255,.45)','rgba(0,200,120,.8)','rgba(255,184,48,.7)'].map(_tc),borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false},title:{display:true,text:title,color:_tc('#8e9ab8'),font:{family:'Space Mono',size:10}},
        tooltip:{callbacks:{label:c=>c.raw!=null?Number(c.raw).toLocaleString()+' t':''}}},
      scales:{x:{grid:{display:false},ticks:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:8}}},
              y:{grid:{color:_tc('rgba(255,255,255,.05)')},ticks:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:7},callback:x=>x>=1000?Math.round(x/100)/10+'k':x}}} } });
}
function _demMiniCaption(v){
  const f=x=>x==null?'<span style="opacity:.5">—</span>':(x>=1e6?(x/1e6).toFixed(2)+'M t':x>=1000?Math.round(x/100)/10+'k t':Math.round(x)+' t');
  return `<span style="color:rgba(var(--blue-rgb),.75)">LY</span> ${f(v.LY)} · <span style="color:var(--green)">CY</span> ${f(v.CY)} · <span style="color:var(--amber)">BGT${v.BGTyear?' ’'+String(v.BGTyear).slice(2):''}</span> ${f(v.BGT)}`;
}
let _demChartInst=null;
function renderDemandChart(){
  const canvas=document.getElementById('dem-chart'); if(canvas===null) return;
  if(window._demChartCol) return;
  const todayStr=new Date()._ymd();

  // Same filtered element set as the demand grid
  let els=getFacElements().filter(e=>e.type==='demand_point');
  const df=_demEnsureFilter();
  const facFor=el=>el.assigned_facility_id||el.facility_id||S.facility_id;
  const fs=fltFacIdSet(), allowP=fltAllowedProdIds();
  if(fs)     els=els.filter(el=>fs.has(facFor(el)));
  if(allowP) els=els.filter(el=>_demElProdIds(el).some(pid=>allowP.has(pid)));
  if(df.custType!=='all') els=els.filter(el=>_demElType(el)===df.custType);
  // A selected demand-point row overrides the dropdown filters — chart shows just it.
  if(df.elId){ const one=getFacElements().filter(e=>e.type==='demand_point'&&e.id===df.elId); if(one.length) els=one; }
  const elIds=new Set(els.map(e=>e.id));
  const selName=df.elId?((getFacElements().find(e=>e.id===df.elId)||{}).name||''):'';

  // Aggregate demand_values per element|date (ship-to rows override the dp-level row,
  // mirroring the grid's map), then per date split by source: actual vs forecast.
  const perKey={};
  (DB.demand_values||[]).forEach(v=>{
    if(!v.element_id||!v.date||!elIds.has(v.element_id)) return;
    const k=v.element_id+'|'+v.date;
    if(v.ship_to){
      const r=(perKey[k]&&perKey[k].hasShip)?perKey[k]:{v:0,src:v.source,hasShip:true};
      r.v+=(parseFloat(v.value_t)||0); perKey[k]=r;
    } else if(!perKey[k]?.hasShip) perKey[k]={v:parseFloat(v.value_t)||0,src:v.source,hasShip:false};
  });
  const actMap={}, fcMap={}; let actMin=null, actMax=null;
  Object.keys(perKey).forEach(k=>{
    const ds=k.slice(k.indexOf('|')+1), r=perKey[k];
    if(r.src==='actual'){ actMap[ds]=(actMap[ds]||0)+r.v; if(!actMin||ds<actMin) actMin=ds; if(!actMax||ds>actMax) actMax=ds; }
    else fcMap[ds]=(fcMap[ds]||0)+r.v;
  });

  // Window around today (30/90/180 back+forward), or the full grid span
  const rng=window._demChartRng||'90';
  let winStart, winEnd;
  const simStartStr=S.simCfg.start_date||todayStr;
  const simEnd=new Date(simStartStr+'T00:00:00'); simEnd.setDate(simEnd.getDate()+(S.simCfg.horizon||90));
  if(rng==='all'){
    winStart=actMin&&actMin<simStartStr?actMin:simStartStr;
    winEnd=simEnd._ymd();
  } else {
    const n=parseInt(rng)||90;
    const a=new Date(todayStr+'T00:00:00'); a.setDate(a.getDate()-n); winStart=a._ymd();
    const b2=new Date(todayStr+'T00:00:00'); b2.setDate(b2.getDate()+n); winEnd=b2._ymd();
  }
  const labels=[];
  for(let d=new Date(winStart+'T00:00:00'); d._ymd()<=winEnd; d.setDate(d.getDate()+1)) labels.push(d._ymd());
  if(!labels.length) return;
  // Budget (from the linked Planning scenario's file, read-only) for the same demand points.
  const bgt=(typeof plBgtEnsure==='function')?plBgtEnsure():null;
  const bgtMap={}; if(bgt){ els.forEach(el=>{ const by=bgt.byEl[el.id]||bgt.byName[el.name]; if(!by) return; Object.keys(by).forEach(ym=>{ (by[ym]||[]).forEach((t,i)=>{ if(t>0){ const ds=ym+'-'+String(i+1).padStart(2,'0'); bgtMap[ds]=(bgtMap[ds]||0)+t; } }); }); }); }
  const bgtData=labels.map(ds=>bgtMap[ds]?Math.round(bgtMap[ds]):null); const hasBgt=bgtData.some(v=>v);

  const actData=labels.map(ds=>actMap[ds]?Math.round(actMap[ds]):null);
  const fcData =labels.map(ds=>fcMap[ds]?Math.round(fcMap[ds]):null);
  // Last year's actual demand for the same calendar day — soft area behind the bars
  const lyData=labels.map(ds=>{
    const ld=(parseInt(ds.slice(0,4))-1)+ds.slice(4);
    if(!actMin||ld<actMin||ld>(actMax||todayStr)) return null;
    return Math.round(actMap[ld]||0);
  });
  const hasLY=lyData.some(v=>v);

  // Guide lines: 10/15/30 working-day averages of actuals ending at the last actual day
  const guides=[];
  if(actMax){
    const maOf=n=>{ let cnt=0,sum=0; const d=new Date(actMax+'T00:00:00'); let g=0;
      while(cnt<n&&g<70){ const dow=d.getDay(); if(dow>=1&&dow<=5){ sum+=actMap[d._ymd()]||0; cnt++; } d.setDate(d.getDate()-1); g++; }
      return cnt?sum/cnt:0; };
    [{n:10,color:_tc('rgba(0,255,157,.85)')},{n:15,color:_tc('rgba(255,184,48,.85)')},{n:30,color:_tc('rgba(255,80,120,.85)')}]
      .forEach(gd=>{ const v=Math.round(maOf(gd.n)); if(v>0) guides.push({...gd,q:v}); });
  }

  // Legend
  const leg=document.getElementById('dem-chart-legend');
  if(leg){
    let lh=`<span style="color:var(--green)">■ Actual</span><span style="color:var(--fc-orange)">■ Forecast</span>`;
    if(hasLY) lh+=`<span style="color:rgba(var(--hi-rgb),.85)">● Last Year</span>`;
    if(hasBgt) lh+=`<span style="color:var(--amber)">╌ Budget ${bgt.year}</span>`;
    guides.forEach(gd=>{ lh+=`<span style="color:${gd.color}">╌ ${gd.n}WD ${gd.q>=1000?(gd.q/1000).toFixed(1)+'k':gd.q} t</span>`; });
    if(selName) lh=`<span onclick="_demClearElSel()" title="Clear selection — show all demand points" style="cursor:pointer;color:var(--amber);border:1px solid var(--amber);border-radius:3px;padding:0 5px;margin-right:4px">▸ ${selName} ✕</span>`+lh;
    leg.innerHTML=lh;
  }

  // ── Side panels: LY vs CY vs BGT for MTD/YTD (left) and full-year (right) ──
  // MTD/YTD compare ACTUALS to date vs the same period last year; FY adds this
  // year's forecast for the remainder. BGT stays null until a budget feed exists.
  const shiftY=ds=>(parseInt(ds.slice(0,4))-1)+ds.slice(4);
  const sumRange=(map,from,to)=>{ let t=0; for(const ds in map){ if(ds>=from&&ds<=to) t+=map[ds]; } return t; };
  const y=todayStr.slice(0,4), mo=todayStr.slice(5,7);
  const sideMode=window._demSideM||'MTD';
  const lFrom=sideMode==='YTD'?`${y}-01-01`:`${y}-${mo}-01`, lTo=todayStr;
  // BGT = the same calendar window in the budget year (the budget lives in the year after this one).
  const bY=bgt?String(bgt.year):null, toB=ds=>bY+ds.slice(4);
  const left={ LY:Math.round(sumRange(actMap,shiftY(lFrom),shiftY(lTo))),
               CY:Math.round(sumRange(actMap,lFrom,lTo)), BGT:bgt?Math.round(sumRange(bgtMap,toB(lFrom),toB(lTo))):null, BGTyear:bgt?bgt.year:null };
  const fFrom=`${y}-01-01`, fTo=`${y}-12-31`;
  const fcFrom=actMax?new Date(actMax+'T00:00:00'):null; if(fcFrom) fcFrom.setDate(fcFrom.getDate()+1);
  const fy={ LY:Math.round(sumRange(actMap,shiftY(fFrom),shiftY(fTo))),
             CY:Math.round(sumRange(actMap,fFrom,fTo)+sumRange(fcMap,fcFrom?(fcFrom._ymd()>fFrom?fcFrom._ymd():fFrom):fFrom,fTo)), BGT:bgt?Math.round(sumRange(bgtMap,`${bY}-01-01`,`${bY}-12-31`)):null, BGTyear:bgt?bgt.year:null };
  const capL=document.getElementById('dem-side-cap-mtd'); if(capL) capL.innerHTML=_demMiniCaption(left);
  const capF=document.getElementById('dem-side-cap-fy');  if(capF) capF.innerHTML=_demMiniCaption(fy);

  const datasets=[];
  // Last year: a small unobtrusive white dot in front of each day's bar (was a
  // filled area) — just enough to read the prior-year value at a glance / on hover.
  if(hasLY) datasets.push({ type:'line', label:'Last Year', data:lyData,
    showLine:false, pointRadius:1.3, pointHoverRadius:3,
    pointBackgroundColor:_tc('rgba(255,255,255,0.85)'), pointBorderColor:_tc('rgba(255,255,255,0.85)'),
    spanGaps:true, order:0 });
  datasets.push(
    { label:'Actual',   data:actData, backgroundColor:_tc('rgba(0,200,120,0.75)'), stack:'v', order:3 },
    { label:'Forecast', data:fcData,  backgroundColor:_tc('rgba(255,140,50,0.78)'), stack:'v', order:3 },
  );
  if(hasBgt) datasets.push({ type:'line', label:'Budget '+bgt.year, data:bgtData, borderColor:_tc('rgba(255,184,48,.9)'), borderWidth:1.5, borderDash:[4,3], pointRadius:0, spanGaps:false, order:1 });

  const todayPlugin={ id:'demToday', afterDraw(chart){ const idx=chart.data.labels.indexOf(todayStr); if(idx<0) return;
    const x=chart.scales.x.getPixelForValue(idx); const {top,bottom}=chart.chartArea; const c=chart.ctx;
    c.save(); c.strokeStyle=_tc('rgba(255,61,90,0.55)'); c.lineWidth=1; c.setLineDash([3,3]);
    c.beginPath(); c.moveTo(x,top); c.lineTo(x,bottom); c.stroke(); c.restore(); } };
  const guidesPlugin={ id:'demGuides', afterDatasetsDraw(chart){ if(!guides.length) return;
    const {left,right,top,bottom}=chart.chartArea, c=chart.ctx, ys=chart.scales.y;
    c.save(); c.font='8px "Space Mono",monospace'; c.textBaseline='bottom';
    guides.forEach((gd,i)=>{ const y=ys.getPixelForValue(gd.q); if(y<top||y>bottom) return;
      c.strokeStyle=_tc(gd.color); c.lineWidth=1; c.setLineDash([4,4]);
      c.beginPath(); c.moveTo(left,y); c.lineTo(right,y); c.stroke();
      const txt=`${gd.n}WD ${gd.q>=1000?(gd.q/1000).toFixed(1)+'k':gd.q}`;
      const tw=c.measureText(txt).width, tx=left+6+i*(tw+26);
      c.fillStyle=_tc('rgba(10,14,26,.85)'); c.fillRect(tx-2,y-11,tw+4,10);
      c.fillStyle=_tc(gd.color); c.fillText(txt,tx,y-2); });
    c.restore(); } };

  const buildIt=()=>{
    _demMiniBars('dem-mini-mtd', left, sideMode);
    _demMiniBars('dem-mini-fy',  fy,  'FY');
    if(_demChartInst){ _demChartInst.destroy(); _demChartInst=null; }
    _demChartInst=new Chart(canvas,{ type:'bar', data:{labels:[...labels],datasets},
      options:{ responsive:true,maintainAspectRatio:false,animation:false,
        plugins:{ legend:{display:false},
          tooltip:{mode:'index',intersect:false,callbacks:{
            title:items=>items[0]?.label||'',
            label:c=>c.raw!=null?`${c.dataset.label}: ${Number(c.raw).toLocaleString()} t`:'' }} },
        scales:{ x:{stacked:true,grid:{color:_tc('rgba(255,255,255,.03)')},ticks:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:8},maxTicksLimit:14,autoSkip:true,maxRotation:0}},
                 y:{stacked:true,grid:{color:_tc('rgba(255,255,255,.05)')},ticks:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:8},callback:v=>v>=1000?Math.round(v/100)/10+'k':v}} }
      }, plugins:[todayPlugin,guidesPlugin] });
  };
  loadLib('chart').then(buildIt).catch(e=>console.warn(e)); // pinned version + SRI — see LIBS
}

function _demToggleGrp(id){
  if(!window._demGrpCol) window._demGrpCol=new Set();
  if(window._demGrpCol.has(id)) window._demGrpCol.delete(id);
  else window._demGrpCol.add(id);
  renderDemandView();
}
// Demand-only controls: the INT/EXT type and the chart's selected row. Facility, sub-region,
// product and the time frame are the shared filter bar's (window._flt).
function _demEnsureFilter(){
  if(!window._demFilter) window._demFilter={custType:'all',elId:''};
  if(window._demFilter.custType===undefined) window._demFilter.custType='all';
  if(window._demFilter.elId===undefined) window._demFilter.elId='';
  return window._demFilter;
}
// The first and last day the Demand grid can show: from the earliest recorded actual (or the
// simulation start, if earlier) to the end of the simulation — the same span renderDemandView's
// date spine walks, so the time frame is cut to what the grid really has.
function _demGridSpan(){
  if(!S.simCfg.start_date) return {from:'',to:''};
  const simStart=new Date(S.simCfg.start_date+'T00:00:00');
  const horizon=S.simCfg.horizon||90;
  let earliest=null;
  (DB.demand_values||[]).forEach(v=>{ if(v.source==='actual'&&v.date&&(!earliest||v.date<earliest)) earliest=v.date; });
  const from=earliest&&earliest<simStart._ymd()?earliest:simStart._ymd();
  // The spine stops before sim start + horizon calendar days; its last day is the one before.
  const last=new Date(simStart); last.setDate(last.getDate()+horizon-1);
  return {from, to:last._ymd()};
}
FLT_PAGES.dem={
  bounds:()=>_demGridSpan(),
  proc:()=>null,   // the grid has no sections to hide
  // Clear all also resets the page's own type chips and the chart's row selection.
  onClearAll:()=>{ const f=_demEnsureFilter(); f.custType='all'; f.elId=''; },
  rerender:()=>renderDemandView()
};
// Clicking a demand-point row selects it — the chart filters to just that point
// (click again, or the ✕ chip on the chart, to clear). Mirrors Avila Sales.
function _demSelectEl(elId){
  const f=_demEnsureFilter();
  f.elId = (f.elId===elId) ? '' : elId;
  renderDemandView();
}
function _demClearElSel(){ _demEnsureFilter().elId=''; renderDemandView(); }
function _demOnTypeChange(t){
  _demEnsureFilter().custType=t;
  renderDemandView();
}
function _demToggleMonth(ym){
  if(!window._demColapsed) window._demColapsed=new Set();
  if(window._demColapsed.has(ym)) window._demColapsed.delete(ym);
  else window._demColapsed.add(ym);
  renderDemandView();
}
// Σ YYYY header click: fold that year's months to their totals, or open them when all are folded.
function _demToggleYear(y){ _foldMonths(window._demColapsed,(window._demMonths||[]).filter(m=>m.slice(0,4)===y)); renderDemandView(); }
// Toolbar button: every month in view folded (month + year totals only) ⇄ every month open.
function _demToggleAllMonths(){ _foldMonths(window._demColapsed,window._demMonths||[]); renderDemandView(); }

// Shared by the Today buttons (Demand + Supply): put today's column exactly 7 day-columns
// to the right of the sticky row-header column, so the user sees the week before today.
function _scrollTodayInWrap(wrap){
  const th=wrap.querySelector('th[style*="border-left:2px solid var(--green)"]');
  if(!th) return false;
  const first=wrap.querySelector('thead th, tr th');           // sticky row-title header
  const stickyW=first?first.getBoundingClientRect().width:0;
  const wr=wrap.getBoundingClientRect(), tr=th.getBoundingClientRect();
  const delta=tr.left-(wr.left+stickyW+7*tr.width);
  wrap.scrollTo({left:Math.max(0,wrap.scrollLeft+delta),behavior:'smooth'});
  return true;
}
function demandScrollToday(){
  const todayStr=new Date()._ymd();
  const wrap=document.getElementById('demand-table-wrap'); if(!wrap) return;
  if(!_scrollTodayInWrap(wrap)) statMsg('Today is outside the selected time frame (or its month is collapsed)');
}

// Every demand-writing path should end here. Demand values are shown on THREE pages —
// the Demand grid, the Supply page's nested demand rows (_demCellHtml), and Sales
// Performance — so re-rendering only the Demand view leaves the others stale. That was
// the "Forecast Builder does nothing on the Supply page" bug: the values WERE written,
// the Supply row just never redrew. Re-render whichever view is actually showing, then
// re-run the sim (debounced) so the new demand flows through, same as a manual cell edit.
function _demandChanged(resim=true){
  _demandCacheInvalidate();
  if(S.view==='supply'){ if(typeof renderSupplyView==='function') renderSupplyView(); }
  else if(S.view==='salesperf'){ if(typeof renderSalesPerfView==='function') renderSalesPerfView(); }
  else if(typeof renderDemandView==='function') renderDemandView();
  if(resim && typeof scheduleSimulation==='function') scheduleSimulation();
}

// Single-cell save — fires on every cell change (incl. clearing to delete) so a
// manual edit persists immediately, no "Save Forecast" click needed. Clearing a
// cell (empty / 0) removes the row permanently.
function saveDemandCell(inp){
  if(!inp) return;
  if(!DB.demand_values) DB.demand_values=[];
  const elId=inp.dataset.el, ds=inp.dataset.date;
  const v=parseFloat(inp.value)||0;
  const isNwd=_isNWD(ds);
  DB.demand_values=DB.demand_values.filter(r=>!(r.element_id===elId&&r.date===ds));
  // On a non-working day a typed value becomes a MANUAL override (flagged), which is the only
  // way demand counts on that date. 0 clears it back to the default (no demand).
  // In a Planning scenario the typed day is a budget override tagged with the active version:
  // regeneration keeps it, switching the active version drops it (see plMaterialise).
  const _plv=(scIsPlanning()&&typeof plActiveVersion==='function')?plActiveVersion():null;
  const _tag=_plv&&_plv.generated_at?{source:'budget', version_id:_plv.id, manual:true}:{};
  if(v>0) DB.demand_values.push(isNwd?{element_id:elId, date:ds, value_t:v, nwd_manual:true, ..._tag}:{element_id:elId, date:ds, value_t:v, ..._tag});
  autoSave();
  _demandCacheInvalidate();
  if(typeof scheduleSimulation==='function') scheduleSimulation();
}

// One editable demand cell for element `el` on date `ds` — actual shipments render as a
// read-only coloured div, forecast/future days as an input wired to saveDemandCell, and
// either double-click opens the Forecast Builder. Pulled out of the Demand page's own grid
// (renderDemandView) so the Supply page's nested demand-point rows can look/behave identically.
//
// dayCls MUST match the prefix the host page passes to _monthTotalsToEnd — 'dem-day-' on the
// Demand page, 'sup-day-' on Supply. That pass finds each row's DAY cells by this class and
// moves the month-total cell from the front of the run to the end; a row whose day cells carry
// the wrong prefix is skipped, keeps its total at the front, and ends up rendering every value
// one column to the right of its true date.
function _demCellHtml(el, ds, monYm, tdStyStr, dayCls){
  const isActual=_dedupRealProd(el.id, ds).length>0;
  const v=_demandRate(el.id, ds);
  const isNwd=_isNWD(ds);
  // Supply page: imported actual sales read as actual too (the Demand grid keeps its own look).
  const act=isActual||(dayCls==='sup-day-'&&_dmdIsActual(el.id,ds));
  // Look = classes (td.sx-dm rules in the stylesheet): red for a non-working day, green for an actual
  // day, plain otherwise — a non-working day wins over actual, as the inline colours always did.
  const look=isNwd?' sx-nwd':act?' sx-act':'';
  const nm=(el.name||'').replace(/"/g,'&quot;');
  // On the Supply page the cell carries its source like every other Supply number.
  const src=dayCls==='sup-day-'&&v>0?(act?' cell-real':(ds<new Date()._ymd()?' cell-gap':'')):'';
  return `<td class="${dayCls||'dem-day-'}${monYm}${src} sx-dm${look}" ondblclick="openDemandBuilder('${el.id}','${ds}')" title="Double-click to open the Forecast Builder for ${nm} starting ${ds}"${tdStyStr?` style="${tdStyStr}"`:''}>${isActual
      ? `<div title="Actual shipment data — double-click for Forecast Builder">${v?Math.round(v*10)/10:''}</div>`
      : `<input class="dem-cell" data-el="${el.id}" data-date="${ds}"${isNwd?' data-nwd="1"':''} value="${v||''}" onchange="saveDemandCell(this)"${isNwd?' title="Non-working day — 0 by default; type a value to force a manual override"':''}>`
    }</td>`;
}

// "↓ Save Forecast". Every cell already saves itself the moment it changes (saveDemandCell),
// so this only commits cells whose value differs from what the grid last rendered — an edit
// whose change event never fired — then refreshes the page showing demand.
// It must never again:
//   • read inputs outside the Demand grid. The Supply page renders the same .dem-cell inputs
//     (_demCellHtml) and keeps them in the DOM while hidden — and stale, since a cell edit
//     doesn't redraw Supply. A page-wide query wrote them AFTER the Demand grid's, so Save
//     reverted the edit just made here; and Supply shows a ship-to split day as ONE ship-to's
//     share (_demandRate), so that day's total shrank to it.
//   • rewrite cells nobody edited. That collapsed ship-to split rows into one row and deleted
//     the forecast kept behind non-working days. (Actual days render as divs, not inputs.)
function saveDemandValues(){
  if(!DB.demand_values) DB.demand_values=[];
  let n=0;
  document.querySelectorAll('#demand-table-wrap input.dem-cell').forEach(inp=>{
    if((parseFloat(inp.value)||0)===(parseFloat(inp.defaultValue)||0)) return;
    saveDemandCell(inp);            // exactly what editing the cell does
    inp.defaultValue=inp.value;
    n++;
  });
  autoSave();
  statMsg(n?`Demand forecast saved (${n} edited cell${n===1?'':'s'})`:'Demand forecast saved');
  _demandChanged(n>0);              // redraw; re-run the simulation only if something changed
}

// ── Month-total column → END-of-month position (post-render DOM pass) ──
// The month/day grids all EMIT each month as [total][day…] because that's the
// simplest build order (compute the total, then walk the days). This pass flips
// the rendered DOM to [day…][total] so the total column reads as a month-END
// summary, WITHOUT touching the ~60 places that build these grids. It keys off
// the class markers those grids already carry:
//   • Supply/Demand — DAY cells carry sup-day-<ym> / dem-day-<ym>; the total is
//     the unclassed cell that precedes each day run (markedIsTotal=false).
//   • Logistics — the TOTAL cells carry logi-mcol; days are unclassed
//     (markedIsTotal=true).
// Collapsed months (total cell with no following day cells) are left in place.
// `root` may be a table wrapper (its <tr>s are processed) or a single <tr>.
function _monthTotalsToEnd(root, cls, markedIsTotal){
  if(!root) return;
  const rows = root.matches&&root.matches('tr') ? [root] : [...root.querySelectorAll('tr')];
  rows.forEach(tr=>{
    const cells=[...tr.children];
    if(cells.length<3) return; // skip label-only / full-width colspan (divider) rows
    for(let i=1;i<cells.length;i++){
      const c=cells[i];
      const marked=(c.className||'').includes(cls);
      if((markedIsTotal?marked:!marked)!==true) continue; // not a total cell
      let last=null,j=i+1;
      for(;j<cells.length;j++){
        const m=(cells[j].className||'').includes(cls);
        if((markedIsTotal?m:!m)===true) break; // reached the next month's total
        last=cells[j];
      }
      if(last) tr.insertBefore(c,last.nextSibling);
      i=j-1;
    }
  });
}

// ── Year-total columns for the logistics planners (post-render DOM pass) ──
// Runs AFTER _monthTotalsToEnd, so each row already has its month-total cells
// (class `cls`, one per month, in month order) sitting at end-of-month. This adds a
// heavier Σ YYYY cell after the last month of each year. Flow rows sum their months;
// inventory rows (tp-row-inv) carry the year-END snapshot (last month's value). It
// also widens full-width group-header rows so their colspan covers the new columns.
//   monYms  : ordered month keys ('YYYY-MM') matching the month-total cell order
//   yearEnds: boolean[] — yearEnds[k]=true if month k is the last month of its year
function _logiYearTotalsToEnd(root, cls, monYms, yearEnds, nYears){
  if(!root||!nYears) return;
  const rows = root.matches&&root.matches('tr') ? [root] : [...root.querySelectorAll('tr')];
  rows.forEach(tr=>{
    const cells=[...tr.children];
    // Full-width group/divider header: widen its colspan to span the year columns.
    if(cells.length===1 && cells[0].hasAttribute('colspan')){
      const cs=parseInt(cells[0].getAttribute('colspan'))||1;
      if(cs>1) cells[0].setAttribute('colspan', cs+nYears);
      return;
    }
    if(cells.length<3) return;
    const mcols=cells.filter(c=>(c.className||'').includes(cls));
    if(mcols.length!==monYms.length) return; // structure mismatch → leave row untouched
    const isLast=(tr.className||'').includes('tp-row-inv'); // inventory → end-of-year snapshot
    let acc=0, has=false, unit='';
    for(let k=0;k<mcols.length;k++){
      const txt=mcols[k].textContent||'';
      const num=parseFloat(txt.replace(/[^0-9.\-]/g,''));
      if(!isNaN(num)){ has=true; if(/cars/.test(txt)) unit=' cars'; else if(/t/.test(txt)) unit='t';
        if(isLast) acc=num; else acc+=num; }
      if(yearEnds[k]){
        const yc=document.createElement('td');
        yc.className='logi-ycol';
        yc.setAttribute('style','background:var(--total-faint);border-left:3px double var(--border2);border-right:1px solid var(--border2);font-weight:700;color:var(--total);text-align:right;padding:3px 9px;');
        yc.textContent=has?Number(Math.round(acc)).toLocaleString()+unit:'—';
        tr.insertBefore(yc, mcols[k].nextSibling);
        acc=0; has=false; unit='';
      }
    }
  });
}
// Header variant: inserts a Σ YYYY <th> after each year's last month header cell.
// `toggleFn` + `collapsed` (optional): the cell folds / opens that year's months on click.
function _logiYearHeader(root, cls, monYms, yearEnds, toggleFn, collapsed){
  if(!root) return;
  const mcols=[...root.children].filter(c=>(c.className||'').includes(cls));
  if(mcols.length!==monYms.length) return;
  mcols.forEach((th,k)=>{
    if(!yearEnds[k]) return;
    const y=monYms[k].slice(0,4);
    const yth=document.createElement('th');
    yth.className='logi-ycol';
    yth.setAttribute('style','border-left:3px double var(--border2);border-right:1px solid var(--border2);color:var(--total);font-size:8px;font-weight:700;text-align:center;padding:4px 7px;position:sticky;top:0;background:var(--surface2);white-space:nowrap');
    if(toggleFn){
      const yms=monYms.filter(m=>m.slice(0,4)===y), allCol=!!collapsed&&yms.every(m=>collapsed.has(m));
      yth.innerHTML=`<span style="margin-right:3px">${allCol?'▶':'▼'}</span>Σ ${y}`;
      yth.title=allCol?`Open the months of ${y}`:`Fold the months of ${y} to their totals`;
      yth.style.cursor='pointer'; yth.setAttribute('onclick',`${toggleFn}('${y}')`);
    } else yth.textContent='Σ '+y;
    th.parentNode.insertBefore(yth, th.nextSibling);
  });
}
// Build (monYms, yearEnds, nYears) from a logistics `months` array.
function _logiYearMeta(months){
  const monYms=months.map(m=>m.ym);
  const yearEnds=months.map((m,i)=>i===months.length-1||months[i+1].ym.slice(0,4)!==m.ym.slice(0,4));
  return {monYms, yearEnds, nYears:yearEnds.filter(Boolean).length};
}

// ── Year-total columns for the Demand and Supply tables (post-render DOM pass) ──
// Runs AFTER _monthTotalsToEnd(wrap, dayCls, false): in every row the cells after the label are
// day cells (class dayCls + 'YYYY-MM') and one unclassed month-total cell at the END of each month.
// This inserts a Σ YYYY cell after each year's last month — in the header (a click folds or opens
// that year's months) and in every row whose month cells line up with the header.
//   • A row's Σ is the sum of its month totals. A month cell marked sx-mavg (the inventory rows,
//     which show a monthly average) gives a day-weighted average for the year instead.
//   • A unit suffix after the number ("12d") is kept; a blank month row stays blank.
//   • Full-width rows (one cell with a colspan) are widened by the number of year columns.
//   • The year cell copies the month cell's inline style, so it keeps the row's colour; the
//     sx-ycol rule in <style> gives it the heavier double border.
function _yearTotalsAfterMonths(wrap, dayCls, months, collapsed, toggleFn){
  if(!wrap||!months||!months.length) return;
  const monYms=months.map(m=>m.ym), monDays=months.map(m=>(m.dates||m.days||[]).length||1);
  const yearEnds=monYms.map((ym,i)=>i===monYms.length-1||monYms[i+1].slice(0,4)!==ym.slice(0,4));
  const nYears=yearEnds.filter(Boolean).length;
  const num=txt=>{ const m=/^\s*(-?[\d,]*\.?\d+)\s*([A-Za-z%]*)/.exec(txt||''); return m?{v:parseFloat(m[1].replace(/,/g,'')),u:m[2]||''}:null; };
  wrap.querySelectorAll('tr').forEach(tr=>{
    const cells=[...tr.children]; if(cells.length<2) return;
    const mcols=cells.slice(1).filter(c=>!(c.className||'').includes(dayCls));
    if(mcols.length!==monYms.length){
      // Not a month-grid row: a full-width divider / section header spans the new columns too.
      const wide=cells.find(c=>(parseInt(c.getAttribute('colspan'))||1)>1);
      if(wide){ const cs=parseInt(wide.getAttribute('colspan')); if(cs<900) wide.setAttribute('colspan',cs+nYears); }
      return;
    }
    const isHead=mcols[0].tagName==='TH';
    let acc=0, days=0, has=false, unit='', avg=false;
    for(let k=0;k<mcols.length;k++){
      const c=mcols[k];
      if(!isHead){
        const isAvg=c.classList.contains('sx-mavg'); if(isAvg) avg=true;
        const n=num(c.textContent);
        if(n){ has=true; unit=n.u; if(isAvg){ acc+=n.v*monDays[k]; days+=monDays[k]; } else acc+=n.v; }
      }
      if(!yearEnds[k]) continue;
      const y=monYms[k].slice(0,4);
      const yc=document.createElement(isHead?'th':'td'); yc.className='sx-ycol';
      yc.setAttribute('style',(c.getAttribute('style')||'')+';font-weight:700;padding:4px 8px;white-space:nowrap');
      if(isHead){
        const yms=monYms.filter(m=>m.slice(0,4)===y), allCol=!!collapsed&&yms.every(m=>collapsed.has(m));
        yc.innerHTML=`<span style="margin-right:3px">${allCol?'▶':'▼'}</span>Σ ${y}`;
        yc.title=allCol?`Open the months of ${y}`:`Fold the months of ${y} to their totals`;
        if(toggleFn){ yc.style.cursor='pointer'; yc.setAttribute('onclick',`${toggleFn}('${y}')`); }
      } else {
        const v=avg?(days?acc/days:0):acc;
        yc.textContent=has&&v>0?_fmtInt(Math.round(v))+unit:'';
        if(avg&&has) yc.title=`Average over ${y}`;
      }
      c.parentNode.insertBefore(yc,c.nextSibling);
      acc=0; days=0; has=false; unit=''; avg=false;
    }
  });
}
// Fold every month in `yms` to its total — or, when they are all folded already, open them all.
function _foldMonths(set, yms){
  if(!set||!yms||!yms.length) return;
  if(yms.every(m=>set.has(m))) yms.forEach(m=>set.delete(m)); else yms.forEach(m=>set.add(m));
}
// The "Collapse months / Expand months" button of a page says what a click will do next.
function _monthsBtnLabel(id, set, yms){
  const b=document.getElementById(id); if(!b) return;
  const all=!!(yms&&yms.length)&&yms.every(m=>set&&set.has(m));
  b.textContent=all?'▸ Expand months':'◂ Collapse months';
  b.title=all?'Show the day columns of every month':'Fold every month to its total — only the month and year totals stay';
}

// Production-Gantt downtime fills — one distinct diagonal hatch per reason, so a
// zero-output day shows WHY the kiln/mill/packer is down instead of a blank cell.
// Shared by the clinker, finish-mill and packing rows.
const _DOWN_HATCH = {
  maint:   'repeating-linear-gradient(45deg,var(--h-maint-a),var(--h-maint-a) 3px,var(--h-maint-b) 3px,var(--h-maint-b) 6px)', // scheduled maintenance event
  starved: 'repeating-linear-gradient(45deg,var(--h-maint-a),var(--h-maint-a) 3px,var(--h-starved-b) 3px,var(--h-starved-b) 6px)', // no feed (e.g. no clinker)
  blocked: 'repeating-linear-gradient(45deg,var(--h-blocked-a),var(--h-blocked-a) 3px,var(--h-blocked-b) 3px,var(--h-blocked-b) 6px)', // receiving silo full (sim "blocked")
  repair:  'repeating-linear-gradient(45deg,var(--h-repair-a),var(--h-repair-a) 3px,var(--h-repair-b) 3px,var(--h-repair-b) 6px)', // manual "Down For Repairs"
  pm:      'repeating-linear-gradient(45deg,var(--h-pm-a),var(--h-pm-a) 3px,var(--h-pm-b) 3px,var(--h-pm-b) 6px)', // manual "Down PM Day"
  inv:     'repeating-linear-gradient(45deg,var(--h-inv-a),var(--h-inv-a) 3px,var(--h-inv-b) 3px,var(--h-inv-b) 6px)', // manual "Down For Inventory Control"
};
// Run-start label on a Gantt bar: small and clipped to ONE day cell (never spills into the next).
const _BAR_LBL_FIT='position:absolute;left:2px;right:1px;top:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:7px;font-weight:700;';
// Where a Gantt run's label goes: the MIDDLE day of each run. keys[i] = run identity of
// day i (null = no labelled run), vis[i] = that day's cell is on screen. A run whose middle
// is off screen (time frame / collapsed month) is labelled at the middle of its visible part.
// Returns the Set of indexes that carry a label.
function _midLabelIdx(keys, vis){
  const out=new Set(); let i0=-1;
  const close=i1=>{ if(i0<0) return;
    const mid=Math.floor((i0+i1)/2);
    if(vis[mid]) out.add(mid);
    else { const v=[]; for(let k=i0;k<=i1;k++) if(vis[k]) v.push(k); if(v.length) out.add(v[Math.floor((v.length-1)/2)]); }
    i0=-1; };
  keys.forEach((k,i)=>{ if(i0>=0&&k!==keys[i0]) close(i-1); if(k!=null&&i0<0) i0=i; });
  close(keys.length-1);
  return out;
}
const _DOWN_TIP = {
  blocked:'⛔ Blocked — receiving silo full, so the element had to stop',
  repair:'🔧 Down For Repairs (manual) — no production',
  pm:'🗓 Down PM Day (manual) — half day, runs at 50%',
  inv:'📋 Down For Inventory Control (manual) — no production',
};
// Sentinel product_ids used by downtime campaigns (0 production, tagged reason).
const DOWNTIME_PRODUCTS = {'__down_repair__':'repair','__down_pm__':'pm','__down_inv__':'inv'};
// The downtime campaign covering an element's day (its reason for being down), or null.
function _downCampaignAt(elId, ds){
  return _idxRows('production_campaigns','element_id',elId).find(c=>DOWNTIME_PRODUCTS[c.product_id]&&ds>=c.start_date&&ds<=c.end_date)||null;
}
// Days an element sits in a Maintenance Calendar event → Map(date → event id), over the
// simulation horizon (recurring events expanded). Steps by CALENDAR day (setDate): adding
// +24h to a midnight lands on 23:00 the day before once the clocks fall back (Nov 1).
// The simulation's reading of the same events: a 1.5-day event = 1 WHOLE down day + a PARTIAL
// day at 50 % output; a 0.5-day PM = no whole day, one partial day at 50 %. Returns
// {full:Set(date), partial:Map(date → fraction of the day DOWN), ids:Map(date → event id)} over
// the simulation horizon. _maintDayMap (above) rounds a fraction UP; this mirrors simulate() and
// is what the Supply grid and Push to BI read.
function _maintSpans(elId){
  const evts=DB.element_maintenance_events.filter(m=>m.element_id===elId);
  const full=new Set(), partial=new Map(), ids=new Map();
  const start=new Date(S.simCfg.start_date+'T00:00:00');
  const horizon=S.simCfg.horizon||365;
  evts.forEach(ev=>{
    const sd=new Date((ev.start_date||'')+'T00:00:00'); if(isNaN(sd)) return;
    const durF=parseFloat(ev.duration_days)||1, fullDur=Math.floor(durF), frac=durF-fullDur;
    const freq=parseInt(ev.frequency_days)||0;
    const addOccurrence=(occStart)=>{
      const dt=new Date(occStart);
      for(let d=0;d<fullDur;d++){ const k=dt._ymd(); full.add(k); ids.set(k, ev.id); dt.setDate(dt.getDate()+1); }
      if(frac>1e-9){ const k=dt._ymd(); if(!full.has(k)){ partial.set(k, Math.max(frac, partial.get(k)||0)); if(!ids.has(k)) ids.set(k, ev.id); } }
    };
    addOccurrence(sd);
    if(ev.type==='recurring'&&freq>0){
      const recEnd=ev.recurrence_end_date
        ?new Date(ev.recurrence_end_date+'T00:00:00')
        :new Date(start.getFullYear(),start.getMonth(),start.getDate()+horizon);
      const next=new Date(sd); next.setDate(next.getDate()+freq);
      while(next<=recEnd){ addOccurrence(next); next.setDate(next.getDate()+freq); }
    }
  });
  partial.forEach((v,k)=>{ if(full.has(k)) partial.delete(k); });
  return {full, partial, ids};
}
function _maintDayMap(elId){
  const evts=DB.element_maintenance_events.filter(m=>m.element_id===elId);
  const days=new Map();
  const start=new Date(S.simCfg.start_date+'T00:00:00');
  const horizon=S.simCfg.horizon||365;
  evts.forEach(ev=>{
    const sd=new Date((ev.start_date||'')+'T00:00:00');
    // ceil so a fractional/partial day (e.g. 0.5) still counts as a maintenance day.
    const dur=Math.max(1,Math.ceil(parseFloat(ev.duration_days)||1));
    const freq=parseInt(ev.frequency_days)||0;
    const addOccurrence=(occStart)=>{
      const dt=new Date(occStart);
      for(let d=0;d<dur;d++){ days.set(dt._ymd(), ev.id); dt.setDate(dt.getDate()+1); }
    };
    addOccurrence(sd);
    if(ev.type==='recurring'&&freq>0){
      const recEnd=ev.recurrence_end_date
        ?new Date(ev.recurrence_end_date+'T00:00:00')
        :new Date(start.getFullYear(),start.getMonth(),start.getDate()+horizon);
      const next=new Date(sd); next.setDate(next.getDate()+freq);
      while(next<=recEnd){ addOccurrence(next); next.setDate(next.getDate()+freq); }
    }
  });
  return days;
}

