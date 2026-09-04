function bulkImportScopedMemoryKey() {
  const spaceId =
    typeof bulkImportCurrentSpaceId === "function"
      ? bulkImportCurrentSpaceId()
      : String(globalThis.docomatorCurrentSpaceId || "").trim();
  return spaceId ? `${bulkImportMemoryKey}.${spaceId}` : "";
}

function installBulkImportScopedMemory() {
  if (
    typeof readBulkImportMappingMemory !== "function" ||
    typeof writeBulkImportMappingMemory !== "function" ||
    typeof bulkImportMemoryKey === "undefined"
  ) {
    return;
  }
  readBulkImportMappingMemory = function readScopedBulkImportMappingMemory() {
    try {
      const memoryKey = bulkImportScopedMemoryKey();
      if (!memoryKey) return {};
      const parsed = JSON.parse(localStorage.getItem(memoryKey) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  };
  writeBulkImportMappingMemory = function writeScopedBulkImportMappingMemory(resolutions) {
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
      const memoryKey = bulkImportScopedMemoryKey();
      if (memoryKey) localStorage.setItem(memoryKey, JSON.stringify(memory));
    } catch {
      // Необязательная локальная подсказка не должна блокировать импорт.
    }
  };
}

function bulkImportShowFileMessage(text, kind = "warning") {
  const message = document.querySelector("#bulkImportMessage");
  if (!message) return;
  message.className = `bulk-import-message is-${kind}`;
  message.textContent = text;
}

function bulkImportValidateDroppedFile(file) {
  if (!(file instanceof File)) return "Не удалось получить файл из операции перетаскивания.";
  const extension = file.name.toLocaleLowerCase("ru-RU").split(".").pop() || "";
  if (!new Set(["csv", "xlsx", "xls"]).has(extension)) {
    return "Поддерживаются только файлы CSV и XLSX. Выбранный файл не отправлен.";
  }
  if (file.size === 0) return "Файл пуст. Выберите таблицу с заголовками и данными.";
  if (file.size > 8 * 1024 * 1024) {
    return "Файл больше 8 МБ. Уменьшите таблицу или разделите её на несколько импортов.";
  }
  return "";
}

function installBulkImportDropZone() {
  const source = document.querySelector("#bulkImportFileSource");
  const input = source?.querySelector("#bulkImportFile");
  const label = input?.closest("label");
  if (!source || !(input instanceof HTMLInputElement) || !label) return;
  if (label.dataset.bulkDropReady === "true") return;
  label.dataset.bulkDropReady = "true";
  label.classList.add("bulk-import-drop-zone");
  label.tabIndex = 0;
  label.insertAdjacentHTML(
    "afterbegin",
    '<div class="bulk-import-drop-copy"><span class="bulk-import-drop-icon" aria-hidden="true">⇩</span><span><strong>Перетащите Excel или CSV сюда</strong><small>или нажмите на область, чтобы выбрать файл</small></span></div>'
  );
  const selected = document.createElement("div");
  selected.className = "bulk-import-drop-selected";
  selected.hidden = true;
  label.append(selected);

  const reflectFile = (file) => {
    label.classList.remove("is-error");
    selected.hidden = !file;
    selected.textContent = file
      ? `Выбран: ${file.name} · ${Math.max(1, Math.ceil(file.size / 1024))} КБ`
      : "";
  };

  const acceptFiles = (files) => {
    if (!files || files.length === 0) return;
    if (files.length !== 1) {
      label.classList.add("is-error");
      bulkImportShowFileMessage(
        "Перетащите один файл за раз. Несколько файлов не были отправлены.",
        "error"
      );
      return;
    }
    const file = files[0];
    const problem = bulkImportValidateDroppedFile(file);
    if (problem) {
      label.classList.add("is-error");
      reflectFile(null);
      bulkImportShowFileMessage(problem, "error");
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    reflectFile(file);
    bulkImportShowFileMessage(
      "Файл выбран. Нажмите «Прочитать файл», чтобы проверить структуру и поля.",
      "success"
    );
  };

  for (const eventName of ["dragenter", "dragover"]) {
    label.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      label.classList.add("is-dragover");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
  }
  for (const eventName of ["dragleave", "dragend"]) {
    label.addEventListener(eventName, (event) => {
      event.preventDefault();
      label.classList.remove("is-dragover");
    });
  }
  label.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    label.classList.remove("is-dragover");
    acceptFiles(event.dataTransfer?.files);
  });
  label.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    input.click();
  });
  input.addEventListener("change", () => {
    const file = input.files?.[0] || null;
    if (!file) {
      reflectFile(null);
      return;
    }
    const problem = bulkImportValidateDroppedFile(file);
    if (problem) {
      input.value = "";
      label.classList.add("is-error");
      reflectFile(null);
      bulkImportShowFileMessage(problem, "error");
      return;
    }
    reflectFile(file);
  });
}

function bulkImportErrorColumn(error) {
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
    if (!Array.isArray(bulkImportPreview?.headers) || bulkImportPreview.headers.includes(column)) {
      return column;
    }
  }
  return "";
}

function bulkImportErrorHint(error) {
  const action = error?.suggestedAction ?? error?.issue?.suggestedAction;
  return typeof action === "string" && action.trim()
    ? action.trim()
    : "Проверьте отмеченное место. Выбранный файл и остальные настройки сохранены; после исправления снова нажмите «Проверить».";
}

function bulkImportErrorRawValue(error) {
  const value = error?.rawValue ?? error?.issue?.rawValue;
  return typeof value === "string" ? value : null;
}

function bulkImportErrorRowNumber(error) {
  const value = Number(error?.rowNumber ?? error?.sourceRow ?? error?.issue?.rowNumber);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function clearBulkImportProblemHighlights() {
  document.querySelectorAll("[data-bulk-mapping-row].has-import-error").forEach((row) => {
    row.classList.remove("has-import-error");
    row.querySelector("[data-bulk-field-error-note]")?.remove();
    row.querySelectorAll('[aria-invalid="true"]').forEach((control) => {
      control.removeAttribute("aria-invalid");
      control.removeAttribute("aria-describedby");
    });
  });
  document.querySelectorAll(".bulk-import-table .has-import-error-row").forEach((row) => {
    row.classList.remove("has-import-error-row");
  });
  document.querySelectorAll(".bulk-import-table .has-import-error-cell").forEach((cell) => {
    cell.classList.remove("has-import-error-cell");
  });
}

function bulkImportSourceCell(rowNumber, column) {
  if (!rowNumber || !column) return null;
  const row = [...document.querySelectorAll(".bulk-import-table tbody tr[data-source-row-number]")]
    .find((candidate) => Number(candidate.dataset.sourceRowNumber) === Number(rowNumber));
  if (!row) return null;
  return [...row.querySelectorAll("[data-source-column]")]
    .find((cell) => cell.dataset.sourceColumn === column) || null;
}

function highlightBulkImportProblems(errors) {
  clearBulkImportProblemHighlights();
  const grouped = new Map();
  let highlightedSource = false;
  for (const error of Array.isArray(errors) ? errors : []) {
    const column = bulkImportErrorColumn(error);
    const rowNumber = bulkImportErrorRowNumber(error);
    if (column) {
      const list = grouped.get(column) || [];
      list.push(error);
      grouped.set(column, list);
    }
    const cell = bulkImportSourceCell(rowNumber, column);
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
    const row = bulkImportColumnRow(column);
    if (!row) continue;
    row.classList.add("has-import-error");
    const target = row.querySelector(".bulk-import-column-name") || row;
    const note = document.createElement("div");
    note.dataset.bulkFieldErrorNote = "";
    note.className = "bulk-import-field-error-note";
    note.id = `bulkImportFieldError${index++}`;
    const rowList = items
      .slice(0, 5)
      .map((item) => bulkImportErrorRowNumber(item))
      .filter(Boolean)
      .join(", ");
    note.textContent = `${items.length} ошибк${items.length === 1 ? "а" : "и"}${rowList ? ` · строки ${rowList}` : ""}`;
    target.append(note);
    const wantsType = items.some(
      (item) => (item?.repair?.kind ?? item?.issue?.repair?.kind) === "change_field_type"
    );
    const mode = row.querySelector("[data-bulk-mapping-mode]")?.value || "";
    const control = wantsType && mode === "create"
      ? row.querySelector("[data-bulk-value-type]")
      : row.querySelector("[data-bulk-mapping-mode]");
    if (control) {
      control.setAttribute("aria-invalid", "true");
      control.setAttribute("aria-describedby", note.id);
    }
  }
}

function renderFriendlyBulkImportErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return "";
  const uniqueColumns = new Set(
    errors.map((error) => bulkImportErrorColumn(error)).filter(Boolean)
  );
  const cards = errors.slice(0, 100).map((error) => {
    const column = bulkImportErrorColumn(error);
    const rowNumber = bulkImportErrorRowNumber(error);
    const rawValue = bulkImportErrorRawValue(error);
    const title = [rowNumber ? `Строка ${rowNumber}` : "Ошибка импорта", column]
      .filter(Boolean)
      .join(" · ");
    const action = column
      ? `<button class="secondary-button compact" type="button" data-bulk-fix-column="${escapeHtml(column)}"${rowNumber ? ` data-bulk-fix-row="${rowNumber}"` : ""}>Показать место</button>`
      : "";
    const raw = rawValue === null
      ? ""
      : `<small class="bulk-import-error-value"><strong>Значение:</strong> «${escapeHtml(rawValue)}»</small>`;
    return `<article class="bulk-import-error-card"${column ? ` data-error-column="${escapeHtml(column)}"` : ""}>
      <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(error?.message || "Импорт требует проверки.")}</p>${raw}<small><strong>Что сделать:</strong> ${escapeHtml(bulkImportErrorHint(error))}</small></div>
      ${action}
    </article>`;
  });
  const omitted = errors.length > 100
    ? `<p class="bulk-import-error-overflow">Показаны первые 100 из ${errors.length} ошибок.</p>`
    : "";
  return `<section class="bulk-import-error-guide" role="alert">
      <div><strong>Нужно проверить ${errors.length} строк${uniqueColumns.size ? ` в ${uniqueColumns.size} полях` : ""}</strong><p>Корректные строки не блокируются и могут быть импортированы. Ошибочные строки будут пропущены; файл и сопоставления остаются на экране.</p></div>
    </section>
    <div class="bulk-import-error-list">${cards.join("")}</div>${omitted}`;
}

let bulkImportLastOperationIssue = null;

function showBulkImportOperationIssue(error) {
  const issue = error?.issue && typeof error.issue === "object" ? error.issue : null;
  bulkImportLastOperationIssue = issue;
  if (!issue) return;
  if (issue.scope === "file") {
    document.querySelector("#bulkImportFile")
      ?.closest(".bulk-import-drop-zone")
      ?.classList.add("is-error");
    return;
  }
  if (issue.scope !== "mapping") return;
  highlightBulkImportProblems([issue]);
  const root = document.querySelector("#bulkImportPlan");
  if (root) {
    root.innerHTML = renderFriendlyBulkImportErrors([issue]);
  }
  setBulkImportStep(2);
  const column = bulkImportErrorColumn(issue);
  const row = column ? bulkImportColumnRow(column) : null;
  if (row) {
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    const control = row.querySelector('[aria-invalid="true"]') || row.querySelector("[data-bulk-mapping-mode]");
    control?.focus();
  }
}

function installBulkImportErrorUx() {
  if (typeof renderBulkImportErrors !== "function") return;
  renderBulkImportErrors = renderFriendlyBulkImportErrors;

  if (typeof renderBulkImportPlan === "function") {
    const baseRenderPlan = renderBulkImportPlan;
    renderBulkImportPlan = function renderBulkImportPlanWithGuidance(plan) {
      baseRenderPlan(plan);
      highlightBulkImportProblems(plan?.errors);
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
  }

  if (typeof renderBulkImportResult === "function") {
    const baseRenderResult = renderBulkImportResult;
    renderBulkImportResult = function renderBulkImportResultWithGuidance(result) {
      baseRenderResult(result);
      highlightBulkImportProblems(result?.errors);
    };
  }

  const panel = document.querySelector("#bulkDataImportPanel");
  panel?.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-bulk-fix-column]");
    if (!button) return;
    const column = button.dataset.bulkFixColumn || "";
    const sourceRow = Number(button.dataset.bulkFixRow || 0);
    const sourceCell = bulkImportSourceCell(sourceRow, column);
    if (sourceCell) {
      const details = sourceCell.closest("details");
      if (details instanceof HTMLDetailsElement) details.open = true;
      sourceCell.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
    const row = bulkImportColumnRow(column);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    const mode = row.querySelector("[data-bulk-mapping-mode]")?.value || "";
    const target = mode === "create"
      ? row.querySelector("[data-bulk-value-type]")
      : row.querySelector("[data-bulk-mapping-mode]");
    target?.focus();
  });
  panel?.addEventListener("input", (event) => {
    const row = event.target.closest?.("[data-bulk-mapping-row]");
    if (!row) return;
    row.classList.remove("has-import-error");
    row.querySelector("[data-bulk-field-error-note]")?.remove();
  });
  panel?.addEventListener("change", (event) => {
    const row = event.target.closest?.("[data-bulk-mapping-row]");
    if (!row) return;
    row.classList.remove("has-import-error");
    row.querySelector("[data-bulk-field-error-note]")?.remove();
  });
}

function installBulkImportRecoveryHint() {
  const message = document.querySelector("#bulkImportMessage");
  if (!message) return;
  const render = () => {
    document.querySelector("#bulkImportRecoveryHint")?.remove();
    if (!message.classList.contains("is-error")) return;
    const hint = document.createElement("div");
    hint.id = "bulkImportRecoveryHint";
    hint.className = "bulk-import-recovery-hint";
    const action = bulkImportLastOperationIssue?.suggestedAction ||
      "Проверьте формат CSV/XLSX, строку заголовков и размер файла. Ваши настройки не сброшены; после исправления повторите чтение.";
    hint.innerHTML = `<strong>Что сделать</strong><span>${escapeHtml(action)}</span>`;
    message.insertAdjacentElement("afterend", hint);
  };
  new MutationObserver(render).observe(message, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true
  });
}

if (typeof bulkImportCurrentSpaceId === "function") {
  installBulkImportScopedMemory();
  installBulkImportDropZone();
  installBulkImportErrorUx();
  installBulkImportRecoveryHint();
}
