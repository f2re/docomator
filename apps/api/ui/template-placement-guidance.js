{
  const placementBaseTextRangeControl = structureTextRangeControl;
  structureTextRangeControl = function structureTextRangeControlWithGuidance(element) {
    if (element.kind !== "paragraph" || element.text) {
      return placementBaseTextRangeControl(element);
    }
    const inTable = Boolean(element.tableLocation);
    return `
      <div class="structure-placement-card is-ready placement-guidance-card">
        <input id="documentFieldParagraphMode" type="hidden" value="whole" />
        <span class="placement-guidance-target" aria-hidden="true">${inTable ? "□" : "¶"}</span>
        <div>
          <strong>${inTable ? "Выбрана пустая ячейка таблицы" : "Выбран пустой абзац"}</strong>
          <p>${inTable ? "После сохранения значение выбранного поля будет записано именно в эту ячейку." : "После сохранения весь этот пустой абзац станет местом для значения поля."}</p>
          <small><b>Что делать:</b> выберите поле справа, при необходимости задайте формат ФИО и нажмите «Связать с документом». Выделять текст здесь не требуется, потому что место уже пустое.</small>
        </div>
      </div>`;
  };

  const placementBaseReadyMessage = structureFieldReadyMessage;
  structureFieldReadyMessage = function structureFieldReadyMessageWithGuidance(form) {
    if (selectedStructureElement?.kind === "paragraph" && !selectedStructureElement.text) {
      const definition = structureSelectedDefinition(
        form.querySelector("#documentFieldProperty")?.value || ""
      );
      const fieldLabel =
        definition?.label ||
        form.querySelector("#documentFieldLabel")?.value?.trim() ||
        "выбранное поле";
      return selectedStructureElement.tableLocation
        ? `Готово: значение «${fieldLabel}» будет записано в выбранную пустую ячейку. Нажмите «Связать с документом».`
        : `Готово: пустой абзац станет местом для значения «${fieldLabel}». Нажмите «Связать с документом».`;
    }
    return placementBaseReadyMessage(form);
  };
}

/*
 * CSP-safe rich Office projection.
 * The base visual editor parses the rich layout contract, while this final layer
 * renders only data tokens. Per-document formatting comes from a same-origin
 * stylesheet endpoint, so the global style-src remains 'self' without unsafe-inline.
 */
{
  const visualStylesheetId = "templateVisualLayoutStylesheet";

  function cspVisualStyleAttribute(token) {
    return token ? ` data-visual-style="${token}"` : "";
  }

  function cspAttachVisualStylesheet(report) {
    document.getElementById(visualStylesheetId)?.remove();
    const spaceId = globalThis.docomatorTemplateWizard?.spaceId() || "";
    const draftId = structureDraft?.id || structureWizardArtifacts().draftId || "";
    if (!spaceId || !draftId || !/^[a-f0-9]{64}$/u.test(String(report?.sourceSha256 || ""))) {
      return;
    }
    const link = document.createElement("link");
    link.id = visualStylesheetId;
    link.rel = "stylesheet";
    link.href = `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draftId)}/visual-layout.css?sourceSha256=${encodeURIComponent(report.sourceSha256)}`;
    link.addEventListener("error", () => {
      const current = document.querySelector("#documentStructureResult .structure-report");
      if (!current || current.querySelector("[data-visual-css-warning]")) return;
      current.insertAdjacentHTML(
        "afterbegin",
        '<div class="structure-warning" data-visual-css-warning><span aria-hidden="true">⚠️</span><p><strong>Часть исходного оформления не показана.</strong> Данные и привязки сохранены; продолжайте по структуре документа и обязательно проверьте пробную копию.</p></div>'
      );
    });
    document.head.append(link);
  }

  function cspDocxParagraphMap(layout) {
    return new Map(
      (layout?.docx?.paragraphs || []).map((item, index) => [
        item.elementId,
        { item, index }
      ])
    );
  }

  function cspDocxTableMap(layout) {
    return new Map(
      (layout?.docx?.tables || []).map((item, index) => [
        `${item.part}\u0000${item.tableIndex}`,
        { item, index }
      ])
    );
  }

  function cspVisualImageMarkup(image, token, extraClass = "") {
    const classes = `template-visual-media${extraClass ? ` ${extraClass}` : ""}`;
    if (!image?.dataUri || !/^data:image\/(png|jpeg|gif|webp);base64,/u.test(image.dataUri)) {
      return `<span class="template-visual-media-placeholder${extraClass ? ` ${extraClass}` : ""}" title="${structureEscape(image?.mediaPath || "Встроенный объект")}">Изображение сохранено в файле; браузерный показ этого формата недоступен.</span>`;
    }
    return `<img class="${classes}" src="${structureEscape(image.dataUri)}" alt="${structureEscape(image.altText || "Встроенное изображение")}"${cspVisualStyleAttribute(token)} />`;
  }

  function cspDocxTargetMarkup(element, paragraphEntry, extraClass = "") {
    const runs = Array.isArray(element.runs) && element.runs.length > 0
      ? element.runs
      : [{ text: element.text || "", bold: false, italic: false }];
    const paragraphIndex = paragraphEntry?.index;
    const runMarkup = runs
      .map((run, runIndex) => {
        const classes = [
          "template-visual-run",
          run.bold ? "is-bold" : "",
          run.italic ? "is-italic" : ""
        ].filter(Boolean).join(" ");
        const token = Number.isInteger(paragraphIndex)
          ? `docx-p-${paragraphIndex}-r-${runIndex}`
          : "";
        return `<span class="${classes}"${cspVisualStyleAttribute(token)}>${structureEscape(run.text || "")}</span>`;
      })
      .join("");
    const imageMarkup = (paragraphEntry?.item?.images || [])
      .map((image, imageIndex) =>
        cspVisualImageMarkup(
          image,
          `docx-p-${paragraphEntry.index}-i-${imageIndex}`
        )
      )
      .join("");
    const empty = String(element.text || "").length === 0 && !imageMarkup;
    const location = structureLocation(element);
    const label = `${location}. ${empty ? "Пустое место. " : ""}Нажмите, чтобы назначить поле${empty ? "." : ", или выделите заменяемый текст прямо в документе."}`;
    const paragraphToken = Number.isInteger(paragraphIndex) ? `docx-p-${paragraphIndex}` : "";
    return `<div class="structure-element template-visual-target template-visual-paragraph${empty ? " is-empty" : ""}${extraClass ? ` ${extraClass}` : ""}" role="button" tabindex="0" data-structure-id="${structureEscape(element.id)}" aria-pressed="false" aria-label="${structureEscape(label)}"${cspVisualStyleAttribute(paragraphToken)}><span class="template-visual-location" aria-hidden="true">${structureEscape(location)}</span><span class="template-visual-text">${runMarkup}</span>${imageMarkup}</div>`;
  }

  function cspDocxTableMarkup(block, part, paragraphMap, tableMap) {
    const tableEntry = tableMap.get(`${part}\u0000${block.tableIndex}`);
    const table = tableEntry?.item;
    const tableOrdinal = tableEntry?.index;
    const rows = [...block.rows.entries()].sort(([left], [right]) => left - right);
    const colgroup = (table?.columnWidthsPt || []).length
      ? `<colgroup>${table.columnWidthsPt.map((_width, columnIndex) => `<col${cspVisualStyleAttribute(`docx-t-${tableOrdinal}-col-${columnIndex}`)} />`).join("")}</colgroup>`
      : "";
    const body = rows.map(([rowIndex, columns]) => {
      const cells = [...columns.entries()].sort(([left], [right]) => left - right);
      return `<tr class="structure-table-row template-visual-table-row" data-visual-row="${rowIndex}">${cells.map(([columnIndex, paragraphs]) => {
        const cell = table ? visualDocxCellMeta(table, rowIndex, columnIndex) : null;
        if (cell?.verticalMerge === "continue") return "";
        const rowSpan = table ? visualDocxVerticalRowSpan(table, cell) : 1;
        const colSpan = Math.max(1, Number(cell?.columnSpan) || 1);
        const token = Number.isInteger(tableOrdinal)
          ? `docx-t-${tableOrdinal}-r-${rowIndex}-c-${columnIndex}`
          : "";
        return `<td class="structure-table-cell-stack template-visual-table-cell"${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ""}${colSpan > 1 ? ` colspan="${colSpan}"` : ""}${cspVisualStyleAttribute(token)}>${paragraphs.sort((left, right) => left.index - right.index).map((element) => cspDocxTargetMarkup(element, paragraphMap.get(element.id), "is-table-paragraph structure-table-cell-element")).join("")}</td>`;
      }).join("")}</tr>`;
    }).join("");
    return `<div class="template-visual-table-wrap"><table class="template-visual-table" aria-label="Таблица ${block.tableIndex + 1}">${colgroup}<tbody>${body}</tbody></table></div>`;
  }

  function cspDocxBlocksMarkup(elements, part, paragraphMap, tableMap) {
    return visualDocxBlocks(elements)
      .map((block) =>
        block.kind === "table"
          ? cspDocxTableMarkup(block, part, paragraphMap, tableMap)
          : cspDocxTargetMarkup(block.element, paragraphMap.get(block.element.id))
      )
      .join("");
  }

  function cspDocxRegionMarkup(part, elements, paragraphMap, tableMap) {
    const kind = visualDocxPartKind(part);
    return `<section class="template-visual-region is-${structureEscape(kind)}" data-visual-region="${structureEscape(kind)}" data-visual-part="${structureEscape(part)}" aria-label="${structureEscape(visualDocxPartLabel(part))}"><div class="template-visual-region-label">${structureEscape(visualDocxPartLabel(part))}</div><div class="template-visual-region-content">${cspDocxBlocksMarkup(elements, part, paragraphMap, tableMap) || '<p class="template-visual-empty-region">В этой области нет доступного текста для подстановки.</p>'}</div></section>`;
  }

  renderVisualDocxStructure = function renderVisualDocxStructureCspSafe(report, layout, operationId) {
    structureReport = report;
    selectedStructureElement = null;
    selectedStructureTextRange = null;
    const result = document.querySelector("#documentStructureResult");
    const analyzeButton = document.querySelector("#documentStructureButton");
    if (!result) return;
    if (analyzeButton) analyzeButton.hidden = true;
    const summary = report.summary || {};
    const paragraphMap = cspDocxParagraphMap(layout);
    const tableMap = cspDocxTableMap(layout);
    const regions = visualDocxRegions(report);
    const regionMarkup = regions
      .filter(([part]) => visualDocxPartKind(part) !== "notes")
      .map(([part, elements]) => cspDocxRegionMarkup(part, elements, paragraphMap, tableMap))
      .join("");
    const notesMarkup = regions
      .filter(([part]) => visualDocxPartKind(part) === "notes")
      .map(([part, elements]) => cspDocxRegionMarkup(part, elements, paragraphMap, tableMap))
      .join("");
    const richReady = Boolean(layout?.docx);
    result.innerHTML = `<article class="structure-report template-visual-editor template-visual-docx"><header><div><p class="eyebrow">Разметка полей</p><h3>${structureEscape(report.fileName)}</h3><p>${richReady ? "Оформление прочитано из сохранённого DOCX." : "Показываем безопасную структуру документа."} Нажмите место целиком или выделите заменяемый текст непосредственно на странице.</p></div><span class="pill pill-success">${richReady ? "Оформление прочитано" : "Готово к разметке"}</span></header><div class="structure-metrics"><div><strong>${summary.paragraphs ?? 0}</strong><span>абзацев</span></div><div><strong>${summary.runs ?? 0}</strong><span>текстовых фрагментов</span></div><div><strong>${summary.partsRead ?? 0}</strong><span>областей документа</span></div></div>${visualWarnings(layout)}<div class="template-visual-accuracy-note"><strong>Привязка остаётся детерминированной.</strong><span>Шрифт, размер, начертание, цвет, выравнивание, отступы, таблицы, колонтитулы и безопасные raster-изображения показаны для ориентации. Пагинацию, плавающие DrawingML/SmartArt/OLE и окончательный вид подтверждает пробная копия/PDF.</span></div><div class="template-visual-workspace"><div class="template-visual-canvas" aria-label="Визуальное представление DOCX"><div class="template-visual-page"${cspVisualStyleAttribute("docx-page")}>${regionMarkup || '<p class="template-visual-empty-region">В документе нет доступного текста для разметки.</p>'}</div>${notesMarkup ? `<div class="template-visual-notes">${notesMarkup}</div>` : ""}</div><aside class="structure-selection template-visual-inspector" id="documentStructureSelection" hidden aria-live="polite"></aside></div><details class="template-visual-fallback"><summary>Список мест документа</summary><p>Резервный способ выбора для клавиатуры и сложной верстки. Использует те же серверные координаты.</p><div class="template-visual-list">${visualFallbackList(report)}</div></details>${visualTechnical(report, operationId)}</article>`;
    result.querySelectorAll(".template-visual-paragraph").forEach((target) => target.setAttribute("data-visual-docx", ""));
    if (result.dataset.visualInteractionsBound !== "true") {
      attachVisualInteractions(result);
      result.dataset.visualInteractionsBound = "true";
    }
    if (richReady) cspAttachVisualStylesheet(report);
  };

  function cspXlsxAnchor(image) {
    const match = /^R([1-9][0-9]*)C([1-9][0-9]*)$/u.exec(String(image?.anchor || ""));
    return match ? { row: Number(match[1]), column: Number(match[2]) } : null;
  }

  function cspXlsxSheetCoordinates(sheet) {
    const rows = new Set((sheet.cells || []).map((cell) => cell.row));
    const columns = new Set((sheet.cells || []).map((cell) => cell.column));
    for (const row of sheet.rows || []) rows.add(row.row);
    for (const column of sheet.columns || []) columns.add(column.column);
    for (const mergeRef of sheet.merges || []) {
      const merge = xlsxMergeCoordinates(mergeRef);
      if (!merge) continue;
      for (let row = merge.startRow; row <= merge.endRow; row += 1) rows.add(row);
      for (let column = merge.startColumn; column <= merge.endColumn; column += 1) columns.add(column);
    }
    for (const image of sheet.images || []) {
      const anchor = cspXlsxAnchor(image);
      if (anchor) {
        rows.add(anchor.row);
        columns.add(anchor.column);
      }
    }
    return {
      rows: [...rows].sort((left, right) => left - right),
      columns: [...columns].sort((left, right) => left - right)
    };
  }

  function cspXlsxImagesAt(sheet, row, column) {
    const result = [];
    (sheet.images || []).forEach((image, index) => {
      const anchor = cspXlsxAnchor(image);
      if (anchor?.row === row && anchor.column === column) result.push({ image, index });
    });
    return result;
  }

  function cspXlsxSheetMarkup(sheet, sheetIndex) {
    const { rows: rowNumbers, columns: columnNumbers } = cspXlsxSheetCoordinates(sheet);
    const cellMap = new Map((sheet.cells || []).map((cell) => [`${cell.row}:${cell.column}`, cell]));
    const mergeMap = visualXlsxMergeMap(sheet);
    const colgroup = columnNumbers
      .map((column) => `<col${cspVisualStyleAttribute(`xlsx-s-${sheetIndex}-col-${column}`)} />`)
      .join("");
    const head = `<tr><th class="template-xlsx-corner" aria-hidden="true"></th>${columnNumbers.map((column) => `<th scope="col">${xlsxColumnLabel(column)}</th>`).join("")}</tr>`;
    const body = rowNumbers.map((row) => `<tr${cspVisualStyleAttribute(`xlsx-s-${sheetIndex}-row-${row}`)}><th class="template-xlsx-row-number" scope="row">${row}</th>${columnNumbers.map((column) => {
      const key = `${row}:${column}`;
      if (mergeMap.covered.has(key)) return "";
      const cell = cellMap.get(key);
      const merge = mergeMap.starts.get(key);
      const images = cspXlsxImagesAt(sheet, row, column);
      const imageMarkup = images
        .map(({ image, index }) => cspVisualImageMarkup(image, `xlsx-s-${sheetIndex}-i-${index}`, "template-xlsx-media"))
        .join("");
      const span = merge ? ` rowspan="${merge.endRow - merge.startRow + 1}" colspan="${merge.endColumn - merge.startColumn + 1}"` : "";
      if (!cell && !imageMarkup) return `<td${span}></td>`;
      const element = cell ? visualElementById(cell.elementId) : null;
      const location = element ? structureLocation(element) : `${sheet.name} · ${xlsxColumnLabel(column)}${row}`;
      const formula = element?.formula ? `<small class="template-xlsx-formula" title="${structureEscape(element.formula)}">ƒ</small>` : "";
      const targetAttributes = cell && element
        ? ` class="structure-element template-visual-target template-xlsx-cell" role="button" tabindex="0" data-structure-id="${structureEscape(cell.elementId)}" aria-pressed="false" aria-label="${structureEscape(location)}"`
        : ' class="template-xlsx-cell"';
      return `<td${targetAttributes}${span}${cspVisualStyleAttribute(cell ? `xlsx-s-${sheetIndex}-r-${row}-c-${column}` : "")}><span class="template-visual-location" aria-hidden="true">${structureEscape(location)}</span><span class="template-xlsx-value">${structureEscape(cell?.displayValue || "")}</span>${formula}${imageMarkup}</td>`;
    }).join("")}</tr>`).join("");
    return `<section class="template-xlsx-sheet${sheetIndex === 0 ? " is-active" : ""}" data-visual-sheet="${structureEscape(sheet.path)}"${sheetIndex === 0 ? "" : " hidden"}>${visualXlsxHeaderFooterMarkup(sheet.header, "header")}<div class="template-xlsx-grid-wrap"><table class="template-xlsx-grid"><colgroup><col class="template-xlsx-row-header-col" />${colgroup}</colgroup><thead>${head}</thead><tbody>${body}</tbody></table></div>${visualXlsxHeaderFooterMarkup(sheet.footer, "footer")}</section>`;
  }

  renderVisualXlsxStructure = function renderVisualXlsxStructureCspSafe(report, layout, operationId) {
    structureReport = report;
    selectedStructureElement = null;
    selectedStructureTextRange = null;
    const result = document.querySelector("#documentStructureResult");
    const analyzeButton = document.querySelector("#documentStructureButton");
    if (!result) return;
    if (analyzeButton) analyzeButton.hidden = true;
    const summary = report.summary || {};
    const sheets = layout?.xlsx?.sheets || [];
    const tabs = sheets.map((sheet, index) => `<button type="button" role="tab" class="template-xlsx-tab${index === 0 ? " is-active" : ""}" data-visual-sheet-tab="${structureEscape(sheet.path)}" aria-selected="${index === 0 ? "true" : "false"}">${structureEscape(sheet.name)}</button>`).join("");
    const sheetMarkup = sheets.map(cspXlsxSheetMarkup).join("");
    result.innerHTML = `<article class="structure-report template-visual-editor template-visual-xlsx"><header><div><p class="eyebrow">Разметка полей</p><h3>${structureEscape(report.fileName)}</h3><p>Книга показана как безопасная сетка Excel/Calc: размеры, объединения и оформление ячеек читаются из сохранённого XLSX.</p></div><span class="pill pill-success">Листы и оформление прочитаны</span></header><div class="structure-metrics"><div><strong>${summary.sheets ?? 0}</strong><span>листов</span></div><div><strong>${summary.cells ?? 0}</strong><span>ячеек</span></div><div><strong>${summary.formulas ?? 0}</strong><span>формул</span></div></div>${visualWarnings(layout)}<div class="template-visual-accuracy-note"><strong>Формулы не становятся полями.</strong><span>Показывается последнее сохранённое значение и оформление. Для привязки доступна только обычная ячейка; backend повторно проверяет адрес. Изображения показаны около их якорной ячейки.</span></div><div class="template-visual-workspace"><div class="template-visual-canvas template-xlsx-canvas" aria-label="Визуальное представление XLSX"><div class="template-xlsx-tabs" role="tablist" aria-label="Листы книги">${tabs}</div>${sheetMarkup || '<p class="template-visual-empty-region">В книге нет доступных ячеек.</p>'}</div><aside class="structure-selection template-visual-inspector" id="documentStructureSelection" hidden aria-live="polite"></aside></div><details class="template-visual-fallback"><summary>Список ячеек книги</summary><p>Резервный способ выбора. Использует те же проверяемые адреса ячеек.</p><div class="template-visual-list">${visualFallbackList(report)}</div></details>${visualTechnical(report, operationId)}</article>`;
    if (result.dataset.visualInteractionsBound !== "true") {
      attachVisualInteractions(result);
      result.dataset.visualInteractionsBound = "true";
    }
    cspAttachVisualStylesheet(report);
  };
}

{
  loadVisualLayout = async function loadVisualLayoutWithSafeFallback(
    report,
    operationId,
    requestVersion
  ) {
    const spaceId = globalThis.docomatorTemplateWizard?.spaceId() || "";
    const draftId = structureDraft?.id || structureWizardArtifacts().draftId || "";
    if (!spaceId || !draftId) return;
    try {
      const response = await structureFetchJson(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draftId)}/visual-layout`
      );
      if (requestVersion !== visualLayoutRequestVersion) return;
      const layout = response.data;
      if (
        layout?.sourceSha256 !== report.sourceSha256 ||
        layout?.format !== report.format
      ) {
        throw new Error(
          "Визуальное представление не соответствует сохранённому исходнику."
        );
      }
      if (report.format === "docx") {
        renderVisualDocxStructure(report, layout, operationId);
      } else {
        renderVisualXlsxStructure(report, layout, operationId);
      }
    } catch (error) {
      if (requestVersion !== visualLayoutRequestVersion) return;
      const result = document.querySelector(
        "#documentStructureResult .structure-report"
      );
      if (!result || result.querySelector("[data-visual-fallback-warning]")) return;
      result.insertAdjacentHTML(
        "afterbegin",
        `<div class="structure-warning" data-visual-fallback-warning><span aria-hidden="true">⚠️</span><p><strong>Подробное оформление сейчас не показано.</strong> ${structureEscape(error?.message || "Локальный анализ оформления недоступен.")} Привязки и данные не изменены; используйте показанное безопасное представление и пробную копию.</p></div>`
      );
    }
  };

  renderStructure = function renderStructureWithSafeRichFallback(
    report,
    operationId
  ) {
    if (report?.format !== "docx" && report?.format !== "xlsx") {
      return renderStructureElementList(report, operationId);
    }
    const requestVersion = ++visualLayoutRequestVersion;
    if (report.format === "docx") {
      renderVisualDocxStructure(
        report,
        { warnings: [], docx: null, xlsx: null },
        operationId
      );
    } else {
      renderStructureElementList(report, operationId);
    }
    void loadVisualLayout(report, operationId, requestVersion);
  };
}
