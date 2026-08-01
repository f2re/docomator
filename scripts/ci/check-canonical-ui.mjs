#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(modulePath), "../..");

const obsoleteFiles = [
  "apps/api/ui/bulk-data-import-v2.js",
  "apps/api/ui/bulk-data-import-v3.js",
  "apps/api/ui/bulk-data-import-v2.css",
  "apps/api/ui/bulk-data-import-v3.css",
  "apps/api/ui/document-schedules-v2.js",
  "apps/api/ui/document-schedules-v2.css",
  "apps/api/ui/document-schedule-network.js",
  "apps/api/ui/group-management-v2.js",
  "apps/api/ui/group-management-v2.css",
  "apps/api/ui/operator-workflows-recovery.js",
  "apps/api/ui/template-multi-trial-recovery.js",
  "apps/api/ui/template-row-editor-v2.js",
  "apps/api/ui/template-ux-recovery.css"
];

const obsoleteNames = obsoleteFiles.map((value) => path.basename(value));
const referenceFiles = [
  "package.json",
  "apps/api/src/ui-routes.ts",
  "scripts/ci/check-ui-bundles.mjs",
  "scripts/ci/check-user-facing-language.mjs",
  "scripts/offline/verify-bundle.sh",
  "scripts/offline/pilot-runtime-bundle.test.mjs",
  "scripts/offline/verify-bundle.test.mjs",
  "tests/e2e/assisted-import.spec.mjs"
];

async function exists(root, relativePath) {
  try {
    await fs.access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function requiredText(root, relativePath, findings) {
  try {
    return await fs.readFile(path.join(root, relativePath), "utf8");
  } catch (error) {
    findings.push(`${relativePath}: обязательный канонический файл недоступен: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

function count(text, fragment) {
  return text.split(fragment).length - 1;
}

export async function collectCanonicalUiFindings(rootDirectory = repositoryRoot) {
  const root = path.resolve(rootDirectory);
  const findings = [];

  for (const relativePath of obsoleteFiles) {
    if (await exists(root, relativePath)) {
      findings.push(`${relativePath}: устаревшее поколение интерфейса не удалено`);
    }
  }

  const uiEntries = await fs.readdir(path.join(root, "apps/api/ui"));
  for (const fileName of uiEntries) {
    if (/(?:-v\d+|-recovery)\.(?:js|css)$/u.test(fileName)) {
      findings.push(`apps/api/ui/${fileName}: версии и recovery-слои запрещены; изменяйте канонический модуль`);
    }
  }

  for (const relativePath of referenceFiles) {
    const text = await requiredText(root, relativePath, findings);
    for (const obsoleteName of obsoleteNames) {
      if (text.includes(obsoleteName)) {
        findings.push(`${relativePath}: осталось упоминание удалённого файла ${obsoleteName}`);
      }
    }
  }

  const routes = await requiredText(root, "apps/api/src/ui-routes.ts", findings);
  for (const canonical of [
    "bulk-data-import.js",
    "document-schedules.js",
    "template-row-editor.js",
    "template-workflow.css"
  ]) {
    if (count(routes, `\"${canonical}\"`) !== 1) {
      findings.push(`apps/api/src/ui-routes.ts: ${canonical} должен входить в поставку ровно один раз`);
    }
  }
  for (const fragment of ["isolateUiExtension", "ScheduleV2Bridge", "scheduleV2FileName"]) {
    if (routes.includes(fragment)) {
      findings.push(`apps/api/src/ui-routes.ts: остался мост подмены ${fragment}`);
    }
  }

  const importModule = await requiredText(root, "apps/api/ui/bulk-data-import.js", findings);
  for (const fragment of [
    "caseInsensitive",
    "personName",
    "split:",
    "sourceRowNumber",
    "bulkImportPastePreview",
    "mappingResolutions"
  ]) {
    if (!importModule.includes(fragment)) {
      findings.push(`apps/api/ui/bulk-data-import.js: потеряна актуальная возможность ${fragment}`);
    }
  }
  if (/\bbulkV[23]\b|bulk-v[23]|data-bulk-v[23]/u.test(importModule)) {
    findings.push("apps/api/ui/bulk-data-import.js: остались имена прежних поколений импорта");
  }

  const scheduleModule = await requiredText(root, "apps/api/ui/document-schedules.js", findings);
  for (const fragment of [
    "document-schedule-network-settings",
    "network_folder",
    "scheduleWorkspaceOpenForm",
    "loadScheduleWorkspace"
  ]) {
    if (!scheduleModule.includes(fragment)) {
      findings.push(`apps/api/ui/document-schedules.js: потеряна актуальная возможность ${fragment}`);
    }
  }
  if (/\bscheduleV2\b|schedule-v2/u.test(scheduleModule)) {
    findings.push("apps/api/ui/document-schedules.js: остались имена прежнего поколения расписаний");
  }

  const operatorModule = await requiredText(root, "apps/api/ui/operator-workflows.js", findings);
  if (!operatorModule.includes("groupMemberPageSize") || !operatorModule.includes("operatorGroupSelectFound")) {
    findings.push("apps/api/ui/operator-workflows.js: не сохранено актуальное управление большими группами");
  }
  if (/\bgroupV2\b|operator-group-dialog-v2/u.test(operatorModule)) {
    findings.push("apps/api/ui/operator-workflows.js: остались имена прежнего поколения групп");
  }

  const multiTrial = await requiredText(root, "apps/api/ui/template-multi-trial.js", findings);
  for (const fragment of [
    "multiTrialDraftValues",
    "multiTrialSameFields",
    "templateMultiTrialFillExamples",
    "docomator:template-draft-changed"
  ]) {
    if (!multiTrial.includes(fragment)) {
      findings.push(`apps/api/ui/template-multi-trial.js: потеряна актуальная возможность ${fragment}`);
    }
  }
  if (/Recovered|Recovery/u.test(multiTrial)) {
    findings.push("apps/api/ui/template-multi-trial.js: остались recovery-имена");
  }

  const structure = await requiredText(root, "apps/api/ui/document-structure.js", findings);
  const rowEditor = await requiredText(root, "apps/api/ui/template-row-editor.js", findings);
  if (!structure.includes("rowEditorInstallEntry(element);")) {
    findings.push("apps/api/ui/document-structure.js: редактор строки не подключён напрямую");
  }
  if (/renderStructureSelection\s*=|rowEditorBaseRenderSelection/u.test(rowEditor)) {
    findings.push("apps/api/ui/template-row-editor.js: редактор строки всё ещё подменяет базовую функцию");
  }

  return [...new Set(findings)];
}

export async function checkCanonicalUi() {
  const findings = await collectCanonicalUiFindings();
  if (findings.length > 0) {
    throw new Error(`Проверка единственной актуальной версии UI не пройдена:\n- ${findings.join("\n- ")}`);
  }
  process.stdout.write("В поставке остались только канонические актуальные UI-модули.\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  checkCanonicalUi().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
