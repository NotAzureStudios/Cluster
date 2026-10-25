import crypto, { randomUUID } from "node:crypto";
import type { ClusterDomainEvent, DurableDomainEventRuntime } from "../../core/domain-events.js";
import { CircuitBreaker, CircuitOpenError } from "../../core/circuit-breaker.js";
import { currentReliabilityContext } from "../../core/reliability-context.js";
import { secureOutboundFetch, validateOutboundUrl } from "../../core/outbound-http.js";
import { decryptSecuritySecret, encryptSecuritySecret } from "../../core/setting-crypto.js";
import type { BackgroundJobQueue } from "../jobs/job-queue-service.js";

type WebhookLogger = {
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
};

type ServiceCredentialAuthority = {
  create: (input: { name: string; credentialType: "webhook_signing"; scopes: string[]; expiresAt?: Date | null; createdById?: string | null }) => Promise<{ row: any; secret: string }>;
  webhookSecret: (id: string) => Promise<string | null>;
};

const MAX_EVENT_TYPES = 128;
const MAX_EVENT_PAYLOAD_BYTES = 96 * 1024;
const MAX_ERROR_LENGTH = 1_000;
const WEBHOOK_JOB_TYPE = "integrations.webhook-deliver";

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeEventTypes(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const result = [...new Set(source
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter((entry) => entry === "*" || /^[a-z0-9][a-z0-9._:-]{1,119}(?:\.\*)?$/.test(entry)))];
  if (!result.length) throw new Error("Choose at least one webhook event type.");
  if (result.length > MAX_EVENT_TYPES) throw new Error(`Webhook subscriptions are limited to ${MAX_EVENT_TYPES} event types.`);
  return result;
}

function eventMatches(subscription: string, eventType: string) {
  if (subscription === "*") return true;
  if (subscription.endsWith(".*")) return eventType.startsWith(subscription.slice(0, -1));
  return subscription === eventType;
}

function safeDisplayUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.protocol}//${url.host}${path}`.slice(0, 300);
}

function boundedPayload(value: unknown) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") > MAX_EVENT_PAYLOAD_BYTES) throw new Error(`Webhook payload exceeds ${MAX_EVENT_PAYLOAD_BYTES} bytes.`);
  return text;
}

function hashPayload(payload: string) {
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function endpointUrlPurpose(endpointId: string) { return `webhook:url:${endpointId}`; }
function deliveryPayloadPurpose(deliveryId: string) { return `webhook:delivery:${deliveryId}`; }

export function serializeWebhookEndpoint(row: any) {
  return {
    id: row.id,
    name: row.name,
    urlDisplay: row.urlDisplay,
    eventTypes: parseStringArray(row.eventTypes),
    workspaceId: row.workspaceId || null,
    projectId: row.projectId || null,
    signingCredentialId: row.signingCredentialId,
    enabled: Boolean(row.enabled),
    allowPrivateNetwork: Boolean(row.allowPrivateNetwork),
    allowHttpPrivateNetwork: Boolean(row.allowHttpPrivateNetwork),
    timeoutMs: Number(row.timeoutMs || 10_000),
    lastSuccessAt: row.lastSuccessAt || null,
    lastFailureAt: row.lastFailureAt || null,
    consecutiveFailures: Number(row.consecutiveFailures || 0),
    createdById: row.createdById || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeWebhookDelivery(row: any) {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventId: row.eventId,
    eventType: row.eventType,
    payloadHash: row.payloadHash,
    status: row.status,
    attempts: Number(row.attempts || 0),
    lastStatusCode: row.lastStatusCode ?? null,
    lastError: row.lastError || null,
    latencyMs: row.latencyMs ?? null,
    deliveredAt: row.deliveredAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createWebhookIntegrationService(input: {
  prisma: any;
  queue: BackgroundJobQueue;
  events: DurableDomainEventRuntime;
  credentials: ServiceCredentialAuthority;
  logger?: WebhookLogger;
}) {
  const { prisma, queue, events, credentials, logger = {} } = input;
  let unsubscribe: (() => void) | null = null;
  const circuits = new CircuitBreaker({ failureThreshold: 5, baseCooldownMs: 15_000, maximumCooldownMs: 10 * 60_000 });

  function activeWorkspaceId() {
    const workspaceId = currentReliabilityContext()?.workspaceId || null;
    if (!workspaceId) throw new Error("Webhook administration requires an active workspace.");
    return workspaceId;
  }

  async function enqueueDelivery(deliveryId: string, createdById?: string | null, reliability: { workspaceId?: string | null; correlationId?: string | null; causationId?: string | null } = {}) {
    return queue.enqueue({
      type: WEBHOOK_JOB_TYPE,
      payload: { deliveryId },
      priority: 10,
      maxAttempts: 7,
      dedupeKey: `webhook:${deliveryId}`,
      workspaceId: reliability.workspaceId || null,
      correlationId: reliability.correlationId || null,
      causationId: reliability.causationId || null,
      createdById: createdById || null,
    });
  }

  async function createEndpoint(data: {
    name: string;
    url: string;
    eventTypes: string[];
    projectId?: string | null;
    allowPrivateNetwork?: boolean;
    allowHttpPrivateNetwork?: boolean;
    timeoutMs?: number;
    createdById?: string | null;
  }) {
    const id = randomUUID();
    const workspaceId = activeWorkspaceId();
    const allowPrivateNetwork = Boolean(data.allowPrivateNetwork);
    const allowHttpPrivateNetwork = Boolean(data.allowHttpPrivateNetwork) && allowPrivateNetwork;
    const validated = validateOutboundUrl(data.url, {
      purpose: "Webhook endpoint",
      allowPrivateNetwork,
      allowHttpPrivateNetwork,
      requireHttps: !allowHttpPrivateNetwork,
    });
    const eventTypes = normalizeEventTypes(data.eventTypes);
    if (data.projectId) {
      const exists = await prisma.project.findFirst({ where: { id: data.projectId, workspaceId, archived: false }, select: { id: true } });
      if (!exists) throw new Error("Webhook project scope was not found.");
    }
    const signing = await credentials.create({
      name: `Webhook · ${String(data.name || "Endpoint").trim().slice(0, 80)}`,
      credentialType: "webhook_signing",
      scopes: ["webhooks.emit"],
      createdById: data.createdById || null,
    });
    try {
      const row = await prisma.integrationWebhookEndpoint.create({
        data: {
          id,
          name: String(data.name || "Webhook").trim().slice(0, 120),
          encryptedUrl: encryptSecuritySecret(endpointUrlPurpose(id), validated.toString()),
          urlDisplay: safeDisplayUrl(validated.toString()),
          eventTypes: JSON.stringify(eventTypes),
          workspaceId,
          projectId: data.projectId || null,
          signingCredentialId: signing.row.id,
          allowPrivateNetwork,
          allowHttpPrivateNetwork,
          timeoutMs: Math.max(1_000, Math.min(30_000, Math.round(Number(data.timeoutMs || 10_000)))),
          createdById: data.createdById || null,
        },
      });
      return { endpoint: serializeWebhookEndpoint(row), signingSecret: signing.secret };
    } catch (error) {
      await prisma.serviceCredential.update({ where: { id: signing.row.id }, data: { revokedAt: new Date() } }).catch(() => undefined);
      throw error;
    }
  }

  async function updateEndpoint(id: string, patch: {
    name?: string;
    url?: string;
    eventTypes?: string[];
    projectId?: string | null;
    enabled?: boolean;
    allowPrivateNetwork?: boolean;
    allowHttpPrivateNetwork?: boolean;
    timeoutMs?: number;
  }) {
    const workspaceId = activeWorkspaceId();
    const current = await prisma.integrationWebhookEndpoint.findFirst({ where: { id, workspaceId } });
    if (!current) return null;
    const allowPrivateNetwork = patch.allowPrivateNetwork === undefined ? Boolean(current.allowPrivateNetwork) : Boolean(patch.allowPrivateNetwork);
    const allowHttpPrivateNetwork = (patch.allowHttpPrivateNetwork === undefined ? Boolean(current.allowHttpPrivateNetwork) : Boolean(patch.allowHttpPrivateNetwork)) && allowPrivateNetwork;
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = String(patch.name || "Webhook").trim().slice(0, 120);
    if (patch.eventTypes !== undefined) data.eventTypes = JSON.stringify(normalizeEventTypes(patch.eventTypes));
    if (patch.enabled !== undefined) data.enabled = Boolean(patch.enabled);
    if (patch.timeoutMs !== undefined) data.timeoutMs = Math.max(1_000, Math.min(30_000, Math.round(Number(patch.timeoutMs))));
    if (patch.projectId !== undefined) {
      if (patch.projectId) {
        const exists = await prisma.project.findFirst({ where: { id: patch.projectId, workspaceId, archived: false }, select: { id: true } });
        if (!exists) throw new Error("Webhook project scope was not found.");
      }
      data.projectId = patch.projectId || null;
    }
    if (patch.url !== undefined || patch.allowPrivateNetwork !== undefined || patch.allowHttpPrivateNetwork !== undefined) {
      const raw = patch.url !== undefined ? patch.url : decryptSecuritySecret(endpointUrlPurpose(id), current.encryptedUrl);
      const validated = validateOutboundUrl(raw, { purpose: "Webhook endpoint", allowPrivateNetwork, allowHttpPrivateNetwork, requireHttps: !allowHttpPrivateNetwork });
      data.encryptedUrl = encryptSecuritySecret(endpointUrlPurpose(id), validated.toString());
      data.urlDisplay = safeDisplayUrl(validated.toString());
    }
    data.allowPrivateNetwork = allowPrivateNetwork;
    data.allowHttpPrivateNetwork = allowHttpPrivateNetwork;
    const updated = await prisma.integrationWebhookEndpoint.update({ where: { id }, data });
    return serializeWebhookEndpoint(updated);
  }

  async function deleteEndpoint(id: string) {
    const workspaceId = activeWorkspaceId();
    const row = await prisma.integrationWebhookEndpoint.findFirst({ where: { id, workspaceId } });
    if (!row) return false;
    await prisma.$transaction(async (tx: any) => {
      await tx.integrationWebhookEndpoint.delete({ where: { id } });
      await tx.serviceCredential.updateMany({ where: { id: row.signingCredentialId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    return true;
  }

  async function rotateSigningSecret(id: string) {
    const workspaceId = activeWorkspaceId();
    const endpoint = await prisma.integrationWebhookEndpoint.findFirst({ where: { id, workspaceId } });
    if (!endpoint) return null;
    const credential = await prisma.serviceCredential.findUnique({ where: { id: endpoint.signingCredentialId } });
    if (!credential || credential.revokedAt || credential.credentialType !== "webhook_signing") throw new Error("Webhook signing credential is unavailable.");
    const replacement = await credentials.create({
      name: `Webhook · ${String(endpoint.name || "Endpoint").trim().slice(0, 80)}`,
      credentialType: "webhook_signing",
      scopes: ["webhooks.emit"],
      createdById: endpoint.createdById || credential.createdById || null,
    });
    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const nextEndpoint = await tx.integrationWebhookEndpoint.update({ where: { id }, data: { signingCredentialId: replacement.row.id } });
        await tx.serviceCredential.updateMany({ where: { id: credential.id, revokedAt: null }, data: { revokedAt: new Date() } });
        return nextEndpoint;
      });
      return { endpoint: serializeWebhookEndpoint(updated), signingSecret: replacement.secret };
    } catch (error) {
      await prisma.serviceCredential.updateMany({ where: { id: replacement.row.id, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => undefined);
      throw error;
    }
  }

  async function materialize(endpoint: any, event: ClusterDomainEvent, force = false) {
    if (!endpoint.enabled) return null;
    const eventType = String(event.type || "").trim().toLowerCase();
    const subscriptions = parseStringArray(endpoint.eventTypes).map((entry) => entry.toLowerCase());
    if (!force && !subscriptions.some((subscription) => eventMatches(subscription, eventType))) return null;
    if (!force && endpoint.projectId && endpoint.projectId !== event.projectId) return null;
    const deliveryId = randomUUID();
    const body = boundedPayload({
      schemaVersion: event.schemaVersion || 1,
      id: event.id,
      type: event.type,
      workspaceId: event.workspaceId || null,
      correlationId: event.correlationId || event.id,
      causationId: event.causationId || null,
      occurredAt: event.occurredAt instanceof Date ? event.occurredAt.toISOString() : new Date(event.occurredAt).toISOString(),
      actorUserId: event.actorUserId || null,
      projectId: event.projectId || null,
      resource: event.resource || null,
      resourceRevision: event.resourceRevision || null,
      payload: event.payload ?? null,
    });
    let delivery: any;
    try {
      delivery = await prisma.integrationWebhookDelivery.create({
        data: {
          id: deliveryId,
          endpointId: endpoint.id,
          eventId: event.id,
          eventType,
          encryptedPayload: encryptSecuritySecret(deliveryPayloadPurpose(deliveryId), body),
          payloadHash: hashPayload(body),
        },
      });
    } catch (error: any) {
      if (String(error?.code || "") !== "P2002") throw error;
      // A prior attempt can commit the delivery row and then fail to enqueue
      // its background job. The outbox replay must recover that exact row,
      // not mistake the uniqueness collision for successful delivery.
      delivery = await prisma.integrationWebhookDelivery.findUnique({
        where: { endpointId_eventId: { endpointId: endpoint.id, eventId: event.id } },
      });
      if (!delivery) throw new Error("Webhook delivery collision could not be resolved.");
      if (!(["PENDING", "RETRYING"] as string[]).includes(String(delivery.status))) return null;
    }
    await enqueueDelivery(delivery.id, endpoint.createdById || null, { workspaceId: event.workspaceId, correlationId: event.correlationId, causationId: event.id });
    return serializeWebhookDelivery(delivery);
  }

  async function publishEvent(event: ClusterDomainEvent) {
    const where = event.projectId
      ? { workspaceId: event.workspaceId || null, enabled: true, OR: [{ projectId: null }, { projectId: event.projectId }] }
      : { workspaceId: event.workspaceId || null, enabled: true, projectId: null };
    let materialized = 0;
    let failures = 0;
    let cursor: string | null = null;
    for (;;) {
      const endpoints: any[] = await prisma.integrationWebhookEndpoint.findMany({
        where, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!endpoints.length) break;
      for (const endpoint of endpoints) {
        try {
          if (await materialize(endpoint, event)) materialized += 1;
        } catch (error) {
          failures += 1;
          // Continue fanout so healthy endpoints do not wait for a failing
          // sibling, but fail the durable consumer after the scan. Already
          // committed deliveries are unique per (endpoint, event) and replay
          // safely; an acknowledged outbox event must not lose recipients.
          logger.warn?.({ endpointId: endpoint.id, eventId: event.id, error }, "webhook event materialization failed");
        }
      }
      cursor = endpoints[endpoints.length - 1].id;
      if (endpoints.length < 500) break;
    }
    if (failures) throw new Error(`Webhook materialization incomplete for ${failures} endpoint(s); durable replay required.`);
    return materialized;
  }

  async function testEndpoint(id: string, actorUserId?: string | null) {
    const workspaceId = activeWorkspaceId();
    const endpoint = await prisma.integrationWebhookEndpoint.findFirst({ where: { id, workspaceId } });
    if (!endpoint) return null;
    return materialize(endpoint, {
      id: randomUUID(),
      type: "integration.webhook.test",
      occurredAt: new Date(),
      workspaceId: endpoint.workspaceId || null,
      actorUserId: actorUserId || null,
      projectId: endpoint.projectId || null,
      payload: { test: true, endpointId: endpoint.id, message: "Cluster webhook delivery test" },
    }, true);
  }

  async function deliver(deliveryId: string, attempt: number, maxAttempts: number) {
    const delivery = await prisma.integrationWebhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } });
    if (!delivery) return { skipped: true, reason: "delivery_missing" };
    if (delivery.status === "SUCCEEDED") return { skipped: true, reason: "already_delivered" };
    const endpoint = delivery.endpoint;
    if (!endpoint?.enabled) {
      await prisma.integrationWebhookDelivery.update({ where: { id: delivery.id }, data: { status: "CANCELLED", attempts: Math.max(delivery.attempts, attempt), lastError: "Webhook endpoint is disabled." } });
      return { skipped: true, reason: "endpoint_disabled" };
    }
    const startedAt = performance.now();
    let responseStatus: number | null = null;
    try {
      const secret = await credentials.webhookSecret(endpoint.signingCredentialId);
      if (!secret) throw new Error("Webhook signing credential is unavailable or outside Studio credential policy.");
      const url = decryptSecuritySecret(endpointUrlPurpose(endpoint.id), endpoint.encryptedUrl);
      const payload = decryptSecuritySecret(deliveryPayloadPurpose(delivery.id), delivery.encryptedPayload);
      if (hashPayload(payload) !== delivery.payloadHash) throw new Error("Webhook retry payload integrity check failed.");
      // Reauthorization is not solely an endpoint.enabled check. A queued
      // event must still belong to the endpoint's current Studio/Project and
      // subscription audience; otherwise changing a filter would leave old
      // unauthorized deliveries waiting to be sent on the next retry.
      let originalEvent: any;
      try { originalEvent = JSON.parse(payload); }
      catch { throw new Error("Webhook delivery envelope could not be decoded."); }
      if (originalEvent?.id !== delivery.eventId || originalEvent?.type !== delivery.eventType) {
        throw new Error("Webhook delivery envelope identity does not match its durable record.");
      }
      const isExplicitTest = delivery.eventType === "integration.webhook.test" &&
        originalEvent?.payload?.test === true && originalEvent.payload.endpointId === endpoint.id &&
        (originalEvent.workspaceId || null) === (endpoint.workspaceId || null) &&
        (originalEvent.projectId || null) === (endpoint.projectId || null);
      const subscriptions = parseStringArray(endpoint.eventTypes).map((entry) => entry.toLowerCase());
      const stillInAudience = isExplicitTest || (
        (endpoint.workspaceId || null) === (originalEvent.workspaceId || null) &&
        (!endpoint.projectId || endpoint.projectId === originalEvent.projectId) &&
        subscriptions.some((subscription) => eventMatches(subscription, delivery.eventType))
      );
      if (!stillInAudience) {
        await prisma.integrationWebhookDelivery.updateMany({
          where: { id: delivery.id, status: { in: ["PENDING", "RETRYING"] } },
          data: { status: "CANCELLED", attempts: Math.max(delivery.attempts, attempt), lastError: "Webhook endpoint no longer subscribes to this event or Project." },
        });
        return { skipped: true, reason: "endpoint_audience_changed" };
      }
      // Credential lookup, payload decryption and signing are asynchronous.
      // An administrator can disable or reconfigure this endpoint in that
      // window. Recheck authoritative endpoint state immediately before the
      // outbound call; queued deliveries do not grant perpetual send rights.
      // A request already in flight cannot be retroactively recalled.
      const currentEndpoint = await prisma.integrationWebhookEndpoint.findUnique({
        where: { id: endpoint.id },
        select: {
          enabled: true, workspaceId: true, projectId: true, eventTypes: true,
          signingCredentialId: true, encryptedUrl: true, timeoutMs: true,
          allowPrivateNetwork: true, allowHttpPrivateNetwork: true,
        },
      });
      if (!currentEndpoint?.enabled) {
        await prisma.integrationWebhookDelivery.updateMany({
          where: { id: delivery.id, status: { in: ["PENDING", "RETRYING"] } },
          data: { status: "CANCELLED", attempts: Math.max(delivery.attempts, attempt), lastError: "Webhook endpoint was disabled before dispatch." },
        });
        return { skipped: true, reason: "endpoint_disabled" };
      }
      if (currentEndpoint.workspaceId !== endpoint.workspaceId ||
          currentEndpoint.projectId !== endpoint.projectId || currentEndpoint.eventTypes !== endpoint.eventTypes ||
          currentEndpoint.signingCredentialId !== endpoint.signingCredentialId ||
          currentEndpoint.encryptedUrl !== endpoint.encryptedUrl || currentEndpoint.timeoutMs !== endpoint.timeoutMs ||
          Boolean(currentEndpoint.allowPrivateNetwork) !== Boolean(endpoint.allowPrivateNetwork) ||
          Boolean(currentEndpoint.allowHttpPrivateNetwork) !== Boolean(endpoint.allowHttpPrivateNetwork)) {
        throw new Error("Webhook endpoint configuration changed during delivery preparation; retry with current policy.");
      }
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${delivery.eventId}.${payload}`, "utf8").digest("hex");
      const response = await circuits.execute(`webhook:${endpoint.id}`, async () => {
        const outbound = await secureOutboundFetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "Cluster-Webhook/1",
            "x-cluster-event-id": delivery.eventId,
            "x-cluster-event-type": delivery.eventType,
            "x-cluster-delivery-id": delivery.id,
            "x-cluster-timestamp": timestamp,
            "x-cluster-signature": `v1=${signature}`,
            "idempotency-key": `${endpoint.id}:${delivery.eventId}`,
          },
          body: payload,
        }, endpoint.timeoutMs, {
          purpose: "Cluster webhook",
          allowPrivateNetwork: Boolean(endpoint.allowPrivateNetwork),
          allowHttpPrivateNetwork: Boolean(endpoint.allowHttpPrivateNetwork),
          requireHttps: !endpoint.allowHttpPrivateNetwork,
          maxRedirects: 1,
          maxRequestBytes: MAX_EVENT_PAYLOAD_BYTES,
          maxResponseBytes: 512 * 1024,
        });
        if (outbound.status < 200 || outbound.status >= 300) throw new Error(`Webhook returned HTTP ${outbound.status}.`);
        return outbound;
      });
      responseStatus = response.status;
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      await prisma.$transaction([
        prisma.integrationWebhookDelivery.update({ where: { id: delivery.id }, data: { status: "SUCCEEDED", attempts: Math.max(delivery.attempts, attempt), lastStatusCode: response.status, lastError: null, latencyMs, deliveredAt: new Date() } }),
        prisma.integrationWebhookEndpoint.update({ where: { id: endpoint.id }, data: { lastSuccessAt: new Date(), consecutiveFailures: 0 } }),
      ]);
      return { delivered: true, statusCode: response.status, latencyMs };
    } catch (error) {
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const message = String(error instanceof Error ? error.message : error).slice(0, MAX_ERROR_LENGTH);
      const current = await prisma.integrationWebhookDelivery.findUnique({ where: { id: delivery.id }, select: { status: true, attempts: true } }).catch(() => null);
      if (current && current.status !== "SUCCEEDED") {
        const circuitOpen = error instanceof CircuitOpenError;
        const deliveryUpdate = prisma.integrationWebhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: attempt >= maxAttempts ? "DEAD_LETTER" : "RETRYING",
            attempts: Math.max(Number(current.attempts || 0), attempt),
            ...(responseStatus === null ? {} : { lastStatusCode: responseStatus }),
            lastError: message,
            latencyMs,
          },
        });
        if (circuitOpen) await deliveryUpdate.catch(() => undefined);
        else await prisma.$transaction([
          deliveryUpdate,
          prisma.integrationWebhookEndpoint.update({ where: { id: endpoint.id }, data: { lastFailureAt: new Date(), consecutiveFailures: { increment: 1 } } }),
        ]).catch(() => undefined);
      }
      throw error;
    }
  }

  async function recoverPending(limit = 500) {
    const rows = await prisma.integrationWebhookDelivery.findMany({
      where: { status: { in: ["PENDING", "RETRYING"] }, endpoint: { enabled: true } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: Math.max(1, Math.min(2_000, Math.round(limit))),
      select: { id: true, endpoint: { select: { createdById: true, workspaceId: true } } },
    });
    for (const row of rows) await enqueueDelivery(row.id, row.endpoint?.createdById || null, { workspaceId: row.endpoint?.workspaceId || null });
    return { scanned: rows.length, enqueued: rows.length };
  }

  async function retryDelivery(deliveryId: string) {
    const workspaceId = activeWorkspaceId();
    const delivery = await prisma.integrationWebhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } });
    if (!delivery || delivery.endpoint?.workspaceId !== workspaceId) return null;
    if (delivery.status === "SUCCEEDED") throw new Error("Successful webhook deliveries cannot be retried.");
    if (!delivery.endpoint?.enabled) throw new Error("Enable the webhook endpoint before retrying this delivery.");
    const updated = await prisma.integrationWebhookDelivery.update({
      where: { id: deliveryId },
      data: { status: "PENDING", lastError: null, deliveredAt: null },
    });
    await enqueueDelivery(deliveryId, delivery.endpoint.createdById || null);
    return serializeWebhookDelivery(updated);
  }

  function startEventSubscription() {
    if (unsubscribe) return unsubscribe;
    unsubscribe = events.subscribe("*", "integrations.webhooks", async (event) => { await publishEvent(event); });
    return unsubscribe;
  }

  function stopEventSubscription() {
    unsubscribe?.();
    unsubscribe = null;
  }

  return {
    createEndpoint,
    updateEndpoint,
    deleteEndpoint,
    rotateSigningSecret,
    publishEvent,
    testEndpoint,
    deliver,
    retryDelivery,
    recoverPending,
    circuitSnapshot: () => circuits.snapshot(),
    startEventSubscription,
    stopEventSubscription,
  };
}
