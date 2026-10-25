const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65_557;
const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_INFLATED_ENTRY_BYTES = 32 * 1024 * 1024;

function decodeName(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\\/g, "/");
}

function normalizeEntryName(value: string) {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

async function inflateRaw(bytes: Uint8Array) {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot decompress ZIP-based documents.");
  const stream = new Blob([bytes.slice().buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class LibraryZipEntry {
  readonly dir: boolean;

  constructor(
    readonly name: string,
    private readonly archive: Uint8Array,
    private readonly method: number,
    private readonly compressedSize: number,
    private readonly uncompressedSize: number,
    private readonly localOffset: number,
  ) {
    this.dir = name.endsWith("/");
  }

  async bytes(maxBytes = MAX_INFLATED_ENTRY_BYTES) {
    if (this.dir) return new Uint8Array();
    if (this.uncompressedSize > maxBytes) throw new Error(`ZIP entry is too large to preview: ${this.name}`);
    const view = new DataView(this.archive.buffer, this.archive.byteOffset, this.archive.byteLength);
    if (view.getUint32(this.localOffset, true) !== LOCAL_SIGNATURE) throw new Error(`Invalid ZIP entry header: ${this.name}`);
    const nameLength = view.getUint16(this.localOffset + 26, true);
    const extraLength = view.getUint16(this.localOffset + 28, true);
    const start = this.localOffset + 30 + nameLength + extraLength;
    const end = start + this.compressedSize;
    if (start < 0 || end > this.archive.byteLength) throw new Error(`ZIP entry is outside the archive: ${this.name}`);
    const compressed = this.archive.slice(start, end);
    let output: Uint8Array;
    if (this.method === 0) output = compressed;
    else if (this.method === 8) output = await inflateRaw(compressed);
    else throw new Error(`Unsupported ZIP compression method ${this.method} for ${this.name}.`);
    if (output.byteLength > maxBytes) throw new Error(`ZIP entry is too large to preview: ${this.name}`);
    if (this.uncompressedSize && output.byteLength !== this.uncompressedSize) throw new Error(`ZIP entry size mismatch: ${this.name}`);
    return output;
  }

  async text(maxBytes = 16 * 1024 * 1024) {
    return new TextDecoder("utf-8", { fatal: false }).decode(await this.bytes(maxBytes));
  }
}

export class LibraryZipArchive {
  private readonly byName = new Map<string, LibraryZipEntry>();

  private constructor(readonly entries: LibraryZipEntry[]) {
    for (const entry of entries) this.byName.set(normalizeEntryName(entry.name), entry);
  }

  static load(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const searchStart = Math.max(0, bytes.byteLength - MAX_EOCD_SEARCH);
    let eocd = -1;
    for (let offset = bytes.byteLength - 22; offset >= searchStart; offset -= 1) {
      if (view.getUint32(offset, true) === EOCD_SIGNATURE) { eocd = offset; break; }
    }
    if (eocd < 0) throw new Error("This file is not a valid ZIP-based document.");
    const disk = view.getUint16(eocd + 4, true);
    const centralDisk = view.getUint16(eocd + 6, true);
    if (disk !== 0 || centralDisk !== 0) throw new Error("Multi-part ZIP archives are not supported.");
    const entryCount = view.getUint16(eocd + 10, true);
    if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error("This archive contains too many entries to preview safely.");
    const centralSize = view.getUint32(eocd + 12, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    if (centralOffset + centralSize > bytes.byteLength) throw new Error("The ZIP directory is damaged.");
    const entries: LibraryZipEntry[] = [];
    let offset = centralOffset;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) throw new Error("The ZIP directory is invalid.");
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const nameStart = offset + 46;
      const nameEnd = nameStart + nameLength;
      if (nameEnd > bytes.byteLength) throw new Error("The ZIP entry name is invalid.");
      const name = decodeName(bytes.slice(nameStart, nameEnd));
      entries.push(new LibraryZipEntry(name, bytes, method, compressedSize, uncompressedSize, localOffset));
      offset = nameEnd + extraLength + commentLength;
    }
    return new LibraryZipArchive(entries);
  }

  file(name: string) {
    return this.byName.get(normalizeEntryName(name)) ?? null;
  }

  files(pattern?: RegExp) {
    return pattern ? this.entries.filter((entry) => pattern.test(entry.name)) : [...this.entries];
  }
}
