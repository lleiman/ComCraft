/* Cosmic Orbit: computed ephemerides and decorative animated filaments. */
(()=>{
"use strict";
const SIGNS=["♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓"],NAMES=["Овен","Телец","Близнецы","Рак","Лев","Дева","Весы","Скорпион","Стрелец","Козерог","Водолей","Рыбы"];
const S={root:null,key:"",data:null,canvas:null,ctx:null,w:0,h:0,frame:0,last:0,playing:!matchMedia("(prefers-reduced-motion: reduce)").matches,hour:12,focus:"Moon",chosen:null,visible:true,nodes:[],error:null};
let observer=null;
const E=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const F=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):"—";
const norm=n=>(n%360+360)%360,delta=(a,b)=>((b-a+540)%360)-180;
const planet=id=>S.data?.planets.find(x=>x.id===id);
function positions(){
 const data=S.data;if(!data)return {};
 const t=Math.min(24,Math.max(0,S.hour)),frames=data.frames;
 const i=Math.min(frames.length-2,Math.floor(t/4)),a=frames[i],b=frames[i+1],f=(t-a.hour)/(b.hour-a.hour),out={};
 for(const p of data.planets){const x=a.positions[p.id],y=b.positions[p.id];out[p.id]=Number.isFinite(x)&&Number.isFinite(y)?norm(x+delta(x,y)*f):p.longitude;}
 return out;
}
function html(){
 const d=S.data,a=d.aspects,p=d.planets,tense=a.filter(x=>x.tense).length;
 const metric=(label,val)=>'<div><span>'+label+'</span><strong>'+E(val)+'</strong></div>';
 return '<header class="orbit-header"><div><span class="orbit-kicker">IT’S YOUR TIME NOW</span><small>LIVE COSMIC PLANNER / АСТРОНОМИЧЕСКАЯ КАРТА</small></div><div class="orbit-heading-links"><a href="#v5-forecast">ПРОГНОЗ ↘</a><span>● ЭФЕМЕРИДЫ</span></div></header>'+
 '<div class="orbit-metrics">'+metric("ДАТА",d.date)+metric("ЛУНА",d.moon.phase+" · "+d.moon.illumination+"%")+metric("АСПЕКТЫ",a.length+" / "+tense+" напряжённых")+metric("ПЛАНЕТЫ",p.length+" рассчитано")+'</div>'+
 '<div class="orbit-stage"><canvas class="orbit-canvas" tabindex="0" aria-label="Карта долгот планет. Нажмите на планету или выберите её в списке ниже."></canvas><div class="orbit-corner left">LONGITUDE / TROPICAL<br>'+E(d.timezone)+'</div><div class="orbit-corner right">DATA / astronomy-engine<br>GEOCENTRIC ECLIPTIC</div><div class="orbit-floating" data-orbit-floating></div></div>'+
 '<div class="orbit-legend" aria-label="Обозначения на карте"><span><i class="orbit-legend-dot"></i> ТОЧКИ · ПЛАНЕТЫ</span><span><i class="orbit-legend-line"></i> СВЕТЛЫЕ · СОЕДИНЕНИЯ / СЕКСТИЛИ / ТРИНЫ</span><span><i class="orbit-legend-line alert"></i> ОРАНЖЕВЫЕ · КВАДРАТЫ / ОППОЗИЦИИ</span></div>'+
 '<div class="orbit-controls"><div class="orbit-control-line"><button type="button" data-orbit-play aria-label="Анимация">'+(S.playing?"Ⅱ":"▷")+'</button><b>ПРОКРУТКА 24 ЧАСОВ</b><output data-orbit-clock>12:00</output></div><input type="range" data-orbit-time min="0" max="24" step="0.1" value="'+S.hour+'" aria-label="Час выбранного дня"><div class="orbit-time-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div><p>Планеты следуют рассчитанным долготам. Частицы, лучи и световые следы декоративные и не являются дополнительными событиями.</p></div>'+
 '<div class="orbit-cards"><section class="orbit-card"><h3>01 / ДВИЖЕНИЕ ПЛАНЕТ <small>24 ЧАСА</small></h3><svg data-orbit-graph role="img" aria-label="Смещение планет за сутки" viewBox="0 0 360 83"></svg><div data-orbit-planets class="orbit-planet-list"></div></section>'+
 '<section class="orbit-card"><h3>02 / СОЕДИНЕНИЯ И АСПЕКТЫ <small>'+a.length+'</small></h3><div data-orbit-aspects class="orbit-aspect-list"></div></section>'+
 '<section class="orbit-card"><h3>03 / ВЫБРАННАЯ ПЛАНЕТА <small data-orbit-focus>LONGITUDE</small></h3><div data-orbit-info></div></section></div>'+
 '<footer class="orbit-footer"><span>astronomy-engine · истинные расчётные координаты</span><span>аспекты = геометрия, не вероятность успеха</span></footer>';
}
function show(){
 const root=S.root;if(!root?.isConnected)return;
 if(!S.data){root.innerHTML='<div class="orbit-loading">'+(S.error?'<strong>Ошибка эфемерид: '+E(S.error)+'</strong><button data-orbit-retry>Повторить</button>':'<span class="orbit-loader"></span><span>СОСТАВЛЯЕМ КАРТУ ПЛАНЕТ И АСПЕКТОВ…</span>')+'</div>';const b=root.querySelector("[data-orbit-retry]");if(b)b.onclick=()=>{S.error=null;fetchData(S.key,true)};return;}
 root.innerHTML=html();S.canvas=root.querySelector("canvas");S.ctx=S.canvas.getContext("2d",{alpha:false});
 root.querySelector("[data-orbit-play]").onclick=e=>{S.playing=!S.playing;e.currentTarget.textContent=S.playing?"Ⅱ":"▷";if(S.playing)start();};
 root.querySelector("[data-orbit-time]").oninput=e=>{S.hour=Number(e.target.value);S.playing=false;root.querySelector("[data-orbit-play]").textContent="▷";const out=root.querySelector("[data-orbit-clock]");if(out)out.textContent=clock();update();draw(performance.now());};
 root.querySelector("[data-orbit-planets]").onclick=e=>{const b=e.target.closest("[data-orbit-planet]");if(b)focus(b.dataset.orbitPlanet)};
 root.querySelector("[data-orbit-aspects]").onclick=e=>{const b=e.target.closest("[data-orbit-aspect]");if(b){const x=S.data.aspects[+b.dataset.orbitAspect];if(x){S.chosen=x;S.focus=x.a;update();draw(performance.now());}}};
 S.canvas.onclick=e=>{const box=S.canvas.getBoundingClientRect(),x=e.clientX-box.left-S.w/2,y=e.clientY-box.top-S.h/2;let chosen=null,min=1e9;for(const p of S.nodes){const dist=Math.hypot(p.x-x,p.y-y);if(dist<min){chosen=p;min=dist;}}if(chosen&&min<32)focus(chosen.id);};
 S.canvas.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();const next=S.data.planets[(S.data.planets.findIndex(p=>p.id===S.focus)+1)%S.data.planets.length];focus(next.id)}};
 update();resize();
 observer?.disconnect();
 observer=new IntersectionObserver(entries=>{S.visible=entries.some(e=>e.isIntersecting);if(S.visible)start();else stop();},{threshold:.02});observer.observe(root);
 start();
}
function focus(id){S.focus=id;S.chosen=null;update();draw(performance.now());}
function clock(){const h=Math.floor(S.hour),m=Math.floor((S.hour-h)*60);return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0");}
function update(){
 if(!S.root?.isConnected||!S.data)return;
 const pos=positions(),data=S.data;
 const list=S.root.querySelector("[data-orbit-planets]");
 list.innerHTML=data.planets.map(p=>'<button type="button" data-orbit-planet="'+p.id+'" aria-pressed="'+(S.focus===p.id)+'"><b>'+E(p.glyph)+' '+E(p.label)+'</b><span>'+F(pos[p.id])+'°</span><small>'+(p.speed24==null?"—":(p.speed24>0?"+":"")+F(p.speed24))+'°/д</small></button>').join("");
 const aspects=S.root.querySelector("[data-orbit-aspects]");
 aspects.innerHTML=data.aspects.length?data.aspects.slice(0,15).map((a,i)=>{
 const p=planet(a.a),q=planet(a.b);
 return '<button type="button" data-orbit-aspect="'+i+'" class="'+(a.tense?"tense":"")+'" aria-pressed="'+(S.chosen===a)+'"><span>'+E(p?.glyph||"")+" "+E(a.glyph)+" "+E(q?.glyph||"")+'</span><b>'+E(p?.label||a.a)+' / '+E(a.name)+' / '+E(q?.label||a.b)+'</b><small>орбис '+F(a.orb)+'°</small></button>';
 }).join(""):'<p>В установленном орбисе аспектов не найдено. Линии не добавляются искусственно.</p>';
 const focusP=planet(S.focus)||data.planets[0],lon=pos[focusP.id],sign=Math.floor(norm(lon)/30),degree=Math.floor(norm(lon)%30),minute=Math.floor((norm(lon)%1)*60);
 S.root.querySelector("[data-orbit-focus]").textContent=E(focusP.label.toUpperCase());
 S.root.querySelector("[data-orbit-info]").innerHTML='<div class="orbit-selected"><span>'+E(focusP.glyph)+'</span><strong>'+E(focusP.label)+'</strong></div><dl>'+
 '<div><dt>ЗНАК</dt><dd>'+E(NAMES[sign])+' · '+degree+'° '+String(minute).padStart(2,"0")+'′</dd></div>'+
 '<div><dt>ДОЛГОТА</dt><dd>'+F(lon,3)+'°</dd></div>'+
 '<div><dt>ДВИЖЕНИЕ ЗА СУТКИ</dt><dd>'+(focusP.speed24==null?"—":(focusP.speed24>0?"+":"")+F(focusP.speed24,3)+"°")+'</dd></div>'+
 '<div><dt>НАПРАВЛЕНИЕ</dt><dd>'+(focusP.retrograde?"Ретроградное":"Прямое")+'</dd></div>'+
 '<div><dt>АСПЕКТЫ НА ПОЛДЕНЬ</dt><dd>'+data.aspects.filter(a=>a.a===focusP.id||a.b===focusP.id).length+'</dd></div></dl>';
 S.root.querySelector("[data-orbit-floating]").innerHTML='<strong>'+E(focusP.label)+' '+E(focusP.glyph)+'</strong><span>'+F(lon)+'° / '+E(NAMES[sign])+'</span>';
 const graph=S.root.querySelector("[data-orbit-graph]");
 const hues=["#dce5e0","#7d9389","#e5cbb7","#fb704d"];
 graph.innerHTML='<path d="M0 20H360 M0 42H360 M0 64H360" stroke="#26332e" stroke-width=".7"/>'+
 ["Moon","Mercury","Venus","Mars"].map((id,k)=>{
 const arr=data.frames.map(f=>f.positions[id]);if(arr.some(v=>!Number.isFinite(v)))return "";
 const dif=arr.map(v=>delta(arr[0],v)),min=Math.min(...dif),max=Math.max(...dif),range=Math.max(.001,max-min);
 const pts=dif.map((v,i)=>(i*360/(arr.length-1)).toFixed(1)+","+(72-(v-min)/range*58).toFixed(1)).join(" ");
 return '<polyline points="'+pts+'" fill="none" stroke="'+hues[k]+'" stroke-width="'+(S.focus===id?2.2:1.2)+'" opacity=".86"/>';
 }).join("");
}
function resize(){
 const c=S.canvas;if(!c?.isConnected)return;const r=c.getBoundingClientRect();if(!r.width||!r.height)return;
 const dpr=Math.min(devicePixelRatio||1,2),w=Math.round(r.width*dpr),h=Math.round(r.height*dpr);
 if(c.width!==w||c.height!==h){c.width=w;c.height=h;S.w=r.width;S.h=r.height;S.ctx.setTransform(dpr,0,0,dpr,0,0);}draw(performance.now());
}
function draw(now){
 if(!S.ctx||!S.canvas?.isConnected||!S.data||!S.w||!S.h)return;
 const ctx=S.ctx,w=S.w,h=S.h,cx=w/2,cy=h/2,r=Math.min(w*.41,h*.398),t=now*.001;
 ctx.fillStyle="#030504";ctx.fillRect(0,0,w,h);ctx.save();ctx.translate(cx,cy);
 const bg=ctx.createRadialGradient(0,0,0,0,0,r*1.5);bg.addColorStop(0,"#19221d");bg.addColorStop(.65,"#08100c");bg.addColorStop(1,"#030504");
 ctx.fillStyle=bg;ctx.fillRect(-w/2,-h/2,w,h);
 // These filaments are a visual metaphor, not additional orbital events.
 for(let i=0;i<250;i++){
  const a=((i*137.507764)%360-90)*Math.PI/180,inner=r*(.55+(i*7%31)/140),outer=r*(1.05+(i*11%39)/31);
  const hot=i%44===0;
  ctx.strokeStyle=hot?"rgba(245,106,69,.22)":"rgba(198,216,205,.06)";ctx.lineWidth=i%23===0?1:.48;
  ctx.beginPath();ctx.moveTo(Math.cos(a)*inner,Math.sin(a)*inner);ctx.lineTo(Math.cos(a+.002*Math.sin(t*.2+i))*outer,Math.sin(a+.002*Math.sin(t*.2+i))*outer);ctx.stroke();
 }
 for(const scale of [.24,.47,.7,.88,1,1.06]){
  ctx.strokeStyle=scale===1?"rgba(232,242,232,.56)":"rgba(195,211,200,.21)";ctx.lineWidth=scale===1?1.25:.7;
  ctx.beginPath();ctx.arc(0,0,r*scale,0,Math.PI*2);ctx.stroke();
 }
 for(let d=0;d<360;d++){
  const a=(d-90)*Math.PI/180,major=d%30===0,medium=d%5===0;
  ctx.strokeStyle=major?"rgba(241,247,237,.7)":"rgba(201,221,206,.25)";
  ctx.lineWidth=major?1.1:.6;ctx.beginPath();ctx.moveTo(Math.cos(a)*r*(major?.89:.976),Math.sin(a)*r*(major?.89:.976));
  ctx.lineTo(Math.cos(a)*r*(major?1.063:medium?1.03:1.015),Math.sin(a)*r*(major?1.063:medium?1.03:1.015));ctx.stroke();
 }
 ctx.font=Math.max(12,Math.min(21,w*.022))+"px serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillStyle="#e2eae5";
 SIGNS.forEach((s,i)=>{const a=(i*30+15-90)*Math.PI/180;ctx.fillText(s,Math.cos(a)*r*1.11,Math.sin(a)*r*1.11)});
 const positionsNow=positions(),planetary=S.data.planets;
 const point=(p,i)=>{const a=(positionsNow[p.id]-90)*Math.PI/180,rr=r*(.58+(i*3%5)*.066);return {id:p.id,x:Math.cos(a)*rr,y:Math.sin(a)*rr};};
 S.nodes=planetary.map(point);
 const byId=Object.fromEntries(S.nodes.map(n=>[n.id,n]));
 for(const [i,a] of S.data.aspects.entries()){
  const p=byId[a.a],q=byId[a.b];if(!p||!q)continue;
  const on=S.chosen===a||S.focus===a.a||S.focus===a.b;
  ctx.strokeStyle=a.tense?(on?"rgba(255,112,76,.99)":"rgba(255,105,69,.36)"):(on?"rgba(233,239,229,.83)":"rgba(224,233,226,.18)");
  ctx.lineWidth=on?2:a.tense?1:.68;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
  if(on&&S.playing){const phase=(t*.23+i*.17)%1;ctx.fillStyle=a.tense?"#ff815a":"#e6eeea";ctx.beginPath();ctx.arc(p.x+(q.x-p.x)*phase,p.y+(q.y-p.y)*phase,2.1,0,Math.PI*2);ctx.fill();}
 }
 S.nodes.forEach((n,i)=>{
  const p=planetary[i],selected=S.focus===p.id,hot=selected||p.id==="Mars",rad=selected?28:19;
  const glow=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,rad);
  glow.addColorStop(0,hot?"rgba(255,101,63,.44)":"rgba(233,248,237,.34)");glow.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=glow;ctx.beginPath();ctx.arc(n.x,n.y,rad,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#0a120d";ctx.strokeStyle=hot?"#ff8662":"#adbdaf";ctx.lineWidth=selected?2:1;
  ctx.beginPath();ctx.arc(n.x,n.y,selected?12:9.2,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.font=(selected?18:14)+"px serif";ctx.fillStyle=hot?"#ffbb9b":"#eef5ef";ctx.fillText(p.glyph,n.x,n.y+.5);
 });
 ctx.font="10px ui-monospace,monospace";ctx.fillStyle="#aabeb0";ctx.fillText("ECLIPTIC",0,-8);
 ctx.fillStyle="#758d7c";ctx.fillText("REAL POSITIONS",0,9);
 ctx.restore();
}
function start(){
 if(S.frame||!S.canvas?.isConnected||!S.visible||document.hidden)return;
 const loop=t=>{
  S.frame=0;if(!S.canvas?.isConnected||!S.visible||document.hidden)return;
  const dt=Math.max(0,Math.min(170,t-S.last));if(dt<32){S.frame=requestAnimationFrame(loop);return}S.last=t;
  if(S.playing){
    S.hour=(S.hour+dt/1500)%24;
    const input=S.root.querySelector("[data-orbit-time]"),output=S.root.querySelector("[data-orbit-clock]");
    if(input)input.value=S.hour;if(output)output.textContent=clock();
  }
  draw(t);S.frame=requestAnimationFrame(loop);
 };
 S.frame=requestAnimationFrame(loop);
}
function stop(){if(S.frame){cancelAnimationFrame(S.frame);S.frame=0;}}
const cache=new Map();
async function fetchData(key,force=false){
 S.data=null;show();const [date,tz]=key.split("|");
 try{
  let val=!force&&cache.get(key);
  if(!val){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),16000);
   try{const r=await fetch("/api/orbit?date="+encodeURIComponent(date)+"&tz="+encodeURIComponent(tz),{signal:controller.signal});
    val=await r.json();if(!r.ok||!Array.isArray(val.planets)||!Array.isArray(val.frames))throw Error(val.error||"Некорректный ответ расчёта");
    cache.set(key,val);if(cache.size>16)cache.delete(cache.keys().next().value);
   }finally{clearTimeout(timer);}
  }
  if(S.key!==key)return;S.data=val;S.error=null;S.focus=val.planets.some(p=>p.id===S.focus)?S.focus:(val.planets[0]?.id||"");show();
 }catch(e){if(S.key!==key)return;S.error=String(e.message||e);show();}
}
function mount(profile){
 const root=document.getElementById("cosmic-orbit");if(!root){stop();observer?.disconnect();S.root=null;return}
 document.body.classList.add("cosmic-mode");
 const key=(profile?.selected||new Date().toISOString().slice(0,10))+"|"+(profile?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC");
 if(S.root===root&&S.key===key){if(S.data&&!S.canvas?.isConnected)show();return}
 stop();observer?.disconnect();S.root=root;S.key=key;S.data=null;S.error=null;S.canvas=null;S.ctx=null;S.hour=12;S.last=0;fetchData(key);
}
addEventListener("resize",()=>{if(S.canvas?.isConnected)resize()},{passive:true});
document.addEventListener("visibilitychange",()=>{if(document.hidden)stop();else{S.last=0;start()}});
window.IYTN_COSMIC={mount,stop,getTelemetry:()=>S.data,enabled:()=>!!S.root?.isConnected};
})();
