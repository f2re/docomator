import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const uiDirectory = path.join(projectRoot, "apps/api/ui");
const bundles = {
  "app.js": [
    "space-property-scope.js",
    "app.js",
    "space-isolation-app.js",
    "operator-workflows.js",
    "workspace-switcher.js",
    "help-center.js",
    "help-project-documents.js",
    "interface-hierarchy.js",
    "database-admin.js",
    "navigation-contract.js",
    "publication-workspace.js"
  ],
  "document-intake.js": [
    "document-intake.js",
    "document-structure.js",
    "template-visual-editor.js",
    "template-placement-guidance.js",
    "template-repeat-assistant.js",
    "template-row-editor.js",
    "template-trial.js",
    "template-multi-trial.js",
    "template-activation.js",
    "document-generation.js",
    "document-generation-preflight.js",
    "document-data-correction.js",
    "document-generation-retry.js",
    "document-delivery.js",
    "document-email-delivery.js",
    "email-recipients.js",
    "document-schedules.js",
    "shared-document-results.js",
    "shared-document-view-labels.js",
    "shared-corporate-mode.js",
    "storage-maintenance.js",
    "bulk-data-import.js",
    "space-isolation-ui.js",
    "operation-center.js",
    "operations-readiness.js",
    "template-row-flow.js",
    "guided-flow-simplification.js"
  ]
};

function navigationTargets(html, className) {
  const marker = `<nav class="${className}"`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `Не найдена навигация ${className}.`);
  const end = html.indexOf("</nav>", start);
  assert.notEqual(end, -1, `Не найден конец навигации ${className}.`);
  const fragment = html.slice(start, end);
  return [...fragment.matchAll(/data-view-target="([^"]+)"/gu)].map((match) => match[1]);
}

const indexHtml = await fs.readFile(path.join(uiDirectory, "index.html"), "utf8");
assert.deepEqual(
  navigationTargets(indexHtml, "nav-list"),
  ["overview", "employees", "templates", "generation", "documents", "automations", "settings"],
  "Первичная desktop-навигация должна быть канонической уже в исходном HTML."
);
assert.deepEqual(
  navigationTargets(indexHtml, "mobile-nav"),
  ["overview", "employees", "generation", "documents", "settings"],
  "Первичная mobile-навигация должна быть канонической уже в исходном HTML."
);
assert.match(indexHtml, /data-view-target="settings"[^>]*>[\s\S]*?<span>Управление<\/span>/u);
for (const id of [
  "mobileHelpButton",
  "workflowStageChip",
  "currentSpaceChip",
  "workspaceSwitcherMenu",
  "systemStatusControl",
  "managementCurrentSpace",
  "managementSystemStatus",
  "managementReadinessMount"
]) {
  assert.match(indexHtml, new RegExp(`id=["']${id}["']`, "u"), `${id} должен существовать в исходном HTML.`);
}
for (const step of ["data", "template", "generation", "results"]) {
  assert.match(indexHtml, new RegExp(`data-workflow-step=["']${step}["']`, "u"), `Шаг ${step} должен существовать до запуска JS.`);
}
assert.match(indexHtml, /class="[^"]*management-view[^"]*"/u, "Экран «Управление» должен иметь канонический класс.");
assert.match(indexHtml, /data-view="settings"/u, "Экран «Управление» должен существовать в исходном HTML.");
assert.match(indexHtml, /data-interface-ready="true"/u, "Экран «Управление» не должен достраиваться после загрузки.");

const navigationScriptPosition = indexHtml.indexOf('src="/ui/navigation-contract.js"');
const applicationScriptPosition = indexHtml.indexOf('src="/ui/app.js"');
assert.ok(navigationScriptPosition >= 0);
assert.ok(applicationScriptPosition >= 0 && navigationScriptPosition < applicationScriptPosition);

const navigationContract = await fs.readFile(path.join(uiDirectory, "navigation-contract.js"), "utf8");
for (const [label, pattern] of [
  ["MutationObserver", /MutationObserver/u],
  ["DOM query", /document\.querySelector/u],
  ["DOM creation", /document\.createElement/u],
  ["DOM removal", /\.remove\(/u],
  ["DOM insertion", /insertBefore\(|\.append\(/u]
]) {
  assert.doesNotMatch(navigationContract, pattern, `navigation-contract.js не должен выполнять ${label}.`);
}

const hierarchy = await fs.readFile(path.join(uiDirectory, "interface-hierarchy.js"), "utf8");
for (const legacyComposer of [
  "interfaceEnsureTopbarControls",
  "interfaceEnsureWorkflow",
  "interfaceEnsureManagement",
  "interfaceMoveReadiness",
  "interfaceRenameNavigation",
  "interfaceSyncDuplicateIntros"
]) {
  assert.doesNotMatch(hierarchy, new RegExp(legacyComposer, "u"), `${legacyComposer} не должен возвращаться как post-hoc DOM patch.`);
}
assert.doesNotMatch(
  hierarchy,
  /setTimeout\s*\(/u,
  "Shell/Home/Management controller не должен использовать таймеры для достижения финальной разметки."
);

const fieldGroupsUi = await fs.readFile(path.join(uiDirectory, "field-groups-ui.js"), "utf8");
assert.doesNotMatch(fieldGroupsUi, /navigation-contract/u);

const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-ui-check-"));
try {
  for (const [bundleName, fileNames] of Object.entries(bundles)) {
    const parts = await Promise.all(fileNames.map((fileName) => fs.readFile(path.join(uiDirectory, fileName))));
    const bundlePath = path.join(temporaryDirectory, bundleName);
    await fs.writeFile(bundlePath, Buffer.concat(parts.flatMap((part, index) => index === 0 ? [part] : [Buffer.from("\n\n"), part])));
    const result = spawnSync(process.execPath, ["--check", bundlePath], { encoding: "utf8" });
    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout);
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}

if (process.exitCode === undefined) {
  process.stdout.write("Пользовательские UI-бандлы и канонический shell прошли проверку.\n");
}
