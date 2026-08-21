import assert from "node:assert/strict";
import test from "node:test";
import { hashAccessCode, verifyAccessCode } from "./password-gate.js";

test("код доступа состоит ровно из четырёх цифр", () => {
  const encoded = hashAccessCode("0427");
  assert.equal(verifyAccessCode("0427", encoded), true);
  assert.equal(verifyAccessCode("0428", encoded), false);
});

test("код доступа отклоняет не четыре ASCII-цифры", () => {
  for (const invalid of ["", "1", "123", "12345", "12a4", " 123", "123 ", "+123", "１２３４"]) {
    assert.throws(() => hashAccessCode(invalid), /ровно из 4 цифр/u);
  }

  const encoded = hashAccessCode("1234");
  for (const invalid of ["123", "12345", "12a4", " 1234"]) {
    assert.equal(verifyAccessCode(invalid, encoded), false);
  }
});
