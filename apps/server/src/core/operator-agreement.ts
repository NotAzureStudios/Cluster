import crypto from "node:crypto";

export const OPERATOR_AGREEMENT_KIND = "operator_agreement";
export const OPERATOR_AGREEMENT_MAX_MARKDOWN_BYTES = 128 * 1024;
export const OPERATOR_AGREEMENT_VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,2}(?:-[a-z0-9][a-z0-9.-]{0,31})?$/i;

export type OperatorAgreementRecord = {
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

export function normalizeOperatorAgreementVersion(value: unknown) {
  const version = String(value || "").trim();
  if (!OPERATOR_AGREEMENT_VERSION_PATTERN.test(version)) {
    throw new Error("Operator agreement versions must use a numeric version such as 1.0 or 2.1.0.");
  }
  return version;
}

export function normalizeOperatorAgreementMarkdown(value: unknown) {
  const body = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!body) throw new Error("Operator agreement text is required.");
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > OPERATOR_AGREEMENT_MAX_MARKDOWN_BYTES) {
    throw new Error(`Operator agreement text exceeds the ${OPERATOR_AGREEMENT_MAX_MARKDOWN_BYTES}-byte limit.`);
  }
  return body;
}

export function operatorAgreementContentHash(input: { version: string; title: string; summary?: string | null; bodyMarkdown: string }) {
  const canonical = JSON.stringify({
    kind: OPERATOR_AGREEMENT_KIND,
    version: normalizeOperatorAgreementVersion(input.version),
    title: String(input.title || "Server Operator Agreement").trim() || "Server Operator Agreement",
    summary: String(input.summary || "").trim(),
    bodyMarkdown: normalizeOperatorAgreementMarkdown(input.bodyMarkdown),
  });
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function serializeOperatorAgreement(record: OperatorAgreementRecord) {
  return {
    id: record.id,
    kind: OPERATOR_AGREEMENT_KIND,
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

export function starterOperatorAgreement(studioName = "Studio") {
  const organization = String(studioName || "Studio").trim().slice(0, 120) || "Studio";
  return {
    version: "1.0",
    title: "Server Operator Agreement",
    summary: `Deployment and operator responsibilities for ${organization}'s Cluster server.`,
    bodyMarkdown: `# Server Operator Agreement

Last reviewed: [DATE]

This document is a drafting scaffold for the organization operating this Cluster deployment. It is **not legal advice**, it is not automatically published or accepted, and it does not assume that “Cluster” is itself the contracting legal entity. Replace every bracketed field, identify the actual licensor/distributor and operator, and obtain appropriate legal review before publication.

## 1. Parties and deployment

This agreement is between **[CLUSTER LICENSOR / DISTRIBUTOR LEGAL NAME]** and **${organization}** ([SERVER OPERATOR LEGAL NAME]) for the deployment identified as [SERVER / ORGANIZATION IDENTIFIER]. State clearly which software, hosted services, support services, and deployment environments are covered.

## 2. Authority to operate

The operator represents that it has authority to deploy the software, create user accounts, administer the server, connect integrations, and process the work/content placed in this deployment. Do not use this clause to claim authority the operator does not actually possess.

## 3. Software license and ownership

[LEGAL REVIEW REQUIRED] Identify the license governing Cluster, any separately licensed components, permitted installations, copying/modification rights, redistribution restrictions, and ownership of trademarks or documentation. This agreement must not override third-party open-source or commercial licenses.

## 4. Operator responsibilities

The operator is responsible for administering accounts and permissions, protecting administrator credentials and recovery keys, maintaining supported infrastructure, applying security updates, configuring backups, and reviewing security/operational alerts. Define any support obligations that belong to the licensor separately.

## 5. User administration and policies

The operator is responsible for deciding who may use its deployment and for publishing appropriate user-facing Terms, Privacy notices, retention rules, acceptable-use rules, and other organizational policies. The Server Operator Agreement is not a substitute for the operator's Terms of Service with its users.

## 6. Content and intellectual property

State that project files, source code, media, messages, builds, and other user/studio content remain subject to the rights of their actual owners. Do not transfer ownership merely because content is stored in Cluster. Define only the limited processing rights needed to host, synchronize, back up, secure, and recover the deployment.

## 7. Security and incident response

Describe the operator's responsibilities for network security, administrator access, key custody, server hardening, vulnerability remediation, incident reporting, and preservation of relevant audit evidence. Identify the security contact and supported-version policy.

## 8. Backups and disaster recovery

The operator is responsible for selecting retention, off-host backup, recovery-key custody, restore testing, and recovery objectives appropriate to its organization unless a separate written service agreement states otherwise. Do not promise recovery guarantees that are not actually provided.

## 9. Integrations and external services

The operator chooses and configures external services such as Git, Discord, identity, mail, storage, or analytics providers. Third-party terms and availability may apply. Credentials must be provided only through supported secret/configuration mechanisms.

## 10. Updates and supported versions

Describe update channels, security-fix expectations, support windows, end-of-support behavior, compatibility requirements, and whether the operator may defer updates. Identify which party is responsible for testing deployment-specific integrations before rollout.

## 11. Fees, support, and service levels

[LEGAL REVIEW REQUIRED] If applicable, define fees, payment terms, support scope, service levels, maintenance windows, response targets, and exclusions. Remove this section if no commercial service is provided.

## 12. Suspension and termination

Define when the license or services may be suspended or terminated, what happens to operator access, how export/removal of operator data is handled, and which obligations survive termination.

## 13. Confidentiality

[LEGAL REVIEW REQUIRED] Define confidential information, permitted disclosure, security obligations, exclusions, and survival periods where appropriate. Do not classify information as confidential merely because it passes through the server.

## 14. Warranties, liability, and indemnity

[LEGAL REVIEW REQUIRED] Add only provisions appropriate to the actual transaction, governing law, and parties. Avoid generic disclaimer or indemnity text that has not been reviewed for enforceability.

## 15. Governing law and disputes

[LEGAL REVIEW REQUIRED] Identify governing law, venue, dispute process, arbitration if any, and mandatory rights that cannot be waived.

## 16. Changes and versioning

Material revisions should be published as a new immutable agreement version with a new effective date. Publication alone does not establish acceptance; Cluster's auditable policy-acceptance system is implemented separately.

## 17. Contacts

Licensor/distributor legal contact: [LEGAL CONTACT]

Operator legal contact: [OPERATOR CONTACT]

Security contact: [SECURITY CONTACT]

Support contact: [SUPPORT CONTACT]`,
  };
}
