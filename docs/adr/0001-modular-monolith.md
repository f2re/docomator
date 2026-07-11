# ADR-0001: Модульный монолит

- Статус: accepted
- Дата: 2026-07-11

## Контекст

Система разворачивается на одном автономном CPU-сервере и должна иметь минимум зависимостей. Микросервисы потребовали бы network orchestration, service discovery, broker и усложнённое обновление.

## Решение

Использовать TypeScript modular monolith с процессами API и worker. `llama-server` остаётся отдельным локальным процессом из-за собственного runtime и resource profile.

## Последствия

Плюсы:

- единый release bundle;
- SQLite transactions и простой audit;
- минимальная эксплуатационная поверхность;
- ясные module boundaries без distributed consistency.

Ограничения:

- vertical scaling в первой версии;
- необходимо явно контролировать worker concurrency;
- modules должны зависеть через ports, чтобы позднее выделить service при измеренной необходимости.
