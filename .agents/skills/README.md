# Проектные UI skills Оформлятора

Этот каталог — локальная адаптация профиля `docomator-ui-profile` из `f2re/ai-agents-skills`, закреплённая на source commit `c0d03d68771e93a17098cc4bc815e8b9374a15f2`.

## Приоритет

Skills не являются новым источником продуктовых требований. При конфликте всегда побеждают:

1. `AGENTS.md` и scoped `AGENTS.md`;
2. `docs/REQUIREMENTS.md`;
3. принятые ADR;
4. `docs/ARCHITECTURE.md`;
5. `docs/UX_UI_SPECIFICATION.md`, `docs/BRANDING.md`, `docs/INTERFACE_HIERARCHY.md`;
6. фактическая реализация и regression tests;
7. только затем этот каталог.

## Как использовать

- сложная UI-задача в нескольких областях → `skill-agent-orchestrator`;
- локальная маршрутизация UI → `ui-skill-router`;
- новая/существенно переработанная primary surface → сначала `anti-slop-ui-direction`;
- общий документный рабочий стол → `document-workstation-ux`;
- Visual Template Studio → `document-template-canvas-and-binding`;
- выпуск документов → `document-generation-flow`;
- извлечение/импорт → `document-extraction-and-import-review`;
- HTML/CSS/JS реализация → `offline-web-interface-engineering`;
- анимация/микроотклик → `motion-feedback-and-microinteractions`;
- финальная проверка → `ui-audit-and-acceptance`.

Не загружать весь каталог одновременно. Выбирать минимальный набор под текущий work object.

## Роли

Новые library-agents в проект не добавляются. Skills подключаются к существующим `product_designer`, `frontend_engineer`, `document_engineer`, `test_engineer`, а при необходимости к `security_reviewer` и `architecture_guardian`.

## Что намеренно не интегрировано

Qt/QML/Qwt и метеорологические skills не входят в проект. Оформлятор использует существующий offline HTML/CSS/JavaScript UI. Перенесены interaction principles, а не исходная платформенная/предметная оболочка.

## Обновление

Состав, source blob SHA и исключённые семейства зафиксированы в `VENDOR.json`. Обновление выполняется только после сравнения upstream с текущими требованиями Оформлятора; автоматическое перезаписывание project-local adaptations запрещено.
