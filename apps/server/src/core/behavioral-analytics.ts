import { z } from "zod";

export const BEHAVIORAL_ANALYTICS_SCHEMA_VERSION = 1;
export const BUILTIN_ANALYTICS_PROVIDER_ID = "builtin-cluster-first-party";
export const ANALYTICS_EVENT_NAMES = ["app_open", "screen_view"] as const;
export const ANALYTICS_SURFACES = [
  "dashboard", "myRecords", "people", "mywork", "inbox", "projects", "project", "board", "whiteboard",
  "calendar", "timeline", "builds", "qa", "tickets", "activity", "scheduler", "library", "packets", "admin",
  "toolInfrastructure", "integrations", "desktop", "settings", "studioSettings", "serverConfig", "changelog",
] as const;

export const analyticsEventInputSchema = z.object({
  eventName: z.enum(ANALYTICS_EVENT_NAMES),
  surface: z.enum(ANALYTICS_SURFACES),
  client: z.enum(["web", "desktop"]),
  occurredAt: z.string().datetime().optional(),
});

export const analyticsProviderUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  purpose: z.string().trim().min(1).max(1200).optional(),
  collectScreenViews: z.boolean().optional(),
  collectFeatureActions: z.boolean().optional(),
  enabled: z.boolean().optional(),
  reviewed: z.boolean().optional(),
});

const DEFAULT_PROVIDER = {
  id: BUILTIN_ANALYTICS_PROVIDER_ID,
  name: "Cluster first-party usage analytics",
  adapter: "cluster_first_party",
  purpose: "Measure coarse application usage and screen adoption on this self-hosted Cluster server without sending behavioral analytics to an external provider.",
  dataCategoriesJson: JSON.stringify(["coarse screen identifier", "event type", "web or desktop client type", "event timestamp"]),
  enabled: false,
  collectScreenViews: true,
  collectFeatureActions: false,
};

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

export async function readBuiltinAnalyticsProvider(prisma: any) {
  const record = await prisma.behavioralAnalyticsProvider.findUnique({ where: { id: BUILTIN_ANALYTICS_PROVIDER_ID } });
  return record || { ...DEFAULT_PROVIDER, reviewedAt: null, reviewedById: null, createdAt: null, updatedAt: null };
}

export async function ensureBuiltinAnalyticsProvider(prisma: any) {
  return prisma.behavioralAnalyticsProvider.upsert({
    where: { id: BUILTIN_ANALYTICS_PROVIDER_ID },
    create: DEFAULT_PROVIDER,
    update: {},
  });
}

export function serializeAnalyticsProvider(record: any, retentionDays = 90) {
  return {
    id: String(record.id),
    name: String(record.name),
    adapter: String(record.adapter || "cluster_first_party"),
    purpose: String(record.purpose || ""),
    dataCategories: jsonList(record.dataCategoriesJson),
    enabled: record.enabled === true && Boolean(record.reviewedAt),
    configuredEnabled: record.enabled === true,
    collectScreenViews: record.collectScreenViews !== false,
    collectFeatureActions: record.collectFeatureActions === true,
    reviewed: Boolean(record.reviewedAt),
    reviewedAt: iso(record.reviewedAt),
    reviewedById: record.reviewedById || null,
    retentionDays,
    firstParty: true,
    externalRecipient: false,
    updatedAt: iso(record.updatedAt),
  };
}

export async function readAnalyticsRetentionDays(prisma: any) {
  const row = await prisma.dataRetentionPolicy.findUnique({ where: { category: "behavioral_analytics" } }).catch(() => null);
  const days = Number(row?.retentionDays || 90);
  return Number.isInteger(days) && days >= 7 && days <= 365 ? days : 90;
}

export async function publicAnalyticsProviders(prisma: any) {
  const [provider, retentionDays] = await Promise.all([readBuiltinAnalyticsProvider(prisma), readAnalyticsRetentionDays(prisma)]);
  const serialized = serializeAnalyticsProvider(provider, retentionDays);
  return serialized.enabled ? [serialized] : [];
}

export function analyticsProviderMaterialChanged(existing: any, input: z.infer<typeof analyticsProviderUpdateSchema>) {
  return (
    (input.name !== undefined && input.name !== existing.name) ||
    (input.purpose !== undefined && input.purpose !== existing.purpose) ||
    (input.collectScreenViews !== undefined && input.collectScreenViews !== existing.collectScreenViews) ||
    (input.collectFeatureActions !== undefined && input.collectFeatureActions !== existing.collectFeatureActions)
  );
}
