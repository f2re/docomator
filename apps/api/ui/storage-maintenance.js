let storageMaintenanceCreated = false;
let storageMaintenanceBusy = false;
let storageReconciliationBusy = false;
let storageMaintenancePlan = null;

function storageFormatBytes(value) {
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

function storageMaintenancePanel() {
  return document.querySelector("#storageMaintenancePanel");
}

function createStorageMaintenancePanel() {
  if (!sharedDocumentsView || storageMaintenanceCreated) return;
  storageMaintenanceCreated = true;
  const panel = document.createElement("article");
  panel.id = "storageMaintenancePanel";
  panel.className = "panel storage-maintenance-panel";
  panel.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Обслуживание диска</p>
        <h2>Хранилище файлов</h2>
        <p>Очистка удаляет только объекты без действующих ссылок. Проверка целостности отдельно сравнивает SQLite и файлы на диске, не изменяя данные.</p>
      </div>
      <span class="large-emoji" aria-hidden="true">🧹</span>
    </div>
    <div class="storage-maintenance-controls">
      <label class="generation-field">
        <span>Минимальный возраст объекта</span>
        <select id="storageMinimumAgeDays">
          <option value="1">1 день</option>
          <option value="7" selected>7 дней</option>
          <option value="30">30 дней</option>
          <option value="90">90 дней</option>
          <option value="365">1 год</option>
        </select>
        <small>Недавние объекты не рассматриваются, даже если ссылки уже удалены.</small>
      </label>
      <div class="storage-maintenance-actions">
        <button class="secondary-button" id="storageUsageRefresh" type="button">Обновить сведения</button>
        <button class="secondary-button" id="storageReconciliationRun" type="button">Проверить целостность</button>
        <button class="primary-button" id="storageCleanupPreview" type="button">Рассчитать очистку</button>
      </div>
    </div>
    <div id="storageUsageContent" class="storage-usage-content" aria-live="polite">
      <div class="generation-history-empty">Получаем сведения о хранилище…</div>
    </div>
    <div id="storageReconciliationReport" class="storage-cleanup-plan" aria-live="polite"></div>
    <div id="storageCleanupPlan" class="storage-cleanup-plan" aria-live="polite"></div>`;
  sharedDocumentsView.append(panel);
  panel
    .querySelector("#storageUsageRefresh")
    ?.addEventListener("click", loadStorageUsage);
  panel
    .querySelector("#storageReconciliationRun")
    ?.addEventListener("click", runStorageReconciliation);
  panel
    .querySelector("#storageCleanupPreview")
    ?.addEventListener("click", previewStorageCleanup);
  panel
    .querySelector("#storageMinimumAgeDays")
    ?.addEventListener("change", () => {
      storageMaintenancePlan = null;
      const plan = document.querySelector("#storageCleanupPlan");
      if (plan) plan.innerHTML = "";
      void loadStorageUsage();
    });
}

function storageMinimumAgeDays() {
  return Number(document.querySelector("#storageMinimumAgeDays")?.value || 7);
}

function renderStorageUsage(usage) {
  const holder = document.querySelector("#storageUsageContent");
  if (!holder) return;
  holder.innerHTML = `
    <div class="generation-progress-grid storage-usage-grid">
      <div class="generation-progress-item"><span>Всего объектов</span><strong>${Number(usage.objectCount || 0)}</strong><small>${storageFormatBytes(usage.objectBytes)}</small></div>
      <div class="generation-progress-item"><span>Защищены ссылками</span><strong>${Number(usage.referencedCount || 0)}</strong><small>${storageFormatBytes(usage.referencedBytes)}</small></div>
      <div class="generation-progress-item"><span>Можно рассмотреть</span><strong>${Number(usage.cleanupCandidateCount || 0)}</strong><small>${storageFormatBytes(usage.cleanupCandidateBytes)}</small></div>
      <div class="generation-progress-item"><span>Старше границы</span><strong>${generationEscape(new Date(usage.cutoff).toLocaleDateString("ru-RU"))}</strong><small>Фактическое удаление только после подтверждения</small></div>
    </div>
    <div class="generation-state ${usage.cleanupCandidateCount > 0 ? "is-warning" : "is-success"}">
      <span aria-hidden="true">${usage.cleanupCandidateCount > 0 ? "ⓘ" : "✅"}</span>
      <div>
        <strong>${usage.cleanupCandidateCount > 0 ? "Есть объекты без действующих ссылок" : "Очистка сейчас не требуется"}</strong>
        <p>${usage.cleanupCandidateCount > 0 ? `Потенциально освобождается ${storageFormatBytes(usage.cleanupCandidateBytes)}. Перед удалением будет повторно рассчитан пакет не более 200 объектов.` : "Все объекты защищены ссылками либо ещё не достигли выбранного возраста."}</p>
      </div>
    </div>`;
}

async function loadStorageUsage() {
  createStorageMaintenancePanel();
  if (storageMaintenanceBusy) return;
  const holder = document.querySelector("#storageUsageContent");
  if (!holder) return;
  storageMaintenanceBusy = true;
  holder.innerHTML = `<div class="generation-history-empty">Пересчитываем ссылки и объём…</div>`;
  try {
    const body = await sharedDocumentFetchJson(
      `/api/v1/storage/usage?minimumAgeDays=${encodeURIComponent(storageMinimumAgeDays())}`
    );
    renderStorageUsage(body.data);
  } catch (error) {
    holder.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Сведения получить не удалось</strong><p>${sharedDocumentEscape(error?.message || "Повторите действие.")}</p></div></div>`;
  } finally {
    storageMaintenanceBusy = false;
  }
}

function storageReconciliationIssueTitle(kind) {
  const labels = {
    object_store_missing: "Каталог хранилища отсутствует",
    database_invalid_sha256: "Недопустимый SHA-256 в SQLite",
    database_object_missing: "Файл отсутствует на диске",
    database_size_mismatch: "Размер не совпадает",
    database_storage_path_mismatch: "Путь в SQLite неканонический",
    physical_object_unregistered: "Файл отсутствует в SQLite",
    physical_checksum_mismatch: "Контрольная сумма не совпадает",
    invalid_layout: "Нестандартное расположение",
    non_regular_entry: "Ссылка или специальный объект",
    incoming_entry: "Незавершённый временный объект",
    unreadable_entry: "Объект недоступен для чтения"
  };
  return labels[kind] || "Нарушение целостности";
}

function storageReconciliationPath(issue) {
  if (issue.relativePath) return issue.relativePath;
  if (issue.sha256) return issue.sha256;
  if (issue.fileId) return issue.fileId;
  return "—";
}

function renderStorageReconciliation(report) {
  const holder = document.querySelector("#storageReconciliationReport");
  if (!holder) return;
  const issueRows = Array.isArray(report.issues)
    ? report.issues
        .map(
          (issue) => `
            <article class="storage-candidate-row">
              <strong>${sharedDocumentEscape(storageReconciliationIssueTitle(issue.kind))}</strong>
              <code>${sharedDocumentEscape(storageReconciliationPath(issue))}</code>
              <span>${sharedDocumentEscape(issue.message || "")}</span>
            </article>`
        )
        .join("")
    : "";
  holder.innerHTML = `
    <section class="storage-cleanup-confirmation">
      <div class="generation-state ${report.healthy ? "is-success" : "is-warning"}">
        <span aria-hidden="true">${report.healthy ? "✅" : "⚠️"}</span>
        <div>
          <strong>${report.healthy ? "SQLite и объектное хранилище согласованы" : `Обнаружено нарушений: ${Number(report.issueCount || 0)}`}</strong>
          <p>${report.healthy ? "Все зарегистрированные объекты найдены, их размеры, пути и SHA-256 совпадают." : "Проверка ничего не изменяла. Сохраните отчёт и устраните причину до запуска очистки или восстановления."}</p>
        </div>
      </div>
      <div class="generation-progress-grid storage-usage-grid">
        <div class="generation-progress-item"><span>Записей SQLite</span><strong>${Number(report.databaseObjectCount || 0)}</strong><small>${storageFormatBytes(report.databaseObjectBytes)}</small></div>
        <div class="generation-progress-item"><span>Файлов на диске</span><strong>${Number(report.physicalObjectCount || 0)}</strong><small>${storageFormatBytes(report.physicalObjectBytes)}</small></div>
        <div class="generation-progress-item"><span>Полностью совпали</span><strong>${Number(report.matchedObjectCount || 0)}</strong><small>SHA-256, размер и путь</small></div>
        <div class="generation-progress-item"><span>Проверено</span><strong>${sharedDocumentEscape(new Date(report.generatedAt).toLocaleString("ru-RU"))}</strong><small>${report.objectStorePresent ? "Каталог доступен" : "Каталог отсутствует"}</small></div>
      </div>
      ${issueRows ? `<div class="storage-candidate-list">${issueRows}</div>` : ""}
      ${Number(report.omittedDetailCount || 0) > 0 ? `<div class="generation-history-empty">Не показано подробностей: ${Number(report.omittedDetailCount)}. Общие счётчики включают все обнаруженные нарушения.</div>` : ""}
    </section>`;
}

async function runStorageReconciliation() {
  if (storageReconciliationBusy) return;
  const holder = document.querySelector("#storageReconciliationReport");
  const button = document.querySelector("#storageReconciliationRun");
  if (!holder || !button) return;
  storageReconciliationBusy = true;
  button.disabled = true;
  holder.innerHTML = `<div class="generation-history-empty">Вычисляем SHA-256 и сравниваем SQLite с файлами на диске…</div>`;
  try {
    const body = await sharedDocumentFetchJson(
      "/api/v1/storage/reconciliation?maxDetails=200"
    );
    renderStorageReconciliation(body.data);
  } catch (error) {
    holder.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Проверка целостности не завершена</strong><p>${sharedDocumentEscape(error?.message || "Повторите действие.")}</p></div></div>`;
  } finally {
    storageReconciliationBusy = false;
    button.disabled = false;
  }
}

function renderStorageCleanupPlan(plan) {
  const holder = document.querySelector("#storageCleanupPlan");
  if (!holder) return;
  if (plan.candidateCount === 0) {
    holder.innerHTML = `<div class="generation-state is-success"><span aria-hidden="true">✅</span><div><strong>Подходящих объектов нет</strong><p>Файлы с действующими ссылками и недавние объекты не затрагиваются.</p></div></div>`;
    return;
  }
  holder.innerHTML = `
    <section class="storage-cleanup-confirmation">
      <div class="generation-state is-warning">
        <span aria-hidden="true">⚠️</span>
        <div>
          <strong>Подготовлен пакет очистки: ${plan.candidateCount} объектов</strong>
          <p>Будет освобождено до ${storageFormatBytes(plan.candidateBytes)}. После этого останется кандидатов: ${plan.remainingCandidateCount} (${storageFormatBytes(plan.remainingCandidateBytes)}).</p>
        </div>
      </div>
      <div class="storage-candidate-list">
        ${plan.candidates
          .slice(0, 20)
          .map(
            (candidate) => `
              <article class="storage-candidate-row">
                <code>${sharedDocumentEscape(candidate.sha256.slice(0, 16))}…</code>
                <span>${storageFormatBytes(candidate.sizeBytes)}</span>
                <span>${sharedDocumentEscape(new Date(candidate.createdAt).toLocaleString("ru-RU"))}</span>
              </article>`
          )
          .join("")}
        ${plan.candidateCount > 20 ? `<div class="generation-history-empty">Показаны первые 20 объектов из ${plan.candidateCount}.</div>` : ""}
      </div>
      <div class="storage-cleanup-warning">
        <strong>Перед продолжением убедитесь, что резервная копия актуальна.</strong>
        <p>План действует только пока состав ссылок не изменился. При изменении данных сервер потребует новый расчёт.</p>
      </div>
      <button class="primary-button danger-button" id="storageCleanupExecute" type="button">Удалить пакет и освободить ${storageFormatBytes(plan.candidateBytes)}</button>
    </section>`;
  holder
    .querySelector("#storageCleanupExecute")
    ?.addEventListener("click", executeStorageCleanup);
}

async function previewStorageCleanup() {
  if (storageMaintenanceBusy) return;
  const holder = document.querySelector("#storageCleanupPlan");
  const button = document.querySelector("#storageCleanupPreview");
  if (!holder || !button) return;
  storageMaintenanceBusy = true;
  button.disabled = true;
  holder.innerHTML = `<div class="generation-history-empty">Проверяем все ссылки и формируем пакет…</div>`;
  try {
    const body = await sharedDocumentFetchJson(
      "/api/v1/storage/cleanup/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minimumAgeDays: storageMinimumAgeDays() })
      }
    );
    storageMaintenancePlan = body.data;
    renderStorageCleanupPlan(body.data);
  } catch (error) {
    holder.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>План не сформирован</strong><p>${sharedDocumentEscape(error?.message || "Повторите действие.")}</p></div></div>`;
  } finally {
    storageMaintenanceBusy = false;
    button.disabled = false;
  }
}

async function executeStorageCleanup() {
  if (storageMaintenanceBusy || !storageMaintenancePlan) return;
  if (
    !globalThis.confirm(
      `Физически удалить ${storageMaintenancePlan.candidateCount} объектов и освободить до ${storageFormatBytes(storageMaintenancePlan.candidateBytes)}? Отменить это действие нельзя.`
    )
  ) {
    return;
  }
  const holder = document.querySelector("#storageCleanupPlan");
  const button = document.querySelector("#storageCleanupExecute");
  if (!holder || !button) return;
  storageMaintenanceBusy = true;
  button.disabled = true;
  try {
    const body = await sharedDocumentFetchJson(
      "/api/v1/storage/cleanup/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cutoff: storageMaintenancePlan.cutoff,
          confirmationToken: storageMaintenancePlan.confirmationToken
        })
      }
    );
    const result = body.data;
    storageMaintenancePlan = null;
    holder.innerHTML = `
      <div class="generation-state ${result.failedCount > 0 ? "is-warning" : "is-success"}">
        <span aria-hidden="true">${result.failedCount > 0 ? "⚠️" : "✅"}</span>
        <div>
          <strong>Очистка завершена</strong>
          <p>Удалено: ${result.deletedCount}; освобождено: ${storageFormatBytes(result.deletedBytes)}; отсутствовало на диске: ${result.missingCount}; ошибок: ${result.failedCount}. Осталось кандидатов: ${result.remainingCandidateCount}.</p>
        </div>
      </div>
      ${result.remainingCandidateCount > 0 ? `<button class="secondary-button" id="storageCleanupContinue" type="button">Рассчитать следующий пакет</button>` : ""}`;
    holder
      .querySelector("#storageCleanupContinue")
      ?.addEventListener("click", previewStorageCleanup);
    await loadStorageUsage();
  } catch (error) {
    holder.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Очистка не выполнена</strong><p>${sharedDocumentEscape(error?.message || "Состав данных изменился. Выполните расчёт заново.")}</p></div></div>`;
    storageMaintenancePlan = null;
  } finally {
    storageMaintenanceBusy = false;
    button.disabled = false;
  }
}

if (sharedDocumentsView) {
  createStorageMaintenancePanel();
  document.querySelectorAll('[data-view-target="documents"]').forEach((button) =>
    button.addEventListener("click", () => void loadStorageUsage())
  );
}
