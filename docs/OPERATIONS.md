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

Минимальный backup-set:

```text
/etc/docomator/docomator.env
/var/lib/docomator/docomator.db
/var/lib/docomator/objects/
/var/lib/docomator/models/   # можно восстановить из release media
/opt/docomator/releases/     # можно восстановить из release media
```

Для согласованного copy SQLite:

1. остановить API и worker либо использовать будущую online-backup команду;
2. скопировать `docomator.db` и возможные `-wal`/`-shm`;
3. скопировать object storage;
4. сохранить checksum и release version;
5. снова запустить services.

## Restore drill

Не реже принятого эксплуатационного периода:

1. развернуть clean offline VM;
2. установить ту же release version;
3. восстановить config, database и objects;
4. проверить migrations checksums;
5. открыть несколько historical documents;
6. выполнить dry-run automation без доставки;
7. зафиксировать фактический RTO.

## Capacity

Контролировать:

- свободное место object storage и previews;
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
