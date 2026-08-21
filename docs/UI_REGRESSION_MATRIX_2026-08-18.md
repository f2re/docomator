# UI regression matrix — 2026-08-18

Статус: репозиторный regression-контракт для `0.5.2 candidate/pilot`.

Baseline реализации: `main` `51b2c767eb0277fda49493481eed98d8c3d317c4`.

Связано с `#84`, `docs/UX_UI_SPECIFICATION.md`, `docs/BRANDING.md`, `docs/INTERFACE_HIERARCHY.md` и `docs/UX_ACCEPTANCE_PROTOCOL.md`.

## Причина изменения

Канонические верхнеуровневые экраны уже использовали общий `CANONICAL_UI_VIEWS`, но важные диалоги и ошибочные состояния проверялись отдельными E2E-сценариями. Из-за этого новая или изменённая поверхность могла сохранить предметный regression test, но выпасть из общей проверки 320/768/1440, 200% text zoom, touch targets, axe и visual artifacts.

Первый полный прогон новой матрицы выявил реальные runtime-дефекты: min-content overflow в импорте сотрудников, мастере шаблона и password gate, отсутствие доступных имён у классификаций публикаций и вложенную интерактивность drag-and-drop зоны произвольного импорта. Они исправлены в том же вертикальном изменении и закреплены матрицей, поэтому продуктовая версия повышена `0.5.1 → 0.5.2`. API/domain, данные, миграции, renderer, space isolation и security model при этом не меняются.

## Единый inventory

`tests/e2e/ui-regression-inventory.mjs` теперь содержит два вида поверхностей:

- `CANONICAL_UI_VIEWS` — все канонические экраны приложения;
- `CANONICAL_UI_STATES` — критические диалоги, recovery/error states и password-gate surfaces.

В inventory входят:

1. добавление сотрудника;
2. редактирование сотрудника;
3. preview CSV/XLSX-импорта сотрудников;
4. preview импорта произвольных объектов;
5. связи авторов и классификаций публикации;
6. ошибка пробного заполнения шаблона с сохранённым значением;
7. preflight выпуска с отсутствующими обязательными данными;
8. ошибка центра операций с явным повтором;
9. обычный вход по общему паролю;
10. первый запуск и создание общего пароля.

Mocked states получают setup/open-функцию из того же inventory. Auth states используют реальный Fastify/SQLite password gate, а не API mock.

## Автоматические проверки

`tests/e2e/ui-state-regression.spec.mjs` для каждого mocked state проверяет:

- фактическое открытие заявленной поверхности;
- отсутствие page-level horizontal overflow;
- интерактивные зоны не меньше `44 × 44 CSS px`;
- axe по действующему набору WCAG 2.0/2.1/2.2 A/AA tags;
- попадание фокуса внутрь модального workflow там, где это применимо;
- возврат фокуса после `Escape` для ключевых dialog flows;
- отсутствие horizontal overflow при `200%` text zoom на 320/768;
- screenshot artifact на крайних ширинах 320 и 1440;
- light на узкой стороне и dark на широкой стороне матрицы.

`tests/e2e/auth-surface-regression.spec.mjs` отдельно запускает настоящий password-enabled API на временной SQLite БД и применяет тот же контракт к:

- `/login` с уже настроенным общим паролем;
- `/login` в режиме первого запуска без настроенного пароля.

Таким образом password gate остаётся частью общей UI regression-модели, не превращаясь в mocked authentication.

## Исправления, обнаруженные матрицей

- Общий interaction contract теперь явно разрешает сжатие сложных import/template surfaces и сохраняет локальный scroll только у табличных контейнеров.
- Динамические select/input классификации публикации получают осмысленные `aria-label` поверх пользовательского названия классификации.
- В generic import подписанный `input[type=file]` остаётся единственным интерактивным контролом; внешний drop-zone не объявляется вложенной кнопкой.
- Карточка входа/первого запуска использует `minmax(0, 1fr)`, `min-width: 0` и перенос длинного текста, поэтому 200% zoom не расширяет страницу.
- Проверка возврата фокуса учитывает responsive-дубликаты кнопки открытия и требует, чтобы `document.activeElement` соответствовал реальному trigger selector.

## Что не заменяется этой матрицей

Автоматическая матрица не закрывает ручную P5/target acceptance. До stable по-прежнему требуются:

- два новых пользователя без устной инструкции;
- реальный экранный диктор в согласованной Linux-среде;
- target-bound PNG/axe artifacts;
- Debian/Astra acceptance;
- настоящий LibreOffice и Office-корпус;
- recovery/update/rollback evidence одного точного release commit.

`#70`, target issues и release-evidence gate остаются отдельными блокирующими контурами.
