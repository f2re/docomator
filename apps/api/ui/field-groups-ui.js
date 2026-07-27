{
  const definitions = Object.freeze([
    Object.freeze({ key: "common", label: "Общие сведения", description: "ФИО, контакты и сведения, подходящие всем карточкам." }),
    Object.freeze({ key: "teacher", label: "Преподаватель", description: "Кафедра, должность, нагрузка и другие сведения преподавателя." }),
    Object.freeze({ key: "student", label: "Студент", description: "Учебная группа, курс, зачётная книжка и сведения студента." }),
    Object.freeze({ key: "unassigned", label: "Не распределено", description: "Поля, созданные до появления разделов. Их следует отнести к нужной группе." })
  ]);
  const known = new Set(definitions.map((item) => item.key));

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

  function allowed(definition, selectedGroup, { includeUnassigned = true } = {}) {
    const actual = key(definition);
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
}
