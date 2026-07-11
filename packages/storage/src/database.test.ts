import assert from "node:assert/strict";
import test from "node:test";

import { SqliteStore } from "./database.js";

test("transactions commit, roll back and isolate nested savepoints", () => {
  const store = new SqliteStore({ databasePath: ":memory:" });
  try {
    store.execute((database) => {
      database.exec("CREATE TABLE values_test(value INTEGER NOT NULL);");
    });

    store.transaction((database) => {
      database.prepare("INSERT INTO values_test(value) VALUES (?)").run(1);
      assert.throws(
        () =>
          store.transaction((nested) => {
            nested.prepare("INSERT INTO values_test(value) VALUES (?)").run(2);
            throw new Error("nested failure");
          }),
        /nested failure/
      );
      database.prepare("INSERT INTO values_test(value) VALUES (?)").run(3);
    });

    const rows = store.execute(
      (database) =>
        database.prepare("SELECT value FROM values_test ORDER BY value").all() as unknown as Array<{
          value: number;
        }>
    );
    assert.deepEqual(rows, [{ value: 1 }, { value: 3 }]);

    assert.throws(
      () =>
        store.transaction((database) => {
          database.prepare("INSERT INTO values_test(value) VALUES (?)").run(4);
          throw new Error("outer failure");
        }),
      /outer failure/
    );
    const count = store.execute(
      (database) =>
        database.prepare("SELECT COUNT(*) AS count FROM values_test").get() as {
          count: number;
        }
    );
    assert.equal(count.count, 2);
  } finally {
    store.close();
  }
});

test("asynchronous transaction callbacks are rejected", () => {
  const store = new SqliteStore({ databasePath: ":memory:" });
  try {
    assert.throws(
      () => store.transaction(async () => Promise.resolve()),
      /must be synchronous/
    );
  } finally {
    store.close();
  }
});
