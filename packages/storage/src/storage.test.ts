import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ContentAddressedObjectStore } from "./object-store.js";
import { PropertyValueCodecRegistry } from "./property-codec.js";

test("property codecs validate values and create typed projections", () => {
  const codecs = new PropertyValueCodecRegistry();

  assert.deepEqual(codecs.encode("integer", 3), {
    valueType: "integer",
    valueJson: "3",
    valueText: null,
    valueNumber: null,
    valueInteger: 3,
    valueBoolean: null,
    valueDate: null,
    valueDatetime: null,
    valueEntityId: null,
    valueFileId: null
  });
  assert.equal(codecs.encode("date", "2026-07-11").valueDate, "2026-07-11");
  assert.equal(
    codecs.encode("date-time", "2026-07-11T13:00:00+03:00").valueDatetime,
    "2026-07-11T10:00:00.000Z"
  );
  assert.equal(
    codecs.encode("entity-reference", "person-1").valueEntityId,
    "person-1"
  );
  assert.equal(
    codecs.encode("enum", "active", { allowedValues: ["active", "inactive"] }).valueText,
    "active"
  );
  assert.throws(() => codecs.encode("number", Number.NaN), /finite/);
  assert.throws(() => codecs.encode("date", "2026-02-30"), /valid calendar date/);
  assert.throws(
    () => codecs.encode("enum", "unknown", { allowedValues: ["active"] }),
    /not allowed/
  );
});

test("content-addressed object storage is immutable and deduplicated", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-objects-"));
  try {
    const objects = new ContentAddressedObjectStore(path.join(directory, "objects"));
    const first = await objects.putBuffer(Buffer.from("same document", "utf8"));
    const second = await objects.putBuffer(Buffer.from("same document", "utf8"));

    assert.equal(second.sha256, first.sha256);
    assert.equal(second.storagePath, first.storagePath);
    assert.equal(fs.readFileSync(first.storagePath, "utf8"), "same document");
    assert.match(first.relativePath, /^[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
