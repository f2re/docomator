# Финализация стабильного выпуска «Оформлятора»

Статус выпуска: `candidate`

Канал выпуска: `pilot`

Текущая версия: `0.6.7`.

Этот документ описывает fail-closed переход от текущего кандидата `0.6.7` к stable. Номер версии сам по себе не означает стабильность: машинный статус задаётся только `RELEASE_IDENTITY.json`. Пока он содержит `candidate/pilot`, разрешён только контролируемый пилот на обезличенных данных.

## 1. Зафиксировать exact release binding

Все доказательства обязаны относиться к одному `version / status / channel / full Git SHA / release.json SHA-256`. Evidence предыдущих версий не переносится автоматически.

Создайте каркас:

```bash
npm run release:evidence:init -- /srv/docomator-release-evidence
```

## 2. Получить target acts Debian и Astra

На отдельных чистых Debian и Astra Linux 1.7 используйте соответствующие полные offline bundles. Во время установки Internet route должен отсутствовать.

Target acceptance запускается обычным пользователем и получает код только из защищённого файла:

```bash
printf '%s\n' '0427' > /tmp/docomator-code
chmod 600 /tmp/docomator-code
./target-acceptance.sh \
  --output /srv/docomator-target-act \
  --access-code-file /tmp/docomator-code
```

Для Astra дополнительно обязательны `--require-network --require-smtp`.

Акт должен доказать: verify bundle; install/migrations; reboot/systemd; CSV/XLSX import; DOCX/XLSX generation; настоящий LibreOffice; worker restart; backup; update/rollback; `/gost`; access-code flow и recovery. `SKIPPED` в обязательном этапе не считается успехом.

## 3. Отдельно проверить код доступа

На чистой установке без устной инструкции:

- `/access` показывает одно поле из четырёх цифр, экранную цифровую клавиатуру и принимает обычную клавиатуру/вставку;
- username/password controls отсутствуют;
- первый код задаётся один раз через «Придумайте код доступа» и сразу открывает рабочую область;
- при действующей session прямой переход на `/access` не запрашивает код повторно;
- исторический `/login` только перенаправляет на `/access` и не показывает прежнюю форму;
- после очистки cookie тот же код снова открывает область;
- закрытый space API возвращает `401` без `WWW-Authenticate`;
- после пяти ошибочных попыток действует backoff и интерфейс показывает оставшееся время;
- «Закрыть доступ» завершает локальную session cookie;
- `reset-access-code.sh`/`first-run.sh --reset-code` задаёт новый код без старого, закрывает прежние сессии и не меняет данные;
- update/rollback/restore сохраняют возможность открыть рабочую область;
- на 320 px и при 200% zoom экран не создаёт horizontal overflow, управление доступно с клавиатуры и screen reader.

Нативный browser-dialog «имя пользователя / пароль» означает внешний reverse proxy challenge и является ошибкой целевого контура, если он не был отдельно утверждён инфраструктурой.

## 4. Ручная P5/UX-приёмка

Заполните `ux/ux-acceptance.json` по `docs/UX_ACCEPTANCE_PROTOCOL.md`. Обязательны:

- два новых пользователя без устной инструкции;
- клавиатура/focus/screen reader;
- 320/768/1440 и 200% zoom;
- light/dark и reduced motion;
- отсутствие horizontal overflow;
- import error recovery без потери файла/mapping;
- Visual Template Studio на реальном DOCX/XLSX;
- полный сценарий `пространство → сотрудники/группа → пользовательские поля → шаблон → заполненный документ`;
- выбор любого поля обычной прокруткой и клавиатурой без обязательного поиска;
- выпуск документов и поиск результата;
- access-code первый запуск/закрытие/recovery;
- Playwright/axe artifacts того же release binding.

## 5. Recovery и отказоустойчивость

На отдельном чистом стенде восстановите backup из target act. В `recovery/restore-act.json` зафиксируйте source act, backup manifest SHA-256, exact release binding и сверку counts/IDs/SHA-256.

После restore должны сохраниться пространства, сущности, поля/значения, группы, templates, jobs/results/deliveries, object store и credential/session configuration. API/worker обязаны работать после reboot.

Проверьте disk-full, corrupt backup/object, worker restart, delivery failure, повтор операции, update failure/rollback. Потеря данных или дубликат результата — блокер.

## 6. Реальный Office corpus

`office/compatibility.json` должен содержать не менее 20 уникальных DOCX и 20 уникальных XLSX с provenance, creator/version и SHA-256.

Проверяются поддерживаемые стили, таблицы/merge, колонтитулы, изображения, formulas/OMML, repeat blocks, unknown parts, reverse-read и открытие результатов в согласованных LibreOffice + Microsoft Office. Неподдерживаемая конструкция должна давать понятное ограничение/отказ, а не повреждённый документ.

## 7. Нагрузка и пространства

CSV/XLSX import и document generation: 10/100/1000 объектов. Проверяются пустые ячейки, Excel dates, mixed types, дубли, повторный import, partial invalid files и retry only failed units.

Два пространства с одинаковыми именами/ключами не читают, не изменяют, не удаляют и не связывают данные друг друга. Import A не влияет на B.

## 8. Финальный gate кандидата

`blockers.json` принимается только с пустым `openBlockers`. Затем:

```bash
npm run release:evidence -- \
  /srv/docomator-release-evidence \
  --expected-commit '<полный Git SHA>' \
  --expected-version '0.6.7'
```

Gate = 0 обязателен.

## 9. Выпуск stable

Только после успешного candidate gate:

1. отдельным PR изменить `RELEASE_IDENTITY.json` на `stable/production`;
2. если capability set не изменился, оставить version `0.6.7`;
3. выполнить полный CI stable commit;
4. пересобрать Debian/Astra bundles именно из stable commit;
5. повторно подтвердить target identity/update/rollback/recovery;
6. обновить `SUPPORT_MATRIX.md` только фактически подтверждёнными строками;
7. создать подписанный tag и опубликовать проверенные archives/SHA-256/SBOM/release notes.

До этого никакой UI/doc/issue/bundle не должен называть текущий выпуск стабильным.