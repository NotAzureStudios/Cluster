/** Closeout transitions are server-owned. A client may never mark a verified gate directly. */
export const CLOSEOUT_MANUAL_CHECK_KEYS = ["hoursReviewed", "externalDeliverablesConfirmed", "backupExportCreated"] as const;
export type CloseoutAction = "submit" | "verify" | "reject" | "archive" | "reopen";

const TRANSITIONS: Record<string, Partial<Record<CloseoutAction, string>>> = {
  draft: { submit: "submitted" },
  rejected: { submit: "submitted" },
  submitted: { verify: "verified", reject: "rejected" },
  verified: { archive: "archived", reopen: "draft" },
  archived: { reopen: "draft" },
};

export function nextCloseoutStatus(status: string, action: CloseoutAction): string | null {
  return TRANSITIONS[status]?.[action] ?? null;
}

/** Serialized projection: never expose tokenHash or backend authority fields. */
export function closeoutShareLinkProjection(link: any) {
  return {
    id: String(link.id),
    projectId: String(link.projectId),
    tokenPreview: String(link.tokenPreview || ""),
    accessLevel: String(link.accessLevel || "viewer"),
    allowedSections: (() => { try { const value = JSON.parse(String(link.allowedSections || "[]")); return Array.isArray(value) ? value.filter((entry: unknown) => typeof entry === "string").slice(0, 20) : []; } catch { return []; } })(),
    expiresAt: link.expiresAt?.toISOString?.() || link.expiresAt || null,
    maxUses: link.maxUses ?? null,
    useCount: Number(link.useCount || 0),
    status: closeoutShareLinkActive(link) ? "active" : "expired",
    createdAt: link.createdAt?.toISOString?.() || link.createdAt || null,
    updatedAt: link.updatedAt?.toISOString?.() || link.updatedAt || null,
  };
}

export function closeoutShareLinkActive(link: any, now = Date.now()) {
  return link.status === "active" && (!link.expiresAt || new Date(link.expiresAt).getTime() > now) && (link.maxUses == null || Number(link.useCount || 0) < Number(link.maxUses));
}

export class CloseoutConcurrentWrite extends Error {
  constructor() { super("Project closeout was changed by another editor."); this.name = "CloseoutConcurrentWrite"; }
}

export async function updateCloseoutAtRevision(tx: any, id: string, expectedRevision: number, status: string, data: Record<string, unknown>) {
  const result = await tx.projectControlRecord.updateMany({
    where: { id, revision: expectedRevision, status, archived: false, kind: "closeout", category: "project-closeout" },
    data: { ...data, revision: { increment: 1 } },
  });
  if (result.count !== 1) throw new CloseoutConcurrentWrite();
  const record = await tx.projectControlRecord.findUnique({ where: { id } });
  if (!record) throw new CloseoutConcurrentWrite();
  return record;
}
