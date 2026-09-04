{
  let rosterAssistantBusy = false;

  function rosterNormalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/gu, "е")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/gu, " ");
  }

  function rosterRowCoordinate(element) {
    const location = element?.tableLocation;
    if (!location || element.kind !== "paragraph") return null;
    return {
      part: element.part,
      tableIndex: location.tableIndex,
      rowIndex: location.rowIndex,
      columnIndex: location.columnIndex
    };
  }

  function rosterSameRow(left, right) {
    return Boolean(
      left &&
      right &&
      left.part === right.part &&
      left.tableIndex === right.tableIndex &&
      left.rowIndex === right.rowIndex
    );
  }

  function rosterRowElements(element) {
    const coordinate = rosterRowCoordinate(element);
    if (!coordinate || !Array.isArray(structureReport?.elements)) return [];
    const grouped = new Map();
    for (const candidate of structureReport.elements) {
      const current = rosterRowCoordinate(candidate);
      if (!rosterSameRow(coordinate, current)) continue;
      const previous = grouped.get(current.columnIndex);
      if (!previous || (!previous.text && candidate.text)) grouped.set(current.columnIndex, candidate);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, candidate]) => candidate);
  }

  function rosterHeaderText(element) {
    const coordinate = rosterRowCoordinate(element);
    if (!coordinate || coordinate.rowIndex < 1 || !Array.isArray(structureReport?.elements)) return "";
    const candidates = structureReport.elements.filter((candidate) => {
      const current = rosterRowCoordinate(candidate);
      return Boolean(
        current &&
        current.part === coordinate.part &&
        current.tableIndex === coordinate.tableIndex &&
        current.rowIndex === coordinate.rowIndex - 1 &&
        current.columnIndex === coordinate.columnIndex
      );
    });
    return candidates.map((candidate) => candidate.text || "").find(Boolean) || "";
  }

  function rosterCleanLabel(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/[{}<>\[\]_]+/gu, " ")
      .replace(/\.{2,}/gu, " ")
      .replace(/\s+/gu, " ")
      .replace(/^№\s*/u, "Номер ")
      .trim()
      .slice(0, 160);
  }

  function rosterSuggestedLabel(element, position) {
    const header = rosterCleanLabel(rosterHeaderText(element));
    const current = rosterCleanLabel(element.text);
    const usefulCurrent = current && !/^(поле|значение|текст|заполнить)$/iu.test(current);
    return header || (usefulCurrent ? current : "") || `Поле колонки ${position + 1}`;
  }

  function rosterSemantic(value) {
    const normalized = rosterNormalize(value);
    if (/фио|полное имя|студент|сотрудник|обучающ/u.test(normalized)) return "name";
    if (/тема.*(работ|вкр|диплом|диссертац)|научн.*тема/u.test(normalized)) return "topic";
    if (/научн.*руковод|руководител|научрук|куратор/u.test(normalized)) return "supervisor";
    if (/групп|поток/u.test(normalized)) return "group";
    if (/номер.*зачет|зачетн.*книж/u.test(normalized)) return "student-number";
    if (/должност|позици/u.test(normalized)) return "position";
    return "";
  }

  function rosterPropertyScore(label, property) {
    const normalized = rosterNormalize(label);
    const candidates = [property.label, ...(Array.isArray(property.aliases) ? property.aliases : [])];
    let score = 0;
    for (const candidate of candidates) {
      const target = rosterNormalize(candidate);
      if (normalized === target) score = Math.max(score, 1);
      else if (normalized.includes(target) || target.includes(normalized)) score = Math.max(score, 0.82);
      else if (rosterSemantic(normalized) && rosterSemantic(normalized) === rosterSemantic(target)) score = Math.max(score, 0.96);
    }
    return score;
  }

  function rosterSuggestedMode(label) {
    if (rosterSemantic(label) === "name") return "system:name";
    let best = null;
    for (const property of structurePropertyDefinitions) {
      const appliesTo = Array.isArray(property.appliesTo) ? property.appliesTo : [];
      if (appliesTo.length > 0 && !appliesTo.includes("person")) continue;
      const score = rosterPropertyScore(label, property);
      if (!best || score > best.score) best = { property, score };
    }
    return best && best.score >= 0.72 ? `existing:${best.property.key}` : "new";
  }

  function rosterPropertyOptions(selected) {
    const options = structurePropertyDefinitions
      .filter((property) => {
        const appliesTo = Array.isArray(property.appliesTo) ? property.appliesTo : [];
        return appliesTo.length === 0 || appliesTo.includes("person");
      })
      .sort((left, right) => left.label.localeCompare(right.label, "ru-RU"))
      .map((property) => `<option value="existing:${structureEscape(property.key)}"${selected === `existing:${property.key}` ? " selected" : ""}>${structureEscape(property.label)}</option>`)
      .join("");
    return `<option value="skip"${selected === "skip" ? " selected" : ""}>Не заполнять</option><option value="system:name"${selected === "system:name" ? " selected" : ""}>ФИО участника</option>${options}<option value="new"${selected === "new" ? " selected" : ""}>Создать новое поле…</option>`;
  }

  function rosterExistingField(element) {
    return (structureDraft?.fields || []).find((field) => field.elementId === element.id) || null;
  }

  function rosterCard(element, position) {
    const existing = rosterExistingField(element);
    const label = rosterSuggestedLabel(element, position);
    const mode = existing ? "linked" : rosterSuggestedMode(label);
    const required = ["name", "topic"].includes(rosterSemantic(label));
    if (existing) {
      return `<article class="roster-assistant-column is-linked" data-roster-column data-element-id="${structureEscape(element.id)}"><div class="roster-assistant-column-number">${position + 1}</div><div><strong>${structureEscape(label)}</strong><p>${structureEscape(element.text || "Пустая ячейка")}</p><span class="pill pill-success">Связано: ${structureEscape(existing.label)}</span></div></article>`;
    }
    return `<article class="roster-assistant-column" data-roster-column data-element-id="${structureEscape(element.id)}">
      <div class="roster-assistant-column-number">${position + 1}</div>
      <div class="roster-assistant-column-body">
        <div><strong>${structureEscape(label)}</strong><p>${structureEscape(element.text || "Пустая ячейка")}</p></div>
        <label><span>Что записывать</span><select data-roster-mode>${rosterPropertyOptions(mode)}</select></label>
        <div class="roster-new-property" data-roster-new${mode === "new" ? "" : " hidden"}>
          <label><span>Название нового поля</span><input data-roster-label type="text" maxlength="500" value="${structureEscape(label)}" /></label>
          <label><span>Тип</span><select data-roster-type><option value="string">Короткий текст</option><option value="text"${rosterSemantic(label) === "topic" ? " selected" : ""}>Длинный текст</option><option value="enum">Список вариантов</option><option value="number">Число</option><option value="integer">Целое число</option><option value="date">Дата</option><option value="date-time">Дата и время</option><option value="boolean">Да или нет</option></select></label>
        </div>
        <label class="operator-check"><input data-roster-required type="checkbox"${required ? " checked" : ""} /><span>Обязательное поле</span></label>
      </div>
    </article>`;
  }

  function rosterCurrentRepeatMatches(element) {
    const repeat = structureDraft?.repeatBinding;
    const coordinate = rosterRowCoordinate(element);
    if (!repeat || !coordinate) return true;
    if (repeat.kind !== "docx.repeat-row") return false;
    return repeat.part === coordinate.part && repeat.tableIndex === coordinate.tableIndex && repeat.rowIndex === coordinate.rowIndex;
  }

  function rosterInstallEntry(element) {
    const coordinate = rosterRowCoordinate(element);
    if (!coordinate) return;
    const form = document.querySelector("#documentFieldForm");
    if (!form || document.querySelector("#rosterAssistantEntry")) return;
    const row = rosterRowElements(element);
    if (row.length < 2) return;
    const compatible = rosterCurrentRepeatMatches(element);
    const entry = document.createElement("section");
    entry.id = "rosterAssistantEntry";
    entry.className = `roster-assistant-entry${compatible ? "" : " is-warning"}`;
    entry.innerHTML = compatible
      ? `<div><strong>Заполнить всю строку как список</strong><p>Найдено колонок: ${row.length}. Система предложит ФИО, тему, руководителя и другие поля; строка будет повторена для каждого участника.</p></div><button class="secondary-button" id="rosterAssistantOpen" type="button">Настроить строку</button>`
      : `<div><strong>В шаблоне уже выбрана другая повторяемая строка</strong><p>Один шаблон первой версии поддерживает одну повторяемую область. Выберите поле внутри ранее настроенной строки.</p></div>`;
    form.parentElement?.insertBefore(entry, form);
    entry.querySelector("#rosterAssistantOpen")?.addEventListener("click", () => rosterOpen(element));
  }

  function rosterOpen(element) {
    const row = rosterRowElements(element);
    const detail = document.querySelector("#documentStructureSelection");
    if (!detail || row.length < 2) return;
    const old = detail.querySelector("#rosterAssistantPanel");
    old?.remove();
    const panel = document.createElement("section");
    panel.id = "rosterAssistantPanel";
    panel.className = "roster-assistant-panel";
    panel.innerHTML = `<div class="roster-assistant-heading"><div><p class="eyebrow">Таблица Word</p><h3>Одна строка на каждого участника</h3><p>Проверьте сопоставление колонок. Первая сохранённая колонка пометит всю строку как повторяемую.</p></div><button class="icon-button" id="rosterAssistantClose" type="button" aria-label="Закрыть мастер строки">×</button></div>
      <div class="roster-assistant-columns">${row.map(rosterCard).join("")}</div>
      <div class="roster-assistant-preview"><span aria-hidden="true">✓</span><div><strong>Результат</strong><p>При сводном выпуске строка будет скопирована по одному разу для каждого студента или сотрудника. Значения возьмутся из его карточки.</p></div></div>
      <div class="form-error" id="rosterAssistantError" role="alert" hidden></div>
      <div class="roster-assistant-actions"><button class="secondary-button" id="rosterAssistantCancel" type="button">Отмена</button><button class="primary-button" id="rosterAssistantSave" type="button">Связать всю строку</button></div>`;
    detail.querySelector(".structure-selection-content")?.prepend(panel);
    panel.querySelector("#rosterAssistantClose")?.addEventListener("click", () => panel.remove());
    panel.querySelector("#rosterAssistantCancel")?.addEventListener("click", () => panel.remove());
    panel.querySelectorAll("[data-roster-mode]").forEach((select) => select.addEventListener("change", () => {
      const card = select.closest("[data-roster-column]");
      const fields = card?.querySelector("[data-roster-new]");
      if (fields) fields.hidden = select.value !== "new";
    }));
    panel.querySelector("#rosterAssistantSave")?.addEventListener("click", () => void rosterSave(element, panel));
    requestAnimationFrame(() => panel.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function rosterDefinitionFor(card, element) {
    const mode = card.querySelector("[data-roster-mode]")?.value || "skip";
    if (mode === "system:name") {
      return structureEffectiveDefinition(structureSystemPropertyDefinitions[0], element);
    }
    if (mode.startsWith("existing:")) {
      const key = mode.slice("existing:".length);
      const definition = structurePropertyDefinitions.find((property) => property.key === key);
      if (!definition) throw { message: "Выбранное поле больше не найдено. Обновите структуру." };
      return definition;
    }
    if (mode !== "new") return null;
    const label = card.querySelector("[data-roster-label]")?.value.trim() || "";
    const valueType = card.querySelector("[data-roster-type]")?.value || "string";
    if (!label) throw { message: "Укажите название нового поля в каждой используемой колонке." };
    const matches = structurePropertyDefinitions.filter((property) => rosterNormalize(property.label) === rosterNormalize(label));
    if (matches.length > 1) throw { message: `Найдено несколько полей «${label}». Выберите существующее поле из списка.` };
    if (matches[0]) {
      if (matches[0].valueType !== valueType) throw { message: `Поле «${label}» уже существует с другим типом.` };
      return matches[0];
    }
    const body = await structureFetchJson(
      globalThis.docomatorPropertyDefinitionsUrl(),
      {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label,
        valueType,
        appliesTo: ["person"],
        sensitivity: /паспорт|снилс|адрес регистрации/u.test(rosterNormalize(label)) ? "restricted" : "internal",
        validation: { uiGroup: "common" }
      })
      }
    );
    structurePropertyDefinitions = [...structurePropertyDefinitions, body.data];
    return body.data;
  }

  async function rosterSave(anchor, panel) {
    if (rosterAssistantBusy) return;
    const errorBox = panel.querySelector("#rosterAssistantError");
    const button = panel.querySelector("#rosterAssistantSave");
    const cards = [...panel.querySelectorAll("[data-roster-column]")].filter((card) => !card.classList.contains("is-linked") && card.querySelector("[data-roster-mode]")?.value !== "skip");
    if (cards.length === 0) {
      errorBox.hidden = false;
      errorBox.textContent = "Выберите хотя бы одну колонку для заполнения.";
      return;
    }
    rosterAssistantBusy = true;
    button.disabled = true;
    button.textContent = "Связываем строку…";
    errorBox.hidden = true;
    try {
      const { spaceId, draft } = await loadStructureDraft();
      let repeatCreated = Boolean(draft.repeatBinding);
      let added = 0;
      for (const card of cards) {
        const elementId = card.dataset.elementId;
        const element = structureReport.elements.find((candidate) => candidate.id === elementId);
        if (!element) throw { message: "Одна из ячеек больше не найдена в структуре документа." };
        let definition = await rosterDefinitionFor(card, element);
        if (!definition) continue;
        definition = structureEffectiveDefinition(definition, element);
        const body = await structureFetchJson(`/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draft.id)}/fields`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            key: definition.key,
            label: definition.label,
            valueType: definition.valueType,
            required: Boolean(card.querySelector("[data-roster-required]")?.checked),
            elementId: element.id,
            ...(!repeatCreated ? { repeatRow: true } : {})
          })
        });
        repeatCreated = true;
        draft.repeatBinding = body.data.repeatBinding;
        draft.fields = [...(draft.fields || []), body.data.field];
        added += 1;
      }
      panel.innerHTML = `<div class="roster-assistant-finished"><span aria-hidden="true">✓</span><div><p class="eyebrow">Готово</p><h3>Строка таблицы настроена</h3><p>Связано колонок: ${added}. При сводном выпуске Word создаст отдельную строку для каждого участника выбранной группы.</p><div class="roster-assistant-actions"><button class="secondary-button" id="rosterAssistantMore" type="button">Вернуться к полям</button><button class="primary-button" id="rosterAssistantContinue" type="button">Перейти к проверке</button></div></div></div>`;
      panel.querySelector("#rosterAssistantMore")?.addEventListener("click", () => {
        renderStructureSelection(anchor);
      });
      panel.querySelector("#rosterAssistantContinue")?.addEventListener("click", () => {
        globalThis.docomatorTemplateWizard?.complete(2, {
          sourceId: draft.sourceRecordId || structureWizardArtifacts().sourceId,
          draftId: draft.id
        });
      });
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent = error?.message || "Не удалось связать строку таблицы.";
      button.disabled = false;
      button.textContent = "Связать всю строку";
    } finally {
      rosterAssistantBusy = false;
    }
  }

  const rosterBaseRenderSelection = renderStructureSelection;
  renderStructureSelection = function renderStructureSelectionWithRoster(element) {
    rosterBaseRenderSelection(element);
    rosterInstallEntry(element);
  };
}
