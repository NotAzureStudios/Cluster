import { CLUSTER_WORKFLOW_RELATIONSHIP_META, clusterResourceAddressFromEntity, type ClusterResourceAddress, type ClusterWorkflowRelationship } from "@cluster/shared";
import type { SearchCorpus } from "./search-repository.js";
import { workforceAuthorityProjection } from "../workforce/workforce-user-authority.js";
import type { SearchIndexItem, SearchIndexSnapshot } from "./search-index-types.js";

export function normalize(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_/\\|.,:;!?()[\]{}<>"'`~@#$%^&*+=-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string, maximum = 24) {
  return normalize(value).split(" ").filter(Boolean).slice(0, maximum);
}

export function parseJson(value: unknown): any {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

export function parseJsonStrings(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

const SEARCH_KIND_TERMS: Record<SearchIndexItem["kind"], string[]> = {
  project: ["project", "workspace", "production"],
  board: ["board", "kanban", "workflow"],
  whiteboard: ["whiteboard", "canvas", "diagram", "brainstorm"],
  file: ["file", "document", "doc", "asset", "library", "media"],
  packet: ["packet", "training", "handbook", "sop", "required reading", "knowledge"],
  policy: ["policy", "policies", "acknowledgement", "required reading", "compliance"],
  person: ["person", "people", "user", "member", "teammate", "team"],
  card: ["card", "task", "work item", "todo"],
  ticket: ["ticket", "issue", "request", "support", "incident", "work item"],
  timeline: ["timeline", "milestone", "roadmap", "schedule"],
  comment: ["comment", "discussion", "review", "note", "feedback"],
  activity: ["activity", "event", "history", "audit"],
  calendar: ["calendar", "event", "meeting", "schedule"],
  control: ["control", "risk", "decision", "blocker", "dependency"],
  build: ["build", "artifact", "package", "binary"],
  qa: ["qa", "test", "verification", "quality"],
  release: ["release", "release note", "changelog", "ship"],
  source_review: ["source review", "code review", "pull request", "merge request", "git"],
  source_commit: ["source commit", "git commit", "revision", "changeset"],
  studio_form: ["studio form", "form template", "questionnaire"],
  form_submission: ["form submission", "response", "form review"],
  approval: ["approval", "approval request", "decision review"],
};

export function iso(value: any) {
  return value?.toISOString?.() || value || null;
}

function searchResource(input: Omit<SearchIndexItem, "normalizedTitle" | "normalizedText" | "tokens">): ClusterResourceAddress | null {
  if (input.resource) return input.resource;
  const projectId = input.projectId || null;
  if (input.kind === "project") return { kind: "project", id: input.id };
  if (input.kind === "source_review") return projectId ? { kind: "source_review", id: input.id, projectId } : null;
  if (input.kind === "source_commit") return projectId && input.raw?.id ? { kind: "source_commit", id: String(input.raw.id), projectId } : null;
  if (input.kind === "studio_form" || input.kind === "form_submission") return { kind: input.kind, id: input.id };
  if (input.kind === "approval") return { kind: "approval", id: input.id };
  if (input.kind === "board") return { kind: "board", id: input.boardId || input.id, ...(projectId ? { projectId } : {}) };
  if (input.kind === "whiteboard") return { kind: "whiteboard", id: input.whiteboardId || input.id, ...(projectId ? { projectId } : {}) };
  if (input.kind === "card" || input.kind === "ticket") return { kind: input.kind, id: input.cardId || input.id, ...(projectId ? { projectId } : {}) };
  if (input.kind === "timeline") return { kind: "timeline", id: input.id, ...(projectId ? { projectId } : {}) };
  if (input.kind === "calendar") return { kind: "calendar", id: input.id, ...(projectId ? { projectId } : {}) };
  if (input.kind === "control") return { kind: "control", id: input.id, ...(projectId ? { projectId } : {}) };
  if (input.kind === "build") return { kind: "build", id: input.id, ...(projectId ? { projectId } : {}) };
  if (input.kind === "release") return { kind: "release", id: input.id, ...(projectId ? { projectId } : {}) };
  if (input.kind === "qa") return { kind: input.raw?.deliveryKind === "qa_session" ? "qa_session" : "qa_plan", id: input.id, ...(projectId ? { projectId } : {}) };
  if (input.kind === "person") return { kind: "user", id: input.id };
  if (input.kind === "packet") return { kind: "packet", id: input.id };
  if (input.kind === "policy") return { kind: "policy", id: input.id };
  if (input.kind === "comment" && input.cardId) return { kind: "card", id: input.cardId, ...(projectId ? { projectId } : {}) };
  if (input.kind === "activity") return clusterResourceAddressFromEntity({ entityType: input.raw?.entityType, entityId: input.raw?.entityId || input.cardId || input.whiteboardId || projectId, projectId });
  if (input.kind === "file") {
    const sources = input.facets?.source || [];
    const kind = sources.includes("review_asset") ? "review_asset" : sources.includes("project-file") ? "file" : "library";
    return { kind, id: input.id, ...(projectId ? { projectId } : {}) };
  }
  return null;
}

export function addItem(rows: SearchIndexItem[], input: Omit<SearchIndexItem, "normalizedTitle" | "normalizedText" | "tokens">) {
  const resource = searchResource(input);
  const normalizedTitle = normalize(input.title);
  const aliases = unique([...(input.aliases || []), ...(SEARCH_KIND_TERMS[input.kind] || [])]);
  const facetText = Object.values(input.facets).flat().join(" ");
  const normalizedText = normalize(`${input.title} ${input.detail} ${input.text} ${facetText} ${aliases.join(" ")}`);
  rows.push({ ...input, resource, aliases, normalizedTitle, normalizedText, tokens: [...new Set(tokenize(normalizedText, 120))] });
}

export function whiteboardElementText(elements: unknown) {
  const parsed = parseJson(elements);
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, 1_500).map((element: any) => ({
    id: String(element?.id || ""),
    title: String(element?.title || element?.text || element?.label || element?.name || "").trim(),
    text: [element?.text, element?.title, element?.label, element?.description, element?.url, element?.fileName].filter(Boolean).join(" "),
    categoryId: element?.categoryId ? String(element.categoryId) : null,
    labelIds: Array.isArray(element?.labelIds) ? element.labelIds.map(String).filter(Boolean) : [],
    type: String(element?.type || element?.kind || "object"),
    hasImage: Boolean(element?.imageUrl || element?.src || element?.dataUrl),
  })).filter((element) => element.id && (element.title || element.text));
}

export function userSearchName(user: any) {
  return String(user?.displayName || user?.preferredName || user?.username || "Person");
}

export function buildIndex(corpus: SearchCorpus): SearchIndexSnapshot {
  const rows: SearchIndexItem[] = [];
  const usersById = new Map(corpus.users.map((user) => [String(user.id), user]));
  const namesForIds = (ids: string[]) => ids.map((id) => userSearchName(usersById.get(id))).filter((name) => name !== "Person");
  const base = (input: Partial<SearchIndexItem> = {}) => ({
    memberIds: [], watcherIds: [], authorIds: [], labels: [], categories: [], flags: [], aliases: [], relationshipTerms: [], facets: {}, ...input,
  }) as Omit<SearchIndexItem, "normalizedTitle" | "normalizedText" | "tokens">;

  for (const project of corpus.projects) {
    const projectMembers = unique((project.memberships || []).map((membership: any) => String(membership.userId || "")).filter(Boolean));
    const projectTags = parseJsonStrings(project.tags);
    const projectAliases = unique([project.externalName, project.codename, ...parseJsonStrings(project.aliases)].filter(Boolean).map(String));
    addItem(rows, base({
      id: project.id, kind: "project", title: project.name,
      detail: `${project.projectType || "General"} · ${project.status || "active"} · ${project.clientName || "Internal"}`,
      text: `${project.externalName || ""} ${project.codename || ""} ${project.description || ""} ${project.objective || ""} ${project.clientName || ""} ${project.healthNote || ""} ${project.projectType || ""} ${project.status || ""} ${project.priority || ""} ${project.source || ""} ${projectTags.join(" ")} ${projectAliases.join(" ")} ${namesForIds(projectMembers).join(" ")}`,
      projectId: project.id, projectName: project.name, status: project.status, priority: project.priority, memberIds: projectMembers, labels: projectTags, aliases: projectAliases,
      createdAt: iso(project.createdAt), updatedAt: iso(project.updatedAt),
      dueDate: iso(project.targetDate),
      flags: unique([project.archived ? "archived" : "active", projectMembers.length ? "members" : null, project.libraryFolderId ? "attachment" : null, project.targetDate ? "due" : null]),
      facets: {
        id: [project.id], project: [project.id, project.name], status: [project.status], source: [project.source], priority: [project.priority], label: projectTags,
        member: [...projectMembers, ...namesForIds(projectMembers)],
      },
      raw: project,
    }));
    for (const record of project.controlRecords || []) {
      const payload = parseJson(record.payload) || {};
      const ownerName = record.ownerId ? userSearchName(usersById.get(String(record.ownerId))) : "";
      const projectTypeEntityKind = String(payload.projectTypeEntityKind || "");
      const projectTypeEntityLabel = String(payload.projectTypeEntityLabel || projectTypeEntityKind.replaceAll("_", " ") || "").trim();
      const payloadText = Object.values(payload).flatMap((value: any) => Array.isArray(value) ? value : [value]).filter((value: any) => ["string", "number", "boolean"].includes(typeof value)).join(" ");
      addItem(rows, base({
        id: record.id,
        kind: "control",
        title: record.title,
        detail: `${project.name} · ${projectTypeEntityLabel || String(record.kind || "control").replaceAll("_", " ")}`,
        text: `${record.description || ""} ${record.category || ""} ${record.status || ""} ${record.priority || ""} ${ownerName} ${projectTypeEntityKind} ${payload.projectTypeStage || ""} ${payloadText}`,
        projectId: project.id,
        projectName: project.name,
        ownerId: record.ownerId,
        memberIds: record.ownerId ? [record.ownerId] : [],
        status: record.status,
        priority: record.priority,
        dueDate: iso(record.dueDate),
        startDate: iso(record.startDate),
        createdAt: iso(record.createdAt),
        updatedAt: iso(record.updatedAt),
        categories: unique([record.kind, record.category, projectTypeEntityKind, payload.projectTypeStage]),
        flags: unique(["project", "control", projectTypeEntityKind ? "specialized" : null, record.dueDate ? "due" : null, record.ownerId ? "owner" : "unassigned", record.status === "blocked" ? "blocked" : null]),
        facets: {
          id: [record.id], project: [project.id, project.name], status: [record.status], priority: [record.priority], category: [record.kind, record.category],
          source: ["project-control", record.kind], owner: [record.ownerId, ownerName], member: [record.ownerId, ownerName],
        },
        raw: { ...record, projectControl: true },
      }));
    }
    for (const board of project.boards || []) {
      const boardLabelDefinitions = parseJson(board.labelDefinitions);
      const boardLabelNames = Array.isArray(boardLabelDefinitions) ? boardLabelDefinitions.map((label: any) => String(label?.name || "")).filter(Boolean) : [];
      addItem(rows, base({
      id: board.id, kind: "board", title: board.name, detail: project.name,
      text: `${board.description || ""} ${project.name} ${boardLabelNames.join(" ")}`,
      projectId: project.id, projectName: project.name, boardId: board.id, boardName: board.name,
      status: board.archived ? "archived" : "active", createdAt: iso(board.createdAt), updatedAt: iso(board.updatedAt),
      labels: boardLabelNames,
      flags: unique([board.archived ? "archived" : "active", "project", boardLabelNames.length ? "labels" : null]),
      facets: { id: [board.id], project: [project.id, project.name], board: [board.id, board.name], status: [board.archived ? "archived" : "active"], label: boardLabelNames },
      raw: board,
    }));
    }
    for (const whiteboard of project.whiteboards || []) {
      const categories = parseJson(whiteboard.categories);
      const categoryNames = Array.isArray(categories) ? categories.map((category: any) => String(category?.name || "")).filter(Boolean) : [];
      const whiteboardLabels = parseJson(whiteboard.labels);
      const whiteboardLabelNames = Array.isArray(whiteboardLabels) ? whiteboardLabels.map((label: any) => String(label?.name || "")).filter(Boolean) : [];
      addItem(rows, base({
        id: whiteboard.id, kind: "whiteboard", title: whiteboard.name, detail: project.name,
        text: `${whiteboard.description || ""} ${project.name} ${categoryNames.join(" ")} ${whiteboardLabelNames.join(" ")}`,
        projectId: project.id, projectName: project.name, whiteboardId: whiteboard.id,
        labels: whiteboardLabelNames, categories: categoryNames, createdAt: iso(whiteboard.createdAt), updatedAt: iso(whiteboard.updatedAt),
        flags: unique(["active", "project", categoryNames.length ? "category" : null, whiteboardLabelNames.length ? "labels" : null]),
        facets: { id: [whiteboard.id], project: [project.id, project.name], category: categoryNames, label: whiteboardLabelNames, status: ["active"] },
        raw: whiteboard,
      }));
      const categoryById = new Map(Array.isArray(categories) ? categories.map((category: any) => [String(category?.id || ""), String(category?.name || "")]) : []);
      const labelById = new Map(Array.isArray(whiteboardLabels) ? whiteboardLabels.map((label: any) => [String(label?.id || ""), String(label?.name || "")]) : []);
      for (const element of whiteboardElementText(whiteboard.elements)) {
        const elementCategory = element.categoryId ? categoryById.get(element.categoryId) || element.categoryId : null;
        const elementLabels = unique(element.labelIds.map((labelId: string) => labelById.get(labelId) || labelId));
        addItem(rows, base({
          id: `${whiteboard.id}:${element.id}`, kind: "whiteboard", title: element.title || "Whiteboard object",
          detail: `${project.name} · ${whiteboard.name}`, text: `${element.text} ${categoryNames.join(" ")} ${elementLabels.join(" ")} ${element.type}`,
          projectId: project.id, projectName: project.name, whiteboardId: whiteboard.id,
          labels: elementLabels, categories: unique([elementCategory]), createdAt: iso(whiteboard.createdAt), updatedAt: iso(whiteboard.updatedAt),
          flags: unique(["active", "project", elementCategory ? "category" : null, elementLabels.length ? "labels" : null, element.hasImage ? "image" : null]),
          facets: { id: [element.id], project: [project.id, project.name], category: unique([elementCategory]), label: elementLabels, status: ["active"], source: [element.type] },
          raw: whiteboard,
        }));
      }
    }
    for (const item of project.libraryItems || []) {
      const labels = parseJsonStrings(item.tags);
      const extension = String(item.originalName || "").split(".").at(-1) || "";
      addItem(rows, base({
        id: item.id, kind: "file", title: item.title, detail: `${project.name} · ${item.type || "library"}`,
        text: `${item.body || ""} ${item.previewText || ""} ${labels.join(" ")} ${item.originalName || ""} ${item.mimeType || ""}`,
        projectId: project.id, projectName: project.name, status: item.status, priority: item.priority,
        labels, categories: unique([item.type]), createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt),
        flags: unique(["project", labels.length ? "labels" : null, item.originalName ? "attachment" : null]),
        facets: {
          id: [item.id], project: [project.id, project.name], status: [item.status], priority: [item.priority], label: labels,
          category: [item.type], mime: [item.mimeType], ext: [extension], source: [item.type],
        },
        raw: item,
      }));
    }
  }

  const projectById = new Map(corpus.projects.map((project) => [String(project.id), project]));
  for (const record of corpus.deliveryRecords || []) {
    const projectId = String(record.projectId || "");
    const project = projectById.get(projectId);
    if (!projectId || !project || project.archived) continue;
    const deliveryKind = String(record.deliveryKind || "");
    const kind = deliveryKind === "build" ? "build" : deliveryKind === "release" ? "release" : "qa";
    const title = deliveryKind === "qa_session"
      ? `${record.build?.version || record.buildId || "Build"} · ${record.scope || "QA"}`
      : String(record.title || record.version || record.id);
    const status = String(record.decision && record.decision !== "pending" ? record.decision : record.approval || record.qaStatus || record.status || "active");
    const priority = String(record.priority || "");
    const labels = unique([record.channel, record.scope, record.platform, record.configuration, record.suite]);
    const text = [record.notes, record.changelog, record.body, ...(parseJsonStrings(record.features)), ...(parseJsonStrings(record.fixes)), ...(parseJsonStrings(record.knownIssues)), record.environment, record.sourceBranch, record.sourceRevision, record.buildNumber, record.checksum, record.platform, record.configuration, record.suite, record.scope, record.channel].filter(Boolean).join(" ");
    addItem(rows, base({
      id: String(record.id), kind, title, detail: `${project.name} · ${deliveryKind.replaceAll("_", " ")}`, text,
      projectId, projectName: project.name, status, priority,
      createdAt: iso(record.createdAt), updatedAt: iso(record.updatedAt), dueDate: iso(record.dueDate || record.expiresAt),
      labels, categories: unique([deliveryKind, record.scope, record.channel, record.platform, record.configuration, record.suite]),
      flags: unique(["project", deliveryKind, record.artifactUrl ? "attachment" : null, record.sourceRevision ? "revision" : null, record.signed ? "signed" : null, status]),
      facets: {
        id: [record.id], project: [projectId, project.name], status: [status], priority: [priority], category: [deliveryKind, record.scope, record.channel, record.platform, record.configuration, record.suite],
        source: [deliveryKind], label: labels, build: [record.build?.version, record.buildId, record.version, record.buildNumber], commit: [record.sourceRevision], platform: [record.platform],
      },
      raw: { ...record, deliveryKind },
    }));
  }

  for (const review of corpus.sourceReviews || []) {
    const project = projectById.get(String(review.projectId || ""));
    // The Project Source tab loads only its canonical active binding, ordered
    // by primary preference and creation date. Never index an inaccessible
    // secondary repository's review as though this tab could open it.
    const binding = review.project?.sourceBindings?.[0];
    if (!project || project.archived || !review.repository || review.repository.archived ||
      !binding || String(binding.repositoryId) !== String(review.repositoryId)) continue;
    const status = String(review.status || "open");
    addItem(rows, base({
      id: String(review.id), kind: "source_review", title: String(review.title || "Source review"),
      detail: `${project.name} · ${review.repository.name} · ${status}`,
      text: `${review.description || ""} ${review.sourceBranch || ""} ${review.targetBranch || ""} ${review.repository.name || ""}`,
      projectId: String(project.id), projectName: project.name, status,
      createdAt: iso(review.createdAt), updatedAt: iso(review.updatedAt),
      categories: ["source review"], flags: ["project", "source-control", status],
      facets: { id: [review.id], project: [project.id, project.name],
        status: [status], source: ["source-review"], category: ["source review"],
        repository: [review.repositoryId, review.repository.name] },
      raw: review,
    }));
  }

  for (const commit of corpus.sourceCommits || []) {
    const project = projectById.get(String(commit.projectId || ""));
    const binding = commit.binding;
    if (!project || project.archived || !commit.repository || commit.repository.archived ||
        !binding || String(binding.repositoryId) !== String(commit.repositoryId)) continue;
    const headline = String(commit.message || "").split("\n")[0].trim();
    addItem(rows, base({
      // Repository commits may appear in multiple Project Source tabs; never
      // deduplicate or navigate using the repository-global commit ID alone.
      id: `${project.id}:${commit.id}`, kind: "source_commit",
      title: headline || String(commit.shortRevision || commit.revision || "Source commit"),
      detail: `${project.name} · ${commit.repository.name} · ${commit.shortRevision || commit.revision}`,
      text: `${commit.message || ""} ${commit.revision || ""} ${commit.authorName || ""} ${commit.repository.name || ""}`,
      projectId: String(project.id), projectName: project.name,
      createdAt: iso(commit.committedAt || commit.createdAt), updatedAt: iso(commit.updatedAt),
      categories: ["source commit"], flags: ["project", "source-control"],
      facets: { id: [commit.id, commit.revision], project: [project.id, project.name],
        source: ["source-commit"], category: ["source commit"],
        repository: [commit.repositoryId, commit.repository.name], commit: [commit.revision, commit.shortRevision] },
      raw: commit,
    }));
  }

  // Never index personally identifying submission fields or response content.
  // Both kinds are restricted to Studio administrators at query time.
  for (const form of corpus.studioForms || []) {
    addItem(rows, base({ id: String(form.id), kind: "studio_form", title: String(form.title),
      detail: `Studio form · ${form.purpose} · ${form.status}`, text: String(form.key || ""),
      status: String(form.status), createdAt: iso(form.createdAt), updatedAt: iso(form.updatedAt),
      categories: ["studio form"], flags: ["studio-systems"],
      facets: { id: [form.id], status: [form.status], category: [form.purpose], source: ["studio-form"] },
      raw: { id: form.id, key: form.key, title: form.title, purpose: form.purpose, status: form.status, updatedAt: form.updatedAt, createdAt: form.createdAt },
    }));
  }
  for (const submission of corpus.formSubmissions || []) {
    if (!submission.form || submission.form.purpose === "application") continue;
    addItem(rows, base({ id: String(submission.id), kind: "form_submission",
      title: `Response to ${submission.form.title}`,
      detail: `Form review · ${submission.status}`, text: "",
      status: String(submission.status), createdAt: iso(submission.submittedAt), updatedAt: iso(submission.updatedAt),
      categories: ["form submission"], flags: ["studio-systems"],
      facets: { id: [submission.id], status: [submission.status], source: ["form-submission"] },
      raw: { id: submission.id, formId: submission.formId, status: submission.status,
        submittedAt: submission.submittedAt, updatedAt: submission.updatedAt,
        form: { id: submission.form.id, title: submission.form.title,
          purpose: submission.form.purpose, status: submission.form.status, updatedAt: submission.form.updatedAt } },
    }));
  }

  // Persisted approvals are global resources. Project context in the request
  // does not grant a different Search scope. No payload/PII is indexed.
  for (const approval of corpus.approvalRequests || []) {
    if (approval.kind !== "approvalRequest" || approval.archived || approval.deletedAt) continue;
    addItem(rows, base({
      id: String(approval.id), kind: "approval", title: String(approval.title || "Approval request"),
      detail: `Approval · ${String(approval.status || "pending")}`, text: "",
      status: String(approval.status || "pending"), createdAt: iso(approval.createdAt), updatedAt: iso(approval.updatedAt),
      categories: ["approval"], flags: ["governance"],
      facets: { id: [String(approval.id)], status: [String(approval.status || "pending")], source: ["approval"] },
      raw: { id: approval.id, kind: approval.kind, title: approval.title, status: approval.status, updatedAt: approval.updatedAt },
    }));
  }

  for (const user of corpus.users) {
    const workforce = workforceAuthorityProjection(user);
    const skills = workforce.skills;
    const preferences = (parseJson(user.preferences) && typeof parseJson(user.preferences) === "object") ? parseJson(user.preferences) : {};
    const showEmail = preferences.profileShowEmail === true;
    const showPhone = preferences.profileShowPhone === true;
    const showTimezone = preferences.profileShowTimezone !== false;
    const showStatus = preferences.profileShowStatus !== false;
    const visibleLocation = user.hideLocation ? null : workforce.workLocation;
    const visibleEmail = showEmail ? user.email : null;
    const visiblePhone = showPhone ? user.phoneNumber : null;
    const visibleTimezone = showTimezone ? workforce.timezone : null;
    const visibleStatus = showStatus ? workforce.status : null;
    const visibleStatusMessage = showStatus ? workforce.statusMessage : null;
    const roles = unique([workforce.title, ...(user.memberships || []).map((membership: any) => membership.role), user.accountType]);
    const title = userSearchName(user);
    addItem(rows, base({
      id: user.id, kind: "person", title,
      detail: [workforce.title, workforce.department, workforce.teamName, visibleEmail].filter(Boolean).slice(0, 2).join(" · ") || "Person",
      text: `${user.preferredName || ""} ${user.username || ""} ${visibleEmail || ""} ${visiblePhone || ""} ${workforce.title || ""} ${workforce.department || ""} ${workforce.teamName || ""} ${skills.join(" ")} ${workforce.managerName || ""} ${visibleLocation || ""} ${visibleTimezone || ""} ${visibleStatusMessage || ""} ${roles.join(" ")}`,
      ownerId: user.id, authorIds: [user.id], status: visibleStatus, avatarUrl: user.avatarUrl,
      department: workforce.department, teamName: workforce.teamName, roleName: workforce.title || roles[0] || null,
      presence: visibleStatus, location: visibleLocation, timezone: visibleTimezone,
      createdAt: iso(user.createdAt), updatedAt: iso(user.updatedAt),
      flags: unique([user.archived ? "archived" : "active", visibleStatus === "offline" ? "offline" : visibleStatus ? "online" : null, visibleEmail ? "email" : null, skills.length ? "skills" : null]),
      facets: {
        id: unique([user.id, user.username]), author: unique([user.id, title, user.username]), status: unique([visibleStatus]), presence: unique([visibleStatus]),
        department: unique([workforce.department]), team: unique([workforce.teamName]), role: roles, skill: skills, manager: unique([workforce.managerName]),
        location: unique([visibleLocation]), timezone: unique([visibleTimezone]), account: unique([user.accountType, ...roles]),
      },
      raw: user,
    }));
  }

  for (const card of corpus.cards) {
    const project = card.list?.board?.project;
    const board = card.list?.board;
    if (!project || !board || project.archived || board.archived || card.list?.archived) continue;
    const memberIds = parseJsonStrings(card.memberIds);
    const watcherIds = parseJsonStrings(card.watcherIds);
    const labels = unique(parseJsonStrings(card.labels));
    const memberNames = namesForIds(memberIds);
    const watcherNames = namesForIds(watcherIds);
    const assigneeName = card.assignee?.displayName || card.assignee?.preferredName || card.assignee?.username || null;
    const status = card.archived ? "archived" : card.workItemKind === "ticket" ? String(card.ticketStage || "new") : card.list?.isDone ? "done" : "open";
    addItem(rows, base({
      id: card.id, kind: card.workItemKind === "ticket" ? "ticket" : "card", title: card.title, detail: `${project.name} · ${board.name} · ${card.list.title}`,
      text: `${card.description || ""} ${labels.join(" ")} ${card.category || ""} ${card.priority || ""} ${assigneeName || ""} ${memberNames.join(" ")} ${watcherNames.join(" ")}`,
      projectId: project.id, projectName: project.name, boardId: board.id, boardName: board.name, listName: card.list.title, cardId: card.id,
      assigneeId: card.assigneeId, assigneeName, memberIds, watcherIds, status, priority: card.priority,
      dueDate: iso(card.dueDate), startDate: iso(card.startDate), createdAt: iso(card.createdAt), updatedAt: iso(card.updatedAt),
      labels, categories: unique([card.category]),
      flags: unique([
        card.archived ? "archived" : "active", status, project.id ? "project" : null,
        card.assigneeId ? "assignee" : null, memberIds.length ? "members" : null, watcherIds.length ? "watchers" : null,
        labels.length ? "labels" : null, card.category ? "category" : null, card.dueDate ? "due" : null, card.startDate ? "start" : null,
        card.coverColor || card.coverImage ? "cover" : null, card.coverImage ? "image" : null,
        Number(card._count?.comments || 0) > 0 ? "comments" : null, Number(card._count?.checklistItems || 0) > 0 ? "checklist" : null,
        card.externalUrl ? "attachment" : null,
      ]),
      facets: {
        id: [card.id], project: [project.id, project.name], board: [board.id, board.name], list: [card.list.id, card.list.title],
        status: [status], priority: [card.priority], assignee: unique([card.assigneeId, assigneeName]),
        member: [...memberIds, ...memberNames], watcher: [...watcherIds, ...watcherNames], label: labels, category: unique([card.category]), source: unique([card.externalUrl ? "external" : null]),
      },
      raw: card,
    }));
  }

  for (const timeline of corpus.timelineItems) {
    const authorName = userSearchName(timeline.user);
    addItem(rows, base({
      id: timeline.id, kind: "timeline", title: timeline.title,
      detail: `${timeline.project?.name || "Personal"} · ${timeline.type || "timeline"}`,
      text: `${timeline.description || ""} ${timeline.project?.name || ""} ${authorName} ${timeline.source || ""}`,
      projectId: timeline.projectId, projectName: timeline.project?.name || null, ownerId: timeline.userId, authorIds: unique([timeline.userId]),
      status: new Date(timeline.endsAt || timeline.startsAt).getTime() < Date.now() ? "past" : "upcoming",
      dueDate: iso(timeline.endsAt || timeline.startsAt), startDate: iso(timeline.startsAt), endDate: iso(timeline.endsAt),
      createdAt: iso(timeline.createdAt), updatedAt: iso(timeline.updatedAt),
      flags: unique([timeline.projectId ? "project" : null, timeline.userId ? "assignee" : null, "start", timeline.endsAt ? "due" : null]),
      facets: { id: [timeline.id], project: [timeline.projectId, timeline.project?.name], author: [timeline.userId, authorName], assignee: [timeline.userId, authorName], status: ["upcoming"], source: [timeline.source, timeline.type] },
      raw: timeline,
    }));
  }

  for (const event of corpus.calendarEvents) {
    const attendees = parseJsonStrings(event.attendeeIds);
    addItem(rows, base({
      id: event.id, kind: "calendar", title: event.title,
      detail: `${event.project?.name || "Workspace"} · ${event.eventType || "event"}`,
      text: `${event.description || ""} ${event.location || ""} ${event.status || ""} ${event.project?.name || ""} ${namesForIds(attendees).join(" ")}`,
      projectId: event.projectId, projectName: event.project?.name || null, ownerId: event.ownerId, authorIds: unique([event.ownerId]), memberIds: attendees,
      status: event.status, dueDate: iso(event.startsAt), startDate: iso(event.startsAt), endDate: iso(event.endsAt),
      createdAt: iso(event.createdAt), updatedAt: iso(event.updatedAt),
      flags: unique([event.projectId ? "project" : null, event.ownerId ? "assignee" : null, attendees.length ? "members" : null, "start", event.endsAt ? "due" : null]),
      facets: { id: [event.id], project: [event.projectId, event.project?.name], status: [event.status], source: [event.source, event.eventType], author: [event.ownerId], member: [...attendees, ...namesForIds(attendees)], location: [event.location] },
      raw: event,
    }));
  }

  for (const comment of corpus.cardComments) {
    const card = comment.card;
    const board = card?.list?.board;
    const project = board?.project;
    if (!project || !board || project.archived || board.archived || card.archived) continue;
    const authorName = userSearchName(comment.user);
    addItem(rows, base({
      id: comment.id, kind: "comment", title: comment.body.slice(0, 110),
      detail: `${project.name} · ${card.title} · ${authorName}`,
      text: `${comment.body} ${card.title} ${board.name} ${project.name} ${authorName}`,
      projectId: project.id, projectName: project.name, boardId: board.id, boardName: board.name, listName: card.list.title, cardId: card.id,
      ownerId: comment.userId, authorIds: unique([comment.userId]), createdAt: iso(comment.createdAt), updatedAt: iso(comment.createdAt),
      flags: unique(["project", "comments"]),
      facets: { id: [comment.id], project: [project.id, project.name], board: [board.id, board.name], list: [card.list.id, card.list.title], author: [comment.userId, authorName], status: ["active"] },
      raw: comment,
    }));
  }

  for (const activity of corpus.activityEvents) {
    if (!activity.projectId || !activity.project) continue;
    const authorName = userSearchName(activity.user);
    addItem(rows, base({
      id: activity.id, kind: "activity", title: activity.title,
      detail: `${activity.project.name} · ${authorName || activity.type}`,
      text: `${activity.message || ""} ${activity.type || ""} ${activity.entityType || ""} ${activity.project.name} ${authorName}`,
      projectId: activity.projectId, projectName: activity.project.name, boardId: activity.boardId, cardId: activity.cardId,
      whiteboardId: activity.whiteboardId, ownerId: activity.userId, authorIds: unique([activity.userId]), status: activity.type,
      createdAt: iso(activity.createdAt), updatedAt: iso(activity.createdAt),
      flags: unique(["project"]),
      facets: { id: [activity.id], project: [activity.projectId, activity.project.name], board: [activity.boardId], status: [activity.type], source: [activity.entityType], author: [activity.userId, authorName] },
      raw: activity,
    }));
  }

  for (const file of corpus.projectFiles) {
    if (!file.project || file.project.archived) continue;
    const extension = String(file.originalName || file.fileName || "").split(".").at(-1) || "";
    addItem(rows, base({
      id: file.id, kind: "file", title: file.title || file.originalName,
      detail: `${file.project.name} · ${file.category || "project file"} · ${file.assetRole || "source"} · ${file.versionLabel || `v${file.versionNumber || 1}`}`,
      text: `${file.description || ""} ${file.originalName || ""} ${file.fileName || ""} ${file.mimeType || ""} ${file.assetRole || ""} ${file.versionLabel || ""} ${String(file.tags || "").replace(/[\[\]"{},]/g, " ")}`,
      projectId: file.projectId, projectName: file.project.name, status: file.status || "active",
      categories: unique([file.category, file.assetRole]), createdAt: iso(file.createdAt), updatedAt: iso(file.updatedAt),
      flags: unique(["project", "attachment", file.mimeType?.startsWith?.("image/") ? "image" : null, file.category ? "category" : null, file.duplicateOfId ? "duplicate" : null, file.lockedById ? "locked" : null]),
      facets: { id: [file.id], project: [file.projectId, file.project.name], status: [file.status || "active"], category: [file.category, file.assetRole], mime: [file.mimeType], ext: [extension], source: ["project-file"], version: [file.versionLabel, String(file.versionNumber || 1)] },
      raw: { ...file, sizeBytes: Number(file.sizeBytes || 0) },
    }));
  }

  for (const video of corpus.videoAssets) {
    if (!video.project || video.project.archived) continue;
    const extension = String(video.originalName || video.fileName || "").split(".").at(-1) || "";
    addItem(rows, base({
      id: video.id, kind: "file", title: video.title || video.originalName,
      detail: `${video.project.name} · ${video.pool || "video"}`,
      text: `${video.description || ""} ${video.originalName || ""} ${video.fileName || ""} ${video.platform || ""} ${video.versionLabel || ""}`,
      projectId: video.projectId, projectName: video.project.name, status: video.status, dueDate: iso(video.dueDate),
      categories: unique([video.pool, video.platform]), createdAt: iso(video.createdAt), updatedAt: iso(video.updatedAt),
      flags: unique(["project", "attachment", "video", video.dueDate ? "due" : null]),
      facets: { id: [video.id], project: [video.projectId, video.project.name], status: [video.status], category: [video.pool, video.platform], mime: [video.mimeType], ext: [extension], source: ["review_asset"] },
      raw: video,
    }));
  }

  const relationshipMap = new Map<string, any[]>();
  const addRelationship = (kind: string, id: string, relationship: any) => {
    const key = `${kind}:${id}`;
    const current = relationshipMap.get(key) || [];
    current.push(relationship);
    relationshipMap.set(key, current);
  };
  for (const definition of corpus.packetDefinitions || []) {
    const folder = definition.libraryFolder || {};
    addItem(rows, base({
      id: String(definition.libraryFolderId || folder.id),
      kind: "packet",
      title: String(folder.title || "Packet"),
      detail: `Packet · v${definition.versionLabel || "1.0"}${definition.required ? " · Required" : ""}`,
      text: `${folder.body || ""} ${folder.previewText || ""} ${folder.originalName || ""} ${definition.kind || ""} ${definition.completionMode || ""}`,
      status: definition.required ? "required" : "optional",
      createdAt: iso(definition.createdAt || folder.createdAt),
      updatedAt: iso(definition.updatedAt || folder.updatedAt),
      categories: unique([definition.kind, "packet"]),
      flags: unique([definition.required ? "required" : "optional", definition.recertifyDays ? "recertification" : null, definition.recordCompletion ? "personnel-record-evidence" : null]),
      facets: { id: [String(definition.libraryFolderId || folder.id)], status: [definition.required ? "required" : "optional"], source: ["packet"], category: unique([definition.kind]) },
      raw: { ...definition, libraryFolder: folder },
    }));
  }

  for (const policy of corpus.studioPolicies || []) {
    const version = policy.versions?.[0] || null;
    if (!version) continue;
    addItem(rows, base({
      id: String(policy.id),
      kind: "policy",
      title: String(policy.title || "Policy"),
      detail: `Policy · ${version.versionLabel || `v${version.version || 1}`} · ${String(version.acceptanceMode || "acknowledge").replaceAll("_", " ")}`,
      text: `${policy.summary || ""} ${version.bodyMarkdown || ""} ${version.versionLabel || ""} ${version.acceptanceMode || ""}`,
      status: policy.requiredForAccess ? "required-for-access" : "active",
      createdAt: iso(policy.createdAt),
      updatedAt: iso(version.updatedAt || policy.updatedAt),
      categories: ["policy"],
      flags: unique([policy.requiredForAccess ? "required-for-access" : "required-reading", policy.recordAcceptance ? "personnel-record-evidence" : null]),
      facets: { id: [String(policy.id)], status: [policy.requiredForAccess ? "required-for-access" : "active"], source: ["policy"], category: ["policy"] },
      raw: policy,
    }));
  }

  for (const relationship of corpus.projectRelationships || []) {
    addRelationship(String(relationship.sourceType), String(relationship.sourceId), relationship);
    addRelationship(String(relationship.targetType), String(relationship.targetId), relationship);
  }
  const relationshipKeys = (item: SearchIndexItem) => {
    if (item.kind === "card") return [`card:${item.id}`, `ticket:${item.id}`];
    if (item.kind === "file") return [`file:${item.id}`, `library:${item.id}`];
    if (item.kind === "qa") return [`qa_plan:${item.id}`, `qa_session:${item.id}`];
    if (item.kind === "person") return [`user:${item.id}`];
    return [`${item.kind}:${item.id}`];
  };
  // Every Project-scoped match carries its indexed Project revision. A change
  // to the parent (archive/name/access context) invalidates the child result
  // until the Search index catches up, even when the child itself is unchanged.
  for (const item of rows) if (item.projectId) {
    item.projectUpdatedAt = iso(projectById.get(String(item.projectId))?.updatedAt);
  }
  const rowByRelationshipKey = new Map<string, SearchIndexItem>();
  for (const item of rows) for (const key of relationshipKeys(item)) if (!rowByRelationshipKey.has(key)) rowByRelationshipKey.set(key, item);
  for (const item of rows) {
    const itemKeys = new Set(relationshipKeys(item));
    const relationships = [...new Map([...itemKeys].flatMap((key) => relationshipMap.get(key) || []).map((relationship) => [String(relationship.id), relationship])).values()];
    if (!relationships.length) continue;
    const labels = unique(relationships.map((relationship) => String(relationship.relationship || "").replaceAll("_", " "))).slice(0, 8);
    const blockers = relationships.filter((relationship) => CLUSTER_WORKFLOW_RELATIONSHIP_META[String(relationship.relationship) as ClusterWorkflowRelationship]?.blocking).length;
    const critical = relationships.filter((relationship) => Boolean(relationship.critical)).length;
    const linkedTitles = unique(relationships.map((relationship) => {
      const sourceKey = `${String(relationship.sourceType)}:${String(relationship.sourceId)}`;
      const targetKey = `${String(relationship.targetType)}:${String(relationship.targetId)}`;
      const oppositeKey = itemKeys.has(sourceKey) ? targetKey : sourceKey;
      return rowByRelationshipKey.get(oppositeKey)?.title || "";
    })).slice(0, 12);
    item.relationshipSummary = { total: relationships.length, blockers, critical, labels: labels.slice(0, 4) };
    item.relationshipTerms = unique(["linked", "linked work", ...labels, ...linkedTitles, blockers ? "blocker blocked dependency" : null, critical ? "critical" : null]);
    item.flags = unique([...item.flags, "linked", blockers ? "blocked" : null, critical ? "critical-link" : null]);
    item.facets.relationship = unique([...labels, ...linkedTitles]);
    item.facets.linked = linkedTitles;
    item.normalizedText = normalize(`${item.normalizedText} ${item.relationshipTerms.join(" ")}`);
    item.tokens = [...new Set(tokenize(item.normalizedText, 140))];
  }

  return { loadedAt: Date.now(), corpus, items: rows, postings: buildPostings(rows) };
}

export function buildPostings(items: SearchIndexItem[]) {
  const postings = new Map<string, Set<number>>();
  items.forEach((item, index) => {
    for (const token of item.tokens) {
      const keys = new Set([token]);
      for (let length = 2; length <= Math.min(8, token.length); length += 1) keys.add(token.slice(0, length));
      if (token.length >= 4) for (let index = 0; index < token.length - 1; index += 1) keys.add(`~${token.slice(index, index + 2)}`);
      for (const key of keys) {
        const posting = postings.get(key) || new Set<number>();
        posting.add(index);
        postings.set(key, posting);
      }
    }
  });
  return postings;
}

export function mergeProjectCorpus(current: SearchCorpus, incoming: SearchCorpus, projectId: string): SearchCorpus {
  const keep = (value: any) => String(value || "") !== projectId;
  return {
    projects: [...current.projects.filter((row) => keep(row.id)), ...incoming.projects],
    users: current.users,
    cards: [...current.cards.filter((row) => keep(row.list?.board?.projectId)), ...incoming.cards],
    timelineItems: [...current.timelineItems.filter((row) => keep(row.projectId)), ...incoming.timelineItems],
    calendarEvents: [...current.calendarEvents.filter((row) => keep(row.projectId)), ...incoming.calendarEvents],
    cardComments: [...current.cardComments.filter((row) => keep(row.card?.list?.board?.projectId)), ...incoming.cardComments],
    activityEvents: [...current.activityEvents.filter((row) => keep(row.projectId)), ...incoming.activityEvents],
    projectFiles: [...current.projectFiles.filter((row) => keep(row.projectId)), ...incoming.projectFiles],
    videoAssets: [...current.videoAssets.filter((row) => keep(row.projectId)), ...incoming.videoAssets],
    deliveryRecords: [...current.deliveryRecords.filter((row) => keep(row.projectId)), ...incoming.deliveryRecords],
    sourceReviews: [...current.sourceReviews.filter((row) => keep(row.projectId)), ...incoming.sourceReviews],
    sourceCommits: [...(current.sourceCommits || []).filter((row) => keep(row.projectId)), ...(incoming.sourceCommits || [])],
    projectRelationships: [...current.projectRelationships.filter((row) => keep(row.projectId)), ...incoming.projectRelationships],
    packetDefinitions: current.packetDefinitions,
    studioPolicies: current.studioPolicies,
    studioForms: current.studioForms,
    formSubmissions: current.formSubmissions,
    approvalRequests: current.approvalRequests,
    // Project refreshes are partial. Keep global and unrelated project ACLs,
    // and replace only this project's set (including an empty/deleted set).
    accessRules: [
      ...current.accessRules.filter((rule: any) =>
        String(rule.projectId || "") !== projectId &&
        !(rule.targetKind === "project" && String(rule.targetId || "") === projectId)),
      ...incoming.accessRules,
    ],
    diagnostics: current.diagnostics,
  };
}

