import { createHash } from "node:crypto";
import path from "node:path";
import type { OoxmlPackageEntry } from "./ooxml-package.js";
import { TemplateCompilerError } from "./errors.js";

// Operates only on XML that already passed bounded OOXML intake. Patches retain
// every byte except document-unique metadata on newly cloned rows.
const tagPattern = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w.:-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/gu;
const nameOf = (tag: string): string => /^<\/?(?:[\w.-]+:)?([\w.-]+)/u.exec(tag)?.[1] ?? "";
const attr = (tag: string, name: string): string | null =>
  new RegExp(`\\s(?:[\\w.-]+:)?${name}\\s*=\\s*(["'])(.*?)\\1`, "u").exec(tag)?.[2] ?? null;
function setAttr(tag: string, name: string, value: string): string {
  return tag.replace(new RegExp(`(\\s(?:[\\w.-]+:)?${name}\\s*=\\s*)(["'])(.*?)\\2`, "u"),
    (_all, prefix: string, quote: string) => `${prefix}${quote}${value}${quote}`);
}
function tags(xml: string): string[] {
  return [...xml.matchAll(tagPattern)].map((match) => match[0])
    .filter((tag) => !tag.startsWith("<!") && !tag.startsWith("<?"));
}
function limitation(detail: string): never {
  throw new TemplateCompilerError("unsupported_repeat_row", `${detail} Исходник и настроенные поля сохранены.`);
}

function decoded(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/giu, (_all, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[entity] ?? "";
  });
}
function validateInstruction(instruction: string): void {
  const command = decoded(instruction).trim().match(/^(?:[A-Za-z]+|=)/u)?.[0]?.toUpperCase();
  const allowed = new Set(["=", "DATE", "TIME", "PAGE", "NUMPAGES", "SECTION", "SECTIONPAGES", "NUMWORDS", "NUMCHARS",
    "FILENAME", "DOCPROPERTY", "AUTHOR", "TITLE", "SUBJECT", "KEYWORDS", "COMMENTS", "CREATEDATE", "PRINTDATE",
    "SAVEDATE", "REVNUM", "EDITTIME", "REF", "PAGEREF", "NOTEREF", "SEQ", "QUOTE", "IF", "MERGEFIELD",
    "FORMULA", "STYLEREF", "LISTNUM", "AUTONUM", "HYPERLINK", "SYMBOL", "EQ", "TOC", "TOA", "INDEX"]);
  if (!command || !allowed.has(command)) limitation("В повторяемой строке есть поле Word с внешним или неподдерживаемым действием. Сохраните его отображаемый результат как обычный текст.");
}
function validateInstructions(xml: string): void {
  const stack: Array<{ text: string; separated: boolean }> = [];
  const tokens = [...xml.matchAll(tagPattern)];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]; if (!token) continue;
    const tag = token[0]; if (tag.startsWith("</") || tag.startsWith("<!") || tag.startsWith("<?")) continue;
    const name = nameOf(tag);
    if (name === "fldSimple") validateInstruction(attr(tag, "instr") ?? "");
    if (name === "fldChar") {
      const type = attr(tag, "fldCharType");
      if (type === "begin") stack.push({ text: "", separated: false });
      else if (type === "separate") {
        const field = stack.at(-1);
        if (!field || field.separated) limitation("В строке повреждено вычисляемое поле Word.");
        validateInstruction(field.text); field.separated = true;
      } else if (type === "end") {
        const field = stack.pop(); if (!field) limitation("Вычисляемое поле Word пересекает границу строки.");
        if (!field.separated) validateInstruction(field.text);
      } else limitation("В строке повреждено вычисляемое поле Word.");
    }
    if (name === "instrText") {
      const field = stack.at(-1);
      const close = tokens[index + 1];
      if (!field || field.separated || !close || !close[0].startsWith("</") || nameOf(close[0]) !== "instrText") {
        limitation("Вычисляемое поле Word пересекает границу строки.");
      }
      field.text += xml.slice((token.index ?? 0) + tag.length, close.index);
    }
  }
  if (stack.length) limitation("Вычисляемое поле Word пересекает границу повторяемой строки.");
}
function decodePart(content: Buffer): string {
  if (content[0] === 0xff && content[1] === 0xfe) return content.subarray(2).toString("utf16le");
  if (content[0] === 0xfe && content[1] === 0xff) return Buffer.from(content.subarray(2)).swap16().toString("utf16le");
  return content.toString("utf8");
}
function validateImages(xml: string, entries: readonly OoxmlPackageEntry[], part: string): void {
  const blips = tags(xml).filter((tag) => !tag.startsWith("</") && nameOf(tag) === "blip");
  if (blips.length === 0) return;
  const dir = path.posix.dirname(part);
  const rel = entries.find((entry) => entry.name === path.posix.join(dir, "_rels", path.posix.basename(part) + ".rels"));
  const relationships = tags(rel ? decodePart(rel.content) : "").filter((tag) => nameOf(tag) === "Relationship");
  for (const blip of blips) {
    const id = decoded(attr(blip, "embed") ?? "");
    const matches = relationships.filter((tag) => decoded(attr(tag, "Id") ?? "") === id);
    if (matches.length !== 1) limitation("В DOCX не найдена однозначная связь встроенного изображения.");
    const relationship = matches[0]!;
    const type = decoded(attr(relationship, "Type") ?? "");
    if (decoded(attr(relationship, "TargetMode") ?? "Internal").toLowerCase() !== "internal" || !type.endsWith("/image")) {
      limitation("Изображение строки должно храниться внутри DOCX.");
    }
    let target: string;
    try { target = decodeURIComponent(decoded(attr(relationship, "Target") ?? "")); }
    catch { limitation("В DOCX повреждена ссылка на встроенное изображение."); }
    if (!target || /[\\:#?]/u.test(target)) limitation("В DOCX повреждена ссылка на встроенное изображение.");
    const name = target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join(dir, target));
    const image = entries.find((entry) => entry.name === name)?.content;
    const png = image?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = image?.[0] === 255 && image?.[1] === 216 && image?.[2] === 255;
    const gif = ["GIF87a", "GIF89a"].includes(image?.subarray(0, 6).toString("ascii") ?? "");
    if (!png && !jpeg && !gif) limitation("Для повторяемой строки используйте встроенное изображение PNG, JPEG или GIF.");
  }
}

export function validateRepeatContent(xml: string, entries: readonly OoxmlPackageEntry[] = [], part = "word/document.xml"): void {
  const starts = new Set<string>();
  const ends = new Set<string>();

  for (const tag of tags(xml)) {
    if (tag.startsWith("</")) continue;
    const name = nameOf(tag);
    if (name === "bookmarkStart") {
      const id = attr(tag, "id");
      if (id === null || starts.has(id)) limitation("В строке повреждена закладка Word.");
      starts.add(id);
    }
    if (name === "bookmarkEnd") {
      const id = attr(tag, "id");
      if (id === null || !starts.has(id) || ends.has(id)) limitation("Закладка Word пересекает границу повторяемой строки.");
      ends.add(id);
    }
    if (name === "anchor" || name === "hlinkClick" || name === "hlinkHover") {
      limitation("В повторяемой строке используйте изображение в строке текста, без плавающего якоря или действия по щелчку.");
    }
    if (name === "graphicData" && !(attr(tag, "uri") ?? "").endsWith("/picture")) {
      limitation("В повторяемой строке используйте встроенную картинку вместо диаграммы или интерактивного объекта.");
    }
    if (name === "blip" && (attr(tag, "link") !== null || attr(tag, "embed") === null)) {
      limitation("Изображение в повторяемой строке должно быть встроено в DOCX, а не загружаться по внешней ссылке.");
    }

  }
  if (starts.size !== ends.size) limitation("Закладка Word пересекает границу повторяемой строки.");
  validateInstructions(xml);
  validateImages(xml, entries, part);
}


function escapedText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function remapInstruction(instruction: string, names: ReadonlyMap<string, string>): string {
  const text = decoded(instruction);
  return text.replace(/^(\s*(?:REF|PAGEREF|NOTEREF)\s+)("[^"]+"|[^\s\\]+)/iu,
    (_all, prefix: string, argument: string) => {
      const quoted = argument.startsWith('"');
      const name = quoted ? argument.slice(1, -1) : argument;
      const mapped = names.get(name) ?? name;
      return prefix + (quoted ? `"${mapped}"` : mapped);
    }).replace(/(\\l\s+)("[^"]+"|[^\s\\]+)/iu,
    (_all, prefix: string, argument: string) => {
      const quoted = argument.startsWith('"');
      const name = quoted ? argument.slice(1, -1) : argument;
      const mapped = names.get(name) ?? name;
      return prefix + (quoted ? `"${mapped}"` : mapped);
    });
}
function rewriteBookmarkReferences(xml: string, names: ReadonlyMap<string, string>): string {
  type Part = { start: number; end: number; text: string };
  const stack: Part[][] = [];
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const tokens = [...xml.matchAll(tagPattern)];
  const flush = (parts: Part[]) => {
    const raw = parts.map((part) => part.text).join("");
    const mapped = remapInstruction(raw, names);
    if (mapped !== decoded(raw)) parts.forEach((part, index) => {
      replacements.push({ ...part, text: index === 0 ? escapedText(mapped) : "" });
    });
    parts.length = 0;
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]; if (!token) continue;
    const tag = token[0], name = nameOf(tag);
    if (tag.startsWith("</") || tag.startsWith("<!") || tag.startsWith("<?")) continue;
    if (name === "fldChar") {
      const type = attr(tag, "fldCharType");
      if (type === "begin") stack.push([]);
      else if (type === "separate") { const parts = stack.at(-1); if (parts) flush(parts); }
      else if (type === "end") { const parts = stack.pop(); if (parts) flush(parts); }
    }
    if (name === "instrText") {
      const close = tokens[index + 1];
      const parts = stack.at(-1);
      if (close && parts) {
        const start = (token.index ?? 0) + tag.length, end = close.index ?? start;
        parts.push({ start, end, text: xml.slice(start, end) });
      }
    }
    if (name === "fldSimple") {
      const original = attr(tag, "instr");
      if (original !== null) {
        const mapped = remapInstruction(original, names);
        if (mapped !== decoded(original)) replacements.push({ start: token.index ?? 0,
          end: (token.index ?? 0) + tag.length,
          text: setAttr(tag, "instr", escapedText(mapped).replaceAll('"', "&quot;").replaceAll("'", "&apos;")) });
      }
    }
  }
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    xml = xml.slice(0, replacement.start) + replacement.text + xml.slice(replacement.end);
  }
  return xml;
}

export function createRepeatContentRewriter(packageXml: readonly string[]): (xml: string, rowIndex: number) => string {
  const usedDrawingIds = new Set<string>();
  const usedBookmarkIds = new Set<string>();
  const usedNames = new Set<string>();
  for (const xml of packageXml) {
    for (const tag of tags(xml)) {
      const name = nameOf(tag);
      if (["docPr", "cNvPr"].includes(name)) {
        const id = attr(tag, "id"); if (id !== null) usedDrawingIds.add(/^\d+$/u.test(id) ? String(Number(id)) : id);
      }
      if (name === "bookmarkStart") {
        const id = attr(tag, "id"); if (id !== null) usedBookmarkIds.add(/^\d+$/u.test(id) ? String(Number(id)) : id);
        const value = attr(tag, "name"); if (value !== null) usedNames.add(value);
      }
    }
  }
  let nextId = 1;
  function allocate(used: Set<string>): string {
    while (used.has(String(nextId))) nextId += 1;
    if (nextId > 0x7fffffff) limitation("Не удалось назначить идентификаторы копиям строки.");
    const value = String(nextId++); used.add(value); return value;
  }
  return (xml, rowIndex) => {
    const bookmarkIds = new Map<string, string>();
    const names = new Map<string, string>();
    for (const tag of tags(xml)) {
      if (tag.startsWith("</") || nameOf(tag) !== "bookmarkStart") continue;
      const id = attr(tag, "id"), name = attr(tag, "name");
      if (id !== null) bookmarkIds.set(id, rowIndex === 0 ? id : allocate(usedBookmarkIds));
      if (name !== null) {
        let candidate = name;
        if (rowIndex > 0) {
          let salt = 0;
          do { candidate = "Doco_" + createHash("sha256").update(`${name}:${rowIndex}:${salt++}`).digest("hex").slice(0, 30); }
          while (usedNames.has(candidate));
          usedNames.add(candidate);
        }
        names.set(name, candidate);
      }
    }
    const rewritten = xml.replace(tagPattern, (tag) => {
      if (tag.startsWith("</") || tag.startsWith("<!") || tag.startsWith("<?")) return tag;
      const name = nameOf(tag);
      if (["docPr", "cNvPr"].includes(name)) return setAttr(tag, "id", allocate(usedDrawingIds));
      if (name === "bookmarkStart" || name === "bookmarkEnd") {
        const id = attr(tag, "id"); if (id !== null) tag = setAttr(tag, "id", bookmarkIds.get(id) ?? id);
      }
      if (name === "bookmarkStart") {
        const original = attr(tag, "name"); if (original !== null) tag = setAttr(tag, "name", names.get(original) ?? original);
      }
      if (name === "hyperlink") {
        const anchor = attr(tag, "anchor"); if (anchor !== null) tag = setAttr(tag, "anchor", names.get(anchor) ?? anchor);
      }
      return tag;
    });
    return rewriteBookmarkReferences(rewritten, names);
  };
}
