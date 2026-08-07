function installSpaceScopedPropertyRequests() {
  if (globalThis.__docomatorSpacePropertyScopeInstalled) return;
  globalThis.__docomatorSpacePropertyScopeInstalled = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : null;
    if (rawUrl !== null) {
      const url = new URL(rawUrl, globalThis.location?.origin || "http://localhost");
      if (
        url.origin === globalThis.location?.origin &&
        url.pathname.startsWith("/api/v1/knowledge/property-definitions") &&
        !url.searchParams.has("spaceId")
      ) {
        const spaceId = String(globalThis.docomatorCurrentSpaceId || "").trim();
        if (spaceId) {
          url.searchParams.set("spaceId", spaceId);
          const nextUrl = /^https?:/u.test(rawUrl)
            ? url.toString()
            : `${url.pathname}${url.search}${url.hash}`;
          return originalFetch(nextUrl, init);
        }
      }
    }
    return originalFetch(input, init);
  };
}

function updateSpaceIsolationCopy() {
  if (typeof views !== "undefined" && views?.knowledge) {
    views.knowledge[0] = "Поля пространства";
    views.knowledge[1] = "Типы и поля";
    views.knowledge[2] =
      "Типы сущностей общие для системы, а пользовательские поля относятся только к выбранному пространству.";
  }
  if (typeof dialogs !== "undefined" && dialogs?.property) {
    dialogs.property.description =
      "Создайте параметр только для текущего пространства. В других пространствах он не появится.";
  }
  if (typeof help !== "undefined" && Array.isArray(help?.knowledge)) {
    help.knowledge[0] = [
      "Почему поля не видны в другом пространстве?",
      "Пользовательские поля изолированы так же, как люди, группы и шаблоны. В другом пространстве можно создать поле с тем же понятным названием — это будет отдельное поле."
    ];
  }
  if (typeof help !== "undefined" && Array.isArray(help?.employees)) {
    const fieldHelp = help.employees.find((item) => item?.[0] === "Поле появится только у одного человека?");
    if (fieldHelp) {
      fieldHelp[1] =
        "Поле станет доступно всем карточкам текущего пространства, но не появится в других пространствах.";
    }
  }
}

function resetPropertyCachesOnSpaceChange() {
  document.addEventListener("docomator:space-changed", () => {
    if (typeof state !== "undefined" && state?.data) {
      state.data.properties = [];
    }
    if (typeof bulkImportPropertyDefinitions !== "undefined") {
      bulkImportPropertyDefinitions = [];
    }
    if (typeof bulkImportPlan !== "undefined") {
      bulkImportPlan = null;
    }
  });
}

function bulkImportScopedMemoryKey() {
  const spaceId =
    typeof bulkImportCurrentSpaceId === "function"
      ? bulkImportCurrentSpaceId()
      : String(globalThis.docomatorCurrentSpaceId || "").trim();
  return `${bulkImportMemoryKey}.${spaceId || "default"}`;
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
      const parsed = JSON.parse(
        localStorage.getItem(bulkImportScopedMemoryKey()) || "{}"
      );
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
      localStorage.setItem(bulkImportScopedMemoryKey(), JSON.stringify(memory));
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
  if (!new Set(["csv", "xlsx"]).has(extension)) {
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
  if (typeof error?.column === "string" && error.column.trim()) {
    return error.column.trim();
  }
  const message = String(error?.message || "");
  const explicit = /колонк(?:а|е|у|ой)\s+«([^»]+)»/iu.exec(message)?.[1];
  if (explicit && bulkImportPreview?.headers?.includes(explicit)) return explicit;

  const rowNumbers = Array.isArray(bulkImportPreview?.sourceRowNumbers)
    ? bulkImportPreview.sourceRowNumbers
    : [];
  const rowIndex = rowNumbers.findIndex(
    (value) => Number(value) === Number(error?.rowNumber)
  );
  const row = rowIndex >= 0 ? bulkImportPreview?.rows?.[rowIndex] : null;
  if (!row) return "";
  const quotedValues = [...message.matchAll(/«([^»]+)»/gu)].map((match) =>
    normalizeBulkImportText(match[1])
  );
  for (const quoted of quotedValues) {
    if (!quoted) continue;
    const matches = (bulkImportPreview.headers || []).filter(
      (header) => normalizeBulkImportText(row[header]) === quoted
    );
    if (matches.length === 1) return matches[0];
  }
  return "";
}

function bulkImportErrorHint(message) {
  const text = String(message || "").toLocaleLowerCase("ru-RU");
  if (/не является числом|не является целым/u.test(text)) {
    return "Если в колонке находятся коды или номера, выберите тип «Короткий текст». Если это число — исправьте значение в исходной таблице.";
  }
  if (/не распознано как дата|недопустимую дату/u.test(text)) {
    return "Используйте ДД.ММ.ГГГГ или ГГГГ-ММ-ДД. Если это не дата, смените тип поля на текстовый.";
  }
  if (/да\/нет|значение «да\/нет»/u.test(text)) {
    return "Допустимы да/нет, 1/0, true/false, +/−. Иначе выберите текстовый тип.";
  }
  if (/повторяется внутри файла|несколько объектов с одинаков/u.test(text)) {
    return "Для поиска прежней записи выберите колонку с уникальным табельным номером, ID или рабочей почтой.";
  }
  if (/не заполнена колонка/u.test(text)) {
    return "Заполните эту ячейку в Excel либо выберите другую колонку для ФИО/поиска прежней записи и повторите проверку.";
  }
  if (/несколько полей|выберите конкретное поле/u.test(text)) {
    return "В сопоставлении этой колонки выберите конкретное существующее поле вместо автоматического варианта.";
  }
  if (/два или три слова|фио/u.test(text)) {
    return "Проверьте порядок ФИО или отключите разделение на фамилию, имя и отчество для неоднозначных строк.";
  }
  return "Проверьте сопоставление и тип поля. Настройки на экране сохранены; после исправления снова нажмите «Проверить».";
}

function clearBulkImportProblemHighlights() {
  document.querySelectorAll("[data-bulk-mapping-row].has-import-error").forEach((row) => {
    row.classList.remove("has-import-error");
    row.querySelector("[data-bulk-field-error-note]")?.remove();
  });
}

function highlightBulkImportProblems(errors) {
  clearBulkImportProblemHighlights();
  const grouped = new Map();
  for (const error of Array.isArray(errors) ? errors : []) {
    const column = bulkImportErrorColumn(error);
    if (!column) continue;
    const list = grouped.get(column) || [];
    list.push(error);
    grouped.set(column, list);
  }
  for (const [column, items] of grouped) {
    const row = bulkImportColumnRow(column);
    if (!row) continue;
    row.classList.add("has-import-error");
    const target = row.querySelector(".bulk-import-column-name") || row;
    const note = document.createElement("div");
    note.dataset.bulkFieldErrorNote = "";
    note.className = "bulk-import-field-error-note";
    const rowList = items
      .slice(0, 5)
      .map((item) => item.rowNumber)
      .filter(Boolean)
      .join(", ");
    note.textContent = `${items.length} ошибк${items.length === 1 ? "а" : "и"}${rowList ? ` · строки ${rowList}` : ""}`;
    target.append(note);
  }
}

function renderFriendlyBulkImportErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return "";
  const uniqueColumns = new Set(
    errors.map((error) => bulkImportErrorColumn(error)).filter(Boolean)
  );
  const cards = errors.slice(0, 100).map((error) => {
    const column = bulkImportErrorColumn(error);
    const title = column
      ? `Строка ${error.rowNumber} · ${column}`
      : `Строка ${error.rowNumber}`;
    const action = column
      ? `<button class="secondary-button compact" type="button" data-bulk-fix-column="${escapeHtml(column)}">Проверить поле</button>`
      : "";
    return `<article class="bulk-import-error-card"${column ? ` data-error-column="${escapeHtml(column)}"` : ""}>
      <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(error.message)}</p><small>${escapeHtml(bulkImportErrorHint(error.message))}</small></div>
      ${action}
    </article>`;
  });
  const omitted = errors.length > 100
    ? `<p class="bulk-import-error-overflow">Показаны первые 100 из ${errors.length} ошибок.</p>`
    : "";
  return `<section class="bulk-import-error-guide" role="alert">
      <div><strong>Нужно исправить ${errors.length} строк${uniqueColumns.size ? ` в ${uniqueColumns.size} полях` : ""}</strong><p>Ничего не сохранено во время проверки. Перейдите к отмеченному полю, исправьте сопоставление/тип или исходную таблицу и запустите проверку ещё раз.</p></div>
    </section>
    <div class="bulk-import-error-list">${cards.join("")}</div>${omitted}`;
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
    hint.innerHTML =
      "<strong>Что сделать</strong><span>Проверьте формат CSV/XLSX, строку заголовков и размер файла. Ваши настройки не сброшены; после исправления выберите файл повторно.</span>";
    message.insertAdjacentElement("afterend", hint);
  };
  new MutationObserver(render).observe(message, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true
  });
}

installSpaceScopedPropertyRequests();
updateSpaceIsolationCopy();
resetPropertyCachesOnSpaceChange();

if (typeof bulkImportCurrentSpaceId === "function") {
  installBulkImportScopedMemory();
  installBulkImportDropZone();
  installBulkImportErrorUx();
  installBulkImportRecoveryHint();
}
