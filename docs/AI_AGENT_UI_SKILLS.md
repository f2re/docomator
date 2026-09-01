# Интеграция UI skills для агентов

Статус: developer tooling. Runtime, storage schema, security boundary и release identity этим механизмом не меняются.

## Назначение

В проект встроен документно-ориентированный профиль из `f2re/ai-agents-skills`, адаптированный под фактический Оформлятор: offline HTML/CSS/JavaScript, Visual Template Studio, typed import/extraction, deterministic DOCX/XLSX generation и result/recovery flow.

Источник закреплён в `.agents/skills/VENDOR.json`. Project-local версии намеренно уже исходного универсального каталога: Qt/QML/Qwt и метеорологические маршруты не включены.

## Authority map

Skills — вспомогательный слой принятия UI/UX решений. Они не могут ослаблять требования и ADR.

Приоритет:

1. root/scoped `AGENTS.md`;
2. `REQUIREMENTS` и принятые ADR;
3. `ARCHITECTURE`;
4. `UX_UI_SPECIFICATION`, `BRANDING`, `INTERFACE_HIERARCHY`;
5. текущий code/test contract;
6. project skills.

При противоречии skill должен быть адаптирован, а не наоборот.

## Состав

| Skill | Роль |
|---|---|
| `skill-agent-orchestrator` | маршрутизация между существующими проектными агентами |
| `ui-skill-router` | выбор минимального набора UI skills |
| `anti-slop-ui-direction` | concept gate для новой/существенно переработанной primary surface |
| `document-workstation-ux` | общий маршрут и document-first hierarchy |
| `document-template-canvas-and-binding` | Visual Template Studio, selection/binding/repeat/trial |
| `document-generation-flow` | template/audience/preflight/correction/launch/retry/result |
| `document-extraction-and-import-review` | automatic-first extraction/import/repair |
| `offline-web-interface-engineering` | реализация в текущем offline web stack |
| `motion-feedback-and-microinteractions` | короткий purpose-driven motion без animation tax |
| `ui-audit-and-acceptance` | итоговый audit/acceptance |

## Existing-agent mapping

Project roles не заменяются library roles.

- `product_designer`: маршрутизация UI, anti-slop concept, document-workstation/generation/extraction semantics, финальный UX audit;
- `frontend_engineer`: `offline-web-interface-engineering` + профиль конкретного document flow + motion only as needed;
- `document_engineer`: template-canvas/extraction skills только вместе с действующими OOXML/Document IR/deterministic-renderer ограничениями;
- `test_engineer`: `ui-audit-and-acceptance` как источник acceptance matrix, но repository tests/requirements остаются первичными;
- `security_reviewer` и `architecture_guardian`: подключаются при затрагивании trust/space/domain boundaries, а не из-за обычного визуального изменения.

## Типовая маршрутизация

### Новый/переработанный основной экран

1. прочитать нормативные документы и текущий UI;
2. `anti-slop-ui-direction`;
3. зафиксировать Design Direction Contract;
4. `ui-skill-router` выбирает минимальный implementation set;
5. реализация через существующие project agents;
6. `ui-audit-and-acceptance` + штатный CI.

### Visual Template Studio

`document-template-canvas-and-binding` + `offline-web-interface-engineering`.

Ключевые инварианты: документ — primary work surface; inspector contextual; DOM не является binding identity; stale visual-layout не может выполнить commit; trial/reverse-read перед activation.

### Выпуск документов

`document-generation-flow` + при необходимости `document-workstation-ux`/`offline-web-interface-engineering`.

Ключевые инварианты: exact output count; stale preflight invalidation; correction without context loss; immutable launch/result; failed-only retry where supported.

### Извлечение/импорт

`document-extraction-and-import-review` + `offline-web-interface-engineering`; source-linked selection дополнительно использует template-canvas semantics.

Ключевые инварианты: automatic-first; immutable automatic result + correction layer; structured machine error; explicit import commit; current-space mapping only; no re-upload for preview repair.

## Motion

Motion не является отдельным визуальным стилем. Частые keyboard/selection actions мгновенны. Обычный hover/focus/state swap следует текущим tokens (примерно 120–160 ms). Допустим короткий contextual inspector transition. Page-flip, paper-flight, bounce, press-scale, pulsing fields, staggered list entrance и задержка готового result ради animation запрещены.

## Multi-platform discovery

Каноническая project copy находится в `.agents/skills/`. Для Claude те же файлы отражаются в `.claude/skills/`. Отдельные Claude/Antigravity agent roles не создаются: проект уже имеет собственную роль-модель, и skills должны встраиваться в неё, а не конкурировать с ней.

## Update procedure

1. получить новый exact upstream SHA;
2. сравнить только перечисленные в `VENDOR.json` skills;
3. проверить, не появилась ли новая platform/domain assumption;
4. вручную перенести полезное в project-local adaptation;
5. обновить `source.commit` и `sourceBlob` только после review;
6. выполнить regression test интеграции и полный PR CI.

Нельзя запускать vendor/update так, чтобы он автоматически переписал локальные skills или `.codex/agents`.
