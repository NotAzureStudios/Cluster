import type { Settings } from "../features/application/application-models";

export type ClusterUiSoundCue = "primary" | "secondary" | "popup" | "confirm" | "error";

const SOUND_URLS: Record<ClusterUiSoundCue | "notification", string> = {
  primary: "/sounds/button-click-primary.mp3",
  secondary: "/sounds/button-click-secondary.mp3",
  popup: "/sounds/popup.mp3",
  confirm: "/sounds/complete-confirm.mp3",
  error: "/sounds/error.mp3",
  notification: "/sounds/notification.mp3",
};

const DEFAULT_UI_VOLUME = 0.5;
const DEFAULT_NOTIFICATION_VOLUME = 0.7;

let uiEnabled = true;
let uiVolume = DEFAULT_UI_VOLUME;
let notificationEnabled = true;
let notificationVolume = DEFAULT_NOTIFICATION_VOLUME;
let interactionInstalled = false;
const templates = new Map<string, HTMLAudioElement>();

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizedVolume(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return clamp01(numeric > 1 ? numeric / 100 : numeric);
}

function template(url: string) {
  if (typeof Audio === "undefined") return null;
  const existing = templates.get(url);
  if (existing) return existing;
  const audio = new Audio(url);
  audio.preload = "auto";
  templates.set(url, audio);
  return audio;
}

function play(url: string, volume: number) {
  const source = template(url);
  if (!source || volume <= 0) return;
  const audio = source.cloneNode(true) as HTMLAudioElement;
  audio.volume = clamp01(volume);
  audio.currentTime = 0;
  void audio.play().catch(() => undefined);
}

export function configureClusterSounds(settings: Partial<Settings> | null | undefined) {
  uiEnabled = settings?.userUiSoundsEnabled !== false;
  uiVolume = normalizedVolume(settings?.userUiSoundVolume, DEFAULT_UI_VOLUME);
  notificationEnabled = settings?.userNotificationSoundsEnabled !== false;
  notificationVolume = normalizedVolume(settings?.userNotificationSoundVolume, DEFAULT_NOTIFICATION_VOLUME);
}

export function playClusterUiSound(cue: ClusterUiSoundCue) {
  if (!uiEnabled) return;
  play(SOUND_URLS[cue], uiVolume);
}

export function playClusterNotificationSound() {
  if (!notificationEnabled) return;
  play(SOUND_URLS.notification, notificationVolume);
}

export function previewClusterUiSound(volume?: number) {
  play(SOUND_URLS.primary, normalizedVolume(volume, uiVolume));
}

export function previewClusterNotificationSound(volume?: number) {
  play(SOUND_URLS.notification, normalizedVolume(volume, notificationVolume));
}

function targetButton(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("button, [role='button'], summary");
}

export function installClusterUiSoundInteractions() {
  if (interactionInstalled || typeof document === "undefined") return () => undefined;
  interactionInstalled = true;
  const onClick = (event: MouseEvent) => {
    if (!uiEnabled || event.defaultPrevented) return;
    const button = targetButton(event.target);
    if (!button || button.dataset.clusterSound === "none") return;
    if (button.matches(":disabled, [aria-disabled='true']")) return;
    const cue: ClusterUiSoundCue = button.dataset.clusterSound === "primary" || button.classList.contains("primary")
      ? "primary"
      : "secondary";
    playClusterUiSound(cue);
  };
  document.addEventListener("click", onClick, true);
  return () => {
    document.removeEventListener("click", onClick, true);
    interactionInstalled = false;
  };
}
