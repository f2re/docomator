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

function clearSelection() {
  selectedFile = null;
  lastReport = null;
  elements.input.value = "";
  elements.selected.hidden = true;
  elements.inspectButton.disabled = true;
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
        <div><strong>Список получить не удалось</strong><p>${escapeHtml(error?.message || "Повторите действие позже.")}</p></div>
      </div>`;
  }
}

async function saveCheckedDocument(report) {
  if (saving || selectedFile === null || report.decision === "rejected") return;
  const spaceSelect = document.querySelector("#documentQuarantineSpace");
  const button = document.querySelector("#documentQuarantineButton");
  const message = document.querySelector("#documentQuarantineMessage");
  const spaceId = spaceSelect?.value || "";
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
    const body = await fetchJson(
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
    message.innerHTML = `✅ Исходник сохранён. Контрольная сумма: <code>${escapeHtml(body.data.sha256)}</code>. Следующий этап — выбрать изменяемые поля.`;
    button.textContent = "Исходник сохранён";
    await loadSavedDocuments(spaceId);
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
        "Сначала создайте пространство. Исходники всегда хранятся в изолированной области данных.";
      return;
    }
    spaceSelect.innerHTML = availableSpaces
      .map(
        (space) =>
          `<option value="${escapeHtml(space.id)}">${escapeHtml(space.name)}</option>`
      )
      .join("");
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
                  ${issue.partName ? `<small>Часть пакета: <code>${escapeHtml(issue.partName)}</code></small>` : ""}
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
              <p>Сохранение выполняется только после вашего подтверждения. Копия будет неизменяемой и доступной только в выбранном пространстве.</p>
            </div>
          </div>
          <div class="quarantine-form">
            <label for="documentQuarantineSpace">Пространство</label>
            <select id="documentQuarantineSpace" aria-describedby="documentQuarantineMessage"><option>Получаем список…</option></select>
            <button class="primary-button" id="documentQuarantineButton" type="button">Сохранить исходник</button>
          </div>
          <p class="quarantine-message" id="documentQuarantineMessage">После сохранения система покажет контрольную сумму и безопасный следующий шаг.</p>
          <div class="quarantine-list-heading"><strong>Сохранённые исходники пространства</strong><small>Повторная загрузка того же файла не создаёт дубликат.</small></div>
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
  elements.clearButton.addEventListener("click", clearSelection);
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
  clearSelection();
}
