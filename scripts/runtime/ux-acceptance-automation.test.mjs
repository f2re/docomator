import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import AxeJsonReporter from "../../tests/e2e/reporters/axe-json-reporter.mjs";
import {
  collectUxAutomationEvidence,
  UxAutomationEvidenceError
} from "./ux-acceptance-automation.mjs";
import {
  createUxAcceptanceTemplate,
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
const PROJECTS = [...UX_E2E_PROJECTS];
const AXE_PROJECTS = [
  ["chromium-320", "light", 320],
  ["chromium-1440", "dark", 1440]
];
const AXE_LABELS = [
  "Главная",
  "Сотрудники",
  "Шаблоны",
  "Создать документы",
  "Результаты",
  "Добавление сотрудника и поля"
];
const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa"
];
const CLI_PATH = fileURLToPath(new URL("./ux-acceptance.mjs", import.meta.url));

function playwrightReport(overrides = {}) {
  const axeTitles = new Set(UX_E2E_TEST_TITLES.slice(0, 6));
  const executions = PROJECTS.flatMap((projectName) =>
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
  const passed = executions.filter(({ status }) => status === "passed").length;
  const skipped = executions.length - passed;
  return {
    config: {
      metadata: {
        docomatorEvidenceContractVersion: UX_E2E_EVIDENCE_CONTRACT_VERSION,
        docomatorCommitSha: COMMIT_SHA,
        docomatorBundleManifestSha256: BUNDLE_MANIFEST_SHA256,
        docomatorReleaseMetadataSha256: RELEASE_METADATA_SHA256,
        docomatorBrowserVersion: BROWSER_VERSION
      },
      projects: PROJECTS.map((name) => ({ name }))
    },
    suites: [
      {
        title: "evidence.spec.mjs",
        specs: executions.map(({ title, projectName, status }) => ({
          title,
          tests: [
            {
              projectName,
              results: [{ status, errors: [] }]
            }
          ]
        }))
      }
    ],
    errors: [],
    stats: {
      startTime: NOW,
      duration: 1_000,
      expected: passed,
      skipped,
      unexpected: 0,
      flaky: 0
    },
    ...overrides
  };
}

function axeRecord(project, theme, width, label) {
  return {
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
    wcagTags: WCAG_TAGS,
    axe: {
      violations: [],
      incomplete: [],
      passes: [],
      inapplicable: [],
      toolOptions: {
        runOnly: { type: "tag", values: WCAG_TAGS }
      }
    },
    testStatus: "passed"
  };
}

function axeReport(results = null) {
  const records =
    results ??
    AXE_PROJECTS.flatMap(([project, theme, width]) =>
      AXE_LABELS.map((label) => axeRecord(project, theme, width, label))
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
    summary: {
      checks: records.length,
      violations: records.reduce(
        (total, record) => total + record.axe.violations.length,
        0
      ),
      incomplete: records.reduce(
        (total, record) => total + record.axe.incomplete.length,
        0
      )
    },
    results: records
  };
}

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

async function fixtureDirectory() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "docomator-ux-automation-")
  );
  const actPath = path.join(directory, "ux-acceptance.json");
  const outputActPath = path.join(directory, "ux-acceptance-with-automation.json");
  const playwrightPath = path.join(directory, "playwright.json");
  const axePath = path.join(directory, "axe.json");
  const act = createUxAcceptanceTemplate();
  act.environment.commitSha = COMMIT_SHA;
  act.environment.bundleManifestSha256 = BUNDLE_MANIFEST_SHA256;
  act.environment.releaseMetadataSha256 = RELEASE_METADATA_SHA256;
  act.environment.browserVersion = BROWSER_VERSION;
  await Promise.all([
    writeFile(actPath, `${JSON.stringify(act, null, 2)}\n`, { mode: 0o600 }),
    writeFile(playwrightPath, JSON.stringify(playwrightReport()), { mode: 0o600 }),
    writeFile(axePath, JSON.stringify(axeReport()), { mode: 0o600 })
  ]);
  return {
    directory,
    actPath,
    outputActPath,
    playwrightPath,
    axePath,
    act
  };
}

test("axe reporter writes one structured aggregate and rejects malformed attachments", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "docomator-axe-reporter-"));
  try {
    const outputFile = path.join(directory, "axe-report.json");
    const reporter = new AxeJsonReporter({ outputFile });
    await reporter.onBegin();
    await reporter.onTestEnd(
      {},
      {
        status: "passed",
        attachments: [
          {
            name: "docomator-axe-result",
            body: Buffer.from(
              JSON.stringify(
                axeRecord("chromium-320", "light", 320, "Главная")
              )
            )
          }
        ]
      }
    );
    await reporter.onEnd({ status: "passed" });
    const report = JSON.parse(await readFile(outputFile, "utf8"));
    assert.equal(report.kind, "docomator.axe-report");
    assert.equal(report.summary.checks, 1);
    assert.equal(report.results[0].testStatus, "passed");

    const invalid = new AxeJsonReporter({
      outputFile: path.join(directory, "invalid.json")
    });
    await invalid.onBegin();
    await invalid.onTestEnd(
      {},
      {
        status: "passed",
        attachments: [
          {
            name: "docomator-axe-result",
            body: Buffer.from("{}")
          }
        ]
      }
    );
    await assert.rejects(
      invalid.onEnd({ status: "passed" }),
      /не удалось сформировать axe-отчёт/iu
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("automation collector fills only machine evidence and stays idempotent", async () => {
  const fixture = await fixtureDirectory();
  try {
    const before = structuredClone(fixture.act);
    const inputBytes = await readFile(fixture.actPath);
    const collected = await collectUxAutomationEvidence({
      actPath: fixture.actPath,
      outputActPath: fixture.outputActPath,
      playwrightReportPath: fixture.playwrightPath,
      axeReportPath: fixture.axePath
    });
    assert.equal(collected.state, "incomplete");
    assert.equal(collected.actPath, await realpath(fixture.outputActPath));
    assert.deepEqual(await readFile(fixture.actPath), inputBytes);
    const updatedBytes = await readFile(fixture.outputActPath);
    const updated = JSON.parse(updatedBytes.toString("utf8"));
    assert.deepEqual(updated.environment, before.environment);
    assert.deepEqual(updated.manualChecks, before.manualChecks);
    assert.deepEqual(updated.visualBaselines, before.visualBaselines);
    assert.deepEqual(updated.participants, before.participants);
    assert.deepEqual(updated.decision, before.decision);
    assert.equal(updated.automationEvidence.length, 2);
    for (const record of updated.automationEvidence) {
      assert.match(record.file, /^evidence\/(?:playwright|axe)-[a-f0-9]{16}\.json$/u);
      assert.match(record.sha256, /^[a-f0-9]{64}$/u);
      const information = await stat(path.join(fixture.directory, record.file));
      assert.equal(information.isFile(), true);
      assert.ok(information.size > 1 && information.size <= 50 * 1024 * 1024);
    }
    const validated = await validateUxAcceptanceFiles(
      updated,
      fixture.outputActPath
    );
    assert.equal(validated.state, "incomplete");
    assert.equal(
      validated.missing.some((item) => item.startsWith("automationEvidence")),
      false
    );

    await collectUxAutomationEvidence({
      actPath: fixture.actPath,
      outputActPath: fixture.outputActPath,
      playwrightReportPath: fixture.playwrightPath,
      axeReportPath: fixture.axePath
    });
    assert.deepEqual(await readFile(fixture.outputActPath), updatedBytes);
    assert.deepEqual(await readFile(fixture.actPath), inputBytes);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("collector derives the new shape from an unchanged legacy v1 act", async () => {
  const fixture = await fixtureDirectory();
  try {
    const legacy = structuredClone(fixture.act);
    for (const record of legacy.automationEvidence) {
      delete record.reviews;
    }
    const legacyBytes = Buffer.from(`${JSON.stringify(legacy, null, 2)}\n`);
    await writeFile(fixture.actPath, legacyBytes, { mode: 0o600 });
    const legacyValidation = await validateUxAcceptanceFiles(
      legacy,
      fixture.actPath
    );
    assert.equal(legacyValidation.state, "incomplete");
    assert.equal(legacyValidation.errors.length, 0);

    await collectUxAutomationEvidence({
      actPath: fixture.actPath,
      outputActPath: fixture.outputActPath,
      playwrightReportPath: fixture.playwrightPath,
      axeReportPath: fixture.axePath
    });
    assert.deepEqual(await readFile(fixture.actPath), legacyBytes);
    const derived = JSON.parse(await readFile(fixture.outputActPath, "utf8"));
    assert.equal(
      derived.automationEvidence.every((record) =>
        Array.isArray(record.reviews)
      ),
      true
    );
    const derivedValidation = await validateUxAcceptanceFiles(
      derived,
      fixture.outputActPath
    );
    assert.equal(derivedValidation.state, "incomplete");
    assert.equal(derivedValidation.errors.length, 0);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("unresolved axe findings require an explicit manual review", async () => {
  const fixture = await fixtureDirectory();
  try {
    const report = axeReport();
    report.results[0].axe.incomplete.push({
      id: "color-contrast",
      nodes: [{ target: ["#main-content"] }]
    });
    report.summary.incomplete = 1;
    await writeFile(fixture.axePath, JSON.stringify(report));
    await collectUxAutomationEvidence({
      actPath: fixture.actPath,
      outputActPath: fixture.outputActPath,
      playwrightReportPath: fixture.playwrightPath,
      axeReportPath: fixture.axePath
    });
    const act = JSON.parse(await readFile(fixture.outputActPath, "utf8"));
    const axeEvidence = act.automationEvidence.find(
      (item) => item.id === "axe-json-report"
    );
    assert.equal(axeEvidence.reviews.length, 1);
    assert.equal(axeEvidence.reviews[0].status, "pending");
    assert.equal(axeEvidence.reviews[0].reportSha256, axeEvidence.sha256);
    let validated = await validateUxAcceptanceFiles(
      act,
      fixture.outputActPath
    );
    assert.equal(validated.state, "incomplete");
    assert.equal(
      validated.missing.some((item) => item.includes("color-contrast")),
      true
    );

    Object.assign(axeEvidence.reviews[0], {
      status: "passed",
      reviewedAt: NOW,
      reviewerId: "reviewer-01",
      evidence: "Контраст проверен вручную на каноническом Linux-стенде."
    });
    await writeFile(
      fixture.outputActPath,
      `${JSON.stringify(act, null, 2)}\n`
    );
    validated = await validateUxAcceptanceFiles(act, fixture.outputActPath);
    assert.equal(validated.state, "incomplete");
    assert.equal(
      validated.missing.some((item) => item.includes("color-contrast")),
      false
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("axe review is bound to the exact report bytes and review time", async () => {
  const fixture = await fixtureDirectory();
  try {
    const initialReport = axeReport();
    initialReport.results[0].axe.incomplete.push({
      id: "color-contrast",
      nodes: [{ target: ["#main-content"] }]
    });
    initialReport.summary.incomplete = 1;
    await writeFile(fixture.axePath, JSON.stringify(initialReport));
    await collectUxAutomationEvidence({
      actPath: fixture.actPath,
      outputActPath: fixture.outputActPath,
      playwrightReportPath: fixture.playwrightPath,
      axeReportPath: fixture.axePath
    });

    const reviewed = JSON.parse(
      await readFile(fixture.outputActPath, "utf8")
    );
    const axeEvidence = reviewed.automationEvidence.find(
      (item) => item.id === "axe-json-report"
    );
    Object.assign(axeEvidence.reviews[0], {
      status: "passed",
      reviewedAt: new Date(Date.parse(NOW) - 1_000).toISOString(),
      reviewerId: "reviewer-01",
      evidence: "Контраст проверен вручную."
    });
    let validation = await validateUxAcceptanceFiles(
      reviewed,
      fixture.outputActPath
    );
    assert.equal(validation.state, "invalid");

    axeEvidence.reviews[0].reviewedAt = NOW;
    axeEvidence.reviews[0].reportSha256 = "0".repeat(64);
    validation = await validateUxAcceptanceFiles(
      reviewed,
      fixture.outputActPath
    );
    assert.equal(validation.state, "invalid");

    axeEvidence.reviews[0].reportSha256 = axeEvidence.sha256;
    await writeFile(
      fixture.outputActPath,
      `${JSON.stringify(reviewed, null, 2)}\n`
    );
    validation = await validateUxAcceptanceFiles(
      reviewed,
      fixture.outputActPath
    );
    assert.equal(validation.state, "incomplete");

    const changedReport = structuredClone(initialReport);
    changedReport.generatedAt = new Date(
      Date.parse(NOW) + 1_000
    ).toISOString();
    changedReport.results[0].axe.incomplete[0].nodes = [
      { target: ["#main-content", ".card"] }
    ];
    await writeFile(fixture.axePath, JSON.stringify(changedReport));
    const nextActPath = path.join(fixture.directory, "ux-acceptance-next.json");
    await collectUxAutomationEvidence({
      actPath: fixture.outputActPath,
      outputActPath: nextActPath,
      playwrightReportPath: fixture.playwrightPath,
      axeReportPath: fixture.axePath
    });
    const next = JSON.parse(await readFile(nextActPath, "utf8"));
    const nextAxeEvidence = next.automationEvidence.find(
      (item) => item.id === "axe-json-report"
    );
    assert.notEqual(nextAxeEvidence.sha256, axeEvidence.sha256);
    assert.equal(nextAxeEvidence.reviews[0].status, "pending");
    assert.equal(
      nextAxeEvidence.reviews[0].reportSha256,
      nextAxeEvidence.sha256
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("automation collector fails closed and leaves the act unchanged", async () => {
  const fixture = await fixtureDirectory();
  try {
    const original = await readFile(fixture.actPath);
    const partial = playwrightReport();
    const removed = partial.suites[0].specs.pop();
    assert.equal(removed.tests[0].results[0].status, "passed");
    partial.stats.expected -= 1;
    await writeFile(fixture.playwrightPath, JSON.stringify(partial));
    await assert.rejects(
      collectUxAutomationEvidence({
        actPath: fixture.actPath,
        outputActPath: fixture.outputActPath,
        playwrightReportPath: fixture.playwrightPath,
        axeReportPath: fixture.axePath
      }),
      /inventory из 81/iu
    );
    assert.deepEqual(await readFile(fixture.actPath), original);
    await writeFile(
      fixture.playwrightPath,
      JSON.stringify(playwrightReport())
    );

    const futureCompletion = playwrightReport();
    futureCompletion.stats.duration = 10 * 60_000;
    await writeFile(
      fixture.playwrightPath,
      JSON.stringify(futureCompletion)
    );
    await assert.rejects(
      collectUxAutomationEvidence({
        actPath: fixture.actPath,
        outputActPath: fixture.outputActPath,
        playwrightReportPath: fixture.playwrightPath,
        axeReportPath: fixture.axePath
      }),
      /время завершения/iu
    );
    assert.deepEqual(await readFile(fixture.actPath), original);
    await writeFile(
      fixture.playwrightPath,
      JSON.stringify(playwrightReport())
    );

    const invalidReports = [
      playwrightReport({
        stats: { ...playwrightReport().stats, unexpected: 1 }
      }),
      axeReport(axeReport().results.slice(1)),
      (() => {
        const report = axeReport();
        report.results[0].axe.violations.push({ id: "color-contrast" });
        return report;
      })(),
      (() => {
        const report = axeReport();
        report.binding.commitSha = "c".repeat(40);
        return report;
      })(),
      (() => {
        const report = axeReport();
        report.binding.bundleManifestSha256 = "d".repeat(64);
        return report;
      })(),
      (() => {
        const report = axeReport();
        report.binding.releaseMetadataSha256 = "d".repeat(64);
        return report;
      })()
    ];
    for (const [index, invalidReport] of invalidReports.entries()) {
      const target = index === 0 ? fixture.playwrightPath : fixture.axePath;
      await writeFile(target, JSON.stringify(invalidReport));
      await assert.rejects(
        collectUxAutomationEvidence({
          actPath: fixture.actPath,
          outputActPath: fixture.outputActPath,
          playwrightReportPath: fixture.playwrightPath,
          axeReportPath: fixture.axePath
        }),
        UxAutomationEvidenceError
      );
      assert.deepEqual(await readFile(fixture.actPath), original);
      await writeFile(
        target,
        JSON.stringify(index === 0 ? playwrightReport() : axeReport())
      );
    }
    await writeFile(fixture.axePath, "{");
    await assert.rejects(
      collectUxAutomationEvidence({
        actPath: fixture.actPath,
        outputActPath: fixture.outputActPath,
        playwrightReportPath: fixture.playwrightPath,
        axeReportPath: fixture.axePath
      }),
      UxAutomationEvidenceError
    );
    assert.deepEqual(await readFile(fixture.actPath), original);

    await writeFile(fixture.axePath, JSON.stringify(axeReport()));
    const linkedReport = path.join(fixture.directory, "linked-axe.json");
    await symlink(fixture.axePath, linkedReport);
    await assert.rejects(
      collectUxAutomationEvidence({
        actPath: fixture.actPath,
        outputActPath: fixture.outputActPath,
        playwrightReportPath: fixture.playwrightPath,
        axeReportPath: linkedReport
      }),
      /символическая ссылка/iu
    );
    assert.deepEqual(await readFile(fixture.actPath), original);
    await assert.rejects(readFile(fixture.outputActPath), { code: "ENOENT" });
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("collector creates one immutable derived act under concurrent calls", async () => {
  const fixture = await fixtureDirectory();
  try {
    const originalInput = await readFile(fixture.actPath);
    const input = {
      actPath: fixture.actPath,
      outputActPath: fixture.outputActPath,
      playwrightReportPath: fixture.playwrightPath,
      axeReportPath: fixture.axePath
    };
    const concurrent = await Promise.allSettled([
      collectUxAutomationEvidence(input),
      collectUxAutomationEvidence(input)
    ]);
    assert.equal(
      concurrent.filter((result) => result.status === "fulfilled").length,
      2
    );
    assert.deepEqual(await readFile(fixture.actPath), originalInput);
    const derivedBytes = await readFile(fixture.outputActPath);
    const derived = JSON.parse(derivedBytes.toString("utf8"));
    assert.equal(derived.automationEvidence.length, 2);

    const approved = JSON.parse(originalInput.toString("utf8"));
    approved.decision = {
      status: "passed",
      approvedAt: NOW,
      reviewerId: "reviewer-01",
      evidence: "Акт утверждён и больше не изменяется."
    };
    await writeFile(fixture.actPath, `${JSON.stringify(approved, null, 2)}\n`);
    const immutableBytes = await readFile(fixture.actPath);
    await assert.rejects(
      collectUxAutomationEvidence(input),
      /утверждённый акт.*неизменяем/iu
    );
    assert.deepEqual(await readFile(fixture.actPath), immutableBytes);
    assert.deepEqual(await readFile(fixture.outputActPath), derivedBytes);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("collector never overwrites an input or an independently edited output", async () => {
  const fixture = await fixtureDirectory();
  try {
    const inputBytes = await readFile(fixture.actPath);
    const options = {
      actPath: fixture.actPath,
      outputActPath: fixture.outputActPath,
      playwrightReportPath: fixture.playwrightPath,
      axeReportPath: fixture.axePath
    };
    await collectUxAutomationEvidence(options);
    const independentlyEdited = JSON.parse(
      await readFile(fixture.outputActPath, "utf8")
    );
    independentlyEdited.environment.platform = "Ручная правка после сбора";
    await writeFile(
      fixture.outputActPath,
      `${JSON.stringify(independentlyEdited, null, 2)}\n`
    );
    const editedBytes = await readFile(fixture.outputActPath);
    await assert.rejects(
      collectUxAutomationEvidence(options),
      /не перезаписывает данные/iu
    );
    assert.deepEqual(await readFile(fixture.outputActPath), editedBytes);
    assert.deepEqual(await readFile(fixture.actPath), inputBytes);

    await assert.rejects(
      collectUxAutomationEvidence({
        ...options,
        outputActPath: fixture.actPath
      }),
      /входной акт не изменяется/iu
    );
    assert.deepEqual(await readFile(fixture.actPath), inputBytes);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("collector rejects replaceable and symlinked evidence directories", async () => {
  const writable = await fixtureDirectory();
  try {
    const original = await readFile(writable.actPath);
    await chmod(writable.directory, 0o777);
    await assert.rejects(
      collectUxAutomationEvidence({
        actPath: writable.actPath,
        outputActPath: writable.outputActPath,
        playwrightReportPath: writable.playwrightPath,
        axeReportPath: writable.axePath
      }),
      /запись группе и остальным/iu
    );
    assert.deepEqual(await readFile(writable.actPath), original);
  } finally {
    await chmod(writable.directory, 0o700).catch(() => undefined);
    await rm(writable.directory, { recursive: true, force: true });
  }

  const linked = await fixtureDirectory();
  try {
    const external = path.join(linked.directory, "external-evidence");
    await mkdir(external, { mode: 0o700 });
    await symlink(external, path.join(linked.directory, "evidence"));
    const original = await readFile(linked.actPath);
    await assert.rejects(
      collectUxAutomationEvidence({
        actPath: linked.actPath,
        outputActPath: linked.outputActPath,
        playwrightReportPath: linked.playwrightPath,
        axeReportPath: linked.axePath
      }),
      /символическую ссылку/iu
    );
    assert.deepEqual(await readFile(linked.actPath), original);
  } finally {
    await rm(linked.directory, { recursive: true, force: true });
  }
});

test("collector rejects a symlinked output act", async () => {
  const fixture = await fixtureDirectory();
  try {
    const linkedOutput = path.join(fixture.directory, "linked-output.json");
    await symlink(fixture.actPath, linkedOutput);
    const inputBytes = await readFile(fixture.actPath);
    await assert.rejects(
      collectUxAutomationEvidence({
        actPath: fixture.actPath,
        outputActPath: linkedOutput,
        playwrightReportPath: fixture.playwrightPath,
        axeReportPath: fixture.axePath
      }),
      /выходной акт.*символической ссылкой/iu
    );
    assert.deepEqual(await readFile(fixture.actPath), inputBytes);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("collect-automation CLI reports that human acceptance is still incomplete", async () => {
  const fixture = await fixtureDirectory();
  try {
    const inputBytes = await readFile(fixture.actPath);
    const result = await runCli([
      "collect-automation",
      fixture.actPath,
      fixture.outputActPath,
      fixture.playwrightPath,
      fixture.axePath
    ]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /входной акт не изменён/iu);
    assert.match(result.stdout, /ручная UX-приёмка остаётся незавершённой/iu);
    assert.equal(result.stderr, "");
    assert.deepEqual(await readFile(fixture.actPath), inputBytes);
    const validated = await validateUxAcceptanceFiles(
      JSON.parse(await readFile(fixture.outputActPath, "utf8")),
      fixture.outputActPath
    );
    assert.equal(validated.state, "incomplete");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
