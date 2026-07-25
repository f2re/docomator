{
  const bulkV2MatchMeta = new Map();
  const bulkV2MemoryKey = "docomator.import.column-mappings.v2";
  const bulkV2SemanticGroups = [
    ["fio", ["фио", "фамилия имя отчество", "полное имя", "студент", "сотрудник", "обучающийся"]],
    ["personnel_number", ["табельный номер", "кадровый номер", "личный номер"]],
    ["student_number", ["номер зачетной книжки", "зачетная книжка", "номер студента", "student id"]],
    ["position", ["должность", "позиция", "профессия", "роль"]],
    ["department", ["подразделение", "отдел", "кафедра", "факультет", "институт"]],
    ["research_topic", ["тема научной работы", "тема работы", "тема вкр", "тема диплома", "тема диссертации", "научная тема"]],
    ["supervisor", ["научный руководитель", "руководитель", "научрук", "куратор"]],
    ["passport_series", ["серия паспорта", "паспорт серия"]],
    ["passport_number", ["номер паспорта", "паспорт номер"]],
    ["passport_issued_by", ["кем выдан паспорт", "орган выдачи паспорта", "паспорт выдан"]],
    ["passport_issue_date", ["дата выдачи паспорта", "паспорт дата выдачи"]],
    ["passport_department_code", ["код подразделения паспорта", "код подразделения"]],
    ["birth_date", ["дата рождения", "день рождения"]],
    ["registration_address", ["адрес регистрации", "прописка", "место регистрации"]],
    ["address", ["адрес проживания", "адрес"]],
    ["phone", ["телефон", "мобильный телефон", "номер телефона"]],
    ["email", ["электронная почта", "почта", "email", "e mail"]],
    ["snils", ["снилс"]],
    ["inn", ["инн"]],
    ["group", ["учебная группа", "группа", "поток"]],
    ["course", ["курс", "год обучения"]],
    ["status", ["статус", "состояние"]]
  ];

  function bulkV2Normalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/gu, "е")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/gu, " ");
  }

  function bulkV2Tokens(value) {
    return new Set(bulkV2Normalize(value).split(" ").filter((token) => token.length > 1));
  }

  function bulkV2SemanticKey(value) {
    const normalized = bulkV2Normalize(value);
    for (const [key, variants] of bulkV2SemanticGroups) {
      if (variants.some((variant) => {
        const candidate = bulkV2Normalize(variant);
        return normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized);
      })) return key;
    }
    return "";
  }

  function bulkV2Similarity(left, right) {
    const a = bulkV2Normalize(left);
    const b = bulkV2Normalize(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const semanticA = bulkV2SemanticKey(a);
    const semanticB = bulkV2SemanticKey(b);
    if (semanticA && semanticA === semanticB) return 0.96;
    if (a.includes(b) || b.includes(a)) return 0.84;
    const leftTokens = bulkV2Tokens(a);
    const rightTokens = bulkV2Tokens(b);
    const union = new Set([...leftTokens, ...rightTokens]);
    if (union.size === 0) return 0;
    const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    return intersection / union.size;
  }

  function bulkV2ReadMemory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(bulkV2MemoryKey) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function bulkV2WriteMemory(resolutions) {
    if (!Array.isArray(resolutions)) return;
    try {
      const memory = bulkV2ReadMemory();
      for (const item of resolutions) {
        if (!item?.column || !item?.propertyKey) continue;
        memory[bulkV2Normalize(item.column)] = {
          propertyKey: item.propertyKey,
          propertyLabel: item.propertyLabel,
          valueType: item.valueType,
          updatedAt: new Date().toISOString()
        };
      }
      localStorage.setItem(bulkV2MemoryKey, JSON.stringify(memory));
    } catch {
      // Локальная память сопоставлений является необязательной.
    }
  }

  function bulkV2ColumnValues(header) {
    if (!bulkImportPreview?.rows) return [];
    return bulkImportPreview.rows
      .map((row) => String(row[header] || "").normalize("NFKC").trim())
      .filter(Boolean);
  }

  function bulkV2UniqueValues(header, limit = 500) {
    const result = [];
    const seen = new Set();
    for (const value of bulkV2ColumnValues(header)) {
      const identity = bulkV2Normalize(value);
      if (!seen.has(identity)) {
        seen.add(identity);
        result.push(value);
      }
      if (result.length >= limit) break;
    }
    return result;
  }

  function bulkV2Sensitivity(header) {
    const semantic = bulkV2SemanticKey(header);
    if (["passport_series", "passport_number", "passport_issued_by", "passport_issue_date", "passport_department_code", "registration_address", "snils"].includes(semantic)) {
      return "restricted";
    }
    if (["birth_date", "address", "phone", "email", "inn", "personnel_number", "student_number"].includes(semantic)) {
      return "personal";
    }
    return "internal";
  }

  function bulkV2GuessValueType(header) {
    const normalized = bulkV2Normalize(header);
    const semantic = bulkV2SemanticKey(header);
    const values = bulkV2ColumnValues(header);
    if (["birth_date", "passport_issue_date"].includes(semantic) || /дата|день рождения/u.test(normalized)) return "date";
    if (/примечание|комментарий|описание|тема науч|тема работ|кем выдан/u.test(normalized)) return "text";
    if (/да нет|признак|активен|является/u.test(normalized)) return "boolean";
    if (/оклад|ставка|сумма|процент|коэффициент/u.test(normalized)) return "number";
    if (/количество|курс|стаж|номер кабинета/u.test(normalized)) return "integer";
    const booleanValues = new Set(["да", "нет", "true", "false", "1", "0", "+", "-"]);
    if (values.length > 0 && values.every((value) => booleanValues.has(bulkV2Normalize(value)))) return "boolean";
    if (values.length > 0 && values.every((value) => /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$|^\d{4}-\d{2}-\d{2}$/u.test(value))) return "date";
    if (values.length > 0 && values.every((value) => /^[-+]?\d+$/u.test(value.replace(/\s/gu, ""))) && !/[номер|паспорт|телефон|снилс|инн]/u.test(normalized)) return "integer";
    if (values.length > 0 && values.every((value) => /^[-+]?\d+(?:[.,]\d+)?$/u.test(value.replace(/\s/gu, ""))) && /сумма|ставка|оклад|процент|балл/u.test(normalized)) return "number";
    if (["position", "department", "group", "course", "status"].includes(semantic)) return "enum";
    const unique = bulkV2UniqueValues(header, 30);
    if (values.length >= 5 && unique.length <= 20 && unique.length / values.length <= 0.45) return "enum";
    return values.some((value) => value.length > 180) ? "text" : "string";
  }

  function bulkV2BestProperty(header) {
    const memory = bulkV2ReadMemory()[bulkV2Normalize(header)];
    if (memory?.propertyKey) {
      const remembered = bulkImportPersonProperties().find((property) => property.key === memory.propertyKey);
      if (remembered) return { property: remembered, score: 1, source: "remembered" };
    }
    let best = null;
    for (const property of bulkImportPersonProperties()) {
      const candidates = [property.label, ...(Array.isArray(property.aliases) ? property.aliases : [])];
      const score = Math.max(...candidates.map((candidate) => bulkV2Similarity(header, candidate)));
      if (!best || score > best.score) best = { property, score, source: score === 1 ? "exact" : "similar" };
    }
    return best && best.score >= 0.68 ? best : null;
  }

  bulkImportGuessProperty = function bulkImportGuessPropertyV2(header) {
    const match = bulkV2BestProperty(header);
    bulkV2MatchMeta.set(header, match || { property: null, score: 0, source: "new" });
    return match?.property || null;
  };

  bulkImportGuessValueType = bulkV2GuessValueType;

  function bulkV2TypeOptions(selected) {
    const options = [
      ["string", "Короткий текст"],
      ["text", "Длинный текст"],
      ["enum", "Список вариантов"],
      ["number", "Число"],
      ["integer", "Целое число"],
      ["boolean", "Да или нет"],
      ["date", "Дата"],
      ["date-time", "Дата и время"]
    ];
    return options.map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
  }

  function bulkV2SensitivityOptions(selected) {
    return [
      ["internal", "Рабочие сведения"],
      ["personal", "Персональные данные"],
      ["restricted", "Особо чувствительные данные"],
      ["public", "Открытые сведения"]
    ].map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
  }

  bulkImportMappingRow = function bulkImportMappingRowV2(header, index, identityColumn, displayNameColumn) {
    const guessed = bulkImportGuessProperty(header);
    const meta = bulkV2MatchMeta.get(header) || { score: 0 };
    const isDisplayName = header === displayNameColumn;
    const confident = guessed && meta.score >= 0.72;
    const mode = isDisplayName ? "skip" : confident ? `existing:${guessed.key}` : "create";
    const type = bulkV2GuessValueType(header);
    const sensitivity = bulkV2Sensitivity(header);
    const uniqueValues = type === "enum" ? bulkV2UniqueValues(header, 100) : [];
    const samples = bulkV2UniqueValues(header, 3);
    const confidence = isDisplayName
      ? '<span class="bulk-v2-confidence is-ready">ФИО</span>'
      : guessed
        ? `<span class="bulk-v2-confidence ${meta.score >= 0.9 ? "is-ready" : meta.score >= 0.72 ? "is-medium" : "is-review"}">${Math.round(meta.score * 100)}% совпадение</span>`
        : '<span class="bulk-v2-confidence is-review">Новое поле</span>';
    const note = isDisplayName
      ? "Используется как имя человека"
      : header === identityColumn
        ? "Устойчивый ключ для повторных импортов"
        : `Колонка ${index + 1}`;
    return `<article class="bulk-import-mapping-row bulk-v2-mapping-row" data-bulk-mapping-row data-column="${escapeHtml(header)}">
      <div class="bulk-import-column-name"><div><strong>${escapeHtml(header)}</strong>${confidence}</div><small>${escapeHtml(note)}</small>${samples.length ? `<small>Примеры: ${samples.map((value) => `«${escapeHtml(value)}»`).join(", ")}</small>` : ""}</div>
      <label><span>Куда перенести</span><select data-bulk-mapping-mode aria-label="Куда перенести колонку ${escapeHtml(header)}">
        <option value="skip"${mode === "skip" ? " selected" : ""}>Не переносить</option>
        <option value="create"${mode === "create" ? " selected" : ""}>Создать новое поле</option>
        ${bulkImportPropertyOptions(guessed?.key || "")}
      </select></label>
      <label data-bulk-create-field${mode === "create" ? "" : " hidden"}><span>Название поля</span><input data-bulk-property-label type="text" value="${escapeHtml(header)}" maxlength="300" /></label>
      <label data-bulk-create-field${mode === "create" ? "" : " hidden"}><span>Тип значения</span><select data-bulk-value-type>${bulkV2TypeOptions(type)}</select></label>
      <label data-bulk-create-field${mode === "create" ? "" : " hidden"}><span>Класс данных</span><select data-bulk-sensitivity>${bulkV2SensitivityOptions(sensitivity)}</select><small>${sensitivity === "restricted" ? "Доступ и журналы должны обрабатываться особенно осторожно." : "Класс используется для маскирования, журналирования и локальной обработки."}</small></label>
      <section class="bulk-v2-enum" data-bulk-enum-fields${mode === "create" && type === "enum" ? "" : " hidden"}>
        <label><span>Варианты выбора</span><textarea data-bulk-enum-values rows="4" placeholder="По одному варианту в строке">${escapeHtml(uniqueValues.join("\n"))}</textarea></label>
        <label class="operator-check"><input data-bulk-allow-custom type="checkbox" checked /><span>Разрешать новые значения и автоматически пополнять список</span></label>
      </section>
    </article>`;
  };

  updateBulkImportMappingVisibility = function updateBulkImportMappingVisibilityV2() {
    document.querySelectorAll("[data-bulk-mapping-row]").forEach((row) => {
      const mode = row.querySelector("[data-bulk-mapping-mode]")?.value || "skip";
      const type = row.querySelector("[data-bulk-value-type]")?.value || "string";
      row.querySelectorAll("[data-bulk-create-field]").forEach((field) => {
        field.hidden = mode !== "create";
      });
      const enumFields = row.querySelector("[data-bulk-enum-fields]");
      if (enumFields) enumFields.hidden = mode !== "create" || type !== "enum";
    });
    const group = document.querySelector("#bulkImportGroupFields");
    if (group) group.hidden = !document.querySelector("#bulkImportCreateGroup")?.checked;
  };

  collectBulkImportMappings = function collectBulkImportMappingsV2() {
    const mappings = [];
    document.querySelectorAll("[data-bulk-mapping-row]").forEach((row) => {
      const mode = row.querySelector("[data-bulk-mapping-mode]")?.value || "skip";
      if (mode === "skip") return;
      const column = row.dataset.column || "";
      if (mode.startsWith("existing:")) {
        mappings.push({ column, propertyKey: mode.slice("existing:".length), aliases: [column] });
        return;
      }
      const valueType = row.querySelector("[data-bulk-value-type]")?.value || "string";
      const mapping = {
        column,
        createIfMissing: true,
        label: row.querySelector("[data-bulk-property-label]")?.value.trim() || column,
        valueType,
        sensitivity: row.querySelector("[data-bulk-sensitivity]")?.value || "personal",
        aliases: [column]
      };
      if (valueType === "enum") {
        mapping.enumValues = String(row.querySelector("[data-bulk-enum-values]")?.value || "")
          .split(/[\n,;]+/u)
          .map((value) => value.normalize("NFKC").trim())
          .filter(Boolean);
        mapping.allowCustom = Boolean(row.querySelector("[data-bulk-allow-custom]")?.checked);
      }
      mappings.push(mapping);
    });
    return mappings;
  };

  function bulkV2IdentityGuess(preview, displayNameColumn) {
    const preferred = bulkImportGuessColumn(
      preview.headers,
      [/табел/u, /кадров/u, /зачет/u, /личн.*номер/u, /^id$/u, /email/u, /почт/u, /номер/u],
      ""
    );
    return preferred || displayNameColumn || preview.headers[0] || "";
  }

  renderBulkImportPreview = function renderBulkImportPreviewV2(preview) {
    const root = document.querySelector("#bulkImportPreview");
    if (!root) return;
    const displayNameColumn = bulkImportGuessColumn(
      preview.headers,
      [/фио/u, /полное.*имя/u, /студент/u, /сотрудник/u, /обучающ/u, /^имя$/u, /^name$/u],
      preview.headers[0]
    );
    const identityColumn = bulkV2IdentityGuess(preview, displayNameColumn);
    bulkV2MatchMeta.clear();
    const mappingHtml = preview.headers.map((header, index) => bulkImportMappingRow(header, index, identityColumn, displayNameColumn)).join("");
    const confidentCount = [...bulkV2MatchMeta.values()].filter((item) => item?.property && item.score >= 0.72).length;
    const identityWarning = identityColumn === displayNameColumn
      ? '<div class="bulk-v2-notice is-warning"><strong>ФИО используется как ключ повторного импорта</strong><p>Это допустимо для разовой загрузки. Для регулярного обновления добавьте табельный номер, номер зачётной книжки или рабочую почту.</p></div>'
      : "";
    const studentDetected = preview.headers.some((header) => bulkV2SemanticKey(header) === "research_topic");
    root.innerHTML = `<section class="bulk-import-config">
      <div class="bulk-import-file-summary"><strong>${escapeHtml(preview.fileName)}</strong><span>${preview.rowCount} строк · ${preview.columnCount} колонок</span></div>
      ${studentDetected ? '<div class="bulk-v2-notice is-ready"><strong>Распознан список студентов и научных работ</strong><p>ФИО станет карточкой человека, тема и руководитель — отдельными полями. Их можно сразу использовать в таблице Word.</p></div>' : ""}
      ${identityWarning}
      <div class="bulk-import-core-fields">
        <label class="generation-field"><span>Колонка с ФИО</span><select id="bulkImportDisplayNameColumn">${preview.headers.map((header) => `<option value="${escapeHtml(header)}"${header === displayNameColumn ? " selected" : ""}>${escapeHtml(header)}</option>`).join("")}</select><small>Это имя будет показано в карточке и списках.</small></label>
        <label class="generation-field"><span>Как узнавать прежнюю запись</span><select id="bulkImportIdentityColumn">${preview.headers.map((header) => `<option value="${escapeHtml(header)}"${header === identityColumn ? " selected" : ""}>${escapeHtml(header)}</option>`).join("")}</select><small>При следующей загрузке запись с тем же ключом будет обновлена, а не создана повторно.</small></label>
      </div>
      <div class="panel-heading compact-heading"><div><h3>Сопоставление колонок</h3><p>Система уверенно сопоставила ${confidentCount} колонок. Проверьте отмеченные как новые или неуверенные.</p></div><span class="operator-counter">${preview.headers.length} колонок</span></div>
      <div id="bulkImportMappings" class="bulk-import-mappings">${mappingHtml}</div>
      <label class="bulk-import-group-option"><input id="bulkImportCreateGroup" type="checkbox"${studentDetected ? " checked" : ""} /><span><strong>Собрать импортированных людей в группу</strong><small>Группа нужна для одного сводного документа и расписаний.</small></span></label>
      <div id="bulkImportGroupFields" class="bulk-import-group-fields"${studentDetected ? "" : " hidden"}><label class="generation-field"><span>Название группы</span><input id="bulkImportGroupName" type="text" maxlength="300" value="${studentDetected ? "Студенты — темы научных работ" : `Импорт от ${new Date().toLocaleDateString("ru-RU")}`}" /></label></div>
      <details class="bulk-import-source-preview"><summary>Посмотреть первые строки</summary><div class="bulk-import-table-wrap"><table class="bulk-import-table"><thead><tr>${preview.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${preview.sampleRows.slice(0, 10).map((row) => `<tr>${preview.headers.map((header) => `<td>${escapeHtml(row[header] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>
      <div id="bulkImportPlan" class="bulk-import-plan"><p>Нажмите «Проверить»: система выполнит полный импорт в транзакции и откатит его, чтобы показать точный результат без сохранения.</p></div>
      <div class="bulk-import-submit-row"><button class="primary-button" id="bulkImportPlanButton" type="button">Проверить ${preview.rowCount} строк</button><p>Пустые ячейки не стирают уже заполненные сведения.</p></div>
    </section>`;
    updateBulkImportMappingVisibility();
  };

  async function bulkV2PreviewBytes(fileName, bytes) {
    if (bulkImportBusy) return;
    const message = document.querySelector("#bulkImportMessage");
    if (!message) return;
    const spaceId = bulkImportCurrentSpaceId();
    if (!spaceId) {
      message.textContent = "Сначала выберите раздел данных.";
      return;
    }
    await loadBulkImportPropertyDefinitions();
    const requestSession = ++bulkImportSession;
    bulkImportSpaceId = spaceId;
    bulkImportPlanSpaceId = null;
    bulkImportBusy = true;
    bulkImportPlan = null;
    message.className = "bulk-import-message is-loading";
    message.textContent = "Разбираем вставленную таблицу и определяем поля…";
    try {
      const response = await fetch(`/api/v1/spaces/${encodeURIComponent(spaceId)}/data-import/preview?fileName=${encodeURIComponent(fileName)}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", accept: "application/json" },
        body: bytes
      });
      const body = await response.json();
      if (requestSession !== bulkImportSession || !bulkImportSpaceMatches(spaceId)) return;
      if (!response.ok) throw new Error(body?.error?.message || "Не удалось прочитать таблицу.");
      bulkImportPreview = body.data;
      message.className = "bulk-import-message is-success";
      message.textContent = `Таблица прочитана: ${body.data.rowCount} строк. Проверьте автоматическое сопоставление.`;
      renderBulkImportPreview(body.data);
      setBulkImportStep(2);
      document.querySelector("#bulkImportDisplayNameColumn")?.focus();
    } catch (error) {
      if (requestSession !== bulkImportSession) return;
      bulkImportPreview = null;
      bulkImportSpaceId = null;
      message.className = "bulk-import-message is-error";
      message.textContent = error instanceof Error ? error.message : "Не удалось прочитать таблицу.";
      const root = document.querySelector("#bulkImportPreview");
      if (root) root.innerHTML = "";
    } finally {
      if (requestSession === bulkImportSession) bulkImportBusy = false;
    }
  }

  function bulkV2SwitchSource(mode) {
    const fileBox = document.querySelector("#bulkV2FileSource");
    const pasteBox = document.querySelector("#bulkV2PasteSource");
    if (fileBox) fileBox.hidden = mode !== "file";
    if (pasteBox) pasteBox.hidden = mode !== "paste";
    document.querySelectorAll("[data-bulk-v2-source]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.bulkV2Source === mode);
      button.setAttribute("aria-pressed", String(button.dataset.bulkV2Source === mode));
    });
    (mode === "paste" ? document.querySelector("#bulkV2Paste") : document.querySelector("#bulkImportFile"))?.focus();
  }

  function bulkV2UpgradePanel() {
    const panel = document.querySelector("#bulkDataImportPanel");
    if (!panel || panel.dataset.bulkV2 === "true") return;
    panel.dataset.bulkV2 = "true";
    const title = panel.querySelector(".panel-heading h2");
    const description = panel.querySelector(".panel-heading p:last-child");
    if (title) title.textContent = "Импортировать людей и заполненные поля";
    if (description) description.textContent = "Загрузите Excel/CSV или вставьте таблицу. Система предложит сопоставление, типы и классы данных; оператор только проверит.";
    const upload = panel.querySelector(".bulk-import-upload");
    if (upload) {
      upload.innerHTML = `<div class="bulk-v2-source-tabs" role="group" aria-label="Источник данных"><button class="secondary-button is-active" type="button" data-bulk-v2-source="file" aria-pressed="true">Файл CSV или XLSX</button><button class="secondary-button" type="button" data-bulk-v2-source="paste" aria-pressed="false">Вставить из Excel</button></div>
        <section id="bulkV2FileSource"><label class="generation-field"><span>Таблица с людьми и данными</span><input id="bulkImportFile" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /><small>До 8 МБ, 100 колонок и 1000 строк. В XLSX используется первый рабочий лист.</small></label><button class="primary-button" id="bulkImportPreviewButton" type="button">Прочитать файл</button></section>
        <section id="bulkV2PasteSource" hidden><label class="generation-field"><span>Вставьте диапазон вместе с заголовками</span><textarea id="bulkV2Paste" rows="10" placeholder="ФИО&#9;Номер зачётной книжки&#9;Тема научной работы&#9;Научный руководитель"></textarea><small>Скопируйте диапазон из Excel или LibreOffice. Первая строка должна содержать названия колонок.</small></label><div class="bulk-v2-paste-actions"><button class="secondary-button" id="bulkV2StudentExample" type="button">Пример: студенты и темы</button><button class="primary-button" id="bulkV2PastePreview" type="button">Разобрать таблицу</button></div></section>`;
      upload.querySelector("#bulkImportPreviewButton")?.addEventListener("click", previewBulkImportFile);
      upload.querySelectorAll("[data-bulk-v2-source]").forEach((button) => button.addEventListener("click", () => bulkV2SwitchSource(button.dataset.bulkV2Source)));
      upload.querySelector("#bulkV2StudentExample")?.addEventListener("click", () => {
        const textarea = document.querySelector("#bulkV2Paste");
        textarea.value = "ФИО\tНомер зачётной книжки\tУчебная группа\tТема научной работы\tНаучный руководитель\nИванов Иван Иванович\tЗК-001\tМ-21\tОценка точности краткосрочного прогноза осадков\tПетров Пётр Петрович\nСмирнова Анна Сергеевна\tЗК-002\tМ-21\tАвтоматизация обработки данных радиозондирования\tСидорова Мария Андреевна";
        textarea.focus();
      });
      upload.querySelector("#bulkV2PastePreview")?.addEventListener("click", () => {
        const text = document.querySelector("#bulkV2Paste")?.value || "";
        if (!text.trim()) {
          const message = document.querySelector("#bulkImportMessage");
          if (message) message.textContent = "Вставьте таблицу вместе со строкой заголовков.";
          return;
        }
        void bulkV2PreviewBytes("Вставленная таблица.csv", new Blob([text], { type: "text/csv;charset=utf-8" }));
      });
    }
    panel.addEventListener("change", (event) => {
      if (event.target.matches("[data-bulk-value-type]")) updateBulkImportMappingVisibility();
      if (event.target.matches("[data-bulk-sensitivity], [data-bulk-allow-custom]")) invalidateBulkImportPlan();
    });
    panel.addEventListener("input", (event) => {
      if (event.target.matches("[data-bulk-enum-values]")) invalidateBulkImportPlan();
    });
  }

  const bulkV2BaseCreatePanel = createBulkImportPanel;
  createBulkImportPanel = function createBulkImportPanelV2() {
    bulkV2BaseCreatePanel();
    bulkV2UpgradePanel();
  };

  const bulkV2BaseApi = bulkImportApi;
  bulkImportApi = async function bulkImportApiV2(url, options = {}) {
    const body = await bulkV2BaseApi(url, options);
    if (url.endsWith("/data-import/execute")) {
      bulkV2WriteMemory(body?.data?.mappingResolutions);
    }
    return body;
  };

  bulkV2UpgradePanel();
}
