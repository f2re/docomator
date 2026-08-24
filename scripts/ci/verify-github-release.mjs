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
const HASH = /^[a-f0-9]{64}$/u;
const CHECKSUM_LINE = /^([a-f0-9]{64})\s+\*?([^\r\n]+)$/u;
const INSPECT_PROJECT_PY = String.raw`import hashlib,json,sys,zipfile
archive=sys.argv[1]
with zipfile.ZipFile(archive, "r") as z:
    manifest=json.loads(z.read("f2re-service.json").decode("utf-8"))
    payload=manifest.get("payload", {}).get("path")
    if not isinstance(payload, str):
        raise SystemExit("payload.path is missing")
    h=hashlib.sha256()
    size=0
    with z.open(payload, "r") as source:
        while True:
            chunk=source.read(1024*1024)
            if not chunk:
                break
            h.update(chunk)
            size += len(chunk)
print(json.dumps({"manifest":manifest,"payloadSha256":h.hexdigest(),"payloadSize":size}, separators=(",",":")))`;

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
  const { version, status, channel } = parsed ?? {};
  if (typeof version !== "string" || !SEMVER.test(version)) {
    fail("RELEASE_IDENTITY.json.version должен быть точным SemVer X.Y.Z.");
  }
  const pair = `${status}/${channel}`;
  if (pair !== "candidate/pilot" && pair !== "stable/production") {
    fail("Проверка GitHub Release разрешена только для candidate/pilot или stable/production.");
  }
  return { version, status, channel };
}

export function releaseDescriptor(identity) {
  return identity.status === "candidate"
    ? { tag: `v${identity.version}-candidate`, prerelease: true }
    : { tag: `v${identity.version}`, prerelease: false };
}

function nativePattern(version) {
  const escaped = version.replaceAll(".", "\\.");
  return new RegExp(`^docomator-${escaped}-linux-(?:x64|arm64)\\.tar\\.gz$`, "u");
}

export function validateReleaseMetadata(metadata, identity) {
  const descriptor = releaseDescriptor(identity);
  if (metadata?.tagName !== descriptor.tag) {
    fail(`GitHub Release имеет tag ${metadata?.tagName ?? "<missing>"}, ожидался ${descriptor.tag}.`);
  }
  if (metadata?.isDraft !== false) {
    fail(`GitHub Release ${descriptor.tag} не опубликован: isDraft должен быть false.`);
  }
  if (metadata?.isPrerelease !== descriptor.prerelease) {
    fail(`GitHub Release ${descriptor.tag} имеет неверный prerelease-флаг.`);
  }
  if (typeof metadata?.targetCommitish !== "string" || !SHA.test(metadata.targetCommitish)) {
    fail(`GitHub Release ${descriptor.tag} должен быть привязан к точному 40-символьному commit SHA.`);
  }
  if (typeof metadata?.url !== "string" || !metadata.url.startsWith("https://github.com/")) {
    fail(`GitHub Release ${descriptor.tag} не содержит канонический URL.`);
  }
  if (!Array.isArray(metadata?.assets)) {
    fail(`GitHub Release ${descriptor.tag} не содержит список assets.`);
  }

  const names = [];
  const sizes = new Map();
  for (const asset of metadata.assets) {
    if (typeof asset?.name !== "string" || asset.name.length === 0) {
      fail(`GitHub Release ${descriptor.tag} содержит asset без имени.`);
    }
    if (!Number.isSafeInteger(asset?.size) || asset.size <= 0) {
      fail(`GitHub Release ${descriptor.tag}: asset ${asset.name} имеет некорректный размер.`);
    }
    if (sizes.has(asset.name)) {
      fail(`GitHub Release ${descriptor.tag} содержит дублирующий asset ${asset.name}.`);
    }
    names.push(asset.name);
    sizes.set(asset.name, asset.size);
  }

  const projectName = `docomator-${identity.version}-project-control.f2re.zip`;
  const projectChecksumName = `${projectName}.sha256`;
  const nativeNames = names.filter((name) => nativePattern(identity.version).test(name));
  if (nativeNames.length !== 1) {
    fail(`GitHub Release ${descriptor.tag} должен содержать ровно один native Linux bundle.`);
  }
  const nativeName = nativeNames[0];
  const nativeChecksumName = `${nativeName}.sha256`;
  const expected = new Set([
    nativeName,
    nativeChecksumName,
    projectName,
    projectChecksumName,
    "SHA256SUMS.txt"
  ]);
  if (names.length !== expected.size || names.some((name) => !expected.has(name))) {
    fail(
      `GitHub Release ${descriptor.tag} имеет неверный набор assets: ${names.sort().join(", ") || "нет"}.`
    );
  }

  return {
    ...descriptor,
    url: metadata.url,
    sourceCommit: metadata.targetCommitish,
    nativeName,
    nativeChecksumName,
    projectName,
    projectChecksumName,
    sizes
  };
}

export function parseChecksumDocument(source, expectedNames) {
  const lines = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const values = new Map();
  for (const line of lines) {
    const match = CHECKSUM_LINE.exec(line);
    if (!match) fail(`Некорректная строка SHA-256: ${line}`);
    const [, hash, name] = match;
    if (values.has(name)) fail(`Дублирующая строка SHA-256 для ${name}.`);
    values.set(name, hash);
  }
  const expected = new Set(expectedNames);
  if (values.size !== expected.size || [...values.keys()].some((name) => !expected.has(name))) {
    fail(`SHA-256 документ содержит неверный набор файлов: ${[...values.keys()].sort().join(", ") || "нет"}.`);
  }
  return values;
}

async function defaultCommandRunner(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024
    });
    return { code: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (error) {
    return {
      code: typeof error?.code === "number" ? error.code : 1,
      stdout: typeof error?.stdout === "string" ? error.stdout : "",
      stderr: typeof error?.stderr === "string" ? error.stderr : String(error)
    };
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

async function assertRegularFile(filePath, expectedSize) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`Release asset должен быть обычным файлом: ${path.basename(filePath)}.`);
  }
  if (stat.size !== expectedSize) {
    fail(`Размер ${path.basename(filePath)} не совпадает с GitHub Release metadata.`);
  }
  return stat;
}

async function verifySingleChecksum(assetPath, checksumPath) {
  const expected = parseChecksumDocument(await fs.readFile(checksumPath, "utf8"), [path.basename(assetPath)]);
  const actual = await sha256(assetPath);
  if (actual !== expected.get(path.basename(assetPath))) {
    fail(`SHA-256 не совпадает для ${path.basename(assetPath)}.`);
  }
  return actual;
}

async function inspectProjectPackage(projectPath, commandRunner, cwd, environment) {
  const result = await commandRunner(
    "python3",
    ["-c", INSPECT_PROJECT_PY, projectPath],
    { cwd, env: environment }
  );
  const source = assertCommand(result, "Не удалось проверить Project Control package");
  try {
    return JSON.parse(source);
  } catch {
    fail("Проверка Project Control package вернула некорректный JSON.");
  }
}

export async function verifyPublishedRelease({
  cwd = process.cwd(),
  environment = process.env,
  commandRunner = defaultCommandRunner,
  makeTempDirectory = async () => fs.mkdtemp(path.join(os.tmpdir(), "docomator-release-verify-"))
} = {}) {
  const repository = environment.GITHUB_REPOSITORY ?? "";
  if (!REPOSITORY.test(repository)) fail("GITHUB_REPOSITORY должен иметь вид owner/repository.");
  if (!environment.GH_TOKEN) fail("GH_TOKEN обязателен для проверки GitHub Release.");

  const identity = parseReleaseIdentity(
    await fs.readFile(path.join(cwd, "RELEASE_IDENTITY.json"), "utf8")
  );
  const descriptor = releaseDescriptor(identity);
  const view = assertCommand(
    await commandRunner(
      "gh",
      [
        "release",
        "view",
        descriptor.tag,
        "--repo",
        repository,
        "--json",
        "url,tagName,isDraft,isPrerelease,targetCommitish,assets"
      ],
      { cwd, env: environment }
    ),
    `Не удалось прочитать GitHub Release ${descriptor.tag}`
  );
  let metadata;
  try {
    metadata = JSON.parse(view);
  } catch {
    fail(`GitHub Release ${descriptor.tag} вернул некорректный JSON.`);
  }
  const release = validateReleaseMetadata(metadata, identity);

  const directory = await makeTempDirectory();
  try {
    assertCommand(
      await commandRunner(
        "gh",
        ["release", "download", release.tag, "--repo", repository, "--dir", directory],
        { cwd, env: environment }
      ),
      `Не удалось скачать assets GitHub Release ${release.tag}`
    );

    const downloaded = (await fs.readdir(directory)).sort();
    const expectedNames = [...release.sizes.keys()].sort();
    if (
      downloaded.length !== expectedNames.length ||
      downloaded.some((name, index) => name !== expectedNames[index])
    ) {
      fail(`Скачан неверный набор release assets: ${downloaded.join(", ") || "нет"}.`);
    }

    for (const [name, size] of release.sizes) {
      await assertRegularFile(path.join(directory, name), size);
    }

    const nativePath = path.join(directory, release.nativeName);
    const nativeChecksumPath = path.join(directory, release.nativeChecksumName);
    const projectPath = path.join(directory, release.projectName);
    const projectChecksumPath = path.join(directory, release.projectChecksumName);
    const nativeHash = await verifySingleChecksum(nativePath, nativeChecksumPath);
    const projectHash = await verifySingleChecksum(projectPath, projectChecksumPath);

    const sums = parseChecksumDocument(
      await fs.readFile(path.join(directory, "SHA256SUMS.txt"), "utf8"),
      [release.nativeName, release.projectName]
    );
    if (sums.get(release.nativeName) !== nativeHash || sums.get(release.projectName) !== projectHash) {
      fail("SHA256SUMS.txt не совпадает с фактическими release assets.");
    }

    const inspected = await inspectProjectPackage(projectPath, commandRunner, cwd, environment);
    const manifest = inspected?.manifest;
    if (
      manifest?.schema !== "f2re-managed-service/v1" ||
      manifest?.controllerApi !== 1 ||
      manifest?.projectId !== "docomator" ||
      manifest?.adapter !== "docomator-v1" ||
      manifest?.nativeBundleFormat !== "docomator-offline-v2" ||
      manifest?.version !== identity.version ||
      manifest?.sourceCommit !== release.sourceCommit
    ) {
      fail("f2re-service.json не совпадает с GitHub Release identity/target commit.");
    }
    if (
      manifest?.payload?.path !== `payload/${release.nativeName}` ||
      manifest?.payload?.sha256 !== nativeHash ||
      manifest?.payload?.size !== release.sizes.get(release.nativeName) ||
      inspected?.payloadSha256 !== nativeHash ||
      inspected?.payloadSize !== release.sizes.get(release.nativeName)
    ) {
      fail("Native payload внутри Project Control package не совпадает с опубликованным native asset.");
    }
    if (!HASH.test(nativeHash) || !HASH.test(projectHash)) {
      fail("Release assets имеют некорректный SHA-256.");
    }

    return {
      tag: release.tag,
      url: release.url,
      sourceCommit: release.sourceCommit,
      assets: expectedNames,
      nativeHash,
      projectHash
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  verifyPublishedRelease()
    .then((result) => {
      console.log(`Проверен GitHub Release ${result.tag}: ${result.url}`);
      console.log(`Release source commit: ${result.sourceCommit}`);
      console.log(`Assets (${result.assets.length}): ${result.assets.join(", ")}`);
      console.log(`Native SHA-256: ${result.nativeHash}`);
      console.log(`Project Control SHA-256: ${result.projectHash}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
