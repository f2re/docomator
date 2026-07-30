import { KnowledgeRegistry, type MutationContext, type PropertyDefinitionRecord } from "./knowledge.js";
import { SqliteStore } from "./database.js";

export class DatabaseAdminValidationError extends Error {
  override readonly name = "DatabaseAdminValidationError";
}

export interface DatabaseAdminColumn {
  name: string;
  type: string;
  notNull: boolean;
  primaryKeyPosition: number;
}

export interface DatabaseAdminTable {
  name: string;
  rowCount: number;
  columns: DatabaseAdminColumn[];
}

export interface DatabaseAdminPage {
  table: string;
  columns: DatabaseAdminColumn[];
  rows: Array<Record<string, string | number | null>>;
  total: number;
  limit: number;
  offset: number;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  search: string;
}

interface SqliteTableRow {
  name: string;
}

interface SqliteCountRow {
  count: number;
}

interface SqliteColumnRow {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizedLimit(value: number | undefined, maximum: number): number {
  const limit = value ?? Math.min(100, maximum);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new DatabaseAdminValidationError(
      `Размер страницы должен быть от 1 до ${maximum}.`
    );
  }
  return limit;
}

function normalizedOffset(value: number | undefined): number {
  const offset = value ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000_000) {
    throw new DatabaseAdminValidationError("Смещение страницы заполнено некорректно.");
  }
  return offset;
}

function safeCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return `[BLOB ${value.length} байт]`;
  return JSON.stringify(value);
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value).replace(/\r\n?/gu, "\n");
  if (/^[=+@]/u.test(text) || /^-\D/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export class DatabaseAdminRegistry {
  readonly #store: SqliteStore;
  readonly #knowledge: KnowledgeRegistry;

  constructor(
    store: SqliteStore,
    knowledge: KnowledgeRegistry = new KnowledgeRegistry(store)
  ) {
    this.#store = store;
    this.#knowledge = knowledge;
  }

  listTables(): DatabaseAdminTable[] {
    return this.#store.execute((database) => {
      const tables = database
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
          ORDER BY name COLLATE NOCASE, name
        `)
        .all() as unknown as SqliteTableRow[];
      return tables.map((table) => ({
        name: table.name,
        rowCount: (
          database
            .prepare(`SELECT COUNT(*) AS count FROM ${quotedIdentifier(table.name)}`)
            .get() as SqliteCountRow
        ).count,
        columns: this.#columns(database, table.name)
      }));
    });
  }

  describeTable(tableName: string): DatabaseAdminTable {
    const name = this.#validatedTableName(tableName);
    return this.#store.execute((database) => ({
      name,
      rowCount: (
        database
          .prepare(`SELECT COUNT(*) AS count FROM ${quotedIdentifier(name)}`)
          .get() as SqliteCountRow
      ).count,
      columns: this.#columns(database, name)
    }));
  }

  listRows(input: {
    table: string;
    limit?: number;
    offset?: number;
    sortColumn?: string;
    sortDirection?: "asc" | "desc";
    search?: string;
  }): DatabaseAdminPage {
    const table = this.#validatedTableName(input.table);
    const limit = normalizedLimit(input.limit, 200);
    const offset = normalizedOffset(input.offset);
    const direction = input.sortDirection === "desc" ? "desc" : "asc";
    const search = String(input.search ?? "").normalize("NFKC").trim().slice(0, 300);
    return this.#store.execute((database) => {
      const columns = this.#columns(database, table);
      if (columns.length === 0) {
        throw new DatabaseAdminValidationError("У таблицы нет доступных колонок.");
      }
      const sortColumn = input.sortColumn?.trim() ||
        columns.find((column) => column.primaryKeyPosition > 0)?.name ||
        columns[0]?.name || "";
      if (!columns.some((column) => column.name === sortColumn)) {
        throw new DatabaseAdminValidationError("Колонка сортировки не найдена.");
      }
      const searchable = columns.slice(0, 20);
      const where = search.length === 0
        ? ""
        : ` WHERE ${searchable
            .map((column) => `CAST(${quotedIdentifier(column.name)} AS TEXT) LIKE ? ESCAPE '\\'`)
            .join(" OR ")}`;
      const escapedSearch = `%${search
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_")}%`;
      const parameters = search.length === 0
        ? []
        : searchable.map(() => escapedSearch);
      const total = (
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM ${quotedIdentifier(table)}${where}`
          )
          .get(...parameters) as SqliteCountRow
      ).count;
      const rawRows = database
        .prepare(`
          SELECT *
          FROM ${quotedIdentifier(table)}${where}
          ORDER BY ${quotedIdentifier(sortColumn)} ${direction.toUpperCase()}
          LIMIT ? OFFSET ?
        `)
        .all(...parameters, limit, offset) as unknown as Array<Record<string, unknown>>;
      return {
        table,
        columns,
        rows: rawRows.map((row) =>
          Object.fromEntries(
            columns.map((column) => [column.name, safeCell(row[column.name])])
          )
        ),
        total,
        limit,
        offset,
        sortColumn,
        sortDirection: direction,
        search
      };
    });
  }

  exportTable(input: {
    table: string;
    format: "csv" | "json";
    sortColumn?: string;
    sortDirection?: "asc" | "desc";
    search?: string;
    limit?: number;
  }): { fileName: string; contentType: string; content: string; rowCount: number } {
    const page = this.listRows({
      table: input.table,
      limit: normalizedLimit(input.limit, 10_000),
      offset: 0,
      ...(input.sortColumn === undefined ? {} : { sortColumn: input.sortColumn }),
      ...(input.sortDirection === undefined
        ? {}
        : { sortDirection: input.sortDirection }),
      ...(input.search === undefined ? {} : { search: input.search })
    });
    if (input.format === "json") {
      return {
        fileName: `${page.table}.json`,
        contentType: "application/json; charset=utf-8",
        content: `${JSON.stringify(page.rows, null, 2)}\n`,
        rowCount: page.rows.length
      };
    }
    const headers = page.columns.map((column) => column.name);
    const content = [
      headers.map(csvCell).join(";"),
      ...page.rows.map((row) =>
        headers.map((header) => csvCell(row[header] ?? null)).join(";")
      )
    ].join("\n");
    return {
      fileName: `${page.table}.csv`,
      contentType: "text/csv; charset=utf-8",
      content: `\ufeff${content}\n`,
      rowCount: page.rows.length
    };
  }

  quickCheck(): { status: "ok" | "error"; messages: string[]; foreignKeyErrors: number } {
    return this.#store.execute((database) => {
      const messages = (database.prepare("PRAGMA quick_check").all() as unknown as Array<Record<string, unknown>>)
        .flatMap((row) => Object.values(row).map(String));
      const foreignKeyErrors = (database.prepare("PRAGMA foreign_key_check").all() as unknown[]).length;
      return {
        status: messages.every((message) => message === "ok") && foreignKeyErrors === 0
          ? "ok"
          : "error",
        messages,
        foreignKeyErrors
      };
    });
  }

  createPropertyDefinition(
    input: Parameters<KnowledgeRegistry["createPropertyDefinition"]>[0],
    context: MutationContext
  ): PropertyDefinitionRecord {
    return this.#knowledge.createPropertyDefinition(input, context);
  }

  #validatedTableName(value: string): string {
    const name = String(value ?? "").normalize("NFKC").trim();
    if (name.length < 1 || name.length > 160) {
      throw new DatabaseAdminValidationError("Название таблицы заполнено некорректно.");
    }
    const exists = this.#store.execute((database) =>
      database
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name = ?
            AND name NOT LIKE 'sqlite_%'
        `)
        .get(name)
    );
    if (exists === undefined) {
      throw new DatabaseAdminValidationError("Таблица не найдена.");
    }
    return name;
  }

  #columns(
    database: Parameters<Parameters<SqliteStore["execute"]>[0]>[0],
    table: string
  ): DatabaseAdminColumn[] {
    return (database
      .prepare(`PRAGMA table_info(${quotedIdentifier(table)})`)
      .all() as unknown as SqliteColumnRow[]).map((column) => ({
      name: column.name,
      type: column.type || "",
      notNull: column.notnull === 1,
      primaryKeyPosition: column.pk
    }));
  }
}
