from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value, encoding="utf-8")
    print(f"updated {path}")


write(
    "apps/api/ui/template-placement-guidance.js",
    r'''{
  const placementBaseTextRangeControl = structureTextRangeControl;
  const placementBaseReadyMessage = structureFieldReadyMessage;

  structureTextRangeControl = function structureTextRangeControlWithGuidance(element) {
    if (element.kind !== "paragraph" || element.text) {
      return placementBaseTextRangeControl(element);
    }
    const inTable = Boolean(element.tableLocation);
    const title = inTable
      ? "Выбрана пустая ячейка таблицы"
      : "Выбран пустой абзац";
    const target = inTable ? "эту ячейку" : "этот абзац";
    return `
      <div class="structure-placement-card is-ready structure-placement-explained">
        <input id="documentFieldParagraphMode" type="hidden" value="whole" />
        <span class="structure-placement-step" aria-hidden="true">1</span>
        <div>
          <strong>${structureEscape(title)}</strong>
          <p>После сохранения ${target} станет местом для значения выбранного поля. Остальные ячейки и текст документа не изменятся.</p>
          <ol>
            <li>Выберите поле сотрудника ниже.</li>
            <li>При необходимости настройте формат ФИО.</li>
            <li>Нажмите «Связать с документом».</li>
          </ol>
          <small>Выделять текст не требуется: заменять в пустом месте пока нечего.</small>
        </div>
      </div>`;
  };

  structureFieldReadyMessage = function structureFieldReadyMessageWithGuidance(form) {
    if (!selectedStructureElement?.text && selectedStructureElement?.kind === "paragraph") {
      const definition = structureSelectedDefinition(
        form.querySelector("#documentFieldProperty")?.value || ""
      );
      const fieldLabel =
        definition?.label ||
        form.querySelector("#documentFieldLabel")?.value?.trim() ||
        "поле";
      const target = selectedStructureElement.tableLocation
        ? "выбранную пустую ячейку"
        : "выбранный пустой абзац";
      return `Готово: значение поля «${fieldLabel}» будет записано в ${target}. Нажмите «Связать с документом».`;
    }
    return placementBaseReadyMessage(form);
  };
}
''',
)

write(
    "apps/api/ui/template-repeat-assistant.js",
    r'''{
  let rosterAssistantBusy = false;

  const rosterNamePatterns = {
    identity: null,
    full: "{Фамилия} {Имя} {Отчество}",
    "family-initials": "{Фамилия} {И}.{О}.",
    "initials-family": "{И}.{О}. {Фамилия}",
    family: "{Фамилия}",
    "family-given": "{Фамилия} {Имя}",
    "given-family": "{Имя} {Фамилия}",
    "given-patronymic": "{Имя} {Отчество}"
  };

  function rosterNormalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/gu, "е")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/gu, " ");
  }

  function rosterRowCoordinate(element) {
    const location = element?.tableLocation;
    if (!location || element.kind !== "paragraph") return null;
    return {
      part: element.part,
      tableIndex: location.tableIndex,
      rowIndex: location.rowIndex,
      columnIndex: location.columnIndex
    };
  }

  function rosterSameRow(left, right) {
    return Boolean(
      left &&
      right &&
      left.part === right.part &&
      left.tableIndex === right.tableIndex &&
      left.rowIndex === right.rowIndex
    );
  }

  function rosterRowElements(element) {
    const coordinate = rosterRowCoordinate(element);
    if (!coordinate || !Array.isArray(structureReport?.elements)) return [];
    const grouped = new Map();
    for (const candidate of structureReport.elements) {
      const current = rosterRowCoordinate(candidate);
      if (!rosterSameRow(coordinate, current)) continue;
      const previous = grouped.get(current.columnIndex);
      if (!previous || (!previous.text && candidate.text)) {
        grouped.set(current.columnIndex, candidate);
      }
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, candidate]) => candidate);
  }

  function rosterHeaderText(element) {
    const coordinate = rosterRowCoordinate(element);
    if (
      !coordinate ||
      coordinate.rowIndex < 1 ||
      !Array.isArray(structureReport?.elements)
    ) {
      return "";
    }
    return structureReport.elements
      .filter((candidate) => {
        const current = rosterRowCoordinate(candidate);
        return Boolean(
          current &&
          current.part === coordinate.part &&
          current.tableIndex === coordinate.tableIndex &&
          current.rowIndex === coordinate.rowIndex - 1 &&
          current.columnIndex === coordinate.columnIndex
        );
      })
      .map((candidate) => candidate.text || "")
      .find(Boolean) || "";
  }

  function rosterCleanLabel(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/[{}<>\[\]_]+/gu, " ")
      .replace(/\.{2,}/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 160);
  }

  function rosterSuggestedLabel(element, position) {
    const header = rosterCleanLabel(rosterHeaderText(element));
    const current = rosterCleanLabel(element.text);
    const usefulCurrent =
      current && !/^(поле|значение|текст|заполнить)$/iu.test(current);
    return header || (usefulCurrent ? current : "") || `Колонка ${position + 1}`;
  }

  function rosterSemantic(value) {
    const normalized = rosterNormalize(value);
    if (/^(?:#|№)$|номер по порядку|порядков|п п/u.test(normalized)) return "position";
    if (/фио|полное имя|студент|сотрудник|обучающ/u.test(normalized)) return "name";
    if (/тема.*(?:работ|вкр|диплом|диссертац)|научн.*тема/u.test(normalized)) return "topic";
    if (/научн.*руковод|руководител|научрук|куратор/u.test(normalized)) return "supervisor";
    if (/групп|поток/u.test(normalized)) return "group";
    if (/номер.*зачет|зачетн.*книж/u.test(normalized)) return "student-number";
    if (/должност|позици/u.test(normalized)) return "position-name";
    return "";
  }

  function rosterPropertyScore(label, property) {
    const normalized = rosterNormalize(label);
    const candidates = [
      property.label,
      ...(Array.isArray(property.aliases) ? property.aliases : [])
    ];
    let score = 0;
    for (const candidate of candidates) {
      const target = rosterNormalize(candidate);
      if (normalized === target) score = Math.max(score, 1);
      else if (normalized.includes(target) || target.includes(normalized)) {
        score = Math.max(score, 0.82);
      } else if (
        rosterSemantic(normalized) &&
        rosterSemantic(normalized) === rosterSemantic(target)
      ) {
        score = Math.max(score, 0.96);
      }
    }
    return score;
  }

  function rosterSuggestedMode(label) {
    const semantic = rosterSemantic(label);
    if (semantic === "position") return "system:position";
    if (semantic === "name") return "system:name";
    let best = null;
    for (const property of structurePropertyDefinitions) {
      const appliesTo = Array.isArray(property.appliesTo) ? property.appliesTo : [];
      if (appliesTo.length > 0 && !appliesTo.includes("person")) continue;
      const score = rosterPropertyScore(label, property);
      if (!best || score > best.score) best = { property, score };
    }
    return best && best.score >= 0.72
      ? `existing:${best.property.key}`
      : "skip";
  }

  function rosterExistingField(element) {
    return (structureDraft?.fields || []).find(
      (field) => field.elementId === element.id
    ) || null;
  }

  function rosterModeForExisting(field) {
    if (!field) return "";
    const key = String(field.key || "").toLowerCase();
    if (key === "subject.position" || key === "position") return "system:position";
    if (
      key === "fio" ||
      key === "full_name" ||
      key.endsWith(".full_name") ||
      key.endsWith(".display_name")
    ) {
      return "system:name";
    }
    return `existing:${field.key}`;
  }

  function rosterPropertyOptions(selected, existingField = null) {
    const available = structurePropertyDefinitions
      .filter((property) => {
        const appliesTo = Array.isArray(property.appliesTo) ? property.appliesTo : [];
        return appliesTo.length === 0 || appliesTo.includes("person");
      })
      .sort(
        (left, right) =>
          left.label.localeCompare(right.label, "ru-RU") ||
          left.key.localeCompare(right.key, "en")
      );
    const hasCurrent =
      existingField &&
      selected.startsWith("existing:") &&
      !available.some((property) => `existing:${property.key}` === selected);
    return [
      `<option value="skip"${selected === "skip" ? " selected" : ""}>Не заполнять эту колонку</option>`,
      `<optgroup label="Системные значения">`,
      `<option value="system:position"${selected === "system:position" ? " selected" : ""}>Номер по порядку: 1, 2, 3…</option>`,
      `<option value="system:name"${selected === "system:name" ? " selected" : ""}>ФИО участника</option>`,
      `</optgroup>`,
      `<optgroup label="Поля карточки">`,
      ...(hasCurrent
        ? [
            `<option value="${structureEscape(selected)}" selected>${structureEscape(existingField.label)} · сохранённое поле</option>`
          ]
        : []),
      ...available.map(
        (property) =>
          `<option value="existing:${structureEscape(property.key)}"${selected === `existing:${property.key}` ? " selected" : ""}>${structureEscape(property.label)}</option>`
      ),
      `</optgroup>`,
      `<option value="new"${selected === "new" ? " selected" : ""}>Создать новое поле…</option>`
    ].join("");
  }

  function rosterNamePresentation(field) {
    const formatter = field?.formatter;
    if (!formatter || formatter.kind !== "person-name.ru") return "full";
    const match = Object.entries(rosterNamePatterns).find(
      ([key, pattern]) => key !== "identity" && pattern === formatter.pattern
    );
    return match?.[0] || "custom";
  }

  function rosterNameControls(field, mode) {
    const presentation = rosterNamePresentation(field);
    const formatter = field?.formatter || {};
    return `<section class="roster-name-controls" data-roster-name-controls${mode === "system:name" ? "" : " hidden"}>
      <label><span>Как записать ФИО</span><select data-roster-name-presentation>
        <option value="full"${presentation === "full" ? " selected" : ""}>Фамилия Имя Отчество</option>
        <option value="family-initials"${presentation === "family-initials" ? " selected" : ""}>Фамилия И.О.</option>
        <option value="initials-family"${presentation === "initials-family" ? " selected" : ""}>И.О. Фамилия</option>
        <option value="family"${presentation === "family" ? " selected" : ""}>Только фамилия</option>
        <option value="family-given"${presentation === "family-given" ? " selected" : ""}>Фамилия Имя</option>
        <option value="given-family"${presentation === "given-family" ? " selected" : ""}>Имя Фамилия</option>
        <option value="given-patronymic"${presentation === "given-patronymic" ? " selected" : ""}>Имя Отчество</option>
        <option value="custom"${presentation === "custom" ? " selected" : ""}>Свой шаблон…</option>
      </select></label>
      <label><span>Как ФИО хранится в карточке</span><select data-roster-name-source>
        <option value="family-given-patronymic"${formatter.sourceOrder !== "given-patronymic-family" && formatter.sourceOrder !== "family-given" && formatter.sourceOrder !== "given-family" ? " selected" : ""}>Фамилия Имя Отчество</option>
        <option value="given-patronymic-family"${formatter.sourceOrder === "given-patronymic-family" ? " selected" : ""}>Имя Отчество Фамилия</option>
        <option value="family-given"${formatter.sourceOrder === "family-given" ? " selected" : ""}>Фамилия Имя</option>
        <option value="given-family"${formatter.sourceOrder === "given-family" ? " selected" : ""}>Имя Фамилия</option>
      </select></label>
      <label data-roster-custom-pattern${presentation === "custom" ? "" : " hidden"}><span>Шаблон записи</span><input data-roster-name-pattern type="text" maxlength="160" value="${structureEscape(formatter.pattern || "{Фамилия} {И}.{О}.")}" /><small>Доступны {Фамилия}, {Имя}, {Отчество}, {Ф}, {И}, {О}.</small></label>
    </section>`;
  }

  function rosterCard(element, position) {
    const existing = rosterExistingField(element);
    const label = rosterSuggestedLabel(element, position);
    const mode = existing ? rosterModeForExisting(existing) : rosterSuggestedMode(label);
    const semantic = rosterSemantic(label);
    const recommendation =
      semantic === "position" && mode !== "system:position"
        ? `<small class="roster-recommendation">Рекомендуется «Номер по порядку».</small>`
        : "";
    return `<article class="roster-assistant-column${existing ? " is-linked" : ""}" data-roster-column data-element-id="${structureEscape(element.id)}" data-field-id="${structureEscape(existing?.id || "")}">
      <div class="roster-assistant-column-number">${position + 1}</div>
      <div class="roster-assistant-column-body">
        <div class="roster-column-description"><div><strong>${structureEscape(label)}</strong>${existing ? '<span class="pill pill-success">Сохранено</span>' : '<span class="pill">Не сохранено</span>'}</div><p>${structureEscape(element.text || "Пустая ячейка")}</p>${recommendation}</div>
        <label><span>Что записывать</span><select data-roster-mode>${rosterPropertyOptions(mode, existing)}</select></label>
        <div class="roster-new-property" data-roster-new${mode === "new" ? "" : " hidden"}>
          <label><span>Название нового поля</span><input data-roster-label type="text" maxlength="500" value="${structureEscape(label)}" /></label>
          <label><span>Тип</span><select data-roster-type><option value="string">Короткий текст</option><option value="text"${semantic === "topic" ? " selected" : ""}>Длинный текст</option><option value="enum">Список вариантов</option><option value="number">Число</option><option value="integer">Целое число</option><option value="date">Дата</option><option value="date-time">Дата и время</option><option value="boolean">Да или нет</option></select></label>
        </div>
        ${rosterNameControls(existing, mode)}
        <label class="operator-check"><input data-roster-required type="checkbox"${existing?.required || ["name", "topic"].includes(semantic) ? " checked" : ""} /><span>Обязательное значение</span></label>
      </div>
    </article>`;
  }

  function rosterCurrentRepeatMatches(element) {
    const repeat = structureDraft?.repeatBinding;
    const coordinate = rosterRowCoordinate(element);
    if (!repeat || !coordinate) return true;
    if (repeat.kind !== "docx.repeat-row") return false;
    return (
      repeat.part === coordinate.part &&
      repeat.tableIndex === coordinate.tableIndex &&
      repeat.rowIndex === coordinate.rowIndex
    );
  }

  function rosterInstallEntry(element) {
    const coordinate = rosterRowCoordinate(element);
    if (!coordinate) return;
    const form = document.querySelector("#documentFieldForm");
    if (!form || document.querySelector("#rosterAssistantEntry")) return;
    const row = rosterRowElements(element);
    if (row.length < 2) return;
    const compatible = rosterCurrentRepeatMatches(element);
    const linked = row.filter((candidate) => rosterExistingField(candidate)).length;
    const entry = document.createElement("section");
    entry.id = "rosterAssistantEntry";
    entry.className = `roster-assistant-entry${compatible ? "" : " is-warning"}`;
    entry.innerHTML = compatible
      ? `<div><strong>${linked > 0 ? "Изменить связи всей строки" : "Заполнить всю строку как список"}</strong><p>${linked > 0 ? `Сохранено связей: ${linked} из ${row.length}. Можно перепривязать, исключить колонку или изменить формат.` : `Найдено колонок: ${row.length}. Строка будет повторена для каждого участника.`}</p></div><button class="secondary-button" id="rosterAssistantOpen" type="button">${linked > 0 ? "Редактировать строку" : "Настроить строку"}</button>`
      : `<div><strong>В шаблоне выбрана другая повторяемая строка</strong><p>Выберите ячейку внутри уже настроенной строки. Один шаблон первой версии поддерживает одну повторяемую область.</p></div>`;
    form.parentElement?.insertBefore(entry, form);
    entry
      .querySelector("#rosterAssistantOpen")
      ?.addEventListener("click", () => void rosterOpen(element));
  }

  async function rosterFreshDraft() {
    const spaceId = globalThis.docomatorTemplateWizard?.spaceId() || "";
    const draftId = structureDraft?.id || structureWizardArtifacts().draftId || "";
    if (!spaceId || !draftId) {
      throw { message: "Черновик шаблона не найден. Постройте структуру заново." };
    }
    const body = await structureFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draftId)}`
    );
    structureDraft = body.data;
    return { spaceId, draft: body.data };
  }

  async function rosterOpen(element) {
    const detail = document.querySelector("#documentStructureSelection");
    if (!detail) return;
    const old = detail.querySelector("#rosterAssistantPanel");
    old?.remove();
    const loading = document.createElement("section");
    loading.id = "rosterAssistantPanel";
    loading.className = "roster-assistant-panel";
    loading.innerHTML = '<div class="roster-assistant-loading"><span aria-hidden="true">⏳</span><div><strong>Получаем сохранённые связи</strong><p>Проверяем актуальный черновик перед редактированием.</p></div></div>';
    detail.querySelector(".structure-selection-content")?.prepend(loading);
    try {
      await rosterFreshDraft();
      const row = rosterRowElements(element);
      if (row.length < 2) {
        throw { message: "В выбранной строке недостаточно ячеек для списка." };
      }
      const linked = row.filter((candidate) => rosterExistingField(candidate)).length;
      loading.innerHTML = `<div class="roster-assistant-heading"><div><p class="eyebrow">Таблица Word</p><h3>${linked > 0 ? "Связи повторяемой строки" : "Одна строка на каждого участника"}</h3><p>Для каждой колонки выберите значение. «Не заполнять» удаляет ранее сохранённую связь. Повторное сохранение без изменений допустимо.</p></div><button class="icon-button" id="rosterAssistantClose" type="button" aria-label="Закрыть мастер строки">×</button></div>
        <div class="roster-assistant-columns">${row.map(rosterCard).join("")}</div>
        <div class="roster-assistant-preview"><span aria-hidden="true">✓</span><div><strong>Как будет работать результат</strong><p>При сводном выпуске эта строка копируется для каждого участника. Номер по порядку вычисляется автоматически, остальные значения берутся из карточки.</p></div></div>
        <div class="form-error" id="rosterAssistantError" role="alert" hidden></div>
        <div class="roster-assistant-actions"><button class="secondary-button" id="rosterAssistantCancel" type="button">Отмена</button><button class="primary-button" id="rosterAssistantSave" type="button">Сохранить связи строки</button></div>`;
      loading
        .querySelector("#rosterAssistantClose")
        ?.addEventListener("click", () => loading.remove());
      loading
        .querySelector("#rosterAssistantCancel")
        ?.addEventListener("click", () => loading.remove());
      loading.querySelectorAll("[data-roster-mode]").forEach((select) =>
        select.addEventListener("change", () => rosterUpdateCard(select.closest("[data-roster-column]")))
      );
      loading.querySelectorAll("[data-roster-name-presentation]").forEach((select) =>
        select.addEventListener("change", () => rosterUpdateCard(select.closest("[data-roster-column]")))
      );
      loading
        .querySelector("#rosterAssistantSave")
        ?.addEventListener("click", () => void rosterSave(element, loading));
      loading.querySelectorAll("[data-roster-column]").forEach(rosterUpdateCard);
      requestAnimationFrame(() =>
        loading.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    } catch (error) {
      loading.innerHTML = `<div class="roster-assistant-loading is-error"><span aria-hidden="true">⚠️</span><div><strong>Строку открыть не удалось</strong><p>${structureEscape(error?.message || "Повторите действие.")}</p><button class="secondary-button" id="rosterAssistantRetry" type="button">Повторить</button></div></div>`;
      loading
        .querySelector("#rosterAssistantRetry")
        ?.addEventListener("click", () => void rosterOpen(element));
    }
  }

  function rosterUpdateCard(card) {
    if (!card) return;
    const mode = card.querySelector("[data-roster-mode]")?.value || "skip";
    const newFields = card.querySelector("[data-roster-new]");
    if (newFields) newFields.hidden = mode !== "new";
    const nameFields = card.querySelector("[data-roster-name-controls]");
    if (nameFields) nameFields.hidden = mode !== "system:name";
    const custom = card.querySelector("[data-roster-custom-pattern]");
    if (custom) {
      custom.hidden =
        mode !== "system:name" ||
        card.querySelector("[data-roster-name-presentation]")?.value !== "custom";
    }
    card.classList.toggle("is-skipped", mode === "skip");
  }

  async function rosterDefinitionFor(card, element) {
    const mode = card.querySelector("[data-roster-mode]")?.value || "skip";
    if (mode === "system:position") {
      return {
        key: "subject.position",
        label: "Номер по порядку",
        valueType: "integer",
        systemSource: "position"
      };
    }
    if (mode === "system:name") {
      return structureEffectiveDefinition(
        structureSystemPropertyDefinitions[0],
        element
      );
    }
    if (mode.startsWith("existing:")) {
      const key = mode.slice("existing:".length);
      const definition = structurePropertyDefinitions.find(
        (property) => property.key === key
      );
      if (definition) return definition;
      const existing = rosterExistingField(element);
      if (existing?.key === key) {
        return {
          key,
          label: existing.label,
          valueType: existing.valueType
        };
      }
      throw { message: "Выбранное поле больше не найдено. Обновите структуру." };
    }
    if (mode !== "new") return null;
    const label = card.querySelector("[data-roster-label]")?.value.trim() || "";
    const valueType = card.querySelector("[data-roster-type]")?.value || "string";
    if (!label) {
      throw { message: "Укажите название нового поля в каждой используемой колонке." };
    }
    const matches = structurePropertyDefinitions.filter(
      (property) => rosterNormalize(property.label) === rosterNormalize(label)
    );
    if (matches.length > 1) {
      throw {
        message: `Найдено несколько полей «${label}». Выберите конкретное существующее поле.`
      };
    }
    if (matches[0]) {
      if (matches[0].valueType !== valueType) {
        throw { message: `Поле «${label}» уже существует с другим типом.` };
      }
      return matches[0];
    }
    const body = await structureFetchJson(
      "/api/v1/knowledge/property-definitions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label,
          valueType,
          appliesTo: ["person"],
          sensitivity: /паспорт|снилс|адрес регистрации/u.test(
            rosterNormalize(label)
          )
            ? "restricted"
            : "internal"
        })
      }
    );
    structurePropertyDefinitions = [...structurePropertyDefinitions, body.data];
    return body.data;
  }

  function rosterPersonName(card, mode) {
    if (mode !== "system:name") return null;
    const presentation =
      card.querySelector("[data-roster-name-presentation]")?.value || "full";
    const pattern =
      presentation === "custom"
        ? card.querySelector("[data-roster-name-pattern]")?.value.trim() || ""
        : rosterNamePatterns[presentation];
    const error = structureNamePatternError(pattern);
    if (error) throw { message: error };
    return {
      sourceOrder:
        card.querySelector("[data-roster-name-source]")?.value ||
        "family-given-patronymic",
      pattern
    };
  }

  async function rosterDesiredField(card, element) {
    const mode = card.querySelector("[data-roster-mode]")?.value || "skip";
    if (mode === "skip") return null;
    let definition = await rosterDefinitionFor(card, element);
    if (!definition) return null;
    definition = structureEffectiveDefinition(definition, element);
    return {
      key: definition.key,
      label: definition.label,
      valueType: definition.valueType,
      required: Boolean(card.querySelector("[data-roster-required]")?.checked),
      personName: rosterPersonName(card, mode)
    };
  }

  async function rosterSave(anchor, panel) {
    if (rosterAssistantBusy) return;
    const errorBox = panel.querySelector("#rosterAssistantError");
    const button = panel.querySelector("#rosterAssistantSave");
    rosterAssistantBusy = true;
    button.disabled = true;
    button.textContent = "Сохраняем связи…";
    errorBox.hidden = true;
    try {
      const { spaceId, draft } = await rosterFreshDraft();
      const cards = [...panel.querySelectorAll("[data-roster-column]")];
      const actions = [];
      const desiredKeys = new Map();
      for (const card of cards) {
        const element = structureReport.elements.find(
          (candidate) => candidate.id === card.dataset.elementId
        );
        if (!element) {
          throw { message: "Одна из ячеек больше не найдена в структуре документа." };
        }
        const existing = draft.fields.find(
          (field) => field.elementId === element.id
        ) || null;
        const desired = await rosterDesiredField(card, element);
        if (desired) {
          const duplicateColumn = desiredKeys.get(desired.key);
          if (duplicateColumn) {
            throw {
              message: `Поле «${desired.label}» выбрано одновременно в колонках ${duplicateColumn} и ${Number(element.tableLocation?.columnIndex || 0) + 1}. Выберите разные поля.`
            };
          }
          desiredKeys.set(
            desired.key,
            Number(element.tableLocation?.columnIndex || 0) + 1
          );
        }
        actions.push({ card, element, existing, desired });
      }

      let repeatExists = Boolean(draft.repeatBinding);
      const saved = [];
      for (const action of actions.filter((item) => item.desired && item.existing)) {
        const body = await structureFetchJson(
          `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draft.id)}/fields/${encodeURIComponent(action.existing.id)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              key: action.desired.key,
              label: action.desired.label,
              valueType: action.desired.valueType,
              required: action.desired.required,
              ...(action.desired.personName
                ? { personName: action.desired.personName }
                : {})
            })
          }
        );
        saved.push(body.data.field);
      }
      for (const action of actions.filter((item) => item.desired && !item.existing)) {
        const body = await structureFetchJson(
          `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draft.id)}/fields`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              key: action.desired.key,
              label: action.desired.label,
              valueType: action.desired.valueType,
              required: action.desired.required,
              elementId: action.element.id,
              ...(!repeatExists ? { repeatRow: true } : {}),
              ...(action.desired.personName
                ? { personName: action.desired.personName }
                : {})
            })
          }
        );
        repeatExists = true;
        saved.push(body.data.field);
      }
      for (const action of actions.filter((item) => !item.desired && item.existing)) {
        await structureFetchJson(
          `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draft.id)}/fields/${encodeURIComponent(action.existing.id)}`,
          { method: "DELETE" }
        );
      }

      const fresh = await rosterFreshDraft();
      const linkedCount = fresh.draft.fields.filter((field) =>
        rosterRowElements(anchor).some((element) => element.id === field.elementId)
      ).length;
      globalThis.dispatchEvent(
        new CustomEvent("docomator:template-draft-fields-changed", {
          detail: {
            spaceId,
            draftId: draft.id,
            fieldCount: fresh.draft.fields.length
          }
        })
      );
      panel.innerHTML = `<div class="roster-assistant-finished"><span aria-hidden="true">✓</span><div><p class="eyebrow">Сохранено</p><h3>${linkedCount > 0 ? "Связи строки обновлены" : "Автоматическое заполнение строки отключено"}</h3><p>${linkedCount > 0 ? `Связано колонок: ${linkedCount}. Эту строку можно открывать и редактировать повторно.` : "Все связи удалены. Строка больше не будет копироваться для участников."}</p><div class="roster-assistant-actions"><button class="secondary-button" id="rosterAssistantMore" type="button">Вернуться к строке</button>${linkedCount > 0 ? '<button class="primary-button" id="rosterAssistantContinue" type="button">Перейти к пробной проверке</button>' : ""}</div></div></div>`;
      panel
        .querySelector("#rosterAssistantMore")
        ?.addEventListener("click", () => renderStructureSelection(anchor));
      panel
        .querySelector("#rosterAssistantContinue")
        ?.addEventListener("click", () => {
          globalThis.docomatorTemplateWizard?.complete(2, {
            sourceId:
              fresh.draft.sourceRecordId || structureWizardArtifacts().sourceId,
            draftId: fresh.draft.id
          });
        });
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent =
        error?.message || "Не удалось сохранить связи строки.";
      button.disabled = false;
      button.textContent = "Сохранить связи строки";
    } finally {
      rosterAssistantBusy = false;
    }
  }

  const rosterBaseRenderSelection = renderStructureSelection;
  renderStructureSelection = function renderStructureSelectionWithRoster(element) {
    rosterBaseRenderSelection(element);
    rosterInstallEntry(element);
  };
}
''',
)

write(
    "apps/api/ui/template-multi-trial-recovery.js",
    r'''{
  const multiTrialRememberedValues = new Map();
  let multiTrialLastRefreshMessage = "";

  function multiTrialDraftSignature(draft) {
    return JSON.stringify(
      (draft?.fields || []).map((field) => ({
        id: field.id,
        key: field.key,
        label: field.label,
        valueType: field.valueType,
        required: Boolean(field.required),
        elementId: field.elementId,
        formatter: field.formatter || null
      }))
    );
  }

  function multiTrialRememberCurrentValues() {
    const draft = selectedMultiTrialDraft();
    if (!draft) return;
    document
      .querySelectorAll("#templateMultiTrialFields [data-field-id]")
      .forEach((control) => {
        const field = draft.fields.find(
          (candidate) => candidate.id === control.dataset.fieldId
        );
        if (!field) return;
        multiTrialRememberedValues.set(`${draft.id}:id:${field.id}`, control.value);
        multiTrialRememberedValues.set(`${draft.id}:key:${field.key}`, control.value);
      });
  }

  function multiTrialRememberedValue(draft, field) {
    return (
      multiTrialRememberedValues.get(`${draft.id}:id:${field.id}`) ??
      multiTrialRememberedValues.get(`${draft.id}:key:${field.key}`) ??
      ""
    );
  }

  function multiTrialSafeExample(field, index) {
    const label = String(field.label || "").toLocaleLowerCase("ru-RU");
    if (field.valueType === "boolean") return "true";
    if (field.valueType === "number") return "123.45";
    if (field.valueType === "integer") return String(index + 1);
    if (field.valueType === "date") return "2026-07-25";
    if (field.valueType === "date-time") return "2026-07-25T12:30";
    if (/фио|имя участника|сотрудник|студент/u.test(label)) {
      return "Иванов Иван Иванович";
    }
    if (/руководител/u.test(label)) return "Петров Пётр Петрович";
    if (/тема/u.test(label)) return "Пример темы научной работы";
    if (/должност/u.test(label)) return "Инженер";
    if (field.valueType === "text") return `Пример текста для поля «${field.label}»`;
    return `Пример: ${field.label}`;
  }

  function multiTrialUpdateProgress() {
    const draft = selectedMultiTrialDraft();
    const progress = document.querySelector("#templateMultiTrialProgress");
    if (!draft || !progress) return;
    const controls = [...document.querySelectorAll("#templateMultiTrialFields [data-field-id]")];
    const filled = controls.filter((control) => String(control.value || "").trim() !== "").length;
    const requiredMissing = controls.filter((control) => {
      const field = draft.fields.find((candidate) => candidate.id === control.dataset.fieldId);
      return field?.required && String(control.value || "").trim() === "";
    }).length;
    progress.className = requiredMissing > 0 ? "is-warning" : "is-ready";
    progress.textContent = `Заполнено тестовых примеров: ${filled} из ${controls.length}.${requiredMissing > 0 ? ` Обязательных пустых полей: ${requiredMissing}.` : " Можно создавать пробную копию."}`;
  }

  renderMultiTrialFields = function renderMultiTrialFieldsRecovered() {
    multiTrialRememberCurrentValues();
    const draft = selectedMultiTrialDraft();
    const holder = document.querySelector("#templateMultiTrialFields");
    const count = document.querySelector("#templateMultiTrialCount");
    if (!draft || !holder || !count) return;
    count.textContent = `${draft.fields.length} полей будут записаны в одну копию и считаны обратно.`;
    holder.innerHTML = draft.fields
      .map(
        (field, index) => `
          <label class="multi-trial-field" data-multi-trial-field-key="${multiTrialEscape(field.key)}">
            <span><strong>${index + 1}. ${multiTrialEscape(field.label)}</strong>${field.required ? '<em>Обязательно</em>' : '<em>Необязательно</em>'}</span>
            ${fieldInput(field)}
            <small>${multiTrialEscape(multiTrialFieldTypeLabel(field.valueType))} · тестовое значение не сохраняется в карточке</small>
          </label>`
      )
      .join("");
    for (const field of draft.fields) {
      const control = holder.querySelector(
        `[data-field-id="${CSS.escape(field.id)}"]`
      );
      if (control) control.value = multiTrialRememberedValue(draft, field);
    }
    holder.querySelectorAll("[data-field-id]").forEach((control) => {
      control.addEventListener("input", () => {
        multiTrialRememberCurrentValues();
        multiTrialUpdateProgress();
      });
      control.addEventListener("change", () => {
        multiTrialRememberCurrentValues();
        multiTrialUpdateProgress();
      });
    });
    multiTrialUpdateProgress();
    void loadMultiTrialHistory();
  };

  renderMultiTrialWorkspace = function renderMultiTrialWorkspaceRecovered() {
    multiTrialRememberCurrentValues();
    const content = document.querySelector("#templateMultiTrialContent");
    if (!content) return;
    const usable = multiTrialDrafts.filter(
      (draft) =>
        draft.status === "draft" &&
        Array.isArray(draft.fields) &&
        (draft.fields.length >= 2 ||
          (draft.repeatBinding && draft.fields.length >= 1))
    );
    if (usable.length === 0) {
      content.innerHTML = `<div class="multi-trial-state"><span aria-hidden="true">📭</span><div><strong>Сначала сохраните поля шаблона</strong><p>Для общей проверки нужны не менее двух полей либо одна повторяемая строка. Вернитесь к структуре документа и свяжите нужные места.</p></div></div>`;
      return;
    }
    const previousId = selectedMultiTrialDraft()?.id || "";
    multiTrialDrafts = usable;
    const selectedId = usable.some((draft) => draft.id === previousId)
      ? previousId
      : usable[0].id;
    content.innerHTML = `
      <section class="multi-trial-purpose">
        <div><span aria-hidden="true">1</span><strong>Введите любые узнаваемые примеры</strong><p>Это не данные сотрудников. Примеры нужны только для проверки мест в шаблоне.</p></div>
        <div><span aria-hidden="true">2</span><strong>Система создаст отдельную копию</strong><p>Исходный DOCX/XLSX и карточки людей не изменяются.</p></div>
        <div><span aria-hidden="true">3</span><strong>Значения будут считаны обратно</strong><p>Версия сохранится только при полном совпадении.</p></div>
      </section>
      <form class="multi-trial-form" id="templateMultiTrialForm" novalidate>
        <label class="multi-trial-draft-select"><span>Проверяемый черновик</span><select id="templateMultiTrialDraft">${usable
          .map(
            (draft) =>
              `<option value="${multiTrialEscape(draft.id)}"${draft.id === selectedId ? " selected" : ""}>${multiTrialEscape(draft.title)} · ${draft.fields.length} полей</option>`
          )
          .join("")}</select><small id="templateMultiTrialCount"></small></label>
        <div class="multi-trial-tools"><button class="secondary-button" id="templateMultiTrialFillExamples" type="button">Заполнить безопасными примерами</button><button class="text-button" id="templateMultiTrialClearExamples" type="button">Очистить примеры</button><output id="templateMultiTrialProgress"></output></div>
        <div id="templateMultiTrialRefreshMessage" class="multi-trial-refresh-message"${multiTrialLastRefreshMessage ? "" : " hidden"}>${multiTrialEscape(multiTrialLastRefreshMessage)}</div>
        <div id="templateMultiTrialFields" class="multi-trial-fields"></div>
        <div class="multi-trial-actions"><button class="primary-button" id="templateMultiTrialSubmit" type="submit">Создать и проверить пробную копию</button><p id="templateMultiTrialMessage">После успешной проверки появятся две ссылки: техническая копия и копия с примерами.</p></div>
      </form>
      <div id="templateMultiTrialResult" class="multi-trial-result"></div>
      <section class="multi-trial-history"><div><p class="eyebrow">История</p><h3>Проверенные версии</h3></div><div id="templateMultiTrialHistory"></div></section>`;
    content
      .querySelector("#templateMultiTrialDraft")
      ?.addEventListener("change", renderMultiTrialFields);
    content
      .querySelector("#templateMultiTrialForm")
      ?.addEventListener("submit", submitMultiTrial);
    content
      .querySelector("#templateMultiTrialFillExamples")
      ?.addEventListener("click", () => {
        const draft = selectedMultiTrialDraft();
        if (!draft) return;
        draft.fields.forEach((field, index) => {
          const control = content.querySelector(
            `[data-field-id="${CSS.escape(field.id)}"]`
          );
          if (control && String(control.value || "").trim() === "") {
            control.value = multiTrialSafeExample(field, index);
          }
        });
        multiTrialRememberCurrentValues();
        multiTrialUpdateProgress();
      });
    content
      .querySelector("#templateMultiTrialClearExamples")
      ?.addEventListener("click", () => {
        content.querySelectorAll("[data-field-id]").forEach((control) => {
          control.value = "";
        });
        multiTrialRememberCurrentValues();
        multiTrialUpdateProgress();
      });
    renderMultiTrialFields();
  };

  async function multiTrialFetchFreshDraft(draft) {
    const body = await multiTrialFetchJson(
      `/api/v1/spaces/${encodeURIComponent(currentMultiTrialSpaceId())}/template-drafts/${encodeURIComponent(draft.id)}`
    );
    return body.data;
  }

  function multiTrialReplaceDraft(fresh) {
    const index = multiTrialDrafts.findIndex((draft) => draft.id === fresh.id);
    if (index >= 0) multiTrialDrafts[index] = fresh;
    else multiTrialDrafts.push(fresh);
  }

  submitMultiTrial = async function submitMultiTrialRecovered(event) {
    event.preventDefault();
    if (multiTrialBusy) return;
    multiTrialRememberCurrentValues();
    const staleDraft = selectedMultiTrialDraft();
    const form = event.currentTarget;
    const button = form.querySelector("#templateMultiTrialSubmit");
    const message = form.querySelector("#templateMultiTrialMessage");
    const result = document.querySelector("#templateMultiTrialResult");
    if (!staleDraft || !button || !message || !result) return;

    multiTrialBusy = true;
    button.disabled = true;
    message.className = "is-loading";
    message.textContent = "Сверяем список полей с текущим черновиком…";
    try {
      const freshDraft = await multiTrialFetchFreshDraft(staleDraft);
      if (
        multiTrialDraftSignature(freshDraft) !==
        multiTrialDraftSignature(staleDraft)
      ) {
        const before = staleDraft.fields.length;
        multiTrialReplaceDraft(freshDraft);
        multiTrialLastRefreshMessage = `Список полей обновлён: было ${before}, сейчас ${freshDraft.fields.length}. Уже введённые примеры сохранены. Заполните добавленные поля и повторите проверку.`;
        renderMultiTrialWorkspace();
        const refresh = document.querySelector("#templateMultiTrialRefreshMessage");
        if (refresh) {
          refresh.hidden = false;
          refresh.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }

      const values = freshDraft.fields.map((field) => {
        const control = form.querySelector(
          `[data-field-id="${CSS.escape(field.id)}"]`
        );
        if (!control) {
          throw new Error(
            `Поле «${field.label}» добавилось после открытия формы. Обновите список.`
          );
        }
        return { fieldId: field.id, value: parseFieldValue(control, field) };
      });
      message.textContent =
        "Записываем примеры в безопасную копию и считываем их обратно.";
      result.innerHTML = `<div class="multi-trial-state is-pending" role="status"><span aria-hidden="true">⏳</span><div><strong>Проверяем ${freshDraft.fields.length} полей</strong><p>Исходник и данные сотрудников не изменяются.</p></div></div>`;
      const body = await multiTrialFetchJson(
        `/api/v1/spaces/${encodeURIComponent(currentMultiTrialSpaceId())}/template-drafts/${encodeURIComponent(freshDraft.id)}/trial-all`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values })
        }
      );
      const data = body.data;
      multiTrialLastRefreshMessage = "";
      message.className = "is-success";
      message.textContent = `Проверено полей: ${data.version.fieldCount}. Пробная версия сохранена.`;
      result.innerHTML = `<article class="multi-trial-success"><div class="multi-trial-success-heading"><span aria-hidden="true">✅</span><div><strong>Проверенная версия ${data.version.versionNumber} готова</strong><p>Каждое значение найдено в готовом документе без расхождений.</p></div></div><div class="multi-trial-check-list">${data.version.fields
        .map(
          (field) =>
            `<div><span>${multiTrialEscape(field.fieldLabel)}</span><strong>${multiTrialEscape(field.readBackValue)}</strong></div>`
        )
        .join("")}</div><div class="multi-trial-downloads"><a class="secondary-button" href="${multiTrialEscape(data.downloads.compiled)}">Скачать копию для настройки</a><a class="primary-button" href="${multiTrialEscape(data.downloads.trial)}">Скачать копию с примерами</a></div><details><summary>Технические сведения</summary><dl><div><dt>Контрольная сумма технической копии</dt><dd><code>${multiTrialEscape(data.version.compiledSha256)}</code></dd></div><div><dt>Контрольная сумма проверенной копии</dt><dd><code>${multiTrialEscape(data.version.trialSha256)}</code></dd></div><div><dt>Идентификатор операции</dt><dd><code>${multiTrialEscape(body.correlationId || "не указан")}</code></dd></div></dl></details></article>`;
      globalThis.docomatorTemplateWizard?.complete(3, {
        draftId: freshDraft.id,
        versionId: data.version.id,
        versionKind: "multi"
      });
      await loadMultiTrialHistory();
    } catch (error) {
      message.className = "is-error";
      message.textContent =
        "Пробная версия не сохранена. Введённые примеры остались в форме.";
      result.innerHTML = `<div class="multi-trial-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Проверку завершить не удалось</strong><p>${multiTrialEscape(error?.message || "Исправьте значения и повторите действие.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${multiTrialEscape(error.operationId)}</code>.</small>` : ""}<button class="secondary-button" id="templateMultiTrialRefreshDraft" type="button">Обновить список полей</button></div></div>`;
      result
        .querySelector("#templateMultiTrialRefreshDraft")
        ?.addEventListener("click", async () => {
          try {
            const fresh = await multiTrialFetchFreshDraft(staleDraft);
            multiTrialReplaceDraft(fresh);
            multiTrialLastRefreshMessage =
              "Список полей обновлён. Введённые примеры сохранены по названиям полей.";
            renderMultiTrialWorkspace();
          } catch (refreshError) {
            message.textContent =
              refreshError?.message || "Обновить черновик не удалось.";
          }
        });
    } finally {
      multiTrialBusy = false;
      if (button.isConnected) button.disabled = false;
    }
  };

  globalThis.addEventListener(
    "docomator:template-draft-fields-changed",
    (event) => {
      const selected = selectedMultiTrialDraft();
      if (!selected || event.detail?.draftId !== selected.id) return;
      multiTrialRememberCurrentValues();
      multiTrialLastRefreshMessage =
        "Связи шаблона изменились. Перед проверкой список полей будет обновлён автоматически.";
      void loadMultiTrialDrafts();
    }
  );
}
''',
)

write(
    "apps/api/ui/group-management-v2.js",
    r'''{
  const groupV2 = {
    selectedIds: new Set(),
    page: 1,
    pageSize: 25,
    memberQuery: "",
    memberFilter: "all",
    statusFilter: "active",
    groupQuery: ""
  };

  function groupV2Employees() {
    return Array.isArray(state.data.employees) ? state.data.employees : [];
  }

  function groupV2EmployeeSearchText(employee) {
    const fields = employeeFields(employee)
      .map((field) => employeeValueLabel(field))
      .join(" ");
    return `${employee.displayName || ""} ${fields}`.toLocaleLowerCase("ru-RU");
  }

  function groupV2FilteredEmployees() {
    const query = groupV2.memberQuery.toLocaleLowerCase("ru-RU");
    return groupV2Employees().filter((employee) => {
      const id = employeeId(employee);
      const selected = groupV2.selectedIds.has(id);
      if (groupV2.statusFilter === "active" && employee.status !== "active") {
        return false;
      }
      if (groupV2.memberFilter === "selected" && !selected) return false;
      if (groupV2.memberFilter === "unselected" && selected) return false;
      return !query || groupV2EmployeeSearchText(employee).includes(query);
    });
  }

  function groupV2EnsureDialog() {
    const old = document.querySelector("#operatorGroupDialog");
    if (old?.dataset.groupManagerVersion === "2") return old;
    old?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "operatorGroupDialog";
    dialog.dataset.groupManagerVersion = "2";
    dialog.className = "create-dialog operator-group-dialog group-manager-v2";
    dialog.innerHTML = `<form id="operatorGroupForm" novalidate>
      <header class="dialog-header"><div><p class="eyebrow">Группы сотрудников</p><h2 id="operatorGroupTitle">Новая группа</h2><p>Состав сохраняется независимо от поиска и страниц. Группу можно использовать в документах и расписаниях.</p></div><button class="icon-button" id="operatorGroupClose" type="button" aria-label="Закрыть">×</button></header>
      <div class="dialog-body group-manager-layout">
        <aside class="group-manager-groups"><div class="group-manager-section-heading"><strong>Сохранённые группы</strong><button class="secondary-button compact-button" id="operatorGroupNew" type="button">Новая</button></div><label class="search-field"><span aria-hidden="true">⌕</span><input id="operatorGroupListSearch" type="search" placeholder="Найти группу" autocomplete="off" /></label><div id="operatorGroupList" class="group-manager-group-list"></div></aside>
        <section class="group-manager-editor">
          <div class="operator-new-field-grid"><label class="field"><span>Название</span><input id="operatorGroupName" type="text" maxlength="500" required placeholder="Например, Студенты М-21" /></label><label class="field"><span>Описание</span><input id="operatorGroupDescription" type="text" maxlength="2000" placeholder="Необязательно" /></label></div>
          <div class="group-manager-summary"><div><strong id="operatorGroupSelectedCount">0</strong><span>в группе</span></div><div><strong id="operatorGroupFoundCount">0</strong><span>найдено</span></div><div><strong id="operatorGroupTotalCount">0</strong><span>всего</span></div></div>
          <div class="group-manager-member-tools"><label class="search-field"><span aria-hidden="true">⌕</span><input id="operatorGroupSearch" type="search" placeholder="ФИО, должность или подразделение" autocomplete="off" /></label><label class="field compact"><span>Показывать</span><select id="operatorGroupMemberFilter"><option value="all">Всех</option><option value="selected">Только в группе</option><option value="unselected">Только не выбранных</option></select></label><label class="field compact"><span>Статус</span><select id="operatorGroupStatusFilter"><option value="active">Только работающих</option><option value="all">Все статусы</option></select></label><label class="field compact"><span>На странице</span><select id="operatorGroupPageSize"><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label></div>
          <div class="group-manager-bulk-actions"><button class="secondary-button compact-button" id="operatorGroupAddFound" type="button">Добавить всех найденных</button><button class="secondary-button compact-button" id="operatorGroupRemoveFound" type="button">Убрать всех найденных</button><button class="text-button" id="operatorGroupClear" type="button">Очистить группу</button></div>
          <div id="operatorGroupMembers" class="operator-group-members group-manager-members"></div>
          <nav class="group-manager-pagination" aria-label="Страницы сотрудников"><button class="secondary-button compact-button" id="operatorGroupPreviousPage" type="button">Назад</button><span id="operatorGroupPageLabel"></span><button class="secondary-button compact-button" id="operatorGroupNextPage" type="button">Вперёд</button></nav>
          <div class="form-error" id="operatorGroupError" role="alert" hidden></div>
        </section>
      </div>
      <footer class="dialog-footer"><div><p class="save-explanation" id="operatorGroupMessage">Пустую группу можно сохранить и заполнить позже.</p><button class="text-button is-danger" id="operatorGroupArchive" type="button" hidden>Архивировать группу</button></div><div><button class="secondary-button" id="operatorGroupCancel" type="button">Отмена</button><button class="primary-button" id="operatorGroupSave" type="submit">Создать группу</button></div></footer>
    </form>`;
    document.body.append(dialog);
    dialog.querySelector("#operatorGroupClose")?.addEventListener("click", () => dialog.close());
    dialog.querySelector("#operatorGroupCancel")?.addEventListener("click", () => dialog.close());
    dialog.querySelector("#operatorGroupNew")?.addEventListener("click", () => void groupV2SelectGroup(""));
    dialog.querySelector("#operatorGroupListSearch")?.addEventListener("input", (event) => {
      groupV2.groupQuery = event.target.value.trim();
      groupV2RenderGroupList();
    });
    dialog.querySelector("#operatorGroupSearch")?.addEventListener("input", (event) => {
      groupV2.memberQuery = event.target.value.trim();
      groupV2.page = 1;
      groupV2RenderMembers();
    });
    dialog.querySelector("#operatorGroupMemberFilter")?.addEventListener("change", (event) => {
      groupV2.memberFilter = event.target.value;
      groupV2.page = 1;
      groupV2RenderMembers();
    });
    dialog.querySelector("#operatorGroupStatusFilter")?.addEventListener("change", (event) => {
      groupV2.statusFilter = event.target.value;
      groupV2.page = 1;
      groupV2RenderMembers();
    });
    dialog.querySelector("#operatorGroupPageSize")?.addEventListener("change", (event) => {
      groupV2.pageSize = Number(event.target.value) || 25;
      groupV2.page = 1;
      groupV2RenderMembers();
    });
    dialog.querySelector("#operatorGroupAddFound")?.addEventListener("click", () => {
      groupV2FilteredEmployees().forEach((employee) => groupV2.selectedIds.add(employeeId(employee)));
      groupV2RenderMembers();
    });
    dialog.querySelector("#operatorGroupRemoveFound")?.addEventListener("click", () => {
      groupV2FilteredEmployees().forEach((employee) => groupV2.selectedIds.delete(employeeId(employee)));
      groupV2RenderMembers();
    });
    dialog.querySelector("#operatorGroupClear")?.addEventListener("click", () => {
      groupV2.selectedIds.clear();
      groupV2RenderMembers();
    });
    dialog.querySelector("#operatorGroupPreviousPage")?.addEventListener("click", () => {
      groupV2.page = Math.max(1, groupV2.page - 1);
      groupV2RenderMembers();
    });
    dialog.querySelector("#operatorGroupNextPage")?.addEventListener("click", () => {
      groupV2.page += 1;
      groupV2RenderMembers();
    });
    dialog.querySelector("#operatorGroupMembers")?.addEventListener("change", (event) => {
      const control = event.target.closest("[data-operator-group-member]");
      if (!control) return;
      if (control.checked) groupV2.selectedIds.add(control.value);
      else groupV2.selectedIds.delete(control.value);
      groupV2RenderCounts();
    });
    dialog.querySelector("#operatorGroupArchive")?.addEventListener("click", () => void groupV2Archive());
    dialog.querySelector("#operatorGroupForm")?.addEventListener("submit", groupV2Save);
    return dialog;
  }

  function groupV2RenderCounts() {
    const filtered = groupV2FilteredEmployees();
    const set = (selector, value) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = String(value);
    };
    set("#operatorGroupSelectedCount", groupV2.selectedIds.size);
    set("#operatorGroupFoundCount", filtered.length);
    set("#operatorGroupTotalCount", groupV2Employees().length);
    const message = document.querySelector("#operatorGroupMessage");
    if (message) {
      message.textContent = groupV2.selectedIds.size > 0
        ? `Будет сохранено участников: ${groupV2.selectedIds.size}. Поиск и страницы не меняют состав.`
        : "Группа пока пустая. Её можно сохранить и заполнить позже.";
    }
  }

  function groupV2RenderGroupList() {
    const root = document.querySelector("#operatorGroupList");
    if (!root) return;
    const query = groupV2.groupQuery.toLocaleLowerCase("ru-RU");
    const groups = state.data.groups.filter((group) =>
      !query || `${group.name} ${group.description || ""}`.toLocaleLowerCase("ru-RU").includes(query)
    );
    root.innerHTML = groups.length > 0
      ? groups.map((group) => `<button class="group-manager-group${operatorState.groupEditingId === group.id ? " is-active" : ""}" type="button" data-group-v2-open="${escapeHtml(group.id)}"><span><strong>${escapeHtml(group.name)}</strong>${group.status === "archived" ? '<em>Архив</em>' : ""}</span><small>${group.memberCount} участников${group.description ? ` · ${escapeHtml(group.description)}` : ""}</small></button>`).join("")
      : '<div class="group-manager-empty">Группы не найдены.</div>';
    root.querySelectorAll("[data-group-v2-open]").forEach((button) =>
      button.addEventListener("click", () => void groupV2SelectGroup(button.dataset.groupV2Open))
    );
  }

  function groupV2RenderMembers() {
    const root = document.querySelector("#operatorGroupMembers");
    if (!root) return;
    const filtered = groupV2FilteredEmployees();
    const pages = Math.max(1, Math.ceil(filtered.length / groupV2.pageSize));
    groupV2.page = Math.min(Math.max(1, groupV2.page), pages);
    const start = (groupV2.page - 1) * groupV2.pageSize;
    const pageItems = filtered.slice(start, start + groupV2.pageSize);
    root.innerHTML = pageItems.length > 0
      ? pageItems.map((employee) => {
          const id = employeeId(employee);
          return `<label class="operator-group-member"><input type="checkbox" data-operator-group-member value="${escapeHtml(id)}"${groupV2.selectedIds.has(id) ? " checked" : ""} /><span>${escapeHtml(employee.displayName)}</span><small>${escapeHtml(employeeStatusLabel(employee.status))}</small></label>`;
        }).join("")
      : '<div class="group-manager-empty">По заданным условиям сотрудников нет.</div>';
    const label = document.querySelector("#operatorGroupPageLabel");
    if (label) label.textContent = `Страница ${groupV2.page} из ${pages} · показано ${pageItems.length}`;
    const previous = document.querySelector("#operatorGroupPreviousPage");
    const next = document.querySelector("#operatorGroupNextPage");
    if (previous) previous.disabled = groupV2.page <= 1;
    if (next) next.disabled = groupV2.page >= pages;
    groupV2RenderCounts();
  }

  async function groupV2SelectGroup(groupId) {
    operatorState.groupEditingId = groupId || null;
    groupV2.selectedIds = new Set();
    groupV2.page = 1;
    const group = state.data.groups.find((candidate) => candidate.id === groupId);
    document.querySelector("#operatorGroupTitle").textContent = groupId ? "Изменить группу" : "Новая группа";
    document.querySelector("#operatorGroupSave").textContent = groupId ? "Сохранить изменения" : "Создать группу";
    document.querySelector("#operatorGroupName").value = group?.name || "";
    document.querySelector("#operatorGroupDescription").value = group?.description || "";
    const archive = document.querySelector("#operatorGroupArchive");
    if (archive) archive.hidden = !groupId || group?.status === "archived";
    groupV2RenderGroupList();
    if (!groupId) {
      groupV2RenderMembers();
      return;
    }
    document.querySelector("#operatorGroupMembers").innerHTML = '<div class="employee-inline-loading"><span class="state-mark" aria-hidden="true"></span><span>Получаем полный состав группы…</span></div>';
    try {
      const body = await api(spaceEndpoint(`/groups/${encodeURIComponent(groupId)}/members`));
      groupV2.selectedIds = new Set((body?.data || []).map((member) => member.entityId));
      groupV2RenderMembers();
    } catch (error) {
      const box = document.querySelector("#operatorGroupError");
      box.hidden = false;
      box.textContent = error?.message || "Состав группы получить не удалось.";
    }
  }

  async function groupV2Open({ selectAll = false } = {}) {
    const dialog = groupV2EnsureDialog();
    if (!state.employee.loaded) await loadEmployees();
    await loadCurrentSpaceData();
    groupV2.memberQuery = "";
    groupV2.memberFilter = "all";
    groupV2.statusFilter = "active";
    groupV2.page = 1;
    groupV2.pageSize = 25;
    groupV2.groupQuery = "";
    dialog.querySelector("#operatorGroupListSearch").value = "";
    dialog.querySelector("#operatorGroupSearch").value = "";
    dialog.querySelector("#operatorGroupMemberFilter").value = "all";
    dialog.querySelector("#operatorGroupStatusFilter").value = "active";
    dialog.querySelector("#operatorGroupPageSize").value = "25";
    dialog.querySelector("#operatorGroupError").hidden = true;
    await groupV2SelectGroup("");
    if (selectAll) {
      groupV2FilteredEmployees().forEach((employee) => groupV2.selectedIds.add(employeeId(employee)));
      groupV2RenderMembers();
    }
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => document.querySelector("#operatorGroupName")?.focus());
  }

  async function groupV2Save(event) {
    event.preventDefault();
    const name = document.querySelector("#operatorGroupName")?.value.trim() || "";
    const errorBox = document.querySelector("#operatorGroupError");
    if (!name) {
      errorBox.hidden = false;
      errorBox.textContent = "Укажите название группы.";
      return;
    }
    const button = document.querySelector("#operatorGroupSave");
    button.disabled = true;
    button.textContent = "Сохраняем состав…";
    errorBox.hidden = true;
    try {
      let groupId = operatorState.groupEditingId;
      if (groupId) {
        await api(spaceEndpoint(`/groups/${encodeURIComponent(groupId)}`), {
          method: "PUT",
          body: JSON.stringify({
            name,
            description:
              document.querySelector("#operatorGroupDescription")?.value.trim() || null
          })
        });
      } else {
        const body = await api(spaceEndpoint("/groups"), {
          method: "POST",
          body: JSON.stringify({
            name,
            description:
              document.querySelector("#operatorGroupDescription")?.value.trim() || undefined
          })
        });
        groupId = body.data.id;
      }
      await api(spaceEndpoint(`/groups/${encodeURIComponent(groupId)}/members`), {
        method: "PUT",
        body: JSON.stringify({ entityIds: [...groupV2.selectedIds] })
      });
      document.querySelector("#operatorGroupDialog").close();
      await loadCurrentSpaceData();
      notify("✅", "Группа сохранена", `Участников: ${groupV2.selectedIds.size}. Состав доступен в выпусках и расписаниях.`);
      window.dispatchEvent(new CustomEvent("docomator:groups-changed", { detail: { spaceId: state.currentSpaceId } }));
    } catch (cause) {
      const error = cause instanceof ApiError ? cause : new ApiError("Не удалось сохранить группу.");
      errorBox.hidden = false;
      errorBox.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = operatorState.groupEditingId ? "Сохранить изменения" : "Создать группу";
    }
  }

  async function groupV2Archive() {
    const groupId = operatorState.groupEditingId;
    if (!groupId) return;
    const button = document.querySelector("#operatorGroupArchive");
    button.disabled = true;
    try {
      await api(spaceEndpoint(`/groups/${encodeURIComponent(groupId)}`), {
        method: "PUT",
        body: JSON.stringify({ status: "archived" })
      });
      await loadCurrentSpaceData();
      notify("✅", "Группа архивирована", "Она больше не предлагается для новых запусков, но история сохранена.");
      await groupV2SelectGroup("");
    } catch (error) {
      const box = document.querySelector("#operatorGroupError");
      box.hidden = false;
      box.textContent = error?.message || "Архивировать группу не удалось.";
    } finally {
      button.disabled = false;
    }
  }

  operatorEnsureGroupDialog = groupV2EnsureDialog;
  operatorOpenGroupManager = groupV2Open;
  operatorSelectGroup = groupV2SelectGroup;
  operatorSaveGroup = groupV2Save;
}
''',
)

write(
    "apps/api/ui/template-ux-recovery.css",
    r'''.structure-placement-explained {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.85rem;
  align-items: start;
}

.structure-placement-explained p,
.structure-placement-explained ol {
  margin: 0.35rem 0;
}

.structure-placement-explained ol {
  padding-left: 1.2rem;
  color: var(--muted);
}

.structure-placement-step {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border-radius: 50%;
  color: var(--success);
  background: var(--success-soft);
  font-weight: 800;
}

.roster-column-description > div {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}

.roster-assistant-column.is-skipped {
  opacity: 0.72;
  border-style: dashed;
}

.roster-recommendation {
  display: block;
  margin-top: 0.3rem;
  color: var(--warning);
}

.roster-name-controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
  grid-column: 1 / -1;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--surface);
}

.roster-name-controls[hidden],
.roster-name-controls [hidden] {
  display: none;
}

.roster-name-controls [data-roster-custom-pattern] {
  grid-column: 1 / -1;
}

.roster-assistant-loading {
  display: flex;
  align-items: start;
  gap: 0.75rem;
  padding: 1rem;
}

.roster-assistant-loading p,
.roster-assistant-loading strong {
  margin: 0;
}

.roster-assistant-loading p {
  margin-top: 0.25rem;
  color: var(--muted);
}

.roster-assistant-loading.is-error {
  color: var(--danger);
}

.multi-trial-purpose {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.multi-trial-purpose > div {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.65rem;
  padding: 0.8rem;
  border: 1px solid var(--border);
  border-radius: 0.8rem;
  background: var(--surface-2);
}

.multi-trial-purpose span {
  display: grid;
  width: 1.8rem;
  height: 1.8rem;
  place-items: center;
  border-radius: 50%;
  color: var(--accent-strong);
  background: var(--accent-soft);
  font-weight: 800;
}

.multi-trial-purpose strong,
.multi-trial-purpose p {
  margin: 0;
}

.multi-trial-purpose p {
  grid-column: 2;
  color: var(--muted);
  font-size: 0.78rem;
}

.multi-trial-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
}

.multi-trial-tools output {
  margin-left: auto;
  color: var(--muted);
  font-size: 0.78rem;
}

.multi-trial-tools output.is-ready {
  color: var(--success);
}

.multi-trial-tools output.is-warning {
  color: var(--warning);
}

.multi-trial-refresh-message {
  padding: 0.8rem 0.9rem;
  border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border));
  border-radius: 0.75rem;
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 9%, var(--surface));
}

@media (max-width: 900px) {
  .multi-trial-purpose,
  .roster-name-controls {
    grid-template-columns: 1fr;
  }

  .multi-trial-purpose p,
  .roster-name-controls [data-roster-custom-pattern] {
    grid-column: auto;
  }
}
''',
)

write(
    "apps/api/ui/group-management-v2.css",
    r'''.group-manager-v2 {
  width: min(96vw, 1180px);
  max-height: 94vh;
}

.group-manager-layout {
  display: grid;
  grid-template-columns: minmax(15rem, 19rem) minmax(0, 1fr);
  gap: 1rem;
}

.group-manager-groups,
.group-manager-editor {
  min-width: 0;
}

.group-manager-groups {
  display: grid;
  align-content: start;
  gap: 0.7rem;
  padding-right: 0.9rem;
  border-right: 1px solid var(--border);
}

.group-manager-section-heading,
.group-manager-group > span,
.group-manager-bulk-actions,
.group-manager-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
}

.group-manager-group-list {
  display: grid;
  gap: 0.35rem;
  max-height: 53vh;
  overflow: auto;
}

.group-manager-group {
  display: grid;
  gap: 0.25rem;
  width: 100%;
  padding: 0.7rem;
  border: 1px solid transparent;
  border-radius: 0.7rem;
  color: inherit;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.group-manager-group:hover,
.group-manager-group:focus-visible {
  border-color: var(--border);
  background: var(--surface-2);
  outline: none;
}

.group-manager-group.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.group-manager-group em {
  padding: 0.1rem 0.35rem;
  border-radius: 999px;
  color: var(--muted);
  background: var(--surface-2);
  font-size: 0.65rem;
  font-style: normal;
}

.group-manager-group small {
  color: var(--muted);
}

.group-manager-editor {
  display: grid;
  align-content: start;
  gap: 0.8rem;
}

.group-manager-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
}

.group-manager-summary > div {
  display: grid;
  gap: 0.1rem;
  padding: 0.65rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 0.7rem;
  background: var(--surface-2);
}

.group-manager-summary strong {
  font-size: 1.2rem;
}

.group-manager-summary span {
  color: var(--muted);
  font-size: 0.7rem;
}

.group-manager-member-tools {
  display: grid;
  grid-template-columns: minmax(14rem, 1.5fr) repeat(3, minmax(8.5rem, 0.7fr));
  align-items: end;
  gap: 0.6rem;
}

.group-manager-member-tools .compact {
  min-width: 0;
}

.group-manager-bulk-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.group-manager-members {
  min-height: 18rem;
  max-height: 45vh;
  overflow: auto;
}

.group-manager-pagination {
  justify-content: center;
}

.group-manager-pagination span {
  min-width: 12rem;
  color: var(--muted);
  text-align: center;
  font-size: 0.76rem;
}

.group-manager-empty {
  padding: 1rem;
  color: var(--muted);
  text-align: center;
}

.is-danger {
  color: var(--danger) !important;
}

@media (max-width: 980px) {
  .group-manager-layout,
  .group-manager-member-tools {
    grid-template-columns: 1fr;
  }

  .group-manager-groups {
    padding-right: 0;
    padding-bottom: 0.9rem;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .group-manager-group-list {
    max-height: 14rem;
  }
}

@media (max-width: 620px) {
  .group-manager-summary {
    grid-template-columns: 1fr;
  }

  .group-manager-bulk-actions > *,
  .group-manager-pagination > button {
    flex: 1 1 100%;
  }
}
''',
)

# Remove the obsolete experimental row editor; the maintained assistant above now owns the flow.
obsolete = ROOT / "apps/api/ui/template-row-editor-v2.js"
if obsolete.exists():
    obsolete.unlink()
    print("removed apps/api/ui/template-row-editor-v2.js")

ui_path = "apps/api/src/ui-routes.ts"
ui = read(ui_path)
for marker, additions in [
    (
        '      "template-repeat-assistant.css",\n',
        ['      "template-ux-recovery.css",\n'],
    ),
    (
        '      "operator-workflows.css",\n',
        ['      "group-management-v2.css",\n'],
    ),
    (
        '      "operator-workflows-recovery.js",\n',
        ['      "group-management-v2.js",\n'],
    ),
    (
        '      "document-structure.js",\n',
        ['      "template-placement-guidance.js",\n'],
    ),
    (
        '      "template-multi-trial.js",\n',
        ['      "template-multi-trial-recovery.js",\n'],
    ),
]:
    for addition in additions:
        if addition.strip() not in ui:
            if marker not in ui:
                raise RuntimeError(f"UI bundle marker missing: {marker!r}")
            ui = ui.replace(marker, marker + addition, 1)
write(ui_path, ui)

check_path = "scripts/ci/check-ui-bundles.mjs"
check = read(check_path)
for marker, addition in [
    ('    "operator-workflows-recovery.js",\n', '    "group-management-v2.js",\n'),
    ('    "document-structure.js",\n', '    "template-placement-guidance.js",\n'),
    ('    "template-multi-trial.js",\n', '    "template-multi-trial-recovery.js",\n'),
]:
    if addition.strip() not in check:
        if marker not in check:
            raise RuntimeError(f"UI check marker missing: {marker!r}")
        check = check.replace(marker, marker + addition, 1)
write(check_path, check)

package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
check_ui = package["scripts"].get("check:ui", "")
for file in [
    "apps/api/ui/template-placement-guidance.js",
    "apps/api/ui/template-repeat-assistant.js",
    "apps/api/ui/template-multi-trial-recovery.js",
    "apps/api/ui/group-management-v2.js",
]:
    command = f"node --check {file}"
    if command not in check_ui:
        check_ui = f"{check_ui} && {command}" if check_ui else command
package["scripts"]["check:ui"] = check_ui
package_path.write_text(
    json.dumps(package, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print("updated package.json")

print("client integration prepared")
