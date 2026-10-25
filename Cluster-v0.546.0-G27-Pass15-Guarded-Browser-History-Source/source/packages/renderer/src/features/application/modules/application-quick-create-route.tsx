import type { SmartWorkspaceContext } from "../../../core/smart-interface";
import type { User, Project, Settings } from "../application-models";
import { SharedCreateDrawer } from "../../operations/modules/operations-admin";

export function QuickCreateDrawer(props: {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  settings?: Settings;
  currentUser: User;
  context?: SmartWorkspaceContext | null;
  onReloadProjects: () => Promise<void>;
  onReloadWhiteboards: () => Promise<void>;
  onOpenProject: (projectId: string) => void;
  onOpenBoard: (boardId: string) => void;
  onOpenWhiteboard: (whiteboardId: string) => void;
  onOpenTime: () => void;
}) {
  return <SharedCreateDrawer {...props} />;
}
