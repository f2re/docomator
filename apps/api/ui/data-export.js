{
  function currentSpaceId() {
    return String(
      globalThis.docomatorCurrentSpaceId ||
        localStorage.getItem("docomator.space") ||
        ""
    ).trim();
  }

  function selectedEntityType() {
    return String(document.querySelector("#entityWorkspaceType")?.value || "").trim();
  }

  function exportFileName(response) {
    const disposition = response.headers.get("content-disposition") || "";
    const match = /filename="([^"]+)"/iu.exec(disposition);
    return match?.[1] || `docomator-export-${new Date().toISOString().slice(0, 10)}.csv`;
  }

  async function exportType(button, entityTypeKey) {
    const spaceId = currentSpaceId();
    if (!spaceId || !entityTypeKey) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Готовим CSV…";
    const status = button.parentElement?.querySelector("[data-data-export-status]");
    if (status) {
      status.textContent = "";
      status.hidden = true;
    }
    try {
      const response = await fetch(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/data-export.csv?entityTypeKey=${encodeURIComponent(entityTypeKey)}`,
        {
          headers: {
            accept: "text/csv",
            "x-correlation-id": globalThis.crypto?.randomUUID?.() || `export-${Date.now()}`,
            "x-actor-id": "local-ui"
          }
        }
      );
      if (response.status === 401) {
        location.assign(`/login?next=${encodeURIComponent(location.pathname + location.hash)}`);
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Сервер вернул код ${response.status}.`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = exportFileName(response);
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      const count = Number(response.headers.get("x-docomator-export-count") || "0");
      if (status) {
        status.textContent = count === 0
          ? "Файл создан: в выбранном разделе пока нет объектов этого типа."
          : `Экспортировано: ${count}`;
        status.hidden = false;
      }
    } catch (error) {
      if (status) {
        status.textContent = error instanceof Error
          ? `Экспорт не выполнен. ${error.message} Данные не изменены.`
          : "Экспорт не выполнен. Данные не изменены. Повторите действие.";
        status.hidden = false;
      }
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function statusNode(parent) {
    let status = parent.querySelector("[data-data-export-status]");
    if (status) return status;
    status = document.createElement("span");
    status.dataset.dataExportStatus = "";
    status.className = "data-export-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    parent.append(status);
    return status;
  }

  function installButton(anchor, keyProvider, marker) {
    const parent = anchor?.parentElement;
    if (!anchor || !parent || parent.querySelector(`[${marker}]`)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.setAttribute(marker, "");
    button.textContent = "Экспорт CSV";
    button.addEventListener("click", () => void exportType(button, keyProvider()));
    anchor.insertAdjacentElement("afterend", button);
    statusNode(parent);
  }

  function enhance() {
    installButton(
      document.querySelector("[data-bulk-import-open]"),
      () => "person",
      "data-employee-export"
    );
    installButton(
      document.querySelector('[data-entity-action="import"]'),
      selectedEntityType,
      "data-entity-export"
    );
  }

  const observer = new MutationObserver(() => queueMicrotask(enhance));
  const start = () => {
    enhance();
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
  document.addEventListener("docomator:space-changed", enhance);
}
