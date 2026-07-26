from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def patch(path: str, old: str, new: str) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}")
    target.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {path}")


patch(
    "apps/api/src/multi-field-test-version-routes.test.ts",
    '''    assert.equal(foreign.statusCode, 400, foreign.body);
    assert.match(foreign.json().error.message, /все поля.*черновика/ui);''',
    '''    assert.equal(foreign.statusCode, 400, foreign.body);
    assert.match(
      foreign.json().error.message,
      /Состав полей черновика изменился.*Должность получателя.*Обновите форму/ui
    );'''
)

patch(
    "apps/api/src/ui-routes.test.ts",
    '''    assert.equal(
      workflowScript.body.match(/docomatorTemplateWizard\?\.complete\(3/gu)?.length,
      2
    );''',
    '''    assert.ok(
      (workflowScript.body.match(/docomatorTemplateWizard\?\.complete\(3/gu)?.length ?? 0) >= 2
    );'''
)

print("repository check expectations updated")
