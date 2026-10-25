import type { ClusterDataQuery, ClusterMetricDefinition, ClusterMetricReadModel, ClusterMetricRegistrySnapshot } from "@cluster/shared";

export type ClusterDataMetricAdapter = {
  definition: ClusterMetricDefinition;
  authorizeActor: (actorId: string) => Promise<boolean>;
  read: (input: { actorId: string; query: ClusterDataQuery; compare?: { from: string; to: string } | null }) => Promise<ClusterMetricReadModel>;
};

export class ClusterDataMetricRegistry {
  #adapters = new Map<string, ClusterDataMetricAdapter>();

  register(adapter: ClusterDataMetricAdapter) {
    const id = String(adapter.definition.id || "").trim();
    if (!id) throw new Error("Metric definitions require an ID.");
    if (this.#adapters.has(id)) throw new Error(`Metric ${id} is already registered.`);
    this.#adapters.set(id, adapter);
    return this;
  }

  get(id: string) { return this.#adapters.get(id) || null; }
  list() { return [...this.#adapters.values()].map((adapter) => adapter.definition); }
  snapshot(): ClusterMetricRegistrySnapshot { return { schemaVersion: 1, metrics: this.list() }; }
}
