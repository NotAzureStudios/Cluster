export const CLUSTER_PERSON_PRESENCE_STATES = ["available", "focus", "away", "recent", "offline"] as const;
export type ClusterPersonPresenceState = (typeof CLUSTER_PERSON_PRESENCE_STATES)[number];

export const CLUSTER_PERSON_AVAILABILITY_STATES = ["available", "focus", "away", "limited", "unavailable"] as const;
export type ClusterPersonAvailabilityState = (typeof CLUSTER_PERSON_AVAILABILITY_STATES)[number];

export type ClusterPersonSummary = {
  id: string;
  username: string;
  displayName?: string | null;
  preferredName?: string | null;
  avatarUrl?: string | null;
  personalAccentColor?: string | null;
  title?: string | null;
  department?: string | null;
  teamName?: string | null;
  accountType?: string | null;
  archived?: boolean;
  status?: string | null;
  statusMessage?: string | null;
  lastSeenAt?: string | null;
  lastActivityAt?: string | null;
  timezone?: string | null;
  workLocation?: string | null;
  capacityHours?: number | null;
  minimumHours?: number | null;
  workingHours?: ClusterWorkingHours;
  email?: string | null;
  phoneNumber?: string | null;
  discordUsername?: string | null;
  profileDiscordUsername?: string | null;
  profilePreferredContact?: string | null;
  privateProfile?: boolean;
  sensitiveProfileHidden?: boolean;
};

export type ClusterPersonStatusSummary = {
  presence: ClusterPersonPresenceState;
  presenceLabel: string;
  availability: ClusterPersonAvailabilityState;
  availabilityLabel: string;
  localTimeLabel: string | null;
  capacityLabel: string;
};

export const CLUSTER_PERSON_CHANGED_EVENT = "cluster:person-changed";


export const CLUSTER_EXPERTISE_LEVELS = ["learning", "working", "advanced", "expert"] as const;
export type ClusterExpertiseLevel = (typeof CLUSTER_EXPERTISE_LEVELS)[number];
export type ClusterPersonExpertise = {
  name: string;
  level: ClusterExpertiseLevel;
  years?: number | null;
  note?: string | null;
};
export type ClusterWorkingHoursDay = { start: string; end: string };
export type ClusterWorkingHours = {
  timezone?: string | null;
  monday?: ClusterWorkingHoursDay[];
  tuesday?: ClusterWorkingHoursDay[];
  wednesday?: ClusterWorkingHoursDay[];
  thursday?: ClusterWorkingHoursDay[];
  friday?: ClusterWorkingHoursDay[];
  saturday?: ClusterWorkingHoursDay[];
  sunday?: ClusterWorkingHoursDay[];
};
export type ClusterStudioTeamSummary = {
  id: string; name: string; description?: string | null; department?: string | null; leadUserId?: string | null; color?: string | null; archived?: boolean; revision?: number;
  members?: Array<{ userId: string; roleLabel?: string | null; allocationPercent: number; primaryMembership: boolean }>;
};
export const CLUSTER_PROFILE_FIELD_TYPES = ["text", "number", "select", "multi_select", "url", "date"] as const;
export type ClusterProfileFieldType = (typeof CLUSTER_PROFILE_FIELD_TYPES)[number];
export const CLUSTER_PROFILE_FIELD_VISIBILITIES = ["studio", "managers", "private"] as const;
export type ClusterProfileFieldVisibility = (typeof CLUSTER_PROFILE_FIELD_VISIBILITIES)[number];
export type ClusterProfileFieldDefinition = {
  id: string; label: string; type: ClusterProfileFieldType; required?: boolean; visibility?: ClusterProfileFieldVisibility; options?: string[];
};
