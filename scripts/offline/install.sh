#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

BUNDLE_ROOT="$SCRIPT_DIR"
INSTALL_ROOT="/opt/docomator"
DATA_DIR="/var/lib/docomator"
CONFIG_DIR="/etc/docomator"
DOCOMATOR_USER="docomator"
DOCOMATOR_GROUP="docomator"
NO_START=0
INSTALL_OS_PACKAGES=0
UPGRADE=0
INSTALL_SYSTEMD=1

usage() {
  cat <<'USAGE'
Использование: ./install.sh [параметры]

Устанавливает проверенный автономный комплект Docomator. Сценарий не обращается
к сети. Для существующей установки используйте update.sh.

Параметры:
  --bundle-root DIR        Extracted bundle directory (default: script directory)
  --install-root DIR       Release root (default: /opt/docomator)
  --data-dir DIR           Persistent data directory (default: /var/lib/docomator)
  --config-dir DIR         Configuration directory (default: /etc/docomator)
  --user NAME              Service user (default: docomator)
  --group NAME             Service group (default: docomator)
  --install-os-packages    Install bundled .deb packages before the application
  --no-start               Install units and migrate, but do not enable/start services
  --no-systemd             Skip unit installation and service control (test/chroot mode)
  --upgrade                Internal flag used by update.sh
  -h, --help               Show this help
USAGE
}

while (($# > 0)); do
  case "$1" in
    --bundle-root) BUNDLE_ROOT="$2"; shift 2 ;;
    --install-root) INSTALL_ROOT="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --user) DOCOMATOR_USER="$2"; shift 2 ;;
    --group) DOCOMATOR_GROUP="$2"; shift 2 ;;
    --install-os-packages) INSTALL_OS_PACKAGES=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --no-systemd) INSTALL_SYSTEMD=0; NO_START=1; shift ;;
    --upgrade) UPGRADE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done

require_root
require_command sha256sum
require_command sed
require_command cp
require_command mv
require_command ln
require_command cmp
require_command stat

BUNDLE_ROOT="$(absolute_path "$BUNDLE_ROOT")"
require_trusted_bundle "$SCRIPT_DIR"
[[ "$BUNDLE_ROOT" == "$SCRIPT_DIR" ]] || require_trusted_bundle "$BUNDLE_ROOT"
"$BUNDLE_ROOT/verify-bundle.sh" "$BUNDLE_ROOT"
VERSION="$(<"$BUNDLE_ROOT/VERSION")"
INSTALL_ROOT="$(mkdir -p "$INSTALL_ROOT" && absolute_path "$INSTALL_ROOT")"
mkdir -p "$DATA_DIR" "$CONFIG_DIR"
DATA_DIR="$(absolute_path "$DATA_DIR")"
CONFIG_DIR="$(absolute_path "$CONFIG_DIR")"
RELEASES_DIR="$INSTALL_ROOT/releases"
RELEASE_DIR="$RELEASES_DIR/$VERSION"
CURRENT_LINK="$INSTALL_ROOT/current"
CONFIG_FILE="$CONFIG_DIR/docomator.env"
DATABASE_PATH="$DATA_DIR/docomator.db"

if ((UPGRADE == 1)) && [[ ! -L "$CURRENT_LINK" ]]; then
  die "Не найдена существующая установка Docomator: $CURRENT_LINK"
fi

if ((INSTALL_OS_PACKAGES == 1)); then
  mapfile -d '' debs < <(find "$BUNDLE_ROOT/payload/os-packages" -maxdepth 1 -type f -name '*.deb' -print0 | sort -z)
  ((${#debs[@]} > 0)) || die "В комплекте нет пакетов .deb"
  require_command dpkg
  info "Устанавливаем пакеты ОС из комплекта: ${#debs[@]}"
  if ! dpkg -i "${debs[@]}"; then
    require_command apt-get
    APT_CACHE="$(mktemp -d "/tmp/docomator-apt.XXXXXX")"
    trap 'rm -rf "${APT_CACHE:-}"' EXIT
    mkdir -p "$APT_CACHE/partial"
    cp "${debs[@]}" "$APT_CACHE/"
    apt-get -o "Dir::Cache::archives=$APT_CACHE" --no-download --fix-broken install -y
  fi
fi

if ! getent group "$DOCOMATOR_GROUP" >/dev/null 2>&1; then
  groupadd --system "$DOCOMATOR_GROUP"
fi

if ! id "$DOCOMATOR_USER" >/dev/null 2>&1; then
  NOLOGIN_SHELL="/usr/sbin/nologin"
  [[ -x "$NOLOGIN_SHELL" ]] || NOLOGIN_SHELL="/bin/false"
  useradd --system --gid "$DOCOMATOR_GROUP" --home-dir "$DATA_DIR" \
    --shell "$NOLOGIN_SHELL" "$DOCOMATOR_USER"
fi

mkdir -p \
  "$RELEASES_DIR" \
  "$DATA_DIR/objects" \
  "$DATA_DIR/models" \
  "$DATA_DIR/previews" \
  "$DATA_DIR/backups" \
  "$DATA_DIR/tmp" \
  "$DATA_DIR/logs"
chown -R "$DOCOMATOR_USER:$DOCOMATOR_GROUP" "$DATA_DIR"
chmod 0750 "$DATA_DIR" "$DATA_DIR"/{objects,models,previews,backups,tmp,logs}

NEW_CONFIG=0
if [[ ! -f "$CONFIG_FILE" ]]; then
  cp "$BUNDLE_ROOT/payload/config/docomator.env.example" "$CONFIG_FILE"
  chmod 0640 "$CONFIG_FILE"
  chown root:"$DOCOMATOR_GROUP" "$CONFIG_FILE"
  NEW_CONFIG=1
fi
replace_env_value "$CONFIG_FILE" DOCOMATOR_VERSION "$VERSION"
replace_env_value "$CONFIG_FILE" DOCOMATOR_DATA_DIR "$DATA_DIR"

if [[ "$(read_env_value "$CONFIG_FILE" DOCOMATOR_SESSION_SECRET)" == "CHANGE_ME_DURING_INSTALL" || -z "$(read_env_value "$CONFIG_FILE" DOCOMATOR_SESSION_SECRET)" ]]; then
  replace_env_value "$CONFIG_FILE" DOCOMATOR_SESSION_SECRET "$(random_secret)"
fi

mapfile -d '' bundled_models < <(find "$BUNDLE_ROOT/payload/models" -maxdepth 1 -type f -print0 | sort -z)
if ((${#bundled_models[@]} > 0)); then
  for model in "${bundled_models[@]}"; do
    destination="$DATA_DIR/models/$(basename "$model")"
    if [[ -f "$destination" && "$(sha256_of "$destination")" == "$(sha256_of "$model")" ]]; then
      info "Модель уже установлена: $destination"
      continue
    fi
    temporary="$destination.tmp.$$"
    cp "$model" "$temporary"
    chown "$DOCOMATOR_USER:$DOCOMATOR_GROUP" "$temporary"
    chmod 0640 "$temporary"
    mv -f "$temporary" "$destination"
  done
  replace_env_value "$CONFIG_FILE" DOCOMATOR_LLM_MODEL "$DATA_DIR/models/$(basename "${bundled_models[0]}")"
  if ((NEW_CONFIG == 1)); then
    replace_env_value "$CONFIG_FILE" DOCOMATOR_LLM_ENABLED true
  fi
fi

OLD_TARGET=""
if [[ -L "$CURRENT_LINK" ]]; then
  OLD_TARGET="$(readlink -f "$CURRENT_LINK")"
fi

BACKUP_DIR=""
DATABASE_EXISTED=0
if [[ -n "$OLD_TARGET" ]]; then
  if ((INSTALL_SYSTEMD == 1)); then
    stop_docomator_services
  fi
  BACKUP_DIR="$DATA_DIR/backups/pre-update-$(date -u +'%Y%m%dT%H%M%SZ')-$VERSION-$$"
  mkdir -p "$BACKUP_DIR"
  cp -a "$CONFIG_FILE" "$BACKUP_DIR/docomator.env"
  if [[ -f "$DATABASE_PATH" ]]; then
    DATABASE_EXISTED=1
    for suffix in '' '-wal' '-shm'; do
      [[ -f "$DATABASE_PATH$suffix" ]] && cp -a "$DATABASE_PATH$suffix" "$BACKUP_DIR/"
    done
  fi
  chown -R "$DOCOMATOR_USER:$DOCOMATOR_GROUP" "$BACKUP_DIR"
  info "Резервная копия перед обновлением создана: $BACKUP_DIR"
fi

rollback() {
  warn "Возвращаем прежнее состояние после ошибки установки или обновления"
  if ((INSTALL_SYSTEMD == 1)); then
    stop_docomator_services
  fi

  if [[ -n "$OLD_TARGET" ]]; then
    ln -sfn "$OLD_TARGET" "$INSTALL_ROOT/.current.rollback.$$"
    mv -Tf "$INSTALL_ROOT/.current.rollback.$$" "$CURRENT_LINK"
  else
    rm -f "$CURRENT_LINK"
  fi

  if [[ -n "$BACKUP_DIR" ]]; then
    rm -f "$DATABASE_PATH" "$DATABASE_PATH-wal" "$DATABASE_PATH-shm"
    if ((DATABASE_EXISTED == 1)); then
      for source in "$BACKUP_DIR"/docomator.db*; do
        [[ -e "$source" ]] || continue
        cp -a "$source" "$DATA_DIR/"
      done
    fi
    cp -a "$BACKUP_DIR/docomator.env" "$CONFIG_FILE"
  elif ((DATABASE_EXISTED == 0)); then
    rm -f "$DATABASE_PATH" "$DATABASE_PATH-wal" "$DATABASE_PATH-shm"
  fi

  if [[ -n "$OLD_TARGET" && $NO_START -eq 0 && $INSTALL_SYSTEMD -eq 1 ]] && command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload
    systemctl start docomator-llm.service 2>/dev/null || true
    systemctl start docomator-api.service docomator-worker.service 2>/dev/null || true
    BACKUP_ENABLED="$(read_env_value "$CONFIG_FILE" DOCOMATOR_BACKUP_ENABLED)"
    if [[ -z "$BACKUP_ENABLED" || "${BACKUP_ENABLED,,}" == "true" || "$BACKUP_ENABLED" == "1" ]]; then
      systemctl start docomator-backup.timer 2>/dev/null || true
    fi
  fi
}

if [[ ! -d "$RELEASE_DIR" ]]; then
  TEMP_RELEASE="$RELEASES_DIR/.${VERSION}.tmp.$$"
  rm -rf "$TEMP_RELEASE"
  mkdir -p "$TEMP_RELEASE"
  cp -a "$BUNDLE_ROOT/payload/app" "$TEMP_RELEASE/"
  cp -a "$BUNDLE_ROOT/payload/runtime" "$TEMP_RELEASE/"
  cp -a "$BUNDLE_ROOT/payload/deploy" "$TEMP_RELEASE/"
  cp "$BUNDLE_ROOT/release.json" "$TEMP_RELEASE/"
  if [[ -x "$BUNDLE_ROOT/first-run.sh" ]]; then
    cp "$BUNDLE_ROOT/first-run.sh" "$TEMP_RELEASE/first-run.sh"
    chmod 0755 "$TEMP_RELEASE/first-run.sh"
  fi
  chown -R root:root "$TEMP_RELEASE"
  chmod -R go-w "$TEMP_RELEASE"
  mv "$TEMP_RELEASE" "$RELEASE_DIR"
else
  [[ -f "$RELEASE_DIR/release.json" ]] || \
    die "Существующий каталог версии неполон: $RELEASE_DIR"
  cmp -s "$BUNDLE_ROOT/release.json" "$RELEASE_DIR/release.json" || \
    die "Версия $VERSION уже установлена с другими сведениями. Подготовьте новый номер версии."
  info "Такой же каталог версии уже существует: $RELEASE_DIR"
fi

if ! DOCOMATOR_DATA_DIR="$DATA_DIR" \
  "$RELEASE_DIR/runtime/node/bin/node" \
  "$RELEASE_DIR/app/scripts/runtime/migrate.mjs"; then
  rollback
  die "Не удалось применить изменения базы данных"
fi
chown "$DOCOMATOR_USER:$DOCOMATOR_GROUP" "$DATABASE_PATH" 2>/dev/null || true
chown "$DOCOMATOR_USER:$DOCOMATOR_GROUP" "$DATABASE_PATH-wal" "$DATABASE_PATH-shm" 2>/dev/null || true

ln -sfn "$RELEASE_DIR" "$INSTALL_ROOT/.current.new.$$"
mv -Tf "$INSTALL_ROOT/.current.new.$$" "$CURRENT_LINK"

if ((INSTALL_SYSTEMD == 1)); then
  require_command systemctl
  for unit in docomator-api docomator-worker docomator-llm docomator-backup; do
    render_template \
      "$RELEASE_DIR/deploy/systemd/${unit}.service.in" \
      "/etc/systemd/system/${unit}.service" \
      "$INSTALL_ROOT" "$DATA_DIR" "$CONFIG_DIR" \
      "$DOCOMATOR_USER" "$DOCOMATOR_GROUP"
  done
  render_template \
    "$RELEASE_DIR/deploy/systemd/docomator-backup.timer.in" \
    "/etc/systemd/system/docomator-backup.timer" \
    "$INSTALL_ROOT" "$DATA_DIR" "$CONFIG_DIR" \
    "$DOCOMATOR_USER" "$DOCOMATOR_GROUP"
  systemctl daemon-reload
else
  info "Пропускаем установку служб systemd и управление ими"
fi

if ((NO_START == 0)); then
  command -v systemctl >/dev/null 2>&1 || {
    rollback
    die "Требуется systemd; для установки без запуска используйте --no-start"
  }

  systemctl enable docomator-api.service docomator-worker.service

  LLM_ENABLED="$(read_env_value "$CONFIG_FILE" DOCOMATOR_LLM_ENABLED)"
  LLM_MODEL="$(read_env_value "$CONFIG_FILE" DOCOMATOR_LLM_MODEL)"
  if [[ "$LLM_ENABLED" == "true" && -x "$CURRENT_LINK/runtime/llama/llama-server" && -f "$LLM_MODEL" ]]; then
    systemctl enable --now docomator-llm.service
  else
    systemctl disable --now docomator-llm.service 2>/dev/null || true
  fi

  BACKUP_ENABLED="$(read_env_value "$CONFIG_FILE" DOCOMATOR_BACKUP_ENABLED)"
  if [[ -z "$BACKUP_ENABLED" || "${BACKUP_ENABLED,,}" == "true" || "$BACKUP_ENABLED" == "1" ]]; then
    systemctl enable --now docomator-backup.timer
  else
    systemctl disable --now docomator-backup.timer 2>/dev/null || true
  fi

  if ! systemctl restart docomator-api.service docomator-worker.service; then
    rollback
    die "Не удалось запустить службы Docomator"
  fi

  HOST="$(read_env_value "$CONFIG_FILE" DOCOMATOR_HOST)"
  PORT="$(read_env_value "$CONFIG_FILE" DOCOMATOR_PORT)"
  [[ -n "$HOST" ]] || HOST="127.0.0.1"
  [[ "$HOST" == "0.0.0.0" || "$HOST" == "::" ]] && HOST="127.0.0.1"
  [[ -n "$PORT" ]] || PORT="8080"
  HEALTH_URL="http://${HOST}:${PORT}/readyz"

  HEALTHY=0
  for _ in $(seq 1 30); do
    if "$CURRENT_LINK/runtime/node/bin/node" "$BUNDLE_ROOT/healthcheck.mjs" "$HEALTH_URL" 3000 >/dev/null 2>&1; then
      HEALTHY=1
      break
    fi
    sleep 1
  done

  if ((HEALTHY == 0)); then
    systemctl status docomator-api.service --no-pager >&2 || true
    rollback
    die "Проверка готовности после установки завершилась ошибкой"
  fi
fi

info "Docomator $VERSION успешно установлен"
info "Текущая версия: $(readlink -f "$CURRENT_LINK")"
info "Файл настроек: $CONFIG_FILE"
info "Постоянные данные: $DATA_DIR"

if [[ -x "$CURRENT_LINK/first-run.sh" ]]; then
  "$CURRENT_LINK/first-run.sh" --config "$CONFIG_FILE"
fi
