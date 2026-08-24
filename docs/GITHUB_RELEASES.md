# GitHub Releases и готовые bundle

Актуально на **2026-08-24**.

## Цель

GitHub Releases — постоянная точка скачивания уже собранных и проверенных артефактов Оформлятора. Release не собирает продукт повторно: он публикует только байты, которые создал и проверил успешный `CI` exact commit ветки `main`.

Единственный источник идентичности остаётся `RELEASE_IDENTITY.json`. GitHub tag, название release и признак prerelease являются производными и не создают второго номера версии.

## Имена release и tags

Для `candidate / pilot`:

```text
product version: 0.6.5
tag:             v0.6.5-candidate
GitHub state:    Pre-release
```

Для `stable / production`:

```text
product version: 0.6.5
tag:             v0.6.5
GitHub state:    Release
```

Суффикс `-candidate` описывает зрелость GitHub-публикации, а не новый номер продукта. Поэтому предусмотренный политикой переход `candidate/pilot → stable/production` без изменения product SemVer не требует перемещения старого tag: кандидат и stable получают разные immutable refs.

## Что публикуется

Успешный main CI уже создаёт `docomator-<version>-project-control.f2re.zip` и проверяет, что внутри находится тот же native offline archive `docomator-<version>-linux-<arch>.tar.gz` с exact `sourceCommit` и SHA-256.

Release publisher:

1. запускается только после `workflow_run` со статусом `success`, событием `push` и веткой `main`;
2. checkout делает exact `head_sha` завершившегося CI;
3. повторно проверяет `VERSION` и `RELEASE_IDENTITY.json`;
4. скачивает только artifact `docomator-project-control-<exact-sha>` из этого CI run;
5. проверяет внешний SHA-256 Project Control package;
6. читает `f2re-service.json`, проверяет version/sourceCommit/schema и безопасное имя payload;
7. извлекает native archive по единственному разрешённому payload path и повторно сверяет его size + SHA-256;
8. создаёт `SHA256SUMS.txt`;
9. создаёт GitHub Release и загружает:
   - `docomator-<version>-linux-<arch>.tar.gz`;
   - `docomator-<version>-linux-<arch>.tar.gz.sha256`;
   - `docomator-<version>-project-control.f2re.zip`;
   - `docomator-<version>-project-control.f2re.zip.sha256`;
   - `SHA256SUMS.txt`.

Повторный успешный CI той же `version + maturity` не изменяет существующий release и не перемещает tag. Любое поставляемое изменение продукта обязано сначала получить SemVer bump по `docs/VERSIONING.md`.

## Независимая проверка опубликованного выпуска

После успешного workflow публикации запускается отдельный read-only workflow `Verify published release`. Он не доверяет факту появления tag и повторно проверяет уже опубликованный объект GitHub Release с точки зрения пользователя, который будет его скачивать:

1. release существует и больше не является draft;
2. `candidate` действительно помечен как Pre-release, а `stable` — как обычный Release;
3. `targetCommitish` — точный 40-символьный commit SHA;
4. присутствуют ровно пять ожидаемых assets без лишних или пропущенных файлов;
5. каждый asset реально скачивается и его размер совпадает с GitHub metadata;
6. оба `.sha256` совпадают с фактическими байтами;
7. `SHA256SUMS.txt` перечисляет ровно native и Project Control bundle и совпадает с их фактическими SHA-256;
8. `f2re-service.json` внутри `.f2re.zip` совпадает с version/target commit;
9. native payload внутри `.f2re.zip` побайтно соответствует отдельно опубликованному native `.tar.gz` по SHA-256 и размеру.

Проверяющий workflow имеет только `contents: read`. Таким образом, он не может «исправить» плохой release и скрыть дефект: несовпадение приводит к красной проверке, а опубликованные assets остаются доказуемо неизменёнными.

## Как скачивать

Откройте раздел **Releases** репозитория и выберите нужный выпуск.

Для обычной ручной поставки используйте `.tar.gz` вместе с `.sha256`. Для F2RE Project Control используйте `.f2re.zip` вместе с `.sha256`.

После переноса в закрытый контур сначала проверьте SHA-256, затем распакуйте архив и запустите поставляемый `verify-bundle.sh`. Target-side install/update остаются полностью offline.

## Важная граница поддержки

GitHub-hosted CI сейчас формирует **generic core bundle** без LLM, LibreOffice preview, UX acceptance payload и target-specific `.deb` closure. Это готовый проверенный application bundle и пакет обновления, но он сам по себе **не доказывает поддержку чистой Debian/Astra установки**.

Полный Debian/Astra bundle по `docs/OFFLINE_DEPLOYMENT.md` должен быть собран на соответствующей reference VM и пройти target acceptance. До завершения этих актов `candidate/pilot` остаётся GitHub Pre-release, а SUPPORT_MATRIX не расширяется.

Stable/production не выводится из факта наличия GitHub Release: сначала меняется `RELEASE_IDENTITY.json` по действующему release-evidence процессу, затем успешный exact-main CI публикует отдельный stable tag `v<version>`.

## Безопасность GitHub Actions

Workflow публикации имеет только:

```text
actions: read
contents: write
```

`contents: write` нужен только для создания tag/release. Workflow не запускается из `pull_request_target`, `issue_comment` или `repository_dispatch`, не checkout-ит PR-код и не выполняет shell из пользовательского ввода. Разрешённая структура release workflow закреплена в `scripts/ci/check-workflow-permissions.mjs` и regression tests.

Независимый verifier использует только `contents: read`, скачивает публично опубликованные release assets и не имеет write-разрешений.
