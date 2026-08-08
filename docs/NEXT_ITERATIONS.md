# Ближайшие приращения Docomator

Актуально на **2026-08-08**.

Текущий кодовый контур находится в состоянии **`0.1.0 / candidate / pilot`**. Основной пользовательский путь, space isolation, password gate, import/export, deterministic DOCX/XLSX generation, worker recovery и generic offline bundle реализованы и проходят репозиторный CI. Следующая работа — не расширение продукта, а получение эксплуатационных доказательств для stable.

Нормативные документы: [REQUIREMENTS.md](REQUIREMENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [FINALIZATION.md](FINALIZATION.md), [ROADMAP.md](ROADMAP.md).

## Принятая модель эксплуатации

- Docomator работает во внутреннем доверенном корпоративном контуре;
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
- ✅ персональный/сводный выпуск, partial success и retry failed only;
- ✅ persisted worker queue, leases и restart recovery;
- ✅ SMTP/network delivery и расписания на уровне кода;
- ✅ общий password gate, scrypt/session cookie/logout/backoff;
- ✅ UI regression 320/768/1440, keyboard/focus, reduced motion, 200% zoom;
- ✅ generic offline archive, install/update/rollback/backup/release-evidence tooling;
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
- контрольная backup;
- update/rollback;
- сохранённый release-bound `target-acceptance.json` и manifest.

### P1. Astra Linux 1.7 target acceptance

Задача #68 выполняется отдельно от Debian:

- нативный package closure Astra;
- чистая offline-установка;
- обязательные `--require-network --require-smtp`;
- LibreOffice/Chromium, CIFS/NFS и SMTP TLS;
- временные сетевые/SMTP ошибки и повтор;
- update/rollback без потери данных;
- отдельный Astra target act.

Debian evidence не закрывает Astra.

### P1. Реальный Office-корпус, нагрузка и recovery

Задача #69:

- ≥20 реальных DOCX + ≥20 реальных XLSX с provenance/SHA-256;
- LibreOffice + Microsoft Office;
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
- полный основной сценарий от login и пространства до импорта, шаблона, выпуска, скачивания и logout;
- клавиатура, экранный диктор, 320/768/1440 × light/dark, 200% zoom;
- `ux/ux-acceptance.json` с реальными людьми и target binding;
- оба target acts + Office + recovery + UX + пустой blockers registry;
- успешный `npm run release:evidence` для одного exact commit/version/status/channel.

## Условие перехода к stable

Только после выполнения P0/P1:

1. убедиться, что `openBlockers` пуст;
2. выполнить candidate release-evidence gate;
3. отдельным PR изменить machine release identity `candidate/pilot` → `stable/production` без ложной смены продуктового смысла;
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
- крупное расширение document model;
- функции, не необходимые для финального сценария установки → импорт → шаблон → выпуск → restart → backup/restore → update/rollback.

После закрытия текущего списка требуется новый полный аудит фактического `main`, а не автоматический переход к старому backlog.
