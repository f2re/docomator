# 🧩 Оформлятор

[![CI](https://github.com/f2re/docomator/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/f2re/docomator/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/f2re/docomator?display_name=tag&sort=semver)](https://github.com/f2re/docomator/releases/latest)
[![Release status](https://img.shields.io/badge/release-candidate%20%2F%20pilot-orange)](RELEASE_IDENTITY.json)
[![Offline first](https://img.shields.io/badge/runtime-offline--first-informational)](docs/OFFLINE_DEPLOYMENT.md)

**Автономный сервис формирования DOCX/XLSX по шаблонам и типизированным данным.** После установки рабочий runtime не требует Internet и не требует LLM. Рабочая область закрывается одним общим четырёхзначным кодом доступа.

> [!IMPORTANT]
> Текущий канал — **candidate / pilot**. Это готовая для скачивания проверенная CI-сборка, но не заявление о завершённой production-приёмке Debian/Astra/Office/recovery. Точный статус всегда задаёт [`RELEASE_IDENTITY.json`](RELEASE_IDENTITY.json).

## 📦 Скачать готовую сборку

### [⬇️ Скачать последний выпуск](https://github.com/f2re/docomator/releases/latest)

В GitHub Release публикуются ровно пять проверяемых файлов:

| Файл | Для чего |
|---|---|
| `docomator-<version>-linux-<arch>.tar.gz` | готовый автономный application bundle для ручной установки/обновления |
| `docomator-<version>-linux-<arch>.tar.gz.sha256` | SHA-256 native bundle |
| `docomator-<version>-project-control.f2re.zip` | готовый пакет обновления для F2RE Project Control |
| `docomator-<version>-project-control.f2re.zip.sha256` | SHA-256 Project Control package |
| `SHA256SUMS.txt` | общий список контрольных сумм |

Проверка и установка:

```bash
sha256sum -c docomator-*.tar.gz.sha256
tar -xzf docomator-*.tar.gz
cd docomator-*-linux-*
sudo ./install.sh
```

GitHub-hosted release — **generic core bundle** с Node.js и приложением, без LLM, LibreOffice preview и target-specific `.deb` closure. Полные Debian/Astra bundles собираются на соответствующей reference VM и имеют отдельный target acceptance. См. [`docs/GITHUB_RELEASES.md`](docs/GITHUB_RELEASES.md) и [`docs/OFFLINE_DEPLOYMENT.md`](docs/OFFLINE_DEPLOYMENT.md).

## Что умеет Оформлятор

- жёстко изолированные пространства данных;
- сотрудники и произвольные типизированные сущности;
- импорт CSV/XLSX: файл → сопоставление → preview → исправление → импорт;
- экспорт CSV/XLSX без технических UUID и с защитой от spreadsheet formula injection;
- безопасный приём DOCX/XLSX и проверка OOXML;
- Visual Template Studio с read-only представлением документа;
- детерминированные bindings и renderer DOCX/XLSX без обязательного ИИ;
- персональные и сводные документы, группы и снимки аудитории;
- persisted worker, retry/idempotency и восстановление после restart;
- SMTP и доставка в разрешённую CIFS/NFS-папку;
- резервные копии, restore, offline update и rollback;
- необязательный локальный `llama.cpp/llama-server` как ограниченный помощник.

## Основной пользовательский путь

```text
код доступа
→ пространство
→ данные / CSV / XLSX
→ шаблон DOCX/XLSX
→ визуальное сопоставление полей
→ пробное заполнение
→ активация шаблона
→ группа / выбор объектов
→ формирование
→ DOCX / XLSX / ZIP / доставка
```

При ошибке введённые данные не должны пропадать. Сообщение отвечает на три вопроса: что произошло, сохранены ли данные и что делать дальше.

## 🔐 Код доступа

Оформлятор использует один общий код из **ровно четырёх цифр**. Пользователей, логинов, ролей и ACL внутри приложения нет — это соответствует действующему [`ADR-0011`](docs/adr/0011-shared-access-code-gate.md).

На новой установке первый переход на `/access` предлагает задать код. Код хранится только как scrypt-хэш; сессия — подписанная `HttpOnly`, `SameSite=Strict` cookie. При HTTPS используется `Secure`.

Смена кода:

```bash
sudo /opt/docomator/current/set-access-code.sh
```

Сброс забытого кода без удаления рабочих данных:

```bash
sudo /opt/docomator/current/reset-access-code.sh
# или
sudo /opt/docomator/current/first-run.sh --reset-code
```

Код доступа — дополнительный барьер внутри trusted workspace, а не самостоятельная security boundary. Для удалённого доступа нужны firewall/reverse proxy/HTTPS.

## 🧱 Пространства

Пространство — жёсткая граница пользовательских данных. Не смешиваются сущности, группы, пользовательские поля и значения, import memory, шаблоны, публикации, задания, результаты и связанные операции. GET/list/read не присваивают ownership; cross-space links отклоняются backend и БД.

Подробнее: [`ENTITY_MODEL_AND_IMPORT`](docs/ENTITY_MODEL_AND_IMPORT.md), [`SPACES_AND_AUDIENCES`](docs/SPACES_AND_AUDIENCES.md), [`ADR-0008`](docs/adr/0008-space-data-isolation.md).

## 📥 Импорт CSV/XLSX

Оба формата используют один сопровождаемый flow:

```text
файл / drag&drop / paste
→ колонки
→ сопоставление
→ preview
→ исправление
→ импорт
→ результат
```

Ошибки формируются машинно читаемо (`code`, физическая строка, колонка/поле, исходное значение, severity, repair action) и только затем переводятся в пользовательский текст. Пустые ячейки XLSX не сдвигают колонки, перенос внутри ячейки остаётся частью значения, повторный импорт не должен создавать дубли.

## 🛡️ Документы и шаблоны

DOCX/XLSX считаются недоверенным ZIP/XML-входом. До сохранения проверяются пути, размеры, expanded bytes, XML declarations, relationships, macros/ActiveX/OLE и внешние связи.

Visual Template Studio показывает безопасную read-only проекцию Office. DOM/HTML не является источником итогового DOCX/XLSX. Binding остаётся серверно проверяемой координатой документа.

Renderer изменяет только разрешённые bindings, сохраняет нетронутые части OOXML в пределах заявленной поддержки и выполняет reverse-read результата. Неподдерживаемая конструкция должна приводить к понятному отказу, а не к молчаливому повреждению документа.

## 🚀 Запуск из исходников

Требуются версии из репозитория (`.node-version`, lockfile):

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

Проверка:

```bash
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:8080/readyz
npm run check
```

## 📦 Полные offline bundles Debian/Astra

Debian и Astra Linux собираются как разные target-профили. Generic GitHub Release не подменяет target-specific поставку. Полный bundle собирается на reference VM той же ОС/архитектуры/glibc и включает проверенный package closure.

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

После установки:

```bash
sudo /opt/docomator/current/first-run.sh --check
```

## Release discipline

Единственный источник идентичности — [`RELEASE_IDENTITY.json`](RELEASE_IDENTITY.json):

```json
{
  "version": "0.6.5",
  "status": "candidate",
  "channel": "pilot"
}
```

Правила:

- bugfix без новой возможности → `PATCH`;
- новая обратно совместимая возможность → `MINOR`;
- candidate получает immutable tag `vX.Y.Z-candidate`;
- stable/production получает отдельный immutable tag `vX.Y.Z`;
- **GitHub Release candidate публикуется обычным видимым Release**, а зрелость явно записана в tag/title/body и machine identity; это сделано, чтобы сборка была очевидно доступна на главной странице репозитория;
- наличие Release не переводит продукт в stable;
- assets никогда не перезаписываются под существующим tag;
- release publisher берёт только exact artifact успешного push-CI `main`, сверяет SHA-256 и source commit;
- отдельный read-only verifier скачивает уже опубликованный Release и побайтно проверяет оба bundle.

Подробнее: [`VERSIONING`](docs/VERSIONING.md), [`GITHUB_RELEASES`](docs/GITHUB_RELEASES.md), [`RELEASE_NOTES`](docs/RELEASE_NOTES.md).

## До stable/production

Для stable требуются доказательства exact release binding:

- clean offline install/reboot на Debian;
- native Astra Linux 1.7 target act;
- настоящий LibreOffice без `SKIPPED`;
- минимум 20 DOCX + 20 XLSX из реального Office corpus;
- import/generation 10/100/1000;
- restart/failure/retry без дублей;
- backup/restore на отдельной чистой машине;
- update/rollback без потери данных;
- два новых пользователя, accessibility/P5;
- защищённый `main` с required checks;
- пустой `blockers.json` и успешный `release:evidence`.

## Документация

- [`REQUIREMENTS`](docs/REQUIREMENTS.md) — нормативные требования;
- [`ARCHITECTURE`](docs/ARCHITECTURE.md) — архитектура;
- [`OFFLINE_DEPLOYMENT`](docs/OFFLINE_DEPLOYMENT.md) — установка, update, rollback;
- [`SUPPORT_MATRIX`](docs/SUPPORT_MATRIX.md) — доказанная совместимость;
- [`SECURITY`](SECURITY.md) — модель доверия и ограничения;
- [`ROADMAP`](docs/ROADMAP.md) — что осталось до stable;
- [`CONTRIBUTING`](CONTRIBUTING.md) — разработка и проверки.

> [!NOTE]
> Пользовательское название продукта — **«Оформлятор»**. Технические идентификаторы `docomator`, `@docomator/*`, `DOCOMATOR_*`, systemd unit names и имена offline archives сохранены для совместимости.
