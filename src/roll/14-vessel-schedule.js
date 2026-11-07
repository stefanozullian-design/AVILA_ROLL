// ══════════════════════════════════════════════════════════════════
// TRANSPORT PLANNER — Vessel Schedule
// ══════════════════════════════════════════════════════════════════

function vpPlannedArrivalsForBerth(berthId){
  // Returns {day:[{tonnes,status,idx,product_id}]} — all vessel_calls at this berth, all statuses
  // and products (idx = the call's DB.vessel_calls index). Rows and charts narrow by product.
  const map={};
  DB.vessel_calls.forEach((vc,idx)=>{
    const st=vc.status||'Planned';
    if(vc.legs&&vc.legs.length>0){
      vc.legs.filter(l=>l.berth_element_id===berthId&&l.arrival_date&&S.simCfg.start_date).forEach(l=>{
        const arrDay=Math.round((new Date(l.arrival_date)-new Date(S.simCfg.start_date+'T00:00:00'))/864e5)+1;
        if(!map[arrDay]) map[arrDay]=[];
        map[arrDay].push({tonnes:parseFloat(l.quantity_t)||0,status:st,idx,product_id:l.product_id||vc.product_id||null});
      });
    } else if(vc.berth_element_id===berthId&&vc.arrival_date&&S.simCfg.start_date){
      const arrDay=Math.round((new Date(vc.arrival_date)-new Date(S.simCfg.start_date+'T00:00:00'))/864e5)+1;
      if(!map[arrDay]) map[arrDay]=[];
      map[arrDay].push({tonnes:parseFloat(vc.quantity_t)||parseFloat(vc.total_quantity_t)||0,status:st,idx,product_id:vc.product_id||null});
    }
  });
  return map;
}

function vpGetVesselDestinations(){
  return getFacElements()
    .filter(e=>e.type==='berth'&&(e.props?.berth_type||'Ship Berth')==='Ship Berth')
    .map(e=>DB.facilities.find(f=>f.id===(e.assigned_facility_id||e.facility_id)))
    .filter(Boolean)
    .filter((f,i,a)=>a.findIndex(x=>x.id===f.id)===i);
}

// The shared time frame as simulation days.
function vpGetRange(){
  return fltSimDayRange('logi', S.simCfg.horizon||90);
}

function vpDayDate(d){
  const dt=new Date(S.simCfg.start_date+'T00:00:00');
  dt.setDate(dt.getDate()+d-1);
  return dt._ymd();
}

// Ship-berth terminals in view under the shared Facility / Sub-region pick.
function vpShownDests(){
  const fs=fltFacIdSet();
  return vpGetVesselDestinations().map(f=>f.id).filter(id=>!fs||fs.has(id));
}

function _vpToggleMonth(ym){
  if(!window._vpColapsed) window._vpColapsed=new Set();
  window._vpColapsed.has(ym)?window._vpColapsed.delete(ym):window._vpColapsed.add(ym);
  vpRender();
}
function _vpToggleYear(y){ _foldMonths(window._vpColapsed,(window._vpMonths||[]).filter(m=>m.slice(0,4)===y)); vpRender(); }

function vpRender(){
  if(!_IDX.depth) return _idxRun(()=>vpRender.apply(this,arguments)); // fast lookups for this whole block
  _syncSimToggle();
  if(!S.simCfg.start_date){
    document.getElementById('vp-dest-section').style.display='none';
    document.getElementById('vp-orig-section').style.display='none';
    return;
  }
  if(typeof _demGridVal==='function') _demGridVal._cache=null; // mirror current Demand-page values
  const {startDay,endDay}=vpGetRange();
  const days=[];
  for(let d=startDay;d<=endDay;d++) days.push(d);

  // Terminals in view under the shared filters; with no day in the window there is nothing to show.
  const _shownDests=vpShownDests();
  const _allowP=fltAllowedProdIds();
  const hasDests=_shownDests.length>0&&days.length>0;
  document.getElementById('vp-dest-section').style.display=hasDests?'':'none';
  document.getElementById('vp-orig-section').style.display=hasDests?'':'none';
  const _vpEmpty=document.getElementById('vp-empty');
  if(_vpEmpty){ _vpEmpty.style.display=hasDests?'none':'block';
    _vpEmpty.textContent=days.length?'No ship-berth terminals match the current filters':'No simulated days in this time frame'; }
  if(!hasDests){
    vpDestroyCharts();
    document.getElementById('vp-charts-section').style.display='none';
    return;
  }
  vpRenderCharts();

  const todayStr=new Date()._ymd();
  const months=(()=>{const mons=[];days.forEach(d=>{const ds=vpDayDate(d);const ym=ds.slice(0,7);if(!mons.length||mons[mons.length-1].ym!==ym){const dt=new Date(ds+'T00:00:00');mons.push({ym,label:dt.toLocaleString('en-US',{month:'short',year:'2-digit'}),days:[]});}mons[mons.length-1].days.push(d);});return mons;})();
  // Every month except the current one starts collapsed so the page opens compact — decided
  // once per month, the first time the time frame brings it into view.
  if(!window._vpColapsed) window._vpColapsed=new Set();
  if(!window._vpColSeen) window._vpColSeen=new Set();
  months.forEach(m=>{ if(window._vpColSeen.has(m.ym)) return; window._vpColSeen.add(m.ym);
    if(m.ym!==todayStr.slice(0,7)) window._vpColapsed.add(m.ym); });
  const _mTdSty='background:var(--total-faint);border-left:2px solid var(--border2);font-weight:700;color:var(--total);text-align:right;padding:3px 8px;';
  const _tpTdSty=d=>{
    if(vpDayDate(d)===todayStr) return 'border-left:2px solid var(--green);border-right:2px solid var(--green);';
    if(rpIsSat(d)) return 'border-left:2px solid rgba(var(--red-rgb),.3);background:rgba(var(--red-rgb),.04)';
    if(rpIsSun(d)) return 'border-right:2px solid rgba(var(--red-rgb),.3);background:rgba(var(--red-rgb),.04)';
    return '';
  };
  const thHtml=_ltElementTh('vp')+months.map(mon=>{const isCol=window._vpColapsed.has(mon.ym);
    const dayThs=(isCol?[]:mon.days).map(d=>{
      const ds=vpDayDate(d);const isToday=ds===todayStr;
      const cls=rpIsSat(d)?'tp-col-sat':rpIsSun(d)?'tp-col-sun':'';
      const clsA=cls?` class="${cls}"`:'';
      const styA=isToday?` style="border-left:2px solid var(--green);border-right:2px solid var(--green);color:var(--green)"`:' style=""';
      return `<th${clsA}${styA} title="Day ${d}">${ds.slice(5)}</th>`;
    }).join('');
    return `<th class="logi-mcol" onclick="_vpToggleMonth('${mon.ym}')" style="cursor:pointer;user-select:none;border-left:2px solid var(--border2);color:var(--total);font-size:8px;font-weight:700;text-align:center;padding:4px 6px;position:sticky;top:0;background:var(--surface2)"><span style="margin-right:3px">${isCol?'▶':'▼'}</span>${mon.label}</th>${dayThs}`;
  }).join('');
  document.getElementById('vp-dest-thead-row').innerHTML=thHtml;
  document.getElementById('vp-orig-thead-row').innerHTML=thHtml;
  _monthTotalsToEnd(document.getElementById('vp-dest-thead-row'),'logi-mcol',true); // month total at END
  _monthTotalsToEnd(document.getElementById('vp-orig-thead-row'),'logi-mcol',true);
  const _vpYr=_logiYearMeta(months);
  window._vpMonths=_vpYr.monYms; _logiFoldBtn(window._vpColapsed,window._vpMonths);
  _logiYearHeader(document.getElementById('vp-dest-thead-row'),'logi-mcol',_vpYr.monYms,_vpYr.yearEnds,'_vpToggleYear',window._vpColapsed);
  _logiYearHeader(document.getElementById('vp-orig-thead-row'),'logi-mcol',_vpYr.monYms,_vpYr.yearEnds,'_vpToggleYear',window._vpColapsed);

  const _statusPriority=['In Transit','Unloading','Confirmed','Planned','Proposed','Finished'];
  // ── TREE (tree 'vp' — see _logiTreeKit) ───────────────────────────
  // Terminal + berth line → one group per product. The product's header line IS its vessel
  // arrival row, so a folded product still shows when ships come; under it sit the Vessel
  // unload gantt, the silo inventory and the demand. Data cells are built exactly as before.
  const {pName:_pName, pCol:_pCol, chip:_pChip, meta:_meta, tr:_tr, lbl:_lbl, blankCells:_blankCells}
    =_logiTreeKit('vp', months, window._vpColapsed, _mTdSty, _tpTdSty);
  // Section hues — the same ones the Rail Schedule and Supply page use for the same data.
  const HUE_INV='var(--teal)', HUE_UNL='var(--unload-hue)', HUE_DEM='var(--blue)';
  const destRows=[];
  _shownDests.forEach(destFacId=>{
    const destFac=DB.facilities.find(f=>f.id===destFacId);
    const berths=getFacElements().filter(e=>e.type==='berth'&&
      (e.assigned_facility_id||e.facility_id)===destFacId&&
      (e.props?.berth_type||'Ship Berth')==='Ship Berth');
    berths.forEach(berth=>{
      const destSilos=rpGetDestSilos(berth);
      const demEls=rpGetDestDemEls(destFacId);
      const arrivals=vpPlannedArrivalsForBerth(berth.id);

      // Vessel status source for the per-product Gantt (drawn as each product's "Vessel unload"
      // row below, replacing the flat tonnage row — same concept as the Supply page).
      const _bh=S.simResults?.berthVesselHistory?.[berth.id]||[];
      const _carries=_vesselCarriesFn();

      // Products at this berth — union of downstream silo products and products that actually arrive.
      // Vessel arrivals are now shown one row PER PRODUCT (no mixing) to avoid confusion.
      const _arrProdIds=[...new Set(Object.values(arrivals).flat().map(e=>_pidCanon(e.product_id)).filter(Boolean))];
      const _vtProdIds=[...new Set([...destSilos.flatMap(s=>getSiloProducts(s)).filter(Boolean),..._arrProdIds])];
      const _vtActiveProdIds=_allowP?_vtProdIds.filter(pid=>_allowP.has(pid)):_vtProdIds;
      const _vtShownDemIds=new Set();

      // Terminal + berth header line.
      const bKey='b:'+berth.id, bP=[bKey];
      const _nP=_vtActiveProdIds.length;
      destRows.push(`${_tr('rp-fac rp-d rp-hdr-blank',[],bKey)}${_lbl(0,`${esc(destFac?.name||destFacId)}<span class="rp-tag">${esc(berth.name)}</span>${_meta(`ship berth${_nP?` · ${_nP} product${_nP===1?'':'s'}`:''}`)}`,
        {key:bKey,title:`${destFac?.name||destFacId} · ${berth.name} — ship berth`})}${_blankCells()}</tr>`);
      // External supply sources wired to this berth for a product ("← MEDCEM").
      const _srcNames=pid=>[...new Set(DB.connections.filter(c=>c.to_element_id===berth.id)
        .map(c=>getEl(c.from_element_id))
        .filter(e=>e?.type==='supply_source'&&e.props?.product_id&&(e.props.product_id===pid||_pidCanon(e.props.product_id)===pid))
        .map(e=>e.name))];

      // Renders one group: the VESSEL ARRIVAL header line (filtered) + its VESSEL UNLOAD row(s).
      // `gKey` is the group's fold key, `headHtml` / `headHue` its label and label colour.
      const _pushArrUnload=(pid,gKey,headHtml,headHue,filterFn)=>{
        const gP=[...bP,gKey];
        const arrCells=months.map(mon=>{const isCol=window._vpColapsed.has(mon.ym);
          const monT=mon.days.reduce((s,d)=>s+(arrivals[d]||[]).filter(filterFn).reduce((t,e)=>t+e.tonnes,0),0);
          const mTd=`<td class="logi-mcol" style="${_mTdSty}">${monT>0?Number(Math.round(monT)).toLocaleString()+'t':'—'}</td>`;
          return mTd+(isCol?[]:mon.days).map(d=>{
            const entries=(arrivals[d]||[]).filter(filterFn);
            let cls='tp-cell-clickable',val='—';
            if(entries.length>0){
              const totalTonnes=entries.reduce((s,e)=>s+e.tonnes,0);
              const domSt=_statusPriority.find(s=>entries.some(e=>e.status===s))||entries[0].status;
              cls+=' tp-cell-planned';
              val=`<span style="color:${_tsGet(domSt).color}">${Number(totalTonnes).toLocaleString()}t</span>`;
            }
            const tSty=_tpTdSty(d);
            return `<td class="${cls}"${tSty?` style="${tSty}"`:''} onclick="vpOpenArrivalDialog('${berth.id}','${d}')" title="Click to add/edit vessel arrival">${val}</td>`;
          }).join('');
        }).join('');
        destRows.push(`${_tr('rp-sec rp-d tp-row-arrival',bP,gKey)}${_lbl(1,headHtml,{key:gKey,hue:headHue,title:'Vessel arrivals (t) — click the name to fold this product, a day to add/edit a vessel'})}${arrCells}</tr>`);
        // Vessel unload → status Gantt. Per-product (pid) shows that product's vessels
        // (unloading/anchorage/waiting); the legacy no-product fallback shows one row per vessel.
        if(_bh.length){
          const realDay=new Set((DB.real_unloading_daily||[]).filter(u=>u.berth_id===berth.id&&(!pid||u.product_id===pid)&&u.unit!=='cars'&&(parseFloat(u.value)||0)>0).map(u=>u.date));
          const ganttRow=(rowLbl, stateOf)=>{
            let _pk=null;
            // Vessel name in the middle of each run, over the planner's whole day list.
            const _allD=[], _visD=[]; months.forEach(mon=>{ const col=window._vpColapsed.has(mon.ym); mon.days.forEach(d=>{ _allD.push(d); _visD.push(!col); }); });
            const _lblAt=new Set([..._midLabelIdx(_allD.map(d=>{ const c=stateOf(d); return c&&c.state?c.state+'|'+(c.vessel||''):null; }), _visD)].map(i=>_allD[i]));
            const cells=months.map(mon=>{const isCol=window._vpColapsed.has(mon.ym);
              const unl=mon.days.reduce((s,d)=>{ const c=stateOf(d); return s+(c&&c.state==='unloading'?1:0); },0);
              const mTd=`<td class="logi-mcol" style="${_mTdSty}">${unl>0?unl+'d':'—'}</td>`;
              return mTd+(isCol?[]:mon.days).map(d=>{
                const c=stateOf(d); const st=c&&c.state; const vessel=(c&&c.vessel)||'';
                const isReal=st==='unloading'&&realDay.has(vpDayDate(d));
                const p=_vesselCellParts(st,isReal);
                const key=(st||'__i')+'|'+vessel; const rs=!!st&&key!==_pk; _pk=key;
                const lbl=_lblAt.has(d)?`<span style="${_BAR_LBL_FIT}line-height:12px;color:${st==='unloading'?'var(--on-teal)':'var(--bar-lbl-down)'};pointer-events:none">${esc(vessel)}</span>`:''; // vessel name only
                const ttl=st?(vessel+' — '+p.lbl+_vesselLeftTip(c,berth.id)):'';
                return `<td title="${ttl}" style="position:relative;padding:2px 0;overflow:visible;${_tpTdSty(d)}"><div style="position:relative;height:12px;background:${p.bg}">${lbl}</div></td>`;
              }).join('');
            }).join('');
            destRows.push(`${_tr('rp-leaf rp-d tp-row-unload',gP)}${_lbl(2,rowLbl,{hue:HUE_UNL})}${cells}</tr>`);
          };
          if(pid){ const tl=_berthProductTimeline(_bh,_carries,pid); ganttRow('<span class="rp-glyph">▬</span>Vessel unload', d=>tl[d-1]); }
          else { _vesselTimelines(_bh).forEach(v=>ganttRow('<span class="rp-glyph">▬</span>'+esc(v.name), d=>v.days[d-1]?{state:v.days[d-1],vessel:v.name}:null)); }
        }
      };

      // Fallback: arrivals with no product info (legacy) → single aggregated arrival + berth-total unload
      if(!_vtActiveProdIds.length){
        if(Object.keys(arrivals).length){
          const gKey=bKey+':p:_none';
          _pushArrUnload(null,gKey,`VESSEL / ARRIVAL${_meta('all products · t')}`,'var(--text)',()=>true);
          if(S.simResults?.berthUnloadHistory?.[berth.id]){
            const unldHist=S.simResults.berthUnloadHistory[berth.id];
            const unldCells=months.map(mon=>{const isCol=window._vpColapsed.has(mon.ym);
              const monT=mon.days.reduce((s,d)=>s+(unldHist[d-1]||0),0);
              const mTd=`<td class="logi-mcol" style="${_mTdSty}">${monT>0?Number(Math.round(monT)).toLocaleString()+'t':'—'}</td>`;
              return mTd+(isCol?[]:mon.days).map(d=>{const v=unldHist[d-1]||0;const tSty=_tpTdSty(d);return `<td style="color:var(--real);font-size:10px;${tSty}">${v>0?Number(v).toLocaleString()+'t':'—'}</td>`;}).join('');
            }).join('');
            destRows.push(`${_tr('rp-leaf rp-d tp-row-unload',[...bP,gKey])}${_lbl(2,`<span class="rp-glyph">▬</span>Vessel unload${_meta('t')}`,{hue:HUE_UNL})}${unldCells}</tr>`);
          }
        }
      }

      // Product groups — arrival header + unload, then INVENTORY and DEMAND under it
      _vtActiveProdIds.forEach(pid=>{
        const pName=_pName(pid);
        const gKey=`${bKey}:p:${pid}`, gP=[...bP,gKey];
        const src=_srcNames(pid);
        _pushArrUnload(pid,gKey,`${_pChip(pid)}${esc(pName)}${_meta('vessel arrivals · t'+(src.length?' ← '+esc(src.join(' · ')):''))}`,_pCol(pid),e=>_pidCanon(e.product_id)===pid);
        // Inventory row(s) for this product
        destSilos.filter(s=>getSiloProducts(s).includes(pid)).forEach(silo=>{
          const invCells=months.map(mon=>{const isCol=window._vpColapsed.has(mon.ym);
            const lastV=rpInv(silo.id,mon.days[mon.days.length-1]);
            const mTd=`<td class="logi-mcol" style="${_mTdSty}">${lastV!==null?Number(Math.round(lastV)).toLocaleString():'—'}</td>`;
            return mTd+(isCol?[]:mon.days).map(d=>{
              const v=rpInv(silo.id,d);
              const max=parseFloat(silo.props?.max_capacity)||0;
              const floor=(parseFloat(silo.props?.critical_floor_pct)||0)/100*max;
              const crit=v!==null&&v<=floor&&floor>0;
              const tSty=_tpTdSty(d);
              const baseSty=(crit?'color:var(--red);':'')+tSty;
              return `<td${baseSty?` style="${baseSty}"`:''}>${v!==null?Number(v).toLocaleString():'—'}</td>`;
            }).join('');
          }).join('');
          destRows.push(`${_tr('rp-leaf rp-d tp-row-inv',gP)}${_lbl(2,`<span class="rp-glyph">▤</span>${esc(silo.name)}${_meta('inventory · t')}`,{hue:HUE_INV})}${invCells}</tr>`);
        });
        // Demand — ONE consolidated row per product (sum of all matching demand points, EFFECTIVE
        // = own − swapped-out + swapped-in), like the Supply page's product REQUIREMENTS summary.
        const _pidDem=demEls.filter(el=>_demElMatchesProd(el,pid));
        _pidDem.forEach(el=>_vtShownDemIds.add(el.id));
        if(_pidDem.length){
          const demCells=months.map(mon=>{const isCol=window._vpColapsed.has(mon.ym);
            const monT=mon.days.reduce((s,d)=>s+_pidDem.reduce((q,el)=>q+rpDemandEff(el.id,d),0),0);
            const mTd=`<td class="logi-mcol" style="${_mTdSty}">${monT>0?Number(Math.round(monT)).toLocaleString():'—'}</td>`;
            return mTd+(isCol?[]:mon.days).map(d=>{ const v=_pidDem.reduce((q,el)=>q+rpDemandEff(el.id,d),0); return `<td style="color:var(--simulated);${_tpTdSty(d)}">${v>0?Number(Math.round(v)).toLocaleString():'—'}</td>`; }).join('');
          }).join('');
          destRows.push(`${_tr('rp-leaf rp-d tp-row-dem',gP)}${_lbl(2,`<span class="rp-glyph">↓</span>Demand${_meta('t')}`,{hue:HUE_DEM})}${demCells}</tr>`);
        }
      });
    });
  });
  const _vpBody=document.getElementById('vp-dest-tbody');
  _vpBody.innerHTML=destRows.join('');
  _monthTotalsToEnd(_vpBody,'logi-mcol',true); // month total at END
  _logiYearTotalsToEnd(_vpBody,'logi-mcol',_vpYr.monYms,_vpYr.yearEnds,_vpYr.nYears);
  // Header lines carry no numbers — drop the "—" the year pass writes into their year cells.
  _vpBody.querySelectorAll('tr.rp-hdr-blank>td.logi-ycol').forEach(td=>{ td.textContent=''; });
  document.getElementById('vp-orig-tbody').innerHTML=
    `<tr><td colspan="999" style="color:var(--text-dim);font-size:9px;padding:10px">Vessels are external supply — no origin inventory deducted</td></tr>`;
}

function vpOpenArrivalDialog(berthId,dayNum){
  if(!S.simCfg.start_date) return;
  const d=parseInt(dayNum);
  // Find existing vessel_call matching this berth and arrival day
  let matchIdx=-1;
  DB.vessel_calls.forEach((vc,i)=>{
    if(matchIdx>=0) return;
    if(vc.legs&&vc.legs.length>0){
      const hit=vc.legs.some(l=>{
        if(l.berth_element_id!==berthId||!l.arrival_date) return false;
        const arrDay=Math.round((new Date(l.arrival_date)-new Date(S.simCfg.start_date+'T00:00:00'))/864e5)+1;
        return arrDay===d;
      });
      if(hit) matchIdx=i;
    } else if(vc.berth_element_id===berthId&&vc.arrival_date){
      const arrDay=Math.round((new Date(vc.arrival_date)-new Date(S.simCfg.start_date+'T00:00:00'))/864e5)+1;
      if(arrDay===d) matchIdx=i;
    }
  });
  if(matchIdx>=0){editVessel(matchIdx);return;}
  // No match — open Add dialog pre-filled with this berth and date
  window._vcLegs=[{berth_element_id:berthId,arrival_date:vpDayDate(d),quantity_t:'',unload_rate_tph:''}];
  showModalContent(vesselHTML());
  _vcRenderLegs();
}

function vpRenderCharts(){
  vpDestroyCharts();
  const section=document.getElementById('vp-charts-section');
  const inner=document.getElementById('vp-charts-inner');
  if(!section||!inner) return;
  inner.innerHTML='';

  const _shown=vpShownDests(), _allowP=fltAllowedProdIds();
  if(!S.simResults||!_shown.length){section.style.display='none';return;}
  section.style.display='';

  const {startDay,endDay}=vpGetRange();
  const days=[]; for(let d=startDay;d<=endDay;d++) days.push(d);
  const labels=days.map(d=>vpDayDate(d).slice(5));

  const chartBuilders=[];

  const baseOpts=(title)=>({
    responsive:true,maintainAspectRatio:false,
    plugins:{
      title:{display:true,text:title,color:_tc('#8e9ab8'),font:{family:'Space Mono',size:8},padding:{top:0,bottom:4}},
      legend:{display:false},
      tooltip:{mode:'index',intersect:false,
        callbacks:{
          title:its=>its[0]?.label||'',
          label:c=>{const v=c.raw;if(v==null||v===0)return '';
            return `${c.dataset.label}: ${Number(Math.round(v)).toLocaleString()}${c.dataset._u||' t'}`;}
        }
      }
    },
    scales:{
      x:{grid:{color:_tc('rgba(255,255,255,.03)')},
        ticks:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:7},maxTicksLimit:8,autoSkip:true,maxRotation:0}},
      y:{beginAtZero:true,grid:{color:_tc('rgba(255,255,255,.06)')},
        ticks:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:7},
          callback:v=>v>=1000?Math.round(v/100)/10+'k':Math.round(v)}}
    }
  });

  const mkCanvas=(id)=>{
    const div=document.createElement('div');
    div.style.cssText='background:var(--surface2);border-radius:4px;padding:8px 10px;height:180px;position:relative';
    const canvas=document.createElement('canvas');
    canvas.id=id;
    div.appendChild(canvas);
    inner.appendChild(div);
    return canvas;
  };

  const _statusPriority=['In Transit','Unloading','Confirmed','Planned','Proposed','Finished'];
  const _statusChartColor={
    'Proposed':  'rgba(142,154,184,.65)',
    'Planned':   'rgba(255,184,48,.80)',
    'Confirmed': 'rgba(0,229,160,.80)',
    'In Transit':'rgba(77,166,255,.80)',
    'Unloading': 'rgba(56,189,248,.80)',
    'Finished':  'rgba(142,154,184,.40)',
  };

  _shown.forEach((destFacId,di)=>{
    const destFac=DB.facilities.find(f=>f.id===destFacId);
    const berths=getFacElements().filter(e=>e.type==='berth'&&
      (e.assigned_facility_id||e.facility_id)===destFacId&&
      (e.props?.berth_type||'Ship Berth')==='Ship Berth');

    berths.forEach((berth,bi)=>{
      const allDestSilos=rpGetDestSilos(berth);
      const visibleSilos=_allowP
        ? allDestSilos.filter(s=>getSiloProducts(s).some(pid=>_allowP.has(pid)))
        : allDestSilos;
      const allDemEls=rpGetDestDemEls(destFacId);
      const _berthIdCopy=berth.id;

      // Arrival bars — only the allowed products' vessels (arrivals come back unfiltered).
      const _arrAll=vpPlannedArrivalsForBerth(berth.id);
      const arrivals=_allowP?Object.fromEntries(Object.entries(_arrAll)
        .map(([d,es])=>[d,es.filter(e=>_allowP.has(_pidCanon(e.product_id)))]).filter(([,es])=>es.length)):_arrAll;
      const arrData=days.map(d=>{
        const entries=arrivals[d]||[];
        return entries.length?entries.reduce((s,e)=>s+e.tonnes,0):null;
      });
      const arrBgColors=days.map(d=>{
        const entries=arrivals[d]||[];
        if(!entries.length) return _tc('rgba(255,184,48,.45)');
        const domSt=_statusPriority.find(s=>entries.some(e=>e.status===s))||entries[0]?.status||'Planned';
        return _tc(_statusChartColor[domSt]||'rgba(255,184,48,.45)');
      });

      // Color palette — one entry per silo, inventory line + demand line share same hue
      const _palette=[
        {line:'#34d399',fill:'rgba(52,211,153,.12)',dem:'rgba(52,211,153,.55)'},
        {line:'#60a5fa',fill:'rgba(96,165,250,.12)', dem:'rgba(96,165,250,.55)'},
        {line:'#f472b6',fill:'rgba(244,114,182,.12)',dem:'rgba(244,114,182,.55)'},
        {line:'#fb923c',fill:'rgba(251,146,60,.12)', dem:'rgba(251,146,60,.55)'},
        {line:'#a78bfa',fill:'rgba(167,139,250,.12)',dem:'rgba(167,139,250,.55)'},
        {line:'#fbbf24',fill:'rgba(251,191,36,.12)', dem:'rgba(251,191,36,.55)'},
      ];

      // Build one combined dataset array for ALL visible silos
      const ds=[
        {label:'Arrivals',data:arrData,type:'bar',order:10,
         backgroundColor:arrBgColors,
         borderColor:arrBgColors.map(c=>c.replace(/[\d.]+\)$/,'1)')),
         borderWidth:1,_u:' t'}
      ];

      visibleSilos.forEach((silo,si)=>{
        const col=_palette[si%_palette.length];
        const siloProds=getSiloProducts(silo);
        const siloMax=parseFloat(silo.props?.max_capacity)||0;
        const floor=(parseFloat(silo.props?.critical_floor_pct)||10)/100*siloMax;
        const invData=days.map(d=>{const v=rpInv(silo.id,d);return v!==null?v:null;});
        const siloDemEls=allDemEls.filter(e=>siloProds.some(pid=>_demElMatchesProd(e,pid)));
        const demData=days.map(d=>siloDemEls.reduce((s,e)=>s+rpDemand(e.id,d),0));
        const prodLabel=DB.products.find(p=>p.id===siloProds[0])?.name||siloProds[0]||silo.name;

        ds.push({
          label:`Inv · ${prodLabel}`,data:invData,type:'line',order:si+1,
          borderColor:_tc(col.line),backgroundColor:_tc(col.fill),
          fill:true,tension:0.2,pointRadius:0,borderWidth:1.5,_u:' t'
        });
        if(demData.some(v=>v>0)) ds.push({
          label:`Dem · ${prodLabel}`,data:demData,type:'line',order:si+1,
          borderColor:_tc(col.dem),borderDash:[3,3],
          pointRadius:0,borderWidth:1,_u:' t/d'
        });
        if(siloMax>0) ds.push({
          label:'Cap',data:days.map(()=>siloMax),type:'line',order:20,
          borderColor:_tc(col.line).replace(')',',0.2)').replace('rgb','rgba'),
          borderDash:[5,3],pointRadius:0,borderWidth:1,_u:' t'
        });
        if(floor>0) ds.push({
          label:'Floor',data:days.map(()=>floor),type:'line',order:20,
          borderColor:_tc('rgba(248,113,113,.4)'),borderDash:[3,3],
          pointRadius:0,borderWidth:1,_u:' t'
        });
      });

      // Chart options — show legend only when multiple products present
      const multiProd=visibleSilos.length>1;
      const cid=`vpc1_${di}_${bi}`;
      const canvas=mkCanvas(cid);
      // Make the chart a bit taller when legend is shown
      canvas.parentElement.style.height=multiProd?'220px':'180px';

      const chartOpts={
        responsive:true,maintainAspectRatio:false,
        plugins:{
          title:{display:true,
            text:`VESSEL · ${destFac?.name||destFacId} / ${berth.name}${_allowP&&_allowP.size===1?(' · '+(DB.products.find(p=>_allowP.has(p.id))?.name||[..._allowP][0])):''}`,
            color:_tc('#8e9ab8'),font:{family:'Space Mono',size:8},padding:{top:0,bottom:4}},
          legend:{
            display:multiProd,position:'top',
            labels:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:7},
              boxWidth:10,padding:6,
              // Hide Cap/Floor from legend to reduce noise
              filter:item=>item.text!=='Cap'&&item.text!=='Floor'}
          },
          tooltip:{mode:'index',intersect:false,
            callbacks:{
              title:its=>its[0]?.label||'',
              label:c=>{const v=c.raw;if(v==null||v===0)return '';
                return `${c.dataset.label}: ${Number(Math.round(v)).toLocaleString()}${c.dataset._u||' t'}`;}
            }
          }
        },
        scales:{
          x:{grid:{color:_tc('rgba(255,255,255,.03)')},
            ticks:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:7},maxTicksLimit:8,autoSkip:true,maxRotation:0}},
          y:{beginAtZero:true,grid:{color:_tc('rgba(255,255,255,.06)')},
            ticks:{color:_tc('#8e9ab8'),font:{family:'Space Mono',size:7},
              callback:v=>v>=1000?Math.round(v/100)/10+'k':Math.round(v)}}
        },
        onClick:(evt,active)=>{
          if(!active.length) return;
          vpOpenArrivalDialog(_berthIdCopy,String(days[active[0].index]));
        },
        onHover:(evt,active)=>{
          if(evt?.native?.target) evt.native.target.style.cursor=active.length?'pointer':'default';
        }
      };

      chartBuilders.push(()=>{
        _vpCharts[cid]=new Chart(canvas,{type:'bar',data:{labels,datasets:ds},options:chartOpts});
      });
    });
  });

  const buildAll=()=>chartBuilders.forEach(f=>f());
  loadLib('chart').then(buildAll).catch(e=>console.warn(e)); // pinned version + SRI — see LIBS
}

function _vpToggleLegacy(){
  const w=document.getElementById('vp-legacy-wrap');
  if(!w) return;
  const shown=w.style.display!=='none';
  w.style.display=shown?'none':'block';
  const btn=document.querySelector('[onclick="_vpToggleLegacy()"]');
  if(btn) btn.textContent=shown?'▼ Show Records':'▲ Hide Records';
  if(!shown) renderVesselTable();
}

function renderRailTable(){
  const tbody=document.getElementById('rail-tbody'); if(!tbody) return;
  // The shared filters: lanes in view (either end picked), allowed products, the time frame.
  const destFilter=rpShownDests();
  const {startDay,endDay,empty}=rpGetRange();
  const startDate=empty?'':rpDayDate(startDay);
  const endDate=empty?'':rpDayDate(endDay);
  const allowP=fltAllowedProdIds();
  const filtered=DB.rail_movements.map((r,i)=>({r,i})).filter(({r})=>{
    if(!destFilter.includes(r.to_facility_id)) return false;
    if(allowP&&!allowP.has(r.product_id||'')) return false;
    if(empty) return false;
    const dep=r.departure_date||r.date||'';
    if(dep&&dep<startDate) return false;
    if(dep&&dep>endDate) return false;
    return true;
  });
  if(!filtered.length){
    const msg=!DB.rail_movements.length
      ?'No rail movements scheduled — rail deducts from source and adds to destination after transit time'
      :'No movements match the current filter';
    tbody.innerHTML=`<tr><td colspan="11" style="color:var(--text-dim);text-align:center;padding:14px">${msg}</td></tr>`;
    return;
  }
  tbody.innerHTML=filtered.map(({r,i})=>{
    // Origin = the facility of the dispatch point the cars leave from (_railMoveOriginFacId).
    const fromFac=DB.facilities.find(f=>f.id===_railMoveOriginFacId(r));
    const toFac=DB.facilities.find(f=>f.id===r.to_facility_id);
    const prod=DB.products.find(p=>p.id===r.product_id);
    const rLocked=_tsLocked(r.status||'Planned');
    const rNextSt=_tsNext(r.status||'Planned');
    // Operator pushes carry no reference; show one built from the departure date and terminal
    // (the same shape as the SIM-… references) instead of "undefined".
    const refTxt=r.reference||`PUSH-${r.departure_date||r.date||'?'}-${toFac?.name||'?'}`;
    const refTip=r.reference?'':` title="${esc(`No reference stored — shown from the departure date and terminal${r.notes?' · '+r.notes:''} · id ${r.id}`)}"`;
    return `<tr>
      <td style="color:var(--blue);font-family:var(--mono)"${refTip}>${esc(refTxt)}</td>
      <td style="font-family:var(--mono)">${r.departure_date||r.date||'—'}</td>
      <td style="color:var(--text-dim)">${fromFac?.name||'—'}</td>
      <td style="color:var(--text-dim)">${toFac?.name||'—'}</td>
      <td style="font-family:var(--mono)">${r.wagon_count||0}</td>
      <td style="font-family:var(--mono)">${Number(r.total_capacity_t||0).toLocaleString()}</td>
      <td>${prod?.name||'—'}</td>
      <td style="font-family:var(--mono)">${r.transit_days||0}d</td>
      <td style="font-family:var(--mono)">${r.min_load_pct||80}%</td>
      <td>${_tsBadge(r.status||'Planned')}</td>
      <td style="white-space:nowrap">
        ${rNextSt?`<span class="tbl-act" onclick="advanceRailStatus('${r.id}')" title="Advance to ${rNextSt}">→ ${rNextSt}</span>`:''}
        <span class="tbl-act" onclick="editTransport('rail',${i})">${rLocked?'View':'Edit'}</span>
        ${!rLocked?`<span class="tbl-act del" onclick="DB.rail_movements.splice(${i},1);autoSave();renderRailTable()">Del</span>`:''}
      </td>
    </tr>`;
  }).join('');
}

function renderMaintenanceCalendar(){
  const tbody=document.getElementById('maint-tbody'); if(!tbody) return;
  if(!DB.element_maintenance_events.length){
    tbody.innerHTML=`<tr><td colspan="9" style="color:var(--text-dim);text-align:center;padding:14px">No maintenance events scheduled — click + Add Event or add from an element's properties panel</td></tr>`;
    return;
  }
  tbody.innerHTML=DB.element_maintenance_events.map(m=>{
    const dur=m.duration_days||m.duration||'?';
    const freq=m.type==='recurring'?`every ${m.frequency_days||m.frequency||'?'}d`:'—';
    const recEnd=m.recurrence_end_date?` until ${m.recurrence_end_date}`:'';
    const rampup=m.rampup_days?`${m.rampup_days}d`:'Immediate';
    return `<tr>
      <td style="color:var(--text-dim);font-size:9px">${m.element_name||'—'}</td>
      <td style="color:var(--amber)">${esc(m.name)}</td>
      <td style="font-family:var(--mono)">${m.start_date||'—'}</td>
      <td style="font-family:var(--mono)">${m.end_date||calcEndDate(m.start_date,dur)}</td>
      <td style="font-family:var(--mono)">${dur}d</td>
      <td><span class="fac-badge ${m.type==='fixed'?'badge-green':'badge-blue'}">${m.type==='fixed'?'One-off':'Recurring'}</span></td>
      <td style="font-family:var(--mono);color:var(--text-dim)">${freq}${recEnd}</td>
      <td style="font-family:var(--mono)">${rampup}</td>
      <td>
        <span class="tbl-act" onclick="editMaintEvent('${m.id}')">Edit</span>
        <span class="tbl-act del" onclick="removeMaintEventFromCalendar('${m.id}')">Del</span>
      </td>
    </tr>`;
  }).join('');
  updateStatusBar();
}

function removeMaintEventFromCalendar(id){
  if(!confirm('Delete this maintenance event?')) return;
  DB.element_maintenance_events=DB.element_maintenance_events.filter(m=>m.id!==id);
  autoSave(); renderMaintenanceCalendar(); updateStatusBar();
}

// ── DEMAND SINGLE SOURCE OF TRUTH ───────────────────────
// All code that needs "what is the demand for element X on date D"
// must call this function. It reads DB.demand_values first (the grid),
// falling back to el.props.daily_tonnage (legacy/fixed) only if no
// demand_values exist for this element at all.
// Safe number parser — treats any non-numeric / null / symbol / text as 0
// Used throughout simulation to prevent letters like "MAINT" or "—" from corrupting calculations


// Non-working-day set (global holidays/shutdowns). Cached; invalidated together with the
// demand cache whenever DB.non_working_days or DB.demand_values changes.
function _nwdSet(){ return _nwdSet._c || (_nwdSet._c = new Set((DB.non_working_days||[]).map(n=>n.date))); }
function _isNWD(ds){ return _nwdSet().has(ds); }

function _demandRate(elId, dateStr){
  // PHASE 4: Check REAL DATA first (actual production inputs)
  const realProduction=_dedupRealProd(elId, dateStr);
  if(realProduction.length>0){
    const realTotal=realProduction.reduce((sum,r)=>sum+(parseFloat(r.volume_t)||0),0);
    return realTotal;
  }

  // Non-working day: expected demand is 0 unless the user entered a MANUAL override
  // (a demand_values row flagged nwd_manual). Actual shipments above still count.
  if(_isNWD(dateStr)){
    const ov=_idxRows('demand_values','element_id',elId,'date',dateStr).find(v=>v.nwd_manual);
    return ov?(parseFloat(ov.value_t)||0):0;
  }

  // Fallback to FORECAST data
  const valMap_cache=(_demandRate._cache=_demandRate._cache||{});
  if(!valMap_cache[elId]){
    const el=DB.elements.find(e=>e.id===elId);
    const vals=_idxRows('demand_values','element_id',elId); // read-only
    valMap_cache[elId]={
      hasValues:vals.length>0,
      map:Object.fromEntries(vals.map(v=>[v.date,parseFloat(v.value_t)||0])),
      fallback:parseFloat(el?.props?.daily_tonnage)||0
    };
  }
  const {hasValues,map,fallback}=valMap_cache[elId];
  if(hasValues) return map[dateStr]||0;
  // No fallback - demand must be explicitly defined in demand_values
  return 0;
}
// A demand point's day is ACTUAL when real shipments are recorded for it (real_production_daily)
// or its demand_values row came in as actual sales (source:'actual', the sales import).
function _dmdActIdx(){ return _dmdActIdx._c || (_dmdActIdx._c=new Set((DB.demand_values||[]).filter(v=>v.source==='actual').map(v=>v.element_id+'|'+v.date))); }
function _dmdIsActual(elId,ds){ return _dmdActIdx().has(elId+'|'+ds)||_dedupRealProd(elId,ds).length>0; }
// Invalidate cache whenever demand_values changes
function _demandCacheInvalidate(){ _demandRate._cache={}; _nwdSet._c=null; _dmdActIdx._c=null; if(typeof _demGridVal==='function') _demGridVal._cache=null; if(typeof SP!=='undefined') SP._demIdx=null; }



