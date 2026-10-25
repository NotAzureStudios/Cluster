import { z } from "zod";

export const DELIVERY_BUILD_CHANNELS = ["nightly", "internal", "alpha", "beta", "rc", "release"] as const;
export const DELIVERY_BUILD_QA_STATUSES = ["untested", "testing", "passed", "failed"] as const;
export const DELIVERY_BUILD_APPROVALS = ["draft", "pending", "approved", "blocked"] as const;
export const DELIVERY_QA_STATUSES = ["planned", "running", "passed", "failed", "blocked"] as const;
export const DELIVERY_QA_SCOPES = ["smoke", "regression", "compatibility", "certification", "playtest"] as const;
export const DELIVERY_QA_DECISIONS = ["pending", "go", "conditional", "no-go"] as const;
export const DELIVERY_QA_PLAN_STATUSES = ["draft", "ready", "running", "passed", "failed", "blocked"] as const;
export const DELIVERY_TEST_CASE_STATUSES = ["not-run", "passed", "failed", "blocked", "skipped"] as const;
export const DELIVERY_RELEASE_STATUSES = ["draft", "review", "published"] as const;
export const DELIVERY_RECORD_KINDS = ["build", "qa-plan", "qa-session", "release"] as const;

export type DeliveryRecordKind = (typeof DELIVERY_RECORD_KINDS)[number];
export type DeliveryBuildChannel = (typeof DELIVERY_BUILD_CHANNELS)[number];
export type DeliveryBuildQaStatus = (typeof DELIVERY_BUILD_QA_STATUSES)[number];
export type DeliveryBuildApproval = (typeof DELIVERY_BUILD_APPROVALS)[number];
export type DeliveryQaStatus = (typeof DELIVERY_QA_STATUSES)[number];
export type DeliveryQaScope = (typeof DELIVERY_QA_SCOPES)[number];
export type DeliveryQaDecision = (typeof DELIVERY_QA_DECISIONS)[number];
export type DeliveryQaPlanStatus = (typeof DELIVERY_QA_PLAN_STATUSES)[number];
export type DeliveryTestCaseStatus = (typeof DELIVERY_TEST_CASE_STATUSES)[number];
export type DeliveryReleaseStatus = (typeof DELIVERY_RELEASE_STATUSES)[number];

export type DeliveryChangeSummary = {
  previousBuildId?: string | null;
  previousVersion?: string | null;
  fromRevision?: string | null;
  toRevision: string;
  commitCount: number;
  additions: number;
  deletions: number;
  filesChanged: number;
  commits: Array<{
    id: string;
    revision: string;
    shortRevision: string;
    message: string;
    authorName?: string | null;
    committedAt?: string | null;
    additions?: number | null;
    deletions?: number | null;
    filesChanged?: number | null;
  }>;
};

export type DeliverySourceProvenance = {
  repositoryId: string;
  repositoryName: string;
  repositorySlug?: string | null;
  branch: string;
  revision: string;
  shortRevision: string;
  commitId: string;
  commitMessage: string;
  commitUrl?: string | null;
  reviewId?: string | null;
  reviewTitle?: string | null;
  reviewStatus?: string | null;
  reviewSourceBranch?: string | null;
  reviewTargetBranch?: string | null;
  capturedAt: string;
};

export type DeliveryBuildRecord = {
  id: string;
  projectId: string;
  title: string;
  version: string;
  lane: string;
  platform: string;
  sourceRepositoryId: string;
  sourceCommitId: string;
  sourceReviewId?: string | null;
  sourceBranch: string;
  sourceRevision: string;
  provenance: DeliverySourceProvenance;
  previousBuildId?: string | null;
  changes: DeliveryChangeSummary;
  artifactUrl: string;
  changelog: string;
  qaStatus: DeliveryBuildQaStatus;
  approval: DeliveryBuildApproval;
  channel?: DeliveryBuildChannel;
  buildNumber?: string;
  createdBy?: string;
  createdById?: string | null;
  ownerId?: string | null;
  reviewerIds?: string[];
  fileSize?: string;
  checksum?: string;
  signed?: boolean;
  pinned?: boolean;
  promotedAt?: string | null;
  testedPlatforms?: string[];
  expiresAt?: string | null;
  platformKey?: string;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type DeliveryTestCase = {
  id: string;
  title: string;
  expected: string;
  status: DeliveryTestCaseStatus;
  notes?: string;
  assignee?: string;
  assigneeId?: string | null;
  priority?: "low" | "medium" | "high" | "urgent";
  preconditions?: string;
  steps?: string[];
  evidenceUrls?: string[];
  updatedAt?: string;
};



export type DeliveryQaPlanRecord = {
  id: string;
  projectId: string;
  title: string;
  buildId: string;
  platform: string;
  configuration?: string;
  suite?: string;
  environment?: string;
  dueDate?: string | null;
  template: string;
  owner: string;
  ownerId?: string | null;
  testerIds?: string[];
  status: DeliveryQaPlanStatus;
  cases: DeliveryTestCase[];
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type DeliveryQaSessionRecord = {
  id: string;
  projectId: string;
  buildId: string;
  planId?: string | null;
  retestOfSessionId?: string | null;
  regressionBaseBuildId?: string | null;
  build: string;
  platform: string;
  configuration?: string;
  suite?: string;
  environment: string;
  scope: DeliveryQaScope;
  owner: string;
  ownerId?: string | null;
  testerIds?: string[];
  status: DeliveryQaStatus;
  decision: DeliveryQaDecision;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  notes: string;
  startedAt: string;
  completedAt?: string | null;
  signedOffBy?: string | null;
  signedOffById?: string | null;
  signedOffAt?: string | null;
  sourceRevision: string;
  sourceRepositoryId: string;
  sourceReviewId?: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type DeliveryReleaseRecord = {
  id: string;
  projectId: string;
  title: string;
  buildId: string;
  buildVersion: string;
  platform: string;
  qaStatus: string;
  features: string[];
  fixes: string[];
  knownIssues: string[];
  body: string;
  status: DeliveryReleaseStatus;
  publishedAt?: string | null;
  sourceRevision: string;
  sourceRepositoryId: string;
  sourceReviewId?: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export const deliveryRecordKindSchema = z.enum(DELIVERY_RECORD_KINDS);

const nonEmptyId = z.string().trim().min(1).max(240);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const deliveryBuildInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  version: z.string().trim().min(1).max(120),
  lane: z.string().trim().min(1).max(80),
  platform: z.string().trim().min(1).max(120),
  sourceRepositoryId: nonEmptyId,
  sourceRevision: z.string().trim().min(4).max(200),
  sourceBranch: z.string().trim().min(1).max(200),
  sourceReviewId: optionalText(240),
  artifactUrl: z.string().trim().max(4000).default(""),
  changelog: z.string().max(40_000).default(""),
  channel: z.enum(DELIVERY_BUILD_CHANNELS).default("internal"),
  buildNumber: z.string().trim().max(160).optional().default(""),
  createdBy: z.string().trim().max(200).optional().default(""),
  ownerId: optionalText(240),
  reviewerIds: z.array(nonEmptyId).max(64).default([]),
  fileSize: z.string().trim().max(120).optional().default(""),
  checksum: z.string().trim().max(512).optional().default(""),
  signed: z.boolean().default(false),
  pinned: z.boolean().default(false),
  promotedAt: z.string().datetime().optional().nullable(),
  testedPlatforms: z.array(z.string().trim().min(1).max(120)).max(64).default([]),
  expiresAt: z.string().datetime().optional().nullable(),
  platformKey: z.string().trim().max(120).optional().default(""),
  metadata: z.record(z.string(), z.string()).default({}),
});

export const deliveryBuildPatchSchema = deliveryBuildInputSchema.partial().omit({ sourceRepositoryId: true, sourceRevision: true, sourceBranch: true, sourceReviewId: true }).extend({
  approval: z.enum(DELIVERY_BUILD_APPROVALS).optional(),
});

export const deliveryExecutorBuildInputSchema = z.object({
  externalId: nonEmptyId,
  title: z.string().trim().min(1).max(500),
  version: z.string().trim().min(1).max(120),
  lane: z.string().trim().min(1).max(80).default("ci"),
  platform: z.string().trim().min(1).max(120),
  sourceRepositoryId: nonEmptyId,
  sourceRevision: z.string().trim().min(4).max(200),
  sourceBranch: z.string().trim().min(1).max(200),
  sourceReviewId: optionalText(240),
  artifactUrl: z.string().trim().url().max(4000).optional().default(""),
  changelog: z.string().max(40_000).optional().default(""),
  channel: z.enum(DELIVERY_BUILD_CHANNELS).optional().default("internal"),
  buildNumber: z.string().trim().max(160).optional().default(""),
  fileSize: z.string().trim().max(120).optional().default(""),
  checksum: z.string().trim().max(512).optional().default(""),
  signed: z.boolean().optional().default(false),
  testedPlatforms: z.array(z.string().trim().min(1).max(120)).max(64).optional().default([]),
  expiresAt: z.string().datetime().optional().nullable(),
  platformKey: z.string().trim().max(120).optional().default(""),
  metadata: z.record(z.string(), z.string()).optional().default({}),
});

export type DeliveryExecutorBuildInput = z.infer<typeof deliveryExecutorBuildInputSchema>;

export const deliveryQaPlanInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  buildId: nonEmptyId,
  platform: z.string().trim().min(1).max(120),
  configuration: z.string().trim().max(160).optional().default("default"),
  suite: z.string().trim().max(160).optional().default("general"),
  environment: z.string().trim().max(200).optional().default(""),
  dueDate: z.string().datetime().optional().nullable(),
  template: z.string().trim().max(200).default("custom"),
  owner: z.string().trim().max(200).default(""),
  ownerId: optionalText(240),
  testerIds: z.array(nonEmptyId).max(64).default([]),
  status: z.enum(DELIVERY_QA_PLAN_STATUSES).default("draft"),
  cases: z.array(z.record(z.string(), z.unknown())).max(1000).default([]),
});

export const deliveryQaSessionInputSchema = z.object({
  buildId: nonEmptyId,
  planId: optionalText(240),
  retestOfSessionId: optionalText(240),
  regressionBaseBuildId: optionalText(240),
  platform: z.string().trim().max(120).optional().default(""),
  configuration: z.string().trim().max(160).optional().default("default"),
  suite: z.string().trim().max(160).optional().default("general"),
  environment: z.string().trim().min(1).max(200),
  scope: z.enum(DELIVERY_QA_SCOPES),
  owner: z.string().trim().max(200).default(""),
  ownerId: optionalText(240),
  testerIds: z.array(nonEmptyId).max(64).default([]),
  status: z.enum(DELIVERY_QA_STATUSES).default("planned"),
  decision: z.enum(DELIVERY_QA_DECISIONS).default("pending"),
  passed: z.number().int().min(0).max(1_000_000).default(0),
  failed: z.number().int().min(0).max(1_000_000).default(0),
  blocked: z.number().int().min(0).max(1_000_000).default(0),
  skipped: z.number().int().min(0).max(1_000_000).default(0),
  notes: z.string().max(80_000).default(""),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional().nullable(),
  signedOffBy: optionalText(200),
  signedOffById: optionalText(240),
  signedOffAt: z.string().datetime().optional().nullable(),
});

export const deliveryReleaseInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  buildId: nonEmptyId,
  features: z.array(z.string().trim().min(1).max(2000)).max(200).default([]),
  fixes: z.array(z.string().trim().min(1).max(2000)).max(200).default([]),
  knownIssues: z.array(z.string().trim().min(1).max(2000)).max(200).default([]),
  body: z.string().max(120_000).default(""),
  status: z.enum(DELIVERY_RELEASE_STATUSES).default("draft"),
});
