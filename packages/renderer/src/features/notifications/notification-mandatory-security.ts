/** Mirrors the server's mandatory security-evidence predicate. Routine System
 * updates remain subject to the user's category preferences, but critical
 * security incidents cannot disappear solely because System is muted.
 */
export function isMandatorySecurityNotification(item: {
  category?: string | null;
  signal?: string | null;
  priority?: string | null;
} | null | undefined): boolean {
  return item?.category === "system" && item.signal === "security" && item.priority === "critical";
}
