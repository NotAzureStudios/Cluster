import { createHash } from "node:crypto";

/**
 * Recipient-facing projections must never contain source Library identities,
 * original checksums, storage paths, or source download links. Publishing is
 * not a grant to the underlying Library. The catalogue is metadata-only until
 * a delivery adapter produces a separately authorized derivative artifact.
 */
export function packetRecipientCatalog(release: {
  id: string; versionLabel: string; manifestJson: string; manifestSha256: string;
  publishedAt: Date | string; revokedAt?: Date | string | null;
}, derivativePositions: ReadonlySet<number> | ReadonlyMap<number, string> = new Set<number>()) {
  if (release.revokedAt) throw new Error("PACKET_RELEASE_REVOKED");
  const digest = createHash("sha256").update(release.manifestJson).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(release.manifestSha256) || digest !== release.manifestSha256.toLowerCase())
    throw new Error("PACKET_RELEASE_INTEGRITY_FAILED");
  let manifest: any;
  try { manifest = JSON.parse(release.manifestJson); } catch { throw new Error("PACKET_RELEASE_INVALID"); }
  if (manifest?.schema !== 1 || manifest?.distributionPolicy !== "derived_only"
    || String(manifest?.versionLabel) !== String(release.versionLabel)
    || !Array.isArray(manifest?.sourceItems) || manifest.sourceItems.length > 2000
    || manifest.sourceItems.some((entry: any) => !entry || typeof entry.title !== "string" || typeof entry.kind !== "string"))
    throw new Error("PACKET_RELEASE_INVALID");
  return {
    releaseId: release.id,
    versionLabel: release.versionLabel,
    publishedAt: release.publishedAt,
    manifestSha256: digest,
    distributionPolicy: "derived_only" as const,
    // A publication mark is embedded only in detached PDF/image bytes, never
    // the original Library object. The label is safe recipient-visible policy.
    publicationWatermarkLabel: typeof manifest.publicationWatermarkLabel === "string" &&
      /^[\x20-\x7e]{0,60}$/.test(manifest.publicationWatermarkLabel) ? manifest.publicationWatermarkLabel : "",
    // These entries describe published contents; they are not file grants.
    contents: manifest.sourceItems.map((entry: any, index: number) => ({
      position: index + 1,
      title: entry.title.slice(0, 250),
      kind: entry.kind.slice(0, 60),
      sizeBytes: Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes >= 0 ? entry.sizeBytes : null,
      downloadable: derivativePositions.has(index + 1),
      previewOnly: typeof (derivativePositions as ReadonlyMap<number, string>).get === "function" && (derivativePositions as ReadonlyMap<number, string>).get(index + 1) === "wav",
      format: typeof (derivativePositions as ReadonlyMap<number, string>).get === "function" ? (derivativePositions as ReadonlyMap<number, string>).get(index + 1) || null : derivativePositions.has(index + 1) ? "txt" : null,
    })),
    deliveryStatus: derivativePositions.size ? "partially_available" as const : "derivative_required" as const,
  };
}

export function publishedPacketAudience(release: { manifestJson: string; revokedAt?: Date | string | null }) {
  if (release.revokedAt) return null;
  try {
    const manifest = JSON.parse(release.manifestJson);
    return typeof manifest.audienceJson === "string" ? manifest.audienceJson : null;
  } catch { return null; }
}

/** Immutable author-only snapshot. This does not issue delivery entitlements or download URLs. */
export function buildPacketReleaseManifest(packet: any, definition: any, sourceItems: any[], watermarkLabel = "") {
  if (typeof watermarkLabel !== "string" || /[^\x20-\x7e]/.test(watermarkLabel) || watermarkLabel.trim().length > 60)
    throw new Error("PACKET_PDF_WATERMARK_INVALID");
  const publicationWatermarkLabel = watermarkLabel.trim();
  const entries = sourceItems.map((item) => {
    if (item.status === "archived" || item.status === "trashed" || item.deletedAt) throw new Error("PACKET_SOURCE_INACTIVE");
    if (item.fileName && !/^[a-fA-F0-9]{64}$/.test(String(item.checksumSha256 || ""))) throw new Error("PACKET_SOURCE_UNVERIFIED");
    return {
      sourceId: String(item.id), parentId: String(item.parentId), revision: Number(item.revision),
      title: String(item.title), kind: String(item.type),
      checksumSha256: item.checksumSha256 || null, sizeBytes: item.sizeBytes ?? null,
    };
  }).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const manifestJson = JSON.stringify({
    schema: 1, packetId: String(packet.id), definitionId: String(definition.id), versionLabel: String(definition.versionLabel),
    kind: String(definition.kind), audienceJson: String(definition.audienceJson),
    completionMode: String(definition.completionMode), completionFormId: definition.completionFormId || null,
    required: Boolean(definition.required), sourceItems: entries,
    distributionPolicy: "derived_only", publicationWatermarkLabel,
  });
  return { manifestJson, manifestSha256: createHash("sha256").update(manifestJson).digest("hex"), sourceCount: entries.length };
}

/** Explicit opt-in at publication. Only bounded, non-file, non-sensitive notes
 * are detached as UTF-8 text; PDF/video/binary derivatives need a real adapter.
 * Positions correspond to the sorted immutable source snapshot, not Library IDs.
 */
export function buildPacketTextDerivatives(manifestJson: string, sources: any[]) {
  const manifest = JSON.parse(manifestJson);
  if (manifest?.schema !== 1 || !Array.isArray(manifest.sourceItems)) throw new Error("PACKET_RELEASE_INVALID");
  const sourceMap = new Map<string, any>(sources.map((item: any) => [String(item.id), item]));
  const derivatives: { position: number; content: Buffer; sha256: string; sizeBytes: number }[] = [];
  let total = 0;
  for (let index = 0; index < manifest.sourceItems.length; index++) {
    const entry = manifest.sourceItems[index];
    const item = sourceMap.get(String(entry.sourceId));
    if (!item || item.type !== "note" || item.fileName || !["public", "internal"].includes(String(item.classification || "internal"))) continue;
    if (typeof item.body !== "string" || !item.body.trim()) continue;
    const content = Buffer.from(`${String(item.title || "Untitled").replace(/[\u0000-\u001f]/g, " ")}\n\n${item.body.replace(/\u0000/g, "")}\n`, "utf8");
    if (content.byteLength > 65_536) continue; // Never truncate release content silently.
    if (total + content.byteLength > 1_048_576) throw new Error("PACKET_DERIVATIVES_TOO_LARGE");
    total += content.byteLength;
    derivatives.push({ position: index + 1, content, sha256: createHash("sha256").update(content).digest("hex"), sizeBytes: content.byteLength });
  }
  return derivatives;
}

export function verifyPacketDerivative(artifact: { content: Uint8Array; sha256: string; sizeBytes: number; format?: string }) {
  const data = Buffer.from(artifact.content);
  if (data.length < 1 || data.length > (artifact.format === "pdf" ? 400_000 : artifact.format === "wav" ? 128_000 : 65_536) || data.length !== artifact.sizeBytes
    || !/^[a-f0-9]{64}$/i.test(artifact.sha256)
    || createHash("sha256").update(data).digest("hex") !== artifact.sha256.toLowerCase())
    throw new Error("PACKET_DERIVATIVE_INTEGRITY_FAILED");
  if (artifact.format && !["txt", "pdf", "webp", "wav"].includes(artifact.format)) throw new Error("PACKET_DERIVATIVE_FORMAT_INVALID");
  if (artifact.format === "pdf" && (data.subarray(0, 5).toString("ascii") !== "%PDF-" || !data.subarray(-64).toString("ascii").includes("%%EOF")))
    throw new Error("PACKET_DERIVATIVE_FORMAT_INVALID");
  if (artifact.format === "webp" && (data.length < 16 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP" || data.readUInt32LE(4) !== data.length - 8))
    throw new Error("PACKET_DERIVATIVE_FORMAT_INVALID");
  if (artifact.format === "wav" && (data.length < 45 || data.length > 96_044 ||
      data.toString("ascii", 0, 4) !== "RIFF" || data.readUInt32LE(4) !== data.length - 8 ||
      data.toString("ascii", 8, 16) !== "WAVEfmt " || data.readUInt32LE(16) !== 16 ||
      data.readUInt16LE(20) !== 1 || data.readUInt16LE(22) !== 1 ||
      data.readUInt32LE(24) !== 12_000 || data.readUInt32LE(28) !== 12_000 ||
      data.readUInt16LE(32) !== 1 || data.readUInt16LE(34) !== 8 ||
      data.toString("ascii", 36, 40) !== "data" || data.readUInt32LE(40) !== data.length - 44))
    throw new Error("PACKET_DERIVATIVE_FORMAT_INVALID");
  return data;
}
