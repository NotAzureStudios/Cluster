import type { BuildArtifactRecord, QASessionRecord, ReviewAsset, VideoProductionRecord } from "../application/application-models";

export type ProductionEvidenceTone = "good" | "warning" | "danger" | "neutral";
export type ProductionEvidenceGate = {
  id: "review" | "processing" | "build" | "qa" | "deliverables";
  label: string;
  value: string;
  detail: string;
  tone: ProductionEvidenceTone;
  ready: boolean;
};

const closedDeliveryStatuses = new Set(["approved", "delivered", "published", "complete", "completed"]);

export function summarizeProjectProductionEvidence({
  videos,
  productionRecords,
  buildArtifacts,
  qaSessions,
}: {
  videos: ReviewAsset[];
  productionRecords: VideoProductionRecord[];
  buildArtifacts: BuildArtifactRecord[];
  qaSessions: QASessionRecord[];
}) {
  let openNotes = 0;
  let pendingApprovals = 0;
  let activeJobs = 0;
  let deliverableTotal = 0;
  let deliverableReady = 0;

  for (const video of videos) {
    if (!["approved", "published", "archived"].includes(String(video.status || "review"))) pendingApprovals += 1;
    for (const comment of video.comments || []) if ((comment.status || "open") !== "resolved") openNotes += 1;
  }
  for (const record of productionRecords) {
    if (record.kind === "media_job" && ["queued", "processing", "retrying"].includes(record.status)) activeJobs += 1;
    if (record.kind === "deliverable") {
      deliverableTotal += 1;
      if (closedDeliveryStatuses.has(String(record.status || "").toLowerCase())) deliverableReady += 1;
    }
  }

  let approvedBuilds = 0;
  let failedBuilds = 0;
  for (const artifact of buildArtifacts) {
    if (artifact.approval === "approved" && artifact.qaStatus === "passed") approvedBuilds += 1;
    if (artifact.approval === "blocked" || artifact.qaStatus === "failed") failedBuilds += 1;
  }
  let passedQa = 0;
  let activeQa = 0;
  let failedQa = 0;
  for (const session of qaSessions) {
    if (session.status === "passed" && ["go", "conditional"].includes(session.decision)) passedQa += 1;
    if (["planned", "running"].includes(session.status)) activeQa += 1;
    if (session.status === "failed" || session.decision === "no-go") failedQa += 1;
  }

  const gates: ProductionEvidenceGate[] = [
    {
      id: "review",
      label: "Review notes",
      value: openNotes ? `${openNotes} open` : "Clear",
      detail: pendingApprovals ? `${pendingApprovals} version${pendingApprovals === 1 ? "" : "s"} still need approval` : "All active versions approved",
      tone: openNotes ? "warning" : pendingApprovals ? "warning" : "good",
      ready: openNotes === 0 && pendingApprovals === 0,
    },
    {
      id: "processing",
      label: "Media jobs",
      value: activeJobs ? `${activeJobs} active` : "Idle",
      detail: activeJobs ? "Processing is still producing review or delivery evidence" : "No queued or active media work",
      tone: activeJobs ? "warning" : "good",
      ready: activeJobs === 0,
    },
    {
      id: "build",
      label: "Build evidence",
      value: approvedBuilds ? `${approvedBuilds} verified` : failedBuilds ? `${failedBuilds} blocked` : "Missing",
      detail: approvedBuilds ? "Approved build artifact has passed QA" : failedBuilds ? "A build is blocked or failed QA" : "No approved QA-passed build artifact yet",
      tone: failedBuilds ? "danger" : approvedBuilds ? "good" : "warning",
      ready: approvedBuilds > 0 && failedBuilds === 0,
    },
    {
      id: "qa",
      label: "QA sign-off",
      value: passedQa ? `${passedQa} signed` : failedQa ? "No-go" : activeQa ? `${activeQa} active` : "Missing",
      detail: passedQa ? "A QA session has a go/conditional decision" : failedQa ? "A QA session is blocking delivery" : activeQa ? "QA is still running" : "No delivery QA sign-off recorded",
      tone: failedQa ? "danger" : passedQa ? "good" : "warning",
      ready: passedQa > 0 && failedQa === 0,
    },
    {
      id: "deliverables",
      label: "Deliverables",
      value: deliverableTotal ? `${deliverableReady}/${deliverableTotal}` : "None",
      detail: deliverableTotal ? `${deliverableTotal - deliverableReady} required output${deliverableTotal - deliverableReady === 1 ? "" : "s"} remain` : "Define required masters and outputs",
      tone: deliverableTotal && deliverableReady === deliverableTotal ? "good" : "warning",
      ready: deliverableTotal > 0 && deliverableReady === deliverableTotal,
    },
  ];

  const blockers = gates.filter((gate) => gate.tone === "danger").length;
  const ready = gates.filter((gate) => gate.ready).length;
  return { gates, ready, total: gates.length, blockers, openNotes, pendingApprovals, activeJobs, deliverableTotal, deliverableReady, approvedBuilds, passedQa };
}
