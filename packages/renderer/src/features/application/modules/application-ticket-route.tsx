import { LazyFeatureBoundary } from "../../../components/FeatureBoundary";
import type { User, Project } from "../application-models";
import { CustomFieldValuesPanel } from "../../operations/modules/operations-workflows";
import { customFieldValueIsEmpty, customFieldVisible } from "../../operations/modules/operations-foundation";
import { RelatedRecordsPanel, VersionHistoryPanel, openSharedCreate, reportLifecycleStage, LazyTicketSystemPageFeature } from "./application-foundation";
import { applyTicketAutomations } from "./application-automation-settings";

export function TicketSystemPage({ projects, currentUser, onOpenTickets: _onOpenTickets, onOpenQa: _onOpenQa, onOpenBoard, onOpenProject, onOpenUser }: { projects: Project[]; currentUser: User; onOpenTickets: () => void; onOpenQa: () => void; onOpenBoard: (boardId: string) => void; onOpenProject: (projectId: string) => void; onOpenUser: (userId: string) => void }) {
  return (
    <LazyFeatureBoundary label="Tickets"><LazyTicketSystemPageFeature
      projects={projects}
      currentUser={currentUser}
      onOpenBoard={onOpenBoard}
      onOpenProject={onOpenProject}
      onOpenUser={onOpenUser}
      onOpenSharedCreate={openSharedCreate}
      helpers={{
        customFieldVisible: customFieldVisible,
        customFieldValueIsEmpty: customFieldValueIsEmpty,
        reportLifecycleStage,
        applyTicketAutomations: applyTicketAutomations,
      }}
      components={{
        CustomFieldValuesPanel: CustomFieldValuesPanel,
        RelatedRecordsPanel: RelatedRecordsPanel,
        VersionHistoryPanel: VersionHistoryPanel,
      }}
    /></LazyFeatureBoundary>
  );
}
