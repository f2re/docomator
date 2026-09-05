# Версионирование Оформлятора

Актуально на **2026-09-05**.

## Источник истины

Единственный машинно читаемый источник идентичности выпуска — `RELEASE_IDENTITY.json`.

Поля имеют разные смыслы:

- `version` — состав и совместимость продукта;
- `status` — зрелость состава: `candidate` или `stable`;
- `channel` — эксплуатационный канал: `pilot` или `production`.

`VERSION`, package metadata, внутренние `@docomator/*` зависимости, lockfile, runtime default, пример env и текущие release-документы являются производными и проверяются проектными checks.

## SemVer

### PATCH

Увеличивать `PATCH`, когда пользовательская возможность не добавляется и совместимость сохраняется:

- исправление дефекта;
- regression fix renderer/import/UI/API;
- исправление производительности или надёжности;
- уточнение recovery/error handling без нового продуктового сценария.

Пример: `0.6.5 → 0.6.6`.

### MINOR

Увеличивать `MINOR`, когда появляется новая обратно совместимая возможность или заметно расширяется существующая:

- новый раздел или пользовательский сценарий;
- новая возможность импорта/экспорта;
- новый тип шаблонной конструкции;
- новая domain/API операция;
- новое операторское поведение offline/update/recovery.

Пример: `0.6.6 → 0.7.0`.

До `1.0.0` несовместимое изменение также как минимум требует нового `MINOR`, явного описания совместимости и ADR/миграции, если затронуты архитектура, безопасность или данные.

### MAJOR

После `1.0.0` увеличивать `MAJOR` для намеренно несовместимых изменений публичного API, форматов данных, поддерживаемого пользовательского поведения или эксплуатационного контракта.

Переход `0.x → 1.0.0` означает признание продуктового и эксплуатационного контракта достаточно стабильным; сам номер не заменяет release evidence.

## Когда версия не меняется

Bump не обязателен для изменения, которое не меняет поставляемое поведение продукта:

- только тесты;
- только документация без изменения заявленного продукта;
- комментарии и инженерная гигиена;
- CI/release automation без изменения runtime/offline-контракта;
- обновление release evidence/target act;
- чистая смена `candidate/pilot → stable/production` после успешной приёмки, если продуктовый состав не менялся.

Если вместе с документацией изменён runtime/API/UI/storage/offline-код, version policy рассматривает это как product change и требует bump.

## Как менять версию

Не редактировать производные файлы вручную:

```bash
npm run version:bump -- patch
npm run version:bump -- minor
npm run version:bump -- major
```

Для заранее согласованного номера:

```bash
npm run version:bump -- 0.7.0
```

Команда синхронно обновляет machine identity и производные version markers. `status` и `channel` команда не меняет. После bump выполняется `npm run check`; перед публикацией выпуска дополнительно выполняется `npm run check:release` и соответствующая target acceptance.

## Проверки разработки

`npm run check` — короткий обязательный gate обычного PR. Он проверяет:

- сборку и unit/regression tests;
- неизменность исторических migration prefixes;
- отсутствие IAM drift и небезопасных GitHub Actions;
- синхронность release identity и version policy;
- shell/runtime syntax;
- статический UI contract.

GitHub CI запускает именно этот контур и fresh migration smoke. В удалённом CI намеренно нет Chromium installation, offline bundle assembly, Project Control packaging, artifact upload, release publisher и release verifier.

## Проверки выпуска

`npm run check:release` добавляет проверки, которые не должны замедлять каждый PR:

- examples/fixtures consistency;
- release gates, включая LibreOffice gate;
- документацию и audit remediation;
- пользовательский язык и branding.

Кроме него для конкретного выпуска выполняются относящиеся к изменению browser E2E, offline bundle verification, recovery/update/rollback и target acceptance. CI разработчика не заменяет target act.

## GitHub tags и Releases

GitHub не вводит второй номер версии. Tag является производным от `RELEASE_IDENTITY.json`:

| Machine identity | Tag | GitHub presentation |
|---|---|---|
| `candidate / pilot` | `vX.Y.Z-candidate` | обычный видимый Release, maturity явно указана в tag/title/body |
| `stable / production` | `vX.Y.Z` | обычный Release |

Candidate не обязан использовать GitHub `prerelease` flag: авторитетная зрелость хранится в `status/channel`, tag и release notes. Ссылка `/releases/latest` означает только «последняя опубликованная сборка», а не `stable/production`.

Candidate tag и stable tag разделены потому, что успешный maturity transition может сохранить тот же product SemVer. Старый candidate ref при этом не перемещается.

## Immutability и восстановление публикации

Tag и assets immutable для своей пары `version + maturity`.

GitHub Actions больше не создают, не восстанавливают и не изменяют tags/Releases. Выпуск выполняет release owner как явную операцию после проверки exact source SHA и SHA-256 готовых assets.

Нельзя:

- передвигать существующий release tag на новый commit;
- заменять assets под существующим release identity;
- привязывать старый tag к bundle, собранному из другого commit;
- считать видимый candidate доказательством `stable/production`.

Если tag существует, а Release или подтверждённые assets отсутствуют, старый tag не переписывается. Восстановление допустимо только при наличии проверяемых exact artifacts того же commit; иначе создаётся новый SemVer release.

## Release pipeline

Обычный путь разработки короткий:

```text
PR / main commit
→ Essential checks
→ fresh migration smoke
```

Подготовка выпуска выполняется явно и отдельно:

```text
exact main SHA
→ npm run check:release
→ относящиеся к выпуску Chromium / real-stack checks
→ build + verify offline bundle на контролируемом build host
→ target / Office / recovery acceptance
→ явное создание immutable tag и GitHub Release
```

GitHub Actions не собирают distribution bundle и не выполняют deploy. Это исключает автоматические write-side effects из обычной разработки и не смешивает fast CI с эксплуатационной приёмкой.

## Release binding

Любой target/Office/recovery/P5 evidence относится одновременно к точным:

- version;
- status/channel;
- Git commit;
- SHA-256 release metadata/bundle.

После изменения версии старый evidence остаётся исторически валидным, но не закрывает stable gate новой версии.

Подробно: `docs/GITHUB_RELEASES.md`.
