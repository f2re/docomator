const renderStructureElementList = renderStructure;
let visualLayoutRequestVersion = 0;

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
  if (kind === "notes") return String(part).includes("endnotes") ? "Концевые сноски" : "Сноски";
  if (kind === "body") return "Основной текст";
  return "Дополнительная область";
}

function visualCssColor(value) {
  return /^#[0-9A-F]{6}$/iu.test(String(value || "")) ? String(value) : "";
}

function visualCssNumber(value, minimum = -5000, maximum = 5000) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function visualCssFontFamily(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 120 || /[;{}<>]/u.test(text)) return "";
  return text.replace(/["']/gu, "");
}

function visualTextStyle(style = {}) {
  const rules = [];
  if (style.bold) rules.push("font-weight:700");
  if (style.italic) rules.push("font-style:italic");
  const color = visualCssColor(style.color);
  const background = visualCssColor(style.backgroundColor);
  const family = visualCssFontFamily(style.fontFamily);
  const size = visualCssNumber(style.fontSizePt, 4, 144);
  if (color) rules.push(`color:${color}`);
  if (background) rules.push(`background-color:${background}`);
  if (family) rules.push(`font-family:&quot;${structureEscape(family)}&quot;,sans-serif`);
  if (size !== null) rules.push(`font-size:${size}pt`);
  if (style.underline && style.strike) rules.push("text-decoration:underline line-through");
  else if (style.underline) rules.push("text-decoration:underline");
  else if (style.strike) rules.push("text-decoration:line-through");
  if (style.verticalAlign === "superscript") rules.push("vertical-align:super;font-size:0.8em");
  if (style.verticalAlign === "subscript") rules.push("vertical-align:sub;font-size:0.8em");
  if (style.caps) rules.push("text-transform:uppercase");
  if (style.smallCaps) rules.push("font-variant-caps:small-caps");
  return rules.join(";");
}

function visualParagraphStyle(style = {}) {
  const rules = [];
  if (["left", "center", "right", "justify"].includes(style.alignment)) {
    rules.push(`text-align:${style.alignment}`);
  }
  const left = visualCssNumber(style.marginLeftPt);
  const right = visualCssNumber(style.marginRightPt);
  const first = visualCssNumber(style.firstLinePt);
  const hanging = visualCssNumber(style.hangingPt);
  const before = visualCssNumber(style.spaceBeforePt, 0, 1000);
  const after = visualCssNumber(style.spaceAfterPt, 0, 1000);
  const line = visualCssNumber(style.lineHeightPt, 1, 1000);
  const background = visualCssColor(style.backgroundColor);
  if (left !== null) rules.push(`margin-left:${left}pt`);
  if (right !== null) rules.push(`margin-right:${right}pt`);
  if (first !== null) rules.push(`text-indent:${first}pt`);
  else if (hanging !== null) rules.push(`text-indent:-${Math.abs(hanging)}pt`);
  if (before !== null) rules.push(`margin-top:${before}pt`);
  if (after !== null) rules.push(`margin-bottom:${after}pt`);
  if (line !== null) rules.push(`line-height:${line}pt`);
  if (background) rules.push(`background-color:${background}`);
  return rules.join(";");
}

function visualBorderRules(borders = {}) {
  const rules = [];
  for (const [side, cssSide] of [["top", "top"], ["right", "right"], ["bottom", "bottom"], ["left", "left"]]) {
    const border = borders[side] || {};
    if (!border.style || border.style === "none" || border.style === "nil") continue;
    const color = visualCssColor(border.color) || "var(--border-strong)";
    const width = visualCssNumber(border.widthPt, 0.25, 12) ?? 0.75;
    const style = /dash/iu.test(border.style) ? "dashed" : /dot/iu.test(border.style) ? "dotted" : "solid";
    rules.push(`border-${cssSide}:${width}pt ${style} ${color}`);
  }
  return rules.join(";");
}

function visualImageMarkup(image, extraClass = "") {
  if (!image?.dataUri || !/^data:image\/(png|jpeg|gif|webp);base64,/u.test(image.dataUri)) {
    return `<span class="template-visual-media-placeholder${extraClass ? ` ${extraClass}` : ""}" title="${structureEscape(image?.mediaPath || "Встроенный объект")}">Изображение сохранено в файле; браузерный показ этого формата недоступен.</span>`;
  }
  const width = visualCssNumber(image.widthPt, 4, 1200);
  const height = visualCssNumber(image.heightPt, 4, 1200);
  const style = [width !== null ? `width:${width}pt` : "", height !== null ? `height:${height}pt` : ""].filter(Boolean).join(";");
  return `<img class="template-visual-media${extraClass ? ` ${extraClass}` : ""}" src="${structureEscape(image.dataUri)}" alt="${structureEscape(image.altText || "Встроенное изображение")}"${style ? ` style="${style}"` : ""} />`;
}

function visualDocxParagraphMap(layout) {
  return new Map((layout?.docx?.paragraphs || []).map((item) => [item.elementId, item]));
}

function visualDocxTableMap(layout) {
  return new Map((layout?.docx?.tables || []).map((item) => [`${item.part}\u0000${item.tableIndex}`, item]));
}

function visualDocxTargetMarkup(element, layoutParagraph, extraClass = "") {
  const runs = Array.isArray(element.runs) && element.runs.length > 0
    ? element.runs
    : [{ text: element.text || "", bold: false, italic: false }];
  const visualRuns = layoutParagraph?.runs || [];
  const runMarkup = runs.map((run, index) => {
    const fallback = { bold: run.bold, italic: run.italic };
    const style = visualTextStyle(visualRuns[index] || fallback);
    return `<span class="template-visual-run"${style ? ` style="${style}"` : ""}>${structureEscape(run.text || "")}</span>`;
  }).join("");
  const imageMarkup = (layoutParagraph?.images || []).map((image) => visualImageMarkup(image)).join("");
  const empty = String(element.text || "").length === 0 && !imageMarkup;
  const location = structureLocation(element);
  const paragraphStyle = visualParagraphStyle(layoutParagraph?.paragraphStyle || {});
  const label = `${location}. ${empty ? "Пустое место. " : ""}Нажмите, чтобы назначить поле${empty ? "." : ", или выделите заменяемый текст прямо в документе."}`;
  return `<div class="structure-element template-visual-target template-visual-paragraph${empty ? " is-empty" : ""}${extraClass ? ` ${extraClass}` : ""}" role="button" tabindex="0" data-structure-id="${structureEscape(element.id)}" aria-pressed="false" aria-label="${structureEscape(label)}"${paragraphStyle ? ` style="${paragraphStyle}"` : ""}><span class="template-visual-location" aria-hidden="true">${structureEscape(location)}</span><span class="template-visual-text">${runMarkup}</span>${imageMarkup}</div>`;
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

function visualDocxCellMeta(table, rowIndex, columnIndex) {
  return table?.cells?.find((cell) => cell.rowIndex === rowIndex && cell.columnIndex === columnIndex) || null;
}

function visualDocxVerticalRowSpan(table, cell) {
  if (!cell || cell.verticalMerge !== "restart") return 1;
  let count = 1;
  for (let row = cell.rowIndex + 1; ; row += 1) {
    const next = visualDocxCellMeta(table, row, cell.columnIndex);
    if (!next || next.verticalMerge !== "continue") break;
    count += 1;
  }
  return count;
}

function visualDocxCellStyle(cell) {
  if (!cell?.style) return "";
  const rules = [];
  const background = visualCssColor(cell.style.backgroundColor);
  const width = visualCssNumber(cell.style.widthPt, 1, 5000);
  if (background) rules.push(`background-color:${background}`);
  if (width !== null) rules.push(`width:${width}pt`);
  if (["top", "center", "bottom"].includes(cell.style.verticalAlign)) {
    rules.push(`vertical-align:${cell.style.verticalAlign === "center" ? "middle" : cell.style.verticalAlign}`);
  }
  const borders = visualBorderRules(cell.style.borders);
  if (borders) rules.push(borders);
  return rules.join(";");
}

function visualDocxTableMarkup(block, part, paragraphMap, tableMap) {
  const table = tableMap.get(`${part}\u0000${block.tableIndex}`);
  const rows = [...block.rows.entries()].sort(([left], [right]) => left - right);
  const colgroup = (table?.columnWidthsPt || []).length
    ? `<colgroup>${table.columnWidthsPt.map((width) => `<col${width > 0 ? ` style="width:${Math.min(width, 5000)}pt"` : ""} />`).join("")}</colgroup>`
    : "";
  return `<div class="template-visual-table-wrap"><table class="template-visual-table" aria-label="Таблица ${block.tableIndex + 1}">${colgroup}<tbody>${rows.map(([rowIndex, columns]) => {
    const cells = [...columns.entries()].sort(([left], [right]) => left - right);
    return `<tr class="structure-table-row template-visual-table-row" data-visual-row="${rowIndex}">${cells.map(([columnIndex, paragraphs]) => {
      const cell = visualDocxCellMeta(table, rowIndex, columnIndex);
      if (cell?.verticalMerge === "continue") return "";
      const rowSpan = visualDocxVerticalRowSpan(table, cell);
      const colSpan = Math.max(1, Number(cell?.columnSpan) || 1);
      const style = visualDocxCellStyle(cell);
      return `<td class="structure-table-cell-stack template-visual-table-cell"${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ""}${colSpan > 1 ? ` colspan="${colSpan}"` : ""}${style ? ` style="${style}"` : ""}>${paragraphs.sort((left, right) => left.index - right.index).map((element) => visualDocxTargetMarkup(element, paragraphMap.get(element.id), "is-table-paragraph structure-table-cell-element")).join("")}</td>`;
    }).join("")}</tr>`;
  }).join("")}</tbody></table></div>`;
}

function visualDocxBlocksMarkup(elements, part, paragraphMap, tableMap) {
  return visualDocxBlocks(elements).map((block) => block.kind === "table"
    ? visualDocxTableMarkup(block, part, paragraphMap, tableMap)
    : visualDocxTargetMarkup(block.element, paragraphMap.get(block.element.id))).join("");
}

function visualDocxRegionMarkup(part, elements, paragraphMap, tableMap) {
  const kind = visualDocxPartKind(part);
  return `<section class="template-visual-region is-${structureEscape(kind)}" data-visual-region="${structureEscape(kind)}" data-visual-part="${structureEscape(part)}" aria-label="${structureEscape(visualDocxPartLabel(part))}"><div class="template-visual-region-label">${structureEscape(visualDocxPartLabel(part))}</div><div class="template-visual-region-content">${visualDocxBlocksMarkup(elements, part, paragraphMap, tableMap) || '<p class="template-visual-empty-region">В этой области нет доступного текста для подстановки.</p>'}</div></section>`;
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

function visualFallbackList(report) {
  const items = (report.elements || []).map((element) => `<button class="template-visual-list-item" type="button" data-visual-list-id="${structureEscape(element.id)}"><span aria-hidden="true">${element.kind === "cell" ? "▦" : "¶"}</span><span><strong>${structureEscape(structureLocation(element))}</strong><small>${structureEscape(structurePreview(element) || "Пустое место")}</small></span></button>`).join("");
  return items || '<p class="template-visual-empty-region">Доступных мест нет.</p>';
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

function visualElementByTarget(target) {
  const id = target?.getAttribute("data-structure-id") || target?.getAttribute("data-visual-list-id") || "";
  return (structureReport?.elements || []).find((candidate) => candidate.id === id) || null;
}

function visualSelectElement(target) {
  const element = visualElementByTarget(target);
  if (element) renderStructureSelection(element);
}

function visualDocxCaptureDirectSelection(target) {
  const element = visualElementByTarget(target);
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

function attachVisualInteractions(root) {
  root.addEventListener("mouseup", (event) => {
    const target = event.target.closest(".template-visual-target[data-visual-docx]");
    if (target) visualDocxCaptureDirectSelection(target);
  });
  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-structure-id]");
    if (target) {
      const id = target.getAttribute("data-structure-id") || "";
      if (target.hasAttribute("data-visual-docx") && id === visualDocxSuppressClickId && Date.now() < visualDocxSuppressClickUntil) {
        visualDocxSuppressClickId = "";
        return;
      }
      if (target.hasAttribute("data-visual-docx")) window.getSelection()?.removeAllRanges();
      visualSelectElement(target);
      return;
    }
    const listTarget = event.target.closest("[data-visual-list-id]");
    if (listTarget) visualSelectElement(listTarget);
    const sheetButton = event.target.closest("[data-visual-sheet-tab]");
    if (sheetButton) visualShowXlsxSheet(root, sheetButton.getAttribute("data-visual-sheet-tab") || "");
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
  if (!warnings.length) return "";
  return `<div class="structure-warning template-visual-warning"><span aria-hidden="true">ℹ️</span><div><strong>Что проверить в пробной копии</strong>${warnings.map((message) => `<p>${structureEscape(message)}</p>`).join("")}</div></div>`;
}

function visualPageStyle(layout) {
  const page = layout?.docx?.page;
  const width = visualCssNumber(page?.widthPt, 100, 2000);
  const top = visualCssNumber(page?.margins?.topPt, 0, 500);
  const right = visualCssNumber(page?.margins?.rightPt, 0, 500);
  const bottom = visualCssNumber(page?.margins?.bottomPt, 0, 500);
  const left = visualCssNumber(page?.margins?.leftPt, 0, 500);
  const rules = [];
  if (width !== null) rules.push(`--template-page-width:${width}pt`);
  if (top !== null) rules.push(`--template-page-top:${top}pt`);
  if (right !== null) rules.push(`--template-page-right:${right}pt`);
  if (bottom !== null) rules.push(`--template-page-bottom:${bottom}pt`);
  if (left !== null) rules.push(`--template-page-left:${left}pt`);
  return rules.join(";");
}

function renderVisualDocxStructure(report, layout, operationId) {
  structureReport = report;
  selectedStructureElement = null;
  selectedStructureTextRange = null;
  const result = document.querySelector("#documentStructureResult");
  const analyzeButton = document.querySelector("#documentStructureButton");
  if (!result) return;
  if (analyzeButton) analyzeButton.hidden = true;
  const summary = report.summary || {};
  const paragraphMap = visualDocxParagraphMap(layout);
  const tableMap = visualDocxTableMap(layout);
  const regions = visualDocxRegions(report);
  const regionMarkup = regions.filter(([part]) => visualDocxPartKind(part) !== "notes").map(([part, elements]) => visualDocxRegionMarkup(part, elements, paragraphMap, tableMap)).join("");
  const notesMarkup = regions.filter(([part]) => visualDocxPartKind(part) === "notes").map(([part, elements]) => visualDocxRegionMarkup(part, elements, paragraphMap, tableMap)).join("");
  const pageStyle = visualPageStyle(layout);
  result.innerHTML = `<article class="structure-report template-visual-editor template-visual-docx"><header><div><p class="eyebrow">Разметка полей</p><h3>${structureEscape(report.fileName)}</h3><p>Оформление читается из сохранённого DOCX. Нажмите место целиком или выделите заменяемый текст непосредственно на странице.</p></div><span class="pill pill-success">Исходное оформление показано</span></header><div class="structure-metrics"><div><strong>${summary.paragraphs ?? 0}</strong><span>абзацев</span></div><div><strong>${summary.runs ?? 0}</strong><span>текстовых фрагментов</span></div><div><strong>${summary.partsRead ?? 0}</strong><span>областей документа</span></div></div>${visualWarnings(layout)}<div class="template-visual-accuracy-note"><strong>Привязка остаётся детерминированной.</strong><span>Цвет, шрифт, размер, подчёркивание, выравнивание, отступы, таблицы, колонтитулы и безопасные raster-изображения показаны для ориентации. Пагинацию, плавающие DrawingML/SmartArt/OLE и окончательный вид подтверждает пробная копия/PDF.</span></div><div class="template-visual-workspace"><div class="template-visual-canvas" aria-label="Визуальное представление DOCX"><div class="template-visual-page"${pageStyle ? ` style="${pageStyle}"` : ""}>${regionMarkup || '<p class="template-visual-empty-region">В документе нет доступного текста для разметки.</p>'}</div>${notesMarkup ? `<div class="template-visual-notes">${notesMarkup}</div>` : ""}</div><aside class="structure-selection template-visual-inspector" id="documentStructureSelection" hidden aria-live="polite"></aside></div><details class="template-visual-fallback"><summary>Список мест документа</summary><p>Резервный способ выбора для клавиатуры и сложной верстки. Использует те же серверные координаты.</p><div class="template-visual-list">${visualFallbackList(report)}</div></details>${visualTechnical(report, operationId)}</article>`;
  result.querySelectorAll(".template-visual-target").forEach((target) => target.setAttribute("data-visual-docx", ""));
  attachVisualInteractions(result);
}

function xlsxColumnLabel(number) {
  let value = number;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label || "A";
}

function xlsxMergeCoordinates(ref) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6}):([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(String(ref || "").toUpperCase());
  if (!match) return null;
  const column = (letters) => [...letters].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
  return { startColumn: column(match[1]), startRow: Number(match[2]), endColumn: column(match[3]), endRow: Number(match[4]) };
}

function visualXlsxMergeMap(sheet) {
  const starts = new Map();
  const covered = new Set();
  for (const ref of sheet.merges || []) {
    const merge = xlsxMergeCoordinates(ref);
    if (!merge) continue;
    starts.set(`${merge.startRow}:${merge.startColumn}`, merge);
    for (let row = merge.startRow; row <= merge.endRow; row += 1) {
      for (let column = merge.startColumn; column <= merge.endColumn; column += 1) {
        if (row !== merge.startRow || column !== merge.startColumn) covered.add(`${row}:${column}`);
      }
    }
  }
  return { starts, covered };
}

function visualXlsxCellStyle(style = {}) {
  const rules = [];
  const font = visualTextStyle(style.font || {});
  if (font) rules.push(font);
  const fill = visualCssColor(style.fillColor);
  if (fill) rules.push(`background-color:${fill}`);
  if (["left", "center", "right", "justify"].includes(style.horizontalAlign)) rules.push(`text-align:${style.horizontalAlign}`);
  if (["top", "center", "bottom"].includes(style.verticalAlign)) rules.push(`vertical-align:${style.verticalAlign === "center" ? "middle" : style.verticalAlign}`);
  if (style.wrapText) rules.push("white-space:pre-wrap");
  const borders = visualBorderRules(style.borders);
  if (borders) rules.push(borders);
  return rules.join(";");
}

function visualXlsxHeaderFooterMarkup(value, kind) {
  if (!value || !(value.left || value.center || value.right)) return "";
  return `<div class="template-xlsx-header-footer is-${kind}" aria-label="${kind === "header" ? "Колонтитул листа" : "Нижний колонтитул листа"}"><span>${structureEscape(value.left || "")}</span><span>${structureEscape(value.center || "")}</span><span>${structureEscape(value.right || "")}</span></div>`;
}

function visualXlsxImageByAnchor(sheet, row, column) {
  return (sheet.images || []).filter((image) => image.anchor === `R${row}C${column}`);
}

function visualXlsxSheetMarkup(sheet, index) {
  const cells = Array.isArray(sheet.cells) ? sheet.cells : [];
  const rowNumbers = [...new Set(cells.map((cell) => cell.row))].sort((a, b) => a - b);
  const columnNumbers = [...new Set(cells.map((cell) => cell.column))].sort((a, b) => a - b);
  const cellMap = new Map(cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
  const mergeMap = visualXlsxMergeMap(sheet);
  const columnMeta = new Map((sheet.columns || []).map((column) => [column.column, column]));
  const rowMeta = new Map((sheet.rows || []).map((row) => [row.row, row]));
  const columns = columnNumbers.map((column) => {
    const width = Number(columnMeta.get(column)?.widthChars);
    const px = Number.isFinite(width) ? Math.max(48, Math.min(420, Math.round(width * 7 + 12))) : 96;
    return `<col style="width:${px}px" />`;
  }).join("");
  const head = `<tr><th class="template-xlsx-corner" aria-hidden="true"></th>${columnNumbers.map((column) => `<th scope="col">${xlsxColumnLabel(column)}</th>`).join("")}</tr>`;
  const rows = rowNumbers.map((row) => {
    const height = visualCssNumber(rowMeta.get(row)?.heightPt, 8, 500);
    return `<tr${height !== null ? ` style="height:${height}pt"` : ""}><th class="template-xlsx-row-number" scope="row">${row}</th>${columnNumbers.map((column) => {
      const key = `${row}:${column}`;
      if (mergeMap.covered.has(key)) return "";
      const cell = cellMap.get(key);
      const merge = mergeMap.starts.get(key);
      const images = visualXlsxImageByAnchor(sheet, row, column);
      const imageMarkup = images.map((image) => visualImageMarkup(image, "template-xlsx-media")).join("");
      if (!cell && !imageMarkup) return `<td${merge ? ` rowspan="${merge.endRow - merge.startRow + 1}" colspan="${merge.endColumn - merge.startColumn + 1}"` : ""}></td>`;
      const element = cell ? visualElementById(cell.elementId) : null;
      const location = element ? structureLocation(element) : `${sheet.name} · ${xlsxColumnLabel(column)}${row}`;
      const style = visualXlsxCellStyle(cell?.style || {});
      const formula = element?.formula ? `<small class="template-xlsx-formula" title="${structureEscape(element.formula)}">ƒ</small>` : "";
      const target = cell && element ? ` class="structure-element template-visual-target template-xlsx-cell" role="button" tabindex="0" data-structure-id="${structureEscape(cell.elementId)}" aria-pressed="false" aria-label="${structureEscape(location)}"` : ' class="template-xlsx-cell"';
      return `<td${target}${merge ? ` rowspan="${merge.endRow - merge.startRow + 1}" colspan="${merge.endColumn - merge.startColumn + 1}"` : ""}${style ? ` style="${style}"` : ""}><span class="template-visual-location" aria-hidden="true">${structureEscape(location)}</span><span class="template-xlsx-value">${structureEscape(cell?.displayValue || "")}</span>${formula}${imageMarkup}</td>`;
    }).join("")}</tr>`;
  }).join("");
  return `<section class="template-xlsx-sheet${index === 0 ? " is-active" : ""}" data-visual-sheet="${structureEscape(sheet.path)}"${index === 0 ? "" : " hidden"}>${visualXlsxHeaderFooterMarkup(sheet.header, "header")}<div class="template-xlsx-grid-wrap"><table class="template-xlsx-grid"><colgroup><col class="template-xlsx-row-header-col" />${columns}</colgroup><thead>${head}</thead><tbody>${rows}</tbody></table></div>${visualXlsxHeaderFooterMarkup(sheet.footer, "footer")}</section>`;
}

function visualElementById(id) {
  return (structureReport?.elements || []).find((element) => element.id === id) || null;
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

function renderVisualXlsxStructure(report, layout, operationId) {
  structureReport = report;
  selectedStructureElement = null;
  selectedStructureTextRange = null;
  const result = document.querySelector("#documentStructureResult");
  if (!result) return;
  const summary = report.summary || {};
  const sheets = layout?.xlsx?.sheets || [];
  const tabs = sheets.map((sheet, index) => `<button type="button" role="tab" class="template-xlsx-tab${index === 0 ? " is-active" : ""}" data-visual-sheet-tab="${structureEscape(sheet.path)}" aria-selected="${index === 0 ? "true" : "false"}">${structureEscape(sheet.name)}</button>`).join("");
  const sheetMarkup = sheets.map(visualXlsxSheetMarkup).join("");
  result.innerHTML = `<article class="structure-report template-visual-editor template-visual-xlsx"><header><div><p class="eyebrow">Разметка полей</p><h3>${structureEscape(report.fileName)}</h3><p>Книга показана как безопасная сетка Excel/Calc: размеры, объединения и оформление ячеек читаются из сохранённого XLSX.</p></div><span class="pill pill-success">Листы и оформление показаны</span></header><div class="structure-metrics"><div><strong>${summary.sheets ?? 0}</strong><span>листов</span></div><div><strong>${summary.cells ?? 0}</strong><span>ячеек</span></div><div><strong>${summary.formulas ?? 0}</strong><span>формул</span></div></div>${visualWarnings(layout)}<div class="template-visual-accuracy-note"><strong>Формулы не становятся полями.</strong><span>Показывается последнее сохранённое значение и оформление. Нажать для привязки можно только обычную ячейку; backend повторно проверяет адрес. Изображения привязаны к их якорной ячейке.</span></div><div class="template-visual-workspace"><div class="template-visual-canvas template-xlsx-canvas" aria-label="Визуальное представление XLSX"><div class="template-xlsx-tabs" role="tablist" aria-label="Листы книги">${tabs}</div>${sheetMarkup || '<p class="template-visual-empty-region">В книге нет доступных ячеек.</p>'}</div><aside class="structure-selection template-visual-inspector" id="documentStructureSelection" hidden aria-live="polite"></aside></div><details class="template-visual-fallback"><summary>Список ячеек книги</summary><p>Резервный способ выбора. Использует те же проверяемые адреса ячеек.</p><div class="template-visual-list">${visualFallbackList(report)}</div></details>${visualTechnical(report, operationId)}</article>`;
  attachVisualInteractions(result);
}

function visualTechnical(report, operationId) {
  const summary = report.summary || {};
  return `<details class="intake-technical"><summary>Технические сведения</summary><dl><div><dt>Контрольная сумма исходника</dt><dd><code>${structureEscape(report.sourceSha256)}</code></dd></div><div><dt>Контрольная сумма структуры</dt><dd><code>${structureEscape(report.structureSha256)}</code></dd></div><div><dt>Показано элементов</dt><dd>${summary.shownElements ?? 0} из ${summary.totalElements ?? 0}</dd></div><div><dt>Идентификатор операции</dt><dd><code>${structureEscape(operationId || "не указан")}</code></dd></div></dl></details>`;
}

function renderVisualLoading(report) {
  structureReport = report;
  const result = document.querySelector("#documentStructureResult");
  if (!result) return;
  result.innerHTML = `<div class="structure-loading" role="status"><span aria-hidden="true">⏳</span><div><strong>Восстанавливаем оформление исходника</strong><p>Читаем только безопасные локальные части Office: стили, таблицы, колонтитулы и встроенные изображения.</p></div></div>`;
}

async function loadVisualLayout(report, operationId, requestVersion) {
  const spaceId = globalThis.docomatorTemplateWizard?.spaceId() || "";
  const draftId = structureDraft?.id || structureWizardArtifacts().draftId || "";
  if (!spaceId || !draftId) {
    renderStructureElementList(report, operationId);
    return;
  }
  try {
    const response = await structureFetchJson(`/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draftId)}/visual-layout`);
    if (requestVersion !== visualLayoutRequestVersion) return;
    const layout = response.data;
    if (layout?.sourceSha256 !== report.sourceSha256 || layout?.format !== report.format) {
      throw new Error("Визуальное представление не соответствует сохранённому исходнику.");
    }
    if (report.format === "docx") renderVisualDocxStructure(report, layout, operationId);
    else renderVisualXlsxStructure(report, layout, operationId);
  } catch (error) {
    if (requestVersion !== visualLayoutRequestVersion) return;
    renderStructureElementList(report, operationId);
    const result = document.querySelector("#documentStructureResult .structure-report");
    result?.insertAdjacentHTML("afterbegin", `<div class="structure-warning"><span aria-hidden="true">⚠️</span><p><strong>Точное оформление сейчас не показано.</strong> ${structureEscape(error?.message || "Проверьте соединение с локальным сервером.")} Привязки и данные не изменены; доступен безопасный список мест.</p></div>`);
  }
}

renderStructure = function renderStructureWithRichVisualDocument(report, operationId) {
  if (report?.format !== "docx" && report?.format !== "xlsx") return renderStructureElementList(report, operationId);
  const requestVersion = ++visualLayoutRequestVersion;
  renderVisualLoading(report);
  void loadVisualLayout(report, operationId, requestVersion);
};
