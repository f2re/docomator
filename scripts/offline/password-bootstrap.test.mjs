import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const firstRun = fs.readFileSync(new URL("./first-run.sh", import.meta.url), "utf8");
const prepare = fs.readFileSync(new URL("./prepare-bundle.sh", import.meta.url), "utf8");
const installer = fs.readFileSync(new URL("./install.sh", import.meta.url), "utf8");
const helper = fs.readFileSync(new URL("./set-password.sh", import.meta.url), "utf8");
const legacyReset = fs.readFileSync(new URL("./reset-password.sh", import.meta.url), "utf8");

test("offline first-run использует четырёхзначный код без логина и показывает установленный recovery", () => {
  assert.match(firstRun, /4-значный код доступа/u);
  assert.match(firstRun, /Логин не нужен/u);
  assert.match(firstRun, /--reset-code/u);
  assert.match(firstRun, /set-password\.sh/u);
  assert.match(helper, /\^\[0-9\]\{4\}\$/u);
  assert.match(helper, /DOCOMATOR_ACCESS_CODE_HASH/u);
  assert.match(helper, /DOCOMATOR_ACCESS_PASSWORD_HASH/u);
  assert.match(legacyReset, /set-password\.sh/u);
});

test("bundle и installer сохраняют стабильный recovery helper и session secret", () => {
  assert.match(prepare, /first-run\.sh/u);
  assert.match(prepare, /set-password\.sh/u);
  assert.match(installer, /TEMP_RELEASE\/first-run\.sh/u);
  assert.match(installer, /TEMP_RELEASE\/set-password\.sh/u);
  assert.match(installer, /DOCOMATOR_SESSION_SECRET/u);
  assert.match(installer, /randomBytes\(48\)/u);
});
