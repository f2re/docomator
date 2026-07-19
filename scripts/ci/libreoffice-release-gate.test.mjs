import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  cp,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LIBREOFFICE_EXAMPLE_CASES,
  loadLibreOfficeExampleCases
} from "./libreoffice-release-gate.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const GATE = path.join(ROOT, "scripts/ci/libreoffice-release-gate.mjs");
const EXPECTED_EXAMPLES = [
  "expected/personal-card-filled.docx",
  "fixtures/header-field.docx",
  "expected/team-register-filled.docx",
  "fixtures/scalar-fields.xlsx",
  "expected/team-register-filled.xlsx"
];
const EXAMPLES_ROOT = path.join(ROOT, "examples");

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

async function corpusFixture() {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "docomator-libreoffice-corpus-")
  );
  const corpusRoot = path.join(temporaryRoot, "examples");
  await cp(EXAMPLES_ROOT, corpusRoot, { recursive: true });
  return { temporaryRoot, corpusRoot };
}

test("LibreOffice corpus has the exact five positive Writer and Calc examples", async () => {
  assert.deepEqual(
    LIBREOFFICE_EXAMPLE_CASES.map((item) => item.relativePath),
    EXPECTED_EXAMPLES
  );
  const loaded = await loadLibreOfficeExampleCases();
  assert.deepEqual(
    loaded.map((item) => item.relativePath),
    EXPECTED_EXAMPLES
  );
  assert.ok(loaded.every((item) => item.input.byteLength > 0));
  assert.ok(
    loaded.every((item) => !item.relativePath.includes("fixtures/rejected/"))
  );
});

test("LibreOffice corpus rejects changed bytes and incomplete manifests", async (t) => {
  await t.test("changed file bytes", async () => {
    const fixture = await corpusFixture();
    try {
      const target = path.join(
        fixture.corpusRoot,
        "expected/personal-card-filled.docx"
      );
      const changed = await readFile(target);
      changed[0] = (changed[0] ?? 0) ^ 0xff;
      await writeFile(target, changed);
      await assert.rejects(
        loadLibreOfficeExampleCases(fixture.corpusRoot),
        /checksum changed/u
      );
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test("missing selected manifest entry", async () => {
    const fixture = await corpusFixture();
    try {
      const manifestPath = path.join(fixture.corpusRoot, "manifest.sha256");
      const manifest = await readFile(manifestPath, "utf8");
      await writeFile(
        manifestPath,
        manifest
          .split("\n")
          .filter((line) => !line.endsWith("fixtures/header-field.docx"))
          .join("\n")
      );
      await assert.rejects(
        loadLibreOfficeExampleCases(fixture.corpusRoot),
        /absent from manifest/u
      );
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });
});

test("LibreOffice corpus rejects duplicate and traversal manifest paths", async (t) => {
  await t.test("duplicate path", async () => {
    const fixture = await corpusFixture();
    try {
      const manifestPath = path.join(fixture.corpusRoot, "manifest.sha256");
      const manifest = await readFile(manifestPath, "utf8");
      const firstEntry = manifest.split("\n")[0];
      assert.ok(firstEntry);
      await writeFile(manifestPath, `${manifest}${firstEntry}\n`);
      await assert.rejects(
        loadLibreOfficeExampleCases(fixture.corpusRoot),
        /duplicate path/u
      );
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test("parent traversal", async () => {
    const fixture = await corpusFixture();
    try {
      const manifestPath = path.join(fixture.corpusRoot, "manifest.sha256");
      const manifest = await readFile(manifestPath, "utf8");
      await writeFile(
        manifestPath,
        `${manifest}${"0".repeat(64)}  ../outside.docx\n`
      );
      await assert.rejects(loadLibreOfficeExampleCases(fixture.corpusRoot));
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });
});

test("LibreOffice corpus rejects symbolic file and directory components", async (t) => {
  await t.test("symbolic file", async () => {
    const fixture = await corpusFixture();
    try {
      const target = path.join(
        fixture.corpusRoot,
        "expected/personal-card-filled.docx"
      );
      await unlink(target);
      await symlink("team-register-filled.docx", target);
      await assert.rejects(
        loadLibreOfficeExampleCases(fixture.corpusRoot),
        /path is symbolic/u
      );
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test("symbolic directory", async () => {
    const fixture = await corpusFixture();
    try {
      const fixturesPath = path.join(fixture.corpusRoot, "fixtures");
      const renamedPath = path.join(fixture.corpusRoot, "fixtures-real");
      await rename(fixturesPath, renamedPath);
      await symlink("fixtures-real", fixturesPath, "dir");
      await assert.rejects(
        loadLibreOfficeExampleCases(fixture.corpusRoot),
        /path is symbolic/u
      );
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });
});

test("LibreOffice gate converts the fixed checksum-verified example set", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "docomator-fake-libreoffice-")
  );
  try {
    const binary = path.join(temporaryRoot, "fake-libreoffice.mjs");
    await writeFile(
      binary,
      `#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--outdir");
const outputDirectory = args[outputIndex + 1];
if (outputIndex < 0 || outputDirectory === undefined) process.exit(2);
await writeFile(path.join(outputDirectory, "input.pdf"), "%PDF-1.4\\n%%EOF\\n");
`,
      { mode: 0o755 }
    );
    await chmod(binary, 0o755);
    const result = await run(process.execPath, [GATE], {
      ...process.env,
      DOCOMATOR_LIBREOFFICE_BIN: binary,
      DOCOMATOR_REQUIRE_LIBREOFFICE: "1"
    });
    assert.equal(
      result.code,
      0,
      `Gate failed with ${result.signal ?? "no signal"}:\n${result.stderr}`
    );
    for (const relativePath of EXPECTED_EXAMPLES) {
      assert.ok(result.stdout.includes(relativePath));
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
