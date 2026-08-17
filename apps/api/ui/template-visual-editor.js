const renderStructureElementList = renderStructure;

function visualDocxPartKind(part) {
  const value = String(part || "");
  if (/\/header[0-9]+\.xml$/u.test(value)) return "header";
  if (/\/footer[0-9]+\.xml$/u.test(value)) return "footer";
  if (value === "word/footnotes.xml" || value === "word/endnotes.xml") return "notes";
  return value === "word/document.xml" ? "body" : "other";
}

function visualDocxPartOrdinal(part) {
  const match = /(?:header|footer)([0-9]+)\.xml$/u.exec(String(part || ""));
  return match ? Number(match[1]) : 0;
}

function visualDocxPartLabel(part) {
  const kind = visualDocxPartKind(part);
  const ordinal = visualDocxPartOrdinal(part);
  if (kind === "header") return ordinal > 1 ? `Верхний колонтитул ${ordinal}` : "Верхний колонтитул";
  if (kind === "footer") return ordinal > 1 ? `Нижний колонтитул ${ordinal}` : "Нижний колонтитул";
  if (kind === "notes") {
    return String(part).includes("endnotes") ? "Концевые сноски" : "Сноски";
  }
  if (kind === "body") return "Основной текст";
  return "Дополнительная область";
}

function visualDocxTargetMarkup(element, extraClass = "") {
  const runs = Array.isArray(element.runs) && element.runs.length > 0
    ? element.runs
    : [{ text: element.text || "", bold: false, italic: false }];
  const runMarkup = runs
    .map((run) => {
      const classes = [
        "template-visual-run",
        run.bold ? "is-bold" : "",
        run.italic ? "is-italic" : ""
      ].filter(Boolean).join(" ");
      return `<span class="${classes}">${structureEscape(run.text || "")}</span>`;
    })
    .join("");
  const empty = String(element.text || "").length === 0;
  const location = structureLocation(element);
  const label = `${location}. ${empty ? "Пустое место. " : ""}Нажмите, чтобы назначить поле${empty ? "." : ", или выделите заменяемый текст прямо в документе."}`;
  return `<div class="structure-element template-visual-target template-visual-paragraph${empty ? " is-empty" : ""}${extraClass ? ` ${extraClass}` : ""}" role="button" tabindex="0" data-structure-id="${structureEscape(element.id)}" aria-pressed="false" aria-label="${structureEscape(label)}"><span class="template-visual-location" aria-hidden="true">${structureEscape(location)}</span><span class="template-visual-text">${runMarkup}</span></div>`;
}

function visualDocxBlocks(elements) {
  const ordinary = [];
  const tables = new Map();
  for (const element of elements) {
    if (!element.tableLocation) {
      ordinary.push({ kind: "paragraph", order: element.index, element });
      continue;
    }
    const tableIndex = element.tableLocation.tableIndex;
    let table = tables.get(tableIndex);
    if (!table) {
      table = { kind: "table", order: element.index, tableIndex, rows: new Map() };
      tables.set(tableIndex, table);
    }
    table.order = Math.min(table.order, element.index);
    const rowIndex = element.tableLocation.rowIndex;
    let row = table.rows.get(rowIndex);
    if (!row) {
      row = new Map();
      table.rows.set(rowIndex, row);
    }
    const columnIndex = element.tableLocation.columnIndex;
    const cell = row.get(columnIndex) || [];
    cell.push(element);
    row.set(columnIndex, cell);
  }
  return [...ordinary, ...tables.values()].sort((left, right) => left.order - right.order);
}

function visualDocxTableMarkup(block) {
  const rows = [...block.rows.entries()].sort(([left], [right]) => left - right);
  return `<div class="template-visual-table-wrap"><table class="template-visual-table" aria-label="Таблица ${block.tableIndex + 1}"><tbody>${rows
    .map(([rowIndex, columns]) => {
      const cells = [...columns.entries()].sort(([left], [right]) => left - right);
      return `<tr class="structure-table-row template-visual-table-row" data-visual-row="${rowIndex}">${cells
        .map(([_columnIndex, paragraphs]) => `<td class="structure-table-cell-stack template-visual-table-cell">${paragraphs
          .sort((left, right) => left.index - right.index)
          .map((element) => visualDocxTargetMarkup(element, "is-table-paragraph structure-table-cell-element"))
          .join("")}</td>`)
        .join("")}</tr>`;
    })
    .join("")}</tbody></table></div>`;
}

function visualDocxBlocksMarkup(elements) {
  return visualDocxBlocks(elements)
    .map((block) =>
      block.kind === "table"
        ? visualDocxTableMarkup(block)
        : visualDocxTargetMarkup(block.element)
    )
    .join("");
}

function visualDocxRegionMarkup(part, elements) {
  const kind = visualDocxPartKind(part);
  return `<section class="template-visual-region is-${structureEscape(kind)}" data-visual-region="${structureEscape(kind)}" data-visual-part="${structureEscape(part)}" aria-label="${structureEscape(visualDocxPartLabel(part))}">
    <div class="template-visual-region-label">${structureEscape(visualDocxPartLabel(part))}</div>
    <div class="template-visual-region-content">${visualDocxBlocksMarkup(elements) || '<p class="template-visual-empty-region">В этой области нет доступного текста для подстановки.</p>'}</div>
  </section>`;
}

function visualDocxRegions(report) {
  const grouped = new Map();
  for (const element of report.elements || []) {
    if (element.kind !== "paragraph") continue;
    const part = String(element.part || "");
    if (!grouped.has(part)) grouped.set(part, []);
    grouped.get(part).push(element);
  }
  const order = { header: 0, body: 1, footer: 2, notes: 3, other: 4 };
  return [...grouped.entries()].sort(([leftPart], [rightPart]) => {
    const leftKind = visualDocxPartKind(leftPart);
    const rightKind = visualDocxPartKind(rightPart);
    const byKind = (order[leftKind] ?? 9) - (order[rightKind] ?? 9);
    if (byKind !== 0) return byKind;
    const byOrdinal = visualDocxPartOrdinal(leftPart) - visualDocxPartOrdinal(rightPart);
    return byOrdinal !== 0 ? byOrdinal : leftPart.localeCompare(rightPart, "ru-RU");
  });
}

function visualDocxFallbackList(report) {
  const items = (report.elements || [])
    .filter((element) => element.kind === "paragraph")
    .map((element) => `<button class="template-visual-list-item" type="button" data-visual-list-id="${structureEscape(element.id)}">
      <span aria-hidden="true">¶</span><span><strong>${structureEscape(structureLocation(element))}</strong><small>${structureEscape(structurePreview(element) || "Пустое место")}</small></span>
    </button>`)
    .join("");
  return items || '<p class="template-visual-empty-region">Доступных текстовых мест нет.</p>';
}

function visualDocxSelectionOffsets(target, selection) {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const content = target.querySelector(".template-visual-text") || target;
  const range = selection.getRangeAt(0);
  if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return null;
  const startRange = document.createRange();
  startRange.selectNodeContents(content);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = document.createRange();
  endRange.selectNodeContents(content);
  endRange.setEnd(range.endContainer, range.endOffset);
  const startOffset = startRange.toString().length;
  const endOffset = endRange.toString().length;
  return endOffset > startOffset ? { startOffset, endOffset } : null;
}

let visualDocxSuppressClickId = "";
let visualDocxSuppressClickUntil = 0;

function visualDocxElementByTarget(target) {
  const id = target?.getAttribute("data-structure-id") || target?.getAttribute("data-visual-list-id") || "";
  return (structureReport?.elements || []).find((candidate) => candidate.id === id) || null;
}

function visualDocxSelectElement(target) {
  const element = visualDocxElementByTarget(target);
  if (element) renderStructureSelection(element);
}

function visualDocxCaptureDirectSelection(target) {
  const element = visualDocxElementByTarget(target);
  if (!element || element.kind !== "paragraph" || !element.text || element.runsTruncated) return false;
  const selection = window.getSelection();
  const offsets = visualDocxSelectionOffsets(target, selection);
  if (!offsets || offsets.endOffset > element.text.length) return false;
  visualDocxSuppressClickId = element.id;
  visualDocxSuppressClickUntil = Date.now() + 400;
  renderStructureSelection(element);
  const rangeMode = document.querySelector('input[name="documentFieldParagraphMode"][value="range"]');
  if (rangeMode && !rangeMode.disabled) rangeMode.checked = true;
  const control = document.querySelector("#documentFieldTextRange");
  if (!control || control.disabled) return true;
  control.focus({ preventScroll: true });
  control.setSelectionRange(offsets.startOffset, offsets.endOffset);
  captureStructureTextRange();
  return true;
}

function attachVisualDocxInteractions(root) {
  root.addEventListener("mouseup", (event) => {
    const target = event.target.closest(".template-visual-target");
    if (target) visualDocxCaptureDirectSelection(target);
  });
  root.addEventListener("click", (event) => {
    const visualTarget = event.target.closest(".template-visual-target");
    if (visualTarget) {
      const id = visualTarget.getAttribute("data-structure-id") || "";
      if (id === visualDocxSuppressClickId && Date.now() < visualDocxSuppressClickUntil) {
        visualDocxSuppressClickId = "";
        return;
      }
      window.getSelection()?.removeAllRanges();
      visualDocxSelectElement(visualTarget);
      return;
    }
    const listTarget = event.target.closest("[data-visual-list-id]");
    if (listTarget) visualDocxSelectElement(listTarget);
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest(".template-visual-target");
    if (!target) return;
    event.preventDefault();
    visualDocxSelectElement(target);
  });
}

function renderVisualDocxStructure(report, operationId) {
  structureReport = report;
  selectedStructureElement = null;
  selectedStructureTextRange = null;
  const result = document.querySelector("#documentStructureResult");
  const analyzeButton = document.querySelector("#documentStructureButton");
  if (!result) return;
  if (analyzeButton) analyzeButton.hidden = true;

  const summary = report.summary || {};
  const regions = visualDocxRegions(report);
  const regionMarkup = regions
    .filter(([part]) => visualDocxPartKind(part) !== "notes")
    .map(([part, elements]) => visualDocxRegionMarkup(part, elements))
    .join("");
  const notesMarkup = regions
    .filter(([part]) => visualDocxPartKind(part) === "notes")
    .map(([part, elements]) => visualDocxRegionMarkup(part, elements))
    .join("");

  result.innerHTML = `<article class="structure-report template-visual-editor">
    <header>
      <div><p class="eyebrow">Разметка полей</p><h3>${structureEscape(report.fileName)}</h3><p>Документ показан как безопасная интерактивная проекция. Нажмите место целиком или выделите заменяемый текст прямо на странице.</p></div>
      <span class="pill pill-success">Готово к разметке</span>
    </header>
    <div class="structure-metrics">
      <div><strong>${summary.paragraphs ?? 0}</strong><span>абзацев</span></div>
      <div><strong>${summary.runs ?? 0}</strong><span>текстовых фрагментов</span></div>
      <div><strong>${summary.partsRead ?? 0}</strong><span>областей документа</span></div>
    </div>
    ${report.truncated ? '<div class="structure-warning"><span aria-hidden="true">ℹ️</span><p><strong>Показана ограниченная выборка.</strong> Не размечайте место, которого нет в этой проекции: сервер не сможет доказать его координату.</p></div>' : ""}
    <div class="template-visual-accuracy-note"><strong>Верстка не подменяет Word.</strong><span>Жирный и курсив, области документа и таблицы показаны для выбора поля. Точные переносы страниц, рисунки и сложные Office-объекты проверяются в пробной копии и PDF-предпросмотре.</span></div>
    <div class="template-visual-workspace">
      <div class="template-visual-canvas" aria-label="Визуальное представление DOCX">
        <div class="template-visual-page">${regionMarkup || '<p class="template-visual-empty-region">В документе нет доступного текста для разметки.</p>'}</div>
        ${notesMarkup ? `<div class="template-visual-notes">${notesMarkup}</div>` : ""}
      </div>
      <aside class="structure-selection template-visual-inspector" id="documentStructureSelection" hidden aria-live="polite"></aside>
    </div>
    <details class="template-visual-fallback">
      <summary>Список мест документа</summary>
      <p>Резервный способ выбора для клавиатуры и сложной верстки. Он использует те же безопасные координаты.</p>
      <div class="template-visual-list">${visualDocxFallbackList(report)}</div>
    </details>
    <details class="intake-technical">
      <summary>Технические сведения</summary>
      <dl>
        <div><dt>Контрольная сумма исходника</dt><dd><code>${structureEscape(report.sourceSha256)}</code></dd></div>
        <div><dt>Контрольная сумма структуры</dt><dd><code>${structureEscape(report.structureSha256)}</code></dd></div>
        <div><dt>Показано элементов</dt><dd>${summary.shownElements ?? 0} из ${summary.totalElements ?? 0}</dd></div>
        <div><dt>Идентификатор операции</dt><dd><code>${structureEscape(operationId || "не указан")}</code></dd></div>
      </dl>
    </details>
  </article>`;
  attachVisualDocxInteractions(result);
}

renderStructure = function renderStructureWithVisualDocument(report, operationId) {
  if (report?.format !== "docx") {
    return renderStructureElementList(report, operationId);
  }
  return renderVisualDocxStructure(report, operationId);
};
