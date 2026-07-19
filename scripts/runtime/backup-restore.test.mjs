import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { promisify } from "node:util";

import { createBackup, restoreBackup, verifyBackup } from "./backup-lib.mjs";

const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-backup-"));
  const dataDirectory = path.join(root, "data");
  const configFile = path.join(root, "etc", "docomator.env");
  await fs.mkdir(path.join(dataDirectory, "objects", "ab", "cd"), { recursive: true });
  await fs.mkdir(path.dirname(configFile), { recursive: true });

  const database = new DatabaseSync(path.join(dataDirectory, "docomator.db"));
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO records(value) VALUES ('original');
  `);
  database.close();
  await fs.writeFile(path.join(dataDirectory, "objects", "ab", "cd", "object"), "original-object");
  await fs.writeFile(configFile, "DOCOMATOR_VERSION=test\n");
  return { root, dataDirectory, configFile };
}

async function checksumLines(backupDirectory) {
  return (await fs.readFile(path.join(backupDirectory, "manifest.sha256"), "utf8"))
    .trimEnd()
    .split("\n");
}

async function writeChecksumLines(backupDirectory, lines) {
  await fs.writeFile(
    path.join(backupDirectory, "manifest.sha256"),
    `${lines.join("\n")}\n`
  );
}

async function rewriteManifest(backupDirectory, transform) {
  const manifestPath = path.join(backupDirectory, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const transformed = transform(manifest);
  const nextManifest = transformed === undefined ? manifest : transformed;
  const content = `${JSON.stringify(nextManifest, null, 2)}\n`;
  await fs.writeFile(manifestPath, content);
  const checksum = crypto.createHash("sha256").update(content).digest("hex");
  const lines = await checksumLines(backupDirectory);
  await writeChecksumLines(
    backupDirectory,
    lines.map((line) => line.endsWith("  manifest.json")
      ? `${checksum}  manifest.json`
      : line)
  );
}

async function installUncheckpointedWalUpdate(databasePath, value) {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    UPDATE records SET value = '${value.replaceAll("'", "''")}';
  `);
  const snapshot = {
    database: await fs.readFile(databasePath),
    wal: await fs.readFile(`${databasePath}-wal`),
    shm: await fs.readFile(`${databasePath}-shm`)
  };
  database.close();
  await fs.writeFile(databasePath, snapshot.database);
  await fs.writeFile(`${databasePath}-wal`, snapshot.wal);
  await fs.writeFile(`${databasePath}-shm`, snapshot.shm);
}

test("backup is verifiable and restore replaces database, objects, and config", async () => {
  const current = await fixture();
  try {
    const backup = await createBackup({
      dataDirectory: current.dataDirectory,
      configFile: current.configFile,
      releaseVersion: "test"
    });
    const manifest = await verifyBackup(backup.directory);
    assert.equal(manifest.objects.count, 1);

    const database = new DatabaseSync(path.join(current.dataDirectory, "docomator.db"));
    database.exec("UPDATE records SET value = 'mutated'");
    database.close();
    await fs.writeFile(
      path.join(current.dataDirectory, "objects", "ab", "cd", "object"),
      "mutated-object"
    );
    await fs.writeFile(current.configFile, "DOCOMATOR_VERSION=mutated\n");

    await restoreBackup({
      backupDirectory: backup.directory,
      dataDirectory: current.dataDirectory,
      configFile: current.configFile
    });

    const restored = new DatabaseSync(path.join(current.dataDirectory, "docomator.db"));
    assert.equal(restored.prepare("SELECT value FROM records").get().value, "original");
    restored.close();
    assert.equal(
      await fs.readFile(
        path.join(current.dataDirectory, "objects", "ab", "cd", "object"),
        "utf8"
      ),
      "original-object"
    );
    assert.equal(await fs.readFile(current.configFile, "utf8"), "DOCOMATOR_VERSION=test\n");
  } finally {
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("verification detects modified backup files", async () => {
  const current = await fixture();
  try {
    const backup = await createBackup({ dataDirectory: current.dataDirectory });
    await fs.writeFile(
      path.join(backup.directory, "objects", "ab", "cd", "object"),
      "tampered"
    );
    await assert.rejects(() => verifyBackup(backup.directory), /checksum mismatch/);
  } finally {
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("verification rejects a tampered file omitted from checksum inventory", async () => {
  const current = await fixture();
  try {
    const backup = await createBackup({ dataDirectory: current.dataDirectory });
    const lines = await checksumLines(backup.directory);
    await writeChecksumLines(
      backup.directory,
      lines.filter((line) => !line.endsWith("  objects/ab/cd/object"))
    );
    await fs.writeFile(
      path.join(backup.directory, "objects", "ab", "cd", "object"),
      "tampered"
    );

    await assert.rejects(
      () => verifyBackup(backup.directory),
      /checksum inventory mismatch.*objects\/ab\/cd\/object/
    );
  } finally {
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("verification rejects unlisted files and duplicate checksum entries", async () => {
  const current = await fixture();
  try {
    const backup = await createBackup({ dataDirectory: current.dataDirectory });
    await fs.writeFile(path.join(backup.directory, "objects", "extra"), "extra");
    await assert.rejects(
      () => verifyBackup(backup.directory),
      /checksum inventory mismatch.*objects\/extra/
    );

    await fs.rm(path.join(backup.directory, "objects", "extra"));
    const lines = await checksumLines(backup.directory);
    await writeChecksumLines(backup.directory, [...lines, lines[0]]);
    await assert.rejects(
      () => verifyBackup(backup.directory),
      /Duplicate backup checksum entry/
    );
  } finally {
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("verification rejects a listed file that is missing", async () => {
  const current = await fixture();
  try {
    const backup = await createBackup({ dataDirectory: current.dataDirectory });
    await fs.rm(path.join(backup.directory, "objects", "ab", "cd", "object"));
    await assert.rejects(
      () => verifyBackup(backup.directory),
      /checksum inventory mismatch.*without file \[objects\/ab\/cd\/object\]/
    );
  } finally {
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("verification rejects non-canonical manifest paths", async () => {
  const current = await fixture();
  try {
    const backup = await createBackup({ dataDirectory: current.dataDirectory });
    const lines = await checksumLines(backup.directory);
    await writeChecksumLines(
      backup.directory,
      lines.map((line) => line.endsWith("  manifest.json")
        ? line.replace("  manifest.json", "  ./manifest.json")
        : line)
    );
    await assert.rejects(() => verifyBackup(backup.directory), /Unsafe backup path/);
  } finally {
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("verification rejects symbolic links and special filesystem entries", { timeout: 2_000 }, async () => {
  const current = await fixture();
  try {
    const backup = await createBackup({ dataDirectory: current.dataDirectory });
    const symbolicLink = path.join(backup.directory, "objects", "link");
    await fs.symlink("ab/cd/object", symbolicLink);
    await assert.rejects(() => verifyBackup(backup.directory), /Symbolic links are not allowed/);
    await fs.rm(symbolicLink);

    const fifoPath = path.join(backup.directory, "objects", "fifo");
    await execFileAsync("mkfifo", [fifoPath]);
    await assert.rejects(
      () => verifyBackup(backup.directory),
      /Unsupported filesystem entry/
    );
  } finally {
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("verification rejects listed symbolic links and symbolic-link parents", async () => {
  const current = await fixture();
  try {
    const backup = await createBackup({
      dataDirectory: current.dataDirectory,
      configFile: current.configFile
    });
    const objectPath = path.join(backup.directory, "objects", "ab", "cd", "object");
    const externalFile = path.join(current.root, "external-object");
    await fs.writeFile(externalFile, "original-object");
    await fs.rm(objectPath);
    await fs.symlink(externalFile, objectPath);
    await assert.rejects(() => verifyBackup(backup.directory), /Symbolic links are not allowed/);

    await fs.rm(objectPath);
    await fs.writeFile(objectPath, "original-object");
    const externalParent = path.join(current.root, "external-parent");
    await fs.mkdir(path.join(externalParent, "cd"), { recursive: true });
    await fs.writeFile(path.join(externalParent, "cd", "object"), "original-object");
    await fs.rm(path.join(backup.directory, "objects", "ab"), { recursive: true });
    await fs.symlink(externalParent, path.join(backup.directory, "objects", "ab"));
    await assert.rejects(() => verifyBackup(backup.directory), /Symbolic links are not allowed/);
  } finally {
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("verification rejects a symbolic link used as the backup root", async () => {
  const current = await fixture();
  try {
    const backup = await createBackup({ dataDirectory: current.dataDirectory });
    const backupLink = path.join(current.root, "backup-link");
    await fs.symlink(backup.directory, backupLink);
    await assert.rejects(() => verifyBackup(backupLink), /Symbolic links are not allowed/);
  } finally {
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("verification validates manifest object count and database size", async () => {
  const current = await fixture();
  try {
    const backup = await createBackup({ dataDirectory: current.dataDirectory });
    await rewriteManifest(backup.directory, (manifest) => {
      manifest.objects.count += 1;
    });
    await assert.rejects(() => verifyBackup(backup.directory), /object count mismatch/);

    await rewriteManifest(backup.directory, (manifest) => {
      manifest.objects.count -= 1;
      manifest.database.sizeBytes += 1;
    });
    await assert.rejects(
      () => verifyBackup(backup.directory),
      /database size does not match manifest\.json/
    );
  } finally {
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("verification rejects config presence that contradicts manifest schema", async () => {
  const current = await fixture();
  try {
    const backup = await createBackup({
      dataDirectory: current.dataDirectory,
      configFile: current.configFile
    });
    await rewriteManifest(backup.directory, (manifest) => {
      manifest.config = null;
    });
    await assert.rejects(
      () => verifyBackup(backup.directory),
      /file inventory does not match format version/
    );
  } finally {
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("verification rejects malformed manifest boundary values", async (context) => {
  const scenarios = [
    {
      name: "null root",
      transform: () => null,
      expected: /Invalid backup manifest root/
    },
    {
      name: "unknown root key",
      transform: (manifest) => { manifest.unknown = true; },
      expected: /Invalid backup manifest root keys/
    },
    {
      name: "invalid creation timestamp",
      transform: (manifest) => { manifest.createdAt = "yesterday"; },
      expected: /Invalid backup manifest createdAt/
    },
    {
      name: "relative source directory",
      transform: (manifest) => { manifest.source.dataDirectory = "relative"; },
      expected: /Invalid backup manifest source values/
    },
    {
      name: "redirected database path",
      transform: (manifest) => { manifest.database.path = "../docomator.db"; },
      expected: /Invalid backup manifest database values/
    },
    {
      name: "invalid database checksum",
      transform: (manifest) => { manifest.database.sha256 = "not-a-sha256"; },
      expected: /Invalid backup manifest database values/
    },
    {
      name: "negative object count",
      transform: (manifest) => { manifest.objects.count = -1; },
      expected: /Invalid backup manifest objects values/
    }
  ];

  for (const scenario of scenarios) {
    await context.test(scenario.name, async () => {
      const current = await fixture();
      try {
        const backup = await createBackup({ dataDirectory: current.dataDirectory });
        await rewriteManifest(backup.directory, scenario.transform);
        await assert.rejects(() => verifyBackup(backup.directory), scenario.expected);
      } finally {
        await fs.rm(current.root, { recursive: true, force: true });
      }
    });
  }
});

test("failed restore rolls database and objects back and removes temporary files", async () => {
  const current = await fixture();
  try {
    const backup = await createBackup({
      dataDirectory: current.dataDirectory,
      configFile: current.configFile
    });
    const databasePath = path.join(current.dataDirectory, "docomator.db");
    await installUncheckpointedWalUpdate(databasePath, "mutated-in-wal");
    await fs.writeFile(
      path.join(current.dataDirectory, "objects", "ab", "cd", "object"),
      "mutated-object"
    );
    await fs.rm(current.configFile);
    await fs.mkdir(current.configFile);

    await assert.rejects(() => restoreBackup({
      backupDirectory: backup.directory,
      dataDirectory: current.dataDirectory,
      configFile: current.configFile
    }));

    await fs.access(`${databasePath}-wal`);
    const restored = new DatabaseSync(databasePath);
    assert.equal(
      restored.prepare("SELECT value FROM records").get().value,
      "mutated-in-wal"
    );
    restored.close();
    assert.equal(
      await fs.readFile(
        path.join(current.dataDirectory, "objects", "ab", "cd", "object"),
        "utf8"
      ),
      "mutated-object"
    );
    assert.equal((await fs.stat(current.configFile)).isDirectory(), true);
    const dataEntries = await fs.readdir(current.dataDirectory);
    assert.equal(dataEntries.some((entry) => entry.startsWith(".restore-")), false);
    assert.equal(dataEntries.includes(".restore.lock"), false);
    const configEntries = await fs.readdir(path.dirname(current.configFile));
    assert.equal(configEntries.some((entry) => entry.includes(".restore-")), false);

    await fs.rm(current.configFile, { recursive: true });
    await fs.writeFile(current.configFile, "DOCOMATOR_VERSION=mutated\n");
    await restoreBackup({
      backupDirectory: backup.directory,
      dataDirectory: current.dataDirectory,
      configFile: current.configFile
    });
    const retried = new DatabaseSync(path.join(current.dataDirectory, "docomator.db"));
    assert.equal(retried.prepare("SELECT value FROM records").get().value, "original");
    retried.close();
    assert.equal(await fs.readFile(current.configFile, "utf8"), "DOCOMATOR_VERSION=test\n");
  } finally {
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("staging creation failure releases the lock and permits a retry", async () => {
  const current = await fixture();
  const originalMkdir = fs.mkdir;
  let injected = false;
  try {
    const backup = await createBackup({ dataDirectory: current.dataDirectory });
    fs.mkdir = async (target, options) => {
      if (!injected && path.basename(String(target)).startsWith(".restore-stage-")) {
        injected = true;
        const error = new Error("injected staging failure");
        error.code = "EIO";
        throw error;
      }
      return originalMkdir(target, options);
    };
    await assert.rejects(() => restoreBackup({
      backupDirectory: backup.directory,
      dataDirectory: current.dataDirectory
    }), /injected staging failure/);
    fs.mkdir = originalMkdir;

    assert.equal(injected, true);
    const failedEntries = await fs.readdir(current.dataDirectory);
    assert.equal(failedEntries.includes(".restore.lock"), false);
    assert.equal(failedEntries.some((entry) => entry.startsWith(".restore-")), false);
    await restoreBackup({
      backupDirectory: backup.directory,
      dataDirectory: current.dataDirectory
    });
  } finally {
    fs.mkdir = originalMkdir;
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("cleanup failure after commit cannot remove installed data", async () => {
  const current = await fixture();
  const originalRm = fs.rm;
  let injected = false;
  try {
    const backup = await createBackup({
      dataDirectory: current.dataDirectory,
      configFile: current.configFile
    });
    const database = new DatabaseSync(path.join(current.dataDirectory, "docomator.db"));
    database.exec("UPDATE records SET value = 'mutated'");
    database.close();

    fs.rm = async (target, options) => {
      if (!injected && path.basename(String(target)).startsWith(".restore-stage-")) {
        injected = true;
        const error = new Error("injected cleanup failure");
        error.code = "EIO";
        throw error;
      }
      return originalRm(target, options);
    };
    const result = await restoreBackup({
      backupDirectory: backup.directory,
      dataDirectory: current.dataDirectory,
      configFile: current.configFile
    });
    fs.rm = originalRm;

    assert.equal(injected, true);
    assert.equal(result.cleanupWarnings.length, 1);
    assert.match(result.cleanupWarnings[0], /staging-каталог.*EIO/);
    const restored = new DatabaseSync(path.join(current.dataDirectory, "docomator.db"));
    assert.equal(restored.prepare("SELECT value FROM records").get().value, "original");
    restored.close();
    assert.equal(
      await fs.readFile(
        path.join(current.dataDirectory, "objects", "ab", "cd", "object"),
        "utf8"
      ),
      "original-object"
    );
    const entries = await fs.readdir(current.dataDirectory);
    assert.equal(entries.includes(".restore.lock"), false);
    assert.equal(entries.some((entry) => entry.startsWith(".restore-stage-")), true);
  } finally {
    fs.rm = originalRm;
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("lock cleanup failure is reported without reverting a successful restore", async () => {
  const current = await fixture();
  const originalRm = fs.rm;
  let injected = false;
  try {
    const backup = await createBackup({ dataDirectory: current.dataDirectory });
    const database = new DatabaseSync(path.join(current.dataDirectory, "docomator.db"));
    database.exec("UPDATE records SET value = 'mutated'");
    database.close();

    fs.rm = async (target, options) => {
      if (!injected && path.basename(String(target)) === ".restore.lock") {
        injected = true;
        const error = new Error("injected lock cleanup failure");
        error.code = "EIO";
        throw error;
      }
      return originalRm(target, options);
    };
    const result = await restoreBackup({
      backupDirectory: backup.directory,
      dataDirectory: current.dataDirectory
    });
    fs.rm = originalRm;

    assert.equal(injected, true);
    assert.equal(result.cleanupWarnings.length, 1);
    assert.match(result.cleanupWarnings[0], /файл блокировки.*EIO/);
    const restored = new DatabaseSync(path.join(current.dataDirectory, "docomator.db"));
    assert.equal(restored.prepare("SELECT value FROM records").get().value, "original");
    restored.close();
    await fs.access(path.join(current.dataDirectory, ".restore.lock"));
  } finally {
    fs.rm = originalRm;
    await fs.rm(current.root, { recursive: true, force: true });
  }
});
