{
  let rowEditorBusy = false;

  function rowEditorEntityTypeKey() {
    return globalThis.docomatorTemplateEntityTypeKey || "person";
  }

  function rowEditorIsPerson() {
    return rowEditorEntityTypeKey() === "person";
  }

  function rowEditorNormalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/gu, "е")
      .replace(/[^\p{L}\p{N}#№]+/gu, " ")
      .trim()
      .replace(/\s+/gu, " ");
  }

  function rowEditorSameRow(left, right) {
    return Boolean(
      left?.kind === "paragraph" &&
        right?.kind === "paragraph" &&
        left.part === right.part &&
        left.tableLocation &&
        right.tableLocation &&
        left.tableLocation.tableIndex === right.tableLocation.tableIndex &&
        left.tableLocation.rowIndex === right.tableLocation.rowIndex
    );
  }

  function rowEditorElements(element) {
    if (!element?.tableLocation || !Array.isArray(structureReport?.elements)) return [];
    const byColumn = new Map();
    for (const candidate of structureReport.elements) {
      if (!rowEditorSameRow(candidate, element)) continue;
      const column = candidate.tableLocation.columnIndex;
      const previous = byColumn.get(column);
      const candidateLinked = Boolean(rowEditorExistingField(candidate));
      const previousLinked = Boolean(previous && rowEditorExistingField(previous));
      if (
        !previous ||
        (candidateLinked && !previousLinked) ||
        (!previousLinked && !previous.text && candidate.text)
      ) {
        byColumn.set(column, candidate);
      }
    }
    return [...byColumn.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, candidate]) => candidate);
  }

  function rowEditorHeader(element) {
    const location = element?.tableLocation;
    if (!location || location.rowIndex < 1) return "";
    const candidates = (structureReport?.elements || []).filter(
      (candidate) =>
        candidate.kind === "paragraph" &&
        candidate.part === element.part &&
        candidate.tableLocation?.tableIndex === location.tableIndex &&
        candidate.tableLocation?.rowIndex === location.rowIndex - 1 &&
        candidate.tableLocation?.columnIndex === location.columnIndex
    );
    const previous =
      candidates.find((candidate) => String(candidate.text || "").trim() !== "") ||
      candidates[0];
    return String(previous?.text || "").trim();
  }

  function rowEditorExistingField(element, draft = structureDraft) {
    return draft?.fields?.find((field) => field.elementId === element.id) || null;
  }

  function rowEditorSemantic(header) {
    const raw = String(header || "").trim();
    if (/^(?:#|№)$/u.test(raw)) return "position";
    const value = rowEditorNormalize(header);
    if (/^(?:n|номер|п п|порядковый номер)$/u.test(value)) return "position";
    if (/\bфио\b|фамил|полное имя|студент|сотрудник|назван|наимен|заголов/u.test(value)) return "name";
    if (/тем.*(?:работ|исслед|вкр)|научн.*тем/u.test(value)) return "topic";
    if (/руковод|научрук|научн.*рук/u.test(value)) return "supervisor";
    if (/зачетк|зачетн.*книж|номер.*зачет/u.test(value)) return "student-number";
    if (/должност|позици/u.test(value)) return "position-title";
    if (/подраздел|отдел|кафедр|факульт/u.test(value)) return "department";
    if (/групп/u.test(value)) return "group";
    return "unknown";
  }

  function rowEditorPropertyScore(header, definition) {
    const source = rowEditorNormalize(header);
    if (!source) return 0;
    const candidates = [definition.label, ...(definition.aliases || [])]
      .map(rowEditorNormalize)
      .filter(Boolean);
    let score = 0;
    for (const candidate of candidates) {
      if (candidate === source) score = Math.max(score, 1);
      else if (candidate.includes(source) || source.includes(candidate)) {
        score = Math.max(score, 0.84);
      } else {
        const left = new Set(source.split(" "));
        const right = new Set(candidate.split(" "));
        const common = [...left].filter((word) => right.has(word)).length;
        if (common > 0) score = Math.max(score, common / Math.max(left.size, right.size));
      }
    }
    const semantic = rowEditorSemantic(header);
    const propertyText = rowEditorNormalize(
      `${definition.label} ${(definition.aliases || []).join(" ")}`
    );
    const patterns = {
      topic: /тем.*(?:работ|исслед|вкр)|научн.*тем/u,
      supervisor: /руковод|научрук/u,
      "student-number": /зачетк|зачетн.*книж/u,
      "position-title": /должност|позици/u,
      department: /подраздел|отдел|кафедр|факульт/u,
      group: /групп/u
    };
    if (patterns[semantic]?.test(propertyText)) score = Math.max(score, 0.92);
    return score;
  }

  function rowEditorExistingMode(field) {
    if (!field) return "";
    if (field.key === "subject.position" || field.key === "position") {
      return "system:position";
    }
    if (
      field.formatter?.kind === "person-name.ru" ||
      field.key.endsWith(".display_name") ||
      field.key === "display_name" ||
      field.key === "fio"
    ) {
      return "system:name";
    }
    const property = structurePropertyDefinitions.find(
      (definition) => definition.key === field.key
    );
    return property ? `existing:${property.key}` : `current:${field.id}`;
  }

  function rowEditorSuggestedGroup(element, existing) {
    if (!rowEditorIsPerson()) return "common";
    if (existing) {
      const property = structurePropertyDefinitions.find(
        (definition) => definition.key === existing.key
      );
      if (property) return structurePropertyGroup(property);
    }
    return globalThis.docomatorFieldGroups.infer(
      `${rowEditorHeader(element)} ${element?.text || ""}`
    );
  }

  function rowEditorApplicableProperties(group, existing) {
    const existingKey = existing?.key || "";
    return structurePropertyDefinitions.filter((definition) => {
      const appliesTo = Array.isArray(definition.appliesTo)
        ? definition.appliesTo
        : [];
      return (
        (appliesTo.length === 0 || appliesTo.includes(rowEditorEntityTypeKey())) &&
        (definition.key === existingKey ||
          !rowEditorIsPerson() ||
          globalThis.docomatorFieldGroups.allowed(definition, group, {
            includeUnassigned: true
          }))
      );
    });
  }

  function rowEditorSuggestedMode(element, existing, group) {
    if (existing) return rowEditorExistingMode(existing);
    const header = rowEditorHeader(element);
    const semantic = rowEditorSemantic(header);
    if (semantic === "position") return "system:position";
    if (semantic === "name") return "system:name";
    const best = rowEditorApplicableProperties(group, existing)
      .map((definition) => ({
        definition,
        score: rowEditorPropertyScore(header, definition)
      }))
      .sort((left, right) => right.score - left.score)[0];
    if (best?.score >= 0.82) return `existing:${best.definition.key}`;
    return semantic === "unknown" ? "skip" : "new";
  }

  function rowEditorPropertyOptions(selected, existing, group) {
    const applicable = rowEditorApplicableProperties(group, existing);
    const options = [
      '<optgroup label="Управление колонкой">',
      `<option value="skip"${selected === "skip" ? " selected" : ""}>Не заполнять эту колонку</option>`,
      `<option value="system:position"${selected === "system:position" ? " selected" : ""}>Номер строки · 1, 2, 3…</option>`,
      `<option value="system:name"${selected === "system:name" ? " selected" : ""}>${rowEditorIsPerson() ? "ФИО участника · с выбором записи" : "Название объекта"}</option>`,
      "</optgroup>"
    ];
    if (rowEditorIsPerson()) {
      const grouped = globalThis.docomatorFieldGroups.grouped(
        applicable,
        group,
        { includeUnassigned: true }
      );
      const order = [...new Set(["common", group, "unassigned"])];
      options.push(
        ...order
          .filter((item) => grouped.get(item)?.length)
          .map(
            (item) =>
              `<optgroup label="${structureEscape(globalThis.docomatorFieldGroups.label(item))}">${grouped
                .get(item)
                .map(
                  (definition) =>
                    `<option value="existing:${structureEscape(definition.key)}" data-search-terms="${structureEscape(`${definition.label} ${(definition.aliases || []).join(" ")}`)}"${selected === `existing:${definition.key}` ? " selected" : ""}>${structureEscape(definition.label)} · ${structureEscape(structureFieldTypeLabel(definition.valueType))}</option>`
                )
                .join("")}</optgroup>`
          )
      );
    } else if (applicable.length) {
      options.push(
        `<optgroup label="Поля выбранного типа">${applicable
          .map(
            (definition) =>
              `<option value="existing:${structureEscape(definition.key)}" data-search-terms="${structureEscape(`${definition.label} ${(definition.aliases || []).join(" ")}`)}"${selected === `existing:${definition.key}` ? " selected" : ""}>${structureEscape(definition.label)} · ${structureEscape(structureFieldTypeLabel(definition.valueType))}</option>`
          )
          .join("")}</optgroup>`
      );
    }
    options.push(
      `<optgroup label="Действия"><option value="new"${selected === "new" ? " selected" : ""}>Создать новое поле для выбранного типа…</option></optgroup>`
    );
    if (existing && selected.startsWith("current:")) {
      options.splice(options.length - 1, 0, `<optgroup label="Сохранённая связь"><option value="${structureEscape(selected)}" selected>${structureEscape(existing.label)}</option></optgroup>`);
    }
    return options.join("");
  }

  function rowEditorNameSettings(field, selectedMode) {
    if (!rowEditorIsPerson()) {
      return { presentation: "identity", sourceOrder: "family-given-patronymic", pattern: "" };
    }
    const formatter = field?.formatter;
    const pattern = formatter?.kind === "person-name.ru" ? formatter.pattern : "{Фамилия} {Имя} {Отчество}";
    const sourceOrder =
      formatter?.kind === "person-name.ru"
        ? formatter.sourceOrder
        : "family-given-patronymic";
    const known = Object.entries(structureNamePatterns).find(
      ([key, value]) => key !== "identity" && value === pattern
    )?.[0];
    const presentation = formatter?.kind === "identity" && selectedMode !== "system:name"
      ? "identity"
      : known || (formatter?.kind === "person-name.ru" ? "custom" : "full");
    return { presentation, sourceOrder, pattern };
  }

  function rowEditorNameOptions(settings) {
    if (!rowEditorIsPerson()) return "";
    return `
      <div class="row-editor-name" data-row-editor-name${settings.presentation === "identity" ? " hidden" : ""}>
        <label><span>Как записать ФИО?</span><select data-row-name-presentation>
          <option value="full"${settings.presentation === "full" ? " selected" : ""}>Фамилия Имя Отчество</option>
          <option value="family-initials"${settings.presentation === "family-initials" ? " selected" : ""}>Фамилия И.О.</option>
          <option value="initials-family"${settings.presentation === "initials-family" ? " selected" : ""}>И.О. Фамилия</option>
          <option value="family"${settings.presentation === "family" ? " selected" : ""}>Только фамилия</option>
          <option value="family-given"${settings.presentation === "family-given" ? " selected" : ""}>Фамилия Имя</option>
          <option value="given-family"${settings.presentation === "given-family" ? " selected" : ""}>Имя Фамилия</option>
          <option value="given-patronymic"${settings.presentation === "given-patronymic" ? " selected" : ""}>Имя Отчество</option>
          <option value="custom"${settings.presentation === "custom" ? " selected" : ""}>Свой шаблон…</option>
        </select></label>
        <label><span>Как ФИО хранится в карточке?</span><select data-row-name-source>
          <option value="family-given-patronymic"${settings.sourceOrder === "family-given-patronymic" ? " selected" : ""}>Фамилия Имя Отчество</option>
          <option value="given-patronymic-family"${settings.sourceOrder === "given-patronymic-family" ? " selected" : ""}>Имя Отчество Фамилия</option>
          <option value="family-given"${settings.sourceOrder === "family-given" ? " selected" : ""}>Фамилия Имя</option>
          <option value="given-family"${settings.sourceOrder === "given-family" ? " selected" : ""}>Имя Фамилия</option>
        </select></label>
        <label data-row-name-custom${settings.presentation === "custom" ? "" : " hidden"}><span>Свой шаблон</span><input data-row-name-pattern type="text" maxlength="160" value="${structureEscape(settings.pattern)}" /><small>Доступны {Фамилия}, {Имя}, {Отчество}, {Ф}, {И}, {О}.</small></label>
        <output data-row-name-preview></output>
      </div>`;
  }

  function rowEditorCard(element, index) {
    const existing = rowEditorExistingField(element);
    const group = rowEditorSuggestedGroup(element, existing);
    const selected = rowEditorSuggestedMode(element, existing, group);
    const header = rowEditorHeader(element) || `Колонка ${index + 1}`;
    const settings = rowEditorNameSettings(existing, selected);
    return `
      <article class="roster-assistant-column${existing ? " is-linked" : ""}" data-row-editor-column data-element-id="${structureEscape(element.id)}" data-existing-field-id="${structureEscape(existing?.id || "")}">
        <span class="roster-assistant-column-number">${index + 1}</span>
        <div class="roster-assistant-column-body">
          <div class="row-editor-column-title"><strong>${structureEscape(header)}</strong><p>${structureEscape(element.text || "Пустая ячейка")}</p>${existing ? `<span class="row-editor-saved">Сохранено: ${structureEscape(existing.label)}</span>` : ""}</div>
          ${rowEditorIsPerson() ? `<label><span>К кому относится колонка?</span><select data-row-editor-group>${structureGroupSelectOptions(group)}</select><small>Выбранный раздел ограничивает предложения и не смешивает поля преподавателей со студентами.</small></label>` : `<input data-row-editor-group type="hidden" value="common" />`}
          <label><span>Что подставлять?</span><select data-row-editor-mode data-searchable-select data-searchable-placeholder="Выберите поле" data-searchable-search-placeholder="Найти поле для колонки">${rowEditorPropertyOptions(selected, existing, group)}</select><small data-row-editor-mode-hint></small></label>
          <label class="structure-required-field row-editor-required"><input data-row-editor-required type="checkbox"${existing?.required ? " checked" : ""} /><span><strong>Обязательное</strong><small>Без значения выпуск будет остановлен.</small></span></label>
          <div class="roster-new-property" data-row-editor-new hidden>
            <label><span>Название поля</span><input data-row-editor-label type="text" maxlength="500" value="${structureEscape(header.startsWith("Колонка ") ? "" : header)}" placeholder="Например, Номер зачётной книжки" /></label>
            <label><span>Тип значения</span><select data-row-editor-type>${fieldTypeOptions()}</select></label>
            <small>${rowEditorIsPerson() ? "Новое поле будет создано один раз и появится в карточках участников." : "Новое поле будет создано один раз и станет доступно объектам выбранного типа."}</small>
          </div>
          ${rowEditorNameOptions(settings)}
        </div>
      </article>`;
  }

  function rowEditorUpdateNamePreview(card) {
    const section = card.querySelector("[data-row-editor-name]");
    const mode = card.querySelector("[data-row-editor-mode]")?.value || "skip";
    if (!section) return;
    section.hidden = mode !== "system:name";
    if (section.hidden) return;
    const presentation = card.querySelector("[data-row-name-presentation]")?.value || "full";
    const custom = card.querySelector("[data-row-name-custom]");
    if (custom) custom.hidden = presentation !== "custom";
    const pattern =
      presentation === "custom"
        ? card.querySelector("[data-row-name-pattern]")?.value || ""
        : structureNamePatterns[presentation] || "";
    const error = structureNamePatternError(pattern);
    const output = card.querySelector("[data-row-name-preview]");
    if (!output) return;
    if (error) {
      output.className = "is-error";
      output.textContent = error;
      return;
    }
    output.className = "";
    const values = {
      Фамилия: "Иванов",
      Имя: "Иван",
      Отчество: "Иванович",
      Ф: "И",
      И: "И",
      О: "И"
    };
    const rendered = pattern
      .replace(/\{([^{}]+)\}/gu, (_match, token) => values[token] || "")
      .replace(/\s+/gu, " ")
      .replace(/\s+([,.;:])/gu, "$1")
      .trim();
    output.textContent = `Пример результата: ${rendered}`;
  }

  function rowEditorRefreshModeOptions(card) {
    const group = card.querySelector("[data-row-editor-group]")?.value || "common";
    const element = structureReport?.elements?.find(
      (candidate) => candidate.id === card.dataset.elementId
    );
    const existing = rowEditorExistingField(element);
    const select = card.querySelector("[data-row-editor-mode]");
    if (!select || !element) return;
    const previous = select.value;
    const suggested = rowEditorSuggestedMode(element, existing, group);
    const available = new Set(
      rowEditorApplicableProperties(group, existing).map(
        (definition) => `existing:${definition.key}`
      )
    );
    const preserved =
      ["skip", "system:position", "system:name", "new"].includes(previous) ||
      available.has(previous) ||
      (existing && previous.startsWith("current:"));
    const selected = preserved ? previous : suggested;
    select.innerHTML = rowEditorPropertyOptions(selected, existing, group);
    select.value = selected;
    globalThis.docomatorSearchableSelect?.refresh(select);
    rowEditorUpdateCard(card);
  }

  function rowEditorUpdateCard(card) {
    const mode = card.querySelector("[data-row-editor-mode]")?.value || "skip";
    const newFields = card.querySelector("[data-row-editor-new]");
    if (newFields) newFields.hidden = mode !== "new";
    const required = card.querySelector("[data-row-editor-required]");
    if (required) required.disabled = mode === "skip";
    const hint = card.querySelector("[data-row-editor-mode-hint]");
    if (hint) {
      hint.textContent =
        mode === "skip"
          ? card.dataset.existingFieldId
            ? "Сохранённая связь будет удалена после подтверждения."
            : "Колонка останется без изменений."
          : mode === "system:position"
            ? rowEditorIsPerson()
              ? "Система сама проставит 1, 2, 3… по порядку участников."
              : "Система сама проставит 1, 2, 3… по порядку объектов."
            : mode === "system:name"
              ? rowEditorIsPerson()
                ? "ФИО берётся из имени карточки и приводится к выбранному виду."
                : "Будет использовано отображаемое название объекта."
              : mode === "new"
                ? rowEditorIsPerson()
                  ? `Будет создано поле в разделе «${globalThis.docomatorFieldGroups.label(card.querySelector("[data-row-editor-group]")?.value || "common")}».`
                  : "Будет создано поле выбранного типа объектов."
                : rowEditorIsPerson()
                  ? "Значение будет взято из выбранного поля карточки."
                  : "Значение будет взято из выбранного поля объекта.";
    }
    rowEditorUpdateNamePreview(card);
    rowEditorUpdateSummary();
  }

  function rowEditorUpdateSummary() {
    const panel = document.querySelector("#rowEditorPanel");
    if (!panel) return;
    const cards = [...panel.querySelectorAll("[data-row-editor-column]")];
    const active = cards.filter(
      (card) => card.querySelector("[data-row-editor-mode]")?.value !== "skip"
    ).length;
    const changed = cards.filter((card) => {
      const current = rowEditorExistingMode(
        rowEditorExistingField(
          structureReport?.elements?.find(
            (element) => element.id === card.dataset.elementId
          )
        )
      );
      return (card.querySelector("[data-row-editor-mode]")?.value || "skip") !== (current || "skip");
    }).length;
    const summary = panel.querySelector("#rowEditorSummary");
    if (summary) {
      summary.textContent = `${active} из ${cards.length} колонок будут заполняться${changed ? ` · изменено настроек: ${changed}` : ""}.`;
    }
    const button = panel.querySelector("#rowEditorSave");
    if (button && !rowEditorBusy) button.disabled = active === 0;
  }

  function rowEditorPersonName(card) {
    if (!rowEditorIsPerson()) return undefined;
    if (card.querySelector("[data-row-editor-mode]")?.value !== "system:name") {
      return undefined;
    }
    const presentation = card.querySelector("[data-row-name-presentation]")?.value || "full";
    const pattern =
      presentation === "custom"
        ? card.querySelector("[data-row-name-pattern]")?.value?.trim() || ""
        : structureNamePatterns[presentation] || "";
    const error = structureNamePatternError(pattern);
    if (error) throw new Error(error);
    return {
      sourceOrder:
        card.querySelector("[data-row-name-source]")?.value ||
        "family-given-patronymic",
      pattern
    };
  }

  async function rowEditorDefinition(card, element, existing) {
    const mode = card.querySelector("[data-row-editor-mode]")?.value || "skip";
    const fieldGroup = card.querySelector("[data-row-editor-group]")?.value || "common";
    if (mode === "system:position") {
      return { key: "subject.position", label: "Номер строки", valueType: "integer" };
    }
    if (mode === "system:name") {
      return structureEffectiveDefinition(
        {
          key: "__system_display_name__",
          label: rowEditorIsPerson() ? "ФИО сотрудника" : "Название объекта",
          valueType: "string",
          systemSource: "display-name"
        },
        element
      );
    }
    if (mode.startsWith("existing:")) {
      const key = mode.slice("existing:".length);
      const definition = structurePropertyDefinitions.find(
        (candidate) => candidate.key === key
      );
      if (!definition) throw new Error("Выбранное поле карточки больше не найдено. Обновите страницу.");
      if (rowEditorIsPerson() && structurePropertyGroup(definition) === "unassigned" && fieldGroup !== "unassigned") {
        const classified = await structureFetchJson(
          `/api/v1/knowledge/property-definitions/${encodeURIComponent(definition.key)}/group`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ uiGroup: fieldGroup })
          }
        );
        const index = structurePropertyDefinitions.findIndex(
          (candidate) => candidate.key === definition.key
        );
        if (index >= 0) structurePropertyDefinitions[index] = classified.data;
        return classified.data;
      }
      return definition;
    }
    if (mode.startsWith("current:") && existing) {
      return { key: existing.key, label: existing.label, valueType: existing.valueType };
    }
    if (mode !== "new") return null;
    if (rowEditorIsPerson() && fieldGroup === "unassigned") {
      throw new Error(
        "Для нового поля выберите конкретный раздел: общие сведения, преподаватель или студент."
      );
    }
    const label = card.querySelector("[data-row-editor-label]")?.value?.trim() || "";
    const valueType = card.querySelector("[data-row-editor-type]")?.value || "string";
    if (!label) throw new Error("Укажите название нового поля для выбранной колонки.");
    const matches = structurePropertyDefinitions.filter(
      (candidate) =>
        rowEditorNormalize(candidate.label) === rowEditorNormalize(label) &&
        (rowEditorIsPerson()
          ? structurePropertyGroup(candidate) === fieldGroup
          : (candidate.appliesTo || []).includes(rowEditorEntityTypeKey()))
    );
    if (matches.length > 1) {
      throw new Error(
        `Найдено несколько полей «${label}». Выберите существующее поле из списка.`
      );
    }
    if (matches[0]) {
      if (matches[0].valueType !== valueType) {
        throw new Error(
          `Поле «${label}» уже существует с другим типом значения.`
        );
      }
      return matches[0];
    }
    const created = await structureFetchJson("/api/v1/knowledge/property-definitions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label,
        valueType,
        sensitivity: rowEditorIsPerson() ? "personal" : "internal",
        appliesTo: [rowEditorEntityTypeKey()],
        validation: rowEditorIsPerson() ? { uiGroup: fieldGroup } : {}
      })
    });
    const definition = created.data;
    if (!structurePropertyDefinitions.some((candidate) => candidate.key === definition.key)) {
      structurePropertyDefinitions.push(definition);
    }
    return definition;
  }

  function rowEditorExistingFormat(existing, definition) {
    if (!existing || existing.key !== definition.key || existing.valueType !== definition.valueType) {
      return {};
    }
    if (
      definition.valueType === "number" &&
      existing.formatter?.kind === "number.ru" &&
      existing.formatter.fractionDigits !== null &&
      existing.formatter.fractionDigits !== undefined
    ) {
      return { decimalPlaces: existing.formatter.fractionDigits };
    }
    if (
      definition.valueType === "date-time" &&
      existing.formatter?.kind === "date-time.ru" &&
      existing.formatter.timeZone
    ) {
      return { timeZone: existing.formatter.timeZone };
    }
    return {};
  }

  async function rowEditorLatestDraft(spaceId, draftId) {
    const body = await structureFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draftId)}`
    );
    return body.data;
  }

  async function rowEditorSave() {
    if (rowEditorBusy) return;
    const panel = document.querySelector("#rowEditorPanel");
    const button = panel?.querySelector("#rowEditorSave");
    const errorBox = panel?.querySelector("#rowEditorError");
    if (!panel || !button || !errorBox || !selectedStructureElement) return;
    const cards = [...panel.querySelectorAll("[data-row-editor-column]")];
    const active = cards.filter(
      (card) => card.querySelector("[data-row-editor-mode]")?.value !== "skip"
    );
    if (active.length === 0) {
      errorBox.hidden = false;
      errorBox.textContent = "Выберите хотя бы одну колонку для заполнения. Сохранённые связи учитываются автоматически.";
      return;
    }

    rowEditorBusy = true;
    button.disabled = true;
    button.textContent = "Сохраняем всю строку…";
    errorBox.hidden = true;
    try {
      const { spaceId, draft } = await loadStructureDraft();
      let latest = await rowEditorLatestDraft(spaceId, draft.id);
      let repeatExists = Boolean(latest.repeatBinding);
      let createdCount = 0;
      let updatedCount = 0;
      let deletedCount = 0;

      for (const card of cards) {
        const element = structureReport.elements.find(
          (candidate) => candidate.id === card.dataset.elementId
        );
        if (!element) throw new Error("Не найдена одна из ячеек строки. Постройте структуру заново.");
        const existing = latest.fields.find((field) => field.elementId === element.id) || null;
        const mode = card.querySelector("[data-row-editor-mode]")?.value || "skip";
        if (mode === "skip") {
          if (existing) {
            const deleted = await structureFetchJson(
              `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draft.id)}/fields/${encodeURIComponent(existing.id)}`,
              { method: "DELETE" }
            );
            deletedCount += 1;
            latest.fields = latest.fields.filter((field) => field.id !== existing.id);
            if (deleted.data.repeatBindingCleared) repeatExists = false;
          }
          continue;
        }
        const definition = await rowEditorDefinition(card, element, existing);
        if (!definition) continue;
        const personName = rowEditorPersonName(card);
        const payload = {
          key: definition.key,
          label: definition.label,
          valueType: definition.valueType,
          required: Boolean(card.querySelector("[data-row-editor-required]")?.checked),
          ...rowEditorExistingFormat(existing, definition),
          ...(personName === undefined ? {} : { personName })
        };
        if (existing) {
          const body = await structureFetchJson(
            `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draft.id)}/fields/${encodeURIComponent(existing.id)}`,
            {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload)
            }
          );
          const index = latest.fields.findIndex((field) => field.id === existing.id);
          if (index >= 0) latest.fields[index] = body.data.field;
          updatedCount += 1;
        } else {
          const body = await structureFetchJson(
            `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draft.id)}/fields`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                ...payload,
                elementId: element.id,
                repeatRow: !repeatExists
              })
            }
          );
          latest.fields.push(body.data.field);
          repeatExists = true;
          createdCount += 1;
        }
      }

      latest = await rowEditorLatestDraft(spaceId, draft.id);
      structureDraft = latest;
      panel.innerHTML = `
        <div class="roster-assistant-finished"><span aria-hidden="true">✓</span><div><h3>Строка сохранена</h3><p>Заполняются ${latest.fields.length} полей. Создано: ${createdCount}, изменено: ${updatedCount}, удалено: ${deletedCount}. При сводном выпуске эта строка повторится для каждого ${rowEditorIsPerson() ? "участника" : "объекта"}.</p></div></div>
        <div class="roster-assistant-actions"><button class="secondary-button" id="rowEditorContinueEditing" type="button">Вернуться к строке</button><button class="primary-button" id="rowEditorContinueTrial" type="button">Перейти к проверке шаблона</button></div>`;
      panel.querySelector("#rowEditorContinueEditing")?.addEventListener("click", () =>
        rowEditorOpen(selectedStructureElement)
      );
      panel
        .querySelector("#rowEditorContinueTrial")
        ?.addEventListener("click", async (event) => {
          const continueButton = event.currentTarget;
          continueButton.disabled = true;
          continueButton.textContent = "Готовим общую проверку…";
          const ready = await globalThis.docomatorMultiTrial?.reload?.();
          if (!ready) {
            errorBox.hidden = false;
            errorBox.textContent =
              "Форму общей проверки подготовить не удалось. Повторите действие.";
            continueButton.disabled = false;
            continueButton.textContent = "Перейти к проверке шаблона";
            return;
          }
          globalThis.docomatorTemplateWizard?.complete(2, {
            sourceId: latest.sourceRecordId || structureWizardArtifacts().sourceId,
            draftId: draft.id
          });
        });
      window.dispatchEvent(
        new CustomEvent("docomator:template-draft-changed", {
          detail: { spaceId, draftId: draft.id, fieldCount: latest.fields.length }
        })
      );
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent = error?.message || "Строку сохранить не удалось. Настройки остались в форме.";
      button.disabled = false;
      button.textContent = "Сохранить настройки строки";
    } finally {
      rowEditorBusy = false;
    }
  }

  function rowEditorRestoreSingleFieldForm() {
    const form = document.querySelector("#documentFieldForm");
    const entry = document.querySelector("#rowEditorEntry");
    if (form) form.hidden = false;
    if (entry) entry.hidden = false;
  }

  function rowEditorClosePanel() {
    document.querySelector("#rowEditorPanel")?.remove();
    rowEditorRestoreSingleFieldForm();
  }

  function rowEditorOpen(element) {
    document.querySelector("#rosterAssistantPanel")?.remove();
    document.querySelector("#rowEditorPanel")?.remove();
    const rows = rowEditorElements(element);
    const detail = document.querySelector("#documentStructureSelection");
    if (!detail || rows.length < 2) return;
    const panel = document.createElement("section");
    panel.id = "rowEditorPanel";
    panel.className = "roster-assistant-panel row-editor-panel";
    panel.innerHTML = `
      <div class="roster-assistant-heading"><div><p class="eyebrow">Таблица Word</p><h3>${structureDraft?.repeatBinding ? "Изменить повторяемую строку" : rowEditorIsPerson() ? "Настроить строку для списка участников" : "Настроить строку для списка объектов"}</h3><p>Для каждой колонки выберите источник значения. Уже сохранённые связи загружены в форму и могут быть изменены.</p></div><button class="icon-button" id="rowEditorClose" type="button" aria-label="Закрыть">×</button></div>
      <div class="row-editor-explanation"><strong>Как это работает</strong><ol><li>В этой строке задаются колонки будущего списка.</li><li>При сводном выпуске Word скопирует строку по одному разу для каждого ${rowEditorIsPerson() ? "участника группы" : "объекта группы"}.</li><li>Поля берутся из карточки ${rowEditorIsPerson() ? "участника" : "объекта"}; номер строки система считает сама.</li></ol></div>
      <p id="rowEditorSummary" class="row-editor-summary"></p>
      <div class="roster-assistant-columns">${rows.map(rowEditorCard).join("")}</div>
      <div class="roster-assistant-preview"><span aria-hidden="true">✓</span><div><strong>Ожидаемый результат</strong><p>Заголовок таблицы останется один раз, а настроенная строка повторится по числу выбранных ${rowEditorIsPerson() ? "участников" : "объектов"}.</p></div></div>
      <div class="form-error" id="rowEditorError" role="alert" hidden></div>
      <div class="roster-assistant-actions"><button class="secondary-button" id="rowEditorCancel" type="button">Отмена</button><button class="primary-button" id="rowEditorSave" type="button">Сохранить настройки строки</button></div>`;
    detail.prepend(panel);
    const singleFieldForm = detail.querySelector("#documentFieldForm");
    const entry = detail.querySelector("#rowEditorEntry");
    if (singleFieldForm) singleFieldForm.hidden = true;
    if (entry) entry.hidden = true;
    panel.querySelector("#rowEditorClose")?.addEventListener("click", rowEditorClosePanel);
    panel.querySelector("#rowEditorCancel")?.addEventListener("click", rowEditorClosePanel);
    panel.querySelector("#rowEditorSave")?.addEventListener("click", rowEditorSave);
    globalThis.docomatorSearchableSelect?.enhanceAll(panel);
    panel.querySelectorAll("[data-row-editor-column]").forEach((card) => {
      card.querySelector("[data-row-editor-group]")?.addEventListener("change", () => rowEditorRefreshModeOptions(card));
      card.querySelector("[data-row-editor-mode]")?.addEventListener("change", () => rowEditorUpdateCard(card));
      card.querySelector("[data-row-name-presentation]")?.addEventListener("change", () => rowEditorUpdateNamePreview(card));
      card.querySelector("[data-row-name-source]")?.addEventListener("change", () => rowEditorUpdateNamePreview(card));
      card.querySelector("[data-row-name-pattern]")?.addEventListener("input", () => rowEditorUpdateNamePreview(card));
      rowEditorUpdateCard(card);
    });
    rowEditorUpdateSummary();
    panel.scrollIntoView({ block: "nearest" });
  }

  function rowEditorInstallEntry(element) {
    document.querySelector("#rosterAssistantEntry")?.remove();
    const rows = rowEditorElements(element);
    const detail = document.querySelector("#documentStructureSelection");
    if (!detail || rows.length < 2) return;
    const linked = rows.filter((row) => rowEditorExistingField(row)).length;
    const entry = document.createElement("section");
    entry.id = "rowEditorEntry";
    entry.className = "roster-assistant-entry";
    entry.innerHTML = `
      <div><strong>${linked ? `Строка уже настроена: ${linked} из ${rows.length} колонок` : rowEditorIsPerson() ? "Заполнить всю строку как список участников" : "Заполнить всю строку как список объектов"}</strong><p>${linked ? (rowEditorIsPerson() ? "Откройте редактор, чтобы изменить поле, формат ФИО, обязательность или исключить колонку." : "Откройте редактор, чтобы изменить поле, обязательность или исключить колонку.") : rowEditorIsPerson() ? "Удобно для реестров, списков студентов и таблиц сотрудников: одна настройка для всех колонок строки." : "Подходит для реестров аудиторий, статей, оборудования и других однотипных объектов."}</p></div>
      <button class="secondary-button" id="rowEditorOpen" type="button">${linked ? "Изменить строку" : "Настроить строку"}</button>`;
    detail.prepend(entry);
    entry.querySelector("#rowEditorOpen")?.addEventListener("click", () => rowEditorOpen(element));
  }

  const rowEditorBaseRenderSelection = renderStructureSelection;
  renderStructureSelection = function renderStructureSelectionWithRowEditor(element) {
    rowEditorBaseRenderSelection(element);
    rowEditorInstallEntry(element);
  };
}
