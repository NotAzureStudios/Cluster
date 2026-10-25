import type { ReviewMedium } from "@cluster/shared";
import type { ViewerOverlayDefinition } from "./viewer-contracts";

const ALL_MEDIA: readonly ReviewMedium[] = ["video", "audio", "image", "pdf", "3d"];

export const VIEWER_OVERLAY_CATALOG = [
  { id: "review.annotations", label: "Review annotations", description: "Shared notes and annotation geometry.", zone: "top-left", media: ALL_MEDIA, presets: ["review"], requiredCapability: "viewReviewHistory", priority: 10 },
  { id: "source.derivative", label: "Source / derivative", description: "Active source version and derivative identity.", zone: "top-right", media: ALL_MEDIA, presets: ["technical"], requiredCapability: "viewBasicMetadata", priority: 20 },
  { id: "comparison.state", label: "Comparison state", description: "Active A/B source and comparison mode.", zone: "top-center", media: ALL_MEDIA, presets: ["review", "technical"], priority: 30 },

  { id: "video.timecode", label: "Timecode", zone: "bottom-center", media: ["video"], presets: ["review", "technical"], defaultVisible: true, priority: 10 },
  { id: "video.frame_number", label: "Frame number", zone: "bottom-right", media: ["video"], presets: ["technical"], priority: 20 },
  { id: "video.fps", label: "Frame rate", zone: "top-left", media: ["video"], presets: ["technical", "performance"], requiredCapability: "viewBasicMetadata", priority: 20 },
  { id: "video.resolution", label: "Resolution", zone: "top-left", media: ["video"], presets: ["technical"], requiredCapability: "viewBasicMetadata", priority: 30 },
  { id: "video.safe_areas", label: "Safe areas", zone: "top-center", media: ["video"], presets: ["review", "technical"], priority: 40 },
  { id: "video.center_guides", label: "Center guides", zone: "top-center", media: ["video"], presets: ["technical"], priority: 45 },
  { id: "video.dropped_frames", label: "Dropped frames", zone: "top-right", media: ["video"], presets: ["performance", "technical"], requiredCapability: "accessDiagnostics", priority: 20 },
  { id: "video.buffer_health", label: "Buffer health", zone: "top-right", media: ["video"], presets: ["performance"], requiredCapability: "accessDiagnostics", priority: 25 },
  { id: "video.captions", label: "Captions", zone: "bottom-center", media: ["video"], presets: ["review"], priority: 15 },

  { id: "audio.timecode", label: "Time / timecode", zone: "bottom-center", media: ["audio"], presets: ["audio", "review", "technical"], defaultVisible: true, priority: 10 },
  { id: "audio.tracks", label: "Active tracks", zone: "top-left", media: ["audio"], presets: ["audio", "technical"], priority: 20 },
  { id: "audio.meters", label: "Audio meters", zone: "top-right", media: ["audio", "video"], presets: ["audio", "technical"], priority: 10 },
  { id: "audio.peaks", label: "Peak levels", zone: "top-right", media: ["audio"], presets: ["audio", "technical"], priority: 20 },
  { id: "audio.loudness", label: "Loudness", zone: "top-right", media: ["audio"], presets: ["audio", "technical"], requiredCapability: "viewBasicMetadata", priority: 25 },
  { id: "audio.waveform_markers", label: "Waveform markers", zone: "bottom-left", media: ["audio"], presets: ["audio", "review"], priority: 30 },
  { id: "audio.clip_regions", label: "Clip regions", zone: "bottom-left", media: ["audio"], presets: ["audio", "review"], priority: 35 },

  { id: "image.pixel_coordinates", label: "Pixel coordinates", zone: "bottom-left", media: ["image"], presets: ["technical"], priority: 10 },
  { id: "image.color_value", label: "Pixel color", zone: "bottom-left", media: ["image"], presets: ["technical"], priority: 15 },
  { id: "image.dimensions", label: "Dimensions", zone: "top-left", media: ["image"], presets: ["technical"], requiredCapability: "viewBasicMetadata", priority: 20 },
  { id: "image.zoom", label: "Zoom", zone: "bottom-right", media: ["image"], presets: ["technical"], defaultVisible: true, priority: 10 },
  { id: "image.grid", label: "Pixel grid", zone: "top-center", media: ["image"], presets: ["technical"], priority: 30 },
  { id: "image.guides", label: "Guides", zone: "top-center", media: ["image"], presets: ["review", "technical"], priority: 35 },
  { id: "image.safe_areas", label: "Safe areas", zone: "top-center", media: ["image"], presets: ["review", "technical"], priority: 40 },

  { id: "pdf.page_coordinates", label: "Page coordinates", zone: "bottom-left", media: ["pdf"], presets: ["technical"], priority: 20 },
  { id: "pdf.review_markers", label: "Review markers", zone: "top-right", media: ["pdf"], presets: ["review"], requiredCapability: "viewReviewHistory", priority: 10 },
  { id: "pdf.selection", label: "Selection", zone: "bottom-right", media: ["pdf"], presets: ["review", "technical"], priority: 30 },

  { id: "3d.fps", label: "FPS", zone: "top-left", media: ["3d"], presets: ["performance", "technical"], requiredCapability: "accessDiagnostics", priority: 10 },
  { id: "3d.frame_time", label: "Frame time", zone: "top-left", media: ["3d"], presets: ["performance"], requiredCapability: "accessDiagnostics", priority: 15 },
  { id: "3d.polygons", label: "Polygon count", zone: "top-right", media: ["3d"], presets: ["technical"], requiredCapability: "viewBasicMetadata", priority: 10 },
  { id: "3d.vertices", label: "Vertex count", zone: "top-right", media: ["3d"], presets: ["technical"], requiredCapability: "viewBasicMetadata", priority: 15 },
  { id: "3d.draw_calls", label: "Draw calls", zone: "top-right", media: ["3d"], presets: ["performance", "technical"], requiredCapability: "accessDiagnostics", priority: 20 },
  { id: "3d.textures", label: "Textures", zone: "top-right", media: ["3d"], presets: ["technical"], requiredCapability: "viewBasicMetadata", priority: 25 },
  { id: "3d.gpu_estimate", label: "GPU estimate", zone: "top-right", media: ["3d"], presets: ["performance", "technical"], requiredCapability: "accessDiagnostics", priority: 30 },
  { id: "3d.bounds", label: "Bounds", zone: "top-center", media: ["3d"], presets: ["technical"], priority: 35 },
  { id: "3d.grid_axes", label: "Grid and axes", zone: "bottom-center", media: ["3d"], presets: ["technical"], priority: 40 },
  { id: "3d.skeleton", label: "Skeleton", zone: "top-center", media: ["3d"], presets: ["technical"], priority: 45 },
  { id: "3d.lights_cameras", label: "Lights / cameras", zone: "top-left", media: ["3d"], presets: ["technical"], priority: 50 },
  { id: "3d.object_names", label: "Object names", zone: "bottom-left", media: ["3d"], presets: ["review", "technical"], priority: 55 },
] as const satisfies readonly ViewerOverlayDefinition[];

export type CanonicalViewerOverlayId = typeof VIEWER_OVERLAY_CATALOG[number]["id"];

const byId = new Map<string, ViewerOverlayDefinition>(VIEWER_OVERLAY_CATALOG.map((overlay) => [overlay.id, overlay]));

export function viewerOverlayDefinitions(ids: readonly CanonicalViewerOverlayId[]) {
  return ids.map((id) => byId.get(id)).filter((overlay): overlay is ViewerOverlayDefinition => Boolean(overlay));
}

export function viewerOverlayCatalogForMedium(medium: ReviewMedium) {
  return VIEWER_OVERLAY_CATALOG.filter((overlay) => !overlay.media || (overlay.media as readonly ReviewMedium[]).includes(medium));
}
