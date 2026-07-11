# План реализации Docomator

План организован по работающим вертикальным инкрементам. Каждый milestone должен оставлять систему запускаемой и проверяемой.

## Правила выполнения

- Реализуемые PR должны ссылаться на IDs из [REQUIREMENTS.md](REQUIREMENTS.md).
- Сначала детерминированное ядро, затем LLM-ускорение.
- Read-heavy exploration допускает параллельных Codex agents; write-heavy задачи разделяются по непересекающимся каталогам.
- Новая production dependency требует обоснования в PR; архитектурная dependency — ADR.
- Milestone не закрывается без tests, docs, migration/rollback notes и offline impact assessment.

## M0. Repository bootstrap — текущий инкремент

**Цель:** создать запускаемую и сопровождаемую основу проекта.

Состав:

- npm workspaces, Node.js 24 LTS, TypeScript strict;
- Fastify API с health/readiness/system info;
- worker lifecycle и graceful shutdown;
- SQLite migration runner и bootstrap schema;
- нормативные requirements, architecture, roadmap и ADR;
- Codex `AGENTS.md`, project config и custom subagents;
- offline bundle preparation, install, update, checksum и rollback;
- CI для build/test/docs/shell syntax.

Definition of Done:

- `npm ci && npm run check` проходит;
- migration повторяемо создаёт БД;
- API ready после migration;
- bundle script проходит dry build с `--without-llm`;
- install/update scripts проходят `bash -n` и network-free smoke test в временных каталогах;
- draft PR содержит весь bootstrap.

## M1. Persistence kernel и persistent queue

**Требования:** DATA-001—012, QUE-001—007, AUD-001—004.

Работы:

1. repository ports и SQLite adapters;
2. typed property validation и provenance;
3. content-addressed file storage;
4. worker claim/lease/retry/dead-letter;
5. audit append service и correlation IDs;
6. transactional outbox writer/consumer;
7. API CRUD для entity types, entities и properties.

Tests:

- concurrent claim;
- expired lease recovery;
- idempotency unique violation;
- historical property resolution;
- file hash deduplication;
- transaction rollback/outbox consistency.

Definition of Done: перезапуск worker не теряет job; API CRUD работает на production schema; backup/restore test проходит.

## M2. Secure OOXML intake и Document IR

**Требования:** TPL-001—004, SEC-002—003, SEC-009.

Работы:

1. upload limits и MIME/ZIP checks;
2. safe ZIP reader с compressed/uncompressed limits;
3. relationship inventory и compatibility report;
4. DOCX IR: parts, paragraphs, runs, tables, headers/footers;
5. XLSX IR: workbook, sheets, cells, tables, defined names;
6. structural HTML/grid previews с stable node IDs;
7. manual field selection API.

Fixtures:

- normal DOCX/XLSX;
- split runs;
- nested tables;
- headers/footers;
- external links;
- macro-enabled/unsupported;
- ZIP bomb/path traversal/XML attack samples.

Definition of Done: пользователь вручную размечает scalar candidate, а backend сохраняет проверяемую IR coordinate.

## M3. Template compiler и Safe Scalar renderer

**Требования:** TPL-005—013, DOC-005—010, OFF-008.

Работы:

1. template manifest JSON Schema;
2. DOCX `w:sdt` compiler;
3. XLSX defined-name compiler и `_AI_META`;
4. immutable template versions;
5. scalar renderer и formatter registry;
6. structural validation/reverse-read;
7. LibreOffice preview adapter;
8. regression fixtures и activation gate.

Definition of Done: неизвестный DOCX/XLSX проходит upload → manual mapping → compile → test render → activation → repeated deterministic render.

## M4. Manual document workflow и dynamic UI

**Требования:** DOC-001—004, FLD-001—010, IAM-001—006.

Работы:

1. authentication/RBAC baseline;
2. template catalog и search;
3. document job state machine;
4. JSON Schema dynamic forms;
5. entity picker и ambiguity resolution;
6. field source policy и provenance UI;
7. review/approve/download flow;
8. multi-file bundles.

Definition of Done: пользователь создаёт документ через каталог и форму без LLM.

## M5. Local LLM agents

**Требования:** AI-001—011.

Работы:

1. llama-server client, timeouts и health;
2. AgentSpec registry и prompt versioning;
3. JSON Schema constrained outputs;
4. Template Router, Field Detector, Schema Mapper;
5. Value Extractor/Resolver и Format Planner;
6. repair/fallback/review flows;
7. Russian evaluation set и model benchmark;
8. prompt-injection negative tests.

Definition of Done: LLM ускоряет mapping/filling, но выключение llama-server оставляет manual flow рабочим.

## M6. Structured rendering и generated content

**Требования:** FLD-009, DOC-004, AI-008, AUT-019.

Работы:

1. repeat rows/ranges и conditional blocks;
2. RichTextBlocks contract;
3. Text Composer и evidence mapping;
4. Quality Reviewer;
5. review-required policy;
6. article ingestion/chunking для рецензий;
7. multi-document packages.

Definition of Done: письмо и рецензия формируются с обязательным review; повторяющиеся таблицы проходят regression tests.

## M7. Automation engine

**Требования:** AUT-001—019, QUE-001—007.

Работы:

1. automation rule JSON Schema и UI builder;
2. persistent scheduler и timezone/business calendars;
3. missed-run policies;
4. event API и domain-event consumers;
5. declarative filter DSL;
6. target selection/grouping/aggregation;
7. run idempotency и dry-run;
8. review tasks и operator queue.

Definition of Done: schedule и duplicated external event дают ожидаемое число runs и переживают restart.

## M8. Delivery и operations

**Требования:** MAIL-001—009, SHARE-001—008, NFR-001—010.

Работы:

1. SMTP adapter и deterministic Message-ID;
2. recipient allowlist and policies;
3. network root registry, mount/sentinel checks;
4. atomic file writer и collision policies;
5. delivery retry/unknown/partial success;
6. operational dashboard, metrics и alerts;
7. retention/legal hold;
8. backup/restore and integrity scan.

Definition of Done: AC-005—AC-010 проходят на offline test VM.

## M9. Pilot hardening

Работы:

- реальные шаблоны заказчика по всем compatibility levels;
- performance benchmark на целевом CPU;
- security review и recovery drills;
- LibreOffice/Microsoft Office compatibility matrix;
- administrator/template-editor/operator manuals;
- release candidate и production baseline.

Definition of Done: выполнены AC-001—AC-014 и подписан пилотный протокол.

## Ближайший backlog после bootstrap

1. Выделить `packages/storage` и реализовать repository transaction boundary.
2. Реализовать `worker_jobs` claim/lease/retry с concurrency tests.
3. Реализовать content-addressed storage и safe filename API.
4. Добавить CRUD entity types/properties/entities.
5. Создать первый upload endpoint с размерными лимитами и quarantine storage.
6. Зафиксировать Document IR v1 JSON Schema.
