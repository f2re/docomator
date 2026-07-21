import assert from "node:assert/strict";
import test from "node:test";

import { evaluateControlBackup } from "./pilot-backup-evidence.mjs";

const startedAt = "2026-07-21T10:00:00.000Z";
const currentBackup = {
  createdAt: "2026-07-21T10:00:02.000Z",
  releaseVersion: "0.1.0-alpha.0",
  directory: "/var/lib/docomator/backups/backup-20260721T100002Z"
};

test("control backup accepts only a new verified backup of the current release", () => {
  const result = evaluateControlBackup({
    commandOk: true,
    startedAt,
    backup: currentBackup,
    expectedReleaseVersion: "0.1.0-alpha.0"
  });

  assert.equal(result.ok, true);
  assert.match(result.summary, /создана и проверена/u);
  assert.equal(result.data.backupCreatedAt, currentBackup.createdAt);
  assert.equal(result.data.releaseVersion, "0.1.0-alpha.0");
});

test("control backup rejects an old backup even when systemctl returned success", () => {
  const result = evaluateControlBackup({
    commandOk: true,
    startedAt,
    backup: {
      ...currentBackup,
      createdAt: "2026-07-21T09:59:00.000Z"
    },
    expectedReleaseVersion: "0.1.0-alpha.0"
  });

  assert.equal(result.ok, false);
  assert.match(result.summary, /не создана/u);
});

test("control backup rejects a backup of another release", () => {
  const result = evaluateControlBackup({
    commandOk: true,
    startedAt,
    backup: {
      ...currentBackup,
      releaseVersion: "0.0.9"
    },
    expectedReleaseVersion: "0.1.0-alpha.0"
  });

  assert.equal(result.ok, false);
  assert.match(result.summary, /другому релизу/u);
});

test("control backup rejects missing evidence after a successful service start", () => {
  const result = evaluateControlBackup({
    commandOk: true,
    startedAt,
    backup: null,
    expectedReleaseVersion: "0.1.0-alpha.0"
  });

  assert.equal(result.ok, false);
  assert.match(result.summary, /не найдена/u);
});

test("control backup preserves the systemd failure as a blocking result", () => {
  const result = evaluateControlBackup({
    commandOk: false,
    commandDetail: "unit failed",
    startedAt,
    backup: currentBackup,
    expectedReleaseVersion: "0.1.0-alpha.0"
  });

  assert.equal(result.ok, false);
  assert.equal(result.detail, "unit failed");
  assert.match(result.summary, /ошибкой/u);
});
