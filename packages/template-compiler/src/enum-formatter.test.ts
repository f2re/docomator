import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultScalarFormatter,
  formatScalarDisplay,
  parseScalarFormatter
} from "./scalar-formatter.js";

test("enum values use the safe identity formatter in templates", () => {
  const formatter = defaultScalarFormatter("enum");
  assert.deepEqual(formatter, { version: 1, kind: "identity" });
  assert.deepEqual(parseScalarFormatter("enum", formatter), formatter);
  assert.equal(
    formatScalarDisplay("enum", "Ведущий инженер", formatter),
    "Ведущий инженер"
  );
});
