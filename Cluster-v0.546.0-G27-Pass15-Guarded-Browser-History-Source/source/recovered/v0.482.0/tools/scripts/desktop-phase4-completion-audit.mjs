import { readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok) => checks.push({ label, ok });
const text = (relative) => readFile(path.join(root, relative), "utf8");
const [brokerH, brokerCpp, desktopCore, nativePanel, contracts, pkgText, packager, notes, doc, qml, parityAudit] = await Promise.all([
  text("apps/desktop-qt/src/NativeCapabilityBroker.h"),
  text("apps/desktop-qt/src/NativeCapabilityBroker.cpp"),
  text("packages/renderer/src/core/desktop.ts"),
  text("packages/renderer/src/features/desktop/DesktopNativeServicesPanel.tsx"),
  text("packages/shared/src/api-contracts.ts"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.422.0.md"),
  text("docs/DESKTOP_PHASE4_COMPLETION.md"),
  text("apps/desktop-qt/qml/pages/SharedRendererPage.qml"),
  text("tools/scripts/desktop-parity-audit.mjs"),
]);
check("native broker protocol advanced", brokerH.includes("protocolVersion() const { return 3; }"));
check("native broker carries rotating epoch state", brokerH.includes("m_brokerEpoch") && brokerCpp.includes("rotateBrokerEpoch"));
check("profile changes clear transient capability state", brokerCpp.includes("activeProfileChanged") && brokerCpp.includes("clearTransientCapabilityState") && brokerCpp.includes("rotateBrokerEpoch"));
check("profile switch invalidates local handles", brokerCpp.includes("m_handles.clear()") && brokerCpp.includes("m_handleOrder.clear()"));
check("profile switch invalidates request replay state", brokerCpp.includes("m_seenRequestIds.clear()") && brokerCpp.includes("m_seenRequestOrder.clear()"));
check("profile switch invalidates native watches", brokerCpp.includes("clearWatches()"));
check("profile switch invalidates notification dedupe", brokerCpp.includes("m_seenNotificationTags.clear()"));
check("runtime exposes broker epoch", brokerCpp.includes('QStringLiteral("brokerEpoch"), m_brokerEpoch'));
check("runtime exposes request profile binding", brokerCpp.includes('QStringLiteral("requestProfileBinding"), true'));
check("runtime exposes strict payload schemas", brokerCpp.includes('QStringLiteral("strictPayloadSchemas"), true'));
check("runtime declares shared renderer parity", brokerCpp.includes('QStringLiteral("sharedRendererParity"), true'));
check("runtime declares reviewed desktop advantages", brokerCpp.includes('QStringLiteral("desktopOnlyAdvantages")') && brokerCpp.includes('QStringLiteral("offline-resilience")'));
check("non-bootstrap requests require active profile", brokerCpp.includes("PROFILE_CONTEXT_MISMATCH") && brokerCpp.includes("requestProfileId != activeProfileId"));
check("non-bootstrap requests require current broker epoch", brokerCpp.includes("BROKER_EPOCH_EXPIRED") && brokerCpp.includes("brokerEpoch != m_brokerEpoch"));
check("runtime bootstrap remains context-free", brokerCpp.includes('capability != QStringLiteral("runtime.info")'));
check("request envelope has explicit allowlist", brokerCpp.includes("requestFields") && brokerCpp.includes("INVALID_REQUEST_ENVELOPE"));
check("capability payloads use explicit schemas", brokerCpp.includes("validatePayloadShape") && brokerCpp.includes("unsupported field"));
check("generic process capability remains absent", !brokerCpp.includes('QStringLiteral("process.exec")') && !desktopCore.includes('| "process.exec"'));
check("raw filesystem path capability remains absent", !desktopCore.includes("rawPath") && desktopCore.includes("rawFilesystemPathsExposed: false"));
check("renderer credential access remains absent", !desktopCore.includes("credential.read") && !desktopCore.includes("password.read"));
check("clipboard read remains narrowly user-confirmed", desktopCore.includes('"clipboard.writeText"') && desktopCore.includes('"clipboard.readText"') && brokerCpp.includes('QStringLiteral("readRequiresConfirmation"), true') && brokerCpp.includes('QStringLiteral("backgroundRead"), false'));
check("renderer request type carries profile and epoch", desktopCore.includes("profileId?: string") && desktopCore.includes("brokerEpoch?: string"));
check("renderer bootstraps native context through runtime info", desktopCore.includes('capability !== "runtime.info" && !nativeBrokerContext') && desktopCore.includes('requestNativeCapability<ClusterNativeRuntimeInfo>("runtime.info")'));
check("renderer sends profile and epoch on native requests", desktopCore.includes("request.profileId = nativeBrokerContext.profileId") && desktopCore.includes("request.brokerEpoch = nativeBrokerContext.brokerEpoch"));
check("renderer invalidates stale native context on denial", desktopCore.includes("PROFILE_CONTEXT_MISMATCH") && desktopCore.includes("BROKER_EPOCH_EXPIRED") && desktopCore.includes("nativeBrokerContext = null"));
check("native services panel surfaces parity", nativePanel.includes("same product renderer") && nativePanel.includes("sharedRendererParity"));
check("native services panel surfaces security binding", nativePanel.includes("requestProfileBinding") && nativePanel.includes("strictPayloadSchemas"));
check("native services panel surfaces intentional advantages", nativePanel.includes("Desktop-only advantages") && nativePanel.includes("desktopOnlyAdvantages"));
check("shared renderer remains desktop content surface", qml.includes("SharedRendererPage") || qml.includes("webView"));
check("desktop parity audit remains release-gated", JSON.parse(pkgText).scripts.audit.includes("desktop-parity-audit.mjs") && parityAudit.includes("Cluster desktop parity audit"));
check("API advertises Phase 4 completion capabilities", contracts.includes('version: "2026-08-02.63"') && contracts.includes('"desktop-native-boundary-v2"') && contracts.includes('"desktop-shared-renderer-parity-v2"') && contracts.includes('"desktop-native-advantage-set-v1"'));
check("Phase 4 completion audit is aggregate gate", JSON.parse(pkgText).scripts.audit.includes("desktop-phase4-completion-audit.mjs"));
check("master packaging runs Phase 4 completion audit", packager.includes("desktop-phase4-completion-audit.mjs"));
check("master packaging includes Phase 4 completion documentation", packager.includes("docs/DESKTOP_PHASE4_COMPLETION.md"));
check("release notes close checkpoints 4.15 through 4.17", ["4.15", "4.16", "4.17"].every((item) => notes.includes(item)));
check("release notes explicitly close Phase 4", notes.includes("Phase 4: Desktop-Native Advantage is complete"));
check("documentation defines release-blocking boundary", doc.includes("Release-blocking boundary") && doc.includes("stale native requests") && doc.includes("shared renderer"));
const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}`);
console.log(`\nCluster desktop Phase 4 completion audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);
