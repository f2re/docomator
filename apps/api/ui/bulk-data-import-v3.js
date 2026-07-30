{
  const bulkV3BaseMappingRow = bulkImportMappingRow;
  const bulkV3BaseRenderPreview = renderBulkImportPreview;
  const bulkV3BaseCollectMappings = collectBulkImportMappings;
  const bulkV3BaseRequestBody = bulkImportRequestBody;

  function bulkV3ColumnRow(column) {
    return [...document.querySelectorAll("[data-bulk-mapping-row]")].find(
      (row) => row.dataset.column === column
    );
  }

  bulkImportMappingRow = function bulkImportMappingRowV3(
    header,
    index,
    identityColumn,
    displayNameColumn
  ) {
    const base = bulkV3BaseMappingRow(
      header,
      index,
      identityColumn,
      displayNameColumn
    );
    if (header === displayNameColumn) return base;
    const valueType = bulkImportGuessValueType(header);
    const defaultChecked = valueType === "enum";
    return base.replace(
      /<\/article>$/u,
      `<label class="operator-check bulk-v3-case-option"><input data-bulk-case-insensitive type="checkbox"${defaultChecked ? " checked" : ""} /><span><strong>Сравнивать без учёта регистра</strong><small>«Кафедра» и «КАФЕДРА» считаются одним значением. Сохраняется первое написание.</small></span></label></article>`
    );
  };

  function bulkV3CoreOptions() {
    return `<section class="bulk-v3-normalization" aria-labelledby="bulkV3NormalizationHeading">
      <div><h3 id="bulkV3NormalizationHeading">Нормализация значений</h3><p>Настройки применяются до предварительной проверки и одинаково работают для CSV и XLSX.</p></div>
      <label class="operator-check"><input id="bulkImportIdentityCaseInsensitive" type="checkbox" checked /><span><strong>Искать прежнюю запись без учёта регистра</strong><small>Например, `EMP-001` и `emp-001` не создадут два объекта. Исходное значение в файле не переписывается.</small></span></label>
      <label class="operator-check"><input id="bulkImportNormalizePersonName" type="checkbox" checked /><span><strong>Привести ФИО к нормальному регистру</strong><small>«ИВАНОВ ИВАН ИВАНОВИЧ» станет «Иванов Иван Иванович»; дефисы и апострофы сохраняются.</small></span></label>
      <label class="operator-check"><input id="bulkImportSplitPersonName" type="checkbox" /><span><strong>Разделить ФИО на Фамилию, Имя и Отчество</strong><small>Система создаст или переиспользует три отдельных поля, доступных в шаблонах.</small></span></label>
      <label class="generation-field" id="bulkImportNameOrderField" hidden><span>Порядок слов в исходной колонке</span><select id="bulkImportNameOrder"><option value="family-given-patronymic">Фамилия Имя Отчество</option><option value="given-patronymic-family">Имя Отчество Фамилия</option></select><small>Для разделения поддерживаются два или три слова. Неоднозначные строки попадут в отчёт ошибок с исходным номером строки.</small></label>
    </section>`;
  }

  function bulkV3DecoratePreview(preview) {
    const root = document.querySelector("#bulkImportPreview");
    if (!root) return;
    const core = root.querySelector(".bulk-import-core-fields");
    if (core && !root.querySelector(".bulk-v3-normalization")) {
      core.insertAdjacentHTML("afterend", bulkV3CoreOptions());
    }
    const split = root.querySelector("#bulkImportSplitPersonName");
    const order = root.querySelector("#bulkImportNameOrderField");
    if (split && order) {
      order.hidden = !split.checked;
      split.addEventListener("change", () => {
        order.hidden = !split.checked;
        invalidateBulkImportPlan();
      });
    }
    const table = root.querySelector(".bulk-import-source-preview table");
    if (table && !table.querySelector("[data-source-row-heading]")) {
      const heading = document.createElement("th");
      heading.dataset.sourceRowHeading = "";
      heading.textContent = "Строка файла";
      table.querySelector("thead tr")?.prepend(heading);
      [...table.querySelectorAll("tbody tr")].forEach((row, index) => {
        const cell = document.createElement("td");
        cell.textContent = String(
          preview.sampleRowNumbers?.[index] ??
            preview.sourceRowNumbers?.[index] ??
            index + 2
        );
        row.prepend(cell);
      });
    }
    if (Array.isArray(preview.warnings) && preview.warnings.length > 0) {
      const summary = root.querySelector(".bulk-import-file-summary");
      if (summary && !root.querySelector(".bulk-v3-parser-warnings")) {
        summary.insertAdjacentHTML(
          "afterend",
          `<div class="bulk-v3-parser-warnings">${preview.warnings
            .map((warning) => `<p>${escapeHtml(warning)}</p>`)
            .join("")}</div>`
        );
      }
    }
  }

  renderBulkImportPreview = function renderBulkImportPreviewV3(preview) {
    bulkV3BaseRenderPreview(preview);
    bulkV3DecoratePreview(preview);
  };

  collectBulkImportMappings = function collectBulkImportMappingsV3() {
    return bulkV3BaseCollectMappings().map((mapping) => ({
      ...mapping,
      caseInsensitive: Boolean(
        bulkV3ColumnRow(mapping.column)?.querySelector(
          "[data-bulk-case-insensitive]"
        )?.checked
      )
    }));
  };

  bulkImportRequestBody = function bulkImportRequestBodyV3() {
    const body = bulkV3BaseRequestBody();
    return {
      ...body,
      sourceRowNumbers:
        bulkImportPreview?.sourceRowNumbers ??
        body.rows.map((_row, index) => index + 2),
      identityCaseInsensitive: Boolean(
        document.querySelector("#bulkImportIdentityCaseInsensitive")?.checked
      ),
      personName: {
        normalizeCase: Boolean(
          document.querySelector("#bulkImportNormalizePersonName")?.checked
        ),
        split: Boolean(
          document.querySelector("#bulkImportSplitPersonName")?.checked
        ),
        sourceOrder:
          document.querySelector("#bulkImportNameOrder")?.value ||
          "family-given-patronymic"
      }
    };
  };
}
