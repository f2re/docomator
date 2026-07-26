{
  const multiTrialRecoveredValues = new Map();
  const multiTrialKnownFieldIdsByDraft = new Map();

  function multiTrialRecoveryKey(draftId, field) {
    return `${draftId}:${field.key || field.id}`;
  }

  function multiTrialRememberValues() {
    const draft = selectedMultiTrialDraft();
    const form = document.querySelector("#templateMultiTrialForm");
    if (!draft || !form) return;
    for (const field of draft.fields || []) {
      const control = form.querySelector(`[data-field-id="${CSS.escape(field.id)}"]`);
      if (control) {
        multiTrialRecoveredValues.set(
          multiTrialRecoveryKey(draft.id, field),
          control.value
        );
      }
    }
  }

  function multiTrialSample(field) {
    const text = `${field.label || ""} ${field.key || ""}`.toLocaleLowerCase("ru-RU");
    if (field.valueType === "boolean") return "true";
    if (field.valueType === "number") return "1.5";
    if (field.valueType === "integer") return /номер строки|position/u.test(text) ? "1" : "10";
    if (field.valueType === "date") return "2026-01-15";
    if (field.valueType === "date-time") return "2026-01-15T10:30";
    if (/фио|фамил|display_name|full_name/u.test(text)) return "Иванов Иван Иванович";
    if (/тем.*работ|научн.*тем/u.test(text)) return "Тестовая тема научной работы";
    if (/руковод|научрук/u.test(text)) return "Петров Пётр Петрович";
    if (/зачет|зачёт/u.test(text)) return "ЗК-001";
    if (/должност/u.test(text)) return "Инженер";
    if (/подраздел|кафедр|отдел/u.test(text)) return "Учебный отдел";
    if (field.valueType === "enum") {
      const definition = structurePropertyDefinitions.find(
        (candidate) => candidate.key === field.key
      );
      const configured = Array.isArray(definition?.validation?.enum)
        ? definition.validation.enum[0]
        : null;
      return configured || "Тестовое значение";
    }
    return "Тестовое значение";
  }

  function multiTrialRecoveryFieldInput(field, value) {
    const identifier = `multiValue_${field.id}`;
    const common = `id="${multiTrialEscape(identifier)}" data-field-id="${multiTrialEscape(field.id)}" data-field-key="${multiTrialEscape(field.key || "")}" data-value-type="${multiTrialEscape(field.valueType)}"`;
    if (field.valueType === "text") {
      return `<textarea ${common} rows="4" maxlength="20000" ${field.required ? "required" : ""} placeholder="Введите тестовый текст">${multiTrialEscape(value)}</textarea>`;
    }
    if (field.valueType === "boolean") {
      return `<select ${common}><option value="true"${String(value) === "true" ? " selected" : ""}>Да</option><option value="false"${String(value) === "false" ? " selected" : ""}>Нет</option></select>`;
    }
    if (field.valueType === "number" || field.valueType === "integer") {
      return `<input ${common} type="number" ${field.valueType === "integer" ? 'step="1"' : 'step="any"'} value="${multiTrialEscape(value)}" ${field.required ? "required" : ""} placeholder="Введите тестовое число" />`;
    }
    if (field.valueType === "date") {
      return `<input ${common} type="date" value="${multiTrialEscape(value)}" ${field.required ? "required" : ""} />`;
    }
    if (field.valueType === "date-time") {
      return `<input ${common} type="datetime-local" value="${multiTrialEscape(value)}" ${field.required ? "required" : ""} />`;
    }
    return `<input ${common} type="text" maxlength="4000" value="${multiTrialEscape(value)}" ${field.required ? "required" : ""} placeholder="Введите тестовое значение" />`;
  }

  function multiTrialRecoveryProgress() {
    const draft = selectedMultiTrialDraft();
    const form = document.querySelector("#templateMultiTrialForm");
    if (!draft || !form) return;
    const filled = draft.fields.filter((field) => {
      const control = form.querySelector(`[data-field-id="${CSS.escape(field.id)}"]`);
      return control && String(control.value).trim() !== "";
    }).length;
    const progress = document.querySelector("#templateMultiTrialProgress");
    if (progress) {
      progress.textContent = `Заполнено тестовых примеров: ${filled} из ${draft.fields.length}.`;
      progress.className = filled === draft.fields.length ? "is-ready" : "";
    }
  }

  renderMultiTrialFields = function renderMultiTrialFieldsRecovered() {
    multiTrialRememberValues();
    const draft = selectedMultiTrialDraft();
    const holder = document.querySelector("#templateMultiTrialFields");
    const count = document.querySelector("#templateMultiTrialCount");
    if (!draft || !holder || !count) return;
    const currentIds = new Set(draft.fields.map((field) => field.id));
    const knownIds = multiTrialKnownFieldIdsByDraft.get(draft.id) || new Set();
    const newIds = new Set(
      [...currentIds].filter((fieldId) => !knownIds.has(fieldId))
    );
    if (knownIds.size === 0) newIds.clear();
    multiTrialKnownFieldIdsByDraft.set(draft.id, currentIds);
    count.textContent = `${draft.fields.length} полей будут одновременно вставлены в одну пробную копию и считаны обратно.`;
    holder.innerHTML = `
      <section class="multi-trial-explanation">
        <div><strong>Зачем вводить примеры?</strong><p>Это временные тестовые значения для проверки самого шаблона. Они не записываются в карточки сотрудников и не попадут в рабочие документы.</p></div>
        <ol><li>Заполните каждое поле любым узнаваемым примером.</li><li>Нажмите «Создать и проверить пробную копию».</li><li>Система вставит значения, затем сама прочитает готовый файл и сравнит результат.</li></ol>
        <div class="multi-trial-example-actions"><button class="secondary-button" id="templateMultiTrialFillExamples" type="button">Заполнить безопасными примерами</button><button class="text-button" id="templateMultiTrialClearExamples" type="button">Очистить примеры</button><span id="templateMultiTrialProgress"></span></div>
      </section>
      <div class="multi-trial-fields-grid">${draft.fields
        .map((field, index) => {
          const saved = multiTrialRecoveredValues.get(
            multiTrialRecoveryKey(draft.id, field)
          );
          const value = saved === undefined ? "" : saved;
          return `
            <label class="multi-trial-field${newIds.has(field.id) ? " is-new" : ""}">
              <span><strong>${index + 1}. ${multiTrialEscape(field.label)}</strong>${field.required ? '<em>Нужно для рабочих документов</em>' : '<em>Необязательное рабочее поле</em>'}</span>
              ${newIds.has(field.id) ? '<b class="multi-trial-new-mark">Добавлено после настройки строки</b>' : ""}
              ${multiTrialRecoveryFieldInput(field, value)}
              <small>${multiTrialEscape(multiTrialFieldTypeLabel(field.valueType))} · здесь нужен только тестовый пример</small>
            </label>`;
        })
        .join("")}</div>`;
    holder.querySelectorAll("[data-field-id]").forEach((control) => {
      const field = draft.fields.find((candidate) => candidate.id === control.dataset.fieldId);
      const remember = () => {
        if (field) {
          multiTrialRecoveredValues.set(
            multiTrialRecoveryKey(draft.id, field),
            control.value
          );
        }
        multiTrialRecoveryProgress();
      };
      control.addEventListener("input", remember);
      control.addEventListener("change", remember);
    });
    holder.querySelector("#templateMultiTrialFillExamples")?.addEventListener("click", () => {
      for (const field of draft.fields) {
        const control = holder.querySelector(`[data-field-id="${CSS.escape(field.id)}"]`);
        if (!control || String(control.value).trim() !== "") continue;
        control.value = multiTrialSample(field);
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }
      multiTrialRecoveryProgress();
    });
    holder.querySelector("#templateMultiTrialClearExamples")?.addEventListener("click", () => {
      holder.querySelectorAll("[data-field-id]").forEach((control) => {
        control.value = control.dataset.valueType === "boolean" ? "true" : "";
        control.dispatchEvent(new Event("change", { bubbles: true }));
      });
      multiTrialRecoveryProgress();
    });
    multiTrialRecoveryProgress();
    void loadMultiTrialHistory();
  };

  const multiTrialBaseWorkspace = renderMultiTrialWorkspace;
  renderMultiTrialWorkspace = function renderMultiTrialWorkspaceRecovered() {
    multiTrialBaseWorkspace();
    const card = document.querySelector("#templateMultiTrialPanel .multi-trial-card");
    if (!card) return;
    const heading = card.querySelector(".panel-heading h2");
    const description = card.querySelector(".panel-heading p:last-child");
    const guidance = card.querySelector(".multi-trial-guidance p");
    if (heading) heading.textContent = "Проверить все настроенные поля на тестовых примерах";
    if (description) {
      description.textContent =
        "Создайте одну пробную копию шаблона. Система вставит примеры и проверит, что каждое значение можно считать обратно без ошибок.";
    }
    if (guidance) {
      guidance.textContent =
        "Примеры не являются данными сотрудников. Если после настройки строки добавились поля, форма обновит их автоматически и сохранит уже введённые примеры.";
    }
    const submit = card.querySelector("#templateMultiTrialSubmit");
    if (submit) submit.textContent = "Создать и проверить пробную копию";
  };

  function multiTrialFieldSignature(field) {
    return JSON.stringify({
      id: field.id,
      version: field.version || 1,
      key: field.key,
      label: field.label,
      valueType: field.valueType,
      required: Boolean(field.required),
      formatter: field.formatter || null
    });
  }

  function multiTrialSameFields(left, right) {
    const leftFields = (left?.fields || [])
      .map(multiTrialFieldSignature)
      .sort();
    const rightFields = (right?.fields || [])
      .map(multiTrialFieldSignature)
      .sort();
    return (
      leftFields.length === rightFields.length &&
      leftFields.every((signature, index) => signature === rightFields[index])
    );
  }

  async function multiTrialRefreshChangedDraft(cached, result, reason) {
    const latestBody = await multiTrialFetchJson(
      `/api/v1/spaces/${encodeURIComponent(currentMultiTrialSpaceId())}/template-drafts/${encodeURIComponent(cached.id)}`
    );
    const latest = latestBody.data;
    const index = multiTrialDrafts.findIndex((draft) => draft.id === cached.id);
    if (index >= 0) multiTrialDrafts[index] = latest;
    multiTrialRememberValues();
    renderMultiTrialFields();
    result.innerHTML = `
      <div class="multi-trial-state is-warning" role="status"><span aria-hidden="true">↻</span><div><strong>Список полей обновлён</strong><p>${multiTrialEscape(reason)} Было полей: ${cached.fields.length}, сейчас: ${latest.fields.length}. Уже введённые примеры сохранены; заполните подсвеченные новые поля и повторите проверку.</p></div></div>`;
    document.querySelector("#templateMultiTrialMessage").className = "is-warning";
    document.querySelector("#templateMultiTrialMessage").textContent =
      "Ничего не сохранено: сначала проверьте обновлённый список тестовых полей.";
  }

  submitMultiTrial = async function submitMultiTrialRecovered(event) {
    event.preventDefault();
    if (multiTrialBusy) return;
    const cachedDraft = selectedMultiTrialDraft();
    const form = event.currentTarget;
    const button = form.querySelector("#templateMultiTrialSubmit");
    const message = form.querySelector("#templateMultiTrialMessage");
    const result = document.querySelector("#templateMultiTrialResult");
    if (!cachedDraft || !button || !message || !result) return;
    multiTrialRememberValues();

    multiTrialBusy = true;
    button.disabled = true;
    button.textContent = "Сверяем список полей…";
    message.className = "is-loading";
    message.textContent = "Сначала проверяем, что после настройки строки состав полей не изменился.";
    try {
      const latestBody = await multiTrialFetchJson(
        `/api/v1/spaces/${encodeURIComponent(currentMultiTrialSpaceId())}/template-drafts/${encodeURIComponent(cachedDraft.id)}`
      );
      const latestDraft = latestBody.data;
      if (!multiTrialSameFields(cachedDraft, latestDraft)) {
        await multiTrialRefreshChangedDraft(
          cachedDraft,
          result,
          "После открытия этой формы настройки строки были изменены."
        );
        return;
      }
      const values = latestDraft.fields.map((field) => {
        const control = form.querySelector(`[data-field-id="${CSS.escape(field.id)}"]`);
        if (!control) {
          throw new Error(
            `Поле «${field.label}» появилось после открытия формы. Список будет обновлён.`
          );
        }
        const raw = String(control.value);
        if (raw.trim() === "") {
          throw new Error(
            `Введите тестовый пример для поля «${field.label}» или нажмите «Заполнить безопасными примерами».`
          );
        }
        return { fieldId: field.id, value: parseFieldValue(control, field) };
      });

      button.textContent = "Проверяем пробную копию…";
      message.textContent =
        "Вставляем все тестовые значения в одну копию и считываем их обратно. Исходный файл не изменяется.";
      result.innerHTML = `
        <div class="multi-trial-state is-pending" role="status"><span aria-hidden="true">⏳</span><div><strong>Проверяем шаблон</strong><p>Версия будет сохранена только при совпадении всех записанных и считанных значений.</p></div></div>`;
      const body = await multiTrialFetchJson(
        `/api/v1/spaces/${encodeURIComponent(currentMultiTrialSpaceId())}/template-drafts/${encodeURIComponent(latestDraft.id)}/trial-all`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values })
        }
      );
      const data = body.data;
      message.className = "is-success";
      message.textContent = `Проверено полей: ${data.version.fieldCount}. Пробная версия сохранена.`;
      result.innerHTML = `
        <article class="multi-trial-success">
          <div class="multi-trial-success-heading"><span aria-hidden="true">✓</span><div><strong>Шаблон прошёл общую проверку</strong><p>Система записала и успешно считала обратно каждое тестовое значение.</p></div></div>
          <div class="multi-trial-check-list">${data.version.fields
            .map(
              (field) => `<div><span>${multiTrialEscape(field.fieldLabel)}</span><strong>${multiTrialEscape(field.readBackValue)}</strong></div>`
            )
            .join("")}</div>
          <div class="multi-trial-downloads"><a class="secondary-button" href="${multiTrialEscape(data.downloads.compiled)}">Скачать копию для настройки</a><a class="primary-button" href="${multiTrialEscape(data.downloads.trial)}">Скачать проверенную копию</a></div>
          <details><summary>Технические сведения</summary><dl><div><dt>Идентификатор операции</dt><dd><code>${multiTrialEscape(body.correlationId || "не указан")}</code></dd></div></dl></details>
        </article>`;
      globalThis.docomatorTemplateWizard?.complete(3, {
        draftId: latestDraft.id,
        versionId: data.version.id,
        versionKind: "multi"
      });
      await loadMultiTrialHistory();
    } catch (error) {
      if (
        /состав полей|все поля текущего черновика|появилось после открытия|not found in this draft/iu.test(
          error?.message || ""
        )
      ) {
        try {
          await multiTrialRefreshChangedDraft(
            cachedDraft,
            result,
            "Сервер обнаружил более новую настройку шаблона."
          );
          return;
        } catch {
          // Ниже показывается исходная ошибка, если обновление тоже не удалось.
        }
      }
      message.className = "is-error";
      message.textContent = "Пробная версия не сохранена. Введённые примеры остались в форме.";
      result.innerHTML = `
        <div class="multi-trial-state is-error"><span aria-hidden="true">!</span><div><strong>Проверка шаблона не завершена</strong><p>${multiTrialEscape(error?.message || "Исправьте тестовые примеры и повторите действие.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${multiTrialEscape(error.operationId)}</code>.</small>` : ""}</div></div>`;
    } finally {
      multiTrialBusy = false;
      button.disabled = false;
      button.textContent = "Создать и проверить пробную копию";
    }
  };

  window.addEventListener("docomator:template-draft-changed", (event) => {
    const selected = selectedMultiTrialDraft();
    if (
      selected &&
      event.detail?.draftId === selected.id &&
      event.detail?.spaceId === currentMultiTrialSpaceId()
    ) {
      multiTrialRememberValues();
      void loadMultiTrialDrafts();
    }
  });

  renderMultiTrialWorkspace();
}
