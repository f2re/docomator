# Project Control

`docomator` подключается к единому F2RE Project Control без замены штатного offline installer. Native bundle по-прежнему создаётся и проверяется `scripts/offline/prepare-bundle.sh`; новый внешний слой лишь упаковывает готовый TAR.GZ в идентифицируемый ZIP для drag-and-drop обновления.

## Сборка

Вместо прямого вызова `prepare-bundle.sh` для поставки через Project Control используйте:

```bash
./scripts/project-control/build-bundle.sh <обычные параметры prepare-bundle.sh>
```

В каталоге output останутся прежние файлы:

```text
docomator-<version>-linux-<arch>.tar.gz
docomator-<version>-linux-<arch>.tar.gz.sha256
```

и дополнительно появятся:

```text
docomator-<version>-project-control.f2re.zip
docomator-<version>-project-control.f2re.zip.sha256
```

Именно `*.f2re.zip` перетаскивается на карточку «Оформлятор» в Project Control. Контроллер проверяет wrapper manifest и SHA-256 native payload, затем запускает только allowlisted штатный `update.sh`/`install.sh`. Backup, migration, atomic current switch, readiness и rollback остаются в существующем `docomator` installer.

## Подписанный release package

Для Ed25519-аутентификации release задайте приватный ключ только на подключённой build-машине:

```bash
F2RE_RELEASE_SIGNING_KEY=/secure/release-ed25519-private.pem \
  ./scripts/project-control/build-bundle.sh ...
```

Public key с соответствующим `keyId` устанавливается на target в `/etc/project-control/trusted-keys/<keyId>.pem`. Приватный ключ на target не переносится.

Формат внешнего wrapper: `f2re-managed-service/v1`, `projectId=docomator`, `adapter=docomator-v1`. Wrapper не содержит команд для root; команды и имена служб задаются статическим allowlist Project Control.
