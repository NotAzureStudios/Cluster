import "dotenv/config";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

import { createClusterDataLayout, storageOverridesFromSettings } from "../core/data-layout.js";
import { assertServerOffline } from "../core/server-runtime-marker.js";

function args(argv: string[]) {
  const parsed = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > 2) parsed.set(token.slice(2, eq), token.slice(eq + 1));
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) parsed.set(token.slice(2), argv[++i]);
    else parsed.set(token.slice(2), true);
  }
  return parsed;
}

function required(value: string | true | undefined, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

const STORAGE_OVERRIDE_KEYS = [
  "projectsRootOverride", "libraryRootOverride", "usersRootOverride", "backupsRootOverride",
  "logsRootOverride", "runtimeRootOverride", "exportsRootOverride", "uploadRootOverride", "brandingRootOverride",
] as const;

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

async function readConfig(configPath: string) {
  const raw = await fs.readFile(configPath, "utf8").catch(() => "");
  if (!raw.trim()) return { current: null as any, settings: {} as Record<string, any> };
  const current = JSON.parse(raw);
  return { current, settings: (current?.settings && typeof current.settings === "object") ? current.settings as Record<string, any> : {} };
}


function rewriteInternalAbsoluteOverrides(settings: Record<string, any>, sourceRoot: string, targetRoot: string) {
  for (const key of STORAGE_OVERRIDE_KEYS) {
    const value = String(settings[key] || "").trim();
    if (!value || !path.isAbsolute(value)) continue;
    const resolved = path.resolve(value);
    if (!pathContains(sourceRoot, resolved)) continue;
    settings[key] = path.join(targetRoot, path.relative(sourceRoot, resolved));
  }
}

async function sha256(filePath: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash as any);
  return hash.digest("hex");
}

async function inventory(root: string) {
  const files: Array<{ relative: string; size: number }> = [];
  async function walk(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing to migrate symbolic link ${path.relative(root, full)}.`);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) { const stat = await fs.stat(full); files.push({ relative: path.relative(root, full), size: stat.size }); }
      else throw new Error(`Refusing to migrate unsupported filesystem entry ${path.relative(root, full)}.`);
    }
  }
  await walk(root);
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

async function copyVerified(sourceRoot: string, targetRoot: string) {
  const files = await inventory(sourceRoot);
  let copiedBytes = 0;
  for (const [index, file] of files.entries()) {
    const source = path.join(sourceRoot, file.relative);
    const target = path.join(targetRoot, file.relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await pipeline(createReadStream(source), createWriteStream(target, { mode: 0o640 }));
    const [sourceHash, targetHash] = await Promise.all([sha256(source), sha256(target)]);
    if (sourceHash !== targetHash) throw new Error(`Checksum verification failed for ${file.relative}.`);
    copiedBytes += file.size;
    if ((index + 1) % 100 === 0 || index + 1 === files.length) console.error(`Verified ${index + 1}/${files.length} files · ${copiedBytes} bytes`);
  }
  return { files: files.length, bytes: copiedBytes };
}

async function assertPrivatePostgresOffline(postgresDataRoot: string) {
  const pidFile = path.join(postgresDataRoot, "postmaster.pid");
  const raw = await fs.readFile(pidFile, "utf8").catch(() => "");
  if (!raw.trim()) return;
  const pid = Number(raw.split(/\r?\n/, 1)[0]);
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      throw new Error(`Private PostgreSQL still appears to be running as PID ${pid}. Stop PostgreSQL before moving the Data Root.`);
    } catch (error: any) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  throw new Error(`A PostgreSQL postmaster.pid exists at ${pidFile}. Refusing to copy a possibly-live database; clear the stale PID only after verifying PostgreSQL is stopped.`);
}

async function writeConfigDataRoot(configPath: string, sourceRoot: string, targetRoot: string) {
  const current = JSON.parse(await fs.readFile(configPath, "utf8"));
  current.settings ||= {};
  rewriteInternalAbsoluteOverrides(current.settings, sourceRoot, targetRoot);
  current.settings.dataRootOverride = targetRoot;
  current.updatedAt = new Date().toISOString();
  const temporary = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(current, null, 2)}\n`, { encoding: "utf8", mode: 0o640 });
  await fs.rename(temporary, configPath);
}

const options = args(process.argv.slice(2));
const sourceRoot = path.resolve(required(options.get("from") || process.env.CLUSTER_DATA_DIR, "--from or CLUSTER_DATA_DIR"));
const targetRoot = path.resolve(required(options.get("to"), "--to"));
const configPath = path.resolve(String(options.get("config") || process.env.CLUSTER_CONFIG_FILE || path.join(path.dirname(sourceRoot), "cluster.config.json")));
const commit = options.get("commit") === "MOVE_CLUSTER_DATA";
const configStat = await fs.stat(configPath).catch(() => null);
if (commit && !configStat?.isFile()) throw new Error(`Cluster config file was not found at ${configPath}. Pass --config explicitly before committing the move.`);
const loadedConfig = configStat?.isFile() ? await readConfig(configPath) : { current: null, settings: {} as Record<string, any> };
if (comparablePath(sourceRoot) === comparablePath(targetRoot)) throw new Error("Source and target Data Root are the same path.");
if (pathContains(sourceRoot, targetRoot) || pathContains(targetRoot, sourceRoot)) throw new Error("Source and target Data Root may not contain one another.");
const sourceLayout = createClusterDataLayout(sourceRoot, { configFile: configPath, storageOverrides: storageOverridesFromSettings(loadedConfig.settings) });
await assertServerOffline(sourceLayout.runtimeRoot, { clearStaleMarker: Boolean(options.get("clear-stale-marker")) });
await assertPrivatePostgresOffline(sourceLayout.postgresDataRoot);
await fs.mkdir(targetRoot, { recursive: true });
const targetEntries = await fs.readdir(targetRoot);
if (targetEntries.length) throw new Error("Target Data Root must be empty. Cluster will not merge a Data Root migration into existing files.");
const copied = await copyVerified(sourceRoot, targetRoot);
if (commit) await writeConfigDataRoot(configPath, sourceRoot, targetRoot);
console.log(JSON.stringify({ ok: true, sourceRoot, targetRoot, configPath, copied, committed: commit, oldRootPreserved: true, note: commit ? "Config now points at the verified target. The old Data Root was intentionally preserved." : "Dry migration copy verified. Re-run with --commit=MOVE_CLUSTER_DATA to repoint Cluster after reviewing the target." }, null, 2));
