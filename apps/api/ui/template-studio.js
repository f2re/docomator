// The studio renders only confirmed draft coordinates; Office bytes remain server-owned.
let studioEditRun = null;
let studioGenerationIntent = null;

function studioToolbar(report) {
  const count = Array.isArray(structureDraft?.fields) ? structureDraft.fields.length : 0;
  return `<header class="studio-toolbar" aria-label="Инструменты разметки">
    <div class="studio-document-title"><h3>${structureEscape(report.fileName)}</h3><span>${structureEscape(templateWizardSpaceName(templateWizardSpaceId()))}</span></div>
    <div class="studio-toolbar-actions">
      <button type="button" class="secondary-button" data-studio-fields aria-expanded="false" aria-controls="studioFieldList">Поля <span id="studioFieldCount">${count}</span></button>
      <label class="studio-zoom"><span>Масштаб</span><select aria-label="Масштаб документа" data-studio-zoom><option value="fit">По ширине</option><option value="100">100%</option><option value="125">125%</option><option value="150">150%</option></select></label>
      <button type="button" class="primary-button" id="documentTemplateSave" data-save-configured-template${count ? '' : ' disabled'}>Сохранить шаблон</button>
    </div>
  </header><p class="studio-direction">Выделите текст или выберите ячейку → назначьте поле → сохраните шаблон.</p>
  <section id="studioFieldList" class="studio-field-list" aria-label="Назначенные поля" hidden></section>`;
}

function studioRefreshBindings() {
  const fields = Array.isArray(structureDraft?.fields) ? structureDraft.fields : [];
  const count = document.querySelector('#studioFieldCount');
  if (count) count.textContent = String(fields.length);
  const save = document.querySelector('#documentTemplateSave');
  if (save) { const editing = Boolean(document.querySelector('#studioEditForm')) || Boolean(document.querySelector('#documentFieldSave:not([hidden])')); save.classList.toggle('primary-button', !editing); save.classList.toggle('secondary-button', editing); }
  if (save) save.disabled = fields.length === 0 || fieldBusy || rowEditorBusy || Boolean(studioEditRun) || Boolean(configuredTemplateSave);
  const list = document.querySelector('#studioFieldList');
  if (list) {
    list.innerHTML = fields.length ? fields.map((field) => `<button type="button" class="secondary-button" data-studio-field="${structureEscape(field.id)}">${structureEscape(field.label)}${field.required ? ' · обязательное' : ''}</button>`).join('') : '<p>Назначенных полей пока нет. Выберите место в документе.</p>';
  }
  document.querySelectorAll('#documentStructureResult [data-structure-id]').forEach((target) => {
    const field = fields.find((item) => item.elementId === target.dataset.structureId || item.binding?.elementId === target.dataset.structureId);
    target.classList.toggle('is-bound', Boolean(field));
    target.querySelector(':scope > .studio-binding-label')?.remove();
    if (!field) return;
    const marker = document.createElement('span');
    marker.className = 'studio-binding-label';
    marker.textContent = `Поле: ${field.label}`;
    marker.setAttribute('aria-hidden', 'true');
    target.append(marker);
  });
}

function studioCloseInspector() {
  if (fieldBusy || rowEditorBusy || studioEditRun || configuredTemplateSave) return;
  const id = selectedStructureElement?.id;
  selectedStructureElement = null;
  selectedStructureTextRange = null;
  const panel = document.querySelector('#documentStructureSelection');
  if (panel) { panel.hidden = true; panel.replaceChildren(); }
  const target = id ? document.querySelector(`[data-structure-id="${CSS.escape(id)}"]`) : null;
  target?.classList.remove('is-selected');
  target?.setAttribute('aria-pressed', 'false');
  target?.focus({ preventScroll: true });
  studioRefreshBindings();
}

function studioExistingField(element) {
  return (structureDraft?.fields || []).find((field) => field.elementId === element.id || field.binding?.elementId === element.id);
}

function studioRenderExistingField(element) {
  const field = studioExistingField(element);
  const panel = document.querySelector('#documentStructureSelection');
  if (!field || !panel) return false;
  selectedStructureElement = element;
  selectedStructureTextRange = null;
  document.querySelectorAll('#documentStructureResult [data-structure-id]').forEach((target) => {
    const selected = target.dataset.structureId === element.id;
    target.classList.toggle('is-selected', selected);
    target.setAttribute('aria-pressed', String(selected));
  });
  const definitions = structurePropertyDefinitions.filter((item) => item.key !== field.key);
  panel.hidden = false;
  panel.innerHTML = `<div class="studio-inspector-heading"><strong>${structureEscape(structureLocation(element))}</strong><button type="button" class="quiet-button" data-studio-close aria-label="Закрыть назначение поля">×</button></div>
    <p>Назначено: <strong>${structureEscape(field.label)}</strong></p>
    <form id="studioEditForm" data-field-id="${structureEscape(field.id)}">
      <label><span>Поле для подстановки</span><select id="studioEditProperty" data-searchable-select><option value="${structureEscape(field.key)}">${structureEscape(field.label)}</option>${definitions.map((item) => `<option value="${structureEscape(item.key)}">${structureEscape(item.label)}</option>`).join('')}</select></label>
      <label class="structure-required-field"><input type="checkbox" id="studioEditRequired"${field.required ? ' checked' : ''}/><span>Обязательное поле</span></label>
      <p class="studio-field-format">Текущее оформление сохраняется при изменении обязательности.</p>
      <div class="studio-edit-actions"><button class="primary-button" type="submit">Сохранить назначение</button><button class="quiet-button" type="button" data-studio-remove="${structureEscape(field.id)}">Снять назначение</button></div>
      <p role="status" id="studioEditStatus">Снятие назначения не удаляет текст документа и данные карточек.</p>
    </form>`;
  studioRefreshBindings();
  globalThis.docomatorSearchableSelect?.enhanceAll(panel);
  panel.querySelector('#studioEditForm').addEventListener('submit', (event) => { event.preventDefault(); void studioChangeField(field, false); });
  rowEditorInstallEntry(element);
  return true;
}

function studioPreservedFormatter(field) {
  const formatter = field.formatter;
  if (formatter?.kind === 'person-name.ru') return { personName: { sourceOrder: formatter.sourceOrder, pattern: formatter.pattern } };
  if (formatter?.kind === 'number.ru' && formatter.fractionDigits !== null) return { decimalPlaces: formatter.fractionDigits };
  if (formatter?.kind === 'date-time.ru') return { timeZone: formatter.timeZone };
  return {};
}

async function studioChangeField(field, remove) {
  if (studioEditRun || fieldBusy || configuredTemplateSave || !structureDraft?.id) return;
  const context = globalThis.docomatorCaptureSpaceContext();
  const draftId = structureDraft.id;
  const panel = document.querySelector('#documentStructureSelection');
  const form = panel?.querySelector('#studioEditForm');
  const message = form?.querySelector('#studioEditStatus');
  if (!form || !message || form.dataset.fieldId !== field.id) return;
  const key = form.querySelector('#studioEditProperty').value;
  const definition = key === field.key ? field : structurePropertyDefinitions.find((item) => item.key === key);
  if (!remove && !definition) return;
  const required = form.querySelector('#studioEditRequired').checked;
  const operation = { context, draftId, fieldId: field.id };
  studioEditRun = operation;
  const current = () => studioEditRun === operation && context.isCurrent() && structureDraft?.id === draftId && form.isConnected;
  const controls = [...form.querySelectorAll('button, input, select')];
  const disabled = controls.map((item) => item.disabled);
  controls.forEach((item) => { item.disabled = true; });
  message.className = 'is-loading';
  message.textContent = remove ? 'Снимаем назначение…' : 'Сохраняем назначение…';
  studioRefreshBindings();
  try {
    const endpoint = context.endpoint(`/template-drafts/${encodeURIComponent(draftId)}`);
    // A refresh prevents an old inspector from silently overwriting a newer field.
    const before = await structureFetchJson(endpoint);
    if (!current()) return;
    const latest = before.data?.fields?.find((item) => item.id === field.id);
    if (!latest && !remove) throw new Error('Назначение уже снято. Выберите место заново.');
    if (latest && JSON.stringify(latest) !== JSON.stringify(field)) { structureDraft = before.data; studioRefreshBindings(); throw new Error('Назначение изменилось. Закройте панель и откройте поле заново.'); }
    let confirmedField = latest;
    if (latest) {
      try {
        const response = await structureFetchJson(`${endpoint}/fields/${encodeURIComponent(field.id)}`, remove ? { method: 'DELETE' } : {
          method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, label: definition.label, valueType: definition.valueType, required, ...(key === field.key ? studioPreservedFormatter(latest) : {}) })
        });
        if (!remove) confirmedField = response.data.field;
      } catch (error) {
        if (!remove) throw error;
        const checked = await structureFetchJson(endpoint);
        if (checked.data?.fields?.some((item) => item.id === field.id)) throw error;
      }
    }
    if (!current()) return;
    structureDraft.fields = remove ? structureDraft.fields.filter((item) => item.id !== field.id) : structureDraft.fields.map((item) => item.id === field.id ? confirmedField : item);
    if (remove && structureDraft.fields.length === 0) structureDraft.repeatBinding = null;
    let refreshFailed = false;
    try {
      const updated = await structureFetchJson(endpoint);
      if (!current()) return;
      structureDraft = updated.data;
    } catch { refreshFailed = true; }
    if (!current()) return;
    globalThis.docomatorTemplateWizard?.resetFrom(3);
    studioEditRun = null;
    studioRefreshBindings();
    if (remove) {
      const element = selectedStructureElement;
      if (element) renderStructureSelection(element);
      const choice = document.querySelector('#documentFieldProperty');
      (choice?.nextElementSibling?.querySelector('.searchable-select-trigger') || choice)?.focus({ preventScroll: true });
    } else {
      studioRenderExistingField(selectedStructureElement);
      const status = document.querySelector('#studioEditStatus');
      document.querySelector('#studioEditForm button[type=submit]')?.focus({ preventScroll: true });
      if (status) { status.className = 'is-success'; status.textContent = 'Назначение сохранено. Сохраните шаблон, чтобы применять изменение в новых документах.' + (refreshFailed ? ' Обновить список не удалось; подтверждённое изменение сохранено.' : ''); }
    }
  } catch (error) {
    if (!current()) return;
    message.className = 'is-error';
    message.textContent = `${error?.message || 'Сервер не подтвердил изменение.'} Исходник сохранён, введённые настройки остались в форме. Повторите действие.${error?.operationId ? ` Идентификатор операции: ${error.operationId}.` : ''}`;
  } finally {
    if (studioEditRun === operation) studioEditRun = null;
    if (context.isCurrent() && structureDraft?.id === draftId && form.isConnected) controls.forEach((item, index) => { item.disabled = disabled[index]; });
    studioRefreshBindings();
  }
}

function studioSavedAction(activeId, spaceId) {
  const holder = document.querySelector('#configuredTemplateSaveStatus');
  if (!holder || templateWizardSpaceId() !== spaceId) return;
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'primary-button';
  action.textContent = 'Создать документы';
  action.dataset.viewTarget = 'generation';
  action.addEventListener('click', () => { studioGenerationIntent = { activeId, spaceId }; });
  holder.after(action);
  action.dataset.studioHandoff = '';
}

function studioPrioritizeTemplates(templates, spaceId) {
  const intent = studioGenerationIntent;
  if (!intent || intent.spaceId !== spaceId) return templates;
  const selected = templates.find((item) => item.id === intent.activeId);
  if (!selected) return templates;
  studioGenerationIntent = null;
  return [selected, ...templates.filter((item) => item.id !== selected.id)];
}

document.addEventListener('click', (event) => {
  if (event.target.closest?.('[data-studio-close]')) { studioCloseInspector(); return; }
  const fields = event.target.closest?.('[data-studio-fields]');
  if (fields) {
    const list = document.querySelector('#studioFieldList');
    if (list) { list.hidden = !list.hidden; fields.setAttribute('aria-expanded', String(!list.hidden)); }
    return;
  }
  const bound = event.target.closest?.('[data-studio-field]');
  if (bound) {
    const field = structureDraft?.fields?.find((item) => item.id === bound.dataset.studioField);
    const element = structureReport?.elements?.find((item) => item.id === field?.elementId || item.id === field?.binding?.elementId);
    if (!element || fieldBusy || configuredTemplateSave || studioEditRun) return;
    renderStructureSelection(element);
    const target = document.querySelector(`[data-structure-id="${CSS.escape(element.id)}"]`);
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    document.querySelector('#studioEditProperty')?.focus({ preventScroll: true });
    return;
  }
  const remove = event.target.closest?.('[data-studio-remove]');
  if (remove) {
    const field = structureDraft?.fields?.find((item) => item.id === remove.dataset.studioRemove);
    if (field) void studioChangeField(field, true);
  }
});
document.addEventListener('change', (event) => {
  if (!event.target.matches?.('[data-studio-zoom]')) return;
  const editor = event.target.closest('.template-visual-editor, .studio-editor');
  if (editor) editor.dataset.studioScale = ['100', '125', '150'].includes(event.target.value) ? event.target.value : 'fit';
});
document.addEventListener('docomator:space-changed', () => {
  studioEditRun = null;
  studioGenerationIntent = null;
  document.querySelectorAll('[data-studio-handoff]').forEach((item) => item.remove());
});
