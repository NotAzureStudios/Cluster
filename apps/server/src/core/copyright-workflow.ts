import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { decodeDataUrl, isExecutablePayload, resolvedUploadMime, safeFileName } from "./uploads.js";

export const COPYRIGHT_EVIDENCE_MAX_FILES = 5;
export const COPYRIGHT_EVIDENCE_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const COPYRIGHT_EVIDENCE_MAX_TOTAL_BYTES = 6 * 1024 * 1024;
export const COPYRIGHT_REPEAT_REVIEW_COUNT = 3;
export const COPYRIGHT_RESOURCE_TYPES = ["library", "project_file", "review_asset"] as const;
export type CopyrightResourceType = typeof COPYRIGHT_RESOURCE_TYPES[number];

const ALLOWED_EVIDENCE_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
]);

function normalizedText(value: unknown, max = 32_000) {
  return String(value ?? "").normalize("NFKC").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry)).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}

export function sha256Text(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function copyrightNoticeHash(input: Record<string, unknown>) {
  return sha256Text(canonical(input));
}

export function copyrightCounterNoticeHash(input: Record<string, unknown>) {
  return sha256Text(canonical(input));
}

export function generateCopyrightCaseReference(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `CR-${date}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

export function generateCopyrightCaseToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashCopyrightCaseToken(token: string) {
  return sha256Text(String(token || ""));
}

export function safePublicCopyrightCase(caseRecord: any) {
  return {
    reference: caseRecord.publicReference,
    status: caseRecord.status,
    submittedAt: caseRecord.submittedAt,
    acknowledgedAt: caseRecord.acknowledgedAt,
    disabledAt: caseRecord.disabledAt,
    restoredAt: caseRecord.restoredAt,
    closedAt: caseRecord.closedAt,
    resourceType: caseRecord.resourceType,
    resourceUrl: caseRecord.resourceUrl,
    counterNotice: caseRecord.counterNotice ? {
      status: caseRecord.counterNotice.status,
      submittedAt: caseRecord.counterNotice.submittedAt,
      forwardedAt: caseRecord.counterNotice.forwardedAt,
      restorationEligibleAt: caseRecord.counterNotice.restorationEligibleAt,
      restorationDeadlineAt: caseRecord.counterNotice.restorationDeadlineAt,
      legalActionReceivedAt: caseRecord.counterNotice.legalActionReceivedAt,
    } : null,
    events: (caseRecord.events || []).filter((event: any) => ["public", "both"].includes(String(event.audience))).map((event: any) => ({
      eventType: event.eventType,
      message: event.message,
      createdAt: event.createdAt,
    })),
  };
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const delta = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + delta + (nth - 1) * 7));
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const delta = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month, last.getUTCDate() - delta));
}

function observedFixedHoliday(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  else if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function sameUtcDay(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

export function isUsFederalBusinessDay(input: Date) {
  const date = new Date(input);
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const year = date.getUTCFullYear();
  const holidays = [
    observedFixedHoliday(year, 0, 1),
    nthWeekdayOfMonth(year, 0, 1, 3),
    nthWeekdayOfMonth(year, 1, 1, 3),
    lastWeekdayOfMonth(year, 4, 1),
    observedFixedHoliday(year, 5, 19),
    observedFixedHoliday(year, 6, 4),
    nthWeekdayOfMonth(year, 8, 1, 1),
    nthWeekdayOfMonth(year, 9, 1, 2),
    observedFixedHoliday(year, 10, 11),
    nthWeekdayOfMonth(year, 10, 4, 4),
    observedFixedHoliday(year, 11, 25),
    // New Year's Day may be observed on December 31 of the preceding year.
    observedFixedHoliday(year + 1, 0, 1),
  ];
  return !holidays.some((holiday) => sameUtcDay(date, holiday));
}

export function addBusinessDays(input: Date, count: number) {
  const date = new Date(input);
  let remaining = Math.max(0, Math.trunc(count));
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isUsFederalBusinessDay(date)) remaining -= 1;
  }
  return date;
}

export function sanitizeCopyrightEventMetadata(input: unknown) {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const blocked = /token|secret|password|signature|address|phone|email/i;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (blocked.test(key)) continue;
    if (typeof value === "string") output[key] = normalizedText(value, 1000);
    else if (["number", "boolean"].includes(typeof value) || value == null) output[key] = value;
  }
  return JSON.stringify(output);
}

export async function writeCopyrightEvidence(options: {
  uploadsRoot: string;
  caseId: string;
  entries: Array<{ originalName: string; dataUrl: string; evidenceType?: string }>;
}) {
  const entries = options.entries || [];
  if (entries.length > COPYRIGHT_EVIDENCE_MAX_FILES) throw new Error(`A copyright submission may contain at most ${COPYRIGHT_EVIDENCE_MAX_FILES} evidence files.`);
  const destinationRoot = path.resolve(options.uploadsRoot, "copyright-cases", options.caseId);
  await fs.mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  let total = 0;
  const results: Array<{ originalName: string; storedName: string; mimeType: string; sizeBytes: number; sha256: string; evidenceType: string }> = [];
  try {
    for (const entry of entries) {
      const originalName = safeFileName(entry.originalName || "evidence");
      const decoded = decodeDataUrl(entry.dataUrl, COPYRIGHT_EVIDENCE_MAX_FILE_BYTES);
      total += decoded.buffer.length;
      if (total > COPYRIGHT_EVIDENCE_MAX_TOTAL_BYTES) throw new Error(`Copyright evidence exceeds the ${COPYRIGHT_EVIDENCE_MAX_TOTAL_BYTES}-byte total limit.`);
      if (isExecutablePayload(decoded.buffer, originalName)) throw new Error("Executable or script-like copyright evidence is not accepted.");
      const mimeType = resolvedUploadMime(decoded.buffer, originalName, decoded.declaredMime);
      if (!ALLOWED_EVIDENCE_MIME.has(mimeType)) throw new Error(`Unsupported copyright evidence type: ${mimeType}.`);
      const sha256 = sha256Text(decoded.buffer);
      const storedName = `${crypto.randomUUID()}-${sha256.slice(0, 12)}.evidence`;
      const destination = path.resolve(destinationRoot, storedName);
      if (!destination.startsWith(`${destinationRoot}${path.sep}`)) throw new Error("Copyright evidence path escaped managed storage.");
      await fs.writeFile(destination, decoded.buffer, { mode: 0o600, flag: "wx" });
      results.push({ originalName, storedName, mimeType, sizeBytes: decoded.buffer.length, sha256, evidenceType: normalizedText(entry.evidenceType || "supporting", 64) || "supporting" });
    }
    return results;
  } catch (error) {
    await Promise.all(results.map((entry) => fs.rm(path.join(destinationRoot, entry.storedName), { force: true }).catch(() => undefined)));
    throw error;
  }
}

export async function resolveCopyrightEvidencePath(uploadsRoot: string, caseId: string, storedName: string) {
  const root = path.resolve(uploadsRoot, "copyright-cases", caseId);
  const candidate = path.resolve(root, safeFileName(storedName));
  if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error("Evidence path is outside managed storage.");
  const stat = await fs.stat(candidate);
  if (!stat.isFile()) throw new Error("Evidence file is unavailable.");
  return { path: candidate, stat };
}

export async function copyrightRestriction(prisma: any, resourceType: string, resourceId: string) {
  if (!COPYRIGHT_RESOURCE_TYPES.includes(resourceType as CopyrightResourceType) || !resourceId) return null;
  return prisma.copyrightResourceRestriction.findFirst({ where: { resourceType, resourceId, state: "disabled" }, orderBy: { disabledAt: "desc" } });
}

export async function isCopyrightResourceDisabled(prisma: any, resourceType: string, resourceId: string) {
  const restriction = await copyrightRestriction(prisma, resourceType, resourceId);
  return Boolean(restriction && restriction.state === "disabled");
}

export function copyrightDisabledResponse(reply: any) {
  reply.header("Cache-Control", "private, no-store");
  return reply.code(451).send({
    ok: false,
    code: "COPYRIGHT_ACCESS_DISABLED",
    error: "Access to this material is temporarily disabled while a copyright matter is being handled.",
  });
}
