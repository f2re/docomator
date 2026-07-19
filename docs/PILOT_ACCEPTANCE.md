# Пилотная приёмка Docomator

Проверка предназначена для установленной автономной версии на Debian или Astra Linux. Она собирает сведения о рабочей среде, службах, диагностике и резервной копии, затем формирует JSON и акт Markdown.

## Запуск

```bash
sudo bash /opt/docomator/current/app/scripts/runtime/pilot-check.sh --run-backup
```

Отчёты сохраняются в `/var/lib/docomator/pilot-reports/`:

- `pilot-<дата>.json` — машинно-читаемый результат;
- `pilot-<дата>.md` — акт пилотной проверки.

Для контура, где обязательны сетевая папка и почтовая доставка:

```bash
sudo bash /opt/docomator/current/app/scripts/runtime/pilot-check.sh \
  --run-backup \
  --require-network \
  --require-smtp
```

## Что проверяется

1. Версии ОС, ядра, glibc, Node.js и LibreOffice.
2. Активность API и фонового обработчика.
3. Состояние таймера резервных копий.
4. Серверный отчёт готовности.
5. Целостность SQLite и объектного хранилища.
6. Свободное место.
7. Сетевая папка и SMTP согласно выбранному режиму.
8. Полная проверка последней резервной копии.
9. Создание новой копии при `--run-backup`.

## Коды завершения

| Код | Значение |
|---:|---|
| `0` | пилотный контур готов |
| `1` | есть предупреждения |
| `2` | обнаружена блокирующая ошибка |

Для автоматизированного вызова добавьте `--json-only`.

## После автоматической проверки

На целевом стенде дополнительно следует:

1. импортировать 10, 100 и 1000 участников;
2. повторить импорт с изменениями и проверить отсутствие дублей;
3. загрузить реальные DOCX/XLSX;
4. сформировать персональные и сводные документы;
5. проверить расписание после перезапуска фонового обработчика;
6. проверить доставку и общий центр документов с нескольких рабочих мест;
7. восстановить созданную копию на отдельном стенде;
8. сравнить количество участников, шаблонов и результатов после восстановления.

## Отдельная UX-приёмка

P5 проводится по [протоколу ручной UX-приёмки](UX_ACCEPTANCE_PROTOCOL.md). На каноническом Linux-стенде создаётся незаполненный акт:

```bash
sudo install -d -m 0700 -o root -g root \
  /var/lib/docomator/pilot-reports
sudo /opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/ux-acceptance.mjs \
  init /var/lib/docomator/pilot-reports/ux-acceptance.json
```

После полного браузерного прогона его два JSON-отчёта добавляются к акту fail-closed командой. Пути к отчётам должны указывать на файлы, полученные на этом же каноническом стенде:

```bash
sudo /opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/ux-acceptance.mjs \
  collect-automation \
  /var/lib/docomator/pilot-reports/ux-acceptance.json \
  /var/lib/docomator/pilot-reports/ux-acceptance-with-automation.json \
  /ПУТЬ/playwright-report.json \
  /ПУТЬ/axe-report.json
```

Команда не меняет исходный файл и создаёт новый акт, в котором заполнено только `automationEvidence`; успешное выполнение не закрывает ручную приёмку. Возвращённые axe-пункты `incomplete` появляются как обязательные ручные разборы, привязанные к SHA-256 отчёта. Оба акта находятся в одном каталоге, каталог не должен разрешать запись группе или остальным, существующий отличающийся выходной файл не перезаписывается, а акт с `decision.status: passed` не принимается для повторного сбора.

После ручной матрицы доступности, утверждения шести PNG и трёх заданий каждого из двух новых пользователей акт проверяется тем же встроенным Node.js:

```bash
sudo /opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/ux-acceptance.mjs \
  validate /var/lib/docomator/pilot-reports/ux-acceptance-with-automation.json
```

Автоматический pilot report и axe не заменяют эти свидетельства. До фактического акта пользовательская приёмка остаётся открытой.

Основные журналы доступны для служб API, фонового обработчика и резервирования. Каждый акт содержит рекомендуемое действие для выявленной проблемы.
