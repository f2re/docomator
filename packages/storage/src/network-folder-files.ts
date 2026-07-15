import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

export interface WriteNetworkFolderFileInput {
  root: string;
  destinationRelative: string;
  fileName: string;
  content: Uint8Array;
  uniquePrefix?: string;
}

export interface WriteNetworkFolderFileResult {
  destinationRelative: string;
  deliveredName: string;
  deliveredBytes: number;
}

export class NetworkFolderValidationError extends Error {
  override readonly name = "NetworkFolderValidationError";
}

export function safeNetworkFileName(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/gu, "")
    .slice(0, 160);
  return normalized.length === 0 ? fallback : normalized;
}

export function normalizeNetworkSubdirectory(value: string): {
  relative: string;
  segments: string[];
} {
  const raw = String(value).normalize("NFKC").trim().replace(/\\/gu, "/");
  if (
    raw.length === 0 ||
    raw.length > 500 ||
    raw.startsWith("/") ||
    /^[A-Za-z]:/u.test(raw) ||
    raw.includes("\u0000")
  ) {
    throw new NetworkFolderValidationError(
      "Укажите только вложенный каталог внутри разрешённой сетевой папки."
    );
  }
  const segments = raw
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.length > 12 ||
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.length > 120 ||
        /[\u0000-\u001f\u007f:*?"<>|]/u.test(segment)
    )
  ) {
    throw new NetworkFolderValidationError(
      "Каталог сетевой доставки содержит недопустимые элементы."
    );
  }
  return { relative: segments.join("/"), segments };
}

async function requireDirectoryWithoutSymlinks(
  rootValue: string,
  segments: readonly string[]
): Promise<string> {
  const root = path.resolve(rootValue);
  let current = root;
  let rootStat;
  try {
    rootStat = await fs.lstat(root);
  } catch {
    throw new NetworkFolderValidationError(
      "Разрешённая сетевая папка недоступна."
    );
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new NetworkFolderValidationError(
      "Корень сетевой доставки должен быть обычным каталогом."
    );
  }
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new NetworkFolderValidationError(
          "Путь сетевой доставки содержит ссылку или не является каталогом."
        );
      }
    } catch (error) {
      if (
        error instanceof NetworkFolderValidationError ||
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
      await fs.mkdir(current, { mode: 0o750 });
      const created = await fs.lstat(current);
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw new NetworkFolderValidationError(
          "Созданный путь сетевой доставки недопустим."
        );
      }
    }
  }
  const resolved = path.resolve(current);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new NetworkFolderValidationError(
      "Путь сетевой доставки выходит за разрешённый корень."
    );
  }
  return resolved;
}

export async function writeNetworkFolderFile(
  input: WriteNetworkFolderFileInput
): Promise<WriteNetworkFolderFileResult> {
  const destination = normalizeNetworkSubdirectory(input.destinationRelative);
  const directory = await requireDirectoryWithoutSymlinks(
    input.root,
    destination.segments
  );
  const baseName = safeNetworkFileName(input.fileName, "документ");
  const prefix = input.uniquePrefix
    ? `${safeNetworkFileName(input.uniquePrefix, "result")}-`
    : "";
  const deliveredName = `${prefix}${baseName}`;
  const finalPath = path.join(directory, deliveredName);
  const temporaryPath = path.join(
    directory,
    `.${deliveredName}.tmp-${randomUUID()}`
  );
  const content = Buffer.from(input.content);
  const handle = await fs.open(
    temporaryPath,
    fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_NOFOLLOW,
    0o640
  );
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporaryPath, finalPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
  return {
    destinationRelative: destination.relative,
    deliveredName,
    deliveredBytes: content.byteLength
  };
}
