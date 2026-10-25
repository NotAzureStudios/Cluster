import { createHash } from "node:crypto";
import { API_CONTRACT } from "@cluster/shared";
import { PRIVACY_CONSENT_INVENTORY } from "./privacy-consent.js";
import { PRIVACY_POLICY_KIND } from "./privacy-policy.js";
import { TERMS_POLICY_KIND } from "./terms-policy.js";
import { OPERATOR_AGREEMENT_KIND } from "./operator-agreement.js";
import { COPYRIGHT_POLICY_KIND } from "./copyright-policy.js";
import { SECURITY_DISCLOSURE_POLICY_KIND, parseSecurityDisclosureMetadata } from "./security-disclosure-policy.js";
import { detectThirdPartyCandidates } from "./third-party-disclosure.js";
import { policyAcceptanceRequirements, verifyPolicyAcceptanceEvidence } from "./policy-acceptance.js";
import { readAnalyticsRetentionDays, readBuiltinAnalyticsProvider, serializeAnalyticsProvider } from "./behavioral-analytics.js";

const POLICY_DEFINITIONS = [
  { kind: PRIVACY_POLICY_KIND, key: "privacy", label: "Privacy Notice", publicPath: "/legal/privacy" },
  { kind: TERMS_POLICY_KIND, key: "terms", label: "Terms of Service", publicPath: "/legal/terms" },
  { kind: OPERATOR_AGREEMENT_KIND, key: "operatorAgreement", label: "Server Operator Agreement", publicPath: "/legal/operator-agreement" },
  { kind: COPYRIGHT_POLICY_KIND, key: "copyright", label: "Copyright & DMCA Policy", publicPath: "/legal/copyright" },
  { kind: SECURITY_DISCLOSURE_POLICY_KIND, key: "security", label: "Security & Vulnerability Disclosure Policy", publicPath: "/legal/security" },
] as const;

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function legalComplianceSnapshot(prisma: any, now = new Date(), settings: Record<string, unknown> = {}) {
  const [versions, retentionPolicies, latestRetentionRun, privacyRequestsPending, privacyRequestsApproved, privacyLegalHolds, consentRecords, thirdPartyRecords, copyrightOpen, copyrightLegalHolds, copyrightDisabledResources, copyrightCounterNotices, users, adminMemberships] = await Promise.all([
    prisma.legalPolicyVersion.findMany({
      where: { kind: { in: POLICY_DEFINITIONS.map((item) => item.kind) } },
      select: { id: true, kind: true, version: true, status: true, effectiveAt: true, publishedAt: true, createdAt: true, updatedAt: true, contentHash: true, metadataJson: true },
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    }),
    prisma.dataRetentionPolicy.findMany({ orderBy: { category: "asc" } }),
    prisma.dataRetentionRun.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.privacyDataRequest.count({ where: { status: "pending" } }),
    prisma.privacyDataRequest.count({ where: { status: "approved" } }),
    prisma.privacyLegalHold.count({ where: { status: "active" } }),
    prisma.privacyConsentPreference.count(),
    prisma.thirdPartyDisclosureProvider.findMany({ select: { sourceKey: true, status: true, publicVisible: true, reviewedAt: true } }),
    prisma.copyrightCase.count({ where: { status: { notIn: ["closed", "rejected"] } } }),
    prisma.copyrightCase.count({ where: { legalActionReceivedAt: { not: null }, closedAt: null } }),
    prisma.copyrightResourceRestriction.count({ where: { state: "disabled" } }),
    prisma.copyrightCounterNotice.count({ where: { status: { in: ["submitted", "forwarded"] } } }),
    prisma.user.findMany({ where: { archived: false }, select: { id: true } }),
    prisma.workspaceMember.findMany({ where: { role: { in: ["owner", "admin"] } }, select: { userId: true } }),
  ]);

  const policies = POLICY_DEFINITIONS.map((definition) => {
    const records = versions.filter((record: any) => record.kind === definition.kind);
    const published = records.filter((record: any) => record.status === "published");
    const effective = published
      .filter((record: any) => !record.effectiveAt || new Date(record.effectiveAt).getTime() <= now.getTime())
      .sort((a: any, b: any) => {
        const effectiveDelta = new Date(b.effectiveAt || 0).getTime() - new Date(a.effectiveAt || 0).getTime();
        if (effectiveDelta) return effectiveDelta;
        const publishedDelta = new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
        if (publishedDelta) return publishedDelta;
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      });
    const current = effective[0] || null;
    const scheduled = published.filter((record: any) => record.effectiveAt && new Date(record.effectiveAt).getTime() > now.getTime());
    const drafts = records.filter((record: any) => record.status === "draft");
    const metadata = definition.kind === SECURITY_DISCLOSURE_POLICY_KIND && current ? parseSecurityDisclosureMetadata(current.metadataJson) : null;
    const securityExpiresAt = metadata?.expires ? new Date(metadata.expires) : null;
    const securityExpired = Boolean(securityExpiresAt && securityExpiresAt.getTime() <= now.getTime());
    const securityExpiresSoon = Boolean(securityExpiresAt && !securityExpired && securityExpiresAt.getTime() - now.getTime() <= 30 * 24 * 60 * 60 * 1000);
    return {
      key: definition.key,
      kind: definition.kind,
      label: definition.label,
      publicPath: definition.publicPath,
      current: current ? {
        id: current.id,
        version: current.version,
        effectiveAt: iso(current.effectiveAt),
        publishedAt: iso(current.publishedAt),
        contentHash: current.contentHash,
      } : null,
      draftCount: drafts.length,
      scheduledCount: scheduled.length,
      totalVersions: records.length,
      ...(definition.kind === SECURITY_DISCLOSURE_POLICY_KIND ? {
        securityTxt: {
          expiresAt: securityExpiresAt ? securityExpiresAt.toISOString() : null,
          expired: securityExpired,
          expiresSoon: securityExpiresSoon,
        },
      } : {}),
    };
  });

  const sourceControlConnections = await prisma.integrationConnection.count({ where: { category: "source-control", archived: false, status: { not: "disabled" } } });
  const thirdPartyCandidates = detectThirdPartyCandidates({ ...settings, sourceControlConfigured: sourceControlConnections > 0 });
  const detectedThirdParties = thirdPartyCandidates.filter((candidate) => candidate.detected);
  const activeThirdPartyRecords = thirdPartyRecords.filter((record: any) => record.status === "active");
  const publicThirdPartyRecords = activeThirdPartyRecords.filter((record: any) => record.publicVisible && record.reviewedAt);
  const unreviewedThirdPartyRecords = activeThirdPartyRecords.filter((record: any) => !record.reviewedAt);
  const undisclosedDetectedThirdParties = detectedThirdParties.filter((candidate) => !activeThirdPartyRecords.some((record: any) => record.sourceKey === candidate.sourceKey));
  const recordedButNotDetectedThirdParties = activeThirdPartyRecords.filter((record: any) => {
    if (!record.sourceKey) return false;
    const candidate = thirdPartyCandidates.find((item) => item.sourceKey === record.sourceKey);
    return Boolean(candidate && !candidate.detected);
  });

  const [analyticsProviderRecord, analyticsRetentionDays, analyticsEvents30d] = await Promise.all([
    readBuiltinAnalyticsProvider(prisma),
    readAnalyticsRetentionDays(prisma),
    prisma.behavioralAnalyticsEvent.count({ where: { createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } } }),
  ]);
  const analyticsProvider = serializeAnalyticsProvider(analyticsProviderRecord, analyticsRetentionDays);

  const [memberAcceptance, adminAcceptance] = await Promise.all([policyAcceptanceRequirements(prisma, false, now), policyAcceptanceRequirements(prisma, true, now)]);
  const acceptanceRequirements = [...memberAcceptance.requirements, ...adminAcceptance.requirements.filter((item: any) => !memberAcceptance.requirements.some((member: any) => member.policyId === item.policyId))];
  const acceptancePolicyIds = acceptanceRequirements.map((item: any) => item.policyId);
  const acceptanceRecords = acceptancePolicyIds.length ? await prisma.policyAcceptance.findMany({ where: { policyId: { in: acceptancePolicyIds }, userId: { not: null } } }) : [];
  const validAcceptanceRecords = acceptanceRecords.filter((item: any) => verifyPolicyAcceptanceEvidence(item));
  const acceptedPairs = new Set(validAcceptanceRecords.map((item: any) => `${item.userId}:${item.policyId}`));
  const adminIds = new Set(adminMemberships.map((item: any) => item.userId));
  let pendingAcceptanceRequirements = 0;
  const pendingAcceptanceUsers = new Set<string>();
  for (const user of users) {
    for (const requirement of acceptanceRequirements as any[]) {
      if (requirement.acceptanceAudience === "admins" && !adminIds.has(user.id)) continue;
      if (!acceptedPairs.has(`${user.id}:${requirement.policyId}`)) { pendingAcceptanceRequirements += 1; pendingAcceptanceUsers.add(user.id); }
    }
  }

  const warnings: Array<{ key: string; severity: "info" | "warning"; title: string; detail: string; area: string }> = [];
  for (const policy of policies) {
    if (!policy.current) warnings.push({ key: `unpublished:${policy.key}`, severity: "warning", title: `${policy.label} is not currently published`, detail: "Review the operator-specific text before publishing. Cluster does not auto-publish starter legal text.", area: "policies" });
    if ((policy as any).securityTxt?.expired) warnings.push({ key: "security:expired", severity: "warning", title: "security.txt metadata has expired", detail: "Publish a new disclosure-policy version with a future Expires value so researchers are not directed to stale contact information.", area: "security" });
    else if ((policy as any).securityTxt?.expiresSoon) warnings.push({ key: "security:expires-soon", severity: "info", title: "security.txt expires within 30 days", detail: "Prepare the next disclosure-policy version before the current discovery record expires.", area: "security" });
  }
  if (undisclosedDetectedThirdParties.length > 0) warnings.push({ key: "privacy:third-party-detected", severity: "warning", title: `${undisclosedDetectedThirdParties.length} detected integration${undisclosedDetectedThirdParties.length === 1 ? "" : "s"} not reviewed for public disclosure`, detail: "Review detected data recipients and either publish an accurate disclosure record or document why the integration does not belong in the public disclosure.", area: "privacy" });
  if (recordedButNotDetectedThirdParties.length > 0) warnings.push({ key: "privacy:third-party-stale", severity: "info", title: `${recordedButNotDetectedThirdParties.length} disclosure record${recordedButNotDetectedThirdParties.length === 1 ? "" : "s"} no longer detected in current integration settings`, detail: "Review whether these records should remain active. Cluster keeps them visible until an operator decides, avoiding automatic legal-state changes from transient configuration.", area: "privacy" });
  if (analyticsProviderRecord.enabled && !analyticsProviderRecord.reviewedAt) warnings.push({ key: "privacy:analytics-review", severity: "warning", title: "Analytics collection is configured without current review", detail: "Cluster will fail closed, but an administrator should review or disable the analytics provider configuration.", area: "privacy" });
  if (unreviewedThirdPartyRecords.length > 0) warnings.push({ key: "privacy:third-party-unreviewed", severity: "warning", title: `${unreviewedThirdPartyRecords.length} third-party disclosure record${unreviewedThirdPartyRecords.length === 1 ? "" : "s"} awaiting review`, detail: "Material changes invalidate prior review and remove the record from public disclosure until an administrator reviews it again.", area: "privacy" });
  if (privacyRequestsPending > 0) warnings.push({ key: "privacy:pending-requests", severity: "warning", title: `${privacyRequestsPending} privacy data request${privacyRequestsPending === 1 ? "" : "s"} awaiting review`, detail: "Review pending account-data requests and record the operator decision.", area: "privacy" });
  if (privacyRequestsApproved > 0) warnings.push({ key: "privacy:approved-erasure", severity: "warning", title: `${privacyRequestsApproved} approved erasure request${privacyRequestsApproved === 1 ? "" : "s"} awaiting fulfillment`, detail: "Preview the erasure plan, verify no legal hold applies, then explicitly fulfill the approved request.", area: "privacy" });
  if (privacyLegalHolds > 0) warnings.push({ key: "privacy:legal-holds", severity: "info", title: `${privacyLegalHolds} active privacy legal hold${privacyLegalHolds === 1 ? "" : "s"}`, detail: "Active holds block destructive privacy erasure until explicitly released with an evidence note.", area: "privacy" });
  if (acceptanceRecords.length > validAcceptanceRecords.length) warnings.push({ key: "policies:acceptance-integrity", severity: "warning", title: `${acceptanceRecords.length - validAcceptanceRecords.length} policy acceptance evidence record${acceptanceRecords.length - validAcceptanceRecords.length === 1 ? "" : "s"} failed integrity verification`, detail: "Treat the affected acceptance as incomplete and investigate database/evidence integrity before relying on it.", area: "policies" });
  if (pendingAcceptanceUsers.size > 0) warnings.push({ key: "policies:acceptance-pending", severity: "warning", title: `${pendingAcceptanceUsers.size} user${pendingAcceptanceUsers.size === 1 ? "" : "s"} blocked on required policy review`, detail: `${pendingAcceptanceRequirements} current user-policy acceptance requirement${pendingAcceptanceRequirements === 1 ? "" : "s"} remain outstanding.`, area: "policies" });
  if (copyrightLegalHolds > 0) warnings.push({ key: "copyright:legal-holds", severity: "warning", title: `${copyrightLegalHolds} copyright case${copyrightLegalHolds === 1 ? "" : "s"} under legal hold`, detail: "Normal counter-notice restoration is blocked for these cases until the operator resolves the legal-action state.", area: "copyright" });

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    posture: {
      configurationStatus: warnings.some((item) => item.severity === "warning") ? "attention" : "reviewed",
      legalCertification: false,
      note: "This dashboard reports Cluster configuration and workflow state. It is not a legal, privacy, accessibility, or regulatory certification.",
    },
    policies,
    acceptance: {
      requiredVersions: acceptanceRequirements.length,
      evidenceRecords: acceptanceRecords.length,
      invalidEvidenceRecords: acceptanceRecords.length - validAcceptanceRecords.length,
      pendingUsers: pendingAcceptanceUsers.size,
      pendingRequirements: pendingAcceptanceRequirements,
    },
    privacy: {
      pendingDataRequests: privacyRequestsPending,
      approvedErasureRequests: privacyRequestsApproved,
      activeLegalHolds: privacyLegalHolds,
      consentRecords,
      consentNoticeVersion: PRIVACY_CONSENT_INVENTORY.noticeVersion,
      analyticsProviders: analyticsProvider.enabled ? 1 : 0,
      analytics: { enabled: analyticsProvider.enabled, reviewed: analyticsProvider.reviewed, retentionDays: analyticsRetentionDays, events30d: analyticsEvents30d, providerName: analyticsProvider.name },
      externalProviders: PRIVACY_CONSENT_INVENTORY.externalProviders.length,
      thirdPartyDisclosure: {
        configured: activeThirdPartyRecords.length,
        public: publicThirdPartyRecords.length,
        unreviewed: unreviewedThirdPartyRecords.length,
        detected: detectedThirdParties.length,
        detectedNotRecorded: undisclosedDetectedThirdParties.length,
        recordedButNotDetected: recordedButNotDetectedThirdParties.length,
        publicPath: "/legal/third-parties",
      },
      retentionPolicies: retentionPolicies.map((policy: any) => ({ category: policy.category, enabled: policy.enabled, retentionDays: policy.retentionDays, updatedAt: iso(policy.updatedAt) })),
      latestRetentionRun: latestRetentionRun ? { id: latestRetentionRun.id, status: latestRetentionRun.status, mode: latestRetentionRun.mode, trigger: latestRetentionRun.trigger, createdAt: iso(latestRetentionRun.createdAt), completedAt: iso(latestRetentionRun.completedAt) } : null,
    },
    copyright: {
      openCases: copyrightOpen,
      legalHolds: copyrightLegalHolds,
      disabledResources: copyrightDisabledResources,
      activeCounterNotices: copyrightCounterNotices,
    },
    engineering: {
      accessibilityBaseline: true,
      accessibilityPreferences: true,
      automatedAccessibilityCi: true,
      directResourceAuthorizationRegression: true,
      sessionReplayRegression: true,
      securityDisclosure: true,
      legalRoadmapEvidence: true,
    },
    warnings,
  };
}


function canonicalEvidenceJson(value: any): string {
  if (value === null) return "null";
  if (["boolean", "number", "string"].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalEvidenceJson).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalEvidenceJson(value[key])}`).join(",")}}`;
  throw new Error(`Unsupported compliance evidence value type: ${typeof value}`);
}

export async function legalComplianceEvidenceExport(prisma: any, now = new Date(), settings: Record<string, unknown> = {}) {
  const compliance = await legalComplianceSnapshot(prisma, now, settings);
  const unsigned = {
    schemaVersion: 1,
    generatedAt: compliance.generatedAt,
    apiContractVersion: API_CONTRACT.version,
    scope: "aggregate-deployment-posture",
    roadmap: {
      name: "Legal / Privacy / Accessibility",
      totalSteps: 20,
      completedSteps: 20,
      implementationStatus: "complete",
      legalCertification: false,
    },
    privacyBoundary: {
      containsUserList: false,
      containsRawSecurityEvidence: false,
      containsSecrets: false,
      containsPrivateIntegrationHosts: false,
      note: "This export intentionally contains aggregate posture and policy hashes rather than user-level evidence or credentials.",
    },
    compliance,
    disclaimer: "This is engineering/configuration evidence, not legal advice or certification that a deployment complies with a particular law, regulation, or contract.",
  };
  const evidenceHash = createHash("sha256").update(canonicalEvidenceJson(unsigned), "utf8").digest("hex");
  return { ...unsigned, evidenceHash };
}
