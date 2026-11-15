/* Calendar-focused layer for It's Your Time Now, integrated through a minimal legacy bridge. */
(function(){
  'use strict';
  const app=window.IYTN_PLANNER_BRIDGE;
  if(!app){console.error('Planner bridge not available');return;}
  const baseCalendar=app.calendar(),basePaint=app.paint();
  const tabs=[['all','Всё'],['work','Работа'],['money','Финансы'],['creative','Творчество'],['relationship','Отношения'],['learning','Учёба'],['rest','Восстановление']];
  const names={good:'Подходит по традиции',neutral:'Нейтрально',caution:'Традиционно осторожнее'};
  const short={good:'Подходит',neutral:'Ровно',caution:'Внимание'};
  const mapGoal={work:'work',creative:'creative',relationship:'relationship',learning:'learning',health:'rest'};
  let active='all',cache={},busy={},lastError='';
  try{active=localStorage.getItem('iytn_planner_category')||'all';if(!tabs.some(x=>x[0]===active))active='all'}catch{}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function state(){return app.state();}
  function monthOf(st){const base=new Date(),d=new Date(base.getFullYear(),base.getMonth()+(st.monthOffset||0),1);return String(d.getFullYear())+'-'+String(d.getMonth()+1).padStart(2,'0');}
  function key(st){return monthOf(st)+'|'+(st.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC');}
  function dayStatus(day){const cat=active==='all'?null:day.categories.find(c=>c.id===active);return cat?cat.level:day.overall;}
  function isVisible(){return state().page==='calendar'&&!!document.getElementById('astro-day');}
  function header(){
    let out='<div class="astro-toolbar"><div><strong>Что делать и чего избегать</strong><p>Дневные рекомендации по астрологическим транзитам, фазам Луны и Хуанли. Выберите сферу жизни, чтобы увидеть её лучшие и осторожные дни.</p></div><div class="astro-tabs" role="group" aria-label="Сфера планирования">';
    out+=tabs.map(x=>'<button type="button" data-astro-cat="'+x[0]+'" aria-pressed="'+(x[0]===active)+'">'+x[1]+'</button>').join('');
    out+='</div></div>';
    return out;
  }
  function calendar(){
    let out=baseCalendar();
    out=out.replace('Ваш <em>календарь.</em>','Астрологический <em>планнер.</em>');
    out=out.replace('Все рассчитанные события, традиционные периоды и ваши сроки в одной временной шкале. Отметки разделены по методам и их назначению.','Календарь решений на каждый день: подходящие действия, ограничения и объяснения астрологических факторов. Реальные обязательства и сроки всегда важнее интерпретации.');
    out=out.replace('<div class="card"><div class="flex">',header()+'<div class="card"><div class="flex">');
    out=out.replace('<div class="calendar-toolbar">','<details class="astro-advanced"><summary>Традиции, фильтры и поиск событий</summary><div class="calendar-toolbar">');
    out=out.replace('<div class="calendar" id="calendar-grid">','</details><div class="astro-legend"><span><i class="astro-dot good"></i>Подходит по выбранной традиции</span><span><i class="astro-dot caution"></i>Требует осторожности</span><span><i class="astro-dot"></i>Без выраженного акцента</span></div><div class="calendar" id="calendar-grid">');
    out=out.replace('<div class="card" id="caldayevents">','<div id="astro-day" class="astro-day-panel"><div class="astro-loading">Рассчитываем рекомендации по дням…</div></div><div class="card" id="caldayevents">');
    out=out.replace('<div class="card" id="calmonthlist">','<div id="astro-month" style="margin-bottom:16px"><div class="astro-loading">Составляем обзор месяца…</div></div><div class="card" id="calmonthlist">');
    setTimeout(load,0);
    return out;
  }
  function attach(){
    document.querySelectorAll('[data-astro-cat]').forEach(btn=>{
      btn.onclick=()=>{active=btn.dataset.astroCat;try{localStorage.setItem('iytn_planner_category',active)}catch{}paint()};
    });
  }
  async function load(){
    if(!isVisible())return;
    attach();
    const st=state(),k=key(st);
    if(cache[k]){paint();return;}
    if(busy[k])return;
    busy[k]=true;
    try{
      const month=monthOf(st),tz=st.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
      const res=await fetch('/api/astro-planner?month='+encodeURIComponent(month)+'&tz='+encodeURIComponent(tz));
      const body=await res.json();
      if(!res.ok||!Array.isArray(body.days))throw Error(body.error||'Ошибка расчёта календаря');
      cache[k]=body;lastError='';
      if(isVisible()&&key(state())===k)paint();
    }catch(err){
      lastError=String(err.message||err);
      if(isVisible()&&key(state())===k)renderError(lastError);
    }finally{delete busy[k]}
  }
  function renderError(message){
    const panel=document.getElementById('astro-day');
    if(panel)panel.innerHTML='<p class="note">Не удалось рассчитать планнер: '+esc(message)+'</p><button class="secondary" type="button" id="astro-retry">Повторить</button>';
    const retry=document.getElementById('astro-retry');if(retry)retry.onclick=load;
  }
  function pretty(date){const d=new Date(date+'T12:00:00');return d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',weekday:'long'});}
  function viewCategories(day){return active==='all'?day.categories:day.categories.filter(c=>c.id===active);}
  function goalsHtml(day,st){
    const gs=(st.goals||[]).filter(g=>g&&(!active||active==='all'||mapGoal[g.type]===active));
    const exact=gs.filter(g=>g.date===day.date);
    const pending=gs.filter(g=>g.date&&g.date>=day.date).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,2);
    if(!exact.length&&!pending.length)return '';
    const items=[...exact,...pending.filter(g=>!exact.includes(g))];
    return '<div class="astro-section-label">Связь с вашими целями</div>'+items.map(g=>'<div class="astro-task"><strong>'+esc(g.name)+'</strong><small>'+(g.date===day.date?'Дедлайн сегодня':'Дедлайн '+esc(g.date))+'. Срок и практические ограничения имеют приоритет над астрологией.</small></div>').join('');
  }
  function renderCard(cat){
    return '<article class="astro-action"><span class="astro-action-type '+cat.level+'">'+esc(names[cat.level]||cat.level)+'</span><h4>'+esc(cat.name)+'</h4>'+
      '<dl><dt>Что делать</dt><dd>'+esc(cat.do)+'</dd><dt class="avoid">Чего избегать</dt><dd>'+esc(cat.avoid)+'</dd></dl>'+
      '<details><summary>Почему именно этот день</summary><p>'+esc(cat.why)+'</p><p>Основание: '+esc((cat.sources||[]).join('; '))+'</p></details></article>';
  }
  function renderDay(day,model,st){
    const cats=viewCategories(day);
    const todayEvents=(day.events||[]).map(e=>'<div class="astro-timeline-item"><strong>'+(e.at?esc(e.at)+' · ':'')+esc(e.title)+'</strong><small>'+esc(e.explanation)+'</small></div>').join('');
    const status=dayStatus(day);
    const heading=active==='all'?day.headline:(cats[0]?cats[0].name+': '+short[cats[0].level]:day.headline);
    const reasons=(day.drivers||[]).map(x=>'<span title="'+esc(x.why)+'">'+esc(x.title)+'</span>').join('');
    let out='<div class="astro-day-top"><div><div class="tiny">'+esc(pretty(day.date))+' · '+esc(model.timeZone)+'</div><h3>'+esc(heading)+'</h3><p>'+esc(day.summary)+'</p></div><div class="astro-status '+status+'">'+esc(names[status]||status)+'</div></div>';
    out+='<div class="astro-facts">'+reasons+'<span>Солнце: '+esc(day.sun.sign)+'</span>'+(day.mercury.retrograde?'<span>Меркурий: ретроградный</span>':'')+'</div>';
    if(todayEvents)out+='<div class="astro-section-label">Астрономические события дня</div><div class="astro-timeline">'+todayEvents+'</div>';
    out+=goalsHtml(day,st);
    out+='<div class="astro-section-label">Действия и ограничения</div><div class="astro-actions">'+cats.map(renderCard).join('')+'</div>';
    out+='<p class="astro-notice">'+esc(model.warning)+' Фаза и знак Луны вычислены астрономически, рекомендации по знакам и Хуанли представляют традиционные трактовки. Точное время указано только для рассчитанных переходов.</p>';
    const panel=document.getElementById('astro-day');if(panel)panel.innerHTML=out;
  }
  function paintMonth(model){
    const box=document.getElementById('astro-month');if(!box)return;
    const days=model.days||[];
    const good=days.filter(d=>dayStatus(d)==='good').slice(0,8);
    const caution=days.filter(d=>dayStatus(d)==='caution').slice(0,5);
    const item=d=>'<button class="astro-month-item" type="button" data-astro-day="'+esc(d.date)+'"><time>'+esc(d.date.slice(-2))+'</time><span><strong>'+esc(active==='all'?d.headline:(d.categories.find(c=>c.id===active)?.name||''))+'</strong><small>'+esc(d.moon.phase)+' · Луна в '+esc(d.moon.sign)+'</small></span></button>';
    box.innerHTML='<div class="astro-section-label">Дни с благоприятными указаниями в этом месяце</div>'+(good.length?'<div class="astro-month-grid">'+good.map(item).join('')+'</div>':'<p class="note">Ярко выраженных дней по выбранным правилам нет.</p>')+
      '<div class="astro-section-label">Дни, где традиция советует осторожность</div>'+(caution.length?'<div class="astro-month-grid">'+caution.map(item).join('')+'</div>':'<p class="note">Выраженных ограничений не найдено.</p>');
    box.querySelectorAll('[data-astro-day]').forEach(btn=>btn.onclick=()=>app.selectDay(btn.dataset.astroDay));
  }
  function paint(){
    if(!isVisible())return;
    attach();
    const st=state(),model=cache[key(st)];
    if(!model){if(lastError)renderError(lastError);return;}
    const indexed=Object.fromEntries(model.days.map(d=>[d.date,d]));
    document.querySelectorAll('[data-astro-cat]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.astroCat===active)));
    document.querySelectorAll('[data-rich-mark]').forEach(mark=>{
      const day=indexed[mark.dataset.richMark],node=mark.closest('.day');if(!node||!day)return;
      node.classList.remove('astro-good','astro-caution','astro-neutral');node.classList.add('astro-'+dayStatus(day));
      let label=node.querySelector('.astro-day-tone');
      if(!label){label=document.createElement('span');label.className='astro-day-tone';node.appendChild(label);}
      label.textContent=short[dayStatus(day)]||'';
      node.setAttribute('aria-label',mark.dataset.richMark+', '+names[dayStatus(day)]+', Луна в '+day.moon.sign);
    });
    const chosen=indexed[st.selected]||model.days[0];
    if(chosen)renderDay(chosen,model,st);
    paintMonth(model);
  }
  app.setCalendar(calendar);
  app.setPaint(function(){basePaint();paint();});
  app.render();
})();
