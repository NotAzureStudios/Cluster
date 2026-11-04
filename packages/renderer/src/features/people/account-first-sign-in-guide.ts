/** Build a handoff from an admin-issued, one-time temporary credential.
 * Never send automatically or put the password in a URL/query parameter.
 */
export function formatAccountFirstSignInGuide(input: { username: string; temporaryPassword: string; signInUrl?: string }): string {
  const username = input.username.trim();
  const password = input.temporaryPassword;
  const location = input.signInUrl?.trim() || "Open your studio's Cluster workspace";
  return [
    "Cluster account setup",
    "",
    "Sign in: " + location,
    "Username: " + username,
    "Temporary password: " + password,
    "",
    "1. Sign in with the temporary password.",
    "2. When prompted, create your own permanent password.",
    "3. Complete any required security verification and your first-login setup.",
    "",
    "Keep this credential private. Do not share it in a public channel. The temporary password stops working after you replace it.",
  ].join("\n");
}
