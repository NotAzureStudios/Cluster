import { useMemo, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { api } from "../../core/api";
import type { User } from "../application/application-models";

export type WorkforceAvailabilityException = {
  id: string;
  startsAt: string;
  endsAt: string;
  kind: "unavailable" | "limited" | "preferred" | "time_off" | string;
  status: string;
  reason?: string | null;
  reasonRestricted?: boolean;
  source: string;
};

export type WorkforceAvailabilityPerson = Pick<User, "id" | "username" | "displayName" | "preferredName"> & {
  employment?: { managerUserId?: string | null } | null;
  availabilityExceptions?: WorkforceAvailabilityException[];
};

type AvailabilityKind = "unavailable" | "limited" | "preferred" | "time_off";

type Props = {
  currentUser: User;
  people: WorkforceAvailabilityPerson[];
  canManageAll: boolean;
  onChanged: () => Promise<void>;
  onStatus: (message: string) => void;
};

function personName(person: WorkforceAvailabilityPerson | undefined) {
  return person?.preferredName || person?.displayName || person?.username || "Person";
}

function kindLabel(kind: string) {
  if (kind === "time_off") return "Time off";
  if (kind === "limited") return "Limited";
  if (kind === "preferred") return "Preferred";
  return "Unavailable";
}

function localDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function defaultWindow() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 60 * 60_000);
  return { startsAt: localDateTime(start), endsAt: localDateTime(end) };
}

export function WorkforceAvailabilityExceptions({ currentUser, people, canManageAll, onChanged, onStatus }: Props) {
  const editablePeople = useMemo(() => {
    const allowed = canManageAll
      ? people
      : people.filter((person) => person.id === currentUser.id || person.employment?.managerUserId === currentUser.id);
    const self = allowed.find((person) => person.id === currentUser.id);
    return [...(self ? [self] : []), ...allowed.filter((person) => person.id !== currentUser.id)].filter((person, index, list) => list.findIndex((item) => item.id === person.id) === index);
  }, [canManageAll, currentUser.id, people]);
  const [targetUserId, setTargetUserId] = useState(currentUser.id);
  const [kind, setKind] = useState<AvailabilityKind>("unavailable");
  const initial = useMemo(() => defaultWindow(), []);
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [endsAt, setEndsAt] = useState(initial.endsAt);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const effectiveTargetId = editablePeople.some((person) => person.id === targetUserId) ? targetUserId : currentUser.id;
  const target = people.find((person) => person.id === effectiveTargetId) || people.find((person) => person.id === currentUser.id);
  const exceptions = [...(target?.availabilityExceptions || [])]
    .filter((item) => item.status !== "cancelled")
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  async function createException() {
    if (busy) return;
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (!startsAt || !endsAt || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      onStatus("Availability end must be after start.");
      return;
    }
    setBusy(true);
    onStatus(`Saving ${kindLabel(kind).toLowerCase()} window…`);
    try {
      await api("/api/workforce/availability-exceptions", {
        method: "POST",
        body: JSON.stringify({
          userId: effectiveTargetId,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          kind,
          reason: reason.trim() || null,
          source: effectiveTargetId === currentUser.id ? "self_service" : "manager",
        }),
      });
      setReason("");
      const next = defaultWindow();
      setStartsAt(next.startsAt);
      setEndsAt(next.endsAt);
      await onChanged();
      onStatus(`${kindLabel(kind)} window saved for ${personName(target)}.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Availability window could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelException(item: WorkforceAvailabilityException) {
    if (busy) return;
    setBusy(true);
    onStatus("Cancelling availability window…");
    try {
      await api(`/api/workforce/availability-exceptions/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      await onChanged();
      onStatus(`${kindLabel(item.kind)} window cancelled for ${personName(target)}.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Availability window could not be cancelled.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="people-availability-windows-v16b">
    <header>
      <div><strong>Availability windows</strong><span>These windows feed People, Scheduler, and Calendar planning from the same workforce authority.</span></div>
      {editablePeople.length > 1 ? <label><span>Person</span><ClusterNativeSelect value={effectiveTargetId} onChange={(event) => setTargetUserId(event.target.value)} disabled={busy}>{editablePeople.map((person) => <option key={person.id} value={person.id}>{personName(person)}{person.id === currentUser.id ? " · me" : person.employment?.managerUserId === currentUser.id && !canManageAll ? " · direct report" : ""}</option>)}</ClusterNativeSelect></label> : <span className="muted">{personName(target)}</span>}
    </header>

    <div className="people-availability-composer-v16b">
      <ClusterSegmentedControl className="people-availability-kind-v16b" value={kind} onChange={(value) => setKind(value as AvailabilityKind)} label="Availability window type" options={[
        { value: "unavailable", label: "Unavailable" },
        { value: "limited", label: "Limited" },
        { value: "preferred", label: "Preferred" },
        { value: "time_off", label: "Time off" },
      ]} />
      <label><span>Starts</span><ClusterTextInput type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} disabled={busy} /></label>
      <label><span>Ends</span><ClusterTextInput type="datetime-local" min={startsAt} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} disabled={busy} /></label>
      <label className="reason"><span>Reason / note</span><ClusterTextInput value={reason} maxLength={500} placeholder={kind === "preferred" ? "Why this time works well" : "Optional context"} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label>
      <ClusterButton variant="primary" size="compact" busy={busy} disabled={busy || !startsAt || !endsAt} onClick={() => void createException()}>Add window</ClusterButton>
    </div>

    <div className="people-availability-window-list-v16b">
      {exceptions.length ? exceptions.map((item) => <article key={item.id} data-kind={item.kind}>
        <div className="kind"><strong>{kindLabel(item.kind)}</strong><span>{item.source === "manager" ? "Manager set" : item.source === "self_service" ? "Self set" : item.source}</span></div>
        <div><strong>{new Date(item.startsAt).toLocaleString()} → {new Date(item.endsAt).toLocaleString()}</strong><span>{item.reason || (item.reasonRestricted ? "Reason hidden by privacy policy" : "No note")}</span></div>
        <ClusterButton variant="quiet" size="compact" disabled={busy} onClick={() => void cancelException(item)}>Cancel</ClusterButton>
      </article>) : <div className="people-availability-empty-v16b"><strong>No availability windows</strong><span>Recurring working hours remain authoritative when no exception overrides them.</span></div>}
    </div>
  </section>;
}
