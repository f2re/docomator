# ADR-0003: Персистентные автоматизации и идемпотентность

- Статус: accepted
- Дата: 2026-07-11

## Контекст

In-memory timers теряются при restart, а повторы событий и неопределённые результаты SMTP создают дубли.

## Решение

Хранить schedules, domain events, automation runs, worker jobs и deliveries в SQLite. Каждый уровень получает отдельный deterministic idempotency key. Внутренние события создаются transactional outbox-ом. Worker использует lease и retry state.

## Последствия

- restart не теряет работу;
- duplicate events подавляются unique constraints;
- delivery может повторяться отдельно от render;
- `unknown` становится отдельным состоянием, требующим controlled policy.
