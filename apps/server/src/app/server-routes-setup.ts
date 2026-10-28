import { createHash, randomUUID } from "node:crypto";
import { type FastifyInstance } from "fastify";
import { z } from "zod";

import { hashPassword, nextAccountState, normalizeAuthUsername, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validateNewPassword } from "../core/auth.js";
import { isLoopbackAddress } from "../core/security.js";
import { hashSecurityPin } from "../core/security-pin-credential.js";
import { inspectInstanceSetup } from "../core/instance-setup.js";
import { appendSecurityAuditEvent } from "../core/security-audit-store.js";
import { CLUSTER_CONFIG_FIELDS, exportSafeStudioConfiguration, parseClusterConfigBundle, planSafeStudioConfiguration, planSafeConfigurationRollback, parseSafeConfigurationRevisionChanges, sanitizeSkippedSetupItems, SETUP_CHECKLIST_IDS } from "../core/setup-configuration.js";
import { ownerSecurityReadiness, SETUP_GUIDES } from "../core/setup-guidance.js";
import type { SettingPayload, ServerRouteRegistrationDeps } from "./server-composition-types.js";

export function registerSetupRoutes(deps: ServerRouteRegistrationDeps) {
  const app: FastifyInstance = deps.app;
  const {
    REQUIRE_DISCORD_LINK,
    cleanOptionalString,
    createSession,
    decorateUserForClient,
    getSetupStatus,
    logActivity,
    logSecurityEvent,
    prisma,
    rateLimit,
    readSettings,
    requireAdminUserForRequest,
    saveSettings,
    mutateSettingsKeys,
    seedProductionDemoWorkspace,
    setupIsComplete,
  } = deps;

  app.post("/api/admin/demo-workspace", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const result = await seedProductionDemoWorkspace(admin.id);
    return {
      ok: true,
      ...result,
      message: result.created.length ? `Seeded ${result.created.length} new demo item(s).` : "Demo workspace already exists; refreshed roles and permissions.",
    };
  });

  app.get("/api/setup/status", async () => getSetupStatus());

  // Never return configuration posture or user security state on /api/setup/status.
  // The setup checklist is an administrator-only, server-derived projection.
  app.get("/api/admin/setup/checklist", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const settings = await readSettings();
    const memberships = await prisma.workspaceMember.findMany({
      where: { role: { in: ["owner", "admin"] } }, select: { userId: true, role: true },
    });
    const administratorIds = [...new Set(memberships.map((member: { userId: string }) => member.userId))];
    const ownerMembershipIds: string[] = [...new Set<string>(memberships.filter((member: { role: string }) => member.role === "owner").map((member: { userId: string }) => member.userId))];
    const [people, passkeys, recoveryCodes, projectCount, domainProfileCount] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: administratorIds }, archived: false }, select: { id: true } }),
      prisma.authenticator.findMany({ where: {
        userId: { in: ownerMembershipIds }, kind: "webauthn", state: "active", revokedAt: null, compromisedAt: null,
      }, select: { userId: true } }),
      prisma.authenticatorRecoveryCode.findMany({ where: { userId: { in: ownerMembershipIds }, consumedAt: null }, select: { userId: true } }),
      prisma.project.count(),
      prisma.studioManagedDomain.count({ where: {
        verificationState: "verified", bindingServerInstanceId: String(settings.serverInstanceId || ""),
        bindingHostname: { not: null }, connectionMode: { not: null },
      } }),
    ]);
    const activeIds = new Set(people.map((person: { id: string }) => person.id));
    const security = ownerSecurityReadiness(
      ownerMembershipIds.filter((id) => activeIds.has(id)),
      passkeys.map((key: { userId: string }) => key.userId), recoveryCodes.map((code: { userId: string }) => code.userId),
    );
    const zone = settings.studioTimezone;
    let timezoneValid = false;
    if (typeof zone === "string" && zone.trim()) {
      try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); timezoneValid = true; }
      catch { timezoneValid = false; }
    }
    const flags: Record<string, boolean> = {
      "owner-passkey": security.passkeysReady,
      "recovery-codes": security.recoveryReady,
      "studio-identity": Boolean(String(settings.studioName || "").trim()),
      "studio-timezone": timezoneValid,
      "backups": settings.backupEnabled === true,
      "second-admin": administratorIds.filter((id) => activeIds.has(id)).length > 1,
      "first-project": projectCount > 0,
      "domains": domainProfileCount > 0,
    };
    const skipped = new Set(sanitizeSkippedSetupItems(settings.setupChecklistSkippedIds));
    // Readiness is advice during bootstrap, not a second login gate. A studio
    // administrator can explicitly enforce MFA later under Security Policy.
    // A TOTP-capable minimum never implies that a passkey specifically is required.
    const ownerPasskeyRequired = (settings.securityMfaRequirement === "admins" || settings.securityMfaRequirement === "all")
      && settings.securityAdminMfaMinimumStrength !== "mfa";
    const items = SETUP_CHECKLIST_IDS.map((id) => ({
      id, label: SETUP_GUIDES[id].title, group: SETUP_GUIDES[id].group,
      detail: SETUP_GUIDES[id].detail, nextStep: SETUP_GUIDES[id].nextStep,
      destination: SETUP_GUIDES[id].destination,
      required: id === "owner-passkey" && ownerPasskeyRequired,
      status: flags[id] ? "complete" : skipped.has(id) ? "skipped" : "recommended",
    }));
    reply.header("Cache-Control", "no-store");
    return {
      ok: true, items, complete: items.filter((item) => item.status === "complete").length, total: items.length,
      security: { ready: security.passkeysReady && security.recoveryReady,
        ownerCount: security.ownerCount, missingPasskeys: security.missingPasskeys, missingRecovery: security.missingRecovery },
    };
  });

  app.patch("/api/admin/setup/checklist", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const body = z.object({ id: z.enum(["studio-identity", "studio-timezone", "backups", "second-admin", "first-project", "domains"]), skipped: z.boolean() }).strict().parse(request.body);
    // Derive from the latest persisted list while holding the same lock as
    // configuration publication; independent admin toggles no longer race.
    await mutateSettingsKeys(["setupChecklistSkippedIds"], (current: Record<string, unknown>) => {
      const skipped = new Set(sanitizeSkippedSetupItems(current.setupChecklistSkippedIds));
      if (body.skipped) skipped.add(body.id);
      else skipped.delete(body.id);
      return { setupChecklistSkippedIds: [...skipped] };
    });
    await logSecurityEvent({ event: "instance.setup_checklist_updated", actorUserId: admin.id, result: "SUCCESS", reasonCode: "SETUP_CHECKLIST_OPTIONAL_ITEM", request, metadata: { id: body.id, skipped: body.skipped } });
    return { ok: true };
  });

  // Exporting settings is administrative and emits a fixed, non-secret allowlist.
  app.get("/api/admin/setup/configuration/export", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    return exportSafeStudioConfiguration(await readSettings());
  });

  // Administrative .clusterconfig imports have two explicit phases. A preview
  // compares only safe keys, and apply rechecks the same plan against live state.
  // The preview hash is not a capability token: BOTH routes enforce admin access.
  const configurationImportBody = z.object({ configuration: z.unknown() }).strict();
  const configurationApplyBody = configurationImportBody.extend({ previewId: z.string().regex(/^[a-f0-9]{64}$/) });
  // Read explicit database state for preview, not readSettings() resolved
  // defaults. An absent AppSetting row must remain distinct from an inherited
  // application default, especially after an exact historical rollback.
  async function readDatabaseConfigurationFor(raw: unknown) {
    const configuration = parseClusterConfigBundle(raw);
    const keys = CLUSTER_CONFIG_FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(configuration.settings, key));
    const rows = keys.length ? await prisma.appSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } }) : [];
    const current: SettingPayload = {};
    for (const row of rows) (current as Record<string, unknown>)[row.key] = JSON.parse(row.value);
    return current;
  }
  function configurationPlan(raw: unknown, settings: SettingPayload) {
    if (JSON.stringify(raw ?? null).length > 16_384) throw new Error("Configuration exceeds the 16 KiB setup limit.");
    const plan = planSafeStudioConfiguration(parseClusterConfigBundle(raw), settings);
    const previewId = createHash("sha256")
      .update(JSON.stringify({ schemaVersion: 1, comparisonState: plan.comparisonState }))
      .digest("hex");
    return { plan, previewId };
  }

  app.post("/api/admin/setup/configuration/preview", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const payload = configurationImportBody.parse(request.body);
    try {
      const { plan, previewId } = configurationPlan(payload.configuration, await readDatabaseConfigurationFor(payload.configuration));
      return { ok: true, previewId, changes: plan.changes, requestedCount: plan.comparisonState.length };
    } catch (error) {
      return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Configuration is invalid." });
    }
  });

  // The history holds only the five safe imported settings; never return arbitrary
  // AppSetting rows or secrets through the configuration revision interface.
  app.get("/api/admin/setup/configuration/revisions", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const rows = await prisma.studioConfigurationRevision.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20,
      select: { id: true, actorUserId: true, requestedJson: true, changesJson: true, createdAt: true },
    });
    return { ok: true, revisions: rows.map((row: { id: string; actorUserId: string | null; createdAt: Date; requestedJson: string; changesJson: string }) => ({
      id: row.id, actorUserId: row.actorUserId, createdAt: row.createdAt,
      requested: parseClusterConfigBundle({ format: "clusterconfig", schemaVersion: 1, settings: JSON.parse(row.requestedJson) }).settings,
      changes: JSON.parse(row.changesJson),
    })) };
  });

  app.post("/api/admin/setup/configuration/apply", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const payload = configurationApplyBody.parse(request.body);
    // Fast feedback; the transaction below independently verifies the exact
    // requested rows, so this check cannot be the final concurrency authority.
    try {
      const preflight = configurationPlan(payload.configuration, await readDatabaseConfigurationFor(payload.configuration));
      if (preflight.previewId !== payload.previewId) {
        return reply.code(409).send({ ok: false, code: "CONFIGURATION_PREVIEW_STALE", error: "Configuration changed since the preview. Review the changes again before applying." });
      }
    } catch (error) {
      return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Configuration is invalid." });
    }

    // PostgreSQL SERIALIZABLE + an import-specific transaction lock serializes
    // competing imports, then checks current DB values inside the same transaction.
    // Only changed allowlisted keys are written. Database-backed Studio Settings
    // writers use this same lock; server-managed boot/file settings have their
    // own separate publication and recovery authority.
    let outcome: { applied: number; revisionId: string | null; changedFields: string[] };
    try {
      outcome = await prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(506, 1)::text AS "locked"`;
        const requested = parseClusterConfigBundle(payload.configuration).settings;
        const keys = CLUSTER_CONFIG_FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(requested, key));
        const stored = await tx.appSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
        const current: Record<string, unknown> = {};
        for (const row of stored) {
          // These keys are non-secret, JSON-encoded application defaults.
          current[row.key] = JSON.parse(row.value);
        }
        const prepared = configurationPlan(payload.configuration, current);
        if (prepared.previewId !== payload.previewId) {
          throw new Error("CONFIGURATION_PREVIEW_STALE");
        }
        if (!prepared.plan.changes.length) return { applied: 0, revisionId: null, changedFields: [] };
        for (const change of prepared.plan.changes) {
          await tx.appSetting.upsert({
            where: { key: change.key },
            create: { key: change.key, value: JSON.stringify(change.after) },
            update: { value: JSON.stringify(change.after) },
          });
        }
        const revision = await tx.studioConfigurationRevision.create({ data: {
          actorUserId: admin.id, previewId: payload.previewId,
          requestedJson: JSON.stringify(prepared.plan.requested),
          changesJson: JSON.stringify(prepared.plan.changes),
        } });
        await appendSecurityAuditEvent(tx, {
          event: "instance.configuration_imported", actorUserId: admin.id,
          result: "SUCCESS", reasonCode: "SAFE_CONFIGURATION_IMPORT",
          requestId: request.id || null, requestMethod: request.method || "POST",
          requestPath: "/api/admin/setup/configuration/apply",
          metadata: { schemaVersion: 1, revisionId: revision.id, changedFields: prepared.plan.changes.map((change) => change.key), changedCount: prepared.plan.changes.length },
        });
        return { applied: prepared.plan.changes.length, revisionId: revision.id, changedFields: prepared.plan.changes.map((change) => change.key) };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if ((error instanceof Error && error.message === "CONFIGURATION_PREVIEW_STALE") || (error as { code?: string })?.code === "P2034") {
        return reply.code(409).send({ ok: false, code: "CONFIGURATION_PREVIEW_STALE", error: "Configuration changed during publication. Review it again before applying." });
      }
      throw error;
    }
    if (!outcome.applied) return { ok: true, applied: 0, unchanged: true };
    // Rehydrate permission settings and invalidate stale in-memory projections.
    await readSettings(true);
    return { ok: true, applied: outcome.applied, unchanged: false, revisionId: outcome.revisionId };
  });

  // Reviewed rollback is a separate, narrow operation, not an import. It can
  // restore a previously absent field by DELETING its explicit AppSetting row.
  // The stored revision is evidence, not a capability or permission grant.
  const rollbackReasonBody = z.object({ previewId: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(12).max(500) }).strict();
  const rollbackPreviewBody = z.object({}).strict();
  const rollbackPathParams = z.object({ revisionId: z.string().min(1).max(128) }).strict();
  async function loadConfigurationRollback(revisionId: string, store: typeof prisma) {
    const revision = await store.studioConfigurationRevision.findUnique({
      where: { id: revisionId }, select: { id: true, changesJson: true },
    });
    if (!revision) return null;
    const entries = JSON.parse(revision.changesJson) as unknown;
    // Reject malformed/tampered historical values; this does not implicitly
    // grant permission to change new settings added in a future schema.
    const keys = parseSafeConfigurationRevisionChanges(entries).map((entry) => entry.key);
    return { revision, entries, keys };
  }
  function rollbackFingerprint(revisionId: string, changes: unknown) {
    return createHash("sha256").update(JSON.stringify({ kind: "configuration-rollback-v1", revisionId, changes })).digest("hex");
  }
  async function rollbackFromStore(revisionId: string, store: typeof prisma) {
    const history = await loadConfigurationRollback(revisionId, store);
    if (!history) return null;
    const stored = await store.appSetting.findMany({ where: { key: { in: history.keys } }, select: { key: true, value: true } });
    const current: Record<string, unknown> = {};
    for (const row of stored) current[row.key] = JSON.parse(row.value);
    const plan = planSafeConfigurationRollback(history.entries, current);
    return { plan, previewId: rollbackFingerprint(revisionId, plan.changes) };
  }

  app.post("/api/admin/setup/configuration/revisions/:revisionId/rollback/preview", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const { revisionId } = rollbackPathParams.parse(request.params);
    rollbackPreviewBody.parse(request.body ?? {});
    try {
      const prepared = await rollbackFromStore(revisionId, prisma);
      if (!prepared) return reply.code(404).send({ ok: false, error: "Configuration revision not found." });
      if (prepared.plan.conflictingKeys.length) return reply.code(409).send({
        ok: false, code: "CONFIGURATION_ROLLBACK_CONFLICT",
        error: "These defaults changed after the selected revision. Review their current values rather than overwriting another administrator's changes.",
        conflictingKeys: prepared.plan.conflictingKeys,
      });
      return { ok: true, revisionId, previewId: prepared.previewId, changes: prepared.plan.changes };
    } catch {
      return reply.code(409).send({ ok: false, code: "CONFIGURATION_REVISION_INVALID", error: "The selected revision cannot be safely rolled back." });
    }
  });

  app.post("/api/admin/setup/configuration/revisions/:revisionId/rollback/apply", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const { revisionId } = rollbackPathParams.parse(request.params);
    const { previewId, reason } = rollbackReasonBody.parse(request.body);
    let result: { applied: number; newRevisionId: string };
    try {
      result = await prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(506, 1)::text AS "locked"`;
        const prepared = await rollbackFromStore(revisionId, tx as typeof prisma);
        if (!prepared || prepared.plan.conflictingKeys.length || prepared.previewId !== previewId || !prepared.plan.changes.length) {
          throw new Error("CONFIGURATION_ROLLBACK_STALE");
        }
        for (const change of prepared.plan.changes) {
          if (change.after === null) await tx.appSetting.deleteMany({ where: { key: change.key } });
          else await tx.appSetting.upsert({
            where: { key: change.key },
            create: { key: change.key, value: JSON.stringify(change.after) },
            update: { value: JSON.stringify(change.after) },
          });
        }
        const requested = Object.fromEntries(prepared.plan.changes.filter((item) => item.after !== null).map((item) => [item.key, item.after]));
        const created = await tx.studioConfigurationRevision.create({ data: {
          actorUserId: admin.id, previewId,
          requestedJson: JSON.stringify(requested),
          changesJson: JSON.stringify(prepared.plan.changes),
        } });
        // The rollback is not committed unless its tamper-evident audit record
        // also commits. This is the same transaction, not post-commit logging.
        await appendSecurityAuditEvent(tx, {
          event: "instance.configuration_rolled_back", actorUserId: admin.id,
          result: "SUCCESS", reasonCode: "REVIEWED_CONFIGURATION_ROLLBACK",
          requestId: request.id || null, requestMethod: request.method || "POST",
          requestPath: "/api/admin/setup/configuration/revisions/:revisionId/rollback/apply",
          metadata: { sourceRevisionId: revisionId, revisionId: created.id, changedCount: prepared.plan.changes.length, reason },
        });
        return { applied: prepared.plan.changes.length, newRevisionId: created.id };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if ((error instanceof Error && error.message === "CONFIGURATION_ROLLBACK_STALE") || (error as { code?: string })?.code === "P2034") {
        return reply.code(409).send({ ok: false, code: "CONFIGURATION_ROLLBACK_STALE", error: "Configuration or revision changed. Preview the rollback again." });
      }
      throw error;
    }
    await readSettings(true);
    return { ok: true, applied: result.applied, revisionId: result.newRevisionId };
  });

  app.post("/api/setup/complete", async (request, reply) => {
    if (await rateLimit(request, reply, "setup", 12, 60_000)) return;

    const existingSettings = await readSettings();
    const instanceSetup = await inspectInstanceSetup(prisma);
    const existingComplete = setupIsComplete(existingSettings) && !instanceSetup.setupRequired;

    if (!existingComplete && !isLoopbackAddress(request.ip)) {
      return reply.code(403).send({
        ok: false,
        error: "First-run owner setup is restricted to the local server. Run the normal Cluster launcher on the host to complete setup.",
      });
    }

    if (existingComplete) {
      return reply.code(409).send({
        ok: false,
        code: "SETUP_ALREADY_COMPLETE",
        error: "Initial server setup is already complete. Use Studio or Server Configuration for later changes; account recovery uses the dedicated recovery flow.",
      });
    }

    const body = z.object({
      serverDisplayName: z.string().trim().min(1).max(120),
      ownerUsername: z.string().min(3).max(32),
      ownerPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
      ownerPin: z.string().regex(/^\d{4,8}$/, "Choose a 4–8 digit PIN."),
      mode: z.enum(["guided", "quick", "import", "skip"]).default("quick"),
      studioName: z.string().trim().min(1).max(120).optional(),
      studioTimezone: z.string().trim().min(1).max(120).optional(),
      configuration: z.unknown().optional(),
      domainSetupIntent: z.object({
        domain: z.string().trim().min(3).max(253).regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i),
        mode: z.enum(["lan", "private_vpn", "reverse_proxy", "direct_https", "managed_tunnel"]),
        provider: z.enum(["manual", "tailscale", "wireguard", "caddy", "nginx", "cloudflare", "custom"]),
      }).strict().refine(input => ({
        lan: ["manual", "caddy", "nginx"], private_vpn: ["tailscale", "wireguard", "custom"],
        reverse_proxy: ["caddy", "nginx", "custom"], direct_https: ["caddy", "nginx"],
        managed_tunnel: ["cloudflare", "custom"],
      }[input.mode] as string[]).includes(input.provider), "Unsupported domain connection mode/provider").optional(),
    }).parse(request.body);

    // All imported values are validated server-side, not trusted from the browser preview.
    // Reject configuration outside Import mode and identity overrides outside Guided mode.
    let studioDefaults: Record<string, unknown> = {};
    if (body.mode === "import") {
      if (JSON.stringify(body.configuration ?? null).length > 16_384) {
        return reply.code(413).send({ ok: false, error: "Configuration exceeds the 16 KiB setup limit." });
      }
      try { studioDefaults = parseClusterConfigBundle(body.configuration).settings; }
      catch (error) { return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Invalid configuration bundle." }); }
    } else if (body.configuration !== undefined) {
      return reply.code(400).send({ ok: false, error: "Configuration uploads require Import mode." });
    }
    if (body.mode === "guided") {
      if (!body.studioName) return reply.code(400).send({ ok: false, error: "Guided setup needs a studio name." });
      try {
        studioDefaults = parseClusterConfigBundle({
          format: "clusterconfig", schemaVersion: 1,
          settings: { studioName: body.studioName, ...(body.studioTimezone ? { studioTimezone: body.studioTimezone } : {}) },
        }).settings;
      } catch (error) {
        return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Studio configuration is invalid." });
      }
    }

    let ownerUsername = "owner";
    let ownerPassword = "";
    try {
      ownerUsername = normalizeAuthUsername(body.ownerUsername);
      ownerPassword = validateNewPassword(body.ownerPassword, { username: ownerUsername, displayName: ownerUsername });
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        error: error instanceof Error ? error.message : "Owner credentials are invalid.",
      });
    }

    const [ownerPasswordHash, ownerPinHash] = await Promise.all([hashPassword(ownerPassword), hashSecurityPin(body.ownerPin)]);
    const owner = await (prisma as any).user.upsert({
      where: { username: ownerUsername },
      update: {
        passwordHash: ownerPasswordHash,
        pinHash: ownerPinHash,
        pinUpdatedAt: new Date(),
        failedPinCount: 0,
        pinLockedUntil: null,
        passwordChangedAt: new Date(),
        firstLoginCompletedAt: new Date(),
        accountState: nextAccountState(null, REQUIRE_DISCORD_LINK),
        failedLoginCount: 0,
        lockedUntil: null,
      },
      create: {
        username: ownerUsername,
        displayName: ownerUsername,
        passwordHash: ownerPasswordHash,
        pinHash: ownerPinHash,
        pinUpdatedAt: new Date(),
        failedPinCount: 0,
        pinLockedUntil: null,
        passwordChangedAt: new Date(),
        firstLoginCompletedAt: new Date(),
        accountState: nextAccountState(null, REQUIRE_DISCORD_LINK),
      },
    });

    let workspace = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } });
    if (!workspace) {
      workspace = await prisma.workspace.create({ data: { name: "Cluster Workspace" } });
    }

    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: owner.id } },
      update: { role: "owner" },
      create: { workspaceId: workspace.id, userId: owner.id, role: "owner" },
    });

    const serverInstanceId = cleanOptionalString(existingSettings.serverInstanceId) || randomUUID();
    const serverDataEpoch = cleanOptionalString(existingSettings.serverDataEpoch) || randomUUID();
    const setupSettings: SettingPayload = {
      ...existingSettings,
      setupComplete: true,
      setupCompletedAt: new Date().toISOString(),
      setupCompletedBy: owner.id,
      setupMode: body.mode,
      ...(body.domainSetupIntent ? { domainSetupIntent: {
        ...body.domainSetupIntent, domain: body.domainSetupIntent.domain.toLowerCase(),
      } } : {}),
      ...studioDefaults,
      setupChecklistSkippedIds: [],
      serverInstanceId,
      serverDataEpoch,
      serverDisplayName: cleanOptionalString(body.serverDisplayName) || "Cluster Server",
      lanDiscoveryEnabled: existingSettings.lanDiscoveryEnabled !== false,
      appDisplayName: "Cluster",
      autoSeed: false,
    };

    await saveSettings(setupSettings);
    // Initial owner bootstrap is password-authenticated. MFA, recovery codes,
    // and optional integrations are configured from the authenticated setup
    // checklist after the workspace opens, not as a mandatory login trap.
    // An administrator enabling an explicit MFA policy must first verify with
    // a compliant authenticator (studio-security-routes enforces this).
    await createSession(owner.id, reply, request, { authMethod: "password" });
    await logActivity({
      userId: owner.id,
      type: "setup",
      entityType: "instance",
      entityId: workspace.id,
      title: "Cluster Server bootstrapped",
      message: `${setupSettings.serverDisplayName} is ready for Studio configuration.`,
    });
    await logSecurityEvent({
      event: "account.setup_completed",
      actorUserId: owner.id,
      targetUserId: owner.id,
      workspaceId: workspace.id,
      result: "SUCCESS",
      reasonCode: "FIRST_RUN_OWNER_CREATED",
      request,
      metadata: {
        accountState: nextAccountState(null, REQUIRE_DISCORD_LINK),
        discordLinkRequired: REQUIRE_DISCORD_LINK,
        serverInstanceId,
        serverDataEpoch,
        setupMode: body.mode,
      },
    });

    const ownerForClient = await decorateUserForClient(owner);
    return {
      ok: true,
      user: ownerForClient,
      nextStep: ownerForClient.nextAuthStep || "NONE",
      mfaEnrollmentRequired: false,
      setup: await getSetupStatus(),
    };
  });
}
