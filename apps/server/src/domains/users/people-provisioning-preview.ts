import { z } from "zod";
import { assignableStudioRoles } from "./people-role-governance.js";
import { validateReturnAccessWindow } from "../studio-systems/studio-return-eligibility.js";

export const provisioningPreviewInput = z.object({
  accountType: z.enum(["employee", "contractor", "client", "guest"]),
  role: z.string().min(1).max(80),
  accessExpiresAt: z.string().datetime({ offset: true }).optional().nullable(),
}).strict();

/**
 * Explicitly a preflight, NOT an authorization token or effective-access grant.
 * All provisioning decisions are checked again by the actual create transaction.
 */
export function buildPeopleProvisioningPreview(
  input: z.infer<typeof provisioningPreviewInput>,
  actorRole: string,
  studioSettings: Record<string, unknown>,
  now = new Date(),
) {
  const role = assignableStudioRoles(studioSettings).find((item) => item.id === input.role);
  const blockers: string[] = [];
  if (!role || !role.enabled) blockers.push("This role is no longer assignable.");
  if (role?.privileged && actorRole !== "owner") blockers.push("Only a workspace owner can provision owner or administrator accounts.");
  try {
    validateReturnAccessWindow(input.accountType, input.accessExpiresAt ? new Date(input.accessExpiresAt) : null, now);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : "Choose a valid access expiration.");
  }

  return {
    ready: blockers.length === 0,
    blockers,
    identity: { accountType: input.accountType, expiresAt: input.accessExpiresAt ?? null },
    role: role ? { id: role.id, label: role.label, privileged: role.privileged, enabled: role.enabled } : null,
    firstSignIn: "PASSWORD_CHANGE_REQUIRED" as const,
    projectGrants: "SEPARATE_APPROVAL_REQUIRED" as const,
    permissions: "NOT_AN_EFFECTIVE_ACCESS_DECISION" as const,
    notice: "Workspace role is only one part of access. Project memberships, team bundles, individual tool overrides, and object policies must be assessed separately. This preview does not grant access.",
  };
}
