import {
  CLUSTER_RESOURCE_MANIFEST,
  type ClusterFeatureLifecycle,
  type ClusterResourceCapability,
  type ClusterResourceKind,
} from "./cluster-manifest.js";

export const CLUSTER_COMMAND_RISKS = ["routine", "sensitive", "destructive"] as const;
export type ClusterCommandRisk = (typeof CLUSTER_COMMAND_RISKS)[number];

export type ClusterCommandUndoPolicy =
  | { mode: "none" }
  | { mode: "compensating"; commandType: string; windowMs?: number | null };

export type ClusterCommandDescriptor = {
  label: string;
  description: string;
  ownerDomain: string;
  schemaVersion: number;
  lifecycle: ClusterFeatureLifecycle;
  resourceKinds: readonly ClusterResourceKind[];
  requiredCapability?: ClusterResourceCapability | null;
  supportsDryRun: boolean;
  supportsBulk: boolean;
  risk: ClusterCommandRisk;
  undo: ClusterCommandUndoPolicy;
};

/**
 * Canonical maintained command vocabulary. UI surfaces, Automation, Admin,
 * and command execution discover supported actions here instead of keeping
 * separate action-name registries.
 */
export const CLUSTER_COMMAND_MANIFEST = {
  "operation.retry": {
    label: "Retry operation",
    description: "Queue a failed, dead-lettered, or cancelled operation for another attempt.",
    ownerDomain: "jobs",
    schemaVersion: 1,
    lifecycle: "active",
    resourceKinds: ["background_job"],
    requiredCapability: "operate",
    supportsDryRun: true,
    supportsBulk: true,
    risk: "sensitive",
    undo: { mode: "none" },
  },
  "operation.cancel": {
    label: "Cancel operation",
    description: "Request cancellation of a queued or running operation.",
    ownerDomain: "jobs",
    schemaVersion: 1,
    lifecycle: "active",
    resourceKinds: ["background_job"],
    requiredCapability: "operate",
    supportsDryRun: true,
    supportsBulk: false,
    risk: "destructive",
    undo: { mode: "none" },
  },
  "data_import.apply": {
    label: "Apply staged data import",
    description: "Queue a validated and explicitly confirmed staged data import.",
    ownerDomain: "data-imports",
    schemaVersion: 1,
    lifecycle: "active",
    resourceKinds: ["project", "ticket"],
    supportsDryRun: true,
    supportsBulk: true,
    risk: "sensitive",
    undo: { mode: "none" },
  },
} as const satisfies Record<string, ClusterCommandDescriptor>;

export type ClusterCommandType = keyof typeof CLUSTER_COMMAND_MANIFEST;
export const CLUSTER_COMMAND_TYPES = Object.freeze(Object.keys(CLUSTER_COMMAND_MANIFEST)) as readonly ClusterCommandType[];

export function clusterCommandDescriptor(type: string): ClusterCommandDescriptor | null {
  return Object.prototype.hasOwnProperty.call(CLUSTER_COMMAND_MANIFEST, type)
    ? CLUSTER_COMMAND_MANIFEST[type as ClusterCommandType]
    : null;
}

export function clusterCommandsForResource(kind: ClusterResourceKind) {
  return CLUSTER_COMMAND_TYPES.filter((type) => CLUSTER_COMMAND_MANIFEST[type].resourceKinds.includes(kind as never));
}

export type ClusterResourceCapabilityProfile = {
  kind: ClusterResourceKind;
  capabilities: readonly ClusterResourceCapability[];
  commands: readonly ClusterCommandType[];
};

export function clusterResourceCapabilityProfile(kind: ClusterResourceKind): ClusterResourceCapabilityProfile {
  const definition = CLUSTER_RESOURCE_MANIFEST[kind];
  return {
    kind,
    capabilities: definition.capabilities,
    commands: clusterCommandsForResource(kind),
  };
}

for (const type of CLUSTER_COMMAND_TYPES) {
  const descriptor = CLUSTER_COMMAND_MANIFEST[type];
  for (const kind of descriptor.resourceKinds) {
    const resource = CLUSTER_RESOURCE_MANIFEST[kind];
    if (!resource) throw new Error(`Command ${type} references unknown resource kind ${kind}.`);
    const requiredCapability = "requiredCapability" in descriptor ? descriptor.requiredCapability : null;
    if (requiredCapability && !resource.capabilities.includes(requiredCapability as never)) {
      throw new Error(`Command ${type} requires capability ${requiredCapability}, but ${kind} does not declare it.`);
    }
  }
}
