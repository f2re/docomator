import { expect, test } from "./fixtures/test.mjs";

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
    buffer: Buffer.from("Код,Название,Корпус,Вместимость\n", "utf8")
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
