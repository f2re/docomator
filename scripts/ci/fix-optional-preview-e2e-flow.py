from pathlib import Path

root = Path(__file__).resolve().parents[2]


def replace_once(relative: str, old: str, new: str) -> None:
    path = root / relative
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{relative}: ожидалось одно вхождение, найдено {count}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {relative}")


replace_once(
    "tests/e2e/template-and-generation.spec.mjs",
    "  await previewAndActivate(page);",
    "  await saveTestedTemplate(page);"
)

replace_once(
    "apps/api/ui/template-activation.js",
    '''  holder.innerHTML = `
    <div class="activation-state is-success">''',
    '''  const directButton = document.querySelector("#templateActivateDirect");
  if (directButton) directButton.hidden = true;
  holder.innerHTML = `
    <div class="activation-state is-success">'''
)

replace_once(
    "apps/api/ui/document-intake.js",
    '''    question: "Готов ли шаблон к работе?",
    hint: "Просмотрите PDF и подтвердите активацию. Только после этого шаблон появится в списке для создания документов."''',
    '''    question: "Готов ли шаблон к работе?",
    hint: "Сохраните успешно проверенную версию. PDF можно создать отдельно только для дополнительной визуальной проверки."'''
)

print("optional preview E2E flow fixed")
