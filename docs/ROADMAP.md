# План развития продукта «Оформлятор»

Актуально на **2026-08-21**.

Текущий машинный статус выпуска задаётся `RELEASE_IDENTITY.json`: **`0.5.3 / candidate / pilot`**. Версия описывает состав продукта, а `candidate/pilot` — степень его эксплуатационной готовности. Кодовый контур не считается `stable`, пока не получены фактические Debian/Astra/Office/recovery/P5 evidence.

Нормативные источники: [REQUIREMENTS.md](REQUIREMENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [FINALIZATION.md](FINALIZATION.md), [SUPPORT_MATRIX.md](SUPPORT_MATRIX.md), [VERSIONING.md](VERSIONING.md).

## Состояние этапов

| Этап | Состояние | Факт |
|---|---:|---|
| M0 Автономная поставка | 🟡 | bundle/install/update/rollback/backup tooling реализованы; фактические Debian/Astra/recovery акты отсутствуют |
| M1 Данные и пространства | ✅ | SQLite, typed properties, жёсткая space isolation, migration `0030`, отсутствие claim-on-read |
| M2 Безопасный приём DOCX/XLSX | ✅ | ZIP/XML ограничения, quarantine, Document IR и устойчивые координаты |
| M3 Шаблоны | ✅ код / 🟡 Office | DOCX/XLSX bindings, visual DOCX v1, reverse-read, preview, immutable releases; реальный Office-корпус не принят |
| M4 Ручной выпуск | ✅ код / 🟡 target | one-per-member/aggregate, partial success, retry failed only и recovery по persisted queue |
| M5 Доставка | ✅ код / 🟡 target | network share и SMTP реализованы; target network/SMTP evidence отсутствует |
| M6 Расписания | ✅ | persisted one-shot/daily/monthly rules с timezone и идемпотентностью |
| M7 Результаты и операции | ✅ | результаты, скачивание, удаление, operation center, storage maintenance |
| M8 Общий password gate | ✅ | один общий пароль, scrypt, HttpOnly session, logout/backoff; IAM/roles/ACL отсутствуют по архитектуре |
| M9 Структурные шаблоны | 🟡 | ограниченный repeat-row/range DOCX/XLSX поддержан; произвольные вложенные структуры/image binding не заявлены |
| M10 Импорт/экспорт | ✅ код / 🟡 нагрузка | guided CSV/XLSX import, structured errors, preview/repair, CSV/XLSX export; 10/100/1000 ждёт внешней приёмки |
| R1 Stable `0.5.3` | 🟡 | заблокирован целевыми evidence, а не отсутствием ещё одной крупной функции |

## Подтверждённый продуктовый контур

- пространство является жёсткой границей сущностей, групп, пользовательских полей/значений, шаблонов, импортной памяти, публикаций и связанных данных;
- чтение и preview не меняют ownership; межпространственные ссылки отклоняются backend/SQLite;
- CSV/XLSX import проходит файл → колонки → сопоставление → preview → исправление → импорт → результат и сохраняет состояние после ошибки;
- ошибки импорта имеют машинный контракт с `code`, строкой, колонкой/полем, исходным значением, severity и repair metadata;
- DOCX/XLSX production rendering остаётся детерминированным; LLM не исполняет shell/SQL/код и не изменяет OOXML напрямую;
- DOCX visual binding v1 использует проверенный Document IR и серверно валидируемые координаты, а не HTML round-trip;
- worker использует persisted queue, leases и idempotency; restart не должен создавать второй результат;
- runtime работает без Internet и без LLM;
- текущий UI использует один локальный visual token source и русскую пользовательскую терминологию;
- `0.5.3` дополнительно устраняет горизонтальный reflow входа/первого запуска и пробного заполнения, а также вложенную интерактивную семантику generic-import drop zone.

## Что блокирует stable

Эти пункты не заменяются репозиторным CI:

1. чистая offline-установка и полный target act на Debian x86-64;
2. отдельный target act на Astra Linux Special Edition 1.7;
3. настоящий LibreOffice на обоих target без `SKIPPED`;
4. ≥20 реальных DOCX и ≥20 реальных XLSX с LibreOffice и Microsoft Office;
5. импорт и выпуск на 10/100/1000 объектах без смещения, дублей и потери результатов;
6. restart/retry worker без второго результата;
7. disk-full/corrupt object/corrupt backup и восстановление на отдельном чистом стенде;
8. update/rollback без потери данных и без сброса password/security configuration;
9. два новых пользователя и ручная P5/accessibility-приёмка: keyboard, screen reader, 200% zoom, 320/768/1440, light/dark;
10. branch protection/ruleset для `main` с запретом force-push/delete и обязательными checks;
11. пустой `openBlockers` и успешный `release:evidence` для одного точного candidate commit/version/status/channel.

Evidence выпусков до `0.5.3` остаются историческими и не закрывают эти критерии для текущего кандидата.

## После stable

До закрытия release blockers крупные новые функции не приоритетны. После stable отдельными ADR/итерациями допускаются: расширенный XLSX visual grid, безопасный DrawingML/image binding, более сложные повторяемые области, расширенный поиск/групповые действия и опциональный локальный LLM-помощник без произвольных side effects.
