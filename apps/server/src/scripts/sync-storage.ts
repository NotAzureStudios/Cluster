import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { createClusterDataLayout, ensureClusterDataLayout, storageOverridesFromSettings, syncEditableDataMirrors } from "../core/data-layout.js";
import { createPrismaClient } from "../core/prisma-client.js";

function workspaceRoot() {
  const cwd = process.cwd();
  return path.basename(cwd) === "server" && path.basename(path.dirname(cwd)) === "apps" ? path.resolve(cwd, "../..") : cwd;
}

async function readBootSettings(configPath: string) {
  const raw = await fs.readFile(configPath, "utf8").catch((error: any) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  if (!raw.trim()) return {} as Record<string, any>;
  const parsed = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Number(parsed.version) !== 2 ||
    parsed.secretPolicy !== "server-managed-only" ||
    !parsed.settings ||
    typeof parsed.settings !== "object" ||
    Array.isArray(parsed.settings)
  ) {
    throw new Error("Cluster server config must use schema version 2 with server-managed-only secret policy.");
  }
  return parsed.settings as Record<string, any>;
}

const root = workspaceRoot();
const configPath = path.resolve(process.env.CLUSTER_CONFIG_FILE || path.join(root, "cluster.config.json"));
const settings = await readBootSettings(configPath);
const dataRoot = path.resolve(process.env.CLUSTER_DATA_DIR || settings.dataRootOverride || path.join(root, "data"));
const layout = createClusterDataLayout(dataRoot, {
  configFile: configPath,
  storageOverrides: storageOverridesFromSettings(settings),
});
const prisma = createPrismaClient();

try {
  await ensureClusterDataLayout(layout);
  const result = await syncEditableDataMirrors(prisma, layout);
  console.log(`Storage mirrors synchronized: ${result.projects} project(s), ${result.users} user(s), ${result.libraryItems} Library item(s).`);
  console.log(`Data Root: ${layout.root}`);
  console.log(`Library: ${layout.libraryRoot}`);
  console.log(`Projects: ${layout.projectsRoot}`);
  console.log(`Users: ${layout.usersRoot}`);
} finally {
  await prisma.$disconnect();
}
