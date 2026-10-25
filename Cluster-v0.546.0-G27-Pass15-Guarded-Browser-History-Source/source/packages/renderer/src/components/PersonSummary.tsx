import type { ClusterPersonSummary } from "@cluster/shared";
import { openClusterWorkNavigation } from "../features/workflow/work-navigation";
import { personDisplayName, personInitial, personMetaLabel, personStatusSummary } from "../features/people/person-summary";
import { PresenceAvatar } from "./PresenceAvatar";
import "./person-summary.css";
import { ClusterButton } from "./ClusterButton";
import { ClusterCopyButton } from "./ClusterCopyButton";

export function PersonSummary({
  person,
  compact = false,
  showLocalTime = true,
  showCapacity = false,
  profileAction = true,
  avatarProfilePeek = true,
  contactActions = false,
  className = "",
}: {
  person: ClusterPersonSummary;
  compact?: boolean;
  showLocalTime?: boolean;
  showCapacity?: boolean;
  profileAction?: boolean;
  /** Disable when the entire summary is already inside a navigation button. */
  avatarProfilePeek?: boolean;
  contactActions?: boolean;
  className?: string;
}) {
  const summary = personStatusSummary(person);
  const name = personDisplayName(person);
  const openProfile = () => openClusterWorkNavigation({ screen: "people", inspectScope: "person", inspectId: person.id });
  const discord = person.profileDiscordUsername || person.discordUsername || "";
  return <div className={`cluster-person-summary-v493 ${compact ? "compact" : ""} ${className}`.trim()} data-availability={summary.availability}>
    <PresenceAvatar userId={person.id} imageUrl={person.avatarUrl} accentColor={person.personalAccentColor} label={name} fallback={personInitial(person)} state={summary.presence} title={summary.presenceLabel} profilePeek={avatarProfilePeek} />
    <div className="cluster-person-summary-copy-v493">
      {profileAction ? <ClusterButton unstyled type="button" className="cluster-person-summary-name-v493" onClick={openProfile}>{name}</ClusterButton> : <strong>{name}</strong>}
      <span>{personMetaLabel(person, { localTime: showLocalTime, capacity: showCapacity }) || `@${person.username}`}</span>
      {!compact && person.statusMessage ? <small>{person.statusMessage}</small> : null}
    </div>
    {contactActions ? <div className="cluster-person-summary-actions-v493">
      {person.email ? <a href={`mailto:${person.email}`}>Email</a> : null}
      {person.phoneNumber ? <a href={`tel:${person.phoneNumber}`}>Call</a> : null}
      {discord ? <ClusterCopyButton unstyled text={discord} copiedLabel="Discord copied" failedLabel="Discord username could not be copied">Discord</ClusterCopyButton> : null}
      {profileAction ? <ClusterButton unstyled type="button" onClick={openProfile}>Profile</ClusterButton> : null}
    </div> : null}
  </div>;
}
