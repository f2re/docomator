const structureElements = {
  input: document.querySelector("#documentIntakeFile"),
  statusTitle: document.querySelector("#documentIntakeStatusTitle"),
  templatesView: document.querySelector('[data-view="templates"]')
};

let structureBusy = false;
let structureReport = null;
let selectedStructureElement = null;

function structureEscape(value) {
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

function currentStructureFile() {
  return structureElements.input?.files?.[0] ?? null;
}

function structurePanel() {
  return document.querySelector("#documentStructurePanel");
}

function structureAllowed() {
  const title = structureElements.statusTitle?.textContent?.trim() ?? "";
  return title === "Структура прошла проверку" || title === "Файл принят с замечаниями";
}

function createStructurePanel() {
  if (!structureElements.templatesView || structurePanel()) return;
  const panel = document.createElement("section");
  panel.id = "documentStructurePanel";
  panel.className = "structure-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <article class="panel structure-card">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Шаг 2 · структура документа</p>
          <h2>Показать абзацы и ячейки</h2>
          <p>Сервер повторно проверит файл и вернёт только безопасное структурное представление. Исходный XML в браузер не передаётся.</p>
        </div>
        <span class="large-emoji" aria-hidden="true">🧭</span>
      </div>
      <div class="structure-actions">
        <button class="primary-button" id="documentStructureButton" type="button">Построить структуру</button>
        <p id="documentStructureHint">После анализа можно выбрать абзац DOCX или ячейку XLSX. Сохранение поля будет следующим отдельным действием.</p>
      </div>
      <div id="documentStructureResult" class="structure-result" aria-live="polite">
        <div class="structure-empty"><span aria-hidden="true">🧱</span><div><strong>Структура ещё не построена</strong><p>Сначала завершите проверку документа, затем нажмите кнопку выше.</p></div></div>
      </div>
    </article>`;
  structureElements.templatesView.append(panel);
  panel.querySelector("#documentStructureButton")?.addEventListener("click", analyzeStructure);
}

function resetStructurePanel() {
  structureReport = null;
  selectedStructureElement = null;
  const panel = structurePanel();
  if (!panel) return;
  panel.hidden = true;
  const button = panel.querySelector("#documentStructureButton");
  const result = panel.querySelector("#documentStructureResult");
  if (button) {
    button.disabled = false;
    button.textContent = "Построить структуру";
  }
  if (result) {
    result.innerHTML = `
      <div class="structure-empty"><span aria-hidden="true">🧱</span><div><strong>Структура ещё не построена</strong><p>Сначала завершите проверку документа, затем нажмите кнопку выше.</p></div></div>`;
  }
}

function refreshStructureAvailability() {
  createStructurePanel();
  const panel = structurePanel();
  if (!panel) return;
  const file = currentStructureFile();
  panel.hidden = !(file && structureAllowed());
  if (!panel.hidden && structureReport === null) {
    const result = panel.querySelector("#documentStructureResult");
    if (result) {
      result.innerHTML = `
        <div class="structure-empty"><span aria-hidden="true">✅</span><div><strong>Проверка завершена</strong><p>Теперь можно безопасно получить абзацы, текстовые фрагменты и ячейки.</p></div></div>`;
    }
  }
}

function structureLocation(element) {
  if (element.kind === "cell") {
    return `${element.sheetName} · ${element.address}`;
  }
  if (element.tableLocation) {
    const location = element.tableLocation;
    return `Таблица ${location.tableIndex + 1}, строка ${location.rowIndex + 1}, ячейка ${location.columnIndex + 1}`;
  }
  if (element.part === "word/document.xml") return `Основной текст · абзац ${element.index + 1}`;
  return `${element.part} · абзац ${element.index + 1}`;
}

function structurePreview(element) {
  if (element.kind === "cell") {
    if (element.formula) return `Формула: ${element.formula} · значение: ${element.value || "пусто"}`;
    return element.value || "Пустая ячейка";
  }
  return element.text || "Пустой абзац";
}

function renderStructureSelection(element) {
  selectedStructureElement = element;
  document.querySelectorAll(".structure-element.is-selected").forEach((item) => {
    item.classList.remove("is-selected");
    item.setAttribute("aria-pressed", "false");
  });
  const selected = document.querySelector(`[data-structure-id="${CSS.escape(element.id)}"]`);
  selected?.classList.add("is-selected");
  selected?.setAttribute("aria-pressed", "true");

  const detail = document.querySelector("#documentStructureSelection");
  if (!detail) return;
  detail.innerHTML = `
    <span aria-hidden="true">📌</span>
    <div>
      <strong>Выбран элемент: ${structureEscape(structureLocation(element))}</strong>
      <p>${structureEscape(structurePreview(element))}</p>
      <small>Идентификатор координаты: <code>${structureEscape(element.id)}</code>. Следующий этап сохранит имя поля, тип и эту проверяемую координату.</small>
    </div>`;
  detail.hidden = false;
}

function renderStructure(report, operationId) {
  structureReport = report;
  selectedStructureElement = null;
  const result = document.querySelector("#documentStructureResult");
  if (!result) return;

  const summary = report.summary;
  const metrics =
    report.format === "docx"
      ? [
          [summary.paragraphs, "абзацев"],
          [summary.runs, "текстовых фрагментов"],
          [summary.partsRead, "прочитанных частей"]
        ]
      : [
          [summary.sheets, "листов"],
          [summary.cells, "ячеек"],
          [summary.formulas, "формул"]
        ];

  const items = report.elements
    .map(
      (element) => `
        <button class="structure-element" type="button" data-structure-id="${structureEscape(element.id)}" aria-pressed="false">
          <span class="structure-element-kind" aria-hidden="true">${element.kind === "cell" ? "▦" : "¶"}</span>
          <span class="structure-element-copy">
            <strong>${structureEscape(structureLocation(element))}</strong>
            <span>${structureEscape(structurePreview(element))}</span>
            ${element.kind === "paragraph" && element.runsTruncated ? "<small>Показана только часть текстовых фрагментов этого абзаца.</small>" : ""}
          </span>
        </button>`
    )
    .join("");

  result.innerHTML = `
    <article class="structure-report">
      <header>
        <div><p class="eyebrow">Структура построена</p><h3>${structureEscape(report.fileName)}</h3><p>Координаты воспроизводимы для этой неизменяемой версии файла.</p></div>
        <span class="pill pill-success">Готово</span>
      </header>
      <div class="structure-metrics">${metrics
        .map(([value, label]) => `<div><strong>${value}</strong><span>${label}</span></div>`)
        .join("")}</div>
      ${report.truncated ? '<div class="structure-warning"><span aria-hidden="true">ℹ️</span><p><strong>Показана ограниченная выборка.</strong> Полные количества сохранены в сводке, а страница не перегружена.</p></div>' : ""}
      <div class="structure-element-list" role="list">${items || '<div class="structure-empty"><span aria-hidden="true">📭</span><div><strong>Элементы не найдены</strong><p>Документ не содержит доступных абзацев или ячеек.</p></div></div>'}</div>
      <div class="structure-selection" id="documentStructureSelection" hidden></div>
      <details class="intake-technical">
        <summary>Технические сведения</summary>
        <dl>
          <div><dt>Контрольная сумма исходника</dt><dd><code>${structureEscape(report.sourceSha256)}</code></dd></div>
          <div><dt>Контрольная сумма структуры</dt><dd><code>${structureEscape(report.structureSha256)}</code></dd></div>
          <div><dt>Показано элементов</dt><dd>${summary.shownElements} из ${summary.totalElements}</dd></div>
          <div><dt>Идентификатор операции</dt><dd><code>${structureEscape(operationId || "не указан")}</code></dd></div>
        </dl>
      </details>
    </article>`;

  result.querySelectorAll(".structure-element").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-structure-id");
      const element = report.elements.find((candidate) => candidate.id === id);
      if (element) renderStructureSelection(element);
    });
  });
}

async function analyzeStructure() {
  if (structureBusy) return;
  const file = currentStructureFile();
  const button = document.querySelector("#documentStructureButton");
  const result = document.querySelector("#documentStructureResult");
  if (!file || !button || !result) return;

  structureBusy = true;
  button.disabled = true;
  button.textContent = "Читаем структуру…";
  result.innerHTML = `
    <div class="structure-loading" role="status">
      <span aria-hidden="true">⏳</span>
      <div><strong>Читаем текст и координаты</strong><p>Проверяем XML, сопоставляем листы и ограничиваем объём ответа. Файл не сохраняется повторно.</p></div>
    </div>`;

  try {
    const response = await fetch(
      `/api/v1/document-intake/analyze?fileName=${encodeURIComponent(file.name)}&limit=300`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": file.type || "application/octet-stream"
        },
        body: file
      }
    );
    const body = await response.json();
    if (!response.ok) {
      throw {
        message: body?.error?.message || `Сервер вернул код ${response.status}.`,
        operationId: body?.correlationId || response.headers.get("x-correlation-id") || ""
      };
    }
    renderStructure(body.data, body.correlationId);
    button.textContent = "Построить заново";
  } catch (error) {
    const message = error?.message || "Структуру построить не удалось.";
    const operationId = error?.operationId || "";
    result.innerHTML = `
      <div class="structure-error">
        <span aria-hidden="true">⚠️</span>
        <div><strong>Структура не построена</strong><p>${structureEscape(message)}</p><small>Файл не изменён.${operationId ? ` Идентификатор операции: <code>${structureEscape(operationId)}</code>.` : ""}</small></div>
      </div>`;
    button.textContent = "Повторить анализ";
  } finally {
    structureBusy = false;
    button.disabled = false;
  }
}

if (structureElements.input && structureElements.statusTitle && structureElements.templatesView) {
  createStructurePanel();
  structureElements.input.addEventListener("change", resetStructurePanel);
  new MutationObserver(refreshStructureAvailability).observe(
    structureElements.statusTitle,
    { childList: true, characterData: true, subtree: true }
  );
  refreshStructureAvailability();
}
