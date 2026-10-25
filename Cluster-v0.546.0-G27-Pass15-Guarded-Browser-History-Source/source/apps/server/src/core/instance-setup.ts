import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { generateTemporaryPassword, hashPassword } from "./auth.js";
import { encryptSettingStorageValue } from "./setting-crypto.js";
import { appendSecurityAuditEvent } from "./security-audit-store.js";

export type SetupUserSummary = {
  id: string;
  username: string;
  displayName?: string | null;
  passwordHash?: string | null;
  accountState?: string | null;
  memberships?: Array<{ workspaceId: string; role: string }>;
};

export type InstanceSetupSummary = {
  userCount: number;
  workspaceCount: number;
  administratorCount: number;
  passwordReadyAdministratorCount: number;
  pendingAdministratorSetupCount: number;
  setupRequired: boolean;
  reason: "NO_ADMINISTRATOR" | "NO_ADMIN_PASSWORD" | "READY";
  administrators: SetupUserSummary[];
};

const ADMIN_ROLES = new Set(["owner", "admin"]);
const UNAVAILABLE_STATES = new Set(["DISABLED", "SUSPENDED", "LOCKED"]);

export function summarizeInstanceSetup(
  users: SetupUserSummary[],
  workspaceCount: number,
  now = new Date(),
): InstanceSetupSummary {
  const administrators = users.filter((user) =>
    (user.memberships || []).some((membership) => ADMIN_ROLES.has(String(membership.role).toLowerCase())),
  );
  const passwordReadyAdministrators = administrators.filter((user) =>
    Boolean(user.passwordHash) && !UNAVAILABLE_STATES.has(String(user.accountState || "")),
  );
  const pendingAdministratorSetupCount = administrators.filter((user) =>
    ["PASSWORD_CHANGE_REQUIRED", "PASSWORD_RESET_REQUIRED"].includes(String(user.accountState || "")),
  ).length;

  const reason = administrators.length === 0
    ? "NO_ADMINISTRATOR"
    : passwordReadyAdministrators.length === 0
      ? "NO_ADMIN_PASSWORD"
      : "READY";

  return {
    userCount: users.length,
    workspaceCount,
    administratorCount: administrators.length,
    passwordReadyAdministratorCount: passwordReadyAdministrators.length,
    pendingAdministratorSetupCount,
    setupRequired: reason !== "READY",
    reason,
    administrators,
  };
}

export async function inspectInstanceSetup(prisma: any): Promise<InstanceSetupSummary> {
  const [users, workspaceCount] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        passwordHash: true,
        accountState: true,
        memberships: { select: { workspaceId: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.workspace.count(),
  ]);

  return summarizeInstanceSetup(users, workspaceCount);
}

export type ProvisionOwnerInput = {
  username: string;
  displayName: string;
  studioName: string;
  workspaceName: string;
};

export type IssuedOwnerCredential = {
  userId: string;
  username: string;
  displayName: string;
  temporaryPassword: string;
  workspaceId: string;
  created: boolean;
};

export async function provisionInitialOwner(
  prisma: any,
  input: ProvisionOwnerInput,
): Promise<IssuedOwnerCredential> {
  const now = new Date();
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  return prisma.$transaction(async (transaction: any) => {
    let workspace = await transaction.workspace.findFirst({ orderBy: { createdAt: "asc" } });
    if (!workspace) {
      workspace = await transaction.workspace.create({
        data: { name: input.workspaceName, description: input.studioName || null },
      });
    }

    let user = await transaction.user.findUnique({ where: { username: input.username } });
    const created = !user;
    if (!user) {
      user = await transaction.user.create({
        data: {
          username: input.username,
          displayName: input.displayName,
          passwordHash,
          passwordChangedAt: null,
          accountState: "PASSWORD_CHANGE_REQUIRED",
        },
      });
    } else {
      user = await transaction.user.update({
        where: { id: user.id },
        data: {
          displayName: user.displayName || input.displayName,
          passwordHash,
          passwordChangedAt: null,
          accountState: "PASSWORD_RESET_REQUIRED",
          failedLoginCount: 0,
          lastFailedLoginAt: null,
          lockedUntil: null,
        },
      });
    }

    await transaction.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
      update: { role: "owner" },
      create: { workspaceId: workspace.id, userId: user.id, role: "owner" },
    });
    await transaction.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now, revocationReason: "instance_setup" },
    });
    await appendSecurityAuditEvent(transaction, {
      event: created ? "account.created" : "account.password_reset_required",
      actorUserId: user.id,
      targetUserId: user.id,
      workspaceId: workspace.id,
      result: "SUCCESS",
      reasonCode: created ? "SERVER_SETUP_TEMPORARY_PASSWORD" : "SERVER_RECOVERY_TEMPORARY_PASSWORD",
      metadata: { launcher: true },
    });

    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName || input.displayName,
      temporaryPassword,
      workspaceId: workspace.id,
      created,
    };
  });
}

export async function issueAdministratorRecoveryCredential(
  prisma: any,
  input: { userId: string },
): Promise<IssuedOwnerCredential> {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, include: { memberships: true } });
  if (!user) throw new Error("The selected account no longer exists.");
  const administratorMembership = user.memberships.find((membership: any) =>
    ADMIN_ROLES.has(String(membership.role).toLowerCase()),
  );
  if (!administratorMembership) throw new Error("Recovery is limited to owner or admin accounts.");

  const now = new Date();
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await prisma.$transaction(async (transaction: any) => {
    await transaction.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: null,
        accountState: "PASSWORD_RESET_REQUIRED",
        failedLoginCount: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
      },
    });
    await transaction.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now, revocationReason: "owner_recovery" },
    });
    await appendSecurityAuditEvent(transaction, {
      event: "account.password_reset_required",
      actorUserId: user.id,
      targetUserId: user.id,
      workspaceId: administratorMembership.workspaceId,
      result: "SUCCESS",
      reasonCode: "SERVER_OPERATOR_TEMPORARY_PASSWORD",
      metadata: { launcher: true },
    });
  });

  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    temporaryPassword,
    workspaceId: administratorMembership.workspaceId,
    created: false,
  };
}

export async function markLauncherSetupComplete(input: {
  prisma: any;
  configFile: string;
  userId: string;
  studioName: string;
  workspaceName: string;
}): Promise<void> {
  let document: any = {
    version: 2,
    updatedAt: new Date().toISOString(),
    secretPolicy: "server-managed-only",
    settings: {},
  };
  try {
    document = JSON.parse(await fs.readFile(input.configFile, "utf8"));
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
    // A missing local config is expected on first launch.
  }
  if (
    !document ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    Number(document.version) !== 2 ||
    document.secretPolicy !== "server-managed-only" ||
    !document.settings ||
    typeof document.settings !== "object" ||
    Array.isArray(document.settings)
  ) {
    throw new Error("Cluster server config must use schema version 2 with server-managed-only secret policy.");
  }
  const settings = document.settings as Record<string, unknown>;
  const databaseManagedKeys = new Set([
    "setupComplete", "setupCompletedAt", "setupCompletedBy", "setupMode",
    "appDisplayName", "studioName", "workspaceName",
    "giteaBaseUrl", "giteaDefaultOwner", "giteaDefaultRepo",
    "gitProviderLabel", "gitImportClosedIssues", "gitAutoRefreshLinkedCards",
  ]);
  const misplacedDatabaseKeys = Object.keys(settings).filter((key) => databaseManagedKeys.has(key));
  if (misplacedDatabaseKeys.length) {
    throw new Error(`Database-managed settings cannot be stored in cluster.config.json: ${misplacedDatabaseKeys.join(", ")}`);
  }
  const now = new Date().toISOString();
  const serverInstanceId = String(settings.serverInstanceId || "").trim() || randomUUID();
  const serverDataEpoch = String(settings.serverDataEpoch || "").trim() || randomUUID();
  const nextSettings = {
    ...settings,
    serverInstanceId,
    serverDataEpoch,
    serverDisplayName: String(settings.serverDisplayName || "").trim() || input.studioName || "Cluster Server",
    autoSeed: false,
  };

  const databaseSettings = {
    setupComplete: true,
    setupCompletedAt: now,
    setupCompletedBy: input.userId,
    setupMode: "launcher",
    appDisplayName: "Cluster",
    studioName: input.studioName || "Studio",
    workspaceName: input.workspaceName || "Cluster Workspace",
  };
  const settingsUnchanged = JSON.stringify(settings) === JSON.stringify(nextSettings)
    && Number(document?.version) === 2
    && document?.secretPolicy === "server-managed-only";
  if (!settingsUnchanged) {
    const updated = {
      version: 2,
      updatedAt: now,
      secretPolicy: "server-managed-only",
      settings: nextSettings,
    };

    await fs.mkdir(path.dirname(input.configFile), { recursive: true });
    const temporary = `${input.configFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, input.configFile);
  }

  // Mark setup complete only after the boot config is safely committed. If the
  // disk write fails, the next launcher run remains recoverable instead of
  // leaving the database claiming setup succeeded with incomplete boot state.
  await input.prisma.$transaction(async (transaction: any) => {
    for (const [key, value] of Object.entries(databaseSettings)) {
      const storedValue = encryptSettingStorageValue(key, JSON.stringify(value));
      await transaction.appSetting.upsert({
        where: { key },
        update: { value: storedValue },
        create: { key, value: storedValue },
      });
    }
  });
}
