import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseReleaseIdentity,
  publishGitHubRelease,
  releaseDescriptor,
  verifyChecksum
} from "./publish-github-release.mjs";

const sourceSha = "a".repeat(40);
const orphanSha = "b".repeat(40);
const repository = "f2re/docomator";
const runId = "12345";
const orphanRunId = 777;

function hash(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function fixture(identity = { version: "0.6.5", status: "candidate", channel: "pilot" }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-release-test-"));
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.writeFile(
    path.join(root, "RELEASE_IDENTITY.json"),
    `${JSON.stringify(identity, null, 2)}\n`
  );
  await fs.writeFile(path.join(root, "VERSION"), `${identity.version}\n`);
  await fs.writeFile(path.join(root, "docs", "RELEASE_NOTES.md"), "# Release notes\n");
  return root;
}

function environment() {
  return {
    GITHUB_REPOSITORY: repository,
    DOCOMATOR_SOURCE_SHA: sourceSha,
    DOCOMATOR_WORKFLOW_RUN_ID: runId,
    GH_TOKEN: "test-token"
  };
}

function fakeRunner(
  calls,
  {
    releaseExists = false,
    releasePrerelease = false,
    releaseTarget = sourceSha,
    orphanTag = false,
    badChecksum = false
  } = {}
) {
  let created = false;
  let metadata = releaseExists
    ? {
        url: "https://github.com/f2re/docomator/releases/tag/v0.6.5-candidate",
        databaseId: 4242,
        tagName: "v0.6.5-candidate",
        isDraft: false,
        isPrerelease: releasePrerelease,
        targetCommitish: releaseTarget
      }
    : null;
  const nativeData = Buffer.from("offline-bundle");
  const nativeHash = hash(nativeData);

  return async (command, args) => {
    calls.push([command, ...args]);

    if (command === "git" && args[0] === "rev-parse") {
      return { code: 0, stdout: `${sourceSha}\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "ls-remote") {
      if (releaseExists || orphanTag) {
        return {
          code: 0,
          stdout: `${orphanTag ? orphanSha : releaseTarget}\trefs/tags/v0.6.5-candidate\n`,
          stderr: ""
        };
      }
      return { code: 2, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "fetch") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "rev-list") {
      return {
        code: 0,
        stdout: `${orphanTag ? orphanSha : releaseTarget}\n`,
        stderr: ""
      };
    }
    if (command === "git" && args[0] === "show") {
      const spec = args[1];
      if (spec === `${orphanSha}:RELEASE_IDENTITY.json`) {
        return {
          code: 0,
          stdout: '{"version":"0.6.5","status":"candidate","channel":"pilot"}\n',
          stderr: ""
        };
      }
      if (spec === `${orphanSha}:VERSION`) {
        return { code: 0, stdout: "0.6.5\n", stderr: "" };
      }
      if (spec === `${orphanSha}:docs/RELEASE_NOTES.md`) {
        return { code: 0, stdout: "# Historical release notes\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: `unexpected git show ${spec}` };
    }

    if (command === "gh" && args[0] === "release" && args[1] === "view") {
      if (metadata || created) {
        return { code: 0, stdout: `${JSON.stringify(metadata)}\n`, stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "HTTP 404: Not Found" };
    }
    if (command === "gh" && args[0] === "repo" && args[1] === "view") {
      return { code: 0, stdout: "main\n", stderr: "" };
    }
    if (command === "gh" && args[0] === "run" && args[1] === "list") {
      return {
        code: 0,
        stdout: `${JSON.stringify([
          {
            databaseId: orphanRunId,
            headSha: orphanSha,
            conclusion: "success",
            event: "push",
            headBranch: "main"
          }
        ])}\n`,
        stderr: ""
      };
    }
    if (command === "gh" && args[0] === "run" && args[1] === "download") {
      const directory = args[args.indexOf("--dir") + 1];
      const file = path.join(directory, "docomator-0.6.5-project-control.f2re.zip");
      const data = Buffer.from("project-control");
      await fs.writeFile(file, data);
      const expected = badChecksum ? "0".repeat(64) : hash(data);
      await fs.writeFile(`${file}.sha256`, `${expected}  ${path.basename(file)}\n`);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (command === "gh" && args[0] === "api" && args[1] === "--method") {
      const targetArg = args.find((value) => String(value).startsWith("target_commitish="));
      metadata = {
        ...(metadata ?? {}),
        url:
          metadata?.url ??
          "https://github.com/f2re/docomator/releases/tag/v0.6.5-candidate",
        databaseId: metadata?.databaseId ?? 4242,
        tagName: "v0.6.5-candidate",
        isDraft: false,
        isPrerelease: false,
        targetCommitish: targetArg
          ? targetArg.slice("target_commitish=".length)
          : metadata?.targetCommitish
      };
      return { code: 0, stdout: `${JSON.stringify(metadata)}\n`, stderr: "" };
    }

    if (command === "python3" && args[0] === "-c") {
      if (args.at(-1) === "f2re-service.json") {
        const downloadedRun = calls
          .filter((call) => call[0] === "gh" && call[1] === "run" && call[2] === "download")
          .at(-1)?.[3];
        const manifestSha =
          String(downloadedRun) === String(orphanRunId) ? orphanSha : sourceSha;
        return {
          code: 0,
          stdout: JSON.stringify({
            schema: "f2re-managed-service/v1",
            controllerApi: 1,
            projectId: "docomator",
            adapter: "docomator-v1",
            version: "0.6.5",
            sourceCommit: manifestSha,
            nativeBundleFormat: "docomator-offline-v2",
            payload: {
              path: "payload/docomator-0.6.5-linux-x64.tar.gz",
              sha256: nativeHash,
              size: nativeData.length
            }
          }),
          stderr: ""
        };
      }
      const destination = args.at(-1);
      await fs.writeFile(destination, nativeData, { flag: "wx" });
      return { code: 0, stdout: "", stderr: "" };
    }

    if (command === "gh" && args[0] === "release" && args[1] === "create") {
      const target = args[args.indexOf("--target") + 1];
      created = true;
      metadata = {
        url: "https://github.com/f2re/docomator/releases/tag/v0.6.5-candidate",
        databaseId: 4242,
        tagName: "v0.6.5-candidate",
        isDraft: false,
        isPrerelease: false,
        targetCommitish: target
      };
      return { code: 0, stdout: "", stderr: "" };
    }

    return {
      code: 99,
      stdout: "",
      stderr: `unexpected command: ${command} ${args.join(" ")}`
    };
  };
}

test("candidate получает отдельный видимый release tag без GitHub prerelease-флага", () => {
  const identity = parseReleaseIdentity(
    '{"version":"0.6.5","status":"candidate","channel":"pilot"}'
  );
  assert.deepEqual(releaseDescriptor(identity), {
    tag: "v0.6.5-candidate",
    title: "Оформлятор 0.6.5 — кандидат · pilot",
    prerelease: false
  });
});

test("stable использует канонический vX.Y.Z tag", () => {
  const identity = parseReleaseIdentity(
    '{"version":"1.2.3","status":"stable","channel":"production"}'
  );
  assert.deepEqual(releaseDescriptor(identity), {
    tag: "v1.2.3",
    title: "Оформлятор 1.2.3",
    prerelease: false
  });
});

test("отклоняет несогласованную зрелость release identity", () => {
  assert.throws(
    () =>
      parseReleaseIdentity(
        '{"version":"0.6.5","status":"stable","channel":"pilot"}'
      ),
    /candidate\/pilot или stable\/production/u
  );
});

test("проверяет внешний checksum до публикации", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-checksum-test-"));
  const asset = path.join(root, "asset.bin");
  const checksum = `${asset}.sha256`;
  await fs.writeFile(asset, "ok");
  await fs.writeFile(checksum, `${hash(Buffer.from("ok"))}  asset.bin\n`);
  await assert.doesNotReject(verifyChecksum(asset, checksum));
  await fs.writeFile(asset, "changed");
  await assert.rejects(verifyChecksum(asset, checksum), /SHA-256 не совпадает/u);
  await fs.rm(root, { recursive: true, force: true });
});

test("публикует новый candidate из exact CI artifact как видимый GitHub Release", async () => {
  const root = await fixture();
  const calls = [];
  const result = await publishGitHubRelease({
    cwd: root,
    environment: environment(),
    commandRunner: fakeRunner(calls)
  });

  assert.equal(result.published, true);
  assert.equal(result.tag, "v0.6.5-candidate");
  assert.equal(result.sourceSha, sourceSha);
  const create = calls.find(
    (call) => call[0] === "gh" && call[1] === "release" && call[2] === "create"
  );
  assert.ok(create);
  assert.equal(create.includes("--prerelease"), false);
  assert.ok(create.includes(sourceSha));
  assert.ok(
    calls.some((call) => call.includes(`docomator-project-control-${sourceSha}`))
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("существующий prerelease переводит в видимый release без пересборки assets", async () => {
  const root = await fixture();
  const calls = [];
  const result = await publishGitHubRelease({
    cwd: root,
    environment: environment(),
    commandRunner: fakeRunner(calls, {
      releaseExists: true,
      releasePrerelease: true,
      releaseTarget: orphanSha
    })
  });

  assert.equal(result.published, false);
  assert.equal(result.reason, "already-published-visible");
  assert.ok(calls.some((call) => call[0] === "gh" && call[1] === "api"));
  assert.equal(calls.some((call) => call[0] === "gh" && call[1] === "run"), false);
  assert.equal(
    calls.some(
      (call) => call[0] === "gh" && call[1] === "release" && call[2] === "create"
    ),
    false
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("восстанавливает Release для существующего orphan tag из exact исторического push-CI", async () => {
  const root = await fixture();
  const calls = [];
  const result = await publishGitHubRelease({
    cwd: root,
    environment: environment(),
    commandRunner: fakeRunner(calls, { orphanTag: true })
  });

  assert.equal(result.published, true);
  assert.equal(result.sourceSha, orphanSha);
  const download = calls.find(
    (call) => call[0] === "gh" && call[1] === "run" && call[2] === "download"
  );
  assert.equal(String(download?.[3]), String(orphanRunId));
  assert.ok(download?.includes(`docomator-project-control-${orphanSha}`));
  const create = calls.find(
    (call) => call[0] === "gh" && call[1] === "release" && call[2] === "create"
  );
  assert.ok(create?.includes("--verify-tag"));
  assert.equal(create?.[create.indexOf("--target") + 1], orphanSha);
  assert.equal(create?.includes("--prerelease"), false);
  await fs.rm(root, { recursive: true, force: true });
});

test("checksum mismatch блокирует release до gh release create", async () => {
  const root = await fixture();
  const calls = [];
  await assert.rejects(
    publishGitHubRelease({
      cwd: root,
      environment: environment(),
      commandRunner: fakeRunner(calls, { badChecksum: true })
    }),
    /SHA-256 не совпадает/u
  );
  assert.equal(
    calls.some(
      (call) => call[0] === "gh" && call[1] === "release" && call[2] === "create"
    ),
    false
  );
  await fs.rm(root, { recursive: true, force: true });
});
