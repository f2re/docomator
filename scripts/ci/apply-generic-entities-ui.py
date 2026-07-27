from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_file_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(
            f"{relative}: expected one occurrence, found {count}: {old[:160]!r}"
        )
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {relative}")


parts = [ROOT / f"scripts/ci/entity-workspace.part{index}" for index in range(1, 5)]
entity_workspace = "".join(path.read_text(encoding="utf-8") for path in parts)
(ROOT / "apps/api/ui/entity-workspace.js").write_text(entity_workspace, encoding="utf-8")
print("assembled apps/api/ui/entity-workspace.js")

replace_file_once(
    "apps/api/src/ui-routes.ts",
    '''      "searchable-select.css",
      "spaces.css",''',
    '''      "searchable-select.css",
      "entity-workspace.css",
      "spaces.css",'''
)
replace_file_once(
    "apps/api/src/ui-routes.ts",
    '''      "searchable-select.js",
      "app.js",
      "operator-workflows.js",''',
    '''      "searchable-select.js",
      "app.js",
      "entity-workspace.js",
      "operator-workflows.js",'''
)
replace_file_once(
    "apps/api/src/ui-routes.ts",
    '''      "document-structure.js",
      "template-placement-guidance.js",''',
    '''      "document-structure.js",
      "generic-template-entities.js",
      "template-placement-guidance.js",'''
)
replace_file_once(
    "apps/api/src/ui-routes.ts",
    '''      "document-generation.js",
      "document-generation-preflight.js",''',
    '''      "document-generation.js",
      "generic-document-generation.js",
      "document-generation-preflight.js",'''
)

replace_file_once(
    "apps/api/ui/index.html",
    '''          <button class="nav-item" type="button" data-view-target="employees">
            <span class="nav-symbol" aria-hidden="true">◎</span><span>Сотрудники</span>
          </button>
          <button class="nav-item" type="button" data-view-target="templates">''',
    '''          <button class="nav-item" type="button" data-view-target="employees">
            <span class="nav-symbol" aria-hidden="true">◎</span><span>Сотрудники</span>
          </button>
          <button class="nav-item" type="button" data-view-target="entities">
            <span class="nav-symbol" aria-hidden="true">◇</span><span>Объекты</span>
          </button>
          <button class="nav-item" type="button" data-view-target="templates">'''
)
replace_file_once(
    "apps/api/ui/index.html",
    '''          <div id="employeeList" class="employee-list" aria-live="polite"></div>
        </section>

        <section class="view" data-view="spaces" aria-labelledby="spaces-heading">''',
    '''          <div id="employeeList" class="employee-list" aria-live="polite"></div>
        </section>

        <section class="view" data-view="entities" aria-labelledby="entities-heading">
          <h2 class="visually-hidden" id="entities-heading">Объекты пространства</h2>
          <div id="entityWorkspace" aria-live="polite"></div>
        </section>

        <section class="view" data-view="spaces" aria-labelledby="spaces-heading">'''
)
replace_file_once(
    "apps/api/ui/index.html",
    '''<h2 id="spaces-heading">Разделы, участники и группы</h2><p>Разделы группируют участников, шаблоны и процессы.''',
    '''<h2 id="spaces-heading">Разделы, объекты и группы</h2><p>Разделы группируют объекты, шаблоны и процессы.'''
)
replace_file_once(
    "apps/api/ui/index.html",
    '''<button class="primary-button" type="button" data-create="space-entity">Добавить человека</button>''',
    '''<button class="primary-button" type="button" data-view-target="entities">Добавить объект</button>'''
)
replace_file_once(
    "apps/api/ui/index.html",
    '''<button type="button" role="tab" aria-selected="true" data-space-tab="members">Участники</button>''',
    '''<button type="button" role="tab" aria-selected="true" data-space-tab="members">Объекты</button>'''
)
replace_file_once(
    "apps/api/ui/index.html",
    '''<div><h2>Участники</h2><p>Отметьте людей для разового документа или будущей группы.</p></div>''',
    '''<div><h2>Объекты пространства</h2><p>Отметьте однотипные объекты для разового документа или будущей группы.</p></div>'''
)
replace_file_once(
    "apps/api/ui/index.html",
    '''<h2>Для кого формировать документ?</h2><p>Система фиксирует состав и строит исполнимый план.''',
    '''<h2>Для каких объектов формировать документ?</h2><p>Система фиксирует однородный состав и строит исполнимый план.'''
)
replace_file_once(
    "apps/api/ui/index.html",
    '''            <button class="settings-row" type="button" data-view-target="spaces"><span><strong>Разделы данных и группы</strong><small>Подразделения, проекты и сохранённые составы</small></span><span aria-hidden="true">›</span></button>
            <button class="settings-row" type="button" data-view-target="knowledge">''',
    '''            <button class="settings-row" type="button" data-view-target="spaces"><span><strong>Разделы данных и группы</strong><small>Проекты, пространства и сохранённые однородные составы</small></span><span aria-hidden="true">›</span></button>
            <button class="settings-row" type="button" data-view-target="entities"><span><strong>Типы объектов и импорт</strong><small>Аудитории, статьи, оборудование и другие произвольные записи</small></span><span aria-hidden="true">›</span></button>
            <button class="settings-row" type="button" data-view-target="knowledge">'''
)

PATH = ROOT / "apps/api/ui/template-row-editor-v2.js"
value = PATH.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global value
    count = value.count(old)
    if count != 1:
        raise RuntimeError(
            f"template-row-editor-v2.js: expected one occurrence, found {count}: {old[:160]!r}"
        )
    value = value.replace(old, new, 1)


replace_once(
    '''  let rowEditorBusy = false;

  function rowEditorNormalize(value) {''',
    '''  let rowEditorBusy = false;

  function rowEditorEntityTypeKey() {
    return globalThis.docomatorTemplateEntityTypeKey || "person";
  }

  function rowEditorIsPerson() {
    return rowEditorEntityTypeKey() === "person";
  }

  function rowEditorNormalize(value) {'''
)

replace_once(
    '''    if (/\\bфио\\b|фамил|полное имя|студент|сотрудник/u.test(value)) return "name";''',
    '''    if (/\\bфио\\b|фамил|полное имя|студент|сотрудник|назван|наимен|заголов/u.test(value)) return "name";'''
)

replace_once(
    '''  function rowEditorSuggestedGroup(element, existing) {
    if (existing) {''',
    '''  function rowEditorSuggestedGroup(element, existing) {
    if (!rowEditorIsPerson()) return "common";
    if (existing) {'''
)

replace_once(
    '''      return (
        (appliesTo.length === 0 || appliesTo.includes("person")) &&
        (definition.key === existingKey ||
          globalThis.docomatorFieldGroups.allowed(definition, group, {
            includeUnassigned: true
          }))
      );''',
    '''      return (
        (appliesTo.length === 0 || appliesTo.includes(rowEditorEntityTypeKey())) &&
        (definition.key === existingKey ||
          !rowEditorIsPerson() ||
          globalThis.docomatorFieldGroups.allowed(definition, group, {
            includeUnassigned: true
          }))
      );'''
)

start = value.index('  function rowEditorPropertyOptions(selected, existing, group) {')
end = value.index('\n  function rowEditorNameSettings', start)
new_function = '''  function rowEditorPropertyOptions(selected, existing, group) {
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
'''
value = value[:start] + new_function + value[end:]

replace_once(
    '''  function rowEditorNameSettings(field, selectedMode) {
    const formatter = field?.formatter;''',
    '''  function rowEditorNameSettings(field, selectedMode) {
    if (!rowEditorIsPerson()) {
      return { presentation: "identity", sourceOrder: "family-given-patronymic", pattern: "" };
    }
    const formatter = field?.formatter;'''
)

replace_once(
    '''  function rowEditorNameOptions(settings) {
    return `''',
    '''  function rowEditorNameOptions(settings) {
    if (!rowEditorIsPerson()) return "";
    return `'''
)

replace_once(
    '''          <label><span>К кому относится колонка?</span><select data-row-editor-group>${structureGroupSelectOptions(group)}</select><small>Выбранный раздел ограничивает предложения и не смешивает поля преподавателей со студентами.</small></label>''',
    '''          ${rowEditorIsPerson() ? `<label><span>К кому относится колонка?</span><select data-row-editor-group>${structureGroupSelectOptions(group)}</select><small>Выбранный раздел ограничивает предложения и не смешивает поля преподавателей со студентами.</small></label>` : `<input data-row-editor-group type="hidden" value="common" />`}'''
)

replace_once(
    '''            <small>Новое поле будет создано один раз и появится в карточках участников.</small>''',
    '''            <small>Новое поле будет создано один раз и станет доступно объектам выбранного типа.</small>'''
)

replace_once(
    '''            ? "Система сама проставит 1, 2, 3… по порядку участников."
            : mode === "system:name"
              ? "ФИО берётся из имени карточки и приводится к выбранному виду."
              : mode === "new"
                ? `Будет создано поле в разделе «${globalThis.docomatorFieldGroups.label(card.querySelector("[data-row-editor-group]")?.value || "common")}».`
                : "Значение будет взято из выбранного поля карточки.";''',
    '''            ? "Система сама проставит 1, 2, 3… по порядку объектов."
            : mode === "system:name"
              ? rowEditorIsPerson()
                ? "ФИО берётся из имени карточки и приводится к выбранному виду."
                : "Будет использовано отображаемое название объекта."
              : mode === "new"
                ? rowEditorIsPerson()
                  ? `Будет создано поле в разделе «${globalThis.docomatorFieldGroups.label(card.querySelector("[data-row-editor-group]")?.value || "common")}».`
                  : "Будет создано поле выбранного типа объектов."
                : "Значение будет взято из выбранного поля объекта.";'''
)

replace_once(
    '''  function rowEditorPersonName(card) {
    if (card.querySelector("[data-row-editor-mode]")?.value !== "system:name") {''',
    '''  function rowEditorPersonName(card) {
    if (!rowEditorIsPerson()) return undefined;
    if (card.querySelector("[data-row-editor-mode]")?.value !== "system:name") {'''
)

replace_once(
    '''          label: "ФИО участника",''',
    '''          label: rowEditorIsPerson() ? "ФИО участника" : "Название объекта",'''
)

replace_once(
    '''      if (structurePropertyGroup(definition) === "unassigned" && fieldGroup !== "unassigned") {''',
    '''      if (rowEditorIsPerson() && structurePropertyGroup(definition) === "unassigned" && fieldGroup !== "unassigned") {'''
)

replace_once(
    '''    if (fieldGroup === "unassigned") {''',
    '''    if (rowEditorIsPerson() && fieldGroup === "unassigned") {'''
)

replace_once(
    '''        rowEditorNormalize(candidate.label) === rowEditorNormalize(label) &&
        structurePropertyGroup(candidate) === fieldGroup''',
    '''        rowEditorNormalize(candidate.label) === rowEditorNormalize(label) &&
        (rowEditorIsPerson()
          ? structurePropertyGroup(candidate) === fieldGroup
          : (candidate.appliesTo || []).includes(rowEditorEntityTypeKey()))'''
)

replace_once(
    '''        sensitivity: "personal",
        appliesTo: ["person"],
        validation: { uiGroup: fieldGroup }''',
    '''        sensitivity: rowEditorIsPerson() ? "personal" : "internal",
        appliesTo: [rowEditorEntityTypeKey()],
        validation: rowEditorIsPerson() ? { uiGroup: fieldGroup } : {}'''
)

replace_once(
    '''При сводном выпуске эта строка повторится для каждого участника.''',
    '''При сводном выпуске эта строка повторится для каждого объекта.'''
)

replace_once(
    '''<h3>${structureDraft?.repeatBinding ? "Изменить повторяемую строку" : "Настроить строку для списка участников"}</h3>''',
    '''<h3>${structureDraft?.repeatBinding ? "Изменить повторяемую строку" : "Настроить строку для списка объектов"}</h3>'''
)

replace_once(
    '''<div class="row-editor-explanation"><strong>Как это работает</strong><ol><li>В этой строке задаются колонки будущего списка.</li><li>При сводном выпуске Word скопирует строку по одному разу для каждого участника группы.</li><li>Поля берутся из карточки участника; номер строки система считает сама.</li></ol></div>''',
    '''<div class="row-editor-explanation"><strong>Как это работает</strong><ol><li>В этой строке задаются колонки будущего списка.</li><li>При сводном выпуске Word скопирует строку по одному разу для каждого объекта группы.</li><li>Поля берутся из карточки объекта; номер строки система считает сама.</li></ol></div>'''
)

replace_once(
    '''<div class="roster-assistant-preview"><span aria-hidden="true">✓</span><div><strong>Ожидаемый результат</strong><p>Заголовок таблицы останется один раз, а настроенная строка повторится по числу выбранных участников.</p></div></div>''',
    '''<div class="roster-assistant-preview"><span aria-hidden="true">✓</span><div><strong>Ожидаемый результат</strong><p>Заголовок таблицы останется один раз, а настроенная строка повторится по числу выбранных объектов.</p></div></div>'''
)

replace_once(
    '''      <div><strong>${linked ? `Строка уже настроена: ${linked} из ${rows.length} колонок` : "Заполнить всю строку как список участников"}</strong><p>${linked ? "Откройте редактор, чтобы изменить поле, формат ФИО, обязательность или исключить колонку." : "Удобно для реестров, списков студентов и таблиц сотрудников: одна настройка для всех колонок строки."}</p></div>''',
    '''      <div><strong>${linked ? `Строка уже настроена: ${linked} из ${rows.length} колонок` : "Заполнить всю строку как список объектов"}</strong><p>${linked ? (rowEditorIsPerson() ? "Откройте редактор, чтобы изменить поле, формат ФИО, обязательность или исключить колонку." : "Откройте редактор, чтобы изменить поле, обязательность или исключить колонку.") : "Подходит для реестров аудиторий, статей, оборудования, студентов и других однотипных объектов."}</p></div>'''
)


PATH.write_text(value, encoding="utf-8")
print("generic row editor patches applied")
