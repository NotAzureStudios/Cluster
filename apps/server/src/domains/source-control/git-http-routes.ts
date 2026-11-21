/* Git over HTTPS for Cluster-hosted repositories, with Git LFS and LFS file
   locking, so artists' machines, the Unreal plugin and the workstation agent
   clone, pull and push them like any other remote:

     https://<cluster>/git/<repository>.git

   Authentication is HTTP Basic with a personal Git token (Account → Git
   access). Access follows the projects the repository is linked to: view to
   clone and download, contribute to push, upload and lock, manage to break
   someone else's lock. Protected branches only change through reviews (for
   everyone, owners included), and
   history is never rewritten unless the project's policy allows force push.

   Git itself is `git http-backend`; LFS objects live in the bare repository's
   lfs/objects directory, the layout server-side working copies already use. */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthorizationService } from "../access/authorization.js";
import { projectLevelForUser } from "../access/project-access-people.js";

export const GIT_TOKEN_TYPE = "git_token";
const LEVEL_ORDER: Record<string, number> = { none: 0, view: 1, contribute: 2, manage: 3 };
const LFS_JSON = "application/vnd.git-lfs+json";
const OID = /^[0-9a-f]{64}$/;

type Level = "none" | "view" | "contribute" | "manage";
type Actor = { user: any; role: string | null; tokenId: string };
type Target = { repository: any; root: string; level: Level; policies: any[]; defaultBranch: string };

export function gitTokenHash(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function slugifyRepositoryName(name: string) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "repository";
}

function wildcard(value: string, pattern: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function parseArray(value: unknown): string[] {
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}

function pkt(text: string) {
  return (Buffer.byteLength(text) + 4).toString(16).padStart(4, "0") + text;
}

async function readJson(stream: unknown, limit = 1024 * 1024) {
  if (!stream || typeof (stream as Readable).on !== "function") return stream && typeof stream === "object" ? stream : {};
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as Readable) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large."), { statusCode: 413 });
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

/* Reads the ref-update commands at the head of a receive-pack request (up to
   the flush packet) and returns them with the bytes consumed, so the request
   can be checked before Git sees it and then replayed unchanged. */
async function readReceiveCommands(source: Readable) {
  const buffered: Buffer[] = [];
  let data = Buffer.alloc(0);
  const commands: Array<{ oldRevision: string; newRevision: string; ref: string }> = [];
  let capabilities = "";
  const iterator = source[Symbol.asyncIterator]();
  let offset = 0;
  for (;;) {
    while (data.length - offset < 4) {
      const next = await iterator.next();
      if (next.done) return { commands, capabilities, head: Buffer.concat(buffered), iterator, complete: false };
      buffered.push(next.value);
      data = Buffer.concat([data, next.value]);
    }
    const length = parseInt(data.subarray(offset, offset + 4).toString("ascii"), 16);
    if (!Number.isFinite(length)) throw new Error("Malformed push request.");
    if (length === 0) return { commands, capabilities, head: Buffer.concat(buffered), iterator, complete: true };
    while (data.length - offset < length) {
      const next = await iterator.next();
      if (next.done) throw new Error("Truncated push request.");
      buffered.push(next.value);
      data = Buffer.concat([data, next.value]);
    }
    const line = data.subarray(offset + 4, offset + length).toString("utf8").replace(/\n$/, "");
    offset += length;
    const [command, caps] = line.split("\u0000");
    if (caps !== undefined && !capabilities) capabilities = caps;
    const [oldRevision, newRevision, ref] = command.split(" ");
    if (oldRevision && newRevision && ref && !command.startsWith("shallow")) commands.push({ oldRevision, newRevision, ref });
  }
}

async function* replay(head: Buffer, iterator: AsyncIterator<Buffer>) {
  if (head.length) yield head;
  for (;;) {
    const next = await iterator.next();
    if (next.done) return;
    yield next.value;
  }
}

export function registerGitHttpRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  authorization: AuthorizationService;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  repositoryRoot: (repository: any) => Promise<string>;
  onPushed: (repository: any, userId: string) => Promise<unknown>;
  readSettings: () => Promise<Record<string, any>>;
  executable?: string;
}) {
  const executable = String(deps.executable || process.env.CLUSTER_GIT_EXECUTABLE || "git").trim() || "git";
  const lockMutex = new Map<string, Promise<unknown>>();

  function challenge(reply: FastifyReply, message = "Sign in with your Cluster username and a Git token.") {
    return reply.code(401).header("WWW-Authenticate", 'Basic realm="Cluster Git", charset="UTF-8"').type("text/plain; charset=utf-8").send(`${message}\n`);
  }

  function lfsError(reply: FastifyReply, status: number, message: string) {
    if (status === 401) reply.header("LFS-Authenticate", 'Basic realm="Cluster Git"').header("WWW-Authenticate", 'Basic realm="Cluster Git"');
    return reply.code(status).type(LFS_JSON).send({ message });
  }

  async function authenticate(request: FastifyRequest): Promise<Actor | null> {
    const header = String(request.headers.authorization || "");
    const match = /^Basic\s+(.+)$/i.exec(header);
    if (!match) return null;
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const split = decoded.indexOf(":");
    const username = split >= 0 ? decoded.slice(0, split) : decoded;
    const secret = split >= 0 ? decoded.slice(split + 1) : "";
    const token = /^clu_/.test(secret) ? secret : /^clu_/.test(username) ? username : "";
    if (!/^clu_[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
    const row = await deps.prisma.serviceCredential.findUnique({ where: { tokenHash: gitTokenHash(token) } }).catch(() => null);
    if (!row || row.credentialType !== GIT_TOKEN_TYPE || row.revokedAt || !row.createdById) return null;
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return null;
    const user = await deps.prisma.user.findUnique({ where: { id: row.createdById } });
    if (!user || user.archived || ["DISABLED", "SUSPENDED", "PRIVACY_ERASED", "LOCKED"].includes(String(user.accountState || "").toUpperCase()) || deps.authorization.isUserAccessExpired(user)) return null;
    if (!row.lastUsedAt || Date.now() - new Date(row.lastUsedAt).getTime() > 60_000) {
      void deps.prisma.serviceCredential.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return { user, role: null, tokenId: row.id };
  }

  async function resolveTarget(actor: Actor, repoParam: string): Promise<Target | null> {
    const key = repoParam.replace(/\.git$/i, "");
    if (!key || key.includes("/") || key.includes("..")) return null;
    const repository = await deps.prisma.sourceRepository.findFirst({
      where: { archived: false, hostingMode: "cluster", OR: [{ id: key }, { slug: key }] },
      include: { projects: { where: { archived: false }, include: { project: true, branchPolicy: true } } },
    });
    if (!repository) return null;
    const member = await deps.prisma.workspaceMember.findFirst({ where: { workspaceId: repository.workspaceId, userId: actor.user.id } });
    if (!member) return null;
    actor.role = member.role || null;
    let level: Level = ["owner", "admin"].includes(String(member.role || "")) ? "manage" : "none";
    if (level !== "manage") {
      for (const binding of repository.projects || []) {
        if (!binding.project || binding.project.archived) continue;
        const projectLevel = await projectLevelForUser({ prisma: deps.prisma, authorization: deps.authorization, project: binding.project, user: actor.user, role: member.role || null }) as Level;
        if (LEVEL_ORDER[projectLevel] > LEVEL_ORDER[level]) level = projectLevel;
      }
    }
    if (level === "none") return null;
    const root = await deps.repositoryRoot(repository);
    return { repository, root, level, policies: (repository.projects || []).map((binding: any) => binding.branchPolicy).filter(Boolean), defaultBranch: repository.defaultBranch || "main" };
  }

  /* Authenticate and authorize, or answer with the right failure. Unknown
     repositories and ones the token can't see both read as "not found". */
  async function guard(request: FastifyRequest, reply: FastifyReply, minimum: Level, lfs = false): Promise<{ actor: Actor; target: Target } | null> {
    const actor = await authenticate(request);
    if (!actor) { lfs ? lfsError(reply, 401, "Credentials needed.") : challenge(reply); return null; }
    const { repo } = request.params as { repo: string };
    const target = await resolveTarget(actor, repo);
    if (!target) { lfs ? lfsError(reply, 404, "Repository not found.") : reply.code(404).type("text/plain").send("Repository not found.\n"); return null; }
    if (LEVEL_ORDER[target.level] < LEVEL_ORDER[minimum]) {
      const message = minimum === "contribute" ? "You can read this repository but not push to it." : "You don't have access to do that.";
      lfs ? lfsError(reply, 403, message) : reply.code(403).type("text/plain").send(`${message}\n`);
      return null;
    }
    return { actor, target };
  }

  function protectedBranch(target: Target, ref: string) {
    if (!ref.startsWith("refs/heads/")) return false;
    const branch = ref.slice("refs/heads/".length);
    if (branch === target.defaultBranch) return true;
    return target.policies.some((policy) => parseArray(policy.protectedPatterns).some((pattern) => wildcard(branch, pattern)));
  }

  /* Runs git http-backend for one request and streams its CGI response. */
  async function backend(request: FastifyRequest, reply: FastifyReply, actor: Actor, target: Target, suffix: string, input: AsyncIterable<Buffer> | Readable | null, options: { gzip?: boolean; contentLength?: number; config?: Record<string, string> } = {}) {
    const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?") + 1) : "";
    const config = { "http.uploadpack": "true", "http.receivepack": "true", "uploadpack.allowFilter": "true", ...(options.config || {}) };
    const configEnv: Record<string, string> = { GIT_CONFIG_COUNT: String(Object.keys(config).length) };
    Object.entries(config).forEach(([key, value], index) => { configEnv[`GIT_CONFIG_KEY_${index}`] = key; configEnv[`GIT_CONFIG_VALUE_${index}`] = value; });
    const child = spawn(executable, ["http-backend"], {
      env: {
        PATH: process.env.PATH || "", SYSTEMROOT: process.env.SYSTEMROOT || "", HOME: process.env.HOME || "",
        GIT_PROJECT_ROOT: path.dirname(target.root),
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: `/${path.basename(target.root)}${suffix}`,
        REQUEST_METHOD: request.method,
        QUERY_STRING: query,
        CONTENT_TYPE: String(request.headers["content-type"] || ""),
        ...(options.gzip ? { HTTP_CONTENT_ENCODING: "gzip" } : {}),
        // http-backend reads exactly CONTENT_LENGTH bytes when it is set,
        // otherwise to end of input (chunked or re-encoded bodies).
        ...(options.contentLength !== undefined ? { CONTENT_LENGTH: String(options.contentLength) } : {}),
        ...(request.headers["git-protocol"] ? { GIT_PROTOCOL: String(request.headers["git-protocol"]) } : {}),
        REMOTE_USER: String(actor.user.username || actor.user.id),
        REMOTE_ADDR: String(request.ip || ""),
        GIT_COMMITTER_NAME: String(actor.user.displayName || actor.user.username || "Cluster"),
        GIT_COMMITTER_EMAIL: String(actor.user.email || "cluster@localhost.invalid"),
        ...configEnv,
      },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { if (stderr.length < 8_000) stderr += chunk.toString(); });
    const exited = new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 1)));
    child.on("error", () => undefined);
    // Client went away mid-transfer: stop Git. (IncomingMessage "close"
    // fires when the body is read, so watch the response instead.)
    reply.raw.on("close", () => { if (!reply.raw.writableFinished) child.kill("SIGKILL"); });
    if (input) void pipeline(input as any, child.stdin).catch(() => child.stdin.destroy());
    else child.stdin.end();

    // CGI: headers, a blank line, then the body.
    const body = new PassThrough();
    let head = Buffer.alloc(0);
    let headersDone = false;
    const headers = await new Promise<{ status: number; headers: Record<string, string> }>((resolve, reject) => {
      child.stdout.on("data", (chunk: Buffer) => {
        if (headersDone) { body.write(chunk); return; }
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n") >= 0 ? head.indexOf("\r\n\r\n") : head.indexOf("\n\n");
        if (end < 0) return;
        const separator = head.indexOf("\r\n\r\n") === end ? 4 : 2;
        const lines = head.subarray(0, end).toString("latin1").split(/\r?\n/);
        const parsed: Record<string, string> = {};
        let status = 200;
        for (const line of lines) {
          const colon = line.indexOf(":");
          if (colon < 0) continue;
          const name = line.slice(0, colon).trim();
          const value = line.slice(colon + 1).trim();
          if (name.toLowerCase() === "status") status = Number.parseInt(value, 10) || 200;
          else parsed[name] = value;
        }
        headersDone = true;
        const rest = head.subarray(end + separator);
        if (rest.length) body.write(rest);
        resolve({ status, headers: parsed });
      });
      child.stdout.on("end", () => {
        body.end();
        if (!headersDone) void exited.then(() => reject(new Error(stderr.trim() || "git http-backend produced no response.")));
      });
    });
    reply.code(headers.status);
    for (const [name, value] of Object.entries(headers.headers)) reply.header(name, value);
    reply.header("Cache-Control", "no-cache, max-age=0, must-revalidate");
    void reply.send(body);
    return { exited, stderr: () => stderr };
  }

  const routes = async (scope: FastifyInstance) => {
    // Git and LFS bodies are streamed to Git or disk, never buffered.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_request, payload, done) => done(null, payload));

    scope.get("/git/:repo/info/refs", async (request, reply) => {
      const service = String((request.query as any)?.service || "");
      if (service !== "git-upload-pack" && service !== "git-receive-pack") return reply.code(403).type("text/plain").send("Smart HTTP only.\n");
      const access = await guard(request, reply, service === "git-receive-pack" ? "contribute" : "view");
      if (!access) return reply;
      await backend(request, reply, access.actor, access.target, "/info/refs", null);
      return reply;
    });

    scope.post("/git/:repo/git-upload-pack", async (request, reply) => {
      const access = await guard(request, reply, "view");
      if (!access) return reply;
      const gzip = /gzip/i.test(String(request.headers["content-encoding"] || ""));
      const length = Number(request.headers["content-length"]);
      await backend(request, reply, access.actor, access.target, "/git-upload-pack", request.body as Readable, { gzip, contentLength: Number.isFinite(length) && request.headers["content-length"] ? length : undefined });
      return reply;
    });

    scope.post("/git/:repo/git-receive-pack", async (request, reply) => {
      const access = await guard(request, reply, "contribute");
      if (!access) return reply;
      const { actor, target } = access;
      let source = request.body as Readable;
      if (/gzip/i.test(String(request.headers["content-encoding"] || ""))) source = (request.body as Readable).pipe(zlib.createGunzip());
      const parsed = await readReceiveCommands(source);
      const directPushAllowed = target.policies.every((policy) => policy.allowDirectPush !== false);
      const forceAllowed = target.policies.length > 0 && target.policies.every((policy) => policy.allowForcePush === true);
      const rejected = parsed.commands.map((command) => {
        if (!command.ref.startsWith("refs/heads/") && !command.ref.startsWith("refs/tags/")) return { ...command, reason: "only branches and tags can be pushed" };
        // Protection applies to everyone, owners included: protected
        // branches change only through reviews, as in the Cluster UI.
        if (protectedBranch(target, command.ref)) return { ...command, reason: "protected branch; merge it through a review in Cluster" };
        if (!directPushAllowed) return { ...command, reason: "this project doesn't allow direct pushes" };
        if (/^0+$/.test(command.newRevision) && protectedBranch(target, command.ref)) return { ...command, reason: "protected branches can't be deleted" };
        return null;
      }).filter(Boolean) as Array<{ ref: string; reason: string }>;
      if (rejected.length) {
        // Answer like receive-pack would, so Git prints a normal
        // "! [remote rejected] main -> main (reason)" line.
        for await (const _chunk of replay(Buffer.alloc(0), parsed.iterator)) { /* drain */ }
        const report = pkt("unpack ok\n") + parsed.commands.map((command) => {
          const hit = rejected.find((item) => item.ref === command.ref);
          return pkt(hit ? `ng ${command.ref} ${hit.reason}\n` : `ng ${command.ref} push rejected with other refs\n`);
        }).join("") + "0000";
        const sideband = /side-band(-64k)?/.test(parsed.capabilities);
        const payload = sideband ? Buffer.concat([Buffer.from((Buffer.byteLength(report) + 5).toString(16).padStart(4, "0") + "\u0001"), Buffer.from(report), Buffer.from("0000")]) : Buffer.from(report);
        return reply.code(200).header("Content-Type", "application/x-git-receive-pack-result").header("Cache-Control", "no-cache").send(payload);
      }
      const { exited } = await backend(request, reply, actor, target, "/git-receive-pack", replay(parsed.head, parsed.iterator), {
        config: {
          "receive.denyNonFastForwards": forceAllowed ? "false" : "true",
          "receive.denyDeletes": "false",
          "receive.fsckObjects": "false",
          "core.quotepath": "false",
        },
      });
      void exited.then((code) => {
        if (code === 0 && parsed.commands.length) return deps.onPushed(target.repository, actor.user.id);
      }).catch((error) => deps.app.log.warn({ repositoryId: target.repository.id, error: error instanceof Error ? error.message : String(error) }, "repository sync after push failed to queue"));
      return reply;
    });

    /* Git LFS batch API: points clients at the object routes below. */
    scope.post("/git/:repo/info/lfs/objects/batch", async (request, reply) => {
      const body = z.object({
        operation: z.enum(["download", "upload"]),
        transfers: z.array(z.string()).optional(),
        objects: z.array(z.object({ oid: z.string(), size: z.number().int().nonnegative() })).max(10_000),
        hash_algo: z.string().optional(),
      }).safeParse(await readJson(request.body));
      if (!body.success) return lfsError(reply, 422, "Malformed batch request.");
      const access = await guard(request, reply, body.data.operation === "upload" ? "contribute" : "view", true);
      if (!access) return reply;
      if (body.data.hash_algo && body.data.hash_algo !== "sha256") return lfsError(reply, 409, "Only sha256 is supported.");
      const base = `${await publicOrigin(request)}/git/${encodeURIComponent((request.params as any).repo)}/info/lfs/objects`;
      const auth = String(request.headers.authorization || "");
      const objects = await Promise.all(body.data.objects.map(async ({ oid, size }) => {
        if (!OID.test(oid)) return { oid, size, error: { code: 422, message: "Invalid object id." } };
        const stat = await fsp.stat(objectPath(access.target.root, oid)).catch(() => null);
        if (body.data.operation === "download") {
          if (!stat) return { oid, size, error: { code: 404, message: "Object does not exist on the server." } };
          return { oid, size: stat.size, authenticated: true, actions: { download: { href: `${base}/${oid}`, header: { Authorization: auth }, expires_in: 3600 } } };
        }
        if (stat && stat.size === size) return { oid, size, authenticated: true };
        return { oid, size, authenticated: true, actions: { upload: { href: `${base}/${oid}`, header: { Authorization: auth }, expires_in: 3600 } } };
      }));
      return reply.code(200).type(LFS_JSON).send({ transfer: "basic", objects, hash_algo: "sha256" });
    });

    scope.get("/git/:repo/info/lfs/objects/:oid", async (request, reply) => {
      const { oid } = request.params as { oid: string };
      if (!OID.test(oid)) return lfsError(reply, 422, "Invalid object id.");
      const access = await guard(request, reply, "view", true);
      if (!access) return reply;
      const file = objectPath(access.target.root, oid);
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat) return lfsError(reply, 404, "Object does not exist on the server.");
      return reply.code(200).header("Content-Type", "application/octet-stream").header("Content-Length", String(stat.size)).send(fs.createReadStream(file));
    });

    scope.put("/git/:repo/info/lfs/objects/:oid", async (request, reply) => {
      const { oid } = request.params as { oid: string };
      if (!OID.test(oid)) return lfsError(reply, 422, "Invalid object id.");
      const access = await guard(request, reply, "contribute", true);
      if (!access) return reply;
      const final = objectPath(access.target.root, oid);
      if (await fsp.stat(final).catch(() => null)) {
        for await (const _chunk of request.body as Readable) { /* already stored */ }
        return reply.code(200).send();
      }
      const temporary = path.join(access.target.root, "lfs", "tmp", `${oid}-${crypto.randomBytes(6).toString("hex")}`);
      await fsp.mkdir(path.dirname(temporary), { recursive: true });
      const hash = crypto.createHash("sha256");
      let size = 0;
      try {
        await pipeline(request.body as Readable, async function* (source) {
          for await (const chunk of source) { hash.update(chunk); size += chunk.length; yield chunk; }
        }, fs.createWriteStream(temporary, { flags: "wx" }));
        const expected = Number(request.headers["content-length"] || size);
        if (hash.digest("hex") !== oid || size !== expected) {
          await fsp.rm(temporary, { force: true });
          return lfsError(reply, 422, "Uploaded content does not match its object id.");
        }
        await fsp.mkdir(path.dirname(final), { recursive: true });
        await fsp.rename(temporary, final);
        return reply.code(200).send();
      } catch (error) {
        await fsp.rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    });

    /* Git LFS file locking. Unreal checks out .uasset/.umap through these. */
    scope.get("/git/:repo/info/lfs/locks", async (request, reply) => {
      const access = await guard(request, reply, "view", true);
      if (!access) return reply;
      const query = request.query as Record<string, string>;
      let locks = await readLocks(access.target.root);
      if (query.path) locks = locks.filter((lock) => lock.path === query.path);
      if (query.id) locks = locks.filter((lock) => lock.id === query.id);
      const { page, next } = paginate(locks, query.cursor, query.limit);
      return reply.code(200).type(LFS_JSON).send({ locks: page.map(publicLock), ...(next ? { next_cursor: next } : {}) });
    });

    scope.post("/git/:repo/info/lfs/locks/verify", async (request, reply) => {
      const body = await readJson(request.body).catch(() => ({})) as Record<string, any>;
      const access = await guard(request, reply, "contribute", true);
      if (!access) return reply;
      const locks = await readLocks(access.target.root);
      const { page, next } = paginate(locks, body.cursor, body.limit);
      return reply.code(200).type(LFS_JSON).send({
        ours: page.filter((lock) => lock.ownerId === access.actor.user.id).map(publicLock),
        theirs: page.filter((lock) => lock.ownerId !== access.actor.user.id).map(publicLock),
        ...(next ? { next_cursor: next } : {}),
      });
    });

    scope.post("/git/:repo/info/lfs/locks", async (request, reply) => {
      const body = z.object({ path: z.string().min(1).max(4096) }).safeParse(await readJson(request.body).catch(() => ({})));
      if (!body.success) return lfsError(reply, 422, "A path is required.");
      const access = await guard(request, reply, "contribute", true);
      if (!access) return reply;
      const lockPath = body.data.path.replace(/\\/g, "/").replace(/^\/+/, "");
      const result = await mutateLocks(access.target.root, (locks) => {
        const existing = locks.find((lock) => lock.path === lockPath);
        if (existing) return { locks, conflict: existing };
        const lock = { id: crypto.randomUUID(), path: lockPath, locked_at: new Date().toISOString(), ownerId: access.actor.user.id, ownerName: String(access.actor.user.displayName || access.actor.user.username || "Unknown") };
        return { locks: [...locks, lock], created: lock };
      });
      if (result.conflict) return reply.code(409).type(LFS_JSON).send({ lock: publicLock(result.conflict), message: `Already locked by ${result.conflict.ownerName}.` });
      return reply.code(201).type(LFS_JSON).send({ lock: publicLock(result.created!) });
    });

    scope.post("/git/:repo/info/lfs/locks/:id/unlock", async (request, reply) => {
      const body = await readJson(request.body).catch(() => ({})) as Record<string, any>;
      const access = await guard(request, reply, "contribute", true);
      if (!access) return reply;
      const { id } = request.params as { id: string };
      const result = await mutateLocks(access.target.root, (locks) => {
        const lock = locks.find((item) => item.id === id);
        if (!lock) return { locks, missing: true };
        if (lock.ownerId !== access.actor.user.id && !(body.force === true && access.target.level === "manage")) return { locks, forbidden: lock };
        return { locks: locks.filter((item) => item.id !== id), removed: lock };
      });
      if (result.missing) return lfsError(reply, 404, "Lock not found.");
      if (result.forbidden) return lfsError(reply, 403, body.force ? "Only project managers can break someone else's lock." : `Locked by ${result.forbidden.ownerName}. Use --force if you manage this project.`);
      return reply.code(200).type(LFS_JSON).send({ lock: publicLock(result.removed!) });
    });
  };

  deps.app.register(routes);

  /* Where clients reach Git: the public API origin when one is configured,
     otherwise the address this request arrived on. */
  async function publicOrigin(request: FastifyRequest) {
    const settings = await deps.readSettings().catch(() => ({} as Record<string, any>));
    const configured = String(settings.publicApiUrl || settings.publicWebUrl || "").trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(configured)) return configured;
    const forwardedHost = String(request.headers["x-forwarded-host"] || "").split(",")[0].trim();
    const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    return `${forwardedProto || request.protocol}://${forwardedHost || request.host}`;
  }

  /* Personal Git tokens, managed from the signed-in account. */
  deps.app.get("/api/source-control/git-access", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const tokens = await deps.prisma.serviceCredential.findMany({ where: { credentialType: GIT_TOKEN_TYPE, createdById: user.id, revokedAt: null }, orderBy: { createdAt: "desc" }, take: 50 });
    return { ok: true, baseUrl: `${await publicOrigin(request)}/git`, username: user.username || null, tokens: tokens.map(serializeToken) };
  });

  deps.app.post("/api/source-control/git-access/tokens", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const body = z.object({ name: z.string().trim().min(1).max(80), expiresInDays: z.number().int().min(1).max(3650).nullable().optional() }).parse(request.body || {});
    const count = await deps.prisma.serviceCredential.count({ where: { credentialType: GIT_TOKEN_TYPE, createdById: user.id, revokedAt: null } });
    if (count >= 20) return reply.code(409).send({ ok: false, code: "GIT_TOKEN_LIMIT", error: "Revoke an old token first (20 maximum)." });
    const token = `clu_${crypto.randomBytes(32).toString("base64url")}`;
    const row = await deps.prisma.serviceCredential.create({ data: {
      name: body.name, credentialType: GIT_TOKEN_TYPE, scopes: JSON.stringify(["git"]),
      tokenHash: gitTokenHash(token), tokenPrefix: token.slice(0, 12),
      expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
      createdById: user.id,
    } });
    return reply.code(201).send({ ok: true, token, credential: serializeToken(row) });
  });

  deps.app.delete("/api/source-control/git-access/tokens/:tokenId", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const { tokenId } = z.object({ tokenId: z.string().min(1) }).parse(request.params);
    const updated = await deps.prisma.serviceCredential.updateMany({ where: { id: tokenId, credentialType: GIT_TOKEN_TYPE, createdById: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!updated.count) return reply.code(404).send({ ok: false, code: "GIT_TOKEN_NOT_FOUND", error: "Token not found." });
    return { ok: true };
  });

  type StoredLock = { id: string; path: string; locked_at: string; ownerId: string; ownerName: string };

  function objectPath(root: string, oid: string) {
    return path.join(root, "lfs", "objects", oid.slice(0, 2), oid.slice(2, 4), oid);
  }

  function publicLock(lock: StoredLock) {
    return { id: lock.id, path: lock.path, locked_at: lock.locked_at, owner: { name: lock.ownerName } };
  }

  function paginate(locks: StoredLock[], cursor: unknown, limit: unknown) {
    const start = Math.max(0, Number.parseInt(String(cursor || "0"), 10) || 0);
    const size = Math.max(1, Math.min(1000, Number.parseInt(String(limit || "100"), 10) || 100));
    const page = locks.slice(start, start + size);
    return { page, next: start + size < locks.length ? String(start + size) : null };
  }

  async function readLocks(root: string): Promise<StoredLock[]> {
    try {
      const parsed = JSON.parse(await fsp.readFile(path.join(root, "lfs", "cluster-locks.json"), "utf8"));
      return Array.isArray(parsed?.locks) ? parsed.locks : [];
    } catch { return []; }
  }

  /* Lock changes for one repository run one at a time and are written
     atomically, so two artists can't both take the same file. */
  async function mutateLocks<T extends { locks: StoredLock[] }>(root: string, change: (locks: StoredLock[]) => T): Promise<T> {
    const previous = lockMutex.get(root) || Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      const result = change(await readLocks(root));
      const file = path.join(root, "lfs", "cluster-locks.json");
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      await fsp.writeFile(temporary, JSON.stringify({ locks: result.locks }, null, 1));
      await fsp.rename(temporary, file);
      return result;
    });
    lockMutex.set(root, run);
    try { return await run; } finally { if (lockMutex.get(root) === run) lockMutex.delete(root); }
  }
}

function serializeToken(row: any) {
  return { id: row.id, name: row.name, prefix: row.tokenPrefix || null, createdAt: row.createdAt, expiresAt: row.expiresAt || null, lastUsedAt: row.lastUsedAt || null };
}
