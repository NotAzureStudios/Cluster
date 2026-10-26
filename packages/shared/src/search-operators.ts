export type CommandSearchOperatorDefinition = {
  key: string;
  aliases: string[];
  label: string;
  description: string;
  example: string;
  values?: string[];
  group: "scope" | "people" | "work" | "dates" | "content" | "state";
};

export const COMMAND_SEARCH_OPERATOR_DEFINITIONS: CommandSearchOperatorDefinition[] = [
  { key: "type", aliases: ["kind", "in"], label: "Type", description: "Limit results to one or more result types.", example: "type:card,comment", values: ["project", "board", "card", "whiteboard", "file", "person", "timeline", "calendar", "comment", "activity", "control", "build", "qa", "release"], group: "scope" },
  { key: "project", aliases: ["proj"], label: "Project", description: "Match a project name or ID.", example: "project:cluster", group: "scope" },
  { key: "board", aliases: [], label: "Board", description: "Match a board name or ID.", example: "board:production", group: "scope" },
  { key: "list", aliases: ["column", "lane"], label: "List", description: "Match a board list or lane.", example: "list:review", group: "scope" },
  { key: "id", aliases: [], label: "ID", description: "Match an exact or partial record ID.", example: "id:cm4", group: "scope" },

  { key: "assignee", aliases: ["assigned", "owner"], label: "Assignee", description: "Find work assigned to a person. Use me for yourself.", example: "assignee:me", group: "people" },
  { key: "member", aliases: ["members"], label: "Member", description: "Find cards containing a specific member.", example: "member:duckey", group: "people" },
  { key: "watcher", aliases: ["watching", "subscriber"], label: "Watcher", description: "Find work watched by a person.", example: "watcher:me", group: "people" },
  { key: "author", aliases: ["by", "creator"], label: "Author", description: "Find comments, events, or records created by a person.", example: "author:alex", group: "people" },
  { key: "department", aliases: ["dept"], label: "Department", description: "Find team members in a department.", example: "department:engineering", group: "people" },
  { key: "team", aliases: ["squad"], label: "Team", description: "Find team members by team name.", example: "team:gameplay", group: "people" },
  { key: "role", aliases: ["title", "job"], label: "Role", description: "Find team members by workspace role or job title.", example: "role:producer", group: "people" },
  { key: "skill", aliases: ["skills"], label: "Skill", description: "Find team members by skill.", example: "skill:unreal", group: "people" },
  { key: "manager", aliases: ["reports-to"], label: "Manager", description: "Find people reporting to a manager.", example: "manager:casey", group: "people" },
  { key: "location", aliases: ["where"], label: "Location", description: "Find people by work location.", example: "location:remote", group: "people" },
  { key: "timezone", aliases: ["tz"], label: "Timezone", description: "Find people by timezone.", example: "timezone:eastern", group: "people" },
  { key: "presence", aliases: ["availability"], label: "Presence", description: "Find people by current presence state.", example: "presence:available", values: ["available", "busy", "focus", "away", "offline"], group: "people" },
  { key: "account", aliases: ["account-type"], label: "Account", description: "Find people by account type.", example: "account:contractor", group: "people" },

  { key: "status", aliases: ["state"], label: "Status", description: "Match a workflow or presence status.", example: "status:open", group: "work" },
  { key: "priority", aliases: ["prio"], label: "Priority", description: "Match a priority value.", example: "priority:urgent", values: ["urgent", "high", "medium", "low", "none"], group: "work" },
  { key: "label", aliases: ["tag"], label: "Label", description: "Match card labels or Library tags.", example: "label:bug", group: "work" },
  { key: "category", aliases: ["cat"], label: "Category", description: "Match a card, file, or Whiteboard category.", example: "category:reference", group: "work" },
  { key: "source", aliases: ["origin"], label: "Source", description: "Match the source or integration that created a record.", example: "source:git", group: "work" },
  { key: "relationship", aliases: ["link", "linked"], label: "Relationship", description: "Match linked-work relationship types or linked item titles.", example: "relationship:blocks", group: "work" },

  { key: "has", aliases: ["with"], label: "Has", description: "Require a field or capability.", example: "has:due", values: ["due", "start", "assignee", "members", "watchers", "labels", "category", "comments", "checklist", "cover", "image", "attachment", "project", "linked"], group: "content" },
  { key: "missing", aliases: ["without"], label: "Missing", description: "Require a field to be absent.", example: "missing:assignee", values: ["due", "start", "assignee", "members", "watchers", "labels", "category", "comments", "checklist", "cover", "project"], group: "content" },
  { key: "mime", aliases: ["content-type"], label: "MIME", description: "Match a file MIME type.", example: "mime:image", group: "content" },
  { key: "ext", aliases: ["extension"], label: "Extension", description: "Match a file extension.", example: "ext:pdf", group: "content" },

  { key: "is", aliases: [], label: "State", description: "Apply a common state shortcut.", example: "is:overdue", values: ["mine", "assigned", "unassigned", "open", "done", "active", "archived", "overdue", "due-today", "due-soon", "watched", "member", "online", "offline", "recent", "stale", "blocked"], group: "state" },
  { key: "before", aliases: [], label: "Before", description: "Updated before a date.", example: "before:2026-08-01", group: "dates" },
  { key: "after", aliases: [], label: "After", description: "Updated after a date.", example: "after:7d", group: "dates" },
  { key: "updated", aliases: ["modified"], label: "Updated", description: "Updated on or after a date.", example: "updated:thisweek", group: "dates" },
  { key: "created", aliases: [], label: "Created", description: "Created on or after a date.", example: "created:30d", group: "dates" },
  { key: "due", aliases: [], label: "Due", description: "Due by a date or named window.", example: "due:thisweek", values: ["today", "tomorrow", "thisweek", "nextweek", "overdue", "none"], group: "dates" },
  { key: "start", aliases: ["starts"], label: "Starts", description: "Starts on or before a date.", example: "start:nextweek", group: "dates" },
  { key: "end", aliases: ["ends"], label: "Ends", description: "Ends on or before a date.", example: "end:thismonth", group: "dates" },
  { key: "sort", aliases: ["order"], label: "Sort", description: "Choose result ordering.", example: "sort:recent", values: ["relevance", "recent", "oldest", "title", "due", "priority"], group: "state" },
];

export const COMMAND_SEARCH_OPERATOR_ALIASES: Record<string, string> = Object.fromEntries(
  COMMAND_SEARCH_OPERATOR_DEFINITIONS.flatMap((definition) => [
    [definition.key, definition.key],
    ...definition.aliases.map((alias) => [alias, definition.key]),
  ]),
);

export const COMMAND_SEARCH_KNOWN_OPERATORS = new Set(COMMAND_SEARCH_OPERATOR_DEFINITIONS.map((definition) => definition.key));
