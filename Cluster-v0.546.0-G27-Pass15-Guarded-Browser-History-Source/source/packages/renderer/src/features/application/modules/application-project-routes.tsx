import "../styles/project-delivery.css";
import "../styles/project-workspace.css";
import type { ComponentProps } from "react";
import { ProjectsPage } from "../../projects/ProjectsPage";
import { ProjectDetailPage } from "../../projects/ProjectDetailPage";
import { PROJECT_DETAIL_COMPONENTS, PROJECT_DETAIL_HELPERS, PROJECT_LIST_HELPERS } from "./application-foundation";

type ProjectsRouteProps = Omit<ComponentProps<typeof ProjectsPage>, "helpers">;
type ProjectDetailRouteProps = Omit<ComponentProps<typeof ProjectDetailPage>, "helpers" | "components">;

export function ProjectsRoute(props: ProjectsRouteProps) {
  return <ProjectsPage {...props} helpers={PROJECT_LIST_HELPERS} />;
}

export function ProjectDetailRoute(props: ProjectDetailRouteProps) {
  return <ProjectDetailPage {...props} helpers={PROJECT_DETAIL_HELPERS} components={PROJECT_DETAIL_COMPONENTS} />;
}
