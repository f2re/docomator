from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_count(relative: str, old: str, new: str, expected: int) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != expected:
        raise RuntimeError(f"{relative}: expected {expected} occurrences, found {count}")
    path.write_text(value.replace(old, new), encoding="utf-8")
    print(f"updated {relative}: {count}")


replace_count(
    "tests/e2e/template-and-generation.spec.mjs",
    '.locator("#documentFieldProperty").selectOption("__new__")',
    '.locator("#documentFieldProperty").selectOption("__new__", { force: true })',
    4
)
replace_count(
    "tests/e2e/word-roster-assistant.spec.mjs",
    '.locator("[data-row-editor-mode]").selectOption("skip")',
    '.locator("[data-row-editor-mode]").selectOption("skip", { force: true })',
    1
)
print("searchable select E2E compatibility updated")
