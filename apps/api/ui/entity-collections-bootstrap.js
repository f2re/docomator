{
  if (!document.querySelector('link[data-entity-collections-style]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/ui/entity-collections.css";
    link.dataset.entityCollectionsStyle = "";
    document.head.append(link);
  }

  const employeeDialog = document.querySelector("#employeeDialog");
  const employeeBody = employeeDialog?.querySelector(".employee-dialog-body");
  if (employeeBody && !document.querySelector("#employeeCollections")) {
    const section = document.createElement("section");
    section.id = "employeeCollections";
    section.className = "employee-collections";
    section.setAttribute("aria-label", "Таблицы и списки данных сотрудника");
    const technical = employeeBody.querySelector("#employeeTechnicalDetails");
    if (technical) employeeBody.insertBefore(section, technical);
    else employeeBody.append(section);
  }

  let pendingEmployeeId = "";
  document.addEventListener(
    "click",
    (event) => {
      const employeeRow = event.target.closest?.("[data-employee-id]");
      if (employeeRow) pendingEmployeeId = String(employeeRow.dataset.employeeId || "");
      const action = event.target.closest?.("[data-employee-action]")?.dataset.employeeAction;
      if (action === "add") pendingEmployeeId = "";
    },
    true
  );

  function announceOpen() {
    if (!employeeDialog?.open) return;
    document.dispatchEvent(
      new CustomEvent("docomator:employee-dialog-opened", {
        detail: {
          spaceId: String(globalThis.docomatorCurrentSpaceId || ""),
          entityId: pendingEmployeeId,
          displayName: employeeDialog.querySelector("#employeeDisplayName")?.value || ""
        }
      })
    );
  }

  if (employeeDialog) {
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "attributes" && mutation.attributeName === "open")) {
        if (employeeDialog.open) announceOpen();
        else pendingEmployeeId = "";
      }
    });
    observer.observe(employeeDialog, { attributes: true, attributeFilter: ["open"] });
  }

  void import("/ui/entity-collections-ui.js")
    .then(() => {
      if (employeeDialog?.open) announceOpen();
    })
    .catch((error) => {
      console.error("Не удалось загрузить редактор повторяемых таблиц.", error);
    });
}
