import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SqliteStore, WorkerQueue } from "@docomator/storage";

import {
  JobHandlerRegistry,
  PermanentJobError,
  processNextJob
} from "./processor.js";

const T0 = new Date("2026-07-11T10:00:00.000Z");

function createQueue(): { queue: WorkerQueue; cleanup: () => void } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-processor-"));
  const databasePath = path.join(directory, "docomator.db");
  const database = new DatabaseSync(databasePath);
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  for (const migration of fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.close();
  const store = new SqliteStore({ databasePath });
  return {
    queue: new WorkerQueue(store),
    cleanup: () => {
      store.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

function options(queue: WorkerQueue, handlers: JobHandlerRegistry, now: Date) {
  return {
    queue,
    handlers,
    workerId: "worker-test",
    leaseDurationMs: 60_000,
    retryBaseMs: 1_000,
    retryMaxMs: 60_000,
    signal: new AbortController().signal,
    now: () => now
  };
}

test("processor completes a registered job", async () => {
  const fixture = createQueue();
  try {
    const handlers = new JobHandlerRegistry();
    let handled = 0;
    handlers.register("test.success", async () => {
      handled += 1;
    });
    const queued = fixture.queue.enqueue({
      jobType: "test.success",
      payload: { id: 1 },
      now: T0
    }).job;

    const result = await processNextJob(options(fixture.queue, handlers, T0));
    assert.equal(result.status, "completed");
    assert.equal(handled, 1);
    assert.equal(fixture.queue.getById(queued.id)?.state, "completed");
  } finally {
    fixture.cleanup();
  }
});

test("processor retries transient errors with deterministic backoff", async () => {
  const fixture = createQueue();
  try {
    const handlers = new JobHandlerRegistry();
    handlers.register("test.transient", async () => {
      throw new Error("temporary");
    });
    const queued = fixture.queue.enqueue({
      jobType: "test.transient",
      payload: {},
      now: T0
    }).job;

    const result = await processNextJob(options(fixture.queue, handlers, T0));
    assert.equal(result.status, "retry");
    const stored = fixture.queue.getById(queued.id);
    assert.equal(stored?.state, "retry");
    assert.equal(stored?.nextAttemptAt, "2026-07-11T10:00:01.000Z");
  } finally {
    fixture.cleanup();
  }
});

test("unknown or permanent jobs are dead-lettered without repeated execution", async () => {
  const fixture = createQueue();
  try {
    const handlers = new JobHandlerRegistry();
    handlers.register("test.permanent", async () => {
      throw new PermanentJobError("invalid input");
    });
    const permanent = fixture.queue.enqueue({
      jobType: "test.permanent",
      payload: {},
      now: T0
    }).job;
    const unknown = fixture.queue.enqueue({
      jobType: "test.unknown",
      payload: {},
      now: T0,
      priority: 200
    }).job;

    assert.equal(
      (await processNextJob(options(fixture.queue, handlers, T0))).status,
      "dead_letter"
    );
    assert.equal(fixture.queue.getById(permanent.id)?.state, "dead_letter");
    assert.equal(
      (await processNextJob(options(fixture.queue, handlers, T0))).status,
      "dead_letter"
    );
    assert.equal(fixture.queue.getById(unknown.id)?.state, "dead_letter");
  } finally {
    fixture.cleanup();
  }
});
