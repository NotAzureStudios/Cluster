import net from "node:net";
import { z } from "zod";
import { domainDeploymentBundle, domainDeploymentReadiness } from "./domain-deployment-readiness.js";
import { publicHttpsReadiness } from "./domain-public-readiness.js";
import { buildDomainConnectionPlan, validateConnectionConfiguration, type ConnectionConfiguration } from "./domain-connection-plans.js";

const idParams = z.object({ id: z.string().uuid() }).strict();
const connectionInput = z.object({
  expectedRevision: z.number().int().positive(),
  mode: z.enum(["lan", "private_vpn", "reverse_proxy", "direct_https", "managed_tunnel"]),
  provider: z.enum(["manual", "tailscale", "wireguard", "caddy", "nginx", "cloudflare", "custom"]),
  webPort: z.number().int().min(1).max(65535),
  apiPort: z.number().int().min(1).max(65535),
  publicPort: z.number().int().min(1).max(65535),
}).strict();

export function domainConnectionSettings(entry: any): ConnectionConfiguration | null {
  if (!entry?.connectionMode || !entry.connectionProvider) return null;
  try { return validateConnectionConfiguration({ mode: entry.connectionMode, provider: entry.connectionProvider, webPort: entry.connectionWebPort, apiPort: entry.connectionApiPort, publicPort: entry.connectionPublicPort }); }
  catch { return null; }
}

/** Only probes loopback ports chosen from the saved profile. No arbitrary URL
 * fetch is exposed through this endpoint; public DNS/TLS must be tested by an
 * actual client and the external gateway, not inferred from local sockets. */
export async function checkLoopbackService(port: number, createConnection: typeof net.createConnection = net.createConnection): Promise<"listening" | "unreachable"> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "unreachable";
  return new Promise(resolve => {
    let finished = false;
    const done = (status: "listening" | "unreachable") => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(status);
    };
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(900);
    socket.once("connect", () => done("listening"));
    socket.once("error", () => done("unreachable"));
    socket.once("timeout", () => done("unreachable"));
  });
}

export function registerDomainConnectionRoutes({ app, prisma, authorization, getCurrentUser, auditService, readSettings, localProbe = checkLoopbackService, publicProbe = publicHttpsReadiness }: any) {
  const deny = (reply: any, code: string, status = 409) => reply.code(status).send({ ok: false, code });
  const admin = (request: any, reply: any) => authorization.requireAdmin(request, reply);
  async function lookup(id: string) { return prisma.studioManagedDomain.findUnique({ where: { id } }); }
  async function matchingLocalBinding(domain: any) {
    const settings = await readSettings(true);
    const currentId = String(settings?.serverInstanceId || "").toLowerCase();
    return Boolean(domain?.bindingHostname && domain?.verificationState === "verified" && currentId && currentId === domain?.bindingServerInstanceId);
  }
  const project = (domain: any) => {
    const profile = domainConnectionSettings(domain);
    return profile && domain.bindingHostname ? buildDomainConnectionPlan(domain.bindingHostname, profile) : null;
  };
  const fetchEntry = async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return null;
    reply.header("Cache-Control", "private, no-store");
    const params = idParams.safeParse(request.params);
    if (!params.success) { deny(reply, "INVALID_DOMAIN_ID", 400); return null; }
    const entry = await lookup(params.data.id);
    if (!entry) { deny(reply, "DOMAIN_NOT_FOUND", 404); return null; }
    return entry;
  };
  app.get("/api/admin/domains/setup-intent", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    reply.header("Cache-Control", "private, no-store");
    const settings = await readSettings(true);
    const intent = settings?.domainSetupIntent;
    // A suggestion is never considered a verified or deployed connection.
    return { ok: true, intent: intent && typeof intent.domain === "string" ? {
      domain: intent.domain, mode: intent.mode, provider: intent.provider,
    } : null, verified: false, deployed: false };
  });
  app.get("/api/admin/domains/:id/deployment/readiness", async (request: any, reply: any) => {
    const entry = await fetchEntry(request, reply);
    if (!entry) return;
    if (!(await matchingLocalBinding(entry))) return deny(reply, "LOCAL_SERVER_BINDING_REQUIRED");
    const profile = domainConnectionSettings(entry);
    if (!profile) return deny(reply, "CONNECTION_PROFILE_NOT_CONFIGURED");
    const settings = await readSettings(true);
    return { ok: true, revision: entry.revision, ...domainDeploymentReadiness(entry.bindingHostname, profile, settings) };
  });
  app.get("/api/admin/domains/:id/deployment/bundle", async (request: any, reply: any) => {
    const entry = await fetchEntry(request, reply);
    if (!entry) return;
    if (!(await matchingLocalBinding(entry))) return deny(reply, "LOCAL_SERVER_BINDING_REQUIRED");
    const profile = domainConnectionSettings(entry);
    if (!profile) return deny(reply, "CONNECTION_PROFILE_NOT_CONFIGURED");
    return { ok: true, bundle: domainDeploymentBundle({ domainId: entry.id, revision: entry.revision,
      hostname: entry.bindingHostname, profile, instanceId: entry.bindingServerInstanceId }) };
  });
  app.get("/api/admin/domains/:id/connection", async (request: any, reply: any) => {
    const entry = await fetchEntry(request, reply);
    if (!entry) return;
    return { ok: true, revision: entry.revision, boundToThisServer: await matchingLocalBinding(entry), profile: domainConnectionSettings(entry), plan: project(entry) };
  });
  app.put("/api/admin/domains/:id/connection", async (request: any, reply: any) => {
    const entry = await fetchEntry(request, reply);
    if (!entry) return;
    const body = connectionInput.safeParse(request.body);
    if (!body.success) return deny(reply, "INVALID_CONNECTION_PROFILE", 400);
    let profile: ConnectionConfiguration;
    try { profile = validateConnectionConfiguration(body.data); }
    catch { return deny(reply, "INCOMPATIBLE_CONNECTION_PROVIDER", 400); }
    if (!(await matchingLocalBinding(entry))) return deny(reply, "LOCAL_SERVER_BINDING_REQUIRED");
    if (entry.revision !== body.data.expectedRevision) return deny(reply, "STALE_DOMAIN_REVISION");
    if (!auditService?.recordSecurityInTransaction) return deny(reply, "SECURITY_AUDIT_UNAVAILABLE", 503);
    const actor = await getCurrentUser(request);
    if (!actor?.id) return deny(reply, "ADMIN_IDENTITY_UNAVAILABLE", 403);
    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const settings = await readSettings(true);
        const serverId = String(settings?.serverInstanceId || "").toLowerCase();
        const result = await tx.studioManagedDomain.updateMany({
          where: { id: entry.id, revision: body.data.expectedRevision, bindingServerInstanceId: serverId, verificationState: "verified" },
          data: { connectionMode: profile.mode, connectionProvider: profile.provider, connectionWebPort: profile.webPort, connectionApiPort: profile.apiPort, connectionPublicPort: profile.publicPort, revision: { increment: 1 } },
        });
        if (result.count !== 1) throw new Error("STALE_CONNECTION_PROFILE");
        const audit = await auditService.recordSecurityInTransaction(tx, { event: "domain.connection_configured", actorUserId: actor.id, targetUserId: null, result: "SUCCESS", reasonCode: "ADMIN_DOMAIN_MANAGEMENT", requestId: request.id || null, requestMethod: request.method, requestPath: request.url?.split("?")[0] || "", metadata: { domainId: entry.id, mode: profile.mode, provider: profile.provider } });
        if (audit?.ok !== true) throw new Error("AUDIT_FAILURE");
        return tx.studioManagedDomain.findUnique({ where: { id: entry.id } });
      });
      return { ok: true, revision: updated.revision, profile, plan: project(updated) };
    } catch { return deny(reply, "CONNECTION_CONFIG_CONFLICT_OR_AUDIT_FAILURE"); }
  });
  // Explicit, user-triggered check. The probe pins a PUBLIC DNS A address,
  // validates TLS hostname and cert, sends no session credentials and never
  // follows redirects. LAN/VPN destinations are intentionally not probed.
  app.get("/api/admin/domains/:id/connection/check-public", async (request: any, reply: any) => {
    const entry = await fetchEntry(request, reply);
    if (!entry) return;
    if (!(await matchingLocalBinding(entry))) return deny(reply, "LOCAL_SERVER_BINDING_REQUIRED");
    const profile = domainConnectionSettings(entry);
    if (!profile) return deny(reply, "CONNECTION_PROFILE_NOT_CONFIGURED");
    if (profile.mode === "lan" || profile.mode === "private_vpn") return deny(reply, "PRIVATE_NETWORK_REQUIRES_CLIENT_SIDE_CHECK", 400);
    const result = await publicProbe(entry.bindingHostname);
    return { ok: true, checkedAt: new Date().toISOString(), ...result,
      note: "Probe runs from the Cluster server, not from an outside client. Remote login, SSE, upload limits, and Desktop must still be tested separately." };
  });
  app.get("/api/admin/domains/:id/connection/check", async (request: any, reply: any) => {
    const entry = await fetchEntry(request, reply);
    if (!entry) return;
    if (!(await matchingLocalBinding(entry))) return deny(reply, "LOCAL_SERVER_BINDING_REQUIRED");
    const profile = domainConnectionSettings(entry);
    if (!profile) return deny(reply, "CONNECTION_PROFILE_NOT_CONFIGURED");
    const [web, api] = await Promise.all([localProbe(profile.webPort), localProbe(profile.apiPort)]);
    return { ok: true, checkedAt: new Date().toISOString(), local: { web, api }, publicDns: "not_checked", publicHttps: "not_checked", outsideReachability: "not_checked", desktopLogin: "not_checked", note: "Loopback listener evidence only; run external verification from a remote client." };
  });
}
