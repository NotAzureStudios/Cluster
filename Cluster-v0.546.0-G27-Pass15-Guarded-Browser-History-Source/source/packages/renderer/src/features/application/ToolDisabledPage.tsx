import { ClusterEmptyState } from "../../components/ClusterEmptyState";

export function ToolDisabledPage({ label }: { label: string }) {
  return (
    <section className="page tool-disabled-page-v237 cluster-tool-page-v228">
      <ClusterEmptyState
        kind="restricted"
        icon="tools"
        eyebrow="Tool unavailable"
        title={`${label} is disabled`}
        description="This tool is disabled by the studio's Tool Infrastructure configuration. Existing project data is not deleted when a tool is disabled."
      />
    </section>
  );
}
