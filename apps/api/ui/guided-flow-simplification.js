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
    if (button.hidden) return;
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

  function guidedFlowInstallVersion() {
    const target = document.querySelector(".brand small");
    if (!(target instanceof HTMLElement) || target.dataset.docomatorVersionState) return;
    target.dataset.docomatorVersionState = "loading";
    fetch("/healthz", {
      headers: { accept: "application/json" },
      cache: "no-store"
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`healthz ${response.status}`);
        return response.json();
      })
      .then((body) => {
        const version = String(body?.version || "").trim();
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
          throw new Error("invalid version");
        }
        target.textContent = `Версия ${version} · локально`;
        target.title = `Оформлятор ${version}`;
        target.dataset.docomatorVersionState = "ready";
      })
      .catch(() => {
        target.dataset.docomatorVersionState = "unavailable";
      });
  }

  function guidedFlowInstallDocumentIntakeDisclosure() {
    const limits = document.querySelector(".intake-limits");
    if (!(limits instanceof HTMLUListElement) || limits.closest("details")) return;

    const disclosure = document.createElement("details");
    disclosure.className = "technical-details intake-checks-disclosure";
    const summary = document.createElement("summary");
    summary.textContent = "Что проверяется";
    limits.before(disclosure);
    disclosure.append(summary, limits);
  }

  function guidedFlowInstallDocumentIntake() {
    const input = document.querySelector("#documentIntakeFile");
    const button = document.querySelector("#documentIntakeButton");
    const dropZone = document.querySelector("#documentIntakeDropZone");
    if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) return;

    guidedFlowInstallDocumentIntakeDisclosure();
    guidedFlowSecondaryAction(button, "Проверить сейчас", ["Проверить файл", "Проверить документ"]);
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

  function guidedFlowInstallBulkImportDataHygiene() {
    if (
      typeof bulkImportGuessValueType === "function" &&
      bulkImportGuessValueType.guidedCompositeValues !== true
    ) {
      const baseGuessValueType = bulkImportGuessValueType;
      const wrappedGuessValueType = function guidedBulkImportGuessValueType(header) {
        const guessed = baseGuessValueType(header);
        if (guessed !== "enum" || typeof bulkImportColumnValues !== "function") return guessed;
        const values = bulkImportColumnValues(header);
        if (values.some((value) => /[,;]/u.test(String(value)))) {
          return "string";
        }
        return guessed;
      };
      wrappedGuessValueType.guidedCompositeValues = true;
      bulkImportGuessValueType = wrappedGuessValueType;
    }

    if (
      typeof collectBulkImportMappings === "function" &&
      collectBulkImportMappings.guidedEnumLines !== true
    ) {
      const baseCollectMappings = collectBulkImportMappings;
      const wrappedCollectMappings = function guidedCollectBulkImportMappings() {
        const mappings = baseCollectMappings();
        for (const mapping of mappings) {
          if (mapping?.valueType !== "enum" || !mapping?.createIfMissing) continue;
          const row = typeof bulkImportColumnRow === "function"
            ? bulkImportColumnRow(mapping.column)
            : null;
          const textarea = row?.querySelector?.("[data-bulk-enum-values]");
          if (!(textarea instanceof HTMLTextAreaElement)) continue;
          const seen = new Set();
          const values = [];
          for (const source of String(textarea.value || "").split(/\r?\n/u)) {
            const value = source.normalize("NFKC").trim();
            if (!value) continue;
            const identity = mapping.caseInsensitive
              ? value.toLocaleLowerCase("ru-RU")
              : value;
            if (seen.has(identity)) continue;
            seen.add(identity);
            values.push(value);
          }
          mapping.enumValues = values;
        }
        return mappings;
      };
      wrappedCollectMappings.guidedEnumLines = true;
      collectBulkImportMappings = wrappedCollectMappings;
    }
  }

  function guidedFlowEnhanceBulkImportRepairButtons(errors) {
    if (!Array.isArray(errors)) return;
    const root = document.querySelector("#bulkImportPlan");
    if (!root) return;
    for (const error of errors) {
      const issue = error?.issue && typeof error.issue === "object" ? error.issue : error;
      const code = String(issue?.code || "");
      const repair = issue?.repair;
      const column = String(repair?.column || issue?.column || "").trim();
      if (
        !column ||
        repair?.kind !== "change_field_type" ||
        !["invalid_number", "invalid_integer"].includes(code)
      ) {
        continue;
      }
      const showButton = [...root.querySelectorAll("[data-bulk-fix-column]")].find(
        (candidate) => candidate.dataset.bulkFixColumn === column
      );
      if (!(showButton instanceof HTMLButtonElement)) continue;
      const row = typeof bulkImportColumnRow === "function" ? bulkImportColumnRow(column) : null;
      if (row?.querySelector?.("[data-bulk-mapping-mode]")?.value !== "create") continue;

      let actions = showButton.closest(".bulk-import-error-actions");
      if (!(actions instanceof HTMLElement)) {
        actions = document.createElement("div");
        actions.className = "bulk-import-error-actions";
        showButton.before(actions);
        actions.append(showButton);
      }
      if (actions.querySelector("[data-guided-fix-type]")) continue;

      const autoFix = document.createElement("button");
      autoFix.type = "button";
      autoFix.className = "primary-button compact";
      autoFix.dataset.guidedFixType = "string";
      autoFix.dataset.guidedFixColumn = column;
      autoFix.textContent = "Исправить автоматически";
      autoFix.title =
        "Изменить тип создаваемого поля на короткий текст и повторить проверку. Данные ещё не сохраняются.";
      actions.prepend(autoFix);
    }
  }

  function guidedFlowInstallBulkImportRepair() {
    if (
      typeof renderBulkImportPlan === "function" &&
      renderBulkImportPlan.guidedRepairButtons !== true
    ) {
      const baseRenderBulkImportPlan = renderBulkImportPlan;
      const wrappedRenderBulkImportPlan = function guidedRenderBulkImportPlan(plan) {
        baseRenderBulkImportPlan(plan);
        guidedFlowEnhanceBulkImportRepairButtons(plan?.errors);
      };
      wrappedRenderBulkImportPlan.guidedRepairButtons = true;
      renderBulkImportPlan = wrappedRenderBulkImportPlan;
    }

    const panel = document.querySelector("#bulkDataImportPanel");
    if (!(panel instanceof HTMLElement) || panel.dataset.guidedRepairBound === "true") return;
    panel.dataset.guidedRepairBound = "true";
    panel.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest?.("[data-guided-fix-type]");
        if (!(button instanceof HTMLButtonElement)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const column = String(button.dataset.guidedFixColumn || "");
        const row = typeof bulkImportColumnRow === "function" ? bulkImportColumnRow(column) : null;
        const type = row?.querySelector?.("[data-bulk-value-type]");
        if (!(type instanceof HTMLSelectElement)) return;
        type.value = button.dataset.guidedFixType || "string";
        type.dispatchEvent(new Event("change", { bubbles: true }));
        const message = document.querySelector("#bulkImportMessage");
        if (message) {
          message.className = "bulk-import-message is-loading";
          message.textContent =
            `Поле «${column}» переключено на текст. Повторяем проверку автоматически; данные пока не сохранены.`;
        }
        setTimeout(() => {
          if (typeof planBulkImport === "function") void planBulkImport();
        }, 0);
      },
      { capture: true }
    );
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
    guidedFlowInstallVersion();
    guidedFlowInstallDocumentIntake();
    guidedFlowInstallBulkImportDataHygiene();
    guidedFlowInstallBulkImportRepair();
    guidedFlowInstallBulkImport();
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
