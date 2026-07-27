const docomatorWorkspacePalette = Object.freeze([
  ["#5B8DEF", "Синий", "blue"],
  ["#7568E8", "Фиолетовый", "violet"],
  ["#BF5F8A", "Розовый", "pink"],
  ["#CF7047", "Терракотовый", "terracotta"],
  ["#B58B2E", "Золотистый", "gold"],
  ["#3D9472", "Зелёный", "green"],
  ["#2B8F9F", "Бирюзовый", "teal"],
  ["#6B7280", "Графитовый", "graphite"]
]);
const docomatorWorkspaceDefaultColor = "#5B8DEF";
let docomatorWorkspaceMenuReturnFocus = null;

function docomatorWorkspaceColor(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/u.test(normalized)
    ? normalized
    : docomatorWorkspaceDefaultColor;
}

function docomatorWorkspaceTone(value) {
  const color = docomatorWorkspaceColor(value);
  return (
    docomatorWorkspacePalette.find(([candidate]) => candidate === color)?.[2] ||
    "blue"
  );
}

function docomatorWorkspaceApplyTone(element, value) {
  if (!element) return;
  element.dataset.spaceTone = docomatorWorkspaceTone(value);
}

function docomatorWorkspaceEnsureMarkup() {
  const legacyChip = document.querySelector("#currentSpaceChip");
  if (!legacyChip) return null;
  if (!legacyChip.closest(".workspace-switcher-host")) {
    const host = document.createElement("div");
    host.className = "workspace-switcher-host";
    legacyChip.replaceWith(host);

    const button = document.createElement("button");
    button.id = "currentSpaceChip";
    button.className = "context-chip workspace-switcher-button";
    button.type = "button";
    button.hidden = legacyChip.hidden;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "workspaceSwitcherMenu");
    button.innerHTML = `
      <span class="context-dot" aria-hidden="true"></span>
      <span id="currentSpaceChipText">${escapeHtml(
        legacyChip.querySelector("#currentSpaceChipText")?.textContent || "Пространство"
      )}</span>
      <span class="workspace-switcher-chevron" aria-hidden="true">⌄</span>`;
    host.append(button);
    host.insertAdjacentHTML(
      "beforeend",
      `<section class="workspace-switcher-menu" id="workspaceSwitcherMenu" aria-label="Выбор пространства" hidden>
        <header class="workspace-switcher-heading">
          <div><strong>Пространства</strong><small>Каждое хранит собственных людей, группы, шаблоны и результаты.</small></div>
          <button class="workspace-switcher-add" type="button" data-workspace-switcher-action="create" aria-label="Создать пространство">＋</button>
        </header>
        <div class="workspace-switcher-list" id="workspaceSwitcherList" role="listbox" aria-label="Доступные пространства"></div>
        <footer class="workspace-switcher-footer">
          <button type="button" data-workspace-switcher-action="edit">Название и цвет</button>
          <button type="button" data-workspace-switcher-action="manage">Все пространства</button>
        </footer>
      </section>`
    );
  }
  return document.querySelector(".workspace-switcher-host");
}

function docomatorWorkspaceDecorateRows() {
  document.querySelectorAll("[data-space-id]").forEach((row) => {
    const workspace = state.data.spaces.find(
      (item) => item.id === row.dataset.spaceId
    );
    if (!workspace) return;
    docomatorWorkspaceApplyTone(row, workspace.color);
  });
  const summary = document.querySelector("#spaceSummary");
  const workspace = currentSpace();
  if (summary && workspace) {
    docomatorWorkspaceApplyTone(summary, workspace.color);
  }
  const actions = summary?.querySelector(".summary-actions");
  if (
    actions &&
    !actions.querySelector('[data-workspace-switcher-action="edit"]')
  ) {
    actions.insertAdjacentHTML(
      "afterbegin",
      '<button class="secondary-button" type="button" data-workspace-switcher-action="edit">Название и цвет</button>'
    );
  }
}

function docomatorWorkspaceRender() {
  const host = docomatorWorkspaceEnsureMarkup();
  if (!host) return;
  const button = host.querySelector("#currentSpaceChip");
  const label = host.querySelector("#currentSpaceChipText");
  const list = host.querySelector("#workspaceSwitcherList");
  const workspace = currentSpace();
  if (!button || !label || !list) return;

  if (!workspace) {
    button.hidden = true;
    list.innerHTML =
      '<p class="workspace-switcher-empty">Создайте первое пространство.</p>';
    return;
  }

  const color = docomatorWorkspaceColor(workspace.color);
  const tone = docomatorWorkspaceTone(color);
  button.hidden = false;
  button.dataset.spaceTone = tone;
  host.dataset.spaceTone = tone;
  button.title = `Текущее пространство: ${workspace.name}`;
  button.setAttribute(
    "aria-label",
    `Текущее пространство: ${workspace.name}. Открыть список.`
  );
  label.textContent = workspace.name;
  document.documentElement.dataset.currentSpaceTone = tone;
  globalThis.docomatorCurrentSpace = {
    id: workspace.id,
    name: workspace.name,
    color
  };

  list.innerHTML = state.data.spaces
    .map((item) => {
      const itemColor = docomatorWorkspaceColor(item.color);
      const itemTone = docomatorWorkspaceTone(itemColor);
      const active = item.id === state.currentSpaceId;
      return `<button class="workspace-switcher-option${active ? " is-active" : ""}" type="button" role="option" aria-selected="${String(active)}" data-workspace-switcher-space="${escapeHtml(item.id)}" data-space-tone="${itemTone}">
        <span class="workspace-switcher-avatar" aria-hidden="true">${escapeHtml((item.name || "П").slice(0, 1).toUpperCase())}</span>
        <span class="workspace-switcher-copy"><strong>${escapeHtml(item.name)}</strong><small>${Number(item.entityCount || 0)} сотрудников · ${Number(item.groupCount || 0)} групп</small></span>
        <span class="workspace-switcher-check" aria-hidden="true">${active ? "✓" : ""}</span>
      </button>`;
    })
    .join("");
  docomatorWorkspaceDecorateRows();
}

function docomatorWorkspaceOpenMenu() {
  const host = docomatorWorkspaceEnsureMarkup();
  const button = host?.querySelector("#currentSpaceChip");
  const menu = host?.querySelector("#workspaceSwitcherMenu");
  if (!button || !menu || button.hidden) return;
  docomatorWorkspaceRender();
  docomatorWorkspaceMenuReturnFocus = document.activeElement;
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() =>
    menu
      .querySelector('.workspace-switcher-option[aria-selected="true"]')
      ?.focus()
  );
}

function docomatorWorkspaceCloseMenu(restoreFocus = false) {
  const host = document.querySelector(".workspace-switcher-host");
  const button = host?.querySelector("#currentSpaceChip");
  const menu = host?.querySelector("#workspaceSwitcherMenu");
  if (!button || !menu || menu.hidden) return;
  menu.hidden = true;
  button.setAttribute("aria-expanded", "false");
  if (restoreFocus) docomatorWorkspaceMenuReturnFocus?.focus?.();
}

function docomatorWorkspaceToggleMenu() {
  const menu = document.querySelector("#workspaceSwitcherMenu");
  if (menu?.hidden === false) docomatorWorkspaceCloseMenu(true);
  else docomatorWorkspaceOpenMenu();
}

const docomatorWorkspaceOriginalFieldHtml = fieldHtml;
fieldHtml = function fieldHtmlWithWorkspaceColor(definition) {
  const [name, label, type, required, _placeholder, hint] = definition;
  if (type !== "space-color") {
    return docomatorWorkspaceOriginalFieldHtml(definition);
  }
  return `<fieldset class="field workspace-color-field"><legend>${escapeHtml(label)}${required ? '<span class="required-marker"> *</span>' : ""}</legend><div class="workspace-color-palette">${docomatorWorkspacePalette
    .map(
      ([color, colorLabel, tone], index) =>
        `<label class="workspace-color-choice" title="${escapeHtml(colorLabel)}" data-space-tone="${tone}"><input type="radio" name="${escapeHtml(name)}" value="${color}" ${index === 0 ? "checked" : ""} ${required ? "required" : ""}/><span aria-hidden="true"></span><small>${escapeHtml(colorLabel)}</small></label>`
    )
    .join("")}</div><small>${escapeHtml(hint)}</small></fieldset>`;
};

const docomatorWorkspaceColorField = [
  "color",
  "Цвет пространства",
  "space-color",
  true,
  docomatorWorkspaceDefaultColor,
  "Цвет помогает быстро отличать разделы. Он не меняет состав и не ограничивает доступ."
];
dialogs.space.description =
  "Создайте отдельный раздел: его сотрудники, группы, шаблоны, выпуски и результаты не смешиваются с другими разделами.";
dialogs.space.fields = [...dialogs.space.fields, docomatorWorkspaceColorField];
dialogs.space.payload = (values) =>
  compact({
    name: values.name,
    description: values.description,
    color: docomatorWorkspaceColor(values.color)
  });
dialogs["space-edit"] = {
  eyebrow: "Текущее пространство",
  title: "Название и цвет",
  description:
    "Изменение оформления не переносит данные: сотрудники, группы, шаблоны и результаты останутся в этом пространстве.",
  endpoint: () => spaceEndpoint(),
  method: "PATCH",
  success: "Пространство обновлено",
  submit: "Сохранить изменения",
  fields: [
    [
      "name",
      "Название",
      "text",
      true,
      "Инженерная служба",
      "Название отображается в переключателе на каждом экране."
    ],
    [
      "description",
      "Описание",
      "textarea",
      false,
      "Какие данные находятся в этом пространстве",
      "Кратко объясните назначение раздела."
    ],
    docomatorWorkspaceColorField
  ],
  payload: (values) => ({
    name: String(values.name || "").trim(),
    description: String(values.description || "").trim(),
    color: docomatorWorkspaceColor(values.color)
  }),
  afterCreate: async () => {
    await loadData();
  }
};

const docomatorWorkspaceOriginalOpenDialog = openDialog;
openDialog = function openDialogWithWorkspaceDefaults(kind) {
  if (kind === "space-edit" && !currentSpace()) {
    notify(
      "💡",
      "Сначала создайте пространство",
      "После этого можно задать ему название и цвет."
    );
    docomatorWorkspaceOriginalOpenDialog("space");
    return;
  }
  docomatorWorkspaceOriginalOpenDialog(kind);
  if (kind !== "space-edit") return;
  const workspace = currentSpace();
  if (!workspace) return;
  const name = document.querySelector("#field-name");
  const description = document.querySelector("#field-description");
  if (name) name.value = workspace.name || "";
  if (description) description.value = workspace.description || "";
  const color = docomatorWorkspaceColor(workspace.color);
  const colorInput = document.querySelector(
    `#dialogFields input[name="color"][value="${color}"]`
  );
  if (colorInput) colorInput.checked = true;
};

const docomatorWorkspaceOriginalRenderSpaceList = renderSpaceList;
renderSpaceList = function renderSpaceListWithWorkspaceColors() {
  docomatorWorkspaceOriginalRenderSpaceList();
  docomatorWorkspaceRender();
};

const docomatorWorkspaceOriginalRenderSpaceSummary = renderSpaceSummary;
renderSpaceSummary = function renderSpaceSummaryWithWorkspaceColor() {
  docomatorWorkspaceOriginalRenderSpaceSummary();
  docomatorWorkspaceRender();
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("#currentSpaceChip");
  if (button) {
    event.preventDefault();
    docomatorWorkspaceToggleMenu();
    return;
  }

  const spaceOption = event.target.closest("[data-workspace-switcher-space]");
  if (spaceOption) {
    const spaceId = String(spaceOption.dataset.workspaceSwitcherSpace || "");
    docomatorWorkspaceCloseMenu(false);
    if (spaceId) void selectSpace(spaceId);
    return;
  }

  const action = event.target.closest("[data-workspace-switcher-action]")?.dataset
    .workspaceSwitcherAction;
  if (action === "create") {
    docomatorWorkspaceCloseMenu(false);
    openDialog("space");
    return;
  }
  if (action === "edit") {
    docomatorWorkspaceCloseMenu(false);
    openDialog("space-edit");
    return;
  }
  if (action === "manage") {
    docomatorWorkspaceCloseMenu(false);
    selectView("spaces");
    return;
  }

  const host = document.querySelector(".workspace-switcher-host");
  if (host && !host.contains(event.target)) {
    docomatorWorkspaceCloseMenu(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    document.querySelector("#workspaceSwitcherMenu")?.hidden === false
  ) {
    event.preventDefault();
    docomatorWorkspaceCloseMenu(true);
  }
});

document.addEventListener("docomator:space-changed", () => {
  queueMicrotask(docomatorWorkspaceRender);
});

docomatorWorkspaceEnsureMarkup();
docomatorWorkspaceRender();
