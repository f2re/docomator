# GitHub Releases и готовые bundles

Актуально на **2026-08-24**.

## Цель

Раздел **GitHub Releases** — основная публичная точка скачивания уже собранной и проверенной CI-поставки Оформлятора.

Пользовательский критерий простой:

```text
открыть репозиторий
→ увидеть Releases
→ открыть Latest release
→ скачать готовый .tar.gz или .f2re.zip
→ проверить SHA-256
→ установить / обновить
```

Release publisher ничего не «собирает заново». Он публикует только байты exact successful CI artifact.

## Source of truth

Единственный источник идентичности — `RELEASE_IDENTITY.json`.

Для текущего candidate:

```text
product version: 0.6.5
status/channel:  candidate / pilot
tag:             v0.6.5-candidate
GitHub state:    published visible Release
```

Для stable:

```text
product version: X.Y.Z
status/channel:  stable / production
tag:             vX.Y.Z
GitHub state:    published Release
```

GitHub `prerelease` flag для candidate не используется. Причина — он скрывает сборку из обычного release блока репозитория. Candidate semantics остаются явными в machine identity, tag `-candidate`, title и warning release body.

`/releases/latest` означает «последняя доступная сборка», а не «stable».

## Что публикуется

Release содержит **ровно пять assets**:

1. `docomator-<version>-linux-<arch>.tar.gz`;
2. `docomator-<version>-linux-<arch>.tar.gz.sha256`;
3. `docomator-<version>-project-control.f2re.zip`;
4. `docomator-<version>-project-control.f2re.zip.sha256`;
5. `SHA256SUMS.txt`.

Native `.tar.gz` и payload внутри `.f2re.zip` обязаны совпадать по SHA-256 и размеру.

## Как формируется candidate release

После успешного main CI publisher:

1. checkout-ит exact `workflow_run.head_sha`;
2. сверяет `VERSION` и `RELEASE_IDENTITY.json`;
3. скачивает только artifact `docomator-project-control-<exact-sha>` того же CI run;
4. сверяет внешний SHA-256 Project Control package;
5. читает `f2re-service.json` и проверяет schema/version/sourceCommit;
6. извлекает native `.tar.gz` из package;
7. сверяет native size + SHA-256;
8. создаёт отдельный native `.sha256` и `SHA256SUMS.txt`;
9. публикует Release с понятным описанием и примером установки;
10. повторно читает release metadata и требует published, visible, exact target commit.

## Recovery: tag есть, Release нет

Это отдельный поддерживаемый failure mode. Он важен, потому что GitHub/ручное действие может оставить tag без видимого Release.

Publisher не двигает такой tag и не подсовывает ему текущие байты. Вместо этого:

1. разрешает tag в historical commit;
2. проверяет historical `RELEASE_IDENTITY.json` и `VERSION`;
3. ищет успешный historical `CI` события `push` default branch для exact tag commit;
4. скачивает artifact именно этого run;
5. повторяет checksum/manifest/native verification;
6. создаёт Release через существующий tag (`--verify-tag`).

Если historical artifact недоступен, восстановление прекращается. Старый tag не перезаписывается; следующий выпуск должен получить новый SemVer.

## Existing GitHub prerelease

Если корректный Release уже существует, но был помечен GitHub как `prerelease`, publisher не пересобирает и не заменяет assets. Он изменяет только presentation metadata:

- `prerelease=false`;
- `make_latest=true`;
- `target_commitish` = commit существующего tag.

Таким образом готовый candidate становится видимым в стандартном блоке Releases, но его product maturity остаётся `candidate/pilot`.

## Независимая проверка опубликованного Release

После publisher запускается read-only workflow `Verify published release`.

Он требует:

- release существует и `isDraft=false`;
- `isPrerelease=false`, то есть выпуск виден обычному пользователю;
- target commit — полный 40-символьный SHA;
- присутствуют ровно пять ожидаемых assets;
- каждый asset реально скачивается;
- размеры совпадают с GitHub metadata;
- оба `.sha256` совпадают с файлами;
- `SHA256SUMS.txt` совпадает с обоими основными bundle;
- `f2re-service.json` совпадает с version/sourceCommit;
- native payload внутри Project Control package побайтно совпадает с отдельно опубликованным native asset по SHA-256 и размеру.

Verifier имеет только `contents: read` и не способен исправить плохой Release.

## Скачивание и установка

Откройте:

```text
https://github.com/f2re/docomator/releases/latest
```

Для ручной установки скачайте `.tar.gz` и соседний `.sha256`:

```bash
sha256sum -c docomator-*.tar.gz.sha256
tar -xzf docomator-*.tar.gz
cd docomator-*-linux-*
sudo ./install.sh
```

Для F2RE Project Control используйте `.f2re.zip` и его `.sha256`.

Target-side `verify/install/update/rollback` не используют Internet.

## Что GitHub bundle доказывает — и чего не доказывает

GitHub-hosted CI формирует **generic core bundle**:

- приложение;
- production dependencies;
- встроенный Node runtime;
- migrations;
- install/update/rollback/backup/recovery tooling;
- без LLM;
- без LibreOffice preview;
- без UX acceptance payload;
- без target-specific `.deb` closure.

Это готовый application/update bundle. Он **не заменяет** native Debian/Astra target acceptance.

Полный Debian/Astra bundle должен быть собран на соответствующей reference VM и пройти `docs/OFFLINE_DEPLOYMENT.md` / `docs/SUPPORT_MATRIX.md`.

## Security GitHub Actions

Publisher имеет только:

```text
actions: read
contents: write
```

Write permission нужен для tag/release metadata и assets. Workflow запускается только после успешного push-CI default branch и checkout-ит exact verified SHA. `pull_request_target`, `issue_comment` и `repository_dispatch` запрещены policy checker-ом.

Verifier имеет только:

```text
contents: read
```

## Immutability

Нельзя:

- передвигать старый release tag на новый commit;
- заменять assets под существующей release identity;
- восстанавливать старый tag из artifact другого commit;
- объявлять candidate stable только потому, что он отображается как Latest Release.

Product change сначала получает новый SemVer, затем новый immutable tag и новый Release.
