{
  let genericGenerationAllEntities = [];
  let genericGenerationTypeKey = "";

  function genericGenerationTypes() {
    const byKey = new Map();
    for (const entity of genericGenerationAllEntities) {
      if (!byKey.has(entity.entityTypeKey)) {
        byKey.set(entity.entityTypeKey, {
          key: entity.entityTypeKey,
          label: entity.entityTypeLabel || entity.entityTypeKey
        });
      }
    }
    return [...byKey.values()].sort((left, right) =>
      left.label.localeCompare(right.label, "ru-RU")
    );
  }

  function genericGenerationStorageKey() {
    return `docomator.generation-entity-type:${currentGenerationSpaceId() || "default"}`;
  }

  function genericGenerationEnsureType() {
    const types = genericGenerationTypes();
    const stored = localStorage.getItem(genericGenerationStorageKey()) || "";
    const candidates = [
      genericGenerationTypeKey,
      globalThis.docomatorTemplateEntityTypeKey,
      globalThis.docomatorSelectedEntityTypeKey,
      stored,
      "person",
      types[0]?.key
    ].filter(Boolean);
    genericGenerationTypeKey =
      candidates.find((key) => types.some((type) => type.key === key)) || "";
    globalThis.docomatorGenerationEntityTypeKey = genericGenerationTypeKey;
  }

  function genericGenerationApplyFilter() {
    genericGenerationEnsureType();
    generationEntities = genericGenerationTypeKey
      ? genericGenerationAllEntities.filter(
          (entity) => entity.entityTypeKey === genericGenerationTypeKey
        )
      : [...genericGenerationAllEntities];
  }

  function genericGenerationReplaceText(root) {
    if (!root) return;
    const replacements = [
      [/сотрудников/giu, "объектов"],
      [/сотрудника/giu, "объекта"],
      [/сотрудники/giu, "объекты"],
      [/сотрудник/giu, "объект"],
      [/для кого создать документы\?/giu, "Для каких объектов создать документы?"],
      [/никто не выбран/giu, "Ни один объект не выбран"]
    ];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      let value = node.nodeValue;
      for (const [pattern, replacement] of replacements) {
        value = value.replace(pattern, replacement);
      }
      node.nodeValue = value;
    }
  }

  function genericGenerationTypeOptions() {
    return genericGenerationTypes()
      .map(
        (type) =>
          `<option value="${generationEscape(type.key)}"${type.key === genericGenerationTypeKey ? " selected" : ""}>${generationEscape(type.label)}</option>`
      )
      .join("");
  }

  function genericGenerationAdaptForm() {
    const form = document.querySelector("#documentGenerationForm");
    if (!form) return;
    const sourceSection = form.querySelector("#generationSourceKind")?.closest("section");
    if (!sourceSection) return;
    let field = form.querySelector("#generationEntityTypeField");
    if (!field) {
      field = document.createElement("label");
      field.id = "generationEntityTypeField";
      field.className = "generation-field generic-generation-type";
      field.innerHTML = `
        <span>Какой тип объектов использовать?</span>
        <select id="generationEntityType" data-searchable-select data-searchable-placeholder="Выберите тип" data-searchable-search-placeholder="Найти тип">${genericGenerationTypeOptions()}</select>
        <small>В одном выпуске используются объекты одного типа.</small>`;
      const sourceLabel = sourceSection.querySelector("#generationSourceKind")?.closest("label");
      sourceSection.insertBefore(field, sourceLabel || sourceSection.lastChild);
      field.querySelector("#generationEntityType")?.addEventListener("change", (event) => {
        genericGenerationTypeKey = event.target.value;
        localStorage.setItem(genericGenerationStorageKey(), genericGenerationTypeKey);
        globalThis.docomatorGenerationEntityTypeKey = genericGenerationTypeKey;
        genericGenerationApplyFilter();
        renderGenerationWorkspace();
      });
      globalThis.docomatorSearchableSelect?.enhance(field.querySelector("#generationEntityType"));
    }
    const sourceSelect = form.querySelector("#generationSourceKind");
    if (sourceSelect) {
      const labels = {
        all_space: "Для всех объектов выбранного типа",
        group: "Для сохранённой группы",
        selected: "Для выбранных объектов"
      };
      for (const option of sourceSelect.options) {
        if (labels[option.value]) option.textContent = labels[option.value];
      }
    }
    genericGenerationReplaceText(form);
  }

  const genericGenerationBaseRenderWorkspace = renderGenerationWorkspace;
  renderGenerationWorkspace = function renderGenericGenerationWorkspace() {
    if (genericGenerationAllEntities.length === 0 && generationEntities.length > 0) {
      genericGenerationAllEntities = [...generationEntities];
    }
    genericGenerationApplyFilter();
    genericGenerationBaseRenderWorkspace();
    genericGenerationAdaptForm();
    genericGenerationReplaceText(document.querySelector("#documentGenerationPanel"));
  };

  const genericGenerationBaseLoadWorkspace = loadGenerationWorkspace;
  loadGenerationWorkspace = async function loadGenericGenerationWorkspace() {
    genericGenerationAllEntities = [];
    await genericGenerationBaseLoadWorkspace();
    if (genericGenerationAllEntities.length === 0 && generationEntities.length > 0) {
      genericGenerationAllEntities = [...generationEntities];
      genericGenerationApplyFilter();
      renderGenerationWorkspace();
    }
    genericGenerationReplaceText(document.querySelector("#documentGenerationPanel"));
  };

  const genericGenerationBaseSourceDetails = renderGenerationSourceDetails;
  renderGenerationSourceDetails = function renderGenericGenerationSourceDetails() {
    genericGenerationBaseSourceDetails();
    genericGenerationReplaceText(document.querySelector("#generationSourceDetails"));
  };

  const genericGenerationBaseEstimate = updateGenerationEstimate;
  updateGenerationEstimate = function updateGenericGenerationEstimate() {
    genericGenerationBaseEstimate();
    genericGenerationReplaceText(document.querySelector("#generationEstimate"));
  };

  const genericGenerationBaseTemplateMode = syncGenerationTemplateMode;
  syncGenerationTemplateMode = function syncGenericGenerationTemplateMode() {
    genericGenerationBaseTemplateMode();
    genericGenerationReplaceText(document.querySelector("#generationModeHint"));
  };

  const genericGenerationBaseRenderJob = renderGenerationJob;
  renderGenerationJob = function renderGenericGenerationJob(payload) {
    genericGenerationBaseRenderJob(payload);
    genericGenerationReplaceText(document.querySelector("#documentGenerationStatus"));
  };

  generationSourcePayload = function genericGenerationSourcePayload() {
    const kind = currentGenerationSourceKind();
    if (kind === "group") {
      const groupId = document.querySelector("#generationGroup")?.value || "";
      if (!groupId) throw new Error("Выберите сохранённую группу.");
      return { kind: "group", groupId };
    }
    if (kind === "selected") {
      const entityIds = selectedEntityIds();
      if (entityIds.length === 0) throw new Error("Выберите хотя бы один объект.");
      return { kind: "selected", entityIds };
    }
    if (!genericGenerationTypeKey) {
      throw new Error("Выберите тип объектов.");
    }
    return { kind: "all_space", entityTypeKey: genericGenerationTypeKey };
  };

  document.addEventListener("docomator:space-changed", () => {
    genericGenerationAllEntities = [];
    genericGenerationTypeKey = "";
  });

  genericGenerationReplaceText(document.querySelector("#documentGenerationPanel"));
  if (currentGenerationSpaceId()) void loadGenerationWorkspace();
}
