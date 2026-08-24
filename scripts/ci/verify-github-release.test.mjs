import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseChecksumDocument,
  parseReleaseIdentity,
  releaseDescriptor,
  validateReleaseMetadata,
  verifyPublishedRelease
} from "./verify-github-release.mjs";

const version = "0.6.5";
const sourceCommit = "7ab135529fbf2967fc4c7d470d809768b5957193";
const identity = { version, status: "candidate", channel: "pilot" };
const nativeName = `docomator-${version}-linux-x64.tar.gz`;
const projectName = `docomator-${version}-project-control.f2re.zip`;

function hash(data) {
  return createHash("sha256").update(data).digest("hex");
}

function metadata(overrides = {}) {
  return {
    url: `https://github.com/f2re/docomator/releases/tag/v${version}-candidate`,
    tagName: `v${version}-candidate`,
    isDraft: false,
    isPrerelease: false,
    targetCommitish: sourceCommit,
    assets: [
      { name: nativeName, size: 12 },
      { name: `${nativeName}.sha256`, size: 90 },
      { name: projectName, size: 14 },
      { name: `${projectName}.sha256`, size: 100 },
      { name: "SHA256SUMS.txt", size: 180 }
    ],
    ...overrides
  };
}

test("release identity отделяет product SemVer от maturity, но candidate остаётся видимым release", () => {
  assert.deepEqual(
    parseReleaseIdentity(
      '{"version":"0.6.5","status":"candidate","channel":"pilot"}'
    ),
    identity
  );
  assert.deepEqual(releaseDescriptor(identity), {
    tag: "v0.6.5-candidate",
    prerelease: false
  });
  assert.deepEqual(
    releaseDescriptor({ version: "1.2.3", status: "stable", channel: "production" }),
    { tag: "v1.2.3", prerelease: false }
  );
});

test("принимает опубликованный exact candidate с пятью ожидаемыми assets", () => {
  const result = validateReleaseMetadata(metadata(), identity);
  assert.equal(result.tag, "v0.6.5-candidate");
  assert.equal(result.sourceCommit, sourceCommit);
  assert.equal(result.nativeName, nativeName);
  assert.equal(result.projectName, projectName);
  assert.equal(result.sizes.size, 5);
});

test("draft и GitHub prerelease не считаются готовыми к очевидному скачиванию", () => {
  assert.throws(
    () => validateReleaseMetadata(metadata({ isDraft: true }), identity),
    /не опубликован/u
  );
  assert.throws(
    () => validateReleaseMetadata(metadata({ isPrerelease: true }), identity),
    /скрыт как GitHub Pre-release/u
  );
});

test("лишний или отсутствующий release asset блокирует проверку", () => {
  const withExtra = metadata();
  withExtra.assets = [...withExtra.assets, { name: "unexpected.bin", size: 1 }];
  assert.throws(
    () => validateReleaseMetadata(withExtra, identity),
    /неверный набор assets/u
  );
  const missing = metadata();
  missing.assets = missing.assets.filter((asset) => asset.name !== "SHA256SUMS.txt");
  assert.throws(
    () => validateReleaseMetadata(missing, identity),
    /неверный набор assets/u
  );
});

test("SHA-256 документ обязан перечислять ровно ожидаемые файлы", () => {
  const one = "a".repeat(64);
  const two = "b".repeat(64);
  const parsed = parseChecksumDocument(
    `${one}  ${nativeName}\n${two}  ${projectName}\n`,
    [nativeName, projectName]
  );
  assert.equal(parsed.get(nativeName), one);
  assert.equal(parsed.get(projectName), two);
  assert.throws(
    () => parseChecksumDocument(`${one}  other.bin\n`, [nativeName]),
    /неверный набор файлов/u
  );
});

test("end-to-end verifier скачивает release и сверяет оба bundle по байтам и manifest", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "docomator-release-verifier-test-")
  );
  await fs.writeFile(
    path.join(root, "RELEASE_IDENTITY.json"),
    `${JSON.stringify(identity, null, 2)}\n`
  );

  const nativeData = Buffer.from("native-bytes");
  const projectData = Buffer.from("project-bytes!");
  const nativeHash = hash(nativeData);
  const projectHash = hash(projectData);
  const nativeChecksum = `${nativeHash}  ${nativeName}\n`;
  const projectChecksum = `${projectHash}  ${projectName}\n`;
  const sums = `${nativeHash}  ${nativeName}\n${projectHash}  ${projectName}\n`;
  const releaseMetadata = metadata({
    assets: [
      { name: nativeName, size: nativeData.length },
      { name: `${nativeName}.sha256`, size: Buffer.byteLength(nativeChecksum) },
      { name: projectName, size: projectData.length },
      { name: `${projectName}.sha256`, size: Buffer.byteLength(projectChecksum) },
      { name: "SHA256SUMS.txt", size: Buffer.byteLength(sums) }
    ]
  });
  const calls = [];
  const commandRunner = async (command, args) => {
    calls.push([command, ...args]);
    if (command === "gh" && args[0] === "release" && args[1] === "view") {
      return { code: 0, stdout: JSON.stringify(releaseMetadata), stderr: "" };
    }
    if (command === "gh" && args[0] === "release" && args[1] === "download") {
      const directory = args[args.indexOf("--dir") + 1];
      await fs.writeFile(path.join(directory, nativeName), nativeData);
      await fs.writeFile(path.join(directory, `${nativeName}.sha256`), nativeChecksum);
      await fs.writeFile(path.join(directory, projectName), projectData);
      await fs.writeFile(path.join(directory, `${projectName}.sha256`), projectChecksum);
      await fs.writeFile(path.join(directory, "SHA256SUMS.txt"), sums);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (command === "python3") {
      return {
        code: 0,
        stdout: JSON.stringify({
          manifest: {
            schema: "f2re-managed-service/v1",
            controllerApi: 1,
            projectId: "docomator",
            adapter: "docomator-v1",
            nativeBundleFormat: "docomator-offline-v2",
            version,
            sourceCommit,
            payload: {
              path: `payload/${nativeName}`,
              sha256: nativeHash,
              size: nativeData.length
            }
          },
          payloadSha256: nativeHash,
          payloadSize: nativeData.length
        }),
        stderr: ""
      };
    }
    return {
      code: 99,
      stdout: "",
      stderr: `unexpected ${command} ${args.join(" ")}`
    };
  };

  const result = await verifyPublishedRelease({
    cwd: root,
    environment: {
      GITHUB_REPOSITORY: "f2re/docomator",
      GH_TOKEN: "test-token"
    },
    commandRunner
  });

  assert.equal(result.tag, "v0.6.5-candidate");
  assert.equal(result.sourceCommit, sourceCommit);
  assert.equal(result.nativeHash, nativeHash);
  assert.equal(result.projectHash, projectHash);
  assert.equal(result.assets.length, 5);
  assert.ok(
    calls.some(
      (call) => call[0] === "gh" && call[1] === "release" && call[2] === "download"
    )
  );
  await fs.rm(root, { recursive: true, force: true });
});
