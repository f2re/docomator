import assert from "node:assert/strict";
import test from "node:test";

import { hashAccessCode, verifyAccessCode } from "./access-code-gate.js";

test("код доступа — ровно четыре десятичные цифры", () => {
  const encoded = hashAccessCode("0007");
  assert.equal(verifyAccessCode("0007", encoded), true);
  assert.equal(verifyAccessCode("0008", encoded), false);
  for (const value of ["", "7", "007", "00007", "12 4", "12а4", "１２３４"]) {
    assert.throws(() => hashAccessCode(value), /4 цифр/u);
  }
});
