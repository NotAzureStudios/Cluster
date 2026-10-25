import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { AuthorizationService } from "./authorization.js";

export const PROJECT_ACCESS_PICKER_KINDS = ["project", "board", "whiteboard", "library", "review_asset"] as const;
export type ProjectAccessPickerKind = (typeof PROJECT_ACCESS_PICKER_KINDS)[number];
export type ProjectAccessPickerTarget = { kind: ProjectAccessPickerKind; id: string; label: string; projectId: string };

type DiscoveryArgs = {
  prisma: any;
  authorization: AuthorizationService;
  request: FastifyRequest;
  actorId: string;
  cursorSecret: string;
  project: any;
  q: string;
  minimum: "view" | "manage";
  limit: number;
  cursor?: string;
  kinds?: readonly ProjectAccessPickerKind[];
  ruleSelect: Record<string, boolean>;
  canAccessLibraryItem: (request: FastifyRequest, item: any, minimum: "view" | "manage") => Promise<boolean>;
};
type Position = { kind: ProjectAccessPickerKind; label: string; id: string };
type CursorContext = Pick<DiscoveryArgs, "actorId" | "cursorSecret" | "project" | "q" | "minimum"> & { kinds: readonly ProjectAccessPickerKind[] };
const CURSOR_TTL_MS = 15 * 60_000;
const MAX_SCANNED_PER_PAGE = 320;
const SCAN_BATCH = 16;

/** Encrypted and authenticated: never expose hidden candidate IDs in a paging token. */
function cursorKey(secret: string) {
  if (!secret) throw new Error("Resource discovery cursor key is unavailable.");
  return createHash("sha256").update("cluster-project-discovery-v2\0").update(secret).digest();
}
function encodeCursor(position: Position, context: CursorContext): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cursorKey(context.cursorSecret), nonce);
  const data = Buffer.from(JSON.stringify({ v: 2, position, projectId: context.project.id, actorId: context.actorId, q: context.q.trim(), minimum: context.minimum, kinds: context.kinds, issuedAt: Date.now() }));
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
}
function decodeCursor(cursor: string, context: CursorContext): Position {
  try {
    if (!cursor || cursor.length > 2048) throw new Error("length");
    const raw = Buffer.from(cursor, "base64url");
    if (raw.length < 30) throw new Error("length");
    const decipher = createDecipheriv("aes-256-gcm", cursorKey(context.cursorSecret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const decoded = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
    if (decoded.v !== 2 || JSON.stringify(decoded.kinds) !== JSON.stringify(context.kinds) || decoded.projectId !== context.project.id || decoded.actorId !== context.actorId || decoded.q !== context.q.trim() || decoded.minimum !== context.minimum) throw new Error("scope");
    if (!Number.isFinite(decoded.issuedAt) || Date.now() < decoded.issuedAt || Date.now() - decoded.issuedAt > CURSOR_TTL_MS) throw new Error("expired");
    if (!context.kinds.includes(decoded.position?.kind) || typeof decoded.position.label !== "string" || typeof decoded.position.id !== "string" || decoded.position.label.length > 512 || decoded.position.id.length > 256) throw new Error("position");
    return decoded.position;
  } catch {
    throw new Error("INVALID_PICKER_CURSOR");
  }
}

/**
 * Cursor discovery scans a bounded number of candidates per page, without
 * assuming the first 300 objects contain all visible results. Each result is
 * checked against the authoritative target and Library source/folder policies.
 * Cursor contents are encrypted so denied IDs and scan positions never leak.
 */
export async function discoverProjectAccessTargets(args: DiscoveryArgs) {
  const { prisma, authorization, request, project, minimum, limit, ruleSelect, canAccessLibraryItem } = args;
  const search = args.q.trim();
  // A canonical, stable scan order is part of the encrypted cursor scope.
  // Narrow requests avoid querying models unrelated to the calling workspace.
  const kinds = PROJECT_ACCESS_PICKER_KINDS.filter((kind) => !args.kinds || args.kinds.includes(kind));
  if (!kinds.length || (args.kinds && args.kinds.some((kind) => !PROJECT_ACCESS_PICKER_KINDS.includes(kind)))) throw new Error("INVALID_PICKER_KINDS");
  const context = { ...args, q: search, kinds };
  const position = args.cursor ? decodeCursor(args.cursor, context) : null;
  const targets: ProjectAccessPickerTarget[] = [];
  // Snapshot project-scoped rules once per page. Repeating that potentially
  // large read for every 16 candidates caused avoidable DB churn.
  const scopedRules = await prisma.accessRule.findMany({
    where: { status: "active", OR: [{ targetKind: "project", targetId: project.id }, { projectId: project.id }] },
    select: ruleSelect,
  });
  let scanned = 0;
  let last: Position | null = position;
  let needsContinuation = false;
  const options = [
    { kind: "board" as const, model: prisma.board, field: "name" as const, where: { projectId: project.id, archived: false } },
    { kind: "whiteboard" as const, model: prisma.whiteboard, field: "name" as const, where: { projectId: project.id } },
    { kind: "library" as const, model: prisma.libraryItem, field: "title" as const, where: { projectId: project.id, deletedAt: null, status: { notIn: ["archived", "trashed"] } } },
    { kind: "review_asset" as const, model: prisma.reviewAsset, field: "title" as const, where: { projectId: project.id } },
  ].filter((group) => kinds.includes(group.kind));
  const authorizes = async (candidates: Array<ProjectAccessPickerTarget & { item?: any }>) => {
    // Older direct-target rules may lack their projectId. Query only that
    // narrow legacy subset per batch; canonical project-scoped rules are shared.
    const directKinds = kinds.filter((kind) => kind !== "project");
    const legacyRules = candidates.some((candidate) => candidate.kind !== "project")
      ? await prisma.accessRule.findMany({
        where: { status: "active", projectId: null, OR: directKinds.map((kind) => ({
          targetKind: kind, targetId: { in: candidates.filter((item) => item.kind === kind).map((item) => item.id) },
        })) },
        select: ruleSelect,
      })
      : [];
    const rules = [...scopedRules, ...legacyRules];
    const decisions = await Promise.all(candidates.map(async (candidate) => {
      const decision = await authorization.authorize(request, minimum === "manage" ? "manage" : "view", { kind: "target", targetKind: candidate.kind, targetId: candidate.id, project }, { minimum, surface: "api", rules });
      if (!decision.allowed) return false;
      return candidate.kind !== "library" || canAccessLibraryItem(request, { ...candidate.item, project }, minimum);
    }));
    candidates.forEach((candidate, index) => {
      if (decisions[index]) targets.push({ kind: candidate.kind, id: candidate.id, label: candidate.label, projectId: project.id });
    });
  };

  if (kinds.includes("project") && !position && (!search || String(project.name || "").toLowerCase().includes(search.toLowerCase()))) {
    await authorizes([{ kind: "project", id: project.id, label: String(project.name), projectId: project.id }]);
    last = { kind: "project", id: project.id, label: String(project.name) };
    if (targets.length >= limit) needsContinuation = true;
  }

  if (!needsContinuation) {
    const startKind = position ? kinds.indexOf(position.kind) : 0;
    scan: for (const group of options) {
      const groupIndex = kinds.indexOf(group.kind);
      if (groupIndex < startKind) continue;
      let anchor: Position | null = position?.kind === group.kind ? position : null;
      while (targets.length < limit && scanned < MAX_SCANNED_PER_PAGE) {
        const take = Math.min(SCAN_BATCH, limit - targets.length, MAX_SCANNED_PER_PAGE - scanned);
        const match = search ? { [group.field]: { contains: search, mode: "insensitive" } } : {};
        const continuation = anchor ? { OR: [
          { [group.field]: { gt: anchor.label } },
          { [group.field]: anchor.label, id: { gt: anchor.id } },
        ] } : {};
        const rows = await group.model.findMany({
          where: { ...group.where, ...match, ...continuation },
          select: group.kind === "library" ? { id: true, title: true, type: true, parentId: true, ownerId: true, projectId: true, source: true } : { id: true, [group.field]: true },
          orderBy: [{ [group.field]: "asc" }, { id: "asc" }],
          take,
        });
        if (!rows.length) break;
        const candidates = rows.map((row: any) => ({ kind: group.kind, id: String(row.id), label: String(row[group.field]), projectId: project.id, ...(group.kind === "library" ? { item: row } : {}) }));
        // Do not allow malformed or blank labels from the database to become picker entries.
        const valid = candidates.filter((item: ProjectAccessPickerTarget) => item.id.trim() && item.label.trim());
        if (valid.length) await authorizes(valid);
        const tail = candidates[candidates.length - 1];
        anchor = { kind: group.kind, label: tail.label, id: tail.id };
        last = anchor;
        scanned += rows.length;
        if (targets.length >= limit || scanned >= MAX_SCANNED_PER_PAGE) { needsContinuation = true; break scan; }
        if (rows.length < take) break;
      }
    }
  }
  const nextCursor = needsContinuation && last ? encodeCursor(last, context) : null;
  return { ok: true as const, projectId: project.id, minimum, q: search, kinds, targets, nextCursor, truncated: Boolean(nextCursor) };
}
