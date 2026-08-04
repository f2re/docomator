#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFLINE_LIB="$SCRIPT_DIR/../offline/lib.sh"

if [[ -f "$OFFLINE_LIB" ]]; then
  # shellcheck source=../offline/lib.sh
  source "$OFFLINE_LIB"
else
  log() {
    local level="$1"
    shift
    printf '[%s] %-6s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$level" "$*" >&2
  }
  info() { log ИНФО "$@"; }
  warn() { log ВНИМ "$@"; }
  die() { log ОШИБКА "$@"; exit 1; }
fi

INSTALL_ROOT="${DOCOMATOR_INSTALL_ROOT:-/opt/docomator}"
DATA_DIR="${DOCOMATOR_DATA_DIR:-/var/lib/docomator}"
CONFIG_DIR="${DOCOMATOR_CONFIG_DIR:-/etc/docomator}"
DOCOMATOR_USER="${DOCOMATOR_USER:-docomator}"
DOCOMATOR_GROUP="${DOCOMATOR_GROUP:-docomator}"

usage() {
  cat <<'USAGE'
Использование: scripts/runtime/service-control.sh КОМАНДА [параметры]

Управление службами Docomator и автозапуском в Astra Linux / Debian systemd.

Команды:
  start               Запустить все службы Docomator
  stop                Остановить все службы Docomator
  restart             Перезапустить службы Docomator
  status              Показать статус служб и проверку готовности
  enable-autostart    Включить автозапуск служб при загрузке системы
  disable-autostart   Отключить автозапуск служб при загрузке системы
  install-services    Установить шаблоны systemd-служб в /etc/systemd/system и включить автозапуск
  uninstall-services  Остановить, отключить автозапуск и удалить unit-файлы из /etc/systemd/system

Параметры:
  --install-root DIR  Каталог установки (по умолчанию: /opt/docomator или $DOCOMATOR_INSTALL_ROOT)
  --data-dir DIR      Каталог данных (по умолчанию: /var/lib/docomator или $DOCOMATOR_DATA_DIR)
  --config-dir DIR    Каталог конфигурации (по умолчанию: /etc/docomator или $DOCOMATOR_CONFIG_DIR)
  --user NAME         Пользователь службы (по умолчанию: docomator или $DOCOMATOR_USER)
  --group NAME        Группа службы (по умолчанию: docomator или $DOCOMATOR_GROUP)
  -h, --help          Показать эту справку
USAGE
}

COMMAND=""
while (($# > 0)); do
  case "$1" in
    start|stop|restart|status|enable-autostart|disable-autostart|install-services|uninstall-services)
      COMMAND="$1"
      shift
      ;;
    --install-root) INSTALL_ROOT="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --user) DOCOMATOR_USER="$2"; shift 2 ;;
    --group) DOCOMATOR_GROUP="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Неизвестный параметр или команда: $1" ;;
  esac
done

[[ -n "$COMMAND" ]] || { usage; exit 1; }

require_systemd() {
  command -v systemctl >/dev/null 2>&1 || die "Управление службами требует наличия systemd (systemctl)."
}

require_root_privileges() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Операции со службами systemd требуют прав root (sudo)."
}

find_templates_dir() {
  if [[ -d "$INSTALL_ROOT/current/deploy/systemd" ]]; then
    printf '%s' "$INSTALL_ROOT/current/deploy/systemd"
  elif [[ -d "$SCRIPT_DIR/../../deploy/systemd" ]]; then
    printf '%s' "$SCRIPT_DIR/../../deploy/systemd"
  else
    die "Каталог шаблонов systemd не найден в $INSTALL_ROOT/current/deploy/systemd или $SCRIPT_DIR/../../deploy/systemd"
  fi
}

get_config_file() {
  printf '%s/docomator.env' "$CONFIG_DIR"
}

is_llm_enabled() {
  local cfg
  cfg="$(get_config_file)"
  if [[ -f "$cfg" ]]; then
    local val
    val="$(grep -E "^[[:space:]]*DOCOMATOR_LLM_ENABLED=" "$cfg" | tail -n 1 | cut -d= -f2- || true)"
    [[ "$val" == "true" ]]
  else
    false
  fi
}

is_backup_enabled() {
  local cfg
  cfg="$(get_config_file)"
  if [[ -f "$cfg" ]]; then
    local val
    val="$(grep -E "^[[:space:]]*DOCOMATOR_BACKUP_ENABLED=" "$cfg" | tail -n 1 | cut -d= -f2- || true)"
    if [[ -z "$val" || "${val,,}" == "true" || "$val" == "1" ]]; then
      return 0
    fi
  fi
  return 1
}

do_install_services() {
  require_systemd
  require_root_privileges
  local tpl_dir
  tpl_dir="$(find_templates_dir)"

  info "Устанавливаем unit-файлы systemd из $tpl_dir в /etc/systemd/system"
  for unit in docomator-api docomator-worker docomator-llm docomator-backup; do
    local src="$tpl_dir/${unit}.service.in"
    local dst="/etc/systemd/system/${unit}.service"
    [[ -f "$src" ]] || die "Не найден шаблон службы: $src"
    sed \
      -e "s|@DOCOMATOR_INSTALL_ROOT@|${INSTALL_ROOT//|/\\|}|g" \
      -e "s|@DOCOMATOR_DATA_DIR@|${DATA_DIR//|/\\|}|g" \
      -e "s|@DOCOMATOR_CONFIG_DIR@|${CONFIG_DIR//|/\\|}|g" \
      -e "s|@DOCOMATOR_USER@|${DOCOMATOR_USER//|/\\|}|g" \
      -e "s|@DOCOMATOR_GROUP@|${DOCOMATOR_GROUP//|/\\|}|g" \
      "$src" > "$dst"
    chmod 0644 "$dst"
  done

  local timer_src="$tpl_dir/docomator-backup.timer.in"
  local timer_dst="/etc/systemd/system/docomator-backup.timer"
  [[ -f "$timer_src" ]] || die "Не найден шаблон таймера: $timer_src"
  sed \
    -e "s|@DOCOMATOR_INSTALL_ROOT@|${INSTALL_ROOT//|/\\|}|g" \
    -e "s|@DOCOMATOR_DATA_DIR@|${DATA_DIR//|/\\|}|g" \
    -e "s|@DOCOMATOR_CONFIG_DIR@|${CONFIG_DIR//|/\\|}|g" \
    -e "s|@DOCOMATOR_USER@|${DOCOMATOR_USER//|/\\|}|g" \
    -e "s|@DOCOMATOR_GROUP@|${DOCOMATOR_GROUP//|/\\|}|g" \
    "$timer_src" > "$timer_dst"
  chmod 0644 "$timer_dst"

  systemctl daemon-reload
  info "Unit-файлы systemd успешно установлены."
  do_enable_autostart
}

do_uninstall_services() {
  require_systemd
  require_root_privileges
  info "Отключаем и удаляем unit-файлы systemd Docomator"
  do_stop
  systemctl disable docomator-api.service docomator-worker.service docomator-llm.service docomator-backup.timer docomator-backup.service 2>/dev/null || true

  rm -f /etc/systemd/system/docomator-api.service \
        /etc/systemd/system/docomator-worker.service \
        /etc/systemd/system/docomator-llm.service \
        /etc/systemd/system/docomator-backup.service \
        /etc/systemd/system/docomator-backup.timer

  systemctl daemon-reload
  info "Службы Docomator успешно удалены из systemd."
}

do_enable_autostart() {
  require_systemd
  require_root_privileges
  info "Включаем автозапуск служб Docomator при старте системы"
  systemctl enable docomator-api.service docomator-worker.service

  if is_llm_enabled; then
    info "Локальная модель включена в конфигурации: включаем docomator-llm.service"
    systemctl enable docomator-llm.service
  else
    info "Локальная модель отключена в конфигурации: пропуск docomator-llm.service"
  fi

  if is_backup_enabled; then
    info "Резервное копирование включено: включаем docomator-backup.timer"
    systemctl enable docomator-backup.timer
  fi

  info "Автозапуск служб Docomator успешно настроен."
}

do_disable_autostart() {
  require_systemd
  require_root_privileges
  info "Отключаем автозапуск служб Docomator при старте системы"
  systemctl disable docomator-api.service docomator-worker.service docomator-llm.service docomator-backup.timer 2>/dev/null || true
  info "Автозапуск служб Docomator отключён."
}

do_start() {
  require_systemd
  require_root_privileges
  info "Запускаем службы Docomator"

  if is_llm_enabled; then
    info "Запуск службы ИИ docomator-llm.service"
    systemctl start docomator-llm.service
  fi

  info "Запуск основных служб docomator-api.service и docomator-worker.service"
  systemctl start docomator-api.service docomator-worker.service

  if is_backup_enabled; then
    info "Запуск таймера резервного копирования docomator-backup.timer"
    systemctl start docomator-backup.timer
  fi

  info "Все службы Docomator успешно запущены."
}

do_stop() {
  require_systemd
  require_root_privileges
  info "Останавливаем службы Docomator"
  systemctl stop docomator-backup.timer docomator-backup.service docomator-worker.service docomator-api.service docomator-llm.service 2>/dev/null || true
  info "Все службы Docomator остановлены."
}

do_restart() {
  require_systemd
  require_root_privileges
  info "Перезапускаем службы Docomator"
  do_stop
  do_start
}

do_status() {
  require_systemd
  info "--- Состояние служб systemd ---"
  systemctl status docomator-api.service docomator-worker.service docomator-llm.service docomator-backup.timer --no-pager || true

  local cfg
  cfg="$(get_config_file)"
  if [[ -f "$cfg" ]]; then
    local host port
    host="$(grep -E "^[[:space:]]*DOCOMATOR_HOST=" "$cfg" | tail -n 1 | cut -d= -f2- || true)"
    port="$(grep -E "^[[:space:]]*DOCOMATOR_PORT=" "$cfg" | tail -n 1 | cut -d= -f2- || true)"
    [[ -n "$host" ]] || host="127.0.0.1"
    [[ "$host" == "0.0.0.0" || "$host" == "::" ]] && host="127.0.0.1"
    [[ -n "$port" ]] || port="8080"
    local url="http://${host}:${port}/readyz"

    info "--- Проверка готовности HTTP ($url) ---"
    local node_bin=""
    if [[ -x "$INSTALL_ROOT/current/runtime/node/bin/node" ]]; then
      node_bin="$INSTALL_ROOT/current/runtime/node/bin/node"
    elif command -v node >/dev/null 2>&1; then
      node_bin="node"
    fi

    if [[ -n "$node_bin" && -f "$SCRIPT_DIR/../offline/healthcheck.mjs" ]]; then
      if "$node_bin" "$SCRIPT_DIR/../offline/healthcheck.mjs" "$url" 3000 >/dev/null 2>&1; then
        info "Статус API: ГОТОВ (200 OK)"
      else
        warn "Статус API: НЕ ГОТОВ или не отвечает"
      fi
    fi
  fi
}

case "$COMMAND" in
  start) do_start ;;
  stop) do_stop ;;
  restart) do_restart ;;
  status) do_status ;;
  enable-autostart) do_enable_autostart ;;
  disable-autostart) do_disable_autostart ;;
  install-services) do_install_services ;;
  uninstall-services) do_uninstall_services ;;
  *) die "Неизвестная команда: $COMMAND" ;;
esac
