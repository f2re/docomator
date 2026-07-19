# Резервное копирование и восстановление

Статус: **реализованный эксплуатационный контракт M1**.

## Что входит в backup

Каждый backup является отдельным неизменяемым каталогом:

```text
backup-YYYYMMDDTHHMMSSZ/
├── database/docomator.db
├── objects/...
├── config/docomator.env       # если передан config file
├── manifest.json
└── manifest.sha256
```

Гарантии:

- SQLite snapshot создаётся штатной командой `VACUUM INTO`, поэтому обычный online backup не требует остановки API и worker;
- backup-копия проходит `PRAGMA integrity_check` и `PRAGMA foreign_key_check`;
- object storage копируется как набор immutable regular files; symbolic links и специальные файлы отклоняются;
- `manifest.sha256` обязан содержать каждый payload regular file ровно один раз, включая `manifest.json` и исключая себя; лишний файл, пропуск, повтор, неканонический путь, symbolic link или специальный файл внутри backup отклоняет всю копию до восстановления;
- схема `manifest.json`, заявленный размер БД, число объектов и наличие конфигурации сверяются с фактическим деревом;
- каталог сначала формируется под временным именем, затем атомарно переименовывается;
- retention удаляет только каталоги с заданным backup prefix;
- backup не выполняет сетевых запросов.

## Локальная разработка

```bash
export DOCOMATOR_DATA_DIR="$PWD/.tmp/data"
npm run backup -- \
  --config-file "$PWD/.tmp/docomator.env" \
  --output "$PWD/.tmp/backups/manual"

npm run restore -- \
  --backup "$PWD/.tmp/backups/manual" \
  --data-dir "$PWD/.tmp/data" \
  --config-file "$PWD/.tmp/docomator.env"
```

Только проверка backup:

```bash
npm run restore -- --backup /path/to/backup --verify-only
```

## Установленная система

Online backup:

```bash
sudo /opt/docomator/current/backup.sh
```

По умолчанию сохраняются семь последних обычных backup-каталогов в `/var/lib/docomator/backups`.

Точное место и retention:

```bash
sudo /opt/docomator/current/backup.sh \
  --output /srv/offline-backups/docomator-20260711 \
  --retention 14
```

Восстановление:

```bash
sudo /opt/docomator/current/restore.sh \
  --backup /srv/offline-backups/docomator-20260711
```

`restore.sh`:

1. проверяет SHA-256 и SQLite целостность целевого backup;
2. создаёт `pre-restore-*` backup текущего состояния;
3. останавливает runtime services;
4. копирует входной backup в staging, повторно проверяет staging-копию и только затем заменяет БД, object storage и, при наличии, конфигурацию атомарным переименованием каждого компонента с компенсирующим откатом;
5. запускает migration текущего release;
6. запускает services и проверяет `/readyz`;
7. при ошибке возвращает pre-restore состояние.

После успешной фиксации временные staging/rollback-артефакты и restore-lock удаляются отдельно. Если filesystem не позволяет удалить их, установленное состояние не откатывается и `restore.mjs` печатает явное предупреждение с оставшимся путём для ручной очистки. При внутреннем откате вместе с основным файлом SQLite возвращаются существовавшие `-wal`/`-shm` sidecar-файлы.

## Ограничения

- Внешний каталог backup должен находиться на надёжном локальном или уже смонтированном filesystem. Сам скрипт не монтирует сетевые ресурсы.
- Online backup обеспечивает согласованный SQLite snapshot. Immutable objects, появившиеся после snapshot и до окончания копирования, могут попасть в backup как лишние неиспользуемые файлы; это безопасно. Объекты, на которые ссылается snapshot, уже должны существовать согласно транзакционному порядку object-store.
- Restore является maintenance operation. Во время него API и worker должны быть остановлены.
- Для recovery drill backup следует физически перенести на отдельный носитель и проверить на чистой VM.

## Критерий успешного recovery drill

- checksum verification завершилась без ошибок;
- фактический состав regular files в точности совпал с `manifest.sha256`;
- `integrity_check` вернул `ok`;
- `foreign_key_check` не вернул строк;
- migration checksums совпали;
- `/readyz` вернул HTTP 200;
- доступны выбранные сущности и исторические документы;
- фактические RPO/RTO зафиксированы в протоколе испытания.
