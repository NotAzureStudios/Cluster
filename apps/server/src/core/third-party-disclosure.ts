import { z } from "zod";

export const THIRD_PARTY_DISCLOSURE_SCHEMA_VERSION = 1;
export const THIRD_PARTY_RECIPIENT_ROLES = ["unclassified", "processor", "service_provider", "contractor", "third_party", "independent_controller", "other"] as const;
export const THIRD_PARTY_CATEGORIES = ["identity", "communication", "external_content", "source_control", "hosting", "analytics", "support", "other"] as const;

const httpUrl = z.string().trim().url().refine((value) => new URL(value).protocol === "https:", "Use an HTTPS URL.");

export const thirdPartyDisclosureInputSchema = z.object({
  sourceKey: z.string().trim().min(1).max(120).nullable().optional(),
  name: z.string().trim().min(1).max(160),
  category: z.enum(THIRD_PARTY_CATEGORIES),
  purpose: z.string().trim().min(1).max(2000),
  dataCategories: z.array(z.string().trim().min(1).max(160)).max(40).default([]),
  recipientRole: z.enum(THIRD_PARTY_RECIPIENT_ROLES).default("unclassified"),
  feature: z.string().trim().max(240).nullable().optional(),
  consentCategory: z.enum(["necessary", "preferences", "analytics", "externalContent"]).nullable().optional(),
  privacyUrl: httpUrl.nullable().optional(),
  termsUrl: httpUrl.nullable().optional(),
  regions: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
  retentionNote: z.string().trim().max(1200).nullable().optional(),
  transferNote: z.string().trim().max(1200).nullable().optional(),
  operatorNote: z.string().trim().max(2000).nullable().optional(),
  required: z.boolean().default(false),
  status: z.enum(["active", "archived"]).default("active"),
  publicVisible: z.boolean().default(false),
  reviewed: z.boolean().default(false),
});

export type ThirdPartyCandidate = {
  sourceKey: string;
  name: string;
  category: (typeof THIRD_PARTY_CATEGORIES)[number];
  purpose: string;
  dataCategories: string[];
  feature: string;
  consentCategory: "necessary" | "externalContent" | null;
  required: boolean;
  detected: boolean;
  detectionReason: string;
};

function configured(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return Boolean(String(value || "").trim());
}

export function detectThirdPartyCandidates(settings: Record<string, unknown> = {}): ThirdPartyCandidate[] {
  const youtubeEnabled = settings.libraryAllowYoutube !== false || settings.packetsAllowYoutube !== false;
  const discordIdentity = settings.requireDiscordLink === true;
  const discordMessaging = configured(settings.discordWebhookUrl) || configured(settings.discordBotToken) || configured(settings.discordWebhookUrlConfigured) || configured(settings.discordBotTokenConfigured);
  const sourceControl = configured(settings.sourceControlConfigured);
  return [
    {
      sourceKey: "builtin.youtube-embed",
      name: "YouTube",
      category: "external_content",
      purpose: "Render privacy-enhanced YouTube video or playlist embeds after the user enables external-content consent.",
      dataCategories: ["IP address and network metadata", "browser/device metadata", "embedded-content interaction data"],
      feature: "Library and Packets YouTube embeds",
      consentCategory: "externalContent",
      required: false,
      detected: youtubeEnabled,
      detectionReason: youtubeEnabled ? "YouTube embeds are allowed by at least one studio content surface." : "YouTube embeds are disabled in studio content settings.",
    },
    {
      sourceKey: "builtin.discord-identity",
      name: "Discord",
      category: "identity",
      purpose: "Link a Cluster account to a Discord identity when the studio requires Discord account linking.",
      dataCategories: ["Discord user identifier", "Discord username/display name", "Discord avatar metadata", "account-link timestamps"],
      feature: "Discord identity linking",
      consentCategory: "necessary",
      required: discordIdentity,
      detected: discordIdentity,
      detectionReason: discordIdentity ? "Studio configuration requires Discord account linking." : "Discord account linking is not required by the current studio configuration.",
    },
    {
      sourceKey: "builtin.discord-messaging",
      name: "Discord",
      category: "communication",
      purpose: "Send studio-selected notifications or integration messages to Discord through a configured webhook or bot.",
      dataCategories: ["notification/message content", "project/work-item identifiers included in messages", "user display names when included by the configured notification"],
      feature: "Discord notifications and messaging",
      consentCategory: null,
      required: false,
      detected: discordMessaging,
      detectionReason: discordMessaging ? "A Discord webhook or bot credential is configured." : "No Discord messaging credential is currently configured.",
    },
    {
      sourceKey: "builtin.source-control",
      name: "Source Control provider",
      category: "source_control",
      purpose: "Synchronize repository, commit, review, and linked issue information through configured Source Control connections.",
      dataCategories: ["repository metadata", "issue and work-item content selected for synchronization", "usernames or assignee identifiers present in synchronized repository data"],
      feature: "Source Control integration",
      consentCategory: null,
      required: false,
      detected: sourceControl,
      detectionReason: sourceControl ? "At least one Source Control connection is configured." : "No Source Control connection is currently configured.",
    },
  ];
}

function jsonList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value.trim()) return [];
  try { return jsonList(JSON.parse(value)); } catch { return []; }
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function serializeThirdPartyDisclosure(record: any) {
  return {
    id: String(record.id),
    name: String(record.name),
    category: String(record.category),
    purpose: String(record.purpose),
    dataCategories: jsonList(record.dataCategoriesJson),
    recipientRole: String(record.recipientRole || "unclassified"),
    feature: record.feature || null,
    consentCategory: record.consentCategory || null,
    privacyUrl: record.privacyUrl || null,
    termsUrl: record.termsUrl || null,
    regions: jsonList(record.regionsJson),
    retentionNote: record.retentionNote || null,
    transferNote: record.transferNote || null,
    required: record.required === true,
    reviewedAt: iso(record.reviewedAt),
    updatedAt: iso(record.updatedAt),
  };
}

export function serializeThirdPartyDisclosureAdmin(record: any) {
  return {
    ...serializeThirdPartyDisclosure(record),
    sourceKey: record.sourceKey || null,
    status: record.status || "active",
    publicVisible: record.publicVisible === true,
    reviewed: Boolean(record.reviewedAt),
    reviewedById: record.reviewedById || null,
    createdById: record.createdById || null,
    operatorNote: record.operatorNote || null,
    createdAt: iso(record.createdAt),
  };
}

export function disclosureRecordData(input: z.infer<typeof thirdPartyDisclosureInputSchema>) {
  return {
    sourceKey: input.sourceKey || null,
    name: input.name,
    category: input.category,
    purpose: input.purpose,
    dataCategoriesJson: JSON.stringify(input.dataCategories),
    recipientRole: input.recipientRole,
    feature: input.feature || null,
    consentCategory: input.consentCategory || null,
    privacyUrl: input.privacyUrl || null,
    termsUrl: input.termsUrl || null,
    regionsJson: JSON.stringify(input.regions),
    retentionNote: input.retentionNote || null,
    transferNote: input.transferNote || null,
    operatorNote: input.operatorNote || null,
    required: input.required,
    status: input.status,
    publicVisible: input.publicVisible,
  };
}
