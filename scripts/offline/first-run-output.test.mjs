import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "scripts/offline/first-run.sh");

test("first-run показывает только действия пользователя, а не release backlog", () => {
  const output = execFileSync("bash", [script, "--url", "http://127.0.0.1:8080"], {
    cwd: root,
    encoding: "utf8"
  });

  assert.match(output, /Оформлятор установлен/u);
  assert.match(output, /Быстрый старт/u);
  assert.match(output, /Импортируйте сотрудников из CSV\/XLSX/u);
  assert.match(output, /дополнительных действий с правами каталогов не требуется/u);
  assert.doesNotMatch(output, /Что уже работает/u);
  assert.doesNotMatch(output, /Эксплуатационная приёмка/u);
  assert.doesNotMatch(output, /реальные Office-шаблоны/u);
});
