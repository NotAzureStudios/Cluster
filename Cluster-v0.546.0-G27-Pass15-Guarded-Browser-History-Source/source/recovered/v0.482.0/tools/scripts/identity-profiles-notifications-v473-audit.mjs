import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "../..");
const text = (relative) => readFile(path.join(root, relative), "utf8");
let passed = 0;
let total = 0;
function check(label, ok) {
  total += 1;
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { console.error(`FAIL  ${label}`); process.exitCode = 1; }
}

const [auth, authRoutes, adminAuth, setupRoutes, setupUi, settings, people, profileDomain, userPrefs, notificationPrefs, notificationRoutes, notificationService, notificationRepo, notificationInbox, shell, models, migration, phaseCss, authCss, privacyCss, pkgText, packager] = await Promise.all([
  text("apps/server/src/core/auth.ts"),
  text("apps/server/src/domains/auth/auth-core-routes.ts"),
  text("apps/server/src/domains/auth/auth-admin-routes.ts"),
  text("apps/server/src/app/server-routes-setup.ts"),
  text("packages/renderer/src/features/application/modules/application-shell.tsx"),
  text("packages/renderer/src/features/settings/AccountSettingsPage.tsx"),
  text("packages/renderer/src/features/people/PeoplePages.tsx"),
  text("apps/server/src/app/server-services-request-domain.ts"),
  text("apps/server/src/domains/users/user-preference-routes.ts"),
  text("packages/renderer/src/features/notifications/notification-preferences.ts"),
  text("apps/server/src/domains/notifications/notification-routes.ts"),
  text("apps/server/src/domains/notifications/notification-service.ts"),
  text("apps/server/src/domains/notifications/notification-repository.ts"),
  text("packages/renderer/src/features/notifications/NotificationInboxPage.tsx"),
  text("packages/renderer/src/features/application/modules/application-shell.tsx"),
  text("packages/renderer/src/features/application/application-models.ts"),
  text("apps/server/prisma/migrations/20260826220000_auth_profiles_notifications/migration.sql"),
  text("packages/renderer/src/features/application/styles/phase1-identity-v473.css"),
  text("packages/renderer/src/features/auth/auth.css"),
  text("packages/renderer/src/features/legal/privacy-policy.css"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
]);

const packageJson = JSON.parse(pkgText);
{
  const [major, minor, patch] = String(packageJson.version || "0.0.0").split(".").map((value) => Number(value) || 0);
  const atLeast473 = major > 0 || minor > 473 || (minor === 473 && patch >= 0);
  check("v0.473 release identity remains in lineage", atLeast473 && (await text("packages/renderer/src/features/changelog/data/cluster-changelog.ts")).includes('version: "v0.473.0"') && (await text("RELEASE_NOTES_v0.473.0.md")).includes("# Cluster v0.473.0"));
}

check("password policy keeps only non-empty bounded storage limits", auth.includes("PASSWORD_MIN_LENGTH = 1") && auth.includes("PASSWORD_MAX_LENGTH = 1024") && !auth.includes("Password must include"));
check("login accepts username email or phone identifier", authRoutes.includes("resolveLoginIdentity") && authRoutes.includes("emailUsers") && authRoutes.includes("normalizedPhone(identifier)"));
check("login request schema accepts identifier", authRoutes.includes('identifier: z.string().min(1).max(320).optional()') && authRoutes.includes("A username, email, or phone number is required."));
check("sign-in UI exposes password visibility", shell.includes("showPassword") && shell.includes('{showPassword ? "Hide" : "Show"}'));
check("managed sign-in advertises username email or phone", (await text("packages/renderer/src/features/auth/AuthScreens.tsx")).includes("Username, email, or phone"));
check("users can request an administrator password reset", authRoutes.includes('/api/auth/password-reset-request') && (await text("packages/renderer/src/features/auth/AuthScreens.tsx")).includes("Request an admin reset"));
check("administrators have a reset request queue", adminAuth.includes('/api/admin/password-reset-requests') && (await text("packages/renderer/src/features/admin/AdminWorkspacePage.tsx")).includes("Reset requests"));
check("reset requests create actionable admin notifications", authRoutes.includes('entityType: "password_reset_request"') && authRoutes.includes('priority: "high"'));
check("auth notifications are pushed into the live toast stream", authRoutes.includes("notificationService?.publishRecords(createdNotifications)") && adminAuth.includes("notificationService?.publishRecord(reviewedNotification)") && adminAuth.includes("notificationService?.publishRecord(issuedNotification)"));
check("fulfilled or dismissed reset requests resolve stale notifications", adminAuth.includes('notificationInboxItem.updateMany') && adminAuth.includes('entityType: "password_reset_request"'));
check("owner recovery is separate rate-limited credential", authRoutes.includes('/api/auth/owner-recovery') && authRoutes.includes('rateKey = `owner-recovery:') && migration.includes('CREATE TABLE "OwnerRecoveryCredential"'));
check("owner recovery is workspace-owner controlled", adminAuth.includes('/api/admin/owner-recovery') && adminAuth.includes("Only a workspace owner"));
check("setup requires only owner username and password", setupUi.includes("Only these two credentials are required") && setupUi.includes("const accountReady = Boolean(form.ownerUsername.trim() && form.ownerPassword.length > 0") && setupRoutes.includes("ownerEmail: z.string().email().optional()") && setupRoutes.includes("ownerPhone: z.string().max(80).optional()"));
check("setup recovery credential is optional", setupRoutes.includes("ownerRecoveryPassword") && setupRoutes.includes("optional().or(z.literal(\"\"))") && setupUi.includes("Skip optional"));
check("profile self-service endpoint exists", userPrefs.includes('app.patch("/api/me/profile"'));
check("profile supports bio website Discord and preferred contact", userPrefs.includes("profileBio") && userPrefs.includes("profileWebsite") && userPrefs.includes("profileDiscordUsername") && userPrefs.includes("profilePreferredContact"));
check("profile supports user-managed skill tags", userPrefs.includes("skills: z.array") && userPrefs.includes("JSON.stringify([...new Set(body.skills") && settings.includes("profile-skill-editor-v473") && settings.includes("removeProfileSkillV473"));
check("profiles support pinned showcase projects", userPrefs.includes("profilePinnedProjectIds") && profileDomain.includes("profilePinnedProjectIds: profile.pinnedProjectIds") && settings.includes("Showcase work") && people.includes("profileShowcaseProjects"));
check("profiles expose local time and availability context", people.includes("profileLocalTime") && people.includes("profileAvailabilityLabel") && people.includes("Local time"));
check("profiles include recent production contributions", people.includes("profileRecentContributions") && people.includes("Recent contributions"));
check("avatars expose reusable quick profiles", (await text("packages/renderer/src/components/PresenceAvatar.tsx")).includes("ProfilePeekCard") && (await text("packages/renderer/src/components/PresenceAvatar.tsx")).includes("cluster-open-user-profile") && (await text("packages/renderer/src/features/application/ClusterApplication.tsx")).includes("cluster-open-user-profile"));
check("email phone and Discord visibility are explicit opt-ins", profileDomain.includes("showEmail: preferences.profileShowEmail === true") && profileDomain.includes("showPhone: preferences.profileShowPhone === true") && profileDomain.includes("showDiscord: preferences.profileShowDiscord === true"));
check("public profile serializer hides private contact fields", profileDomain.includes("email: profile.showEmail ? user.email : null") && profileDomain.includes("phoneNumber: profile.showPhone ? user.phoneNumber : null") && profileDomain.includes("discordUserId: profile.showDiscord ? user.discordUserId : null"));
check("profile UI exposes contact visibility controls", settings.includes("Show email") && settings.includes("Show phone") && settings.includes("Show Discord"));
check("people profiles provide useful contact actions", people.includes("ProfileContactActionsV473") && people.includes("Copy Discord") && people.includes('href={`mailto:${user.email}`}') && people.includes('href={`tel:${user.phoneNumber}`}'));
check("notification preference contract covers all eight categories", ["mentions", "approvals", "work", "schedule", "delivery", "qa", "system", "activity"].every((category) => notificationPrefs.includes(`\"${category}\"`)));
check("all notification categories default enabled", ["mentions", "approvals", "work", "schedule", "delivery", "qa", "system", "activity"].every((category) => notificationPrefs.includes(`${category}: true`)));
check("user preference API validates category toggles and delivery modes", userPrefs.includes("notificationCategoryPreferences") && userPrefs.includes("notificationCategoryDelivery") && ["mentions", "approvals", "work", "schedule", "delivery", "qa", "system", "activity"].every((category) => userPrefs.includes(`${category}: z.boolean().optional()`) && userPrefs.includes(`${category}: z.enum([\"toast\", \"native\", \"both\", \"silent\", \"off\"]).optional()`)));
check("notification delivery contract supports toast native both silent and off", notificationPrefs.includes('NotificationDeliveryMode = "toast" | "native" | "both" | "silent" | "off"') && ["toast", "native", "both", "silent", "off"].every((mode) => notificationPrefs.includes(`value: "${mode}"`)));
check("account settings render per-category delivery selectors", settings.includes("NOTIFICATION_CATEGORIES.map") && settings.includes("notificationCategoryDelivery") && settings.includes("Native push") && settings.includes("Silent") && settings.includes("Off removes that category"));
check("toast delivery obeys per-category mode and quiet hours", shell.includes("notificationShouldToast") && shell.includes("notificationEffectiveDelivery(settings, item.category, item.priority)") && shell.includes("delivery === \"toast\" || delivery === \"both\"") && shell.includes("setNotificationToastQueue"));
check("toast queue is sequential instead of replacing active notifications", shell.includes("const [next, ...remaining] = notificationToastQueue") && shell.includes("setNotificationToast(next)") && shell.includes("setNotificationToastQueue(remaining)"));
check("notifications have a live server stream", notificationRoutes.includes('/api/notifications/stream') && notificationRoutes.includes("text/event-stream") && notificationService.includes("liveSubscribers") && notificationService.includes("subscribe(userId"));
check("renderer consumes notification stream with polling fallback", shell.includes("new EventSource") && shell.includes('addEventListener("notification"') && shell.includes("window.setInterval(refreshNotificationBadge, 30_000)"));
check("server inbox summary and digest honor category preferences", notificationRoutes.includes("enabledNotificationCategories(user)") && notificationService.includes("summary(userId: string, categories?: string[])") && notificationRepo.includes("groupedCategories"));
check("notification inbox keeps view filters separate from delivery preferences", notificationInbox.includes("notifications.view-rules.v473") && notificationInbox.includes("notificationCategoryEnabled") && notificationInbox.includes("View sources"));
check("native delivery is immediate with polling fallback", shell.includes("cluster-live-notification-v473") && (await text("packages/renderer/src/features/notifications/desktop-notification-sync.ts")).includes("cluster-live-notification-v473") && (await text("packages/renderer/src/features/notifications/desktop-notification-sync.ts")).includes("POLL_INTERVAL_MS = 30_000"));
check("quiet hours can silence all or allow critical interruptions", notificationPrefs.includes("notificationQuietHoursActive") && notificationPrefs.includes("critical-only") && userPrefs.includes("notificationQuietHoursBehavior") && settings.includes("Everything becomes silent") && settings.includes("Critical can interrupt"));
check("server treats delivery off as inbox suppression", notificationRoutes.includes('categoryDelivery[category] === "off"') && notificationRoutes.includes("enabledNotificationCategories(user)"));
check("Phase 1 CSS has no forced overrides or raw color literals", !phaseCss.includes("!important") && !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(phaseCss));
check("auth and privacy surfaces have explicit v0.473 theme parity", authCss.includes("/* v0.473 identity and recovery */") && privacyCss.includes("/* v0.473 public policy theme parity */") && privacyCss.includes(':root[data-theme="light"] .privacy-policy-shell-v362') && privacyCss.includes(':root[data-theme="dark"] .privacy-policy-shell-v362'));
check("notification preference model is part of roaming settings", models.includes("notificationCategoryPreferences?: Partial<Record") && models.includes("notificationCategoryDelivery?: Partial<Record") && models.includes("notificationQuietHoursBehavior?:") && (await text("packages/renderer/src/features/application/modules/application-foundation.tsx")).includes('"notificationCategoryDelivery"'));
check("Phase 1 audit is wired into aggregate audit", packageJson.scripts?.audit?.includes("identity-profiles-notifications-v473-audit.mjs") === true);
check("Phase 1 audit is wired into master packaging", packager.includes("identity-profiles-notifications-v473-audit.mjs"));

console.log(`\nv0.473 identity, profiles & notifications audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
