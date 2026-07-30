export type DataImportPersonNameOrder =
  | "family-given-patronymic"
  | "given-patronymic-family";

export type DataImportValueTransform =
  | "person-family"
  | "person-given"
  | "person-patronymic";

export interface DataImportPersonNameOptions {
  normalizeCase?: boolean;
  split?: boolean;
  sourceOrder?: DataImportPersonNameOrder;
}

export interface ParsedImportPersonName {
  displayName: string;
  family: string;
  given: string;
  patronymic: string;
}

export function collapseImportWhitespace(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\n\f\v ]+/gu, " ")
    .trim();
}

export function caseInsensitiveImportKey(value: string): string {
  return collapseImportWhitespace(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е");
}

function capitalizeNameSegment(value: string): string {
  const characters = [...value.toLocaleLowerCase("ru-RU")];
  if (characters.length === 0) return "";
  return `${characters[0]?.toLocaleUpperCase("ru-RU") ?? ""}${characters
    .slice(1)
    .join("")}`;
}

export function normalizePersonNameToken(value: string): string {
  return collapseImportWhitespace(value)
    .split(/([-’'])/u)
    .map((part) => (/^[-’']$/u.test(part) ? part : capitalizeNameSegment(part)))
    .join("");
}

export function parseImportPersonName(
  value: string,
  options: DataImportPersonNameOptions = {}
): ParsedImportPersonName {
  const source = collapseImportWhitespace(value);
  const parts = source.split(" ").filter(Boolean);
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(
      "Для разделения ФИО требуется два или три слова. Исправьте значение либо отключите разделение."
    );
  }
  const order = options.sourceOrder ?? "family-given-patronymic";
  const familyIndex = order === "family-given-patronymic" ? 0 : parts.length - 1;
  const givenIndex = order === "family-given-patronymic" ? 1 : 0;
  const patronymicIndex = parts.length === 3
    ? order === "family-given-patronymic"
      ? 2
      : 1
    : -1;
  const format = (part: string | undefined) =>
    options.normalizeCase === true ? normalizePersonNameToken(part ?? "") : part ?? "";
  const family = format(parts[familyIndex]);
  const given = format(parts[givenIndex]);
  const patronymic = patronymicIndex < 0 ? "" : format(parts[patronymicIndex]);
  const displayName = order === "family-given-patronymic"
    ? [family, given, patronymic].filter(Boolean).join(" ")
    : [given, patronymic, family].filter(Boolean).join(" ");
  return { displayName, family, given, patronymic };
}

export function normalizeImportPersonDisplayName(
  value: string,
  options: DataImportPersonNameOptions | undefined
): string {
  const collapsed = collapseImportWhitespace(value);
  if (options?.split === true) return parseImportPersonName(collapsed, options).displayName;
  if (options?.normalizeCase !== true) return collapsed;
  return collapsed
    .split(" ")
    .filter(Boolean)
    .map(normalizePersonNameToken)
    .join(" ");
}

export function transformedPersonNameValue(
  value: string,
  transform: DataImportValueTransform,
  options: DataImportPersonNameOptions | undefined
): string {
  const parsed = parseImportPersonName(value, options);
  if (transform === "person-family") return parsed.family;
  if (transform === "person-given") return parsed.given;
  return parsed.patronymic;
}

export function equalImportValues(
  left: unknown,
  right: unknown,
  caseInsensitive: boolean
): boolean {
  if (!caseInsensitive || typeof left !== "string" || typeof right !== "string") {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return caseInsensitiveImportKey(left) === caseInsensitiveImportKey(right);
}

export function canonicalEnumImportValue(
  value: string,
  allowedValues: readonly string[],
  caseInsensitive: boolean
): string {
  if (!caseInsensitive) return value;
  const identity = caseInsensitiveImportKey(value);
  return allowedValues.find(
    (candidate) => caseInsensitiveImportKey(candidate) === identity
  ) ?? value;
}
