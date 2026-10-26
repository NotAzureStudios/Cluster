import { ClusterButton } from "../../components/ClusterButton";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterIcon } from "../../components/ClusterIcon";
import type { ScheduleEditor } from "./time-workspace-model";
import { ClusterModal } from "../../components/ClusterModal";

export function TimeOffDialog({
  value,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  value: ScheduleEditor;
  busy: boolean;
  onChange: (value: ScheduleEditor) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <ClusterModal open onClose={onClose} closeOnEscape={!busy} backdropClassName="time-dialog-backdrop-v212" className="time-dialog-v212" labelledBy="schedule-dialog-title">
        <header>
          <div><span className="time-kicker-v212">Request</span><h2 id="schedule-dialog-title">Time off</h2></div>
          <ClusterButton unstyled type="button" className="time-icon-button-v212" onClick={onClose} aria-label="Close time-off request"><ClusterIcon name="close" /></ClusterButton>
        </header>
        <div className="time-form-grid-v212">
          <label className="time-form-wide-v212">
            <span>Reason</span>
            <ClusterTextInput autoFocus value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} placeholder="Time off" />
          </label>
          <label><span>Starts</span><ClusterTextInput type="datetime-local" value={value.startsAt} onChange={(event) => onChange({ ...value, startsAt: event.target.value })} /></label>
          <label><span>Ends</span><ClusterTextInput type="datetime-local" value={value.endsAt} onChange={(event) => onChange({ ...value, endsAt: event.target.value })} /></label>
          <label className="time-form-wide-v212"><span>Notes</span><ClusterTextArea value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} /></label>
        </div>
        <footer>
          <ClusterButton type="button" className="" onClick={onClose} variant="secondary">Cancel</ClusterButton>
          <ClusterButton type="button" className="" disabled={busy || !value.title.trim()} onClick={onSave} variant="primary">{busy ? "Sending…" : "Submit request"}</ClusterButton>
        </footer>
    </ClusterModal>
  );
}
