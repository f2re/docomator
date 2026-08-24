# Требования к продукту «Оформлятор»

Версия: **2.5-draft**
Статус: **нормативный документ проекта**
Последнее обновление: **2026-08-21**

Ключевые слова **MUST**, **SHOULD**, **MAY** определяют обязательность. Этот файл — первичный источник продуктовых требований. ADR уточняют архитектурные решения, но не могут молча ослаблять MUST.

Связанные документы: [TECHNICAL_SPECIFICATION.md](TECHNICAL_SPECIFICATION.md), [UX_UI_SPECIFICATION.md](UX_UI_SPECIFICATION.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY](../SECURITY.md), [SPACES_AND_AUDIENCES.md](SPACES_AND_AUDIENCES.md), [ENTITY_MODEL_AND_IMPORT.md](ENTITY_MODEL_AND_IMPORT.md), [OFFLINE_DEPLOYMENT.md](OFFLINE_DEPLOYMENT.md), [ADR-0011](adr/0011-shared-access-code-gate.md).

## 1. Система

| ID | Требование | Приоритет |
|---|---|---:|
| SYS-001 | Runtime после установки должен полноценно работать без Internet. | MUST |
| SYS-002 | Целевые ОС — Debian GNU/Linux и Astra Linux Special Edition 1.7 x86-64; иные платформы только после отдельной проверки. | MUST |
| SYS-003 | Основная runtime-среда — зафиксированная LTS Node.js из offline bundle. | MUST |
| SYS-004 | Необязательная локальная модель выполняется через заменяемый `llama.cpp/llama-server` на CPU. | MUST |
| SYS-005 | Активированный шаблон должен заполняться без LLM через форму/детерминированные данные. | MUST |
| SYS-006 | Архитектура — модульный монолит с API, worker и необязательным `llama-server`. | MUST |
| SYS-007 | Redis, RabbitMQ, Kafka, Kubernetes и внешняя vector DB не должны быть обязательными зависимостями. | MUST |
| SYS-008 | LLM не исполняет код, SQL, shell, пути, OOXML и произвольные внешние действия. | MUST |

## 2. Доверенный контур и код доступа

| ID | Требование | Приоритет |
|---|---|---:|
| IAM-001 | Сохраняемая рабочая область и предметные API должны требовать один общий **4-значный код доступа**, без username/account/login/roles/ACL. | MUST |
| IAM-002 | Все клиенты с открытой сессией имеют одинаковые прикладные возможности; код не идентифицирует сотрудника. | MUST |
| IAM-003 | Код — только дополнительный барьер внутри trusted network и не заменяет firewall/reverse proxy/HTTPS/bind address/system permissions. | MUST |
| IAM-004 | Чувствительность данных `public/internal/personal/restricted` используется для masking/logging/LLM policy, но не как ACL. | MUST |
| IAM-005 | Перед LLM применяются детерминированные правила allowed data и masking. | MUST |
| IAM-006 | Users, personal identity, roles, ACL, MFA или external IAM требуют отдельного ADR и threat-model revision. | MUST |
| IAM-007 | Код хранится только как salted parameterized scrypt hash; открытое значение не хранится, не журналируется и не входит в bundle/evidence. | MUST |
| IAM-008 | Успешный ввод создаёт signed `HttpOnly`, `SameSite=Strict` cookie с TTL; при HTTPS cookie имеет `Secure`; session secret хранится только на target. | MUST |
| IAM-009 | `/healthz` и `/readyz` остаются без сессии; `/gost` следует отдельному stateless ADR-0010; остальные persisted UI/API закрыты gate. | MUST |
| IAM-010 | Ошибочные попытки получают локальный backoff; смена/сброс кода ротирует session secret и завершает прежние сессии. | MUST |
| IAM-011 | Built-in gate принимает ровно четыре ASCII-цифры `0–9`, не содержит username/password controls, не использует HTTP Basic Auth и не выдаёт `WWW-Authenticate`. | MUST |

`x-actor-id` и аналогичные поля — непроверенная метка происхождения для аудита/идемпотентности. Исторические schema names из применённых migrations не определяют текущую продуктовую модель и скрываются за adapters.

## 3. Пространства, группы и аудитории

| ID | Требование | Приоритет |
|---|---|---:|
| SPACE-001 | Пространства группируют данные подразделений/проектов и являются жёсткой границей данных, но не user authorization scope. | MUST |
| SPACE-002 | Конкретная сущность и пользовательское определение свойства принадлежат ровно одному space; legacy shared data исправляется migration, а не runtime claim. | MUST |
| SPACE-003 | Legacy records при миграции помещаются в deterministic `default`, если иной mapping не задан миграцией. | MUST |
| SPACE-004 | Все spaces доступны любому клиенту с открытой workspace session; membership/roles не используются. | MUST |
| SPACE-005 | Cross-space link отклоняется как integrity violation независимо от UI. | MUST |
| SPACE-006 | Внутри space поддерживаются редактируемые named groups с устойчивым порядком участников. | MUST |
| SPACE-007 | Group member обязан принадлежать тому же space; cross-space membership запрещён application + DB. | MUST |
| SPACE-008 | Audience выбирается из всех active entities space, named group или explicit selection. | MUST |
| SPACE-009 | До запуска создаётся immutable audience snapshot с order/display data/criteria/actor label/time/correlation. | MUST |
| SPACE-010 | Empty audience отклоняется с понятным recovery action. | MUST |
| SPACE-011 | `one_per_member` создаёт отдельную executable unit на участника. | MUST |
| SPACE-012 | `aggregate` создаёт одну unit с ordered `audience.members`. | MUST |
| SPACE-013 | Compiler поддерживает вывод `audience.members` через разрешённые list/table/repeat contracts. | MUST |
| SPACE-014 | Generation job и automation rule фиксируют `space_id`, snapshot и result mode. | MUST |
| SPACE-015 | Изменение group после snapshot не меняет уже созданный snapshot. | MUST |
| SPACE-016 | Template source/IR/fields/bindings/versions принадлежат одному space; cross-space use запрещён. | MUST |
| SPACE-017 | Обычная mutation пользовательского свойства всегда получает `spaceId` явно и не пишет молча в `default`. | MUST |
| SPACE-018 | GET/list/read пользовательского свойства не создаёт и не меняет ownership. | MUST |
| SPACE-019 | Property value записывается только если entity и property definition принадлежат одному space. | MUST |

Обязательны negative tests с двумя spaces и одинаковыми names/keys: A не читает, не изменяет, не удаляет, не связывает данные B; import A не влияет на B.

## 4. Универсальные сущности, свойства, импорт и экспорт

| ID | Требование | Приоритет |
|---|---|---:|
| DATA-001 | Пользователь может создавать произвольные entity types без изменения code/schema. | MUST |
| DATA-002 | Поддерживаются `person`, `organization`, `article`, `place`, `project`, `household` и custom types. | MUST |
| DATA-003 | Property definition имеет stable key, label, description, appliesTo, type, unit, cardinality, validation, aliases, sensitivity. | MUST |
| DATA-004 | Value types: string, text, number, integer, boolean, date, datetime, enum, entity ref, list, JSON, file, image. | MUST |
| DATA-005 | Values типизированы и индексируются по применимому типу, а не являются только opaque JSON. | MUST |
| DATA-006 | Value history хранит provenance, version, actor label, time/validity, confidence/confirmation. | MUST |
| DATA-007 | Исторические values могут быть разрешены на выбранную дату документа. | MUST |
| DATA-008 | Новое template field может быть job-local, template-local или property текущего space. | MUST |
| DATA-009 | User property создаётся только явной mutation или явно предусмотренным guided flow и только в текущем space. | MUST |
| DATA-010 | Similar property lookup при создании ищет только в текущем space. | SHOULD |
| DATA-011 | CSV/XLSX import/export обязателен; import имеет preview + structured errors, export получает space/type явно. | MUST |
| DATA-012 | Entity с историческими documents удаляется логически, если retention policy не разрешает physical delete. | MUST |
| DATA-013 | Stable machine key для type/property/space/group назначает server и не меняет при rename; ordinary UI не требует его ввода. | MUST |
| DATA-014 | Fresh install позволяет добавить первого employee/field/value без отдельной предварительной настройки type `person`. | MUST |
| DATA-015 | XLSX import сопоставляет values по cell coordinates; blank/missing cell не сдвигает columns. | MUST |
| DATA-016 | CSV/XLSX import сохраняет physical source row number после пропуска fully blank rows. | MUST |
| DATA-017 | Import error рождается machine-readable до UI: stable `code`, scope, blocking effect, physical row, column/property, raw value, severity, suggested action и repair params. | MUST |
| DATA-018 | Error блокирует минимально необходимую область; file/mapping/form state не сбрасываются; корректные rows могут сохранять явную возможность import согласно policy. | MUST |
| DATA-019 | Перенос строки внутри одной CSV/XLSX-cell остаётся частью value и не создаёт новую record. | MUST |
| DATA-020 | Для identity/string/enum оператор может явно выбрать case-insensitive comparison без дублей и лишней history version. | MUST |
| DATA-021 | Для `person` поддерживается guided normalisation ФИО и разделение 2/3 components; ambiguity становится row error, а не silent guess. | MUST |
| DATA-022 | Blank imported value не очищает confirmed property без отдельной explicit clear operation. | MUST |
| DATA-023 | Preview/plan error содержит code, physical row, source column, property key when known, raw value и repair action. | MUST |
| DATA-024 | Employee import и generic import используют один UX contract: file picker + drag&drop, no horizontal overflow, highlighted mapping/error, repair without re-upload. | MUST |
| DATA-025 | CSV/XLSX export использует human headers, current-space values, stable order и neutralizes spreadsheet formulas. | MUST |

## 5. Безопасное администрирование SQLite

| ID | Требование | Приоритет |
|---|---|---:|
| DBA-001 | Admin UI показывает application tables, columns и row counts без arbitrary SQL. | MUST |
| DBA-002 | Read-only browse поддерживает pagination/search/sort только по существующей column. | MUST |
| DBA-003 | CSV/JSON export имеет explicit row limit, escaping и formula protection. | MUST |
| DBA-004 | BLOB не выводится целиком в web table; допускается размер/metadata. | MUST |
| DBA-005 | Доступны `PRAGMA quick_check` и `foreign_key_check`. | MUST |
| DBA-006 | Добавление user field создаёт domain property definition выбранного space, а не physical SQLite column/global field. | MUST |
| DBA-007 | Web/CLI admin не предоставляет UPDATE/DELETE/ALTER/unsafe PRAGMA/extensions/arbitrary SQL. | MUST |
| DBA-008 | Physical schema меняется только новой immutable migration + tests + backup/update procedure. | MUST |

## 6. Template intake, структура и активация

| ID | Требование | Приоритет |
|---|---|---:|
| TPL-001 | Принимать DOCX/XLSX и проверять MIME/ZIP/OOXML/limits/relationships. | MUST |
| TPL-002 | Строить Document IR со stable IDs paragraphs/runs/tables/cells/sheets/ranges. | MUST |
| TPL-003 | Variable candidates определяются deterministic rules, затем необязательным bounded LLM assistant. | MUST |
| TPL-004 | Пользователь может вручную выделить text/cell/row/range/block и создать field. | MUST |
| TPL-005 | DOCX binding использует validated `w:sdt`/safe selected text contract и сохраняет surrounding formatting. | MUST |
| TPL-006 | XLSX scalar binding использует validated cell/defined-name contract; metadata ограничена declared safe schema. | MUST |
| TPL-007 | Поддерживаются blank template и filled examples для compare where applicable. | SHOULD |
| TPL-008 | Manifest описывает fields/schema/bindings/sources/formatters/conditions/repeats/review/test data. | MUST |
| TPL-009 | Activation только после test render, structural validation и preview/review по policy. | MUST |
| TPL-010 | Activated template version immutable; change создаёт новую version. | MUST |
| TPL-011 | Version имеет compatibility level `safe-scalar/structured/generated/complex-office`. | MUST |
| TPL-012 | Поддерживаются multi-file template sets с общим context. | MUST |
| TPL-013 | Compatibility report отражает macros/signatures/OLE/ActiveX/external links/complex objects. | MUST |
| TPL-014 | Initial check не распаковывает в user dir, не активирует template и не исполняет content. | MUST |
| TPL-015 | Intake report различает accepted/warning/rejected и объясняет next action по-русски. | MUST |
| TPL-016 | Checked source сохраняется только после explicit user action и повторной server validation. | MUST |
| TPL-017 | Saved source immutable by SHA-256, scoped to one space и хранит report/actor/time/correlation. | MUST |
| TPL-018 | Повтор identical bytes не создаёт второй physical object или duplicate intake record в том же space. | MUST |
| TPL-019 | Rejected/changed/cross-space source нельзя использовать для binding. | MUST |
| TPL-020 | Document IR не возвращает raw XML как executable browser content. | MUST |
| TPL-021 | Element ID детерминирован от source SHA + structural coordinate. | MUST |
| TPL-022 | Structure response имеет display limits, full counts и explicit truncation flag. | MUST |
| TPL-023 | DOCX structure: body/headers/footers/notes/paragraphs/runs/tables; XLSX: sheets/cells/values/shared strings/formulas. | MUST |
| TPL-024 | Binding build повторно проверяет source SHA/structure, не меняет source и reverse-discovers binding in compiled copy. | MUST |
| TPL-025 | Trial fill записывает только через binding, reverse-reads и success только при exact expected match. | MUST |
| TPL-026 | Bound copy и trial copy хранятся раздельно immutable by SHA; identical retry не дублирует. | MUST |
| TPL-027 | LibreOffice preview выполняется persisted worker job с isolated profile, timeout/output limits/cleanup. | MUST |
| TPL-028 | Activation только после ready checked preview и explicit confirmation when preview policy enabled. | MUST |
| TPL-029 | Current active version определяется отдельным pointer без mutation historical versions/jobs. | MUST |
| TPL-030 | Multi-field verified version содержит full field set, reproducible technical copy и reverse-read каждого value. | MUST |

## 7. Fields, sources и formatting

| ID | Требование | Приоритет |
|---|---|---:|
| FLD-001 | Template field отделён от entity property и physical binding. | MUST |
| FLD-002 | Field имеет ordered source policy: request/job/property/entity/organization/reference/calculation/generation/question. | MUST |
| FLD-003 | Used value provenance доступен UI/audit. | MUST |
| FLD-004 | Разрешены только declarative transforms/formatters из allowlist. | MUST |
| FLD-005 | `eval`, `Function`, untrusted code/import запрещены. | MUST |
| FLD-006 | ФИО formatter поддерживает падеж/order/full-short/initials. | MUST |
| FLD-007 | Auto grammatical form помечается suggested; confirmed form может сохраняться. | SHOULD |
| FLD-008 | Форматтеры поддерживают date/datetime/number/currency/percent/unit/address/phone/org details. | MUST |
| FLD-009 | Поддерживаются scalar, formatted text, list, table, repeat row/range, image в заявленном compatibility level. | MUST |
| FLD-010 | Required fields и dependencies валидируются до render. | MUST |
| FLD-011 | Formatter versioned/declarative/schema-limited и immutable переносится в verified version/manifest. | MUST |

## 8. Локальные AI agents

| ID | Требование | Приоритет |
|---|---|---:|
| AI-001 | Agent имеет versioned prompt, input/output schema, limits, timeout, fallback. | MUST |
| AI-002 | Logical agents используют одну configured local model unless explicitly designed otherwise. | MUST |
| AI-003 | Model output проходит JSON Schema + business validation. | MUST |
| AI-004 | После invalid response допускается не более одного repair call. | MUST |
| AI-005 | Template selector выбирает только из переданных candidate IDs. | MUST |
| AI-006 | Value extractor не создаёт entity IDs и не выдумывает отсутствующие values. | MUST |
| AI-007 | Binding agent возвращает только coordinates существующего Document IR; backend валидирует. | MUST |
| AI-008 | Generated text возвращается как bounded structured text, не HTML/OOXML. | MUST |
| AI-009 | Document content — data и не меняет system prompt/tools/policy. | MUST |
| AI-010 | Для call сохраняются agent/model/prompt/schema versions, hashes, duration, validation outcome. | MUST |
| AI-011 | Sensitive agent logs поддерживают masking/hash-only policy. | MUST |

## 9. Generation и validation

| ID | Требование | Приоритет |
|---|---|---:|
| DOC-001 | Manual flow поддерживает free request и explicit template selection. | MUST |
| DOC-002 | Ambiguous entities предъявляются пользователю. | MUST |
| DOC-003 | Все fields доступны через dynamic form независимо от chat/LLM. | MUST |
| DOC-004 | Generated content и final values показываются до confirmation according to review policy. | MUST |
| DOC-005 | Renderer меняет только allowlisted bindings и сохраняет untouched OOXML. | MUST |
| DOC-006 | После render выполняются ZIP/XML/binding/unfilled-marker/reverse-read checks. | MUST |
| DOC-007 | LibreOffice используется для preview/recalc where needed, но не основной renderer. | MUST |
| DOC-008 | Preview failure блокирует automatic delivery unless explicit approved policy says otherwise. | MUST |
| DOC-009 | Result и preview immutable separate objects by SHA. | MUST |
| DOC-010 | Regeneration с changed data создаёт новую revision. | MUST |
| DOC-011 | До запуска показываются space, audience source/composition и expected output count. | MUST |
| DOC-012 | Aggregate renderer получает ordered `audience.members`, не случайного primary person. | MUST |
| DOC-013 | One-per-member unit имеет своего primary member и локальный audience context. | MUST |
| DOC-014 | Group change после snapshot не меняет running job. | MUST |
| DOC-015 | Basic XLSX trial не перезаписывает formula cell без explicit supported formula policy. | MUST |
| DOC-016 | Пользователь видит written/reverse-read values и может скачать checked copies. | MUST |
| DOC-017 | Active template catalog scoped by space и не раскрывает версии другого space. | MUST |
| DOC-018 | Multi-field trial принимает full field set и reverse-reads каждое value. | MUST |
| DOC-019 | Personal document flow: template → all/group/selected → data check → exact count → generate → results/bundle. | MUST |

## 10. UI/UX

| ID | Требование | Приоритет |
|---|---|---:|
| UX-001 | UI современный, спокойный, не перегруженный, на единой token/component system. | MUST |
| UX-002 | Направление — ясность хорошего desktop/macOS-like приложения без копирования закрытых UI. | MUST |
| UX-003 | Один screen — одна очевидная primary task и не более одной dominant action. | MUST |
| UX-004 | Operation показывает current step, reason, next step и need for user action. | MUST |
| UX-005 | Безымянный бесконечный spinner запрещён для длительной операции. | MUST |
| UX-006 | Fake percent progress запрещён. | MUST |
| UX-007 | Collections/processes имеют applicable loading/empty/success/warning/error/degraded/disabled/planned states. | MUST |
| UX-008 | Error сообщает: что произошло, сохранены ли данные, что делать, correlation ID. | MUST |
| UX-009 | Non-trivial field имеет example/secondary help sufficient contrast. | MUST |
| UX-010 | Disabled action объясняет reason/unlock condition; unimplemented feature явно planned. | MUST |
| UX-011 | Persisted long operation сообщает, можно ли уйти, и доступна в history. | MUST |
| UX-012 | Notification hierarchy: inline → status → toast/persistent notice → dialog only for blocking decision. | MUST |
| UX-013 | Context help/FAQ доступна без выхода из flow. | MUST |
| UX-014 | User text concrete, neutral, Russian by default; jargon explained. | MUST |
| UX-015 | Desktop sidebar/mobile bottom navigation; no page horizontal overflow from 320 px. | MUST |
| UX-016 | Minimum interactive target 44×44 CSS px. | MUST |
| UX-017 | Light/dark/system themes; meaning not color-only. | MUST |
| UX-018 | Target WCAG 2.2 AA: keyboard, visible focus, semantic regions, live announcements, reduced motion. | MUST |
| UX-019 | Emoji only supplementary to text/accessible label. | MUST |
| UX-020 | Runtime UI не использует CDN/external fonts/analytics/remote feature flags. | MUST |
| UX-021 | Form values survive server error; success only after server confirmation. | MUST |
| UX-022 | New UI feature проходит states/mobile/keyboard/accessibility/offline checks. | MUST |
| UX-023 | Current space постоянно видим при работе с participants/audience. | MUST |
| UX-024 | До snapshot UI объясняет aggregate vs N personal outputs. | MUST |
| UX-025 | Names/states/errors/help/recovery — Russian by default. | MUST |
| UX-026 | Необязательные англицизмы запрещены; machine standards/keys объясняются и скрыты из ordinary flow. | MUST |
| UX-027 | File validation и source saving визуально разделены; UI сообщает, сохранён ли file и в каком space. | MUST |
| UX-028 | Structure analysis показывает stage/counts/truncation/selected coordinate/next action. | MUST |
| UX-029 | Trial fill объясняет immutable source/compile/reverse-read, сохраняет input on error и links copies only on success. | MUST |
| UX-030 | Preview показывает queued/running/ready/error, допускает safe leave/retry и explicit review before activation. | MUST |
| UX-031 | Multi-field trial показывает all fields/required/type, preserves inputs, shows reverse-read per field. | MUST |
| UX-032 | Primary navigation названа пользовательскими задачами; universal schema/diagnostics вторичны. | MUST |
| UX-033 | Ordinary flow не требует machine key/UUID/OOXML coordinate/internal mode. | MUST |
| UX-034 | Add employee + new field + value выполняются в одном guided flow. | MUST |
| UX-035 | Home/empty states имеют один obvious entry в end-to-end generation и visible next unfinished step. | MUST |
| UX-036 | Technical details — read-only secondary admin/diagnostic disclosure, не blocking ordinary flow. | MUST |
| UX-037 | CSV/XLSX import имеет visible drag&drop, error highlights cell/mapping и repair без reset/re-upload. | MUST |
| UX-038 | Closed/expired workspace показывает простой `/access` с одним 4-digit field; после correct code возвращает только на safe local path; username/password UI отсутствует. | MUST |
| UX-039 | Export CSV/XLSX доступен рядом с list/import как secondary action и on error сообщает, что data не изменены. | MUST |

## 11. Automation

| ID | Требование | Приоритет |
|---|---|---:|
| AUT-001 | Automation rule включает trigger/filter/target/template/data/review/delivery policy. | MUST |
| AUT-002 | Поддерживаются schedule, internal event, external event API, watched folder и derived date. | MUST |
| AUT-003 | User schedules persisted in SQLite, не systemd timers. | MUST |
| AUT-004 | Schedule имеет IANA timezone, bounds, work calendar, missed-run policy. | MUST |
| AUT-005 | UI создаёт daily/weekly/monthly/yearly schedules без manual cron. | MUST |
| AUT-006 | Advanced cron только как validated admin option. | SHOULD |
| AUT-007 | Missed-run policies: skip/run_once/bounded catch_up. | MUST |
| AUT-008 | Internal events записываются transactional outbox вместе с business mutation. | MUST |
| AUT-009 | External event имеет type/schema version/source/time/data/dedupe key. | MUST |
| AUT-010 | Duplicate event key не создаёт second run. | MUST |
| AUT-011 | Conditions — bounded declarative language без user code. | MUST |
| AUT-012 | Modes: event object/each object/aggregate/grouped bundle. | MUST |
| AUT-013 | Run pins actual template version used. | MUST |
| AUT-014 | Missing-data policy: fail/review/skip/default only as declared. | MUST |
| AUT-015 | Review policies explicit: always/generated/low-confidence/never. | MUST |
| AUT-016 | Automatic run не задаёт synchronous questions; создаёт review task. | MUST |
| AUT-017 | Run имеет deterministic idempotency key + DB uniqueness. | MUST |
| AUT-018 | Rule supports dry-run/manual retry/disable/history. | MUST |
| AUT-019 | Legally/content-significant generated blocks default to human review. | MUST |
| AUT-020 | Automation rule scoped to one space. | MUST |
| AUT-021 | Audience resolved and snapshotted before creating generation units. | MUST |
| AUT-022 | `aggregate`/`one_per_member` explicit, не inferred from group size. | MUST |

## 12. Queue/recovery

| ID | Требование | Приоритет |
|---|---|---:|
| QUE-001 | Queue persisted in SQLite. | MUST |
| QUE-002 | Claim transactional with owner/claimedAt/leaseUntil. | MUST |
| QUE-003 | Worker crash returns job after lease expiry. | MUST |
| QUE-004 | Store attempts/max/nextAttempt/lastError/priority. | MUST |
| QUE-005 | Exhausted retries become terminal error/review according to policy. | MUST |
| QUE-006 | LLM concurrency default 1 and separate from render/delivery concurrency. | MUST |
| QUE-007 | Long external work не держит SQLite transaction. | MUST |
| QUE-008 | Preview job survives restart, dedupes pending/ready и creates new attempt only on explicit retry after failure. | MUST |

## 13. Email delivery

| ID | Требование | Приоритет |
|---|---|---:|
| MAIL-001 | Mail только через configured local SMTP relay. | MUST |
| MAIL-002 | Recipients только из declared allowlisted policies. | MUST |
| MAIL-003 | Subject/body — safe versioned template. | MUST |
| MAIL-004 | Attachments bounded by total size/type. | MUST |
| MAIL-005 | Deterministic Message-ID. | MUST |
| MAIL-006 | Distinguish accepted/rejected/unknown/final-failed. | MUST |
| MAIL-007 | SMTP accepted не означает end-user read. | MUST |
| MAIL-008 | Unknown result retry только по explicit policy из-за duplicate risk. | MUST |
| MAIL-009 | SMTP secrets не хранятся в template/plain DB/log. | MUST |

## 14. Network share

| ID | Требование | Приоритет |
|---|---|---:|
| SHARE-001 | CIFS/NFS монтирует ОС; app видит только allowlisted local roots. | MUST |
| SHARE-002 | Перед write проверяются mountinfo + sentinel expected identity. | MUST |
| SHARE-003 | Path templates allowlisted и не допускают traversal/absolute path. | MUST |
| SHARE-004 | Write temp on target FS → fsync → atomic rename. | MUST |
| SHARE-005 | Name collision policy explicit. | MUST |
| SHARE-006 | Sidecar manifest/SHA may be created by policy. | SHOULD |
| SHARE-007 | Missing mount triggers retry и не пишет в empty local mountpoint dir. | MUST |
| SHARE-008 | Audit stores actual path/name/size/hash/time. | MUST |

## 15. Archive/audit

| ID | Требование | Приоритет |
|---|---|---:|
| AUD-001 | Files outside SQLite in content-addressed storage. | MUST |
| AUD-002 | Original/compiled/results immutable with SHA-256. | MUST |
| AUD-003 | Audit create/change/activate/run/review/download/delivery/retry/delete. | MUST |
| AUD-004 | Correlation ID связывает event/run/job/agent/files/deliveries. | MUST |
| AUD-005 | Retention configurable by artifact/log class. | MUST |
| AUD-006 | Legal hold blocks planned deletion. | SHOULD |

## 16. Security

| ID | Требование | Приоритет |
|---|---|---:|
| SEC-001 | `llama-server` слушает localhost only. | MUST |
| SEC-002 | OOXML проверяется на zip bomb/path/XML amplification/external links/macros. | MUST |
| SEC-003 | Любой HTML preview sanitize before browser display. | MUST |
| SEC-004 | Runtime processes unprivileged + systemd hardening. | MUST |
| SEC-005 | SMTP domains, delivery channels и network roots allowlisted. | MUST |
| SEC-006 | Secrets только protected target config/OS secret store и redacted logs. | MUST |
| SEC-007 | File path/name строит server; raw user text не становится filesystem path. | MUST |
| SEC-008 | LibreOffice isolated temporary profile + timeout/resource/output limits. | MUST |
| SEC-009 | Upload/archive has byte/entry/expanded limits. | MUST |
| SEC-010 | Security-sensitive operations имеют negative tests. | MUST |
| SEC-011 | Cross-space identifier проверяется до sensitive read/LLM/render/delivery. | MUST |
| SEC-012 | ZIP read ограничивает actual streamed expanded bytes и не доверяет только central-directory metadata. | MUST |
| SEC-013 | Saved source validates actual SHA and never uses user filename as storage path. | MUST |
| SEC-014 | XML rejects `DOCTYPE`/`ENTITY`/unsupported declarations before parse. | MUST |
| SEC-015 | Access-code gate использует exact 4 digits, scrypt, constant-time derived-key compare, signed HttpOnly session, bounded TTL/backoff; code/hash/session/cookie не логируются. | MUST |
| SEC-016 | Browser mutation с mismatched Origin отклоняется; cookie Strict and Secure over HTTPS. | MUST |
| SEC-017 | CSV/XLSX export excludes cross-space data and neutralizes formulas. | MUST |

## 17. Offline install/update

| ID | Требование | Приоритет |
|---|---|---:|
| OFF-001 | Offline bundle содержит Node, production npm deps, app, migrations, manifests/checksums. | MUST |
| OFF-002 | Full bundle содержит compatible llama-server/model либо явно declares without LLM. | MUST |
| OFF-003 | Target install/update не выполняют network requests. | MUST |
| OFF-004 | Bundle verified before system changes. | MUST |
| OFF-005 | Release installed versioned immutable + atomic current symlink. | MUST |
| OFF-006 | Перед update backup DB/config. | MUST |
| OFF-007 | Update runs migrations/start/readiness и restores prior state on failure. | MUST |
| OFF-008 | Applied migrations immutable/checksummed. | MUST |
| OFF-009 | Native binaries built/tested on compatible target reference OS/arch/glibc. | MUST |
| OFF-010 | Optional OS packages delivered only as verified target-specific dependency closure. | SHOULD |
| OFF-011 | First-run helper показывает URL, 4-digit code setup/recovery и пользовательский end-to-end flow. | MUST |
| OFF-012 | First-run helper входит в bundle и installed release. | MUST |
| OFF-013 | Preview profile bundle содержит compatible LibreOffice package closure/path/limits/checks. | MUST |
| OFF-014 | Fresh install remains locked until 4-digit code set; update/rollback preserve credential/session config; canonical recovery helpers реально поставляются. | MUST |

## 18. Non-functional

| ID | Требование | Приоритет |
|---|---|---:|
| NFR-001 | Schedules/events/queue/process states survive restart. | MUST |
| NFR-002 | Non-LLM/Office API target p95 ≤2s at 10 concurrent clients on reference server. | SHOULD |
| NFR-003 | Schedule deviation target ≤60s absent higher-priority queue. | SHOULD |
| NFR-004 | Safe scalar render target ≤15s without LLM on reference server. | SHOULD |
| NFR-005 | Baseline one server, десятки simultaneous clients. | MUST |
| NFR-006 | Baseline RPO 24h/RTO 4h until customer-approved values. | SHOULD |
| NFR-007 | Health/readiness, structured logs and queue/error/duration observability. | MUST |
| NFR-008 | Public TypeScript boundaries strict typed, no unjustified `any`. | MUST |
| NFR-009 | Changes pass unit/integration/shell/docs gates. | MUST |
| NFR-010 | Local model performance/quality proven on target CPU before support claim. | MUST |
| NFR-011 | UI files offline/local, no runtime external domains. | MUST |
| NFR-012 | Base UI remains functional at 200% text scale. | SHOULD |
| NFR-013 | Automated language gate detects forbidden user-facing anglicisms. | MUST |

## 19. Верхнеуровневая приёмка

| ID | Критерий |
|---|---|
| AC-001 | Custom entity type/properties создаются через UI и используются в document без code change. |
| AC-002 | Unknown DOCX размечается/активируется/генерируется без ручного восстановления файла в Office. |
| AC-003 | XLSX scalar/repeat output сохраняет заявленные styles/formulas. |
| AC-004 | Один template manifest работает для guided form и free request. |
| AC-005 | Schedule формирует/архивирует/атомарно доставляет document. |
| AC-006 | Duplicate external event key создаёт ровно один run. |
| AC-007 | SMTP accepted/rejected/waiting/unknown states отражаются корректно. |
| AC-008 | Missing mount не приводит к локальной записи в mountpoint path. |
| AC-009 | Missing required value блокирует automatic delivery и создаёт recoverable state. |
| AC-010 | Worker restart не теряет job и не создаёт duplicate result. |
| AC-011 | Без LLM activated template заполняется формой. |
| AC-012 | Для value доступно provenance/version. |
| AC-013 | Generated significant text не доставляется без required review. |
| AC-014 | Clean target installs verified bundle without Internet. |
| AC-015 | Пользователь всегда понимает current stage/wait reason/next action/save state. |
| AC-016 | UI проходит UX acceptance specification. |
| AC-017 | Два spaces не смешиваются в lists/groups/properties/import/snapshots/templates/jobs. |
| AC-018 | Audience даёт либо N personal units, либо one aggregate with `audience.members`. |
| AC-019 | Group edit after snapshot не меняет snapshot. |
| AC-020 | Ordinary user выполняет main flow без English/internal terminology. |
| AC-021 | Safe Office input получает compatibility report; unsafe/macro/corrupt rejected without execution. |
| AC-022 | Accepted source сохраняется only on confirmation, dedupes, не cross-space links. |
| AC-023 | Reanalysis stable IDs; large document truncation explicit; unsafe XML declaration rejected. |
| AC-024 | Trial binding reproducible, exact reverse-read, immutable copies, no duplicate on identical retry. |
| AC-025 | Verified version preview/job state clear, activation after review, catalog scoped to space. |
| AC-026 | Multi-field trial exact reverse-read all fields, reproducible copies, no duplicate retry. |
| AC-027 | New user adds employee/field/value without machine keys. |
| AC-028 | New user creates personal documents for selected audience with exact count and finds results/bundle. |
| AC-029 | Main personal-document flow не требует knowledge of entity/audience/snapshot/internal modes. |
| AC-030 | CSV/XLSX drag&drop + typed error repair without losing mappings/file. |
| AC-031 | Same-named properties/publication fields in two spaces remain independent. |
| AC-032 | Closed client cannot read workspace UI/API; correct 4-digit code opens session, wrong attempts backoff, lock/reset closes old session, no username/password/Basic Auth. |
| AC-033 | Export from two spaces contains only corresponding data, human headers, no executable formulas. |

## 20. Не входят автоматически

OCR scans, qualified electronic signature, VBA/ActiveX/OLE execution, arbitrary user code, full BPMN, per-user accounts/roles/ACL/IAM и cluster horizontal scaling не считаются обязательными capability первой stable line без отдельного ADR/roadmap item.

## 21. Управление изменениями

- Изменение MUST требует обновить этот файл и, при architecture/security boundary change, ADR.
- PR с product behavior ссылается на requirement IDs и получает SemVer bump.
- Applied migration не редактируется; legacy data исправляется новой migration + fresh/upgrade tests.
- User-facing change запускает language/UI/accessibility checks.
- Значимый defect получает regression test.
- Support claim не шире фактически доказанной compatibility/target evidence.
- Release не считается finished, пока exact version/commit не прошёл полный CI, offline bundle verification, Debian/Astra target acts, Office corpus, recovery и P5 gate.
