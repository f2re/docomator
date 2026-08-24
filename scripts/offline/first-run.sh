#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="/etc/docomator/docomator.env"
EXPLICIT_URL=""
RUN_CHECK=0
RESET_CODE=0

usage() {
  cat <<'USAGE'
Использование: first-run.sh [параметры]

Показывает памятку первого запуска Оформлятора и при необходимости проверяет
локальные компоненты. Обычный режим работает автономно и не изменяет данные.

Параметры:
  --config ФАЙЛ   файл настроек
  --url АДРЕС     явный адрес веб-интерфейса
  --check         проверить готовность компонентов
  --reset-code    задать новый 4-значный код доступа без старого кода
  -h, --help      показать эту справку
USAGE
}

while (($# > 0)); do
  case "$1" in
    --config) CONFIG_FILE="$2"; shift 2 ;;
    --url) EXPLICIT_URL="$2"; shift 2 ;;
    --check) RUN_CHECK=1; shift ;;
    --reset-code) RESET_CODE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Неизвестный параметр: %s\n' "$1" >&2; exit 2 ;;
  esac
done

if ((RESET_CODE == 1)); then
  RESET_HELPER="$SCRIPT_DIR/reset-access-code.sh"
  [[ -x "$RESET_HELPER" ]] || {
    printf 'Не найден штатный помощник сброса кода: %s\n' "$RESET_HELPER" >&2
    exit 1
  }
  exec "$RESET_HELPER" --config "$CONFIG_FILE"
fi

read_value() {
  local key="$1"
  [[ -f "$CONFIG_FILE" ]] || return 0
  grep -E "^[[:space:]]*${key}=" "$CONFIG_FILE" | tail -n 1 | cut -d= -f2- || true
}

if [[ -n "$EXPLICIT_URL" ]]; then
  UI_URL="${EXPLICIT_URL%/}"
else
  HOST="$(read_value DOCOMATOR_HOST)"
  PORT="$(read_value DOCOMATOR_PORT)"
  [[ -n "$HOST" ]] || HOST="127.0.0.1"
  [[ -n "$PORT" ]] || PORT="8080"
  case "$HOST" in 0.0.0.0|::) HOST="127.0.0.1" ;; esac
  UI_URL="http://${HOST}:${PORT}"
fi

printf '🔒 Если код доступа ещё не задан, Оформлятор сам откроет экран первого запуска.\n'
printf '   Задайте любые удобные 4 цифры один раз — логин, имя пользователя и пароль не нужны.\n'
printf '   Можно открыть экран напрямую: %s/access\n' "$UI_URL"
printf '   Если код забыт: sudo /opt/docomator/current/first-run.sh --reset-code\n\n'

if ((RUN_CHECK == 1)); then
  NODE=""
  HEALTHCHECK=""
  for candidate in \
    /opt/docomator/current/runtime/node/bin/node \
    "$SCRIPT_DIR/payload/runtime/node/bin/node"; do
    [[ -x "$candidate" ]] && NODE="$candidate" && break
  done
  for candidate in \
    /opt/docomator/current/app/scripts/offline/healthcheck.mjs \
    "$SCRIPT_DIR/healthcheck.mjs"; do
    [[ -f "$candidate" ]] && HEALTHCHECK="$candidate" && break
  done

  if [[ -n "$NODE" && -n "$HEALTHCHECK" ]] && \
     "$NODE" "$HEALTHCHECK" "$UI_URL/readyz" 5000 >/dev/null 2>&1; then
    printf '✅ Локальная служба готова: %s/readyz\n' "$UI_URL"
  else
    printf '⚠️  Локальная служба не подтвердила готовность. Проверьте docomator-api и docomator-worker.\n' >&2
  fi

  PREVIEW_ENABLED="$(read_value DOCOMATOR_PREVIEW_ENABLED)"
  LIBREOFFICE_BIN="$(read_value DOCOMATOR_LIBREOFFICE_BIN)"
  [[ -n "$PREVIEW_ENABLED" ]] || PREVIEW_ENABLED="true"
  [[ -n "$LIBREOFFICE_BIN" ]] || LIBREOFFICE_BIN="/usr/bin/libreoffice"
  if [[ "$PREVIEW_ENABLED" == "true" && -x "$LIBREOFFICE_BIN" ]]; then
    printf '✅ LibreOffice доступен: %s\n' "$LIBREOFFICE_BIN"
  elif [[ "$PREVIEW_ENABLED" == "true" ]]; then
    printf '⚠️  LibreOffice не найден: %s\n' "$LIBREOFFICE_BIN" >&2
  else
    printf 'ℹ️  PDF-предпросмотр отключён.\n'
  fi

  BACKUP_ENABLED="$(read_value DOCOMATOR_BACKUP_ENABLED)"
  BACKUP_RETENTION="$(read_value DOCOMATOR_BACKUP_RETENTION)"
  DATA_DIR="$(read_value DOCOMATOR_DATA_DIR)"
  [[ -n "$BACKUP_ENABLED" ]] || BACKUP_ENABLED="true"
  [[ -n "$BACKUP_RETENTION" ]] || BACKUP_RETENTION="7"
  [[ -n "$DATA_DIR" ]] || DATA_DIR="/var/lib/docomator"
  if [[ "${BACKUP_ENABLED,,}" == "true" || "$BACKUP_ENABLED" == "1" ]]; then
    if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled --quiet docomator-backup.timer 2>/dev/null; then
      NEXT_BACKUP="$(systemctl list-timers docomator-backup.timer --no-legend 2>/dev/null | awk '{$1=$1; print}' || true)"
      printf '✅ Автоматические копии включены, хранится последних: %s.\n' "$BACKUP_RETENTION"
      [[ -n "$NEXT_BACKUP" ]] && printf '   Таймер: %s\n' "$NEXT_BACKUP"
    else
      printf '⚠️  Автоматические копии включены в настройках, но таймер systemd не активирован.\n' >&2
    fi
    LATEST_BACKUP="$(find "$DATA_DIR/backups" -maxdepth 2 -type f -name manifest.json -printf '%T@ %h\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2- || true)"
    if [[ -n "$LATEST_BACKUP" ]]; then
      printf '✅ Последняя проверенная копия: %s\n' "$LATEST_BACKUP"
    else
      printf 'ℹ️  Первая автоматическая копия ещё не создана. Для запуска сейчас: sudo systemctl start docomator-backup.service\n'
    fi
  else
    printf '⚠️  Автоматическое резервирование отключено.\n' >&2
  fi

  DELIVERY_ROOT="$(read_value DOCOMATOR_NETWORK_DELIVERY_ROOT)"
  if [[ -n "$DELIVERY_ROOT" && -d "$DELIVERY_ROOT" && -w "$DELIVERY_ROOT" ]]; then
    printf '✅ Сетевая доставка доступна: %s\n' "$DELIVERY_ROOT"
  elif [[ -n "$DELIVERY_ROOT" ]]; then
    printf '⚠️  Сетевая папка недоступна для записи: %s\n' "$DELIVERY_ROOT" >&2
  else
    printf 'ℹ️  Сетевая доставка отключена.\n'
  fi

  SMTP_ENABLED="$(read_value DOCOMATOR_SMTP_ENABLED)"
  [[ -n "$SMTP_ENABLED" ]] || SMTP_ENABLED="false"
  if [[ "$SMTP_ENABLED" == "true" ]]; then
    SMTP_HOST="$(read_value DOCOMATOR_SMTP_HOST)"
    SMTP_PORT="$(read_value DOCOMATOR_SMTP_PORT)"
    SMTP_FROM="$(read_value DOCOMATOR_SMTP_FROM)"
    SMTP_DOMAINS="$(read_value DOCOMATOR_SMTP_ALLOWED_DOMAINS)"
    [[ -n "$SMTP_PORT" ]] || SMTP_PORT="25"
    if [[ -n "$SMTP_HOST" && -n "$SMTP_FROM" && -n "$SMTP_DOMAINS" ]]; then
      printf '✅ SMTP настроен: %s:%s, отправитель %s.\n' \
        "$SMTP_HOST" "$SMTP_PORT" "$SMTP_FROM"
    else
      printf '⚠️  SMTP включён, но не заполнены сервер, отправитель или разрешённые домены.\n' >&2
    fi
  else
    printf 'ℹ️  SMTP-доставка отключена.\n'
  fi
  printf '\n'
fi

EXAMPLES_DIR=""
for candidate in \
  "$SCRIPT_DIR/app/examples" \
  "$SCRIPT_DIR/payload/app/examples" \
  /opt/docomator/current/app/examples; do
  [[ -f "$candidate/README.md" ]] && EXAMPLES_DIR="$candidate" && break
done
[[ -n "$EXAMPLES_DIR" ]] || EXAMPLES_DIR="примеры не найдены в текущем комплекте"

cat <<EOF
🧩 Оформлятор установлен

Откройте интерфейс:
  $UI_URL/

Быстрый старт:
  1. Если увидите «Первый запуск», придумайте 4 цифры и нажмите «Сохранить и открыть».
  2. Импортируйте сотрудников из CSV/XLSX или вставьте таблицу из Excel.
  3. Проверьте найденные поля; ошибки показываются у конкретной строки и значения.
  4. Загрузите DOCX/XLSX-шаблон, отметьте места подстановки и выполните пробную проверку.
  5. Сформируйте документ и заберите его в разделе «Результаты».

Учебные примеры:
  $EXAMPLES_DIR

Если нужна диагностика компонентов:
  sudo /opt/docomator/current/first-run.sh --check

Если код доступа забыт:
  sudo /opt/docomator/current/first-run.sh --reset-code

Сброс кода не удаляет документы и рабочие данные, но завершает старые браузерные сессии.
Если установка завершилась без ошибки выше, дополнительных действий с правами каталогов не требуется.
EOF
