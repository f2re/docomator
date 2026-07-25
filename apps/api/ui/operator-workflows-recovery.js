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
