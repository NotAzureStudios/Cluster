import { createNavigationState, type AppNavigationState, type AppScreen } from "../../core/navigation";
import { resolveAuthorizedBoardNavigation, type AuthorizedBoardRead } from "./authorized-board-navigation";
import { resolveAuthorizedProjectNavigation, type AuthorizedProjectRead } from "./authorized-project-navigation";
import { resolveAuthorizedDetailNavigation, type DetailNavigationRead } from "./authorized-detail-navigation";

/** Browser history and manually edited hashes are locators, not prior grants.
 * Reuse the same fresh record-level admission as explicit work links. This
 * prevents old browser entries from bypassing current tool/resource access or
 * restoring obsolete Project placement after moves.
 */
export async function admitAuthorizedHistoryNavigation(
  requested: AppNavigationState,
  input: {
    canOpen: (screen: AppScreen) => boolean;
    isCurrent: () => boolean;
    readProject: (id: string) => Promise<AuthorizedProjectRead>;
    readBoard: (id: string) => Promise<AuthorizedBoardRead>;
    readWhiteboard: (path: string) => Promise<DetailNavigationRead>;
  },
): Promise<AppNavigationState | null> {
  const current = () => input.isCurrent() && input.canOpen(requested.route);
  if (!current()) return null;
  const context = requested.context;
  const withContext = (projectId: string | null) => createNavigationState(requested.route, {
    ...context, projectId, section: requested.section, subsection: requested.subsection,
  });
  if (requested.route === "project") {
    const target = await resolveAuthorizedProjectNavigation(
      { screen: "project", projectId: context.projectId },
      { read: input.readProject, isCurrent: current },
    );
    return target && current() ? withContext(target.projectId || null) : null;
  }
  if (requested.route === "board") {
    const target = await resolveAuthorizedBoardNavigation(
      { screen: "board", projectId: context.projectId, boardId: context.boardId },
      { read: input.readBoard, isCurrent: current },
    );
    return target && current() ? withContext(target.projectId || null) : null;
  }
  if (requested.route === "whiteboard") {
    const target = await resolveAuthorizedDetailNavigation(
      { screen: "whiteboard", projectId: context.projectId, whiteboardId: context.whiteboardId },
      { read: input.readWhiteboard, isCurrent: current },
    );
    return target && current() ? withContext(target.projectId || null) : null;
  }
  // Plain tool navigation has no exact resource to resolve, but still requires
  // the current user's effective tool permission (including disabled tools).
  return current() ? requested : null;
}
