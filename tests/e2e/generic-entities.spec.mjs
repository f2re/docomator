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

const roomTypes = [
  { key: "person", label: "Человек", description: "Сотрудник" },
  { key: "room", label: "Аудитория", description: "Учебное помещение" }
];

const roomProperties = [
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
];

async function installScopedPropertyValueMock(page) {
  const valuesByEntity = new Map();
  await page.route(
    /\/api\/v1\/spaces\/[^/]+\/entities\/[^/]+\/properties\/[^/?]+(?:\?.*)?$/u,
    async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      const url = new URL(route.request().url());
      const segments = url.pathname.split("/").filter(Boolean);
      const entityId = decodeURIComponent(segments[5] || "");
      const propertyKey = decodeURIComponent(segments[7] || "");
      const body = route.request().postDataJSON() || {};
      const previous = valuesByEntity.get(entityId) || [];
      const version =
        previous.filter((item) => item.propertyKey === propertyKey).length + 1;
      const record = {
        id: `e2e-value-${entityId}-${propertyKey}-${version}`,
        entityId,
        propertyKey,
        value: body.value,
        valueType: propertyKey === "room.capacity" ? "integer" : "string",
        version,
        sourceType: body.sourceType || "user_input",
        createdAt: "2026-08-07T12:00:00.000Z"
      };
      valuesByEntity.set(entityId, [...previous, record]);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ data: record, correlationId: "e2e-property-write" })
      });
    }
  );
  await page.route(
    /\/api\/v1\/spaces\/[^/]+\/entities\/[^/]+\/property-values(?:\?.*)?$/u,
    async (route) => {
      const url = new URL(route.request().url());
      const segments = url.pathname.split("/").filter(Boolean);
      const entityId = decodeURIComponent(segments[5] || "");
      const propertyKey = url.searchParams.get("propertyKey");
      const values = (valuesByEntity.get(entityId) || []).filter(
        (item) => propertyKey === null || item.propertyKey === propertyKey
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: values, correlationId: "e2e-property-history" })
      });
    }
  );
}

test("оператор создаёт и импортирует произвольные объекты одного типа", async ({
  page
}) => {
  const state = await installDocomatorApiMock(page, {
    entityTypes: roomTypes,
    properties: roomProperties,
    importPreview
  });
  await installScopedPropertyValueMock(page);
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

test("импорт произвольных объектов принимает drag-and-drop и показывает поле для исправления", async ({
  page
}) => {
  const invalidPreview = {
    ...importPreview,
    fileName: "auditoriums-invalid.csv",
    rowCount: 1,
    rows: [
      {
        "Код": "ROOM-X",
        "Название": "Аудитория X",
        "Корпус": "Главный корпус",
        "Вместимость": "abc"
      }
    ],
    sourceRowNumbers: [2],
    sampleRows: [
      {
        "Код": "ROOM-X",
        "Название": "Аудитория X",
        "Корпус": "Главный корпус",
        "Вместимость": "abc"
      }
    ]
  };
  await installDocomatorApiMock(page, {
    entityTypes: roomTypes,
    properties: roomProperties,
    importPreview: invalidPreview
  });
  await page.route("**/data-import/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          rowCount: 1,
          createdCount: 0,
          updatedCount: 0,
          unchangedCount: 0,
          skippedCount: 0,
          failedCount: 1,
          propertyValueCount: 0,
          state: "failed",
          errors: [
            {
              rowNumber: 2,
              externalKey: "ROOM-X",
              message: "Значение «abc» не является целым числом",
              code: "invalid_integer",
              column: "Вместимость",
              propertyKey: "room.capacity",
              rawValue: "abc",
              suggestedAction:
                "Если это код или номер, выберите текстовый тип. Если это число — исправьте значение в исходной таблице."
            }
          ]
        },
        correlationId: "e2e-generic-import-error"
      })
    });
  });

  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("entities");
  await page.locator('[data-entity-action="import"]').click();

  const dropZone = page.locator("#entityImportDialog .bulk-import-drop-zone");
  await expect(dropZone).toBeVisible();
  await expect(dropZone).toContainText("Перетащите Excel или CSV сюда");
  await dropZone.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(
        ["Код,Название,Корпус,Вместимость\nROOM-X,Аудитория X,Главный корпус,abc\n"],
        "auditoriums-invalid.csv",
        { type: "text/csv" }
      )
    );
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      })
    );
  });
  await expect(page.locator("#entityImportMessage")).toContainText("Файл выбран");
  expect(
    await page.locator("#entityImportFile").evaluate((input) => input.files?.[0]?.name)
  ).toBe("auditoriums-invalid.csv");

  await page.locator("#entityImportPreviewButton").click();
  const capacity = page.locator(
    '[data-entity-import-mapping][data-column="Вместимость"]'
  );
  await expect(capacity).toBeVisible();
  await page.locator("#entityImportPlanButton").click();

  await expect(capacity).toHaveClass(/has-import-error/u);
  await expect(capacity).toContainText("1 ошибка");
  await expect(page.locator("#entityImportPlan")).toContainText(
    "Если это код или номер"
  );
  const fixButton = page.locator(
    "#entityImportPlan .bulk-import-error-card button"
  );
  await expect(fixButton).toHaveText("Проверить поле");
  await fixButton.click();
  await expect(capacity.locator("[data-entity-import-mode]")).toBeFocused();

  const geometry = await page.locator("#entityImportDialog").evaluate((dialog) => ({
    clientWidth: dialog.clientWidth,
    scrollWidth: dialog.scrollWidth
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 2);
});
