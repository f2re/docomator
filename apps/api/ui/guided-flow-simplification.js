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
