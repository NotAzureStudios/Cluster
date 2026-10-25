import crypto from "node:crypto";

export const COPYRIGHT_POLICY_KIND = "copyright_dmca";
export const COPYRIGHT_POLICY_MAX_MARKDOWN_BYTES = 128 * 1024;
export const COPYRIGHT_POLICY_VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,2}(?:-[a-z0-9][a-z0-9.-]{0,31})?$/i;

export type CopyrightPolicyRecord = {
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
  createdAt: Date | string;
  updatedAt: Date | string;
};

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function normalizeCopyrightPolicyVersion(value: unknown) {
  const version = String(value || "").trim();
  if (!COPYRIGHT_POLICY_VERSION_PATTERN.test(version)) {
    throw new Error("Copyright policy versions must use a numeric version such as 1.0 or 2.1.0.");
  }
  return version;
}

export function normalizeCopyrightPolicyMarkdown(value: unknown) {
  const body = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!body) throw new Error("Copyright policy text is required.");
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > COPYRIGHT_POLICY_MAX_MARKDOWN_BYTES) {
    throw new Error(`Copyright policy text exceeds the ${COPYRIGHT_POLICY_MAX_MARKDOWN_BYTES}-byte limit.`);
  }
  return body;
}

export function copyrightPolicyContentHash(input: { version: string; title: string; summary?: string | null; bodyMarkdown: string }) {
  const canonical = JSON.stringify({
    kind: COPYRIGHT_POLICY_KIND,
    version: normalizeCopyrightPolicyVersion(input.version),
    title: String(input.title || "Copyright & DMCA Policy").trim() || "Copyright & DMCA Policy",
    summary: String(input.summary || "").trim(),
    bodyMarkdown: normalizeCopyrightPolicyMarkdown(input.bodyMarkdown),
  });
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function serializeCopyrightPolicy(record: CopyrightPolicyRecord) {
  return {
    id: record.id,
    kind: COPYRIGHT_POLICY_KIND,
    version: record.version,
    title: record.title,
    summary: record.summary || null,
    bodyMarkdown: record.bodyMarkdown,
    contentHash: record.contentHash,
    status: record.status,
    effectiveAt: iso(record.effectiveAt),
    publishedAt: iso(record.publishedAt),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  };
}

export function starterCopyrightPolicy(studioName = "Studio") {
  const organization = String(studioName || "Studio").trim().slice(0, 120) || "Studio";
  return {
    version: "1.0",
    title: "Copyright & DMCA Policy",
    summary: `Copyright reporting and response policy for ${organization}'s Cluster deployment.`,
    bodyMarkdown: `# Copyright & DMCA Policy

Last reviewed: [DATE]

This document is a drafting scaffold for **${organization}**. It is **not legal advice**, is never automatically published, and does not by itself establish eligibility for any limitation on liability or “safe harbor” under 17 U.S.C. § 512. Replace every bracketed field and obtain appropriate legal review before publication. If the operator intends to rely on a U.S. DMCA designated-agent process, the operator must separately satisfy the applicable statutory and U.S. Copyright Office requirements.

## 1. Scope and operator

This policy describes how **${organization}** ([OPERATOR LEGAL NAME]) handles copyright complaints concerning content stored or made available through this Cluster deployment at [SERVER / SERVICE IDENTIFIER]. Identify the actual operator and the services covered. Do not imply that the Cluster software vendor operates or controls a self-hosted deployment unless that is factually true.

## 2. Respect for copyright

Users must not upload, publish, share, or distribute material through this deployment when they lack the rights or authorization needed to do so. The operator may restrict access to material or accounts when required by applicable law, valid contractual obligations, or published service policies.

## 3. Copyright contact and designated agent

[LEGAL REVIEW REQUIRED] If the operator seeks to use the U.S. DMCA process under 17 U.S.C. § 512(c), identify the service provider and designated agent accurately and keep the public information current.

Service provider legal name: [SERVICE PROVIDER LEGAL NAME]

Physical street address: [SERVICE PROVIDER STREET ADDRESS]

Designated agent name / role: [DMCA AGENT]

Designated agent mailing address: [DMCA AGENT ADDRESS]

Designated agent telephone: [DMCA AGENT PHONE]

Designated agent email: [DMCA AGENT EMAIL]

U.S. Copyright Office designated-agent directory record: [DIRECTORY RECORD / URL OR “NOT REGISTERED”]

Publishing contact information in Cluster is **not** a substitute for the separate designation/registration required by the U.S. Copyright Office when that requirement applies.

## 4. Notification of claimed infringement

[LEGAL REVIEW REQUIRED] A copyright owner or authorized agent submitting a U.S. DMCA notification should provide a written communication to the designated agent containing the information required by 17 U.S.C. § 512(c)(3), including:

1. a physical or electronic signature of the copyright owner or person authorized to act for the owner;
2. identification of the copyrighted work claimed to have been infringed, or a representative list when a single notice covers multiple works at one online site;
3. identification of the material claimed to be infringing or the subject of infringing activity, plus information reasonably sufficient to let the operator locate it;
4. information reasonably sufficient to contact the complaining party, such as address, telephone number, and email address;
5. a statement that the complaining party has a good-faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law; and
6. a statement that the information in the notice is accurate and, under penalty of perjury, that the complaining party is authorized to act for the owner of the allegedly infringed exclusive right.

Send notices only to the contact identified above or through an operator-approved reporting workflow once one is enabled. Do not place passwords, private keys, unrelated personal data, or unnecessary confidential material in a notice.

## 5. Operator response

The operator will review notices according to applicable law and its published procedures. Depending on the circumstances, the operator may request missing information, restrict access to identified material, preserve relevant evidence, notify the affected user, or take no action when the request is invalid or outside the operator's responsibility. This policy does not promise automatic removal merely because a complaint was submitted.

## 6. Counter-notification

[LEGAL REVIEW REQUIRED] When material is removed or disabled under a process to which 17 U.S.C. § 512(g) applies, the affected subscriber may be able to submit a written counter-notification to the designated agent. A compliant counter-notification generally must include the information required by § 512(g)(3), including:

1. the subscriber's physical or electronic signature;
2. identification of the removed/disabled material and the location where it appeared before removal or disabling;
3. a statement under penalty of perjury that the subscriber has a good-faith belief the material was removed or disabled because of mistake or misidentification;
4. the subscriber's name, address, and telephone number; and
5. the jurisdiction/service-of-process statements required by applicable § 512(g)(3) language.

Do not publish a simplified substitute for the statutory jurisdiction/service language without legal review. Where § 512(g) applies, the operator should follow the statutory notice-and-restoration timing rather than inventing its own countdown.

## 7. Repeat infringers

[LEGAL REVIEW REQUIRED] If applicable to the operator and service, state and reasonably implement a policy for terminating, in appropriate circumstances, subscribers or account holders who are repeat infringers. Define how the operator evaluates reliable evidence and account history. Do not use this section as permission for arbitrary account termination unrelated to copyright infringement.

## 8. Standard technical measures

[LEGAL REVIEW REQUIRED] Where 17 U.S.C. § 512(i) applies, describe how the service accommodates and does not interfere with qualifying standard technical measures. Remove this section when it is not relevant to the deployment.

## 9. Misrepresentation and abuse

Knowingly submitting materially false infringement or counter-notification representations can carry legal consequences. Users must not weaponize the copyright process to censor lawful material, obtain unrelated personal information, harass another user, or interfere with legitimate project work.

## 10. Evidence, privacy, and disclosure

Copyright reports may contain personal information and legal assertions. Explain how the operator stores, restricts, discloses, and retains this information consistently with the deployment's Privacy Policy, security-audit controls, and applicable legal obligations. Do not promise confidentiality when disclosure may be legally required or necessary to process a notice/counter-notice.

## 11. Other copyright requests

For requests that do not use the U.S. DMCA process, identify the appropriate copyright/legal contact and explain that local law may provide a different procedure. This policy should not imply that U.S. § 512 governs every deployment or every copyright complaint worldwide.

## 12. Changes to this policy

Material revisions should be published as a new immutable policy version with a new effective date. Publication is not evidence that any person accepted the policy; Cluster's auditable policy-acceptance system is implemented separately.

## 13. Contacts

Copyright/legal contact: [COPYRIGHT CONTACT]

Designated agent, if applicable: [DMCA AGENT CONTACT]

Operator address: [ADDRESS]

Security contact: [SECURITY CONTACT]`,
  };
}
