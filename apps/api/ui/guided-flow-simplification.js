{
  const guidedFlowAutoDelayMs = 900;
  const guidedFlowTimers = new WeakMap();

  function guidedFlowClear(button) {
    const timer = guidedFlowTimers.get(button);
    if (timer !== undefined) {
      clearTimeout(timer);
      guidedFlowTimers.delete(button);
    }
  }

  function guidedFlowSecondaryAction(button, label, idleLabels) {
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.disabled || button.hidden) return;
    const currentLabel = String(button.textContent || "").trim();
    if (!idleLabels.includes(currentLabel) && currentLabel !== label) return;
    if (button.classList.contains("primary-button")) {
      button.classList.remove("primary-button");
      button.classList.add("secondary-button");
    }
    if (currentLabel !== label) button.textContent = label;
  }

  function guidedFlowSchedule(button, beforeStart) {
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.disabled || button.hidden || !button.isConnected) return;
    if (guidedFlowTimers.has(button)) return;
    beforeStart?.();
    const timer = setTimeout(() => {
      guidedFlowTimers.delete(button);
      if (!button.isConnected || button.disabled || button.hidden) return;
      button.click();
    }, guidedFlowAutoDelayMs);
    guidedFlowTimers.set(button, timer);
  }

  function guidedFlowImportIdentityStats(preview, column) {
    const rows = Array.isArray(preview?.rows) ? preview.rows : [];
    const counts = new Map();
    const displayValues = new Map();
    let blankCount = 0;
    for (const row of rows) {
      const rawValue = String(row?.[column] ?? "").normalize("NFKC").trim();
      const value = normalizeBulkImportText(rawValue);
      if (!value) {
        blankCount += 1;
        continue;
      }
      counts.set(value, (counts.get(value) || 0) + 1);
      if (!displayValues.has(value)) displayValues.set(value, rawValue);
    }
    const duplicateSamples = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .slice(0, 3)
      .map(([value, count]) => ({
        value: displayValues.get(value) || value,
        count
      }));
    const duplicateRowCount = [...counts.values()]
      .filter((count) => count > 1)
      .reduce((sum, count) => sum + count, 0);
    return {
      rowCount: rows.length,
      blankCount,
      duplicateRowCount,
      duplicateSamples,
      valid: rows.length > 0 && blankCount === 0 && duplicateRowCount === 0
    };
  }

  function guidedFlowIdentityPriority(header) {
    const semantic = bulkImportSemanticKey(header);
    if (semantic === "personnel_number") return 100;
    if (semantic === "student_number") return 95;
    if (semantic === "email") return 85;
    if (semantic === "phone") return 70;
    const normalized = normalizeBulkImportText(header);
    if (/^(?:id|идентификатор|код сотрудника|код работника)$/u.test(normalized)) {
      return 90;
    }
    if (/номер (?:сотрудника|работника|персоны|человека)/u.test(normalized)) {
      return 88;
    }
    return 0;
  }

  if (typeof bulkImportIdentityGuess === "function") {
    bulkImportIdentityGuess = function guidedBulkImportIdentityGuess(
      preview,
      displayNameColumn
    ) {
      const candidates = (Array.isArray(preview?.headers) ? preview.headers : [])
        .map((header, index) => ({
          header,
          index,
          priority: guidedFlowIdentityPriority(header),
          stats: guidedFlowImportIdentityStats(preview, header)
        }))
        .filter((candidate) => candidate.priority > 0)
        .sort((left, right) => {
          if (left.stats.valid !== right.stats.valid) {
            return left.stats.valid ? -1 : 1;
          }
          return right.priority - left.priority || left.index - right.index;
        });
      return candidates[0]?.header || displayNameColumn || preview?.headers?.[0] || "";
    };
  }

  function guidedFlowDecorateImportPreview(preview) {
    const root = document.querySelector("#bulkImportPreview");
    const identity = document.querySelector("#bulkImportIdentityColumn");
    if (!root || !(identity instanceof HTMLSelectElement)) return;

    const summary = root.querySelector(".bulk-import-file-summary");
    if (
      summary &&
      preview?.fileName === "Вставленная таблица.csv" &&
      !root.querySelector("[data-bulk-paste-source-note]")
    ) {
      const note = document.createElement("div");
      note.className = "bulk-import-notice is-ready";
      note.dataset.bulkPasteSourceNote = "";
      note.innerHTML =
        "<strong>Источник — буфер обмена</strong><p>Отдельный файл не нужен. После проверки будут импортированы именно строки, вставленные из Excel или LibreOffice. При ошибке вставленный текст и сопоставления останутся на экране.</p>";
      summary.insertAdjacentElement("afterend", note);
    }

    const renderIdentityState = () => {
      let hint = root.querySelector("#bulkImportIdentityQuality");
      if (!hint) {
        hint = document.createElement("small");
        hint.id = "bulkImportIdentityQuality";
        identity.closest("label")?.append(hint);
      }
      const stats = guidedFlowImportIdentityStats(preview, identity.value);
      identity.setAttribute("aria-describedby", hint.id);
      if (stats.valid) {
        identity.removeAttribute("aria-invalid");
        hint.textContent = `Подходит для повторного импорта: все значения заполнены и уникальны (${stats.rowCount}).`;
        return;
      }
      identity.setAttribute("aria-invalid", "true");
      const problems = [];
      if (stats.blankCount > 0) problems.push(`пустых значений: ${stats.blankCount}`);
      if (stats.duplicateRowCount > 0) {
        problems.push(`строк с повторяющимся значением: ${stats.duplicateRowCount}`);
      }
      const duplicateValues = stats.duplicateSamples
        .map((item) => `«${item.value}» — ${item.count} строки`)
        .join(", ");
      hint.textContent = `Эта колонка не подходит как устойчивый идентификатор (${problems.join(", ") || "нет уникальных значений"})${duplicateValues ? `. Повторяются: ${duplicateValues}.` : "."} Выберите колонку с уникальными значениями. Вставленные данные и сопоставления не будут потеряны.`;
    };

    renderIdentityState();
    identity.addEventListener("change", renderIdentityState);
  }

  if (typeof renderBulkImportPreview === "function") {
    const baseRenderBulkImportPreview = renderBulkImportPreview;
    renderBulkImportPreview = function renderBulkImportPreviewWithReliableIdentity(
      preview
    ) {
      baseRenderBulkImportPreview(preview);
      guidedFlowDecorateImportPreview(preview);
    };
  }

  if (typeof bulkImportApi === "function") {
    const baseBulkImportApi = bulkImportApi;
    bulkImportApi = async function bulkImportApiWithExecuteRecovery(url, options = {}) {
      try {
        return await baseBulkImportApi(url, options);
      } catch (error) {
        if (
          String(url).includes("/data-import/execute") &&
          typeof showBulkImportOperationIssue === "function"
        ) {
          showBulkImportOperationIssue(error);
        }
        throw error;
      }
    };
  }

  function guidedFlowInstallBulkImportIdentityGuard() {
    const panel = document.querySelector("#bulkDataImportPanel");
    if (!panel || panel.dataset.guidedIdentityGuard === "true") return;
    panel.dataset.guidedIdentityGuard = "true";
    panel.addEventListener(
      "click",
      (event) => {
        const planButton = event.target.closest?.("#bulkImportPlanButton");
        if (!planButton || !bulkImportPreview) return;
        const identity = document.querySelector("#bulkImportIdentityColumn");
        if (!(identity instanceof HTMLSelectElement)) return;
        const stats = guidedFlowImportIdentityStats(bulkImportPreview, identity.value);
        if (stats.valid) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const message = document.querySelector("#bulkImportMessage");
        const duplicateValues = stats.duplicateSamples
          .map((item) => `«${item.value}» — ${item.count} строки`)
          .join(", ");
        const details = [
          stats.blankCount > 0 ? `пустых значений: ${stats.blankCount}` : "",
          stats.duplicateRowCount > 0
            ? `строк с повторяющимся значением: ${stats.duplicateRowCount}`
            : "",
          duplicateValues ? `повторяются ${duplicateValues}` : ""
        ].filter(Boolean).join("; ");
        if (message) {
          message.className = "bulk-import-message is-error";
          message.textContent = `Проверка не запущена: колонка «${identity.value}» не подходит как устойчивый идентификатор (${details || "значения не уникальны"}). Ничего не импортировано. Выберите колонку с уникальными значениями; вставленные данные и сопоставления сохранены.`;
        }
        identity.setAttribute("aria-invalid", "true");
        identity.focus();
      },
      { capture: true }
    );
  }

  function guidedFlowInstallDocumentIntake() {
    const input = document.querySelector("#documentIntakeFile");
    const button = document.querySelector("#documentIntakeButton");
    const dropZone = document.querySelector("#documentIntakeDropZone");
    if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) return;

    guidedFlowSecondaryAction(button, "Проверить сейчас", ["Проверить файл"]);
    if (button.dataset.guidedAutoBound === "true") return;
    button.dataset.guidedAutoBound = "true";

    const schedule = () => {
      if (button.disabled || button.hidden) return;
      guidedFlowSchedule(button, () => {
        const detail = document.querySelector("#documentIntakeStatusDetail");
        if (detail) {
          detail.textContent =
            "Проверка начнётся автоматически. Ничего нажимать не нужно; исходный файл не изменяется.";
        }
      });
    };

    input.addEventListener("change", () => setTimeout(schedule, 0));
    dropZone?.addEventListener("drop", () => setTimeout(schedule, 0));
    button.addEventListener("click", () => guidedFlowClear(button), { capture: true });
  }

  function guidedFlowInstallBulkImport() {
    const input = document.querySelector("#bulkImportFile");
    const button = document.querySelector("#bulkImportPreviewButton");
    if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) return;

    guidedFlowSecondaryAction(button, "Прочитать сейчас", ["Прочитать файл", "Продолжить"]);
    if (button.dataset.guidedAutoBound === "true") return;
    button.dataset.guidedAutoBound = "true";

    const schedule = () => {
      if (!input.files?.[0] || button.disabled || button.hidden) return;
      guidedFlowSchedule(button, () => {
        const message = document.querySelector("#bulkImportMessage");
        if (message) {
          message.className = "bulk-import-message is-loading";
          message.textContent =
            "Файл выбран. Читаем колонки автоматически; до подтверждения импорта данные не сохраняются.";
        }
      });
    };

    input.addEventListener("change", () => setTimeout(schedule, 0));
    const dropTarget = input.closest("label");
    dropTarget?.addEventListener("drop", () => setTimeout(schedule, 0));
    button.addEventListener("click", () => guidedFlowClear(button), { capture: true });
  }

  function guidedFlowInstallTemplateStructure() {
    const button = document.querySelector("#documentStructureButton");
    const currentStep = document.querySelector(
      '[data-template-step="2"][data-wizard-state="current"]'
    );
    if (!(button instanceof HTMLButtonElement)) return;

    if (!currentStep) {
      delete button.dataset.guidedAutoAttempted;
      guidedFlowClear(button);
      return;
    }

    guidedFlowSecondaryAction(button, "Построить сейчас", ["Построить структуру"]);
    if (button.dataset.guidedAutoBound !== "true") {
      button.dataset.guidedAutoBound = "true";
      button.addEventListener(
        "click",
        () => {
          button.dataset.guidedAutoAttempted = "true";
          guidedFlowClear(button);
        },
        { capture: true }
      );
    }
    if (button.dataset.guidedAutoAttempted === "true") return;
    if (document.querySelector("#documentStructureResult .structure-element")) return;

    guidedFlowSchedule(button, () => {
      button.dataset.guidedAutoAttempted = "true";
      const status = document.querySelector("#templateWizardStatus");
      if (status) {
        status.textContent =
          "Строим структуру автоматически. Затем выберите места, куда нужно подставлять данные.";
      }
    });
  }

  function guidedFlowSync() {
    guidedFlowInstallDocumentIntake();
    guidedFlowInstallBulkImport();
    guidedFlowInstallBulkImportIdentityGuard();
    guidedFlowInstallTemplateStructure();
  }

  document.addEventListener("docomator:template-wizard-step-completed", (event) => {
    if (Number(event?.detail?.step) === 1) setTimeout(guidedFlowSync, 0);
  });

  new MutationObserver(guidedFlowSync).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-wizard-state", "hidden", "disabled"]
  });
  guidedFlowSync();
}
