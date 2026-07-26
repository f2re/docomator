from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(relative_path: str, old: str, new: str) -> None:
    path = ROOT / relative_path
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(
            f"{relative_path}: ожидалось одно вхождение, найдено {count}"
        )
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {relative_path}")


replace_once(
    "apps/api/src/ui-routes.ts",
    '      "help-center.css"\n',
    '      "help-center.css",\n      "interface-hierarchy.css"\n',
)
replace_once(
    "apps/api/src/ui-routes.ts",
    '      "help-project-documents.js"\n',
    '      "help-project-documents.js",\n      "interface-hierarchy.js"\n',
)

replace_once(
    "apps/api/ui/app.js",
    '''applyTheme(state.theme);
publishCurrentSpace();
attachEvents();
initializeTemplateCatalogSync();
selectView(location.hash.slice(1) in views ? location.hash.slice(1) : "overview");
loadData();''',
    '''const initialViewHash = location.hash.slice(1);
const initialSpecialHash = initialViewHash === "help" ? "#help" : "";
applyTheme(state.theme);
publishCurrentSpace();
attachEvents();
initializeTemplateCatalogSync();
selectView(initialViewHash in views ? initialViewHash : "overview");
if (initialSpecialHash) window.history.replaceState(null, "", initialSpecialHash);
loadData();''',
)

replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''  function rowEditorSemantic(header) {
    const value = rowEditorNormalize(header);
    if (/^(?:#|№|n|номер|п п|порядковый номер)$/u.test(value)) return "position";''',
    '''  function rowEditorSemantic(header) {
    const raw = String(header || "").normalize("NFKC").trim();
    if (/^(?:#|№)$/u.test(raw)) return "position";
    const value = rowEditorNormalize(header);
    if (/^(?:n|номер|п п|порядковый номер)$/u.test(value)) return "position";''',
)
replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''      panel.querySelector("#rowEditorContinueTrial")?.addEventListener("click", () =>
        globalThis.docomatorTemplateWizard?.complete(2, {
          sourceId: latest.sourceRecordId || structureWizardArtifacts().sourceId,
          draftId: draft.id
        })
      );''',
    '''      panel.querySelector("#rowEditorContinueTrial")?.addEventListener("click", () => {
        globalThis.docomatorTemplateWizard?.complete(2, {
          sourceId: latest.sourceRecordId || structureWizardArtifacts().sourceId,
          draftId: draft.id
        });
        if (typeof loadMultiTrialDrafts === "function") void loadMultiTrialDrafts();
      });''',
)

replace_once(
    "apps/api/ui/interface-hierarchy.js",
    '''  const documentsView = interfaceQuery('[data-view="documents"]');
  if (documentsView) {
    new MutationObserver(interfaceScheduleSync).observe(documentsView, { childList: true, subtree: true });
  }

  const connectionBadge = interfaceQuery("#connectionBadge");''',
    '''  const documentsView = interfaceQuery('[data-view="documents"]');
  if (documentsView) {
    new MutationObserver(interfaceScheduleSync).observe(documentsView, { childList: true, subtree: true });
  }

  const overviewView = interfaceQuery('[data-view="overview"]');
  if (overviewView) {
    new MutationObserver(interfaceScheduleSync).observe(overviewView, { childList: true });
  }

  const connectionBadge = interfaceQuery("#connectionBadge");''',
)

replace_once(
    "apps/api/ui/interface-hierarchy.css",
    '''.status-ribbon.is-routine:not(.is-user-expanded) {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  clip: rect(0 0 0 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
  clip-path: inset(50%) !important;
}''',
    '''.status-ribbon.is-routine:not(.is-user-expanded) {
  display: none;
}''',
)

replace_once(
    "apps/api/src/ui-routes.test.ts",
    '''    assert.match(styles.body, /--surface/);

    assert.equal(script.statusCode, 200);''',
    '''    assert.match(styles.body, /--surface/);
    assert.match(styles.body, /--purple/);

    assert.equal(script.statusCode, 200);''',
)
replace_once(
    "apps/api/src/ui-routes.test.ts",
    '''    assert.match(script.headers["content-type"] ?? "", /^text\/javascript/);
    assert.doesNotMatch(script.body, /https?:\/\//);''',
    '''    assert.match(script.headers["content-type"] ?? "", /^text\/javascript/);
    assert.match(script.body, /interfaceWorkflowSteps/);
    assert.doesNotMatch(script.body, /https?:\/\//);''',
)

replace_once(
    "docs/UX_UI_SPECIFICATION.md",
    '''Интерфейс опирается на принципы ясности macOS и iOS: спокойную иерархию, системную типографику, крупные области нажатия, предсказуемую навигацию и сдержанную анимацию. Это не означает копирование товарных знаков или закрытых компонентов Apple.

Основные свойства:''',
    '''Интерфейс опирается на принципы ясности macOS и iOS: спокойную иерархию, системную типографику, крупные области нажатия, предсказуемую навигацию и сдержанную анимацию. Это не означает копирование товарных знаков или закрытых компонентов Apple.

Практическая система уровней поверхностей, смысловых цветов, отступов и четырёх этапов основного процесса зафиксирована в [концепции визуальной иерархии](INTERFACE_HIERARCHY.md).

Основные свойства:''',
)

replace_once(
    "docs/ROADMAP.md",
    '''- [ ] UX-0: 🟡 новая Главная и единый текущий контекст работают; компактный переключатель нескольких разделов ещё проходит приёмку;
- [x] UX-1: карточка сотрудника и создание поля без машинных ключей;
- [x] UX-2: импорт списка без ключей сущности, свойства и группы;
- [x] UX-3: подключение шаблона разделено на четыре последовательных шага; поля выбираются по русским названиям, прогресс проверяется по серверным артефактам выбранного раздела, а после перезагрузки мастер продолжает с сохранённого исходника без повторного выбора файла;
- [x] UX-4: единый выпуск N личных карточек и переход в результаты;
- [x] UX-4.5: центр сохраняемых операций в «Результатах» объединяет предпросмотр, выпуск и доставку выбранного раздела, показывает ожидание/повтор/успех/частичный результат/ошибку и восстанавливается после перезагрузки без новой очереди;
- [ ] UX-5: 🟡 визуальная разгрузка, автономный release-bound браузерный/axe gate и закрытый по умолчанию валидатор акта включены; остаются фактический целевой прогон, ручная доступность, Linux-эталоны и приёмка без инструкции.''',
    '''- [x] UX-0: Главная показывает один следующий шаг, четыре этапа рабочего процесса и компактный текущий контекст;
- [x] UX-1: карточка сотрудника и создание поля без машинных ключей;
- [x] UX-2: импорт списка без ключей сущности, свойства и группы;
- [x] UX-3: подключение шаблона разделено на четыре последовательных шага; поля выбираются по русским названиям, прогресс проверяется по серверным артефактам выбранного раздела, а после перезагрузки мастер продолжает с сохранённого исходника без повторного выбора файла;
- [x] UX-4: единый выпуск N личных карточек и переход в результаты;
- [x] UX-4.5: центр сохраняемых операций в «Результатах» объединяет предпросмотр, выпуск и доставку выбранного раздела, показывает ожидание/повтор/успех/частичный результат/ошибку и восстанавливается после перезагрузки без новой очереди;
- [x] UX-5: реализованы визуальная иерархия, смысловые акценты, компактное состояние системы, самостоятельный экран «Управление», мобильная помощь и подъём ошибок над хронологией результатов. Целевая Linux-приёмка и ручная проверка доступности остаются внешними свидетельствами релизного контура.''',
)

replace_once(
    "docs/RELEASE_NOTES.md",
    '''## Назначение кандидата''',
    '''## 2026-07-26 — визуальная иерархия интерфейса

- Главная показывает четыре этапа: данные, шаблон, выпуск и результат; текущий этап выделен, завершённые отмечены отдельно.
- Обычное состояние «Данные актуальны» свернуто в компактный индикатор; полная плашка остаётся для загрузки, предупреждения, ошибки и результата действия.
- «Настройки» заменены самостоятельным экраном «Управление» с текущим разделом, оформлением, справочниками и закрытой диагностикой.
- Эксплуатационная готовность перенесена с Главной в диагностический блок, поэтому ежедневный процесс начинается со следующего пользовательского шага.
- Ошибки и частичные результаты подняты над хронологией и отмечены в навигации; готовые файлы при этом не скрываются.
- Руководство получило поиск по отдельным словам, мобильный вход в контекстную помощь и устойчивое восстановление после перезагрузки адреса `#help`.
- Исправлено распознавание колонки `№` и переход от сохранённой повторяемой строки к общей проверке шаблона.

## Назначение кандидата''',
)

print("interface hierarchy patches applied")
