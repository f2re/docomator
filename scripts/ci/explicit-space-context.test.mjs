import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function assertDoesNotContain(relativePath, pattern, message) {
  const source = read(relativePath);
  assert.doesNotMatch(source, pattern, `${relativePath}: ${message}`);
}

function assertContains(relativePath, pattern, message) {
  const source = read(relativePath);
  assert.match(source, pattern, `${relativePath}: ${message}`);
}

test("runtime knowledge routes have no implicit default-space bypass", () => {
  const routes = read("apps/api/src/knowledge-routes.ts");
  assert.doesNotMatch(routes, /DEFAULT_SPACE_ID/u);
  assert.doesNotMatch(routes, /\/api\/v1\/knowledge\/entities/u);
  assert.match(routes, /requiredPropertyScopeQuerySchema/u);
  assert.match(routes, /SpaceScopedKnowledgeRegistry/u);
});

test("space correctness does not depend on global fetch monkey-patches", () => {
  for (const relativePath of [
    "apps/api/ui/space-property-scope.js",
    "apps/api/ui/field-groups-ui.js"
  ]) {
    assertDoesNotContain(
      relativePath,
      /(?:globalThis|window)\.fetch\s*=|installSpaceScopedPropertyRequests|installEntityImportResponseCapture/u,
      "space correctness must not intercept global fetch"
    );
  }
});

test("core UI owns an explicit current-space property catalog with stale-response protection", () => {
  assertContains(
    "apps/api/ui/app.js",
    /function propertyDefinitionsEndpoint\(/u,
    "must build property-definition URLs from explicit current space"
  );
  assertContains(
    "apps/api/ui/app.js",
    /propertyLoadVersion/u,
    "must reject stale property catalog responses"
  );
  assertContains(
    "apps/api/ui/app.js",
    /loadCurrentSpaceProperties/u,
    "must load properties only after resolving current space"
  );
});

test("feature modules use explicit current-space property URLs", () => {
  const required = new Map([
    ["apps/api/ui/bulk-data-import.js", /docomatorPropertyDefinitionsUrl/u],
    ["apps/api/ui/document-data-correction.js", /docomatorPropertyDefinitionsUrl/u],
    ["apps/api/ui/document-structure.js", /docomatorPropertyDefinitionsUrl/u],
    ["apps/api/ui/entity-workspace.js", /docomatorPropertyDefinitionsUrl/u],
    ["apps/api/ui/generic-template-entities.js", /docomatorPropertyDefinitionsUrl/u],
    ["apps/api/ui/operator-workflows.js", /propertyDefinitionsEndpoint/u],
    ["apps/api/ui/publication-workspace.js", /docomatorPropertyDefinitionsUrl/u],
    ["apps/api/ui/template-repeat-assistant.js", /docomatorPropertyDefinitionsUrl/u],
    ["apps/api/ui/template-row-editor.js", /docomatorPropertyDefinitionsUrl/u]
  ]);
  for (const [relativePath, pattern] of required) {
    assertContains(relativePath, pattern, "must use explicit property-definition scope");
  }

  for (const relativePath of [
    "apps/api/ui/entity-workspace.js",
    "apps/api/ui/document-data-correction.js"
  ]) {
    assertDoesNotContain(
      relativePath,
      /\/api\/v1\/knowledge\/entities\//u,
      "entity property values/history must use /spaces/:spaceId/entities"
    );
  }
});

test("space-local browser preferences never fall back to an implicit default scope", () => {
  const guardedFiles = [
    "apps/api/ui/document-schedules.js",
    "apps/api/ui/generic-document-generation.js",
    "apps/api/ui/generic-template-entities.js",
    "apps/api/ui/space-isolation-ui.js"
  ];
  for (const relativePath of guardedFiles) {
    assertDoesNotContain(
      relativePath,
      /(?:space|template|generation|schedule|mapping)[^\n]{0,120}\|\|\s*["']default["']/iu,
      "space-local storage keys must not silently use default"
    );
  }
});

test("transitional explicit-space adapter files are absent", () => {
  for (const relativePath of [
    "apps/api/ui/explicit-space-context.js",
    "apps/api/ui/explicit-document-space-context.js"
  ]) {
    assert.equal(
      fs.existsSync(path.join(repositoryRoot, relativePath)),
      false,
      `${relativePath} must not return as a runtime compatibility layer`
    );
  }
});
