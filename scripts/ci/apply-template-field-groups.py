from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one occurrence, found {count}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {relative}")


def insert_before(relative: str, marker: str, addition: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    if addition in value:
        return
    count = value.count(marker)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one marker, found {count}")
    path.write_text(value.replace(marker, addition + marker, 1), encoding="utf-8")
    print(f"updated {relative}")


# Single-field template mapping.
insert_before(
    "apps/api/ui/document-structure.js",
    "function structureSelectedDefinition(propertyKey = document.querySelector(\"#documentFieldProperty\")?.value || \"\") {",
    '''function structurePropertyGroup(definition) {
  return globalThis.docomatorFieldGroups.key(definition);
}

function structureHeaderForElement(element) {
  const location = element?.tableLocation;
  if (!location || location.rowIndex < 1) return "";
  const previous = (structureReport?.elements || []).find(
    (candidate) =>
      candidate.kind === "paragraph" &&
      candidate.part === element.part &&
      candidate.tableLocation?.tableIndex === location.tableIndex &&
      candidate.tableLocation?.rowIndex === location.rowIndex - 1 &&
      candidate.tableLocation?.columnIndex === location.columnIndex &&
      String(candidate.text || "").trim() !== ""
  );
  return String(previous?.text || "").trim();
}

function structureInferredFieldGroup(element) {
  return globalThis.docomatorFieldGroups.infer(
    `${structureHeaderForElement(element)} ${structurePreview(element)} ${structureDraft?.title || ""}`
  );
}

function structureGroupSelectOptions(selected) {
  return globalThis.docomatorFieldGroups.options(selected, { includeUnassigned: true });
}

'''
)

replace_once(
    "apps/api/ui/document-structure.js",
    '''function structurePropertyOptions() {
  const applicable = structurePropertyDefinitions.filter((definition) => {
    const appliesTo = Array.isArray(definition.appliesTo) ? definition.appliesTo : [];
    return appliesTo.length === 0 || appliesTo.includes("person");
  });
  const cardOptions = applicable
    .map(
      (definition) =>
        `<option value="${structureEscape(definition.key)}">${structureEscape(definition.label)} · ${structureEscape(structureFieldTypeLabel(definition.valueType))}</option>`
    )
    .join("");
  return [
    '<optgroup label="Основные сведения">',
    '<option value="__system_display_name__">ФИО сотрудника · с выбором варианта записи</option>',
    "</optgroup>",
    ...(cardOptions ? ['<optgroup label="Поля карточки">', cardOptions, "</optgroup>"] : []),
    '<option value="__new__">Добавить новое поле сотрудника…</option>'
  ].join("");
}''',
    '''function structurePropertyOptions(selectedGroup = "common") {
  const applicable = structurePropertyDefinitions
    .filter((definition) => {
      const appliesTo = Array.isArray(definition.appliesTo) ? definition.appliesTo : [];
      return appliesTo.length === 0 || appliesTo.includes("person");
    })
    .filter((definition) =>
      globalThis.docomatorFieldGroups.allowed(definition, selectedGroup, {
        includeUnassigned: true
      })
    );
  const grouped = globalThis.docomatorFieldGroups.grouped(
    applicable,
    selectedGroup,
    { includeUnassigned: true }
  );
  const order = [...new Set(["common", selectedGroup, "unassigned"])];
  return [
    '<optgroup label="Системные значения">',
    '<option value="__system_display_name__" data-search-terms="фио имя фамилия инициалы">ФИО участника · с выбором варианта записи</option>',
    "</optgroup>",
    ...order
      .filter((group) => grouped.get(group)?.length)
      .map(
        (group) =>
          `<optgroup label="${structureEscape(globalThis.docomatorFieldGroups.label(group))}">${grouped
            .get(group)
            .map(
              (definition) =>
                `<option value="${structureEscape(definition.key)}" data-search-terms="${structureEscape(`${definition.label} ${(definition.aliases || []).join(" ")}`)}">${structureEscape(definition.label)} · ${structureEscape(structureFieldTypeLabel(definition.valueType))}</option>`
            )
            .join("")}</optgroup>`
      ),
    '<optgroup label="Действия"><option value="__new__">Создать новое поле в выбранном разделе…</option></optgroup>'
  ].join("");
}

function refreshStructurePropertySelector() {
  const group = document.querySelector("#documentFieldGroup")?.value || "common";
  const select = document.querySelector("#documentFieldProperty");
  if (!select) return;
  const previous = select.value;
  select.innerHTML = structurePropertyOptions(group);
  if ([...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
  globalThis.docomatorSearchableSelect?.refresh(select);
  renderNewStructurePropertyFields();
}'''
)

replace_once(
    "apps/api/ui/document-structure.js",
    '''          <label>
            <span>Какое поле сотрудника поставить сюда?</span>
            <select id="documentFieldProperty" name="propertyKey">${structurePropertyOptions()}</select>
            <small>Для ФИО доступны полная запись, фамилия, инициалы и собственный безопасный шаблон.</small>
          </label>''',
    '''          <label>
            <span>К кому относится значение?</span>
            <select id="documentFieldGroup" name="fieldGroup">${structureGroupSelectOptions(structureInferredFieldGroup(element))}</select>
            <small>Преподавательские и студенческие поля хранятся раздельно, даже если называются одинаково.</small>
          </label>
          <label>
            <span>Какое поле поставить сюда?</span>
            <select id="documentFieldProperty" name="propertyKey" data-searchable-select data-searchable-placeholder="Выберите поле" data-searchable-search-placeholder="Найти поле по названию">${structurePropertyOptions(structureInferredFieldGroup(element))}</select>
            <small>Список сгруппирован по назначению. Введите часть названия, чтобы быстро найти нужное поле.</small>
          </label>'''
)
replace_once(
    "apps/api/ui/document-structure.js",
    '''  detail
    .querySelector("#documentFieldProperty")
    ?.addEventListener("change", renderNewStructurePropertyFields);''',
    '''  detail
    .querySelector("#documentFieldGroup")
    ?.addEventListener("change", refreshStructurePropertySelector);
  detail
    .querySelector("#documentFieldProperty")
    ?.addEventListener("change", renderNewStructurePropertyFields);
  globalThis.docomatorSearchableSelect?.enhanceAll(detail);'''
)
replace_once(
    "apps/api/ui/document-structure.js",
    '''  const propertyKey = form.querySelector("#documentFieldProperty")?.value || "";
  if (!propertyKey) return "Выберите поле сотрудника.";
  if (propertyKey === "__new__") {''',
    '''  const propertyKey = form.querySelector("#documentFieldProperty")?.value || "";
  const fieldGroup = form.querySelector("#documentFieldGroup")?.value || "common";
  if (!propertyKey) return "Выберите поле сотрудника.";
  if (propertyKey === "__new__" && fieldGroup === "unassigned") {
    return "Для нового поля выберите конкретный раздел: общие сведения, преподаватель или студент.";
  }
  if (propertyKey === "__new__") {'''
)
replace_once(
    "apps/api/ui/document-structure.js",
    '''  const propertyKey = form.querySelector("#documentFieldProperty")?.value || "";
  let definition = structureSelectedDefinition(propertyKey);
  const label = form.querySelector("#documentFieldLabel")?.value?.trim() || "";''',
    '''  const propertyKey = form.querySelector("#documentFieldProperty")?.value || "";
  const fieldGroup = form.querySelector("#documentFieldGroup")?.value || "common";
  let definition = structureSelectedDefinition(propertyKey);
  const label = form.querySelector("#documentFieldLabel")?.value?.trim() || "";'''
)
replace_once(
    "apps/api/ui/document-structure.js",
    '''          candidate.label.trim().toLocaleLowerCase("ru-RU") ===
          label.toLocaleLowerCase("ru-RU")''',
    '''          candidate.label.trim().toLocaleLowerCase("ru-RU") ===
            label.toLocaleLowerCase("ru-RU") &&
          structurePropertyGroup(candidate) === fieldGroup'''
)
replace_once(
    "apps/api/ui/document-structure.js",
    '''              appliesTo: ["person"],
              sensitivity: "personal"''',
    '''              appliesTo: ["person"],
              sensitivity: "personal",
              validation: { uiGroup: fieldGroup }'''
)
insert_before(
    "apps/api/ui/document-structure.js",
    '''    if (!definition) throw { message: "Выбранное поле сотрудника не найдено." };''',
    '''    if (
      definition &&
      !definition.systemSource &&
      structurePropertyGroup(definition) === "unassigned" &&
      fieldGroup !== "unassigned"
    ) {
      const classified = await structureFetchJson(
        `/api/v1/knowledge/property-definitions/${encodeURIComponent(definition.key)}/group`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uiGroup: fieldGroup })
        }
      );
      definition = classified.data;
      const index = structurePropertyDefinitions.findIndex(
        (candidate) => candidate.key === definition.key
      );
      if (index >= 0) structurePropertyDefinitions[index] = definition;
    }
'''
)

# Whole-row editor: a group per column, group-limited auto suggestions and searchable choices.
insert_before(
    "apps/api/ui/template-row-editor-v2.js",
    "  function rowEditorSuggestedMode(element, existing) {",
    '''  function rowEditorSuggestedGroup(element, existing) {
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
        (appliesTo.length === 0 || appliesTo.includes("person")) &&
        (definition.key === existingKey ||
          globalThis.docomatorFieldGroups.allowed(definition, group, {
            includeUnassigned: true
          }))
      );
    });
  }

'''
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''  function rowEditorSuggestedMode(element, existing) {
    if (existing) return rowEditorExistingMode(existing);
    const header = rowEditorHeader(element);
    const semantic = rowEditorSemantic(header);
    if (semantic === "position") return "system:position";
    if (semantic === "name") return "system:name";
    const best = structurePropertyDefinitions
      .map((definition) => ({
        definition,
        score: rowEditorPropertyScore(header, definition)
      }))
      .sort((left, right) => right.score - left.score)[0];
    if (best?.score >= 0.82) return `existing:${best.definition.key}`;
    return semantic === "unknown" ? "skip" : "new";
  }

  function rowEditorPropertyOptions(selected, existing) {
    const applicable = structurePropertyDefinitions.filter((definition) => {
      const appliesTo = Array.isArray(definition.appliesTo)
        ? definition.appliesTo
        : [];
      return appliesTo.length === 0 || appliesTo.includes("person");
    });
    const options = [
      ["skip", "Не заполнять эту колонку"],
      ["system:position", "Номер строки · 1, 2, 3…"],
      ["system:name", "ФИО участника · с выбором записи"],
      ...applicable.map((definition) => [
        `existing:${definition.key}`,
        `${definition.label} · ${structureFieldTypeLabel(definition.valueType)}`
      ]),
      ["new", "Создать новое поле карточки…"]
    ];
    if (
      existing &&
      selected.startsWith("current:") &&
      !options.some(([value]) => value === selected)
    ) {
      options.splice(options.length - 1, 0, [
        selected,
        `Сохранённая связь: ${existing.label}`
      ]);
    }
    return options
      .map(
        ([value, label]) =>
          `<option value="${structureEscape(value)}"${value === selected ? " selected" : ""}>${structureEscape(label)}</option>`
      )
      .join("");
  }''',
    '''  function rowEditorSuggestedMode(element, existing, group) {
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
    const grouped = globalThis.docomatorFieldGroups.grouped(
      applicable,
      group,
      { includeUnassigned: true }
    );
    const order = [...new Set(["common", group, "unassigned"])];
    const options = [
      '<optgroup label="Управление колонкой">',
      `<option value="skip"${selected === "skip" ? " selected" : ""}>Не заполнять эту колонку</option>`,
      `<option value="system:position"${selected === "system:position" ? " selected" : ""}>Номер строки · 1, 2, 3…</option>`,
      `<option value="system:name"${selected === "system:name" ? " selected" : ""}>ФИО участника · с выбором записи</option>`,
      "</optgroup>",
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
        ),
      `<optgroup label="Действия"><option value="new"${selected === "new" ? " selected" : ""}>Создать новое поле в разделе «${structureEscape(globalThis.docomatorFieldGroups.label(group))}»…</option></optgroup>`
    ];
    if (existing && selected.startsWith("current:")) {
      options.splice(options.length - 1, 0, `<optgroup label="Сохранённая связь"><option value="${structureEscape(selected)}" selected>${structureEscape(existing.label)}</option></optgroup>`);
    }
    return options.join("");
  }'''
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''  function rowEditorCard(element, index) {
    const existing = rowEditorExistingField(element);
    const selected = rowEditorSuggestedMode(element, existing);
    const header = rowEditorHeader(element) || `Колонка ${index + 1}`;
    const settings = rowEditorNameSettings(existing, selected);
    return `
      <article class="roster-assistant-column${existing ? " is-linked" : ""}" data-row-editor-column data-element-id="${structureEscape(element.id)}" data-existing-field-id="${structureEscape(existing?.id || "")}">
        <span class="roster-assistant-column-number">${index + 1}</span>
        <div class="roster-assistant-column-body">
          <div class="row-editor-column-title"><strong>${structureEscape(header)}</strong><p>${structureEscape(element.text || "Пустая ячейка")}</p>${existing ? `<span class="row-editor-saved">Сохранено: ${structureEscape(existing.label)}</span>` : ""}</div>
          <label><span>Что подставлять?</span><select data-row-editor-mode>${rowEditorPropertyOptions(selected, existing)}</select><small data-row-editor-mode-hint></small></label>''',
    '''  function rowEditorCard(element, index) {
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
          <label><span>К кому относится колонка?</span><select data-row-editor-group>${structureGroupSelectOptions(group)}</select><small>Выбранный раздел ограничивает предложения и не смешивает поля преподавателей со студентами.</small></label>
          <label><span>Что подставлять?</span><select data-row-editor-mode data-searchable-select data-searchable-placeholder="Выберите поле" data-searchable-search-placeholder="Найти поле для колонки">${rowEditorPropertyOptions(selected, existing, group)}</select><small data-row-editor-mode-hint></small></label>'''
)
insert_before(
    "apps/api/ui/template-row-editor-v2.js",
    "  function rowEditorUpdateCard(card) {",
    '''  function rowEditorRefreshModeOptions(card) {
    const group = card.querySelector("[data-row-editor-group]")?.value || "common";
    const element = structureReport?.elements?.find(
      (candidate) => candidate.id === card.dataset.elementId
    );
    const existing = rowEditorExistingField(element);
    const select = card.querySelector("[data-row-editor-mode]");
    if (!select || !element) return;
    const previous = select.value;
    const suggested = rowEditorSuggestedMode(element, existing, group);
    select.innerHTML = rowEditorPropertyOptions(previous || suggested, existing, group);
    if (![...select.options].some((option) => option.value === select.value)) {
      select.value = suggested;
    }
    globalThis.docomatorSearchableSelect?.refresh(select);
    rowEditorUpdateCard(card);
  }

'''
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''  async function rowEditorDefinition(card, element, existing) {
    const mode = card.querySelector("[data-row-editor-mode]")?.value || "skip";''',
    '''  async function rowEditorDefinition(card, element, existing) {
    const mode = card.querySelector("[data-row-editor-mode]")?.value || "skip";
    const fieldGroup = card.querySelector("[data-row-editor-group]")?.value || "common";'''
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''      if (!definition) throw new Error("Выбранное поле карточки больше не найдено. Обновите страницу.");
      return definition;''',
    '''      if (!definition) throw new Error("Выбранное поле карточки больше не найдено. Обновите страницу.");
      if (structurePropertyGroup(definition) === "unassigned" && fieldGroup !== "unassigned") {
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
      return definition;'''
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''        rowEditorNormalize(candidate.label) === rowEditorNormalize(label)
    );''',
    '''        rowEditorNormalize(candidate.label) === rowEditorNormalize(label) &&
        structurePropertyGroup(candidate) === fieldGroup
    );'''
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''        sensitivity: "personal",
        appliesTo: ["person"]''',
    '''        sensitivity: "personal",
        appliesTo: ["person"],
        validation: { uiGroup: fieldGroup }'''
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''    panel.querySelectorAll("[data-row-editor-column]").forEach((card) => {
      card.querySelector("[data-row-editor-mode]")?.addEventListener("change", () => rowEditorUpdateCard(card));''',
    '''    globalThis.docomatorSearchableSelect?.enhanceAll(panel);
    panel.querySelectorAll("[data-row-editor-column]").forEach((card) => {
      card.querySelector("[data-row-editor-group]")?.addEventListener("change", () => rowEditorRefreshModeOptions(card));
      card.querySelector("[data-row-editor-mode]")?.addEventListener("change", () => rowEditorUpdateCard(card));'''
)

print("template field groups patches applied")
