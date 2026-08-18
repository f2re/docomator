# Матрица целевой совместимости

Статус выпуска: `candidate`

Канал выпуска: `pilot`

Статус: **кандидатные строки зафиксированы; целевые акты ещё не получены**

Текущая версия: `0.6.0`.

Дата: **2026-08-18**

Эта матрица относится к `SYS-002—003`, `DOC-006—007`, `OFF-001—005`, `OFF-009—010`, `OFF-013`, `SEC-008`, `UX-015—022` и `NFR-011—012`. Состояние `проверено` разрешено только при наличии сохранённого акта конкретной машины. Автоматические проверки на машине разработчика и generic CI не заменяют целевой акт.

## Кандидатные платформы

| Идентификатор | ОС и архитектура | Node.js | LibreOffice | Состояние | Что отсутствует |
|---|---|---|---|---|---|
| `debian-x86_64-pending` | Debian GNU/Linux, x86-64; точный выпуск и glibc записываются при сборке варианта | `24.18.0` из bundle | точная версия Writer/Calc из согласованного замкнутого набора `.deb` | не проверено | SHA bundle, выпуск ОС, glibc, версия LibreOffice, дата и SHA акта |
| `astra-1.7-x86_64-pending` | Astra Linux Special Edition 1.7, x86-64; update и glibc записываются при сборке варианта | `24.18.0` из bundle | точная совместимая версия Writer/Calc для выбранного update | не проверено | update Astra, SHA bundle, glibc, версия LibreOffice, дата и SHA акта |

Иные ОС, архитектуры и версии Office не считаются поддержанными без отдельной строки и отдельного акта. Microsoft Office не входит в серверный runtime; открытие результатов в нём относится к дополнительной проверке совместимости и пока имеет состояние `не проверено`.

## Поддерживаемые входные форматы

- шаблоны и выпуск: `.docx` и `.xlsx`;
- импорт данных: CSV и XLSX;
- бинарный Excel 97–2003 `.xls` **не является поддерживаемым форматом**: интерфейс должен предложить сохранить файл как XLSX или CSV;
- DOCX/XLSX могут содержать дополнительные Office-конструкции, которые deterministic renderer сохраняет как нетронутые package parts, но браузерная проекция не обязана воспроизводить пиксельно.

## Визуальная разметка 0.6.0

В generic CI проверяется derived Visual IR и браузерная проекция, но это не является Office-сертификацией. Проверяемый кодовый контракт включает:

### DOCX

- основной текст, верхние/нижние колонтитулы, сноски и концевые сноски;
- наследование paragraph/character styles;
- bold/italic/underline/strike, цвет, highlight, font family/size, super/subscript, caps/small caps;
- выравнивание, абзацные отступы/интервалы и размеры/поля страницы;
- обычные таблицы, ширины колонок, `gridSpan`, `vMerge`, заливка/границы/vertical alignment;
- локальные raster media PNG/JPEG/GIF/WebP из разрешённых OOXML relationships;
- direct text selection → прежние `elementId + UTF-16 offsets`.

### XLSX

- листы, размеры строк/столбцов, merges;
- font/fill/border/alignment/wrap;
- распространённые числовые, процентные, дата/время display formats;
- печатные header/footer;
- raster DrawingML images с привязкой к anchor cell;
- формулы показываются с сохранённым cached value, но не могут быть назначены как поля;
- обычная ячейка связывается по прежнему server-validated cell address.

### Что не заявляется как точное браузерное соответствие

- Word pagination, плавающие shapes/text boxes, сложный DrawingML/SmartArt, charts, OLE/embedded objects;
- сложные theme/tint/color transforms и все варианты условного форматирования Excel;
- точная печатная раскладка Excel, page breaks и формульный пересчёт;
- пиксельная идентичность Microsoft Office или LibreOffice.

Эти конструкции не должны повреждаться deterministic renderer. Их окончательный вид подтверждается пробной копией/PDF и реальным Office-корпусом.

## Обязательное содержимое целевого акта

Для перевода строки в `проверено` фиксируются:

- точное название/update ОС, `uname -m`, glibc;
- SHA-256 автономного архива и Git commit из `release.json`;
- встроенный Node.js, target profile, dependency closure и manifest;
- Chromium/Playwright/axe inventory;
- совпавшая release identity работающего API;
- версия LibreOffice Writer/Calc;
- физически отсутствующий сетевой маршрут во время offline-установки;
- успешные `verify-bundle.sh`, root `smoke-test.sh`, `target-release-gate.sh` без обязательных `SKIPPED`;
- открытие/PDF/обратное чтение зафиксированных DOCX/XLSX-примеров;
- проверка `/gost` без cookie и `401` для сохраняемых API без cookie;
- backup, update/rollback и отдельное восстановление;
- ручная UX-приёмка, включая rich DOCX/XLSX Template Studio и отсутствие глобального overflow.

Для статуса `stable` дополнительно требуется реальный Office-корпус, recovery evidence, P5 и пустой реестр блокеров. До этого `RELEASE_IDENTITY.json` обязан оставаться `status=candidate`, `channel=pilot`.

Свидетельства `0.1.0`—`0.5.0` остаются историческими и не закрывают матрицу `0.6.0`: каждый акт обязан совпадать с текущими version/status/channel, commit и SHA-256 release metadata.

## Учебные и regression-примеры

`examples/` остаётся синтетическим офлайн-набором для детерминированных проверок. Для Visual Template Studio дополнительно используются минимальные in-memory OOXML fixtures: Word fixture проверяет styles/page/table/header/raster image, Excel fixture — grid geometry/merge/font/fill/border/format/header-footer/drawing anchor. Chromium дополнительно проверяет computed styles, selection binding, 320 px и фактические screenshots. Эти материалы — regression evidence кода, а не замена реальных документов заказчика.

## Финальная фиксация

После заполнения строк целевые папки вместе с P5, актом восстановления, Office-корпусом и пустым реестром блокеров обязаны пройти `scripts/ci/release-evidence-gate.mjs`. Само наличие файлов без совпавших SHA-256, версии и commit не переводит платформу в состояние `проверено`.
