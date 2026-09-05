# GitHub Releases и готовые bundles

Актуально на **2026-09-05**.

## Принцип

GitHub Actions используется только как короткая read-only проверка исходного кода. Он не является системой сборки поставки, deploy-контуром или release publisher.

В репозитории поддерживается один workflow `.github/workflows/ci.yml`. Он:

- запускает `npm run check` для PR и push в `main`;
- выполняет fresh migration smoke;
- имеет только `contents: read`;
- использует только закреплённые `actions/checkout` и `actions/setup-node`;
- не устанавливает Chromium;
- не собирает offline bundle;
- не упаковывает Project Control update;
- не загружает Actions artifacts;
- не создаёт и не изменяет tags/Releases;
- не удаляет ветки и не выполняет deploy.

Такой CI защищает базовую целостность проекта, но не пытается заменить эксплуатационную приёмку.

## Source of truth

Единственный источник идентичности выпуска — `RELEASE_IDENTITY.json`.

`version` описывает состав продукта. `status/channel` описывают зрелость и эксплуатационный канал. GitHub tag и Release являются производным опубликованным представлением этой identity, а не вторым источником истины.

Для candidate используется tag `vX.Y.Z-candidate`, для stable/production — `vX.Y.Z`.

## Что проверяется на каждом PR

Обычная обязательная проверка:

```bash
npm ci
npm run check
DOCOMATOR_DATA_DIR="$PWD/.tmp/data" npm run migrate
```

`npm run check` включает build, unit/regression tests, migration/security/workflow/version invariants, shell/runtime syntax и статический UI contract.

Browser E2E, LibreOffice release gate, offline bundle assembly и target acceptance не запускаются автоматически на каждом PR.

## Что выполняется перед выпуском

Release owner работает с exact SHA `main`, для которого `Essential checks` завершён успешно.

Минимальный release flow:

1. получить exact source SHA и текущий `RELEASE_IDENTITY.json`;
2. выполнить `npm ci` и `npm run check:release`;
3. выполнить относящиеся к выпуску Chromium/real-stack проверки;
4. собрать offline bundle на контролируемом build/reference host;
5. проверить bundle, SHA-256 и embedded release metadata;
6. выполнить Debian/Astra/Office/recovery acceptance, требуемую `SUPPORT_MATRIX.md`;
7. только после этого явно создать immutable tag и GitHub Release;
8. после публикации скачать опубликованные assets и сверить SHA-256 с локально принятыми файлами.

Публикация — явная операция владельца выпуска через GitHub API/UI/CLI или другой контролируемый операторский инструмент. Она не запускается от `push`, `workflow_run`, `release` или комментария.

## Assets

Опубликованный Release может содержать:

- `docomator-<version>-linux-<arch>.tar.gz`;
- соседний `.sha256`;
- `docomator-<version>-project-control.f2re.zip`;
- соседний `.sha256`;
- `SHA256SUMS.txt`.

Состав конкретного выпуска должен соответствовать его release notes и machine identity. Наличие GitHub Release само по себе не доказывает target compatibility.

Проверка native bundle перед установкой:

```bash
sha256sum -c docomator-*.tar.gz.sha256
tar -xzf docomator-*.tar.gz
cd docomator-*-linux-*
sudo ./install.sh
```

Target-side `verify/install/update/rollback` не используют Internet.

## Generic и target-specific bundles

Generic application bundle и полный Debian/Astra bundle — разные уровни доказательства.

Полный Debian/Astra bundle должен быть собран на соответствующей reference VM и пройти `docs/OFFLINE_DEPLOYMENT.md` / `docs/SUPPORT_MATRIX.md`. Наличие generic archive не заменяет проверку target package closure, LibreOffice, reboot, backup/restore, update/rollback и Office corpus.

## Security GitHub Actions

Постоянная политика проста:

```text
workflow files:  только .github/workflows/ci.yml
permissions:     contents: read
allowed actions: pinned actions/checkout + actions/setup-node
write actions:   запрещены
artifact upload: запрещён
release/deploy:  запрещён
```

`workflow_run`, `workflow_dispatch`, `release`, `schedule`, `pull_request_target`, `issue_comment` и `repository_dispatch` не используются. Policy закреплена `scripts/ci/check-workflow-permissions.mjs` и regression tests.

## Immutability

Нельзя:

- передвигать старый release tag на новый commit;
- заменять assets под существующей release identity;
- восстанавливать старый tag из bundle другого commit;
- объявлять candidate stable только потому, что он отображается как Latest Release.

Если старый Release невозможно достоверно восстановить из exact artifacts того же commit, выпускается новая версия вместо подмены старых байтов.
