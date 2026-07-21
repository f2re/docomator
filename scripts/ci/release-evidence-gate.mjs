#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  createUxAcceptanceTemplate,
  validateUxAcceptanceFiles
} from "../runtime/ux-acceptance-lib.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+~_-]{0,127}$/u;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/u;
const COUNT_KEYS = ["participants", "templates", "results", "objects"];

class ReleaseEvidenceError extends Error {}

function usage() {
  process.stdout.write(`Использование:\n  release-evidence-gate.mjs init КАТАЛОГ\n  release-evidence-gate.mjs validate КАТАЛОГ --expected-commit SHA [--expected-version VERSION]\n\nКоманда init создаёт пустой строгий каркас доказательств. Команда validate\nfail-closed проверяет Debian и 🟥 Astra Linux target-акты, ручной P5 UX-акт,\nвосстановление на отдельном стенде, 20 DOCX + 20 XLSX и отсутствие\nоткрытых блокирующих дефектов.\n`);
}

function fail(message) {
  throw new ReleaseEvidenceError(message);
}

function record(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label}: ожидается объект.`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const object = record(value, label);
  const actual = Object.keys(object).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(`${label}: состав полей не совпадает с контрактом.`);
  }
  return object;
}

function timestamp(value, label) {
  if (typeof value !== "string") fail(`${label}: требуется UTC timestamp.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(`${label}: некорректный UTC timestamp.`);
  }
  if (parsed > Date.now() + 5 * 60_000) fail(`${label}: время находится в будущем.`);
  return parsed;
}

function nonEmptyText(value, label, maximum = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    fail(`${label}: требуется непустой текст до ${maximum} символов.`);
  }
  return value.trim();
}

function safeRelative(value, label) {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes("\n") ||
    value.includes("\r") ||
    path.posix.isAbsolute(value)
  ) {
    fail(`${label}: недопустимый относительный путь.`);
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    fail(`${label}: путь выходит за каталог доказательств.`);
  }
  return value;
}

async function sha256File(filePath) {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function listRegularFiles(rootDirectory) {
  const files = [];
  async function walk(current, relativeDirectory) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      const information = await fs.lstat(absolute);
      if (information.isSymbolicLink()) {
        fail(`Символические ссылки запрещены: ${relative}`);
      }
      if (information.isDirectory()) {
        await walk(absolute, relative);
      } else if (information.isFile()) {
        files.push(relative);
      } else {
        fail(`Неподдерживаемый объект доказательств: ${relative}`);
      }
    }
  }
  await walk(rootDirectory, "");
  return files.sort();
}

export async function verifyEvidenceManifest(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const manifestPath = path.join(root, "manifest.sha256");
  const source = await fs.readFile(manifestPath, "utf8").catch(() => {
    fail(`Отсутствует manifest.sha256: ${root}`);
  });
  const records = new Map();
  for (const [index, line] of source.trimEnd().split("\n").entries()) {
    const match = /^([a-f0-9]{64})  \.\/(.+)$/u.exec(line);
    if (match === null) fail(`manifest.sha256:${index + 1}: некорректная строка.`);
    const relative = safeRelative(match[2], `manifest.sha256:${index + 1}`);
    if (relative === "manifest.sha256") fail("manifest.sha256 не должен включать сам себя.");
    if (records.has(relative)) fail(`manifest.sha256: повтор пути ${relative}.`);
    records.set(relative, match[1]);
  }
  const actualFiles = (await listRegularFiles(root)).filter(
    (relative) => relative !== "manifest.sha256"
  );
  const expectedFiles = [...records.keys()].sort();
  if (
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((value, index) => value !== expectedFiles[index])
  ) {
    fail(`Состав файлов не совпадает с manifest.sha256: ${root}`);
  }
  for (const relative of actualFiles) {
    const actual = await sha256File(path.join(root, relative));
    if (actual !== records.get(relative)) {
      fail(`SHA-256 не совпадает: ${path.join(root, relative)}`);
    }
  }
  return records;
}

function artifactPath(targetRoot, relative, label) {
  const safe = safeRelative(relative, label);
  const absolute = path.resolve(targetRoot, safe);
  const relation = path.relative(targetRoot, absolute);
  if (relation.startsWith("..") || path.isAbsolute(relation)) {
    fail(`${label}: путь выходит за target-каталог.`);
  }
  return absolute;
}

async function readJson(filePath, label) {
  let source;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch {
    fail(`${label}: файл не найден.`);
  }
  try {
    return JSON.parse(source);
  } catch {
    fail(`${label}: файл не является JSON.`);
  }
}

async function validateTarget(rootDirectory, targetName, expectedVersion, expectedCommit) {
  const root = path.resolve(rootDirectory);
  const manifest = await verifyEvidenceManifest(root);
  const act = exactKeys(
    await readJson(path.join(root, "target-acceptance.json"), `${targetName}.target-acceptance`),
    [
      "version",
      "kind",
      "generatedAt",
      "releaseVersion",
      "commitSha",
      "bundleManifestSha256",
      "releaseMetadataSha256",
      "target",
      "baseURL",
      "requirements",
      "artifacts"
    ],
    `${targetName}.target-acceptance`
  );
  if (act.version !== 1 || act.kind !== "docomator.target-acceptance") {
    fail(`${targetName}: неподдерживаемый target-акт.`);
  }
  timestamp(act.generatedAt, `${targetName}.generatedAt`);
  if (act.releaseVersion !== expectedVersion) {
    fail(`${targetName}: версия ${act.releaseVersion} не совпадает с ${expectedVersion}.`);
  }
  if (act.commitSha !== expectedCommit || !COMMIT_PATTERN.test(act.commitSha ?? "")) {
    fail(`${targetName}: commit не совпадает с ожидаемым кандидатом.`);
  }
  for (const field of ["bundleManifestSha256", "releaseMetadataSha256"]) {
    if (!SHA256_PATTERN.test(act[field] ?? "")) fail(`${targetName}.${field}: некорректный SHA-256.`);
  }
  let baseURL;
  try {
    baseURL = new URL(act.baseURL);
  } catch {
    fail(`${targetName}.baseURL: некорректный URL.`);
  }
  if (
    baseURL.protocol !== "http:" ||
    !new Set(["127.0.0.1", "localhost", "[::1]"]).has(baseURL.hostname) ||
    baseURL.username !== "" ||
    baseURL.password !== ""
  ) {
    fail(`${targetName}.baseURL: разрешён только локальный HTTP-адрес.`);
  }
  const target = exactKeys(act.target, ["osId", "versionId", "architecture"], `${targetName}.target`);
  nonEmptyText(target.osId, `${targetName}.target.osId`, 128);
  nonEmptyText(target.versionId, `${targetName}.target.versionId`, 128);
  nonEmptyText(target.architecture, `${targetName}.target.architecture`, 64);
  if (targetName === "debian" && target.osId !== "debian") {
    fail("Debian-акт создан не на Debian.");
  }
  if (targetName === "astra" && !target.osId.toLowerCase().includes("astra")) {
    fail("🟥 Astra Linux-акт создан не на Astra Linux.");
  }
  const requirements = exactKeys(act.requirements, ["network", "smtp"], `${targetName}.requirements`);
  if (typeof requirements.network !== "boolean" || typeof requirements.smtp !== "boolean") {
    fail(`${targetName}.requirements: ожидаются логические значения.`);
  }
  if (targetName === "astra" && (!requirements.network || !requirements.smtp)) {
    fail("🟥 Astra Linux-акт должен быть выполнен с --require-network --require-smtp.");
  }
  const artifactKeys = [
    "pilotJson",
    "pilotMarkdown",
    "uxRunMetadata",
    "playwrightReport",
    "axeReport",
    "verifyBundleLog",
    "rootSmokeLog",
    "targetReleaseGateLog",
    "pilotLog",
    "uxLog"
  ];
  const artifacts = exactKeys(act.artifacts, artifactKeys, `${targetName}.artifacts`);
  for (const key of artifactKeys) {
    const relative = safeRelative(artifacts[key], `${targetName}.artifacts.${key}`);
    if (!manifest.has(relative)) fail(`${targetName}: ${relative} не включён в manifest.sha256.`);
  }

  const pilot = await readJson(
    artifactPath(root, artifacts.pilotJson, `${targetName}.artifacts.pilotJson`),
    `${targetName}.pilot`
  );
  if (
    pilot.status !== "passed" ||
    pilot.summary?.requiredErrors !== 0 ||
    pilot.release?.version !== expectedVersion ||
    pilot.release?.gitCommit !== expectedCommit ||
    pilot.release?.releaseMetadataSha256 !== act.releaseMetadataSha256 ||
    pilot.release?.source !== "installed"
  ) {
    fail(`${targetName}: пилотный JSON не подтверждает кандидатный релиз.`);
  }
  const backupRun = Array.isArray(pilot.checks)
    ? pilot.checks.find((item) => item?.id === "backup_run")
    : null;
  if (backupRun?.state !== "ok" || backupRun?.required !== true) {
    fail(`${targetName}: контрольная резервная копия не подтверждена.`);
  }
  const backupStarted = timestamp(backupRun.data?.startedAt, `${targetName}.backup.startedAt`);
  const backupCreated = timestamp(
    backupRun.data?.backupCreatedAt,
    `${targetName}.backup.backupCreatedAt`
  );
  if (backupCreated + 5_000 < backupStarted) {
    fail(`${targetName}: контрольная копия старше текущего запуска.`);
  }
  if (!SHA256_PATTERN.test(backupRun.data?.manifestSha256 ?? "")) {
    fail(`${targetName}: SHA-256 manifest контрольной копии не подтверждён.`);
  }

  const ux = await readJson(
    artifactPath(root, artifacts.uxRunMetadata, `${targetName}.artifacts.uxRunMetadata`),
    `${targetName}.ux-run`
  );
  if (
    ux.releaseVersion !== expectedVersion ||
    ux.commitSha !== expectedCommit ||
    ux.bundleManifestSha256 !== act.bundleManifestSha256 ||
    ux.releaseMetadataSha256 !== act.releaseMetadataSha256
  ) {
    fail(`${targetName}: UX run-metadata не совпадает с target-актом.`);
  }
  return {
    targetName,
    releaseVersion: act.releaseVersion,
    commitSha: act.commitSha,
    bundleManifestSha256: act.bundleManifestSha256,
    releaseMetadataSha256: act.releaseMetadataSha256,
    osId: target.osId,
    versionId: target.versionId,
    architecture: target.architecture,
    backupManifestSha256: backupRun.data.manifestSha256
  };
}

export function validateRecoveryAct(value, binding) {
  const act = exactKeys(
    value,
    [
      "version",
      "kind",
      "status",
      "releaseVersion",
      "commitSha",
      "sourceTarget",
      "sourceBackupManifestSha256",
      "restoredAt",
      "counts",
      "checksumsMatch",
      "evidence"
    ],
    "recovery"
  );
  if (act.version !== 1 || act.kind !== "docomator.restore-acceptance" || act.status !== "passed") {
    fail("recovery: восстановление не имеет статуса passed.");
  }
  if (act.releaseVersion !== binding.releaseVersion || act.commitSha !== binding.commitSha) {
    fail("recovery: версия или commit не совпадают с кандидатным релизом.");
  }
  if (!new Set(["debian", "astra"]).has(act.sourceTarget)) {
    fail("recovery.sourceTarget: ожидается debian или astra.");
  }
  if (!SHA256_PATTERN.test(act.sourceBackupManifestSha256 ?? "")) {
    fail("recovery.sourceBackupManifestSha256: некорректный SHA-256.");
  }
  const sourceTarget = binding.targets?.find((target) => target.targetName === act.sourceTarget);
  if (sourceTarget === undefined) fail("recovery.sourceTarget: целевой акт не найден.");
  if (sourceTarget.backupManifestSha256 !== act.sourceBackupManifestSha256) {
    fail("recovery: восстановлена не та контрольная копия, которая зафиксирована target-актом.");
  }
  timestamp(act.restoredAt, "recovery.restoredAt");
  const counts = exactKeys(act.counts, COUNT_KEYS, "recovery.counts");
  for (const key of COUNT_KEYS) {
    const item = exactKeys(counts[key], ["expected", "actual"], `recovery.counts.${key}`);
    if (
      !Number.isSafeInteger(item.expected) ||
      item.expected < 0 ||
      !Number.isSafeInteger(item.actual) ||
      item.actual !== item.expected
    ) {
      fail(`recovery.counts.${key}: ожидаемое и фактическое количество не совпадают.`);
    }
  }
  if (act.checksumsMatch !== true) fail("recovery: контрольные суммы после восстановления не совпали.");
  nonEmptyText(act.evidence, "recovery.evidence");
  return act;
}

export function validateOfficeCompatibility(value, binding = null) {
  const act = exactKeys(
    value,
    ["version", "kind", "releaseVersion", "commitSha", "testedAt", "documents"],
    "office"
  );
  if (act.version !== 1 || act.kind !== "docomator.office-compatibility") {
    fail("office: неподдерживаемый акт совместимости.");
  }
  if (binding !== null && (act.releaseVersion !== binding.releaseVersion || act.commitSha !== binding.commitSha)) {
    fail("office: версия или commit не совпадают с кандидатным релизом.");
  }
  timestamp(act.testedAt, "office.testedAt");
  if (!Array.isArray(act.documents)) fail("office.documents: ожидается массив.");
  const ids = new Set();
  const hashes = new Set();
  const counts = { docx: 0, xlsx: 0 };
  for (const [index, source] of act.documents.entries()) {
    const item = exactKeys(
      source,
      [
        "id",
        "format",
        "sha256",
        "source",
        "producer",
        "libreOfficeOpened",
        "microsoftOfficeOpened",
        "technicalMarkersAbsent",
        "notes"
      ],
      `office.documents.${index + 1}`
    );
    if (!ID_PATTERN.test(item.id ?? "") || ids.has(item.id)) {
      fail(`office.documents.${index + 1}.id: некорректный или повторяющийся идентификатор.`);
    }
    ids.add(item.id);
    if (!new Set(["docx", "xlsx"]).has(item.format)) {
      fail(`office.documents.${item.id}.format: ожидается docx или xlsx.`);
    }
    counts[item.format] += 1;
    if (!SHA256_PATTERN.test(item.sha256 ?? "") || hashes.has(item.sha256)) {
      fail(`office.documents.${item.id}.sha256: некорректный или повторяющийся SHA-256.`);
    }
    hashes.add(item.sha256);
    nonEmptyText(item.source, `office.documents.${item.id}.source`, 1_000);
    nonEmptyText(item.producer, `office.documents.${item.id}.producer`, 500);
    if (
      item.libreOfficeOpened !== true ||
      item.microsoftOfficeOpened !== true ||
      item.technicalMarkersAbsent !== true
    ) {
      fail(`office.documents.${item.id}: документ не прошёл обе Office-проверки.`);
    }
    if (typeof item.notes !== "string" || item.notes.length > 2_000) {
      fail(`office.documents.${item.id}.notes: недопустимое примечание.`);
    }
  }
  if (counts.docx < 20 || counts.xlsx < 20) {
    fail("office.documents: требуется не менее 20 DOCX и 20 XLSX.");
  }
  return counts;
}

export function validateBlockerRegister(value, binding = null) {
  const register = exactKeys(
    value,
    ["version", "kind", "releaseVersion", "commitSha", "reviewedAt", "openBlockers"],
    "blockers"
  );
  if (register.version !== 1 || register.kind !== "docomator.blocker-register") {
    fail("blockers: неподдерживаемый реестр.");
  }
  if (binding !== null && (register.releaseVersion !== binding.releaseVersion || register.commitSha !== binding.commitSha)) {
    fail("blockers: версия или commit не совпадают с кандидатным релизом.");
  }
  timestamp(register.reviewedAt, "blockers.reviewedAt");
  if (!Array.isArray(register.openBlockers)) fail("blockers.openBlockers: ожидается массив.");
  if (register.openBlockers.length > 0) {
    fail(`Остаются открытые блокирующие дефекты: ${register.openBlockers.length}.`);
  }
  return register;
}

export async function initializeEvidenceRoot(rootDirectory) {
  const root = path.resolve(rootDirectory);
  try {
    await fs.lstat(root);
    fail(`Каталог уже существует: ${root}`);
  } catch (error) {
    if (error instanceof ReleaseEvidenceError) throw error;
    if (error === null || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }
  await Promise.all([
    fs.mkdir(path.join(root, "targets/debian"), { recursive: true, mode: 0o700 }),
    fs.mkdir(path.join(root, "targets/astra"), { recursive: true, mode: 0o700 }),
    fs.mkdir(path.join(root, "ux"), { recursive: true, mode: 0o700 }),
    fs.mkdir(path.join(root, "recovery"), { recursive: true, mode: 0o700 }),
    fs.mkdir(path.join(root, "office"), { recursive: true, mode: 0o700 })
  ]);
  const writeJson = (relative, value) =>
    fs.writeFile(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  await Promise.all([
    writeJson("ux/ux-acceptance.json", createUxAcceptanceTemplate()),
    writeJson("recovery/restore-act.json", {
      version: 1,
      kind: "docomator.restore-acceptance",
      status: "pending",
      releaseVersion: "",
      commitSha: "",
      sourceTarget: "debian",
      sourceBackupManifestSha256: "",
      restoredAt: null,
      counts: Object.fromEntries(
        COUNT_KEYS.map((key) => [key, { expected: null, actual: null }])
      ),
      checksumsMatch: null,
      evidence: ""
    }),
    writeJson("office/compatibility.json", {
      version: 1,
      kind: "docomator.office-compatibility",
      releaseVersion: "",
      commitSha: "",
      testedAt: null,
      documents: []
    }),
    writeJson("blockers.json", {
      version: 1,
      kind: "docomator.blocker-register",
      releaseVersion: "",
      commitSha: "",
      reviewedAt: null,
      openBlockers: []
    })
  ]);
  await fs.writeFile(
    path.join(root, "README.md"),
    "# Доказательства выпуска Docomator\n\nСкопируйте полные каталоги target-acceptance в targets/debian и targets/astra, заполните UX, recovery, Office и blockers, затем выполните release:evidence.\n",
    { encoding: "utf8", mode: 0o600 }
  );
  return root;
}

export async function validateReleaseEvidence(rootDirectory, options) {
  const root = path.resolve(rootDirectory);
  const expectedVersion = nonEmptyText(options.expectedVersion, "expectedVersion", 128);
  if (!VERSION_PATTERN.test(expectedVersion)) fail("expectedVersion: некорректная версия.");
  const expectedCommit = options.expectedCommit;
  if (!COMMIT_PATTERN.test(expectedCommit ?? "")) fail("expectedCommit: требуется полный Git SHA.");

  const [debian, astra] = await Promise.all([
    validateTarget(path.join(root, "targets/debian"), "debian", expectedVersion, expectedCommit),
    validateTarget(path.join(root, "targets/astra"), "astra", expectedVersion, expectedCommit)
  ]);

  const uxPath = path.join(root, "ux/ux-acceptance.json");
  const ux = await readJson(uxPath, "ux");
  const uxResult = await validateUxAcceptanceFiles(ux, uxPath);
  if (uxResult.state !== "passed") {
    fail(`UX-приёмка не завершена: ${[...uxResult.errors, ...uxResult.missing].join("; ")}`);
  }
  if (ux.environment?.commitSha !== expectedCommit) {
    fail("UX-акт относится к другому commit.");
  }
  const uxBindingMatchesTarget = [debian, astra].some(
    (target) =>
      target.bundleManifestSha256 === ux.environment?.bundleManifestSha256 &&
      target.releaseMetadataSha256 === ux.environment?.releaseMetadataSha256
  );
  if (!uxBindingMatchesTarget) fail("UX-акт не относится ни к Debian, ни к 🟥 Astra Linux target-акту.");

  const recovery = validateRecoveryAct(
    await readJson(path.join(root, "recovery/restore-act.json"), "recovery"),
    {
      releaseVersion: expectedVersion,
      commitSha: expectedCommit,
      targets: [debian, astra]
    }
  );
  const binding = { releaseVersion: expectedVersion, commitSha: expectedCommit };
  const officeCounts = validateOfficeCompatibility(
    await readJson(path.join(root, "office/compatibility.json"), "office"),
    binding
  );
  validateBlockerRegister(
    await readJson(path.join(root, "blockers.json"), "blockers"),
    binding
  );

  return {
    status: "passed",
    releaseVersion: expectedVersion,
    commitSha: expectedCommit,
    targets: [debian, astra],
    uxDecision: ux.decision.status,
    recoveryTarget: recovery.sourceTarget,
    officeDocuments: officeCounts
  };
}

function parseCli(argv) {
  const [command, rootDirectory, ...rest] = argv;
  if (command === "-h" || command === "--help" || command === undefined) {
    usage();
    process.exit(0);
  }
  if (!new Set(["init", "validate"]).has(command) || rootDirectory === undefined) {
    fail("Укажите init/validate и каталог доказательств.");
  }
  const options = { expectedCommit: null, expectedVersion: null };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    const value = rest[index + 1];
    if (argument === "--expected-commit" && value !== undefined) {
      options.expectedCommit = value;
      index += 1;
    } else if (argument === "--expected-version" && value !== undefined) {
      options.expectedVersion = value;
      index += 1;
    } else {
      fail(`Неизвестный или неполный параметр: ${argument}`);
    }
  }
  return { command, rootDirectory, options };
}

async function defaultVersion() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  return (await fs.readFile(path.join(repositoryRoot, "VERSION"), "utf8")).trim();
}

const isMain = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const cli = parseCli(process.argv.slice(2));
    if (cli.command === "init") {
      const root = await initializeEvidenceRoot(cli.rootDirectory);
      process.stdout.write(`Каркас доказательств создан: ${root}\n`);
    } else {
      const result = await validateReleaseEvidence(cli.rootDirectory, {
        expectedCommit: cli.options.expectedCommit,
        expectedVersion: cli.options.expectedVersion ?? (await defaultVersion())
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(
      `Доказательства выпуска не приняты: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    process.exitCode = 2;
  }
}
