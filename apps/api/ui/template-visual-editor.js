const renderStructureElementList = renderStructure;
let visualLayoutRequestVersion = 0;
let loadVisualLayout = async function loadVisualLayoutPlaceholder() {};

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
  if (kind === "header") {
    return ordinal > 1 ? `Верхний колонтитул ${ordinal}` : "Верхний колонтитул";
  }
  if (kind === "footer") {
    return ordinal > 1 ? `Нижний колонтитул ${ordinal}` : "Нижний колонтитул";
  }
  if (kind === "notes") {
    return String(part).includes("endnotes") ? "Концевые сноски" : "Сноски";
  }
  if (kind === "body") return "Основной текст";
  return "Дополнительная область";
}

function visualDocxBlocks(elements) {
  const ordinary = [];
  const tables = new Map();
  for (const element of elements || []) {
    if (!element.tableLocation) {
      ordinary.push({ kind: "paragraph", order: element.index, element });
      continue;
    }
    const tableIndex = element.tableLocation.tableIndex;
    let table = tables.get(tableIndex);
    if (!table) {
      table = {
        kind: "table",
        order: element.index,
        tableIndex,
        rows: new Map()
      };
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

function visualDocxCellMeta(table, rowIndex, columnIndex) {
  return (
    table?.cells?.find(
      (cell) => cell.rowIndex === rowIndex && cell.columnIndex === columnIndex
    ) || null
  );
}

function visualDocxVerticalRowSpan(table, cell) {
  if (!cell || cell.verticalMerge !== "restart") return 1;
  let count = 1;
  for (let rowIndex = cell.rowIndex + 1; ; rowIndex += 1) {
    const next = visualDocxCellMeta(table, rowIndex, cell.columnIndex);
    if (!next || next.verticalMerge !== "continue") break;
    count += 1;
  }
  return count;
}

function visualDocxRegions(report) {
  const grouped = new Map();
  for (const element of report?.elements || []) {
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
    return byOrdinal !== 0
      ? byOrdinal
      : leftPart.localeCompare(rightPart, "ru-RU");
  });
}

function visualFallbackList(report) {
  const items = (report?.elements || [])
    .map(
      (element) => `<button class="template-visual-list-item" type="button" data-visual-list-id="${structureEscape(element.id)}">
        <span aria-hidden="true">${element.kind === "cell" ? "▦" : "¶"}</span>
        <span><strong>${structureEscape(structureLocation(element))}</strong><small>${structureEscape(structurePreview(element) || "Пустое место")}</small></span>
      </button>`
    )
    .join("");
  return items || '<p class="template-visual-empty-region">Доступных мест нет.</p>';
}

function visualTechnical(report, operationId) {
  const summary = report?.summary || {};
  return `<details class="intake-technical">
    <summary>Технические сведения</summary>
    <dl>
      <div><dt>Контрольная сумма исходника</dt><dd><code>${structureEscape(report?.sourceSha256 || "не указана")}</code></dd></div>
      <div><dt>Контрольная сумма структуры</dt><dd><code>${structureEscape(report?.structureSha256 || "не указана")}</code></dd></div>
      <div><dt>Показано элементов</dt><dd>${structureEscape(summary.shownElements ?? 0)} из ${structureEscape(summary.totalElements ?? 0)}</dd></div>
      <div><dt>Идентификатор операции</dt><dd><code>${structureEscape(operationId || "не указан")}</code></dd></div>
    </dl>
  </details>`;
}

function visualDocxSelectionOffsets(target, selection) {
  const content = target?.querySelector(".template-visual-text");
  if (
    !content ||
    !selection ||
    selection.rangeCount !== 1 ||
    selection.isCollapsed
  ) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (
    !content.contains(range.startContainer) ||
    !content.contains(range.endContainer)
  ) {
    return null;
  }
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

function visualElementByTarget(target) {
  const id =
    target?.getAttribute("data-structure-id") ||
    target?.getAttribute("data-visual-list-id") ||
    "";
  return visualElementById(id);
}

function visualElementById(id) {
  return (
    (structureReport?.elements || []).find((candidate) => candidate.id === id) ||
    null
  );
}

function visualSelectElement(target) {
  const element = visualElementByTarget(target);
  if (element) renderStructureSelection(element);
}

function visualDocxCaptureDirectSelection(target) {
  const element = visualElementByTarget(target);
  if (
    !element ||
    element.kind !== "paragraph" ||
    !element.text ||
    element.runsTruncated
  ) {
    return false;
  }
  const selection = window.getSelection();
  const offsets = visualDocxSelectionOffsets(target, selection);
  if (!offsets || offsets.endOffset > element.text.length) return false;
  visualDocxSuppressClickId = element.id;
  visualDocxSuppressClickUntil = Date.now() + 400;
  renderStructureSelection(element);
  const rangeMode = document.querySelector(
    'input[name="documentFieldParagraphMode"][value="range"]'
  );
  if (rangeMode && !rangeMode.disabled) rangeMode.checked = true;
  const control = document.querySelector("#documentFieldTextRange");
  if (!control || control.disabled) return true;
  control.focus({ preventScroll: true });
  control.setSelectionRange(offsets.startOffset, offsets.endOffset);
  captureStructureTextRange();
  return true;
}

function xlsxColumnLabel(number) {
  let value = Number(number);
  let label = "";
  while (Number.isInteger(value) && value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label || "A";
}

function xlsxMergeCoordinates(ref) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6}):([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(
    String(ref || "").toUpperCase()
  );
  if (!match) return null;
  const column = (letters) =>
    [...letters].reduce(
      (value, character) => value * 26 + character.charCodeAt(0) - 64,
      0
    );
  const result = {
    startColumn: column(match[1]),
    startRow: Number(match[2]),
    endColumn: column(match[3]),
    endRow: Number(match[4])
  };
  const rowSpan = result.endRow - result.startRow + 1;
  const columnSpan = result.endColumn - result.startColumn + 1;
  if (
    rowSpan < 1 ||
    columnSpan < 1 ||
    rowSpan > 200 ||
    columnSpan > 80 ||
    rowSpan * columnSpan > 4096
  ) {
    return null;
  }
  return result;
}

function visualXlsxMergeMap(sheet) {
  const starts = new Map();
  const covered = new Set();
  for (const ref of sheet?.merges || []) {
    const merge = xlsxMergeCoordinates(ref);
    if (!merge) continue;
    starts.set(`${merge.startRow}:${merge.startColumn}`, merge);
    for (let row = merge.startRow; row <= merge.endRow; row += 1) {
      for (
        let column = merge.startColumn;
        column <= merge.endColumn;
        column += 1
      ) {
        if (row !== merge.startRow || column !== merge.startColumn) {
          covered.add(`${row}:${column}`);
        }
      }
    }
  }
  return { starts, covered };
}

function visualXlsxHeaderFooterMarkup(value, kind) {
  if (!value || !(value.left || value.center || value.right)) return "";
  const label = kind === "header" ? "Колонтитул листа" : "Нижний колонтитул листа";
  return `<div class="template-xlsx-header-footer is-${kind}" aria-label="${label}">
    <span>${structureEscape(value.left || "")}</span>
    <span>${structureEscape(value.center || "")}</span>
    <span>${structureEscape(value.right || "")}</span>
  </div>`;
}

function visualShowXlsxSheet(root, path) {
  root.querySelectorAll("[data-visual-sheet]").forEach((sheet) => {
    const active = sheet.getAttribute("data-visual-sheet") === path;
    sheet.hidden = !active;
    sheet.classList.toggle("is-active", active);
  });
  root.querySelectorAll("[data-visual-sheet-tab]").forEach((button) => {
    const active = button.getAttribute("data-visual-sheet-tab") === path;
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.classList.toggle("is-active", active);
  });
}

function attachVisualInteractions(root) {
  root.addEventListener("mouseup", (event) => {
    const target = event.target.closest(
      ".template-visual-target[data-visual-docx]"
    );
    if (target) visualDocxCaptureDirectSelection(target);
  });
  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-structure-id]");
    if (target) {
      const id = target.getAttribute("data-structure-id") || "";
      if (
        target.hasAttribute("data-visual-docx") &&
        id === visualDocxSuppressClickId &&
        Date.now() < visualDocxSuppressClickUntil
      ) {
        visualDocxSuppressClickId = "";
        return;
      }
      if (target.hasAttribute("data-visual-docx")) {
        window.getSelection()?.removeAllRanges();
      }
      visualSelectElement(target);
      return;
    }
    const listTarget = event.target.closest("[data-visual-list-id]");
    if (listTarget) {
      visualSelectElement(listTarget);
      return;
    }
    const sheetButton = event.target.closest("[data-visual-sheet-tab]");
    if (sheetButton) {
      visualShowXlsxSheet(
        root,
        sheetButton.getAttribute("data-visual-sheet-tab") || ""
      );
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest("[data-structure-id]");
    if (!target) return;
    event.preventDefault();
    visualSelectElement(target);
  });
}

function visualWarnings(layout) {
  const warnings = Array.isArray(layout?.warnings) ? layout.warnings : [];
  if (warnings.length === 0) return "";
  return `<div class="structure-warning template-visual-warning">
    <span aria-hidden="true">ℹ️</span>
    <div><strong>Что проверить в пробной копии</strong>${warnings
      .map((message) => `<p>${structureEscape(message)}</p>`)
      .join("")}</div>
  </div>`;
}

function renderVisualDocxStructure(report, _layout, operationId) {
  return renderStructureElementList(report, operationId);
}

function renderVisualXlsxStructure(report, _layout, operationId) {
  return renderStructureElementList(report, operationId);
}
