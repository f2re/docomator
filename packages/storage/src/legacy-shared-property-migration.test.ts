import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SqliteStore } from "./database.js";
import { KnowledgeNotFoundError, KnowledgeRegistry } from "./knowledge.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceRegistry } from "./spaces.js";

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../migrations"
);

function migrationFiles(): string[] {
  return fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
}

function applyMigrations(databasePath: string, from: string, through: string): void {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  try {
    for (const migration of migrationFiles()) {
      if (migration < from || migration > through) continue;
      database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
    }
  } finally {
    database.close();
  }
}

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator",
    now: "2026-08-07T16:00:00.000Z"
  };
}

test("0029 splits a pre-0027 shared definition and preserves the historical key as a per-space alias", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-legacy-property-upgrade-"));
  const databasePath = path.join(directory, "docomator.db");
  try {
    applyMigrations(databasePath, "0001_bootstrap.sql", "0026_publication_reporting.sql");
    let store = new SqliteStore({ databasePath });
    const spaces = new SpaceRegistry(store);
    const knowledge = new KnowledgeRegistry(store);
    const alpha = spaces.createSpace({ key: "alpha", name: "Альфа" }, context("space-alpha"));
    const beta = spaces.createSpace({ key: "beta", name: "Бета" }, context("space-beta"));
    const gamma = spaces.createSpace({ key: "gamma", name: "Гамма" }, context("space-gamma"));
    const alphaEntity = spaces.createEntity(
      alpha.id,
      { entityTypeKey: "person", displayName: "Иванов Иван" },
      context("entity-alpha")
    );
    const betaEntity = spaces.createEntity(
      beta.id,
      { entityTypeKey: "person", displayName: "Петров Пётр" },
      context("entity-beta")
    );
    const legacy = knowledge.createPropertyDefinition(
      {
        key: "person.legacy_department",
        label: "Подразделение",
        valueType: "string",
        sensitivity: "personal",
        appliesTo: ["person"]
      },
      context("legacy-field")
    );
    knowledge.appendPropertyValue(
      {
        entityId: alphaEntity.entityId,
        propertyKey: legacy.key,
        value: "Альфа-отдел",
        sourceType: "legacy"
      },
      context("alpha-value")
    );
    knowledge.appendPropertyValue(
      {
        entityId: betaEntity.entityId,
        propertyKey: legacy.key,
        value: "Бета-отдел",
        sourceType: "legacy"
      },
      context("beta-value")
    );
    store.close();

    applyMigrations(
      databasePath,
      "0027_space_property_isolation.sql",
      "0029_normalize_legacy_shared_properties.sql"
    );

    store = new SqliteStore({ databasePath });
    try {
      const alphaKnowledge = new SpaceScopedKnowledgeRegistry(store, alpha.id);
      const betaKnowledge = new SpaceScopedKnowledgeRegistry(store, beta.id);
      const gammaKnowledge = new SpaceScopedKnowledgeRegistry(store, gamma.id);
      const alphaClone = alphaKnowledge.getPropertyDefinition(legacy.key);
      const betaClone = betaKnowledge.getPropertyDefinition(legacy.key);

      assert.notEqual(alphaClone.id, legacy.id);
      assert.notEqual(betaClone.id, legacy.id);
      assert.notEqual(alphaClone.id, betaClone.id);
      assert.notEqual(alphaClone.key, betaClone.key);
      assert.equal(alphaClone.label, legacy.label);
      assert.equal(betaClone.label, legacy.label);
      assert.deepEqual(
        alphaKnowledge.listPropertyValueHistory(alphaEntity.entityId, {
          propertyKey: legacy.key
        }).map((record) => record.value),
        ["Альфа-отдел"]
      );
      assert.deepEqual(
        betaKnowledge.listPropertyValueHistory(betaEntity.entityId, {
          propertyKey: legacy.key
        }).map((record) => record.value),
        ["Бета-отдел"]
      );
      assert.throws(
        () => gammaKnowledge.getPropertyDefinition(legacy.key),
        KnowledgeNotFoundError
      );
      assert.throws(
        () => gammaKnowledge.adoptUnownedPropertyDefinition(legacy.key),
        KnowledgeNotFoundError
      );

      alphaKnowledge.appendPropertyValue(
        {
          entityId: alphaEntity.entityId,
          propertyKey: legacy.key,
          value: "Новый Альфа-отдел",
          sourceType: "test"
        },
        context("alpha-update")
      );
      assert.deepEqual(
        alphaKnowledge.listPropertyValueHistory(alphaEntity.entityId, {
          propertyKey: legacy.key
        }).map((record) => record.value),
        ["Новый Альфа-отдел", "Альфа-отдел"]
      );
      assert.deepEqual(
        betaKnowledge.listPropertyValueHistory(betaEntity.entityId, {
          propertyKey: legacy.key
        }).map((record) => record.value),
        ["Бета-отдел"]
      );

      const diagnostics = store.execute((database) =>
        database
          .prepare("SELECT COUNT(*) AS count FROM legacy_shared_property_definitions")
          .get() as { count: number }
      );
      assert.equal(Number(diagnostics.count), 0);
      const aliases = store.execute((database) =>
        database
          .prepare(`
            SELECT space_id, alias_key, property_definition_id
            FROM space_property_definition_aliases
            WHERE alias_key = ?
            ORDER BY space_id ASC
          `)
          .all(legacy.key) as unknown as Array<{
          space_id: string;
          alias_key: string;
          property_definition_id: string;
        }>
      );
      assert.deepEqual(
        aliases.map((row) => row.space_id).sort(),
        [alpha.id, beta.id].sort()
      );
    } finally {
      store.close();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
