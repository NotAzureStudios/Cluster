import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { CLUSTER_CREATE_MODE_IDS, type ClusterCreateMode } from "@cluster/shared";
import { policyAcceptanceStatus } from "../../core/policy-acceptance.js";
import { expertiseSchema, normalizeExpertise, parseJsonRecord as parsePeopleJsonRecord, profileFieldDefinitionsSchema, validateCustomProfileFields, workingHoursSchema } from "./people-profile-contract.js";
import { PeopleGovernanceError, lockPeopleProfile } from "./people-governance.js";
import { nextVerificationGeneration, revokeUserSecurityVerifications } from "../../core/security-verification.js";
import { syncUserWorkforceAuthorities } from "../workforce/workforce-normalization.js";
import { hashSecurityPin, verifySecurityPinCredential } from "../../core/security-pin-credential.js";

function parseJsonRecord(
  value: string | undefined | null,
): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Opaque read-version for long-lived preference editors. This does not expose
 * personal values and cannot be used as an authorization token. Small PATCH
 * clients can continue submitting individual keys without a read-version.
 */
function preferencesFingerprint(row: { preferences?: string | null; personalAccentColor?: string | null }): string {
  return createHash("sha256")
    .update(JSON.stringify([row.preferences ?? null, row.personalAccentColor ?? null]))
    .digest("hex");
}

const userPreferenceSchema = z
  .object({
    themePreference: z.enum(["system", "dark", "light"]).optional(),
    interfaceDensity: z.enum(["dense", "compact", "comfortable"]).optional(),
    sidebarStyle: z.enum(["solid", "glass"]).optional(),
    sidebarSurface: z.enum(["match", "solid", "glass"]).optional(),
    taskbarSurface: z.enum(["match", "solid", "glass"]).optional(),
    taskbarLayout: z.enum(["floating", "full-width"]).optional(),
    sidebarLayout: z.enum(["docked", "floating"]).optional(),
    surfaceDepth: z.enum(["flat", "soft", "elevated"]).optional(),
    surfaceTexture: z.enum(["none", "fine", "brushed"]).optional(),
    surfaceTextureIntensity: z.number().int().min(0).max(20).optional(),
    iconSize: z.enum(["small", "standard", "large"]).optional(),
    panelBorders: z.enum(["minimal", "subtle", "defined"]).optional(),
    scrollbarStyle: z.enum(["minimal", "standard", "prominent"]).optional(),
    projectTabStyle: z.enum(["compact", "standard"]).optional(),
    fontFamily: z.enum(["comfortaa", "inter", "system", "mono"]).optional(),
    cornerRadius: z.number().int().min(0).max(32).optional(),
    glassStrength: z.number().int().min(0).max(100).optional(),
    backgroundStyle: z.enum(["aurora", "clean", "grid", "midnight"]).optional(),
    backgroundBaseStyle: z.enum(["clean", "gradient", "aurora", "midnight"]).optional(),
    backgroundPattern: z.enum(["none", "hex", "grid", "dots"]).optional(),
    backgroundPatternIntensity: z.number().min(0).max(12).optional(),
    backgroundPatternScale: z.enum(["small", "medium", "large"]).optional(),
    cardStyle: z.enum(["glass", "flat", "outlined"]).optional(),
    surfaceStyle: z.enum(["glass", "flat", "outlined"]).optional(),
    motionLevel: z.enum(["full", "reduced", "none"]).optional(),
    userStartScreen: z.string().max(80).optional(),
    userTaskbarLabels: z.enum(["auto", "always", "icons"]).optional(),
    userCommandSearchScope: z.enum(["all", "workspace", "current"]).optional(),
    userSearchContextAware: z.boolean().optional(),
    userSearchLockCurrentPage: z.boolean().optional(),
    userQuickCreateTarget: z
      .enum(CLUSTER_CREATE_MODE_IDS as unknown as [ClusterCreateMode, ...ClusterCreateMode[]])
      .optional(),
    userShowHelpText: z.boolean().optional(),
    userAutoSaveDrafts: z.boolean().optional(),
    userCalendarDefaultView: z
      .enum(["day", "week", "month", "agenda"])
      .nullable()
      .optional(),
    userTimeTrackingDefault: z.enum(["timer", "manual", "schedule"]).optional(),
    userQuietHoursEnabled: z.boolean().optional(),
    userQuietHoursStart: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    userQuietHoursEnd: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    userDigestCadence: z.enum(["off", "daily", "weekly"]).optional(),
    userDigestTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    userDigestWeekday: z.number().int().min(1).max(7).optional(),
    userUiSoundsEnabled: z.boolean().optional(),
    userUiSoundVolume: z.number().min(0).max(100).optional(),
    userNotificationSoundsEnabled: z.boolean().optional(),
    userNotificationSoundVolume: z.number().min(0).max(100).optional(),
    browserNotifications: z.boolean().optional(),
    userShortcutProfile: z
      .enum(["default", "editor", "producer", "qa", "custom"])
      .optional(),
    userCommandPaletteHotkey: z.string().max(80).optional(),
    userPinnedToolsCsv: z.string().max(2000).optional(),
    userReducedContrast: z.boolean().optional(),
    userMotionPreference: z.enum(["system", "full", "reduced", "none"]).optional(),
    userContrastPreference: z.enum(["system", "standard", "high"]).optional(),
    userTransparencyPreference: z.enum(["system", "full", "reduced", "off"]).optional(),
    userFocusIndicator: z.enum(["auto", "strong", "always"]).optional(),
    userTextScale: z.enum(["default", "large", "larger", "largest"]).optional(),
    userLargeClickTargets: z.boolean().optional(),
    userStatusPalette: z.enum(["default", "color-vision-safe", "monochrome"]).optional(),
    userFocusModeDefault: z.boolean().optional(),
    userDashboardDensity: z
      .enum(["compact", "balanced", "expanded"])
      .optional(),
    userHomeMobileLayout: z
      .enum(["stack", "grid", "carousel", "focus"])
      .optional(),
    userDefaultFilterScope: z
      .enum(["mine", "team", "project", "all"])
      .optional(),
    notifyCardCreated: z.boolean().optional(),
    notifyCardMoved: z.boolean().optional(),
    notifyCardCompleted: z.boolean().optional(),
    notifyGitEvents: z.boolean().optional(),
    notifyWhiteboardUpdates: z.boolean().optional(),
    notifyUpcomingEvents: z.boolean().optional(),
    notifyDueDates: z.boolean().optional(),
    notificationLookaheadDays: z.number().int().min(1).max(30).optional(),
    notificationProjectModes: z
      .record(z.string(), z.enum(["all", "important", "off"]))
      .optional(),
    notificationToolModes: z
      .record(z.enum(["project", "boards", "whiteboards", "review", "builds", "qa", "tickets", "scheduler", "calendar", "timeline", "library", "people", "automation", "system"]), z.enum(["all", "important", "off"]))
      .optional(),
    notificationPriorityFloor: z.enum(["all", "medium", "high", "critical"]).optional(),
    notificationEscalationMode: z.enum(["standard", "action-required", "aggressive"]).optional(),
    notificationCategoryDelivery: z
      .object({
        activity: z.enum(["toast", "native", "both", "silent", "off"]).optional(),
        mentions: z.enum(["toast", "native", "both", "silent", "off"]).optional(),
        approvals: z.enum(["toast", "native", "both", "silent", "off"]).optional(),
        delivery: z.enum(["toast", "native", "both", "silent", "off"]).optional(),
        qa: z.enum(["toast", "native", "both", "silent", "off"]).optional(),
        schedule: z.enum(["toast", "native", "both", "silent", "off"]).optional(),
        work: z.enum(["toast", "native", "both", "silent", "off"]).optional(),
        system: z.enum(["toast", "native", "both", "silent", "off"]).optional(),
      })
      .strict()
      .optional(),
    notificationQuietHoursBehavior: z.enum(["silent", "critical-only", "normal"]).optional(),
    notificationDiscordDelivery: z.enum(["off", "mentions", "action-required", "all"]).optional(),
    desktopLaunchAtStartup: z.boolean().optional(),
    desktopMinimizeToTray: z.boolean().optional(),
    desktopCloseBehavior: z.enum(["ask", "minimize", "quit"]).optional(),
    desktopNotificationDelivery: z
      .enum(["native", "in-app", "both"])
      .optional(),
    desktopOpenExternalLinksInBrowser: z.boolean().optional(),
    desktopLibraryMountEnabled: z.boolean().optional(),
    desktopLibraryMountLayout: z.enum(["unified", "separate"]).optional(),
    desktopLibraryMountOrganization: z.enum(["servers", "libraries"]).optional(),
    desktopLibraryMountLocation: z.string().max(180).optional(),
    profileShowEmail: z.boolean().optional(),
    profileShowPhone: z.boolean().optional(),
    profileShowDiscord: z.boolean().optional(),
    profileShowTimezone: z.boolean().optional(),
    profileShowStatus: z.boolean().optional(),
    profileBio: z.string().max(600).optional(),
    profileWebsite: z.string().max(320).optional(),
    profileDiscordUsername: z.string().max(80).optional(),
    profilePreferredContact: z.enum(["cluster", "discord", "email", "phone"]).optional(),
    entryFirstLoginStep: z.enum(["profile", "policies", "onboarding", "session", "review"]).optional(),
  })
  .strict();

type RouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  normalizePersonalAccent: (value: unknown) => string | null;
  verifyPassword: (hash: string, value: string) => Promise<boolean>;
  hashPassword: (value: string) => Promise<string>;
  verifyUserPin: (
    user: any,
    pin: string,
    purpose: string,
    request?: FastifyRequest | null,
  ) => Promise<boolean>;
  logSecurityEvent: (input: any) => Promise<void>;
  readSettings: () => Promise<any>;
};

export function registerUserPreferenceRoutes(deps: RouteDependencies) {
  const {
    app,
    prisma,
    getCurrentUser,
    decorateUserForClient,
    normalizePersonalAccent,
    verifyPassword,
    hashPassword,
    verifyUserPin,
    logSecurityEvent,
    readSettings,
  } = deps;

  app.get("/api/me", async (request) => {
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    const acceptance = decorated && user?.id ? await policyAcceptanceStatus(prisma, user, Boolean(decorated.isAdmin)) : null;
    return {
      user: decorated
        ? { ...decorated, preferences: parseJsonRecord(user?.preferences), policyAcceptance: acceptance }
        : null,
    };
  });

  app.get("/api/me/preferences", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user)
      return reply.code(401).send({ ok: false, error: "Login required." });
    // A session's user projection can lag behind committed changes from another
    // tab/process. The returned baseline must come from the same fresh DB row
    // used by the PATCH compare-and-swap contract.
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    if (!fresh) return reply.code(404).send({ ok: false, error: "Account not found." });
    const decorated = await decorateUserForClient(fresh);
    const preferences = parseJsonRecord(fresh.preferences);
    return { ok: true, preferences, fingerprint: preferencesFingerprint(fresh), user: { ...decorated, preferences } };
  });

  app.patch("/api/me/preferences", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user)
      return reply.code(401).send({ ok: false, error: "Login required." });
    const body = z
      .object({
        personalAccentColor: z.string().optional().nullable(),
        preferences: userPreferenceSchema.optional(),
        /** Required by the full Account Settings editor, optional for narrowly scoped PATCH clients. */
        expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      })
      .parse(request.body || {});
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    if (!fresh)
      return reply.code(404).send({ ok: false, error: "Account not found." });
    if (body.expectedFingerprint !== undefined && body.expectedFingerprint !== preferencesFingerprint(fresh)) {
      return reply.code(409).send({ ok: false, code: "USER_PREFERENCES_CONFLICT", error: "Your preferences changed since this Settings page was opened. Refresh before saving; your draft is preserved." });
    }
    const preferences = {
      ...parseJsonRecord(fresh.preferences),
      ...(body.preferences || {}),
      userAutoSaveDrafts: true,
    };
    // Null means reset, not an explicit stored value which shadows parent defaults.
    if (body.preferences?.userCalendarDefaultView === null) delete preferences.userCalendarDefaultView;
    // Compare against DB truth: concurrent Account Settings saves must not
    // silently overwrite another session's newer preferences. No new authority.
    const updated = await prisma.$transaction(async (tx: any) => {
      const saved = await tx.user.updateMany({
        // Fence both values included in the read-version. If another session
        // changes only the accent after our fresh read, a preferences-only CAS
        // would silently revert that newer accent.
        where: { id: user.id, preferences: fresh.preferences, personalAccentColor: fresh.personalAccentColor },
        data: {
          personalAccentColor: body.personalAccentColor === undefined ? fresh.personalAccentColor : normalizePersonalAccent(body.personalAccentColor),
          preferences: JSON.stringify(preferences),
        },
      });
      if (saved.count !== 1) return null;
      return tx.user.findUnique({ where: { id: user.id } });
    });
    if (!updated) return reply.code(409).send({ ok: false, code: "USER_PREFERENCES_CONFLICT", error: "Your preferences changed in another session. Refresh before saving." });
    const decorated = await decorateUserForClient(updated);
    return { ok: true, preferences, fingerprint: preferencesFingerprint(updated), user: { ...decorated, preferences } };
  });

  app.patch("/api/me/profile", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, error: "Login required." });
    const body = z.object({
      displayName: z.string().trim().max(80).optional().nullable(),
      preferredName: z.string().trim().max(80).optional().nullable(),
      pronouns: z.string().trim().max(80).optional().nullable(),
      personalAccentColor: z.string().optional().nullable(),
      email: z.string().email().optional().nullable().or(z.literal("")),
      phoneNumber: z.string().trim().max(80).optional().nullable(),
      timezone: z.string().trim().max(120).optional().nullable(),
      workLocation: z.string().trim().max(160).optional().nullable(),
      profileBio: z.string().max(600).optional(),
      skills: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
      expertise: expertiseSchema.optional(),
      workingHours: workingHoursSchema.optional(),
      customProfileFields: z.record(z.unknown()).optional(),
      expectedProfileRevision: z.coerce.number().int().min(1).optional(),
      profileWebsite: z.string().max(320).optional(),
      profileDiscordUsername: z.string().max(80).optional(),
      profilePreferredContact: z.enum(["cluster", "discord", "email", "phone"]).optional(),
      profilePinnedProjectIds: z.array(z.string().trim().min(1).max(120)).max(4).optional(),
      profileShowEmail: z.boolean().optional(),
      profileShowPhone: z.boolean().optional(),
      profileShowDiscord: z.boolean().optional(),
      profileShowTimezone: z.boolean().optional(),
      profileShowStatus: z.boolean().optional(),
    }).parse(request.body || {});
    const profileDefinitions = profileFieldDefinitionsSchema.parse((await readSettings()).studioPeopleProfileFields || []);
    const normalizePhone = (value: unknown) => String(value || "").replace(/\D/g, "");
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        await lockPeopleProfile(tx, user.id);
        const fresh = await tx.user.findUnique({ where: { id: user.id }, include: { workingPattern: true } });
        if (!fresh) throw new PeopleGovernanceError("USER_NOT_FOUND", "Account not found.", 404);
        if (body.expectedProfileRevision && Number(fresh.profileRevision || 1) !== body.expectedProfileRevision) throw new PeopleGovernanceError("PROFILE_REVISION_CONFLICT", "Your profile changed on another client.", 409, { currentRevision: Number(fresh.profileRevision || 1) });
        const email = body.email === undefined ? fresh.email : String(body.email || "").trim() || null;
        if (email) {
          const matches = await tx.user.findMany({ where: { email: { equals: email, mode: "insensitive" }, id: { not: user.id } }, select: { id: true }, take: 1 });
          if (matches.length) throw new PeopleGovernanceError("PROFILE_EMAIL_CONFLICT", "That email address is already assigned to another Cluster account.", 409);
        }
        const phoneNumber = body.phoneNumber === undefined ? fresh.phoneNumber : String(body.phoneNumber || "").trim() || null;
        const phoneKey = normalizePhone(phoneNumber);
        if (phoneKey) {
          const candidates = await tx.user.findMany({ where: { id: { not: user.id }, OR: [{ phoneNumber: { not: null } }, { alternatePhoneNumber: { not: null } }] }, select: { id: true, phoneNumber: true, alternatePhoneNumber: true }, take: 5000 });
          if (candidates.some((candidate: any) => [candidate.phoneNumber, candidate.alternatePhoneNumber].some((value) => normalizePhone(value) === phoneKey))) throw new PeopleGovernanceError("PROFILE_PHONE_CONFLICT", "That phone number is already assigned to another Cluster account.", 409);
        }
        const currentPreferences = parseJsonRecord(fresh.preferences);
        const effectiveProfileDiscordUsername = body.profileDiscordUsername === undefined ? String(currentPreferences.profileDiscordUsername || fresh.discordUsername || "").trim() : String(body.profileDiscordUsername || fresh.discordUsername || "").trim();
        const effectivePreferredContact = body.profilePreferredContact === undefined ? String(currentPreferences.profilePreferredContact || "cluster") : body.profilePreferredContact;
        if (effectivePreferredContact === "email" && !email) throw new PeopleGovernanceError("PROFILE_CONTACT_UNAVAILABLE", "Add an email address before choosing email as your preferred contact method.", 400);
        if (effectivePreferredContact === "phone" && !phoneNumber) throw new PeopleGovernanceError("PROFILE_CONTACT_UNAVAILABLE", "Add a phone number before choosing phone as your preferred contact method.", 400);
        if (effectivePreferredContact === "discord" && !effectiveProfileDiscordUsername) throw new PeopleGovernanceError("PROFILE_CONTACT_UNAVAILABLE", "Add or link a Discord username before choosing Discord as your preferred contact method.", 400);
        const preferences = {
          ...currentPreferences,
          ...(body.profileBio !== undefined ? { profileBio: body.profileBio.trim() } : {}),
          ...(body.profileWebsite !== undefined ? { profileWebsite: body.profileWebsite.trim() } : {}),
          ...(body.profileDiscordUsername !== undefined ? { profileDiscordUsername: body.profileDiscordUsername.trim() } : {}),
          ...(body.profilePreferredContact !== undefined ? { profilePreferredContact: body.profilePreferredContact } : {}),
          ...(body.profilePinnedProjectIds !== undefined ? { profilePinnedProjectIds: [...new Set(body.profilePinnedProjectIds)].slice(0, 4) } : {}),
          ...(body.profileShowEmail !== undefined ? { profileShowEmail: body.profileShowEmail } : {}),
          ...(body.profileShowPhone !== undefined ? { profileShowPhone: body.profileShowPhone } : {}),
          ...(body.profileShowDiscord !== undefined ? { profileShowDiscord: body.profileShowDiscord } : {}),
          ...(body.profileShowTimezone !== undefined ? { profileShowTimezone: body.profileShowTimezone } : {}),
          ...(body.profileShowStatus !== undefined ? { profileShowStatus: body.profileShowStatus } : {}),
        };
        const updated = await tx.user.update({ where: { id: user.id }, data: {
          displayName: body.displayName === undefined ? undefined : body.displayName || null,
          preferredName: body.preferredName === undefined ? undefined : body.preferredName || null,
          pronouns: body.pronouns === undefined ? undefined : body.pronouns || null,
          personalAccentColor: body.personalAccentColor === undefined ? undefined : normalizePersonalAccent(body.personalAccentColor),
          email: body.email === undefined ? undefined : email,
          phoneNumber: body.phoneNumber === undefined ? undefined : phoneNumber,
          customProfileFields: body.customProfileFields === undefined ? undefined : JSON.stringify(validateCustomProfileFields({ ...parsePeopleJsonRecord(fresh.customProfileFields), ...body.customProfileFields }, profileDefinitions)),
          profileRevision: { increment: 1 },
          preferences: JSON.stringify(preferences),
        }});
        const membership = await tx.workspaceMember.findFirst({ where: { userId: user.id }, orderBy: { workspaceId: "asc" } });
        if (membership) await syncUserWorkforceAuthorities(tx, {
          workspaceId: membership.workspaceId,
          userId: user.id,
          input: {
            timezone: body.timezone,
            workLocation: body.workLocation,
            workingHours: body.workingHours,
            skills: body.skills,
            expertise: body.expertise === undefined ? undefined : normalizeExpertise(body.expertise),
          },
        });
        return { updated, preferences };
      });
      return { ok: true, user: { ...(await decorateUserForClient(result.updated)), preferences: result.preferences } };
    } catch (error) {
      if (error instanceof PeopleGovernanceError) return reply.code(error.statusCode).send({ ok: false, code: error.code, error: error.message, ...(error.details || {}) });
      throw error;
    }
  });

  app.post("/api/me/first-login/complete", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    if (!fresh) return reply.code(404).send({ ok: false, code: "ACCOUNT_NOT_FOUND", error: "Account not found." });
    if (["PASSWORD_CHANGE_REQUIRED", "PASSWORD_RESET_REQUIRED"].includes(String(fresh.accountState || ""))) {
      return reply.code(409).send({ ok: false, code: "FIRST_LOGIN_PASSWORD_REQUIRED", error: "Finish setting your account password before completing first login." });
    }
    const completedAt = fresh.firstLoginCompletedAt || new Date();
    const preferences = { ...parseJsonRecord(fresh.preferences), entryFirstLoginStep: "review", userAutoSaveDrafts: true };
    const updated = await prisma.user.update({ where: { id: user.id }, data: { firstLoginCompletedAt: completedAt, preferences: JSON.stringify(preferences) } });
    await logSecurityEvent({ event: "account.first_login_completed", actorUserId: user.id, targetUserId: user.id, result: "SUCCESS", reasonCode: fresh.firstLoginCompletedAt ? "ALREADY_COMPLETE" : "USER_COMPLETE", request });
    return { ok: true, completedAt, user: { ...(await decorateUserForClient(updated)), preferences } };
  });

  app.put("/api/me/pin", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user)
      return reply.code(401).send({ ok: false, error: "Login required." });
    const body = z
      .object({
        currentPassword: z.string().max(1024).optional(),
        currentPin: z
          .string()
          .regex(/^\d{4,8}$/)
          .optional(),
        pin: z.string().regex(/^\d{4,8}$/),
      })
      .parse(request.body || {});
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    if (!fresh)
      return reply.code(404).send({ ok: false, error: "Account not found." });
    let authorized = false;
    if (fresh.pinHash && body.currentPin)
      authorized = await verifySecurityPinCredential({ prisma, userId: user.id, pin: body.currentPin, purpose: "change_security_pin", request, logSecurityEvent }).then(() => true).catch(() => false);
    if (!authorized && fresh.passwordHash && body.currentPassword)
      authorized = await verifyPassword(
        fresh.passwordHash,
        body.currentPassword,
      );
    if (!fresh.pinHash) authorized = true;
    if (!authorized) {
      await logSecurityEvent({
        event: "account.pin_change_denied",
        actorUserId: user.id,
        targetUserId: user.id,
        result: "FAILURE",
        reasonCode: fresh.pinHash
          ? "CURRENT_PIN_OR_PASSWORD_REQUIRED"
          : "INITIAL_PIN_SETUP",
        request,
      });
      return reply
        .code(403)
        .send({
          ok: false,
          error: fresh.pinHash
            ? "Enter your current PIN or account password."
            : "The initial PIN could not be created.",
        });
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        pinHash: await hashSecurityPin(body.pin),
        pinUpdatedAt: new Date(),
        failedPinCount: 0,
        pinLockedUntil: null,
        verificationGeneration: nextVerificationGeneration(fresh),
      },
    });
    await revokeUserSecurityVerifications(prisma, user.id);
    await logSecurityEvent({
      event: "account.pin_changed",
      actorUserId: user.id,
      targetUserId: user.id,
      result: "SUCCESS",
      reasonCode: fresh.pinHash ? "USER_CHANGED_PIN" : "USER_CREATED_PIN",
      request,
    });
    return { ok: true, user: await decorateUserForClient(updated) };
  });

  app.post("/api/me/pin/verify", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user)
      return reply.code(401).send({ ok: false, error: "Login required." });
    const body = z
      .object({ pin: z.string(), purpose: z.string().trim().min(1).max(120) })
      .parse(request.body);
    await verifyUserPin(user, body.pin, body.purpose, request);
    return { ok: true };
  });
}
