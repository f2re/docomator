import { createHash } from "node:crypto";

import yauzl, { type Entry, type ZipFile } from "yauzl";

export type DocumentFormat = "docx" | "xlsx";
export type IntakeDecision = "accepted" | "accepted_with_warnings" | "rejected";
export type IntakeIssueSeverity = "notice" | "warning" | "blocker";

export interface IntakeLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxEntryUncompressedBytes: number;
  maxCompressionRatio: number;
  maxXmlPartBytes: number;
}

export interface IntakeIssue {
  code: string;
  severity: IntakeIssueSeverity;
  title: string;
  message: string;
  partName?: string;
}

export interface IntakePart {
  name: string;
  directory: boolean;
  compressedBytes: number;
  uncompressedBytes: number;
  compression: "stored" | "deflated";
  crc32: number;
}

export interface IntakeSummary {
  entryCount: number;
  fileCount: number;
  directoryCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  relationshipFiles: number;
  externalRelationships: number;
  hasMacros: boolean;
  hasActiveX: boolean;
  hasEmbeddedObjects: boolean;
  hasDigitalSignatures: boolean;
  hasExternalLinks: boolean;
}

export interface DocumentIntakeReport {
  fileName: string;
  format: DocumentFormat;
  mediaType: string;
  sha256: string;
  decision: IntakeDecision;
  summary: IntakeSummary;
  requiredParts: string[];
  parts: IntakePart[];
  issues: IntakeIssue[];
}

export interface InspectOoxmlInput {
  buffer: Buffer;
  fileName: string;
  mediaType?: string;
  limits?: Partial<IntakeLimits>;
}

export const DEFAULT_INTAKE_LIMITS: Readonly<IntakeLimits> = Object.freeze({
  maxArchiveBytes: 32 * 1024 * 1024,
  maxEntries: 2_048,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
  maxEntryUncompressedBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxXmlPartBytes: 4 * 1024 * 1024
});

const MIME_TYPES: Readonly<Record<DocumentFormat, string>> = Object.freeze({
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
});

const MAIN_PARTS: Readonly<Record<DocumentFormat, string>> = Object.freeze({
  docx: "word/document.xml",
  xlsx: "xl/workbook.xml"
});

const SEVERITY_ORDER: Readonly<Record<IntakeIssueSeverity, number>> = Object.freeze({
  blocker: 0,
  warning: 1,
  notice: 2
});

export class DocumentIntakeError extends Error {
  override readonly name = "DocumentIntakeError";

  constructor(
    readonly code: string,
    readonly statusCode: number,
    readonly userMessage: string
  ) {
    super(userMessage);
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} должно быть положительным целым числом`);
  }
  return value;
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} должно быть положительным числом`);
  }
  return value;
}

function mergeLimits(overrides: Partial<IntakeLimits> | undefined): IntakeLimits {
  const merged = { ...DEFAULT_INTAKE_LIMITS, ...overrides };
  return {
    maxArchiveBytes: positiveInteger(merged.maxArchiveBytes, "maxArchiveBytes"),
    maxEntries: positiveInteger(merged.maxEntries, "maxEntries"),
    maxTotalUncompressedBytes: positiveInteger(
      merged.maxTotalUncompressedBytes,
      "maxTotalUncompressedBytes"
    ),
    maxEntryUncompressedBytes: positiveInteger(
      merged.maxEntryUncompressedBytes,
      "maxEntryUncompressedBytes"
    ),
    maxCompressionRatio: positiveNumber(
      merged.maxCompressionRatio,
      "maxCompressionRatio"
    ),
    maxXmlPartBytes: positiveInteger(merged.maxXmlPartBytes, "maxXmlPartBytes")
  };
}

function normalizeFileName(value: string): { fileName: string; format: DocumentFormat } {
  if (typeof value !== "string") {
    throw new DocumentIntakeError(
      "file_name_required",
      400,
      "Не указано имя загружаемого файла."
    );
  }
  const fileName = value.trim();
  if (
    fileName.length === 0 ||
    fileName.length > 255 ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(fileName)
  ) {
    throw new DocumentIntakeError(
      "invalid_file_name",
      400,
      "Имя файла недопустимо. Используйте обычное имя без пути и управляющих символов."
    );
  }
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension !== "docx" && extension !== "xlsx") {
    throw new DocumentIntakeError(
      "unsupported_document_format",
      415,
      "Поддерживаются только файлы DOCX и XLSX."
    );
  }
  return { fileName, format: extension };
}

function assertZipSignature(buffer: Buffer): void {
  if (
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  ) {
    throw new DocumentIntakeError(
      "invalid_zip_signature",
      422,
      "Файл не является корректным пакетом DOCX/XLSX: не найдена сигнатура ZIP."
    );
  }
}

function assertSafeEntryName(name: string): void {
  if (
    name.length === 0 ||
    name.length > 1_024 ||
    name.startsWith("/") ||
    /^[a-zA-Z]:\//u.test(name) ||
    name.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    throw new DocumentIntakeError(
      "unsafe_package_path",
      422,
      "Внутри документа найдено небезопасное имя части. Файл отклонён."
    );
  }
  const segments = name.split("/");
  const contentSegments = name.endsWith("/") ? segments.slice(0, -1) : segments;
  if (
    contentSegments.length === 0 ||
    contentSegments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new DocumentIntakeError(
      "unsafe_package_path",
      422,
      "Внутри документа найден путь с выходом за пределы пакета. Файл отклонён."
    );
  }
}

function isSymbolicLink(entry: Entry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

function compressionName(method: number): "stored" | "deflated" {
  if (method === 0) {
    return "stored";
  }
  if (method === 8) {
    return "deflated";
  }
  throw new DocumentIntakeError(
    "unsupported_compression",
    422,
    `Внутри документа используется неподдерживаемый способ сжатия ZIP: ${method}.`
  );
}

function addSafely(left: number, right: number, code: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new DocumentIntakeError(
      code,
      413,
      "Размер содержимого документа превышает допустимые пределы."
    );
  }
  return total;
}

async function readSmallXml(
  zipFile: ZipFile,
  entry: Entry,
  limit: number
): Promise<string> {
  if (entry.uncompressedSize > limit) {
    throw new DocumentIntakeError(
      "xml_part_too_large",
      413,
      `Служебная XML-часть «${entry.fileName}» превышает допустимый размер.`
    );
  }
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk as Uint8Array);
    total = addSafely(total, chunk.length, "xml_part_too_large");
    if (total > limit) {
      stream.destroy();
      throw new DocumentIntakeError(
        "xml_part_too_large",
        413,
        `Служебная XML-часть «${entry.fileName}» превышает допустимый размер.`
      );
    }
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks);
  if (content.length >= 2 && content[0] === 0xff && content[1] === 0xfe) {
    return content.subarray(2).toString("utf16le");
  }
  if (content.length >= 2 && content[0] === 0xfe && content[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(content.length - 2);
    for (let index = 2; index + 1 < content.length; index += 2) {
      swapped[index - 2] = content[index + 1] ?? 0;
      swapped[index - 1] = content[index] ?? 0;
    }
    return swapped.toString("utf16le");
  }
  return content.toString("utf8");
}

function countExternalRelationships(xml: string): number {
  return [...xml.matchAll(/TargetMode\s*=\s*["']External["']/giu)].length;
}

function issueKey(issue: IntakeIssue): string {
  return `${issue.code}\u0000${issue.partName ?? ""}\u0000${issue.message}`;
}

function sortedIssues(issues: IntakeIssue[]): IntakeIssue[] {
  return [...issues].sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      left.code.localeCompare(right.code) ||
      (left.partName ?? "").localeCompare(right.partName ?? "")
  );
}

function packageFeatureIssues(partNames: ReadonlySet<string>): IntakeIssue[] {
  const issues: IntakeIssue[] = [];
  const names = [...partNames];
  const first = (pattern: RegExp): string | undefined => names.find((name) => pattern.test(name));

  const macro = first(/(^|\/)(vbaProject\.bin|vbaData\.xml)$/iu);
  if (macro !== undefined) {
    issues.push({
      code: "macro_content",
      severity: "blocker",
      title: "Обнаружены макросы",
      message: "Документы с макросами не принимаются в первой версии системы.",
      partName: macro
    });
  }

  const activeX = first(/(^|\/)activeX\//iu);
  if (activeX !== undefined) {
    issues.push({
      code: "activex_content",
      severity: "blocker",
      title: "Обнаружен ActiveX",
      message: "Элементы ActiveX не поддерживаются и могут выполнять опасные действия.",
      partName: activeX
    });
  }

  const embedded = first(/(^|\/)embeddings\//iu);
  if (embedded !== undefined) {
    issues.push({
      code: "embedded_object",
      severity: "warning",
      title: "Есть встроенный объект",
      message: "Встроенный объект будет сохранён без изменения, но его содержимое не анализируется.",
      partName: embedded
    });
  }

  const signature = first(/(^|\/)(_xmlsignatures|signatures)\//iu);
  if (signature !== undefined) {
    issues.push({
      code: "digital_signature",
      severity: "warning",
      title: "Есть цифровая подпись",
      message: "Изменение документа, вероятно, сделает существующую подпись недействительной.",
      partName: signature
    });
  }

  const externalLink = first(/(^|\/)externalLinks\//iu);
  if (externalLink !== undefined) {
    issues.push({
      code: "external_link_part",
      severity: "warning",
      title: "Есть внешняя связь книги",
      message: "Связь с внешним файлом не будет загружаться автоматически.",
      partName: externalLink
    });
  }

  const diagram = first(/(^|\/)diagrams\//iu);
  if (diagram !== undefined) {
    issues.push({
      code: "diagram_content",
      severity: "notice",
      title: "Есть сложная схема",
      message: "Схема будет сохранена как неподдерживаемая часть и потребует проверки результата.",
      partName: diagram
    });
  }

  const customXml = first(/^customXml\//iu);
  if (customXml !== undefined) {
    issues.push({
      code: "custom_xml",
      severity: "notice",
      title: "Есть пользовательские XML-данные",
      message: "Пользовательские XML-данные будут сохранены, но не используются как инструкции системе.",
      partName: customXml
    });
  }

  return issues;
}

function mediaTypeIssue(format: DocumentFormat, mediaType: string | undefined): IntakeIssue | null {
  if (mediaType === undefined || mediaType === "" || mediaType === "application/octet-stream") {
    return null;
  }
  if (mediaType.toLowerCase().split(";", 1)[0]?.trim() === MIME_TYPES[format]) {
    return null;
  }
  return {
    code: "media_type_mismatch",
    severity: "warning",
    title: "Тип файла указан неточно",
    message: "Расширение и внутреннее содержимое будут считаться основным источником формата."
  };
}

export async function inspectOoxmlBuffer(
  input: InspectOoxmlInput
): Promise<DocumentIntakeReport> {
  if (!Buffer.isBuffer(input.buffer)) {
    throw new DocumentIntakeError(
      "binary_body_required",
      400,
      "Сервер ожидал двоичное содержимое файла DOCX или XLSX."
    );
  }
  const limits = mergeLimits(input.limits);
  const { fileName, format } = normalizeFileName(input.fileName);
  if (input.buffer.length === 0) {
    throw new DocumentIntakeError("empty_file", 400, "Загружен пустой файл.");
  }
  if (input.buffer.length > limits.maxArchiveBytes) {
    throw new DocumentIntakeError(
      "archive_too_large",
      413,
      `Размер файла превышает ограничение ${Math.floor(limits.maxArchiveBytes / 1024 / 1024)} МБ.`
    );
  }
  assertZipSignature(input.buffer);

  let zipFile: ZipFile;
  try {
    zipFile = await yauzl.fromBufferPromise(input.buffer, {
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true
    });
  } catch {
    throw new DocumentIntakeError(
      "invalid_zip_package",
      422,
      "Не удалось прочитать архивную структуру DOCX/XLSX. Файл повреждён или имеет неподдерживаемый формат."
    );
  }

  const parts: IntakePart[] = [];
  const names = new Set<string>();
  const namesCaseInsensitive = new Set<string>();
  const issueMap = new Map<string, IntakeIssue>();
  let entryCount = 0;
  let fileCount = 0;
  let directoryCount = 0;
  let compressedBytes = 0;
  let uncompressedBytes = 0;
  let relationshipFiles = 0;
  let externalRelationships = 0;
  let contentTypes = "";

  const addIssue = (issue: IntakeIssue): void => {
    issueMap.set(issueKey(issue), issue);
  };

  try {
    for await (const entry of zipFile.eachEntry()) {
      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        throw new DocumentIntakeError(
          "too_many_package_parts",
          413,
          `В документе слишком много частей: допускается не более ${limits.maxEntries}.`
        );
      }
      assertSafeEntryName(entry.fileName);
      if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
        throw new DocumentIntakeError(
          "encrypted_package_part",
          422,
          "Внутри документа найдена зашифрованная часть. Такие документы не поддерживаются."
        );
      }
      if (isSymbolicLink(entry)) {
        throw new DocumentIntakeError(
          "symbolic_link_in_package",
          422,
          "Внутри документа найдена символическая ссылка. Файл отклонён."
        );
      }
      if (!Number.isSafeInteger(entry.compressedSize) || !Number.isSafeInteger(entry.uncompressedSize)) {
        throw new DocumentIntakeError(
          "invalid_package_size",
          422,
          "Архив содержит недопустимые значения размера."
        );
      }
      if (entry.uncompressedSize > limits.maxEntryUncompressedBytes) {
        throw new DocumentIntakeError(
          "package_part_too_large",
          413,
          `Часть «${entry.fileName}» превышает допустимый распакованный размер.`
        );
      }
      if (
        entry.uncompressedSize > 0 &&
        (entry.compressedSize === 0 ||
          entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio)
      ) {
        throw new DocumentIntakeError(
          "suspicious_compression_ratio",
          413,
          `Часть «${entry.fileName}» имеет подозрительно высокую степень сжатия.`
        );
      }
      if (names.has(entry.fileName)) {
        throw new DocumentIntakeError(
          "duplicate_package_part",
          422,
          `В пакете повторяется часть «${entry.fileName}».`
        );
      }
      const foldedName = entry.fileName.toLocaleLowerCase("en-US");
      if (namesCaseInsensitive.has(foldedName)) {
        throw new DocumentIntakeError(
          "ambiguous_package_part",
          422,
          `В пакете есть части, различающиеся только регистром: «${entry.fileName}».`
        );
      }
      names.add(entry.fileName);
      namesCaseInsensitive.add(foldedName);
      compressedBytes = addSafely(
        compressedBytes,
        entry.compressedSize,
        "archive_too_large"
      );
      uncompressedBytes = addSafely(
        uncompressedBytes,
        entry.uncompressedSize,
        "expanded_archive_too_large"
      );
      if (uncompressedBytes > limits.maxTotalUncompressedBytes) {
        throw new DocumentIntakeError(
          "expanded_archive_too_large",
          413,
          "Суммарный распакованный размер документа превышает допустимый предел."
        );
      }

      const directory = entry.fileName.endsWith("/");
      if (directory) {
        directoryCount += 1;
      } else {
        fileCount += 1;
      }
      const compression = compressionName(entry.compressionMethod);
      parts.push({
        name: entry.fileName,
        directory,
        compressedBytes: entry.compressedSize,
        uncompressedBytes: entry.uncompressedSize,
        compression,
        crc32: entry.crc32 >>> 0
      });

      if (!directory && entry.fileName === "[Content_Types].xml") {
        contentTypes = await readSmallXml(zipFile, entry, limits.maxXmlPartBytes);
      }
      if (!directory && entry.fileName.toLowerCase().endsWith(".rels")) {
        relationshipFiles += 1;
        const relationships = await readSmallXml(
          zipFile,
          entry,
          limits.maxXmlPartBytes
        );
        const count = countExternalRelationships(relationships);
        externalRelationships += count;
        if (count > 0) {
          addIssue({
            code: "external_relationship",
            severity: "warning",
            title: "Есть внешняя ссылка",
            message: `Найдено внешних связей: ${count}. Система не будет обращаться к ним автоматически.`,
            partName: entry.fileName
          });
        }
      }
    }
  } catch (error) {
    if (error instanceof DocumentIntakeError) {
      throw error;
    }
    throw new DocumentIntakeError(
      "invalid_zip_package",
      422,
      "Архивная структура документа повреждена или содержит небезопасное имя части."
    );
  } finally {
    zipFile.close();
  }

  const requiredParts = ["[Content_Types].xml", "_rels/.rels", MAIN_PARTS[format]];
  for (const requiredPart of requiredParts) {
    if (!names.has(requiredPart)) {
      addIssue({
        code: "required_part_missing",
        severity: "blocker",
        title: "Не хватает обязательной части",
        message: "Файл не соответствует ожидаемой структуре DOCX/XLSX.",
        partName: requiredPart
      });
    }
  }

  if (contentTypes.length === 0) {
    addIssue({
      code: "content_types_unreadable",
      severity: "blocker",
      title: "Не удалось прочитать описание содержимого",
      message: "Служебная часть [Content_Types].xml отсутствует или пуста.",
      partName: "[Content_Types].xml"
    });
  } else if (/macroEnabled|vbaProject/iu.test(contentTypes)) {
    addIssue({
      code: "macro_content_type",
      severity: "blocker",
      title: "Файл объявлен как документ с макросами",
      message: "Документы с макросами не принимаются в первой версии системы.",
      partName: "[Content_Types].xml"
    });
  }

  for (const issue of packageFeatureIssues(names)) {
    addIssue(issue);
  }
  const typeIssue = mediaTypeIssue(format, input.mediaType);
  if (typeIssue !== null) {
    addIssue(typeIssue);
  }

  const issues = sortedIssues([...issueMap.values()]);
  const hasBlocker = issues.some((issue) => issue.severity === "blocker");
  const hasWarning = issues.some((issue) => issue.severity === "warning");
  const decision: IntakeDecision = hasBlocker
    ? "rejected"
    : hasWarning
      ? "accepted_with_warnings"
      : "accepted";
  const lowerNames = [...names].map((name) => name.toLowerCase());

  return {
    fileName,
    format,
    mediaType: MIME_TYPES[format],
    sha256: createHash("sha256").update(input.buffer).digest("hex"),
    decision,
    summary: {
      entryCount,
      fileCount,
      directoryCount,
      compressedBytes,
      uncompressedBytes,
      relationshipFiles,
      externalRelationships,
      hasMacros: issues.some((issue) =>
        issue.code === "macro_content" || issue.code === "macro_content_type"
      ),
      hasActiveX: issues.some((issue) => issue.code === "activex_content"),
      hasEmbeddedObjects: issues.some((issue) => issue.code === "embedded_object"),
      hasDigitalSignatures: issues.some((issue) => issue.code === "digital_signature"),
      hasExternalLinks:
        externalRelationships > 0 ||
        lowerNames.some((name) => name.includes("/externallinks/"))
    },
    requiredParts,
    parts: parts.sort((left, right) => left.name.localeCompare(right.name)),
    issues
  };
}
