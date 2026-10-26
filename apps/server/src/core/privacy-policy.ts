import crypto from "node:crypto";

export const PRIVACY_POLICY_KIND = "privacy";
export const PRIVACY_POLICY_MAX_MARKDOWN_BYTES = 128 * 1024;
export const PRIVACY_POLICY_VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,2}(?:-[a-z0-9][a-z0-9.-]{0,31})?$/i;

export type PrivacyPolicyRecord = {
  id: string;
  kind: string;
  version: string;
  title: string;
  summary?: string | null;
  bodyMarkdown: string;
  contentHash: string;
  status: string;
  effectiveAt?: Date | string | null;
  publishedAt?: Date | string | null;
  createdById?: string | null;
  publishedById?: string | null;
  acceptanceMode?: string | null;
  acceptanceAudience?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function normalizePrivacyPolicyVersion(value: unknown) {
  const version = String(value || "").trim();
  if (!PRIVACY_POLICY_VERSION_PATTERN.test(version)) {
    throw new Error("Privacy notice versions must use a numeric version such as 1.0 or 2.1.0.");
  }
  return version;
}

export function normalizePrivacyPolicyMarkdown(value: unknown) {
  const body = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!body) throw new Error("Privacy notice text is required.");
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > PRIVACY_POLICY_MAX_MARKDOWN_BYTES) {
    throw new Error(`Privacy notice text exceeds the ${PRIVACY_POLICY_MAX_MARKDOWN_BYTES}-byte limit.`);
  }
  return body;
}

export function privacyPolicyContentHash(input: { version: string; title: string; summary?: string | null; bodyMarkdown: string }) {
  const canonical = JSON.stringify({
    kind: PRIVACY_POLICY_KIND,
    version: normalizePrivacyPolicyVersion(input.version),
    title: String(input.title || "Internal Privacy Notice").trim() || "Internal Privacy Notice",
    summary: String(input.summary || "").trim(),
    bodyMarkdown: normalizePrivacyPolicyMarkdown(input.bodyMarkdown),
  });
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function serializePrivacyPolicy(record: PrivacyPolicyRecord) {
  return {
    id: record.id,
    kind: PRIVACY_POLICY_KIND,
    version: record.version,
    title: record.title,
    summary: record.summary || null,
    bodyMarkdown: record.bodyMarkdown,
    contentHash: record.contentHash,
    status: record.status,
    effectiveAt: iso(record.effectiveAt),
    publishedAt: iso(record.publishedAt),
    acceptanceMode: record.acceptanceMode || "none",
    acceptanceAudience: record.acceptanceAudience || "all_users",
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  };
}

export function starterPrivacyPolicy(studioName = "Studio") {
  const organization = String(studioName || "Studio").trim().slice(0, 120) || "Studio";
  return {
    version: "1.0",
    title: "Internal Privacy Notice",
    summary: `How ${organization} handles account, work, and operational data in its private Cluster deployment.`,
    bodyMarkdown: `# Internal Privacy Notice\n\nLast reviewed: [DATE]\n\n**${organization}** uses this private, self-hosted Cluster deployment as an internal team workspace. Cluster is proprietary internal software and is not offered as a public service. Replace the bracketed contact details and review this notice for the locations in which your team works before publishing it.\n\n## What Cluster stores\n\nCluster may store account and profile information, project and collaboration content, uploaded files, schedules and time records, presence/activity state, security and audit events, device/session information, and configuration required to operate the workspace.\n\n## Why this data is used\n\nData is used to authenticate team members, enforce permissions, coordinate work, maintain project history, operate scheduling and collaboration features, secure the deployment, support backups and recovery, and administer the studio.\n\n## Administrator access\n\nAuthorized administrators may access account, project, audit, scheduling, and operational records when needed to administer or secure the workspace. Access should follow the organization's internal permissions and confidentiality rules.\n\n## Integrations\n\nCluster only sends data to integrations enabled by the organization. Document any enabled services, such as Git or Discord, and the categories of information they receive.\n\n## Retention and account removal\n\nDocument retention periods for account data, project records, audit logs, backups, deleted content, and other categories. Account removal may preserve work history, security evidence, or records the organization needs to retain.\n\n## Optional browser features\n\nNecessary browser storage is used for authentication, security, offline work, and recovery. Optional preferences, analytics, and external embeds are controlled separately where those features are enabled.\n\n## Contact\n\nPrivacy or data questions: [INTERNAL CONTACT]\n\nOrganization: ${organization}\n\n## Changes\n\nMaterial changes should be published as a new notice version with a new effective date.`,
  };
}
