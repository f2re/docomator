# Roadmap завершения Оформлятора

Текущая версия: `0.7.2`.

Статус: `candidate / pilot`.

## Реализованный продуктовый контур

Кодовая часть основного пользовательского сценария включает пространства и данные, CSV/XLSX import с preview/repair, библиотеку шаблонов, deterministic DOCX/XLSX bindings и renderer, Visual Template Studio, публикации/доставку, persisted worker/schedules, backup/update/rollback, offline tooling, Project Control wrapper и публичный stateless `/gost`.

В `0.6.3` устранён отдельный password/login-контур и введён единый 4-значный код доступа без username/account/roles. В `0.6.4` завершён пользовательский PIN-flow. В `0.6.5` восстановлена доступность пользовательских полей в шаблонизаторе. В `0.6.6` исправлена компоновка Visual Template Studio. В `0.6.7` упрощён выпуск документов. В `0.6.8` persisted результаты стали строго space-scoped. В `0.7.0` устранён legacy/global knowledge bypass. В `0.7.1` primary navigation стала канонической при первой отрисовке. В `0.7.2` Home, topbar и «Управление» также перенесены из позднего DOM-composition слоя в исходную разметку; `interface-hierarchy.js` оставлен только для синхронизации состояния, а эксплуатационная диагностика стала вторичным уровнем «Управления». Security boundary ADR-0011 не изменена.

## Незавершённый UX/UI backlog перед финальной приёмкой

Новый дизайн завершается без смены frontend framework и без расширения продуктовой модели:

1. Data/employee/import: единый toolbar, сохранение введённых значений, устранение delayed synthetic clicks и глобальных monkey-patch функций;
2. Visual Template Studio: selection-first inspector и progressive disclosure поверх существующей безопасной Document IR;
3. Generation → Results: один пользовательский flow, без конкурирующего snapshot-мастера в «Разделах»;
4. Schedules: человеко-ориентированная последовательность «что → когда → куда» и явный переход к результатам;
5. visual system/help: убрать оставшиеся декоративные gradient/backdrop anti-patterns, сделать Help контекстным, усилить статические regression checks;
6. acceptance matrix: 320/768/1440, 200%, keyboard/screen reader, light/dark, длинные значения, реальные ошибки и восстановление состояния.

## Что осталось до stable

После завершения UX/UI backlog остаётся release acceptance одного точного candidate commit:

1. `npm run check:release` и применимые Chromium/real-stack checks exact candidate SHA; GitHub Actions при этом остаётся только read-only `Essential checks`;
2. сквозной acceptance `раздел данных → сотрудники/группа → пользовательские поля → шаблон → заполненный документ`, включая отрицательную изоляцию второго раздела и результатов;
3. чистая offline-установка и target act Debian x86-64;
4. чистая offline-установка и target act Astra Linux 1.7 x86-64;
5. первый запуск, legacy `/login` redirect, lock/reset/reboot/update/rollback/restore 4-значного кода без username/password browser challenge;
6. реальный LibreOffice и корпус минимум 20 DOCX + 20 XLSX, включая visual projection и renderer preservation;
7. import/generation 10/100/1000, restart/retry и partial SMTP/network-share failures;
8. отдельный backup/restore на чистой машине без потери данных или duplicate result;
9. ручная P5/accessibility-приёмка двумя новыми пользователями: 320/768/1440, 200%, keyboard/screen reader, light/dark;
10. `main` ruleset с единственным required source gate `Essential checks`, пустой `blockers.json` и успешный release-evidence gate exact version/commit/status/channel.

До выполнения этих пунктов статус остаётся `candidate / pilot`. Быстрый зелёный CI обязателен для разработки, но не заменяет browser/target/Office/recovery/P5 evidence перед выпуском.
