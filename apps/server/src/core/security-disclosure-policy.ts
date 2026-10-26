import crypto from "node:crypto";

export const SECURITY_DISCLOSURE_POLICY_KIND = "security_vulnerability_disclosure";
export const SECURITY_DISCLOSURE_POLICY_MAX_MARKDOWN_BYTES = 128 * 1024;
export const SECURITY_DISCLOSURE_POLICY_VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,2}(?:-[a-z0-9][a-z0-9.-]{0,31})?$/i;
export const SECURITY_TXT_MAX_VALIDITY_DAYS = 366;

export type SecurityDisclosureMetadata = {
  contacts: string[];
  expires: string;
  preferredLanguages: string[];
  encryption?: string | null;
  acknowledgments?: string | null;
};

export type SecurityDisclosurePolicyRecord = {
  id: string;
  kind: string;
  version: string;
  title: string;
  summary?: string | null;
  bodyMarkdown: string;
  metadataJson?: string | null;
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

function normalizeHttpsUrl(value: unknown, label: string) {
  const text = String(value || "").trim();
  if (!text) return null;
  let parsed: URL;
  try { parsed = new URL(text); } catch { throw new Error(`${label} must be a valid HTTPS URL.`); }
  if (parsed.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  parsed.hash = "";
  return parsed.toString();
}

export function normalizeSecurityDisclosureVersion(value: unknown) {
  const version = String(value || "").trim();
  if (!SECURITY_DISCLOSURE_POLICY_VERSION_PATTERN.test(version)) {
    throw new Error("Security disclosure policy versions must use a numeric version such as 1.0 or 2.1.0.");
  }
  return version;
}

export function normalizeSecurityDisclosureMarkdown(value: unknown) {
  const body = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!body) throw new Error("Security disclosure policy text is required.");
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > SECURITY_DISCLOSURE_POLICY_MAX_MARKDOWN_BYTES) {
    throw new Error(`Security disclosure policy text exceeds the ${SECURITY_DISCLOSURE_POLICY_MAX_MARKDOWN_BYTES}-byte limit.`);
  }
  return body;
}

export function normalizeSecurityDisclosureMetadata(value: unknown, options: { now?: Date; requireCurrent?: boolean; effectiveAt?: Date | string | null } = {}) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const contacts = [...new Set((Array.isArray(raw.contacts) ? raw.contacts : []).map((item) => String(item || "").trim()).filter(Boolean))];
  if (!contacts.length) throw new Error("At least one security contact is required for security.txt.");
  if (contacts.length > 8) throw new Error("security.txt supports at most 8 configured contacts in Cluster.");
  for (const contact of contacts) {
    let parsed: URL;
    try { parsed = new URL(contact); } catch { throw new Error("Security contacts must be valid mailto: or HTTPS URIs."); }
    if (!['mailto:', 'https:'].includes(parsed.protocol)) throw new Error("Security contacts must use mailto: or HTTPS.");
  }

  const expires = new Date(String(raw.expires || ""));
  if (!Number.isFinite(expires.getTime())) throw new Error("security.txt expiry must be a valid date and time.");
  const now = options.now || new Date();
  const anchor = options.effectiveAt ? new Date(options.effectiveAt) : now;
  if (!Number.isFinite(anchor.getTime())) throw new Error("Security disclosure policy effective date is invalid.");
  if (options.requireCurrent !== false && expires.getTime() <= Math.max(now.getTime(), anchor.getTime())) {
    throw new Error("security.txt expiry must be after the policy becomes effective and still be in the future.");
  }
  if (expires.getTime() - anchor.getTime() > SECURITY_TXT_MAX_VALIDITY_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error(`security.txt expiry must be within ${SECURITY_TXT_MAX_VALIDITY_DAYS} days of the policy effective date.`);
  }

  const preferredLanguages = [...new Set((Array.isArray(raw.preferredLanguages) ? raw.preferredLanguages : ["en"])
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(item)))].slice(0, 12);
  if (!preferredLanguages.length) preferredLanguages.push("en");

  return {
    contacts,
    expires: expires.toISOString(),
    preferredLanguages,
    encryption: normalizeHttpsUrl(raw.encryption, "security.txt encryption URL"),
    acknowledgments: normalizeHttpsUrl(raw.acknowledgments, "security.txt acknowledgments URL"),
  } satisfies SecurityDisclosureMetadata;
}

export function securityDisclosureMetadataJson(value: SecurityDisclosureMetadata) {
  return JSON.stringify(value);
}

export function parseSecurityDisclosureMetadata(value: unknown) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return normalizeSecurityDisclosureMetadata(parsed, { requireCurrent: false });
  } catch {
    return null;
  }
}

export function securityDisclosureContentHash(input: { version: string; title: string; summary?: string | null; bodyMarkdown: string; metadata: SecurityDisclosureMetadata }) {
  const canonical = JSON.stringify({
    kind: SECURITY_DISCLOSURE_POLICY_KIND,
    version: normalizeSecurityDisclosureVersion(input.version),
    title: String(input.title || "Security & Vulnerability Disclosure Policy").trim() || "Security & Vulnerability Disclosure Policy",
    summary: String(input.summary || "").trim(),
    bodyMarkdown: normalizeSecurityDisclosureMarkdown(input.bodyMarkdown),
    metadata: normalizeSecurityDisclosureMetadata(input.metadata, { requireCurrent: false }),
  });
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function serializeSecurityDisclosurePolicy(record: SecurityDisclosurePolicyRecord) {
  return {
    id: record.id,
    kind: SECURITY_DISCLOSURE_POLICY_KIND,
    version: record.version,
    title: record.title,
    summary: record.summary || null,
    bodyMarkdown: record.bodyMarkdown,
    metadata: parseSecurityDisclosureMetadata(record.metadataJson),
    contentHash: record.contentHash,
    status: record.status,
    effectiveAt: iso(record.effectiveAt),
    publishedAt: iso(record.publishedAt),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  };
}

export function securityTxtFromPolicy(record: SecurityDisclosurePolicyRecord, webOrigin: string) {
  const metadata = parseSecurityDisclosureMetadata(record.metadataJson);
  if (!metadata) throw new Error("Published security disclosure policy metadata is invalid.");
  const origin = String(webOrigin || "").replace(/\/+$/, "");
  const lines = [
    ...metadata.contacts.map((contact) => `Contact: ${contact}`),
    `Expires: ${metadata.expires}`,
    ...(metadata.encryption ? [`Encryption: ${metadata.encryption}`] : []),
    ...(metadata.acknowledgments ? [`Acknowledgments: ${metadata.acknowledgments}`] : []),
    `Preferred-Languages: ${metadata.preferredLanguages.join(", ")}`,
    `Policy: ${origin}/legal/security`,
    `Canonical: ${origin}/.well-known/security.txt`,
  ];
  return `${lines.join("\n")}\n`;
}

export function starterSecurityDisclosurePolicy(studioName = "Studio", now = new Date()) {
  const organization = String(studioName || "Studio").trim().slice(0, 120) || "Studio";
  const expires = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
  return {
    version: "1.0",
    title: "Security & Vulnerability Disclosure Policy",
    summary: `Coordinated vulnerability disclosure policy for ${organization}'s Cluster deployment.`,
    metadata: {
      contacts: ["mailto:security@example.com"],
      expires,
      preferredLanguages: ["en"],
      encryption: null,
      acknowledgments: null,
    } satisfies SecurityDisclosureMetadata,
    bodyMarkdown: `# Security & Vulnerability Disclosure Policy

Last reviewed: [DATE]

This document is a drafting scaffold for **${organization}**. It is not legal advice, is never automatically published, and does not create a bug bounty, payment obligation, or blanket authorization to test systems. Replace every bracketed field and obtain appropriate legal/security review before publication.

## 1. Purpose

**${organization}** welcomes responsible reports that help improve the security of this Cluster deployment. This policy explains which systems may be tested, how to report a suspected vulnerability, and the conditions under which good-faith security research is authorized by the operator.

## 2. Scope

In-scope systems: [LIST EXACT HOSTNAMES, APPLICATIONS, APIS, AND SERVICES]

Out-of-scope systems: [LIST THIRD-PARTY SERVICES, VENDORS, DEVELOPMENT ENVIRONMENTS, AND OTHER EXCLUSIONS]

If a system is not clearly listed as in scope, contact [SECURITY CONTACT] before testing it. Do not assume that a connected Git, Discord, cloud, identity, payment, hosting, or other third-party service is covered merely because Cluster integrates with it.

## 3. Good-faith authorization and safe harbor

[LEGAL REVIEW REQUIRED] Define what this operator considers good-faith security research and the legal authorization it is prepared to provide. A common vulnerability-disclosure pattern is to treat research performed in good faith and within this published policy as authorized and not pursue legal action for that compliant research. This language can create legal commitments, so it must be reviewed for the operator and jurisdiction before publication.

Nothing in this starter text authorizes activity against systems the operator does not own or control.

## 4. Research guidelines

When testing under this policy:

- use the minimum testing necessary to confirm a vulnerability;
- stop and report the issue if you encounter personal data, credentials, secrets, private project material, or other sensitive information;
- do not retain, copy, download, alter, delete, or publicly disclose data beyond what is strictly necessary to demonstrate the issue;
- do not establish persistence, pivot to other accounts or systems, perform destructive testing, or intentionally degrade service availability;
- do not use social engineering, phishing, physical intrusion, credential stuffing, password spraying, denial-of-service, volumetric attacks, or malware;
- do not test another user's account without explicit permission; and
- comply with applicable law and the operator's written scope.

## 5. Reporting a vulnerability

Primary security contact: [SECURITY CONTACT — MUST MATCH security.txt]

Include enough information to let the operator reproduce and assess the issue, such as the affected component/version, prerequisites, clear reproduction steps, proof-of-concept details, impact, and any relevant logs or screenshots. Remove unrelated personal or confidential data before sending a report.

Do not send passwords, session cookies, private keys, access tokens, or bulk copies of user/project data unless the security team explicitly requests a safe transfer method.

## 6. Encryption and sensitive reports

Optional encrypted-reporting method: [PGP / SECURE REPORT URL / NOT PROVIDED]

If encrypted reporting is offered, keep the key or secure upload endpoint current and make the same location available through the published security.txt metadata.

## 7. Response process

Target acknowledgement: [NUMBER] business days.

Target initial triage: [NUMBER] business days.

These are communication goals rather than guaranteed remediation deadlines. The operator may ask for additional information, prioritize issues by severity and exploitability, coordinate fixes across supported versions, and communicate status while remediation is underway.

## 8. Coordinated disclosure

Requested disclosure window: [NUMBER] days after acknowledgement or an agreed remediation date.

Researchers should give the operator a reasonable opportunity to investigate and remediate before public disclosure. The operator should not use this section to demand indefinite secrecy. When a vulnerability is actively exploited or creates urgent user risk, both sides should coordinate an earlier disclosure or mitigation plan where appropriate.

## 9. Supported versions and self-hosted responsibility

Supported Cluster versions / deployment branches: [SUPPORTED VERSIONS]

For self-hosted deployments, the organization operating the affected server is responsible for its configuration, credentials, network exposure, backups, integrations, updates, and incident response. Reports about the Cluster software itself should be routed to the software maintainer identified by that project; reports about a particular deployment should go to that deployment's operator.

## 10. Rewards and acknowledgement

Bug bounty or reward program: [NONE / LINK TO SEPARATE PROGRAM]

Do not imply payment or rewards unless a separate program actually promises them. Optional researcher acknowledgements: [ACKNOWLEDGEMENTS URL / NONE].

## 11. Privacy and report handling

Describe how vulnerability reports, researcher contact information, proof-of-concept material, and any accidentally encountered data are stored, restricted, shared, and retained. Cross-reference the deployment's Privacy Policy where appropriate.

## 12. Changes to this policy

Material revisions should be published as a new immutable policy version with a new effective date. The operator should also refresh security.txt before its expiry so researchers are not directed to stale contact information.

## 13. Contact

Security contact: [SECURITY CONTACT]

Operator legal contact: [LEGAL CONTACT]

Service identifier: [SERVER / SERVICE URL]`,
  };
}
