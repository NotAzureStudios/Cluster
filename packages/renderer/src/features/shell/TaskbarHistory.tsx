import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { levelLabel } from "../../core/format";
import type { SmartWorkspaceContext } from "../../core/smart-interface";

export function TaskbarHistory({ resumeContext, onResumeContext, onClearResumeContext }: { resumeContext?: SmartWorkspaceContext | null; onResumeContext?: () => void; onClearResumeContext?: () => void }) {
  return <>
    <div className="cl-tb-history" aria-label="Navigation history">
      <ClusterButton unstyled type="button" className="cl-tb-history__button" onClick={() => window.history.back()} title="Back" aria-label="Back"><ClusterIcon name="chevron-left" /></ClusterButton>
      <ClusterButton unstyled type="button" className="cl-tb-history__button" onClick={() => window.history.forward()} title="Forward" aria-label="Forward"><ClusterIcon name="chevron-right" /></ClusterButton>
    </div>
    {resumeContext && onResumeContext ? <div className="cl-tb-resume" aria-label="Continue previous work">
      <ClusterButton unstyled type="button" className="cl-tb-resume__main" onClick={onResumeContext} title="Continue where you left off"><ClusterIcon name="previous" /><span className="cl-tb-action__label">Resume {levelLabel(String(resumeContext.screen || "workspace").replace(/mywork/gi, "my work").replace(/[_-]/g, " "))}</span></ClusterButton>
      {onClearResumeContext ? <ClusterButton unstyled type="button" className="cl-tb-resume__clear" onClick={onClearResumeContext} title="Clear saved workspace" aria-label="Clear saved workspace"><ClusterIcon name="close" /></ClusterButton> : null}
    </div> : null}
  </>;
}
