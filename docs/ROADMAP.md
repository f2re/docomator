# Roadmap завершения Оформлятора

Текущая версия: `0.6.8`.

Статус: `candidate / pilot`.

## Реализованный продуктовый контур

Кодовая часть основного пользовательского сценария включает пространства и данные, CSV/XLSX import с preview/repair, библиотеку шаблонов, deterministic DOCX/XLSX bindings и renderer, Visual Template Studio, публикации/доставку, persisted worker/schedules, backup/update/rollback, offline tooling, Project Control wrapper и публичный stateless `/gost`.

В `0.6.3` устранён отдельный password/login-контур и введён единый 4-значный код доступа без username/account/roles. В `0.6.4` завершён пользовательский PIN-flow. В `0.6.5` исправлен реальный разрыв шаблонизатора: пользовательские поля сотрудников текущего пространства больше не скрываются UI-категориями, длинные списки можно полноценно листать мышью и клавиатурой. В `0.6.6` рабочая область сопоставления переведена в горизонтальную компоновку «документ сверху — настройки снизу», а выпадающие списки ограничены границами поля. В `0.6.7` упрощён выпуск документов: внутренняя конкурирующая нумерация заменена иконками, проверка и формирование сведены к одному честно обозначенному действию, а изменение состава после проверки инвалидирует подготовленный снимок. В `0.6.8` устранён глобальный result bypass: persisted результаты list/read/download/view/delete доступны только через явный `spaceId`, а UI игнорирует поздний result response предыдущего раздела. Security boundary ADR-0011 не изменена.

## Что осталось до stable

Оставшаяся работа — release acceptance одного точного candidate commit и закрытие обнаруженных регрессий, а не расширение продуктовой модели:

1. полный зелёный repository/Chromium/real-stack/offline CI exact `0.6.8`;
2. сквозной acceptance `раздел данных → сотрудники/группа → пользовательские поля → шаблон → заполненный документ`, включая отрицательную изоляцию второго раздела и результатов;
3. чистая offline-установка и target act Debian x86-64;
4. чистая offline-установка и target act Astra Linux 1.7 x86-64;
5. первый запуск, legacy `/login` redirect, lock/reset/reboot/update/rollback/restore 4-значного кода без username/password browser challenge;
6. реальный LibreOffice и корпус минимум 20 DOCX + 20 XLSX, включая visual projection и renderer preservation;
7. import/generation 10/100/1000, restart/retry и partial SMTP/network-share failures;
8. отдельный backup/restore на чистой машине без потери данных или duplicate result;
9. ручная P5/accessibility-приёмка двумя новыми пользователями: 320/768/1440, 200%, keyboard/screen reader, light/dark;
10. `main` ruleset/required checks, пустой `blockers.json` и успешный release-evidence gate одного exact version/commit/status/channel.

До выполнения этих пунктов статус остаётся `candidate / pilot`. Зелёный CI и synthetic fixtures обязательны, но не заменяют target/Office/recovery/P5 evidence.
