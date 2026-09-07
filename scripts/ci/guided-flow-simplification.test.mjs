import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("automatic helpers are bundled after their base handlers", async () => {
  const routes = await read("apps/api/src/ui-routes.ts");
  const bulkImport = routes.indexOf('"bulk-data-import.js"');
  const bulkController = routes.indexOf('"bulk-data-import-controller.js"');
  const rowFlow = routes.indexOf('"template-row-flow.js"');
  const guided = routes.indexOf('"guided-flow-simplification.js"');
  assert.ok(bulkImport >= 0, "bulk import base handler must remain in the UI bundle");
  assert.ok(
    bulkController > bulkImport,
    "bulk import controller must run after the base import implementation"
  );
  assert.ok(rowFlow >= 0, "template row flow must remain in the UI bundle");
  assert.ok(guided > rowFlow, "guided simplification must run after existing UI handlers");
});

test("automatic helper names only read-only preparation controls", async () => {
  const source = await read("apps/api/ui/guided-flow-simplification.js");
  for (const selector of ["#documentIntakeButton", "#documentStructureButton"]) {
    assert.ok(source.includes(selector), `missing safe control ${selector}`);
  }
  assert.equal(
    source.includes("#bulkImportPreviewButton"),
    false,
    "bulk import automatic start must belong to its own controller"
  );
  assert.equal(
    /function\s+guidedFlowInstallBulkImport\s*\(/u.test(source),
    false,
    "guided helper must not own bulk import automatic start"
  );
  for (const mutationSelector of [
    "#documentQuarantineButton",
    "#bulkImportExecute",
    "#documentFieldSave",
    "#templateActivateDirect",
    "#generationSubmit",
    "#generationStartPrepared"
  ]) {
    assert.equal(
      source.includes(mutationSelector),
      false,
      `automatic helper must not trigger mutation control ${mutationSelector}`
    );
  }
});

test("bulk import starts directly from its controller without delayed synthetic clicks", async () => {
  const source = await read("apps/api/ui/bulk-data-import-controller.js");
  assert.ok(source.includes("previewBulkImportFile"));
  assert.ok(source.includes("previewBulkImportBytes"));
  assert.ok(source.includes('addEventListener("change"'));
  assert.ok(source.includes('addEventListener("drop"'));
  assert.doesNotMatch(source, /setTimeout\s*\(/u);
  assert.doesNotMatch(source, /\.click\s*\(/u);
  assert.doesNotMatch(source, /MutationObserver/u);
});

test("repeat preflight refresh cannot start generation as a hidden side effect", async () => {
  const source = await read("apps/api/ui/document-generation-preflight.js");
  const start = source.indexOf("async function refreshPreparedGenerationPreflight()");
  const end = source.indexOf("async function startPreparedGeneration()", start);
  assert.ok(start >= 0 && end > start, "preflight refresh function must be present");
  const refresh = source.slice(start, end);
  assert.equal(refresh.includes("startPreparedGeneration("), false);
  assert.ok(refresh.includes("Все обязательные данные заполнены"));
});
