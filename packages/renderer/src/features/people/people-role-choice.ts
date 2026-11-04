/** Client-side affordance only. The server verifies role catalog and actor membership. */
export type StudioAssignableRoleChoice = {
  id: string;
  label: string;
  enabled: boolean;
  privileged: boolean;
  members: number;
};
export function canChooseStudioRole(role: StudioAssignableRoleChoice | undefined, actorRole?: string | null) {
  return Boolean(role?.enabled && (!role.privileged || actorRole === "owner"));
}
