import { ClusterSelect } from "../../components/ClusterSelect";
import type { Project } from "../application/application-models";

/** Explicit Ticket destination for Project Control, production and review handoffs.
 * This is a selection helper, never a workflow provisioning service. */
export function ProjectTicketDestinationPicker({ project, value, onChange }: {
  project: Pick<Project, "boards">; value: string; onChange: (next: string) => void;
}) {
  const options = (project.boards || []).flatMap((board) => (board.lists || [])
    .filter((list) => !list.isDone && !list.archived)
    .map((list) => ({ value: `${board.id}:${list.id}`, label: `${board.name} / ${list.title}` })));
  return <div className="project-ticket-destination-v546">
    <ClusterSelect ariaLabel="Ticket destination Board and List" value={options.some((item) => item.value === value) ? value : ""} onChange={onChange}
      options={[{ value: "", label: "Choose Ticket destination" }, ...options]} />
    {!options.length ? <small>No active Project Board/List is configured. Create one in Boards first.</small> : <small>Tickets never create or modify Board columns automatically.</small>}
  </div>;
}
export function projectTicketDestinationIds(value: string): { destinationBoardId: string; destinationListId: string } | null {
  const [destinationBoardId, destinationListId, ...extra] = value.split(":");
  return !extra.length && destinationBoardId && destinationListId ? { destinationBoardId, destinationListId } : null;
}
