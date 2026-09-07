{
  function bulkImportControllerPanel() {
    return document.querySelector("#bulkDataImportPanel");
  }

  function bulkImportControllerInput() {
    return document.querySelector("#bulkImportFile");
  }

  function bulkImportControllerPreviewSelectedFile() {
    const input = bulkImportControllerInput();
    const file = input?.files?.[0];
    if (!(input instanceof HTMLInputElement) || !(file instanceof File)) return;
    if (typeof previewBulkImportFile === "function") {
      void previewBulkImportFile();
    }
  }

  function bulkImportControllerAssignDroppedFile(input, file) {
    if (typeof DataTransfer !== "function") return false;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      return input.files?.[0] === file || input.files?.[0]?.name === file.name;
    } catch {
      return false;
    }
  }

  function bulkImportControllerInstall() {
    const panel = bulkImportControllerPanel();
    const input = bulkImportControllerInput();
    if (!(panel instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
    if (panel.dataset.bulkImportControllerBound === "true") return;
    panel.dataset.bulkImportControllerBound = "true";

    input.addEventListener("change", bulkImportControllerPreviewSelectedFile);

    const dropTarget = input.closest("label");
    if (!(dropTarget instanceof HTMLElement)) return;
    dropTarget.addEventListener("dragover", (event) => {
      if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
    });
    dropTarget.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (!(file instanceof File)) return;
      event.preventDefault();
      if (bulkImportControllerAssignDroppedFile(input, file)) {
        bulkImportControllerPreviewSelectedFile();
        return;
      }
      if (typeof previewBulkImportBytes === "function") {
        void previewBulkImportBytes(file.name, file);
      }
    });
  }

  bulkImportControllerInstall();
  document.addEventListener("docomator:view-changed", bulkImportControllerInstall);
}
