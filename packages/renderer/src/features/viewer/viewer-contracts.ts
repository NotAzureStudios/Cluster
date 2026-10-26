import type {
  AssetMetadataEnvelope,
  ReviewAssetCapabilities,
  ReviewAssetCapability,
  ReviewMedium,
  SensitiveMetadataEnvelope,
  ViewableResource,
  ViewableResourceLocator,
} from "@cluster/shared";
import type { ClusterIconName } from "../../components/ClusterIcon";

export const VIEWER_MODES = ["view", "review", "technical"] as const;
export type ViewerMode = typeof VIEWER_MODES[number];

export const VIEWER_PANELS = ["none", "inspector", "overlays", "comments", "shortcuts"] as const;
export type ViewerPanel = typeof VIEWER_PANELS[number];

export const VIEWER_OVERLAY_ZONES = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type ViewerOverlayZone = typeof VIEWER_OVERLAY_ZONES[number];

export const VIEWER_OVERLAY_PRESETS = ["clean", "review", "technical", "performance", "audio", "custom"] as const;
export type ViewerOverlayPreset = typeof VIEWER_OVERLAY_PRESETS[number];

export type ViewerOverlayDefinition = {
  id: string;
  label: string;
  description?: string;
  zone: ViewerOverlayZone;
  media?: readonly ReviewMedium[];
  modes?: readonly ViewerMode[];
  presets?: readonly Exclude<ViewerOverlayPreset, "custom">[];
  requiredCapability?: ReviewAssetCapability;
  priority?: number;
  defaultVisible?: boolean;
};

export type ViewerOverlayPlacement = {
  id: string;
  zone: ViewerOverlayZone;
};

export type ViewerOverlayPreferences = {
  version: 1;
  preset: ViewerOverlayPreset;
  visibleIds: string[];
  placements: ViewerOverlayPlacement[];
};

export type ViewerCommandContext = {
  medium: ReviewMedium;
  mode: ViewerMode;
  panel: ViewerPanel;
  fullscreen: boolean;
  resource: ViewableResource;
  capabilities: ReviewAssetCapabilities;
};

export type ViewerCommandDefinition = {
  id: string;
  label: string;
  description?: string;
  icon?: ClusterIconName;
  shortcut?: string;
  priority?: number;
  group?: "navigation" | "review" | "view" | "technical" | "system" | string;
  overflow?: boolean;
  allowInEditable?: boolean;
  requiredCapability?: ReviewAssetCapability;
  visible?: (context: ViewerCommandContext) => boolean;
  enabled?: (context: ViewerCommandContext) => boolean;
  run: (context: ViewerCommandContext) => void | Promise<void>;
};

export type ViewerCommandConflict = {
  shortcut: string;
  commandIds: string[];
};

export type ViewerShellState = "idle" | "loading" | "ready" | "degraded" | "unsupported" | "error";

export type ViewerReviewContext = {
  assetId?: string | null;
  status?: string | null;
  approvalState?: string | null;
  reviewRound?: string | number | null;
  assigneeId?: string | null;
  reviewerIds?: string[];
  unresolvedCount?: number;
};

export type ViewerAssetSession = {
  resource: ViewableResource;
  capabilities: ReviewAssetCapabilities;
  asset?: Record<string, unknown> | null;
  metadata?: AssetMetadataEnvelope | null;
  sensitiveMetadata?: SensitiveMetadataEnvelope | null;
  review?: ViewerReviewContext | null;
};

export type ViewerAssetSessionInput =
  | { locator: ViewableResourceLocator; resource?: never; capabilities?: never; asset?: never }
  | { resource: ViewableResource; capabilities?: ReviewAssetCapabilities; asset?: Record<string, unknown> | null; locator?: never };

export type ViewerAssetSessionResult = {
  state: ViewerShellState;
  session: ViewerAssetSession | null;
  error: unknown;
  reload: () => void;
  loadSensitiveMetadata: () => Promise<SensitiveMetadataEnvelope | null>;
};

export type ViewerInspectorSection = {
  title: string;
  value: unknown;
  empty?: string;
  open?: boolean;
};

export type ViewerDiagnosticsSnapshot = {
  resourceProvider: string;
  support: string;
  sourceMimeType: string;
  sourceSizeBytes: number;
  preferredDerivativeId?: string | null;
  derivativeCount: number;
  fullscreen: boolean;
  mode: ViewerMode;
  panel: ViewerPanel;
  registeredCommands: number;
  commandConflicts: number;
  availableOverlays: number;
  visibleOverlays: number;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  adapter?: Record<string, unknown>;
};
