# Roadmap завершения Оформлятора

Текущая версия: `0.7.0`.

Статус: `candidate / pilot`.

## Реализованный продуктовый контур

Кодовая часть основного пользовательского сценария включает пространства и данные, CSV/XLSX import с preview/repair, библиотеку шаблонов, deterministic DOCX/XLSX bindings и renderer, Visual Template Studio, интеллектуальное offline-извлечение данных из DOCX/XLSX, публикации/доставку, persisted worker/schedules, backup/update/rollback, offline tooling, Project Control wrapper и публичный stateless `/gost`.

В `0.6.3` устранён отдельный password/login-контур и введён единый 4-значный код доступа без username/account/roles. В `0.6.4` завершён пользовательский PIN-flow. В `0.6.5` исправлен реальный разрыв шаблонизатора: пользовательские поля сотрудников текущего пространства больше не скрываются UI-категориями, длинные списки можно полноценно листать мышью и клавиатурой. В `0.6.6` рабочая область сопоставления переведена в горизонтальную компоновку «документ сверху — настройки снизу», а выпадающие списки ограничены границами поля. В `0.7.0` добавлен automatic-first контур извлечения: детерминированное предложение структуры DOCX/XLSX, visual correction, batch до 100 документов, provenance/structured issues, versioned corrections и CSV без записи preview в предметные данные. Security boundary ADR-0011 не изменена.

## Что осталось до stable

Оставшаяся работа — release acceptance одного точного candidate commit и закрытие обнаруженных регрессий, а не расширение продуктовой модели:

1. полный зелёный repository/Chromium/real-stack/offline CI exact `0.7.0`;
2. сквозной acceptance `пространство → сотрудники/группа → пользовательские поля → шаблон → заполненный документ` и `DOCX/XLSX → авторазбор → визуальная коррекция → batch → CSV`, включая изоляцию второго пространства;
3. чистая offline-установка и target act Debian x86-64;
4. чистая offline-установка и target act Astra Linux 1.7 x86-64;
5. первый запуск, legacy `/login` redirect, lock/reset/reboot/update/rollback/restore 4-значного кода без username/password browser challenge;
6. реальный LibreOffice и корпус минимум 20 DOCX + 20 XLSX, включая visual projection и renderer preservation;
7. import/generation 10/100/1000, extraction batch 1/10/100, restart/retry и partial SMTP/network-share failures;
8. отдельный backup/restore на чистой машине без потери данных или duplicate result;
9. ручная P5/accessibility-приёмка двумя новыми пользователями: 320/768/1440, 200%, keyboard/screen reader, light/dark;
10. `main` ruleset/required checks, пустой `blockers.json` и успешный release-evidence gate одного exact version/commit/status/channel.

До выполнения этих пунктов статус остаётся `candidate / pilot`. Зелёный CI и synthetic fixtures обязательны, но не заменяют target/Office/recovery/P5 evidence.
