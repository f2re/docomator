{
  const instances = new WeakMap();
  let sequence = 0;

  function normalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/gu, "е")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function optionRecords(select) {
    const records = [];
    for (const child of select.children) {
      if (child.tagName === "OPTGROUP") {
        const group = child.label || "Другое";
        for (const option of child.querySelectorAll(":scope > option")) {
          records.push({ option, group });
        }
      } else if (child.tagName === "OPTION") {
        records.push({ option: child, group: "" });
      }
    }
    return records;
  }

  function selectedLabel(select) {
    const selected = select.selectedOptions?.[0];
    return selected?.textContent?.trim() || select.dataset.searchablePlaceholder || "Выберите значение";
  }

  function createInstance(select) {
    const id = `searchable-select-${++sequence}`;
    const root = document.createElement("div");
    root.className = "searchable-select";
    root.dataset.searchableSelectRoot = "";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "searchable-select-trigger searchable-select-control";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", `${id}-panel`);
    trigger.innerHTML = '<span data-searchable-select-value></span><span aria-hidden="true">⌄</span>';

    const panel = document.createElement("div");
    panel.id = `${id}-panel`;
    panel.className = "searchable-select-panel";
    panel.hidden = true;

    const search = document.createElement("input");
    search.type = "search";
    search.className = "searchable-select-search";
    search.placeholder = select.dataset.searchableSearchPlaceholder || "Найти поле";
    search.autocomplete = "off";
    search.setAttribute("aria-label", search.placeholder);

    const list = document.createElement("div");
    list.className = "searchable-select-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", select.getAttribute("aria-label") || "Варианты выбора");

    const empty = document.createElement("p");
    empty.className = "searchable-select-empty";
    empty.textContent = "Ничего не найдено";
    empty.hidden = true;

    panel.append(search, list, empty);
    root.append(trigger, panel);
    select.insertAdjacentElement("afterend", root);
    select.hidden = true;

    const instance = { select, root, trigger, panel, search, list, empty, records: [] };
    instances.set(select, instance);

    function open() {
      if (select.disabled) return;
      document.querySelectorAll("[data-searchable-select-root].is-open").forEach((candidate) => {
        if (candidate !== root) {
          candidate.classList.remove("is-open");
          candidate.querySelector(".searchable-select-panel")?.setAttribute("hidden", "");
          candidate.querySelector(".searchable-select-trigger")?.setAttribute("aria-expanded", "false");
        }
      });
      root.classList.add("is-open");
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      search.value = "";
      filter(instance);
      requestAnimationFrame(() => search.focus());
    }

    function close({ focus = false } = {}) {
      root.classList.remove("is-open");
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (focus) trigger.focus();
    }

    trigger.addEventListener("click", () => {
      if (panel.hidden) open();
      else close();
    });
    search.addEventListener("input", () => filter(instance));
    search.addEventListener("keydown", (event) => {
      const visible = [...list.querySelectorAll("button:not([hidden]):not(:disabled)")];
      if (event.key === "Escape") {
        event.preventDefault();
        close({ focus: true });
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const current = visible.indexOf(document.activeElement);
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const next = current < 0 ? (direction > 0 ? 0 : visible.length - 1) : (current + direction + visible.length) % visible.length;
        visible[next]?.focus();
      }
      if (event.key === "Enter" && visible.length === 1) {
        event.preventDefault();
        visible[0].click();
      }
    });
    list.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close({ focus: true });
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (!panel.hidden && !root.contains(event.target)) close();
    });

    instance.close = close;
    refresh(select);
    return instance;
  }

  function filter(instance) {
    const query = normalize(instance.search.value);
    let visibleCount = 0;
    const groupCounts = new Map();
    for (const record of instance.records) {
      const visible = !query || record.searchable.includes(query);
      record.button.hidden = !visible;
      if (visible) {
        visibleCount += 1;
        groupCounts.set(record.group, (groupCounts.get(record.group) || 0) + 1);
      }
    }
    instance.list.querySelectorAll("[data-searchable-select-group]").forEach((heading) => {
      heading.hidden = !groupCounts.get(heading.dataset.searchableSelectGroup || "");
    });
    instance.empty.hidden = visibleCount > 0;
  }

  function refresh(select) {
    const instance = instances.get(select) || createInstance(select);
    if (!instance) return;
    instance.trigger.disabled = select.disabled;
    instance.trigger.querySelector("[data-searchable-select-value]").textContent = selectedLabel(select);
    instance.list.innerHTML = "";
    instance.records = [];
    let lastGroup = null;
    for (const { option, group } of optionRecords(select)) {
      if (group && group !== lastGroup) {
        const heading = document.createElement("div");
        heading.className = "searchable-select-group";
        heading.dataset.searchableSelectGroup = group;
        heading.textContent = group;
        instance.list.append(heading);
      }
      lastGroup = group;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "searchable-select-option";
      button.setAttribute("role", "option");
      button.dataset.value = option.value;
      button.disabled = option.disabled;
      button.classList.toggle("is-selected", option.selected);
      button.setAttribute("aria-selected", String(option.selected));
      button.innerHTML = `<span>${String(option.textContent || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character])}</span>${option.dataset.optionNote ? `<small>${String(option.dataset.optionNote).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character])}</small>` : ""}`;
      button.addEventListener("click", () => {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        refresh(select);
        instance.close({ focus: true });
      });
      instance.list.append(button);
      instance.records.push({
        button,
        group,
        searchable: normalize(`${group} ${option.textContent || ""} ${option.dataset.searchTerms || ""}`)
      });
    }
    filter(instance);
  }

  function enhance(select) {
    if (!(select instanceof HTMLSelectElement)) return null;
    return instances.get(select) || createInstance(select);
  }

  function enhanceAll(root = document) {
    root.querySelectorAll?.("select[data-searchable-select]").forEach((select) => enhance(select));
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.("select[data-searchable-select]")) enhance(node);
        enhanceAll(node);
      }
    }
  });

  globalThis.docomatorSearchableSelect = Object.freeze({ enhance, enhanceAll, refresh });
  enhanceAll();
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
}
