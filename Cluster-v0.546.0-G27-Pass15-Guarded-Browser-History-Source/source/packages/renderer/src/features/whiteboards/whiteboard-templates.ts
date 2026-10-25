import type { WhiteboardConnectorElement, WhiteboardElement, WhiteboardShapeElement, WhiteboardShapeType } from "../application/application-models";

export type WhiteboardTemplate = "flow" | "loop" | "system" | "dialogue" | "wireframe" | "mindmap" | "roadmap" | "sequence" | "er";

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function flowTemplateElement(type: WhiteboardShapeType, x: number, y: number, width: number, height: number, text: string, stroke = "#2563eb", fill = "#eff6ff"): WhiteboardShapeElement {
  return { id: makeId(), type, x, y, width, height, text, stroke, strokeWidth: 3, fill, textColor: "#0f172a" };
}

export function flowTemplateArrow(x1: number, y1: number, x2: number, y2: number, text = ""): WhiteboardConnectorElement {
  return { id: makeId(), type: "arrow", x1, y1, x2, y2, text, stroke: "#2563eb", strokeWidth: 3 };
}

export function buildWhiteboardTemplate(template: WhiteboardTemplate, offset: number): WhiteboardElement[] {
    let next: WhiteboardElement[] = [];
    if (template === "flow") {
      next = [flowTemplateElement("terminator", 120 + offset, 90, 190, 70, "Start", "#2563eb", "#dbeafe"), flowTemplateElement("process", 120 + offset, 210, 190, 80, "Process", "#2563eb", "#eff6ff"), flowTemplateElement("diamond", 120 + offset, 350, 190, 110, "Decision?", "#7c3aed", "#f3e8ff"), flowTemplateElement("process", 430 + offset, 365, 210, 80, "Yes path", "#16a34a", "#dcfce7"), flowTemplateElement("terminator", 120 + offset, 520, 190, 70, "End", "#0f172a", "#e2e8f0"), flowTemplateArrow(215 + offset, 160, 215 + offset, 210), flowTemplateArrow(215 + offset, 290, 215 + offset, 350), flowTemplateArrow(310 + offset, 405, 430 + offset, 405, "Yes"), flowTemplateArrow(215 + offset, 460, 215 + offset, 520, "No")];
    }
    if (template === "loop") {
      next = [flowTemplateElement("frame", 80 + offset, 80, 650, 410, "Gameplay loop", "#2563eb", "rgba(37,99,235,0.06)"), flowTemplateElement("process", 130 + offset, 160, 170, 82, "Explore", "#2563eb", "#dbeafe"), flowTemplateElement("process", 430 + offset, 160, 170, 82, "Encounter", "#7c3aed", "#f3e8ff"), flowTemplateElement("process", 430 + offset, 330, 170, 82, "Reward", "#16a34a", "#dcfce7"), flowTemplateElement("process", 130 + offset, 330, 170, 82, "Upgrade", "#f97316", "#ffedd5"), flowTemplateArrow(300 + offset, 201, 430 + offset, 201), flowTemplateArrow(515 + offset, 242, 515 + offset, 330), flowTemplateArrow(430 + offset, 371, 300 + offset, 371), flowTemplateArrow(215 + offset, 330, 215 + offset, 242)];
    }
    if (template === "system") {
      next = [flowTemplateElement("actor", 90 + offset, 190, 110, 140, "Player", "#0f172a", "#f8fafc"), flowTemplateElement("process", 280 + offset, 165, 210, 90, "Client / UI", "#2563eb", "#dbeafe"), flowTemplateElement("process", 570 + offset, 165, 220, 90, "Game server", "#7c3aed", "#f3e8ff"), flowTemplateElement("database", 865 + offset, 150, 190, 120, "Database", "#16a34a", "#dcfce7"), flowTemplateElement("cloud", 570 + offset, 335, 220, 120, "External API", "#64748b", "#f1f5f9"), flowTemplateArrow(200 + offset, 235, 280 + offset, 210), flowTemplateArrow(490 + offset, 210, 570 + offset, 210), flowTemplateArrow(790 + offset, 210, 865 + offset, 210), flowTemplateArrow(680 + offset, 255, 680 + offset, 335)];
    }
    if (template === "dialogue") {
      next = [flowTemplateElement("sticky", 120 + offset, 90, 230, 110, "NPC opens quest", "#2563eb", "#dbeafe"), flowTemplateElement("callout", 450 + offset, 85, 270, 120, "Player asks about the island", "#0f172a", "#f8fafc"), flowTemplateElement("diamond", 470 + offset, 275, 230, 120, "Has artifact?", "#7c3aed", "#f3e8ff"), flowTemplateElement("callout", 180 + offset, 500, 250, 110, "NPC reveals shortcut", "#16a34a", "#dcfce7"), flowTemplateElement("callout", 600 + offset, 500, 250, 110, "NPC hints at cave", "#f97316", "#ffedd5"), flowTemplateArrow(350 + offset, 145, 450 + offset, 145), flowTemplateArrow(585 + offset, 205, 585 + offset, 275), flowTemplateArrow(520 + offset, 395, 305 + offset, 500, "Yes"), flowTemplateArrow(640 + offset, 395, 720 + offset, 500, "No")];
    }
    if (template === "wireframe") {
      next = [flowTemplateElement("frame", 100 + offset, 80, 780, 520, "Screen wireframe", "#2563eb", "rgba(37,99,235,0.05)"), flowTemplateElement("box", 130 + offset, 130, 720, 64, "Header / navigation", "#0f172a", "#e2e8f0"), flowTemplateElement("box", 130 + offset, 230, 190, 320, "Sidebar", "#64748b", "#f8fafc"), flowTemplateElement("box", 355 + offset, 230, 495, 145, "Hero / main content", "#2563eb", "#dbeafe"), flowTemplateElement("box", 355 + offset, 405, 230, 145, "Panel A", "#7c3aed", "#f3e8ff"), flowTemplateElement("box", 620 + offset, 405, 230, 145, "Panel B", "#16a34a", "#dcfce7")];
    }
    if (template === "mindmap") {
      next = [flowTemplateElement("ellipse", 430 + offset, 250, 220, 110, "Core idea", "#2563eb", "#dbeafe"), flowTemplateElement("sticky", 120 + offset, 110, 220, 100, "Mechanics", "#16a34a", "#dcfce7"), flowTemplateElement("sticky", 760 + offset, 110, 220, 100, "Art direction", "#7c3aed", "#f3e8ff"), flowTemplateElement("sticky", 120 + offset, 480, 220, 100, "Risks", "#ef4444", "#fee2e2"), flowTemplateElement("sticky", 760 + offset, 480, 220, 100, "Next steps", "#f97316", "#ffedd5"), flowTemplateArrow(430 + offset, 295, 340 + offset, 160), flowTemplateArrow(650 + offset, 295, 760 + offset, 160), flowTemplateArrow(430 + offset, 335, 340 + offset, 530), flowTemplateArrow(650 + offset, 335, 760 + offset, 530)];
    }
    if (template === "roadmap") {
      next = [flowTemplateElement("swimlane", 80 + offset, 120, 960, 360, "Roadmap", "#2563eb", "rgba(37,99,235,0.05)"), flowTemplateElement("process", 130 + offset, 205, 180, 80, "Prototype", "#2563eb", "#dbeafe"), flowTemplateElement("process", 370 + offset, 205, 180, 80, "Vertical slice", "#7c3aed", "#f3e8ff"), flowTemplateElement("process", 610 + offset, 205, 180, 80, "Alpha", "#f97316", "#ffedd5"), flowTemplateElement("process", 850 + offset, 205, 160, 80, "Release", "#16a34a", "#dcfce7"), flowTemplateArrow(310 + offset, 245, 370 + offset, 245), flowTemplateArrow(550 + offset, 245, 610 + offset, 245), flowTemplateArrow(790 + offset, 245, 850 + offset, 245)];
    }
    if (template === "sequence") {
      next = [
        flowTemplateElement("actor", 90 + offset, 110, 100, 120, "Player", "#0f172a", "#f8fafc"),
        flowTemplateElement("process", 315 + offset, 120, 170, 70, "Client", "#2563eb", "#dbeafe"),
        flowTemplateElement("process", 600 + offset, 120, 170, 70, "Server", "#7c3aed", "#f3e8ff"),
        flowTemplateElement("database", 875 + offset, 105, 160, 110, "DB", "#16a34a", "#dcfce7"),
        {
          ...flowTemplateArrow(190 + offset, 300, 315 + offset, 300, "input"),
          dashed: true,
        },
        {
          ...flowTemplateArrow(485 + offset, 360, 600 + offset, 360, "request"),
          dashed: true,
        },
        {
          ...flowTemplateArrow(770 + offset, 420, 875 + offset, 420, "save"),
          dashed: true,
        },
        flowTemplateArrow(600 + offset, 500, 315 + offset, 500, "response"),
      ];
    }
    if (template === "er") {
      next = [flowTemplateElement("database", 120 + offset, 120, 230, 130, "Project", "#2563eb", "#dbeafe"), flowTemplateElement("database", 500 + offset, 120, 230, 130, "Board", "#7c3aed", "#f3e8ff"), flowTemplateElement("database", 500 + offset, 380, 230, 130, "Card", "#16a34a", "#dcfce7"), flowTemplateElement("database", 880 + offset, 380, 230, 130, "Comment", "#64748b", "#f1f5f9"), flowTemplateArrow(350 + offset, 185, 500 + offset, 185, "has many"), flowTemplateArrow(615 + offset, 250, 615 + offset, 380, "has many"), flowTemplateArrow(730 + offset, 445, 880 + offset, 445, "has many")];
    }
  return next;
}
