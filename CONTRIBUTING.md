# Участие в разработке

## Перед изменением

1. Прочитайте [требования](docs/REQUIREMENTS.md), [архитектуру](docs/ARCHITECTURE.md) и корневой [AGENTS.md](AGENTS.md).
2. Укажите requirement IDs, которые реализует изменение.
3. Для архитектурного решения создайте или обновите ADR.
4. Не добавляйте production dependency без обоснования её необходимости и offline impact.

## Локальная проверка

Обычная разработка и каждый PR используют короткий обязательный контур:

```bash
npm ci
npm run check
```

`npm run check` выполняет сборку, unit/regression tests, проверку миграций, space/security invariants, release identity/version policy, shell/runtime syntax и статический UI contract. Он намеренно не собирает offline bundle, не устанавливает Chromium, не запускает browser E2E и не выполняет release/LibreOffice gates.

Перед реальным выпуском выполняется отдельная расширенная проверка:

```bash
npm run check:release
```

Затем на подходящем build/target host запускаются относящиеся к выпуску browser E2E, offline bundle verification и target acceptance. GitHub Actions не заменяет эти проверки и не публикует Release автоматически.

Для migration:

```bash
DOCOMATOR_DATA_DIR="$PWD/.tmp/test-data" npm run migrate
```

Для автономных shell-скриптов:

```bash
bash scripts/ci/validate-shell.sh
scripts/offline/prepare-bundle.sh --help
```

Команды Playwright описаны в [E2E-контуре](tests/e2e/README.md), offline install/update/rollback — в [OFFLINE_DEPLOYMENT](docs/OFFLINE_DEPLOYMENT.md).

## GitHub CI

В репозитории поддерживается один workflow `.github/workflows/ci.yml`:

- запускается для PR и push в `main`;
- имеет только `contents: read`;
- использует только закреплённые `actions/checkout` и `actions/setup-node`;
- выполняет `npm run check` и fresh migration smoke;
- не загружает artifacts, не публикует releases, не удаляет ветки и не выполняет deploy.

Тяжёлую приёмку не следует возвращать в обязательный PR CI. Если дефект требует browser/offline/Office regression, тест хранится в проекте и запускается в соответствующем focused/release контуре.

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
