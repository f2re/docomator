from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(
            f"{path}: expected exactly one occurrence, found {count}: {old[:120]!r}"
        )
    target.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {path}")


replace_once(
    "apps/api/src/ui-routes.ts",
    '''      "operations-readiness.css",
      "help-center.css"''',
    '''      "operations-readiness.css",
      "help-center.css",
      "help-project-documents.css"''',
)

replace_once(
    "package.json",
    "node --check apps/api/ui/help-center.js && node --check apps/api/ui/document-intake.js",
    "node --check apps/api/ui/help-center.js && node --check apps/api/ui/help-project-documents.js && node --check apps/api/ui/document-intake.js",
)

replace_once(
    "scripts/ci/check-user-facing-language.mjs",
    '''  "apps/api/ui/app.js",
  "apps/api/ui/document-intake.js",''',
    '''  "apps/api/ui/app.js",
  "apps/api/ui/help-center.js",
  "apps/api/ui/help-project-documents.js",
  "apps/api/ui/document-intake.js",''',
)

replace_once(
    "scripts/offline/prepare-bundle.sh",
    '''cp -a "$ROOT_DIR/migrations" "$BUNDLE_DIR/payload/app/"
cp -a "$ROOT_DIR/scripts/runtime/." "$BUNDLE_DIR/payload/app/scripts/runtime/"''',
    '''cp -a "$ROOT_DIR/migrations" "$BUNDLE_DIR/payload/app/"
cp -a "$ROOT_DIR/docs" "$BUNDLE_DIR/payload/app/"
cp -a "$ROOT_DIR/scripts/runtime/." "$BUNDLE_DIR/payload/app/scripts/runtime/"''',
)

replace_once(
    "scripts/offline/prepare-bundle.sh",
    '''    "employee-card.spec.mjs"
    "fixtures/docomator-api.mjs"''',
    '''    "employee-card.spec.mjs"
    "help-center.spec.mjs"
    "fixtures/docomator-api.mjs"''',
)

replace_once(
    "scripts/offline/verify-bundle.test.mjs",
    '''  "employee-card.spec.mjs",
  "fixtures/docomator-api.mjs",''',
    '''  "employee-card.spec.mjs",
  "help-center.spec.mjs",
  "fixtures/docomator-api.mjs",''',
)

replace_once(
    "scripts/offline/verify-bundle.test.mjs",
    '''  assert.match(
    prepare,
    /Сборка или lifecycle-скрипт изменили Git checkout/u
  );''',
    '''  assert.match(
    prepare,
    /Сборка или lifecycle-скрипт изменили Git checkout/u
  );
  assert.match(
    prepare,
    /cp -a "\\$ROOT_DIR\/docs" "\\$BUNDLE_DIR\/payload\/app\/"/u
  );
  assert.match(prepare, /"help-center\.spec\.mjs"/u);''',
)

replace_once(
    "docs/REQUIREMENTS.md",
    "Последнее обновление: **2026-07-16**",
    "Последнее обновление: **2026-07-25**",
)

replace_once(
    "docs/REQUIREMENTS.md",
    '''- [ТЗ на интерфейс](UX_UI_SPECIFICATION.md);
- [безопасный приём и структура документов](DOCUMENT_INTAKE.md);''',
    '''- [ТЗ на интерфейс](UX_UI_SPECIFICATION.md);
- [руководство оператора](USER_GUIDE.md);
- [каталог пользовательских кейсов](USE_CASES.md);
- [безопасный приём и структура документов](DOCUMENT_INTAKE.md);''',
)

replace_once(
    "docs/REQUIREMENTS.md",
    '''| NFR-013 | Автоматическая проверка проекта должна выявлять запрещённые англицизмы в пользовательских текстах. | MUST |''',
    '''| NFR-013 | Автоматическая проверка проекта должна выявлять запрещённые англицизмы в пользовательских текстах. | MUST |
| NFR-014 | Руководство оператора, административные действия, практические кейсы, ограничения и восстановление после ошибок должны быть доступны непосредственно в веб-интерфейсе без внешнего соединения. | MUST |
| NFR-015 | Полный каталог Markdown-документации проекта должен входить в автономный комплект и открываться через локальный поиск и просмотр без раскрытия абсолютных путей файловой системы. | MUST |''',
)

replace_once(
    "docs/REQUIREMENTS.md",
    '''| AC-029 | Основной сценарий персональных документов выполняется без посещения раздела универсальной схемы данных и без понимания терминов «сущность», «аудитория», «снимок» и `one_per_member`. |''',
    '''| AC-029 | Основной сценарий персональных документов выполняется без посещения раздела универсальной схемы данных и без понимания терминов «сущность», «аудитория», «снимок» и `one_per_member`. |
| AC-030 | Пользователь без доступа в Интернет открывает встроенное руководство, находит по поиску нужный кейс, переходит к рабочему разделу и может прочитать любой Markdown-документ установленной версии. |''',
)

replace_once(
    "docs/ROADMAP.md",
    "План отражает фактическое состояние на **2026-07-19**.",
    "План отражает фактическое состояние на **2026-07-25**.",
)

replace_once(
    "docs/ROADMAP.md",
    '''| UX-R1 Простой путь личных карточек | 🟡 в реализации | сотрудники, поля, шаблон, выпуск и результаты без машинных ключей |''',
    '''| UX-R1 Простой путь личных карточек | 🟡 в реализации | сотрудники, поля, шаблон, выпуск, результаты и встроенное руководство без машинных ключей |''',
)

replace_once(
    "docs/ROADMAP.md",
    '''- [x] UX-4.5: центр сохраняемых операций в «Результатах» объединяет предпросмотр, выпуск и доставку выбранного раздела, показывает ожидание/повтор/успех/частичный результат/ошибку и восстанавливается после перезагрузки без новой очереди;
- [ ] UX-5:''',
    '''- [x] UX-4.5: центр сохраняемых операций в «Результатах» объединяет предпросмотр, выпуск и доставку выбранного раздела, показывает ожидание/повтор/успех/частичный результат/ошибку и восстанавливается после перезагрузки без новой очереди;
- [x] UX-4.6: встроенный центр помощи содержит поиск по рабочим потокам и кейсам, переходы к нужным разделам и локальный просмотр полного каталога `docs/`; документация включена в автономную поставку;
- [ ] UX-5:''',
)

replace_once(
    "docs/CHANGELOG.md",
    '''# Журнал изменений Docomator

## 2026-07-25 — понятная привязка пустых мест и варианты ФИО''',
    '''# Журнал изменений Docomator

## 2026-07-25 — встроенное руководство и полный локальный архив документации

- Добавлены полное руководство оператора и каталог практических кейсов: импорт, карточки, группы, шаблоны, повторяемые строки, выпуск, расписания, доставка и диагностика.
- В боковом меню, настройках и контекстной помощи появился единый раздел «Руководство» с поиском, категориями и переходами к рабочим экранам.
- Все Markdown-документы каталога `docs/`, включая ADR, требования, архитектуру, эксплуатацию и планы, читаются через локальный веб-интерфейс без обращения к внешним ресурсам.
- Каталог документации включён в автономный комплект; абсолютные пути сервера не передаются клиенту.
- Добавлены API-, браузерные, синтаксические и языковые проверки веб-документации.

## 2026-07-25 — понятная привязка пустых мест и варианты ФИО''',
)

replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''export const E2E_SECOND_SPACE_ID = "00000000-0000-4000-8000-000000000002";

const JSON_HEADERS = {''',
    '''export const E2E_SECOND_SPACE_ID = "00000000-0000-4000-8000-000000000002";
export const E2E_HELP_DOCUMENT_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";

const JSON_HEADERS = {''',
)

replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''    if (/\/operations$/.test(path) && method === "GET") {''',
    '''    if (path === "/api/v1/help/documents" && method === "GET") {
      data = [
        {
          id: E2E_HELP_DOCUMENT_ID,
          path: "USER_GUIDE.md",
          title: "Руководство оператора Docomator",
          category: "Руководства и примеры",
          sizeBytes: 2048
        },
        {
          id: "bbbbbbbbbbbbbbbbbbbbbbbb",
          path: "adr/0001-local-first.md",
          title: "Автономная работа",
          category: "Архитектурные решения",
          sizeBytes: 1024
        }
      ];
    } else if (
      path === `/api/v1/help/documents/${E2E_HELP_DOCUMENT_ID}` &&
      method === "GET"
    ) {
      data = {
        id: E2E_HELP_DOCUMENT_ID,
        path: "USER_GUIDE.md",
        title: "Руководство оператора Docomator",
        category: "Руководства и примеры",
        sizeBytes: 2048,
        content:
          "# Руководство оператора Docomator\\n\\n## Массовый импорт\\n\\n1. Выберите XLSX.\\n2. Проверьте сопоставление.\\n\\n[Каталог кейсов](USE_CASES.md)."
      };
    } else if (/\/operations$/.test(path) && method === "GET") {''',
)

print("complete web documentation integration applied")
