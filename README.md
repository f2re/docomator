# 🧩 Оформлятор

Автономный корпоративный сервис формирования DOCX/XLSX по шаблонам и типизированным данным. Runtime работает без обязательного доступа в Интернет. Сохраняемая рабочая область и предметные API закрываются **одним общим 4-значным кодом доступа**.

> [!NOTE]
> Пользовательское название продукта — **«Оформлятор»**. Технические идентификаторы `docomator`, `@docomator/*`, `DOCOMATOR_*`, systemd-службы, пути и имена автономных архивов сохранены для совместимости; см. [BRANDING](docs/BRANDING.md).

> [!IMPORTANT]
> Код доступа — не система пользователей и ролей и не самостоятельная security boundary. Имени пользователя/логина нет. После открытия сессии все допущенные клиенты имеют одинаковые возможности. Пространства остаются жёсткими границами данных, но не ACL. Firewall, reverse proxy и HTTPS обязательны для рабочего контура.

Текущий кодовый контур поддерживает импорт/экспорт данных, DOCX/XLSX-шаблоны, ручной и календарный выпуск, результаты, SMTP/сетевую доставку, резервирование и восстановление. Stable нельзя объявлять до фактической Debian/Astra/Office/recovery/UX-приёмки; см. [FINALIZATION](docs/FINALIZATION.md) и [SUPPORT_MATRIX](docs/SUPPORT_MATRIX.md).

## Основной путь

1. открыть рабочую область четырьмя цифрами;
2. выбрать пространство;
3. импортировать сотрудников или произвольные объекты из CSV/XLSX либо добавить вручную;
4. при необходимости выгрузить текущие данные в CSV/XLSX;
5. загрузить и проверить DOCX/XLSX;
6. связать изменяемые места с полями и выполнить пробное заполнение;
7. активировать проверенную версию шаблона;
8. выбрать всех, группу или отдельные объекты;
9. проверить обязательные данные;
10. сформировать персональные или сводные документы;
11. скачать DOCX/XLSX/ZIP либо доставить через SMTP/сетевую папку;
12. при ошибке исправить только проблемные данные и повторить неуспешные единицы.

## 🔐 Код доступа

Действующий [ADR-0011](docs/adr/0011-shared-access-code-gate.md) вводит один общий код из ровно четырёх цифр без username/account/roles/ACL. ADR-0009 с password terminology остаётся только историческим решением.

На новой установке `install.sh` создаёт session secret, а при первом открытии `/access` оператор задаёт четыре цифры прямо в браузере. Имя пользователя и подтверждение пароля отсутствуют.

Код не хранится открытым текстом. Сохраняется только scrypt-хэш. Сессия использует подписанную `HttpOnly`, `SameSite=Strict` cookie с ограниченным TTL; при HTTPS добавляется `Secure`. Неверные попытки получают локальный backoff. Встроенный сервер не использует HTTP Basic Auth и не выдаёт `WWW-Authenticate`.

Смена кода:

```bash
sudo /opt/docomator/current/set-access-code.sh
```

Если код забыт:

```bash
sudo /opt/docomator/current/reset-access-code.sh
# или
sudo /opt/docomator/current/first-run.sh --reset-code
```

Старый код не требуется. Документы и предметные данные не меняются; session secret ротируется, поэтому ранее открытые браузерные сессии закрываются.

Начиная с `0.6.3` канонический env-key — `DOCOMATOR_ACCESS_CODE_HASH`. Legacy `DOCOMATOR_ACCESS_PASSWORD_HASH` понимается runtime только как ограниченная upgrade/rollback compatibility. Новая конфигурация его не создаёт. Старые password-named shell helpers остаются только тонкими переходниками и не содержат собственной политики доступа.

См. [ACCESS_CODE](docs/ACCESS_CODE.md).

## 🧱 Пространства

Пространство изолирует сущности, группы, пользовательские поля/значения, импорт, шаблоны, публикации и связанные операции. Типы объектов могут быть общей системной схемой, но конкретный объект и пользовательское поле принадлежат одному пространству. Access-code gate не заменяет и не ослабляет эту границу данных.

См. [ENTITY_MODEL_AND_IMPORT](docs/ENTITY_MODEL_AND_IMPORT.md) и [ADR-0008](docs/adr/0008-space-data-isolation.md).

## 📥 Импорт CSV/XLSX

Оба пользовательских импорта используют сопровождаемый сценарий:

```text
файл → колонки → сопоставление → preview → исправление → импорт → результат
```

Есть drag&drop, корректные координаты пустых XLSX-ячеек, физические номера строк, переносы внутри ячейки, повторный импорт, нормализация ФИО и структурированные ошибки `code/row/column/propertyKey/rawValue/suggestedAction`. Ошибка подсвечивает проблемное сопоставление и не сбрасывает остальные настройки.

## 📤 Экспорт CSV/XLSX

В разделах сотрудников и произвольных объектов доступны **«Экспорт CSV»** и **«Экспорт XLSX»**. Экспорт строится сервером только из явно выбранных пространства и типа объектов, не раскрывает UUID/machine keys и neutralize значения, которые Excel/Calc могли бы интерпретировать как формулы.

## 🛡️ Документы

До сохранения DOCX/XLSX проверяются ZIP/OOXML, размеры, пути, фактический распакованный объём, опасные XML-конструкции, макросы, ActiveX, OLE, подписи и внешние связи. Renderer изменяет только разрешённые привязки и повторно считывает значения после формирования.

Поддерживаются выбранный текст DOCX, ячейки XLSX, несколько полей, безопасные форматтеры, повторяемые строки/диапазоны, персональный и сводный выпуск, частичный успех, повтор только ошибок и необязательный PDF-предпросмотр через локальный LibreOffice.

Visual Template Studio показывает безопасную read-only проекцию Office, но DOM/HTML не становится источником DOCX/XLSX. Точная поддержка Office-конструкций ограничена фактически проверенной матрицей.

## 📥 Результаты, доставка и резервирование

Готовые ручные и автоматические документы остаются в разделе «Результаты» до явного удаления. Скачивание не удаляет файл. Worker продолжает сохраняемую операцию после restart без второго результата.

Доставка поддерживает локальный SMTP с TLS/allowlist и разрешённую CIFS/NFS-папку с проверкой mount/sentinel, временным файлом, `fsync` и atomic rename. Ошибка доставки не уничтожает уже готовый документ.

Ежедневный systemd timer создаёт проверяемые резервные копии. Restore проверяет manifest/SHA-256 до замены рабочих данных.

## 🚀 Локальный запуск из исходников

Требуются Node.js не ниже `24.18.0` и npm 11+:

```bash
npm ci
npm run build
DOCOMATOR_DATA_DIR="$PWD/.tmp/data" npm run migrate
```

API:

```bash
DOCOMATOR_DATA_DIR="$PWD/.tmp/data" npm run start:api
```

Worker во втором терминале:

```bash
DOCOMATOR_DATA_DIR="$PWD/.tmp/data" npm run start:worker
```

Если `DOCOMATOR_ACCESS_CODE_HASH` и `DOCOMATOR_SESSION_SECRET` вообще не объявлены, source/test режим запускается без gate. Installed profile объявляет эти ключи и остаётся fail-closed до первого задания кода.

Проверка:

```bash
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:8080/readyz
npm run check
```

CI дополнительно запускает Chromium user flows, real-stack smoke и сборку/повторную проверку offline archive.

## 📦 Автономная поставка

Debian и Astra Linux собираются как разные target-профили на соответствующих reference VM. Набор `.deb` одной ОС нельзя использовать для другой.

### 🟦 Debian

```bash
npm run bundle:offline:debian -- \
  --apt-update \
  --llama-server /srv/build/llama.cpp/llama-server \
  --model /srv/models/model.gguf
```

### 🟥 Astra Linux

```bash
npm run bundle:offline:astra -- \
  --apt-update \
  --llama-server /srv/build/llama.cpp/llama-server \
  --model /srv/models/model.gguf \
  --ux-chromium-package "$ASTRA_CHROMIUM_PACKAGE" \
  --ux-chromium-bin "$ASTRA_CHROMIUM_BIN"
```

После установки откройте интерфейс и задайте код либо запустите помощник:

```bash
sudo /opt/docomator/current/first-run.sh --check
```

## Целевая приёмка

Код acceptance передаётся только через локальный обычный файл текущего пользователя с режимом `0600`; код и путь к файлу не включаются в акты.

```bash
install -m 0600 /dev/null "$HOME/.docomator-acceptance-code"
printf '%s\n' '0427' > "$HOME/.docomator-acceptance-code"

"$BUNDLE_ROOT/target-acceptance.sh" \
  --config /etc/docomator/docomator.env \
  --base-url http://127.0.0.1:8080/ \
  --access-code-file "$HOME/.docomator-acceptance-code" \
  --output "$HOME/docomator-target-acts/debian-01"
```

Для строгого Astra-контура добавляются `--require-network --require-smtp`. После прогона временный code file удаляется.

## Финальный release evidence

После target acts Debian/Astra, UX-акта, Office corpus, restore-акта и пустого списка блокеров:

```bash
npm run release:evidence -- \
  /srv/docomator-release-evidence \
  --expected-commit '<ПОЛНЫЙ_GIT_SHA>' \
  --expected-version '0.6.3'
```

Только успешный `release:evidence` разрешает отдельный переход candidate/pilot → stable/production. Зелёный CI или generic bundle целевую Debian/Astra/Office/recovery-приёмку не заменяет.

## Что ещё требует внешних свидетельств

- clean offline install/reboot на Debian;
- отдельный native Astra Linux 1.7 target act;
- настоящий LibreOffice без `SKIPPED`;
- ≥20 DOCX + ≥20 XLSX с Microsoft Office/LibreOffice compatibility;
- import/generation 10/100/1000;
- restart/failure/retry scenarios;
- backup/restore на отдельной чистой машине;
- два новых пользователя без устной инструкции;
- финальный release evidence без открытых блокеров.

См. [SECURITY](SECURITY.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [FINALIZATION](docs/FINALIZATION.md), [SUPPORT_MATRIX](docs/SUPPORT_MATRIX.md) и [ROADMAP](docs/ROADMAP.md).
