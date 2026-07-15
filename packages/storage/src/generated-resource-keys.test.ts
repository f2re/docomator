import assert from "node:assert/strict";
import test from "node:test";

import { EmailRecipientRegistry } from "./email-recipients.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-07-15T11:00:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-1",
    now: NOW
  };
}

test("email recipients generate opaque keys when omitted and keep explicit keys", () => {
  const fixture = createMigratedTestStore();
  try {
    const existing = new EmailRecipientRegistry(fixture.store).create(
      "default",
      {
        key: "email_recipient.collision",
        name: "Первый получатель",
        email: "first@example.test"
      },
      context("recipient-explicit-first")
    );
    assert.equal(existing.key, "email_recipient.collision");

    const keys = ["email_recipient.collision", "email_recipient.generated"];
    const recipients = new EmailRecipientRegistry(fixture.store, {
      keyFactory: () => keys.shift() ?? "email_recipient.unexpected"
    });
    const generated = recipients.create(
      "default",
      { name: "Получатель без ключа", email: "generated@example.test" },
      context("recipient-generated")
    );
    assert.equal(generated.key, "email_recipient.generated");

    const legacy = recipients.create(
      "default",
      {
        key: "legacy-recipient",
        name: "Совместимый получатель",
        email: "legacy@example.test"
      },
      context("recipient-explicit-legacy")
    );
    assert.equal(legacy.key, "legacy-recipient");
  } finally {
    fixture.cleanup();
  }
});
