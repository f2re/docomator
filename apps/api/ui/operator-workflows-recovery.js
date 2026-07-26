const operatorBasePersistEmployeeWithWorkspaceFeedback = operatorPersistEmployee;

operatorPersistEmployee = async function operatorPersistEmployeeWithWorkspaceFeedback() {
  const displayName = document.querySelector("#employeeDisplayName")?.value.trim() || "";
  await operatorBasePersistEmployeeWithWorkspaceFeedback();

  const dialog = document.querySelector("#employeeDialog");
  if (displayName && dialog && !dialog.open) {
    state.employee.lastSavedName = displayName;
    renderEmployeeSuccess();
  }
};

let operatorRowPositionRecoveryScheduled = false;

function operatorRowPositionRecoveryApply() {
  operatorRowPositionRecoveryScheduled = false;
  const panel = document.querySelector("#rowEditorPanel");
  if (!panel) return;

  for (const card of panel.querySelectorAll("[data-row-editor-column]")) {
    if (card.dataset.existingFieldId) continue;
    if (card.dataset.positionRecoveryApplied === "true") continue;
    const header = String(
      card.querySelector(".row-editor-column-title strong")?.textContent || ""
    )
      .normalize("NFKC")
      .trim();
    if (!/^(?:#|№)$/u.test(header)) continue;

    const select = card.querySelector("[data-row-editor-mode]");
    if (!select || select.value !== "skip") continue;
    if (![...select.options].some((option) => option.value === "system:position")) {
      continue;
    }

    card.dataset.positionRecoveryApplied = "true";
    select.value = "system:position";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function operatorRowPositionRecoverySchedule() {
  if (operatorRowPositionRecoveryScheduled) return;
  operatorRowPositionRecoveryScheduled = true;
  requestAnimationFrame(operatorRowPositionRecoveryApply);
}

const operatorTemplatesView = document.querySelector('[data-view="templates"]');
if (operatorTemplatesView) {
  new MutationObserver(operatorRowPositionRecoverySchedule).observe(
    operatorTemplatesView,
    { childList: true, subtree: true }
  );
}
document.addEventListener("click", (event) => {
  if (event.target.closest("#rowEditorOpen")) {
    operatorRowPositionRecoverySchedule();
    setTimeout(operatorRowPositionRecoverySchedule, 0);
  }
});
operatorRowPositionRecoverySchedule();
