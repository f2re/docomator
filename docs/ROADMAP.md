# План развития продукта «Оформлятор»

Актуально на **2026-08-11**.

Текущий машинный статус выпуска задаётся `RELEASE_IDENTITY.json`: **`0.2.0 / candidate / pilot`**. Версия описывает состав и совместимость продукта, а `candidate/pilot` — степень готовности этого состава. Кодовый baseline кандидата проходит репозиторные проверки, но выпуск **не является stable** до фактической Debian/Astra/Office/recovery/P5-приёмки. Точный порядок оставшихся работ: [NEXT_ITERATIONS.md](NEXT_ITERATIONS.md).

Нормативные источники: [REQUIREMENTS.md](REQUIREMENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [FINALIZATION.md](FINALIZATION.md), [SUPPORT_MATRIX.md](SUPPORT_MATRIX.md), [VERSIONING.md](VERSIONING.md).

## Обозначения

- ✅ — реализовано и покрыто репозиторными проверками;
- 🟡 — кодовый контур реализован, но требуется внешняя/целевая приёмка либо заявленная функциональная граница остаётся ограниченной;
- ⬜ — сознательно отложено до стабилизации основного пути;
- ➖ — исключено действующей архитектурой.

## Состояние этапов

| Этап | Состояние | Факт |
|---|---:|---|
| M0 Автономная поставка | 🟡 | bundle/install/update/rollback/backup tooling реализованы; нет фактических актов Debian/Astra и recovery drill |
| M1 Данные, пространства и аудит | ✅ | SQLite, typed properties, files, queue/events/audit, жёсткая space isolation, migration `0030` |
| M2 Безопасный приём DOCX/XLSX | ✅ | ZIP/XML ограничения, quarantine, Document IR, устойчивые координаты |
| M3 Шаблоны и активация | ✅ | DOCX/XLSX bindings, test render, reverse read, preview, immutable releases |
| M4 Ручной выпуск | ✅ код / 🟡 приёмка | one-per-member/aggregate, partial success, retry failed only, ZIP, recovery после lease |
| M5 Доставка | ✅ код / 🟡 target | network share и SMTP реализованы; реальный target network/SMTP акт ещё отсутствует |
| M6 Расписания | ✅ | one-shot/daily/monthly, timezone, persisted execution, SMTP/network delivery |
| M7 Результаты и операции | ✅ | общий список, состояния, скачивание, удаление, operation center, storage maintenance |
| M8 Общий password gate | ✅ | один общий пароль, scrypt, HttpOnly session, logout; пользователей/ролей/ACL нет |
| M9 Структурные шаблоны | 🟡 | один ограниченный repeat-row/range DOCX/XLSX поддержан; произвольные вложенные структуры не заявлены |
| M10 Импорт и экспорт | ✅ код / 🟡 target | guided CSV/XLSX import, typed errors, CSV/XLSX export; нагрузка 10/100/1000 ждёт внешней приёмки |
| M11 Локальный LLM-помощник | ⬜ | только после стабилизации детерминированного пути; LLM не является обязательным runtime |
| R1 Stable `0.2.0` | 🟡 | кандидат должен пройти новый release-bound внешний контур; stable заблокирован evidence |

## Что уже считается закрытым

### Пространства и данные

- сущность принадлежит ровно одному пространству;
- группы, пользовательские поля, значения, import memory, публикации, шаблоны и связанные данные используют один space context;
- cross-space references отклоняются backend/SQLite независимо от UI;
- чтение и preview не меняют ownership;
- migration `0030_normalize_legacy_shared_properties.sql` физически разделяет исторические shared property definitions на per-space clones;
- старые immutable template/import keys разрешаются только через space-local aliases;
- transitional claim-on-write удалён;
- CI запрещает новые duplicate numeric prefixes миграций.

### CSV/XLSX import/export

- выбор файла и drag-and-drop;
- единая сопровождаемая схема: файл → колонки → сопоставление → preview → исправление → импорт → результат;
- чтение выбранного CSV/XLSX и подготовка колонок запускаются автоматически; явное подтверждение остаётся только у mutation импорта;
- typed row errors из domain/storage: `code`, строка, поле/колонка, исходное значение, severity и repair metadata;
- ошибка подсвечивает место и сохраняет введённые настройки;
- поддержаны сотрудники и произвольные типы объектов;
- повторный импорт использует устойчивый внешний ключ и не создаёт ожидаемых дублей;
- экспорт CSV/XLSX формируется сервером только из выбранного пространства;
- пользовательский экспорт не раскрывает UUID/машинные ключи и нейтрализует spreadsheet formula injection.

### Документы

- детерминированный DOCX/XLSX renderer остаётся единственным production renderer;
- LLM не получает право исполнять shell/SQL/код и не изменяет OOXML напрямую;
- scalar fields, форматтеры и ограниченные repeat-row bindings проверяются reverse-read;
- активированные releases неизменяемы;
- generation поддерживает персональный и сводный режимы, partial success и retry failed only;
- worker использует persisted queue/leases/idempotency, а не память процесса.

### UI/UX

- пользовательское имя продукта — «Оформлятор»; технический namespace `docomator` сохранён для совместимости;
- канонический единый UI без параллельных поколений экранов;
- русская пользовательская терминология;
- безопасные read-only этапы не требуют формального подтверждения: проверка выбранного шаблона, чтение импортируемой таблицы и построение структуры запускаются автоматически, а mutation остаются явными;
- повторная проверка данных перед выпуском не имеет скрытого side effect и не запускает формирование без отдельного действия оператора;
- 320/768/1440 px, keyboard focus, reduced motion, dark/light и 200% zoom входят в автоматические браузерные проверки;
- password gate проходит реальный сценарий `401 → login → workspace → logout → 401`;
- logout доступен и на узком экране через «Настройки»;
- operation center и формы восстанавливают понятное состояние после перезагрузки.

### Offline и release tooling

- generic offline archive собирается и повторно проверяется в CI;
- install/update/rollback/backup/restore и target-acceptance tooling присутствуют;
- release identity имеет один машинный источник и CI проверяет version/status/channel во всех производных местах;
- SemVer bump выполняется штатной командой; product-changing PR без изменения версии блокируется CI;
- текущий статус намеренно `candidate/pilot`;
- stable release evidence работает fail-closed.

## Что блокирует stable

Ни один из следующих пунктов не заменяется CI на Ubuntu runner:

1. чистая offline-установка и полный target act на Debian;
2. отдельная нативная сборка и target act Astra Linux Special Edition 1.7;
3. настоящий LibreOffice на обоих target без `SKIPPED`;
4. минимум 20 реальных DOCX и 20 реальных XLSX с проверкой LibreOffice и Microsoft Office;
5. импорт и выпуск на 10/100/1000 объектах;
6. restart/retry worker без второго результата;
7. заполнение диска, повреждённые объекты и повреждённая backup;
8. восстановление backup на отдельной чистой машине с совпадением SHA-256;
9. update/rollback без потери данных и без сброса password/security configuration;
10. два новых пользователя, ручная accessibility/P5-приёмка;
11. включённая защита `main` и обязательные CI checks;
12. пустой `openBlockers` и успешный `release:evidence` для одного точного candidate commit.

Старый evidence `0.1.0` остаётся историческим и не закрывает эти критерии для `0.2.0`.

Подробный протокол: [FINALIZATION.md](FINALIZATION.md) и [UX_ACCEPTANCE_PROTOCOL.md](UX_ACCEPTANCE_PROTOCOL.md).

## После stable

До завершения перечисленных release blockers крупные новые функции не приоритетны. После стабильного `0.2.0` допускаются отдельными ADR/итерациями:

- более сложные повторяемые и вложенные области DOCX/XLSX;
- изображения, штрихкоды и вычисляемые значения в пределах детерминированного renderer;
- расширенный поиск и групповые действия в результатах;
- более гибкие календарные правила и предметные события;
- локальный LLM-помощник для анализа/сопоставления, остающийся необязательным и без произвольных side effects.
