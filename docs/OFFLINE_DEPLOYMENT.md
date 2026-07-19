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
├── RELEASE_NOTES.md
├── SUPPORT_MATRIX.md
├── release.json
├── manifest.sha256
├── manifest.symlinks
├── install.sh
├── update.sh
├── verify-bundle.sh
├── smoke-test.sh
├── target-release-gate.sh
├── lib.sh
├── healthcheck.mjs
├── http-check.mjs
├── verify-release.mjs
└── payload/
    ├── app/
    │   ├── apps/*/dist
    │   ├── packages/*/dist
    │   ├── node_modules
    │   ├── migrations
    │   ├── scripts/runtime
    │   ├── scripts/ci/{release-gate,release-gate-crash-worker,libreoffice-release-gate}.mjs
    │   └── examples/
    │       ├── README.md
    │       ├── manifest.sha256
    │       ├── data
    │       ├── templates
    │       └── expected
    ├── runtime/
    │   ├── node/
    │   └── llama/llama-server
    ├── models/*.gguf
    ├── deploy/systemd/
    ├── config/docomator.env.example
    └── os-packages/
        ├── manifest.sha256
        ├── packages.tsv
        ├── source-os.env
        └── *.deb
```

`RELEASE_NOTES.md` содержит тот же честный перечень реализованного объёма и незакрытых ограничений, который опубликован в репозитории; соседний `SUPPORT_MATRIX.md` оставляет кандидатные платформы в состоянии `не проверено` до фактических актов. Verifier требует оба файла и их точные контрольные суммы, поэтому локальная ссылка из примечаний на матрицу остаётся рабочей и не может незаметно указывать на отсутствующее свидетельство. `manifest.sha256` покрывает все обычные файлы, кроме самого корневого manifest, включая вложенные manifests и manifest символических ссылок. `manifest.symlinks` фиксирует точный относительный target каждой разрешённой ссылки; ссылка наружу, добавленный файл или объект неподдерживаемого типа блокируют проверку. Для каждого `.deb` verifier дополнительно сверяет checksum, имя, версию и архитектуру через `dpkg-deb`; `release.json` связывает preview-профиль, пределы преобразования и SHA package inventory. Перед package-manager preflight installer требует точного совпадения `ID`, `VERSION_ID` и Debian-архитектуры target с `source-os.env`.

## Помощник первого запуска

В автономный комплект входит `first-run.sh`. После успешной установки он показывает адрес веб-интерфейса и русскоязычный порядок первоначальной настройки:

```text
пространство → участники → аудитория → проверка шаблона
→ поле → пробное заполнение → PDF → активация
```

Помощник также показывает путь `/opt/docomator/current/app/examples` с вымышленными данными, безопасными шаблонами и заполненными вариантами. Он не обращается в Интернет и не изменяет бизнес-данные. Повторный запуск:

```bash
sudo /opt/docomator/current/first-run.sh \
  --config /etc/docomator/docomator.env \
  --check
```

## 2.1. Проверка модуля приёма документов

Автономный комплект содержит рабочую область `packages/document-intake`, веб-модуль проверки и все его зависимости. После установки локальная проверка подтверждает доступность экрана «Шаблоны» и файла `/ui/document-intake.js` без обращения к внешним ресурсам.

## 3. Подготовка OS packages

Выполняется на чистой подключённой VM с той же редакцией ОС:

```bash
sudo scripts/offline/collect-os-packages.sh --apt-update
```

Список задаётся в [`config/os-packages.txt`](../config/os-packages.txt). Сборщик создаёт точный `manifest.sha256`, `packages.tsv` с Debian metadata и `source-os.env` с выпуском reference VM и архитектурой. Набор с повтором имени пакета, другой архитектурой или несовпадающим metadata не принимается.

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
  --with-preview \
  --os-packages-dir offline-bundles/os-packages
```

Script:

1. загружает официальный Node.js, указанный в `.node-version`, либо использует переданный runtime;
2. проверяет checksum Node archive;
3. выполняет `npm ci`, `npm run check` и отдельную обязательную проверку примеров даже при `--skip-tests`;
4. собирает production workspaces;
5. выполняет `npm ci --omit=dev` в payload;
6. добавляет точный проверенный список учебных примеров, `llama-server`, модель, целевые gate-скрипты и проверенный набор `.deb` выбранного профиля;
7. создаёт release metadata с preview-профилем и SHA package inventory, общий SHA-256 manifest и manifest символических ссылок;
8. повторно проверяет bundle;
9. создаёт `.tar.gz`.

### Bundle с заранее распакованным Node.js

```bash
scripts/offline/prepare-bundle.sh \
  --node-runtime-dir /srv/runtime/node-v24.18.0-linux-x64 \
  --llama-server /srv/runtime/llama-server \
  --model /srv/models/model.gguf \
  --with-preview \
  --os-packages-dir /srv/docomator-os-packages
```

### Bundle с локальным Node archive

```bash
scripts/offline/prepare-bundle.sh \
  --node-archive /srv/cache/node-v24.18.0-linux-x64.tar.xz \
  --node-sha256 '<expected-sha256>' \
  --llama-server /srv/runtime/llama-server \
  --model /srv/models/model.gguf \
  --with-preview \
  --os-packages-dir /srv/docomator-os-packages
```

### Явно без LLM

Для теста детерминированного ядра:

```bash
scripts/offline/prepare-bundle.sh --without-llm --without-preview
```

Script не создаёт молча неполный bundle: требуется либо пара `--llama-server`/`--model`, либо `--without-llm`, а также ровно один из профилей `--with-preview`/`--without-preview`. Preview-профиль требует `--os-packages-dir` и наличие `libreoffice-core`, `libreoffice-writer`, `libreoffice-calc`. Профиль без preview записывает `DOCOMATOR_PREVIEW_ENABLED=false` в новый шаблон и предназначен только для явно согласованного развёртывания без PDF-предпросмотра.

## 5. Перенос

Рекомендуется переносить:

```text
bundle tar.gz
отдельный SHA-256 tar.gz
подписанный release manifest организации
акт антивирусной/контрольной проверки
```

`prepare-bundle.sh` создаёт файл `<archive>.sha256`, но соседний checksum сам по себе не является источником доверия. До любой команды `sudo` оператор обязан получить ожидаемый SHA-256 из проверенного подписанного release manifest организации по независимому каналу. Несовпадение останавливает установку.

До привилегированной распаковки выполните preflight обычным пользователем в новом временном каталоге. GNU tar не получает root-права, а внутренний verifier проверяет точный inventory, типы объектов, checksum и цели ссылок. Только затем те же байты копируются в новый root-owned каталог, их зафиксированный SHA-256 проверяется повторно и распаковывается защищённая копия. Вся процедура находится в одном fail-fast subshell: ошибка любого шага делает последующие привилегированные команды недостижимыми. Уникальный каталог нельзя переиспользовать между попытками.

```bash
(
  set -Eeuo pipefail
  BUNDLE_NAME='docomator-<version>-linux-<arch>'
  [[ "$BUNDLE_NAME" =~ ^docomator-[A-Za-z0-9._-]+-linux-(x64|arm64)$ ]] || exit 2
  ARCHIVE="${BUNDLE_NAME}.tar.gz"
  EXPECTED_SHA256='<SHA-256 из проверенного подписанного release manifest>'
  [[ "$EXPECTED_SHA256" =~ ^[a-f0-9]{64}$ ]] || exit 2
  PREFLIGHT_DIR="$(mktemp -d)"
  cleanup() { rm -rf "$PREFLIGHT_DIR"; }
  trap cleanup EXIT

  printf '%s  %s\n' "$EXPECTED_SHA256" "$ARCHIVE" \
    | sha256sum --check --strict -
  tar --no-same-owner --no-same-permissions -xzf "$ARCHIVE" \
    -C "$PREFLIGHT_DIR"
  "$PREFLIGHT_DIR/$BUNDLE_NAME/verify-bundle.sh" \
    "$PREFLIGHT_DIR/$BUNDLE_NAME"

  STAGE="$(sudo mktemp -d /var/tmp/docomator-install.XXXXXX)"
  sudo install -o root -g root -m 0600 \
    "$ARCHIVE" "$STAGE/bundle.tar.gz"
  printf '%s  %s\n' "$EXPECTED_SHA256" "$STAGE/bundle.tar.gz" \
    | sudo sha256sum --check --strict -
  sudo tar --no-same-owner --no-same-permissions \
    -xzf "$STAGE/bundle.tar.gz" -C "$STAGE"
  BUNDLE_ROOT="$(sudo realpath "$STAGE/$BUNDLE_NAME")"
  [[ "$BUNDLE_ROOT" == "$STAGE/$BUNDLE_NAME" ]] || exit 2
  sudo find "$BUNDLE_ROOT" ! -type l -exec chmod go-w {} +
  sudo "$BUNDLE_ROOT/verify-bundle.sh" "$BUNDLE_ROOT"
  printf 'Проверенный каталог комплекта: %s\n' "$BUNDLE_ROOT"
)
```

Installer повторно проверяет владельца и режим каждого объекта, всю цепочку родительских каталогов и внутренние manifests.

## 6. Новая установка

```bash
set -Eeuo pipefail
BUNDLE_ROOT='<проверенный каталог из успешного сообщения подготовки>'
sudo "$BUNDLE_ROOT/install.sh" --install-os-packages
```

Без установки `.deb` можно продолжить, только если настроенный LibreOffice уже доступен. При включённом preview и отсутствующем executable installer останавливается до установки приложения и предлагает `--install-os-packages`:

```bash
sudo "$BUNDLE_ROOT/install.sh"
```

Установить unit-файлы и выполнить миграции, но не запускать services:

```bash
sudo "$BUNDLE_ROOT/install.sh" --no-start
```

Для проверочного chroot/container-сценария без установки unit-файлов:

```bash
sudo "$BUNDLE_ROOT/install.sh" --no-systemd
```

`--no-systemd` предназначен для smoke-теста и нестандартной интеграции с внешним service manager. В штатной Debian/Astra Linux установке используется systemd.

`--install-os-packages` разрешён только при первой установке, когда прежнего application release ещё нет. Сначала `apt-get --simulate --no-remove` проверяет план: каждый устанавливаемый пакет должен присутствовать в подписанном inventory. Реальная команда использует `--no-download --no-remove`, поэтому не обращается к repository и не удаляет системные пакеты. Если package closure неполон, установка приложения не начинается.

Системный package manager не является частью SQLite/application rollback. Поэтому первый прогон выполняется на чистой VM со snapshot до установки. Если maintainer script `.deb` аварийно завершится уже после начала package phase, VM возвращается к этому snapshot; повторный запуск поверх незавершённого состояния блокируется через `dpkg --audit`. Для действующей установки package phase через Docomator запрещена полностью.

Custom paths:

```bash
sudo "$BUNDLE_ROOT/install.sh" \
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

Для нового архива обязательны та же проверка SHA-256 из подписанного manifest, непривилегированный preflight и повторная проверка root-owned копии. Не используйте каталог предыдущей установки:

```bash
(
  set -Eeuo pipefail
  UPDATE_BUNDLE_NAME='docomator-NEW-linux-x64'
  [[ "$UPDATE_BUNDLE_NAME" =~ ^docomator-[A-Za-z0-9._-]+-linux-(x64|arm64)$ ]] || exit 2
  UPDATE_ARCHIVE="${UPDATE_BUNDLE_NAME}.tar.gz"
  UPDATE_SHA256='<SHA-256 из проверенного подписанного release manifest>'
  [[ "$UPDATE_SHA256" =~ ^[a-f0-9]{64}$ ]] || exit 2
  UPDATE_PREFLIGHT="$(mktemp -d)"
  cleanup() { rm -rf "$UPDATE_PREFLIGHT"; }
  trap cleanup EXIT

  printf '%s  %s\n' "$UPDATE_SHA256" "$UPDATE_ARCHIVE" \
    | sha256sum --check --strict -
  tar --no-same-owner --no-same-permissions -xzf "$UPDATE_ARCHIVE" \
    -C "$UPDATE_PREFLIGHT"
  "$UPDATE_PREFLIGHT/$UPDATE_BUNDLE_NAME/verify-bundle.sh" \
    "$UPDATE_PREFLIGHT/$UPDATE_BUNDLE_NAME"

  UPDATE_STAGE="$(sudo mktemp -d /var/tmp/docomator-update.XXXXXX)"
  sudo install -o root -g root -m 0600 \
    "$UPDATE_ARCHIVE" "$UPDATE_STAGE/bundle.tar.gz"
  printf '%s  %s\n' "$UPDATE_SHA256" "$UPDATE_STAGE/bundle.tar.gz" \
    | sudo sha256sum --check --strict -
  sudo tar --no-same-owner --no-same-permissions \
    -xzf "$UPDATE_STAGE/bundle.tar.gz" -C "$UPDATE_STAGE"
  UPDATE_BUNDLE_ROOT="$(sudo realpath "$UPDATE_STAGE/$UPDATE_BUNDLE_NAME")"
  [[ "$UPDATE_BUNDLE_ROOT" == "$UPDATE_STAGE/$UPDATE_BUNDLE_NAME" ]] || exit 2
  sudo find "$UPDATE_BUNDLE_ROOT" ! -type l -exec chmod go-w {} +
  sudo "$UPDATE_BUNDLE_ROOT/update.sh"
)
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

Пакеты ОС не входят в транзакцию приложения и не обновляются через `update.sh`. Если согласованный выпуск LibreOffice меняется, оператор сначала создаёт snapshot/backup ОС и применяет новый замкнутый `.deb`-набор отдельной утверждённой процедурой, проверяет converter, и лишь затем запускает `update.sh` без `--install-os-packages`. Installer отказывает в совмещении этих операций, чтобы application rollback не оставлял старый код с неоткаченными системными пакетами.

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

## 9.1. Предварительный просмотр LibreOffice

Параметры:

```ini
DOCOMATOR_PREVIEW_ENABLED=true
DOCOMATOR_LIBREOFFICE_BIN=/usr/bin/libreoffice
DOCOMATOR_PREVIEW_TIMEOUT_MS=120000
DOCOMATOR_PREVIEW_MAX_BYTES=134217728
```

Автономный набор пакетов должен включать `libreoffice-core`, `libreoffice-writer` и `libreoffice-calc` для той же редакции ОС. `first-run.sh --check` сообщает, доступен ли настроенный исполняемый файл.

Фоновый обработчик создаёт отдельный временный профиль и очищает его после преобразования. PDF проверяется до сохранения. Отсутствующий LibreOffice либо ошибка преобразования не повреждают пробную копию и дают пользователю явный повтор.

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

На чистом target сначала установите пакетные prerequisites штатным `install.sh --install-os-packages` либо убедитесь, что согласованный LibreOffice уже доступен. Затем выполните полный network-free smoke test непосредственно из извлечённого bundle:

```bash
sudo "$BUNDLE_ROOT/smoke-test.sh" "$BUNDLE_ROOT"
```

Тест выполняет установку и обновление во временные каталоги, запускает встроенную службу API, проверяет `/readyz` встроенным Node.js без внешнего `curl`, схему БД, интерфейс предварительного просмотра/активации, доступность настроенного LibreOffice, символическую ссылку, неизменяемые учебные примеры и резервную копию перед обновлением. Он не изменяет systemd.

Core gate и обязательное реальное преобразование DOCX/XLSX для preview-профиля также запускаются только файлами из bundle, без `npm ci` и registry:

```bash
"$BUNDLE_ROOT/target-release-gate.sh" \
  --config /etc/docomator/docomator.env
```

Целевые сочетания ОС, glibc, Node.js и LibreOffice фиксируются в [матрице совместимости](SUPPORT_MATRIX.md). Пустая строка или статус `не проверено` не считаются заявлением о поддержке.

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
