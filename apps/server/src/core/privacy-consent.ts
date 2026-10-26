import { publicAnalyticsProviders } from "./behavioral-analytics.js";

export const PRIVACY_CONSENT_SCHEMA_VERSION = 2;
export const PRIVACY_CONSENT_NOTICE_VERSION = "2.0";

export type PrivacyConsentChoice = {
  preferences: boolean;
  analytics: boolean;
  externalContent: boolean;
};

export const PRIVACY_CONSENT_INVENTORY = {
  schemaVersion: PRIVACY_CONSENT_SCHEMA_VERSION,
  noticeVersion: PRIVACY_CONSENT_NOTICE_VERSION,
  categories: [
    {
      id: "necessary",
      label: "Strictly necessary",
      required: true,
      available: true,
      description: "Authentication, security, offline synchronization, recovery drafts, navigation handoff, and consent storage required to operate Cluster.",
    },
    {
      id: "preferences",
      label: "Preferences",
      required: false,
      available: true,
      description: "Remembers interface choices such as theme, sidebar state, media controls, whiteboard autosave preference, and local search personalization.",
    },
    {
      id: "analytics",
      label: "Analytics",
      required: false,
      available: false,
      description: "Optional, coarse first-party usage analytics. Availability depends on an administrator-reviewed provider configuration and collection remains off until you consent.",
    },
    {
      id: "externalContent",
      label: "External content",
      required: false,
      available: true,
      description: "Allows embedded content from external providers. Cluster currently uses this category for YouTube privacy-enhanced embeds.",
    },
  ],
  storage: {
    cookies: [
      { names: ["cluster_session", "__Host-cluster_session"], category: "necessary", purpose: "Authenticated Cluster session. HttpOnly, SameSite=Strict, and Secure on TLS deployments.", duration: "Configured server session lifetime" },
    ],
    localStorage: [
      { pattern: "cluster-privacy-consent-v2", category: "necessary", purpose: "Stores this browser's current privacy choices." },
      { pattern: "cluster-offline-*", category: "necessary", purpose: "Offline queue/cache fallback when IndexedDB is unavailable." },
      { pattern: "cluster-sync-device-id:*", category: "necessary", purpose: "Account-scoped synchronization device identity." },
      { pattern: "cluster-whiteboard-recovery-*", category: "necessary", purpose: "Local whiteboard crash-recovery drafts." },
      { pattern: "cluster-theme-mode", category: "preferences", purpose: "Theme preference." },
      { pattern: "cluster.sidebar.collapsed", category: "preferences", purpose: "Sidebar layout preference." },
      { pattern: "cluster-media-*", category: "preferences", purpose: "Media playback preferences." },
      { pattern: "cluster-search-usage-*", category: "preferences", purpose: "Local search ranking personalization." },
      { pattern: "cluster-whiteboard-autosave", category: "preferences", purpose: "Whiteboard autosave preference." },
    ],
    sessionStorage: [
      { pattern: "cluster-*handoff*", category: "necessary", purpose: "Short-lived navigation handoff state within the current browser tab." },
      { pattern: "cluster-*scroll*", category: "necessary", purpose: "Short-lived workspace navigation/scroll restoration." },
    ],
    indexedDb: [
      { name: "Cluster offline database", category: "necessary", purpose: "Pending mutations/uploads and authorized offline cache used by Cluster offline synchronization." },
    ],
  },
  externalProviders: [
    { id: "youtube", category: "externalContent", host: "www.youtube-nocookie.com", purpose: "Privacy-enhanced YouTube video and playlist embeds. Not loaded until external-content consent is granted." },
  ],
  analyticsProviders: [],
} as const;

export async function privacyConsentInventory(prisma: any) {
  const analyticsProviders = await publicAnalyticsProviders(prisma);
  const categories = PRIVACY_CONSENT_INVENTORY.categories.map((category) => category.id === "analytics" ? {
    ...category,
    available: analyticsProviders.length > 0,
    description: analyticsProviders.length > 0
      ? "Optional, coarse first-party usage analytics for this self-hosted Cluster server. No analytics event is stored until you consent, and you can revoke this choice later."
      : category.description,
  } : category);
  return { ...PRIVACY_CONSENT_INVENTORY, categories, analyticsProviders };
}

export function normalizePrivacyConsentChoice(input: Partial<PrivacyConsentChoice> = {}, options: { analyticsAvailable?: boolean } = {}): PrivacyConsentChoice {
  return {
    preferences: input.preferences === true,
    analytics: options.analyticsAvailable === true && input.analytics === true,
    externalContent: input.externalContent === true,
  };
}

export function serializePrivacyConsent(record: any) {
  if (!record) return null;
  return {
    schemaVersion: Number(record.schemaVersion || PRIVACY_CONSENT_SCHEMA_VERSION),
    noticeVersion: String(record.noticeVersion || PRIVACY_CONSENT_NOTICE_VERSION),
    preferences: record.preferences === true,
    analytics: record.analytics === true,
    externalContent: record.externalContent === true,
    source: String(record.source || "web"),
    decidedAt: record.decidedAt instanceof Date ? record.decidedAt.toISOString() : new Date(record.decidedAt).toISOString(),
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : new Date(record.updatedAt).toISOString(),
  };
}
