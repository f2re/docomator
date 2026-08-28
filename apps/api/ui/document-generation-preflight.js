let generationPreparedRun = null;
let generationPreflightForm = null;

function generationPreflightMemberMessage(member) {
  return member.missingRequired
    .map((field) => field.label)
    .filter(Boolean)
    .join(", ");
}

function renderGenerationPreflight(preflight) {
  const holder = document.querySelector("#documentGenerationStatus");
  if (!holder) return;
  setGenerationStep(3);
  const missingMembers = preflight.members.filter((member) => !member.ready);
  const readyText =
    preflight.targetMode === "one_per_member"
      ? `Можно сформировать индивидуальных документов: ${preflight.readyMemberCount}.`
      : preflight.missingMemberCount === 0
        ? "Сводный документ готов к запуску."
        : "Сводный документ нельзя сформировать, пока обязательные значения заполнены не у всех сотрудников.";
  holder.innerHTML = `
    <article class="generation-summary ${preflight.missingMemberCount === 0 ? "is-success" : "is-warning"}">
      <div>
        <strong>${preflight.missingMemberCount === 0 ? "Данные готовы" : "Найдены незаполненные обязательные поля"}</strong>
        <p>${generationEscape(readyText)}</p>
      </div>
    </article>
    <div class="generation-progress-grid">
      <div class="generation-progress-item"><span>Сотрудников</span><strong>${preflight.memberCount}</strong></div>
      <div class="generation-progress-item"><span>Полностью готовы</span><strong>${preflight.readyMemberCount}</strong></div>
      <div class="generation-progress-item"><span>Требуют данных</span><strong>${preflight.missingMemberCount}</strong></div>
      <div class="generation-progress-item"><span>Пропущенных значений</span><strong>${preflight.missingValueCount}</strong></div>
    </div>
    ${missingMembers.length > 0 ? `
      <section class="generation-error-list">
        <div><p class="eyebrow">Что заполнить</p></div>
        ${missingMembers
          .slice(0, 100)
          .map(
            (member) => `
              <article class="generation-error-item">
                <div>
                  <strong>${member.position + 1}. ${generationEscape(member.displayName)}</strong>
                  <span>Нет значений: ${generationEscape(generationPreflightMemberMessage(member))}</span>
                </div>
              </article>`
          )
          .join("")}
        ${missingMembers.length > 100 ? `<div class="generation-history-empty">Показаны первые 100 сотрудников. Всего требуют данных: ${missingMembers.length}.</div>` : ""}
      </section>` : ""}
    <div class="generation-downloads">
      ${preflight.canStart && preflight.targetMode === "one_per_member" && preflight.missingMemberCount > 0 ? `<button class="primary-button" id="generationStartPrepared" type="button">Сформировать готовые документы (${preflight.readyMemberCount})</button>` : ""}
      ${preflight.canStart && preflight.missingMemberCount === 0 ? `<button class="primary-button" id="generationStartPrepared" type="button">Сформировать документы</button>` : ""}
      <button class="secondary-button" id="generationPreflightRefresh" type="button">Обновить проверку</button>
    </div>
    ${preflight.targetMode === "one_per_member" && preflight.missingMemberCount > 0 ? `<div class="generation-state is-warning"><div><strong>Можно выпустить готовые карточки</strong><p>Документы для заполненных карточек будут созданы. Сотрудники с пропусками останутся в списке для исправления.</p></div></div>` : ""}`;
  const submit = document.querySelector("#generationSubmit");
  if (submit) submit.hidden = true;
  holder
    .querySelector("#generationStartPrepared")
    ?.addEventListener("click", startPreparedGeneration);
  holder
    .querySelector("#generationPreflightRefresh")
    ?.addEventListener("click", refreshPreparedGenerationPreflight);
}

async function inspectPreparedGeneration() {
  if (!generationPreparedRun) return null;
  const body = await generationFetchJson(
    `/api/v1/spaces/${encodeURIComponent(generationPreparedRun.spaceId)}/document-jobs/preflight`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        activeReleaseId: generationPreparedRun.activeReleaseId,
        snapshotId: generationPreparedRun.snapshotId
      })
    }
  );
  generationPreparedRun.preflight = body.data;
  renderGenerationPreflight(body.data);
  return body.data;
}

async function refreshPreparedGenerationPreflight() {
  const holder = document.querySelector("#documentGenerationStatus");
  if (!generationPreparedRun || !holder || generationBusy) return;
  generationBusy = true;
  holder.insertAdjacentHTML(
    "afterbegin",
    `<div class="generation-state is-pending" id="generationPreflightProgress" role="status"><div><strong>Проверяем актуальные значения</strong><p>Используем тот же список сотрудников и перечитываем значения их карточек.</p></div></div>`
  );
  try {
    const preflight = await inspectPreparedGeneration();
    const message = document.querySelector("#generationFormMessage");
    if (preflight?.missingMemberCount === 0 && message) {
      message.className = "is-success";
      message.textContent =
        "Все обязательные данные заполнены. Проверьте итог и нажмите «Сформировать документы».";
    }
  } catch (error) {
    const message = document.querySelector("#generationFormMessage");
    if (message) {
      message.className = "is-error";
      message.textContent = "Проверку не удалось обновить. Подготовленный состав сохранён.";
    }
    holder.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Проверку выполнить не удалось</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p><p>Выбранный состав сохранён; повторная настройка не требуется.</p><button class="primary-button" id="generationPreflightRefreshRetry" type="button">Повторить проверку</button></div></div>`;
    holder
      .querySelector("#generationPreflightRefreshRetry")
      ?.addEventListener("click", refreshPreparedGenerationPreflight);
  } finally {
    generationBusy = false;
    document.querySelector("#generationPreflightProgress")?.remove();
  }
}

async function startPreparedGeneration() {
  if (!generationPreparedRun || generationBusy) return;
  const holder = document.querySelector("#documentGenerationStatus");
  const button = document.querySelector("#generationSubmit");
  const message = document.querySelector("#generationFormMessage");
  if (!holder) return;
  setGenerationStep(3);
  generationBusy = true;
  if (button) button.disabled = true;
  if (message) {
    message.className = "is-loading";
    message.textContent = "Создаём сохраняемое задание формирования.";
  }
  holder.innerHTML = `<div class="generation-state is-pending" role="status"><div><strong>Начинаем формирование</strong><p>Шаблон и список сотрудников уже сохранены для этого выпуска.</p></div></div>`;
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(generationPreparedRun.spaceId)}/document-jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activeReleaseId: generationPreparedRun.activeReleaseId,
          snapshotId: generationPreparedRun.snapshotId,
          idempotencyKey: generationPreparedRun.idempotencyKey
        })
      }
    );
    if (message) {
      message.className = "is-success";
      message.textContent = `Задание создано. Ожидается файлов: ${body.data.job.expectedCount}.`;
    }
    const jobId = body.data.job.id;
    generationPreparedRun = null;
    generationAutoOpenJobId = jobId;
    await pollGenerationJob(jobId);
  } catch (error) {
    if (message) {
      message.className = "is-error";
      message.textContent = "Задание не создано. Подготовленный состав сохранён на экране.";
    }
    holder.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Запуск не выполнен</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p><p>Подготовленный состав сохранён. Можно повторить запуск без новой настройки.</p>${error?.operationId ? `<small>Идентификатор операции: <code>${generationEscape(error.operationId)}</code>.</small>` : ""}<button class="primary-button" id="generationStartPreparedRetry" type="button">Повторить запуск</button></div></div>`;
    holder
      .querySelector("#generationStartPreparedRetry")
      ?.addEventListener("click", startPreparedGeneration);
  } finally {
    generationBusy = false;
    if (button) button.disabled = false;
  }
}

async function prepareGenerationWithPreflight(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (generationBusy) return;
  const template = selectedGenerationTemplate();
  const spaceId = currentGenerationSpaceId();
  const status = document.querySelector("#documentGenerationStatus");
  const button = document.querySelector("#generationSubmit");
  const message = document.querySelector("#generationFormMessage");
  if (!template || !spaceId || !status || !button || !message) return;
  setGenerationStep(3);

  let source;
  try {
    source = generationSourcePayload();
  } catch (error) {
    message.textContent = error?.message || "Проверьте список сотрудников.";
    message.className = "is-error";
    return;
  }

  generationBusy = true;
  button.disabled = true;
  message.className = "is-loading";
  message.textContent = "Сохраняем выбранный список и проверяем обязательные данные.";
  status.innerHTML = `<div class="generation-state is-pending" role="status"><div><strong>Проверяем карточки сотрудников</strong><p>Система покажет, каких сведений не хватает до запуска.</p></div></div>`;
  try {
    const snapshotBody = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/audience-snapshots`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source,
          targetMode: currentGenerationMode()
        })
      }
    );
    generationPreparedRun = {
      spaceId,
      activeReleaseId: template.id,
      snapshotId: snapshotBody.data.snapshot.id,
      idempotencyKey: newGenerationKey(),
      preflight: null
    };
    const preflight = await inspectPreparedGeneration();
    if (preflight?.missingMemberCount === 0) {
      generationBusy = false;
      await startPreparedGeneration();
      return;
    }
    message.className = "is-warning";
    message.textContent = `Проверка завершена: готовы ${preflight.readyMemberCount} из ${preflight.memberCount}. Исправьте пропуски или сформируйте только готовые документы.`;
  } catch (error) {
    generationPreparedRun = null;
    message.className = "is-error";
    message.textContent = "Подготовка не завершена. Выбранные параметры остались в форме.";
    status.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Подготовка не выполнена</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${generationEscape(error.operationId)}</code>.</small>` : ""}</div></div>`;
  } finally {
    generationBusy = false;
    button.disabled = false;
  }
}

function generationUxIcon(kind) {
  const paths = {
    template: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/><path d="M9.5 12h5"/><path d="M9.5 15.5h5"/>',
    audience: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.4-3.2 2.2-5 5.5-5s5.1 1.8 5.5 5"/><circle cx="16.5" cy="9" r="2.2"/><path d="M15.5 14.5c2.9.1 4.5 1.6 5 4.5"/>',
    output: '<rect x="4" y="5" width="11" height="14" rx="1.5"/><path d="M8 9h3"/><path d="M8 12.5h3"/><path d="M9 2.5h8.5a2 2 0 0 1 2 2V16"/>',
    check: '<path d="M5 12.5 9.5 17 19 7.5"/>'
  };
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">${paths[kind] || paths.check}</svg>`;
}

function generationUxIsPerson() {
  return typeof genericGenerationIsPerson !== "function" || genericGenerationIsPerson();
}

function enhanceGenerationSelect(select, placeholder, searchPlaceholder) {
  if (!select) return;
  select.dataset.searchableSelect = "";
  select.dataset.searchablePlaceholder = placeholder;
  select.dataset.searchableSearchPlaceholder = searchPlaceholder;
  globalThis.docomatorSearchableSelect?.enhance(select);
}

function applyGenerationFormUx() {
  const form = document.querySelector("#documentGenerationForm");
  if (!form) return;
  const sectionIcons = ["template", "audience", "output", "check"];
  form.querySelectorAll(".generation-wizard-number").forEach((node, index) => {
    node.textContent = "";
    node.dataset.generationIcon = sectionIcons[index] || "check";
    node.innerHTML = generationUxIcon(sectionIcons[index] || "check");
  });

  const templateLabel = form.querySelector("#generationTemplateLabel");
  if (templateLabel) templateLabel.textContent = "Шаблон";
  const template = form.querySelector("#generationTemplate");
  enhanceGenerationSelect(template, "Выберите шаблон", "Найти шаблон");
  const templateHint = template?.closest("label")?.querySelector("small");
  if (templateHint) templateHint.textContent = "Только проверенные шаблоны этого раздела.";

  const peopleLabel = form.querySelector("#generationPeopleLabel");
  if (peopleLabel) peopleLabel.textContent = generationUxIsPerson() ? "Сотрудники" : "Объекты";
  const sourceHint = form.querySelector("#generationSourceKind")?.closest("label")?.querySelector("small");
  if (sourceHint) sourceHint.textContent = "Состав фиксируется перед запуском и не меняется внутри задания.";
  if (generationUxIsPerson()) {
    const source = form.querySelector("#generationSourceKind");
    const labels = {
      all_space: "Все сотрудники раздела",
      group: "Сохранённая группа",
      selected: "Выбрать сотрудников"
    };
    for (const option of source?.options || []) {
      if (labels[option.value]) option.textContent = labels[option.value];
    }
  }

  const modeLabel = form.querySelector("#generationModeLabel");
  if (modeLabel) modeLabel.textContent = "Результат";
  const personal = form.querySelector('input[name="generationMode"][value="one_per_member"]')?.closest("label");
  const personalStrong = personal?.querySelector("strong");
  const personalSmall = personal?.querySelector("small");
  if (personalStrong) personalStrong.textContent = "Отдельный документ на каждого";
  if (personalSmall) personalSmall.textContent = "Несколько файлов автоматически соберутся в один ZIP-комплект.";
  const aggregate = form.querySelector('input[name="generationMode"][value="aggregate"]')?.closest("label");
  const aggregateSmall = aggregate?.querySelector("small");
  if (aggregateSmall) aggregateSmall.textContent = "Один файл с данными выбранного состава.";

  const summaryLabel = form.querySelector("#generationSummaryLabel");
  if (summaryLabel) summaryLabel.textContent = "Будет создано";
  const submit = form.querySelector("#generationSubmit");
  if (submit) submit.textContent = "Проверить и сформировать";
  const message = form.querySelector("#generationFormMessage");
  if (message && !generationPreparedRun && !message.classList.contains("is-error")) {
    message.textContent = "Сначала проверим обязательные данные. Если всё готово, формирование начнётся сразу; отправка адресатам не выполняется.";
  }

  const group = form.querySelector("#generationGroup");
  enhanceGenerationSelect(group, "Выберите группу", "Найти группу");
}

function invalidatePreparedGeneration() {
  if (!generationPreparedRun || generationBusy) return;
  generationPreparedRun = null;
  setGenerationStep(1);
  const status = document.querySelector("#documentGenerationStatus");
  const button = document.querySelector("#generationSubmit");
  const message = document.querySelector("#generationFormMessage");
  if (status) status.replaceChildren();
  if (button) {
    button.hidden = false;
    updateGenerationEstimate();
  }
  if (message) {
    message.className = "";
    message.textContent = "Настройки изменены. Проверим новый состав перед формированием; отправка адресатам не выполняется.";
  }
}

const generationUxBaseRenderWorkspace = renderGenerationWorkspace;
renderGenerationWorkspace = function renderGenerationWorkspaceWithUx() {
  generationUxBaseRenderWorkspace();
  applyGenerationFormUx();
};

const generationUxBaseRenderSourceDetails = renderGenerationSourceDetails;
renderGenerationSourceDetails = function renderGenerationSourceDetailsWithUx() {
  generationUxBaseRenderSourceDetails();
  applyGenerationFormUx();
};

function bindGenerationPreflightForm() {
  const form = document.querySelector("#documentGenerationForm");
  if (!form || form === generationPreflightForm) return;
  generationPreflightForm = form;
  form.addEventListener("submit", prepareGenerationWithPreflight, {
    capture: true
  });
  form.addEventListener("change", invalidatePreparedGeneration);
  applyGenerationFormUx();
}

if (generationView) {
  bindGenerationPreflightForm();
  new MutationObserver(bindGenerationPreflightForm).observe(generationView, {
    childList: true,
    subtree: true
  });
}
