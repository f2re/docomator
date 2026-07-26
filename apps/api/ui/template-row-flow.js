{
  function rowFlowPlural(value, one, few, many) {
    const absolute = Math.abs(Number(value) || 0);
    const lastTwo = absolute % 100;
    const last = absolute % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function rowFlowGroupStructure() {
    const list = document.querySelector("#documentStructureResult .structure-element-list");
    if (!list || !Array.isArray(structureReport?.elements)) return;
    const buttons = new Map(
      [...list.querySelectorAll(".structure-element[data-structure-id]")].map(
        (button) => [button.dataset.structureId, button]
      )
    );
    if (buttons.size === 0) return;

    const entries = [];
    const rows = new Map();
    for (const element of structureReport.elements) {
      const location = element.kind === "paragraph" ? element.tableLocation : null;
      if (!location) {
        entries.push({ kind: "element", element });
        continue;
      }
      const key = `${element.part}\u0000${location.tableIndex}\u0000${location.rowIndex}`;
      let row = rows.get(key);
      if (!row) {
        row = {
          kind: "row",
          tableIndex: location.tableIndex,
          rowIndex: location.rowIndex,
          columns: new Map()
        };
        rows.set(key, row);
        entries.push(row);
      }
      const column = row.columns.get(location.columnIndex) || [];
      column.push(element);
      row.columns.set(location.columnIndex, column);
    }

    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      if (entry.kind === "element") {
        const button = buttons.get(entry.element.id);
        if (button) fragment.append(button);
        continue;
      }

      const section = document.createElement("section");
      section.className = "structure-table-row";
      section.setAttribute("role", "group");
      section.setAttribute(
        "aria-label",
        `Таблица ${entry.tableIndex + 1}, строка ${entry.rowIndex + 1}`
      );
      const header = document.createElement("header");
      header.className = "structure-table-row-header";
      const title = document.createElement("div");
      const table = document.createElement("span");
      table.textContent = `Таблица ${entry.tableIndex + 1}`;
      const rowTitle = document.createElement("strong");
      rowTitle.textContent = `Строка ${entry.rowIndex + 1}`;
      title.append(table, rowTitle);
      const count = document.createElement("small");
      count.textContent = `${entry.columns.size} ${rowFlowPlural(entry.columns.size, "ячейка", "ячейки", "ячеек")}`;
      header.append(title, count);

      const cells = document.createElement("div");
      cells.className = "structure-table-cells";
      for (const [columnIndex, elements] of [...entry.columns.entries()].sort(
        ([left], [right]) => left - right
      )) {
        const cell = document.createElement("div");
        cell.className = "structure-table-cell-stack";
        const label = document.createElement("span");
        label.className = "structure-table-cell-label";
        label.textContent = `Ячейка ${columnIndex + 1}`;
        cell.append(label);
        for (const element of elements) {
          const button = buttons.get(element.id);
          if (button) {
            button.classList.add("structure-table-cell-element");
            cell.append(button);
          }
        }
        cells.append(cell);
      }
      section.append(header, cells);
      fragment.append(section);
    }
    list.replaceChildren(fragment);
    list.classList.add("is-row-flow-structured");
  }

  const rowFlowBaseRenderStructure = renderStructure;
  renderStructure = function renderStructureWithRows(report, operationId) {
    rowFlowBaseRenderStructure(report, operationId);
    rowFlowGroupStructure();
  };

  function rowFlowRowElements(element) {
    const location = element?.tableLocation;
    if (!location || !Array.isArray(structureReport?.elements)) return [];
    const columns = new Set();
    return structureReport.elements.filter((candidate) => {
      const candidateLocation = candidate.tableLocation;
      if (
        candidate.kind !== "paragraph" ||
        candidate.part !== element.part ||
        candidateLocation?.tableIndex !== location.tableIndex ||
        candidateLocation?.rowIndex !== location.rowIndex ||
        columns.has(candidateLocation.columnIndex)
      ) {
        return false;
      }
      columns.add(candidateLocation.columnIndex);
      return true;
    });
  }

  function rowFlowCleanupEditor() {
    const report = document.querySelector(".structure-report.is-row-editor-open");
    report?.classList.remove("is-row-editor-open");
    const selection = document.querySelector(
      ".structure-selection.is-row-editor-open"
    );
    selection?.classList.remove("is-row-editor-open");
    report
      ?.querySelector(".structure-element-list")
      ?.removeAttribute("aria-hidden");
  }

  function rowFlowReturnToStructure(panel) {
    panel.remove();
    const form = document.querySelector("#documentFieldForm");
    const entry = document.querySelector("#rowEditorEntry");
    if (form) form.hidden = false;
    if (entry) entry.hidden = false;
    rowFlowCleanupEditor();
    const selected = document.querySelector(".structure-element.is-selected");
    selected?.scrollIntoView({ block: "center" });
    selected?.focus();
  }

  function rowFlowEnhanceEditor(panel) {
    const selection = panel.closest(".structure-selection");
    const report = panel.closest(".structure-report");
    if (!selection || !report) return;
    selection.classList.add("is-row-editor-open");
    report.classList.add("is-row-editor-open");
    report
      .querySelector(".structure-element-list")
      ?.setAttribute("aria-hidden", "true");
    panel.classList.add("row-flow-workspace");

    if (panel.dataset.rowFlowEnhanced !== "true") {
      panel.dataset.rowFlowEnhanced = "true";
      const location = selectedStructureElement?.tableLocation;
      const columns = rowFlowRowElements(selectedStructureElement).length;
      const eyebrow = panel.querySelector(".roster-assistant-heading .eyebrow");
      const title = panel.querySelector(".roster-assistant-heading h3");
      const detail = panel.querySelector(".roster-assistant-heading p:last-child");
      if (eyebrow && location) {
        eyebrow.textContent = `Таблица ${location.tableIndex + 1} · строка ${location.rowIndex + 1} · ${columns} ${rowFlowPlural(columns, "ячейка", "ячейки", "ячеек")}`;
      }
      if (title) title.textContent = "Настроить повторяемую строку";
      if (detail) {
        detail.textContent =
          "Для каждой ячейки выберите источник. В сводном документе эта строка повторится для каждого участника.";
      }
      const close = panel.querySelector("#rowEditorClose");
      if (close) {
        close.className = "secondary-button row-flow-back-button";
        close.textContent = "← К структуре";
        close.setAttribute("aria-label", "Вернуться к структуре документа");
      }
      const explanation = panel.querySelector(".row-editor-explanation");
      if (explanation) {
        explanation.innerHTML =
          "<strong>Одна строка — один участник</strong><p>Номер система считает сама; остальные значения берутся из карточки участника. Заголовки таблицы не повторяются.</p>";
      }
    }

    if (
      panel.querySelector(".roster-assistant-finished") &&
      !panel.querySelector("[data-row-flow-return]")
    ) {
      const actions = panel.querySelector(".roster-assistant-actions");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-button";
      button.dataset.rowFlowReturn = "";
      button.textContent = "К структуре документа";
      button.addEventListener("click", () => rowFlowReturnToStructure(panel));
      actions?.prepend(button);
    }
  }

  let rowFlowSyncScheduled = false;
  function rowFlowSyncEditor() {
    if (rowFlowSyncScheduled) return;
    rowFlowSyncScheduled = true;
    requestAnimationFrame(() => {
      rowFlowSyncScheduled = false;
      const panel = document.querySelector("#rowEditorPanel");
      if (panel) rowFlowEnhanceEditor(panel);
      else rowFlowCleanupEditor();
    });
  }

  const templatesView = document.querySelector('[data-view="templates"]');
  if (templatesView) {
    new MutationObserver(rowFlowSyncEditor).observe(templatesView, {
      childList: true,
      subtree: true
    });
  }
  rowFlowSyncEditor();
}
