import type { LibraryItem } from "./library-types";
import { openClusterWorkNavigation } from "../workflow/work-navigation";

/** Board and whiteboard items open the real thing. Forms open in a modal
 *  supplied by the caller. Returns true when the item was handled. */
export function openLinkedLibraryItem(item: LibraryItem, openForm: (formId: string) => void) {
  if (!item.originRef) return false;
  if (item.type === "board") { openClusterWorkNavigation({ screen: "board", projectId: item.projectId || undefined, boardId: item.originRef }); return true; }
  if (item.type === "whiteboard") { openClusterWorkNavigation({ screen: "whiteboard", projectId: item.projectId || undefined, whiteboardId: item.originRef }); return true; }
  if (item.type === "form") { openForm(item.originRef); return true; }
  return false;
}
