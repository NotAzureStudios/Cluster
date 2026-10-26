import { randomBytes, randomUUID } from "node:crypto";
import { domainToASCII, URL } from "node:url";
import { resolveTxt, resolve4, resolve6, resolveCname } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";

// A Domain Registry record is NOT a Vault secret and a binding is NOT a live
// DNS/TLS configuration. Registrar passwords/API tokens belong in Vault.
export function normalizeManagedDomain(input: string): string {
  const name = input.trim().replace(/\.$/, "").toLowerCase();
  if (!name || name.includes(":") || name.includes("/") || name.includes("*") || name.includes("@")) throw new Error("Invalid domain");
  const ascii = domainToASCII(name);
  if (!ascii || ascii.length > 253 || ascii === "localhost") throw new Error("Invalid domain");
  const labels = ascii.split(".");
  if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("Invalid domain");
  if (/^\d+$/.test(labels.at(-1)!)) throw new Error("IP literals are not domains");
  return ascii;
}

const hostname = z.string().min(3).max(253);
const dnsType = z.enum(["A", "AAAA", "CNAME"]);
const metadataInput = z.object({ expectedRevision: z.number().int().positive(), note: z.string().trim().max(500).nullable().optional(), registrar: z.string().trim().max(160).nullable().optional(), expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).strict();
const challengeInput = z.object({ expectedRevision: z.number().int().positive() }).strict();
const createInput = z.object({ domain: hostname, note: z.string().trim().max(500).optional() }).strict();
const revisionInput = z.object({ expectedRevision: z.number().int().positive() }).strict();
const bindInput = revisionInput.extend({ hostname, dnsType, dnsTarget: z.string().min(1).max(253), note: z.string().trim().max(500).optional() }).strict();
const idParams = z.object({ id: z.string().uuid() });
const publicFields = { id: true, domain: true, note: true, registrar: true, expiresOn: true, verificationState: true, verifiedAt: true, bindingHostname: true, bindingServerLabel: true, bindingServerInstanceId: true, bindingDnsType: true, bindingDnsTarget: true, bindingNote: true, revision: true, createdAt: true, updatedAt: true } as const;

function normalizeDnsTarget(type: "A" | "AAAA" | "CNAME", raw: string): string {
  const target = raw.trim();
  if (type === "A" && isIP(target) === 4) return target;
  if (type === "AAAA" && isIP(target) === 6) return new URL(`http://[${target}]/`).hostname.slice(1, -1);
  if (type === "CNAME") return normalizeManagedDomain(target);
  throw new Error("DNS target and record type do not match");
}

function dateFromCalendarDay(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) throw new Error("Invalid expiration date");
  return date;
}

export function matchDnsRecord(type: "A" | "AAAA" | "CNAME", expected: string, records: string[]): boolean {
  if (type === "CNAME") return records.some(value => value.toLowerCase().replace(/\.$/, "") === expected);
  if (type === "AAAA") return records.some(value => {
    try { return normalizeDnsTarget("AAAA", value) === normalizeDnsTarget("AAAA", expected); }
    catch { return false; }
  });
  return records.some(value => value.toLowerCase() === expected.toLowerCase());
}

function isMissingDnsRecord(error: unknown): boolean {
  return ["ENODATA", "ENOTFOUND", "NXDOMAIN", "ENOENT"].includes(String((error as { code?: string })?.code || ""));
}

export function verificationRecord(token: string, answers: string[][]): boolean {
  return answers.some(chunks => chunks.join("") === `cluster-domain-verification=${token}`);
}

export function registerDomainManagementRoutes({ app, prisma, authorization, getCurrentUser, auditService, dnsLookup = resolveTxt, dnsA = resolve4, dnsAAAA = resolve6, dnsCNAME = resolveCname, readSettings }: any) {
  async function localInstance() {
    if (!readSettings) throw new Error("Server identity provider unavailable");
    const settings = await readSettings(true);
    const id = String(settings?.serverInstanceId || "").trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error("Stable server identity is not configured");
    return { id, label: String(settings?.serverDisplayName || "This Cluster server").trim().slice(0, 160) || "This Cluster server" };
  }
  const deny = (reply: any, code: string, status = 409) => reply.code(status).send({ ok: false, code });
  async function admin(request: any, reply: any) { return authorization.requireAdmin(request, reply); }
  async function securedChange(request: any, event: string, metadata: any, run: (tx: any) => Promise<any>) {
    if (!auditService?.recordSecurityInTransaction) throw new Error("Security audit unavailable");
    const actor = await getCurrentUser(request);
    if (!actor?.id) throw new Error("Admin identity unavailable");
    return prisma.$transaction(async (tx: any) => {
      const result = await run(tx);
      const audit = await auditService.recordSecurityInTransaction(tx, {
        event, actorUserId: actor.id, targetUserId: null, result: "SUCCESS",
        reasonCode: "ADMIN_DOMAIN_MANAGEMENT", requestId: request.id || null,
        requestMethod: request.method, requestPath: request.url?.split("?")[0] || "",
        metadata,
      });
      if (audit?.ok !== true) throw new Error("Security audit unavailable");
      return result;
    });
  }
  app.get("/api/admin/domains", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    reply.header("Cache-Control", "private, no-store");
    const query = z.object({ after: z.string().max(253).optional(), search: z.string().trim().max(100).optional() }).strict().safeParse(request.query || {});
    if (!query.success) return deny(reply, "INVALID_DOMAIN_QUERY", 400);
    const where: any = {};
    if (query.data.after) {
      try { where.domain = { gt: normalizeManagedDomain(query.data.after) }; } catch { return deny(reply, "INVALID_DOMAIN_CURSOR", 400); }
    }
    if (query.data.search) where.AND = [{ domain: { contains: query.data.search.toLowerCase() } }];
    const rows = await prisma.studioManagedDomain.findMany({ where, select: publicFields, orderBy: { domain: "asc" }, take: 51 });
    const domains = rows.slice(0, 50);
    return { ok: true, domains, nextCursor: rows.length > 50 ? domains.at(-1)?.domain : null };
  });
  app.post("/api/admin/domains", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const parsed = createInput.safeParse(request.body);
    if (!parsed.success) return deny(reply, "INVALID_DOMAIN_INPUT", 400);
    let domain: string;
    try { domain = normalizeManagedDomain(parsed.data.domain); } catch { return deny(reply, "INVALID_DOMAIN", 400); }
    const id = randomUUID();
    const token = randomBytes(24).toString("hex");
    try {
      const entry = await securedChange(request, "domain.registered", { id, domain }, async (tx: any) => tx.studioManagedDomain.create({
        data: { id, domain, note: parsed.data.note || null, verificationToken: token }, select: publicFields,
      }));
      return reply.code(201).send({ ok: true, domain: entry, dnsChallenge: { host: `_cluster-verify.${domain}`, type: "TXT", value: `cluster-domain-verification=${token}` } });
    } catch (error: any) {
      if (error?.code === "P2002") return deny(reply, "DOMAIN_ALREADY_REGISTERED");
      return deny(reply, "DOMAIN_REGISTRATION_FAILED", 503);
    }
  });
  // Registrar and expiry data are explicitly operator-reported, never claimed
  // to be fetched from a registrar. A missing date is not an active renewal.
  app.patch("/api/admin/domains/:id", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const params = idParams.safeParse(request.params);
    const body = metadataInput.safeParse(request.body);
    if (!params.success || !body.success) return deny(reply, "INVALID_INPUT", 400);
    const data: any = { revision: { increment: 1 } };
    if (body.data.note !== undefined) data.note = body.data.note || null;
    if (body.data.registrar !== undefined) data.registrar = body.data.registrar || null;
    if (body.data.expiresOn !== undefined) {
      try { data.expiresOn = dateFromCalendarDay(body.data.expiresOn); } catch { return deny(reply, "INVALID_EXPIRATION_DATE", 400); }
    }
    if (Object.keys(data).length === 1) return deny(reply, "NO_METADATA_CHANGES", 400);
    try {
      const domain = await securedChange(request, "domain.metadata_updated", { id: params.data.id, fields: Object.keys(data).filter(key => key !== "revision") }, async (tx: any) => {
        const updated = await tx.studioManagedDomain.updateMany({ where: { id: params.data.id, revision: body.data.expectedRevision }, data });
        if (updated.count !== 1) throw new Error("Stale domain metadata");
        return tx.studioManagedDomain.findUnique({ where: { id: params.data.id }, select: publicFields });
      });
      return { ok: true, domain };
    } catch { return deny(reply, "DOMAIN_METADATA_CONFLICT"); }
  });
  // Rotate proof only by explicitly invalidating the previous verification and
  // any server binding, in the same transaction. A compromised TXT token cannot
  // keep authorizing new bindings after the challenge has changed.
  app.post("/api/admin/domains/:id/rotate-challenge", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const params = idParams.safeParse(request.params);
    const body = challengeInput.safeParse(request.body);
    if (!params.success || !body.success) return deny(reply, "INVALID_INPUT", 400);
    const token = randomBytes(24).toString("hex");
    try {
      const domain = await securedChange(request, "domain.proof_rotated", { id: params.data.id }, async (tx: any) => {
        const result = await tx.studioManagedDomain.updateMany({ where: { id: params.data.id, revision: body.data.expectedRevision }, data: { verificationToken: token, verificationState: "pending", verifiedAt: null, bindingHostname: null, bindingServerLabel: null, bindingServerInstanceId: null, bindingDnsType: null, bindingDnsTarget: null, bindingNote: null, connectionMode: null, connectionProvider: null, connectionWebPort: null, connectionApiPort: null, connectionPublicPort: null, revision: { increment: 1 } } });
        if (result.count !== 1) throw new Error("Stale ownership challenge");
        return tx.studioManagedDomain.findUnique({ where: { id: params.data.id }, select: publicFields });
      });
      return { ok: true, domain, dnsChallenge: { host: `_cluster-verify.${domain.domain}`, type: "TXT", value: `cluster-domain-verification=${token}` } };
    } catch { return deny(reply, "DOMAIN_PROOF_ROTATION_REJECTED"); }
  });
  app.get("/api/admin/domains/:id/dns-status", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const params = idParams.safeParse(request.params);
    if (!params.success) return deny(reply, "INVALID_ID", 400);
    const entry = await prisma.studioManagedDomain.findUnique({ where: { id: params.data.id } });
    if (!entry) return deny(reply, "DOMAIN_NOT_FOUND", 404);
    reply.header("Cache-Control", "private, no-store");
    let ownership: "present" | "missing" | "unavailable" = "unavailable";
    try { ownership = verificationRecord(entry.verificationToken, await dnsLookup(`_cluster-verify.${entry.domain}`)) ? "present" : "missing"; }
    catch (error) { ownership = isMissingDnsRecord(error) ? "missing" : "unavailable"; }
    let routing: "matching" | "mismatch" | "unavailable" | "not_configured" = "not_configured";
    if (entry.bindingHostname && entry.bindingDnsType && entry.bindingDnsTarget) {
      try {
        const lookup = entry.bindingDnsType === "A" ? dnsA : entry.bindingDnsType === "AAAA" ? dnsAAAA : dnsCNAME;
        const records = await lookup(entry.bindingHostname);
        routing = matchDnsRecord(entry.bindingDnsType, entry.bindingDnsTarget, records) ? "matching" : "mismatch";
      } catch (error) { routing = isMissingDnsRecord(error) ? "mismatch" : "unavailable"; }
    }
    // A DNS answer alone does not prove TCP reachability, TLS, or identity of
    // the server accepting HTTP requests at the bound hostname.
    return { ok: true, checkedAt: new Date().toISOString(), ownership, routing, serverIdentityRecorded: Boolean(entry.bindingServerInstanceId), tls: "not_checked", connectivity: "not_checked", provisioning: "manual_dns_tls_required" };
  });
  app.get("/api/admin/domains/:id", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const params = idParams.safeParse(request.params);
    if (!params.success) return deny(reply, "INVALID_ID", 400);
    reply.header("Cache-Control", "private, no-store");
    const domain = await prisma.studioManagedDomain.findUnique({ where: { id: params.data.id }, select: publicFields });
    if (!domain) return deny(reply, "DOMAIN_NOT_FOUND", 404);
    return { ok: true, domain };
  });
  app.get("/api/admin/domains/:id/challenge", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) return deny(reply, "INVALID_ID", 400);
    reply.header("Cache-Control", "private, no-store");
    const entry = await prisma.studioManagedDomain.findUnique({ where: { id: parsed.data.id } });
    if (!entry) return deny(reply, "DOMAIN_NOT_FOUND", 404);
    return { ok: true, dnsChallenge: { host: `_cluster-verify.${entry.domain}`, type: "TXT", value: `cluster-domain-verification=${entry.verificationToken}` } };
  });
  app.post("/api/admin/domains/:id/verify", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const params = idParams.safeParse(request.params);
    const body = revisionInput.safeParse(request.body);
    if (!params.success || !body.success) return deny(reply, "INVALID_INPUT", 400);
    const entry = await prisma.studioManagedDomain.findUnique({ where: { id: params.data.id } });
    if (!entry) return deny(reply, "DOMAIN_NOT_FOUND", 404);
    if (entry.revision !== body.data.expectedRevision) return deny(reply, "STALE_DOMAIN_REVISION");
    let answers: string[][];
    try { answers = await dnsLookup(`_cluster-verify.${entry.domain}`); }
    catch { return deny(reply, "DNS_VERIFICATION_UNAVAILABLE", 503); }
    if (!verificationRecord(entry.verificationToken, answers)) return deny(reply, "DNS_CHALLENGE_MISSING");
    try {
      const updated = await securedChange(request, "domain.verified", { id: entry.id, domain: entry.domain }, async (tx: any) => {
        const result = await tx.studioManagedDomain.updateMany({ where: { id: entry.id, revision: entry.revision, verificationToken: entry.verificationToken }, data: { verificationState: "verified", verifiedAt: new Date(), revision: { increment: 1 } } });
        if (result.count !== 1) throw new Error("Stale verification");
        return tx.studioManagedDomain.findUnique({ where: { id: entry.id }, select: publicFields });
      });
      return { ok: true, domain: updated };
    } catch { return deny(reply, "DOMAIN_VERIFICATION_CONFLICT"); }
  });
  app.post("/api/admin/domains/:id/bind", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const params = idParams.safeParse(request.params);
    const body = bindInput.safeParse(request.body);
    if (!params.success || !body.success) return deny(reply, "INVALID_INPUT", 400);
    let boundHost: string;
    try { boundHost = normalizeManagedDomain(body.data.hostname); } catch { return deny(reply, "INVALID_HOSTNAME", 400); }
    let requestedTarget: string;
    try { requestedTarget = normalizeDnsTarget(body.data.dnsType, body.data.dnsTarget); }
    catch { return deny(reply, "INVALID_DNS_TARGET", 400); }
    let instance: { id: string; label: string };
    try { instance = await localInstance(); } catch { return deny(reply, "SERVER_INSTANCE_IDENTITY_UNAVAILABLE", 503); }
    // DNS ownership can be lost after an earlier verification. Check again
    // before accepting a binding; the transaction also checks revision.
    const preflight = await prisma.studioManagedDomain.findUnique({ where: { id: params.data.id } });
    if (!preflight || preflight.revision !== body.data.expectedRevision || preflight.verificationState !== "verified") return deny(reply, "DOMAIN_BINDING_REJECTED");
    try {
      if (!verificationRecord(preflight.verificationToken, await dnsLookup(`_cluster-verify.${preflight.domain}`))) return deny(reply, "DNS_CHALLENGE_MISSING");
    } catch { return deny(reply, "DNS_VERIFICATION_UNAVAILABLE", 503); }
    try {
      const domain = await securedChange(request, "domain.binding_updated", { id: params.data.id, hostname: boundHost }, async (tx: any) => {
        const previous = await tx.studioManagedDomain.findUnique({ where: { id: params.data.id } });
        if (!previous) throw new Error("Missing domain");
        // If setup or restore changed this installation identity after the
        // preflight, refuse to bind using an obsolete server identity.
        if ((await localInstance()).id !== instance.id) throw new Error("Server identity changed");
        if (previous.verificationState !== "verified") throw new Error("Unverified domain");
        if (boundHost !== previous.domain && !boundHost.endsWith(`.${previous.domain}`)) throw new Error("Hostname outside domain");
        const result = await tx.studioManagedDomain.updateMany({ where: { id: previous.id, revision: body.data.expectedRevision, verificationState: "verified" }, data: { bindingHostname: boundHost, bindingServerLabel: instance.label, bindingServerInstanceId: instance.id, bindingDnsType: body.data.dnsType, bindingDnsTarget: requestedTarget, bindingNote: body.data.note || null, connectionMode: null, connectionProvider: null, connectionWebPort: null, connectionApiPort: null, connectionPublicPort: null, revision: { increment: 1 } } });
        if (result.count !== 1) throw new Error("Stale binding");
        return tx.studioManagedDomain.findUnique({ where: { id: previous.id }, select: publicFields });
      });
      return { ok: true, domain, provisioning: "manual_dns_tls_required" };
    } catch (error: any) { return deny(reply, error?.code === "P2002" ? "HOSTNAME_ALREADY_BOUND" : "DOMAIN_BINDING_REJECTED"); }
  });
  app.post("/api/admin/domains/:id/unbind", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const params = idParams.safeParse(request.params);
    const body = revisionInput.safeParse(request.body);
    if (!params.success || !body.success) return deny(reply, "INVALID_INPUT", 400);
    try {
      const domain = await securedChange(request, "domain.binding_removed", { id: params.data.id }, async (tx: any) => {
        const result = await tx.studioManagedDomain.updateMany({ where: { id: params.data.id, revision: body.data.expectedRevision }, data: { bindingHostname: null, bindingServerLabel: null, bindingServerInstanceId: null, bindingDnsType: null, bindingDnsTarget: null, bindingNote: null, connectionMode: null, connectionProvider: null, connectionWebPort: null, connectionApiPort: null, connectionPublicPort: null, revision: { increment: 1 } } });
        if (result.count !== 1) throw new Error("Stale domain binding");
        return tx.studioManagedDomain.findUnique({ where: { id: params.data.id }, select: publicFields });
      });
      return { ok: true, domain };
    } catch { return deny(reply, "DOMAIN_UNBIND_REJECTED"); }
  });
}
