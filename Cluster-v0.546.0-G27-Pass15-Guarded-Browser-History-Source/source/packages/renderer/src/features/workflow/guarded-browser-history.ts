import { createNavigationState, type AppNavigationState, type AppScreen } from "../../core/navigation";
import {
  resolveAuthorizedWorkspaceNavigation,
  type AuthorizedWorkspaceKind,
  type AuthorizedWorkspaceRead,
} from "./authorized-workspace-navigation";

/**
 * Browser Back/Forward and hash edits are untrusted navigation requests.
 * Resolve exact workspace identity and wait for the dirty-workspace decision
 * before committing the new selection. Popstate + hashchange may describe the
 * same transition; those must share a single pending approval/read.
 */
export function createGuardedBrowserHistoryRestorer(input: {
  getSessionId: () => string | null;
  beginNavigationIntent: () => number;
  isNavigationIntentCurrent: (intent: number) => boolean;
  canOpenRoute: (route: AppScreen) => boolean;
  readWorkspace: (kind: AuthorizedWorkspaceKind, id: string) => Promise<AuthorizedWorkspaceRead>;
  hasUnsavedChanges: () => boolean;
  confirmDiscard: () => Promise<boolean>;
  commit: (state: AppNavigationState) => void;
  restoreCurrentUrl: () => void;
  onUnavailable: () => void;
}) {
  let generation = 0;
  let pending: { key: string; promise: Promise<boolean> } | null = null;

  async function restore(candidate: AppNavigationState | null): Promise<boolean> {
    if (!candidate) return false;
    // The same hash can produce both popstate and hashchange events.
    const key = JSON.stringify(candidate);
    if (pending?.key === key) return pending.promise;

    const sequence = ++generation;
    const intent = input.beginNavigationIntent();
    const sessionId = input.getSessionId();
    const isCurrent = () => sequence === generation
      && input.isNavigationIntentCurrent(intent)
      && input.getSessionId() === sessionId;

    const promise = (async () => {
      if (!input.canOpenRoute(candidate.route)) {
        if (isCurrent()) { input.restoreCurrentUrl(); input.onUnavailable(); }
        return false;
      }
      let authorizedState = candidate;
      const route = candidate.route;
      if (route === "project" || route === "board" || route === "whiteboard") {
        // A historical Project/Board/Whiteboard ID never grants access and
        // historical parent placement is not trustworthy after a move.
        if (!sessionId) {
          if (isCurrent()) { input.restoreCurrentUrl(); input.onUnavailable(); }
          return false;
        }
        const target = {
          screen: route,
          projectId: candidate.context.projectId,
          boardId: candidate.context.boardId,
          whiteboardId: candidate.context.whiteboardId,
        };
        const authorized = await resolveAuthorizedWorkspaceNavigation(target, {
          read: input.readWorkspace,
          isCurrent,
        });
        if (!isCurrent()) return false;
        if (!authorized) {
          input.restoreCurrentUrl();
          input.onUnavailable();
          return false;
        }
        authorizedState = createNavigationState(route, {
          projectId: authorized.projectId,
          boardId: authorized.boardId,
          whiteboardId: authorized.whiteboardId,
          section: candidate.section,
          subsection: candidate.subsection,
        });
      }
      if (!isCurrent()) return false;
      if (input.hasUnsavedChanges()) {
        let approved = false;
        try { approved = await input.confirmDiscard(); } catch { /* A failed dialog never grants permission. */ }
        if (!isCurrent()) return false;
        if (!approved) { input.restoreCurrentUrl(); return false; }
      }
      if (!isCurrent()) return false;
      input.commit(authorizedState);
      return true;
    })();
    pending = { key, promise };
    void promise.finally(() => {
      if (pending?.promise === promise) pending = null;
    }).catch(() => {});
    return promise;
  }
  return { restore, invalidate: () => { ++generation; pending = null; } };
}
