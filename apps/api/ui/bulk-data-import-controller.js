{
  function bulkImportControllerPanel() {
    return document.querySelector("#bulkDataImportPanel");
  }

  function bulkImportControllerInput() {
    return document.querySelector("#bulkImportFile");
  }

  function bulkImportControllerMessage(text, kind = "warning") {
    const message = document.querySelector("#bulkImportMessage");
    if (!message) return;
    message.className = `bulk-import-message is-${kind}`;
    message.textContent = text;
  }

  function bulkImportControllerRecoveryHint(action = "") {
    document.querySelector("#bulkImportRecoveryHint")?.remove();
    const message = document.querySelector("#bulkImportMessage");
    if (!message || !action) return;
    const hint = document.createElement("div");
    hint.id = "bulkImportRecoveryHint";
    hint.className = "bulk-import-recovery-hint";
    hint.innerHTML = `<strong>Что сделать</strong><span>${escapeHtml(action)}</span>`;
    message.insertAdjacentElement("afterend", hint);
  }

  function bulkImportControllerScopedMemoryKey() {
    const spaceId =
      typeof bulkImportCurrentSpaceId === "function"
        ? bulkImportCurrentSpaceId()
        : String(globalThis.docomatorCurrentSpaceId || "").trim();
    return spaceId ? `${bulkImportMemoryKey}.${spaceId}` : "";
  }

  function bulkImportControllerInstallScopedMemory() {
    if (
      typeof readBulkImportMappingMemory !== "function" ||
      typeof writeBulkImportMappingMemory !== "function" ||
      typeof normalizeBulkImportText !== "function" ||
      typeof bulkImportMemoryKey === "undefined"
    ) {
      return;
    }
    if (globalThis.docomatorBulkImportScopedMemoryInstalled === true) return;
    globalThis.docomatorBulkImportScopedMemoryInstalled = true;

    globalThis.readBulkImportMappingMemory =
      function readScopedBulkImportMappingMemory() {
        try {
          const memoryKey = bulkImportControllerScopedMemoryKey();
          if (!memoryKey) return {};
          const parsed = JSON.parse(localStorage.getItem(memoryKey) || "{}");
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
        } catch {
          return {};
        }
      };

    globalThis.writeBulkImportMappingMemory =
      function writeScopedBulkImportMappingMemory(resolutions) {
        if (!Array.isArray(resolutions)) return;
        try {
          const memory = readBulkImportMappingMemory();
          for (const item of resolutions) {
            if (!item?.column || !item?.propertyKey) continue;
            memory[normalizeBulkImportText(item.column)] = {
              propertyKey: item.propertyKey,
              propertyLabel: item.propertyLabel,
              valueType: item.valueType,
              updatedAt: new Date().toISOString()
            };
          }
          const memoryKey = bulkImportControllerScopedMemoryKey();
          if (memoryKey) localStorage.setItem(memoryKey, JSON.stringify(memory));
        } catch {
          // Локальная память сопоставлений является необязательной.
        }
      };
  }

  function bulkImportControllerValidateFile(file) {
    if (!(file instanceof File)) {
      return "Не удалось получить файл. Выберите CSV или XLSX ещё раз.";
    }
    const extension = file.name.toLocaleLowerCase("ru-RU").split(".").pop() || "";
    if (!new Set(["csv", "xlsx", "xls"]).has(extension)) {
      return "Поддерживаются только файлы CSV и XLSX. Выбранный файл не отправлен.";
    }
    if (file.size === 0) {
      return "Файл пуст. Выберите таблицу с заголовками и данными.";
    }
    if (file.size > 8 * 1024 * 1024) {
      return "Файл больше 8 МБ. Уменьшите таблицу или разделите её на несколько импортов.";
    }
    return "";
  }

  function bulkImportControllerReflectFile(dropTarget, selected, file) {
    dropTarget.classList.remove("is-error");
    selected.hidden = !file;
    selected.textContent = file
      ? `Выбран: ${file.name} · ${Math.max(1, Math.ceil(file.size / 1024))} КБ`
      : "";
  }

  function bulkImportControllerAssignDroppedFile(input, file) {
    if (typeof DataTransfer !== "function") return false;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      return input.files?.[0] === file || input.files?.[0]?.name === file.name;
    } catch {
      return false;
    }
  }

  function bulkImportControllerPreviewSelectedFile() {
    const input = bulkImportControllerInput();
    const file = input?.files?.[0];
    if (!(input instanceof HTMLInputElement) || !(file instanceof File)) return;
    const problem = bulkImportControllerValidateFile(file);
    const dropTarget = input.closest(".bulk-import-drop-zone");
    const selected = dropTarget?.querySelector(".bulk-import-drop-selected");
    if (problem) {
      input.value = "";
      dropTarget?.classList.add("is-error");
      if (dropTarget instanceof HTMLElement && selected instanceof HTMLElement) {
        bulkImportControllerReflectFile(dropTarget, selected, null);
        dropTarget.classList.add("is-error");
      }
      bulkImportControllerMessage(problem, "error");
      return;
    }
    if (dropTarget instanceof HTMLElement && selected instanceof HTMLElement) {
      bulkImportControllerReflectFile(dropTarget, selected, file);
    }
    document.querySelector("#bulkImportRecoveryHint")?.remove();
    if (typeof previewBulkImportFile === "function") {
      void previewBulkImportFile();
    }
  }

  function bulkImportControllerInstallFileInput(panel, input) {
    const dropTarget = input.closest("label");
    if (!(dropTarget instanceof HTMLElement)) return;
    if (dropTarget.dataset.bulkImportControllerDropBound === "true") return;
    dropTarget.dataset.bulkImportControllerDropBound = "true";
    dropTarget.classList.add("bulk-import-drop-zone");
    dropTarget.insertAdjacentHTML(
      "afterbegin",
      '<div class="bulk-import-drop-copy"><span class="bulk-import-drop-icon" aria-hidden="true">⇩</span><span><strong>Перетащите Excel или CSV сюда</strong><small>или нажмите на область, чтобы выбрать файл</small></span></div>'
    );
    const selected = document.createElement("div");
    selected.className = "bulk-import-drop-selected";
    selected.hidden = true;
    dropTarget.append(selected);

    input.addEventListener("change", bulkImportControllerPreviewSelectedFile);

    for (const eventName of ["dragenter", "dragover"]) {
      dropTarget.addEventListener(eventName, (event) => {
        if (!event.dataTransfer?.types?.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        dropTarget.classList.add("is-dragover");
        event.dataTransfer.dropEffect = "copy";
      });
    }
    for (const eventName of ["dragleave", "dragend"]) {
      dropTarget.addEventListener(eventName, () => {
        dropTarget.classList.remove("is-dragover");
      });
    }
    dropTarget.addEventListener("drop", (event) => {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      dropTarget.classList.remove("is-dragover");
      if (files.length !== 1) {
        dropTarget.classList.add("is-error");
        bulkImportControllerMessage(
          "Перетащите один файл за раз. Несколько файлов не были отправлены.",
          "error"
        );
        return;
      }
      const file = files[0];
      const problem = bulkImportControllerValidateFile(file);
      if (problem) {
        input.value = "";
        bulkImportControllerReflectFile(dropTarget, selected, null);
        dropTarget.classList.add("is-error");
        bulkImportControllerMessage(problem, "error");
        return;
      }
      if (bulkImportControllerAssignDroppedFile(input, file)) {
        bulkImportControllerReflectFile(dropTarget, selected, file);
        bulkImportControllerPreviewSelectedFile();
        return;
      }
      bulkImportControllerReflectFile(dropTarget, selected, file);
      if (typeof previewBulkImportBytes === "function") {
        void previewBulkImportBytes(file.name, file);
      }
    });

    panel.dataset.bulkImportControllerFileBound = "true";
  }

  function bulkImportControllerErrorColumn(error) {
    const candidates = [
      error?.column,
      error?.repair?.column,
      error?.issue?.column,
      error?.issue?.repair?.column
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const column = candidate.trim();
      if (!column) continue;
      if (
        !Array.isArray(bulkImportPreview?.headers) ||
        bulkImportPreview.headers.includes(column)
      ) {
        return column;
      }
    }
    return "";
  }

  function bulkImportControllerErrorHint(error) {
    const action = error?.suggestedAction ?? error?.issue?.suggestedAction;
    return typeof action === "string" && action.trim()
      ? action.trim()
      : "Проверьте отмеченное место. Выбранный файл и остальные настройки сохранены; после исправления снова нажмите «Проверить».";
  }

  function bulkImportControllerErrorRawValue(error) {
    const value = error?.rawValue ?? error?.issue?.rawValue;
    return typeof value === "string" ? value : null;
  }

  function bulkImportControllerErrorRowNumber(error) {
    const value = Number(
      error?.rowNumber ?? error?.sourceRow ?? error?.issue?.rowNumber
    );
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function bulkImportControllerClearHighlights() {
    document
      .querySelectorAll("[data-bulk-mapping-row].has-import-error")
      .forEach((row) => {
        row.classList.remove("has-import-error");
        row.querySelector("[data-bulk-field-error-note]")?.remove();
        row.querySelectorAll('[aria-invalid="true"]').forEach((control) => {
          control.removeAttribute("aria-invalid");
          control.removeAttribute("aria-describedby");
        });
      });
    document
      .querySelectorAll(".bulk-import-table .has-import-error-row")
      .forEach((row) => row.classList.remove("has-import-error-row"));
    document
      .querySelectorAll(".bulk-import-table .has-import-error-cell")
      .forEach((cell) => cell.classList.remove("has-import-error-cell"));
  }

  function bulkImportControllerSourceCell(rowNumber, column) {
    if (!rowNumber || !column) return null;
    const row = [
      ...document.querySelectorAll(
        ".bulk-import-table tbody tr[data-source-row-number]"
      )
    ].find(
      (candidate) =>
        Number(candidate.dataset.sourceRowNumber) === Number(rowNumber)
    );
    if (!row) return null;
    return [...row.querySelectorAll("[data-source-column]")].find(
      (cell) => cell.dataset.sourceColumn === column
    ) || null;
  }

  function bulkImportControllerHighlightProblems(errors) {
    bulkImportControllerClearHighlights();
    const grouped = new Map();
    let highlightedSource = false;
    for (const error of Array.isArray(errors) ? errors : []) {
      const column = bulkImportControllerErrorColumn(error);
      const rowNumber = bulkImportControllerErrorRowNumber(error);
      if (column) {
        const list = grouped.get(column) || [];
        list.push(error);
        grouped.set(column, list);
      }
      const cell = bulkImportControllerSourceCell(rowNumber, column);
      if (cell) {
        cell.classList.add("has-import-error-cell");
        cell.closest("tr")?.classList.add("has-import-error-row");
        highlightedSource = true;
      }
    }
    if (highlightedSource) {
      const details = document.querySelector(".bulk-import-source-preview");
      if (details instanceof HTMLDetailsElement) details.open = true;
    }

    let index = 0;
    for (const [column, items] of grouped) {
      const row =
        typeof bulkImportColumnRow === "function"
          ? bulkImportColumnRow(column)
          : null;
      if (!row) continue;
      row.classList.add("has-import-error");
      const target = row.querySelector(".bulk-import-column-name") || row;
      const note = document.createElement("div");
      note.dataset.bulkFieldErrorNote = "";
      note.className = "bulk-import-field-error-note";
      note.id = `bulkImportFieldError${index++}`;
      const rowList = items
        .slice(0, 5)
        .map((item) => bulkImportControllerErrorRowNumber(item))
        .filter(Boolean)
        .join(", ");
      note.textContent = `${items.length} ошибк${
        items.length === 1 ? "а" : "и"
      }${rowList ? ` · строки ${rowList}` : ""}`;
      target.append(note);
      const wantsType = items.some(
        (item) =>
          (item?.repair?.kind ?? item?.issue?.repair?.kind) ===
          "change_field_type"
      );
      const mode = row.querySelector("[data-bulk-mapping-mode]")?.value || "";
      const control =
        wantsType && mode === "create"
          ? row.querySelector("[data-bulk-value-type]")
          : row.querySelector("[data-bulk-mapping-mode]");
      if (control) {
        control.setAttribute("aria-invalid", "true");
        control.setAttribute("aria-describedby", note.id);
      }
    }
  }

  function bulkImportControllerRenderErrors(errors) {
    if (!Array.isArray(errors) || errors.length === 0) return "";
    const uniqueColumns = new Set(
      errors
        .map((error) => bulkImportControllerErrorColumn(error))
        .filter(Boolean)
    );
    const cards = errors.slice(0, 100).map((error) => {
      const column = bulkImportControllerErrorColumn(error);
      const rowNumber = bulkImportControllerErrorRowNumber(error);
      const rawValue = bulkImportControllerErrorRawValue(error);
      const title = [rowNumber ? `Строка ${rowNumber}` : "Ошибка импорта", column]
        .filter(Boolean)
        .join(" · ");
      const action = column
        ? `<button class="secondary-button compact" type="button" data-bulk-fix-column="${escapeHtml(
            column
          )}"${
            rowNumber ? ` data-bulk-fix-row="${rowNumber}"` : ""
          }>Показать место</button>`
        : "";
      const raw =
        rawValue === null
          ? ""
          : `<small class="bulk-import-error-value"><strong>Значение:</strong> «${escapeHtml(
              rawValue
            )}»</small>`;
      return `<article class="bulk-import-error-card"${
        column ? ` data-error-column="${escapeHtml(column)}"` : ""
      }>
      <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(
        error?.message || "Импорт требует проверки."
      )}</p>${raw}<small><strong>Что сделать:</strong> ${escapeHtml(
        bulkImportControllerErrorHint(error)
      )}</small></div>
      ${action}
    </article>`;
    });
    const omitted =
      errors.length > 100
        ? `<p class="bulk-import-error-overflow">Показаны первые 100 из ${errors.length} ошибок.</p>`
        : "";
    return `<section class="bulk-import-error-guide" role="alert">
      <div><strong>Нужно проверить ${errors.length} строк${
        uniqueColumns.size ? ` в ${uniqueColumns.size} полях` : ""
      }</strong><p>Корректные строки не блокируются и могут быть импортированы. Ошибочные строки будут пропущены; файл и сопоставления остаются на экране.</p></div>
    </section>
    <div class="bulk-import-error-list">${cards.join("")}</div>${omitted}`;
  }

  function bulkImportControllerShowOperationIssue(error) {
    const issue =
      error?.issue && typeof error.issue === "object" ? error.issue : null;
    if (!issue) return;
    const suggestedAction = bulkImportControllerErrorHint(issue);
    bulkImportControllerRecoveryHint(suggestedAction);
    if (issue.scope === "file") {
      document
        .querySelector("#bulkImportFile")
        ?.closest(".bulk-import-drop-zone")
        ?.classList.add("is-error");
      return;
    }
    if (issue.scope !== "mapping") return;
    bulkImportControllerHighlightProblems([issue]);
    const root = document.querySelector("#bulkImportPlan");
    if (root) root.innerHTML = bulkImportControllerRenderErrors([issue]);
    if (typeof setBulkImportStep === "function") setBulkImportStep(2);
    const column = bulkImportControllerErrorColumn(issue);
    const row =
      column && typeof bulkImportColumnRow === "function"
        ? bulkImportColumnRow(column)
        : null;
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      const control =
        row.querySelector('[aria-invalid="true"]') ||
        row.querySelector("[data-bulk-mapping-mode]");
      control?.focus();
    }
  }

  function bulkImportControllerInstallErrorUx(panel) {
    if (panel.dataset.bulkImportControllerErrorBound === "true") return;
    if (
      typeof renderBulkImportErrors !== "function" ||
      typeof renderBulkImportPlan !== "function" ||
      typeof renderBulkImportResult !== "function"
    ) {
      return;
    }
    panel.dataset.bulkImportControllerErrorBound = "true";
    const baseRenderPlan = renderBulkImportPlan;
    const baseRenderResult = renderBulkImportResult;

    globalThis.renderBulkImportErrors = bulkImportControllerRenderErrors;
    globalThis.renderBulkImportPlan = function renderBulkImportPlanWithGuidance(
      plan
    ) {
      baseRenderPlan(plan);
      bulkImportControllerHighlightProblems(plan?.errors);
      const execute = document.querySelector("#bulkImportExecute");
      if (execute && Number(plan?.failedCount || 0) > 0) {
        const valid = Math.max(
          0,
          Number(plan.rowCount || 0) -
            Number(plan.failedCount || 0) -
            Number(plan.skippedCount || 0)
        );
        execute.textContent = `Импортировать ${valid} корректных строк`;
        execute.title = `${plan.failedCount} строк с ошибками будут пропущены. Лучше сначала исправить отмеченные поля.`;
      }
    };
    globalThis.renderBulkImportResult =
      function renderBulkImportResultWithGuidance(result) {
        baseRenderResult(result);
        bulkImportControllerHighlightProblems(result?.errors);
      };
    globalThis.showBulkImportOperationIssue =
      bulkImportControllerShowOperationIssue;

    panel.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-bulk-fix-column]");
      if (!button) return;
      const column = button.dataset.bulkFixColumn || "";
      const sourceRow = Number(button.dataset.bulkFixRow || 0);
      const sourceCell = bulkImportControllerSourceCell(sourceRow, column);
      if (sourceCell) {
        const details = sourceCell.closest("details");
        if (details instanceof HTMLDetailsElement) details.open = true;
        sourceCell.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center"
        });
      }
      const row =
        typeof bulkImportColumnRow === "function"
          ? bulkImportColumnRow(column)
          : null;
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      const mode = row.querySelector("[data-bulk-mapping-mode]")?.value || "";
      const target =
        mode === "create"
          ? row.querySelector("[data-bulk-value-type]")
          : row.querySelector("[data-bulk-mapping-mode]");
      target?.focus();
    });
    for (const eventName of ["input", "change"]) {
      panel.addEventListener(eventName, (event) => {
        const row = event.target.closest?.("[data-bulk-mapping-row]");
        if (!row) return;
        row.classList.remove("has-import-error");
        row.querySelector("[data-bulk-field-error-note]")?.remove();
      });
    }
  }

  function bulkImportControllerInstall() {
    const panel = bulkImportControllerPanel();
    const input = bulkImportControllerInput();
    if (
      !(panel instanceof HTMLElement) ||
      !(input instanceof HTMLInputElement)
    ) {
      return;
    }
    bulkImportControllerInstallScopedMemory();
    bulkImportControllerInstallFileInput(panel, input);
    bulkImportControllerInstallErrorUx(panel);
    panel.dataset.bulkImportControllerBound = "true";
  }

  bulkImportControllerInstall();
  document.addEventListener(
    "docomator:view-changed",
    bulkImportControllerInstall
  );
}
