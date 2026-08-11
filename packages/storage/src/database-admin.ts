import { AuditRepository } from "./audit.js";
import { SqliteStore, type SqliteExecutor } from "./database.js";
import {
  KnowledgeRegistry,
  type MutationContext,
  type PropertyDefinitionRecord,
  type PropertySensitivity
} from "./knowledge.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";

export class DatabaseAdminValidationError extends Error {
  override readonly name = "DatabaseAdminValidationError";
}

export interface DatabaseAdminColumn {
  name: string;
  type: string;
  notNull: boolean;
  primaryKeyPosition: number;
}

export interface DatabaseAdminTablePresentation {
  label: string;
  category: string;
  description: string;
  sensitivity: PropertySensitivity;
}

export interface DatabaseAdminTable extends DatabaseAdminTablePresentation {
  name: string;
  rowCount: number;
  columns: DatabaseAdminColumn[];
}

export interface DatabaseAdminPage {
  table: string;
  presentation: DatabaseAdminTablePresentation;
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

const EXACT_TABLE_PRESENTATIONS: Readonly<
  Record<string, DatabaseAdminTablePresentation>
> = Object.freeze({
  entities: {
    label: "Объекты и сотрудники",
    category: "Основные данные",
    description: "Карточки людей и других объектов, доступных в разделах Оформлятор.",
    sensitivity: "personal"
  },
  entity_types: {
    label: "Типы объектов",
    category: "Модель данных",
    description: "Определения типов записей: человек, оборудование, статья и другие.",
    sensitivity: "internal"
  },
  property_definitions: {
    label: "Определения полей",
    category: "Модель данных",
    description: "Типизированные поля, применимые к карточкам объектов и шаблонам.",
    sensitivity: "internal"
  },
  entity_property_values: {
    label: "Значения полей объектов",
    category: "Основные данные",
    description: "Версионируемые значения дополнительных полей карточек.",
    sensitivity: "personal"
  },
  spaces: {
    label: "Разделы данных",
    category: "Организация данных",
    description: "Рабочие разделы, объединяющие объекты, группы, шаблоны и результаты.",
    sensitivity: "internal"
  },
  space_entity_ownership: {
    label: "Принадлежность объектов разделам",
    category: "Организация данных",
    description: "Связи карточек с рабочими разделами.",
    sensitivity: "internal"
  },
  audience_groups: {
    label: "Группы объектов",
    category: "Организация данных",
    description: "Сохранённые однородные составы для выпуска документов.",
    sensitivity: "personal"
  },
  audience_snapshots: {
    label: "Снимки состава",
    category: "Организация данных",
    description: "Неизменяемые составы участников, зафиксированные для конкретных операций.",
    sensitivity: "personal"
  },
  document_quarantine_records: {
    label: "Проверенные исходные документы",
    category: "Документы",
    description: "Записи безопасного приёма DOCX и XLSX до подключения шаблона.",
    sensitivity: "internal"
  },
  document_generation_jobs: {
    label: "Задания выпуска",
    category: "Документы",
    description: "Запуски формирования персональных и сводных документов.",
    sensitivity: "personal"
  },
  document_generation_units: {
    label: "Единицы выпуска",
    category: "Документы",
    description: "Результат формирования по каждому участнику или сводному документу.",
    sensitivity: "personal"
  },
  document_deliveries: {
    label: "Доставка в сетевые папки",
    category: "Доставка",
    description: "Попытки и результаты сохранения файлов в разрешённые сетевые каталоги.",
    sensitivity: "internal"
  },
  document_email_deliveries: {
    label: "Почтовая доставка",
    category: "Доставка",
    description: "Попытки отправки готовых документов по электронной почте.",
    sensitivity: "restricted"
  },
  document_schedules: {
    label: "Расписания выпуска",
    category: "Автоматизация",
    description: "Сохранённые правила периодического формирования документов.",
    sensitivity: "internal"
  },
  document_schedule_runs: {
    label: "Запуски расписаний",
    category: "Автоматизация",
    description: "История периодических запусков и их фактическое состояние.",
    sensitivity: "internal"
  },
  space_email_recipients: {
    label: "Получатели электронной почты",
    category: "Доставка",
    description: "Разрешённые корпоративные адресаты выбранных разделов.",
    sensitivity: "restricted"
  },
  audit_log: {
    label: "Журнал действий",
    category: "Диагностика",
    description: "Технический журнал операций, инициаторов и идентификаторов корреляции.",
    sensitivity: "restricted"
  },
  worker_jobs: {
    label: "Очередь фоновых заданий",
    category: "Диагностика",
    description: "Состояние, аренда и повторы заданий фонового обработчика.",
    sensitivity: "restricted"
  },
  domain_events: {
    label: "Исходящие доменные события",
    category: "Диагностика",
    description: "Служебная очередь событий и ключей идемпотентности.",
    sensitivity: "restricted"
  },
  schema_migrations: {
    label: "Применённые миграции",
    category: "Диагностика",
    description: "Неизменяемый перечень применённых изменений физической схемы SQLite.",
    sensitivity: "internal"
  }
});

function tablePresentation(name: string): DatabaseAdminTablePresentation {
  const exact = EXACT_TABLE_PRESENTATIONS[name];
  if (exact !== undefined) return { ...exact };

  if (name.startsWith("template_")) {
    return {
      label: `Данные шаблонов · ${name}`,
      category: "Шаблоны",
      description: "Служебные версии, поля, проверки и активированные выпуски шаблонов.",
      sensitivity: "internal"
    };
  }
  if (name.startsWith("audience_")) {
    return {
      label: `Составы и группы · ${name}`,
      category: "Организация данных",
      description: "Служебные связи участников, групп и неизменяемых снимков состава.",
      sensitivity: "personal"
    };
  }
  if (name.startsWith("document_")) {
    return {
      label: `Документный контур · ${name}`,
      category: "Документы",
      description: "Служебные данные формирования, результатов или доставки документов.",
      sensitivity: "personal"
    };
  }
  if (name.startsWith("employee_")) {
    return {
      label: `Запросы карточек · ${name}`,
      category: "Основные данные",
      description: "Идемпотентные запросы создания или изменения карточек сотрудников.",
      sensitivity: "personal"
    };
  }
  if (name.startsWith("space_")) {
    return {
      label: `Связи разделов · ${name}`,
      category: "Организация данных",
      description: "Служебные связи объектов и настроек с рабочими разделами.",
      sensitivity: "internal"
    };
  }

  return {
    label: `Служебная таблица · ${name}`,
    category: "Служебные данные",
    description:
      "Техническая таблица без предметного редактора. Изменение выполняется только через штатные операции или новую миграцию.",
    sensitivity: "restricted"
  };
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
  readonly #audit: AuditRepository;

  constructor(
    store: SqliteStore,
    knowledge: KnowledgeRegistry = new KnowledgeRegistry(store),
    audit: AuditRepository = new AuditRepository(store)
  ) {
    this.#store = store;
    this.#knowledge = knowledge;
    this.#audit = audit;
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
            .get() as unknown as SqliteCountRow
        ).count,
        columns: this.#columns(database, table.name),
        ...tablePresentation(table.name)
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
          .get() as unknown as SqliteCountRow
      ).count,
      columns: this.#columns(database, name),
      ...tablePresentation(name)
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
    const limit = normalizedLimit(input.limit, 10_000);
    const offset = normalizedOffset(input.offset);
    const direction = input.sortDirection === "desc" ? "desc" : "asc";
    const search = String(input.search ?? "").normalize("NFKC").trim().slice(0, 300);
    return this.#store.execute((database) => {
      const columns = this.#columns(database, table);
      if (columns.length === 0) {
        throw new DatabaseAdminValidationError("У таблицы нет доступных колонок.");
      }
      const sortColumn =
        input.sortColumn?.trim() ||
        columns.find((column) => column.primaryKeyPosition > 0)?.name ||
        columns[0]?.name ||
        "";
      if (!columns.some((column) => column.name === sortColumn)) {
        throw new DatabaseAdminValidationError("Колонка сортировки не найдена.");
      }
      const searchable = columns.slice(0, 20);
      const where =
        search.length === 0
          ? ""
          : ` WHERE ${searchable
              .map(
                (column) =>
                  `CAST(${quotedIdentifier(column.name)} AS TEXT) LIKE ? ESCAPE '\\'`
              )
              .join(" OR ")}`;
      const escapedSearch = `%${search
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_")}%`;
      const parameters =
        search.length === 0 ? [] : searchable.map(() => escapedSearch);
      const total = (
        database
          .prepare(`SELECT COUNT(*) AS count FROM ${quotedIdentifier(table)}${where}`)
          .get(...parameters) as unknown as SqliteCountRow
      ).count;
      const rawRows = database
        .prepare(`
          SELECT *
          FROM ${quotedIdentifier(table)}${where}
          ORDER BY ${quotedIdentifier(sortColumn)} ${direction.toUpperCase()}
          LIMIT ? OFFSET ?
        `)
        .all(...parameters, limit, offset) as unknown as Array<
        Record<string, unknown>
      >;
      return {
        table,
        presentation: tablePresentation(table),
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

  exportTable(
    input: {
      table: string;
      format: "csv" | "json";
      sortColumn?: string;
      sortDirection?: "asc" | "desc";
      search?: string;
      limit?: number;
    },
    context?: MutationContext
  ): { fileName: string; contentType: string; content: string; rowCount: number } {
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
    const result =
      input.format === "json"
        ? {
            fileName: `${page.table}.json`,
            contentType: "application/json; charset=utf-8",
            content: `${JSON.stringify(page.rows, null, 2)}\n`,
            rowCount: page.rows.length
          }
        : {
            fileName: `${page.table}.csv`,
            contentType: "text/csv; charset=utf-8",
            content: `\ufeff${[
              page.columns.map((column) => column.name).map(csvCell).join(";"),
              ...page.rows.map((row) =>
                page.columns
                  .map((column) => csvCell(row[column.name] ?? null))
                  .join(";")
              )
            ].join("\n")}\n`,
            rowCount: page.rows.length
          };

    if (context !== undefined) {
      this.#audit.record({
        ...(context.now === undefined ? {} : { occurredAt: context.now }),
        actorType: context.actorType,
        actorId: context.actorId ?? null,
        action: "export",
        objectType: "database_table",
        objectId: page.table,
        correlationId: context.correlationId,
        details: {
          format: input.format,
          rowCount: result.rowCount,
          filtered: page.search.length > 0,
          sortColumn: page.sortColumn,
          sortDirection: page.sortDirection
        }
      });
    }

    return result;
  }

  quickCheck(): {
    status: "ok" | "error";
    messages: string[];
    foreignKeyErrors: number;
  } {
    return this.#store.execute((database) => {
      const messages = (
        database.prepare("PRAGMA quick_check").all() as unknown as Array<
          Record<string, unknown>
        >
      ).flatMap((row) => Object.values(row).map(String));
      const foreignKeyErrors = (
        database.prepare("PRAGMA foreign_key_check").all() as unknown[]
      ).length;
      return {
        status:
          messages.every((message) => message === "ok") && foreignKeyErrors === 0
            ? "ok"
            : "error",
        messages,
        foreignKeyErrors
      };
    });
  }

  createPropertyDefinition(
    spaceIdentity: string,
    input: Parameters<KnowledgeRegistry["createPropertyDefinition"]>[0],
    context: MutationContext
  ): PropertyDefinitionRecord {
    return SpaceScopedKnowledgeRegistry.fromRegistry(
      this.#knowledge,
      spaceIdentity
    ).createPropertyDefinition(input, context);
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

  #columns(database: SqliteExecutor, table: string): DatabaseAdminColumn[] {
    return (
      database
        .prepare(`PRAGMA table_info(${quotedIdentifier(table)})`)
        .all() as unknown as SqliteColumnRow[]
    ).map((column) => ({
      name: column.name,
      type: column.type || "",
      notNull: column.notnull === 1,
      primaryKeyPosition: column.pk
    }));
  }
}
