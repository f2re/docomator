# Оформлятор 0.6.4

Текущая версия: `0.6.4`.

Статус выпуска: `candidate`

Канал выпуска: `pilot`

Статус: **кандидат на стабильный выпуск**. Номер версии описывает состав продукта и не означает завершение эксплуатационной приёмки. Единственный машинный источник версии, статуса и канала — `RELEASE_IDENTITY.json`.


## 2026-08-24 — безопасное app-only обновление локального LLM (`0.6.4`)

- Bundle без GGUF/llama-server сохраняет доверенный `runtime/llama` предыдущего managed release; новый runtime всегда имеет приоритет.
- Fresh install и пути вне `/opt/docomator/releases/` ничего не наследуют; GGUF остаётся в постоянном `/var/lib/docomator/models`.
- Добавлены functional regression tests; verify/backup/migration/atomic switch/rollback не ослабляются.

## 2026-08-24 — единый 4-значный код доступа (`0.6.3`)

- Удалена текущая password/login-модель: встроенная рабочая область использует один общий код из ровно четырёх цифр без имени пользователя, учётной записи и роли.
- Канонический экран — `/access`; API — `/api/v1/access/setup|unlock|lock|status`. Встроенный сервер не использует HTTP Basic Auth и не выдаёт `WWW-Authenticate`.
- Первый запуск требует один раз задать четыре цифры и сразу открывает рабочую область; повторный ввод/confirmation отсутствует.
- Scrypt, constant-time verification, signed `HttpOnly`/`SameSite=Strict` session, `Secure` over HTTPS, same-origin mutation и локальный backoff сохранены.
- Обработка истёкшей session/`401` централизована в `access-session.js`; дублирующие auth monkey-patches из бизнес-модулей удалены.
- Канонический env key — `DOCOMATOR_ACCESS_CODE_HASH`; legacy password key понимается только внутри upgrade/rollback compatibility boundary. Применённая migration `0031_shared_access_password.sql` не изменялась.
- Добавлены штатные `set-access-code.sh` и `reset-access-code.sh`; `set-password.sh`/`reset-password.sh` оставлены только тонкими переходниками для старых операторских команд.
- Offline install/bundle/target acceptance/pilot tooling используют тот же access-code contract и проверяют, что recovery helpers реально поставляются.
- Документация сведена к ADR-0011, `docs/ACCESS_CODE.md` и одному набору команд. ADR-0009 сохранён только как superseded historical decision.
- Release metadata и lockfile сгенерированы штатным `version:bump`; сторонние npm dependency versions/checksums не менялись.

## 2026-08-21 — восстановление reflow и release CI (`0.6.2`)

- Основные кнопки безопасно переносят длинные подписи на tablet/mobile и при увеличении текста до 200%, не расширяя страницу за viewport и сохраняя интерактивную зону не меньше 44 × 44 CSS px.
- Карточка рабочего пространства и её действия переходят в вертикальный reflow на узких ширинах.
- Regression fixture импорта синхронизирован с production validation без ослабления проверки отсутствующих колонок.
- Chromium E2E обновлён под актуальный visual-layout contract.

## 2026-08-21 — форматированное визуальное представление DOCX/XLSX (`0.6.0`)

- Мастер шаблона читает локальную безопасную visual-layout проекцию сохранённого DOCX/XLSX: стили, таблицы/merge, размеры, колонтитулы и поддерживаемые raster-изображения.
- XLSX отображается как read-only grid с листами; formula cells остаются недоступны для mutation binding.
- DOCX selection остаётся серверной координатой `elementId + UTF-16 offsets`; DOM не становится источником документа.
- CSP сохраняет `style-src 'self'`; external relationships, macros/OLE и неизвестные media не исполняются.
- Deterministic renderer/reverse-read, space boundary и immutable source остаются источником истины.

## Ранее реализованный базовый контур

Линия `0.1.x—0.6.2` сформировала жёсткую изоляцию пространств, typed properties, guided CSV/XLSX import/export, безопасный DOCX/XLSX intake, deterministic renderer, scalar/repeat bindings, immutable template releases, worker leases/idempotency, SMTP/network delivery, schedules, public stateless `/gost`, backup/update/rollback, offline release tooling и Project Control wrapper. Исторический общий password gate заменён в `0.6.3` ADR-0011.

## Что ещё блокирует `stable`

До `status=stable/channel=production` обязательны фактические доказательства exact `0.6.3`: чистая offline-установка Debian и Astra Linux 1.7; реальный LibreOffice; ≥20 DOCX + ≥20 XLSX; import/generation 10/100/1000; restart/retry без дублей; backup/restore; update/rollback без потери данных; ручная P5/accessibility-приёмка, включая первый запуск/recovery 4-значного кода; пустой список блокеров и успешный release-evidence.

Точный протокол: `docs/FINALIZATION.md`, `docs/SUPPORT_MATRIX.md`, `docs/UX_ACCEPTANCE_PROTOCOL.md`.
