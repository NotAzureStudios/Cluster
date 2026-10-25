import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sourceRevision } from "./release-evidence-lib.mjs";

const root = process.cwd();
const outArg = process.argv.find((item) => item.startsWith("--out="));
const output = path.resolve(outArg?.slice(6) || path.join(root, ".cluster", "legal-readiness", "legal-privacy-accessibility-roadmap-evidence.json"));

const steps = [
  [1, "Privacy Policy system", "0.362.0", "docs/PRIVACY_POLICY_SYSTEM.md", "privacy-policy-v1", "apps/server/src/core/privacy-policy.ts"],
  [2, "Privacy consent and storage choices", "0.363.0", "docs/PRIVACY_CONSENT_STORAGE.md", "privacy-consent-v1", "apps/server/src/core/privacy-consent.ts"],
  [3, "Privacy data control center", "0.364.0", "docs/PRIVACY_DATA_CONTROL_CENTER.md", "privacy-data-controls-v1", "apps/server/src/domains/legal/privacy-data-routes.ts"],
  [4, "Data inventory and retention", "0.365.0", "docs/DATA_INVENTORY_RETENTION.md", "data-retention-v1", "apps/server/src/core/data-retention.ts"],
  [5, "Terms of Service system", "0.366.0", "docs/TERMS_OF_SERVICE_SYSTEM.md", "terms-policy-v1", "apps/server/src/core/terms-policy.ts"],
  [6, "Server Operator Agreement", "0.367.0", "docs/SERVER_OPERATOR_AGREEMENT.md", "server-operator-agreement-v1", "apps/server/src/core/operator-agreement.ts"],
  [7, "Copyright and DMCA policy", "0.368.0", "docs/COPYRIGHT_DMCA_POLICY.md", "copyright-dmca-policy-v1", "apps/server/src/core/copyright-policy.ts"],
  [8, "Copyright reporting workflow", "0.369.0", "docs/COPYRIGHT_REPORTING_WORKFLOW.md", "copyright-reporting-workflow-v1", "apps/server/src/domains/legal/copyright-workflow-routes.ts"],
  [9, "App-wide accessibility baseline", "0.370.0", "docs/APP_WIDE_ACCESSIBILITY.md", "app-accessibility-v1", "packages/renderer/src/core/accessibility.ts"],
  [10, "Accessibility preferences", "0.371.0", "docs/ACCESSIBILITY_SETTINGS.md", "accessibility-preferences-v1", "packages/renderer/src/core/accessibility-preferences.ts"],
  [11, "Automated accessibility CI", "0.372.0", "docs/AUTOMATED_ACCESSIBILITY_CI.md", null, "tools/scripts/accessibility-ci.mjs"],
  [12, "Direct-resource authorization regression", "0.373.0", "docs/DIRECT_RESOURCE_AUTHORIZATION_REGRESSION.md", "direct-resource-authorization-v1", "tools/tests/integration/direct-resource-authorization.test.ts"],
  [13, "Logout and session replay regression", "0.374.0", "docs/LOGOUT_SESSION_REPLAY_REGRESSION.md", "session-replay-regression-v1", "tools/tests/integration/logout-session-regression.test.ts"],
  [14, "Security vulnerability disclosure", "0.375.0", "docs/SECURITY_VULNERABILITY_DISCLOSURE_POLICY.md", "security-disclosure-policy-v1", "apps/server/src/core/security-disclosure-policy.ts"],
  [15, "Legal and Compliance center", "0.376.0", "docs/LEGAL_COMPLIANCE_CENTER.md", "legal-compliance-center-v1", "apps/server/src/core/legal-compliance.ts"],
  [16, "Third-party disclosure generation", "0.377.0", "docs/THIRD_PARTY_DISCLOSURE_GENERATION.md", "third-party-disclosure-v1", "apps/server/src/core/third-party-disclosure.ts"],
  [17, "Auditable policy acceptance", "0.378.0", "docs/AUDITABLE_POLICY_ACCEPTANCE.md", "policy-acceptance-v1", "apps/server/src/core/policy-acceptance.ts"],
  [18, "Behavioral analytics consent", "0.379.0", "docs/BEHAVIORAL_ANALYTICS_CONSENT.md", "behavioral-analytics-consent-v1", "apps/server/src/core/behavioral-analytics.ts"],
  [19, "Privacy erasure fulfillment", "0.380.0", "docs/PRIVACY_ERASURE_FULFILLMENT.md", "privacy-erasure-fulfillment-v1", "apps/server/src/core/privacy-erasure.ts"],
  [20, "Release readiness and evidence consolidation", "0.381.0", "docs/LEGAL_PRIVACY_ACCESSIBILITY_RELEASE_READINESS.md", "legal-roadmap-evidence-v1", "tools/scripts/legal-roadmap-evidence.mjs"],
];

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function read(relative) { return readFile(path.join(root, relative), "utf8"); }
async function sha256File(relative) { return createHash("sha256").update(await readFile(path.join(root, relative))).digest("hex"); }
function sha256Text(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }

const pkg = JSON.parse(await read("package.json"));
const contracts = await read("packages/shared/src/api-contracts.ts");
const results = [];
const failures = [];
for (const [step, title, release, doc, capability, anchor] of steps) {
  const releaseNotes = `RELEASE_NOTES_v${release}.md`;
  for (const file of [doc, releaseNotes, anchor]) if (!(await exists(path.join(root, file)))) failures.push(`Step ${step} is missing ${file}`);
  if (failures.some((item) => item.startsWith(`Step ${step} `))) continue;
  const [docText, releaseText] = await Promise.all([read(doc), read(releaseNotes)]);
  if (!new RegExp(`Step\\s+${step}\\b`, "i").test(`${docText}\n${releaseText}`)) failures.push(`Step ${step} documentation/release notes do not identify the roadmap boundary.`);
  if (capability && !contracts.includes(`"${capability}"`)) failures.push(`Step ${step} capability ${capability} is missing from the API contract.`);
  results.push({
    step,
    title,
    release: `v${release}`,
    capability,
    documentation: { path: doc, sha256: await sha256File(doc) },
    releaseNotes: { path: releaseNotes, sha256: await sha256File(releaseNotes) },
    implementationAnchor: { path: anchor, sha256: await sha256File(anchor) },
  });
}
if (failures.length) throw new Error(`Legal/privacy/accessibility roadmap evidence failed:\n- ${failures.join("\n- ")}`);

const unsigned = {
  schema: 1,
  clusterVersion: pkg.version,
  sourceRevision: sourceRevision(root),
  generatedAt: new Date().toISOString(),
  roadmap: {
    name: "Legal / Privacy / Accessibility",
    totalSteps: 20,
    completedSteps: results.length,
    implementationStatus: results.length === 20 ? "complete" : "incomplete",
    engineeringEvidenceComplete: results.length === 20,
    legalCertification: false,
    note: "This manifest proves roadmap implementation/release anchors and file integrity. It is not legal advice, regulatory certification, or a determination that any operator complies with a particular law.",
  },
  steps: results,
};
const complete = { ...unsigned, recordHash: sha256Text(canonicalJson(unsigned)) };
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(complete, null, 2)}\n`, { mode: 0o600 });
console.log(`Legal/privacy/accessibility roadmap evidence: ${results.length}/20 steps verified.`);
console.log(`Evidence: ${output}`);
