import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";

export interface StoredObject {
  sha256: string;
  sizeBytes: number;
  relativePath: string;
  storagePath: string;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function normalizeSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new TypeError("Object SHA-256 must contain 64 hexadecimal characters");
  }
  return normalized;
}

async function hashFile(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    sizeBytes += buffer.byteLength;
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class ContentAddressedObjectStore {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async putBuffer(content: Uint8Array): Promise<StoredObject> {
    await this.ensureDirectories();
    const buffer = Buffer.from(content);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const temporaryPath = path.join(this.root, ".incoming", randomUUID());
    const handle = await open(temporaryPath, "wx", 0o640);
    try {
      await handle.writeFile(buffer);
      await handle.sync();
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
    }
    return this.commitTemporary(temporaryPath, sha256, buffer.byteLength);
  }

  async putFile(sourcePath: string): Promise<StoredObject> {
    await this.ensureDirectories();
    const source = await stat(sourcePath);
    if (!source.isFile()) {
      throw new TypeError(`Object source is not a regular file: ${sourcePath}`);
    }

    const temporaryPath = path.join(this.root, ".incoming", randomUUID());
    const handle = await open(temporaryPath, "wx", 0o640);
    const hash = createHash("sha256");
    let sizeBytes = 0;
    try {
      for await (const chunk of createReadStream(sourcePath)) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buffer);
        sizeBytes += buffer.byteLength;
        await handle.write(buffer);
      }
      await handle.sync();
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
    }

    return this.commitTemporary(temporaryPath, hash.digest("hex"), sizeBytes);
  }

  async getBuffer(sha256Value: string): Promise<Buffer> {
    const sha256 = normalizeSha256(sha256Value);
    const storagePath = path.join(
      this.root,
      sha256.slice(0, 2),
      sha256.slice(2, 4),
      sha256
    );
    const buffer = await readFile(storagePath);
    const actualSha256 = createHash("sha256").update(buffer).digest("hex");
    if (actualSha256 !== sha256) {
      throw new Error(`Content-addressed object verification failed: ${storagePath}`);
    }
    return buffer;
  }

  private async ensureDirectories(): Promise<void> {
    await mkdir(path.join(this.root, ".incoming"), {
      recursive: true,
      mode: 0o750
    });
  }

  private async commitTemporary(
    temporaryPath: string,
    sha256: string,
    sizeBytes: number
  ): Promise<StoredObject> {
    const first = sha256.slice(0, 2);
    const second = sha256.slice(2, 4);
    const targetDirectory = path.join(this.root, first, second);
    const storagePath = path.join(targetDirectory, sha256);
    const relativePath = `${first}/${second}/${sha256}`;
    await mkdir(targetDirectory, { recursive: true, mode: 0o750 });

    try {
      await link(temporaryPath, storagePath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }
      const existing = await hashFile(storagePath);
      if (existing.sha256 !== sha256 || existing.sizeBytes !== sizeBytes) {
        throw new Error(`Content-addressed object verification failed: ${storagePath}`);
      }
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }

    await syncDirectory(targetDirectory);
    return { sha256, sizeBytes, relativePath, storagePath };
  }
}
