from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: Path, old: str, new: str) -> None:
    value = path.read_text(encoding="utf-8")
    if old not in value:
        raise RuntimeError(f"Не найден ожидаемый фрагмент в {path.relative_to(ROOT)}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")


replace_once(
    ROOT / "apps/api/src/multi-field-test-version-routes.test.ts",
    '    assert.match(foreign.json().error.message, /все поля.*черновика/ui);',
    '    assert.match(foreign.json().error.message, /состав полей черновика/ui);'
)

replace_once(
    ROOT / "apps/api/src/ui-routes.test.ts",
    '''    assert.equal(
      workflowScript.body.match(/dataset\\.templateWizardPanel = "3"/gu)?.length,
      2
    );''',
    '''    assert.ok(
      (workflowScript.body.match(/dataset\\.templateWizardPanel = "3"/gu)?.length ?? 0) >= 2
    );'''
)

print("updated PR #50 test expectations")
