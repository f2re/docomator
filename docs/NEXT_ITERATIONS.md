# Следующие итерации

Текущая версия: `0.7.3`.

Статус: `candidate / pilot`.

`0.6.4` закрыл пользовательский разрыв доступа: первый запуск задаёт один общий 4-значный код без логина/пароля. `0.6.5` восстановил доступность полей сотрудников в шаблонизаторе. `0.6.6` исправил компоновку Visual Template Studio. `0.6.7` упростил выпуск документов. `0.6.8` сделал persisted результаты строго space-scoped. `0.7.0` убрал default-space knowledge bypass и глобальный `fetch` rewrite. `0.7.1` сделал первичную навигацию канонической при первой отрисовке. `0.7.2` перенёс Home/topbar/«Управление» из позднего DOM-composition слоя в исходную разметку. `0.7.3` переносит автоматический старт CSV/XLSX preview из 900-мс synthetic click в отдельный import controller. Граница shared trusted workspace и ADR-0011 не меняются.

## P1 — завершение UX/UI перед внешней приёмкой

- #153: продолжить Data/employee/import — перенести оставшиеся mapping/repair monkey-patch в канонический import controller, затем привести карточку и toolbar к единому рабочему потоку без потери введённых значений.
- #154: Visual Template Studio — selection-first inspector и progressive disclosure поверх безопасной Document IR.
- #155: Generation → Results — один сквозной flow, без дублирующей истории и snapshot-мастера.
- #156: Schedules — «что → когда → куда», а история запусков и готовые файлы остаются в Results.
- #151/#159: привести оставшийся runtime UI к бренд-токенам и сделать Help контекстным.
- #158: закрепить единую executable acceptance matrix 320/768/1440, 200%, keyboard/screen reader, light/dark и recovery paths.

## P0 — внешняя release-приёмка после UX backlog

- #126: E2E `раздел данных → сотрудники/группа → шаблон → заполненный документ` и cross-space isolation.
- #67: Debian target acceptance.
- #68: Astra Linux target acceptance.
- #69: реальный Office/LibreOffice corpus, 10/100/1000, restart/retry, backup/restore, update/rollback.
- #70: P5 и финальный release evidence.
- #81: ruleset `main` с обязательным source gate `Essential checks`.
- #33: закрывается только после завершения перечисленных доказательств для одного точного release binding.

## Ограничение объёма разработки

Новые продуктовые функции не добавляются вне дефектов, выявленных реальным UX/target/Office/P5-потоком. Такой дефект исправляется по первопричине и получает regression coverage; сквозной сценарий является частью доказательства исправления, а не отдельным расширением продукта.

Applied migrations не переписываются, граница shared trusted workspace не меняется, микросервисы/облачные зависимости/новый frontend framework не вводятся.
