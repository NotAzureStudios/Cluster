import type { ReviewAsset } from "../application/application-models";

export type VideoReviewRoundSummary = {
  key: string;
  label: string;
  videos: ReviewAsset[];
  openNotes: number;
  totalNotes: number;
  approvedVersions: number;
  latestVersion: ReviewAsset;
};

export type VideoReviewHierarchy = {
  family: ReviewAsset[];
  rounds: VideoReviewRoundSummary[];
  currentRound: VideoReviewRoundSummary | null;
  previousVersion: ReviewAsset | null;
  previousVersionInRound: ReviewAsset | null;
  nextVersionInRound: ReviewAsset | null;
  newerRound: VideoReviewRoundSummary | null;
  olderRound: VideoReviewRoundSummary | null;
  compareCandidates: ReviewAsset[];
};

export function videoVersionKey(video: ReviewAsset) {
  return video.versionGroupId || video.id;
}

function versionNumber(video: ReviewAsset) {
  return Number(video.versionNumber || 1);
}

function reviewRoundLabel(video: ReviewAsset) {
  return String(video.reviewRound || "Review").trim() || "Review";
}

export function buildVideoReviewHierarchy(videos: ReviewAsset[], selected: ReviewAsset | null): VideoReviewHierarchy {
  if (!selected) return { family: [], rounds: [], currentRound: null, previousVersion: null, previousVersionInRound: null, nextVersionInRound: null, newerRound: null, olderRound: null, compareCandidates: [] };
  const familyKey = videoVersionKey(selected);
  const family = videos.filter((video) => videoVersionKey(video) === familyKey).sort((a, b) => versionNumber(b) - versionNumber(a));
  const roundMap = new Map<string, { label: string; videos: ReviewAsset[]; openNotes: number; totalNotes: number; approvedVersions: number }>();
  for (const video of family) {
    const label = reviewRoundLabel(video);
    const key = label.toLocaleLowerCase();
    const current = roundMap.get(key) || { label, videos: [], openNotes: 0, totalNotes: 0, approvedVersions: 0 };
    current.videos.push(video);
    for (const note of video.comments || []) {
      current.totalNotes += 1;
      if ((note.status || "open") !== "resolved") current.openNotes += 1;
    }
    if (video.approvalState === "approved") current.approvedVersions += 1;
    roundMap.set(key, current);
  }
  const rounds = [...roundMap.entries()].map(([key, value]) => ({
    key,
    label: value.label,
    videos: value.videos,
    openNotes: value.openNotes,
    totalNotes: value.totalNotes,
    approvedVersions: value.approvedVersions,
    latestVersion: value.videos[0],
  })).sort((a, b) => versionNumber(b.latestVersion) - versionNumber(a.latestVersion));
  const selectedRoundKey = reviewRoundLabel(selected).toLocaleLowerCase();
  const currentRoundIndex = rounds.findIndex((round) => round.key === selectedRoundKey);
  const currentRound = currentRoundIndex >= 0 ? rounds[currentRoundIndex] : null;
  const previousVersion = family.find((video) => versionNumber(video) < versionNumber(selected)) || null;
  const currentRoundVideos = currentRound?.videos || [];
  const currentRoundVersionIndex = currentRoundVideos.findIndex((video) => video.id === selected.id);
  const nextVersionInRound = currentRoundVersionIndex > 0 ? currentRoundVideos[currentRoundVersionIndex - 1] : null;
  const previousVersionInRound = currentRoundVersionIndex >= 0 && currentRoundVersionIndex < currentRoundVideos.length - 1 ? currentRoundVideos[currentRoundVersionIndex + 1] : null;
  const newerRound = currentRoundIndex > 0 ? rounds[currentRoundIndex - 1] : null;
  const olderRound = currentRoundIndex >= 0 && currentRoundIndex < rounds.length - 1 ? rounds[currentRoundIndex + 1] : null;
  const compareCandidates = family.filter((video) => video.id !== selected.id).sort((a, b) => {
    const aSameRound = reviewRoundLabel(a).toLocaleLowerCase() === selectedRoundKey ? 1 : 0;
    const bSameRound = reviewRoundLabel(b).toLocaleLowerCase() === selectedRoundKey ? 1 : 0;
    return bSameRound - aSameRound || versionNumber(b) - versionNumber(a);
  });
  return { family, rounds, currentRound, previousVersion, previousVersionInRound, nextVersionInRound, newerRound, olderRound, compareCandidates };
}
