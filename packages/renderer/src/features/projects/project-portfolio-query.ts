import type { Project } from "../application/application-models";

export type ProjectPortfolioQueryContext = {
  project: Project;
  text: string;
  memberText: string;
  status: string;
  source: string;
  type: string;
  pinned: boolean;
  hasGit: boolean;
  hasDiscord: boolean;
  boardCount: number;
  whiteboardCount: number;
  overdue: boolean;
};

function tokens(value: string) {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((token) => token.replace(/^"|"$/g, "")) || [];
}

export function matchesProjectPortfolioQuery(query: string, context: ProjectPortfolioQueryContext) {
  const haystack = `${context.text} ${context.memberText}`.toLowerCase();
  return tokens(query.trim()).every((rawToken) => {
    const token = rawToken.toLowerCase();
    const separator = token.indexOf(":");
    if (separator < 1) return haystack.includes(token);
    const key = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (!value) return true;
    if (key === "tag") return (context.project.tags || []).some((tag) => tag.toLowerCase().includes(value));
    if (["owner", "member", "team"].includes(key)) return context.memberText.toLowerCase().includes(value);
    if (key === "status") return context.status.includes(value);
    if (key === "priority") return String(context.project.priority || "medium").toLowerCase().includes(value);
    if (key === "type") return context.type.toLowerCase().includes(value);
    if (key === "source") return context.source.toLowerCase().includes(value);
    if (["client", "stakeholder"].includes(key)) return String(context.project.clientName || "internal").toLowerCase().includes(value);
    if (key === "is") {
      if (value === "pinned") return context.pinned;
      if (value === "overdue") return context.overdue;
      if (value === "unscheduled") return !context.project.targetDate;
      if (value === "archived") return Boolean(context.project.archived);
    }
    if (key === "has") {
      if (["git", "repo"].includes(value)) return context.hasGit;
      if (value === "discord") return context.hasDiscord;
      if (value === "board") return context.boardCount > 0;
      if (value === "whiteboard") return context.whiteboardCount > 0;
      if (value === "target") return Boolean(context.project.targetDate);
      if (value === "objective") return Boolean(context.project.objective);
    }
    return haystack.includes(rawToken.toLowerCase());
  });
}
