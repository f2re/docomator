# Persistence kernel

Статус: **реализованный базовый инкремент M1**

Связанные требования: `DATA-005`, `AUT-008`, `QUE-001`—`QUE-007`, `AUD-001`—`AUD-004`, `NFR-001`, `NFR-008`, `NFR-009`.

## Назначение

`@docomator/storage` содержит минимальное детерминированное ядро хранения для API и worker-процессов:

- конфигурируемое соединение SQLite с WAL, foreign keys и busy timeout;
- синхронный transaction/unit-of-work API;
- персистентную очередь с claim, lease, retry и dead-letter;
- transactional outbox для доменных событий;
- correlation-aware audit repository;
- registry типизированных property codecs;
- content-addressed object storage по SHA-256.

## Транзакционный контракт

Transaction callback должен быть синхронным. Внутри него разрешены только короткие операции SQLite. LLM, LibreOffice, SMTP, сетевые папки и обработка файлов выполняются после commit.

```ts
store.transaction((database) => {
  database.prepare("UPDATE entities SET version = version + 1 WHERE id = ?").run(entityId);
  outbox.append(
    {
      eventType: "entity.updated",
      schemaVersion: 1,
      source: "knowledge-registry",
      payload: { entityId },
      dedupeKey: `entity.updated:${entityId}:${nextVersion}`
    },
    database
  );
  audit.record(
    {
      actorType: "user",
      actorId: userId,
      action: "update",
      objectType: "entity",
      objectId: entityId,
      correlationId
    },
    database
  );
});
```

Если callback выбрасывает исключение, бизнес-изменение, событие и аудит откатываются вместе. Вложенные вызовы используют SQLite savepoint.

## Очередь worker jobs

Состояния:

```text
pending → running → completed
              └──→ retry → running
              └──→ dead_letter
```

Claim выполняется в короткой `BEGIN IMMEDIATE` transaction:

1. истёкшие lease переводятся в `retry` или `dead_letter`;
2. выбирается due job с минимальным `priority`;
3. увеличивается `attempts`;
4. фиксируются `locked_by`, `locked_at` и `lease_expires_at`;
5. transaction завершается;
6. handler выполняется без открытой transaction.

Завершить, отложить или продлить job может только владелец ещё действующего lease. Это предотвращает запись результата старым worker после повторного claim.

`idempotency_key` уникален. Повтор с тем же ключом и тем же каноническим JSON возвращает существующий job; повтор с другими входами считается конфликтом.

## Retry policy

Worker использует ограниченный экспоненциальный backoff:

```text
min(retryMaxMs, retryBaseMs × 2^(attempts - 1))
```

Неизвестный `job_type` и `PermanentJobError` сразу переводятся в `dead_letter`. Иные ошибки считаются временными до достижения `max_attempts`.

Начальный registry содержит только безопасный `system.noop`. Новые handlers должны регистрироваться явно и не могут поступать из LLM или template manifest.

## Transactional outbox

`domain_events` записываются в той же transaction, что и бизнес-изменение. Dispatcher использует отдельный lease и состояния:

```text
pending → running → published
              └──→ retry → running
              └──→ dead_letter
```

Семантика доставки — **at least once**. Если процесс завершился после side effect, но до `markPublished`, событие может быть обработано повторно. Поэтому каждый consumer обязан иметь собственный idempotency/dedupe key.

Outbox repository реализован, но автоматические consumers и создание `automation_run` относятся к milestone M7.

## Типизированные свойства

Migration `0002_persistence_kernel.sql` добавляет typed projection columns к `entity_property_values`:

```text
value_text
value_number
value_integer
value_boolean
value_date
value_datetime
value_entity_id
value_file_id
```

`value_json` остаётся каноническим сериализованным представлением. Codec registry валидирует тип, нормализует date-time в UTC и одновременно формирует индексируемую projection.

Поддерживаемые типы:

```text
string, text, number, integer, boolean, date, date-time,
enum, entity-reference, list, json, file, image
```

## Content-addressed storage

Объект хранится по пути:

```text
<root>/<sha[0:2]>/<sha[2:4]>/<sha256>
```

Запись сначала выполняется во временный файл внутри того же filesystem. Финальный объект создаётся hard-link операцией без перезаписи существующего пути. При коллизии существующий объект повторно хешируется и проверяется.

Метаданные `files` и физическая запись объекта пока не объединены application service. Этот repository будет добавлен вместе с upload API.

## Конфигурация worker

```text
DOCOMATOR_WORKER_ID
DOCOMATOR_WORKER_POLL_MS
DOCOMATOR_WORKER_HEARTBEAT_MS
DOCOMATOR_WORKER_LEASE_MS
DOCOMATOR_WORKER_RETRY_BASE_MS
DOCOMATOR_WORKER_RETRY_MAX_MS
```

Если `DOCOMATOR_WORKER_ID` пуст, используется `<hostname>:<pid>`.

## Проверки

Интеграционные тесты покрывают:

- commit, rollback и nested savepoint;
- запрет async transaction callback;
- canonical JSON и idempotency conflict;
- priority claim;
- lease ownership и renewal;
- reclaim после restart/истечения lease;
- retry delay и dead-letter;
- атомарность business mutation + outbox + audit;
- at-least-once outbox;
- typed property projections;
- дедупликацию immutable objects.
