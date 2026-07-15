const DEFAULT_MESSAGE =
  "Не удалось выполнить операцию. Проверьте введённые данные и повторите действие.";

const RUSSIAN_TEXT = /[А-Яа-яЁё]/u;

type MessageRule = readonly [RegExp, (match: RegExpMatchArray) => string];

const rules: readonly MessageRule[] = [
  [/^Internal server error$/i, () =>
    "Внутренняя ошибка сервера. Повторите действие или сообщите администратору идентификатор операции."],
  [/^(.+) must not be empty$/i, (match) =>
    `Не заполнено обязательное поле «${match[1]}».`],
  [/^(.+) must be a string$/i, (match) =>
    `Поле «${match[1]}» должно содержать текст.`],
  [/^(.+) must not exceed (\d+) characters$/i, (match) =>
    `Поле «${match[1]}» не должно быть длиннее ${match[2]} знаков.`],
  [/^(.+) must start with (?:a |a Latin )?letter and contain lowercase (?:Latin )?letters, digits, dots, underscores or hyphens$/i, (match) =>
    `Поле «${match[1]}» должно начинаться с латинской буквы и содержать только строчные латинские буквы, цифры, точки, подчёркивания или дефисы.`],
  [/^Invalid mutation timestamp$/i, () => "Указано недопустимое время изменения."],
  [/^(.+) is not a valid calendar date$/i, (match) =>
    `Поле «${match[1]}» содержит недопустимую календарную дату.`],
  [/^(.+) must be an ISO date or date-time$/i, (match) =>
    `Поле «${match[1]}» должно содержать дату или дату и время в установленном формате.`],
  [/^(.+) must not be after (.+)$/i, (match) =>
    `Значение «${match[1]}» не может быть позже «${match[2]}».`],
  [/^(.+) must be an integer in range (.+)$/i, (match) =>
    `Поле «${match[1]}» должно быть целым числом в диапазоне ${match[2]}.`],
  [/^fileName must not contain a path$/i, () =>
    "Имя файла не должно содержать путь к каталогу."],
  [/^Document buffer must not be empty$/i, () =>
    "Нельзя сохранить пустой документ."],
  [/^Multi-field trial requires at least two saved fields$/i, () =>
    "Для общей проверки сохраните не менее двух полей черновика."],
  [/^Multi-field trial supports at most 100 saved fields$/i, () =>
    "За один проход можно проверить не более 100 полей."],
  [/^Multi-field trial must provide exactly all draft fields;/i, () =>
    "Для общей проверки заполните все поля текущего черновика без посторонних идентификаторов."],
  [/^Duplicate fieldId in multi-field request:/i, () =>
    "Одно поле передано в общую проверку несколько раз."],
  [/^One or more template fields were not found in this draft$/i, () =>
    "Одно или несколько полей не найдены в текущем черновике."],
  [/^Stored template field changed before multi-field testing:/i, () =>
    "Поле изменилось после подготовки набора. Обновите черновик и повторите проверку."],
  [/^Multi-field test format does not match the template draft$/i, () =>
    "Формат многополевой проверки не совпадает с форматом черновика."],
  [/^Compiled and trial documents must not be empty$/i, () =>
    "Нельзя сохранить пустую скомпилированную или пробную копию."],
  [/^Rendered value must match the read-back value$/i, () =>
    "Пробное значение не прошло обратную проверку и версия не сохранена."],
  [/^Test version format does not match the template draft$/i, () =>
    "Формат проверяемой версии не совпадает с форматом черновика."],
  [/^LibreOffice did not produce a valid PDF preview$/i, () =>
    "LibreOffice не создал допустимый PDF предварительного просмотра."],
  [/^PDF preview exceeds the 128 MB limit$/i, () =>
    "PDF предварительного просмотра превышает предел 128 МБ."],
  [/^Template preview PDF is not ready$/i, () =>
    "PDF предварительного просмотра ещё не готов. Дождитесь завершения операции."],
  [/^Template preview must be ready before activation$/i, () =>
    "Перед активацией дождитесь готового предварительного просмотра."],
  [/^Ready preview already points to another PDF$/i, () =>
    "Для запроса уже сохранён другой PDF. Обновите страницу и проверьте журнал операции."],
  [/^Ready preview cannot be replaced with a failure$/i, () =>
    "Готовый предварительный просмотр нельзя заменить ошибкой."],
  [/^expectedSha256 must contain 64 hexadecimal characters$/i, () =>
    "Контрольная сумма документа имеет недопустимый формат."],
  [/^Document checksum changed after the safety check$/i, () =>
    "Файл изменился после проверки безопасности. Выполните проверку ещё раз."],
  [/^Only documents accepted by the safety check can be placed in quarantine$/i, () =>
    "В карантин можно сохранить только документ, прошедший проверку безопасности."],
  [/^Unsupported document format: (.+)$/i, (match) =>
    `Формат документа «${match[1]}» не поддерживается.`],
  [/^Quarantine document was not found in this space: (.+)$/i, () =>
    "Сохранённый исходник не найден в выбранном пространстве."],
  [/^Template draft was not found in this space: (.+)$/i, () =>
    "Черновик шаблона не найден в выбранном пространстве."],
  [/^Template draft field was not found in this space: (.+)$/i, () =>
    "Поле черновика не найдено в выбранном пространстве."],
  [/^Template field was not found in this draft: (.+)$/i, () =>
    "Поле шаблона не найдено в этом черновике."],
  [/^Template test version was not found in this space: (.+)$/i, () =>
    "Проверенная версия шаблона не найдена в выбранном пространстве."],
  [/^Template preview was not found in this space: (.+)$/i, () =>
    "Запрос предварительного просмотра не найден в выбранном пространстве."],
  [/^Ready template preview was not found in this space: (.+)$/i, () =>
    "Готовый предварительный просмотр не найден в выбранном пространстве."],
  [/^Active template version was not found in this space: (.+)$/i, () =>
    "Активная версия шаблона не найдена в выбранном пространстве."],
  [/^Employee was not found in this space: (.+)$/i, () =>
    "Сотрудник не найден в выбранном пространстве."],
  [/^Employee idempotency key was reused with different input: (.+)$/i, () =>
    "Этот запрос на создание сотрудника уже был выполнен с другими данными. Обновите список сотрудников и повторите действие."],
  [/^Employee update idempotency key was reused with different input: (.+)$/i, () =>
    "Этот запрос на изменение сотрудника уже был выполнен с другими данными. Обновите карточку сотрудника и повторите действие."],
  [/^Employee property label is ambiguous: (.+)$/i, (match) =>
    `Найдено несколько полей с названием «${match[1]}». Выберите существующее поле или переименуйте дубликаты.`],
  [/^Employee property label already uses another value type: (.+)$/i, (match) =>
    `Поле «${match[1]}» уже существует с другим типом данных. Выберите существующее поле или укажите другое название.`],
  [/^Structure element was not found: (.+)$/i, () =>
    "Выбранный элемент не найден в сохранённой структуре. Постройте структуру заново и повторите выбор."],
  [/^Template field already exists: (.+)$/i, (match) =>
    `Поле с ключом «${match[1]}» уже существует в этом черновике.`],
  [/^Template element already has a scalar field: (.+)$/i, () =>
    "Выбранный элемент уже связан с другим скалярным полем."],
  [/^Template field does not match the current draft structure$/i, () =>
    "Поле относится к другой версии структуры. Постройте структуру заново."],
  [/^A draft already exists for another structure version of this source$/i, () =>
    "Для исходника уже существует черновик с другой версией структуры. Обновите черновик отдельной операцией."],
  [/^Template draft source no longer matches the verified document$/i, () =>
    "Исходник черновика больше не соответствует проверенному документу."],
  [/^Stored source checksum changed before draft creation$/i, () =>
    "Контрольная сумма сохранённого исходника изменилась. Обратитесь к администратору."],
  [/^Stored file metadata conflicts with content-addressed object$/i, () =>
    "Метаданные сохранённого файла не совпадают с его контрольной суммой. Обратитесь к администратору."],
  [/^(.+) was not found: (.+)$/i, (match) =>
    `${russianObjectName(match[1] ?? "")} «${match[2]}» не найдено.`],
  [/^(.+) already exists: (.+)$/i, (match) =>
    `${russianObjectName(match[1] ?? "")} «${match[2]}» уже существует.`],
  [/^Referenced entity was not found: (.+)$/i, (match) =>
    `Связанный объект «${match[1]}» не найден.`],
  [/^Referenced file was not found: (.+)$/i, (match) =>
    `Связанный файл «${match[1]}» не найден.`],
  [/^Property (.+) does not apply to entity type (.+)$/i, (match) =>
    `Свойство «${match[1]}» нельзя использовать для типа «${match[2]}».`],
  [/enum value is not allowed/i, () =>
    "Выбрано значение, которого нет в разрешённом списке."],
  [/audience group member must belong to the same space/i, () =>
    "Участник группы должен находиться в том же пространстве."],
  [/audience snapshot member must belong to the snapshot space/i, () =>
    "Участник снимка должен находиться в том же пространстве."],
  [/audience snapshots are immutable/i, () =>
    "Снимок состава уже зафиксирован и не может быть изменён."],
  [/audience snapshot members are immutable/i, () =>
    "Состав зафиксированного снимка не может быть изменён."],
  [/remove entity from audience groups before moving it to another space/i, () =>
    "Перед переносом удалите участника из всех групп текущего пространства."],
  [/source\.groupId is required for group selection/i, () =>
    "Для выбора сохранённой группы не указан её идентификатор."],
  [/source\.entityIds is required for selected selection/i, () =>
    "Для разового выбора не указаны отмеченные участники."],
  [/FOREIGN KEY constraint failed/i, () =>
    "Связанный объект не найден либо используется другой записью."],
  [/UNIQUE constraint failed/i, () => "Такая запись уже существует."],
  [/CHECK constraint failed/i, () =>
    "Одно из значений нарушает установленные ограничения."],
  [/NOT NULL constraint failed/i, () =>
    "Не заполнено обязательное значение."],
  [/database is locked/i, () =>
    "База данных временно занята. Повторите действие через несколько секунд."]
];

function russianObjectName(value: string): string {
  const normalized = value.trim().toLowerCase();
  const names: Record<string, string> = {
    "entity type": "Тип сущности",
    entity: "Объект",
    employee: "Сотрудник",
    "property definition": "Свойство",
    property: "Свойство",
    space: "Пространство",
    group: "Группа",
    "audience group": "Группа",
    "audience snapshot": "Снимок состава",
    "template draft": "Черновик шаблона",
    "template field": "Поле шаблона",
    "template test version": "Проверенная версия",
    "multi-field test version": "Многополевая проверенная версия",
    "template preview": "Предварительный просмотр",
    "active template version": "Активная версия шаблона",
    "structure element": "Элемент структуры",
    "quarantine document": "Сохранённый исходник"
  };
  return names[normalized] ?? "Запись";
}

export function toUserMessage(error: Error): string {
  const source = error.message.trim();
  if (source.length === 0) {
    return DEFAULT_MESSAGE;
  }
  for (const [pattern, format] of rules) {
    const match = source.match(pattern);
    if (match !== null) {
      return format(match);
    }
  }
  if (RUSSIAN_TEXT.test(source)) {
    return source;
  }
  return DEFAULT_MESSAGE;
}

export function requestValidationMessage(): string {
  return "Проверьте заполнение формы: одно или несколько значений не соответствуют требованиям.";
}

export function internalErrorMessage(): string {
  return "Внутренняя ошибка сервера. Повторите действие или сообщите администратору идентификатор операции.";
}
