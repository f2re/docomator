import assert from "node:assert/strict";
import test from "node:test";

import { TemplateCompilerError } from "./compiler.js";
import {
  defaultScalarFormatter,
  formatScalarDisplay,
  parseScalarFormatter
} from "./scalar-formatter.js";

test("safe Russian formatters produce deterministic display values", () => {
  assert.equal(formatScalarDisplay("number", 12.5, undefined), "12,5");
  assert.equal(
    formatScalarDisplay("number", 12.5, {
      version: 1,
      kind: "number.ru",
      fractionDigits: 2
    }),
    "12,50"
  );
  assert.equal(formatScalarDisplay("integer", 12, undefined), "12");
  assert.equal(formatScalarDisplay("date", "2026-07-16", undefined), "16.07.2026");
  assert.equal(
    formatScalarDisplay("date-time", "2026-07-16T09:30:00.000Z", {
      version: 1,
      kind: "date-time.ru",
      timeZone: "Europe/Moscow"
    }),
    "16.07.2026 12:30"
  );
  assert.equal(formatScalarDisplay("boolean", true, undefined), "Да");
  assert.equal(formatScalarDisplay("boolean", false, undefined), "Нет");
});

test("default formatters are explicit and versioned", () => {
  assert.deepEqual(defaultScalarFormatter("string"), {
    version: 1,
    kind: "identity"
  });
  assert.deepEqual(defaultScalarFormatter("number"), {
    version: 1,
    kind: "number.ru",
    fractionDigits: null
  });
  assert.deepEqual(defaultScalarFormatter("date-time"), {
    version: 1,
    kind: "date-time.ru",
    timeZone: "Europe/Moscow"
  });
  assert.deepEqual(parseScalarFormatter("date", { version: 1, kind: "default" }), {
    version: 1,
    kind: "date.ru"
  });
});

test("legacy formatter preserves already activated display contracts", () => {
  const legacy = { version: 1, kind: "legacy" };
  assert.equal(formatScalarDisplay("number", "12.5", legacy), "12.5");
  assert.equal(formatScalarDisplay("date", "2026-07-16", legacy), "2026-07-16");
  assert.equal(
    formatScalarDisplay("date-time", "2026-07-16T09:30:00.000Z", legacy),
    "2026-07-16T09:30:00.000Z"
  );
  assert.equal(formatScalarDisplay("boolean", true, legacy), "Да");
});

test("formatter parser rejects unsupported and incompatible contracts", () => {
  const invalid = [
    () => parseScalarFormatter("number", { version: 1, kind: "number.ru", fractionDigits: 7 }),
    () => parseScalarFormatter("integer", { version: 1, kind: "number.ru", fractionDigits: 2 }),
    () => parseScalarFormatter("string", { version: 1, kind: "boolean.ru" }),
    () => parseScalarFormatter("date-time", { version: 1, kind: "date-time.ru", timeZone: "../../etc" }),
    () => parseScalarFormatter("date", { version: 2, kind: "date.ru" }),
    () => parseScalarFormatter("date", { version: 1, kind: "script" }),
    () => formatScalarDisplay("date-time", "2026-07-16T12:30:00", {
      version: 1,
      kind: "date-time.ru",
      timeZone: "Europe/Moscow"
    })
  ];
  for (const operation of invalid) {
    assert.throws(
      operation,
      (error: unknown) =>
        error instanceof TemplateCompilerError &&
        error.code === "invalid_formatter"
    );
  }
});
