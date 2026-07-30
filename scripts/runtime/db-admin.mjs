#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function usage() {
  process.stdout.write(`Использование:
  db-admin.mjs tables [--database PATH]
  db-admin.mjs describe TABLE [--database PATH]
  db-admin.mjs rows TABLE [--order-by COLUMN] [--desc] [--limit N] [--offset N] [--format table|json|csv]
  db-admin.mjs export TABLE --output FILE [--format csv|json] [--order-by COLUMN] [--desc] [--limit N]
  db-admin.mjs backup --output FILE [--database PATH]
  db-admin.mjs add-property --label TEXT --entity-type KEY --value-type TYPE [--unit TEXT] [--sensitivity CLASS] --confirm-write

Инструмент не выполняет произвольный SQL. Добавление поля создаёт согласованное
определение параметра Docomator и перед записью делает резервную копию SQLite.
`);
}

function parseArguments(argv) {
  const positional = [];
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options.set(key, next);
      index += 1;
    } else {
      options.set(key, true);
    }
  }
  return { positional, options };
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function findDatabase(options) {
  const explicit = options.get("database");
  if (explicit) return path.resolve(String(explicit));
  const configPath = path.resolve(
    String(options.get("config") || "/etc/docomator/docomator.env")
  );
  const fileEnv = readEnvFile(configPath);
  const dataDir = path.resolve(
    String(
      process.env.DOCOMATOR_DATA_DIR ||
        fileEnv.DOCOMATOR_DATA_DIR ||
        "/var/lib/docomator"
    )
  );
  const configured =
    process.env.DOCOMATOR_DATABASE_PATH || fileEnv.DOCOMATOR_DATABASE_PATH;
  if (configured) return path.resolve(configured);
  const candidates = [
    "docomator.sqlite3",
    "docomator.sqlite",
    "docomator.db",
    "database.sqlite3",
    "database.sqlite"
  ].map((name) => path.join(dataDir, name));
  const existing = candidates.filter((candidate) => fs.existsSync(candidate));
  if (existing.length === 1) return existing[0];
  if (existing.length > 1) {
    fail(`В каталоге ${dataDir} найдено несколько SQLite-файлов. Укажите --database.`);
  }
  if (fs.existsSync(dataDir)) {
    const discovered = fs
      .readdirSync(dataDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:db|sqlite|sqlite3)$/u.test(entry.name))
      .map((entry) => path.join(dataDir, entry.name));
    if (discovered.length === 1) return discovered[0];
  }
  fail(`SQLite-база не найдена в ${dataDir}. Укажите --database PATH.`);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function tableNames(database) {
  return database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name COLLATE NOCASE`
    )
    .all()
    .map((row) => row.name);
}

function requireTable(database, name) {
  const names = tableNames(database);
  if (!names.includes(name)) fail(`Таблица «${name}» не найдена.`);
  return name;
}

function tableColumns(database, table) {
  return database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
}

function requireColumn(database, table, column) {
  if (!column) return null;
  const names = tableColumns(database, table).map((item) => item.name);
  if (!names.includes(column)) fail(`В таблице «${table}» нет колонки «${column}».`);
  return column;
}

function positiveInteger(value, fallback, maximum = 100000) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) {
    fail(`Ожидалось целое число от 0 до ${maximum}, получено: ${value}`);
  }
  return parsed;
}

function queryRows(database, table, options) {
  requireTable(database, table);
  const orderBy = requireColumn(database, table, options.get("order-by"));
  const limit = positiveInteger(options.get("limit"), 100, 100000);
  const offset = positiveInteger(options.get("offset"), 0, 100000000);
  const order = orderBy
    ? ` ORDER BY ${quoteIdentifier(orderBy)}${options.has("desc") ? " DESC" : " ASC"}`
    : "";
  const sql = `SELECT * FROM ${quoteIdentifier(table)}${order} LIMIT ? OFFSET ?`;
  return database.prepare(sql).all(limit, offset);
}

function csvCell(value, neutralize = true) {
  if (value === null || value === undefined) return "";
  let text = typeof value === "bigint" ? value.toString() : String(value);
  if (neutralize && /^[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows, neutralize = true) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  return [
    columns.map((column) => csvCell(column, false)).join(","),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column], neutralize)).join(",")
    )
  ].join("\n");
}

function toDisplayJson(rows) {
  return JSON.stringify(
    rows,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  );
}

function printTable(rows) {
  if (rows.length === 0) {
    process.stdout.write("Нет строк.\n");
    return;
  }
  const columns = Object.keys(rows[0]);
  const widths = columns.map((column) =>
    Math.min(
      48,
      Math.max(
        column.length,
        ...rows.map((row) => String(row[column] ?? "").replace(/\s+/gu, " ").length)
      )
    )
  );
  const line = (values) =>
    values
      .map((value, index) => {
        const text = String(value ?? "").replace(/\s+/gu, " ");
        const clipped = text.length > widths[index]
          ? `${text.slice(0, Math.max(0, widths[index] - 1))}…`
          : text;
        return clipped.padEnd(widths[index]);
      })
      .join(" | ");
  process.stdout.write(`${line(columns)}\n`);
  process.stdout.write(`${widths.map((width) => "-".repeat(width)).join("-+-")}\n`);
  for (const row of rows) process.stdout.write(`${line(columns.map((column) => row[column]))}\n`);
}

function consistentBackup(database, databasePath, outputPath) {
  const destination = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) fail(`Файл резервной копии уже существует: ${destination}`);
  database.exec("PRAGMA wal_checkpoint(FULL)");
  database.prepare("VACUUM INTO ?").run(destination);
  process.stdout.write(`Резервная копия SQLite создана: ${destination}\n`);
  return destination;
}

function slug(value) {
  return String(value)
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48);
}

function propertyInsert(database, options, databasePath) {
  if (!options.has("confirm-write")) {
    fail("Запись отменена. Повторите команду с --confirm-write после проверки параметров.");
  }
  const label = String(options.get("label") || "").trim();
  const entityType = String(options.get("entity-type") || "").trim().toLocaleLowerCase("en-US");
  const valueType = String(options.get("value-type") || "string").trim();
  const sensitivity = String(options.get("sensitivity") || (entityType === "person" ? "personal" : "internal"));
  const unit = String(options.get("unit") || "").trim();
  if (!label || !entityType) fail("Для add-property обязательны --label и --entity-type.");
  const valueTypes = new Set([
    "string",
    "text",
    "number",
    "integer",
    "boolean",
    "date",
    "date-time",
    "enum"
  ]);
  if (!valueTypes.has(valueType)) fail(`Неподдерживаемый тип значения: ${valueType}`);
  const entityTypeTable = tableNames(database).find((name) => name === "entity_types");
  const propertyTable = tableNames(database).find((name) => name === "property_definitions");
  if (!entityTypeTable || !propertyTable) {
    fail("В базе отсутствуют управляемые таблицы entity_types/property_definitions.");
  }
  const typeRow = database
    .prepare("SELECT key FROM entity_types WHERE key = ? LIMIT 1")
    .get(entityType);
  if (!typeRow) fail(`Тип объектов «${entityType}» не найден.`);

  const timestamp = new Date().toISOString();
  const keyBase = slug(`${entityType}_${label}`) || `field_${Date.now()}`;
  let key = `${entityType}.${keyBase}`;
  let suffix = 2;
  while (
    database.prepare("SELECT 1 FROM property_definitions WHERE key = ? LIMIT 1").get(key)
  ) {
    key = `${entityType}.${keyBase}_${suffix}`;
    suffix += 1;
  }
  const backupDir = path.resolve(
    String(options.get("backup-dir") || path.join(path.dirname(databasePath), "admin-backups"))
  );
  const backupPath = path.join(
    backupDir,
    `before-add-property-${timestamp.replace(/[:.]/gu, "-")}.sqlite3`
  );
  consistentBackup(database, databasePath, backupPath);

  const columns = tableColumns(database, propertyTable);
  const available = new Set(columns.map((column) => column.name));
  const values = {
    id: randomUUID(),
    key,
    label,
    description: null,
    value_type: valueType,
    unit: unit || null,
    sensitivity,
    validation_json: JSON.stringify({}),
    aliases_json: JSON.stringify([]),
    applies_to_json: JSON.stringify([entityType]),
    created_at: timestamp,
    updated_at: timestamp,
    version: 1,
    status: "active"
  };
  const insertColumns = Object.keys(values).filter((column) => available.has(column));
  const missingRequired = columns.filter(
    (column) =>
      column.notnull === 1 &&
      column.dflt_value === null &&
      column.pk !== 1 &&
      !insertColumns.includes(column.name)
  );
  if (missingRequired.length > 0) {
    fail(
      `Схема property_definitions содержит неизвестные обязательные колонки: ${missingRequired
        .map((column) => column.name)
        .join(", ")}. Используйте API текущей версии.`
    );
  }
  const placeholders = insertColumns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${quoteIdentifier(propertyTable)} (${insertColumns
    .map(quoteIdentifier)
    .join(", ")}) VALUES (${placeholders})`;
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(sql)
      .run(...insertColumns.map((column) => values[column]));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  process.stdout.write(`Поле создано: ${label} (${key}).\n`);
  process.stdout.write(`Резервная копия до изменения: ${backupPath}\n`);
}

const { positional, options } = parseArguments(process.argv.slice(2));
const command = positional[0];
if (!command || command === "help" || options.has("help")) {
  usage();
  process.exit(0);
}
const databasePath = findDatabase(options);
if (!fs.existsSync(databasePath)) fail(`Файл базы не найден: ${databasePath}`);
const writable = command === "add-property" || command === "backup";
const database = new DatabaseSync(databasePath, { readOnly: !writable });
try {
  database.exec("PRAGMA foreign_keys = ON");
  if (command === "tables") {
    for (const name of tableNames(database)) process.stdout.write(`${name}\n`);
  } else if (command === "describe") {
    const table = requireTable(database, positional[1]);
    printTable(tableColumns(database, table));
  } else if (command === "rows") {
    const table = requireTable(database, positional[1]);
    const rows = queryRows(database, table, options);
    const format = String(options.get("format") || "table");
    if (format === "json") process.stdout.write(`${toDisplayJson(rows)}\n`);
    else if (format === "csv") process.stdout.write(`${toCsv(rows, !options.has("raw-csv"))}\n`);
    else printTable(rows);
  } else if (command === "export") {
    const table = requireTable(database, positional[1]);
    const output = options.get("output");
    if (!output) fail("Для export укажите --output FILE.");
    const rows = queryRows(database, table, options);
    const format = String(options.get("format") || (String(output).endsWith(".json") ? "json" : "csv"));
    const content = format === "json"
      ? `${toDisplayJson(rows)}\n`
      : `${toCsv(rows, !options.has("raw-csv"))}\n`;
    const destination = path.resolve(String(output));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, { encoding: "utf8", mode: 0o600 });
    process.stdout.write(`Экспортировано строк: ${rows.length}. Файл: ${destination}\n`);
  } else if (command === "backup") {
    const output = options.get("output");
    if (!output) fail("Для backup укажите --output FILE.");
    consistentBackup(database, databasePath, String(output));
  } else if (command === "add-property") {
    propertyInsert(database, options, databasePath);
  } else {
    fail(`Неизвестная команда: ${command}`);
  }
} finally {
  database.close();
}
