import { z } from "zod";
import { clusterResourceAddressSchema, type ClusterResourceAddress } from "./resource-address.js";

/**
 * Minimal invalidation record exposed to Cluster clients. Payload data stays
 * behind the normal authorized resource APIs; this stream only says what
 * changed and in what durable order.
 */
/** Version of the permission-filtered invalidation wire envelope, not the
 * payload schema of the original durable domain event. */
export const CLUSTER_RESOURCE_CHANGE_WIRE_VERSION = 1 as const;

export type ClusterResourceChange = {
  wireVersion: typeof CLUSTER_RESOURCE_CHANGE_WIRE_VERSION;
  /** Original durable event payload schema version; payload is never exposed here. */
  eventSchemaVersion: number;
  sequence: string;
  /** Opaque identity of the committed outbox row at this cursor. Not a permission grant. */
  cursorIdentity?: string;
  eventType: string;
  resource: ClusterResourceAddress;
  revision?: string | null;
  occurredAt: string;
};

export const clusterResourceChangeSchema = z.object({
  wireVersion: z.literal(CLUSTER_RESOURCE_CHANGE_WIRE_VERSION),
  eventSchemaVersion: z.number().int().min(1).max(1_000_000),
  sequence: z.string().regex(/^[1-9][0-9]*$/),
  cursorIdentity: z.string().trim().min(1).max(200).optional(),
  eventType: z.string().trim().min(1).max(160),
  resource: clusterResourceAddressSchema,
  revision: z.string().trim().max(200).optional().nullable(),
  occurredAt: z.string().datetime(),
});

export const clusterResourceChangesQuerySchema = z.object({
  after: z.coerce.string().regex(/^[0-9]+$/).default("0"),
  afterIdentity: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});
