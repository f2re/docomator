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
  const missingMembers = preflight.members.filter((member) => !member.ready);
  const readyText =
    preflight.targetMode === "one_per_member"
      ? `Можно сформировать индивидуальных документов: ${preflight.readyMemberCount}.`
      : preflight.missingMemberCount === 0
        ? "Сводный документ готов к запуску."
        : "Сводный документ нельзя сформировать, пока обязательные значения заполнены не у всех участников.";
  holder.innerHTML = `
    <article class="generation-summary ${preflight.missingMemberCount === 0 ? "is-success" : "is-warning"}">
      <span aria-hidden="true">${preflight.missingMemberCount === 0 ? "✅" : "⚠️"}</span>
      <div>
        <strong>${preflight.missingMemberCount === 0 ? "Данные готовы" : "Найдены незаполненные обязательные поля"}</strong>
        <p>${generationEscape(readyText)}</p>
      </div>
    </article>
    <div class="generation-progress-grid">
      <div class="generation-progress-item"><span>Участников</span><strong>${preflight.memberCount}</strong></div>
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
        ${missingMembers.length > 100 ? `<div class="generation-history-empty">Показаны первые 100 участников. Всего требуют данных: ${missingMembers.length}.</div>` : ""}
      </section>` : ""}
    <div class="generation-downloads">
      ${preflight.canStart && preflight.targetMode === "one_per_member" ? `<button class="primary-button" id="generationStartPrepared" type="button">Сформировать готовые документы (${preflight.readyMemberCount})</button>` : ""}
      ${preflight.canStart && preflight.missingMemberCount === 0 ? `<button class="primary-button" id="generationStartPrepared" type="button">Начать формирование</button>` : ""}
      <button class="secondary-button" id="generationPreflightRefresh" type="button">Проверить данные ещё раз</button>
    </div>
    ${preflight.targetMode === "one_per_member" && preflight.missingMemberCount > 0 ? `<div class="generation-state is-warning"><span aria-hidden="true">ⓘ</span><div><strong>Частичный выпуск разрешён</strong><p>Готовые индивидуальные документы будут сформированы. Участники без обязательных данных останутся в задании со статусом ошибки и не потеряются.</p></div></div>` : ""}`;
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
    `<div class="generation-state is-pending" id="generationPreflightProgress" role="status"><span aria-hidden="true">⏳</span><div><strong>Проверяем актуальные значения</strong><p>Используем тот же зафиксированный состав, но перечитываем текущие свойства участников.</p></div></div>`
  );
  try {
    const preflight = await inspectPreparedGeneration();
    if (preflight?.missingMemberCount === 0) {
      await startPreparedGeneration();
    }
  } catch (error) {
    holder.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Проверку выполнить не удалось</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p></div></div>`;
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
  generationBusy = true;
  if (button) button.disabled = true;
  if (message) {
    message.className = "is-loading";
    message.textContent = "Создаём сохраняемое задание формирования.";
  }
  holder.innerHTML = `<div class="generation-state is-pending" role="status"><span aria-hidden="true">⏳</span><div><strong>Ставим формирование в очередь</strong><p>Состав и версия шаблона уже зафиксированы.</p></div></div>`;
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
    await pollGenerationJob(jobId);
  } catch (error) {
    if (message) {
      message.className = "is-error";
      message.textContent = "Задание не создано. Подготовленный состав сохранён на экране.";
    }
    holder.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Запуск не выполнен</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${generationEscape(error.operationId)}</code>.</small>` : ""}</div></div>`;
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

  let source;
  try {
    source = generationSourcePayload();
  } catch (error) {
    message.textContent = error?.message || "Проверьте состав участников.";
    message.className = "is-error";
    return;
  }

  generationBusy = true;
  button.disabled = true;
  message.className = "is-loading";
  message.textContent = "Фиксируем состав и проверяем обязательные данные до запуска.";
  status.innerHTML = `<div class="generation-state is-pending" role="status"><span aria-hidden="true">⏳</span><div><strong>Подготавливаем выпуск</strong><p>Сначала система покажет, для каких участников данных недостаточно.</p></div></div>`;
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
    message.textContent = `Проверка завершена: готовы ${preflight.readyMemberCount} из ${preflight.memberCount} участников.`;
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

function bindGenerationPreflightForm() {
  const form = document.querySelector("#documentGenerationForm");
  if (!form || form === generationPreflightForm) return;
  generationPreflightForm = form;
  form.addEventListener("submit", prepareGenerationWithPreflight, {
    capture: true
  });
}

if (generationView) {
  bindGenerationPreflightForm();
  new MutationObserver(bindGenerationPreflightForm).observe(generationView, {
    childList: true,
    subtree: true
  });
}
