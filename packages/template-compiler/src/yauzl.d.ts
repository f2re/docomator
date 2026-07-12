declare module "yauzl" {
  import type { Readable } from "node:stream";

  export interface Entry {
    fileName: string;
    compressedSize: number;
    uncompressedSize: number;
    compressionMethod: number;
    generalPurposeBitFlag: number;
    externalFileAttributes: number;
    crc32: number;
  }

  export interface ZipFile {
    eachEntry(): AsyncIterable<Entry>;
    openReadStreamPromise(entry: Entry): Promise<Readable>;
    close(): void;
  }

  export interface OpenOptions {
    decodeStrings?: boolean;
    validateEntrySizes?: boolean;
    strictFileNames?: boolean;
  }

  export function fromBufferPromise(
    buffer: Buffer,
    options?: OpenOptions
  ): Promise<ZipFile>;

  const yauzl: {
    fromBufferPromise: typeof fromBufferPromise;
  };

  export default yauzl;
}
