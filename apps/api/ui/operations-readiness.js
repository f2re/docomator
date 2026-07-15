const operationsOverview = document.querySelector('[data-view="overview"]');
let operationsReadinessCreated = false;
let operationsReadinessBusy = false;
let operationsReadinessTimer = null;

function operationsEscape(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
      })[character]
  );
}

function operationsFormatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const amount = bytes / 1024 ** index;
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function createOperationsReadinessPanel() {
  if (!operationsOverview || operationsReadinessCreated) return;
  operationsReadinessCreated = true;
  const panel = document.createElement("article");
  panel.id = "operationsReadinessPanel";
  panel.className = "panel operations-readiness-panel";
  panel.innerHTML = `
    <div class="panel-heading operations-heading">
      <div>
        <p class="eyebrow">Пилотная эксплуатация</p>
        <h2>Готовность системы</h2>
        <p>Проверяем не только настройки, но и фактическую работу базы, диска, worker, LibreOffice, доставок и резервирования.</p>
      </div>
      <button class="primary-button" id="operationsReadinessRefresh" type="button">Проверить сейчас</button>
    </div>
    <div id="operationsReadinessSummary" class="operations-readiness-summary" aria-live="polite">
      <div class="generation-history-empty">Получаем эксплуатационное состояние…</div>
    </div>
    <div id="operationsReadinessChecks" class="operations-check-list" aria-live="polite"></div>`;
  operationsOverview.append(panel);
  panel
    .querySelector("#operationsReadinessRefresh")
    ?.addEventListener("click", loadOperationsReadiness);
}

function operationsStateMeta(state) {
  return (
    {
      ok: { icon: "✅", label: "Готово", className: "is-ok" },
      warning: { icon: "⚠️", label: "Внимание", className: "is-warning" },
      error: { icon: "⛔", label: "Ошибка", className: "is-error" },
      disabled: { icon: "○", label: "Отключено", className: "is-disabled" }
    }[state] || { icon: "?", label: "Неизвестно", className: "is-warning" }
  );
}

function operationsDataDetail(check) {
  const data = check.data || {};
  if (check.id === "disk" && typeof data.freeBytes === "number") {
    return `Свободно ${operationsFormatBytes(data.freeBytes)} из ${operationsFormatBytes(data.totalBytes)} (${data.freePercent}%).`;
  }
  if (check.id === "worker" && typeof data.ageMs === "number") {
    return `Последний сигнал ${Math.max(0, Math.round(data.ageMs / 1000))} сек. назад.`;
  }
  if (check.id === "backup" && typeof data.ageDays === "number") {
    return `Возраст копии: ${data.ageDays} дн.; проверенных копий: ${data.validBackupCount}.`;
  }
  if (check.id === "results" && typeof data.waitingCount === "number") {
    return `Новых: ${data.newCount}; ожидают работы: ${data.waitingCount}; забрано: ${data.collectedCount}.`;
  }
  return "";
}

function renderOperationsReadiness(report) {
  const summary = document.querySelector("#operationsReadinessSummary");
  const list = document.querySelector("#operationsReadinessChecks");
  if (!summary || !list) return;
  const status =
    report.status === "ready"
      ? {
          icon: "✅",
          title: "Система готова к пилотной работе",
          detail: "Обязательные компоненты работают. Отключённые каналы не блокируют основной сценарий.",
          className: "is-ready"
        }
      : report.status === "attention"
        ? {
            icon: "⚠️",
            title: "Основной контур работает, но есть замечания",
            detail: "Исправьте предупреждения перед длительной эксплуатацией или использованием соответствующего канала доставки.",
            className: "is-attention"
          }
        : {
            icon: "⛔",
            title: "Пилотный запуск заблокирован",
            detail: "Один или несколько обязательных компонентов не готовы. Формирование документов может быть ненадёжным.",
            className: "is-blocked"
          };
  summary.className = `operations-readiness-summary ${status.className}`;
  summary.innerHTML = `
    <span class="operations-summary-icon" aria-hidden="true">${status.icon}</span>
    <div>
      <strong>${status.title}</strong>
      <p>${status.detail}</p>
      <div class="operations-summary-counts">
        <span>Готово: ${report.summary.ok}</span>
        <span>Предупреждений: ${report.summary.warning}</span>
        <span>Ошибок: ${report.summary.error}</span>
        <span>Отключено: ${report.summary.disabled}</span>
      </div>
      <small>Проверено: ${operationsEscape(new Date(report.generatedAt).toLocaleString("ru-RU"))}; версия ${operationsEscape(report.version)}.</small>
    </div>`;
  list.innerHTML = report.checks
    .map((check) => {
      const meta = operationsStateMeta(check.state);
      const dataDetail = operationsDataDetail(check);
      return `
        <article class="operations-check ${meta.className}">
          <div class="operations-check-icon" aria-hidden="true">${meta.icon}</div>
          <div class="operations-check-copy">
            <div class="operations-check-title">
              <h3>${operationsEscape(check.title)}</h3>
              <span>${meta.label}${check.required ? " · обязательно" : ""}</span>
            </div>
            <strong>${operationsEscape(check.summary)}</strong>
            ${check.detail ? `<p>${operationsEscape(check.detail)}</p>` : ""}
            ${dataDetail ? `<p>${operationsEscape(dataDetail)}</p>` : ""}
            ${check.remediation ? `<div class="operations-remediation"><span aria-hidden="true">→</span><p>${operationsEscape(check.remediation)}</p></div>` : ""}
          </div>
        </article>`;
    })
    .join("");
}

async function loadOperationsReadiness() {
  createOperationsReadinessPanel();
  if (operationsReadinessBusy) return;
  const summary = document.querySelector("#operationsReadinessSummary");
  const list = document.querySelector("#operationsReadinessChecks");
  const button = document.querySelector("#operationsReadinessRefresh");
  if (!summary || !list || !button) return;
  operationsReadinessBusy = true;
  button.disabled = true;
  summary.className = "operations-readiness-summary";
  summary.innerHTML = `<div class="generation-history-empty">Выполняем контрольные проверки…</div>`;
  list.innerHTML = "";
  try {
    const response = await fetch("/api/v1/operations/readiness", {
      headers: { accept: "application/json" }
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.error?.message || "Диагностика завершилась ошибкой.");
    }
    renderOperationsReadiness(body.data);
  } catch (error) {
    summary.className = "operations-readiness-summary is-blocked";
    summary.innerHTML = `
      <span class="operations-summary-icon" aria-hidden="true">⛔</span>
      <div><strong>Диагностика недоступна</strong><p>${operationsEscape(error instanceof Error ? error.message : String(error))}</p></div>`;
  } finally {
    operationsReadinessBusy = false;
    button.disabled = false;
  }
}

if (operationsOverview) {
  createOperationsReadinessPanel();
  void loadOperationsReadiness();
  operationsReadinessTimer = setInterval(() => {
    if (operationsOverview.classList.contains("is-visible")) {
      void loadOperationsReadiness();
    }
  }, 60_000);
  window.addEventListener("beforeunload", () => {
    if (operationsReadinessTimer !== null) clearInterval(operationsReadinessTimer);
  });
}
