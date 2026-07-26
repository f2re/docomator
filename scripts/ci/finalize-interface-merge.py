from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(relative_path: str, old: str, new: str) -> None:
    path = ROOT / relative_path
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(
            f"{relative_path}: ожидалось одно вхождение, найдено {count}"
        )
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {relative_path}")


replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '    const raw = String(header || "").normalize("NFKC").trim();',
    '    const raw = String(header || "").trim();',
)

replace_once(
    "apps/api/src/ui-routes.ts",
    '      "interface-hierarchy.css"\n',
    '      "interface-hierarchy.css",\n      "interface-stability.css"\n',
)

replace_once(
    "apps/api/src/ui-routes.test.ts",
    '    assert.match(styles.body, /--purple/);',
    '    assert.match(styles.body, /--purple/);\n    assert.match(styles.body, /Прозрачное появление всего экрана/);',
)

print("final interface merge fixes applied")
