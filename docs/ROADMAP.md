# Roadmap завершения Оформлятора

Текущая версия: `0.7.0`.

Статус: `candidate / pilot`.

## Реализованный продуктовый контур

Кодовая часть основного пользовательского сценария включает пространства и данные, CSV/XLSX import с preview/repair, библиотеку шаблонов, deterministic DOCX/XLSX bindings и renderer, Visual Template Studio, публикации/доставку, persisted worker/schedules, backup/update/rollback, offline tooling, Project Control wrapper и публичный stateless `/gost`.

В `0.6.3` введён единый 4-значный код доступа без username/account/roles, в `0.6.4` завершён пользовательский PIN-flow, а в `0.6.5` восстановлен полный space-scoped поток пользовательских полей через шаблонизатор и генерацию.

`0.7.0` добавляет повторяемые типизированные коллекции сущностей: карточка сотрудника/студента хранит таблицы переменной длины с атомарным сохранением, paste и CSV/XLSX import/export. Для персонального DOCX одна строка таблицы может повторяться по коллекции владельца с `@row_number`, сохраняя обычные scalar-поля вне repeat-зоны. Схема коллекции замораживается в активированной версии шаблона, worker формирует фактическое число строк, а пустая коллекция не оставляет sample row. Граница пространств защищена domain/storage/API и SQL constraints/triggers. Security boundary ADR-0011 не изменена.

Поддержка `0.7.0` намеренно ограничена одной entity-collection repeat-зоной и одним уровнем вложенности в персональном DOCX. Nested entity-collection repeat для XLSX остаётся продолжением #131/#128 и не заявляется в `0.7.0`; существующий `audience.members` repeat DOCX/XLSX остаётся без изменения.

## Что осталось до stable

Оставшаяся работа — release acceptance одного точного candidate commit и закрытие обнаруженных регрессий:

1. полный зелёный repository/Chromium/real-stack/offline CI exact `0.7.0`;
2. сквозной acceptance `пространство → сотрудники/группа → пользовательские поля → коллекции → шаблон → заполненный документ`, включая двух владельцев с разным числом строк, reorder, пустую коллекцию и изоляцию второго пространства;
3. чистая offline-установка и target act Debian x86-64;
4. чистая offline-установка и target act Astra Linux 1.7 x86-64;
5. первый запуск, legacy `/login` redirect, lock/reset/reboot/update/rollback/restore 4-значного кода без username/password browser challenge;
6. реальный LibreOffice и корпус минимум 20 DOCX + 20 XLSX, включая visual projection, renderer preservation и фактически заявленные repeat-конструкции;
7. import/generation 10/100/1000, restart/retry и partial SMTP/network-share failures;
8. отдельный backup/restore на чистой машине без потери данных или duplicate result, включая entity collections;
9. ручная P5/accessibility-приёмка двумя новыми пользователями: 320/768/1440, 200%, keyboard/screen reader, light/dark;
10. `main` ruleset/required checks, пустой `blockers.json` и успешный release-evidence gate одного exact version/commit/status/channel.

До выполнения этих пунктов статус остаётся `candidate / pilot`. Зелёный CI и synthetic fixtures обязательны, но не заменяют target/Office/recovery/P5 evidence. Каждая следующая новая SemVer после успешного merge и post-merge CI получает отдельный проверенный GitHub Release по `docs/VERSIONING.md`.
