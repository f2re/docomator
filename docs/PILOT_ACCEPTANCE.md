# Пилотная приёмка Docomator

Проверка предназначена для установленной автономной версии на Debian или Astra Linux. Она подтверждает идентичность работающего релиза, собирает сведения о рабочей среде, службах, диагностике и резервной копии, затем формирует JSON и акт Markdown.

## Единый автоматизированный прогон

На чистом Debian/🟥 Astra Linux-стенде используйте `target-acceptance.sh` из проверенного bundle. Он одной командой собирает verifier, smoke, настоящий LibreOffice, новую резервную копию, pilot JSON/Markdown и Playwright/axe. Ручную P5-приёмку и восстановление на отдельном стенде выполняют дополнительно.

## Запуск

```bash
sudo bash /opt/docomator/current/app/scripts/runtime/pilot-check.sh --run-backup
```

Отчёты сохраняются в `/var/lib/docomator/pilot-reports/`:

- `pilot-<дата>.json` — машинно-читаемый результат;
- `pilot-<дата>.md` — акт пилотной проверки.

Успешный акт содержит точные версию, Git commit и SHA-256 установленного `release.json`. Источник идентичности обязан иметь значение `installed`; запуск из исходного дерева с `source: development`, несовпадение версии или недоступность `/api/v1/system/release` блокируют пилот с кодом `2`.

Для контура, где обязательны сетевая папка и почтовая доставка:

```bash
sudo bash /opt/docomator/current/app/scripts/runtime/pilot-check.sh \
  --run-backup \
  --require-network \
  --require-smtp
```

## Что проверяется

1. Идентичность установленного релиза: версия, Git commit и SHA-256 `release.json`.
2. Версии ОС, ядра, glibc, Node.js и LibreOffice.
3. Активность API и фонового обработчика.
4. Состояние таймера резервных копий.
5. Серверный отчёт готовности.
6. Целостность SQLite и объектного хранилища.
7. Свободное место.
8. Сетевая папка и SMTP согласно выбранному режиму.
9. Полная проверка последней резервной копии.
10. Создание новой копии при `--run-backup` с SHA-256 её `manifest.sha256`.

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

P5 проводится по [протоколу ручной UX-приёмки](UX_ACCEPTANCE_PROTOCOL.md). Нужен проверенный root-owned bundle, собранный с `--with-ux-acceptance`; установленное production-приложение само по себе QA-набор не содержит. На каноническом Linux-стенде обычный непривилегированный проверяющий создаёт защищённый каталог и незаполненный акт:

```bash
install -d -m 0700 "$HOME/docomator-p5"
/opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/ux-acceptance.mjs \
  init "$HOME/docomator-p5/ux-acceptance.json"
```

Полный браузерный прогон выполняется из того же verified bundle; каталог одного прогона должен быть новым:

```bash
"$BUNDLE_ROOT/ux-acceptance-gate.sh" \
  --base-url http://127.0.0.1:8080/ \
  --output "$HOME/docomator-p5/automation-01"
```

Из `automation-01/run-metadata.json` в `environment` акта переносятся точные `commitSha`, `bundleManifestSha256`, `releaseMetadataSha256` и `browserVersion`; остальные обязательные сведения о Linux и экранном дикторе заполняются фактически. Gate предварительно сверяет запущенный API с `release.json` комплекта, а владельца и версию Chromium — с установленным Debian-пакетом. После этого два JSON-отчёта добавляются к акту fail-closed командой. Пути должны указывать на файлы этого же прогона:

```bash
/opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/ux-acceptance.mjs \
  collect-automation \
  "$HOME/docomator-p5/ux-acceptance.json" \
  "$HOME/docomator-p5/ux-acceptance-with-automation.json" \
  "$HOME/docomator-p5/automation-01/playwright-report.json" \
  "$HOME/docomator-p5/automation-01/axe-report.json"
```

Команда не меняет исходный файл и создаёт новый акт, в котором заполнено только `automationEvidence`; успешное выполнение не закрывает ручную приёмку. Возвращённые axe-пункты `incomplete` появляются как обязательные ручные разборы, привязанные к SHA-256 отчёта. Оба акта находятся в одном каталоге, каталог не должен разрешать запись группе или остальным, существующий отличающийся выходной файл не перезаписывается, а акт с `decision.status: passed` не принимается для повторного сбора.

После ручной матрицы доступности, утверждения шести PNG и трёх заданий каждого из двух новых пользователей акт проверяется тем же встроенным Node.js:

```bash
/opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/ux-acceptance.mjs \
  validate "$HOME/docomator-p5/ux-acceptance-with-automation.json"
```

Автоматический pilot report и axe не заменяют эти свидетельства. До фактического акта пользовательская приёмка остаётся открытой.

Основные журналы доступны для служб API, фонового обработчика и резервирования. Каждый акт содержит рекомендуемое действие для выявленной проблемы.
