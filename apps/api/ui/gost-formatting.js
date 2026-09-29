{
  const gostUi={files:[],profile:"gost-r-7.0.97-2025",settings:null,profiles:[],loading:false,job:null,pollTimer:null,spaceId:"",revision:0};
  function gostEscape(value){return String(value??"").replace(/[&<>'"]/gu,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c])}
  function gostSpaceId(){return String(globalThis.docomatorCurrentSpaceId||"").trim()}
  function gostCorrelationId(){return globalThis.crypto?.randomUUID?.()||`gost-${Date.now()}`}
  function gostErrorMessage(error){return error instanceof Error?error.message:String(error)}
  async function gostJson(url,options={}){const response=await fetch(url,{...options,headers:{accept:"application/json","x-correlation-id":gostCorrelationId(),"x-actor-id":"local-ui",...(options.headers||{})}});const type=response.headers.get("content-type")||"";const body=type.includes("application/json")?await response.json():null;if(!response.ok){const error=new Error(body?.error?.message||`Сервер вернул код ${response.status}.`);error.code=body?.error?.code||"request_failed";throw error}return body?.data}
  function gostProfile(){return gostUi.profiles.find((item)=>item.id===gostUi.profile)||null}
  function gostCurrentSettings(){const root=document.querySelector("#gostFormattingWorkspace"),base=gostUi.settings||gostProfile()?.settings;if(!root||!base)return base;const number=(name,fallback)=>{const value=Number(root.querySelector(`[name="${name}"]`)?.value);return Number.isFinite(value)?value:fallback};return{profile:gostUi.profile,fontFamily:root.querySelector('[name="fontFamily"]')?.value?.trim()||base.fontFamily,fontSizePt:number("fontSizePt",base.fontSizePt),lineSpacing:number("lineSpacing",base.lineSpacing),firstLineIndentMm:number("firstLineIndentMm",base.firstLineIndentMm),marginsMm:{top:number("marginTop",base.marginsMm.top),right:number("marginRight",base.marginsMm.right),bottom:number("marginBottom",base.marginsMm.bottom),left:number("marginLeft",base.marginsMm.left)},bodyAlignment:root.querySelector('[name="bodyAlignment"]')?.value==="left"?"left":"both"}}
  function gostStatus(text,kind=""){const node=document.querySelector("#gostStatus");if(!node)return;node.className=`product-status${kind?` is-${kind}`:""}`;node.textContent=text;node.hidden=!text}
  function gostFileState(file){return{id:globalThis.crypto?.randomUUID?.()||`file-${Date.now()}-${Math.random()}`,file,sourceRecordId:"",analysis:null,state:"new",error:""}}
  function gostFileSummary(item){if(item.state==="uploading")return"Проверяем структуру и сохраняем исходник…";if(item.state==="ready"){const findings=item.analysis?.findings||[];return findings.length?`${findings.length} замечаний — настройки можно применить`:"Соответствует выбранным базовым настройкам"}if(item.state==="error")return item.error||"Файл не прошёл проверку";return"Готов к анализу"}
  function gostRenderFiles(){const root=document.querySelector("#gostFileList");if(!root)return;root.innerHTML=gostUi.files.length?gostUi.files.map((item)=>`<div class="product-file-row" data-gost-file="${gostEscape(item.id)}"><div><strong>${gostEscape(item.file.name)}</strong><small>${gostEscape(gostFileSummary(item))}</small></div><button class="quiet-button compact" type="button" data-gost-remove="${gostEscape(item.id)}">Убрать</button></div>`).join(""):'<div class="generation-history-empty">Добавьте один или несколько DOCX. Исходные файлы не перезаписываются.</div>';const run=document.querySelector("#gostRunButton");if(run)run.disabled=gostUi.loading||!gostUi.files.length||gostUi.files.some((item)=>item.state!=="ready")}
  function gostRenderResults(){const root=document.querySelector("#gostResults");if(!root)return;const job=gostUi.job;if(!job){root.innerHTML="";return}root.innerHTML=`<article class="gost-panel"><div class="panel-heading"><div><p class="eyebrow">Результат операции</p><h3>${job.state==="completed"?"Обработка завершена":"Форматируем документы"}</h3><p>Успешные файлы сохраняются отдельно; ошибка одного документа не удаляет остальные результаты.</p></div></div><div class="gost-results">${job.items.map((item)=>{const status=item.state==="completed"?"Готов":item.state==="failed"?"Ошибка":item.state==="running"?"Обрабатывается":"В очереди";const detail=item.error?.message||status;return `<div class="product-file-row"><div><strong>${gostEscape(item.fileName)}</strong><small>${gostEscape(detail)}</small></div>${item.state==="completed"?`<a class="secondary-button" href="/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-formatting/jobs/${encodeURIComponent(job.id)}/items/${encodeURIComponent(item.itemId)}/download">Скачать</a>`:""}</div>`}).join("")}</div><div class="gost-result-actions">${job.items.some((item)=>item.state==="failed")?'<button class="secondary-button" type="button" data-gost-action="retry">Повторить только ошибки</button>':""}</div></article>`}
  async function gostLoadProfiles(){if(gostUi.profiles.length)return;gostUi.profiles=await gostJson("/api/v1/document-formatting/profiles");const selected=gostProfile()||gostUi.profiles[0];if(selected){gostUi.profile=selected.id;gostUi.settings=structuredClone(selected.settings)}}
  function gostSettingsHtml(){const settings=gostUi.settings||gostProfile()?.settings;if(!settings)return"";return `<div class="product-grid"><label class="product-field"><span>Профиль</span><select name="profile">${gostUi.profiles.map((item)=>`<option value="${gostEscape(item.id)}"${item.id===gostUi.profile?" selected":""}>${gostEscape(item.label)}</option>`).join("")}</select><small>${gostEscape(gostProfile()?.scope||"")}</small></label><label class="product-field"><span>Шрифт</span><input name="fontFamily" value="${gostEscape(settings.fontFamily)}"><small>Редактируемая настройка организации.</small></label><label class="product-field"><span>Кегль, пт</span><input name="fontSizePt" type="number" min="8" max="32" step="0.5" value="${settings.fontSizePt}"></label><label class="product-field"><span>Межстрочный интервал</span><input name="lineSpacing" type="number" min="1" max="3" step="0.05" value="${settings.lineSpacing}"></label><label class="product-field"><span>Абзацный отступ, мм</span><input name="firstLineIndentMm" type="number" min="0" max="50" step="0.5" value="${settings.firstLineIndentMm}"></label><label class="product-field"><span>Выравнивание</span><select name="bodyAlignment"><option value="both"${settings.bodyAlignment==="both"?" selected":""}>По ширине</option><option value="left"${settings.bodyAlignment==="left"?" selected":""}>По левому краю</option></select></label>${["Top","Right","Bottom","Left"].map((side)=>{const ru={Top:"Сверху",Right:"Справа",Bottom:"Снизу",Left:"Слева"}[side],key=side.toLowerCase();return `<label class="product-field"><span>Поле ${ru}, мм</span><input name="margin${side}" type="number" min="5" max="70" step="0.5" value="${settings.marginsMm[key]}"></label>`}).join("")}</div><label class="product-check"><input id="gostLongStorage" type="checkbox"><span><strong>Документы длительного хранения</strong><br><small>Установить левое поле 30 мм. Остальные параметры можно скорректировать выше.</small></span></label>`}
  async function gostRender(){const context=globalThis.docomatorCaptureSpaceContext();const revision=gostUi.revision;const current=()=>context.isCurrent()&&revision===gostUi.revision;const root=document.querySelector("#gostFormattingWorkspace");if(!root)return;try{await gostLoadProfiles()}catch(error){if(!current())return;root.innerHTML=`<div class="product-status is-error"><strong>Настройки не загружены.</strong> ${gostEscape(gostErrorMessage(error))}</div>`;return}if(!current())return;root.innerHTML=`<div class="product-stack"><div class="section-intro"><div><p class="eyebrow">Готовый документ вместо ручной правки</p><h2>Форматирование по ГОСТ</h2><p>Загрузите DOCX или пакет документов, проверьте предложенные настройки и примените один профиль ко всему пакету.</p></div></div><article class="gost-panel"><label class="gost-drop" id="gostDrop"><input id="gostFiles" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple><strong>Перетащите DOCX сюда</strong><span>или нажмите, чтобы выбрать несколько файлов</span></label><div id="gostFileList" class="product-file-list"></div></article><article class="gost-panel"><div class="panel-heading"><div><p class="eyebrow">Единые настройки пакета</p><h3>Профиль и оформление</h3><p>Система меняет только явно выбранные базовые параметры. Таблицы, формулы, изображения, колонтитулы и неизвестные OOXML-части сохраняются.</p></div></div>${gostSettingsHtml()}<p class="gost-standard-note">ГОСТ Р 7.0.97-2025: стартовый профиль для организационно-распорядительных документов. ЕСКД: профиль ГОСТ Р 2.105-2019. Оформлятор не выдаёт документ за прошедший нормативную экспертизу и не угадывает смысл заголовков без подтверждения.</p><div class="gost-actions"><button id="gostAnalyzeButton" class="secondary-button" type="button">Повторить анализ</button><button id="gostRunButton" class="primary-button" type="button">Отформатировать пакет</button></div><div id="gostStatus" class="product-status" hidden></div></article><div id="gostResults"></div></div>`;gostBind();gostRenderFiles();gostRenderResults()}
  function gostAddFiles(files){for(const file of files){if(!file.name.toLocaleLowerCase("ru-RU").endsWith(".docx"))continue;if(!gostUi.files.some((item)=>item.file.name===file.name&&item.file.size===file.size&&item.file.lastModified===file.lastModified))gostUi.files.push(gostFileState(file))}gostRenderFiles();void gostPrepareFiles()}
  async function gostPrepareItem(item, context, revision) {
    const current = () => revision === gostUi.revision && context.isCurrent() && gostUi.files.includes(item);
    if (!current()) return;
    item.state = "uploading";
    item.error = "";
    gostRenderFiles();
    const settings = gostCurrentSettings();
    try {
      const analysis = await gostJson(`/api/v1/document-formatting/analyze?profile=${encodeURIComponent(settings.profile === "custom" ? "gost-r-7.0.97-2025" : settings.profile)}`, {
        method: "POST", body: item.file, headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
      });
      if (!current()) return;
      if (!context.spaceId) throw new Error("Сначала выберите пространство.");
      const source = await gostJson(context.endpoint(`/document-sources/quarantine?fileName=${encodeURIComponent(item.file.name)}`), {
        method: "POST", body: item.file, headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
      });
      if (!current()) return;
      item.analysis = analysis;
      item.sourceRecordId = source.id;
      item.state = "ready";
    } catch (error) {
      if (!current()) return;
      item.state = "error";
      item.error = `${gostErrorMessage(error)} Исходный файл не изменён; исправьте его или уберите из пакета.`;
    }
    if (current()) gostRenderFiles();
  }
  async function gostPrepareFiles() {
    if (gostUi.loading) return;
    const context = globalThis.docomatorCaptureSpaceContext();
    const revision = gostUi.revision;
    gostUi.loading = true;
    gostRenderFiles();
    try {
      for (const item of [...gostUi.files]) {
        if (!context.isCurrent() || revision !== gostUi.revision) return;
        if (item.state === "new" || item.state === "error") await gostPrepareItem(item, context, revision);
      }
    } finally {
      if (context.isCurrent() && revision === gostUi.revision) {
        gostUi.loading = false;
        gostRenderFiles();
      }
    }
  }
  async function gostReanalyze(){for(const item of gostUi.files){item.state="new";item.analysis=null;item.error=""}await gostPrepareFiles()}
  async function gostRun() {
    if (gostUi.loading) return;
    const context = globalThis.docomatorCaptureSpaceContext();
    const revision = gostUi.revision;
    if (!context.spaceId) { gostStatus("Сначала выберите пространство. Данные не изменены.", "error"); return; }
    const ready = gostUi.files.filter((item) => item.state === "ready" && item.sourceRecordId);
    if (!ready.length || ready.length !== gostUi.files.length) { gostStatus("Не все документы прошли проверку. Исправьте или уберите проблемные файлы; исходники не изменены.", "error"); return; }
    gostUi.loading = true;
    gostRenderFiles();
    gostStatus("Сохраняем задание. Исходные DOCX не перезаписываются.");
    try {
      const job = await gostJson(context.endpoint("/document-formatting/jobs"), {
        method: "POST", body: JSON.stringify({ sourceRecordIds: ready.map((item) => item.sourceRecordId), settings: gostCurrentSettings() }), headers: { "content-type": "application/json" }
      });
      if (!context.isCurrent() || revision !== gostUi.revision) return;
      gostUi.job = job;
      gostRenderResults();
      void gostPoll();
    } catch (error) {
      if (context.isCurrent() && revision === gostUi.revision) gostStatus(`${gostErrorMessage(error)} Сохранение задания не подтверждено; исходники не изменены.`, "error");
    } finally {
      if (context.isCurrent() && revision === gostUi.revision) { gostUi.loading = false; gostRenderFiles(); }
    }
  }
  async function gostPoll() {
    clearTimeout(gostUi.pollTimer);
    const job = gostUi.job;
    const context = globalThis.docomatorCaptureSpaceContext();
    const revision = gostUi.revision;
    if (!job || job.spaceId !== context.spaceId || state.view !== "gost-formatting") return;
    const current = () => context.isCurrent() && revision === gostUi.revision && gostUi.job?.id === job.id && state.view === "gost-formatting";
    try {
      const updated = await gostJson(context.endpoint(`/document-formatting/jobs/${encodeURIComponent(job.id)}`));
      if (!current()) return;
      gostUi.job = updated;
      gostRenderResults();
      if (["pending", "running", "retry"].includes(updated.state)) gostUi.pollTimer = setTimeout(() => void gostPoll(), 1000);
      else if (updated.items.some((item) => item.state === "failed")) gostStatus("Пакет завершён частично. Готовые файлы сохранены; можно повторить только ошибки.", "error");
      else gostStatus("Все документы обработаны. Скачайте готовые копии ниже.", "success");
    } catch (error) {
      if (current()) gostStatus(`${gostErrorMessage(error)} Задание не потеряно; откройте раздел повторно, чтобы проверить результат.`, "error");
    }
  }
  async function gostRetry() {
    if (gostUi.loading || !gostUi.job) return;
    const context = globalThis.docomatorCaptureSpaceContext();
    const job = gostUi.job;
    const revision = gostUi.revision;
    if (job.spaceId !== context.spaceId) return;
    gostUi.loading = true;
    try {
      const updated = await gostJson(context.endpoint(`/document-formatting/jobs/${encodeURIComponent(job.id)}/retry`), { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
      if (!context.isCurrent() || revision !== gostUi.revision) return;
      gostUi.job = updated;
      gostRenderResults();
      void gostPoll();
    } catch (error) {
      if (context.isCurrent() && revision === gostUi.revision) gostStatus(`${gostErrorMessage(error)} Уже готовые файлы не удалены.`, "error");
    } finally {
      if (context.isCurrent() && revision === gostUi.revision) { gostUi.loading = false; gostRenderFiles(); }
    }
  }
  function gostBind(){const input=document.querySelector("#gostFiles"),drop=document.querySelector("#gostDrop");input?.addEventListener("change",()=>gostAddFiles([...input.files]));drop?.addEventListener("dragover",(event)=>{event.preventDefault();drop.classList.add("is-dragover")});drop?.addEventListener("dragleave",()=>drop.classList.remove("is-dragover"));drop?.addEventListener("drop",(event)=>{event.preventDefault();drop.classList.remove("is-dragover");gostAddFiles([...event.dataTransfer.files])});document.querySelector("#gostAnalyzeButton")?.addEventListener("click",()=>void gostReanalyze());document.querySelector("#gostRunButton")?.addEventListener("click",()=>void gostRun());document.querySelector('[name="profile"]')?.addEventListener("change",(event)=>{gostUi.profile=event.target.value;gostUi.settings=structuredClone(gostProfile()?.settings||gostUi.settings);void gostRender()});document.querySelector("#gostLongStorage")?.addEventListener("change",(event)=>{const input=document.querySelector('[name="marginLeft"]');if(input)input.value=event.target.checked?"30":String(gostProfile()?.settings?.marginsMm?.left||20)});document.querySelector("#gostFileList")?.addEventListener("click",(event)=>{const button=event.target.closest("[data-gost-remove]");if(!button)return;gostUi.files=gostUi.files.filter((item)=>item.id!==button.dataset.gostRemove);gostRenderFiles()});document.querySelector("#gostResults")?.addEventListener("click",(event)=>{if(event.target.closest('[data-gost-action="retry"]'))void gostRetry()})}
  function gostInstallShell(){const main=document.querySelector("main.main");if(main&&!main.querySelector('[data-view="gost-formatting"]')){const section=document.createElement("section");section.className="view";section.dataset.view="gost-formatting";section.setAttribute("aria-labelledby","gost-formatting-heading");section.innerHTML='<h2 class="visually-hidden" id="gost-formatting-heading">Форматирование документов по ГОСТ и ЕСКД</h2><div id="gostFormattingWorkspace" aria-live="polite"></div>';main.append(section)}views["gost-formatting"]=["Оформление документов","Форматирование по ГОСТ","Анализируйте один DOCX или пакет и применяйте единые настройки без изменения исходников.",null,null];help["gost-formatting"]=[["Что меняется?","Только выбранные базовые параметры: шрифт, кегль, интервал, абзацный отступ, выравнивание и поля страницы."],["Что сохраняется?","Таблицы, формулы, изображения, колонтитулы и остальные части DOCX переносятся в новую копию."],["Можно обработать пакет?","Да. Все выбранные документы получают один набор настроек; ошибки одного файла не удаляют успешные результаты."]];window.addEventListener("docomator:view-changed", (event) => {
    clearTimeout(gostUi.pollTimer);
    if (event.detail?.view === "gost-formatting") {
      void gostRender().then(() => gostPoll());
    } else if (document.querySelector("#gostFiles")) {
      gostUi.settings = gostCurrentSettings();
    }
  });
  document.addEventListener("docomator:space-changed", () => {
    const spaceId = gostSpaceId();
    if (spaceId === gostUi.spaceId) return;
    gostUi.spaceId = spaceId;
    gostUi.revision += 1;
    clearTimeout(gostUi.pollTimer);
    gostUi.job = null;
    gostUi.files = [];
    gostUi.loading = false;
    gostRenderFiles();
    gostRenderResults();
    if (state.view === "gost-formatting") void gostRender();
  });if(location.hash==="#gost-formatting")globalThis.docomatorSelectView?.("gost-formatting")}
  gostInstallShell();
}
