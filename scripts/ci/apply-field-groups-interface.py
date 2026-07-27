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


# Load shared field groups and searchable select before the main UI, and include CSS.
replace_once(
    "apps/api/src/ui-routes.ts",
    '''    appendFileNames: [
      "spaces.css",''',
    '''    appendFileNames: [
      "searchable-select.css",
      "spaces.css",'''
)
replace_once(
    "apps/api/src/ui-routes.ts",
    '''  "/ui/app.js": {
    fileName: "app.js",
    appendFileNames: [
      "operator-workflows.js",''',
    '''  "/ui/app.js": {
    fileName: "field-groups-ui.js",
    appendFileNames: [
      "searchable-select.js",
      "app.js",
      "operator-workflows.js",'''
)

# Employee dialog: explicit semantic group and searchable field selector.
replace_once(
    "apps/api/ui/index.html",
    '''            <div class="field"><label for="employeeFieldSource">Какое поле добавить</label><select id="employeeFieldSource"></select><small>Поля показаны по названиям. Технические обозначения назначает система.</small></div>''',
    '''            <div class="field"><label for="employeeFieldGroup">К кому относится поле</label><select id="employeeFieldGroup"><option value="common">Общие сведения</option><option value="teacher">Преподаватель</option><option value="student">Студент</option></select><small>Раздел не даёт одноимённым полям преподавателя и студента объединиться.</small></div>
            <div class="field"><label for="employeeFieldSource">Какое поле добавить</label><select id="employeeFieldSource" data-searchable-select data-searchable-placeholder="Выберите поле" data-searchable-search-placeholder="Найти поле по названию"></select><small>Поиск работает по названию и разделу. Старые поля показаны отдельно как «Не распределено».</small></div>'''
)

# Property creation in the advanced data dictionary also records the group.
replace_once(
    "apps/api/ui/app.js",
    '''      ["valueType", "Тип значения", "value-type", true, "", "Тип определяет проверку и будущий элемент формы."],
      ["unit", "Единица измерения", "text", false, "cm", "Необязательно: cm, kg, RUB или %."],''',
    '''      ["valueType", "Тип значения", "value-type", true, "", "Тип определяет проверку и будущий элемент формы."],
      ["uiGroup", "Раздел данных", "field-group", true, "", "Раздел отделяет общие, преподавательские и студенческие сведения."],
      ["unit", "Единица измерения", "text", false, "cm", "Необязательно: cm, kg, RUB или %."],'''
)
replace_once(
    "apps/api/ui/app.js",
    '''    payload: (values) => compact({ label: values.label, valueType: values.valueType, unit: values.unit, sensitivity: values.sensitivity, description: values.description })''',
    '''    payload: (values) => compact({ label: values.label, valueType: values.valueType, unit: values.unit, sensitivity: values.sensitivity, description: values.description, validation: { uiGroup: values.uiGroup } })'''
)
replace_once(
    "apps/api/ui/app.js",
    '''  if (type === "sensitivity") return [["internal", "Внутренние"], ["public", "Публичные"], ["personal", "Персональные"], ["restricted", "Ограниченные"]];''',
    '''  if (type === "sensitivity") return [["internal", "Внутренние"], ["public", "Публичные"], ["personal", "Персональные"], ["restricted", "Ограниченные"]];
  if (type === "field-group") return globalThis.docomatorFieldGroups.definitions.filter((item) => item.key !== "unassigned").map((item) => [item.key, item.label]);'''
)

replace_once(
    "apps/api/ui/app.js",
    '''function employeeFieldMeta(field) {
  const propertyKey = field?.propertyKey || field?.key || field?.definition?.key || "";
  const definition = state.data.properties.find((item) => item.key === propertyKey);
  return {
    propertyKey,
    label: field?.label || field?.definition?.label || definition?.label || "Дополнительное поле",
    valueType: field?.valueType || field?.definition?.valueType || definition?.valueType || "string",
    unit: field?.unit || field?.definition?.unit || definition?.unit || "",
    value: field?.value ?? field?.currentValue ?? ""
  };
}''',
    '''function employeeFieldMeta(field) {
  const propertyKey = field?.propertyKey || field?.key || field?.definition?.key || "";
  const definition = field?.definition || state.data.properties.find((item) => item.key === propertyKey);
  return {
    propertyKey,
    label: field?.label || definition?.label || "Дополнительное поле",
    valueType: field?.valueType || definition?.valueType || "string",
    unit: field?.unit || definition?.unit || "",
    uiGroup: globalThis.docomatorFieldGroups.key(definition),
    value: field?.value ?? field?.currentValue ?? ""
  };
}'''
)

replace_once(
    "apps/api/ui/app.js",
    '''function employeeInputHtml(field, index) {
  const meta = employeeFieldMeta(field);
  const id = `employee-existing-field-${index}`;
  const common = `id="${id}" data-employee-existing-field data-property-key="${escapeHtml(meta.propertyKey)}" data-value-type="${escapeHtml(meta.valueType)}" data-initial-value="${escapeHtml(meta.value ?? "")}"`;
  let control;
  if (meta.valueType === "boolean") {
    control = `<select ${common}><option value="">Не указано</option><option value="true" ${meta.value === true ? "selected" : ""}>Да</option><option value="false" ${meta.value === false ? "selected" : ""}>Нет</option></select>`;
  } else {
    const type = meta.valueType === "number" || meta.valueType === "integer" ? "number" : meta.valueType === "date" ? "date" : "text";
    control = `<input ${common} type="${type}" value="${escapeHtml(meta.value ?? "")}" />`;
  }
  return `<div class="field employee-existing-field"><label for="${id}">${escapeHtml(meta.label)}</label>${control}${meta.unit ? `<small>Единица: ${escapeHtml(meta.unit)}</small>` : ""}</div>`;
}

function renderEmployeeFormFields(employee) {
  const fields = employeeFields(employee);
  const primary = fields.slice(0, 3).map(employeeInputHtml).join("");
  const additional = fields.slice(3).map((field, index) => employeeInputHtml(field, index + 3)).join("");
  $("#employeeFields").innerHTML = `${primary}${additional ? `<details class="employee-more-fields"><summary>Ещё поля (${fields.length - 3})</summary><div>${additional}</div></details>` : ""}`;
  renderEmployeeFieldSourceOptions(fields.map((field) => employeeFieldMeta(field).propertyKey));
}''',
    '''function employeeInputHtml(field, index) {
  const meta = employeeFieldMeta(field);
  const id = `employee-existing-field-${index}`;
  const common = `id="${id}" data-employee-existing-field data-property-key="${escapeHtml(meta.propertyKey)}" data-value-type="${escapeHtml(meta.valueType)}" data-initial-value="${escapeHtml(meta.value ?? "")}"`;
  let control;
  if (meta.valueType === "boolean") {
    control = `<select ${common}><option value="">Не указано</option><option value="true" ${meta.value === true ? "selected" : ""}>Да</option><option value="false" ${meta.value === false ? "selected" : ""}>Нет</option></select>`;
  } else {
    const type = meta.valueType === "number" || meta.valueType === "integer" ? "number" : meta.valueType === "date" ? "date" : "text";
    control = `<input ${common} type="${type}" value="${escapeHtml(meta.value ?? "")}" />`;
  }
  return `<div class="field employee-existing-field"><label for="${id}">${escapeHtml(meta.label)}</label>${control}<span class="field-group-badge">${escapeHtml(globalThis.docomatorFieldGroups.label(meta.uiGroup))}</span>${meta.unit ? `<small>Единица: ${escapeHtml(meta.unit)}</small>` : ""}</div>`;
}

function renderEmployeeFormFields(employee) {
  const fields = employeeFields(employee);
  const grouped = new Map(globalThis.docomatorFieldGroups.definitions.map((group) => [group.key, []]));
  fields.forEach((field, index) => grouped.get(employeeFieldMeta(field).uiGroup)?.push(employeeInputHtml(field, index)));
  $("#employeeFields").innerHTML = globalThis.docomatorFieldGroups.definitions
    .filter((group) => grouped.get(group.key)?.length)
    .map((group) => `<section class="employee-field-group"><h3>${escapeHtml(group.label)}</h3>${grouped.get(group.key).join("")}</section>`)
    .join("");
  renderEmployeeFieldSourceOptions(fields.map((field) => employeeFieldMeta(field).propertyKey));
}'''
)

replace_once(
    "apps/api/ui/app.js",
    '''function employeeSelectableProperties(excludedKeys = []) {
  const excluded = new Set(excludedKeys.filter(Boolean));
  const supportedTypes = new Set(["string", "text", "number", "integer", "boolean", "date", "date-time"]);
  return state.data.properties
    .filter((property) => supportedTypes.has(property.valueType))
    .filter((property) => !excluded.has(property.key))
    .filter((property) => !Array.isArray(property.appliesTo) || property.appliesTo.length === 0 || property.appliesTo.includes("person"))
    .sort((left, right) => left.label.localeCompare(right.label, "ru-RU"));
}

function renderEmployeeFieldSourceOptions(excludedKeys = []) {
  const select = $("#employeeFieldSource");
  const previous = select.value;
  const properties = employeeSelectableProperties(excludedKeys);
  select.innerHTML = `<option value="">Выберите поле</option>${properties.map((property) => `<option value="existing:${escapeHtml(property.key)}">${escapeHtml(property.label)} · ${escapeHtml(displayLabel("valueTypes", property.valueType))}</option>`).join("")}<option value="__new__">Новое поле…</option>`;
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  updateEmployeeNewFieldMode();
}''',
    '''function employeeSelectableProperties(excludedKeys = [], selectedGroup = "common") {
  const excluded = new Set(excludedKeys.filter(Boolean));
  const supportedTypes = new Set(["string", "text", "number", "integer", "boolean", "date", "date-time"]);
  return state.data.properties
    .filter((property) => supportedTypes.has(property.valueType))
    .filter((property) => !excluded.has(property.key))
    .filter((property) => !Array.isArray(property.appliesTo) || property.appliesTo.length === 0 || property.appliesTo.includes("person"))
    .filter((property) => globalThis.docomatorFieldGroups.allowed(property, selectedGroup, { includeUnassigned: true }));
}

function renderEmployeeFieldSourceOptions(excludedKeys = []) {
  const select = $("#employeeFieldSource");
  const previous = select.value;
  const selectedGroup = $("#employeeFieldGroup")?.value || "common";
  const properties = employeeSelectableProperties(excludedKeys, selectedGroup);
  const grouped = globalThis.docomatorFieldGroups.grouped(properties, selectedGroup, { includeUnassigned: true });
  const order = [...new Set(["common", selectedGroup, "unassigned"])];
  select.innerHTML = `<option value="">Выберите поле</option>${order
    .filter((group) => grouped.get(group)?.length)
    .map((group) => `<optgroup label="${escapeHtml(globalThis.docomatorFieldGroups.label(group))}">${grouped.get(group).map((property) => `<option value="existing:${escapeHtml(property.key)}" data-search-terms="${escapeHtml(`${property.label} ${(property.aliases || []).join(" ")}`)}">${escapeHtml(property.label)} · ${escapeHtml(displayLabel("valueTypes", property.valueType))}</option>`).join("")}</optgroup>`)
    .join("")}<optgroup label="Действия"><option value="__new__">Создать новое поле…</option></optgroup>`;
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  else select.value = "";
  globalThis.docomatorSearchableSelect?.refresh(select);
  updateEmployeeNewFieldMode();
}'''
)

replace_once(
    "apps/api/ui/app.js",
    '''function resolvedEmployeeAddedField() {
  const source = $("#employeeFieldSource").value;
  if (source.startsWith("existing:")) {
    const property = selectedEmployeeProperty();
    return property ? { kind: "existing", propertyKey: property.key, label: property.label, valueType: property.valueType } : null;
  }
  if (source !== "__new__") return null;
  const label = $("#employeeFieldLabel").value.trim();
  if (!label) return { kind: "new", label: "", valueType: $("#employeeFieldType").value };
  const matches = state.data.properties.filter((property) => property.label.trim().localeCompare(label, "ru-RU", { sensitivity: "accent" }) === 0);
  if (matches.length === 1) {
    return { kind: "existing", propertyKey: matches[0].key, label: matches[0].label, valueType: matches[0].valueType };
  }
  return { kind: "new", label, valueType: $("#employeeFieldType").value };
}''',
    '''function resolvedEmployeeAddedField() {
  const source = $("#employeeFieldSource").value;
  const targetUiGroup = $("#employeeFieldGroup")?.value || "common";
  if (source.startsWith("existing:")) {
    const property = selectedEmployeeProperty();
    return property ? { kind: "existing", propertyKey: property.key, label: property.label, valueType: property.valueType, uiGroup: globalThis.docomatorFieldGroups.key(property), targetUiGroup } : null;
  }
  if (source !== "__new__") return null;
  const label = $("#employeeFieldLabel").value.trim();
  if (!label) return { kind: "new", label: "", valueType: $("#employeeFieldType").value, uiGroup: targetUiGroup };
  const matches = state.data.properties.filter((property) =>
    property.label.trim().localeCompare(label, "ru-RU", { sensitivity: "accent" }) === 0 &&
    globalThis.docomatorFieldGroups.key(property) === targetUiGroup
  );
  if (matches.length === 1) {
    return { kind: "existing", propertyKey: matches[0].key, label: matches[0].label, valueType: matches[0].valueType, uiGroup: targetUiGroup, targetUiGroup };
  }
  return { kind: "new", label, valueType: $("#employeeFieldType").value, uiGroup: targetUiGroup };
}'''
)

replace_once(
    "apps/api/ui/app.js",
    '''  } else if (added?.kind === "new" && added.label) {
    fields.push({ definition: { label: added.label, valueType: added.valueType }, value: employeeControlValue($("#employeeFieldValue"), added.valueType) });
  }''',
    '''  } else if (added?.kind === "new" && added.label) {
    fields.push({ definition: { label: added.label, valueType: added.valueType, uiGroup: added.uiGroup }, value: employeeControlValue($("#employeeFieldValue"), added.valueType) });
  }'''
)

insert_before(
    "apps/api/ui/app.js",
    "async function saveEmployee() {",
    '''async function classifyLegacyEmployeeProperty(added) {
  if (
    added?.kind !== "existing" ||
    added.uiGroup !== "unassigned" ||
    !["common", "teacher", "student"].includes(added.targetUiGroup)
  ) return;
  const body = await api(
    `/api/v1/knowledge/property-definitions/${encodeURIComponent(added.propertyKey)}/group`,
    { method: "PUT", body: JSON.stringify({ uiGroup: added.targetUiGroup }) }
  );
  const index = state.data.properties.findIndex((property) => property.key === added.propertyKey);
  if (index >= 0) state.data.properties[index] = body.data;
}

'''
)
replace_once(
    "apps/api/ui/app.js",
    '''  try {
    const body = await api(employeeEndpoint(state.employee.editingId || ""), {''',
    '''  try {
    const added = $("#employeeNewField").hidden ? null : resolvedEmployeeAddedField();
    await classifyLegacyEmployeeProperty(added);
    const body = await api(employeeEndpoint(state.employee.editingId || ""), {'''
)

replace_once(
    "apps/api/ui/app.js",
    '''  renderEmployeeFieldSourceOptions();
  $("#employeeFieldSource").value = "";''',
    '''  $("#employeeFieldGroup").value = "common";
  renderEmployeeFieldSourceOptions();
  $("#employeeFieldSource").value = "";'''
)
replace_once(
    "apps/api/ui/app.js",
    '''      renderEmployeeFieldSourceOptions($$('[data-employee-existing-field]', $("#employeeForm")).map((control) => control.dataset.propertyKey));
      $("#employeeFieldSource").focus();''',
    '''      renderEmployeeFieldSourceOptions($$('[data-employee-existing-field]', $("#employeeForm")).map((control) => control.dataset.propertyKey));
      $("#employeeFieldSource").nextElementSibling?.querySelector("button")?.focus();'''
)
replace_once(
    "apps/api/ui/app.js",
    '''  $("#employeeFieldSource").addEventListener("change", updateEmployeeNewFieldMode);''',
    '''  $("#employeeFieldGroup").addEventListener("change", () => {
    renderEmployeeFieldSourceOptions($$('[data-employee-existing-field]', $("#employeeForm")).map((control) => control.dataset.propertyKey));
  });
  $("#employeeFieldSource").addEventListener("change", updateEmployeeNewFieldMode);'''
)
replace_once(
    "apps/api/ui/app.js",
    '''      $("#employeeFieldConfirmText").textContent = `Поле «${added.label}» станет доступно в каждой карточке. Введённое значение сохранится у текущего сотрудника.`;''',
    '''      $("#employeeFieldConfirmText").textContent = `Поле «${added.label}» будет создано в разделе «${globalThis.docomatorFieldGroups.label(added.uiGroup)}». Одноимённые поля других разделов останутся отдельными.`;'''
)

print("field group application interface patches applied")
