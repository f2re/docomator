# Knowledge Registry API

Статус: **реализованный базовый API M1**

Связанные требования: `DATA-001`—`DATA-008`, `AUD-001`—`AUD-004`, `AUT-008`, `SEC-004`.

## Назначение

Knowledge Registry хранит расширяемые типы сущностей, сущности, определения свойств и версионные значения. Набор типов и параметров не зашит в код: можно создать `person.height`, `person.weight`, `household.pet_count`, `organization.inn` и другие типизированные свойства.

Каждая mutation выполняется в одной SQLite transaction:

```text
business record
+ domain_events outbox record
+ audit_log record
```

При ошибке откатываются все три записи.

> [!WARNING]
> В milestone M1 полноценные authentication и authorization ещё не реализованы. API по умолчанию слушает `127.0.0.1`. До внедрения IAM его нельзя напрямую публиковать в недоверенную сеть; допустим только localhost или доверенный reverse proxy с собственным контролем доступа.

## Базовый URL

```text
/api/v1/knowledge
```

## Correlation и actor

Клиент может передать:

```http
X-Correlation-ID: request-2026-07-11-001
X-Actor-ID: operator-42
```

Разрешены латинские буквы, цифры и символы `._:/-`, длина — до 160 знаков. Некорректный correlation ID заменяется внутренним Fastify request ID. Если `X-Actor-ID` отсутствует, в аудит записывается request ID.

Каждый ответ содержит:

```http
X-Correlation-ID: request-2026-07-11-001
```

Успешный JSON:

```json
{
  "data": {},
  "correlationId": "request-2026-07-11-001"
}
```

Ошибка:

```json
{
  "error": {
    "code": "knowledge_validation_failed",
    "message": "..."
  },
  "correlationId": "request-2026-07-11-001"
}
```

## Маршруты

| Метод | Маршрут | Назначение |
|---|---|---|
| `POST` | `/entity-types` | создать тип сущности |
| `GET` | `/entity-types` | получить каталог типов |
| `GET` | `/entity-types/:key` | получить тип по стабильному ключу |
| `POST` | `/property-definitions` | создать определение свойства |
| `GET` | `/property-definitions` | получить каталог свойств |
| `GET` | `/property-definitions/:key` | получить свойство по ключу |
| `POST` | `/entities` | создать сущность |
| `GET` | `/entities` | получить сущности с фильтрами |
| `GET` | `/entities/:entityId` | получить сущность |
| `PUT` | `/entities/:entityId/properties/:propertyKey` | добавить новую версию значения |
| `GET` | `/entities/:entityId/property-values` | получить историю значений |

Параметр `limit` имеет диапазон `1..500`. История значений по умолчанию ограничена 200 записями.

## Стабильные ключи

Ключи нормализуются в нижний регистр и должны соответствовать форме:

```text
person
organization
person.height
household.pet_count
```

Допустимы латинские буквы, цифры, точки, подчёркивания и дефисы. Ключ начинается с буквы и является уникальным.

## Типы значений

Поддерживаются:

```text
string
text
number
integer
boolean
date
date-time
enum
entity-reference
list
json
file
image
```

`date` использует `YYYY-MM-DD`. `date-time` обязан содержать timezone и сохраняется в UTC. `entity-reference`, `file` и `image` проверяют существование целевого объекта. `enum` проверяется по `validation.enum`.

Каноническое значение хранится в `value_json`; индексируемые projections записываются в соответствующие поля:

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

## Создание типа сущности

```bash
curl -X POST http://127.0.0.1:8080/api/v1/knowledge/entity-types \
  -H 'content-type: application/json' \
  -H 'x-actor-id: admin-1' \
  -d '{
    "key": "person",
    "label": "Человек",
    "description": "Физическое лицо"
  }'
```

## Создание свойства

```bash
curl -X POST http://127.0.0.1:8080/api/v1/knowledge/property-definitions \
  -H 'content-type: application/json' \
  -H 'x-actor-id: data-steward-1' \
  -d '{
    "key": "person.height",
    "label": "Рост",
    "valueType": "number",
    "unit": "cm",
    "cardinality": "single",
    "sensitivity": "personal",
    "appliesTo": ["person"],
    "aliases": ["рост", "height"]
  }'
```

`appliesTo: []` означает отсутствие ограничения по типу сущности. Ссылка на неизвестный тип отклоняется до записи.

## Создание сущности

```bash
curl -X POST http://127.0.0.1:8080/api/v1/knowledge/entities \
  -H 'content-type: application/json' \
  -H 'x-actor-id: operator-1' \
  -d '{
    "entityTypeKey": "person",
    "displayName": "Иванов Иван Иванович"
  }'
```

Статусы: `active`, `inactive`, `archived`.

## Добавление значения

```bash
curl -X PUT \
  http://127.0.0.1:8080/api/v1/knowledge/entities/ENTITY_ID/properties/person.height \
  -H 'content-type: application/json' \
  -H 'x-actor-id: operator-1' \
  -d '{
    "value": 181.5,
    "sourceType": "user_input",
    "confirmedBy": "operator-1",
    "validFrom": "2026-07-11"
  }'
```

Операция не перезаписывает историю. Для пары `entity + property` вычисляется следующая версия. Дополнительно поддерживаются `sourceId`, `confidence`, `validTo`.

## История значений

```bash
curl 'http://127.0.0.1:8080/api/v1/knowledge/entities/ENTITY_ID/property-values?propertyKey=person.height'
```

Ответ упорядочен по ключу свойства и убыванию версии. Политика выбора «текущего значения» для document resolution будет реализована отдельным application service; API M1 намеренно возвращает полную историю без скрытого выбора.

## Коды ошибок

| HTTP | Код | Значение |
|---:|---|---|
| 400 | `request_validation_failed` | JSON не соответствует route schema |
| 400 | `knowledge_validation_failed` | нарушены доменные ограничения |
| 400 | `property_value_validation_failed` | значение не соответствует типу свойства |
| 404 | `knowledge_not_found` | сущность, тип, свойство или ссылка не найдены |
| 409 | `knowledge_conflict` | стабильный ключ или ID уже занят |
| 500 | `internal_error` | непредвиденная серверная ошибка; детали остаются в логах |

## Следующие шаги

- authentication, RBAC и field-level access для `personal/restricted`;
- update/deactivate operations с optimistic version check;
- bulk CSV/XLSX import preview;
- current-value resolver с учётом периода действия и cardinality;
- semantic duplicate suggestions для новых property definitions;
- UI динамических форм поверх JSON Schema.
