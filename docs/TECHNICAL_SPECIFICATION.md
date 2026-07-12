# 🧩 Техническое задание Docomator

Версия: **1.1-draft**  
Статус: **основное ТЗ проекта**  
Последнее обновление: **2026-07-12**

## 1. Наименование

**Docomator — универсальная автономная система интеллектуального формирования, автоматизации и доставки документов.**

## 2. Назначение

Система должна позволять пользователям без навыков программирования:

- подключать поддерживаемые DOCX/XLSX;
- находить или вручную отмечать вариативные области;
- связывать поля с произвольными типизированными данными;
- расширять базу людей, организаций и любых других сущностей;
- создавать документ вручную, по событию или расписанию;
- генерировать отдельные текстовые блоки локальной LLM;
- проверять и скачивать результат;
- отправлять документ через локальный SMTP relay;
- сохранять документ в разрешённую сетевую папку;
- понимать каждое состояние процесса через сопровождающий интерфейс.

Полный перечень нормативных требований находится в [REQUIREMENTS.md](REQUIREMENTS.md). UX/UI-контракт находится в [UX_UI_SPECIFICATION.md](UX_UI_SPECIFICATION.md).

## 3. Ограничения среды

- Debian GNU/Linux или Astra Linux Special Edition 1.7;
- автономный контур без runtime-доступа в Интернет;
- x86-64 baseline, иные архитектуры — после тестирования;
- CPU-only inference через `llama.cpp/llama-server`;
- Node.js LTS и TypeScript;
- SQLite WAL;
- локальные runtime assets без CDN;
- модульный монолит: API, worker, llama-server.

## 4. Архитектурные принципы

1. LLM возвращает данные и декларативные планы, но не исполняемый код.
2. DOCX/XLSX изменяются только детерминированным renderer-ом.
3. Длительные операции выполняются worker-ом и имеют персистентное состояние.
4. Любой внешний side effect имеет correlation ID и idempotency key.
5. Файлы хранятся как immutable objects с SHA-256.
6. Система остаётся работоспособной через формы при недоступной LLM.
7. Интерфейс не скрывает состояние, не показывает фиктивный прогресс и не допускает молчаливых ошибок.

## 5. Функциональные подсистемы

### 5.1. Knowledge Registry

- пользовательские типы сущностей;
- произвольные типизированные свойства;
- значения с provenance, версиями и периодами действия;
- классы чувствительности;
- история изменений;
- CRUD/API и динамические формы.

### 5.2. Template Studio

- безопасный intake DOCX/XLSX;
- Document IR;
- deterministic и LLM-assisted field detection;
- ручная разметка;
- content controls/defined names;
- compatibility report;
- test render и activation gate;
- immutable versions.

### 5.3. Формирование документов

- свободный запрос и каталог;
- разрешение данных из базы;
- понятные вопросы по пропускам;
- декларативное форматирование;
- generated text с review;
- DOCX/XLSX render;
- reverse-read и preview;
- ZIP-комплекты.

### 5.4. Автоматизация

- расписание с timezone и business calendar;
- внутренние/внешние события;
- transactional outbox;
- persistent queue, lease, retry и dead-letter;
- deterministic idempotency;
- missing-data/review policy;
- dry-run и история.

### 5.5. Доставка

- внутренний архив;
- локальный SMTP relay;
- OS-mounted SMB/CIFS/NFS roots;
- mount + sentinel verification;
- atomic file write;
- отдельный статус каждого канала;
- controlled retry состояния unknown.

### 5.6. Эксплуатация

- offline bundle;
- checksum verification;
- versioned release directories;
- atomic update and rollback;
- verified backup/restore;
- health/readiness;
- structured logs и аудит.

## 6. Интерфейс и сопровождение пользователя

Интерфейс должен быть современным, спокойным и понятным с первого экрана. Визуальное направление вдохновляется системными принципами macOS/iOS без копирования закрытых компонентов.

Обязательные свойства:

- одна главная задача на экран;
- desktop sidebar и mobile bottom navigation;
- системная типографика, светлая/тёмная тема;
- серые пояснения под нетривиальными полями;
- contextual help и ответы на частые вопросы;
- явные loading/empty/success/warning/error/degraded/planned states;
- human-readable operation timeline;
- correlation ID и вариант восстановления при ошибке;
- сохранение введённых значений после серверной ошибки;
- visible focus, keyboard, reduced motion и touch targets не менее 44 px;
- локальные ассеты и отсутствие внешней аналитики.

Ключевой вопрос проверки каждого экрана:

> Может ли пользователь без догадок объяснить, что происходит, почему, что будет дальше и что делать при проблеме?

## 7. Порядок реализации

1. Платформенное и persistence-ядро.
2. Guided UI foundation и Knowledge Registry UI.
3. Secure OOXML intake.
4. Template compiler и Safe Scalar renderer.
5. Ручной документный workflow и RBAC.
6. Локальные LLM-агенты.
7. Structured/generated documents.
8. Automation engine.
9. Delivery и operational dashboard.
10. Пилотное усиление.

Подробная декомпозиция: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) и [ROADMAP.md](ROADMAP.md).

## 8. Критерии готовности промышленной версии

- пользователь подключает новый поддерживаемый шаблон без программирования;
- произвольное свойство создаётся через UI;
- документ формируется вручную и автоматически;
- каждое значение имеет источник;
- каждое состояние показано и объяснено;
- generated content проходит review по policy;
- событие не создаёт дубликат;
- SMTP/network delivery имеют проверяемые статусы;
- отключённая share не приводит к записи в локальную директорию;
- система устанавливается и обновляется без сети;
- backup/restore подтверждены recovery drill;
- интерфейс проходит UX-AC-001—UX-AC-010;
- требования AC-001—AC-014 выполнены на пилотном стенде.
