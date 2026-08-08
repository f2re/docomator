{
  async function authStatus() {
    const response = await fetch("/api/v1/auth/status", {
      headers: { accept: "application/json" }
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  async function logout(button) {
    const original = button.textContent;
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
      button.textContent = original;
    }
  }

  function installLogout() {
    if (document.querySelector("[data-auth-logout]")) return;
    const footer = document.querySelector(".sidebar-footer");
    const connection = document.querySelector("#connectionBadge");
    if (!footer) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quiet-button";
    button.dataset.authLogout = "";
    button.innerHTML = '<span aria-hidden="true">↪</span><span>Выйти</span>';
    button.addEventListener("click", () => void logout(button));
    if (connection) footer.insertBefore(button, connection);
    else footer.append(button);
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
