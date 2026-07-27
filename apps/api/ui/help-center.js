{
  const helpCenterCategories = [
    ["all", "Все"],
    ["start", "Начало работы"],
    ["data", "Люди и данные"],
    ["templates", "Шаблоны"],
    ["generation", "Выпуск документов"],
    ["automation", "Расписания и доставка"],
    ["cases", "Практические кейсы"],
    ["admin", "Администратору"],
    ["technical", "Устройство проекта"]
  ];

  const helpCenterArticles = [
    {
      id: "quick-start",
      category: "start",
      title: "Быстрый старт: от пустой системы до готовых файлов",
      summary: "Полная последовательность первого рабочего выпуска без пропуска обязательных этапов.",
      keywords: "первый запуск быстрый старт сотрудники шаблон выпуск документы",
      view: "overview",
      body: `
        <p>Рабочий поток Docomator состоит из данных, проверенного шаблона, зафиксированного состава и задания на формирование.</p>
        <ol>
          <li>Выберите текущий раздел данных.</li>
          <li>Добавьте людей вручную либо импортируйте CSV/XLSX.</li>
          <li>Заполните поля, которые используются в будущем документе.</li>
          <li>Создайте группу, если состав будет использоваться повторно.</li>
          <li>Загрузите DOCX или XLSX в разделе «Шаблоны».</li>
          <li>Проверьте исходник и сохраните безопасную копию.</li>
          <li>Постройте структуру и свяжите изменяемые места с полями карточек.</li>
          <li>Выполните пробное заполнение всех полей.</li>
          <li>Активируйте проверенную версию шаблона.</li>
          <li>В разделе «Создать документы» выберите шаблон, состав и форму результата.</li>
          <li>Исправьте недостающие обязательные сведения.</li>
          <li>Запустите формирование и скачайте результат.</li>
        </ol>
        <div class="help-center-note"><strong>Основное правило</strong><p>Активированный шаблон неизменяем. Для исправления документа создаётся и проверяется новая версия.</p></div>
      `
    },
    {
      id: "concepts",
      category: "start",
      title: "Раздел, карточка, поле, группа и снимок состава",
      summary: "Краткая модель данных, необходимая для выбора правильного рабочего потока.",
      keywords: "раздел пространство карточка поле группа снимок аудитория состав",
      view: "spaces",
      body: `
        <dl class="help-center-definition-list">
          <div><dt>Раздел данных</dt><dd>Набор связанных людей, групп, шаблонов и процессов: подразделение, факультет, филиал или проект.</dd></div>
          <div><dt>Карточка человека</dt><dd>ФИО, статус и индивидуальные значения общих полей.</dd></div>
          <div><dt>Поле</dt><dd>Общее определение значения, например «Должность», «Тема научной работы» или «Дата рождения».</dd></div>
          <div><dt>Группа</dt><dd>Редактируемый именованный и упорядоченный состав людей для повторных запусков.</dd></div>
          <div><dt>Снимок состава</dt><dd>Неизменяемая фиксация людей, порядка и режима результата перед конкретным запуском.</dd></div>
          <div><dt>Активный шаблон</dt><dd>Проверенная неизменяемая версия DOCX/XLSX, разрешённая для формирования.</dd></div>
        </dl>
        <p>Раздел не является границей доступа. Все клиенты, допущенные корпоративным периметром, работают с общими данными.</p>
      `
    },
    {
      id: "manual-people",
      category: "data",
      title: "Добавление и редактирование человека вручную",
      summary: "Как создать карточку, добавить общее поле и не размножать дублирующие определения.",
      keywords: "сотрудник человек карточка добавить поле должность вручную редактировать",
      view: "employees",
      body: `
        <ol>
          <li>Откройте «Сотрудники» и нажмите «Добавить сотрудника».</li>
          <li>Введите ФИО и выберите статус.</li>
          <li>Для нового значения нажмите «Добавить поле».</li>
          <li>Сначала найдите существующее поле по названию.</li>
          <li>Создавайте новое поле только при отсутствии подходящего.</li>
          <li>Подтвердите создание: новое определение станет доступно всем карточкам.</li>
          <li>Введите значение и сохраните карточку.</li>
        </ol>
        <h4>Как выбрать тип</h4>
        <table><thead><tr><th>Тип</th><th>Примеры</th></tr></thead><tbody>
          <tr><td>Короткий текст</td><td>Должность, телефон, номер документа</td></tr>
          <tr><td>Длинный текст</td><td>Тема работы, примечание, кем выдан паспорт</td></tr>
          <tr><td>Список вариантов</td><td>Подразделение, должность, учебная группа</td></tr>
          <tr><td>Дата</td><td>Дата рождения, дата выдачи</td></tr>
          <tr><td>Число</td><td>Оклад, ставка, коэффициент</td></tr>
        </tbody></table>
      `
    },
    {
      id: "bulk-import",
      category: "data",
      title: "Массовый импорт CSV, XLSX и вставленной таблицы",
      summary: "Полуавтоматическое сопоставление колонок, предварительная проверка и безопасное обновление карточек.",
      keywords: "импорт excel xlsx csv вставить таблицу сопоставить колонки паспорт должность",
      view: "employees",
      body: `
        <h4>Подготовка таблицы</h4>
        <p>Первая строка содержит уникальные заголовки. Каждая следующая строка описывает одного человека.</p>
        <pre><code>ФИО\tТабельный номер\tДолжность\tПодразделение\tДата рождения
Иванов Иван Иванович\tТ-001\tИнженер\tМетеослужба\t1985-05-10</code></pre>
        <h4>Порядок действий</h4>
        <ol>
          <li>Откройте «Сотрудники» → «Импортировать список».</li>
          <li>Выберите CSV/XLSX либо вставьте диапазон из Excel/LibreOffice.</li>
          <li>Укажите колонку ФИО.</li>
          <li>Укажите стабильную колонку для повторного распознавания человека.</li>
          <li>Проверьте предложенное сопоставление каждой колонки.</li>
          <li>Для новых полей проверьте название, тип и класс данных.</li>
          <li>Для перечней проверьте варианты и разрешение новых значений.</li>
          <li>При необходимости создайте группу из импортируемых людей.</li>
          <li>Нажмите «Проверить»: система рассчитает итог внутри откатываемой транзакции.</li>
          <li>Исправьте ошибочные строки и подтвердите импорт.</li>
        </ol>
        <h4>Ключ повторного импорта</h4>
        <p>Предпочитайте табельный номер, номер зачётной книжки, кадровый код или рабочую почту. ФИО используйте только при отсутствии постоянного идентификатора.</p>
        <div class="help-center-note"><strong>Пустые ячейки безопасны</strong><p>Пустая ячейка не стирает ранее сохранённое значение.</p></div>
      `
    },
    {
      id: "import-mapping",
      category: "data",
      title: "Как проверять автоматическое сопоставление колонок",
      summary: "Уверенность, псевдонимы, типы, чувствительность и перечни вариантов.",
      keywords: "сопоставление колонки уверенность псевдонимы чувствительность список вариантов",
      view: "employees",
      body: `
        <p>Система сравнивает заголовок с названием поля, его псевдонимами, смысловыми вариантами и ранее подтверждёнными решениями браузера.</p>
        <ul>
          <li><strong>Высокая уверенность:</strong> обычно достаточно проверить несколько примеров.</li>
          <li><strong>Средняя уверенность:</strong> обязательно сравните назначение поля и значения.</li>
          <li><strong>Новое поле:</strong> проверьте, не существует ли уже аналог с другим названием.</li>
        </ul>
        <h4>Класс данных</h4>
        <ul>
          <li>Рабочие сведения — должность, подразделение, тема работы.</li>
          <li>Персональные данные — дата рождения, телефон, почта, табельный номер.</li>
          <li>Особо чувствительные — паспорт, СНИЛС, адрес регистрации.</li>
        </ul>
        <h4>Списки вариантов</h4>
        <p>Расширяемый список автоматически принимает новые должности или группы. Закрытый список отклоняет неизвестное значение и подходит для нормативного классификатора.</p>
      `
    },
    {
      id: "xlsx-values",
      category: "data",
      title: "Даты, номера документов и ведущие нули в XLSX",
      summary: "Как Excel хранит форматированные значения и что проверять перед импортом.",
      keywords: "excel дата число ведущий ноль паспорт серия номер формат ячейки",
      view: "employees",
      body: `
        <p>Excel может хранить дату как число, а видимую дату — в стиле ячейки. Аналогично номер <code>0123 456789</code> может храниться как <code>123456789</code>.</p>
        <ul>
          <li>Docomator распознаёт стандартные и пользовательские форматы дат.</li>
          <li>Поддерживаются календарные системы Excel 1900 и 1904.</li>
          <li>Цифровые маски из нулей сохраняют ведущие нули и разделители.</li>
          <li>Для критичных идентификаторов предпочтителен текстовый формат ячейки.</li>
        </ul>
        <p>Перед подтверждением импорта проверьте примеры паспортных серий, кодов подразделений, СНИЛС, ИНН и табельных номеров.</p>
      `
    },
    {
      id: "groups",
      category: "data",
      title: "Группы, разовый выбор и все активные участники",
      summary: "Как выбрать источник состава и не потерять воспроизводимость запуска.",
      keywords: "группа участники выбрать отмеченные все активные снимок состава",
      view: "spaces",
      body: `
        <table><thead><tr><th>Источник</th><th>Когда использовать</th></tr></thead><tbody>
          <tr><td>Все активные</td><td>Документ должен охватить всех активных людей раздела</td></tr>
          <tr><td>Сохранённая группа</td><td>Состав используется многократно или по расписанию</td></tr>
          <tr><td>Отмеченные вручную</td><td>Разовая комиссия или единичная выборка</td></tr>
        </tbody></table>
        <p>Перед запуском создаётся неизменяемый снимок. Позднее редактирование группы не изменяет уже начатое задание.</p>
      `
    },
    {
      id: "docx-template",
      category: "templates",
      title: "Полный поток настройки DOCX-шаблона",
      summary: "Проверка, структура, привязка, пробное заполнение и активация.",
      keywords: "docx word шаблон загрузить структура связать поле активация проверка",
      view: "templates",
      body: `
        <ol>
          <li>Загрузите обычный DOCX без макросов и исполняемых вложений.</li>
          <li>Выполните проверку безопасности и сохраните принятую копию.</li>
          <li>Постройте структуру документа.</li>
          <li>Выберите абзац, текстовый фрагмент или ячейку таблицы.</li>
          <li>Свяжите место с полем карточки.</li>
          <li>Для подписи вида «Должность: ____» выделите только заменяемый фрагмент.</li>
          <li>Настройте формат ФИО, числа или даты.</li>
          <li>Повторите для всех изменяемых мест.</li>
          <li>Выполните пробное заполнение всего набора полей.</li>
          <li>Скачайте и визуально проверьте пробную копию.</li>
          <li>Активируйте проверенную версию.</li>
        </ol>
        <div class="help-center-warning"><strong>Не заменяйте весь абзац без необходимости</strong><p>Иначе постоянная подпись до или после поля будет удалена.</p></div>
      `
    },
    {
      id: "word-roster",
      category: "templates",
      title: "Таблица Word: одна строка на каждого участника",
      summary: "Настройка сводного реестра студентов, сотрудников, тем и руководителей.",
      keywords: "word таблица повторяемая строка студенты темы руководители список реестр",
      view: "templates",
      body: `
        <p>В DOCX должна быть строка заголовков и одна образцовая строка данных.</p>
        <table><thead><tr><th>ФИО</th><th>Тема научной работы</th><th>Научный руководитель</th></tr></thead><tbody><tr><td></td><td></td><td></td></tr></tbody></table>
        <ol>
          <li>Выберите любую ячейку образцовой строки.</li>
          <li>Нажмите «Настроить строку».</li>
          <li>Для ФИО выберите «ФИО участника».</li>
          <li>Свяжите остальные колонки с полями карточек.</li>
          <li>Отметьте обязательные значения.</li>
          <li>Нажмите «Связать всю строку».</li>
          <li>Выполните многополевую пробную проверку.</li>
          <li>Активируйте шаблон.</li>
          <li>При выпуске выберите группу и режим «Один сводный документ».</li>
        </ol>
        <h4>Ограничения</h4>
        <ul><li>Одна повторяемая область в шаблоне первой версии.</li><li>До 1000 участников.</li><li>Без вложенных повторов и сложного вертикального объединения.</li></ul>
      `
    },
    {
      id: "xlsx-template",
      category: "templates",
      title: "Настройка XLSX-шаблона и повторяемого диапазона",
      summary: "Ячейки, формулы, строки списка и безопасное повторение.",
      keywords: "xlsx excel шаблон ячейка диапазон повтор строка формула",
      view: "templates",
      body: `
        <ol>
          <li>Загрузите обычный XLSX без макросов и внешних связей.</li>
          <li>Постройте структуру.</li>
          <li>Для одиночных значений выбирайте обычные ячейки без формул.</li>
          <li>Для списка выберите образцовую строку или непрерывный диапазон.</li>
          <li>Свяжите все изменяемые ячейки внутри выбранного диапазона.</li>
          <li>Выполните пробное заполнение и проверьте формулы вокруг области.</li>
          <li>Активируйте версию.</li>
        </ol>
        <p>Формулы вне изменяемой области сохраняются. Небезопасные переносы формул и связей блокируются.</p>
      `
    },
    {
      id: "trial-activation",
      category: "templates",
      title: "Пробное заполнение и активация версии",
      summary: "Почему шаблон нельзя выпускать сразу после сопоставления полей.",
      keywords: "пробное заполнение активация версия проверка считать обратно",
      view: "templates",
      body: `
        <p>При пробной проверке система создаёт копию, записывает значения, считывает их обратно и сравнивает результат.</p>
        <ul>
          <li>Для одного поля доступна одиночная проверка.</li>
          <li>Для нескольких полей и повторяемой строки используется проверка полного набора.</li>
          <li>Расхождение или отсутствие привязки блокирует активацию.</li>
          <li>После активации версия неизменяема.</li>
        </ul>
        <p>Перед активацией визуально проверьте подписи, ФИО, даты, числа, число строк и оформление.</p>
      `
    },
    {
      id: "generation-flow",
      category: "generation",
      title: "Создание документов: полный поток",
      summary: "Выбор шаблона, состава, режима, предварительная проверка и запуск.",
      keywords: "создать документы выпуск шаблон состав режим проверить запустить",
      view: "generation",
      body: `
        <ol>
          <li>Выберите активный шаблон.</li>
          <li>Выберите источник участников: все активные, группа или отмеченные.</li>
          <li>Выберите форму результата.</li>
          <li>Подготовьте снимок состава.</li>
          <li>Выполните предварительную проверку обязательных данных.</li>
          <li>Заполните недостающие значения либо вернитесь к карточкам.</li>
          <li>Подтвердите запуск.</li>
          <li>Следите за состоянием задания.</li>
          <li>Скачайте результат или запустите доставку.</li>
        </ol>
        <table><thead><tr><th>Режим</th><th>Подходит для</th></tr></thead><tbody>
          <tr><td>По документу на каждого</td><td>Справки, договоры, заявления, уведомления</td></tr>
          <tr><td>Один сводный документ</td><td>Ведомости, реестры, списки, таблицы</td></tr>
        </tbody></table>
      `
    },
    {
      id: "preflight",
      category: "generation",
      title: "Предварительная проверка и быстрое исправление данных",
      summary: "Как устранить пропуски перед запуском без перехода по каждой карточке.",
      keywords: "предварительная проверка пропущенные поля быстро исправить обязательные",
      view: "generation",
      body: `
        <p>Проверка показывает готовых участников, отсутствующие обязательные значения и возможность запуска.</p>
        <ol>
          <li>Откройте список пропусков.</li>
          <li>Введите значение рядом с конкретным человеком.</li>
          <li>Сохраните заполненные строки.</li>
          <li>Дождитесь повторной проверки.</li>
          <li>Запускайте документ после устранения блокирующих пропусков.</li>
        </ol>
        <p>Введённые значения сохраняются в карточках и доступны следующим документам.</p>
      `
    },
    {
      id: "results",
      category: "generation",
      title: "Результаты, частичный выпуск и повтор ошибок",
      summary: "Что означают состояния и как не формировать заново уже готовые файлы.",
      keywords: "результаты ошибка частично повтор скачать архив готово очередь",
      view: "documents",
      body: `
        <table><thead><tr><th>Состояние</th><th>Значение</th></tr></thead><tbody>
          <tr><td>Ожидает</td><td>Задание находится в очереди</td></tr>
          <tr><td>Выполняется</td><td>Фоновый обработчик формирует файлы</td></tr>
          <tr><td>Завершено</td><td>Все ожидаемые файлы готовы</td></tr>
          <tr><td>Частично</td><td>Часть файлов готова, часть завершилась ошибкой</td></tr>
          <tr><td>Ошибка</td><td>Задание не создало пригодного результата</td></tr>
        </tbody></table>
        <p>При частичном результате скачайте готовые файлы, исправьте причины и повторите только неуспешные единицы. Повтор использует тот же снимок состава.</p>
      `
    },
    {
      id: "schedules",
      category: "automation",
      title: "Расписания повторных выпусков",
      summary: "Создание, включение, проверка и восстановление автоматического правила.",
      keywords: "расписание автоматизация ежедневно еженедельно ежемесячно часовой пояс",
      view: "automations",
      body: `
        <ol>
          <li>Выберите активный шаблон и раздел.</li>
          <li>Выберите всех активных либо сохранённую группу.</li>
          <li>Укажите форму результата.</li>
          <li>Настройте периодичность, дату, время и часовой пояс.</li>
          <li>Настройте разрешённый канал доставки.</li>
          <li>Проверьте ближайший запуск.</li>
          <li>Включите расписание.</li>
          <li>После первого запуска проверьте результат и доставку.</li>
        </ol>
        <p>При нехватке обязательных данных неполный документ не отправляется. Отключение правила не удаляет историю.</p>
      `
    },
    {
      id: "delivery",
      category: "automation",
      title: "Доставка по электронной почте и в сетевую папку",
      summary: "Как отличить ошибку формирования от ошибки передачи готового файла.",
      keywords: "доставка email почта smtp сетевая папка samba mount отправить",
      view: "documents",
      body: `
        <h4>Электронная почта</h4>
        <ul><li>SMTP настраивает администратор.</li><li>Получатели должны соответствовать политике организации.</li><li>Пароли и заголовки авторизации не показываются в журналах.</li></ul>
        <h4>Сетевая папка</h4>
        <ul><li>Путь входит в разрешённый перечень.</li><li>Ресурс должен быть смонтирован.</li><li>Проверяется контрольный файл каталога.</li><li>Запись выполняется временным файлом и атомарным переименованием.</li></ul>
        <div class="help-center-note"><strong>Не формируйте документ заново</strong><p>Если файл уже готов, после восстановления канала повторите только доставку.</p></div>
      `
    },
    {
      id: "student-case",
      category: "cases",
      title: "Кейс: студенты, темы работ и научные руководители",
      summary: "Импорт таблицы и создание одной строки Word на каждого студента.",
      keywords: "студенты тема научной работы руководитель кафедра группа курс",
      view: "employees",
      body: `
        <pre><code>ФИО\tНомер зачётной книжки\tУчебная группа\tТема научной работы\tНаучный руководитель
Иванов Иван Иванович\tЗК-001\tМ-21\tОценка точности прогноза осадков\tПетров Пётр Петрович</code></pre>
        <ol>
          <li>Импортируйте таблицу и выберите номер зачётной книжки как ключ.</li>
          <li>Тему назначьте длинным текстом, учебную группу — перечнем.</li>
          <li>Создайте группу студентов.</li>
          <li>В DOCX подготовьте заголовок и одну образцовую строку.</li>
          <li>Свяжите всю строку с ФИО, темой и руководителем.</li>
          <li>Протестируйте и активируйте шаблон.</li>
          <li>Создайте один сводный документ по группе.</li>
        </ol>
      `
    },
    {
      id: "passport-case",
      category: "cases",
      title: "Кейс: сотрудники с паспортными данными",
      summary: "Типы полей, чувствительность, даты и контроль ведущих нулей.",
      keywords: "паспорт серия номер кем выдан дата выдачи код подразделения снилс инн",
      view: "employees",
      body: `
        <ul>
          <li>Табельный номер используйте как ключ.</li>
          <li>Серию, номер, код подразделения, СНИЛС и ИНН храните как текст.</li>
          <li>Дату рождения и дату выдачи храните как дату.</li>
          <li>«Кем выдан» храните как длинный текст.</li>
          <li>Паспорт, СНИЛС и адрес регистрации помечайте как особо чувствительные.</li>
          <li>Перед подтверждением проверьте ведущие нули и примеры дат.</li>
        </ul>
        <p>После импорта повторно загрузите небольшой контрольный файл с теми же ключами и убедитесь, что карточки обновляются без дубликатов.</p>
      `
    },
    {
      id: "hr-case",
      category: "cases",
      title: "Кейс: справки и договоры каждому сотруднику",
      summary: "Персональные документы из общей базы карточек.",
      keywords: "справка договор каждому сотруднику персональный отдельный документ",
      view: "generation",
      body: `
        <ol>
          <li>Подготовьте карточки с должностью, подразделением и необходимыми реквизитами.</li>
          <li>Свяжите поля в DOCX и выполните пробное заполнение.</li>
          <li>Активируйте версию.</li>
          <li>Выберите группу сотрудников.</li>
          <li>Выберите «По документу на каждого».</li>
          <li>Исправьте пропуски и запустите выпуск.</li>
          <li>Скачайте архив либо передайте файлы по разрешённому каналу.</li>
        </ol>
        <p>Юридически значимые документы требуют проверки ответственным лицом после формирования.</p>
      `
    },
    {
      id: "recurring-case",
      category: "cases",
      title: "Кейс: ежемесячный реестр по постоянной группе",
      summary: "Сводный документ по расписанию с контролем данных и доставки.",
      keywords: "ежемесячный реестр постоянная группа расписание автоматический",
      view: "automations",
      body: `
        <ol>
          <li>Создайте и поддерживайте постоянную группу.</li>
          <li>Активируйте сводный шаблон с повторяемой строкой.</li>
          <li>Создайте расписание и выберите группу.</li>
          <li>Настройте время, часовой пояс и доставку.</li>
          <li>Проверьте первый запуск вручную.</li>
          <li>Контролируйте пропуски данных, состояние worker и свободное место.</li>
        </ol>
      `
    },
    {
      id: "errors",
      category: "cases",
      title: "Ошибки и восстановление рабочего потока",
      summary: "Что делать при дубликатах, пропусках, частичном результате и ошибке доставки.",
      keywords: "ошибка восстановить дубликаты пропуск частично доставка идентификатор операции",
      view: "settings",
      body: `
        <table><thead><tr><th>Ситуация</th><th>Действие</th></tr></thead><tbody>
          <tr><td>Импорт создаёт дубликаты</td><td>Проверьте стабильный ключ и ведущие нули</td></tr>
          <tr><td>Строка импорта отклонена</td><td>Исправьте указанный ключ, тип или значение перечня</td></tr>
          <tr><td>Сводный документ не запускается</td><td>Заполните обязательные поля всех участников</td></tr>
          <tr><td>Результат частичный</td><td>Повторите только неуспешные единицы</td></tr>
          <tr><td>Ошибка сетевой доставки</td><td>Сохраните готовый файл и повторите доставку после восстановления ресурса</td></tr>
          <tr><td>Ошибка шаблона</td><td>Не меняйте активную версию; подготовьте новую и выполните пробную проверку</td></tr>
        </tbody></table>
        <p>Всегда сохраняйте идентификатор операции, точное время, раздел, шаблон и сообщение интерфейса.</p>
      `
    },
    {
      id: "operations",
      category: "admin",
      title: "Администратору: запуск, обновление и проверка служб",
      summary: "Минимальный эксплуатационный порядок для Debian и Astra Linux.",
      keywords: "администратор установка обновление systemctl api worker migrate backup",
      view: "settings",
      body: `
        <h4>После получения обновления</h4>
        <pre><code>git switch main
git pull --ff-only
npm ci
npm run build
npm run migrate
sudo systemctl restart docomator-api.service docomator-worker.service
sudo systemctl status docomator-api.service docomator-worker.service --no-pager</code></pre>
        <h4>Перед обновлением</h4>
        <ul><li>Создайте резервную копию.</li><li>Проверьте свободное место.</li><li>Зафиксируйте текущую версию.</li><li>Не редактируйте применённые миграции.</li></ul>
        <h4>После обновления</h4>
        <ul><li>Проверьте <code>/readyz</code>.</li><li>Откройте веб-интерфейс.</li><li>Проверьте карточки, шаблоны, расписания и результаты.</li><li>Сформируйте контрольный документ.</li></ul>
      `
    },
    {
      id: "backup",
      category: "admin",
      title: "Резервное копирование, восстановление и хранение",
      summary: "Что защищать и что проверить после восстановления.",
      keywords: "backup restore резервная копия восстановление хранилище база",
      view: "settings",
      body: `
        <pre><code>npm run backup
npm run restore</code></pre>
        <p>Резервная копия должна защищаться как рабочая база, поскольку содержит карточки, шаблоны и результаты.</p>
        <h4>После восстановления</h4>
        <ul><li>готовность API;</li><li>доступность базы;</li><li>список сотрудников;</li><li>активные шаблоны;</li><li>результаты и расписания;</li><li>работу фонового обработчика.</li></ul>
      `
    },
    {
      id: "security",
      category: "admin",
      title: "Безопасность и границы доверенного контура",
      summary: "Что приложение защищает само и что должен обеспечить администратор.",
      keywords: "безопасность интернет роли доступ персональные данные пароль локальный контур",
      view: "settings",
      body: `
        <ul>
          <li>Docomator не следует публиковать напрямую в Интернет.</li>
          <li>В приложении нет входа, ролей и разграничения прав.</li>
          <li>Доступ ограничивается корпоративной сетью и операционной системой.</li>
          <li>Каталог данных доступен только системному пользователю службы и администраторам.</li>
          <li>Резервные копии защищаются как рабочие данные.</li>
          <li>Макросы, ActiveX, исполняемые вложения и опасные связи шаблонов отклоняются.</li>
          <li>Класс чувствительности управляет маскированием и аудитом, но не является правом доступа.</li>
        </ul>
      `
    },
    {
      id: "technical-map",
      category: "technical",
      title: "Карта документации проекта",
      summary: "Где находится нормативная, эксплуатационная и разработческая документация.",
      keywords: "документация требования архитектура эксплуатация тз roadmap adr api",
      view: "settings",
      body: `
        <p>Веб-центр содержит рабочие инструкции оператора, администратора и каталог кейсов. Полные нормативные документы хранятся в каталоге <code>docs/</code>.</p>
        <table><thead><tr><th>Документ</th><th>Назначение</th></tr></thead><tbody>
          <tr><td><code>docs/USER_GUIDE.md</code></td><td>Полное руководство оператора</td></tr>
          <tr><td><code>docs/USE_CASES.md</code></td><td>Каталог практических кейсов</td></tr>
          <tr><td><code>docs/IMPORT_AND_WORD_ROSTERS.md</code></td><td>Импорт людей и повторяемые строки Word</td></tr>
          <tr><td><code>docs/REQUIREMENTS.md</code></td><td>Нормативные требования</td></tr>
          <tr><td><code>docs/UX_UI_SPECIFICATION.md</code></td><td>Требования к интерфейсу</td></tr>
          <tr><td><code>docs/ARCHITECTURE.md</code></td><td>Архитектура и границы компонентов</td></tr>
          <tr><td><code>docs/TEMPLATE_COMPILER.md</code></td><td>Компиляция DOCX/XLSX</td></tr>
          <tr><td><code>docs/SPACES_AND_AUDIENCES.md</code></td><td>Разделы, группы и снимки состава</td></tr>
          <tr><td><code>docs/OPERATIONS.md</code></td><td>Эксплуатация и диагностика</td></tr>
          <tr><td><code>docs/OFFLINE_DEPLOYMENT.md</code></td><td>Автономная установка и обновление</td></tr>
          <tr><td><code>docs/ROADMAP.md</code></td><td>Состояние и последующие этапы</td></tr>
          <tr><td><code>docs/adr/</code></td><td>Принятые архитектурные решения</td></tr>
        </tbody></table>
        <p>При противоречии действует порядок: требования → ADR → архитектура → план реализации → дорожная карта → README.</p>
      `
    },
    {
      id: "limits",
      category: "technical",
      title: "Текущие ограничения и ожидаемое поведение",
      summary: "Границы, которые оператор должен учитывать при подготовке файлов и процессов.",
      keywords: "ограничения 1000 строк 100 колонок 8 мб одна повторяемая область",
      view: "settings",
      body: `
        <ul>
          <li>Один импорт: до 8 МБ, 1000 строк данных и 100 колонок.</li>
          <li>При импорте XLSX читается первый рабочий лист.</li>
          <li>В одном шаблоне первой версии поддерживается одна повторяемая область.</li>
          <li>Вложенные повторы не поддерживаются.</li>
          <li>Сложные вертикальные объединения и вложенные таблицы повторяемой строки могут быть отклонены.</li>
          <li>Активированные версии и применённые миграции неизменяемы.</li>
          <li>Активный шаблон работает без локальной модели; ИИ не является обязательным для выпуска.</li>
        </ul>
      `
    }
  ];

  let helpCenterCategory = "all";
  let helpCenterQuery = "";
  let helpCenterCurrentArticle = null;
  let helpCenterReturnView = "overview";

  function helpCenterEscape(value) {
    return String(value ?? "").replace(/[&<>'"]/gu, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]);
  }

  function helpCenterPlainText(article) {
    const element = document.createElement("div");
    element.innerHTML = article.body;
    return `${article.title} ${article.summary} ${article.keywords} ${element.textContent || ""}`.toLocaleLowerCase("ru-RU");
  }

  function helpCenterSearchTerms(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/gu, "е")
      .match(/[\p{L}\p{N}]+/gu) || [];
  }

  function helpCenterFilteredArticles() {
    const terms = helpCenterSearchTerms(helpCenterQuery);
    return helpCenterArticles.filter((article) => {
      if (helpCenterCategory !== "all" && article.category !== helpCenterCategory) {
        return false;
      }
      if (terms.length === 0) return true;
      const searchable = helpCenterPlainText(article).replace(/ё/gu, "е");
      return terms.every((term) => searchable.includes(term));
    });
  }

  function helpCenterCategoryLabel(category) {
    return helpCenterCategories.find(([key]) => key === category)?.[1] || "Документация";
  }

  function helpCenterRenderList() {
    const list = document.querySelector("#helpCenterArticleList");
    const count = document.querySelector("#helpCenterCount");
    const empty = document.querySelector("#helpCenterEmpty");
    if (!list || !count || !empty) return;
    const articles = helpCenterFilteredArticles();
    count.textContent = `${articles.length} ${articles.length === 1 ? "раздел" : "разделов"}`;
    empty.hidden = articles.length > 0;
    list.innerHTML = articles.map((article) => `
      <button class="help-center-card" type="button" data-help-article="${helpCenterEscape(article.id)}">
        <span class="help-center-card-category">${helpCenterEscape(helpCenterCategoryLabel(article.category))}</span>
        <strong>${helpCenterEscape(article.title)}</strong>
        <span>${helpCenterEscape(article.summary)}</span>
        <em>Открыть раздел <span aria-hidden="true">›</span></em>
      </button>`).join("");
  }

  function helpCenterRenderArticle(articleId) {
    const article = helpCenterArticles.find((candidate) => candidate.id === articleId);
    const listPane = document.querySelector("#helpCenterIndexPane");
    const articlePane = document.querySelector("#helpCenterArticlePane");
    if (!article || !listPane || !articlePane) return;
    helpCenterCurrentArticle = article.id;
    listPane.hidden = true;
    articlePane.hidden = false;
    articlePane.innerHTML = `
      <div class="help-center-article-toolbar">
        <button class="secondary-button" type="button" data-help-back><span aria-hidden="true">‹</span> К разделам</button>
        <button class="quiet-button" type="button" data-help-print>Печать</button>
      </div>
      <article class="help-center-article">
        <header><p class="eyebrow">${helpCenterEscape(helpCenterCategoryLabel(article.category))}</p><h2>${helpCenterEscape(article.title)}</h2><p>${helpCenterEscape(article.summary)}</p></header>
        <div class="help-center-article-body">${article.body}</div>
        <footer>
          <button class="primary-button" type="button" data-help-go-view="${helpCenterEscape(article.view)}">Перейти к соответствующему разделу</button>
          <button class="secondary-button" type="button" data-help-back>Вернуться к руководству</button>
        </footer>
      </article>`;
    articlePane.querySelector("h2")?.focus?.();
    articlePane.scrollIntoView({ block: "start" });
  }

  function helpCenterShowIndex() {
    const listPane = document.querySelector("#helpCenterIndexPane");
    const articlePane = document.querySelector("#helpCenterArticlePane");
    if (!listPane || !articlePane) return;
    helpCenterCurrentArticle = null;
    listPane.hidden = false;
    articlePane.hidden = true;
    helpCenterRenderList();
    document.querySelector("#helpCenterSearch")?.focus();
  }

  function helpCenterCreateView() {
    if (document.querySelector("#helpCenterView")) return;
    const main = document.querySelector("#main-content");
    if (!main) return;
    const section = document.createElement("section");
    section.id = "helpCenterView";
    section.className = "view help-center-view";
    section.dataset.view = "help";
    section.setAttribute("aria-labelledby", "helpCenterHeading");
    section.innerHTML = `
      <div id="helpCenterIndexPane">
        <section class="help-center-hero">
          <div><p class="eyebrow">Встроенная документация</p><h2 id="helpCenterHeading">Руководство по всем рабочим потокам</h2><p>Инструкции оператора, администратора, практические кейсы и карта технической документации. Всё доступно локально без Интернета.</p></div>
          <div class="help-center-hero-mark" aria-hidden="true">?</div>
        </section>
        <div class="help-center-tools">
          <label class="search-field help-center-search" for="helpCenterSearch"><span aria-hidden="true">⌕</span><input id="helpCenterSearch" type="search" placeholder="Найти: импорт, таблица Word, расписание…" autocomplete="off" /></label>
          <span id="helpCenterCount" class="operator-counter"></span>
        </div>
        <div class="help-center-categories" role="tablist" aria-label="Разделы руководства">
          ${helpCenterCategories.map(([key, label]) => `<button type="button" role="tab" aria-selected="${key === "all"}" data-help-category="${key}">${helpCenterEscape(label)}</button>`).join("")}
        </div>
        <section class="help-center-start-path" aria-label="Рекомендуемый порядок">
          <button type="button" data-help-article="bulk-import"><span>1</span><strong>Подготовить данные</strong><small>Карточки или импорт</small></button>
          <button type="button" data-help-article="docx-template"><span>2</span><strong>Настроить шаблон</strong><small>Проверка и привязки</small></button>
          <button type="button" data-help-article="generation-flow"><span>3</span><strong>Создать документы</strong><small>Состав и проверка</small></button>
          <button type="button" data-help-article="results"><span>4</span><strong>Получить результат</strong><small>Скачать или доставить</small></button>
        </section>
        <div id="helpCenterArticleList" class="help-center-grid"></div>
        <div id="helpCenterEmpty" class="empty-state compact-empty" hidden><div><span class="empty-emoji" aria-hidden="true">⌕</span><h3>Ничего не найдено</h3><p>Измените запрос или выберите категорию «Все».</p><button class="secondary-button" type="button" data-help-clear>Очистить поиск</button></div></div>
      </div>
      <div id="helpCenterArticlePane" hidden></div>`;
    main.append(section);
  }

  function helpCenterCreateNavigation() {
    const nav = document.querySelector(".nav-list");
    if (nav && !document.querySelector("#helpCenterNavButton")) {
      const button = document.createElement("button");
      button.id = "helpCenterNavButton";
      button.className = "nav-item";
      button.type = "button";
      button.dataset.helpCenterOpen = "";
      button.innerHTML = '<span class="nav-symbol" aria-hidden="true">?</span><span>Руководство</span>';
      nav.append(button);
    }
    const settings = document.querySelector(".settings-grid");
    if (settings && !settings.querySelector("[data-help-center-open]")) {
      const button = document.createElement("button");
      button.className = "settings-row";
      button.type = "button";
      button.dataset.helpCenterOpen = "";
      button.innerHTML = '<span><strong>Руководство и рабочие кейсы</strong><small>Импорт, шаблоны, выпуск, расписания и диагностика</small></span><span aria-hidden="true">›</span>';
      settings.prepend(button);
    }
    const drawerFooter = document.querySelector("#helpDrawer footer");
    if (drawerFooter && !drawerFooter.querySelector("[data-help-center-open]")) {
      const button = document.createElement("button");
      button.className = "primary-button help-center-drawer-button";
      button.type = "button";
      button.dataset.helpCenterOpen = "";
      button.textContent = "Открыть полное руководство";
      drawerFooter.prepend(button);
    }
  }

  function helpCenterOpen() {
    helpCenterCreateView();
    const current = document.querySelector(".view.is-visible")?.dataset.view;
    if (current && current !== "help") helpCenterReturnView = current;
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("is-visible", view.dataset.view === "help"));
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      button.classList.remove("is-active");
      button.removeAttribute("aria-current");
    });
    const navButton = document.querySelector("#helpCenterNavButton");
    navButton?.classList.add("is-active");
    navButton?.setAttribute("aria-current", "page");
    document.querySelector("#helpDrawer")?.classList.remove("is-open");
    document.querySelector("#helpDrawer")?.setAttribute("aria-hidden", "true");
    const eyebrow = document.querySelector("#viewEyebrow");
    const title = document.querySelector("#viewTitle");
    const description = document.querySelector("#viewDescription");
    const primary = document.querySelector("#primaryAction");
    if (eyebrow) eyebrow.textContent = "Документация";
    if (title) title.textContent = "Руководство";
    if (description) description.textContent = "Все рабочие потоки, кейсы, ограничения и действия при ошибках.";
    if (primary) primary.hidden = true;
    window.history.replaceState(null, "", "#help");
    if (helpCenterCurrentArticle) helpCenterRenderArticle(helpCenterCurrentArticle);
    else helpCenterShowIndex();
    document.querySelector("#helpCenterHeading")?.focus?.();
    window.dispatchEvent(new CustomEvent("docomator:help-opened"));
  }

  function helpCenterGoView(view) {
    helpCenterCurrentArticle = null;
    document.querySelector("#helpCenterNavButton")?.classList.remove("is-active");
    document.querySelector("#helpCenterNavButton")?.removeAttribute("aria-current");
    globalThis.docomatorSelectView?.(view || helpCenterReturnView || "overview");
  }

  function helpCenterAttachEvents() {
    document.addEventListener("click", (event) => {
      const open = event.target.closest("[data-help-center-open]");
      if (open) {
        event.preventDefault();
        helpCenterOpen();
        return;
      }
      const article = event.target.closest("[data-help-article]");
      if (article) {
        helpCenterRenderArticle(article.dataset.helpArticle);
        return;
      }
      const category = event.target.closest("[data-help-category]");
      if (category) {
        helpCenterCategory = category.dataset.helpCategory || "all";
        document.querySelectorAll("[data-help-category]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.helpCategory === helpCenterCategory)));
        helpCenterRenderList();
        return;
      }
      if (event.target.closest("[data-help-back]")) {
        helpCenterShowIndex();
        return;
      }
      const go = event.target.closest("[data-help-go-view]");
      if (go) {
        helpCenterGoView(go.dataset.helpGoView);
        return;
      }
      if (event.target.closest("[data-help-print]")) {
        window.print();
        return;
      }
      if (event.target.closest("[data-help-clear]")) {
        helpCenterQuery = "";
        helpCenterCategory = "all";
        const input = document.querySelector("#helpCenterSearch");
        if (input) input.value = "";
        document.querySelectorAll("[data-help-category]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.helpCategory === "all")));
        helpCenterRenderList();
      }
      if (event.target.closest("[data-view-target]")) {
        document.querySelector("#helpCenterNavButton")?.classList.remove("is-active");
        document.querySelector("#helpCenterNavButton")?.removeAttribute("aria-current");
      }
    });
    document.addEventListener("input", (event) => {
      if (!event.target.matches("#helpCenterSearch")) return;
      helpCenterQuery = event.target.value;
      helpCenterRenderList();
    });
    window.addEventListener("hashchange", () => {
      if (location.hash === "#help") helpCenterOpen();
    });
  }

  helpCenterCreateView();
  helpCenterCreateNavigation();
  helpCenterAttachEvents();
  helpCenterRenderList();
  globalThis.docomatorOpenHelpCenter = helpCenterOpen;
  if (location.hash === "#help") helpCenterOpen();
}
