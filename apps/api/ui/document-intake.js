const MAX_FILE_BYTES = 32 * 1024 * 1024;

const elements = {
  input: document.querySelector("#documentIntakeFile"),
  dropZone: document.querySelector("#documentIntakeDropZone"),
  selected: document.querySelector("#documentIntakeSelected"),
  inspectButton: document.querySelector("#documentIntakeButton"),
  clearButton: document.querySelector("#documentIntakeClear"),
  status: document.querySelector("#documentIntakeStatus"),
  statusIcon: document.querySelector("#documentIntakeStatusIcon"),
  statusTitle: document.querySelector("#documentIntakeStatusTitle"),
  statusDetail: document.querySelector("#documentIntakeStatusDetail"),
  result: document.querySelector("#documentIntakeResult")
};

let selectedFile = null;
let inspecting = false;
let saving = false;
let lastReport = null;
let spaces = [];

const templateWizardStates = new Map();
const templateWizardCopy = {
  1: {
    question: "Какой документ станет шаблоном?",
    hint: "Выберите готовый DOCX или XLSX. Система проверит его и попросит отдельно подтвердить сохранение."
  },
  2: {
    question: "Какие сведения подставлять в документ?",
    hint: "Покажите место в документе и выберите понятное поле карточки сотрудника. Техническую связь создаст система."
  },
  3: {
    question: "Все ли поля заполняются без ошибок?",
    hint: "Введите пробные значения. Система заполнит безопасную копию и сама считает результат обратно."
  },
  4: {
    question: "Готов ли шаблон к работе?",
    hint: "Просмотрите PDF и подтвердите активацию. Только после этого шаблон появится в списке для создания документов."
  }
};

function templateWizardSpaceId() {
  const current = String(globalThis.docomatorCurrentSpaceId || "").trim();
  const select = document.querySelector("#documentQuarantineSpace");
  if (current !== "") return current;
  return String(select?.value || "").trim();
}

function templateWizardState(spaceId = templateWizardSpaceId()) {
  const key = spaceId || "__waiting__";
  if (!templateWizardStates.has(key)) {
    let restored = null;
    if (key !== "__waiting__") {
      try {
        const raw = sessionStorage.getItem(`docomator.templateWizard.v1:${key}`);
        const value = raw ? JSON.parse(raw) : null;
        if (value?.version === 1 && value.spaceId === key) {
          restored = {
            current:
              Number.isInteger(value.current) && value.current >= 1 && value.current <= 4
                ? value.current
                : 1,
            completed: new Set(
              Array.isArray(value.completed)
                ? value.completed.filter((step) => Number.isInteger(step) && step >= 1 && step <= 4)
                : []
            ),
            artifacts: value.artifacts && typeof value.artifacts === "object" ? value.artifacts : {},
            lastCompleted: 0
          };
        }
      } catch {
        restored = null;
      }
    }
    templateWizardStates.set(
      key,
      restored || { current: 1, completed: new Set(), artifacts: {}, lastCompleted: 0 }
    );
  }
  return templateWizardStates.get(key);
}

function persistTemplateWizardState(spaceId, state) {
  if (!spaceId || spaceId === "__waiting__") return;
  try {
    sessionStorage.setItem(
      `docomator.templateWizard.v1:${spaceId}`,
      JSON.stringify({
        version: 1,
        spaceId,
        current: state.current,
        completed: [...state.completed].sort(),
        artifacts: state.artifacts || {}
      })
    );
  } catch {
    // Серверные данные остаются источником истины; недоступное хранилище не блокирует работу.
  }
}

async function validateTemplateWizardState(spaceId) {
  if (!spaceId) return;
  const state = templateWizardState(spaceId);
  const artifacts = state.artifacts || {};
  const loadArtifact = async (path) => {
    try {
      const response = await fetch(path, {
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      if (response.ok) {
        const body = await response.json();
        return body?.data && typeof body.data === "object" ? body.data : false;
      }
      return response.status === 404 ? false : null;
    } catch {
      return null;
    }
  };
  const invalidateFrom = (step) => {
    for (const completed of [...state.completed]) {
      if (completed >= step) state.completed.delete(completed);
    }
    state.current = Math.min(state.current, step);
  };

  let source = null;
  if (state.completed.has(1)) {
    if (typeof artifacts.sourceId !== "string") invalidateFrom(1);
    else {
      source = await loadArtifact(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/document-sources/${encodeURIComponent(artifacts.sourceId)}`
      );
      if (
        source === false ||
        (source !== null &&
          (source.id !== artifacts.sourceId || source.spaceId !== spaceId))
      ) invalidateFrom(1);
    }
  }
  if (state.completed.has(2)) {
    if (typeof artifacts.draftId !== "string") invalidateFrom(2);
    else {
      const draft = await loadArtifact(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(artifacts.draftId)}`
      );
      if (
        draft === false ||
        (draft !== null &&
          (draft.id !== artifacts.draftId ||
            draft.spaceId !== spaceId ||
            draft.sourceRecordId !== artifacts.sourceId ||
            (source !== null &&
              source !== false &&
              draft.sourceSha256 !== source.sha256)))
      ) invalidateFrom(2);
    }
  }
  if (state.completed.has(3)) {
    const collection = artifacts.versionKind === "multi"
      ? "template-multi-test-versions"
      : "template-test-versions";
    if (typeof artifacts.versionId !== "string") invalidateFrom(3);
    else {
      const valid = await loadArtifact(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/${collection}/${encodeURIComponent(artifacts.versionId)}`
      );
      if (valid === false) invalidateFrom(3);
    }
  }
  if (state.completed.has(4)) {
    if (typeof artifacts.activeId !== "string") invalidateFrom(4);
    else {
      const valid = await loadArtifact(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/active-templates/${encodeURIComponent(artifacts.activeId)}`
      );
      if (valid === false) invalidateFrom(4);
    }
  }
  persistTemplateWizardState(spaceId, state);
  if (templateWizardSpaceId() === spaceId) renderTemplateWizard();
}

function templateWizardSpaceName(spaceId) {
  const select = document.querySelector("#documentQuarantineSpace");
  const option = [...(select?.options || [])].find((item) => item.value === spaceId);
  const chip = document.querySelector("#currentSpaceChipText")?.textContent?.trim();
  return option?.textContent?.trim() || chip || "Текущий раздел";
}

function templateWizardAvailableStep(state) {
  let step = 1;
  while (step < 4 && state.completed.has(step)) step += 1;
  return step;
}

function normalizeTemplateWizardState(state) {
  let firstMissing = 1;
  while (firstMissing <= 4 && state.completed.has(firstMissing)) firstMissing += 1;
  for (const completed of [...state.completed]) {
    if (completed > firstMissing) state.completed.delete(completed);
  }
  const highestReachable = Math.min(4, firstMissing);
  if (state.current < 1 || state.current > highestReachable) state.current = highestReachable;
}

function renderTemplateWizard() {
  const root = document.querySelector("#templateWizard");
  if (!root) return;
  const spaceId = templateWizardSpaceId();
  const state = templateWizardState(spaceId);
  normalizeTemplateWizardState(state);
  const available = templateWizardAvailableStep(state);
  if (state.current > available && !state.completed.has(state.current)) {
    state.current = available;
  }
  const current = state.current;
  const copy = templateWizardCopy[current];
  const stepLabel = root.querySelector("#templateWizardStep");
  const question = root.querySelector("#templateWizardQuestion");
  const hint = root.querySelector("#templateWizardHint");
  const space = root.querySelector("#templateWizardSpace");
  const back = root.querySelector("#templateWizardBack");
  const status = root.querySelector("#templateWizardStatus");
  if (stepLabel) stepLabel.textContent = `Шаг ${current} из 4`;
  if (question) question.textContent = copy.question;
  if (hint) hint.textContent = copy.hint;
  if (space) space.textContent = templateWizardSpaceName(spaceId);
  if (back) back.hidden = current === 1;
  if (status) {
    if (state.lastCompleted === current - 1) {
      status.textContent = `Шаг ${state.lastCompleted} завершён. ${copy.hint}`;
    } else if (current === 2 && state.completed.has(1) && !elements.input?.files?.[0]) {
      status.textContent =
        "Исходник сохранён и проверен. Можно продолжить: система построит структуру из серверной копии, повторно выбирать файл не нужно.";
    } else if (current === 4 && state.completed.has(4)) {
      status.textContent = "Шаблон готов и доступен для создания документов в текущем разделе.";
    } else {
      status.textContent =
        current === 1
          ? "Начните с выбора документа. Переходы между шагами не очищают формы."
          : "Можно вернуться назад: выбранный файл и введённые значения останутся на месте.";
    }
  }

  root.querySelectorAll("[data-template-step]").forEach((item) => {
    const step = Number(item.getAttribute("data-template-step"));
    const button = item.querySelector("[data-template-wizard-go]");
    const isCurrent = step === current;
    const isComplete = state.completed.has(step);
    const isAvailable = step <= available || isComplete;
    item.dataset.wizardState = isCurrent
      ? "current"
      : isComplete
        ? "complete"
        : isAvailable
          ? "available"
          : "locked";
    if (button) {
      button.disabled = !isAvailable;
      if (isCurrent) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
      button.setAttribute(
        "aria-label",
        `${step}. ${button.querySelector("strong")?.textContent || "Шаг"}${isComplete ? ". Завершено" : isCurrent ? ". Текущий шаг" : isAvailable ? "" : ". Сначала завершите предыдущий шаг"}`
      );
    }
  });

  root.querySelectorAll("[data-template-wizard-panel]").forEach((panel) => {
    panel.hidden = Number(panel.getAttribute("data-template-wizard-panel")) !== current;
  });
  const singleTrial = root.querySelector("#templateTrialPanel");
  const multiTrial = root.querySelector("#templateMultiTrialPanel");
  if (current === 3 && singleTrial && multiTrial) {
    const useAllFields = Boolean(multiTrial.querySelector("#templateMultiTrialForm"));
    singleTrial.hidden = useAllFields;
    multiTrial.hidden = !useAllFields;
  }
}

function moveTemplateWizardTo(step, focusHeading = true) {
  const spaceId = templateWizardSpaceId();
  const state = templateWizardState(spaceId);
  const available = templateWizardAvailableStep(state);
  if (!Number.isInteger(step) || step < 1 || step > 4 || step > available) return;
  state.current = step;
  state.lastCompleted = 0;
  persistTemplateWizardState(spaceId, state);
  renderTemplateWizard();
  if (focusHeading) {
    requestAnimationFrame(() =>
      document.querySelector("#templateWizardQuestion")?.focus({ preventScroll: true })
    );
  }
}

function completeTemplateWizardStep(step, artifacts = {}) {
  const spaceId = templateWizardSpaceId();
  if (!spaceId || !Number.isInteger(step) || step < 1 || step > 4) return;
  const state = templateWizardState(spaceId);
  state.completed.add(step);
  state.lastCompleted = step;
  state.artifacts = { ...(state.artifacts || {}), ...artifacts };
  if (step < 4) state.current = step + 1;
  else state.current = 4;
  persistTemplateWizardState(spaceId, state);
  renderTemplateWizard();
  document.dispatchEvent(
    new CustomEvent("docomator:template-wizard-step-completed", {
      detail: { spaceId, step }
    })
  );
  requestAnimationFrame(() =>
    document.querySelector("#templateWizardQuestion")?.focus({ preventScroll: true })
  );
}

function rememberTemplateWizardArtifacts(artifacts = {}) {
  const spaceId = templateWizardSpaceId();
  if (!spaceId || typeof artifacts !== "object" || artifacts === null) return;
  const state = templateWizardState(spaceId);
  state.artifacts = { ...(state.artifacts || {}), ...artifacts };
  persistTemplateWizardState(spaceId, state);
}

function resetTemplateWizardFrom(step = 1) {
  const spaceId = templateWizardSpaceId();
  const state = templateWizardState(spaceId);
  for (const completed of [...state.completed]) {
    if (completed >= step) state.completed.delete(completed);
  }
  state.lastCompleted = 0;
  if (step <= 1) state.artifacts = {};
  else if (step <= 2) {
    delete state.artifacts.draftId;
    delete state.artifacts.versionId;
    delete state.artifacts.versionKind;
    delete state.artifacts.activeId;
  } else if (step <= 3) {
    delete state.artifacts.versionId;
    delete state.artifacts.versionKind;
    delete state.artifacts.activeId;
  } else {
    delete state.artifacts.activeId;
  }
  state.current = Math.min(state.current, step);
  persistTemplateWizardState(spaceId, state);
  renderTemplateWizard();
}

function setTemplateWizardSpace(spaceId) {
  if (!spaceId) return;
  renderTemplateWizard();
  void validateTemplateWizardState(spaceId);
}

function initializeTemplateWizard() {
  const root = document.querySelector("#templateWizard");
  if (!root) return;
  root.querySelector("#templateWizardQuestion")?.setAttribute("tabindex", "-1");
  root.querySelectorAll("[data-template-wizard-go]").forEach((button) => {
    button.addEventListener("click", () =>
      moveTemplateWizardTo(Number(button.getAttribute("data-template-wizard-go")))
    );
  });
  root.querySelector("#templateWizardBack")?.addEventListener("click", () => {
    const state = templateWizardState();
    moveTemplateWizardTo(Math.max(1, state.current - 1));
  });
  const dynamicStages = root.querySelector("#templateWizardDynamicStages");
  if (dynamicStages) {
    new MutationObserver(renderTemplateWizard).observe(dynamicStages, {
      childList: true,
      subtree: true
    });
  }
  renderTemplateWizard();
}

globalThis.docomatorTemplateWizard = {
  artifacts: () => ({ ...(templateWizardState().artifacts || {}) }),
  complete: completeTemplateWizardStep,
  isComplete: (step) => templateWizardState().completed.has(step),
  remember: rememberTemplateWizardArtifacts,
  render: renderTemplateWizard,
  resetFrom: resetTemplateWizardFrom,
  spaceId: templateWizardSpaceId
};

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
      })[character]
  );
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} байт`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function setStatus(kind, icon, title, detail) {
  elements.status.className = `intake-status is-${kind}`;
  elements.statusIcon.textContent = icon;
  elements.statusTitle.textContent = title;
  elements.statusDetail.textContent = detail;
  elements.status.setAttribute("aria-busy", String(kind === "loading"));
}

function resetResult() {
  elements.result.innerHTML = `
    <div class="intake-placeholder">
      <span aria-hidden="true">🔎</span>
      <h3>Отчёт появится после проверки</h3>
      <p>Система покажет структуру пакета, ограничения и замечания. Файл не сохраняется без отдельного подтверждения.</p>
    </div>`;
}

function clearSelection({ resetWizard = true } = {}) {
  if (resetWizard) globalThis.docomatorTemplateWizard?.resetFrom(1);
  selectedFile = null;
  lastReport = null;
  elements.input.value = "";
  elements.selected.hidden = true;
  elements.inspectButton.disabled = true;
  elements.inspectButton.hidden = false;
  elements.clearButton.hidden = true;
  elements.dropZone.classList.remove("has-file", "is-error");
  setStatus(
    "idle",
    "1",
    "Выберите документ",
    "Поддерживаются DOCX и XLSX размером до 32 МБ. Проверка выполняется на локальном сервере."
  );
  resetResult();
}

function fileExtension(file) {
  return file.name.toLowerCase().split(".").pop() || "";
}

function selectFile(file) {
  if (inspecting || saving) return;
  globalThis.docomatorTemplateWizard?.resetFrom(1);
  const extension = fileExtension(file);
  if (extension !== "docx" && extension !== "xlsx") {
    selectedFile = null;
    lastReport = null;
    elements.dropZone.classList.add("is-error");
    setStatus(
      "error",
      "!",
      "Формат не поддерживается",
      "Выберите документ с расширением DOCX или XLSX. Другие файлы не передаются серверу."
    );
    elements.inspectButton.disabled = true;
    elements.clearButton.hidden = true;
    elements.selected.hidden = true;
    resetResult();
    return;
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    selectedFile = null;
    lastReport = null;
    elements.dropZone.classList.add("is-error");
    setStatus(
      "error",
      "!",
      file.size === 0 ? "Файл пуст" : "Файл слишком большой",
      file.size === 0
        ? "Выберите непустой документ."
        : "Размер файла превышает ограничение 32 МБ. Файл не передан серверу."
    );
    elements.inspectButton.disabled = true;
    elements.clearButton.hidden = true;
    elements.selected.hidden = true;
    resetResult();
    return;
  }

  selectedFile = file;
  lastReport = null;
  elements.dropZone.classList.remove("is-error");
  elements.dropZone.classList.add("has-file");
  elements.selected.hidden = false;
  elements.selected.innerHTML = `
    <span class="intake-file-icon" aria-hidden="true">${extension === "docx" ? "📘" : "📗"}</span>
    <span>
      <strong>${escapeHtml(file.name)}</strong>
      <small>${escapeHtml(formatBytes(file.size))} · ${extension.toUpperCase()}</small>
    </span>`;
  elements.inspectButton.disabled = false;
  elements.inspectButton.hidden = false;
  elements.clearButton.hidden = false;
  setStatus(
    "ready",
    "2",
    "Файл готов к проверке",
    "После нажатия файл будет передан только локальному серверу. Сохранение потребует отдельного подтверждения."
  );
  resetResult();
}

function issueSeverityLabel(severity) {
  if (severity === "blocker") return "Блокирует использование";
  if (severity === "warning") return "Требует внимания";
  return "Сведения";
}

function decisionPresentation(decision) {
  if (decision === "accepted") {
    return {
      kind: "success",
      icon: "✓",
      title: "Структура прошла проверку",
      detail: "Файл можно сохранить как неизменяемый исходник и затем передать разметке полей."
    };
  }
  if (decision === "accepted_with_warnings") {
    return {
      kind: "warning",
      icon: "!",
      title: "Файл принят с замечаниями",
      detail: "Исходник можно сохранить после просмотра предупреждений. Пробное формирование будет обязательным."
    };
  }
  return {
    kind: "error",
    icon: "×",
    title: "Файл нельзя использовать",
    detail: "Устраните блокирующие особенности или подготовьте безопасную копию документа."
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { accept: "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  if (!response.ok) {
    throw {
      message: body?.error?.message || `Сервер вернул код ${response.status}.`,
      operationId:
        body?.correlationId || response.headers.get("x-correlation-id") || ""
    };
  }
  return body;
}

async function loadSpaces() {
  if (spaces.length > 0) return spaces;
  const body = await fetchJson("/api/v1/spaces?limit=200");
  spaces = Array.isArray(body.data) ? body.data : [];
  return spaces;
}

function renderSavedDocuments(records) {
  const container = document.querySelector("#documentSourceList");
  if (!container) return;
  if (!Array.isArray(records) || records.length === 0) {
    container.innerHTML = `
      <div class="quarantine-empty">
        <span aria-hidden="true">📭</span>
        <div><strong>В этом пространстве исходников пока нет</strong><p>После подтверждения проверенный файл появится здесь.</p></div>
      </div>`;
    return;
  }
  container.innerHTML = records
    .map(
      (record) => `
        <article class="quarantine-source">
          <span class="quarantine-source-icon" aria-hidden="true">${record.format === "docx" ? "📘" : "📗"}</span>
          <div>
            <strong>${escapeHtml(record.fileName)}</strong>
            <p>${record.decision === "accepted" ? "Проверка пройдена" : "Сохранён с замечаниями"} · ${escapeHtml(formatBytes(record.sizeBytes))}</p>
            <small>Сохранён ${escapeHtml(formatDate(record.createdAt))}</small>
          </div>
          <details>
            <summary>Технические сведения</summary>
            <code>${escapeHtml(record.sha256)}</code>
          </details>
        </article>`
    )
    .join("");
}

async function loadSavedDocuments(spaceId) {
  const container = document.querySelector("#documentSourceList");
  if (!container || !spaceId) return;
  container.innerHTML = `
    <div class="quarantine-loading" role="status">
      <span aria-hidden="true">⏳</span><span>Получаем сохранённые исходники…</span>
    </div>`;
  try {
    const body = await fetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/document-sources?limit=50`
    );
    renderSavedDocuments(body.data);
  } catch (error) {
    container.innerHTML = `
      <div class="quarantine-empty is-error">
        <span aria-hidden="true">⚠️</span>
        <div><strong>Список получить не удалось</strong><p>${escapeHtml(error?.message || "Повторите действие позже.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${escapeHtml(error.operationId)}</code>.</small>` : ""}<button class="secondary-button" id="documentSourceListRetry" type="button">Повторить</button></div>
      </div>`;
    container
      .querySelector("#documentSourceListRetry")
      ?.addEventListener("click", () => loadSavedDocuments(spaceId));
  }
}

async function saveCheckedDocument(report) {
  if (saving || selectedFile === null || report.decision === "rejected") return;
  const spaceSelect = document.querySelector("#documentQuarantineSpace");
  const button = document.querySelector("#documentQuarantineButton");
  const message = document.querySelector("#documentQuarantineMessage");
  const spaceId = globalThis.docomatorTemplateWizard?.spaceId() || "";
  if (!spaceId) {
    message.textContent = "Выберите пространство, в котором будет храниться исходник.";
    return;
  }

  saving = true;
  button.disabled = true;
  spaceSelect.disabled = true;
  message.className = "quarantine-message is-loading";
  message.textContent =
    "Повторно проверяем файл и сохраняем неизменяемую копию. Страницу можно не закрывать.";

  try {
    const savedBody = await fetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/document-sources/quarantine?fileName=${encodeURIComponent(selectedFile.name)}`,
      {
        method: "POST",
        headers: {
          "content-type": selectedFile.type || "application/octet-stream"
        },
        body: selectedFile
      }
    );
    message.className = "quarantine-message is-success";
    message.textContent = "Исходник сохранён в выбранном разделе. Следующий этап — выбрать изменяемые поля.";
    button.textContent = "Исходник сохранён";
    await loadSavedDocuments(spaceId);
    globalThis.docomatorTemplateWizard?.complete(1, {
      sourceId: savedBody.data.id
    });
  } catch (error) {
    const operationId = typeof error?.operationId === "string" ? error.operationId : "";
    message.className = "quarantine-message is-error";
    message.innerHTML = `${escapeHtml(error?.message || "Сохранить исходник не удалось.")}${operationId ? ` Идентификатор операции: <code>${escapeHtml(operationId)}</code>.` : ""}`;
    button.disabled = false;
    spaceSelect.disabled = false;
  } finally {
    saving = false;
  }
}

async function initializeQuarantineControls(report) {
  const panel = document.querySelector("#documentQuarantinePanel");
  const spaceSelect = document.querySelector("#documentQuarantineSpace");
  const button = document.querySelector("#documentQuarantineButton");
  const message = document.querySelector("#documentQuarantineMessage");
  if (!panel || !spaceSelect || !button || !message) return;

  try {
    const availableSpaces = await loadSpaces();
    if (availableSpaces.length === 0) {
      panel.classList.add("is-disabled");
      spaceSelect.disabled = true;
      button.disabled = true;
      message.textContent =
        "Сначала создайте раздел данных. Исходники всегда хранятся в выбранном разделе.";
      return;
    }
    spaceSelect.innerHTML = availableSpaces
      .map(
        (space) =>
          `<option value="${escapeHtml(space.id)}">${escapeHtml(space.name)}</option>`
      )
      .join("");
    const currentSpaceId = globalThis.docomatorCurrentSpaceId || "";
    if ([...spaceSelect.options].some((option) => option.value === currentSpaceId)) {
      spaceSelect.value = currentSpaceId;
    }
    setTemplateWizardSpace(spaceSelect.value);
    button.addEventListener("click", () => saveCheckedDocument(report));
    spaceSelect.addEventListener("change", () =>
      loadSavedDocuments(spaceSelect.value)
    );
    await loadSavedDocuments(spaceSelect.value);
  } catch (error) {
    panel.classList.add("is-disabled");
    spaceSelect.disabled = true;
    button.disabled = true;
    message.textContent =
      error?.message || "Не удалось получить пространства. Обновите страницу.";
  }
}

function renderReport(report, operationId) {
  lastReport = report;
  const presentation = decisionPresentation(report.decision);
  setStatus(
    presentation.kind,
    presentation.icon,
    presentation.title,
    presentation.detail
  );
  elements.inspectButton.hidden = true;

  const issueHtml =
    report.issues.length === 0
      ? `<div class="intake-no-issues"><span aria-hidden="true">✅</span><div><strong>Замечаний нет</strong><p>Обязательные части найдены, небезопасные возможности не обнаружены.</p></div></div>`
      : `<div class="intake-issues">${report.issues
          .map(
            (issue) => `
              <article class="intake-issue is-${escapeHtml(issue.severity)}">
                <span class="intake-issue-mark" aria-hidden="true">${issue.severity === "blocker" ? "×" : issue.severity === "warning" ? "!" : "i"}</span>
                <div>
                  <span class="pill">${escapeHtml(issueSeverityLabel(issue.severity))}</span>
                  <h3>${escapeHtml(issue.title)}</h3>
                  <p>${escapeHtml(issue.message)}</p>
                  ${issue.partName ? `<details class="intake-technical"><summary>Технические сведения</summary><p>Часть пакета: <code>${escapeHtml(issue.partName)}</code></p></details>` : ""}
                </div>
              </article>`
          )
          .join("")}</div>`;

  const quarantineHtml =
    report.decision === "rejected"
      ? ""
      : `
        <section class="intake-quarantine-card" id="documentQuarantinePanel">
          <div class="quarantine-heading">
            <span aria-hidden="true">🔒</span>
            <div>
              <strong>Сохранить проверенный исходник</strong>
              <p>Сохранение выполняется только после вашего подтверждения. Неизменяемая копия будет относиться к выбранному пространству.</p>
            </div>
          </div>
          <div class="quarantine-form">
            <label for="documentQuarantineSpace" hidden>Раздел данных</label>
            <select id="documentQuarantineSpace" aria-describedby="documentQuarantineMessage" aria-hidden="true" tabindex="-1" hidden><option>Получаем список…</option></select>
            <button class="primary-button" id="documentQuarantineButton" type="button">Сохранить исходник</button>
          </div>
          <p class="quarantine-message" id="documentQuarantineMessage">После сохранения система покажет следующий шаг.</p>
          <div class="quarantine-list-heading"><strong>Сохранённые исходники раздела</strong><small>Повторная загрузка того же файла не создаёт дубликат.</small></div>
          <div id="documentSourceList" class="quarantine-source-list" aria-live="polite"></div>
        </section>`;

  elements.result.innerHTML = `
    <article class="intake-report is-${escapeHtml(presentation.kind)}">
      <header>
        <div>
          <p class="eyebrow">Результат проверки</p>
          <h2>${escapeHtml(report.fileName)}</h2>
          <p>${escapeHtml(presentation.detail)}</p>
        </div>
        <span class="intake-decision-icon" aria-hidden="true">${presentation.icon}</span>
      </header>
      <div class="intake-metrics" aria-label="Сводка пакета">
        <div><strong>${report.summary.fileCount}</strong><span>файловых частей</span></div>
        <div><strong>${escapeHtml(formatBytes(report.summary.compressedBytes))}</strong><span>в архиве</span></div>
        <div><strong>${escapeHtml(formatBytes(report.summary.uncompressedBytes))}</strong><span>после распаковки</span></div>
        <div><strong>${report.summary.externalRelationships}</strong><span>внешних связей</span></div>
      </div>
      ${issueHtml}
      ${quarantineHtml}
      <details class="intake-technical">
        <summary>Технические сведения</summary>
        <dl>
          <div><dt>Формат</dt><dd>${escapeHtml(report.format.toUpperCase())}</dd></div>
          <div><dt>Всего частей</dt><dd>${report.summary.entryCount}</dd></div>
          <div><dt>Файлов связей</dt><dd>${report.summary.relationshipFiles}</dd></div>
          <div><dt>SHA-256</dt><dd><code>${escapeHtml(report.sha256)}</code></dd></div>
          <div><dt>Идентификатор операции</dt><dd><code>${escapeHtml(operationId || "не указан")}</code></dd></div>
        </dl>
      </details>
    </article>`;

  if (report.decision !== "rejected") {
    void initializeQuarantineControls(report);
  }
}

async function inspectSelectedFile() {
  if (selectedFile === null || inspecting || saving) return;
  inspecting = true;
  lastReport = null;
  elements.inspectButton.disabled = true;
  elements.clearButton.disabled = true;
  setStatus(
    "loading",
    "⏳",
    "Проверяем архивную структуру",
    "Локальный сервер считает части, проверяет размеры, пути, макросы и внешние связи. Можно дождаться результата на этой странице."
  );
  elements.result.innerHTML = `
    <div class="intake-progress" role="status">
      <span class="intake-progress-mark" aria-hidden="true">⏳</span>
      <div><strong>Идёт проверка</strong><p>Файл не запускается и не распаковывается в пользовательские каталоги.</p></div>
    </div>`;

  try {
    const body = await fetchJson(
      `/api/v1/document-intake/inspect?fileName=${encodeURIComponent(selectedFile.name)}`,
      {
        method: "POST",
        headers: {
          "content-type": selectedFile.type || "application/octet-stream"
        },
        body: selectedFile
      }
    );
    renderReport(body.data, body.correlationId);
  } catch (error) {
    const message =
      typeof error?.message === "string"
        ? error.message
        : "Не удалось проверить файл. Повторите действие.";
    const operationId =
      typeof error?.operationId === "string" ? error.operationId : "";
    setStatus(
      "error",
      "!",
      "Проверка не завершена",
      `${message}${operationId ? ` Идентификатор операции: ${operationId}.` : ""}`
    );
    elements.result.innerHTML = `
      <div class="intake-error">
        <span aria-hidden="true">⚠️</span>
        <div><strong>Файл не изменён и не сохранён</strong><p>${escapeHtml(message)}</p>${operationId ? `<small>Идентификатор операции: <code>${escapeHtml(operationId)}</code></small>` : ""}</div>
      </div>`;
  } finally {
    inspecting = false;
    elements.inspectButton.disabled = selectedFile === null;
    elements.clearButton.disabled = false;
  }
}

if (Object.values(elements).every((element) => element !== null)) {
  elements.input.addEventListener("change", () => {
    const file = elements.input.files?.[0];
    if (file) selectFile(file);
  });
  elements.inspectButton.addEventListener("click", inspectSelectedFile);
  elements.clearButton.addEventListener("click", () => clearSelection());
  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!inspecting && !saving) elements.dropZone.classList.add("is-dragging");
  });
  elements.dropZone.addEventListener("dragleave", () => {
    elements.dropZone.classList.remove("is-dragging");
  });
  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
    const file = event.dataTransfer?.files?.[0];
    if (file) selectFile(file);
  });
  clearSelection({ resetWizard: false });
}

initializeTemplateWizard();

document.addEventListener("docomator:space-changed", (event) => {
  const spaceId = event?.detail?.spaceId || "";
  setTemplateWizardSpace(spaceId);
  const spaceSelect = document.querySelector("#documentQuarantineSpace");
  if (!spaceId || !spaceSelect) return;
  if ([...spaceSelect.options].some((option) => option.value === spaceId)) {
    const changed = spaceSelect.value !== spaceId;
    spaceSelect.value = spaceId;
    if (changed) spaceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    else void loadSavedDocuments(spaceId);
  }
});
