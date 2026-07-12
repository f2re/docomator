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
  --check         проверить готовность локальной службы перед показом памятки
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
      printf '✅ Локальная служба готова: %s/readyz\n\n' "$UI_URL"
    else
      printf '⚠️  Локальная служба пока не готова. Проверьте «systemctl status docomator-api» и повторите запуск с --check.\n\n' >&2
    fi
  else
    printf 'ℹ️  Автоматическая проверка недоступна: не найден встроенный Node.js или файл healthcheck.mjs.\n\n'
  fi
fi

cat <<EOF
🧩 Docomator установлен. Первый запуск

Откройте интерфейс:
  $UI_URL/

Рекомендуемый порядок:
  1. 🧑‍🤝‍🧑 Создайте или выберите пространство.
     Пространство изолирует людей, группы и будущие документы.

  2. 🧱 Проверьте тип «Человек» в разделе «Схема данных».
     При необходимости добавьте свойства: ФИО, должность, рост, вес и другие параметры.

  3. 👥 Добавьте участников в выбранное пространство.
     Данные другого пространства не появятся в этом списке.

  4. ☑️ Отметьте нужных людей.
     Выбор можно использовать один раз или сохранить как именованную группу.

  5. 📋 Выберите форму результата:
     • «Один общий документ» — таблица или список всех выбранных участников;
     • «По документу на каждого» — отдельный документ для каждого участника.

  6. 📸 Зафиксируйте снимок состава.
     Состав останется неизменным, даже если группу отредактируют позже.

Что уже работает:
  ✅ пространства, изоляция, участники и группы;
  ✅ выбор всех, группы или отмеченных людей;
  ✅ точный расчёт: один документ или несколько документов;
  ✅ журнал действий и неизменяемый снимок состава.

Что появится следующим этапом:
  ⏳ безопасная загрузка DOCX/XLSX;
  ⏳ подстановка списка участников в повторяющуюся таблицу или список;
  ⏳ окончательное формирование, скачивание и автоматическая доставка.

Помощь находится внутри каждого раздела по кнопке «❓ Помощь».
EOF
