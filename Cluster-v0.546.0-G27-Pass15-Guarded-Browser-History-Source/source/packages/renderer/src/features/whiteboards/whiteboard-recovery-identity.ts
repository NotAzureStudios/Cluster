/** Never load recovery data from another account in a shared browser profile.
 * A missing authenticated identity is not an anonymous recovery namespace.
 * Server authorization still controls opening/saving the Whiteboard itself.
 */
export function whiteboardRecoveryStorageKey(userId: string | null | undefined, whiteboardId: string | null | undefined): string | null {
  if (!userId?.trim() || !whiteboardId?.trim()) return null;
  return `cluster-whiteboard-recovery-v2:${encodeURIComponent(userId)}:${encodeURIComponent(whiteboardId)}`;
}
