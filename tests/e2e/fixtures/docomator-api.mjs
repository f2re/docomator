export const E2E_SPACE_ID = "00000000-0000-4000-8000-000000000001";
export const E2E_SECOND_SPACE_ID = "00000000-0000-4000-8000-000000000002";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-correlation-id": "e2e-correlation-id"
};

function envelope(data, correlationId = "e2e-correlation-id") {
  return { data, correlationId };
}

function employeeFixture(position) {
  const id = `employee-e2e-${position}`;
  return {
    id,
    entityId: id,
    displayName: `Сотрудник ${position}`,
    status: "active",
    fields: []
  };
}

function activeTemplateFixture(format = "docx", title = "Личная карточка сотрудника") {
  return {
    id: "active-release-e2e",
    title,
    format,
    fieldCount: 1,
    versionNumber: 1,
    versionKind: "single",
    activatedAt: "2026-07-15T08:00:00.000Z"
  };
}

function createSpaceState(employeeCount = 0, activeTemplate = false) {
  const employees = Array.from({ length: employeeCount }, (_, index) =>
    employeeFixture(index + 1)
  );
  return {
    employees,
    entities: employees.map((employee) => ({
      entityId: employee.entityId,
      displayName: employee.displayName,
      entityTypeLabel: "Человек",
      status: employee.status
    })),
    activeTemplates: activeTemplate ? [activeTemplateFixture()] : [],
    documentSources: [],
    drafts: [],
    trialVersions: [],
    previewRequest: null,
    generationCreated: false,
    operations: []
  };
}

function generationPayload(space) {
  const format = space.activeTemplates[0]?.format || "docx";
  const units = space.entities.map((entity, position) => ({
    id: `output-e2e-${position + 1}`,
    position,
    state: "completed",
    outputName: `${entity.displayName}.${format}`
  }));
  return {
    job: {
      id: "document-job-e2e",
      spaceId: E2E_SPACE_ID,
      templateTitle: "Личная карточка сотрудника",
      targetMode: "one_per_member",
      memberCount: units.length,
      expectedCount: units.length,
      generatedCount: units.length,
      failedCount: 0,
      state: "completed",
      units,
      archiveSha256: "e2e-archive-sha256",
      createdAt: "2026-07-15T09:00:00.000Z"
    },
    downloadUrl: `/api/v1/spaces/${E2E_SPACE_ID}/document-jobs/document-job-e2e/download`
  };
}

function sharedResultFixture(space) {
  return {
    id: "document-result-e2e",
    templateTitle: "Личная карточка сотрудника",
    origin: "manual",
    spaceName: "Отдел разработки",
    targetMode: "one_per_member",
    generatedCount: space.entities.length,
    failedCount: 0,
    state: "new",
    format: space.activeTemplates[0]?.format || "docx",
    archiveSha256: "e2e-archive-sha256",
    availableAt: "2026-07-15T09:00:00.000Z"
  };
}

function structureReport(fileName) {
  const format = fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "docx";
  const common = {
    fileName,
    format,
    sourceSha256: `e2e-${format}-source-sha256`,
    structureSha256: `e2e-${format}-structure-sha256`,
    truncated: false
  };
  if (format === "xlsx") {
    return {
      ...common,
      summary: {
        sheets: 1,
        cells: 2,
        formulas: 0,
        shownElements: 1,
        totalElements: 1
      },
      elements: [
        {
          id: "xl/worksheets/sheet1.xml#cell:B2",
          kind: "cell",
          sheetName: "Сотрудники",
          address: "B2",
          value: "ФИО сотрудника",
          formula: null
        }
      ]
    };
  }
  return {
    ...common,
    summary: {
      paragraphs: 2,
      runs: 2,
      partsRead: 1,
      shownElements: 1,
      totalElements: 1
    },
    elements: [
      {
        id: "word/document.xml#paragraph:1",
        kind: "paragraph",
        part: "word/document.xml",
        index: 0,
        text: "ФИО: ______",
        runsTruncated: false
      }
    ]
  };
}

async function jsonBody(request) {
  try {
    return await request.postDataJSON();
  } catch {
    return {};
  }
}

function pathSpaceId(path) {
  return path.match(/^\/api\/v1\/spaces\/([^/]+)/)?.[1] || E2E_SPACE_ID;
}

export function createDocomatorScenario(options = {}) {
  const primary = createSpaceState(
    options.employeeCount || 0,
    Boolean(options.activeTemplate)
  );
  const secondary = createSpaceState(0, false);
  primary.operations = Array.isArray(options.operations)
    ? options.operations.map((operation) => ({ ...operation }))
    : [];
  secondary.operations = Array.isArray(options.secondaryOperations)
    ? options.secondaryOperations.map((operation) => ({ ...operation }))
    : [];
  return {
    ...primary,
    primary,
    secondary,
    includeSecondSpace: Boolean(options.secondSpace),
    properties: [],
    failTrialRemaining: options.failTrialOnce ? 1 : 0,
    failOperationsRemaining: options.failOperationsOnce ? 1 : 0,
    operationRequests: [],
    importBodies: [],
    importRuns: [],
    directAnalyzeCalls: 0,
    draftRequests: [],
    inspectedFileName: "Личная карточка.docx",
    format: "docx"
  };
}

export async function installDocomatorApiMock(page, options = {}) {
  const state = createDocomatorScenario(options);

  await page.route("**/e2e-template-preview.pdf", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: "%PDF-1.4\n%e2e\n"
    });
  });

  await page.route("**/readyz", async (route) => {
    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: "ok" })
    });
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const spaceId = decodeURIComponent(pathSpaceId(path));
    const space = spaceId === E2E_SECOND_SPACE_ID ? state.secondary : state.primary;
    let data;

    if (/\/operations$/.test(path) && method === "GET") {
      state.operationRequests.push({ method, path, spaceId });
      if (state.failOperationsRemaining > 0) {
        state.failOperationsRemaining -= 1;
        await route.fulfill({
          status: 500,
          headers: JSON_HEADERS,
          body: JSON.stringify({
            error: { message: "Операции временно недоступны." },
            correlationId: "e2e-operations-error"
          })
        });
        return;
      }
      data = space.operations;
    } else if (path === "/api/v1/operations/readiness" && method === "GET") {
      data = {
        status: "ready",
        generatedAt: "2026-07-15T09:00:00.000Z",
        version: "0.1.0-e2e",
        summary: { ok: 2, warning: 0, error: 0, disabled: 0 },
        checks: [
          {
            id: "database",
            title: "Локальная база",
            state: "ok",
            required: true,
            summary: "База готова",
            detail: "Миграции применены, запись доступна.",
            remediation: null,
            data: {}
          },
          {
            id: "disk",
            title: "Хранилище файлов",
            state: "ok",
            required: true,
            summary: "Место доступно",
            detail: "Проверочная запись завершена.",
            remediation: null,
            data: { freeBytes: 10_737_418_240, totalBytes: 21_474_836_480, freePercent: 50 }
          }
        ]
      };
    } else if (path === "/api/v1/storage/usage" && method === "GET") {
      data = {
        objectCount: 8,
        objectBytes: 1_048_576,
        referencedCount: 8,
        referencedBytes: 1_048_576,
        cleanupCandidateCount: 0,
        cleanupCandidateBytes: 0,
        cutoff: "2026-07-09T09:00:00.000Z"
      };
    } else if (path === "/api/v1/knowledge/entity-types") {
      data = [{ key: "person", label: "Человек", description: "Сотрудник" }];
    } else if (
      path === "/api/v1/knowledge/property-definitions" &&
      method === "GET"
    ) {
      data = state.properties;
    } else if (
      path === "/api/v1/knowledge/property-definitions" &&
      method === "POST"
    ) {
      const payload = await jsonBody(request);
      const definition = {
        key: `person.e2e_field_${state.properties.length + 1}`,
        label: payload.label,
        valueType: payload.valueType || "string",
        sensitivity: payload.sensitivity || "personal",
        appliesTo: payload.appliesTo || ["person"]
      };
      state.properties.push(definition);
      data = definition;
    } else if (path === "/api/v1/spaces") {
      data = [
        {
          id: E2E_SPACE_ID,
          name: "Отдел разработки",
          description: "Тестовый локальный раздел",
          entityCount: state.primary.entities.length,
          groupCount: 0
        },
        ...(state.includeSecondSpace
          ? [
              {
                id: E2E_SECOND_SPACE_ID,
                name: "Отдел эксплуатации",
                description: "Второй изолированный раздел",
                entityCount: 0,
                groupCount: 0
              }
            ]
          : [])
      ];
    } else if (/\/employees$/.test(path) && method === "GET") {
      data = space.employees;
    } else if (/\/employees$/.test(path) && method === "POST") {
      const payload = await jsonBody(request);
      const fields = (Array.isArray(payload.fields) ? payload.fields : []).map(
        (field, index) => {
          if (field.definition) {
            const definition = {
              key: `person.e2e_field_${state.properties.length + index + 1}`,
              label: field.definition.label,
              valueType: field.definition.valueType,
              sensitivity: "personal",
              appliesTo: ["person"]
            };
            state.properties.push(definition);
            return {
              propertyKey: definition.key,
              label: definition.label,
              valueType: definition.valueType,
              value: field.value,
              definition
            };
          }
          const definition = state.properties.find(
            (candidate) => candidate.key === field.propertyKey
          );
          return {
            propertyKey: field.propertyKey,
            label: definition?.label || "Поле",
            valueType: definition?.valueType || "string",
            value: field.value
          };
        }
      );
      const id = `employee-e2e-${space.employees.length + 1}`;
      const employee = {
        id,
        entityId: id,
        displayName: payload.displayName,
        status: payload.status || "active",
        fields
      };
      space.employees.push(employee);
      space.entities.push({
        entityId: id,
        displayName: employee.displayName,
        entityTypeLabel: "Человек",
        status: employee.status
      });
      data = employee;
    } else if (/\/employees\/[^/]+$/.test(path) && method === "GET") {
      const id = decodeURIComponent(path.split("/").pop());
      data = space.employees.find((employee) => employee.id === id) || null;
    } else if (/\/entities$/.test(path)) {
      data = space.entities;
    } else if (/\/(?:groups|audience-snapshots)$/.test(path) && method === "GET") {
      data = [];
    } else if (/\/active-templates$/.test(path)) {
      data = space.activeTemplates;
    } else if (/\/data-import\/preview$/.test(path) && method === "POST") {
      data = {
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
      };
    } else if (/\/data-import\/plan$/.test(path) && method === "POST") {
      data = {
        createdCount: 2,
        updatedCount: 0,
        unchangedCount: 0,
        failedCount: 0,
        errors: []
      };
    } else if (/\/data-import\/execute$/.test(path) && method === "POST") {
      const payload = await jsonBody(request);
      state.importBodies.push(payload);
      for (const row of payload.rows || []) {
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
          entityTypeLabel: "Человек",
          status: "active"
        });
      }
      const result = {
        id: "data-import-run-e2e",
        state: "completed",
        fileName: payload.fileName,
        createdCount: 2,
        updatedCount: 0,
        unchangedCount: 0,
        failedCount: 0,
        errors: [],
        groupName: null,
        createdAt: "2026-07-15T08:45:00.000Z"
      };
      state.importRuns = [result];
      data = result;
    } else if (/\/data-import\/runs$/.test(path) && method === "GET") {
      data = state.importRuns;
    } else if (
      path === "/api/v1/document-intake/inspect" &&
      method === "POST"
    ) {
      state.inspectedFileName =
        url.searchParams.get("fileName") || "Личная карточка.docx";
      state.format = state.inspectedFileName.toLowerCase().endsWith(".xlsx")
        ? "xlsx"
        : "docx";
      data = {
        fileName: state.inspectedFileName,
        format: state.format,
        decision: "accepted",
        sha256: `e2e-${state.format}-source-sha256`,
        issues: [],
        summary: {
          fileCount: 8,
          entryCount: 8,
          compressedBytes: 2048,
          uncompressedBytes: 8192,
          relationshipFiles: 1,
          externalRelationships: 0
        }
      };
    } else if (
      path === "/api/v1/document-intake/analyze" &&
      method === "POST"
    ) {
      state.directAnalyzeCalls += 1;
      data = structureReport(
        url.searchParams.get("fileName") || state.inspectedFileName
      );
    } else if (/\/document-sources\/quarantine$/.test(path) && method === "POST") {
      const fileName = url.searchParams.get("fileName") || state.inspectedFileName;
      const format = fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "docx";
      const record = {
        id: `document-source-${format}-e2e`,
        spaceId,
        fileName,
        format,
        decision: "accepted",
        sizeBytes: request.postDataBuffer()?.length || 1,
        sha256: `e2e-${format}-source-sha256`,
        createdAt: "2026-07-15T08:30:00.000Z"
      };
      space.documentSources = [record];
      data = record;
    } else if (/\/document-sources\/[^/]+\/draft$/.test(path) && method === "POST") {
      const payload = await jsonBody(request);
      const sourceId = decodeURIComponent(path.split("/").at(-2));
      const source = space.documentSources.find((record) => record.id === sourceId);
      state.draftRequests.push({
        contentType: request.headers()["content-type"] || "",
        payload,
        sourceId
      });
      const sourceStructure = structureReport(
        source?.fileName || state.inspectedFileName
      );
      let draft = space.drafts[0];
      if (!draft) {
        draft = {
          id: `template-draft-${spaceId}`,
          spaceId,
          sourceRecordId: sourceId,
          title: payload.title || "Личная карточка",
          status: "draft",
          format: sourceStructure.format,
          sourceSha256: sourceStructure.sourceSha256,
          structureSha256: sourceStructure.structureSha256,
          structure: sourceStructure,
          structureTruncated: false,
          fields: []
        };
        space.drafts.push(draft);
      }
      data = draft;
    } else if (/\/document-sources$/.test(path)) {
      data = space.documentSources;
    } else if (/\/document-sources\/[^/]+$/.test(path) && method === "GET") {
      const sourceId = decodeURIComponent(path.split("/").pop());
      data = space.documentSources.find((record) => record.id === sourceId) || null;
    } else if (/\/template-drafts\/[^/]+\/fields$/.test(path) && method === "POST") {
      const payload = await jsonBody(request);
      const draft = space.drafts[0];
      const field = {
        id: `template-field-${draft.fields.length + 1}`,
        key: payload.key,
        label: payload.label,
        valueType: payload.valueType,
        required: Boolean(payload.required),
        elementId: payload.elementId,
        textRange: payload.textRange || null
      };
      draft.fields.push(field);
      data = { field };
    } else if (/\/template-drafts$/.test(path) && method === "GET") {
      data = space.drafts;
    } else if (/\/template-drafts\/[^/]+$/.test(path) && method === "GET") {
      const draftId = decodeURIComponent(path.split("/").pop());
      data = space.drafts.find((draft) => draft.id === draftId) || null;
    } else if (/\/multi-test-versions$/.test(path) && method === "GET") {
      data = [];
    } else if (/\/test-versions$/.test(path) && method === "GET") {
      data = space.trialVersions;
    } else if (/\/template-drafts\/[^/]+\/trial$/.test(path) && method === "POST") {
      if (state.failTrialRemaining > 0) {
        state.failTrialRemaining -= 1;
        await route.fulfill({
          status: 500,
          headers: { ...JSON_HEADERS, "x-correlation-id": "e2e-trial-error-id" },
          body: JSON.stringify({
            error: { message: "Пробная копия временно недоступна." },
            correlationId: "e2e-trial-error-id"
          })
        });
        return;
      }
      const payload = await jsonBody(request);
      const renderedValue = String(payload.value);
      const version = {
        id: `template-test-version-${space.trialVersions.length + 1}`,
        versionNumber: space.trialVersions.length + 1,
        format: state.format,
        renderedValue,
        compiledSha256: "e2e-compiled-sha256",
        trialSha256: "e2e-trial-sha256"
      };
      space.trialVersions.push(version);
      data = {
        version,
        verification: { renderedValue, readBackValue: renderedValue },
        downloads: {
          compiled: "/api/v1/e2e/compiled",
          trial: "/api/v1/e2e/trial"
        }
      };
    } else if (/\/template-(?:multi-)?test-versions\/[^/]+\/preview$/.test(path) && method === "POST") {
      space.previewRequest = {
        id: "template-preview-e2e",
        state: "ready",
        workerJobState: "completed",
        requestAttempt: 1,
        correlationId: "e2e-preview-correlation-id",
        previewSha256: "e2e-preview-sha256",
        converter: { converter: "LibreOffice" },
        versionKind: "single",
        fieldCount: 1
      };
      data = { request: space.previewRequest };
    } else if (/\/template-previews\/[^/]+\/activate$/.test(path) && method === "POST") {
      const draft = space.drafts[0];
      const active = activeTemplateFixture(
        draft?.format || state.format,
        draft?.title || "Личная карточка сотрудника"
      );
      space.activeTemplates = [active];
      data = {
        active,
        previewUrl: "/e2e-template-preview.pdf",
        compiledUrl: "/api/v1/e2e/compiled"
      };
    } else if (/\/template-previews\/[^/]+$/.test(path) && method === "GET") {
      data = {
        request: space.previewRequest,
        previewUrl: "/e2e-template-preview.pdf"
      };
    } else if (/\/audience-snapshots$/.test(path) && method === "POST") {
      data = {
        snapshot: {
          id: "audience-snapshot-e2e",
          memberCount: space.entities.length
        },
        plan: {
          documentCount: space.entities.length,
          targetMode: "one_per_member"
        }
      };
    } else if (/\/document-jobs\/preflight$/.test(path) && method === "POST") {
      data = {
        targetMode: "one_per_member",
        memberCount: space.entities.length,
        readyMemberCount: space.entities.length,
        missingMemberCount: 0,
        missingValueCount: 0,
        canStart: true,
        members: space.entities.map((entity, position) => ({
          position,
          displayName: entity.displayName,
          ready: true,
          missingRequired: []
        }))
      };
    } else if (/\/document-jobs$/.test(path) && method === "POST") {
      space.generationCreated = true;
      data = generationPayload(space);
    } else if (/\/document-jobs$/.test(path) && method === "GET") {
      data = space.generationCreated ? [generationPayload(space)] : [];
    } else if (/\/document-jobs\/[^/]+\/download$/.test(path) && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-disposition": 'attachment; filename="docomator-e2e.zip"',
          "content-type": "application/zip"
        },
        body: "PK\u0003\u0004e2e-zip"
      });
      return;
    } else if (/\/document-jobs\/[^/]+$/.test(path) && method === "GET") {
      data = generationPayload(space);
    } else if (path === "/api/v1/document-results/summary") {
      const count = state.primary.generationCreated ? 1 : 0;
      data = {
        newCount: count,
        availableCount: count,
        collectedCount: 0,
        automaticNewCount: 0,
        latestAvailableAt: count ? "2026-07-15T09:00:00.000Z" : null
      };
    } else if (path === "/api/v1/document-results") {
      data = state.primary.generationCreated
        ? [sharedResultFixture(state.primary)]
        : [];
    }

    if (data === undefined) {
      await route.fulfill({
        status: 404,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: { message: `E2E-маршрут не описан: ${method} ${path}` },
          correlationId: "e2e-unhandled-route"
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(envelope(data))
    });
  });

  return state;
}
