#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import { restoreBackup, verifyBackup } from "./backup-lib.mjs";

function usage() {
  process.stdout.write(`Usage: node scripts/runtime/restore.mjs --backup DIR [options]\n\nOptions:\n  --backup DIR        Verified backup directory\n  --data-dir DIR      Persistent data directory\n  --config-file FILE  Restore configuration when included in backup\n  --verify-only       Verify checksums and SQLite without changing data\n  -h, --help          Show help\n`);
}

const args = process.argv.slice(2);
const options = {
  dataDirectory: process.env.DOCOMATOR_DATA_DIR ?? "/var/lib/docomator"
};
let verifyOnly = false;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  const next = () => {
    index += 1;
    const value = args[index];
    if (value === undefined) throw new Error(`Missing value after ${argument}`);
    return value;
  };
  switch (argument) {
    case "--backup": options.backupDirectory = next(); break;
    case "--data-dir": options.dataDirectory = next(); break;
    case "--config-file": options.configFile = next(); break;
    case "--verify-only": verifyOnly = true; break;
    case "-h":
    case "--help": usage(); process.exit(0);
    default: throw new Error(`Unknown argument: ${argument}`);
  }
}
if (options.backupDirectory === undefined) {
  throw new Error("--backup is required");
}
options.backupDirectory = path.resolve(options.backupDirectory);
options.dataDirectory = path.resolve(options.dataDirectory);

if (verifyOnly) {
  const manifest = await verifyBackup(options.backupDirectory);
  process.stdout.write(`${JSON.stringify({ status: "ok", verified: options.backupDirectory, manifest })}\n`);
} else {
  const result = await restoreBackup(options);
  process.stdout.write(`${JSON.stringify({ status: "ok", restored: options.backupDirectory, dataDirectory: result.dataDirectory, manifest: result.manifest })}\n`);
}
