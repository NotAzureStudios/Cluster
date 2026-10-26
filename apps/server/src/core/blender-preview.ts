import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export type BlendPreviewCompanion = {
  sourcePath: string;
  relativeName: string;
};

type AssimpFile = {
  GetPath: () => string;
  GetContent: () => Uint8Array;
  delete?: () => void;
};

type AssimpResult = {
  IsSuccess: () => boolean;
  GetErrorCode: () => number;
  FileCount: () => number;
  GetFile: (index: number) => AssimpFile;
  delete?: () => void;
};

type AssimpFileList = {
  AddFile: (name: string, bytes: Uint8Array) => void;
  delete?: () => void;
};

type AssimpRuntime = {
  FileList: new () => AssimpFileList;
  ConvertFileList: (files: AssimpFileList, format: string) => AssimpResult;
};

const require = createRequire(import.meta.url);
let runtimePromise: Promise<AssimpRuntime> | null = null;
let conversionQueue: Promise<unknown> = Promise.resolve();
let queuedConversions = 0;
const MAX_PENDING_MODEL_CONVERSIONS = 4;
const pendingPreviews = new Map<string, Promise<string>>();
const MAX_MODEL_PREVIEW_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_MODEL_PREVIEW_COMPANION_BYTES = 512 * 1024 * 1024;
const MAX_MODEL_PREVIEW_OUTPUT_BYTES = 512 * 1024 * 1024;

export class ModelPreviewBusyError extends Error {
  constructor() {
    super("Model conversion capacity is currently full.");
    this.name = "ModelPreviewBusyError";
  }
}

function safeRelativePath(value: string, fallback: string) {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:\/?/, "")
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => segment.replace(/[<>:"|?*\u0000-\u001f]/g, "_").slice(0, 120))
    .filter(Boolean)
    .slice(-20)
    .join("/");
  return normalized || fallback;
}

async function loadAssimpRuntime() {
  if (!runtimePromise) {
    runtimePromise = Promise.resolve().then(async () => {
      const factory = require("assimpjs") as (options?: Record<string, unknown>) => Promise<AssimpRuntime> | AssimpRuntime;
      const runtime = await factory();
      if (!runtime?.FileList || typeof runtime.ConvertFileList !== "function") throw new Error("The bundled model conversion runtime did not initialize.");
      return runtime;
    }).catch((error) => {
      runtimePromise = null;
      throw new Error(`The built-in model converter could not start: ${error instanceof Error ? error.message : "runtime unavailable"}`);
    });
  }
  return runtimePromise;
}

/** Read a bounded, regular, singly linked file from the opened descriptor.
 * On systems supporting O_NOFOLLOW, a last-component symlink swap fails closed.
 * Pre/post descriptor observations detect in-place writes during the read.
 * This is not a replacement for storage-provider version fencing.
 */
export async function readModelPreviewInput(filePath: string, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_MODEL_PREVIEW_SOURCE_BYTES) {
    throw new Error("Model input size limit is invalid.");
  }
  const beforePath = await fs.lstat(filePath);
  if (!beforePath.isFile() || beforePath.isSymbolicLink() || beforePath.nlink !== 1) throw new Error("Model input path is unsafe.");
  const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size <= 0 || before.size > maxBytes ||
        before.dev !== beforePath.dev || before.ino !== beforePath.ino) throw new Error("Model input is unsafe or exceeds its conversion limit.");
    // Read exactly the validated snapshot size. FileHandle.readFile() follows
    // concurrent appends and can grow well beyond the pre-read budget.
    const contents = Buffer.allocUnsafe(before.size);
    let read = 0;
    while (read < before.size) {
      const { bytesRead } = await handle.read(contents, read, Math.min(before.size - read, 4 * 1024 * 1024), read);
      if (bytesRead === 0) throw new Error("Model input changed during conversion snapshot.");
      read += bytesRead;
    }
    const extra = Buffer.alloc(1);
    const { bytesRead: extraBytes } = await handle.read(extra, 0, 1, before.size);
    const after = await handle.stat();
    if (extraBytes !== 0 || contents.byteLength !== before.size || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
        after.ino !== before.ino || after.dev !== before.dev || after.nlink !== 1) {
      throw new Error("Model input changed during conversion snapshot.");
    }
    // Buffer already implements Uint8Array; avoid copying up to 512 MiB.
    return contents;
  } finally {
    await handle.close();
  }
}

/** Validate a GLB container header before caching or serving its bytes. */
export function validModelGlbHeader(header: Uint8Array, fullSize: number): boolean {
  if (header.length < 12 || fullSize < 100 || fullSize > MAX_MODEL_PREVIEW_OUTPUT_BYTES) return false;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  return header[0] === 0x67 && header[1] === 0x6c && header[2] === 0x54 && header[3] === 0x46 &&
    view.getUint32(4, true) === 2 && view.getUint32(8, true) === fullSize;
}

async function reusableCachedGlb(outputPath: string): Promise<boolean> {
  const info = await fs.lstat(outputPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return false;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error("Model preview cache path is unsafe.");
  if (info.size < 100 || info.size > MAX_MODEL_PREVIEW_OUTPUT_BYTES) return false;
  const handle = await fs.open(outputPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const bytes = Buffer.alloc(12);
    const { bytesRead } = await handle.read(bytes, 0, 12, 0);
    const current = await handle.stat();
    return bytesRead === 12 && current.isFile() && current.nlink === 1 && current.size === info.size &&
      current.dev === info.dev && current.ino === info.ino && validModelGlbHeader(bytes, info.size);
  } finally {
    await handle.close();
  }
}

async function convertWithAssimp({
  sourcePath, sourceRelativeName, companions, outputPath, maxSourceBytes
}: {
  sourcePath: string;
  sourceRelativeName: string;
  companions: BlendPreviewCompanion[];
  outputPath: string;
  maxSourceBytes: number;
}) {
  const runtime = await loadAssimpRuntime();
  if (!Number.isFinite(maxSourceBytes) || maxSourceBytes < 1) throw new Error("Model input size limit is invalid.");
  const effectiveSourceLimit = Math.floor(Math.min(maxSourceBytes, MAX_MODEL_PREVIEW_SOURCE_BYTES));
  if (companions.length > 128) throw new Error("Model preview has too many dependencies.");
  const files = new runtime.FileList();
  let result: AssimpResult | null = null;
  try {
    const names = new Set<string>();
    const primaryName = safeRelativePath(sourceRelativeName, path.basename(sourcePath));
    names.add(primaryName.toLowerCase());
    files.AddFile(primaryName, await readModelPreviewInput(sourcePath, effectiveSourceLimit));
    let companionBytes = 0;
    const companionLimit = Math.min(effectiveSourceLimit, MAX_MODEL_PREVIEW_COMPANION_BYTES);
    for (const companion of companions) {
      const name = safeRelativePath(companion.relativeName, path.basename(companion.sourcePath));
      // assimp resolves inputs by relative filename, not Library ID.
      if (names.has(name.toLowerCase())) throw new Error("Model preview input filenames collide.");
      names.add(name.toLowerCase());
      const bytes = await readModelPreviewInput(companion.sourcePath, companionLimit - companionBytes);
      companionBytes += bytes.byteLength;
      // Never quietly skip an explicitly linked, permission-checked dependency.
      files.AddFile(name, bytes);
    }

    result = runtime.ConvertFileList(files, "glb2");
    if (!result?.IsSuccess()) {
      const code = result?.GetErrorCode?.() ?? -1;
      throw new Error(`The built-in converter could not read this model (Assimp error ${code}). Re-export it as GLB/FBX from the source DCC application.`);
    }

    let output: Uint8Array | null = null;
    for (let index = 0; index < result.FileCount(); index += 1) {
      const file = result.GetFile(index);
      try {
        const filePath = String(file.GetPath?.() || "").toLowerCase();
        const content = file.GetContent?.();
        if (content?.byteLength && (filePath.endsWith(".glb") || !output)) output = new Uint8Array(content);
        if (filePath.endsWith(".glb")) break;
      } finally {
        file.delete?.();
      }
    }
    if (!output || !validModelGlbHeader(output.subarray(0, 12), output.byteLength)) {
      throw new Error("The built-in converter completed without producing a valid GLB container.");
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, output, { flag: "wx", mode: 0o640 });
      await fs.rename(temporaryPath, outputPath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return outputPath;
  } finally {
    result?.delete?.();
    files.delete?.();
  }
}

export function modelPreviewAdmission() {
  return { queued: queuedConversions, limit: MAX_PENDING_MODEL_CONVERSIONS, coalesced: pendingPreviews.size };
}

export async function createModelGlbDerivative({
  sourcePath, sourceRelativeName, companions = [], outputPath, maxSourceBytes = 512 * 1024 * 1024
}: {
  sourcePath: string;
  sourceRelativeName: string;
  companions?: BlendPreviewCompanion[];
  outputPath: string;
  maxSourceBytes?: number;
}) {
  if (queuedConversions >= MAX_PENDING_MODEL_CONVERSIONS) throw new ModelPreviewBusyError();
  queuedConversions += 1;
  const operation = conversionQueue.then(() => convertWithAssimp({ sourcePath, sourceRelativeName, companions, outputPath, maxSourceBytes }));
  conversionQueue = operation.catch(() => undefined);
  try { return await operation; }
  finally { queuedConversions -= 1; }
}

export async function createBlendPreview({
  sourcePath, sourceRelativeName, companions, cacheRoot, cacheKey, maxSourceBytes = 512 * 1024 * 1024
}: {
  sourcePath: string;
  sourceRelativeName: string;
  companions: BlendPreviewCompanion[];
  cacheRoot: string;
  cacheKey: string;
  maxSourceBytes?: number;
}) {
  if (!/^[0-9a-f]{64}$/.test(cacheKey)) throw new Error("Invalid model preview cache identity.");
  await fs.mkdir(cacheRoot, { recursive: true });
  const root = path.resolve(cacheRoot);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await fs.realpath(root) !== root) {
    throw new Error("Model preview cache directory is unsafe.");
  }
  const outputPath = path.join(root, `${cacheKey}.glb`);
  if (await reusableCachedGlb(outputPath)) return outputPath;
  const pending = pendingPreviews.get(outputPath);
  if (pending) return pending;
  // Registration precedes the first await so identical concurrent requests
  // share one native conversion and one slot in the bounded queue.
  const operation = createModelGlbDerivative({ sourcePath, sourceRelativeName, companions, outputPath, maxSourceBytes });
  pendingPreviews.set(outputPath, operation);
  try { return await operation; }
  finally {
    if (pendingPreviews.get(outputPath) === operation) pendingPreviews.delete(outputPath);
  }
}
