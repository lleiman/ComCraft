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
const PSY_KEY='iytn_psych_snapshot_v1',CHECKIN_KEY='iytn_daily_checkin_v1',LENS_KEY='iytn_planner_lens_v3',FORECAST_KEY='iytn_forecast_horizon_v1';
const tabs=[['all','Все сферы'],['work','Работа'],['money','Финансы'],['creative','Творчество'],['relationship','Отношения'],['learning','Учёба'],['rest','Восстановление']];
const levels={good:'Подходит по традиции',neutral:'Без особого акцента',caution:'По традиции осторожнее'};
const short={good:'Подходит',neutral:'Ровно',caution:'Осторожно'};
const goalKinds={work:'work',creative:'creative',relationship:'relationship',learning:'learning',health:'rest'};
let active='all',lens='all',view='month',cache={},loading={},error='',forecastHorizon='day';
let layersOpen=false, calculationsOpen=false, mapTransferError='';
let psychology=null,checkins={};
try{
 active=localStorage.getItem('iytn_planner_category')||'all';
 lens=localStorage.getItem(LENS_KEY)||'all';
 // On a fresh visit, always begin with today's full reading.
 forecastHorizon='day';
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
 return '<div class="v6-intro"><div class="v3-overline">IT’S YOUR TIME NOW</div><h1>Ваш <em>план.</em></h1><p class="lead v3-lead">Выберите день, неделю или месяц. Сначала действия и основания, подробные учения ниже.</p></div>'+
 '<details class="v6-tools"><summary>Фильтры и дополнительные настройки</summary><div class="v3-top-tools"><div class="v3-link-actions"><button type="button" data-v3-teachings>Все учения</button><button type="button" data-v3-calculations>Расчёты выбранного дня</button></div><div class="v3-lenses" role="group" aria-label="Система рекомендаций">'+
 [['all','Все источники'],['psychology','Мои данные'],['astrology','Традиции']].map(x=>'<button type="button" data-v3-lens="'+x[0]+'" aria-pressed="'+(lens===x[0])+'">'+x[1]+'</button>').join('')+
 '</div><div class="v3-cats" role="group" aria-label="Область дел">'+tabs.map(x=>'<button type="button" data-v3-cat="'+x[0]+'" aria-pressed="'+(active===x[0])+'">'+x[1]+'</button>').join('')+'</div></div></details>';
}
function calendar(){
 let h=legacyCalendar();
 // Keep legacy calendar and all existing engines intact. Recompose them rather than patching backend rendering.
 h=h.replace(/^<div class="eyebrow">PERSONAL TIME MAP<\/div><h1>Ваш <em>календарь\.<\/em><\/h1><p class="lead">[\s\S]*?<\/p>/,contentHeader());
 h=h.replace('<div class="card"><div class="flex">','<section id="v5-forecast" class="v5-forecast" aria-live="polite"><p>Составляем прогноз из календаря и вашей Карты сознания...</p></section><div class="v3-workbench"><section class="v3-left"><div class="card v3-calendar"><div class="flex v3-month-bar">');
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
 const due=psychEvents(day.date),goals=archiveGoals();
 const checkin=currentCheckin(day.date);
 let out='<div class="v3-section-top"><div><div class="v3-kicker">ЛИЧНЫЙ КОНТЕКСТ · ИЗ ВАШИХ ДАННЫХ</div><h4>Цели и реальные наблюдения</h4></div></div>';
 if(!connected)return out+'<p>Карта сознания ещё не передана в этот браузер. Здесь не будет искусственных психологических прогнозов или оценок.</p><a href="'+ORIGINAL_MAP_ORIGIN+'/?research=1" target="_blank" rel="noopener noreferrer">Передать цели и гипотезы из Карты ↗</a>';
 if(goals.length)out+='<div class="v7-psych-tasks">'+goals.slice(0,3).map(g=>{
  const p=typeof g.probability==='number'&&Number.isFinite(g.probability)?Math.round(g.probability*100):null;
  return '<div><strong>'+esc(g.title)+'</strong>'+(g.steps?.length?'<p><b>Следующий шаг:</b> '+esc(g.steps[0])+'</p>':'')+
   (g.risks?.length?'<p><b>Ограничение:</b> '+esc(g.risks[0])+'</p>':'')+
   (p!==null?'<small>Субъективная оценка языковой модели: '+p+'%. Не калиброванная вероятность.</small>':'')+'</div>';
 }).join('')+'</div>';
 if(due.length)out+='<div class="v7-psych-tasks">'+due.map(x=>'<div><b>Проверка на '+esc(x.due)+'</b><p>'+esc(x.action)+'</p></div>').join('')+'</div>';
 if(!goals.length&&!due.length)out+='<p class="v3-small">Для выбранного дня из Карты пока не переданы конкретные цели или проверки. Число записей по сферам не используется для оценки дня.</p>';
 if(day.date<=todayIso()){
  const vals=checkin||{energy:3,stress:3,focus:3};
  out+='<details class="v7-checkin"><summary>Дополнительно: короткий самоотчёт о состоянии</summary><p>Нужен только для подстройки нагрузки сегодня. Это не медицинский тест и не прогноз.</p>'+
   [['energy','Энергия'],['stress','Стресс'],['focus','Фокус']].map(x=>'<label>'+x[1]+' <span id="v3-val-'+x[0]+'">'+vals[x[0]]+'/5</span><input data-v3-check="'+x[0]+'" type="range" min="1" max="5" value="'+vals[x[0]]+'"></label>').join('')+
   '<button type="button" data-v3-save-checkin>Сохранить самонаблюдение</button></details>';
 }
 out+='<div class="v3-link-actions"><a href="'+ORIGINAL_MAP_ORIGIN+'/?research=1" target="_blank" rel="noopener noreferrer">Обновить данные из Карты ↗</a><button type="button" data-v3-disconnect>Отключить</button></div>';
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
const almanacTranslations={"上梁": "установка несущих балок", "伐木": "рубка деревьев", "作梁": "изготовление балок", "作灶": "устройство очага", "修坟": "уход за захоронением", "修饰垣墙": "отделка стен", "入殓": "погребальный обряд", "冠笄": "обряд совершеннолетия", "出火": "перенос ритуального огня", "出货财": "отгрузка товаров", "合寿木": "изготовление погребальных принадлежностей", "合帐": "подготовка свадебного полога", "启钻": "обряд переноса захоронения", "坏垣": "разбор стены", "塑绘": "создание ритуальных изображений", "塞穴": "заделка отверстий", "安门": "установка дверей", "安香": "установка ритуального алтаря", "开池": "устройство водоёма", "成服": "начало траура", "拆卸": "демонтаж", "捕捉": "ловля животных", "掘井": "рытьё колодца", "整手足甲": "уход за ногтями", "斋醮": "пост и религиозный обряд", "无": "нет отдельных указаний", "架马": "установка строительных опор", "求医": "обращение за медицинской помощью", "治病": "лечение", "牧养": "уход за домашними животными", "理发": "стрижка", "畋猎": "охота", "盖屋": "строительство дома", "破屋": "снос здания", "移柩": "перенос гроба", "结网": "плетение сетей", "行丧": "траурные обряды", "补垣": "ремонт ограды", "词讼": "судебное разбирательство", "谢土": "обряд благодарения земле", "进人口": "принятие новых членов семьи или работников", "造庙": "строительство храма", "造畜稠": "строительство помещений для скота", "造船": "строительство лодки или корабля", "造车器": "изготовление транспортных средств", "针灸": "иглоукалывание", "除服": "завершение траура", "雕刻": "резьба и скульптура", "馀事勿取": "остальные начинания не выделены как подходящие"};
function translatedAlmanac(s){return s.replace(/[\u4e00-\u9fff]+/g,x=>almanacTranslations[x]||"традиционное занятие без готового перевода")}
var humanDesignNotes={Manifestor:{label:'Манифестор',why:'В модели Human Design этому типу приписывают инициативу и запуск новых процессов.',use:'Практический эксперимент: перед новым проектом сформулируйте намерение, предупредите тех, кого затронут изменения, и запишите следующий шаг.'},Generator:{label:'Генератор',why:'В системе этот тип связывают с устойчивой вовлечённостью в выбранную деятельность.',use:'Практический эксперимент: сравните энергию после работы над двумя задачами и выберите ту, к которой легче возвращаться.'},'Manifesting Generator':{label:'Манифестирующий генератор',why:'Традиционно связывается с быстрым переключением и параллельными направлениями.',use:'Сравните стоимость переключений между задачами и завершайте один короткий цикл перед новым.'},Projector:{label:'Проектор',why:'Традиционно связывается с наблюдением, анализом и адресным участием.',use:'Сформулируйте одно конкретное предложение для человека, которому оно может быть полезно.'},Reflector:{label:'Рефлектор',why:'Система связывает этот тип с чувствительностью к окружению.',use:'Запишите, какие места и люди усиливают или снижают концентрацию; проверяйте повторяемость.'}};
function hdUseResult(hd){var note=humanDesignNotes[hd?.type]||{};var profile=hd?.profile==='6/2'?' Профиль 6/2 в этой традиции описывают через развитие позиции наблюдателя и потребность периодически уединяться для восстановления.':'',effect=hd?.authority==='Emotional Authority'?' Эмоциональный авторитет связывают с рассмотрением важных решений в разные эмоциональные состояния, без спешки.':'';var action=hd?.type==='Manifestor'&&hd?.profile==='6/2'?'Эксперимент на неделю: 1) Перед новым решением известите тех, кого оно касается. 2) Для необратимого шага назначьте время повторной оценки. 3) Оставьте период самостоятельной работы и проверьте, стало ли меньше ненужного согласования.':(note.use||'Проверьте гипотезы системы на реальных событиях, фиксируя наблюдения.');return {meaning:(note.why||'Human Design классифицирует тип, профиль, авторитет и активные центры по моменту рождения.')+profile+effect,action}}
var westernSigns={Aries:['Овен','инициатива, самостоятельность'],Taurus:['Телец','устойчивость, ресурсы'],Gemini:['Близнецы','коммуникация, обучение'],Cancer:['Рак','забота, безопасность'],Leo:['Лев','самовыражение, публичность'],Virgo:['Дева','анализ, системность, детализация'],Libra:['Весы','сотрудничество, договорённости'],Scorpio:['Скорпион','исследование, глубина'],Sagittarius:['Стрелец','поиск смысла, исследование'],Capricorn:['Козерог','структура, последовательность'],Aquarius:['Водолей','эксперименты, сети'],Pisces:['Рыбы','воображение, эмпатия']};
const teachingReferences={
 tibetan:['Математика тибетского календаря · С. Янсон','https://arxiv.org/abs/1401.6285'],
 bazi:['Стволы и ветви · Гонконгская обсерватория','https://www.hko.gov.hk/en/gts/time/stemsandbranches.htm'],
 lunar:['Фазы Луны · NASA','https://science.nasa.gov/moon/moon-phases/'],
 tzolkin:['Календарь майя · Смитсоновский музей','https://maya.nmai.si.edu/calendar/calendar-system'],
 human:['Термины Human Design · Jovian Archive','https://jovianarchive.com/pages/human-design-dictionary'],
 genekeys:['Чтение профиля · Gene Keys','https://teachings.genekeys.com/how-to-read-your-profile/'],
 circadian:['Циркадные ритмы · NIMH','https://www.nimh.nih.gov/research/research-funded-by-nimh/rdoc/constructs/circadian-rhythms'],
 qimen:['Значения врат · реализация Qimen Dunjia','https://github.com/Maximilian-Winter/Qimen-Dunjia']
};
const numberThemes={
 1:['Инициатива','Начало и самостоятельный выбор','Сформулируйте первый шаг отложенного дела и выполните его.'],
 2:['Диалог','Сотрудничество и согласование','Обсудите с другим человеком один вопрос, где пока нет ясной договорённости.'],
 3:['Выражение','Творчество, речь и обмен идеями','Напишите черновик, сделайте эскиз или объясните идею своими словами.'],
 4:['Порядок','Структура, последовательность и устойчивость','Разбейте одну большую задачу на конкретные шаги и определите первый.'],
 5:['Эксперимент','Разнообразие и выход за привычный способ действия','Попробуйте один новый способ решить знакомую задачу и сравните результат.'],
 6:['Забота','Отношения, ответственность и поддержка','Выберите одно конкретное дело для близкого человека или общего пространства.'],
 7:['Исследование','Анализ и спокойное осмысление','Выделите время для одного вопроса: запишите, что уже известно и чего не хватает.'],
 8:['Ресурсы','Управление, обязательства и результаты','Сверьте бюджет времени или денег с одним реальным обязательством.'],
 9:['Завершение','Подведение итогов и освобождение места','Закончите одно небольшое незавершённое дело.'],
 11:['Идеи','В выбранной школе число сохраняется без сведения к 2','Запишите идею и придумайте небольшой способ её проверить.'],
 22:['Воплощение','В выбранной школе число сохраняется без сведения к 4','Переведите большую задумку в один выполнимый этап.'],
 33:['Поддержка','В выбранной школе число сохраняется без сведения к 6','Предложите конкретную помощь в пределах своих возможностей.']
};
const stems={'甲':'янское дерево','乙':'иньское дерево','丙':'янский огонь','丁':'иньский огонь','戊':'янская земля','己':'иньская земля','庚':'янский металл','辛':'иньский металл','壬':'янская вода','癸':'иньская вода'};
const branches={'子':'Крыса','丑':'Бык','寅':'Тигр','卯':'Кролик','辰':'Дракон','巳':'Змея','午':'Лошадь','未':'Коза','申':'Обезьяна','酉':'Петух','戌':'Собака','亥':'Свинья'};
const houseThemes=['самовосприятие и личная инициатива','деньги и собственные ресурсы','обучение и повседневное общение','дом и семейные основы','творчество и удовольствие','повседневные обязанности и забота о теле','партнёрства и договорённости','общие ресурсы и обязательства','мировоззрение и дальние горизонты','работа и общественная роль','друзья и сообщества','уединение и скрытая нагрузка'];
function explainTeaching(t,day,extra={},natal){
 const result={scope:'Традиционная система',headline:'',meaning:'',practice:'',detail:'',raw:t.period};
 const date=datePretty(day.date),num=Number(t.period.match(/Личный день (\d+)/)?.[1]);
 switch(t.id){
 case 'numerology':{
  const topic=numberThemes[num];result.scope='Личный цикл выбранного дня';
  if(topic){result.headline=topic[0]+' · личный день '+num;result.meaning='В этой нумерологической формуле число '+num+' обозначает тему «'+topic[1].toLowerCase()+'». Она рассчитана для '+date+' по дню и месяцу рождения.';result.practice=topic[2]+' Это упражнение по теме числа.';result.detail='Личный год складывается из дня и месяца рождения и цифр выбранного года; затем добавляются номер месяца и день. Используется сведение суммы, с сохранением 11, 22 и 33.'}
  else{result.headline='Личный день пока не рассчитан';result.meaning='Для этого нужна дата рождения. Без неё нельзя выбрать вашу тему дня.';result.practice='Укажите дату рождения в профиле — число и его объяснение появятся здесь.'}break;
 }
 case 'chaldean':{
  const n=Number(t.period.match(/→\s*(\d+)/)?.[1]),topic=numberThemes[n];result.scope='Постоянный расчёт имени';result.headline=topic?'Тема имени: '+topic[0].toLowerCase():'Число имени пока не рассчитано';result.meaning=topic?'Буквам имени присваиваются числа. Итог '+n+' в используемой таблице связывается с темой «'+topic[1].toLowerCase()+'». Этот результат не меняется при выборе другой даты.':'Для расчёта нужно сохранённое имя. Кириллица переводится в латиницу, поэтому написание влияет на итог.';result.practice=topic?'Сопоставьте эту тему с двумя примерами своего поведения: где она подходит и где не подходит.':'Заполните имя в профиле; при желании используйте привычное написание латиницей.';result.detail='Используется халдейская таблица соответствий букв. Это символическая трактовка имени, а не измерение личности.';break;
 }
 case 'tibetan':{
  const p=extra.tibetan;result.scope='Перевод даты · школа Пхугпа';
  result.headline=p?p.day+'-й лунный день '+p.month+'-го месяца':'Рассчитываем тибетскую дату';
  result.meaning=p?'Так '+date+' записывается в тибетском календаре Пхугпа. «Цикл '+p.cycle+'» — номер 60-летнего цикла, а «год '+p.year+'» — место года внутри него. Это не ваш возраст и не оценка дня.':'Пхугпа — уже выбранная школа календаря. Она использует лунные месяцы, поэтому число месяца и дня отличается от привычного календаря.';
  result.practice=p?'Эту дату можно использовать для поиска соответствующего дня в тибетском календаре практик. По одному номеру лунного дня приложение пока не определяет, какие дела благоприятны.':'Дождитесь перевода даты. Рекомендации о благоприятности дня требуют отдельного астрологического расчёта.';
  result.detail=p?'Модель перевода даты Пхугпа.'+(p.leapMonth?' Это дополнительный лунный месяц.':'')+(p.leapDay?' Это повторный лунный день: та же тибетская дата встречается второй раз.':'')+' Индивидуальный тибетский прогноз не реализован.':'Сервис календаря возвращает номер цикла, года, месяца и дня.';result.raw=p?JSON.stringify(p):'';break;
 }
 case 'bazi':{
  const chars=t.period.match(/день ([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])/);const pair=chars?.[1];result.scope='Календарная пара выбранного дня';result.headline=pair?'День: '+stems[pair[0]]+' и '+branches[pair[1]]:'Столп дня рассчитывается';result.meaning=pair?'«Столп» — пара календарных знаков: первый обозначает стихию и инь/ян, второй — животное 12-частного цикла. Вместе они повторяются через 60 дней. Это описание даты '+date+'.':'Ба-цзы сопоставляет четыре пары знаков — год, месяц, день и час. Здесь показан календарный слой выбранной даты.';result.practice='Можно сопоставлять этот день со своей натальной схемой Ба-цзы. Персональное взаимодействие стихий и большие периоды удачи здесь ещё не вычисляются.';result.detail='Календарная пара сама по себе не определяет, удачен ли день именно для вас. Натальные четыре столпа доступны в подробностях учения.';break;
 }
 case 'wuxing':{
  const phase=t.period.match(/Фаза дня: (.*?) ·/)?.[1];result.scope='Символическая тема выбранного дня';result.headline=phase?'Фаза дня: '+phase:'Пять способов смотреть на процесс';result.meaning='У-син описывает пять образов процесса: дерево — рост, огонь — проявление, земля — устойчивость, металл — упорядочивание, вода — сохранение и подготовка.';result.practice='Посмотрите на текущую задачу: вам сейчас нужно вырастить идею, показать результат, закрепить, убрать лишнее или подготовиться? Выберите одно действие в подходящем направлении.';result.detail='Фаза даты берётся из небесного ствола дня. Практика выше — рефлексивное упражнение; она не означает, что календарная стихия измеряет ваше состояние.';break;
 }
 case 'qimen':{
  const q=extra.qimen;const names={'開門':'открытие','休門':'отдых','生門':'рост','傷門':'повреждение','杜門':'закрытие','景門':'видимость','死門':'завершение','驚門':'тревога'};const door=q&&names[q.chiefDoor];result.scope='Часовая схема · 12:00 выбранной даты';result.headline=door?'Ведущий образ: '+door:'Рассчитываем часовую схему';result.meaning=door?'В Ци Мэнь «врата» — название одного из восьми символических типов ситуации. В схеме на полдень выбраны врата «'+door+'». Это элемент карты, а не команда к действию.':'Ци Мэнь строит схему для определённого часа. Поэтому изменение времени может дать другой результат.';result.practice=door==='видимость'?'Упражнение по теме видимости: проверьте, понятно ли вы объясняете своё предложение. Сформулируйте его в одном предложении.':door==='отдых'?'Упражнение по теме отдыха: определите, что можно отложить, чтобы освободить время для восстановления.':door==='открытие'?'Упражнение по теме открытия: выпишите, что необходимо для начала одного выбранного дела.':door==='рост'?'Упражнение по теме роста: найдите одно небольшое улучшение уже работающего процесса.':'Для планирования решения нужна полная трактовка дворцов, врат и звёзд. По одному ведущему символу не стоит выбирать час сделки или поездки.';result.detail=q?'Рассчитана схема метода Chai Bu. Инь/ян указывает способ построения, число '+q.ju+' — номер схемы; это не балл удачи. Полная персональная трактовка девяти дворцов не реализована.':'Если расчёт не загрузится, обновите страницу.';result.raw=q?JSON.stringify(q):'';break;
 }
 case 'lunar':result.scope='Астрономический цикл дня';result.headline=day.moon.phase+' · освещено '+day.moon.illumination+'%';result.meaning='Процент показывает освещённую Солнцем часть видимого диска Луны. Фаза описывает её вид с Земли в выбранную дату, а не уровень вашей энергии.';result.practice='Можно отметить фазу рядом с записью сна или самочувствия и позже сравнить наблюдения. По самой фазе нельзя определить вашу продуктивность.';result.detail='Луна в знаке '+day.moon.sign+'. Положение рассчитано астрономически; традиционная трактовка знака показана в астрологическом контексте выше.';break;
 case 'solar':result.scope='Положение Солнца на выбранную дату';result.headline='Солнце в знаке '+day.sun.sign;result.meaning='Название знака указывает участок годового пути Солнца в тропическом зодиаке. Это текущая календарная позиция, а не ваш знак рождения.';result.practice='Используйте карточку для ориентации в годовом цикле. Длину светового дня и местную погоду нужно учитывать отдельно — положение в знаке их не заменяет.';result.detail='Тропический зодиак делит годовой путь на 12 равных участков от точки весеннего равноденствия.';break;
 case 'hellenistic':{
  const n=Number(t.period.match(/Профекция: (\d+)/)?.[1]),theme=houseThemes[n-1];result.scope='Личный год · от дня рождения';result.headline=theme?'Тема года: '+theme:'Годовая тема пока не рассчитана';result.meaning=theme?'В методе годовых профекций на этот возраст приходится '+n+'-й дом. «Дом» здесь — условная область жизни: '+theme+'. Тема меняется в день рождения, а не каждый день.':'Метод последовательно проходит 12 областей жизни. Для определения текущего шага нужна дата рождения.';result.practice=theme?'В качестве упражнения выберите один реальный вопрос в этой области и запишите, что хотите прояснить в течение года.':'Добавьте дату рождения в профиле.';result.detail='Здесь рассчитан номер дома по возрасту. Для управителя года и полной трактовки нужны асцендент и натальная карта.';break;
 }
 case 'western':{
  const w=natal?.western;result.scope='Личная натальная схема';result.headline=w?'Солнце: '+(westernSigns[w.sun]?.[0]||w.sun)+' · Луна: '+(westernSigns[w.moon]?.[0]||w.moon):'Натальная схема: нужны полные данные рождения';result.meaning=w?'Это положения на момент вашего рождения. В астрологической традиции Солнце связывают с самовыражением, Луну — с привычными эмоциональными реакциями.'+(w.rising?' Асцендент — восходящий знак: '+(westernSigns[w.rising]?.[0]||w.rising)+'.':''):'Для полной схемы нужны дата, время и место рождения. Дневные положения Солнца и Луны уже показаны в астрологическом контексте.';if(w)result.meaning+=' В трактовке знаков: Солнце — '+(westernSigns[w.sun]?.[1]||'тема самовыражения')+'; Луна — '+(westernSigns[w.moon]?.[1]||'эмоциональные привычки')+'.';result.practice=w?'Сравните эти символические темы с конкретными примерами из дневника. Транзиты выбранной даты к натальным Солнцу и Луне смотрите в блоке «Натальные транзиты».':'Уточните недостающие данные в профиле; сохранённые поля повторно вводить не нужно.';result.detail='Натальная схема постоянна. Дневные транзиты и натальная карта — разные расчёты.';break;
 }
 case 'vedic':{
  const v=natal?.vedic;result.scope='Джйотиш · положение Луны при рождении';result.headline=v?'Накшатра '+v.nakshatra+', четверть '+v.pada:'Натальная накшатра пока не рассчитана';result.meaning=v?'Накшатра — один из 27 участков лунного пути в индийской системе. «Пада '+v.pada+'» означает четверть этого участка. Это координата вашей натальной Луны, а не оценка выбранного дня.':'Для этого расчёта нужны точные данные рождения. Система использует сидерический зодиак и выбранную поправку между зодиаками — аянамшу.';result.practice='Периоды даши и местный календарь дня пока не рассчитаны для выбранной даты. Поэтому эта карточка не назначает благоприятные часы и дела.';result.detail='Махадаша — большой традиционный период, антардаша — его подпериод. Текущий серверный результат даши не выдаётся за расчёт произвольно выбранного дня.';break;
 }
 case 'human':{
  const h=natal?.human;const labels={Generator:'Генератор',ManifestingGenerator:'Манифестирующий генератор','Manifesting Generator':'Манифестирующий генератор',Manifestor:'Манифестор',Projector:'Проектор',Reflector:'Рефлектор'};const type=h&&(labels[h.type]||h.type);result.scope='Постоянная схема Human Design';result.headline=h?'Тип: '+type+' · профиль '+h.profile:'Личная схема пока не рассчитана';result.meaning=h?'Тип в этой системе описывает предполагаемый способ взаимодействия с задачами. Профиль — сочетание двух ролей в обучении и отношениях. Эти категории вычисляются по рождению и не меняются при выборе даты.':'Human Design строит символическую схему по дате, времени и месту рождения. Без полного расчёта нельзя определить тип и профиль.';if(h){const roles={1:'исследователь — изучает основы',2:'отшельник — нуждается в самостоятельном пространстве',3:'экспериментатор — учится на пробах',4:'связующий — опирается на отношения',5:'практик — ищет решения для других',6:'ролевой пример — осмысляет накопленный опыт'};result.meaning=hdUseResult(h).meaning+' Числа профиля '+h.profile+' обозначают две роли: '+String(h.profile).split('/').map(n=>roles[n]||n).join('; ')+'. Это описание внутри системы, оно не меняется при выборе даты.';}result.practice=h?hdUseResult(h).action:'Уточните данные рождения в профиле; затем здесь появится расшифровка личной схемы.';result.detail=h?'Профиль '+h.profile+'. Внутренний авторитет в модели: '+({'Emotional Authority':'эмоциональный — дать решению время в разных состояниях','Sacral Authority':'сакральный — обращать внимание на непосредственный отклик','Splenic Authority':'селезёночный — интуитивный отклик момента'}[h.authority]||h.authority)+'. Это термин системы о способе принятия решений, а не подтверждённое психологическое измерение.':'Ежедневные транзиты Human Design не подключены.';break;
 }
 case 'genekeys':{
  const g=natal?.genekeys;result.scope='Постоянный профиль · самоисследование';result.headline=g?'Темы вашего профиля':'Профиль Генных ключей пока не рассчитан';result.meaning=g?'«Дело жизни» ('+g.lifeWork+') — тема самовыражения; «Эволюция» ('+g.evolution+') — тема трудностей и роста; «Сияние» ('+g.radiance+') — тема благополучия. Числа — номера разделов системы, а не баллы или результаты анализа ДНК.':'Это система созерцания поведенческих тем, использующая символические позиции рождения. К генетическому анализу она не относится.';result.practice=g?'Выберите одну область — самовыражение, трудность или благополучие — и запишите конкретный пример из своей жизни. Толкования самих ключей в этой версии ещё не подключены.':'Для вычисления номеров профиля заполните полные данные рождения.';result.detail='Профиль остаётся одним и тем же на разных датах. Полный словарь смыслов ключей не реализован; номера сами по себе не являются персональной рекомендацией.';break;
 }
 case 'tzolkin':result.scope='260-дневный календарь майя';result.headline='Календарный день: '+t.period.split(' · ')[0];result.meaning='Первое число — место в последовательности от 1 до 13. Следующее слово — одно из 20 имён дня. Их сочетание повторяется через 260 дней и обозначает выбранную дату в календаре майя.';result.practice='Можно сравнивать записи, сделанные на одинаковые календарные сочетания. Значение символа для личных решений здесь пока не интерпретируется.';result.detail='Используется соответствие GMT 584283 между календарями. Число не является оценкой энергии или удачи.';break;
 case 'huangli':{
  const ready=t.period.startsWith('宜:');const p=translatedAlmanac(t.period.replace('宜:','Традиционно подходит:').replace(' · 忌:','. Традиционно избегают:'));result.scope='Традиционные занятия выбранного дня';result.headline=ready?'Что отмечено в китайском альманахе':'Загружаем занятия из альманаха';result.meaning=ready?p:'Хуанли содержит два списка: подходящие занятия и занятия, которых традиция советует избегать. Они зависят от даты.';result.practice='Найдите в списках именно своё действие. Если оно не указано, альманах не даёт ему отдельной оценки. Реальные сроки и договорённости имеют приоритет.';result.detail='Списки относятся к календарной школе Хуанли и не учитывают вашу личную психологическую карту. Медицинские решения и обращения за помощью не следует откладывать из-за календарной отметки.';break;
 }
 case 'meridian':result.scope='Традиционные часы · полдень выбранной даты';result.headline='11:00–13:00 · традиционный интервал сердца';result.meaning='В китайской системе меридианных часов сутки делятся на 12 двухчасовых интервалов. Для выбранной даты здесь взят полдень, поэтому показан интервал 11:00–13:00.';result.practice='Можно использовать его как напоминание остановиться и отметить самочувствие. Название меридиана не говорит о состоянии сердца и не назначает медицинские действия.';result.detail='Это символическое распределение времени. Личные физиологические пики по этим названиям не измеряются.';break;
 case 'circadian':result.scope='Ваш суточный режим';result.headline='Ритм сна и бодрствования';result.meaning='Циркадный ритм — примерно суточные колебания биологических процессов. Для персонального планирования важны ваш реальный сон, время бодрствования и повторные наблюдения.';result.practice='Сопоставьте время сложной задачи с тем, когда вы обычно чувствуете ясность. На будущую дату энергия не предсказывается; отметьте её в день выполнения.';result.detail='Точное окно максимальной работоспособности не рассчитано. Выбор календарной даты сам по себе не определяет хронотип.';break;
 case 'ultradian':result.scope='Короткие колебания бодрости';result.headline='Найдите свою длительность рабочего блока';result.meaning='Внутри суток состояние меняется несколько раз. Универсального таймера, который точно определяет ваш спад концентрации, здесь нет.';result.practice='Для одного рабочего блока запишите время начала, момент заметного утомления и эффект перерыва. После нескольких наблюдений сравните повторяющиеся интервалы.';result.detail='Приложение не навязывает всем 90-минутный цикл и пока не строит персональный прогноз по наблюдениям.';break;
 case 'iching':result.scope='Практика по вашему запросу';result.headline='Гексаграмма для этой даты не выбрана';result.meaning='Гексаграмма — рисунок из шести сплошных или прерывистых линий. Его выбирают отдельной процедурой для сформулированного вопроса; дата сама по себе не создаёт ответ.';result.practice='Сформулируйте один вопрос о ситуации. Процедура выбора находится в разделе «Сегодня» → «И Цзин». Здесь результат к дате автоматически не привязывается.';result.detail='Результат используется как материал для размышления, а не как установленный исход события.';break;
 case 'tarot':result.scope='Практика по вашему запросу';result.headline='Карта для этой даты не выбрана';result.meaning='Таро использует образы карт для обсуждения ситуации. В приложении доступен случайный выбор одного из 22 Старших Арканов; это отдельное действие пользователя.';result.practice='Определите вопрос, затем откройте «Сегодня» → «Таро». Запишите, какую новую точку зрения дал образ и какие факты её поддерживают.';result.detail='Карточка не делает автоматических предсказаний и не переносит старый случайный выбор на новую дату.';break;
 default:throw Error('Missing explanation: '+t.id);
 }
 return result;
}
function teachingOrigin(id){
 const known={
  western:'NatalEngine + astronomy-engine · детерминированный натальный расчёт',
  vedic:'NatalEngine · ведические циклы по времени рождения',
  human:'NatalEngine · правила Human Design (не психометрический тест)',
  genekeys:'NatalEngine · правила Gene Keys (не психометрический тест)',
  hellenistic:'Самописные правила профекций на основе натальной схемы',
  huangli:'lunar-javascript · китайский альманах по дате',
  bazi:'lunar-javascript · календарные стволы и ветви',
  qimen:'Самописные правила Ци Мэнь Дунь Цзя',
  tibetan:'Самописная модель календаря Пхугпа',
  lunar:'astronomy-engine · фазы и положения Луны',
  solar:'astronomy-engine · положения Солнца',
  wuxing:'Символическая классификация пяти элементов по календарным данным',
  numerology:'Авторская нумерологическая формула',
  chaldean:'Авторская таблица соответствий букв и чисел',
  tzolkin:'Авторский календарный расчёт Цолькин',
  meridian:'Справочная таблица меридианных часов',
  circadian:'Справочные сведения о циркадных ритмах, без индивидуального прогноза',
  ultradian:'Справочные сведения о циклах работы и отдыха',
  iching:'Ручной выбор гексаграммы по вопросу',
  tarot:'Случайная карта по запросу пользователя'
 };
 return (known[id]||'Правило приложения')+'. Текст рекомендации написан заранее, языковая модель здесь не вызывается.';
}
function teachingCard(t,day,extra,natal){
 const e=explainTeaching(t,day,extra,natal),ref=teachingReferences[t.id];
 return '<div class="v3-kicker">'+esc(e.scope)+'</div><h4>'+esc(t.icon+' '+t.name)+'</h4><p class="v6-engine-label">Источник: '+esc(teachingOrigin(t.id))+'</p><div class="v3-kicker" style="margin-top:12px">РЕЗУЛЬТАТ</div><strong style="display:block;font-size:19px;line-height:1.5">'+esc(e.headline)+'</strong><p style="margin-top:16px"><b>Что это значит</b><br>'+esc(e.meaning)+'</p><p><b>Как использовать</b><br>'+esc(e.practice)+'</p><details><summary>Расчёт и ограничения</summary><p>'+esc(e.detail)+'</p>'+(e.raw?'<p class="v3-small" style="overflow-wrap:anywhere">Исходный результат: '+esc(e.raw)+'</p>':'')+(ref?'<a href="'+ref[1]+'" target="_blank" rel="noopener noreferrer">'+esc(ref[0])+' ↗</a>':'')+'</details><button type="button" class="secondary" style="margin-top:14px" data-v4-teaching="'+esc(t.id)+'">Подробнее об учении</button>';
}

const archiveLabels={completedTests:'Тесты',journal:'Дневник',chatHistory:'История диалогов',hypotheses:'Жизненные гипотезы',researchHypotheses:'Проверяемые гипотезы',researchExperiments:'Проверки',lifeEvents:'События жизни',yearNotes:'Заметки по годам',people:'Люди',userDocuments:'Документы и разметка',sources:'Первичные источники',liveTestRuns:'Live Test',personalResearchProfile:'Исследовательский профиль',goals:'Цели',intentions:'Намерения',formulations:'Формулировки',cellNotes:'Заметки карты',pinnedPrograms:'Закреплённые программы',customPrograms:'Свои программы',hypothesisChecks:'Проверки гипотез',hypothesisEvents:'События гипотез',summaries:'Сводки',humanosStageStatus:'HumanOS: статусы',humanosBlockChecks:'HumanOS: блоки',humanosStageChecks:'HumanOS: этапы',balanceWheels:'Колёса баланса',resemblanceRuns:'Сходства',birthDate:'Дата рождения',lifeHorizonYears:'Горизонт жизни',activeLens:'Линза карты',mode:'Режим',onboarded:'Настройка пройдена',version:'Версия',exportedAt:'Дата снимка',lastSelfCheckTs:'Последняя сверка'};
const fieldLabels={...archiveLabels,text:'Текст',title:'Название',claim:'Предположение',basis:'Основание',confidence:'Уверенность',status:'Статус',sphere:'Сфера',spheres:'Сферы',tags:'Метки',date:'Дата',ts:'Создано',takenAt:'Пройден',responses:'Ответы',result:'Результат',content:'Содержание',kind:'Тип',filename:'Файл',markers:'Разметка',derived:'Производные данные',name:'Имя',role:'Роль',year:'Год',method:'Метод',due:'Срок',meaning:'Смысл',description:'Описание',score:'Значение',traits:'Черты',generatedFrom:'Источник формирования'};
function archiveSize(v){return Array.isArray(v)?v.length:v&&typeof v==='object'?Object.keys(v).length:v==null||v===''?0:1}
function validateArchive(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||!Array.isArray(v.completedTests)||!Array.isArray(v.journal)||!Array.isArray(v.lifeEvents))throw Error('Неверный формат полной Карты');
 const text=JSON.stringify(v);if(text.length>8_000_000)throw Error('Полная Карта превышает 8 МБ');
 return JSON.parse(text);
}
function renderRecord(value,depth=0){
 if(value==null)return '<span class="v3-small">—</span>';
 if(typeof value!=='object')return '<div style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(typeof value==='boolean'?(value?'Да':'Нет'):value)+'</div>';
 if(depth>12)return '<pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(value,null,2))+'</pre>';
 return Object.entries(value).map(([k,v])=>'<div class="v3-real-task"><span>'+esc(Array.isArray(value)?Number(k)+1:fieldLabels[k]||k)+'</span>'+renderRecord(v,depth+1)+'</div>').join('');
}
function archivePanel(day){
 const a=psychology?.archive;
 if(!a)return '<section class="v3-source-card"><h3>Полная психологическая карта</h3><p>Пока получена только сводка. В основной Карте нажмите «Передать всю Карту в планнер».</p></section>';
 const zone=st().timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
 const dated=[];
 for(const k of ['journal','lifeEvents','completedTests','researchExperiments'])for(const row of a[k]||[]){
  let date=row.date||row.due;
  if(!date&&k!=='lifeEvents'&&(row.takenAt||row.ts)){
   const d=new Date(row.takenAt||row.ts);
   if(Number.isFinite(d.getTime())){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);date=['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');}
  }
  if(date===day)dated.push({kind:archiveLabels[k],row});
 }
 let out='<section class="v3-source-card" id="v4-map-archive"><div class="v3-kicker">ПОЛНАЯ КАРТА · СОХРАНЕНА В ЭТОМ БРАУЗЕРЕ</div><h3>Психологическая карта · все данные</h3><p class="v3-small">Дневники, результаты, исходные тексты и разметка доступны ниже. Записи сохраняют свои даты; гипотезы остаются предположениями. Эта копия не отправляется в Google Календарь.</p>';
 out+='<p>'+['completedTests','journal','lifeEvents','hypotheses','userDocuments','sources','people'].map(k=>archiveLabels[k]+': '+archiveSize(a[k])).join(' · ')+'</p>';
 out+='<h4>Записи на '+esc(datePretty(day))+'</h4>'+(dated.length?dated.map(x=>'<details><summary>'+esc(x.kind+' · '+(x.row.title||x.row.testId||x.row.method||'Запись'))+'</summary>'+renderRecord(x.row)+'</details>').join(''):'<p class="v3-small">Записей с этой точной датой нет. Весь архив остаётся доступен ниже.</p>');
 out+='<h4>Весь архив · '+Object.keys(a).length+' разделов</h4>'+Object.entries(a).map(([k,v])=>'<details class="v3-secondary-details" data-v4-archive="'+esc(k)+'"><summary>'+esc(archiveLabels[k]||k)+' · '+archiveSize(v)+'</summary><div data-v4-content></div></details>').join('')+'</section>';
 return out;
}
function bindArchive(root){root.querySelectorAll('[data-v4-archive]').forEach(el=>el.ontoggle=()=>{if(el.open&&!el.dataset.loaded){el.querySelector('[data-v4-content]').innerHTML=renderRecord(psychology.archive[el.dataset.v4Archive]);el.dataset.loaded='1'}})}
const extraDays=new Map();let personalPromise;
function teachingsPanel(day){
 const all=app.teachingsForDate?.(day.date)||[];
 return '<section class="v3-source-card" id="v4-teachings" data-date="'+esc(day.date)+'"><div class="v3-kicker">'+esc(datePretty(day.date))+' · ВСЕ УЧЕНИЯ</div><h3>Все учения для выбранной даты · '+all.length+'</h3><p class="v3-small">У каждой системы — результат, объяснение и способ применения. Натальные схемы постоянны; часовые системы показаны на 12:00.</p>'+all.map(t=>'<article class="v3-suggestion" style="margin-top:22px" data-v4-card="'+esc(t.id)+'">'+teachingCard(t,day)+'</article>').join('')+'</section>';
}
async function fillTeachings(day){
 const root=document.getElementById('v4-teachings');if(!root)return;
 let extra={},natal=null;
 const all=app.teachingsForDate?.(day.date)||[];
 function bind(){root.querySelectorAll('[data-v4-teaching]').forEach(b=>b.onclick=()=>app.openTeaching(b.dataset.v4Teaching))}
 function update(ids){if(!root.isConnected||root.dataset.date!==day.date)return;for(const t of all.filter(t=>ids.includes(t.id))){const el=root.querySelector('[data-v4-card="'+t.id+'"]');if(el)el.innerHTML=teachingCard(t,day,extra,natal)}bind()}
 bind();
 if(!extraDays.has(day.date))extraDays.set(day.date,fetch('/api/day-systems?date='+encodeURIComponent(day.date)+'&time=12:00').then(async r=>{if(!r.ok)throw Error('Ошибка расчёта');return r.json()}).catch(err=>{extraDays.delete(day.date);throw err}));
 const daily=async()=>{try{extra=await extraDays.get(day.date);update(['qimen','tibetan'])}catch{for(const id of ['qimen','tibetan']){const el=root.querySelector('[data-v4-card="'+id+'"] strong');if(root.isConnected&&el)el.textContent='Не удалось загрузить расчёт. Обновите страницу.'}}};
 const personal=async()=>{try{personalPromise||=(app.personalTeachings?.()||Promise.resolve(null)).catch(e=>{personalPromise=null;throw e});natal=await personalPromise;update(['western','vedic','human','genekeys'])}catch{for(const id of ['western','vedic','human','genekeys']){const el=root.querySelector('[data-v4-card="'+id+'"] strong');if(root.isConnected&&el)el.textContent='Не удалось загрузить персональную схему. Обновите страницу.'}}};
 await Promise.allSettled([daily(),personal()]);
}

function dayPanel(day,model,state){
 const due=psychEvents(day.date);
 const next=findNextGoal(day.date,state);
 const priority=due.length?{caption:'ПРОВЕРКА В КАРТЕ',title:due[0].action,why:'Реальный срок вашей проверки'}:next&&next.date===day.date?{caption:'СРОК СЕГОДНЯ',title:next.name,why:'Установленный вами дедлайн'}:psychology?.goals?.length?{caption:'ВАША ЦЕЛЬ',title:psychology.goals[0].title,why:'Цель из Карты сознания'}:next?{caption:'БЛИЖАЙШАЯ ЦЕЛЬ',title:next.name,why:'Дедлайн '+next.date}:{caption:'ФОКУС ДНЯ',title:'Выберите одно важное действие',why:'Приоритет задаётся реальной задачей, а не астрологией'};
 const checkin=currentCheckin(day.date);
 let out='<div class="v6-day-navigation"><button type="button" data-v3-shift="-1" aria-label="Предыдущий день">←</button><span>Выбранный день: '+esc(datePretty(day.date))+'</span><button type="button" data-v3-shift="1" aria-label="Следующий день">→</button></div>';
 out+='<details class="v5-reference" id="v6-day-analysis"><summary>Разбор этого дня: психологическое состояние и традиционные методы</summary>';
 if(lens==='all'||lens==='psychology')out+='<section class="v3-source-card v3-psych-card">'+psychPanel(day,state)+'</section>';
 if(lens==='all'||lens==='astrology')out+='<section class="v3-source-card v3-astro-card">'+astroPanel(day,model,state)+'</section>';
 out+='</details>';
 out+='<details class="v5-reference" id="v5-archive-ref"><summary>Психологический архив и исходные записи</summary>'+archivePanel(day.date)+'</details>';
 out+='<details class="v5-reference" id="v5-teachings-ref"><summary>Все 20 учений · расчёты и подробные объяснения</summary>'+teachingsPanel(day)+'</details>';
 if(lens==='all')out+='<div class="v3-principle">При расхождении рекомендаций дедлайны, наблюдаемые данные и ваше самочувствие имеют приоритет над символическими календарными правилами.</div>';
 const root=document.getElementById('astro-day');if(!root)return;root.innerHTML=out;
 const records=root.querySelector('#v5-archive-ref');if(records)records.ontoggle=()=>{if(records.open)bindArchive(records)};
 const traditions=root.querySelector('#v5-teachings-ref');if(traditions)traditions.ontoggle=()=>{if(traditions.open)void fillTeachings(day)};
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
  if(!confirm('Отключить Карту сознания и удалить переданную копию из браузера планнера?'))return;
  psychology=null;try{localStorage.removeItem(PSY_KEY)}catch{}
  paint();
 };
}
function paintMapConnection(){
 const box=document.getElementById('v3-map-connection');if(!box)return;
 const count=archiveGoals().length;
 const detail=psychology?(count?'Есть '+count+' активных целей. ':'')+'Сохранено в этом браузере.':'Пока нет личных целей в планнере.';
 box.innerHTML='<div class="v7-map-mini"><b>Личная Карта</b><span>'+esc(detail)+'</span><a href="'+ORIGINAL_MAP_ORIGIN+'/?research=1" target="_blank" rel="noopener noreferrer">'+(psychology?'Обновить ↗':'Подключить ↗')+'</a></div>'+(mapTransferError?'<p class="v3-muted-warning">'+esc(mapTransferError)+'</p>':'');
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
 paintForecast(state);
}

const forecastLoading=new Set(),forecastFailed=new Set();
function forecastShift(date,n){const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function forecastRange(date,horizon){
 if(horizon==='day')return [date];
 const d=new Date(date+'T12:00:00');
 if(horizon==='week'){const monday=forecastShift(date,-((d.getDay()+6)%7));return Array.from({length:7},(_,i)=>forecastShift(monday,i))}
 const first=date.slice(0,7)+'-01',last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
 return Array.from({length:last},(_,i)=>date.slice(0,7)+'-'+String(i+1).padStart(2,'0'));
}
function forecastCacheKey(ym,state){return [ym,state.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',state.birth||'',state.birthtime||'',state.birthZone||''].join('|')}
function requireForecastModel(ym,state){
 const k=forecastCacheKey(ym,state);
 if(cache[k]||forecastLoading.has(k)||forecastFailed.has(k))return;
 forecastLoading.add(k);
 const tz=state.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 fetch('/api/astro-planner?month='+encodeURIComponent(ym)+'&tz='+encodeURIComponent(tz),
 {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({birth:state.birth||'',birthtime:state.birthtime||'',birthZone:state.birthZone||''})})
 .then(async r=>{const data=await r.json();if(!r.ok||!Array.isArray(data.days))throw Error(data.error||'Нет данных календаря');cache[k]=data;})
 .catch(()=>forecastFailed.add(k))
 .finally(()=>{forecastLoading.delete(k);if(visible())paintForecast(st())});
}
function archiveGoals(){
 const a=psychology?.archive?.goals;
 if(Array.isArray(a)&&a.length)return a.filter(g=>g&&g.status==='active').map(g=>({
 id:g.id,title:g.text||g.title||'',probability:typeof g.plan?.probability==='number'&&Number.isFinite(g.plan.probability)?Math.max(0,Math.min(1,g.plan.probability)):null,
 modelInfo:g.plan?.modelInfo||null,
 steps:Array.isArray(g.plan?.steps)?g.plan.steps.slice(0,4):[],
 supports:Array.isArray(g.plan?.factors?.supports)?g.plan.factors.supports.slice(0,3):[],
 risks:Array.isArray(g.plan?.factors?.risks)?g.plan.factors.risks.slice(0,3):[],
 history:Array.isArray(g.history)?g.history.slice(-10):[]
 }));
 return (psychology?.goals||[]).map(g=>({
 id:g.id,title:g.title,probability:g.modelProbability??null,modelInfo:g.modelInfo||null,steps:g.nextSteps||[],
 supports:g.supportFactors||[],risks:g.riskFactors||[],history:[]
 }));
}
function forecastTimeLabel(start,end){
 const short=d=>new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
 return start===end?datePretty(start):short(start)+' — '+short(end);
}
function forecastRow(label,text,type){
 return '<div class="v5-signal '+(type||'')+'"><span>'+esc(label)+'</span><div>'+esc(text)+'</div></div>';
}
function forecastTimeline(days,horizon){
 if(horizon==='day')return '';
 const shown=horizon==='week'?days:days.filter(x=>x.item?.overall==='good'||x.item?.overall==='caution').slice(0,9);
 if(!shown.length)return '<p class="v5-faded">Календарные расчёты для этого периода пока не загружены.</p>';
 return '<div class="v5-timeline">'+shown.map(d=>{
 const sign=d.item?.overall||'neutral';
 const label=sign==='good'?'Традиционно подходит':sign==='caution'?'Традиционно осторожнее':'Без акцента';
 return '<button class="v5-tile '+sign+'" data-v5-date="'+esc(d.date)+'"><b>'+esc(new Date(d.date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'}))+'</b><span>'+esc(label)+'</span></button>';
 }).join('')+'</div>';
}
function forecastEvidence(start,end){
 const a=psychology?.archive||{};
 const year=+end.slice(0,4);
 const hypotheses=(Array.isArray(a.hypotheses)&&a.hypotheses.length?a.hypotheses:psychology?.predictions||[])
 .filter(x=>x&&(x.status==='pending'||!x.status)&&Number(x.year)===year).slice(0,4);
 const research=(Array.isArray(a.researchHypotheses)&&a.researchHypotheses.length?a.researchHypotheses:psychology?.researchForecasts||[])
 .filter(x=>x&&(x.status==='active'||!x.status)&&(!x.expectedBy||(x.expectedBy>=start&&x.expectedBy<=end))).slice(0,4);
 const intentions=(Array.isArray(a.intentions)&&a.intentions.length?a.intentions:psychology?.intentions||[])
 .filter(x=>x&&(x.status==='active'||!x.status)&&Number(x.year)===year).slice(0,3);
 let out='';
 if(hypotheses.length){
 out+='<div class="v5-kicker">Годовые гипотезы Карты · ещё не подтверждены</div>';
 out+=hypotheses.map(h=>forecastRow('Сила основания '+(h.confidenceLevel||h.confidence||1)+'/3',h.claim,'hypothesis')).join('');
 }
 if(research.length){
 out+='<div class="v5-kicker">Проверяемые психологические гипотезы</div>';
 out+=research.map(h=>forecastRow(h.expectedBy||'Открыта',h.claim,'hypothesis')).join('');
 }
 if(intentions.length){
 out+='<div class="v5-kicker">Активные намерения</div>';
 out+=intentions.map(h=>forecastRow(String(h.year||year),h.claim,'')).join('');
 }
 return out;
}
function forecastCheckins(end){
 const keys=Object.keys(checkins).filter(k=>k<=end&&currentCheckin(k)).sort().slice(-7);
 if(!keys.length)return '';
 const sums={energy:0,stress:0,focus:0};
 keys.forEach(k=>{const c=currentCheckin(k);for(const prop of Object.keys(sums))sums[prop]+=c[prop]});
 const avg=x=>(sums[x]/keys.length).toFixed(1);
 return '<div class="v5-track">Последние '+keys.length+' самоотчётов к этой дате: энергия '+avg('energy')+'/5, стресс '+avg('stress')+'/5, внимание '+avg('focus')+'/5. Это наблюдаемый фон, не прогноз состояния.</div>';
}

/* Day-first reading: full information for the selected date instead of placeholder "focus". */
const dayReadingExtraCache=new Map(),dayReadingExtraInFlight=new Set();
let dayReadingNatal=null,dayReadingNatalStarted=false;
const dayLifeTopics={
 work:{headline:'Работа, запуск и договорённости',why:'Взвесьте реальный срок, ресурсы и следующий шаг. Китайские даты используются лишь как традиционный контекст.'},
 money:{headline:'Финансы и обязательства',why:'Фактический риск определяется условиями платежа и договора. Календарный символ не заменяет проверку реквизитов.'},
 creative:{headline:'Творчество и производство',why:'Оцените готовность черновика и стоимость следующей итерации. Период не может гарантировать качество результата.'},
 relationship:{headline:'Отношения, общение, встречи',why:'Проверяйте конкретные договорённости, а не интерпретацию чужих мотивов через календарь.'},
 learning:{headline:'Исследования, обучение, мышление',why:'Разделяйте наблюдение, утверждение и проверку. Один материал за день ценнее непроверенного обобщения.'},
 rest:{headline:'Тело, нагрузка и восстановление',why:'Используйте свои данные сна и самочувствия. Календарь не определяет состояние здоровья.'}
};
const dayLevelRu={good:'Традиционный акцент',neutral:'Без однозначного акцента',caution:'Традиционные ограничения'};
function dayReadingExtras(date){
 if(dayReadingExtraCache.has(date))return dayReadingExtraCache.get(date);
 if(!dayReadingExtraInFlight.has(date)){
  dayReadingExtraInFlight.add(date);
  fetch('/api/day-systems?date='+encodeURIComponent(date)+'&time=12:00').then(async r=>{
    const j=await r.json();if(!r.ok||j.error)throw Error(j.error||'Система временно недоступна');
    dayReadingExtraCache.set(date,j);
  }).catch(e=>dayReadingExtraCache.set(date,{_error:String(e.message||e)}))
  .finally(()=>{dayReadingExtraInFlight.delete(date);if(visible()&&st().selected===date&&forecastHorizon==='day')paintForecast(st())});
 }
 return null;
}
function dayReadingNatalLoad(state){
 if(dayReadingNatalStarted||!state.birth||!state.birthtime||!state.birthZone)return;
 dayReadingNatalStarted=true;
 Promise.resolve().then(()=>app.personalTeachings?.()).then(x=>{dayReadingNatal=x||null;})
 .catch(e=>{dayReadingNatal={_error:String(e.message||e)};})
 .finally(()=>{if(visible()&&forecastHorizon==='day')paintForecast(st())});
}
function dayReadingCategory(c){
 const t=dayLifeTopics[c.id]||{headline:c.name,why:'Сопоставьте традиционную трактовку с реальными задачами.'};
 const label=dayLevelRu[c.level]||'Символическое описание';
 const symbols=c.why||'В календаре нет отдельных указаний для темы.';
 return '<article class="v7-domain"><div class="v7-domain-top"><h3>'+esc(t.headline)+'</h3><span class="v7-tag '+esc(c.level)+'">'+esc(label)+'</span></div>'+
 '<p class="v7-action"><b>Что сделать:</b> '+esc(c.do.replace(/^Практический вариант:\s*/,''))+'</p>'+
 '<p class="v7-caution"><b>Что учесть:</b> '+esc(c.avoid)+'</p>'+
 '<details class="v7-why"><summary>На чём основан этот акцент</summary><p>'+esc(symbols)+'</p><p>'+esc(t.why)+'</p><small>Статус получен из вручную заданной символической формулы, не из статистики успешных дней.</small></details></article>';
}
function dayReadingTeaching(t,day,extra,natal){
 let e;
 try{e=explainTeaching(t,day,extra||{},natal||null)}catch{return ''}
 if(!e)return '';
 const available=!(e.headline||'').match(/пока не рассчитан|пока не рассчитана|Рассчитываем|Загружаем/i);
 const details='Источник: '+teachingOrigin(t.id);
 return '<article class="v7-system"><div class="v7-system-title"><h4>'+esc(t.name)+'</h4><span>'+esc(e.scope)+'</span></div>'+
 '<strong>'+esc(e.headline||'Результат недоступен')+'</strong>'+
 '<p><b>Что означает:</b> '+esc(e.meaning)+'</p>'+
 '<p><b>Как применить сегодня:</b> '+esc(e.practice)+'</p>'+
 '<details><summary>Метод расчёта и ограничения</summary><p>'+esc(e.detail)+'</p><p class="v7-muted">'+esc(details)+'</p></details></article>';
}
function dayReadingView(state,day,goals,tasks){
 const date=state.selected;
 const extra=dayReadingExtras(date);
 dayReadingNatalLoad(state);
 const d=day?.item;
 const current=date===todayIso();
 const all=app.teachingsForDate?.(date)||[];
 const pick=id=>all.find(x=>x.id===id);
 const check=currentCheckin(date);
 const sorted=tasks.slice().sort((a,b)=>a.date.localeCompare(b.date));
 const oneGoal=goals.find(g=>g.steps?.length)||goals[0];
 const dayName=datePretty(date);
 const cats=d?.categories||[];
 const good=cats.filter(c=>c.level==='good'),caution=cats.filter(c=>c.level==='caution');
 const phase=d?.moon?.phase||'Фаза неизвестна';
 const lunar=d?.moon?.sign||'не определён';
 const sun=d?.sun?.sign||'не определён';
 const huangli=d?.traditional||{yi:[],ji:[]};
 const yi=(huangli.yi||[]).slice(0,5),ji=(huangli.ji||[]).slice(0,5);
 const symbolicFocus=good.length?
  'В принятой символической формуле отдельно выделяются: '+good.map(x=>x.name.toLowerCase()).join(', ')+'.':
  caution.length?'Формула отмечает ограничения по направлениям: '+caution.map(x=>x.name.toLowerCase()).join(', ')+'.':
  'Явного преобладающего акцента в формуле нет.';
 const firstAction=sorted[0]?.text||oneGoal?.steps?.[0]||'Определите один измеримый результат, который важно получить до конца дня.';
 const currentSignal=current&&check&&(check.stress>=4||check.energy<=2)
 ?'В сегодняшнем самоотчёте отмечены '+(check.stress>=4?'высокий стресс':'сниженная энергия')+'. Сократите необязательные обязательства; это рекомендация по нагрузке, не предсказание.'
 :oneGoal?'В Карте есть цель «'+oneGoal.title+'». Ни календарь, ни знак Луны не заменяют конкретный шаг по ней.':
 'Для индивидуального решения нужны реальные цели и наблюдения; пока показан календарный контекст и практические ориентиры.';
 const headerTitle=current?'Сегодня: '+dayName:'Разбор дня: '+dayName;
 let out='<div class="v7-head"><div><div class="v7-eyebrow">'+esc(state.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC')+' · ДНЕВНАЯ КАРТИНА</div><h2>'+esc(headerTitle)+'</h2><p>Что происходит по используемым календарным системам, как это трактуется и какие действия можно из этого извлечь.</p></div><div class="v5-horizons" role="group" aria-label="Период">';
 for(const [id,label] of [['day','День'],['week','Неделя'],['month','Месяц']])out+='<button type="button" data-v5-horizon="'+id+'" aria-pressed="'+String(forecastHorizon===id)+'">'+label+'</button>';
 out+='</div></div>';
 out+='<div class="v7-top-nav"><button type="button" data-v7-shift="-1">← Вчера</button><button type="button" data-v7-today>Сегодня</button><button type="button" data-v7-shift="1">Завтра →</button></div>';
 if(!d){
  out+='<div class="v7-loading"><b>Календарные расчёты ещё загружаются.</b><p>Дата: '+esc(dayName)+'. Если расчёты недоступны, не буду подменять их общими прогнозами.</p></div>';
  rootDayReading(out);return;
 }
 out+='<section class="v7-story"><div class="v7-eyebrow">КАРТИНА ДНЯ · АСТРОНОМИЯ И ТРАДИЦИИ</div><h3>'+esc(d.moon.phase)+' · Луна в '+esc(lunar)+'</h3>';
 out+='<p>На '+esc(dayName)+' Луна находится в знаке '+esc(lunar)+', освещённость диска '+esc(d.moon.illumination)+'%. Солнце — в '+esc(sun)+'. Это астрономически рассчитанные положения; традиционные школы приписывают им символические значения.</p>';
 out+='<p>'+esc(symbolicFocus)+' Сопоставляйте их с фактическими задачами и доступными ресурсами: формула не измеряет вашу продуктивность и не предсказывает исход события.</p>';
 if(d.events?.length)out+='<div class="v7-events"><b>События дня:</b> '+d.events.slice(0,4).map(e=>esc((e.at?e.at+' · ':'')+e.title)).join(' · ')+'</div>';
 out+='</section>';
 out+='<section class="v7-decide"><div><div class="v7-eyebrow">ВАШ ПРИОРИТЕТ</div><h3>'+esc(firstAction)+'</h3><p>'+esc(currentSignal)+'</p></div><div class="v7-source-tag">Основание: '+esc(sorted.length?'ваш дедлайн':oneGoal?'цель из Карты':'общее правило планирования')+'</div></section>';
 out+='<div class="v7-sections"><div class="v7-section-title"><h3>1. Как провести этот день</h3><p>Шесть направлений с действиями и возможными ограничениями. Статусы справа отражают только традиционную модель, не личную вероятность успеха.</p></div><div class="v7-domains">';
 const order=['work','money','creative','relationship','learning','rest'];
 out+=order.map(id=>cats.find(c=>c.id===id)).filter(Boolean).map(dayReadingCategory).join('');
 out+='</div></div>';
 out+='<section class="v7-almanac"><div class="v7-section-title"><h3>2. Что именно говорит Хуанли</h3><p>Два списка традиционных занятий. Они описывают дату, но не оценивают личную ситуацию.</p></div><div class="v7-almanac-grid"><div><span>Традиционно подходит</span><p>'+esc(yi.length?yi.join(' · '):'Нет отмеченных занятий')+'</p></div><div><span>Традиционно нежелательно</span><p>'+esc(ji.length?ji.join(' · '):'Нет отмеченных занятий')+'</p></div></div></section>';
 out+='<section class="v7-section-block"><div class="v7-section-title"><h3>3. Разбор по учениям</h3><p>Каждое учение даёт свой тип информации. Ни одно из них автоматически не превращает дату в проверенный прогноз событий.</p></div><div class="v7-systems">';
 // All daily relevant systems; permanent natal profiles are separate below
 const ids=['numerology','huangli','lunar','bazi','wuxing','qimen','tibetan','tzolkin'];
 out+=ids.map(id=>pick(id)).filter(Boolean).map(t=>dayReadingTeaching(t,d,extra,dayReadingNatal)).join('');
 out+='</div></section>';
 if(extra?._error)out+='<p class="v7-muted">Часовая/тибетская система: '+esc(extra._error)+'. Точный расчёт пока недоступен.</p>';
 else if(!extra)out+='<p class="v7-muted">Ци Мэнь и тибетский календарь: загружаем отдельные вычисления для этой даты…</p>';
 if(dayReadingNatal&&!dayReadingNatal._error){
  const natIds=['western','vedic','human','genekeys'];
  out+='<details class="v7-more"><summary>4. Мои четыре натальные системы · постоянный личный профиль</summary><p class="v7-muted">Эти схемы описывают момент рождения и сами по себе не меняются каждый день. Натальные транзиты доступны отдельно.</p><div class="v7-systems">'+natIds.map(id=>pick(id)).filter(Boolean).map(t=>dayReadingTeaching(t,d,extra,dayReadingNatal)).join('')+'</div></details>';
 }else if(state.birth&&state.birthtime)out+='<p class="v7-muted">Персональные натальные схемы: '+esc(dayReadingNatal?._error||'загружаются')+'.</p>';
 if(d.personalAspects?.length)out+='<details class="v7-more"><summary>Аспекты выбранного дня к натальной схеме · '+d.personalAspects.length+'</summary>'+d.personalAspects.map(x=>'<p>'+esc(x.title+' · орбис '+x.orb+'°. '+x.explanation)+'</p>').join('')+'</details>';
 out+='<section class="v7-personal"><div class="v7-section-title"><h3>5. Мой план и психологический контекст</h3><p>Здесь должны влиять на решение реальные задачи, цели, наблюдения и проверки, а не число записей по сферам.</p></div>';
 if(sorted.length)out+='<div class="v7-personal-tasks">'+sorted.slice(0,5).map(x=>'<div><span>'+esc(x.kind)+' · '+esc(x.date)+'</span><b>'+esc(x.text)+'</b></div>').join('')+'</div>';
 if(goals.length)out+='<div class="v7-goals">'+goals.slice(0,3).map(g=>{
  const p=typeof g.probability==='number'&&Number.isFinite(g.probability)?Math.round(g.probability*100):null;
  return '<div class="v7-goal"><b>'+esc(g.title)+'</b>'+(p!==null?'<span>Оценка языковой модели: '+p+'%. Это не проверенная вероятность события.</span>':'')+(g.steps?.length?'<p>Следующее действие: '+esc(g.steps[0])+'</p>':'')+(g.risks?.length?'<p>Что может мешать: '+esc(g.risks[0])+'</p>':'')+'</div>';
 }).join('')+'</div>';
 if(!psychology)out+='<p class="v7-muted">Твоя личная Карта пока не подключена к этому браузеру. Чтобы здесь появились личные цели и гипотезы, передай сводку из Карты сознания.</p><a class="v7-link" href="'+ORIGINAL_MAP_ORIGIN+'/?research=1" target="_blank" rel="noopener noreferrer">Подключить личную Карту ↗</a>';
 else if(!sorted.length&&!goals.length)out+='<p class="v7-muted">Сводка подключена, но активных целей и проверок нет. Не подставляю искусственные оценки.</p>';
 out+='</section>';
 out+='<details class="v7-method"><summary>Откуда берутся результаты и насколько им можно доверять</summary><p><b>Расчётная часть:</b> astronomy-engine для небесных положений; lunar-javascript для Хуанли; серверный метод для Ци Мэнь и тибетского календаря; отдельный NatalEngine для личных натальных систем.</p><p><b>Интерпретации:</b> словарь традиций и редакционные практические рекомендации. Языковая модель не генерирует ежедневные трактовки в планнере.</p><p><b>Психология:</b> задачи и цели из локального профиля, дополнительные модельные оценки из Карты сознания. Они не являются калиброванными статистическими вероятностями.</p></details>';
 rootDayReading(out);
 function rootDayReading(html){
  const root=document.getElementById('v5-forecast');if(!root)return;root.innerHTML=html;
  root.querySelectorAll('[data-v5-horizon]').forEach(b=>b.onclick=()=>{forecastHorizon=b.dataset.v5Horizon;try{localStorage.setItem(FORECAST_KEY,forecastHorizon)}catch{}paintForecast(st())});
  root.querySelectorAll('[data-v7-shift]').forEach(b=>b.onclick=()=>app.selectDate(forecastShift(date,Number(b.dataset.v7Shift))));
  root.querySelectorAll('[data-v7-today]').forEach(b=>b.onclick=()=>app.selectToday());
 }
}

function paintForecast(state){
 const root=document.getElementById('v5-forecast');if(!root)return;
 const dates=forecastRange(state.selected,forecastHorizon),start=dates[0],end=dates[dates.length-1];
 const months=[...new Set(dates.map(d=>d.slice(0,7)))];
 for(const ym of months)requireForecastModel(ym,state);
 const days=dates.map(date=>({date,item:cache[forecastCacheKey(date.slice(0,7),state)]?.days?.find(d=>d.date===date)}));
 const ready=days.filter(d=>d.item);
 const goals=archiveGoals();
 const ownTasks=(state.goals||[]).filter(x=>x.date>=start&&x.date<=end).map(x=>({date:x.date,text:x.name,kind:'Цель из планнера'}));
 const checks=(psychology?.experiments||[]).filter(x=>x.due>=start&&x.due<=end).map(x=>({date:x.due,text:x.action,kind:'Проверка из Карты'}));
 const tasks=[...ownTasks,...checks].sort((a,b)=>a.date.localeCompare(b.date));
 if(forecastHorizon==='day'){dayReadingView(state,days[0],goals,tasks);return;}
 const today=currentCheckin(state.selected),isCurrent=state.selected===todayIso();
 const goalWithPlan=goals.find(x=>x.steps?.length);
 let recommendation,reason,action,sourceLabel,guard;
 if(forecastHorizon==='day'&&isCurrent&&today&&(today.stress>=4||today.energy<=2)){
  recommendation='Сократить план до одной обязательной задачи';
  action=tasks[0]?.text||goalWithPlan?.steps[0]||'Выберите самое важное дело и выделите короткий рабочий блок.';
  reason='В сегодняшнем самоотчёте '+(today.stress>=4?'стресс '+today.stress+'/5':'энергия '+today.energy+'/5')+'. Это ваш собственный показатель, а не предсказание.';
  sourceLabel='Самоотчёт + правила нагрузки';guard='Перед новым обязательством проверьте доступное время и ресурс.';
 }else if(tasks.length){
  recommendation=forecastHorizon==='day'?'Сосредоточиться на ближайшем сроке':'Начать с первой контрольной точки периода';
  action=tasks[0].text;
  reason=tasks[0].kind+': '+tasks[0].date+'. В периоде всего '+tasks.length+' запланированных дел и проверок.';
  sourceLabel='Ваши сроки и проверки';guard='Сначала оцените объём задачи и время на её выполнение.';
 }else if(goalWithPlan){
  recommendation='Продвинуть активную цель одним конкретным действием';
  action=goalWithPlan.steps[0];
  reason='Шаг указан в разборе цели «'+goalWithPlan.title+'» в вашей Карте сознания.';
  sourceLabel='Разбор цели из Карты';guard='Оценка исполнения цели отражает мнение языковой модели, а не статистический прогноз.';
 }else if(goals.length){
  recommendation='Превратить цель в выполнимый следующий шаг';
  action='Для цели «'+goals[0].title+'» запишите действие, которое можно проверить в течение '+(forecastHorizon==='day'?'дня':forecastHorizon==='week'?'недели':'месяца')+'.';
  reason='Цель есть в Карте, но конкретные шаги не переданы.';
  sourceLabel='Ваша цель + правило планирования';guard='Уточните критерий завершения и назначьте контрольную дату.';
 }else{
  recommendation='Определить реальный приоритет на выбранный период';
  action='Выберите одно дело, запишите наблюдаемый результат и назначьте срок.';
  reason='Планнер пока не видит целей или контрольных точек для этого периода.';
  sourceLabel='Базовое правило планирования';guard='Пока нет личных данных, совет общий. Прогнозировать поведение невозможно.';
 }
 const horizonTitle=forecastHorizon==='day'?'День':forecastHorizon==='week'?'Неделя':'Месяц';
 const meta=psychology?.source==='conscious-map'?'Основная Карта':psychology?'Исследовательская V2':'Нет подключения';
 let out='<div class="v6-head"><div><div class="v6-eyebrow">ПЛАН ДЕЙСТВИЙ · '+esc(forecastTimeLabel(start,end))+'</div><h2>'+horizonTitle+' · что делать</h2><p>Совет из ваших задач и наблюдений. Традиционные расчёты приведены отдельно.</p></div><div class="v5-horizons" role="group" aria-label="Период">';
 for(const [key,label] of [['day','День'],['week','Неделя'],['month','Месяц']])out+='<button type="button" data-v5-horizon="'+key+'" aria-pressed="'+String(forecastHorizon===key)+'">'+label+'</button>';
 out+='</div></div>';
 out+='<section class="v6-main"><div class="v6-eyebrow">'+esc(sourceLabel)+'</div><h3>'+esc(recommendation)+'</h3><div class="v6-action"><span>Что сделать</span><strong>'+esc(action)+'</strong></div><p class="v6-reason"><b>Почему:</b> '+esc(reason)+'</p><p class="v6-warning">'+esc(guard)+'</p><button type="button" class="v6-state-button" data-v6-checkin>Отметить своё состояние ↗</button></section>';
 out+='<div class="v6-section"><div class="v6-section-heading"><h3>01 · Ваши задачи и сроки</h3><span>'+tasks.length+' на период</span></div>';
 if(tasks.length)out+='<div class="v6-tasks">'+tasks.slice(0,4).map((t,i)=>'<button type="button" class="v6-task" data-v6-date="'+esc(t.date)+'"><small>'+esc(t.date)+' · '+esc(t.kind)+'</small><b>'+esc(t.text)+'</b><span>К дате ↗</span></button>').join('')+'</div>';
 else out+='<p class="v6-empty">Дел с установленным сроком не обнаружено. Добавьте дату в цели или назначьте эксперимент в Карте.</p>';
 if(tasks.length>4)out+='<details class="v6-expander"><summary>Ещё '+(tasks.length-4)+' дела</summary>'+tasks.slice(4,18).map(t=>forecastRow(t.kind+' · '+t.date,t.text,'')).join('')+'</details>';
 out+='</div>';
 out+='<div class="v6-section"><div class="v6-section-heading"><h3>02 · Что говорит Карта сознания</h3><span>'+esc(meta)+'</span></div>';
 if(!psychology){
  out+='<div class="v6-connect"><p>Психологические расчёты пока не переданы. Это не отсутствие прогнозов в Карте: приложения хранят личные данные отдельно.</p><a href="'+ORIGINAL_MAP_ORIGIN+'/?research=1" target="_blank" rel="noopener noreferrer">Подключить цели и прогнозы ↗</a></div>';
 }else{
  if(goals.length){
   out+='<div class="v6-goals">'+goals.slice(0,3).map(g=>{
    const valid=typeof g.probability==='number'&&Number.isFinite(g.probability)&&g.probability>=0&&g.probability<=1;
    const p=valid?Math.round(g.probability*100):null;
    const model=g.modelInfo?.model?g.modelInfo.model:'модель не записана в старом разборе';
    return '<article class="v6-goal"><div class="v6-goal-top"><b>'+esc(g.title)+'</b><span>'+(p===null?'Без оценки':p+'%')+'</span></div>'+
     (valid?'<p class="v6-model-label">Оценка LLM, не проверенная вероятность. Модель: '+esc(model)+'</p><div class="v5-meter"><i style="width:'+p+'%"></i></div>':'<p class="v6-model-label">Нет модельной оценки. Ничего не подставлено вместо неё.</p>')+
     (g.steps?.length?'<p><b>Шаг:</b> '+esc(g.steps[0])+'</p>':'')+
     (g.supports?.length?'<p><b>Помогает:</b> '+esc(g.supports[0])+'</p>':'')+
     (g.risks?.length?'<p><b>Мешает:</b> '+esc(g.risks[0])+'</p>':'')+
    '</article>';
   }).join('')+'</div>';
  }else out+='<p class="v6-empty">Активные цели не переданы. Оценки здесь появятся только после расчёта цели в Карте.</p>';
  const annual=(psychology?.predictions||[]).filter(x=>Number(x.year)===Number(end.slice(0,4)));
  const research=(psychology?.researchForecasts||[]).filter(x=>!x.expectedBy||(x.expectedBy>=start&&x.expectedBy<=end));
  if(annual.length||research.length)out+='<details class="v6-expander"><summary>Гипотезы и сценарии · '+(annual.length+research.length)+'</summary>'+
   annual.slice(0,5).map(h=>'<div class="v6-hyp"><span>Годовая гипотеза · основание '+esc(h.confidenceLevel||1)+'/3</span><p>'+esc(h.claim)+'</p></div>').join('')+
   research.slice(0,5).map(h=>'<div class="v6-hyp"><span>Проверяемое предположение'+(h.expectedBy?' · срок '+esc(h.expectedBy):'')+'</span><p>'+esc(h.claim)+'</p></div>').join('')+'</details>';
  const stale=Date.now()-Number(psychology.exportedAt||0)>7*86400000;
  if(stale)out+='<p class="v6-small">Данные старше недели. Обновите передачу из Карты для текущих целей.</p>';
 }
 out+='</div>';
 const relevant=ready.flatMap(x=>(x.item?.categories||[]).map(c=>({date:x.date,...c})));
 const counts={};
 for(const c of relevant){
  if(!counts[c.id])counts[c.id]={name:c.name,good:0,caution:0};
  if(c.level==='good')counts[c.id].good++;
  if(c.level==='caution')counts[c.id].caution++;
 }
 const sorted=Object.values(counts).sort((a,b)=>b.good-a.good||a.caution-b.caution);
 const positives=sorted.filter(c=>c.good>0).slice(0,2);
 out+='<details class="v6-trad"><summary><span>03 · Традиционный календарный контекст</span><small>Хуанли · Луна · астрологические правила</small></summary>';
 out+='<p>Это символический слой. Астрономические координаты рассчитываются, но соответствие дат успешным действиям научно не установлено.</p>';
 if(ready.length!==dates.length)out+='<p class="v6-small">Рассчитано '+ready.length+' из '+dates.length+' дней: часть периода ещё загружается.</p>';
 if(positives.length)out+='<p><b>Символически выделены темы:</b> '+esc(positives.map(x=>x.name+' ('+x.good+' дн.)').join(', '))+'. Это количество совпадений правил, не шанс успеха.</p>';
 else out+='<p>Явного преобладающего акцента нет. Реальные задачи лучше выбирать по срокам.</p>';
 if(forecastHorizon==='day'&&ready[0]){
  const categories=active==='all'?ready[0].item.categories.slice(0,3):ready[0].item.categories.filter(c=>c.id===active);
  out+=categories.map(c=>'<div class="v6-trad-item"><b>'+esc(c.name)+'</b><p>'+esc(c.do)+'</p><small>Основание: '+esc(c.why)+'</small></div>').join('');
 }else out+=forecastTimeline(days,forecastHorizon);
 out+='</details>';
 out+='<details class="v6-source"><summary>Как это рассчитано · модели, данные и ограничения</summary>'+
 '<div class="v6-source-row"><b>Главный совет</b><span>Авторские правила в планнере, без нейросети. Порядок: сегодняшняя нагрузка → назначенный срок → шаг цели → общий совет. Источники: ваши записи и задачи.</span></div>'+
 '<div class="v6-source-row"><b>Оценки целей</b><span>Языковая модель, выбранная в «Карте сознания» при разборе цели. Это её субъективная оценка, не статистическая вероятность и не прогноз на конкретную дату. Для новых разборов сохраняются название модели и провайдер.</span></div>'+
 '<div class="v6-source-row"><b>Хуанли и астрономия</b><span>lunar-javascript формирует китайские календарные занятия, astronomy-engine — положения и фазы небесных тел. Вручную заданные правила переводят их в категории «работа», «финансы» и другие. Нейросеть здесь не участвует.</span></div>'+
 '<div class="v6-source-row"><b>Четыре натальные схемы</b><span>NatalEngine вычисляет западные, ведические, Human Design и Gene Keys показатели по данным рождения. Толкования заранее написаны; достоверная предсказательная точность для жизненных исходов не установлена.</span></div>'+
 '<div class="v6-source-row"><b>Личные данные</b><span>'+esc(psychology?(psychology.archive?'Передан полный архив в этот браузер.':'Передана ограниченная сводка: дневники и ответы тестов не копировались.'):'Нет подключённой Карты сознания.')+'</span></div>'+
 '</details>';
 root.innerHTML=out;
 root.querySelectorAll('[data-v5-horizon]').forEach(b=>b.onclick=()=>{forecastHorizon=b.dataset.v5Horizon;try{localStorage.setItem(FORECAST_KEY,forecastHorizon)}catch{}paintForecast(st())});
 const checkButton=root.querySelector('[data-v6-checkin]');if(checkButton)checkButton.onclick=()=>{
  const drawer=document.getElementById('v6-day-analysis');if(drawer){drawer.open=true;drawer.scrollIntoView({behavior:'smooth',block:'start'});}
 };
 root.querySelectorAll('[data-v5-date],[data-v6-date]').forEach(b=>b.onclick=()=>{
  forecastHorizon='day';try{localStorage.setItem(FORECAST_KEY,'day')}catch{}
  app.selectDate(b.dataset.v5Date||b.dataset.v6Date);
 });
}

function sanitiseSnapshot(value){
 if(!value||value.version!==1||!['conscious-map-v2','conscious-map'].includes(value.source))throw Error('Неподдерживаемый формат');
 const goals=Array.isArray(value.goals)?value.goals.slice(0,12):[];
 const experiments=Array.isArray(value.experiments)?value.experiments.slice(0,20):[];
 const hypotheses=Array.isArray(value.hypotheses)?value.hypotheses.slice(0,10):[];
 return {version:1,source:value.source,exportedAt:Number(value.exportedAt)||Date.now(),
  ...(value.archive?{archive:validateArchive(value.archive)}:{}),
  goals:goals.map(x=>({id:truncate(x.id,80),title:truncate(x.title,180),readiness:Math.max(0,Math.min(100,Number(x.readiness)||0)),supportCount:Math.max(0,Math.min(999,Number(x.supportCount)||0)),riskCount:Math.max(0,Math.min(999,Number(x.riskCount)||0)),modelProbability:typeof x.modelProbability==='number'&&Number.isFinite(x.modelProbability)?Math.max(0,Math.min(1,x.modelProbability)):null,nextSteps:Array.isArray(x.nextSteps)?x.nextSteps.slice(0,4).map(q=>truncate(q,220)):[],supportFactors:Array.isArray(x.supportFactors)?x.supportFactors.slice(0,4).map(q=>truncate(q,220)):[],riskFactors:Array.isArray(x.riskFactors)?x.riskFactors.slice(0,4).map(q=>truncate(q,220)):[],
 modelInfo:x.modelInfo&&typeof x.modelInfo==='object'?{provider:truncate(x.modelInfo.provider,40),model:truncate(x.modelInfo.model,100),calculatedAt:Number(x.modelInfo.calculatedAt)||0}:null})),
  experiments:experiments.map(x=>({id:truncate(x.id,80),action:truncate(x.action,220),due:isValidDate(x.due)?x.due:'',hypothesisId:truncate(x.hypothesisId,80)})),
  hypotheses:hypotheses.map(x=>({id:truncate(x.id,80),title:truncate(x.title,180),expectedBy:isValidDate(x.expectedBy)?x.expectedBy:''})),
  predictions:(Array.isArray(value.predictions)?value.predictions:[]).slice(0,12).map(x=>({id:truncate(x.id,80),claim:truncate(x.claim,650),basis:truncate(x.basis,500),year:Number(x.year)||0,confidenceLevel:Math.max(1,Math.min(3,Number(x.confidenceLevel)||1))})),
  researchForecasts:(Array.isArray(value.researchForecasts)?value.researchForecasts:[]).slice(0,12).map(x=>({id:truncate(x.id,80),claim:truncate(x.claim,650),expectedBy:isValidDate(x.expectedBy)?x.expectedBy:'',confidence:Math.max(0,Math.min(1,Number(x.confidence)||0))})),
  intentions:(Array.isArray(value.intentions)?value.intentions:[]).slice(0,10).map(x=>({id:truncate(x.id,80),claim:truncate(x.claim,400),year:Number(x.year)||0})),
  stats:{evidenceCount:Math.max(0,Math.min(99999,Number(value.stats?.evidenceCount)||0)),experimentsOpen:Math.max(0,Math.min(99999,Number(value.stats?.experimentsOpen)||0)),hypothesesActive:Math.max(0,Math.min(99999,Number(value.stats?.hypothesesActive)||0)),sphereCounts:Object.fromEntries(['self','shadow','relations','body','meaning','lineage','work'].map(k=>[k,Math.max(0,Math.min(99999,Number(value.stats?.sphereCounts?.[k])||0))]))}};
}
const connection=new URLSearchParams(location.search).get('connect');
const importOrigin=connection==='conscious-map-v2'?MAP_ORIGIN:connection==='conscious-map-original'?ORIGINAL_MAP_ORIGIN:null;
if(importOrigin&&window.opener){
 window.addEventListener('message',event=>{
  if(event.origin!==importOrigin||event.source!==window.opener||event.data?.type!=='CONSCIOUS_MAP_TO_PLANNER_V1')return;
  try{
   const data=sanitiseSnapshot(event.data.payload);
   if(!data.archive&&psychology?.archive)data.archive=psychology.archive;
   const previous=localStorage.getItem(PSY_KEY);
   if(previous)localStorage.setItem(PSY_KEY+'_previous',previous);
   const serialized=JSON.stringify(data);
   localStorage.setItem(PSY_KEY,serialized);
   if(localStorage.getItem(PSY_KEY)!==serialized)throw Error('Не удалось проверить сохранение');
   event.source.postMessage({type:'IYTN_PLANNER_SAVED'},event.origin);
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
