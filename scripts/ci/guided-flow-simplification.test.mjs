import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("automatic flow helper is bundled after base handlers", async () => {
  const routes = await read("apps/api/src/ui-routes.ts");
  const rowFlow = routes.indexOf('"template-row-flow.js"');
  const guided = routes.indexOf('"guided-flow-simplification.js"');
  assert.ok(rowFlow >= 0, "template row flow must remain in the UI bundle");
  assert.ok(guided > rowFlow, "guided simplification must run after existing UI handlers");
});

test("automatic helper names only read-only preparation controls", async () => {
  const source = await read("apps/api/ui/guided-flow-simplification.js");
  for (const selector of [
    "#documentIntakeButton",
    "#bulkImportPreviewButton",
    "#documentStructureButton"
  ]) {
    assert.ok(source.includes(selector), `missing safe control ${selector}`);
  }
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

test("repeat preflight refresh cannot start generation as a hidden side effect", async () => {
  const source = await read("apps/api/ui/document-generation-preflight.js");
  const start = source.indexOf("async function refreshPreparedGenerationPreflight()");
  const end = source.indexOf("async function startPreparedGeneration()", start);
  assert.ok(start >= 0 && end > start, "preflight refresh function must be present");
  const refresh = source.slice(start, end);
  assert.equal(refresh.includes("startPreparedGeneration("), false);
  assert.ok(refresh.includes("Все обязательные данные заполнены"));
});
