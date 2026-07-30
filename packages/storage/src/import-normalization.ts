export type ImportCaseMode =
  | "preserve"
  | "lower"
  | "upper"
  | "title"
  | "name";

export interface ImportCellNormalization {
  trim?: boolean;
  collapseWhitespace?: boolean;
  unicode?: "NFC" | "NFKC";
  case?: ImportCaseMode;
}

export interface PersonNameSplitOptions {
  enabled?: boolean;
  sourceColumn?: string;
  order?: "family-given-patronymic" | "given-patronymic-family";
  normalization?: ImportCellNormalization;
}

export interface SplitPersonName {
  familyName: string;
  givenName: string;
  patronymic: string;
  normalizedDisplayName: string;
}

function capitalizeWord(value: string): string {
  if (value.length === 0) return value;
  return `${value.slice(0, 1).toLocaleUpperCase("ru-RU")}${value
    .slice(1)
    .toLocaleLowerCase("ru-RU")}`;
}

function titleCase(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/(^|[\s\-–—'’])([\p{L}])/gu, (_match, prefix: string, letter: string) =>
      `${prefix}${letter.toLocaleUpperCase("ru-RU")}`
    );
}

function nameCase(value: string): string {
  return value
    .split(/(\s+)/u)
    .map((part) => {
      if (/^\s+$/u.test(part)) return part;
      return part
        .split(/([\-–—'’])/u)
        .map((token) =>
          /^[\-–—'’]$/u.test(token) ? token : capitalizeWord(token)
        )
        .join("");
    })
    .join("");
}

export function normalizeImportText(
  value: unknown,
  options: ImportCellNormalization = {}
): unknown {
  if (typeof value !== "string") return value;
  const unicode = options.unicode ?? "NFKC";
  let normalized = value.normalize(unicode);
  if (options.trim !== false) normalized = normalized.trim();
  if (options.collapseWhitespace !== false) {
    normalized = normalized.replace(/[\s\u00a0]+/gu, " ");
  }
  switch (options.case ?? "preserve") {
    case "lower":
      return normalized.toLocaleLowerCase("ru-RU");
    case "upper":
      return normalized.toLocaleUpperCase("ru-RU");
    case "title":
      return titleCase(normalized);
    case "name":
      return nameCase(normalized);
    default:
      return normalized;
  }
}

export function normalizeIdentityForComparison(value: unknown): string {
  const normalized = normalizeImportText(value, {
    unicode: "NFKC",
    trim: true,
    collapseWhitespace: true,
    case: "lower"
  });
  return typeof normalized === "string" ? normalized : String(normalized ?? "");
}

export function splitRussianPersonName(
  value: unknown,
  options: PersonNameSplitOptions = {}
): SplitPersonName {
  const normalizedValue = normalizeImportText(value, {
    unicode: "NFKC",
    trim: true,
    collapseWhitespace: true,
    case: "name",
    ...(options.normalization ?? {})
  });
  const normalizedDisplayName =
    typeof normalizedValue === "string" ? normalizedValue : "";
  const parts = normalizedDisplayName.split(" ").filter(Boolean);
  if (parts.length === 0) {
    return {
      familyName: "",
      givenName: "",
      patronymic: "",
      normalizedDisplayName: ""
    };
  }

  if ((options.order ?? "family-given-patronymic") === "given-patronymic-family") {
    if (parts.length === 1) {
      return {
        familyName: "",
        givenName: parts[0] ?? "",
        patronymic: "",
        normalizedDisplayName
      };
    }
    if (parts.length === 2) {
      return {
        familyName: parts[1] ?? "",
        givenName: parts[0] ?? "",
        patronymic: "",
        normalizedDisplayName
      };
    }
    return {
      familyName: parts.at(-1) ?? "",
      givenName: parts[0] ?? "",
      patronymic: parts.slice(1, -1).join(" "),
      normalizedDisplayName
    };
  }

  return {
    familyName: parts[0] ?? "",
    givenName: parts[1] ?? "",
    patronymic: parts.slice(2).join(" "),
    normalizedDisplayName
  };
}

export function normalizeImportRow(
  row: Readonly<Record<string, unknown>>,
  mappings: ReadonlyArray<{
    column: string;
    normalization?: ImportCellNormalization;
  }>,
  input: {
    identityColumn: string;
    displayNameColumn: string;
    identityNormalization?: ImportCellNormalization;
    displayNameNormalization?: ImportCellNormalization;
  }
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...row };
  normalized[input.identityColumn] = normalizeImportText(
    row[input.identityColumn],
    input.identityNormalization
  );
  normalized[input.displayNameColumn] = normalizeImportText(
    row[input.displayNameColumn],
    input.displayNameNormalization
  );
  for (const mapping of mappings) {
    if (!mapping.normalization) continue;
    normalized[mapping.column] = normalizeImportText(
      row[mapping.column],
      mapping.normalization
    );
  }
  return normalized;
}
