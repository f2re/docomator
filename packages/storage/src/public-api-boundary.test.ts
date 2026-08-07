import assert from "node:assert/strict";
import test from "node:test";

import * as storage from "./index.js";

const forbiddenRuntimeExports = [
  "KnowledgeRegistry",
  "EmployeeRegistry",
  "PublicationRegistry"
] as const;

test("public storage API does not expose raw mutable registries", () => {
  for (const name of forbiddenRuntimeExports) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(storage, name),
      false,
      `${name} must remain available only through @docomator/storage/internal`
    );
  }
  assert.equal(typeof storage.SpaceScopedKnowledgeRegistry, "function");
  assert.equal(typeof storage.SpaceIsolatedEmployeeRegistry, "function");
  assert.equal(typeof storage.SpaceScopedPublicationRegistry, "function");
});
