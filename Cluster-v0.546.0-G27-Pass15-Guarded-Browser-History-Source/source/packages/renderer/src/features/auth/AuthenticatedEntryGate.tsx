import { DiscordLinkScreen, MfaEnrollmentScreen, PasswordMigrationScreen, type ClusterAuthUser } from "./AuthScreens";
import { FirstLoginExperience, type FirstLoginUser } from "./FirstLoginExperience";
import { PolicyAcceptanceScreen } from "../legal/PolicyAcceptanceScreen";

type EntryUser = ClusterAuthUser & FirstLoginUser & { policyAcceptance?: any };

export function authenticatedEntryScreen(input: {
  user: EntryUser;
  onUserUpdated: (user: EntryUser) => void;
  onRefresh: () => void;
  onLogout: () => void | Promise<void>;
}) {
  const { user, onUserUpdated, onRefresh, onLogout } = input;
  if (["PASSWORD_CHANGE_REQUIRED", "PASSWORD_RESET_REQUIRED"].includes(String(user.accountState || ""))) return <PasswordMigrationScreen user={user} onComplete={onUserUpdated} onLogout={onLogout} />;
  if (user.nextAuthStep === "SETUP_MFA") return <MfaEnrollmentScreen user={user} onComplete={onUserUpdated} onLogout={onLogout} />;
  if (user.nextAuthStep === "LINK_DISCORD" || (user.discordLinkRequired && (user.accountState === "DISCORD_LINK_REQUIRED" || !user.discordLinked))) return <DiscordLinkScreen user={user} onRefresh={onRefresh} onLogout={onLogout} />;
  if (user.policyAcceptance?.required && !user.policyAcceptance.complete) return <PolicyAcceptanceScreen initial={user.policyAcceptance} username={user.username} onComplete={onRefresh} onLogout={onLogout} />;
  if (!user.firstLoginCompletedAt) return <FirstLoginExperience user={user} onUserUpdated={onUserUpdated} onLogout={onLogout} />;
  return null;
}
