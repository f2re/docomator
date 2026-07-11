#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import { createBackup } from "./backup-lib.mjs";

function usage() {
  process.stdout.write(`Usage: node scripts/runtime/backup.mjs [options]\n\nOptions:\n  --data-dir DIR       Persistent data directory\n  --database FILE      Database path (default: <data-dir>/docomator.db)\n  --objects-dir DIR    Object storage path (default: <data-dir>/objects)\n  --output DIR         Exact backup directory\n  --output-parent DIR  Parent for generated backup directory\n  --config-file FILE   Include configuration snapshot\n  --release-version V  Record release version\n  --retention COUNT    Keep newest COUNT regular backups\n  --prefix NAME        Backup directory prefix (default: backup)\n  -h, --help           Show help\n`);
}

const args = process.argv.slice(2);
const options = {
  dataDirectory: process.env.DOCOMATOR_DATA_DIR ?? "/var/lib/docomator"
};
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  const next = () => {
    index += 1;
    const value = args[index];
    if (value === undefined) throw new Error(`Missing value after ${argument}`);
    return value;
  };
  switch (argument) {
    case "--data-dir": options.dataDirectory = next(); break;
    case "--database": options.databasePath = next(); break;
    case "--objects-dir": options.objectDirectory = next(); break;
    case "--output": options.outputDirectory = next(); break;
    case "--output-parent": options.outputParent = next(); break;
    case "--config-file": options.configFile = next(); break;
    case "--release-version": options.releaseVersion = next(); break;
    case "--retention": {
      const value = Number.parseInt(next(), 10);
      if (!Number.isInteger(value) || value < 0 || value > 10_000) {
        throw new Error("--retention must be an integer in range 0..10000");
      }
      options.retentionCount = value;
      break;
    }
    case "--prefix": options.prefix = next(); break;
    case "-h":
    case "--help": usage(); process.exit(0);
    default: throw new Error(`Unknown argument: ${argument}`);
  }
}

options.dataDirectory = path.resolve(options.dataDirectory);
const result = await createBackup(options);
process.stdout.write(`${JSON.stringify({ status: "ok", backup: result.directory, manifest: result.manifest })}\n`);
