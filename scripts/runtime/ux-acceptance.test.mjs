import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createUxAcceptanceTemplate,
  UX_ACCEPTANCE_MANUAL_CHECKS,
  UX_ACCEPTANCE_TASKS,
  validateUxAcceptance,
  validateUxAcceptanceFiles
} from "./ux-acceptance-lib.mjs";

const NOW = new Date(Date.now() - 60_000).toISOString();
const CLI_PATH = fileURLToPath(new URL("./ux-acceptance.mjs", import.meta.url));

function runCli(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...arguments_], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function completedAct() {
  const act = createUxAcceptanceTemplate();
  act.environment = {
    platform: "linux",
    operatingSystem: "Ubuntu 24.04",
    browserVersion: "Chromium 1228",
    screenReader: "Orca 46",
    commitSha: "a".repeat(40),
    testedAt: NOW
  };
  act.manualChecks = UX_ACCEPTANCE_MANUAL_CHECKS.map((id) => ({
    id,
    status: "passed",
    checkedAt: NOW,
    evidence: `Протокол проверки ${id}`
  }));
  act.visualBaselines = act.visualBaselines.map((item, index) => ({
    ...item,
    file: `evidence/visual-${index}.png`,
    sha256: index.toString(16).padStart(64, "0"),
    approvedAt: NOW,
    reviewerId: "reviewer-01"
  }));
  act.automationEvidence = act.automationEvidence.map((item, index) => ({
    ...item,
    file: `evidence/automation-${index}.json`,
    sha256: (index + 10).toString(16).padStart(64, "0"),
    completedAt: NOW
  }));
  act.participants = ["participant-alpha", "participant-beta"].map(
    (participantId) => ({
      participantId,
      firstTimeUser: true,
      projectContributor: false,
      priorTraining: false,
      assistanceEvents: 0,
      tasks: UX_ACCEPTANCE_TASKS.map((id) => ({
        id,
        status: "passed",
        startedAt: NOW,
        completedAt: NOW,
        evidence: `Участник завершил ${id} без устной инструкции`
      }))
    })
  );
  act.decision = {
    status: "passed",
    approvedAt: NOW,
    reviewerId: "reviewer-01",
    evidence: "Акт рассмотрен, блокирующих замечаний нет"
  };
  return act;
}

function pngFixture(width) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
    buffer
  );
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(100, 20);
  return buffer;
}

test("UX acceptance template is intentionally incomplete", () => {
  const result = validateUxAcceptance(createUxAcceptanceTemplate());
  assert.equal(result.state, "incomplete");
  assert.ok(result.missing.length >= 20);
});

test("UX acceptance requires two complete independent sessions and evidence", () => {
  assert.deepEqual(validateUxAcceptance(completedAct()), {
    state: "passed",
    errors: [],
    missing: []
  });

  const duplicate = completedAct();
  duplicate.participants[1].participantId = duplicate.participants[0].participantId;
  assert.equal(validateUxAcceptance(duplicate).state, "invalid");

  const malformedParticipant = completedAct();
  malformedParticipant.participants[0] = null;
  assert.equal(validateUxAcceptance(malformedParticipant).state, "invalid");

  const ambiguousCommit = completedAct();
  ambiguousCommit.environment.commitSha = "a".repeat(41);
  assert.equal(validateUxAcceptance(ambiguousCommit).state, "incomplete");

  const nonUtcTimestamp = completedAct();
  nonUtcTimestamp.environment.testedAt = "2026-07-16 12:00:00";
  assert.equal(validateUxAcceptance(nonUtcTimestamp).state, "incomplete");

  const missingVisual = completedAct();
  missingVisual.visualBaselines[0].sha256 = null;
  assert.equal(validateUxAcceptance(missingVisual).state, "incomplete");

  const failedScreenReader = completedAct();
  failedScreenReader.manualChecks.find((item) => item.id === "screen-reader").status =
    "failed";
  assert.equal(validateUxAcceptance(failedScreenReader).state, "failed");
});

test("UX acceptance detects changed evidence files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "docomator-ux-evidence-"));
  try {
    const act = completedAct();
    const evidenceDirectory = path.join(directory, "evidence");
    await mkdir(evidenceDirectory, { mode: 0o700 });
    const records = [...act.visualBaselines, ...act.automationEvidence];
    for (const [index, record] of records.entries()) {
      const content = Object.prototype.hasOwnProperty.call(record, "viewport")
        ? pngFixture(record.viewport)
        : Buffer.from(JSON.stringify({ passed: true, index }));
      await writeFile(path.join(directory, record.file), content);
      record.sha256 = createHash("sha256").update(content).digest("hex");
    }
    const actPath = path.join(directory, "ux-acceptance.json");
    assert.equal((await validateUxAcceptanceFiles(act, actPath)).state, "passed");
    await writeFile(path.join(directory, records[0].file), "changed evidence");
    assert.equal((await validateUxAcceptanceFiles(act, actPath)).state, "invalid");

    const linkedAct = completedAct();
    for (const [index, record] of [
      ...linkedAct.visualBaselines,
      ...linkedAct.automationEvidence
    ].entries()) {
      record.sha256 = records[index].sha256;
    }
    await writeFile(path.join(directory, records[0].file), pngFixture(320));
    const linkedDirectory = path.join(directory, "linked-evidence");
    await symlink(evidenceDirectory, linkedDirectory, "dir");
    linkedAct.visualBaselines[0].file = "linked-evidence/visual-0.png";
    assert.equal(
      (await validateUxAcceptanceFiles(linkedAct, actPath)).state,
      "invalid"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("UX acceptance CLI creates without overwrite and reports incomplete", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "docomator-ux-cli-"));
  try {
    const actPath = path.join(directory, "ux-acceptance.json");
    const created = await runCli(["init", actPath]);
    assert.equal(created.code, 0);
    assert.match(created.stdout, /Создан незавершённый акт/u);
    assert.equal((await stat(actPath)).mode & 0o777, 0o600);

    const validated = await runCli(["validate", actPath, "--json"]);
    assert.equal(validated.code, 1);
    assert.equal(JSON.parse(validated.stdout).state, "incomplete");

    const repeated = await runCli(["init", actPath]);
    assert.equal(repeated.code, 2);
    assert.match(repeated.stderr, /не перезаписывает данные/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
