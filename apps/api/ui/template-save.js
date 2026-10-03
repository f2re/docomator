// The user saves a configured template, not a hand-built test case. The existing
// server trial endpoints still compile/reverse-read before immutable activation.
let configuredTemplateSave = null;

function configuredTemplateSample(field, definitions) {
  const definition = definitions.find((item) => item.key === field.key);
  const choices = definition?.validation?.enum;
  if (field.valueType === "enum" && Array.isArray(choices) && choices.length) return choices[0];
  if (field.valueType === "boolean") return true;
  if (field.valueType === "number" || field.valueType === "integer") return 1;
  if (field.valueType === "date") return "2026-01-15";
  if (field.valueType === "date-time") return "2026-01-15T09:00:00.000Z";
  return field.formatter?.kind === "person-name.ru" || /фио|фамил|name/iu.test(`${field.label} ${field.key}`)
    ? "Иванов Иван Иванович" : "Пример";
}

async function saveConfiguredTemplate(button) {
  const context = globalThis.docomatorCaptureSpaceContext();
  const draftId = structureDraft?.id || globalThis.docomatorTemplateWizard?.artifacts().draftId;
  if (!context.spaceId || !draftId || configuredTemplateSave) return;
  const run = { context, draftId };
  configuredTemplateSave = run;
  const current = () => context.isCurrent() &&
    draftId === (structureDraft?.id || globalThis.docomatorTemplateWizard?.artifacts().draftId);
  let finalMessage = "";
  let finalState = "";
  let message = document.querySelector("#configuredTemplateSaveStatus");
  if (!message) {
    message = document.createElement("p");
    message.id = "configuredTemplateSaveStatus";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    document.querySelector("#templateWizard .template-wizard-navigation")?.before(message);
  }
  const controls = [...document.querySelectorAll("#templateWizard [data-save-configured-template]")];
  const disabled = controls.map((control) => control.disabled);
  controls.forEach((control) => { control.disabled = true; });
  const previousText = button.textContent;
  button.textContent = "Сохраняем шаблон…";
  if (message) {
    message.className = "is-loading";
    message.textContent = "Собираем рабочую версию. Исходный документ и настроенные поля сохраняются.";
  }
  try {
    const draftBody = await activationFetchJson(context.endpoint(`/template-drafts/${encodeURIComponent(draftId)}`));
    if (!current()) return;
    const draft = draftBody.data;
    if (!draft || !Array.isArray(draft.fields) || draft.fields.length === 0) {
      throw new Error("Сначала свяжите хотя бы одно место документа с полем.");
    }
    const snapshot = JSON.stringify([draft.sourceSha256, draft.fields, draft.repeatBinding]);
    const multiple = draft.fields.length > 1 || Boolean(draft.repeatBinding);
    const definitions = Array.isArray(structurePropertyDefinitions) ? structurePropertyDefinitions : [];
    const values = draft.fields.map((field) => ({ fieldId: field.id,
      value: configuredTemplateSample(field, definitions) }));
    const tested = await activationFetchJson(
      context.endpoint(`/template-drafts/${encodeURIComponent(draftId)}/${multiple ? "trial-all" : "trial"}`),
      { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(multiple ? { values } : values[0]) }
    );
    if (!current()) return;
    const latest = await activationFetchJson(context.endpoint(`/template-drafts/${encodeURIComponent(draftId)}`));
    if (!current()) return;
    if (JSON.stringify([latest.data.sourceSha256, latest.data.fields, latest.data.repeatBinding]) !== snapshot) {
      throw new Error("Настройки шаблона изменились во время сохранения. Повторите сохранение актуальной разметки.");
    }
    const versionId = tested.data?.version?.id;
    if (!versionId) throw new Error("Сервер не подтвердил сборку шаблона. Настроенные поля сохранены; повторите действие.");
    const collection = multiple ? "template-multi-test-versions" : "template-test-versions";
    const activated = await activationFetchJson(
      context.endpoint(`/${collection}/${encodeURIComponent(versionId)}/activate`), { method: "POST" }
    );
    if (!current()) return;
    const wizard = globalThis.docomatorTemplateWizard;
    wizard?.completeSaved({ sourceId: draft.sourceRecordId, draftId, versionId,
      versionKind: multiple ? "multi" : "single", activeId: activated.data.active.id });
    finalState = "is-success";
    finalMessage = "Шаблон сохранён и доступен для формирования документов.";
    try { await renderActivationSuccess(activated); }
    catch { finalMessage += " Обновить каталог не удалось; откройте раздел заново."; }
  } catch (error) {
    if (!current()) return;
    finalState = "is-error";
    finalMessage = `${error?.message || "Сохранить рабочую версию не удалось."} Исходник и настроенные поля сохранены. Повторите сохранение.${error?.operationId ? ` Идентификатор операции: ${error.operationId}.` : ""}`;
  } finally {
    if (configuredTemplateSave === run) configuredTemplateSave = null;
    controls.forEach((control, index) => { if (current() && control.isConnected) control.disabled = disabled[index]; });
    if (current() && button.isConnected) { button.textContent = previousText; button.disabled = false; }
    if (current()) {
      globalThis.docomatorTemplateWizard?.render();
      if (message?.isConnected && finalMessage) {
        message.className = finalState;
        message.textContent = finalMessage;
        if (finalState === "is-error") message.scrollIntoView({ block: "nearest" });
      }
    }
  }
}

document.addEventListener("click", (event) => {
  const button = event.target?.closest?.("[data-save-configured-template]");
  if (button) void saveConfiguredTemplate(button);
});


document.addEventListener("docomator:space-changed", () => {
  if (configuredTemplateSave && !configuredTemplateSave.context.isCurrent()) configuredTemplateSave = null;
  document.querySelector("#configuredTemplateSaveStatus")?.remove();
});
document.querySelector("#documentIntakeFile")?.addEventListener("change", () => {
  document.querySelector("#configuredTemplateSaveStatus")?.remove();
});
