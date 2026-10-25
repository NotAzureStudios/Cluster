import { ClusterButton } from "../../components/ClusterButton";
import type { AdminSection, Project, UserActivitySummary } from "../application/application-models";

type ExportKind = "workspace" | "projects" | "users" | "permissions";

export function AdminUtilitySections({
  adminSection,
  projects,
  users,
  onOpenServerConfig,
  downloadAdminExport,
}: {
  adminSection: AdminSection;
  projects: Project[];
  users: UserActivitySummary[];
  onOpenServerConfig?: () => void;
  downloadAdminExport: (kind: ExportKind) => void;
}) {
  if (adminSection !== "exports") return null;
  return (
    <section className="panel management-panel admin-resource-panel export-center-v120">
      <div className="management-header-row">
        <div><p className="eyebrow">Exports</p><h2>Backup / export center</h2><p className="muted tight">Download structured JSON snapshots for studio data, permissions, users, projects, and the currently loaded hours window.</p></div>
        <span className="soft-pill">Admin only</span>
      </div>
      <div className="export-grid-v120">
        <ClusterButton type="button" onClick={() => downloadAdminExport("workspace")}><strong>Studio export</strong><span>Projects, users, permissions, and current hours window.</span></ClusterButton>
        <ClusterButton type="button" onClick={() => downloadAdminExport("projects")}><strong>Projects export</strong><span>{projects.length} projects with setup, leads, boards, whiteboards, and Library coverage.</span></ClusterButton>
        <ClusterButton type="button" onClick={() => downloadAdminExport("users")}><strong>People export</strong><span>{users.length} directory records, roles, capacity, availability, and contact-safe fields.</span></ClusterButton>
        <ClusterButton type="button" onClick={() => downloadAdminExport("permissions")}><strong>Permissions export</strong><span>Tool and project permission matrices for auditing.</span></ClusterButton>
      </div>
      <section className="panel server-backup-pointer-v318">
        <div className="section-heading">
          <div><p className="eyebrow">Authoritative backups</p><h3>Server backup and restore</h3><p className="muted tight">Backup scheduling, verification, retention, downloads, and restores are managed by the server.</p></div>
          <ClusterButton type="button" variant="primary" onClick={() => { window.sessionStorage.setItem("cluster-server-config-section", "backups"); onOpenServerConfig?.(); }}>Open server backups</ClusterButton>
        </div>
      </section>
    </section>
  );
}
