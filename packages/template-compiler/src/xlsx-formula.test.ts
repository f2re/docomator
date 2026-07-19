import assert from "node:assert/strict";
import test from "node:test";

import { TemplateCompilerError } from "./compiler.js";
import { translateSafeXlsxFormula } from "./xlsx-formula.js";

const AREA = { repeatRow: 2, startColumn: 2, endColumn: 6 };

test("safe XLSX formulas translate only relative references in the sample row", () => {
  assert.equal(
    translateSafeXlsxFormula(
      "ROUND(C2*$B$1, 2) + SUM(D2:F2)",
      2,
      7,
      AREA
    ),
    "ROUND(C7*$B$1, 2) + SUM(D7:F7)"
  );
  assert.equal(
    translateSafeXlsxFormula("$C2+B$1+10", 2, 3, AREA),
    "$C3+B$1+10"
  );
});

test("unsafe XLSX formula syntax and functions fail closed", () => {
  for (const formula of [
    "WEBSERVICE(\"https://example.org\")",
    "[Book.xlsx]Sheet1!A1",
    "Sheet1!A2",
    "INDIRECT(A2)",
    "A1+A2",
    "XFE2+1",
    "Z2+1",
    "$B$3+1"
  ]) {
    assert.throws(
      () => translateSafeXlsxFormula(formula, 2, 3, AREA),
      (error: unknown) =>
        error instanceof TemplateCompilerError &&
        error.code === "unsafe_repeat_formula"
    );
  }
});
