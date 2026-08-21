{
  const ACCESS_PATH = "/access";
  const ACCESS_API_PREFIX = "/api/v1/access/";

  function safeNextPath() {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return next.startsWith("/") && !next.startsWith("//") ? next : "/";
  }

  function moveToAccessScreen() {
    if (location.pathname === ACCESS_PATH) return;
    location.assign(`${ACCESS_PATH}?next=${encodeURIComponent(safeNextPath())}`);
  }

  if (!globalThis.__docomatorAccessFetchInstalled) {
    globalThis.__docomatorAccessFetchInstalled = true;
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (response.status !== 401) return response;
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : typeof Request !== "undefined" && input instanceof Request
              ? input.url
              : "";
      if (!rawUrl) return response;
      const url = new URL(rawUrl, location.origin);
      if (url.origin === location.origin && !url.pathname.startsWith(ACCESS_API_PREFIX)) {
        moveToAccessScreen();
      }
      return response;
    };
  }

  async function accessStatus() {
    const response = await fetch("/api/v1/access/status", {
      headers: { accept: "application/json" }
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  async function lock(button) {
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = "Закрываем…";
    try {
      await fetch("/api/v1/access/lock", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: "{}"
      });
    } finally {
      location.replace(ACCESS_PATH);
      button.innerHTML = original;
    }
  }

  function createLockButton(location) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.accessLock = "";
    button.dataset.accessLocation = location;
    if (location === "settings") {
      button.className = "settings-row";
      button.innerHTML =
        '<span><strong>Закрыть доступ</strong><small>Потребовать код при следующем открытии рабочей области на этом устройстве</small></span><span aria-hidden="true">›</span>';
    } else {
      button.className = "quiet-button";
      button.innerHTML = '<span aria-hidden="true">⌁</span><span>Закрыть доступ</span>';
    }
    button.addEventListener("click", () => void lock(button));
    return button;
  }

  function installLockControls() {
    const footer = document.querySelector(".sidebar-footer");
    const connection = document.querySelector("#connectionBadge");
    if (footer && !footer.querySelector('[data-access-location="sidebar"]')) {
      const button = createLockButton("sidebar");
      if (connection) footer.insertBefore(button, connection);
      else footer.append(button);
    }

    const settings = document.querySelector(".settings-grid");
    if (settings && !settings.querySelector('[data-access-location="settings"]')) {
      settings.append(createLockButton("settings"));
    }
  }

  async function enhanceAccessUi() {
    const body = await accessStatus();
    if (body?.data?.enabled && body?.data?.unlocked) installLockControls();
  }

  globalThis.docomatorAccess = Object.freeze({
    moveToAccessScreen,
    safeNextPath
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void enhanceAccessUi(), { once: true });
  } else {
    void enhanceAccessUi();
  }
}
