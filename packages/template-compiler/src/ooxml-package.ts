import { deflateRawSync } from "node:zlib";

import yauzl, { type Entry, type ZipFile } from "yauzl";

export interface OoxmlPackageLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_OOXML_PACKAGE_LIMITS: Readonly<OoxmlPackageLimits> =
  Object.freeze({
    maxEntries: 2_048,
    maxEntryBytes: 32 * 1024 * 1024,
    maxTotalBytes: 256 * 1024 * 1024
  });

export interface OoxmlPackageEntry {
  name: string;
  content: Buffer;
  isDirectory: boolean;
}

export class OoxmlPackageError extends Error {
  override readonly name = "OoxmlPackageError";

  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value =
        (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = (CRC_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function validateEntryName(name: string): void {
  if (
    name.length === 0 ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    name.includes("\\") ||
    name.split("/").some((segment) => segment === "..") ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    throw new OoxmlPackageError(
      "unsafe_entry_name",
      `В пакете обнаружено небезопасное имя части: ${name}`
    );
  }
}

function validateLimits(limits: OoxmlPackageLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
}

async function readEntryContent(
  zipFile: ZipFile,
  entry: Entry,
  limits: OoxmlPackageLimits
): Promise<Buffer> {
  if (entry.uncompressedSize > limits.maxEntryBytes) {
    throw new OoxmlPackageError(
      "entry_too_large",
      `Часть «${entry.fileName}» превышает допустимый размер.`
    );
  }
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk as Uint8Array);
    size += chunk.length;
    if (!Number.isSafeInteger(size) || size > limits.maxEntryBytes) {
      stream.destroy();
      throw new OoxmlPackageError(
        "entry_too_large",
        `Фактический размер части «${entry.fileName}» превышает допустимый предел.`
      );
    }
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks);
  if (content.length !== entry.uncompressedSize) {
    throw new OoxmlPackageError(
      "entry_size_mismatch",
      `Фактический размер части «${entry.fileName}» не совпадает с описанием ZIP.`
    );
  }
  if (crc32(content) !== (entry.crc32 >>> 0)) {
    throw new OoxmlPackageError(
      "entry_crc_mismatch",
      `Контрольная сумма части «${entry.fileName}» не совпадает с описанием ZIP.`
    );
  }
  return content;
}

export async function readOoxmlPackage(
  bufferValue: Uint8Array,
  limits: OoxmlPackageLimits = DEFAULT_OOXML_PACKAGE_LIMITS
): Promise<OoxmlPackageEntry[]> {
  validateLimits(limits);
  const buffer = Buffer.from(bufferValue);
  let zipFile: ZipFile;
  try {
    zipFile = await yauzl.fromBufferPromise(buffer, {
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true
    });
  } catch {
    throw new OoxmlPackageError(
      "invalid_zip",
      "Не удалось открыть пакет DOCX/XLSX для компиляции."
    );
  }

  const entries: OoxmlPackageEntry[] = [];
  const names = new Set<string>();
  let total = 0;
  try {
    for await (const entry of zipFile.eachEntry()) {
      if (entries.length >= limits.maxEntries) {
        throw new OoxmlPackageError(
          "too_many_entries",
          "Число частей пакета превышает допустимый предел."
        );
      }
      validateEntryName(entry.fileName);
      if (names.has(entry.fileName)) {
        throw new OoxmlPackageError(
          "duplicate_entry",
          `В пакете повторяется часть «${entry.fileName}».`
        );
      }
      names.add(entry.fileName);
      if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
        throw new OoxmlPackageError(
          "encrypted_entry",
          `Зашифрованная часть «${entry.fileName}» не поддерживается.`
        );
      }
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
        throw new OoxmlPackageError(
          "unsupported_compression",
          `Для части «${entry.fileName}» используется неподдерживаемое сжатие.`
        );
      }
      const isDirectory = entry.fileName.endsWith("/");
      const content = isDirectory
        ? Buffer.alloc(0)
        : await readEntryContent(zipFile, entry, limits);
      total += content.length;
      if (!Number.isSafeInteger(total) || total > limits.maxTotalBytes) {
        throw new OoxmlPackageError(
          "package_too_large",
          "Фактический распакованный объём пакета превышает допустимый предел."
        );
      }
      entries.push({ name: entry.fileName, content, isDirectory });
    }
  } catch (error) {
    if (error instanceof OoxmlPackageError) throw error;
    throw new OoxmlPackageError(
      "package_read_failed",
      "Не удалось полностью прочитать пакет DOCX/XLSX."
    );
  } finally {
    zipFile.close();
  }
  return entries;
}

function localHeader(
  name: Buffer,
  content: Buffer,
  compressed: Buffer,
  method: number,
  checksum: number
): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name, compressed]);
}

function centralHeader(
  name: Buffer,
  content: Buffer,
  compressed: Buffer,
  method: number,
  checksum: number,
  offset: number,
  isDirectory: boolean
): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | 20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(compressed.length, 20);
  header.writeUInt32LE(content.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(
    isDirectory ? ((0o40755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0,
    38
  );
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

export function writeOoxmlPackage(
  entries: readonly OoxmlPackageEntry[]
): Buffer {
  if (entries.length > 0xffff) {
    throw new OoxmlPackageError(
      "zip64_required",
      "Пакет содержит слишком много частей для поддерживаемого формата ZIP."
    );
  }
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const names = new Set<string>();
  let offset = 0;

  for (const entry of entries) {
    validateEntryName(entry.name);
    if (names.has(entry.name)) {
      throw new OoxmlPackageError(
        "duplicate_entry",
        `В пакете повторяется часть «${entry.name}».`
      );
    }
    names.add(entry.name);
    const name = Buffer.from(entry.name, "utf8");
    const content = entry.isDirectory ? Buffer.alloc(0) : Buffer.from(entry.content);
    const method = entry.isDirectory || content.length === 0 ? 0 : 8;
    const compressed = method === 8 ? deflateRawSync(content, { level: 9 }) : content;
    const checksum = crc32(content);
    const local = localHeader(name, content, compressed, method, checksum);
    const central = centralHeader(
      name,
      content,
      compressed,
      method,
      checksum,
      offset,
      entry.isDirectory
    );
    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function packageEntry(
  entries: readonly OoxmlPackageEntry[],
  name: string
): OoxmlPackageEntry {
  const entry = entries.find((candidate) => candidate.name === name);
  if (entry === undefined || entry.isDirectory) {
    throw new OoxmlPackageError(
      "entry_not_found",
      `В пакете не найдена часть «${name}».`
    );
  }
  return entry;
}
