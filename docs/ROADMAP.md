# Roadmap Docomator

Roadmap отражает статус реализации, но не заменяет [требования](REQUIREMENTS.md).

## Обозначения

- ✅ завершено и проверено;
- 🟡 выполняется или доступен ограниченный bootstrap;
- ⬜ не начато;
- ⛔ заблокировано решением/внешней зависимостью.

## Milestones

| Milestone | Статус | Результат |
|---|---:|---|
| M0 Repository bootstrap | 🟡 | runnable API/worker, schema, docs, Codex agents, offline scripts |
| M1 Persistence kernel | ✅ | transactions, typed values, object storage, queue, outbox, audit, Knowledge API, backup/restore |
| M1.5 Guided UI foundation | 🟡 | offline shell, Knowledge UI, состояния, помощь, adaptive/accessibility baseline |
| M1.6 Spaces and audiences | ✅ | изоляция, группы, immutable snapshots, aggregate/per-member target plans |
| M2 Secure OOXML intake | ⬜ | upload, security checks, DOCX/XLSX Document IR |
| M3 Template compiler | ⬜ | content controls, defined names, Safe Scalar и aggregate repeat render |
| M4 Manual workflow/UI | ⬜ | catalog, audience, forms, review, download, RBAC |
| M5 Local LLM agents | ⬜ | mapping, extraction, formatting, evaluation |
| M6 Structured/generated docs | ⬜ | repeats, rich text, letters, reviews, packages |
| M7 Automation engine | ⬜ | schedule, events, space-scoped audiences, idempotency, review queue |
| M8 Delivery/operations | ⬜ | SMTP, network folders, metrics, retention |
| M9 Pilot hardening | ⬜ | real templates, security, recovery, RC |

## M0 checklist

- [x] Repository structure and npm workspaces
- [x] Strict TypeScript baseline
- [x] Fastify API bootstrap
- [x] Worker lifecycle bootstrap
- [x] SQLite migration runner
- [x] Initial domain schema
- [x] Requirements and architecture baseline
- [x] Codex root instructions
- [x] Project-scoped Codex custom agents
- [x] Offline bundle preparation script
- [x] Offline install/update/rollback scripts
- [x] Network-free install/update smoke-test harness
- [x] systemd hardened unit templates
- [x] CI workflow definition
- [ ] Validate full bundle under Node.js 24.18 on reference Debian/Astra image
- [ ] Validate install/update rollback on clean systemd VM
- [x] Merge bootstrap PR

## M1 checklist

- [x] Storage transaction API and unit-of-work
- [x] Typed property codec registry
- [x] Content-addressed object storage
- [x] Worker queue claim and lease renewal
- [x] Retry/dead-letter policies
- [x] Transactional outbox
- [x] Correlation-aware audit service
- [x] Entity/property REST API
- [x] Online SQLite backup with integrity verification
- [x] Object/config checksum manifest
- [x] Atomic restore with pre-restore rollback
- [x] Backup and restore integration tests

## M1.5 Guided UI checklist

- [x] Offline UI shell без CDN и внешних шрифтов
- [x] Desktop sidebar и mobile bottom navigation
- [x] Светлая, тёмная и системная темы
- [x] Status ribbon, toast, help drawer и guided dialogs
- [x] Loading, empty, success, warning, error, degraded и planned states
- [x] Knowledge Registry UI для типов и свойств
- [x] Пространства, участники, группы и audience planning UI
- [x] Correlation ID и сохранение формы при ошибке
- [x] Keyboard, visible focus, reduced motion и 320 px baseline
- [x] Основное ТЗ и отдельное UX/UI ТЗ
- [ ] Автоматизированная browser accessibility/visual regression проверка
- [ ] Notification center для персистентных фоновых операций
- [ ] User testing на сценариях Template Studio и document workflow

## M1.6 Spaces and audiences checklist

- [x] Изолированные spaces и deterministic default space
- [x] Actor memberships и роли `owner`, `manager`, `editor`, `viewer`
- [x] Ровно одно пространство для конкретной сущности
- [x] Именованные ordered groups
- [x] Выбор всех активных, группы или отмеченных сущностей
- [x] Immutable audience snapshots
- [x] `one_per_member` target plan
- [x] `aggregate` target plan с `audience.members`
- [x] Same-space guards в API и SQLite
- [x] Outbox, audit и correlation ID для мутаций
- [x] Storage и API integration tests
- [x] Guided UI с точным прогнозом количества документов
- [x] First-run helper для автономной установки
- [ ] DOCX/XLSX repeat renderer — M3/M6
- [ ] Создание document jobs из target plan — M4
- [ ] Применение actor memberships в IAM/RBAC — M4

## Следующий приоритет

M2 начинается с безопасного intake без LLM и сразу учитывает уже готовую аудиторию:

1. лимиты и проверка ZIP/OOXML;
2. запрет path traversal и external relationships;
3. compatibility report;
4. DOCX/XLSX Document IR;
5. детерминированные кандидаты вариативных полей;
6. fixtures и negative security tests;
7. guided progress: приём файла → проверка → compatibility report → следующий безопасный шаг;
8. manifest binding повторяющейся таблицы/списка к `audience.members`.

## Decision gates

| Gate | Решение, которое требуется |
|---|---|
| G1 | Reference Astra/Debian image, CPU architecture and glibc baseline |
| G2 | Initial GGUF model and evaluation threshold for Russian tasks |
| G3 | Supported LibreOffice and Microsoft Office versions |
| G4 | Authentication baseline: local only or LDAP/AD adapter in pilot |
| G5 | SMTP relay constraints and allowed recipient domains |
| G6 | Network share roots, mount method and sentinel convention |
| G7 | Retention periods and restricted-data policy |

## Release line

- `0.1.x` — platform/bootstrap, deterministic kernel, spaces и audiences;
- `0.2.x` — Template Studio и Safe Scalar/aggregate rendering;
- `0.3.x` — manual workflow и local LLM agents;
- `0.4.x` — structured/generated documents;
- `0.5.x` — automation и delivery;
- `1.0.0` — pilot acceptance и production baseline.
