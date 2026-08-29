(() => {
  const cfg = window.APP_CONFIG, dict = window.I18N;
  let lang = cfg.defaultLanguage;
  let requirements = window.SAMPLE_REQUIREMENTS.map(x => ({...x,...(window.SAMPLE_REQUIREMENT_I18N?.[x.id]||{})}));
  const aggregationDecisions = new Map();
  let nextAggregationNo = 1;
  let activityLog=[];
  let editingId=null;
  let planRefreshed=false;
  const fxRates={USD:null,GBP:null};
  const planDateEl = document.getElementById('planDate');
  const today = new Date();
  planDateEl.value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  function saveState(){ /* Demo state intentionally lasts only until the page is reloaded. */ }
  function logActivity(action,detail){ activityLog.unshift({id:Date.now()+Math.random(),ts:new Date().toISOString(),action,detail}); activityLog=activityLog.slice(0,100); }

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
  const titleFor=r=>r?.titleI18n?.[lang]||r?.titleI18n?.en||r?.title||'';
  const descriptionFor=r=>r?.descriptionI18n?.[lang]||r?.descriptionI18n?.en||r?.description||'';
  const departmentFor=r=>r?.department?t('departments')[r.department]||r.department:t('multipleDepartments');

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

  function getPipeline90(rows){
    const all=rows.filter(r=>Number.isFinite(r.daysRemaining)&&r.daysRemaining>=0&&r.daysRemaining<=90);
    return {
      all,
      days0to30:all.filter(r=>r.daysRemaining<=30),
      days31to60:all.filter(r=>r.daysRemaining>30&&r.daysRemaining<=60),
      days61to90:all.filter(r=>r.daysRemaining>60&&r.daysRemaining<=90)
    };
  }

  function renderKpis(rows){
    const count=s=>rows.filter(r=>r.status===s).length;
    const pipeline=getPipeline90(rows).all.length;
    const byCurrency=rows.reduce((a,r)=>{a[r.currency]=(a[r.currency]||0)+Number(r.estimatedValue);return a},{});
    const totalText=Object.entries(byCurrency).map(([c,v])=>`<span>${money(v,c)}</span>`).join('');
    const data=[[t('totalReq'),rows.length,''],[t('overdue'),count('overdue'),'overdue'],[t('required'),count('required'),'required'],[t('planning'),count('planning'),'planning'],[t('pipeline90'),pipeline,''],[t('totalValue'),totalText,'total-value']];
    document.getElementById('kpis').innerHTML=data.map(([l,v,c])=>`<div class="kpi ${c}"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div></div>`).join('');
  }

  function filteredRows(rows){
    const q=document.getElementById('searchBox').value.trim().toLowerCase(),s=document.getElementById('statusFilter').value,d=document.getElementById('departmentFilter').value;
    return rows.filter(r=>(!q||`${titleFor(r)} ${descriptionFor(r)} ${r.supplier}`.toLowerCase().includes(q))&&(!s||r.status===s)&&(!d||r.department===d));
  }

  function renderTable(rows){
    const target=document.getElementById('planRows'),empty=document.getElementById('emptyState');
    target.innerHTML=rows.map(r=>`<tr>
      <td><div class="req-title">${escapeHtml(titleFor(r))}</div><div class="muted">${escapeHtml(descriptionFor(r))}</div>${r.aggregationGroup?`<div class="group-tag">${escapeHtml(r.aggregationGroup)}</div>`:''}</td>
      <td>${escapeHtml(departmentFor(r))}</td><td>${t('segments')[r.segment]||t('multipleCategories')}</td><td>${money(r.estimatedValue,r.currency)}</td>
      <td>${fmtDate(r.needByDate)}</td><td>${t('channels')[r.buyingChannel]}<div class="muted">${t('s2cLabel')}: ${r.s2cDays} ${t('days')}</div></td>
      <td>${fmtDate(r.requiredStart)}</td><td class="${r.daysRemaining<0?'days-negative':''}">${r.daysRemaining}</td><td><span class="status ${r.status}">${statusLabel(r.status)}</span></td>
      <td>${!r.isAggregation?`<div class="row-actions"><button class="secondary edit-row" data-id="${r.id}">${t('edit')}</button>${r.isUserAdded?`<button class="secondary delete-row" data-id="${r.id}">${t('delete')}</button>`:''}</div>`:'—'}</td>
    </tr>`).join('');
    document.querySelectorAll('.edit-row').forEach(b=>b.addEventListener('click',()=>startEdit(Number(b.dataset.id))));
    document.querySelectorAll('.delete-row').forEach(b=>b.addEventListener('click',()=>deleteRequirement(Number(b.dataset.id))));
    empty.classList.toggle('hidden',rows.length>0); document.querySelector('.table-wrap').classList.toggle('hidden',rows.length===0);
  }

  const stopWords = new Set(['and','the','of','for','to','a','an','services','service','support','renewal','supply','works','annual']);
  function tokens(text){
    return String(text||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(x=>x.length>2&&!stopWords.has(x));
  }
  function uniqueTokens(text){ return [...new Set(tokens(text))]; }
  function titleSimilarity(a,b){
    const A=new Set(uniqueTokens(a.title)), B=new Set(uniqueTokens(b.title));
    if(!A.size||!B.size) return 0;
    const common=[...A].filter(x=>B.has(x)).length;
    const union=new Set([...A,...B]).size;
    return union ? common/union : 0;
  }
  function normalizedTitle(s){ return uniqueTokens(s).sort().join(' '); }
  function pairScore(a,b){
    const sameTitle = normalizedTitle(a.title) && normalizedTitle(a.title)===normalizedTitle(b.title);
    const sim=titleSimilarity(a,b);
    if(!sameTitle && sim < 0.5) return null;
    if(a.segment!==b.segment && !sameTitle) return null;
    let score = 0;
    const reasons=[];
    if(sameTitle){score+=82;reasons.push('sameRequirement');}
    else if(sim>=0.75){score+=45;reasons.push('strongScope');}
    else {score+=25;reasons.push('relatedScope');}
    if(a.segment&&b.segment&&a.segment===b.segment){score+=15;reasons.push('sameSegment');}
    const gap=absDaysBetween(a.needByDate,b.needByDate);
    if(gap<=30){score+=15;reasons.push('timing30');}
    else if(gap<=60){score+=10;reasons.push('timing60');}
    else if(gap<=120){score+=2;reasons.push('timing120');}
    if(a.department&&b.department&&a.department===b.department){score+=5;reasons.push('sameDepartment');}
    if(a.supplier&&b.supplier&&a.supplier.toLowerCase().trim()===b.supplier.toLowerCase().trim()){score+=5;reasons.push('sameSupplier');}
    if(a.buyingChannel&&b.buyingChannel&&a.buyingChannel.toLowerCase().trim()===b.buyingChannel.toLowerCase().trim()){score+=10;reasons.push('sameBuyingChannel');}
    return {score:Math.min(100,score),reasons,gap};
  }

  function detectAggregation(rows){
    const sourceRows=rows.filter(r=>!r.isAggregation);
    const allPairs=[];
    for(let i=0;i<sourceRows.length;i++) for(let j=i+1;j<sourceRows.length;j++){
      const p=pairScore(sourceRows[i],sourceRows[j]);
      if(p) allPairs.push({a:sourceRows[i].id,b:sourceRows[j].id,...p});
    }
    const links=allPairs.filter(p=>p.score>=65);
    // connected components turn strong pairwise matches into candidate groups
    const adj=new Map();
    links.forEach(l=>{if(!adj.has(l.a))adj.set(l.a,new Set());if(!adj.has(l.b))adj.set(l.b,new Set());adj.get(l.a).add(l.b);adj.get(l.b).add(l.a)});
    const byId=new Map(sourceRows.map(r=>[r.id,r])), seen=new Set(), groups=[];
    for(const id of adj.keys()){
      if(seen.has(id))continue;
      const stack=[id], ids=[]; seen.add(id);
      while(stack.length){const x=stack.pop();ids.push(x);for(const y of adj.get(x)||[])if(!seen.has(y)){seen.add(y);stack.push(y)}}
      if(ids.length<2)continue;
      const members=ids.map(x=>byId.get(x)).filter(Boolean);
      let totalPairScore=0,qualifyingPairCount=0,possiblePairCount=0;
      const allReasons=[];
      for(let i=0;i<ids.length;i++) for(let j=i+1;j<ids.length;j++){
        possiblePairCount++;
        const p=pairScore(byId.get(ids[i]),byId.get(ids[j]));
        if(!p)continue;
        totalPairScore+=p.score;
        if(p.score>=65)qualifyingPairCount++;
        p.reasons.forEach(reason=>{if(!allReasons.includes(reason))allReasons.push(reason)});
      }
      if(!possiblePairCount)continue;
      const averagePairQuality=totalPairScore/possiblePairCount;
      const cohesion=qualifyingPairCount/possiblePairCount*100;
      const groupConfidence=Math.round(averagePairQuality*0.70+cohesion*0.30);
      if(groupConfidence<80)continue;
      const key=ids.sort((a,b)=>a-b).join('-');
      groups.push({key,members,score:groupConfidence,reasons:allReasons});
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
    const liveOpportunities=detectAggregation(rows);
    const liveKeys=new Set(liveOpportunities.map(o=>o.key));
    const approvedOpportunities=[...aggregationDecisions.entries()]
      .filter(([key,state])=>state.decision==='approved'&&state.snapshot&&!liveKeys.has(key))
      .map(([,state])=>state.snapshot);
    const opportunities=[...liveOpportunities,...approvedOpportunities];
    const summary=document.getElementById('aggregationSummary'), list=document.getElementById('aggregationList'), empty=document.getElementById('aggregationEmpty');
    const approved=[...aggregationDecisions.values()].filter(x=>x.decision==='approved').length;
    const deferred=[...aggregationDecisions.values()].filter(x=>x.decision==='deferred').length;
    summary.innerHTML=`<div><strong>${opportunities.length}</strong><span>${t('opportunitiesFound')}</span></div><div><strong>${approved}</strong><span>${t('approvedCount')}</span></div><div><strong>${deferred}</strong><span>${t('deferredCount')}</span></div>`;
    empty.classList.toggle('hidden',opportunities.length>0);
    list.innerHTML=opportunities.map((o,idx)=>{
      const state=aggregationDecisions.get(o.key);
      const decision=state?.decision || 'pending';
      const conf=confidence(o.score);
      const memberRows=o.members.map(r=>`<div class="agg-member"><div><strong>${escapeHtml(titleFor(r))}</strong><span>${escapeHtml(departmentFor(r))} · ${fmtDate(r.needByDate)}</span></div><div>${money(r.estimatedValue,r.currency)}</div></div>`).join('');
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
    if(decision==='approved'){
      const currencies=[...new Set(opp.members.map(r=>r.currency))];
      const isMixedCurrency=currencies.length>1;
      const missingCurrencies=isMixedCurrency?currencies.filter(c=>c!=='EUR'&&!(Number(fxRates[c])>0)):[];
      if(missingCurrencies.length){
        const message=document.getElementById('aggregationFxMessage');
        message.textContent=fillTemplate(t('aggregationFxMissing'),{currencies:missingCurrencies.join(', ')});
        document.getElementById('aggregationFxPanel')?.scrollIntoView({behavior:'smooth',block:'center'});
        return;
      }
      if(!groupId) groupId=`AGG-${String(nextAggregationNo++).padStart(3,'0')}`;
      const memberIds=new Set(opp.members.map(r=>r.id));
      const first=opp.members[0];
      const earliest=[...opp.members].sort((a,b)=>a.needByDate.localeCompare(b.needByDate))[0];
      const departments=[...new Set(opp.members.map(r=>r.department).filter(Boolean))];
      const suppliers=[...new Set(opp.members.map(r=>String(r.supplier||'').trim()).filter(Boolean))];
      const segmentCounts=new Map();
      opp.members.forEach(r=>{if(r.segment)segmentCounts.set(r.segment,(segmentCounts.get(r.segment)||0)+1)});
      const rankedSegments=[...segmentCounts.entries()].sort((a,b)=>b[1]-a[1]);
      const segment=rankedSegments.length===1||rankedSegments[0][1]>rankedSegments[1][1]?rankedSegments[0]?.[0]||'':null;
      const criticality=opp.members.some(r=>r.criticality==='emergency')?'emergency':opp.members.some(r=>r.criticality==='urgent')?'urgent':'regular';
      const consolidated={
        id:Date.now(),
        isAggregation:true,
        aggregationGroup:groupId,
        aggregationOpportunity:key,
        planYear:first.planYear,
        title:`Aggregated — ${first.titleI18n?.en||first.title}`,
        description:`Approved aggregation ${groupId}. Combined from ${opp.members.length} APP requirements.`,
        titleI18n:{
          en:`Aggregated — ${first.titleI18n?.en||first.title}`,
          uk:`Агреговано — ${first.titleI18n?.uk||first.title}`,
          pt:`Agregado — ${first.titleI18n?.pt||first.title}`
        },
        descriptionI18n:{
          en:`Approved aggregation ${groupId}. Combined from ${opp.members.length} APP requirements.`,
          uk:`Схвалена агрегація ${groupId}. Поєднано потреб: ${opp.members.length}.`,
          pt:`Agregação ${groupId} aprovada. Necessidades combinadas: ${opp.members.length}.`
        },
        department:departments.length===1?departments[0]:null,
        segment,
        estimatedValue:isMixedCurrency
          ?opp.members.reduce((sum,r)=>sum+(r.currency==='EUR'?Number(r.estimatedValue||0):Number(r.estimatedValue||0)*Number(fxRates[r.currency])),0)
          :opp.members.reduce((sum,r)=>sum+Number(r.estimatedValue||0),0),
        currency:isMixedCurrency?'EUR':currencies[0],
        needByDate:earliest.needByDate,
        criticality,
        buyingChannel:'publicRfp',
        supplier:suppliers.length===1?suppliers[0]:''
      };
      aggregationDecisions.set(key,{decision,groupId,snapshot:{...opp,members:opp.members.map(r=>({...r}))}});
      requirements=[consolidated,...requirements.filter(r=>!memberIds.has(r.id))];
    }else{
      aggregationDecisions.set(key,{decision,groupId:null});
    }
    logActivity(decision==='approved'?'approved':decision==='rejected'?'rejected':'deferred', `${groupId||''} ${opp.members.map(titleFor).join(' + ')}`.trim());
    saveState(); render();
  }

  function fillTemplate(str,vars){ return String(str).replace(/\{(\w+)\}/g,(_,k)=>vars[k]??''); }

  function topCounts(rows,keyFn,limit=3){
    const counts=new Map(); rows.forEach(r=>{const k=keyFn(r);counts.set(k,(counts.get(k)||0)+1)});
    return [...counts.entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))).slice(0,limit);
  }

  function renderBars(items,labelFn){
    if(!items.length) return `<div class="review-empty">${t('noUpcomingItems')}</div>`;
    const max=Math.max(...items.map(x=>x[1]),1);
    return `<div class="review-bars">${items.map(([key,count])=>`<div class="review-bar-row"><div class="review-bar-label" title="${escapeHtml(labelFn(key))}">${escapeHtml(labelFn(key))}</div><div class="review-bar-track"><div class="review-bar-fill" style="width:${Math.round(count/max*100)}%"></div></div><div class="review-bar-value">${count}</div></div>`).join('')}</div>`;
  }

  function renderManagementReview(rows){
    const root=document.getElementById('managementReview'); if(!root)return;
    const immediate=rows.filter(r=>r.status==='overdue'||r.status==='required').sort((a,b)=>a.daysRemaining-b.daysRemaining||b.estimatedValue-a.estimatedValue);
    const pipeline90=getPipeline90(rows);
    const p030=pipeline90.days0to30;
    const p3160=pipeline90.days31to60;
    const p6190=pipeline90.days61to90;
    const next180=rows.filter(r=>r.daysRemaining>=0&&r.daysRemaining<=180);
    const deptTop=topCounts(next180,r=>r.department,3);
    const catTop=topCounts(next180,r=>r.segment,3);
    const opportunities=detectAggregation(rows);
    let pending=0,approved=0,rejected=0,deferred=0;
    opportunities.forEach(o=>{const d=aggregationDecisions.get(o.key)?.decision||'pending'; if(d==='approved')approved++;else if(d==='rejected')rejected++;else if(d==='deferred')deferred++;else pending++;});
    const highValue=[...rows].filter(r=>r.daysRemaining>=0).sort((a,b)=>b.estimatedValue-a.estimatedValue).slice(0,5);
    const emergency=rows.filter(r=>r.criticality==='emergency');
    const urgent=rows.filter(r=>r.criticality==='urgent');
    const regular=rows.filter(r=>r.criticality==='regular');
    const critical180=next180.filter(r=>r.criticality==='emergency'||r.criticality==='urgent').length;
    const immediateHtml=immediate.length?`<div class="review-list">${immediate.slice(0,5).map(r=>`<div class="review-item"><div><strong>${escapeHtml(titleFor(r))}</strong><span>${escapeHtml(departmentFor(r))} · ${statusLabel(r.status)} · ${t('startingIn')} ${r.daysRemaining} ${t('daysUnit')}</span></div><div class="review-value">${money(r.estimatedValue,r.currency)}</div></div>`).join('')}</div>`:`<div class="review-empty">${t('noImmediatePriorities')}</div>`;
    const highValueHtml=highValue.length?`<div class="review-list">${highValue.map(r=>`<div class="review-item"><div><strong>${escapeHtml(titleFor(r))}</strong><span>${escapeHtml(departmentFor(r))} · ${fmtDate(r.requiredStart)}</span></div><div class="review-value">${money(r.estimatedValue,r.currency)}</div></div>`).join('')}</div>`:`<div class="review-empty">${t('noUpcomingItems')}</div>`;
    const obs=[];
    const overdue=rows.filter(r=>r.status==='overdue').length, required=rows.filter(r=>r.status==='required').length;
    if(immediate.length) obs.push(fillTemplate(t('observationImmediate'),{count:immediate.length,overdue,required})); else obs.push(t('observationNoImmediate'));
    obs.push(fillTemplate(t('observationPipeline'),{count:p030.length+p3160.length+p6190.length}));
    if(deptTop.length) obs.push(fillTemplate(t('observationConcentration'),{department:t('departments')[deptTop[0][0]],count:deptTop[0][1]}));
    obs.push(pending?fillTemplate(t('observationAggregation'),{count:pending}):t('observationAggregationClear'));
    if(critical180) obs.push(fillTemplate(t('observationCriticality'),{count:critical180}));
    root.innerHTML=`
      <article class="management-card"><h3>${t('immediatePriorities')}</h3>${immediateHtml}</article>
      <article class="management-card"><h3>${t('pipelineReview')}</h3><div class="review-kpi-row"><div class="review-kpi"><span>${t('days030')}</span><strong>${p030.length}</strong></div><div class="review-kpi"><span>${t('days3160')}</span><strong>${p3160.length}</strong></div><div class="review-kpi"><span>${t('days6190')}</span><strong>${p6190.length}</strong></div></div></article>
      <article class="management-card"><h3>${t('workloadConcentration')}</h3><div class="review-sub">${t('topDepartments')} · ${t('next180')}</div>${renderBars(deptTop,k=>t('departments')[k])}<div class="review-sub" style="margin-top:18px">${t('topCategories')} · ${t('next180')}</div>${renderBars(catTop,k=>t('segments')[k])}</article>
      <article class="management-card"><h3>${t('aggregationReview')}</h3><div class="review-kpi-row"><div class="review-kpi"><span>${t('pendingReview')}</span><strong>${pending}</strong></div><div class="review-kpi"><span>${t('approvedReview')}</span><strong>${approved}</strong></div><div class="review-kpi"><span>${t('deferredReview')}</span><strong>${deferred}</strong></div></div><div class="review-kpi-row"><div class="review-kpi"><span>${t('rejectedReview')}</span><strong>${rejected}</strong></div></div></article>
      <article class="management-card"><h3>${t('highValueReview')}</h3>${highValueHtml}</article>
      <article class="management-card"><h3>${t('criticalityReview')}</h3><div class="review-kpi-row"><div class="review-kpi"><span>${t('emergencyReq')}</span><strong>${emergency.length}</strong></div><div class="review-kpi"><span>${t('urgentReq')}</span><strong>${urgent.length}</strong></div><div class="review-kpi"><span>${t('regularReq')}</span><strong>${regular.length}</strong></div></div></article>
      <article class="management-card wide"><h3>${t('planningObservations')}</h3><ul class="observation-list">${obs.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></article>`;
  }

  function buildAiReviewPayload(rows){
    const pipeline90=getPipeline90(rows);
    const p3160=pipeline90.days31to60;
    const p6190=pipeline90.days61to90;
    const actionRequired=rows.filter(r=>r.status==='required');
    const actionOverdue=rows.filter(r=>r.status==='overdue' && daysBetween(r.needByDate,planDateEl.value)>=0);
    const needByPassed=rows.filter(r=>daysBetween(r.needByDate,planDateEl.value)<0);
    const criticalUpcoming=actionRequired.filter(r=>r.criticality==='emergency'||r.criticality==='urgent');
    const next180=rows.filter(r=>r.daysRemaining>=0&&r.daysRemaining<=180);

    const totalsByCurrency=rows.reduce((a,r)=>{
      a[r.currency]=(a[r.currency]||0)+Number(r.estimatedValue||0);
      return a;
    },{});

    const incomplete=rows.filter(r=>
      !r.department || !r.segment || !r.buyingChannel || !r.needByDate || !r.criticality ||
      !Number.isFinite(Number(r.estimatedValue)) || Number(r.estimatedValue)<=0
    );
    const missingOrZeroValue=rows.filter(r=>!Number.isFinite(Number(r.estimatedValue))||Number(r.estimatedValue)<=0);

    const aiRequirement=r=>({
      id:r.id,
      title:titleFor(r),
      department:departmentFor(r),
      segment:r.segment?t('segments')[r.segment]:t('multipleCategories'),
      value:Number(r.estimatedValue)||0,
      currency:r.currency,
      needByDate:r.needByDate,
      requiredProcurementStart:r.requiredStart,
      daysRemaining:r.daysRemaining,
      status:statusLabel(r.status),
      criticality:t('criticalities')[r.criticality]
    });

    const topDepartments=topCounts(next180,r=>r.department,5)
      .map(([k,count])=>({department:t('departments')[k],requirements:count}));
    const topCategories=topCounts(next180,r=>r.segment,5)
      .map(([k,count])=>({category:t('segments')[k],requirements:count}));

    return {
      task:`Write the complete management review only in ${lang==='uk'?'Ukrainian':lang==='pt'?'Portuguese':'English'}. Do not mix languages. Use only the supplied calculated facts. Aggregation is outside the scope of this report.`,
      language:lang==='uk'?'Ukrainian':lang==='pt'?'Portuguese':'English',
      planDate:planDateEl.value,
      facts:{
        totalRequirements:rows.length,
        statuses:{
          overdue:actionOverdue.length,
          actionRequired:actionRequired.length,
          planning:rows.filter(r=>r.status==='planning').length
        },
        needByDatePassed:needByPassed.length,
        pipeline90:{
          days0to30:actionRequired.length,
          days31to60:p3160.length,
          days61to90:p6190.length
        },
        totalsByCurrency,
        criticality:{
          emergency:rows.filter(r=>r.criticality==='emergency').length,
          urgent:rows.filter(r=>r.criticality==='urgent').length,
          regular:rows.filter(r=>r.criticality==='regular').length
        },
        dataReadiness:{
          incompletePlanningRecords:incomplete.length,
          missingOrZeroValue:missingOrZeroValue.length
        },
        topDepartments180Days:topDepartments,
        topCategories180Days:topCategories,
        needByDatePassedRequirements:[...needByPassed].sort((a,b)=>a.daysRemaining-b.daysRemaining).map(aiRequirement),
        actionOverdueRequirements:[...actionOverdue].sort((a,b)=>a.daysRemaining-b.daysRemaining).map(aiRequirement),
        actionRequiredRequirements:[...actionRequired].sort((a,b)=>a.daysRemaining-b.daysRemaining).map(aiRequirement),
        pipeline31to60Requirements:[...p3160].sort((a,b)=>a.daysRemaining-b.daysRemaining).map(aiRequirement),
        pipeline61to90Requirements:[...p6190].sort((a,b)=>a.daysRemaining-b.daysRemaining).map(aiRequirement),
        criticalUpcomingRequirements:[...criticalUpcoming].sort((a,b)=>a.daysRemaining-b.daysRemaining).map(aiRequirement)
      }
    };
  }

  function renderAiFacts(rows){
    const box=document.getElementById('aiFacts'); if(!box)return;
    box.innerHTML=`<h3>${escapeHtml(t('aiFactsHeading'))}</h3><pre>${escapeHtml(JSON.stringify(buildAiReviewPayload(rows),null,2))}</pre>`;
  }

  function fmtCount(n){
    return Number(n||0).toLocaleString(lang==='uk'?'uk-UA':lang==='pt'?'pt-PT':'en-US');
  }

  function fmtMoney(v,c){
    const n=Number(v||0);
    return `${c} ${n.toLocaleString(lang==='uk'?'uk-UA':lang==='pt'?'pt-PT':'en-US',{maximumFractionDigits:0})}`;
  }

  function aiLabels(){
    return {
      en:{
        dashboard:'Executive Planning Dashboard',
        planningPosition:'Planning position',
        metric:'Metric',value:'Value',
        total:'Total requirements',
        passed:'Need-by date already passed',
        overdue:'Procurement start overdue',
        required:'Action required within 30 days',
        p3160:'Forward pipeline 31–60 days',
        p6190:'Forward pipeline 61–90 days',
        spend:'Current planned spend by currency',
        currency:'Currency',
        managementSummary:'Management Summary',
        attention:'Priority Management Attention',
        req:'Requirement',dept:'Department',needBy:'Need-by',start:'Procurement start',timing:'Timing',criticality:'Criticality',amount:'Value',
        pipeline:'Forward Procurement Outlook',
        window:'Window',count:'Count',interpretation:'Management interpretation',
        actionNow:'Action now (0–30 days)',
        prep:'Preparation window — 31–60 days',
        upcoming:'Upcoming pipeline — 61–90 days',
        concentration:'Demand & Workload Concentration',
        topDepartments:'Departments with most requirements',
        topCategories:'Categories with most requirements',
        name:'Name',requirements:'Requirements',
        dataReadiness:'Data Readiness',
        incomplete:'Incomplete planning records',
        missingValue:'Missing/zero estimated value',
        decisions:'Management Decisions / Actions',
        noPriority:'No current priority exceptions were identified from the supplied plan facts.',
        noConcentration:'No material demand concentration requiring separate management interpretation was identified.'
      },
      uk:{
        dashboard:'Огляд стану плану',
        planningPosition:'Стан плану',
        metric:'Показник',value:'Значення',
        total:'Усього потреб',
        passed:'Дата потреби вже минула',
        overdue:'Початок закупівлі прострочено',
        required:'Дії потрібні протягом 30 днів',
        p3160:'Майбутній план 31–60 днів',
        p6190:'Майбутній план 61–90 днів',
        spend:'Планові витрати за валютами',
        currency:'Валюта',
        managementSummary:'Управлінський висновок',
        attention:'Пріоритетна увага керівництва',
        req:'Потреба',dept:'Підрозділ',needBy:'Дата потреби',start:'Початок закупівлі',timing:'Строк',criticality:'Критичність',amount:'Вартість',
        pipeline:'Майбутній план закупівель',
        window:'Вікно',count:'Кількість',interpretation:'Управлінська інтерпретація',
        actionNow:'Дії зараз (0–30 днів)',
        prep:'Підготовче вікно — 31–60 днів',
        upcoming:'Майбутній план — 61–90 днів',
        concentration:'Концентрація попиту та навантаження',
        topDepartments:'Підрозділи з найбільшою кількістю потреб',
        topCategories:'Категорії з найбільшою кількістю потреб',
        name:'Назва',requirements:'Кількість потреб',
        dataReadiness:'Готовність даних',
        incomplete:'Неповні записи планування',
        missingValue:'Відсутня/нульова оцінка вартості',
        decisions:'Управлінські рішення / дії',
        noPriority:'За наданими даними плану поточних пріоритетних винятків не виявлено.',
        noConcentration:'Суттєвої концентрації попиту, що потребує окремої управлінської інтерпретації, не виявлено.'
      },
      pt:{
        dashboard:'Painel Executivo do Plano',
        planningPosition:'Posição do plano',
        metric:'Indicador',value:'Valor',
        total:'Total de necessidades',
        passed:'Data de necessidade já ultrapassada',
        overdue:'Início da compra em atraso',
        required:'Ação necessária nos próximos 30 dias',
        p3160:'Pipeline futuro 31–60 dias',
        p6190:'Pipeline futuro 61–90 dias',
        spend:'Despesa planeada por moeda',
        currency:'Moeda',
        managementSummary:'Resumo da Gestão',
        attention:'Atenção Prioritária da Gestão',
        req:'Necessidade',dept:'Departamento',needBy:'Data de necessidade',start:'Início da compra',timing:'Prazo',criticality:'Criticidade',amount:'Valor',
        pipeline:'Perspetiva Futura de Compras',
        window:'Janela',count:'Quantidade',interpretation:'Interpretação da gestão',
        actionNow:'Ação agora (0–30 dias)',
        prep:'Janela de preparação — 31–60 dias',
        upcoming:'Pipeline futuro — 61–90 dias',
        concentration:'Concentração da Procura e Carga de Trabalho',
        topDepartments:'Departamentos com mais necessidades',
        topCategories:'Categorias com mais necessidades',
        name:'Nome',requirements:'Necessidades',
        dataReadiness:'Qualidade dos Dados',
        incomplete:'Registos de planeamento incompletos',
        missingValue:'Valor estimado em falta/zero',
        decisions:'Decisões / Ações de Gestão',
        noPriority:'Não foram identificadas exceções prioritárias atuais nos dados fornecidos.',
        noConcentration:'Não foi identificada concentração material da procura que exija interpretação separada da gestão.'
      }
    }[lang];
  }

  function priorityRows(rows){
    const passed=rows.filter(r=>daysBetween(r.needByDate,planDateEl.value)<0);
    const overdue=rows.filter(r=>r.status==='overdue'&&daysBetween(r.needByDate,planDateEl.value)>=0);
    const required=rows.filter(r=>r.status==='required');

    const score=r=>(r.criticality==='emergency'?3:r.criticality==='urgent'?2:1)*1e15 + Number(r.estimatedValue||0);
    const chosen=[...passed,...overdue,...required].sort((a,b)=>score(b)-score(a)||a.daysRemaining-b.daysRemaining);
    const seen=new Set();
    return chosen.filter(r=>{
      const k=r.id||`${r.title}-${r.needByDate}`;
      if(seen.has(k)) return false;
      seen.add(k); return true;
    }).slice(0,6);
  }

  function renderDeterministicAiSummary(rows, aiData=null){
    const root=document.getElementById('aiReviewOutput');
    if(!root)return;
    const L=aiLabels();

    const needByPassed=rows.filter(r=>daysBetween(r.needByDate,planDateEl.value)<0).length;
    const overdue=rows.filter(r=>r.status==='overdue'&&daysBetween(r.needByDate,planDateEl.value)>=0).length;
    const requiredRows=rows.filter(r=>r.status==='required');
    const pipeline=getPipeline90(rows);
    const p3160=pipeline.days31to60;
    const p6190=pipeline.days61to90;
    const totals=rows.reduce((a,r)=>{a[r.currency]=(a[r.currency]||0)+Number(r.estimatedValue||0);return a},{});
    const next180=rows.filter(r=>r.daysRemaining>=0&&r.daysRemaining<=180);
    const topDepartments=topCounts(next180,r=>r.department,5).map(([k,count])=>[t('departments')[k],count]);
    const topCategories=topCounts(next180,r=>r.segment,5).map(([k,count])=>[t('segments')[k],count]);
    const incomplete=rows.filter(r=>!r.department||!r.segment||!r.buyingChannel||!r.needByDate||!r.criticality||!Number.isFinite(Number(r.estimatedValue))||Number(r.estimatedValue)<=0).length;
    const missingValue=rows.filter(r=>!Number.isFinite(Number(r.estimatedValue))||Number(r.estimatedValue)<=0).length;

    const metricRows=[
      [L.total,rows.length],
      [L.passed,needByPassed],
      [L.overdue,overdue],
      [L.required,requiredRows.length],
      [L.p3160,p3160.length],
      [L.p6190,p6190.length]
    ].map(([k,v])=>`<tr><td>${escapeHtml(k)}</td><td class="num">${fmtCount(v)}</td></tr>`).join('');

    const spendRows=Object.entries(totals)
      .filter(([,v])=>Number(v)!==0)
      .map(([c,v])=>`<tr><td>${escapeHtml(c)}</td><td class="num">${escapeHtml(fmtMoney(v,c))}</td></tr>`).join('');

    const pRows=priorityRows(rows).map(r=>{
      const timing=r.status==='overdue' ? `${Math.abs(Number(r.daysRemaining||0))} ${lang==='uk'?'дн. прострочено':lang==='pt'?'dias em atraso':'days overdue'}`
        : `${Number(r.daysRemaining||0)} ${lang==='uk'?'дн.':lang==='pt'?'dias':'days'}`;
      return `<tr>
        <td>${escapeHtml(titleFor(r))}</td>
        <td>${escapeHtml(departmentFor(r))}</td>
        <td>${escapeHtml(r.needByDate||'—')}</td>
        <td>${escapeHtml(r.requiredStart||'—')}</td>
        <td>${escapeHtml(timing)}</td>
        <td>${escapeHtml(t('criticalities')[r.criticality]||r.criticality||'—')}</td>
        <td class="num">${escapeHtml(fmtMoney(r.estimatedValue,r.currency))}</td>
      </tr>`;
    }).join('');

    const pipelineRows=[
      [L.actionNow,requiredRows.length,aiData?.pipelineInterpretation?.actionNow||''],
      [L.prep,p3160.length,aiData?.pipelineInterpretation?.days31to60||''],
      [L.upcoming,p6190.length,aiData?.pipelineInterpretation?.days61to90||'']
    ].map(([w,c,i])=>`<tr><td>${escapeHtml(w)}</td><td class="num">${fmtCount(c)}</td><td>${escapeHtml(i)}</td></tr>`).join('');

    const deptRows=topDepartments.map(([n,c])=>`<tr><td>${escapeHtml(n)}</td><td class="num">${fmtCount(c)}</td></tr>`).join('');
    const catRows=topCategories.map(([n,c])=>`<tr><td>${escapeHtml(n)}</td><td class="num">${fmtCount(c)}</td></tr>`).join('');

    const readiness=(incomplete>0||missingValue>0) ? `
      <div class="report-subsection">
        <h3>${escapeHtml(L.dataReadiness)}</h3>
        <div class="table-scroll"><table class="report-table compact">
          <tbody>
            <tr><td>${escapeHtml(L.incomplete)}</td><td class="num">${fmtCount(incomplete)}</td></tr>
            <tr><td>${escapeHtml(L.missingValue)}</td><td class="num">${fmtCount(missingValue)}</td></tr>
          </tbody>
        </table></div>
      </div>` : '';

    const actions=(aiData?.actions||[]).slice(0,4).map(x=>`<li>${escapeHtml(x)}</li>`).join('');

    root.innerHTML=`
      <div class="app-ai-report">

        <section class="report-section">
          <h2>${escapeHtml(L.dashboard)}</h2>
          <div class="dashboard-grid">
            <div class="dashboard-card">
              <h3>${escapeHtml(L.planningPosition)}</h3>
              <div class="table-scroll"><table class="report-table">
                <thead><tr><th>${escapeHtml(L.metric)}</th><th>${escapeHtml(L.value)}</th></tr></thead>
                <tbody>${metricRows}</tbody>
              </table></div>
            </div>
            <div class="dashboard-card spend-card">
              <h3>${escapeHtml(L.spend)}</h3>
              <div class="table-scroll"><table class="report-table">
                <thead><tr><th>${escapeHtml(L.currency)}</th><th>${escapeHtml(L.value)}</th></tr></thead>
                <tbody>${spendRows}</tbody>
              </table></div>
            </div>
          </div>
        </section>

        <section class="report-section management-summary">
          <h2>${escapeHtml(L.managementSummary)}</h2>
          <p>${escapeHtml(aiData?.managementSummary||'')}</p>
        </section>

        <section class="report-section">
          <h2>${escapeHtml(L.attention)}</h2>
          ${pRows?`<div class="table-scroll"><table class="report-table priority-table">
            <thead><tr>
              <th>${escapeHtml(L.req)}</th><th>${escapeHtml(L.dept)}</th><th>${escapeHtml(L.needBy)}</th>
              <th>${escapeHtml(L.start)}</th><th>${escapeHtml(L.timing)}</th><th>${escapeHtml(L.criticality)}</th><th>${escapeHtml(L.amount)}</th>
            </tr></thead><tbody>${pRows}</tbody></table></div>`:`<p>${escapeHtml(L.noPriority)}</p>`}
          ${aiData?.priorityInterpretation?`<p class="management-note">${escapeHtml(aiData.priorityInterpretation)}</p>`:''}
        </section>

        <section class="report-section">
          <h2>${escapeHtml(L.pipeline)}</h2>
          <div class="table-scroll"><table class="report-table pipeline-table">
            <thead><tr><th>${escapeHtml(L.window)}</th><th>${escapeHtml(L.count)}</th><th>${escapeHtml(L.interpretation)}</th></tr></thead>
            <tbody>${pipelineRows}</tbody>
          </table></div>
        </section>

        <section class="report-section">
          <h2>${escapeHtml(L.concentration)}</h2>
          <div class="concentration-grid">
            <div>
              <h3>${escapeHtml(L.topDepartments)}</h3>
              <div class="table-scroll"><table class="report-table compact"><thead><tr><th>${escapeHtml(L.name)}</th><th>${escapeHtml(L.requirements)}</th></tr></thead><tbody>${deptRows}</tbody></table></div>
            </div>
            <div>
              <h3>${escapeHtml(L.topCategories)}</h3>
              <div class="table-scroll"><table class="report-table compact"><thead><tr><th>${escapeHtml(L.name)}</th><th>${escapeHtml(L.requirements)}</th></tr></thead><tbody>${catRows}</tbody></table></div>
            </div>
          </div>
          ${aiData?.concentrationInterpretation?`<p class="management-note">${escapeHtml(aiData.concentrationInterpretation)}</p>`:`<p class="management-note muted">${escapeHtml(L.noConcentration)}</p>`}
          ${readiness}
        </section>

        <section class="report-section">
          <h2>${escapeHtml(L.decisions)}</h2>
          <ol class="decision-list">${actions}</ol>
        </section>
      </div>`;
  }

  function renderAiText(text){
    let parsed=null;
    try{
      parsed=typeof text==='string'?JSON.parse(text):text;
    }catch(e){
      const m=String(text||'').match(/\{[\s\S]*\}/);
      if(m){ try{ parsed=JSON.parse(m[0]); }catch(_e){} }
    }
    renderDeterministicAiSummary(calculated(),parsed||{});
  }

  async function generateAiReview(){
    const status=document.getElementById('aiStatus'), btn=document.getElementById('generateAiReview');
    if(!cfg.aiEndpoint){status.textContent=t('aiNotConfigured');return;}
    btn.disabled=true; status.textContent=t('aiGenerating');
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),cfg.aiTimeoutMs||45000);
    try{
      const response=await fetch(cfg.aiEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(buildAiReviewPayload(calculated())),signal:controller.signal});
      if(!response.ok){
        let errorData={};
        try{ errorData=await response.json(); }catch{}
        if(response.status===429 && (errorData.code==='DAILY_LIMIT'||errorData.error==='DAILY_LIMIT')){
          status.textContent=t('aiDailyLimit');
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const data=await response.json();
      const text=data.review ?? data.commentary ?? data.analysis ?? data.text ?? data.output;
      if(typeof text!=='string'||!text.trim()) throw new Error('No review text returned');
      renderAiText(text); status.textContent=t('aiGenerated');
    }catch(err){console.error(err);status.textContent=t('aiError');}
    finally{clearTimeout(timer);btn.disabled=false;}
  }

  function renderActivity(){
    const list=document.getElementById('activityList'),empty=document.getElementById('activityEmpty');
    empty.classList.toggle('hidden',activityLog.length>0);
    const actionKey={added:'activityAdded',edited:'activityEdited',deleted:'activityDeleted',approved:'activityApproved',rejected:'activityRejected',deferred:'activityDeferred',reset:'activityReset'};
    list.innerHTML=activityLog.map(x=>`<div class="activity-item"><div class="activity-time">${new Intl.DateTimeFormat(lang==='uk'?'uk-UA':lang==='pt'?'pt-PT':'en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(x.ts))}</div><div class="activity-action">${escapeHtml(t(actionKey[x.action]||x.action))}</div><div class="activity-detail">${escapeHtml(x.detail||'')}</div></div>`).join('');
  }
  function renderProcessMap(rows){
    const count=status=>rows.filter(r=>r.status===status).length;
    const pipeline=getPipeline90(rows).all.length;
    const opportunities=detectAggregation(rows);
    const approved=[...aggregationDecisions.values()].filter(x=>x.decision==='approved').length;
    const values=planRefreshed?{
      processTotal:rows.length,
      processOverdue:count('overdue'),
      processRequired:count('required'),
      processPipeline:pipeline,
      processOpportunities:opportunities.length,
      processApproved:approved
    }:{processTotal:'—',processOverdue:'—',processRequired:'—',processPipeline:'—',processOpportunities:'—',processApproved:'—'};
    Object.entries(values).forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.textContent=value});
  }
  function updateRefreshState(){
    document.body.classList.toggle('plan-not-refreshed',!planRefreshed);
    document.getElementById('preRefreshState')?.classList.toggle('hidden',planRefreshed);
    document.getElementById('kpis')?.classList.toggle('hidden',!planRefreshed);
    ['ctaAggregation','ctaAi'].forEach(id=>{const el=document.getElementById(id);if(el){el.classList.toggle('disabled',!planRefreshed);el.setAttribute('aria-disabled',String(!planRefreshed))}});
  }
  function render(){ const rows=calculated(); updateRefreshState(); renderProcessMap(rows); if(!planRefreshed)return; renderKpis(rows); renderManagementReview(rows); renderDeterministicAiSummary(rows); renderTable(filteredRows(rows)); renderAggregation(rows); renderActivity(); if(!document.getElementById('aiFacts')?.classList.contains('hidden')) renderAiFacts(rows); }

  function startEdit(id){
    const r=requirements.find(x=>x.id===id&&!x.isAggregation); if(!r)return; editingId=id;
    const f=document.getElementById('requirementForm');
    f.elements.namedItem('title').value=titleFor(r); f.elements.namedItem('description').value=descriptionFor(r);
    f.department.value=r.department; f.segment.value=r.segment; f.estimatedValue.value=r.estimatedValue; f.currency.value=r.currency; f.needByDate.value=r.needByDate; f.criticality.value=r.criticality; f.buyingChannel.value=r.buyingChannel; f.supplier.value=r.supplier||'';
    document.getElementById('formHeading').textContent=t('editRequirement'); document.getElementById('submitRequirement').textContent=t('saveChanges');
    document.querySelector('.form-section').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function endEdit(){ editingId=null; document.getElementById('formHeading').textContent=t('addNew'); document.getElementById('submitRequirement').textContent=t('addButton'); }
  function deleteRequirement(id){
    const r=requirements.find(x=>x.id===id&&x.isUserAdded); if(!r||!confirm(t('confirmDelete')))return;
    requirements=requirements.filter(x=>x.id!==id);
    for(const [key,state] of [...aggregationDecisions.entries()]) if(key.split('-').map(Number).includes(id)) aggregationDecisions.delete(key);
    logActivity('deleted',titleFor(r)); saveState(); render();
  }

  async function translateRequirement(title,description){
    if(!cfg.aiEndpoint) throw new Error('Translation endpoint is not configured');
    const endpoint=cfg.aiEndpoint.replace(/\/review\/?$/,'/translate');
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceLanguage:lang,title,description})});
    if(!response.ok) throw new Error(`Translation HTTP ${response.status}`);
    const data=await response.json();
    const translations=data.translations;
    if(!translations||!['en','uk','pt'].every(code=>translations[code]?.title&&translations[code]?.description)) throw new Error('Incomplete translations');
    return translations;
  }

  document.querySelectorAll('[data-lang]').forEach(b=>b.addEventListener('click',()=>{lang=b.dataset.lang;saveState();applyTranslations()}));
  planDateEl.addEventListener('change',()=>{planRefreshed=false;render()});
  document.getElementById('refreshPlanButton').addEventListener('click',()=>{planRefreshed=true;render();document.getElementById('refreshSection').scrollIntoView({behavior:'smooth',block:'start'})});
  document.getElementById('ctaRefresh').addEventListener('click',()=>document.getElementById('refreshSection').scrollIntoView({behavior:'smooth',block:'start'}));
  document.getElementById('ctaAdd').addEventListener('click',()=>document.querySelector('.form-section').scrollIntoView({behavior:'smooth',block:'start'}));
  document.getElementById('ctaAggregation').addEventListener('click',e=>{if(!planRefreshed){e.preventDefault();document.getElementById('refreshSection').scrollIntoView({behavior:'smooth',block:'start'})}});
  document.getElementById('ctaAi').addEventListener('click',e=>{if(!planRefreshed){e.preventDefault();document.getElementById('refreshSection').scrollIntoView({behavior:'smooth',block:'start'})}});
  ['USD','GBP'].forEach(currency=>document.getElementById(`fx${currency}`).addEventListener('input',e=>{fxRates[currency]=Number(e.target.value)>0?Number(e.target.value):null;document.getElementById('aggregationFxMessage').textContent=''}));
  ['searchBox','statusFilter','departmentFilter'].forEach(id=>document.getElementById(id).addEventListener(id==='searchBox'?'input':'change',render));
  document.getElementById('resetFilters').addEventListener('click',()=>{document.getElementById('searchBox').value='';document.getElementById('statusFilter').value='';document.getElementById('departmentFilter').value='';render()});
  document.getElementById('requirementForm').addEventListener('submit',async e=>{
    e.preventDefault(); const f=e.currentTarget,fd=new FormData(f);
    const existing=editingId?requirements.find(x=>x.id===editingId):null;
    const sourceTitle=fd.get('title').trim(),sourceDescription=fd.get('description').trim();
    if(!sourceTitle||!sourceDescription||!fd.get('needByDate')||!Number(fd.get('estimatedValue'))){document.getElementById('formMessage').textContent=t('requiredFields');return}
    const submit=document.getElementById('submitRequirement');submit.disabled=true;document.getElementById('formMessage').textContent=t('translatingRequirement');
    let translated;
    try{translated=await translateRequirement(sourceTitle,sourceDescription)}catch(err){console.error(err);document.getElementById('formMessage').textContent=t('translationError');submit.disabled=false;return}
    translated[lang]={title:sourceTitle,description:sourceDescription};
    const titleI18n={en:translated.en.title,uk:translated.uk.title,pt:translated.pt.title};
    const descriptionI18n={en:translated.en.description,uk:translated.uk.description,pt:translated.pt.description};
    const r={id:editingId||Date.now(),isUserAdded:existing?Boolean(existing.isUserAdded):true,planYear:Number(fd.get('needByDate').slice(0,4)),title:titleI18n.en,description:descriptionI18n.en,titleI18n,descriptionI18n,department:fd.get('department'),segment:fd.get('segment'),estimatedValue:Number(fd.get('estimatedValue')),currency:fd.get('currency'),needByDate:fd.get('needByDate'),criticality:fd.get('criticality'),buyingChannel:fd.get('buyingChannel'),supplier:fd.get('supplier').trim()};
    if(editingId){
      requirements=requirements.map(x=>x.id===editingId?{...x,...r,aggregationGroup:x.aggregationGroup||null}:x); logActivity('edited',titleFor(r)); document.getElementById('formMessage').textContent=t('updated');
    }else{
      requirements.unshift(r); logActivity('added',titleFor(r)); document.getElementById('formMessage').textContent=t('addedAggregationCheck');
    }
    submit.disabled=false;endEdit(); f.reset(); populateSelects(); planRefreshed=false; render(); document.getElementById('refreshSection').scrollIntoView({behavior:'smooth',block:'start'});
  });
  document.getElementById('requirementForm').addEventListener('reset',()=>{setTimeout(()=>{document.getElementById('formMessage').textContent='';endEdit()},0)});
  document.getElementById('resetPlan').addEventListener('click',()=>{if(!confirm(t('confirmReset')))return;requirements=window.SAMPLE_REQUIREMENTS.map(x=>({...x,...(window.SAMPLE_REQUIREMENT_I18N?.[x.id]||{})}));aggregationDecisions.clear();nextAggregationNo=1;editingId=null;planRefreshed=false;fxRates.USD=null;fxRates.GBP=null;document.getElementById('fxUSD').value='';document.getElementById('fxGBP').value='';logActivity('reset','');render();});
  document.getElementById('clearActivity').addEventListener('click',()=>{if(!confirm(t('confirmClearActivity')))return;activityLog=[];saveState();renderActivity();});
  document.getElementById('generateAiReview').addEventListener('click',generateAiReview);
  document.getElementById('showAiFacts').addEventListener('click',()=>{const box=document.getElementById('aiFacts'),btn=document.getElementById('showAiFacts');const willShow=box.classList.contains('hidden');box.classList.toggle('hidden',!willShow);btn.textContent=willShow?t('hideAiFacts'):t('showAiFacts');if(willShow)renderAiFacts(calculated());});
  const main=document.querySelector('main.container');
  [
    document.getElementById('solutionIntro'),
    document.querySelector('.demo-guide'),
    document.getElementById('refreshSection'),
    document.getElementById('planSection'),
    document.querySelector('.form-section'),
    document.getElementById('aggregationSection'),
    document.getElementById('managementSection'),
    document.getElementById('aiSection'),
    document.querySelector('.activity-section')
  ].filter(Boolean).forEach(section=>main.appendChild(section));
  applyTranslations();
})();
