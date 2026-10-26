import { createHash } from "node:crypto";
import { isExecutablePayload, isPotentiallyActiveContent, normalizeMimeType } from "./uploads.js";

export type UploadScanVerdict = "clean" | "suspicious" | "malicious" | "unavailable";

export type UploadScanInput = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  buffer?: Buffer;
  filePath?: string;
};

export type UploadMalwareScanner = {
  id: string;
  scan(input: UploadScanInput): Promise<{ verdict: UploadScanVerdict; engine?: string | null; signature?: string | null; detail?: string | null }>;
};

let configuredScanner: UploadMalwareScanner | null = null;

export function configureUploadMalwareScanner(scanner: UploadMalwareScanner | null) {
  configuredScanner = scanner;
}

export function currentUploadMalwareScanner() {
  return configuredScanner;
}

export type UploadSecurityDecision = {
  allowed: boolean;
  quarantine: boolean;
  code: string;
  reason: string;
  scanner: { id: string; verdict: UploadScanVerdict; engine?: string | null; signature?: string | null } | null;
};

export function checksumForUpload(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function inspectUploadSecurity(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  prefix: Buffer;
  allowExecutable: boolean;
  allowActiveContent?: boolean;
  scanner?: UploadMalwareScanner | null;
  scanBuffer?: Buffer;
  filePath?: string;
}): Promise<UploadSecurityDecision> {
  const mimeType = normalizeMimeType(input.mimeType);
  if (!input.allowExecutable && isExecutablePayload(input.prefix, input.fileName)) {
    return { allowed: false, quarantine: true, code: "EXECUTABLE_UPLOAD_DISABLED", reason: "Executable or script-like upload content is disabled by server policy.", scanner: null };
  }
  if (!input.allowActiveContent && isPotentiallyActiveContent(mimeType, input.fileName)) {
    return { allowed: false, quarantine: true, code: "ACTIVE_CONTENT_UPLOAD_BLOCKED", reason: "Active browser content must not be served from the untrusted upload path.", scanner: null };
  }
  if (!input.scanner) {
    return { allowed: true, quarantine: false, code: "UPLOAD_ACCEPTED", reason: "Built-in upload checks passed; no malware scanner provider is configured.", scanner: null };
  }
  let scan: Awaited<ReturnType<UploadMalwareScanner["scan"]>>;
  try {
    scan = await input.scanner.scan({
      fileName: input.fileName,
      mimeType,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
      ...(input.scanBuffer ? { buffer: input.scanBuffer } : {}),
      ...(input.filePath ? { filePath: input.filePath } : {}),
    });
  } catch (error) {
    return { allowed: false, quarantine: true, code: "MALWARE_SCANNER_UNAVAILABLE", reason: error instanceof Error ? error.message : "Malware scanner is unavailable.", scanner: { id: input.scanner.id, verdict: "unavailable" } };
  }
  const scanner = { id: input.scanner.id, verdict: scan.verdict, engine: scan.engine || null, signature: scan.signature || null };
  if (scan.verdict === "clean") return { allowed: true, quarantine: false, code: "UPLOAD_ACCEPTED", reason: scan.detail || "Malware scanner reported clean content.", scanner };
  if (scan.verdict === "unavailable") return { allowed: false, quarantine: true, code: "MALWARE_SCANNER_UNAVAILABLE", reason: scan.detail || "Malware scanner did not produce a trustworthy verdict.", scanner };
  return { allowed: false, quarantine: true, code: scan.verdict === "malicious" ? "MALWARE_DETECTED" : "UPLOAD_QUARANTINED", reason: scan.detail || "Upload content requires quarantine review.", scanner };
}
