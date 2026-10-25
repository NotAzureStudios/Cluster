/** Collection authorization never replaces the authoritative LibraryItem ACL. */
export type LibraryCollectionRole = "owner" | "editor" | "viewer" | null;
export type LibraryCollectionPermission = "view" | "edit" | "manage";

export function libraryCollectionRole(
  collection: { ownerId: string; grants?: readonly { userId?: string; role: string }[] },
  userId: string,
  isAdmin: boolean,
): LibraryCollectionRole {
  if (collection.ownerId === userId || isAdmin) return "owner";
  const grant = collection.grants?.find((entry) => entry.userId === userId);
  return grant?.role === "editor" ? "editor" : grant?.role === "viewer" ? "viewer" : null;
}

export function libraryCollectionCan(role: LibraryCollectionRole, minimum: LibraryCollectionPermission): boolean {
  if (!role) return false;
  if (minimum === "view") return true;
  if (minimum === "edit") return role === "owner" || role === "editor";
  return role === "owner";
}
