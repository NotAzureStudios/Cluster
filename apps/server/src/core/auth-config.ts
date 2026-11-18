/**
 * The configuration a sign-in screen needs before it can render: which methods
 * are available, whether this instance still needs an owner, and the password
 * rules to validate against.
 *
 * It lives here rather than inside the `/api/auth/config` handler because the
 * boot payload serves the same values in the same response that reports who
 * you are. One builder means the sign-in screen cannot disagree with itself
 * depending on which route answered.
 */

export type ClusterAuthConfig = {
  passwordLoginEnabled: boolean;
  discordConfigured: boolean;
  discordLinkRequired: boolean;
  devLoginEnabled: boolean;
  discordLinkUrl: string;
  ownerSetupRequired: boolean;
  ownerSetupReason: string | null;
  passwordReadyAdministratorCount: number;
  setupLauncherName: string;
  passwordPolicy: { minimumLength: number; maximumLength: number };
};

export async function buildClusterAuthConfig(input: {
  prisma: unknown;
  inspectInstanceSetup: (prisma: unknown) => Promise<{ setupRequired: boolean; reason: string | null; passwordReadyAdministratorCount: number }>;
  isDiscordConfigured: () => boolean;
  requireDiscordLink: boolean;
  devLoginEnabled: boolean;
  passwordMinimumLength: number;
  passwordMaximumLength: number;
}): Promise<ClusterAuthConfig> {
  const instanceSetup = await input.inspectInstanceSetup(input.prisma);
  return {
    passwordLoginEnabled: true,
    discordConfigured: input.isDiscordConfigured(),
    discordLinkRequired: input.requireDiscordLink,
    devLoginEnabled: input.devLoginEnabled,
    discordLinkUrl: "/api/auth/discord/link",
    ownerSetupRequired: instanceSetup.setupRequired,
    ownerSetupReason: instanceSetup.reason,
    passwordReadyAdministratorCount: instanceSetup.passwordReadyAdministratorCount,
    setupLauncherName: process.platform === "win32" ? "ClusterServer.exe --recover-owner" : "docker compose logs cluster",
    passwordPolicy: {
      minimumLength: input.passwordMinimumLength,
      maximumLength: input.passwordMaximumLength,
    },
  };
}
