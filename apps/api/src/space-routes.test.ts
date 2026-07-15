import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import { SqliteStore } from "@docomator/storage";

import { buildApp } from "./app.js";

function migratedFixture(): {
  directory: string;
  store: SqliteStore;
  cleanup: () => void;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-api-spaces-"));
  const databasePath = path.join(directory, "docomator.db");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
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
    directory,
    store,
    cleanup: () => {
      store.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

const headers = {
  "x-correlation-id": "corr-api-spaces",
  "x-actor-id": "operator-1"
};

async function createPersonType(app: ReturnType<typeof buildApp>): Promise<void> {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/knowledge/entity-types/person",
    headers
  });
  assert.equal(response.statusCode, 200, response.body);
}

test("spaces API isolates entities and creates aggregate target plan", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );

  try {
    await createPersonType(app);

    const spaceResponse = await app.inject({
      method: "POST",
      url: "/api/v1/spaces",
      headers,
      payload: {
        name: "Инженерная служба",
        description: "Изолированные данные инженерной службы"
      }
    });
    assert.equal(spaceResponse.statusCode, 201, spaceResponse.body);
    const spaceData = (spaceResponse.json() as { data: { id: string; key: string } }).data;
    const spaceId = spaceData.id;
    assert.match(spaceData.key, /^space\.[a-f0-9]{32}$/u);

    const people = [];
    for (const displayName of ["Иванов Иван", "Петров Пётр", "Сидорова Анна"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/spaces/${spaceId}/entities`,
        headers,
        payload: { entityTypeKey: "person", displayName }
      });
      assert.equal(response.statusCode, 201, response.body);
      people.push((response.json() as { data: { entityId: string } }).data.entityId);
    }

    const groupResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaceId}/groups`,
      headers,
      payload: { name: "Выбранные рецензенты" }
    });
    assert.equal(groupResponse.statusCode, 201, groupResponse.body);
    const groupData = (
      groupResponse.json() as { data: { id: string; key: string } }
    ).data;
    const groupId = groupData.id;
    assert.match(groupData.key, /^audience_group\.[a-f0-9]{32}$/u);

    const membersResponse = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/${spaceId}/groups/${groupId}/members`,
      headers,
      payload: { entityIds: [people[2], people[0]] }
    });
    assert.equal(membersResponse.statusCode, 200, membersResponse.body);

    const aggregateResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaceId}/audience-snapshots`,
      headers,
      payload: {
        source: { kind: "group", groupId },
        targetMode: "aggregate"
      }
    });
    assert.equal(aggregateResponse.statusCode, 201, aggregateResponse.body);
    const aggregate = aggregateResponse.json() as {
      data: {
        snapshot: { id: string; memberCount: number };
        plan: {
          documentCount: number;
          collectionPath: string;
          units: Array<{ memberIds: string[] }>;
        };
      };
    };
    assert.equal(aggregate.data.snapshot.memberCount, 2);
    assert.equal(aggregate.data.plan.documentCount, 1);
    assert.equal(aggregate.data.plan.collectionPath, "audience.members");
    assert.deepEqual(aggregate.data.plan.units[0]?.memberIds, [people[2], people[0]]);

    const onePerResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaceId}/audience-snapshots`,
      headers,
      payload: {
        source: { kind: "selected", entityIds: [people[1], people[0]] },
        targetMode: "one_per_member"
      }
    });
    assert.equal(onePerResponse.statusCode, 201, onePerResponse.body);
    const onePer = onePerResponse.json() as {
      data: { plan: { documentCount: number; units: unknown[] } };
    };
    assert.equal(onePer.data.plan.documentCount, 2);
    assert.equal(onePer.data.plan.units.length, 2);

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${spaceId}/entities?limit=500`
    });
    assert.equal(listResponse.statusCode, 200, listResponse.body);
    assert.equal((listResponse.json() as { data: unknown[] }).data.length, 3);
  } finally {
    await app.close();
    fixture.cleanup();
  }
});

test("spaces API rejects cross-space group membership", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );

  try {
    await createPersonType(app);
    const spaces = [];
    for (const [key, name] of [
      ["alpha", "Альфа"],
      ["beta", "Бета"]
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/spaces",
        headers,
        payload: { key, name }
      });
      spaces.push((response.json() as { data: { id: string } }).data.id);
    }

    const foreignEntity = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaces[1]}/entities`,
      headers,
      payload: { entityTypeKey: "person", displayName: "Чужой пользователь" }
    });
    const foreignEntityId = (
      foreignEntity.json() as { data: { entityId: string } }
    ).data.entityId;

    const group = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaces[0]}/groups`,
      headers,
      payload: { key: "team", name: "Команда" }
    });
    const groupId = (group.json() as { data: { id: string } }).data.id;

    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/${spaces[0]}/groups/${groupId}/members`,
      headers,
      payload: { entityIds: [foreignEntityId] }
    });
    assert.equal(response.statusCode, 404, response.body);
    assert.equal(
      (response.json() as { error: { code: string } }).error.code,
      "space_not_found"
    );
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
