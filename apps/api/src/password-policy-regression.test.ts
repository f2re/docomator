import assert from "node:assert/strict";
import test from "node:test";
import { hashAccessPassword, verifyAccessPassword } from "./password-gate.js";

test("общий пароль не имеет искусственного минимума 12 символов", () => {
  const encoded = hashAccessPassword("я");
  assert.equal(verifyAccessPassword("я", encoded), true);
  assert.equal(verifyAccessPassword("другой", encoded), false);
});

test("пустой пароль запрещён, технический предел 512 символов сохраняется", () => {
  assert.throws(() => hashAccessPassword(""), /пустым|1 до 512/u);
  assert.throws(() => hashAccessPassword("x".repeat(513)), /512/u);
});
