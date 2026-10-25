import { ClusterNativeSelect, ClusterInput } from "../../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../../components/ClusterTextInput";
import { ClusterButton } from "../../../components/ClusterButton";

import { useEffect, useState } from "react";
import { PROJECT_LEVEL_OPTIONS, ROLE_PERMISSION_TEMPLATES, TOOL_LEVEL_OPTIONS, TOOL_PERMISSION_OPTIONS, defaultToolPermissionsForUser, getToolLevel, isExternalCollaborator, isUserAccessExpired, type ProjectPermissionLevel, type ProjectPermissions, type ToolPermissionKey, type ToolPermissionLevel, type ToolPermissions } from "../../../core/permissions";
import { useServerState } from "../../../core/server-state";
import { TIMEZONE_OPTIONS, optionsWithCurrent } from "../../../core/options";
import { compactDateTime } from "../../../core/date-time";
import { formatRelativeTime, levelLabel } from "../../../core/format";
import { getProjectPermission, projectPermissionReason } from "../../projects/project-access-policy";
import { isExternalProject, projectStatusLabel } from "../../projects/projects-utils";
import { activeLabel, displayUserName } from "../../people/people-utils";
import type { User, Project, Settings, LibraryItem, TimelineItem, TimelineEntry, UpcomingPayload, ActivityEvent, TeamAssignment, UserActivitySummary, HomeRoleKey, AttentionItem, CommandBrief, AvailabilityOverrideRecord } from "../../application/application-models";

import { homeRoleForUser } from "./operations-workflows";
import { libraryStatusLabel, projectTypeBadge } from "./operations-foundation";
import { runtimeStyle } from "../../../core/runtime-style";

export function CommandBriefPanel({ brief, items, onOpenProjects, onOpenTimeline, onOpenBuilds, onOpenTime, onOpenLibrary, onOpenTeam, onOpenNotifications, onOpenActivity, onOpenReports, onOpenAdmin }: { brief: CommandBrief; items: AttentionItem[]; onOpenProjects: () => void; onOpenTimeline: () => void; onOpenBuilds: () => void; onOpenTime: () => void; onOpenLibrary: () => void; onOpenTeam: () => void; onOpenNotifications: () => void; onOpenActivity: () => void; onOpenReports: () => void; onOpenAdmin: () => void }) {
  const handlers: Record<AttentionItem["target"], () => void> = {
    projects: onOpenProjects,
    timeline: onOpenTimeline,
    builds: onOpenBuilds,
    scheduler: onOpenTime,
    library: onOpenLibrary,
    people: onOpenTeam,
    inbox: onOpenNotifications,
    activity: onOpenActivity,
    tickets: onOpenReports,
    admin: onOpenAdmin,
  };
  const urgentItems = items.filter((item) => item.severity === "critical" || item.severity === "high");
  const topItem = urgentItems[0] || items[0];
  const compactStats = [
    { label: "Overdue", value: brief.overdue, action: onOpenTimeline },
    { label: "Blocked", value: brief.blockedBuilds, action: onOpenBuilds },
    {
      label: "Approvals",
      value: brief.approvalsWaiting,
      action: onOpenNotifications,
    },
    {
      label: "Changed",
      value: brief.changedSinceYesterday,
      action: onOpenActivity,
    },
  ];
  return (
    <section className={`command-brief-v141 ${topItem ? topItem.severity : "clear"}`}>
      <div className="command-brief-main-v141">
        <p className="eyebrow">Priority brief</p>
        <h2>{topItem ? topItem.title : "Clear"}</h2>
        <p>{topItem ? topItem.detail : "No urgent work is asking for attention."}</p>
      </div>
      <div className="command-brief-stats-v141">
        {compactStats.map((item) => (
          <ClusterButton unstyled type="button" key={item.label} onClick={item.action} className={Number(item.value) > 0 ? "hot" : "quiet"}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </ClusterButton>
        ))}
      </div>
      <div className="command-brief-actions-v141">
        <ClusterButton type="button" className="" onClick={topItem ? handlers[topItem.target] : onOpenNotifications} variant="primary">
          {topItem ? "Open signal" : "Open inbox"}
        </ClusterButton>
        <ClusterButton type="button" className="" onClick={onOpenProjects} variant="secondary">
          Projects
        </ClusterButton>
      </div>
    </section>
  );
}

export function RoleAwareHomePanel({ currentUser, projects, dueCards, buildEntries, attentionProjects, users, onOpenProjects, onOpenBuilds, onOpenTimeline, onOpenTeam, onOpenAdmin, onOpenTime }: { currentUser: User | null | undefined; projects: Project[]; dueCards: UpcomingPayload["dueCards"]; buildEntries: Array<TimelineEntry | TimelineItem>; attentionProjects: Project[]; users: UserActivitySummary[]; onOpenProjects: () => void; onOpenBuilds: () => void; onOpenTimeline: () => void; onOpenTeam: () => void; onOpenAdmin: () => void; onOpenTime: () => void }) {
  const role = homeRoleForUser(currentUser || null, projects);
  const assignedProjects = currentUser ? projects.filter((project) => project.memberships?.some((membership) => membership.userId === currentUser.id && (membership.status || "active") === "active")) : [];
  const externalProjects = projects.filter(isExternalProject);
  const activeUsers = users.filter((item) => activeLabel(item.lastSeenAt, item.lastActivityAt) !== "Offline").length;
  const cardsAssignedToMe = projects
    .flatMap((project) =>
      (project.boards || []).flatMap((board: any) =>
        ((board as any).cards || []).map((card: any) => ({
          ...card,
          projectName: project.name,
          boardName: board.name,
        })),
      ),
    )
    .filter((card: any) => currentUser && (card.assigneeId === currentUser.id || (card.assigneeIds || []).includes(currentUser.id)))
    .slice(0, 5);
  const profiles: Record<
    HomeRoleKey,
    {
      label: string;
      title: string;
      detail: string;
      actions: Array<{ label: string; detail: string; action: () => void }>;
      metrics: Array<{ label: string; value: string | number; note: string }>;
    }
  > = {
    admin: {
      label: "Admin cockpit",
      title: "Workspace control queue",
      detail: "Approvals, permissions, workload, time, backups, and setup gaps are surfaced first for admins.",
      actions: [
        {
          label: "Open Admin",
          detail: "Permissions, hours, diagnostics",
          action: onOpenAdmin,
        },
        {
          label: "Review team",
          detail: `${activeUsers}/${users.length || 0} active`,
          action: onOpenTeam,
        },
        {
          label: "Time controls",
          detail: "Hours, corrections, approvals",
          action: onOpenTime,
        },
      ],
      metrics: [
        {
          label: "Attention",
          value: attentionProjects.length,
          note: "projects need work",
        },
        {
          label: "External",
          value: externalProjects.length,
          note: "tracked partner/client projects",
        },
        {
          label: "Builds",
          value: buildEntries.length,
          note: "upcoming handoffs",
        },
      ],
    },
    lead: {
      label: "Lead view",
      title: "Delivery and team focus",
      detail: "Project leads receive roadmap, build, assignment, and blocked-work signals with priority over general dashboard updates.",
      actions: [
        {
          label: "Projects",
          detail: `${assignedProjects.length} assigned`,
          action: onOpenProjects,
        },
        {
          label: "Timeline",
          detail: "Milestones and phases",
          action: onOpenTimeline,
        },
        {
          label: "Builds",
          detail: `${buildEntries.length} upcoming`,
          action: onOpenBuilds,
        },
      ],
      metrics: [
        {
          label: "Assigned projects",
          value: assignedProjects.length,
          note: "you are attached to",
        },
        { label: "Due cards", value: dueCards.length, note: "coming up" },
        {
          label: "Attention",
          value: attentionProjects.length,
          note: "needs lead review",
        },
      ],
    },
    qa: {
      label: "QA view",
      title: "QA queue",
      detail: "QA gets builds, tickets, due checks, and verification work before the broader production dashboard.",
      actions: [
        { label: "Builds", detail: "Testable artifacts", action: onOpenBuilds },
        {
          label: "Projects",
          detail: "Context and boards",
          action: onOpenProjects,
        },
        { label: "Timeline", detail: "Release beats", action: onOpenTimeline },
      ],
      metrics: [
        {
          label: "Builds",
          value: buildEntries.length,
          note: "need test context",
        },
        {
          label: "Due cards",
          value: dueCards.length,
          note: "scheduled checks",
        },
        { label: "Projects", value: projects.length, note: "visible to QA" },
      ],
    },
    external: {
      label: "External view",
      title: "Partner workspace",
      detail: "External collaborators only see explicitly allowed work and external projects. Internal projects remain hidden by default.",
      actions: [
        {
          label: "External projects",
          detail: `${externalProjects.length} visible`,
          action: onOpenProjects,
        },
        {
          label: "Timeline",
          detail: "Public delivery dates",
          action: onOpenTimeline,
        },
        { label: "Builds", detail: "Shared artifacts", action: onOpenBuilds },
      ],
      metrics: [
        {
          label: "External",
          value: externalProjects.length,
          note: "partner/client projects",
        },
        {
          label: "Assigned",
          value: assignedProjects.length,
          note: "directly assigned",
        },
        { label: "Upcoming", value: dueCards.length, note: "visible due work" },
      ],
    },
    developer: {
      label: "Developer view",
      title: "Build, cards, and current work",
      detail: "Developers get assigned cards, builds, timelines, and project context without admin clutter stomping around the place.",
      actions: [
        {
          label: "My projects",
          detail: `${assignedProjects.length} assigned`,
          action: onOpenProjects,
        },
        {
          label: "Builds",
          detail: `${buildEntries.length} upcoming`,
          action: onOpenBuilds,
        },
        { label: "Timeline", detail: "Milestones", action: onOpenTimeline },
      ],
      metrics: [
        {
          label: "Assigned cards",
          value: cardsAssignedToMe.length,
          note: "visible on boards",
        },
        { label: "Builds", value: buildEntries.length, note: "upcoming" },
        {
          label: "Projects",
          value: assignedProjects.length || projects.length,
          note: assignedProjects.length ? "assigned" : "visible",
        },
      ],
    },
  };
  const profile = profiles[role];
  return (
    <section className={`panel role-home-panel-v126 ${role}`}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">{profile.label}</p>
          <h2>{profile.title}</h2>
          <p className="muted tight">{profile.detail}</p>
        </div>
        <span className="soft-pill">
          {displayUserName(currentUser as User)} · {levelLabel(role)}
        </span>
      </div>
      <div className="role-home-grid-v126">
        <div className="role-home-actions-v126">
          {profile.actions.map((item) => (
            <ClusterButton unstyled type="button" key={item.label} onClick={item.action}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </ClusterButton>
          ))}
        </div>
        <div className="role-home-metrics-v126">
          {profile.metrics.map((item) => (
            <article key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <em>{item.note}</em>
            </article>
          ))}
        </div>
      </div>
      {cardsAssignedToMe.length > 0 && (
        <div className="role-home-list-v126">
          {cardsAssignedToMe.map((card) => (
            <span key={card.id}>
              <strong>{card.title}</strong>
              <em>
                {card.projectName} · {card.boardName}
              </em>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export function GlobalSearchHub({ projects, onOpenProject, onOpenBoard }: { projects: Project[]; onOpenProject?: (projectId: string) => void; onOpenBoard?: (boardId: string) => void }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = projects
    .flatMap((project) => [
      {
        id: `project-${project.id}`,
        type: "Project",
        title: project.name,
        meta: `${projectTypeBadge(project)} · ${projectStatusLabel(project)}`,
        action: () => onOpenProject?.(project.id),
      },
      ...(project.boards || []).map((board) => ({
        id: `board-${board.id}`,
        type: "Board",
        title: board.name,
        meta: project.name,
        action: () => onOpenBoard?.(board.id),
      })),
      ...(project.whiteboards || []).map((whiteboard) => ({
        id: `whiteboard-${whiteboard.id}`,
        type: "Whiteboard",
        title: whiteboard.name,
        meta: project.name,
        action: () => undefined,
      })),
      ...(project.libraryItems || []).map((item) => ({
        id: `library-${item.id}`,
        type: "Library",
        title: item.title,
        meta: `${project.name} · ${item.type}`,
        action: () => undefined,
      })),
    ])
    .filter((row) => !needle || `${row.title} ${row.meta} ${row.type}`.toLowerCase().includes(needle))
    .slice(0, 16);
  return (
    <section className="panel global-search-hub-v121">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Global search</p>
          <h2>Find anything</h2>
          <p className="muted tight">Search projects, boards, whiteboards, and library items from Home.</p>
        </div>
        <span className="soft-pill">{rows.length} results</span>
      </div>
      <ClusterTextInput className="global-search-input-v121" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, boards, whiteboards, docs..." />
      <div className="global-search-results-v121">
        {rows.length ? (
          rows.map((row) => (
            <ClusterButton unstyled type="button" key={row.id} onClick={row.action}>
              <span>{row.type}</span>
              <strong>{row.title}</strong>
              <em>{row.meta}</em>
            </ClusterButton>
          ))
        ) : (
          <div className="empty-state compact-empty">No results.</div>
        )}
      </div>
    </section>
  );
}

export function ExternalAccessRulesPanel({ users, projects }: { users: UserActivitySummary[]; projects: Project[] }) {
  const externalUsers = users.filter((user) => isExternalCollaborator(user));
  const externalProjects = projects.filter(isExternalProject);
  const internalProjects = projects.filter((project) => !isExternalProject(project));
  return (
    <section className="permission-section-v065 external-rules-v126">
      <div className="section-heading">
        <div>
          <p className="eyebrow">External access</p>
          <h3>Collaborator guardrails</h3>
          <p className="muted tight">External users default to view access on external projects and no implicit access to internal projects. Explicit project permissions take precedence.</p>
        </div>
        <span className="soft-pill">{externalUsers.length} external users</span>
      </div>
      <div className="external-rules-grid-v126">
        <article>
          <span>External projects</span>
          <strong>{externalProjects.length}</strong>
          <em>visible by default to external collaborators</em>
        </article>
        <article>
          <span>Internal projects</span>
          <strong>{internalProjects.length}</strong>
          <em>hidden unless explicitly allowed</em>
        </article>
        <article>
          <span>Restricted tools</span>
          <strong>People / Activity / Scheduler</strong>
          <em>none by default for external collaborators</em>
        </article>
      </div>
      <div className="external-user-list-v126">
        {externalUsers.length ? (
          externalUsers.map((user) => (
            <span key={user.id} className={isUserAccessExpired(user as User) ? "expired" : ""}>
              <strong>{displayUserName(user as User)}</strong>
              <em>
                {user.accountType || user.workspaceRole || user.employmentType || "external"}
                {user.accessExpiresAt ? ` · ${isUserAccessExpired(user as User) ? "expired" : "until"} ${new Date(user.accessExpiresAt).toLocaleDateString()}` : " · permanent"}
              </em>
            </span>
          ))
        ) : (
          <div className="empty-state compact-empty">No external collaborators detected yet.</div>
        )}
      </div>
    </section>
  );
}

export function PermissionMatrixControls({ projects, users, permissionUser, toolPermissionDraft, projectPermissionDraft, onToolChange, onProjectChange, onApplyTemplate, onSelectUser, onSave, onResetDefaults, onExternalDefaults, onCopyFromUser }: { projects: Project[]; users: UserActivitySummary[]; permissionUser: UserActivitySummary | undefined; toolPermissionDraft: ToolPermissions; projectPermissionDraft: ProjectPermissions; onToolChange: (tool: ToolPermissionKey, level: ToolPermissionLevel) => void; onProjectChange: (projectId: string, level: ProjectPermissionLevel) => void; onApplyTemplate: (templateKey: string) => void; onSelectUser: (user: UserActivitySummary) => void; onSave: () => void; onResetDefaults: () => void; onExternalDefaults: () => void; onCopyFromUser: (userId: string) => void }) {
  const [matrixTool, setMatrixTool] = useState<ToolPermissionKey>("projects");
  const [sourceUserId, setSourceUserId] = useState("");
  if (!permissionUser) return null;
  const defaultTools = defaultToolPermissionsForUser(permissionUser);
  const toolCounts = TOOL_PERMISSION_OPTIONS.reduce<Record<ToolPermissionLevel, number>>(
    (acc, tool) => {
      const level = (toolPermissionDraft[tool.key] || defaultTools[tool.key] || "none") as ToolPermissionLevel;
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    },
    { none: 0, view: 0, edit: 0, manage: 0 },
  );
  const projectCounts = projects.reduce<Record<ProjectPermissionLevel, number>>(
    (acc, project) => {
      const level = (projectPermissionDraft[project.id] || getProjectPermission(permissionUser, project)) as ProjectPermissionLevel;
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    },
    { none: 0, view: 0, contribute: 0, manage: 0 },
  );
  function setAllTools(level: ToolPermissionLevel) {
    TOOL_PERMISSION_OPTIONS.forEach((tool) => onToolChange(tool.key, level));
  }
  function setAllProjects(level: ProjectPermissionLevel) {
    projects.forEach((project) => onProjectChange(project.id, level));
  }
  function setExternalProjectDefaults() {
    projects.forEach((project) => onProjectChange(project.id, isExternalProject(project) ? "view" : "none"));
  }
  return (
    <section className="permission-section-v065 permission-matrix-v126">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Matrix editor</p>
          <h3>Role templates, inheritance, and bulk access</h3>
          <p className="muted tight">Manage role permissions, scopes, and access rules from one editing workspace.</p>
        </div>
        <ClusterButton type="button" className="" onClick={onSave} variant="primary">
          Save matrix changes
        </ClusterButton>
      </div>
      <div className="permission-matrix-toolbar-v126">
        <ClusterNativeSelect onChange={(event) => onApplyTemplate(event.target.value)} defaultValue="">
          <option value="" disabled>
            Apply role template...
          </option>
          {ROLE_PERMISSION_TEMPLATES.map((template) => (
            <option key={template.key} value={template.key}>
              {template.label}
            </option>
          ))}
        </ClusterNativeSelect>
        <ClusterButton type="button" className="" onClick={onResetDefaults} variant="quiet" size="compact">
          Reset to role default
        </ClusterButton>
        <ClusterButton type="button" className="" onClick={onExternalDefaults} variant="quiet" size="compact">
          External collaborator defaults
        </ClusterButton>
        <ClusterNativeSelect
          value={sourceUserId}
          onChange={(event) => {
            setSourceUserId(event.target.value);
            if (event.target.value) onCopyFromUser(event.target.value);
          }}
        >
          <option value="">Copy from user...</option>
          {users
            .filter((user) => user.id !== permissionUser.id)
            .map((user) => (
              <option key={user.id} value={user.id}>
                {displayUserName(user as User)}
              </option>
            ))}
        </ClusterNativeSelect>
      </div>
      <div className="permission-matrix-summary-v126">
        {TOOL_LEVEL_OPTIONS.map((level) => (
          <article key={level}>
            <span>{levelLabel(level)}</span>
            <strong>{toolCounts[level] || 0}</strong>
            <em>tools</em>
          </article>
        ))}
        {PROJECT_LEVEL_OPTIONS.map((level) => (
          <article key={`project-${level}`}>
            <span>{levelLabel(level)}</span>
            <strong>{projectCounts[level] || 0}</strong>
            <em>projects</em>
          </article>
        ))}
      </div>
      <div className="permission-bulk-grid-v126">
        <div>
          <strong>Set all tools</strong>
          <div className="button-row compact">
            {TOOL_LEVEL_OPTIONS.map((level) => (
              <ClusterButton type="button" className="" key={level} onClick={() => setAllTools(level)} variant="quiet" size="compact">
                {levelLabel(level)}
              </ClusterButton>
            ))}
          </div>
        </div>
        <div>
          <strong>Set all projects</strong>
          <div className="button-row compact">
            {PROJECT_LEVEL_OPTIONS.map((level) => (
              <ClusterButton type="button" className="" key={level} onClick={() => setAllProjects(level)} variant="quiet" size="compact">
                {levelLabel(level)}
              </ClusterButton>
            ))}
            <ClusterButton type="button" className="" onClick={setExternalProjectDefaults} variant="quiet" size="compact">
              External only
            </ClusterButton>
          </div>
        </div>
      </div>
      <div className="permission-tool-matrix-v126">
        <div className="field">
          <label>Compare tool across users</label>
          <ClusterNativeSelect value={matrixTool} onChange={(event) => setMatrixTool(event.target.value as ToolPermissionKey)}>
            {TOOL_PERMISSION_OPTIONS.map((tool) => (
              <option key={tool.key} value={tool.key}>
                {tool.label}
              </option>
            ))}
          </ClusterNativeSelect>
        </div>
        <div className="permission-user-matrix-v126">
          {users.map((user) => (
            <ClusterButton unstyled type="button" key={user.id} className={user.id === permissionUser.id ? "active" : ""} onClick={() => onSelectUser(user)}>
              <strong>{displayUserName(user as User)}</strong>
              <span>
                {getToolLevel(user, matrixTool)} · {isExternalCollaborator(user) ? "external" : user.workspaceRole || "member"}
              </span>
            </ClusterButton>
          ))}
        </div>
      </div>
      <div className="project-permission-matrix-v126">
        {projects.map((project) => {
          const level = (projectPermissionDraft[project.id] || getProjectPermission(permissionUser, project)) as ProjectPermissionLevel;
          return (
            <article key={project.id} className={isExternalProject(project) ? "external" : "internal"}>
              <div>
                <strong>{project.name}</strong>
                <span>
                  {projectTypeBadge(project)} · {isExternalProject(project) ? "External" : "Internal"}
                </span>
                <em>{projectPermissionReason(permissionUser as UserActivitySummary, project)}</em>
              </div>
              <ClusterNativeSelect value={level} onChange={(event) => onProjectChange(project.id, event.target.value as ProjectPermissionLevel)}>
                {PROJECT_LEVEL_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {levelLabel(item)}
                  </option>
                ))}
              </ClusterNativeSelect>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function AuditEnhancementPanel({ events }: { events: ActivityEvent[] }) {
  const [mode, setMode] = useState("destructive");
  const auditRows = events
    .filter((event) => {
      const text = `${event.type} ${event.entityType} ${event.title} ${event.message || ""}`.toLowerCase();
      if (mode === "permissions") return /permission|role|access|admin/.test(text);
      if (mode === "scheduler") return /time|clock|timesheet|hours/.test(text);
      if (mode === "destructive") return /delete|archive|trash|restore/.test(text);
      return true;
    })
    .slice(0, 12);
  function downloadAudit() {
    const blob = new Blob([JSON.stringify(auditRows, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cluster-audit-${mode}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="panel audit-enhancement-v121">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Audit tools</p>
          <h2>Focused audit trails</h2>
          <p className="muted tight">Filter noisy activity into destructive actions, permission changes, time edits, or a full export-ready log.</p>
        </div>
        <ClusterButton type="button" className="" onClick={downloadAudit} variant="quiet" size="compact">
          Export JSON
        </ClusterButton>
      </div>
      <div className="ops-filter-pills-v072 audit-filter-pills-v121">
        {["destructive", "permissions", "time", "all"].map((item) => (
          <ClusterButton unstyled type="button" key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>
            {levelLabel(item)}
          </ClusterButton>
        ))}
      </div>
      <div className="audit-row-list-v121">
        {auditRows.length ? (
          auditRows.map((event) => (
            <article key={event.id}>
              <strong>{event.title}</strong>
              <span>
                {event.type} · {event.entityType} · {event.project?.name || "Workspace"}
              </span>
              <em>{formatRelativeTime(event.createdAt)}</em>
              <pre>{JSON.stringify(event.metadata || {}, null, 2)}</pre>
            </article>
          ))
        ) : (
          <div className="empty-state compact-empty">No audit events match this mode.</div>
        )}
      </div>
    </section>
  );
}

export function OnboardingChecklistPanel({ projects, users, settings }: { projects: Project[]; users: Array<User | UserActivitySummary>; settings?: Settings }) {
  const [checked, setChecked] = useServerState<Record<string, boolean>>("studio", "operations.onboarding-checklist", {});
  const items = [
    {
      key: "workspace",
      label: "Workspace named",
      detail: settings?.studioName || settings?.workspaceName || "Set studio/workspace name in Settings.",
      auto: Boolean(settings?.studioName || settings?.workspaceName),
    },
    {
      key: "admin",
      label: "Admin account ready",
      detail: `${users.filter((user) => user.isAdmin).length} admin user${users.filter((user) => user.isAdmin).length === 1 ? "" : "s"}.`,
      auto: users.some((user) => user.isAdmin),
    },
    {
      key: "roles",
      label: "Roles and permissions reviewed",
      detail: "Use Admin → Permissions and Templates before inviting the whole circus.",
      auto: users.some((user) => Object.keys(user.toolPermissions || {}).length),
    },
    {
      key: "project",
      label: "First project created",
      detail: `${projects.length} project${projects.length === 1 ? "" : "s"} loaded.`,
      auto: projects.length > 0,
    },
    {
      key: "library",
      label: "Library starter context",
      detail: "Create specs, folders, and versioned docs for the first project.",
      auto: projects.some((project) => (project.libraryItems || []).length > 0),
    },
    {
      key: "backup",
      label: "Backup policy picked",
      detail: "Set retention and checkpoint habits before the database learns betrayal.",
      auto: checked.backup || false,
    },
  ];
  function toggle(key: string, value: boolean) {
    const next = { ...checked, [key]: value };
    setChecked(next);
  }
  const completed = items.filter((item) => item.auto || checked[item.key]).length;
  return (
    <section className="panel remaining-system-card-v122 onboarding-checklist-v122">
      <div className="section-heading">
        <div>
          <p className="eyebrow">First-run onboarding</p>
          <h3>Workspace launch checklist</h3>
          <p className="muted tight">Setup checklist for new installations.</p>
        </div>
        <span className="soft-pill">
          {completed}/{items.length} done
        </span>
      </div>
      <div className="setup-progress-v122">
        <span style={runtimeStyle({ width: `${Math.round((completed / items.length) * 100)}%` })} />
      </div>
      <div className="onboarding-list-v122">
        {items.map((item) => {
          const done = item.auto || checked[item.key];
          return (
            <label key={item.key} className={done ? "complete" : ""}>
              <ClusterInput type="checkbox" checked={done} disabled={item.auto} onChange={(event) => toggle(item.key, event.target.checked)} />
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
              <em>{item.auto ? "Auto" : done ? "Done" : "Manual"}</em>
            </label>
          );
        })}
      </div>
    </section>
  );
}

export function EditableAvailabilityPlanner({ users }: { users: Array<User | UserActivitySummary> }) {
  const [overrides, setOverrides] = useServerState<Record<string, AvailabilityOverrideRecord>>("studio", "team.availability-overrides", {});
  const [selectedId, setSelectedId] = useState(users[0]?.id || "");
  const selected = users.find((user) => user.id === selectedId) || users[0];
  const existing = selected ? overrides[selected.id] : undefined;
  const [form, setForm] = useState({
    timezone: "",
    workWindow: "9:00 AM - 5:00 PM",
    days: "Mon, Tue, Wed, Thu, Fri",
    pto: "",
    focus: "",
  });
  useEffect(() => {
    if (!selected) return;
    const next = overrides[selected.id];
    setForm({
      timezone: next?.timezone || selected.timezone || "Local",
      workWindow: next?.workWindow || "9:00 AM - 5:00 PM",
      days: next?.days || "Mon, Tue, Wed, Thu, Fri",
      pto: next?.pto || "",
      focus: next?.focus || selected.statusMessage || "",
    });
  }, [selected?.id, overrides]);
  function save() {
    if (!selected) return;
    const next = {
      ...overrides,
      [selected.id]: {
        userId: selected.id,
        ...form,
        updatedAt: new Date().toISOString(),
      },
    };
    setOverrides(next);
  }
  const rows = users.map((user) => ({ user, override: overrides[user.id] })).slice(0, 16);
  return (
    <section className="panel editable-availability-v122">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Availability</p>
          <h3>Editable work windows</h3>
          <p className="muted tight">Store short-term scheduling notes without changing long-lived profile data.</p>
        </div>
        <span className="soft-pill">{Object.keys(overrides).length} overrides</span>
      </div>
      <div className="availability-editor-grid-v122">
        <div className="field">
          <label>User</label>
          <ClusterNativeSelect value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {displayUserName(user as User)}
              </option>
            ))}
          </ClusterNativeSelect>
        </div>
        <div className="field">
          <label>Timezone</label>
          <ClusterNativeSelect value={form.timezone} onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}>
            {optionsWithCurrent(TIMEZONE_OPTIONS, form.timezone, "Current timezone").map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </ClusterNativeSelect>
        </div>
        <div className="field">
          <label>Work window</label>
          <ClusterTextInput value={form.workWindow} onChange={(event) => setForm((prev) => ({ ...prev, workWindow: event.target.value }))} />
        </div>
        <div className="field">
          <label>Days</label>
          <ClusterTextInput value={form.days} onChange={(event) => setForm((prev) => ({ ...prev, days: event.target.value }))} />
        </div>
        <div className="field">
          <label>PTO / unavailable</label>
          <ClusterTextInput value={form.pto} onChange={(event) => setForm((prev) => ({ ...prev, pto: event.target.value }))} placeholder="Jul 12, Fridays, after 3 PM..." />
        </div>
        <div className="field">
          <label>Current focus</label>
          <ClusterTextInput value={form.focus} onChange={(event) => setForm((prev) => ({ ...prev, focus: event.target.value }))} placeholder="Builds, QA, UI pass..." />
        </div>
        <ClusterButton type="button" className="" onClick={save} disabled={!selected} variant="primary">
          Save availability
        </ClusterButton>
      </div>
      <div className="availability-override-list-v122">
        {rows.length ? (
          rows.map(({ user, override }) => (
            <article key={user.id}>
              <strong>{displayUserName(user as User)}</strong>
              <span>
                {override?.timezone || user.timezone || "Local"} · {override?.workWindow || "Default hours"}
              </span>
              <em>{override?.pto || override?.focus || "No override"}</em>
            </article>
          ))
        ) : (
          <div className="empty-state compact-empty">No users loaded.</div>
        )}
      </div>
    </section>
  );
}

export function WorkloadCommandPanel({ users, assignments }: { users: UserActivitySummary[]; assignments: TeamAssignment[] }) {
  const rows = users
    .map((user) => {
      const assignment = assignments.find((entry) => entry.user.id === user.id);
      const cards = assignment?.cards || [];
      const urgent = cards.filter((card) => card.priority === "high" || card.priority === "urgent").length;
      const overdue = cards.filter((card) => card.dueDate && new Date(card.dueDate).getTime() < Date.now()).length;
      const capacity = Number(user.capacityHours || 0);
      const estimatedHours = Math.max(cards.length * 2, urgent * 3);
      const utilization = capacity ? Math.round((estimatedHours / capacity) * 100) : 0;
      const signal = overdue ? "overdue" : capacity && utilization > 100 ? "over" : urgent ? "hot" : cards.length ? "steady" : "open";
      return {
        user,
        assignment,
        cards,
        urgent,
        overdue,
        capacity,
        estimatedHours,
        utilization,
        signal,
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.utilization - a.utilization || b.cards.length - a.cards.length);
  const overloaded = rows.filter((row) => row.signal === "over" || row.signal === "overdue").length;
  const open = rows.filter((row) => row.signal === "open").length;
  return (
    <section className="panel workload-command-v122">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Workload</p>
          <h3>Workload board</h3>
          <p className="muted tight">Review assigned cards, urgent work, overdue work, and estimated capacity in one place.</p>
        </div>
        <span className="soft-pill">
          {overloaded} overloaded · {open} open
        </span>
      </div>
      <div className="workload-board-v122">
        {rows.length ? (
          rows.map((row) => (
            <article key={row.user.id} className={row.signal}>
              <div>
                <strong>{displayUserName(row.user)}</strong>
                <span>{row.user.title || row.user.department || "No role"}</span>
              </div>
              <div className="capacity-meter">
                <span
                  style={runtimeStyle({
                    width: `${Math.min(100, row.utilization || (row.cards.length ? 35 : 8))}%`,
                  })}
                />
              </div>
              <b>{row.capacity ? `${row.utilization}%` : "No cap"}</b>
              <em>
                {row.cards.length} cards · {row.urgent} hot · {row.overdue} overdue
              </em>
            </article>
          ))
        ) : (
          <div className="empty-state compact-empty">No workload data.</div>
        )}
      </div>
    </section>
  );
}

export function LibraryLifecyclePanel({ items, users, onEdit }: { items: LibraryItem[]; users: User[]; onEdit: (item: LibraryItem) => void }) {
  const lifecycle = {
    draft: items.filter((item) => item.status === "draft").length,
    review: items.filter((item) => item.status === "in-review" || item.status === "needs-review").length,
    approved: items.filter((item) => item.status === "approved").length,
    update: items.filter((item) => item.status === "needs-update").length,
    deprecated: items.filter((item) => item.status === "deprecated").length,
    archived: items.filter((item) => item.status === "archived").length,
  };
  const reviewDue = items.filter((item) => item.reviewDueAt && new Date(item.reviewDueAt).getTime() < Date.now() && item.status !== "archived" && item.status !== "deprecated");
  const unversioned = items.filter((item) => ["spec", "decision", "reference", "folder"].includes(String(item.type)) && !item.versionLabel).length;
  const externalVisible = items.filter((item) => item.visibility === "external" || item.visibility === "public").length;
  const ownerName = (id?: string | null) => displayUserName((users.find((user) => user.id === id) || null) as User | null);
  return (
    <section className="panel library-version-panel-v122 library-lifecycle-panel-v125">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Lifecycle</p>
          <h2>Document lifecycle</h2>
          <p className="muted tight">Draft, review, approve, update, deprecate, archive. Documents now age like tracked assets instead of abandoned sticky notes.</p>
        </div>
        <span className="soft-pill">
          {reviewDue.length} review due · {unversioned} unversioned
        </span>
      </div>
      <div className="library-lifecycle-strip-v125">
        <ClusterButton unstyled type="button" onClick={() => undefined}>
          <span>Draft</span>
          <strong>{lifecycle.draft}</strong>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={() => undefined}>
          <span>In review</span>
          <strong>{lifecycle.review}</strong>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={() => undefined}>
          <span>Approved</span>
          <strong>{lifecycle.approved}</strong>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={() => undefined}>
          <span>Needs update</span>
          <strong>{lifecycle.update}</strong>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={() => undefined}>
          <span>Deprecated</span>
          <strong>{lifecycle.deprecated}</strong>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={() => undefined}>
          <span>External</span>
          <strong>{externalVisible}</strong>
        </ClusterButton>
      </div>
      <div className="library-lifecycle-list-v125">
        {(reviewDue.length ? reviewDue : items.filter((item) => item.status === "in-review" || item.status === "needs-update" || item.status === "deprecated").slice(0, 8)).map((item) => (
          <article key={item.id} className={String(item.status)}>
            <div>
              <strong>{item.title}</strong>
              <span>
                {libraryStatusLabel(item.status)} · {item.versionLabel || "No version"} · {ownerName(item.reviewerId || item.ownerId)}
              </span>
              <p>{item.lifecycleNotes || item.body || "No lifecycle notes."}</p>
            </div>
            <em>{item.reviewDueAt ? `Review ${compactDateTime(item.reviewDueAt)}` : item.approvedAt ? `Approved ${compactDateTime(item.approvedAt)}` : item.visibility || "internal"}</em>
            <ClusterButton type="button" className="" onClick={() => onEdit(item)} variant="quiet" size="compact">
              Edit lifecycle
            </ClusterButton>
          </article>
        ))}
        {!items.length && <div className="empty-state compact-empty">No library documents yet.</div>}
        {items.length > 0 && !reviewDue.length && !items.some((item) => item.status === "in-review" || item.status === "needs-update" || item.status === "deprecated") && <div className="empty-state compact-empty">No documents currently need lifecycle attention.</div>}
      </div>
    </section>
  );
}
