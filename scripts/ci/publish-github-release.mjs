import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const SHA = /^[a-f0-9]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const RUN_ID = /^[1-9]\d*$/u;
const SHA256_LINE = /^([a-f0-9]{64})\s+\*?([^\r\n]+)$/u;
const PAYLOAD_NAME = /^payload\/(docomator-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-linux-(?:x64|arm64)\.tar\.gz)$/u;
const READ_ZIP_ENTRY_PY = "import sys,zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1], \"r\").read(sys.argv[2]))";
const EXTRACT_ZIP_ENTRY_PY = "import shutil,sys,zipfile; z=zipfile.ZipFile(sys.argv[1], \"r\"); i=z.getinfo(sys.argv[2]); f=open(sys.argv[3], \"xb\"); shutil.copyfileobj(z.open(i, \"r\"), f); f.close(); z.close()";

function fail(message) {
  throw new Error(message);
}

export function parseReleaseIdentity(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail("RELEASE_IDENTITY.json содержит некорректный JSON.");
  }

  const version = parsed?.version;
  const status = parsed?.status;
  const channel = parsed?.channel;
  if (typeof version !== "string" || !SEMVER.test(version)) {
    fail("RELEASE_IDENTITY.json.version должен быть точным SemVer X.Y.Z.");
  }

  const pair = `${status}/${channel}`;
  if (pair !== "candidate/pilot" && pair !== "stable/production") {
    fail(
      "GitHub Release разрешён только для candidate/pilot или stable/production."
    );
  }

  return { version, status, channel };
}

export function releaseDescriptor(identity) {
  if (identity.status === "candidate") {
    return {
      tag: `v${identity.version}-candidate`,
      title: `Оформлятор ${identity.version} — кандидат`,
      prerelease: true
    };
  }
  return {
    tag: `v${identity.version}`,
    title: `Оформлятор ${identity.version}`,
    prerelease: false
  };
}

export function readWorkflowInputs(environment) {
  const repository = environment.GITHUB_REPOSITORY ?? "";
  const sourceSha = environment.DOCOMATOR_SOURCE_SHA ?? "";
  const workflowRunId = environment.DOCOMATOR_WORKFLOW_RUN_ID ?? "";

  if (!REPOSITORY.test(repository)) {
    fail("GITHUB_REPOSITORY должен иметь вид owner/repository.");
  }
  if (!SHA.test(sourceSha)) {
    fail("DOCOMATOR_SOURCE_SHA должен быть полным Git SHA-1.");
  }
  if (!RUN_ID.test(workflowRunId)) {
    fail("DOCOMATOR_WORKFLOW_RUN_ID должен быть числовым GitHub Actions run id.");
  }
  if (!environment.GH_TOKEN) {
    fail("GH_TOKEN обязателен для публикации GitHub Release.");
  }

  return { repository, sourceSha, workflowRunId };
}

async function defaultCommandRunner(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    });
    return { code: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (error) {
    const code = typeof error?.code === "number" ? error.code : 1;
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : String(error);
    return { code, stdout, stderr };
  }
}

function assertCommand(result, description) {
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
    fail(`${description}: ${detail}`);
  }
  return result.stdout.trim();
}

async function sha256(filePath) {
  const digest = createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return digest.digest("hex");
}

async function regularFile(filePath) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`Release asset должен быть обычным файлом: ${path.basename(filePath)}`);
  }
}

export async function verifyChecksum(assetPath, checksumPath) {
  await regularFile(assetPath);
  await regularFile(checksumPath);
  const source = (await fs.readFile(checksumPath, "utf8")).trim();
  const match = SHA256_LINE.exec(source);
  if (!match) {
    fail(`Некорректный SHA-256 файл: ${path.basename(checksumPath)}`);
  }
  const expectedName = path.basename(assetPath);
  if (match[2] !== expectedName) {
    fail(
      `SHA-256 файл ${path.basename(checksumPath)} относится к ${match[2]}, ожидался ${expectedName}.`
    );
  }
  const actual = await sha256(assetPath);
  if (actual !== match[1]) {
    fail(`SHA-256 не совпадает для ${expectedName}.`);
  }
  return actual;
}

async function extractNativeAsset({
  projectAsset,
  directory,
  identity,
  sourceSha,
  commandRunner,
  cwd,
  environment
}) {
  const manifestResult = await commandRunner(
    "python3",
    ["-c", READ_ZIP_ENTRY_PY, projectAsset, "f2re-service.json"],
    { cwd, env: environment }
  );
  const manifestSource = assertCommand(
    manifestResult,
    "Не удалось прочитать f2re-service.json из Project Control package"
  );
  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch {
    fail("f2re-service.json внутри Project Control package содержит некорректный JSON.");
  }

  if (
    manifest?.schema !== "f2re-managed-service/v1" ||
    manifest?.controllerApi !== 1 ||
    manifest?.projectId !== "docomator" ||
    manifest?.adapter !== "docomator-v1" ||
    manifest?.nativeBundleFormat !== "docomator-offline-v2" ||
    manifest?.version !== identity.version ||
    manifest?.sourceCommit !== sourceSha
  ) {
    fail("Project Control manifest не совпадает с release identity и exact CI commit.");
  }

  const payloadPath = manifest?.payload?.path;
  const payloadHash = manifest?.payload?.sha256;
  const payloadSize = manifest?.payload?.size;
  const payloadMatch = typeof payloadPath === "string" ? PAYLOAD_NAME.exec(payloadPath) : null;
  if (
    !payloadMatch ||
    !payloadMatch[1].startsWith(`docomator-${identity.version}-linux-`) ||
    typeof payloadHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(payloadHash) ||
    !Number.isSafeInteger(payloadSize) ||
    payloadSize <= 0
  ) {
    fail("Project Control manifest содержит некорректное описание native bundle.");
  }

  const nativeAsset = path.join(directory, payloadMatch[1]);
  assertCommand(
    await commandRunner(
      "python3",
      ["-c", EXTRACT_ZIP_ENTRY_PY, projectAsset, payloadPath, nativeAsset],
      { cwd, env: environment }
    ),
    "Не удалось извлечь native bundle из Project Control package"
  );
  await regularFile(nativeAsset);
  const stat = await fs.stat(nativeAsset);
  const actualHash = await sha256(nativeAsset);
  if (stat.size !== payloadSize || actualHash !== payloadHash) {
    fail("Извлечённый native bundle не совпадает с Project Control manifest.");
  }

  const nativeChecksum = `${nativeAsset}.sha256`;
  await fs.writeFile(
    nativeChecksum,
    `${actualHash}  ${path.basename(nativeAsset)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return { nativeAsset, nativeChecksum, nativeHash: actualHash };
}

function notFoundRelease(result) {
  return result.code !== 0 && /(?:HTTP\s+404|release not found|not found)/iu.test(result.stderr);
}

export async function publishGitHubRelease({
  cwd = process.cwd(),
  environment = process.env,
  commandRunner = defaultCommandRunner,
  makeTempDirectory = async () => fs.mkdtemp(path.join(os.tmpdir(), "docomator-release-"))
} = {}) {
  const inputs = readWorkflowInputs(environment);
  const identity = parseReleaseIdentity(
    await fs.readFile(path.join(cwd, "RELEASE_IDENTITY.json"), "utf8")
  );
  const versionFile = (await fs.readFile(path.join(cwd, "VERSION"), "utf8")).trim();
  if (versionFile !== identity.version) {
    fail(
      `VERSION=${versionFile || "<empty>"} не совпадает с RELEASE_IDENTITY.json.version=${identity.version}.`
    );
  }

  const descriptor = releaseDescriptor(identity);
  const gitHead = assertCommand(
    await commandRunner("git", ["rev-parse", "HEAD"], { cwd, env: environment }),
    "Не удалось определить Git HEAD"
  );
  if (gitHead !== inputs.sourceSha) {
    fail(`Checkout ${gitHead} не совпадает с проверенным CI commit ${inputs.sourceSha}.`);
  }

  const existing = await commandRunner(
    "gh",
    ["release", "view", descriptor.tag, "--repo", inputs.repository, "--json", "url", "--jq", ".url"],
    { cwd, env: environment }
  );
  if (existing.code === 0) {
    return {
      published: false,
      tag: descriptor.tag,
      url: existing.stdout.trim(),
      reason: "already-published"
    };
  }
  if (!notFoundRelease(existing)) {
    assertCommand(existing, `Не удалось проверить GitHub Release ${descriptor.tag}`);
  }

  const remoteTag = await commandRunner(
    "git",
    ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${descriptor.tag}`],
    { cwd, env: environment }
  );
  if (remoteTag.code === 0) {
    fail(`Tag ${descriptor.tag} уже существует без GitHub Release; автоматическая перезапись запрещена.`);
  }
  if (remoteTag.code !== 2) {
    assertCommand(remoteTag, `Не удалось проверить tag ${descriptor.tag}`);
  }

  const assetDirectory = await makeTempDirectory();
  try {
    const artifactName = `docomator-project-control-${inputs.sourceSha}`;
    assertCommand(
      await commandRunner(
        "gh",
        [
          "run",
          "download",
          inputs.workflowRunId,
          "--repo",
          inputs.repository,
          "--name",
          artifactName,
          "--dir",
          assetDirectory
        ],
        { cwd, env: environment }
      ),
      `Не удалось скачать verified artifact ${artifactName}`
    );

    const projectAsset = path.join(
      assetDirectory,
      `docomator-${identity.version}-project-control.f2re.zip`
    );
    const projectChecksum = `${projectAsset}.sha256`;
    const projectHash = await verifyChecksum(projectAsset, projectChecksum);
    const { nativeAsset, nativeChecksum, nativeHash } = await extractNativeAsset({
      projectAsset,
      directory: assetDirectory,
      identity,
      sourceSha: inputs.sourceSha,
      commandRunner,
      cwd,
      environment
    });
    const sumsFile = path.join(assetDirectory, "SHA256SUMS.txt");
    await fs.writeFile(
      sumsFile,
      `${nativeHash}  ${path.basename(nativeAsset)}\n${projectHash}  ${path.basename(projectAsset)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );

    const releaseArguments = [
      "release",
      "create",
      descriptor.tag,
      nativeAsset,
      nativeChecksum,
      projectAsset,
      projectChecksum,
      sumsFile,
      "--repo",
      inputs.repository,
      "--target",
      inputs.sourceSha,
      "--title",
      descriptor.title,
      "--notes-file",
      path.join(cwd, "docs", "RELEASE_NOTES.md")
    ];
    if (descriptor.prerelease) releaseArguments.push("--prerelease");

    assertCommand(
      await commandRunner("gh", releaseArguments, { cwd, env: environment }),
      `Не удалось создать GitHub Release ${descriptor.tag}`
    );

    const published = assertCommand(
      await commandRunner(
        "gh",
        ["release", "view", descriptor.tag, "--repo", inputs.repository, "--json", "url", "--jq", ".url"],
        { cwd, env: environment }
      ),
      `GitHub Release ${descriptor.tag} создан, но не читается обратно`
    );

    return { published: true, tag: descriptor.tag, url: published };
  } finally {
    await fs.rm(assetDirectory, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  publishGitHubRelease()
    .then((result) => {
      if (result.published) {
        console.log(`Опубликован ${result.tag}: ${result.url}`);
      } else {
        console.log(`Release ${result.tag} уже опубликован и оставлен неизменным: ${result.url}`);
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
