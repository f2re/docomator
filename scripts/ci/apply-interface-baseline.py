#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one occurrence in {path}, found {count}: {old!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "docs/ARCHITECTURE.md",
    "не принимает доменных решенийений",
    "не принимает доменных решений",
)
replace_once(
    "docs/IMPLEMENTATION_PLAN.md",
    "Definition of Done: выполнены AC-001—AC-014 и подписан пилотный протокол.",
    "Definition of Done: выполнены AC-001—AC-016 и UX-AC-001—UX-AC-010, подписан пилотный протокол.",
)
replace_once(
    "README.md",
    "`npm run check` выполняет чистую сборку, unit/integration tests, проверку Markdown-ссылок и синтаксиса shell-скриптов.",
    "`npm run check` выполняет чистую сборку, unit/integration tests, проверку Markdown-ссылок, shell-скриптов и синтаксиса offline UI.",
)
replace_once(
    "apps/api/ui/app.js",
    '  $("#helpDrawer [data-close-help]")?.focus();',
    '  $("#helpDrawer button[data-close-help]")?.focus();',
)

print("Finalized interface baseline details.")
