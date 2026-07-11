# Политика безопасности

Проект находится в bootstrap-стадии и ещё не предназначен для обработки production personal/restricted data.

## Сообщение об уязвимости

Не публикуйте секреты, персональные данные и рабочие документы в публичном issue. Используйте приватный канал владельца репозитория или GitHub private vulnerability reporting, когда он включён.

В сообщении укажите:

- затронутую версию/commit;
- сценарий и prerequisites;
- ожидаемое и фактическое поведение;
- минимальный reproduction;
- возможный impact;
- предложенное временное ограничение.

## Приоритетные классы риска

- обход path containment или запись вне allowlisted root;
- ZIP/XML attacks и unsafe OOXML relationships;
- prompt injection, приводящая к side effect;
- утечка SMTP credentials, session secrets или restricted properties;
- duplicate automatic deliveries при retry;
- изменение immutable template/output/migration;
- privilege escalation из LibreOffice/llama-server;
- отключение mount с записью в локальную директорию;
- нарушение RBAC или field-level policy.

## Безопасная разработка

- LLM не получает shell, SQL, SMTP или filesystem tools;
- secrets не коммитятся;
- install/update не используют сеть;
- release files read-only, data directory writable;
- dependencies фиксируются lock-файлом;
- изменения security boundaries требуют ADR и negative tests.
