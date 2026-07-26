from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value, encoding="utf-8")
    print(f"updated {path}")


def replace_once(path: str, old: str, new: str) -> None:
    value = read(path)
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    write(path, value.replace(old, new, 1))


fixture_path = "tests/e2e/fixtures/docomator-api.mjs"
fixture = read(fixture_path)

marker = '''  const secondary = createSpaceState(0, false);
  primary.operations = Array.isArray(options.operations)'''
replacement = '''  const secondary = createSpaceState(0, false);
  primary.groups = Array.isArray(primary.groups) ? primary.groups : [];
  secondary.groups = Array.isArray(secondary.groups) ? secondary.groups : [];
  primary.multiTrialVersions = [];
  secondary.multiTrialVersions = [];
  primary.operations = Array.isArray(options.operations)'''
if marker in fixture:
    fixture = fixture.replace(marker, replacement, 1)
elif replacement not in fixture:
    raise RuntimeError("fixture scenario initialization marker was not found")

marker = '''    fieldRequests: [],
    inspectedFileName: "Личная карточка.docx",'''
replacement = '''    fieldRequests: [],
    fieldUpdateRequests: [],
    fieldDeleteRequests: [],
    groupRequests: [],
    multiTrialRequests: [],
    inspectedFileName: "Личная карточка.docx",'''
if marker in fixture:
    fixture = fixture.replace(marker, replacement, 1)
elif replacement not in fixture:
    raise RuntimeError("fixture request arrays marker was not found")

old_definition = '''      const definition = {
        key: `person.e2e_field_${state.properties.length + 1}`,
        label: payload.label,
        valueType: payload.valueType || "string",
        sensitivity: payload.sensitivity || "personal",
        appliesTo: payload.appliesTo || ["person"]
      };'''
new_definition = '''      const definition = {
        key: `person.e2e_field_${state.properties.length + 1}`,
        label: payload.label,
        valueType: payload.valueType || "string",
        sensitivity: payload.sensitivity || "personal",
        appliesTo: payload.appliesTo || ["person"],
        aliases: payload.aliases || [],
        validation: payload.validation || {}
      };'''
if old_definition in fixture:
    fixture = fixture.replace(old_definition, new_definition, 1)
elif new_definition not in fixture:
    raise RuntimeError("fixture property definition marker was not found")

old_groups = '''    } else if (/\/(?:groups|audience-snapshots)$/.test(path) && method === "GET") {
      data = [];'''
new_groups = '''    } else if (/\/groups$/.test(path) && method === "GET") {
      data = space.groups;
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
      state.groupRequests.push({ method, path, payload });
      data = group;
    } else if (/\/groups\/[^/]+\/members$/.test(path) && method === "GET") {
      const groupId = decodeURIComponent(path.split("/").at(-2));
      const group = space.groups.find((candidate) => candidate.id === groupId);
      data = (group?.memberIds || []).map((entityId, position) => {
        const employee = space.employees.find((candidate) => employeeIdFromFixture(candidate) === entityId);
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
      state.groupRequests.push({ method, path, payload });
      data = (group?.memberIds || []).map((entityId, position) => ({
        entityId,
        position,
        displayName: space.employees.find((candidate) => employeeIdFromFixture(candidate) === entityId)?.displayName || entityId,
        entityTypeKey: "person",
        entityTypeLabel: "Человек",
        status: "active"
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
      state.groupRequests.push({ method, path, payload });
      data = group;
    } else if (/\/audience-snapshots$/.test(path) && method === "GET") {
      data = [];'''
if old_groups in fixture:
    fixture = fixture.replace(old_groups, new_groups, 1)
elif new_groups not in fixture:
    raise RuntimeError("fixture groups marker was not found")

# Helper used by group mocks without importing browser-side utilities.
helper_marker = '''function pathSpaceId(path) {
  return path.match(/^\/api\/v1\/spaces\/([^/]+)/)?.[1] || E2E_SPACE_ID;
}
'''
helper_addition = helper_marker + '''
function employeeIdFromFixture(employee) {
  return employee?.id || employee?.employeeId || employee?.entityId || "";
}
'''
if "function employeeIdFromFixture" not in fixture:
    if helper_marker not in fixture:
        raise RuntimeError("fixture pathSpaceId helper marker was not found")
    fixture = fixture.replace(helper_marker, helper_addition, 1)

old_field = '''      const field = {
        id: `template-field-${draft.fields.length + 1}`,
        key: payload.key,
        label: payload.label,
        valueType: payload.valueType,
        required: Boolean(payload.required),
        elementId: payload.elementId,
        textRange: payload.textRange || null
      };'''
new_field = '''      const element = draft.structure.elements.find((candidate) => candidate.id === payload.elementId);
      const field = {
        id: `template-field-${draft.fields.length + 1}`,
        key: payload.key,
        label: payload.label,
        valueType: payload.valueType,
        required: Boolean(payload.required),
        elementId: payload.elementId,
        textRange: payload.textRange || null,
        formatter: payload.personName
          ? { version: 1, kind: "person-name.ru", ...payload.personName }
          : { version: 1, kind: "identity" },
        binding: {
          version: 1,
          kind: "docx.paragraph",
          elementId: payload.elementId,
          part: element?.part || "word/document.xml",
          index: element?.index || 0,
          tableLocation: element?.tableLocation || null
        }
      };'''
if old_field in fixture:
    fixture = fixture.replace(old_field, new_field, 1)
elif new_field not in fixture:
    raise RuntimeError("fixture field object marker was not found")

post_field_end = '''      data = { field, repeatBinding: draft.repeatBinding };
    } else if (/\/template-drafts$/.test(path) && method === "GET") {'''
field_routes = '''      data = { field, repeatBinding: draft.repeatBinding };
    } else if (/\/template-drafts\/[^/]+\/fields\/[^/]+$/.test(path) && method === "PUT") {
      const payload = await jsonBody(request);
      const fieldId = decodeURIComponent(path.split("/").pop());
      const draftId = decodeURIComponent(path.split("/").at(-3));
      const draft = space.drafts.find((candidate) => candidate.id === draftId);
      const field = draft?.fields.find((candidate) => candidate.id === fieldId);
      if (field) {
        Object.assign(field, {
          key: payload.key,
          label: payload.label,
          valueType: payload.valueType,
          required: Boolean(payload.required),
          formatter: payload.personName
            ? { version: 1, kind: "person-name.ru", ...payload.personName }
            : { version: 1, kind: "identity" }
        });
      }
      state.fieldUpdateRequests.push(payload);
      data = { field, repeatBinding: draft?.repeatBinding || null };
    } else if (/\/template-drafts\/[^/]+\/fields\/[^/]+$/.test(path) && method === "DELETE") {
      const fieldId = decodeURIComponent(path.split("/").pop());
      const draftId = decodeURIComponent(path.split("/").at(-3));
      const draft = space.drafts.find((candidate) => candidate.id === draftId);
      const deleted = draft?.fields.find((candidate) => candidate.id === fieldId);
      if (draft) {
        draft.fields = draft.fields.filter((candidate) => candidate.id !== fieldId);
        if (draft.fields.length === 0) draft.repeatBinding = null;
      }
      state.fieldDeleteRequests.push({ fieldId, draftId });
      data = {
        draftId,
        deletedFieldId: fieldId,
        deletedFieldKey: deleted?.key || "",
        repeatBindingCleared: !draft?.repeatBinding,
        repeatBinding: draft?.repeatBinding || null
      };
    } else if (/\/template-drafts$/.test(path) && method === "GET") {'''
if post_field_end in fixture:
    fixture = fixture.replace(post_field_end, field_routes, 1)
elif field_routes not in fixture:
    raise RuntimeError("fixture field route insertion marker was not found")

trial_marker = '''    } else if (/\/multi-test-versions$/.test(path) && method === "GET") {
      data = [];'''
trial_routes = '''    } else if (/\/template-drafts\/[^/]+\/trial-all$/.test(path) && method === "POST") {
      const payload = await jsonBody(request);
      const draftId = decodeURIComponent(path.split("/").at(-2));
      const draft = space.drafts.find((candidate) => candidate.id === draftId);
      const expected = new Set((draft?.fields || []).map((field) => field.id));
      const received = new Set((payload.values || []).map((item) => item.fieldId));
      state.multiTrialRequests.push(payload);
      if (expected.size !== received.size || [...expected].some((id) => !received.has(id))) {
        await route.fulfill({
          status: 400,
          headers: JSON_HEADERS,
          body: JSON.stringify({
            error: { message: "Состав полей черновика изменился после открытия формы. Система обновит список; заполните добавленные поля и повторите проверку." },
            correlationId: "e2e-stale-multi-trial"
          })
        });
        return;
      }
      const version = {
        id: `multi-version-${space.multiTrialVersions.length + 1}`,
        versionNumber: space.multiTrialVersions.length + 1,
        fieldCount: draft.fields.length,
        format: draft.format,
        compiledSha256: "e2e-multi-compiled-sha256",
        trialSha256: "e2e-multi-trial-sha256",
        fields: draft.fields.map((field) => {
          const submitted = payload.values.find((item) => item.fieldId === field.id);
          return {
            fieldId: field.id,
            fieldKey: field.key,
            fieldLabel: field.label,
            readBackValue: String(submitted?.value ?? ""),
            renderedValue: String(submitted?.value ?? "")
          };
        })
      };
      space.multiTrialVersions.push(version);
      data = {
        version,
        downloads: {
          compiled: "/api/v1/e2e/multi-compiled",
          trial: "/api/v1/e2e/multi-trial"
        }
      };
    } else if (/\/multi-test-versions$/.test(path) && method === "GET") {
      data = space.multiTrialVersions;'''
if trial_marker in fixture:
    fixture = fixture.replace(trial_marker, trial_routes, 1)
elif trial_routes not in fixture:
    raise RuntimeError("fixture multi-trial marker was not found")

# Keep group counts accurate in the space switcher.
fixture = fixture.replace("groupCount: 0\n", "groupCount: space?.groups?.length || 0\n") if False else fixture
write(fixture_path, fixture)

write(
    "apps/api/src/template-draft-field-edit-routes.test.ts",
    r'''import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import {
  buildZipFixture,
  minimalDocxEntries
} from "@docomator/document-intake/testing";
import { DEFAULT_SPACE_ID } from "@docomator/storage";

import { buildApp } from "./app.js";

function applyMigrations(dataDir: string): void {
  const database = new DatabaseSync(path.join(dataDir, "docomator.db"));
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  for (const migration of fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort()) {
    database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.close();
}

async function testApp() {
  const dataDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "docomator-template-field-edit-")
  );
  applyMigrations(dataDir);
  return {
    dataDir,
    app: buildApp(
      loadApiConfig({
        DOCOMATOR_DATA_DIR: dataDir,
        DOCOMATOR_LOG_LEVEL: "fatal"
      })
    )
  };
}

function sourceDocx(): Buffer {
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>№</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>ФИО</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl></w:body></w:document>'
          }
        : entry
    )
  );
}

async function createDraft(app: ReturnType<typeof buildApp>) {
  const source = await app.inject({
    method: "POST",
    url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/quarantine?fileName=${encodeURIComponent("Список.docx")}`,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
    payload: sourceDocx()
  });
  assert.equal(source.statusCode, 201, source.body);
  const draft = await app.inject({
    method: "POST",
    url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/${source.json().data.id}/draft`,
    headers: { "content-type": "application/json" },
    payload: { title: "Список" }
  });
  assert.equal(draft.statusCode, 201, draft.body);
  return draft.json().data as {
    id: string;
    structure: {
      elements: Array<{
        id: string;
        text: string;
        tableLocation?: { rowIndex: number; columnIndex: number };
      }>;
    };
  };
}

test("API changes and removes saved fields of a repeat row", async () => {
  const { app, dataDir } = await testApp();
  try {
    const draft = await createDraft(app);
    const dataRow = draft.structure.elements
      .filter((element) => element.tableLocation?.rowIndex === 1)
      .sort(
        (left, right) =>
          Number(left.tableLocation?.columnIndex) -
          Number(right.tableLocation?.columnIndex)
      );
    assert.equal(dataRow.length, 2);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "subject.name_test.display_name",
        label: "ФИО участника",
        valueType: "string",
        required: true,
        elementId: dataRow[0].id,
        repeatRow: true,
        personName: {
          sourceOrder: "family-given-patronymic",
          pattern: "{Фамилия} {И}.{О}."
        }
      }
    });
    assert.equal(first.statusCode, 201, first.body);
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "person.position_name",
        label: "Должность",
        valueType: "string",
        required: false,
        elementId: dataRow[1].id
      }
    });
    assert.equal(second.statusCode, 201, second.body);

    const firstField = first.json().data.field as { id: string };
    const secondField = second.json().data.field as { id: string };
    const updated = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields/${firstField.id}`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "subject.position",
        label: "Номер по порядку",
        valueType: "integer",
        required: true
      }
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().data.field.key, "subject.position");
    assert.equal(updated.json().data.field.valueType, "integer");
    assert.notEqual(updated.json().data.repeatBinding, null);

    const deleteSecond = await app.inject({
      method: "DELETE",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields/${secondField.id}`
    });
    assert.equal(deleteSecond.statusCode, 200, deleteSecond.body);
    assert.equal(deleteSecond.json().data.repeatBindingCleared, false);
    assert.notEqual(deleteSecond.json().data.repeatBinding, null);

    const deleteFirst = await app.inject({
      method: "DELETE",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields/${firstField.id}`
    });
    assert.equal(deleteFirst.statusCode, 200, deleteFirst.body);
    assert.equal(deleteFirst.json().data.repeatBindingCleared, true);
    assert.equal(deleteFirst.json().data.repeatBinding, null);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});
''',
)

write(
    "tests/e2e/word-roster-assistant.spec.mjs",
    r'''import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const DOCX = {
  name: "Темы студентов.docx",
  mimeType:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from("controlled-student-roster-docx")
};

async function openRosterTemplate(page) {
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
  await page.locator("#rosterAssistantOpen").click();
  return sampleCell;
}

async function configureInitialRow(page) {
  const cards = page.locator("[data-roster-column]");
  await expect(cards).toHaveCount(3);
  await cards.nth(1).locator("[data-roster-mode]").selectOption("new");
  await cards.nth(1).locator("[data-roster-label]").fill("Тема научной работы");
  await cards.nth(1).locator("[data-roster-type]").selectOption("text");
  await cards.nth(2).locator("[data-roster-mode]").selectOption("new");
  await cards.nth(2).locator("[data-roster-label]").fill("Научный руководитель");
  await page.locator("#rosterAssistantSave").click();
  await expect(page.locator("#rosterAssistantPanel")).toContainText(
    "Связи строки обновлены"
  );
}

test("сохранённую строку можно повторно открыть, сохранить и изменить", async ({
  page
}) => {
  const scenario = await installDocomatorApiMock(page, {
    studentRosterTemplate: true
  });
  const sampleCell = await openRosterTemplate(page);
  await configureInitialRow(page);
  expect(scenario.fieldRequests).toHaveLength(3);

  await page.locator("#rosterAssistantMore").click();
  await sampleCell.click();
  await page.locator("#rosterAssistantOpen").click();
  await expect(page.locator("[data-roster-column] .pill-success")).toHaveCount(3);
  await page.locator("#rosterAssistantSave").click();
  await expect(page.locator("#rosterAssistantPanel")).toContainText(
    "Связи строки обновлены"
  );
  await expect(page.locator("#rosterAssistantPanel")).not.toContainText(
    "Выберите хотя бы одну колонку"
  );
  expect(scenario.fieldUpdateRequests).toHaveLength(3);

  await page.locator("#rosterAssistantMore").click();
  await sampleCell.click();
  await page.locator("#rosterAssistantOpen").click();
  await page
    .locator("[data-roster-column]")
    .nth(2)
    .locator("[data-roster-mode]")
    .selectOption("skip");
  await page.locator("#rosterAssistantSave").click();
  await expect(page.locator("#rosterAssistantPanel")).toContainText(
    "Связано колонок: 2"
  );
  expect(scenario.fieldDeleteRequests).toHaveLength(1);
});

test("общая проверка обновляет изменившийся список полей и сохраняет примеры", async ({
  page
}) => {
  const scenario = await installDocomatorApiMock(page, {
    studentRosterTemplate: true
  });
  await openRosterTemplate(page);
  await configureInitialRow(page);
  await page.locator("#rosterAssistantContinue").click();
  await expect(page.locator("#templateMultiTrialForm")).toBeVisible();
  await page.locator("#templateMultiTrialFillExamples").click();
  const firstControl = page.locator("#templateMultiTrialFields [data-field-id]").first();
  const preservedValue = await firstControl.inputValue();

  scenario.primary.drafts[0].fields.push({
    id: "template-field-added-after-open",
    key: "person.department",
    label: "Кафедра",
    valueType: "string",
    required: true,
    elementId: "word/document.xml#paragraph:external",
    formatter: { version: 1, kind: "identity" }
  });

  await page.locator("#templateMultiTrialSubmit").click();
  await expect(page.locator("#templateMultiTrialRefreshMessage")).toContainText(
    "Список полей обновлён"
  );
  await expect(page.locator("#templateMultiTrialFields [data-field-id]")).toHaveCount(4);
  await expect(page.locator("#templateMultiTrialFields [data-field-id]").first()).toHaveValue(
    preservedValue
  );
  await page.locator("#templateMultiTrialFillExamples").click();
  await page.locator("#templateMultiTrialSubmit").click();
  await expect(page.locator("#templateMultiTrialResult")).toContainText(
    "Проверенная версия 1 готова"
  );
  expect(scenario.multiTrialRequests).toHaveLength(1);
  expect(scenario.multiTrialRequests[0].values).toHaveLength(4);
});
''',
)

write(
    "tests/e2e/group-management-large.spec.mjs",
    r'''import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

test("группа из 100 сотрудников сохраняет выбор между поиском и страницами", async ({
  page
}) => {
  const scenario = await installDocomatorApiMock(page, { employeeCount: 100 });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("employees");
  await page.locator("#operatorGroupsButton").click();

  const dialog = page.locator("#operatorGroupDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#operatorGroupTotalCount")).toHaveText("100");
  await expect(dialog.locator("[data-operator-group-member]")).toHaveCount(25);
  await expect(dialog.locator("#operatorGroupPageLabel")).toContainText(
    "Страница 1 из 4"
  );

  await dialog.locator("#operatorGroupAddFound").click();
  await expect(dialog.locator("#operatorGroupSelectedCount")).toHaveText("100");
  await dialog.locator("#operatorGroupNextPage").click();
  await expect(dialog.locator("#operatorGroupPageLabel")).toContainText(
    "Страница 2 из 4"
  );
  await expect(dialog.locator("#operatorGroupSelectedCount")).toHaveText("100");

  const lastName = scenario.primary.employees.at(-1).displayName;
  await dialog.locator("#operatorGroupSearch").fill(lastName);
  await expect(dialog.locator("#operatorGroupFoundCount")).toHaveText("1");
  await expect(dialog.locator("[data-operator-group-member]")).toHaveCount(1);
  await expect(dialog.locator("[data-operator-group-member]")).toBeChecked();

  await dialog.locator("#operatorGroupName").fill("Все сотрудники — 100 человек");
  await dialog.locator("#operatorGroupSave").click();
  await expect(dialog).not.toBeVisible();
  expect(scenario.primary.groups).toHaveLength(1);
  expect(scenario.primary.groups[0].memberIds).toHaveLength(100);

  await page.locator("#operatorGroupsButton").click();
  await dialog
    .locator("[data-group-v2-open]")
    .filter({ hasText: "Все сотрудники — 100 человек" })
    .click();
  await expect(dialog.locator("#operatorGroupSelectedCount")).toHaveText("100");
  const firstName = scenario.primary.employees[0].displayName;
  await dialog.locator("#operatorGroupSearch").fill(firstName);
  await dialog.locator("[data-operator-group-member]").uncheck();
  await expect(dialog.locator("#operatorGroupSelectedCount")).toHaveText("99");
  await dialog.locator("#operatorGroupSave").click();
  expect(scenario.primary.groups[0].memberIds).toHaveLength(99);
});
''',
)

# Add explicit operator explanations to the guide shipped in the web help center.
guide_path = "docs/USER_GUIDE.md"
guide = read(guide_path)
section = r'''

## 18. Повторное редактирование строки, пробная проверка и большие группы

### Как повторно изменить связанную строку Word

1. Откройте структуру того же черновика.
2. Выберите любую ячейку ранее настроенной строки.
3. Нажмите **«Редактировать строку»**.
4. У каждой колонки будет показано сохранённое поле.
5. Можно выбрать другое поле, изменить обязательность и формат ФИО либо выбрать **«Не заполнять эту колонку»**.
6. Нажмите **«Сохранить связи строки»**. Повторное сохранение без изменений является допустимой операцией.

Колонку `№` или `#` связывайте с системным значением **«Номер по порядку: 1, 2, 3…»**, а не с ФИО. Если удалить все связи строки, повторяемая область отключится.

### Что означает пустое место в шаблоне

Пустая ячейка таблицы или пустой абзац уже готовы принять значение. В них не требуется выделять подчёркивания или другой фрагмент. Выберите поле и сохраните связь: при формировании значение будет записано именно в выбранное пустое место, остальные ячейки и текст не изменятся.

Если в абзаце есть подпись, например `Должность: ____`, выделите только `____`, чтобы сохранить подпись.

### Для чего нужны тестовые примеры

Экран **«Введите примеры для всех полей»** проверяет шаблон, а не карточки сотрудников. Тестовые значения записываются в отдельную копию, считываются обратно и сравниваются. Они не сохраняются в базе сотрудников и не попадут в рабочий выпуск.

Можно нажать **«Заполнить безопасными примерами»**, затем заменить значения на более наглядные. Перед отправкой интерфейс повторно получает текущий состав полей. Если после открытия формы строка была изменена, список обновится, введённые примеры сохранятся по полям, а новые поля будут добавлены в форму.

### Как администрировать группу из 100 и более человек

Менеджер групп хранит выбранный состав независимо от текущей страницы и поиска. Доступны:

- поиск по ФИО и значениям карточки;
- фильтры «все», «только в группе», «только не выбранные»;
- фильтр работающих и всех статусов;
- страницы по 25, 50 или 100 человек;
- добавление или удаление всех найденных;
- отдельные счётчики выбранных, найденных и общего количества;
- поиск среди сохранённых групп;
- архивирование устаревшей группы.

После сохранения группа доступна для выпусков и расписаний. Уже созданный снимок состава не меняется при последующем редактировании группы.
'''
if "## 18. Повторное редактирование строки" not in guide:
    guide = guide.rstrip() + section + "\n"
write(guide_path, guide)

print("tests and documentation prepared")
