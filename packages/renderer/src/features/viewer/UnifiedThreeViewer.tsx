import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { DEFAULT_RESOURCE_BUDGETS, type SpatialLocator } from "@cluster/shared";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterSlider } from "../../components/ClusterSlider";
import { clusterApiFetch } from "@cluster/api-client";
import { runtimeStyle } from "../../core/runtime-style";
import { resolveViewerResourceSource, fetchViewerResourceResponse, absoluteViewerResourceUrl } from "./viewer-resource-loader";
import { readBoundedViewerBlob } from "./bounded-viewer-blob";
import { useViewerAssetSession } from "./use-viewer-asset-session";
import { useReviewComparisonSession } from "./use-review-comparison-session";
import { ViewerComparisonBar } from "./ViewerComparisonBar";
import { useTimedMediaController } from "./use-timed-media-controller";
import { ViewerOverlayLayer } from "./ViewerOverlayLayer";
import { ViewerShell } from "./ViewerShell";
import { viewerOverlayCatalogForMedium } from "./viewer-overlay-catalog";
import type { ViewerAssetSession, ViewerAssetSessionInput, ViewerCommandDefinition, ViewerInspectorSection, ViewerMode } from "./viewer-contracts";
import type { TimedClockAdapter, TimedMediaController } from "./timed-media-controller";

const MODEL_EXTENSIONS = new Set(["glb", "gltf", "fbx", "obj", "dae", "stl", "ply", "3ds", "blend"]);
const MAX_HIERARCHY_ROWS = 240;
const MAX_SAVED_VIEWS = 16;

type ProjectionMode = "perspective" | "orthographic";
type NamedView = "front" | "back" | "left" | "right" | "top" | "bottom" | "isometric";
type LightingMode = "studio" | "neutral" | "inspection";

type CameraState = {
  projection: ProjectionMode;
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov?: number;
  zoom?: number;
};

type SceneNodeSummary = {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  mesh: boolean;
  visible: boolean;
};

type ModelStats = {
  meshes: number;
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
  texturePixels: number;
  animations: number;
  skins: number;
  cameras: number;
  lights: number;
  drawCalls: number;
  fps: number;
  frameTimeMs: number;
  gpuEstimateBytes: number;
  bounds: { x: number; y: number; z: number } | null;
};

type ModelAnimationSummary = { id: string; label: string; duration: number };
type SavedView = { id: string; label: string; camera: CameraState; createdAt: string };
type ReviewCommentRecord = { id: string; body?: string; status?: string; locator?: unknown; user?: { displayName?: string | null; username?: string | null } | null };
type SpatialPin = { id: string; label: string; status?: string; locator: SpatialLocator };

type StageSettings = {
  projection: ProjectionMode;
  grid: boolean;
  axes: boolean;
  bounds: boolean;
  skeleton: boolean;
  wireframe: boolean;
  lighting: LightingMode;
  showObjectNames: boolean;
  annotationMode: boolean;
};

type StageHandle = {
  fit: () => void;
  setNamedView: (view: NamedView) => void;
  captureCamera: () => CameraState | null;
  restoreCamera: (camera: CameraState) => void;
  setObjectVisible: (id: string, visible: boolean) => void;
  showAllObjects: () => void;
};

type StageLoadState = "loading" | "ready" | "error";

type LoadedModel = {
  object: import("three").Object3D;
  animations: import("three").AnimationClip[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function fileExtension(value: string) {
  const clean = String(value || "").split(/[?#]/, 1)[0];
  const name = clean.split(/[\\/]/).pop() || "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function normalizeAssetPath(value: string) {
  try { value = decodeURIComponent(value); } catch {}
  return value.split(/[?#]/, 1)[0].replace(/\\/g, "/").replace(/^file:\/\//i, "").replace(/^\.?\//, "").replace(/\/{2,}/g, "/").trim().toLowerCase();
}

function assetKeys(value: string) {
  const normalized = normalizeAssetPath(value);
  const segments = normalized.split("/").filter(Boolean);
  const suffixes = segments.map((_, index) => segments.slice(index).join("/"));
  return Array.from(new Set([normalized, ...suffixes].filter(Boolean)));
}

function humanBytes(value: number) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let current = bytes / 1024;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) { current /= 1024; index += 1; }
  return `${current >= 100 ? current.toFixed(0) : current >= 10 ? current.toFixed(1) : current.toFixed(2)} ${units[index]}`;
}

function formatTime(seconds: number) {
  const value = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(value / 60);
  const remainder = value - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function disposeMaterial(material: import("three").Material) {
  const values = Object.values(material as unknown as Record<string, unknown>);
  for (const value of values) {
    if (!value || typeof value !== "object" || !("isTexture" in value)) continue;
    try { (value as import("three").Texture).dispose(); } catch { /* texture already released */ }
  }
  material.dispose();
}

function disposeObject(object: import("three").Object3D) {
  object.traverse((node) => {
    const mesh = node as import("three").Mesh;
    try { mesh.geometry?.dispose?.(); } catch { /* geometry already released */ }
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) disposeMaterial(material);
  });
}

function prepareMaterialTextures(material: import("three").Material, renderer: import("three").WebGLRenderer) {
  const values = material as unknown as Record<string, unknown>;
  const colorSlots = new Set(["map", "emissiveMap", "sheenColorMap", "specularColorMap"]);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const [slot, value] of Object.entries(values)) {
    if (!value || typeof value !== "object" || !("isTexture" in value)) continue;
    const texture = value as import("three").Texture;
    if (colorSlots.has(slot)) texture.colorSpace = renderer.outputColorSpace;
    texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
  }
}

async function fetchBoundedBlob(url: string, declaredBytes = 0, signal?: AbortSignal) {
  if (declaredBytes > DEFAULT_RESOURCE_BUDGETS.maxModelSourceBytes) throw new Error(`Model exceeds the ${humanBytes(DEFAULT_RESOURCE_BUDGETS.maxModelSourceBytes)} viewer source budget.`);
  const response = await fetchViewerResourceResponse(url, { signal, headers: { Accept: "model/gltf-binary, model/gltf+json, application/octet-stream, */*" } });
  if (!response.ok) throw new Error(`Model asset request failed (${response.status}).`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > DEFAULT_RESOURCE_BUDGETS.maxModelSourceBytes) throw new Error(`Model response exceeds the ${humanBytes(DEFAULT_RESOURCE_BUDGETS.maxModelSourceBytes)} viewer source budget.`);
  return readBoundedViewerBlob(response, DEFAULT_RESOURCE_BUDGETS.maxModelSourceBytes);
}

async function loadObject(
  sourceName: string,
  extensionOverride: string | null,
  manager: import("three").LoadingManager,
  mainBlob: Blob,
  companionText: Map<string, string>,
): Promise<LoadedModel> {
  const extension = (extensionOverride || fileExtension(sourceName)).toLowerCase();
  const buffer = await mainBlob.arrayBuffer();
  if (!MODEL_EXTENSIONS.has(extension)) throw new Error(`No 3D loader is registered for .${extension || "unknown"}.`);
  if (extension === "blend") throw new Error("Blender sources require an optimized GLB preview derivative before browser viewing.");
  if (extension === "fbx") {
    const { FBXLoader } = await import("three/addons/loaders/FBXLoader.js");
    const object = new FBXLoader(manager).parse(buffer, "");
    return { object, animations: Array.isArray(object.animations) ? object.animations : [] };
  }
  if (extension === "obj") {
    const source = await mainBlob.text();
    const { OBJLoader } = await import("three/addons/loaders/OBJLoader.js");
    const loader = new OBJLoader(manager);
    const materialReference = source.match(/^\s*mtllib\s+(.+?)\s*$/im)?.[1]?.trim() || "";
    if (materialReference) {
      const materialKeys = new Set(assetKeys(materialReference));
      const materialText = [...companionText.entries()].find(([name]) => assetKeys(name).some((key) => materialKeys.has(key)))?.[1];
      if (materialText) {
        try {
          const { MTLLoader } = await import("three/addons/loaders/MTLLoader.js");
          const normalizeRGB = materialText.split(/\r?\n/).some((line) => {
            const match = /^\s*(?:Ka|Kd|Ks|Ke)\s+(-?\d*\.?\d+(?:e[+-]?\d+)?)\s+(-?\d*\.?\d+(?:e[+-]?\d+)?)\s+(-?\d*\.?\d+(?:e[+-]?\d+)?)/i.exec(line);
            return Boolean(match && match.slice(1).some((value) => Number(value) > 1.0001));
          });
          const materialLoader = new MTLLoader(manager);
          materialLoader.setMaterialOptions({ normalizeRGB, ignoreZeroRGBs: true, invertTrProperty: true });
          const materials = materialLoader.parse(materialText, "");
          materials.preload();
          loader.setMaterials(materials);
        } catch { /* fall back to renderer-owned standard materials */ }
      }
    }
    return { object: loader.parse(source), animations: [] };
  }
  if (extension === "stl") {
    const THREE = await import("three");
    const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
    const geometry = new STLLoader(manager).parse(buffer);
    return { object: new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x7aa8ff, roughness: 0.72, metalness: 0.08 })), animations: [] };
  }
  if (extension === "ply") {
    const THREE = await import("three");
    const { PLYLoader } = await import("three/addons/loaders/PLYLoader.js");
    const geometry = new PLYLoader(manager).parse(buffer);
    geometry.computeVertexNormals();
    return { object: new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x7aa8ff, roughness: 0.72, metalness: 0.08, vertexColors: geometry.hasAttribute("color") })), animations: [] };
  }
  if (extension === "gltf" || extension === "glb") {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const loader = new GLTFLoader(manager);
    const source: string | ArrayBuffer = extension === "gltf" ? await mainBlob.text() : buffer;
    return new Promise<LoadedModel>((resolve, reject) => loader.parse(source, "", (result) => resolve({ object: result.scene, animations: result.animations || [] }), reject));
  }
  if (extension === "dae") {
    const { ColladaLoader } = await import("three/addons/loaders/ColladaLoader.js");
    const result = new ColladaLoader(manager).parse(await mainBlob.text(), "");
    if (!result?.scene) throw new Error("The DAE source did not contain a renderable scene.");
    return { object: result.scene, animations: [] };
  }
  const { TDSLoader } = await import("three/addons/loaders/TDSLoader.js");
  return { object: new TDSLoader(manager).parse(buffer, ""), animations: [] };
}

function cameraState(camera: import("three").Camera, target: import("three").Vector3, projection: ProjectionMode): CameraState {
  const typed = camera as import("three").PerspectiveCamera & import("three").OrthographicCamera;
  return {
    projection,
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [target.x, target.y, target.z],
    up: [camera.up.x, camera.up.y, camera.up.z],
    fov: projection === "perspective" ? Number(typed.fov || 38) : undefined,
    zoom: Number(typed.zoom || 1),
  };
}

function spatialLocator(value: unknown): SpatialLocator | null {
  const item = record(value);
  if (item?.type !== "spatial" || !Array.isArray(item.worldPosition) || item.worldPosition.length !== 3) return null;
  const position = item.worldPosition.map(Number);
  if (!position.every(Number.isFinite)) return null;
  const normal = Array.isArray(item.surfaceNormal) && item.surfaceNormal.length === 3 ? item.surfaceNormal.map(Number) : null;
  return {
    type: "spatial",
    objectId: typeof item.objectId === "string" ? item.objectId : null,
    meshId: typeof item.meshId === "string" ? item.meshId : null,
    worldPosition: position as [number, number, number],
    surfaceNormal: normal?.every(Number.isFinite) ? normal as [number, number, number] : null,
    camera: record(item.camera),
    visibility: record(item.visibility) as Record<string, boolean> | null,
    animationId: typeof item.animationId === "string" ? item.animationId : null,
    animationTimeSeconds: Number.isFinite(Number(item.animationTimeSeconds)) ? Number(item.animationTimeSeconds) : null,
  };
}

function reviewComments(asset: Record<string, unknown> | null | undefined): ReviewCommentRecord[] {
  const comments = Array.isArray(asset?.comments) ? asset.comments : [];
  return comments.flatMap((value) => {
    const item = record(value);
    if (!item || typeof item.id !== "string") return [];
    return [{ id: item.id, body: typeof item.body === "string" ? item.body : "", status: typeof item.status === "string" ? item.status : "open", locator: item.locator, user: record(item.user) as ReviewCommentRecord["user"] }];
  });
}

function savedViewsKey(userId: string | null | undefined, resourceId: string) {
  return `cluster.viewer.3d.saved.v1:${userId || "anonymous"}:${resourceId}`;
}

function loadSavedViews(userId: string | null | undefined, resourceId: string): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(savedViewsKey(userId, resourceId)) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_SAVED_VIEWS).flatMap((value) => {
      const item = record(value);
      const camera = record(item?.camera);
      if (!item || typeof item.id !== "string" || typeof item.label !== "string" || !camera) return [];
      if (!Array.isArray(camera.position) || !Array.isArray(camera.target) || !Array.isArray(camera.up)) return [];
      return [{ id: item.id, label: item.label.slice(0, 80), camera: camera as unknown as CameraState, createdAt: typeof item.createdAt === "string" ? item.createdAt : "" }];
    });
  } catch { return []; }
}

function saveSavedViews(userId: string | null | undefined, resourceId: string, views: SavedView[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(savedViewsKey(userId, resourceId), JSON.stringify(views.slice(0, MAX_SAVED_VIEWS))); } catch { /* local preference storage can be unavailable */ }
}

const ThreeModelStage = forwardRef<StageHandle, {
  session: ViewerAssetSession;
  settings: StageSettings;
  pins: SpatialPin[];
  visibleOverlayIds: readonly string[];
  animationController: TimedMediaController;
  activeAnimationId: string | null;
  onActiveAnimationIdChange: (id: string | null) => void;
  onProjectionChange: (mode: ProjectionMode) => void;
  onStateChange: (state: StageLoadState, message?: string) => void;
  onStats: (stats: ModelStats) => void;
  onHierarchy: (nodes: SceneNodeSummary[]) => void;
  onAnimations: (animations: ModelAnimationSummary[]) => void;
  onAnnotationPick: (locator: SpatialLocator) => void;
  onCameraChange?: (camera: CameraState) => void;
}>(({ session, settings, pins, visibleOverlayIds, animationController, activeAnimationId, onActiveAnimationIdChange, onProjectionChange, onStateChange, onStats, onHierarchy, onAnimations, onAnnotationPick, onCameraChange }, ref) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<{
    camera: import("three").Camera;
    perspective: import("three").PerspectiveCamera;
    orthographic: import("three").OrthographicCamera;
    controls: import("three/addons/controls/OrbitControls.js").OrbitControls;
    box: import("three").Box3;
    radius: number;
    projection: ProjectionMode;
    setProjection: (mode: ProjectionMode) => void;
    fit: () => void;
    namedView: (view: NamedView) => void;
    capture: () => CameraState;
    restore: (state: CameraState) => void;
    setObjectVisible: (id: string, visible: boolean) => void;
    showAllObjects: () => void;
  } | null>(null);
  const [projectedPins, setProjectedPins] = useState<Array<{ id: string; x: number; y: number; visible: boolean }>>([]);
  const [projectedNames, setProjectedNames] = useState<Array<{ id: string; name: string; x: number; y: number; visible: boolean }>>([]);
  const settingsRef = useRef(settings);
  const pinsRef = useRef(pins);
  const activeAnimationIdRef = useRef(activeAnimationId);
  const onCameraChangeRef = useRef(onCameraChange);
  const renderRequestRef = useRef<() => void>(() => undefined);
  useEffect(() => { settingsRef.current = settings; renderRequestRef.current(); }, [settings]);
  useEffect(() => { pinsRef.current = pins; renderRequestRef.current(); }, [pins]);
  useEffect(() => { activeAnimationIdRef.current = activeAnimationId; }, [activeAnimationId]);
  useEffect(() => { onCameraChangeRef.current = onCameraChange; }, [onCameraChange]);

  useImperativeHandle(ref, () => ({
    fit: () => runtimeRef.current?.fit(),
    setNamedView: (view) => runtimeRef.current?.namedView(view),
    captureCamera: () => runtimeRef.current?.capture() || null,
    restoreCamera: (camera) => runtimeRef.current?.restore(camera),
    setObjectVisible: (id, visible) => runtimeRef.current?.setObjectVisible(id, visible),
    showAllObjects: () => runtimeRef.current?.showAllObjects(),
  }), []);

  useEffect(() => { runtimeRef.current?.setProjection(settings.projection); }, [settings.projection]);

  const selection = useMemo(() => {
    const resourceSelection = resolveViewerResourceSource(session.resource, ["model_optimized"]);
    const originalExtension = fileExtension(session.resource.source.originalName);
    if (originalExtension === "blend" && !resourceSelection.derivative && session.resource.source.locator.provider === "library_item") {
      const id = session.resource.source.locator.itemId;
      return { ...resourceSelection, url: absoluteViewerResourceUrl(`/api/library/${encodeURIComponent(id)}/model-preview`), mimeType: "model/gltf-binary", extensionOverride: "glb" };
    }
    return { ...resourceSelection, extensionOverride: resourceSelection.derivative?.kind === "model_optimized" ? "glb" : null };
  }, [session.resource]);

  useEffect(() => {
    const host = hostRef.current;
    const wrapper = wrapperRef.current;
    if (!host || !wrapper || !selection.url) { onStateChange("error", "This model does not expose a safe viewer source."); return; }
    let disposed = false;
    let frame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let visibilityObserver: IntersectionObserver | null = null;
    let animationUnsubscribe: (() => void) | null = null;
    let loadedObject: import("three").Object3D | null = null;
    let renderer: import("three").WebGLRenderer | null = null;
    let controls: import("three/addons/controls/OrbitControls.js").OrbitControls | null = null;
    let mixer: import("three").AnimationMixer | null = null;
    let activeAction: import("three").AnimationAction | null = null;
    let gridHelper: import("three").GridHelper | null = null;
    let axesHelper: import("three").AxesHelper | null = null;
    let boxHelper: import("three").Box3Helper | null = null;
    let skeletonHelpers: import("three").SkeletonHelper[] = [];
    let pointerHandler: ((event: PointerEvent) => void) | null = null;
    let renderFrame: ((now: number) => void) | null = null;
    let stageVisible = document.visibilityState === "visible";
    let hostVisible = true;
    let controlsInteracting = false;
    let cameraProjectionDirty = true;
    let lastProjectedPinsRef = pinsRef.current;
    let lastShowObjectNames = settingsRef.current.showObjectNames;
    let appliedLighting: LightingMode | null = null;
    let appliedWireframe: boolean | null = null;
    let appliedSkeleton: boolean | null = null;
    const objectUrls: string[] = [];

    function scheduleRender() {
      if (disposed || frame || !renderFrame || !stageVisible || !hostVisible) return;
      frame = requestAnimationFrame(renderFrame);
    }
    const handleDocumentVisibility = () => {
      stageVisible = document.visibilityState === "visible";
      if (!stageVisible && frame) { cancelAnimationFrame(frame); frame = 0; }
      if (stageVisible) scheduleRender();
    };
    const handleControlsStart = () => { controlsInteracting = true; scheduleRender(); };
    const handleControlsChange = () => { cameraProjectionDirty = true; scheduleRender(); };
    const handleControlsEnd = () => { controlsInteracting = false; scheduleRender(); };
    function bindControlEvents(target: import("three/addons/controls/OrbitControls.js").OrbitControls | null) {
      target?.addEventListener("start", handleControlsStart);
      target?.addEventListener("change", handleControlsChange);
      target?.addEventListener("end", handleControlsEnd);
    }
    function unbindControlEvents(target: import("three/addons/controls/OrbitControls.js").OrbitControls | null) {
      target?.removeEventListener("start", handleControlsStart);
      target?.removeEventListener("change", handleControlsChange);
      target?.removeEventListener("end", handleControlsEnd);
    }
    renderRequestRef.current = scheduleRender;
    document.addEventListener("visibilitychange", handleDocumentVisibility);
    const abort = new AbortController();
    let currentProjection: ProjectionMode = settings.projection;
    let lastProjectionEmit = 0;
    let lastStatsEmit = 0;
    let fpsWindowStarted = performance.now();
    let fpsFrames = 0;
    let fps = 0;
    let frameTimeMs = 0;
    onStateChange("loading");

    void (async () => {
      try {
        const THREE = await import("three");
        const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
        if (disposed) return;
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.02;
        renderer.shadowMap.enabled = true;
        renderer.domElement.className = "cluster-three-canvas";
        renderer.domElement.tabIndex = 0;
        renderer.domElement.setAttribute("aria-label", "Interactive 3D model viewport. Drag to orbit, shift-drag to pan, and scroll to zoom.");
        host.replaceChildren(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x050810);
        const perspective = new THREE.PerspectiveCamera(38, 1, 0.01, 10000);
        const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);
        let camera: import("three").PerspectiveCamera | import("three").OrthographicCamera = currentProjection === "orthographic" ? orthographic : perspective;
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = document.documentElement.dataset.motion !== "reduced";
        controls.dampingFactor = 0.08;
        controls.screenSpacePanning = true;
        controls.zoomToCursor = true;
        controls.minDistance = 0.0001;
        controls.maxDistance = 1_000_000;
        bindControlEvents(controls);

        const ambient = new THREE.AmbientLight(0xffffff, 0.68);
        const hemisphere = new THREE.HemisphereLight(0xc9ddff, 0x182235, 2.25);
        const key = new THREE.DirectionalLight(0xffffff, 3.0);
        key.position.set(4, 6, 5);
        key.castShadow = true;
        const fill = new THREE.DirectionalLight(0x77a7ff, 1.35);
        fill.position.set(-5, 2, -3);
        const rim = new THREE.DirectionalLight(0xd596ff, 0.9);
        rim.position.set(1, 4, -6);
        scene.add(ambient, hemisphere, key, fill, rim);

        const manager = new THREE.LoadingManager();
        const [{ TGALoader }, { DDSLoader }, { RGBELoader }, { EXRLoader }] = await Promise.all([
          import("three/addons/loaders/TGALoader.js"), import("three/addons/loaders/DDSLoader.js"), import("three/addons/loaders/RGBELoader.js"), import("three/addons/loaders/EXRLoader.js"),
        ]);
        manager.addHandler(/\.tga(?:$|[?#])/i, new TGALoader(manager));
        manager.addHandler(/\.dds(?:$|[?#])/i, new DDSLoader(manager));
        manager.addHandler(/\.hdr(?:$|[?#])/i, new RGBELoader(manager));
        manager.addHandler(/\.exr(?:$|[?#])/i, new EXRLoader(manager));

        const assetMap = new Map<string, string>();
        const companionText = new Map<string, string>();
        let companionBytes = 0;
        const companions = (session.resource.companions || []).slice(0, 128);
        for (const entry of companions) {
          const declared = Number(entry.sizeBytes || 0);
          if (declared > DEFAULT_RESOURCE_BUDGETS.maxModelSourceBytes || companionBytes >= DEFAULT_RESOURCE_BUDGETS.maxModelSourceBytes) continue;
          try {
            const blob = await fetchBoundedBlob(absoluteViewerResourceUrl(entry.url), declared, abort.signal);
            if (companionBytes + blob.size > DEFAULT_RESOURCE_BUDGETS.maxModelSourceBytes) continue;
            companionBytes += blob.size;
            const objectUrl = URL.createObjectURL(blob);
            objectUrls.push(objectUrl);
            for (const key of assetKeys(entry.name)) assetMap.set(key, objectUrl);
            if (/\.mtl$/i.test(entry.name) && blob.size <= 8 * 1024 * 1024) companionText.set(entry.name, await blob.text());
          } catch { /* a missing optional companion is allowed to fail independently */ }
        }
        manager.setURLModifier((url) => {
          if (/^(?:data:|blob:)/i.test(url)) return url;
          for (const keyValue of assetKeys(url)) {
            const mapped = assetMap.get(keyValue);
            if (mapped) return mapped;
          }
          throw new Error(`Blocked undeclared model companion resource: ${String(url).slice(0, 160)}`);
        });

        const mainBlob = await fetchBoundedBlob(selection.url, selection.sizeBytes || session.resource.source.sizeBytes, abort.signal);
        const loaded = await loadObject(session.resource.source.originalName, selection.extensionOverride, manager, mainBlob, companionText);
        loadedObject = loaded.object;
        if (disposed) { disposeObject(loadedObject); return; }

        const nodes: SceneNodeSummary[] = [];
        const textureIds = new Set<string>();
        const materialIds = new Set<string>();
        let meshes = 0;
        let vertices = 0;
        let triangles = 0;
        let skins = 0;
        let cameras = 0;
        let lights = 0;
        let texturePixels = 0;
        function assignIds(node: import("three").Object3D, parentId: string | null, index: number) {
          const safeName = String(node.name || node.type || "node").replace(/[\s/\\:]+/g, "-").slice(0, 80) || "node";
          const id = parentId ? `${parentId}/${index}:${safeName}` : `root:${safeName}`;
          node.userData.clusterObjectId = id;
          const mesh = node as import("three").Mesh;
          if (nodes.length < MAX_HIERARCHY_ROWS) nodes.push({ id, parentId, name: String(node.name || node.type || "Unnamed").slice(0, 120), type: node.type, mesh: Boolean(mesh.isMesh), visible: node.visible });
          node.children.forEach((child, childIndex) => assignIds(child, id, childIndex));
        }
        assignIds(loadedObject, null, 0);

        loadedObject.traverse((node) => {
          if ((node as import("three").SkinnedMesh).isSkinnedMesh) skins += 1;
          if ((node as import("three").Camera).isCamera) cameras += 1;
          if ((node as import("three").Light).isLight) lights += 1;
          const mesh = node as import("three").Mesh;
          if (!mesh.isMesh) return;
          meshes += 1;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if (!mesh.geometry.getAttribute("normal")) mesh.geometry.computeVertexNormals();
          const position = mesh.geometry.getAttribute("position");
          if (position) vertices += position.count;
          const index = mesh.geometry.getIndex();
          triangles += index ? Math.floor(index.count / 3) : position ? Math.floor(position.count / 3) : 0;
          const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
          if (!materials.length) mesh.material = new THREE.MeshStandardMaterial({ color: 0x7aa8ff, roughness: 0.72, metalness: 0.08 });
          for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
            if (!material) continue;
            materialIds.add(material.uuid);
            const standard = material as import("three").MeshStandardMaterial;
            if ("side" in standard) standard.side = THREE.DoubleSide;
            if ("roughness" in standard && !Number.isFinite(standard.roughness)) standard.roughness = 0.7;
            prepareMaterialTextures(material, renderer!);
            for (const value of Object.values(material as unknown as Record<string, unknown>)) {
              if (!value || typeof value !== "object" || !("isTexture" in value)) continue;
              const texture = value as import("three").Texture;
              if (textureIds.has(texture.uuid)) continue;
              textureIds.add(texture.uuid);
              const image = texture.image as { width?: number; height?: number } | undefined;
              const width = Number(image?.width || 0);
              const height = Number(image?.height || 0);
              if (Number.isFinite(width) && Number.isFinite(height)) texturePixels += Math.max(0, width * height);
            }
          }
        });
        if (triangles > DEFAULT_RESOURCE_BUDGETS.maxModelTriangles) throw new Error(`Model contains ${triangles.toLocaleString()} triangles, exceeding the ${DEFAULT_RESOURCE_BUDGETS.maxModelTriangles.toLocaleString()} interactive viewer budget.`);
        if (texturePixels > DEFAULT_RESOURCE_BUDGETS.maxTexturePixels) throw new Error(`Model textures exceed the ${DEFAULT_RESOURCE_BUDGETS.maxTexturePixels.toLocaleString()} pixel viewer budget.`);

        scene.add(loadedObject);
        const sourceBox = new THREE.Box3().setFromObject(loadedObject);
        if (sourceBox.isEmpty()) throw new Error("No renderable mesh geometry was found in this model.");
        const center = sourceBox.getCenter(new THREE.Vector3());
        const size = sourceBox.getSize(new THREE.Vector3());
        const radius = Math.max(size.x, size.y, size.z, 0.001);
        loadedObject.position.sub(center);
        loadedObject.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(loadedObject);

        gridHelper = new THREE.GridHelper(radius * 4, 24);
        gridHelper.position.y = box.min.y - radius * 0.015;
        axesHelper = new THREE.AxesHelper(radius * 0.75);
        boxHelper = new THREE.Box3Helper(box);
        scene.add(gridHelper, axesHelper, boxHelper);
        skeletonHelpers = [];
        loadedObject.traverse((node) => {
          if (!(node as import("three").SkinnedMesh).isSkinnedMesh) return;
          const helper = new THREE.SkeletonHelper(node);
          helper.visible = settingsRef.current.skeleton;
          skeletonHelpers.push(helper);
          scene.add(helper);
        });
        appliedSkeleton = settingsRef.current.skeleton;

        function applyLighting(mode: LightingMode) {
          if (mode === "studio") { ambient.intensity = 0.68; hemisphere.intensity = 2.25; key.intensity = 3; fill.intensity = 1.35; rim.intensity = 0.9; }
          else if (mode === "neutral") { ambient.intensity = 1.15; hemisphere.intensity = 1.35; key.intensity = 1.6; fill.intensity = 0.7; rim.intensity = 0.3; }
          else { ambient.intensity = 1.8; hemisphere.intensity = 0.75; key.intensity = 0.55; fill.intensity = 0.35; rim.intensity = 0.15; }
        }
        applyLighting(settingsRef.current.lighting);
        appliedLighting = settingsRef.current.lighting;

        function setWireframe(enabled: boolean) {
          loadedObject?.traverse((node) => {
            const mesh = node as import("three").Mesh;
            if (!mesh.isMesh) return;
            for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
              if (material && "wireframe" in material) (material as import("three").MeshStandardMaterial).wireframe = enabled;
            }
          });
        }
        setWireframe(settingsRef.current.wireframe);
        appliedWireframe = settingsRef.current.wireframe;

        function resize() {
          if (!renderer) return;
          const width = Math.max(1, host!.clientWidth);
          const height = Math.max(1, host!.clientHeight);
          renderer.setSize(width, height, false);
          cameraProjectionDirty = true;
          perspective.aspect = width / height;
          perspective.updateProjectionMatrix();
          const halfHeight = radius * 1.25;
          const halfWidth = halfHeight * (width / height);
          orthographic.left = -halfWidth;
          orthographic.right = halfWidth;
          orthographic.top = halfHeight;
          orthographic.bottom = -halfHeight;
          orthographic.updateProjectionMatrix();
          scheduleRender();
        }

        function applyCameraToControls(nextCamera: typeof camera) {
          const oldControls = controls;
          if (!renderer || !oldControls) return;
          const target = oldControls.target.clone();
          const position = oldControls.object.position.clone();
          const up = oldControls.object.up.clone();
          unbindControlEvents(oldControls);
          oldControls.dispose();
          camera = nextCamera;
          camera.position.copy(position);
          camera.up.copy(up);
          controls = new OrbitControls(camera, renderer.domElement);
          controls.enableDamping = document.documentElement.dataset.motion !== "reduced";
          controls.dampingFactor = 0.08;
          controls.screenSpacePanning = true;
          controls.zoomToCursor = true;
          controls.target.copy(target);
          controls.minDistance = radius * 0.001;
          controls.maxDistance = radius * 1000;
          bindControlEvents(controls);
          controls.update();
          scheduleRender();
        }

        function setProjection(mode: ProjectionMode) {
          if (mode === currentProjection) return;
          const target = controls?.target.clone() || new THREE.Vector3();
          const distance = Math.max(radius * 0.01, camera.position.distanceTo(target));
          if (mode === "orthographic") {
            const fovRadians = THREE.MathUtils.degToRad(perspective.fov);
            const visibleHeight = Math.max(radius * 0.01, 2 * Math.tan(fovRadians / 2) * distance);
            const baseHeight = Math.max(radius * 0.01, orthographic.top - orthographic.bottom);
            orthographic.zoom = clamp(baseHeight / visibleHeight, 0.01, 1000);
            orthographic.updateProjectionMatrix();
            applyCameraToControls(orthographic);
          } else {
            const visibleHeight = Math.max(radius * 0.01, (orthographic.top - orthographic.bottom) / Math.max(orthographic.zoom, 0.0001));
            const distanceForHeight = visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2));
            const direction = camera.position.clone().sub(target).normalize();
            perspective.position.copy(target.clone().add(direction.multiplyScalar(distanceForHeight)));
            applyCameraToControls(perspective);
          }
          currentProjection = mode;
          runtimeRef.current && (runtimeRef.current.projection = mode);
          onProjectionChange(mode);
          resize();
          scheduleRender();
        }

        function fit() {
          const target = new THREE.Vector3(0, 0, 0);
          const direction = new THREE.Vector3(1.5, 0.85, 2.15).normalize();
          if (camera === perspective) {
            const fitHeightDistance = radius / (2 * Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2));
            const distance = Math.max(radius * 1.45, fitHeightDistance * 1.35);
            perspective.position.copy(direction.multiplyScalar(distance));
            perspective.near = Math.max(radius / 5000, 0.0001);
            perspective.far = Math.max(radius * 1000, 100);
            perspective.updateProjectionMatrix();
          } else {
            orthographic.position.copy(direction.multiplyScalar(radius * 3));
            orthographic.zoom = 0.8;
            orthographic.near = Math.max(radius / 5000, 0.0001);
            orthographic.far = Math.max(radius * 1000, 100);
            orthographic.updateProjectionMatrix();
          }
          controls?.target.copy(target);
          controls?.update();
          scheduleRender();
        }

        const directions: Record<NamedView, import("three").Vector3> = {
          front: new THREE.Vector3(0, 0, 1), back: new THREE.Vector3(0, 0, -1), left: new THREE.Vector3(-1, 0, 0), right: new THREE.Vector3(1, 0, 0),
          top: new THREE.Vector3(0, 1, 0.0001), bottom: new THREE.Vector3(0, -1, 0.0001), isometric: new THREE.Vector3(1, 0.8, 1),
        };
        function namedView(view: NamedView) {
          const target = controls?.target.clone() || new THREE.Vector3();
          const distance = Math.max(radius * 2.7, camera.position.distanceTo(target));
          camera.position.copy(target.clone().add(directions[view].clone().normalize().multiplyScalar(distance)));
          camera.up.set(0, 1, 0);
          if (view === "top") camera.up.set(0, 0, -1);
          if (view === "bottom") camera.up.set(0, 0, 1);
          camera.lookAt(target);
          controls?.update();
          scheduleRender();
        }

        function capture() { return cameraState(camera, controls?.target || new THREE.Vector3(), currentProjection); }
        function restore(state: CameraState) {
          if (!Array.isArray(state.position) || !Array.isArray(state.target)) return;
          setProjection(state.projection === "orthographic" ? "orthographic" : "perspective");
          camera.position.fromArray(state.position);
          camera.up.fromArray(state.up || [0, 1, 0]);
          controls?.target.fromArray(state.target);
          if (camera === perspective && Number.isFinite(state.fov)) perspective.fov = clamp(Number(state.fov), 5, 120);
          if (camera === orthographic && Number.isFinite(state.zoom)) orthographic.zoom = clamp(Number(state.zoom), 0.01, 1000);
          camera.updateProjectionMatrix();
          controls?.update();
          scheduleRender();
        }

        function emitHierarchy() {
          onHierarchy(nodes.map((entry) => {
            let visible = entry.visible;
            loadedObject?.traverse((node) => { if (node.userData.clusterObjectId === entry.id) visible = node.visible; });
            return { ...entry, visible };
          }));
        }
        function setObjectVisible(id: string, visible: boolean) {
          loadedObject?.traverse((node) => { if (node.userData.clusterObjectId === id) node.visible = visible; });
          emitHierarchy();
          scheduleRender();
        }
        function showAllObjects() {
          loadedObject?.traverse((node) => { node.visible = true; });
          emitHierarchy();
          scheduleRender();
        }

        runtimeRef.current = { camera, perspective, orthographic, controls, box, radius, projection: currentProjection, setProjection, fit, namedView, capture, restore, setObjectVisible, showAllObjects };
        fit();
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);
        if (typeof IntersectionObserver !== "undefined") {
          visibilityObserver = new IntersectionObserver((entries) => {
            hostVisible = entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0);
            if (!hostVisible && frame) { cancelAnimationFrame(frame); frame = 0; }
            if (hostVisible) scheduleRender();
          }, { rootMargin: "160px" });
          visibilityObserver.observe(wrapper);
        }
        resize();

        const animationSummaries = loaded.animations.map((clip, index) => ({ id: String(index), label: String(clip.name || `Animation ${index + 1}`).slice(0, 120), duration: Math.max(0, Number(clip.duration || 0)) }));
        onAnimations(animationSummaries);
        if (loaded.animations.length) {
          mixer = new THREE.AnimationMixer(loadedObject);
          let activeIndex = clamp(Number(activeAnimationId || 0), 0, Math.max(0, loaded.animations.length - 1));
          function selectAnimation(index: number) {
            activeAction?.stop();
            const clip = loaded.animations[index];
            if (!clip || !mixer) return;
            activeIndex = index;
            activeAction = mixer.clipAction(clip);
            activeAction.play();
            activeAction.paused = true;
            mixer.setTime(0);
          }
          selectAnimation(activeIndex);
          if (String(activeIndex) !== activeAnimationId) onActiveAnimationIdChange(String(activeIndex));
          const adapter: TimedClockAdapter = {
            duration: Math.max(0, loaded.animations[activeIndex]?.duration || 0), currentTime: 0, playbackRate: 1, paused: true,
            play() { this.paused = false; if (activeAction) activeAction.paused = false; },
            pause() { this.paused = true; if (activeAction) activeAction.paused = true; },
            seek(seconds) { this.currentTime = clamp(seconds, 0, this.duration); mixer?.setTime(this.currentTime); },
            setPlaybackRate(rate) { this.playbackRate = rate; if (activeAction) activeAction.timeScale = rate; },
          };
          (adapter as TimedClockAdapter & { selectAnimation?: (id: string) => void }).selectAnimation = (id: string) => {
            const index = clamp(Number(id), 0, Math.max(0, loaded.animations.length - 1));
            selectAnimation(index);
            adapter.duration = Math.max(0, loaded.animations[index]?.duration || 0);
            adapter.currentTime = 0;
            adapter.paused = true;
          };
          (wrapper as HTMLDivElement & { __clusterAnimationAdapter?: TimedClockAdapter & { selectAnimation?: (id: string) => void } }).__clusterAnimationAdapter = adapter;
          animationController.attachClock(adapter);
        } else animationController.attachClock(null);

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        pointerHandler = (event: PointerEvent) => {
          if (!settingsRef.current.annotationMode || !loadedObject || !renderer) return;
          if (event.button !== 0) return;
          const rect = renderer.domElement.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          const hit = raycaster.intersectObject(loadedObject, true)[0];
          if (!hit) return;
          const objectId = typeof hit.object.userData.clusterObjectId === "string" ? hit.object.userData.clusterObjectId : null;
          let normal: [number, number, number] | null = null;
          if (hit.face?.normal) {
            const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
            normal = [n.x, n.y, n.z];
          }
          const visibility: Record<string, boolean> = {};
          let hiddenCount = 0;
          loadedObject.traverse((node) => {
            if (hiddenCount >= 512 || node.visible) return;
            const id = typeof node.userData.clusterObjectId === "string" ? node.userData.clusterObjectId : null;
            if (!id) return;
            visibility[id] = false;
            hiddenCount += 1;
          });
          onAnnotationPick({
            type: "spatial",
            objectId,
            meshId: (hit.object as import("three").Mesh).isMesh ? objectId : null,
            worldPosition: [hit.point.x, hit.point.y, hit.point.z],
            surfaceNormal: normal,
            camera: capture() as unknown as Record<string, unknown>,
            visibility: hiddenCount ? visibility : null,
            animationId: activeAnimationIdRef.current,
            animationTimeSeconds: animationController.getSnapshot().currentTime,
          });
        };
        renderer.domElement.addEventListener("pointerdown", pointerHandler);

        onHierarchy(nodes);
        onStats({
          meshes, vertices, triangles, materials: materialIds.size, textures: textureIds.size, texturePixels, animations: loaded.animations.length, skins, cameras, lights,
          drawCalls: 0, fps: 0, frameTimeMs: 0, gpuEstimateBytes: vertices * 32 + triangles * 12 + texturePixels * 4,
          bounds: { x: size.x, y: size.y, z: size.z },
        });
        onStateChange("ready");

        renderFrame = (now: number) => {
          frame = 0;
          if (disposed || !renderer || !controls || !stageVisible || !hostVisible) return;
          const frameStart = performance.now();
          runtimeRef.current!.camera = camera;
          runtimeRef.current!.controls = controls;
          gridHelper!.visible = settingsRef.current.grid;
          axesHelper!.visible = settingsRef.current.axes;
          boxHelper!.visible = settingsRef.current.bounds;
          if (appliedSkeleton !== settingsRef.current.skeleton) {
            appliedSkeleton = settingsRef.current.skeleton;
            skeletonHelpers.forEach((helper) => { helper.visible = appliedSkeleton!; });
          }
          if (appliedLighting !== settingsRef.current.lighting) {
            appliedLighting = settingsRef.current.lighting;
            applyLighting(appliedLighting);
          }
          if (appliedWireframe !== settingsRef.current.wireframe) {
            appliedWireframe = settingsRef.current.wireframe;
            setWireframe(appliedWireframe);
          }
          controls.update();
          renderer.render(scene, camera);
          fpsFrames += 1;
          const elapsed = now - fpsWindowStarted;
          frameTimeMs = performance.now() - frameStart;
          if (elapsed >= 500) { fps = fpsFrames * 1000 / elapsed; fpsFrames = 0; fpsWindowStarted = now; }
          if (now - lastStatsEmit >= 500) {
            lastStatsEmit = now;
            onStats({ meshes, vertices, triangles, materials: materialIds.size, textures: textureIds.size, texturePixels, animations: loaded.animations.length, skins, cameras, lights, drawCalls: renderer.info.render.calls, fps, frameTimeMs, gpuEstimateBytes: vertices * 32 + triangles * 12 + texturePixels * 4, bounds: { x: size.x, y: size.y, z: size.z } });
          }
          const animationPlaying = animationController.getSnapshot().phase === "playing";
          const projectionNeeded = cameraProjectionDirty
            || pinsRef.current !== lastProjectedPinsRef
            || settingsRef.current.showObjectNames !== lastShowObjectNames
            || (animationPlaying && settingsRef.current.showObjectNames);
          if (projectionNeeded && now - lastProjectionEmit >= 80) {
            lastProjectionEmit = now;
            if (cameraProjectionDirty) onCameraChangeRef.current?.(capture());
            const rect = renderer.domElement.getBoundingClientRect();
            const nextPins = pinsRef.current.map((pin) => {
              const point = new THREE.Vector3(...pin.locator.worldPosition).project(camera);
              return { id: pin.id, x: (point.x * 0.5 + 0.5) * rect.width, y: (-point.y * 0.5 + 0.5) * rect.height, visible: point.z >= -1 && point.z <= 1 };
            });
            if (nextPins.length) setProjectedPins(nextPins);
            else setProjectedPins((current) => current.length ? [] : current);
            if (settingsRef.current.showObjectNames) {
              const labels: Array<{ id: string; name: string; x: number; y: number; visible: boolean }> = [];
              loadedObject?.traverse((node) => {
                if (labels.length >= 24 || !node.name) return;
                const world = new THREE.Vector3();
                node.getWorldPosition(world);
                const projected = world.project(camera);
                labels.push({ id: String(node.userData.clusterObjectId || node.uuid), name: node.name.slice(0, 60), x: (projected.x * 0.5 + 0.5) * rect.width, y: (-projected.y * 0.5 + 0.5) * rect.height, visible: projected.z >= -1 && projected.z <= 1 });
              });
              setProjectedNames(labels);
            } else setProjectedNames((current) => current.length ? [] : current);
            cameraProjectionDirty = false;
            lastProjectedPinsRef = pinsRef.current;
            lastShowObjectNames = settingsRef.current.showObjectNames;
          }
          if (controlsInteracting || animationPlaying) scheduleRender();
        };
        animationUnsubscribe = animationController.subscribe(() => scheduleRender());
        scheduleRender();
      } catch (error) {
        if (!disposed) onStateChange("error", error instanceof Error ? error.message : "Could not render this model.");
      }
    })();

    return () => {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(frame);
      frame = 0;
      renderRequestRef.current = () => undefined;
      document.removeEventListener("visibilitychange", handleDocumentVisibility);
      resizeObserver?.disconnect();
      visibilityObserver?.disconnect();
      animationUnsubscribe?.();
      unbindControlEvents(controls);
      if (renderer?.domElement && pointerHandler) renderer.domElement.removeEventListener("pointerdown", pointerHandler);
      animationController.attachClock(null);
      const animationHost = wrapper as HTMLDivElement & { __clusterAnimationAdapter?: TimedClockAdapter & { selectAnimation?: (id: string) => void } };
      animationHost.__clusterAnimationAdapter = undefined;
      mixer?.stopAllAction();
      controls?.dispose();
      if (loadedObject) disposeObject(loadedObject);
      for (const helper of skeletonHelpers) {
        try { helper.geometry.dispose(); (helper.material as import("three").Material).dispose(); } catch { /* helper already released */ }
      }
      try { gridHelper?.geometry.dispose(); (gridHelper?.material as import("three").Material | undefined)?.dispose(); } catch {}
      try { axesHelper?.geometry.dispose(); (axesHelper?.material as import("three").Material | undefined)?.dispose(); } catch {}
      try { (boxHelper?.geometry as import("three").BufferGeometry | undefined)?.dispose(); (boxHelper?.material as import("three").Material | undefined)?.dispose(); } catch {}
      renderer?.renderLists.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      runtimeRef.current = null;
      host.replaceChildren();
    };
  }, [selection.url, selection.extensionOverride, selection.sizeBytes, session.resource.source.id, session.resource.source.versionId, session.resource.source.originalName, session.resource.companions, animationController]);

  useEffect(() => {
    const wrapper = wrapperRef.current as (HTMLDivElement & { __clusterAnimationAdapter?: TimedClockAdapter & { selectAnimation?: (id: string) => void } }) | null;
    wrapper?.__clusterAnimationAdapter?.selectAnimation?.(activeAnimationId || "0");
    if (wrapper?.__clusterAnimationAdapter) animationController.attachClock(wrapper.__clusterAnimationAdapter);
  }, [activeAnimationId, animationController]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.setProjection(settings.projection);
  }, [settings.projection]);

  const showPins = visibleOverlayIds.includes("review.annotations");
  return <div ref={wrapperRef} className={`cluster-three-stage${settings.annotationMode ? " annotation-mode" : ""}`}>
    <div ref={hostRef} className="cluster-three-host" />
    {showPins ? <div className="cluster-three-pin-layer" aria-label="3D review pins">{projectedPins.map((projected) => {
      const pin = pins.find((item) => item.id === projected.id);
      if (!pin || !projected.visible) return null;
      return <ClusterButton key={pin.id} type="button" variant="quiet" size="compact" className={`cluster-three-review-pin${pin.status === "resolved" ? " resolved" : ""}`} style={runtimeStyle({ left: `${projected.x}px`, top: `${projected.y}px` })} title={pin.label} aria-label={pin.label} onClick={() => { const camera = record(pin.locator.camera); if (camera) runtimeRef.current?.restore(camera as unknown as CameraState); }}><ClusterIcon name="pin" /></ClusterButton>;
    })}</div> : null}
    {settings.showObjectNames ? <div className="cluster-three-name-layer" aria-hidden="true">{projectedNames.filter((item) => item.visible).map((item) => <span key={item.id} style={runtimeStyle({ left: `${item.x}px`, top: `${item.y}px` })}>{item.name}</span>)}</div> : null}
  </div>;
});
ThreeModelStage.displayName = "ThreeModelStage";

export type UnifiedThreeViewerHandle = StageHandle;

export const UnifiedThreeViewer = forwardRef<UnifiedThreeViewerHandle, {
  input: ViewerAssetSessionInput;
  compareInput?: ViewerAssetSessionInput | null;
  userId?: string | null;
  mode?: ViewerMode;
  onModeChange?: (mode: ViewerMode) => void;
  onReviewMutation?: () => void;
}>(({ input, compareInput = null, userId, mode: controlledMode, onModeChange, onReviewMutation }, forwardedRef) => {
  const assetSession = useViewerAssetSession(input);
  const compareAssetSession = useViewerAssetSession(compareInput);
  const [localMode, setLocalMode] = useState<ViewerMode>(controlledMode || "view");
  const [projection, setProjection] = useState<ProjectionMode>("perspective");
  const [grid, setGrid] = useState(true);
  const [axes, setAxes] = useState(true);
  const [bounds, setBounds] = useState(false);
  const [skeleton, setSkeleton] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [lighting, setLighting] = useState<LightingMode>("studio");
  const [showObjectNames, setShowObjectNames] = useState(false);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [draftLocator, setDraftLocator] = useState<SpatialLocator | null>(null);
  const [note, setNote] = useState("");
  const [postError, setPostError] = useState("");
  const [posting, setPosting] = useState(false);
  const [loadState, setLoadState] = useState<StageLoadState>("loading");
  const [loadMessage, setLoadMessage] = useState("");
  const [stats, setStats] = useState<ModelStats>({ meshes: 0, vertices: 0, triangles: 0, materials: 0, textures: 0, texturePixels: 0, animations: 0, skins: 0, cameras: 0, lights: 0, drawCalls: 0, fps: 0, frameTimeMs: 0, gpuEstimateBytes: 0, bounds: null });
  const [hierarchy, setHierarchy] = useState<SceneNodeSummary[]>([]);
  const [animations, setAnimations] = useState<ModelAnimationSummary[]>([]);
  const [activeAnimationId, setActiveAnimationId] = useState<string | null>(null);
  const stageRef = useRef<StageHandle>(null);
  const activeAnimationIdRef = useRef(activeAnimationId);
  const compareStageRef = useRef<StageHandle>(null);
  const mode = controlledMode || localMode;
  const resourceIdentity = assetSession.session?.resource.source.id || "3d";
  const compareIdentity = compareAssetSession.session?.resource.source.id || "3d-compare";
  const { controller: animationController, snapshot: animationSnapshot } = useTimedMediaController(`3d:${resourceIdentity}`);
  const { controller: compareAnimationController } = useTimedMediaController(`3d-compare:${compareIdentity}`);
  const { comparisonSession, comparison } = useReviewComparisonSession({ medium: "3d", userId, identity: resourceIdentity, enabled: Boolean(compareInput) });
  const currentSavedViewKey = assetSession.session ? savedViewsKey(userId, assetSession.session.resource.source.id) : null;
  const [savedViewState, setSavedViewState] = useState<{ key: string | null; views: SavedView[] }>({ key: null, views: [] });
  const savedViews = currentSavedViewKey && savedViewState.key === currentSavedViewKey ? savedViewState.views : [];
  const setSavedViews = useCallback((update: SavedView[] | ((current: SavedView[]) => SavedView[])) => {
    if (!currentSavedViewKey || !assetSession.session) return;
    const resourceId = assetSession.session.resource.source.id;
    setSavedViewState((current) => {
      const previous = current.key === currentSavedViewKey ? current.views : loadSavedViews(userId, resourceId);
      return { key: currentSavedViewKey, views: typeof update === "function" ? update(previous) : update };
    });
  }, [currentSavedViewKey, userId, assetSession.session?.resource.source.id]);

  useImperativeHandle(forwardedRef, () => ({
    fit: () => stageRef.current?.fit(),
    setNamedView: (view) => stageRef.current?.setNamedView(view),
    captureCamera: () => stageRef.current?.captureCamera() || null,
    restoreCamera: (camera) => stageRef.current?.restoreCamera(camera),
    setObjectVisible: (id, visible) => stageRef.current?.setObjectVisible(id, visible),
    showAllObjects: () => stageRef.current?.showAllObjects(),
  }), []);
  useEffect(() => { activeAnimationIdRef.current = activeAnimationId; }, [activeAnimationId]);

  const setMode = useCallback((next: ViewerMode) => { setLocalMode(next); onModeChange?.(next); }, [onModeChange]);
  useEffect(() => {
    if (!currentSavedViewKey || !assetSession.session) return;
    setSavedViewState({ key: currentSavedViewKey, views: loadSavedViews(userId, assetSession.session.resource.source.id) });
  }, [currentSavedViewKey]);
  useEffect(() => {
    if (!currentSavedViewKey || savedViewState.key !== currentSavedViewKey || !assetSession.session) return;
    saveSavedViews(userId, assetSession.session.resource.source.id, savedViewState.views);
  }, [currentSavedViewKey, savedViewState, userId, assetSession.session?.resource.source.id]);

  const comments = reviewComments(assetSession.session?.asset);
  const pins = useMemo<SpatialPin[]>(() => comments.flatMap((comment) => {
    const locator = spatialLocator(comment.locator);
    if (!locator) return [];
    const author = comment.user?.displayName || comment.user?.username || "Reviewer";
    return [{ id: comment.id, status: comment.status, locator, label: `${author}: ${comment.body || "3D review note"}` }];
  }), [comments]);

  const syncComparisonCamera = useCallback((camera: CameraState) => {
    if (comparison.syncCamera && compareAssetSession.session) compareStageRef.current?.restoreCamera(camera);
  }, [comparison.syncCamera, compareAssetSession.session?.resource.source.id]);

  const saveCurrentView = useCallback(() => {
    const camera = stageRef.current?.captureCamera();
    if (!camera) return;
    setSavedViews((current) => [{ id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: `View ${current.length + 1}`, camera, createdAt: new Date().toISOString() }, ...current].slice(0, MAX_SAVED_VIEWS));
  }, []);

  const commands = useMemo<ViewerCommandDefinition[]>(() => [
    { id: "viewer.3d.fit", label: "Fit / Home", description: "Frame the full model using bounds-derived camera placement.", icon: "home", shortcut: "0", priority: 10, group: "view", run: () => stageRef.current?.fit() },
    { id: "viewer.3d.projection", label: projection === "perspective" ? "Orthographic" : "Perspective", description: "Switch projection while preserving approximate apparent framing.", icon: "model", shortcut: "5", priority: 20, group: "view", run: () => setProjection((value) => value === "perspective" ? "orthographic" : "perspective") },
    { id: "viewer.3d.front", label: "Front view", shortcut: "1", priority: 30, group: "view", overflow: true, run: () => stageRef.current?.setNamedView("front") },
    { id: "viewer.3d.right", label: "Right view", shortcut: "3", priority: 31, group: "view", overflow: true, run: () => stageRef.current?.setNamedView("right") },
    { id: "viewer.3d.top", label: "Top view", shortcut: "7", priority: 32, group: "view", overflow: true, run: () => stageRef.current?.setNamedView("top") },
    { id: "viewer.3d.isometric", label: "Isometric view", shortcut: "9", priority: 33, group: "view", overflow: true, run: () => stageRef.current?.setNamedView("isometric") },
    { id: "viewer.3d.wireframe", label: wireframe ? "Materials" : "Wireframe", icon: "grid", shortcut: "w", priority: 40, group: "technical", run: () => setWireframe((value) => !value) },
    { id: "viewer.3d.save_view", label: "Save viewpoint", icon: "star", shortcut: "v", priority: 45, group: "review", run: saveCurrentView },
    { id: "viewer.3d.add_note", label: annotationMode ? "Stop pinning" : "Add 3D review pin", icon: "comment", shortcut: "a", priority: 10, group: "review", requiredCapability: "annotate", visible: (context) => context.resource.source.locator.provider === "review_asset", run: () => { setAnnotationMode((value) => !value); setDraftLocator(null); setMode("review"); } },
  ], [projection, wireframe, annotationMode, saveCurrentView, setMode]);

  const settings = useMemo<StageSettings>(() => ({ projection, grid, axes, bounds, skeleton, wireframe, lighting, showObjectNames, annotationMode }), [projection, grid, axes, bounds, skeleton, wireframe, lighting, showObjectNames, annotationMode]);

  async function postAnnotation() {
    const session = assetSession.session;
    if (!session || session.resource.source.locator.provider !== "review_asset" || !session.capabilities.comment || !session.capabilities.annotate || !draftLocator || !note.trim() || posting) return;
    setPosting(true);
    setPostError("");
    try {
      const response = await clusterApiFetch(`/api/review-assets/${encodeURIComponent(session.resource.source.locator.assetId)}/comments`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: note.trim(), locator: { ...draftLocator, animationId: activeAnimationIdRef.current, animationTimeSeconds: animationSnapshot.currentTime }, category: "model", priority: "medium" }),
      });
      if (!response.ok) throw new Error(`Review note failed (${response.status}).`);
      setNote(""); setDraftLocator(null); setAnnotationMode(false); assetSession.reload(); onReviewMutation?.();
    } catch (error) { setPostError(error instanceof Error ? error.message : "Could not post review note."); }
    finally { setPosting(false); }
  }

  const adapterDiagnostics = useMemo(() => ({
    state: loadState,
    projection,
    lighting,
    wireframe,
    grid,
    axes,
    bounds,
    skeleton,
    meshes: stats.meshes,
    vertices: stats.vertices,
    triangles: stats.triangles,
    materials: stats.materials,
    textures: stats.textures,
    texturePixels: stats.texturePixels,
    drawCalls: stats.drawCalls,
    fps: Number(stats.fps.toFixed(1)),
    frameTimeMs: Number(stats.frameTimeMs.toFixed(2)),
    gpuEstimateBytes: stats.gpuEstimateBytes,
    hierarchyRows: hierarchy.length,
    animationCount: animations.length,
    animation: activeAnimationId,
    animationTimeSeconds: animationSnapshot.currentTime,
    animationPhase: animationSnapshot.phase,
    comparisonMode: compareAssetSession.session ? comparison.mode : "off",
    comparisonCameraSync: compareAssetSession.session ? comparison.syncCamera : false,
  }), [loadState, projection, lighting, wireframe, grid, axes, bounds, skeleton, stats, hierarchy.length, animations.length, activeAnimationId, animationSnapshot.currentTime, animationSnapshot.phase, compareAssetSession.session?.resource.source.id, comparison.mode, comparison.syncCamera]);

  const inspectorSections = useMemo<ViewerInspectorSection[]>(() => [
    { title: "Scene", value: { Projection: projection, Lighting: lighting, Meshes: stats.meshes, Vertices: stats.vertices, Triangles: stats.triangles, Materials: stats.materials, Textures: stats.textures, "Texture pixels": stats.texturePixels, Skins: stats.skins, Cameras: stats.cameras, Lights: stats.lights, Bounds: stats.bounds ? `${stats.bounds.x.toFixed(3)} × ${stats.bounds.y.toFixed(3)} × ${stats.bounds.z.toFixed(3)}` : "—" } },
    { title: "Hierarchy", value: Object.fromEntries(hierarchy.slice(0, MAX_HIERARCHY_ROWS).map((node, index) => [`${index + 1}. ${node.name}`, `${node.type}${node.mesh ? " · mesh" : ""}${node.visible ? "" : " · hidden"}`])), empty: "No scene nodes reported.", open: false },
    { title: "Viewpoints", value: Object.fromEntries(savedViews.map((view) => [view.label, view.createdAt || "Saved locally"])), empty: "No saved viewpoints.", open: false },
    { title: "Animations", value: Object.fromEntries(animations.map((animation) => [animation.label, `${animation.duration.toFixed(2)} s`])), empty: "No timed model animations.", open: animations.length > 0 },
  ], [projection, lighting, stats, hierarchy, savedViews, animations]);

  return <ViewerShell
    assetSession={assetSession}
    userId={userId}
    mode={mode}
    onModeChange={setMode}
    commands={commands}
    overlays={viewerOverlayCatalogForMedium("3d")}
    adapterDiagnostics={adapterDiagnostics}
    adapterInspectorSections={inspectorSections}
    onReviewNavigate={(locator) => { if (locator.type === "spatial") { if (locator.camera) stageRef.current?.restoreCamera(locator.camera as CameraState); if (locator.animationTimeSeconds != null) animationController.seek(locator.animationTimeSeconds); } }}
    renderAdapter={({ session, visibleOverlayIds, overlayPlacements }) => {
      const overlayValues: Record<string, string> = {
        "source.derivative": session.resource.preferredDerivativeId ? "Optimized runtime derivative" : session.resource.source.support === "native" ? "Original GLB/glTF" : "Original source · degraded fallback",
        "review.annotations": `${pins.length} review pin${pins.length === 1 ? "" : "s"}`,
        "3d.fps": `${stats.fps.toFixed(1)} FPS`,
        "3d.frame_time": `${stats.frameTimeMs.toFixed(2)} ms`,
        "3d.polygons": `${stats.triangles.toLocaleString()} triangles`,
        "3d.vertices": `${stats.vertices.toLocaleString()} vertices`,
        "3d.draw_calls": `${stats.drawCalls.toLocaleString()} draw calls`,
        "3d.textures": `${stats.textures} textures`,
        "3d.gpu_estimate": `≈ ${humanBytes(stats.gpuEstimateBytes)}`,
        "3d.bounds": stats.bounds ? `${stats.bounds.x.toFixed(2)} × ${stats.bounds.y.toFixed(2)} × ${stats.bounds.z.toFixed(2)}` : "Bounds pending",
        "3d.grid_axes": `${grid ? "Grid" : "No grid"} · ${axes ? "Axes" : "No axes"}`,
        "3d.skeleton": skeleton ? `${stats.skins} skin${stats.skins === 1 ? "" : "s"}` : "Hidden",
        "3d.lights_cameras": `${stats.lights} lights · ${stats.cameras} cameras`,
        "3d.object_names": showObjectNames ? "Object labels on" : `${hierarchy.length} indexed nodes`,
      };
      return <div className="cluster-three-adapter">
        {compareAssetSession.session ? <ViewerComparisonBar session={comparisonSession} snapshot={comparison} primaryLabel={session.resource.source.title} secondaryLabel={compareAssetSession.session.resource.source.title} /> : null}
        <div className={`cluster-three-stage-wrap${compareAssetSession.session ? " is-comparing" : ""}`}>
          <ThreeModelStage ref={stageRef} session={session} settings={settings} pins={pins} visibleOverlayIds={visibleOverlayIds} animationController={animationController} activeAnimationId={activeAnimationId} onActiveAnimationIdChange={setActiveAnimationId} onProjectionChange={setProjection} onStateChange={(state, message) => { setLoadState(state); setLoadMessage(message || ""); }} onStats={setStats} onHierarchy={setHierarchy} onAnimations={(next) => { setAnimations(next); if (next.length && activeAnimationId == null) setActiveAnimationId(next[0].id); }} onAnnotationPick={(locator) => { setDraftLocator(locator); setMode("review"); }} onCameraChange={syncComparisonCamera} />
          {compareAssetSession.session ? <ThreeModelStage ref={compareStageRef} session={compareAssetSession.session} settings={{ ...settings, annotationMode: false }} pins={[]} visibleOverlayIds={[]} animationController={compareAnimationController} activeAnimationId={null} onActiveAnimationIdChange={() => undefined} onProjectionChange={() => undefined} onStateChange={(state) => { if (state === "ready" && comparison.syncCamera) { const camera = stageRef.current?.captureCamera(); if (camera) compareStageRef.current?.restoreCamera(camera); } }} onStats={() => undefined} onHierarchy={() => undefined} onAnimations={() => undefined} onAnnotationPick={() => undefined} /> : null}
          {loadState === "loading" ? <div className="cluster-three-state" role="status"><span className="cluster-viewer-spinner" /><strong>Preparing 3D scene</strong><p>Loading the declared source and bounded companion resources…</p></div> : null}
          {loadState === "error" ? <div className="cluster-three-state error" role="alert"><ClusterIcon name="warning" /><strong>3D preview unavailable</strong><p>{loadMessage}</p><ClusterButton size="compact" variant="secondary" onClick={assetSession.reload}>Retry</ClusterButton></div> : null}
          {annotationMode && !draftLocator ? <div className="cluster-three-annotation-hint"><ClusterIcon name="pin" />Click a model surface to place a review pin.</div> : null}
          <div className="cluster-three-view-cube" aria-label="Standard 3D views">
            <ClusterButton size="compact" variant="quiet" onClick={() => stageRef.current?.setNamedView("top")}>Top</ClusterButton>
            <ClusterButton size="compact" variant="quiet" onClick={() => stageRef.current?.setNamedView("bottom")}>Bottom</ClusterButton>
            <ClusterButton size="compact" variant="quiet" onClick={() => stageRef.current?.setNamedView("front")}>Front</ClusterButton>
            <ClusterButton size="compact" variant="quiet" onClick={() => stageRef.current?.setNamedView("back")}>Back</ClusterButton>
            <ClusterButton size="compact" variant="quiet" onClick={() => stageRef.current?.setNamedView("left")}>Left</ClusterButton>
            <ClusterButton size="compact" variant="quiet" onClick={() => stageRef.current?.setNamedView("right")}>Right</ClusterButton>
            <ClusterButton size="compact" variant="quiet" onClick={() => stageRef.current?.setNamedView("isometric")}>Iso</ClusterButton>
          </div>
          <ViewerOverlayLayer visibleIds={visibleOverlayIds} placements={overlayPlacements} values={overlayValues} />
        </div>
        <div className="cluster-three-controls">
          <div className="cluster-three-control-group">
            <ClusterButton size="compact" variant="quiet" onClick={() => stageRef.current?.fit()}><ClusterIcon name="home" />Fit</ClusterButton>
            <ClusterNativeSelect aria-label="Projection" value={projection} onChange={(event) => setProjection(event.target.value as ProjectionMode)}><option value="perspective">Perspective</option><option value="orthographic">Orthographic</option></ClusterNativeSelect>
            <ClusterNativeSelect aria-label="Lighting / environment" value={lighting} onChange={(event) => setLighting(event.target.value as LightingMode)}><option value="studio">Studio light</option><option value="neutral">Neutral light</option><option value="inspection">Inspection light</option></ClusterNativeSelect>
            <ClusterButton size="compact" variant="quiet" selected={wireframe} onClick={() => setWireframe((value) => !value)}>Wireframe</ClusterButton>
          </div>
          <div className="cluster-three-control-group technical">
            <ClusterButton size="compact" variant="quiet" selected={grid} onClick={() => setGrid((value) => !value)}>Grid</ClusterButton>
            <ClusterButton size="compact" variant="quiet" selected={axes} onClick={() => setAxes((value) => !value)}>Axes</ClusterButton>
            <ClusterButton size="compact" variant="quiet" selected={bounds} onClick={() => setBounds((value) => !value)}>Bounds</ClusterButton>
            {stats.skins ? <ClusterButton size="compact" variant="quiet" selected={skeleton} onClick={() => setSkeleton((value) => !value)}>Skeleton</ClusterButton> : null}
            <ClusterButton size="compact" variant="quiet" selected={showObjectNames} onClick={() => setShowObjectNames((value) => !value)}>Names</ClusterButton>
          </div>
          {hierarchy.length ? <details className="cluster-three-hierarchy-tools">
            <summary>Hierarchy <span>{hierarchy.length >= MAX_HIERARCHY_ROWS ? `${MAX_HIERARCHY_ROWS}+` : hierarchy.length} nodes</span></summary>
            <div className="cluster-three-hierarchy-actions"><ClusterButton size="compact" variant="quiet" onClick={() => stageRef.current?.showAllObjects()}>Show all</ClusterButton></div>
            <div className="cluster-three-hierarchy-list">{hierarchy.slice(0, 80).map((node) => <div key={node.id} className="cluster-three-hierarchy-row"><span title={node.id}>{node.name}<small>{node.type}</small></span><ClusterButton size="compact" variant="quiet" selected={node.visible} onClick={() => stageRef.current?.setObjectVisible(node.id, !node.visible)}>{node.visible ? "Visible" : "Hidden"}</ClusterButton></div>)}</div>
          </details> : null}
          {animations.length ? <div className="cluster-three-animation-controls">
            <ClusterIconButton label={animationSnapshot.phase === "playing" ? "Pause animation" : "Play animation"} size="compact" variant="quiet" onClick={() => void animationController.toggle()}><ClusterIcon name={animationSnapshot.phase === "playing" ? "pause" : "play"} /></ClusterIconButton>
            <ClusterNativeSelect aria-label="Model animation" value={activeAnimationId || animations[0]?.id || ""} onChange={(event) => { animationController.pause(); setActiveAnimationId(event.target.value); }}>{animations.map((animation) => <option key={animation.id} value={animation.id}>{animation.label}</option>)}</ClusterNativeSelect>
            <ClusterSlider className="cluster-three-animation-timeline" min="0" max={Math.max(0.001, animationSnapshot.duration)} step="0.001" value={Math.min(animationSnapshot.currentTime, Math.max(0.001, animationSnapshot.duration))} onChange={(event) => animationController.seek(Number(event.target.value))} aria-label="Animation time" />
            <span>{formatTime(animationSnapshot.currentTime)} / {formatTime(animationSnapshot.duration)}</span>
            <ClusterNativeSelect aria-label="Animation playback speed" value={String(animationSnapshot.playbackRate)} onChange={(event) => animationController.setPlaybackRate(Number(event.target.value))}><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></ClusterNativeSelect>
          </div> : null}
          {savedViews.length ? <div className="cluster-three-saved-views"><strong>Saved viewpoints</strong>{savedViews.map((view) => <span key={view.id}><ClusterButton size="compact" variant="quiet" onClick={() => stageRef.current?.restoreCamera(view.camera)}>{view.label}</ClusterButton><ClusterIconButton label={`Delete ${view.label}`} size="compact" variant="quiet" onClick={() => setSavedViews((current) => current.filter((item) => item.id !== view.id))}><ClusterIcon name="close" /></ClusterIconButton></span>)}</div> : null}
        </div>
        {draftLocator && assetSession.session?.capabilities.comment && assetSession.session?.capabilities.annotate ? <form className="cluster-viewer-review-composer cluster-three-review-composer" onSubmit={(event) => { event.preventDefault(); void postAnnotation(); }}>
          <strong>3D review pin</strong>
          <span>Object: {draftLocator.objectId || "surface"} · {draftLocator.worldPosition.map((value) => value.toFixed(3)).join(", ")}</span>
          <ClusterTextArea autoFocus rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Describe what should change at this point…" />
          {postError ? <span className="cluster-viewer-inline-error">{postError}</span> : null}
          <div><ClusterButton type="button" variant="quiet" size="compact" onClick={() => { setDraftLocator(null); setNote(""); setPostError(""); }}>Cancel</ClusterButton><ClusterButton type="submit" variant="primary" size="compact" disabled={posting || !note.trim()}>{posting ? "Posting…" : "Post pin"}</ClusterButton></div>
        </form> : null}
      </div>;
    }}
  />;
});
UnifiedThreeViewer.displayName = "UnifiedThreeViewer";
