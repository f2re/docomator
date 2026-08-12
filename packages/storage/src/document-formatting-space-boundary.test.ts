import assert from "node:assert/strict";
import test from "node:test";

import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceScopedPublicationRegistry } from "./space-scoped-publications.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";
import { WorkerQueue } from "./queue.js";

const NOW = "2026-08-12T17:30:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "space-boundary-test",
    now: NOW
  };
}

test("0032 rejects cross-space formatting sources and bibliography rows at the database boundary", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const first = spaces.createSpace(
      { key: "format-boundary-a", name: "Форматирование A" },
      context("space-a")
    );
    const second = spaces.createSpace(
      { key: "format-boundary-b", name: "Форматирование B" },
      context("space-b")
    );

    fixture.store.execute((database) => {
      database
        .prepare(
          "INSERT INTO files(id, sha256, original_name, media_type, size_bytes, storage_path, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          "boundary-source-file",
          "a".repeat(64),
          "source.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          10,
          "aa/boundary-source",
          NOW,
          "test"
        );
      database
        .prepare(
          "INSERT INTO document_quarantine_records(id, space_id, file_id, original_name, media_type, format, decision, report_json, created_by, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, 'docx', 'accepted', '{}', ?, ?, ?)"
        )
        .run(
          "boundary-source-record",
          first.id,
          "boundary-source-file",
          "source.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "test",
          "source-correlation",
          NOW
        );
    });

    const queue = new WorkerQueue(fixture.store);
    const workerJob = queue.enqueue({
      jobType: "document.format-standard",
      payload: { spaceId: second.id, settings: { profile: "gost-r-7.0.97-2025" } },
      idempotencyKey: "boundary-format-job",
      now: NOW
    }).job;

    assert.throws(
      () =>
        fixture.store.execute((database) =>
          database
            .prepare(`
              INSERT INTO document_formatting_items(
                id, worker_job_id, space_id, source_record_id, original_name,
                source_sha256, source_size_bytes, state, output_file_id,
                output_name, analysis_json, error_json, created_by,
                correlation_id, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, ?, ?, ?, ?)
            `)
            .run(
              "boundary-format-item",
              workerJob.id,
              second.id,
              "boundary-source-record",
              "source.docx",
              "a".repeat(64),
              10,
              "test",
              "format-correlation",
              NOW,
              NOW
            )
        ),
      /document formatting source belongs to another space/u
    );

    const publications = new SpaceScopedPublicationRegistry(fixture.store);
    const configuration = publications.ensureDefaultConfiguration(
      first.id,
      context("publication-config")
    );
    const knowledge = new SpaceScopedKnowledgeRegistry(fixture.store, first.id, {
      spaces
    });
    const publication = knowledge.createEntity(
      {
        entityTypeKey: configuration.publicationEntityTypeKey,
        displayName: "Публикация пространства A",
        status: "active"
      },
      context("publication-create")
    );

    assert.throws(
      () =>
        fixture.store.execute((database) =>
          database
            .prepare(`
              INSERT INTO publication_bibliography_sources(
                publication_entity_id, space_id, source_format, source_key,
                source_digest, record_json, imported_by, correlation_id, imported_at
              ) VALUES (?, ?, 'bibtex', ?, ?, '{}', ?, ?, ?)
            `)
            .run(
              publication.id,
              second.id,
              "foreign-publication",
              "b".repeat(64),
              "test",
              "bibliography-correlation",
              NOW
            )
        ),
      /publication bibliography source belongs to another space/u
    );
  } finally {
    fixture.cleanup();
  }
});
