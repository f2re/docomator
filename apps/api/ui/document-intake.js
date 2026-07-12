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
      <p>Система покажет структуру пакета, ограничения и замечания. Файл на этом этапе не сохраняется.</p>
    </div>`;
}

function clearSelection() {
  selectedFile = null;
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
  if (inspecting) return;
  const extension = fileExtension(file);
  if (extension !== "docx" && extension !== "xlsx") {
    selectedFile = null;
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
    "После нажатия файл будет передан только локальному серверу. Результат проверки не активирует шаблон автоматически."
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
      detail: "Файл можно передать следующему этапу: построению структуры и разметке полей."
    };
  }
  if (decision === "accepted_with_warnings") {
    return {
      kind: "warning",
      icon: "!",
      title: "Файл принят с замечаниями",
      detail: "Продолжить можно после просмотра предупреждений и пробного формирования."
    };
  }
  return {
    kind: "error",
    icon: "×",
    title: "Файл нельзя использовать",
    detail: "Устраните блокирующие особенности или подготовьте безопасную копию документа."
  };
}

function renderReport(report, operationId) {
  const presentation = decisionPresentation(report.decision);
  setStatus(
    presentation.kind,
    presentation.icon,
    presentation.title,
    presentation.detail
  );

  const issueHtml = report.issues.length === 0
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
}

async function inspectSelectedFile() {
  if (selectedFile === null || inspecting) return;
  inspecting = true;
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
    const response = await fetch(
      `/api/v1/document-intake/inspect?fileName=${encodeURIComponent(selectedFile.name)}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": selectedFile.type || "application/octet-stream"
        },
        body: selectedFile
      }
    );
    const body = await response.json();
    if (!response.ok) {
      throw {
        message: body?.error?.message || `Сервер вернул код ${response.status}.`,
        operationId:
          body?.correlationId || response.headers.get("x-correlation-id") || ""
      };
    }
    renderReport(body.data, body.correlationId);
  } catch (error) {
    const message =
      typeof error?.message === "string"
        ? error.message
        : "Не удалось проверить файл. Повторите действие.";
    const operationId = typeof error?.operationId === "string" ? error.operationId : "";
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
    if (!inspecting) elements.dropZone.classList.add("is-dragging");
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
