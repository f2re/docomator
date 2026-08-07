const DOCOMATOR_DEFAULT_SPACE_ID = "00000000-0000-4000-8000-000000000001";
const DOCOMATOR_IMPORT_MAX_BYTES = 8 * 1024 * 1024;

function currentRequestSpaceId() {
  return String(
    globalThis.docomatorCurrentSpaceId ||
      localStorage.getItem("docomator.space") ||
      DOCOMATOR_DEFAULT_SPACE_ID
  ).trim();
}

function requestUrlString(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return null;
}

function relativeOrAbsoluteUrl(url, rawUrl) {
  return /^https?:/u.test(rawUrl)
    ? url.toString()
    : `${url.pathname}${url.search}${url.hash}`;
}

function rewriteSpaceScopedRequest(rawUrl) {
  const origin = globalThis.location?.origin;
  if (!origin) return rawUrl;
  const url = new URL(rawUrl, origin);
  if (url.origin !== origin) return rawUrl;
  const spaceId = currentRequestSpaceId();
  if (!spaceId) return rawUrl;

  if (
    url.pathname.startsWith("/api/v1/knowledge/property-definitions") &&
    !url.searchParams.has("spaceId")
  ) {
    url.searchParams.set("spaceId", spaceId);
    return relativeOrAbsoluteUrl(url, rawUrl);
  }

  if (
    url.pathname === "/api/v1/admin/database/properties" &&
    !url.searchParams.has("spaceId")
  ) {
    url.searchParams.set("spaceId", spaceId);
    return relativeOrAbsoluteUrl(url, rawUrl);
  }

  const propertyWrite = /^\/api\/v1\/knowledge\/entities\/([^/]+)\/properties\/([^/]+)$/u.exec(
    url.pathname
  );
  if (propertyWrite) {
    url.pathname = `/api/v1/spaces/${encodeURIComponent(spaceId)}/entities/${propertyWrite[1]}/properties/${propertyWrite[2]}`;
    return relativeOrAbsoluteUrl(url, rawUrl);
  }

  const propertyHistory = /^\/api\/v1\/knowledge\/entities\/([^/]+)\/property-values$/u.exec(
    url.pathname
  );
  if (propertyHistory) {
    url.pathname = `/api/v1/spaces/${encodeURIComponent(spaceId)}/entities/${propertyHistory[1]}/property-values`;
    return relativeOrAbsoluteUrl(url, rawUrl);
  }

  return rawUrl;
}

function importUxState() {
  globalThis.__docomatorImportUxState ??= {
    previewBySpace: new Map(),
    planBySpace: new Map(),
    planSequence: 0
  };
  return globalThis.__docomatorImportUxState;
}

function captureImportResponse(urlValue, response) {
  const origin = globalThis.location?.origin;
  if (!origin || !response?.ok) return;
  const url = new URL(urlValue, origin);
  const match = /^\/api\/v1\/spaces\/([^/]+)\/data-import\/(preview|plan)$/u.exec(
    url.pathname
  );
  if (!match) return;
  const spaceId = decodeURIComponent(match[1]);
  void response
    .clone()
    .json()
    .then((body) => {
      const data = body?.data;
      if (!data || typeof data !== "object") return;
      const state = importUxState();
      if (match[2] === "preview") {
        state.previewBySpace.set(spaceId, data);
      } else {
        state.planSequence += 1;
        state.planBySpace.set(spaceId, {
          sequence: state.planSequence,
          data
        });
      }
      queueMicrotask(enhanceEntityImportUx);
    })
    .catch(() => {});
}

function installSpaceScopedPropertyRequests() {
  if (globalThis.__docomatorSpacePropertyScopeInstalled) return;
  globalThis.__docomatorSpacePropertyScopeInstalled = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const rawUrl = requestUrlString(input);
    if (rawUrl === null) return originalFetch(input, init);
    const rewrittenUrl = rewriteSpaceScopedRequest(rawUrl);
    const nextInput =
      typeof Request !== "undefined" && input instanceof Request && rewrittenUrl !== rawUrl
        ? new Request(rewrittenUrl, input)
        : rewrittenUrl;
    return originalFetch(nextInput, init).then((response) => {
      captureImportResponse(rewrittenUrl, response);
      return response;
    });
  };
}

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
  zone.tabIndex = 0;
  zone.setAttribute("role", "button");
  zone.setAttribute("aria-label", "Перетащите Excel или CSV либо выберите файл");
  zone.insertAdjacentHTML(
    "afterbegin",
    `<div class="bulk-import-drop-copy" aria-hidden="true"><span class="bulk-import-drop-icon">⇩</span><span><strong>Перетащите Excel или CSV сюда</strong><small>или нажмите, чтобы выбрать файл</small></span></div><div class="bulk-import-drop-selected" data-entity-import-selected hidden></div>`
  );

  const openPicker = (event) => {
    if (event.target === input || event.target.closest?.("input")) return;
    input.click();
  };
  zone.addEventListener("click", openPicker);
  zone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    input.click();
  });
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

function normalizeImportText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function entityImportErrorColumn(error, preview) {
  if (typeof error?.column === "string" && error.column.trim()) {
    return error.column.trim();
  }
  const message = String(error?.message || "");
  const explicit = /колонк(?:а|е|у|ой)\s+«([^»]+)»/iu.exec(message)?.[1];
  if (explicit && preview?.headers?.includes(explicit)) return explicit;
  const rawValue = normalizeImportText(error?.rawValue);
  if (!rawValue || !Array.isArray(preview?.rows)) return "";
  const numbers = Array.isArray(preview.sourceRowNumbers)
    ? preview.sourceRowNumbers
    : preview.rows.map((_row, index) => index + 2);
  const index = numbers.findIndex((number) => Number(number) === Number(error?.rowNumber));
  const row = index >= 0 ? preview.rows[index] : null;
  if (!row) return "";
  const matches = (preview.headers || []).filter(
    (header) => normalizeImportText(row[header]) === rawValue
  );
  return matches.length === 1 ? matches[0] : "";
}

function entityImportFallbackHint(error) {
  if (typeof error?.suggestedAction === "string" && error.suggestedAction.trim()) {
    return error.suggestedAction.trim();
  }
  const text = String(error?.message || "").toLocaleLowerCase("ru-RU");
  if (/не является числом|не является целым/u.test(text)) {
    return "Если это код или номер, выберите текстовый тип. Если это число — исправьте значение в таблице.";
  }
  if (/не распознано как дата|недопустимую дату/u.test(text)) {
    return "Используйте ДД.ММ.ГГГГ или ГГГГ-ММ-ДД либо выберите текстовый тип поля.";
  }
  if (/да\/нет/u.test(text)) {
    return "Используйте да/нет, 1/0, true/false, +/− либо выберите текстовый тип.";
  }
  if (/повторяется внутри файла/u.test(text)) {
    return "Выберите действительно уникальную колонку идентификатора или исправьте повтор в исходной таблице.";
  }
  if (/не заполнена колонка/u.test(text)) {
    return "Заполните обязательную ячейку или выберите другую колонку для названия/идентификатора.";
  }
  return "Проверьте отмеченное сопоставление и исходное значение, затем снова запустите проверку.";
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
  return (
    createField?.querySelector("[data-entity-import-type]") ||
    row.querySelector("[data-entity-import-mode]") ||
    row.querySelector("input, select, textarea")
  );
}

function enhanceEntityImportErrors() {
  const root = document.querySelector("#entityImportWorkspace");
  if (!root) return;
  const spaceId = currentRequestSpaceId();
  const state = importUxState();
  const storedPlan = state.planBySpace.get(spaceId);
  if (!storedPlan || root.dataset.docomatorPlanSequence === String(storedPlan.sequence)) {
    return;
  }
  const plan = storedPlan.data;
  const errors = Array.isArray(plan?.errors) ? plan.errors : [];
  const preview = state.previewBySpace.get(spaceId);
  const planRoot = root.querySelector("#entityImportPlan");
  if (!planRoot) return;
  root.dataset.docomatorPlanSequence = String(storedPlan.sequence);
  clearEntityImportErrorUx(root);
  if (errors.length === 0) return;

  const byColumn = new Map();
  for (const error of errors) {
    const column = entityImportErrorColumn(error, preview);
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
    const column = entityImportErrorColumn(error, preview);
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

installSpaceScopedPropertyRequests();
installEntityImportUxObserver();
