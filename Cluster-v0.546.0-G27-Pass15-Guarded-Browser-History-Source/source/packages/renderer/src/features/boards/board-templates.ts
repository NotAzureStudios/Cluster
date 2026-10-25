export type BoardTemplateId = "blank" | "project-default" | "kanban" | "meeting" | "production" | "content";

export const BOARD_TEMPLATES: Array<{ id: BoardTemplateId; label: string; description: string; columns?: string[] }> = [
  { id: "blank", label: "Blank board", description: "Start with an empty Board. Add Lists only when you need them.", columns: [] },
  { id: "project-default", label: "Project default", description: "Use the workflow configured for this project type." },
  { id: "kanban", label: "Kanban", description: "A clean Trello-style flow for everyday work.", columns: ["Backlog", "Ready", "Doing", "Review", "Done"] },
  { id: "meeting", label: "Meeting", description: "Plan a focused team session with agenda, decisions, and follow-up work.", columns: ["Agenda", "In discussion", "Action items", "Review", "Done"] },
  { id: "production", label: "Game production", description: "Move features and assets from design through release.", columns: ["Backlog", "Design", "Development", "QA", "Release"] },
  { id: "content", label: "Content pipeline", description: "Track creative work from idea to publication.", columns: ["Ideas", "Planned", "Creating", "Review", "Published"] },
];

export function boardTemplateColumns(id: BoardTemplateId) {
  return BOARD_TEMPLATES.find((template) => template.id === id)?.columns;
}
