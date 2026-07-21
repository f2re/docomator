import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  initializeEvidenceRoot,
  validateBlockerRegister,
  validateOfficeCompatibility,
  validateRecoveryAct,
  validateReleaseEvidence
} from "./release-evidence-gate.mjs";

const commitSha = "a".repeat(40);
const releaseVersion = "0.1.0-alpha.0";
const now = new Date().toISOString();

function recoveryAct(overrides = {}) {
  return {
    version: 1,
    kind: "docomator.restore-acceptance",
    status: "passed",
    releaseVersion,
    commitSha,
    sourceTarget: "debian",
    sourceBackupManifestSha256: "b".repeat(64),
    restoredAt: now,
    counts: Object.fromEntries(
      ["participants", "templates", "results", "objects"].map((key, index) => [
        key,
        { expected: index + 1, actual: index + 1 }
      ])
    ),
    checksumsMatch: true,
    evidence: "Восстановление выполнено на отдельном чистом стенде.",
    ...overrides
  };
}

function officeAct() {
  const documents = [];
  for (const [format, offset] of [["docx", 1], ["xlsx", 101]]) {
    for (let index = 0; index < 20; index += 1) {
      documents.push({
        id: `${format}-${String(index + 1).padStart(2, "0")}`,
        format,
        sha256: (offset + index).toString(16).padStart(64, "0"),
        source: `Обезличенный ${format.toUpperCase()} из Office-корпуса`,
        producer: format === "docx" ? "Microsoft Word" : "Microsoft Excel",
        libreOfficeOpened: true,
        microsoftOfficeOpened: true,
        technicalMarkersAbsent: true,
        notes: ""
      });
    }
  }
  return {
    version: 1,
    kind: "docomator.office-compatibility",
    releaseVersion,
    commitSha,
    testedAt: now,
    documents
  };
}

test("recovery act accepts exact counts and rejects data loss", () => {
  assert.equal(
    validateRecoveryAct(recoveryAct(), {
      releaseVersion,
      commitSha,
      targets: [{ targetName: "debian", backupManifestSha256: "b".repeat(64) }]
    }).status,
    "passed"
  );
  const broken = recoveryAct();
  broken.counts.results.actual = 0;
  assert.throws(
    () => validateRecoveryAct(broken, {
        releaseVersion,
        commitSha,
        targets: [{ targetName: "debian", backupManifestSha256: "b".repeat(64) }]
      }),
    /не совпадают/u
  );
});

test("office compatibility requires 20 DOCX and 20 XLSX opened in both suites", () => {
  assert.deepEqual(validateOfficeCompatibility(officeAct(), { releaseVersion, commitSha }), { docx: 20, xlsx: 20 });
  const broken = officeAct();
  broken.documents[0].microsoftOfficeOpened = false;
  assert.throws(() => validateOfficeCompatibility(broken, { releaseVersion, commitSha }), /не прошёл обе Office-проверки/u);
});

test("blocker register must be empty", () => {
  assert.equal(
    validateBlockerRegister({
      version: 1,
      kind: "docomator.blocker-register",
      releaseVersion,
      commitSha,
      reviewedAt: now,
      openBlockers: []
    }, { releaseVersion, commitSha }).openBlockers.length,
    0
  );
  assert.throws(
    () =>
      validateBlockerRegister({
        version: 1,
        kind: "docomator.blocker-register",
        releaseVersion,
        commitSha,
        reviewedAt: now,
        openBlockers: [{ id: "blocker-01" }]
      }, { releaseVersion, commitSha }),
    /Остаются открытые/u
  );
});

test("evidence init creates an explicit incomplete skeleton", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-release-evidence-"));
  const root = path.join(parent, "evidence");
  try {
    await initializeEvidenceRoot(root);
    for (const relative of [
      "targets/debian",
      "targets/astra",
      "ux/ux-acceptance.json",
      "recovery/restore-act.json",
      "office/compatibility.json",
      "blockers.json",
      "README.md"
    ]) {
      await fs.access(path.join(root, relative));
    }
    await assert.rejects(
      () => validateReleaseEvidence(root, { expectedVersion: releaseVersion, expectedCommit: commitSha }),
      /manifest\.sha256/u
    );
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});
