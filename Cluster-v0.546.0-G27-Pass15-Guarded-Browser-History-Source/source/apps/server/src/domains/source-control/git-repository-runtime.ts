import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { safeStorageSegment } from "../../core/data-layout.js";

type GitRuntimeInspection = {
  available: boolean;
  version: string | null;
  lfsAvailable: boolean;
  lfsVersion: string | null;
  executable: string;
  checkedAt: string;
  message: string;
};

type MirrorStatus = {
  runtime: GitRuntimeInspection;
  mirrorState: "ready" | "missing" | "unavailable";
};

type WorkingCopyState = {
  status: "ready" | "dirty" | "conflicted" | "missing" | "unavailable";
  branchName: string | null;
  headRevision: string | null;
  upstreamName: string | null;
  dirtyFiles: number;
  stagedFiles: number;
  conflictCount: number;
  aheadCount: number;
  behindCount: number;
  mergeBaseRevision: string | null;
};

function safeRemoteUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text) throw new Error("Repository clone URL is not configured.");
  let parsed: URL;
  try { parsed = new URL(text); } catch { throw new Error("Repository clone URL is invalid."); }
  if (!["http:", "https:", "ssh:"].includes(parsed.protocol)) throw new Error("Managed repository mirrors support HTTP, HTTPS, or SSH clone URLs.");
  if (parsed.username || parsed.password) throw new Error("Repository clone URLs must not contain embedded passwords or tokens.");
  return text;
}

function safeBranchName(value: unknown) {
  const branch = String(value || "").normalize("NFKC").trim().slice(0, 200);
  if (!branch || branch.startsWith("-") || branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".") || branch.includes("..") || branch.includes("@{") || /[~^:?*[\\\s\u0000-\u001f]/.test(branch) || /(^|\/)\./.test(branch) || /\.lock(?:\/|$)/i.test(branch)) {
    throw new Error("Branch name is not valid for Git.");
  }
  return branch;
}

function gitAuthorizationHeader(providerId: string | null | undefined, token: string) {
  if (providerId === "source.github") return `Authorization: Basic ${Buffer.from(`x-access-token:${token}`, "utf8").toString("base64")}`;
  if (providerId === "source.gitlab") return `Authorization: Basic ${Buffer.from(`oauth2:${token}`, "utf8").toString("base64")}`;
  return `Authorization: token ${token}`;
}

function sanitizeGitError(error: unknown, secret?: string | null) {
  const source = error instanceof Error ? error.message : String(error || "Git command failed.");
  const redacted = secret ? source.split(secret).join("[redacted]") : source;
  return redacted.replace(/\s+/g, " ").trim().slice(0, 800) || "Git command failed.";
}

function parsePorcelainV2(value: string): Omit<WorkingCopyState, "status" | "headRevision" | "mergeBaseRevision"> {
  let branchName: string | null = null;
  let upstreamName: string | null = null;
  let aheadCount = 0;
  let behindCount = 0;
  let dirtyFiles = 0;
  let stagedFiles = 0;
  let conflictCount = 0;
  for (const line of String(value || "").split(/\r?\n/)) {
    if (line.startsWith("# branch.head ")) branchName = line.slice(14).trim() === "(detached)" ? null : line.slice(14).trim();
    else if (line.startsWith("# branch.upstream ")) upstreamName = line.slice(18).trim() || null;
    else if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) { aheadCount = Number(match[1]) || 0; behindCount = Number(match[2]) || 0; }
    } else if (line.startsWith("u ")) {
      dirtyFiles += 1;
      stagedFiles += 1;
      conflictCount += 1;
    } else if (/^[12] /.test(line)) {
      dirtyFiles += 1;
      const xy = line.slice(2, 4);
      if (xy[0] && xy[0] !== ".") stagedFiles += 1;
    } else if (line.startsWith("? ")) dirtyFiles += 1;
  }
  return { branchName, upstreamName, dirtyFiles, stagedFiles, conflictCount, aheadCount, behindCount };
}

export function createGitRepositoryRuntime(input: { repositoriesRoot: string; workspacesRoot: string; executable?: string }) {
  const executable = String(input.executable || process.env.CLUSTER_GIT_EXECUTABLE || "git").trim() || "git";
  const workspacesRoot = path.resolve(input.workspacesRoot);
  let inspectionCache: { expiresAt: number; value: GitRuntimeInspection } | null = null;

  function repositoryPath(repositoryId: string, repositoryPathOverride?: string | null) {
    return repositoryPathOverride ? path.resolve(repositoryPathOverride) : path.join(input.repositoriesRoot, `${safeStorageSegment(repositoryId, "repository")}.git`);
  }

  function workingCopyPath(workingCopyId: string) {
    return path.join(workspacesRoot, safeStorageSegment(workingCopyId, "working-copy"));
  }

  function run(args: string[], options: { cwd?: string; token?: string | null; providerId?: string | null; timeoutMs?: number; env?: Record<string, string> } = {}) {
    const env = { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: "0" } as Record<string, string>;
    if (options.token) {
      env.GIT_CONFIG_COUNT = "1";
      env.GIT_CONFIG_KEY_0 = "http.extraHeader";
      env.GIT_CONFIG_VALUE_0 = gitAuthorizationHeader(options.providerId, options.token);
    }
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile(executable, args, {
        cwd: options.cwd,
        env,
        windowsHide: true,
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: "utf8",
      }, (error, stdout, stderr) => {
        if (error) return reject(new Error(sanitizeGitError(`${error.message}\n${stderr || ""}`, options.token)));
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      });
    });
  }

  async function succeeds(args: string[], options: { cwd?: string; token?: string | null; providerId?: string | null; timeoutMs?: number } = {}) {
    try { await run(args, options); return true; } catch { return false; }
  }

  async function inspect(force = false): Promise<GitRuntimeInspection> {
    if (!force && inspectionCache && inspectionCache.expiresAt > Date.now()) return inspectionCache.value;
    let value: GitRuntimeInspection;
    try {
      const result = await run(["--version"], { timeoutMs: 5_000 });
      const version = result.stdout.trim().replace(/^git version\s+/i, "") || null;
      let lfsAvailable = false;
      let lfsVersion: string | null = null;
      try {
        const lfsResult = await run(["lfs", "version"], { timeoutMs: 5_000 });
        lfsAvailable = true;
        lfsVersion = lfsResult.stdout.trim().replace(/^git-lfs\//i, "") || null;
      } catch {}
      value = {
        available: true,
        version,
        lfsAvailable,
        lfsVersion,
        executable: path.basename(executable),
        checkedAt: new Date().toISOString(),
        message: `${version ? `Git ${version}` : "Git"} is available${lfsAvailable ? ` with Git LFS${lfsVersion ? ` ${lfsVersion}` : ""}` : "; Git LFS is unavailable"}.`,
      };
    } catch {
      value = { available: false, version: null, lfsAvailable: false, lfsVersion: null, executable: path.basename(executable), checkedAt: new Date().toISOString(), message: "Git runtime is unavailable. Remote metadata can still synchronize through supported provider adapters." };
    }
    inspectionCache = { expiresAt: Date.now() + 30_000, value };
    return value;
  }

  async function status(repositoryId: string, repositoryPathOverride?: string | null): Promise<MirrorStatus> {
    const runtime = await inspect();
    if (!runtime.available) return { runtime, mirrorState: "unavailable" };
    try {
      await fs.access(path.join(repositoryPath(repositoryId, repositoryPathOverride), "HEAD"));
      return { runtime, mirrorState: "ready" };
    } catch {
      return { runtime, mirrorState: "missing" };
    }
  }

  async function initializeManagedRepository(inputData: { repositoryId: string; repositoryPath?: string | null; defaultBranch?: string; projectName?: string; lfs?: boolean; ignoreTemplate?: "generic" | "unreal" | "software" }) {
    const runtime = await inspect();
    if (!runtime.available) throw new Error(runtime.message);
    if (inputData.lfs && !runtime.lfsAvailable) throw new Error("Git LFS is required for this project type but is not available in the configured Git runtime.");
    const defaultBranch = safeBranchName(inputData.defaultBranch || "main");
    const target = repositoryPath(inputData.repositoryId, inputData.repositoryPath);
    const seed = path.join(workspacesRoot, "provisioning", safeStorageSegment(inputData.repositoryId, "repository-seed"));
    await fs.mkdir(path.dirname(seed), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rm(target, { recursive: true, force: true });
    await fs.rm(seed, { recursive: true, force: true });
    try {
      await run(["init", "--bare", "--initial-branch", defaultBranch, target], { timeoutMs: 60_000 });
      if (inputData.lfs) await fs.mkdir(path.join(target, "lfs"), { recursive: true });
      await run(["init", "--initial-branch", defaultBranch, seed], { timeoutMs: 60_000 });
      const name = String(inputData.projectName || "Cluster Project").replace(/[\r\n\u0000]/g, " ").trim().slice(0, 160) || "Cluster Project";
      const ignore = inputData.ignoreTemplate === "unreal"
        ? ["Binaries/", "DerivedDataCache/", "Intermediate/", "Saved/", ".vs/", "*.sln", "Plugins/*/Intermediate/", "Plugins/*/Binaries/"].join("\n")
        : inputData.ignoreTemplate === "software"
          ? ["node_modules/", "dist/", "build/", ".cache/", ".env", ".env.*", "*.log"].join("\n")
          : [".DS_Store", "Thumbs.db", "*.log", ".env", ".env.*"].join("\n");
      await fs.writeFile(path.join(seed, "README.md"), `# ${name}\n\nManaged by Cluster Source Control.\n`);
      await fs.writeFile(path.join(seed, ".gitignore"), `${ignore}\n`);
      if (inputData.lfs) {
        await fs.writeFile(path.join(seed, ".gitattributes"), [
          "*.uasset filter=lfs diff=lfs merge=lfs -text",
          "*.umap filter=lfs diff=lfs merge=lfs -text",
          "*.ubulk filter=lfs diff=lfs merge=lfs -text",
          "*.uexp filter=lfs diff=lfs merge=lfs -text",
          "*.fbx filter=lfs diff=lfs merge=lfs -text",
          "*.psd filter=lfs diff=lfs merge=lfs -text",
        ].join("\n") + "\n");
      }
      await run(["add", "-A"], { cwd: seed });
      await run(["commit", "-m", "Initialize Cluster project repository"], { cwd: seed, env: { GIT_AUTHOR_NAME: "Cluster", GIT_COMMITTER_NAME: "Cluster", GIT_AUTHOR_EMAIL: "cluster@localhost.invalid", GIT_COMMITTER_EMAIL: "cluster@localhost.invalid" } });
      const headRevision = (await run(["rev-parse", "HEAD"], { cwd: seed })).stdout.trim();
      await run(["remote", "add", "origin", target], { cwd: seed });
      await run(["push", "-u", "origin", `HEAD:refs/heads/${defaultBranch}`], { cwd: seed, timeoutMs: 300_000 });
      return { defaultBranch, headRevision, lfs: Boolean(inputData.lfs), lfsVersion: inputData.lfs ? runtime.lfsVersion : null, mirrorState: "ready" as const };
    } catch (error) {
      await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(sanitizeGitError(error));
    } finally {
      await fs.rm(seed, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  async function deleteManagedRepository(repositoryId: string, repositoryPathOverride?: string | null) { await fs.rm(repositoryPath(repositoryId, repositoryPathOverride), { recursive: true, force: true }); }

  async function syncMirror(inputData: { repositoryId: string; repositoryPath?: string | null; remoteUrl?: string | null; token?: string | null; providerId?: string | null }) {
    const runtime = await inspect();
    if (!runtime.available) return { runtime, mirrorState: "unavailable" as const, action: "skipped" as const, message: runtime.message };
    const target = repositoryPath(inputData.repositoryId, inputData.repositoryPath);
    const remoteUrl = inputData.remoteUrl ? safeRemoteUrl(inputData.remoteUrl) : null;
    await fs.mkdir(path.dirname(target), { recursive: true });
    let exists = true;
    try { await fs.access(path.join(target, "HEAD")); } catch { exists = false; }
    try {
      if (!remoteUrl) { if (!exists) throw new Error("Cluster-managed repository storage is missing."); return { runtime, mirrorState: "ready" as const, action: "local" as const, message: "Cluster-managed repository is ready." }; }
      if (!exists) {
        await run(["clone", "--mirror", "--", remoteUrl, target], { token: inputData.token, providerId: inputData.providerId, timeoutMs: 10 * 60_000 });
        return { runtime, mirrorState: "ready" as const, action: "cloned" as const, message: "Managed repository mirror created." };
      }
      await run(["--git-dir", target, "remote", "set-url", "origin", remoteUrl], { token: inputData.token, providerId: inputData.providerId, timeoutMs: 15_000 });
      await run(["--git-dir", target, "fetch", "--prune", "origin"], { token: inputData.token, providerId: inputData.providerId, timeoutMs: 10 * 60_000 });
      return { runtime, mirrorState: "ready" as const, action: "fetched" as const, message: "Managed repository mirror updated." };
    } catch (error) {
      throw new Error(sanitizeGitError(error, inputData.token));
    }
  }

  async function inspectWorkingCopy(workingCopyId: string): Promise<WorkingCopyState> {
    const runtime = await inspect();
    if (!runtime.available) return { status: "unavailable", branchName: null, headRevision: null, upstreamName: null, dirtyFiles: 0, stagedFiles: 0, conflictCount: 0, aheadCount: 0, behindCount: 0, mergeBaseRevision: null };
    const target = workingCopyPath(workingCopyId);
    try { await fs.access(path.join(target, ".git")); } catch {
      return { status: "missing", branchName: null, headRevision: null, upstreamName: null, dirtyFiles: 0, stagedFiles: 0, conflictCount: 0, aheadCount: 0, behindCount: 0, mergeBaseRevision: null };
    }
    const [porcelain, revision] = await Promise.all([
      run(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], { cwd: target, timeoutMs: 30_000 }),
      run(["rev-parse", "HEAD"], { cwd: target, timeoutMs: 15_000 }).catch(() => ({ stdout: "", stderr: "" })),
    ]);
    const parsed = parsePorcelainV2(porcelain.stdout);
    let mergeBaseRevision: string | null = null;
    if (parsed.upstreamName) {
      const mergeBase = await run(["merge-base", "HEAD", parsed.upstreamName], { cwd: target, timeoutMs: 15_000 }).catch(() => ({ stdout: "", stderr: "" }));
      mergeBaseRevision = mergeBase.stdout.trim() || null;
    }
    return {
      ...parsed,
      status: parsed.conflictCount ? "conflicted" : parsed.dirtyFiles ? "dirty" : "ready",
      headRevision: revision.stdout.trim() || null,
      mergeBaseRevision,
    };
  }

  async function configureWorkingCopyLfs(target: string, managedRepositoryPath: string | null | undefined, runtime: GitRuntimeInspection) {
    if (!runtime.lfsAvailable) throw new Error("Git LFS is required for this repository but is not available in the configured Git runtime.");
    if (managedRepositoryPath) {
      const sharedStorage = path.join(path.resolve(managedRepositoryPath), "lfs");
      await fs.mkdir(sharedStorage, { recursive: true });
      await run(["config", "--local", "lfs.storage", sharedStorage], { cwd: target, timeoutMs: 15_000 });
      await run(["config", "--local", "filter.lfs.clean", "git-lfs clean -- %f"], { cwd: target, timeoutMs: 15_000 });
      await run(["config", "--local", "filter.lfs.smudge", "git-lfs smudge -- %f"], { cwd: target, timeoutMs: 15_000 });
      await run(["config", "--local", "filter.lfs.process", "git-lfs filter-process"], { cwd: target, timeoutMs: 15_000 });
      await run(["config", "--local", "filter.lfs.required", "true"], { cwd: target, timeoutMs: 15_000 });
      return;
    }
    await run(["lfs", "install", "--local"], { cwd: target, timeoutMs: 30_000 });
  }

  async function prepareWorkingCopy(inputData: { workingCopyId: string; repositoryId: string; repositoryPath?: string | null; remoteUrl?: string | null; token?: string | null; providerId?: string | null; branchName: string; baseBranch: string; createBranch?: boolean; lfs?: boolean }) {
    const runtime = await inspect();
    if (!runtime.available) throw new Error(runtime.message);
    const branchName = safeBranchName(inputData.branchName);
    const baseBranch = safeBranchName(inputData.baseBranch);
    await run(["check-ref-format", "--branch", branchName], { timeoutMs: 10_000 });
    await run(["check-ref-format", "--branch", baseBranch], { timeoutMs: 10_000 });
    const mirror = repositoryPath(inputData.repositoryId, inputData.repositoryPath);
    try { await fs.access(path.join(mirror, "HEAD")); } catch { throw new Error("Managed repository mirror is not ready. Synchronize the repository first."); }
    const remoteUrl = inputData.remoteUrl ? safeRemoteUrl(inputData.remoteUrl) : mirror;
    const target = workingCopyPath(inputData.workingCopyId);
    await fs.mkdir(workspacesRoot, { recursive: true });
    let exists = true;
    try { await fs.access(path.join(target, ".git")); } catch { exists = false; }
    if (!exists) await run(["clone", "--no-hardlinks", "--", mirror, target], { timeoutMs: 10 * 60_000, env: inputData.lfs ? { GIT_LFS_SKIP_SMUDGE: "1" } : undefined });
    if (inputData.lfs) await configureWorkingCopyLfs(target, inputData.repositoryPath, runtime);
    await run(["remote", "set-url", "origin", remoteUrl], { cwd: target, timeoutMs: 15_000 });
    await run(["fetch", "--prune", "origin"], { cwd: target, token: inputData.token, providerId: inputData.providerId, timeoutMs: 10 * 60_000 });
    const localExists = await succeeds(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], { cwd: target, timeoutMs: 10_000 });
    const remoteExists = await succeeds(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branchName}`], { cwd: target, timeoutMs: 10_000 });
    if (inputData.createBranch && (localExists || remoteExists)) throw new Error(`Branch ${branchName} already exists.`);
    if (inputData.createBranch) {
      const remoteBaseExists = await succeeds(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${baseBranch}`], { cwd: target, timeoutMs: 10_000 });
      const localBaseExists = await succeeds(["show-ref", "--verify", "--quiet", `refs/heads/${baseBranch}`], { cwd: target, timeoutMs: 10_000 });
      const baseRef = remoteBaseExists ? `origin/${baseBranch}` : localBaseExists ? baseBranch : null;
      if (!baseRef) throw new Error(`Base branch ${baseBranch} is not available in the managed repository.`);
      await run(["checkout", "-b", branchName, baseRef], { cwd: target, timeoutMs: 60_000 });
    } else if (localExists) {
      await run(["checkout", branchName], { cwd: target, timeoutMs: 60_000 });
    } else if (remoteExists) {
      await run(["checkout", "-b", branchName, "--track", `origin/${branchName}`], { cwd: target, timeoutMs: 60_000 });
    } else {
      throw new Error(`Branch ${branchName} was not found. Create it from an existing base branch first.`);
    }
    if (!inputData.createBranch && remoteExists) await run(["branch", "--set-upstream-to", `origin/${branchName}`, branchName], { cwd: target, timeoutMs: 15_000 }).catch(() => undefined);
    if (inputData.lfs) {
      if (inputData.repositoryPath) await run(["lfs", "checkout"], { cwd: target, timeoutMs: 10 * 60_000 });
      else await run(["lfs", "pull", "origin", branchName], { cwd: target, token: inputData.token, providerId: inputData.providerId, timeoutMs: 20 * 60_000 });
    }
    return inspectWorkingCopy(inputData.workingCopyId);
  }

  async function commitWorkingCopy(inputData: { workingCopyId: string; message: string; authorName: string; authorEmail?: string | null }) {
    const target = workingCopyPath(inputData.workingCopyId);
    const before = await inspectWorkingCopy(inputData.workingCopyId);
    if (before.status === "missing" || before.status === "unavailable") throw new Error("Working copy is not available.");
    if (before.conflictCount) throw new Error("Resolve working-copy conflicts before committing.");
    if (!before.dirtyFiles) throw new Error("Working copy has no changes to commit.");
    const message = String(inputData.message || "").replace(/\u0000/g, "").trim().slice(0, 8_000);
    if (!message) throw new Error("Commit message is required.");
    const authorName = String(inputData.authorName || "Cluster User").replace(/[\r\n\u0000]/g, " ").trim().slice(0, 200) || "Cluster User";
    const authorEmail = String(inputData.authorEmail || "cluster@localhost.invalid").replace(/[\r\n\u0000]/g, "").trim().slice(0, 320) || "cluster@localhost.invalid";
    await run(["add", "-A", "--", "."], { cwd: target, timeoutMs: 5 * 60_000 });
    const staged = await run(["diff", "--cached", "--name-status", "--"], { cwd: target, timeoutMs: 60_000 });
    if (!staged.stdout.trim()) throw new Error("Working copy has no staged changes to commit.");
    const committedPaths = staged.stdout.split(/\r?\n/).filter(Boolean).slice(0, 5_000).map((line) => {
      const parts = line.split("\t");
      const code = String(parts[0] || "M");
      if (code.startsWith("R") || code.startsWith("C")) return { status: code[0], previousPath: parts[1] || null, path: parts[2] || parts[1] || "" };
      return { status: code[0], previousPath: null, path: parts[1] || "" };
    }).filter((item) => item.path);
    await run(["commit", "-m", message], { cwd: target, timeoutMs: 5 * 60_000, env: { GIT_AUTHOR_NAME: authorName, GIT_COMMITTER_NAME: authorName, GIT_AUTHOR_EMAIL: authorEmail, GIT_COMMITTER_EMAIL: authorEmail } });
    return { state: await inspectWorkingCopy(inputData.workingCopyId), committedPaths };
  }

  async function pushWorkingCopy(inputData: { workingCopyId: string; branchName: string; token?: string | null; providerId?: string | null }) {
    const branchName = safeBranchName(inputData.branchName);
    const target = workingCopyPath(inputData.workingCopyId);
    const before = await inspectWorkingCopy(inputData.workingCopyId);
    if (before.status === "missing" || before.status === "unavailable") throw new Error("Working copy is not available.");
    if (before.branchName !== branchName) throw new Error("Working-copy branch changed unexpectedly. Refresh the working copy before pushing.");
    if (before.conflictCount) throw new Error("Resolve working-copy conflicts before pushing.");
    await run(["fetch", "--prune", "origin"], { cwd: target, token: inputData.token, providerId: inputData.providerId, timeoutMs: 10 * 60_000 });
    const remoteExists = await succeeds(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branchName}`], { cwd: target, timeoutMs: 10_000 });
    if (remoteExists) {
      const counts = await run(["rev-list", "--left-right", "--count", `HEAD...origin/${branchName}`], { cwd: target, timeoutMs: 30_000 });
      const [aheadText, behindText] = counts.stdout.trim().split(/\s+/);
      const behind = Number(behindText) || 0;
      if (behind > 0) throw new Error(`Remote branch is ${behind} commit${behind === 1 ? "" : "s"} ahead. Synchronize or merge before pushing.`);
    }
    await run(["push", "origin", `HEAD:refs/heads/${branchName}`], { cwd: target, token: inputData.token, providerId: inputData.providerId, timeoutMs: 10 * 60_000 });
    await run(["branch", "--set-upstream-to", `origin/${branchName}`, branchName], { cwd: target, timeoutMs: 15_000 }).catch(() => undefined);
    return inspectWorkingCopy(inputData.workingCopyId);
  }

  async function evaluateMerge(inputData: { repositoryId: string; repositoryPath?: string | null; sourceBranch: string; targetBranch: string; token?: string | null; providerId?: string | null }) {
    const runtime = await inspect();
    if (!runtime.available) throw new Error(runtime.message);
    const sourceBranch = safeBranchName(inputData.sourceBranch);
    const targetBranch = safeBranchName(inputData.targetBranch);
    const mirror = repositoryPath(inputData.repositoryId, inputData.repositoryPath);
    try { await fs.access(path.join(mirror, "HEAD")); } catch { throw new Error("Managed repository mirror is not ready. Synchronize the repository first."); }
    const hasOrigin = await succeeds(["--git-dir", mirror, "remote", "get-url", "origin"], { timeoutMs: 10_000 });
    if (hasOrigin) await run(["--git-dir", mirror, "fetch", "--prune", "origin"], { token: inputData.token, providerId: inputData.providerId, timeoutMs: 10 * 60_000 });
    const sourceRef = hasOrigin ? `refs/remotes/origin/${sourceBranch}` : `refs/heads/${sourceBranch}`;
    const targetRef = hasOrigin ? `refs/remotes/origin/${targetBranch}` : `refs/heads/${targetBranch}`;
    const sourceExists = await succeeds(["--git-dir", mirror, "show-ref", "--verify", "--quiet", sourceRef], { timeoutMs: 10_000 });
    const targetExists = await succeeds(["--git-dir", mirror, "show-ref", "--verify", "--quiet", targetRef], { timeoutMs: 10_000 });
    if (!sourceExists) throw new Error(`Source branch ${sourceBranch} is not available on the remote.`);
    if (!targetExists) throw new Error(`Target branch ${targetBranch} is not available on the remote.`);
    const [sourceRevision, targetRevision, mergeBase] = await Promise.all([
      run(["--git-dir", mirror, "rev-parse", sourceRef], { timeoutMs: 15_000 }),
      run(["--git-dir", mirror, "rev-parse", targetRef], { timeoutMs: 15_000 }),
      run(["--git-dir", mirror, "merge-base", sourceRef, targetRef], { timeoutMs: 15_000 }).catch(() => ({ stdout: "", stderr: "" })),
    ]);
    const counts = await run(["--git-dir", mirror, "rev-list", "--left-right", "--count", `${targetRef}...${sourceRef}`], { timeoutMs: 30_000 });
    const [targetOnlyText, sourceOnlyText] = counts.stdout.trim().split(/\s+/);
    let conflicts = false;
    try {
      await run(["--git-dir", mirror, "merge-tree", "--write-tree", targetRef, sourceRef], { timeoutMs: 60_000 });
    } catch {
      conflicts = true;
    }
    const numstat = await run(["--git-dir", mirror, "diff", "--numstat", `${targetRef}...${sourceRef}`, "--"], { timeoutMs: 60_000 }).catch(() => ({ stdout: "", stderr: "" }));
    let filesChanged = 0;
    let additions = 0;
    let deletions = 0;
    for (const line of numstat.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [addText, deleteText] = line.split("\t");
      filesChanged += 1;
      if (/^\d+$/.test(addText || "")) additions += Number(addText);
      if (/^\d+$/.test(deleteText || "")) deletions += Number(deleteText);
    }
    return {
      sourceRevision: sourceRevision.stdout.trim(),
      targetRevision: targetRevision.stdout.trim(),
      mergeBaseRevision: mergeBase.stdout.trim() || null,
      sourceAhead: Number(sourceOnlyText) || 0,
      targetAhead: Number(targetOnlyText) || 0,
      filesChanged,
      additions,
      deletions,
      conflicts,
    };
  }

  async function mergeReview(inputData: { operationId: string; repositoryId: string; repositoryPath?: string | null; remoteUrl?: string | null; token?: string | null; providerId?: string | null; sourceBranch: string; targetBranch: string; expectedSourceRevision: string; expectedTargetRevision: string; authorName: string; authorEmail?: string | null; title: string }) {
    const runtime = await inspect();
    if (!runtime.available) throw new Error(runtime.message);
    const sourceBranch = safeBranchName(inputData.sourceBranch);
    const targetBranch = safeBranchName(inputData.targetBranch);
    const mirror = repositoryPath(inputData.repositoryId, inputData.repositoryPath);
    const remoteUrl = inputData.remoteUrl ? safeRemoteUrl(inputData.remoteUrl) : mirror;
    const reviewRoot = path.join(workspacesRoot, "review-merges");
    const target = path.join(reviewRoot, safeStorageSegment(inputData.operationId, "review-merge"));
    await fs.mkdir(reviewRoot, { recursive: true });
    await fs.rm(target, { recursive: true, force: true });
    try {
      await run(["clone", "--no-hardlinks", "--", mirror, target], { timeoutMs: 10 * 60_000, env: { GIT_LFS_SKIP_SMUDGE: "1" } });
      await run(["remote", "set-url", "origin", remoteUrl], { cwd: target, timeoutMs: 15_000 });
      await run(["fetch", "--prune", "origin"], { cwd: target, token: inputData.token, providerId: inputData.providerId, timeoutMs: 10 * 60_000 });
      const [sourceRevision, targetRevision] = await Promise.all([
        run(["rev-parse", `origin/${sourceBranch}`], { cwd: target, timeoutMs: 15_000 }),
        run(["rev-parse", `origin/${targetBranch}`], { cwd: target, timeoutMs: 15_000 }),
      ]);
      if (sourceRevision.stdout.trim() !== inputData.expectedSourceRevision) throw new Error("Source branch changed after review eligibility was checked. Refresh the review before merging.");
      if (targetRevision.stdout.trim() !== inputData.expectedTargetRevision) throw new Error("Target branch changed after review eligibility was checked. Refresh the review before merging.");
      await run(["checkout", "-B", targetBranch, `origin/${targetBranch}`], { cwd: target, timeoutMs: 60_000 });
      const authorName = String(inputData.authorName || "Cluster User").replace(/[\r\n\u0000]/g, " ").trim().slice(0, 200) || "Cluster User";
      const authorEmail = String(inputData.authorEmail || "cluster@localhost.invalid").replace(/[\r\n\u0000]/g, "").trim().slice(0, 320) || "cluster@localhost.invalid";
      const title = String(inputData.title || `Merge ${sourceBranch} into ${targetBranch}`).replace(/\u0000/g, "").trim().slice(0, 500);
      await run(["merge", "--no-ff", "--no-edit", `origin/${sourceBranch}`], { cwd: target, timeoutMs: 5 * 60_000, env: { GIT_AUTHOR_NAME: authorName, GIT_COMMITTER_NAME: authorName, GIT_AUTHOR_EMAIL: authorEmail, GIT_COMMITTER_EMAIL: authorEmail, GIT_MERGE_AUTOEDIT: "no" } });
      const mergedRevision = (await run(["rev-parse", "HEAD"], { cwd: target, timeoutMs: 15_000 })).stdout.trim();
      if (!mergedRevision) throw new Error("Merge completed without a readable revision.");
      await run(["push", "origin", `HEAD:refs/heads/${targetBranch}`], { cwd: target, token: inputData.token, providerId: inputData.providerId, timeoutMs: 10 * 60_000 });
      return { mergedRevision, sourceBranch, targetBranch, title };
    } finally {
      await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return { inspect, status, initializeManagedRepository, deleteManagedRepository, syncMirror, inspectWorkingCopy, prepareWorkingCopy, commitWorkingCopy, pushWorkingCopy, evaluateMerge, mergeReview };
}
