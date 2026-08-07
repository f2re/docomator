# Автономная поставка, установка и обновление Docomator

## 1. Принципы

Docomator разворачивается в закрытом контуре без обращения целевой машины в Интернет.

Контракт поставки:

1. bundle собирается на подключённой эталонной машине;
2. архив и его ожидаемый SHA-256 передаются в закрытый контур;
3. архив распаковывается обычным пользователем в любой удобный каталог;
4. `verify-bundle.sh` проверяет inventory, типы объектов, допустимые символические ссылки и контрольные суммы;
5. `install.sh` или `update.sh` получают root только для реальных системных изменений.

**Владелец распакованного каталога не является доказательством целостности релиза.** Не требуется переносить bundle в специально подготовленный `root:root` каталог и проверять владельца всей цепочки его родителей. Целостность определяется содержимым и SHA-256.

Версия продукта и конкретная сборка различаются. Полный договор: [VERSIONING.md](VERSIONING.md).

## 2. Совместимость эталонной и целевой машины

Эталонный хост должен быть совместим с целью по:

- архитектуре CPU;
- `glibc`;
- выпуску Debian/Astra Linux для поставляемых `.deb`;
- набору CPU-инструкций для `llama-server`;
- согласованным версиям LibreOffice/Chromium, если они входят в профиль приёмки.

Не собирайте `llama-server` с инструкциями CPU, отсутствующими на целевой машине. Для разнородного парка используйте консервативную сборку либо отдельные bundles.

## 3. Состав bundle

Типовая структура:

```text
docomator-<version>-linux-<arch>/
├── VERSION
├── RELEASE_NOTES.md
├── SUPPORT_MATRIX.md
├── release.json
├── manifest.sha256
├── manifest.symlinks
├── install.sh
├── update.sh
├── verify-bundle.sh
├── smoke-test.sh
├── target-acceptance.sh
├── target-release-gate.sh
├── ux-acceptance-gate.sh
├── lib.sh
└── payload/
    ├── app/
    ├── runtime/
    ├── models/
    ├── deploy/systemd/
    ├── config/docomator.env.example
    ├── acceptance/              # только для UX-профиля
    └── os-packages/             # при поставке локальных .deb
```

`manifest.sha256` и `manifest.symlinks` описывают точное содержимое комплекта. `release.json` связывает версию продукта с commit и параметрами конкретной сборки.

## 4. Подготовка системных пакетов

На подключённой эталонной машине той же редакции ОС:

```bash
sudo scripts/offline/collect-os-packages.sh --apt-update
```

Свой список пакетов:

```bash
sudo scripts/offline/collect-os-packages.sh \
  --package-list /path/to/packages.txt \
  --output /srv/docomator-os-packages \
  --apt-update
```

Полученный набор должен соответствовать точному выпуску целевой ОС. Приложение не пытается автоматически переносить `.deb` между несовместимыми выпусками Debian/Astra.

## 5. Сборка автономного комплекта

### Полный профиль с LLM

```bash
scripts/offline/prepare-bundle.sh \
  --llama-server /srv/build/llama.cpp/llama-server \
  --target-profile debian \
  --model /srv/models/model.gguf \
  --with-preview \
  --with-ux-acceptance \
  --os-packages-dir /srv/docomator-os-packages
```

### Без LLM

```bash
scripts/offline/prepare-bundle.sh \
  --without-llm \
  --without-preview \
  --without-ux-acceptance
```

### С локальным Node.js

```bash
scripts/offline/prepare-bundle.sh \
  --node-runtime-dir /srv/runtime/node-v24.18.0-linux-x64 \
  --target-profile debian \
  --llama-server /srv/runtime/llama-server \
  --model /srv/models/model.gguf \
  --with-preview \
  --with-ux-acceptance \
  --os-packages-dir /srv/docomator-os-packages
```

Сборщик обязан выполнить проверки проекта, сформировать release metadata и manifests, проверить получившийся bundle и создать архив с контрольной суммой.

## 6. Перенос в закрытый контур

Переносите как минимум:

```text
bundle.tar.gz
ожидаемый SHA-256 bundle.tar.gz
```

Для регламентированного контура ожидаемый SHA-256 должен приходить по доверенному независимому каналу или из подписанного release manifest организации.

Проверка архива:

```bash
printf '%s  %s\n' '<ожидаемый-sha256>' 'docomator-....tar.gz' \
  | sha256sum --check --strict -
```

Распаковка выполняется **обычным пользователем**:

```bash
mkdir -p "$HOME/docomator-update"
tar --no-same-owner --no-same-permissions \
  -xzf docomator-....tar.gz \
  -C "$HOME/docomator-update"
cd "$HOME/docomator-update/docomator-<version>-linux-<arch>"
./verify-bundle.sh "$PWD"
```

После успешной проверки этот же каталог можно использовать для установки или обновления. Дополнительное копирование в `/var/tmp`, смена владельца на `root:root` и массовый `chmod` не требуются.

## 7. Новая установка

Обычный вариант:

```bash
cd /путь/к/распакованному/bundle
sudo ./install.sh
```

Если на чистой машине необходимо установить приложенные `.deb`:

```bash
sudo ./install.sh --install-os-packages
```

Установить файлы и миграции без запуска служб:

```bash
sudo ./install.sh --no-start
```

Проверочный режим без systemd:

```bash
sudo ./install.sh --no-systemd
```

Нестандартные пути:

```bash
sudo ./install.sh \
  --install-root /opt/docomator \
  --data-dir /srv/docomator \
  --config-dir /etc/docomator
```

Root здесь нужен для `/opt`, `/etc`, `/var/lib`, systemd, сервисного пользователя и локальной установки `.deb`, а не для доказательства доверия к исходному каталогу.

## 8. Результат установки

По умолчанию:

```text
/opt/docomator/releases/<version>-<release-metadata-sha-prefix>/
/opt/docomator/current
/etc/docomator/docomator.env
/var/lib/docomator/docomator.db
/var/lib/docomator/models/
/var/lib/docomator/objects/
/var/lib/docomator/backups/
/etc/systemd/system/docomator-*.service
```

`current` — атомарная ссылка на конкретную immutable-сборку.

Например, две разные проверенные сборки одной версии могут существовать рядом:

```text
releases/0.1.0-a1b2c3d4e5f6/
releases/0.1.0-9f8e7d6c5b4a/
```

Это нормальное состояние.

## 9. Обновление

Распакуйте и проверьте новый комплект обычным пользователем, затем:

```bash
cd /путь/к/новому/bundle
sudo ./update.sh
```

**Совпадение `VERSION` с установленной версией не блокирует обновление.** Конкретная сборка идентифицируется SHA-256 `release.json`.

`update.sh`:

1. получает exclusive `flock`;
2. повторно запускает `verify-bundle.sh`;
3. создаёт предобновленческую копию конфигурации и SQLite;
4. устанавливает конкретную сборку в отдельный immutable-каталог;
5. применяет checksum-protected миграции;
6. атомарно переключает `current`;
7. запускает службы;
8. ожидает `/readyz`;
9. при ошибке возвращает прежний symlink, БД и конфигурацию.

Точная повторная установка уже установленной сборки допустима и идемпотентна.

### Контроль после обновления

```bash
systemctl --no-pager --full status \
  docomator-api.service docomator-worker.service
curl --fail --silent --show-error http://127.0.0.1:8080/readyz

sudo -u docomator env DOCOMATOR_DATA_DIR=/var/lib/docomator \
  /opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/database-admin.mjs check
```

## 10. Резервирование и откат

Перед переключением сборки `install.sh --upgrade` сохраняет согласованный набор:

```text
docomator.env
docomator.db
docomator.db-wal
docomator.db-shm
```

в `backups/pre-update-*`.

При неуспешной миграции, запуске служб или readiness-check автоматически восстанавливаются прежняя ссылка `current`, база и конфигурация.

Object storage не копируется перед каждым обновлением: он должен входить в регулярную политику резервирования.

Системные `.deb` не входят в транзакцию приложения. На действующей установке меняйте их отдельной процедурой с системным snapshot/backup.

## 11. Целевая приёмка

Приёмка запускается обычным пользователем из **того же проверенного bundle**:

```bash
install -d -m 0700 "$HOME/docomator-target-acts"
./target-acceptance.sh \
  --config /etc/docomator/docomator.env \
  --base-url http://127.0.0.1:8080/ \
  --output "$HOME/docomator-target-acts/target-01"
```

Для обязательных интеграций:

```bash
./target-acceptance.sh \
  --output "$HOME/docomator-target-acts/target-02" \
  --require-network \
  --require-smtp
```

Сценарий сам вызывает `sudo` только для проверок, действительно требующих повышенных прав. Bundle не обязан принадлежать root.

## 12. LLM

Основные параметры:

```ini
DOCOMATOR_LLM_ENABLED=true
DOCOMATOR_LLM_MODEL=/var/lib/docomator/models/model.gguf
DOCOMATOR_LLM_HOST=127.0.0.1
DOCOMATOR_LLM_PORT=8081
DOCOMATOR_LLM_CONTEXT=4096
DOCOMATOR_LLM_THREADS=8
```

После изменения:

```bash
sudo systemctl restart docomator-llm docomator-api docomator-worker
```

LLM остаётся опциональным ускорителем. Детерминированное ядро и установка не должны зависеть от доступности внешнего LLM/API.

## 13. LibreOffice preview

```ini
DOCOMATOR_PREVIEW_ENABLED=true
DOCOMATOR_LIBREOFFICE_BIN=/usr/bin/libreoffice
DOCOMATOR_PREVIEW_TIMEOUT_MS=120000
DOCOMATOR_PREVIEW_MAX_BYTES=134217728
```

Если preview включён, указанный executable должен быть доступен. Для первой автономной установки согласованный `.deb`-набор может быть установлен через `--install-os-packages`.

## 14. Версия продукта

Версия меняется только в корневом `VERSION`:

```bash
printf '0.2.0\n' > VERSION
npm run version:sync
npm run check:release-version
```

Не поднимайте номер версии только ради того, чтобы установщик принял новую сборку. Это больше не требуется.

## 15. Диагностика

### Bundle не проходит проверку

Не меняйте файлы внутри bundle вручную. Повторно перенесите архив и сверьте ожидаемый SHA-256.

### Обновление не стартует

Проверьте:

```bash
./verify-bundle.sh "$PWD"
sudo ./update.sh
```

Если ошибка относится к systemd, SQLite, LibreOffice или пакетной базе, исправляйте конкретную причину. Владение исходным каталогом пользователем само по себе ошибкой не является.

### Проверка текущей сборки

```bash
readlink -f /opt/docomator/current
cat /opt/docomator/current/release.json
```

### Проверка готовности

```bash
curl --fail --silent --show-error http://127.0.0.1:8080/readyz
```
