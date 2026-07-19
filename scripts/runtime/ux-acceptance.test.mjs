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
import {
  UX_E2E_EVIDENCE_CONTRACT_VERSION,
  UX_E2E_PROJECTS,
  UX_E2E_TEST_TITLES
} from "./ux-acceptance-report-contracts.mjs";

const NOW = new Date(Date.now() - 60_000).toISOString();
const COMMIT_SHA = "a".repeat(40);
const BUNDLE_MANIFEST_SHA256 = "b".repeat(64);
const RELEASE_METADATA_SHA256 = "c".repeat(64);
const BROWSER_VERSION = "Chromium 1228";
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
    browserVersion: BROWSER_VERSION,
    screenReader: "Orca 46",
    commitSha: COMMIT_SHA,
    bundleManifestSha256: BUNDLE_MANIFEST_SHA256,
    releaseMetadataSha256: RELEASE_METADATA_SHA256,
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

function playwrightEvidenceFixture() {
  const axeTitles = new Set(UX_E2E_TEST_TITLES.slice(0, 6));
  const executions = UX_E2E_PROJECTS.flatMap((projectName) =>
    UX_E2E_TEST_TITLES.map((title) => ({
      title,
      projectName,
      status:
        (projectName === "chromium-768" && axeTitles.has(title)) ||
        (projectName === "chromium-1440" &&
          title === UX_E2E_TEST_TITLES[12])
          ? "skipped"
          : "passed"
    }))
  );
  return {
    config: {
      metadata: {
        docomatorEvidenceContractVersion: UX_E2E_EVIDENCE_CONTRACT_VERSION,
        docomatorCommitSha: COMMIT_SHA,
        docomatorBundleManifestSha256: BUNDLE_MANIFEST_SHA256,
        docomatorReleaseMetadataSha256: RELEASE_METADATA_SHA256,
        docomatorBrowserVersion: BROWSER_VERSION
      },
      projects: UX_E2E_PROJECTS.map((name) => ({ name }))
    },
    suites: [
      {
        title: "evidence.spec.mjs",
        specs: executions.map(({ title, projectName, status }) => ({
          title,
          tests: [
            { projectName, results: [{ status, errors: [] }] }
          ]
        }))
      }
    ],
    errors: [],
    stats: {
      startTime: NOW,
      duration: 0,
      expected: executions.filter(({ status }) => status === "passed").length,
      skipped: executions.filter(({ status }) => status === "skipped").length,
      unexpected: 0,
      flaky: 0
    }
  };
}

function axeEvidenceFixture() {
  const labels = [
    "Главная",
    "Сотрудники",
    "Шаблоны",
    "Создать документы",
    "Результаты",
    "Добавление сотрудника и поля"
  ];
  const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
  const results = [
    ["chromium-320", "light", 320],
    ["chromium-1440", "dark", 1440]
  ].flatMap(([project, theme, width]) =>
    labels.map((label) => ({
      version: 1,
      kind: "docomator.axe-result",
      contractVersion: UX_E2E_EVIDENCE_CONTRACT_VERSION,
      project,
      title:
        label === "Добавление сотрудника и поля"
          ? "диалог сотрудника не содержит машинно-выявляемых нарушений WCAG"
          : `экран «${label}» не содержит машинно-выявляемых нарушений WCAG`,
      label,
      theme,
      viewport: { width, height: 900 },
      wcagTags: tags,
      axe: {
        violations: [],
        incomplete: [],
        passes: [],
        inapplicable: [],
        toolOptions: { runOnly: { type: "tag", values: tags } }
      },
      testStatus: "passed"
    }))
  );
  return {
    version: 1,
    kind: "docomator.axe-report",
    contractVersion: UX_E2E_EVIDENCE_CONTRACT_VERSION,
    binding: {
      commitSha: COMMIT_SHA,
      bundleManifestSha256: BUNDLE_MANIFEST_SHA256,
      releaseMetadataSha256: RELEASE_METADATA_SHA256,
      browserVersion: BROWSER_VERSION
    },
    generatedAt: NOW,
    runStatus: "passed",
    summary: { checks: results.length, violations: 0, incomplete: 0 },
    results
  };
}

function automationEvidenceFixture(id) {
  return id === "playwright-json-report"
    ? playwrightEvidenceFixture()
    : axeEvidenceFixture();
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
    for (const record of records) {
      const content = Object.prototype.hasOwnProperty.call(record, "viewport")
        ? pngFixture(record.viewport)
        : Buffer.from(JSON.stringify(automationEvidenceFixture(record.id)));
      await writeFile(path.join(directory, record.file), content);
      record.sha256 = createHash("sha256").update(content).digest("hex");
    }
    const actPath = path.join(directory, "ux-acceptance.json");
    assert.equal((await validateUxAcceptanceFiles(act, actPath)).state, "passed");

    const semanticBypass = structuredClone(act);
    const automationRecord = semanticBypass.automationEvidence[0];
    const forged = Buffer.from("{}");
    await writeFile(path.join(directory, automationRecord.file), forged);
    automationRecord.sha256 = createHash("sha256").update(forged).digest("hex");
    assert.equal(
      (await validateUxAcceptanceFiles(semanticBypass, actPath)).state,
      "invalid"
    );
    const restoredAutomation = Buffer.from(
      JSON.stringify(automationEvidenceFixture(automationRecord.id))
    );
    await writeFile(
      path.join(directory, automationRecord.file),
      restoredAutomation
    );

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
