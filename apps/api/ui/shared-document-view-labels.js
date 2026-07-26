for (const button of document.querySelectorAll('[data-view-target="documents"]')) {
  button.addEventListener("click", () => {
    const eyebrow = document.querySelector("#viewEyebrow");
    const title = document.querySelector("#viewTitle");
    const description = document.querySelector("#viewDescription");
    if (eyebrow) eyebrow.textContent = "Ход работы и готовые файлы";
    if (title) title.textContent = "Результаты и операции";
    if (description) {
      description.textContent =
        "Сохраняемые операции выбранного раздела и готовые ручные или автоматические документы.";
    }
  });
}

{
  let rowHeaderRecoveryScheduled = false;

  function rowHeaderRecoveryNormalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/gu, "е")
      .replace(/[^\p{L}\p{N}#№]+/gu, " ")
      .trim()
      .replace(/\s+/gu, " ");
  }

  function rowHeaderRecoveryText(card) {
    const elementId = card.dataset.elementId || "";
    const element = structureReport?.elements?.find(
      (candidate) => candidate.id === elementId
    );
    const location = element?.tableLocation;
    if (element && location && location.rowIndex > 0) {
      const candidates = (structureReport?.elements || []).filter(
        (candidate) =>
          candidate.kind === "paragraph" &&
          candidate.part === element.part &&
          candidate.tableLocation?.tableIndex === location.tableIndex &&
          candidate.tableLocation?.rowIndex === location.rowIndex - 1 &&
          candidate.tableLocation?.columnIndex === location.columnIndex
      );
      const header =
        candidates.find(
          (candidate) => String(candidate.text || "").trim() !== ""
        ) || candidates[0];
      const text = String(header?.text || "").trim();
      if (text) return text;
    }
    return card.querySelector(".row-editor-column-title strong")?.textContent || "";
  }

  function rowHeaderRecoveryIsPosition(value) {
    const raw = String(value || "").normalize("NFKC").trim();
    if (/^(?:#|№)$/u.test(raw)) return true;
    return /^(?:n|номер|п п|порядковый номер)$/u.test(
      rowHeaderRecoveryNormalize(raw)
    );
  }

  function rowHeaderRecoveryApply() {
    rowHeaderRecoveryScheduled = false;
    const panel = document.querySelector("#rowEditorPanel");
    if (!panel) return;

    for (const card of panel.querySelectorAll("[data-row-editor-column]")) {
      if (card.dataset.existingFieldId) continue;
      if (!rowHeaderRecoveryIsPosition(rowHeaderRecoveryText(card))) continue;
      const select = card.querySelector("[data-row-editor-mode]");
      if (!select || select.value !== "skip") continue;
      if (![...select.options].some((option) => option.value === "system:position")) {
        continue;
      }
      select.value = "system:position";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function rowHeaderRecoverySchedule() {
    if (rowHeaderRecoveryScheduled) return;
    rowHeaderRecoveryScheduled = true;
    requestAnimationFrame(rowHeaderRecoveryApply);
  }

  const templatesView = document.querySelector('[data-view="templates"]');
  if (templatesView) {
    new MutationObserver(rowHeaderRecoverySchedule).observe(templatesView, {
      childList: true,
      subtree: true
    });
  }
  document.addEventListener(
    "docomator:template-draft-changed",
    rowHeaderRecoverySchedule
  );
  rowHeaderRecoverySchedule();
}
