import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

export interface SqliteExecutor {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
}

export interface SqliteStoreOptions {
  dataDir?: string;
  databasePath?: string;
  busyTimeoutMs?: number;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export class SqliteStore {
  readonly databasePath: string;

  private readonly database: DatabaseSync;
  private transactionDepth = 0;
  private closed = false;

  constructor(options: SqliteStoreOptions = {}) {
    const requestedPath =
      options.databasePath ??
      path.join(options.dataDir ?? "/var/lib/docomator", "docomator.db");
    this.databasePath =
      requestedPath === ":memory:" ? requestedPath : path.resolve(requestedPath);

    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 60_000) {
      throw new Error("busyTimeoutMs must be an integer in range 0..60000");
    }

    if (this.databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(this.databasePath), {
        recursive: true,
        mode: 0o750
      });
    }

    this.database = new DatabaseSync(this.databasePath);
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA synchronous = FULL;");
    this.database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
  }

  execute<T>(operation: (executor: SqliteExecutor) => T): T {
    this.ensureOpen();
    return operation(this.database);
  }

  transaction<T>(operation: (executor: SqliteExecutor) => T): T {
    this.ensureOpen();

    const depth = this.transactionDepth;
    const savepoint = `docomator_sp_${depth + 1}`;
    if (depth === 0) {
      this.database.exec("BEGIN IMMEDIATE;");
    } else {
      this.database.exec(`SAVEPOINT ${savepoint};`);
    }
    this.transactionDepth += 1;

    try {
      const result = operation(this.database);
      if (isPromiseLike(result)) {
        throw new Error(
          "SQLite transaction callbacks must be synchronous; perform slow work after commit"
        );
      }

      if (depth === 0) {
        this.database.exec("COMMIT;");
      } else {
        this.database.exec(`RELEASE SAVEPOINT ${savepoint};`);
      }
      return result;
    } catch (error) {
      if (depth === 0) {
        this.database.exec("ROLLBACK;");
      } else {
        this.database.exec(`ROLLBACK TO SAVEPOINT ${savepoint};`);
        this.database.exec(`RELEASE SAVEPOINT ${savepoint};`);
      }
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.database.close();
    this.closed = true;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("SQLite store is closed");
    }
  }
}
