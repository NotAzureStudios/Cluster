import { createHash } from "node:crypto";
import { readPacketVerifiedSourceFile } from "./packet-verified-file.js";

/**
 * Bounded detached copies of uploaded plain-text Library files. No source
 * Library paths, identifiers, links or byte hashes appear in delivery catalogs.
 * Files are read only during an editor-authorized immutable publication.
 * Binary/PDF/media files intentionally require separate trusted adapters.
 */
export async function buildPacketFileTextDerivatives(manifestJson: string, sources: any[], libraryFilesRoot: string,
  prior: { position: number; sizeBytes: number }[] = []) {
  const manifest = JSON.parse(manifestJson);
  if (manifest?.schema !== 1 || !Array.isArray(manifest.sourceItems)) throw new Error("PACKET_RELEASE_INVALID");
  const byId = new Map<string, any>(sources.map(item => [String(item.id), item]));
  let total = prior.reduce((count, item) => count + item.sizeBytes, 0);
  const positions = new Set(prior.map(item => item.position));
  const derivatives: { position: number; content: Buffer; sha256: string; sizeBytes: number; format: "txt" }[] = [];
  for (const [index, entry] of manifest.sourceItems.entries()) {
    const position = index + 1;
    const item = byId.get(String(entry.sourceId));
    if (!item?.fileName || positions.has(position) || item.type === "folder") continue;
    if (!(["public", "internal"].includes(String(item.classification || "internal"))
      && String(item.mimeType || "").toLowerCase() === "text/plain"
      && String(item.extension || "").toLowerCase() === "txt")) continue;
    if (!/^[a-f0-9]{64}$/i.test(String(entry.checksumSha256 || ""))
      || entry.checksumSha256 !== item.checksumSha256 || entry.revision !== item.revision)
      throw new Error("PACKET_FILE_SOURCE_CHANGED");
    if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1 || item.sizeBytes > 65_536)
      continue; // No truncation, and no unbounded reads.
    const bytes = await readPacketVerifiedSourceFile(libraryFilesRoot, entry, item, 65_536);
    let contents: string;
    try { contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("PACKET_FILE_TEXT_INVALID"); }
    if (contents.includes("\u0000")) throw new Error("PACKET_FILE_TEXT_INVALID");
    // A fresh file, never a direct stream of the original Library source.
    const detached = Buffer.from(contents.replace(/\r\n?/g, "\n"), "utf8");
    if (detached.length < 1 || detached.length > 65_536) continue;
    total += detached.length;
    if (total > 1_048_576) throw new Error("PACKET_DERIVATIVES_TOO_LARGE");
    derivatives.push({ position, format: "txt", content: detached,
      sha256: createHash("sha256").update(detached).digest("hex"), sizeBytes: detached.length });
  }
  return derivatives;
}
