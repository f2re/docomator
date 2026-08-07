#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DatabaseAdminRegistry,
  KnowledgeRegistry,
  SqliteStore
} from "../../packages/storage/dist/index.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const dataDirectory = path.resolve(
  process.env.DOCOMATOR_DATA_DIR ?? "/var/lib/docomator"
);
const databasePath = path.resolve(
  process.env.DOCOMATOR_DATABASE_PATH ?? path.join(dataDirectory, "docomator.db")
);

function usage() {
  process.stdout.write(`Использование:
  database-admin.mjs tables
  database-admin.mjs describe <таблица>
  database-admin.mjs rows <таблица> [--sort <колонка>] [--desc] [--search <текст>] [--limit <n>] [--offset <n>]
  database-admin.mjs export <таблица> --format csv|json --output <файл> [--sort <колонка>] [--desc] [--search <текст>] [--limit <n>]
  database-admin.mjs check
  database-admin.mjs create-property --space <пространство> --label <название> --type <тип> --applies-to <тип-объекта> [--unit <единица>] [--sensitivity internal|public|personal|restricted]

Команды не исполняют произвольный SQL и не изменяют физическую схему SQLite.
Новые поля создаются как типизированные определения выбранного пространства Docomator.
`);
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`После ${name} требуется значение.`);
  }
  return value;
}

function integerOption(args, name, fallback) {
  const value = option(args, name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error(`${name} должно быть целым числом.`);
  return parsed;
}

function printTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    process.stdout.write("Нет строк.\n");
    return;
  }
  console.table(rows);
}

function safeWrite(targetPath, content) {
  const absolute = path.resolve(targetPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o750 });
  if (fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink()) {
    throw new Error("Экспорт в символическую ссылку запрещён.");
  }
  const temporary = `${absolute}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o640 });
  fs.renameSync(temporary, absolute);
  return absolute;
}

const args = process.argv.slice(2);
const command = args[0];
if (!command || command === "--help" || command === "-h") {
  usage();
  process.exit(command ? 0 : 2);
}

const store = new SqliteStore({ databasePath });
const knowledge = new KnowledgeRegistry(store);
const registry = new DatabaseAdminRegistry(store, knowledge);

try {
  if (command === "tables") {
    printTable(
      registry.listTables().map((table) => ({
        table: table.name,
        rows: table.rowCount,
        columns: table.columns.length
      }))
    );
  } else if (command === "describe") {
    const table = args[1];
    if (!table) throw new Error("Укажите таблицу.");
    const result = registry.describeTable(table);
    process.stdout.write(`${result.name}: ${result.rowCount} строк\n`);
    printTable(result.columns);
  } else if (command === "rows") {
    const table = args[1];
    if (!table) throw new Error("Укажите таблицу.");
    const page = registry.listRows({
      table,
      limit: integerOption(args, "--limit", 100),
      offset: integerOption(args, "--offset", 0),
      ...(option(args, "--sort") === undefined
        ? {}
        : { sortColumn: option(args, "--sort") }),
      ...(args.includes("--desc") ? { sortDirection: "desc" } : {}),
      ...(option(args, "--search") === undefined
        ? {}
        : { search: option(args, "--search") })
    });
    process.stdout.write(
      `${page.table}: показано ${page.rows.length} из ${page.total}, сортировка ${page.sortColumn} ${page.sortDirection}\n`
    );
    printTable(page.rows);
  } else if (command === "export") {
    const table = args[1];
    const format = option(args, "--format");
    const output = option(args, "--output");
    if (!table || (format !== "csv" && format !== "json") || !output) {
      throw new Error("Для экспорта нужны таблица, --format csv|json и --output.");
    }
    const result = registry.exportTable({
      table,
      format,
      limit: integerOption(args, "--limit", 10_000),
      ...(option(args, "--sort") === undefined
        ? {}
        : { sortColumn: option(args, "--sort") }),
      ...(args.includes("--desc") ? { sortDirection: "desc" } : {}),
      ...(option(args, "--search") === undefined
        ? {}
        : { search: option(args, "--search") })
    });
    const written = safeWrite(output, result.content);
    process.stdout.write(`Экспортировано ${result.rowCount} строк: ${written}\n`);
  } else if (command === "check") {
    const result = registry.quickCheck();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "ok") process.exitCode = 1;
  } else if (command === "create-property") {
    const spaceIdentity = option(args, "--space");
    const label = option(args, "--label");
    const valueType = option(args, "--type");
    const appliesTo = option(args, "--applies-to");
    if (!spaceIdentity || !label || !valueType || !appliesTo) {
      throw new Error("Нужны --space, --label, --type и --applies-to.");
    }
    const result = registry.createPropertyDefinition(
      spaceIdentity,
      {
        label,
        valueType,
        appliesTo: [appliesTo],
        sensitivity: option(args, "--sensitivity") ?? "internal",
        ...(option(args, "--unit") === undefined
          ? {}
          : { unit: option(args, "--unit") })
      },
      {
        actorId: process.env.DOCOMATOR_ACTOR_ID ?? "local-db-admin",
        correlationId: `database-admin-${Date.now()}`
      }
    );
    process.stdout.write(
      `Поле создано в пространстве ${spaceIdentity}: ${result.label} (${result.key}), тип ${result.valueType}.\n`
    );
  } else {
    throw new Error(`Неизвестная команда: ${command}`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  store.close();
}
