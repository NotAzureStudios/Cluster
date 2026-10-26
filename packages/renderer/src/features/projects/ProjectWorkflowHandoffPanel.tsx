import { ClusterButton } from "../../components/ClusterButton";
import type { ClusterWorkflowRelationship } from "@cluster/shared";
import type { Project, QuickCreateMode } from "../application/application-models";
import { openContextualCreate } from "../create/shared-create-handoff";
import { LinkedWorkPanel } from "../workflow/LinkedWorkPanel";

type HandoffPreset = {
  id: string;
  label: string;
  detail: string;
  mode: QuickCreateMode;
  relationship: ClusterWorkflowRelationship;
};

const HANDOFF_PRESETS: HandoffPreset[] = [
  { id: "card", label: "Card", detail: "Materialize execution work on a project board.", mode: "card", relationship: "parent_of" },
  { id: "ticket", label: "Ticket", detail: "Capture a request, issue, or escalation with traceability.", mode: "ticket", relationship: "parent_of" },
  { id: "timeline", label: "Timeline", detail: "Add a dated milestone or production marker.", mode: "timeline", relationship: "tracks" },
  { id: "calendar", label: "Calendar", detail: "Create a meeting, review, deadline, or launch event.", mode: "calendar", relationship: "scheduled_by" },
  { id: "scheduler", label: "Scheduler", detail: "Reserve accountable working time for the project.", mode: "scheduler", relationship: "scheduled_by" },
];

export function ProjectWorkflowHandoffPanel({
  project,
  canContribute,
  onOpenTimeline,
  onOpenTickets,
  onOpenTime,
}: {
  project: Project;
  canContribute: boolean;
  onOpenTimeline: () => void;
  onOpenTickets: () => void;
  onOpenTime: () => void;
}) {
  const source = { kind: "project" as const, id: project.id, projectId: project.id, label: project.name };

  function createRelated(preset: HandoffPreset) {
    openContextualCreate(preset.mode, {
      projectId: project.id,
      source,
      relationship: preset.relationship,
      openOnComplete: true,
    });
  }

  return (
    <section className="project-workflow-handoff-v495 panel" aria-label="Project workflow handoffs">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Cross-tool workflow</p>
          <h2>Materialize and schedule work</h2>
          <p className="muted tight">Create project-bound work without losing its origin. Handoffs are durable workflow links, so removing a relationship never deletes the linked Card, Ticket, Timeline item, event, or schedule block.</p>
        </div>
        <div className="project-workflow-handoff-open-v495">
          <ClusterButton size="compact" variant="quiet" onClick={onOpenTickets}>Tickets</ClusterButton>
          <ClusterButton size="compact" variant="quiet" onClick={onOpenTimeline}>Timeline</ClusterButton>
          <ClusterButton size="compact" variant="quiet" onClick={onOpenTime}>Scheduler</ClusterButton>
        </div>
      </div>
      <div className="project-workflow-handoff-grid-v495">
        {HANDOFF_PRESETS.map((preset) => (
          <article key={preset.id}>
            <div><strong>{preset.label}</strong><span>{preset.detail}</span></div>
            <ClusterButton size="compact" variant="secondary" disabled={!canContribute} onClick={() => createRelated(preset)}>Create linked {preset.label.toLowerCase()}</ClusterButton>
          </article>
        ))}
      </div>
      <LinkedWorkPanel projectId={project.id} kind="project" entityId={project.id} compact title="Project handoffs" />
    </section>
  );
}
