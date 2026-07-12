import assert from "node:assert/strict";
import test from "node:test";

import {
  internalErrorMessage,
  requestValidationMessage,
  toUserMessage
} from "./user-message.js";

test("domain validation messages are translated into clear Russian text", () => {
  assert.equal(
    toUserMessage(new Error("key must not be empty")),
    "Не заполнено обязательное поле «key»."
  );
  assert.equal(
    toUserMessage(new Error("Space was not found: engineering")),
    "Пространство «engineering» не найдено."
  );
  assert.equal(
    toUserMessage(
      new Error("audience group member must belong to the same space")
    ),
    "Участник группы должен находиться в том же пространстве."
  );
});

test("database errors do not expose raw English diagnostics", () => {
  assert.equal(
    toUserMessage(new Error("UNIQUE constraint failed: spaces.key")),
    "Такая запись уже существует."
  );
  assert.equal(
    toUserMessage(new Error("database is locked")),
    "База данных временно занята. Повторите действие через несколько секунд."
  );
});

test("already Russian messages are preserved", () => {
  const message = "Сначала выберите пространство.";
  assert.equal(toUserMessage(new Error(message)), message);
});

test("unknown diagnostics are replaced with a safe Russian fallback", () => {
  assert.equal(
    toUserMessage(new Error("opaque adapter failure")),
    "Не удалось выполнить операцию. Проверьте введённые данные и повторите действие."
  );
  assert.match(requestValidationMessage(), /Проверьте заполнение формы/);
  assert.match(internalErrorMessage(), /Внутренняя ошибка сервера/);
});
