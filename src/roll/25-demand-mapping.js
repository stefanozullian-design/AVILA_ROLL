// ═══════════════════════════════════════════════════════
// DEMAND MAPPING — translation layer: SAP sales rows → demand points
// ═══════════════════════════════════════════════════════
// The SAP export is the truth; these tables say how one of its rows becomes a
// demand point. Nothing here is hard-coded — not the codes, not the rules, not
// even the name format — so a surprise in the data is a row to fix, not a
// release to wait for.
//
// SHARED ACROSS SCENARIOS: the tables describe SAP, not a plan, so they live in
// their own localStorage key and never travel inside DB or a scenario file.
// Switching or importing a scenario leaves the translation untouched.
//
// Seeded from the index tab of the source workbook, so a fresh install
// reproduces today's INV_ROLL_NAME formula before any edit is made.
const XLMAP_KEY='avila_demand_map';
let XLMAP=null;
const _xlUi={open:{src:true,ship:true,mat:false,cls:true,mov:true,ali:true,rep:false},filter:{},test:{}};

// Materials that are not demand. The Excel Summary pivot hid these by Material
// Description (services and supplies that carry a tonnage, some ash and purchased
// lines); here they are material-table rows marked "skip", so the choice is visible
// and can be flipped. 1518201 is the big one (27 kt): PEV white cement billed as a
// loading fee — the SAP script moves those lines from 4809 to 9063 and gives them their
// tonnes, so they ARE white cement, yet the Excel Summary hid them. Kept as skip to
// match today's numbers until someone decides. 1638064 (IL(8) BRO) was hidden there
// too, but it is BRS_IL(HE) since 2026-09-23 — left out of this list on purpose.
const XLMAP_SKIP_SEED=[
  {code:'1518201',note:'SERV,LOADING_FEE_BY_TON — PEV white cement billed as a loading fee; hidden in the Excel Summary. Set to demand to count it'},
  {code:'1634047',note:'AB,FLY_ASH,CLASS_F,C618,BULK,USECOPRAIR'},
  {code:'1633895',note:'CEM,BLD,GRAY,IL(10),BULK,USARGNEWBE'},
  {code:'1626129',note:'AB,FLY_ASH,CLASS_F,C618,BULK,USECOCUMBE'},
  {code:'1614488',note:'AB,FLY_ASH,CLASS_F,C618,BULK,USBORBARRY'},
  {code:'1601494',note:'AB,FLY_ASH,CLASS_F,C618,BULK,TKSTIMEDCE'},
  {code:'1626244',note:'AB,FLY_ASH,CLASS_F,C618,BULK,TRASHZONGU'},
  {code:'1035909',note:'CLK,CLINKER,GRAY,PURCHASED'},
  {code:'1606447',note:'SERV,TERMINAL_FEE'},
  {code:'1425025',note:'SERV,OTHER_FREIGHT_CHARGE,BY_LOAD'},
  {code:'1425021',note:'SERV,BELOW_MINIMAL_WEIGHT,BY_LOAD'},
  {code:'1625211',note:'SERV,SURCHARGE,DIVISION_12,BULK,TON'},
  {code:'1410820',note:'SUPPLIES,PILLOW_PACK,PALLET_COVERS'},
  {code:'1029658',note:'SUPPLIES,PALLET_COVER,PLASTIC'}
];
// Marks the seed codes "skip" — only rows that have no choice yet, so a code someone
// already set to count stays counted.
function _xlApplySkipSeed(map){
  map.materials=map.materials||[];
  XLMAP_SKIP_SEED.forEach(s=>{
    const r=map.materials.find(m=>String(m.code??'').trim()===s.code);
    if(!r){ map.materials.push({code:s.code,product:'',pres:'',action:'skip',note:s.note}); return; }
    if(r.action) return;
    r.action='skip';
    r.note=r.note?r.note+' · '+s.note:s.note;
  });
}
function xlmapDefaults(){
  const d={
    version:3,
    template:'{source}/{movement}/{product}/{presentation}/{class}',
    fallback_class:'UNK',
    ship_points:[
    {code:"4802",source:"BRS",note:""},
    {code:"4805",source:"JAX",note:""},
    {code:"4808",source:"MIA",note:""},
    {code:"4809",source:"PEV",note:"PEV cement"},
    {code:"4810",source:"WPB",note:""},
    {code:"4922",source:"ORL",note:""},
    {code:"4930",source:"SUT",note:"SUT cement pickups"},
    {code:"5052",source:"SUT",note:"SUT slag pickups"},
    {code:"5054",source:"PEV",note:"PEV slag"},
    {code:"5056",source:"WPB",note:"WPB slag"},
    {code:"9001",source:"EXT",note:""},
    {code:"9026",source:"TITAN S",note:""},
    {code:"9055",source:"EXT",note:""},
    {code:"9063",source:"PEV",note:"PEV white cement"},
    {code:"9084",source:"TITAN N",note:""},
    {code:"9295",source:"HEI",note:"HEI location — index sample says Port Everglades (confirm)"},
    {code:"9296",source:"HEI",note:"HEI location — index sample says Port Canaveral (confirm)"},
    {code:"9298",source:"HEI",note:"HEI location — index sample says Jacksonville (confirm)"},
    {code:"9451",source:"SUT",note:"SUT ash (BOW)"},
    {code:"9456",source:"SUW",note:""},
    {code:"9457",source:"PTAGODA",note:""},
    {code:"9459",source:"PALTKA",note:""},
    {code:"9460",source:"ORL",note:"ORL ash + slag"},
    {code:"9462",source:"SUT",note:"SUT ash (GEN)"},
    {code:"9465",source:"CSTRIVER",note:""},
    {code:"9466",source:"JAX",note:"JAX ash"},
    {code:"9468",source:"OUC",note:""}],
    materials:[
    {code:"1019253",product:"MIA_SPC",pres:"PAK",note:""},
    {code:"1019254",product:"MIA_SPC",pres:"PAK",note:""},
    {code:"1035909",product:"CLK",pres:"BLK",note:""},
    {code:"1175764",product:"TAM_WHT",pres:"PAK",note:""},
    {code:"1227347",product:"BRS_SPC",pres:"PAK",note:""},
    {code:"1410819",product:"BRS_SPC",pres:"PAK",note:""},
    {code:"1425050",product:"BRS_SPC",pres:"BLK",note:""},
    {code:"1425053",product:"BRS_I/II",pres:"BLK",note:""},
    {code:"1425057",product:"MIA_SPC",pres:"BLK",note:""},
    {code:"1425060",product:"MIA_SPC",pres:"BLK",note:""},
    {code:"1425063",product:"MIA_I/II",pres:"BLK",note:""},
    {code:"1508707",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1508712",product:"BOW_ASH",pres:"BLK",note:""},
    {code:"1509453",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1518201",product:"TAM_WHT",pres:"BLK",note:""},
    {code:"1522203",product:"BRS_SPC",pres:"PAK",note:""},
    {code:"1545723",product:"MIA_SPC",pres:"PAK",note:""},
    {code:"1567060",product:"MED_I-II",pres:"BLK",note:""},
    {code:"1582005",product:"MED_I-II",pres:"BLK",note:""},
    {code:"1588324",product:"TAM_IL(11)",pres:"BLK",note:""},
    {code:"1595185",product:"MED_I-II",pres:"BLK",note:""},
    {code:"1599749",product:"RIZ_SLG",pres:"BLK",note:""},
    {code:"1601023",product:"JAP_SLG",pres:"BLK",note:""},
    {code:"1601141",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1601494",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1603742",product:"NUH_I-II",pres:"BLK",note:""},
    {code:"1604869",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1605823",product:"TAM_IL(11)",pres:"BLK",note:""},
    {code:"1606504",product:"BRS_IL(12)",pres:"BLK",note:""},
    {code:"1606958",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1614488",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1614500",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1615297",product:"KNK_I-II",pres:"BLK",note:""},
    {code:"1618090",product:"TAM_WHT",pres:"PAK",note:""},
    {code:"1621011",product:"CRH_IL(BF)",pres:"BLK",note:""},
    {code:"1621478",product:"CLI_IL(11)",pres:"BLK",note:""},
    {code:"1622450",product:"MIA_IL(11)",pres:"BLK",note:""},
    {code:"1623645",product:"TITAN_IL(14)",pres:"BLK",note:""},
    {code:"1624948",product:"TAM_IL(11)",pres:"BLK",note:""},
    {code:"1625902",product:"TITAN_IL(12)",pres:"BLK",note:""},
    {code:"1626129",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1626244",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1626560",product:"MIA_IL",pres:"PAK",note:""},
    {code:"1627136",product:"MED_I-II",pres:"BLK",note:""},
    {code:"1627648",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1629814",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1632781",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1634026",product:"TITAN_IL(13)",pres:"BLK",note:""},
    {code:"1634047",product:"GEN_ASH",pres:"BLK",note:""},
    {code:"1635289",product:"",pres:"PAK",note:"no product in the index — set one"},
    {code:"1635510",product:"BRS_SPC",pres:"PAK",note:""},
    {code:"1636395",product:"MIA_IL(08)",pres:"BLK",note:""},
    {code:"1636650",product:"TITAN_IL(10)",pres:"BLK",note:""}],
    class_rules:[
      {type:'exact', match:'3181635', value:'IND',  note:'OZINGA SOUTH FLORIDA INC'},
      {type:'exact', match:'3004229', value:'IND',  note:'CONTINENTAL CEMENT CO OF FLA'},
      {type:'exact', match:'3165216', value:'IND',  note:'TITAN AMERICA LLC'},
      {type:'exact', match:'1132',    value:'LKHT', note:'ORLANDO FL (LOCKHART) READYMIX'},
      {type:'length', match:'4', value:'INT', note:'4-digit Sold-To = internal'},
      {type:'length', match:'7', value:'EXT', note:'7-digit Sold-To = external'}
    ],
    movements:[
      {ship_type:'SALES', movement:'DEM', action:'import', note:''},
      {ship_type:'TRANS', movement:'TRF', action:'park',   note:'transfers — phase 2'}
    ],
    aliases:[],
    // Ship-To → sales rep: the Excel's SalesRep column (VLOOKUP(Ship-To, index!L:P)), seeded
    // from the index tab. The raw SAP export carries no rep; the Detail file and the Sales
    // page's Rep filter need one.
    sales_reps:[
    {rep:"TBD",ship_tos:"50411911 50267211 50267109 50296094 50380590 50267241 50410328 50414323 50408788 50442334 50427922 50408050 50428970 50405666 50005099 50428894 50428533 50482090 50458401 50382024 50377349 50413670 50347688 50383133 50520536 50323366 50323369 50519604 50516885 50519009 50243332 50502079 50481663 50498654 50499877 50500944 50496852 50504601 50470069 50505346 50495679 50499321 50493084 50503613 50501987 50504426 50477620 50491534 50000046 50487384 50469844 50470015 50501207 50520569 50325920 50409621 50458013 50409590 50355439 50239607 50191138 50298371 50445748 50409947 50417882 50504478 50475907 50417319 50471345 50417588 50423180 50448721 50483091 50427498 50469767 50409564 50415110 50446883 50433246 50457284 50459136 50438561 50440779 50468704 50394209 50503185 50413725 50387930 50517680 50394407 50402780 50412288 50403858 50401017 50411602 50306185 50301626 4690 50516064 50513720 50010841 50504023 50010560 50371336 50519517 50000149 50423519 50429243 50520495 50420660 50473978 50419884 50433862 50406162 50000168 50401592 50365941 50365929 50365924 50449638 50449814 50367908 50469795 50417970 50430929 50436763 50444831 50367916 50410348 50287408 50043622 50043617 50355079 50310177 50503978 50504732 50256255 50455187 50431590 50428539 50447004 50000230 50519400 50449253 50493960 50458369 50408886 50452116 50408751 50450441 50480680 50481638 50095201 50518057 50520242 50502394 50518063 50520017 50429073 50489760 50440058 50487654 1158 50043612 50043609 50311642 50467505 50006036 50000452 50385464 50404430 50366511 50366491 50407680 50176330 50311923 50168153 50409864 50467002 50498692 50466034 50480274 50488108 50481814 50497419 50494533 50478374 50378840 50399943 50453820 50484723 50464534 50457451 50438539 50421375 50328590 50344638 50429152 50429153 50000302 50516573 50005800 50516935 50496234 50494240 50403337 50008881 50000636 5054 5052 50466327 50519786 50398131 50429936 50393719 50345014 50439792 50433206 50445193 50302318 50420340 1065 50472799 50472797 50381305 50479052 50520338 1178 50466658 4084 50399593 50000399 50463293 50484738 50518871 50446538 50024188 50462423 50014290 50332224 50296606 50024843 50517685 50286641 50000419 50000308 50355555 50469874 50253861 50425623 50231786 50429075 50417954 50017124 50007787 50502477 50517127 50362458 50390864 50387553 50360655 50000427 50354917 50433983 50380517 50380607 50516325 50427201 50410596 50427211 50380385 50433868 50433989 50312876 50346042 50507536 50421904 50411869 50456816 50413504 50298725 50400288 50402039 50432667 50402828 50410214 50406802 50427459 50449264 50470368 50412742 50434718 50451706 50418202 50440261 50431966 50400546 50400832 50352209 50368489 50422609 50448296 50416842 50401869 50453361 50438557 50426460 50439431 50440768 50000437 50000365 50341391 50394045 50378882 50308073 50002724 50422968 50446529 50450229 50448532 50402403 50409281 50409215 50409268 50410989 50413852 50424035 50389289 50389623 50393737 50429724 50134733 50127731 50380606 50407317",note:""},
    {rep:"STELLJES,PAUL A",ship_tos:"4087 4042 1150 4063 1148 1119 1188 1189 1135 4016 1123 1190 1112 50000159 1130 1193 1192 1121 1081 1055 4079 1153 1206 4076 1209 4038 4095 1139 4008 4005 1087 4075 1088 1106 1145 1033 4048 1173 50261340 1151 1111 1175 1049 4090 4086 1115 1057 1095 4010 1155 1037 1136 4033 1128 1132 1129 1200 1140 1144 1071 4091 4082 4083 1120 1085 1182 1179 4065 4067 1068 1204 1160 1052 1156 1125 4049 1084 1090 1069 1053 4062 4058 1036 4061 4070 4059 1040 50322338 50009953 1114 4015 1092 1086 1124 1131 1207 1142",note:""},
    {rep:"KRAMER,ROGER",ship_tos:"50514474 50509825 50508966 50515873 50512344 50516224 50516088 50514779 50507495 50513266 50501922 50503741 50508784 50502142 50507217 50498592 50513272 50013711 50010628 50010641 50512197 50516125 50516166 50510900 50484322 50493734 50013799 50506876 50404775 50398401 50398407 50413498 50456656 50515666 50476637 50014244 50441041 50441042 50391482 50516074 50352241 50422723 50511999 50505777 50506125 50368948 50513569 50457299 50445079 50515295 50515306 50515294 50515953 50515951 50515307 50515952 50500606 50416296 50512492 50497805 50505944 50499972 50452730 50481435 50481471 50427190 50495426 50481473 50452678 50452728 50513754 50265975 50294719 50507499 50507537 50507365 50507500 50453017",note:""},
    {rep:"DEVORE,JERALD C",ship_tos:"50483528 50392560 50014587 50424056 50010882 50007662 50344686 50360672 50511038 50205635 50498689 50000353 50258114 50008162 50025589 50027138 50402561 50402555 50511901 50470534 50010624 50387936 50387456 50026081 50375801 50390248 50505923 50378793 50000225 50043607 50000385 50366410 50000395 50000409 50366493 50366492 50366516 50366476 50365942 50000371 50226170 50008908 50431676 50000635 50011612 50515404 50283709 50010759 50516701 50000382 50000403 50007969 50000432 50229509 50000418 50335036 50351148 50237580 50478948 50331854 50334233 50422187 50422188 50012311",note:""},
    {rep:"EDELMANN JR,JOHN F",ship_tos:"50199142 50424449 50472235 50516188 50513397 50311526 50443702 50228246 50174748 50278613 50383097 50309164 50014064 50023743 50358180 50299515 50012315 50404728 50012443 50354615 50436019 50364138 50504942 50475451 50331745 50412890 50469864 50095183 50000247 50000300 50014044 50000301 50000303 50488327 50008886 50000305 50170508 50194318 50513640 50360982 50013968 50000447 50304636 50007771 50012148 50022856 50189719 50008020 50422950 50281535 50281591 50007836 50007831 50444600 50000193",note:""},
    {rep:"DE LA TORRE,GEORGE",ship_tos:"50451994 50512027 50000050 50319980 50008328 50000142 50467533 50000148 50204423 50025898 50515809 50491394 50458000 50447638 50444802 50445722 50319850 50413935 50371344 50364405 50000443 50000391 50000441 50321056 50366475 50000461 50366518 50365129 50366468 50366444 50485052 50013071 50026069 50012110 50013978 50192573 50506216 50000404 50025359 50476868 50000081",note:""},
    {rep:"SHEFFIELD, CHARLES C",ship_tos:"50000114 50306175 50400790 50363962 50005745 50449993 50507927 50395199 50477990 50477994 50490659 50000190 50025340 50321650 50510067 50380086 50008236 50008237 50301465 50007669 50242728 50452175 50452172 50289354 50344636 50344637 50306131 50389810 50000261 50514651 50514589 50514648 50514650 50514588 50514649 50445842 50271611",note:""},
    {rep:"SCOTT, ALICIA PEREZ",ship_tos:"50011412 50201583 50218589 50010609 50516545 50512889 50513099 50514124 50506169 50514201 50510141 50401614 50374310 50434933 50335738 50396946 50478013 50516427 50508600 50360749 50331480 50458938 50011494 50304206",note:""},
    {rep:"STEWART, JOSEPH K",ship_tos:"50248637 50000503 50000632 50489068 50494962 50333367 50014797 50002731 50002723 50351993 50010574 50246867",note:""}
    ],
    fallback_rep:'',
    // SALES vs TRANS is not an SAP field: SAP's own "Ship Type" is a shipping code (01, 03).
    // The Excel decided it by Ship-To — a Ship-To that is one of our plants/terminals is a
    // transfer: IF(OR(C2=4802,…),"TRANS","SALES"). Same list here, editable. 4809 (PEV) and
    // 4810 (WPB) were not in the formula.
    transfer_ship_tos:'4802 4805 4808 4892 4922 4930 5052 5054 5056'
  };
  _xlApplySkipSeed(d);
  return d;
}

function xlmapLoad(){
  try{
    const raw=localStorage.getItem(XLMAP_KEY);
    XLMAP=raw?JSON.parse(raw):xlmapDefaults();
  }catch(e){ console.warn('demand map load',e); XLMAP=xlmapDefaults(); }
  if(!XLMAP||typeof XLMAP!=='object'||Array.isArray(XLMAP)) XLMAP=xlmapDefaults();
  // Shape guard: a hand-edited or older file must never break the panel.
  const d=xlmapDefaults();
  ['ship_points','materials','class_rules','movements','aliases','sales_reps'].forEach(k=>{
    if(!Array.isArray(XLMAP[k])) XLMAP[k]=d[k];
  });
  if(!XLMAP.template) XLMAP.template=d.template;
  if(!XLMAP.fallback_class) XLMAP.fallback_class=d.fallback_class;
  if(XLMAP.fallback_rep===undefined) XLMAP.fallback_rep=d.fallback_rep;
  // v1 → v2 (2026-09-24): "not demand" materials, so the app's Summary reproduces the
  // Excel pivot's. Added to the saved tables, never replacing an edit.
  const v0=XLMAP.version||1;
  if(v0<2) _xlApplySkipSeed(XLMAP);
  // v3 (2026-09-24): the Ship-To list that makes a row a transfer (was the Excel formula).
  if(v0<3&&XLMAP.transfer_ship_tos===undefined) XLMAP.transfer_ship_tos=d.transfer_ship_tos;
  if(v0<3){
    XLMAP.version=3;
    try{ localStorage.setItem(XLMAP_KEY, JSON.stringify(XLMAP)); }catch(e){}
  }
  _xlRepIdx=null; _xlTrfSet=null;
  return XLMAP;
}
// Ship-To → rep, first listing wins (as VLOOKUP did). Rebuilt after any edit.
var _xlRepIdx=null;   // var, not let: xlmapLoad (above) resets it
function xlmapRep(shipTo){
  if(!XLMAP) xlmapLoad();
  if(!_xlRepIdx){
    _xlRepIdx=new Map();
    (XLMAP.sales_reps||[]).forEach(r=>{
      if(!r||!r.rep) return;
      String(r.ship_tos||'').split(/[\s,;]+/).forEach(c=>{ c=c.trim(); if(c&&!_xlRepIdx.has(c)) _xlRepIdx.set(c,r.rep); });
    });
  }
  const k=String(shipTo??'').trim().replace(/\.0+$/,'');
  return _xlRepIdx.get(k)??(XLMAP.fallback_rep||'');
}
// SALES or TRANS from the Ship-To (see transfer_ship_tos). Null when the list is empty,
// so the caller falls back to the file's own Ship Type column.
var _xlTrfSet=null;
function xlmapShipType(shipTo){
  if(!XLMAP) xlmapLoad();
  if(!_xlTrfSet) _xlTrfSet=new Set(String(XLMAP.transfer_ship_tos||'').split(/[\s,;]+/).map(c=>c.trim()).filter(Boolean));
  if(!_xlTrfSet.size) return null;
  return _xlTrfSet.has(String(shipTo??'').trim().replace(/\.0+$/,''))?'TRANS':'SALES';
}
function xlmapSave(msg){
  _xlRepIdx=null; _xlTrfSet=null;
  if(XLMAP) XLMAP.edited_at=new Date().toISOString();
  _xlRulesChanged();
  try{ localStorage.setItem(XLMAP_KEY, JSON.stringify(XLMAP)); }
  catch(e){ console.warn('demand map save',e); statMsg('Could not save the demand mapping'); return; }
  statMsg(msg||'Demand mapping saved');
}
const _xlNorm=s=>String(s??'').trim().toUpperCase().replace(/\s+/g,'');

// ── The engine ────────────────────────────────────────────────────────────
// One SAP row in, one demand point name out — plus a trace of every rule that
// fired and a plain-language reason for anything that could not be resolved.
// The importer, the preview and the test bench all read this one function, so
// what you test is exactly what an import will do.
function xlmapClassify(soldTo){
  const s=String(soldTo??'').trim();
  for(const r of (XLMAP.class_rules||[])){
    if(r.disabled) continue;
    const m=String(r.match??'').trim(); if(!m||!r.value) continue;
    let hit=false;
    if(r.type==='exact')       hit = s.toUpperCase()===m.toUpperCase();
    else if(r.type==='length') hit = s.length===parseInt(m,10);
    else if(r.type==='prefix') hit = s.toUpperCase().startsWith(m.toUpperCase());
    else if(r.type==='regex'){ try{ hit=new RegExp(m).test(s); }catch(e){ hit=false; } }
    if(hit) return {value:r.value, rule:`${r.type} "${m}" → ${r.value}`};
  }
  return {value:XLMAP.fallback_class||'UNK', rule:`no rule matched → ${XLMAP.fallback_class||'UNK'}`};
}
function xlmapName(parts){
  return String(XLMAP.template||'{source}/{movement}/{product}/{presentation}/{class}')
    .replace(/\{(\w+)\}/g,(_,k)=>parts[k]??'')
    .replace(/\/{2,}/g,'/');   // a product with no pack (catalog clinker "BRS_CLK") leaves no empty segment
}
function xlmapTranslate(row){
  if(!XLMAP) xlmapLoad();
  const trace=[], missing=[];
  const spCode=String(row.ship_pt??'').trim();
  const sp=(XLMAP.ship_points||[]).find(r=>_xlNorm(r.code)===_xlNorm(spCode));
  let source='';
  if(sp&&sp.source){ source=sp.source; trace.push({t:'Ship point', r:`${spCode} → ${sp.source}`}); }
  else if(sp) missing.push(`ship point ${spCode} has no source set`);
  else{
    // No table row: the topology may still know the code (a facility's Plant #, or the ship
    // point inside a product's material code). Translate in the .vbs does the same.
    const tp=_xlTopoShipPoint(spCode);
    if(tp&&tp.source){
      source=tp.source;
      trace.push({t:'Ship point', r:`${spCode} → ${tp.source} (topology — ${tp.from==='facility'?`Plant # of ${tp.facility}`:`material code of ${tp.label}`}; no table row)`});
    }else missing.push(tp?`ship point ${spCode} is on product ${tp.label} in the topology, but that product has no Made At facility to name it`
                         :`ship point ${spCode||'(blank)'} is not in the ship-point table or on any topology facility`);
  }

  let mCode=String(row.material??'').trim();
  const warn=[], picked=mCode.startsWith('cat:')?(DB.products||[]).find(x=>x.id===mCode.slice(4)):null;
  // Builder only: a catalog product picked by id. With a SAP code it runs exactly as
  // a real row carrying that code would (a shared code → the ship point decides).
  if(picked&&_xlCatCodes(picked.material_code)[0]) mCode=_xlCatCodes(picked.material_code)[0].sap;
  // Several rows may share a code when the ship point decides the product (a row with a
  // ship point wins for that ship point; the row without one is the default). A sale from a
  // ship point no row covers goes to the catalog, and failing that to the code's first row.
  // MatRowFor + Translate in the .vbs do the same: change both together.
  const _matRows=(XLMAP.materials||[]).filter(r=>String(r.code??'').trim()===mCode);
  let mat=_matRows.find(r=>r.ship_pt&&_xlNorm(r.ship_pt)===_xlNorm(spCode))||_matRows.find(r=>!r.ship_pt), catalogId=null;
  if(!mat&&picked&&mCode.startsWith('cat:')){
    // No SAP code yet: it still composes its name (so the bench can find its demand
    // point), but no SAP row can reach it.
    const s=_xlSplitProduct(picked.name); mat={product:s.product, pres:s.pres}; catalogId=picked.id;
    trace.push({t:'Material', r:`${picked.name} (catalog product — no SAP material code)`});
    warn.push(`${picked.name} has no SAP material code — SAP sales cannot land on it until one is typed in Configuration → Products`);
  }else if(!mat){
    const cat=_xlCatalogProductsFor(mCode, spCode);
    if(cat.length===1){
      const s=_xlSplitProduct(cat[0].name); mat={product:s.product, pres:s.pres}; catalogId=cat[0].id;
      const nShare=_xlCatalogProductsFor(mCode,'').length;
      trace.push({t:'Material', r:`${mCode} → ${s.product}${s.pres?' / '+s.pres:''} (from the product catalog — no table row${nShare>1?`; ${nShare} products share the code, ship point ${spCode} picks this one`:''})`});
    }else if(_matRows.length) mat=_matRows[0];
  }
  const skipMat=!!(mat&&mat.action==='skip');
  if(skipMat) trace.push({t:'Material', r:`${mCode} → not demand (its material row says skip${mat.note?' — '+mat.note:''})`});
  else if(mat&&mat.product){ if(!catalogId) trace.push({t:'Material', r:`${mCode} → ${mat.product}${mat.pres?' / '+mat.pres:''}`}); }
  else if(mat) missing.push(`material ${mCode} has no product set`);
  else{
    const cat=_xlCatalogProductsFor(mCode, spCode);
    missing.push(cat.length>1
      ? `material ${mCode} is on ${cat.length} catalog products (${cat.map(p=>p.name).join(', ')}) — add a material-table row to pick one`
      : `material ${mCode||'(blank)'} is not in the material table or on any catalog product`);
  }

  const stCode=String(row.ship_type??'').trim();
  const mov=(XLMAP.movements||[]).find(r=>_xlNorm(r.ship_type)===_xlNorm(stCode));
  if(mov) trace.push({t:'Movement', r:`${stCode} → ${mov.movement}${mov.action==='park'?' (parked)':''}`});
  else missing.push(`ship type ${stCode||'(blank)'} is not in the movement table`);

  const cls=xlmapClassify(row.sold_to);
  trace.push({t:'Class', r:`Sold-To ${String(row.sold_to??'').trim()||'(blank)'}: ${cls.rule}`});

  const parts={source, movement:mov?mov.movement:'', product:mat?mat.product:'',
               presentation:mat?mat.pres:'', class:cls.value};
  const name=xlmapName(parts);
  let finalName=name, action=mov?(mov.action||'import'):'import';
  const alias=(XLMAP.aliases||[]).find(a=>_xlNorm(a.from)===_xlNorm(name));
  if(alias){
    if(alias.action==='ignore'){ action='ignore'; trace.push({t:'Alias', r:`${name} → ignored`}); }
    else if(alias.to){ finalName=alias.to; trace.push({t:'Alias', r:`${name} → ${alias.to}`}); }
  }
  if(skipMat) action='skip';   // not demand, whatever the rest of the row says
  return {name, finalName, parts, trace, missing, warn, action, catalogId, mapped:!missing.length};
}
// Does a demand point with this name exist in the scenario that is open?
function xlmapFindDp(name){
  const n=_xlNorm(name); if(!n) return null;
  return (DB.elements||[]).find(e=>e.type==='demand_point'&&_xlNorm(e.name)===n)||null;
}

// ── Panel ─────────────────────────────────────────────────────────────────
function _xlCard(key,title,sub,count,body){
  const open=_xlUi.open[key]!==false;
  return `<div style="border:1px solid var(--border);margin-bottom:10px;background:var(--surface)">
    <div onclick="_xlToggle('${key}')" style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;border-bottom:${open?'1px solid var(--border)':'none'}">
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);width:10px">${open?'▾':'▸'}</span>
      <span style="font-family:var(--mono);font-size:10px;font-weight:700;color:var(--text);letter-spacing:.5px;text-transform:uppercase">${title}</span>
      <span style="font-family:var(--mono);font-size:8px;background:var(--border2);color:var(--text);padding:1px 6px;border-radius:8px">${count}</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-left:4px">${sub}</span>
    </div>
    <div id="xl-card-${key}" style="display:${open?'block':'none'}">${body}</div>
  </div>`;
}
function _xlToggle(key){
  _xlUi.open[key]=_xlUi.open[key]===false;
  xlmapRender();
}
const _xlInp=(table,i,field,val,ph,w)=>
  `<input class="fi" style="${w?'width:'+w+';':''}padding:3px 6px;font-size:9px" value="${esc(val??'')}" placeholder="${esc(ph||'')}"
     onchange="_xlSet('${table}',${i},'${field}',this.value)">`;

function _xlSet(table,i,field,val){
  const rows=XLMAP[table]; if(!rows||!rows[i]) return;
  rows[i][field]=String(val??'').trim();
  _xlUi.check=null;              // an edit makes the last check stale
  xlmapSave();
  if(table==='ship_points'||table==='materials') _xlDupWarn(table);
  // The alias target is only editable when the alias actually maps somewhere.
  if(table==='aliases'&&field==='action') xlmapRender();
}
function _xlAdd(table,rec){ (XLMAP[table]=XLMAP[table]||[]).push(rec); _xlUi.check=null; xlmapSave('Row added'); xlmapRender(); }
function _xlDel(table,i){ XLMAP[table].splice(i,1); _xlUi.check=null; xlmapSave('Row deleted'); xlmapRender(); }
function _xlMove(table,i,d){
  const rows=XLMAP[table], j=i+d; if(j<0||j>=rows.length) return;
  [rows[i],rows[j]]=[rows[j],rows[i]]; xlmapSave('Order changed'); xlmapRender();
}
// Re-render, then put the cursor back where it was — a filter box you cannot
// type more than one letter into is worse than no filter box.
function _xlFilter(key,val){
  _xlUi.filter[key]=val; xlmapRender();
  const el=document.querySelector(`#cfg-panel-demandmap [data-xlfilter="${key}"]`);
  if(el){ el.focus(); try{ el.setSelectionRange(el.value.length,el.value.length); }catch(e){} }
}
function _xlDupWarn(table){
  const seen=new Set(), dups=new Set();
  (XLMAP[table]||[]).forEach(r=>{ const k=_xlNorm(r.code); if(!k) return; if(seen.has(k)) dups.add(k); seen.add(k); });
  if(dups.size) statMsg(`Duplicate code${dups.size>1?'s':''}: ${[...dups].join(', ')} — the first one wins`);
}
const _xlHit=(key,...vals)=>{
  const f=String(_xlUi.filter[key]||'').trim().toLowerCase();
  return !f||vals.some(v=>String(v??'').toLowerCase().includes(f));
};
const _xlFilterBox=(key,ph)=>`<input class="fi" data-xlfilter="${key}" style="width:200px;padding:3px 6px;font-size:9px" placeholder="${esc(ph)}"
   value="${esc(_xlUi.filter[key]||'')}" oninput="_xlFilter('${key}',this.value)">`;
const _xlHdr=cols=>`<tr>${cols.map(c=>`<th style="text-align:left;font-family:var(--mono);font-size:8px;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase;padding:5px 8px;border-bottom:1px solid var(--border);font-weight:400">${c}</th>`).join('')}</tr>`;
const _xlTd=(h,w)=>`<td style="padding:3px 8px;border-bottom:1px solid var(--border);${w?'width:'+w+';':''}">${h}</td>`;
const _xlTbl=inner=>`<table style="width:100%;border-collapse:collapse">${inner}</table>`;
const _xlAddBtn=(label,onclick)=>`<div style="padding:7px 12px"><span class="tbl-act" style="margin:0" onclick="${onclick}">+ ${label}</span></div>`;

function _xlShipBody(){
  const rows=(XLMAP.ship_points||[]).map((r,i)=>({r,i})).filter(({r})=>_xlHit('ship',r.code,r.source,r.note));
  const st=_xlSapStatus();
  return `${_xlSapHeadHTML(st)}${_xlSourceCoverageHTML()}<div style="padding:8px 12px;border-bottom:1px solid var(--border)">${_xlFilterBox('ship','filter code or source…')}</div>
  <div id="xl-body-ship">${_xlTbl(_xlHdr(['Ship Pt','Source','Note',...(st?['SAP · last run']:[]),''])+rows.map(({r,i})=>`<tr>
      ${_xlTd(_xlInp('ship_points',i,'code',r.code,'4802'),'90px')}
      ${_xlTd(_xlInp('ship_points',i,'source',r.source,'BRS'),'150px')}
      ${_xlTd(_xlInp('ship_points',i,'note',r.note,'optional'))}
      ${st?_xlTd(_xlSapCellHTML(r.code,st),'260px'):''}
      ${_xlTd(`<span class="tbl-act del" style="margin:0" onclick="_xlDel('ship_points',${i})">✕</span>`,'24px')}
    </tr>`).join(''))}</div>
  ${_xlAddBtn('Add ship point',`_xlAdd('ship_points',{code:'',source:'',note:''})`)}`;
}

// ── What the SAP script asked for, per ship point ──────────────────────────────
// Avila_Sales_Pipeline.vbs asks ZDAL2 for every code in the Ship points table (plus
// its own base list) and, after each run, writes Avila_Pipeline_ShipPoints.json next
// to the sales files: what it asked, in which sales org, and what came back. Read-only
// here — the table above is still the only thing people edit.
const XLPIPE_STATUS_FILE='Avila_Pipeline_ShipPoints.json';
async function _xlLoadSapStatus(prompt){
  try{
    const dir=await exportDir('sap',!!prompt);
    if(!dir){ if(prompt) statMsg('Choose the sales files folder first'); return; }
    let o=null;
    try{
      const f=await (await dir.getFileHandle(XLPIPE_STATUS_FILE)).getFile();
      o=JSON.parse(await f.text());
      if(!o||o.format!=='avila-pipeline-ship-points') o=null; else o._mtime=f.lastModified;
    }catch(e){ o=null; }   // not written yet (script older than V1.2, or never run)
    const next=o||{missing:true, folder:dir.name};
    const prev=_xlUi.sap;
    _xlUi.sap=next;
    if(prompt||!prev||prev._mtime!==next._mtime||!!prev.missing!==!!next.missing){
      if(document.getElementById('cfg-panel-demandmap')) xlmapRender();
    }
  }catch(e){ console.warn('pipeline status',e); }
}
// null until read; otherwise {data, idx: code → entry, plan: code → 'orgs asked'}
function _xlSapStatus(){
  const d=_xlUi.sap; if(!d||d.missing) return null;
  if(d._idx) return d._idx;
  const idx=new Map(), plan=new Map();
  (d.ship_points||[]).forEach(e=>idx.set(_xlNorm(e.code),e));
  (d.orgs||[]).forEach(o=>(o.ship_points||[]).forEach(c=>{
    const k=_xlNorm(c); plan.set(k,(plan.has(k)?plan.get(k)+' ':'')+o.org);
  }));
  return (d._idx={data:d, idx, plan});
}
function _xlSapHeadHTML(st){
  const box=inner=>`<div style="padding:8px 12px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:9px;line-height:1.6;color:var(--text-dim)">${inner}</div>`;
  const what=`Every code in this table — and every Plant # on a topology facility — is asked from SAP (ZDAL2) by <span style="color:var(--text)">Avila_Sales_Pipeline.vbs</span>; one that is not in its base list is asked in 2125, 2141 and 2172, and its history since 2025 is pulled once.`;
  if(!_xlUi.sap) return box(`${what}<br><span class="tbl-act" style="margin:0" onclick="_xlLoadSapStatus(true)">Show what the last SAP run asked and got →</span>`);
  if(!st) return box(`${what}<br><span style="color:var(--amber)">No run report yet in ${esc(_xlUi.sap.folder||'the sales files folder')}</span> — ${XLPIPE_STATUS_FILE} appears after the next run of the script.`);
  const d=st.data;
  let saved=null; try{ saved=JSON.parse(localStorage.getItem(XLRULES_SAVED_KEY)||'null'); }catch(e){}
  const changed=saved&&saved.id&&d.rules_id&&saved.id!==d.rules_id;
  const inTable=new Set((XLMAP.ship_points||[]).map(r=>_xlNorm(r.code)).filter(Boolean));
  const extra=[...st.plan.keys()].filter(k=>!inTable.has(k)).sort();
  const extraRows=extra.filter(k=>(st.idx.get(k)?.rows||0)>0);
  return box(`<span style="font-size:8px;letter-spacing:1px;text-transform:uppercase">Last SAP run</span>
    <span style="color:var(--text)">${esc(d.run_at||'?')}</span> by ${esc(d.run_by||'?')}
    · ${d.with_sap?`window ${esc(d.window_from)} → ${esc(d.window_to)}`:'<span style="color:var(--amber)">rules only, no SAP</span>'}
    · ${[...(d.orgs||[])].map(o=>`${esc(o.org)} (${(o.ship_points||[]).length})`).join(' · ')}
    <span class="tbl-act" style="margin:0 0 0 6px" onclick="_xlLoadSapStatus(true)">reload</span><br>${what}
    ${changed?`<br><span style="color:var(--amber)">This table changed after that run — the next run asks for the new list.</span>`:''}
    ${extra.length?`<br>Also asked though not in this table (base list or topology)${extraRows.length?` (<span style="color:var(--amber)">${extraRows.map(esc).join(', ')}</span> returned rows that stay unplaced)`:''}: ${extra.map(esc).join(' ')}`:''}
    ${_xlSapDpHTML(d.demand_points)}`);
}
// What the last run said about the scenario's demand points (Avila_Pipeline_Report.xlsx has
// the full sheets "Puntos de demanda" and "Nombres sin punto").
function _xlSapDpHTML(dp){
  if(!dp) return '';
  const list=(a,max)=>(a||[]).slice(0,max).map(esc).join(', ')+((a||[]).length>max?' …':'');
  const bits=[];
  if((dp.no_ship_point||[]).length) bits.push(`<span style="color:var(--amber)">${dp.no_ship_point.length} with no ship point for their source</span> (${list(dp.no_ship_point,4)})`);
  if((dp.no_sales||[]).length) bits.push(`<span style="color:var(--amber)">${dp.no_sales.length} got no SAP sales</span> (${list(dp.no_sales,4)})`);
  if((dp.bad_name||[]).length) bits.push(`${dp.bad_name.length} not named {source}/…`);
  const tail=dp.not_dp_names?`<br>SAP sales on names that are not demand points: <span style="color:var(--amber)">${Number(dp.not_dp_t||0).toLocaleString()} t in ${dp.not_dp_names} name${dp.not_dp_names===1?'':'s'}</span> (report sheet "Nombres sin punto")`:'';
  return `<br>Demand points in that run: ${dp.total}${bits.length?' — '+bits.join(' · '):' — <span style="color:var(--green)">all fed by SAP</span>'}${tail}`;
}
// One ship point's line: asked where, what came back, where it lands, its history.
function _xlSapInfo(code,st){
  const k=_xlNorm(code); if(!k||!st) return null;
  const e=st.idx.get(k), orgs=st.plan.get(k)||'';
  const n=v=>Number(v||0).toLocaleString();
  if(!/^[A-Z0-9]{1,4}$/.test(k))   // the script's own rule: a SAP shipping point is 1–4 letters or digits
    return {c:'var(--red)', t:'not asked — not a SAP ship point code', tip:'A SAP shipping point is 1 to 4 letters or digits; the script skips this one.'};
  if(!orgs){
    if(e&&e.note) return {c:'var(--red)', t:`not asked — ${e.note}`, tip:e.note};
    return {c:'var(--amber)', t:'new — asked from the next run',
      tip:`Not in the list of the last run (${st.data.run_at}). The next run asks SAP for it in 2125, 2141 and 2172 and pulls its history since ${st.data.history_from||'2025'} once.`};
  }
  const rows=e?e.rows:0;
  const hist=e&&e.history_state==='pending'?' · history on the next SAP run':'';
  const tip=[`Asked in ${orgs}`,
    e?`${n(e.rows)} rows · ${n(e.t)} t in the SAP history${e.first?` (${e.first} → ${e.last})`:''}`:'',
    e&&st.data.with_sap?`this run's window: ${n(e.month_rows)} rows · ${n(e.month_t)} t`:'',
    e&&e.demand_points?`lands on: ${e.demand_points}`:'',
    e&&e.history?`history: ${e.history}`:'',
    e&&e.note?e.note:''].filter(Boolean).join('\n');
  if(rows>0) return {c:'var(--green)', t:`✓ ${orgs} · ${n(rows)} row${rows===1?'':'s'} · last ${e.last||'?'}${hist}`, tip};
  return {c:'var(--amber)', t:`asked in ${orgs} · no rows yet${hist}`, tip};
}
function _xlSapCellHTML(code,st){
  const x=_xlSapInfo(code,st); if(!x) return '';
  return `<span style="font-family:var(--mono);font-size:9px;color:${x.c}" title="${esc(x.tip)}">${esc(x.t)}</span>`;
}
// Every product the topology uses, measured against this table — so a product added
// to the catalog shows up here the day it is created, not the day its sales go missing.
function _xlCatalogStrip(){
  const cov=_xlCatalogCoverage();
  const cat=cov.filter(c=>c.kind==='catalog'), noc=cov.filter(c=>c.kind==='nocode'), dr=cov.filter(c=>c.kind==='drift');
  if(!cat.length&&!noc.length&&!dr.length) return `<div style="padding:7px 12px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:9px;color:var(--green)">
    ✓ All ${cov.length} products the topology uses translate through this table.</div>`;
  const item=(c,extra,act)=>`<span style="display:inline-flex;gap:4px;align-items:center;margin:2px 10px 2px 0;white-space:nowrap">
    <span style="color:var(--text)">${esc(c.name)}</span>${extra?`<span style="color:var(--text-dim)">${extra}</span>`:''}${act||''}</span>`;
  const grp=(icon,color,title,list)=>`<div style="margin:3px 0">
    <div style="color:${color}">${icon} ${title}</div><div style="padding-left:14px;line-height:1.7">${list}</div></div>`;
  let h=`<div style="padding:8px 12px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:9px">
    <div style="font-size:8px;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase;margin-bottom:3px">Product catalog ↔ this table</div>`;
  if(noc.length) h+=grp('⚠','var(--amber)',`${noc.length} topology product${noc.length===1?' has':'s have'} no SAP material code — SAP sales cannot land on ${noc.length===1?'it':'them'}`,
    noc.map(c=>item(c,'',`<span class="tbl-act" style="margin:0" onclick="_xlEditProduct('${esc(c.id)}')">set code</span>`)).join(''));
  if(cat.length) h+=grp('✓','var(--green)',`${cat.length} placed straight from the catalog's SAP code — no row needed`,
    cat.map(c=>item(c,c.saps.join(' · '),`<span class="tbl-act" style="margin:0" title="Optional: write it into this table" onclick="_xlPinCatalog('${esc(c.id)}')">pin</span>`)).join(''));
  // Only offer the rename when the demand points carry the catalog's name and not the
  // table's — MIA_I/II's demand points follow the table, renaming would orphan them.
  const drNote=c=>c.dpTable&&!c.dpCatalog?`demand points use ${esc(c.tableName)} ✓`
    :c.dpCatalog&&!c.dpTable?`demand points use the catalog's name`
    :c.dpTable&&c.dpCatalog?`demand points exist under both names — sales land on ${esc(c.tableName)}`:'no demand point under either name';
  if(dr.length) h+=grp('·','var(--text-dim)',`${dr.length} code${dr.length===1?' is':'s are'} named differently here than in the catalog — composed names follow this table`,
    dr.map(c=>item(c,`${c.sap} here: ${esc(c.tableName)} · ${drNote(c)}`,
      c.dpCatalog&&!c.dpTable?`<span class="tbl-act" style="margin:0" title="Rename the table row to the catalog's name, so sales land on the demand points that carry it" onclick="_xlUseCatalogName('${esc(c.id)}')">use catalog name</span>`:'')).join(''));
  return h+`</div>`;
}
function _xlMatBody(){
  const rows=(XLMAP.materials||[]).map((r,i)=>({r,i})).filter(({r})=>_xlHit('mat',r.code,r.product,r.pres,r.note,r.action==='skip'?'skip not demand':''));
  const actSel=(i,v)=>`<select class="fi" style="padding:3px 6px;font-size:9px;${v==='skip'?'color:var(--amber)':''}" title="Skip = not demand (services, supplies, lines that repeat another line's tonnes): left out of every published file" onchange="_xlSet('materials',${i},'action',this.value);xlmapRender()">
    <option value="" ${v!=='skip'?'selected':''}>demand</option><option value="skip" ${v==='skip'?'selected':''}>skip — not demand</option></select>`;
  return _xlCatalogStrip()+`<div style="padding:8px 12px;border-bottom:1px solid var(--border)">${_xlFilterBox('mat','filter code, product or "skip"…')}</div>
  <div id="xl-body-mat">${_xlTbl(_xlHdr(['Material','Ship pt','Product','Pack','Counts as','Note',''])+rows.map(({r,i})=>`<tr>
      ${_xlTd(_xlInp('materials',i,'code',r.code,'1606504'),'100px')}
      ${_xlTd(_xlInp('materials',i,'ship_pt',r.ship_pt,'any'),'60px')}
      ${_xlTd(`<input class="fi" list="xl-prodlist" style="padding:3px 6px;font-size:9px" value="${esc(r.product??'')}" placeholder="${r.action==='skip'?'—':'BRS_IL(12)'}" onchange="_xlSet('materials',${i},'product',this.value)">`,'190px')}
      ${_xlTd(`<input class="fi" list="xl-preslist" style="padding:3px 6px;font-size:9px" value="${esc(r.pres??'')}" placeholder="${r.action==='skip'?'—':'BLK'}" onchange="_xlSet('materials',${i},'pres',this.value)">`,'80px')}
      ${_xlTd(actSel(i,r.action),'140px')}
      ${_xlTd(_xlInp('materials',i,'note',r.note,'optional'))}
      ${_xlTd(`<span class="tbl-act del" style="margin:0" onclick="_xlDel('materials',${i})">✕</span>`,'24px')}
    </tr>`).join(''))}</div>
  ${_xlAddBtn('Add material',`_xlAdd('materials',{code:'',product:'',pres:'BLK',note:''})`)}`;
}
// Ship-To → sales rep, one row per rep. Feeds the Detail file's SalesRep column (the
// Sales page's Rep filter). The Ship-Tos the last read found without a rep are listed
// underneath with a picker, so a new customer is one click, not a hunt.
function _xlRepBody(){
  const reps=XLMAP.sales_reps||[];
  const rows=reps.map((r,i)=>({r,i})).filter(({r})=>_xlHit('rep',r.rep,r.ship_tos,r.note));
  const cnt=s=>String(s||'').split(/[\s,;]+/).filter(Boolean).length;
  let h=`<div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
      ${_xlFilterBox('rep','filter rep or a Ship-To number…')}
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">Ship-Tos separated by spaces. The first rep listing a Ship-To wins.</span>
    </div>
  <div id="xl-body-rep">${_xlTbl(_xlHdr(['Sales rep','Ship-Tos','',''])+rows.map(({r,i})=>`<tr>
      ${_xlTd(_xlInp('sales_reps',i,'rep',r.rep,'STELLJES,PAUL A'),'190px')}
      ${_xlTd(`<textarea class="fi" rows="2" style="width:100%;padding:3px 6px;font-family:var(--mono);font-size:9px;resize:vertical" onchange="_xlSet('sales_reps',${i},'ship_tos',this.value)">${esc(r.ship_tos||'')}</textarea>`)}
      ${_xlTd(`<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">${cnt(r.ship_tos)}</span>`,'40px')}
      ${_xlTd(`<span class="tbl-act del" style="margin:0" onclick="_xlDel('sales_reps',${i})">✕</span>`,'24px')}
    </tr>`).join(''))}</div>
  <div style="padding:8px 12px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px">
    <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">No rep listed →</span>
    <input class="fi" style="width:150px;padding:3px 6px;font-size:9px" value="${esc(XLMAP.fallback_rep||'')}" placeholder="(blank)"
      onchange="XLMAP.fallback_rep=this.value.trim();xlmapSave('Fallback rep saved')">
    <span class="tbl-act" style="margin-left:auto" onclick="_xlAdd('sales_reps',{rep:'',ship_tos:'',note:''})">+ Add rep</span>
  </div>`;
  const miss=(window._dsDemandPreview?.noRep||[]).filter(x=>!_xlRepIdx||!_xlRepIdx.has(x.code));
  if(miss.length){
    const n=v=>Math.round(v).toLocaleString();
    const opts=reps.filter(r=>r.rep).map(r=>`<option value="${esc(r.rep)}">${esc(r.rep)}</option>`).join('');
    h+=`<div style="padding:8px 12px;border-top:1px solid var(--border)">
      <div style="font-family:var(--mono);font-size:8px;letter-spacing:1px;color:var(--amber);text-transform:uppercase;margin-bottom:4px">In the last read, no rep — ${miss.length} Ship-To${miss.length===1?'':'s'}, biggest first</div>
      ${miss.slice(0,15).map(x=>`<div style="font-family:var(--mono);font-size:9px;margin:2px 0;display:flex;gap:8px;align-items:center">
        <span style="flex:0 0 70px">${esc(x.code)}</span><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-dim)">${esc(x.name)} · ${n(x.t)} t</span>
        <select class="fi" style="flex:0 0 190px;width:190px;padding:2px 5px;font-size:9px" onchange="if(this.value)_xlAssignRep('${esc(x.code)}',this.value)"><option value="">assign to…</option>${opts}</select></div>`).join('')}
      ${miss.length>15?`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">· and ${miss.length-15} more</div>`:''}
      <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:3px">Re-read the export after assigning, so the next Publish carries the rep.</div>
    </div>`;
  }
  return h;
}
function _xlAssignRep(code,rep){
  const r=(XLMAP.sales_reps||[]).find(x=>x.rep===rep); if(!r) return;
  r.ship_tos=(String(r.ship_tos||'').trim()+' '+code).trim();
  xlmapSave(`Ship-To ${code} → ${rep}`);
  xlmapRep('');   // rebuild the index so the list above drops it
  xlmapRender();
}
function _xlClsBody(){
  const rows=XLMAP.class_rules||[];
  const typeSel=(i,v)=>`<select class="fi" style="padding:3px 6px;font-size:9px" onchange="_xlSet('class_rules',${i},'type',this.value)">
    ${['exact','length','prefix','regex'].map(t=>`<option value="${t}" ${v===t?'selected':''}>${t}</option>`).join('')}</select>`;
  return `<div style="padding:7px 12px;font-family:var(--mono);font-size:9px;color:var(--text-dim);border-bottom:1px solid var(--border)">
      Checked top to bottom — the first rule that matches wins. Drag order with ▲▼.
    </div>
  ${_xlTbl(_xlHdr(['#','Test','Match','Class','Note',''])+rows.map((r,i)=>`<tr>
      ${_xlTd(`<span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">${i+1}</span>
        <span class="tbl-act" style="margin-left:4px" onclick="_xlMove('class_rules',${i},-1)">▲</span>
        <span class="tbl-act" style="margin-left:2px" onclick="_xlMove('class_rules',${i},1)">▼</span>`,'74px')}
      ${_xlTd(typeSel(i,r.type),'90px')}
      ${_xlTd(_xlInp('class_rules',i,'match',r.match,'4'),'110px')}
      ${_xlTd(_xlInp('class_rules',i,'value',r.value,'INT'),'90px')}
      ${_xlTd(_xlInp('class_rules',i,'note',r.note,'optional'))}
      ${_xlTd(`<span class="tbl-act del" style="margin:0" onclick="_xlDel('class_rules',${i})">✕</span>`,'24px')}
    </tr>`).join(''))}
  <div style="padding:8px 12px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px">
    <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">No rule matched →</span>
    <input class="fi" style="width:90px;padding:3px 6px;font-size:9px" value="${esc(XLMAP.fallback_class||'')}"
      onchange="XLMAP.fallback_class=this.value.trim();xlmapSave('Fallback class saved')">
    <span class="tbl-act" style="margin-left:auto" onclick="_xlAdd('class_rules',{type:'exact',match:'',value:'',note:''})">+ Add rule</span>
  </div>`;
}
function _xlMovBody(){
  const rows=XLMAP.movements||[];
  const actSel=(i,v)=>`<select class="fi" style="padding:3px 6px;font-size:9px" onchange="_xlSet('movements',${i},'action',this.value)">
    ${[['import','import as demand'],['park','park (keep, do not use)'],['ignore','ignore']].map(([k,l])=>`<option value="${k}" ${(v||'import')===k?'selected':''}>${l}</option>`).join('')}</select>`;
  return _xlTbl(_xlHdr(['Ship Type','Movement','What we do with it','Note',''])+rows.map((r,i)=>`<tr>
      ${_xlTd(_xlInp('movements',i,'ship_type',r.ship_type,'SALES'),'110px')}
      ${_xlTd(_xlInp('movements',i,'movement',r.movement,'DEM'),'90px')}
      ${_xlTd(actSel(i,r.action),'190px')}
      ${_xlTd(_xlInp('movements',i,'note',r.note,'optional'))}
      ${_xlTd(`<span class="tbl-act del" style="margin:0" onclick="_xlDel('movements',${i})">✕</span>`,'24px')}
    </tr>`).join(''))
  +_xlAddBtn('Add ship type',`_xlAdd('movements',{ship_type:'',movement:'',action:'import',note:''})`)
  +`<div style="padding:8px 12px;border-top:1px solid var(--border)">
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);line-height:1.6;margin-bottom:5px">
      <span style="color:var(--text)">SALES or TRANS comes from the Ship-To.</span> A Ship-To in this list is one of our plants or terminals, so the row is a
      transfer (TRANS); any other Ship-To is a sale (SALES). SAP's own Ship Type column is a shipping code (01, 03) and is not used.
      Empty list = use the file's Ship Type column as it is.</div>
    <input class="fi" style="width:100%;padding:4px 7px;font-size:10px;font-family:var(--mono)" value="${esc(XLMAP.transfer_ship_tos||'')}" placeholder="4802 4805 4808 …"
      onchange="XLMAP.transfer_ship_tos=this.value.trim();xlmapSave('Transfer Ship-Tos saved')">
  </div>`;
}
function _xlAliBody(){
  const rows=(XLMAP.aliases||[]).map((r,i)=>({r,i})).filter(({r})=>_xlHit('ali',r.from,r.to,r.note));
  const actSel=(i,v)=>`<select class="fi" style="padding:3px 6px;font-size:9px" onchange="_xlSet('aliases',${i},'action',this.value)">
    ${[['map','send to'],['ignore','ignore it']].map(([k,l])=>`<option value="${k}" ${(v||'map')===k?'selected':''}>${l}</option>`).join('')}</select>`;
  const body=rows.length
    ? _xlTbl(_xlHdr(['Composed name','','Demand point','Note',''])+rows.map(({r,i})=>`<tr>
        ${_xlTd(_xlInp('aliases',i,'from',r.from,'MIA/DEM/MIA_IL(08)/BLK/IND'))}
        ${_xlTd(actSel(i,r.action),'110px')}
        ${_xlTd(`<input class="fi" list="xl-dplist" style="padding:3px 6px;font-size:9px" value="${esc(r.to??'')}" placeholder="MIA/DEM/MIA_IL(8)/BLK/IND" ${r.action==='ignore'?'disabled':''} onchange="_xlSet('aliases',${i},'to',this.value)">`)}
        ${_xlTd(_xlInp('aliases',i,'note',r.note,'optional'),'160px')}
        ${_xlTd(`<span class="tbl-act del" style="margin:0" onclick="_xlDel('aliases',${i})">✕</span>`,'24px')}
      </tr>`).join(''))
    : `<div style="padding:14px 12px;font-family:var(--mono);font-size:9px;color:var(--text-dim);text-align:center">
        No aliases. A composed name that already matches a demand point needs none — add one only where the app's name drifted from the data.</div>`;
  return `<div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
      ${_xlFilterBox('ali','filter…')}
      <span style="font-family:var(--mono);font-size:9px;color:var(--text-dim)">Used when the composed name and the demand point's name differ.</span>
    </div><div id="xl-body-ali">${body}</div>
  ${_xlAddBtn('Add alias',`_xlAdd('aliases',{from:'',to:'',action:'map',note:''})`)}`;
}

// ── The product catalog is the fallback for the material table ───────────────
// A product created in the catalog (e.g. BRS_IL(HE)/BLK, 2026-09-23) used to be invisible
// here until someone also typed a material-table row for it: its SAP sales could not be
// placed and the builder could not pick it. The catalog record already carries the SAP
// material ("Material Code": "4802-000000000001638064" = ship point 4802 + material 1638064,
// or just "1638064"), so a material the table does not translate now falls back to the
// catalog product with that code. An explicit table row still wins. When one material sits
// on several products (clinker 1035907 = BRS_CLK at 4802 and MIA_CLK at 4808) the row's
// ship point picks the product.
function _xlCatCode(mc){ // "4802-000000000001638064" → {ship:"4802", sap:"1638064"}
  const m=/^(?:(\d{3,6})[-\s]+)?0*(\d+)$/.exec(String(mc||'').trim()); // not "OPC-001"
  return m?{ship:m[1]||'', sap:m[2]}:null;
}
// A product may carry several material numbers when one cement has several SAP codes
// (Titan's IL arrives under four): "1623645, 1634026". Commas, semicolons or line breaks
// separate them, and so do spaces when the text is not one "4802 000…" pair.
function _xlCodeList(mc){
  const out=[];
  String(mc||'').split(/[,;\r\n]+/).forEach(s=>{
    s=s.trim(); if(!s) return;
    (_xlCatCode(s)||!/\s/.test(s)?[s]:s.split(/\s+/)).forEach(c=>{ if(!out.includes(c)) out.push(c); });
  });
  return out;
}
const _xlCatCodes=mc=>_xlCodeList(mc).map(_xlCatCode).filter(Boolean);
// Does this material-table row speak for this catalog code? (Same code, and its ship point if both name one.)
const _xlRowFor=(r,k)=>String(r.code??'').trim()===k.sap&&(!r.ship_pt||!k.ship||_xlNorm(r.ship_pt)===_xlNorm(k.ship));
// ── Ship points the TOPOLOGY defines ─────────────────────────────────────────────
// A facility's Plant # codes (Organization → facility) are its SAP shipping points, and a
// product whose material code carries one ("4802-000…1638064") ships from it too. They go
// into the rules file (catalog_ship_points), the SAP script asks for every one of them, and
// a code with no row in the Ship points table still translates: its source is the facility,
// named the way its demand points are — the first segment of the facility name (facility
// "EXT/CEM/PURCH" is source EXT). When the table has the code, the table wins.
function _xlFacSource(fac){ return String(fac&&fac.name||'').split('/')[0].trim(); }
function _xlTopologyShipPoints(){
  const out=[], seen=new Set();
  const add=(code,rec)=>{ const k=_xlNorm(code); if(!k||seen.has(k)) return; seen.add(k); out.push({code:String(code).trim(),...rec}); };
  (DB.facilities||[]).forEach(f=>facPlantCodes(f).forEach(c=>
    add(c.code,{source:_xlFacSource(f), facility:f.name, from:'facility', label:c.label||''})));
  (DB.products||[]).forEach(p=>{
    const f=p.facility_id?(DB.facilities||[]).find(x=>x.id===p.facility_id):null;
    _xlCatCodes(p.material_code).forEach(k=>{ if(k.ship) add(k.ship,{source:f?_xlFacSource(f):'', facility:f?f.name:'', from:'product', label:p.name}); });
  });
  return out;
}
function _xlTopoShipPoint(code){
  const k=_xlNorm(code); if(!k) return null;
  return _xlTopologyShipPoints().find(r=>_xlNorm(r.code)===k)||null;
}
// Which ship points feed each topology source, and what cannot reach SAP. One row per
// facility (+ any demand-point source that is not a facility name) → {codes, dps, ...}.
// A "source" is what a demand point's name starts with (PEV/DEM/…): the first segment of a
// facility's name, or of a demand point's name. Each gets the ship points that produce it.
function _xlSourceCoverage(){
  const table=XLMAP.ship_points||[], topo=_xlTopologyShipPoints();
  const rows=new Map();   // normalized source → {source, facs, codes, dps}
  const row=src=>{
    const s=String(src||'').trim(), k=_xlNorm(s); if(!k) return null;
    if(!rows.has(k)) rows.set(k,{source:s, facs:[], codes:new Map(), dps:0});
    return rows.get(k);
  };
  (DB.facilities||[]).forEach(f=>{ const r=row(_xlFacSource(f)); if(r) r.facs.push(f.name); });
  const unnamed=[];
  (DB.elements||[]).filter(e=>e.type==='demand_point').forEach(d=>{
    const n=String(d.name||''), i=n.indexOf('/'), r=i>0?row(n.slice(0,i)):null;
    if(r) r.dps++; else unnamed.push(n||d.id);
  });
  table.forEach(t=>{ const r=t.source?rows.get(_xlNorm(t.source)):null; if(r) r.codes.set(_xlNorm(t.code),{code:t.code, from:'table'}); });
  topo.forEach(t=>{
    const k=_xlNorm(t.code); if(!t.source||table.some(x=>_xlNorm(x.code)===k)) return;   // the table wins
    const r=row(t.source); if(r&&!r.codes.has(k)) r.codes.set(k,{code:t.code, from:t.from});
  });
  // codes the topology names differently from the table (the table wins)
  const clash=topo.map(t=>({t, x:table.find(r=>_xlNorm(r.code)===_xlNorm(t.code))}))
    .filter(({t,x})=>x&&x.source&&t.source&&_xlNorm(x.source)!==_xlNorm(t.source))
    .map(({t,x})=>({code:t.code, table:x.source, topo:t.source, where:t.from==='facility'?`Plant # of ${t.facility}`:`material code of ${t.label}`}));
  return {list:[...rows.values()], unnamed, clash};
}
function _xlSourceCoverageHTML(){
  const c=_xlSourceCoverage();
  const ok=c.list.filter(r=>r.codes.size), dead=c.list.filter(r=>!r.codes.size&&r.dps), idle=c.list.filter(r=>!r.codes.size&&!r.dps);
  const codeTxt=r=>[...r.codes.values()].map(x=>x.from==='table'?esc(x.code):`<span title="${x.from==='facility'?'Plant # in the topology':'ship point in a product material code'} — not in this table">${esc(x.code)}*</span>`).join(' ');
  const name=r=>{ const f=r.facs.find(n=>_xlNorm(n)!==_xlNorm(r.source));
    return `<span style="color:var(--text)" title="${esc(r.facs.length?'facility '+r.facs.join(', '):'demand points only — no facility by this name')}">${esc(r.source)}</span>${f?`<span style="color:var(--text-dim)"> (${esc(f)})</span>`:''}`; };
  const line=(color,html)=>`<div style="margin:2px 0;color:${color}">${html}</div>`;
  let h='';
  if(ok.length) h+=line('var(--text-dim)',`<span style="color:var(--green)">✓</span> ${ok.map(r=>`${name(r)} ${codeTxt(r)}`).join(' · ')}`);
  dead.forEach(r=>h+=line('var(--amber)',`⚠ ${name(r)}: ${r.dps} demand point${r.dps===1?'':'s'} but no SAP ship point — their actual sales can never come from SAP. Add the code as a row here or as a Plant # on the facility (Organization).`));
  if(c.unnamed.length) h+=line('var(--amber)',`⚠ ${c.unnamed.length} demand point${c.unnamed.length===1?' is':'s are'} not named {source}/… so no SAP sale can land on ${c.unnamed.length===1?'it':'them'}: ${c.unnamed.slice(0,6).map(esc).join(', ')}${c.unnamed.length>6?' …':''}`);
  if(idle.length) h+=line('var(--text-dim)',`· No SAP ship point and no demand points (nothing to pull yet): ${idle.map(name).join(', ')} — give one a Plant # or a row here when it starts selling.`);
  c.clash.forEach(x=>h+=line('var(--text-dim)',`· ${esc(x.code)}: this table says ${esc(x.table)}, the topology (${esc(x.where)}) says ${esc(x.topo)} — the table wins.`));
  if(ok.some(r=>[...r.codes.values()].some(x=>x.from!=='table'))) h+=line('var(--text-dim)',`* comes from the topology, not from this table — the script asks SAP for it all the same.`);
  return `<div style="padding:8px 12px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:9px;line-height:1.6">
    <div style="font-size:8px;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase;margin-bottom:2px">Topology sources → SAP ship points</div>${h||line('var(--text-dim)','No facilities in this scenario.')}</div>`;
}
function _xlCatalogProductsFor(code, shipPt){
  const c=String(code||'').trim().replace(/^0+/,''); if(!c) return [];
  const hits=(DB.products||[]).filter(p=>_xlCatCodes(p.material_code).some(k=>k.sap===c));
  if(hits.length<2) return hits;
  const s=String(shipPt||'').trim();
  const byShip=s?hits.filter(p=>_xlCatCodes(p.material_code).some(k=>k.sap===c&&k.ship===s)):[];
  return byShip.length?byShip:hits;
}
function _xlSplitProduct(name){ // catalog "BRS_IL(HE)/BLK" → table-style {product:"BRS_IL(HE)", pres:"BLK"}
  const s=String(name||'').trim(), i=s.lastIndexOf('/');
  return i>0?{product:s.slice(0,i), pres:s.slice(i+1)}:{product:s, pres:''};
}
const _xlTableHasCode=code=>(XLMAP.materials||[]).some(r=>String(r.code??'').trim()===String(code??'').trim());
// Products the topology uses (silo contents + demand-point products).
function _xlTopologyProductIds(){
  const used=new Set();
  (DB.elements||[]).forEach(e=>{ if(e.type==='bulk_silo'||e.type==='packed_silo') (getSiloProducts(e)||[]).forEach(p=>used.add(p)); });
  (DB.demand_points||[]).forEach(d=>(d.products||[]).forEach(p=>p&&p.product_id&&used.add(p.product_id)));
  return used;
}
// How every product the topology uses reaches the material table:
//   table    — a table row translates its name (nothing to do)
//   catalog  — no row, but its catalog SAP code does the job (the fallback above)
//   nocode   — no row and no SAP code: its sales cannot be placed until one is added
//   drift    — its SAP code IS in the table but under another product name
function _xlCatalogCoverage(){
  if(!XLMAP) xlmapLoad();
  const rows=XLMAP.materials||[], used=_xlTopologyProductIds(), out=[];
  const dpNames=(DB.elements||[]).filter(e=>e.type==='demand_point').map(e=>_xlNorm(e.name));
  (DB.products||[]).forEach(p=>{
    if(!used.has(p.id)||!p.name) return;
    const sp=_xlSplitProduct(p.name), ks=_xlCatCodes(p.material_code), k=ks[0]||null;
    const named=r=>_xlNorm(r.product)===_xlNorm(sp.product)&&_xlNorm(r.pres||'')===_xlNorm(sp.pres);
    const byName=rows.some(named);
    // Several codes: each must read this product. One row left under its old name still sends
    // that code's sales elsewhere, so it counts as a drift even when the others are right.
    const stray=ks.length>1?ks.map(x=>rows.find(r=>_xlRowFor(r,x)&&!named(r)&&r.action!=='skip')).find(Boolean):null;
    const byCode=stray||(k?rows.find(r=>String(r.code??'').trim()===k.sap):null);
    const kind=stray?'drift':byName?'table':byCode?'drift':k?'catalog':'nocode';
    const tableName=byCode?(byCode.product+(byCode.pres?'/'+byCode.pres:'')):'';
    // For a drift: which of the two names do the demand points carry? Only that one lands.
    const dpWith=n=>n?dpNames.filter(d=>d.includes('/'+_xlNorm(n)+'/')).length:0;
    out.push({id:p.id, name:p.name, product:sp.product, pres:sp.pres, sap:stray?String(stray.code).trim():k?k.sap:'', saps:ks.map(x=>x.sap), ship:k?k.ship:'', kind, tableName,
      dpTable:kind==='drift'?dpWith(tableName):0, dpCatalog:kind==='drift'?dpWith(p.name):0});
  });
  return out.sort((a,b)=>a.name.localeCompare(b.name));
}
// Pin a catalog-derived translation as an explicit table row (optional — the fallback already works).
function _xlPinCatalog(pid){
  const c=_xlCatalogCoverage().find(x=>x.id===pid); if(!c) return;
  const codes=(c.saps.length?c.saps:['']).filter(code=>!code||!_xlTableHasCode(code));
  (XLMAP.materials=XLMAP.materials||[]).push(...codes.map(code=>({code, product:c.product, pres:c.pres, note:'from the product catalog'})));
  _xlUi.check=null; xlmapSave(c.sap?`Material ${codes.join(', ')} → ${c.name} added to the table`:`Row added for ${c.name} — type its SAP material code`);
  xlmapRender();
}
// Make the table row agree with the catalog's name for the same SAP code.
function _xlUseCatalogName(pid){
  const c=_xlCatalogCoverage().find(x=>x.id===pid); if(!c||!c.sap) return;
  const ks=_xlCatCodes((DB.products||[]).find(p=>p.id===pid)?.material_code);
  (XLMAP.materials||[]).forEach(r=>{ if(ks.some(k=>_xlRowFor(r,k))){ r.product=c.product; r.pres=c.pres; } });
  _xlUi.check=null; xlmapSave(`Material ${c.saps.join(', ')} now reads ${c.name}`); xlmapRender();
}

// Build a demand point — pick by name, never by code. The codes are what SAP
// sends and what the tables translate; nobody should have to remember them to
// answer "what would a JAX slag sale land on?". Everything here runs through
// the same xlmapTranslate an import uses, so what you see is what you get.

// Which facility is this source? The ship-point code wins (it is the binding we
// already keep on the facility), then a plain name match.
function _xlFacForSource(src,code){
  return (code&&typeof facilityByPlantCode==='function'&&facilityByPlantCode(code))
      || (DB.facilities||[]).find(f=>_xlNorm(f.name)===_xlNorm(src))
      || null;
}
// Products the topology actually associates with a facility: what its silos hold
// and what its demand points already ask for. Returns null when the source has
// no facility here, which means "do not narrow the list".
function _xlProductsAtFacility(fac){
  if(!fac) return null;
  const els=(DB.elements||[]).filter(e=>(e.assigned_facility_id||e.facility_id)===fac.id);
  const names=new Set();
  const add=pid=>{ const p=(DB.products||[]).find(x=>x.id===pid); if(p&&p.name) names.add(_xlNorm(p.name)); };
  els.forEach(e=>{
    if(e.type==='bulk_silo'||e.type==='packed_silo'){
      (typeof getSiloProducts==='function'?getSiloProducts(e)||[]:[]).forEach(add);
    }
    if(e.type==='demand_point'){
      const dp=(DB.demand_points||[]).find(d=>d.element_id===e.id);
      (dp?.products||[]).forEach(p=>add(p.product_id));
    }
  });
  return names.size?names:null;
}
// One option per product+pack in the material table, carrying its codes — plus
// every catalog product the table does not cover: by its SAP code when it has one
// (the translation fallback places those), else as 'cat:<id>' (flagged nocode) so a
// topology product without a code can still be picked and its demand point found.
function _xlMaterialOptions(){
  const by=new Map();
  (XLMAP.materials||[]).forEach(m=>{
    if(!m.product) return;
    const label=m.product+(m.pres?'/'+m.pres:'');
    const e=by.get(label)||{label,product:m.product,pres:m.pres||'',codes:[]};
    e.codes.push(String(m.code||'').trim());
    by.set(label,e);
  });
  const known=new Set([...by.keys()].map(_xlNorm)), used=_xlTopologyProductIds();
  const shared=code=>(DB.products||[]).filter(x=>_xlCatCodes(x.material_code).some(k=>k.sap===code)).length>1;
  (DB.products||[]).forEach(p=>{
    if(!p.name||known.has(_xlNorm(p.name))) return;
    const ks=_xlCatCodes(p.material_code), k=ks.find(x=>!_xlTableHasCode(x.sap)), s=_xlSplitProduct(p.name);
    // A code shared by several products (clinker 1035907) would make identical options — pick by product.
    if(k) by.set(p.name,{label:p.name,product:s.product,pres:s.pres,codes:[shared(k.sap)?'cat:'+p.id:k.sap],catalog:true});
    else if(!ks.length&&used.has(p.id))    by.set(p.name,{label:p.name,product:s.product,pres:s.pres,codes:['cat:'+p.id],catalog:true,nocode:true});
  });
  return [...by.values()].sort((a,b)=>a.label.localeCompare(b.label));
}
// One option per outcome the class rules can produce, named the way a person
// thinks of it — the customer for an exception, "any 4-digit" for a length rule.
function _xlClassOptions(){
  const out=[];
  (XLMAP.class_rules||[]).forEach(r=>{
    const m=String(r.match||'').trim(); if(!m||!r.value) return;
    if(r.type==='exact')       out.push({value:m, label:(r.note||m)+' → '+r.value});
    else if(r.type==='length') out.push({value:'1'.repeat(Math.max(1,parseInt(m,10)||1)), label:`any ${m}-digit Sold-To → ${r.value}`});
    else                       out.push({value:m, label:`${r.type} "${m}" → ${r.value}`});
  });
  out.push({value:'?', label:`anything else → ${XLMAP.fallback_class||'UNK'}`});
  return out;
}
function _xlTestBody(){
  if(!XLMAP) xlmapLoad();
  const t=_xlUi.test||(_xlUi.test={});
  // Table rows, then the codes only the topology knows (a facility's Plant #, a product's ship point)
  const inTable=new Set((XLMAP.ship_points||[]).map(r=>_xlNorm(r.code)));
  const allSp=[...(XLMAP.ship_points||[]),
    ..._xlTopologyShipPoints().filter(p=>p.source&&!inTable.has(_xlNorm(p.code)))
      .map(p=>({code:p.code, source:p.source, note:(p.from==='facility'?`Plant # of ${p.facility}`:`${p.label} material code`)+' — topology'}))];
  const sources=[...new Set(allSp.map(r=>r.source).filter(Boolean))].sort();
  if(!t.source&&sources.length) t.source=sources[0];
  const codes=allSp.filter(r=>r.source===t.source);
  if(!codes.some(c=>c.code===t.code)) t.code=codes[0]?.code||'';
  const fac=_xlFacForSource(t.source,t.code);
  const atFac=_xlProductsAtFacility(fac);
  const allMats=_xlMaterialOptions();
  const wired=atFac?allMats.filter(m=>atFac.has(_xlNorm(m.label))||atFac.has(_xlNorm(m.product))):[];
  const rest=allMats.filter(m=>!wired.includes(m));
  const mats=[...wired,...rest];
  if(!mats.some(m=>m.codes.includes(t.material))) t.material=mats[0]?.codes[0]||'';
  const classes=_xlClassOptions();
  if(!classes.some(c=>c.value===t.sold_to)) t.sold_to=classes[0]?.value||'';
  const movs=(XLMAP.movements||[]);
  if(!movs.some(m=>m.ship_type===t.ship_type)) t.ship_type=movs[0]?.ship_type||'';

  const sel=(k,opts,w)=>`<select class="fi" style="padding:4px 7px;font-size:10px;${w?'width:'+w:''}" onchange="_xlTestSet('${k}',this.value)">
    ${opts.map(o=>`<option value="${esc(o.v)}" ${String(o.v)===String(t[k])?'selected':''}>${esc(o.l)}</option>`).join('')}</select>`;
  const fld=(label,inner)=>`<div><div class="fl" style="font-size:8px">${label}</div>${inner}</div>`;

  return `<div style="padding:10px 12px">
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
      ${fld('Source',sel('source',sources.map(s=>({v:s,l:s})),'150px'))}
      ${codes.length>1?fld('Shipped from',sel('code',codes.map(c=>({v:c.code,l:c.code+(c.note?' · '+c.note:'')})),'210px')):''}
      ${fld('Product',_xlProductSelect(wired,rest,t.material,fac))}
      ${fld('Customer',sel('sold_to',classes.map(c=>({v:c.value,l:c.label})),'250px'))}
      ${fld('Movement',sel('ship_type',movs.map(m=>({v:m.ship_type,l:m.ship_type+' → '+m.movement})),'150px'))}
    </div>
    <div style="margin-top:5px;font-family:var(--mono);font-size:8px;color:var(--text-dim)">
      ${fac?`Source resolves to facility <span style="color:var(--text)">${esc(fac.name)}</span>${wired.length?` · ${wired.length} product${wired.length===1?'':'s'} wired to it, listed first`:' · nothing wired to it yet'} · ${allMats.filter(m=>!m.catalog).length} products in the material table${allMats.some(m=>m.catalog)?` + ${allMats.filter(m=>m.catalog).length} from the product catalog`:''}`
           :`No facility named <span style="color:var(--amber)">${esc(t.source||'—')}</span> in this scenario — every product listed`}
    </div>
    <div id="xl-test-out" style="margin-top:10px">${_xlTestOutHTML()}</div>
  </div>`;
}
function _xlProductSelect(wired,rest,cur,fac){
  const opt=m=>`<option value="${esc(m.codes[0])}" ${m.codes.includes(cur)?'selected':''}>${esc(m.label)}${m.nocode?' · no SAP code':m.catalog?' · catalog':''}</option>`;
  const body=wired.length
    ? `<optgroup label="wired to ${esc(fac?fac.name:'this facility')}">${wired.map(opt).join('')}</optgroup>`
      +(rest.length?`<optgroup label="── everything else">${rest.map(opt).join('')}</optgroup>`:'')
    : rest.map(opt).join('');
  return `<select class="fi" style="padding:4px 7px;font-size:10px;width:200px" onchange="_xlTestSet('material',this.value)">${body}</select>`;
}
function _xlTestSet(k,v){
  _xlUi.test=_xlUi.test||{};
  _xlUi.test[k]=(v==='true')?true:(v==='false')?false:v;
  if(k==='source') _xlUi.test.code='';      // the code list depends on the source
  xlmapRender();
}
function _xlRunTest(){ const o=document.getElementById('xl-test-out'); if(o) o.innerHTML=_xlTestOutHTML(); }

function _xlTestOutHTML(){
  if(!XLMAP) xlmapLoad();
  const t=_xlUi.test||{};
  if(!t.source) return '';
  const row={ship_pt:t.code,material:t.material,sold_to:t.sold_to,ship_type:t.ship_type};
  const res=xlmapTranslate(row);
  const dp=res.action==='ignore'?null:xlmapFindDp(res.finalName);
  const fac=_xlFacForSource(t.source,t.code);
  const line=(l,v,c)=>`<div style="font-family:var(--mono);font-size:9px;margin:2px 0"><span style="color:var(--text-dim);display:inline-block;width:78px">${l}</span><span style="color:${c||'var(--text)'}">${esc(v)}</span></div>`;
  let h=`<div style="border:1px solid var(--border2);background:var(--surface2);padding:10px 12px">`;
  // The demand point itself — in names, then the codes that produced it.
  h+=`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">
    <span style="font-family:var(--mono);font-size:13px;font-weight:700;color:${res.mapped?'var(--green)':'var(--amber)'}">${esc(res.finalName)||'(nothing composed)'}</span>
    ${dp?`<span title="This demand point is already in the topology" style="font-family:var(--mono);font-size:10px;color:var(--green)">✓ in the topology</span>`
        :(res.action==='ignore'?'':`<span style="font-family:var(--mono);font-size:10px;color:var(--amber)">✗ not in the topology</span>`)}
    <span class="tbl-act" title="Copy the name, ready to paste into the topology" onclick="_xlCopyName('${esc(res.finalName).replace(/'/g,"\\'")}')">⧉ copy</span>
    ${(!dp&&fac&&res.mapped&&res.action!=='ignore')?`<span class="tbl-act" style="color:var(--green)" title="Add this demand point to the topology at ${esc(fac.name)}" onclick="_xlCreateInTopology()">+ create at ${esc(fac.name)}</span>`:''}
    ${fac?`<span class="tbl-act" onclick="openFacilityInTopology('${fac.id}',${dp?`'${dp.id}'`:'null'})">open ${esc(fac.name)} in topology →</span>`:''}
  </div>`;
  h+=`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:${(!dp&&fac&&res.mapped&&res.action!=='ignore')?'3':'8'}px">
    in codes: ${esc([t.code||'—',_xlShownCode(t.material)||'—',t.sold_to||'—',t.ship_type||'—'].join('  ·  '))}</div>`;
  if(!dp&&fac&&res.mapped&&res.action!=='ignore'){
    const spot=_xlSpotFor(fac);
    h+=`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:8px">
      create puts it ${esc(spot.where)} — the canvas jumps there with it selected and ringed${_xlProductIdFor(t.material,t.code)?', product already set':', no catalog product matches it yet'}. Connecting it to a silo stays yours.</div>`;
  }
  res.trace.forEach(x=>h+=line(x.t,x.r));
  // Whether the SAP script actually asks for this ship point, and what came back
  const sap=_xlSapInfo(t.code,_xlSapStatus());
  if(sap) h+=`<div style="font-family:var(--mono);font-size:9px;margin:2px 0" title="${esc(sap.tip)}"><span style="color:var(--text-dim);display:inline-block;width:78px">SAP pull</span><span style="color:${sap.c}">ship point ${esc(t.code)}: ${esc(sap.t)}</span></div>`;
  (res.warn||[]).forEach(w=>h+=`<div style="font-family:var(--mono);font-size:9px;color:var(--amber);margin:4px 0 2px">⚠ ${esc(w)}
    ${res.catalogId?`<span class="tbl-act" onclick="_xlEditProduct('${esc(res.catalogId)}')">set it →</span>`:''}</div>`);
  if(res.name!==res.finalName) h+=line('composed',res.name,'var(--text-dim)');
  if(res.action==='skip')   h+=line('action','not demand — skipped (material row)','var(--amber)');
  if(res.action==='park')   h+=line('action','parked — kept out of demand (movement rule)','var(--amber)');
  if(res.action==='ignore') h+=line('action','ignored (alias rule)','var(--amber)');
  if(res.missing.length){
    h+=`<div style="margin-top:8px;padding-top:7px;border-top:1px solid var(--border)">`;
    res.missing.forEach(m=>h+=`<div style="font-family:var(--mono);font-size:9px;color:var(--amber)">⚠ ${esc(m)}</div>`);
    h+=`</div>`;
  }
  if(dp){
    const dfac=(DB.facilities||[]).find(f=>f.id===(dp.assigned_facility_id||dp.facility_id));
    h+=`<div style="margin-top:8px;padding-top:7px;border-top:1px solid var(--border);font-family:var(--mono);font-size:9px;color:var(--green)">
      ✓ ${esc(dp.id)}${dfac?' at '+esc(dfac.name):''} — an import would land here</div>`;
  }
  return h+`</div>`;
}
// The builder's 'cat:<id>' picks shown as the SAP code a real row would carry.
function _xlShownCode(v){
  const s=String(v||''); if(!s.startsWith('cat:')) return s;
  const p=(DB.products||[]).find(x=>x.id===s.slice(4)), k=p&&_xlCatCodes(p.material_code)[0];
  return k?k.sap:'no SAP code';
}
function _xlCopyName(name){
  const done=()=>statMsg('Copied — paste it as the demand point name in the topology');
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(name).then(done,()=>_xlCopyFallback(name,done)); }
    else _xlCopyFallback(name,done);
  }catch(e){ _xlCopyFallback(name,done); }
}
// Where a new demand point would land. Said out loud BEFORE the button is
// pressed, because an element that appears somewhere unknown on a canvas this
// size is an element you have lost.
function _xlSpotFor(fac){
  const canvas=(typeof mainCanvasFacilityId==='function')?mainCanvasFacilityId():null;
  const placed=e=>typeof e.x==='number'&&typeof e.y==='number';
  const all=(DB.elements||[]).filter(e=>e.facility_id===canvas&&placed(e));
  const mine=(DB.elements||[]).filter(e=>(e.assigned_facility_id||e.facility_id)===fac.id&&placed(e));
  const free=(x,y)=>!all.some(e=>Math.abs(e.x-x)<60&&Math.abs(e.y-y)<50);
  const settle=(x,y,where)=>{ let n=0; while(!free(x,y)&&n<40){ x+=90; n++; } return {x,y,where}; };
  const dps=mine.filter(e=>e.type==='demand_point');
  if(dps.length){ const low=dps.reduce((a,b)=>b.y>a.y?b:a);
    return settle(low.x,low.y+80,`under ${fac.name}'s other demand points`); }
  if(mine.length){ const low=mine.reduce((a,b)=>b.y>a.y?b:a);
    return settle(low.x,low.y+90,`just below the ${fac.name} elements`); }
  if(all.length){ const right=all.reduce((a,b)=>b.x>a.x?b:a);
    return settle(right.x+150,150,`to the right of everything on the canvas — ${fac.name} has nothing on it yet`); }
  return {x:220,y:200,where:'on the empty canvas'};
}
// The catalog product behind a material code, matched the way the check is: the
// catalog keeps product and pack in one name, the material table keeps them apart.
// A table name that drifted from the catalog's ("MIA_I/II" vs "MIA_I-II") still
// finds its product through the catalog's own SAP code.
function _xlProductIdFor(materialCode, shipPt){
  const code=String(materialCode||'').trim();
  if(code.startsWith('cat:')) return (DB.products||[]).some(p=>p.id===code.slice(4))?code.slice(4):null;
  const byCode=()=>{ const c=_xlCatalogProductsFor(code, shipPt); return c.length===1?c[0].id:null; };
  const m=(XLMAP.materials||[]).find(r=>String(r.code||'').trim()===code);
  if(!m||!m.product) return m?null:byCode();
  const want=_xlNorm(m.product), packed=_xlNorm(m.product+'/'+(m.pres||''));
  const ps=DB.products||[];
  return (ps.find(p=>_xlNorm(p.name)===packed)||ps.find(p=>_xlNorm(p.name)===want)
        ||ps.find(p=>_xlNorm(p.name).startsWith(want+'/')))?.id||byCode();
}
// Open the catalog editor on one product (the Material Code field is what Demand Mapping reads).
function _xlEditProduct(pid){
  const i=(DB.products||[]).findIndex(p=>p.id===pid); if(i<0) return;
  if(typeof editProduct==='function') editProduct(i);
  setTimeout(()=>{ const f=document.getElementById('pm-code'); if(f){ f.focus(); f.style.outline='2px solid var(--amber)'; } },80);
}
function _xlCenterOn(el){
  const svg=document.getElementById('topo-svg'); if(!svg||!S.topoView) return;
  const r=svg.getBoundingClientRect(); if(!r.width) return;
  const k=Math.max(0.6,Math.min(1.4,S.topoView.k||1));
  S.topoView={k, x:r.width/2-el.x*k, y:r.height/2-el.y*k};
  _applyTopoView();
}
// A ring that pulses three times where the element landed.
function _xlFlash(el){
  const layer=document.getElementById('el-layer'); if(!layer) return;
  const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
  c.setAttribute('cx',el.x); c.setAttribute('cy',el.y); c.setAttribute('r','22');
  c.setAttribute('fill','none'); c.setAttribute('stroke','var(--green)'); c.setAttribute('stroke-width','2');
  c.style.pointerEvents='none';
  const a=document.createElementNS('http://www.w3.org/2000/svg','animate');
  a.setAttribute('attributeName','r'); a.setAttribute('values','18;42;18');
  a.setAttribute('dur','1.1s'); a.setAttribute('repeatCount','3');
  c.appendChild(a); layer.appendChild(c);
  setTimeout(()=>c.remove(),3600);
}
// Create the demand point the bench just built, at its facility, and take the
// user to it: selected, centred, ringed. Connecting it to a silo stays manual —
// that is the one decision the mapping cannot make.
function _xlCreateInTopology(){
  const t=_xlUi.test||{}; if(!t.source) return;
  const res=xlmapTranslate({ship_pt:t.code,material:t.material,sold_to:t.sold_to,ship_type:t.ship_type});
  if(!res.mapped){ statMsg('Fill the gaps in the tables first — this row cannot be placed yet'); return; }
  if(res.action==='ignore'){ statMsg('An alias rule ignores this name — nothing to create'); return; }
  if(xlmapFindDp(res.finalName)){ statMsg('That demand point is already in the topology'); return; }
  const fac=_xlFacForSource(t.source,t.code);
  if(!fac){ statMsg(`No facility named ${t.source} here — add it first in Configuration → Organization`); return; }
  const spot=_xlSpotFor(fac);
  const id=`el_${++S.elCounter}`;
  const el={id, facility_id:(typeof mainCanvasFacilityId==='function')?mainCanvasFacilityId():S.facility_id,
    assigned_facility_id:fac.id, type:'demand_point', x:spot.x, y:spot.y, name:res.finalName,
    props:{}, state:'idle', maintenanceEvents:[], productCapacities:[], is_active:true};
  DB.elements.push(el);
  const pid=_xlProductIdFor(t.material,t.code);
  (DB.demand_points=DB.demand_points||[]).push({
    id:`dp_el_${id}`, facility_id:fac.id, element_id:id, element_name:res.finalName,
    products:pid?[{product_id:pid,priority:1}]:[], mode:'Fixed Daily', daily_tonnage:0,
    objective:'Meet Demand Only', rolling_days:30});
  autoSave();
  // A facility filtered out of the canvas would hide the thing we just made.
  if(S.topoFacFilter&&S.topoFacFilter.size&&!S.topoFacFilter.has(fac.id)) S.topoFacFilter.add(fac.id);
  switchView('topology');
  if(typeof renderTopoCanvas==='function') renderTopoCanvas();
  setTimeout(()=>{ _xlCenterOn(el); if(typeof selectEl==='function') selectEl(id); _xlFlash(el); },60);
  statMsg(`${res.finalName} created at ${fac.name}, ${spot.where}${pid?'':' — no catalog product matched, set one in the panel'}`);
}
function _xlCopyFallback(name,done){
  const ta=document.createElement('textarea');
  ta.value=name; ta.style.cssText='position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); done(); }catch(e){ statMsg('Could not copy — the name is '+name); }
  ta.remove();
}
// Check the tables against the scenario that is open. Nothing here blocks an
// import — it is a to-do list, sorted so the big problems are the first ones.
function _xlCheck(){
  const out=[];
  const dup=(tbl,label)=>{ const seen=new Set();
    (XLMAP[tbl]||[]).forEach(r=>{ const k=_xlNorm(r.code); if(!k) return;
      if(seen.has(k)) out.push({lvl:'bad',t:`${label} ${r.code} appears more than once — the first row wins`}); seen.add(k); }); };
  dup('ship_points','Ship point'); dup('materials','Material');
  (XLMAP.materials||[]).forEach(r=>{ if(!r.product) out.push({lvl:'bad',t:`Material ${r.code} has no product — its rows cannot be placed`}); });
  (XLMAP.ship_points||[]).forEach(r=>{ if(!r.source) out.push({lvl:'bad',t:`Ship point ${r.code} has no source`}); });
  // The catalog keeps product and pack in one name ("MIA_SPC/PAK"); the material
  // table keeps them apart. Compare both ways, or the check cries wolf 30 times.
  const prodNames=[...new Set((DB.products||[]).map(p=>_xlNorm(p.name)))];
  const prodKnown=(prod,pres)=>{ const n=_xlNorm(prod); if(!n) return true;
    return prodNames.some(x=>x===n||x===n+'/'+_xlNorm(pres)||x.startsWith(n+'/')); };
  const badProd=[...new Set((XLMAP.materials||[]).filter(r=>r.product&&!prodKnown(r.product,r.pres))
    .map(r=>r.product+(r.pres?'/'+r.pres:'')))];
  badProd.forEach(p=>out.push({lvl:'info',t:`Product "${p}" is not in this scenario's catalog`}));
  const facNames=new Set((DB.facilities||[]).map(f=>_xlNorm(f.name)));
  const badSrc=[...new Set((XLMAP.ship_points||[]).map(r=>r.source).filter(s=>s&&!facNames.has(_xlNorm(s))))];
  badSrc.forEach(s=>out.push({lvl:'info',t:`Source "${s}" is not a facility in this scenario`}));
  (XLMAP.aliases||[]).forEach(a=>{ if(a.action!=='ignore'&&a.to&&!xlmapFindDp(a.to))
    out.push({lvl:'bad',t:`Alias target "${a.to}" is not a demand point in this scenario`}); });
  _xlCatalogCoverage().forEach(c=>{
    if(c.kind==='nocode') out.push({lvl:'bad',t:`${c.name} is in the topology but has no SAP material code (Configuration → Products) — its sales cannot be placed`});
    if(c.kind==='drift')  out.push({lvl:c.dpCatalog&&!c.dpTable?'bad':'info',
      t:`Material ${c.sap} is ${c.tableName} here but ${c.name} in the catalog${c.dpCatalog&&!c.dpTable?' — its demand points carry the catalog name, so sales miss them':''}`});
  });
  const rank={bad:0,info:1};
  out.sort((a,b)=>rank[a.lvl]-rank[b.lvl]);
  _xlUi.check=out.length?out:[{lvl:'ok',t:'Nothing to fix against the scenario that is open.'}];
  xlmapRender();
}
function _xlExport(){
  const blob=new Blob([JSON.stringify(XLMAP,null,1)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='avila_demand_map.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  statMsg('Demand mapping exported');
}
function _xlImport(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.json';
  inp.onchange=async()=>{
    const f=inp.files&&inp.files[0]; if(!f) return;
    try{
      const obj=JSON.parse(await f.text());
      if(!obj||typeof obj!=='object') throw new Error('not a mapping file');
      ['format','catalog_materials','rules_id','tables_id','tables_edited_at','saved_at','saved_at_local','scenario'].forEach(k=>delete obj[k]);
      localStorage.setItem(XLMAP_KEY, JSON.stringify(obj));
      xlmapLoad(); xlmapSave(`Demand mapping loaded from ${f.name}`); xlmapRender();
    }catch(e){ statMsg('That file is not a demand mapping'); }
  };
  inp.click();
}
function _xlReset(){
  if(!confirm('Reset every mapping table to the values seeded from the source workbook? Your edits are lost.')) return;
  XLMAP=xlmapDefaults(); xlmapSave('Demand mapping reset'); xlmapRender();
}

function xlmapPanelHTML(){
  if(!XLMAP) xlmapLoad();
  const nDp=(DB.elements||[]).filter(e=>e.type==='demand_point').length;
  const chk=_xlUi.check||[];
  const chkColor=l=>l==='bad'?'var(--amber)':l==='ok'?'var(--green)':'var(--text-dim)';
  const noCode=_xlCatalogCoverage().filter(c=>c.kind==='nocode');
  return `
  <datalist id="xl-prodlist">${(DB.products||[]).map(p=>`<option value="${esc(p.name)}">`).join('')}</datalist>
  <datalist id="xl-preslist"><option value="BLK"><option value="PAK"></datalist>
  <datalist id="xl-dplist">${(DB.elements||[]).filter(e=>e.type==='demand_point').map(e=>`<option value="${esc(e.name)}">`).join('')}</datalist>
  <div style="padding:14px 16px">
    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
      <div style="flex:1">
        <div style="font-family:var(--mono);font-size:10px;color:var(--text);font-weight:700;letter-spacing:.5px;margin-bottom:3px">SAP SALES → DEMAND POINTS</div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);line-height:1.5">
          The export is the truth; these tables are the translation. Shared across every scenario — editing them here changes nothing in the scenario file.
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;white-space:nowrap">
        <span class="tbl-act" onclick="_xlCheck()">Check against this scenario</span>
        <span class="tbl-act" onclick="_xlExport()">Export</span>
        <span class="tbl-act" onclick="_xlImport()">Import</span>
        <span class="tbl-act del" onclick="_xlReset()">Reset</span>
      </div>
    </div>

    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;padding:9px 12px;border:1px solid var(--border);background:var(--surface)">
      <span style="font-family:var(--mono);font-size:8px;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase">Name format</span>
      <input class="fi" style="flex:1;padding:4px 7px;font-size:10px" value="${esc(XLMAP.template||'')}"
        onchange="XLMAP.template=this.value;xlmapSave('Name format saved');_xlRunTest()">
      <span style="font-family:var(--mono);font-size:8px;color:var(--text-dim)">{source} {movement} {product} {presentation} {class}</span>
    </div>

    <div style="border:1px solid var(--border);background:var(--surface);margin-bottom:12px">${_xlFolderRulesHTML()}</div>

    ${noCode.length?`<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;padding:8px 12px;border:1px solid var(--amber);background:var(--surface);font-family:var(--mono);font-size:9px">
      <span style="color:var(--amber)">⚠ ${noCode.length} product${noCode.length===1?'':'s'} in the topology ${noCode.length===1?'has':'have'} no SAP material code, so ${noCode.length===1?'its':'their'} SAP sales cannot be placed:</span>
      <span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${esc(noCode.map(c=>c.name).join(', '))}</span>
      <span class="tbl-act" style="margin:0" onclick="_xlUi.open.mat=true;xlmapRender();document.getElementById('xl-card-mat')?.scrollIntoView({block:'start'})">review →</span>
    </div>`:''}

    ${chk.length?`<div style="border:1px solid var(--border);background:var(--surface);margin-bottom:12px;padding:9px 12px">
      <div style="font-family:var(--mono);font-size:8px;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase;margin-bottom:5px">Check — ${chk.filter(c=>c.lvl==='bad').length} to fix</div>
      ${chk.slice(0,12).map(c=>`<div style="font-family:var(--mono);font-size:9px;color:${chkColor(c.lvl)};margin:2px 0">${c.lvl==='bad'?'⚠':c.lvl==='ok'?'✓':'·'} ${esc(c.t)}</div>`).join('')}
      ${chk.length>12?`<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:3px">· and ${chk.length-12} more</div>`:''}
    </div>`:''}

    ${_xlCard('src','Source file','the SAP sales export this reads, and what it would land',(window._dsDemandPreview?Number(window._dsDemandPreview.rows).toLocaleString()+' rows':'not bound'),_xlSourceBody())}
    ${_xlCard('test','Build a demand point','pick by name and see the code, the rules, and whether it exists',nDp+' demand points',_xlTestBody())}
    ${_xlCard('ship','Ship points','which facility a sale shipped from — and what the SAP script asks for',(XLMAP.ship_points||[]).length,_xlShipBody())}
    ${_xlCard('mat','Materials','material code → product and pack',(XLMAP.materials||[]).length,_xlMatBody())}
    ${_xlCard('cls','Customer class','how the Sold-To becomes INT / EXT / IND / LKHT',(XLMAP.class_rules||[]).length,_xlClsBody())}
    ${_xlCard('mov','Movement','what each ship type means',(XLMAP.movements||[]).length,_xlMovBody())}
    ${_xlCard('ali','Demand point aliases','when the composed name and the demand point differ',(XLMAP.aliases||[]).length,_xlAliBody())}
    ${_xlCard('rep','Sales reps','Ship-To → rep, for the Detail file and the Sales page',(XLMAP.sales_reps||[]).length,_xlRepBody())}
  </div>`;
}
function xlmapRender(){
  const p=document.getElementById('cfg-panel-demandmap');
  if(p) p.innerHTML=xlmapPanelHTML();
}

// ── Data Sources panel HTML (injected into Configure modal) ──
function dsCfgPanelHTML(){
  const supported = ('showOpenFilePicker' in window);
  if(!supported){
    return `<div style="padding:16px">
      <div style="font-family:var(--mono);font-size:9px;color:var(--amber);padding:10px;background:rgba(var(--amber-rgb),.06);border:1px solid rgba(var(--amber-rgb),.2);margin-bottom:12px">
        ⚠ File System Access API is not supported in this browser. Use Chrome or Edge for auto-refresh functionality.
      </div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:12px">
        You can still load files manually using the ↑ Load Actuals button on the Sales page.
      </div>
      ${exportDirHTML('results')}
      ${exportDirHTML('bi')}
      ${exportDirHTML('sof')}
    </div>`;
  }
  return `<div style="padding:14px 16px">
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:12px;line-height:1.7">
      Configure a file path for each data source. The app will automatically refresh these files on startup and when you click Refresh.
      Files are read directly from your local disk — nothing is uploaded to any server.
    </div>
    ${exportDirHTML('results')}
    ${exportDirHTML('bi')}
    ${exportDirHTML('sof')}
    ${DS_SLOTS.map(s=>dsBuildSlotHTML(s)).join('')}
    <div style="margin-top:12px;display:flex;justify-content:flex-end">
      <button class="btn-pri" onclick="dsAutoRefreshAll();statMsg('Refreshing all data sources…')">↻ Refresh All</button>
    </div>
  </div>`;
}


// ── AI Agent config panel HTML ──
function aiCfgPanelHTML(){
  const keySet=!!getApiKey();
  const model=localStorage.getItem('avila_ai_model')||'claude-haiku-4-5-20251001';
  const row=(label,content)=>`
    <div style="display:grid;grid-template-columns:140px 1fr;align-items:start;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);padding-top:2px">${label}</div>
      <div>${content}</div>
    </div>`;
  return `<div style="padding:14px 16px">
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-bottom:14px;line-height:1.7">
      Connect AVILA Roll to Anthropic's Claude API for AI-assisted planning. Your key is stored only in this browser and sent directly to Anthropic — never to any other server.
    </div>
    ${row('API Key',`
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;gap:6px;align-items:center" id="ai-key-input-row" ${keySet?'style="display:none!important"':''}>
          <input id="ai-cfg-key-in" type="password" placeholder="sk-ant-api03-..." autocomplete="off"
            style="flex:1;background:var(--surface2);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:9px;padding:5px 8px;outline:none"/>
          <button class="btn-pri" onclick="aiSaveKey()" style="white-space:nowrap;padding:5px 12px">Set Key</button>
        </div>
        <div id="ai-key-set-row" style="display:${keySet?'flex':'none'};align-items:center;gap:10px">
          <span style="font-family:var(--mono);font-size:9px;color:var(--green)">✓ API key configured${!localStorage.getItem('avila_api_key')&&localStorage.getItem('avila_api_key_shared')?` — from the shared file <b>${esc(localStorage.getItem('avila_api_key_shared_file')||'')}</b>`:''}</span>
          <button class="btn-sec" onclick="aiClearKey()" style="padding:3px 8px;font-size:8px">Clear</button>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn-sec" onclick="aiPickSharedKey()" style="padding:3px 8px;font-size:8px">📄 Use shared key file…</button>
          <span style="font-family:var(--mono);font-size:8px;color:var(--text-dim)">Pick the team's key .txt on SharePoint once — when the key there is changed, the app picks up the new one.</span>
        </div>
      </div>`)}
    ${row('Model',`
      <div style="display:flex;flex-direction:column;gap:4px">
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:6px;border:1px solid ${model==='claude-haiku-4-5-20251001'?'var(--green)':'var(--border2)'};background:${model==='claude-haiku-4-5-20251001'?'var(--green-faint)':'transparent'}" onclick="aiSetModel('claude-haiku-4-5-20251001')">
          <input type="radio" name="ai-model" value="claude-haiku-4-5-20251001" ${model==='claude-haiku-4-5-20251001'?'checked':''} style="margin-top:1px;accent-color:var(--green)"/>
          <div><div style="font-family:var(--mono);font-size:9px;color:var(--text);font-weight:700">Haiku 4.5 — Fast</div>
          <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:2px">Best for quick questions. Very low cost (~$0.001/message).</div></div>
        </label>
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:6px;border:1px solid ${model==='claude-sonnet-4-6'?'var(--green)':'var(--border2)'};background:${model==='claude-sonnet-4-6'?'var(--green-faint)':'transparent'}" onclick="aiSetModel('claude-sonnet-4-6')">
          <input type="radio" name="ai-model" value="claude-sonnet-4-6" ${model==='claude-sonnet-4-6'?'checked':''} style="margin-top:1px;accent-color:var(--green)"/>
          <div><div style="font-family:var(--mono);font-size:9px;color:var(--text);font-weight:700">Sonnet 4.6 — Smart</div>
          <div style="font-family:var(--mono);font-size:8px;color:var(--text-dim);margin-top:2px">Better reasoning for complex planning analysis.</div></div>
        </label>
      </div>`)}
    ${row('Connection',`
      <div style="display:flex;align-items:center;gap:10px">
        <button class="btn-sec" onclick="aiTestConnection()" style="padding:5px 12px">Test Connection</button>
        <span id="ai-test-result" style="font-family:var(--mono);font-size:8px;color:var(--text-dim)"></span>
      </div>`)}
  </div>`;
}

async function aiTestConnection(){
  const key=getApiKey();
  const resultEl=document.getElementById('ai-test-result');
  if(!key){resultEl.style.color='var(--amber)';resultEl.textContent='No API key set.';return;}
  resultEl.style.color='var(--text-dim)';resultEl.textContent='Testing…';
  try{
    const data=await callClaude({model:'claude-haiku-4-5-20251001',maxTokens:10,messages:[{role:'user',content:'ping'}]});
    if(data.error){resultEl.style.color='var(--red)';resultEl.textContent='Error: '+data.error.message;}
    else{resultEl.style.color='var(--green)';resultEl.textContent='✓ Connected';}
  }catch(e){resultEl.style.color='var(--red)';resultEl.textContent='Failed: '+e.message;}
}

function aiSaveKey(){
  const k=document.getElementById('ai-cfg-key-in')?.value.trim();
  if(!k) return;
  localStorage.setItem('avila_api_key',k);
  document.getElementById('ai-cfg-key-in').value='';
  document.getElementById('ai-key-input-row').style.display='none';
  document.getElementById('ai-key-set-row').style.display='flex';
  updateKeyUI();
  const el=document.getElementById('ai-test-result');
  if(el){el.style.color='var(--green)';el.textContent='Key saved.';}
}

function aiClearKey(){
  localStorage.removeItem('avila_api_key');
  localStorage.removeItem('avila_api_key_shared'); localStorage.removeItem('avila_api_key_shared_file');
  scDeleteHistoryDirHandle('__ai_key_file__');
  document.getElementById('ai-key-input-row').style.display='flex';
  document.getElementById('ai-key-set-row').style.display='none';
  updateKeyUI();
}

// ── Shared key file ── the team keeps one Claude API key in a .txt on SharePoint; each browser
// picks it once and keeps the file handle, so a rotated key is picked up without retyping.
function _aiKeyFromText(t){ const m=String(t||'').match(/sk-ant-[A-Za-z0-9_\-]+/); return m?m[0]:''; }
async function aiPickSharedKey(){
  if(!window.showOpenFilePicker){ alert('This browser cannot open files directly — use Chrome or Edge.'); return; }
  let h; try{ [h]=await window.showOpenFilePicker({id:'avila-ai-key', types:[{description:'Text file', accept:{'text/plain':['.txt']}}]}); }catch(e){ return; }
  const key=_aiKeyFromText(await (await h.getFile()).text());
  if(!key){ alert(`No Claude API key (sk-ant-…) found in ${h.name}.`); return; }
  localStorage.setItem('avila_api_key_shared',key); localStorage.setItem('avila_api_key_shared_file',h.name);
  localStorage.removeItem('avila_api_key');   // the shared file is now this browser's key
  await scSaveHistoryDirHandle('__ai_key_file__',h);
  renderCfgPanel('ai'); updateKeyUI();
  const el=document.getElementById('ai-test-result'); if(el){ el.style.color='var(--green)'; el.textContent='Key read from '+h.name+'.'; }
}
// Silent: re-reads the file when this browser still has permission (no prompt outside a click).
async function aiRefreshSharedKey(prompt){
  try{
    const h=await scLoadHistoryDirHandle('__ai_key_file__'); if(!h) return false;
    let perm=await h.queryPermission({mode:'read'});
    if(perm!=='granted'&&prompt) perm=await h.requestPermission({mode:'read'});
    if(perm!=='granted') return false;
    const key=_aiKeyFromText(await (await h.getFile()).text());
    if(key&&key!==localStorage.getItem('avila_api_key_shared')){ localStorage.setItem('avila_api_key_shared',key); updateKeyUI(); }
    return !!key;
  }catch(e){ return false; }
}
setTimeout(()=>aiRefreshSharedKey(false), 2000);

function aiSetModel(m){
  localStorage.setItem('avila_ai_model',m);
  // Re-render just the model rows by re-rendering the whole AI panel
  renderCfgPanel('ai');
}

// ═══════════════════════════════════════════════════════
// ACTUALS → DEMAND GRID
// ═══════════════════════════════════════════════════════
// Called after spIngestFile() completes.
// Aggregates DB.real_shipments_daily by Demand Point name + date,
// matches to demand_point elements by name, and writes to DB.demand_values
// with source:'actual' — overriding any existing value for past dates.
//
// The file is the truth for the past window of the origins it covers. Three cases:
//   • DP + day present in the file      → real tonnage, source:'actual'
//   • DP in the file, day absent        → explicit 0, source:'actual' (stale forecast overwritten)
//   • DP absent from the file entirely, → explicit 0 on every day it had a forecast,
//     but its ORIGIN is in the file       because "no shipments" is a real answer, not missing data
//   • DP whose origin the file never mentions → untouched (a partial export must not
//     wipe another plant's plan)

function dsWriteActualsToDemandGrid(){
  if(!DB.real_shipments_daily.length) return;

  const today = new Date()._ymd();

  // ── Aggregate by Demand Point name + date (past dates only) ───────────
  const aggByDpDate = {};          // key: `dpName|date` → total volume
  let winMin = null, winMax = null; // window = span the file actually covers
  const coveredOrigins = new Set(); // plant/terminal short names present in the file
  DB.real_shipments_daily.forEach(r=>{
    if(!r.product || !r.date || r.date > today) return;
    const key = r.product.trim() + '|' + r.date;
    aggByDpDate[key] = (aggByDpDate[key]||0) + r.volume;
    if(winMin === null || r.date < winMin) winMin = r.date;
    if(winMax === null || r.date > winMax) winMax = r.date;
    // r.origin is the first segment of INV_ROLL_NAME (CEMEX) or the Abrev column (new
    // format); fall back to the DP name's own prefix when the origin column is blank.
    const orig = ((r.origin||'').trim() || String(r.product).split('/')[0] || '').toUpperCase();
    if(orig) coveredOrigins.add(orig);
  });
  if(!Object.keys(aggByDpDate).length) return;

  // ── Build lookup: dpName (upper) → element_id ─────────────────────────
  // Direct match on el.name — topology elements are now named to match Excel exactly
  // Also accepts explicit dp_code override on el.props
  const dpEls = DB.elements.filter(e=>e.type==='demand_point');
  if(!dpEls.length) return;

  const dpNameMap = {};
  dpEls.forEach(el=>{
    const k = (el.name||'').trim().toUpperCase();
    if(k) dpNameMap[k] = el.id;
    const code = (el.props?.dp_code||'').trim().toUpperCase();
    if(code) dpNameMap[code] = el.id; // explicit override wins
  });

  // ── Determine which demand points the file covers ─────────────────────
  const matchedElIds = new Set();
  const matchedDps = new Set(), unmatchedDps = new Set();
  Object.keys(aggByDpDate).forEach(key=>{
    const dpName = key.slice(0, key.lastIndexOf('|'));
    const elId   = dpNameMap[dpName.toUpperCase()];
    if(!elId){ unmatchedDps.add(dpName); return; }
    matchedElIds.add(elId); matchedDps.add(dpName);
  });

  // ── Widen scope to every DP whose ORIGIN the file covers ──────────────
  // A DP's origin is the first slash-segment of its dp_code (or name): BRS/DEM/… → BRS.
  // el.facility_id is NOT usable here — it holds the SUPPLYING plant, not the destination.
  // If no origin could be read from the file, this degenerates to matchedElIds.
  const dpOrigin = el => String(el.props?.dp_code || el.name || '').trim().split('/')[0].toUpperCase();
  const inScopeElIds = new Set(matchedElIds);
  let byOriginOnly = 0;
  dpEls.forEach(el=>{
    if(inScopeElIds.has(el.id)) return;
    const o = dpOrigin(el);
    if(o && coveredOrigins.has(o)){ inScopeElIds.add(el.id); byOriginOnly++; }
  });

  // ── Snapshot the days that currently carry a forecast inside the window ─
  // These are the days the file is about to contradict. ship_to-level and dp-level
  // rows collapse to one key, so a DP gets at most one zero per day.
  const hadForecast = new Set();
  (DB.demand_values||[]).forEach(v=>{
    if(!v.date || !inScopeElIds.has(v.element_id)) return;
    if(v.date < winMin || v.date > winMax) return;
    hadForecast.add(v.element_id + '|' + v.date);
  });

  // ── Clear the whole actuals window for in-scope DPs ───────────────────
  if(inScopeElIds.size){
    DB.demand_values = (DB.demand_values||[]).filter(v=>{
      if(!inScopeElIds.has(v.element_id)) return true;       // origin not in the file
      if(v.date < winMin || v.date > winMax) return true;    // outside window
      return false;                                          // inside window → drop
    });
  }

  // ── Write actuals into the cleared window ─────────────────────────────
  let written = 0;
  const writtenKeys = new Set();
  Object.entries(aggByDpDate).forEach(([key, vol])=>{
    const pipeIdx = key.lastIndexOf('|');
    const dpName  = key.slice(0, pipeIdx);
    const date    = key.slice(pipeIdx + 1);
    const elId    = dpNameMap[dpName.toUpperCase()];
    if(!elId) return;
    if(vol > 0){
      DB.demand_values.push({
        element_id: elId, date,
        value_t: Math.round(vol * 10) / 10,
        source: 'actual'
      });
      written++;
      writtenKeys.add(elId + '|' + date);
    }
  });

  // ── Overwrite every contradicted forecast with an explicit 0 ──────────
  // Recorded as a real actual (not just a deleted row) so the grid can show a
  // green read-only 0 — "the file says nothing shipped" reads differently from
  // "nobody ever forecast this day".
  let zeroed = 0;
  hadForecast.forEach(k=>{
    if(writtenKeys.has(k)) return;
    const i = k.indexOf('|');
    DB.demand_values.push({ element_id: k.slice(0, i), date: k.slice(i + 1), value_t: 0, source: 'actual' });
    zeroed++;
  });

  // ── Warn about Excel DPs with no topology match ───────────────────────
  const warnEl = document.getElementById('dem-actuals-warn');
  if(warnEl){
    const unmatched = [...unmatchedDps].sort();
    if(unmatched.length){
      warnEl.style.display = 'block';
      warnEl.innerHTML =
        '<span style="color:var(--amber);font-weight:700">⚠ ' + unmatched.length +
        ' demand point' + (unmatched.length > 1 ? 's' : '') +
        ' in the sales file have no matching topology element — add them to the topology to see actuals:</span> ' +
        '<span style="color:var(--text-dim);font-size:8px">' + unmatched.join(' · ') + '</span>';
    } else {
      warnEl.style.display = 'none';
    }
  }

  autoSave();
  console.log('dsWriteActualsToDemandGrid:', written, 'actuals written,', zeroed, 'days zeroed,',
    byOriginOnly, 'DPs zeroed by origin (absent from file),', unmatchedDps.size, 'unmatched DPs',
    '· window', winMin, '→', winMax);
  if(unmatchedDps.size) console.log('Unmatched:', [...unmatchedDps]);
  statMsg('Demand grid — ' + written + ' actuals written · ' + zeroed + ' days zeroed'
    + (byOriginOnly ? ' (' + byOriginOnly + ' DPs with no shipments)' : '')
    + (unmatchedDps.size ? ' · ' + unmatchedDps.size + ' unmatched DPs' : ''));

  // Refresh demand view so actuals appear immediately
  _demandCacheInvalidate();
  renderDemandView();
}


