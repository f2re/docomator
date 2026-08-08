{
  async function authStatus() {
    const response = await fetch("/api/v1/auth/status", {
      headers: { accept: "application/json" }
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  async function logout(button) {
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = "Выходим…";
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: "{}"
      });
    } finally {
      location.replace("/login");
      button.innerHTML = original;
    }
  }

  function createLogoutButton(location) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.authLogout = "";
    button.dataset.authLocation = location;
    if (location === "settings") {
      button.className = "settings-row";
      button.innerHTML =
        '<span><strong>Выйти</strong><small>Завершить текущую сессию на этом устройстве</small></span><span aria-hidden="true">›</span>';
    } else {
      button.className = "quiet-button";
      button.innerHTML = '<span aria-hidden="true">↪</span><span>Выйти</span>';
    }
    button.addEventListener("click", () => void logout(button));
    return button;
  }

  function installLogout() {
    const footer = document.querySelector(".sidebar-footer");
    const connection = document.querySelector("#connectionBadge");
    if (footer && !footer.querySelector('[data-auth-location="sidebar"]')) {
      const button = createLogoutButton("sidebar");
      if (connection) footer.insertBefore(button, connection);
      else footer.append(button);
    }

    const settings = document.querySelector(".settings-grid");
    if (settings && !settings.querySelector('[data-auth-location="settings"]')) {
      settings.append(createLogoutButton("settings"));
    }
  }

  async function enhance() {
    const body = await authStatus();
    if (body?.data?.enabled && body?.data?.authenticated) installLogout();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void enhance(), { once: true });
  } else {
    void enhance();
  }
}
