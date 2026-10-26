export const PRIVACY_CONSENT_STORAGE_KEY = "cluster-privacy-consent-v2";
export const PRIVACY_CONSENT_NOTICE_VERSION = "2.0";
export const PRIVACY_CONSENT_CHANGED_EVENT = "cluster:privacy-consent-changed";
export const PRIVACY_CHOICES_OPEN_EVENT = "cluster:open-privacy-choices";

export type PrivacyConsentState = {
  schemaVersion: 2;
  noticeVersion: string;
  decided: boolean;
  preferences: boolean;
  analytics: boolean;
  externalContent: boolean;
  decidedAt: string | null;
};

const DEFAULT_CONSENT: PrivacyConsentState = {
  schemaVersion: 2,
  noticeVersion: PRIVACY_CONSENT_NOTICE_VERSION,
  decided: false,
  preferences: false,
  analytics: false,
  externalContent: false,
  decidedAt: null,
};

const OPTIONAL_PREFERENCE_PATTERNS = [
  /^cluster-theme-mode$/,
  /^cluster\.sidebar\.collapsed$/,
  /^cluster-media-/,
  /^cluster-search-usage-/,
  /^cluster-whiteboard-autosave$/,
];

export function readPrivacyConsent(): PrivacyConsentState {
  if (typeof window === "undefined") return DEFAULT_CONSENT;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PRIVACY_CONSENT_STORAGE_KEY) || "null") as Partial<PrivacyConsentState> | null;
    if (!parsed || parsed.schemaVersion !== 2 || parsed.noticeVersion !== PRIVACY_CONSENT_NOTICE_VERSION || parsed.decided !== true) return DEFAULT_CONSENT;
    return {
      schemaVersion: 2,
      noticeVersion: PRIVACY_CONSENT_NOTICE_VERSION,
      decided: true,
      preferences: parsed.preferences === true,
      analytics: parsed.analytics === true,
      externalContent: parsed.externalContent === true,
      decidedAt: typeof parsed.decidedAt === "string" ? parsed.decidedAt : null,
    };
  } catch {
    return DEFAULT_CONSENT;
  }
}

export function writePrivacyConsent(input: Pick<PrivacyConsentState, "preferences" | "analytics" | "externalContent"> & { decidedAt?: string | null }) {
  const state: PrivacyConsentState = {
    schemaVersion: 2,
    noticeVersion: PRIVACY_CONSENT_NOTICE_VERSION,
    decided: true,
    preferences: input.preferences === true,
    analytics: input.analytics === true,
    externalContent: input.externalContent === true,
    decidedAt: input.decidedAt || new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PRIVACY_CONSENT_STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(PRIVACY_CONSENT_CHANGED_EVENT, { detail: state }));
  }
  return state;
}

export function preferenceStorageAllowed() { return readPrivacyConsent().preferences; }
export function analyticsAllowed() { return readPrivacyConsent().analytics; }
export function externalContentAllowed() { return readPrivacyConsent().externalContent; }

export function readPreferenceStorage(key: string) {
  if (typeof window === "undefined" || !preferenceStorageAllowed()) return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}
export function writePreferenceStorage(key: string, value: string) {
  if (typeof window === "undefined" || !preferenceStorageAllowed()) return false;
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}
export function removePreferenceStorage(key: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(key); } catch {}
}
export function clearOptionalPreferenceStorage() {
  if (typeof window === "undefined") return;
  const keys: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && OPTIONAL_PREFERENCE_PATTERNS.some((pattern) => pattern.test(key))) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {}
}
export function openPrivacyChoices() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PRIVACY_CHOICES_OPEN_EVENT));
}
