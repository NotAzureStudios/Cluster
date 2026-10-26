import "../styles/project-delivery.css";
import { ClusterButton } from "../../../components/ClusterButton";
import { projectHasBuildSignals } from "../../projects/ProjectBuildsPanel";
import { projectCompleteness } from "../../projects/projects-utils";
import type { Project } from "../application-models";

export function BuildsFoldedIntoProjectsPage({ projects, onOpenProject }: { projects: Project[]; onOpenProject: (projectId: string) => void }) {
  const buildReadyProjects = projects.filter((project) => projectHasBuildSignals(project));
  const rows = buildReadyProjects.length ? buildReadyProjects : projects;
  return (
    <section className="page builds-folded-page-v157">
      <header className="panel compact-page-hero-v157">
        <div>
          <p className="eyebrow">Builds moved</p>
          <h1>Builds live in Projects now</h1>
          <p className="muted tight">Open a project and use the Builds tab for artifacts, QA handoff, release milestones, and notes. Project Builds are the shared source of truth.</p>
        </div>
      </header>
      <div className="builds-folded-list-v157">
        {rows.map((project) => (
          <ClusterButton type="button" key={project.id} onClick={() => onOpenProject(project.id)}>
            <strong>{project.name}</strong>
            <span>{projectHasBuildSignals(project) ? "Build track active" : "Build track not started"}</span>
            <em>{projectCompleteness(project)}% ready</em>
          </ClusterButton>
        ))}
      </div>
    </section>
  );
}
