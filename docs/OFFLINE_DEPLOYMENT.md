# Автономная поставка, установка и обновление

## 1. Модель поставки

Autonomous release bundle создаётся на подключённом **reference host** и переносится в закрытый контур как один `.tar.gz`.

Reference host должен совпадать с target по:

- архитектуре CPU;
- версии/совместимости `glibc`;
- редакции Debian/Astra Linux для `.deb`-пакетов;
- ожидаемым CPU instructions для `llama-server`.

> [!IMPORTANT]
> Не собирайте `llama-server` с инструкциями CPU, отсутствующими на target. Для разнородного парка используйте консервативный build либо отдельные bundles.

## 2. Состав bundle

```text
docomator-<version>-linux-<arch>/
├── VERSION
├── release.json
├── manifest.sha256
├── install.sh
├── update.sh
├── verify-bundle.sh
├── lib.sh
├── healthcheck.mjs
└── payload/
    ├── app/
    │   ├── apps/*/dist
    │   ├── packages/*/dist
    │   ├── node_modules
    │   ├── migrations
    │   └── scripts/runtime
    ├── runtime/
    │   ├── node/
    │   └── llama/llama-server
    ├── models/*.gguf
    ├── deploy/systemd/
    ├── config/docomator.env.example
    └── os-packages/*.deb
```

`manifest.sha256` покрывает все файлы, кроме самого manifest.

## 3. Подготовка OS packages

Выполняется на чистой подключённой VM с той же редакцией ОС:

```bash
sudo scripts/offline/collect-os-packages.sh --apt-update
```

Список задаётся в [`config/os-packages.txt`](../config/os-packages.txt).

Свой список:

```bash
sudo scripts/offline/collect-os-packages.sh \
  --package-list /path/to/packages.txt \
  --output /srv/docomator-os-packages \
  --apt-update
```

> [!WARNING]
> `apt-get --download-only` зависит от состояния reference VM. Проверяйте полный набор на чистой offline VM. Astra repositories и package pins должны совпадать с target.

## 4. Подготовка application bundle

### Полный bundle с LLM

```bash
scripts/offline/prepare-bundle.sh \
  --llama-server /srv/build/llama.cpp/llama-server \
  --model /srv/models/qwen-or-phi-q4.gguf \
  --os-packages-dir offline-bundles/os-packages
```

Script:

1. загружает официальный Node.js, указанный в `.node-version`, либо использует переданный runtime;
2. проверяет checksum Node archive;
3. выполняет `npm ci` и `npm run check`;
4. собирает production workspaces;
5. выполняет `npm ci --omit=dev` в payload;
6. добавляет `llama-server`, модель и optional `.deb`;
7. создаёт release metadata и SHA-256 manifest;
8. повторно проверяет bundle;
9. создаёт `.tar.gz`.

### Bundle с заранее распакованным Node.js

```bash
scripts/offline/prepare-bundle.sh \
  --node-runtime-dir /srv/runtime/node-v24.18.0-linux-x64 \
  --llama-server /srv/runtime/llama-server \
  --model /srv/models/model.gguf
```

### Bundle с локальным Node archive

```bash
scripts/offline/prepare-bundle.sh \
  --node-archive /srv/cache/node-v24.18.0-linux-x64.tar.xz \
  --node-sha256 '<expected-sha256>' \
  --llama-server /srv/runtime/llama-server \
  --model /srv/models/model.gguf
```

### Явно без LLM

Для теста детерминированного ядра:

```bash
scripts/offline/prepare-bundle.sh --without-llm
```

Script не создаёт молча неполный bundle: требуется либо пара `--llama-server`/`--model`, либо `--without-llm`.

## 5. Перенос

Рекомендуется переносить:

```text
bundle tar.gz
отдельный SHA-256 tar.gz
подписанный release manifest организации
акт антивирусной/контрольной проверки
```

После извлечения:

```bash
./verify-bundle.sh
```

## 6. Новая установка

```bash
tar -xzf docomator-0.1.0-alpha.0-linux-x64.tar.gz
cd docomator-0.1.0-alpha.0-linux-x64
sudo ./install.sh --install-os-packages
```

Без установки `.deb`, если prerequisites уже установлены:

```bash
sudo ./install.sh
```

Установить unit-файлы и выполнить миграции, но не запускать services:

```bash
sudo ./install.sh --no-start
```

Для проверочного chroot/container-сценария без установки unit-файлов:

```bash
sudo ./install.sh --no-systemd
```

`--no-systemd` предназначен для smoke-теста и нестандартной интеграции с внешним service manager. В штатной Debian/Astra Linux установке используется systemd.

Custom paths:

```bash
sudo ./install.sh \
  --install-root /opt/docomator \
  --data-dir /srv/docomator \
  --config-dir /etc/docomator
```

## 7. Результат установки

```text
/opt/docomator/releases/<version>/  immutable release
/opt/docomator/current             atomic symlink
/etc/docomator/docomator.env       local config and secrets
/var/lib/docomator/docomator.db    SQLite database
/var/lib/docomator/models/         GGUF models
/var/lib/docomator/objects/        generated and source objects
/var/lib/docomator/backups/        pre-update backups
/etc/systemd/system/docomator-*.service
```

Для новой конфигурации installer:

- генерирует session secret;
- выставляет data directory;
- включает LLM, если bundle содержит binary и model;
- не перезаписывает существующие SMTP secrets.

## 8. Обновление

```bash
tar -xzf docomator-NEW-linux-x64.tar.gz
cd docomator-NEW-linux-x64
sudo ./update.sh --install-os-packages
```

Update:

1. получает exclusive `flock`;
2. проверяет bundle checksums;
3. останавливает services;
4. копирует БД и конфигурацию в `backups/pre-update-*`;
5. устанавливает новую immutable release;
6. применяет checksum-protected migrations;
7. атомарно переключает `/opt/docomator/current`;
8. запускает systemd services;
9. ожидает `/readyz`;
10. откатывает symlink, БД и config при ошибке.

> [!NOTE]
> Object storage не копируется перед каждым update, поскольку outputs immutable и обычно велики. Он должен входить в регулярную backup policy.

## 9. Конфигурация LLM

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

## 10. Сетевые папки

Приложение не хранит SMB/NFS passwords и не выполняет mount. Ресурс монтируется ОС через `.mount/.automount`, `/etc/fstab` или утверждённый механизм Astra Linux.

Рекомендуемая структура:

```text
/mnt/docomator-reports/
├── .docomator-sentinel   # содержит согласованный root ID
└── generated/
```

Будущий delivery adapter перед каждой записью проверит:

- mount присутствует в `/proc/self/mountinfo`;
- sentinel содержит ожидаемый ID;
- canonical target находится внутри allowlisted root;
- temporary file создаётся на том же filesystem;
- final rename atomic.

## 11. SMTP

SMTP relay и credentials добавляются только на target:

```ini
DOCOMATOR_SMTP_ENABLED=true
DOCOMATOR_SMTP_HOST=mail.internal.example
DOCOMATOR_SMTP_PORT=25
DOCOMATOR_SMTP_SECURE=false
```

Файл `/etc/docomator/docomator.env` должен иметь режим `0640`, owner `root`, group `docomator`.

## 12. Проверка

До переноса в закрытый контур рекомендуется выполнить полный network-free smoke test извлечённого bundle:

```bash
sudo scripts/offline/smoke-test.sh \
  offline-bundles/docomator-<version>-linux-<arch>
```

Тест выполняет установку и update в временные каталоги, запускает bundled API, проверяет `/readyz`, наличие БД, symlink и pre-update backup. Он не изменяет systemd.

Проверка штатной установки:

```bash
sudo systemctl status docomator-api docomator-worker docomator-llm
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/readyz
journalctl -u docomator-api -u docomator-worker -u docomator-llm --since today
```

Проверка migration history:

```bash
sqlite3 /var/lib/docomator/docomator.db \
  'select name, checksum, applied_at from schema_migrations order by name;'
```

## 13. Ручной rollback

Installer делает rollback автоматически при failed health-check. Для ручного восстановления:

1. остановить services;
2. переключить `current` на прежнюю release-directory;
3. восстановить БД и config из `pre-update-*`;
4. выполнить `systemctl daemon-reload`;
5. запустить services и проверить `/readyz`.

Не запускайте старый код на новой несовместимой схеме без восстановления database backup.
