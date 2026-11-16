import * as Astro from 'astronomy-engine';

// The ephemeris is astronomical; the action guidance below is traditional symbolism,
// not a scientifically validated prediction of outcomes.
const SIGNS = ['Овен','Телец','Близнецы','Рак','Лев','Дева','Весы','Скорпион','Стрелец','Козерог','Водолей','Рыбы'];
const CAT = [
  {id:'work',name:'Работа и запуск',yes:['开工','开业','开市','赴任','订盟'],no:['开工','开业','开市','赴任','订盟'],do:'Выберите один проект. Запишите результат ближайшего рабочего блока и отправьте участникам конкретный следующий шаг.',avoid:'Не обещайте новый срок до оценки объёма работ и доступной команды.',align:['fire','earth']},
  {id:'money',name:'Финансы и договоры',yes:['交易','纳财','立券','求财','置产','签约'],no:['交易','纳财','立券','求财','置产','签约'],do:'Перед договором сверьте сумму, валюту, реквизиты, дату оплаты и порядок приёмки. Зафиксируйте спорные пункты письменно.',avoid:'Не переносите платёж и не подписывайте документ только из-за календарной отметки.',align:['earth']},
  {id:'creative',name:'Творчество',yes:['开工','酝酿','会友','裁衣'],no:['开工','酝酿','会友','裁衣'],do:'Соберите один законченный черновик или тестовый кадр. Покажите его человеку, который способен дать предметную обратную связь.',avoid:'Не превращайте подготовку референсов в замену реальной работы над материалом.',align:['fire','air']},
  {id:'relationship',name:'Отношения и встречи',yes:['会友','会亲友','订盟','嫁娶','纳采'],no:['会友','会亲友','订盟','嫁娶','纳采'],do:'Сформулируйте тему разговора и один конкретный вопрос. После встречи зафиксируйте договорённость и следующий контакт.',avoid:'Не интерпретируйте поведение другого человека через знак или день календаря.',align:['air','water']},
  {id:'learning',name:'Учёба и исследования',yes:['入学','学习','开光'],no:['入学','学习','开光'],do:'Выберите одну исследовательскую гипотезу. Найдите первоисточник и запишите, какой результат подтвердил бы её, а какой опроверг.',avoid:'Не считайте убедительную формулировку подтверждением исследования.',align:['air','water']},
  {id:'rest',name:'Здоровье и восстановление',yes:['沐浴','扫舍','解除'],no:['沐浴','扫舍','解除'],do:'Сверьте фактические сон, усталость и нагрузку. Заранее поставьте в календарь время на отдых без обязательных задач.',avoid:'Не изменяйте медицинские решения и лечение из-за астрологических отметок.',align:['earth','water']}
];
const ELEMENT = ['fire','earth','air','water','fire','earth','air','water','fire','earth','air','water'];
const SIGN_TRAITS = {
  fire:'В традиционной интерпретации огненные знаки связывают с инициативой и выражением идей.',
  earth:'В традиционной интерпретации земные знаки связывают с практическими задачами и устойчивостью.',
  air:'В традиционной интерпретации воздушные знаки связывают с общением и обучением.',
  water:'В традиционной интерпретации водные знаки связывают с отношениями и осмыслением.'
};
const CODE_NAME = {
  '开工':'начало работ','开业':'открытие дела','开市':'запуск торговли',
  '赴任':'новая должность','订盟':'договорённости','交易':'сделки',
  '纳财':'получение платежей','立券':'оформление договоров','求财':'финансовые дела',
  '置产':'покупка имущества','签约':'подписание','酝酿':'подготовка',
  '会友':'встречи','裁衣':'изготовление','会亲友':'встречи с близкими',
  '嫁娶':'свадьбы','纳采':'обручение','入学':'начало учёбы',
  '学习':'учёба','开光':'освящение','沐浴':'уход за собой',
  '扫舍':'уборка','解除':'завершение обязательств'
};
function norm(x){return ((x%360)+360)%360;}
function signIndex(x){return Math.floor(norm(x)/30);}
function delta(a,b){return ((b-a+540)%360)-180;}
function localParts(instant,tz){
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(instant);
  const out={};for(const part of parts)if(part.type!=='literal')out[part.type]=+part.value;
  return out;
}
function localToUtc(day,hour,tz){
  const [y,m,d]=day.split('-').map(Number),wanted=Date.UTC(y,m-1,d,hour,0,0);
  let guess=wanted;
  for(let i=0;i<4;i++){
    const p=localParts(new Date(guess),tz);
    const actual=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    const shift=wanted-actual;
    guess+=shift;
    if(!shift)break;
  }
  return new Date(guess);
}
function localTime(instant,tz){return new Intl.DateTimeFormat('ru-RU',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(instant);}
function moonLongitude(d){return Astro.EclipticGeoMoon(d).lon;}
function mercuryLongitude(d){return Astro.Ecliptic(Astro.GeoVector('Mercury',d,true)).elon;}
// Label precise quarter phases only near the actual 90°/270° elongation.
// Previously the app called ~37-42% illuminated Moon "first quarter".
export function moonPhaseName(angle){
  if(angle<10||angle>=350)return 'Новолуние';
  if(angle<82)return 'Растущий серп';
  if(angle<=98)return 'Первая четверть';
  if(angle<170)return 'Растущая выпуклая Луна';
  if(angle<=190)return 'Полнолуние';
  if(angle<262)return 'Убывающая выпуклая Луна';
  if(angle<=278)return 'Последняя четверть';
  return 'Убывающий серп';
}
function moonIngress(start,end,tz){
  const first=signIndex(moonLongitude(start)),last=signIndex(moonLongitude(new Date(end.getTime()-1000)));
  if(first===last)return null;
  let low=start.getTime(),high=end.getTime()-1000;
  for(let i=0;i<20;i++){const mid=Math.floor((low+high)/2);if(signIndex(moonLongitude(new Date(mid)))===first)low=mid;else high=mid;}
  const instant=new Date(high);
  return {title:'Луна переходит в '+SIGNS[last],at:localTime(instant,tz),kind:'moon-ingress',explanation:'Проверенная эфемеридой смена тропического знака Луны. Интерпретации знаков символические.'};
}
function dayCategory(cfg,day,moonElement,retro,phaseAngle){
  const yi=day.almanac?.yi||[],ji=day.almanac?.ji||[];
  const fits=cfg.yes.filter(c=>yi.includes(c)),warnings=cfg.no.filter(c=>ji.includes(c));
  const signMatch=cfg.align.includes(moonElement);
  let score=(fits.length?2:0)-(warnings.length?2:0)+(signMatch?1:0);
  let reasons=[];
  if(fits.length)reasons.push('Хуанли 宜: '+fits.map(x=>CODE_NAME[x]||x).join(', '));
  if(warnings.length)reasons.push('Хуанли 忌: '+warnings.map(x=>CODE_NAME[x]||x).join(', '));
  if(signMatch)reasons.push('Луна в знаке соответствующей символической стихии');
  if(cfg.id==='work'||cfg.id==='creative'){
    if(phaseAngle>20&&phaseAngle<160){score+=1;reasons.push('Растущая фаза Луны: традиционный мотив развития');}
  }
  if(cfg.id==='rest'||cfg.id==='learning'){
    if(phaseAngle>200&&phaseAngle<340){score+=1;reasons.push('Убывающая фаза: традиционный мотив завершения и осмысления');}
  }
  if(retro&&(cfg.id==='money'||cfg.id==='work')){
    score-=1;reasons.push('Меркурий видимо движется ретроградно: символический повод перепроверять коммуникацию');
  }
  const mixed=fits.length>0&&warnings.length>0;
  const level=mixed?'neutral':warnings.length&&!fits.length?'caution':fits.length&&!warnings.length?'good':score>=3?'good':score<=-1?'caution':'neutral';
  return {
    id:cfg.id,name:cfg.name,level,score,
    do:(mixed?'Символические сигналы противоречат друг другу. Практический вариант: ':'Практический вариант: ')+cfg.do,
    avoid:cfg.avoid,
    why:mixed?'Хуанли одновременно отмечает подходящие и нежелательные действия по этой теме. Единая оценка здесь недостоверна; ориентируйтесь на сроки и факты.':reasons.length?reasons.join(' · '):'Хуанли и фазы Луны не выделяют тему однозначно. Прогноза успешности нет.',
    sources:[...(fits.length||warnings.length?['Китайский альманах Хуанли']:[]),'Астрономические эфемериды / традиционная интерпретация']
  };
}
function personalNatal(profile){
  if(!profile||!/^\d{4}-\d{2}-\d{2}$/.test(profile.birth||''))return null;
  if(!/^[0-2]\d:[0-5]\d$/.test(profile.birthtime||'')||!profile.birthZone)return null;
  try{
    const [h,m]=profile.birthtime.split(':').map(Number);
    if(h>23)return null;
    const at=new Date(localToUtc(profile.birth,h,profile.birthZone).getTime()+m*60000);
    return {sun:Astro.SunPosition(at).elon,moon:moonLongitude(at),
      sunSign:SIGNS[signIndex(Astro.SunPosition(at).elon)],
      moonSign:SIGNS[signIndex(moonLongitude(at))]};
  }catch{return null;}
}
function personalAspects(at,natal){
  if(!natal)return [];
  const t=[['Луна',moonLongitude(at),3.5],['Солнце',Astro.SunPosition(at).elon,1.0]];
  const n=[['натальному Солнцу',natal.sun],['натальной Луне',natal.moon]];
  const aspects=[{a:0,label:'соединение',meaning:'выделение соответствующей темы'},{a:60,label:'секстиль',meaning:'тема взаимодействия и согласования'},{a:90,label:'квадрат',meaning:'тема напряжения и пересмотра'},{a:120,label:'трин',meaning:'тема согласованности и развития'},{a:180,label:'оппозиция',meaning:'тема противоположностей и баланса'}];
  const found=[];
  for(const [planet,lon,orb] of t)for(const [target,nlon] of n){
    const sep=Math.abs(delta(lon,nlon));
    for(const aspect of aspects){
      const diff=Math.abs(sep-aspect.a);
      if(diff<=orb)found.push({
        title:planet+' · '+aspect.label+' к '+target,
        orb:Math.round(diff*10)/10,
        explanation:'Традиционная интерпретация: '+aspect.meaning+'. Это символическое соответствие, а не доказанный прогноз.'
      });
    }
  }
  return found.sort((a,b)=>a.orb-b.orb).slice(0,4);
}
export function buildAstroPlanner(month,tz,rich,profile={}){
  new Intl.DateTimeFormat('en',{timeZone:tz});
  const natal=personalNatal(profile);
  const days=rich.days.map(day=>{
    const start=localToUtc(day.date,0,tz),middle=localToUtc(day.date,12,tz);
    const next=new Date(Date.UTC(+day.date.slice(0,4),+day.date.slice(5,7)-1,+day.date.slice(8)+1)).toISOString().slice(0,10);
    const end=localToUtc(next,0,tz);
    const phase=Astro.MoonPhase(middle),index=signIndex(moonLongitude(middle));
    const mercuryStart=mercuryLongitude(new Date(middle.getTime()-86400000));
    const mercuryEnd=mercuryLongitude(new Date(middle.getTime()+86400000));
    const retro=delta(mercuryStart,mercuryEnd)<0;
    const illumination=Math.round((1-Math.cos(phase*Math.PI/180))*50);
    const ingress=moonIngress(start,end,tz);
    const moonElement=ELEMENT[index];
    const categories=CAT.map(cfg=>dayCategory(cfg,day,moonElement,retro,phase));
    const good=categories.filter(c=>c.level==='good').map(c=>c.name);
    const cautions=categories.filter(c=>c.level==='caution').map(c=>c.name);
    const overall=good.length>cautions.length?'good':cautions.length>good.length?'caution':'neutral';
    const phaseName=moonPhaseName(phase);
    const events=[];
    if(ingress)events.push(ingress);
    if(phase<12||phase>348)events.push({title:'Около новолуния',kind:'moon-phase',explanation:'Низкая освещённость Луны; точное новолуние выделяется в календаре событий.'});
    if(phase>168&&phase<192)events.push({title:'Около полнолуния',kind:'moon-phase',explanation:'Высокая освещённость Луны; это астрономический показатель, не прогноз поведения.'});
    if(retro)events.push({title:'Ретроградное видимое движение Меркурия',kind:'mercury',explanation:'Геоцентрическая долгота Меркурия уменьшается; влияния на результаты решений наукой не установлено.'});
    const top=categories.find(c=>c.level==='good')||categories.find(c=>c.level==='neutral')||categories[0];
    return {
      date:day.date,overall,personalAspects:personalAspects(middle,natal),
      headline:good.length?'Акцент: '+good.slice(0,2).join(' и '):cautions.length?'Больше осторожности: '+cautions.slice(0,2).join(' и '):'День без выраженного традиционного акцента',
      summary:'Основное направление: '+top.name.toLowerCase()+'. Рекомендации исходят из символических систем и не гарантируют результат.',
      moon:{sign:SIGNS[index],element:moonElement,phase:phaseName,phaseAngle:Math.round(phase),illumination},
      sun:{sign:SIGNS[signIndex(Astro.SunPosition(middle).elon)]},
      mercury:{retrograde:retro},traditional:{yi:(day.almanac?.yiRu||[]).slice(0,36),ji:(day.almanac?.jiRu||[]).slice(0,36)},
      events,categories,
      drivers:[{title:'Луна в '+SIGNS[index],why:SIGN_TRAITS[moonElement],kind:'symbolic'},{title:phaseName+' · освещённость '+illumination+'%',why:'Положение и освещённость Луны рассчитаны астрономически; трактовка фаз традиционная.',kind:'astronomy'}]
    };
  });
  return {version:2,month,timeZone:tz,natal:natal?{sunSign:natal.sunSign,moonSign:natal.moonSign}:null,days,method:'Astronomy Engine (тропический зодиак), lunar-javascript (Хуанли). Время переходов в часовом поясе профиля.',warning:'Астрологические рекомендации являются культурной интерпретацией. Они не доказаны как способ прогнозировать успех решений; вопросы здоровья, финансов и безопасности решаются по фактическим данным.'};
}
