# Автономная поставка, установка и обновление

## 1. Принцип

Offline bundle собирается на подключённой reference VM и переносится в закрытый контур как проверенный `.tar.gz`. Target-side `verify/install/update/rollback` не используют сеть.

Reference VM должна соответствовать target по CPU architecture, совместимой glibc и конкретному Debian/Astra release для `.deb` inventory. Нативные binaries нельзя собирать с CPU instructions, отсутствующими на target.

## 2. Состав bundle

Корень содержит:

```text
VERSION
release.json
RELEASE_NOTES.md
SUPPORT_MATRIX.md
manifest.sha256
manifest.symlinks
verify-bundle.sh
install.sh
update.sh
backup.sh
restore.sh
first-run.sh
set-access-code.sh
reset-access-code.sh
set-password.sh          # compatibility wrapper only
reset-password.sh        # compatibility wrapper only
smoke-test.sh
target-release-gate.sh
target-acceptance.sh
ux-acceptance-gate.sh
ux-acceptance-gate.mjs
healthcheck.mjs
http-check.mjs
lib.sh
payload/
```

`payload/app` содержит production workspaces/dist, migrations, runtime scripts, docs, examples и production `node_modules`. `payload/runtime` содержит Node.js и опциональный `llama-server`; `payload/models` — опциональную GGUF model; `payload/deploy` — systemd templates; `payload/config` — новый `docomator.env.example`; `payload/os-packages` — замкнутый target-specific `.deb` set. QA Playwright/axe размещается отдельно в `payload/acceptance/ux` и не устанавливается как production dependency.

`manifest.sha256` покрывает обычные файлы, `manifest.symlinks` — разрешённые относительные symlinks. Added/missing file, unsupported object, absolute/out-of-root symlink или checksum mismatch блокирует установку.

## 3. Access-code contract bundle

Новая конфигурация содержит:

```text
DOCOMATOR_ACCESS_CODE_HASH=
DOCOMATOR_SESSION_SECRET=
DOCOMATOR_SESSION_TTL_SECONDS=28800
```

Install создаёт случайный session secret, но не придумывает код. Рабочая область остаётся закрытой до первого browser setup из четырёх цифр.

Canonical helpers:

```bash
sudo /opt/docomator/current/set-access-code.sh
sudo /opt/docomator/current/reset-access-code.sh
sudo /opt/docomator/current/first-run.sh --reset-code
```

`set-password.sh`/`reset-password.sh` поставляются только как compatibility wrappers для ранее написанных operator scripts. Новая автоматизация их не использует.

## 4. OS package set

На чистой connected VM той же ОС:

```bash
sudo scripts/offline/collect-os-packages.sh --apt-update
```

Создаются `manifest.sha256`, `packages.tsv`, `requested-packages.txt`, `source-os.env` и `.deb`. Набор обязан иметь `DEPENDENCY_CLOSURE=full`, точные `OS_ID`, `VERSION_ID`, Debian architecture и checksum исходного package list.

Debian и Astra package sets не взаимозаменяемы. Update OS packages не входит в транзакцию application update и выполняется отдельно по утверждённой системной процедуре со snapshot/rollback ОС.

## 5. Сборка application bundle

Полный Debian example:

```bash
scripts/offline/prepare-bundle.sh \
  --target-profile debian \
  --llama-server /srv/build/llama.cpp/llama-server \
  --model /srv/models/model.gguf \
  --with-preview \
  --with-ux-acceptance \
  --os-packages-dir /srv/docomator-os-packages
```

Astra собирается на native Astra reference VM с явным Chromium package/path при отличии от Debian defaults.

Deterministic core без LLM/preview/UX acceptance допускается только явно:

```bash
scripts/offline/prepare-bundle.sh \
  --without-llm \
  --without-preview \
  --without-ux-acceptance
```

Builder выполняет `npm ci`, полный `npm run check` (если не указан диагностический `--skip-tests`), проверку examples, production install dependencies, release metadata/manifest, затем повторно проверяет готовый bundle.

## 6. Перенос и preflight

Переносите archive + independently trusted SHA-256/release manifest. Соседний `.sha256` без доверенного канала не является trust anchor.

До `sudo` распакуйте archive обычным пользователем в новый directory и выполните `verify-bundle.sh`. После переноса в root-owned location повторно сверяйте те же bytes/checksum. Bundle path/object ownership/mode не должен позволять подмену другим пользователем.

## 7. Чистая установка

```bash
sudo ./install.sh --install-os-packages
```

Установка:

1. проверяет bundle/OS profile;
2. при необходимости устанавливает только bundled `.deb` без network download;
3. создаёт service user/group и persistent directories;
4. создаёт `/etc/docomator/docomator.env` из canonical template;
5. устанавливает immutable `/opt/docomator/releases/<version>`;
6. создаёт session secret;
7. применяет migrations;
8. атомарно переключает `/opt/docomator/current`;
9. устанавливает/запускает systemd units;
10. проверяет `/readyz`;
11. запускает `first-run.sh`.

Первый browser visit открывает `/access` и предлагает четыре цифры. Username/password не нужны.

## 8. Обновление

`update.sh` использует тот же verified bundle и существующую конфигурацию. Перед миграцией создаётся pre-update backup DB/config. Новый release устанавливается в отдельный immutable directory; `current` переключается атомарно только внутри транзакционного install flow.

При failed migration/start/readiness rollback возвращает прежний symlink и backup DB/config. Existing data, object store, code credential и session secret не должны теряться.

Fresh config больше не содержит legacy password key. При upgrade runtime может прочитать старый key для перехода; первый canonical code reset записывает `DOCOMATOR_ACCESS_CODE_HASH` и синхронизирует старый key только если он уже существовал для rollback.

## 9. Первый запуск и диагностика

```bash
sudo /opt/docomator/current/first-run.sh --check
```

Помощник показывает URL, code recovery, readiness, LibreOffice, backup timer, network delivery и SMTP status. Он не требует Internet.

## 10. Target acceptance

Код передаётся только через ordinary file текущего пользователя с mode `0600`:

```bash
install -m 0600 /dev/null "$HOME/.docomator-acceptance-code"
printf '%s\n' '0427' > "$HOME/.docomator-acceptance-code"

"$BUNDLE_ROOT/target-acceptance.sh" \
  --config /etc/docomator/docomator.env \
  --base-url http://127.0.0.1:8080/ \
  --access-code-file "$HOME/.docomator-acceptance-code" \
  --output "$HOME/docomator-target-acts/target-01"
```

Команда fail-closed выполняет verify bundle, root smoke, target release gate, control backup, pilot check и offline Playwright/axe. Код и путь к code file не попадают в acts.

Для строгого Astra target добавляются:

```text
--require-network --require-smtp
```

После прогона временный code file удаляется оператором.

## 11. Backup/restore

Backup manifest/checksums проверяются до replacement данных. Restore выполняется только из verified copy и должен сохранять SQLite/object store/config. Credential state и session secret входят в recovery requirements, но секреты не публикуются в evidence.

Отдельный recovery act обязателен до stable: restore на другой clean machine, сверка counts/IDs/object SHA-256, reboot и продолжение API/worker.

## 12. Stable gate

Generic CI/bundle не доказывает target support. Для stable exact release требуются Debian target act, Astra 1.7 target act, real LibreOffice, ≥20 DOCX + ≥20 XLSX Office corpus, load 10/100/1000, restart/failure/recovery, P5/accessibility и `release:evidence` с пустым `openBlockers`.
