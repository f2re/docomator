import assert from "node:assert/strict";
import test from "node:test";

import { AuditRepository } from "./audit.js";
import {
  DomainEventIdempotencyConflictError,
  DomainEventOutbox
} from "./outbox.js";
import { createMigratedTestStore } from "./test-helpers.js";

const T0 = "2026-07-11T10:00:00.000Z";

function plus(milliseconds: number): string {
  return new Date(new Date(T0).getTime() + milliseconds).toISOString();
}

test("business mutation, outbox event and audit share one transaction", () => {
  const fixture = createMigratedTestStore();
  try {
    const outbox = new DomainEventOutbox(fixture.store);
    const audit = new AuditRepository(fixture.store);

    assert.throws(
      () =>
        fixture.store.transaction((database) => {
          database
            .prepare(`
              INSERT INTO entity_types(id, key, label, schema_json, created_at, updated_at)
              VALUES (?, ?, ?, '{}', ?, ?)
            `)
            .run("type-rollback", "rollback", "Rollback", T0, T0);
          outbox.append(
            {
              eventType: "entity_type.created",
              schemaVersion: 1,
              source: "test",
              payload: { id: "type-rollback" },
              dedupeKey: "event-rollback",
              now: T0
            },
            database
          );
          audit.record(
            {
              actorType: "test",
              action: "create",
              objectType: "entity_type",
              objectId: "type-rollback",
              correlationId: "corr-rollback",
              occurredAt: T0
            },
            database
          );
          throw new Error("roll back all records");
        }),
      /roll back all records/
    );

    const counts = fixture.store.execute((database) => ({
      entities: (database.prepare("SELECT COUNT(*) AS count FROM entity_types").get() as { count: number }).count,
      events: (database.prepare("SELECT COUNT(*) AS count FROM domain_events").get() as { count: number }).count,
      audit: (database.prepare("SELECT COUNT(*) AS count FROM audit_log").get() as { count: number }).count
    }));
    assert.deepEqual(counts, { entities: 1, events: 0, audit: 0 });

    fixture.store.transaction((database) => {
      database
        .prepare(`
          INSERT INTO entity_types(id, key, label, schema_json, created_at, updated_at)
          VALUES (?, ?, ?, '{}', ?, ?)
        `)
        .run("type-commit", "commit", "Commit", T0, T0);
      outbox.append(
        {
          eventType: "entity_type.created",
          schemaVersion: 1,
          source: "test",
          payload: { id: "type-commit" },
          dedupeKey: "event-commit",
          now: T0
        },
        database
      );
      audit.record(
        {
          actorType: "test",
          action: "create",
          objectType: "entity_type",
          objectId: "type-commit",
          correlationId: "corr-commit",
          occurredAt: T0
        },
        database
      );
    });
    assert.equal(audit.listByCorrelation("corr-commit").length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("outbox append is idempotent and rejects conflicting reuse", () => {
  const fixture = createMigratedTestStore();
  try {
    const outbox = new DomainEventOutbox(fixture.store);
    const first = outbox.append({
      eventType: "person.updated",
      schemaVersion: 1,
      source: "test",
      payload: { beta: 2, alpha: 1 },
      dedupeKey: "person-1-v2",
      now: T0
    });
    const second = outbox.append({
      eventType: "person.updated",
      schemaVersion: 1,
      source: "test",
      payload: { alpha: 1, beta: 2 },
      dedupeKey: "person-1-v2",
      now: T0
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.event.id, first.event.id);
    assert.throws(
      () =>
        outbox.append({
          eventType: "person.updated",
          schemaVersion: 1,
          source: "test",
          payload: { alpha: 9 },
          dedupeKey: "person-1-v2",
          now: T0
        }),
      DomainEventIdempotencyConflictError
    );
  } finally {
    fixture.cleanup();
  }
});

test("outbox leases provide at-least-once retry and dead-letter semantics", () => {
  const fixture = createMigratedTestStore();
  try {
    const outbox = new DomainEventOutbox(fixture.store);
    const event = outbox.append({
      eventType: "test.expiry",
      schemaVersion: 1,
      source: "test",
      payload: {},
      dedupeKey: "event-expiry",
      maxDispatchAttempts: 2,
      now: T0
    }).event;

    assert.equal(outbox.claimNext("worker-a", 1_000, T0)?.id, event.id);
    const second = outbox.claimNext("worker-b", 1_000, plus(1_001));
    assert.equal(second?.id, event.id);
    assert.equal(second?.dispatchAttempts, 2);
    assert.equal(outbox.claimNext("worker-c", 1_000, plus(2_002)), null);
    assert.equal(outbox.getById(event.id)?.dispatchState, "dead_letter");
  } finally {
    fixture.cleanup();
  }
});

test("outbox retry delay and publish acknowledgement are persisted", () => {
  const fixture = createMigratedTestStore();
  try {
    const outbox = new DomainEventOutbox(fixture.store);
    const event = outbox.append({
      eventType: "test.publish",
      schemaVersion: 1,
      source: "test",
      payload: {},
      dedupeKey: "event-publish",
      now: T0
    }).event;
    outbox.claimNext("worker-a", 20_000, T0);
    const retry = outbox.fail(
      event.id,
      "worker-a",
      { code: "temporary" },
      { retryAt: plus(10_000), now: T0 }
    );
    assert.equal(retry.dispatchState, "retry");
    assert.equal(outbox.claimNext("worker-b", 1_000, plus(5_000)), null);
    assert.equal(outbox.claimNext("worker-b", 20_000, plus(10_000))?.id, event.id);
    const published = outbox.markPublished(event.id, "worker-b", plus(10_000));
    assert.equal(published.dispatchState, "published");
    assert.equal(published.publishedAt, plus(10_000));
  } finally {
    fixture.cleanup();
  }
});
