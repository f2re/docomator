const operatorState = {
  employeeProfile: null,
  employeeDraftValues: new Map(),
  employeeStagedFields: [],
  employeeFieldConfirmed: false,
  suggestions: new Map(),
  groupEditingId: null,
  groupMemberIds: new Set(),
  groupMemberPage: 1,
  groupMemberPageSize: 50,
  groupMemberFilter: "all",
  groupMemberStatus: "active",
  propertyEditingKey: null
};

const operatorEmployeeValueTypes = new Set([
  "string",
  "text",
  "number",
  "integer",
  "boolean",
  "date",
  "date-time",
  "enum"
]);

function operatorToken(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function operatorValidation(property) {
  const value = property?.validation;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function operatorEnumOptions(property) {
  const configured = Array.isArray(operatorValidation(property).enum)
    ? operatorValidation(property).enum.filter((value) => typeof value === "string")
    : [];
  const suggested = operatorState.suggestions.get(property?.key)?.values || [];
  const result = [];
  const seen = new Set();
  for (const value of [
    ...configured,
    ...suggested.map((item) => item.value)
  ]) {
    const normalized = String(value || "").trim();
    const identity = normalized.toLocaleLowerCase("ru-RU");
    if (normalized && !seen.has(identity)) {
      seen.add(identity);
      result.push(normalized);
    }
  }
  return result;
}

function operatorAllowCustom(property) {
  if (property?.valueType !== "enum") return true;
  return operatorValidation(property).allowCustom !== false;
}

function operatorApplicableProperties() {
  const result = [];
  const seen = new Set();
  const add = (definition) => {
    if (!definition?.key || seen.has(definition.key)) return;
    if (!operatorEmployeeValueTypes.has(definition.valueType)) return;
    const appliesTo = Array.isArray(definition.appliesTo) ? definition.appliesTo : [];
    if (appliesTo.length > 0 && !appliesTo.includes("person")) return;
    seen.add(definition.key);
    result.push(definition);
  };
  state.data.properties.forEach(add);
  employeeFields(operatorState.employeeProfile || {}).forEach((field) => add(field.definition));
  return result.sort((left, right) =>
    left.label.localeCompare(right.label, "ru-RU") || left.key.localeCompare(right.key, "en")
  );
}

function operatorProfileValue(propertyKey) {
  const field = employeeFields(operatorState.employeeProfile || {}).find(
    (candidate) => employeeFieldMeta(candidate).propertyKey === propertyKey
  );
  return field === undefined ? "" : employeeFieldMeta(field).value;
}

function operatorValueEmpty(value) {
  return value === "" || value === null || value === undefined;
}

function operatorInputValue(value, valueType) {
  if (operatorValueEmpty(value)) return "";
  if (valueType === "boolean") return value ? "true" : "false";
  if (valueType === "date-time") {
    const parsed = new Date(String(value));
    if (!Number.isNaN(parsed.getTime())) {
      const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
      return local.toISOString().slice(0, 16);
    }
  }
  return String(value);
}

function operatorSuggestionOptions(property) {
  return (operatorState.suggestions.get(property.key)?.values || [])
    .map((item) => item.value)
    .filter(Boolean);
}

function operatorEmployeeControl(property, draftValue, initialValue, identity) {
  const controlId = `operatorEmployee_${operatorToken(identity)}`;
  const common = `id="${controlId}" data-operator-employee-field data-property-key="${escapeHtml(property.key || "")}" data-staged-id="${escapeHtml(property.stagedId || "")}" data-value-type="${escapeHtml(property.valueType)}" data-initial-value="${escapeHtml(JSON.stringify(initialValue ?? ""))}"`;
  const value = operatorInputValue(draftValue, property.valueType);
  if (property.valueType === "boolean") {
    return `<select ${common}><option value="">Не указано</option><option value="true"${value === "true" ? " selected" : ""}>Да</option><option value="false"${value === "false" ? " selected" : ""}>Нет</option></select>`;
  }
  if (property.valueType === "text") {
    return `<textarea ${common} rows="3" maxlength="20000">${escapeHtml(value)}</textarea>`;
  }
  if (property.valueType === "number" || property.valueType === "integer") {
    return `<input ${common} type="number" step="${property.valueType === "integer" ? "1" : "any"}" value="${escapeHtml(value)}" />`;
  }
  if (property.valueType === "date") {
    return `<input ${common} type="date" value="${escapeHtml(value)}" />`;
  }
  if (property.valueType === "date-time") {
    return `<input ${common} type="datetime-local" value="${escapeHtml(value)}" />`;
  }
  const options = property.valueType === "enum"
    ? operatorEnumOptions(property)
    : operatorSuggestionOptions(property);
  if (property.valueType === "enum" && !operatorAllowCustom(property)) {
    return `<select ${common}><option value="">Не указано</option>${options
      .map(
        (option) =>
          `<option value="${escapeHtml(option)}"${option === value ? " selected" : ""}>${escapeHtml(option)}</option>`
      )
      .join("")}</select>`;
  }
  const listId = `operatorList_${operatorToken(identity)}`;
  return `<input ${common} type="text" maxlength="2000" value="${escapeHtml(value)}" list="${listId}" autocomplete="off" /><datalist id="${listId}">${options
    .map((option) => `<option value="${escapeHtml(option)}"></option>`)
    .join("")}</datalist>`;
}

function operatorRememberEmployeeDraft() {
  document.querySelectorAll("[data-operator-employee-field]").forEach((control) => {
    const identity = control.dataset.stagedId
      ? `staged:${control.dataset.stagedId}`
      : `property:${control.dataset.propertyKey}`;
    operatorState.employeeDraftValues.set(identity, control.value);
  });
}

function operatorEmployeeFieldCard(property, staged = false) {
  const identity = staged ? `staged:${property.stagedId}` : `property:${property.key}`;
  const initial = staged ? "" : operatorProfileValue(property.key);
  const draft = operatorState.employeeDraftValues.has(identity)
    ? operatorState.employeeDraftValues.get(identity)
    : operatorInputValue(initial, property.valueType);
  const filled = !operatorValueEmpty(draft);
  const options = property.valueType === "enum" ? operatorEnumOptions(property) : [];
  const hint = property.valueType === "enum"
    ? `${options.length} вариантов${operatorAllowCustom(property) ? " · новые значения автоматически пополняют список" : " · только заданные значения"}`
    : operatorSuggestionOptions(property).length > 0
      ? "Предыдущие значения доступны как автодополнение."
      : "Введите значение один раз — дальше оно появится в подсказках.";
  return `<article class="operator-employee-field-card${filled ? " is-filled" : ""}" data-operator-field-card data-search-text="${escapeHtml(`${property.label} ${property.key || ""}`.toLocaleLowerCase("ru-RU"))}" data-filled="${filled ? "true" : "false"}">
    <div class="operator-field-heading"><label for="operatorEmployee_${operatorToken(identity)}">${escapeHtml(property.label)}</label><span>${escapeHtml(displayLabel("valueTypes", property.valueType))}</span></div>
    ${operatorEmployeeControl(property, draft, initial, identity)}
    <small>${escapeHtml(hint)}</small>
    ${staged ? `<button class="text-button operator-remove-field" type="button" data-operator-remove-staged="${escapeHtml(property.stagedId)}">Убрать поле</button>` : ""}
  </article>`;
}

function operatorApplyEmployeeFilter() {
  const query = document.querySelector("#operatorEmployeeFieldSearch")?.value
    .trim()
    .toLocaleLowerCase("ru-RU") || "";
  const filledOnly = Boolean(document.querySelector("#operatorEmployeeFilledOnly")?.checked);
  let visible = 0;
  document.querySelectorAll("[data-operator-field-card]").forEach((card) => {
    const matchQuery = !query || card.dataset.searchText.includes(query);
    const matchFilled = !filledOnly || card.dataset.filled === "true";
    card.hidden = !(matchQuery && matchFilled);
    if (!card.hidden) visible += 1;
  });
  const count = document.querySelector("#operatorEmployeeVisibleCount");
  if (count) count.textContent = `Показано: ${visible}`;
}

function operatorRenderEmployeeFields() {
  operatorRememberEmployeeDraft();
  const root = document.querySelector("#employeeFields");
  if (!root) return;
  const properties = operatorApplicableProperties();
  const filled = properties.filter((property) => {
    const identity = `property:${property.key}`;
    const value = operatorState.employeeDraftValues.has(identity)
      ? operatorState.employeeDraftValues.get(identity)
      : operatorProfileValue(property.key);
    return !operatorValueEmpty(value);
  }).length + operatorState.employeeStagedFields.filter((field) => !operatorValueEmpty(field.value)).length;
  root.hidden = false;
  root.innerHTML = `
    <section class="operator-employee-fields-shell">
      <div class="operator-employee-fields-toolbar">
        <label class="search-field"><span aria-hidden="true">⌕</span><input id="operatorEmployeeFieldSearch" type="search" placeholder="Найти поле" autocomplete="off" /></label>
        <label class="operator-check"><input id="operatorEmployeeFilledOnly" type="checkbox" /><span>Только заполненные</span></label>
        <span class="operator-counter">Заполнено ${filled} из ${properties.length + operatorState.employeeStagedFields.length}</span>
        <span class="operator-counter" id="operatorEmployeeVisibleCount"></span>
      </div>
      <div class="operator-employee-field-grid">
        ${properties.map((property) => operatorEmployeeFieldCard(property)).join("")}
        ${operatorState.employeeStagedFields.map((property) => operatorEmployeeFieldCard(property, true)).join("")}
      </div>
      <button class="field-add-button" id="operatorEmployeeAddField" type="button"><span aria-hidden="true">＋</span><span>Добавить новое поле карточки</span></button>
      <section class="operator-new-field" id="operatorEmployeeNewField" hidden>
        <div class="employee-subheading"><div><strong>Новое общее поле</strong><small>Можно подготовить несколько полей и сохранить их вместе с сотрудником.</small></div><button class="quiet-button compact" type="button" id="operatorEmployeeCancelNewField">Свернуть</button></div>
        <div class="operator-new-field-grid">
          <label class="field"><span>Название</span><input id="operatorNewFieldLabel" type="text" maxlength="160" placeholder="Например, Должность" /></label>
          <label class="field"><span>Тип значения</span><select id="operatorNewFieldType"><option value="string">Текст</option><option value="text">Длинный текст</option><option value="number">Число</option><option value="integer">Целое число</option><option value="date">Дата</option><option value="date-time">Дата и время</option><option value="boolean">Да или нет</option><option value="enum">Список вариантов</option></select></label>
          <label class="field"><span>Единица измерения</span><input id="operatorNewFieldUnit" type="text" maxlength="80" placeholder="Необязательно" /></label>
          <label class="field"><span>Значение у сотрудника</span><input id="operatorNewFieldValue" type="text" maxlength="2000" placeholder="Введите значение" /></label>
          <label class="field operator-enum-options" id="operatorNewFieldOptionsField" hidden><span>Варианты выбора</span><textarea id="operatorNewFieldOptions" rows="4" placeholder="По одному варианту в строке"></textarea></label>
          <label class="operator-check operator-enum-options" id="operatorNewFieldCustomField" hidden><input id="operatorNewFieldAllowCustom" type="checkbox" checked /><span>Разрешать новые значения и автоматически добавлять их в список</span></label>
        </div>
        <div class="operator-inline-actions"><button class="primary-button" id="operatorStageNewField" type="button">Добавить поле в карточку</button></div>
      </section>
    </section>`;
  document.querySelector("#operatorEmployeeFieldSearch")?.addEventListener("input", operatorApplyEmployeeFilter);
  document.querySelector("#operatorEmployeeFilledOnly")?.addEventListener("change", operatorApplyEmployeeFilter);
  document.querySelector("#operatorEmployeeAddField")?.addEventListener("click", () => {
    document.querySelector("#operatorEmployeeNewField").hidden = false;
    document.querySelector("#operatorNewFieldLabel")?.focus();
  });
  document.querySelector("#operatorEmployeeCancelNewField")?.addEventListener("click", () => {
    document.querySelector("#operatorEmployeeNewField").hidden = true;
  });
  document.querySelector("#operatorNewFieldType")?.addEventListener("change", operatorUpdateNewFieldControls);
  document.querySelector("#operatorStageNewField")?.addEventListener("click", operatorStageNewField);
  document.querySelectorAll("[data-operator-remove-staged]").forEach((button) =>
    button.addEventListener("click", () => {
      operatorRememberEmployeeDraft();
      const id = button.dataset.operatorRemoveStaged;
      operatorState.employeeStagedFields = operatorState.employeeStagedFields.filter((field) => field.stagedId !== id);
      operatorState.employeeDraftValues.delete(`staged:${id}`);
      operatorRenderEmployeeFields();
    })
  );
  root.addEventListener("input", operatorRememberEmployeeDraft, { once: true });
  root.addEventListener("change", operatorRememberEmployeeDraft, { once: true });
  operatorApplyEmployeeFilter();
}

function operatorParseOptions(value) {
  const result = [];
  const seen = new Set();
  for (const item of String(value || "").split(/[\n,;]+/u)) {
    const normalized = item.normalize("NFKC").trim();
    const identity = normalized.toLocaleLowerCase("ru-RU");
    if (normalized && !seen.has(identity)) {
      seen.add(identity);
      result.push(normalized);
    }
  }
  return result;
}

function operatorUpdateNewFieldControls() {
  const type = document.querySelector("#operatorNewFieldType")?.value || "string";
  document.querySelectorAll(".operator-enum-options").forEach((element) => {
    element.hidden = type !== "enum";
  });
  const current = document.querySelector("#operatorNewFieldValue");
  if (!current) return;
  if (type === "boolean") {
    const select = document.createElement("select");
    select.id = "operatorNewFieldValue";
    select.innerHTML = '<option value="">Не указано</option><option value="true">Да</option><option value="false">Нет</option>';
    current.replaceWith(select);
  } else if (current.tagName !== "INPUT") {
    const input = document.createElement("input");
    input.id = "operatorNewFieldValue";
    input.maxLength = 2000;
    current.replaceWith(input);
    operatorUpdateNewFieldControls();
  } else {
    current.type = type === "number" || type === "integer" ? "number" : type === "date" ? "date" : type === "date-time" ? "datetime-local" : "text";
    current.step = type === "integer" ? "1" : "any";
  }
}

function operatorStageNewField() {
  const label = document.querySelector("#operatorNewFieldLabel")?.value.trim() || "";
  const valueType = document.querySelector("#operatorNewFieldType")?.value || "string";
  const unit = document.querySelector("#operatorNewFieldUnit")?.value.trim() || "";
  const rawValue = document.querySelector("#operatorNewFieldValue")?.value || "";
  if (!label) {
    showEmployeeFormError("Укажите название нового поля.");
    document.querySelector("#operatorNewFieldLabel")?.focus();
    return;
  }
  const duplicate = [
    ...operatorApplicableProperties().map((property) => property.label),
    ...operatorState.employeeStagedFields.map((property) => property.label)
  ].some((candidate) => candidate.localeCompare(label, "ru-RU", { sensitivity: "accent" }) === 0);
  if (duplicate) {
    showEmployeeFormError(`Поле «${label}» уже есть в карточке.`);
    return;
  }
  const options = valueType === "enum"
    ? operatorParseOptions(document.querySelector("#operatorNewFieldOptions")?.value || "")
    : [];
  const allowCustom = Boolean(document.querySelector("#operatorNewFieldAllowCustom")?.checked);
  if (valueType === "enum" && rawValue && allowCustom && !options.some((option) => option.localeCompare(rawValue, "ru-RU", { sensitivity: "accent" }) === 0)) {
    options.push(rawValue);
  }
  if (valueType === "enum" && options.length === 0 && !allowCustom) {
    showEmployeeFormError("Для закрытого списка добавьте хотя бы один вариант.");
    return;
  }
  const stagedId = globalThis.crypto?.randomUUID?.() || `field-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  operatorRememberEmployeeDraft();
  operatorState.employeeStagedFields.push({
    stagedId,
    key: "",
    label,
    valueType,
    unit,
    sensitivity: "personal",
    appliesTo: ["person"],
    validation: valueType === "enum" ? { enum: options, allowCustom } : {},
    value: rawValue
  });
  operatorState.employeeDraftValues.set(`staged:${stagedId}`, rawValue);
  operatorState.employeeFieldConfirmed = false;
  clearEmployeeFormError();
  operatorRenderEmployeeFields();
}

async function operatorLoadSuggestions() {
  try {
    const body = await api(spaceEndpoint("/property-suggestions?limit=30"));
    operatorState.suggestions = new Map(
      (Array.isArray(body?.data) ? body.data : []).map((record) => [record.propertyKey, record])
    );
  } catch {
    operatorState.suggestions = new Map();
  }
}

async function operatorOpenEmployeeDialog(employeeIdValue = "") {
  const dialog = document.querySelector("#employeeDialog");
  state.employee.editingId = employeeIdValue;
  state.employee.idempotencyKey = requestCorrelationId();
  operatorState.employeeProfile = null;
  operatorState.employeeDraftValues = new Map();
  operatorState.employeeStagedFields = [];
  operatorState.employeeFieldConfirmed = false;
  clearEmployeeFormError();
  document.querySelector("#employeeForm")?.reset();
  document.querySelector("#employeeAddFieldButton").hidden = true;
  document.querySelector("#employeeNewField").hidden = true;
  document.querySelector("#employeeTechnicalDetails").hidden = true;
  document.querySelector("#employeeDialogTitle").textContent = employeeIdValue ? "Карточка сотрудника" : "Новый сотрудник";
  document.querySelector("#employeeDialogDescription").textContent = "Заполните сразу все нужные сведения. Предыдущие значения используются как подсказки.";
  document.querySelector("#employeeSubmitButton").textContent = employeeIdValue ? "Сохранить изменения" : "Сохранить сотрудника";
  if (!dialog.open) dialog.showModal();
  document.querySelector("#employeeFields").innerHTML = '<div class="employee-inline-loading"><span class="state-mark" aria-hidden="true"></span><span>Получаем поля и подсказки…</span></div>';
  try {
    const [profileResult] = await Promise.all([
      employeeIdValue
        ? api(employeeEndpoint(employeeIdValue)).then((body) => body?.data || null)
        : Promise.resolve(null),
      operatorLoadSuggestions()
    ]);
    operatorState.employeeProfile = profileResult;
    if (profileResult) {
      document.querySelector("#employeeDisplayName").value = profileResult.displayName || "";
      document.querySelector("#employeeStatus").value = profileResult.status || "active";
    }
    for (const property of operatorApplicableProperties()) {
      operatorState.employeeDraftValues.set(
        `property:${property.key}`,
        operatorInputValue(operatorProfileValue(property.key), property.valueType)
      );
    }
    operatorRenderEmployeeFields();
    requestAnimationFrame(() => document.querySelector("#employeeDisplayName")?.focus());
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Не удалось открыть карточку.");
    document.querySelector("#employeeFields").innerHTML = "";
    showEmployeeFormError(employeeErrorText(error, "открыть карточку"), error);
  }
}

const operatorBaseCloseEmployeeDialog = closeEmployeeDialog;
openEmployeeDialog = operatorOpenEmployeeDialog;
closeEmployeeDialog = function operatorCloseEmployeeDialog() {
  operatorState.employeeProfile = null;
  operatorState.employeeDraftValues = new Map();
  operatorState.employeeStagedFields = [];
  operatorBaseCloseEmployeeDialog();
};

function operatorControlJsonValue(control) {
  const raw = control.value;
  const type = control.dataset.valueType;
  if (raw === "") return "";
  if (type === "boolean") return raw === "true";
  if (type === "number") return Number(raw);
  if (type === "integer") return Number.parseInt(raw, 10);
  if (type === "date-time") {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? raw : date.toISOString();
  }
  return raw;
}

async function operatorPersistEmployee() {
  const button = document.querySelector("#employeeSubmitButton");
  button.disabled = true;
  button.textContent = "Сохраняем…";
  clearEmployeeFormError();
  operatorRememberEmployeeDraft();
  try {
    const fields = [];
    for (const control of document.querySelectorAll("[data-operator-employee-field]")) {
      if (control.dataset.stagedId) continue;
      const value = operatorControlJsonValue(control);
      const initial = JSON.parse(control.dataset.initialValue || '""');
      if (operatorValueEmpty(value)) continue;
      if (state.employee.editingId && JSON.stringify(value) === JSON.stringify(initial)) continue;
      const property = state.data.properties.find((candidate) => candidate.key === control.dataset.propertyKey);
      if (property?.valueType === "enum") {
        const options = operatorEnumOptions(property);
        const known = options.some((option) => option.localeCompare(String(value), "ru-RU", { sensitivity: "accent" }) === 0);
        if (!known && !operatorAllowCustom(property)) {
          throw new ApiError(`Для поля «${property.label}» выберите значение из списка.`);
        }
        if (!known) {
          const updated = await api(`/api/v1/knowledge/property-definitions/${encodeURIComponent(property.key)}/options`, {
            method: "POST",
            body: JSON.stringify({ values: [String(value)] })
          });
          const index = state.data.properties.findIndex((candidate) => candidate.key === property.key);
          if (index >= 0) state.data.properties[index] = updated.data;
        }
      }
      fields.push({ propertyKey: control.dataset.propertyKey, value });
    }
    for (const staged of operatorState.employeeStagedFields) {
      const control = document.querySelector(`[data-staged-id="${CSS.escape(staged.stagedId)}"]`);
      const value = control ? operatorControlJsonValue(control) : staged.value;
      const created = await api("/api/v1/knowledge/property-definitions", {
        method: "POST",
        body: JSON.stringify(compact({
          label: staged.label,
          valueType: staged.valueType,
          unit: staged.unit,
          sensitivity: "personal",
          appliesTo: ["person"],
          validation: staged.validation
        }))
      });
      if (!state.data.properties.some((property) => property.key === created.data.key)) {
        state.data.properties.push(created.data);
      }
      if (!operatorValueEmpty(value)) {
        fields.push({ propertyKey: created.data.key, value });
      }
    }
    const displayName = document.querySelector("#employeeDisplayName")?.value.trim() || "";
    const editing = Boolean(state.employee.editingId);
    const body = await api(employeeEndpoint(state.employee.editingId || ""), {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify({
        displayName,
        status: document.querySelector("#employeeStatus")?.value || "active",
        fields,
        idempotencyKey: state.employee.idempotencyKey
      })
    });
    state.employee.lastSavedName = displayName;
    closeEmployeeDialog();
    await loadData();
    selectView("employees");
    state.employee.lastSavedName = displayName;
    renderEmployeeSuccess();
    notify("✅", "Карточка сотрудника сохранена", `Сохранено значений: ${fields.length}. Все текстовые значения доступны как подсказки.`);
    setStatus("success", "✓", "Карточка сотрудника сохранена", `ФИО и ${fields.length} полей подтверждены сервером. Идентификатор операции: ${body?.correlationId || "не указан"}.`);
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Не удалось сохранить карточку.");
    showEmployeeFormError(error.message || employeeErrorText(error, "сохранить карточку"), error);
    setStatus("error", "!", "Карточка не сохранена", "Введённые значения остались в форме. Исправьте причину и повторите сохранение.");
  } finally {
    button.disabled = false;
    button.textContent = state.employee.editingId ? "Сохранить изменения" : "Сохранить сотрудника";
  }
}

function operatorSubmitEmployee(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  clearEmployeeFormError();
  if (!document.querySelector("#employeeForm")?.reportValidity()) {
    showEmployeeFormError("Укажите ФИО. Остальные значения сохранены в форме.");
    return;
  }
  if (operatorState.employeeStagedFields.length > 0 && !operatorState.employeeFieldConfirmed) {
    const names = operatorState.employeeStagedFields.map((field) => `«${field.label}»`).join(", ");
    document.querySelector("#employeeFieldConfirmTitle").textContent = "Добавить новые поля всем сотрудникам?";
    document.querySelector("#employeeFieldConfirmText").textContent = `${names} станут доступны во всех карточках. Текущие значения сохранятся у этого сотрудника.`;
    const confirmDialog = document.querySelector("#employeeFieldConfirmDialog");
    confirmDialog.returnValue = "";
    confirmDialog.showModal();
    confirmDialog.addEventListener("close", () => {
      if (confirmDialog.returnValue !== "confirm") return;
      operatorState.employeeFieldConfirmed = true;
      void operatorPersistEmployee();
    }, { once: true });
    return;
  }
  void operatorPersistEmployee();
}

document.querySelector("#employeeForm")?.addEventListener("submit", operatorSubmitEmployee, true);

function operatorPropertyOptionsFromForm() {
  return operatorParseOptions(document.querySelector("#operatorPropertyOptions")?.value || "");
}

function operatorRenderPropertyDialog(property = null) {
  operatorState.propertyEditingKey = property?.key || null;
  state.dialogKind = property ? "operator-property-edit" : "operator-property-create";
  document.querySelector("#dialogEyebrow").textContent = property ? "Настройка поля" : "Структура данных";
  document.querySelector("#dialogTitle").textContent = property ? `Поле «${property.label}»` : "Новое поле карточки";
  document.querySelector("#dialogDescription").textContent = "Тип определяет элемент ввода. Для списка вариантов задайте начальные значения и разрешите автоматическое пополнение при необходимости.";
  const validation = operatorValidation(property);
  const options = property?.valueType === "enum" ? operatorEnumOptions(property) : [];
  const type = property?.valueType || "string";
  document.querySelector("#dialogFields").innerHTML = `
    <div class="field"><label for="operatorPropertyLabel">Название <span class="required-marker">*</span></label><input id="operatorPropertyLabel" type="text" maxlength="500" required value="${escapeHtml(property?.label || "")}" placeholder="Например, Должность" /></div>
    <div class="field"><label for="operatorPropertyType">Тип значения</label><select id="operatorPropertyType"${property ? " disabled" : ""}><option value="string"${type === "string" ? " selected" : ""}>Текст</option><option value="text"${type === "text" ? " selected" : ""}>Длинный текст</option><option value="number"${type === "number" ? " selected" : ""}>Число</option><option value="integer"${type === "integer" ? " selected" : ""}>Целое число</option><option value="date"${type === "date" ? " selected" : ""}>Дата</option><option value="date-time"${type === "date-time" ? " selected" : ""}>Дата и время</option><option value="boolean"${type === "boolean" ? " selected" : ""}>Да или нет</option><option value="enum"${type === "enum" ? " selected" : ""}>Список вариантов</option></select><small>${property ? "Тип нельзя менять после появления значений; создайте новое поле, если нужен другой тип." : "После сохранения тип фиксируется."}</small></div>
    <div class="field"><label for="operatorPropertyUnit">Единица измерения</label><input id="operatorPropertyUnit" type="text" maxlength="80" value="${escapeHtml(property?.unit || "")}" placeholder="Необязательно" /></div>
    <div class="field"><label for="operatorPropertySensitivity">Класс обработки</label><select id="operatorPropertySensitivity"><option value="personal"${(property?.sensitivity || "personal") === "personal" ? " selected" : ""}>Персональные</option><option value="internal"${property?.sensitivity === "internal" ? " selected" : ""}>Внутренние</option><option value="public"${property?.sensitivity === "public" ? " selected" : ""}>Открытые</option><option value="restricted"${property?.sensitivity === "restricted" ? " selected" : ""}>Ограниченные</option></select></div>
    <div class="field"><label for="operatorPropertyDescription">Описание</label><textarea id="operatorPropertyDescription" rows="3" maxlength="2000" placeholder="Для чего используется поле">${escapeHtml(property?.description || "")}</textarea></div>
    <div class="field"><label for="operatorPropertyAliases">Другие названия</label><input id="operatorPropertyAliases" type="text" maxlength="2000" value="${escapeHtml((property?.aliases || []).join(", "))}" placeholder="Например: должн., позиция" /><small>Помогают сопоставлению шаблонов и поиску.</small></div>
    <section id="operatorPropertyEnumSection" class="operator-property-enum"${type === "enum" ? "" : " hidden"}>
      <div class="field"><label for="operatorPropertyOptions">Варианты выбора</label><textarea id="operatorPropertyOptions" rows="6" placeholder="По одному варианту в строке">${escapeHtml(options.join("\n"))}</textarea><small>Варианты можно редактировать. Уже сохранённые значения не удаляются из истории.</small></div>
      <label class="operator-check"><input id="operatorPropertyAllowCustom" type="checkbox"${validation.allowCustom !== false ? " checked" : ""} /><span>Разрешать оператору вводить новые значения и автоматически пополнять список</span></label>
    </section>`;
  document.querySelector("#dialogSubmitButton").textContent = property ? "Сохранить поле" : "Создать поле";
  document.querySelector("#formError").hidden = true;
  document.querySelector("#operatorPropertyType")?.addEventListener("change", () => {
    document.querySelector("#operatorPropertyEnumSection").hidden = document.querySelector("#operatorPropertyType").value !== "enum";
  });
  const dialog = document.querySelector("#createDialog");
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => document.querySelector("#operatorPropertyLabel")?.focus());
}

const operatorBaseOpenDialog = openDialog;
openDialog = function operatorOpenDialog(kind) {
  if (kind === "property") {
    operatorRenderPropertyDialog();
    return;
  }
  operatorBaseOpenDialog(kind);
};

async function operatorSubmitProperty(event) {
  if (!String(state.dialogKind || "").startsWith("operator-property-")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const form = document.querySelector("#createForm");
  if (!form.reportValidity()) return;
  const button = document.querySelector("#dialogSubmitButton");
  button.disabled = true;
  button.textContent = "Сохраняем…";
  document.querySelector("#formError").hidden = true;
  try {
    const valueType = document.querySelector("#operatorPropertyType")?.value || "string";
    const options = operatorPropertyOptionsFromForm();
    const payload = compact({
      label: document.querySelector("#operatorPropertyLabel")?.value.trim(),
      valueType,
      unit: document.querySelector("#operatorPropertyUnit")?.value.trim(),
      sensitivity: document.querySelector("#operatorPropertySensitivity")?.value,
      description: document.querySelector("#operatorPropertyDescription")?.value.trim(),
      aliases: operatorParseOptions(document.querySelector("#operatorPropertyAliases")?.value || ""),
      appliesTo: state.dialogKind === "operator-property-create" ? ["person"] : undefined,
      validation: valueType === "enum"
        ? {
            enum: options,
            allowCustom: Boolean(document.querySelector("#operatorPropertyAllowCustom")?.checked)
          }
        : {}
    });
    const editing = state.dialogKind === "operator-property-edit";
    const body = await api(
      editing
        ? `/api/v1/knowledge/property-definitions/${encodeURIComponent(operatorState.propertyEditingKey)}`
        : "/api/v1/knowledge/property-definitions",
      {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(payload)
      }
    );
    closeDialog();
    await loadData();
    setKnowledgeTab("properties");
    selectView("knowledge");
    notify("✅", editing ? "Поле обновлено" : "Поле создано", body.data.valueType === "enum" ? `Вариантов выбора: ${operatorEnumOptions(body.data).length}.` : "Поле доступно во всех карточках сотрудников.");
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Не удалось сохранить поле.");
    const root = document.querySelector("#formError");
    root.hidden = false;
    root.innerHTML = `${escapeHtml(error.message)}${error.correlationId ? `<code>Идентификатор операции: ${escapeHtml(error.correlationId)}</code>` : ""}`;
  } finally {
    button.disabled = false;
    button.textContent = state.dialogKind === "operator-property-edit" ? "Сохранить поле" : "Создать поле";
  }
}

document.querySelector("#createForm")?.addEventListener("submit", operatorSubmitProperty, true);

const operatorBaseRenderKnowledge = renderKnowledge;
renderKnowledge = function operatorRenderKnowledge() {
  operatorBaseRenderKnowledge();
  if (state.knowledgeTab !== "properties") return;
  const query = document.querySelector("#knowledgeSearch")?.value.trim().toLowerCase() || "";
  const properties = state.data.properties.filter((item) => !query || itemText(item).includes(query));
  document.querySelectorAll("#knowledgeContent .collection-card").forEach((card, index) => {
    const property = properties[index];
    if (!property) return;
    if (property.valueType === "enum") {
      const options = operatorEnumOptions(property);
      card.querySelector(".card-meta")?.insertAdjacentHTML(
        "beforeend",
        `<span class="pill">${options.length} вариантов</span><span class="pill">${operatorAllowCustom(property) ? "расширяемый" : "закрытый"}</span>`
      );
    }
    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.innerHTML = `<button class="secondary-button compact-button" type="button" data-operator-edit-property="${escapeHtml(property.key)}">Изменить поле</button>`;
    card.append(actions);
  });
};

function groupManagerEmployees() {
  return [...state.data.employees].sort(
    (left, right) =>
      String(left.displayName || "").localeCompare(
        String(right.displayName || ""),
        "ru-RU"
      ) || employeeId(left).localeCompare(employeeId(right), "en")
  );
}

function groupManagerQuery() {
  return (
    document.querySelector("#operatorGroupSearch")?.value
      .trim()
      .toLocaleLowerCase("ru-RU") || ""
  );
}

function groupManagerFilteredEmployees() {
  const query = groupManagerQuery();
  return groupManagerEmployees().filter((employee) => {
    const id = employeeId(employee);
    const selected = operatorState.groupMemberIds.has(id);
    const matchesQuery =
      !query ||
      String(employee.displayName || "")
        .toLocaleLowerCase("ru-RU")
        .includes(query);
    const matchesMembership =
      operatorState.groupMemberFilter === "all" ||
      (operatorState.groupMemberFilter === "selected" && selected) ||
      (operatorState.groupMemberFilter === "unselected" && !selected);
    const matchesStatus =
      operatorState.groupMemberStatus === "all" || employee.status === "active";
    return matchesQuery && matchesMembership && matchesStatus;
  });
}

function groupManagerUpdateCounts() {
  const selectedCount = operatorState.groupMemberIds.size;
  const filteredCount = groupManagerFilteredEmployees().length;
  const total = state.data.employees.length;
  const counter = document.querySelector("#operatorGroupCounter");
  if (counter) {
    counter.innerHTML = `<strong>В группе: ${selectedCount}</strong><span>Найдено: ${filteredCount} · Всего сотрудников: ${total}</span>`;
  }
  const message = document.querySelector("#operatorGroupMessage");
  if (message) {
    message.textContent =
      "Поиск и страницы не снимают уже выбранных людей. Сохраняется весь состав, а не только текущая страница.";
  }
}

function groupManagerRenderPagination(filtered, pageCount) {
  const page = Math.min(Math.max(1, operatorState.groupMemberPage), pageCount || 1);
  operatorState.groupMemberPage = page;
  return `<div class="operator-group-pagination"><button class="secondary-button compact-button" type="button" data-group-page="previous"${page <= 1 ? " disabled" : ""}>Назад</button><span>Страница ${page} из ${Math.max(1, pageCount)} · показано до ${operatorState.groupMemberPageSize}</span><button class="secondary-button compact-button" type="button" data-group-page="next"${page >= pageCount ? " disabled" : ""}>Далее</button></div>`;
}

function operatorFilterGroupMembers() {
  operatorState.groupMemberPage = 1;
  operatorRenderGroupMembers();
}

function operatorRenderGroupMembers(selectedIds) {
  if (selectedIds instanceof Set) {
    operatorState.groupMemberIds = new Set(selectedIds);
  }
  const root = document.querySelector("#operatorGroupMembers");
  if (!root) return;
  const filtered = groupManagerFilteredEmployees();
  const pageSize = operatorState.groupMemberPageSize;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  operatorState.groupMemberPage = Math.min(operatorState.groupMemberPage, pageCount);
  const start = (operatorState.groupMemberPage - 1) * pageSize;
  const shown = filtered.slice(start, start + pageSize);
  root.innerHTML = `
    <div class="operator-group-member-list">${shown.length
      ? shown
          .map((employee) => {
            const id = employeeId(employee);
            const selected = operatorState.groupMemberIds.has(id);
            return `<label class="operator-group-member${selected ? " is-selected" : ""}"><input type="checkbox" data-operator-group-member data-status="${escapeHtml(employee.status)}" value="${escapeHtml(id)}"${selected ? " checked" : ""} /><span class="operator-group-member-avatar" aria-hidden="true">${escapeHtml(String(employee.displayName || "С").slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(employee.displayName)}</strong><small>${escapeHtml(employeeStatusLabel(employee.status))}</small></span><b aria-hidden="true">✓</b></label>`;
          })
          .join("")
      : '<div class="operator-group-empty"><strong>Сотрудники не найдены</strong><p>Измените поиск или фильтр. Уже выбранный состав не изменён.</p></div>'}</div>
    ${groupManagerRenderPagination(filtered, pageCount)}`;
  root.querySelectorAll("[data-operator-group-member]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) operatorState.groupMemberIds.add(input.value);
      else operatorState.groupMemberIds.delete(input.value);
      input.closest(".operator-group-member")?.classList.toggle(
        "is-selected",
        input.checked
      );
      if (operatorState.groupMemberFilter !== "all") {
        operatorRenderGroupMembers();
      } else {
        groupManagerUpdateCounts();
      }
    });
  });
  root.querySelectorAll("[data-group-page]").forEach((button) => {
    button.addEventListener("click", () => {
      operatorState.groupMemberPage +=
        button.dataset.groupPage === "next" ? 1 : -1;
      operatorRenderGroupMembers();
      root.scrollIntoView({ block: "nearest" });
    });
  });
  groupManagerUpdateCounts();
}

function groupManagerApplyToFound(action) {
  const found = groupManagerFilteredEmployees();
  for (const employee of found) {
    const id = employeeId(employee);
    if (action === "select") operatorState.groupMemberIds.add(id);
    else operatorState.groupMemberIds.delete(id);
  }
  operatorRenderGroupMembers();
}

function groupManagerFilterGroupList() {
  const query =
    document.querySelector("#operatorGroupListSearch")?.value
      .trim()
      .toLocaleLowerCase("ru-RU") || "";
  const select = document.querySelector("#operatorGroupSelect");
  if (!select) return;
  const current = operatorState.groupEditingId || "";
  select.innerHTML = `<option value="">Новая группа</option>${state.data.groups
    .filter(
      (group) =>
        !query ||
        `${group.name} ${group.description || ""}`
          .toLocaleLowerCase("ru-RU")
          .includes(query)
    )
    .sort(
      (left, right) =>
        Number(left.status === "archived") - Number(right.status === "archived") ||
        left.name.localeCompare(right.name, "ru-RU")
    )
    .map(
      (group) =>
        `<option value="${escapeHtml(group.id)}">${group.status === "archived" ? "Архив · " : ""}${escapeHtml(group.name)} · ${group.memberCount}</option>`
    )
    .join("")}`;
  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

function operatorRenderGroupSelect() {
  groupManagerFilterGroupList();
}

function operatorEnsureGroupDialog() {
  if (document.querySelector("#operatorGroupDialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "operatorGroupDialog";
  dialog.className = "create-dialog operator-group-dialog operator-group-dialog";
  dialog.innerHTML = `<form id="operatorGroupForm" novalidate>
    <header class="dialog-header"><div><p class="eyebrow">Группы сотрудников</p><h2 id="operatorGroupTitle">Новая группа</h2><p>Создавайте и обновляйте большие составы без потери выбранных людей при поиске или переходе между страницами.</p></div><button class="icon-button" id="operatorGroupClose" type="button" aria-label="Закрыть">×</button></header>
    <div class="dialog-body operator-group-dialog-body">
      <section class="operator-group-existing"><label class="field"><span>Найти существующую группу</span><input id="operatorGroupListSearch" type="search" placeholder="Название или описание группы" autocomplete="off" /></label><label class="field"><span>Открыть группу</span><select id="operatorGroupSelect"></select></label><button class="secondary-button" id="operatorGroupNew" type="button">Создать новую</button></section>
      <section class="operator-group-details"><label class="field"><span>Название <i>*</i></span><input id="operatorGroupName" type="text" maxlength="500" required placeholder="Например, Студенты группы М-21" /></label><label class="field"><span>Описание</span><input id="operatorGroupDescription" type="text" maxlength="2000" placeholder="Необязательно" /></label><button class="text-button is-danger" id="operatorGroupArchive" type="button" hidden>Переместить в архив</button></section>
      <section class="operator-group-selection">
        <div class="operator-group-selection-heading"><div><strong>Состав группы</strong><p>Отмечайте людей на любой странице. Выбор сохраняется до нажатия «Сохранить».</p></div><div id="operatorGroupCounter"></div></div>
        <div class="operator-group-member-toolbar">
          <label class="search-field"><span aria-hidden="true">⌕</span><input id="operatorGroupSearch" type="search" placeholder="Найти сотрудника по ФИО" autocomplete="off" /></label>
          <label><span>Показать</span><select id="operatorGroupMembershipFilter"><option value="all">Всех</option><option value="selected">Только в группе</option><option value="unselected">Только не выбранных</option></select></label>
          <label><span>Статус</span><select id="operatorGroupStatusFilter"><option value="active">Только работающих</option><option value="all">Все статусы</option></select></label>
          <label><span>На странице</span><select id="operatorGroupPageSize"><option value="25">25</option><option value="50" selected>50</option><option value="100">100</option></select></label>
        </div>
        <div class="operator-group-bulk-actions"><button class="secondary-button compact-button" id="operatorGroupSelectFound" type="button">Добавить всех найденных</button><button class="secondary-button compact-button" id="operatorGroupRemoveFound" type="button">Убрать всех найденных</button><button class="text-button" id="operatorGroupClear" type="button">Очистить группу</button></div>
        <div id="operatorGroupMembers" class="operator-group-members"></div>
      </section>
      <div class="form-error" id="operatorGroupError" role="alert" hidden></div>
    </div>
    <footer class="dialog-footer"><p class="save-explanation" id="operatorGroupMessage"></p><div><button class="secondary-button" id="operatorGroupCancel" type="button">Отмена</button><button class="primary-button" id="operatorGroupSave" type="submit">Сохранить группу</button></div></footer>
  </form>`;
  document.body.append(dialog);
  const close = () => dialog.close();
  dialog.querySelector("#operatorGroupClose")?.addEventListener("click", close);
  dialog.querySelector("#operatorGroupCancel")?.addEventListener("click", close);
  dialog.querySelector("#operatorGroupNew")?.addEventListener("click", () =>
    void operatorSelectGroup("")
  );
  dialog.querySelector("#operatorGroupSelect")?.addEventListener("change", (event) =>
    void operatorSelectGroup(event.target.value)
  );
  dialog.querySelector("#operatorGroupListSearch")?.addEventListener("input", groupManagerFilterGroupList);
  dialog.querySelector("#operatorGroupSearch")?.addEventListener("input", operatorFilterGroupMembers);
  dialog.querySelector("#operatorGroupMembershipFilter")?.addEventListener("change", (event) => {
    operatorState.groupMemberFilter = event.target.value;
    operatorFilterGroupMembers();
  });
  dialog.querySelector("#operatorGroupStatusFilter")?.addEventListener("change", (event) => {
    operatorState.groupMemberStatus = event.target.value;
    operatorFilterGroupMembers();
  });
  dialog.querySelector("#operatorGroupPageSize")?.addEventListener("change", (event) => {
    operatorState.groupMemberPageSize = Number(event.target.value) || 50;
    operatorFilterGroupMembers();
  });
  dialog.querySelector("#operatorGroupSelectFound")?.addEventListener("click", () =>
    groupManagerApplyToFound("select")
  );
  dialog.querySelector("#operatorGroupRemoveFound")?.addEventListener("click", () =>
    groupManagerApplyToFound("remove")
  );
  dialog.querySelector("#operatorGroupClear")?.addEventListener("click", () => {
    operatorState.groupMemberIds.clear();
    operatorRenderGroupMembers();
  });
  dialog.querySelector("#operatorGroupArchive")?.addEventListener("click", async () => {
    const groupId = operatorState.groupEditingId;
    if (!groupId) return;
    if (!confirm("Переместить группу в архив? Она исчезнет из обычного выбора, но история документов сохранится.")) return;
    try {
      await api(spaceEndpoint(`/groups/${encodeURIComponent(groupId)}`), {
        method: "PUT",
        body: JSON.stringify({ status: "archived" })
      });
      dialog.close();
      await loadCurrentSpaceData();
      notify("✓", "Группа перемещена в архив", "История и ранее созданные снимки состава сохранены.");
    } catch (error) {
      const holder = dialog.querySelector("#operatorGroupError");
      holder.hidden = false;
      holder.textContent = error?.message || "Группу не удалось переместить в архив.";
    }
  });
  dialog.querySelector("#operatorGroupForm")?.addEventListener("submit", operatorSaveGroup);
}

async function operatorSelectGroup(groupId) {
  operatorState.groupEditingId = groupId || null;
  operatorState.groupMemberIds = new Set();
  operatorState.groupMemberPage = 1;
  const group = state.data.groups.find((candidate) => candidate.id === groupId);
  document.querySelector("#operatorGroupTitle").textContent = groupId
    ? "Изменить группу"
    : "Новая группа";
  document.querySelector("#operatorGroupSave").textContent = groupId
    ? "Сохранить изменения"
    : "Создать группу";
  document.querySelector("#operatorGroupName").value = group?.name || "";
  document.querySelector("#operatorGroupDescription").value = group?.description || "";
  const archive = document.querySelector("#operatorGroupArchive");
  if (archive) {
    archive.hidden = !groupId || group?.status === "archived";
  }
  operatorRenderGroupSelect();
  if (!groupId) {
    operatorRenderGroupMembers(new Set());
    return;
  }
  document.querySelector("#operatorGroupMembers").innerHTML =
    '<div class="employee-inline-loading"><span class="state-mark" aria-hidden="true"></span><span>Получаем полный состав группы…</span></div>';
  try {
    const body = await api(
      spaceEndpoint(`/groups/${encodeURIComponent(groupId)}/members`)
    );
    operatorRenderGroupMembers(
      new Set((body?.data || []).map((member) => member.entityId))
    );
  } catch (error) {
    const holder = document.querySelector("#operatorGroupError");
    holder.hidden = false;
    holder.textContent = error?.message || "Состав группы получить не удалось.";
  }
}

async function operatorOpenGroupManager({
  selectAll = false
} = {}) {
  operatorEnsureGroupDialog();
  if (!state.employee.loaded) await loadEmployees();
  await loadCurrentSpaceData();
  operatorState.groupEditingId = null;
  operatorState.groupMemberIds = new Set(
    selectAll
      ? state.data.employees
          .filter((employee) => employee.status === "active")
          .map(employeeId)
      : []
  );
  operatorState.groupMemberPage = 1;
  operatorState.groupMemberFilter = "all";
  operatorState.groupMemberStatus = "active";
  document.querySelector("#operatorGroupSearch").value = "";
  document.querySelector("#operatorGroupListSearch").value = "";
  document.querySelector("#operatorGroupMembershipFilter").value = "all";
  document.querySelector("#operatorGroupStatusFilter").value = "active";
  document.querySelector("#operatorGroupName").value = "";
  document.querySelector("#operatorGroupDescription").value = "";
  document.querySelector("#operatorGroupArchive").hidden = true;
  document.querySelector("#operatorGroupError").hidden = true;
  operatorRenderGroupSelect();
  operatorRenderGroupMembers();
  const dialog = document.querySelector("#operatorGroupDialog");
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => document.querySelector("#operatorGroupName")?.focus());
}

async function operatorSaveGroup(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  const name = document.querySelector("#operatorGroupName")?.value.trim() || "";
  const errorHolder = document.querySelector("#operatorGroupError");
  if (!name) {
    errorHolder.hidden = false;
    errorHolder.textContent = "Укажите понятное название группы.";
    return;
  }
  const entityIds = groupManagerEmployees()
    .map(employeeId)
    .filter((id) => operatorState.groupMemberIds.has(id));
  const button = document.querySelector("#operatorGroupSave");
  button.disabled = true;
  button.textContent = "Сохраняем весь состав…";
  errorHolder.hidden = true;
  try {
    let groupId = operatorState.groupEditingId;
    if (groupId) {
      await api(spaceEndpoint(`/groups/${encodeURIComponent(groupId)}`), {
        method: "PUT",
        body: JSON.stringify({
          name,
          description:
            document.querySelector("#operatorGroupDescription")?.value.trim() || null,
          status: "active"
        })
      });
    } else {
      const body = await api(spaceEndpoint("/groups"), {
        method: "POST",
        body: JSON.stringify({
          name,
          description:
            document.querySelector("#operatorGroupDescription")?.value.trim() || undefined
        })
      });
      groupId = body.data.id;
    }
    await api(spaceEndpoint(`/groups/${encodeURIComponent(groupId)}/members`), {
      method: "PUT",
      body: JSON.stringify({ entityIds })
    });
    document.querySelector("#operatorGroupDialog").close();
    await loadCurrentSpaceData();
    notify(
      "✓",
      "Группа сохранена",
      entityIds.length
        ? `В группе ${entityIds.length} сотрудников. Поиск и страницы не повлияли на состав.`
        : "Создана пустая группа. Добавьте участников перед выпуском документов."
    );
    window.dispatchEvent(
      new CustomEvent("docomator:groups-changed", {
        detail: { spaceId: state.currentSpaceId }
      })
    );
  } catch (cause) {
    const error = cause instanceof ApiError
      ? cause
      : new ApiError("Не удалось сохранить группу.");
    errorHolder.hidden = false;
    errorHolder.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = operatorState.groupEditingId
      ? "Сохранить изменения"
      : "Создать группу";
  }
}

function operatorInstallEmployeeToolbar() {
  const toolbar = document.querySelector(".employee-toolbar");
  if (!toolbar || document.querySelector("#operatorGroupsButton")) return;
  const button = document.createElement("button");
  button.id = "operatorGroupsButton";
  button.className = "secondary-button";
  button.type = "button";
  button.textContent = "Группы сотрудников";
  button.addEventListener("click", () => void operatorOpenGroupManager());
  toolbar.append(button);
}

document.addEventListener("click", (event) => {
  const editProperty = event.target.closest("[data-operator-edit-property]");
  if (editProperty) {
    const property = state.data.properties.find((candidate) => candidate.key === editProperty.dataset.operatorEditProperty);
    if (property) operatorRenderPropertyDialog(property);
  }
});

window.addEventListener("docomator:open-group-manager", (event) => {
  globalThis.docomatorSelectView?.("employees");
  void operatorOpenGroupManager({ selectAll: Boolean(event.detail?.selectAll) });
});

window.addEventListener("docomator:view-changed", (event) => {
  if (event.detail?.view === "employees") operatorInstallEmployeeToolbar();
});

operatorInstallEmployeeToolbar();
