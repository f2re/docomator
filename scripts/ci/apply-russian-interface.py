#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from textwrap import dedent


ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_required(text: str, old: str, new: str, path: str) -> str:
    if old not in text:
        raise SystemExit(f"Не найден ожидаемый фрагмент в {path}: {old[:100]!r}")
    return text.replace(old, new, 1)


def insert_after(text: str, marker: str, block: str, sentinel: str, path: str) -> str:
    if sentinel in text:
        return text
    if marker not in text:
        raise SystemExit(f"Не найден маркер в {path}: {marker!r}")
    return text.replace(marker, marker + "\n\n" + dedent(block).strip(), 1)


# Веб-интерфейс: единый словарь отображения и русские пользовательские тексты.
path = "apps/api/ui/app.js"
text = read(path)
text = insert_after(
    text,
    'const DEFAULT_SPACE_ID = "00000000-0000-4000-8000-000000000001";',
    r'''
    const displayNames = Object.freeze({
      valueTypes: {
        string: "Короткая строка",
        text: "Длинный текст",
        number: "Число",
        integer: "Целое число",
        boolean: "Да / нет",
        date: "Дата",
        "date-time": "Дата и время",
        enum: "Список вариантов",
        "entity-reference": "Ссылка на объект",
        list: "Список",
        json: "Структурированные данные",
        file: "Файл",
        image: "Изображение"
      },
      sensitivity: {
        public: "Открытые",
        internal: "Внутренние",
        personal: "Персональные",
        restricted: "Ограниченные"
      },
      entityStatus: {
        active: "Активный",
        inactive: "Неактивный",
        archived: "Архивный"
      },
      spaceRole: {
        owner: "Владелец",
        manager: "Руководитель",
        editor: "Редактор",
        viewer: "Наблюдатель"
      },
      membershipStatus: {
        active: "Доступ включён",
        inactive: "Доступ отключён"
      }
    });

    function displayLabel(group, value) {
      return displayNames[group]?.[value] || String(value ?? "Не указано");
    }
    ''',
    "const displayNames = Object.freeze",
    path,
)
replacements = [
    (
        'documents: ["Формирование", "Документы", "Будущий guided flow использует уже готовый снимок аудитории.", null, null],',
        'documents: ["Формирование", "Документы", "Будущий пошаговый процесс использует уже готовый снимок состава.", null, null],',
    ),
    (
        '["Можно сделать один документ на всех?", "Да. Режим «Один общий документ» передаёт шаблону коллекцию audience.members для таблицы или списка."],',
        '["Можно сделать один документ на всех?", "Да. Режим «Один общий документ» передаёт шаблону упорядоченный список участников для таблицы или перечня."],',
    ),
    (
        '["Куда отправляются данные?", "Только на локальный сервер. Интерфейс не использует CDN, внешние шрифты, аналитику или облачные API."]',
        '["Куда отправляются данные?", "Только на локальный сервер. Интерфейс не использует внешние хранилища, шрифты, аналитику или облачные службы."]',
    ),
    (
        '["Что значит «отмеченные»?", "Это разовый выбор чекбоксами. Его можно сразу зафиксировать для документа или сохранить как именованную группу."],',
        '["Что значит «отмеченные»?", "Это разовый выбор флажками. Его можно сразу зафиксировать для документа или сохранить как именованную группу."],',
    ),
    (
        '["Почему общий документ пока не скачивается?", "Backend уже строит точный план и контекст. Запись списка в DOCX/XLSX появится вместе с безопасным Template Compiler."]',
        '["Почему общий документ пока не скачивается?", "Серверная часть уже строит точный план и состав. Запись списка в DOCX/XLSX появится вместе с компилятором шаблонов."]',
    ),
    (
        '["Что означает чувствительность?", "Будущий класс доступа: public, internal, personal или restricted. Проверка IAM будет выполняться до LLM, рендера и доставки."]',
        '["Что означает чувствительность?", "Будущий класс доступа: открытые, внутренние, персональные или ограниченные сведения. Проверка прав будет выполняться до обращения к локальной модели, формирования и доставки."]',
    ),
    (
        '["Как таблица получит людей?", "Повторяющаяся строка будет связана с audience.members. Для каждой записи renderer подставит нужные свойства."],',
        '["Как таблица получит людей?", "Повторяющаяся строка будет связана со списком участников. Для каждой записи модуль формирования подставит нужные свойства."],',
    ),
    (
        '["Почему загрузка ещё закрыта?", "Недоверенный Office-файл нельзя принимать до проверки ZIP, XML, relationships, макросов и лимитов."]',
        '["Почему загрузка ещё закрыта?", "Полученный DOCX/XLSX нельзя принимать до проверки архивной структуры, XML, внешних связей, макросов и ограничений размера."]',
    ),
    (
        '["Как будет выглядеть процесс?", "Пространство → аудитория → режим результата → данные → проверка → рендер → скачивание или доставка."],',
        '["Как будет выглядеть процесс?", "Пространство → состав → форма результата → данные → проверка → формирование → скачивание или доставка."],',
    ),
    (
        '["Можно работать без ИИ?", "Да. Активированный шаблон обязан заполняться обычной формой при недоступной LLM."]',
        '["Можно работать без ИИ?", "Да. Активированный шаблон обязан заполняться обычной формой при недоступной локальной модели."]',
    ),
    (
        'description: "Укажите технический ID пользователя и его роль в текущем пространстве.",',
        'description: "Укажите внутренний идентификатор пользователя и его роль в текущем пространстве.",',
    ),
    (
        '["actorId", "ID пользователя", "text", true, "user-42", "Идентификатор локальной учётной записи. IAM-интерфейс будет добавлен отдельным этапом."],',
        '["actorId", "Идентификатор пользователя", "text", true, "user-42", "Внутренний идентификатор локальной учётной записи. Раздел управления учётными записями будет добавлен отдельным этапом."],',
    ),
    (
        '["role", "Роль", "space-role", true, "", "Owner управляет пространством; manager — составом; editor — данными; viewer — только просмотром."],',
        '["role", "Роль", "space-role", true, "", "Владелец управляет пространством; руководитель — составом; редактор — данными; наблюдатель — только просматривает."],',
    ),
    (
        'return `<article class="collection-card"><header><div><h3>${escapeHtml(item.label)}</h3><code>${escapeHtml(item.key)}</code></div><span class="pill">${escapeHtml(item.valueType)}</span></header><p>${escapeHtml(item.description || "Описание пока не добавлено.")}</p><div class="card-meta"><span class="pill">${escapeHtml(item.sensitivity || "internal")}</span>${item.unit ? `<span class="pill">${escapeHtml(item.unit)}</span>` : ""}</div></article>`;',
        'return `<article class="collection-card"><header><div><h3>${escapeHtml(item.label)}</h3><code>${escapeHtml(item.key)}</code></div><span class="pill">${escapeHtml(displayLabel("valueTypes", item.valueType))}</span></header><p>${escapeHtml(item.description || "Описание пока не добавлено.")}</p><div class="card-meta"><span class="pill">${escapeHtml(displayLabel("sensitivity", item.sensitivity || "internal"))}</span>${item.unit ? `<span class="pill">${escapeHtml(item.unit)}</span>` : ""}</div></article>`;',
    ),
    (
        '<small>${escapeHtml(entity.entityTypeLabel)} · ${escapeHtml(entity.status)}</small>',
        '<small>${escapeHtml(entity.entityTypeLabel)} · ${escapeHtml(displayLabel("entityStatus", entity.status))}</small>',
    ),
    (
        'root.innerHTML = \'<div class="empty-state compact-empty"><div><span class="empty-emoji" aria-hidden="true">🔐</span><h3>Дополнительный доступ не настроен</h3><p>Создатель пространства уже имеет роль owner. Добавьте технический ID другого пользователя при необходимости.</p><button class="primary-button" type="button" data-create="space-access">Добавить доступ</button></div></div>\';',
        'root.innerHTML = \'<div class="empty-state compact-empty"><div><span class="empty-emoji" aria-hidden="true">🔐</span><h3>Дополнительный доступ не настроен</h3><p>Создатель пространства уже имеет роль владельца. При необходимости добавьте внутренний идентификатор другого пользователя.</p><button class="primary-button" type="button" data-create="space-access">Добавить доступ</button></div></div>\';',
    ),
    (
        'root.innerHTML = state.data.access.map((member) => `<article class="access-row"><span class="member-avatar" aria-hidden="true">🔑</span><span><strong>${escapeHtml(member.actorId)}</strong><small>Роль: ${escapeHtml(member.role)} · ${escapeHtml(member.status)}</small></span><span class="pill">v${member.version}</span></article>`).join("");',
        'root.innerHTML = state.data.access.map((member) => `<article class="access-row"><span class="member-avatar" aria-hidden="true">🔑</span><span><strong>${escapeHtml(member.actorId)}</strong><small>Роль: ${escapeHtml(displayLabel("spaceRole", member.role))} · ${escapeHtml(displayLabel("membershipStatus", member.status))}</small></span><span class="pill">Версия ${member.version}</span></article>`).join("");',
    ),
    (
        'root.innerHTML = `<article class="panel plan-card is-success"><div class="plan-icon" aria-hidden="true">${plan.targetMode === "aggregate" ? "📋" : "📄"}</div><div><p class="eyebrow">Состав зафиксирован</p><h2>${escapeHtml(modeLabel(plan.targetMode))}</h2><p>${plan.targetMode === "aggregate" ? `Создаётся одно задание. Шаблон получит <code>${escapeHtml(plan.collectionPath)}</code> с ${snapshot.memberCount} записями.` : `Создаётся ${plan.documentCount} независимых единиц — каждая с собственным subject.`}</p><div class="member-chip-list">${memberNames.slice(0, 12).map((name) => `<span class="pill">${escapeHtml(name)}</span>`).join("")}${memberNames.length > 12 ? `<span class="pill">ещё ${memberNames.length - 12}</span>` : ""}</div><small>Snapshot ID: <code>${escapeHtml(snapshot.id)}</code>. Изменение группы не изменит этот состав.</small></div></article>`;',
        'root.innerHTML = `<article class="panel plan-card is-success"><div class="plan-icon" aria-hidden="true">${plan.targetMode === "aggregate" ? "📋" : "📄"}</div><div><p class="eyebrow">Состав зафиксирован</p><h2>${escapeHtml(modeLabel(plan.targetMode))}</h2><p>${plan.targetMode === "aggregate" ? `Создаётся одно задание. Шаблон получит упорядоченный список из ${snapshot.memberCount} участников.` : `Создаётся ${plan.documentCount} независимых заданий — каждое со своим основным участником.`}</p><div class="member-chip-list">${memberNames.slice(0, 12).map((name) => `<span class="pill">${escapeHtml(name)}</span>`).join("")}${memberNames.length > 12 ? `<span class="pill">ещё ${memberNames.length - 12}</span>` : ""}</div><small>Идентификатор снимка: <code>${escapeHtml(snapshot.id)}</code>. Изменение группы не изменит этот состав.</small></div></article>`;',
    ),
    (
        'if (type === "space-role") return [["viewer", "Viewer — просмотр"], ["editor", "Editor — изменение данных"], ["manager", "Manager — состав и группы"], ["owner", "Owner — полное управление"]];',
        'if (type === "space-role") return [["viewer", "Наблюдатель — просмотр"], ["editor", "Редактор — изменение данных"], ["manager", "Руководитель — состав и группы"], ["owner", "Владелец — полное управление"]];',
    ),
    (
        'notify("✅", definition.success, "Изменение подтверждено сервером и записано в аудит.");',
        'notify("✅", definition.success, "Изменение подтверждено сервером и записано в журнал действий.");',
    ),
    (
        'setStatus("", "⏳", "Сохраняем изменение", "Проверяем границу пространства, значения и аудит. Форма закроется только после подтверждения сервера.");',
        'setStatus("", "⏳", "Сохраняем изменение", "Проверяем границу пространства, значения и запись в журнале. Форма закроется только после подтверждения сервера.");',
    ),
]
for old, new in replacements:
    text = replace_required(text, old, new, path)
text = text.replace("Correlation ID", "Идентификатор операции")
write(path, text)

# Статическая разметка интерфейса.
path = "apps/api/ui/index.html"
text = read(path)
html_replacements = [
    ("Для N выбранных людей создаётся N независимых заданий с собственным `subject`.", "Для каждого выбранного человека создаётся отдельное задание со своим основным участником."),
    ("Создаётся одно задание, а список доступен шаблону как `audience.members` для таблицы или перечня.", "Создаётся одно задание, а шаблон получает упорядоченный список участников для таблицы или перечня."),
    ("<strong>Рендер DOCX/XLSX</strong><p>Подключение списка к повторяющейся таблице реализуется в Template Compiler.</p>", "<strong>Формирование DOCX/XLSX</strong><p>Подключение списка к повторяющейся таблице будет реализовано в компиляторе шаблонов.</p>"),
    ("<small>Выберите рабочий контекст</small>", "<small>Выберите текущую область данных</small>"),
    ("Сам DOCX/XLSX будет создан после подключения Template Compiler.", "Сам DOCX/XLSX будет создан после подключения компилятора шаблонов."),
    ("Таблица или список всех выбранных людей через <code>audience.members</code>.", "Таблица или список всех выбранных людей."),
    ("Это технические пользователи приложения. Роли будут применяться IAM-слоем до публикации сервиса в общей сети.", "Это пользователи приложения. Права будут проверяться модулем управления доступом до публикации службы в общей сети."),
    ("Template Studio свяжет повторяющуюся таблицу или список с коллекцией <code>audience.members</code>. До готовности безопасного OOXML intake файлы не принимаются.", "Студия шаблонов свяжет повторяющуюся таблицу или список с выбранными участниками. До готовности безопасного приёма DOCX/XLSX файлы не принимаются."),
    ("Пошаговый flow покажет пространство, источник участников, точный состав, режим результата, найденные данные, preview и подтверждение.", "Пошаговый процесс покажет пространство, источник участников, точный состав, форму результата, найденные данные, предварительный просмотр и подтверждение."),
    ("Перед рендером создаётся неизменяемый снимок аудитории.", "Перед формированием создаётся неизменяемый снимок состава."),
    ("<span class=\"pill pill-success\">Контракт готов</span>", "<span class=\"pill pill-success\">Логика готова</span>"),
]
for old, new in html_replacements:
    text = replace_required(text, old, new, path)
write(path, text)

# Нормативные требования к языку пользовательского слоя.
path = "docs/REQUIREMENTS.md"
text = read(path)
text = replace_required(text, "Версия: **1.2-draft**", "Версия: **1.3-draft**", path)
text = insert_after(
    text,
    "| UX-024 | До фиксации снимка интерфейс должен объяснять, получится один сводный документ или N индивидуальных документов. | MUST |",
    r'''
    | UX-025 | Все названия, состояния, уведомления, ошибки, подсказки и действия восстановления пользовательского интерфейса должны быть на русском языке. | MUST |
    | UX-026 | Необязательные англицизмы в пользовательском слое запрещены; машинные ключи и стандарты допускаются только при необходимости и сопровождаются русским объяснением. | MUST |
    ''',
    "UX-025",
    path,
)
text = replace_required(
    text,
    "| OFF-011 | После установки offline helper должен показать URL интерфейса и guided flow пространства → участники → аудитория. | MUST |",
    "| OFF-011 | После установки автономный помощник должен показать адрес интерфейса и пошаговый процесс: пространство → участники → аудитория. | MUST |\n| OFF-012 | Помощник первого запуска должен входить в автономный комплект, сохраняться в каталоге установленной версии и запускаться после успешной установки. | MUST |",
    path,
)
text = insert_after(
    text,
    "| NFR-012 | Базовый интерфейс должен оставаться функциональным при системном масштабировании текста до 200%. | SHOULD |",
    "| NFR-013 | Автоматическая проверка проекта должна выявлять запрещённые англицизмы в пользовательских текстах. | MUST |",
    "NFR-013",
    path,
)
text = insert_after(
    text,
    "| AC-019 | Изменение группы после создания snapshot не изменяет его состав или порядок. |",
    "| AC-020 | Обычный пользователь выполняет основной сценарий и получает исправимые ошибки без знания английской терминологии. |",
    "AC-020",
    path,
)
text = insert_after(
    text,
    "- Именованная группа редактируема, но audience snapshot после создания неизменяем.",
    "- Изменение пользовательского текста требует проверки русской терминологии; внутренние машинные ключи не должны просачиваться в обычный интерфейс.",
    "проверки русской терминологии",
    path,
)
write(path, text)

# Архитектурная граница локализации.
path = "docs/ARCHITECTURE.md"
text = read(path)
text = insert_after(
    text,
    "Полный нормативный контракт: [UX_UI_SPECIFICATION.md](UX_UI_SPECIFICATION.md).",
    r'''
    ### 3.2. Язык пользовательского слоя

    Домен и хранилище могут использовать стабильные машинные значения (`aggregate`, `active`, `owner`), но HTTP-адаптер и веб-интерфейс обязаны преобразовать их в русские названия до показа пользователю.

    Правила границы:

    - сервер не возвращает пользователю необработанные сообщения SQLite и внутренних библиотек;
    - машинный код ошибки остаётся стабильным, а поле `message` содержит понятный русский текст;
    - роли, состояния, типы значений и режимы результата отображаются через единый словарь;
    - технический ключ показывается только в административном или диагностическом контексте и сопровождается объяснением;
    - проверка пользовательской терминологии выполняется в составе `npm run check`.
    ''',
    "### 3.2. Язык пользовательского слоя",
    path,
)
write(path, text)

# Инструкции агентам интерфейса.
path = "apps/api/ui/AGENTS.md"
text = read(path)
text = replace_required(text, "- Для каждой сетевой и длительной операции реализуйте понятные `loading`, `success`, `error` и `degraded` состояния.", "- Для каждой сетевой и длительной операции реализуйте понятные состояния загрузки, успеха, ошибки и ограниченной работы.", path)
text = replace_required(text, "- Не используйте безымянный бесконечный spinner или фиктивный процент.", "- Не используйте безымянный бесконечный индикатор ожидания или вымышленный процент.", path)
text = replace_required(text, "- Ошибка отвечает на вопросы: что произошло, сохранены ли данные, что делать дальше, какой correlation ID.", "- Ошибка отвечает на вопросы: что произошло, сохранены ли данные, что делать дальше, какой идентификатор операции.", path)
text = replace_required(text, "- Недоступная функция честно помечается `planned`; не имитируйте готовность.", "- Недоступная функция честно помечается как запланированная; не имитируйте готовность.", path)
text = replace_required(text, "- Поддерживайте keyboard, visible focus, `aria-live`, `aria-busy`, 320 px, dark mode и `prefers-reduced-motion`.", "- Поддерживайте управление клавиатурой, видимый фокус, голосовые объявления, ширину 320 пикселей, тёмную тему и уменьшение анимации.", path)
text = replace_required(text, "- Не добавляйте CDN, внешние шрифты, аналитику или любые runtime-запросы к внешним доменам.", "- Не добавляйте внешние сети доставки содержимого, шрифты, аналитику или запросы к внешним доменам во время работы.", path)
text = insert_after(
    text,
    "- При серверной ошибке форма сохраняет введённые значения.",
    "- Все пользовательские названия, подсказки, состояния и ошибки пишутся по-русски; машинные ключи скрываются либо сопровождаются объяснением.\n- Используйте единый словарь отображения для ролей, состояний, типов значений и режимов результата.\n- Перед завершением изменения запускайте `npm run check:language`.",
    "npm run check:language",
    path,
)
write(path, text)

# Корневые правила разработки.
path = "AGENTS.md"
text = read(path)
text = insert_after(
    text,
    "- Keep runtime UI offline: no CDN, remote fonts, analytics, or external assets.",
    "- User-facing interface, API messages, installation help, notifications, roles, and states are Russian by default.\n- Do not expose raw English library/database errors or unexplained machine values to ordinary users.\n- Run `npm run check:language` for every user-facing change.",
    "npm run check:language",
    path,
)
write(path, text)

# Автономный комплект: включить помощник первого запуска.
path = "scripts/offline/prepare-bundle.sh"
text = read(path)
text = replace_required(text, "Usage: scripts/offline/prepare-bundle.sh [options]", "Использование: scripts/offline/prepare-bundle.sh [параметры]", path)
text = replace_required(text, "Builds a self-contained offline release bundle on a connected reference host.\nThe build host should use the same CPU architecture and a compatible glibc as\nthe target Debian/Astra Linux server.", "Создаёт самодостаточный автономный комплект на подключённом эталонном сервере.\nСервер подготовки должен иметь ту же архитектуру процессора и совместимую glibc,\nчто и целевой сервер Debian/Astra Linux.", path)
text = replace_required(text, "Options:", "Параметры:", path)
text = replace_required(text, "    *) die \"Unknown option: $1\" ;;", "    *) die \"Неизвестный параметр: $1\" ;;", path)
text = replace_required(text, '  *) die "Unsupported target architecture: $TARGET_ARCH" ;;', '  *) die "Неподдерживаемая целевая архитектура: $TARGET_ARCH" ;;', path)
text = replace_required(text, '    "Provide both --llama-server and --model, or explicitly pass --without-llm."', '    "Укажите одновременно --llama-server и --model либо явно используйте --without-llm."', path)
text = replace_required(text, '  [[ -x "$LLAMA_SERVER" || -f "$LLAMA_SERVER" ]] || die "llama-server not found: $LLAMA_SERVER"', '  [[ -x "$LLAMA_SERVER" || -f "$LLAMA_SERVER" ]] || die "Не найден llama-server: $LLAMA_SERVER"', path)
text = replace_required(text, '  [[ -f "$MODEL_FILE" ]] || die "GGUF model not found: $MODEL_FILE"', '  [[ -f "$MODEL_FILE" ]] || die "Не найдена модель GGUF: $MODEL_FILE"', path)
text = replace_required(text, 'info "Installing production-only npm dependencies into the payload"', 'info "Устанавливаем только рабочие зависимости npm в комплект"', path)
text = replace_required(text, '  "$SCRIPT_DIR/restore.sh" \\\n  "$SCRIPT_DIR/healthcheck.mjs" \\', '  "$SCRIPT_DIR/restore.sh" \\\n  "$SCRIPT_DIR/first-run.sh" \\\n  "$SCRIPT_DIR/healthcheck.mjs" \\', path)
text = replace_required(text, 'info "Offline bundle created: $ARCHIVE_PATH"', 'info "Автономный комплект создан: $ARCHIVE_PATH"', path)
write(path, text)

# Установка: сохранить помощник в версии, перевести основные сообщения и запустить его.
path = "scripts/offline/install.sh"
text = read(path)
text = replace_required(text, "Usage: ./install.sh [options]", "Использование: ./install.sh [параметры]", path)
text = replace_required(text, "Installs a verified Docomator offline bundle. This script never accesses the\nnetwork. Run update.sh for an existing installation.", "Устанавливает проверенный автономный комплект Docomator. Сценарий не обращается\nк сети. Для существующей установки используйте update.sh.", path)
text = replace_required(text, "Options:", "Параметры:", path)
text = replace_required(text, '    *) die "Unknown option: $1" ;;', '    *) die "Неизвестный параметр: $1" ;;', path)
text = replace_required(text, '  die "No existing Docomator installation was found at $CURRENT_LINK"', '  die "Не найдена существующая установка Docomator: $CURRENT_LINK"', path)
text = replace_required(text, '  ((${#debs[@]} > 0)) || die "No .deb packages are included in this bundle"', '  ((${#debs[@]} > 0)) || die "В комплекте нет пакетов .deb"', path)
text = replace_required(text, '  info "Installing ${#debs[@]} bundled OS packages"', '  info "Устанавливаем пакеты ОС из комплекта: ${#debs[@]}"', path)
text = replace_required(text, '      info "Model already installed: $destination"', '      info "Модель уже установлена: $destination"', path)
text = replace_required(text, '  info "Pre-update backup created: $BACKUP_DIR"', '  info "Резервная копия перед обновлением создана: $BACKUP_DIR"', path)
text = replace_required(text, '  warn "Rolling back failed installation/update"', '  warn "Возвращаем прежнее состояние после ошибки установки или обновления"', path)
text = replace_required(text, '  cp "$BUNDLE_ROOT/release.json" "$TEMP_RELEASE/"', '  cp "$BUNDLE_ROOT/release.json" "$TEMP_RELEASE/"\n  if [[ -x "$BUNDLE_ROOT/first-run.sh" ]]; then\n    cp "$BUNDLE_ROOT/first-run.sh" "$TEMP_RELEASE/first-run.sh"\n    chmod 0755 "$TEMP_RELEASE/first-run.sh"\n  fi', path)
text = replace_required(text, '    die "Existing release is incomplete: $RELEASE_DIR"', '    die "Существующий каталог версии неполон: $RELEASE_DIR"', path)
text = replace_required(text, '    die "Version $VERSION is already installed with different release metadata. Build a new version."', '    die "Версия $VERSION уже установлена с другими сведениями. Подготовьте новый номер версии."', path)
text = replace_required(text, '  info "Identical release directory already exists: $RELEASE_DIR"', '  info "Такой же каталог версии уже существует: $RELEASE_DIR"', path)
text = replace_required(text, '  die "Database migration failed"', '  die "Не удалось применить изменения базы данных"', path)
text = replace_required(text, '  info "Skipping systemd unit installation and service control"', '  info "Пропускаем установку служб systemd и управление ими"', path)
text = replace_required(text, '    die "systemd is required unless --no-start is used"', '    die "Требуется systemd; для установки без запуска используйте --no-start"', path)
text = replace_required(text, '    die "Services failed to start"', '    die "Не удалось запустить службы Docomator"', path)
text = replace_required(text, '    die "Health check failed after installation"', '    die "Проверка готовности после установки завершилась ошибкой"', path)
text = replace_required(text, 'info "Docomator $VERSION installed successfully"\ninfo "Current release: $(readlink -f "$CURRENT_LINK")"\ninfo "Configuration: $CONFIG_FILE"\ninfo "Persistent data: $DATA_DIR"', 'info "Docomator $VERSION успешно установлен"\ninfo "Текущая версия: $(readlink -f "$CURRENT_LINK")"\ninfo "Файл настроек: $CONFIG_FILE"\ninfo "Постоянные данные: $DATA_DIR"\n\nif [[ -x "$CURRENT_LINK/first-run.sh" ]]; then\n  "$CURRENT_LINK/first-run.sh" --config "$CONFIG_FILE"\nfi', path)
write(path, text)

# Проверка автономной установки должна охватывать интерфейс пространств и помощник.
path = "scripts/offline/smoke-test.sh"
text = read(path)
marker = '((READY == 1)) || {\n  cat "$TEST_ROOT/api.log" >&2 || true\n  die "Bundled API did not become ready"\n}'
addition = r'''

curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/" \
  | grep -F 'Пространства' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/api/v1/spaces?limit=10" \
  | grep -F 'Основное пространство' >/dev/null
"$INSTALL_ROOT/current/first-run.sh" \
  --url "http://127.0.0.1:${DOCOMATOR_PORT}" \
  --check \
  | grep -F 'Первый запуск' >/dev/null
'''
if "Первый запуск" not in text:
    text = insert_after(text, marker, addition, "Основное пространство", path)
text = text.replace("Bundled API did not become ready", "Встроенная служба API не перешла в состояние готовности")
text = text.replace("Running first offline installation", "Выполняем первую автономную установку")
text = text.replace("Running offline update path with the same immutable release", "Проверяем автономное обновление той же неизменяемой версии")
text = text.replace("Offline install/update smoke test passed", "Проверка автономной установки и обновления пройдена")
write(path, text)

# Инструкция автономного развёртывания.
path = "docs/OFFLINE_DEPLOYMENT.md"
text = read(path)
text = insert_after(
    text,
    "## Цель",
    r'''

    ## Помощник первого запуска

    В автономный комплект входит `first-run.sh`. После успешной установки он показывает адрес веб-интерфейса и русскоязычный порядок первоначальной настройки:

    ```text
    пространство → тип «Человек» → участники → группа или отметки
    → один общий документ или документы на каждого → снимок состава
    ```

    Помощник не обращается в Интернет и не изменяет бизнес-данные. Повторный запуск:

    ```bash
    sudo /opt/docomator/current/first-run.sh \
      --config /etc/docomator/docomator.env \
      --check
    ```
    ''',
    "## Помощник первого запуска",
    path,
)
write(path, text)

# Удалить неисполняемые временные артефакты предыдущего этапа.
for obsolete in [
    ".spaces-docs-ready",
    "scripts/ci/apply-spaces-docs.py",
]:
    target = ROOT / obsolete
    if target.exists():
        target.unlink()
