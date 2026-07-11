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
| M1 Persistence kernel | 🟡 | storage kernel, typed properties, queue, outbox, audit |
| M2 Secure OOXML intake | ⬜ | upload, security checks, DOCX/XLSX Document IR |
| M3 Template compiler | ⬜ | content controls, defined names, Safe Scalar render |
| M4 Manual workflow/UI | ⬜ | catalog, forms, review, download, RBAC |
| M5 Local LLM agents | ⬜ | mapping, extraction, formatting, evaluation |
| M6 Structured/generated docs | ⬜ | repeats, rich text, letters, reviews, packages |
| M7 Automation engine | ⬜ | schedule, events, idempotency, review queue |
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

## M1 candidate issues

- [x] Storage transaction API and unit-of-work
- [x] Typed property codec registry
- [x] Content-addressed object storage
- [x] Worker queue claim and lease renewal
- [x] Retry/dead-letter policies
- [x] Transactional outbox
- [x] Correlation-aware audit service
- [x] Entity/property REST API
- [ ] Backup and restore smoke test

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

- `0.1.x` — platform/bootstrap and deterministic kernel;
- `0.2.x` — Template Studio and Safe Scalar rendering;
- `0.3.x` — manual workflow and local LLM agents;
- `0.4.x` — structured/generated documents;
- `0.5.x` — automation and delivery;
- `1.0.0` — pilot acceptance and production baseline.
