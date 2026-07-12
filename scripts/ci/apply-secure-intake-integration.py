#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from textwrap import dedent

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, text: str) -> None:
    (ROOT / relative).write_text(text, encoding="utf-8")


def clean(value: str) -> str:
    return dedent(value).strip("\n")


def replace_once(relative: str, old: str, new: str, sentinel: str | None = None) -> None:
    text = read(relative)
    if sentinel is not None and sentinel in text:
        return
    if old not in text:
        raise SystemExit(f"Не найден ожидаемый фрагмент в {relative}: {old[:80]!r}")
    write(relative, text.replace(old, new, 1))


def insert_before(relative: str, marker: str, block: str, sentinel: str) -> None:
    text = read(relative)
    if sentinel in text:
        return
    if marker not in text:
        raise SystemExit(f"Не найден маркер в {relative}: {marker!r}")
    write(relative, text.replace(marker, clean(block) + "\n\n" + marker, 1))


# Веб-интерфейс: подключить модуль и заменить заглушку рабочего раздела.
replace_once(
    "apps/api/ui/index.html",
    '    <script type="module" src="/ui/app.js"></script>',
    '    <script type="module" src="/ui/app.js"></script>\n    <script type="module" src="/ui/document-intake.js"></script>',
    '/ui/document-intake.js',
)
replace_once(
    "apps/api/ui/index.html",
    '<span aria-hidden="true">📄</span><span>Шаблоны</span><span class="nav-badge">Скоро</span>',
    '<span aria-hidden="true">📄</span><span>Шаблоны</span><span class="nav-badge">Проверка</span>',
    '<span aria-hidden="true">📄</span><span>Шаблоны</span><span class="nav-badge">Проверка</span>',
)

index_path = "apps/api/ui/index.html"
index = read(index_path)
start_marker = '        <section class="view" data-view="templates" aria-labelledby="templates-heading">'
end_marker = '        <section class="view" data-view="documents" aria-labelledby="documents-heading">'
if 'id="documentIntakeDropZone"' not in index:
    start = index.index(start_marker)
    end = index.index(end_marker, start)
    replacement = clean(r'''
        <section class="view" data-view="templates" aria-labelledby="templates-heading">
          <div class="section-intro">
            <div>
              <p class="eyebrow">Безопасный приём</p>
              <h2 id="templates-heading">Проверка DOCX и XLSX</h2>
              <p>До сохранения шаблона система проверяет архивную структуру, размеры, пути, макросы и внешние связи. Файл не запускается и на этом этапе не добавляется в каталог.</p>
            </div>
            <span class="pill pill-accent">Этап M2 · работает</span>
          </div>

          <div class="intake-layout">
            <article class="panel intake-panel">
              <div class="panel-heading">
                <div>
                  <p class="eyebrow">Шаг 1 из 2</p>
                  <h2>Выберите документ</h2>
                  <p>Поддерживаются DOCX и XLSX размером до 32 МБ. Проверка выполняется только локальным сервером.</p>
                </div>
                <span class="large-emoji" aria-hidden="true">🛡️</span>
              </div>

              <div class="intake-drop-zone" id="documentIntakeDropZone">
                <input
                  id="documentIntakeFile"
                  type="file"
                  accept=".docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                />
                <label for="documentIntakeFile">
                  <span aria-hidden="true">📥</span>
                  <strong>Перетащите файл сюда или выберите его</strong>
                  <small>Файл будет передан только локальной службе Docomator. На этом этапе он не сохраняется как шаблон.</small>
                </label>
              </div>

              <div class="intake-selected-file" id="documentIntakeSelected" hidden></div>
              <div class="intake-actions">
                <button class="primary-button" id="documentIntakeButton" type="button" disabled>Проверить документ</button>
                <button class="quiet-button" id="documentIntakeClear" type="button" hidden>Выбрать другой файл</button>
              </div>

              <ul class="intake-limits" aria-label="Что проверяет система">
                <li><span aria-hidden="true">✓</span><span>Количество и суммарный размер частей пакета.</span></li>
                <li><span aria-hidden="true">✓</span><span>Опасные пути, шифрование, символические ссылки и подозрительное сжатие.</span></li>
                <li><span aria-hidden="true">✓</span><span>Макросы, ActiveX, встроенные объекты, подписи и внешние связи.</span></li>
              </ul>
            </article>

            <article class="panel intake-result-panel">
              <div class="intake-status is-idle" id="documentIntakeStatus" role="status" aria-live="polite" aria-busy="false">
                <span class="intake-status-mark" id="documentIntakeStatusIcon" aria-hidden="true">1</span>
                <div>
                  <strong id="documentIntakeStatusTitle">Выберите документ</strong>
                  <p id="documentIntakeStatusDetail">После выбора система объяснит следующий шаг и не сохранит файл без отдельного подтверждения.</p>
                </div>
              </div>
              <div id="documentIntakeResult" aria-live="polite">
                <div class="intake-placeholder">
                  <span aria-hidden="true">🔎</span>
                  <h3>Отчёт появится после проверки</h3>
                  <p>Вы увидите найденные ограничения, предупреждения и безопасный следующий шаг.</p>
                </div>
              </div>
            </article>
          </div>
        </section>
    ''')
    index = index[:start] + replacement + "\n\n" + index[end:]
    write(index_path, index)

replace_once(
    "apps/api/ui/app.js",
    '  templates: ["Подготовка документов", "Шаблоны", "Повторяющиеся таблицы и списки подключаются следующим этапом.", null, null],',
    '  templates: ["Безопасный приём", "Проверка шаблона", "Проверяем структуру DOCX/XLSX до сохранения и объясняем безопасный следующий шаг.", null, null],',
    '"Проверка шаблона"',
)
app_path = "apps/api/ui/app.js"
app = read(app_path)
help_start = app.index("  templates: [", app.index("const help = {"))
help_end = app.index("  documents: [", help_start)
if "Что именно проверяет система?" not in app[help_start:help_end]:
    help_block = clean(r'''
      templates: [
        ["Что именно проверяет система?", "Размеры и число частей, опасные пути, подозрительное сжатие, макросы, ActiveX, встроенные объекты, цифровые подписи и внешние связи."],
        ["Сохраняется ли выбранный файл?", "Нет. Текущий этап только проверяет структуру в памяти. Сохранение версии шаблона появится после построения структурного представления документа."],
        ["Что означает «принят с замечаниями»?", "Файл не содержит блокирующих особенностей, но результат будущего формирования потребует пробной проверки."],
        ["Почему файл может быть отклонён?", "Система отклоняет повреждённые архивы, небезопасные пути, шифрованные части, макросы и превышение защитных ограничений."]
      ],
    ''')
    app = app[:help_start] + help_block + "\n" + app[help_end:]
    write(app_path, app)

# Постоянные проверки интерфейса и терминологии.
replace_once(
    "package.json",
    '    "check:ui": "node --check apps/api/ui/app.js",',
    '    "check:ui": "node --check apps/api/ui/app.js && node --check apps/api/ui/document-intake.js",',
    'node --check apps/api/ui/document-intake.js',
)
replace_once(
    "scripts/ci/check-user-facing-language.mjs",
    '  "apps/api/ui/app.js",',
    '  "apps/api/ui/app.js",\n  "apps/api/ui/document-intake.js",',
    '"apps/api/ui/document-intake.js"',
)

# Автономный комплект: новый модуль и проверка локальных файлов интерфейса.
replace_once(
    "scripts/offline/prepare-bundle.sh",
    '  "$BUNDLE_DIR/payload/app/packages/storage" \\\n',
    '  "$BUNDLE_DIR/payload/app/packages/storage" \\\n  "$BUNDLE_DIR/payload/app/packages/document-intake" \\\n',
    'payload/app/packages/document-intake',
)
replace_once(
    "scripts/offline/prepare-bundle.sh",
    'for workspace in apps/api apps/worker packages/config packages/contracts packages/storage; do',
    'for workspace in apps/api apps/worker packages/config packages/contracts packages/storage packages/document-intake; do',
    'packages/storage packages/document-intake',
)
replace_once(
    "scripts/offline/smoke-test.sh",
    '''curl --fail --silent --show-error \\
  "http://127.0.0.1:${DOCOMATOR_PORT}/api/v1/spaces?limit=10" \\
  | grep -F 'Основное пространство' >/dev/null
''',
    '''curl --fail --silent --show-error \\
  "http://127.0.0.1:${DOCOMATOR_PORT}/api/v1/spaces?limit=10" \\
  | grep -F 'Основное пространство' >/dev/null
curl --fail --silent --show-error \\
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/document-intake.js" \\
  | grep -F 'Проверяем архивную структуру' >/dev/null
curl --fail --silent --show-error \\
  "http://127.0.0.1:${DOCOMATOR_PORT}/" \\
  | grep -F 'Проверить документ' >/dev/null
''',
    '/ui/document-intake.js',
)

# README: фактический статус и рабочий пользовательский сценарий.
replace_once(
    "README.md",
    "**Текущее состояние:** пространства, аудитории и русский пользовательский слой готовы; следующий крупный этап — безопасный приём DOCX/XLSX и построение структурного представления документа.  ",
    "**Текущее состояние:** пространства, аудитории и русский пользовательский слой готовы; базовая безопасная проверка DOCX/XLSX уже работает, далее строится структурное представление документа.  ",
    "базовая безопасная проверка DOCX/XLSX уже работает",
)
replace_once(
    "README.md",
    "| Безопасный приём DOCX/XLSX | ⬜ | следующий этап |",
    "| Безопасный приём DOCX/XLSX | 🟡 | проверка архива, ограничений, макросов и внешних связей; структурное представление ещё впереди |",
    "| Безопасный приём DOCX/XLSX | 🟡 |",
)
insert_before(
    "README.md",
    "## ✨ Интерфейс без догадок",
    r'''
    ## 🛡️ Проверка DOCX/XLSX

    В разделе **«Шаблоны»** уже можно выбрать DOCX или XLSX и получить локальный отчёт до сохранения файла. Проверяются:

    - архивная сигнатура и обязательные части Office Open XML;
    - размер файла, число частей и суммарный распакованный объём;
    - выход путей из пакета, дубликаты, шифрование и символические ссылки;
    - подозрительно высокая степень сжатия;
    - макросы, ActiveX, встроенные объекты и цифровые подписи;
    - внешние связи, которые система никогда не загружает автоматически.

    Результат имеет понятное состояние: **структура прошла проверку**, **принято с замечаниями** или **файл нельзя использовать**. На этом этапе документ анализируется в памяти и не становится активным шаблоном.

    Технический контракт: [безопасный приём DOCX/XLSX](docs/DOCUMENT_INTAKE.md).
    ''',
    "## 🛡️ Проверка DOCX/XLSX",
)

# План развития: отметить реально завершённые части M2.
replace_once(
    "docs/ROADMAP.md",
    "| M2 Безопасный приём DOCX/XLSX | ⬜ | загрузка, защитные проверки и структурное представление документа |",
    "| M2 Безопасный приём DOCX/XLSX | 🟡 | защитная проверка и отчёт совместимости работают; структурное представление в разработке |",
    "| M2 Безопасный приём DOCX/XLSX | 🟡 |",
)
insert_before(
    "docs/ROADMAP.md",
    "## Следующий приоритет",
    r'''
    ## M2 — безопасный приём DOCX/XLSX

    - [x] отдельный модуль `@docomator/document-intake`;
    - [x] проверка расширения, имени и сигнатуры ZIP;
    - [x] ограничения исходного и распакованного размера;
    - [x] ограничение числа частей и размера отдельной части;
    - [x] запрет опасных путей, шифрования и символических ссылок;
    - [x] обнаружение дубликатов и неоднозначных имён частей;
    - [x] обнаружение макросов, ActiveX, вложений, подписей и внешних связей;
    - [x] русскоязычный отчёт совместимости;
    - [x] прикладной интерфейс первичной проверки;
    - [x] рабочий экран выбора, проверки и отображения замечаний;
    - [x] отрицательные тесты архивной структуры;
    - [x] включение модуля и интерфейса в автономный комплект;
    - [ ] потоковая проверка фактического содержимого всех частей и контроль целостности;
    - [ ] карантин и неизменяемое сохранение принятого исходного файла;
    - [ ] структурное представление DOCX;
    - [ ] структурное представление XLSX;
    - [ ] устойчивые идентификаторы элементов и ручное выделение поля.
    ''',
    "## M2 — безопасный приём DOCX/XLSX",
)
replace_once(
    "docs/ROADMAP.md",
    "Следующий этап — M2 без участия локальной модели:",
    "Продолжение M2 выполняется без участия локальной модели:",
    "Продолжение M2 выполняется без участия локальной модели:",
)

# План реализации: разделить готовый базовый объём и оставшиеся работы.
plan_path = "docs/IMPLEMENTATION_PLAN.md"
plan = read(plan_path)
plan_start = plan.index("## M2. Безопасный приём DOCX/XLSX и структурное представление")
plan_end = plan.index("## M3. Компилятор шаблонов", plan_start)
if "### Выполненный базовый объём" not in plan[plan_start:plan_end]:
    plan_section = clean(r'''
    ## M2. Безопасный приём DOCX/XLSX и структурное представление — 🟡 выполняется

    **Требования:** TPL-001—004, TPL-014—015, SEC-002—003, SEC-009, SEC-012.

    ### Выполненный базовый объём

    1. отдельный модуль безопасного чтения ZIP без распаковки в пользовательские каталоги;
    2. ограничения размера файла, числа частей, отдельной части и суммарного объёма;
    3. запрет выхода пути, шифрования, символических ссылок, дубликатов и неоднозначных имён;
    4. обнаружение макросов, ActiveX, вложенных объектов, подписей и внешних связей;
    5. проверка обязательных частей DOCX/XLSX;
    6. русскоязычный отчёт с состояниями «прошёл», «с замечаниями», «отклонён»;
    7. прикладной интерфейс проверки двоичного файла;
    8. сопровождающий экран выбора файла и просмотра результата;
    9. модульные, отрицательные и интеграционные проверки;
    10. включение рабочего модуля в автономную поставку.

    ### Оставшиеся работы M2

    1. потоковая проверка фактических данных каждой части и контроль целостности;
    2. карантин и неизменяемое хранение принятого исходного документа;
    3. структурное представление DOCX: части, абзацы, фрагменты, таблицы и колонтитулы;
    4. структурное представление XLSX: книга, листы, ячейки, таблицы и именованные диапазоны;
    5. устойчивые идентификаторы элементов;
    6. структурный предварительный просмотр;
    7. прикладной интерфейс ручного выделения изменяемого поля.

    Критерий завершения M2: пользователь загружает файл, видит понятный отчёт, безопасно сохраняет принятую исходную версию и вручную отмечает поле по проверяемой структурной координате.
    ''')
    plan = plan[:plan_start] + plan_section + "\n\n" + plan[plan_end:]
    write(plan_path, plan)

# Нормативные требования и критерий приёмки базового приёма.
replace_once(
    "docs/REQUIREMENTS.md",
    "| TPL-013 | Система должна формировать compatibility report для макросов, подписей, OLE, ActiveX, внешних связей и сложных объектов. | MUST |",
    "| TPL-013 | Система должна формировать compatibility report для макросов, подписей, OLE, ActiveX, внешних связей и сложных объектов. | MUST |\n| TPL-014 | Первичная проверка не должна распаковывать файл в пользовательский каталог, активировать шаблон или выполнять его содержимое. | MUST |\n| TPL-015 | Отчёт первичной проверки должен различать допустимый файл, допустимый файл с замечаниями и отклонённый файл и объяснять следующий шаг по-русски. | MUST |",
    "| TPL-014 |",
)
replace_once(
    "docs/REQUIREMENTS.md",
    "| SEC-011 | Cross-space ID должен проверяться до чтения чувствительных полей, вызова LLM, рендера и доставки. | MUST |",
    "| SEC-011 | Cross-space ID должен проверяться до чтения чувствительных полей, вызова LLM, рендера и доставки. | MUST |\n| SEC-012 | Чтение ZIP должно быть потоковым или ограниченным, проверять фактический объём данных и не доверять только метаданным центрального каталога. | MUST |",
    "| SEC-012 |",
)
replace_once(
    "docs/REQUIREMENTS.md",
    "| AC-020 | Обычный пользователь выполняет основной сценарий и получает исправимые ошибки без знания английской терминологии. |",
    "| AC-020 | Обычный пользователь выполняет основной сценарий и получает исправимые ошибки без знания английской терминологии. |\n| AC-021 | Пользователь выбирает корректный DOCX/XLSX, получает русскоязычный отчёт ограничений, а макросный, повреждённый или небезопасный пакет отклоняется без сохранения и выполнения. |",
    "| AC-021 |",
)

# Основное ТЗ и архитектура: зафиксировать текущую границу реализации.
insert_before(
    "docs/TECHNICAL_SPECIFICATION.md",
    "## 6. Интерфейс и сопровождение пользователя",
    r'''
    ### 5.7. Безопасный приём DOCX/XLSX

    Базовый этап приёма реализован как отдельная детерминированная проверка до сохранения шаблона. Система ограничивает размер и число частей пакета, запрещает опасные пути, шифрование и символические ссылки, обнаруживает макросы и внешние связи и выдаёт русскоязычный отчёт.

    На текущем этапе файл:

    - читается только в памяти локальной службы;
    - не запускается и не передаётся локальной модели;
    - не распаковывается в пользовательские каталоги;
    - не становится активным шаблоном;
    - не сохраняется без отдельного последующего действия.

    До полного завершения M2 остаются карантинное хранение исходника, потоковая проверка всех фактических данных и построение структурного представления DOCX/XLSX.
    ''',
    "### 5.7. Безопасный приём DOCX/XLSX",
)
insert_before(
    "docs/ARCHITECTURE.md",
    "## 6. Рендер DOCX",
    r'''
    ### 5.1. Шлюз первичной проверки

    `@docomator/document-intake` является детерминированным шлюзом до хранилища шаблонов. Он принимает буфер только от локального API, проверяет защитные ограничения и возвращает отчёт без побочных действий.

    ```text
    двоичный DOCX/XLSX
            ↓
    имя, расширение и сигнатура ZIP
            ↓
    центральный каталог и ограничения частей
            ↓
    обязательные части + опасные возможности
            ↓
    принято / принято с замечаниями / отклонено
    ```

    Принятый на этом шаге файл ещё не является шаблоном. Сохранение в карантин, построение Document IR и активация выполняются отдельными явными переходами будущего процесса.
    ''',
    "### 5.1. Шлюз первичной проверки",
)

# Инструкция автономной поставки и ссылка на новый модуль.
insert_before(
    "docs/OFFLINE_DEPLOYMENT.md",
    "## 3. Подготовка OS packages",
    r'''
    ## 2.1. Проверка модуля приёма документов

    Автономный комплект содержит рабочую область `packages/document-intake`, веб-модуль проверки и все его зависимости. После установки локальная проверка подтверждает доступность экрана «Шаблоны» и файла `/ui/document-intake.js` без обращения к внешним ресурсам.
    ''',
    "## 2.1. Проверка модуля приёма документов",
)
