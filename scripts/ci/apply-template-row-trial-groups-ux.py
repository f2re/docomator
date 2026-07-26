from __future__ import annotations

import json
import re
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


def insert_after(path: str, marker: str, addition: str) -> None:
    value = read(path)
    if addition.strip() in value:
        return
    if marker not in value:
        raise RuntimeError(f"{path}: marker not found: {marker!r}")
    write(path, value.replace(marker, marker + addition, 1))


# ---------------------------------------------------------------------------
# Storage and API integration
# ---------------------------------------------------------------------------
insert_after(
    "packages/storage/src/index.ts",
    'export * from "./template-drafts.js";\n',
    'export * from "./template-draft-field-editor.js";\n',
)

replace_once(
    "apps/api/src/template-draft-field-edit-routes.ts",
    '''  type JsonValue,
  SqliteStore,
  TemplateDraftFieldEditor,''',
    '''  type JsonValue,
  TemplateDraftFieldEditor,''',
)
replace_once(
    "apps/api/src/template-draft-field-edit-routes.ts",
    '''export function registerTemplateDraftFieldEditRoutes(
  app: FastifyInstance,
  store: SqliteStore
): void {
  const editor = new TemplateDraftFieldEditor(store);
''',
    '''export function registerTemplateDraftFieldEditRoutes(
  app: FastifyInstance,
  editor: TemplateDraftFieldEditor
): void {
''',
)

replace_once(
    "apps/api/src/app.ts",
    '''  TemplateDraftConflictError,
  TemplateDraftNotFoundError,
  TemplateDraftRegistry,''',
    '''  TemplateDraftConflictError,
  TemplateDraftFieldEditor,
  TemplateDraftNotFoundError,
  TemplateDraftRegistry,''',
)
insert_after(
    "apps/api/src/app.ts",
    'import { registerTemplateDraftRoutes } from "./template-draft-routes.js";\n',
    'import { registerTemplateDraftFieldEditRoutes } from "./template-draft-field-edit-routes.js";\n',
)
replace_once(
    "apps/api/src/app.ts",
    '''  templateDraftRegistry?: TemplateDraftRegistry;
  templateTestVersionRegistry?: TemplateTestVersionRegistry;''',
    '''  templateDraftRegistry?: TemplateDraftRegistry;
  templateDraftFieldEditor?: TemplateDraftFieldEditor;
  templateTestVersionRegistry?: TemplateTestVersionRegistry;''',
)
replace_once(
    "apps/api/src/app.ts",
    '''  const templateDraftRegistry =
    dependencies.templateDraftRegistry ?? new TemplateDraftRegistry(store);
  const templateTestVersionRegistry =''',
    '''  const templateDraftRegistry =
    dependencies.templateDraftRegistry ?? new TemplateDraftRegistry(store);
  const templateDraftFieldEditor =
    dependencies.templateDraftFieldEditor ?? new TemplateDraftFieldEditor(store);
  const templateTestVersionRegistry =''',
)
replace_once(
    "apps/api/src/app.ts",
    '''  registerTemplateDraftRoutes(
    app,
    quarantineRegistry,
    objectStore,
    templateDraftRegistry
  );
  registerTemplateTestVersionRoutes(''',
    '''  registerTemplateDraftRoutes(
    app,
    quarantineRegistry,
    objectStore,
    templateDraftRegistry
  );
  registerTemplateDraftFieldEditRoutes(app, templateDraftFieldEditor);
  registerTemplateTestVersionRoutes(''',
)

# ---------------------------------------------------------------------------
# UI bundles, direct syntax checks and language checks
# ---------------------------------------------------------------------------
replace_once(
    "apps/api/src/ui-routes.ts",
    '''      "template-repeat-assistant.css",
      "template-trial.css",''',
    '''      "template-repeat-assistant.css",
      "template-ux-recovery.css",
      "template-trial.css",''',
)
replace_once(
    "apps/api/src/ui-routes.ts",
    '''      "operator-workflows.css",
      "shared-document-results.css",''',
    '''      "operator-workflows.css",
      "group-management-v2.css",
      "shared-document-results.css",''',
)
replace_once(
    "apps/api/src/ui-routes.ts",
    '''      "operator-workflows-recovery.js",
      "help-center.js",''',
    '''      "operator-workflows-recovery.js",
      "group-management-v2.js",
      "help-center.js",''',
)
replace_once(
    "apps/api/src/ui-routes.ts",
    '''      "document-structure.js",
      "template-repeat-assistant.js",
      "template-trial.js",
      "template-multi-trial.js",''',
    '''      "document-structure.js",
      "template-placement-guidance.js",
      "template-repeat-assistant.js",
      "template-row-editor-v2.js",
      "template-trial.js",
      "template-multi-trial.js",
      "template-multi-trial-recovery.js",''',
)

replace_once(
    "scripts/ci/check-ui-bundles.mjs",
    '''    "operator-workflows-recovery.js",
    "help-center.js",''',
    '''    "operator-workflows-recovery.js",
    "group-management-v2.js",
    "help-center.js",''',
)
replace_once(
    "scripts/ci/check-ui-bundles.mjs",
    '''    "document-structure.js",
    "template-repeat-assistant.js",
    "template-trial.js",
    "template-multi-trial.js",''',
    '''    "document-structure.js",
    "template-placement-guidance.js",
    "template-repeat-assistant.js",
    "template-row-editor-v2.js",
    "template-trial.js",
    "template-multi-trial.js",
    "template-multi-trial-recovery.js",''',
)

package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
check_ui = package["scripts"]["check:ui"]
new_checks = [
    "node --check apps/api/ui/group-management-v2.js",
    "node --check apps/api/ui/template-placement-guidance.js",
    "node --check apps/api/ui/template-row-editor-v2.js",
    "node --check apps/api/ui/template-multi-trial-recovery.js",
]
marker = " && node scripts/ci/check-ui-bundles.mjs"
if marker not in check_ui:
    raise RuntimeError("package.json: check:ui bundle marker was not found")
for command in new_checks:
    if command not in check_ui:
        check_ui = check_ui.replace(marker, f" && {command}{marker}", 1)
package["scripts"]["check:ui"] = check_ui
package_path.write_text(
    json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print("updated package.json")

replace_once(
    "scripts/ci/check-user-facing-language.mjs",
    '''  "apps/api/ui/app.js",
  "apps/api/ui/document-intake.js",''',
    '''  "apps/api/ui/app.js",
  "apps/api/ui/group-management-v2.js",
  "apps/api/ui/document-intake.js",''',
)
replace_once(
    "scripts/ci/check-user-facing-language.mjs",
    '''  "apps/api/ui/document-structure.js",
  "apps/api/ui/template-trial.js",
  "apps/api/ui/template-multi-trial.js",''',
    '''  "apps/api/ui/document-structure.js",
  "apps/api/ui/template-placement-guidance.js",
  "apps/api/ui/template-row-editor-v2.js",
  "apps/api/ui/template-trial.js",
  "apps/api/ui/template-multi-trial.js",
  "apps/api/ui/template-multi-trial-recovery.js",''',
)

# ---------------------------------------------------------------------------
# Clear server-side message when the trial form is stale
# ---------------------------------------------------------------------------
replace_once(
    "apps/api/src/user-message.ts",
    '''  [/^Multi-field trial must provide exactly all draft fields;/i, () =>
    "Для общей проверки заполните все поля текущего черновика без посторонних идентификаторов."],''',
    '''  [/^Multi-field trial must provide exactly all draft fields;/i, () =>
    "Состав полей шаблона изменился после открытия формы. Обновите список полей, заполните новые тестовые примеры и повторите проверку."],''',
)
replace_once(
    "apps/api/src/multi-field-test-version-routes.ts",
    '''      if (missing.length > 0 || extra.length > 0) {
        throw new MultiFieldTestVersionValidationError(
          `Multi-field trial must provide exactly all draft fields; missing=${missing
            .map((field) => field.key)
            .join(",")}; extra=${extra.join(",")}`
        );
      }
''',
    '''      if (missing.length > 0 || extra.length > 0) {
        const missingLabels = missing
          .map((field) => `«${field.label}»`)
          .join(", ");
        throw new MultiFieldTestVersionValidationError(
          `Состав полей черновика изменился после открытия формы. Не переданы: ${missingLabels || "нет"}; лишних значений: ${extra.length}. Обновите форму и повторите проверку.`
        );
      }
''',
)

# ---------------------------------------------------------------------------
# Harden the row editor: one card per cell, safe suggestions, format retention,
# deletion/re-creation of repeat binding, and correct wizard transition.
# ---------------------------------------------------------------------------
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''  function rowEditorElements(element) {
    if (!element?.tableLocation || !Array.isArray(structureReport?.elements)) return [];
    return structureReport.elements
      .filter((candidate) => rowEditorSameRow(candidate, element))
      .sort(
        (left, right) =>
          left.tableLocation.columnIndex - right.tableLocation.columnIndex
      );
  }
''',
    '''  function rowEditorElements(element) {
    if (!element?.tableLocation || !Array.isArray(structureReport?.elements)) return [];
    const byColumn = new Map();
    for (const candidate of structureReport.elements) {
      if (!rowEditorSameRow(candidate, element)) continue;
      const column = candidate.tableLocation.columnIndex;
      const previous = byColumn.get(column);
      const candidateLinked = Boolean(rowEditorExistingField(candidate));
      const previousLinked = Boolean(previous && rowEditorExistingField(previous));
      if (
        !previous ||
        (candidateLinked && !previousLinked) ||
        (!previousLinked && !previous.text && candidate.text)
      ) {
        byColumn.set(column, candidate);
      }
    }
    return [...byColumn.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, candidate]) => candidate);
  }
''',
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''    return best?.score >= 0.82 ? `existing:${best.definition.key}` : "skip";
  }
''',
    '''    if (best?.score >= 0.82) return `existing:${best.definition.key}`;
    return semantic === "unknown" ? "skip" : "new";
  }
''',
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''    if (mode !== "new") return null;
    const label = card.querySelector("[data-row-editor-label]")?.value?.trim() || "";
    const valueType = card.querySelector("[data-row-editor-type]")?.value || "string";
    if (!label) throw new Error("Укажите название нового поля для выбранной колонки.");
    const created = await structureFetchJson("/api/v1/knowledge/property-definitions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label,
        valueType,
        sensitivity: "personal",
        appliesTo: ["person"]
      })
    });
    const definition = created.data;
    if (!structurePropertyDefinitions.some((candidate) => candidate.key === definition.key)) {
      structurePropertyDefinitions.push(definition);
    }
    return definition;
  }
''',
    '''    if (mode !== "new") return null;
    const label = card.querySelector("[data-row-editor-label]")?.value?.trim() || "";
    const valueType = card.querySelector("[data-row-editor-type]")?.value || "string";
    if (!label) throw new Error("Укажите название нового поля для выбранной колонки.");
    const matches = structurePropertyDefinitions.filter(
      (candidate) =>
        rowEditorNormalize(candidate.label) === rowEditorNormalize(label)
    );
    if (matches.length > 1) {
      throw new Error(
        `Найдено несколько полей «${label}». Выберите существующее поле из списка.`
      );
    }
    if (matches[0]) {
      if (matches[0].valueType !== valueType) {
        throw new Error(
          `Поле «${label}» уже существует с другим типом значения.`
        );
      }
      return matches[0];
    }
    const created = await structureFetchJson("/api/v1/knowledge/property-definitions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label,
        valueType,
        sensitivity: "personal",
        appliesTo: ["person"]
      })
    });
    const definition = created.data;
    if (!structurePropertyDefinitions.some((candidate) => candidate.key === definition.key)) {
      structurePropertyDefinitions.push(definition);
    }
    return definition;
  }

  function rowEditorExistingFormat(existing, definition) {
    if (!existing || existing.key !== definition.key || existing.valueType !== definition.valueType) {
      return {};
    }
    if (
      definition.valueType === "number" &&
      existing.formatter?.kind === "number.ru" &&
      existing.formatter.fractionDigits !== null &&
      existing.formatter.fractionDigits !== undefined
    ) {
      return { decimalPlaces: existing.formatter.fractionDigits };
    }
    if (
      definition.valueType === "date-time" &&
      existing.formatter?.kind === "date-time.ru" &&
      existing.formatter.timeZone
    ) {
      return { timeZone: existing.formatter.timeZone };
    }
    return {};
  }
''',
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''        if (mode === "skip") {
          if (existing) {
            await structureFetchJson(
              `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draft.id)}/fields/${encodeURIComponent(existing.id)}`,
              { method: "DELETE" }
            );
            deletedCount += 1;
            latest.fields = latest.fields.filter((field) => field.id !== existing.id);
          }
          continue;
        }
        const definition = await rowEditorDefinition(card, element, existing);
        if (!definition) continue;
        const payload = {
          key: definition.key,
          label: definition.label,
          valueType: definition.valueType,
          required: Boolean(card.querySelector("[data-row-editor-required]")?.checked),
          ...(rowEditorPersonName(card) === undefined
            ? {}
            : { personName: rowEditorPersonName(card) })
        };
''',
    '''        if (mode === "skip") {
          if (existing) {
            const deleted = await structureFetchJson(
              `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draft.id)}/fields/${encodeURIComponent(existing.id)}`,
              { method: "DELETE" }
            );
            deletedCount += 1;
            latest.fields = latest.fields.filter((field) => field.id !== existing.id);
            if (deleted.data.repeatBindingCleared) repeatExists = false;
          }
          continue;
        }
        const definition = await rowEditorDefinition(card, element, existing);
        if (!definition) continue;
        const personName = rowEditorPersonName(card);
        const payload = {
          key: definition.key,
          label: definition.label,
          valueType: definition.valueType,
          required: Boolean(card.querySelector("[data-row-editor-required]")?.checked),
          ...rowEditorExistingFormat(existing, definition),
          ...(personName === undefined ? {} : { personName })
        };
''',
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''      panel.querySelector("#rowEditorContinueTrial")?.addEventListener("click", () =>
        globalThis.docomatorTemplateWizard?.go(3)
      );''',
    '''      panel.querySelector("#rowEditorContinueTrial")?.addEventListener("click", () =>
        globalThis.docomatorTemplateWizard?.complete(2, {
          sourceId: latest.sourceRecordId || structureWizardArtifacts().sourceId,
          draftId: draft.id
        })
      );''',
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''  function rowEditorOpen(element) {
    document.querySelector("#rosterAssistantPanel")?.remove();
    document.querySelector("#rowEditorPanel")?.remove();
    const rows = rowEditorElements(element);''',
    '''  function rowEditorRestoreSingleFieldForm() {
    const form = document.querySelector("#documentFieldForm");
    const entry = document.querySelector("#rowEditorEntry");
    if (form) form.hidden = false;
    if (entry) entry.hidden = false;
  }

  function rowEditorClosePanel() {
    document.querySelector("#rowEditorPanel")?.remove();
    rowEditorRestoreSingleFieldForm();
  }

  function rowEditorOpen(element) {
    document.querySelector("#rosterAssistantPanel")?.remove();
    document.querySelector("#rowEditorPanel")?.remove();
    const rows = rowEditorElements(element);''',
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''    detail.prepend(panel);
    panel.querySelector("#rowEditorClose")?.addEventListener("click", () => panel.remove());
    panel.querySelector("#rowEditorCancel")?.addEventListener("click", () => panel.remove());''',
    '''    detail.prepend(panel);
    const singleFieldForm = detail.querySelector("#documentFieldForm");
    const entry = detail.querySelector("#rowEditorEntry");
    if (singleFieldForm) singleFieldForm.hidden = true;
    if (entry) entry.hidden = true;
    panel.querySelector("#rowEditorClose")?.addEventListener("click", rowEditorClosePanel);
    panel.querySelector("#rowEditorCancel")?.addEventListener("click", rowEditorClosePanel);''',
)

# ---------------------------------------------------------------------------
# Make multi-field recovery draft-specific and detect edits, not only additions.
# ---------------------------------------------------------------------------
replace_once(
    "apps/api/ui/template-multi-trial-recovery.js",
    '''  const multiTrialRecoveredValues = new Map();
  let multiTrialKnownFieldIds = new Set();''',
    '''  const multiTrialRecoveredValues = new Map();
  const multiTrialKnownFieldIdsByDraft = new Map();''',
)
replace_once(
    "apps/api/ui/template-multi-trial-recovery.js",
    '''    const currentIds = new Set(draft.fields.map((field) => field.id));
    const newIds = new Set(
      [...currentIds].filter((fieldId) => !multiTrialKnownFieldIds.has(fieldId))
    );
    if (multiTrialKnownFieldIds.size === 0) newIds.clear();
    multiTrialKnownFieldIds = currentIds;''',
    '''    const currentIds = new Set(draft.fields.map((field) => field.id));
    const knownIds = multiTrialKnownFieldIdsByDraft.get(draft.id) || new Set();
    const newIds = new Set(
      [...currentIds].filter((fieldId) => !knownIds.has(fieldId))
    );
    if (knownIds.size === 0) newIds.clear();
    multiTrialKnownFieldIdsByDraft.set(draft.id, currentIds);''',
)
replace_once(
    "apps/api/ui/template-multi-trial-recovery.js",
    '''  function multiTrialSameFields(left, right) {
    const leftIds = (left?.fields || []).map((field) => field.id).sort();
    const rightIds = (right?.fields || []).map((field) => field.id).sort();
    return (
      leftIds.length === rightIds.length &&
      leftIds.every((fieldId, index) => fieldId === rightIds[index])
    );
  }
''',
    '''  function multiTrialFieldSignature(field) {
    return JSON.stringify({
      id: field.id,
      version: field.version || 1,
      key: field.key,
      label: field.label,
      valueType: field.valueType,
      required: Boolean(field.required),
      formatter: field.formatter || null
    });
  }

  function multiTrialSameFields(left, right) {
    const leftFields = (left?.fields || [])
      .map(multiTrialFieldSignature)
      .sort();
    const rightFields = (right?.fields || [])
      .map(multiTrialFieldSignature)
      .sort();
    return (
      leftFields.length === rightFields.length &&
      leftFields.every((signature, index) => signature === rightFields[index])
    );
  }
''',
)

# ---------------------------------------------------------------------------
# Browser mock: groups, field editing/deletion, exact multi-field trial and a
# four-column student table including a generated row number.
# ---------------------------------------------------------------------------
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''    drafts: [],
    trialVersions: [],
    previewRequest: null,''',
    '''    drafts: [],
    trialVersions: [],
    multiTrialVersions: [],
    groups: [],
    previewRequest: null,''',
)
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''    draftRequests: [],
    fieldRequests: [],
    inspectedFileName:''',
    '''    draftRequests: [],
    fieldRequests: [],
    fieldUpdateRequests: [],
    fieldDeleteRequests: [],
    multiTrialBodies: [],
    groupMemberRequests: [],
    inspectedFileName:''',
)
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''    const labels = ["ФИО студента", "Тема научной работы", "Научный руководитель"];''',
    '''    const labels = ["№", "ФИО студента", "Тема научной работы", "Научный руководитель"];''',
)
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''async function jsonBody(request) {
  try {
    return await request.postDataJSON();
  } catch {
    return {};
  }
}
''',
    '''async function jsonBody(request) {
  try {
    return await request.postDataJSON();
  } catch {
    return {};
  }
}

function fieldFormatter(payload) {
  if (payload.personName) {
    return {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: payload.personName.sourceOrder,
      pattern: payload.personName.pattern
    };
  }
  if (payload.valueType === "number") {
    return {
      version: 1,
      kind: "number.ru",
      fractionDigits:
        payload.decimalPlaces === undefined ? null : payload.decimalPlaces
    };
  }
  if (payload.valueType === "integer") {
    return { version: 1, kind: "number.ru", fractionDigits: 0 };
  }
  if (payload.valueType === "date") return { version: 1, kind: "date.ru" };
  if (payload.valueType === "date-time") {
    return {
      version: 1,
      kind: "date-time.ru",
      timeZone: payload.timeZone || "Europe/Moscow"
    };
  }
  if (payload.valueType === "boolean") {
    return { version: 1, kind: "boolean.ru" };
  }
  return { version: 1, kind: "identity" };
}
''',
)
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''        valueType: payload.valueType || "string",
        sensitivity: payload.sensitivity || "personal",
        appliesTo: payload.appliesTo || ["person"]
      };''',
    '''        valueType: payload.valueType || "string",
        sensitivity: payload.sensitivity || "personal",
        appliesTo: payload.appliesTo || ["person"],
        aliases: payload.aliases || [],
        validation: payload.validation || {},
        description: payload.description || null,
        unit: payload.unit || null
      };''',
)
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''          groupCount: 0
        },''',
    '''          groupCount: state.primary.groups.filter((group) => group.status === "active").length
        },''',
)
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''                 groupCount: 0
               }''',
    '''                 groupCount: state.secondary.groups.filter((group) => group.status === "active").length
               }''',
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
      const repeatBindingCleared = previousCount > 0 && remainingFieldCount === 0 && Boolean(draft?.repeatBinding);
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

# ---------------------------------------------------------------------------
# Replace the old one-way row test with save -> reopen -> edit -> save.
# ---------------------------------------------------------------------------
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
    panel.locator('[data-row-editor-column]').nth(0).locator("[data-row-editor-mode]")
  ).toHaveValue("system:position");
  await expect(
    panel.locator('[data-row-editor-column]').nth(1).locator("[data-row-editor-mode]")
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
  await expect(panel).toContainText("Строка уже настроена").catch(() => {});
  const nameCard = panel.locator("[data-row-editor-column]").nth(1);
  await nameCard.locator("[data-row-name-presentation]").selectOption("family-initials");
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

# ---------------------------------------------------------------------------
# Operator documentation for the exact confusing flows and large groups.
# ---------------------------------------------------------------------------
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

print("template row, trial and large-group UX integration applied")
