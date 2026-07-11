# Эксплуатация Docomator

## Health endpoints

| Endpoint | Назначение |
|---|---|
| `/healthz` | процесс API жив и принимает запросы |
| `/readyz` | data directory и migrated SQLite database доступны |
| `/api/v1/system/info` | версия, runtime и включённые базовые features |

`healthz` не означает готовность dependent services. Для load balancer используется `readyz`.

## Services

```bash
systemctl status docomator-api
systemctl status docomator-worker
systemctl status docomator-llm
```

Рекомендуемый порядок запуска:

```text
docomator-llm (если включён)
docomator-api
docomator-worker
```

API не должен падать при недоступной LLM; соответствующие операции переходят в fallback/review.

## Logs

```bash
journalctl -u docomator-api -f
journalctl -u docomator-worker -f
journalctl -u docomator-llm -f
```

Логи должны быть JSON/структурированными, иметь correlation ID и не содержать secrets/restricted values.

## Backup

Online backup не требует остановки API/worker:

```bash
sudo /opt/docomator/current/backup.sh
```

Скрипт создаёт согласованный SQLite snapshot через `VACUUM INTO`, проверяет `integrity_check` и foreign keys, копирует immutable object storage и конфигурацию, затем формирует SHA-256 manifest. Каталог публикуется только после полного завершения.

Проверка подготовленного backup без восстановления:

```bash
/opt/docomator/current/runtime/node/bin/node \
  /opt/docomator/current/app/scripts/runtime/restore.mjs \
  --backup /path/to/backup \
  --verify-only
```

Подробный контракт: [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## Restore

```bash
sudo /opt/docomator/current/restore.sh \
  --backup /path/to/backup
```

Restore создаёт отдельный pre-restore backup, останавливает services, атомарно заменяет БД/object storage/config, применяет migration текущего release и проверяет readiness. При ошибке migration или readiness прежнее состояние восстанавливается автоматически.

## Restore drill

Не реже принятого эксплуатационного периода:

1. перенести backup на отдельный носитель;
2. развернуть clean offline VM;
3. установить ту же или более новую совместимую release version;
4. выполнить `restore.sh`;
5. проверить migration checksums и `/readyz`;
6. открыть несколько сущностей и historical documents;
7. выполнить dry-run automation без доставки после появления Automation Engine;
8. зафиксировать фактические RPO/RTO и найденные отклонения.

## Capacity

Контролировать:

- свободное место object storage, backups и previews;
- размер SQLite WAL;
- queue depth и oldest pending age;
- LLM request duration/timeouts;
- LibreOffice process failures/timeouts;
- SMTP/network delivery retry count;
- число open review tasks.

## Обновления

- использовать только проверенный bundle;
- не выполнять `npm install` в production;
- не менять файлы release-directory;
- все local secrets остаются в `/etc/docomator`;
- после update проверять `/readyz`, migration history и sample render;
- хранить предыдущую release до завершения acceptance window.

## Incident: LLM unavailable

1. проверить `docomator-llm` и model path;
2. проверить CPU/RAM и journal;
3. оставить API/worker запущенными;
4. manual form workflows должны продолжать работу;
5. LLM-dependent jobs переводятся в retry/review согласно policy.

## Incident: network share unavailable

1. не создавать вручную обычную директорию на месте mount;
2. проверить `.mount/.automount`, network и sentinel;
3. после восстановления повторить только failed delivery;
4. не перегенерировать document без изменения данных.

## Incident: SMTP result unknown

Не выполнять бесконтрольный автоматический retry: сообщение могло быть принято до разрыва соединения. Проверить relay logs, Message-ID и применить configured `unknown` policy.
