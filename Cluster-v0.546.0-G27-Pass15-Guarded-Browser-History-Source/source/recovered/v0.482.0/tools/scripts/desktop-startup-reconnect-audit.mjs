import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok) => checks.push({ label, ok });
const text = (relative) => readFile(path.join(root, relative), "utf8");

const [controllerHeader, controller, profileHeader, profileStore, serverPage, rendererPage, contracts, pkgText, packager, notes, doc] = await Promise.all([
  text("apps/desktop-qt/src/AppController.h"),
  text("apps/desktop-qt/src/AppController.cpp"),
  text("apps/desktop-qt/src/ServerProfileStore.h"),
  text("apps/desktop-qt/src/ServerProfileStore.cpp"),
  text("apps/desktop-qt/qml/pages/ServerPage.qml"),
  text("apps/desktop-qt/qml/pages/SharedRendererPage.qml"),
  text("packages/shared/src/api-contracts.ts"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.398.0.md"),
  text("docs/DESKTOP_STARTUP_RECONNECT.md"),
]);

check("connection recovery is exposed to QML", controllerHeader.includes("Q_PROPERTY(QVariantMap connectionRecovery") && controllerHeader.includes("connectionRecoveryChanged"));
check("manual retry is exposed to QML", controllerHeader.includes("Q_INVOKABLE void retryConnectionNow()"));
check("validated recovery has a dedicated renderer signal", controllerHeader.includes("void connectionRecovered()"));
check("reconnect timer is single shot", controller.includes("m_reconnectTimer->setSingleShot(true)"));
check("old permanent 15 second poll is removed", !controller.includes("m_reconnectTimer->setInterval(15'000)") && !controller.includes("m_reconnectTimer->start();\n\n    m_projectsModel"));
check("backoff starts at two seconds", controller.includes("ReconnectBaseDelayMs = 2'000"));
check("backoff is capped at sixty seconds", controller.includes("ReconnectMaximumDelayMs = 60'000"));
check("backoff grows exponentially", controller.includes("ReconnectBaseDelayMs * (1 << shift)"));
check("bootstrap has an internal retry-safe path", controllerHeader.includes("startServerBootstrap(bool resetBackoff)") && controller.includes("AppController::startServerBootstrap(bool resetBackoff)"));
check("manual connect resets recovery backoff", controller.includes("void AppController::connectToServer()") && controller.includes("startServerBootstrap(true)"));
check("timer reconnect does not reset backoff", controller.includes("startServerBootstrap(false)"));
check("retryable bootstrap failures schedule recovery", controller.includes("operation == QStringLiteral(\"health\")") && controller.includes("scheduleReconnect(error)"));
check("nonretryable bootstrap failures stop on server state", controller.includes("resetReconnectState(false)") && controller.includes("setState(QStringLiteral(\"server\"))"));
check("workspace reconnect probes health", controller.includes('m_api->getJson(QStringLiteral("reconnectProbe"), QStringLiteral("/health"))'));
check("health recovery revalidates compatibility", controller.includes('QStringLiteral("reconnectCompatibility")') && controller.includes('/api/meta/compatibility?clientVersion=%1'));
check("incompatible reconnect stops recovery before renderer replay", controller.includes("This desktop version is not compatible with the server") && controller.includes("CLIENT_UPGRADE_REQUIRED") && controller.includes("resetReconnectState(false)"));
check("healthy reconnect delegates workspace refresh to the canonical renderer", controller.includes("markConnectionHealthy();") && controller.includes("emit connectionRecovered()") && rendererPage.includes("function onConnectionRecovered()"));
check("healthy reconnect does not replay a retired native mutation queue", !controller.includes("replayNextMutation") && !controller.includes("m_mutationQueue") && rendererPage.includes("onConnectionRecovered"));
check("healthy reconnect notifies renderer", controller.includes("emit connectionRecovered()"));
check("renderer failures are surfaced by profile store", profileHeader.includes("rendererLoadFailed") && profileStore.includes("emit rendererLoadFailed(profile.lastError)"));
check("renderer successes are surfaced by profile store", profileHeader.includes("rendererLoadSucceeded") && profileStore.includes("emit rendererLoadSucceeded()"));
check("renderer failures schedule native recovery", controller.includes("ServerProfileStore::rendererLoadFailed") && controller.includes("RENDERER_UNAVAILABLE") && controller.includes("scheduleReconnect({"));
check("renderer success can accelerate pending recovery", controller.includes("ServerProfileStore::rendererLoadSucceeded") && controller.includes("retryConnectionNow()"));
check("server page displays retry attempt state", serverPage.includes("Retry now") && serverPage.includes("connectionRecovery.delayMs") && serverPage.includes("connectionRecovery.attempt"));
check("server page preserves editable server fallback", serverPage.includes("Edit server") && serverPage.includes("useDifferentServer()"));
check("shared renderer shows route-preserving recovery", rendererPage.includes("Your workspace and route are preserved") && rendererPage.includes("Retry now"));
check("shared renderer reload waits for validated recovery", rendererPage.includes("function onConnectionRecovered()") && rendererPage.includes("root.lastSafeUrl.length ? root.lastSafeUrl : root.rendererUrl"));
check("desktop startup recovery API capability is current", contracts.includes('version: "2026-08-02.63"') && contracts.includes('"desktop-startup-recovery-v1"'));
const pkg = JSON.parse(pkgText);
check("startup reconnect audit is aggregate release gate", String(pkg.scripts?.audit || "").includes("desktop-startup-reconnect-audit.mjs"));
check("startup reconnect audit has named package script", String(pkg.scripts?.["audit:desktop-startup-reconnect"] || "").includes("desktop-startup-reconnect-audit.mjs"));
check("startup reconnect audit is invoked by master packaging", packager.includes("desktop-startup-reconnect-audit.mjs"));
check("startup reconnect documentation is packaged", packager.includes("docs/DESKTOP_STARTUP_RECONNECT.md"));
check("release notes identify Phase 4 startup recovery", notes.includes("desktop-startup-recovery-v1") && notes.includes("2026-08-02.38") && notes.includes("2s, 4s, 8s"));
check("documentation defines bounded backoff and compatibility-before-replay", doc.includes("60 seconds maximum") && doc.includes("Compatibility before replay") && doc.includes("Release-blocking boundary"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}`);
console.log(`\nCluster desktop startup/reconnect audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);
