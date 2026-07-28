from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, value: str) -> None:
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")
    print(f"updated {relative}")


def replace_once(relative: str, old: str, new: str) -> None:
    value = read(relative)
    count = value.count(old)
    if count != 1:
        raise RuntimeError(
            f"{relative}: expected one occurrence, found {count}: {old[:180]!r}"
        )
    write(relative, value.replace(old, new, 1))


def replace_in(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(
            f"{label}: expected one occurrence, found {count}: {old[:180]!r}"
        )
    return value.replace(old, new, 1)


# ---------------------------------------------------------------------------
# 1. Offline bundle: fail-fast profile validation and complete temporary cleanup.
# ---------------------------------------------------------------------------
builder = read("scripts/offline/build-full-bundle.sh")
builder = replace_in(
    builder,
    '''TEMPORARY_DIRECTORY=""
cleanup() {
  if [[ -n "$TEMPORARY_DIRECTORY" ]]; then
    rm -rf "$TEMPORARY_DIRECTORY"
  fi
}''',
    '''PACKAGE_WORK_DIR=""
ARCHIVE_TEST_DIR=""
cleanup() {
  [[ -z "$PACKAGE_WORK_DIR" ]] || rm -rf "$PACKAGE_WORK_DIR"
  [[ -z "$ARCHIVE_TEST_DIR" ]] || rm -rf "$ARCHIVE_TEST_DIR"
}''',
    "build-full cleanup"
)
builder = replace_in(
    builder,
    '''  TEMPORARY_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/docomator-full-bundle.XXXXXX")"
  EFFECTIVE_PACKAGE_LIST="$TEMPORARY_DIRECTORY/os-packages.txt"''',
    '''  PACKAGE_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/docomator-full-bundle.XXXXXX")"
  EFFECTIVE_PACKAGE_LIST="$PACKAGE_WORK_DIR/os-packages.txt"''',
    "build-full package work dir"
)
builder = replace_in(
    builder,
    '''ARCHIVE_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/docomator-archive-check.XXXXXX")"
TEMPORARY_DIRECTORY="$ARCHIVE_TEST_DIR"''',
    '''ARCHIVE_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/docomator-archive-check.XXXXXX")"''',
    "build-full archive work dir"
)
write("scripts/offline/build-full-bundle.sh", builder)

prepare = read("scripts/offline/prepare-bundle.sh")
profile_anchor = '''[[ "$TARGET_PROFILE" == "generic" || "$TARGET_PROFILE" == "debian" || "$TARGET_PROFILE" == "astra" ]] || \\
  die "Неподдерживаемый target-profile: $TARGET_PROFILE"
'''
profile_rules = profile_anchor + '''if [[ "$TARGET_PROFILE" == "generic" && -n "$OS_PACKAGES_DIR" ]]; then
  die "Профиль generic не должен содержать пакеты конкретной ОС."
fi
if [[ "$TARGET_PROFILE" != "generic" && -z "$OS_PACKAGES_DIR" ]]; then
  die "Профиль $TARGET_PROFILE требует --os-packages-dir с полным замыканием зависимостей."
fi
'''
prepare = replace_in(prepare, profile_anchor, profile_rules, "prepare profile rules")
write("scripts/offline/prepare-bundle.sh", prepare)


# ---------------------------------------------------------------------------
# 2. Deterministic examples for arbitrary entities.
# ---------------------------------------------------------------------------
assets = read("scripts/ci/example-assets.mjs")
old_csv = '''const csv = `Табельный номер,ФИО,Должность,Подразделение,Дата приёма
0001,Иванов Алексей Сергеевич,Инженер,Производственный отдел,2024-03-15
0002,Петрова Анна Викторовна,Бухгалтер,Финансовый отдел,2023-11-01
0003,Сидоров Максим Олегович,Специалист,Отдел снабжения,2025-02-10
`;
'''
new_csv = '''const employeeCsv = `Табельный номер,ФИО,Должность,Подразделение,Дата приёма
0001,Иванов Алексей Сергеевич,Инженер,Производственный отдел,2024-03-15
0002,Петрова Анна Викторовна,Бухгалтер,Финансовый отдел,2023-11-01
0003,Сидоров Максим Олегович,Специалист,Отдел снабжения,2025-02-10
`;

const auditoriumCsv = `Код,Название,Корпус,Этаж,Вместимость,Оборудование
ROOM-101,Аудитория 101,Главный корпус,1,32,Проектор
ROOM-205,Лаборатория 205,Лабораторный корпус,2,18,Интерактивная доска
ROOM-310,Актовый зал,Главный корпус,3,120,Звуковая система
`;

const scientificArticleCsv = `Шифр,Название,DOI,Журнал,Год,Статус
ART-001,Краткосрочный прогноз конвективных осадков,10.0000/example.001,Метеорология и гидрология,2025,Опубликована
ART-002,Восстановление вертикального профиля атмосферы,10.0000/example.002,Известия РАН. Физика атмосферы и океана,2026,Принята
ART-003,Обработка данных радиозондирования,,Научный вестник,2026,Подготовка
`;
'''
assets = replace_in(assets, old_csv, new_csv, "example CSV constants")
assets = replace_in(
    assets,
    '''      path: "data/employees.csv",
      kind: "csv",
      content: Buffer.from(csv, "utf8")
    },''',
    '''      path: "data/employees.csv",
      kind: "csv",
      content: Buffer.from(employeeCsv, "utf8")
    },
    {
      path: "data/auditoriums.csv",
      kind: "csv",
      content: Buffer.from(auditoriumCsv, "utf8")
    },
    {
      path: "data/scientific-articles.csv",
      kind: "csv",
      content: Buffer.from(scientificArticleCsv, "utf8")
    },''',
    "example asset entries"
)
write("scripts/ci/example-assets.mjs", assets)

check_examples = read("scripts/ci/check-examples.mjs")
check_examples = replace_in(
    check_examples,
    "assert.equal(safeExampleAssets.length, 9);",
    "assert.equal(safeExampleAssets.length, 11);",
    "safe example count"
)
check_examples = replace_in(
    check_examples,
    '''assert.equal(table.rowCount, 3);
assert.equal(table.rows[0]?.["Табельный номер"], "0001");''',
    '''assert.equal(table.rowCount, 3);
assert.equal(table.rows[0]?.["Табельный номер"], "0001");
for (const fileName of ["auditoriums.csv", "scientific-articles.csv"]) {
  const asset = EXAMPLE_ASSETS.find((candidate) => candidate.path === `data/${fileName}`);
  assert.ok(asset);
  const parsed = await parseDataImportBuffer({ buffer: asset.content, fileName });
  assert.equal(parsed.rowCount, 3);
  assert.equal(parsed.headers.length >= 6, true);
}''',
    "generic CSV example parsing"
)
write("scripts/ci/check-examples.mjs", check_examples)

write(
    "examples/README.md",
    '''# Учебные примеры Docomator

Все имена, помещения, статьи и иные сведения в каталоге вымышлены. Файлы не содержат рабочих персональных данных, не импортируются автоматически и не подключаются к шаблонам без явного действия оператора.

## Быстрый сценарий для людей

1. На экране **«Сотрудники»** откройте массовый импорт и выберите `data/employees.csv`.
2. Укажите «ФИО» как отображаемое имя, «Табельный номер» как устойчивый идентификатор, остальные колонки сопоставьте с полями карточки.
3. Подключите `templates/personal-card.docx` либо сводный `templates/team-register.docx`/`templates/team-register.xlsx`.
4. Сопоставьте поля, выполните общую проверку и сравните результат с `expected/`.

## Быстрый сценарий для произвольных объектов

1. Откройте **«Объекты»** и создайте тип **«Аудитория»**.
2. Создайте поля «Код», «Корпус», «Этаж», «Вместимость» и «Оборудование» либо разрешите мастеру создать их при импорте.
3. Импортируйте `data/auditoriums.csv`: отображаемое название — «Название», устойчивый идентификатор — «Код».
4. Для научных материалов создайте тип **«Научная статья»** и импортируйте `data/scientific-articles.csv`: отображаемое название — «Название», устойчивый идентификатор — «Шифр» или DOI.
5. В редакторе шаблона выберите нужный тип объектов. Поля людей, аудиторий и статей показываются раздельно.

## Состав

- `data/employees.csv` — три вымышленных сотрудника;
- `data/auditoriums.csv` — три вымышленных помещения;
- `data/scientific-articles.csv` — три вымышленные научные статьи;
- `templates/personal-card.docx` — личный документ с четырьмя местами заполнения;
- `templates/team-register.docx` и `templates/team-register.xlsx` — сводные таблицы с одной строкой-образцом;
- `fixtures/header-field.docx` — поле внутри верхнего колонтитула;
- `fixtures/scalar-fields.xlsx` — четыре отдельные ячейки для скалярного заполнения;
- `fixtures/rejected/macro-part.docx` — инертный отрицательный пример с запрещённой частью макроса;
- `expected/` — заполненные DOCX/XLSX для визуального сравнения.

## Происхождение и ограничения

Примеры детерминированно собираются сценарием `scripts/ci/generate-examples.mjs`. Проверка проекта требует точного SHA-256, закрытого списка файлов, отсутствия ссылок и безопасной структуры OOXML. CSV дополнительно проверяются на значения, похожие на формулы. Отрицательный DOCX должен завершаться точным отказом `macro_content`.

Для осознанного обновления выполните:

```bash
npm run build
npm run generate:examples
npm run check:examples
```

`manifest.sha256` создаётся вместе с файлами и проверяется внутри автономного комплекта. Совместимость с конкретной версией LibreOffice или Microsoft Office подтверждается только отдельным прогоном на целевом стенде.
'''
)

# Exact example inventories inside the release builder and verifier.
for relative in [
    "scripts/offline/prepare-bundle.sh",
    "scripts/offline/verify-bundle.sh",
    "scripts/offline/verify-bundle.test.mjs",
]:
    value = read(relative)
    value = replace_in(
        value,
        '  "data/employees.csv"\n',
        '  "data/auditoriums.csv"\n  "data/employees.csv"\n  "data/scientific-articles.csv"\n',
        f"{relative} example list"
    )
    write(relative, value)


# ---------------------------------------------------------------------------
# 3. Browser mock and regression for arbitrary entities.
# ---------------------------------------------------------------------------
fixture = read("tests/e2e/fixtures/docomator-api.mjs")
fixture = replace_in(
    fixture,
    '''    previewRequest: null,
    generationCreated: false,''',
    '''    previewRequest: null,
    propertyValues: new Map(),
    generationCreated: false,''',
    "fixture property value store"
)
fixture = replace_in(
    fixture,
    '''    importBodies: [],
    importRuns: [],''',
    '''    importBodies: [],
    importRuns: [],
    importPreview: options.importPreview
      ? structuredClone(options.importPreview)
      : null,''',
    "fixture custom import preview"
)
fixture = replace_in(
    fixture,
    '''      const definition = {
        key: `person.e2e_field_${state.properties.length + 1}`,
        label: payload.label,''',
    '''      const typeKey = payload.appliesTo?.[0] || "person";
      const definition = {
        key: `${typeKey}.e2e_field_${state.properties.length + 1}`,
        label: payload.label,''',
    "fixture property key type"
)

old_entity_route = '''    } else if (/\/entities$/.test(path)) {
      data = space.entities;
    } else if (/\/audience-snapshots$/.test(path) && method === "GET") {'''
new_entity_route = '''    } else if (
      /\/knowledge\/entities\/[^/]+\/property-values$/.test(path) &&
      method === "GET"
    ) {
      const entityId = decodeURIComponent(path.split("/").at(-2));
      data = state.primary.propertyValues.get(entityId) || [];
    } else if (
      /\/knowledge\/entities\/[^/]+\/properties\/[^/]+$/.test(path) &&
      method === "PUT"
    ) {
      const entityId = decodeURIComponent(path.split("/").at(-3));
      const propertyKey = decodeURIComponent(path.split("/").pop());
      const payload = await jsonBody(request);
      const values = state.primary.propertyValues.get(entityId) || [];
      const record = {
        id: `property-value-e2e-${values.length + 1}`,
        entityId,
        propertyKey,
        propertyLabel:
          state.properties.find((property) => property.key === propertyKey)?.label ||
          propertyKey,
        value: payload.value,
        valueType:
          state.properties.find((property) => property.key === propertyKey)?.valueType ||
          "string",
        createdAt: "2026-07-28T06:00:00.000Z"
      };
      values.unshift(record);
      state.primary.propertyValues.set(entityId, values);
      data = record;
    } else if (/\/entities$/.test(path) && method === "POST") {
      const payload = await jsonBody(request);
      const entity = {
        entityId: `entity-e2e-${space.entities.length + 1}`,
        displayName: payload.displayName,
        entityTypeKey: payload.entityTypeKey,
        entityTypeLabel:
          state.entityTypes.find((type) => type.key === payload.entityTypeKey)?.label ||
          payload.entityTypeKey,
        status: payload.status || "active"
      };
      space.entities.push(entity);
      data = entity;
    } else if (/\/entities$/.test(path) && method === "GET") {
      data = space.entities;
    } else if (/\/audience-snapshots$/.test(path) && method === "GET") {'''
fixture = replace_in(fixture, old_entity_route, new_entity_route, "fixture entity routes")

old_preview = '''      data = {
        fileName: url.searchParams.get("fileName") || "Сотрудники.csv",
        fileFormat: "csv",
        sourceSha256: "e2e-import-source-sha256",
        previewToken: "e2e-import-preview-token",
        headers: ["ФИО", "Табельный номер", "Должность"],
        columnCount: 3,
        rowCount: 2,
        rows: [
          {
            "ФИО": "Анна Смирнова",
            "Табельный номер": "T-001",
            "Должность": "Инженер"
          },
          {
            "ФИО": "Иван Петров",
            "Табельный номер": "T-002",
            "Должность": "Аналитик"
          }
        ],
        sampleRows: [
          {
            "ФИО": "Анна Смирнова",
            "Табельный номер": "T-001",
            "Должность": "Инженер"
          },
          {
            "ФИО": "Иван Петров",
            "Табельный номер": "T-002",
            "Должность": "Аналитик"
          }
        ]
      };'''
new_preview = '''      data =
        state.importPreview ||
        {
          fileName: url.searchParams.get("fileName") || "Сотрудники.csv",
          fileFormat: "csv",
          sourceSha256: "e2e-import-source-sha256",
          previewToken: "e2e-import-preview-token",
          headers: ["ФИО", "Табельный номер", "Должность"],
          columnCount: 3,
          rowCount: 2,
          rows: [
            {
              "ФИО": "Анна Смирнова",
              "Табельный номер": "T-001",
              "Должность": "Инженер"
            },
            {
              "ФИО": "Иван Петров",
              "Табельный номер": "T-002",
              "Должность": "Аналитик"
            }
          ],
          sampleRows: [
            {
              "ФИО": "Анна Смирнова",
              "Табельный номер": "T-001",
              "Должность": "Инженер"
            },
            {
              "ФИО": "Иван Петров",
              "Табельный номер": "T-002",
              "Должность": "Аналитик"
            }
          ]
        };'''
fixture = replace_in(fixture, old_preview, new_preview, "fixture import preview")
fixture = replace_in(
    fixture,
    '''    } else if (/\/data-import\/plan$/.test(path) && method === "POST") {
      data = {
        createdCount: 2,''',
    '''    } else if (/\/data-import\/plan$/.test(path) && method === "POST") {
      const payload = await jsonBody(request);
      data = {
        createdCount: payload.rows?.length || 0,''',
    "fixture import plan count"
)

old_execute = '''      for (const row of payload.rows || []) {
        const id = `imported-employee-${space.employees.length + 1}`;
        const employee = {
          id,
          entityId: id,
          displayName: row[payload.displayNameColumn],
          status: "active",
          fields: []
        };
        space.employees.push(employee);
        space.entities.push({
          entityId: id,
          displayName: employee.displayName,
          entityTypeKey: payload.entityTypeKey || "person",
          entityTypeLabel:
            payload.entityTypeKey && payload.entityTypeKey !== "person"
              ? state.entityTypes.find((type) => type.key === payload.entityTypeKey)?.label || payload.entityTypeKey
              : "Человек",
          status: "active"
        });
      }
      const result = {
        id: "data-import-run-e2e",
        state: "completed",
        fileName: payload.fileName,
        createdCount: 2,'''
new_execute = '''      const importedIds = [];
      for (const row of payload.rows || []) {
        const typeKey = payload.entityTypeKey || "person";
        const id =
          typeKey === "person"
            ? `imported-employee-${space.employees.length + 1}`
            : `imported-entity-${space.entities.length + 1}`;
        const displayName = row[payload.displayNameColumn];
        if (typeKey === "person") {
          space.employees.push({
            id,
            entityId: id,
            displayName,
            status: "active",
            fields: []
          });
        }
        space.entities.push({
          entityId: id,
          displayName,
          entityTypeKey: typeKey,
          entityTypeLabel:
            state.entityTypes.find((type) => type.key === typeKey)?.label || typeKey,
          status: "active"
        });
        importedIds.push(id);
      }
      if (payload.group?.name) {
        space.groups.push({
          id: `group-e2e-${space.groups.length + 1}`,
          spaceId,
          key: `group_e2e_${space.groups.length + 1}`,
          name: payload.group.name,
          description: payload.group.description || null,
          status: "active",
          version: 1,
          memberCount: importedIds.length,
          entityTypeKey: payload.entityTypeKey || "person",
          entityTypeLabel:
            state.entityTypes.find(
              (type) => type.key === (payload.entityTypeKey || "person")
            )?.label || payload.entityTypeKey || "Человек",
          memberIds: importedIds
        });
      }
      const result = {
        id: "data-import-run-e2e",
        state: "completed",
        fileName: payload.fileName,
        createdCount: payload.rows?.length || 0,'''
fixture = replace_in(fixture, old_execute, new_execute, "fixture generic import execute")
fixture = replace_in(
    fixture,
    '''        groupName: null,
        createdAt:''',
    '''        groupName: payload.group?.name || null,
        createdAt:''',
    "fixture import group name"
)

# Group membership responses must preserve arbitrary entity types.
fixture = re.sub(
    r'''      data = \(group\?\.memberIds \|\| \[\]\)\.map\(\(entityId, position\) => \{\n        const employee = space\.employees\.find\(\(candidate\) => candidate\.id === entityId\);\n        return \{\n          entityId,\n          position,\n          displayName: employee\?\.displayName \|\| entityId,\n          entityTypeKey: "person",\n          entityTypeLabel: "Человек",\n          status: employee\?\.status \|\| "active"\n        \};\n      \}\);''',
    '''      data = (group?.memberIds || []).map((entityId, position) => {
        const entity = space.entities.find((candidate) => candidate.entityId === entityId);
        return {
          entityId,
          position,
          displayName: entity?.displayName || entityId,
          entityTypeKey: entity?.entityTypeKey || "person",
          entityTypeLabel: entity?.entityTypeLabel || "Человек",
          status: entity?.status || "active"
        };
      });''',
    fixture,
    count=1
)
fixture = re.sub(
    r'''      data = \(group\?\.memberIds \|\| \[\]\)\.map\(\(entityId, position\) => \(\{\n        entityId,\n        position,\n        displayName:\n          space\.employees\.find\(\(candidate\) => candidate\.id === entityId\)\?\.displayName \|\|\n          entityId,\n        entityTypeKey: "person",\n        entityTypeLabel: "Человек",\n        status:\n          space\.employees\.find\(\(candidate\) => candidate\.id === entityId\)\?\.status \|\|\n          "active"\n      \}\)\);''',
    '''      data = (group?.memberIds || []).map((entityId, position) => {
        const entity = space.entities.find((candidate) => candidate.entityId === entityId);
        return {
          entityId,
          position,
          displayName: entity?.displayName || entityId,
          entityTypeKey: entity?.entityTypeKey || "person",
          entityTypeLabel: entity?.entityTypeLabel || "Человек",
          status: entity?.status || "active"
        };
      });''',
    fixture,
    count=1
)
write("tests/e2e/fixtures/docomator-api.mjs", fixture)

write(
    "tests/e2e/generic-entities.spec.mjs",
    '''import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const importPreview = {
  fileName: "auditoriums.csv",
  fileFormat: "csv",
  sourceSha256: "e2e-room-import-source",
  previewToken: "e2e-room-import-token",
  headers: ["Код", "Название", "Корпус", "Вместимость"],
  columnCount: 4,
  rowCount: 2,
  rows: [
    {
      "Код": "ROOM-101",
      "Название": "Аудитория 101",
      "Корпус": "Главный корпус",
      "Вместимость": "32"
    },
    {
      "Код": "ROOM-205",
      "Название": "Лаборатория 205",
      "Корпус": "Лабораторный корпус",
      "Вместимость": "18"
    }
  ],
  sampleRows: [
    {
      "Код": "ROOM-101",
      "Название": "Аудитория 101",
      "Корпус": "Главный корпус",
      "Вместимость": "32"
    },
    {
      "Код": "ROOM-205",
      "Название": "Лаборатория 205",
      "Корпус": "Лабораторный корпус",
      "Вместимость": "18"
    }
  ]
};

test("оператор создаёт и импортирует произвольные объекты одного типа", async ({
  page
}) => {
  const state = await installDocomatorApiMock(page, {
    entityTypes: [
      { key: "person", label: "Человек", description: "Сотрудник" },
      { key: "room", label: "Аудитория", description: "Учебное помещение" }
    ],
    properties: [
      {
        key: "room.capacity",
        label: "Вместимость",
        valueType: "integer",
        sensitivity: "internal",
        appliesTo: ["room"],
        aliases: ["Количество мест"],
        validation: {},
        unit: "мест"
      }
    ],
    importPreview
  });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("entities");

  await expect(page.locator("#entityWorkspaceType")).toHaveValue("room");
  await page.locator('[data-entity-action="record"]').first().click();
  await page.locator("#entityRecordName").fill("Аудитория 310");
  await page.locator("#entity-value-room-capacity").fill("45");
  await page.locator("#entityRecordSubmit").click();

  await expect(page.locator("#entityWorkspaceList")).toContainText(
    "Аудитория 310"
  );
  await page
    .locator('[data-entity-open]')
    .filter({ hasText: "Аудитория 310" })
    .click();
  await expect(page.locator("#entity-value-room-capacity")).toHaveValue("45");
  await page
    .locator('#entityRecordDialog [data-entity-dialog-close="entityRecordDialog"]')
    .first()
    .click();

  await page.locator('[data-entity-action="import"]').click();
  await page.locator("#entityImportFile").setInputFiles({
    name: "auditoriums.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Код,Название,Корпус,Вместимость\\n", "utf8")
  });
  await page.locator("#entityImportPreviewButton").click();
  await expect(page.locator("#entityImportMappings")).toContainText(
    "Вместимость"
  );
  await page.locator("#entityImportCreateGroup").check();
  await page.locator("#entityImportGroupName").fill("Аудитории корпуса");
  await page.locator("#entityImportPlanButton").click();
  await expect(page.locator("#entityImportPlan")).toContainText("Новые");
  await page.locator("#entityImportExecuteButton").click();
  await expect(page.locator("#entityImportMessage")).toContainText(
    "Импорт завершён"
  );

  expect(state.importBodies).toHaveLength(1);
  expect(state.importBodies[0].entityTypeKey).toBe("room");
  expect(state.importBodies[0].displayNameColumn).toBe("Название");
  expect(state.importBodies[0].identityColumn).toBe("Код");
  expect(state.importBodies[0].group.name).toBe("Аудитории корпуса");
  await expect(page.locator("#entityWorkspaceList")).toContainText(
    "Аудитория 101"
  );
  await expect(page.locator("#entityWorkspaceList")).toContainText(
    "Лаборатория 205"
  );
});
'''
)

# Include the new E2E scenario in the exact offline acceptance inventory.
for relative in [
    "scripts/offline/prepare-bundle.sh",
    "scripts/offline/verify-release.mjs",
    "scripts/offline/verify-bundle.test.mjs",
]:
    value = read(relative)
    value = replace_in(
        value,
        '    "employee-card.spec.mjs",\n',
        '    "employee-card.spec.mjs",\n    "generic-entities.spec.mjs",\n',
        f"{relative} E2E inventory"
    )
    write(relative, value)


# ---------------------------------------------------------------------------
# 4. Documentation: model, operation and target-specific build contract.
# ---------------------------------------------------------------------------
docs_index = read("docs/README.md")
docs_index = replace_in(
    docs_index,
    '''| [IMPORT_AND_WORD_ROSTERS.md](IMPORT_AND_WORD_ROSTERS.md) | массовый импорт людей, студентов, заполненных полей и повторяемые строки Word |
| [OFFLINE_DEPLOYMENT.md](OFFLINE_DEPLOYMENT.md) |''',
    '''| [IMPORT_AND_WORD_ROSTERS.md](IMPORT_AND_WORD_ROSTERS.md) | массовый импорт людей, студентов, заполненных полей и повторяемые строки Word |
| [ENTITY_MODEL_AND_IMPORT.md](ENTITY_MODEL_AND_IMPORT.md) | произвольные объекты, типы, параметры, однородные группы и гибкий CSV/XLSX-импорт |
| [OFFLINE_DEPLOYMENT.md](OFFLINE_DEPLOYMENT.md) |''',
    "docs index entity model"
)
write("docs/README.md", docs_index)

readme = read("README.md")
readme = replace_in(
    readme,
    '''**Текущее состояние:** работает базовый технический контур от массовой загрузки данных и безопасной подготовки шаблона до ручного или календарного выпуска, общего хранилища результатов, доставки, диагностики и автоматического резервирования. Путь «сотрудники → шаблон → личные карточки» реализован и покрыт локальными браузерными сценариями;''',
    '''**Текущее состояние:** работает базовый технический контур от массовой загрузки данных и безопасной подготовки шаблона до ручного или календарного выпуска, общего хранилища результатов, доставки, диагностики и автоматического резервирования. Пространство может содержать людей, аудитории, научные статьи, оборудование и другие типизированные объекты; отдельный кадровый экран остаётся упрощённым представлением типа «Человек». Пути «сотрудники → шаблон → личные карточки» и «произвольные объекты → шаблон → отдельный или сводный выпуск» покрыты проверками;''',
    "README current state"
)
readme = replace_in(
    readme,
    '''1. импортировать до 1000 участников из CSV или XLSX;
2. повторно загружать обновлённый список без создания дублей;
3. создавать произвольные типизированные свойства и группы;''',
    '''1. создавать произвольные типы объектов: людей, аудитории, статьи, оборудование и другие записи;
2. импортировать до 1000 объектов одного типа из CSV или XLSX;
3. повторно загружать обновлённый список без создания дублей по устойчивому идентификатору;
4. создавать типизированные свойства и однородные группы;''',
    "README working list"
)
# Renumber the remaining explicit list without changing prose semantics.
for old, new in reversed([(number, number + 1) for number in range(4, 23)]):
    readme = readme.replace(f"{old}. ", f"{new}. ", 1)
readme = replace_in(
    readme,
    '''## 📥 Массовый импорт данных

В разделе участников доступен мастер импорта CSV/XLSX:''',
    '''## 🧱 Произвольные объекты

Раздел **«Объекты»** позволяет создать тип, его параметры и записи внутри выбранного пространства. Одноимённые поля разных типов не смешиваются: «Номер» аудитории и «Номер» статьи остаются разными определениями. Группа и один выпуск содержат объекты одного типа. Подробный контракт описан в [модели произвольных объектов](docs/ENTITY_MODEL_AND_IMPORT.md).

## 📥 Массовый импорт данных

Для сотрудников используется кадровый мастер, для остальных типов — мастер в разделе **«Объекты»**:''',
    "README entity section"
)
readme = replace_in(
    readme,
    '''→ выбор колонки обновления и ФИО
→ сопоставление колонок со свойствами
→ создание или обновление участников''',
    '''→ выбор типа, отображаемого названия и устойчивого идентификатора
→ сопоставление колонок с параметрами выбранного типа
→ создание или обновление объектов''',
    "README import flow"
)
readme = readme.replace(
    "новые строки создают участников, существующие обновляются",
    "новые строки создают объекты, существующие обновляются",
    1
)
write("README.md", readme)

user_guide = read("docs/USER_GUIDE.md")
user_guide = replace_in(
    user_guide,
    '''1. выбрать раздел данных;
2. добавить людей вручную или импортировать таблицу;
3. при необходимости собрать людей в группу;''',
    '''1. выбрать раздел данных;
2. выбрать тип объектов и добавить записи вручную либо импортировать таблицу;
3. при необходимости собрать однотипные объекты в группу;''',
    "user guide workflow"
)
user_guide = replace_in(
    user_guide,
    '''| Раздел данных | Организационный набор людей, групп, шаблонов и процессов | Отдельное подразделение, факультет, филиал, проект |
| Карточка человека | ФИО, статус и значения полей конкретного человека | Для подстановки данных в документы |
| Поле | Общее определение значения: должность, тема работы, дата рождения | Когда одинаковый вид сведений нужен у разных людей |
| Группа | Сохраняемый упорядоченный состав людей | Для повторных выпусков по одному составу |''',
    '''| Раздел данных | Организационный набор объектов, групп, шаблонов и процессов | Отдельное подразделение, факультет, филиал, проект |
| Тип объекта | Класс записей с собственными параметрами: человек, аудитория, статья, оборудование | Когда документы заполняются не только сведениями о людях |
| Карточка объекта | Отображаемое название, статус и значения параметров конкретной записи | Для подстановки данных в документы |
| Карточка человека | Специализированная карточка объекта типа «Человек» с удобным кадровым интерфейсом | Для ФИО и персональных сведений |
| Поле | Типизированное определение значения, применимое к одному или нескольким типам | Когда одинаковый параметр используется в нескольких карточках |
| Группа | Сохраняемый упорядоченный состав объектов одного типа | Для повторных выпусков по одному составу |''',
    "user guide concepts"
)
entity_guide = '''
## 5. Произвольные объекты

### Когда использовать

Используйте раздел **«Объекты»**, когда единицей документа является не только человек. Примеры: аудитория с вместимостью, научная статья с DOI, оборудование с инвентарным номером, организация с ИНН.

### Создание и импорт

1. Создайте тип и понятные параметры.
2. Добавьте одну запись вручную либо загрузите CSV/XLSX.
3. При импорте выберите колонку отображаемого названия и устойчивого идентификатора.
4. Сопоставьте остальные колонки только с параметрами выбранного типа.
5. Выполните предварительную проверку и при необходимости создайте однородную группу.
6. В редакторе шаблона выберите тот же тип объектов.
7. При выпуске выберите все объекты типа, однородную группу или отдельные записи.

Пустая ячейка импорта не удаляет прежнее значение. Один документный выпуск не смешивает разные типы. Подробности и примеры приведены в [описании модели](ENTITY_MODEL_AND_IMPORT.md).

## 6. Карточки людей
'''
user_guide = replace_in(user_guide, "## 5. Карточки людей\n", entity_guide, "user guide entity section")
# Keep later heading numbers monotonic after inserting one section.
for number in range(15, 5, -1):
    user_guide = user_guide.replace(f"## {number}. ", f"## {number + 1}. ", 1)
write("docs/USER_GUIDE.md", user_guide)

architecture = read("docs/ARCHITECTURE.md")
architecture_intro = '''
## Произвольные типизированные объекты

`space` является границей данных и процессов, но не ограничивает предметную область сотрудниками. `entity_type` задаёт класс объекта, `entity` — конкретную запись, `property_definition.applies_to_json` — допустимые параметры типа, а `entity_property_values` — версионируемые значения. `space_entity_ownership` закрепляет объект за одним пространством.

Сервер поддерживает следующие инварианты:

- сопоставление поля импорта выполняется внутри выбранного типа;
- одинаковая подпись у разных типов не объединяет определения;
- группа и снимок выпуска содержат объекты одного типа;
- шаблон и мастер выпуска фильтруют поля, группы и записи по выбранному `entityTypeKey`;
- кадровый интерфейс является специализированным представлением типа `person`, а не отдельной моделью хранения.

Подробная операторская модель приведена в [ENTITY_MODEL_AND_IMPORT.md](ENTITY_MODEL_AND_IMPORT.md).

'''
architecture = replace_in(
    architecture,
    "# Архитектура Docomator\n",
    "# Архитектура Docomator\n" + architecture_intro,
    "architecture entity model"
)
write("docs/ARCHITECTURE.md", architecture)

spaces_doc = read("docs/SPACES_AND_AUDIENCES.md")
spaces_doc = replace_in(
    spaces_doc,
    "# Пространства и аудитории документов\n",
    '''# Пространства, группы и составы документов

> Термин «аудитория» в программных контрактах означает зафиксированный состав объектов, а не тип помещения. Пространство может содержать людей, аудитории-помещения, статьи, оборудование и другие типы. Одна группа и один снимок состава всегда однородны по типу.
''',
    "spaces terminology"
)
write("docs/SPACES_AND_AUDIENCES.md", spaces_doc)

offline = read("docs/OFFLINE_DEPLOYMENT.md")
offline = offline.replace("Autonomous release bundle", "Автономный комплект выпуска", 1)
offline = offline.replace("reference host", "эталонном сервере", 1)
offline = offline.replace("target", "целевой сервер", 4)
offline = replace_in(
    offline,
    '''├── verify-release.mjs
└── payload/''',
    '''├── verify-release.mjs
├── verify-target-profile.mjs
└── payload/''',
    "offline tree verifier"
)
offline = replace_in(
    offline,
    '''    │   ├── migrations
    │   ├── scripts/runtime''',
    '''    │   ├── migrations
    │   ├── README.md
    │   ├── docs/
    │   ├── scripts/runtime''',
    "offline tree docs"
)
offline = replace_in(
    offline,
    '''        ├── manifest.sha256
        ├── packages.tsv
        ├── source-os.env''',
    '''        ├── manifest.sha256
        ├── packages.tsv
        ├── requested-packages.txt
        ├── source-os.env''',
    "offline tree package metadata"
)
offline = replace_in(
    offline,
    '''Сборщик создаёт точный `manifest.sha256`, `packages.tsv` с Debian metadata и `source-os.env` с выпуском reference VM и архитектурой. Набор с повтором имени пакета, другой архитектурой или несовпадающим metadata не принимается.''',
    '''Сборщик разрешает зависимости с пустым состоянием `dpkg`, поэтому в каталог загружается полное обязательное транзитивное замыкание независимо от уже установленных пакетов эталонной машины. `--no-install-recommends` исключает только необязательные рекомендации. Создаются `manifest.sha256`, `packages.tsv`, отсортированный `requested-packages.txt` и `source-os.env` с семейством ОС, точным выпуском, архитектурой, признаком `DEPENDENCY_CLOSURE=full` и контрольной суммой исходного списка. Неполный или смешанный набор отклоняется.''',
    "offline dependency closure"
)
offline = re.sub(
    r'''> \[!WARNING\]\n> `apt-get --download-only` зависит от состояния reference VM\. Проверяйте полный набор на чистой offline VM\. Astra repositories и package pins должны совпадать с target\.''',
    '''> [!IMPORTANT]
> Репозитории, приоритеты пакетов и закреплённые версии эталонной Debian/Astra Linux должны совпадать с целевым сервером. Полное замыкание устраняет зависимость от установленных пакетов эталонной машины, но не делает пакеты одного выпуска совместимыми с другим выпуском ОС.''',
    offline,
    count=1
)
for snippet in [
    '''  --llama-server /srv/build/llama.cpp/llama-server \\
''',
    '''  --node-runtime-dir /srv/runtime/node-v24.18.0-linux-x64 \\
''',
    '''  --node-archive /srv/cache/node-v24.18.0-linux-x64.tar.xz \\
''',
]:
    if snippet in offline:
        offline = offline.replace(snippet, snippet + "  --target-profile debian \\\n", 1)
offline = replace_in(
    offline,
    '''8. повторно проверяет bundle;
9. создаёт `.tar.gz`.''',
    '''8. проверяет точный профиль ОС, полноту зависимостей, документацию и интерфейс произвольных объектов;
9. создаёт `.tar.gz`, проверяет его SHA-256, безопасно распаковывает во временный каталог и повторно запускает внутренний verifier.''',
    "offline build stages"
)
offline = replace_in(
    offline,
    '''Script не создаёт молча неполный bundle:''',
    '''Сценарий не создаёт молча неполный комплект:''',
    "offline Russian wording"
)
offline += '''

## 9. Проверка актуальности перед переносом

Для каждого изменения `main` CI собирает профиль `generic` без LLM, LibreOffice и браузерного набора. Это подтверждает, что исходники, production-зависимости, документация, интерфейс и внутренние manifests действительно образуют устанавливаемый архив. Полные профили Debian и Astra Linux собираются только на эталонной машине соответствующего выпуска:

```bash
npm run bundle:offline:debian -- \\
  --llama-server /srv/runtime/llama-server \\
  --model /srv/models/model.gguf

npm run bundle:offline:astra -- \\
  --llama-server /srv/runtime/llama-server \\
  --model /srv/models/model.gguf \\
  --ux-chromium-package chromium-gost \\
  --ux-chromium-bin /usr/bin/chromium-gost
```

Параметры Chromium для Astra являются примером и должны соответствовать фактическому пакету эталонной машины. После установки обязательна команда `target-acceptance.sh`; без её акта строка платформы в матрице остаётся «не проверено».
'''
write("docs/OFFLINE_DEPLOYMENT.md", offline)

support = read("docs/SUPPORT_MATRIX.md")
support = support.replace("Дата: **2026-07-19**", "Дата: **2026-07-28**", 1)
support = support.replace(
    "версия встроенного Node.js, preview/UX-профили, SHA `manifest.sha256` и `packages.tsv` набора `.deb`;",
    "версия встроенного Node.js, профиль `debian`/`astra`, `DEPENDENCY_CLOSURE=full`, preview/UX-профили, SHA `manifest.sha256`, `packages.tsv` и `requested-packages.txt`;",
    1
)
support = support.replace(
    "содержит 10 SHA-256-зафиксированных файлов",
    "содержит 12 SHA-256-зафиксированных файлов, включая отдельные CSV людей, аудиторий и научных статей",
    1
)
write("docs/SUPPORT_MATRIX.md", support)

release_notes = read("docs/RELEASE_NOTES.md")
release_section = '''## 2026-07-28 — произвольные объекты и проверяемая автономная поставка

- Пространства поддерживают людей, аудитории, научные статьи, оборудование и другие произвольные типы объектов с собственными параметрами.
- Добавлен отдельный каталог объектов, ручное редактирование, гибкий CSV/XLSX-импорт, устойчивые идентификаторы и предварительный план без записи.
- Одноимённые поля разных типов разрешаются только в контексте выбранного типа; смешанные группы и выпуски блокируются сервером.
- Редактор шаблона, повторяемая строка и мастер выпуска фильтруют поля, группы и записи по типу объекта; кадровый интерфейс и варианты ФИО сохранены для типа «Человек».
- Автономный сборщик загружает полное обязательное замыкание `.deb` с пустым состоянием `dpkg`, закрепляет семейство ОС и проверяет `requested-packages.txt`.
- В комплект входят полная документация и интерфейс произвольных объектов. Готовый архив повторно проверяется после контрольной распаковки.
- CI собирает профиль `generic` при каждом изменении; целевые профили Debian/Astra требуют совпадающую эталонную машину и отдельный акт `target-acceptance.sh`.

'''
release_notes = replace_in(
    release_notes,
    "## 2026-07-26 — целостная таблица Word, необязательный PDF и чистая CSP\n",
    release_section + "## 2026-07-26 — целостная таблица Word, необязательный PDF и чистая CSP\n",
    "release notes generic section"
)
release_notes = release_notes.replace(
    "1. создать сотрудников вручную либо импортировать до 1000 строк из CSV/XLSX;",
    "1. создать произвольный тип объектов либо использовать тип «Человек», затем вручную или из CSV/XLSX загрузить до 1000 записей;",
    1
)
release_notes = release_notes.replace(
    "Самодостаточный bundle содержит",
    "Самодостаточный комплект содержит",
    1
)
write("docs/RELEASE_NOTES.md", release_notes)


# ---------------------------------------------------------------------------
# 5. CI must assemble a real generic offline archive on every PR/main push.
# ---------------------------------------------------------------------------
ci = read(".github/workflows/ci.yml")
offline_job = '''

  offline-bundle:
    name: Assemble and verify offline archive
    needs: verify
    runs-on: ubuntu-24.04
    timeout-minutes: 30

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Read Node.js version
        id: node
        shell: bash
        run: echo "version=$(cat .node-version)" >> "$GITHUB_OUTPUT"

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ steps.node.outputs.version }}
          cache: npm

      - name: Install locked dependencies
        run: npm ci --ignore-scripts --no-audit --no-fund

      - name: Assemble generic offline archive
        shell: bash
        run: |
          set -Eeuo pipefail
          NODE_RUNTIME_ROOT="$(dirname "$(dirname "$(command -v node)")")"
          scripts/offline/prepare-bundle.sh \
            --target-profile generic \
            --node-runtime-dir "$NODE_RUNTIME_ROOT" \
            --without-llm \
            --without-preview \
            --without-ux-acceptance \
            --skip-tests \
            --force

      - name: Verify archive after extraction
        shell: bash
        run: |
          set -Eeuo pipefail
          VERSION="$(cat VERSION)"
          case "$(dpkg --print-architecture)" in
            amd64) NODE_ARCH=x64 ;;
            arm64) NODE_ARCH=arm64 ;;
            *) exit 1 ;;
          esac
          ARCHIVE="offline-bundles/docomator-${VERSION}-linux-${NODE_ARCH}.tar.gz"
          CHECKSUM="${ARCHIVE}.sha256"
          (cd "$(dirname "$ARCHIVE")" && sha256sum --check --strict --quiet "$(basename "$CHECKSUM")")
          EXTRACTED="$RUNNER_TEMP/docomator-offline-extracted"
          mkdir -p "$EXTRACTED"
          while IFS= read -r member; do
            [[ -n "$member" && "$member" != /* ]] || exit 1
            case "/$member/" in */../*) exit 1 ;; esac
          done < <(tar -tzf "$ARCHIVE")
          tar -xzf "$ARCHIVE" -C "$EXTRACTED"
          BUNDLE="$EXTRACTED/docomator-${VERSION}-linux-${NODE_ARCH}"
          "$BUNDLE/verify-bundle.sh" "$BUNDLE"
'''
if "  offline-bundle:\n" in ci:
    raise RuntimeError("offline-bundle job already exists")
ci += offline_job
write(".github/workflows/ci.yml", ci)

print("final generic release patch applied")
