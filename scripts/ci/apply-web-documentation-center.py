from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, value: str) -> None:
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value, encoding="utf-8")
    print(f"updated {relative}")


def insert_after(relative: str, marker: str, addition: str) -> None:
    value = read(relative)
    if addition.strip() in value:
        return
    if marker not in value:
        raise RuntimeError(f"{relative}: marker not found: {marker!r}")
    write(relative, value.replace(marker, marker + addition, 1))


# Replace the temporary quick-start placeholder and remove the temporary marker.
quick_source = ROOT / "docs/QUICK_START_NEW.md"
if not quick_source.exists():
    raise RuntimeError("docs/QUICK_START_NEW.md was not found")
(ROOT / "docs/QUICK_START.md").write_text(
    quick_source.read_text(encoding="utf-8"), encoding="utf-8"
)
quick_source.unlink()
work_marker = ROOT / "docs/.documentation-work-in-progress"
if work_marker.exists():
    work_marker.unlink()
print("updated docs/QUICK_START.md")

# Include documentation assets in the offline UI bundles.
ui_routes = read("apps/api/src/ui-routes.ts")
if '"documentation-center.css"' not in ui_routes:
    marker = '      "bulk-data-import-v2.css",\n'
    if marker not in ui_routes:
        raise RuntimeError("CSS bundle marker was not found")
    ui_routes = ui_routes.replace(
        marker,
        marker + '      "documentation-center.css",\n',
        1,
    )
if '"generated-documentation.js"' not in ui_routes:
    marker = '      "bulk-data-import-v2.js",\n'
    if marker not in ui_routes:
        raise RuntimeError("JavaScript bundle marker was not found")
    ui_routes = ui_routes.replace(
        marker,
        marker
        + '      "generated-documentation.js",\n'
        + '      "documentation-center.js",\n',
        1,
    )
write("apps/api/src/ui-routes.ts", ui_routes)

# The repository-level syntax check must parse all source scripts used in the concatenated bundles.
bundle_check = read("scripts/ci/check-ui-bundles.mjs")
if '"documentation-center.js"' not in bundle_check:
    marker = '    "bulk-data-import-v2.js",\n'
    if marker not in bundle_check:
        raise RuntimeError("UI bundle check marker was not found")
    bundle_check = bundle_check.replace(
        marker,
        marker
        + '    "generated-documentation.js",\n'
        + '    "documentation-center.js",\n',
        1,
    )
write("scripts/ci/check-ui-bundles.mjs", bundle_check)

# Register deterministic documentation build/check commands.
package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
scripts = package.setdefault("scripts", {})
scripts["docs:web:build"] = "node scripts/docs/build-web-docs.mjs"
scripts["docs:web:check"] = "node scripts/docs/build-web-docs.mjs --check"
check_ui = scripts.get("check:ui", "")
for command in [
    "node --check apps/api/ui/generated-documentation.js",
    "node --check apps/api/ui/documentation-center.js",
]:
    if command not in check_ui:
        check_ui = f"{check_ui} && {command}" if check_ui else command
scripts["check:ui"] = check_ui
check = scripts.get("check", "")
if "npm run docs:web:check" not in check:
    scripts["check"] = (
        f"npm run docs:web:check && {check}" if check else "npm run docs:web:check"
    )
package_path.write_text(
    json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print("updated package.json")

# Add operator-facing documents to the documentation index.
docs_index = read("docs/README.md")
rows = [
    "| [QUICK_START.md](QUICK_START.md) | краткий путь от импорта до первого готового документа |",
    "| [USER_GUIDE.md](USER_GUIDE.md) | полное руководство оператора, кейсы и диагностика |",
    "| [FLOW_CATALOG.md](FLOW_CATALOG.md) | пользовательские и технические потоки, проверки и результаты |",
    "| [WEB_DOCUMENTATION.md](WEB_DOCUMENTATION.md) | встроенный офлайн-центр документации и его сопровождение |",
]
missing = [row for row in rows if row not in docs_index]
if missing:
    marker = "| [ARCHITECTURE.md](ARCHITECTURE.md) | компоненты, потоки, границы и модель данных |\n"
    if marker not in docs_index:
        raise RuntimeError("Documentation index marker was not found")
    docs_index = docs_index.replace(
        marker,
        marker + "\n".join(missing) + "\n",
        1,
    )
write("docs/README.md", docs_index)

# Explain the offline help entry point in the root README without depending on its current layout.
readme = read("README.md")
section_marker = "## Встроенная справка"
if section_marker not in readme:
    readme = readme.rstrip() + """

## Встроенная справка

В рабочем интерфейсе доступен раздел **Справка**. Он содержит быстрый старт, руководство оператора, каталог процессов, эксплуатационные документы, архитектуру, API и ADR. Документация работает автономно, поддерживает поиск и открывается клавишей `F1`.

После изменения Markdown-файлов обновите локальный каталог:

```bash
npm run docs:web:build
npm run docs:web:check
```

Подробности: [`docs/WEB_DOCUMENTATION.md`](docs/WEB_DOCUMENTATION.md).
"""
write("README.md", readme.rstrip() + "\n")

print("web documentation integration prepared")
