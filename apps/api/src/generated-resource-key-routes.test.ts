import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import {
  DocumentScheduleRegistry,
  SqliteStore,
  type CreateDocumentScheduleInput,
  type DocumentScheduleRecord,
  type MutationContext
} from "@docomator/storage";

import { buildApp } from "./app.js";

function migratedFixture(): {
  directory: string;
  store: SqliteStore;
  cleanup: () => void;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-api-keys-"));
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

class CapturingScheduleRegistry extends DocumentScheduleRegistry {
  lastInput: CreateDocumentScheduleInput | null = null;

  override create(
    spaceIdentity: string,
    input: CreateDocumentScheduleInput,
    context: MutationContext
  ): DocumentScheduleRecord {
    this.lastInput = input;
    const now = context.now instanceof Date
      ? context.now.toISOString()
      : context.now ?? "2026-07-15T12:00:00.000Z";
    return {
      id: "schedule-api-generated-id",
      spaceId: spaceIdentity,
      key: input.key ?? "document_schedule.api_generated",
      name: input.name,
      description: input.description ?? null,
      activeReleaseId: input.activeReleaseId,
      templateTitle: "Шаблон",
      groupId: input.groupId,
      groupName: "Группа",
      groupMemberCount: 0,
      targetMode: input.targetMode,
      recurrenceKind: input.recurrenceKind,
      timezone: input.timezone,
      localTime: input.localTime,
      startDate: input.startDate,
      dayOfMonth: input.dayOfMonth ?? null,
      deliveryChannel: input.deliveryChannel,
      emailRecipientId: input.emailRecipientId ?? null,
      emailRecipientName: null,
      emailRecipientEmail: null,
      emailSubject: input.emailSubject ?? null,
      emailMessageText: input.emailMessageText ?? null,
      status: "active",
      nextRunAt: now,
      version: 1,
      createdBy: context.actorId ?? null,
      updatedBy: context.actorId ?? null,
      correlationId: context.correlationId,
      createdAt: now,
      updatedAt: now
    };
  }
}

const headers = {
  "x-correlation-id": "corr-api-generated-keys",
  "x-actor-id": "operator-1"
};

test("recipient and schedule POST accept omitted machine keys", async () => {
  const fixture = migratedFixture();
  const schedules = new CapturingScheduleRegistry(fixture.store);
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal",
      DOCOMATOR_SMTP_ENABLED: "true",
      DOCOMATOR_SMTP_FROM: "docomator@example.test",
      DOCOMATOR_SMTP_ALLOWED_DOMAINS: "example.test"
    }),
    { store: fixture.store, documentScheduleRegistry: schedules }
  );
  try {
    const recipient = await app.inject({
      method: "POST",
      url: "/api/v1/spaces/default/email-recipients",
      headers,
      payload: { name: "Бухгалтерия", email: "accounting@example.test" }
    });
    assert.equal(recipient.statusCode, 201, recipient.body);
    assert.match(
      (recipient.json() as { data: { key: string } }).data.key,
      /^email_recipient\.[a-f0-9]{32}$/u
    );

    const schedule = await app.inject({
      method: "POST",
      url: "/api/v1/spaces/default/document-schedules",
      headers,
      payload: {
        name: "Ежедневные карточки",
        activeReleaseId: "release-id",
        groupId: "group-id",
        targetMode: "one_per_member",
        recurrenceKind: "daily",
        timezone: "Europe/Moscow",
        localTime: "09:00",
        startDate: "2026-07-16",
        deliveryChannel: "none"
      }
    });
    assert.equal(schedule.statusCode, 201, schedule.body);
    assert.equal(schedules.lastInput?.key, undefined);
    assert.equal(
      (schedule.json() as { data: { key: string } }).data.key,
      "document_schedule.api_generated"
    );
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
