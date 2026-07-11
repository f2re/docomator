# ADR-0005: SQLite persistence kernel and at-least-once processing

- Статус: accepted
- Дата: 2026-07-11

## Контекст

Docomator должен работать на одном автономном сервере без Redis, RabbitMQ или Kafka. API и worker используют общую SQLite-базу. Очередь, расписания, события и workflow должны переживать restart, а внешние side effects — быть идемпотентными.

Нужен единый способ:

- выполнять короткие атомарные изменения;
- записывать domain event вместе с business mutation;
- захватывать задания несколькими процессами без двойного выполнения;
- возвращать задания после падения worker;
- хранить индексируемые типизированные projections;
- не вводить дополнительный native npm dependency.

## Решение

Создать workspace `@docomator/storage` на встроенном `node:sqlite` за собственным adapter API.

1. SQLite работает с foreign keys, WAL, full synchronous и busy timeout.
2. Transaction callback синхронен; Promise считается ошибкой. Тяжёлая работа внутри transaction запрещена.
3. Вложенные transaction scopes реализуются savepoint.
4. `worker_jobs` использует claim lease, attempts, due time, priority и unique idempotency key.
5. Завершение/failure/renewal проверяют владельца и срок lease.
6. Истёкший lease даёт retry либо dead-letter при исчерпании attempts.
7. Domain event записывается через outbox в той же transaction, что и business mutation.
8. Outbox dispatcher имеет отдельный lease и at-least-once семантику; consumers обязаны дедуплицировать эффекты.
9. Property values сохраняют канонический JSON и типизированные projection columns.
10. Файлы сохраняются вне SQLite в immutable content-addressed storage.

## Последствия

Положительные:

- нет отдельного брокера и дополнительного процесса;
- restart не теряет очередь и события;
- конфликт idempotency key обнаруживается явно;
- storage API можно использовать из API и worker;
- offline bundle не получает новую внешнюю зависимость.

Ограничения:

- sync SQLite calls блокируют event loop на время операции, поэтому transaction должны оставаться короткими;
- базовый deployment рассчитан на один сервер и ограниченное число concurrent writers;
- at-least-once допускает повтор consumer side effect, если consumer не реализовал собственную идемпотентность;
- горизонтальное масштабирование может потребовать новый adapter и отдельный ADR после измерений.

## Отклонённые варианты

### In-memory queue

Не переживает restart и нарушает `QUE-001`, `QUE-003` и `NFR-001`.

### Redis/RabbitMQ/Kafka

Увеличивают эксплуатационную сложность автономного контура и противоречат базовому ограничению `SYS-007` без доказанной необходимости.

### Выполнение handler внутри SQLite transaction

Удерживает write lock во время LLM/Office/network операций и нарушает `QUE-007`.

### Exactly-once как обещание системы

Невозможно гарантировать для SMTP и других внешних систем без их транзакционного участия. Система реализует at-least-once, deterministic IDs и явное состояние `unknown` для будущих delivery adapters.
