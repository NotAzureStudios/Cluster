import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "config", "toolchain-versions.json"), "utf8"));
const checks = [];
const errors = [];
function check(label, ok, detail = "") { checks.push({ label, ok, detail }); if (!ok) errors.push(`${label}${detail ? `: ${detail}` : ""}`); }
async function exists(relative) { try { await access(path.join(root, relative)); return true; } catch { return false; } }
async function text(relative) {
  try { return await readFile(path.join(root, relative), "utf8"); } catch (error) {
    if (relative.startsWith(".github/") && error?.code === "ENOENT") return "";
    throw error;
  }
}
async function walk(directory, out = []) {
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (["node_modules", ".git", "dist", "build", "release", "runtime", "data"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, out); else out.push(absolute);
  }
  return out;
}

const required = [
  "config/toolchain-versions.json",
  "prisma.config.ts",
  "apps/server/prisma/schema.prisma",
  "apps/server/src/core/prisma-client.ts",
  "apps/server-launcher-go/main.go",
  "apps/host-go/main.go",
  "apps/desktop-qt/CMakeLists.txt",
  "apps/desktop-qt/qml/pages/SharedRendererPage.qml",
  "apps/desktop-qt/qml/pages/AppSettingsWindow.qml",
  "apps/desktop-qt/qml/pages/ServerProfilesWindow.qml",
  "apps/desktop-qt/src/ServerProfileStore.h",
  "apps/desktop-qt/src/ServerProfileStore.cpp",
  "apps/desktop-qt/src/NativeCapabilityBroker.h",
  "apps/desktop-qt/src/NativeCapabilityBroker.cpp",
  "docs/SECURITY_ARCHITECTURE.md",
  "docs/NATIVE_CAPABILITY_BROKER.md",
  "docs/AUTH_SESSION_SECURITY.md",
  "docs/LOGOUT_SESSION_REPLAY_REGRESSION.md",
  "docs/AUTHORIZATION_ARCHITECTURE.md",
  "docs/UPLOAD_CONTENT_SECURITY.md",
  "docs/OUTBOUND_NETWORK_SECURITY.md",
  "docs/SECRET_CONFIGURATION_SECURITY.md",
  "docs/SECURITY_AUDIT_TRAIL.md",
  "docs/API_ABUSE_RESOURCE_SECURITY.md",
  "docs/MUTATION_DATA_INTEGRITY.md",
  "docs/SYNC_INTEGRITY_SECURITY.md",
  "docs/DATABASE_RECOVERY_RESILIENCE.md",
  "docs/OPERATIONAL_HEALTH_RESILIENCE.md",
  "docs/PRIVACY_POLICY_SYSTEM.md",
  "docs/TERMS_OF_SERVICE_SYSTEM.md",
  "docs/SERVER_OPERATOR_AGREEMENT.md",
  "docs/COPYRIGHT_DMCA_POLICY.md",
  "docs/PRIVACY_CONSENT_STORAGE.md",
  "docs/PRIVACY_DATA_CONTROL_CENTER.md",
  "docs/DATA_INVENTORY_RETENTION.md",
  "docs/LEGAL_COMPLIANCE_CENTER.md",
  "docs/LEGAL_PRIVACY_ACCESSIBILITY_RELEASE_READINESS.md",
  "docs/RENDERER_ARCHITECTURE.md",
  "tools/scripts/legal-roadmap-evidence.mjs",
  "tools/scripts/renderer-build-compat-audit.mjs",
  "tools/scripts/renderer-architecture-audit.mjs",
  "tools/scripts/design-system-audit.mjs",
  "tools/scripts/empty-loading-first-use-phase13-audit.mjs",
  "tools/scripts/accessibility-input-phase14-audit.mjs",
  "config/design-system-color-baseline.json",
  "docs/DESIGN_SYSTEM.md",
  "docs/EMPTY_LOADING_FIRST_USE_PHASE13.md",
  "docs/BACKEND_ARCHITECTURE_OVERHAUL.md",
  "docs/DESKTOP_SYNC_OVERHAUL.md",
  "config/desktop-parity-surfaces.json",
  "tools/scripts/desktop-parity-audit.mjs",
  "tools/scripts/desktop-sync-audit.mjs",
  "tools/scripts/server-architecture-audit.mjs",
  "apps/server/src/app/server-domain-catalog.ts",
  "apps/server/src/app/server-job-runtime.ts",
  "apps/server/src/domains/jobs/job-types.ts",
  "apps/server/src/domains/jobs/job-queue-service.ts",
  "apps/server/src/domains/jobs/job-worker.ts",
  "apps/server/src/domains/jobs/job-routes.ts",
  "apps/server/src/domains/admin/server-architecture-routes.ts",
  "packages/renderer/src/features/admin/BackgroundJobsPanel.tsx",
  "packages/renderer/src/features/admin/background-jobs.css",
  "apps/server/prisma/migrations/20260820080000_backend_architecture_jobs/migration.sql",
  "packages/renderer/src/styles/design-system/tokens.css",
  "packages/renderer/src/styles/design-system/primitives.css",
  "packages/renderer/src/components/DesignSystemPreview.tsx",
  "docs/THIRD_PARTY_DISCLOSURE_GENERATION.md",
  "docs/AUDITABLE_POLICY_ACCEPTANCE.md",
  "apps/server/src/core/policy-acceptance.ts",
  "apps/server/src/domains/legal/policy-acceptance-routes.ts",
  "packages/renderer/src/features/legal/PolicyAcceptanceScreen.tsx",
  "packages/renderer/src/features/legal/PolicyAcceptanceAdminPanel.tsx",
  "apps/server/src/core/third-party-disclosure.ts",
  "apps/server/src/domains/legal/third-party-disclosure-routes.ts",
  "packages/renderer/src/features/legal/ThirdPartyDisclosurePage.tsx",
  "packages/renderer/src/features/legal/ThirdPartyDisclosureAdminPanel.tsx",
  "apps/server/src/core/legal-compliance.ts",
  "apps/server/src/domains/legal/legal-compliance-routes.ts",
  "packages/renderer/src/features/legal/LegalComplianceCenter.tsx",
  "packages/renderer/src/features/legal/PrivacyRequestsAdminPanel.tsx",
  "apps/server/src/core/data-retention.ts",
  "apps/server/src/domains/legal/data-retention-routes.ts",
  "packages/renderer/src/features/legal/DataRetentionAdminPanel.tsx",
  "apps/server/src/core/privacy-data-control.ts",
  "apps/server/src/domains/legal/privacy-data-routes.ts",
  "packages/renderer/src/features/legal/PrivacyDataControlCenter.tsx",
  "apps/server/src/core/privacy-consent.ts",
  "apps/server/src/domains/legal/privacy-consent-routes.ts",
  "packages/renderer/src/core/privacy-consent.ts",
  "packages/renderer/src/features/legal/PrivacyConsentManager.tsx",
  "apps/server/src/core/privacy-policy.ts",
  "apps/server/src/core/terms-policy.ts",
  "apps/server/src/core/operator-agreement.ts",
  "apps/server/src/core/copyright-policy.ts",
  "apps/server/src/domains/legal/privacy-policy-routes.ts",
  "apps/server/src/domains/legal/terms-policy-routes.ts",
  "apps/server/src/domains/legal/operator-agreement-routes.ts",
  "apps/server/src/domains/legal/copyright-policy-routes.ts",
  "packages/renderer/src/features/legal/PrivacyPolicyPage.tsx",
  "packages/renderer/src/features/legal/TermsPolicyPage.tsx",
  "packages/renderer/src/features/legal/OperatorAgreementPage.tsx",
  "packages/renderer/src/features/legal/CopyrightPolicyPage.tsx",
  "packages/renderer/src/features/legal/PrivacyPolicyAdminPanel.tsx",
  "packages/renderer/src/features/legal/TermsPolicyAdminPanel.tsx",
  "packages/renderer/src/features/legal/OperatorAgreementAdminPanel.tsx",
  "packages/renderer/src/features/legal/CopyrightPolicyAdminPanel.tsx",
  "apps/server/src/core/operational-health.ts",
  "apps/server/src/core/filesystem-backup.ts",
  "apps/server/src/core/database-recovery.ts",
  "apps/server/src/core/backup-manifest.ts",
  "apps/server/src/core/sync-security.ts",
  "apps/server/src/core/idempotency.ts",
  "apps/server/src/core/request-workload.ts",
  "apps/server/src/core/security-audit-integrity.ts",
  "apps/server/src/core/security-audit-store.ts",
  "apps/server/src/core/security-audit-policy.ts",
  "apps/server/src/core/outbound-http.ts",
  "docs/DESKTOP_UPDATE_SECURITY.md",
  "apps/server/src/domains/access/route-policy.ts",
  "apps/server/src/domains/access/request-authorization-boundary.ts",
  "apps/server/src/domains/access/authorization.ts",
  "apps/desktop-qt/src/NativeUpdateManager.h",
  "apps/desktop-qt/src/NativeUpdateManager.cpp",
  "apps/update-helper-go/main.go",
  "tools/scripts/release-update-manifest.mjs",
  "apps/server/src/core/session-security.ts",
  "packages/renderer/src/components/ReauthenticationHost.tsx",
  "packages/renderer/src/styles/shell-unification.css",
  "packages/renderer/src/styles/parity-v344.css",
  "packages/renderer/src/styles/application.css",
  "packages/renderer/src/features/library/LibraryThreeModelViewer.tsx",
  "tools/scripts/desktop-setup.mjs",
  "tools/scripts/toolchain-versions.mjs",
  "tools/scripts/check-dependency-updates.mjs",
  "tools/scripts/release-preflight.mjs",
  "tools/scripts/release-upgrade-drill.mjs",
  "tools/scripts/release-verify-artifacts.mjs",
  "tools/scripts/release-certify-local.mjs",
  "tools/scripts/desktop-smoke.mjs",
  ".github/workflows/release.yml",
];
const repositoryCiAvailable = await exists(".github/workflows/release.yml") && await exists(".github/workflows/ci.yml");
for (const file of required) check(`required ${file}`, file.startsWith(".github/") ? (repositoryCiAvailable || !(await exists(".github"))) : await exists(file));

const packageJson = JSON.parse(await text("package.json"));
const serverPackage = JSON.parse(await text("apps/server/package.json"));
const rendererPackage = JSON.parse(await text("packages/renderer/package.json"));
const schema = await text("apps/server/prisma/schema.prisma");
const prismaConfig = await text("prisma.config.ts");
const prismaClient = await text("apps/server/src/core/prisma-client.ts");
const cmake = await text("apps/desktop-qt/CMakeLists.txt");
const launcher = await text("apps/server-launcher-go/main.go");
const windowsRuntime = await text("apps/server-launcher-go/runtime_windows.go");
const viewer = await text("packages/renderer/src/features/library/LibraryThreeModelViewer.tsx");
const styles = await text("packages/renderer/src/styles.css");
const bootstrapLock = await text("apps/server/src/core/database-bootstrap-lock.ts");
const rendererApplicationEntry = await text("packages/renderer/src/features/application/ClusterApplication.tsx");
const rendererApplication = [
  rendererApplicationEntry,
  await text("packages/renderer/src/features/application/modules/application-foundation.tsx"),
  await text("packages/renderer/src/features/application/modules/application-shell.tsx"),
  await text("packages/renderer/src/features/application/modules/application-operations.tsx"),
  await text("packages/renderer/src/features/application/modules/application-workspaces.tsx"),
].join("\n");
const rendererAccessibility = await text("packages/renderer/src/components/AccessibilityManager.tsx");
const rendererPerformance = await text("packages/renderer/src/core/performance.ts");
const rendererChangelog = await text("packages/renderer/src/features/changelog/ChangelogPage.tsx");
const changelogData = await text("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const rendererPolish = await text("packages/renderer/src/styles/visual-polish.css");
const rendererShell = await text("packages/renderer/src/styles/shell-unification.css");
const rendererParity = await text("packages/renderer/src/styles/parity-v344.css");
const designSystemTokens = await text("packages/renderer/src/styles/design-system/tokens.css");
const designSystemPrimitives = await text("packages/renderer/src/styles/design-system/primitives.css");
const designSystemPreview = await text("packages/renderer/src/components/DesignSystemPreview.tsx");
const designSystemDoc = await text("docs/DESIGN_SYSTEM.md");
const desktopMainQml = await text("apps/desktop-qt/qml/Main.qml");
const desktopSharedRendererQml = await text("apps/desktop-qt/qml/pages/SharedRendererPage.qml");
const desktopAppSettingsQml = await text("apps/desktop-qt/qml/pages/AppSettingsWindow.qml");
const desktopProfilesQml = await text("apps/desktop-qt/qml/pages/ServerProfilesWindow.qml");
const desktopIntegrationCpp = await text("apps/desktop-qt/src/DesktopIntegration.cpp");
const desktopSetupScript = await text("tools/scripts/desktop-setup.mjs");
const desktopServerQml = await text("apps/desktop-qt/qml/pages/ServerPage.qml");
const desktopPreferencesHeader = await text("apps/desktop-qt/src/DesktopPreferences.h");
const appControllerCpp = await text("apps/desktop-qt/src/AppController.cpp");
const desktopProfileHeader = await text("apps/desktop-qt/src/ServerProfileStore.h");
const desktopProfileCpp = await text("apps/desktop-qt/src/ServerProfileStore.cpp");
const nativeBrokerHeader = await text("apps/desktop-qt/src/NativeCapabilityBroker.h");
const nativeBrokerCpp = await text("apps/desktop-qt/src/NativeCapabilityBroker.cpp");
const rendererDesktop = await text("packages/renderer/src/core/desktop.ts");
const nativeServicesPanel = await text("packages/renderer/src/features/desktop/DesktopNativeServicesPanel.tsx");
const nativeBrokerDoc = await text("docs/NATIVE_CAPABILITY_BROKER.md");
const webIndex = await text("apps/web/index.html");
const webMain = await text("apps/web/src/main.tsx");
const serviceWorker = await text("apps/web/public/cluster-sw.js");
const serverEntry = await text("apps/server/src/app/cluster-server.ts");
const requestDomain = await text("apps/server/src/app/server-services-request-domain.ts");
const hostGateway = await text("apps/host-go/gateway.go");
const securityArchitecture = await text("docs/SECURITY_ARCHITECTURE.md");
const authSessionSecurity = await text("docs/AUTH_SESSION_SECURITY.md");
const authorizationArchitecture = await text("docs/AUTHORIZATION_ARCHITECTURE.md");
const uploadContentSecurity = await text("docs/UPLOAD_CONTENT_SECURITY.md");
const outboundNetworkSecurity = await text("docs/OUTBOUND_NETWORK_SECURITY.md");
const secretConfigurationSecurity = await text("docs/SECRET_CONFIGURATION_SECURITY.md");
const securityAuditTrail = await text("docs/SECURITY_AUDIT_TRAIL.md");
const apiAbuseSecurity = await text("docs/API_ABUSE_RESOURCE_SECURITY.md");
const mutationIntegritySecurity = await text("docs/MUTATION_DATA_INTEGRITY.md");
const syncIntegritySecurity = await text("docs/SYNC_INTEGRITY_SECURITY.md");
const databaseRecoverySecurity = await text("docs/DATABASE_RECOVERY_RESILIENCE.md");
const operationalHealthSecurity = await text("docs/OPERATIONAL_HEALTH_RESILIENCE.md");
const privacyPolicySecurity = await text("docs/PRIVACY_POLICY_SYSTEM.md");
const privacyPolicyCore = await text("apps/server/src/core/privacy-policy.ts");
const privacyPolicyRoutes = await text("apps/server/src/domains/legal/privacy-policy-routes.ts");
const privacyPolicyPage = await text("packages/renderer/src/features/legal/PrivacyPolicyPage.tsx");
const privacyPolicyAdmin = await text("packages/renderer/src/features/legal/PrivacyPolicyAdminPanel.tsx");
const termsPolicySecurity = await text("docs/TERMS_OF_SERVICE_SYSTEM.md");
const termsPolicyCore = await text("apps/server/src/core/terms-policy.ts");
const termsPolicyRoutes = await text("apps/server/src/domains/legal/terms-policy-routes.ts");
const termsPolicyPage = await text("packages/renderer/src/features/legal/TermsPolicyPage.tsx");
const termsPolicyAdmin = await text("packages/renderer/src/features/legal/TermsPolicyAdminPanel.tsx");
const operatorAgreementSecurity = await text("docs/SERVER_OPERATOR_AGREEMENT.md");
const operatorAgreementCore = await text("apps/server/src/core/operator-agreement.ts");
const operatorAgreementRoutes = await text("apps/server/src/domains/legal/operator-agreement-routes.ts");
const operatorAgreementPage = await text("packages/renderer/src/features/legal/OperatorAgreementPage.tsx");
const operatorAgreementAdmin = await text("packages/renderer/src/features/legal/OperatorAgreementAdminPanel.tsx");
const copyrightPolicySecurity = await text("docs/COPYRIGHT_DMCA_POLICY.md");
const copyrightPolicyCore = await text("apps/server/src/core/copyright-policy.ts");
const copyrightPolicyRoutes = await text("apps/server/src/domains/legal/copyright-policy-routes.ts");
const copyrightPolicyPage = await text("packages/renderer/src/features/legal/CopyrightPolicyPage.tsx");
const copyrightPolicyAdmin = await text("packages/renderer/src/features/legal/CopyrightPolicyAdminPanel.tsx");
const copyrightWorkflowSecurity = await text("docs/COPYRIGHT_REPORTING_WORKFLOW.md");
const copyrightWorkflowCore = await text("apps/server/src/core/copyright-workflow.ts");
const copyrightWorkflowRoutes = await text("apps/server/src/domains/legal/copyright-workflow-routes.ts");
const copyrightReportPage = await text("packages/renderer/src/features/legal/CopyrightReportPage.tsx");
const copyrightCounterPage = await text("packages/renderer/src/features/legal/CopyrightCounterNoticePage.tsx");
const copyrightWorkflowAdmin = await text("packages/renderer/src/features/legal/CopyrightWorkflowAdminPanel.tsx");
const privacyConsentSecurity = await text("docs/PRIVACY_CONSENT_STORAGE.md");
const privacyConsentCore = await text("apps/server/src/core/privacy-consent.ts");
const privacyConsentRoutes = await text("apps/server/src/domains/legal/privacy-consent-routes.ts");
const rendererPrivacyConsent = await text("packages/renderer/src/core/privacy-consent.ts");
const privacyConsentManager = await text("packages/renderer/src/features/legal/PrivacyConsentManager.tsx");
const privacyDataSecurity = await text("docs/PRIVACY_DATA_CONTROL_CENTER.md");
const privacyDataCore = await text("apps/server/src/core/privacy-data-control.ts");
const privacyDataRoutes = await text("apps/server/src/domains/legal/privacy-data-routes.ts");
const privacyDataCenter = await text("packages/renderer/src/features/legal/PrivacyDataControlCenter.tsx");
const dataRetentionSecurity = await text("docs/DATA_INVENTORY_RETENTION.md");
const dataRetentionCore = await text("apps/server/src/core/data-retention.ts");
const dataRetentionRoutes = await text("apps/server/src/domains/legal/data-retention-routes.ts");
const dataRetentionAdmin = await text("packages/renderer/src/features/legal/DataRetentionAdminPanel.tsx");
const settingsWorkspace = [
  await text("packages/renderer/src/features/settings/SettingsWorkspacePages.tsx"),
  await text("packages/renderer/src/features/settings/AccountSettingsPage.tsx"),
  await text("packages/renderer/src/features/settings/StudioSettingsPage.tsx"),
  await text("packages/renderer/src/features/settings/ServerConfigPage.tsx"),
].join("\n");
const libraryMediaPreview = await text("packages/renderer/src/features/library/LibraryMediaPreview.tsx");
const operationalHealthSource = await text("apps/server/src/core/operational-health.ts");
const healthRoutesSource = await text("apps/server/src/app/server-routes-health-operations.ts");
const filesystemBackup = await text("apps/server/src/core/filesystem-backup.ts");
const databaseRecovery = await text("apps/server/src/core/database-recovery.ts");
const backupManifest = await text("apps/server/src/core/backup-manifest.ts");
const postgresqlRuntime = await text("apps/server/src/core/postgresql-runtime.ts");
const syncSecuritySource = await text("apps/server/src/core/sync-security.ts");
const syncRoutesSource = await text("apps/server/src/domains/sync/sync-routes.ts");
const syncRepositorySource = await text("apps/server/src/domains/sync/sync-control-repository.ts");
const deltaSyncSource = await text("packages/renderer/src/core/delta-sync.ts");
const offlineStorageSource = await text("packages/renderer/src/core/offline-storage.ts");
const idempotencySource = await text("apps/server/src/core/idempotency.ts");
const storageMigrations = await text("apps/server/src/core/storage-migrations.ts");
const apiContracts = await text("packages/shared/src/api-contracts.ts");
const requestWorkload = await text("apps/server/src/core/request-workload.ts");
const rateLimitSource = await text("apps/server/src/core/rate-limit.ts");
const securityAuditIntegrity = await text("apps/server/src/core/security-audit-integrity.ts");
const securityAuditStore = await text("apps/server/src/core/security-audit-store.ts");
const securityAuditPolicy = await text("apps/server/src/core/security-audit-policy.ts");
const auditRepository = await text("apps/server/src/domains/audit/audit-repository.ts");
const auditServiceSource = await text("apps/server/src/domains/audit/audit-service.ts");
const auditRoutesSource = await text("apps/server/src/domains/audit/audit-routes.ts");
const settingCrypto = await text("apps/server/src/core/setting-crypto.ts");
const runtimeConfig = await text("apps/server/src/core/runtime-config.ts");
const operationsService = await text("apps/server/src/app/server-services-operations.ts");
const databaseBackup = await text("apps/server/src/core/database-backup.ts");
const outboundHttp = await text("apps/server/src/core/outbound-http.ts");
const settingsIntegrations = await text("apps/server/src/app/server-services-settings-integrations.ts");
const configurationIntegrations = await text("apps/server/src/app/server-routes-configuration-integrations.ts");
const uploadCore = await text("apps/server/src/core/uploads.ts");
const libraryRoutes = await text("apps/server/src/domains/library/library-routes.ts");
const projectRoutes = await text("apps/server/src/domains/projects/project-routes.ts");
const desktopTransferRoutes = await text("apps/server/src/domains/desktop/desktop-transfer-routes.ts");
const blenderPreview = await text("apps/server/src/core/blender-preview.ts");
const sharedErrorCodes = await text("packages/shared/src/error-codes.ts");
const desktopUpdateSecurity = await text("docs/DESKTOP_UPDATE_SECURITY.md");
const routePolicy = await text("apps/server/src/domains/access/route-policy.ts");
const requestAuthorizationBoundary = await text("apps/server/src/domains/access/request-authorization-boundary.ts");
const authorizationService = await text("apps/server/src/domains/access/authorization.ts");
const accessRoutes = await text("apps/server/src/domains/access/access-routes.ts");
const customFieldRoutes = await text("apps/server/src/domains/custom-fields/custom-field-routes.ts");
const calendarRoutes = await text("apps/server/src/domains/planning/calendar-routes.ts");
const timelineRoutes = await text("apps/server/src/domains/planning/timeline-routes.ts");
const timeRoutes = await text("apps/server/src/domains/time/time-routes.ts");
const cardRoutes = await text("apps/server/src/domains/cards/card-routes.ts");
const mediaAccessRoutes = await text("apps/server/src/app/server-routes-access-media.ts");
const nativeUpdateHeader = await text("apps/desktop-qt/src/NativeUpdateManager.h");
const nativeUpdateCpp = await text("apps/desktop-qt/src/NativeUpdateManager.cpp");
const updateHelper = await text("apps/update-helper-go/main.go");
const updateManifestSigner = await text("tools/scripts/release-update-manifest.mjs");
const sessionSecurity = await text("apps/server/src/core/session-security.ts");
const authCore = await text("apps/server/src/core/auth.ts");
const authRoutes = await text("apps/server/src/domains/auth/auth-core-routes.ts");
const apiClient = await text("packages/api-client/src/index.ts");
const rendererApi = await text("packages/renderer/src/core/api.ts");
const reauthHost = await text("packages/renderer/src/components/ReauthenticationHost.tsx");
const ciWorkflow = await text(".github/workflows/ci.yml");
const releaseWorkflow = await text(".github/workflows/release.yml");
const releasePreflight = await text("tools/scripts/release-preflight.mjs");
const releaseVerifier = await text("tools/scripts/release-verify-artifacts.mjs");
const desktopSmoke = await text("tools/scripts/desktop-smoke.mjs");
const testRunner = await text("tools/scripts/run-tests.mjs");
const masterPackager = await text("tools/scripts/package-cluster-master.mjs");
const mainCpp = await text("apps/desktop-qt/src/main.cpp");
const accessibilityCiScript = await text("tools/scripts/accessibility-ci.mjs");
const accessibilityStaticAudit = await text("tools/scripts/accessibility-static-audit.mjs");
const accessibilityCiLib = await text("tools/scripts/accessibility-ci-lib.mjs");
const accessibilityCiDoc = await text("docs/AUTOMATED_ACCESSIBILITY_CI.md");
const localCertification = await text("tools/scripts/release-certify-local.mjs");

check("central Cluster version", packageJson.version === manifest.cluster);
const workspaceManifests = [
  ["root", packageJson],
  ["server", serverPackage],
  ["web", JSON.parse(await text("apps/web/package.json"))],
  ["shared", JSON.parse(await text("packages/shared/package.json"))],
  ["api-client", JSON.parse(await text("packages/api-client/package.json"))],
  ["renderer", rendererPackage],
];
const rangedDependencies = [];
for (const [workspace, pkg] of workspaceManifests) {
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, value] of Object.entries(pkg[section] || {})) {
      if (name.startsWith("@cluster/") && value === "*") continue;
      if (typeof value === "string" && /^(?:[~^*]|>=?|<=?|workspace:)/.test(value)) rangedDependencies.push(`${workspace}:${section}:${name}=${value}`);
    }
  }
}
check("external direct dependencies are exactly pinned", rangedDependencies.length === 0, rangedDependencies.join(", "));
check("Node LTS pin", packageJson.engines?.node?.includes(manifest.node.version));
check("Prisma packages synchronized", serverPackage.dependencies?.["@prisma/client"] === manifest.prisma.version && serverPackage.dependencies?.["@prisma/adapter-pg"] === manifest.prisma.version && serverPackage.devDependencies?.prisma === manifest.prisma.version);
check("Prisma 7 generated client", /provider\s*=\s*"prisma-client"/.test(schema) && /output\s*=\s*"\.\.\/src\/generated\/prisma"/.test(schema));
check("Prisma datasource lives in config", !/^\s*url\s*=/m.test(schema) && /datasource:\s*\{[\s\S]*url:/.test(prismaConfig));
check("Prisma pg adapter",
  prismaClient.includes("@prisma/adapter-pg") &&
  prismaClient.includes("new PrismaPg") &&
  prismaClient.includes("DirectClientOptions") &&
  prismaClient.includes("Extract<GeneratedClientOptions, { adapter: unknown }>") &&
  prismaClient.includes("new PrismaClient(clientOptions)"));
check("Prisma direct client options exclude Accelerate union",
  !prismaClient.includes('"accelerateUrl"') &&
  prismaClient.includes('Omit<DirectClientOptions, "adapter">'));
check("renderer remains ES2020 compatible", !rendererAccessibility.includes(".at(-1)") && !rendererPerformance.includes(".at(-1)"));
check("renderer imports ColorField once", (rendererApplication.match(/import \{ ColorField \}/g) || []).length === 1);
check("typed changelog data is present", rendererChangelog.includes("./data/cluster-changelog") && changelogData.includes("ClusterChangelogRelease") && changelogData.includes(`v${manifest.cluster}`));
check("privacy policy has a dedicated versioned PostgreSQL model",
  schema.includes("model LegalPolicyVersion") &&
  schema.includes("@@unique([kind, version])") &&
  storageMigrations.includes('"LegalPolicyVersion"') &&
  storageMigrations.includes('"LegalPolicyVersion_kind_version_key"'));
check("privacy policy public route is pre-auth and read-only",
  routePolicy.includes('/api/public/legal/privacy') &&
  routePolicy.includes('normalizedMethod === "GET" || normalizedMethod === "HEAD"') &&
  privacyPolicyRoutes.includes('app.get("/api/public/legal/privacy"'));
check("privacy policy administration is central-admin protected and versioned",
  privacyPolicyRoutes.includes('app.get("/api/admin/legal/privacy"') &&
  privacyPolicyRoutes.includes('app.post("/api/admin/legal/privacy/versions"') &&
  privacyPolicyRoutes.includes('app.patch("/api/admin/legal/privacy/versions/:policyId"') &&
  privacyPolicyRoutes.includes('app.post("/api/admin/legal/privacy/versions/:policyId/publish"') &&
  privacyPolicyRoutes.includes('existing.status !== "draft"'));
check("published privacy policy content is hash-addressed and not auto-published",
  privacyPolicyCore.includes('createHash("sha256")') &&
  privacyPolicyCore.includes("starterPrivacyPolicy") &&
  privacyPolicySecurity.includes("never silently publishes a generic template") &&
  !privacyPolicyRoutes.includes('starterPrivacyPolicy(settings.studioName || "Studio").status'));
check("privacy policy renderer avoids raw HTML injection",
  privacyPolicyPage.includes("PolicyMarkdown") &&
  !privacyPolicyPage.includes("dangerouslySetInnerHTML") &&
  rendererApplication.includes("privacyPolicyPath"));
check("privacy policy has an administrator publishing surface",
  privacyPolicyAdmin.includes("Version history") &&
  privacyPolicyAdmin.includes("Publish version") &&
  privacyPolicyAdmin.includes("Published versions are immutable"));
check("privacy policy capability and roadmap boundary are documented",
  apiContracts.includes("privacy-policy-v1") &&
  apiContracts.includes("legal: 9") &&
  privacyPolicySecurity.includes("Explicit non-goals for v0.362") &&
  privacyPolicySecurity.includes("Roadmap Step 17"));
check("terms policy reuses the versioned legal store with an independent kind",
  schema.includes("model LegalPolicyVersion") &&
  termsPolicyCore.includes('TERMS_POLICY_KIND = "terms"') &&
  termsPolicyCore.includes('createHash("sha256")') &&
  termsPolicyCore.includes("starterTermsPolicy"));
check("terms public route is pre-auth read-only and admin mutations are separate",
  routePolicy.includes('/api/public/legal/terms') &&
  termsPolicyRoutes.includes('app.get("/api/public/legal/terms"') &&
  termsPolicyRoutes.includes('app.post("/api/admin/legal/terms/versions"') &&
  termsPolicyRoutes.includes('app.patch("/api/admin/legal/terms/versions/:policyId"') &&
  termsPolicyRoutes.includes('app.post("/api/admin/legal/terms/versions/:policyId/publish"'));
check("published terms are immutable and never auto-published",
  termsPolicyRoutes.includes('existing.status !== "draft"') &&
  termsPolicySecurity.includes("never silently publishes the starter document") &&
  !termsPolicyRoutes.includes('starterTermsPolicy(settings.studioName || "Studio").status'));
check("terms renderer is public and avoids raw HTML injection",
  termsPolicyPage.includes("PolicyMarkdown") &&
  !termsPolicyPage.includes("dangerouslySetInnerHTML") &&
  rendererApplication.includes("termsPolicyPath"));
check("terms have an administrator publishing surface",
  termsPolicyAdmin.includes("Version history") &&
  termsPolicyAdmin.includes("Publish version") &&
  termsPolicyAdmin.includes("Published versions are immutable"));
check("terms capability and acceptance non-goal are documented",
  apiContracts.includes("terms-policy-v1") &&
  apiContracts.includes("legal: 9") &&
  termsPolicySecurity.includes("Roadmap Step 17 is implemented in v0.378.0"));
check("operator agreement reuses the immutable legal policy store with an independent kind",
  schema.includes("model LegalPolicyVersion") &&
  operatorAgreementCore.includes('OPERATOR_AGREEMENT_KIND = "operator_agreement"') &&
  operatorAgreementCore.includes('createHash("sha256")') &&
  operatorAgreementCore.includes("starterOperatorAgreement"));
check("operator agreement public read and admin mutation boundaries are separate",
  routePolicy.includes('/api/public/legal/operator-agreement') &&
  operatorAgreementRoutes.includes('app.get("/api/public/legal/operator-agreement"') &&
  operatorAgreementRoutes.includes('app.post("/api/admin/legal/operator-agreement/versions"') &&
  operatorAgreementRoutes.includes('app.patch("/api/admin/legal/operator-agreement/versions/:policyId"') &&
  operatorAgreementRoutes.includes('app.post("/api/admin/legal/operator-agreement/versions/:policyId/publish"'));
check("published operator agreements are immutable and never auto-published",
  operatorAgreementRoutes.includes('existing.status !== "draft"') &&
  operatorAgreementSecurity.includes("starter scaffold is never automatically published") &&
  !operatorAgreementRoutes.includes('starterOperatorAgreement(settings.studioName || "Studio").status'));
check("operator agreement renderer is public and avoids raw HTML injection",
  operatorAgreementPage.includes("PolicyMarkdown") &&
  !operatorAgreementPage.includes("dangerouslySetInnerHTML") &&
  rendererApplication.includes("operatorAgreementPath"));
check("operator agreement capability and acceptance non-goal are documented",
  apiContracts.includes("server-operator-agreement-v1") &&
  apiContracts.includes("legal: 9") &&
  operatorAgreementAdmin.includes("Server Operator Agreement") &&
  operatorAgreementSecurity.includes("Roadmap Step 17 is implemented in v0.378.0"));
check("copyright policy reuses the immutable legal store with an independent kind",
  schema.includes("model LegalPolicyVersion") &&
  copyrightPolicyCore.includes('COPYRIGHT_POLICY_KIND = "copyright_dmca"') &&
  copyrightPolicyCore.includes('createHash("sha256")') &&
  copyrightPolicyCore.includes("starterCopyrightPolicy"));
check("copyright policy public route and admin mutations remain separate",
  routePolicy.includes('/api/public/legal/copyright') &&
  copyrightPolicyRoutes.includes('app.get("/api/public/legal/copyright"') &&
  copyrightPolicyRoutes.includes('app.post("/api/admin/legal/copyright/versions"') &&
  copyrightPolicyRoutes.includes('app.patch("/api/admin/legal/copyright/versions/:policyId"') &&
  copyrightPolicyRoutes.includes('app.post("/api/admin/legal/copyright/versions/:policyId/publish"'));
check("copyright policy never auto-publishes or claims DMCA qualification",
  copyrightPolicyRoutes.includes('existing.status !== "draft"') &&
  copyrightPolicySecurity.includes("never silently publishes the starter document") &&
  copyrightPolicySecurity.includes("does not claim") &&
  copyrightPolicyRoutes.includes("safeHarborEligibilityClaimed: false") &&
  copyrightPolicyRoutes.includes("reportingWorkflowImplemented: true") &&
  !copyrightPolicyRoutes.includes('starterCopyrightPolicy(settings.studioName || "Studio").status'));
check("copyright policy renderer is public and avoids raw HTML injection",
  copyrightPolicyPage.includes("PolicyMarkdown") &&
  !copyrightPolicyPage.includes("dangerouslySetInnerHTML") &&
  rendererApplication.includes("copyrightPolicyPath"));
check("copyright policy capability and reporting handoff are documented",
  apiContracts.includes("copyright-dmca-policy-v1") &&
  apiContracts.includes("legal: 9") &&
  copyrightPolicyAdmin.includes("Copyright & DMCA Policy") &&
  copyrightPolicySecurity.includes("COPYRIGHT_REPORTING_WORKFLOW.md") &&
  copyrightPolicySecurity.includes("Roadmap Step 17"));
check("copyright workflow has durable case, evidence, counter-notice, restriction, and strike records",
  schema.includes("model CopyrightCase") &&
  schema.includes("model CopyrightCounterNotice") &&
  schema.includes("model CopyrightEvidence") &&
  schema.includes("model CopyrightResourceRestriction") &&
  schema.includes("model CopyrightStrike") &&
  storageMigrations.includes('"CopyrightCase"') &&
  storageMigrations.includes('"CopyrightResourceRestriction_active_resource_key"'));
check("copyright public intake uses private hashed case tokens and bounded evidence",
  routePolicy.includes('/api/public/copyright/reports') &&
  copyrightWorkflowRoutes.includes('app.post("/api/public/copyright/reports"') &&
  copyrightWorkflowRoutes.includes('app.post("/api/public/copyright/cases/status"') &&
  copyrightWorkflowCore.includes("generateCopyrightCaseToken") &&
  copyrightWorkflowCore.includes("hashCopyrightCaseToken") &&
  copyrightWorkflowCore.includes("COPYRIGHT_EVIDENCE_MAX_FILE_BYTES") &&
  copyrightWorkflowCore.includes("isExecutablePayload"));
check("copyright takedowns are reversible server-side restrictions rather than deletion",
  copyrightWorkflowRoutes.includes('action === "disable_access"') &&
  copyrightWorkflowRoutes.includes('action === "restore_access"') &&
  copyrightWorkflowCore.includes("copyrightDisabledResponse") &&
  copyrightWorkflowCore.includes("451") &&
  serverEntry.includes("registerCopyrightWorkflowRoutes") &&
  (await text("apps/server/src/app/server-routes-media-whiteboards.ts")).includes("isCopyrightResourceDisabled") &&
  (await text("apps/server/src/domains/library/library-routes.ts")).includes("isCopyrightResourceDisabled") &&
  (await text("apps/server/src/app/server-routes-access-media.ts")).includes("copyrightResourceRestriction") &&
  (await text("apps/server/src/app/server-routes-access-media.ts")).includes('state: "disabled"'));
check("counter-notice workflow tracks 10-14 business-day restoration and legal holds",
  copyrightWorkflowCore.includes("addBusinessDays") &&
  copyrightWorkflowRoutes.includes("restorationEligibleAt") &&
  copyrightWorkflowRoutes.includes("restorationDeadlineAt") &&
  copyrightWorkflowRoutes.includes('action === "record_legal_action"') &&
  copyrightWorkflowRoutes.includes("COPYRIGHT_RESTORE_TOO_EARLY"));
check("copyright workflow has public, uploader, and administrator surfaces",
  copyrightReportPage.includes("Report copyright infringement") &&
  copyrightCounterPage.includes("Submit a counter-notice") &&
  copyrightWorkflowAdmin.includes("Copyright reporting workflow") &&
  settingsWorkspace.includes("LegalComplianceCenter") &&
  rendererApplication.includes("copyrightReportPath") &&
  rendererApplication.includes("copyrightCounterPath"));
check("copyright workflow capability and non-automatic legal boundaries are documented",
  apiContracts.includes("copyright-reporting-workflow-v1") &&
  apiContracts.includes("legal: 9") &&
  copyrightWorkflowSecurity.includes("does not automatically terminate accounts") &&
  copyrightWorkflowSecurity.includes("does not automatically restore at day 14") &&
  (masterPackager.match(/docs\/COPYRIGHT_REPORTING_WORKFLOW\.md/g) || []).length >= 2);

check("privacy consent has a dedicated per-user PostgreSQL preference record",
  schema.includes("model PrivacyConsentPreference") &&
  schema.includes("userId          String   @unique") &&
  storageMigrations.includes('"PrivacyConsentPreference"') &&
  storageMigrations.includes('"PrivacyConsentPreference_userId_key"'));
check("privacy consent inventory is public and analytics-free by default",
  privacyConsentCore.includes("PRIVACY_CONSENT_INVENTORY") &&
  privacyConsentCore.includes("analyticsProviders: []") &&
  privacyConsentCore.includes('available: false') &&
  routePolicy.includes('/api/public/privacy/consent-config') &&
  privacyConsentRoutes.includes('app.get("/api/public/privacy/consent-config"'));
check("authenticated consent choices are version-bound and server persisted",
  privacyConsentRoutes.includes('app.get("/api/privacy/consent"') &&
  privacyConsentRoutes.includes('app.put("/api/privacy/consent"') &&
  privacyConsentRoutes.includes("PRIVACY_CONSENT_NOTICE_STALE") &&
  privacyConsentRoutes.includes("privacyConsentPreference.upsert"));
check("optional preference storage is consent-aware and purge-scoped",
  rendererPrivacyConsent.includes("preferenceStorageAllowed") &&
  rendererPrivacyConsent.includes("OPTIONAL_PREFERENCE_PATTERNS") &&
  rendererPrivacyConsent.includes("clearOptionalPreferenceStorage") &&
  !rendererPrivacyConsent.includes("localStorage.clear("));
check("external embeds are blocked until external-content consent",
  libraryMediaPreview.includes("externalContentAllowed") &&
  libraryMediaPreview.includes("External preview blocked") &&
  libraryMediaPreview.includes("PRIVACY_CONSENT_CHANGED_EVENT") &&
  libraryMediaPreview.includes("www.youtube") === false);
check("privacy consent presents reject, customize, and accept controls",
  privacyConsentManager.includes("Reject optional") &&
  privacyConsentManager.includes("Customize") &&
  privacyConsentManager.includes("Accept optional") &&
  privacyConsentManager.includes("!category.available"));
check("privacy consent boundary is documented and packaged",
  apiContracts.includes("privacy-consent-v1") &&
  privacyConsentSecurity.includes("does not load third-party behavioral analytics SDKs") &&
  (masterPackager.match(/docs\/PRIVACY_CONSENT_STORAGE\.md/g) || []).length >= 2);

check("privacy data controls are account-scoped and bounded",
  privacyDataRoutes.includes('app.get("/api/privacy/data-summary"') &&
  privacyDataRoutes.includes('app.post("/api/privacy/data-export"') &&
  privacyDataRoutes.includes('getUserOr401(getCurrentUser') &&
  privacyDataCore.includes('PRIVACY_EXPORT_MAX_RECORDS_PER_CATEGORY = 2500') &&
  privacyDataCore.includes('passwordConfigured') &&
  !privacyDataCore.includes('snapshot.passwordHash'));
check("privacy deletion is request-based rather than an automatic cascade",
  schema.includes("model PrivacyDataRequest") &&
  storageMigrations.includes('"PrivacyDataRequest"') &&
  privacyDataRoutes.includes('requestType: z.literal("deletion")') &&
  privacyDataRoutes.includes('automaticDeletion: false') &&
  privacyDataRoutes.includes('PRIVACY_DATA_REQUEST_EXISTS'));
check("privacy-sensitive export and identity actions require recent authentication",
  sessionSecurity.includes('/api/privacy/data-export') &&
  sessionSecurity.includes('/api/privacy/data-requests') &&
  sessionSecurity.includes('/api/privacy/integrations/discord') &&
  privacyDataRoutes.includes('"DISCONNECT DISCORD"') &&
  privacyDataRoutes.includes('revocationReason: "discord_link_self_cleared"'));
check("privacy control center exposes inventory export identity and deletion request surfaces",
  privacyDataCenter.includes("Download my data") &&
  privacyDataCenter.includes("Data associated with this account") &&
  privacyDataCenter.includes("Disconnect Discord") &&
  privacyDataCenter.includes("Request account-data deletion") &&
  settingsWorkspace.includes("<PrivacyDataControlCenter currentUser={currentUser} />"));
check("privacy self-service boundary is documented and packaged",
  privacyDataSecurity.includes("does not determine which privacy law applies") &&
  securityArchitecture.includes("Privacy self-service data boundary") &&
  (masterPackager.match(/docs\/PRIVACY_DATA_CONTROL_CENTER\.md/g) || []).length >= 2);
check("server advertises privacy data control capability", apiContracts.includes('privacy-data-controls-v1'));
check("data retention uses dedicated policy and run records",
  schema.includes("model DataRetentionPolicy") &&
  schema.includes("model DataRetentionRun") &&
  storageMigrations.includes('"DataRetentionPolicy"') &&
  storageMigrations.includes('"DataRetentionRun"'));
check("retention engine excludes protected evidence and authoritative work",
  dataRetentionCore.includes('security_audit_events') &&
  dataRetentionCore.includes('legal_policy_versions') &&
  dataRetentionCore.includes('privacy_requests') &&
  dataRetentionCore.includes('core_work_records') &&
  dataRetentionCore.includes('authoritative_uploads') &&
  !dataRetentionCore.includes('prisma.securityAuditEvent.deleteMany'));
check("retention has admin dry-run policy and destructive apply surfaces",
  dataRetentionRoutes.includes('app.get("/api/admin/privacy/data-inventory"') &&
  dataRetentionRoutes.includes('app.get("/api/admin/privacy/retention-preview"') &&
  dataRetentionRoutes.includes('app.put("/api/admin/privacy/retention-policies"') &&
  dataRetentionRoutes.includes('app.post("/api/admin/privacy/retention-apply"') &&
  dataRetentionRoutes.includes('"APPLY DATA RETENTION"'));
check("retention apply is transactional and security audited",
  dataRetentionCore.includes('prisma.$transaction(operations)') &&
  dataRetentionRoutes.includes('privacy.data_retention_applied') &&
  dataRetentionRoutes.includes('privacy.retention_policy_updated'));
check("sync tombstone cleanup is centralized under retention policy",
  dataRetentionCore.includes('sync_tombstones') &&
  !syncRoutesSource.includes('lastTombstoneCleanupAt') &&
  !syncRoutesSource.includes('syncTombstone.deleteMany'));
check("studio settings expose dry-run retention controls",
  dataRetentionAdmin.includes('Refresh dry run') &&
  dataRetentionAdmin.includes('Apply current retention') &&
  dataRetentionAdmin.includes('Protected / manual data') &&
  settingsWorkspace.includes('LegalComplianceCenter'));
check("retention boundary is documented and packaged",
  apiContracts.includes('data-retention-v1') &&
  apiContracts.includes('privacy: 6') &&
  dataRetentionSecurity.includes('SecurityAuditEvent') &&
  (masterPackager.match(/docs\/DATA_INVENTORY_RETENTION\.md/g) || []).length >= 2);

check("secure sessions use host-only cookie naming and shorter defaults",
  requestDomain.includes('sameSite: "strict"') &&
  requestDomain.includes("httpOnly: true") &&
  (await text("apps/server/src/core/runtime-config.ts")).includes('__Host-cluster_session') &&
  (await text("apps/server/src/core/runtime-config.ts")).includes("configuredSessionDays === 30 ? 7") &&
  (await text("apps/server/src/core/runtime-config.ts")).includes("configuredSessionIdleHours === 168 ? 12"));
check("authenticated unsafe requests have session-bound CSRF",
  sessionSecurity.includes("csrfProtectionRequired") &&
  requestDomain.includes('createHmac("sha256"') &&
  requestDomain.includes("timingSafeEqual") &&
  serverEntry.includes("X-Cluster-CSRF-Invalid") &&
  apiClient.includes("X-Cluster-CSRF") &&
  apiClient.includes("fetchCsrfToken"));
check("high-risk actions require session-rotating reauthentication",
  sessionSecurity.includes("recentAuthenticationRequired") &&
  authCore.includes("REAUTH_WINDOW_MS = 10 * 60 * 1000") &&
  authRoutes.includes('/api/auth/reauth') &&
  authRoutes.includes('revocationReason: "reauthenticated"') &&
  rendererApi.includes("requestReauthentication") &&
  reauthHost.includes('autoComplete="current-password"'));
check("login abuse controls persist and escalate",
  authCore.includes("LOGIN_FAILURE_DECAY_MS = 24 * 60 * 60 * 1000") &&
  authCore.includes("loginLockDurationMs") &&
  authRoutes.includes("lastFailedLoginAt") &&
  authRoutes.includes("auth-account-ip:"));
check("native sign-out participates in CSRF without copying cookies",
  desktopSharedRendererQml.includes("/api/auth/csrf") &&
  desktopSharedRendererQml.includes("X-Cluster-CSRF") &&
  desktopSharedRendererQml.includes("credentials:'include'"));
check("auth/session hardening is documented", authSessionSecurity.includes("HMAC-bound CSRF") && authSessionSecurity.includes("Recent authentication"));
check("recent session revocation evidence survives authentication",
  !requestDomain.includes('revokedAt: { not: null }') &&
  dataRetentionCore.includes('revokedAt: { lt: cutoffAt }') &&
  dataRetentionCore.includes('expiresAt: { lt: cutoffAt }'));
check("public API exemptions are method-aware and unsafe public requests stay protected",
  routePolicy.includes('export function isPublicPath(pathname: string, method = "GET")') &&
  routePolicy.includes('path.startsWith("/api/public/share/")') &&
  !routePolicy.includes('if (path.startsWith("/api/public/")) return true') &&
  !sessionSecurity.includes('pathname.startsWith("/api/public/")') &&
  !(await text("apps/server/src/core/security.ts")).includes('pathname.startsWith("/api/public/")'));
check("central request authorization runs before protected handlers",
  requestDomain.includes("createRequestAuthorizationBoundary") &&
  serverEntry.includes("authorizeRequestBoundary(request, reply)") &&
  requestAuthorizationBoundary.includes("routeMinimumLevel(pathname, method)") &&
  requestAuthorizationBoundary.includes('pathname.startsWith("/api/admin/")') &&
  requestAuthorizationBoundary.includes('pathname.startsWith("/api/context-packs")'));
check("route authorization follows resource capabilities instead of navigation aliases",
  routePolicy.includes('return "builds"') &&
  routePolicy.includes('return "qa"') &&
  routePolicy.includes('path.startsWith("/api/tickets")') &&
  routePolicy.includes('return "serverConfig"'));
check("resource authorization is capability-capped and projectless access fails closed",
  authorizationService.includes("let toolCap = tool ? toolLevelAsProjectLevel") &&
  authorizationService.includes("const resourceBase = project ? getProjectPermissionLevel(user, role, project) : toolCap") &&
  authorizationService.includes("const effective = lowerAccessLevel(resourceLevel, toolCap)") &&
  authorizationService.includes("requestCanUserScope") &&
  !authorizationService.includes('project ? getProjectPermissionLevel(user, role, project) : "view"'));
check("ticket aliases retain Tickets authorization",
  authorizationService.includes('String(project?.source || "").toLowerCase() === "system-tickets"') &&
  authorizationService.includes('getToolPermissionLevel(user, role, "tickets")') &&
  authorizationService.includes('labels.includes("ticket")') &&
  cardRoutes.includes('authorization.requireTool(request, reply, "tickets", "edit")') &&
  requestAuthorizationBoundary.includes('authorization.requireCard(request, reply, item.card.id, minimum)'));
check("access rules authorize the authoritative target",
  accessRoutes.includes("async function resolveTarget") &&
  accessRoutes.includes("projectIdHint && resolved.project?.id !== projectIdHint") &&
  accessRoutes.includes('authorization.requireTarget(request, reply, targetKind, targetId, resolved.project, "manage")'));
check("project share links are parent-bound",
  mediaAccessRoutes.includes("where: { id: params.linkId, projectId: params.projectId }") &&
  !mediaAccessRoutes.includes("update({ where: { id: params.linkId }, data"));
check("custom fields resolve canonical resource parents",
  customFieldRoutes.includes("resolveEntityContext") &&
  customFieldRoutes.includes("A client-supplied projectId is only a consistency") &&
  customFieldRoutes.includes("const canonicalProjectId = context.project?.id || null") &&
  customFieldRoutes.includes('if (entity === "file") return "files"') &&
  customFieldRoutes.includes('if (entity === "user") return "team"'));
check("calendar and timeline collections filter object-level visibility",
  calendarRoutes.includes("canViewEvent") &&
  calendarRoutes.includes("canViewCard") &&
  timelineRoutes.includes("canViewTimelineItem") &&
  timelineRoutes.includes("canViewScheduleBlock") &&
  timelineRoutes.includes("canViewTimeEntry"));
check("scheduler resolves references and filters project-scoped aggregates",
  timeRoutes.includes("requireTimeReferences") &&
  timeRoutes.includes('code: "PARENT_MISMATCH"') &&
  timeRoutes.includes("filterVisibleTimeEntries") &&
  timeRoutes.includes("filterVisibleScheduleBlocks") &&
  timeRoutes.includes('authorization.requireCard(request, reply, card.id, "view")') &&
  timeRoutes.includes('authorization.requireTarget(request, reply, targetKind, targetId, project, "contribute")'));
check("authorization boundary is documented as server authoritative",
  authorizationArchitecture.includes("Renderer visibility, disabled buttons, navigation guards, and native-shell state are usability controls only") &&
  authorizationArchitecture.includes("Authoritative target resolution") &&
  authorizationArchitecture.includes("Alias and secondary-route enforcement") &&
  securityArchitecture.includes("Central authorization boundary"));
check("upload decoding and MIME identity are server-derived and bounded",
  uploadCore.includes("maximumDecodedBytes") &&
  uploadCore.includes("resolvedUploadMime") &&
  uploadCore.includes("WINDOWS_RESERVED_BASENAMES") &&
  requestDomain.includes("decodeDataUrl(dataUrl, maxBytes)") &&
  requestDomain.includes("UPLOAD_PATH_INVALID") &&
  requestDomain.includes("resolvedUploadMime(buffer, originalName, requestedMime)") &&
  (requestDomain.match(/EXECUTABLE_UPLOAD_DISABLED/g) || []).length >= 2);
check("active same-origin upload content is never blindly inline",
  uploadCore.includes("ACTIVE_CONTENT_MIME_TYPES") &&
  uploadCore.includes("uploadContentDisposition") &&
  uploadCore.includes('"X-Content-Type-Options": "nosniff"') &&
  uploadCore.includes('"Content-Security-Policy"') &&
  libraryRoutes.includes("uploadContentDisposition(contentType, item.originalName || item.title, true)") &&
  (await text("apps/server/src/app/server-routes-media-whiteboards.ts")).includes("uploadContentDisposition(contentType, asset.originalName, true)"));
check("model thumbnail bytes must match declared raster type",
  libraryRoutes.includes("detectedMimeType(bytes)") &&
  libraryRoutes.includes("detected !== declared") &&
  libraryRoutes.includes('new Set(["image/webp", "image/png", "image/jpeg"])'));
check("desktop transfer staging is capacity and integrity bounded",
  desktopTransferRoutes.includes("MAX_UPLOAD_SESSIONS_PER_USER = 8") &&
  desktopTransferRoutes.includes("MAX_RESERVED_UPLOAD_BYTES_PER_USER = 40 * 1024 * 1024 * 1024") &&
  desktopTransferRoutes.includes("MIN_FREE_SPACE_RESERVE_BYTES = 512 * 1024 * 1024") &&
  desktopTransferRoutes.includes("statfs(uploadRoot(layout))") &&
  desktopTransferRoutes.includes("DESKTOP_UPLOAD_STATE_INVALID") &&
  desktopTransferRoutes.includes("resolvedUploadMime(header, body.originalName, body.mimeType)") &&
  desktopTransferRoutes.includes("await sha256File(sourcePath) !== resolved.metadata.checksumSha256") &&
  desktopTransferRoutes.includes("rm(uploadDirectory(dataLayout, body.uploadId)"));
check("model preview conversion has hard runtime byte ceilings",
  blenderPreview.includes("MAX_MODEL_PREVIEW_SOURCE_BYTES = 512 * 1024 * 1024") &&
  blenderPreview.includes("MAX_MODEL_PREVIEW_COMPANION_BYTES = 512 * 1024 * 1024") &&
  blenderPreview.includes("MAX_MODEL_PREVIEW_OUTPUT_BYTES = 512 * 1024 * 1024"));
check("upload errors and boundary are documented",
  sharedErrorCodes.includes("UPLOAD_INVALID_PAYLOAD") &&
  sharedErrorCodes.includes("UPLOAD_TYPE_NOT_ALLOWED") &&
  sharedErrorCodes.includes("UPLOAD_CAPACITY_EXCEEDED") &&
  uploadContentSecurity.includes("Cluster does not claim to provide antivirus") &&
  securityArchitecture.includes("Upload and untrusted-content boundary"));
check("outbound HTTP is DNS-pinned, bounded, and redirect-safe",
  outboundHttp.includes("dns.lookup") &&
  outboundHttp.includes("lookup: (_hostname, _options, callback)") &&
  outboundHttp.includes("cross-origin redirect was blocked") &&
  outboundHttp.includes("maxResponseBytes") &&
  outboundHttp.includes("allowHttpPrivateNetwork") &&
  !requestDomain.includes("return await fetch(url"));
check("outbound integrations use narrow network policies",
  settingsIntegrations.includes('purpose: "Discord webhook"') &&
  settingsIntegrations.includes('allowedHosts: ["discord.com", "discordapp.com"]') &&
  settingsIntegrations.includes('purpose: "Git integration"') &&
  settingsIntegrations.includes("giteaAllowPrivateNetwork") &&
  configurationIntegrations.includes("APPLY INSECURE CONFIG"));
check("outbound network boundary is documented",
  outboundNetworkSecurity.includes("DNS rebinding") &&
  outboundNetworkSecurity.includes("Link-local and metadata-style ranges are always blocked") &&
  securityArchitecture.includes("Outbound network and integration boundary"));
check("request workload is cost-aware and body-bounded",
  requestWorkload.includes("requestWorkPolicy") &&
  requestWorkload.includes("base64EnvelopeLimit") &&
  requestWorkload.includes("boundedPayloadStream") &&
  requestWorkload.includes("BODY_TOO_LARGE") &&
  rateLimitSource.includes("consumeCost") &&
  serverEntry.includes("X-Cluster-Request-Cost") &&
  serverEntry.includes("boundedPayloadStream(payload, policy.bodyLimitBytes)"));
check("expensive API work is concurrency-bounded with backpressure",
  requestWorkload.includes("ConcurrentWorkLimiter") &&
  requestWorkload.includes("heavyGlobal: 12") &&
  requestWorkload.includes("criticalGlobal: 2") &&
  serverEntry.includes("concurrentWorkLimiter.acquire") &&
  serverEntry.includes("X-Cluster-Backpressure") &&
  serverEntry.includes('securityTelemetry.record("request.backpressure", "FAILURE")') &&
  serverEntry.includes("requestWorkReleases") &&
  apiAbuseSecurity.includes("chunked requests cannot bypass") &&
  securityArchitecture.includes("resource-exhaustion"));
check("mutation idempotency uses durable pre-execution claims",
  schema.includes("model ApiMutationReceipt") &&
  schema.includes("@@unique([userId, method, path, idempotencyKey])") &&
  idempotencySource.includes("apiMutationReceipt.create") &&
  idempotencySource.includes('state: "processing"') &&
  idempotencySource.includes('String((error as { code?: unknown }).code || "") === "P2002"') &&
  idempotencySource.includes("IDEMPOTENCY_IN_PROGRESS") &&
  idempotencySource.includes("IDEMPOTENCY_RESULT_UNKNOWN") &&
  idempotencySource.includes('state: "uncertain"') &&
  storageMigrations.includes("ApiMutationReceipt_userId_method_path_idempotencyKey_key"));
check("official clients preserve mutation identity across offline ambiguity",
  apiClient.includes('idempotency: "X-Cluster-Idempotency-Key"') &&
  apiClient.includes("needsIdempotency(pathname, method)") &&
  rendererApi.includes("mutationIdempotencyKey(headers)") &&
  rendererApi.includes("idempotencyKey,") &&
  rendererApi.includes('headers.set("X-Cluster-Idempotency-Key", item.idempotencyKey)'));
check("collaborative mutations use compare-and-swap revisions",
  timelineRoutes.includes("timelineItem.updateMany") &&
  libraryRoutes.includes("knowledgeItem.updateMany") &&
  libraryRoutes.includes("data.revision = { increment: 1 }") &&
  projectRoutes.includes("project.updateMany") &&
  (await text("apps/server/src/app/server-routes-media-whiteboards.ts")).includes("whiteboard.deleteMany") &&
  sharedErrorCodes.includes("IDEMPOTENCY_RESULT_UNKNOWN"));
check("mutation integrity is advertised and documented without exactly-once overclaim",
  apiContracts.includes('"mutation-integrity-v2"') &&
  apiContracts.includes('mutationIdempotency: "durable-preclaim"') &&
  mutationIntegritySecurity.includes("does not claim global exactly-once delivery") &&
  mutationIntegritySecurity.includes("same database transaction"));
check("sync cursors are signed and authorization-scope-bound",
  syncSecuritySource.includes('createHmac("sha256"') &&
  syncSecuritySource.includes("timingSafeEqual") &&
  syncSecuritySource.includes('resetReason: "scope_changed"') &&
  syncRoutesSource.includes('decodeSyncCursor<DeltaCursor>(query.since, "core"') &&
  libraryRoutes.includes('decodeSyncCursor<{ at: string; id: string }>(query.since, "library"') &&
  apiContracts.includes('"sync-integrity-v2"'));
check("sync delta feeds reuse server authorization and preserve authorized paging",
  syncRoutesSource.includes('hasTargetAccess(user, role, "board"') &&
  syncRoutesSource.includes('hasToolPermission(user, role, "tickets", "view")') &&
  syncRoutesSource.includes("authorizedStreamPage") &&
  libraryRoutes.includes("visibleOverflow ? visible.at(-1) : candidates.at(-1)") &&
  !syncRoutesSource.includes("workspaceMemberships.includes"));
check("offline replay is canonical, secret-filtered, and delegates idempotency",
  syncRoutesSource.includes("canonicalSyncMutationPath") &&
  syncRoutesSource.includes("containsSensitiveSyncValue") &&
  syncRoutesSource.includes("sanitizeSyncHeaders") &&
  !syncRoutesSource.includes("await syncControl.receipt(") &&
  syncIntegritySecurity.includes("ApiMutationReceipt"));
check("sync control state is PostgreSQL-native and device identities are account scoped",
  syncRepositorySource.includes("clusterSyncDevice.upsert") &&
  syncRepositorySource.includes("ownershipConflict: true") &&
  !syncRepositorySource.includes("INSERT OR IGNORE") &&
  !syncRepositorySource.includes("CREATE TABLE IF NOT EXISTS") &&
  !syncRepositorySource.includes("$queryRawUnsafe") &&
  rendererApi.includes("`${SYNC_DEVICE_ID_KEY}:${scope}`") &&
  deltaSyncSource.includes("resetSyncDeviceId"));
check("authorization scope reset purges read caches without deleting outbox work",
  deltaSyncSource.includes('response.resetReason === "scope_changed"') &&
  deltaSyncSource.includes("invalidateApiQueries()") &&
  deltaSyncSource.includes("clearOfflineReadScope()") &&
  offlineStorageSource.includes("export async function clearOfflineReadScope") &&
  !offlineStorageSource.slice(offlineStorageSource.indexOf("export async function clearOfflineReadScope"), offlineStorageSource.indexOf("export async function clearOfflineScope")).includes("removeOfflineMutation") &&
  syncIntegritySecurity.includes("Pending mutations and pending uploads are deliberately preserved"));
check("backup generations include database and authoritative filesystem recovery assets",
  operationsService.includes("schemaVersion: 2") &&
  operationsService.includes("generationId: fileBase") &&
  operationsService.includes(".uploads.tar") &&
  operationsService.includes(".branding.tar") &&
  operationsService.includes("createFilesystemBackup") &&
  operationsService.includes("fileName: path.basename"));
check("backup manifests are signed, portable, and key-rotation aware",
  backupManifest.includes('signWithClusterSecret("backup-manifest-v2"') &&
  backupManifest.includes("canonicalBackupManifest") &&
  backupManifest.includes('verifyClusterSecretSignature("backup-manifest-v2"') &&
  operationsService.includes("verifyBackupManifestSignature") &&
  operationsService.includes("resolveManifestArtifact"));
check("restore drill performs isolated PostgreSQL and filesystem recovery",
  databaseRecovery.includes("CREATE DATABASE") &&
  databaseRecovery.includes('command("pg_restore"') &&
  databaseRecovery.includes("DROP DATABASE IF EXISTS") &&
  operationsService.includes("runDatabaseRestoreDrill") &&
  operationsService.includes("drillFilesystemRestore"));
check("server refuses read-only PostgreSQL recovery replicas",
  postgresqlRuntime.includes("pg_is_in_recovery()") &&
  postgresqlRuntime.includes("requires a writable PostgreSQL primary"));
check("backup scheduling uses configured timezone and committed manifests",
  operationsService.includes("Intl.DateTimeFormat") &&
  operationsService.includes("backupTimezone") &&
  operationsService.includes("backupAlreadyExistsForWindow") &&
  operationsService.includes('name.endsWith(".json")') &&
  operationsService.includes("protectedManifests = new Set(manifests.slice(0, 3))"));
check("filesystem recovery archives reject unsafe links and restore traversal",
  filesystemBackup.includes("isSymbolicLink()") &&
  filesystemBackup.includes("tar header checksum mismatch") &&
  filesystemBackup.includes("destination.startsWith") &&
  filesystemBackup.includes("Filesystem restore path escaped"));
check("backup recovery v2 is advertised and documents recovery limits",
  apiContracts.includes('"backup-recovery-v2"') &&
  databaseRecoverySecurity.includes("WAL/PITR") &&
  databaseRecoverySecurity.includes("off-host") &&
  securityArchitecture.includes("Database recovery and backup resilience boundary"));
check("database recovery documentation ships in server and desktop kits",
  (masterPackager.match(/docs\/DATABASE_RECOVERY_RESILIENCE\.md/g) || []).length >= 2);

check("web sidebar is persistently collapsible",
  rendererApplication.includes("cluster.sidebar.collapsed") &&
  rendererApplication.includes("sidebar-collapse-toggle") &&
  rendererApplication.includes("--cluster-sidebar-current-width") &&
  rendererParity.includes('--cluster-sidebar-collapsed: 76px') &&
  rendererParity.includes('data-sidebar-collapsed="true"'));
check("web parity shell styling remains before the canonical shared primitive layer",
  styles.includes('@import "./styles/parity-v344.css";') &&
  styles.trimEnd().endsWith('@import "./styles/design-system/production-ui.css";') &&
  styles.indexOf('@import "./styles/design-system/phase-k-polish.css";') < styles.indexOf('@import "./styles/design-system/production-ui.css";') &&
  styles.indexOf('@import "./styles/parity-v344.css";') < styles.indexOf('@import "./styles/design-system/primitives.css";') &&
  styles.indexOf('@import "./styles/design-system/primitives.css";') < styles.indexOf('@import "./styles/design-system/phase-a-polish.css";') &&
  rendererParity.includes("sidebar-icon-slot-v344") &&
  rendererParity.includes("taskbar-unified-v3430"));
check("web taskbar uses maintained SVG icons", rendererApplication.includes('<ClusterIcon name="work" className="taskbar-svg-icon-v227"') && !rendererApplication.includes('<span className="taskbar-icon-v073">◆</span>'));
check("desktop uses shared web renderer",
  cmake.includes("Qt6::WebView") &&
  desktopSetupScript.includes('"WebView"') &&
  desktopMainQml.includes("sharedRendererPage") &&
  desktopSharedRendererQml.includes("import QtWebView") &&
  desktopSharedRendererQml.includes("clusterDesktop=1"));
check("desktop no longer routes normal states through duplicate QML workspace",
  !desktopMainQml.includes('clusterApp.state === "workspace" ? workspacePage') &&
  !desktopMainQml.includes('clusterApp.state === "setup" ? setupPage') &&
  !desktopMainQml.includes('clusterApp.state === "auth" ? authPage'));
check("desktop integration does not double-poll workspace",
  !desktopIntegrationCpp.includes("120'000") &&
  desktopIntegrationCpp.includes("reloadSharedRenderer") &&
  desktopAppSettingsQml.includes("App settings") &&
  !desktopAppSettingsQml.includes("Studio defaults"));
check("desktop history controls are wired",
  rendererApplication.includes("desktop-history-controls-v344") &&
  rendererApplication.includes("event.button === 3") &&
  rendererApplication.includes("event.button === 4"));
check("native shell copy is product-neutral", !/native desktop|native client|Qt Quick native preview/i.test(desktopSharedRendererQml + desktopServerQml));
check("desktop isolates each server in a WebView2 data container",
  desktopProfileCpp.includes("WEBVIEW2_USER_DATA_FOLDER") &&
  desktopProfileCpp.includes("profileIdForUrl") &&
  desktopProfileCpp.includes("QCryptographicHash::Sha256") &&
  desktopProfileCpp.includes("validProfileId") &&
  desktopProfileCpp.includes("WebView2") &&
  desktopAppSettingsQml.includes("Server profiles"));
check("desktop profile registry stores no authentication secrets",
  desktopProfileCpp.includes("profiles.json") &&
  !/passwordHash|sessionToken|bearerToken|authorizationToken/.test(desktopProfileCpp));
check("desktop WebView is same-origin and file-isolated",
  desktopSharedRendererQml.includes("settings.allowFileAccess = false") &&
  desktopSharedRendererQml.includes("settings.localContentCanAccessFileUrls = false") &&
  desktopSharedRendererQml.includes("isAllowedRendererUrl") &&
  desktopSharedRendererQml.includes("openExternalUrl"));
check("desktop remote server transport is secure by default",
  desktopProfileCpp.includes("Remote Cluster servers must use HTTPS") &&
  desktopProfileCpp.includes("CLUSTER_DESKTOP_ALLOW_INSECURE_HTTP") &&
  appControllerCpp.includes("ServerProfileStore::normalizeServerUrl"));
check("desktop renderer state bridge is pull-only and non-secret",
  desktopSharedRendererQml.includes('JSON.stringify(window.__clusterDesktopState || null)') &&
  desktopSharedRendererQml.includes("updateRendererStateJson") &&
  desktopSharedRendererQml.includes("result.length <= 4096") &&
  appControllerCpp.includes("void AppController::updateRendererStateJson") &&
  appControllerCpp.includes('object.value(QStringLiteral("schema")).toInt(-1) != 2') &&
  appControllerCpp.includes("updateRendererIdentity") &&
  appControllerCpp.includes("std::clamp") &&
  rendererApplication.includes("window.__clusterDesktopState =") &&
  rendererApplication.includes("unreadNotifications") &&
  rendererApplication.includes("serverLabel") &&
  rendererApplication.includes("userLabel") &&
  !desktopSharedRendererQml.includes("sessionToken") &&
  !desktopSharedRendererQml.includes("authorizationToken"));
check("desktop server profiles are first-class and recoverable",
  desktopProfilesQml.includes("Add a Cluster server") &&
  desktopProfilesQml.includes("Reset local data") &&
  desktopProfilesQml.includes("Sign out") &&
  desktopProfilesQml.includes("Forget server") &&
  desktopMainQml.includes("Ctrl+Shift+S") &&
  desktopProfileCpp.includes("RegistrySchemaVersion = 4") &&
  desktopProfileCpp.includes("recordRendererLoadSucceeded") &&
  desktopProfileCpp.includes("recordRendererLoadFailed") &&
  desktopProfileCpp.includes("recoveryRequired") &&
  desktopProfileCpp.includes("profile-sessions") &&
  desktopIntegrationCpp.includes("Manage servers") &&
  desktopIntegrationCpp.includes("rebuildServerMenu"));
check("desktop profile sign-out keeps HttpOnly auth inside WebView",
  desktopSharedRendererQml.includes("/api/auth/logout") &&
  desktopSharedRendererQml.includes("credentials:'include'") &&
  desktopSharedRendererQml.includes("completeSignOut") &&
  desktopProfileCpp.includes("pendingClear") &&
  !desktopProfileCpp.includes("cookieValue") &&
  !desktopProfileCpp.includes("Authorization:"));
check("desktop shared renderer owns browser auth while native services use bounded session handoff",
  appControllerCpp.includes('QStringLiteral("desktopSessionRedeem")') &&
  appControllerCpp.includes('QStringLiteral("/api/auth/desktop-session-redeem")') &&
  appControllerCpp.includes('QStringLiteral("workspace")') &&
  !appControllerCpp.includes("cookieValue"));
check("native capability broker is origin-bound and allowlisted",
  nativeBrokerHeader.includes("processRequestJson") &&
  nativeBrokerCpp.includes("isAllowedRendererUrl(rendererUrl)") &&
  nativeBrokerCpp.includes("CAPABILITY_DENIED") &&
  nativeBrokerCpp.includes("MaxRequestBytes = 16 * 1024") &&
  nativeBrokerCpp.includes("MaxDialogsPerMinute") &&
  nativeBrokerCpp.includes("MaxNotificationsPerMinute"));
check("native local access uses opaque profile-scoped handles",
  nativeBrokerCpp.includes('QStringLiteral("fh-%1")') &&
  nativeBrokerCpp.includes("HandleLifetimeMs = 30 * 60 * 1000") &&
  nativeBrokerCpp.includes("activeProfileId()") &&
  nativeBrokerCpp.includes("rawFilesystemPathsExposed") &&
  !nativeBrokerCpp.includes('payload.value(QStringLiteral("command"))'));
check("renderer capability transport is bounded",
  desktopSharedRendererQml.includes("__clusterNativeRequests") &&
  desktopSharedRendererQml.includes("processRequestJson(requestJson, String(webView.url") &&
  desktopSharedRendererQml.includes("__clusterNativeDeliver") &&
  rendererDesktop.includes("requestNativeCapability") &&
  rendererDesktop.includes("cluster-handle:") &&
  rendererDesktop.includes("Native capability queue is busy"));
check("active native services UI exposes no command/credential/capture surface",
  !/credential vault|Desktop Agent|runDesktopAgentJob|Record bug clip/i.test(nativeServicesPanel) &&
  nativeServicesPanel.includes("no raw paths"));
check("native capability protocol is documented",
  nativeBrokerDoc.includes("Explicitly absent") &&
  securityArchitecture.includes("Native capability broker"));
check("web entry is compatible with strict script CSP",
  !/<script(?![^>]*\bsrc=)[^>]*>/i.test(webIndex) &&
  webMain.includes("applyInitialTheme") &&
  hostGateway.includes("script-src 'self'"));
check("service worker excludes authenticated/control traffic",
  serviceWorker.includes('cluster-shell-v345') &&
  serviceWorker.includes('url.pathname.startsWith("/api/")') &&
  serviceWorker.includes('url.pathname.startsWith("/health")') &&
  serviceWorker.includes('url.pathname.startsWith("/host/")') &&
  serviceWorker.includes('response.type === "basic"'));
check("API CORS surface is explicit",
  serverEntry.includes('methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]') &&
  serverEntry.includes('"X-Cluster-Idempotency-Key"') &&
  serverEntry.includes('"X-Cluster-Confirmation"') &&
  serverEntry.includes('"X-Cluster-Base-Revision"'));
check("API responses default to non-cacheable",
  requestDomain.includes('Cache-Control", "no-store, max-age=0') &&
  requestDomain.includes('Pragma", "no-cache'));
check("managed host validates browser trust boundary",
  hostGateway.includes("HOST_NOT_ALLOWED") &&
  hostGateway.includes('request.Header.Del("Forwarded")') &&
  hostGateway.includes('origin == "null"') &&
  hostGateway.includes("METHOD_NOT_ALLOWED") &&
  hostGateway.includes('X-DNS-Prefetch-Control'));
check("security architecture is documented",
  securityArchitecture.includes("Per-server browser and native-data isolation") &&
  securityArchitecture.includes("Native capability broker") &&
  securityArchitecture.includes("Server/API boundary"));
check("secret encryption uses a dedicated production key with rotation support",
  settingCrypto.includes('const ENCRYPTION_PREFIX = "enc:v2:"') &&
  settingCrypto.includes("crypto.hkdfSync") &&
  settingCrypto.includes("CLUSTER_SECRET_KEY_PREVIOUS") &&
  settingCrypto.includes("Production requires CLUSTER_SECRET_KEY") &&
  settingCrypto.includes("distinct from SESSION_SECRET") &&
  settingCrypto.includes("distinct from CLUSTER_AUTH_SECRET") &&
  runtimeConfig.includes("validateSecretEncryptionConfiguration"));
check("secret settings are masked and not mirrored into plaintext boot config",
  settingsIntegrations.includes("SENSITIVE_SETTING_KEYS.has(key)") &&
  settingsIntegrations.includes('version: 2') &&
  settingsIntegrations.includes('secretPolicy: "server-managed-only"') &&
  settingsIntegrations.includes("encryptBootSettingStorageValue") &&
  settingsIntegrations.includes("databaseUrlOverride: maskConfiguredSecret") &&
  settingsIntegrations.includes("migrateContextPackEncryption") &&
  settingsIntegrations.includes("encryptedValueNeedsRotation"));
check("secret-bearing configuration and exports require recent authentication",
  sessionSecurity.includes('path.startsWith("/api/context-packs/") && path.endsWith("/export")') &&
  sessionSecurity.includes('path === "/api/server-config" || path === "/api/settings"') &&
  serverEntry.includes("hasPrivilegedConfigAccess"));
check("backup metadata excludes secret-key material and protected files use private modes",
  operationsService.includes("keyIncluded: false") &&
  operationsService.includes("Cluster backups never copy secret-key material") &&
  operationsService.includes("fs.chmod(configTemp, 0o600)") &&
  databaseBackup.includes("chmod(dumpPath, 0o600)") &&
  launcher.includes("CLUSTER_SECRET_KEY_PREVIOUS") &&
  launcher.includes("os.Chmod(file, 0o600)"));
check("release packaging excludes environment and private-key artifacts",
  masterPackager.includes('".env"') &&
  masterPackager.includes('".env.local"') &&
  masterPackager.includes('forbiddenSecretFile') &&
  masterPackager.includes('pfx|p12|key|jks'));
check("secret and configuration custody is documented",
  secretConfigurationSecurity.includes("database-only integration secrets") &&
  secretConfigurationSecurity.includes("Key rotation") &&
  secretConfigurationSecurity.includes("Cluster backups never contain `CLUSTER_SECRET_KEY`") &&
  securityArchitecture.includes("Secret and configuration custody boundary"));
check("security audit events use a serialized integrity chain",
  securityAuditStore.includes("pg_advisory_xact_lock") &&
  securityAuditStore.includes("appendSecurityAuditEvent") &&
  securityAuditStore.includes("LEGACY:") &&
  auditRepository.includes("appendSecurityAuditEvent") &&
  schema.includes("integrityVersion Int") &&
  schema.includes("previousHash") &&
  schema.includes("eventHash"));
check("security audit hashing covers bounded redacted evidence",
  securityAuditIntegrity.includes("computeSecurityAuditHash") &&
  securityAuditIntegrity.includes("verifySecurityAuditChain") &&
  securityAuditIntegrity.includes("SECURITY_AUDIT_METADATA_MAX_BYTES = 32 * 1024") &&
  securityAuditIntegrity.includes("redactForLog"));
check("privileged mutations have central security-audit coverage",
  securityAuditPolicy.includes("SENSITIVE_MUTATION_PREFIXES") &&
  securityAuditPolicy.includes("/api/access-rules") &&
  serverEntry.includes("securityAuditPolicyForRequest") &&
  serverEntry.includes("security.audit_write_failed"));
check("security audit verification and export are administrator endpoints",
  auditRoutesSource.includes('/api/security/events/integrity') &&
  auditRoutesSource.includes('/api/security/events/export') &&
  auditRoutesSource.includes("X-Cluster-Audit-Digest-SHA256") &&
  sessionSecurity.includes('/api/security/events/export'));
check("generic retention preserves the security audit chain",
  !operationsService.includes("securityAuditEvent.deleteMany") &&
  operationsService.includes("securityAuditEventsRetained: true"));
check("security audit direct writes are centralized",
  (await Promise.all((await walk("apps/server/src")).filter((file) => /\.(?:ts|tsx)$/.test(file)).map(async (file) => {
    const content = await readFile(file, "utf8");
    const relative = path.relative(root, file).replaceAll("\\", "/");
    return content.includes("securityAuditEvent.create") && relative !== "apps/server/src/core/security-audit-store.ts" ? relative : null;
  }))).filter(Boolean).length === 0);
check("security audit boundary is documented without retroactive integrity claims",
  securityAuditTrail.includes("append-only integrity trail") &&
  securityAuditTrail.includes("does **not** claim that pre-v0.355 rows have retroactive tamper evidence") &&
  securityArchitecture.includes("Security audit and evidence boundary"));
check("release CI builds clean server/web/database/native surfaces",
  !repositoryCiAvailable || ciWorkflow.includes("Server + Web + PostgreSQL (Linux)") &&
  ciWorkflow.includes("Server + Web compile (Windows)") &&
  ciWorkflow.includes("Desktop (${{ matrix.compiler }})") &&
  ciWorkflow.includes("npm run desktop:smoke") &&
  ciWorkflow.includes("PostgreSQL backup/restore drill") &&
  ciWorkflow.includes("CLUSTER_TEST_DATABASE_URL") &&
  ciWorkflow.includes('CLUSTER_REQUIRE_INTEGRATION: "1"'));
check("integration tests cannot silently skip in certification",
  testRunner.includes("CLUSTER_REQUIRE_INTEGRATION") &&
  testRunner.includes("CLUSTER_TEST_DATABASE_URL") &&
  packageJson.scripts?.["test:integration"]?.includes("--require-integration") &&
  packageJson.scripts?.["test:integration"]?.includes("--require-tsx"));
check("tagged release workflow certifies artifacts before upload",
  !repositoryCiAvailable || releaseWorkflow.includes("Cluster Release Certification") &&
  releaseWorkflow.includes("CLUSTER_RELEASE_REQUIRE_PREBUILT") &&
  releaseWorkflow.includes("CLUSTER_RELEASE_REQUIRE_DESKTOP_PACKAGE") &&
  releaseWorkflow.includes("release-verify-artifacts.mjs --require-prebuilt --require-desktop-package") &&
  releaseWorkflow.includes("Previous release database upgrade") &&
  releaseWorkflow.includes("actions/download-artifact@v8") &&
  releaseWorkflow.includes("needs: [certify-build, upgrade-drill]") &&
  releaseWorkflow.includes("actions/attest-build-provenance@v4"));
check("release preflight owns compile and migration gates",
  releasePreflight.includes("--with-database") &&
  releasePreflight.includes("migration idempotency gate") &&
  releasePreflight.includes("build:server") &&
  releasePreflight.includes("build:web") &&
  releasePreflight.includes("--require-tsx") &&
  releasePreflight.includes("release-preflight.json"));
check("release verifier checks nested hashes and executable formats",
  releaseVerifier.includes("SHA256SUMS.txt") &&
  releaseVerifier.includes("CLUSTER_RELEASE.json") &&
  releaseVerifier.includes("dependencyLock") &&
  releaseVerifier.includes("--require-desktop-package") &&
  releaseVerifier.includes("bin/Cluster.exe") &&
  releaseVerifier.includes("0x4d, 0x5a") &&
  releaseVerifier.includes("0x7f, 0x45, 0x4c, 0x46"));
check("certified packaging binds preflight evidence and runtime lock",
  masterPackager.includes("release-preflight.json") &&
  masterPackager.includes("dependencyLock") &&
  masterPackager.includes("--package-lock-only") &&
  masterPackager.includes("CLUSTER_RELEASE_REQUIRE_DESKTOP_PACKAGE"));
check("desktop package has a launch smoke gate",
  desktopSmoke.includes("--smoke-test") && mainCpp.includes("--smoke-test") && mainCpp.includes("QTimer::singleShot"));
check("desktop update path is signed, bounded, and transactional",
  nativeUpdateHeader.includes("rollbackUpdate") &&
  nativeUpdateHeader.includes("markRuntimeHealthy") &&
  nativeUpdateCpp.includes("SameOriginRedirectPolicy") &&
  nativeUpdateCpp.includes("MaxManifestBytes = 256 * 1024") &&
  nativeUpdateCpp.includes("MaxArtifactBytes = 2LL * 1024LL * 1024LL * 1024LL") &&
  nativeUpdateCpp.includes("Content-Range") &&
  nativeUpdateCpp.includes("persistPendingInstall") &&
  nativeUpdateCpp.includes("desktop/updateTransaction") &&
  nativeUpdateCpp.includes("verifyArtifactFile(m_downloadedPath") &&
  nativeUpdateCpp.includes("verifyArtifactFile(m_rollbackPath") &&
  updateHelper.includes("validateManifest") &&
  updateHelper.includes("manifest product must be cluster-desktop") &&
  updateManifestSigner.includes("createPrivateKey") &&
  packageJson.scripts?.["release:update-manifest"]?.includes("release-update-manifest.mjs") &&
  desktopUpdateSecurity.includes("Transactional recovery"));
check("PostgreSQL advisory lock signature", bootstrapLock.includes("pg_try_advisory_xact_lock($1::integer, $2::integer)"));
check("private Node version synchronized", launcher.includes(`privateNodeVersion = "${manifest.node.version}"`));
check("private PostgreSQL version synchronized", windowsRuntime.includes(`postgresVersion = "${manifest.postgresql.version}"`));
check("PostgreSQL installer revision synchronized", windowsRuntime.includes(`postgresInstallerRevision = "${manifest.postgresql.installerRevision}"`));
check("Windows bootstrap download is resilient", windowsRuntime.includes("download failed after 3 attempts") && windowsRuntime.includes(".partial") && windowsRuntime.includes("User-Agent"));
check("Windows PostgreSQL extraction is observable",
  windowsRuntime.includes("PostgreSQL extraction still running") &&
  windowsRuntime.includes("postgresql-bootstrap.log") &&
  windowsRuntime.includes("10 * time.Minute"));
check("Windows PostgreSQL extraction is service-free",
  windowsRuntime.includes('"--extract-only", "1"') &&
  windowsRuntime.includes('"--install_runtimes", "0"'));
check("Windows PostgreSQL installer cache is reusable", windowsRuntime.includes("Using cached PostgreSQL runtime installer."));
check("Windows bootstrap failures are persistent", launcher.includes("bootstrap.log") && launcher.includes("Press Enter to close") && launcher.includes("runtimeCleanups"));
check("Qt baseline synchronized", cmake.includes(`find_package(Qt6 ${manifest.qt.majorMinor} REQUIRED`) && cmake.includes(`qt_standard_project_setup(REQUIRES ${manifest.qt.majorMinor})`));
check("Three.js uses npm dependency", rendererPackage.dependencies?.three === manifest.three.version && /(?:from\s+|import\()["']three/.test(viewer));
check("Three.js is not vendored", !(await exists("packages/renderer/vendor")));
check("styles are consolidated", styles.includes('import "./styles/application.css"') && !(await exists("packages/renderer/src/styles/legacy")));
const historicalCss = (await walk("packages/renderer/src")).filter((f) => /(?:legacy-owned|legacy-refinements|liquid-glass-v\d+|project-workspace-v\d+|project-control-v\d+)\.css$/i.test(f));
check("active styles use canonical filenames", historicalCss.length === 0, historicalCss.join(", "));
const qmlFiles = (await walk("apps/desktop-qt/qml")).filter((f) => f.endsWith(".qml"));
const qmlChildSeparatorErrors = [];
for (const file of qmlFiles) {
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (/\}\s*;\s*[A-Z][A-Za-z0-9_]*\s*\{/.test(lines[index])) qmlChildSeparatorErrors.push(`${path.relative(root, file)}:${index + 1}`);
  }
}
check("QML child objects use valid separators", qmlChildSeparatorErrors.length === 0, qmlChildSeparatorErrors.join(", "));


const appControllerHeader = await text("apps/desktop-qt/src/AppController.h");
check("moc sees concrete QObject property types",
  appControllerHeader.includes('#include "DesktopPreferences.h"') &&
  appControllerHeader.includes('#include "NativeUpdateManager.h"') &&
  !appControllerHeader.includes("class DesktopPreferences;") &&
  !appControllerHeader.includes("class NativeUpdateManager;"));
check("retired native canvas QML registrations stay removed",
  !mainCpp.includes("qmlRegisterType<WhiteboardCanvas>") &&
  !mainCpp.includes("qmlRegisterType<BuildFlowCanvas>") &&
  !mainCpp.includes("qmlRegisterType<BoardCanvas>") &&
  !(await exists("apps/desktop-qt/src/WhiteboardCanvas.cpp")) &&
  !(await exists("apps/desktop-qt/src/BuildFlowCanvas.cpp")) &&
  !(await exists("apps/desktop-qt/src/BoardCanvas.cpp")));
check("QUrl reset assignments are explicit",
  !/m_pendingDeepLink\s*=\s*\{\}/.test(appControllerCpp));
check("legacy native search and preview managers stay retired",
  !(await exists("apps/desktop-qt/src/LocalSearchIndex.cpp")) &&
  !(await exists("apps/desktop-qt/src/FilePreviewManager.cpp")) &&
  !cmake.includes("LocalSearchIndex") &&
  !cmake.includes("FilePreviewManager"));

const desktopPackager = await text("tools/scripts/package-qt-desktop.mjs");
const desktopBuilder = await text("tools/scripts/build-qt-desktop.mjs");
check("desktop package performs clean native build", desktopPackager.includes('"--clean", "--package"'));
check("desktop build self-validates toolchain", desktopBuilder.includes("desktop-setup.mjs") && desktopPackager.includes("loadDesktopToolchain") && desktopPackager.includes('toolchain?.cmake || "cmake"'));
check("master packager preserves nested source data directories",
  masterPackager.includes('rootGeneratedNames = new Set(["data", "runtime", "bin"])') &&
  !masterPackager.includes('".git", "data", "runtime", "bin"'));
check("master packager carries prebuilt output and certification metadata",
  masterPackager.includes("CLUSTER_RELEASE_CERTIFIED") &&
  masterPackager.includes("CLUSTER_RELEASE_REQUIRE_PREBUILT") &&
  masterPackager.includes("CLUSTER_RELEASE.json") &&
  masterPackager.includes("release-verify-artifacts.mjs") &&
  masterPackager.includes("apps", "server", "dist"));
check("server launcher trusts version-matched packaged build output before rebuilding",
  launcher.includes("releasePrebuiltReady") &&
  launcher.includes("Using prebuilt Cluster Server, Prisma client, and web client from the release package") &&
  launcher.includes("Generating Prisma client for source/repair build") &&
  launcher.includes("repair/source package fallback"));
check("server dependency fingerprint includes certified lockfile",
  launcher.includes('if lock := filepath.Join(root, "package-lock.json"); fileExists(lock)') &&
  launcher.includes('hash.Write([]byte("package-lock.json"))'));

for (const [name, script] of Object.entries(packageJson.scripts || {})) {
  const matches = [...String(script).matchAll(/tools[\\/]scripts[\\/]([^\s"']+)/g)];
  for (const match of matches) check(`package script ${name}`, await exists(`tools/scripts/${match[1]}`), match[1]);
}

const files = await walk(root);
const relativeFiles = files.map((file) => path.relative(root, file).replaceAll("\\", "/"));
check("no BAT launchers", !relativeFiles.some((file) => file.toLowerCase().endsWith(".bat")));
check("no checked-in dependency/build sludge", !relativeFiles.some((file) => /(^|\/)(node_modules|dist|build|release)(\/|$)/.test(file)));
check("no live environment or private-key artifacts in source", !relativeFiles.some((file) => {
  const base = path.basename(file).toLowerCase();
  return [".env", ".env.local", ".env.production", ".env.development", "embedded-postgres.env"].includes(base) || /\.(?:pfx|p12|key|jks)$/i.test(base);
}));
const runtimeFiles = relativeFiles.filter((f) => /^(apps|packages|config|deployment)\//.test(f) && /\.(?:ts|tsx|js|mjs|go|json|cmake|txt|yml|yaml)$/i.test(f));
check("no stale v0.342.0 runtime pins", !(await Promise.all(runtimeFiles.map(async (f) => (await text(f)).includes("0.342.0")))).some(Boolean));

const oversized = [];
for (const file of files.filter((file) => /\.(?:ts|tsx|mjs|js|qml|cpp|h)$/.test(file))) {
  const bytes = (await stat(file)).size;
  if (bytes > 600_000) oversized.push(`${path.relative(root, file)} (${Math.round(bytes / 1024)} KiB)`);
}
check("no pathological source files", oversized.length === 0, oversized.join(", "));


check("operational health separates liveness and dependency readiness",
  healthRoutesSource.includes('app.get("/health/live"') &&
  healthRoutesSource.includes('app.get("/health/ready"') &&
  healthRoutesSource.includes('writableStorageProbe.check()') &&
  operationalHealthSource.includes('class WritableStorageProbe'));
check("operational health combines bounded runtime failure signals",
  operationalHealthSource.includes('event-loop') &&
  operationalHealthSource.includes('background-tasks') &&
  operationalHealthSource.includes('OperationalHealthHistory') &&
  operationalHealthSource.includes('this.incidents.length > 64'));
check("background automation begins only after startup readiness",
  serverEntry.includes('if (!operational.ready) throw new Error') &&
  serverEntry.indexOf('if (!operational.ready) throw new Error') < serverEntry.lastIndexOf('jobRuntime.start();') &&
  serverEntry.indexOf('if (!operational.ready) throw new Error') < serverEntry.lastIndexOf('startBackgroundTasks();'));
check("operational health boundary is documented and packaged",
  operationalHealthSecurity.includes('/health/live') &&
  operationalHealthSecurity.includes('/health/ready') &&
  securityArchitecture.includes('Operational health and failure-containment boundary') &&
  (masterPackager.match(/docs\/OPERATIONAL_HEALTH_RESILIENCE\.md/g) || []).length >= 2);
check("server advertises operational health capability", apiContracts.includes('operational-health-v1'));

const releaseEvidenceLib = await text("tools/scripts/release-evidence-lib.mjs");
const releaseLedger = await text("tools/scripts/release-certification-ledger.mjs");
const releaseSbom = await text("tools/scripts/release-sbom.mjs");
const releaseVerifierFinal = await text("tools/scripts/release-verify-artifacts.mjs");
const releaseWorkflowFinal = await text(".github/workflows/release.yml");
const signingVerifier = await text("tools/scripts/release-verify-windows-signatures.mjs");
const finalReleaseDoc = await text("docs/RELEASE_CERTIFICATION_SUPPLY_CHAIN.md");
check("release evidence is source-revision bound and integrity hashed",
  releaseEvidenceLib.includes("recordHash") &&
  releaseEvidenceLib.includes("canonicalJson") &&
  releaseEvidenceLib.includes("sourceRevision") &&
  releaseEvidenceLib.includes("verifyGateEvidence"));
check("certified release ledger requires the complete production gate set",
  ["preflight", "dependency-audit", "accessibility", "integration", "backup-restore", "upgrade-drill", "desktop-smoke"].every((gate) => releaseLedger.includes(`"${gate}"`)) &&
  releaseLedger.includes("publicDistributionReady") &&
  releaseLedger.includes("windows-signatures"));
check("release supply-chain inventory is SPDX and lock-backed for certification",
  releaseSbom.includes('spdxVersion: "SPDX-2.3"') &&
  releaseSbom.includes("--require-lock") &&
  releaseSbom.includes("completeDependencyGraph") &&
  releaseSbom.includes("package-lock.json"));
check("master schema carries certification evidence and supply-chain hashes",
  masterPackager.includes("schema: 3") &&
  masterPackager.includes("CERTIFICATION_EVIDENCE.json") &&
  masterPackager.includes("RELEASE_INVENTORY.json") &&
  masterPackager.includes("SBOM.spdx.json") &&
  masterPackager.includes("runtimeDependencyLockSha256"));
check("final verifier recomputes evidence, runtime lock, and Authenticode state",
  releaseVerifierFinal.includes("verifyGateEvidence") &&
  releaseVerifierFinal.includes("runtimeDependencyLockSha256") &&
  releaseVerifierFinal.includes("assertAuthenticode") &&
  releaseVerifierFinal.includes("publicDistributionReady"));
check("tagged release pipeline audits dependencies and records cross-job evidence",
  !repositoryCiAvailable || releaseWorkflowFinal.includes("--gate=dependency-audit") &&
  releaseWorkflowFinal.includes("--gate=accessibility") &&
  releaseWorkflowFinal.includes("--gate=backup-restore") &&
  releaseWorkflowFinal.includes("--gate=upgrade-drill") &&
  releaseWorkflowFinal.includes("--gate=desktop-smoke") &&
  releaseWorkflowFinal.includes("upgrade-evidence-${{ github.sha }}"));
check("public release pipeline signs before final assembly and does not rebuild signed native payloads",
  !repositoryCiAvailable || releaseWorkflowFinal.includes("release:sign-windows") &&
  releaseWorkflowFinal.includes("release:sign-installer") &&
  releaseWorkflowFinal.includes("release:verify-windows-signatures") &&
  releaseWorkflowFinal.includes('CLUSTER_RELEASE_REUSE_NATIVE: "1"') &&
  signingVerifier.includes("Get-AuthenticodeSignature"));
check("tagged release provenance is mandatory",
  !repositoryCiAvailable || releaseWorkflowFinal.includes("actions/attest-build-provenance@v4") &&
  !/Attest Cluster Master provenance[\s\S]{0,100}continue-on-error:\s*true/.test(releaseWorkflowFinal));
check("final release certification boundary is documented and packaged",
  finalReleaseDoc.includes("local-unattested") &&
  finalReleaseDoc.includes("ci-certified") &&
  finalReleaseDoc.includes("public-signed") &&
  (masterPackager.match(/docs\/RELEASE_CERTIFICATION_SUPPLY_CHAIN\.md/g) || []).length >= 2);



const accessibilityManagerFinal = await text("packages/renderer/src/components/AccessibilityManager.tsx");
const accessibilityAppRoot = await text("packages/renderer/src/App.tsx");
const accessibilitySelect = await text("packages/renderer/src/components/ClusterSelect.tsx");
const accessibilityApplication = rendererApplication;
const accessibilityPortfolio = await text("packages/renderer/src/features/projects/ProjectPortfolioItem.tsx");
const accessibilityBoard = await text("packages/renderer/src/features/boards/BoardWorkspacePage.tsx");
const accessibilityCard = await text("packages/renderer/src/features/boards/BoardCardTile.tsx");
const accessibilityWhiteboard = await text("packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx");
const accessibilityCommand = await text("packages/renderer/src/features/search/CommandPalette.tsx");
const accessibilityCreate = await text("packages/renderer/src/features/create/SharedCreateDrawer.tsx");
const accessibilityCss = await text("packages/renderer/src/styles/accessibility.css");
const accessibilityDoc = await text("docs/APP_WIDE_ACCESSIBILITY.md");
check("accessibility manager is global across public and authenticated renderer surfaces",
  accessibilityAppRoot.includes("skip-link-v204") &&
  accessibilityAppRoot.includes("<AccessibilityManager />") &&
  accessibilityManagerFinal.includes("modalCandidateSelector") &&
  accessibilityManagerFinal.includes('setAttribute("inert", "")') &&
  accessibilityManagerFinal.includes("inferControlLabel") &&
  accessibilityManagerFinal.includes("if (!main.hasAttribute(\"tabindex\")) main.tabIndex = -1"));
check("custom select uses keyboard listbox semantics instead of button-options",
  accessibilitySelect.includes('role="listbox"') &&
  accessibilitySelect.includes('role="option"') &&
  accessibilitySelect.includes("aria-activedescendant") &&
  !/<button[\s\S]{0,80}role="option"/.test(accessibilitySelect));
check("high-use navigation avoids nested fake buttons and exposes semantic state",
  !accessibilityApplication.includes('role="button"') &&
  !accessibilityPortfolio.includes('role="button"') &&
  accessibilityApplication.includes("project-tab-close-button-v370") &&
  accessibilityPortfolio.includes('role="progressbar"'));
check("board and whiteboard have keyboard alternatives to pointer-only manipulation",
  accessibilityBoard.includes("KeyboardSensor") &&
  accessibilityCard.includes("Press Space to pick up") &&
  accessibilityWhiteboard.includes("keyboardNudge") &&
  accessibilityWhiteboard.includes("whiteboard-keyboard-instructions-v370"));
check("major shared overlays expose dialog semantics and forced-colors focus affordances",
  accessibilityCommand.includes('role="dialog" aria-modal="true"') &&
  accessibilityCreate.includes('role="dialog" aria-modal="true"') &&
  accessibilityCss.includes("@media (forced-colors: active)") &&
  accessibilityCss.includes(".sr-only-v370"));
check("app-wide accessibility boundary is documented, packaged, and advertised",
  accessibilityDoc.includes("Roadmap Step 10") &&
  accessibilityDoc.includes("Roadmap Step 11") &&
  apiContracts.includes('app-accessibility-v1') &&
  (masterPackager.match(/docs\/APP_WIDE_ACCESSIBILITY\.md/g) || []).length >= 2);


const accessibilityPreferencesCore = await text("packages/renderer/src/core/accessibility-preferences.ts");
const accessibilitySettingsPage = settingsWorkspace;
const accessibilityPreferenceRoutes = await text("apps/server/src/domains/users/user-preference-routes.ts");
const accessibilitySettingsDoc = await text("docs/ACCESSIBILITY_SETTINGS.md");
const desktopPreferencesHeaderV371 = await text("apps/desktop-qt/src/DesktopPreferences.h");
const desktopPreferencesSourceV371 = await text("apps/desktop-qt/src/DesktopPreferences.cpp");
const desktopThemeV371 = await text("apps/desktop-qt/qml/Theme.qml");
check("accessibility preferences are explicit, validated, and backward compatible",
  accessibilityPreferencesCore.includes("resolveAccessibilityPreferences") &&
  accessibilityPreferencesCore.includes("userMotionPreference") &&
  accessibilityPreferenceRoutes.includes('userContrastPreference: z.enum') &&
  accessibilityPreferenceRoutes.includes('userStatusPalette: z.enum'));
check("accessibility settings expose motion contrast transparency scaling focus targets and palettes",
  accessibilitySettingsPage.includes("Follow operating system") &&
  accessibilitySettingsPage.includes("150% · Largest") &&
  accessibilitySettingsPage.includes("Color-vision safe") &&
  accessibilitySettingsPage.includes("Reset accessibility"));
check("accessibility rendering honors system preference changes and non-color modes",
  accessibilityManagerFinal.includes("syncSystemAccessibilityPreferences") &&
  accessibilityManagerFinal.includes("prefers-contrast: more") &&
  accessibilityCss.includes('data-status-palette="color-vision-safe"') &&
  accessibilityCss.includes('data-transparency="off"') &&
  accessibilityCss.includes('data-text-scale="largest"'));
check("native Qt accessibility preferences share the same control categories",
  desktopPreferencesHeaderV371.includes("Q_PROPERTY(QString motionMode") &&
  desktopPreferencesHeaderV371.includes("Q_PROPERTY(QString statusPalette") &&
  desktopPreferencesSourceV371.includes("QAccessibilityHints::contrastPreferenceChanged") &&
  desktopThemeV371.includes("readonly property real textScale") &&
  desktopThemeV371.includes("color-vision-safe"));
check("accessibility settings boundary is documented packaged and advertised",
  accessibilitySettingsDoc.includes("Roadmap Step 11") &&
  apiContracts.includes('accessibility-preferences-v1') &&
  (masterPackager.match(/docs\/ACCESSIBILITY_SETTINGS\.md/g) || []).length >= 2);


check("automated accessibility tooling is pinned and exposed through package scripts",
  packageJson.devDependencies?.playwright === "1.62.1" &&
  packageJson.devDependencies?.["axe-core"] === "4.12.1" &&
  packageJson.scripts?.["accessibility:static"]?.includes("accessibility-static-audit.mjs") &&
  packageJson.scripts?.["accessibility:ci"]?.includes("accessibility-ci.mjs"));
check("accessibility runtime CI uses real Chromium axe scans keyboard checks and persisted reports",
  accessibilityCiScript.includes('await import("playwright")') &&
  accessibilityCiScript.includes('require.resolve("axe-core/axe.min.js")') &&
  accessibilityCiLib.includes('ACCESSIBILITY_ALWAYS_BLOCK_RULES = new Set(["color-contrast"])') &&
  accessibilityCiScript.includes("Skip link reaches main content") &&
  accessibilityCiScript.includes("Command palette traps and restores focus") &&
  accessibilityCiScript.includes("accessibility-report.json") &&
  accessibilityCiScript.includes("Public copyright report") &&
  accessibilityCiScript.includes("Authenticated home"));
check("accessibility CI keeps static semantic guardrails",
  accessibilityStaticAudit.includes('role=button controls are prohibited') &&
  accessibilityStaticAudit.includes('iframe without an accessible title') &&
  accessibilityStaticAudit.includes('img without alt text') &&
  accessibilityStaticAudit.includes("skip-link-v204"));
check("ordinary and tagged CI install Chromium and fail on accessibility regressions",
  !repositoryCiAvailable || ciWorkflow.includes("npx playwright install --with-deps chromium") &&
  ciWorkflow.includes("npm run accessibility:ci") &&
  ciWorkflow.includes("path: .cluster/accessibility") &&
  releaseWorkflow.includes("--gate=accessibility") &&
  releaseWorkflow.includes('cp -a .cluster/accessibility "$stage/accessibility"'));
check("certified release evidence requires and packages a passing accessibility report",
  releaseLedger.includes('"accessibility"') &&
  releaseLedger.includes("Certified releases require a passing runtime accessibility report") &&
  releaseVerifier.includes('Evidence/accessibility-report.json') &&
  releaseVerifier.includes('"accessibility"') &&
  masterPackager.includes('Evidence", "accessibility-report.json') &&
  localCertification.includes('"--gate=accessibility"'));
check("automated accessibility CI boundary is documented and packaged",
  accessibilityCiDoc.includes("Roadmap Step 12") &&
  accessibilityCiDoc.includes("does not mean every human accessibility requirement has been proven") &&
  (masterPackager.match(/docs\/AUTOMATED_ACCESSIBILITY_CI\.md/g) || []).length >= 2);


const directResourceBoundaryV373 = await text("apps/server/src/domains/access/request-authorization-boundary.ts");
const directResourceUnitV373 = await text("tools/tests/unit/direct-resource-authorization.test.ts");
const directResourceIntegrationV373 = await text("tools/tests/integration/direct-resource-authorization.test.ts");
const directResourceDocV373 = await text("docs/DIRECT_RESOURCE_AUTHORIZATION_REGRESSION.md");
check("direct video comment mutations resolve the authoritative asset and project",
  directResourceBoundaryV373.includes('pathname.startsWith("/api/video-comments/")') &&
  directResourceBoundaryV373.includes("videoComment.findUnique") &&
  directResourceBoundaryV373.includes("comment.videoAsset.project") &&
  directResourceBoundaryV373.includes('"video", comment.videoAsset.id'));
check("direct-resource unit matrix covers aliases parent resolution user scope and missing IDs",
  directResourceUnitV373.includes("video comment IDs cannot bypass") &&
  directResourceUnitV373.includes("generic checklist aliases resolve through card authorization") &&
  directResourceUnitV373.includes("user-scoped direct resources require owner/manager scope") &&
  directResourceUnitV373.includes("unknown direct object IDs fail closed"));
check("postgresql integration attack matrix covers cross-project access logout replay and share-link BOLA",
  directResourceIntegrationV373.includes("commentAttack.status, 403") &&
  directResourceIntegrationV373.includes("loggedOutReplay.status, 401") &&
  directResourceIntegrationV373.includes("crossProjectSharePatch.status, 404") &&
  directResourceIntegrationV373.includes("secondShareOpen.status, 404"));
check("direct-resource authorization regression boundary is documented packaged and advertised",
  directResourceDocV373.includes("Roadmap Step 12") &&
  directResourceDocV373.includes("Roadmap Step 13 is implemented in v0.374.0") &&
  apiContracts.includes('direct-resource-authorization-v1') &&
  (masterPackager.match(/docs\/DIRECT_RESOURCE_AUTHORIZATION_REGRESSION\.md/g) || []).length >= 2);



const logoutSessionAuthV374 = await text("apps/server/src/domains/auth/auth-core-routes.ts");
const logoutSessionRoutesV374 = await text("apps/server/src/domains/sessions/session-routes.ts");
const logoutSessionRuntimeV374 = await text("apps/server/src/core/collaboration-runtime.ts");
const logoutSessionCollaborationV374 = await text("apps/server/src/domains/collaboration/collaboration-routes.ts");
const logoutSessionRendererApiV374 = await text("packages/renderer/src/core/api.ts");
const logoutSessionRendererCollaborationV374 = await text("packages/renderer/src/features/collaboration/index.tsx");
const logoutSessionUnitV374 = await text("tools/tests/unit/session-hostile-regression.test.ts");
const logoutSessionIntegrationV374 = await text("tools/tests/integration/logout-session-regression.test.ts");
const logoutSessionDocV374 = await text("docs/LOGOUT_SESSION_REPLAY_REGRESSION.md");
check("logout and explicit session revocation publish exact-session lifecycle and audit evidence",
  logoutSessionAuthV374.includes("account.logged_out") &&
  logoutSessionAuthV374.includes('onSessionRevoked(session.id, session.userId, "logout")') &&
  logoutSessionRoutesV374.includes("currentSessionRevoked") &&
  logoutSessionRoutesV374.includes("Clear-Site-Data") &&
  logoutSessionRoutesV374.includes("session.revoked"));
check("realtime collaboration is bound to exact sessions and distinguishes revoke from rotation",
  logoutSessionRuntimeV374.includes("disconnectSession(sessionId") &&
  logoutSessionRuntimeV374.includes('const state = ["reauthenticated", "discord_identity_changed"].includes(reason) ? "rotated" : "revoked"') &&
  logoutSessionCollaborationV374.includes("sessionId: session.id") &&
  logoutSessionCollaborationV374.includes("getCurrentSession(request)"));
check("renderer invalidates protected session state without deleting pending offline writes",
  logoutSessionRendererApiV374.includes("CLUSTER_SESSION_INVALIDATED_EVENT") &&
  logoutSessionRendererApiV374.includes("clearOfflineReadScope(previousScope)") &&
  logoutSessionRendererApiV374.includes("sessionCacheGeneration") &&
  !logoutSessionRendererApiV374.includes("clearOfflineScope(previousScope)") &&
  logoutSessionRendererCollaborationV374.includes("sessionControlAction"));
check("hostile logout tests replay captured cookies csrf and realtime/session-management paths",
  logoutSessionUnitV374.includes("realtime session control distinguishes revocation from rotation") &&
  logoutSessionIntegrationV374.includes("staleCsrfReplay") &&
  logoutSessionIntegrationV374.includes("protectedReplay.status, 401") &&
  logoutSessionIntegrationV374.includes("event: session") &&
  logoutSessionIntegrationV374.includes("currentSessionRevoked"));
check("logout session replay boundary is documented packaged and advertised",
  logoutSessionDocV374.includes("Roadmap Step 13") &&
  logoutSessionDocV374.includes("pending offline mutations and uploads") &&
  apiContracts.includes('session-replay-regression-v1') &&
  (masterPackager.match(/docs\/LOGOUT_SESSION_REPLAY_REGRESSION\.md/g) || []).length >= 2);



const securityDisclosureCoreV375 = await text("apps/server/src/core/security-disclosure-policy.ts");
const securityDisclosureRoutesV375 = await text("apps/server/src/domains/legal/security-disclosure-policy-routes.ts");
const securityDisclosureMigrationV375 = await text("apps/server/prisma/migrations/20260820010000_security_disclosure_policy/migration.sql");
const securityDisclosureRendererV375 = await text("packages/renderer/src/features/legal/SecurityDisclosurePolicyPage.tsx");
const securityDisclosureAdminV375 = await text("packages/renderer/src/features/legal/SecurityDisclosurePolicyAdminPanel.tsx");
const securityDisclosureDocV375 = await text("docs/SECURITY_VULNERABILITY_DISCLOSURE_POLICY.md");
const hostGatewayV375 = await text("apps/host-go/gateway.go");
const webViteV375 = await text("apps/web/vite.config.ts");
check("security disclosure policy is immutable structured and discoverable",
  securityDisclosureCoreV375.includes('SECURITY_DISCLOSURE_POLICY_KIND = "security_vulnerability_disclosure"') &&
  securityDisclosureCoreV375.includes("SECURITY_TXT_MAX_VALIDITY_DAYS = 366") &&
  securityDisclosureCoreV375.includes('`Contact: ${contact}`') &&
  securityDisclosureCoreV375.includes('`Canonical: ${origin}/.well-known/security.txt`') &&
  securityDisclosureMigrationV375.includes('ADD COLUMN "metadataJson" TEXT'));
check("security disclosure routes expose public policy security.txt and protected administration",
  securityDisclosureRoutesV375.includes('app.get("/api/public/legal/security"') &&
  securityDisclosureRoutesV375.includes('app.get("/.well-known/security.txt"') &&
  securityDisclosureRoutesV375.includes('app.get("/security.txt"') &&
  securityDisclosureRoutesV375.includes('app.post("/api/admin/legal/security/versions/:policyId/publish"'));
check("managed web gateways forward security.txt to the authoritative policy service",
  hostGatewayV375.includes('pathValue == "/.well-known/security.txt"') &&
  webViteV375.includes('"/.well-known/security.txt": "http://127.0.0.1:4000"'));
check("security disclosure UI exposes public policy and operator-controlled metadata",
  securityDisclosureRendererV375.includes('/api/public/legal/security') &&
  securityDisclosureRendererV375.includes('/.well-known/security.txt') &&
  securityDisclosureAdminV375.includes('Security contacts (one URI per line)') &&
  securityDisclosureAdminV375.includes('security.txt expiry'));
check("security disclosure roadmap boundary is documented packaged and advertised",
  securityDisclosureDocV375.includes("Roadmap Step 14") &&
  securityDisclosureDocV375.includes("RFC 9116") &&
  apiContracts.includes('security-disclosure-policy-v1') &&
  (masterPackager.match(/docs\/SECURITY_VULNERABILITY_DISCLOSURE_POLICY\.md/g) || []).length >= 2);



const legalComplianceCoreV376 = await text("apps/server/src/core/legal-compliance.ts");
const legalComplianceRoutesV376 = await text("apps/server/src/domains/legal/legal-compliance-routes.ts");
const legalComplianceCenterV376 = await text("packages/renderer/src/features/legal/LegalComplianceCenter.tsx");
const privacyRequestsAdminV376 = await text("packages/renderer/src/features/legal/PrivacyRequestsAdminPanel.tsx");
const legalComplianceSettingsV376 = settingsWorkspace;
const legalComplianceDocV376 = await text("docs/LEGAL_COMPLIANCE_CENTER.md");
check("legal compliance aggregate reports bounded operator state without certification claims",
  legalComplianceCoreV376.includes("legalCertification: false") &&
  legalComplianceCoreV376.includes("pendingDataRequests") &&
  legalComplianceCoreV376.includes("copyrightLegalHolds") &&
  legalComplianceCoreV376.includes("security:expires-soon"));
check("legal compliance endpoint is administrator-scoped no-store and centrally registered",
  legalComplianceRoutesV376.includes('app.get("/api/admin/legal/compliance"') &&
  legalComplianceRoutesV376.includes('Cache-Control", "no-store"') &&
  serverEntry.includes("registerLegalComplianceRoutes({ app, prisma, readSettings, authorization, logSecurityEvent })"));
check("legal compliance UI consolidates operator workflows and privacy-request review",
  legalComplianceCenterV376.includes("Private deployment") &&
  legalComplianceCenterV376.includes("PrivacyRequestsAdminPanel") &&
  legalComplianceCenterV376.includes("Data & retention") &&
  privacyRequestsAdminV376.includes("resolutionNote") &&
  legalComplianceSettingsV376.includes('label: "Privacy & data"') &&
  legalComplianceSettingsV376.includes("<LegalComplianceCenter />"));
check("legal compliance roadmap boundary is documented packaged and advertised",
  legalComplianceDocV376.includes("Roadmap Step 15") &&
  legalComplianceDocV376.includes("not a legal, privacy, accessibility, or regulatory certification") &&
  apiContracts.includes('legal-compliance-center-v1') &&
  apiContracts.includes('2026-08-02.63') &&
  (masterPackager.match(/docs\/LEGAL_COMPLIANCE_CENTER\.md/g) || []).length >= 2);



const thirdPartySchemaV377 = await text("apps/server/prisma/schema.prisma");
const thirdPartyMigrationV377 = await text("apps/server/prisma/migrations/20260820023000_third_party_disclosures/migration.sql");
const thirdPartyCoreV377 = await text("apps/server/src/core/third-party-disclosure.ts");
const thirdPartyRoutesV377 = await text("apps/server/src/domains/legal/third-party-disclosure-routes.ts");
const thirdPartyPageV377 = await text("packages/renderer/src/features/legal/ThirdPartyDisclosurePage.tsx");
const thirdPartyAdminV377 = await text("packages/renderer/src/features/legal/ThirdPartyDisclosureAdminPanel.tsx");
const thirdPartyDocV377 = await text("docs/THIRD_PARTY_DISCLOSURE_GENERATION.md");
check("third-party disclosure storage and detector are structured without automatic legal classification",
  thirdPartySchemaV377.includes("model ThirdPartyDisclosureProvider") &&
  thirdPartyMigrationV377.includes('CREATE TABLE "ThirdPartyDisclosureProvider"') &&
  storageMigrations.includes('"ThirdPartyDisclosureProvider"') &&
  storageMigrations.includes('"ThirdPartyDisclosureProvider_status_publicVisible_idx"') &&
  thirdPartyCoreV377.includes("detectThirdPartyCandidates") &&
  thirdPartyCoreV377.includes('recipientRole: z.enum(THIRD_PARTY_RECIPIENT_ROLES)') &&
  thirdPartyCoreV377.includes('builtin.youtube-embed') &&
  thirdPartyCoreV377.includes('builtin.discord-messaging') &&
  thirdPartyCoreV377.includes('builtin.gitea'));
check("third-party public disclosure is reviewed narrow and fail-closed on material edits",
  thirdPartyRoutesV377.includes('app.get("/api/public/privacy/third-parties"') &&
  thirdPartyRoutesV377.includes('publicVisible: true, reviewedAt: { not: null }') &&
  thirdPartyRoutesV377.includes("materialChanged") &&
  thirdPartyRoutesV377.includes("reviewInvalidated") &&
  thirdPartyRoutesV377.includes("THIRD_PARTY_DISCLOSURE_REVIEW_REQUIRED"));
check("third-party disclosure UI exposes public records and explicit administrator review workflow",
  thirdPartyPageV377.includes("Third-party data disclosure") &&
  thirdPartyAdminV377.includes("Detected integrations") &&
  thirdPartyAdminV377.includes("Review & publish") &&
  thirdPartyAdminV377.includes("reviewAndPublish ? { ...record, reviewed: true, publicVisible: true } : record") &&
  !thirdPartyAdminV377.includes("reviewed: reviewAndPublish ? true : form.reviewed") &&
  legalComplianceCoreV376.includes("recordedButNotDetected") &&
  legalComplianceCenterV376.includes("ThirdPartyDisclosureAdminPanel"));
check("third-party disclosure roadmap boundary is documented packaged and advertised",
  thirdPartyDocV377.includes("Roadmap Step 16") &&
  thirdPartyDocV377.includes("Roadmap Step 17") &&
  apiContracts.includes('third-party-disclosure-v1') &&
  apiContracts.includes('2026-08-02.63') &&
  sharedErrorCodes.includes('THIRD_PARTY_DISCLOSURE_REVIEW_REQUIRED') &&
  (masterPackager.match(/docs\/THIRD_PARTY_DISCLOSURE_GENERATION\.md/g) || []).length >= 2);



const policyAcceptanceSchemaV378 = await text("apps/server/prisma/schema.prisma");
const policyAcceptanceMigrationV378 = await text("apps/server/prisma/migrations/20260820030000_policy_acceptance/migration.sql");
const policyAcceptanceCoreV378 = await text("apps/server/src/core/policy-acceptance.ts");
const policyAcceptanceRoutesV378 = await text("apps/server/src/domains/legal/policy-acceptance-routes.ts");
const policyAcceptanceScreenV378 = await text("packages/renderer/src/features/legal/PolicyAcceptanceScreen.tsx");
const policyAcceptanceAdminV378 = await text("packages/renderer/src/features/legal/PolicyAcceptanceAdminPanel.tsx");
const policyAcceptanceDocV378 = await text("docs/AUDITABLE_POLICY_ACCEPTANCE.md");
const privacyDataRoutesV378 = await text("apps/server/src/domains/legal/privacy-data-routes.ts");
const dataRetentionV378 = await text("apps/server/src/core/data-retention.ts");
check("policy acceptance storage defaults to opt-in and preserves immutable evidence",
  policyAcceptanceSchemaV378.includes("model PolicyAcceptance") &&
  policyAcceptanceSchemaV378.includes('acceptanceMode String @default("none")') &&
  policyAcceptanceSchemaV378.includes("subjectPolicyKey   String   @unique") &&
  policyAcceptanceMigrationV378.includes('CREATE TABLE "PolicyAcceptance"') &&
  policyAcceptanceMigrationV378.includes("DEFAULT 'none'") &&
  storageMigrations.includes('"PolicyAcceptance"') &&
  storageMigrations.includes('"PolicyAcceptance_subjectPolicyKey_key"'));
check("policy acceptance requirement selection and evidence verification fail closed",
  policyAcceptanceCoreV378.includes("policyRequirementHash") &&
  policyAcceptanceCoreV378.includes("acceptanceEvidenceHash") &&
  policyAcceptanceCoreV378.includes("verifyPolicyAcceptanceEvidence") &&
  policyAcceptanceCoreV378.includes('normalizePolicyAcceptanceMode(row.acceptanceMode) !== "none"') &&
  policyAcceptanceCoreV378.includes("policyAcceptanceDigest === current.digest"));
check("policy acceptance request boundary requires explicit current-version attestation",
  policyAcceptanceRoutesV378.includes('app.post("/api/legal/acceptance"') &&
  policyAcceptanceRoutesV378.includes("attestation: z.literal(true)") &&
  policyAcceptanceRoutesV378.includes("POLICY_ACCEPTANCE_STALE") &&
  policyAcceptanceRoutesV378.includes('String(error?.code || "") !== "P2002"') &&
  serverEntry.includes("ensureSessionPolicyAcceptance") &&
  serverEntry.includes("POLICY_ACCEPTANCE_REQUIRED"));
check("policy acceptance UI administration privacy and retention are wired",
  policyAcceptanceScreenV378.includes("Review current policies") &&
  policyAcceptanceScreenV378.includes('input type="checkbox"') &&
  policyAcceptanceAdminV378.includes("Policy acceptance history") &&
  policyAcceptanceAdminV378.includes("Integrity check failed") &&
  !legalComplianceCenterV376.includes("PolicyAcceptanceAdminPanel") &&
  privacyDataRoutesV378.includes("policyAcceptances") &&
  dataRetentionV378.includes("policy_acceptances"));
check("policy acceptance roadmap boundary is documented packaged and advertised",
  policyAcceptanceDocV378.includes("Roadmap Step 17 of 20") &&
  policyAcceptanceDocV378.includes("Publication and acceptance are separate actions") &&
  apiContracts.includes('policy-acceptance-v1') &&
  apiContracts.includes('2026-08-02.63') &&
  sharedErrorCodes.includes('POLICY_ACCEPTANCE_REQUIRED') &&
  (masterPackager.match(/docs\/AUDITABLE_POLICY_ACCEPTANCE\.md/g) || []).length >= 2);



const analyticsSchemaV379 = await text("apps/server/prisma/schema.prisma");
const analyticsMigrationV379 = await text("apps/server/prisma/migrations/20260820043000_behavioral_analytics_consent/migration.sql");
const analyticsCoreV379 = await text("apps/server/src/core/behavioral-analytics.ts");
const analyticsRoutesV379 = await text("apps/server/src/domains/legal/behavioral-analytics-routes.ts");
const analyticsAdminV379 = await text("packages/renderer/src/features/legal/BehavioralAnalyticsAdminPanel.tsx");
const analyticsManagerV379 = await text("packages/renderer/src/components/BehavioralAnalyticsManager.tsx");
const analyticsDocV379 = await text("docs/BEHAVIORAL_ANALYTICS_CONSENT.md");
check("behavioral analytics storage and provider default fail closed",
  analyticsSchemaV379.includes("model BehavioralAnalyticsProvider") && analyticsSchemaV379.includes("model BehavioralAnalyticsEvent") &&
  analyticsMigrationV379.includes("'builtin-cluster-first-party'") && analyticsMigrationV379.includes("false, true, false") &&
  storageMigrations.includes('"BehavioralAnalyticsEvent"'));
check("behavioral analytics event intake is consent-gated and allowlisted",
  analyticsCoreV379.includes('ANALYTICS_EVENT_NAMES = ["app_open", "screen_view"]') &&
  analyticsRoutesV379.includes("consent.analytics !== true") && analyticsRoutesV379.includes("ANALYTICS_CONSENT_REQUIRED") &&
  analyticsRoutesV379.includes("ANALYTICS_PROVIDER_REVIEW_REQUIRED"));
check("privacy consent v2 does not reinterpret earlier optional choices",
  privacyConsentCore.includes("PRIVACY_CONSENT_SCHEMA_VERSION = 2") && privacyConsentCore.includes('PRIVACY_CONSENT_NOTICE_VERSION = "2.0"') &&
  rendererPrivacyConsent.includes('cluster-privacy-consent-v2') && rendererPrivacyConsent.includes("analyticsAllowed"));
check("analytics administration is aggregate-only and retention/export aware",
  analyticsAdminV379.includes("No per-user analytics drilldown") && analyticsManagerV379.includes("analyticsAllowed") &&
  dataRetentionV378.includes('behavioral_analytics') && privacyDataRoutesV378.includes("behavioralAnalyticsEvents"));
check("behavioral analytics roadmap boundary is documented packaged and advertised",
  analyticsDocV379.includes("Roadmap Step 18 of 20") && apiContracts.includes("behavioral-analytics-consent-v1") &&
  apiContracts.includes("2026-08-02.63") && sharedErrorCodes.includes("ANALYTICS_CONSENT_REQUIRED") &&
  (masterPackager.match(/docs\/BEHAVIORAL_ANALYTICS_CONSENT\.md/g) || []).length >= 2);

const privacyErasureSchemaV380 = await text("apps/server/prisma/schema.prisma");
const privacyErasureMigrationV380 = await text("apps/server/prisma/migrations/20260820070000_privacy_erasure_fulfillment/migration.sql");
const privacyErasureCoreV380 = await text("apps/server/src/core/privacy-erasure.ts");
const privacyErasureRoutesV380 = await text("apps/server/src/domains/legal/privacy-data-routes.ts");
const privacyErasureAdminV380 = await text("packages/renderer/src/features/legal/PrivacyRequestsAdminPanel.tsx");
const privacyErasureDocV380 = await text("docs/PRIVACY_ERASURE_FULFILLMENT.md");
check("privacy erasure storage preserves explicit hold and fulfillment evidence",
  privacyErasureSchemaV380.includes("model PrivacyLegalHold") && privacyErasureSchemaV380.includes("model PrivacyErasureReceipt") &&
  privacyErasureMigrationV380.includes("PrivacyErasureReceipt_requestId_fkey") && storageMigrations.includes('"PrivacyLegalHold"') && storageMigrations.includes('"PrivacyErasureReceipt_requestId_key"'));
check("privacy erasure execution is approved idempotent pseudonymizing and fail closed on legal holds",
  privacyErasureCoreV380.includes('status !== "approved"') && privacyErasureCoreV380.includes("existingReceipt") &&
  privacyErasureCoreV380.includes('accountState: "PRIVACY_ERASED"') && privacyErasureCoreV380.includes("PRIVACY_ERASURE_LEGAL_HOLD") && privacyErasureCoreV380.includes("PRIVACY_ERASURE_SELF_BLOCKED"));
check("privacy erasure routes separate review preview fulfillment and legal hold authority",
  privacyErasureRoutesV380.includes('/erasure-plan') && privacyErasureRoutesV380.includes('/fulfill') &&
  privacyErasureRoutesV380.includes("FULFILL PRIVACY ERASURE") && privacyErasureRoutesV380.includes("CREATE PRIVACY LEGAL HOLD") && privacyErasureRoutesV380.includes("RELEASE PRIVACY LEGAL HOLD"));
check("privacy erasure administration exposes plans holds and explicit fulfillment",
  privacyErasureAdminV380.includes("Preview erasure") && privacyErasureAdminV380.includes("Active privacy legal holds") &&
  legalComplianceCoreV376.includes("approvedErasureRequests") && legalComplianceCoreV376.includes("activeLegalHolds"));
check("privacy erasure roadmap boundary is documented packaged and advertised",
  privacyErasureDocV380.includes("Roadmap Step 19 of 20") && privacyErasureDocV380.includes("historical backup generations") &&
  apiContracts.includes("privacy-erasure-fulfillment-v1") && apiContracts.includes("2026-08-02.63") &&
  sharedErrorCodes.includes("PRIVACY_ERASURE_LEGAL_HOLD") && (masterPackager.match(/docs\/PRIVACY_ERASURE_FULFILLMENT\.md/g) || []).length >= 2);


const legalRoadmapEvidenceV381 = await text("tools/scripts/legal-roadmap-evidence.mjs");
const legalRoadmapDocV381 = await text("docs/LEGAL_PRIVACY_ACCESSIBILITY_RELEASE_READINESS.md");
const releaseLedgerV381 = await text("tools/scripts/release-certification-ledger.mjs");
const releaseVerifierV381 = await text("tools/scripts/release-verify-artifacts.mjs");
const releaseWorkflowV381 = await text(".github/workflows/release.yml");
check("legal roadmap evidence generator binds all 20 steps without claiming legal certification",
  legalRoadmapEvidenceV381.includes('totalSteps: 20') && legalRoadmapEvidenceV381.includes('legalCertification: false') &&
  legalRoadmapEvidenceV381.includes('LEGAL_PRIVACY_ACCESSIBILITY_RELEASE_READINESS.md') && legalRoadmapEvidenceV381.includes('recordHash'));
check("legal compliance evidence export is aggregate admin recent-authenticated and audit logged",
  legalComplianceRoutesV376.includes('app.post("/api/admin/legal/compliance/evidence"') &&
  legalComplianceRoutesV376.includes('authorization.requireAdmin') && legalComplianceRoutesV376.includes('legal.compliance_evidence_exported') &&
  legalComplianceCoreV376.includes('scope: "aggregate-deployment-posture"') && legalComplianceCoreV376.includes('containsUserList: false') &&
  !legalComplianceCenterV376.includes('Download evidence snapshot') && serverEntry.includes('registerLegalComplianceRoutes({ app, prisma, readSettings, authorization, logSecurityEvent })'));
check("certified release boundary requires and verifies consolidated legal roadmap evidence",
  releaseLedgerV381.includes('"legal-readiness"') && releaseLedgerV381.includes('roadmapEvidence') &&
  releaseVerifierV381.includes('Evidence/legal-privacy-accessibility-roadmap.json') &&
  masterPackager.includes('legal-roadmap-evidence.mjs') && masterPackager.includes('Evidence/legal-privacy-accessibility-roadmap.json') &&
  (!repositoryCiAvailable || releaseWorkflowV381.includes('--gate=legal-readiness')));
check("legal privacy accessibility roadmap completion is documented packaged and advertised",
  legalRoadmapDocV381.includes('Roadmap Step 20 of 20') && legalRoadmapDocV381.includes('20/20 implementation-complete') &&
  apiContracts.includes('legal-roadmap-evidence-v1') && apiContracts.includes('2026-08-02.63') &&
  (masterPackager.match(/docs\/LEGAL_PRIVACY_ACCESSIBILITY_RELEASE_READINESS\.md/g) || []).length >= 2);


check("roadmap step 2 centralizes renderer design tokens",
  styles.indexOf('@import \"./styles/design-system/tokens.css\";') >= 0 &&
  styles.indexOf('@import \"./styles/design-system/tokens.css\";') < styles.indexOf('@import \"./styles/application.css\";') &&
  designSystemTokens.includes("--ds-bg:") &&
  designSystemTokens.includes("--cluster-font-sans:") &&
  designSystemTokens.includes("--space-7:") &&
  designSystemTokens.includes(':root[data-theme="dark"]'));
check("roadmap step 2 keeps application css behind bounded compatibility barrels",
  (await text("packages/renderer/src/styles/application.css")).includes('application-workspaces.css') &&
  (await text("packages/renderer/src/features/application/application-refinements.css")).includes('refinements-workspaces.css'));
check("roadmap step 2 exposes a live design-system preview",
  designSystemPreview.includes("design-system-preview-v383") &&
  (await text("packages/renderer/src/features/settings/AccountSettingsPage.tsx")).includes("<DesignSystemPreview />") &&
  designSystemPrimitives.includes("design-system-state-v383"));
check("roadmap step 2 design-system boundary is documented and release-blocking",
  packageJson.scripts.audit.includes("design-system-audit.mjs") &&
  designSystemDoc.includes("Core Product & Architecture Roadmap Step 2 of 20") &&
  (await text("tools/scripts/package-cluster-master.mjs")).includes("design-system-audit.mjs"));
check("production polish phase 1 centralizes application stylesheet ownership",
  (await text("packages/renderer/src/features/application/application-refinements.css")).includes("Owned only by ClusterApplication.tsx") &&
  !(await text("packages/renderer/src/features/application/modules/application-shell.tsx")).includes("application-refinements.css") &&
  !(await text("packages/renderer/src/features/application/modules/application-workspaces.tsx")).includes("application-refinements.css") &&
  !(await text("packages/renderer/src/features/application/modules/application-operations.tsx")).includes("application-refinements.css") &&
  !(await text("packages/renderer/src/features/application/modules/application-foundation.tsx")).includes("application-refinements.css"));
check("production polish phase 1 CSS debt ratchet is documented and release blocking",
  packageJson.scripts.audit.includes("css-architecture-audit.mjs") &&
  (await text("tools/scripts/package-cluster-master.mjs")).includes("css-architecture-audit.mjs") &&
  (await text("docs/CSS_ARCHITECTURE_PHASE1.md")).includes("Highest-priority migration queue") &&
  (await text("packages/renderer/src/styles/ARCHITECTURE.md")).includes("The cascade is an API") &&
  (await text("config/css-architecture-baseline.json")).includes('"generatedFor": "0.425.0"'));

const backendArchitectureDocV384 = await text("docs/BACKEND_ARCHITECTURE_OVERHAUL.md");
const backendJobQueueV384 = await text("apps/server/src/domains/jobs/job-queue-service.ts");
const backendJobWorkerV384 = await text("apps/server/src/domains/jobs/job-worker.ts");
const backendJobRoutesV384 = await text("apps/server/src/domains/jobs/job-routes.ts");
const backendJobRuntimeV384 = await text("apps/server/src/app/server-job-runtime.ts");
const backendDomainCatalogV384 = await text("apps/server/src/app/server-domain-catalog.ts");
const backendArchitectureRoutesV384 = await text("apps/server/src/domains/admin/server-architecture-routes.ts");
const backendJobMigrationV384 = await text("apps/server/prisma/migrations/20260820080000_backend_architecture_jobs/migration.sql");
const backendServerAuditV384 = await text("tools/scripts/server-architecture-audit.mjs");
const backendJobsPanelV384 = await text("packages/renderer/src/features/admin/BackgroundJobsPanel.tsx");
const backendAdminWorkspaceV384 = await text("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
check("updated roadmap step 3 stores durable leased jobs and attempt evidence",
  schema.includes("model BackgroundJob {") && schema.includes("model BackgroundJobAttempt {") &&
  backendJobMigrationV384.includes('CREATE TABLE "BackgroundJob"') && backendJobMigrationV384.includes('CREATE TABLE "BackgroundJobAttempt"') &&
  storageMigrations.includes('"BackgroundJob"') && storageMigrations.includes('"BackgroundJobAttempt"'));
check("updated roadmap step 3 claims jobs safely and preserves retry history",
  backendJobQueueV384.includes("FOR UPDATE SKIP LOCKED") && backendJobQueueV384.includes("pg_advisory_xact_lock") &&
  backendJobQueueV384.includes('"leaseExpiresAt"') && backendJobQueueV384.includes("DEAD_LETTER") &&
  !backendJobQueueV384.includes('"attempts" = 0') && backendJobQueueV384.includes('cancelled ? "CANCELLED" : terminal ? "DEAD_LETTER" : "QUEUED"'));
check("updated roadmap step 3 keeps background-job authority narrow",
  backendJobRoutesV384.includes('requireAdminUserForRequest') && backendJobRoutesV384.includes('/retry"') && backendJobRoutesV384.includes('/cancel"') &&
  !backendJobRoutesV384.includes('app.post("/api/admin/operations/jobs"') && backendJobWorkerV384.includes("heartbeat(job.id"));
check("updated roadmap step 3 moves major legacy route ownership into domains",
  backendDomainCatalogV384.includes('key: "library"') && backendDomainCatalogV384.includes('key: "time"') && backendDomainCatalogV384.includes('key: "jobs"') &&
  (await text("apps/server/src/routes/library-routes.ts")).includes('../domains/library/library-routes.js') &&
  (await text("apps/server/src/routes/time-routes.ts")).includes('../domains/time/time-routes.js') &&
  (await text("apps/server/src/routes/admin-tool-routes.ts")).includes('../domains/admin/admin-tool-routes.js'));
check("updated roadmap step 3 routes recurring work through the durable queue and exposes posture",
  backendJobRuntimeV384.includes('automation.project-overdue') && backendJobRuntimeV384.includes('automation.studio-action') &&
  backendJobRuntimeV384.includes('system.job-history-prune') && backendArchitectureRoutesV384.includes('eventBus.snapshot()') && backendArchitectureRoutesV384.includes('jobQueue.counts()'));
check("updated roadmap step 3 exposes administrator job monitoring without generic enqueue",
  backendJobsPanelV384.includes('/api/admin/operations/jobs?limit=12') && backendJobsPanelV384.includes('Background jobs') &&
  backendJobsPanelV384.includes('runAction(job, "cancel")') && backendJobsPanelV384.includes('runAction(job, "retry")') &&
  backendAdminWorkspaceV384.includes('<BackgroundJobsPanel />') && !backendJobsPanelV384.includes('/api/admin/operations/jobs", { method: "POST"'));
check("updated roadmap step 3 advertises and release-blocks backend architecture",
  apiContracts.includes('server-domain-architecture-v1') && apiContracts.includes('durable-background-jobs-v1') && apiContracts.includes('2026-08-02.63') &&
  sharedErrorCodes.includes('BACKGROUND_JOB_NOT_FOUND') && backendArchitectureDocV384.includes('Core Product & Architecture Roadmap Step 3 of 7') &&
  packageJson.scripts.audit.includes('server-architecture-audit.mjs') && backendServerAuditV384.includes('server relative-import graph is cycle free') &&
  masterPackager.includes('server-architecture-audit.mjs') && (masterPackager.match(/docs\/BACKEND_ARCHITECTURE_OVERHAUL\.md/g) || []).length >= 2);
const step4DesktopDoc = await text("docs/DESKTOP_SYNC_OVERHAUL.md");
const step4ParityManifest = await text("config/desktop-parity-surfaces.json");
const step4ParityAudit = await text("tools/scripts/desktop-parity-audit.mjs");
const step4DesktopSyncAudit = await text("tools/scripts/desktop-sync-audit.mjs");
const step4NativeBroker = await text("apps/desktop-qt/src/NativeCapabilityBroker.cpp");
const step4NativeBrokerHeader = await text("apps/desktop-qt/src/NativeCapabilityBroker.h");
const step4DesktopIntegration = await text("apps/desktop-qt/src/DesktopIntegration.cpp");
const step4SharedRenderer = await text("apps/desktop-qt/qml/pages/SharedRendererPage.qml");
const step4OfflineRuntime = await text("packages/renderer/src/core/offline-runtime.ts");
const step4SyncIndicator = await text("packages/renderer/src/components/SyncStatusIndicator.tsx");
const step4CollabRuntime = await text("apps/server/src/core/collaboration-runtime.ts");
const step4CollabRenderer = await text("packages/renderer/src/features/collaboration/index.tsx");
check("updated roadmap step 4 owns native desktop broker v2 without raw path exposure",
  step4NativeBrokerHeader.includes("return 3;") && step4NativeBroker.includes('QStringLiteral("watch.start")') &&
  step4NativeBroker.includes('QStringLiteral("clipboard.writeText")') && step4NativeBroker.includes('QStringLiteral("rawFilesystemPathsExposed")') &&
  !step4NativeBroker.includes('QStringLiteral("clipboard.read")'));
check("updated roadmap step 4 release-blocks shared renderer desktop parity",
  step4ParityManifest.includes('"renderer": "shared-web-renderer"') && step4ParityManifest.includes('"screen": "whiteboard"') &&
  step4SharedRenderer.includes("clusterDesktop=1") && step4DesktopIntegration.includes("Qt::BackButton") &&
  packageJson.scripts.audit.includes("desktop-parity-audit.mjs") && masterPackager.includes("desktop-parity-audit.mjs") &&
  step4ParityAudit.includes("Cluster desktop parity audit"));
check("updated roadmap step 4 exposes server-backed Offline Sync v2 posture",
  step4OfflineRuntime.includes("refreshServerSyncPosture") && step4OfflineRuntime.includes("serverOpenConflicts") &&
  step4SyncIndicator.includes("sync-center-metrics-v385") && step4SyncIndicator.includes("Server seen"));
check("updated roadmap step 4 versions recoverable realtime collaboration transport",
  step4CollabRuntime.includes("transportVersion: 2") && step4CollabRuntime.includes("fullStateFrames: true") &&
  step4CollabRuntime.includes("streamOpenCount") && step4CollabRenderer.includes("sequenceGaps") && step4CollabRenderer.includes("recovered gap"));
check("updated roadmap step 4 capability and documentation boundary is current",
  apiContracts.includes("desktop-sync-overhaul-v2") && apiContracts.includes("realtime-collaboration-v2") && apiContracts.includes("2026-08-02.63") &&
  step4DesktopDoc.includes("Core Product & Architecture Roadmap Step 4 of 7") &&
  packageJson.scripts.audit.includes("desktop-sync-audit.mjs") && masterPackager.includes("docs/DESKTOP_SYNC_OVERHAUL.md") &&
  step4DesktopSyncAudit.includes("Cluster desktop & sync audit"));

const step5IntelligenceService = await text("apps/server/src/domains/projects/project-intelligence-service.ts");
const step5IntelligenceRoutes = await text("apps/server/src/domains/projects/project-intelligence-routes.ts");
const step5SearchBuilder = await text("apps/server/src/domains/search/search-index-builder.ts");
const step5Automation = await text("apps/server/src/domains/automation/studio-automation-service.ts");
const step5WorkflowRoutes = await text("apps/server/src/domains/projects/project-workflow-routes.ts");
const step5Audit = await text("tools/scripts/project-intelligence-audit.mjs");
const step5Doc = await text("docs/PROJECT_INTELLIGENCE_OVERHAUL.md");
check("updated roadmap step 5 indexes project delivery records as first-class search results",
  step5SearchBuilder.includes('kind: "control"') && step5SearchBuilder.includes("corpus.workflowRecords") &&
  apiContracts.includes("search-v2") && apiContracts.includes("search: 2"));
check("updated roadmap step 5 exposes authorized project delivery intelligence",
  step5IntelligenceService.includes("releaseReadyBuilds") && step5IntelligenceService.includes('relationship: "verified_by"') &&
  step5IntelligenceRoutes.includes('/api/projects/:projectId/intelligence') && step5IntelligenceRoutes.includes('"view"'));
check("updated roadmap step 5 runs Studio Automation entirely through durable jobs",
  step5Automation.includes('type: "automation.studio-action"') && step5Automation.includes("migrateLegacyJobs") &&
  !step5Automation.includes('const JOB_KIND = "studioAutomationJob"'));
check("updated roadmap step 5 emits Build and QA transitions from server-owned workflow writes",
  step5WorkflowRoutes.includes('return "build_failed"') && step5WorkflowRoutes.includes('return "build_completed"') &&
  step5WorkflowRoutes.includes('return "qa_failed"') && step5WorkflowRoutes.includes('return "qa_passed"'));
check("updated roadmap step 5 capability documentation and release gate are current",
  apiContracts.includes("project-intelligence-v1") && apiContracts.includes("build-qa-traceability-v1") && apiContracts.includes("workflow-automation-v2") && apiContracts.includes("2026-08-02.63") &&
  step5Doc.includes("Core Product & Architecture Roadmap Step 5 of 7") && packageJson.scripts.audit.includes("project-intelligence-audit.mjs") &&
  masterPackager.includes("project-intelligence-audit.mjs") && step5Audit.includes("Cluster project intelligence audit"));

const step6NotificationSchema = await text("apps/server/prisma/schema.prisma");
const step6NotificationService = await text("apps/server/src/domains/notifications/notification-service.ts");
const step6NotificationRepository = await text("apps/server/src/domains/notifications/notification-repository.ts");
const step6NotificationRoutes = await text("apps/server/src/domains/notifications/notification-routes.ts");
const step6Inbox = await text("packages/renderer/src/features/notifications/NotificationInboxPage.tsx");
const step6Shell = await text("packages/renderer/src/features/application/modules/application-shell.tsx");
const step6Budgets = await text("apps/server/src/core/performance-budgets.ts");
const step6DatabaseDiagnostics = await text("apps/server/src/core/database-diagnostics.ts");
const step6OperationsRoutes = await text("apps/server/src/app/server-routes-health-operations.ts");
const step6PerformancePanel = await text("packages/renderer/src/features/operations/ServerPerformancePanel.tsx");
const step6Audit = await text("tools/scripts/operations-performance-audit.mjs");
const step6Doc = await text("docs/OPERATIONS_PERFORMANCE_OVERHAUL.md");
check("updated roadmap step 6 owns a durable server-backed work inbox",
  step6NotificationSchema.includes("model NotificationInboxItem") && step6NotificationRepository.includes("userId_activityEventId") &&
  step6NotificationService.includes('subscribe("activity.recorded"') && step6NotificationRoutes.includes('/api/notifications/snooze'));
check("updated roadmap step 6 avoids historical unread notification floods",
  step6NotificationService.includes("materialize(event, { historical: true })") && step6NotificationRepository.includes("readAt: input.readAt"));
check("updated roadmap step 6 removes shell notification fan-out",
  step6Shell.includes('/api/notifications/summary') && !step6Shell.includes("makeNotificationRows") && step6Inbox.includes('/api/notifications/digest'));
check("updated roadmap step 6 defines enforceable performance budgets",
  step6Budgets.includes("requestP99Ms") && step6Budgets.includes("databaseP99Ms") && step6Budgets.includes("postgresCacheHitRatio") && step6Budgets.includes("deadLetterJobs"));
check("updated roadmap step 6 exposes PostgreSQL query pressure diagnostics",
  step6DatabaseDiagnostics.includes("pg_stat_user_tables") && step6DatabaseDiagnostics.includes("pg_stat_user_indexes") && step6DatabaseDiagnostics.includes("recommendations"));
check("updated roadmap step 6 exposes administrator performance posture",
  step6OperationsRoutes.includes('/api/admin/operations/performance') && step6OperationsRoutes.includes("assessServerPerformance") && step6PerformancePanel.includes("Server performance"));
check("updated roadmap step 6 capability documentation and release gate are current",
  apiContracts.includes("work-inbox-v2") && apiContracts.includes("operations-observability-v2") && apiContracts.includes("performance-budgets-v1") && apiContracts.includes("postgresql-scalability-v2") && apiContracts.includes("2026-08-02.63") &&
  step6Doc.includes("Core Product & Architecture Roadmap Step 6 of 7") && packageJson.scripts.audit.includes("operations-performance-audit.mjs") && masterPackager.includes("operations-performance-audit.mjs") && step6Audit.includes("Cluster operations & performance audit"));

const step7Registry = await text("apps/server/src/domains/integrations/integration-provider-registry.ts");
const step7IntegrationRoutes = await text("apps/server/src/domains/integrations/integration-routes.ts");
const step7E2e = await text("tools/scripts/e2e-ci.mjs");
const step7UxAudit = await text("tools/scripts/ux-consistency-audit.mjs");
const step7PlatformAudit = await text("tools/scripts/platform-production-audit.mjs");
const step7Doc = await text("docs/PLATFORM_PRODUCTION_RELEASE.md");
const step7ReleaseWorkflow = await text(".github/workflows/release.yml");
const step7Verifier = await text("tools/scripts/release-verify-artifacts.mjs");
check("updated roadmap step 7 owns trusted integration provider contracts",
  step7Registry.includes("class IntegrationProviderRegistry") && step7Registry.includes("source.gitea") && step7Registry.includes("communication.discord") && step7Registry.includes("media.youtube") &&
  step7IntegrationRoutes.includes("trusted-server-registration-only") && step7IntegrationRoutes.includes("dynamicCodeLoading: false"));
check("updated roadmap step 7 exposes provider posture without secret values",
  step7IntegrationRoutes.includes("/api/admin/integrations/providers") && !step7IntegrationRoutes.includes("giteaToken:") && !step7IntegrationRoutes.includes("discordBotToken:"));
check("updated roadmap step 7 release-blocks production browser E2E",
  step7E2e.includes("cluster_e2e_") && step7E2e.includes("/api/auth/csrf") && step7E2e.includes("/api/command/search") && (!repositoryCiAvailable || step7ReleaseWorkflow.includes("--gate=production-e2e")));
check("updated roadmap step 7 release-blocks product-wide UX consistency",
  step7UxAudit.includes("native browser dialog debt does not increase") && (!repositoryCiAvailable || step7ReleaseWorkflow.includes("--gate=ux-consistency")) && packageJson.scripts.audit.includes("ux-consistency-audit.mjs"));
check("updated roadmap step 7 strengthens public release evidence requirements",
  step7Verifier.includes('"production-e2e"') && step7Verifier.includes('"ux-consistency"') && apiContracts.includes("public-release-certification-v2") && apiContracts.includes("2026-08-02.63"));
check("updated roadmap step 7 capability documentation and release gate are current",
  step7Doc.includes("Core Product & Architecture Roadmap Step 7 of 7") && step7PlatformAudit.includes("Cluster platform & production audit") && packageJson.scripts.audit.includes("platform-production-audit.mjs") && masterPackager.includes("docs/PLATFORM_PRODUCTION_RELEASE.md"));

const polishRuntimeStyle = await text("packages/renderer/src/core/runtime-style.ts");
const polishLoadingStates = await text("packages/renderer/src/components/LoadingState.tsx");
const polishSkeletonStyles = await text("packages/renderer/src/styles/design-system/skeletons.css");
const polishServerStatus = await text("packages/renderer/src/components/AppVersionFooter.tsx");
const polishDoc = await text("docs/UX_POLISH_PASS_1.md");
const polishBaseline = JSON.parse(await text("config/ux-debt-baseline.json"));
const polishColorBaseline = JSON.parse(await text("config/design-system-color-baseline.json"));
check("UX polish pass 1 eliminates direct inline style-object debt", polishBaseline.inlineStyleObjectMaximum === 0 && polishRuntimeStyle.includes("ALLOWED_PROPERTIES"));
check("UX polish pass 1 owns structural skeleton loading", polishLoadingStates.includes("SettingsLoadingState") && polishLoadingStates.includes("PolicyLoadingState") && polishSkeletonStyles.includes("prefers-reduced-motion"));
check("UX polish pass 1 exposes richer public server posture without detailed dependencies", polishServerStatus.includes("server-status-popover-v390") && step6OperationsRoutes.includes("signals: operational.checks.map") && step6OperationsRoutes.includes('/api/admin/operations/health'));
check("UX polish pass 1 color ratchet remains at or below its original baseline", Object.values(polishColorBaseline.files || {}).reduce((sum, value) => sum + Number(value || 0), 0) <= 3428);
check("UX polish pass 1 API and documentation boundary is current", apiContracts.includes("skeleton-loading-v1") && apiContracts.includes("public-health-status-v2") && apiContracts.includes("ux-polish-pass-1-v1") && apiContracts.includes("2026-08-02.63") && polishDoc.includes("Cluster v0.390.0"));

const polish2Styles = await text("packages/renderer/src/styles/design-system/workspace-polish.css");
const polish2Audit = await text("tools/scripts/ux-polish-pass-two-audit.mjs");
const polish2Doc = await text("docs/UX_POLISH_PASS_2.md");
const polish2ToolHeader = await text("packages/renderer/src/components/ToolPageHeader.tsx");
const polish2Context = await text("packages/renderer/src/components/ProjectToolContextBar.tsx");
const polish2ProjectPrimitives = await text("packages/renderer/src/features/projects/ProjectWorkspacePrimitives.tsx");
check("UX polish pass 2 standardizes shared workspace chrome", polish2Styles.includes("cluster-workspace-header-v391") && polish2Styles.includes("cluster-context-bar-v391") && polish2Styles.includes("cluster-section-nav-v391") && polish2Styles.includes("cluster-toolbar-v391"));
check("UX polish pass 2 routes shared components through the workspace contracts", polish2ToolHeader.includes("cluster-workspace-header-v391") && polish2Context.includes("cluster-context-bar-v391") && polish2ProjectPrimitives.includes("cluster-workspace-section-head-v391"));
check("UX polish pass 2 is release-blocked and packaged", packageJson.scripts.audit.includes("ux-polish-pass-two-audit.mjs") && masterPackager.includes("ux-polish-pass-two-audit.mjs") && masterPackager.includes("docs/UX_POLISH_PASS_2.md") && polish2Audit.includes("Cluster UX polish pass 2 audit"));
check("UX polish pass 2 API and documentation boundary is current", apiContracts.includes("ux-polish-pass-2-v1") && apiContracts.includes("2026-08-02.63") && polish2Doc.includes("Cluster v0.391.0"));

const polish3Doc = await text("docs/UX_POLISH_PASS_3.md");
const polish3Audit = await text("tools/scripts/ux-polish-pass-three-audit.mjs");
const polish3Tokens = await text("packages/renderer/src/styles/design-system/tokens.css");
const polish3ColorTotal = Object.values(polishColorBaseline.files || {}).reduce((sum, value) => sum + Number(value || 0), 0);
check("UX polish pass 3 centralizes the repeated migration palette", polish3Tokens.includes("--cluster-white: #ffffff") && polish3Tokens.includes("--cluster-slate-900: #0f172a") && polish3Tokens.includes("--cluster-blue-300: #93c5fd"));
check("UX polish pass 3 lowers and versions the raw color ratchet", polishColorBaseline.version === 3 && polish3ColorTotal <= 1576);
check("UX polish pass 3 is release-blocked and packaged", packageJson.scripts.audit.includes("ux-polish-pass-three-audit.mjs") && masterPackager.includes("ux-polish-pass-three-audit.mjs") && masterPackager.includes("docs/UX_POLISH_PASS_3.md") && polish3Audit.includes("Cluster UX polish pass 3 audit"));
check("UX polish pass 3 API and documentation boundary is current", apiContracts.includes("ux-polish-pass-3-v1") && apiContracts.includes("2026-08-02.63") && polish3Doc.includes("Cluster v0.392.0") && polish3Doc.includes("1,576"));

const polish4Doc = await text("docs/UX_POLISH_PASS_4.md");
const polish4Audit = await text("tools/scripts/ux-polish-pass-four-audit.mjs");
const polish4Accessibility = await text("tools/scripts/accessibility-static-audit.mjs");
const polish4Calendar = await text("packages/renderer/src/features/calendar/CalendarPage.tsx");
const polish4Library = await text("packages/renderer/src/features/library/LibraryWorkspacePage.tsx");
check("UX polish pass 4 blocks pointer-only non-semantic controls", polish4Accessibility.includes("nonSemanticInteractiveTags") && polish4Accessibility.includes("pointer-only <${tag}> interaction is prohibited"));
check("UX polish pass 4 provides explicit Calendar and Library interaction paths", polish4Calendar.includes("calendar-day-select-v393") && polish4Calendar.includes("calendar-week-day-trigger-v393") && !polish4Library.includes("onDoubleClick"));
check("UX polish pass 4 is release-blocked and packaged", packageJson.scripts.audit.includes("ux-polish-pass-four-audit.mjs") && masterPackager.includes("ux-polish-pass-four-audit.mjs") && masterPackager.includes("docs/UX_POLISH_PASS_4.md") && polish4Audit.includes("Cluster UX polish pass 4 audit"));
check("UX polish pass 4 API and documentation boundary is current", apiContracts.includes("ux-polish-pass-4-v1") && apiContracts.includes("2026-08-02.63") && polish4Doc.includes("Cluster v0.393.0"));

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail && !item.ok ? ` (${item.detail})` : ""}`);
console.log(`
Cluster source audit: ${checks.length - errors.length}/${checks.length} passed.`);
if (errors.length) process.exit(1);
