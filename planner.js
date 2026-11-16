(() => {
  const api = '/api/google-calendar';
  const selectedKey = 'iytn_google_calendars_v1';
  const contextKey = 'iytn_google_meridians_v1';
  let selected = null;
  let contextOnly = false;
  try {
    const saved = JSON.parse(localStorage.getItem(selectedKey));
    if (Array.isArray(saved)) selected = saved.filter(value => typeof value === 'string').slice(0, 12);
    contextOnly = localStorage.getItem(contextKey) === '1';
  } catch {}

  let status, calendars, day, target, inFlight, sequence = 0;
  let calendarError = '', notice = '', selectedTime = '', duration = 15;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function button(text, action) {
    const element = node('button', text, 'secondary');
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  }

  function checkbox(text, checked, action) {
    const label = node('label', '', 'iytn-google-checkbox');
    const input = node('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => {
      if (action(input.checked) === false) input.checked = !input.checked;
    });
    label.append(input, node('span', text));
    return label;
  }

  async function request(path, options) {
    const response = await fetch(api + path, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
    return data;
  }

  function formatter(zone) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }

  function merge(intervals) {
    const result = [];
    for (const interval of intervals) {
      const last = result.at(-1);
      if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
      else result.push({ start: interval.start, end: interval.end });
    }
    return result;
  }

  function checkSlot(result, intervals, clock) {
    if (!selectedTime) return 'Выберите время, чтобы проверить пересечения.';
    if (!Number.isInteger(duration) || duration < 1 || duration > 240) return 'Введите длительность от 1 до 240 минут.';
    const matches = [];
    for (let at = result.start; at < result.end; at += 60_000) {
      if (clock.format(at) === selectedTime) matches.push(at);
    }
    if (matches.length !== 1) return 'Выберите однозначное время для этой даты и часового пояса.';
    const start = matches[0], end = start + duration * 60_000;
    if (end > result.end) return 'Выбранный интервал выходит за пределы дня.';
    return intervals.some(item => item.start < end && item.end > start)
      ? 'Пересекается с занятостью в выбранных календарях.'
      : 'Пересечений в выбранных календарях нет.';
  }

  function render() {
    const panel = document.getElementById('iytn-google-calendar');
    if (!panel || !target) return;
    const wasOpen = panel.querySelector('details')?.open;
    panel.replaceChildren(node('h3', 'Google Календарь'));
    if (notice) panel.append(node('p', notice, 'v3-small'));
    if (!status) {
      if (calendarError) panel.append(node('p', calendarError, 'v3-small'), button('Повторить', () => refresh(true)));
      else panel.append(node('p', 'Проверяем подключение…', 'v3-small'));
      return;
    }
    if (!status.configured) {
      panel.append(node('p', 'Подключение Google ещё не настроено.', 'v3-small'));
      return;
    }
    if (!status.connected) {
      const form = node('form');
      form.method = 'post';
      form.action = api + '/connect';
      const connect = node('button', 'Подключить Google', 'secondary');
      connect.type = 'submit';
      form.append(connect);
      panel.append(node('p', 'Планнер читает занятость и серии событий. События Google остаются в режиме чтения.', 'v3-small'), form);
      return;
    }

    const settings = node('details');
    settings.open = Boolean(wasOpen);
    settings.append(node('summary', 'Календари и правила занятости'));
    for (const calendar of calendars || []) {
      settings.append(checkbox(calendar.name, selected?.includes(calendar.id), checked => {
        if (checked && selected.length >= 12) {
          notice = 'Можно сверять до 12 календарей одновременно.';
          render();
          return false;
        }
        selected = checked ? [...selected, calendar.id] : selected.filter(id => id !== calendar.id);
        try { localStorage.setItem(selectedKey, JSON.stringify(selected)); } catch {}
        day = null;
        render();
        void refresh();
      }));
    }
    settings.append(checkbox('Блоки меридианов — справочно', contextOnly, value => {
      contextOnly = value;
      try { localStorage.setItem(contextKey, value ? '1' : '0'); } catch {}
      render();
      Array.from(panel.querySelectorAll('details input')).at(-1)?.focus();
    }));
    const actions = node('div', '', 'iytn-google-actions');
    actions.append(button('Обновить', () => refresh(true)), button('Отключить', async () => {
      if (!window.confirm('Отключить Google Календарь в этом браузере?')) return;
      try {
        await request('/disconnect', { method: 'POST' });
        sequence++;
        inFlight?.abort();
        inFlight = null;
        status = { ...status, connected: false };
        calendars = day = null;
        notice = 'Подключение отключено.';
      } catch (error) {
        notice = error.message || 'Не удалось отключить подключение.';
      }
      render();
    }));
    settings.append(actions);
    panel.append(settings);
    if (calendarError) {
      panel.append(node('p', calendarError, 'v3-small'));
      return;
    }
    if (!calendars || !day) {
      panel.append(node('p', 'Сверяем выбранный день…', 'v3-small'));
      return;
    }
    if (!selected.length) {
      panel.append(node('p', 'Выберите хотя бы один календарь.', 'v3-small'));
      return;
    }
    const intervals = merge(day.intervals.filter(item => !contextOnly || !item.reference));
    const clock = formatter(target.zone);
    const lines = intervals.map(({ start, end }) => {
      if (start === day.start && end === day.end) return 'Весь день';
      return clock.format(start) + '–' + (end === day.end ? '24:00' : clock.format(end));
    });
    panel.append(node('p', lines.length ? 'Занято · ' + lines.join(', ') : 'В Google нет блоков занятости на этот день.', 'iytn-google-busy'));
    if (contextOnly && day.intervals.some(item => item.reference)) {
      panel.append(node('p', 'Серии меридианов показаны в Google и исключены из сверки планнера.', 'v3-small'));
    }

    const slot = node('div', '', 'iytn-google-slot');
    const timeLabel = node('label', 'Начало');
    const time = node('input');
    time.type = 'time';
    time.value = selectedTime;
    timeLabel.append(time);
    const durationLabel = node('label', 'Минут');
    const minutes = node('input');
    minutes.type = 'number';
    minutes.min = '1';
    minutes.max = '240';
    minutes.value = String(duration);
    durationLabel.append(minutes);
    const result = node('p', checkSlot(day, intervals, clock), 'v3-small');
    result.setAttribute('role', 'status');
    time.oninput = minutes.oninput = () => {
      selectedTime = time.value;
      duration = Number(minutes.value);
      result.textContent = checkSlot(day, intervals, clock);
    };
    slot.append(timeLabel, durationLabel);
    panel.append(slot, result);
  }

  async function refresh(force = false) {
    if (!target || !document.getElementById('iytn-google-calendar')) return;
    if (force) notice = '';
    const id = ++sequence;
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    const options = { signal: controller.signal };
    const { date, zone } = target;
    try {
      let connection = status;
      if (!connection || force) connection = await request('/status', options);
      if (id !== sequence) return;
      status = connection;
      if (!connection.connected) {
        calendars = day = null;
        calendarError = '';
        render();
        return;
      }
      let current = calendars;
      if (!current || force) current = (await request('/calendars', options)).calendars;
      if (id !== sequence) return;
      calendars = current;
      if (selected === null) {
        selected = current.filter(item => item.primary).map(item => item.id);
        if (!selected.length && current.length) selected = [current[0].id];
      } else {
        selected = selected.filter(calendarId => current.some(item => item.id === calendarId));
      }
      const query = new URLSearchParams({ date, tz: zone });
      for (const calendarId of selected) query.append('calendar', calendarId);
      const value = await request('/day?' + query, options);
      if (id !== sequence) return;
      day = value;
      calendarError = '';
      render();
    } catch (error) {
      if (id !== sequence || controller.signal.aborted) return;
      day = null;
      if (error.status === 401) {
        status = { ...status, connected: false };
        calendars = null;
        notice = error.message;
      } else {
        calendarError = error.message || 'Не удалось проверить занятость.';
      }
      render();
    }
  }

  window.IYTN_GOOGLE_CALENDAR = {
    update(date, zone) {
      if (!date || !zone) return;
      if (date === target?.date && zone === target.zone) {
        const panel = document.getElementById('iytn-google-calendar');
        if (panel && !panel.firstChild) render();
        return;
      }
      target = { date, zone };
      day = null;
      calendarError = '';
      render();
      void refresh();
    },
    landing() {
      const url = new URL(location.href);
      const outcome = url.searchParams.get('googleCalendar');
      if (!outcome) return false;
      notice = outcome === 'connected' ? 'Google Календарь подключён.' : 'Google не подтвердил подключение. Попробуйте ещё раз.';
      url.searchParams.delete('googleCalendar');
      history.replaceState(null, '', url);
      return true;
    },
  };
  setInterval(() => {
    const panel = document.getElementById('iytn-google-calendar');
    if (status?.connected && document.visibilityState === 'visible' && panel && !panel.contains(document.activeElement)) void refresh();
  }, 60_000);
})();

/* It's Your Time Now · decision calendar and Conscious Map connection · v3 */
(function(){
'use strict';
const app=window.IYTN_PLANNER_BRIDGE;
if(!app){console.error('Missing IYTN bridge');return}
const legacyCalendar=app.calendar(),legacyPaint=app.paint();
const MAP_ORIGIN='https://conscious-map-v2-production.up.railway.app';
const ORIGINAL_MAP_ORIGIN='https://consciousness-map-production-ce66.up.railway.app';
const PSY_KEY='iytn_psych_snapshot_v1',CHECKIN_KEY='iytn_daily_checkin_v1',LENS_KEY='iytn_planner_lens_v3';
const tabs=[['all','Все сферы'],['work','Работа'],['money','Финансы'],['creative','Творчество'],['relationship','Отношения'],['learning','Учёба'],['rest','Восстановление']];
const levels={good:'Подходит по традиции',neutral:'Без особого акцента',caution:'По традиции осторожнее'};
const short={good:'Подходит',neutral:'Ровно',caution:'Осторожно'};
const goalKinds={work:'work',creative:'creative',relationship:'relationship',learning:'learning',health:'rest'};
let active='all',lens='all',view='month',cache={},loading={},error='';
let layersOpen=false, calculationsOpen=false, mapTransferError='';
let psychology=null,checkins={};
try{
 active=localStorage.getItem('iytn_planner_category')||'all';
 lens=localStorage.getItem(LENS_KEY)||'all';
 psychology=JSON.parse(localStorage.getItem(PSY_KEY)||'null');
 checkins=JSON.parse(localStorage.getItem(CHECKIN_KEY)||'{}');
 if(!tabs.some(t=>t[0]===active))active='all';
 if(!['all','psychology','astrology'].includes(lens))lens='all';
 if(!checkins||typeof checkins!=='object'||Array.isArray(checkins))checkins={};
}catch{psychology=null;checkins={}}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function st(){return app.state()}
function month(sta){const n=new Date(),d=new Date(n.getFullYear(),n.getMonth()+(sta.monthOffset||0),1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')}
function key(sta){return [month(sta),sta.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',sta.birth||'',sta.birthtime||'',sta.birthZone||''].join('|')}
function visible(){return st().page==='calendar'&&!!document.getElementById('astro-day')}
function isValidDate(x){return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(x||''))}
function truncate(x,n){return String(x==null?'':x).trim().slice(0,n)}
function savePref(){try{localStorage.setItem('iytn_planner_category',active);localStorage.setItem(LENS_KEY,lens)}catch{}}
function psychEvents(day){return psychology?.experiments?.filter(e=>e.due===day)||[]}
function psychGoals(){return psychology?.goals||[]}
function psychDueStatus(date){
 if(psychEvents(date).length)return 'due';
 if(checkins[date])return 'checkin';
 return '';
}
function status(day){const c=active==='all'?null:day.categories.find(v=>v.id===active);return c?.level||day.overall}
function todayIso(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function datePretty(date){return new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',weekday:'long'})}
function dayDiff(from,to){const a=Date.parse(from+'T12:00:00'),b=Date.parse(to+'T12:00:00');return Math.round((b-a)/86400000)}
function contentHeader(){
 return '<div class="v3-overline">IT’S YOUR TIME NOW · DECISION SYSTEM</div><h1>Планнер <em>сознания и времени.</em></h1>'+
 '<p class="lead v3-lead">Один календарь для задач, психологических наблюдений и традиционных временных систем. Вначале реальные сроки и ваше состояние; ниже символический контекст.</p>'+
 '<div class="v3-top-tools"><div class="v3-link-actions"><button type="button" data-v3-teachings>Все учения</button><button type="button" data-v3-calculations>Расчёты выбранного дня</button></div><div class="v3-lenses" role="group" aria-label="Система рекомендаций">'+
 [['all','Все системы'],['psychology','Психология'],['astrology','Астрология']].map(x=>'<button data-v3-lens="'+x[0]+'" aria-pressed="'+(lens===x[0])+'">'+x[1]+'</button>').join('')+
 '</div><div class="v3-cats" role="group" aria-label="Область дел">'+tabs.map(x=>'<button data-v3-cat="'+x[0]+'" aria-pressed="'+(active===x[0])+'">'+x[1]+'</button>').join('')+'</div></div>'
}
function calendar(){
 let h=legacyCalendar();
 // Keep legacy calendar and all existing engines intact. Recompose them rather than patching backend rendering.
 h=h.replace(/^<div class="eyebrow">PERSONAL TIME MAP<\/div><h1>Ваш <em>календарь\.<\/em><\/h1><p class="lead">[\s\S]*?<\/p>/,contentHeader());
 h=h.replace('<div class="card"><div class="flex">','<div class="v3-workbench"><section class="v3-left"><div class="card v3-calendar"><div class="flex v3-month-bar">');
 h=h.replace('<div class="calendar-toolbar">','<details id="v3-teaching-layers" class="v3-filter-drawer"'+(layersOpen?' open':'')+'><summary>Нумерология, астрология и другие слои</summary><div class="calendar-toolbar">');
 h=h.replace('<div class="calendar" id="calendar-grid">','</details><div class="v3-mode-row"><div class="v3-view-switch"><button data-v3-view="month" aria-pressed="'+(view==='month')+'">Месяц</button><button data-v3-view="week" aria-pressed="'+(view==='week')+'">Неделя</button></div><button data-v3-today class="v3-today">Сегодня</button></div><div class="v3-legend"><span><i class="astro-dot good"></i>Традиционно подходит</span><span><i class="astro-dot caution"></i>Осторожнее</span><span><i class="v3-psy-marker"></i>Контрольная точка</span></div><div class="calendar" id="calendar-grid">');
 h=h.replace(/<div class="section flex"><h2>Ваш день<\/h2><span>[\s\S]*?<\/span><\/div>/,'');
 h=h.replace('<div class="card" id="caldayevents">','<section id="v3-map-connection" class="v3-source-card" aria-label="Связь с Картой сознания"></section><div id="astro-month" class="v3-month-highlights"><div class="astro-loading">Составляем календарь...</div></div></section><section class="v3-right"><section id="iytn-google-calendar" class="card iytn-google-calendar" aria-label="Google Календарь"></section><div id="astro-day" class="astro-day-panel"><div class="astro-loading">Подготавливаем ваш день...</div></div></section></div><details id="v3-day-calculations" class="v3-reference"'+(calculationsOpen?' open':'')+'><summary>Расчёты выбранного дня и события месяца</summary><div class="card" id="caldayevents">');
 h+='</details>';
 setTimeout(load,0);
 return h;
}
function bind(){
 document.querySelectorAll('[data-v3-lens]').forEach(b=>b.onclick=()=>{lens=b.dataset.v3Lens;savePref();paint()});
 document.querySelectorAll('[data-v3-cat]').forEach(b=>b.onclick=()=>{active=b.dataset.v3Cat;savePref();paint()});
 document.querySelectorAll('[data-v3-view]').forEach(b=>b.onclick=()=>{view=b.dataset.v3View;paint()});
 document.querySelectorAll('[data-v3-today]').forEach(b=>b.onclick=()=>app.selectToday());
 document.querySelectorAll('[data-v3-teachings]').forEach(b=>b.onclick=()=>window.go('teachings'));
 const layers=document.getElementById('v3-teaching-layers');
 const calculations=document.getElementById('v3-day-calculations');
 if(layers)layers.ontoggle=()=>{layersOpen=layers.open};
 if(calculations)calculations.ontoggle=()=>{calculationsOpen=calculations.open};
 document.querySelectorAll('[data-v3-calculations]').forEach(b=>b.onclick=()=>{
  if(!calculations)return;
  calculations.open=true;
  calculations.querySelector('summary')?.focus();
  calculations.scrollIntoView({block:'start'});
 });
}
function markSelections(){
 document.querySelectorAll('[data-v3-lens]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v3Lens===lens)));
 document.querySelectorAll('[data-v3-cat]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v3Cat===active)));
 document.querySelectorAll('[data-v3-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v3View===view)));
}
async function load(){
 if(!visible())return;
 bind();paintMapConnection();
 const state=st(),k=key(state);
 if(cache[k]){paint();return}
 if(loading[k])return;
 loading[k]=true;
 try{
 const tz=state.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 const res=await fetch('/api/astro-planner?month='+encodeURIComponent(month(state))+'&tz='+encodeURIComponent(tz),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({birth:state.birth||'',birthtime:state.birthtime||'',birthZone:state.birthZone||''})});
 const data=await res.json();
 if(!res.ok||!Array.isArray(data.days))throw Error(data.error||'Не удалось рассчитать месяц');
 cache[k]=data;error='';
 if(visible()&&key(st())===k)paint();
 }catch(e){error=String(e.message||e);if(visible()&&key(st())===k)showError(error)}
 finally{delete loading[k]}
}
function showError(message){let el=document.getElementById('astro-day');if(el){el.innerHTML='<div class="v3-error">Ошибка расчёта: '+esc(message)+'</div><button class="secondary" id="v3-retry">Повторить</button>';let btn=el.querySelector('#v3-retry');if(btn)btn.onclick=()=>{error='';load()}}}
function paintGrid(model,state){
 const data=Object.fromEntries(model.days.map(d=>[d.date,d]));
 const selected=state.selected;
 const grid=document.getElementById('calendar-grid');if(!grid)return;
 const selectedDate=new Date(selected+'T12:00:00'),selectedWeek=(selectedDate.getDay()+6)%7;
 const monday=new Date(selectedDate.getTime()-selectedWeek*86400000);
 const mondayKey=monday.getFullYear()+'-'+String(monday.getMonth()+1).padStart(2,'0')+'-'+String(monday.getDate()).padStart(2,'0');
 const weekStart=Date.parse(mondayKey+'T12:00:00'),weekEnd=weekStart+7*86400000;
 grid.classList.toggle('v3-week',view==='week');
 grid.querySelectorAll('.day').forEach(node=>{
  const marker=node.querySelector('[data-rich-mark]'),date=marker?.dataset.richMark;
  if(!date){node.hidden=view==='week'&&weekStart>Date.parse(month(state)+'-01T12:00:00');return}
  const d=data[date];if(!d)return;
  const isWeek=view==='week',at=Date.parse(date+'T12:00:00');
  node.hidden=isWeek&&(at<weekStart||at>=weekEnd);
  const level=status(d),dateEvent=psychDueStatus(date);
  node.classList.remove('astro-good','astro-caution','astro-neutral','v3-psy-due');
  if(lens!=='psychology')node.classList.add('astro-'+level);
  if(dateEvent==='due')node.classList.add('v3-psy-due');
  let indicator=node.querySelector('.astro-day-tone');
  if(!indicator){indicator=document.createElement('span');indicator.className='astro-day-tone';node.appendChild(indicator)}
  indicator.textContent=lens==='psychology'?(dateEvent==='due'?'Проверка':dateEvent==='checkin'?'Запись':''):short[level];
  let event=node.querySelector('.v3-day-psych');
  if(!event){event=document.createElement('span');event.className='v3-day-psych';node.appendChild(event)}
  event.textContent=dateEvent==='due'?'●':'';event.setAttribute('aria-hidden','true');
  node.setAttribute('aria-label',date+'; '+(dateEvent==='due'?'проверка в Карте сознания; ':'')+(lens==='psychology'?'психологическая система не прогнозирует дни':levels[level]));
 });
}
function findNextGoal(day,state){
 const goals=(state.goals||[]).filter(g=>g.date&&g.date>=day).sort((a,b)=>a.date.localeCompare(b.date));
 return goals[0]||null;
}
function currentCheckin(date){const c=checkins[date];return c&&Number.isInteger(c.energy)&&Number.isInteger(c.stress)&&Number.isInteger(c.focus)?c:null}
function psychAdvice(day){
 const due=psychEvents(day.date),c=currentCheckin(day.date);
 const psGoals=psychGoals();
 if(due.length)return {title:'Проверить результат запланированного эксперимента',action:due[0].action,
  avoid:'Не записывать предположение как результат. Зафиксируйте, что действительно произошло.',
  why:'В Карте сознания проверке назначен срок '+day.date+'. Источник: ваша собственная запись, а не прогноз.'};
 if(c){
  if(c.stress>=4)return {title:'Снизить необязательную нагрузку',action:'Выберите одну важную задачу и сделайте паузу перед следующей.',
   avoid:'Добавлять новые обязательства без оценки свободного времени.',
   why:'Вы указали высокий субъективный стресс ('+c.stress+'/5) для этого дня. Это самоотчёт, не диагноз.'};
  if(c.energy<=2)return {title:'Согласовать дела с доступной энергией',action:'Сократите план до одного обязательного шага и предусмотрите восстановление.',
   avoid:'Ожидать обычной продуктивности при низкой субъективной энергии.',
   why:'Вы указали энергию '+c.energy+'/5. Рекомендация адаптирована к отметке, а не к дате рождения.'};
  if(c.focus<=2)return {title:'Оставить время для одной фокусной задачи',action:'Определите следующий шаг заранее и отключите отвлекающие уведомления на 20 минут.',
   avoid:'Распределять внимание между несколькими сложными делами.',
   why:'Вы отметили концентрацию '+c.focus+'/5. Приоритет основан на самооценке.'};
 }
 if(psGoals.length)return {title:'Продвинуть выбранную цель',action:'Назначьте наблюдаемое действие для цели «'+psGoals[0].title+'».',
   avoid:'Считать индекс готовности вероятностью успеха.',
   why:'В вашей Карте сознания есть активная цель. Индекс readiness описывает внутреннюю модель и не предсказывает результат.'};
 return {title:'Сделать короткую психологическую сверку',action:'Отметьте энергию, стресс и концентрацию, затем выберите одну посильную задачу.',
  avoid:'Принимать интерпретацию астрологического периода за измерение своего состояния.',
  why:'Для психологической рекомендации нужны наблюдения и цели. Ни дата, ни созвездие сами по себе их не заменяют.'};
}
function psychPanel(day,state){
 const connected=!!psychology;
 const due=psychEvents(day.date),goals=psychGoals(),checkin=currentCheckin(day.date);
 const mayEdit=day.date<=todayIso();
 const summary=psychAdvice(day);
 const stale=psychology?.exportedAt&&Date.now()-psychology.exportedAt>7*86400000;
 let out='<div class="v3-section-top"><div><div class="v3-kicker">01 · НАБЛЮДЕНИЕ / ПСИХОЛОГИЯ</div><h4>Карта сознания · психологический слой</h4></div><span class="v3-chip '+(connected?'connected':'')+'">'+(connected?(psychology.source==='conscious-map'?'Основная карта':'Исследовательская V2'):'Локальная сверка')+'</span></div>';
 out+='<div class="v3-psych-focus"><div class="v3-kicker">Практический шаг</div><strong>'+esc(summary.title)+'</strong><p>'+esc(summary.action)+'</p><div class="v3-avoid-text">Следует избегать: '+esc(summary.avoid)+'</div><details><summary>Основание рекомендации</summary><p>'+esc(summary.why)+'</p></details></div>';
 if(mayEdit){
 const vals=checkin||{energy:3,stress:3,focus:3};
 out+='<div class="v3-checkin"><div class="v3-checkin-heading">Сверка состояния <span>'+(checkin?'Сохранено':'Не заполнено')+'</span></div>'+
 [['energy','Энергия'],['stress','Стресс'],['focus','Концентрация']].map(x=>'<label>'+x[1]+' <span id="v3-val-'+x[0]+'">'+vals[x[0]]+'/5</span><input data-v3-check="'+x[0]+'" type="range" min="1" max="5" value="'+vals[x[0]]+'"></label>').join('')+
 '<div class="v3-checkin-foot"><span>Самооценка, не диагностический тест</span><button type="button" data-v3-save-checkin>Сохранить</button></div></div>';
 }else out+='<p class="v3-small">На будущую дату состояние не прогнозируется. Сверка станет доступна в этот день.</p>';
 if(connected){
 const spheres=[['self','Я'],['shadow','Тень'],['relations','Отношения'],['body','Тело'],['meaning','Смыслы'],['lineage','Род'],['work','Работа']];
 const counts=psychology.stats?.sphereCounts||{},max=Math.max(1,...spheres.map(x=>counts[x[0]]||0));
 out+='<div class="v3-kicker v3-sub">Покрытие карты · число наблюдений</div><div class="v3-sphere-grid">'+spheres.map(x=>'<div class="v3-sphere"><div><span>'+x[1]+'</span><b>'+(counts[x[0]]||0)+'</b></div><i><em style="width:'+Math.round(100*(counts[x[0]]||0)/max)+'%"></em></i></div>').join('')+'</div>';
 out+='<p class="v3-small">Заполненность сферы отражает объём внесённых данных, а не её состояние, силу или здоровье.</p>';
 if(stale)out+='<div class="v3-muted-warning">Данные Карты старше недели. Для актуализации повторите передачу.</div>';
 if(due.length)out+='<div class="v3-kicker v3-sub">Проверки на эту дату</div>'+due.map(e=>'<div class="v3-real-task"><span>Срок '+esc(e.due)+'</span><strong>'+esc(e.action)+'</strong></div>').join('');
 if(goals.length)out+='<div class="v3-kicker v3-sub">Активные намерения</div>'+goals.slice(0,3).map(g=>'<div class="v3-real-task"><strong>'+esc(g.title)+'</strong><span>'+(psychology.source==='conscious-map'?'Активная цель из основной Карты сознания':'Индекс готовности '+esc(g.readiness)+'/100 · '+esc(g.supportCount)+' опор · '+esc(g.riskCount)+' рисков. Не вероятность.')+'</span></div>').join('');
 if(psychology.hypotheses?.length)out+='<details class="v3-secondary-details"><summary>Проверяемые гипотезы ('+psychology.hypotheses.length+')</summary>'+psychology.hypotheses.map(h=>'<p>'+esc(h.title)+'</p>').join('')+'</details>';
 out+='<div class="v3-link-actions"><a href="'+ORIGINAL_MAP_ORIGIN+'" target="_blank" rel="noopener noreferrer">Открыть оригинальную карту ↗</a><a href="'+MAP_ORIGIN+'/?from=time-planner" target="_blank" rel="noopener noreferrer">Обновить из исследовательской V2 ↗</a><button type="button" data-v3-disconnect>Отключить</button></div>';
 }else{
 out+='<div class="v3-connect"><p>В «Карте сознания» откройте «Исследование» и нажмите «Передать контрольные даты». Сюда попадут активные цели, назначенные проверки и сводные числа.</p><div class="v3-link-actions"><a href="'+ORIGINAL_MAP_ORIGIN+'" target="_blank" rel="noopener noreferrer">Открыть оригинальную карту ↗</a><a href="'+MAP_ORIGIN+'/?from=time-planner" target="_blank" rel="noopener noreferrer">Связать исследовательскую V2 ↗</a></div></div>';
 }
 return out;
}
function astroPanel(day,model,state){
 const cats=active==='all'?day.categories.slice().sort((a,b)=>b.score-a.score).slice(0,2):day.categories.filter(c=>c.id===active);
 let out='<div class="v3-section-top"><div><div class="v3-kicker">02 · СИМВОЛИЧЕСКАЯ СИСТЕМА</div><h4>Астрологический контекст</h4></div><span class="v3-chip">Традиционная трактовка</span></div>';
 out+='<div class="v3-astro-facts"><span>Луна: '+esc(day.moon.sign)+'</span><span>'+esc(day.moon.phase)+' · '+esc(day.moon.illumination)+'%</span><span>Солнце: '+esc(day.sun.sign)+'</span>'+(day.mercury.retrograde?'<span>Ретроградный Меркурий</span>':'')+'</div>';
 out+='<p class="v3-small">Расчёты небесных положений астрономические; оценки подходящих дней и их трактовки не подтверждены как прогноз эффективности действий.</p>';
 out+='<div class="v3-astro-compact">'+cats.map(c=>'<article class="v3-suggestion"><div class="v3-sug-head"><b>'+esc(c.name)+'</b><span class="v3-sug-status '+esc(c.level)+'">'+esc(levels[c.level])+'</span></div><p>'+esc(c.do)+'</p><div class="v3-avoid-text">'+esc(c.avoid)+'</div><details><summary>Почему так</summary><p>'+esc(c.why)+'</p></details></article>').join('')+'</div>';
 if(active==='all')out+='<details class="v3-secondary-details"><summary>Все 6 направлений</summary><div class="v3-all-cats">'+day.categories.map(c=>'<div><b>'+esc(c.name)+'</b><span>'+esc(levels[c.level])+'</span><small>'+esc(c.why)+'</small></div>').join('')+'</div></details>';
 const evs=(day.events||[]).filter(e=>e.kind!=='mercury').slice(0,4);
 if(evs.length)out+='<details class="v3-secondary-details"><summary>Астрономические события дня ('+evs.length+')</summary>'+evs.map(e=>'<p><b>'+(e.at?esc(e.at)+' · ':'')+esc(e.title)+'</b><small>'+esc(e.explanation)+'</small></p>').join('')+'</details>';
 if(model.natal){let natal=day.personalAspects||[];
 out+='<details class="v3-secondary-details"><summary>Натальные транзиты'+(natal.length?' · '+natal.length:'')+'</summary><p>Натальные Солнце '+esc(model.natal.sunSign)+' и Луна '+esc(model.natal.moonSign)+'.</p>'+(natal.length?natal.map(n=>'<p>'+esc(n.title)+' · орб '+esc(n.orb)+'°. '+esc(n.explanation)+'</p>').join(''):'<p>Точных основных аспектов к натальным Солнцу и Луне в принятом орбисе нет.</p>')+'</details>'; }
 out+='<p class="v3-source-note">Методы: Astronomy Engine, lunar-javascript / Хуанли. Традиция обозначена отдельно от психологических наблюдений.</p>';
 return out;
}
function dayPanel(day,model,state){
 const due=psychEvents(day.date);
 const next=findNextGoal(day.date,state);
 const priority=due.length?{caption:'ПРОВЕРКА В КАРТЕ',title:due[0].action,why:'Реальный срок вашей проверки'}:next&&next.date===day.date?{caption:'СРОК СЕГОДНЯ',title:next.name,why:'Установленный вами дедлайн'}:psychology?.goals?.length?{caption:'ВАША ЦЕЛЬ',title:psychology.goals[0].title,why:'Цель из Карты сознания'}:next?{caption:'БЛИЖАЙШАЯ ЦЕЛЬ',title:next.name,why:'Дедлайн '+next.date}:{caption:'ФОКУС ДНЯ',title:'Выберите одно важное действие',why:'Приоритет задаётся реальной задачей, а не астрологией'};
 const checkin=currentCheckin(day.date);
 let out='<div class="v3-day-hero"><div class="v3-day-hero-top"><div class="v3-kicker">'+esc(datePretty(day.date))+' · '+esc(model.timeZone)+'</div><div class="v3-day-nav"><button type="button" data-v3-shift="-1" aria-label="Предыдущий день">←</button><button type="button" data-v3-shift="1" aria-label="Следующий день">→</button></div></div><div class="v3-hero-caption">'+esc(priority.caption)+'</div><h2>'+esc(priority.title)+'</h2><p>'+esc(priority.why)+'</p></div>';
 if(lens==='all'||lens==='psychology')out+='<section class="v3-source-card v3-psych-card">'+psychPanel(day,state)+'</section>';
 if(lens==='all'||lens==='astrology')out+='<section class="v3-source-card v3-astro-card">'+astroPanel(day,model,state)+'</section>';
 if(lens==='all')out+='<div class="v3-principle">При расхождении рекомендаций дедлайны, наблюдаемые данные и ваше самочувствие имеют приоритет над символическими календарными правилами.</div>';
 const root=document.getElementById('astro-day');if(!root)return;root.innerHTML=out;
 root.querySelectorAll('[data-v3-shift]').forEach(b=>b.onclick=()=>{
 const d=new Date(day.date+'T12:00:00');d.setDate(d.getDate()+Number(b.dataset.v3Shift));
 const next=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 app.selectDate(next);
 });
 const fields=[...root.querySelectorAll('[data-v3-check]')];
 fields.forEach(e=>e.addEventListener('input',()=>{const n=document.getElementById('v3-val-'+e.dataset.v3Check);if(n)n.textContent=e.value+'/5'}));
 const save=root.querySelector('[data-v3-save-checkin]');
 if(save)save.onclick=()=>{
  let vals={};fields.forEach(f=>{vals[f.dataset.v3Check]=Number(f.value)});
  if(Object.values(vals).every(n=>Number.isInteger(n)&&n>=1&&n<=5)){
   checkins[day.date]={...vals,updatedAt:Date.now()};
   const keys=Object.keys(checkins).sort();if(keys.length>240)keys.slice(0,keys.length-240).forEach(k=>delete checkins[k]);
   try{localStorage.setItem(CHECKIN_KEY,JSON.stringify(checkins))}catch{}
   paint();
  }
 };
 const disconnect=root.querySelector('[data-v3-disconnect]');if(disconnect)disconnect.onclick=()=>{
  if(!confirm('Отключить Карту сознания и удалить переданную сводку из браузера планнера?'))return;
  psychology=null;try{localStorage.removeItem(PSY_KEY)}catch{}
  paint();
 };
}
function paintMapConnection(){
 const box=document.getElementById('v3-map-connection');if(!box)return;
 const origin=psychology?.source==='conscious-map-v2'?MAP_ORIGIN:ORIGINAL_MAP_ORIGIN;
 const link='<div class="v3-link-actions"><a href="'+origin+'" target="_blank" rel="noopener noreferrer">Открыть Карту сознания ↗</a></div>';
 let out='<div class="v3-section-top"><h3>Карта сознания</h3><span class="v3-chip '+(psychology?'connected':'')+'">'+(psychology?'Сводка получена':'Связь не настроена')+'</span></div>';
 if(mapTransferError)out+='<p class="v3-muted-warning" role="status">'+esc(mapTransferError)+'</p>';
 if(!psychology){
  box.innerHTML=out+'<p class="v3-small">В Карте откройте «Исследование» и нажмите «Передать контрольные даты». Сводка появится в этом браузере.</p>'+link;
  return;
 }
 const goals=psychGoals(),checks=psychology.experiments.filter(e=>e.due).sort((a,b)=>a.due.localeCompare(b.due));
 const at=new Date(psychology.exportedAt);
 out+='<p class="v3-small">'+(psychology.source==='conscious-map'?'Основная Карта':'Исследовательская V2')+' · обновлено '+esc(Number.isFinite(at.getTime())?at.toLocaleString('ru-RU'):'—')+'</p>';
 out+='<p class="v3-small">Цели: '+goals.length+' · Проверки с датой: '+checks.length+' · Наблюдения в сводке: '+(psychology.stats?.evidenceCount||0)+'</p>';
 if(goals.length)out+=goals.map(g=>'<div class="v3-real-task"><span>Цель</span><strong>'+esc(g.title)+'</strong></div>').join('');
 if(checks.length)out+='<div class="v3-month-tasks">'+checks.map(e=>'<button type="button" data-v3-map-date="'+esc(e.due)+'"><time datetime="'+esc(e.due)+'">'+esc(e.due)+'</time><span>'+esc(e.action)+'</span></button>').join('')+'</div>';
 else out+='<p class="v3-small">В переданной сводке нет проверок с назначенной датой. Создайте проверку в «Исследовании» и передайте сводку повторно, чтобы она появилась в календаре.</p>';
 box.innerHTML=out+link;
 box.querySelectorAll('[data-v3-map-date]').forEach(b=>b.onclick=()=>app.selectDate(b.dataset.v3MapDate));
}
function highlightMonth(model,state){
 const box=document.getElementById('astro-month');if(!box)return;
 const monthDays=model.days,events=monthDays.filter(d=>psychEvents(d.date).length);
 const goalDays=monthDays.filter(d=>(state.goals||[]).some(g=>g.date===d.date));
 const sorted=[...new Set([...events.map(x=>x.date),...goalDays.map(x=>x.date)])].sort();
 let body='<div class="v3-month-small-header"><b>Контрольные точки</b><span>'+sorted.length+' дат</span></div>';
 if(sorted.length)body+='<div class="v3-month-tasks">'+sorted.slice(0,9).map(date=>{
  const e=psychEvents(date),gs=(state.goals||[]).filter(g=>g.date===date);
  const title=e[0]?.action||gs[0]?.name||'Запланированное дело';
  return '<button type="button" data-v3-date="'+esc(date)+'"><time>'+esc(date.slice(-2))+'.'+esc(date.slice(5,7))+'</time><span>'+esc(title)+'</span></button>';
 }).join('')+'</div>';
 else body+='<p class="v3-small">Нет назначенных дат. Добавьте цель или эксперимент в Карте сознания, либо поставьте срок в разделе «Цели».</p>';
 
 box.innerHTML=body;box.querySelectorAll('[data-v3-date]').forEach(b=>b.onclick=()=>app.selectDate(b.dataset.v3Date));
}
function paint(){
 if(!visible())return;
 bind();markSelections();paintMapConnection();
 const state=st(),model=cache[key(state)];
 window.IYTN_GOOGLE_CALENDAR.update(state.selected,state.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC');
 if(!model){if(error)showError(error);return}
 const idx=Object.fromEntries(model.days.map(d=>[d.date,d]));
 paintGrid(model,state);
 const chosen=idx[state.selected]||model.days[0];if(chosen)dayPanel(chosen,model,state);
 highlightMonth(model,state);
}
function sanitiseSnapshot(value){
 if(!value||value.version!==1||!['conscious-map-v2','conscious-map'].includes(value.source))throw Error('Неподдерживаемый формат');
 const goals=Array.isArray(value.goals)?value.goals.slice(0,12):[];
 const experiments=Array.isArray(value.experiments)?value.experiments.slice(0,20):[];
 const hypotheses=Array.isArray(value.hypotheses)?value.hypotheses.slice(0,10):[];
 return {version:1,source:value.source,exportedAt:Number(value.exportedAt)||Date.now(),
  goals:goals.map(x=>({id:truncate(x.id,80),title:truncate(x.title,180),readiness:Math.max(0,Math.min(100,Number(x.readiness)||0)),supportCount:Math.max(0,Math.min(999,Number(x.supportCount)||0)),riskCount:Math.max(0,Math.min(999,Number(x.riskCount)||0))})),
  experiments:experiments.map(x=>({id:truncate(x.id,80),action:truncate(x.action,220),due:isValidDate(x.due)?x.due:'',hypothesisId:truncate(x.hypothesisId,80)})),
  hypotheses:hypotheses.map(x=>({id:truncate(x.id,80),title:truncate(x.title,180),expectedBy:isValidDate(x.expectedBy)?x.expectedBy:''})),
  stats:{evidenceCount:Math.max(0,Math.min(99999,Number(value.stats?.evidenceCount)||0)),experimentsOpen:Math.max(0,Math.min(99999,Number(value.stats?.experimentsOpen)||0)),hypothesesActive:Math.max(0,Math.min(99999,Number(value.stats?.hypothesesActive)||0)),sphereCounts:Object.fromEntries(['self','shadow','relations','body','meaning','lineage','work'].map(k=>[k,Math.max(0,Math.min(99999,Number(value.stats?.sphereCounts?.[k])||0))]))}};
}
const connection=new URLSearchParams(location.search).get('connect');
const importOrigin=connection==='conscious-map-v2'?MAP_ORIGIN:connection==='conscious-map-original'?ORIGINAL_MAP_ORIGIN:null;
if(importOrigin&&window.opener){
 window.addEventListener('message',event=>{
  if(event.origin!==importOrigin||event.source!==window.opener||event.data?.type!=='CONSCIOUS_MAP_TO_PLANNER_V1')return;
  try{
   const data=sanitiseSnapshot(event.data.payload);
   localStorage.setItem(PSY_KEY,JSON.stringify(data));
   psychology=data;mapTransferError='';
   const url=new URL(location.href);
   url.searchParams.delete('connect');
   history.replaceState(null,'',url);
   lens='all';savePref();app.openCalendar();
  }catch{
   mapTransferError='Планнер не смог сохранить сводку. Проверьте доступ к хранилищу браузера и повторите передачу.';
   app.openCalendar();
  }
 },{once:false});
 window.opener.postMessage({type:'IYTN_PLANNER_READY'},importOrigin);
}
window.addEventListener('storage', event=>{
 if(event.key!==PSY_KEY)return;
 try{psychology=event.newValue?sanitiseSnapshot(JSON.parse(event.newValue)):null;mapTransferError='';paint()}catch{}
});
app.setCalendar(calendar);
app.setPaint(function(){legacyPaint();paint()});
if(window.IYTN_GOOGLE_CALENDAR.landing())app.openCalendar();else app.render();
})();