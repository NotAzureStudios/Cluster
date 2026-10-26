import "../styles/project-workspace.css";
import { LazyFeatureBoundary } from "../../../components/FeatureBoundary";
import type { BoardWorkspacePageProps } from "../../boards/BoardWorkspacePage";
import type { WhiteboardWorkspacePageProps } from "../../whiteboards/WhiteboardWorkspacePage";
import { CustomFieldValuesPanel } from "../../operations/modules/operations-workflows";
import { RelatedRecordsPanel, VersionHistoryPanel, LazyBoardWorkspacePage, LazyWhiteboardWorkspacePage } from "./application-foundation";

export function BoardPage(props: Omit<BoardWorkspacePageProps, "components">) {
  return (
    <LazyFeatureBoundary label="Board">
      <LazyBoardWorkspacePage {...props} components={{ RelatedRecordsPanel, CustomFieldValuesPanel, VersionHistoryPanel }} />
    </LazyFeatureBoundary>
  );
}

export function WhiteboardPage(props: Omit<WhiteboardWorkspacePageProps, "components">) {
  return (
    <LazyFeatureBoundary label="Whiteboard">
      <LazyWhiteboardWorkspacePage
        {...props}
        components={{
          RelatedRecordsPanel: RelatedRecordsPanel,
          CustomFieldValuesPanel: CustomFieldValuesPanel,
          VersionHistoryPanel: VersionHistoryPanel,
        }}
      />
    </LazyFeatureBoundary>
  );
}
