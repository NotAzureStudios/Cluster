import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok) => checks.push({ label, ok });
const text = (relative) => readFile(path.join(root, relative), "utf8");

const [brokerHeader, broker, integration, desktopCore, desktopTypes, sync, shell, contracts, pkgText, packager, notes, doc] = await Promise.all([
  text("apps/desktop-qt/src/NativeCapabilityBroker.h"),
  text("apps/desktop-qt/src/NativeCapabilityBroker.cpp"),
  text("apps/desktop-qt/src/DesktopIntegration.cpp"),
  text("packages/renderer/src/core/desktop.ts"),
  text("packages/renderer/src/core/desktop-types.ts"),
  text("packages/renderer/src/features/notifications/desktop-notification-sync.ts"),
  text("packages/renderer/src/features/application/modules/application-shell.tsx"),
  text("packages/shared/src/api-contracts.ts"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.422.0.md"),
  text("docs/DESKTOP_NATIVE_NOTIFICATIONS.md"),
]);

check("native broker advertises notification status", broker.includes('QStringLiteral("notification.status")'));
check("native broker advertises notification show", broker.includes('QStringLiteral("notification.show")'));
check("status reports operating-system availability", broker.includes("QSystemTrayIcon::isSystemTrayAvailable()"));
check("status reports desktop preference", broker.includes("notificationsEnabled()"));
check("status reports app foreground state", broker.includes("QGuiApplication::applicationState() == Qt::ApplicationActive"));
check("show rejects unavailable notification surface", broker.includes("NOTIFICATIONS_UNAVAILABLE"));
check("show rejects disabled notification preference", broker.includes("NOTIFICATIONS_DISABLED"));
check("native notification rate limit remains independent", broker.includes("MaxNotificationsPerMinute = 6") && broker.includes("consumeNotificationBudget()"));
check("notification title remains bounded", broker.includes("MaxNotificationTitle = 120"));
check("notification body remains bounded", broker.includes("MaxNotificationBody = 320"));
check("notification route remains bounded", broker.includes("MaxRouteLength = 160") && broker.includes("safeRoute(route)"));
check("notification tag is bounded", broker.includes("MaxNotificationTag = 128"));
check("native duplicate tags are suppressed", broker.includes("m_seenNotificationTags.contains(tag)") && brokerHeader.includes("m_seenNotificationTags"));
check("native duplicate-tag memory is bounded", broker.includes("MaxSeenNotificationTags = 256") && broker.includes("m_seenNotificationTagOrder.dequeue()"));
check("duplicate state resets on profile switch", broker.includes("m_seenNotificationTags.clear()") && broker.includes("activeProfileChanged"));
check("foreground noncritical notifications are suppressed", broker.includes('QStringLiteral("suppressed"), QStringLiteral("app-active")') && broker.includes('priority != QStringLiteral("critical")'));
check("native request carries tag and priority", brokerHeader.includes("const QString &tag, const QString &priority"));
check("desktop integration presents critical severity", integration.includes("QSystemTrayIcon::Critical"));
check("desktop integration presents high severity", integration.includes("QSystemTrayIcon::Warning"));
check("notification click activates Cluster", integration.includes("messageClicked") && integration.includes("showWindow()"));
check("notification click routes shared renderer", integration.includes("navigateSharedRenderer") && integration.includes("m_pendingNotificationRoute"));
check("generic unread-count toast was removed", !integration.includes("new workspace update") && !integration.includes("new workspace updates"));
check("renderer capability type includes notification status", desktopCore.includes('| "notification.status"'));
check("desktop bridge checks native notification status", desktopCore.includes('requestNativeCapability<{ available?: boolean; enabled?: boolean }>("notification.status")'));
check("desktop bridge forwards notification tag", desktopCore.includes("tag: payload.tag?.trim().slice(0, 128)"));
check("desktop bridge forwards priority", desktopCore.includes("priority: payload.priority"));
check("desktop bridge type exposes tag and priority", desktopTypes.includes('tag?: string; priority?: "normal" | "medium" | "high" | "critical"'));
check("authenticated renderer polls the server notification inbox", sync.includes('api<DesktopInboxPage>(`/api/notifications?limit=${MAX_BATCH_ITEMS}`)'));
check("native inbox polling is thirty seconds", sync.includes("POLL_INTERVAL_MS = 30_000"));
check("first poll primes instead of replaying history", sync.includes("if (!existing)") && sync.includes("writeSeen(user.id, items.map((item) => item.id))"));
check("renderer seen-state is bounded", sync.includes("MAX_SEEN_IDS = 256"));
check("workspace activity follows the per-category native delivery preference", sync.includes("notificationEffectiveDelivery(settings, category, item.priority)") && sync.includes('delivery !== "native" && delivery !== "both"'));
check("project notification modes are respected", sync.includes('mode === "off"') && sync.includes('mode === "important"'));
check("multiple arrivals are batched", sync.includes("eligible.length > 1") && sync.includes("new Cluster notifications"));
check("single notification derives a canonical route", sync.includes("desktopNotificationRoute(top)") && sync.includes("board/${item.projectId}/${item.boardId}"));
check("batch click-through goes to Inbox", sync.includes('route: batch ? "notifications"'));
check("notification sync is mounted only when device permission and a native category are enabled", shell.includes("settings.browserNotifications === true && hasNativeNotificationDelivery(settings)") && shell.includes("useDesktopNotificationSync") && shell.includes("user, settings"));
check("desktop native notification API capability is current", contracts.includes('version: "2026-08-02.63"') && contracts.includes('"desktop-native-notifications-v1"'));
const pkg = JSON.parse(pkgText);
check("native notification audit is aggregate release gate", String(pkg.scripts?.audit || "").includes("desktop-native-notifications-audit.mjs"));
check("native notification audit has named package script", String(pkg.scripts?.["audit:desktop-native-notifications"] || "").includes("desktop-native-notifications-audit.mjs"));
check("native notification audit is invoked by master packaging", packager.includes("desktop-native-notifications-audit.mjs"));
check("native notification documentation is packaged", packager.includes("docs/DESKTOP_NATIVE_NOTIFICATIONS.md"));
check("release notes identify Phase 4.5", notes.includes("desktop-native-notifications-v1") && notes.includes("2026-08-02.62") && notes.includes("30 seconds"));
check("documentation defines trust and release boundary", doc.includes("Trust boundary") && doc.includes("Release-blocking boundary") && doc.includes("HttpOnly"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}`);
console.log(`\nCluster desktop-native notifications audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);
