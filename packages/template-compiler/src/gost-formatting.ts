import { OoxmlPackageError, readOoxmlPackage, writeOoxmlPackage, type OoxmlPackageEntry } from "./ooxml-package.js";

export type DocumentFormattingProfile =
  | "gost-r-7.0.97-2025"
  | "eskd-gost-r-2.105-2019"
  | "custom";

export interface DocumentFormattingSettings {
  profile: DocumentFormattingProfile;
  fontFamily: string;
  fontSizePt: number;
  lineSpacing: number;
  firstLineIndentMm: number;
  marginsMm: { top: number; right: number; bottom: number; left: number };
  bodyAlignment: "left" | "both";
}

export interface DocumentFormattingFinding {
  code:
    | "font_family_differs"
    | "font_size_differs"
    | "line_spacing_differs"
    | "first_line_indent_differs"
    | "page_margins_differ"
    | "styles_missing"
    | "section_properties_missing";
  severity: "info" | "warning" | "blocking";
  actual: string | number | null;
  recommended: string | number | null;
  message: string;
}

export interface DocumentFormattingAnalysis {
  profile: DocumentFormattingProfile;
  standardLabel: string;
  settings: DocumentFormattingSettings;
  findings: DocumentFormattingFinding[];
  metrics: {
    sections: number;
    paragraphs: number;
    tables: number;
    drawings: number;
    equations: number;
  };
  notes: string[];
}

export interface DocumentFormattingResult {
  buffer: Buffer;
  analysisBefore: DocumentFormattingAnalysis;
  settings: DocumentFormattingSettings;
  changedParts: string[];
  untouchedParts: string[];
}

export class DocumentFormattingError extends Error {
  override readonly name = "DocumentFormattingError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const PROFILE_DEFAULTS: Readonly<Record<Exclude<DocumentFormattingProfile, "custom">, Omit<DocumentFormattingSettings, "profile">>> = Object.freeze({
  "gost-r-7.0.97-2025": {
    // ГОСТ Р 7.0.97-2025 задаёт минимальные поля; гарнитура закрепляется локальным актом организации.
    // В Оформляторе TNR 14 используется как редактируемая стартовая предустановка, а не как утверждение о единственно допустимом шрифте.
    fontFamily: "Times New Roman",
    fontSizePt: 14,
    lineSpacing: 1.5,
    firstLineIndentMm: 12.5,
    marginsMm: { top: 20, right: 10, bottom: 20, left: 20 },
    bodyAlignment: "both"
  },
  "eskd-gost-r-2.105-2019": {
    fontFamily: "Times New Roman",
    fontSizePt: 14,
    lineSpacing: 1.5,
    firstLineIndentMm: 12.5,
    marginsMm: { top: 20, right: 10, bottom: 20, left: 20 },
    bodyAlignment: "both"
  }
});

export function documentFormattingProfile(profile: Exclude<DocumentFormattingProfile, "custom">): DocumentFormattingSettings {
  return { profile, ...PROFILE_DEFAULTS[profile], marginsMm: { ...PROFILE_DEFAULTS[profile].marginsMm } };
}

export function documentFormattingProfileLabel(profile: DocumentFormattingProfile): string {
  if (profile === "gost-r-7.0.97-2025") return "ГОСТ Р 7.0.97-2025";
  if (profile === "eskd-gost-r-2.105-2019") return "ЕСКД — ГОСТ Р 2.105-2019";
  return "Пользовательский профиль";
}

function finite(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new DocumentFormattingError("invalid_settings", `${name} должен быть в диапазоне ${minimum}…${maximum}.`);
  }
  return value;
}

export function normalizeDocumentFormattingSettings(input: DocumentFormattingSettings): DocumentFormattingSettings {
  const fontFamily = String(input.fontFamily ?? "").trim();
  if (!fontFamily || fontFamily.length > 120 || /[<>\u0000-\u001f]/u.test(fontFamily)) {
    throw new DocumentFormattingError("invalid_settings", "Некорректная гарнитура шрифта.");
  }
  const profile = input.profile;
  if (!["gost-r-7.0.97-2025", "eskd-gost-r-2.105-2019", "custom"].includes(profile)) {
    throw new DocumentFormattingError("invalid_settings", "Неизвестный профиль форматирования.");
  }
  return {
    profile,
    fontFamily,
    fontSizePt: finite(input.fontSizePt, "Размер шрифта", 8, 32),
    lineSpacing: finite(input.lineSpacing, "Межстрочный интервал", 1, 3),
    firstLineIndentMm: finite(input.firstLineIndentMm, "Абзацный отступ", 0, 50),
    marginsMm: {
      top: finite(input.marginsMm?.top, "Верхнее поле", 5, 70),
      right: finite(input.marginsMm?.right, "Правое поле", 5, 70),
      bottom: finite(input.marginsMm?.bottom, "Нижнее поле", 5, 70),
      left: finite(input.marginsMm?.left, "Левое поле", 5, 70)
    },
    bodyAlignment: input.bodyAlignment === "left" ? "left" : "both"
  };
}

function entry(entries: readonly OoxmlPackageEntry[], name: string): OoxmlPackageEntry | null {
  return entries.find((candidate) => candidate.name === name) ?? null;
}

function xmlText(entries: readonly OoxmlPackageEntry[], name: string): string | null {
  const found = entry(entries, name);
  return found === null ? null : found.content.toString("utf8");
}

function xmlAttr(fragment: string | null, name: string): string | null {
  if (fragment === null) return null;
  const match = new RegExp(`\\bw:${name}="([^"]*)"`, "u").exec(fragment);
  return match?.[1] ?? null;
}

function defaultRunProperties(styles: string): string | null {
  const match = /<w:rPrDefault\b[^>]*>\s*<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>\s*<\/w:rPrDefault>/u.exec(styles);
  return match?.[1] ?? null;
}

function defaultParagraphProperties(styles: string): string | null {
  const match = /<w:pPrDefault\b[^>]*>\s*<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>\s*<\/w:pPrDefault>/u.exec(styles);
  return match?.[1] ?? null;
}

function firstPageMargin(documentXml: string): string | null {
  return /<w:pgMar\b[^>]*\/?\s*>/u.exec(documentXml)?.[0] ?? null;
}

function halfPoints(value: number | null): number | null {
  if (value === null) return null;
  return Number.isFinite(value) ? value / 2 : null;
}

function twipsToMm(value: string | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number / 56.6929133858 : null;
}

function closeEnough(left: number | null, right: number, tolerance: number): boolean {
  return left !== null && Math.abs(left - right) <= tolerance;
}

function addFinding(findings: DocumentFormattingFinding[], finding: DocumentFormattingFinding): void {
  findings.push(finding);
}

export async function analyzeDocumentFormatting(
  buffer: Uint8Array,
  settingsInput: DocumentFormattingSettings
): Promise<DocumentFormattingAnalysis> {
  const settings = normalizeDocumentFormattingSettings(settingsInput);
  let entries: OoxmlPackageEntry[];
  try {
    entries = await readOoxmlPackage(buffer);
  } catch (error) {
    if (error instanceof OoxmlPackageError) {
      throw new DocumentFormattingError(error.code, error.message);
    }
    throw error;
  }
  const documentXml = xmlText(entries, "word/document.xml");
  if (documentXml === null) {
    throw new DocumentFormattingError("not_docx", "В файле нет основной части word/document.xml.");
  }
  const styles = xmlText(entries, "word/styles.xml");
  const findings: DocumentFormattingFinding[] = [];
  if (styles === null) {
    addFinding(findings, {
      code: "styles_missing", severity: "blocking", actual: null, recommended: "word/styles.xml", message: "В DOCX отсутствует таблица стилей Word."
    });
  } else {
    const run = defaultRunProperties(styles);
    const paragraph = defaultParagraphProperties(styles);
    const font = xmlAttr(run, "ascii") ?? xmlAttr(run, "hAnsi");
    const fontSize = halfPoints(Number(xmlAttr(run, "val")) || null);
    const spacingFragment = paragraph ? /<w:spacing\b[^>]*\/?\s*>/u.exec(paragraph)?.[0] ?? null : null;
    const indentFragment = paragraph ? /<w:ind\b[^>]*\/?\s*>/u.exec(paragraph)?.[0] ?? null : null;
    const line = Number(xmlAttr(spacingFragment, "line"));
    const lineSpacing = Number.isFinite(line) && line > 0 ? line / 240 : null;
    const firstLine = twipsToMm(xmlAttr(indentFragment, "firstLine"));
    if (font !== settings.fontFamily) addFinding(findings, { code: "font_family_differs", severity: "warning", actual: font, recommended: settings.fontFamily, message: "Основной шрифт отличается от выбранного профиля." });
    if (!closeEnough(fontSize, settings.fontSizePt, 0.1)) addFinding(findings, { code: "font_size_differs", severity: "warning", actual: fontSize, recommended: settings.fontSizePt, message: "Размер основного шрифта отличается от выбранного профиля." });
    if (!closeEnough(lineSpacing, settings.lineSpacing, 0.05)) addFinding(findings, { code: "line_spacing_differs", severity: "warning", actual: lineSpacing, recommended: settings.lineSpacing, message: "Межстрочный интервал отличается от выбранного профиля." });
    if (!closeEnough(firstLine, settings.firstLineIndentMm, 0.6)) addFinding(findings, { code: "first_line_indent_differs", severity: "warning", actual: firstLine, recommended: settings.firstLineIndentMm, message: "Абзацный отступ отличается от выбранного профиля." });
  }
  const margin = firstPageMargin(documentXml);
  if (margin === null) {
    addFinding(findings, { code: "section_properties_missing", severity: "blocking", actual: null, recommended: "w:pgMar", message: "Не удалось определить поля страницы." });
  } else {
    const current = {
      top: twipsToMm(xmlAttr(margin, "top")), right: twipsToMm(xmlAttr(margin, "right")), bottom: twipsToMm(xmlAttr(margin, "bottom")), left: twipsToMm(xmlAttr(margin, "left"))
    };
    const differs = (Object.keys(settings.marginsMm) as Array<keyof typeof settings.marginsMm>).some((side) => !closeEnough(current[side], settings.marginsMm[side], 0.6));
    if (differs) addFinding(findings, { code: "page_margins_differ", severity: "warning", actual: JSON.stringify(current), recommended: JSON.stringify(settings.marginsMm), message: "Поля страницы отличаются от выбранного профиля." });
  }
  return {
    profile: settings.profile,
    standardLabel: documentFormattingProfileLabel(settings.profile),
    settings,
    findings,
    metrics: {
      sections: (documentXml.match(/<w:sectPr\b/gu) ?? []).length,
      paragraphs: (documentXml.match(/<w:p(?:\s|>)/gu) ?? []).length,
      tables: (documentXml.match(/<w:tbl(?:\s|>)/gu) ?? []).length,
      drawings: (documentXml.match(/<(?:w:drawing|w:pict)(?:\s|>)/gu) ?? []).length,
      equations: (documentXml.match(/<m:oMath(?:Para)?(?:\s|>)/gu) ?? []).length
    },
    notes: [
      "Исходный DOCX не изменяется: результат сохраняется отдельной копией.",
      "Формулы, изображения, таблицы, колонтитулы и неизвестные OOXML-части переносятся без перекодирования.",
      "Автоматически нормализуются базовый стиль текста и поля страницы; смысловая разметка заголовков и реквизитов не угадывается без подтверждения пользователя."
    ]
  };
}

function escapeXml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function replaceOrAppend(parentContent: string, childPattern: RegExp, child: string): string {
  if (childPattern.test(parentContent)) return parentContent.replace(childPattern, child);
  return `${parentContent}${child}`;
}

function setXmlAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`\\bw:${name}="[^"]*"`, "u");
  if (pattern.test(tag)) return tag.replace(pattern, `w:${name}="${value}"`);
  const close = tag.endsWith("/>") ? "/>" : ">";
  return tag.slice(0, -close.length) + ` w:${name}="${value}"` + close;
}

function updateRunProperties(source: string, settings: DocumentFormattingSettings): string {
  const font = escapeXml(settings.fontFamily);
  const size = String(Math.round(settings.fontSizePt * 2));
  let result = source;
  const rFonts = /<w:rFonts\b[^>]*\/?\s*>/u;
  const fontsTag = rFonts.exec(result)?.[0] ?? "<w:rFonts/>";
  let nextFonts = fontsTag;
  for (const attr of ["ascii", "hAnsi", "eastAsia", "cs"] as const) nextFonts = setXmlAttribute(nextFonts, attr, font);
  result = replaceOrAppend(result, rFonts, nextFonts);
  const sizeTag = `<w:sz w:val="${size}"/>`;
  result = replaceOrAppend(result, /<w:sz\b[^>]*\/?\s*>/u, sizeTag);
  result = replaceOrAppend(result, /<w:szCs\b[^>]*\/?\s*>/u, `<w:szCs w:val="${size}"/>`);
  return result;
}

function updateParagraphProperties(source: string, settings: DocumentFormattingSettings): string {
  const line = String(Math.round(settings.lineSpacing * 240));
  const firstLine = String(Math.round(settings.firstLineIndentMm * 56.6929133858));
  const jc = settings.bodyAlignment === "left" ? "left" : "both";
  let result = source;
  const spacingPattern = /<w:spacing\b[^>]*\/?\s*>/u;
  let spacing = spacingPattern.exec(result)?.[0] ?? "<w:spacing/>";
  spacing = setXmlAttribute(spacing, "line", line);
  spacing = setXmlAttribute(spacing, "lineRule", "auto");
  result = replaceOrAppend(result, spacingPattern, spacing);
  const indentPattern = /<w:ind\b[^>]*\/?\s*>/u;
  let indent = indentPattern.exec(result)?.[0] ?? "<w:ind/>";
  indent = setXmlAttribute(indent, "firstLine", firstLine);
  result = replaceOrAppend(result, indentPattern, indent);
  result = replaceOrAppend(result, /<w:jc\b[^>]*\/?\s*>/u, `<w:jc w:val="${jc}"/>`);
  return result;
}

function formatStylesXml(source: string, settings: DocumentFormattingSettings): string {
  let result = source;
  const defaultsPattern = /<w:docDefaults\b[^>]*>([\s\S]*?)<\/w:docDefaults>/u;
  const defaultsMatch = defaultsPattern.exec(result);
  if (defaultsMatch) {
    let defaults = defaultsMatch[1] ?? "";
    const runPattern = /<w:rPrDefault\b([^>]*)>\s*<w:rPr\b([^>]*)>([\s\S]*?)<\/w:rPr>\s*<\/w:rPrDefault>/u;
    const runMatch = runPattern.exec(defaults);
    if (runMatch) {
      const body = updateRunProperties(runMatch[3] ?? "", settings);
      defaults = defaults.replace(runPattern, `<w:rPrDefault${runMatch[1] ?? ""}><w:rPr${runMatch[2] ?? ""}>${body}</w:rPr></w:rPrDefault>`);
    } else {
      defaults += `<w:rPrDefault><w:rPr>${updateRunProperties("", settings)}</w:rPr></w:rPrDefault>`;
    }
    const paragraphPattern = /<w:pPrDefault\b([^>]*)>\s*<w:pPr\b([^>]*)>([\s\S]*?)<\/w:pPr>\s*<\/w:pPrDefault>/u;
    const paragraphMatch = paragraphPattern.exec(defaults);
    if (paragraphMatch) {
      const body = updateParagraphProperties(paragraphMatch[3] ?? "", settings);
      defaults = defaults.replace(paragraphPattern, `<w:pPrDefault${paragraphMatch[1] ?? ""}><w:pPr${paragraphMatch[2] ?? ""}>${body}</w:pPr></w:pPrDefault>`);
    } else {
      defaults += `<w:pPrDefault><w:pPr>${updateParagraphProperties("", settings)}</w:pPr></w:pPrDefault>`;
    }
    result = result.replace(defaultsPattern, `<w:docDefaults>${defaults}</w:docDefaults>`);
  } else {
    const close = "</w:styles>";
    if (!result.includes(close)) throw new DocumentFormattingError("invalid_styles_xml", "Не удалось обновить word/styles.xml.");
    result = result.replace(close, `<w:docDefaults><w:rPrDefault><w:rPr>${updateRunProperties("", settings)}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${updateParagraphProperties("", settings)}</w:pPr></w:pPrDefault></w:docDefaults>${close}`);
  }
  return result;
}

function updatePageMargins(tag: string, settings: DocumentFormattingSettings): string {
  const toTwips = (mm: number) => String(Math.round(mm * 56.6929133858));
  let result = tag;
  for (const side of ["top", "right", "bottom", "left"] as const) {
    result = setXmlAttribute(result, side, toTwips(settings.marginsMm[side]));
  }
  return result;
}

function formatDocumentXml(source: string, settings: DocumentFormattingSettings): string {
  let sections = 0;
  const result = source.replace(/<w:sectPr\b([^>]*)>([\s\S]*?)<\/w:sectPr>/gu, (_whole, attrs: string, body: string) => {
    sections += 1;
    const marginPattern = /<w:pgMar\b[^>]*\/?\s*>/u;
    const existing = marginPattern.exec(body)?.[0] ?? null;
    const margin = updatePageMargins(existing ?? "<w:pgMar/>", settings);
    const next = existing === null ? `${margin}${body}` : body.replace(marginPattern, margin);
    return `<w:sectPr${attrs}>${next}</w:sectPr>`;
  });
  if (sections === 0) throw new DocumentFormattingError("section_properties_missing", "В документе нет свойств раздела для безопасного изменения полей.");
  return result;
}

export async function formatDocumentToProfile(
  buffer: Uint8Array,
  settingsInput: DocumentFormattingSettings
): Promise<DocumentFormattingResult> {
  const settings = normalizeDocumentFormattingSettings(settingsInput);
  const analysisBefore = await analyzeDocumentFormatting(buffer, settings);
  if (analysisBefore.findings.some((finding) => finding.severity === "blocking")) {
    throw new DocumentFormattingError("document_not_formatable", "Документ не прошёл структурную проверку и не был изменён.");
  }
  const entries = await readOoxmlPackage(buffer);
  const changedParts: string[] = [];
  const next = entries.map((candidate) => {
    if (candidate.name === "word/styles.xml") {
      changedParts.push(candidate.name);
      return { ...candidate, content: Buffer.from(formatStylesXml(candidate.content.toString("utf8"), settings), "utf8") };
    }
    if (candidate.name === "word/document.xml") {
      changedParts.push(candidate.name);
      return { ...candidate, content: Buffer.from(formatDocumentXml(candidate.content.toString("utf8"), settings), "utf8") };
    }
    return candidate;
  });
  const output = writeOoxmlPackage(next);
  // Защита от регрессии writer: результат обязан повторно открываться тем же строгим reader.
  await readOoxmlPackage(output);
  return {
    buffer: output,
    analysisBefore,
    settings,
    changedParts,
    untouchedParts: entries.map((candidate) => candidate.name).filter((name) => !changedParts.includes(name))
  };
}
