# Матрица целевой совместимости

Статус выпуска: `candidate`

Канал выпуска: `pilot`

Статус: **кандидатные строки зафиксированы; целевые акты ещё не получены**

Текущая версия: `0.7.1`.

Дата: **2026-09-02**

Эта матрица относится к `SYS-002—003`, `DOC-006—007`, `OFF-001—005`, `OFF-009—014`, `SEC-008`, `UX-015—022` и `NFR-011—012`. Состояние `проверено` разрешено только при сохранённом акте конкретной машины, связанном с exact version/commit/release metadata SHA-256. CI разработчика не заменяет target act.

## Кандидатные платформы

| Идентификатор | ОС и архитектура | Node.js | LibreOffice | Состояние | Что отсутствует |
|---|---|---|---|---|---|
| `debian-x86_64-pending` | Debian GNU/Linux, x86-64; точный release/glibc фиксируются в акте | `24.18.0` из bundle | точная версия Writer/Calc из замкнутого `.deb` набора | не проверено | SHA bundle, release ОС, glibc, LO, дата и SHA акта |
| `astra-1.7-x86_64-pending` | Astra Linux Special Edition 1.7, x86-64; update/glibc фиксируются в акте | `24.18.0` из bundle | совместимая Writer/Calc для выбранного update | не проверено | update Astra, SHA bundle, glibc, LO, дата и SHA акта |

Иные ОС, архитектуры и версии Office не поддерживаются без отдельной строки и отдельного акта. Microsoft Office не входит в server runtime; открытие результатов в нём относится к Office compatibility acceptance.

## Обязательное содержимое target act

- точные ОС/update, `uname -m`, glibc;
- SHA-256 автономного архива, Git commit и `release.json`;
- встроенный Node.js и target profile `debian`/`astra`;
- подтверждение `DEPENDENCY_CLOSURE=full`, Chromium/LibreOffice inventory;
- физически отсутствующий Internet route во время target install;
- успешные `verify-bundle.sh`, root `smoke-test.sh`, `target-release-gate.sh` без неожиданного `SKIPPED`;
- первый запуск с одним 4-значным кодом без имени пользователя/password form, включая экранную и обычную клавиатуру и отсутствие horizontal overflow на 320 px;
- исторический `/login` только перенаправляет на `/access` и не показывает legacy login/password UI;
- `/api/v1/access/unlock` и рабочая session cookie, `401` без `WWW-Authenticate` для закрытой рабочей области;
- локальный recovery `reset-access-code.sh` и `first-run.sh --reset-code` без потери данных;
- CSV/XLSX import, DOCX/XLSX generation, LibreOffice preview и reverse-read;
- реальный сценарий `раздел данных → сотрудники/группа → пользовательские поля → шаблон → заполненный документ`, включая выбор длинного списка без обязательного поиска и отрицательную изоляцию второго раздела;
- result list/read/download/view/delete работают только через явный текущий `spaceId`; раздел A не видит и не изменяет результат B;
- `/gost` без session cookie при сохранении закрытого обычного space API;
- restart API/worker, backup/restore, update/rollback с сохранением credential/session configuration;
- полный `ux-acceptance-gate.sh` и ручная P5-приёмка того же release binding.

## Office и Visual Template Studio

Каталог `examples/` содержит синтетические SHA-256-зафиксированные fixtures для детерминированных regression checks. Он не доказывает совместимость конкретных Microsoft Office/LibreOffice.

Visual Template Studio показывает безопасную read-only проекцию DOCX/XLSX. Она не является обещанием pixel-perfect pagination. Реальный corpus должен проверить как минимум стили, таблицы/merge, колонтитулы, формулы/OMML, изображения, повторяемые блоки, неизвестные OOXML parts и фактическое открытие результатов в согласованных Office-программах.

Для `stable` требуется ≥20 уникальных DOCX + ≥20 уникальных XLSX с provenance/SHA-256, а также отдельный recovery act и ручная UX/P5-приёмка.

## Исторические свидетельства

Акты `0.1.x—0.6.7` остаются историческими и **не закрывают** acceptance `0.6.8`. Исправление space-scoped Results требует нового evidence exact `0.6.8`, даже при неизменной security boundary ADR-0011.

## Финальная фиксация

После заполнения target rows каталоги Debian/Astra вместе с P5, recovery, Office corpus и `blockers.json` должны пройти `scripts/ci/release-evidence-gate.mjs`. Только после этого конкретная платформа может быть помечена `проверено`, а release status — отдельно переведён из candidate/pilot в stable/production.
