(() => {
  const cfg = window.APP_CONFIG, dict = window.I18N;
  let lang = cfg.defaultLanguage;
  let requirements = window.SAMPLE_REQUIREMENTS.map(x => ({...x}));
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
    return rows.filter(r=>(!q||`${r.title} ${r.description} ${r.supplier}`.toLowerCase().includes(q))&&(!s||r.status===s)&&(!d||r.department===d));
  }

  function renderTable(rows){
    const target=document.getElementById('planRows'),empty=document.getElementById('emptyState');
    target.innerHTML=rows.map(r=>`<tr>
      <td><div class="req-title">${escapeHtml(r.title)}</div><div class="muted">${escapeHtml(r.description)}</div>${r.aggregationGroup?`<div class="group-tag">${escapeHtml(r.aggregationGroup)}</div>`:''}</td>
      <td>${t('departments')[r.department]}</td><td>${t('segments')[r.segment]}</td><td>${money(r.estimatedValue,r.currency)}</td>
      <td>${fmtDate(r.needByDate)}</td><td>${t('channels')[r.buyingChannel]}<div class="muted">S2C: ${r.s2cDays} ${t('days')}</div></td>
      <td>${fmtDate(r.requiredStart)}</td><td class="${r.daysRemaining<0?'days-negative':''}">${r.daysRemaining}</td><td><span class="status ${r.status}">${statusLabel(r.status)}</span></td>
      <td>${r.isUserAdded?`<div class="row-actions"><button class="secondary edit-row" data-id="${r.id}">${t('edit')}</button><button class="secondary delete-row" data-id="${r.id}">${t('delete')}</button></div>`:'—'}</td>
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
        title:`Aggregated – ${first.title}`,
        description:`Approved aggregation ${groupId}. Consolidated from ${opp.members.length} APP requirements.`,
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
    logActivity(decision==='approved'?'approved':decision==='rejected'?'rejected':'deferred', `${groupId||''} ${opp.members.map(r=>r.title).join(' + ')}`.trim());
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
    const immediateHtml=immediate.length?`<div class="review-list">${immediate.slice(0,5).map(r=>`<div class="review-item"><div><strong>${escapeHtml(r.title)}</strong><span>${escapeHtml(t('departments')[r.department])} · ${statusLabel(r.status)} · ${t('startingIn')} ${r.daysRemaining} ${t('daysUnit')}</span></div><div class="review-value">${money(r.estimatedValue,r.currency)}</div></div>`).join('')}</div>`:`<div class="review-empty">${t('noImmediatePriorities')}</div>`;
    const highValueHtml=highValue.length?`<div class="review-list">${highValue.map(r=>`<div class="review-item"><div><strong>${escapeHtml(r.title)}</strong><span>${escapeHtml(t('departments')[r.department])} · ${fmtDate(r.requiredStart)}</span></div><div class="review-value">${money(r.estimatedValue,r.currency)}</div></div>`).join('')}</div>`:`<div class="review-empty">${t('noUpcomingItems')}</div>`;
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
    const immediate=rows.filter(r=>r.status==='overdue'||r.status==='required');
    const pipeline90=getPipeline90(rows);
    const pipeline={
      days0to30:pipeline90.days0to30.length,
      days31to60:pipeline90.days31to60.length,
      days61to90:pipeline90.days61to90.length
    };
    const next180=rows.filter(r=>r.daysRemaining>=0&&r.daysRemaining<=180);
    const opportunities=detectAggregation(rows);
    const aggregation={pending:0,approved:0,rejected:0,deferred:0};
    opportunities.forEach(o=>{const d=aggregationDecisions.get(o.key)?.decision||'pending'; aggregation[d]=(aggregation[d]||0)+1;});
    const totalsByCurrency=rows.reduce((a,r)=>{a[r.currency]=(a[r.currency]||0)+Number(r.estimatedValue);return a},{});
    const aiRequirement=r=>({
      id:r.id,
      title:r.title,
      department:t('departments')[r.department],
      segment:t('segments')[r.segment],
      value:r.estimatedValue,
      currency:r.currency,
      needByDate:r.needByDate,
      requiredProcurementStart:r.requiredStart,
      daysRemaining:r.daysRemaining,
      status:r.status,
      criticality:t('criticalities')[r.criticality]
    });
    const topRequirements=[...rows].filter(r=>r.daysRemaining>=0).sort((a,b)=>b.estimatedValue-a.estimatedValue).slice(0,5).map(aiRequirement);
    const immediateAttentionRequirements=[...immediate].sort((a,b)=>a.daysRemaining-b.daysRemaining).map(aiRequirement);
    const pipeline90Requirements=[...pipeline90.all].sort((a,b)=>a.daysRemaining-b.daysRemaining).map(aiRequirement);
    const urgentEmergencyRequirements=rows.filter(r=>r.criticality==='emergency'||r.criticality==='urgent').sort((a,b)=>a.daysRemaining-b.daysRemaining).map(aiRequirement);
    const aggregationOpportunities=opportunities.map((o,idx)=>{
      const state=aggregationDecisions.get(o.key);
      const decision=state?.decision||'pending';
      const totalsByCurrency=o.members.reduce((a,r)=>{a[r.currency]=(a[r.currency]||0)+Number(r.estimatedValue);return a},{});
      const needDates=o.members.map(r=>r.needByDate).sort();
      const departments=[...new Set(o.members.map(r=>t('departments')[r.department]))];
      const segments=[...new Set(o.members.map(r=>t('segments')[r.segment]))];
      return {
        opportunityId:`OPP-${String(idx+1).padStart(3,'0')}`,
        opportunityKey:o.key,
        decision,
        groupId:state?.groupId||'',
        confidence:{label:confidence(o.score),score:o.score},
        rationale:o.reasons.map(reasonText),
        departments,
        segments,
        combinedValueByCurrency:totalsByCurrency,
        timing:{
          earliestNeedByDate:needDates[0]||'',
          latestNeedByDate:needDates[needDates.length-1]||'',
          spreadDays:needDates.length>1?absDaysBetween(needDates[0],needDates[needDates.length-1]):0
        },
        requirements:o.members.map(aiRequirement)
      };
    });
    const topDepartments=topCounts(next180,r=>r.department,5).map(([k,count])=>({department:t('departments')[k],requirements:count}));
    const topCategories=topCounts(next180,r=>r.segment,5).map(([k,count])=>({category:t('segments')[k],requirements:count}));
    return {
      task:'Provide concise procurement-management commentary based only on the supplied calculated facts. Do not invent facts, approve aggregations, or modify the plan. Distinguish observed facts from recommendations.',
      language:lang==='uk'?'Ukrainian':lang==='pt'?'Portuguese':'English',
      planDate:planDateEl.value,
      facts:{
        totalRequirements:rows.length,
        statuses:{overdue:rows.filter(r=>r.status==='overdue').length,actionRequired:rows.filter(r=>r.status==='required').length,planning:rows.filter(r=>r.status==='planning').length},
        immediateAttention:immediate.length,
        pipeline90:pipeline,
        totalsByCurrency,
        criticality:{emergency:rows.filter(r=>r.criticality==='emergency').length,urgent:rows.filter(r=>r.criticality==='urgent').length,regular:rows.filter(r=>r.criticality==='regular').length},
        aggregation,
        topDepartments180Days:topDepartments,
        topCategories180Days:topCategories,
        topUpcomingRequirements:topRequirements,
        immediateAttentionRequirements,
        pipeline90Requirements,
        urgentEmergencyRequirements,
        aggregationOpportunities
      }
    };
  }

  function renderAiFacts(rows){
    const box=document.getElementById('aiFacts'); if(!box)return;
    box.innerHTML=`<h3>${escapeHtml(t('aiFactsHeading'))}</h3><pre>${escapeHtml(JSON.stringify(buildAiReviewPayload(rows),null,2))}</pre>`;
  }

  function renderDeterministicAiSummary(rows){
    const root=document.getElementById('aiDeterministicSummary');
    if(!root)return;

    const overdue=rows.filter(r=>r.status==='overdue').length;
    const required=rows.filter(r=>r.status==='required').length;
    const immediate=overdue+required;
    const pipeline=getPipeline90(rows);
    const p030=pipeline.days0to30.length;
    const p3160=pipeline.days31to60.length;
    const p6190=pipeline.days61to90.length;

    let trendKey='pipelineMixed';
    if(p030<p3160 && p3160<p6190) trendKey='pipelineIncreasing';
    else if(p030>p3160 && p3160>p6190) trendKey='pipelineDecreasing';
    else if(p030===p3160 && p3160===p6190) trendKey='pipelineStable';

    root.innerHTML=`
      <section class="ai-deterministic-section">
        <h3>${escapeHtml(t('overallSituation'))}</h3>
        <div class="ai-signal-grid">
          <div class="ai-signal-card">
            <span>${escapeHtml(t('planHealth'))}</span>
            <strong>${immediate}</strong>
            <p>${escapeHtml(fillTemplate(t('planHealthDetail'),{overdue,required}))}</p>
          </div>
          <div class="ai-signal-card">
            <span>${escapeHtml(t('forwardPressure'))}</span>
            <strong>${pipeline.all.length}</strong>
            <p>${escapeHtml(t('forwardPressureDetail'))}</p>
          </div>
          <div class="ai-signal-card ai-signal-wide">
            <span>${escapeHtml(t('managementImplication'))}</span>
            <p>${escapeHtml(fillTemplate(t('overallSituationImplication'),{immediate,pipeline:pipeline.all.length}))}</p>
          </div>
        </div>
      </section>

      <section class="ai-deterministic-section">
        <h3>${escapeHtml(t('whatComingNext'))}</h3>
        <div class="ai-pipeline-grid">
          <div class="ai-pipeline-card">
            <span>0–30 ${escapeHtml(t('daysUnit'))}</span>
            <strong>${p030}</strong>
            <p>${escapeHtml(t('pipeline030Meaning'))}</p>
          </div>
          <div class="ai-pipeline-card">
            <span>31–60 ${escapeHtml(t('daysUnit'))}</span>
            <strong>${p3160}</strong>
            <p>${escapeHtml(t('pipeline3160Meaning'))}</p>
          </div>
          <div class="ai-pipeline-card">
            <span>61–90 ${escapeHtml(t('daysUnit'))}</span>
            <strong>${p6190}</strong>
            <p>${escapeHtml(t('pipeline6190Meaning'))}</p>
          </div>
        </div>
        <div class="ai-trend-line"><strong>${escapeHtml(t('trend'))}:</strong> ${escapeHtml(fillTemplate(t(trendKey),{a:p030,b:p3160,c:p6190}))}</div>
      </section>`;
  }

  function renderAiText(text){
    const root=document.getElementById('aiReviewOutput');
    const clean=String(text||'').trim();

    if(!clean){
      root.innerHTML=`<div class="review-empty">${escapeHtml(t('aiReviewEmpty'))}</div>`;
      return;
    }

    const inlineFormat = (s) => {
      const escaped = escapeHtml(s);
      return escaped.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    };

    const lines = clean.split(/\r?\n/);
    const sections = [];
    let current = null;

    const sectionNames = new Set([
      'What Needs Attention Now',
      'Where Aggregation May Help',
      'Decisions Required'
    ]);

    for(const raw of lines){
      const line = raw.trim();

      if(!line) {
        if(current) current.items.push({type:'blank'});
        continue;
      }

      if(sectionNames.has(line)){
        current = {title:line, items:[]};
        sections.push(current);
        continue;
      }

      if(!current){
        current = {title:'', items:[]};
        sections.push(current);
      }

      current.items.push({type:'line', text:line});
    }

    const renderSnapshot = (items) => {
      const rows = items
        .filter(x=>x.type==='line')
        .map(x=>`<div class="ai-snapshot-row">${inlineFormat(x.text)}</div>`)
        .join('');
      return `<div class="ai-snapshot-grid">${rows}</div>`;
    };

    const renderAggregation = (items) => {
      const cards = [];
      let card = null;

      for(const item of items){
        if(item.type==='blank') continue;
        const text=item.text;

        if(/^\*\*OPP-\d+/i.test(text)){
          if(card) cards.push(card);
          card={title:text, meta:[], reason:[]};
          continue;
        }

        if(!card){
          card={title:'', meta:[], reason:[]};
        }

        if(/^Why review:/i.test(text)) card.reason.push(text);
        else card.meta.push(text);
      }

      if(card) cards.push(card);

      return `<div class="ai-aggregation-grid">${cards.map(c=>`
        <article class="ai-aggregation-card">
          ${c.title?`<h4>${inlineFormat(c.title)}</h4>`:''}
          ${c.meta.map(x=>`<div class="ai-agg-meta">${inlineFormat(x)}</div>`).join('')}
          ${c.reason.map(x=>`<div class="ai-agg-reason">${inlineFormat(x)}</div>`).join('')}
        </article>`).join('')}</div>`;
    };

    const renderPriority = (items) => {
      return `<div class="ai-priority-list">${items
        .filter(x=>x.type==='line')
        .map(x=>`<div class="ai-priority-row">${inlineFormat(x.text)}</div>`)
        .join('')}</div>`;
    };

    const renderPipeline = (items) => {
      return `<div class="ai-text-block">${items
        .filter(x=>x.type==='line')
        .map(x=>`<p>${inlineFormat(x.text)}</p>`)
        .join('')}</div>`;
    };

    const renderActions = (items) => {
      return `<ul class="ai-action-list">${items
        .filter(x=>x.type==='line')
        .map(x=>`<li>${inlineFormat(x.text.replace(/^[-•]\s*/,''))}</li>`)
        .join('')}</ul>`;
    };

    root.innerHTML = sections.map(section=>{
      let body='';
      switch(section.title){
        case 'What Needs Attention Now': body=renderPriority(section.items); break;
        case 'Where Aggregation May Help': body=renderAggregation(section.items); break;
        case 'Decisions Required': body=renderActions(section.items); break;
        default: body=renderPipeline(section.items);
      }

      return `<section class="ai-review-section">
        ${section.title?`<h3>${escapeHtml(section.title)}</h3>`:''}
        ${body}
      </section>`;
    }).join('');
  }

  async function generateAiReview(){
    const status=document.getElementById('aiStatus'), btn=document.getElementById('generateAiReview');
    if(!cfg.aiEndpoint){status.textContent=t('aiNotConfigured');return;}
    btn.disabled=true; status.textContent=t('aiGenerating');
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),cfg.aiTimeoutMs||45000);
    try{
      const response=await fetch(cfg.aiEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(buildAiReviewPayload(calculated())),signal:controller.signal});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
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
    const r=requirements.find(x=>x.id===id&&x.isUserAdded); if(!r)return; editingId=id;
    const f=document.getElementById('requirementForm');
    f.title.value=r.title; f.description.value=r.description; f.department.value=r.department; f.segment.value=r.segment; f.estimatedValue.value=r.estimatedValue; f.currency.value=r.currency; f.needByDate.value=r.needByDate; f.criticality.value=r.criticality; f.buyingChannel.value=r.buyingChannel; f.supplier.value=r.supplier||'';
    document.getElementById('formHeading').textContent=t('editRequirement'); document.getElementById('submitRequirement').textContent=t('saveChanges');
    document.querySelector('.form-section').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function endEdit(){ editingId=null; document.getElementById('formHeading').textContent=t('addNew'); document.getElementById('submitRequirement').textContent=t('addButton'); }
  function deleteRequirement(id){
    const r=requirements.find(x=>x.id===id&&x.isUserAdded); if(!r||!confirm(t('confirmDelete')))return;
    requirements=requirements.filter(x=>x.id!==id);
    for(const [key,state] of [...aggregationDecisions.entries()]) if(key.split('-').map(Number).includes(id)) aggregationDecisions.delete(key);
    logActivity('deleted',r.title); saveState(); render();
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
  document.getElementById('requirementForm').addEventListener('submit',e=>{
    e.preventDefault(); const f=e.currentTarget,fd=new FormData(f);
    const r={id:editingId||Date.now(),isUserAdded:true,planYear:Number(fd.get('needByDate').slice(0,4)),title:fd.get('title').trim(),description:fd.get('description').trim(),department:fd.get('department'),segment:fd.get('segment'),estimatedValue:Number(fd.get('estimatedValue')),currency:fd.get('currency'),needByDate:fd.get('needByDate'),criticality:fd.get('criticality'),buyingChannel:fd.get('buyingChannel'),supplier:fd.get('supplier').trim()};
    if(!r.title||!r.description||!r.needByDate||!r.estimatedValue){document.getElementById('formMessage').textContent=t('requiredFields');return}
    if(editingId){
      requirements=requirements.map(x=>x.id===editingId?{...r,aggregationGroup:x.aggregationGroup||null}:x); logActivity('edited',r.title); document.getElementById('formMessage').textContent=t('updated');
    }else{
      requirements.unshift(r); logActivity('added',r.title); document.getElementById('formMessage').textContent=t('addedAggregationCheck');
    }
    endEdit(); f.reset(); populateSelects(); planRefreshed=false; render(); document.getElementById('refreshSection').scrollIntoView({behavior:'smooth',block:'start'});
  });
  document.getElementById('requirementForm').addEventListener('reset',()=>{setTimeout(()=>{document.getElementById('formMessage').textContent='';endEdit()},0)});
  document.getElementById('resetPlan').addEventListener('click',()=>{if(!confirm(t('confirmReset')))return;requirements=window.SAMPLE_REQUIREMENTS.map(x=>({...x}));aggregationDecisions.clear();nextAggregationNo=1;editingId=null;planRefreshed=false;fxRates.USD=null;fxRates.GBP=null;document.getElementById('fxUSD').value='';document.getElementById('fxGBP').value='';logActivity('reset','');render();});
  document.getElementById('clearActivity').addEventListener('click',()=>{if(!confirm(t('confirmClearActivity')))return;activityLog=[];saveState();renderActivity();});
  document.getElementById('generateAiReview').addEventListener('click',generateAiReview);
  document.getElementById('showAiFacts').addEventListener('click',()=>{const box=document.getElementById('aiFacts'),btn=document.getElementById('showAiFacts');const willShow=box.classList.contains('hidden');box.classList.toggle('hidden',!willShow);btn.textContent=willShow?t('hideAiFacts'):t('showAiFacts');if(willShow)renderAiFacts(calculated());});
  const main=document.querySelector('main.container');
  [
    document.getElementById('solutionIntro'),
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
