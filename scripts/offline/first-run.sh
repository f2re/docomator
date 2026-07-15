#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="/etc/docomator/docomator.env"
EXPLICIT_URL=""
RUN_CHECK=0

usage() {
  cat <<'USAGE'
Использование: first-run.sh [параметры]

Показывает памятку первого запуска Docomator и при необходимости проверяет
локальные компоненты. Помощник работает автономно и не изменяет данные.

Параметры:
  --config ФАЙЛ   файл настроек
  --url АДРЕС     явный адрес веб-интерфейса
  --check         проверить готовность компонентов
  -h, --help      показать эту справку
USAGE
}

while (($# > 0)); do
  case "$1" in
    --config) CONFIG_FILE="$2"; shift 2 ;;
    --url) EXPLICIT_URL="$2"; shift 2 ;;
    --check) RUN_CHECK=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Неизвестный параметр: %s\n' "$1" >&2; exit 2 ;;
  esac
done

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

cat <<EOF
🧩 Docomator установлен

Откройте общий корпоративный интерфейс:
  $UI_URL/

Модель работы:
  • авторизация и персональные кабинеты не требуются;
  • все пользователи работают с общими данными и документами;
  • разделы нужны для организации участников, групп, шаблонов и расписаний;
  • готовые ручные и автоматические результаты попадают в общий раздел «Документы».

Рабочий порядок:
  1. 🧑‍🤝‍🧑 Создайте раздел, участников и сохранённые группы.
  2. 🧱 Добавьте свойства: ФИО, должность, даты и реквизиты.
  3. 🛡️ Загрузите и проверьте DOCX/XLSX.
  4. 🧭 Отметьте поля и выполните многополевую проверку.
  5. 👁️ Создайте PDF и активируйте версию шаблона.
  6. 📄 Выпустите один сводный документ или файлы на каждого участника.
  7. 🔎 Исправьте обязательные пропуски до запуска.
  8. 🗓️ При необходимости создайте однократное, ежедневное или ежемесячное расписание.
  9. 📥 Откройте «Документы»: новый результат подсвечивается и остаётся там до скачивания или удаления.
  10. ✅ Скачивание переводит документ в «Забран», но сохраняет его в истории.
  11. 🗑️ Удаляйте результат только отдельным явным действием.
  12. 📁 Используйте сетевую папку или SMTP для дополнительной доставки.

Что уже работает:
  ✅ безопасные шаблоны DOCX/XLSX и PDF-предпросмотр;
  ✅ сводные и персональные документы;
  ✅ проверка данных, частичный результат и повтор ошибок;
  ✅ общие получатели, сетевая и SMTP-доставка;
  ✅ однократные, ежедневные и ежемесячные расписания;
  ✅ общее хранилище новых, просмотренных, забранных и удалённых результатов;
  ✅ уведомление о новых автоматических документах;
  ✅ резервирование, аудит, контрольные суммы и восстановление.

Ближайшие этапы:
  ⏳ сетевая доставка результатов расписания;
  ⏳ очистка объектов без ссылок;
  ⏳ массовый импорт участников и свойств;
  ⏳ пилотная проверка на Astra/Debian;
  ⏳ повторяемые области пользовательского шаблона.
EOF
