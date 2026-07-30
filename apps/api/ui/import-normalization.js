{
  const importNormalizationState = {
    employee: {
      identityCaseInsensitive: true,
      displayCase: "name",
      splitName: false,
      nameOrder: "family-given-patronymic",
      mappingCases: new Map()
    },
    generic: {
      identityCaseInsensitive: true,
      displayCase: "preserve",
      splitName: false,
      nameOrder: "family-given-patronymic",
      mappingCases: new Map()
    }
  };

  function importNormalizationContext() {
    if (document.querySelector("#entityImportDialog")?.open) return "generic";
    return "employee";
  }

  function importNormalizationEscape(value) {
    return String(value ?? "").replace(/[&<>'"]/gu, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]);
  }

  function importNormalizationCaseOptions(selected) {
    return [
      ["preserve", "Сохранить исходный регистр"],
      ["name", "Иванов Иван Иванович"],
      ["title", "Каждое Слово С Заглавной"],
      ["lower", "строчные буквы"],
      ["upper", "ПРОПИСНЫЕ БУКВЫ"]
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`
      )
      .join("");
  }

  function importNormalizationPanel(context) {
    const current = importNormalizationState[context];
    const person = context === "employee" ||
      globalThis.docomatorSelectedEntityTypeKey === "person";
    return `<section class="import-normalization-panel" data-import-normalization-panel="${context}">
      <div class="panel-heading compact-heading"><div><h3>Нормализация значений</h3><p>Пустая ячейка остаётся в своей колонке. Здесь задаётся только обработка текста, без удаления и сдвига значений.</p></div></div>
      <div class="import-normalization-grid">
        <label class="structure-required-field"><input type="checkbox" data-import-identity-ignore-case${current.identityCaseInsensitive ? " checked" : ""} /><span><strong>Не учитывать регистр идентификатора</strong><small>ROOM-101 и room-101 считаются одним объектом. При неоднозначности импорт остановит строку.</small></span></label>
        <label class="generation-field"><span>Регистр отображаемого названия</span><select data-import-display-case>${importNormalizationCaseOptions(current.displayCase)}</select><small>Значение очищается от лишних пробелов и Unicode-вариантов.</small></label>
        ${person ? `<label class="structure-required-field"><input type="checkbox" data-import-split-name${current.splitName ? " checked" : ""} /><span><strong>Разделить ФИО на отдельные поля</strong><small>Будут созданы или переиспользованы поля «Фамилия», «Имя» и «Отчество».</small></span></label><label class="generation-field" data-import-name-order-field${current.splitName ? "" : " hidden"}><span>Порядок частей в исходной колонке</span><select data-import-name-order><option value="family-given-patronymic"${current.nameOrder === "family-given-patronymic" ? " selected" : ""}>Фамилия Имя Отчество</option><option value="given-patronymic-family"${current.nameOrder === "given-patronymic-family" ? " selected" : ""}>Имя Отчество Фамилия</option></select><small>Для двух частей отчество остаётся пустым.</small></label>` : ""}
      </div>
    </section>`;
  }

  function importNormalizationFindWorkspace(context) {
    if (context === "generic") return document.querySelector("#entityImportWorkspace");
    return (
      document.querySelector("#bulkImportWorkspace") ||
      document.querySelector("#bulkDataImportWorkspace") ||
      document.querySelector("[data-bulk-import-workspace]")
    );
  }

  function importNormalizationColumn(row) {
    return (
      row.dataset.column ||
      row.dataset.importColumn ||
      row.dataset.bulkImportColumn ||
      row.querySelector("[data-column]")?.dataset.column ||
      row.querySelector(".bulk-import-column-name strong")?.textContent?.trim() ||
      ""
    );
  }

  function importNormalizationMappingRows(root) {
    return [
      ...root.querySelectorAll(
        "[data-entity-import-mapping], [data-bulk-import-mapping], [data-import-mapping], .bulk-import-mapping-row"
      )
    ].filter((row, index, rows) => rows.indexOf(row) === index);
  }

  function importNormalizationEnhanceMappings(context, root) {
    const state = importNormalizationState[context];
    for (const row of importNormalizationMappingRows(root)) {
      if (row.querySelector("[data-import-cell-case]")) continue;
      const column = importNormalizationColumn(row);
      if (!column) continue;
      const selected = state.mappingCases.get(column) || "preserve";
      const field = document.createElement("label");
      field.className = "generation-field import-normalization-mapping-field";
      field.innerHTML = `<span>Регистр текста</span><select data-import-cell-case data-import-column="${importNormalizationEscape(column)}">${importNormalizationCaseOptions(selected)}</select><small>Числа, даты, логические значения и пустые ячейки не изменяются.</small>`;
      row.append(field);
    }
  }

  function importNormalizationEnhance(context) {
    const root = importNormalizationFindWorkspace(context);
    if (!root || !root.children.length) return;
    if (!root.querySelector(`[data-import-normalization-panel="${context}"]`)) {
      const anchor =
        root.querySelector(".bulk-import-core-fields") ||
        root.querySelector(".bulk-import-file-summary") ||
        root.firstElementChild;
      anchor?.insertAdjacentHTML("afterend", importNormalizationPanel(context));
    }
    importNormalizationEnhanceMappings(context, root);
  }

  function importNormalizationRemember(event) {
    const panel = event.target.closest("[data-import-normalization-panel]");
    const context = panel?.dataset.importNormalizationPanel ||
      (event.target.closest("#entityImportDialog") ? "generic" : "employee");
    const state = importNormalizationState[context];
    if (!state) return;
    if (event.target.matches("[data-import-identity-ignore-case]")) {
      state.identityCaseInsensitive = event.target.checked;
    }
    if (event.target.matches("[data-import-display-case]")) {
      state.displayCase = event.target.value;
    }
    if (event.target.matches("[data-import-split-name]")) {
      state.splitName = event.target.checked;
      const order = panel?.querySelector("[data-import-name-order-field]");
      if (order) order.hidden = !event.target.checked;
    }
    if (event.target.matches("[data-import-name-order]")) {
      state.nameOrder = event.target.value;
    }
    if (event.target.matches("[data-import-cell-case]")) {
      state.mappingCases.set(event.target.dataset.importColumn, event.target.value);
    }
  }

  function importNormalizationPayload(payload, context) {
    const state = importNormalizationState[context];
    if (!payload || !state) return payload;
    const result = structuredClone(payload);
    result.identityCaseInsensitive = state.identityCaseInsensitive;
    result.identityNormalization = {
      unicode: "NFKC",
      trim: true,
      collapseWhitespace: true,
      case: "preserve"
    };
    result.displayNameNormalization = {
      unicode: "NFKC",
      trim: true,
      collapseWhitespace: true,
      case: state.displayCase
    };
    if (Array.isArray(result.mappings)) {
      result.mappings = result.mappings.map((mapping) => ({
        ...mapping,
        normalization: {
          unicode: "NFKC",
          trim: true,
          collapseWhitespace: true,
          case: state.mappingCases.get(mapping.column) || "preserve"
        }
      }));
    }
    const person = context === "employee" || result.entityTypeKey === "person";
    if (person && state.splitName) {
      result.personNameSplit = {
        enabled: true,
        sourceColumn: result.displayNameColumn,
        order: state.nameOrder,
        normalization: {
          unicode: "NFKC",
          trim: true,
          collapseWhitespace: true,
          case: "name"
        }
      };
      result.displayNameNormalization.case = "name";
    }
    return result;
  }

  const importNormalizationFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = function normalizedImportFetch(input, init = {}) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input?.url || "";
    if (
      /\/data-import\/(?:plan|execute)(?:\?|$)/u.test(url) &&
      typeof init.body === "string" &&
      /application\/json/iu.test(String(new Headers(init.headers).get("content-type") || ""))
    ) {
      try {
        const context = document.querySelector("#entityImportDialog")?.open
          ? "generic"
          : "employee";
        init = {
          ...init,
          body: JSON.stringify(
            importNormalizationPayload(JSON.parse(init.body), context)
          )
        };
      } catch {
        // The original request remains untouched and the server returns its normal validation error.
      }
    }
    return importNormalizationFetch(input, init);
  };

  const observer = new MutationObserver(() => {
    importNormalizationEnhance("employee");
    importNormalizationEnhance("generic");
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("change", importNormalizationRemember);
  document.addEventListener("input", importNormalizationRemember);
  importNormalizationEnhance("employee");
  importNormalizationEnhance("generic");
}
