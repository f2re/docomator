const DOCOMATOR_IMPORT_MAX_BYTES = 8 * 1024 * 1024;

function currentRequestSpaceId() {
  return String(globalThis.docomatorCurrentSpaceId || "").trim();
}

function importUxState() {
  globalThis.__docomatorImportUxState ??= {
    planBySpace: new Map(),
    planSequence: 0
  };
  return globalThis.__docomatorImportUxState;
}

function rememberEntityImportPlan(spaceId, plan) {
  if (!spaceId || !plan || typeof plan !== "object") return;
  const state = importUxState();
  state.planSequence += 1;
  state.planBySpace.set(spaceId, {
    sequence: state.planSequence,
    data: plan
  });
  queueMicrotask(enhanceEntityImportUx);
}

globalThis.docomatorRememberEntityImportPlan = rememberEntityImportPlan;

function validEntityImportFile(file) {
  if (!(file instanceof File)) return "Выберите CSV или XLSX.";
  if (file.size < 1) return "Файл пустой. Выберите таблицу с данными.";
  if (file.size > DOCOMATOR_IMPORT_MAX_BYTES) {
    return "Файл больше 8 МБ. Разделите таблицу на несколько файлов.";
  }
  if (!/\.(?:csv|xlsx)$/iu.test(file.name)) {
    return "Поддерживаются только файлы CSV и XLSX.";
  }
  return "";
}

function reflectEntityImportFile(input, zone, file) {
  const selected = zone.querySelector("[data-entity-import-selected]");
  const message = document.querySelector("#entityImportMessage");
  const problem = file ? validEntityImportFile(file) : "";
  zone.classList.toggle("is-error", Boolean(problem));
  if (selected) {
    selected.hidden = !file || Boolean(problem);
    selected.textContent = file && !problem ? `Выбран файл: ${file.name}` : "";
  }
  if (problem) {
    input.value = "";
    if (message) {
      message.className = "bulk-import-message is-error";
      message.textContent = problem;
    }
  } else if (file && message) {
    message.className = "bulk-import-message is-success";
    message.textContent = `Файл выбран: ${file.name}. Нажмите «Прочитать файл».`;
  }
}

function enhanceEntityImportDropZone() {
  const input = document.querySelector("#entityImportFile");
  const zone = input?.closest(".field");
  if (!input || !zone || zone.dataset.entityImportDropInstalled === "true") return;
  zone.dataset.entityImportDropInstalled = "true";
  zone.classList.add("bulk-import-drop-zone");
  zone.insertAdjacentHTML(
    "afterbegin",
    `<div class="bulk-import-drop-copy" aria-hidden="true"><span class="bulk-import-drop-icon">⇩</span><span><strong>Перетащите Excel или CSV сюда</strong><small>или нажмите, чтобы выбрать файл</small></span></div><div class="bulk-import-drop-selected" data-entity-import-selected hidden></div>`
  );

  const openPicker = (event) => {
    if (event.target === input || event.target.closest?.("input")) return;
    input.click();
  };
  zone.addEventListener("click", openPicker);
  for (const eventName of ["dragenter", "dragover"]) {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragover");
    });
  }
  for (const eventName of ["dragleave", "dragend"]) {
    zone.addEventListener(eventName, () => zone.classList.remove("is-dragover"));
  }
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("is-dragover");
    const files = event.dataTransfer?.files;
    if (!files || files.length !== 1) {
      const message = document.querySelector("#entityImportMessage");
      zone.classList.add("is-error");
      if (message) {
        message.className = "bulk-import-message is-error";
        message.textContent = "Перетащите один CSV или XLSX за раз.";
      }
      return;
    }
    const file = files[0];
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    reflectEntityImportFile(input, zone, file);
  });
  input.addEventListener("change", () => {
    reflectEntityImportFile(input, zone, input.files?.[0] ?? null);
  });
}

function entityImportErrorColumn(error) {
  return typeof error?.column === "string" ? error.column.trim() : "";
}

function entityImportFallbackHint(error) {
  if (typeof error?.suggestedAction === "string" && error.suggestedAction.trim()) {
    return error.suggestedAction.trim();
  }
  return "Проверьте исходную строку и сопоставление полей, затем снова запустите проверку.";
}

function clearEntityImportErrorUx(root) {
  root.querySelectorAll("[data-entity-import-mapping].has-import-error").forEach((row) => {
    row.classList.remove("has-import-error");
    row.querySelector("[data-bulk-field-error-note]")?.remove();
  });
  root.querySelector("[data-entity-import-error-guide]")?.remove();
}

function visibleEntityImportCorrectionControl(row) {
  if (!row) return null;
  const createField = [...row.querySelectorAll("[data-entity-import-create]")].find(
    (field) => !field.hidden && field.querySelector("[data-entity-import-type]")
  );
  const createType = createField?.querySelector("[data-entity-import-type]");
  if (createType) return createType;

  const mode = row.querySelector("[data-entity-import-mode]");
  const searchable =
    mode?.nextElementSibling?.classList?.contains("searchable-select")
      ? mode.nextElementSibling
      : mode?.parentElement?.querySelector(".searchable-select");
  const searchableControl = searchable?.querySelector(".searchable-select-control");
  if (searchableControl) return searchableControl;

  return (
    mode ||
    row.querySelector(
      'input:not([hidden]), button:not([hidden]), select:not([hidden]), textarea:not([hidden])'
    )
  );
}

function enhanceEntityImportErrors() {
  const root = document.querySelector("#entityImportWorkspace");
  if (!root) return;
  const spaceId = currentRequestSpaceId();
  if (!spaceId) return;
  const state = importUxState();
  const storedPlan = state.planBySpace.get(spaceId);
  if (!storedPlan || root.dataset.docomatorPlanSequence === String(storedPlan.sequence)) {
    return;
  }
  const plan = storedPlan.data;
  const errors = Array.isArray(plan?.errors) ? plan.errors : [];
  const planRoot = root.querySelector("#entityImportPlan");
  if (!planRoot) return;
  root.dataset.docomatorPlanSequence = String(storedPlan.sequence);
  clearEntityImportErrorUx(root);
  if (errors.length === 0) return;

  const byColumn = new Map();
  for (const error of errors) {
    const column = entityImportErrorColumn(error);
    if (!column) continue;
    const items = byColumn.get(column) || [];
    items.push(error);
    byColumn.set(column, items);
  }
  for (const [column, items] of byColumn) {
    const row = [...root.querySelectorAll("[data-entity-import-mapping]")].find(
      (candidate) => candidate.dataset.column === column
    );
    if (!row) continue;
    row.classList.add("has-import-error");
    const note = document.createElement("span");
    note.dataset.bulkFieldErrorNote = "";
    note.className = "bulk-import-field-error-note";
    note.textContent = `${items.length} ошибк${items.length === 1 ? "а" : "и"} · строки ${items
      .slice(0, 5)
      .map((item) => item.rowNumber)
      .join(", ")}`;
    row.querySelector(".bulk-import-column-name")?.append(note);
  }

  const oldList = planRoot.querySelector(".generation-error-list");
  const list = document.createElement("div");
  list.className = "bulk-import-error-list";
  errors.slice(0, 100).forEach((error) => {
    const column = entityImportErrorColumn(error);
    const card = document.createElement("article");
    card.className = "bulk-import-error-card";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = column
      ? `Строка ${error.rowNumber} · ${column}`
      : `Строка ${error.rowNumber}`;
    const message = document.createElement("p");
    message.textContent = String(error.message || "Строку импортировать не удалось.");
    const hint = document.createElement("small");
    hint.textContent = entityImportFallbackHint(error);
    copy.append(title, message, hint);
    card.append(copy);
    if (column) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-button compact";
      button.textContent = "Проверить поле";
      button.addEventListener("click", () => {
        const row = [...root.querySelectorAll("[data-entity-import-mapping]")].find(
          (candidate) => candidate.dataset.column === column
        );
        row?.scrollIntoView({ behavior: "smooth", block: "center" });
        visibleEntityImportCorrectionControl(row)?.focus();
      });
      card.append(button);
    }
    list.append(card);
  });
  oldList?.replaceWith(list);

  const guide = document.createElement("section");
  guide.dataset.entityImportErrorGuide = "";
  guide.className = "bulk-import-error-guide";
  const title = document.createElement("strong");
  title.textContent = `Нужно исправить ${errors.length} строк${byColumn.size ? ` в ${byColumn.size} полях` : ""}`;
  const detail = document.createElement("p");
  detail.textContent =
    "Проверка ничего не сохранила. Исправьте отмеченное сопоставление или исходную таблицу и запустите проверку снова.";
  guide.append(title, detail);
  planRoot.prepend(guide);
}

function enhanceEntityImportUx() {
  enhanceEntityImportDropZone();
  enhanceEntityImportErrors();
}

function installEntityImportUxObserver() {
  if (globalThis.__docomatorEntityImportUxInstalled) return;
  globalThis.__docomatorEntityImportUxInstalled = true;
  const observer = new MutationObserver(() => queueMicrotask(enhanceEntityImportUx));
  const start = () => {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true });
    enhanceEntityImportUx();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
  document.addEventListener("docomator:space-changed", () => {
    queueMicrotask(enhanceEntityImportUx);
  });
}

installEntityImportUxObserver();
