(() => {
  const cfg = window.APP_CONFIG, dict = window.I18N;
  let lang = cfg.defaultLanguage;
  let requirements = window.SAMPLE_REQUIREMENTS.map(x => ({...x}));
  const planDateEl = document.getElementById('planDate');
  const today = new Date();
  planDateEl.value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const t = key => key.split('.').reduce((o,k)=>o?.[k], dict[lang]) ?? key;
  const parseISO = s => { const [y,m,d]=s.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); };
  const fmtDate = s => new Intl.DateTimeFormat(lang==='uk'?'uk-UA':lang==='pt'?'pt-PT':'en-GB',{year:'numeric',month:'short',day:'2-digit',timeZone:'UTC'}).format(parseISO(s));
  const addDays = (iso, delta) => { const d=parseISO(iso); d.setUTCDate(d.getUTCDate()+delta); return d.toISOString().slice(0,10); };
  const daysBetween = (a,b) => Math.trunc((parseISO(a)-parseISO(b))/86400000);
  const money = (n,c) => new Intl.NumberFormat(lang==='uk'?'uk-UA':lang==='pt'?'pt-PT':'en-US',{style:'currency',currency:c,maximumFractionDigits:0}).format(n);
  const statusFor = d => d < 0 ? 'overdue' : d <= 30 ? 'required' : 'planning';
  const statusLabel = s => s==='overdue'?t('overdue'):s==='required'?t('required'):t('planning');

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
    f.criticality.innerHTML=['high','medium','low'].map(k=>option(k,t(k))).join('');
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
      <td><div class="req-title">${escapeHtml(r.title)}</div><div class="muted">${escapeHtml(r.description)}</div></td>
      <td>${t('departments')[r.department]}</td><td>${t('segments')[r.segment]}</td><td>${money(r.estimatedValue,r.currency)}</td>
      <td>${fmtDate(r.needByDate)}</td><td>${t('channels')[r.buyingChannel]}<div class="muted">S2C: ${r.s2cDays} ${t('days')}</div></td>
      <td>${fmtDate(r.requiredStart)}</td><td class="${r.daysRemaining<0?'days-negative':''}">${r.daysRemaining}</td><td><span class="status ${r.status}">${statusLabel(r.status)}</span></td>
    </tr>`).join('');
    empty.classList.toggle('hidden',rows.length>0); document.querySelector('.table-wrap').classList.toggle('hidden',rows.length===0);
  }
  const escapeHtml=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  function render(){ const rows=calculated(); renderKpis(rows); renderTable(filteredRows(rows)); }

  document.querySelectorAll('[data-lang]').forEach(b=>b.addEventListener('click',()=>{lang=b.dataset.lang;applyTranslations()}));
  planDateEl.addEventListener('change',render);
  ['searchBox','statusFilter','departmentFilter'].forEach(id=>document.getElementById(id).addEventListener(id==='searchBox'?'input':'change',render));
  document.getElementById('resetFilters').addEventListener('click',()=>{document.getElementById('searchBox').value='';document.getElementById('statusFilter').value='';document.getElementById('departmentFilter').value='';render()});
  document.getElementById('requirementForm').addEventListener('submit',e=>{
    e.preventDefault(); const f=e.currentTarget,fd=new FormData(f);
    const r={id:Date.now(),planYear:Number(fd.get('needByDate').slice(0,4)),title:fd.get('title').trim(),description:fd.get('description').trim(),department:fd.get('department'),segment:fd.get('segment'),estimatedValue:Number(fd.get('estimatedValue')),currency:fd.get('currency'),needByDate:fd.get('needByDate'),criticality:fd.get('criticality'),buyingChannel:fd.get('buyingChannel'),supplier:fd.get('supplier').trim()};
    if(!r.title||!r.description||!r.needByDate||!r.estimatedValue){document.getElementById('formMessage').textContent=t('requiredFields');return}
    requirements.unshift(r); document.getElementById('formMessage').textContent=t('added'); f.reset(); populateSelects(); render(); document.querySelector('.table-wrap').scrollIntoView({behavior:'smooth',block:'start'});
  });
  document.getElementById('requirementForm').addEventListener('reset',()=>{setTimeout(()=>document.getElementById('formMessage').textContent='',0)});
  applyTranslations();
})();
