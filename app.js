(() => {
  const cfg = window.APP_CONFIG, dict = window.I18N;
  let lang = cfg.defaultLanguage;
  let requirements = window.SAMPLE_REQUIREMENTS.map(x => ({...x}));
  const aggregationDecisions = new Map();
  let nextAggregationNo = 1;
  const planDateEl = document.getElementById('planDate');
  const today = new Date();
  planDateEl.value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const t = key => key.split('.').reduce((o,k)=>o?.[k], dict[lang]) ?? key;
  const parseISO = s => { const [y,m,d]=s.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); };
  const fmtDate = s => new Intl.DateTimeFormat(lang==='uk'?'uk-UA':lang==='pt'?'pt-PT':'en-GB',{year:'numeric',month:'short',day:'2-digit',timeZone:'UTC'}).format(parseISO(s));
  const addDays = (iso, delta) => { const d=parseISO(iso); d.setUTCDate(d.getUTCDate()+delta); return d.toISOString().slice(0,10); };
  const daysBetween = (a,b) => Math.trunc((parseISO(a)-parseISO(b))/86400000);
  const absDaysBetween = (a,b) => Math.abs(daysBetween(a,b));
  const money = (n,c) => new Intl.NumberFormat(lang==='uk'?'uk-UA':lang==='pt'?'pt-PT':'en-US',{style:'currency',currency:c,maximumFractionDigits:0}).format(n);
  const statusFor = d => d < 0 ? 'overdue' : d <= 30 ? 'required' : 'planning';
  const statusLabel = s => s==='overdue'?t('overdue'):s==='required'?t('required'):t('planning');
  const escapeHtml=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  function calculate(r){
    const s2c=cfg.s2cDays[r.buyingChannel];
    const requiredStart=addDays(r.needByDate,-s2c);
    const remaining=daysBetween(requiredStart,planDateEl.value);
    return {...r,s2cDays:s2c,requiredStart,daysRemaining:remaining,status:statusFor(remaining)};
  }
  function calculated(){ return requirements.map(calculate); }

  function applyTranslations(){
    document.documentElement.lang=lang==='uk'?'uk':lang;
    document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>el.placeholder=t(el.dataset.i18nPlaceholder));
    document.querySelectorAll('[data-lang]').forEach(b=>b.classList.toggle('active',b.dataset.lang===lang));
    populateSelects(); render();
  }

  function option(value,label){ return `<option value="${value}">${label}</option>`; }
  function populateSelects(){
    const f=document.getElementById('requirementForm');
    const keep={department:f.department.value,segment:f.segment.value,criticality:f.criticality.value,buyingChannel:f.buyingChannel.value};
    f.department.innerHTML=Object.entries(t('departments')).map(([k,v])=>option(k,v)).join('');
    f.segment.innerHTML=Object.entries(t('segments')).map(([k,v])=>option(k,v)).join('');
    f.criticality.innerHTML=Object.entries(t('criticalities')).map(([k,v])=>option(k,v)).join('');
    f.buyingChannel.innerHTML=Object.entries(t('channels')).map(([k,v])=>option(k,v)).join('');
    Object.entries(keep).forEach(([k,v])=>{if(v)f[k].value=v});
    const sf=document.getElementById('statusFilter'), df=document.getElementById('departmentFilter');
    const oldS=sf.value,oldD=df.value;
    sf.innerHTML=option('',t('allStatuses'))+['overdue','required','planning'].map(s=>option(s,statusLabel(s))).join('');
    df.innerHTML=option('',t('allDepartments'))+Object.entries(t('departments')).map(([k,v])=>option(k,v)).join('');
    sf.value=oldS;df.value=oldD;
  }

  function renderKpis(rows){
    const count=s=>rows.filter(r=>r.status===s).length;
    const pipeline=rows.filter(r=>r.daysRemaining>=0&&r.daysRemaining<=90).length;
    const byCurrency=rows.reduce((a,r)=>{a[r.currency]=(a[r.currency]||0)+Number(r.estimatedValue);return a},{});
    const totalText=Object.entries(byCurrency).map(([c,v])=>money(v,c)).join(' · ');
    const data=[[t('totalReq'),rows.length,''],[t('overdue'),count('overdue'),'overdue'],[t('required'),count('required'),'required'],[t('planning'),count('planning'),'planning'],[t('pipeline90'),pipeline,''],[t('totalValue'),totalText,'']];
    document.getElementById('kpis').innerHTML=data.map(([l,v,c])=>`<div class="kpi ${c}"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div></div>`).join('');
  }

  function filteredRows(rows){
    const q=document.getElementById('searchBox').value.trim().toLowerCase(),s=document.getElementById('statusFilter').value,d=document.getElementById('departmentFilter').value;
    return rows.filter(r=>(!q||`${r.title} ${r.description} ${r.supplier}`.toLowerCase().includes(q))&&(!s||r.status===s)&&(!d||r.department===d));
  }

  function renderTable(rows){
    const target=document.getElementById('planRows'),empty=document.getElementById('emptyState');
    target.innerHTML=rows.map(r=>`<tr>
      <td><div class="req-title">${escapeHtml(r.title)}</div><div class="muted">${escapeHtml(r.description)}</div>${r.aggregationGroup?`<div class="group-tag">${escapeHtml(r.aggregationGroup)}</div>`:''}</td>
      <td>${t('departments')[r.department]}</td><td>${t('segments')[r.segment]}</td><td>${money(r.estimatedValue,r.currency)}</td>
      <td>${fmtDate(r.needByDate)}</td><td>${t('channels')[r.buyingChannel]}<div class="muted">S2C: ${r.s2cDays} ${t('days')}</div></td>
      <td>${fmtDate(r.requiredStart)}</td><td class="${r.daysRemaining<0?'days-negative':''}">${r.daysRemaining}</td><td><span class="status ${r.status}">${statusLabel(r.status)}</span></td>
    </tr>`).join('');
    empty.classList.toggle('hidden',rows.length>0); document.querySelector('.table-wrap').classList.toggle('hidden',rows.length===0);
  }

  const stopWords = new Set(['and','the','of','for','to','a','an','services','service','support','renewal','supply','works','annual']);
  function tokens(text){
    return String(text||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(x=>x.length>2&&!stopWords.has(x));
  }
  function titleSimilarity(a,b){
    const A=new Set(tokens(a.title)), B=new Set(tokens(b.title));
    if(!A.size||!B.size) return 0;
    const common=[...A].filter(x=>B.has(x)).length;
    return common / Math.min(A.size,B.size);
  }
  function normalizedTitle(s){ return tokens(s).sort().join(' '); }
  function pairScore(a,b){
    const sameTitle = normalizedTitle(a.title) && normalizedTitle(a.title)===normalizedTitle(b.title);
    const sim=titleSimilarity(a,b);
    if(!sameTitle && sim < 0.5) return null;
    if(a.segment!==b.segment && !sameTitle) return null;
    let score = sameTitle ? 72 : Math.round(sim*52);
    const reasons=[];
    if(sameTitle){ reasons.push('sameRequirement'); }
    else if(sim>=0.75){ reasons.push('strongScope'); }
    else { reasons.push('relatedScope'); }
    if(a.segment===b.segment){score+=10;reasons.push('sameSegment');}
    const gap=absDaysBetween(a.needByDate,b.needByDate);
    if(gap<=60){score+=12;reasons.push('timing60');}
    else if(gap<=120){score+=7;reasons.push('timing120');}
    if(a.department===b.department){score+=4;reasons.push('sameDepartment');}
    if(a.supplier&&b.supplier&&a.supplier.toLowerCase()===b.supplier.toLowerCase()){score+=4;reasons.push('sameSupplier');}
    return {score:Math.min(100,score),reasons,gap};
  }

  function detectAggregation(rows){
    const links=[];
    for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++){
      const p=pairScore(rows[i],rows[j]);
      if(p&&p.score>=65) links.push({a:rows[i].id,b:rows[j].id,...p});
    }
    // connected components turn strong pairwise matches into candidate groups
    const adj=new Map();
    links.forEach(l=>{if(!adj.has(l.a))adj.set(l.a,new Set());if(!adj.has(l.b))adj.set(l.b,new Set());adj.get(l.a).add(l.b);adj.get(l.b).add(l.a)});
    const byId=new Map(rows.map(r=>[r.id,r])), seen=new Set(), groups=[];
    for(const id of adj.keys()){
      if(seen.has(id))continue;
      const stack=[id], ids=[]; seen.add(id);
      while(stack.length){const x=stack.pop();ids.push(x);for(const y of adj.get(x)||[])if(!seen.has(y)){seen.add(y);stack.push(y)}}
      if(ids.length<2)continue;
      const members=ids.map(x=>byId.get(x)).filter(Boolean);
      const groupLinks=links.filter(l=>ids.includes(l.a)&&ids.includes(l.b));
      const avg=Math.round(groupLinks.reduce((s,l)=>s+l.score,0)/groupLinks.length);
      const allReasons=[...new Set(groupLinks.flatMap(l=>l.reasons))];
      const key=ids.sort((a,b)=>a-b).join('-');
      groups.push({key,members,score:avg,reasons:allReasons});
    }
    return groups.sort((a,b)=>b.score-a.score || b.members.length-a.members.length);
  }

  function combinedValueText(members){
    const totals=members.reduce((a,r)=>{a[r.currency]=(a[r.currency]||0)+Number(r.estimatedValue);return a},{});
    return Object.entries(totals).map(([c,v])=>money(v,c)).join(' · ');
  }
  function confidence(score){ return score>=85?'high':score>=72?'medium':'review'; }
  function reasonText(reason){ return t('aggregationReasons')[reason] || reason; }

  function renderAggregation(rows){
    const opportunities=detectAggregation(rows);
    const summary=document.getElementById('aggregationSummary'), list=document.getElementById('aggregationList'), empty=document.getElementById('aggregationEmpty');
    const approved=[...aggregationDecisions.values()].filter(x=>x.decision==='approved').length;
    const deferred=[...aggregationDecisions.values()].filter(x=>x.decision==='deferred').length;
    summary.innerHTML=`<div><strong>${opportunities.length}</strong><span>${t('opportunitiesFound')}</span></div><div><strong>${approved}</strong><span>${t('approvedCount')}</span></div><div><strong>${deferred}</strong><span>${t('deferredCount')}</span></div>`;
    empty.classList.toggle('hidden',opportunities.length>0);
    list.innerHTML=opportunities.map((o,idx)=>{
      const state=aggregationDecisions.get(o.key);
      const decision=state?.decision || 'pending';
      const conf=confidence(o.score);
      const memberRows=o.members.map(r=>`<div class="agg-member"><div><strong>${escapeHtml(r.title)}</strong><span>${t('departments')[r.department]} · ${fmtDate(r.needByDate)}</span></div><div>${money(r.estimatedValue,r.currency)}</div></div>`).join('');
      const reasonChips=o.reasons.slice(0,4).map(r=>`<span>${escapeHtml(reasonText(r))}</span>`).join('');
      const groupNote=state?.groupId?`<div class="implemented-note">${t('implementedAs')} <strong>${state.groupId}</strong></div>`:'';
      return `<article class="aggregation-card ${decision}">
        <div class="agg-head"><div><span class="confidence ${conf}">${t('confidence')[conf]} · ${o.score}%</span><h3>${t('opportunity')} ${idx+1}</h3></div><span class="decision-badge ${decision}">${t('decision')[decision]}</span></div>
        <div class="agg-members">${memberRows}</div>
        <div class="agg-metrics"><div><span>${t('combinedValue')}</span><strong>${combinedValueText(o.members)}</strong></div><div><span>${t('requirements')}</span><strong>${o.members.length}</strong></div></div>
        <div class="agg-reasons"><strong>${t('whySuggested')}</strong><div>${reasonChips}</div></div>
        ${groupNote}
        <div class="agg-actions">
          <button class="primary agg-action" data-key="${o.key}" data-action="approved" ${decision==='approved'?'disabled':''}>${t('approve')}</button>
          <button class="secondary agg-action" data-key="${o.key}" data-action="rejected" ${decision==='rejected'?'disabled':''}>${t('reject')}</button>
          <button class="secondary agg-action" data-key="${o.key}" data-action="deferred" ${decision==='deferred'?'disabled':''}>${t('defer')}</button>
        </div>
      </article>`;
    }).join('');
    document.querySelectorAll('.agg-action').forEach(b=>b.addEventListener('click',()=>setAggregationDecision(b.dataset.key,b.dataset.action,opportunities)));
  }

  function setAggregationDecision(key,decision,opportunities){
    const opp=opportunities.find(o=>o.key===key); if(!opp)return;
    const existing=aggregationDecisions.get(key);
    let groupId=existing?.groupId;
    if(decision==='approved'&&!groupId) groupId=`AGG-${String(nextAggregationNo++).padStart(3,'0')}`;
    aggregationDecisions.set(key,{decision,groupId:decision==='approved'?groupId:null});
    const memberIds=new Set(opp.members.map(r=>r.id));
    requirements=requirements.map(r=>memberIds.has(r.id)?{...r,aggregationGroup:decision==='approved'?groupId:null}:r);
    render();
  }

  function render(){ const rows=calculated(); renderKpis(rows); renderTable(filteredRows(rows)); renderAggregation(rows); }

  document.querySelectorAll('[data-lang]').forEach(b=>b.addEventListener('click',()=>{lang=b.dataset.lang;applyTranslations()}));
  planDateEl.addEventListener('change',render);
  ['searchBox','statusFilter','departmentFilter'].forEach(id=>document.getElementById(id).addEventListener(id==='searchBox'?'input':'change',render));
  document.getElementById('resetFilters').addEventListener('click',()=>{document.getElementById('searchBox').value='';document.getElementById('statusFilter').value='';document.getElementById('departmentFilter').value='';render()});
  document.getElementById('requirementForm').addEventListener('submit',e=>{
    e.preventDefault(); const f=e.currentTarget,fd=new FormData(f);
    const r={id:Date.now(),planYear:Number(fd.get('needByDate').slice(0,4)),title:fd.get('title').trim(),description:fd.get('description').trim(),department:fd.get('department'),segment:fd.get('segment'),estimatedValue:Number(fd.get('estimatedValue')),currency:fd.get('currency'),needByDate:fd.get('needByDate'),criticality:fd.get('criticality'),buyingChannel:fd.get('buyingChannel'),supplier:fd.get('supplier').trim()};
    if(!r.title||!r.description||!r.needByDate||!r.estimatedValue){document.getElementById('formMessage').textContent=t('requiredFields');return}
    requirements.unshift(r); document.getElementById('formMessage').textContent=t('addedAggregationCheck'); f.reset(); populateSelects(); render(); document.querySelector('.aggregation-section').scrollIntoView({behavior:'smooth',block:'start'});
  });
  document.getElementById('requirementForm').addEventListener('reset',()=>{setTimeout(()=>document.getElementById('formMessage').textContent='',0)});
  applyTranslations();
})();
