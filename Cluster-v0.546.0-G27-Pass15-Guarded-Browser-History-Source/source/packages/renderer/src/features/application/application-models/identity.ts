import type { ProjectPermissions, ToolPermissions } from "../../../core/permissions";
import type { ClusterWorkSourceKind, SharedWorkReference } from "@cluster/shared";

export type EntityKind = ClusterWorkSourceKind | "ticket" | "meeting" | "milestone" | "comment" | "notification" | "approval" | "time";

export type EntityLifecycleStatus = "draft" | "active" | "in-review" | "approved" | "needs-update" | "deprecated" | "archived";

export type EntityVisibility = "internal" | "external" | "public" | "private";

export type EntityReference = Omit<SharedWorkReference, "kind" | "id"> & {
  kind: EntityKind;
  id?: string | null;
};

export type NormalizedEntitySummary = {
  kind: EntityKind;
  label: string;
  total: number;
  withProject: number;
  withOwner: number;
  archived: number;
  updated: number;
};

export type User = {
  id: string;
  username: string;
  employeeNumber?: string | null;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  personalAccentColor?: string | null;
  preferences?: Record<string, unknown>;
  pinConfigured?: boolean;
  pinUpdatedAt?: string | null;
  passwordConfigured?: boolean;
  passwordChangedAt?: string | null;
  firstLoginCompletedAt?: string | null;
  discordUserId?: string | null;
  discordUsername?: string | null;
  discordDisplayName?: string | null;
  discordAvatar?: string | null;
  discordLinkedAt?: string | null;
  discordLastVerifiedAt?: string | null;
  discordLinked?: boolean;
  discordLinkRequired?: boolean;
  accountState?: string | null;
  nextAuthStep?: string | null;
  title?: string | null;
  department?: string | null;
  teamName?: string | null;
  legalName?: string | null;
  preferredName?: string | null;
  pronouns?: string | null;
  phoneNumber?: string | null;
  alternatePhoneNumber?: string | null;
  alternateEmails?: string[];
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
  country?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
  managerName?: string | null;
  employmentType?: string | null;
  accountType?: "employee" | "contractor" | "client" | "guest" | string;
  accessExpiresAt?: string | null;
  invitedById?: string | null;
  workLocation?: string | null;
  timezone?: string | null;
  status?: "available" | "busy" | "focus" | "do_not_disturb" | "away" | "offline" | string;
  connectionVisibility?: "visible" | "invisible";
  statusMessage?: string | null;
  skills?: string[];
  expertise?: Array<{ name: string; level: "learning" | "working" | "advanced" | "expert"; years?: number | null; note?: string | null }>;
  workingHours?: Record<string, Array<{ start: string; end: string }> | string | null>;
  customProfileFields?: Record<string, unknown>;
  profileRevision?: number;
  managerUserId?: string | null;
  studioTeams?: Array<{ id: string; name: string; department?: string | null; roleLabel?: string | null; allocationPercent?: number; primaryMembership?: boolean; leadUserId?: string | null }>;
  capacityHours?: number | null;
  minimumHours?: number | null;
  notes?: string | null;
  startDate?: string | null;
  archived?: boolean;
  lastSeenAt?: string | null;
  workspaceRole?: string | null;
  toolPermissions?: ToolPermissions | null;
  projectPermissions?: ProjectPermissions | null;
  isAdmin?: boolean;
  adminSource?: string | null;
  privateProfile?: boolean;
  sensitiveProfileHidden?: boolean;
  profileShowEmail?: boolean;
  profileShowPhone?: boolean;
  profileShowDiscord?: boolean;
  profileShowTimezone?: boolean;
  profileShowStatus?: boolean;
  profileBio?: string;
  profileWebsite?: string;
  profileDiscordUsername?: string;
  profilePreferredContact?: "cluster" | "discord" | "email" | "phone" | string;
  profilePinnedProjectIds?: string[];
  hideLegalName?: boolean;
  hideLocation?: boolean;
  discordAdminConfigured?: boolean;
  discordAdminRoleId?: string | null;
  policyAcceptance?: {
    schemaVersion: number;
    required: boolean;
    complete: boolean;
    digest: string;
    requirements: Array<{ policyId: string; kind: string; version: string; title: string; summary?: string | null; contentHash: string; acceptanceMode: "acknowledge" | "accept"; acceptanceAudience: "all_users" | "admins"; requirementHash: string; publicPath: string; effectiveAt?: string | null; publishedAt?: string | null; accepted: boolean; acceptedAt?: string | null; evidenceHash?: string | null }>;
    pending: Array<{ policyId: string; kind: string; version: string; title: string; summary?: string | null; contentHash: string; acceptanceMode: "acknowledge" | "accept"; acceptanceAudience: "all_users" | "admins"; requirementHash: string; publicPath: string; effectiveAt?: string | null; publishedAt?: string | null; accepted: boolean; acceptedAt?: string | null; evidenceHash?: string | null }>;
  } | null;
};

export type IssuedTemporaryPassword = {
  username: string;
  temporaryPassword: string;
};
