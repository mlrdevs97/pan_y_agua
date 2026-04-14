// ═══════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════
const SUBS = {recetas:'Recetario', amasado:'T° del agua de amasado', mezcla:'Mezcla fría / caliente'};

// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════
let recipes = [];
let activeId = null;
let editingId = null;
let rFlours=[], rIngs=[], rElabs=[];
let rFId=0, rIId=0, rEId=0, rEIId=0;
let aIngs=[], aIngId=0;
let pendingMezclaTemp=null;
let pendingAmasado=null;
// active result tab
let resTab=0;
// last calc result (for tab switching)
let lastCalc=null;

// ═══════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════
function save(){ try{ localStorage.setItem('pan_v4', JSON.stringify(recipes)); }catch(e){} }
function load(){ try{ const d=localStorage.getItem('pan_v4'); if(d) recipes=JSON.parse(d); }catch(e){ recipes=[]; } }

function importJSON(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json';
  inp.onchange=e=>{
    const file=e.target.files[0]; if(!file) return;
    const fr=new FileReader();
    fr.onload=ev=>{
      try{
        const data=JSON.parse(ev.target.result);
        const arr=Array.isArray(data)?data:[data];
        let n=0;
        arr.forEach(r=>{ if(!r.name) return; if(!r.id) r.id=uid(); const i=recipes.findIndex(x=>x.id===r.id); if(i>=0) recipes[i]=r; else recipes.push(r); n++; });
        save(); renderList(); if(n) alert(n+' receta(s) importada(s).');
      }catch(e){ alert('JSON no válido.'); }
    };
    fr.readAsText(file);
  };
  inp.click();
}

function exportCurrent(){
  const r=recipes.find(x=>x.id===activeId); if(!r) return;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)],{type:'application/json'}));
  a.download=(r.name||'receta').replace(/\s+/g,'_')+'.json'; a.click();
}

// ═══════════════════════════════════════
// TABS
// ═══════════════════════════════════════
function switchTab(name){
  ['recetas','amasado','mezcla'].forEach(t=>{
    document.getElementById('page_'+t).classList.toggle('active',t===name);
    document.getElementById('nav_'+t).classList.toggle('active',t===name);
  });
  document.getElementById('topbar_sub').textContent=SUBS[name];
  if(name==='amasado') aCalc();
  if(name==='mezcla' && pendingMezclaTemp!==null){
    const tc=parseFloat(document.getElementById('m_tc').value)||0;
    const th=parseFloat(document.getElementById('m_th').value)||100;
    const cl=Math.max(tc+0.5,Math.min(th-0.5,pendingMezclaTemp));
    document.getElementById('m_sl').value=cl.toFixed(1);
    pendingMezclaTemp=null;
    mRangeUpdate(); mCalc();
  }
}

// ═══════════════════════════════════════
// RECIPE LIST
// ═══════════════════════════════════════
function renderList(){
  const el=document.getElementById('recipe_list_el');
  document.getElementById('rc_count').textContent=recipes.length+' receta'+(recipes.length===1?'':'s');
  if(!recipes.length){
    el.innerHTML=`<div class="empty-state">🍞<br><br>Aún no tienes recetas guardadas.<br>Pulsa <strong>Nueva</strong> para crear la primera.</div>`;
    return;
  }
  el.innerHTML=recipes.map(r=>{
    const fn=(r.flours||[]).map(f=>f.name).filter(Boolean).join(' + ')||'—';
    const hw=getHydration(r); const hStr=hw?'Hid. '+hw.toFixed(0)+'%':'';
    const elabStr=(r.elabs||[]).length?(r.elabs||[]).map(e=>e.name).join(', '):'';
    const meta=[fn,hStr,elabStr].filter(Boolean).join(' · ');
    return `<div class="recipe-item${r.id===activeId?' sel':''}" onclick="selectRecipe('${r.id}')">
      <div class="ri-icon">🍞</div>
      <div style="flex:1;min-width:0"><div class="ri-name">${esc(r.name)}</div><div class="ri-meta">${esc(meta)}</div></div>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>`;
  }).join('');
}

function getHydration(r){
  const w=(r.ings||[]).find(i=>/^agua$/i.test((i.name||'').trim()));
  return w?parseFloat(w.pct)||0:null;
}

function selectRecipe(id){ activeId=id; renderList(); showDetail(); }
function showList(){ document.getElementById('v_list').style.display=''; document.getElementById('v_detail').style.display='none'; }
function showDetail(){ document.getElementById('v_list').style.display='none'; document.getElementById('v_detail').style.display=''; calcDetail(); }

// ═══════════════════════════════════════
// RECIPE CALC
// ═══════════════════════════════════════
function calcDetail(){
  const r=recipes.find(x=>x.id===activeId); if(!r) return;
  const pieces=parseInt(document.getElementById('d_pieces').value)||0;
  const unitW=parseFloat(document.getElementById('d_weight').value)||0;
  const errEl=document.getElementById('d_err');
  const resWrap=document.getElementById('d_res_wrap');
  errEl.classList.remove('show'); resWrap.style.display='none';

  document.getElementById('det_name').textContent=r.name;
  document.getElementById('det_meta').textContent=r.notes||'';

  if(!pieces||!unitW){ errEl.textContent='Introduce el número de piezas y el peso unitario.'; errEl.classList.add('show'); return; }

  const fsum=(r.flours||[]).reduce((s,f)=>s+(parseFloat(f.pct)||0),0);
  if(Math.abs(fsum-100)>0.01){ errEl.textContent='Las harinas suman '+fsum.toFixed(1)+'% (deben sumar exactamente 100%).'; errEl.classList.add('show'); return; }

  const totalMass=pieces*unitW;
  const otherPct=(r.ings||[]).reduce((s,i)=>s+(parseFloat(i.pct)||0),0);
  const flourG=totalMass/(1+otherPct/100);

  // Per-flour grams
  const fG={};
  (r.flours||[]).forEach(f=>{ fG[f.id]=flourG*(parseFloat(f.pct)||0)/100; });

  // Chips
  const chips=document.getElementById('d_chips');
  const hw=getHydration(r);
  chips.innerHTML='';
  if(hw) chips.innerHTML+=`<span class="tag tag-water">Hid. ${hw.toFixed(0)}%</span>`;
  (r.flours||[]).forEach(f=>chips.innerHTML+=`<span class="tag tag-flour">${esc(f.name)} ${(parseFloat(f.pct)||0).toFixed(0)}%</span>`);
  if((r.elabs||[]).length) chips.innerHTML+=`<span class="tag tag-elab">${(r.elabs||[]).length} elaboración${(r.elabs||[]).length>1?'es':''} previa${(r.elabs||[]).length>1?'s':''}</span>`;
  chips.innerHTML+=`<span style="font-size:.68rem;color:var(--text3)">${totalMass.toFixed(0)} g total</span>`;

  // ── ELABORACIONES: deduct map ──
  // deductMap[flourId] += grams going to elaboraciones
  // deductWater += total water going to elaboraciones
  // deductOther[ingId] += grams of other ings going to elaboraciones
  const deductF={}; // flourId → g
  let deductW=0;
  const deductO={}; // ingId → g
  const elabCalcs=[];

  (r.elabs||[]).forEach(elab=>{
    const elabIngs=[]; // {name, grams, type:'flour'|'water'|'other'}
    let elabTotal=0;

    (elab.ings||[]).forEach(ei=>{
      let grams=0;
      if(ei.type==='flour'){
        // pct of that specific flour's total grams
        const base=fG[ei.flourId]||0;
        grams=base*(parseFloat(ei.pct)||0)/100;
        deductF[ei.flourId]=(deductF[ei.flourId]||0)+grams;
        const fname=(r.flours||[]).find(f=>f.id===ei.flourId)?.name||'Harina';
        elabIngs.push({name:fname, grams, type:'flour', pctDesc:(parseFloat(ei.pct)||0).toFixed(1)+'% de '+fname});
      } else if(ei.type==='water'){
        // pct of THIS elaboration's own flour (sum of flour-type ings already pushed)
        const elabFlourG=elabIngs.filter(x=>x.type==='flour').reduce((s,x)=>s+x.grams,0);
        grams=elabFlourG*(parseFloat(ei.pct)||0)/100;
        deductW+=grams;
        elabIngs.push({name:'Agua', grams, type:'water', pctDesc:(parseFloat(ei.pct)||0).toFixed(1)+'% s/harina elaboración'});
      } else {
        // other: pct of total recipe flour, linked to an ing by id
        grams=flourG*(parseFloat(ei.pct)||0)/100;
        if(ei.ingId!=null) deductO[ei.ingId]=(deductO[ei.ingId]||0)+grams;
        const iname=(r.ings||[]).find(i=>i.id===ei.ingId)?.name||ei.name||'Ingrediente';
        elabIngs.push({name:iname, grams, type:'other', pctDesc:(parseFloat(ei.pct)||0).toFixed(1)+'% s/harina receta'});
      }
      elabTotal+=grams;
    });

    elabCalcs.push({name:elab.name, ings:elabIngs, total:elabTotal});
  });

  // ── PER-SECTION DATA ──

  // Section: each elaboration
  // Section: masa final
  // summaryRows: raw totals per ingredient, NO elaboration deductions
  const summaryRows=[];
  (r.flours||[]).forEach(f=>{
    const total=fG[f.id]||0;
    summaryRows.push({name:f.name, tag:'flour', pct:(parseFloat(f.pct)||0).toFixed(1)+'% base', grams:total});
  });
  (r.ings||[]).forEach(ing=>{
    const pct=parseFloat(ing.pct)||0;
    const total=flourG*pct/100;
    const isWater=/^agua$/i.test((ing.name||'').trim());
    summaryRows.push({name:ing.name, tag:isWater?'water':null, pct:pct.toFixed(2)+'%', grams:total});
  });

  // finalRows: each ingredient with elaboration deductions shown
  const finalRows=[];
  (r.flours||[]).forEach(f=>{
    const total=fG[f.id]||0;
    const ded=deductF[f.id]||0;
    finalRows.push({name:f.name, tag:'flour', pct:(parseFloat(f.pct)||0).toFixed(1)+'% base', total, ded, final:total-ded});
  });
  (r.ings||[]).forEach(ing=>{
    const pct=parseFloat(ing.pct)||0;
    const total=flourG*pct/100;
    const ded=deductO[ing.id]||0;
    const isWater=/^agua$/i.test((ing.name||'').trim());
    const waterDed=isWater?deductW:0;
    const totalDed=ded+waterDed;
    finalRows.push({name:ing.name, tag:isWater?'water':null, pct:pct.toFixed(2)+'%', total, ded:totalDed, final:total-totalDed});
  });

  // Cache for tab switching
  lastCalc={elabCalcs, finalRows, summaryRows, totalMass, flourG, deductW, r,
    amasadoData:buildAmasadoData(r, fG, deductF, deductW, deductO, flourG, elabCalcs)};

  resWrap.style.display='block';
  buildResTabs(elabCalcs);
  renderResTab(resTab);
}

function buildResTabs(elabCalcs){
  const nav=document.getElementById('d_res_nav');
  const tabs=['Resumen',...elabCalcs.map(e=>e.name),'Masa final'];
  resTab=Math.min(resTab,tabs.length-1);
  nav.innerHTML=tabs.map((t,i)=>`<button class="res-tab${i===resTab?' active':''}" onclick="setResTab(${i})">${esc(t)}</button>`).join('');
}

function setResTab(i){
  resTab=i;
  buildResTabs(lastCalc.elabCalcs);
  renderResTab(i);
  const nav=document.getElementById('d_res_nav');
  const activeBtn=nav.querySelectorAll('.res-tab')[i];
  if(activeBtn) activeBtn.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
}

function renderResTab(i){
  if(!lastCalc) return;
  const {elabCalcs,finalRows,summaryRows,totalMass}=lastCalc;
  const body=document.getElementById('d_res_body');

  if(i===0){
    // Resumen: raw totals, no elaboration deductions, no elaboration blocks
    let html='<div class="card" style="padding:.85rem 1rem">';
    summaryRows.forEach(row=>{
      const tagHtml=row.tag==='flour'?`<span class="tag tag-flour" style="font-size:.58rem">harina</span>`:row.tag==='water'?`<span class="tag tag-water" style="font-size:.58rem">agua</span>`:'';
      html+=`<div class="irr">
        <div class="irr-left"><div class="name">${esc(row.name)} ${tagHtml}</div><div class="pct">${esc(row.pct)}</div></div>
        <div class="irr-right"><div class="grams">${row.grams.toFixed(1)} g</div></div>
      </div>`;
    });
    html+=`</div><div class="total-bar"><span class="total-bar-lbl">Masa total</span><span class="total-bar-val">${totalMass.toFixed(0)} g</span></div>`;
    body.innerHTML=html;

  } else if(i<=elabCalcs.length){
    // One elaboration detail
    const elab=elabCalcs[i-1];
    let html='<div class="card" style="padding:.85rem 1rem">';
    elab.ings.forEach(ei=>{
      const tagHtml=ei.type==='flour'?`<span class="tag tag-flour" style="font-size:.58rem">harina</span>`:ei.type==='water'?`<span class="tag tag-water" style="font-size:.58rem">agua</span>`:'';
      html+=`<div class="irr">
        <div class="irr-left"><div class="name">${esc(ei.name)} ${tagHtml}</div><div class="pct">${ei.pctDesc}</div></div>
        <div class="irr-right"><div class="grams">${ei.grams.toFixed(1)} g</div></div>
      </div>`;
    });
    html+=`</div><div class="total-bar"><span class="total-bar-lbl">Total elaboración</span><span class="total-bar-val">${elab.total.toFixed(0)} g</span></div>`;
    body.innerHTML=html;

  } else {
    // Masa final: all ingredients (flours, others, water) with deductions + elaborations as single rows
    let html='<div class="card" style="padding:.85rem 1rem;margin-bottom:.5rem">';
    // Flour rows (with deductions)
    finalRows.filter(fr=>fr.tag==='flour').forEach(fr=>{
      html+=`<div class="irr">
        <div class="irr-left"><div class="name">${esc(fr.name)} <span class="tag tag-flour" style="font-size:.58rem">harina</span></div><div class="pct">${esc(fr.pct)}</div></div>
        <div class="irr-right">
          <div class="grams">${fr.final.toFixed(1)} g</div>
          ${fr.ded>0?`<div class="sub">Total: ${fr.total.toFixed(1)} g<br>Elab.: −${fr.ded.toFixed(1)} g</div>`:''}
        </div>
      </div>`;
    });
    // Other ingredient rows, excluding water (with deductions), then elaborations as rows, then water last
    const waterRows=finalRows.filter(fr=>fr.tag==='water');
    const otherRows=finalRows.filter(fr=>fr.tag!=='flour'&&fr.tag!=='water');
    otherRows.forEach(fr=>{
      html+=`<div class="irr">
        <div class="irr-left"><div class="name">${esc(fr.name)}</div><div class="pct">${esc(fr.pct)}</div></div>
        <div class="irr-right">
          <div class="grams">${fr.final.toFixed(1)} g</div>
          ${fr.ded>0?`<div class="sub">Total: ${fr.total.toFixed(1)} g<br>Elab.: −${fr.ded.toFixed(1)} g</div>`:''}
        </div>
      </div>`;
    });
    // Elaborations as single rows (total weight only)
    elabCalcs.forEach(elab=>{
      html+=`<div class="irr">
        <div class="irr-left"><div class="name">${esc(elab.name)} <span class="tag tag-elab" style="font-size:.58rem">elaboración</span></div><div class="pct">ver desglose en su pestaña</div></div>
        <div class="irr-right"><div class="grams">${elab.total.toFixed(1)} g</div></div>
      </div>`;
    });
    // Water rows last (with deductions)
    waterRows.forEach(fr=>{
      html+=`<div class="irr">
        <div class="irr-left"><div class="name">${esc(fr.name)} <span class="tag tag-water" style="font-size:.58rem">agua</span></div><div class="pct">${esc(fr.pct)}</div></div>
        <div class="irr-right">
          <div class="grams">${fr.final.toFixed(1)} g</div>
          ${fr.ded>0?`<div class="sub">Total: ${fr.total.toFixed(1)} g<br>Elab.: −${fr.ded.toFixed(1)} g</div>`:''}
        </div>
      </div>`;
    });
    const masaFinalTotal=elabCalcs.reduce((s,e)=>s+e.total,0)+finalRows.reduce((s,r)=>s+r.final,0);
    html+=`</div><div class="total-bar"><span class="total-bar-lbl">Masa total</span><span class="total-bar-val">${masaFinalTotal.toFixed(0)} g</span></div>`;
    body.innerHTML=html;
  }
}

function buildAmasadoData(r, fG, deductF, deductW, deductO, flourG, elabCalcs){
  const ings=[];
  // Flours (masa final tras deducciones)
  (r.flours||[]).forEach(f=>{ const m=(fG[f.id]||0)-(deductF[f.id]||0); ings.push({name:f.name,mass:+m.toFixed(1),temp:20}); });
  // Other ings except water
  (r.ings||[]).forEach(ing=>{
    if(/^agua$/i.test((ing.name||'').trim())) return;
    const tot=flourG*(parseFloat(ing.pct)||0)/100;
    const ded=deductO[ing.id]||0;
    ings.push({name:ing.name,mass:+(tot-ded).toFixed(1),temp:20});
  });
  // Elaborations
  elabCalcs.forEach(e=>{ ings.push({name:e.name,mass:+e.total.toFixed(1),temp:18}); });
  // Water mass
  const wi=(r.ings||[]).find(i=>/^agua$/i.test((i.name||'').trim()));
  const wTot=wi?flourG*(parseFloat(wi.pct)||0)/100:0;
  const wFinal=Math.max(0,+(wTot-deductW).toFixed(1));
  return {recipeName:r.name, ings, waterMass:wFinal};
}

function goToAmasado(){
  if(!lastCalc) return;
  const d=lastCalc.amasadoData;
  aIngs=d.ings.map((i,j)=>({id:aIngId++,...i}));
  document.getElementById('a_wm').value=d.waterMass;
  aRenderIngs(); aCalc();
  const b=document.getElementById('a_banner');
  b.textContent='✓ Ingredientes cargados desde: '+d.recipeName;
  b.classList.add('show');
  switchTab('amasado');
}

// ═══════════════════════════════════════
// MODAL — RECIPE EDITOR
// ═══════════════════════════════════════
function openNewRecipe(){
  editingId=null; rFlours=[]; rIngs=[]; rElabs=[]; rFId=0; rIId=0; rEId=0; rEIId=0;
  document.getElementById('r_name').value='';
  document.getElementById('r_notes').value='';
  document.getElementById('modal_title').textContent='Nueva receta';
  rRenderAll();
  document.getElementById('modal_overlay').classList.add('open');
}

function editCurrent(){
  const r=recipes.find(x=>x.id===activeId); if(!r) return;
  editingId=r.id;
  rFlours=(r.flours||[]).map(f=>({...f}));
  rIngs=(r.ings||[]).map(i=>({...i}));
  rElabs=(r.elabs||[]).map(e=>({...e,ings:(e.ings||[]).map(i=>({...i}))}));
  rFId=Math.max(0,...rFlours.map(f=>+f.id+1),1);
  rIId=Math.max(0,...rIngs.map(i=>+i.id+1),1);
  rEId=Math.max(0,...rElabs.map(e=>+e.id+1),1);
  rEIId=Math.max(0,...rElabs.flatMap(e=>(e.ings||[]).map(i=>+i.id+1)),1);
  document.getElementById('r_name').value=r.name||'';
  document.getElementById('r_notes').value=r.notes||'';
  document.getElementById('modal_title').textContent='Editar receta';
  resTab=0;
  rRenderAll();
  document.getElementById('modal_overlay').classList.add('open');
}

function closeModal(){ document.getElementById('modal_overlay').classList.remove('open'); editingId=null; }

function rRenderAll(){ rRenderFlours(); rRenderIngs(); rRenderElabs(); }

// Flours
function rAddFlour(n='',p=0){ rFlours.push({id:rFId++,name:n,pct:p}); rRenderFlours(); }
function rDelFlour(id){ rFlours=rFlours.filter(x=>x.id!==id); rRenderFlours(); rRenderElabs(); }
function rSetFlour(id,f,v){ const x=rFlours.find(x=>x.id===id); if(x){ x[f]=f==='name'?v:(parseFloat(v)||0); } if(f!=='name') rUpdateFsum(); else rRenderElabSelects(); }
function rUpdateFsum(){
  const s=rFlours.reduce((a,f)=>a+(parseFloat(f.pct)||0),0);
  const el=document.getElementById('r_fsum');
  el.textContent=s.toFixed(1)+' / 100%';
  el.className='fs-pill '+(Math.abs(s-100)<0.01?'fs-ok':'fs-err');
}
function rRenderFlours(){
  const el=document.getElementById('r_flour_list'); el.innerHTML='';
  rFlours.forEach(f=>{
    const d=document.createElement('div');
    d.style.cssText='display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) 30px;gap:5px;align-items:center;margin-bottom:5px';
    d.innerHTML=
      `<input type="text" value="${esc(f.name)}" placeholder="Harina de fuerza, Sémola…" style="font-size:.85rem;padding:.45rem .65rem" oninput="rSetFlour(${f.id},'name',this.value)">` +
      `<input type="number" value="${f.pct}" min="0.1" max="100" step="0.1" style="font-size:.85rem;padding:.45rem .65rem" oninput="rSetFlour(${f.id},'pct',this.value)">` +
      `<button class="btn btn-icon btn-ghost" onclick="rDelFlour(${f.id})"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>`;
    el.appendChild(d);
  });
  rUpdateFsum();
}

// Ings
function rAddIng(n='',p=0){ rIngs.push({id:rIId++,name:n,pct:p}); rRenderIngs(); rRenderElabs(); }
function rDelIng(id){ rIngs=rIngs.filter(x=>x.id!==id); rRenderIngs(); rRenderElabs(); }
function rSetIng(id,f,v){ const x=rIngs.find(x=>x.id===id); if(x) x[f]=f==='name'?v:(parseFloat(v)||0); }
function rRenderIngs(){
  const el=document.getElementById('r_ing_list'); el.innerHTML='';
  rIngs.forEach(i=>{
    const d=document.createElement('div');
    d.style.cssText='display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) 30px;gap:5px;align-items:center;margin-bottom:5px';
    d.innerHTML=
      `<input type="text" value="${esc(i.name)}" placeholder="Agua, Sal, Levadura…" style="font-size:.85rem;padding:.45rem .65rem" oninput="rSetIng(${i.id},'name',this.value)">` +
      `<input type="number" value="${i.pct}" min="0" step="0.01" style="font-size:.85rem;padding:.45rem .65rem" oninput="rSetIng(${i.id},'pct',this.value)">` +
      `<button class="btn btn-icon btn-ghost" onclick="rDelIng(${i.id})"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>`;
    el.appendChild(d);
  });
}

// Elaborations
function rAddElab(){
  rElabs.push({id:rEId++,name:'',ings:[]});
  rRenderElabs();
}
function rDelElab(id){ rElabs=rElabs.filter(x=>x.id!==id); rRenderElabs(); }
function rSetElabName(id,v){ const e=rElabs.find(x=>x.id===id); if(e) e.name=v; }

function rAddElabIng(elabId,type){
  const e=rElabs.find(x=>x.id===elabId); if(!e) return;
  const ei={id:rEIId++,type};
  if(type==='flour'){ ei.flourId=rFlours[0]?.id??null; ei.pct=20; }
  else if(type==='water'){ ei.pct=30; }
  else { ei.ingId=rIngs[0]?.id??null; ei.name=''; ei.pct=1; }
  e.ings.push(ei);
  rRenderElabs();
}
function rDelElabIng(elabId,eiId){
  const e=rElabs.find(x=>x.id===elabId); if(!e) return;
  e.ings=e.ings.filter(x=>x.id!==eiId);
  rRenderElabs();
}
function rSetElabIng(elabId,eiId,field,val){
  const e=rElabs.find(x=>x.id===elabId); if(!e) return;
  const ei=e.ings.find(x=>x.id===eiId); if(!ei) return;
  if(field==='flourId'||field==='ingId') ei[field]=parseInt(val);
  else if(field==='name') ei.name=val;
  else ei[field]=parseFloat(val)||0;
}

function rRenderElabSelects(){ rRenderElabs(); }

function rRenderElabs(){
  const el=document.getElementById('r_elab_list');
  const empty=document.getElementById('r_elab_empty');
  if(empty) empty.style.display=rElabs.length?'none':'block';
  el.innerHTML='';

  const flourOpts=rFlours.length
    ?rFlours.map(f=>`<option value="${f.id}">${esc(f.name||'Harina')}</option>`).join('')
    :'<option value="">— añade harinas primero —</option>';

  const ingOpts=rIngs.length
    ?rIngs.map(i=>`<option value="${i.id}">${esc(i.name||'Ingrediente')}</option>`).join('')
    :'<option value="">— sin ingredientes —</option>';

  rElabs.forEach(elab=>{
    const div=document.createElement('div');
    div.className='eeb';

    // elab ings rows
    let ingRows='';
    (elab.ings||[]).forEach(ei=>{
      if(ei.type==='flour'){
        ingRows+=`<div class="eeb-ing-row">
          <select style="font-size:.82rem;padding:.4rem .6rem;padding-right:1.8rem" onchange="rSetElabIng(${elab.id},${ei.id},'flourId',this.value)">
            ${rFlours.map(f=>`<option value="${f.id}"${f.id===ei.flourId?' selected':''}>${esc(f.name||'Harina')}</option>`).join('')}
          </select>
          <input type="number" value="${ei.pct}" min="0" max="100" step="0.1" placeholder="% de esa harina" oninput="rSetElabIng(${elab.id},${ei.id},'pct',this.value)">
          <span style="font-size:.68rem;color:var(--text3);display:flex;align-items:center;padding:0 3px">% de esa harina</span>
          <button class="btn btn-icon btn-ghost" onclick="rDelElabIng(${elab.id},${ei.id})"><svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        </div>`;
      } else if(ei.type==='water'){
        ingRows+=`<div class="eeb-ing-row">
          <div style="display:flex;align-items:center;gap:5px;padding:.4rem .6rem;background:var(--surface3);border:1.5px solid var(--border2);border-radius:8px;font-size:.82rem;color:var(--text2);font-weight:500">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1C6 1 2 5 2 7.5a4 4 0 008 0C10 5 6 1 6 1z" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>Agua
          </div>
          <input type="number" value="${ei.pct}" min="0" step="0.1" placeholder="% s/harina elab." oninput="rSetElabIng(${elab.id},${ei.id},'pct',this.value)">
          <span style="font-size:.68rem;color:var(--text3);display:flex;align-items:center;padding:0 3px">% s/harina elab.</span>
          <button class="btn btn-icon btn-ghost" onclick="rDelElabIng(${elab.id},${ei.id})"><svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        </div>`;
      } else {
        ingRows+=`<div class="eeb-ing-row">
          <select style="font-size:.82rem;padding:.4rem .6rem;padding-right:1.8rem" onchange="rSetElabIng(${elab.id},${ei.id},'ingId',this.value)">
            ${rIngs.map(i=>`<option value="${i.id}"${i.id===ei.ingId?' selected':''}>${esc(i.name||'Ingrediente')}</option>`).join('')}
          </select>
          <input type="number" value="${ei.pct}" min="0" step="0.01" placeholder="% s/harina" oninput="rSetElabIng(${elab.id},${ei.id},'pct',this.value)">
          <span style="font-size:.68rem;color:var(--text3);display:flex;align-items:center;padding:0 3px">% s/harina</span>
          <button class="btn btn-icon btn-ghost" onclick="rDelElabIng(${elab.id},${ei.id})"><svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        </div>`;
      }
    });

    div.innerHTML=`
      <div class="eeb-header">
        <input type="text" class="eeb-name-input" value="${esc(elab.name)}" placeholder="Nombre (prefermento, escaldado…)" oninput="rSetElabName(${elab.id},this.value)">
        <button class="btn btn-icon btn-ghost btn-danger" onclick="rDelElab(${elab.id})"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
      <div class="eeb-ings">
        <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 30px;gap:5px;margin-bottom:4px">
          <span class="chdr">Ingrediente</span><span class="chdr">Cantidad</span><span class="chdr"></span><span></span>
        </div>
        ${ingRows}
      </div>
      <div style="display:flex;gap:5px;margin-top:.5rem;flex-wrap:wrap">
        <button class="btn btn-xs" onclick="rAddElabIng(${elab.id},'flour')" ${!rFlours.length?'disabled':''}>+ Harina</button>
        <button class="btn btn-xs" onclick="rAddElabIng(${elab.id},'water')">+ Agua</button>
        <button class="btn btn-xs" onclick="rAddElabIng(${elab.id},'other')" ${!rIngs.length?'disabled title="Añade primero otros ingredientes a la receta"':''}>+ Otro ingrediente</button>
      </div>`;
    el.appendChild(div);
  });
}

function saveRecipe(){
  const name=document.getElementById('r_name').value.trim();
  if(!name){ alert('Ponle un nombre a la receta.'); return; }
  if(!rFlours.length){ alert('Añade al menos una harina.'); return; }
  for(const f of rFlours){
    if((parseFloat(f.pct)||0)<=0){ alert('La harina "'+( f.name||'sin nombre')+'" tiene un porcentaje de 0%. Todas las harinas deben tener un porcentaje mayor que 0.'); return; }
  }
  const fsum=rFlours.reduce((s,f)=>s+(parseFloat(f.pct)||0),0);
  if(Math.abs(fsum-100)>0.01){ alert('Las harinas deben sumar exactamente 100% (ahora suman '+fsum.toFixed(1)+'%).'); return; }

  // Validate elaborations: name and at least one ingredient required
  for(const elab of rElabs){
    if(!elab.name.trim()){ alert('Una elaboración no tiene nombre. Ponle un nombre antes de guardar.'); return; }
    if(!(elab.ings||[]).length){ alert('La elaboración "'+elab.name+'" no tiene ingredientes. Añade al menos uno o elimínala.'); return; }
  }

  // Fix 3+4: validate elaboration flour usage
  // Accumulate % used per flourId across all elaborations
  const flourUsed={}; // flourId -> total pct used
  for(const elab of rElabs){
    for(const ei of (elab.ings||[])){
      if(ei.type==='flour'){
        const pct=parseFloat(ei.pct)||0;
        if(pct<=0){ alert('La harina de "'+elab.name+'" no puede ser 0%. Corrige el porcentaje.'); return; }
        flourUsed[ei.flourId]=(flourUsed[ei.flourId]||0)+pct;
        if(flourUsed[ei.flourId]>100+0.01){
          const fname=rFlours.find(f=>f.id===ei.flourId)?.name||'harina';
          alert('El porcentaje total de "'+fname+'" usado en elaboraciones supera el 100% ('+flourUsed[ei.flourId].toFixed(1)+'%). Reduce los porcentajes.'); return;
        }
      }
    }
  }
  const recId = editingId || uid();
  const rec={
    id: recId,
    name,
    notes:document.getElementById('r_notes').value.trim(),
    flours:rFlours.map(f=>({...f})),
    ings:rIngs.map(i=>({...i})),
    elabs:rElabs.map(e=>({...e,ings:(e.ings||[]).map(i=>({...i}))})),
  };
  if(editingId){
    const idx=recipes.findIndex(x=>x.id===editingId);
    if(idx>=0) recipes[idx]=rec; else recipes.push(rec);
  } else {
    recipes.push(rec);
  }
  activeId=recId;
  editingId=null;
  save();
  closeModal();
  renderList();
  showDetail();
}

function showDeleteConfirm(){
  document.getElementById('del_btn_1').style.display='none';
  document.getElementById('del_confirm_box').style.display='block';
}
function hideDeleteConfirm(){
  document.getElementById('del_confirm_box').style.display='none';
  document.getElementById('del_btn_1').style.display='';
}
function deleteCurrent(){
  const r=recipes.find(x=>x.id===activeId);
  if(!r) return;
  recipes=recipes.filter(x=>x.id!==activeId);
  activeId=null;
  save();
  renderList();
  hideDeleteConfirm();
  ['recetas','amasado','mezcla'].forEach(t=>{
    document.getElementById('page_'+t).classList.toggle('active',t==='recetas');
    document.getElementById('nav_'+t).classList.toggle('active',t==='recetas');
  });
  document.getElementById('topbar_sub').textContent=SUBS['recetas'];
  showList();
}

// ═══════════════════════════════════════
// AMASADO
// ═══════════════════════════════════════
function aAddIng(n='',m=100,t=20){
  aIngs.push({id:aIngId++,name:n,mass:m,temp:t});
  aRenderIngs(); aCalc();
}
function aDelIng(id){ aIngs=aIngs.filter(x=>x.id!==id); aRenderIngs(); aCalc(); }
function aSet(id,f,v){
  const i=aIngs.find(x=>x.id===id); if(!i) return;
  i[f]=f==='name'?v:(parseFloat(v)||0);
  aCalc();
}
function aRenderIngs(){
  const el=document.getElementById('a_ing_list'); el.innerHTML='';
  aIngs.forEach(ing=>{
    const d=document.createElement('div');
    d.style.cssText='display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 30px;gap:5px;align-items:center;margin-bottom:5px';
    d.innerHTML=
      `<input type="text" value="${esc(ing.name)}" placeholder="Ingrediente" style="font-size:.83rem;padding:.48rem .62rem" oninput="aSet(${ing.id},'name',this.value)">` +
      `<input type="number" value="${ing.mass}" min="0" step="1" style="font-size:.83rem;padding:.48rem .62rem" oninput="aSet(${ing.id},'mass',this.value)">` +
      `<input type="number" value="${ing.temp}" step="0.5" style="font-size:.83rem;padding:.48rem .62rem" oninput="aSet(${ing.id},'temp',this.value)">` +
      `<button class="btn btn-icon btn-ghost" onclick="aDelIng(${ing.id})"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>`;
    el.appendChild(d);
  });
}
function aCalc(){
  const ttgt=parseFloat(document.getElementById('a_ttgt').value);
  const wm=parseFloat(document.getElementById('a_wm').value);
  const err=document.getElementById('a_err'),warn=document.getElementById('a_warn'),res=document.getElementById('a_result');
  err.classList.remove('show'); warn.classList.remove('show'); res.style.display='none';
  if(isNaN(ttgt)){ err.textContent='Introduce una temperatura objetivo válida.'; err.classList.add('show'); return; }
  if(isNaN(wm)||wm<=0){ err.textContent='Introduce la masa de agua de amasado.'; err.classList.add('show'); return; }
  if(!aIngs.length) return;
  // Media ponderada por masa: T_agua = (T_obj × M_total − Σ(mᵢ × Tᵢ)) / m_agua
  const sumMT=aIngs.reduce((s,i)=>s+(parseFloat(i.mass)||0)*(parseFloat(i.temp)||0),0);
  const sumM=aIngs.reduce((s,i)=>s+(parseFloat(i.mass)||0),0);
  const Tw=(ttgt*(sumM+wm)-sumMT)/wm;
  if(!isFinite(Tw)){ err.textContent='No se puede calcular con estos valores.'; err.classList.add('show'); return; }
  document.getElementById('a_tw').textContent=Tw.toFixed(1);
  res.style.display='block';
  if(Tw<0){ warn.textContent='⚠ Temperatura negativa ('+Tw.toFixed(1)+' °C). Ajusta las temperaturas de los ingredientes.'; warn.classList.add('show'); }
  else if(Tw>100){ warn.textContent='⚠ Temperatura superior a 100 °C ('+Tw.toFixed(1)+' °C). Ajusta las temperaturas de los ingredientes.'; warn.classList.add('show'); }
  const btn=document.getElementById('a_to_mezcla');
  if(Tw>0&&Tw<100){ btn.style.display='inline-flex'; btn.textContent='Mezclar a '+Tw.toFixed(1)+' °C →'; pendingMezclaTemp=Tw; }
  else btn.style.display='none';
}
function aGoMezcla(){ switchTab('mezcla'); }
document.getElementById('a_ttgt').addEventListener('input',aCalc);
document.getElementById('a_wm').addEventListener('input',aCalc);
// defaults
aAddIng('Harina',500,20);
aAddIng('Masa madre',100,18);

// ═══════════════════════════════════════
// MEZCLA
// ═══════════════════════════════════════
const msl=document.getElementById('m_sl');
function mRangeUpdate(){
  const tc=parseFloat(document.getElementById('m_tc').value)||0;
  const th=parseFloat(document.getElementById('m_th').value)||100;
  const mn=Math.ceil(tc+0.5),mx=Math.floor(th-0.5);
  msl.min=mn; msl.max=mx;
  document.getElementById('m_rmin').textContent=mn+'°C';
  document.getElementById('m_rmax').textContent=mx+'°C';
  if(+msl.value<mn) msl.value=mn;
  if(+msl.value>mx) msl.value=mx;
  mSyncSlider();
}
function mSyncSlider(){
  const v=+msl.value,mn=+msl.min,mx=+msl.max;
  const pct=mx>mn?(v-mn)/(mx-mn)*100:0;
  msl.style.setProperty('--pct',pct.toFixed(1)+'%');
  document.getElementById('m_tdisp').textContent=v.toFixed(1)+'°C';
}
function mFmt(v,unit){
  if(unit==='g') return v.toFixed(0)+' g';
  if(unit==='ml') return (v*1000).toFixed(0)+' mL';
  return v<1?v.toFixed(3)+' L':v.toFixed(2)+' L';
}
function mCalc(){
  const tc=parseFloat(document.getElementById('m_tc').value);
  const th=parseFloat(document.getElementById('m_th').value);
  const tt=parseFloat(msl.value);
  const totR=parseFloat(document.getElementById('m_tot').value);
  const unit=document.getElementById('m_unit').value;
  const tot=unit==='ml'?totR/1000:unit==='g'?totR/1000:totR;
  const err=document.getElementById('m_err'),res=document.getElementById('m_result');
  err.classList.remove('show'); res.style.display='none';
  if(isNaN(tc)||isNaN(th)||isNaN(tt)||isNaN(tot)||tot<=0) return;
  if(th<=tc){ err.textContent='La temperatura caliente debe ser mayor que la fría.'; err.classList.add('show'); return; }
  if(tt<=tc||tt>=th){ err.textContent='La temperatura objetivo debe estar entre la fría y la caliente.'; err.classList.add('show'); return; }
  const fH=(tt-tc)/(th-tc),fC=1-fH,vH=fH*tot,vC=fC*tot;
  document.getElementById('m_rc').textContent=mFmt(vC,unit);
  document.getElementById('m_rh').textContent=mFmt(vH,unit);
  document.getElementById('m_uc').textContent='≈ '+(fC*100).toFixed(1)+'%';
  document.getElementById('m_uh').textContent='≈ '+(fH*100).toFixed(1)+'%';
  document.getElementById('m_bc').style.width=(fC*100)+'%';
  document.getElementById('m_bh').style.width=(fH*100)+'%';
  document.getElementById('m_lc').textContent='Fría '+(fC*100).toFixed(1)+'%';
  document.getElementById('m_lh').textContent='Caliente '+(fH*100).toFixed(1)+'%';
  res.style.display='block';
}
mRangeUpdate(); mCalc();

// ═══════════════════════════════════════
// UTILS
// ═══════════════════════════════════════
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2); }
document.getElementById('modal_overlay').addEventListener('click',e=>{ if(e.target===document.getElementById('modal_overlay')) closeModal(); });

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
load(); renderList();
