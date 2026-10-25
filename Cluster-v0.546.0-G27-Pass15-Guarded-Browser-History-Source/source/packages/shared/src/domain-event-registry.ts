import { z } from "zod";
import { clusterResourceAddressSchema } from "./resource-address.js";

/**
 * Canonical durable domain-event identities.
 *
 * Only events that are part of Cluster's maintained internal event contract
 * belong here. External/integration ingress may still use validated custom
 * event names without becoming part of this registry.
 */
export type ClusterDomainEventDescriptor = {
  type: string;
  schemaVersion: number;
  owner: string;
  description: string;
  /** Validate the persisted payload before it enters or leaves the outbox. */
  payloadSchema?: z.ZodTypeAny;
};

// Keep durable payload contracts intentionally small. Activity records contain
// additional domain-specific metadata, but these identity fields must always be
// present or subscribers cannot deliver and deduplicate their side effects.
const activityRecordedPayloadSchema = z.object({
  id: z.string().trim().min(1),
  type: z.string().trim().min(1),
  entityType: z.string().trim().min(1),
}).passthrough();

const assignmentChangedPayloadSchema = z.object({
  resource: clusterResourceAddressSchema,
  kind: z.enum(["assignee", "owner", "reviewer", "tester", "participant", "responsible", "accountable", "consulted", "informed", "approver"]),
  subject: z.object({ kind: z.enum(["user", "team", "department", "job_role"]), id: z.string().trim().min(1) }).passthrough().nullable().optional(),
  previousSubject: z.object({ kind: z.enum(["user", "team", "department", "job_role"]), id: z.string().trim().min(1) }).passthrough().nullable().optional(),
}).passthrough();

export const CLUSTER_DOMAIN_EVENTS = {
  activityRecorded: {
    type: "activity.recorded",
    schemaVersion: 1,
    owner: "activity",
    description: "A durable Activity record was committed.",
    payloadSchema: activityRecordedPayloadSchema,
  },
  assignmentChanged: {
    type: "work.assignment.changed",
    schemaVersion: 1,
    owner: "work",
    description: "A canonical work assignment changed; signal-only event for generic invalidation and integrations, not an independent assignment projection.",
    payloadSchema: assignmentChangedPayloadSchema,
  },
} as const satisfies Record<string, ClusterDomainEventDescriptor>;

export type ClusterKnownDomainEventKey = keyof typeof CLUSTER_DOMAIN_EVENTS;
export type ClusterKnownDomainEventType = (typeof CLUSTER_DOMAIN_EVENTS)[ClusterKnownDomainEventKey]["type"];

const BY_TYPE = new Map<string, ClusterDomainEventDescriptor>(
  Object.values(CLUSTER_DOMAIN_EVENTS).map((definition) => [definition.type, definition]),
);

export function clusterDomainEventDescriptor(type: string): ClusterDomainEventDescriptor | null {
  return BY_TYPE.get(String(type || "").trim().toLowerCase()) || null;
}
