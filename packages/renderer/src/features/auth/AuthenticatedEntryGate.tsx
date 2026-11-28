import { clusterAccountPortal } from "@cluster/shared";
import { DiscordLinkScreen, MfaEnrollmentScreen, PasswordMigrationScreen, type ClusterAuthUser } from "./AuthScreens";
import { FirstLoginExperience, type FirstLoginUser } from "./FirstLoginExperience";

type EntryUser = ClusterAuthUser & FirstLoginUser & { accountType?: string | null };
type EntryStep = "password" | "mfa" | "discord" | "first-login" | null;

/** What a signed-in person must do before using Cluster. Portal accounts
 *  (contractors, clients, guests) skip the studio's first-login tour: the
 *  portal is their first stop. */
export function entryStepFor(user: EntryUser): EntryStep {
  if (["PASSWORD_CHANGE_REQUIRED", "PASSWORD_RESET_REQUIRED"].includes(String(user.accountState || ""))) return "password";
  if (user.nextAuthStep === "SETUP_MFA") return "mfa";
  if (user.nextAuthStep === "LINK_DISCORD" || (user.discordLinkRequired && (user.accountState === "DISCORD_LINK_REQUIRED" || !user.discordLinked))) return "discord";
  if (!user.firstLoginCompletedAt && !clusterAccountPortal(user.accountType)) return "first-login";
  return null;
}

export function authenticatedEntryScreen(input: {
  user: EntryUser;
  onUserUpdated: (user: EntryUser) => void;
  onRefresh: () => void;
  onLogout: () => void | Promise<void>;
}) {
  const { user, onUserUpdated, onRefresh, onLogout } = input;
  const step = entryStepFor(user);
  if (step === "password") return <PasswordMigrationScreen user={user} onComplete={onUserUpdated} onLogout={onLogout} />;
  if (step === "mfa") return <MfaEnrollmentScreen user={user} onComplete={onUserUpdated} onLogout={onLogout} />;
  if (step === "discord") return <DiscordLinkScreen user={user} onRefresh={onRefresh} onLogout={onLogout} />;
  if (step === "first-login") return <FirstLoginExperience user={user} onUserUpdated={onUserUpdated} onLogout={onLogout} />;
  return null;
}
