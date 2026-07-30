# Безопасное администрирование базы данных

## Назначение

Раздел **Управление → Таблицы базы данных** предназначен для диагностики и аварийной выгрузки данных, когда требуется проверить фактическое содержимое SQLite независимо от предметных экранов. Он не заменяет интерфейс сотрудников, объектов, шаблонов и результатов.

Инструмент предоставляет:

- список прикладных таблиц, число строк и описание колонок;
- постраничный просмотр;
- поиск по текстовому представлению первых двадцати колонок;
- сортировку по выбранной существующей колонке;
- экспорт CSV или JSON;
- `quick_check` и проверку внешних ключей;
- безопасное создание нового типизированного поля данных.

Произвольный SQL, редактирование и удаление строк, `ALTER TABLE` и изменение применённых миграций недоступны. Граница зафиксирована в [ADR-0007](adr/0007-safe-database-administration.md).

## Веб-интерфейс

1. Откройте **Управление**.
2. Выберите **Таблицы базы данных**.
3. Выберите таблицу в списке. По умолчанию открывается `entities`, если она существует.
4. Укажите поиск, колонку и направление сортировки.
5. Для выгрузки используйте **Экспорт CSV** или **Экспорт JSON**.
6. Нажмите **Проверить целостность**, чтобы выполнить SQLite `quick_check` и проверку внешних ключей.

CSV создаётся в UTF-8 с BOM и разделителем `;`. Значения, похожие на формулы электронных таблиц, экспортируются как безопасный текст. BLOB в таблице не раскрывается: показывается только его размер.

## Добавление поля данных

Кнопка **Добавить поле данных** не добавляет колонку в SQLite. Она создаёт определение свойства Docomator:

- понятное название;
- тип значения;
- тип объектов, к которому поле применимо;
- класс данных;
- единицу измерения и описание.

После создания поле доступно в карточках объектов, импорте и редакторе шаблонов. Значения сохраняются в версионируемой таблице свойств и проходят штатную проверку типов.

## Консольный инструмент

После установки сценарий расположен здесь:

```bash
/opt/docomator/current/app/scripts/runtime/database-admin.mjs
```

Для штатной базы запускайте его от пользователя сервиса либо с явно заданным каталогом данных:

```bash
sudo -u docomator env \
  DOCOMATOR_DATA_DIR=/var/lib/docomator \
  /opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/database-admin.mjs tables
```

### Список и описание таблиц

```bash
sudo -u docomator env DOCOMATOR_DATA_DIR=/var/lib/docomator \
  /opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/database-admin.mjs \
  describe entities
```

### Просмотр, поиск и сортировка

```bash
sudo -u docomator env DOCOMATOR_DATA_DIR=/var/lib/docomator \
  /opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/database-admin.mjs \
  rows entities \
  --search Иванов \
  --sort display_name \
  --limit 100
```

Для обратного порядка добавьте `--desc`. Для следующей страницы используйте `--offset 100`.

### Экспорт

```bash
install -d -m 0750 /var/lib/docomator/exports
chown docomator:docomator /var/lib/docomator/exports

sudo -u docomator env DOCOMATOR_DATA_DIR=/var/lib/docomator \
  /opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/database-admin.mjs \
  export entities \
  --format csv \
  --sort display_name \
  --output /var/lib/docomator/exports/entities.csv
```

JSON-выгрузка:

```bash
sudo -u docomator env DOCOMATOR_DATA_DIR=/var/lib/docomator \
  /opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/database-admin.mjs \
  export entity_property_values \
  --format json \
  --output /var/lib/docomator/exports/entity-property-values.json
```

Одна операция экспортирует не более 10 000 строк. Большую таблицу следует делить поиском либо использовать утверждённый процесс резервного копирования.

### Проверка целостности

```bash
sudo -u docomator env DOCOMATOR_DATA_DIR=/var/lib/docomator \
  /opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/database-admin.mjs check
```

Ненулевой код возврата означает, что обновление, ручное исправление или дальнейшую запись данных следует остановить до анализа резервной копии.

### Создание логического поля

```bash
sudo -u docomator env DOCOMATOR_DATA_DIR=/var/lib/docomator \
  /opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/database-admin.mjs \
  create-property \
  --label "Инвентарный номер" \
  --type string \
  --applies-to equipment \
  --sensitivity internal
```

## Что делать при необходимости исправить значения

Безопасный порядок:

1. Создайте проверенную резервную копию.
2. Выполните экспорт нужной таблицы для анализа.
3. Исправьте исходный CSV/XLSX и повторите импорт по устойчивому идентификатору либо используйте предметную карточку объекта.
4. Для системного преобразования подготовьте новую миграцию или отдельный одноразовый сценарий с тестом и аудитом.
5. После операции выполните `database-admin.mjs check` и штатную проверку готовности.

Не открывайте рабочую базу одновременно в графическом SQLite-редакторе при запущенных службах. Не копируйте только `docomator.db`, игнорируя `-wal` и `-shm`; используйте штатный `backup.sh` или автоматическую резервную копию.
