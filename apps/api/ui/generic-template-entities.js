{
  let genericTemplateEntityTypes = [];
  let genericTemplateEntityTypeKey = "person";

  function genericTemplateSpaceId() {
    return String(
      globalThis.docomatorTemplateWizard?.spaceId?.() ||
        globalThis.docomatorCurrentSpaceId ||
        ""
    );
  }

  function genericTemplateTypeStorageKey() {
    return `docomator.template-entity-type:${genericTemplateSpaceId() || "default"}`;
  }

  function genericTemplateType() {
    return (
      genericTemplateEntityTypes.find(
        (type) => type.key === genericTemplateEntityTypeKey
      ) || null
    );
  }

  function genericTemplateIsPerson() {
    return genericTemplateEntityTypeKey === "person";
  }

  function genericTemplatePublishType() {
    globalThis.docomatorTemplateEntityTypeKey = genericTemplateEntityTypeKey;
    localStorage.setItem(
      genericTemplateTypeStorageKey(),
      genericTemplateEntityTypeKey
    );
    const system = structureSystemPropertyDefinitions[0];
    if (system) {
      system.label = genericTemplateIsPerson()
        ? "ФИО сотрудника"
        : "Название объекта";
      system.appliesTo = [genericTemplateEntityTypeKey];
    }
  }

  function genericTemplateSelectOptions(selected) {
    return genericTemplateEntityTypes
      .map(
        (type) =>
          `<option value="${structureEscape(type.key)}"${type.key === selected ? " selected" : ""}>${structureEscape(type.label)}</option>`
      )
      .join("");
  }

  loadStructurePropertyDefinitions = async function loadGenericStructureDefinitions() {
    const [types, properties] = await Promise.all([
      structureFetchJson("/api/v1/knowledge/entity-types?limit=500"),
      structureFetchJson("/api/v1/knowledge/property-definitions?limit=500")
    ]);
    genericTemplateEntityTypes = Array.isArray(types.data) ? types.data : [];
    structurePropertyDefinitions = Array.isArray(properties.data)
      ? properties.data
      : [];
    const stored = localStorage.getItem(genericTemplateTypeStorageKey()) || "";
    const candidates = [
      globalThis.docomatorSelectedEntityTypeKey,
      stored,
      genericTemplateEntityTypeKey,
      "person",
      genericTemplateEntityTypes[0]?.key
    ].filter(Boolean);
    genericTemplateEntityTypeKey =
      candidates.find((key) =>
        genericTemplateEntityTypes.some((type) => type.key === key)
      ) || "person";
    genericTemplatePublishType();
  };

  structurePropertyOptions = function genericStructurePropertyOptions(
    selectedGroup = "common"
  ) {
    const person = genericTemplateIsPerson();
    const applicable = structurePropertyDefinitions
      .filter((definition) => {
        const appliesTo = Array.isArray(definition.appliesTo)
          ? definition.appliesTo
          : [];
        return (
          appliesTo.length === 0 ||
          appliesTo.includes(genericTemplateEntityTypeKey)
        );
      })
      .filter(
        (definition) =>
          !person ||
          globalThis.docomatorFieldGroups.allowed(
            definition,
            selectedGroup,
            { includeUnassigned: true, includeAll: true }
          )
      );
    const options = [
      '<optgroup label="Системные значения">',
      person
        ? '<option value="__system_display_name__" data-search-terms="фио имя фамилия инициалы">ФИО участника · с выбором варианта записи</option>'
        : '<option value="__system_display_name__" data-search-terms="название наименование заголовок имя объекта">Название объекта</option>',
      "</optgroup>"
    ];
    if (person) {
      const grouped = globalThis.docomatorFieldGroups.grouped(
        applicable,
        selectedGroup,
        { includeUnassigned: true, includeAll: true }
      );
      const order = [
        ...new Set([
          selectedGroup,
          "common",
          ...globalThis.docomatorFieldGroups.definitions.map((item) => item.key),
          "unassigned"
        ])
      ];
      options.push(
        ...order
          .filter((group) => grouped.get(group)?.length)
          .map(
            (group) =>
              `<optgroup label="${structureEscape(globalThis.docomatorFieldGroups.label(group))}">${grouped
                .get(group)
                .map(
                  (definition) =>
                    `<option value="${structureEscape(definition.key)}" data-search-terms="${structureEscape(`${definition.label} ${(definition.aliases || []).join(" ")}`)}">${structureEscape(definition.label)} · ${structureEscape(structureFieldTypeLabel(definition.valueType))}</option>`
                )
                .join("")}</optgroup>`
          )
      );
    } else if (applicable.length) {
      options.push(
        `<optgroup label="Поля типа «${structureEscape(genericTemplateType()?.label || genericTemplateEntityTypeKey)}»">${applicable
          .map(
            (definition) =>
              `<option value="${structureEscape(definition.key)}" data-search-terms="${structureEscape(`${definition.label} ${(definition.aliases || []).join(" ")}`)}">${structureEscape(definition.label)} · ${structureEscape(structureFieldTypeLabel(definition.valueType))}</option>`
          )
          .join("")}</optgroup>`
      );
    }
    options.push(
      `<optgroup label="Действия"><option value="__new__">Создать новое поле для типа «${structureEscape(genericTemplateType()?.label || genericTemplateEntityTypeKey)}»…</option></optgroup>`
    );
    return options.join("");
  };

  const genericTemplateBaseFetch = structureFetchJson;
  structureFetchJson = async function genericTemplateFetch(url, options = {}) {
    if (
      url === "/api/v1/knowledge/property-definitions" &&
      options.method === "POST" &&
      typeof options.body === "string"
    ) {
      const payload = JSON.parse(options.body);
      payload.appliesTo = [genericTemplateEntityTypeKey];
      payload.sensitivity = genericTemplateIsPerson()
        ? payload.sensitivity || "personal"
        : "internal";
      payload.validation = genericTemplateIsPerson()
        ? {
            ...(payload.validation || {}),
            uiGroup: payload.validation?.uiGroup || "common"
          }
        : { ...(payload.validation || {}) };
      options = { ...options, body: JSON.stringify(payload) };
    }
    return genericTemplateBaseFetch(url, options);
  };

  const genericTemplateBasePersonName = structureSelectedPersonName;
  structureSelectedPersonName = function genericSelectedPersonName(
    form = document
  ) {
    return genericTemplateIsPerson()
      ? genericTemplateBasePersonName(form)
      : null;
  };

  const genericTemplateBaseFormatter = renderStructureFormatterFields;
  renderStructureFormatterFields = function renderGenericStructureFormatter() {
    genericTemplateBaseFormatter();
    if (genericTemplateIsPerson()) return;
    const presentation = document.querySelector(
      "#documentFieldTextPresentation"
    );
    if (!presentation) return;
    presentation.querySelector('optgroup[label="Варианты ФИО"]')?.remove();
    presentation.value = "identity";
    const label = presentation.closest("label");
    const hint = label?.querySelector("small");
    if (hint) {
      hint.textContent =
        "Для произвольных объектов текст подставляется без преобразования ФИО.";
    }
    document
      .querySelector("#documentFieldNameOptions")
      ?.setAttribute("hidden", "");
    structureNamePreview();
  };

  const genericTemplateBaseBlockReason = structureFieldBlockReason;
  structureFieldBlockReason = function genericStructureFieldBlockReason(form) {
    const reason = genericTemplateBaseBlockReason(form);
    if (genericTemplateIsPerson()) return reason;
    return reason
      .replace(/карточкам сотрудников/gu, "карточкам объектов выбранного типа")
      .replace(/поле сотрудника/gu, "поле объекта")
      .replace(/сотрудника/gu, "объекта");
  };

  const genericTemplateBaseRepeatControl = structureRepeatRowControl;
  structureRepeatRowControl = function genericStructureRepeatControl(element) {
    const control = genericTemplateBaseRepeatControl(element);
    if (genericTemplateIsPerson()) return control;
    return control
      .replace(/для сотрудников/gu, "для объектов")
      .replace(/для каждого сотрудника/gu, "для каждого объекта")
      .replace(/для каждого участника/gu, "для каждого объекта");
  };

  function genericTemplateAdaptSelection() {
    const form = document.querySelector("#documentFieldForm");
    if (!form) return;
    const grid = form.querySelector(".structure-field-grid");
    if (!grid) return;
    let field = form.querySelector("#documentEntityTypeField");
    if (!field) {
      field = document.createElement("label");
      field.id = "documentEntityTypeField";
      field.innerHTML = `
        <span>Какие объекты заполняют этот шаблон?</span>
        <select id="documentEntityType" data-searchable-select data-searchable-placeholder="Выберите тип" data-searchable-search-placeholder="Найти тип">${genericTemplateSelectOptions(genericTemplateEntityTypeKey)}</select>
        <small>Показываются поля выбранного типа. Пространство остаётся границей данных.</small>`;
      const groupField = form
        .querySelector("#documentFieldGroup")
        ?.closest("label");
      grid.insertBefore(field, groupField || grid.firstChild);
      field
        .querySelector("#documentEntityType")
        ?.addEventListener("change", (event) => {
          genericTemplateEntityTypeKey = event.target.value;
          genericTemplatePublishType();
          refreshStructurePropertySelector();
          genericTemplateAdaptSelection();
        });
      globalThis.docomatorSearchableSelect?.enhance(
        field.querySelector("#documentEntityType")
      );
    } else {
      const select = field.querySelector("#documentEntityType");
      select.innerHTML = genericTemplateSelectOptions(
        genericTemplateEntityTypeKey
      );
      select.value = genericTemplateEntityTypeKey;
      globalThis.docomatorSearchableSelect?.refresh(select);
    }
    const groupField = form
      .querySelector("#documentFieldGroup")
      ?.closest("label");
    if (groupField) {
      groupField.hidden = !genericTemplateIsPerson();
      const hint = groupField.querySelector("small");
      if (hint && genericTemplateIsPerson()) {
        hint.textContent =
          "Раздел поднимает подходящие поля выше списка. Остальные поля текущего пространства остаются доступны.";
      }
      if (!genericTemplateIsPerson()) {
        form.querySelector("#documentFieldGroup").value = "common";
      }
    }
    const confirmation = form.querySelector(
      "#documentNewPropertyFields .structure-required-field span"
    );
    if (confirmation) {
      confirmation.innerHTML = genericTemplateIsPerson()
        ? "<strong>Добавить поле всем сотрудникам</strong><small>Поле появится в карточках и будет доступно другим шаблонам.</small>"
        : `<strong>Добавить поле объектам типа «${structureEscape(genericTemplateType()?.label || genericTemplateEntityTypeKey)}»</strong><small>Поле станет доступно другим шаблонам этого типа.</small>`;
    }
    const selectorLabel = form
      .querySelector("#documentFieldProperty")
      ?.closest("label")
      ?.querySelector("span");
    if (selectorLabel) {
      selectorLabel.textContent = genericTemplateIsPerson()
        ? "Какое поле поставить сюда?"
        : "Какое поле объекта поставить сюда?";
    }
    const selectorHint = form
      .querySelector("#documentFieldProperty")
      ?.closest("label")
      ?.querySelector("small");
    if (selectorHint) {
      selectorHint.textContent = genericTemplateIsPerson()
        ? "Доступны все поля сотрудников текущего пространства. Для ФИО можно выбрать формат записи."
        : `Доступны системное название и поля типа «${genericTemplateType()?.label || genericTemplateEntityTypeKey}».`;
    }
    renderStructureFormatterFields();
  }

  const genericTemplateBaseRenderSelection = renderStructureSelection;
  renderStructureSelection = function renderSelectionForGenericEntity(element) {
    genericTemplateBaseRenderSelection(element);
    genericTemplateAdaptSelection();
  };

  function genericTemplateAdaptStaticText() {
    const panel = document.querySelector("#documentStructurePanel");
    const intro = panel?.querySelector(".panel-heading p:not(.eyebrow)");
    if (intro) {
      intro.textContent =
        "Система покажет текст и ячейки документа. Нажмите на нужное место, выберите тип объектов и его поле.";
    }
  }

  document.addEventListener("docomator:space-changed", () => {
    genericTemplateEntityTypeKey = "person";
    genericTemplatePublishType();
    void loadStructurePropertyDefinitions()
      .then(() => refreshStructurePropertySelector())
      .catch((error) => {
        console.error("Не удалось обновить поля шаблона после смены пространства.", error);
      });
  });
  genericTemplatePublishType();
  genericTemplateAdaptStaticText();
}
