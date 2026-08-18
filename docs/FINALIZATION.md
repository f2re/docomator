# Финализация стабильного выпуска «Оформлятора»

Статус выпуска: `candidate`

Канал выпуска: `pilot`

Текущая версия: `0.6.0`.

Этот документ описывает fail-closed этап между текущим кандидатом `0.6.0` и стабильным выпуском той же версии. Номер версии сам по себе не означает стабильность: машинный статус задаётся только `RELEASE_IDENTITY.json`. Пока он содержит `status=candidate`, `channel=pilot`, разрешён только контролируемый пилот на обезличенных данных.

Stable допускается только после фактических доказательств двух целевых ОС, ручной пользовательской приёмки, восстановления и совместимости реальных Office-документов.

## 1. Создать каркас доказательств

Из чистого checkout проверяемого commit:

```bash
npm run release:evidence:init -- /srv/docomator-release-evidence
```

Будет создана структура `targets/debian`, `targets/astra`, `ux`, `recovery`, `office`, `blockers.json` и README.

## 2. Получить целевые акты

На чистых Debian и Astra Linux выполните `target-acceptance.sh` из соответствующего полного offline bundle. Полный каталог результата копируется без изменения в `targets/debian` или `targets/astra`; внутри обязаны остаться `target-acceptance.json`, `manifest.sha256`, pilot JSON/Markdown, Playwright/axe и журналы всех этапов.

Astra Linux-прогон обязан использовать `--require-network --require-smtp`.

В `0.6.0` target acceptance дополнительно проверяет:

- `/gost` без cookie и сохранение `401` для обычного space API без cookie;
- DOCX Template Studio: body/header/footer/notes, форматированные runs, raster image, таблица, клавиатура, direct selection и отсутствие глобального overflow;
- XLSX Template Studio: sheet grid, dimensions, merge, formatting, print header/footer, formula marker, raster image и server-validated selection;
- fallback при недоступном rich visual endpoint: данные/черновик не меняются, старый безопасный выбор остаётся доступен;
- точный Office/PDF preview после подстановки, поскольку browser Visual IR не считается пиксельно идентичным Office.

## 3. Завершить ручную P5-приёмку

Заполните `ux/ux-acceptance.json` по `UX_ACCEPTANCE_PROTOCOL.md`. Акт должен содержать Linux-среду и release binding, проверки клавиатуры/фокуса/скринридера/масштаба, light/dark screenshots, Playwright/axe JSON, двух новых пользователей без обучения и итог `passed`.

Отдельно пользователь должен без знания OOXML:

1. открыть DOCX и визуально узнать основной документ, таблицу/колонтитул/изображение и форматированный текст;
2. выделить конкретный заменяемый фрагмент и назначить поле;
3. открыть XLSX, переключить лист, выбрать ячейку и отличить формулу от заменяемого значения;
4. понять предупреждение о конструкциях, которые подтверждаются пробной копией/PDF;
5. завершить пробное заполнение без потери введённых данных.

## 4. Подтвердить восстановление

На отдельном чистом стенде восстановите копию, созданную целевой приёмкой. В `recovery/restore-act.json` укажите точный release, commit, SHA-256 исходной копии, источник Debian/Astra, фактические и ожидаемые количества пространств, объектов, групп, шаблонов, результатов и deliveries, а также результат сравнения контрольных сумм.

После восстановления API и worker должны штатно продолжить работу; update/rollback также проверяются без потери данных.

## 5. Проверить реальные Office-документы

`office/compatibility.json` должен содержать не менее 20 уникальных DOCX и 20 уникальных XLSX. Для каждого файла фиксируются происхождение, программа-создатель, SHA-256 и успешное открытие результата в согласованных LibreOffice и Microsoft Office без видимых технических маркеров, повреждения стилей, таблиц, формул, рисунков или колонтитулов.

Для DOCX `0.6.0` отдельно проверяются:

- bold/italic/underline/strike, цвет/highlight, font family/size, super/subscript;
- paragraph alignment/indent/spacing и page geometry;
- body/header/footer/footnotes/endnotes;
- table widths, horizontal/vertical merge, fills/borders/alignment;
- raster images и сохранность неподдерживаемых DrawingML/SmartArt/chart/OLE частей;
- formatter профиля и visual binding на одном и том же исходнике.

Для XLSX отдельно проверяются:

- row/column dimensions, merges, styles/fills/borders/alignment/wrap;
- number/date/time/percent formats и формулы без изменения formula expression;
- print header/footer и raster drawings;
- сохранность charts/shapes/conditional formatting/theme-зависимых конструкций, даже если браузер их не воспроизводит полностью.

Браузерная проекция не должна выдаваться за пиксельно идентичный Word/Excel layout. Наличие rich Visual IR в CI не заменяет ручную Office-проверку.

## 6. Закрыть блокирующие дефекты

`blockers.json` принимается только при пустом `openBlockers`. Потеря данных, нарушение space isolation, дубликаты, неправильный документ, неработающий update/rollback/restore, установка или основной путь остаются блокирующими.

## 7. Выполнить финальный gate кандидата

```bash
npm run release:evidence -- \
  /srv/docomator-release-evidence \
  --expected-commit '<полный Git SHA>' \
  --expected-version '0.6.0'
```

Gate принимает только точный состав и связи доказательств. Любые evidence для `0.1.0`—`0.5.0` остаются историей и не закрывают gate `0.6.0`.

## 8. Выпустить stable

Только после успешного gate:

1. в отдельном PR изменить `RELEASE_IDENTITY.json` с `candidate/pilot` на `stable/production`;
2. не менять номер `0.6.0` только ради смены зрелости, если состав продукта не меняется;
3. выполнить полный CI stable commit;
4. собрать Debian/Astra bundles именно из stable commit;
5. повторно подтвердить target identity, update/rollback и восстановление для stable commit;
6. обновить `SUPPORT_MATRIX.md` только фактически подтверждёнными сочетаниями;
7. создать подписанный tag и опубликовать проверенные архивы, SHA-256, SBOM и release notes.

До выполнения этих пунктов никакой документ, issue, bundle или UI не должен называть текущий выпуск стабильным.
