# Версионирование Оформлятора

Актуально на **2026-08-25**.

## Источник истины

Единственный машинно читаемый источник идентичности выпуска — `RELEASE_IDENTITY.json`.

Поля имеют разные смыслы:

- `version` — состав и совместимость продукта;
- `status` — зрелость состава: `candidate` или `stable`;
- `channel` — эксплуатационный канал: `pilot` или `production`.

`VERSION`, package metadata, внутренние `@docomator/*` зависимости, lockfile, runtime default, пример env и текущие release-документы являются производными и проверяются CI.

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

Если вместе с документацией изменён runtime/API/UI/storage/offline-код, CI рассматривает это как product change и требует bump.

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

Команда синхронно обновляет machine identity и производные version markers. `status` и `channel` команда не меняет. После bump обязателен полный `npm run check`.

## CI gates

`npm run check:release-version` проверяет синхронность номера, статуса и канала.

`npm run check:version-policy` сравнивает product-changing paths с base-parent. Поставляемое изменение без нового SemVer блокируется.

При сомнении безопаснее сделать `PATCH`, чем слить пользовательски заметное изменение под старым номером.

## GitHub tags и Releases

GitHub не вводит второй номер версии. Tag является производным от `RELEASE_IDENTITY.json`:

| Machine identity | Tag | GitHub presentation |
|---|---|---|
| `candidate / pilot` | `vX.Y.Z-candidate` | обычный **видимый Release**, maturity явно указана в tag/title/body |
| `stable / production` | `vX.Y.Z` | обычный Release |

Candidate намеренно **не использует GitHub `prerelease` flag**. GitHub скрывает prerelease из обычного блока Releases на главной странице репозитория, из-за чего готовая сборка выглядит как отсутствующая. Зрелость продукта при этом не теряется: её авторитетно задают `status/channel`, tag `-candidate`, заголовок и предупреждение в release body.

Следовательно, ссылка `/releases/latest` может вести на candidate. Это означает только «последняя опубликованная сборка», а **не stable/production**.

Candidate tag и stable tag разделены потому, что успешный maturity transition может сохранить тот же product SemVer. Старый candidate ref при этом не перемещается.

## Immutability и восстановление публикации

Tag и assets immutable для своей пары `version + maturity`.

Повторный успешный CI:

- не двигает существующий tag;
- не заменяет assets под существующим Release;
- может исправить только presentation metadata (`prerelease=false`, `latest`, exact target commit), если байты уже опубликованы.

Если существует tag, но GitHub Release отсутствует, publisher вправе восстановить Release **только fail-closed**:

1. tag разрешается в exact commit;
2. historical `RELEASE_IDENTITY.json` и `VERSION` этого commit совпадают с текущей identity;
3. для tag commit найден успешный `CI` события `push` default branch;
4. существует exact Actions artifact `docomator-project-control-<commit>`;
5. artifact, manifest, native payload и SHA-256 проходят повторную проверку;
6. Release создаётся поверх существующего tag через `--verify-tag`; tag не перемещается.

Если historical artifact уже удалён/истёк или checksum не совпадает, автоматическое «восстановление» запрещено. Требуется новый SemVer release, а не подмена старого tag новыми байтами.

## Release pipeline

**Каждый новый SemVer, попавший в `main`, обязан получить отдельный GitHub Release.** Нельзя оставлять новый номер только в `VERSION`/tag, объединять несколько номеров в один Release или считать выпуск завершённым до проверки опубликованных assets. Это постоянное правило release discipline.

Публикация выполняется только после успешного полного `CI` события `push` default branch:

```text
main commit
→ repository/unit/release gates
→ Chromium + real-stack
→ assemble + verify offline archive
→ Project Control package
→ Publish verified release
→ Verify published release
```

Publisher повторно проверяет exact workflow SHA, checksum и `f2re-service.json`. Независимый verifier имеет только read permission, скачивает уже опубликованные assets и сверяет их размеры/SHA-256, включая идентичность native `.tar.gz` и payload внутри `.f2re.zip`.

До merge feature-ветки Release не создаётся. После squash merge сначала обязан стать зелёным post-merge CI exact `main` SHA, затем release workflow публикует версию. О выполненном выпуске можно сообщать только после повторного чтения GitHub API и проверки tag, target commit и assets.

## Release binding

Любой target/Office/recovery/P5 evidence относится одновременно к точным:

- version;
- status/channel;
- Git commit;
- SHA-256 release metadata/bundle.

После изменения версии старый evidence остаётся исторически валидным, но не закрывает stable gate новой версии.

Подробно: `docs/GITHUB_RELEASES.md`.
