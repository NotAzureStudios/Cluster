import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterModal } from "../../components/ClusterModal";
import { ClusterInput } from "../../components/ClusterNativeControls";

export type PlanningUser = { id: string; username: string; displayName?: string | null };
export type PlanningProject = { id: string; name: string; archived?: boolean; projectType?: string | null };
export type PlanningResource = {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  location?: string | null;
  quantityTotal: number;
  status: string;
  tags: string[];
  projectTypeIds: string[];
  color?: string | null;
  revision: number;
};
export type PlanningCalendarEvent = {
  id: string;
  projectId?: string | null;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  status: string;
  eventType: string;
  ownerId?: string | null;
  attendeeIds: string[];
  scheduled?: boolean;
};
export type PlanningConflict = {
  kind: "person" | "resource";
  severity: "medium" | "high";
  message: string;
  blockId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  userId?: string;
  resourceId?: string;
  requestedQuantity?: number;
  reservedQuantity?: number;
  capacity?: number;
};
export type PlanningAvailabilitySignal = {
  kind: "preferred";
  userId: string;
  startsAt: string;
  endsAt: string;
  title: string;
  message: string;
};
export type ProductionWindowDraft = {
  title: string;
  description: string;
  userId: string;
  projectId: string;
  startsAt: string;
  endsAt: string;
  type: string;
  windowKind: string;
  status: string;
  participantIds: string[];
  resources: Array<{ resourceId: string; quantity: number }>;
  calendarMirror: boolean;
  calendarEventId?: string | null;
  color: string;
  timezone: string;
  recurrenceFrequency: "" | "daily" | "weekly";
  recurrenceOccurrences: number;
  expectedRevision?: number;
};

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function SchedulePlanningDialog({
  value,
  users,
  projects,
  resources,
  conflicts,
  availabilitySignals,
  busy,
  onChange,
  onClose,
  onCheck,
  onSave,
  editingScope,
}: {
  value: ProductionWindowDraft;
  users: PlanningUser[];
  projects: PlanningProject[];
  resources: PlanningResource[];
  conflicts: PlanningConflict[];
  availabilitySignals: PlanningAvailabilitySignal[];
  busy: boolean;
  onChange: (value: ProductionWindowDraft) => void;
  onClose: () => void;
  onCheck: () => void;
  onSave: (allowConflicts?: boolean) => void;
  editingScope?: "single" | "future" | null;
}) {
  const availabilityIncomplete = conflicts.some((item) => item.blockId === "calendar-virtual:incomplete");
  const project = projects.find((item) => item.id === value.projectId);
  const projectType = String(project?.projectType || "");
  const sortedResources = [...resources].sort((a, b) => {
    const ar = !a.projectTypeIds.length || (projectType && a.projectTypeIds.includes(projectType)) ? 0 : 1;
    const br = !b.projectTypeIds.length || (projectType && b.projectTypeIds.includes(projectType)) ? 0 : 1;
    return ar - br || a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
  });

  return <ClusterModal open onClose={onClose} backdropClassName="time-dialog-backdrop-v212 time-planning-backdrop-v496" className="time-planning-dialog-v496" labelledBy="production-window-title" describedBy="production-window-timezone-help">
      <header className="time-planning-dialog-header-v496">
        <div><span className="time-kicker-v212">Production planning</span><h2 id="production-window-title">Plan a window</h2></div>
        <ClusterButton unstyled type="button" className="time-icon-button-v212" onClick={onClose} aria-label="Close production planner"><ClusterIcon name="close" /></ClusterButton>
      </header>

      <div className="time-planning-form-v496">
        <label className="wide"><span>Title</span><ClusterTextInput autoFocus value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} placeholder="Shoot, review, delivery…" /></label>
        <label><span>Project</span><ClusterSelect ariaLabel="Production project" value={value.projectId} onChange={(projectId) => onChange({ ...value, projectId })} options={[{ value: "", label: "Studio / unassigned" }, ...projects.filter((item) => !item.archived).map((item) => ({ value: item.id, label: item.name }))]} /></label>
        <label><span>Lead</span><ClusterSelect ariaLabel="Production lead" value={value.userId} onChange={(userId) => onChange({ ...value, userId, participantIds: value.participantIds.filter((id) => id !== userId) })} options={users.map((user) => ({ value: user.id, label: user.displayName || user.username }))} /></label>
        <label><span>Window</span><ClusterSelect ariaLabel="Production window kind" value={value.windowKind} onChange={(windowKind) => onChange({ ...value, windowKind })} options={[{ value: "standard", label: "Standard" }, { value: "shoot", label: "Shoot" }, { value: "review", label: "Review" }, { value: "release", label: "Release" }, { value: "delivery", label: "Delivery" }, { value: "maintenance", label: "Maintenance" }]} /></label>
        <label><span>Status</span><ClusterSelect ariaLabel="Production window status" value={value.status} onChange={(status) => onChange({ ...value, status })} options={[{ value: "confirmed", label: "Confirmed" }, { value: "tentative", label: "Tentative" }, { value: "cancelled", label: "Cancelled" }]} /></label>
        <label><span>Starts</span><ClusterTextInput type="datetime-local" value={value.startsAt} onChange={(event) => onChange({ ...value, startsAt: event.target.value })} /></label>
        <label><span>Ends</span><ClusterTextInput type="datetime-local" value={value.endsAt} onChange={(event) => onChange({ ...value, endsAt: event.target.value })} /></label>
        {editingScope ? <div className="wide"><span>Series edit</span><small>{editingScope === "future" ? "This change applies to this occurrence and the remaining series. The existing recurrence cadence is preserved." : "This change applies only to this occurrence."}</small></div> : <>
          <label><span>Repeats</span><ClusterSelect ariaLabel="Production recurrence" value={value.recurrenceFrequency} onChange={(recurrenceFrequency) => onChange({ ...value, recurrenceFrequency: recurrenceFrequency as ProductionWindowDraft["recurrenceFrequency"] })} options={[{ value: "", label: "Does not repeat" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]} /></label>
          <label><span>Occurrences</span><ClusterTextInput type="number" min={2} max={12} disabled={!value.recurrenceFrequency} value={value.recurrenceOccurrences} onChange={(event) => onChange({ ...value, recurrenceOccurrences: Math.max(2, Math.min(12, Number(event.target.value || 2))) })} /></label>
        </>}
        <label className="wide"><span>Timezone</span><ClusterTextInput value={value.timezone} onChange={(event) => onChange({ ...value, timezone: event.target.value })} aria-describedby="production-window-timezone-help" /><small id="production-window-timezone-help">Recurring windows preserve this local wall-clock time across daylight-saving changes.</small></label>
        <label className="wide"><span>Notes</span><ClusterTextArea value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} /></label>
      </div>

      <div className="time-planning-columns-v496">
        <section>
          <header><div><strong>Crew</strong><span>{value.participantIds.length} additional</span></div></header>
          <div className="time-planning-checklist-v496">
            {users.filter((user) => user.id !== value.userId).map((user) => <label key={user.id}><ClusterInput type="checkbox" checked={value.participantIds.includes(user.id)} onChange={() => onChange({ ...value, participantIds: toggle(value.participantIds, user.id) })} /><span>{user.displayName || user.username}</span></label>)}
          </div>
        </section>
        <section>
          <header><div><strong>Resources</strong><span>{value.resources.length} reserved</span></div></header>
          <div className="time-planning-resource-list-v496">
            {sortedResources.map((resource) => {
              const reservation = value.resources.find((item) => item.resourceId === resource.id);
              const recommended = !resource.projectTypeIds.length || Boolean(projectType && resource.projectTypeIds.includes(projectType));
              return <article key={resource.id} className={resource.status !== "active" ? "is-unavailable" : ""}>
                <label><ClusterInput type="checkbox" disabled={resource.status !== "active"} checked={Boolean(reservation)} onChange={() => onChange({ ...value, resources: reservation ? value.resources.filter((item) => item.resourceId !== resource.id) : [...value.resources, { resourceId: resource.id, quantity: 1 }] })} /><span><strong>{resource.name}</strong><small>{resource.type}{resource.location ? ` · ${resource.location}` : ""}{recommended ? " · recommended" : ""}</small></span></label>
                {reservation && resource.quantityTotal > 1 ? <ClusterTextInput aria-label={`${resource.name} quantity`} type="number" min={1} max={resource.quantityTotal} value={reservation.quantity} onChange={(event) => onChange({ ...value, resources: value.resources.map((item) => item.resourceId === resource.id ? { ...item, quantity: Math.max(1, Math.min(resource.quantityTotal, Number(event.target.value || 1))) } : item) })} /> : null}
              </article>;
            })}
            {!resources.length && <p className="time-clear-state-v212">No reservable resources configured.</p>}
          </div>
        </section>
      </div>

      <label className="time-planning-calendar-v496"><ClusterInput type="checkbox" checked={value.calendarMirror} onChange={(event) => onChange({ ...value, calendarMirror: event.target.checked })} /><span><strong>{value.calendarEventId ? "Keep Calendar link" : "Mirror to Calendar"}</strong><small>{value.calendarEventId ? "Keep this production window linked to its existing Calendar event." : "Create a matching Calendar event for this production window."}</small></span></label>

      {conflicts.length ? <section className="time-planning-conflicts-v496" aria-live="polite"><header><strong>{availabilityIncomplete ? "Availability not verified" : `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}`}</strong><span>{availabilityIncomplete ? "The server cannot confirm this slot. Adjust the window or review recurrence load before saving." : "Review before placing."}</span></header>{conflicts.slice(0, 8).map((conflict, index) => <article key={`${conflict.blockId}-${index}`} className={conflict.severity}><strong>{conflict.kind === "resource" ? "Resource conflict" : "Crew conflict"}</strong><span>{conflict.message}{conflict.kind === "resource" && Number.isFinite(conflict.capacity) && conflict.requestedQuantity != null && conflict.reservedQuantity != null
                  ? ` · ${conflict.reservedQuantity} reserved + ${conflict.requestedQuantity} requested / ${conflict.capacity} capacity` : ""}</span></article>)}</section> : null}
      {availabilitySignals.length ? <section className="time-planning-readiness-v16b" aria-live="polite"><header><strong>{availabilitySignals.length} preferred match{availabilitySignals.length === 1 ? "" : "es"}</strong><span>Positive availability signal.</span></header>{availabilitySignals.slice(0, 8).map((signal, index) => <article key={`${signal.userId}-${signal.startsAt}-${index}`}><strong>{signal.title}</strong><span>{signal.message}</span></article>)}</section> : null}

      <footer className="time-planning-actions-v496">
        <ClusterButton type="button" className="" onClick={onClose} variant="secondary">Cancel</ClusterButton>
        <ClusterButton type="button" className="" disabled={busy} onClick={onCheck} variant="secondary">Check availability</ClusterButton>
        {conflicts.length && !availabilityIncomplete ? <ClusterButton type="button" className="" disabled={busy || !value.title.trim()} onClick={() => onSave(true)} variant="danger">Place anyway</ClusterButton> : null}
        <ClusterButton type="button" className="" disabled={busy || availabilityIncomplete || !value.title.trim() || !value.userId} onClick={() => onSave(false)} variant="primary">{busy ? "Saving…" : value.calendarEventId ? "Place event" : "Plan window"}</ClusterButton>
      </footer>
  </ClusterModal>;
}
