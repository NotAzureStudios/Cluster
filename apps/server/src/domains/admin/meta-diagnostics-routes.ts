import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { API_CONTRACT, CLUSTER_COMMAND_MANIFEST, CLUSTER_ERROR_CODES, CLUSTER_RESOURCE_MANIFEST, CLUSTER_SERVER_CAPABILITIES } from "@cluster/shared";
import { clientCompatibility, createClusterOpenApiSpec } from "../../core/openapi.js";
import { sanitizeDiagnosticBundle } from "../../core/security-observability.js";

export function registerMetaDiagnosticsRoutes(deps: {
  app: FastifyInstance;
  clusterVersion: string;
  authorization: any;
  databaseDiagnostics: any;
  inspectStorage: () => Promise<any>;
  verifyStorage: () => Promise<any>;
  recoveryApplyStatus?: () => Promise<any>;
  runtimeTelemetry: { snapshot: () => unknown };
  operationalHealthSnapshot: () => unknown;
  securityTelemetry: {
    recordClientIncident: (input: { kind: string; severity?: "info" | "warning" | "error"; route?: string | null; requestId?: string | null; message: string }) => unknown;
    snapshot: () => unknown;
  };
  runtimeConfig: Record<string, unknown>;
  readSettings: (force?: boolean) => Promise<Record<string, any>>;
  logSecurityEvent?: (input: any) => Promise<void>;
}) {
  const { app, clusterVersion, authorization, databaseDiagnostics, inspectStorage, verifyStorage, recoveryApplyStatus, runtimeTelemetry, operationalHealthSnapshot, securityTelemetry, runtimeConfig, readSettings, logSecurityEvent } = deps;

  app.get("/api/meta/contracts", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return {
    ok: true,
    requestId: String(request.id),
    clusterVersion,
    api: API_CONTRACT,
    resources: CLUSTER_RESOURCE_MANIFEST,
    commands: CLUSTER_COMMAND_MANIFEST,
    };
  });

  app.get("/api/meta/error-codes", async (request, reply) => {
    reply.header("Cache-Control", "private, max-age=300");
    return {
      ok: true,
      requestId: String(request.id),
      clusterVersion,
      codes: CLUSTER_ERROR_CODES,
    };
  });

  app.get("/api/meta/compatibility", async (request) => {
    const settings = await readSettings();
    const query = z.object({ clientVersion: z.string().trim().min(1).max(40) }).parse(request.query || {});
    const compatibility = clientCompatibility(query.clientVersion, clusterVersion);
    const parseVersion = (value: string) => value.split(".").map((part) => Number(part));
    const clientParts = parseVersion(query.clientVersion);
    const serverParts = parseVersion(clusterVersion);
    const validParts = [...clientParts, ...serverParts].every((part) => Number.isInteger(part) && part >= 0);
    let comparison = 0;
    if (validParts) {
      for (let index = 0; index < Math.max(clientParts.length, serverParts.length); index += 1) {
        comparison = (clientParts[index] || 0) - (serverParts[index] || 0);
        if (comparison !== 0) break;
      }
    }
    const direction = !compatibility.compatible
      ? compatibility.reason === "CLIENT_TOO_OLD" ? "upgrade-client" : comparison > 0 ? "upgrade-server" : "align-major"
      : comparison > 0 ? "upgrade-server-recommended" : comparison < 0 ? "upgrade-client-recommended" : "none";
    const operational = operationalHealthSnapshot() as { ready?: boolean; state?: string; checks?: Array<{ key?: string; status?: string }> };
    const readinessChecks = Array.isArray(operational?.checks)
      ? operational.checks.filter((check) => ["lifecycle", "database", "storage"].includes(String(check?.key || ""))).map((check) => ({ key: check.key, status: check.status }))
      : [];
    return {
      ok: true,
      clientVersion: query.clientVersion,
      serverVersion: clusterVersion,
      contractVersion: API_CONTRACT.version,
      minimumClientVersion: API_CONTRACT.minimumClientVersion,
      serverInstanceId: String(settings.serverInstanceId || "").trim() || null,
      serverDataEpoch: String(settings.serverDataEpoch || settings.serverInstanceId || "").trim() || null,
      mutationSchemaVersion: API_CONTRACT.sync.mutationSchemaVersion,
      ...compatibility,
      runtimeAccess: {
        mode: ["maintenance", "read-only", "recovery"].includes(String(operational?.state || "")) ? String(operational?.state) : "normal",
        readsAllowed: !["maintenance", "recovery"].includes(String(operational?.state || "")),
        writesAllowed: String(operational?.state || "") === "healthy" || String(operational?.state || "") === "degraded",
        queuedMutationReplayAllowed: String(operational?.state || "") === "healthy" || String(operational?.state || "") === "degraded",
      },
      upgrade: {
        direction,
        migrationPreflightRequired: comparison !== 0,
        migrationsOwnedBy: "server",
        serverReady: Boolean(operational?.ready),
        serverState: String(operational?.state || "unknown"),
        readinessChecks,
        safeOrder: comparison > 0 ? ["server", "clients"] : ["server-preflight", "clients"],
        advice: direction === "upgrade-client"
          ? `Upgrade this client to Cluster ${API_CONTRACT.minimumClientVersion} or newer before connecting.`
          : direction.startsWith("upgrade-server")
            ? `Upgrade and migrate the Cluster Server before relying on client ${query.clientVersion}.`
            : direction === "align-major"
              ? "Client and server major versions must be aligned before workspace access."
              : comparison < 0
                ? `Server ${clusterVersion} is newer than this client. Upgrade the client when practical.`
                : "Client and server versions are aligned.",
      },
      capabilities: CLUSTER_SERVER_CAPABILITIES,
    };
  });

  app.get("/api/meta/openapi.json", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "private, no-store");
    return createClusterOpenApiSpec(clusterVersion);
  });



  app.post("/api/security/client-incidents", async (request, reply) => {
    const body = z.object({
      kind: z.string().trim().min(1).max(80),
      severity: z.enum(["info", "warning", "error"]).default("error"),
      route: z.string().trim().max(240).optional().nullable(),
      requestId: z.string().trim().max(96).optional().nullable(),
      message: z.string().trim().min(1).max(2_000),
    }).parse(request.body || {});
    const incident = securityTelemetry.recordClientIncident(body);
    reply.code(202);
    return { ok: true, accepted: true, incidentId: (incident as { id?: string })?.id || null, requestId: String(request.id) };
  });

  app.get("/api/admin/diagnostics/bundle", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const generatedAt = new Date().toISOString();
    const databaseSnapshot = await databaseDiagnostics.providerSnapshot();
    const bundle = sanitizeDiagnosticBundle({
      schemaVersion: 1,
      generatedAt,
      clusterVersion,
      requestId: String(request.id),
      posture: runtimeConfig,
      runtime: runtimeTelemetry.snapshot(),
      operationalHealth: operationalHealthSnapshot(),
      security: securityTelemetry.snapshot(),
      database: {
        queries: databaseDiagnostics.snapshot(),
        database: databaseSnapshot,
      },
      storage: await inspectStorage(),
      recoveryApply: recoveryApplyStatus ? await recoveryApplyStatus() : null,
      notes: [
        "Secrets, credentials, user identifiers, network addresses, user agents, and local filesystem paths are redacted.",
        "The bundle contains bounded runtime summaries rather than raw workspace content.",
      ],
    });
    reply.header("Content-Disposition", `attachment; filename=cluster-diagnostics-${generatedAt.slice(0, 10)}.json`);
    reply.header("Cache-Control", "no-store");
    return bundle;
  });


  app.get("/api/admin/recovery/status", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "private, no-store");
    const journal = recoveryApplyStatus ? await recoveryApplyStatus() : null;
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      recoveryApply: journal,
      requiresOperatorReview: Boolean(journal && !["complete"].includes(String(journal.state || ""))),
    };
  });

  app.get("/api/admin/database/diagnostics", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const database = await databaseDiagnostics.providerSnapshot();
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      queries: databaseDiagnostics.snapshot(),
      database,
    };
  });


  app.get("/api/admin/storage/status", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    return { ok: true, storage: await inspectStorage() };
  });

  app.post("/api/admin/storage/verify", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const verification = await verifyStorage();
    await logSecurityEvent?.({ event: "admin.storage_verify", actorUserId: admin.id, result: "SUCCESS", reasonCode: "ADMIN_STORAGE_VERIFY", request, metadata: { ok: verification?.ok !== false } });
    return { ok: true, verifiedAt: new Date().toISOString(), verification, storage: await inspectStorage() };
  });

  app.post("/api/admin/database/optimize", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const database = await databaseDiagnostics.optimize();
    await logSecurityEvent?.({ event: "admin.database_optimize", actorUserId: admin.id, result: "SUCCESS", reasonCode: "ADMIN_DATABASE_OPTIMIZE", request, metadata: { boundedAnalyze: true } });
    return { ok: true, optimizedAt: new Date().toISOString(), database };
  });
}
