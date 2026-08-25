{
  const definitions = Object.freeze([
    Object.freeze({ key: "common", label: "Общие сведения", description: "ФИО, контакты и сведения, подходящие всем карточкам." }),
    Object.freeze({ key: "teacher", label: "Преподаватель", description: "Кафедра, должность, нагрузка и другие сведения преподавателя." }),
    Object.freeze({ key: "student", label: "Студент", description: "Учебная группа, курс, зачётная книжка и сведения студента." }),
    Object.freeze({ key: "unassigned", label: "Не распределено", description: "Поля, созданные до появления разделов. Их следует отнести к нужной группе." })
  ]);
  const known = new Set(definitions.map((item) => item.key));
  const propertyGroupsByScope = new Map();

  function normalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/gu, "е")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/gu, " ");
  }

  function key(definition) {
    const candidate = definition?.validation?.uiGroup;
    return typeof candidate === "string" && known.has(candidate)
      ? candidate
      : "unassigned";
  }

  function label(value) {
    return definitions.find((item) => item.key === value)?.label || "Не распределено";
  }

  function allowed(
    definition,
    selectedGroup,
    { includeUnassigned = true, includeAll = false } = {}
  ) {
    const actual = key(definition);
    if (includeAll) return actual !== "unassigned" || includeUnassigned;
    if (actual === "unassigned") return includeUnassigned;
    if (selectedGroup === "common") return actual === "common";
    if (selectedGroup === "teacher" || selectedGroup === "student") {
      return actual === "common" || actual === selectedGroup;
    }
    return actual === selectedGroup;
  }

  function options(selected = "common", { includeUnassigned = false } = {}) {
    return definitions
      .filter((item) => includeUnassigned || item.key !== "unassigned")
      .map(
        (item) =>
          `<option value="${item.key}"${item.key === selected ? " selected" : ""}>${item.label}</option>`
      )
      .join("");
  }

  function infer(text) {
    const value = normalize(text);
    if (/преподав|руковод|научн.*рук|куратор|кафедр|должност|нагрузк/u.test(value)) {
      return "teacher";
    }
    if (/студент|учащ|зачет|курс|учебн.*груп|тем.*(?:работ|вкр|исслед)/u.test(value)) {
      return "student";
    }
    return "common";
  }

  function grouped(properties, selectedGroup, optionsValue = {}) {
    const result = new Map();
    for (const definition of definitions) result.set(definition.key, []);
    for (const property of properties || []) {
      if (!allowed(property, selectedGroup, optionsValue)) continue;
      result.get(key(property))?.push(property);
    }
    for (const values of result.values()) {
      values.sort((left, right) => String(left.label).localeCompare(String(right.label), "ru-RU"));
    }
    return result;
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    if (typeof Request !== "undefined" && input instanceof Request) return input.url;
    return "";
  }

  function propertyScope(url) {
    return (
      url.searchParams.get("spaceId") ||
      String(globalThis.docomatorCurrentSpaceId || localStorage.getItem("docomator.space") || "")
    );
  }

  function scopedPropertyKey(scope, propertyKey) {
    return `${scope || "default"}\u0000${propertyKey}`;
  }

  function rememberPropertyGroups(scope, payload) {
    const values = Array.isArray(payload?.data)
      ? payload.data
      : payload?.data && typeof payload.data === "object"
        ? [payload.data]
        : [];
    for (const definition of values) {
      if (!definition?.key) continue;
      propertyGroupsByScope.set(
        scopedPropertyKey(scope, definition.key),
        key(definition)
      );
    }
  }

  function installPropertyGroupPersistence() {
    if (globalThis.__docomatorPropertyGroupPersistenceInstalled) return;
    globalThis.__docomatorPropertyGroupPersistenceInstalled = true;
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init = {}) => {
      const rawUrl = requestUrl(input);
      if (!rawUrl || !globalThis.location?.origin) return originalFetch(input, init);
      const url = new URL(rawUrl, globalThis.location.origin);
      if (url.origin !== globalThis.location.origin) return originalFetch(input, init);
      const match = /^\/api\/v1\/knowledge\/property-definitions(?:\/([^/]+))?$/u.exec(
        url.pathname
      );
      if (!match) return originalFetch(input, init);

      const method = String(
        init.method ||
          (typeof Request !== "undefined" && input instanceof Request
            ? input.method
            : "GET")
      ).toUpperCase();
      const scope = propertyScope(url);
      let nextInit = init;
      if (
        (method === "POST" || method === "PUT") &&
        typeof init.body === "string"
      ) {
        try {
          const payload = JSON.parse(init.body);
          const validation =
            payload.validation &&
            typeof payload.validation === "object" &&
            !Array.isArray(payload.validation)
              ? { ...payload.validation }
              : {};
          const hasUiGroup =
            typeof validation.uiGroup === "string" && known.has(validation.uiGroup);
          if (!hasUiGroup) {
            if (method === "POST" && payload.appliesTo?.includes?.("person")) {
              validation.uiGroup = "common";
            } else if (method === "PUT" && match[1]) {
              const existing = propertyGroupsByScope.get(
                scopedPropertyKey(scope, decodeURIComponent(match[1]))
              );
              if (existing) validation.uiGroup = existing;
            }
          }
          if (Object.keys(validation).length > 0 || payload.validation !== undefined) {
            payload.validation = validation;
            nextInit = { ...init, body: JSON.stringify(payload) };
          }
        } catch {
          // Некорректный JSON должен обработать обычный API-контракт без подмены ошибки.
        }
      }

      const response = await originalFetch(input, nextInit);
      if (response.ok && (method === "GET" || method === "POST" || method === "PUT")) {
        void response
          .clone()
          .json()
          .then((payload) => rememberPropertyGroups(scope, payload))
          .catch(() => {});
      }
      return response;
    };
  }

  globalThis.docomatorFieldGroups = Object.freeze({
    definitions,
    key,
    label,
    allowed,
    options,
    infer,
    grouped,
    normalize
  });

  installPropertyGroupPersistence();

  if (!document.querySelector('link[data-interaction-contract]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/ui/interaction-contract.css";
    link.dataset.interactionContract = "";
    document.head.append(link);
  }

  void import("/ui/navigation-contract.js").catch((error) => {
    console.error("Не удалось загрузить контракт навигации.", error);
  });
  void import("/ui/data-export.js").catch((error) => {
    console.error("Не удалось загрузить модуль экспорта данных.", error);
  });
  void import("/ui/entity-collections-bootstrap.js").catch((error) => {
    console.error("Не удалось подключить таблицы и списки данных сотрудников.", error);
  });
}
