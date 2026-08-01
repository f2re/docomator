import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectCanonicalUiFindings } from "./check-canonical-ui.mjs";

async function write(root, relativePath, content = "") {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-canonical-ui-"));
  await fs.mkdir(path.join(root, "apps/api/ui"), { recursive: true });
  const references = [
    "package.json",
    "apps/api/src/ui-routes.ts",
    "scripts/ci/check-ui-bundles.mjs",
    "scripts/ci/check-user-facing-language.mjs",
    "scripts/offline/verify-bundle.sh",
    "scripts/offline/pilot-runtime-bundle.test.mjs",
    "scripts/offline/verify-bundle.test.mjs",
    "tests/e2e/assisted-import.spec.mjs"
  ];
  for (const relativePath of references) await write(root, relativePath, "canonical\n");
  await write(
    root,
    "apps/api/src/ui-routes.ts",
    '["bulk-data-import.js", "document-schedules.js", "template-row-editor.js", "template-workflow.css"]\n'
  );
  await write(root, "apps/api/ui/bulk-data-import.js", "caseInsensitive personName split: sourceRowNumber bulkImportPastePreview mappingResolutions\n");
  await write(root, "apps/api/ui/document-schedules.js", "document-schedule-network-settings network_folder scheduleWorkspaceOpenForm loadScheduleWorkspace\n");
  await write(root, "apps/api/ui/operator-workflows.js", "groupMemberPageSize operatorGroupSelectFound\n");
  await write(root, "apps/api/ui/template-multi-trial.js", "multiTrialDraftValues multiTrialSameFields templateMultiTrialFillExamples docomator:template-draft-changed\n");
  await write(root, "apps/api/ui/document-structure.js", "rowEditorInstallEntry(element);\n");
  await write(root, "apps/api/ui/template-row-editor.js", "function rowEditorInstallEntry() {}\n");
  await write(root, "apps/api/ui/template-workflow.css", ".row-editor-panel {}\n");
  return root;
}

test("каноническое дерево проходит", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.deepEqual(await collectCanonicalUiFindings(root), []);
});

test("находит возвращённый versioned-модуль", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await write(root, "apps/api/ui/bulk-data-import-v2.js", "legacy\n");
  const findings = await collectCanonicalUiFindings(root);
  assert.ok(findings.some((finding) => finding.includes("устаревшее поколение")));
  assert.ok(findings.some((finding) => finding.includes("версии и recovery-слои запрещены")));
});

test("продуктивная проверка не находит прежние поколения", async () => {
  assert.deepEqual(await collectCanonicalUiFindings(), []);
});
