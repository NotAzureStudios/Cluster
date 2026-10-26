import crypto from "node:crypto";

export const POLICY_ACCEPTANCE_KINDS = ["privacy", "terms", "operator_agreement"] as const;
export type PolicyAcceptanceMode = "none" | "acknowledge" | "accept";
export type PolicyAcceptanceAudience = "all_users" | "admins";

export function normalizePolicyAcceptanceMode(value: unknown): PolicyAcceptanceMode {
  const mode = String(value || "none").trim().toLowerCase();
  if (mode === "acknowledge" || mode === "accept") return mode;
  return "none";
}

export function normalizePolicyAcceptanceAudience(value: unknown): PolicyAcceptanceAudience {
  return String(value || "all_users").trim().toLowerCase() === "admins" ? "admins" : "all_users";
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function policyRequirementHash(policy: any) {
  const canonical = JSON.stringify({
    policyId: String(policy.id),
    kind: String(policy.kind),
    version: String(policy.version),
    contentHash: String(policy.contentHash),
    acceptanceMode: normalizePolicyAcceptanceMode(policy.acceptanceMode),
    acceptanceAudience: normalizePolicyAcceptanceAudience(policy.acceptanceAudience),
  });
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function acceptanceEvidenceHash(input: {
  userId: string;
  policyId: string;
  policyKind: string;
  policyVersion: string;
  policyContentHash: string;
  acceptanceMode: string;
  acceptanceAudience: string;
  requirementHash: string;
  acceptedAt: Date;
  sessionId?: string | null;
  source: string;
}) {
  const canonical = JSON.stringify({
    userId: input.userId,
    policyId: input.policyId,
    policyKind: input.policyKind,
    policyVersion: input.policyVersion,
    policyContentHash: input.policyContentHash,
    acceptanceMode: input.acceptanceMode,
    acceptanceAudience: input.acceptanceAudience,
    requirementHash: input.requirementHash,
    acceptedAt: input.acceptedAt.toISOString(),
    sessionId: input.sessionId || null,
    source: input.source,
  });
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}


export function verifyPolicyAcceptanceEvidence(record: any) {
  if (!record?.evidenceHash || !record?.policyId || !record?.acceptedAt) return false;
  const originalUserId = String(record.userId || record.subjectPolicyKey || "").split(":", 1)[0];
  if (!originalUserId) return false;
  const expected = acceptanceEvidenceHash({
    userId: originalUserId,
    policyId: String(record.policyId),
    policyKind: String(record.policyKind),
    policyVersion: String(record.policyVersion),
    policyContentHash: String(record.policyContentHash),
    acceptanceMode: String(record.acceptanceMode),
    acceptanceAudience: String(record.acceptanceAudience),
    requirementHash: String(record.requirementHash),
    acceptedAt: record.acceptedAt instanceof Date ? record.acceptedAt : new Date(record.acceptedAt),
    sessionId: record.sessionId || null,
    source: String(record.source || "web"),
  });
  try { return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(String(record.evidenceHash), "hex")); } catch { return false; }
}

let requirementCache: { expiresAt: number; policies: any[] } | null = null;
export function invalidatePolicyAcceptanceRequirementCache() { requirementCache = null; }

async function currentAcceptancePolicies(prisma: any, now = new Date()) {
  if (requirementCache && requirementCache.expiresAt > now.getTime()) return requirementCache.policies;
  const rows = await prisma.legalPolicyVersion.findMany({
    where: { kind: { in: [...POLICY_ACCEPTANCE_KINDS] }, status: "published" },
    select: { id: true, kind: true, version: true, title: true, summary: true, contentHash: true, acceptanceMode: true, acceptanceAudience: true, effectiveAt: true, publishedAt: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });
  const effective = rows.filter((row: any) => !row.effectiveAt || new Date(row.effectiveAt).getTime() <= now.getTime());
  const current = POLICY_ACCEPTANCE_KINDS.map((kind) => effective.filter((row: any) => row.kind === kind).sort((a: any, b: any) => {
    const effectiveDelta = new Date(b.effectiveAt || 0).getTime() - new Date(a.effectiveAt || 0).getTime();
    if (effectiveDelta) return effectiveDelta;
    const publishedDelta = new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
    if (publishedDelta) return publishedDelta;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  })[0]).filter(Boolean).filter((row: any) => normalizePolicyAcceptanceMode(row.acceptanceMode) !== "none");
  requirementCache = { expiresAt: now.getTime() + 5000, policies: current };
  return current;
}

export function acceptancePolicyPublicPath(kind: string) {
  if (kind === "terms") return "/legal/terms";
  if (kind === "operator_agreement") return "/legal/operator-agreement";
  return "/legal/privacy";
}

export async function policyAcceptanceRequirements(prisma: any, isAdmin: boolean, now = new Date()) {
  const policies = (await currentAcceptancePolicies(prisma, now)).filter((policy: any) => policy.acceptanceAudience !== "admins" || isAdmin);
  const requirements = policies.map((policy: any) => ({
    policyId: policy.id,
    kind: policy.kind,
    version: policy.version,
    title: policy.title,
    summary: policy.summary || null,
    contentHash: policy.contentHash,
    acceptanceMode: normalizePolicyAcceptanceMode(policy.acceptanceMode),
    acceptanceAudience: normalizePolicyAcceptanceAudience(policy.acceptanceAudience),
    requirementHash: policyRequirementHash(policy),
    publicPath: acceptancePolicyPublicPath(policy.kind),
    effectiveAt: iso(policy.effectiveAt),
    publishedAt: iso(policy.publishedAt),
  }));
  const digest = crypto.createHash("sha256").update(JSON.stringify(requirements.map((item) => [item.policyId, item.requirementHash]).sort()), "utf8").digest("hex");
  return { requirements, digest };
}

export async function policyAcceptanceStatus(prisma: any, user: { id: string }, isAdmin: boolean, now = new Date()) {
  const current = await policyAcceptanceRequirements(prisma, isAdmin, now);
  const ids = current.requirements.map((policy: any) => policy.policyId);
  const records = ids.length ? await prisma.policyAcceptance.findMany({ where: { userId: user.id, policyId: { in: ids } }, orderBy: { acceptedAt: "desc" } }) : [];
  const byPolicy = new Map(records.map((record: any) => [record.policyId, record]));
  const requirements = current.requirements.map((policy: any) => {
    const accepted = byPolicy.get(policy.policyId) || null;
    const evidenceValid = Boolean(accepted && (accepted as any).requirementHash === policy.requirementHash && (accepted as any).policyContentHash === policy.contentHash && verifyPolicyAcceptanceEvidence(accepted));
    return { ...policy, accepted: evidenceValid, acceptedAt: evidenceValid ? iso((accepted as any).acceptedAt) : null, evidenceHash: evidenceValid ? (accepted as any).evidenceHash : null };
  });
  return { schemaVersion: 1, required: requirements.length > 0, complete: requirements.every((item) => item.accepted), digest: current.digest, requirements, pending: requirements.filter((item) => !item.accepted) };
}

export async function ensureSessionPolicyAcceptance(prisma: any, session: any, isAdmin: boolean) {
  const current = await policyAcceptanceRequirements(prisma, isAdmin);
  if (session.policyAcceptanceDigest === current.digest) return { schemaVersion: 1, required: current.requirements.length > 0, complete: true, digest: current.digest, requirements: [], pending: [] };
  const status = await policyAcceptanceStatus(prisma, session.user, isAdmin);
  if (status.complete) {
    await prisma.session.update({ where: { id: session.id }, data: { policyAcceptanceDigest: status.digest } }).catch(() => null);
    session.policyAcceptanceDigest = status.digest;
  }
  return status;
}
