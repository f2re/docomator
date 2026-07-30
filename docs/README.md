# Документация Docomator

## Для оператора и администратора

| Документ | Назначение |
|---|---|
| [USER_GUIDE.md](USER_GUIDE.md) | полный порядок работы: данные, шаблоны, выпуск, расписания, доставка и диагностика |
| [USE_CASES.md](USE_CASES.md) | практические кейсы и выбор правильного рабочего потока |
| [IMPORT_AND_WORD_ROSTERS.md](IMPORT_AND_WORD_ROSTERS.md) | массовый импорт людей, студентов, заполненных полей и повторяемые строки Word |
| [ENTITY_MODEL_AND_IMPORT.md](ENTITY_MODEL_AND_IMPORT.md) | произвольные объекты, типы, параметры, однородные группы и гибкий CSV/XLSX-импорт |
| [OFFLINE_DEPLOYMENT.md](OFFLINE_DEPLOYMENT.md) | подготовка, установка, обновление и откат автономного комплекта |
| [DATABASE_ADMINISTRATION.md](DATABASE_ADMINISTRATION.md) | безопасный просмотр, сортировка, экспорт и логическое добавление полей БД |
| [OPERATIONS.md](OPERATIONS.md) | эксплуатация, резервные копии, готовность и диагностика |

Руководство оператора, основные кейсы, ограничения и действия при ошибках также доступны непосредственно в веб-интерфейсе через пункт **«Руководство»**. Встроенная документация не требует доступа в Интернет.

## Нормативная и техническая документация

| Документ | Назначение |
|---|---|
| [REQUIREMENTS.md](REQUIREMENTS.md) | нормативные функциональные и нефункциональные требования |
| [ARCHITECTURE.md](ARCHITECTURE.md) | компоненты, потоки, границы и модель данных |
| [UX_UI_SPECIFICATION.md](UX_UI_SPECIFICATION.md) | требования к пользовательскому интерфейсу и состояниям |
| [TEMPLATE_COMPILER.md](TEMPLATE_COMPILER.md) | правила компиляции, привязок и заполнения DOCX/XLSX |
| [SPACES_AND_AUDIENCES.md](SPACES_AND_AUDIENCES.md) | разделы данных, группы, выбор участников и снимки состава |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | последовательность реализации и Definition of Done |
| [ROADMAP.md](ROADMAP.md) | состояние этапов и ближайший backlog |
| [adr/](adr/) | принятые архитектурные решения |

При конфликте документов действует следующий приоритет:

1. `docs/REQUIREMENTS.md`;
2. принятые ADR;
3. `docs/ARCHITECTURE.md`;
4. `docs/IMPLEMENTATION_PLAN.md`;
5. `docs/ROADMAP.md`;
6. `README.md`.
