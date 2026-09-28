{
  const ACCESS_PATH = "/access";
  const ACCESS_API_PREFIX = "/api/v1/access/";
  const DOCOMATOR_GET_TIMEOUT_MS = 12_000;
  let accessRedirectPending = false;

  function safeNextPath() {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return next.startsWith("/") && !next.startsWith("//") ? next : "/";
  }

  function moveToAccessScreen() {
    if (location.pathname === ACCESS_PATH || accessRedirectPending) return;
    accessRedirectPending = true;
    location.assign(`${ACCESS_PATH}?next=${encodeURIComponent(safeNextPath())}`);
  }

  function accessFetchUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    if (typeof Request !== "undefined" && input instanceof Request) return input.url;
    return "";
  }

  function accessFetchMethod(input, init) {
    if (typeof init?.method === "string" && init.method.trim()) {
      return init.method.trim().toUpperCase();
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      return String(input.method || "GET").toUpperCase();
    }
    return "GET";
  }

  if (!globalThis.__docomatorAccessFetchInstalled) {
    globalThis.__docomatorAccessFetchInstalled = true;
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init = {}) => {
      init = init || {};
      const rawUrl = accessFetchUrl(input);
      const url = rawUrl ? new URL(rawUrl, location.origin) : null;
      const method = accessFetchMethod(input, init);
      const requestOwnsSignal =
        init.signal !== undefined ||
        (typeof Request !== "undefined" && input instanceof Request);
      const controller =
        url?.origin === location.origin && method === "GET" && !requestOwnsSignal
          ? new AbortController()
          : null;
      const timeoutId =
        controller === null
          ? null
          : setTimeout(() => controller.abort(new DOMException(
              "Локальный сервер не ответил за 12 секунд. Данные не изменены; повторите действие.",
              "TimeoutError"
            )), DOCOMATOR_GET_TIMEOUT_MS);
      let jsonBodyDeadline = false;
      try {
        const response = await originalFetch(
          input,
          controller === null ? init : { ...init, signal: controller.signal }
        );
        if (
          response.status === 401 &&
          url?.origin === location.origin &&
          !url.pathname.startsWith(ACCESS_API_PREFIX)
        ) {
          moveToAccessScreen();
        }
        // A JSON response can stall after its headers. Keep its abort deadline
        // through body consumption; the one-shot timer releases its closure.
        // Binary downloads retain normal streaming semantics.
        jsonBodyDeadline = controller !== null &&
          (response.headers.get("content-type") || "").includes("application/json");
        return response;
      } catch (error) {
        if (controller?.signal.aborted) {
          const timeoutError = new Error(
            "Локальный сервер не ответил за 12 секунд. Данные не изменены; повторите действие."
          );
          timeoutError.name = "TimeoutError";
          throw timeoutError;
        }
        throw error;
      } finally {
        if (timeoutId !== null && !jsonBodyDeadline) clearTimeout(timeoutId);
      }
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
    try {
      const body = await accessStatus();
      if (body?.data?.enabled && body?.data?.unlocked) installLockControls();
    } catch {
      // Optional controls must not turn a disconnected startup into an unhandled rejection.
    }
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
