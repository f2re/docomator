from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def patch(path: str, old: str, new: str, *, required: bool = True) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    if old in value:
        target.write_text(value.replace(old, new, 1), encoding="utf-8")
        print(f"updated {path}")
        return
    if required and new not in value:
        raise RuntimeError(f"{path}: expected fragment was not found: {old[:120]!r}")


patch(
    "packages/storage/src/template-draft-field-editor.ts",
    '''    const now = context.now === undefined ? new Date() : new Date(context.now);
''',
    '''    const now =
      context.now === undefined
        ? new Date()
        : context.now instanceof Date
          ? context.now
          : new Date(context.now);
''',
)

patch(
    "apps/api/src/template-draft-field-edit-routes.test.ts",
    '''<w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr>''',
    '''<w:tr><w:tc><w:p><w:r><w:t>____</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>____</w:t></w:r></w:p></w:tc></w:tr>''',
)

patch(
    "apps/api/src/template-draft-field-edit-routes.test.ts",
    '''    assert.equal(dataRow.length, 2);

    const first = await app.inject({''',
    '''    assert.equal(dataRow.length, 2);
    const firstElement = dataRow[0];
    const secondElement = dataRow[1];
    assert.ok(firstElement);
    assert.ok(secondElement);

    const first = await app.inject({''',
)
patch(
    "apps/api/src/template-draft-field-edit-routes.test.ts",
    '''        elementId: dataRow[0].id,''',
    '''        elementId: firstElement.id,''',
)
patch(
    "apps/api/src/template-draft-field-edit-routes.test.ts",
    '''        elementId: dataRow[1].id''',
    '''        elementId: secondElement.id''',
)

# A position header should repair an old accidental FIO link when the row is saved.
patch(
    "apps/api/ui/template-repeat-assistant.js",
    '''    const mode = existing ? rosterModeForExisting(existing) : rosterSuggestedMode(label);
    const semantic = rosterSemantic(label);''',
    '''    const semantic = rosterSemantic(label);
    const storedMode = existing ? rosterModeForExisting(existing) : "";
    const mode =
      existing && semantic === "position" && storedMode === "system:name"
        ? "system:position"
        : existing
          ? storedMode
          : rosterSuggestedMode(label);''',
)

# Keep a visible warning when the stored field and the column heading disagree.
patch(
    "apps/api/ui/template-repeat-assistant.js",
    '''    const recommendation =
      semantic === "position" && mode !== "system:position"
        ? `<small class="roster-recommendation">Рекомендуется «Номер по порядку».</small>`
        : "";''',
    '''    const existingSemantic = existing ? rosterSemantic(existing.label) : "";
    const recommendation =
      semantic === "position" && storedMode === "system:name"
        ? '<small class="roster-recommendation">Исправлено предложение: колонка номера будет заполнена значением 1, 2, 3… вместо ФИО.</small>'
        : existing && semantic && existingSemantic && semantic !== existingSemantic
          ? `<small class="roster-recommendation">Проверьте связь: заголовок колонки и сохранённое поле «${structureEscape(existing.label)}» не совпадают по смыслу.</small>`
          : semantic === "position" && mode !== "system:position"
            ? '<small class="roster-recommendation">Рекомендуется «Номер по порядку».</small>'
            : "";''',
)

# The E2E mock exposes validation and formatter metadata just like the real API.
patch(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''        appliesTo: payload.appliesTo || ["person"],
        aliases: payload.aliases || [],
        validation: payload.validation || {}''',
    '''        appliesTo: payload.appliesTo || ["person"],
        aliases: payload.aliases || [],
        validation: payload.validation || {},
        unit: payload.unit || null,
        description: payload.description || null''',
    required=False,
)

print("known strict-check issues fixed")
