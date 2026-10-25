import { ProjectTicketDestinationPicker, projectTicketDestinationIds } from "./ProjectTicketDestinationPicker";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterFileButton } from "../../components/ClusterFileButton";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { confirmCluster, promptCluster } from "../../components/cluster-dialog-service";
import { api, API_URL, uploadApi } from "../../core/api";
import { formatRelativeTime } from "../../core/format";
import { runtimeStyle } from "../../core/runtime-style";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { displayUserName } from "../people/people-utils";
import { PeopleMultiPicker } from "../people/PeoplePicker";
import type { BuildArtifactRecord, Project, ProjectMediaPayload, QASessionRecord, User, ReviewAsset, ReviewComment, VideoNoteCategory, VideoPool, VideoPriority, VideoProductionRecord, VideoProductionRecordKind, VideoStatus } from "../application/application-models";
import { UnifiedVideoViewer, type UnifiedVideoViewerHandle } from "../viewer";
import { ProjectSectionHeader, ProjectSectionStatus } from "./ProjectWorkspacePrimitives";
import { ProjectProductionEvidenceBar } from "./ProjectProductionEvidenceBar";
import { summarizeProjectProductionEvidence, type ProductionEvidenceGate } from "./project-production-readiness";
import { buildVideoReviewHierarchy, videoVersionKey } from "./video-review-hierarchy";
import { ClusterInput } from "../../components/ClusterNativeControls";
import {
  patchProjectMediaJob,
  patchProjectMediaWorker,
  patchProjectVideoComment,
  patchProjectVideoProcessingState,
  removeProjectVideoAsset,
  upsertProjectMediaPolicy,
  upsertProjectProductionRecord,
  upsertProjectVideoAsset,
  upsertProjectVideoComment,
} from "./project-media-state";

import { ClusterResizableSplit } from "../../components/ClusterResizableSplit";

const VIDEO_STATUS_OPTIONS: Array<{ value: VideoStatus; label: string }> = [
  { value: "intake", label: "Intake" }, { value: "editing", label: "Editing" }, { value: "review", label: "Review" },
  { value: "changes", label: "Changes" }, { value: "approved", label: "Approved" }, { value: "published", label: "Published" }, { value: "archived", label: "Archived" },
];
const VIDEO_NOTE_CATEGORIES: Array<{ value: VideoNoteCategory; label: string }> = [
  { value: "edit", label: "Edit" }, { value: "audio", label: "Audio" }, { value: "graphics", label: "Graphics" },
  { value: "caption", label: "Captions" }, { value: "color", label: "Color" }, { value: "gameplay", label: "Gameplay" }, { value: "approval", label: "Approval" },
];
const VIDEO_PRIORITY_OPTIONS: Array<{ value: VideoPriority; label: string }> = [
  { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" },
];
const ASSET_KIND_OPTIONS = [
  { value: "source", label: "Source" }, { value: "proxy", label: "Proxy" }, { value: "review", label: "Review cut" }, { value: "master", label: "Master" }, { value: "reference", label: "Reference" },
];
const VIDEO_NOTE_RENDER_BATCH = 120;
const VIDEO_HISTORY_RENDER_BATCH = 60;
const VIDEO_RECORD_RENDER_BATCH = 120;
const PRODUCTION_KIND_OPTIONS: Array<{ value: VideoProductionRecordKind; label: string }> = [
  { value: "episode", label: "Episode" }, { value: "sequence", label: "Sequence" }, { value: "scene", label: "Scene" }, { value: "shot", label: "Shot" }, { value: "take", label: "Take" },
];
const statusLabel = (status?: string | null) => VIDEO_STATUS_OPTIONS.find((option) => option.value === status)?.label || "Review";
const statusTone = (status?: string | null) => status === "approved" || status === "published" ? "good" : status === "changes" || status === "urgent" ? "danger" : status === "editing" || status === "review" ? "warning" : status === "archived" ? "muted" : "neutral";
const poolLabel = (pool?: string | null) => pool === "raw" ? "Raw" : pool === "edited" ? "Edit" : pool === "final" ? "Final" : "Video";
const openNotes = (video: ReviewAsset) => (video.comments || []).filter((comment) => (comment.status || "open") !== "resolved").length;
const recordLabel = (kind?: string) => String(kind || "item").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

function mediaLocator(comment: ReviewComment) {
  return comment.locator.type === "media_time" ? comment.locator : null;
}
function noteStart(comment: ReviewComment) { return Number(mediaLocator(comment)?.timeSeconds || 0); }

function nextVersionNumber(videos: ReviewAsset[], selected?: ReviewAsset | null) {
  if (!selected) return 1;
  const key = videoVersionKey(selected);
  return Math.max(0, ...videos.filter((video) => videoVersionKey(video) === key).map((video) => Number(video.versionNumber || 1))) + 1;
}

type Props = {
  project: Project;
  media: ProjectMediaPayload;
  users: User[];
  videoEnabled: boolean;
  buildArtifacts: BuildArtifactRecord[];
  qaSessions: QASessionRecord[];
  onOpenBuilds?: () => void;
  onOpenQa?: () => void;
  canContribute: boolean;
  canManage: boolean;
  isAdmin: boolean;
  userId: string;
  status: string;
  onStatusChange: (value: string) => void;
  onMediaChange: (update: ProjectMediaPayload | ((current: ProjectMediaPayload) => ProjectMediaPayload)) => void;
  onRevalidate: () => Promise<void>;
  parseTimecode: (value: string) => number;
  secondsToTimecode: (value?: number | null) => string;
  bytesToSize: (value?: number | null) => string;
  videoAssetUrl: (video: ReviewAsset) => string;
};

export function ProjectVideoWorkspace({ project, media, users, videoEnabled, buildArtifacts, qaSessions, onOpenBuilds, onOpenQa, canContribute, canManage, isAdmin, userId, status, onStatusChange, onMediaChange, onRevalidate, parseTimecode, secondsToTimecode, bytesToSize, videoAssetUrl }: Props) {
  const videoViewerRef = useRef<UnifiedVideoViewerHandle | null>(null);
  const revalidateTimerRef = useRef<number | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<"review" | "production" | "deliverables">("review");
  const [ticketDestination, setTicketDestination] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [compareVideoId, setCompareVideoId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentTime, setCommentTime] = useState("0:00");
  const [commentEndTime, setCommentEndTime] = useState("");
  const [commentAssigneeId, setCommentAssigneeId] = useState("");
  const [uploadPool, setUploadPool] = useState<VideoPool>("raw");
  const [uploadStatus, setUploadStatus] = useState<VideoStatus>("intake");
  const [uploadAssetKind, setUploadAssetKind] = useState("source");
  const [uploadAsVersion, setUploadAsVersion] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | VideoStatus>("all");
  const [noteFilter, setNoteFilter] = useState<"open" | "all" | "resolved">("open");
  const [noteCategory, setNoteCategory] = useState<VideoNoteCategory>("edit");
  const [notePriority, setNotePriority] = useState<VideoPriority>("medium");
  const [productionKind, setProductionKind] = useState<VideoProductionRecordKind>("shot");
  const [productionTitle, setProductionTitle] = useState("");
  const [productionParentId, setProductionParentId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionAt, setSessionAt] = useState("");
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState("60");
  const [sessionAttendeeIds, setSessionAttendeeIds] = useState<string[]>([]);
  const [sessionAgenda, setSessionAgenda] = useState("");
  const [deliverableTitle, setDeliverableTitle] = useState("");
  const [deliverableDue, setDeliverableDue] = useState("");
  const [deliverableFormat, setDeliverableFormat] = useState("1920x1080 · H.264");
  const [processingAcceleration, setProcessingAcceleration] = useState("auto");
  const [noteRenderLimit, setNoteRenderLimit] = useState(VIDEO_NOTE_RENDER_BATCH);
  const [historyRenderLimit, setHistoryRenderLimit] = useState(VIDEO_HISTORY_RENDER_BATCH);
  const [historyScope, setHistoryScope] = useState<"round" | "family">("round");
  const [productionRenderLimit, setProductionRenderLimit] = useState(VIDEO_RECORD_RENDER_BATCH);
  const [sessionRenderLimit, setSessionRenderLimit] = useState(VIDEO_RECORD_RENDER_BATCH);
  const [deliverableRenderLimit, setDeliverableRenderLimit] = useState(VIDEO_RECORD_RENDER_BATCH);
  const selectedVideo = media.reviewAssets.find((item) => item.id === selectedVideoId) || media.reviewAssets[0] || null;
  const compareVideo = media.reviewAssets.find((item) => item.id === compareVideoId) || null;
  const [meta, setMeta] = useState({ title: "", description: "", pool: "raw" as VideoPool, status: "review" as VideoStatus, versionLabel: "", reviewRound: "", assetKind: "source", platform: "", dueDate: "", reviewerId: "", frameRate: "30", codec: "" });

  useEffect(() => { setSelectedVideoId((current) => current && media.reviewAssets.some((item) => item.id === current) ? current : media.reviewAssets[0]?.id || null); }, [media.reviewAssets]);
  useEffect(() => {
    if (!selectedVideo) { setMeta({ title: "", description: "", pool: "raw", status: "review", versionLabel: "", reviewRound: "", assetKind: "source", platform: "", dueDate: "", reviewerId: "", frameRate: "30", codec: "" }); return; }
    setMeta({ title: selectedVideo.title || "", description: selectedVideo.description || "", pool: selectedVideo.pool === "edited" || selectedVideo.pool === "final" ? selectedVideo.pool : "raw", status: VIDEO_STATUS_OPTIONS.some((option) => option.value === selectedVideo.status) ? selectedVideo.status as VideoStatus : "review", versionLabel: selectedVideo.versionLabel || "", reviewRound: selectedVideo.reviewRound || "", assetKind: selectedVideo.assetKind || "source", platform: selectedVideo.platform || "", dueDate: selectedVideo.dueDate?.slice(0, 10) || "", reviewerId: selectedVideo.reviewerId || "", frameRate: String(selectedVideo.frameRate || 30), codec: selectedVideo.codec || "" });
  }, [selectedVideo?.id, selectedVideo?.updatedAt]);
  useEffect(() => { if (compareVideoId && (!selectedVideo || compareVideoId === selectedVideo.id || !media.reviewAssets.some((item) => item.id === compareVideoId))) setCompareVideoId(""); }, [compareVideoId, media.reviewAssets, selectedVideo?.id]);
  useEffect(() => { setNoteRenderLimit(VIDEO_NOTE_RENDER_BATCH); setHistoryRenderLimit(VIDEO_HISTORY_RENDER_BATCH); }, [selectedVideo?.id, noteFilter, historyScope]);
  useEffect(() => { setProductionRenderLimit(VIDEO_RECORD_RENDER_BATCH); setSessionRenderLimit(VIDEO_RECORD_RENDER_BATCH); setDeliverableRenderLimit(VIDEO_RECORD_RENDER_BATCH); }, [project.id, workspaceMode]);

  useEffect(() => () => {
    if (revalidateTimerRef.current !== null && typeof window !== "undefined") window.clearTimeout(revalidateTimerRef.current);
  }, []);

  function scheduleMediaRevalidation(delayMs = 240) {
    if (typeof window === "undefined") { void onRevalidate().catch(() => undefined); return; }
    if (revalidateTimerRef.current !== null) window.clearTimeout(revalidateTimerRef.current);
    revalidateTimerRef.current = window.setTimeout(() => {
      revalidateTimerRef.current = null;
      void onRevalidate().catch(() => undefined);
    }, delayMs);
  }

  const filtered = useMemo(() => media.reviewAssets.filter((video) => statusFilter === "all" || (video.status || "review") === statusFilter), [media.reviewAssets, statusFilter]);
  const pools = { raw: filtered.filter((video) => video.pool === "raw"), edited: filtered.filter((video) => video.pool === "edited"), final: filtered.filter((video) => video.pool === "final") };
  const openNoteCount = media.production?.summary.openNotes ?? media.reviewAssets.reduce((sum, video) => sum + openNotes(video), 0);
  const selectedNotes = selectedVideo ? (selectedVideo.comments || []).filter((comment) => noteFilter === "all" || (noteFilter === "open" ? (comment.status || "open") !== "resolved" : comment.status === "resolved")) : [];
  const visibleSelectedNotes = selectedNotes.slice(0, noteRenderLimit);
  const dueSoon = media.reviewAssets.filter((video) => video.dueDate && new Date(video.dueDate).getTime() < Date.now() + 604800000 && !["published", "archived"].includes(video.status || "review")).length;
  const productionRecords = media.production?.records || [];
  const productionUnits = productionRecords.filter((record) => !["review_session", "deliverable", "media_job"].includes(record.kind));
  const reviewSessions = productionRecords.filter((record) => record.kind === "review_session");
  const deliverables = productionRecords.filter((record) => record.kind === "deliverable");
  const visibleProductionUnits = productionUnits.slice(0, productionRenderLimit);
  const visibleReviewSessions = reviewSessions.slice(0, sessionRenderLimit);
  const visibleDeliverables = deliverables.slice(0, deliverableRenderLimit);
  const mediaProcessing = media.mediaProcessing;
  const mediaJobs = (media.production?.records || []).filter((record) => record.kind === "media_job");
  const deliveryEvidence = useMemo(() => summarizeProjectProductionEvidence({ videos: media.reviewAssets, productionRecords, buildArtifacts, qaSessions }), [media.reviewAssets, productionRecords, buildArtifacts, qaSessions]);
  const videoDeliveryGates = useMemo(() => deliveryEvidence.gates.filter((gate: ProductionEvidenceGate) => gate.id !== "build" && gate.id !== "qa"), [deliveryEvidence.gates]);
  const videoDeliveryReady = videoDeliveryGates.filter((gate: ProductionEvidenceGate) => gate.ready).length;
  const videoDeliveryBlockers = videoDeliveryGates.filter((gate: ProductionEvidenceGate) => gate.tone === "danger").length;
  const unresolvedReviewNotes = useMemo(() => selectedVideo ? (selectedVideo.comments || []).filter((comment) => (comment.status || "open") !== "resolved").slice().sort((left, right) => noteStart(left) - noteStart(right)) : [], [selectedVideo]);
  const hasActiveMediaJobs = mediaJobs.some((record) => ["queued", "processing", "retrying"].includes(record.status));
  useVisibleRefresh(() => onRevalidate(), { enabled: hasActiveMediaJobs, intervalMs: 8_000 });
  const onlineWorkers = mediaProcessing?.workers.filter((worker) => worker.online) || [];
  const selectedArtifacts = selectedVideo ? (mediaProcessing?.artifacts || []).filter((artifact) => artifact.reviewAssetId === selectedVideo.id) : [];
  const reviewHierarchy = useMemo(() => buildVideoReviewHierarchy(media.reviewAssets, selectedVideo), [media.reviewAssets, selectedVideo?.id]);
  const versionFamily = reviewHierarchy.family;
  const reviewHistory = historyScope === "round" && reviewHierarchy.currentRound ? reviewHierarchy.currentRound.videos : versionFamily;
  const visibleReviewHistory = reviewHistory.slice(0, historyRenderLimit);
  const previousVersion = reviewHierarchy.previousVersion;
  const lineageParent = selectedVideo ? media.reviewAssets.find((video) => video.id === (selectedVideo.derivedFromId || selectedVideo.proxyOfId)) || null : null;

  function seekTo(seconds: number) { videoViewerRef.current?.seek(seconds); }
  function captureTime(target: "start" | "end" = "start") {
    const value = secondsToTimecode(videoViewerRef.current?.getCurrentTime() || 0);
    if (target === "start") setCommentTime(value); else setCommentEndTime(value);
  }
  function jumpReviewNote(direction: -1 | 1) {
    if (!unresolvedReviewNotes.length) return;
    const now = videoViewerRef.current?.getCurrentTime() || 0;
    const target = direction > 0
      ? unresolvedReviewNotes.find((comment) => noteStart(comment) > now + 0.05) || unresolvedReviewNotes[0]
      : unresolvedReviewNotes.slice().reverse().find((comment) => noteStart(comment) < now - 0.05) || unresolvedReviewNotes[unresolvedReviewNotes.length - 1];
    if (target) seekTo(noteStart(target));
  }

  async function uploadVideo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || !canContribute || uploadingVideo) return;
    if (!file.type.startsWith("video/")) { onStatusChange("Choose a video file."); return; }
    const versionNumber = uploadAsVersion && selectedVideo ? nextVersionNumber(media.reviewAssets, selectedVideo) : 1;
    setUploadingVideo(true);
    onStatusChange(`Uploading ${file.name}...`);
    try {
      const upload = await uploadApi<ReviewAsset>(`/api/projects/${project.id}/review-assets`, { file, label: `Upload video ${file.name}`, body: { medium: "video", title: uploadAsVersion && selectedVideo ? selectedVideo.title : file.name.replace(/\.[^.]+$/, ""), originalName: file.name, mimeType: file.type || "video/mp4", sizeBytes: file.size, pool: uploadPool, status: uploadStatus, assetKind: uploadAssetKind, versionGroupId: uploadAsVersion && selectedVideo ? videoVersionKey(selectedVideo) : null, versionNumber, versionLabel: uploadAsVersion ? `v${versionNumber}` : uploadPool === "raw" ? "Raw" : "v1", reviewRound: uploadAsVersion ? selectedVideo?.reviewRound || "Review" : null, derivedFromId: uploadAsVersion && selectedVideo ? selectedVideo.id : null, processingState: "idle" }, invalidate: [`/api/projects/${project.id}/media`] });
      if (upload.queued) {
        onStatusChange("Video stored on this device and queued for upload.");
      } else if (upload.result) {
        onMediaChange((current) => upsertProjectVideoAsset(current, upload.result!));
        setSelectedVideoId(upload.result.id);
        scheduleMediaRevalidation();
        onStatusChange(uploadAsVersion ? `Version ${versionNumber} uploaded.` : "Video uploaded.");
      }
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Video upload failed.");
    } finally {
      setUploadingVideo(false);
    }
  }
  async function updateAsset(assetId: string, patch: Partial<ReviewAsset>) {
    if (!canManage) return;
    const updated = await api<ReviewAsset>(`/api/review-assets/${assetId}`, { method: "PATCH", body: JSON.stringify(patch) });
    onMediaChange((current) => upsertProjectVideoAsset(current, updated));
  }
  async function addComment() {
    if (!selectedVideo || !commentBody.trim() || !canContribute) return;
    const start = parseTimecode(commentTime); const rawEnd = commentEndTime.trim() ? parseTimecode(commentEndTime) : null;
    const end = rawEnd != null && rawEnd > start ? rawEnd : null;
    const fps = Number(selectedVideo.frameRate || meta.frameRate || 30) || 30;
    const comment = await api<ReviewComment>(`/api/review-assets/${selectedVideo.id}/comments`, { method: "POST", body: JSON.stringify({ body: commentBody.trim(), locator: { type: "media_time", timeSeconds: start, endTimeSeconds: end, frameNumber: Math.round(start * fps), sourceVersionId: selectedVideo.id, annotation: null }, category: noteCategory, priority: notePriority, status: "open", assigneeId: commentAssigneeId || null }) });
    onMediaChange((current) => upsertProjectVideoComment(current, selectedVideo.id, comment));
    setCommentBody(""); setCommentEndTime(""); onStatusChange("Review note added.");
  }
  async function updateComment(commentId: string, patch: Partial<ReviewComment>) {
    if (!canContribute) return;
    const updated = await api<ReviewComment>(`/api/review-comments/${commentId}`, { method: "PATCH", body: JSON.stringify(patch) });
    onMediaChange((current) => upsertProjectVideoComment(current, updated.reviewAssetId, updated));
  }
  async function materializeComment(comment: ReviewComment, target: "ticket" | "card") {
    if (!canContribute) return;
    const destination = projectTicketDestinationIds(ticketDestination);
    if (!destination) { onStatusChange("Choose a Board/List destination for review follow-up work first."); return; }
    const result = await api<{ duplicate?: boolean; target?: string; entityId?: string; entity?: { id?: string } }>(`/api/review-comments/${comment.id}/materialize`, { method: "POST", body: JSON.stringify({ target, assigneeId: comment.assigneeId || null, ...destination }) });
    const entityId = result.entityId || result.entity?.id || comment.workEntityId || null;
    onMediaChange((current) => patchProjectVideoComment(current, comment.id, { workEntityType: target, workEntityId: entityId }));
    onStatusChange(result.duplicate ? "Review note was already linked to work." : `${target === "ticket" ? "Ticket" : "Card"} created from review note.`);
  }
  async function carryForward(fromAssetId: string) {
    if (!selectedVideo || !canContribute) return;
    const result = await api<{ copied: number; skipped: number }>(`/api/review-assets/${selectedVideo.id}/carry-forward`, { method: "POST", body: JSON.stringify({ fromAssetId, unresolvedOnly: true }) });
    scheduleMediaRevalidation(120);
    onStatusChange(`${result.copied} unresolved note${result.copied === 1 ? "" : "s"} carried forward${result.skipped ? ` · ${result.skipped} already present` : ""}.`);
  }
  async function queueProcessingJobs(jobs: string[]) {
    if (!selectedVideo || !canContribute) return;
    await api(`/api/review-assets/${selectedVideo.id}/processing-jobs`, { method: "POST", body: JSON.stringify({ jobs, accelerationPreference: processingAcceleration }) });
    onMediaChange((current) => patchProjectVideoProcessingState(current, selectedVideo.id, "queued"));
    scheduleMediaRevalidation();
    onStatusChange(`Media processing queued · ${processingAcceleration === "auto" ? "best available acceleration" : processingAcceleration}.`);
  }
  async function setWorkerDirective(workerId: string, desiredState: "active" | "drain" | "maintenance") {
    if (!isAdmin) return;
    await api(`/api/admin/media-processing/workers/${encodeURIComponent(workerId)}`, { method: "PATCH", body: JSON.stringify({ desiredState }) });
    onMediaChange((current) => patchProjectMediaWorker(current, workerId, { desiredState }));
    scheduleMediaRevalidation();
    onStatusChange(`Media worker set to ${desiredState}.`);
  }
  async function setSourceIngestionPolicy(mode: "manual" | "review" | "proxy") {
    if (!isAdmin) return;
    const jobs = mode === "manual" ? [] : mode === "review" ? ["metadata", "thumbnail", "waveform", "storyboard", "captions"] : ["metadata", "thumbnail", "waveform", "storyboard", "captions", "proxy"];
    const policy = await api<{ medium: "video"; assetRole: string; enabled: boolean; jobs: string[]; accelerationPreference: string; retentionDays?: number | null; source?: string }>(`/api/admin/media-processing/policies/${encodeURIComponent(project.projectType || "video")}/video/source`, { method: "PUT", body: JSON.stringify({ enabled: mode !== "manual", jobs, accelerationPreference: "auto", retentionDays: 30 }) });
    onMediaChange((current) => upsertProjectMediaPolicy(current, { ...policy, source: policy.source || "studio" }));
    onStatusChange(`Studio source-ingestion policy set to ${mode}.`);
  }
  async function cancelMediaJob(record: VideoProductionRecord) {
    if (!canContribute) return;
    await api(`/api/projects/${project.id}/media-processing/jobs/${record.id}/cancel`, { method: "POST", body: JSON.stringify({}) });
    onMediaChange((current) => patchProjectMediaJob(current, record.id, "cancelled"));
    scheduleMediaRevalidation();
    onStatusChange("Media processing cancellation requested.");
  }
  async function retryMediaJob(record: VideoProductionRecord) {
    if (!canContribute) return;
    await api(`/api/projects/${project.id}/media-processing/jobs/${record.id}/retry`, { method: "POST", body: JSON.stringify({}) });
    onMediaChange((current) => patchProjectMediaJob(current, record.id, "queued"));
    scheduleMediaRevalidation();
    onStatusChange("Media processing job requeued.");
  }
  async function cleanupMediaCache() {
    if (!canManage || !await confirmCluster({ title: "Clear generated media previews?", message: "Remove generated thumbnails, waveforms, storyboards, captions, proxies, review encodes, and other viewer-cache derivatives for this project? They can be regenerated later. Source videos, comments, and deliverables are not deleted.", confirmLabel: "Clear previews", tone: "danger" })) return;
    const result = await api<{ removed: number }>(`/api/projects/${project.id}/media-processing/cache/cleanup`, { method: "POST", body: JSON.stringify({ all: true }) });
    scheduleMediaRevalidation(120);
    onStatusChange(`${result.removed} generated media artifact${result.removed === 1 ? "" : "s"} removed.`);
  }
  async function saveMeta() {
    if (!selectedVideo || !canManage) return;
    await updateAsset(selectedVideo.id, { title: meta.title.trim() || selectedVideo.title, description: meta.description.trim() || null, pool: meta.pool, status: meta.status, versionLabel: meta.versionLabel.trim() || null, reviewRound: meta.reviewRound.trim() || null, assetKind: meta.assetKind, platform: meta.platform.trim() || null, dueDate: meta.dueDate || null, reviewerId: meta.reviewerId || null, frameRate: Math.max(1, Math.min(240, Number(meta.frameRate) || 30)), codec: meta.codec.trim() || null } as Partial<ReviewAsset>);
    onStatusChange("Video details saved.");
  }
  async function setApproval(state: "approved" | "changes") {
    if (!selectedVideo || !canManage) return;
    const reason = state === "changes" ? (await promptCluster({ title: "Request changes to this version", message: `Explain what needs to change in ${selectedVideo.title} (${selectedVideo.versionLabel || `v${selectedVideo.versionNumber || 1}`}).`, label: "Required review notes", confirmLabel: "Record changes requested" }))?.trim() : null;
    if (state === "changes" && !reason) { onStatusChange("A reason is required to request changes."); return; }
    const result = await api<{ asset: ReviewAsset }>(`/api/review-assets/${selectedVideo.id}/decision`, { method: "POST", body: JSON.stringify({ decision: state, reason, expectedUpdatedAt: selectedVideo.updatedAt, expectedVersionNumber: selectedVideo.versionNumber }) });
    onMediaChange((current) => upsertProjectVideoAsset(current, result.asset));
    onStatusChange(state === "approved" ? "Decision saved against this media version." : "Changes requested against this media version.");
  }
  async function archiveVideo() {
    if (!selectedVideo || !canManage || !await confirmCluster({ title: "Archive project media?", message: `Archive "${selectedVideo.title}"? Its stored media and version-specific review decisions remain retained, but the version leaves the active review workspace.`, confirmLabel: "Archive version" })) return;
    const archivedId = selectedVideo.id;
    await updateAsset(archivedId, { status: "archived" });
    onMediaChange((current) => removeProjectVideoAsset(current, archivedId));
    setSelectedVideoId((current) => current === archivedId ? null : current);
    onStatusChange("Media version archived. Review evidence was retained.");
  }
  async function createProductionRecord(kind: VideoProductionRecordKind, title: string, extra: Record<string, unknown> = {}) {
    if (!canContribute || !title.trim()) return null;
    const record = await api<VideoProductionRecord>(`/api/projects/${project.id}/video-production/records`, { method: "POST", body: JSON.stringify({ kind, title: title.trim(), parentId: extra.parentId || null, dueDate: extra.dueDate || null, status: extra.status || "planned", payload: extra.payload || {} }) });
    onMediaChange((current) => upsertProjectProductionRecord(current, record));
    return record;
  }
  async function patchProductionRecord(record: VideoProductionRecord, patch: Record<string, unknown>) {
    if (!canContribute) return;
    const updated = await api<VideoProductionRecord>(`/api/projects/${project.id}/video-production/records/${record.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    onMediaChange((current) => upsertProjectProductionRecord(current, updated, patch.archived === true));
  }
  async function applyProductionTemplate(template: "youtube" | "commercial" | "short_film" | "social_campaign") {
    if (!canContribute) return;
    await api(`/api/projects/${project.id}/video-production/apply-template`, { method: "POST", body: JSON.stringify({ template }) });
    scheduleMediaRevalidation(120);
    onStatusChange("Production template applied.");
  }
  async function scheduleReviewSession() {
    if (!canContribute || !sessionTitle.trim() || !sessionAt) return;
    const start = new Date(sessionAt); const minutes = Math.max(15, Math.min(480, Number(sessionDurationMinutes) || 60)); const end = new Date(start.getTime() + minutes * 60000);
    const event = await api<{ id: string }>("/api/calendar/events", { method: "POST", body: JSON.stringify({ projectId: project.id, title: sessionTitle.trim(), description: sessionAgenda.trim() || null, startsAt: start.toISOString(), endsAt: end.toISOString(), allDay: false, eventType: "review", status: "scheduled", attendeeIds: sessionAttendeeIds, reminderMinutes: 15 }) });
    let schedulerBlockId: string | null = null;
    try { const block = await api<{ id: string }>("/api/schedule/blocks", { method: "POST", body: JSON.stringify({ projectId: project.id, title: sessionTitle.trim(), description: `[video-review-session] ${sessionAgenda.trim()}`.trim(), startsAt: start.toISOString(), endsAt: end.toISOString(), type: "meeting" }) }); schedulerBlockId = block.id; } catch { /* Scheduler permission may be stricter than project contribution. Calendar remains authoritative. */ }
    await createProductionRecord("review_session", sessionTitle, { dueDate: start.toISOString(), payload: { assetIds: selectedVideo ? [selectedVideo.id] : [], attendeeIds: sessionAttendeeIds, agenda: sessionAgenda.trim(), calendarEventId: event.id, schedulerBlockId, durationMinutes: minutes, decisions: [], followUpIds: [] } });
    setSessionTitle(""); setSessionAt(""); setSessionAgenda(""); setSessionAttendeeIds([]); onStatusChange(schedulerBlockId ? "Review session added to Calendar and Scheduler." : "Review session added to Calendar. Scheduler placement requires Scheduler manage permission.");
  }
  async function addSessionDecision(record: VideoProductionRecord) {
    if (!canContribute) return;
    const decision = (await promptCluster({ title: "Record review decision", message: `Add a decision from ${record.title}.`, label: "Decision", confirmLabel: "Record decision" }))?.trim();
    if (!decision) return;
    const current = Array.isArray(record.payload?.decisions) ? record.payload.decisions.map(String) : [];
    await patchProductionRecord(record, { payload: { ...(record.payload || {}), decisions: [...current, decision].slice(-40) } });
    onStatusChange("Review decision recorded.");
  }
  async function createSessionFollowUp(record: VideoProductionRecord) {
    if (!canContribute) return;
    const destination = projectTicketDestinationIds(ticketDestination);
    if (!destination) { onStatusChange("Choose a Ticket destination Board/List before creating the follow-up."); return; }
    const result = await api<{ entity?: { id?: string } }>(`/api/projects/${project.id}/control-records/${record.id}/materialize`, { method: "POST", body: JSON.stringify({ target: "ticket", attach: true, ...destination }) });
    const id = result.entity?.id; const current = Array.isArray(record.payload?.followUpIds) ? record.payload.followUpIds.map(String) : [];
    if (id && !current.includes(id)) await patchProductionRecord(record, { payload: { ...(record.payload || {}), followUpIds: [...current, id].slice(-20) } });
    onStatusChange("Review follow-up ticket linked.");
  }

  const renderPool = (title: string, videos: ReviewAsset[], empty: string) => <div className="video-pool-v052"><h3>{title}</h3>{videos.length ? videos.map((video) => <ClusterButton variant="quiet" className={`${selectedVideo?.id === video.id ? "active " : ""}video-row-v044 video-card-v052`} key={video.id} onClick={() => setSelectedVideoId(video.id)}><span className={`video-status-dot-v052 ${statusTone(video.status)}`} /><strong>{video.title}</strong><span>{video.versionLabel || bytesToSize(video.sizeBytes)} · {openNotes(video)} open</span><em>{statusLabel(video.status)}</em></ClusterButton>) : <p className="muted">{empty}</p>}</div>;

  return <section className="project-subpage-v312 video-production-v052 video-production-v312 video-production-v495">
    {canContribute ? <ProjectTicketDestinationPicker project={project} value={ticketDestination} onChange={setTicketDestination} /> : null}
    <ProjectSectionHeader eyebrow="Video project" title="Video Review" description="Review versions, leave frame-accurate notes, manage approvals, and prepare final deliverables." metrics={[{ label: "Versions", value: media.reviewAssets.length }, { label: "Open notes", value: openNoteCount, tone: openNoteCount ? "warning" : "good" }, { label: "Approvals", value: media.production?.summary.pendingApprovals || 0, tone: media.production?.summary.pendingApprovals ? "warning" : "good" }, { label: "Deliverables", value: deliverables.length, tone: "accent" }]} actions={<div className="video-header-actions-v495"><ClusterSelect ariaLabel="Video status filter" value={statusFilter} onChange={(value) => setStatusFilter(value as typeof statusFilter)} options={[{ value: "all", label: "All status" }, ...VIDEO_STATUS_OPTIONS]} />{canContribute ? <ClusterFileButton label="Upload video" variant="primary" accept="video/*" busy={uploadingVideo} busyLabel="Uploading…" disabled={uploadingVideo} onChange={uploadVideo}>{uploadAsVersion ? "Upload version" : "Upload video"}</ClusterFileButton> : null}</div>} />
    {!videoEnabled ? <ProjectSectionStatus tone="warning">This project type does not enable Video Production by default. The tools still work, but the project type should be corrected.</ProjectSectionStatus> : null}
    {status ? <ProjectSectionStatus tone={status.toLowerCase().includes("failed") || status.toLowerCase().includes("error") ? "danger" : "neutral"}>{status}</ProjectSectionStatus> : null}

    <nav className="video-mode-nav-v495" aria-label="Video production workspace">
      {(["review", "production", "deliverables"] as const).map((mode) => <ClusterButton key={mode} size="compact" variant="quiet" selected={workspaceMode === mode} onClick={() => setWorkspaceMode(mode)}>{mode === "review" ? "Review" : mode === "production" ? "Production" : "Deliverables"}</ClusterButton>)}
    </nav>

    <ProjectProductionEvidenceBar gates={videoDeliveryGates} ready={videoDeliveryReady} total={videoDeliveryGates.length} blockers={videoDeliveryBlockers} onOpenBuilds={onOpenBuilds} onOpenQa={onOpenQa} />

    {workspaceMode === "review" && selectedVideo ? <div className="video-review-cockpit-v495" aria-label="Review navigation">
      <div><strong>{selectedVideo.versionLabel || `v${selectedVideo.versionNumber || 1}`}</strong><span>{selectedVideo.reviewRound || "Review round"}</span><small>{unresolvedReviewNotes.length ? `${unresolvedReviewNotes.length} unresolved note${unresolvedReviewNotes.length === 1 ? "" : "s"}` : "No unresolved notes"}</small></div>
      <div><ClusterButton size="compact" variant="quiet" disabled={!unresolvedReviewNotes.length} onClick={() => jumpReviewNote(-1)}>Previous note</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={!unresolvedReviewNotes.length} onClick={() => jumpReviewNote(1)}>Next note</ClusterButton><small>←/→ frame · Shift+←/→ notes · A add note · M mute</small></div>
    </div> : null}

    {workspaceMode === "review" && <>
      <section className="project-video-settings-v312 video-intake-strip-v495">
        <label><span>Upload pool</span><ClusterSelect ariaLabel="Video upload pool" value={uploadPool} onChange={(value) => setUploadPool(value as VideoPool)} options={[{ value: "raw", label: "Raw" }, { value: "edited", label: "Edit" }, { value: "final", label: "Final" }]} /></label>
        <label><span>Initial status</span><ClusterSelect ariaLabel="Video upload status" value={uploadStatus} onChange={(value) => setUploadStatus(value as VideoStatus)} options={VIDEO_STATUS_OPTIONS} /></label>
        <label><span>Asset kind</span><ClusterSelect ariaLabel="Video asset kind" value={uploadAssetKind} onChange={setUploadAssetKind} options={ASSET_KIND_OPTIONS} /></label>
        <label className="video-version-toggle-v495"><ClusterInput type="checkbox" checked={uploadAsVersion} disabled={!selectedVideo} onChange={(event) => setUploadAsVersion(event.target.checked)} /><span><strong>New version</strong><small>{selectedVideo ? `Continue ${selectedVideo.title}` : "Select a video first"}</small></span></label>
        <div><span>Due soon</span><strong>{dueSoon}</strong></div><div><span>Masters</span><strong>{media.reviewAssets.filter((video) => video.assetKind === "master" || video.pool === "final").length}</strong></div>
      </section>

      <ClusterResizableSplit className="video-production-grid-v052 video-review-layout-v495" label="video review panel" persistKey="project-video-review" side="end" minWidth={420} maxWidth={820} defaultWidth={580}><div className="panel project-resource-panel-v044 video-library-v052"><div className="section-heading"><div><h2>Media versions</h2><p className="muted tight">Source media, review cuts, proxies, and approved masters.</p></div></div><div className="video-pools-v044 video-pools-v045 video-pools-v052">{renderPool("Raw", pools.raw, "No raw video.")}{renderPool("Edit / review", pools.edited, "No edits yet.")}{renderPool("Final", pools.final, "No finals yet.")}</div></div>
        <aside className="panel video-review-panel-v044 video-review-v052 video-review-v495">{selectedVideo ? <><div className="section-heading"><div><p className="eyebrow">{selectedVideo.assetKind || poolLabel(selectedVideo.pool)} · {statusLabel(selectedVideo.status)}</p><h2>{selectedVideo.title}</h2><p className="muted tight">{selectedVideo.originalName} · {bytesToSize(selectedVideo.sizeBytes)}{selectedVideo.versionLabel ? ` · ${selectedVideo.versionLabel}` : ""}{selectedVideo.reviewRound ? ` · ${selectedVideo.reviewRound}` : ""}</p></div><div className="video-review-actions-v052"><ClusterLinkButton className="" href={videoAssetUrl(selectedVideo)} target="_blank" rel="noreferrer" variant="secondary" size="compact">Open file</ClusterLinkButton>{canManage ? <ClusterButton size="compact" variant="quiet" onClick={archiveVideo}>Archive</ClusterButton> : null}</div></div>
          <div className="video-review-rounds-v495"><header><div><strong>Review lineage</strong><span>{reviewHierarchy.rounds.length} round{reviewHierarchy.rounds.length === 1 ? "" : "s"} · {versionFamily.length} version{versionFamily.length === 1 ? "" : "s"}</span></div>{reviewHierarchy.currentRound ? <span>{reviewHierarchy.currentRound.openNotes} open / {reviewHierarchy.currentRound.totalNotes} notes in {reviewHierarchy.currentRound.label}</span> : null}</header><div className="video-review-round-nav-v495"><ClusterButton size="compact" variant="quiet" disabled={!reviewHierarchy.newerRound} onClick={() => reviewHierarchy.newerRound && setSelectedVideoId(reviewHierarchy.newerRound.latestVersion.id)}>Newer round</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={!reviewHierarchy.olderRound} onClick={() => reviewHierarchy.olderRound && setSelectedVideoId(reviewHierarchy.olderRound.latestVersion.id)}>Older round</ClusterButton>{reviewHierarchy.previousVersionInRound || previousVersion ? <ClusterButton size="compact" variant="secondary" onClick={() => setCompareVideoId((reviewHierarchy.previousVersionInRound || previousVersion)!.id)}>Compare previous</ClusterButton> : null}</div><div className="video-review-round-list-v495">{reviewHierarchy.rounds.map((round) => <ClusterButton key={round.key} size="compact" variant="quiet" selected={round.key === reviewHierarchy.currentRound?.key} onClick={() => setSelectedVideoId(round.latestVersion.id)}>{round.label} · {round.videos.length}v{round.approvedVersions ? ` · ${round.approvedVersions} approved` : ""}{round.openNotes ? ` · ${round.openNotes} open` : ""}</ClusterButton>)}</div></div>
          <div className="video-compare-toolbar-v495"><ClusterSelect ariaLabel="Compare against video version" value={compareVideoId} onChange={setCompareVideoId} options={[{ value: "", label: "Single version" }, ...reviewHierarchy.compareCandidates.map((version) => ({ value: version.id, label: `Compare ${version.versionLabel || `v${version.versionNumber || 1}`} · ${version.reviewRound || "Review"}` }))]} />{compareVideo ? <span>Comparison mode and synchronization are owned by the shared viewer session.</span> : null}{previousVersion && canContribute ? <ClusterButton size="compact" variant="quiet" onClick={() => carryForward(previousVersion.id)}>Carry unresolved from {previousVersion.versionLabel || `v${previousVersion.versionNumber || 1}`}</ClusterButton> : null}<span>{selectedVideo.processingState && selectedVideo.processingState !== "idle" ? `Processing: ${selectedVideo.processingState}` : lineageParent ? `Derived from ${lineageParent.versionLabel || lineageParent.title}` : "Primary review source"}</span></div>
          <div className="review-video-v052"><UnifiedVideoViewer ref={videoViewerRef} input={{ locator: { provider: "review_asset", assetId: selectedVideo.id } }} compareInput={compareVideo ? { locator: { provider: "review_asset", assetId: compareVideo.id } } : null} userId={userId} mode="review" onReviewMutation={() => scheduleMediaRevalidation(120)} onDurationDiscovered={(duration) => { if (canManage && !selectedVideo.durationSeconds && Number.isFinite(duration)) void updateAsset(selectedVideo.id, { durationSeconds: duration }); }} /></div>
          <div className="video-version-strip-v495"><strong>Versions</strong>{versionFamily.map((version) => <ClusterButton size="compact" variant="quiet" selected={version.id === selectedVideo.id} key={version.id} onClick={() => setSelectedVideoId(version.id)}>{version.versionLabel || `v${version.versionNumber || 1}`}{version.approvalState === "approved" ? <ClusterIcon name="check" /> : null}</ClusterButton>)}</div>
          {canManage ? <div className="video-quick-actions-v052"><ClusterButton size="compact" variant="secondary" onClick={() => setApproval("changes")}>Request changes</ClusterButton><ClusterButton size="compact" variant="primary" onClick={() => setApproval("approved")}>Approve version</ClusterButton><ClusterButton size="compact" variant="secondary" onClick={() => updateAsset(selectedVideo.id, { pool: "final", assetKind: "master", status: "published" })}>Mark master</ClusterButton><ClusterButton size="compact" variant="quiet" onClick={() => queueProcessingJobs(["metadata", "thumbnail", "waveform", "storyboard", "captions"])}>Refresh review media</ClusterButton>{selectedVideo.assetKind === "source" ? <><ClusterSelect ariaLabel="Media acceleration" value={processingAcceleration} onChange={setProcessingAcceleration} options={[{ value: "auto", label: "Acceleration: Auto" }, { value: "software", label: "Software" }, { value: "nvenc", label: "NVENC" }, { value: "qsv", label: "Intel QSV" }, { value: "videotoolbox", label: "VideoToolbox" }]} /><ClusterButton size="compact" variant="quiet" onClick={() => queueProcessingJobs(["proxy", "review_encode"])}>Queue proxy + review encode</ClusterButton></> : null}</div> : null}
          <fieldset className="video-meta-grid-v052 project-permission-fieldset-v316 video-meta-grid-v495" disabled={!canManage}><label className="field"><span>Title</span><ClusterTextInput value={meta.title} onChange={(event) => setMeta((value) => ({ ...value, title: event.target.value }))} /></label><label className="field"><span>Version</span><ClusterTextInput value={meta.versionLabel} onChange={(event) => setMeta((value) => ({ ...value, versionLabel: event.target.value }))} /></label><label className="field"><span>Review round</span><ClusterTextInput value={meta.reviewRound} onChange={(event) => setMeta((value) => ({ ...value, reviewRound: event.target.value }))} placeholder="Fine cut 1" /></label><label className="field"><span>Kind</span><ClusterSelect ariaLabel="Video asset kind" value={meta.assetKind} onChange={(value) => setMeta((current) => ({ ...current, assetKind: value }))} options={ASSET_KIND_OPTIONS} /></label><label className="field"><span>Pool</span><ClusterSelect ariaLabel="Video pool" value={meta.pool} onChange={(value) => setMeta((current) => ({ ...current, pool: value as VideoPool }))} options={[{ value: "raw", label: "Raw" }, { value: "edited", label: "Edit" }, { value: "final", label: "Final" }]} /></label><label className="field"><span>Status</span><ClusterSelect ariaLabel="Video status" value={meta.status} onChange={(value) => setMeta((current) => ({ ...current, status: value as VideoStatus }))} options={VIDEO_STATUS_OPTIONS} /></label><label className="field"><span>Delivery</span><ClusterTextInput value={meta.platform} onChange={(event) => setMeta((value) => ({ ...value, platform: event.target.value }))} /></label><label className="field"><span>Due</span><ClusterTextInput type="date" value={meta.dueDate} onChange={(event) => setMeta((value) => ({ ...value, dueDate: event.target.value }))} /></label><label className="field"><span>Frame rate</span><ClusterTextInput inputMode="decimal" value={meta.frameRate} onChange={(event) => setMeta((value) => ({ ...value, frameRate: event.target.value }))} /></label><label className="field"><span>Codec</span><ClusterTextInput value={meta.codec} onChange={(event) => setMeta((value) => ({ ...value, codec: event.target.value }))} placeholder="ProRes, H.264…" /></label><label className="field span-2"><span>Description</span><ClusterTextArea value={meta.description} onChange={(event) => setMeta((value) => ({ ...value, description: event.target.value }))} /></label>{canManage ? <ClusterButton variant="primary" className="span-2" onClick={saveMeta}>Save video details</ClusterButton> : null}</fieldset>
          {canContribute ? <div className="video-comment-composer-v052 video-comment-composer-v495"><div className="video-time-range-v495"><label><span>In</span><ClusterTextInput value={commentTime} onChange={(event) => setCommentTime(event.target.value)} /><ClusterButton size="compact" variant="quiet" onClick={() => captureTime("start")}>Current</ClusterButton></label><label><span>Out</span><ClusterTextInput value={commentEndTime} onChange={(event) => setCommentEndTime(event.target.value)} placeholder="Optional" /><ClusterButton size="compact" variant="quiet" onClick={() => captureTime("end")}>Current</ClusterButton></label></div><ClusterSelect ariaLabel="Review note category" value={noteCategory} onChange={(value) => setNoteCategory(value as VideoNoteCategory)} options={VIDEO_NOTE_CATEGORIES} /><ClusterSelect ariaLabel="Review note priority" value={notePriority} onChange={(value) => setNotePriority(value as VideoPriority)} options={VIDEO_PRIORITY_OPTIONS} /><ClusterSelect ariaLabel="Review note assignee" value={commentAssigneeId} onChange={setCommentAssigneeId} options={[{ value: "", label: "Unassigned" }, ...users.map((user) => ({ value: user.id, label: displayUserName(user) }))]} /><ClusterTextInput value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Trim this shot, fix audio, adjust grade…" /><ClusterButton variant="primary" onClick={addComment}>Add review note</ClusterButton></div> : null}
          <div className="video-note-toolbar-v052"><strong>Review notes</strong><div className="segmented-control"><ClusterButton type="button" variant="quiet" size="compact" selected={noteFilter === "open"} onClick={() => setNoteFilter("open")}>Open</ClusterButton><ClusterButton type="button" variant="quiet" size="compact" selected={noteFilter === "all"} onClick={() => setNoteFilter("all")}>All</ClusterButton><ClusterButton type="button" variant="quiet" size="compact" selected={noteFilter === "resolved"} onClick={() => setNoteFilter("resolved")}>Done</ClusterButton></div></div>
          <div className="timestamp-list-v044 timestamp-list-v052">{selectedNotes.length ? visibleSelectedNotes.map((comment) => <article className={`timestamp-note-v044 timestamp-note-v052 ${comment.status === "resolved" ? "resolved" : ""}`} key={comment.id}><div><ClusterButton size="compact" variant="quiet" onClick={() => seekTo(noteStart(comment))}>{secondsToTimecode(noteStart(comment))}{mediaLocator(comment)?.endTimeSeconds ? `–${secondsToTimecode(Number(mediaLocator(comment)?.endTimeSeconds))}` : ""}</ClusterButton><span className={`note-priority-v052 ${comment.priority || "medium"}`}>{comment.priority || "medium"}</span><span>{VIDEO_NOTE_CATEGORIES.find((option) => option.value === comment.category)?.label || comment.category || "Edit"}</span>{mediaLocator(comment)?.frameNumber != null ? <span>F{mediaLocator(comment)?.frameNumber}</span> : null}{mediaLocator(comment)?.annotation && Object.keys(mediaLocator(comment)?.annotation || {}).length ? <span>Marked frame</span> : null}{comment.carriedFromAssetId ? <span>Carried forward</span> : null}{comment.workEntityId ? <span>{comment.workEntityType === "ticket" ? "Ticket linked" : "Card linked"}</span> : null}</div><p>{comment.body}</p><footer><span>{comment.user ? displayUserName(comment.user) : "Person"} · {formatRelativeTime(comment.createdAt)}{comment.assigneeId ? ` · ${displayUserName(users.find((user) => user.id === comment.assigneeId))}` : ""}</span><div className="video-note-actions-v495">{canContribute && !comment.workEntityId ? <><ClusterButton size="compact" variant="quiet" disabled={!projectTicketDestinationIds(ticketDestination)} title="Choose an explicit active Board and List above" onClick={() => materializeComment(comment, "ticket")}>Create ticket</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={!projectTicketDestinationIds(ticketDestination)} title="Choose an explicit active Board and List above" onClick={() => materializeComment(comment, "card")}>Create card</ClusterButton></> : null}{canContribute ? <ClusterButton size="compact" variant="quiet" onClick={() => updateComment(comment.id, { status: comment.status === "resolved" ? "open" : "resolved" })}>{comment.status === "resolved" ? "Reopen" : "Resolve"}</ClusterButton> : null}</div></footer></article>) : <p className="muted">No matching notes.</p>}</div>
          {selectedNotes.length > visibleSelectedNotes.length ? <ClusterButton size="compact" variant="quiet" onClick={() => setNoteRenderLimit((current) => current + VIDEO_NOTE_RENDER_BATCH)}>Show {Math.min(VIDEO_NOTE_RENDER_BATCH, selectedNotes.length - visibleSelectedNotes.length)} more notes · {selectedNotes.length - visibleSelectedNotes.length} remaining</ClusterButton> : null}
          {versionFamily.length > 1 ? <div className="video-review-history-v495"><div className="section-heading"><div><p className="eyebrow">Review history</p><h3>{historyScope === "round" && reviewHierarchy.currentRound ? reviewHierarchy.currentRound.label : "Full version family"}</h3></div><div className="segmented-control"><ClusterButton type="button" variant="quiet" size="compact" selected={historyScope === "round"} onClick={() => setHistoryScope("round")}>Current round</ClusterButton><ClusterButton type="button" variant="quiet" size="compact" selected={historyScope === "family"} onClick={() => setHistoryScope("family")}>All versions</ClusterButton></div></div><div>{visibleReviewHistory.map((version) => { const notes = version.comments || []; const unresolved = notes.filter((note) => note.status !== "resolved").length; const carried = notes.filter((note) => Boolean(note.carriedFromAssetId)).length; return <ClusterButton key={version.id} variant="quiet" selected={version.id === selectedVideo.id} className="video-review-history-row-v495" onClick={() => setSelectedVideoId(version.id)}><strong>{version.versionLabel || `v${version.versionNumber || 1}`}</strong><span>{version.reviewRound || "Review"}</span><span>{statusLabel(version.status)}</span><span>{unresolved} open / {notes.length} notes</span>{carried ? <em>{carried} carried</em> : <em>{version.approvalState || "unapproved"}</em>}</ClusterButton>; })}</div>{reviewHistory.length > visibleReviewHistory.length ? <ClusterButton size="compact" variant="quiet" onClick={() => setHistoryRenderLimit((current) => current + VIDEO_HISTORY_RENDER_BATCH)}>Show {Math.min(VIDEO_HISTORY_RENDER_BATCH, reviewHistory.length - visibleReviewHistory.length)} more versions</ClusterButton> : null}</div> : null}
        </> : <div className="empty-state"><h2>No video</h2><p>Upload source media or a review cut to start production review.</p></div>}</aside>
      </ClusterResizableSplit>
    </>}

    {workspaceMode === "production" && <section className="video-production-ops-v495">
      <div className="panel"><div className="section-heading"><div><p className="eyebrow">Structure</p><h2>Episodes, sequences, scenes, shots, and takes</h2><p className="muted tight">Project-owned production records remain available across the project, independent of the video player.</p></div></div>{canContribute ? <><div className="video-template-actions-v495"><span>Start from template</span><ClusterButton size="compact" variant="quiet" onClick={() => applyProductionTemplate("youtube")}>YouTube</ClusterButton><ClusterButton size="compact" variant="quiet" onClick={() => applyProductionTemplate("commercial")}>Commercial</ClusterButton><ClusterButton size="compact" variant="quiet" onClick={() => applyProductionTemplate("short_film")}>Short film</ClusterButton><ClusterButton size="compact" variant="quiet" onClick={() => applyProductionTemplate("social_campaign")}>Social campaign</ClusterButton></div><div className="video-production-composer-v495"><ClusterSelect ariaLabel="Production record type" value={productionKind} onChange={(value) => setProductionKind(value as VideoProductionRecordKind)} options={PRODUCTION_KIND_OPTIONS} /><ClusterTextInput value={productionTitle} onChange={(event) => setProductionTitle(event.target.value)} placeholder={`New ${recordLabel(productionKind).toLowerCase()}`} /><ClusterSelect ariaLabel="Production parent" value={productionParentId} onChange={setProductionParentId} options={[{ value: "", label: "No parent" }, ...productionUnits.map((record) => ({ value: record.id, label: `${recordLabel(record.kind)} · ${record.title}` }))]} /><ClusterButton variant="primary" onClick={async () => { await createProductionRecord(productionKind, productionTitle, { parentId: productionParentId || null }); setProductionTitle(""); }}>Add</ClusterButton></div></> : null}<div className="video-production-records-v495">{productionUnits.length ? visibleProductionUnits.map((record) => <article key={record.id}><div><span>{recordLabel(record.kind)}</span><strong>{record.title}</strong><small>{record.parentId ? `Inside ${productionUnits.find((parent) => parent.id === record.parentId)?.title || "parent"}` : "Top level"}</small></div><ClusterSelect ariaLabel={`${record.title} status`} value={record.status || "planned"} onChange={(value) => void patchProductionRecord(record, { status: value, progress: value === "approved" || value === "complete" ? 100 : record.progress || 0 })} options={[{ value: "planned", label: "Planned" }, { value: "in_progress", label: "In progress" }, { value: "review", label: "Review" }, { value: "changes", label: "Changes" }, { value: "approved", label: "Approved" }, { value: "complete", label: "Complete" }]} />{canManage ? <ClusterButton size="compact" variant="quiet" onClick={() => void patchProductionRecord(record, { archived: true })}>Archive</ClusterButton> : null}</article>) : <div className="empty-state"><p>No production structure yet.</p></div>}</div>{productionUnits.length > visibleProductionUnits.length ? <ClusterButton size="compact" variant="quiet" onClick={() => setProductionRenderLimit((current) => current + VIDEO_RECORD_RENDER_BATCH)}>Show {Math.min(VIDEO_RECORD_RENDER_BATCH, productionUnits.length - visibleProductionUnits.length)} more production records</ClusterButton> : null}</div>
      <div className="panel"><div className="section-heading"><div><p className="eyebrow">Review sessions</p><h2>Calendar-backed cut reviews</h2><p className="muted tight">Calendar is authoritative; Scheduler is added when the current user has Scheduler manage permission.</p></div></div>{canContribute ? <div className="video-session-composer-v495"><ClusterTextInput value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} placeholder="Editorial review" /><ClusterTextInput type="datetime-local" value={sessionAt} onChange={(event) => setSessionAt(event.target.value)} /><ClusterTextInput type="number" min={15} max={480} value={sessionDurationMinutes} onChange={(event) => setSessionDurationMinutes(event.target.value)} placeholder="60 minutes" /><ClusterTextInput value={sessionAgenda} onChange={(event) => setSessionAgenda(event.target.value)} placeholder="Agenda / review goals" /><PeopleMultiPicker label="Attendees" values={sessionAttendeeIds} onChange={setSessionAttendeeIds} people={users} /><ClusterButton variant="primary" onClick={scheduleReviewSession}>Schedule review</ClusterButton></div> : null}<div className="video-production-records-v495">{reviewSessions.length ? visibleReviewSessions.map((record) => <article key={record.id}><div><span>Review session</span><strong>{record.title}</strong><small>{record.dueDate ? new Date(record.dueDate).toLocaleString() : "Not scheduled"}{Array.isArray(record.payload?.attendeeIds) ? ` · ${record.payload?.attendeeIds.length} attendee${record.payload?.attendeeIds.length === 1 ? "" : "s"}` : ""}</small>{record.payload?.agenda ? <small>{String(record.payload.agenda)}</small> : null}{Array.isArray(record.payload?.decisions) && record.payload.decisions.length ? <small>{record.payload.decisions.length} decision{record.payload.decisions.length === 1 ? "" : "s"} recorded</small> : null}{Array.isArray(record.payload?.followUpIds) && record.payload.followUpIds.length ? <small>{record.payload.followUpIds.length} follow-up ticket{record.payload.followUpIds.length === 1 ? "" : "s"}</small> : null}</div><ClusterSelect ariaLabel={`${record.title} review status`} value={record.status || "planned"} onChange={(value) => void patchProductionRecord(record, { status: value })} options={[{ value: "planned", label: "Planned" }, { value: "running", label: "Running" }, { value: "complete", label: "Complete" }, { value: "cancelled", label: "Cancelled" }]} /><div className="video-session-actions-v495">{canContribute ? <ClusterButton size="compact" variant="quiet" onClick={() => addSessionDecision(record)}>Decision</ClusterButton> : null}{canContribute ? <ClusterButton size="compact" variant="quiet" onClick={() => createSessionFollowUp(record)}>Follow-up</ClusterButton> : null}</div></article>) : <div className="empty-state"><p>No review sessions scheduled.</p></div>}</div>{reviewSessions.length > visibleReviewSessions.length ? <ClusterButton size="compact" variant="quiet" onClick={() => setSessionRenderLimit((current) => current + VIDEO_RECORD_RENDER_BATCH)}>Show {Math.min(VIDEO_RECORD_RENDER_BATCH, reviewSessions.length - visibleReviewSessions.length)} more review sessions</ClusterButton> : null}</div>
      <div className="panel"><div className="section-heading"><div><p className="eyebrow">Media processing</p><h2>Worker pool</h2><p className="muted tight">Capability-aware workers claim durable media jobs outside the API process. Encode jobs route by available capacity and fall back to software when hardware acceleration cannot complete the job.</p></div><div className="project-section-actions"><ProjectSectionStatus tone={onlineWorkers.length ? "good" : "warning"}>{onlineWorkers.length ? `${onlineWorkers.length} worker${onlineWorkers.length === 1 ? "" : "s"} online` : "No worker online"}</ProjectSectionStatus>{canManage ? <ClusterButton size="compact" variant="quiet" onClick={cleanupMediaCache}>Clear preview cache</ClusterButton> : null}</div></div>{mediaProcessing ? <><div className="project-metric-row"><span><strong>{mediaProcessing.queue.queued}</strong> queued</span><span><strong>{mediaProcessing.queue.processing}</strong> active</span><span><strong>{mediaProcessing.queue.failed}</strong> failed</span><span><strong>{mediaProcessing.queue.complete}</strong> complete</span>{mediaProcessing.storage ? <span><strong>{bytesToSize(mediaProcessing.storage.usedBytes)}</strong> project media</span> : null}</div><div className="video-production-records-v495">{mediaProcessing.workers.slice(0, 12).map((worker) => <article key={worker.id}><div><span>{worker.online ? worker.status : "offline"} · {worker.activeJobs}/{worker.concurrency} active</span><strong>{worker.hostname}</strong><small>{worker.selectedAcceleration || "software"} · {(worker.accelerationProfiles || []).join(", ") || "software"}{worker.labels?.length ? ` · ${worker.labels.join(", ")}` : ""} · {worker.storageTopology || "local"}</small></div>{isAdmin && worker.online ? <div className="video-session-actions-v495"><ClusterButton size="compact" variant="quiet" selected={worker.desiredState === "active"} onClick={() => void setWorkerDirective(worker.id, "active")}>Active</ClusterButton><ClusterButton size="compact" variant="quiet" selected={worker.desiredState === "drain"} onClick={() => void setWorkerDirective(worker.id, "drain")}>Drain</ClusterButton><ClusterButton size="compact" variant="quiet" selected={worker.desiredState === "maintenance"} onClick={() => void setWorkerDirective(worker.id, "maintenance")}>Maintenance</ClusterButton></div> : null}</article>)}</div>{mediaProcessing.policies?.length ? <div className="video-template-actions-v495"><span>Automatic ingestion</span>{mediaProcessing.policies.filter((policy) => policy.medium === "video").map((policy) => <span key={`${policy.medium}:${policy.assetRole}`}>{recordLabel(policy.assetRole)}: {policy.enabled && policy.jobs.length ? policy.jobs.join(", ") : "manual"} · {policy.accelerationPreference}</span>)}</div> : null}{mediaProcessing.storage?.mismatchedWorkerIds?.length ? <ProjectSectionStatus tone="danger">{mediaProcessing.storage.mismatchedWorkerIds.length} worker{mediaProcessing.storage.mismatchedWorkerIds.length === 1 ? " has" : "s have"} an incompatible storage topology and will not receive file-backed jobs.</ProjectSectionStatus> : null}{isAdmin ? <div className="video-template-actions-v495"><span>Studio source policy</span><ClusterButton size="compact" variant="quiet" onClick={() => void setSourceIngestionPolicy("manual")}>Manual</ClusterButton><ClusterButton size="compact" variant="quiet" onClick={() => void setSourceIngestionPolicy("review")}>Review media</ClusterButton><ClusterButton size="compact" variant="quiet" onClick={() => void setSourceIngestionPolicy("proxy")}>Review + proxy</ClusterButton></div> : null}</> : null}{selectedArtifacts.length ? <div className="video-template-actions-v495"><span>Generated for current version</span>{selectedArtifacts.map((artifact) => artifact.kind === "thumbnail" || artifact.kind === "storyboard" ? <img key={artifact.id} src={`${API_URL}${artifact.url}`} alt={`Generated ${recordLabel(artifact.kind).toLowerCase()} for ${selectedVideo?.title || "video"}`} loading="lazy" style={runtimeStyle({ maxWidth: 180, maxHeight: 96, objectFit: "cover", borderRadius: 8 })} /> : <a key={artifact.id} href={`${API_URL}${artifact.url}`} target="_blank" rel="noreferrer">{recordLabel(artifact.kind)} · {bytesToSize(artifact.sizeBytes)}</a>)}</div> : null}<div className="video-production-records-v495">{mediaJobs.length ? mediaJobs.slice(0, 30).map((record) => { const error = String(record.payload?.lastError || ""); const progress = Math.max(0, Math.min(100, Number(record.progress || 0))); return <article key={record.id}><div><span>{record.status}{progress ? ` · ${progress}%` : ""}</span><strong>{record.title}</strong><small>{String(record.payload?.job || "media job")} · {String(record.payload?.progressMessage || (record.updatedAt ? formatRelativeTime(record.updatedAt) : "queued"))}</small>{error ? <small className="danger-text">{error}</small> : null}</div><div className="video-session-actions-v495">{canContribute && ["queued", "processing", "retrying"].includes(record.status) ? <ClusterButton size="compact" variant="quiet" onClick={() => void cancelMediaJob(record)}>Cancel</ClusterButton> : null}{canContribute && ["failed", "cancelled"].includes(record.status) ? <ClusterButton size="compact" variant="quiet" onClick={() => void retryMediaJob(record)}>Retry</ClusterButton> : null}</div></article>; }) : <div className="empty-state"><p>No media processing jobs queued.</p></div>}</div></div>
    </section>}

    {workspaceMode === "deliverables" && <section className="video-deliverables-v495"><div className="panel"><div className="section-heading"><div><p className="eyebrow">Delivery</p><h2>Masters and required outputs</h2><p className="muted tight">Track format requirements and delivery state without pretending Cluster is an NLE.</p></div></div>{canContribute ? <div className="video-deliverable-composer-v495"><ClusterTextInput value={deliverableTitle} onChange={(event) => setDeliverableTitle(event.target.value)} placeholder="YouTube master" /><ClusterTextInput value={deliverableFormat} onChange={(event) => setDeliverableFormat(event.target.value)} placeholder="1920x1080 · H.264" /><ClusterTextInput type="date" value={deliverableDue} onChange={(event) => setDeliverableDue(event.target.value)} /><ClusterButton variant="primary" onClick={async () => { await createProductionRecord("deliverable", deliverableTitle, { dueDate: deliverableDue || null, payload: { format: deliverableFormat, sourceAssetId: selectedVideo?.id || null } }); setDeliverableTitle(""); setDeliverableDue(""); }}>Add deliverable</ClusterButton></div> : null}<div className="video-deliverable-grid-v495">{deliverables.length ? visibleDeliverables.map((record) => <article key={record.id}><header><span>{record.status || "required"}</span><strong>{record.title}</strong></header><p>{String(record.payload?.format || "Format not specified")}</p><small>{record.dueDate ? `Due ${new Date(record.dueDate).toLocaleDateString()}` : "No due date"}</small><ClusterSelect ariaLabel={`${record.title} delivery status`} value={record.status || "planned"} onChange={(value) => void patchProductionRecord(record, { status: value, progress: value === "delivered" ? 100 : record.progress || 0 })} options={[{ value: "planned", label: "Required" }, { value: "rendering", label: "Rendering" }, { value: "review", label: "Review" }, { value: "approved", label: "Approved" }, { value: "delivered", label: "Delivered" }]} /></article>) : <div className="empty-state"><p>No deliverables defined.</p></div>}</div>{deliverables.length > visibleDeliverables.length ? <ClusterButton size="compact" variant="quiet" onClick={() => setDeliverableRenderLimit((current) => current + VIDEO_RECORD_RENDER_BATCH)}>Show {Math.min(VIDEO_RECORD_RENDER_BATCH, deliverables.length - visibleDeliverables.length)} more deliverables</ClusterButton> : null}</div></section>}
  </section>;
}
