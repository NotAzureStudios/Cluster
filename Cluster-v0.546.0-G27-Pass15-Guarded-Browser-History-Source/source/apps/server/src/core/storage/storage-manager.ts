import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

export type ClusterStorageDomain =
  | "root" | "system" | "projects" | "library" | "users" | "backups" | "logs" | "runtime"
  | "exports" | "uploads" | "branding" | "cache" | "gitWorktrees" | "thumbnails" | "transcodes"
  | "uploadStaging" | "temp" | "repositoryMirrors" | "postgresData" | "redisData";

export type ClusterStorageOverrides = Partial<Record<Exclude<ClusterStorageDomain, "root" | "system" | "cache" | "gitWorktrees" | "thumbnails" | "transcodes" | "uploadStaging" | "temp" | "repositoryMirrors" | "postgresData" | "redisData">, string>>;

function comparablePath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathContains(parent: string, child: string) {
  const parentComparable = comparablePath(parent);
  const childComparable = comparablePath(child);
  const prefix = parentComparable.endsWith(path.sep) ? parentComparable : `${parentComparable}${path.sep}`;
  return childComparable === parentComparable || childComparable.startsWith(prefix);
}

function resolveConfiguredPath(root: string, configured: string | undefined, fallback: string) {
  const value = String(configured || "").trim();
  if (!value) return path.join(root, fallback);
  return path.resolve(path.isAbsolute(value) ? value : path.join(root, value));
}


export function validateClusterStorageTopology(domains: Record<ClusterStorageDomain, string>) {
  // These are independently managed top-level domains. Allowing one to contain
  // another makes cleanup/migration code capable of treating durable data as
  // disposable (for example Runtime inside Projects, or vice versa).
  const topLevel: ClusterStorageDomain[] = [
    "projects", "library", "users", "backups", "logs", "runtime",
    "exports", "uploads", "branding",
  ];
  const conflicts: Array<{ first: ClusterStorageDomain; second: ClusterStorageDomain; firstPath: string; secondPath: string }> = [];
  for (let i = 0; i < topLevel.length; i += 1) {
    for (let j = i + 1; j < topLevel.length; j += 1) {
      const first = topLevel[i];
      const second = topLevel[j];
      const firstPath = domains[first];
      const secondPath = domains[second];
      if (pathContains(firstPath, secondPath) || pathContains(secondPath, firstPath)) {
        conflicts.push({ first, second, firstPath, secondPath });
      }
    }
  }
  const protectedSystemPath = domains.system;
  for (const domain of topLevel) {
    const domainPath = domains[domain];
    if (pathContains(protectedSystemPath, domainPath) || pathContains(domainPath, protectedSystemPath)) {
      conflicts.push({ first: domain, second: "system", firstPath: domainPath, secondPath: protectedSystemPath });
    }
  }
  if (conflicts.length) {
    const detail = conflicts.map((entry) => `${entry.first}=${entry.firstPath} overlaps ${entry.second}=${entry.secondPath}`).join("; ");
    throw new Error(`Cluster storage domains must not overlap: ${detail}`);
  }
  return true;
}

export function createClusterStorageManager(dataRoot: string, overrides: ClusterStorageOverrides = {}) {
  const root = path.resolve(dataRoot);
  const runtime = resolveConfiguredPath(root, overrides.runtime, "Runtime");
  const system = path.join(root, "System");
  const domains: Record<ClusterStorageDomain, string> = {
    root,
    system,
    projects: resolveConfiguredPath(root, overrides.projects, "Projects"),
    library: resolveConfiguredPath(root, overrides.library, "Library"),
    users: resolveConfiguredPath(root, overrides.users, "Users"),
    backups: resolveConfiguredPath(root, overrides.backups, "Backups"),
    logs: resolveConfiguredPath(root, overrides.logs, "Logs"),
    runtime,
    exports: resolveConfiguredPath(root, overrides.exports, "Exports"),
    uploads: resolveConfiguredPath(root, overrides.uploads, "Uploads"),
    branding: resolveConfiguredPath(root, overrides.branding, "Branding"),
    cache: path.join(runtime, "Cache"),
    gitWorktrees: path.join(runtime, "GitWorktrees"),
    thumbnails: path.join(runtime, "Thumbnails"),
    transcodes: path.join(runtime, "Transcodes"),
    uploadStaging: path.join(runtime, "UploadStaging"),
    temp: path.join(runtime, "Temp"),
    repositoryMirrors: path.join(system, "RepositoryMirrors"),
    postgresData: path.join(system, "PostgreSQL", "data"),
    redisData: path.join(system, "Redis"),
  };

  validateClusterStorageTopology(domains);

  const get = (domain: ClusterStorageDomain) => domains[domain];
  const uniqueDirectories = (selected?: ClusterStorageDomain[]) => Array.from(new Set((selected?.length ? selected.map((domain) => domains[domain]) : Object.values(domains))));
  const ensure = async (selected?: ClusterStorageDomain[]) => { await Promise.all(uniqueDirectories(selected).map((directory) => fs.mkdir(directory, { recursive: true }))); };
  const inspect = async (domain: ClusterStorageDomain) => {
    const target = domains[domain];
    try {
      await fs.mkdir(target, { recursive: true });
      await fs.access(target, fsConstants.R_OK | fsConstants.W_OK);
      const stats = await fs.statfs(target);
      const blockSize = Number(stats.bsize || 0);
      const totalBytes = Number(stats.blocks || 0) * blockSize;
      const freeBytes = Number(stats.bavail || stats.bfree || 0) * blockSize;
      const external = !pathContains(root, target);
      return { domain, path: target, available: true, writable: true, external, totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - freeBytes), freeRatio: totalBytes > 0 ? freeBytes / totalBytes : null };
    } catch (error) {
      return { domain, path: target, available: false, writable: false, external: false, totalBytes: null, freeBytes: null, usedBytes: null, freeRatio: null, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const inspectAll = async () => Promise.all((["projects", "library", "users", "backups", "logs", "runtime", "uploads", "system"] as ClusterStorageDomain[]).map(inspect));

  return { root, domains, get, ensure, uniqueDirectories, inspect, inspectAll };
}

export type ClusterStorageManager = ReturnType<typeof createClusterStorageManager>;
