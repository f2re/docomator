import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const firstRun = fs.readFileSync(new URL("./first-run.sh", import.meta.url), "utf8");
const prepare = fs.readFileSync(new URL("./prepare-bundle.sh", import.meta.url), "utf8");
const installer = fs.readFileSync(new URL("./install.sh", import.meta.url), "utf8");
const setCode = fs.readFileSync(new URL("./set-access-code.sh", import.meta.url), "utf8");
const resetCode = fs.readFileSync(new URL("./reset-access-code.sh", import.meta.url), "utf8");

test("offline first-run и recovery используют один 4-значный access-code contract", () => {
  assert.match(firstRun, /4-значный код доступа/u);
  assert.match(firstRun, /first-run\.sh --reset-code/u);
  assert.match(firstRun, /reset-access-code\.sh/u);
  assert.equal(fs.existsSync(new URL("./set-access-code.sh", import.meta.url)), true);
  assert.equal(fs.existsSync(new URL("./reset-access-code.sh", import.meta.url)), true);
  assert.match(setCode, /\^\[0-9\]\{4\}\$/u);
  assert.match(setCode, /DOCOMATOR_ACCESS_CODE_HASH/u);
  assert.match(setCode, /randomBytes\(48\)/u);
  assert.match(resetCode, /set-access-code\.sh/u);
  assert.match(prepare, /set-access-code\.sh/u);
  assert.match(prepare, /reset-access-code\.sh/u);
  assert.match(installer, /set-access-code\.sh/u);
  assert.match(installer, /reset-access-code\.sh/u);
  assert.match(installer, /DOCOMATOR_SESSION_SECRET/u);
  assert.match(installer, /randomBytes\(48\)/u);
});

test("старые password-скрипты — только тонкие compatibility wrappers", () => {
  const legacySet = fs.readFileSync(new URL("./set-password.sh", import.meta.url), "utf8");
  const legacyReset = fs.readFileSync(new URL("./reset-password.sh", import.meta.url), "utf8");
  assert.match(legacySet, /set-access-code\.sh/u);
  assert.doesNotMatch(legacySet, /scryptSync/u);
  assert.match(legacyReset, /reset-access-code\.sh/u);
  assert.doesNotMatch(legacyReset, /scryptSync/u);
});
