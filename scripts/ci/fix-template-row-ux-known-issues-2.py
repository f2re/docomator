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


# Delete intentionally excluded columns before assigning their former field to another column.
patch(
    "apps/api/ui/template-repeat-assistant.js",
    '''      let repeatExists = Boolean(draft.repeatBinding);
      const saved = [];
      for (const action of actions.filter((item) => item.desired && item.existing)) {''',
    '''      let repeatExists = Boolean(draft.repeatBinding);
      const saved = [];
      for (const action of actions.filter((item) => !item.desired && item.existing)) {
        const deleted = await structureFetchJson(
          `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draft.id)}/fields/${encodeURIComponent(action.existing.id)}`,
          { method: "DELETE" }
        );
        repeatExists = Boolean(deleted.data.repeatBinding);
      }
      for (const action of actions.filter((item) => item.desired && item.existing)) {''',
)
patch(
    "apps/api/ui/template-repeat-assistant.js",
    '''      for (const action of actions.filter((item) => !item.desired && item.existing)) {
        await structureFetchJson(
          `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draft.id)}/fields/${encodeURIComponent(action.existing.id)}`,
          { method: "DELETE" }
        );
      }

      const fresh = await rosterFreshDraft();''',
    '''      const fresh = await rosterFreshDraft();''',
)

# Update every regression assertion that still expects the former vague server message.
old_message = (
    "Для общей проверки заполните все поля текущего черновика без посторонних "
    "идентификаторов."
)
new_message = (
    "Состав полей черновика изменился после открытия формы. Система обновит список; "
    "заполните добавленные поля и повторите проверку."
)
for target in ROOT.rglob("*"):
    if not target.is_file() or target.suffix.lower() not in {
        ".ts",
        ".js",
        ".mjs",
        ".md",
        ".json"
    }:
        continue
    try:
        value = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    if old_message in value:
        target.write_text(value.replace(old_message, new_message), encoding="utf-8")
        print(f"updated {target.relative_to(ROOT)}")

# The mock exposes the real number of groups in the space selector.
fixture = ROOT / "tests/e2e/fixtures/docomator-api.mjs"
value = fixture.read_text(encoding="utf-8")
value = value.replace(
    '''          groupCount: 0
''',
    '''          groupCount: state.primary.groups.length
''',
    1,
)
value = value.replace(
    '''                groupCount: 0
''',
    '''                groupCount: state.secondary.groups.length
''',
    1,
)
fixture.write_text(value, encoding="utf-8")
print("updated tests/e2e/fixtures/docomator-api.mjs")

print("second strict-check pass applied")
