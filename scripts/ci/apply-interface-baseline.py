#!/usr/bin/env python3
"""Apply the reviewed UI/UX baseline to existing project documents and packaging.

This script is intentionally one-shot: the PR workflow runs it, commits the
resulting readable files, and removes the script. Exact anchors keep the change
reviewable and fail loudly when main has diverged.
"""

from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one occurrence in {path}, found {count}: {old!r}")
    write(path, text.replace(old, new, 1))


def insert_before(path: str, marker: str, block: str, guard: str) -> None:
    text = read(path)
    if guard in text:
        return
    if marker not in text:
        raise SystemExit(f"Marker not found in {path}: {marker!r}")
    write(path, text.replace(marker, f"{block.rstrip()}\n\n{marker}", 1))


# ---------------------------------------------------------------------------
# Normative requirements
# ---------------------------------------------------------------------------
requirements = "docs/REQUIREMENTS.md"
replace_once(requirements, "Версия: **1.0-draft**", "Версия: **1.1-draft**")
replace_once(requirements, "Последнее обновление: **2026-07-11**", "Последнее обновление: **2026-07-12**")

insert_before(
    requirements,
    "## 2. Базовые ограничения",
    "Интерфейсные требования детализированы в [UX_UI_SPECIFICATION.md](UX_UI_SPECIFICATION.md). Общее ТЗ: [TECHNICAL_SPECIFICATION.md](TECHNICAL_SPECIFICATION.md).",
    "UX_UI_SPECIFICATION.md",
)

# Renumber sections after the new UX section. Work from the end to avoid
# accidental cascades.
for old, new in [
    ("## 19. Управление изменениями требований", "## 20. Управление изменениями требований"),
    ("## 18. Исключения первой версии", "## 19. Исключения первой версии"),
    ("## 17. Критерии приёмки верхнего уровня", "## 18. Критерии приёмки верхнего уровня"),
    ("## 16. Нефункциональные требования", "## 17. Нефункциональные требования"),
    ("## 15. Автономная установка и обновление", "## 16. Автономная установка и обновление"),
    ("## 14. Безопасность", "## 15. Безопасность"),
    ("## 13. Архив и аудит", "## 14. Архив и аудит"),
    ("## 12. Сохранение в сетевую папку", "## 13. Сохранение в сетевую папку"),
    ("## 11. Доставка электронной почтой", "## 12. Доставка электронной почтой"),
    ("## 10. Очередь и отказоустойчивость", "## 11. Очередь и отказоустойчивость"),
    ("## 9. Автоматизация, расписания и события", "## 10. Автоматизация, расписания и события"),
]:
    replace_once(requirements, old, new)

ux_requirements = """
## 9. Пользовательский интерфейс и сопровождение

| ID | Требование | Приоритет |
|---|---|---:|
| UX-001 | Интерфейс должен быть современным, спокойным, не перегруженным и построенным на единой token/component-системе. | MUST |
| UX-002 | Визуальное направление следует принципам ясности macOS/iOS без копирования закрытых компонентов и товарных знаков. | MUST |
| UX-003 | На каждом экране должна быть одна очевидная основная задача и не более одной визуально доминирующей кнопки. | MUST |
| UX-004 | Каждая операция должна показывать, что происходит, почему, что будет дальше и требуется ли действие пользователя. | MUST |
| UX-005 | Для loading запрещён безымянный бесконечный spinner; рядом указывается конкретный этап и безопасное ожидание/выход. | MUST |
| UX-006 | Фиктивный процент выполнения запрещён. Процент показывается только при измеримом backend progress. | MUST |
| UX-007 | Все коллекции и процессы должны иметь применимые состояния loading, empty, success, warning, error, degraded, disabled и planned. | MUST |
| UX-008 | Ошибка должна содержать понятную причину, сохранность введённых данных, действие восстановления и correlation ID. | MUST |
| UX-009 | Нетривиальные поля должны иметь пример и серое пояснение достаточного контраста о назначении значения. | MUST |
| UX-010 | Недоступное действие объясняет причину и условие разблокировки; ещё не реализованная функция честно помечается planned. | MUST |
| UX-011 | Длительная персистентная операция сообщает, можно ли покинуть страницу, и доступна в истории после возврата. | MUST |
| UX-012 | Иерархия уведомлений: inline → status ribbon → toast/notification center → modal только для блокирующего решения. | MUST |
| UX-013 | Интерфейс должен предоставлять контекстную помощь и ответы на частые вопросы без выхода из текущего сценария. | MUST |
| UX-014 | Текст должен быть конкретным, нейтральным и русскоязычным по умолчанию; внутренний жаргон объясняется. | MUST |
| UX-015 | Desktop использует боковую навигацию, mobile — нижнюю; интерфейс работает без горизонтального скролла от 320 px. | MUST |
| UX-016 | Минимальная зона касания интерактивного элемента — 44 × 44 CSS px с учётом safe area. | MUST |
| UX-017 | Поддерживаются светлая, тёмная и системная темы; смысл не передаётся только цветом. | MUST |
| UX-018 | Целевой уровень доступности — WCAG 2.2 AA: keyboard, visible focus, semantic landmarks, aria-live и reduced motion. | MUST |
| UX-019 | Emoji допустимы как вспомогательные маркеры, но обязаны сопровождаться текстом или доступной подписью. | MUST |
| UX-020 | Runtime UI не должен использовать CDN, внешние шрифты, аналитику или удалённые feature flags. | MUST |
| UX-021 | При серверной ошибке форма сохраняет введённые данные; success показывается только после подтверждения backend-а. | MUST |
| UX-022 | Любая новая UI-функция проходит состояния, mobile/keyboard/accessibility и offline проверки до отметки готовности. | MUST |
"""
insert_before(requirements, "## 10. Автоматизация, расписания и события", ux_requirements, "| UX-001 |")

replace_once(
    requirements,
    "| NFR-010 | Точная скорость и качество LLM подтверждаются benchmark/evaluation set на целевом CPU. | MUST |",
    "| NFR-010 | Точная скорость и качество LLM подтверждаются benchmark/evaluation set на целевом CPU. | MUST |\n"
    "| NFR-011 | Runtime UI assets должны входить в offline bundle и не обращаться к внешним доменам. | MUST |\n"
    "| NFR-012 | Базовый интерфейс должен оставаться функциональным при системном масштабировании текста до 200%. | SHOULD |",
)
replace_once(
    requirements,
    "| AC-014 | Чистая offline VM устанавливает проверенный release bundle без доступа в сеть. |",
    "| AC-014 | Чистая offline VM устанавливает проверенный release bundle без доступа в сеть. |\n"
    "| AC-015 | Пользователь всегда видит текущий этап операции, причину ожидания, следующий шаг и состояние сохранения. |\n"
    "| AC-016 | UI проходит UX-AC-001—UX-AC-010 из UX/UI ТЗ. |",
)
replace_once(
    requirements,
    "- Исключение из требования фиксируется отдельным ADR с рисками и сроком пересмотра.",
    "- Исключение из требования фиксируется отдельным ADR с рисками и сроком пересмотра.\n"
    "- UI-функция без состояний loading/empty/error/degraded и без следующего шага не может считаться завершённой.",
)

# ---------------------------------------------------------------------------
# Implementation plan
# ---------------------------------------------------------------------------
plan = "docs/IMPLEMENTATION_PLAN.md"
replace_once(plan, "## M0. Repository bootstrap — текущий инкремент", "## M0. Repository bootstrap — завершённый baseline")
replace_once(
    plan,
    "- Milestone не закрывается без tests, docs, migration/rollback notes и offline impact assessment.",
    "- Milestone не закрывается без tests, docs, migration/rollback notes и offline impact assessment.\n"
    "- Любая пользовательская функция одновременно проектирует основной сценарий, loading/empty/error/degraded states, мобильную компоновку, keyboard/focus и тексты следующего шага.",
)

ux_plan = """
## UX foundation — сквозной инкремент

**Требования:** UX-001—022, NFR-011—012.

**Цель:** задать единый сопровождающий интерфейс до появления сложных документных workflow.

Работы:

1. offline app shell с desktop sidebar и mobile bottom navigation;
2. design tokens, системная типографика, светлая/тёмная тема;
3. status ribbon, toast, help drawer и guided dialog forms;
4. loading, empty, success, warning, error, degraded и planned patterns;
5. рабочий Knowledge Registry UI;
6. понятные correlation ID и recovery actions;
7. accessibility baseline: keyboard, focus, aria-live, reduced motion, 320 px;
8. включение UI assets в offline bundle.

Definition of Done: пользователь создаёт тип, свойство и объект без отдельной инструкции; любой сетевой шаг объясняет текущее состояние и следующий шаг; runtime UI не обращается к внешним доменам.
"""
insert_before(plan, "## M2. Secure OOXML intake и Document IR", ux_plan, "## UX foundation —")

replace_once(
    plan,
    "**Требования:** DOC-001—004, FLD-001—010, IAM-001—006.",
    "**Требования:** DOC-001—004, FLD-001—010, IAM-001—006, UX-001—022.",
)
replace_once(
    plan,
    "8. multi-file bundles.",
    "8. multi-file bundles;\n9. operation timeline, contextual help и notification center;\n10. черновики форм, mobile flow и полная state matrix.",
)
replace_once(
    plan,
    "Definition of Done: пользователь создаёт документ через каталог и форму без LLM.",
    "Definition of Done: пользователь создаёт документ через каталог и форму без LLM, всегда видит текущий этап, причину ожидания, следующий шаг и сохранность введённых данных.",
)
replace_once(
    plan,
    "8. review tasks и operator queue.",
    "8. review tasks и operator queue;\n9. пользовательская timeline запуска, next retry и объяснимые partial/error states.",
)
replace_once(
    plan,
    "8. backup/restore and integrity scan.",
    "8. backup/restore and integrity scan;\n9. operational UI с состояниями accepted/rejected/unknown/retry и действиями восстановления.",
)

backlog_start = "## Ближайший backlog после bootstrap"
if backlog_start in read(plan):
    before = read(plan).split(backlog_start, 1)[0].rstrip()
    backlog = """
## Ближайший backlog

1. Secure OOXML intake с лимитами, quarantine и понятной progress timeline.
2. Compatibility report, объясняющий риск каждого Office-объекта обычным языком.
3. DOCX/XLSX Document IR и структурный preview с устойчивыми IDs.
4. Ручное выделение вариативного поля в guided Template Studio.
5. Общая библиотека UI state patterns для будущих document jobs и automations.
6. Authentication/RBAC baseline до публикации API за пределами доверенного localhost-контура.
"""
    write(plan, f"{before}\n\n{backlog.lstrip()}")

# ---------------------------------------------------------------------------
# Roadmap
# ---------------------------------------------------------------------------
roadmap = "docs/ROADMAP.md"
replace_once(
    roadmap,
    "| M1 Persistence kernel | ✅ | transactions, typed values, object storage, queue, outbox, audit, Knowledge API, backup/restore |\n| M2 Secure OOXML intake | ⬜ | upload, security checks, DOCX/XLSX Document IR |",
    "| M1 Persistence kernel | ✅ | transactions, typed values, object storage, queue, outbox, audit, Knowledge API, backup/restore |\n"
    "| M1.5 Guided UI foundation | 🟡 | offline shell, Knowledge UI, состояния, помощь, adaptive/accessibility baseline |\n"
    "| M2 Secure OOXML intake | ⬜ | upload, security checks, DOCX/XLSX Document IR |",
)

ux_checklist = """
## M1.5 Guided UI checklist

- [x] Offline UI shell без CDN и внешних шрифтов
- [x] Desktop sidebar и mobile bottom navigation
- [x] Светлая, тёмная и системная темы
- [x] Status ribbon, toast, help drawer и guided dialogs
- [x] Loading, empty, success, warning, error, degraded и planned states
- [x] Knowledge Registry UI для типов, свойств и сущностей
- [x] Correlation ID и сохранение формы при ошибке
- [x] Keyboard, visible focus, reduced motion и 320 px baseline
- [x] Основное ТЗ и отдельное UX/UI ТЗ
- [ ] Автоматизированная browser accessibility/visual regression проверка
- [ ] Notification center для персистентных фоновых операций
- [ ] User testing на сценариях Template Studio и document workflow
"""
insert_before(roadmap, "## Следующий приоритет", ux_checklist, "## M1.5 Guided UI checklist")
replace_once(
    roadmap,
    "6. fixtures и negative security tests.",
    "6. fixtures и negative security tests;\n7. guided progress: приём файла → проверка → compatibility report → следующий безопасный шаг.",
)

# ---------------------------------------------------------------------------
# README
# ---------------------------------------------------------------------------
readme = "README.md"
replace_once(
    readme,
    "[![Status: persistence kernel](https://img.shields.io/badge/status-persistence%20kernel-1f6feb)](#-текущее-состояние)",
    "[![Status: guided UI foundation](https://img.shields.io/badge/status-guided%20UI%20foundation-1f6feb)](#-текущее-состояние)",
)
replace_once(
    readme,
    "> Проект находится на этапе persistence kernel. Уже работают API/worker bootstrap, Knowledge Registry REST API, SQLite unit-of-work, типизированные projections, content-addressed storage, persistent queue, transactional outbox, audit, checksum-protected backup/restore, миграции и офлайн-упаковка. DOCX/XLSX renderer, Template Studio, scheduler и delivery-коннекторы находятся в roadmap и ещё не заявлены как готовые функции.",
    "> Проект находится на этапе guided UI foundation. Уже работают локальный адаптивный интерфейс, Knowledge Registry UI/API, SQLite unit-of-work, типизированные projections, content-addressed storage, persistent queue, transactional outbox, audit, checksum-protected backup/restore и офлайн-упаковка. DOCX/XLSX intake/renderer, полный Template Studio, scheduler и delivery-коннекторы находятся в roadmap и честно помечены как ещё не готовые.",
)
replace_once(
    readme,
    "| Web UI | ⬜ | запланировано |",
    "| Web UI | 🟡 | offline app shell, Knowledge UI, состояния, помощь, adaptive/dark mode |",
)

ui_readme = """
## ✨ Интерфейс без догадок

Откройте после запуска:

```text
http://127.0.0.1:8080/
```

Интерфейс построен по принципу: **пользователь всегда понимает, что происходит, почему и что делать дальше**.

- 🏠 обзор готовности и рекомендуемый следующий шаг;
- 🗂️ рабочая база знаний для типов, свойств и объектов;
- ⏳ конкретный этап вместо безымянного spinner;
- ✅ подтверждение только после ответа backend-а;
- ⚠️ исправимая ошибка с сохранённой формой и correlation ID;
- 💡 серые контекстные подсказки и встроенные ответы на частые вопросы;
- 📱 desktop sidebar, mobile bottom navigation и touch targets от 44 px;
- 🌗 светлая, тёмная и системная темы;
- ♿ keyboard, visible focus, aria-live и reduced motion;
- 🔒 без CDN, внешних шрифтов и аналитики.

> [!NOTE]
> Разделы шаблонов, документов и автоматизаций показываются как **запланированные**, а не имитируют готовую работу. Это сознательное UX-требование.

Подробный контракт: [UX/UI ТЗ](docs/UX_UI_SPECIFICATION.md).
"""
insert_before(readme, "## 🏗️ Архитектура", ui_readme, "## ✨ Интерфейс без догадок")
replace_once(
    readme,
    "curl http://127.0.0.1:8080/api/v1/knowledge/entity-types",
    "curl http://127.0.0.1:8080/api/v1/knowledge/entity-types\n# интерфейс: http://127.0.0.1:8080/",
)
replace_once(
    readme,
    "apps/api/               HTTP API",
    "apps/api/               HTTP API\napps/api/ui/            локальный адаптивный Web UI",
)
replace_once(
    readme,
    "- [Требования](docs/REQUIREMENTS.md)",
    "- [Основное ТЗ](docs/TECHNICAL_SPECIFICATION.md)\n- [UX/UI ТЗ](docs/UX_UI_SPECIFICATION.md)\n- [Требования](docs/REQUIREMENTS.md)",
)
replace_once(
    readme,
    "| `docs_maintainer` | требования, roadmap и пользовательская документация |",
    "| `docs_maintainer` | требования, roadmap и пользовательская документация |\n"
    "| `product_designer` | информационная архитектура, тексты, состояния и accessibility |\n"
    "| `frontend_engineer` | offline UI, adaptive layout, forms и UI tests |",
)

# ---------------------------------------------------------------------------
# Architecture and agent rules
# ---------------------------------------------------------------------------
architecture = "docs/ARCHITECTURE.md"
ui_architecture = """
### 3.1. Interface architecture

UI является локальным HTTP-адаптером модульного монолита и не принимает доменных решенийений. Он:

- отображает backend state, а не выводит его из таймеров или предположений;
- использует единую систему design tokens и state components;
- для каждого действия показывает текущий этап, причину ожидания, следующий шаг и recovery action;
- хранит черновое значение формы до подтверждения backend-а;
- передаёт/показывает correlation ID;
- не использует CDN, внешние шрифты, аналитику и удалённые feature flags;
- сохраняет keyboard/mobile/accessibility behavior как часть API-контракта функции.

Полный нормативный контракт: [UX_UI_SPECIFICATION.md](UX_UI_SPECIFICATION.md).
"""
insert_before(architecture, "## 4. Универсальная модель данных", ui_architecture, "### 3.1. Interface architecture")

agents = "AGENTS.md"
replace_once(
    agents,
    "- `apps/api`: Fastify HTTP adapter and request lifecycle.",
    "- `apps/api`: Fastify HTTP adapter and request lifecycle.\n- `apps/api/ui`: offline guided UI; follow `apps/api/ui/AGENTS.md` and `docs/UX_UI_SPECIFICATION.md`.",
)
insert_before(
    agents,
    "## Offline-release rules",
    """## UI rules

- A user must never have to infer whether an operation started, is waiting, failed, or completed.
- Implement applicable loading, empty, success, warning, error, degraded, disabled, and planned states.
- State copy explains the current step, why it is happening, what comes next, and whether data is preserved.
- Preserve form values after server errors and expose correlation IDs.
- Keep runtime UI offline: no CDN, remote fonts, analytics, or external assets.
- Verify 320 px, keyboard/focus, touch targets, dark mode, and reduced motion.
""",
    "## UI rules",
)

# ---------------------------------------------------------------------------
# Build/check/offline packaging
# ---------------------------------------------------------------------------
package_json = "package.json"
replace_once(
    package_json,
    '"check:shell": "bash scripts/ci/validate-shell.sh",\n    "check": "npm run clean && npm run build && npm run test && npm run check:docs && npm run check:shell",',
    '"check:shell": "bash scripts/ci/validate-shell.sh",\n    "check:ui": "node --check apps/api/ui/app.js",\n    "check": "npm run clean && npm run build && npm run test && npm run check:docs && npm run check:shell && npm run check:ui",',
)

bundle = "scripts/offline/prepare-bundle.sh"
replace_once(
    bundle,
    "done\n\ncp -a \"$NODE_STAGE/.\" \"$BUNDLE_DIR/payload/runtime/node/\"",
    "done\n\ncp -a \"$ROOT_DIR/apps/api/ui\" \"$BUNDLE_DIR/payload/app/apps/api/\"\n\ncp -a \"$NODE_STAGE/.\" \"$BUNDLE_DIR/payload/runtime/node/\"",
)

# Fix the initial UI render after a successful fetch: rendering is explicit
# while the loading flag is still true, so renderKnowledge must not suppress it.
ui_script = "apps/api/ui/app.js"
replace_once(ui_script, "  if (state.loading) return;\n  const meta = tabs[state.tab];", "  const meta = tabs[state.tab];")

print("Applied guided interface baseline updates.")
