# Ближайшие приращения Оформлятора

Актуально на **2026-08-18**.

Текущий кодовый контур находится в состоянии **`0.5.1 / candidate / pilot`**. Основной пользовательский путь, space isolation, password gate, import/export, deterministic DOCX/XLSX generation, worker recovery, автоматические safe-read этапы, визуальная разметка DOCX v1, единая навигационная иерархия и generic offline bundle реализованы на уровне кода. Следующая работа — прежде всего получение эксплуатационных доказательств для stable и расширение визуального редактора только отдельными безопасными вертикальными приращениями.

Нормативные документы: [REQUIREMENTS.md](REQUIREMENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [FINALIZATION.md](FINALIZATION.md), [ROADMAP.md](ROADMAP.md), [VERSIONING.md](VERSIONING.md).

## Принятая модель эксплуатации

- Оформлятор работает во внутреннем доверенном корпоративном контуре;
- приложение требует **один общий пароль** как дополнительный барьер перед UI и предметными API;
- пользователей, персональных кабинетов, ролей и ACL в приложении нет;
- firewall/reverse proxy/HTTPS и системные права остаются внешней security boundary;
- пространства — жёсткие границы данных, но не пользовательских прав;
- runtime полноценно работает без Internet и без LLM;
- LLM остаётся необязательным помощником и не выполняет shell, SQL, код, произвольные пути или OOXML;
- готовые документы и внешние side effects создаются только детерминированными backend-операциями;
- backup, update и rollback проектируются вместе с восстановлением.

## Текущий подтверждённый кодовый контур

- ✅ жёсткая space isolation, включая migration `0030` и отсутствие claim-on-read/write;
- ✅ guided CSV/XLSX import с typed domain errors;
- ✅ CSV/XLSX export выбранного пространства;
- ✅ безопасный DOCX/XLSX intake и deterministic renderer;
- ✅ scalar/repeat bindings, preview, immutable activation;
- ✅ DOCX visual binding v1: основной текст, header/footer, сноски, обычные таблицы и bold/italic выводятся из проверенного Document IR, а прямое выделение преобразуется в прежние `elementId + UTF-16 offsets`;
- ✅ безопасные read-only этапы intake/import/structure запускаются автоматически, mutation остаются явными;
- ✅ единый desktop/mobile navigation contract удерживает ежедневные задачи на верхнем уровне и переводит редкие инструменты в «Управление»/«Ещё» без потери доступности;
- ✅ персональный/сводный выпуск, partial success и retry failed only;
- ✅ persisted worker queue, leases и restart recovery;
- ✅ SMTP/network delivery и расписания на уровне кода;
- ✅ общий password gate, scrypt/session cookie/logout/backoff;
- ✅ UI regression 320/768/1440, keyboard/focus, reduced motion, 200% zoom;
- ✅ generic offline archive, install/update/rollback/backup/release-evidence tooling;
- ✅ SemVer product version синхронизируется из `RELEASE_IDENTITY.json`, product-changing PR без bump блокируется CI;
- 🟡 XLSX visual grid, DrawingML/image binding и сложные вложенные Office-конструкции не заявлены как готовые и требуют отдельных контрактов/fixtures;
- 🟡 Debian/Astra/Office/recovery/P5 — только инструменты; реальные целевые акты ещё не получены.

## Приоритеты до stable

### P0. Защита `main`

Открытая административная задача #81:

- включить GitHub branch protection/ruleset для `main`;
- запретить force-push/delete;
- требовать актуальный branch и успешные CI checks;
- enforce rules для владельца/администраторов;
- после настройки повторно проверить GitHub branch metadata.

Этот пункт нельзя подменить workflow-файлом внутри репозитория: защита должна быть фактической настройкой GitHub.

### P1. Debian target acceptance

Задача #67 выполняется на отдельной чистой Debian x86-64 без сетевого маршрута во время установки.

Обязательный результат:

- полный offline bundle конкретного candidate commit;
- штатная установка, password setup и reboot;
- systemd API/worker/backup timer;
- настоящий LibreOffice без `SKIPPED`;
- Chromium/Playwright/axe из target inventory;
- визуальная DOCX-разметка и последующая пробная/точная проверка проходят на target без сетевых ресурсов;
- desktop/mobile navigation сохраняет утверждённый набор основных задач, а дополнительные разделы доступны через «Управление»/«Ещё»;
- контрольная backup;
- update/rollback;
- сохранённый release-bound `target-acceptance.json` и manifest.

### P1. Astra Linux 1.7 target acceptance

Задача #68 выполняется отдельно от Debian:

- нативный package closure Astra;
- чистая offline-установка;
- обязательные `--require-network --require-smtp`;
- LibreOffice/Chromium, CIFS/NFS и SMTP TLS;
- визуальная DOCX-разметка работает в поставляемом Chromium без внешних шрифтов/CDN;
- единая навигационная иерархия работает в поставляемом Chromium без внешних ресурсов и page-level overflow;
- временные сетевые/SMTP ошибки и повтор;
- update/rollback без потери данных;
- отдельный Astra target act.

Debian evidence не закрывает Astra.

### P1. Реальный Office-корпус, нагрузка и recovery

Задача #69:

- ≥20 реальных DOCX + ≥20 реальных XLSX с provenance/SHA-256;
- LibreOffice + Microsoft Office;
- для DOCX отдельно проверить visual binding на основном тексте, header/footer, таблицах, пустых местах и смешанном оформлении без повреждения нетронутого OOXML;
- импорт и выпуск 10/100/1000;
- проверка space isolation на рабочем объёме;
- worker restart без дубля результата;
- disk-full/corrupt object/corrupt backup;
- восстановление backup на отдельной чистой машине;
- совпадение SHA-256 восстановленных объектов;
- сохранение password/security configuration.

### P1. P5 и финальный release evidence

Задача #70:

- два новых пользователя без устной инструкции;
- полный основной сценарий от login и пространства до импорта, визуальной разметки DOCX, проверки шаблона, выпуска, скачивания и logout;
- пользователь должен без знания OOXML выбрать поле прямо на документе и понимать, что точный layout проверяется в пробной копии/PDF;
- пользователь должен различать ежедневные и редкие операции, находить ГОСТ/ЕСКД, публикации и расписания через понятную desktop/mobile навигацию без подсказки;
- клавиатура, экранный диктор, 320/768/1440 × light/dark, 200% zoom;
- `ux/ux-acceptance.json` с реальными людьми и target binding;
- оба target acts + Office + recovery + UX + пустой blockers registry;
- успешный `npm run release:evidence` для одного exact commit/version/status/channel.

Все P1 evidence должны относиться к `0.5.1`; материалы `0.1.0`—`0.5.0` остаются историческими.

## Условие перехода к stable

Только после выполнения P0/P1:

1. убедиться, что `openBlockers` пуст;
2. выполнить candidate release-evidence gate;
3. отдельным PR изменить machine release identity `candidate/pilot` → `stable/production`; переход зрелости не требует bump версии, если состав продукта не меняется;
4. выполнить полный CI stable commit;
5. пересобрать Debian/Astra bundles именно из stable commit;
6. повторить target identity/update/rollback/recovery binding для stable commit;
7. заполнить [SUPPORT_MATRIX.md](SUPPORT_MATRIX.md) только подтверждёнными сочетаниями;
8. создать подписанный tag и опубликовать архивы, SHA-256, SBOM и release notes.

## Что сейчас не брать

Пока P0/P1 release blockers не закрыты, не являются приоритетом:

- IAM/users/roles/ACL;
- новый frontend framework;
- микросервисы, Kubernetes, brokers и cloud dependencies;
- произвольные LLM tools/side effects;
- произвольный HTML→DOCX round-trip или второй production renderer;
- крупное расширение document model без отдельного renderer contract, fixtures и recovery проверки;
- функции, не необходимые для финального сценария установки → импорт → шаблон → выпуск → restart → backup/restore → update/rollback.

После закрытия текущего списка требуется новый полный аудит фактического `main`, а не автоматический переход к старому backlog.
