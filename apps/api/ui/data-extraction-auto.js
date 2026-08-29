(() => {
  let sequence = 0;

  function correlationId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `extract-proposal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function supportedFile(file) {
    if (!file) return false;
    const lower = String(file.name || "").toLowerCase();
    return (lower.endsWith(".docx") || lower.endsWith(".xlsx")) && file.size > 0;
  }

  function setStatus(kind, title, detail) {
    const target = document.querySelector("#dataExtractionStatus");
    if (!target) return;
    target.className = `extraction-status is-${kind}`;
    const mark = document.createElement("span");
    mark.className = "extraction-status-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = kind === "error" ? "!" : kind === "ok" ? "✓" : "…";
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = title;
    copy.append(heading);
    if (detail) {
      const paragraph = document.createElement("p");
      paragraph.textContent = detail;
      copy.append(paragraph);
    }
    target.replaceChildren(mark, copy);
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function updateCopy() {
    const heading = document.querySelector("#extraction-template-title");
    setText(heading, "Проверьте найденную структуру");
    setText(
      heading?.parentElement?.querySelector("p:last-child"),
      "Система сначала сама ищет таблицы и пары «поле — значение». Исправляйте только то, что определено неверно."
    );
    setText(
      document.querySelector(".extraction-intro p:last-child"),
      "Загрузите DOCX или XLSX: система предложит структуру данных автоматически, а затем применит подтверждённую схему к пачке похожих документов."
    );
    const step = document.querySelector('[data-extraction-step="1"]');
    setText(step?.querySelector("strong"), "Авторазбор");
    setText(step?.querySelector("small"), "Проверьте предложение");
    setText(document.querySelector("#extractionAnalyzeSample"), "Разобрать заново");
    setText(
      document.querySelector("#extractionSampleDrop label strong"),
      "Перетащите образец или выберите файл — система разберёт его сама"
    );
    setText(
      document.querySelector("#extractionSampleDrop label small"),
      "DOCX/XLSX до 32 МБ. Анализ ничего не записывает в рабочие данные."
    );
  }

  function waitForPreview(token) {
    return new Promise((resolve, reject) => {
      const ready = () => {
        if (token !== sequence) return false;
        const grid = document.querySelector("#extractionTemplateGrid");
        return Boolean(grid && !grid.hasAttribute("hidden") && grid.querySelector("[data-extraction-element]"));
      };
      if (ready()) {
        resolve();
        return;
      }
      let timer;
      const observer = new MutationObserver(() => {
        if (!ready()) return;
        observer.disconnect();
        if (timer) clearTimeout(timer);
        resolve();
      });
      if (document.body) observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error("Визуальное представление образца не было подготовлено."));
      }, 15_000);
    });
  }

  function dispatchValue(control, value, eventName) {
    if (!control || value === undefined || value === null) return;
    control.value = String(value);
    control.dispatchEvent(new Event(eventName, { bubbles: true }));
  }

  function selectCandidate(candidate, role) {
    const id = String(candidate?.elementId || "");
    if (!id) return false;
    const sourceButton = document.querySelector(`[data-extraction-element="${CSS.escape(id)}"]`);
    if (!sourceButton) return false;
    if (!sourceButton.classList.contains("is-selected")) sourceButton.click();
    const card = document.querySelector(`[data-assignment-id="${CSS.escape(id)}"]`);
    if (!card) return false;

    dispatchValue(card.querySelector("[data-assignment-label]"), candidate.label, "input");
    dispatchValue(card.querySelector("[data-assignment-type]"), candidate.outputType || "text", "change");
    dispatchValue(card.querySelector("[data-assignment-role]"), role, "change");
    return true;
  }

  function decorateCandidate(candidate) {
    const id = String(candidate?.elementId || "");
    if (!id) return;
    const card = document.querySelector(`[data-assignment-id="${CSS.escape(id)}"]`);
    const header = card?.querySelector(".extraction-assignment-heading");
    if (!header || header.querySelector("[data-extraction-auto-badge]")) return;
    const badge = document.createElement("span");
    badge.className = "pill";
    badge.dataset.extractionAutoBadge = "";
    const confidence = Math.round(Number(candidate.confidence || 0) * 100);
    badge.textContent = confidence > 0 ? `Найдено автоматически · ${confidence}%` : "Найдено автоматически";
    header.append(badge);
  }

  function applyProposal(proposal) {
    const applied = [];
    for (const field of Array.isArray(proposal?.fields) ? proposal.fields : []) {
      if (selectCandidate(field, "field")) applied.push(field);
    }
    for (const column of Array.isArray(proposal?.repeat?.columns) ? proposal.repeat.columns : []) {
      if (selectCandidate(column, "repeat")) applied.push(column);
    }
    // Каждый новый выбор перерисовывает весь список assignments. Декорируем только
    // после завершения всех выборов, иначе следующий render удалит предыдущий badge.
    for (const candidate of applied) decorateCandidate(candidate);
    return applied.length;
  }

  async function requestProposal(file, token) {
    const query = new URLSearchParams({ fileName: file.name, limit: "2000" });
    const response = await fetch(`/api/v1/data-extraction/propose?${query}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": file.type || "application/octet-stream",
        "x-correlation-id": correlationId(),
        "x-actor-id": "local-ui"
      },
      body: file
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message || `Сервер вернул код ${response.status}.`);
    if (token !== sequence) return null;
    return body?.data?.proposal ?? null;
  }

  async function analyzeAutomatically(file) {
    if (!supportedFile(file)) return;
    const token = ++sequence;
    setStatus(
      "busy",
      "Разбираем документ автоматически",
      "Ищем безопасные структурные закономерности. Исходный файл и рабочие данные не изменяются."
    );
    document.querySelector("#extractionAnalyzeSample")?.click();
    try {
      const [proposal] = await Promise.all([requestProposal(file, token), waitForPreview(token)]);
      if (token !== sequence || proposal === null) return;
      const applied = applyProposal(proposal);
      const warnings = Array.isArray(proposal.warnings) ? proposal.warnings : [];
      if (applied === 0) {
        setStatus(
          "idle",
          "Нужна короткая проверка вручную",
          warnings[0] || "Надёжную структуру определить не удалось. Выберите нужные места в документе; ничего не потеряно."
        );
        return;
      }
      const confidence = Math.round(Number(proposal.confidence || 0) * 100);
      const detail = warnings[0]
        ? `${warnings[0]} Проверьте предложенные поля и сохраните схему только после проверки.`
        : `Предложено ${applied} полей${confidence > 0 ? `, общая уверенность ${confidence}%` : ""}. Проверьте их; при необходимости измените название, тип или способ сбора.`;
      setStatus("ok", "Структура предложена автоматически", detail);
    } catch (error) {
      if (token !== sequence || document.querySelector("#dataExtractionStatus")?.classList.contains("is-error")) return;
      setStatus(
        "idle",
        "Авторазбор не завершён",
        `${error.message} Исходный файл не изменён. Можно продолжить ручным выбором в уже показанном документе.`
      );
    }
  }

  function firstSupported(files) {
    return [...(files || [])].find(supportedFile) || null;
  }

  function attach() {
    updateCopy();
    document.addEventListener("change", (event) => {
      if (event.target?.id !== "extractionSampleFile") return;
      const file = firstSupported(event.target.files);
      if (file) setTimeout(() => void analyzeAutomatically(file), 0);
    });
    document.addEventListener("drop", (event) => {
      if (!event.target?.closest?.("#extractionSampleDrop")) return;
      const file = firstSupported(event.dataTransfer?.files);
      if (file) setTimeout(() => void analyzeAutomatically(file), 0);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach, { once: true });
  else attach();
})();
