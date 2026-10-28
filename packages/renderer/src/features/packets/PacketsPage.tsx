import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterModal } from "../../components/ClusterModal";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { SHARED_CREATE_COMPLETED_EVENT, type StudioAudience } from "@cluster/shared";
import { API_URL, api, queryApi } from "../../core/api";
import { downloadAuthenticatedClusterFile } from "../../core/browser-download-transfers";
import { useServerState } from "../../core/server-state";
import { useResourceChangeRefresh } from "../../core/use-resource-change-refresh";
import { ClusterIcon } from "../../components/ClusterIcon";
import { RequestErrorState } from "../../components/RequestState";
import { LibraryIcon, folderIconName, itemIconName } from "../library/LibraryIcons";
import { LibraryPreview, LibraryViewerModal } from "../library/LibraryMediaPreview";
import { libraryFileUrl } from "../library/library-file-url";
import type { LibraryItem, LibraryWorkspace, User } from "../library/library-types";
import "../library/library-workspace.css";
import "./packets.css";
import { runtimeStyle } from "../../core/runtime-style";
import { StudioFormRunner, type StudioFormDocument } from "../studio-systems/StudioFormRunner";
import { StudioAudiencePicker } from "../studio-systems/StudioAudiencePicker";
import { readClusterWorkPacketContext, readClusterWorkPolicyContext } from "../workflow/work-navigation";
import { CLUSTER_AUTHORIZED_PACKET_NAVIGATION_EVENT } from "../workflow/authorized-packet-navigation";
import type { ClusterWorkNavigationTarget } from "../workflow/work-navigation-types";
import { openSharedCreate } from "../create/shared-create-handoff";
import { PersonnelRecordsPanel } from "../people/PersonnelRecordsPanel";
import { createPacketWorkflowGate } from "./packet-workflow-gate";

type PacketStats = {
  total: number;
  pdfs: number;
  videos: number;
  links: number;
  files: number;
  updatedAt?: string | null;
};

type PacketDefinition = {
  id?: string;
  kind: "knowledge" | "training" | "onboarding" | "policy" | "procedure" | "handoff";
  versionLabel: string;
  audience?: StudioAudience;
  completionMode: "none" | "read" | "acknowledge" | "form";
  completionFormId?: string | null;
  required: boolean;
  dueDays?: number | null;
  recertifyDays?: number | null;
  recordCompletion?: boolean;
};
type PacketCompletion = { id: string; mode: string; formSubmissionId?: string | null; completedAt: string; validUntil?: string | null };
type PacketFolder = LibraryItem & { canAuthor: boolean; packetStats: PacketStats; packetDefinition: PacketDefinition; completion?: PacketCompletion | null; completionForm?: { id: string; key: string; title: string } | null; completionFormSubmissionId?: string | null };
type PacketsResponse = { root: LibraryItem; packets: PacketFolder[] };
type PublishedPacketRelease = { releaseId: string; versionLabel: string; publishedAt: string; contentsCount: number; deliveryStatus: "derivative_required" | "partially_available";
  requiredAcknowledgment?: { dueAt: string | null; assignedAt: string; acknowledgedAt: string | null } | null };
type PacketPublishPreview = { versionLabel: string; sourceCount: number; eligibleNotes: number; noteBytes: number; eligibleTextFiles: number; textFileBytes: number; eligibleImages: number; imageBytes: number; eligibleAudioPreviews: number; audioPreviewBytes: number; candidateSourcePdfs: number; pendingDerivatives: number; snapshotSha256: string };
type ManagedPacketRelease = { id: string; versionLabel: string; manifestSha256: string; revokedAt: string | null; revocationReason: string | null };
type PublishedPacketCatalog = { releaseId: string; versionLabel: string; manifestSha256: string; publicationWatermarkLabel?: string; contents: { position: number; title: string; kind: string; sizeBytes: number | null; downloadable: boolean; format?: "txt" | "pdf" | "webp" | "wav" | null; previewOnly?: boolean }[]; deliveryStatus: "derivative_required" | "partially_available" };
type PacketReleaseAcknowledgment = { acknowledgedAt: string; manifestSha256: string };
type PacketAcknowledgmentReport = {
  releaseId: string; versionLabel: string; revoked: boolean; total: number; nextCursor: string | null;
  acknowledgments: Array<{ id: string; recipientId: string; acknowledgedAt: string;
    recipient: { id: string; username: string; displayName: string } | null }>;
};
type PacketDeliveryEvidence = {
  releaseId: string; versionLabel: string; revoked: boolean; total: number; bundleCount: number; artifactCount: number;
  nextCursor: string | null; evidenceType: "authorized_issuance_not_confirmed_download";
  receipts: Array<{ id: string; recipientId: string; recipient: { id: string; username: string; displayName: string } | null;
    kind: "artifact" | "bundle"; position: number | null; sizeBytes: number; issuedAt: string; derivativeHash: string }>;
};
type PacketRequirementStatus = "all" | "awaiting" | "overdue" | "due_soon" | "acknowledged" | "no_deadline" | "integrity_issue";
type PacketRequirementSummary = { total: number; acknowledged: number; awaiting: number; overdue: number;
  dueSoon: number; noDeadline: number; integrityIssues: number; asOf: string;
  evidenceType: "explicit_release_acknowledgment_not_download_or_read_proof" };
type PacketRequirementReport = { releaseId: string; versionLabel: string; revoked: boolean; total?: number;
  status?: PacketRequirementStatus; asOf?: string; nextCursor: string | null;
  requirements: Array<{ id: string; recipientId: string; assignedAt: string; dueAt: string | null; acknowledgedAt: string | null; lastRemindedAt: string | null;
    recipient: { id: string; username: string; displayName: string } | null; integrityIssue?: boolean }> };
type PacketRequirementCandidate = { id: string; username: string; displayName: string | null };
type PacketView = "grid" | "list";
type ResourceFilter = "all" | "pdf" | "video" | "link" | "file";

type PacketCompletionFormOption = { id: string; key: string; title: string; purpose: string; version: number };
type PacketAuthorDraft = {
  title: string;
  description: string;
  kind: PacketDefinition["kind"];
  versionLabel: string;
  audience: StudioAudience;
  completionMode: PacketDefinition["completionMode"];
  completionFormId: string;
  required: boolean;
  dueDays: string;
  recertifyDays: string;
  recordCompletion: boolean;
};

type StudioPolicyEntry = {
  policy: { id: string; title: string; summary?: string | null; requiredForAccess: boolean };
  version: { id: string; versionLabel: string; bodyMarkdown: string; acceptanceMode: "none" | "acknowledge" | "initials" | "signature" | "form"; formVersionId?: string | null };
  formDocument?: StudioFormDocument | null;
  existingFormSubmissionId?: string | null;
  accepted: boolean;
  acceptance?: { acceptedAt: string; acceptanceMode: string } | null;
};
type StudioPolicyFeed = { policies: StudioPolicyEntry[]; blocking: string[] };

const EVERYONE: StudioAudience = { mode: "all", targets: [] };
function emptyPacketDraft(): PacketAuthorDraft { return { title: "", description: "", kind: "knowledge", versionLabel: "1.0", audience: { ...EVERYONE, targets: [] }, completionMode: "none", completionFormId: "", required: false, dueDays: "", recertifyDays: "", recordCompletion: false }; }

function PacketAuthorFields({ value, onChange, completionForms, autoFocus = false }: { value: PacketAuthorDraft; onChange: (value: PacketAuthorDraft) => void; completionForms: PacketCompletionFormOption[]; autoFocus?: boolean }) {
  const patch = (next: Partial<PacketAuthorDraft>) => onChange({ ...value, ...next });
  return <><label><span>Name</span><ClusterTextInput autoFocus={autoFocus} value={value.title} onChange={(event) => patch({ title: event.target.value })} /></label><label><span>Description</span><ClusterTextArea value={value.description} onChange={(event) => patch({ description: event.target.value })} /></label><div className="packet-create-grid-v34f"><label><span>Purpose</span><ClusterNativeSelect value={value.kind} onChange={(event) => patch({ kind: event.target.value as PacketDefinition["kind"] })}><option value="knowledge">Knowledge</option><option value="training">Training</option><option value="onboarding">Onboarding</option><option value="policy">Policy</option><option value="procedure">Procedure</option><option value="handoff">Handoff</option></ClusterNativeSelect></label><label><span>Version</span><ClusterInput value={value.versionLabel} onChange={(event) => patch({ versionLabel: event.target.value })} placeholder="1.0" /></label><label><span>Completion</span><ClusterNativeSelect value={value.completionMode} onChange={(event) => patch({ completionMode: event.target.value as PacketDefinition["completionMode"], completionFormId: event.target.value === "form" ? value.completionFormId : "" })}><option value="none">No completion tracking</option><option value="read">Read</option><option value="acknowledge">Acknowledge</option><option value="form">Reusable form</option></ClusterNativeSelect></label><label><span>Due window</span><ClusterInput type="number" min="1" max="3650" value={value.dueDays} onChange={(event) => patch({ dueDays: event.target.value })} placeholder="Days after assignment" /></label><label><span>Recertify</span><ClusterInput type="number" min="1" max="3650" value={value.recertifyDays} onChange={(event) => patch({ recertifyDays: event.target.value })} placeholder="Days until renewal" /></label>{value.completionMode === "form" && <label className="span-2"><span>Completion form</span><ClusterNativeSelect value={value.completionFormId} onChange={(event) => patch({ completionFormId: event.target.value })}><option value="">Choose reusable form…</option>{completionForms.map((form) => <option key={form.id} value={form.id}>{form.title} · v{form.version}</option>)}</ClusterNativeSelect></label>}<label className="packet-required-toggle-v34f"><ClusterInput type="checkbox" checked={value.required} onChange={(event) => patch({ required: event.target.checked })} /><span>Required packet</span></label><label className="packet-required-toggle-v34f"><ClusterInput type="checkbox" checked={value.recordCompletion} onChange={(event) => patch({ recordCompletion: event.target.checked })} /><span>Save completion to Records</span></label></div><div><strong>Audience</strong><StudioAudiencePicker value={value.audience} onChange={(audience) => patch({ audience })} compact /></div></>;
}

type PacketSettings = {
  packetsDefaultView?: string;
  packetsShowDescriptions?: boolean;
  packetsAllowYoutube?: boolean;
  packetsAllowPdf?: boolean;
  packetsAllowExternalLinks?: boolean;
  packetsFeaturedLimit?: number;
};

function isPdfResource(item: LibraryItem) {
  return item.mimeType === "application/pdf" || item.extension?.toLowerCase() === "pdf" || item.previewKind === "pdf";
}

function isVideoResource(item: LibraryItem) {
  return item.previewKind === "video" || item.type === "youtube-video" || item.type === "youtube-playlist";
}

function isLinkResource(item: LibraryItem) {
  return item.type === "link" || item.previewKind === "external";
}

function resourceKind(item: LibraryItem) {
  if (isPdfResource(item)) return "PDF";
  if (item.type === "youtube-playlist") return "Playlist";
  if (item.type === "youtube-video") return "YouTube";
  if (item.previewKind === "video") return "Video";
  if (item.previewKind === "audio") return "Audio";
  if (item.previewKind === "model") return "3D model";
  if (item.type === "link") return "Link";
  return item.extension?.toUpperCase() || item.mimeGroup || "File";
}

function resourceAllowed(item: LibraryItem, settings?: PacketSettings) {
  if (isPdfResource(item) && settings?.packetsAllowPdf === false) return false;
  if ((item.type === "youtube-video" || item.type === "youtube-playlist") && settings?.packetsAllowYoutube === false) return false;
  if (isLinkResource(item) && settings?.packetsAllowExternalLinks === false) return false;
  return true;
}

function resourceMatchesFilter(item: LibraryItem, filter: ResourceFilter) {
  if (filter === "all") return true;
  if (filter === "pdf") return isPdfResource(item);
  if (filter === "video") return isVideoResource(item);
  if (filter === "link") return isLinkResource(item);
  return !isPdfResource(item) && !isVideoResource(item) && !isLinkResource(item);
}

function packetUpdated(packet: PacketFolder) {
  const date = new Date(packet.packetStats.updatedAt || packet.updatedAt);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function packetOrder(item: LibraryItem) {
  const value = Number(item.metadata?.packetOrder);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function formatBytes(value?: number | null) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export default function PacketsPage({ currentUser, settings, onOpenLibrary, onOpenProject, initialView = "packets" }: { currentUser: User; settings?: PacketSettings; onOpenLibrary: (folderId: string) => void; onOpenProject?: (projectId: string) => void; initialView?: "packets" | "records" | "policies" }) {
  const [root, setRoot] = useState<LibraryItem | null>(null);
  const [packets, setPackets] = useState<PacketFolder[]>([]);
  const [knowledgeView, setKnowledgeView] = useState<"packets" | "records" | "policies">(initialView);
  const [policyFeed, setPolicyFeed] = useState<StudioPolicyFeed>({ policies: [], blocking: [] });
  const [activePolicyId, setActivePolicyId] = useState("");
  const [policyPending, setPolicyPending] = useState(false);
  const policyWriteGate = useRef(createPacketWorkflowGate());
  const packetWriteGate = useRef(createPacketWorkflowGate());
  const policyReadSequence = useRef(0);
  useEffect(() => () => {
    policyReadSequence.current += 1;
    policyWriteGate.current.invalidate();
    packetWriteGate.current.invalidate();
  }, []);
  const [policyError, setPolicyError] = useState("");
  const [policyInitials, setPolicyInitials] = useState("");
  const [policySignature, setPolicySignature] = useState("");
  const [activePacketId, setActivePacketId] = useServerState<string>("user", "packets.active-packet", "");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [activeItemId, setActiveItemId] = useServerState<string>("user", "packets.active-resource", "");
  const [packetQuery, setPacketQuery] = useState("");
  const [resourceQuery, setResourceQuery] = useState("");
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>("all");
  const [view, setView] = useState<PacketView>(() => settings?.packetsDefaultView === "grid" ? "grid" : "list");
  const [catalogOpen, setCatalogOpen] = useState(true);
  useEffect(() => { setKnowledgeView(initialView); setCatalogOpen(true); }, [initialView]);
  const [loading, setLoading] = useState(true);
  const [loadingPacket, setLoadingPacket] = useState(false);
  const [editingDefinition, setEditingDefinition] = useState(false);
  const [definitionDraft, setDefinitionDraft] = useState<PacketAuthorDraft>(() => emptyPacketDraft());
  const [completionForms, setCompletionForms] = useState<PacketCompletionFormOption[]>([]);
  const [message, setMessage] = useState("");
  const [completionPending, setCompletionPending] = useState(false);
  const [publicationPending, setPublicationPending] = useState(false);
  const [publicationWatermarkLabel, setPublicationWatermarkLabel] = useState("");
  const [publicationPreview, setPublicationPreview] = useState<PacketPublishPreview | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [publishedReleases, setPublishedReleases] = useState<PublishedPacketRelease[]>([]);
  const [publishedCatalog, setPublishedCatalog] = useState<PublishedPacketCatalog | null>(null);
  const [releaseAcknowledgment, setReleaseAcknowledgment] = useState<PacketReleaseAcknowledgment | null>(null);
  const [acknowledgmentConfirmed, setAcknowledgmentConfirmed] = useState(false);
  const [acknowledgmentPending, setAcknowledgmentPending] = useState(false);
  const [acknowledgmentError, setAcknowledgmentError] = useState("");
  const [acknowledgmentReport, setAcknowledgmentReport] = useState<PacketAcknowledgmentReport | null>(null);
  const [acknowledgmentReportPending, setAcknowledgmentReportPending] = useState(false);
  const [acknowledgmentReportError, setAcknowledgmentReportError] = useState("");
  const acknowledgmentReportSequence = useRef(0);
  const [releaseLoadError, setReleaseLoadError] = useState("");
  const deliveryEvidenceSequence = useRef(0);
  const [deliveryEvidence, setDeliveryEvidence] = useState<PacketDeliveryEvidence | null>(null);
  const [deliveryEvidencePending, setDeliveryEvidencePending] = useState(false);
  const [deliveryEvidenceError, setDeliveryEvidenceError] = useState("");
  const [managedReleases, setManagedReleases] = useState<ManagedPacketRelease[]>([]);
  const [requirementReleaseId, setRequirementReleaseId] = useState("");
  const [requirementCandidates, setRequirementCandidates] = useState<PacketRequirementCandidate[]>([]);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateCursor, setCandidateCursor] = useState<string | null>(null);
  const [candidateLoadedQuery, setCandidateLoadedQuery] = useState("");
  const [candidatePending, setCandidatePending] = useState(false);
  const candidateSequence = useRef(0);
  const [requirementRecipients, setRequirementRecipients] = useState<string[]>([]);
  const [requirementDueDate, setRequirementDueDate] = useState("");
  const [requirementPending, setRequirementPending] = useState(false);
  const [requirementError, setRequirementError] = useState("");
  const [requirementReport, setRequirementReport] = useState<PacketRequirementReport | null>(null);
  const [requirementSummary, setRequirementSummary] = useState<PacketRequirementSummary | null>(null);
  const [requirementStatus, setRequirementStatus] = useState<PacketRequirementStatus>("all");
  const requirementSequence = useRef(0);
  const [revokeReleaseId, setRevokeReleaseId] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeConfirmation, setRevokeConfirmation] = useState("");
  const [revokePending, setRevokePending] = useState(false);
  const [releaseRefreshIndex, setReleaseRefreshIndex] = useState(0);
  const [packetFormDocument, setPacketFormDocument] = useState<StudioFormDocument | null>(null);
  const [packetFormError, setPacketFormError] = useState("");
  const [pdfWorkspaceOpen, setPdfWorkspaceOpen] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [packetLoadError, setPacketLoadError] = useState<unknown>(null);
  const packetCatalogSequence = useRef(0);
  const packetContentsSequence = useRef(0);
  const releaseCatalogSequence = useRef(0);

  const activePacket = packets.find((packet) => packet.id === activePacketId) || null;
  const activePolicy = policyFeed.policies.find((entry) => entry.policy.id === activePolicyId) || null;

  async function loadPackets(selectId?: string, force = false, preserveMessage = false): Promise<boolean> {
    const sequence = ++packetCatalogSequence.current;
    setLoading(true); setLoadError(null); if (!preserveMessage) setMessage("");
    try {
      const response = await queryApi<PacketsResponse>("/api/packets", { staleMs: 20_000, maxAgeMs: 10 * 60_000, force, tags: ["library", "packets"] });
      if (sequence !== packetCatalogSequence.current) return false;
      setRoot(response.root);
      setPackets(response.packets);
      const requested = selectId || activePacketId || response.packets[0]?.id || "";
      const exists = response.packets.some((packet) => packet.id === requested);
      // Explicit links must never silently open a different Packet. A second
      // authorization check can fail after navigation admission or on reload.
      if (selectId && !exists) {
        setActivePacketId("");
        setLoadError(new Error("The linked Packet is not available to you."));
      } else {
        setActivePacketId(exists ? requested : response.packets[0]?.id || "");
      }
      return !selectId || exists;
    } catch (error) { if (sequence === packetCatalogSequence.current) setLoadError(error); return false; }
    finally { if (sequence === packetCatalogSequence.current) setLoading(false); }
  }

  useEffect(() => {
    const handleCreated = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: string; entity?: { id?: string } }>).detail;
      if (detail?.mode !== "packet") return;
      void loadPackets(detail.entity?.id || undefined, true);
    };
    window.addEventListener(SHARED_CREATE_COMPLETED_EVENT, handleCreated);
    return () => window.removeEventListener(SHARED_CREATE_COMPLETED_EVENT, handleCreated);
  }, [activePacketId]);

  async function loadPolicies(selectId?: string, force = false, keepSelection = false): Promise<boolean> {
    const sequence = ++policyReadSequence.current;
    setPolicyError("");
    try {
      const response = await queryApi<StudioPolicyFeed>("/api/studio-policies/required", {
        staleMs: 10_000, maxAgeMs: 2 * 60_000, force, tags: ["studio-systems", "policies", "work"],
      });
      if (sequence !== policyReadSequence.current) return false;
      setPolicyFeed(response);
      const requested = selectId || activePolicyId || response.policies[0]?.policy.id || "";
      const exists = response.policies.some((entry) => entry.policy.id === requested);
      if (selectId && !exists) {
        if (keepSelection) return false;
        setActivePolicyId("");
        setPolicyError("The linked Studio Policy is not available to you.");
      } else if (!keepSelection) setActivePolicyId(exists ? requested : response.policies[0]?.policy.id || "");
      return true;
    } catch (error) {
      if (sequence === policyReadSequence.current)
        setPolicyError(error instanceof Error ? error.message : "Policies could not be loaded.");
      return false;
    }
  }

  async function acceptPolicy(entry: StudioPolicyEntry, extra: Record<string, unknown> = {}) {
    if (entry.accepted || entry.version.acceptanceMode === "none" || policyWriteGate.current.busy()) return;
    // A review decision is identified by its immutable published version, not
    // whichever policy the user is currently viewing after an async request.
    const versionId = entry.version.id, policyId = entry.policy.id;
    setPolicyPending(true); setPolicyError("");
    const outcome = await policyWriteGate.current.run(() => api<{ acceptedAt: string }>(`/api/studio-policies/${encodeURIComponent(versionId)}/accept`, {
      method: "POST", body: JSON.stringify({ mode: entry.version.acceptanceMode, ...extra }),
    }));
    if (outcome.status === "committed") {
      // Committed acceptance is authoritative; a failed follow-up GET must not
      // turn it into an apparent failed POST or invite duplicate submissions.
      setPolicyFeed((feed) => ({
        policies: feed.policies.map((policy) => policy.policy.id === policyId && policy.version.id === versionId
          ? { ...policy, accepted: true, acceptance: { acceptedAt: outcome.value.acceptedAt, acceptanceMode: entry.version.acceptanceMode } } : policy),
        blocking: feed.blocking.filter((id) => id !== versionId),
      }));
      setPolicyInitials(""); setPolicySignature("");
      const refreshed = await loadPolicies(undefined, true, true);
      if (!refreshed) setPolicyError("Policy acceptance saved. The policy list could not refresh; reload to reconcile its status.");
    } else if (outcome.status === "failed") {
      setPolicyError(outcome.error instanceof Error ? outcome.error.message : "Policy acceptance could not be saved.");
    }
    setPolicyPending(false);
  }

  async function loadPacket(packetId: string, force = false) {
    const sequence = ++packetContentsSequence.current;
    if (!packetId) { setItems([]); setActiveItemId(""); return; }
    // Packet delivery permission does not confer underlying Library source
    // access. Recipients consume published detached catalogues only.
    if (!packets.find((entry) => entry.id === packetId)?.canAuthor) {
      setItems([]); setActiveItemId(""); setLoadingPacket(false); setPacketLoadError(null); return;
    }
    setLoadingPacket(true); setPacketLoadError(null); setResourceQuery(""); setResourceFilter("all");
    try {
      const params = new URLSearchParams({ parentId: packetId, scope: "folder", status: "active", sort: "title-asc", includeContext: "0", limit: "200" });
      const response = await queryApi<LibraryWorkspace>(`/api/library/workspace?${params}`, { staleMs: 15_000, maxAgeMs: 10 * 60_000, force, tags: ["library", `packet:${packetId}`] });
      if (sequence !== packetContentsSequence.current) return;
      const allowed = response.items
        .filter((item) => resourceAllowed(item, settings))
        .sort((left, right) => packetOrder(left) - packetOrder(right) || Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || left.title.localeCompare(right.title));
      setItems(allowed);
      setActiveItemId((current) => allowed.some((item) => item.id === current) ? current : allowed[0]?.id || "");
    } catch (error) { if (sequence === packetContentsSequence.current) setPacketLoadError(error); }
    finally { if (sequence === packetContentsSequence.current) setLoadingPacket(false); }
  }

  useEffect(() => {
    const deepPacketId = readClusterWorkPacketContext() || "";
    const deepPolicyId = readClusterWorkPolicyContext() || "";
    void loadPackets(deepPacketId || undefined).then(() => { if (deepPacketId) { setKnowledgeView("packets"); setCatalogOpen(false); } });
    void loadPolicies(deepPolicyId || undefined).then(() => { if (deepPolicyId) { setKnowledgeView("policies"); setCatalogOpen(false); } });
    const openKnowledgeTarget = (event: Event) => {
      const target = (event as CustomEvent<ClusterWorkNavigationTarget>).detail;
      if (target?.screen !== "packets") return;
      if (target.inspectScope === "records") { policyReadSequence.current += 1; setKnowledgeView("records"); setCatalogOpen(true); return; }
      if (target.policyId) { setKnowledgeView("policies"); void loadPolicies(target.policyId, true).then(() => setCatalogOpen(false)); return; }
      if (target.packetId) { setKnowledgeView("packets"); void loadPackets(target.packetId, true).then(() => setCatalogOpen(false)); }
    };
    window.addEventListener(CLUSTER_AUTHORIZED_PACKET_NAVIGATION_EVENT, openKnowledgeTarget);
    return () => {
      window.removeEventListener(CLUSTER_AUTHORIZED_PACKET_NAVIGATION_EVENT, openKnowledgeTarget);
      packetCatalogSequence.current += 1; packetContentsSequence.current += 1; policyReadSequence.current += 1;
    };
  }, []);
  useEffect(() => { void loadPacket(activePacketId); }, [activePacketId, activePacket?.canAuthor, settings?.packetsAllowPdf, settings?.packetsAllowYoutube, settings?.packetsAllowExternalLinks]);
  useEffect(() => {
    let cancelled = false;
    ++releaseCatalogSequence.current;
    setPublishedReleases([]); setPublishedCatalog(null); setReleaseAcknowledgment(null);
    setAcknowledgmentConfirmed(false); setAcknowledgmentError(""); setAcknowledgmentPending(false);
    ++acknowledgmentReportSequence.current; setAcknowledgmentReport(null);
    setAcknowledgmentReportError(""); setAcknowledgmentReportPending(false); setReleaseLoadError(""); setPublicationPreview(null); setPreviewPending(false);
    setManagedReleases([]); setRevokeReleaseId(""); setRevokeReason(""); setRevokeConfirmation("");
    ++requirementSequence.current; ++candidateSequence.current; setRequirementReleaseId(""); setRequirementCandidates([]);
    setCandidateQuery(""); setCandidateLoadedQuery(""); setCandidateCursor(null); setCandidatePending(false);
    setRequirementRecipients([]); setRequirementDueDate(""); setRequirementReport(null); setRequirementSummary(null);
    setRequirementStatus("all"); setRequirementError(""); setRequirementPending(false);
    ++deliveryEvidenceSequence.current;
    setDeliveryEvidence(null); setDeliveryEvidencePending(false); setDeliveryEvidenceError("");
    if (!activePacketId) return () => { cancelled = true; };
    if (packets.find((row) => row.id === activePacketId)?.canAuthor) {
      void api<{ releases: ManagedPacketRelease[] }>(`/api/packets/${activePacketId}/releases`).then((result) => {
        if (!cancelled) setManagedReleases(result.releases);
      }).catch((error) => { if (!cancelled) setReleaseLoadError(error instanceof Error ? error.message : "Release management unavailable."); });
    }
    void api<{ releases: PublishedPacketRelease[] }>(`/api/packets/${activePacketId}/deliveries`).then((result) => {
      if (!cancelled) setPublishedReleases(result.releases);
    }).catch((error) => { if (!cancelled) setReleaseLoadError(error instanceof Error ? error.message : "Published releases unavailable."); });
    return () => { cancelled = true; };
  }, [activePacketId, publicationPending, releaseRefreshIndex, currentUser.isAdmin, activePacket?.canAuthor]);

  async function loadReleaseRequirements(releaseId: string, cursor?: string, status: PacketRequirementStatus = requirementStatus, allowPending = false): Promise<boolean> {
    if (!activePacketId || (requirementPending && !allowPending)) return false;
    const packetId = activePacketId;
    const sequence = ++requirementSequence.current;
    setRequirementPending(true); setRequirementError("");
    if (!cursor) { if (releaseId !== requirementReleaseId) { setRequirementRecipients([]);
        ++candidateSequence.current; setCandidatePending(false); setCandidateCursor(null); setCandidateLoadedQuery(""); setRequirementCandidates([]); }
      setRequirementReleaseId(releaseId); setRequirementReport(null);
      setRequirementStatus(status); setRequirementSummary(null); }
    try {
      const url = `/api/packets/${encodeURIComponent(packetId)}/releases/${encodeURIComponent(releaseId)}`;
      const [summaryResult, candidates] = await Promise.all([
        cursor ? Promise.resolve(null) : api<{ summary: PacketRequirementSummary }>(`${url}/requirements/summary`),
        cursor || releaseId === requirementReleaseId ? Promise.resolve(null) :
          api<{ candidates: PacketRequirementCandidate[]; nextCursor: string | null }>(`${url}/requirement-candidates?limit=75`),
      ]);
      if (sequence !== requirementSequence.current) return false;
      const asOf = summaryResult?.summary.asOf || requirementSummary?.asOf;
      const query = new URLSearchParams({ limit: "50", status });
      if (cursor) query.set("cursor", cursor);
      if (status !== "all" && asOf) query.set("asOf", asOf);
      const report = await api<PacketRequirementReport>(`${url}/requirements?${query.toString()}`);
      if (sequence !== requirementSequence.current) return false;
      setRequirementReport((previous) => cursor && previous?.releaseId === releaseId && previous?.status === status
        ? { ...report, requirements: [...previous.requirements, ...report.requirements] } : { ...report, status });
      if (summaryResult) setRequirementSummary(summaryResult.summary);
      if (candidates) { setRequirementCandidates(candidates.candidates); setCandidateCursor(candidates.nextCursor);
        setCandidateQuery(""); setCandidateLoadedQuery(""); }
      return true;
    } catch (error) {
      if (sequence === requirementSequence.current) setRequirementError(error instanceof Error ? error.message : "Requirement evidence unavailable.");
      return false;
    } finally { if (sequence === requirementSequence.current) setRequirementPending(false); }
  }

  async function searchRequirementCandidates(cursor?: string) {
    if (!activePacketId || !requirementReleaseId || candidatePending) return;
    const packetId = activePacketId, releaseId = requirementReleaseId;
    const sequence = ++candidateSequence.current;
    setCandidatePending(true); setRequirementError("");
    try {
      const searchText = cursor ? candidateLoadedQuery : candidateQuery.trim();
      const query = new URLSearchParams({ limit: "75", query: searchText });
      if (cursor) query.set("cursor", cursor);
      const result = await api<{ candidates: PacketRequirementCandidate[]; nextCursor: string | null }>(
        `/api/packets/${encodeURIComponent(packetId)}/releases/${encodeURIComponent(releaseId)}/requirement-candidates?${query.toString()}`);
      if (sequence !== candidateSequence.current) return;
      setRequirementCandidates((previous) => cursor ? [...previous, ...result.candidates] : result.candidates);
      setCandidateCursor(result.nextCursor);
      if (!cursor) setCandidateLoadedQuery(searchText);
    } catch (error) {
      if (sequence === candidateSequence.current) setRequirementError(error instanceof Error ? error.message : "Recipient search unavailable.");
    } finally { if (sequence === candidateSequence.current) setCandidatePending(false); }
  }

  async function sendRequiredPacketReminder(requirementId: string) {
    if (!activePacketId || !requirementReleaseId || packetWriteGate.current.busy()) return;
    const release = managedReleases.find((row) => row.id === requirementReleaseId && !row.revokedAt);
    if (!release) return;
    const packetId = activePacketId;
    setRequirementPending(true); setRequirementError("");
    const result = await packetWriteGate.current.run(() => api(`/api/packets/${encodeURIComponent(packetId)}/releases/${encodeURIComponent(release.id)}/requirements/${encodeURIComponent(requirementId)}/remind`, {
      method: "POST", body: JSON.stringify({ expectedManifestSha256: release.manifestSha256 }),
    }));
    if (result.status === "committed") {
      const refreshed = await loadReleaseRequirements(release.id, undefined, requirementStatus, true);
      if (!refreshed) setRequirementError("Reminder committed. Reload the release requirements to confirm delivery evidence.");
    } else if (result.status === "failed") {
      setRequirementError(result.error instanceof Error ? result.error.message : "Reminder could not be sent.");
      setRequirementPending(false);
    }
  }

  async function assignRequiredReleaseAcknowledgments() {
    if (!activePacketId || !requirementReleaseId || !requirementRecipients.length || packetWriteGate.current.busy()) return;
    const release = managedReleases.find((row) => row.id === requirementReleaseId && !row.revokedAt);
    if (!release) return;
    const packetId = activePacketId, recipients = [...requirementRecipients];
    setRequirementPending(true); setRequirementError("");
    const dueAt = requirementDueDate ? new Date(`${requirementDueDate}T23:59:59`).toISOString() : null;
    const result = await packetWriteGate.current.run(() => api(`/api/packets/${encodeURIComponent(packetId)}/releases/${encodeURIComponent(release.id)}/requirements`, {
      method: "POST", body: JSON.stringify({ expectedManifestSha256: release.manifestSha256, recipientIds: recipients, dueAt }),
    }));
    if (result.status === "committed") {
      setRequirementRecipients((current) => current.filter((id) => !recipients.includes(id)));
      const refreshed = await loadReleaseRequirements(release.id, undefined, requirementStatus, true);
      if (!refreshed) setRequirementError("Assignments saved. Reload the release requirements to reconcile their status.");
    } else if (result.status === "failed") {
      setRequirementError(result.error instanceof Error ? result.error.message : "Required delivery could not be saved.");
      setRequirementPending(false);
    }
  }

  async function inspectDeliveryEvidence(releaseId: string, cursor?: string) {
    if (!currentUser.isAdmin || !activePacketId || deliveryEvidencePending) return;
    const packetId = activePacketId;
    const sequence = ++deliveryEvidenceSequence.current;
    setDeliveryEvidencePending(true); setDeliveryEvidenceError("");
    if (!cursor) setDeliveryEvidence(null);
    try {
      const result = await api<PacketDeliveryEvidence>(`/api/packets/${encodeURIComponent(packetId)}/releases/${encodeURIComponent(releaseId)}/delivery-evidence?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      // A user may switch Packet while a request is still in flight; don't
      // leak previous Packet's report into the next Packet's inspector.
      if (deliveryEvidenceSequence.current !== sequence) return;
      setDeliveryEvidence((previous) => cursor && previous?.releaseId === releaseId ? { ...result, receipts: [...previous.receipts, ...result.receipts] } : result);
    } catch (error) { if (deliveryEvidenceSequence.current === sequence) setDeliveryEvidenceError(error instanceof Error ? error.message : "Delivery evidence unavailable."); }
    finally { if (deliveryEvidenceSequence.current === sequence) setDeliveryEvidencePending(false); }
  }

  async function revokePublishedRelease() {
    if (!currentUser.isAdmin || !activePacketId || packetWriteGate.current.busy() || revokeConfirmation !== "REVOKE RELEASE" || revokeReason.trim().length < 10) return;
    const target = managedReleases.find((release) => release.id === revokeReleaseId && !release.revokedAt);
    if (!target) return;
    const packetId = activePacketId, reason = revokeReason.trim();
    setRevokePending(true); setMessage("");
    const outcome = await packetWriteGate.current.run(() => api(`/api/packets/${encodeURIComponent(packetId)}/releases/${encodeURIComponent(target.id)}/revoke`, {
      method: "POST", body: JSON.stringify({ confirmation: "REVOKE RELEASE", reason, expectedManifestSha256: target.manifestSha256 }),
    }));
    if (outcome.status === "committed") {
      // Revocation succeeded; never offer a stale downloadable catalogue.
      setPublishedCatalog(null);
      setManagedReleases((rows) => rows.map((row) => row.id === target.id ? { ...row, revokedAt: new Date().toISOString() } : row));
      setMessage(`Packet release v${target.versionLabel} revoked. Prior download links can no longer be used.`);
      setReleaseRefreshIndex((current) => current + 1);
    } else if (outcome.status === "failed") setMessage(outcome.error instanceof Error ? outcome.error.message : "Release revocation failed.");
    setRevokePending(false);
  }

  async function inspectPublishedRelease(releaseId: string) {
    if (!activePacketId) return;
    const packetId = activePacketId;
    const sequence = ++releaseCatalogSequence.current;
    setPublishedCatalog(null); setReleaseAcknowledgment(null); setAcknowledgmentConfirmed(false);
    setAcknowledgmentPending(false); setAcknowledgmentError(""); setReleaseLoadError("");
    try {
      const [result, evidence] = await Promise.all([
        api<{ catalog: PublishedPacketCatalog }>(`/api/packets/${encodeURIComponent(packetId)}/deliveries/${encodeURIComponent(releaseId)}/catalog`),
        api<{ acknowledgment: PacketReleaseAcknowledgment | null }>(`/api/packets/${encodeURIComponent(packetId)}/deliveries/${encodeURIComponent(releaseId)}/acknowledgment`),
      ]);
      if (sequence === releaseCatalogSequence.current) {
        setPublishedCatalog(result.catalog); setReleaseAcknowledgment(evidence.acknowledgment);
      }
    } catch (error) { if (sequence === releaseCatalogSequence.current) setReleaseLoadError(error instanceof Error ? error.message : "Release integrity check failed."); }
  }
  async function acknowledgePublishedRelease() {
    if (!activePacketId || !publishedCatalog || releaseAcknowledgment || !acknowledgmentConfirmed || packetWriteGate.current.busy()) return;
    const packetId = activePacketId, catalog = publishedCatalog;
    const sequence = releaseCatalogSequence.current;
    setAcknowledgmentPending(true); setAcknowledgmentError("");
    const outcome = await packetWriteGate.current.run(() => api<{ acknowledgedAt: string }>(
      `/api/packets/${encodeURIComponent(packetId)}/deliveries/${encodeURIComponent(catalog.releaseId)}/acknowledge`, {
        method: "POST", body: JSON.stringify({ expectedManifestSha256: catalog.manifestSha256,
          expectedVersionLabel: catalog.versionLabel, confirmed: true }),
      }));
    if (sequence === releaseCatalogSequence.current) {
      if (outcome.status === "committed") {
        setReleaseAcknowledgment({ acknowledgedAt: outcome.value.acknowledgedAt, manifestSha256: catalog.manifestSha256 });
        setPublishedReleases((rows) => rows.map((row) => row.releaseId === catalog.releaseId && row.requiredAcknowledgment
          ? { ...row, requiredAcknowledgment: { ...row.requiredAcknowledgment, acknowledgedAt: outcome.value.acknowledgedAt } } : row));
        setAcknowledgmentConfirmed(false);
      } else if (outcome.status === "failed") setAcknowledgmentError(outcome.error instanceof Error ? outcome.error.message : "Acknowledgment could not be recorded. Reload the published version.");
      setAcknowledgmentPending(false);
    }
  }

  async function inspectReleaseAcknowledgments(releaseId: string, cursor?: string) {
    if (!currentUser.isAdmin || !activePacketId || acknowledgmentReportPending) return;
    const packetId = activePacketId;
    const sequence = ++acknowledgmentReportSequence.current;
    setAcknowledgmentReportPending(true); setAcknowledgmentReportError("");
    if (!cursor) setAcknowledgmentReport(null);
    try {
      const result = await api<PacketAcknowledgmentReport>(`/api/packets/${encodeURIComponent(packetId)}/releases/${encodeURIComponent(releaseId)}/acknowledgments?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (sequence === acknowledgmentReportSequence.current) setAcknowledgmentReport((previous) =>
        cursor && previous?.releaseId === releaseId ? { ...result, acknowledgments: [...previous.acknowledgments, ...result.acknowledgments] } : result);
    } catch (error) {
      if (sequence === acknowledgmentReportSequence.current)
        setAcknowledgmentReportError(error instanceof Error ? error.message : "Acknowledgment evidence unavailable.");
    } finally { if (sequence === acknowledgmentReportSequence.current) setAcknowledgmentReportPending(false); }
  }

  useResourceChangeRefresh(async () => {
    if (knowledgeView === "policies") { await loadPolicies(activePolicyId || undefined, true); return; }
    if (knowledgeView === "records") return;
    await loadPackets(activePacketId || undefined, true);
    if (activePacketId) await loadPacket(activePacketId, true);
  }, { kinds: ["packet", "library", "file", "policy", "studio_form", "form_submission"], debounceMs: 220 });
  useEffect(() => {
    let cancelled = false;
    setPacketFormDocument(null); setPacketFormError("");
    if (!activePacket || activePacket.completion || activePacket.packetDefinition.completionMode !== "form" || !activePacket.completionForm?.key) return () => { cancelled = true; };
    void api<any>(`/api/forms/${activePacket.completionForm.key}`).then((form) => {
      const version = form.versions?.[0];
      if (!cancelled && version) setPacketFormDocument({ form: { id: form.id, key: form.key, title: form.title, description: form.description }, version });
    }).catch((error) => { if (!cancelled) setPacketFormError(error instanceof Error ? error.message : "Completion form could not be loaded."); });
    return () => { cancelled = true; };
  }, [activePacket?.id, activePacket?.completion?.id, activePacket?.completionForm?.key]);
  useEffect(() => {
    const focused = Boolean((knowledgeView === "packets" ? activePacket : knowledgeView === "policies" ? activePolicy : null) && !catalogOpen);
    document.body.classList.toggle("packet-workspace-open-v268", focused);
    return () => document.body.classList.remove("packet-workspace-open-v268");
  }, [activePacket, activePolicy, knowledgeView, catalogOpen]);

  const filteredPackets = useMemo(() => {
    const needle = packetQuery.trim().toLowerCase();
    if (!needle) return packets;
    return packets.filter((packet) => [packet.title, packet.body, ...(packet.tags || [])].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }, [packets, packetQuery]);

  const visibleItems = useMemo(() => {
    const needle = resourceQuery.trim().toLowerCase();
    return items.filter((item) => resourceMatchesFilter(item, resourceFilter) && (!needle || [item.title, item.body, item.originalName, item.extension, ...(item.tags || [])].filter(Boolean).join(" ").toLowerCase().includes(needle)));
  }, [items, resourceFilter, resourceQuery]);

  useEffect(() => {
    if (visibleItems.length && !visibleItems.some((item) => item.id === activeItemId)) setActiveItemId(visibleItems[0].id);
  }, [visibleItems, activeItemId]);

  const activeItem = items.find((item) => item.id === activeItemId) || null;
  const activeVisibleIndex = visibleItems.findIndex((item) => item.id === activeItemId);
  const previousItem = activeVisibleIndex > 0 ? visibleItems[activeVisibleIndex - 1] : null;
  const nextItem = activeVisibleIndex >= 0 && activeVisibleIndex < visibleItems.length - 1 ? visibleItems[activeVisibleIndex + 1] : null;
  const resourceCounts = useMemo(() => ({
    all: items.length,
    pdf: items.filter(isPdfResource).length,
    video: items.filter(isVideoResource).length,
    link: items.filter(isLinkResource).length,
    file: items.filter((item) => resourceMatchesFilter(item, "file")).length,
  }), [items]);

  async function loadCompletionForms(force = false) {
    try { const result = await queryApi<{ forms: PacketCompletionFormOption[] }>("/api/packets/completion-forms", { force, staleMs: 30_000, tags: ["packets", "studio-systems", "forms"] }); setCompletionForms(result.forms || []); }
    catch { setCompletionForms([]); }
  }

  function beginEditDefinition() {
    if (!activePacket) return;
    const definition = activePacket.packetDefinition;
    setDefinitionDraft({ title: activePacket.title, description: activePacket.body || "", kind: definition.kind, versionLabel: definition.versionLabel || "1.0", audience: definition.audience || { mode: "all", targets: [] }, completionMode: definition.completionMode, completionFormId: definition.completionFormId || "", required: definition.required, dueDays: definition.dueDays ? String(definition.dueDays) : "", recertifyDays: definition.recertifyDays ? String(definition.recertifyDays) : "", recordCompletion: Boolean(definition.recordCompletion) });
    setEditingDefinition(true); void loadCompletionForms();
  }
  function packetPayload(value: PacketAuthorDraft) { return { title: value.title.trim(), description: value.description.trim(), kind: value.kind, versionLabel: value.versionLabel.trim() || "1.0", audience: value.audience, completionMode: value.completionMode, completionFormId: value.completionMode === "form" ? value.completionFormId || null : null, required: value.required, dueDays: value.dueDays.trim() ? Number(value.dueDays) : null, recertifyDays: value.recertifyDays.trim() ? Number(value.recertifyDays) : null, recordCompletion: value.recordCompletion }; }

  const [definitionPending, setDefinitionPending] = useState(false);
  async function savePacketDefinition() {
    if (!activePacket || packetWriteGate.current.busy()) return;
    if (!definitionDraft.title.trim()) { setMessage("Packet name is required."); return; }
    if (definitionDraft.audience.mode !== "all" && !definitionDraft.audience.targets.length) { setMessage("Choose a packet audience target or use Whole studio."); return; }
    if (definitionDraft.completionMode === "form" && !definitionDraft.completionFormId) { setMessage("Choose a reusable completion form."); return; }
    const packetId = activePacket.id, payload = packetPayload(definitionDraft);
    setDefinitionPending(true); setMessage("");
    const result = await packetWriteGate.current.run(() => api(`/api/packets/${encodeURIComponent(packetId)}/definition`, { method: "PATCH", body: JSON.stringify(payload) }));
    if (result.status === "committed") {
      setEditingDefinition(false); setMessage("Packet settings saved.");
      // A failed reconciliation must not change a committed write into failure.
      const refreshed = await loadPackets(packetId, true, true);
      if (!refreshed) setMessage("Packet settings saved. Refresh the Packet catalog to reconcile the changes.");
    } else if (result.status === "failed") setMessage(result.error instanceof Error ? result.error.message : "Packet settings could not be saved.");
    setDefinitionPending(false);
  }

  async function previewActivePacketPublication() {
    if (!activePacket || previewPending) return;
    const sequence = ++releaseCatalogSequence.current;
    setPreviewPending(true); setPublicationPreview(null); setReleaseLoadError("");
    try {
      const { preview } = await api<{ preview: PacketPublishPreview }>(`/api/packets/${activePacket.id}/releases/preview`);
      if (sequence === releaseCatalogSequence.current) setPublicationPreview(preview);
    } catch (error) { if (sequence === releaseCatalogSequence.current) setReleaseLoadError(error instanceof Error ? error.message : "Publication preview unavailable."); }
    finally { if (sequence === releaseCatalogSequence.current) setPreviewPending(false); }
  }

  async function publishActivePacket(textDerivatives = false, pdfDerivatives = false, imageDerivatives = false, sourcePdfDerivatives = false, audioDerivatives = false) {
    if (!activePacket || packetWriteGate.current.busy()) return;
    const packetId = activePacket.id;
    setPublicationPending(true); setMessage("");
    const result = await packetWriteGate.current.run(() => api<{ release: { versionLabel: string; sourceCount: number; derivativeCount: number } }>(`/api/packets/${encodeURIComponent(packetId)}/releases`, {
      method: "POST", body: JSON.stringify({ textDerivatives, pdfDerivatives, imageDerivatives, sourcePdfDerivatives, audioDerivatives,
        ...(pdfDerivatives || sourcePdfDerivatives || imageDerivatives ? { watermarkLabel: publicationWatermarkLabel } : {}) }),
    }));
    if (result.status === "committed") {
      setMessage(`Published v${result.value.release.versionLabel} with ${result.value.release.sourceCount} pinned sources and ${result.value.release.derivativeCount || 0} detached derivatives. Original Library files are never granted.`);
      setReleaseRefreshIndex((index) => index + 1);
      setPublicationPreview(null);
    } else if (result.status === "failed") setMessage(result.error instanceof Error ? result.error.message : "Packet publication failed.");
    setPublicationPending(false);
  }

  async function completeActivePacket() {
    if (!activePacket || activePacket.completion || !["read", "acknowledge"].includes(activePacket.packetDefinition.completionMode) || packetWriteGate.current.busy()) return;
    const packetId = activePacket.id, action = activePacket.packetDefinition.completionMode;
    setCompletionPending(true); setMessage("");
    const result = await packetWriteGate.current.run(() => api<{ completion: PacketCompletion }>(`/api/packets/${encodeURIComponent(packetId)}/complete`, {
      method: "POST", body: JSON.stringify({ action }),
    }));
    if (result.status === "committed") {
      setPackets((rows) => rows.map((packet) => packet.id === packetId ? { ...packet, completion: result.value.completion } : packet));
      setMessage(action === "read" ? "Marked as read." : "Packet acknowledged.");
    } else if (result.status === "failed") setMessage(result.error instanceof Error ? result.error.message : "Packet completion could not be saved.");
    setCompletionPending(false);
  }

  async function completePacketWithForm(formSubmissionId: string) {
    if (!activePacket || activePacket.completion || !formSubmissionId) return;
    if (packetWriteGate.current.busy()) throw new Error("A Packet operation is already in progress.");
    const packetId = activePacket.id;
    setCompletionPending(true); setMessage("");
    const result = await packetWriteGate.current.run(() => api<{ completion: PacketCompletion }>(`/api/packets/${encodeURIComponent(packetId)}/complete`, {
      method: "POST", body: JSON.stringify({ action: "form", formSubmissionId }),
    }));
    setCompletionPending(false);
    if (result.status === "committed") {
      setPackets((rows) => rows.map((packet) => packet.id === packetId ? { ...packet, completion: result.value.completion } : packet));
      setMessage("Packet completed.");
    } else if (result.status === "failed") {
      setMessage(result.error instanceof Error ? result.error.message : "Packet completion could not be saved.");
      throw result.error;
    }
  }

  function onWorkspaceKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target.tagName)) return;
    if (event.key === "Escape" && activePacket && !catalogOpen) { event.preventDefault(); setCatalogOpen(true); return; }
    if (!activePacket || catalogOpen) return;
    if (event.key === "ArrowUp" && previousItem) { event.preventDefault(); setActiveItemId(previousItem.id); }
    if (event.key === "ArrowDown" && nextItem) { event.preventDefault(); setActiveItemId(nextItem.id); }
    if (event.key === "Enter" && activeItem && isPdfResource(activeItem)) { event.preventDefault(); setPdfWorkspaceOpen(true); }
  }

  const totalResources = packets.reduce((sum, packet) => sum + Number(packet.packetStats?.total || 0), 0);
  const catalogLimit = Math.max(1, Math.min(100, Number(settings?.packetsFeaturedLimit || 100)));
  const visiblePackets = filteredPackets.slice(0, catalogLimit);
  const showDescriptions = settings?.packetsShowDescriptions !== false;
  const filters: Array<[ResourceFilter, string]> = [["all", "All"], ["pdf", "PDF"], ["video", "Video"], ["link", "Links"], ["file", "Files"]];

  return <section className={`page packets-page-v248 ${activePacket && !catalogOpen ? "reader-focused-v249 packet-tool-fullscreen-v268" : ""}`} data-user-id={currentUser.id} tabIndex={-1} onKeyDown={onWorkspaceKeyDown}>
    <header className="packets-header-v248">
      <div><h1>Packets</h1><span>{packets.length} packets · {totalResources} resources</span></div>
      <div className="button-row">
        <ClusterButton type="button" variant={knowledgeView === "packets" ? "primary" : "quiet"} selected={knowledgeView === "packets"} onClick={() => { setKnowledgeView("packets"); setCatalogOpen(true); }}>Packets</ClusterButton>
        <ClusterButton type="button" variant={knowledgeView === "records" ? "primary" : "quiet"} selected={knowledgeView === "records"} onClick={() => { setKnowledgeView("records"); setCatalogOpen(true); }}>Records</ClusterButton>
        <ClusterButton type="button" variant={knowledgeView === "policies" ? "primary" : "quiet"} selected={knowledgeView === "policies"} onClick={() => { setKnowledgeView("policies"); setCatalogOpen(true); void loadPolicies(undefined, true); }}>Policies</ClusterButton>
        {knowledgeView === "packets" && root && <ClusterButton type="button" className="" onClick={() => onOpenLibrary(root.id)} variant="secondary">Open in Library</ClusterButton>}
        {knowledgeView === "packets" && <ClusterButton type="button" className="" onClick={() => openSharedCreate("packet")} variant="primary"><ClusterIcon name="plus" />Create</ClusterButton>}
      </div>
    </header>

    <div className={`packets-status-slot-v250 ${message ? "has-message" : ""}`}>{message && <div className={/could not|choose|required|failed|unavailable/i.test(message) ? "error-box slim" : "status-box slim"}>{message}</div>}</div>

    {knowledgeView === "records" ? <div className="packets-records-v524"><PersonnelRecordsPanel /></div> : knowledgeView === "policies" ? <div className={`packets-workspace-v248 packets-workspace-v269 ${activePolicy && !catalogOpen ? "catalog-collapsed-v249" : ""}`}>
      {catalogOpen || !activePolicy ? <section className="packet-catalog-v269">
        <div className="packet-catalog-toolbar-v269"><div><strong>Studio policies</strong><span>{policyFeed.policies.length} available</span></div></div>
        <div className={`packet-shelf-list-v248 packet-catalog-grid-v269 ${view}`}>
          {policyError ? <div className="error-box slim">{policyError}</div> : policyFeed.policies.length ? policyFeed.policies.map((entry) => <ClusterButton type="button" variant="quiet" key={entry.policy.id} className={`packet-card-v248 ${activePolicyId === entry.policy.id ? "active" : ""}`} selected={activePolicyId === entry.policy.id} onClick={() => { policyReadSequence.current += 1; setPolicyInitials(""); setPolicySignature(""); setActivePolicyId(entry.policy.id); setCatalogOpen(false); }}>
            <span className="packet-cover-v248"><ClusterIcon name="text" width={view === "grid" ? 38 : 22} height={view === "grid" ? 38 : 22} /><b>{entry.accepted ? "✓" : "!"}</b></span>
            <span><strong>{entry.policy.title}</strong><em className="packet-structure-meta-v34f">Policy · {entry.version.versionLabel}{entry.policy.requiredForAccess ? " · Access required" : ""}{entry.accepted ? " · Accepted" : " · Action required"}</em>{entry.policy.summary && <em>{entry.policy.summary}</em>}<small>{entry.version.acceptanceMode === "none" ? "No acknowledgement required" : `Acceptance: ${entry.version.acceptanceMode}`}</small></span>
          </ClusterButton>) : <div className="packet-state-v248"><strong>No policies</strong><span>No active studio policies apply to your current role or memberships.</span></div>}
        </div>
      </section> : <main className="packet-reader-v248 packet-reader-v269">
        <header className="packet-reader-head-v248"><div><h2>{activePolicy.policy.title}</h2><span className="packet-structure-meta-v34f">Policy · {activePolicy.version.versionLabel}{activePolicy.policy.requiredForAccess ? " · Access required" : ""}{activePolicy.accepted ? " · Accepted" : " · Action required"}</span>{activePolicy.policy.summary && <span>{activePolicy.policy.summary}</span>}</div><div className="button-row"><ClusterButton type="button" variant="quiet" size="compact" onClick={() => setCatalogOpen(true)}>Browse policies</ClusterButton><ClusterButton type="button" variant="quiet" size="compact" onClick={() => void loadPolicies(activePolicy.policy.id, true)}>Refresh</ClusterButton></div></header>
        {policyError && <div className="error-box slim">{policyError}</div>}
        <div className="settings-card-v092"><pre>{activePolicy.version.bodyMarkdown}</pre></div>
        {!activePolicy.accepted && activePolicy.version.acceptanceMode === "acknowledge" && <ClusterButton type="button" variant="primary" disabled={policyPending} onClick={() => void acceptPolicy(activePolicy)}>{policyPending ? "Saving…" : "Acknowledge policy"}</ClusterButton>}
        {!activePolicy.accepted && activePolicy.version.acceptanceMode === "initials" && <div className="settings-card-v092"><label><span>Initials</span><ClusterInput value={policyInitials} maxLength={20} onChange={(event) => setPolicyInitials(event.target.value)} /></label><ClusterButton type="button" variant="primary" disabled={policyPending || !policyInitials.trim()} onClick={() => void acceptPolicy(activePolicy, { initials: policyInitials })}>{policyPending ? "Saving…" : "Accept policy"}</ClusterButton></div>}
        {!activePolicy.accepted && activePolicy.version.acceptanceMode === "signature" && <div className="settings-card-v092"><label><span>Signature</span><ClusterInput value={policySignature} maxLength={300} onChange={(event) => setPolicySignature(event.target.value)} /></label><ClusterButton type="button" variant="primary" disabled={policyPending || !policySignature.trim()} onClick={() => void acceptPolicy(activePolicy, { signature: policySignature })}>{policyPending ? "Saving…" : "Sign and accept"}</ClusterButton></div>}
        {!activePolicy.accepted && activePolicy.version.acceptanceMode === "form" && (activePolicy.existingFormSubmissionId ? <ClusterButton type="button" variant="primary" disabled={policyPending} onClick={() => void acceptPolicy(activePolicy, { formSubmissionId: activePolicy.existingFormSubmissionId })}>{policyPending ? "Saving…" : "Accept with completed form"}</ClusterButton> : activePolicy.formDocument ? <StudioFormRunner document={activePolicy.formDocument} submitLabel="Complete policy form" submit={(payload) => api(`/api/forms/${activePolicy.formDocument!.form.key}/submissions`, { method: "POST", body: JSON.stringify(payload) })} onSubmitted={(result) => { const id = String(result.id || result.submissionId || ""); if (id) void acceptPolicy(activePolicy, { formSubmissionId: id }); }} /> : <div className="error-box">The required policy form is unavailable.</div>)}
        {activePolicy.accepted && <div className="status-box slim">Accepted{activePolicy.acceptance?.acceptedAt ? ` ${new Date(activePolicy.acceptance.acceptedAt).toLocaleDateString()}` : ""}. This exact published version is recorded.</div>}
      </main>}
    </div> : <div className={`packets-workspace-v248 packets-workspace-v269 ${activePacket && !catalogOpen ? "catalog-collapsed-v249" : ""}`}>
      {catalogOpen || !activePacket ? <section className="packet-catalog-v269">
        <div className="packet-catalog-toolbar-v269">
          <div>
            <strong>Packet library</strong>
            <span>{visiblePackets.length} shown</span>
          </div>
          <div className="packet-shelf-tools-v248">

          <ClusterTextInput type="search" value={packetQuery} onChange={(event) => setPacketQuery(event.target.value)} placeholder="Find packet" aria-label="Search packets" />
          <div className="packets-view-toggle-v248"><ClusterButton type="button" variant="quiet" size="compact" className={view === "grid" ? "active" : ""} selected={view === "grid"} onClick={() => setView("grid")} aria-label="Grid view"><LibraryIcon name="grid" size={17} /></ClusterButton><ClusterButton type="button" variant="quiet" size="compact" className={view === "list" ? "active" : ""} selected={view === "list"} onClick={() => setView("list")} aria-label="List view"><LibraryIcon name="list" size={17} /></ClusterButton></div>
          </div>
        </div>
        <div className={`packet-shelf-list-v248 packet-catalog-grid-v269 ${view}`}>
          {loadError ? <RequestErrorState error={loadError} title="Packets could not be loaded" onRetry={() => void loadPackets(undefined, true)} compact /> : loading ? <div className="packet-state-v248">Loading packets…</div> : visiblePackets.length ? visiblePackets.map((packet) => <ClusterButton type="button" variant="quiet" key={packet.id} className={`packet-card-v248 ${activePacketId === packet.id ? "active" : ""}`} selected={activePacketId === packet.id} onClick={() => { setActivePacketId(packet.id); setCatalogOpen(false); }}>
            <span className="packet-cover-v248" style={runtimeStyle({ "--packet-color": packet.folderColor || "var(--accent)" })}><LibraryIcon name={folderIconName(packet)} size={view === "grid" ? 42 : 24} /><b>{packet.packetStats.total}</b></span>
            <span><strong>{packet.title}</strong><em className="packet-structure-meta-v34f">{packet.packetDefinition.kind} · v{packet.packetDefinition.versionLabel}{packet.packetDefinition.required ? " · Required" : ""}</em>{showDescriptions && packet.body && <em>{packet.body}</em>}<small>{packet.packetStats.pdfs} PDF · {packet.packetStats.videos} video · {packet.packetStats.files + packet.packetStats.links} other{packetUpdated(packet) ? ` · ${packetUpdated(packet)}` : ""}</small></span>
          </ClusterButton>) : <div className="packet-state-v248"><strong>No packets</strong><span>Create a packet or add a folder inside Library › Packets.</span></div>}
        </div>
      </section> : <main className="packet-reader-v248 packet-reader-v269">
        {activePacket ? <>
          <header className="packet-reader-head-v248">
            <div><h2>{activePacket.title}</h2><span className="packet-structure-meta-v34f">{activePacket.packetDefinition.kind} · v{activePacket.packetDefinition.versionLabel}{activePacket.packetDefinition.required ? " · Required" : ""}{activePacket.packetDefinition.completionMode !== "none" ? ` · ${activePacket.packetDefinition.completionMode}` : ""}{activePacket.completion ? " · Completed" : ""}</span>{showDescriptions && activePacket.body && <span>{activePacket.body}</span>}</div>
            {activePacket.canAuthor && <label className="field"><span>Optional PDF / image publication watermark</span><ClusterTextInput aria-label="PDF and image publication watermark" value={publicationWatermarkLabel} maxLength={60} placeholder="e.g. Internal studio copy" onChange={(event) => setPublicationWatermarkLabel(event.target.value)} /><small>Added to newly generated PDF and image derivatives at publication. Original Library files remain unchanged. This label is shared by recipients, not person-specific. Preview sizes exclude its overhead.</small></label>}
            <div className="button-row">{!activePacket.completion && activePacket.packetDefinition.completionMode === "read" && <ClusterButton type="button" className="" disabled={completionPending} onClick={() => void completeActivePacket()} variant="primary">{completionPending ? "Saving…" : "Mark read"}</ClusterButton>}{!activePacket.completion && activePacket.packetDefinition.completionMode === "acknowledge" && <ClusterButton type="button" className="" disabled={completionPending} onClick={() => void completeActivePacket()} variant="primary">{completionPending ? "Saving…" : "Acknowledge"}</ClusterButton>}<ClusterButton type="button" className="" aria-label={catalogOpen ? "Open packet" : "Browse packets"} onClick={() => setCatalogOpen((open) => !open)} variant="quiet" size="compact">{catalogOpen ? "Open packet" : "Exit packet"}</ClusterButton><ClusterButton type="button" className="" onClick={() => void loadPacket(activePacket.id, true)} variant="quiet" size="compact">Refresh</ClusterButton>{activePacket.canAuthor && <><ClusterButton type="button" disabled={publicationPending || previewPending} onClick={() => void previewActivePacketPublication()} variant="quiet" title="Inspect candidate files and verified derivative sizes before freezing a Packet release. Uploaded PDF candidates are estimates until conversion.">{previewPending ? "Checking…" : "Preview publication"}</ClusterButton><ClusterButton type="button" disabled={publicationPending} onClick={() => void publishActivePacket()} variant="secondary" title="Freeze this version's source manifest. Does not grant recipients access to original Library files.">{publicationPending ? "Publishing…" : "Publish snapshot"}</ClusterButton><ClusterButton type="button" disabled={publicationPending} onClick={() => void publishActivePacket(true)} variant="secondary" title="Publish the version with detached copies of eligible notes and checksum-verified plain-text Library files. PDFs, images, audio and video require separate adapters.">Publish + text notes & files</ClusterButton><ClusterButton type="button" disabled={publicationPending} onClick={() => void publishActivePacket(false, true)} variant="secondary" title="Publish fresh PDFs built from eligible text notes and verified uploaded plain-text files. Original PDFs and binary media are never relayed.">Publish + PDF text</ClusterButton><ClusterButton type="button" disabled={publicationPending} onClick={() => void publishActivePacket(false, true, true, true)} variant="secondary" title="Publish fresh, flattened PDFs of approved uploaded PDF sources, generated PDF text copies and metadata-free image derivatives. PDF rasterization may take time and requires server processing dependencies.">Publish + PDF &amp; images</ClusterButton><ClusterButton type="button" disabled={publicationPending} onClick={() => void publishActivePacket(true, false, true)} variant="secondary" title="Publish detached text notes, checked plain-text files and independently re-encoded, metadata-free JPG/PNG/WebP images. Never publishes original image bytes.">Publish + text &amp; images</ClusterButton><ClusterButton type="button" disabled={publicationPending} onClick={() => void publishActivePacket(false, false, false, false, true)} variant="secondary" title="Publish approved PCM WAV sources as fresh, metadata-free, eight-second 12 kHz mono audio previews. Only original source checksum-verified files are read; entire songs and unsupported formats remain unavailable.">Publish + audio previews</ClusterButton><ClusterButton type="button" className="" onClick={beginEditDefinition} variant="secondary">Packet settings</ClusterButton><ClusterButton type="button" className="" onClick={() => onOpenLibrary(activePacket.id)} variant="secondary">Edit resources</ClusterButton></>} </div>
          </header>
          <section className="settings-card-v092" aria-label="Published Packet releases">
            <p className="eyebrow">Published releases</p>
            <p className="muted tight">Immutable catalogues are checked against their publication hashes and original audiences. Source Library files are never granted by a Packet release. Text-note and checked plain-text file derivatives can be published explicitly. PDF copies can be generated from eligible notes and uploaded plain-text files. Eligible JPG, PNG and WebP images may be re-encoded into small metadata-free WebP copies. Uploaded PDF sources may be rasterized into newly flattened PDFs. Eligible PCM WAV uploads can be converted into reduced-quality eight-second preview excerpts, never full audio copies. Video and unsupported audio formats remain blocked.</p>
            {releaseLoadError && <p role="alert" className="error-box">{releaseLoadError}</p>}
            {publicationPreview && <p className="muted tight" role="status">Preview for v{publicationPreview.versionLabel}: {publicationPreview.sourceCount} sources, {publicationPreview.eligibleNotes} text notes, {publicationPreview.eligibleTextFiles} checksum-verified plain-text files and {publicationPreview.eligibleImages} re-encoded images and {publicationPreview.eligibleAudioPreviews} detached audio preview excerpts ({Math.ceil(publicationPreview.audioPreviewBytes / 1024)} KiB), plus {publicationPreview.candidateSourcePdfs || 0} candidate uploaded PDFs (PDFs still require conversion validation) ({Math.ceil((publicationPreview.noteBytes + publicationPreview.textFileBytes + publicationPreview.imageBytes + publicationPreview.audioPreviewBytes) / 1024)} KiB total), and {publicationPreview.pendingDerivatives} entries requiring other derivative adapters. Publication revalidates these counts.</p>}
            {publishedReleases.length ? <div className="button-row">{publishedReleases.map((release) => <ClusterButton type="button" key={release.releaseId} variant="quiet" size="compact" onClick={() => void inspectPublishedRelease(release.releaseId)}>v{release.versionLabel} · {release.contentsCount} entries{release.requiredAcknowledgment ? (release.requiredAcknowledgment.acknowledgedAt ? " · Acknowledged" : " · Required") : ""}</ClusterButton>)}</div> : <p className="muted tight">No published release available to this account.</p>}
            {publishedCatalog && <div><strong>Published v{publishedCatalog.versionLabel}</strong>{publishedCatalog.contents.some((entry) => entry.downloadable) && activePacket && <ClusterLinkButton variant="secondary" size="compact" href={`${API_URL}/api/packets/${encodeURIComponent(activePacket.id)}/deliveries/${encodeURIComponent(publishedCatalog.releaseId)}/bundle`} download="packet-deliveries.zip" onClick={(event) => { event.preventDefault(); void downloadAuthenticatedClusterFile({ fileName: "packet-deliveries.zip", url: event.currentTarget.href }).then(() => setMessage("Packet download requested in your browser.")).catch((error) => setMessage(error instanceof Error ? error.message : "Packet download failed.")); }}>Download available derivatives (ZIP)</ClusterLinkButton>}{publishedCatalog.publicationWatermarkLabel && <p className="muted tight">Published watermark: {publishedCatalog.publicationWatermarkLabel} · embedded in eligible PDF/image derivatives, not personalized to this download.</p>}<p className="muted tight">{publishedCatalog.contents.length} entries · {publishedCatalog.deliveryStatus === "partially_available" ? "detached downloads available" : "derivative delivery pending"} · SHA-256: {publishedCatalog.manifestSha256.slice(0, 16)}…</p><ul>{publishedCatalog.contents.map((entry) => <li key={entry.position}>{entry.title} · {entry.kind} {entry.downloadable && activePacket ? <ClusterLinkButton variant="quiet" size="compact" href={`${API_URL}/api/packets/${encodeURIComponent(activePacket.id)}/deliveries/${encodeURIComponent(publishedCatalog.releaseId)}/artifacts/${entry.position}`} download={`packet-derivative-${entry.position}.${entry.format === "pdf" ? "pdf" : entry.format === "webp" ? "webp" : entry.format === "wav" ? "wav" : "txt"}`} onClick={(event) => { event.preventDefault(); void downloadAuthenticatedClusterFile({ fileName: `packet-derivative-${entry.position}.${entry.format === "pdf" ? "pdf" : entry.format === "webp" ? "webp" : entry.format === "wav" ? "wav" : "txt"}`, url: event.currentTarget.href }).then(() => setMessage("Packet file download requested.")).catch((error) => setMessage(error instanceof Error ? error.message : "Packet file download failed.")); }}>Download {entry.previewOnly ? "Audio preview (up to 8 sec, reduced quality)" : entry.format === "pdf" ? "PDF" : entry.format === "webp" ? "image" : "text"}</ClusterLinkButton> : <span className="muted">· derivative pending</span>}</li>)}</ul></div>}
            {publishedCatalog && <div className="settings-card-v092" aria-label="Published release acknowledgment">
              <strong>Recipient acknowledgment · v{publishedCatalog.versionLabel}</strong>
              <p className="muted tight">This is a voluntary statement about this exact published version, not evidence that a download finished. It does not replace a required Packet form or completion.</p>
              {publishedReleases.find((row) => row.releaseId === publishedCatalog.releaseId)?.requiredAcknowledgment &&
                <p role="status" className="muted tight">Required for this published version
                  {publishedReleases.find((row) => row.releaseId === publishedCatalog.releaseId)?.requiredAcknowledgment?.dueAt
                    ? ` · Due ${new Date(publishedReleases.find((row) => row.releaseId === publishedCatalog.releaseId)!.requiredAcknowledgment!.dueAt!).toLocaleDateString()}` : ""}
                  {releaseAcknowledgment ? " · Complete" : " · Awaiting your acknowledgment"}</p>}
              {releaseAcknowledgment ? <p role="status" className="muted tight">Acknowledged on {new Date(releaseAcknowledgment.acknowledgedAt).toLocaleString()} · Release SHA-256: {releaseAcknowledgment.manifestSha256.slice(0, 16)}…</p> : <>
                <label className="packet-required-toggle-v34f"><ClusterInput type="checkbox" checked={acknowledgmentConfirmed} onChange={(event) => setAcknowledgmentConfirmed(event.target.checked)} /><span>I have reviewed the published v{publishedCatalog.versionLabel} contents and acknowledge this exact version.</span></label>
                <ClusterButton type="button" variant="primary" disabled={!acknowledgmentConfirmed || acknowledgmentPending} onClick={() => void acknowledgePublishedRelease()}>{acknowledgmentPending ? "Recording…" : "Record my acknowledgment"}</ClusterButton>
              </>}
              {acknowledgmentError && <p className="error-box" role="alert">{acknowledgmentError}</p>}
            </div>}
            {activePacket.canAuthor && <div className="settings-card-v092" aria-label="Required release acknowledgments">
              <strong>Required published acknowledgments</strong>
              <p className="muted tight">Assign specific eligible users to one immutable published release. This does not replace Packet completion, and withdrawal preserves historic assignments.</p>
              <div className="button-row">{managedReleases.filter((release) => !release.revokedAt).map((release) =>
                <ClusterButton key={release.id} type="button" size="compact" variant="secondary" disabled={requirementPending}
                  onClick={() => void loadReleaseRequirements(release.id)}>Manage v{release.versionLabel}</ClusterButton>)}</div>
              {requirementReleaseId && <div>
                {requirementSummary && <>
                  <p className="muted tight">v{requirementReport?.versionLabel || ""} · {requirementSummary.total} assigned across the entire release · {requirementSummary.acknowledged} acknowledged · {requirementSummary.awaiting} awaiting · {requirementSummary.overdue} overdue · {requirementSummary.dueSoon} due within 7 days · {requirementSummary.noDeadline} without a deadline{requirementSummary.integrityIssues ? ` · ${requirementSummary.integrityIssues} integrity exceptions` : ""}</p>
                  <p className="muted tight">Acknowledgment requires the recipient's explicit assertion about this frozen release. Downloads, notification delivery and read receipts do not count. Counts reflect current database evidence, not a locked historical snapshot.</p>
                </>}
                <div className="button-row" aria-label="Filter required acknowledgments">
                  {([ ["all", "All"], ["awaiting", "Awaiting"], ["overdue", "Overdue"], ["due_soon", "Due soon"], ["acknowledged", "Acknowledged"], ["no_deadline", "No deadline"], ["integrity_issue", "Integrity exceptions"] ] as const).map(([status, label]) =>
                    <ClusterButton key={status} type="button" size="compact" variant={requirementStatus === status ? "primary" : "secondary"}
                      disabled={requirementPending} onClick={() => void loadReleaseRequirements(requirementReleaseId, undefined, status)}>{label}</ClusterButton>)}
                </div>
                <p className="muted tight">Showing {requirementReport?.requirements.length || 0} loaded {requirementStatus === "all" ? "assignments" : requirementStatus.replaceAll("_", " ") + " assignments"}. Filters apply to the whole release, not just these rows.</p>
                {!requirementReport?.revoked && <>
                  <div className="button-row">
                    <label className="field"><span>Find eligible recipients</span><ClusterInput value={candidateQuery} placeholder="Search username or display name"
                      onChange={(event) => setCandidateQuery(event.target.value)} /></label>
                    <ClusterButton type="button" size="compact" variant="secondary" disabled={candidatePending || requirementPending}
                      onClick={() => void searchRequirementCandidates()}>Search recipients</ClusterButton>
                  </div>
                  <p className="muted tight">{requirementCandidates.length} eligible accounts loaded · {requirementRecipients.length} selected. Search and pagination do not clear selections; the server checks eligibility again when assigning.</p>
                  <div className="packet-requirement-recipients-vg26">
                    {requirementCandidates.map((person) => <label key={person.id} className="packet-required-toggle-v34f">
                      <ClusterInput type="checkbox" checked={requirementRecipients.includes(person.id)}
                        onChange={(event) => setRequirementRecipients((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id))} />
                      <span>{person.displayName || person.username} ({person.username})</span>
                    </label>)}
                  </div>
                  {candidateCursor && <ClusterButton type="button" variant="quiet" size="compact" disabled={candidatePending || requirementPending}
                    onClick={() => void searchRequirementCandidates(candidateCursor)}>Load more eligible recipients</ClusterButton>}
                  {candidatePending && <p className="muted tight" role="status">Loading eligible recipients…</p>}
                  <label className="field"><span>Optional due date</span><ClusterInput type="date" value={requirementDueDate} onChange={(event) => setRequirementDueDate(event.target.value)} /></label>
                  <ClusterButton type="button" variant="primary" size="compact" disabled={requirementPending || !requirementRecipients.length || requirementRecipients.length > 100}
                    onClick={() => void assignRequiredReleaseAcknowledgments()}>Assign required acknowledgments ({requirementRecipients.length})</ClusterButton>
                </>}
                {requirementReport?.requirements.length ? <ul>{requirementReport.requirements.map((row) => <li key={row.id}>
                  {row.recipient?.displayName || row.recipient?.username || "Former account"} · {row.integrityIssue ? "Manifest integrity exception" : row.acknowledgedAt ? "Acknowledged" : row.dueAt && new Date(row.dueAt).getTime() < new Date(requirementSummary?.asOf || Date.now()).getTime() ? "Overdue" : "Awaiting acknowledgment"}
                  {row.dueAt ? ` · Due ${new Date(row.dueAt).toLocaleDateString()}` : ""}
                  {row.lastRemindedAt ? ` · Last reminded ${new Date(row.lastRemindedAt).toLocaleDateString()}` : ""}
                  {!row.acknowledgedAt && !row.integrityIssue && !requirementReport.revoked && <ClusterButton type="button" variant="quiet" size="compact"
                    disabled={requirementPending || Boolean(row.lastRemindedAt && Date.now() - new Date(row.lastRemindedAt).getTime() < 7 * 24 * 60 * 60 * 1000)}
                    onClick={() => void sendRequiredPacketReminder(row.id)}>Send reminder</ClusterButton>}
                </li>)}</ul> : null}
                {requirementReport?.nextCursor && <ClusterButton type="button" variant="quiet" size="compact" disabled={requirementPending}
                  onClick={() => void loadReleaseRequirements(requirementReleaseId, requirementReport.nextCursor!, requirementStatus)}>Load more assignments</ClusterButton>}
              </div>}
              {requirementError && <p className="error-box" role="alert">{requirementError}</p>}
            </div>}
            {currentUser.isAdmin && <div className="settings-card-v092" aria-label="Published release acknowledgment evidence">
              <strong>Recipient acknowledgment history</strong>
              <p className="muted tight">Explicit recipient assertions about a specific frozen release. Separate from downloads issued, read tracking, and completion requirements. A withdrawn release retains prior evidence.</p>
              <div className="button-row">{managedReleases.map((release) => <ClusterButton type="button" key={release.id} size="compact" variant="secondary" disabled={acknowledgmentReportPending} onClick={() => void inspectReleaseAcknowledgments(release.id)}>Inspect v{release.versionLabel}{release.revokedAt ? " (withdrawn)" : ""}</ClusterButton>)}</div>
              {acknowledgmentReportError && <p className="error-box" role="alert">{acknowledgmentReportError}</p>}
              {acknowledgmentReportPending && <p className="muted tight" role="status">Loading acknowledgments…</p>}
              {acknowledgmentReport && <div><p className="muted tight">v{acknowledgmentReport.versionLabel} · {acknowledgmentReport.total} acknowledgments{acknowledgmentReport.revoked ? " · Withdrawn" : ""}</p>
                {acknowledgmentReport.acknowledgments.length ? <ul>{acknowledgmentReport.acknowledgments.map((entry) => <li key={entry.id}><strong>{entry.recipient?.displayName || entry.recipient?.username || "Former/unknown account"}</strong> · {new Date(entry.acknowledgedAt).toLocaleString()}</li>)}</ul> : <p className="muted tight">No one has acknowledged this release.</p>}
                {acknowledgmentReport.nextCursor && <ClusterButton type="button" variant="quiet" size="compact" disabled={acknowledgmentReportPending} onClick={() => void inspectReleaseAcknowledgments(acknowledgmentReport.releaseId, acknowledgmentReport.nextCursor!)}>Load earlier acknowledgments</ClusterButton>}
              </div>}
            </div>}
            {currentUser.isAdmin && <div className="settings-card-v092" aria-label="Packet delivery evidence">
              <strong>Delivery issuance history</strong>
              <p className="muted tight">Review which recipient accounts were issued detached published files. Entries are durable evidence of authorization and bytes prepared by Cluster, not proof that the recipient saved or opened a download. Revocation does not erase history.</p>
              <div className="button-row">{managedReleases.map((release) => <ClusterButton type="button" key={release.id} size="compact" variant="secondary" disabled={deliveryEvidencePending} onClick={() => void inspectDeliveryEvidence(release.id)}>Inspect v{release.versionLabel}{release.revokedAt ? " (withdrawn)" : ""}</ClusterButton>)}</div>
              {deliveryEvidenceError && <p className="error-box" role="alert">{deliveryEvidenceError}</p>}
              {deliveryEvidencePending && <p className="muted tight" role="status">Loading issuance evidence…</p>}
              {deliveryEvidence && <div><p className="muted tight">v{deliveryEvidence.versionLabel} · {deliveryEvidence.total} issuances ({deliveryEvidence.bundleCount} ZIP, {deliveryEvidence.artifactCount} individual){deliveryEvidence.revoked ? " · Withdrawn" : ""}</p>
                {deliveryEvidence.receipts.length ? <ul>{deliveryEvidence.receipts.map((entry) => <li key={entry.id}><strong>{entry.recipient?.displayName || entry.recipient?.username || "Former/unknown account"}</strong> · {entry.kind === "bundle" ? "ZIP bundle" : `Derivative ${entry.position}`} · {formatBytes(entry.sizeBytes)} · {new Date(entry.issuedAt).toLocaleString()}</li>)}</ul> : <p className="muted tight">No derivative issuance recorded for this release.</p>}
                {deliveryEvidence.nextCursor && <ClusterButton type="button" variant="quiet" size="compact" disabled={deliveryEvidencePending} onClick={() => void inspectDeliveryEvidence(deliveryEvidence.releaseId, deliveryEvidence.nextCursor!)}>Load earlier issuances</ClusterButton>}
              </div>}
            </div>}
            {currentUser.isAdmin && managedReleases.some((release) => !release.revokedAt) && <div className="settings-card-v092" aria-label="Revoke published release">
              <strong>Withdraw a published release</strong>
              <p className="muted tight">This blocks all recipient catalogues, individual downloads and ZIP downloads for the selected version. Immutable release records and Library source protections are retained.</p>
              <label><span>Published version</span><ClusterNativeSelect value={revokeReleaseId} onChange={(event) => setRevokeReleaseId(event.target.value)}><option value="">Choose a release…</option>{managedReleases.filter((release) => !release.revokedAt).map((release) => <option key={release.id} value={release.id}>v{release.versionLabel}</option>)}</ClusterNativeSelect></label>
              <label><span>Reason (10 characters minimum)</span><ClusterTextArea value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} /></label>
              <label><span>Type REVOKE RELEASE to confirm</span><ClusterTextInput value={revokeConfirmation} onChange={(event) => setRevokeConfirmation(event.target.value)} /></label>
              <ClusterButton type="button" variant="danger" disabled={!revokeReleaseId || revokeReason.trim().length < 10 || revokeConfirmation !== "REVOKE RELEASE" || revokePending || publicationPending || acknowledgmentPending} onClick={() => void revokePublishedRelease()}>{revokePending ? "Withdrawing…" : "Revoke published version"}</ClusterButton>
            </div>}
          </section>
          {!activePacket.completion && activePacket.packetDefinition.completionMode === "form" && <div className="settings-card-v092">
            <p className="eyebrow">Completion form</p>
            {activePacket.completionFormSubmissionId ? <div><p className="muted tight">You already completed the configured form. Use it to finish this packet.</p><ClusterButton type="button" variant="primary" disabled={completionPending} onClick={() => void completePacketWithForm(activePacket.completionFormSubmissionId!)}>{completionPending ? "Saving…" : "Complete packet"}</ClusterButton></div> : packetFormDocument ? <StudioFormRunner document={packetFormDocument} submitLabel="Complete packet form" submit={async (payload) => { const submission = await api<{ id: string }>(`/api/forms/${packetFormDocument.form.key}/submissions`, { method: "POST", body: JSON.stringify(payload) }); await completePacketWithForm(submission.id); return { ...submission, confirmationMessage: "Packet completed." }; }} /> : packetFormError ? <div className="error-box" role="alert">{packetFormError}</div> : <span>Loading completion form…</span>}
          </div>}

          {activePacket.canAuthor ? <>
          <div className="packet-resource-tools-v248">
            <ClusterTextInput type="search" value={resourceQuery} onChange={(event) => setResourceQuery(event.target.value)} placeholder="Search this packet" aria-label="Search packet resources" />
            <div className="packet-filter-bar-v248">{filters.map(([value, label]) => <ClusterButton type="button" variant="quiet" size="compact" key={value} className={resourceFilter === value ? "active" : ""} selected={resourceFilter === value} onClick={() => setResourceFilter(value)}>{label}<b>{resourceCounts[value]}</b></ClusterButton>)}</div>
          </div>

          <div className="packet-reader-layout-v248">
            <nav className="packet-resource-list-v248" aria-label={`${activePacket.title} resources`}>
              {packetLoadError ? <RequestErrorState error={packetLoadError} title="Packet resources could not be loaded" onRetry={() => void loadPacket(activePacket.id, true)} compact /> : loadingPacket ? <div className="packet-state-v248">Loading resources…</div> : visibleItems.length ? visibleItems.map((item, index) => <ClusterButton type="button" variant="quiet" key={item.id} className={activeItemId === item.id ? "active" : ""} selected={activeItemId === item.id} onClick={() => { setActiveItemId(item.id); if (isPdfResource(item)) setPdfWorkspaceOpen(true); }}>
                <span className="packet-resource-index-v248">{String(index + 1).padStart(2, "0")}</span>
                <LibraryIcon name={itemIconName(item)} size={19} />
                <span><strong>{item.title}</strong><em>{resourceKind(item)}{formatBytes(item.sizeBytes) ? ` · ${formatBytes(item.sizeBytes)}` : ""}</em></span>
                {item.pinned && <LibraryIcon name="star" size={13} />}
              </ClusterButton>) : <div className="packet-state-v248"><strong>{items.length ? "No matches" : "Empty packet"}</strong><span>{items.length ? "Change the search or filter." : "Add resources from Library."}</span>{!items.length && <ClusterButton type="button" className="" onClick={() => onOpenLibrary(activePacket.id)} variant="primary">Edit packet</ClusterButton>}</div>}
            </nav>

            <section className="packet-preview-v248">
              {activeItem ? <>
                <header>
                  <div><strong>{activeItem.title}</strong><span>{resourceKind(activeItem)}{formatBytes(activeItem.sizeBytes) ? ` · ${formatBytes(activeItem.sizeBytes)}` : ""}{activeVisibleIndex >= 0 ? ` · ${activeVisibleIndex + 1} of ${visibleItems.length}` : ""}{activeItem.project?.name ? ` · ${activeItem.project.name}` : ""}</span></div>
                  <div className="packet-preview-actions-v248">{activeItem.projectId && onOpenProject ? <ClusterButton type="button" className="" onClick={() => onOpenProject(activeItem.projectId!)} variant="quiet" size="compact">Open project</ClusterButton> : null}
                    <ClusterButton type="button" variant="quiet" size="compact" disabled={!previousItem} onClick={() => previousItem && setActiveItemId(previousItem.id)} aria-label="Previous resource"><LibraryIcon name="previous" size={18} /></ClusterButton>
                    <ClusterButton type="button" variant="quiet" size="compact" disabled={!nextItem} onClick={() => nextItem && setActiveItemId(nextItem.id)} aria-label="Next resource"><LibraryIcon name="next" size={18} /></ClusterButton>
                    {isPdfResource(activeItem) && <ClusterButton type="button" className="" onClick={() => setPdfWorkspaceOpen(true)} variant="quiet" size="compact">Open viewer</ClusterButton>}
                    {activeItem.hasFile && <ClusterLinkButton className="" href={libraryFileUrl(activeItem, true)} variant="quiet" size="compact">Download</ClusterLinkButton>}
                    {activeItem.externalUrl && !activeItem.youtubeEmbedUrl && <ClusterLinkButton className="" href={activeItem.externalUrl} target="_blank" rel="noreferrer" variant="quiet" size="compact">Open</ClusterLinkButton>}
                  </div>
                </header>
                <div className="packet-preview-body-v248"><LibraryPreview item={activeItem} expanded controls={{ onPrevious: previousItem ? () => setActiveItemId(previousItem.id) : undefined, onNext: nextItem ? () => setActiveItemId(nextItem.id) : undefined, hasPrevious: Boolean(previousItem), hasNext: Boolean(nextItem) }} /></div>
              </> : <div className="packet-state-v248"><LibraryIcon name="note" size={54} /><strong>Select a resource</strong></div>}
            </section>
          </div>
          </> : <section className="settings-card-v092" aria-label="Published Packet recipient access"><strong>Published delivery only</strong><p className="muted tight">This Packet grants access to the frozen published catalogues and detached derivatives above. Original Library records, source filenames, versions, and editing tools remain restricted to separately authorized staff.</p></section>}
        </> : <div className="packet-state-v248"><LibraryIcon name="note" size={62} /><strong>Select a packet</strong></div>}
      </main>}
    </div>}

    {knowledgeView === "packets" && pdfWorkspaceOpen && activePacket?.canAuthor && activeItem && isPdfResource(activeItem) && <LibraryViewerModal
      item={activeItem}
      items={items}
      onClose={() => setPdfWorkspaceOpen(false)}
      onSelect={(resource) => { setActiveItemId(resource.id); if (!isPdfResource(resource)) setPdfWorkspaceOpen(false); }}
      onPrevious={previousItem ? () => setActiveItemId(previousItem.id) : undefined}
      onNext={nextItem ? () => setActiveItemId(nextItem.id) : undefined}
      hasPrevious={Boolean(previousItem)}
      hasNext={Boolean(nextItem)}
      position={activeVisibleIndex >= 0 ? activeVisibleIndex + 1 : undefined}
      total={visibleItems.length || undefined}
    />}

    {knowledgeView === "packets" && editingDefinition && activePacket?.canAuthor && <ClusterModal open onClose={() => { if (!definitionPending) setEditingDefinition(false); }} className="modal-card packet-create-modal-v248" ariaLabel={`Packet settings ${activePacket.title}`}><header><div><p className="eyebrow">Packet settings</p><h2>{activePacket.title}</h2></div><ClusterButton type="button" variant="quiet" size="compact" onClick={() => { if (!definitionPending) setEditingDefinition(false); }} disabled={definitionPending} aria-label="Close"><ClusterIcon name="close" /></ClusterButton></header><PacketAuthorFields value={definitionDraft} onChange={setDefinitionDraft} completionForms={completionForms} /><footer><ClusterButton type="button" disabled={definitionPending} onClick={() => setEditingDefinition(false)} variant="secondary">Cancel</ClusterButton><ClusterButton type="button" disabled={definitionPending || !definitionDraft.title.trim() || (definitionDraft.completionMode === "form" && !definitionDraft.completionFormId)} onClick={() => void savePacketDefinition()} variant="primary">Save settings</ClusterButton></footer></ClusterModal>}
  </section>;
}
