# Проверка Docomator 0.1.0-rc.1

Этот документ фиксирует состав первого release candidate после удаления параллельных поколений интерфейсного кода.

## Канонические модули

В поставке поддерживаются только следующие актуальные реализации:

- `bulk-data-import.js` и `bulk-data-import.css`;
- `document-schedules.js` и `document-schedules.css`;
- `operator-workflows.js` и `operator-workflows.css`;
- `template-multi-trial.js`;
- `template-row-editor.js`;
- `template-workflow.css`.

Файлы с суффиксами `v2`, `v3` и `recovery`, относящиеся к этим потокам, удалены. Обратная совместимость на уровне параллельных UI-модулей не поддерживается.

## Обязательные автоматические проверки

Перед слиянием release candidate должен успешно пройти:

1. полный `npm run check`;
2. миграцию чистой SQLite;
3. Chromium-сценарии на ширинах 320, 768 и 1440 пикселей;
4. real-stack сценарий с настоящими API, SQLite и worker;
5. сборку и повторную проверку generic offline bundle;
6. `check:canonical-ui` и `check:release-version`.

## Граница выпуска

Версия `0.1.0-rc.1` предназначена для контролируемого пилота на обезличенных данных. Целевые заявления о Debian, Astra Linux, LibreOffice, Microsoft Office и восстановлении делаются только после соответствующих стендовых актов.
