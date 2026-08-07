# 🧩 Docomator

Автономная система формирования DOCX/XLSX по шаблонам и данным организации. Рабочий контур рассчитан на Debian/Astra Linux, SQLite, локальные файлы и необязательный `llama.cpp`; после установки доступ в Интернет не требуется.

Текущая версия продукта задаётся в [`VERSION`](VERSION). Правила изменения версии и обновления описаны в [`docs/VERSIONING.md`](docs/VERSIONING.md).

## Что делает система

Docomator поддерживает:

- пространства как независимые области данных;
- людей, аудитории, публикации, оборудование и произвольные типы объектов;
- CSV/XLSX-импорт с предварительной проверкой, сопоставлением колонок и понятными ошибками;
- DOCX/XLSX-шаблоны, типизированные поля и повторяемые строки;
- пробное заполнение, проверку, активацию и выпуск документов;
- отдельные документы и сводные реестры;
- группы и неизменяемые снимки состава;
- расписания, SMTP и разрешённые сетевые каталоги;
- общее хранилище результатов и повтор только неуспешных единиц;
- резервное копирование, проверку SQLite и автоматический откат обновления;
- локальную модель как необязательный помощник без права напрямую исполнять код, SQL или shell-команды.

## Пространства

Все клиенты, допущенные внешним корпоративным периметром, могут открыть любое пространство: Docomator не реализует встроенные аккаунты, роли и ACL.

При этом данные пространств изолированы. Сущности, пользовательские поля, группы, шаблоны, выпуски и связанные операции не должны случайно разрешаться через соседнее пространство. Сервер и БД проверяют эту границу независимо от фильтрации интерфейса.

Подробный контракт: [`docs/SPACES_AND_AUDIENCES.md`](docs/SPACES_AND_AUDIENCES.md).

## Основной пользовательский путь

```text
выбрать пространство
→ загрузить/проверить данные
→ подключить шаблон
→ сопоставить поля
→ выполнить пробное заполнение
→ активировать проверенную версию
→ сформировать документы
→ получить результат
```

Для первого знакомства используйте [`docs/QUICK_START.md`](docs/QUICK_START.md). Полное руководство — [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md).

## Интерфейс

Интерфейс полностью локальный и не использует CDN, внешние шрифты, аналитику или удалённые изображения.

Обязательные свойства:

- понятные русские названия без требования UUID/SHA/OOXML-координат;
- явные loading/success/error/degraded состояния;
- сохранение введённых данных после серверной ошибки;
- отсутствие непреднамеренного горизонтального overflow;
- достижимые действия в диалогах и боковых панелях;
- корректная компоновка на 320, 768 и 1440 px;
- клавиатура, видимый фокус, тёмная тема и `prefers-reduced-motion`;
- нативный/семантический прогресс без вымышленных процентов.

Контракты: [`docs/UX_UI_SPECIFICATION.md`](docs/UX_UI_SPECIFICATION.md) и [`docs/INTERFACE_HIERARCHY.md`](docs/INTERFACE_HIERARCHY.md).

## Быстрая автономная установка

Распакованный bundle можно оставить в обычном каталоге пользователя:

```bash
cd /путь/к/docomator-<version>-linux-<arch>
./verify-bundle.sh "$PWD"
sudo ./install.sh
```

Если для чистой машины в комплект включён согласованный набор `.deb`:

```bash
sudo ./install.sh --install-os-packages
```

Проверка готовности:

```bash
systemctl --no-pager --full status docomator-api.service docomator-worker.service
curl --fail --silent http://127.0.0.1:8080/readyz
```

Подробности: [`docs/OFFLINE_DEPLOYMENT.md`](docs/OFFLINE_DEPLOYMENT.md).

## Полные целевые bundles

Debian и Astra Linux собираются как разные target-профили: набор системных пакетов, сведения об ОС и Chromium/LibreOffice-профиль должны соответствовать конкретной целевой платформе.

### 🟦 Debian

На совместимой подключённой Debian-машине:

```bash
npm run bundle:offline:debian
```

### 🟥 Astra Linux

На совместимой подключённой машине Astra Linux:

```bash
npm run bundle:offline:astra
```

Готовность к стабильному выпуску подтверждается не наличием архива, а целевыми актами и строгим evidence gate:

```bash
npm run release:evidence:init -- /srv/docomator-release-evidence
npm run release:evidence -- \
  /srv/docomator-release-evidence \
  --expected-commit '<полный Git SHA>' \
  --expected-version "$(cat VERSION)"
```

Требования к фактической Debian/🟥 Astra Linux приёмке, восстановлению и реальному Office-корпусу описаны в [`docs/FINALIZATION.md`](docs/FINALIZATION.md).

## Обновление

Используйте `update.sh` из нового проверенного bundle:

```bash
cd /путь/к/новому/bundle
./verify-bundle.sh "$PWD"
sudo ./update.sh
```

Обновление **не блокируется совпадением номера версии**. `VERSION` — версия продукта; конкретная сборка идентифицируется SHA-256 `release.json` и устанавливается в отдельный immutable-каталог.

Точная повторная установка той же сборки допустима и идемпотентна.

Специальный `root:root` staging для обычного сценария не требуется. В жёстком многопользовательском контуре дополнительную проверку пути можно включить явно:

```bash
sudo DOCOMATOR_STRICT_BUNDLE_PATH=1 ./update.sh
```

## Версионирование

Единственный вручную редактируемый источник версии:

```text
VERSION
```

Для нового номера выпуска:

```bash
printf '0.2.0\n' > VERSION
npm run version:sync
npm run check:release-version
```

Не редактируйте версии workspace-пакетов, lockfile и конфигурации вручную.

## Разработка

Требуется Node.js из [`.node-version`](.node-version).

```bash
npm ci
npm run check
```

Основные процессы:

```bash
DOCOMATOR_DATA_DIR="$PWD/.tmp/data" npm run migrate
npm run start:api
npm run start:worker
```

E2E:

```bash
npm run test:e2e
npm run test:e2e:a11y
```

Полный release gate и offline-проверки входят в `npm run check` и CI.

## Структура репозитория

```text
apps/api            HTTP API и локальный web UI
apps/worker         фоновые задания и внешние side effects
packages/*          доменные и инфраструктурные пакеты
migrations/         неизменяемые SQLite-миграции
scripts/runtime/    эксплуатационные утилиты
scripts/offline/    сборка, установка, обновление и target acceptance
tests/e2e/          Playwright/axe сценарии
docs/               действующие требования, контракты и руководства
.codex/agents/      специализированные инструкции агентов
```

## Безопасность

- OOXML рассматривается как недоверенный ZIP/XML.
- LLM-ответ не исполняется как код, SQL или shell.
- Внешние эффекты выполняет детерминированный backend.
- SMTP и сетевые назначения ограничиваются конфигурацией.
- Установленные release-каталоги неизменяемы и принадлежат `root`.
- Обновление делает резервную копию БД/конфигурации и возвращает прежнее состояние при неуспешной readiness-проверке.

Docomator предполагает внешний доверенный сетевой/системный периметр. Встроенной аутентификации нет намеренно.

## Документация

Актуальный индекс: [`docs/README.md`](docs/README.md).

Ключевые документы:

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — нормативные требования;
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — архитектура;
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — действующий план реализации;
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — состояние этапов;
- [`docs/VERSIONING.md`](docs/VERSIONING.md) — версия продукта и identity сборки;
- [`docs/OFFLINE_DEPLOYMENT.md`](docs/OFFLINE_DEPLOYMENT.md) — автономная эксплуатация;
- [`docs/SUPPORT_MATRIX.md`](docs/SUPPORT_MATRIX.md) — подтверждённая совместимость;
- [`docs/RELEASE_NOTES.md`](docs/RELEASE_NOTES.md) — история изменений.

Не считайте платформу или интеграцию проверенной только по наличию кода: фактический статус целевых Debian/Astra/LibreOffice сочетаний определяется матрицей совместимости и актами приёмки.
