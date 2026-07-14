#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="/etc/docomator/docomator.env"
EXPLICIT_URL=""
RUN_CHECK=0

usage() {
  cat <<'USAGE'
Использование: first-run.sh [параметры]

Показывает пошаговую памятку первого запуска установленного Docomator.
Помощник работает автономно и не изменяет данные.

Параметры:
  --config ФАЙЛ   файл настроек (по умолчанию: /etc/docomator/docomator.env)
  --url АДРЕС     явный адрес веб-интерфейса
  --check         проверить готовность локальных компонентов перед показом памятки
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
  case "$HOST" in
    0.0.0.0|::) HOST="127.0.0.1" ;;
  esac
  UI_URL="http://${HOST}:${PORT}"
fi

if ((RUN_CHECK == 1)); then
  NODE=""
  HEALTHCHECK=""
  for candidate in \
    /opt/docomator/current/runtime/node/bin/node \
    "$SCRIPT_DIR/payload/runtime/node/bin/node"; do
    if [[ -x "$candidate" ]]; then NODE="$candidate"; break; fi
  done
  for candidate in \
    /opt/docomator/current/app/scripts/offline/healthcheck.mjs \
    "$SCRIPT_DIR/healthcheck.mjs"; do
    if [[ -f "$candidate" ]]; then HEALTHCHECK="$candidate"; break; fi
  done

  if [[ -n "$NODE" && -n "$HEALTHCHECK" ]]; then
    if "$NODE" "$HEALTHCHECK" "$UI_URL/readyz" 5000 >/dev/null 2>&1; then
      printf '✅ Локальная служба готова: %s/readyz\n' "$UI_URL"
    else
      printf '⚠️  Локальная служба пока не готова. Проверьте «systemctl status docomator-api» и повторите запуск с --check.\n' >&2
    fi
  else
    printf 'ℹ️  Автоматическая проверка службы недоступна: не найден встроенный Node.js или файл healthcheck.mjs.\n'
  fi

  PREVIEW_ENABLED="$(read_value DOCOMATOR_PREVIEW_ENABLED)"
  LIBREOFFICE_BIN="$(read_value DOCOMATOR_LIBREOFFICE_BIN)"
  [[ -n "$PREVIEW_ENABLED" ]] || PREVIEW_ENABLED="true"
  [[ -n "$LIBREOFFICE_BIN" ]] || LIBREOFFICE_BIN="/usr/bin/libreoffice"
  if [[ "$PREVIEW_ENABLED" == "true" ]]; then
    if [[ -x "$LIBREOFFICE_BIN" ]]; then
      printf '✅ LibreOffice доступен для создания PDF: %s\n' "$LIBREOFFICE_BIN"
    else
      printf '⚠️  Предварительный просмотр включён, но LibreOffice не найден: %s\n   Установите пакеты из автономного комплекта либо исправьте DOCOMATOR_LIBREOFFICE_BIN.\n' "$LIBREOFFICE_BIN" >&2
    fi
  else
    printf 'ℹ️  Предварительный просмотр отключён настройкой DOCOMATOR_PREVIEW_ENABLED.\n'
  fi

  DELIVERY_ROOT="$(read_value DOCOMATOR_NETWORK_DELIVERY_ROOT)"
  if [[ -n "$DELIVERY_ROOT" ]]; then
    if [[ -d "$DELIVERY_ROOT" && -w "$DELIVERY_ROOT" ]]; then
      printf '✅ Сетевая доставка доступна: %s\n' "$DELIVERY_ROOT"
    else
      printf '⚠️  Корень сетевой доставки недоступен для записи: %s\n   Проверьте подключение ресурса и права пользователя службы.\n' "$DELIVERY_ROOT" >&2
    fi
  else
    printf 'ℹ️  Сетевая доставка отключена: DOCOMATOR_NETWORK_DELIVERY_ROOT не задан.\n'
  fi

  SMTP_ENABLED="$(read_value DOCOMATOR_SMTP_ENABLED)"
  [[ -n "$SMTP_ENABLED" ]] || SMTP_ENABLED="false"
  if [[ "$SMTP_ENABLED" == "true" ]]; then
    SMTP_HOST="$(read_value DOCOMATOR_SMTP_HOST)"
    SMTP_PORT="$(read_value DOCOMATOR_SMTP_PORT)"
    SMTP_FROM="$(read_value DOCOMATOR_SMTP_FROM)"
    SMTP_DOMAINS="$(read_value DOCOMATOR_SMTP_ALLOWED_DOMAINS)"
    SMTP_SECURE="$(read_value DOCOMATOR_SMTP_SECURE)"
    SMTP_STARTTLS="$(read_value DOCOMATOR_SMTP_STARTTLS)"
    [[ -n "$SMTP_PORT" ]] || SMTP_PORT="25"
    [[ -n "$SMTP_SECURE" ]] || SMTP_SECURE="false"
    [[ -n "$SMTP_STARTTLS" ]] || SMTP_STARTTLS="true"
    if [[ -z "$SMTP_HOST" || -z "$SMTP_FROM" || -z "$SMTP_DOMAINS" ]]; then
      printf '⚠️  SMTP включён, но не заполнены сервер, отправитель или разрешённые домены.\n' >&2
    elif [[ "$SMTP_SECURE" == "true" && "$SMTP_STARTTLS" == "true" ]]; then
      printf '⚠️  Одновременно включены неявный TLS и STARTTLS. Оставьте только один режим.\n' >&2
    else
      printf '✅ SMTP настроен: %s:%s, отправитель %s, разрешённые домены: %s\n' \
        "$SMTP_HOST" "$SMTP_PORT" "$SMTP_FROM" "$SMTP_DOMAINS"
    fi
  else
    printf 'ℹ️  Почтовая доставка отключена: DOCOMATOR_SMTP_ENABLED=false.\n'
  fi
  printf '\n'
fi

cat <<EOF
🧩 Docomator установлен. Первый запуск

Откройте интерфейс:
  $UI_URL/

Рабочий порядок:
  1. 🧑‍🤝‍🧑 Создайте пространство, участников и сохранённые группы.
  2. 🧱 Добавьте свойства данных: ФИО, должность, подразделение, даты и реквизиты.
  3. 🛡️ Загрузите DOCX/XLSX, проверьте безопасность и сохраните исходник.
  4. 🧭 Постройте структуру, отметьте поля и выполните многополевую проверку.
  5. 👁️ Создайте PDF, просмотрите его и активируйте версию шаблона.
  6. 📄 Сформируйте один сводный документ либо отдельный файл на каждого участника.
  7. 🔎 Исправьте обязательные пропуски прямо перед выпуском.
  8. 📁 Скачайте результат, передайте его в сетевую папку или отправьте через SMTP.
  9. ✉️ Сохраните часто используемых получателей внутри пространства.
  10. 🗓️ Создайте однократное, ежедневное или ежемесячное расписание:
      • выберите активный шаблон и сохранённую непустую группу;
      • укажите форму результата, локальное время и часовой пояс IANA;
      • при необходимости выберите SMTP и сохранённого получателя;
      • проверьте рассчитанный следующий запуск.
  11. ▶️ Для проверки нажмите «Запустить сейчас» — календарь расписания не изменится.
  12. 📋 Откройте историю периодов: завершение, пропуск и ошибка сохраняются отдельно.

Что уже работает:
  ✅ пространства, участники, группы и неизменяемые снимки состава;
  ✅ безопасный приём и структурный разбор DOCX/XLSX;
  ✅ несколько типизированных полей в одной активной версии;
  ✅ PDF-предпросмотр, явная активация и каталог шаблонов;
  ✅ один сводный DOCX/XLSX либо отдельный документ на каждого участника;
  ✅ проверка данных, частичный результат и повтор только проблемных документов;
  ✅ безопасная доставка в разрешённую сетевую папку;
  ✅ фоновая SMTP-доставка с TLS, ограничением доменов и повтором 4xx;
  ✅ сохранённые получатели пространства без удаления истории;
  ✅ однократные, ежедневные и ежемесячные расписания;
  ✅ часовые пояса IANA, защита календарного периода и восстановление после перезапуска;
  ✅ автоматическая SMTP-доставка результата расписания;
  ✅ события, аудит, контрольные суммы и восстановление.

Ближайшие продуктовые этапы:
  ⏳ серверное применение ролей пространства;
  ⏳ автоматическая сетевая доставка расписаний;
  ⏳ предметные события;
  ⏳ пилотная проверка на реальных шаблонах и эталонной Astra/Debian.

Помощь находится внутри каждого раздела по кнопке «❓ Помощь».
EOF
