import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeRegistry } from "./knowledge.js";
import {
  DEFAULT_SPACE_ID,
  SpaceConflictError,
  SpaceNotFoundError,
  SpaceRegistry
} from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const T0 = "2026-07-12T09:00:00.000Z";

function context(correlationId: string, actorId = "operator-1") {
  return {
    correlationId,
    actorType: "test",
    actorId,
    now: T0
  };
}

test("spaces isolate entities and preserve default ownership", () => {
  const fixture = createMigratedTestStore();
  try {
    const knowledge = new KnowledgeRegistry(fixture.store);
    const spaces = new SpaceRegistry(fixture.store);

    const legacyPerson = knowledge.createEntity(
      { entityTypeKey: "person", displayName: "Системный пользователь" },
      context("corr-legacy-person")
    );
    assert.equal(
      spaces.listEntities(DEFAULT_SPACE_ID).some((entity) => entity.entityId === legacyPerson.id),
      true
    );

    const alpha = spaces.createSpace(
      { key: "alpha", name: "Отдел Альфа" },
      context("corr-alpha")
    );
    const beta = spaces.createSpace(
      { key: "beta", name: "Отдел Бета" },
      context("corr-beta")
    );
    const alphaPerson = spaces.createEntity(
      alpha.id,
      { entityTypeKey: "person", displayName: "Иванов Иван" },
      context("corr-alpha-person")
    );
    const betaPerson = spaces.createEntity(
      beta.id,
      { entityTypeKey: "person", displayName: "Петров Пётр" },
      context("corr-beta-person")
    );

    assert.deepEqual(
      spaces.listEntities(alpha.id).map((entity) => entity.entityId),
      [alphaPerson.entityId]
    );
    assert.deepEqual(
      spaces.listEntities(beta.id).map((entity) => entity.entityId),
      [betaPerson.entityId]
    );
    assert.equal(spaces.getSpace(alpha.id).entityCount, 1);
    assert.equal(spaces.getSpace(beta.id).entityCount, 1);
  } finally {
    fixture.cleanup();
  }
});

test("audience snapshots build one-per-member and aggregate document plans", () => {
  const fixture = createMigratedTestStore();
  try {
    const knowledge = new KnowledgeRegistry(fixture.store);
    const spaces = new SpaceRegistry(fixture.store);
    const space = spaces.createSpace(
      { key: "north", name: "Северное подразделение" },
      context("corr-space")
    );
    const first = spaces.createEntity(
      space.id,
      { entityTypeKey: "person", displayName: "Анна Алексеева" },
      context("corr-first")
    );
    const second = spaces.createEntity(
      space.id,
      { entityTypeKey: "person", displayName: "Борис Борисов" },
      context("corr-second")
    );
    const third = spaces.createEntity(
      space.id,
      { entityTypeKey: "person", displayName: "Виктор Викторов" },
      context("corr-third")
    );

    const group = spaces.createGroup(
      space.id,
      { key: "reviewers", name: "Рецензенты" },
      context("corr-group")
    );
    const groupMembers = spaces.replaceGroupMembers(
      space.id,
      group.id,
      [second.entityId, first.entityId, second.entityId],
      context("corr-group-members")
    );
    assert.deepEqual(
      groupMembers.map((member) => member.entityId),
      [second.entityId, first.entityId]
    );

    const aggregate = spaces.createAudienceSnapshot(
      space.id,
      {
        source: { kind: "group", groupId: group.id },
        targetMode: "aggregate"
      },
      context("corr-aggregate")
    );
    assert.equal(aggregate.snapshot.memberCount, 2);
    assert.equal(aggregate.plan.documentCount, 1);
    assert.equal(aggregate.plan.collectionPath, "audience.members");
    assert.deepEqual(aggregate.plan.units[0]?.memberIds, [second.entityId, first.entityId]);

    const onePerMember = spaces.createAudienceSnapshot(
      space.id,
      {
        source: {
          kind: "selected",
          entityIds: [third.entityId, first.entityId, third.entityId]
        },
        targetMode: "one_per_member"
      },
      context("corr-one-per")
    );
    assert.equal(onePerMember.snapshot.memberCount, 2);
    assert.equal(onePerMember.plan.documentCount, 2);
    assert.deepEqual(
      onePerMember.plan.units.map((unit) => unit.primaryEntityId),
      [third.entityId, first.entityId]
    );
    assert.deepEqual(
      spaces.getAudienceSnapshot(space.id, aggregate.snapshot.id).plan,
      aggregate.plan
    );

    assert.throws(
      () =>
        fixture.store.execute((database) =>
          database
            .prepare("UPDATE audience_snapshots SET member_count = 99 WHERE id = ?")
            .run(aggregate.snapshot.id)
        ),
      /immutable/
    );
  } finally {
    fixture.cleanup();
  }
});

test("cross-space members are rejected before group or snapshot mutation", () => {
  const fixture = createMigratedTestStore();
  try {
    const knowledge = new KnowledgeRegistry(fixture.store);
    const spaces = new SpaceRegistry(fixture.store);
    const alpha = spaces.createSpace(
      { key: "alpha", name: "Альфа" },
      context("corr-alpha")
    );
    const beta = spaces.createSpace(
      { key: "beta", name: "Бета" },
      context("corr-beta")
    );
    const alphaPerson = spaces.createEntity(
      alpha.id,
      { entityTypeKey: "person", displayName: "Пользователь Альфа" },
      context("corr-alpha-person")
    );
    const betaPerson = spaces.createEntity(
      beta.id,
      { entityTypeKey: "person", displayName: "Пользователь Бета" },
      context("corr-beta-person")
    );
    const group = spaces.createGroup(
      alpha.id,
      { key: "team", name: "Команда" },
      context("corr-group")
    );

    assert.throws(
      () =>
        spaces.replaceGroupMembers(
          alpha.id,
          group.id,
          [alphaPerson.entityId, betaPerson.entityId],
          context("corr-cross-group")
        ),
      SpaceNotFoundError
    );
    assert.equal(spaces.listGroupMembers(alpha.id, group.id).length, 0);

    assert.throws(
      () =>
        spaces.createAudienceSnapshot(
          alpha.id,
          {
            source: {
              kind: "selected",
              entityIds: [alphaPerson.entityId, betaPerson.entityId]
            },
            targetMode: "aggregate"
          },
          context("corr-cross-snapshot")
        ),
      SpaceNotFoundError
    );
    assert.equal(spaces.listAudienceSnapshots(alpha.id).length, 0);

    spaces.replaceGroupMembers(
      alpha.id,
      group.id,
      [alphaPerson.entityId],
      context("corr-group-valid")
    );
    assert.throws(
      () => spaces.assignEntity(beta.id, alphaPerson.entityId, context("corr-move")),
      SpaceConflictError
    );
  } finally {
    fixture.cleanup();
  }
});

test("space actor memberships are versioned and scoped", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const space = spaces.createSpace(
      { key: "finance", name: "Финансовая служба" },
      context("corr-space", "owner-1")
    );
    const owner = spaces.listActorMemberships(space.id)[0];
    assert.equal(owner?.actorId, "owner-1");
    assert.equal(owner?.role, "owner");

    const editor = spaces.upsertActorMembership(
      space.id,
      { actorId: "editor-1", role: "editor" },
      context("corr-editor", "owner-1")
    );
    assert.equal(editor.version, 1);
    const viewer = spaces.upsertActorMembership(
      space.id,
      { actorId: "editor-1", role: "viewer" },
      context("corr-viewer", "owner-1")
    );
    assert.equal(viewer.version, 2);
    assert.deepEqual(
      spaces.listSpaces({ actorId: "editor-1" }).map((item) => item.id),
      [space.id]
    );
  } finally {
    fixture.cleanup();
  }
});
