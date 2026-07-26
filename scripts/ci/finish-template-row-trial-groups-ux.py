from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding="utf-8")
    print(f"updated {path}")


def replace_once(path: str, old: str, new: str) -> None:
    value = read(path)
    count = value.count(old)
    if count != 1:
        raise RuntimeError(
            f"{path}: expected exactly one occurrence, found {count}: {old[:140]!r}"
        )
    write(path, value.replace(old, new, 1))


# Complete the browser API mock after the first integration pass.
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''                entityCount: 0,
                groupCount: 0''',
    '''                entityCount: 0,
                groupCount: state.secondary.groups.filter((group) => group.status === "active").length''',
)
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''    } else if (/\/entities$/.test(path)) {
      data = space.entities;
    } else if (/\/(?:groups|audience-snapshots)$/.test(path) && method === "GET") {
      data = [];
    } else if (/\/active-templates$/.test(path)) {''',
    '''    } else if (/\/groups\/[^/]+\/members$/.test(path) && method === "GET") {
      const groupId = decodeURIComponent(path.split("/").at(-2));
      const group = space.groups.find((candidate) => candidate.id === groupId);
      data = (group?.memberIds || []).map((entityId, position) => {
        const employee = space.employees.find((candidate) => candidate.id === entityId);
        return {
          entityId,
          position,
          displayName: employee?.displayName || entityId,
          entityTypeKey: "person",
          entityTypeLabel: "Человек",
          status: employee?.status || "active"
        };
      });
    } else if (/\/groups\/[^/]+\/members$/.test(path) && method === "PUT") {
      const groupId = decodeURIComponent(path.split("/").at(-2));
      const payload = await jsonBody(request);
      const group = space.groups.find((candidate) => candidate.id === groupId);
      if (group) {
        group.memberIds = [...new Set(payload.entityIds || [])];
        group.memberCount = group.memberIds.length;
        group.version += 1;
      }
      state.groupMemberRequests.push({
        groupId,
        entityIds: [...new Set(payload.entityIds || [])]
      });
      data = (group?.memberIds || []).map((entityId, position) => ({
        entityId,
        position,
        displayName:
          space.employees.find((candidate) => candidate.id === entityId)?.displayName ||
          entityId,
        entityTypeKey: "person",
        entityTypeLabel: "Человек",
        status:
          space.employees.find((candidate) => candidate.id === entityId)?.status ||
          "active"
      }));
    } else if (/\/groups\/[^/]+$/.test(path) && method === "PUT") {
      const groupId = decodeURIComponent(path.split("/").pop());
      const payload = await jsonBody(request);
      const group = space.groups.find((candidate) => candidate.id === groupId);
      if (group) {
        if (payload.name !== undefined) group.name = payload.name;
        if (payload.description !== undefined) group.description = payload.description;
        if (payload.status !== undefined) group.status = payload.status;
        group.version += 1;
      }
      data = group;
    } else if (/\/groups$/.test(path) && method === "POST") {
      const payload = await jsonBody(request);
      const group = {
        id: `group-e2e-${space.groups.length + 1}`,
        spaceId,
        key: `group_e2e_${space.groups.length + 1}`,
        name: payload.name,
        description: payload.description || null,
        status: "active",
        version: 1,
        memberCount: 0,
        memberIds: []
      };
      space.groups.push(group);
      data = group;
    } else if (/\/groups$/.test(path) && method === "GET") {
      data = space.groups.map(({ memberIds: _memberIds, ...group }) => group);
    } else if (/\/entities$/.test(path)) {
      data = space.entities;
    } else if (/\/audience-snapshots$/.test(path) && method === "GET") {
      data = [];
    } else if (/\/active-templates$/.test(path)) {''',
)
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''      const field = {
        id: `template-field-${draft.fields.length + 1}`,
        key: payload.key,
        label: payload.label,
        valueType: payload.valueType,
        required: Boolean(payload.required),
        elementId: payload.elementId,
        textRange: payload.textRange || null
      };''',
    '''      const field = {
        id: `template-field-${draft.fields.length + 1}`,
        key: payload.key,
        label: payload.label,
        valueType: payload.valueType,
        required: Boolean(payload.required),
        elementId: payload.elementId,
        elementKind:
          draft.structure.elements.find((element) => element.id === payload.elementId)
            ?.kind || "paragraph",
        textRange: payload.textRange || null,
        formatter: fieldFormatter(payload),
        version: 1
      };''',
)
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''    } else if (/\/template-drafts\/[^/]+\/fields$/.test(path) && method === "POST") {''',
    '''    } else if (/\/template-drafts\/[^/]+\/fields\/[^/]+$/.test(path) && method === "PUT") {
      const payload = await jsonBody(request);
      const fieldId = decodeURIComponent(path.split("/").pop());
      const draftId = decodeURIComponent(path.split("/").at(-3));
      const draft = space.drafts.find((candidate) => candidate.id === draftId);
      const field = draft?.fields.find((candidate) => candidate.id === fieldId);
      state.fieldUpdateRequests.push({ fieldId, ...payload });
      if (field) {
        field.key = payload.key;
        field.label = payload.label;
        field.valueType = payload.valueType;
        field.required = Boolean(payload.required);
        field.formatter = fieldFormatter(payload);
        field.version = (field.version || 1) + 1;
      }
      data = { field };
    } else if (/\/template-drafts\/[^/]+\/fields\/[^/]+$/.test(path) && method === "DELETE") {
      const fieldId = decodeURIComponent(path.split("/").pop());
      const draftId = decodeURIComponent(path.split("/").at(-3));
      const draft = space.drafts.find((candidate) => candidate.id === draftId);
      const previousCount = draft?.fields.length || 0;
      if (draft) draft.fields = draft.fields.filter((field) => field.id !== fieldId);
      const remainingFieldCount = draft?.fields.length || 0;
      const repeatBindingCleared =
        previousCount > 0 &&
        remainingFieldCount === 0 &&
        Boolean(draft?.repeatBinding);
      if (repeatBindingCleared && draft) draft.repeatBinding = null;
      state.fieldDeleteRequests.push({ fieldId, draftId });
      data = { fieldId, remainingFieldCount, repeatBindingCleared };
    } else if (/\/template-drafts\/[^/]+\/fields$/.test(path) && method === "POST") {''',
)
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''    } else if (/\/multi-test-versions$/.test(path) && method === "GET") {
      data = [];
    } else if (/\/test-versions$/.test(path) && method === "GET") {''',
    '''    } else if (/\/template-drafts\/[^/]+\/trial-all$/.test(path) && method === "POST") {
      const draftId = decodeURIComponent(path.split("/").at(-2));
      const draft = space.drafts.find((candidate) => candidate.id === draftId);
      const payload = await jsonBody(request);
      const provided = new Set((payload.values || []).map((item) => item.fieldId));
      const missing = (draft?.fields || []).filter((field) => !provided.has(field.id));
      const extra = (payload.values || []).filter(
        (item) => !(draft?.fields || []).some((field) => field.id === item.fieldId)
      );
      if (missing.length > 0 || extra.length > 0) {
        await route.fulfill({
          status: 400,
          headers: JSON_HEADERS,
          body: JSON.stringify({
            error: {
              message:
                "Состав полей черновика изменился после открытия формы. Обновите форму и повторите проверку."
            },
            correlationId: "e2e-stale-multi-trial"
          })
        });
        return;
      }
      state.multiTrialBodies.push(payload);
      const values = new Map(
        (payload.values || []).map((item) => [item.fieldId, item.value])
      );
      const version = {
        id: `template-multi-version-${space.multiTrialVersions.length + 1}`,
        versionNumber: space.multiTrialVersions.length + 1,
        format: draft?.format || "docx",
        fieldCount: draft?.fields.length || 0,
        fields: (draft?.fields || []).map((field) => ({
          fieldId: field.id,
          fieldKey: field.key,
          fieldLabel: field.label,
          readBackValue: String(values.get(field.id) ?? "")
        })),
        compiledSha256: "e2e-multi-compiled-sha256",
        trialSha256: "e2e-multi-trial-sha256"
      };
      space.multiTrialVersions.push(version);
      data = {
        version,
        verification: { fieldCount: version.fieldCount, allMatched: true },
        downloads: {
          compiled: "/api/v1/e2e/multi-compiled",
          trial: "/api/v1/e2e/multi-trial"
        }
      };
    } else if (/\/multi-test-versions$/.test(path) && method === "GET") {
      data = space.multiTrialVersions;
    } else if (/\/test-versions$/.test(path) && method === "GET") {''',
)

write(
    "tests/e2e/word-roster-assistant.spec.mjs",
    '''import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const DOCX = {
  name: "Темы студентов.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from("controlled-student-roster-docx")
};

test("повторяемую строку Word можно сохранить, повторно открыть и изменить", async ({
  page
}) => {
  const scenario = await installDocomatorApiMock(page, {
    studentRosterTemplate: true
  });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("templates");

  await page.locator("#documentIntakeFile").setInputFiles(DOCX);
  await page.locator("#documentIntakeButton").click();
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText(
    "Структура прошла проверку"
  );
  await page.locator("#documentQuarantineButton").click();
  await page.locator("#documentStructureButton").click();

  const sampleCell = page.locator(".structure-element").filter({
    hasText: "Таблица 1, строка 2, ячейка 1"
  });
  await sampleCell.click();
  await expect(page.locator(".placement-guidance-card")).toContainText(
    "Выбрана пустая ячейка таблицы"
  );
  await expect(page.locator("#rowEditorEntry")).toContainText(
    "Заполнить всю строку как список участников"
  );
  await page.locator("#rowEditorOpen").click();

  const panel = page.locator("#rowEditorPanel");
  await expect(panel).toBeVisible();
  await expect(page.locator("#documentFieldForm")).toBeHidden();
  await expect(panel.locator("[data-row-editor-column]")).toHaveCount(4);
  await expect(
    panel.locator("[data-row-editor-column]").nth(0).locator("[data-row-editor-mode]")
  ).toHaveValue("system:position");
  await expect(
    panel.locator("[data-row-editor-column]").nth(1).locator("[data-row-editor-mode]")
  ).toHaveValue("system:name");

  await panel.locator("#rowEditorSave").click();
  await expect(panel).toContainText("Строка сохранена");
  expect(scenario.fieldRequests).toHaveLength(4);
  expect(scenario.fieldRequests[0]).toMatchObject({
    key: "subject.position",
    repeatRow: true
  });
  expect(scenario.primary.drafts[0].repeatBinding).toMatchObject({
    kind: "docx.repeat-row",
    source: "audience.members",
    tableIndex: 0,
    rowIndex: 1
  });

  await panel.locator("#rowEditorContinueEditing").click();
  await expect(panel.locator("#rowEditorSave")).toBeEnabled();
  const nameCard = panel.locator("[data-row-editor-column]").nth(1);
  await nameCard
    .locator("[data-row-name-presentation]")
    .selectOption("family-initials");
  const supervisorCard = panel.locator("[data-row-editor-column]").nth(3);
  await supervisorCard.locator("[data-row-editor-mode]").selectOption("skip");
  await panel.locator("#rowEditorSave").click();

  await expect(panel).toContainText("Строка сохранена");
  expect(scenario.fieldUpdateRequests).toHaveLength(3);
  expect(scenario.fieldDeleteRequests).toHaveLength(1);
  expect(
    scenario.fieldUpdateRequests.find((request) => request.personName)
  ).toMatchObject({
    personName: {
      sourceOrder: "family-given-patronymic",
      pattern: "{Фамилия} {И}.{О}."
    }
  });
  expect(scenario.primary.drafts[0].fields).toHaveLength(3);
  expect(scenario.primary.drafts[0].repeatBinding).not.toBeNull();
});
''',
)

replace_once(
    "docs/USER_GUIDE.md",
    '''### Все активные

Используйте источник **«Все активные»**, когда документ должен включать всех людей текущего раздела со статусом «Активный».

## 9. Подготовка DOCX-шаблона''',
    '''### Все активные

Используйте источник **«Все активные»**, когда документ должен включать всех людей текущего раздела со статусом «Активный».

### Администрирование больших групп

Для составов из десятков и сотен людей откройте **«Группы сотрудников»**. Редактор хранит выбор отдельно от текущей страницы, поэтому поиск, фильтр и переход между страницами не снимают уже отмеченных участников.

Порядок работы:

1. найдите существующую группу по названию либо создайте новую;
2. задайте название и описание;
3. найдите человека по ФИО либо включите фильтр **«Только в группе»** / **«Только не выбранных»**;
4. выберите размер страницы 25, 50 или 100;
5. используйте **«Добавить всех найденных»** для результата текущего поиска и фильтров;
6. при необходимости перейдите на другую страницу — предыдущий выбор сохранится;
7. проверьте счётчики **«В группе»**, **«Найдено»** и **«Всего сотрудников»**;
8. сохраните группу.

Кнопка **«Убрать всех найденных»** исключает только людей, соответствующих текущему поиску и фильтрам. **«Очистить группу»** снимает весь выбор. Неактуальную группу перемещайте в архив: ранее созданные снимки состава и история документов сохраняются.

## 9. Подготовка DOCX-шаблона''',
)
replace_once(
    "docs/USER_GUIDE.md",
    '''### Замена части текста

Если в абзаце есть подпись `Должность: ____`, выделите только `____`. Выбор замены всего абзаца удалит подпись.

## 10. Таблица Word: одна строка на каждого человека''',
    '''### Замена части текста

Если в абзаце есть подпись `Должность: ____`, выделите только `____`. Выбор замены всего абзаца удалит подпись.

### Пустая ячейка или пустой абзац

Сообщение **«Выбрана пустая ячейка таблицы»** означает, что место подстановки уже определено целиком. Выделять текст внутри пустого места невозможно и не требуется.

Действия оператора:

1. выберите поле карточки;
2. при необходимости задайте вариант записи ФИО;
3. отметьте обязательность;
4. нажмите **«Связать с документом»**.

В таблице значение будет записано только в выбранную ячейку. Для обычного пустого абзаца весь абзац станет местом значения. Остальные ячейки, строки и абзацы документа не изменяются.

## 10. Таблица Word: одна строка на каждого человека''',
)
replace_once(
    "docs/USER_GUIDE.md",
    '''### Пробная проверка

- для одного поля доступна одиночная проверка;
- для нескольких полей или повторяемой строки используется проверка всего набора;
- система записывает значения в копию;
- затем считывает их обратно;
- расхождение блокирует активацию.

### Перед активацией проверьте''',
    '''### Пробная проверка

- для одного поля доступна одиночная проверка;
- для нескольких полей или повторяемой строки используется проверка всего набора;
- система записывает значения в копию;
- затем считывает их обратно;
- расхождение блокирует активацию.

Тестовые примеры проверяют только шаблон. Они не сохраняются в карточках людей и не используются в рабочем выпуске. Можно заполнить поля вручную либо нажать **«Заполнить безопасными примерами»**.

Если после открытия формы были добавлены, изменены или удалены поля строки, система сначала обновит список. Уже введённые примеры сохранятся, а новые поля будут подсвечены. Заполните их и повторно нажмите **«Создать и проверить пробную копию»**. Сообщение о несовпадении состава полей означает изменение черновика, а не потерю данных сотрудника.

### Перед активацией проверьте''',
)

print("remaining template row, trial and group scenarios applied")
