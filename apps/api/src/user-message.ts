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
  [/^(.+) must start with a letter and contain lowercase letters, digits, dots, underscores or hyphens$/i, (match) =>
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
  [/^Unsupported (.+): (.+)$/i, (match) =>
    `Значение «${match[2]}» не поддерживается для поля «${match[1]}».`],
  [/^(.+) already exists: (.+)$/i, (match) =>
    `${russianObjectName(match[1] ?? "")} «${match[2]}» уже существует.`],
  [/^(.+) was not found: (.+)$/i, (match) =>
    `${russianObjectName(match[1] ?? "")} «${match[2]}» не найдено.`],
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
    "property definition": "Свойство",
    property: "Свойство",
    space: "Пространство",
    group: "Группа",
    "audience group": "Группа",
    "audience snapshot": "Снимок состава"
  };
  return names[normalized] ?? "Запись";
}

export function toUserMessage(error: Error): string {
  const source = error.message.trim();
  if (source.length === 0) {
    return DEFAULT_MESSAGE;
  }
  if (RUSSIAN_TEXT.test(source)) {
    return source;
  }
  for (const [pattern, format] of rules) {
    const match = source.match(pattern);
    if (match !== null) {
      return format(match);
    }
  }
  return DEFAULT_MESSAGE;
}

export function requestValidationMessage(): string {
  return "Проверьте заполнение формы: одно или несколько значений не соответствуют требованиям.";
}

export function internalErrorMessage(): string {
  return "Внутренняя ошибка сервера. Повторите действие или сообщите администратору идентификатор операции.";
}
