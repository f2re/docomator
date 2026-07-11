import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkerJobIdempotencyConflictError,
  WorkerQueue
} from "./queue.js";
import { createMigratedTestStore } from "./test-helpers.js";

const T0 = "2026-07-11T10:00:00.000Z";

function plus(milliseconds: number): string {
  return new Date(new Date(T0).getTime() + milliseconds).toISOString();
}

test("queue enqueue is idempotent and canonical JSON ignores object key order", () => {
  const fixture = createMigratedTestStore();
  try {
    const queue = new WorkerQueue(fixture.store);
    const first = queue.enqueue({
      jobType: "test.idempotent",
      payload: { alpha: 1, beta: 2 },
      idempotencyKey: "job-key-1",
      now: T0
    });
    const second = queue.enqueue({
      jobType: "test.idempotent",
      payload: { beta: 2, alpha: 1 },
      idempotencyKey: "job-key-1",
      now: T0
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.job.id, first.job.id);
    assert.throws(
      () =>
        queue.enqueue({
          jobType: "test.idempotent",
          payload: { alpha: 99 },
          idempotencyKey: "job-key-1",
          now: T0
        }),
      WorkerJobIdempotencyConflictError
    );
  } finally {
    fixture.cleanup();
  }
});

test("queue claims by priority and completes only with a valid lease", () => {
  const fixture = createMigratedTestStore();
  try {
    const queue = new WorkerQueue(fixture.store);
    const low = queue.enqueue({
      jobType: "test.low",
      payload: {},
      priority: 100,
      now: T0
    }).job;
    const high = queue.enqueue({
      jobType: "test.high",
      payload: {},
      priority: 10,
      now: T0
    }).job;

    const first = queue.claimNext({ workerId: "worker-a", leaseDurationMs: 1_000, now: T0 });
    assert.equal(first?.id, high.id);
    assert.equal(first?.attempts, 1);
    assert.equal(queue.renewLease(high.id, "worker-b", 1_000, T0), false);
    assert.equal(queue.renewLease(high.id, "worker-a", 1_000, T0), true);
    const completed = queue.complete(high.id, "worker-a", T0);
    assert.equal(completed.state, "completed");

    const second = queue.claimNext({ workerId: "worker-b", leaseDurationMs: 1_000, now: T0 });
    assert.equal(second?.id, low.id);
  } finally {
    fixture.cleanup();
  }
});

test("expired leases are retried and then dead-lettered at max attempts", () => {
  const fixture = createMigratedTestStore();
  try {
    const queue = new WorkerQueue(fixture.store);
    const job = queue.enqueue({
      jobType: "test.expiry",
      payload: {},
      maxAttempts: 2,
      now: T0
    }).job;

    const first = queue.claimNext({ workerId: "worker-a", leaseDurationMs: 1_000, now: T0 });
    assert.equal(first?.id, job.id);
    const second = queue.claimNext({
      workerId: "worker-b",
      leaseDurationMs: 1_000,
      now: plus(1_001)
    });
    assert.equal(second?.id, job.id);
    assert.equal(second?.attempts, 2);

    const none = queue.claimNext({
      workerId: "worker-c",
      leaseDurationMs: 1_000,
      now: plus(2_002)
    });
    assert.equal(none, null);
    assert.equal(queue.getById(job.id)?.state, "dead_letter");
  } finally {
    fixture.cleanup();
  }
});

test("retry delay and permanent failure are persisted", () => {
  const fixture = createMigratedTestStore();
  try {
    const queue = new WorkerQueue(fixture.store);
    const retryJob = queue.enqueue({
      jobType: "test.retry",
      payload: {},
      maxAttempts: 3,
      now: T0
    }).job;
    queue.claimNext({ workerId: "worker-a", leaseDurationMs: 20_000, now: T0 });
    const retry = queue.fail({
      jobId: retryJob.id,
      workerId: "worker-a",
      error: { code: "temporary" },
      retryAt: plus(10_000),
      now: T0
    });
    assert.equal(retry.state, "retry");
    assert.equal(
      queue.claimNext({ workerId: "worker-b", leaseDurationMs: 1_000, now: plus(5_000) }),
      null
    );
    const claimedAgain = queue.claimNext({
      workerId: "worker-b",
      leaseDurationMs: 20_000,
      now: plus(10_000)
    });
    assert.equal(claimedAgain?.id, retryJob.id);
    queue.complete(retryJob.id, "worker-b", plus(10_000));

    const permanent = queue.enqueue({
      jobType: "test.permanent",
      payload: {},
      now: T0
    }).job;
    queue.claimNext({ workerId: "worker-c", leaseDurationMs: 20_000, now: T0 });
    const dead = queue.fail({
      jobId: permanent.id,
      workerId: "worker-c",
      error: { code: "invalid_payload" },
      retryable: false,
      now: T0
    });
    assert.equal(dead.state, "dead_letter");
  } finally {
    fixture.cleanup();
  }
});
