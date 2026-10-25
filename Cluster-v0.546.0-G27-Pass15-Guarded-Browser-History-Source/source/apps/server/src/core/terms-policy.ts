import crypto from "node:crypto";

export const TERMS_POLICY_KIND = "terms";
export const TERMS_POLICY_MAX_MARKDOWN_BYTES = 128 * 1024;
export const TERMS_POLICY_VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,2}(?:-[a-z0-9][a-z0-9.-]{0,31})?$/i;

export type TermsPolicyRecord = {
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

export function normalizeTermsPolicyVersion(value: unknown) {
  const version = String(value || "").trim();
  if (!TERMS_POLICY_VERSION_PATTERN.test(version)) {
    throw new Error("Terms versions must use a numeric version such as 1.0 or 2.1.0.");
  }
  return version;
}

export function normalizeTermsPolicyMarkdown(value: unknown) {
  const body = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!body) throw new Error("Terms text is required.");
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > TERMS_POLICY_MAX_MARKDOWN_BYTES) {
    throw new Error(`Terms text exceeds the ${TERMS_POLICY_MAX_MARKDOWN_BYTES}-byte limit.`);
  }
  return body;
}

export function termsPolicyContentHash(input: { version: string; title: string; summary?: string | null; bodyMarkdown: string }) {
  const canonical = JSON.stringify({
    kind: TERMS_POLICY_KIND,
    version: normalizeTermsPolicyVersion(input.version),
    title: String(input.title || "Terms of Service").trim() || "Terms of Service",
    summary: String(input.summary || "").trim(),
    bodyMarkdown: normalizeTermsPolicyMarkdown(input.bodyMarkdown),
  });
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function serializeTermsPolicy(record: TermsPolicyRecord) {
  return {
    id: record.id,
    kind: TERMS_POLICY_KIND,
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

export function starterTermsPolicy(studioName = "Studio") {
  const organization = String(studioName || "Studio").trim().slice(0, 120) || "Studio";
  return {
    version: "1.0",
    title: "Terms of Service",
    summary: `Rules for using ${organization}'s Cluster server and services.`,
    bodyMarkdown: `# Terms of Service\n\nLast reviewed: [DATE]\n\nThese starter terms are a drafting scaffold for **${organization}**. Replace every bracketed item, remove provisions that do not apply, and obtain appropriate legal review before publication. Cluster does not automatically publish or require acceptance of this template.\n\n## 1. Operator and scope\n\nThese Terms govern access to the Cluster server operated by **${organization}** ([LEGAL ENTITY / OPERATOR NAME]) at [SERVICE / SERVER IDENTIFIER]. Identify which users, services, desktop applications, web applications, and related features these Terms cover.\n\n## 2. Eligibility and authority\n\nDescribe who may use the service, any age or employment/contractor requirements, and whether a person accepting these Terms on behalf of an organization has authority to do so.\n\n## 3. Accounts and security\n\nUsers are responsible for protecting their credentials, using only accounts assigned to them, reporting suspected compromise, and complying with the operator's authentication and security requirements. Describe any additional account rules that apply.\n\n## 4. Permission to use the service\n\nSubject to these Terms and applicable policies, the operator grants authorized users a limited, revocable, non-transferable permission to access and use this Cluster deployment for approved organizational purposes. Define any additional license or access limits that apply to your deployment.\n\n## 5. User and studio content\n\nState who owns project files, messages, builds, designs, source code, media, and other content submitted to this server. Do not claim ownership of user or third-party content unless your organization actually has that right. Describe the limited permissions the operator needs to host, process, back up, synchronize, and display content to operate the service.\n\n## 6. Cluster software and third-party rights\n\nThe Cluster application, third-party libraries, trademarks, and other software may be subject to separate ownership and license terms. Do not use these Terms to claim rights your organization does not own. Identify any operator-owned branding, documentation, or materials separately.\n\n## 7. Acceptable use\n\nUsers must not use the service to violate law or third-party rights, bypass authorization, interfere with security or availability, distribute malware, access another person's account or data without permission, or misuse integrations. Add organization-specific conduct and acceptable-use rules here.\n\n## 8. Integrations and third-party services\n\nCluster can connect to services selected by the server administrator, such as Git or Discord providers. Identify the integrations your organization enables, explain that third-party terms may apply, and describe responsibility for credentials and external-service availability.\n\n## 9. Availability, changes, and maintenance\n\nDescribe expected availability, maintenance practices, backups, support commitments, and the operator's ability to change or discontinue features. Do not promise service levels your organization cannot actually provide.\n\n## 10. Suspension and termination\n\nDescribe when access may be suspended or terminated, what happens to project/work data, how users can obtain permitted exports, and any obligations that survive account termination.\n\n## 11. Privacy and data handling\n\nUse the separate published Privacy Policy to explain personal-data handling. Link it here: [PRIVACY POLICY URL OR /legal/privacy]. Avoid using these Terms to contradict the Privacy Policy or consent controls configured in Cluster.\n\n## 12. Warranties, liability, and remedies\n\n[LEGAL REVIEW REQUIRED] Describe warranties, disclaimers, limitations of liability, indemnity provisions, and available remedies only to the extent they are lawful and appropriate for your users and jurisdiction. Do not assume generic internet boilerplate is enforceable.\n\n## 13. Governing law and disputes\n\n[LEGAL REVIEW REQUIRED] Identify governing law, venue, dispute procedures, arbitration terms if any, and any mandatory consumer or employment rights that cannot be waived.\n\n## 14. Changes to these Terms\n\nMaterial changes should be published as a new immutable Terms version with a new effective date. Explain how users will be notified and when re-acceptance will be required once your deployment enables policy-acceptance tracking.\n\n## 15. Contact\n\nLegal/operator contact: [LEGAL CONTACT]\n\nOrganization address: [ADDRESS]\n\nSupport contact: [SUPPORT CONTACT]`,
  };
}
