import type { ApiDependencySignal } from "./api-tool-readiness.js";
import { deliverIncidentAlert } from "./operations-incident-alert-routing.js";

/**
 * A conservative bridge from confirmed service failures to the existing
 * OperationsIncident and NotificationInbox tables. This does not create an
 * alternate incident store or attempt native process recovery.
 *
 * Database outage alerts require the native supervisor's out-of-process
 * fallback; this DB-backed path is deliberately restricted to signals that can
 * be committed while the authoritative database is available.
 */
export type DependencyIncidentCandidate = {
  key: "storage" | "background-tasks";
  status: "failed" | "recovered";
  summary: string;
};
const ELIGIBLE = ["storage", "background-tasks"] as const;

export class SustainedDependencyIncidentDetector {
  private readonly streaks = new Map<string, { fail: number; pass: number }>();
  constructor(private readonly requiredSamples = 2) {}

  evaluate(input: { stale: boolean; sampledAt: string | null; signals: readonly ApiDependencySignal[] }): DependencyIncidentCandidate[] {
    if (input.stale || !input.sampledAt) return [];
    const byKey = new Map(input.signals.map((signal) => [signal.key, signal]));
    const actions: DependencyIncidentCandidate[] = [];
    for (const key of ELIGIBLE) {
      const signal = byKey.get(key);
      const old = this.streaks.get(key) || { fail: 0, pass: 0 };
      if (!signal || !["fail", "pass"].includes(signal.status)) {
        this.streaks.set(key, { fail: 0, pass: 0 });
        continue;
      }
      const next = {
        fail: signal.status === "fail" ? Math.min(this.requiredSamples, old.fail + 1) : 0,
        pass: signal.status === "pass" ? Math.min(this.requiredSamples, old.pass + 1) : 0,
      };
      this.streaks.set(key, next);
      if (next.fail >= this.requiredSamples || next.pass >= this.requiredSamples) actions.push({
        key,
        status: next.fail >= this.requiredSamples ? "failed" : "recovered",
        // Only trusted in-process signal descriptions, already bounded.
        summary: String(signal.detail || "No details.").slice(0, 180),
      });
    }
    return actions;
  }
}

const descriptions = {
  storage: { title: "Critical storage dependency failure", severity: "critical" },
  "background-tasks": { title: "Background task execution is degraded", severity: "high" },
} as const;

/** Serialized in the caller's scheduler; DB uniqueness still fences cross-process races. */
export async function reconcileDependencyIncidents(input: {
  prisma: any;
  candidates: readonly DependencyIncidentCandidate[];
  now?: Date;
  onCommitted?: (notifications: any[]) => void;
}) {
  const now = input.now || new Date();
  const outcome = { created: 0, reopened: 0, resolved: 0, unchanged: 0, notified: 0 };
  for (const candidate of input.candidates.slice(0, 2)) {
    if (!(candidate.key in descriptions) || !["failed", "recovered"].includes(candidate.status)) continue;
    const definition = descriptions[candidate.key];
    const key = `cluster:dependency:${candidate.key}`;
    let changed: { action: "created" | "reopened" | "resolved" | "unchanged"; notices: any[] };
    try {
      changed = await input.prisma.$transaction(async (tx: any) => {
        const existing = await tx.operationsIncident.findUnique({ where: { automationKey: key } });
        if (candidate.status === "recovered") {
          // Do not auto-close incidents that an operator is investigating or
          // mitigating, or any manually created unrelated incident.
          if (!existing || !["open", "monitoring"].includes(existing.status)) return { action: "unchanged", notices: [] };
          const claim = await tx.operationsIncident.updateMany({ where: { id: existing.id, status: { in: ["open", "monitoring"] } }, data: { status: "resolved", resolvedAt: now } });
          if (claim.count !== 1) return { action: "unchanged", notices: [] };
          await tx.operationsIncidentTimeline.create({ data: { incidentId: existing.id, kind: "resolution", message: "The dependency returned to healthy status in two consecutive checks. Verify recovery before closing.", correlationId: key } });
          return { action: "resolved", notices: [] };
        }
        if (existing && !["resolved", "closed"].includes(existing.status)) return { action: "unchanged", notices: [] };
        let incident: any;
        if (existing) {
          const claim = await tx.operationsIncident.updateMany({
            where: { id: existing.id, status: { in: ["resolved", "closed"] } },
            data: { status: "open", severity: definition.severity, summary: candidate.summary,
              resolvedAt: null, closedAt: null, openedAt: now,
              acknowledgedAt: null, acknowledgedById: null, alertCycle: { increment: 1 } },
          });
          if (claim.count !== 1) return { action: "unchanged", notices: [] };
          incident = await tx.operationsIncident.findUnique({ where: { id: existing.id } });
          if (!incident) throw new Error("DEPENDENCY_INCIDENT_REOPEN_LOST");
        } else {
          incident = await tx.operationsIncident.create({ data: {
            title: definition.title, summary: candidate.summary, severity: definition.severity,
            status: "open", automationKey: key, correlationId: key, alertCycle: 1,
            ownerUserId: null,
          } });
        }
        if (!existing) await tx.operationsIncidentResource.create({ data: { incidentId: incident.id, kind: "server-dependency", resourceId: candidate.key, label: candidate.key } });
        await tx.operationsIncidentTimeline.create({ data: { incidentId: incident.id, kind: "status", message: existing ? "Confirmed dependency failure reopened this incident." : "Confirmed dependency failure opened this incident.", correlationId: key } });
        const notices = await deliverIncidentAlert(tx, incident, "initial", now);
        if (!notices.length) await tx.operationsIncidentTimeline.create({ data: {
          incidentId: incident.id, kind: "alert", message: "No eligible administrator could receive this incident. Native fallback alert delivery is required.",
          correlationId: key,
        } });
        // Keep the canonical incident owner consistent with the selected
        // routing responsibility rather than an unrelated default admin.
        const selectedOwner = notices[0]?.userId || null;
        if (incident.ownerUserId !== selectedOwner) {
          await tx.operationsIncident.updateMany({ where: { id: incident.id }, data: { ownerUserId: selectedOwner } });
        }
        return { action: existing ? "reopened" : "created", notices };
      });
    } catch (error: any) {
      // A second server may have won the same unique automationKey create.
      // The next scheduled tick will observe the durable winner and no-op.
      if (error?.code === "P2002") { outcome.unchanged++; continue; }
      throw error;
    }
    outcome[changed.action]++;
    outcome.notified += changed.notices.length;
    if (changed.notices.length) input.onCommitted?.(changed.notices);
  }
  return outcome;
}
