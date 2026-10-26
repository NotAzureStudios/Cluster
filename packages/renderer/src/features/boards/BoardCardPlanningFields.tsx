import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterButton } from "../../components/ClusterButton";
import { useRef, useState } from "react";
import type { UserActivitySummary } from "../application/application-models";
import { runtimeStyle } from "../../core/runtime-style";
import { ColorField } from "../../components/ColorField";
import { ClusterInput } from "../../components/ClusterNativeControls";

const CARD_COVER_MAX_EDGE = 1400;
const CARD_COVER_MAX_BYTES = 10 * 1024 * 1024;

async function optimizeCover(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > CARD_COVER_MAX_BYTES) throw new Error("Cover images must be smaller than 10 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, CARD_COVER_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare the cover image.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let result = canvas.toDataURL("image/webp", 0.82);
  if (result.length > 2_400_000) result = canvas.toDataURL("image/webp", 0.62);
  if (result.length > 2_400_000) throw new Error("This cover is still too large after optimization. Choose a smaller image.");
  return result;
}

export type BoardCardPlanningFieldsProps = {
  category: string;
  onCategoryChange: (value: string) => void;
  startDate: string;
  onStartDateChange: (value: string) => void;
  dueDate: string;
  onDueDateChange: (value: string) => void;
  deferredUntil: string;
  onDeferredUntilChange: (value: string) => void;
  completionCriteria: string;
  onCompletionCriteriaChange: (value: string) => void;
  estimatePoints: string;
  onEstimatePointsChange: (value: string) => void;
  coverColor: string;
  onCoverColorChange: (value: string) => void;
  coverImage: string;
  onCoverImageChange: (value: string) => void;
  memberIds: string[];
  onMemberIdsChange: (value: string[]) => void;
  watching: boolean;
  onWatchingChange: (value: boolean) => void;
  users: UserActivitySummary[];
};

export function BoardCardPlanningFields(props: BoardCardPlanningFieldsProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [coverError, setCoverError] = useState("");
  const toggleMember = (id: string) => props.onMemberIdsChange(props.memberIds.includes(id) ? props.memberIds.filter((memberId) => memberId !== id) : [...props.memberIds, id]);
  async function loadCover(file?: File) {
    if (!file) return;
    setCoverError("");
    try {
      props.onCoverImageChange(await optimizeCover(file));
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : "Cover image could not be loaded.");
    }
  }
  return (
    <section className="card-planning-fields-v300 span-2">
      <div className="card-planning-heading-v300">
        <div>
          <h3>Planning and presentation</h3>
          <p>Use categories, dates, points, members, and a cover to make the card readable without opening it.</p>
        </div>
        <label className="card-watch-toggle-v300">
          <ClusterInput type="checkbox" checked={props.watching} onChange={(event) => props.onWatchingChange(event.target.checked)} />
          Watch updates
        </label>
      </div>
      <div className="card-planning-grid-v300">
        <div className="field">
          <label>Category</label>
          <ClusterTextInput value={props.category} onChange={(event) => props.onCategoryChange(event.target.value)} placeholder="Gameplay, Art, Release…" maxLength={80} />
        </div>
        <div className="field">
          <label>Estimate</label>
          <ClusterTextInput type="number" min="0" max="999" value={props.estimatePoints} onChange={(event) => props.onEstimatePointsChange(event.target.value)} placeholder="Points or hours" />
        </div>
        <div className="field">
          <label>Start date</label>
          <ClusterTextInput type="date" value={props.startDate} onChange={(event) => props.onStartDateChange(event.target.value)} />
        </div>
        <div className="field">
          <label>Due date</label>
          <ClusterTextInput type="date" value={props.dueDate} onChange={(event) => props.onDueDateChange(event.target.value)} />
        </div>
        <div className="field">
          <label>Defer until</label>
          <ClusterTextInput type="date" value={props.deferredUntil} onChange={(event) => props.onDeferredUntilChange(event.target.value)} />
          <small className="muted">Deferred Cards stay visible but are excluded from active WIP/capacity pressure until this date.</small>
        </div>
        <div className="card-cover-color-v300">
          <ColorField value={props.coverColor || "#3b82f6"} onChange={props.onCoverColorChange} label="Cover color" />
          <ClusterButton className="" type="button" onClick={() => props.onCoverColorChange("")} disabled={!props.coverColor} variant="quiet" size="compact">Clear cover color</ClusterButton>
        </div>
        <div className="field">
          <label>Cover image</label>
          <div className="button-row">
            <ClusterButton className="" type="button" onClick={() => inputRef.current?.click()} variant="secondary" size="compact">Choose image</ClusterButton>
            <ClusterButton className="" type="button" onClick={() => props.onCoverImageChange("")} disabled={!props.coverImage} variant="quiet" size="compact">Remove</ClusterButton>
          </div>
          <input ref={inputRef} hidden type="file" accept="image/*" onChange={(event) => void loadCover(event.target.files?.[0])} />
          {coverError && <span className="field-error-v300">{coverError}</span>}
        </div>
      </div>
      <div className="field span-2">
        <label>Completion criteria</label>
        <ClusterTextArea value={props.completionCriteria} onChange={(event) => props.onCompletionCriteriaChange(event.target.value)} placeholder="What must be true before this Card is actually done?" maxLength={4000} rows={3} />
      </div>
      {(props.coverImage || props.coverColor) && <div className="card-cover-preview-v300" style={runtimeStyle({ backgroundColor: props.coverColor || undefined, backgroundImage: props.coverImage ? `url(${props.coverImage})` : undefined })} />}
      <div className="field card-member-picker-v300">
        <label>Members</label>
        <div className="card-member-grid-v300">
          {props.users.map((member) => {
            const selected = props.memberIds.includes(member.id);
            return <ClusterButton unstyled type="button" key={member.id} className={selected ? "selected" : ""} onClick={() => toggleMember(member.id)} aria-pressed={selected}><span>{(member.displayName || member.username || "?").slice(0, 1).toUpperCase()}</span>{member.displayName || member.username}</ClusterButton>;
          })}
          {!props.users.length && <p className="muted tight">No active users are available.</p>}
        </div>
      </div>
    </section>
  );
}
