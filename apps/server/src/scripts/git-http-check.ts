/* Git over HTTPS against real git and git-lfs clients: clone with a token,
   push LFS content to a branch, protected-branch and read-only rejections,
   force-push refusal, and LFS file locking between two people.
   Run: npm run -w apps/server git-http:check */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Fastify from "fastify";
import { createGitRepositoryRuntime } from "../domains/source-control/git-repository-runtime.js";
import { gitTokenHash, registerGitHttpRoutes, GIT_TOKEN_TYPE } from "../domains/source-control/git-http-routes.js";

const exec = promisify(execFile);
const ok = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL", msg); process.exitCode = 1; } else console.log("PASS", msg); };

const root = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-githttp-"));
const rt = createGitRepositoryRuntime({ repositoriesRoot: path.join(root, "repos"), workspacesRoot: path.join(root, "ws") });
await rt.initializeManagedRepository({ repositoryId: "r1", defaultBranch: "main", projectName: "Game", lfs: true, ignoreTemplate: "unreal" });

const tokens = { artist: `clu_${"a".repeat(43)}`, viewer: `clu_${"v".repeat(43)}`, lead: `clu_${"l".repeat(43)}` };
const users: Record<string, any> = {
  artist: { id: "artist", username: "artist", displayName: "Ava Artist", accountState: "ACTIVE" },
  viewer: { id: "viewer", username: "viewer", displayName: "Vic Viewer", accountState: "ACTIVE" },
  lead: { id: "lead", username: "lead", displayName: "Lee Lead", accountState: "ACTIVE" },
};
const levels: Record<string, string> = { artist: "contribute", viewer: "view", lead: "manage" };
const project = { id: "p1", archived: false, workspaceId: "w1" };
const repository = { id: "r1", slug: "game", workspaceId: "w1", hostingMode: "cluster", archived: false, defaultBranch: "main", projects: [{ project, branchPolicy: { protectedPatterns: "[\"release/*\"]", allowDirectPush: true, allowForcePush: false } }] };
const pushed: string[] = [];
const order = ["none", "view", "contribute", "manage"];

const prisma: any = {
  serviceCredential: {
    findUnique: async ({ where }: any) => { const name = Object.keys(tokens).find((key) => gitTokenHash((tokens as any)[key]) === where.tokenHash); return name ? { id: `t-${name}`, credentialType: GIT_TOKEN_TYPE, createdById: name, revokedAt: null, expiresAt: null, lastUsedAt: new Date() } : null; },
    update: async () => ({}),
  },
  user: { findUnique: async ({ where }: any) => users[where.id] || null },
  sourceRepository: { findFirst: async ({ where }: any) => where.OR.some((c: any) => c.id === "r1" || c.slug === "game") ? repository : null },
  workspaceMember: { findFirst: async ({ where }: any) => ({ userId: where.userId, role: "member" }) },
  projectMembership: { findMany: async () => [] },
  studioTeamMember: { findMany: async () => [] },
  accessRule: { findMany: async () => [] },
};
const authorization: any = {
  isUserAccessExpired: () => false,
  hasProjectResourceAccess: (user: any, _role: unknown, _project: unknown, _rules: unknown, min: string) => order.indexOf(levels[user.id]) >= order.indexOf(min),
};

const app = Fastify();
app.setErrorHandler((error, request, reply) => { const message = error instanceof Error ? error.message : String(error); console.error("SERVER", request.method, request.url, message); void reply.code(500).send(message); });
registerGitHttpRoutes({
  app, prisma, authorization, getCurrentUser: async () => null, readSettings: async () => ({}),
  repositoryRoot: async () => rt.repositoryPath("r1"),
  onPushed: async (repo: any, userId: string) => { pushed.push(`${repo.id}:${userId}`); },
});
await app.listen({ port: 0, host: "127.0.0.1" });
const port = (app.server.address() as any).port;
const url = (who: keyof typeof tokens) => `http://${who}:${tokens[who]}@127.0.0.1:${port}/git/game.git`;
const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Ava", GIT_AUTHOR_EMAIL: "ava@example.invalid", GIT_COMMITTER_NAME: "Ava", GIT_COMMITTER_EMAIL: "ava@example.invalid" };
const git = (cwd: string, ...args: string[]) => exec("git", args, { cwd, env, maxBuffer: 64 * 1024 * 1024 });
const fails = async (promise: Promise<unknown>) => { try { await promise; return ""; } catch (error: any) { return String(error.stderr || error.message); } };

try {
  ok(/401|Authentication failed|could not read/i.test(await fails(git(root, "clone", `http://artist:clu_${"x".repeat(43)}@127.0.0.1:${port}/git/game.git`, "denied"))), "bad token is refused");
  await git(root, "clone", url("artist"), "artist");
  const artist = path.join(root, "artist");
  ok((await fs.readFile(path.join(artist, ".gitattributes"), "utf8")).includes("lockable"), "clone over HTTP with a token");

  await git(artist, "checkout", "-b", "feature/hero");
  await fs.mkdir(path.join(artist, "Content"), { recursive: true });
  const asset = Buffer.alloc(3 * 1024 * 1024, 7);
  await fs.writeFile(path.join(artist, "Content", "Hero Mesh.uasset"), asset);
  await git(artist, "add", "-A");
  await git(artist, "commit", "-m", "Hero mesh");
  await git(artist, "push", "-u", "origin", "feature/hero");
  const bare = rt.repositoryPath("r1");
  const { stdout: pointer } = await exec("git", ["--git-dir", bare, "show", "feature/hero:Content/Hero Mesh.uasset"]);
  const oid = /oid sha256:([0-9a-f]{64})/.exec(pointer)?.[1] || "";
  const stored = await fs.stat(path.join(bare, "lfs", "objects", oid.slice(0, 2), oid.slice(2, 4), oid)).catch(() => null);
  ok(oid && stored?.size === asset.length, "push branch with an LFS asset; object stored on the server");
  ok(pushed.includes("r1:artist"), "push queues a repository sync");

  await git(root, "clone", url("viewer"), "viewer");
  const viewer = path.join(root, "viewer");
  await git(viewer, "checkout", "feature/hero");
  await git(viewer, "lfs", "pull");
  const fetched = await fs.readFile(path.join(viewer, "Content", "Hero Mesh.uasset"));
  ok(fetched.length === asset.length && fetched[0] === 7, "another clone downloads the LFS content");
  await fs.writeFile(path.join(viewer, "notes.txt"), "x");
  await git(viewer, "add", "-A");
  await git(viewer, "commit", "-m", "Viewer change");
  const viewerPush = await fails(git(viewer, "push", "origin", "HEAD:feature/viewer"));
  ok(/403|not push|denied/i.test(viewerPush), `read-only access cannot push (${viewerPush.split("\n").find((l) => /error|fatal/.test(l)) || ""})`);

  await git(artist, "checkout", "main");
  await fs.writeFile(path.join(artist, "direct.txt"), "x");
  await git(artist, "add", "-A");
  await git(artist, "commit", "-m", "Direct to main");
  const mainPush = await fails(git(artist, "push", "origin", "main"));
  ok(mainPush.includes("protected branch"), "protected default branch rejected with a reason");
  const releasePush = await fails(git(artist, "push", "origin", "HEAD:release/1.0"));
  ok(releasePush.includes("protected branch"), "policy-protected pattern rejected");
  await git(root, "clone", url("lead"), "lead");
  const lead = path.join(root, "lead");
  await fs.writeFile(path.join(lead, "lead.txt"), "x");
  await git(lead, "add", "-A");
  await git(lead, "commit", "-m", "Lead to main");
  ok((await fails(git(lead, "push", "origin", "main"))).includes("protected branch"), "protection applies to managers too");

  await git(artist, "checkout", "feature/hero");
  await git(artist, "reset", "--hard", "HEAD~1");
  await fs.writeFile(path.join(artist, "other.txt"), "rewrite");
  await git(artist, "add", "-A");
  await git(artist, "commit", "-m", "Rewrite");
  const force = await fails(git(artist, "push", "--force", "origin", "feature/hero"));
  ok(/non-fast-forward|rejected/i.test(force), "force push refused without policy");

  // LFS locks: artist locks, viewer can't take it, lead can break it.
  await git(artist, "lfs", "lock", "Content/Hero Mesh.uasset");
  const { stdout: listed } = await git(viewer, "lfs", "locks");
  ok(listed.includes("Content/Hero Mesh.uasset") && listed.includes("Ava Artist"), "lock visible to others with owner");
  await git(lead, "checkout", "-f", "feature/hero");
  const steal = await fails(git(lead, "lfs", "lock", "Content/Hero Mesh.uasset"));
  ok(/already|locked/i.test(steal), "second lock on the same file refused");
  const { stdout: lockJson } = await git(lead, "lfs", "locks", "--json");
  const lockId = JSON.parse(lockJson)[0]?.id;
  const artistOnly = await fails(git(viewer, "lfs", "unlock", "--id", lockId));
  ok(/403|Locked by|permission|denied|not push/i.test(artistOnly), `someone else cannot release the lock (${artistOnly.trim()})`);
  const leadUnlock = await fails(git(lead, "lfs", "unlock", "--force", "--id", lockId));
  ok(!leadUnlock, `manager can break a lock ${leadUnlock}`);
  const { stdout: after } = await git(viewer, "lfs", "locks");
  ok(!after.includes("Hero Mesh"), "lock released");
} finally {
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
}
