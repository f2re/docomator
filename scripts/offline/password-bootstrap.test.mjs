import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const firstRun = fs.readFileSync(new URL("./first-run.sh", import.meta.url), "utf8");
const prepare = fs.readFileSync(new URL("./prepare-bundle.sh", import.meta.url), "utf8");
const installer = fs.readFileSync(new URL("./install.sh", import.meta.url), "utf8");

test("offline first-run points to a real fallback and prefers browser setup", () => {
  assert.match(firstRun, /создать общий пароль в браузере/u);
  assert.match(firstRun, /\/opt\/docomator\/current\/set-password\.sh/u);
  assert.equal(fs.existsSync(new URL("./set-password.sh", import.meta.url)), true);
  assert.match(prepare, /set-password\.sh/u);
  assert.match(installer, /DOCOMATOR_SESSION_SECRET/u);
  assert.match(installer, /randomBytes\(48\)/u);
  assert.match(installer, /TEMP_RELEASE\/set-password\.sh/u);
  assert.match(installer, /TEMP_RELEASE\/lib\.sh/u);
});
