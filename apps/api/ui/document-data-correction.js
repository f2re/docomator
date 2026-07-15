let generationPropertyDefinitions = [];
let generationCorrectionRenderToken = 0;
let generationCorrectionBusy = false;

function generationPropertyCandidates(fieldKey) {
  const normalized = String(fieldKey || "").trim().toLowerCase();
  const result = [normalized];
  for (const prefix of ["subject.", "person.", "recipient.", "user."]) {
    if (normalized.startsWith(prefix) && normalized.length > prefix.length) {
      result.push(normalized.slice(prefix.length));
    }
  }
  return [...new Set(result.filter(Boolean))];
}

function generationTemplateField(fieldKey, activeReleaseId) {
  const template = generationTemplates.find(
    (candidate) => candidate.id === activeReleaseId
  );
  const fields = Array.isArray(template?.manifest?.fields)
    ? template.manifest.fields
    : [];
  return fields.find((field) => field.key === fieldKey) || null;
}

function generationPropertyDefinition(fieldKey) {
  const candidates = generationPropertyCandidates(fieldKey);
  return (
    candidates
      .map((candidate) =>
        generationPropertyDefinitions.find(
          (definition) => definition.key === candidate
        )
      )
      .find(Boolean) || null
  );
}

function generationCorrectionInput(type, identifier) {
  const escaped = generationEscape(identifier);
  if (type === "boolean") {
    return `<select id="${escaped}" data-correction-value><option value="">Выберите</option><option value="true">Да</option><option value="false">Нет</option></select>`;
  }
  if (type === "number" || type === "integer") {
    return `<input id="${escaped}" data-correction-value type="number" ${type === "integer" ? 'step="1"' : 'step="any"'} placeholder="Введите число" />`;
  }
  if (type === "date") {
    return `<input id="${escaped}" data-correction-value type="date" />`;
  }
  if (type === "date-time") {
    return `<input id="${escaped}" data-correction-value type="datetime-local" />`;
  }
  if (type === "text") {
    return `<textarea id="${escaped}" data-correction-value rows="2" maxlength="20000" placeholder="Введите значение"></textarea>`;
  }
  return `<input id="${escaped}" data-correction-value type="text" maxlength="4000" placeholder="Введите значение" />`;
}

function generationCorrectionValue(control, valueType, label) {
  const raw = control.value;
  if (valueType === "boolean") {
    if (raw === "") throw new Error(`Выберите значение поля «${label}».`);
    return raw === "true";
  }
  if (valueType === "number" || valueType === "integer") {
    const normalized = String(raw).trim().replace(",", ".");
    if (normalized === "") throw new Error(`Заполните поле «${label}».`);
    const value = Number(normalized);
    if (!Number.isFinite(value)) {
      throw new Error(`Поле «${label}» должно содержать число.`);
    }
    if (valueType === "integer" && !Number.isInteger(value)) {
      throw new Error(`Поле «${label}» должно содержать целое число.`);
    }
    return value;
  }
  if (valueType === "date-time") {
    if (!raw) throw new Error(`Заполните поле «${label}».`);
    const value = new Date(raw);
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Поле «${label}» содержит недопустимые дату и время.`);
    }
    return value.toISOString();
  }
  if (String(raw).length === 0) {
    throw new Error(`Заполните поле «${label}».`);
  }
  return String(raw);
}

async function loadGenerationPropertyDefinitions() {
  const body = await generationFetchJson(
    "/api/v1/knowledge/property-definitions?limit=500"
  );
  generationPropertyDefinitions = Array.isArray(body.data) ? body.data : [];
  return generationPropertyDefinitions;
}

function ensureGenerationPropertyDefinition(fieldKey, label) {
  const existing = generationPropertyDefinition(fieldKey);
  if (existing) return existing;
  throw new Error(
    `Поле «${label}» не связано с карточкой сотрудника. Вернитесь в «Шаблоны» и выберите поле по названию.`
  );
}

function generationCorrectionRows(preflight) {
  const rows = [];
  for (const member of preflight.members.filter((candidate) => !candidate.ready)) {
    for (const missingField of member.missingRequired) {
      const templateField = generationTemplateField(
        missingField.key,
        preflight.activeReleaseId
      );
      rows.push({
        entityId: member.entityId,
        memberName: member.displayName,
        position: member.position,
        fieldKey: missingField.key,
        fieldLabel: missingField.label,
        valueType: templateField?.valueType || "string"
      });
    }
  }
  return rows;
}

async function appendGenerationCorrectionEditor(preflight, token) {
  const holder = document.querySelector("#documentGenerationStatus");
  if (!holder || preflight.missingValueCount === 0) return;
  try {
    await loadGenerationPropertyDefinitions();
    if (token !== generationCorrectionRenderToken) return;
    const rows = generationCorrectionRows(preflight);
    const correctableRows = rows.filter((row) => generationPropertyDefinition(row.fieldKey));
    const unlinkedRows = rows.filter((row) => !generationPropertyDefinition(row.fieldKey));
    const section = document.createElement("section");
    section.className = "generation-correction";
    section.innerHTML = `
      <div class="generation-history-heading">
        <div><p class="eyebrow">Быстрое исправление</p><h3>Заполнить недостающие значения здесь</h3></div>
        ${correctableRows.length > 0 ? '<button class="primary-button" id="generationCorrectionSave" type="button">Сохранить заполненные</button>' : ""}
      </div>
      <p class="generation-correction-description">Значения сохраняются в карточке сотрудника и будут доступны для следующих документов.</p>
      ${unlinkedRows.length > 0 ? `<div class="generation-state is-warning"><div><strong>Некоторые поля шаблона нужно связать заново</strong><p>Откройте «Шаблоны» и выберите понятное поле карточки для: ${generationEscape([...new Set(unlinkedRows.map((row) => row.fieldLabel))].join(", "))}.</p><button class="secondary-button" type="button" data-view-target="templates">Открыть шаблоны</button></div></div>` : ""}
      <div class="generation-correction-list">
        ${correctableRows
          .slice(0, 100)
          .map((row, index) => {
            const identifier = `generationCorrection_${index}`;
            return `
              <article class="generation-correction-item" data-correction-row data-entity-id="${generationEscape(row.entityId)}" data-field-key="${generationEscape(row.fieldKey)}" data-field-label="${generationEscape(row.fieldLabel)}" data-value-type="${generationEscape(row.valueType)}">
                <div class="generation-correction-person">
                  <strong>${row.position + 1}. ${generationEscape(row.memberName)}</strong>
                  <span>${generationEscape(row.fieldLabel)}</span>
                </div>
                <label class="generation-correction-control" for="${generationEscape(identifier)}">
                  <span>Значение</span>
                  ${generationCorrectionInput(row.valueType, identifier)}
                </label>
                <div class="generation-correction-result" data-correction-result></div>
              </article>`;
          })
          .join("")}
        ${correctableRows.length > 100 ? `<div class="generation-history-empty">Показаны первые 100 пропусков из ${correctableRows.length}. Сохраните их и повторите проверку, чтобы перейти к следующим.</div>` : ""}
      </div>`;
    holder.append(section);
    section
      .querySelector("#generationCorrectionSave")
      ?.addEventListener("click", saveGenerationCorrections);
  } catch (error) {
    if (token !== generationCorrectionRenderToken) return;
    holder.insertAdjacentHTML(
      "beforeend",
      `<div class="generation-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Форму исправления подготовить не удалось</strong><p>${generationEscape(error?.message || "Повторите проверку.")}</p></div></div>`
    );
  }
}

async function saveGenerationCorrectionRow(row) {
  const control = row.querySelector("[data-correction-value]");
  const result = row.querySelector("[data-correction-result]");
  if (!control || !result) return { saved: false, skipped: true };
  if (String(control.value).trim() === "") return { saved: false, skipped: true };
  const fieldKey = row.dataset.fieldKey || "";
  const fieldLabel = row.dataset.fieldLabel || fieldKey;
  const entityId = row.dataset.entityId || "";
  result.className = "generation-correction-result is-pending";
  result.textContent = "Сохраняем…";
  try {
    const definition = ensureGenerationPropertyDefinition(fieldKey, fieldLabel);
    const value = generationCorrectionValue(control, definition.valueType, fieldLabel);
    await generationFetchJson(
      `/api/v1/knowledge/entities/${encodeURIComponent(entityId)}/properties/${encodeURIComponent(definition.key)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          value,
          sourceType: "manual_document_preflight",
          sourceId: generationPreparedRun?.snapshotId || "document-preflight",
          confidence: 1
        })
      }
    );
    result.className = "generation-correction-result is-success";
    result.textContent = "Сохранено";
    control.disabled = true;
    return { saved: true, skipped: false };
  } catch (error) {
    result.className = "generation-correction-result is-error";
    result.textContent = error?.message || "Не сохранено";
    return { saved: false, skipped: false };
  }
}

async function saveGenerationCorrections() {
  if (generationCorrectionBusy || generationBusy) return;
  const button = document.querySelector("#generationCorrectionSave");
  const rows = [...document.querySelectorAll("[data-correction-row]")];
  if (!button || rows.length === 0) return;
  generationCorrectionBusy = true;
  button.disabled = true;
  button.textContent = "Сохраняем значения…";
  let saved = 0;
  let attempted = 0;
  for (const row of rows) {
    const result = await saveGenerationCorrectionRow(row);
    if (!result.skipped) attempted += 1;
    if (result.saved) saved += 1;
  }
  generationCorrectionBusy = false;
  button.disabled = false;
  button.textContent = "Сохранить заполненные";
  if (attempted === 0) {
    const description = document.querySelector(".generation-correction-description");
    if (description) {
      description.textContent = "Введите хотя бы одно значение, затем сохраните заполненные строки.";
    }
    return;
  }
  if (saved > 0) {
    await refreshPreparedGenerationPreflight();
  }
}

const baseRenderGenerationPreflight = renderGenerationPreflight;
renderGenerationPreflight = function renderGenerationPreflightWithCorrection(preflight) {
  baseRenderGenerationPreflight(preflight);
  generationCorrectionRenderToken += 1;
  const token = generationCorrectionRenderToken;
  void appendGenerationCorrectionEditor(preflight, token);
};
