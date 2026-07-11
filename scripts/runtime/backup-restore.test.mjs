import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createBackup, restoreBackup, verifyBackup } from "./backup-lib.mjs";

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
