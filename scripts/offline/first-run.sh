#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="/etc/docomator/docomator.env"
EXPLICIT_URL=""
RUN_CHECK=0

usage() {
  cat <<'USAGE'
Usage: first-run.sh [options]

Prints the guided first-run checklist for an installed Docomator server.
The helper is offline and does not modify data.

Options:
  --config FILE   Environment file (default: /etc/docomator/docomator.env)
  --url URL       Explicit web interface URL
  --check         Check /readyz before printing the checklist
  -h, --help      Show this help
USAGE
}

while (($# > 0)); do
  case "$1" in
    --config) CONFIG_FILE="$2"; shift 2 ;;
    --url) EXPLICIT_URL="$2"; shift 2 ;;
    --check) RUN_CHECK=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
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
      printf '✅ Локальный API готов: %s/readyz\n\n' "$UI_URL"
    else
      printf '⚠️  API пока не готов. Проверьте systemctl status docomator-api и повторите --check.\n\n' >&2
    fi
  else
    printf 'ℹ️  Автоматическая проверка недоступна: bundled Node.js или healthcheck.mjs не найден.\n\n'
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

  3. 👥 Добавьте участников внутрь выбранного пространства.
     Данные другого пространства не появятся в этом списке.

  4. ☑️ Отметьте нужных людей.
     Выбор можно использовать один раз или сохранить как именованную группу.

  5. 📋 Выберите форму результата:
     • «Один общий документ» — таблица/список через audience.members;
     • «По документу на каждого» — отдельная единица на каждого участника.

  6. 📸 Зафиксируйте снимок аудитории.
     Состав останется неизменным, даже если группу отредактируют позже.

Что уже работает:
  ✅ пространства, изоляция, участники и группы;
  ✅ выбор всех, группы или отмеченных людей;
  ✅ точный расчёт: один документ или N документов;
  ✅ аудит и неизменяемый снимок состава.

Что появится следующим этапом:
  ⏳ безопасная загрузка DOCX/XLSX;
  ⏳ привязка audience.members к повторяющейся таблице или списку;
  ⏳ финальный рендер, скачивание и автоматическая доставка.

Помощь находится внутри каждого раздела по кнопке «❓ Помощь».
EOF
