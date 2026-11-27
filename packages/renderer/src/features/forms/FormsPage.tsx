import { useEffect, useState } from "react";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ToolPageHeader } from "../../components/ToolPageHeader";
import { MyFormsPanel } from "../settings/MyFormsPanel";
import { FormsStudio } from "./FormsStudio";
import "../application/admin-control-center.css";
import "../settings/settings-workspace.css";
import "./forms-page.css";

type FormsTab = "mine" | "forms" | "applications";
const FORM_SCOPES = ["studio-form", "form-submission", "studio-application"];

function readTarget() {
  const inspect = new URLSearchParams(window.location.search).get("inspect") || "";
  const separator = inspect.indexOf(":");
  return separator > 0 && FORM_SCOPES.includes(inspect.slice(0, separator)) ? { scope: inspect.slice(0, separator), id: inspect.slice(separator + 1) } : null;
}

/** Forms: fill what's assigned to you; managers build forms, read responses
 *  and review applications from the same place. */
export function FormsPage({ manager }: { manager: boolean }) {
  const [target, setTarget] = useState(readTarget);
  const [tab, setTab] = useState<FormsTab>(() => !manager ? "mine" : target?.scope === "studio-application" ? "applications" : target ? "forms" : "forms");
  useEffect(() => {
    const onInspector = (event: Event) => {
      const selection = (event as CustomEvent<{ scope: string; id: string | null }>).detail;
      if (!selection || !FORM_SCOPES.includes(selection.scope)) return;
      setTarget(selection.id ? { scope: selection.scope, id: selection.id } : null);
      if (manager) setTab(selection.scope === "studio-application" ? "applications" : "forms");
    };
    window.addEventListener("cluster:inspector-state-changed", onInspector);
    return () => window.removeEventListener("cluster:inspector-state-changed", onInspector);
  }, [manager]);

  return <main className="cluster-resource-workspace forms-page" aria-label="Forms">
    <ToolPageHeader title="Forms" icon="file" actions={manager ? <ClusterSegmentedControl value={tab} onChange={(value) => setTab(value as FormsTab)} label="Forms sections" size="compact"
      options={[{ value: "forms", label: "Forms" }, { value: "applications", label: "Applications" }, { value: "mine", label: "My forms" }]} /> : undefined} />
    <section className="cluster-resource-workspace__body">
      {tab === "mine" ? <MyFormsPanel />
        : <FormsStudio key={tab} applications={tab === "applications"}
          targetFormId={target?.scope === "studio-form" ? target.id : null}
          targetSubmissionId={target?.scope === "form-submission" ? target.id : null}
          targetApplicationId={target?.scope === "studio-application" ? target.id : null} />}
    </section>
  </main>;
}
