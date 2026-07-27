from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / "apps/api/ui/template-row-editor-v2.js"
value = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global value
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"expected one occurrence, found {count}: {old[:100]}")
    value = value.replace(old, new, 1)


replace_once(
    '''    const previous = select.value;
    const suggested = rowEditorSuggestedMode(element, existing, group);
    select.innerHTML = rowEditorPropertyOptions(previous || suggested, existing, group);
    if (![...select.options].some((option) => option.value === select.value)) {
      select.value = suggested;
    }''',
    '''    const previous = select.value;
    const suggested = rowEditorSuggestedMode(element, existing, group);
    const available = new Set(
      rowEditorApplicableProperties(group, existing).map(
        (definition) => `existing:${definition.key}`
      )
    );
    const preserved =
      ["skip", "system:position", "system:name", "new"].includes(previous) ||
      available.has(previous) ||
      (existing && previous.startsWith("current:"));
    const selected = preserved ? previous : suggested;
    select.innerHTML = rowEditorPropertyOptions(selected, existing, group);
    select.value = selected;'''
)
replace_once(
    '''              : mode === "new"
                ? "Будет создано общее поле карточки."
                : "Значение будет взято из выбранного поля карточки.";''',
    '''              : mode === "new"
                ? `Будет создано поле в разделе «${globalThis.docomatorFieldGroups.label(card.querySelector("[data-row-editor-group]")?.value || "common")}».`
                : "Значение будет взято из выбранного поля карточки.";'''
)
replace_once(
    '''    if (mode !== "new") return null;
    const label = card.querySelector("[data-row-editor-label]")?.value?.trim() || "";''',
    '''    if (mode !== "new") return null;
    if (fieldGroup === "unassigned") {
      throw new Error(
        "Для нового поля выберите конкретный раздел: общие сведения, преподаватель или студент."
      );
    }
    const label = card.querySelector("[data-row-editor-label]")?.value?.trim() || "";'''
)
path.write_text(value, encoding="utf-8")
print("refined template field group selection")
