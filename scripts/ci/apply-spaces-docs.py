#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from textwrap import dedent


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def clean(block: str) -> str:
    return dedent(block).strip()


def insert_before(text: str, marker: str, block: str, sentinel: str) -> str:
    if sentinel in text:
        return text
    if marker not in text:
        raise SystemExit(f"Marker not found: {marker!r}")
    return text.replace(marker, clean(block) + "\n\n" + marker, 1)


def insert_after(text: str, marker: str, block: str, sentinel: str) -> str:
    if sentinel in text:
        return text
    if marker not in text:
        raise SystemExit(f"Marker not found: {marker!r}")
    return text.replace(marker, marker + "\n" + clean(block), 1)


# Normative requirements
path = "docs/REQUIREMENTS.md"
text = read(path).replace("Версия: **1.1-draft**", "Версия: **1.2-draft**")
text = insert_before(
    text,
    "## 4. Универсальная база сущностей и свойств",
    """
    ## 3.1. Пространства, группы и аудитории

    | ID | Требование | Приоритет |
    |---|---|---:|
    | SPACE-001 | Система должна поддерживать изолированные пространства для подразделений, проектов, филиалов и иных областей данных. | MUST |
    | SPACE-002 | Конкретная сущность должна принадлежать ровно одному пространству; типы сущностей и определения свойств могут быть общей схемой. | MUST |
    | SPACE-003 | Доступ пользователей приложения к пространству должен задаваться отдельным membership с ролями `owner`, `manager`, `editor`, `viewer`. | MUST |
    | SPACE-004 | Идентификатор ресурса из другого пространства не должен раскрывать или разрешать этот ресурс; операция отклоняется до мутации. | MUST |
    | SPACE-005 | Внутри пространства должны поддерживаться редактируемые именованные группы сущностей с устойчивым порядком участников. | MUST |
    | SPACE-006 | Участник группы обязан принадлежать тому же пространству; межпространственное членство запрещено на уровне backend и БД. | MUST |
    | SPACE-007 | Аудитория документа выбирается из всех активных сущностей пространства, именованной группы или явно отмеченных сущностей. | MUST |
    | SPACE-008 | Перед запуском создаётся неизменяемый снимок аудитории с порядком, отображаемыми данными, критериями, автором, временем и correlation ID. | MUST |
    | SPACE-009 | Пустая аудитория должна быть отклонена с понятным сообщением и следующим шагом. | MUST |
    | SPACE-010 | Режим `one_per_member` должен создавать отдельную исполнимую единицу для каждого участника. | MUST |
    | SPACE-011 | Режим `aggregate` должен создавать одну исполнимую единицу с упорядоченной коллекцией `audience.members`. | MUST |
    | SPACE-012 | Template Compiler должен поддержать вывод `audience.members` как таблицы, списка, repeat row/range или иного разрешённого повторяющегося блока. | MUST |
    | SPACE-013 | Document job и automation rule должны фиксировать `space_id`, audience snapshot и фактически использованный target mode. | MUST |
    """,
    "SPACE-001",
)
text = insert_after(
    text,
    "| DOC-010 | Повторный render с изменёнными данными создаёт новую revision и не перезаписывает прежнюю. | MUST |",
    """
    | DOC-011 | Перед формированием пользователь должен видеть пространство, источник аудитории, точный состав и ожидаемое число документов. | MUST |
    | DOC-012 | Для сводного документа renderer должен получать коллекцию `audience.members`, а не случайно выбранного «основного» человека. | MUST |
    | DOC-013 | Для индивидуального режима каждый document unit должен иметь собственный `subject` и один member в локальном audience context. | MUST |
    | DOC-014 | Изменение именованной группы после начала запуска не должно менять уже созданный audience snapshot. | MUST |
    """,
    "DOC-011",
)
text = insert_after(
    text,
    "| AUT-019 | Generated legal/content blocks по умолчанию требуют проверки человеком. | MUST |",
    """
    | AUT-020 | Правило автоматизации должно быть ограничено одним пространством. | MUST |
    | AUT-021 | До создания document jobs автоматизация должна разрешить аудиторию и сохранить immutable snapshot. | MUST |
    | AUT-022 | Правило должно явно выбрать `aggregate` или `one_per_member`; режим не выводится неявно из размера группы. | MUST |
    """,
    "AUT-020",
)
text = insert_after(
    text,
    "| AC-016 | UI проходит UX-AC-001—UX-AC-010 из UX/UI ТЗ. |",
    """
    | AC-017 | Данные двух пространств не смешиваются в списках, группах, снимках и document target plan. |
    | AC-018 | Для одной аудитории система строит либо N индивидуальных units, либо один aggregate unit с `audience.members`. |
    """,
    "AC-017",
)
write(path, text)

# Main technical specification
path = "docs/TECHNICAL_SPECIFICATION.md"
text = read(path).replace("Версия: **1.1-draft**", "Версия: **1.2-draft**")
text = text.replace(
    "- расширять базу людей, организаций и любых других сущностей;\n",
    "- расширять базу людей, организаций и любых других сущностей;\n"
    "- разделять конкретные данные по изолированным пространствам;\n"
    "- выбирать всех, группу или отмеченных участников;\n"
    "- формировать один сводный документ либо отдельный документ на каждого;\n",
    1,
)
text = text.replace(
    "7. Интерфейс не скрывает состояние, не показывает фиктивный прогресс и не допускает молчаливых ошибок.\n",
    "7. Интерфейс не скрывает состояние, не показывает фиктивный прогресс и не допускает молчаливых ошибок.\n"
    "8. Пространство является серверной границей изоляции, а не только фильтром интерфейса.\n"
    "9. Состав документа фиксируется immutable audience snapshot до рендера.\n",
    1,
)
for old, new in [
    ("### 5.6. Эксплуатация", "### 5.7. Эксплуатация"),
    ("### 5.5. Доставка", "### 5.6. Доставка"),
    ("### 5.4. Автоматизация", "### 5.5. Автоматизация"),
    ("### 5.3. Формирование документов", "### 5.4. Формирование документов"),
    ("### 5.2. Template Studio", "### 5.3. Template Studio"),
]:
    text = text.replace(old, new, 1)
text = insert_before(
    text,
    "### 5.3. Template Studio",
    """
    ### 5.2. Пространства и аудитории

    - изолированные пространства и memberships пользователей приложения;
    - принадлежность каждой конкретной сущности одному пространству;
    - именованные группы внутри пространства;
    - выбор всех активных, группы или отмеченных участников;
    - immutable audience snapshot;
    - `one_per_member`: отдельная единица на каждого;
    - `aggregate`: одна единица с `audience.members` для таблицы или списка;
    - запрет межпространственных ссылок и смешивания данных.
    """,
    "### 5.2. Пространства и аудитории",
)
old_order = clean("""
1. Платформенное и persistence-ядро.
2. Guided UI foundation и Knowledge Registry UI.
3. Secure OOXML intake.
4. Template compiler и Safe Scalar renderer.
5. Ручной документный workflow и RBAC.
6. Локальные LLM-агенты.
7. Structured/generated documents.
8. Automation engine.
9. Delivery и operational dashboard.
10. Пилотное усиление.
""")
new_order = clean("""
1. Платформенное и persistence-ядро.
2. Guided UI foundation и Knowledge Registry UI.
3. Пространства, группы и target planning аудитории.
4. Secure OOXML intake.
5. Template compiler, Safe Scalar и aggregate repeat renderer.
6. Ручной документный workflow и RBAC.
7. Локальные LLM-агенты.
8. Structured/generated documents.
9. Automation engine.
10. Delivery и operational dashboard.
11. Пилотное усиление.
""")
text = text.replace(old_order, new_order, 1)
text = text.replace(
    "- произвольное свойство создаётся через UI;\n",
    "- произвольное свойство создаётся через UI;\n"
    "- пространства изолируют конкретные сущности и будущие запуски;\n"
    "- один состав формируется как N документов либо одна повторяющаяся таблица/список;\n",
    1,
)
write(path, text)

# UX/UI specification
path = "docs/UX_UI_SPECIFICATION.md"
text = read(path).replace("Версия: **1.0-draft**", "Версия: **1.1-draft**")
text = text.replace(
    "| 🏠 Обзор | готовность, следующий шаг, важные статусы | «Что мне делать сейчас?» |\n",
    "| 🏠 Обзор | готовность, следующий шаг, важные статусы | «Что мне делать сейчас?» |\n"
    "| 🧑‍🤝‍🧑 Пространства | изолированные участники, группы и аудитории | «Для кого и в каком виде создать документ?» |\n",
    1,
)
text = insert_before(
    text,
    "## 4. Обязательная модель состояний",
    """
    ## 3.1. Guided flow пространства и аудитории

    Интерфейс сопровождает пользователя в порядке:

    ```text
    выбрать пространство
    → добавить или отметить участников
    → при необходимости сохранить группу
    → выбрать всех / группу / отмеченных
    → выбрать один общий документ / по документу на каждого
    → показать точный прогноз
    → зафиксировать снимок
    → объяснить следующий этап рендера
    ```

    На экране всегда показаны текущее пространство, число участников и групп, количество отмеченных записей, источник аудитории, ожидаемое число документов, различие между таблицей/списком и индивидуальными документами, неизменяемость снимка и честный статус renderer-а.

    Пространство и группа не должны визуально смешиваться: пространство является текущим контекстом, группа — выбираемым набором внутри него.
    """,
    "## 3.1. Guided flow пространства",
)
text = insert_after(
    text,
    "| UX-AC-010 | Проверяющий всегда может ответить: текущий этап, причина ожидания, следующий шаг и результат. |",
    """
    | UX-AC-011 | Пользователь без инструкции создаёт пространство, добавляет людей и сохраняет отмеченных как группу. |
    | UX-AC-012 | До фиксации аудитории интерфейс правильно объясняет, получится один документ или N документов. |
    | UX-AC-013 | Пользователь понимает, что aggregate-режим передаёт список `audience.members`, а renderer ещё не имитируется. |
    """,
    "UX-AC-011",
)
write(path, text)

# Architecture
path = "docs/ARCHITECTURE.md"
text = read(path)
text = insert_before(
    text,
    "## 4. Универсальная модель данных",
    """
    ### 3.2. Space and audience boundary

    Пространство является application/domain boundary:

    - конкретная сущность принадлежит одному `space_id`;
    - API маршруты аудитории всегда включают `spaceId`;
    - group member и snapshot member проходят same-space validation;
    - именованная группа редактируема, audience snapshot неизменяем;
    - `aggregate` создаёт одну target unit с `audience.members`;
    - `one_per_member` создаёт target unit для каждого `subject`;
    - document jobs и automation rules фиксируют пространство и snapshot.

    Подробный контракт: [SPACES_AND_AUDIENCES.md](SPACES_AND_AUDIENCES.md).
    """,
    "### 3.2. Space and audience boundary",
)
write(path, text)

# Implementation plan
path = "docs/IMPLEMENTATION_PLAN.md"
text = read(path)
text = insert_before(
    text,
    "## UX foundation — сквозной инкремент",
    """
    ## M1.6. Пространства и target planning аудитории — завершённый инкремент

    **Требования:** SPACE-001—013, DOC-011—014, AUT-020—022.

    Реализовано:

    1. изолированные пространства и deterministic default space;
    2. роли доступа пользователей приложения;
    3. принадлежность конкретной сущности ровно одному пространству;
    4. именованные группы и ordered members;
    5. выбор всех активных, группы или отмеченных сущностей;
    6. immutable audience snapshot с audit/outbox;
    7. `one_per_member` target plan;
    8. `aggregate` target plan с `audience.members`;
    9. REST API и guided UI;
    10. cross-space, immutability и API integration tests;
    11. first-run install helper.

    Отложено в M3/M4: физический вывод `audience.members` в DOCX/XLSX и создание document jobs из target plan.

    Definition of Done: backend и UI одинаково рассчитывают состав и число units; межпространственная ссылка отклоняется; `npm run check` проходит.
    """,
    "## M1.6. Пространства",
)
text = text.replace(
    "5. scalar renderer и formatter registry;\n6. structural validation/reverse-read;\n7. LibreOffice preview adapter;\n8. regression fixtures и activation gate.",
    "5. scalar renderer и formatter registry;\n"
    "6. aggregate renderer: repeat row/list/range из `audience.members`;\n"
    "7. structural validation/reverse-read;\n"
    "8. LibreOffice preview adapter;\n"
    "9. regression fixtures и activation gate.",
    1,
)
text = text.replace(
    "3. document job state machine;",
    "3. document job state machine, space scope и audience snapshot;",
    1,
)
text = text.replace(
    "8. multi-file bundles;\n9. operation timeline, contextual help и notification center;\n10. черновики форм, mobile flow и полная state matrix.",
    "8. multi-file bundles;\n"
    "9. выбор all/group/selected и aggregate/one_per_member;\n"
    "10. operation timeline, contextual help и notification center;\n"
    "11. черновики форм, mobile flow и полная state matrix.",
    1,
)
text = text.replace(
    "4. event API и domain-event consumers;\n5. declarative filter DSL;",
    "4. event API и domain-event consumers;\n"
    "5. space-scoped audience resolution и immutable snapshot;\n"
    "6. declarative filter DSL;",
    1,
)
text = text.replace("6. target selection/grouping/aggregation;", "7. target selection/grouping/aggregation;", 1)
text = text.replace("7. run idempotency и dry-run;", "8. run idempotency и dry-run;", 1)
text = text.replace("8. review tasks и operator queue;", "9. review tasks и operator queue;", 1)
text = text.replace("9. пользовательская timeline запуска", "10. пользовательская timeline запуска", 1)
write(path, text)

# Roadmap
path = "docs/ROADMAP.md"
text = read(path)
text = text.replace(
    "| M1 Persistence kernel | ✅ | transactions, typed values, object storage, queue, outbox, audit, Knowledge API, backup/restore |\n",
    "| M1 Persistence kernel | ✅ | transactions, typed values, object storage, queue, outbox, audit, Knowledge API, backup/restore |\n"
    "| M1.6 Spaces and audiences | ✅ | isolation, groups, immutable snapshots, aggregate/per-member target plans |\n",
    1,
)
text = insert_before(
    text,
    "## M1.5 Guided UI checklist",
    """
    ## M1.6 Spaces and audiences checklist

    - [x] Spaces и deterministic default space
    - [x] Actor memberships и роли пространства
    - [x] Ровно одно пространство для конкретной сущности
    - [x] Именованные ordered groups
    - [x] All-space, group и selected audiences
    - [x] Immutable audience snapshots
    - [x] `one_per_member` target plan
    - [x] `aggregate` target plan с `audience.members`
    - [x] Same-space guards и negative tests
    - [x] REST API и guided UI
    - [x] README, ТЗ, план и first-run helper
    - [ ] DOCX/XLSX repeat renderer — M3/M6
    - [ ] Document-job orchestration из target plan — M4
    """,
    "## M1.6 Spaces and audiences checklist",
)
text = text.replace(
    "7. guided progress: приём файла → проверка → compatibility report → следующий безопасный шаг.",
    "7. guided progress: приём файла → проверка → compatibility report → следующий безопасный шаг;\n"
    "8. manifest binding повторяющейся таблицы/списка к `audience.members`.",
    1,
)
write(path, text)

# README
path = "README.md"
text = read(path)
text = text.replace("status-guided%20UI%20foundation", "status-spaces%20%26%20audiences")
text = text.replace(
    "> Проект находится на этапе guided UI foundation. Уже работают локальный адаптивный интерфейс, Knowledge Registry UI/API, SQLite unit-of-work, типизированные projections, content-addressed storage, persistent queue, transactional outbox, audit, checksum-protected backup/restore и офлайн-упаковка.",
    "> Проект находится на этапе spaces and audiences. Уже работают изолированные пространства, участники и группы, immutable audience snapshots, aggregate/per-member target plans, локальный адаптивный интерфейс, Knowledge Registry UI/API, SQLite unit-of-work, persistent queue, audit, backup/restore и офлайн-упаковка.",
    1,
)
text = text.replace(
    "| Persistence kernel | ✅ | SQLite transactions, typed codecs, object storage, queue, outbox, audit и backup/restore |\n",
    "| Persistence kernel | ✅ | SQLite transactions, typed codecs, object storage, queue, outbox, audit и backup/restore |\n"
    "| Пространства и аудитории | ✅ | изоляция, группы, снимки, один общий или N индивидуальных планов |\n",
    1,
)
text = insert_before(
    text,
    "## ✨ Интерфейс без догадок",
    """
    ## 👥 Пространства и аудитории

    В разделе **«Пространства»** уже можно:

    - 🧑‍🤝‍🧑 создать отдельный контур подразделения или проекта;
    - 👥 добавить людей только в выбранное пространство;
    - ☑️ отметить произвольных участников;
    - 🗃️ сохранить отмеченных как именованную группу;
    - 📸 зафиксировать неизменяемый снимок состава;
    - 📄 выбрать **по документу на каждого**;
    - 📋 выбрать **один общий документ** с коллекцией `audience.members`.

    ```text
    all active / named group / selected people
                        ↓
                 immutable snapshot
                 ↙                  ↘
    N × one_per_member          1 × aggregate
                                audience.members
    ```

    > [!NOTE]
    > Выбор аудитории и точное число будущих документов уже реализованы. Физический вывод `audience.members` в повторяющуюся таблицу DOCX/XLSX относится к Template Compiler и честно отмечен следующим этапом.

    Подробный контракт: [SPACES_AND_AUDIENCES.md](docs/SPACES_AND_AUDIENCES.md).
    """,
    "## 👥 Пространства и аудитории",
)
text = text.replace(
    "- [UX/UI ТЗ](docs/UX_UI_SPECIFICATION.md)\n",
    "- [UX/UI ТЗ](docs/UX_UI_SPECIFICATION.md)\n"
    "- [Пространства и аудитории](docs/SPACES_AND_AUDIENCES.md)\n",
    1,
)
write(path, text)

# Agent invariants
path = "AGENTS.md"
text = read(path)
text = text.replace(
    "- Every external side effect needs a correlation ID and idempotency key.\n",
    "- Every external side effect needs a correlation ID and idempotency key.\n"
    "- Every document and automation must be scoped to one space before resolving entities.\n"
    "- Named groups are mutable; audience snapshots are immutable and preserve member order.\n"
    "- `aggregate` means one unit with `audience.members`; `one_per_member` means one unit per explicit `subject`.\n",
    1,
)
write(path, text)

# Offline bundle and installation guidance
path = "scripts/offline/prepare-bundle.sh"
text = read(path)
if '"$SCRIPT_DIR/first-run.sh"' not in text:
    marker = '  "$SCRIPT_DIR/restore.sh" \\\n'
    if marker not in text:
        raise SystemExit("prepare-bundle copy marker not found")
    text = text.replace(marker, marker + '  "$SCRIPT_DIR/first-run.sh" \\\n', 1)
write(path, text)

path = "scripts/offline/install.sh"
text = read(path)
if 'first-run.sh" --config' not in text:
    text = text.rstrip() + "\n\n" + clean("""
    if [[ -x "$BUNDLE_ROOT/first-run.sh" ]]; then
      "$BUNDLE_ROOT/first-run.sh" --config "$CONFIG_FILE"
    else
      info "Web interface: open the configured DOCOMATOR_HOST:DOCOMATOR_PORT address"
    fi
    """) + "\n"
write(path, text)

path = "scripts/offline/smoke-test.sh"
text = read(path)
if "Основное пространство" not in text:
    marker = clean("""
    ((READY == 1)) || {
      cat "$TEST_ROOT/api.log" >&2 || true
      die "Bundled API did not become ready"
    }
    "") + "\n"
    if marker not in text:
        raise SystemExit("smoke-test readiness marker not found")
    smoke = clean("""
    curl --fail --silent --show-error \\
      "http://127.0.0.1:${DOCOMATOR_PORT}/" \\
      | grep -F 'Пространства' >/dev/null
    curl --fail --silent --show-error \\
      "http://127.0.0.1:${DOCOMATOR_PORT}/api/v1/spaces?limit=10" \\
      | grep -F 'Основное пространство' >/dev/null
    "")
    text = text.replace(marker, marker + "\n" + smoke + "\n", 1)
write(path, text)

path = "docs/OFFLINE_DEPLOYMENT.md"
text = read(path)
if "## Guided first run" not in text:
    text = text.rstrip() + "\n\n" + clean("""
    ## Guided first run

    После установки `install.sh` запускает локальный `first-run.sh` и показывает URL интерфейса и безопасный порядок первоначальной настройки:

    ```text
    пространство → тип «Человек» → участники → группа/отметки
    → aggregate или one_per_member → immutable snapshot
    ```

    Помощник не обращается в Интернет и не изменяет бизнес-данные. Повторный запуск:

    ```bash
    ./first-run.sh --config /etc/docomator/docomator.env --check
    ```
    "") + "\n"
write(path, text)
