# Roadmap завершения Оформлятора

Текущая версия: `0.6.4`.

Статус: `candidate / pilot`.

## Реализованный продуктовый контур

Кодовая часть основного пользовательского сценария завершена: пространства и данные, CSV/XLSX import с preview/repair, библиотека шаблонов, deterministic DOCX/XLSX bindings и renderer, Visual Template Studio, публикации/доставка, persisted worker/schedules, backup/update/rollback, offline tooling, Project Control wrapper и публичный stateless `/gost`.

В `0.6.3` устранён отдельный password/login-контур и введён единый 4-значный код доступа без username/account/roles. В `0.6.4` завершён пользовательский PIN-flow: человеко-ориентированный первый запуск, экранная/обычная клавиатура, явные состояния ошибок и backoff, redirect-only compatibility для исторического `/login`, отсутствие повторного запроса кода при действующей session и regression coverage узкого экрана. Security boundary ADR-0011 не изменена.

## Что осталось до stable

Оставшаяся работа — release acceptance одного точного candidate commit, а не расширение продуктовой модели:

1. полный зелёный repository/Chromium/real-stack/offline CI exact `0.6.4`;
2. чистая offline-установка и target act Debian x86-64;
3. чистая offline-установка и target act Astra Linux 1.7 x86-64;
4. первый запуск, legacy `/login` redirect, lock/reset/reboot/update/rollback/restore 4-значного кода без username/password browser challenge;
5. реальный LibreOffice и корпус минимум 20 DOCX + 20 XLSX, включая visual projection и renderer preservation;
6. import/generation 10/100/1000, restart/retry и partial SMTP/network-share failures;
7. отдельный backup/restore на чистой машине без потери данных или duplicate result;
8. ручная P5/accessibility-приёмка двумя новыми пользователями: 320/768/1440, 200%, keyboard/screen reader, light/dark;
9. `main` ruleset/required checks и пустой `blockers.json`;
10. успешный release-evidence gate одного exact version/commit/status/channel.

До выполнения этих пунктов статус остаётся `candidate / pilot`. Зелёный CI и synthetic fixtures обязательны, но не заменяют target/Office/recovery/P5 evidence.
