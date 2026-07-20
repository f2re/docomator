# Участие в разработке

## Перед изменением

1. Прочитайте [требования](docs/REQUIREMENTS.md), [архитектуру](docs/ARCHITECTURE.md) и корневой [AGENTS.md](AGENTS.md).
2. Укажите requirement IDs, которые реализует изменение.
3. Для архитектурного решения создайте или обновите ADR.
4. Не добавляйте production dependency без обоснования её необходимости и offline impact.

## Локальная проверка

```bash
npm ci
npm run check
```

`npm run check` включает обязательные сборку, тесты, release-gates и статические проверки, но не запускает браузерный E2E. Ручной запуск API/worker и проверка `/readyz` описаны в [основном README](README.md#ручная-проверка-с-реальным-api-и-sqlite), а команды Playwright — в [описании E2E-контура](tests/e2e/README.md).

Для migration:

```bash
DOCOMATOR_DATA_DIR="$PWD/.tmp/test-data" npm run migrate
```

Для автономных shell-скриптов:

```bash
bash scripts/ci/validate-shell.sh
scripts/offline/prepare-bundle.sh --help
```

## Правила кода

- TypeScript strict; избегать `any` и unchecked casts.
- Side effects должны быть за ports/adapters.
- Transactions короткие; тяжёлая работа вне SQLite transaction.
- Любой side effect имеет idempotency/correlation context.
- Не исполнять данные из LLM/template/user как код.
- Public behavior сопровождается tests и docs.
- SQL migration после merge неизменяема.

## Pull request

PR должен содержать:

- что и зачем изменено;
- requirement IDs;
- risk и security impact;
- offline/deployment impact;
- migration и rollback notes;
- выполненные checks;
- screenshots/fixtures для UI или document changes.

По умолчанию крупные изменения открываются как draft PR.
