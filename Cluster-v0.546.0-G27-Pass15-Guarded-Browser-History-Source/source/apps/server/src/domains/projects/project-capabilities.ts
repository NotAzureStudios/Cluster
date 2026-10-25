type ProjectCapabilitySerializerDependencies = {
  hasTargetAccess: (...args: any[]) => boolean;
  serializeProjectSummary: (project: any) => any;
  isExternalCollaboratorRole?: (user: any, role: string | null | undefined) => boolean;
};

export function createProjectCapabilitySerializer({ hasTargetAccess, serializeProjectSummary, isExternalCollaboratorRole }: ProjectCapabilitySerializerDependencies) {
  return function serializeWithCapabilities(project: any, user: any, decorated: any, accessRules: any[]) {
    const role = decorated?.workspaceRole;
    const level = decorated?.isAdmin || hasTargetAccess(user, role, "project", project.id, project, accessRules, "manage")
      ? "manage"
      : hasTargetAccess(user, role, "project", project.id, project, accessRules, "contribute")
        ? "contribute"
        : hasTargetAccess(user, role, "project", project.id, project, accessRules, "view")
          ? "view"
          : "none";
    const reason = decorated?.isAdmin
      ? "Server capability: admin override."
      : level === "manage"
        ? "Server capability: project manage access."
        : level === "contribute"
          ? "Server capability: project contribute access."
          : level === "view"
            ? "Server capability: project view access."
            : "Server capability: project access denied.";
    const externalSafe = Boolean(!decorated?.isAdmin && isExternalCollaboratorRole?.(user, role));
    const authorizedProject = decorated?.isAdmin ? project : {
      ...project,
      ...(externalSafe ? { name: project.externalName || project.name, codename: null, aliases: null } : {}),
      boards: (project.boards || []).filter((board: any) => hasTargetAccess(user, role, "board", board.id, project, accessRules, "view")),
      whiteboards: (project.whiteboards || []).filter((whiteboard: any) => hasTargetAccess(user, role, "whiteboard", whiteboard.id, project, accessRules, "view")),
    };
    return { ...serializeProjectSummary(authorizedProject), capabilities: { level, reason } };
  };
}
