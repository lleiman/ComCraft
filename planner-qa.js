/* Public browser acceptance test: enabled ONLY by ?qa=1 on the test session.
   Tests never delete/change the user's archive, goals, or account credentials. */
(() => {
  if(new URLSearchParams(location.search).get("qa")!=="1")return;
  const key="iytn_public_qa_v2";
  const report=document.createElement("section");
  report.id="iytn-browser-audit";
  report.setAttribute("role","status");
  report.style.cssText="position:relative;z-index:12000;max-width:1060px;margin:12px auto;padding:18px 22px;background:#122319;color:#d7f1ca;border:2px solid #b8dba0;border-radius:14px;box-shadow:0 12px 36px #0004;font:14px/1.6 ui-monospace,monospace";
  report.innerHTML='<h2 style="margin:0 0 8px;font:700 21px/1.4 sans-serif">Сквозная проверка интерфейса · только чтение</h2><pre id="iytn-browser-audit-result" style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0">Запускаем проверки…</pre>';
  document.body.prepend(report);
  const output=report.querySelector("pre");
  const results=[],errors=[];
  function record(name,ok,detail=""){results.push({name,ok:!!ok,...(detail?{detail}: {})});draw(false)}
  function draw(done){output.textContent=JSON.stringify({done,passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,total:results.length,tests:results,errors},null,2)}
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function waitFor(fn,max=12000){const t=Date.now();while(Date.now()-t<max){try{if(fn())return true}catch{}await sleep(160)}return false}
  const storeFingerprint=()=>{const raw=localStorage.getItem("iytn_psych_snapshot_v1")||"";let h=2166136261;for(let i=0;i<raw.length;i++)h=Math.imul(h^raw.charCodeAt(i),16777619)>>>0;return String(raw.length)+"/"+String(h)};
  window.addEventListener("error",e=>errors.push("browser: "+String(e.message||"unknown")));
  window.addEventListener("unhandledrejection",e=>errors.push("promise: "+String(e.reason||"unknown")));
  const prev=sessionStorage.getItem(key);
  if(prev){
    sessionStorage.removeItem(key);
    try{const recordSaved=JSON.parse(prev);recordSaved.tests.forEach(x=>results.push(x));
      record("reload_preserves_archive_exactly",storeFingerprint()===recordSaved.archive,"sensitive contents are not reported");
      record("reload_restores_calendar",!!document.getElementById("view"));
    }catch(e){errors.push("reload: "+String(e))}
    draw(true);return;
  }
  (async()=>{
    try{
      record("calendar_loaded",await waitFor(()=>document.querySelector("#v5-forecast .v7-story")));
      const workspace=document.getElementById("v10-workspace"),toggle=workspace?.querySelector("[data-v10-rail-toggle]");
      record("reduced_calendar_rail",!!workspace&&!!toggle&&!!workspace.querySelector(".v10-main #cosmic-orbit")&&!!workspace.querySelector(".v10-calendar-rail #calendar-grid"));
      const originalClosed=workspace?.classList.contains("v10-calendar-closed");
      if(toggle){
       toggle.click();
       record("calendar_collapse_toggle",workspace.classList.contains("v10-calendar-closed")!==originalClosed);
       record("forecast_remains_visible_when_collapsed",!!workspace.querySelector(".v10-main #v5-forecast"));
       toggle.click();
       record("calendar_reopens_to_previous_state",workspace.classList.contains("v10-calendar-closed")===originalClosed);
       record("calendar_toggle_aria",toggle.getAttribute("aria-expanded")===String(!originalClosed));
      }
      record("global_menu_collapse",!!document.querySelector("[data-v10-primary-toggle]"));
      record("supplementary_calendars_behind_disclosure",!!document.querySelector(".v10-deep-systems #astro-day")&&!!document.querySelector(".v10-deep-systems #iytn-google-calendar"));
      record("orbit_ephemeris_loads",await waitFor(()=>window.IYTN_COSMIC?.getTelemetry()?.planets?.length>=9,16000));
      const scene=document.querySelector("#cosmic-orbit canvas"),telemetry=window.IYTN_COSMIC?.getTelemetry();
      record("orbit_canvas_visible",!!scene&&scene.width>300&&scene.height>200);
      record("orbit_actual_aspects",!!telemetry&&telemetry.aspects.every(a=>a.orb>=0&&a.orb<=5.5));
      record("orbit_real_geocentric_positions",!!telemetry&&telemetry.planets.length>=9&&telemetry.planets.every(p=>p.longitude>=0&&p.longitude<360));
      const scrub=document.querySelector("#cosmic-orbit [data-orbit-time]");
      if(scrub){scrub.value="18";scrub.dispatchEvent(new Event("input",{bubbles:true}));}
      record("orbit_time_scrubber",document.querySelector("#cosmic-orbit [data-orbit-clock]")?.textContent?.startsWith("18:"));
      const selectable=document.querySelector("#cosmic-orbit [data-orbit-planet='Mars']");
      if(selectable)selectable.click();
      record("orbit_planet_select",!!document.querySelector("#cosmic-orbit [data-orbit-planet='Mars'][aria-pressed='true']"));

      record("day_story_has_specific_symbolism",!!document.querySelector("#v5-forecast .v9-meanings"));
      record("six_recommendation_domains",document.querySelectorAll("#v5-forecast .v7-domain").length===6);
      record("huangli_section_visible",!!document.querySelector("#v5-forecast .v7-almanac"));
      record("huangli_russian_without_hanzi",!/[㐀-鿿]/u.test(document.querySelector("#v5-forecast .v7-almanac")?.textContent||""));
      record("timezone_control",!!document.querySelector("#v5-forecast [data-v9-zone]"));
      const tibetan=await waitFor(()=>[...document.querySelectorAll("#v5-forecast .v7-system")].some(x=>/Тибетский календарь/i.test(x.textContent)),15000);
      record("tibetan_interpretation_loads",tibetan);
      if(tibetan&&document.querySelector("#v5-forecast .v7-head")?.textContent?.includes("16 ноября")){
        record("tibetan_nov16_electional_specific",/молитвенн.*флаг/u.test([...document.querySelectorAll("#v5-forecast .v7-system")].find(x=>/Тибетский календарь/i.test(x.textContent))?.textContent||""));
      }
      const startTitle=document.querySelector("#v5-forecast .v7-head h2")?.textContent||"";
      document.querySelector("#v5-forecast [data-v7-shift='1']")?.click();
      record("next_date_renders",await waitFor(()=>{const title=document.querySelector("#v5-forecast .v7-head h2")?.textContent||"";return title&&title!==startTitle},6000));
      const expectedOrbitDate=window.IYTN_COSMIC?.getTelemetry()?.date;
      record("orbit_refreshes_on_date",await waitFor(()=>{const x=window.IYTN_COSMIC?.getTelemetry();return x&&x.date&&x.date!==telemetry?.date;},10000),"new date="+expectedOrbitDate);
      document.querySelector("#v5-forecast [data-v7-shift='-1']")?.click();
      record("previous_date_restores",await waitFor(()=>document.querySelector("#v5-forecast .v7-head h2")?.textContent===startTitle,6000));
      const beforePeriod=localStorage.getItem("iytn_forecast_horizon_v1");
      for(const [id,textName] of [["week","Неделя"],["month","Месяц"],["day","Разбор"]]){
        const button=document.querySelector("#v5-forecast [data-v5-horizon='"+id+"']");
        if(button)button.click();
        const target=await waitFor(()=>{
          const selected=document.querySelector("#v5-forecast [data-v5-horizon='"+id+"'][aria-pressed='true']");
          const title=document.querySelector("#v5-forecast h2")?.textContent||"";
          return !!selected&&(id==="day"?!!document.querySelector("#v5-forecast .v7-story"):title.includes(textName));
        },6000);
        record("switch_period_"+id,target,"button="+!!button);
      }
      if(beforePeriod===null)localStorage.removeItem("iytn_forecast_horizon_v1");
      else localStorage.setItem("iytn_forecast_horizon_v1",beforePeriod);
      try{
        const response=await fetch("/api/self-test",{cache:"no-store"}),value=await response.json();
        record("server_all_regressions",response.ok&&value.ok,"checks="+(value.tests||[]).length);
        for(const test of value.tests||[])if(!test.ok)errors.push("server "+test.name+(test.error?" "+test.error:""));
      }catch(e){record("server_all_regressions",false);errors.push("self-test "+String(e))}
      try{
        const response=await fetch("/api/day-systems?date=2026-11-16&time=12:00",{cache:"no-store"}),value=await response.json();
        record("tibetan_date_and_activity",response.ok&&value.tibetan?.month===10&&value.tibetan?.day===7&&!!value.tibetan?.electional?.indications?.length);
        record("qimen_chart_live",response.ok&&!!value.qimen?.chiefDoor);
      }catch(e){record("day_systems",false);errors.push(String(e))}
      const archive=storeFingerprint();
      sessionStorage.setItem(key,JSON.stringify({tests:results,archive}));
      draw(false);
      location.reload();
    }catch(e){errors.push("fatal "+String(e.stack||e));draw(true)}
  })();
})();
