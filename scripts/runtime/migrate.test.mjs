import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migrationScript = path.resolve("scripts/runtime/migrate.mjs");
const migrationsDirectory = path.resolve("migrations");

function migrationNames() {
  return fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
}

test("bootstrap migration is repeatable", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-migrate-"));
  const env = { ...process.env, DOCOMATOR_DATA_DIR: dataDir };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(process.execPath, [migrationScript], {
      env,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const database = new DatabaseSync(path.join(dataDir, "docomator.db"));
  const migration = database
    .prepare("SELECT name FROM schema_migrations")
    .get();
  const table = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'automation_rules'"
    )
    .get();

  assert.equal(migration.name, "0001_bootstrap.sql");
  assert.equal(table.name, "automation_rules");
  database.close();
});

test("formatter migration preserves old rendering and constrains new contracts", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "docomator-formatter-migrate-")
  );
  const database = new DatabaseSync(path.join(directory, "docomator.db"));
  try {
    database.exec("PRAGMA foreign_keys = ON;");
    for (const name of migrationNames().filter((name) => name < "0023_")) {
      database.exec(
        fs.readFileSync(path.join(migrationsDirectory, name), "utf8")
      );
    }

    const timestamp = "2026-07-16T10:00:00.000Z";
    const sourceSha256 = "a".repeat(64);
    const compiledSha256 = "b".repeat(64);
    const trialSha256 = "c".repeat(64);
    const structureSha256 = "d".repeat(64);
    const insertFile = database.prepare(`
      INSERT INTO files(
        id, sha256, original_name, media_type, size_bytes,
        storage_path, created_at, created_by
      ) VALUES (?, ?, ?, ?, 1, ?, ?, 'migration-test')
    `);
    insertFile.run(
      "file-source",
      sourceSha256,
      "Шаблон.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      `objects/${sourceSha256}`,
      timestamp
    );
    insertFile.run(
      "file-compiled",
      compiledSha256,
      "Шаблон-связанный.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      `objects/${compiledSha256}`,
      timestamp
    );
    insertFile.run(
      "file-trial",
      trialSha256,
      "Шаблон-проверка.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      `objects/${trialSha256}`,
      timestamp
    );
    database
      .prepare(`
        INSERT INTO document_quarantine_records(
          id, space_id, file_id, original_name, media_type, format,
          decision, report_json, created_by, correlation_id, created_at
        ) VALUES (
          'source', '00000000-0000-4000-8000-000000000001', 'file-source',
          'Шаблон.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'docx', 'accepted', '{}', 'migration-test', 'corr-source', ?
        )
      `)
      .run(timestamp);
    database
      .prepare(`
        INSERT INTO template_drafts(
          id, space_id, source_record_id, title, format, source_sha256,
          structure_version, structure_sha256, structure_json,
          structure_truncated, status, version, created_by,
          correlation_id, created_at, updated_at
        ) VALUES (
          'draft', '00000000-0000-4000-8000-000000000001', 'source',
          'Старый шаблон', 'docx', ?, 1, ?, '{"elements":[]}',
          0, 'draft', 1, 'migration-test', 'corr-draft', ?, ?
        )
      `)
      .run(sourceSha256, structureSha256, timestamp, timestamp);
    database
      .prepare(`
        INSERT INTO template_draft_fields(
          id, draft_id, field_key, label, value_type, required,
          element_id, element_kind, binding_json, original_preview,
          structure_sha256, version, created_by, correlation_id,
          created_at, updated_at
        ) VALUES (
          'field', 'draft', 'person.rate', 'Ставка', 'number', 0,
          'paragraph-1', 'paragraph', '{}', '0', ?, 1,
          'migration-test', 'corr-field', ?, ?
        )
      `)
      .run(structureSha256, timestamp, timestamp);
    database
      .prepare(`
        INSERT INTO template_test_versions(
          id, space_id, draft_id, field_id, version_number, format,
          compiled_file_id, trial_file_id, compiled_sha256, trial_sha256,
          technical_binding_json, sample_value_json, rendered_value,
          read_back_value, verification_json, status, created_by,
          correlation_id, created_at
        ) VALUES (
          'single-version', '00000000-0000-4000-8000-000000000001',
          'draft', 'field', 1, 'docx', 'file-compiled', 'file-trial', ?, ?,
          '{}', '12.5', '12.5', '12.5', '{}', 'tested',
          'migration-test', 'corr-single', ?
        )
      `)
      .run(compiledSha256, trialSha256, timestamp);
    database
      .prepare(`
        INSERT INTO template_multi_test_versions(
          id, space_id, draft_id, version_number, format,
          compiled_file_id, trial_file_id, compiled_sha256, trial_sha256,
          sample_values_json, verification_json, field_count, status,
          created_by, correlation_id, created_at
        ) VALUES (
          'multi-version', '00000000-0000-4000-8000-000000000001',
          'draft', 2, 'docx', 'file-compiled', 'file-trial', ?, ?,
          '{"person.rate":12.5}', '{}', 1, 'tested',
          'migration-test', 'corr-multi', ?
        )
      `)
      .run(compiledSha256, trialSha256, timestamp);
    database
      .prepare(`
        INSERT INTO template_multi_test_version_fields(
          test_version_id, field_id, ordinal, field_key, field_label,
          value_type, required, binding_json, technical_binding_json,
          sample_value_json, rendered_value, read_back_value, verification_json
        ) VALUES (
          'multi-version', 'field', 0, 'person.rate', 'Ставка',
          'number', 0, '{}', '{}', '12.5', '12.5', '12.5', '{}'
        )
      `)
      .run();

    database.exec(
      fs.readFileSync(
        path.join(migrationsDirectory, "0023_template_field_formatters.sql"),
        "utf8"
      )
    );

    const legacy = '{"version":1,"kind":"legacy"}';
    assert.equal(
      database
        .prepare("SELECT formatter_json FROM template_draft_fields WHERE id = 'field'")
        .get().formatter_json,
      legacy
    );
    assert.equal(
      database
        .prepare(
          "SELECT formatter_json FROM template_multi_test_version_fields WHERE test_version_id = 'multi-version'"
        )
        .get().formatter_json,
      legacy
    );
    assert.deepEqual(
      database
        .prepare(
          "SELECT DISTINCT formatter_json FROM template_release_candidate_fields ORDER BY formatter_json"
        )
        .all()
        .map((row) => row.formatter_json),
      [legacy]
    );
    assert.throws(() =>
      database
        .prepare("UPDATE template_draft_fields SET formatter_json = '[]' WHERE id = 'field'")
        .run()
    );
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
