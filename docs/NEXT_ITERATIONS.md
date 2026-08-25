# Следующие итерации

Текущая версия: `0.7.0`.

Статус: `candidate / pilot`.

`0.6.4` закрыл пользовательский разрыв доступа, `0.6.5` восстановил полный space-scoped шаблонный flow, а candidate `0.7.0` добавляет повторяемые таблицы/списки сущности и персональный DOCX collection-repeat с автоматической нумерацией. Граница shared trusted workspace и ADR-0011 не меняются.

## P0 — доказать candidate `0.7.0`

- #128/#129—#132: завершить интеграцию entity collections в `main` и подтвердить полный real-stack сценарий двух владельцев с разным числом строк, reorder, пустой коллекцией, immutable result и cross-space isolation.
- #67: Debian target acceptance.
- #68: Astra Linux target acceptance.
- #69: реальный Office/LibreOffice corpus, 10/100/1000, restart/retry, backup/restore, update/rollback.
- #70: P5 и финальный release evidence.
- #81: включить branch protection/ruleset для `main` и закрепить обязательные проверки.
- #33: закрывается только после завершения перечисленных доказательств для одного точного release binding.

После успешного squash merge `0.7.0` обязательны зелёный post-merge CI exact SHA `main` и отдельный GitHub Release `v0.7.0-candidate` с проверенными assets. То же правило действует для каждой следующей новой версии.

## После стабилизации текущего среза

Nested entity-collection repeat для XLSX не входит в заявленную поддержку `0.7.0`. Его можно добавлять только отдельным вертикальным изменением с fixture, deterministic renderer/reverse-read regression, real-stack сценарием и отдельным SemVer bump. Существующий `audience.members` repeat DOCX/XLSX не должен регрессировать.

## Ограничение объёма разработки

Новые продуктовые функции не добавляются вне утверждённых задач и дефектов, выявленных реальным target/Office/P5-потоком. Значимый дефект исправляется по первопричине и получает regression coverage.

Applied migrations не переписываются, граница shared trusted workspace не меняется, микросервисы/облачные зависимости/новый frontend framework не вводятся.
