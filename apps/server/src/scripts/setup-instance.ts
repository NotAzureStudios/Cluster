import "dotenv/config";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { normalizeAuthUsername } from "../core/auth.js";
import { createClusterDataLayout, storageOverridesFromSettings } from "../core/data-layout.js";
import { loadRuntimeConfig } from "../core/runtime-config.js";
import { createPrismaClient } from "../core/prisma-client.js";
import {
  inspectInstanceSetup,
  issueAdministratorRecoveryCredential,
  markLauncherSetupComplete,
  provisionInitialOwner,
  type SetupUserSummary,
} from "../core/instance-setup.js";

const prisma = createPrismaClient();
const terminal = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function argument(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function ask(label: string, fallback = "") {
  if (!process.stdin.isTTY) {
    if (fallback) return fallback;
    throw new Error(`${label} is required in non-interactive mode.`);
  }
  const suffix = fallback ? ` [${fallback}]` : "";
  const value = (await terminal.question(`${label}${suffix}: `)).trim();
  return value || fallback;
}

async function confirm(label: string, fallback = false) {
  if (!process.stdin.isTTY) return fallback;
  const answer = (
    await terminal.question(`${label} ${fallback ? "[Y/n]" : "[y/N]"}: `)
  )
    .trim()
    .toLowerCase();
  if (!answer) return fallback;
  return answer === "y" || answer === "yes";
}

function resolveWorkspaceRoot() {
  const cwd = process.cwd();
  return path.basename(cwd) === "server" &&
    path.basename(path.dirname(cwd)) === "apps"
    ? path.resolve(cwd, "../..")
    : cwd;
}

function configFile() {
  return (
    process.env.CLUSTER_CONFIG_FILE ||
    path.join(resolveWorkspaceRoot(), "cluster.config.json")
  );
}

async function selectAdministrator(administrators: SetupUserSummary[]) {
  const requestedUsername = argument("username");
  if (requestedUsername) {
    const normalized = normalizeAuthUsername(requestedUsername);
    const selected = administrators.find(
      (user) => user.username === normalized,
    );
    if (!selected)
      throw new Error(`No owner or admin account exists for ${normalized}.`);
    return selected;
  }
  if (administrators.length === 1) return administrators[0];
  console.log("\nAdministrator accounts:");
  administrators.forEach((user, index) => {
    console.log(
      `  ${index + 1}. ${user.username} (${user.displayName || user.username})`,
    );
  });
  const choice = Number(await ask("Select an account", "1"));
  const selected = administrators[choice - 1];
  if (!selected)
    throw new Error("The selected administrator account is invalid.");
  return selected;
}

function printCredential(
  credential: Awaited<ReturnType<typeof provisionInitialOwner>>,
) {
  console.log("\n============================================================");
  console.log(
    credential.created
      ? "Cluster owner account created"
      : "Temporary local administrator password issued",
  );
  console.log("============================================================");
  console.log(`Username: ${credential.username}`);
  console.log(`Temporary password: ${credential.temporaryPassword}`);
  console.log("\nSign in normally with this temporary password. Cluster will require a new permanent password immediately.");
  console.log("The temporary password is shown only here. Existing sessions for the account were revoked.");
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    const runtime = loadRuntimeConfig({ cwd: process.cwd() });
    const dataRoot = path.resolve(process.env.CLUSTER_DATA_DIR || runtime.bootSettings.dataRootOverride || path.join(runtime.bootWorkspaceRoot, "data"));
    const layout = createClusterDataLayout(dataRoot, { configFile: runtime.bootConfigFilePath, storageOverrides: storageOverridesFromSettings(runtime.bootSettings) });
    console.log(`\nDiscord OAuth is not configured yet. Add DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET to ${path.join(layout.runtimeRoot, "server.env")} before linking the account.`);
  }
  console.log("============================================================\n");
}

async function main() {
  console.log("\nCluster Administration workspace");
  console.log(
    "Creates or recovers the first owner account using a one-time temporary password.\n",
  );

  const status = await inspectInstanceSetup(prisma);
  const studioName =
    argument("studio-name") || process.env.CLUSTER_STUDIO_NAME || "Studio";
  const workspaceName = argument("workspace-name") || "Cluster Workspace";

  if (status.administrators.length > 0) {
    const administrator = await selectAdministrator(status.administrators);
    if (administrator.passwordHash && !process.argv.includes("--recover")) {
      console.log(
        `The account ${administrator.username} already has a password.`,
      );
      const approved = await confirm(
        "Replace the password with a one-time temporary password and revoke active sessions?",
        false,
      );
      if (!approved) {
        console.log("No account changes were made.");
        return;
      }
    }
    const credential = await issueAdministratorRecoveryCredential(prisma, { userId: administrator.id });
    await markLauncherSetupComplete({
      prisma,
      configFile: configFile(),
      userId: credential.userId,
      studioName,
      workspaceName,
    });
    printCredential(credential);
    return;
  }

  const requestedUsername =
    argument("username") || (await ask("Owner username", "owner"));
  const username = normalizeAuthUsername(requestedUsername);
  const displayName =
    argument("display-name") || (await ask("Owner display name", username));
  const resolvedStudioName =
    argument("studio-name") ||
    (await ask("Studio / organization name", studioName));
  const resolvedWorkspaceName =
    argument("workspace-name") || (await ask("Workspace name", workspaceName));

  const credential = await provisionInitialOwner(prisma, {
    username,
    displayName,
    studioName: resolvedStudioName,
    workspaceName: resolvedWorkspaceName,
  });
  await markLauncherSetupComplete({
    prisma,
    configFile: configFile(),
    userId: credential.userId,
    studioName: resolvedStudioName,
    workspaceName: resolvedWorkspaceName,
  });
  printCredential(credential);
}

main()
  .catch((error) => {
    console.error(
      `\nSetup failed: ${error instanceof Error ? error.message : error}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    terminal.close();
    await prisma.$disconnect();
  });
