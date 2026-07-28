import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeRegistry } from "./knowledge.js";
import {
  DEFAULT_SPACE_COLOR,
  DEFAULT_SPACE_ID,
  SpaceConflictError,
  SpaceNotFoundError,
  SpaceRegistry,
  SpaceValidationError
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

test("space colors persist, normalize and can be updated without moving data", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    assert.equal(spaces.getSpace(DEFAULT_SPACE_ID).color, DEFAULT_SPACE_COLOR);

    const created = spaces.createSpace(
      {
        key: "colored",
        name: "Цветное пространство",
        description: "Исходное описание",
        color: "#3d9472"
      },
      context("corr-colored")
    );
    assert.equal(created.color, "#3D9472");
    assert.equal(created.version, 1);

    const updated = spaces.updateSpace(
      created.id,
      {
        name: "Инженерная служба",
        description: "Отдельные люди, группы и документы",
        color: "#7568e8"
      },
      context("corr-colored-update")
    );
    assert.equal(updated.name, "Инженерная служба");
    assert.equal(updated.description, "Отдельные люди, группы и документы");
    assert.equal(updated.color, "#7568E8");
    assert.equal(updated.version, 2);
    assert.equal(spaces.getSpace(created.id).color, "#7568E8");

    assert.throws(
      () =>
        spaces.updateSpace(
          created.id,
          { color: "violet" },
          context("corr-colored-invalid")
        ),
      SpaceValidationError
    );
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

test("legacy space memberships do not create or restrict application access", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const finance = spaces.createSpace(
      { key: "finance", name: "Финансовая служба" },
      context("corr-space", "owner-1")
    );
    spaces.createSpace(
      { key: "legal", name: "Юридическая служба" },
      context("corr-legal", "owner-2")
    );

    const membershipCount = fixture.store.execute((connection) =>
      connection
        .prepare("SELECT COUNT(*) AS count FROM space_actor_memberships")
        .get() as { count: number }
    );
    assert.equal(membershipCount.count, 0);

    const visibleBeforeLegacyRow = spaces.listSpaces().map((item) => item.id);
    fixture.store.execute((connection) => {
      connection
        .prepare(`
          INSERT INTO space_actor_memberships(
            space_id, actor_id, role, status, version, created_at, updated_at
          ) VALUES (?, 'legacy-user', 'viewer', 'active', 1, ?, ?)
        `)
        .run(finance.id, T0, T0);
    });

    assert.deepEqual(
      spaces.listSpaces().map((item) => item.id),
      visibleBeforeLegacyRow
    );
  } finally {
    fixture.cleanup();
  }
});


test("groups and document snapshots keep one arbitrary entity type", () => {
  const fixture = createMigratedTestStore();
  try {
    const knowledge = new KnowledgeRegistry(fixture.store);
    const spaces = new SpaceRegistry(fixture.store);
    knowledge.createEntityType(
      { key: "room", label: "Аудитория" },
      context("corr-room-type")
    );
    knowledge.createEntityType(
      { key: "article", label: "Научная статья" },
      context("corr-article-type")
    );
    const space = spaces.createSpace(
      { key: "generic", name: "Произвольные объекты" },
      context("corr-generic-space")
    );
    const room = spaces.createEntity(
      space.id,
      { entityTypeKey: "room", displayName: "Аудитория 101" },
      context("corr-room")
    );
    const article = spaces.createEntity(
      space.id,
      { entityTypeKey: "article", displayName: "Статья о прогнозе" },
      context("corr-article")
    );
    const group = spaces.createGroup(
      space.id,
      { key: "rooms", name: "Аудитории" },
      context("corr-group")
    );

    assert.throws(
      () =>
        spaces.replaceGroupMembers(
          space.id,
          group.id,
          [room.entityId, article.entityId],
          context("corr-mixed-group")
        ),
      SpaceValidationError
    );

    spaces.replaceGroupMembers(
      space.id,
      group.id,
      [room.entityId],
      context("corr-room-group")
    );
    const typedGroup = spaces.listGroups(space.id).find(
      (candidate) => candidate.id === group.id
    );
    assert.ok(typedGroup);
    assert.equal(typedGroup.entityTypeKey, "room");
    assert.equal(typedGroup.entityTypeLabel, "Аудитория");
    const grouped = spaces.createAudienceSnapshot(
      space.id,
      { source: { kind: "group", groupId: group.id }, targetMode: "aggregate" },
      context("corr-room-snapshot")
    );
    assert.equal(grouped.snapshot.entityTypeKey, "room");
    assert.deepEqual(grouped.snapshot.members.map((member) => member.entityTypeKey), ["room"]);

    assert.throws(
      () =>
        spaces.createAudienceSnapshot(
          space.id,
          { source: { kind: "all_space" }, targetMode: "aggregate" },
          context("corr-mixed-snapshot")
        ),
      SpaceValidationError
    );
    const filtered = spaces.createAudienceSnapshot(
      space.id,
      {
        source: { kind: "all_space", entityTypeKey: "article" },
        targetMode: "one_per_member"
      },
      context("corr-article-snapshot")
    );
    assert.equal(filtered.snapshot.entityTypeKey, "article");
    assert.deepEqual(filtered.snapshot.members.map((member) => member.entityId), [article.entityId]);
  } finally {
    fixture.cleanup();
  }
});
