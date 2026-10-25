/**
 * Reconcile verified native supervisor events into the canonical Incident and
 * Inbox stores when PostgreSQL recovers. The native journal is read-only, and
 * every imported event receives a unique transactional DB receipt.
 */
import { NATIVE_EVENT_DEFINITIONS, nativeEventKey, nativeEventOrdinal, type NativeEvent } from "./operations-native-alert-reader.js";
import { deliverIncidentAlert } from "./operations-incident-alert-routing.js";

/** Filter durable receipts before the per-tick work budget. Otherwise older
 * reconciled events could starve every newer event whenever a spool grows. */
export async function findUnreconciledNativeEvents(prisma: any, events: readonly NativeEvent[]) {
  if (!events.length) return [];
  const recorded = await prisma.operationsNativeAlertReceipt.findMany({
    where: { id: { in: events.map((event) => event.id) } },
    select: { id: true }, take: events.length,
  });
  const seen = new Set(recorded.map((row: { id: string }) => row.id));
  return events.filter((event) => !seen.has(event.id));
}

const TITLE: Record<string, string> = {
  gateway: "Native web gateway failure",
  "api-process": "Native API process failure",
  "api-dependencies": "Native API dependency readiness failure",
  "native-host": "Native Cluster host failure",
  "network-deployment": "Native network deployment requires attention",
};

export async function reconcileNativeEmergencyEvents(input: {
  prisma: any; events: readonly NativeEvent[]; now?: Date;
  onCommitted?: (records: any[]) => void;
}) {
  const now = input.now || new Date();
  const result = { scanned: 0, created: 0, reopened: 0, resolved: 0, escalated: 0, evidence: 0, ignored: 0, duplicates: 0, notified: 0, backlog: input.events.length > 32 };
  // One bounded transaction per event. Caller uses scheduler with backoff;
  // DB outage aborts and leaves supervisor files unchanged for next retry.
  for (const event of input.events.slice(0, 32)) {
    const definition = NATIVE_EVENT_DEFINITIONS[event.code];
    if (!definition) continue;
    result.scanned++;
    const key = nativeEventKey(definition.category);
    let outcome: { action: "created" | "reopened" | "resolved" | "escalated" | "evidence" | "ignored"; notices: any[] };
    try {
      outcome = await input.prisma.$transaction(async (tx: any) => {
        // Event receipts fence retries and concurrent importers. The unique ID
        // makes duplicate Inbox writes impossible even after a process crash.
        const latest = await tx.operationsNativeAlertReceipt.findFirst({
          where: { category: definition.category }, orderBy: [{ occurredAtOrdinal: "desc" }, { id: "desc" }],
          select: { occurredAtOrdinal: true, id: true },
        });
        const occurredAt = new Date(event.occurredAt);
        const occurredAtOrdinal = nativeEventOrdinal(event.occurredAt);
        await tx.operationsNativeAlertReceipt.create({ data: {
          id: event.id, code: event.code, category: definition.category,
          occurredAt, occurredAtOrdinal, outcome: "pending",
        } });
        // Ignore late/replayed older events, including failures that follow a
        // later recovery. Keep their receipts so the queue can progress.
        if (latest && (latest.occurredAtOrdinal > occurredAtOrdinal ||
            (latest.occurredAtOrdinal === occurredAtOrdinal && latest.id >= event.id))) {
          await tx.operationsNativeAlertReceipt.update({ where: { id: event.id }, data: { outcome: "stale" } });
          return { action: "ignored", notices: [] };
        }
        const previous = await tx.operationsIncident.findUnique({ where: { automationKey: key } });
        let action: "created" | "reopened" | "resolved" | "escalated" | "evidence" | "ignored" = "ignored";
        let notices: any[] = [];
        let incident = previous;
        if (definition.type === "recovered") {
          // Human-owned investigation is never silently closed by the monitor.
          if (previous && ["open", "monitoring"].includes(previous.status) &&
              new Date(previous.openedAt) <= occurredAt) {
            const claim = await tx.operationsIncident.updateMany({ where: {
              id: previous.id, status: { in: ["open", "monitoring"] }, alertCycle: previous.alertCycle,
            }, data: { status: "resolved", resolvedAt: occurredAt } });
            if (claim.count === 1) {
              action = "resolved";
              await tx.operationsIncidentTimeline.create({ data: { incidentId: previous.id,
                kind: "resolution", message: `Native supervisor reported confirmed recovery (${event.code}).`, correlationId: key } });
            }
          }
        } else if (!previous) {
          incident = await tx.operationsIncident.create({ data: {
            title: TITLE[definition.category], summary: definition.message,
            status: "open", severity: definition.severity === "warning" ? "high" : "critical",
            automationKey: key, correlationId: key, openedAt: occurredAt, alertCycle: 1,
          } });
          await tx.operationsIncidentResource.create({ data: {
            incidentId: incident.id, kind: "native-supervisor", resourceId: definition.category,
            label: definition.category,
          } });
          action = "created";
        } else if (["closed", "resolved"].includes(previous.status) &&
                   (!previous.resolvedAt || new Date(previous.resolvedAt) <= occurredAt)) {
          const claim = await tx.operationsIncident.updateMany({ where: {
            id: previous.id, status: { in: ["closed", "resolved"] }, alertCycle: previous.alertCycle,
          }, data: { status: "open", severity: definition.severity === "warning" ? "high" : "critical",
            summary: definition.message, openedAt: occurredAt, resolvedAt: null, closedAt: null,
            acknowledgedAt: null, acknowledgedById: null, alertCycle: { increment: 1 } } });
          if (claim.count === 1) {
            incident = await tx.operationsIncident.findUnique({ where: { id: previous.id } });
            action = "reopened";
          }
        } else if (["open", "investigating", "mitigating", "monitoring"].includes(previous.status)) {
          // A supervised crash can first register as a warning and later
          // exhaust its restart budget. Escalate severity and notify again,
          // rather than leaving a genuine critical failure labeled high.
          if (definition.severity === "critical" && previous.severity !== "critical") {
            const claim = await tx.operationsIncident.updateMany({ where: {
              id: previous.id, status: { in: ["open", "investigating", "mitigating", "monitoring"] },
              alertCycle: previous.alertCycle, severity: { not: "critical" },
            }, data: { severity: "critical", summary: definition.message } });
            if (claim.count === 1) {
              incident = { ...previous, severity: "critical", summary: definition.message };
              action = "escalated";
            }
          }
          if (action === "ignored") action = "evidence";
        }
        if (incident && ["created", "reopened", "escalated", "evidence"].includes(action)) {
          await tx.operationsIncidentTimeline.create({ data: {
            incidentId: incident.id, kind: action === "evidence" ? "evidence" : "status",
            message: `Verified native supervisor event: ${event.code}.`, correlationId: key,
          } });
        }
        if (incident && (action === "created" || action === "reopened" || action === "escalated")) {
          notices = await deliverIncidentAlert(tx, incident, action === "escalated" ? "severity-upgrade" : "initial", now);
          if (notices[0]?.userId) await tx.operationsIncident.updateMany({
            where: { id: incident.id }, data: { ownerUserId: notices[0].userId },
          });
          if (!notices.length) await tx.operationsIncidentTimeline.create({ data: {
            incidentId: incident.id, kind: "alert",
            message: "No eligible administrator received this incident; independent native fallback remains required.",
            correlationId: key,
          } });
        }
        await tx.operationsNativeAlertReceipt.update({ where: { id: event.id }, data: {
          outcome: action, incidentId: incident?.id ?? null,
        } });
        return { action, notices };
      }, { isolationLevel: "Serializable" });
    } catch (error: any) {
      // Unique-receipt conflicts are normal for overlapping schedulers. A
      // serialization conflict is retried on the next bounded tick.
      if (["P2002", "P2034"].includes(error?.code)) { result.duplicates++; continue; }
      throw error;
    }
    result[outcome.action]++;
    result.notified += outcome.notices.length;
    if (outcome.notices.length) input.onCommitted?.(outcome.notices);
  }
  return result;
}
