import assert from "node:assert/strict";
import test from "node:test";

import { DocumentFormattingNotFoundError, DocumentFormattingRegistry } from "./document-formatting.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-08-12T09:00:00.000Z";
function context(id: string) { return { correlationId: id, actorType: "test", actorId: "operator", now: NOW }; }

function source(store: ReturnType<typeof createMigratedTestStore>["store"], spaceId: string, suffix: string): string {
  const fileId = `file-${suffix}`;
  const recordId = `source-${suffix}`;
  store.execute((db) => {
    db.prepare("INSERT INTO files(id,sha256,original_name,media_type,size_bytes,storage_path,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)")
      .run(fileId, suffix.padEnd(64, "0").slice(0,64), `${suffix}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 10, `objects/${suffix}`, NOW, "test");
    db.prepare("INSERT INTO document_quarantine_records(id,space_id,file_id,original_name,media_type,format,decision,report_json,created_by,correlation_id,created_at) VALUES(?,?,?,?,?,'docx','accepted','{}','test','corr-source',?)")
      .run(recordId, spaceId, fileId, `${suffix}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", NOW);
  });
  return recordId;
}

const settings = { profile: "gost-r-7.0.97-2025", fontFamily: "Times New Roman", fontSizePt: 14, lineSpacing: 1.5, firstLineIndentMm: 12.5, marginsMm: { top:20,right:10,bottom:20,left:20 }, bodyAlignment: "both" } as const;

test("batch строго ограничен пространством и одинаковый повтор не создаёт второе задание", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const a = spaces.createSpace({ key: "fmt-a", name: "A" }, context("space-a"));
    const b = spaces.createSpace({ key: "fmt-b", name: "B" }, context("space-b"));
    const sourceA = source(fixture.store, a.id, "a");
    source(fixture.store, b.id, "b");
    const registry = new DocumentFormattingRegistry(fixture.store);
    const first = registry.createJob({ spaceId: a.id, sourceRecordIds: [sourceA], settings }, context("job-a"));
    const repeated = registry.createJob({ spaceId: a.id, sourceRecordIds: [sourceA], settings }, context("job-a-repeat"));
    assert.equal(repeated.id, first.id);
    assert.equal(registry.getJob(a.id, first.id).items.length, 1);
    assert.throws(() => registry.getJob(b.id, first.id), DocumentFormattingNotFoundError);
    assert.throws(() => registry.createJob({ spaceId: b.id, sourceRecordIds: [sourceA], settings }, context("cross-space")), DocumentFormattingNotFoundError);
  } finally { fixture.cleanup(); }
});
