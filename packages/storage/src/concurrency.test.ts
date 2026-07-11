import assert from "node:assert/strict";
import test from "node:test";

import { SqliteStore } from "./database.js";
import { WorkerQueue } from "./queue.js";
import { createMigratedTestStore } from "./test-helpers.js";

const T0 = "2026-07-11T10:00:00.000Z";

test("two worker connections cannot own the same active lease", () => {
  const fixture = createMigratedTestStore();
  const secondStore = new SqliteStore({ databasePath: fixture.store.databasePath });
  try {
    const firstQueue = new WorkerQueue(fixture.store);
    const secondQueue = new WorkerQueue(secondStore);
    const queued = firstQueue.enqueue({
      jobType: "test.concurrent-claim",
      payload: { source: "integration" },
      maxAttempts: 3,
      now: T0
    }).job;

    const firstClaim = firstQueue.claimNext({
      workerId: "worker-a",
      leaseDurationMs: 1_000,
      now: T0
    });
    assert.equal(firstClaim?.id, queued.id);

    const concurrentClaim = secondQueue.claimNext({
      workerId: "worker-b",
      leaseDurationMs: 1_000,
      now: T0
    });
    assert.equal(concurrentClaim, null);

    const recoveredAfterExpiry = secondQueue.claimNext({
      workerId: "worker-b",
      leaseDurationMs: 1_000,
      now: "2026-07-11T10:00:01.001Z"
    });
    assert.equal(recoveredAfterExpiry?.id, queued.id);
    assert.equal(recoveredAfterExpiry?.attempts, 2);
    assert.equal(recoveredAfterExpiry?.lockedBy, "worker-b");
  } finally {
    secondStore.close();
    fixture.cleanup();
  }
});
