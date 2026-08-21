# Ближайшие приращения Оформлятора

Актуально на **2026-08-21**.

Текущий кодовый контур: **`0.5.3 / candidate / pilot`**. Основной пользовательский путь, space isolation, password gate, guided import/export, deterministic DOCX/XLSX generation, worker recovery, visual DOCX binding v1 и offline release tooling реализованы на уровне продукта. Следующий этап — эксплуатационная приёмка текущего кандидата, а не наращивание функциональности.

Нормативные документы: [REQUIREMENTS.md](REQUIREMENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [FINALIZATION.md](FINALIZATION.md), [ROADMAP.md](ROADMAP.md), [VERSIONING.md](VERSIONING.md).

## Принятая модель

- один общий пароль в доверенном корпоративном контуре; пользователей, ролей и ACL нет;
- пространства — жёсткие границы пользовательских данных, но не прав доступа;
- runtime полноценно работает без Internet и без LLM;
- LLM остаётся необязательным помощником без shell, SQL, кода, произвольных путей и прямого OOXML;
- документы и внешние side effects создаются только детерминированными backend-операциями;
- backup, update и rollback проектируются вместе с восстановлением.

## Что завершено в коде

- ✅ migration `0030` и отсутствие claim-on-read/write для пользовательских полей;
- ✅ guided CSV/XLSX import с structured domain errors, preview, repair и сохранением состояния;
- ✅ CSV/XLSX export выбранного пространства;
- ✅ безопасный DOCX/XLSX intake, scalar/repeat bindings, reverse-read и deterministic renderer;
- ✅ DOCX visual binding v1 для текста, header/footer, сносок и обычных таблиц;
- ✅ персональный/сводный выпуск, partial success и retry failed only;
- ✅ persisted worker queue, leases, idempotency и restart recovery;
- ✅ SMTP/network delivery и persisted schedules;
- ✅ shared password gate, scrypt/session cookie/logout/backoff;
- ✅ offline bundle, install/update/rollback/backup/restore/release-evidence tooling;
- ✅ `0.5.3`: shrink-safe вход/первый запуск и template trial, устранение вложенной button-семантики вокруг file input в generic import.

Расширение E2E/regression inventory не является текущей задачей разработки по решению владельца. Уже существующие проверки в репозитории не удаляются, но дальнейшая работа в этом цикле направлена на реальные target/P5 evidence.

## Приоритеты до stable

### P0. Защита `main`

Задача #81:

- включить branch protection/ruleset для `main`;
- запретить force-push/delete;
- требовать актуальный branch и обязательные CI checks;
- применить правила к владельцу/администраторам.

Это настройка GitHub и не заменяется файлом workflow в репозитории.

### P1. Debian target acceptance

Задача #67: чистая Debian x86-64 без сетевого маршрута во время установки, полный offline bundle точного candidate commit, systemd, реальный LibreOffice, backup, update/rollback и release-bound target act.

### P1. Astra Linux 1.7 target acceptance

Задача #68: отдельная нативная Astra package closure, offline install, LibreOffice/Chromium, CIFS/NFS, SMTP TLS, временные сетевые/SMTP ошибки, update/rollback и отдельный target act.

Debian evidence не закрывает Astra.

### P1. Office-корпус, нагрузка и recovery

Задача #69:

- ≥20 реальных DOCX + ≥20 реальных XLSX с provenance/SHA-256;
- LibreOffice + Microsoft Office;
- импорт/выпуск 10/100/1000;
- space isolation на рабочем объёме;
- worker restart без дубля;
- disk-full/corrupt object/corrupt backup;
- restore на отдельной чистой машине с совпадением SHA-256;
- сохранение password/security configuration.

### P1. Ручная P5 и финальный release evidence

Задача #70:

- два новых пользователя без устной инструкции;
- основной сценарий login → пространство → импорт → визуальная разметка DOCX → пробное заполнение → выпуск → результат → logout;
- keyboard, screen reader, 200% zoom, 320/768/1440 × light/dark;
- `ux/ux-acceptance.json` с реальными людьми и target binding;
- оба target acts + Office + recovery + UX + пустой blockers registry;
- успешный `release:evidence` для одного exact `0.5.3` candidate commit.

Evidence `0.1.0—0.5.2` остаются историческими и не закрывают текущий candidate.

## Условие перехода к stable

После P0/P1 и только после них:

1. убедиться, что `openBlockers` пуст;
2. выполнить candidate release-evidence gate;
3. отдельным изменением перевести `candidate/pilot → stable/production` без bump версии, если состав продукта не меняется;
4. собрать Debian/Astra bundles из exact stable commit;
5. повторно подтвердить target identity/update/rollback/recovery binding;
6. заполнить `SUPPORT_MATRIX.md` только фактически подтверждёнными сочетаниями;
7. создать подписанный tag и опубликовать проверенные архивы, SHA-256, SBOM и release notes.

## Что не брать до stable

- IAM/users/roles/ACL;
- новый frontend framework;
- микросервисы, Kubernetes, brokers и cloud dependencies;
- произвольные LLM tools/side effects;
- HTML→DOCX round-trip или второй production renderer;
- крупное расширение document model без отдельного renderer contract и recovery-проверки.
